// modules/advancedTester.js
const fs = require('fs');
const path = require('path');
const binanceService = require('./binanceService');
const backtesterEngine = require('./backtesterEngine');
const performanceMetrics = require('./performanceMetrics');
const backtestBaseConfig = require('../backtest_config.json');

/**
 * Converte string YYYY-MM-DD para timestamp Unix em milissegundos (UTC).
 */
function dateToTimestamp(dateString, isEndDate = false) {
    const time = isEndDate ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
    const timestamp = new Date(dateString + time).getTime();
    if (!dateString || isNaN(timestamp)) {
        return NaN;
    }
    return timestamp;
}

/**
 * Executa a otimização de parâmetros num conjunto de dados (Klines).
 */
async function runOptimization(klines, runConfigBase, baseStrategy, optimizationParamsConfig, optimizationMetric, sortOrder, logger) {
    logger.log(`[Optimizer] Iniciando otimização com ${klines.length} klines...`);
    logger.log(`[Optimizer] Parâmetros a otimizar: ${Object.keys(optimizationParamsConfig).join(', ')}`);
    logger.log(`[Optimizer] Métrica alvo: ${optimizationMetric} (${sortOrder})`);

    // --- 1. Gera Combinações de Parâmetros ---
    const paramCombinations = [];
    const rsiConfig = optimizationParamsConfig.rsiOversold;
    const slConfig = optimizationParamsConfig.stopLossPercentage;

    if (!rsiConfig || !slConfig) {
        logger.log("ERRO: Configuração de otimização incompleta (rsiOversold e stopLossPercentage são necessários).", 'log-error');
        return null;
    }
    let rsiValue = rsiConfig.start;
    while (rsiValue <= rsiConfig.end) {
        let slValue = slConfig.start;
        while (slValue <= slConfig.end) {
            paramCombinations.push({
                rsiOversold: rsiValue,
                stopLossPercentage: parseFloat(slValue.toFixed(2))
            });
            slValue += slConfig.step;
        }
        rsiValue += rsiConfig.step;
    }
    logger.log(`[Optimizer] Total de combinações a testar: ${paramCombinations.length}`);
    if (paramCombinations.length === 0) {
        logger.log("AVISO: Nenhuma combinação de parâmetros gerada.", 'log-error');
        return null;
    }

    // --- 2. Roda Backtest para Cada Combinação ---
    const results = [];
    let count = 0;
    const totalCombinations = paramCombinations.length;
    for (const params of paramCombinations) {
        count++;
        const currentStrategy = { ...baseStrategy, ...params };
        const currentRunConfig = { ...runConfigBase, strategy: currentStrategy };
        const backtestResult = backtesterEngine.runBacktest(klines, currentRunConfig);
        const metrics = performanceMetrics.calculate(
            backtestResult.trades,
            runConfigBase.initialCapital,
            backtestResult.finalBalance,
            backtestResult.equity
        );
        const metricValue = metrics[optimizationMetric];
        const comparableMetricValue = (metricValue === Infinity)
           ? Number.MAX_SAFE_INTEGER
           : (isNaN(metricValue) ? (sortOrder === 'desc' ? -Infinity : Infinity) : metricValue);
        results.push({
            params: currentStrategy,
            metricValue: comparableMetricValue,
            netProfit: metrics.netProfit,
            profitFactor: metrics.profitFactor,
            winRate: metrics.winRate,
            maxDrawdownPercent: metrics.maxDrawdownPercent,
            totalTrades: metrics.totalTrades
       });
        const progress = ((count / totalCombinations) * 100).toFixed(1);
        if (count % Math.max(1, Math.floor(totalCombinations / 20)) === 0 || count === totalCombinations) {
           logger.log(`[Optimizer] Progresso: ${progress}% (${count}/${totalCombinations})`);
        }
    }
    logger.log("[Optimizer] Backtests de otimização concluídos.");

    // --- 3. Ordena os Resultados ---
    results.sort((a, b) => {
        if (sortOrder === 'desc') { return b.metricValue - a.metricValue; }
        else { return a.metricValue - b.metricValue; }
    });

    // --- 4. Retorna o Melhor Resultado ---
    if (results.length > 0 && results[0].metricValue !== -Infinity && results[0].metricValue !== Infinity ) {
        const bestResult = results[0];
        const bestMetricDisplayValue = bestResult.metricValue === Number.MAX_SAFE_INTEGER ? Infinity : bestResult.metricValue;
        logger.log(`[Optimizer] Melhor combinação encontrada: RSI=${bestResult.params.rsiOversold}, SL=${bestResult.params.stopLossPercentage} | ${optimizationMetric}=${bestMetricDisplayValue?.toFixed(2) ?? 'N/A'}`);
        return {
            bestParams: bestResult.params,
            bestMetricValue: bestMetricDisplayValue
        };
    } else {
        logger.log("[Optimizer] ERRO: Nenhum resultado válido encontrado após otimização.", 'log-error');
        return null;
    }
}


