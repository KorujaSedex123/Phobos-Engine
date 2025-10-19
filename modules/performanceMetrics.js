// modules/performanceMetrics.js

function calculate(trades, initialCapital) {
    if (!trades || trades.length === 0) {
        return {
            totalTrades: 0,
            wins: 0,
            losses: 0,
            winRate: 0,
            totalProfit: 0,
            totalLoss: 0,
            profitFactor: 0,
            maxDrawdown: 0, // Placeholder
            maxDrawdownPercent: 0, // Placeholder
            equityCurve: [initialCapital] // Placeholder
        };
    }

    let wins = 0;
    let losses = 0;
    let totalProfit = 0; // Soma dos lucros de trades vencedores
    let totalLoss = 0; // Soma das perdas (valor absoluto) de trades perdedores

    // Para Drawdown e Curva de Patrimônio
    let equityCurve = [initialCapital]; // Começa com o capital inicial
    let currentEquity = initialCapital;
    let peakEquity = initialCapital; // Pico de patrimônio até agora
    let maxDrawdown = 0; // Drawdown máximo em valor monetário

    trades.forEach(trade => {
        if (trade.profit > 0) {
            wins++;
            totalProfit += trade.profit;
        } else {
            losses++;
            totalLoss += Math.abs(trade.profit);
        }

        // Atualiza curva de patrimônio e calcula drawdown
        currentEquity += trade.profit;
        equityCurve.push(currentEquity);

        if (currentEquity > peakEquity) {
            peakEquity = currentEquity; // Novo pico
        }

        const drawdown = peakEquity - currentEquity; // Drawdown atual em valor
        if (drawdown > maxDrawdown) {
            maxDrawdown = drawdown; // Atualiza drawdown máximo em valor
        }
    });

    const totalTrades = trades.length;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : (totalProfit > 0 ? Infinity : 0);

    // Calcula Drawdown Máximo Percentual (baseado no pico que o originou)
    // Encontra o pico que levou ao maxDrawdown
    let peakEquityBeforeMaxDD = initialCapital;
    currentEquity = initialCapital; // Reinicia para recalcular picos
    for(const equityPoint of equityCurve) {
         if (equityPoint > peakEquityBeforeMaxDD) {
             peakEquityBeforeMaxDD = equityPoint;
         }
         const currentDD = peakEquityBeforeMaxDD - equityPoint;
         if (currentDD >= maxDrawdown) { // Usa >= para pegar o primeiro pico se houver platôs
             // Achamos (ou passamos) o ponto do maxDrawdown, o pico era peakEquityBeforeMaxDD
             break; // Para no pico correto
         }
    }
    const maxDrawdownPercent = peakEquityBeforeMaxDD > 0 ? (maxDrawdown / peakEquityBeforeMaxDD) * 100 : 0;


    return {
        totalTrades: totalTrades,
        wins: wins,
        losses: losses,
        winRate: winRate,
        totalProfit: totalProfit, // Lucro bruto total dos vencedores
        totalLoss: totalLoss,     // Perda bruta total dos perdedores
        profitFactor: profitFactor,
        maxDrawdown: maxDrawdown,         // Valor monetário do maior drawdown
        maxDrawdownPercent: maxDrawdownPercent, // Percentual do maior drawdown
        equityCurve: equityCurve          // Histórico do patrimônio trade a trade
    };
}

module.exports = { calculate };