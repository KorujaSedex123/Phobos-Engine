// modules/tradingEngine.js
const { RSI, SMA } = require('technicalindicators');
const config = require('../config.json');

// Serviços que serão injetados
let binance;
let notifier;
let ui;
let state;

// Estado interno do Bot
let portfolio;
let sessionSettings;
let isMonitoringActive;
let sessionStats;

// Helper de precisão
function floorToDecimal(num, decimals) {
        const factor = Math.pow(10, decimals);
        return Math.floor(num * factor) / factor;
}

function init(injectedServices, initialState) {
        binance = injectedServices.binance;
        notifier = injectedServices.discord;
        ui = injectedServices.ui;
        state = injectedServices.state;

        // Carrega o estado inicial
        portfolio = initialState.portfolio;
        sessionSettings = initialState.sessionSettings;
        isMonitoringActive = initialState.isMonitoringActive;
        sessionStats = initialState.sessionStats;
}

// Retorna o estado atual (para salvar ou para o comando !status)
function getState() {
        return { portfolio, sessionSettings, isMonitoringActive, sessionStats };
}

function getStatusCommand() {
        if (!isMonitoringActive) {
                return 'O monitoramento está parado.';
        }
        return portfolio.isOpened
                ? `Estou numa posição aberta em **${sessionSettings.symbol}**.\n**Preço de Compra:** $${portfolio.lastBuyPrice.toFixed(2)}\n**Quantidade:** ${portfolio.cryptoBalance.toFixed(8)}`
                : `Estou a aguardar uma oportunidade de compra em **${sessionSettings.symbol}**.`;
}

async function start(settings, isRestoring = false) {
        // Se não for restauração, reseta o estado
        if (!isRestoring) {
                portfolio = { cryptoBalance: 0, isOpened: false, lastBuyPrice: 0, totalProfitUsdt: 0, peakPrice: 0 };
                sessionStats = { totalTrades: 0, wins: 0, losses: 0, totalProfit: 0, totalLoss: 0 };
                sessionSettings = { ...settings, maPeriod: config.maPeriod, rsiPeriod: config.rsiPeriod };
        }
        const activeEnvironment = sessionSettings.environment || 'production'; // Pega dos settings combinados
        ui.log(`--- Iniciando sessão no ambiente: ${activeEnvironment.toUpperCase()} ---`);
        
        ui.log(`Ativo ${sessionSettings.symbol} selecionado.`);
        ui.log(`Buscando informações da carteira...`);

        try {
                const accountInfo = await binance.getAccountInfo();
                const balances = accountInfo.data.balances;
                const usdtBalance = parseFloat(balances.find(b => b.asset === 'USDT')?.free || 0);

                // Se for restauração, não precisa checar saldo, apenas atualiza UI
                if (isRestoring) {
                        ui.log(`--- SESSÃO RESTAURADA ---`);
                        ui.log(`Posição aberta em ${sessionSettings.symbol} restaurada.`);
                        ui.log(`---------------------------------`);
                } else {
                        const assetsToShow = balances.filter(asset => parseFloat(asset.free) > 0.00000001);
                        ui.log(`--- SALDOS NA CARTEIRA SPOT ---`);
                        if (assetsToShow.length > 0) {
                                assetsToShow.forEach(asset => ui.log(`${asset.asset}: ${parseFloat(asset.free).toFixed(8)}`));
                        } else {
                                ui.log(`Nenhum saldo encontrado na carteira.`);
                        }
                        ui.log(`---------------------------------`);

                        const filters = await binance.getTradeFilters(sessionSettings.symbol);
                        if (!filters) {
                                ui.log(`❌ Não foi possível obter as regras para ${sessionSettings.symbol}.`);
                                return;
                        }
                        if (usdtBalance < filters.minNotional) {
                                ui.log(`❌ Saldo USDT insuficiente ($${usdtBalance.toFixed(2)}). Mínimo ~$${filters.minNotional}.`);
                                return;
                        }
                }

                isMonitoringActive = true;
                if (!isRestoring) state.saveState(getState()); // Salva o estado "ativo"
                ui.log(`Monitoramento iniciado...`);
                monitor(); // Inicia o primeiro ciclo

        } catch (error) {
                const msg = error.response ? error.response.data.msg : error.message;
                notifier.sendNotification({ type: 'error', title: '❌ Erro na Inicialização', message: msg });
                ui.log(`❌ Erro ao buscar informações da conta: ${msg}`);
        }
}

