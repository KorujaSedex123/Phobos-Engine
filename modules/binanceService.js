// modules/binanceService.js
const { Spot } = require('@binance/connector');
const axios = require("axios");
const config = require('../config.json');
let client = null; // Começa como null
let currentBaseUrl = ''; // Guarda a URL base atual para Axios


/**
 * Inicializa o cliente da Binance para o ambiente especificado.
 * @param {string} environment - 'production' ou 'testnet'.
 */
function init(environment = 'production') {
    let apiKey = '';
    let apiSecret = '';
    let baseUrl = '';
    if (client) {
        console.log(`Binance Service: REINICIALIZANDO para ${environment.toUpperCase()}...`);
    }

    if (environment === 'testnet') {
        apiKey = process.env.TESTNET_API_KEY;
        apiSecret = process.env.TESTNET_API_SECRET;
        baseUrl = config.apiUrlTestnet; //
        console.log("Binance Service: Inicializando em modo TESTNET.");
    } else { // Produção por default
        apiKey = process.env.API_KEY;
        apiSecret = process.env.API_SECRET;
        baseUrl = config.apiUrlProduction; //
        console.log("Binance Service: Inicializando em modo PRODUÇÃO.");
    }

    currentBaseUrl = baseUrl; // Guarda para Axios

    if (!apiKey || !apiSecret) {
        console.error(`ERRO CRÍTICO: Chaves de API para ${environment.toUpperCase()} não encontradas no .env`);
        // Considerar lançar um erro ou sair, dependendo de como main.js trata
        // process.exit(1); // Ou throw new Error(...)
        client = null; // Garante que o cliente não é utilizável
        return false; // Indica falha na inicialização
    }

    try {
        client = new Spot(apiKey, apiSecret, { baseURL: baseUrl });
        console.log(`Binance Service: Cliente Spot ${client ? 'REINICIALIZADO e ' : ''}conectado a ${baseUrl}`);
        return true;
    } catch (error) {
        console.error(`Erro ao criar cliente Spot da Binance para ${environment}: ${error.message}`);
        client = null;
        return false;
    }
}
/**
 * Retorna a instância do cliente Spot inicializado.
 * Lança um erro se o cliente não foi inicializado corretamente.
 */
function getClient() {
    if (!client) {
        throw new Error("Cliente Binance não inicializado. Chame init() primeiro com o ambiente correto.");
    }
    return client;
}

// --- Funções que usam o CLIENTE autenticado ---

async function getAccountInfo() {
    return getClient().account(); // Usa getClient()
}

async function placeOrder(symbol, side, quantity) {
    // Usa getClient()
    // Nota: O tipo de ordem 'MARKET' pode não estar disponível em todos os pares no Testnet.
    // Pode precisar de adicionar lógica para usar 'LIMIT' se 'MARKET' falhar no Testnet.
    return getClient().newOrder(symbol, side, 'MARKET', { quantity });
}

async function getHistoricalKlines(symbol, interval, startTime, endTime) {
    const limit = 1000; // Limite máximo da API por requisição
    let allKlines = [];
    let currentStartTime = startTime;

    console.log(`Buscando dados históricos (${interval}) para ${symbol} de ${new Date(startTime).toISOString()} até ${new Date(endTime).toISOString()} via ${currentBaseUrl}...`);
    while (currentStartTime < endTime) {
        try {
            const response = await axios.get(`${currentBaseUrl}/api/v3/klines`, { // Usa currentBaseUrl
                params: {
                    symbol: symbol,
                    interval: interval,
                    startTime: currentStartTime,
                    endTime: endTime, // Limita a busca até o fim desejado
                    limit: limit
                }
            });

            const klines = response.data;
            if (klines.length === 0) {
                break; // Sem mais dados no período
            }

            allKlines = allKlines.concat(klines);
            currentStartTime = klines[klines.length - 1][0] + 1; // Próxima busca começa após o último kline recebido

            console.log(` -> Recebidos ${klines.length} klines. Último timestamp: ${new Date(currentStartTime - 1).toISOString()}`);

            // Pequena pausa para evitar limites de API
            await new Promise(resolve => setTimeout(resolve, 300));

            // Se a última resposta retornou menos que o limite, provavelmente chegamos ao fim
            if (klines.length < limit) {
                break;
            }

        } catch (error) {
            const errorMsg = error.response?.data?.msg || error.message || "Erro desconhecido";
            console.error(`Erro ao buscar klines históricos: ${errorMsg}`);
            throw error; // Propaga o erro para o script principal
        }
    }
    console.log(`Total de klines históricos para ${symbol}: ${allKlines.length}`);
    return allKlines;
}
// Criamos "wrappers" para cada chamada de API
async function getAccountInfo() {
    return client.account();
}