/**
 * Executa um teste Out-of-Sample (OOS).
 */
async function performOOSTest(config, logger) {
    logger.log("[AdvancedTester] Iniciando Teste OOS...");

    // --- 1. Validação e Preparação ---
    const { symbol, isStartDate, isEndDate, oosStartDate, oosEndDate } = config;
    const isStartTime = dateToTimestamp(isStartDate);
    const isEndTime = dateToTimestamp(isEndDate, true);
    const oosStartTime = dateToTimestamp(oosStartDate);
    const oosEndTime = dateToTimestamp(oosEndDate, true);
    if (isNaN(isStartTime) || isNaN(isEndTime) || isNaN(oosStartTime) || isNaN(oosEndTime)) { throw new Error("Formato de data inválido. Use YYYY-MM-DD."); }
    if (isStartTime >= isEndTime || oosStartTime >= oosEndTime) { throw new Error("Data de início deve ser anterior à data de fim para ambos os períodos."); }
    if (isEndTime >= oosStartTime) { logger.log(`AVISO: Período In-Sample (até ${isEndDate}) sobrepõe-se ou termina depois do início Out-of-Sample (${oosStartDate}).`); }
    const runConfigBase = {
        initialCapital: backtestBaseConfig.initialCapital,
        feeRate: backtestBaseConfig.feeRate,
        slippagePercent: backtestBaseConfig.slippagePercent,
        fixedTradeAmountUSD: backtestBaseConfig.fixedTradeAmountUSD,
        symbol: symbol
    };
    logger.log(`Config Base: Capital=$${runConfigBase.initialCapital}, Taxa=${runConfigBase.feeRate * 100}%, Slippage=${runConfigBase.slippagePercent * 100}%, Valor Fixo=$${runConfigBase.fixedTradeAmountUSD}`);

    // --- 2. Buscar Dados Históricos In-Sample (IS) ---
    logger.log(`Buscando dados IS para ${symbol} de ${isStartDate} a ${isEndDate}...`);
    let isKlines;
    try {
        isKlines = await binanceService.getHistoricalKlines(symbol, '1m', isStartTime, isEndTime);
        if (!isKlines || isKlines.length === 0) throw new Error("Nenhum dado IS encontrado.");
        logger.log(` -> ${isKlines.length} klines IS recebidos.`);
    } catch (error) { throw new Error(`Falha ao buscar dados IS: ${error.message}`); }

    // --- 3. Executar Otimização In-Sample ---
    const optimizationParamsConfig = {
        rsiOversold: { start: 29, end: 40, step: 2 },
        stopLossPercentage: { start: 1, end: 5, step: 0.5 }
    };
    const optimizationMetric = 'profitFactor';
    const sortOrder = 'desc';
    const baseStrategyForOpt = {
        ...backtestBaseConfig.strategy,
        useTrailingStop: false,
        useMaExitFilter: false
    };
    const optimizationResult = await runOptimization( isKlines, runConfigBase, baseStrategyForOpt, optimizationParamsConfig, optimizationMetric, sortOrder, logger );
    if (!optimizationResult || !optimizationResult.bestParams) { throw new Error("Otimização In-Sample não encontrou parâmetros válidos."); }
    const bestParamsStrategy = optimizationResult.bestParams;
    const bestMetricValueIS = optimizationResult.bestMetricValue;

    // --- 4. Buscar Dados Históricos Out-of-Sample (OOS) ---
    logger.log(`Buscando dados OOS para ${symbol} de ${oosStartDate} a ${oosEndDate}...`);
    let oosKlines;
    try {
        oosKlines = await binanceService.getHistoricalKlines(symbol, '1m', oosStartTime, oosEndTime);
        if (!oosKlines || oosKlines.length === 0) throw new Error("Nenhum dado OOS encontrado.");
        logger.log(` -> ${oosKlines.length} klines OOS recebidos.`);
    } catch (error) { throw new Error(`Falha ao buscar dados OOS: ${error.message}`); }

    // --- 5. Executar Backtest Out-of-Sample ---
    logger.log("Executando backtest Out-of-Sample com os melhores parâmetros IS...");
    const oosRunConfig = { ...runConfigBase, strategy: bestParamsStrategy };
    const oosResult = backtesterEngine.runBacktest(oosKlines, oosRunConfig);

    // --- 6. Calcular Métricas OOS ---
    logger.log("Calculando métricas Out-of-Sample...");
    const oosMetrics = performanceMetrics.calculate( oosResult.trades, oosRunConfig.initialCapital, oosResult.finalBalance, oosResult.equity );

    // --- 7. Retornar Resultados ---
    logger.log("Teste OOS concluído.");

    // ***** INÍCIO DA CORREÇÃO *****
    // Adiciona verificações e valores padrão (0) antes de chamar .toFixed()
    const safeMetrics = {
        netProfit: (oosMetrics.netProfit ?? 0).toFixed(2),
        netProfitPercent: (oosMetrics.netProfitPercent ?? 0).toFixed(2),
        totalTrades: oosMetrics.totalTrades ?? 0,
        winRate: (oosMetrics.winRate ?? 0).toFixed(1),
        // Trata Infinity separadamente para profitFactor e payoffRatio
        profitFactor: oosMetrics.profitFactor === Infinity ? 'Infinity' : (oosMetrics.profitFactor ?? 0).toFixed(2),
        expectancy: (oosMetrics.expectancy ?? 0).toFixed(2),
        maxDrawdown: (oosMetrics.maxDrawdown ?? 0).toFixed(2),
        maxDrawdownPercent: (oosMetrics.maxDrawdownPercent ?? 0).toFixed(2),
        avgWin: (oosMetrics.avgWin ?? 0).toFixed(2),
        avgLoss: (oosMetrics.avgLoss ?? 0).toFixed(2),
        payoffRatio: oosMetrics.payoffRatio === Infinity ? 'Infinity' : (oosMetrics.payoffRatio ?? 0).toFixed(2),
    };
    // ***** FIM DA CORREÇÃO *****

    return {
        symbol: symbol,
        periodo_is: `${isStartDate} a ${isEndDate}`,
        periodo_oos: `${oosStartDate} a ${oosEndDate}`,
        parametros_otimizados_is: {
             rsiOversold: bestParamsStrategy.rsiOversold,
             stopLossPercentage: bestParamsStrategy.stopLossPercentage
        },
        metrica_otimizacao_is: `${optimizationMetric} = ${bestMetricValueIS === Infinity ? 'Infinity' : bestMetricValueIS.toFixed(2)}`,
        // Usa as métricas seguras formatadas
        metricas_oos: safeMetrics
    };
}


// --- Placeholder para performMonteCarlo ---
async function performMonteCarlo(config, logger) {
    logger.log("[AdvancedTester] Função performMonteCarlo chamada (ainda não implementada).");
    await new Promise(resolve => setTimeout(resolve, 1000));
    return { message: "Monte Carlo ainda não implementado." };
}
// --- FIM Placeholder ---


module.exports = {
    performOOSTest,
    performMonteCarlo
};