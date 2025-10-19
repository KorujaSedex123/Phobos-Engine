// modules/backtesterEngine.js
const { RSI, SMA } = require('technicalindicators');

// Função auxiliar para registrar um trade
function recordTrade(trades, entryTime, entryPrice, exitTime, exitPrice, quantity, reason) {
    const profit = (exitPrice - entryPrice) * quantity;
    trades.push({
        entryTime: entryTime,
        entryPrice: entryPrice,
        exitTime: exitTime,
        exitPrice: exitPrice,
        quantity: quantity,
        profit: profit,
        reason: reason
    });
    console.log(`[${new Date(exitTime).toISOString().substring(0,19)}] VENDA @ ${exitPrice.toFixed(4)} (${reason}) | Qtd: ${quantity.toFixed(8)} | Lucro: ${profit.toFixed(2)}`);
}

function runBacktest(klines, params, initialCapital) {
    console.log("Iniciando simulação de backtest com lógica de venda completa...");
    const trades = [];
    let portfolio = {
        usdtBalance: initialCapital,
        cryptoBalance: 0,
        isOpened: false,
        lastBuyPrice: 0,
        lastBuyTime: 0, // Guarda o tempo da compra
        peakPrice: 0
    };

    const requiredLookback = Math.max(params.rsiPeriod, params.maPeriod);
    if (klines.length <= requiredLookback) {
        console.error("Dados históricos insuficientes.");
        return { trades: [], finalBalance: initialCapital, performance: {} };
    }

    // Loop principal sobre as velas
    for (let i = requiredLookback; i < klines.length; i++) {
        const currentKline = klines[i];
        const openTime = currentKline[0];
        const highPrice = parseFloat(currentKline[2]);
        const lowPrice = parseFloat(currentKline[3]);
        const closePrice = parseFloat(currentKline[4]);

        const historicalCloses = klines.slice(0, i + 1).map(k => parseFloat(k[4]));
        const rsiValues = RSI.calculate({ period: params.rsiPeriod, values: historicalCloses });
        const lastRsi = rsiValues[rsiValues.length - 1];
        const smaValues = SMA.calculate({ period: params.maPeriod, values: historicalCloses });
        const lastSma = smaValues[smaValues.length - 1];

        // --- LÓGICA DE VENDA (Executada ANTES da lógica de compra na mesma vela) ---
        if (portfolio.isOpened) {
            let sellPrice = null;
            let reason = null;

            // 1. Atualiza Peak Price para Trailing Stop (usa o high da vela ATUAL)
            if (params.useTrailingStop && highPrice > portfolio.peakPrice) {
                portfolio.peakPrice = highPrice;
            }

            // 2. Calcula preços de Stop Loss / Trailing Stop
            let stopPrice = 0;
            if (params.useTrailingStop) {
                stopPrice = portfolio.peakPrice * (1 - params.trailingStopPercentage / 100);
            } else {
                stopPrice = portfolio.lastBuyPrice * (1 - params.stopLossPercentage / 100);
            }

            // 3. Verifica se Stop foi atingido (pelo low da vela)
            if (lowPrice <= stopPrice) {
                sellPrice = stopPrice; // Assume execução no preço do stop
                reason = params.useTrailingStop ? 'TRAILING STOP' : 'STOP LOSS';
            }

            // 4. Se Stop NÃO foi atingido, verifica Take Profit (pelo high da vela)
            // (Apenas se NÃO usar Trailing Stop)
            if (!reason && !params.useTrailingStop) {
                const takeProfitPrice = portfolio.lastBuyPrice * (1 + params.takeProfitPercentage / 100);
                if (highPrice >= takeProfitPrice) {
                    sellPrice = takeProfitPrice; // Assume execução no preço do TP
                    reason = 'TAKE PROFIT';
                }
            }

            // 5. Se NADA foi atingido, verifica Saída por Média Móvel (pelo close da vela)
            if (!reason && params.useMaExitFilter && closePrice < lastSma) {
                 sellPrice = closePrice; // Assume execução no fechamento
                 reason = 'MÉDIA MÓVEL';
            }

            // 6. Se alguma condição de venda foi satisfeita
            if (reason && sellPrice !== null) {
                const usdtReceived = portfolio.cryptoBalance * sellPrice;
                recordTrade(trades, portfolio.lastBuyTime, portfolio.lastBuyPrice, openTime, sellPrice, portfolio.cryptoBalance, reason);

                // Reseta portfólio
                portfolio.isOpened = false;
                portfolio.lastBuyPrice = 0;
                portfolio.lastBuyTime = 0;
                portfolio.cryptoBalance = 0;
                portfolio.usdtBalance = usdtReceived; // Assume que o USDT recebido na venda está disponível imediatamente
                portfolio.peakPrice = 0; // Reseta pico
            }
             // Se não vendeu, continua na posição para a próxima vela
        } // Fim da lógica de venda


        // --- LÓGICA DE COMPRA (Executada APÓS a lógica de venda na mesma vela) ---
        // Só tenta comprar se NÃO estiver em posição (pode ter acabado de vender)
        if (!portfolio.isOpened) {
            const rsiCondition = lastRsi <= params.rsiOversold;
            const maCondition = !params.useMaFilter || (params.useMaFilter && closePrice > lastSma);

            if (rsiCondition && maCondition) {
                // Simula compra no preço de fechamento da vela atual
                const amountToSpend = portfolio.usdtBalance; // Simula usar 100% do capital disponível
                // Idealmente, deveríamos buscar minNotional/minQty aqui, mas simplificamos por enquanto
                const quantityBought = amountToSpend / closePrice;

                portfolio.isOpened = true;
                portfolio.lastBuyPrice = closePrice;
                portfolio.lastBuyTime = openTime; // Guarda o tempo da compra
                portfolio.cryptoBalance = quantityBought;
                portfolio.usdtBalance = 0;
                portfolio.peakPrice = closePrice; // Inicia pico para TSL

                console.log(`[${new Date(openTime).toISOString().substring(0,19)}] COMPRA @ ${closePrice.toFixed(4)} | RSI: ${lastRsi.toFixed(2)} | Saldo: ${initialCapital.toFixed(2)} -> 0`); // Mostra mudança de saldo
            }
        } // Fim da lógica de compra

    } // Fim do loop principal

    console.log("Simulação de backtest concluída.");

    // Calcula balanço final
    let finalBalance = portfolio.usdtBalance;
    if (portfolio.isOpened) {
        const lastClosePrice = parseFloat(klines[klines.length - 1][4]);
        finalBalance += portfolio.cryptoBalance * lastClosePrice;
         console.log(`Terminou em posição. Valor final estimado da posição: ${(portfolio.cryptoBalance * lastClosePrice).toFixed(2)}`);
    }

    return {
        trades: trades,
        finalBalance: finalBalance,
        performance: {} // Placeholder para métricas
    };
}

module.exports = { runBacktest };