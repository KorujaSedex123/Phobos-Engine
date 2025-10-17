const { app, BrowserWindow, ipcMain } = require('electron');
require('dotenv').config();
let config = require('./config.json');
const { Spot } = require('@binance/connector');
const { RSI, SMA } = require('technicalindicators');
const axios = require("axios");
const path = require('path');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

// --- Lógica de Notificações e Comandos do Discord (sem alterações) ---
const discordToken = process.env.DISCORD_BOT_TOKEN;
const userId = process.env.DISCORD_USER_ID;
const discordClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent] });
let notificationTarget;

if (discordToken && userId) {
    discordClient.login(discordToken);
    discordClient.on('ready', async () => {
        try {
            notificationTarget = await discordClient.users.fetch(userId);
            console.log(`Bot de notificações/comandos conectado ao Discord. A ouvir o utilizador ID: ${userId}`);
            sendNotification({ type: 'info', title: 'Phobos Engine Online', message: 'Aplicação de desktop iniciada. Estou online e pronto para receber comandos de informação.' });
        } catch (error) {
            console.error(`Erro ao buscar o alvo de notificação do Discord: ${error.message}`);
        }
    });
}

function sendNotification({ type, title, message }) {
    if (!notificationTarget) return;
    const embed = new EmbedBuilder().setTitle(title).setDescription(message).setTimestamp();
    switch (type) {
        case 'buy': embed.setColor(0x3498DB); break;
        case 'profit': embed.setColor(0x2ECC71); break;
        case 'loss': embed.setColor(0xE74C3C); break;
        case 'error': embed.setColor(0x992D22); break;
        default: embed.setColor(0x95A5A6); break;
    }
    notificationTarget.send({ embeds: [embed] });
}
// --- Fim da Lógica do Discord ---

const apiKey = process.env.API_KEY;
const apiSecret = process.env.API_SECRET;
if (!apiKey || !apiSecret) { console.error("ERRO CRÍTICO: Chaves de API não encontradas no .env"); process.exit(1); }

let client;
let mainWindow;
let portfolio = { cryptoBalance: 0, isOpened: false, lastBuyPrice: 0, totalProfitUsdt: 0, peakPrice: 0 };
let monitorInterval;
let isMonitoringActive = false;
let sessionSettings = {};
let sessionStats = {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    totalProfit: 0,
    totalLoss: 0
};

function floorToDecimal(num, decimals) {
    const factor = Math.pow(10, decimals);
    return Math.floor(num * factor) / factor;
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200, height: 800,
        icon: path.join(__dirname, 'build/icon.ico'),
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
    mainWindow.loadFile('index.html');
    mainWindow.webContents.on('did-finish-load', () => {
        init();
        mainWindow.webContents.send('config-loaded', config);
    });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() });

async function init() {
    try {
        const response = await axios.get(`${config.apiUrl}/api/v3/exchangeInfo`);
        const filteredSymbols = response.data.symbols.filter(s => s.quoteAsset === 'USDT' && s.status === 'TRADING');
        const usdtPairs = filteredSymbols.map(s => s.symbol);
        mainWindow.webContents.send('symbols-loaded', usdtPairs);
    } catch (error) {
        sendNotification({ type: 'error', title: '❌ Erro na Inicialização', message: `**Detalhe:** Falha ao buscar símbolos: ${error.message}` });
        mainWindow.webContents.send('log-message', `❌ Erro ao buscar símbolos: ${error.message}`);
    }
}

async function getTradeFilters(symbol) {
    if (!symbol) return null;
    try {
        const exchangeInfo = await client.exchangeInfo({ symbol });
        const symbolInfo = exchangeInfo.data.symbols[0];
        const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
        const notionalFilter = symbolInfo.filters.find(f => f.filterType === 'NOTIONAL');
        if (!lotSizeFilter || !notionalFilter) { throw new Error(`Filtros LOT_SIZE ou NOTIONAL não encontrados para ${symbol}`); }
        return {
            precision: Math.max(0, Math.log10(1 / parseFloat(lotSizeFilter.stepSize))),
            minQty: parseFloat(lotSizeFilter.minQty),
            minNotional: parseFloat(notionalFilter.minNotional)
        };
    } catch (error) {
        sendNotification({ type: 'error', title: '❌ Erro nas Regras do Ativo', message: `**Ativo:** ${symbol}\n**Detalhe:** ${error.message}` });
        mainWindow.webContents.send('log-message', `❌ Erro ao buscar regras do ativo: ${error.message}`);
        return null;
    }
}

