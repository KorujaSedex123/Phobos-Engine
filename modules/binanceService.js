// modules/binanceService.js
const { Spot } = require('@binance/connector');
const axios = require("axios");
const config = require('../config.json');

let client;

function init() {
    const apiKey = process.env.API_KEY;
    const apiSecret = process.env.API_SECRET;
    if (!apiKey || !apiSecret) { 
        console.error("ERRO CRÍTICO: Chaves de API não encontradas no .env"); 
        process.exit(1); 
    }
    client = new Spot(apiKey, apiSecret, { baseURL: config.apiUrl });
}
async function getHistoricalKlines(symbol, interval, startTime, endTime) {
    const limit = 1000; // Limite máximo da API por requisição
    let allKlines = [];
    let currentStartTime = startTime;

    console.log(`Buscando dados históricos para ${symbol} de ${new Date(startTime).toISOString()} até ${new Date(endTime).toISOString()}...`);

    while (currentStartTime < endTime) {
        try {
            const response = await axios.get(`${config.apiUrl}/api/v3/klines`, {
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
        const exchangeInfo = await client.exchangeInfo({ symbol });
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

async function getKlines(symbol) {
    const limit = config.maPeriod + 5; // Pega os klines necessários
    const response = await axios.get(`${config.apiUrl}/api/v3/klines?limit=${limit}&interval=1m&symbol=${symbol}`);
    return response.data;
}

async function getLatestPrice(symbol) {
    const response = await axios.get(`${config.apiUrl}/api/v3/klines?limit=1&interval=1m&symbol=${symbol}`);
    return parseFloat(response.data[0][4]);
}

async function placeOrder(symbol, side, quantity) {
    return client.newOrder(symbol, side, 'MARKET', { quantity });
}

async function getSymbolList() {
    const response = await axios.get(`${config.apiUrl}/api/v3/exchangeInfo`);
    const filteredSymbols = response.data.symbols.filter(s => s.quoteAsset === 'USDT' && s.status === 'TRADING');
    return filteredSymbols.map(s => s.symbol);
}

// Para os comandos do Discord
async function getSymbolTicker(symbol) {
    return axios.get(`${config.apiUrl}/api/v3/ticker/24hr?symbol=${symbol}`);
}

async function getSymbolRSI(symbol) {
    const klines = await axios.get(`${config.apiUrl}/api/v3/klines?limit=100&interval=1m&symbol=${symbol}`);
    return klines.data.map(k => parseFloat(k[4]));
}

module.exports = {
    init,
    getAccountInfo,
    getTradeFilters,
    getKlines, // Mantém a busca de klines recentes para o bot ao vivo
    getLatestPrice,
    placeOrder,
    getSymbolList,
    getSymbolTicker,
    getSymbolRSI,
    getHistoricalKlines // Exporta a nova função
};