async function getTradeFilters(symbol) {
    try {
        const exchangeInfo = await getClient().exchangeInfo({ symbol })
        const symbolInfo = exchangeInfo.data.symbols.find(s => s.symbol === symbol);
        if (!symbolInfo) { throw new Error(`Símbolo ${symbol} não encontrado em exchangeInfo`); }

        const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
        const notionalFilter = symbolInfo.filters.find(f => f.filterType === 'NOTIONAL');

        if (!lotSizeFilter || !notionalFilter) { throw new Error(`Filtros LOT_SIZE ou NOTIONAL não encontrados para ${symbol}`); }

        return {
            precision: Math.max(0, Math.log10(1 / parseFloat(lotSizeFilter.stepSize))),
            minQty: parseFloat(lotSizeFilter.minQty),
            minNotional: parseFloat(notionalFilter.minNotional)
        };
    } catch (error) {
        console.error(`Erro ao buscar regras do ativo: ${error.message}`);
        throw error; // Lança o erro para o tradingEngine tratar
    }
}

async function getKlines(symbol, limit = 205) { // Usa um default maior para garantir lookback
    // Adiciona limite como parâmetro opcional
    console.log(`Buscando ${limit} klines recentes (${symbol}) via ${currentBaseUrl}...`);
    try {
        const response = await axios.get(`${currentBaseUrl}/api/v3/klines`, { // Usa currentBaseUrl
            params: {
                symbol: symbol,
                interval: '1m',
                limit: limit
            }
        });
        return response.data;
    } catch (error) {
        const errorMsg = error.response?.data?.msg || error.message || "Erro desconhecido";
        console.error(`Erro ao buscar klines recentes: ${errorMsg}`);
        throw error; // Propaga o erro
    }
}

async function getLatestPrice(symbol) {
    // Esta função busca apenas 1 kline, é mais eficiente usar /ticker/price
    try {
        const response = await axios.get(`${currentBaseUrl}/api/v3/ticker/price`, { // Usa currentBaseUrl e endpoint mais eficiente
            params: { symbol: symbol }
        });
        return parseFloat(response.data.price);
    } catch (error) {
        const errorMsg = error.response?.data?.msg || error.message || "Erro desconhecido";
        console.error(`Erro ao buscar último preço para ${symbol}: ${errorMsg}`);
        throw error;
    }
}

async function placeOrder(symbol, side, quantity) {
    return client.newOrder(symbol, side, 'MARKET', { quantity });
}

async function getSymbolList() {
    const response = await axios.get(`${currentBaseUrl}/api/v3/exchangeInfo`);
    const filteredSymbols = response.data.symbols.filter(s => s.quoteAsset === 'USDT' && s.status === 'TRADING');
    return filteredSymbols.map(s => s.symbol);
}

// Para os comandos do Discord
async function getSymbolTicker(symbol) {
    return axios.get(`${currentBaseUrl}/api/v3/ticker/24hr`, { params: { symbol } }); // Usa currentBaseUrl
}

async function getSymbolRSI(symbol) {
    // Usado pelo Discord - busca Klines
    const klinesNeededForRSI = (baseConfig.rsiPeriod || 14) + 5; // Usa rsiPeriod do config + margem
    try {
        const klines = await axios.get(`${currentBaseUrl}/api/v3/klines`, { // Usa currentBaseUrl
            params: {
                symbol: symbol,
                interval: '1m',
                limit: klinesNeededForRSI // Busca o necessário
            }
        });
        return klines.data.map(k => parseFloat(k[4])); // Retorna apenas os preços de fecho
    } catch (error) { /* ... (tratamento de erro) ... */ }
}

module.exports = {
    init, // Exporta init para ser chamado pelo main.js
    // getClient, // Opcional: Exportar se precisar do cliente diretamente fora do módulo
    getAccountInfo,
    getTradeFilters,
    getKlines,
    getLatestPrice,
    placeOrder,
    getSymbolList,
    getSymbolTicker,
    getSymbolRSI,
    getHistoricalKlines
};