async function liquidatePosition() {
    const symbol = sessionSettings.symbol;
    if (portfolio.isOpened && portfolio.cryptoBalance > 0 && symbol) {
        if (mainWindow) mainWindow.webContents.send('log-message', '🔴 Liquidando posição...');
        try {
            const baseAsset = symbol.replace('USDT', '');
            const filters = await getTradeFilters(symbol);
            if (!filters) {
                mainWindow.webContents.send('log-message', '❌ Não foi possível obter filtros para liquidar.');
                return;
            };
            const accountInfo = await client.account();
            const cryptoBalance = parseFloat(accountInfo.data.balances.find(b => b.asset === baseAsset).free);
            if (cryptoBalance > filters.minQty) {
                const finalQuantity = floorToDecimal(cryptoBalance, filters.precision);
                const order = await client.newOrder(symbol, 'SELL', 'MARKET', { quantity: finalQuantity });

                if (order && order.data && parseFloat(order.data.executedQty) > 0) {
                    const profit = (parseFloat(order.data.cummulativeQuoteQty) - (portfolio.lastBuyPrice * portfolio.cryptoBalance));
                    portfolio.totalProfitUsdt += profit;
                    sessionStats.totalTrades++;
                    if (profit > 0) {
                        sessionStats.wins++;
                        sessionStats.totalProfit += profit;
                    } else {
                        sessionStats.losses++;
                        sessionStats.totalLoss += Math.abs(profit); // Usamos o valor absoluto da perda
                    }
                    sendNotification({ type: profit > 0 ? 'profit' : 'loss', title: '✅ Posição Liquidada', message: `**Ativo:** ${symbol}\n**Resultado:** $${profit.toFixed(2)}` });
                    if (mainWindow) mainWindow.webContents.send('log-message', '✅ Posição liquidada com sucesso.');
                }
            } else {
                if (mainWindow) mainWindow.webContents.send('log-message', 'Sem saldo suficiente na corretora para liquidar.');
            }
        } catch (error) {
            const errorMessage = error.response ? error.response.data.msg : error.message;
            sendNotification({ type: 'error', title: '❌ Falha na Liquidação', message: `**Ativo:** ${symbol}\n**Detalhe:** ${errorMessage}` });
            if (mainWindow) mainWindow.webContents.send('log-message', `❌ Erro ao liquidar posição: ${errorMessage}`);
        } finally {
            portfolio.isOpened = false;
            portfolio.cryptoBalance = 0;
            portfolio.lastBuyPrice = 0;
            portfolio.peakPrice = 0;
            if (mainWindow) mainWindow.webContents.send('update-data', { portfolio, isMonitoringActive });
        }
    }
}