function stop() {
        isMonitoringActive = false;
        state.saveState(getState()); // Salva o estado "parado"
        notifier.sendNotification({ type: 'info', title: '⏹️ Monitoramento Parado', message: 'Parado manualmente.' });
        ui.log('⏹️ Monitoramento parado pelo usuário.');
        ui.update(getState());
}

async function monitor() {
        if (!isMonitoringActive) return; // Encerra o ciclo recursivo

        const {
                symbol, rsiPeriod, rsiOversold, takeProfitPercentage,
                stopLossPercentage, maPeriod, useMaFilter, useTrailingStop,
                trailingStopPercentage, useMaExitFilter
        } = sessionSettings;

        try {
                const accountInfo = await binance.getAccountInfo();
                const balances = accountInfo.data.balances;
                const klines = await binance.getKlines(symbol);
                const closePrices = klines.map(k => parseFloat(k[4]));
                const price = closePrices[closePrices.length - 1];
                const rsiValues = RSI.calculate({ period: rsiPeriod, values: closePrices });
                const lastRsi = rsiValues[rsiValues.length - 1];
                const smaValues = SMA.calculate({ period: maPeriod, values: closePrices });
                const lastSma = smaValues[smaValues.length - 1];

                ui.update({ ...getState(), price, lastRsi, lastSma, balances, klines });

                const rsiCondition = lastRsi <= rsiOversold;
                const maCondition = !useMaFilter || (useMaFilter && price > lastSma);

                // LÓGICA DE COMPRA
                if (rsiCondition && maCondition && !portfolio.isOpened) {
                        const usdtBalance = parseFloat(balances.find(b => b.asset === 'USDT').free);
                        const filters = await binance.getTradeFilters(symbol);
                        if (!filters) return;
                        if (usdtBalance < filters.minNotional) {
                                ui.log(`Saldo USDT ($${usdtBalance.toFixed(2)}) insuficiente. Mínimo ~$${filters.minNotional}.`);
                                return;
                        }
                        const quantityToBuy = (usdtBalance * 0.995) / price;
                        if (price * quantityToBuy < filters.minNotional || quantityToBuy < filters.minQty) {
                                ui.log(`Ordem muito pequena (Valor < $${filters.minNotional} ou Qtd < ${filters.minQty}).`);
                                return;
                        }
                        const finalQuantity = floorToDecimal(quantityToBuy, filters.precision);
                        ui.log(`Enviando ordem de compra de ${finalQuantity} ${symbol}...`);
                        const order = await binance.placeOrder(symbol, 'BUY', finalQuantity);

                        if (order && order.data && parseFloat(order.data.executedQty) > 0) {
                                ui.log('✅ ORDEM DE COMPRA EXECUTADA E CONFIRMADA!');
                                portfolio.isOpened = true;
                                portfolio.lastBuyPrice = parseFloat(order.data.fills[0].price);
                                portfolio.cryptoBalance = parseFloat(order.data.executedQty);
                                portfolio.peakPrice = portfolio.lastBuyPrice;
                                notifier.sendNotification({ type: 'buy', title: '✅ COMPRA REALIZADA', message: `**Ativo:** ${symbol}\n**Quantidade:** ${portfolio.cryptoBalance.toFixed(8)}\n**Preço:** $${portfolio.lastBuyPrice.toFixed(2)}` });
                                state.saveState(getState()); // Salva o estado "em posição"
                        } else {
                                ui.log('⚠️ AVISO: Ordem de compra enviada, mas não foi executada/preenchida.');
                                portfolio.isOpened = false;
                        }
                        // LÓGICA DE VENDA
                } else if (portfolio.isOpened) {
                        let reason = null;
                        if (useTrailingStop) {
                                if (price > portfolio.peakPrice) { portfolio.peakPrice = price; }
                                const trailingStopPrice = portfolio.peakPrice * (1 - trailingStopPercentage / 100);
                                if (price <= trailingStopPrice) {
                                        reason = 'TRAILING STOP';
                                }
                        } else {
                                const stopLossPrice = portfolio.lastBuyPrice * (1 - stopLossPercentage / 100);
                                if (price <= stopLossPrice) {
                                        reason = 'STOP LOSS';
                                }
                        }
                        if (!reason && !useTrailingStop) {
                                const takeProfitPrice = portfolio.lastBuyPrice * (1 + takeProfitPercentage / 100);
                                if (price >= takeProfitPrice) {
                                        reason = 'TAKE PROFIT';
                                }
                        }
                        if (!reason && useMaExitFilter && price < lastSma) {
                                reason = 'MÉDIA MÓVEL';
                        }

                        if (reason) {
                                ui.log(`[VENDA] Condição de ${reason} atingida.`);
                                await liquidatePosition(reason);
                        } else {
                                // Log de aguardando venda
                                const currentProfit = (price * portfolio.cryptoBalance) - (portfolio.lastBuyPrice * portfolio.cryptoBalance);
                                let logMsg = `[AGUARDANDO VENDA] Lucro não realizado: $${currentProfit.toFixed(2)}.`;
                                if (useTrailingStop) {
                                        const trailingStopPrice = portfolio.peakPrice * (1 - trailingStopPercentage / 100);
                                        logMsg += ` Alvo Trailing: < $${trailingStopPrice.toFixed(2)}`;
                                }
                                ui.log(logMsg);
                        }
                        // LÓGICA DE AGUARDAR COMPRA
                } else {
                        // Log de aguardando compra
                        let reason = '';
                        if (lastSma && price <= lastSma && useMaFilter) reason = `Preço abaixo da Média Móvel (${lastSma.toFixed(2)})`;
                        else if (lastRsi > rsiOversold) reason = `RSI acima do alvo (${rsiOversold})`;
                        ui.log(`[AGUARDANDO COMPRA] RSI: ${lastRsi.toFixed(2)}. ${reason}`);
                }
        } catch (error) {
                const errorMessage = error.response ? error.response.data.msg : error.message;
                notifier.sendNotification({ type: 'error', title: '❌ Erro no Monitoramento', message: `**Detalhe:** ${errorMessage}` });
                ui.log(`❌ Erro no monitoramento: ${errorMessage}`);
        }

        // Agenda o próximo ciclo
        if (isMonitoringActive) {
                setTimeout(monitor, config.checkInterval);
        }
}