async function monitor() {
    if (!isMonitoringActive) return;
    const { symbol, rsiPeriod, rsiOversold, takeProfitPercentage, stopLossPercentage, maPeriod, useTrailingStop, trailingStopPercentage } = sessionSettings;
    if (!symbol) return;

    try {
        const accountInfo = await client.account();
        const balances = accountInfo.data.balances;
        const klinesResponse = await axios.get(`${config.apiUrl}/api/v3/klines?limit=${maPeriod + 5}&interval=1m&symbol=${symbol}`);
        const klines = klinesResponse.data;
        const closePrices = klines.map(k => parseFloat(k[4]));
        const price = closePrices[closePrices.length - 1];
        const rsiValues = RSI.calculate({ period: rsiPeriod, values: closePrices });
        const lastRsi = rsiValues[rsiValues.length - 1];
        const smaValues = SMA.calculate({ period: maPeriod, values: closePrices });
        const lastSma = smaValues[smaValues.length - 1];

        mainWindow.webContents.send('update-data', { price, lastRsi, lastSma, portfolio, symbol, balances, klines, isMonitoringActive, sessionStats })

        if (lastRsi <= rsiOversold && !portfolio.isOpened && price > lastSma) {
            mainWindow.webContents.send('log-message', `[COMPRA] Condições atingidas: RSI (${lastRsi.toFixed(2)}) <= ${rsiOversold} E Preço (${price.toFixed(2)}) > MA(${lastSma.toFixed(2)})`);
            const usdtBalance = parseFloat(balances.find(b => b.asset === 'USDT').free);
            const filters = await getTradeFilters(symbol);
            if (!filters) return;
            if (usdtBalance < filters.minNotional) {
                mainWindow.webContents.send('log-message', `Saldo USDT ($${usdtBalance.toFixed(2)}) insuficiente. Mínimo ~$${filters.minNotional}.`);
                return;
            }
            const quantityToBuy = (usdtBalance * 0.995) / price;
            if (price * quantityToBuy < filters.minNotional) {
                mainWindow.webContents.send('log-message', `Valor da ordem ($${(price * quantityToBuy).toFixed(2)}) é muito baixo. Mínimo ~$${filters.minNotional}.`);
                return;
            }
            if (quantityToBuy < filters.minQty) {
                mainWindow.webContents.send('log-message', `Quantidade (${quantityToBuy.toFixed(8)}) é menor que o mínimo permitido (${filters.minQty}).`);
                return;
            }
            const finalQuantity = floorToDecimal(quantityToBuy, filters.precision);
            mainWindow.webContents.send('log-message', `Enviando ordem de compra de ${finalQuantity} ${symbol}...`);
            const order = await client.newOrder(symbol, 'BUY', 'MARKET', { quantity: finalQuantity });
            if (order && order.data && parseFloat(order.data.executedQty) > 0) {
                mainWindow.webContents.send('log-message', '✅ ORDEM DE COMPRA EXECUTADA E CONFIRMADA!');
                portfolio.isOpened = true;
                portfolio.lastBuyPrice = parseFloat(order.data.fills[0].price);
                portfolio.cryptoBalance = parseFloat(order.data.executedQty);
                portfolio.peakPrice = portfolio.lastBuyPrice;
                sendNotification({ type: 'buy', title: '✅ COMPRA REALIZADA', message: `**Ativo:** ${symbol}\n**Quantidade:** ${portfolio.cryptoBalance.toFixed(8)}\n**Preço:** $${portfolio.lastBuyPrice.toFixed(2)}` });
            } else {
                mainWindow.webContents.send('log-message', '⚠️ AVISO: Ordem de compra enviada, mas não foi executada/preenchida.');
                portfolio.isOpened = false;
            }
        } else if (portfolio.isOpened) {
            const takeProfitPrice = portfolio.lastBuyPrice * (1 + takeProfitPercentage / 100);
            const stopLossPrice = portfolio.lastBuyPrice * (1 - stopLossPercentage / 100);
            let reason = null;
            if (useTrailingStop) {
                // 1. Atualiza o preço máximo atingido
                if (price > portfolio.peakPrice) {
                    portfolio.peakPrice = price;
                }

                // 2. Calcula o alvo do Trailing Stop
                const trailingStopPrice = portfolio.peakPrice * (1 - trailingStopPercentage / 100);

                // 3. Verifica se o preço caiu abaixo do alvo do Trailing Stop
                if (price <= trailingStopPrice) {
                    reason = 'TRAILING STOP';
                }
            } else {
                // Lógica antiga de TP/SL se o trailing estiver desativado
                const takeProfitPrice = portfolio.lastBuyPrice * (1 + takeProfitPercentage / 100);
                const stopLossPrice = portfolio.lastBuyPrice * (1 - stopLossPercentage / 100);
                if (price >= takeProfitPrice) reason = 'TAKE PROFIT';
                if (price <= stopLossPrice) reason = 'STOP LOSS';
            }

            if (reason) {
                mainWindow.webContents.send('log-message', `[VENDA] Condição de ${reason} atingida.`);
                await liquidatePosition(reason);
            } else {
                const currentProfit = (price * portfolio.cryptoBalance) - (portfolio.lastBuyPrice * portfolio.cryptoBalance);
                if (useTrailingStop) {
                    const trailingStopPrice = portfolio.peakPrice * (1 - trailingStopPercentage / 100);
                    mainWindow.webContents.send('log-message', `[AGUARDANDO VENDA] Lucro não realizado: $${currentProfit.toFixed(2)}. Alvo Trailing: < $${trailingStopPrice.toFixed(2)}`);
                } else {
                    mainWindow.webContents.send('log-message', `[AGUARDANDO VENDA] Lucro não realizado: $${currentProfit.toFixed(2)}`);
                }
            }
            if (price >= takeProfitPrice) reason = 'TAKE PROFIT';
            if (price <= stopLossPrice) reason = 'STOP LOSS';
            if (reason) {
                mainWindow.webContents.send('log-message', `[VENDA] Condição de ${reason} atingida.`);
                await liquidatePosition();
            } else {
                const currentProfit = (price * portfolio.cryptoBalance) - (portfolio.lastBuyPrice * portfolio.cryptoBalance);
                mainWindow.webContents.send('log-message', `[AGUARDANDO VENDA] Lucro não realizado: $${currentProfit.toFixed(2)}`);
            }
        } else {
            let reason = '';
            if (lastSma && price <= lastSma) reason = `Preço abaixo da Média Móvel (${lastSma.toFixed(2)})`;
            else if (lastRsi > rsiOversold) reason = `RSI acima do alvo (${rsiOversold})`;
            mainWindow.webContents.send('log-message', `[AGUARDANDO COMPRA] RSI: ${lastRsi.toFixed(2)}. ${reason}`);
        }
    } catch (error) {
        const errorMessage = error.response ? error.response.data.msg : error.message;
        sendNotification({ type: 'error', title: '❌ Erro no Monitoramento', message: `**Detalhe:** ${errorMessage}` });
        mainWindow.webContents.send('log-message', `❌ Erro no monitoramento: ${errorMessage}`);
    }
}

ipcMain.on('start-monitoring', async (event, settings) => {
    portfolio = { cryptoBalance: 0, isOpened: false, lastBuyPrice: 0, totalProfitUsdt: 0, peakPrice: 0 };
    sessionSettings = { ...settings, maPeriod: config.maPeriod, rsiPeriod: config.rsiPeriod, useTrailingStop: config.useTrailingStop };
    sessionStats = { totalTrades: 0, wins: 0, losses: 0, totalProfit: 0, totalLoss: 0 };
    client = new Spot(apiKey, apiSecret, { baseURL: config.apiUrl });
    mainWindow.webContents.send('log-message', `Ativo ${settings.symbol} selecionado.`);
    mainWindow.webContents.send('log-message', `Buscando informações da carteira...`);
    try {
        const accountInfo = await client.account();
        const balances = accountInfo.data.balances;
        const assetsToShow = balances.filter(asset => parseFloat(asset.free) > 0.00000001);
        mainWindow.webContents.send('log-message', `--- SALDOS NA CARTEIRA SPOT ---`);
        if (assetsToShow.length > 0) {
            assetsToShow.forEach(asset => {
                mainWindow.webContents.send('log-message', `${asset.asset}: ${parseFloat(asset.free).toFixed(8)}`);
            });
        } else {
            mainWindow.webContents.send('log-message', `Nenhum saldo encontrado na carteira.`);
        }
        mainWindow.webContents.send('log-message', `---------------------------------`);
        const usdtBalance = parseFloat(balances.find(b => b.asset === 'USDT')?.free || 0);
        const filters = await getTradeFilters(settings.symbol);
        if (!filters) {
            mainWindow.webContents.send('log-message', `❌ Não foi possível obter as regras para ${settings.symbol}. Monitoramento não iniciado.`);
            return;
        }
        const minBalance = filters.minNotional;
        if (usdtBalance < minBalance) {
            mainWindow.webContents.send('log-message', `❌ Saldo USDT insuficiente para operar ($${usdtBalance.toFixed(2)}).`);
            mainWindow.webContents.send('log-message', `Deposite um valor suficiente para começar (mínimo ~$${minBalance}).`);
            return;
        }
        isMonitoringActive = true;
        mainWindow.webContents.send('log-message', `Saldo OK. Iniciando monitoramento...`);
        if (monitorInterval) clearInterval(monitorInterval);
        monitor();
        monitorInterval = setInterval(() => monitor(), config.checkInterval);
    } catch (error) {
        const errorMessage = error.response ? error.response.data.msg : error.message;
        sendNotification({ type: 'error', title: '❌ Erro na Inicialização da Conta', message: `**Detalhe:** ${errorMessage}` });
        mainWindow.webContents.send('log-message', `❌ Erro ao buscar informações da conta: ${errorMessage}`);
    }
});