async function liquidatePosition(reason = "MANUAL") {
        const { symbol } = sessionSettings;
        if (!portfolio.isOpened || !symbol) return;

        const baseAsset = symbol.replace('USDT', '');
        ui.log(`🔴 Liquidando posição... (Razão: ${reason})`);

        try {
                const filters = await binance.getTradeFilters(symbol);
                if (!filters) {
                        ui.log('❌ Não foi possível obter filtros para liquidar.');
                        return;
                };
                const accountInfo = await binance.getAccountInfo();
                const cryptoBalance = parseFloat(accountInfo.data.balances.find(b => b.asset === baseAsset).free);
                const currentPrice = await binance.getLatestPrice(symbol);
                const positionValue = currentPrice * cryptoBalance;

                if (positionValue < filters.minNotional) {
                        ui.log(`AVISO: Posição ($${positionValue.toFixed(2)}) muito pequena para vender. Resetando.`);
                } else if (cryptoBalance > filters.minQty) {
                        const finalQuantity = floorToDecimal(cryptoBalance, filters.precision);
                        const order = await binance.placeOrder(symbol, 'SELL', finalQuantity);

                        if (order && order.data && parseFloat(order.data.executedQty) > 0) {
                                const quantitySold = parseFloat(order.data.executedQty);
                                const costOfSoldQty = portfolio.lastBuyPrice * quantitySold;
                                const revenueFromSale = parseFloat(order.data.cummulativeQuoteQty);
                                const profit = revenueFromSale - costOfSoldQty;
                                portfolio.totalProfitUsdt += profit;

                                sessionStats.totalTrades++;
                                if (profit > 0) { sessionStats.wins++; sessionStats.totalProfit += profit; }
                                else { sessionStats.losses++; sessionStats.totalLoss += Math.abs(profit); }

                                notifier.sendNotification({ type: profit > 0 ? 'profit' : 'loss', title: `✅ Posição Liquidada (${reason})`, message: `**Ativo:** ${symbol}\n**Resultado:** $${profit.toFixed(2)}` });
                                ui.log('✅ Posição liquidada com sucesso.');
                        }
                } else {
                        ui.log('Sem saldo livre na corretora para liquidar.');
                }
        } catch (error) {
                const errorMessage = error.response ? error.response.data.msg : error.message;
                notifier.sendNotification({ type: 'error', title: '❌ Falha na Liquidação', message: `**Ativo:** ${symbol}\n**Detalhe:** ${errorMessage}` });
                ui.log(`❌ Erro ao liquidar posição: ${errorMessage}. A posição continua aberta.`);
                return;
        }

        // Reseta o portfólio
        portfolio.isOpened = false;
        portfolio.cryptoBalance = 0;
        portfolio.lastBuyPrice = 0;
        portfolio.peakPrice = 0;
        state.saveState(getState()); // Salva o estado "fora de posição"
        ui.update(getState());
}

module.exports = {
        init,
        start,
        stop,
        liquidatePosition,
        getState,
        getStatusCommand
};