ipcMain.on('primary-action-button-clicked', async () => {
    if (portfolio.isOpened) {
        await liquidatePosition();
    } else if (isMonitoringActive) {
        if (monitorInterval) clearInterval(monitorInterval);
        isMonitoringActive = false;
        portfolio = { cryptoBalance: 0, isOpened: false, lastBuyPrice: 0, totalProfitUsdt: portfolio.totalProfitUsdt };
        sendNotification({ type: 'info', title: '⏹️ Monitoramento Parado', message: 'O monitoramento foi parado manualmente pelo utilizador.' });
        mainWindow.webContents.send('log-message', '⏹️ Monitoramento parado pelo usuário.');
        mainWindow.webContents.send('update-data', { portfolio, isMonitoringActive });
    }
});

app.on('before-quit', async (event) => {
    if (portfolio.isOpened) {
        event.preventDefault();
        await liquidatePosition();
        app.quit();
    }
});

// --- OUVINTE DE COMANDOS DO DISCORD (APENAS INFORMAÇÃO) ---
discordClient.on('messageCreate', async message => {
    if (message.author.bot || message.author.id !== userId) return;
    if (!message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const symbol = args[0] ? args[0].toUpperCase() : null;

    if (command === 'status') {
        if (!isMonitoringActive) {
            return sendNotification({ type: 'info', title: 'Status do Bot', message: 'O monitoramento está parado.' });
        }
        const statusMessage = portfolio.isOpened
            ? `Estou numa posição aberta em **${sessionSettings.symbol}**.\n**Preço de Compra:** $${portfolio.lastBuyPrice.toFixed(2)}\n**Quantidade:** ${portfolio.cryptoBalance.toFixed(8)}`
            : `Estou a aguardar uma oportunidade de compra em **${sessionSettings.symbol}**.`;
        sendNotification({ type: 'info', title: 'Status Atual', message: statusMessage });
    }
    else if (command === 'info') {
        if (!symbol) return sendNotification({ type: 'error', title: 'Argumento em Falta', message: 'Por favor, especifique um ativo. Ex: `!info BTCUSDT`' });
        try {
            const ticker = await axios.get(`${config.apiUrl}/api/v3/ticker/24hr?symbol=${symbol}`);
            const { lastPrice, priceChangePercent, highPrice, lowPrice, volume } = ticker.data;
            const messageBody = `**Preço:** $${parseFloat(lastPrice).toFixed(2)}\n` +
                `**Variação 24h:** ${parseFloat(priceChangePercent).toFixed(2)}%\n` +
                `**Máxima 24h:** $${parseFloat(highPrice).toFixed(2)}\n` +
                `**Mínima 24h:** $${parseFloat(lowPrice).toFixed(2)}\n` +
                `**Volume 24h:** ${parseFloat(volume).toFixed(2)} ${symbol.replace('USDT', '')}`;
            sendNotification({ type: 'info', title: `Relatório de Mercado: ${symbol}`, message: messageBody });
        } catch (error) {
            sendNotification({ type: 'error', title: `Erro ao buscar info para ${symbol}`, message: 'Verifique se o símbolo é válido.' });
        }
    }
    else if (command === 'rsi') {
        if (!symbol) return sendNotification({ type: 'error', title: 'Argumento em Falta', message: 'Por favor, especifique um ativo. Ex: `!rsi BTCUSDT`' });
        try {
            const klines = await axios.get(`${config.apiUrl}/api/v3/klines?limit=100&interval=1m&symbol=${symbol}`);
            const closePrices = klines.data.map(k => parseFloat(k[4]));
            const rsiValues = RSI.calculate({ period: config.rsiPeriod, values: closePrices });
            const lastRsi = rsiValues[rsiValues.length - 1];
            sendNotification({ type: 'info', title: `RSI (${config.rsiPeriod}, 1m) para ${symbol}`, message: `O RSI atual é **${lastRsi.toFixed(2)}**.` });
        } catch (error) {
            sendNotification({ type: 'error', title: `Erro ao buscar RSI para ${symbol}`, message: 'Verifique se o símbolo é válido.' });
        }
    }
});