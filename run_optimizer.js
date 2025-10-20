// run_optimizer.js
const fs = require('fs');
const path = require('path');
const binanceService = require('./modules/binanceService');
const backtesterEngine = require('./modules/backtesterEngine');
const performanceMetrics = require('./modules/performanceMetrics');

// --- Configurações da Otimização (Usando os exemplos) ---
const optimizeParams = {
    rsiOversold: { start: 20, end: 40, step: 2 },
    stopLossPercentage: { start: 1, end: 5, step: 0.5 }
    // Adicione mais parâmetros aqui se desejar (ex: takeProfitPercentage)
};

// Métrica para otimizar (o que queremos maximizar/minimizar?)
const optimizationMetric = 'totalNetProfit'; // Maximizar Lucro Líquido Total
const sortOrder = 'desc'; // 'desc' para maximizar

const topResultsToShow = 10; // Mostrar os 10 melhores
// --- Fim das Configurações ---


async function main() {
    console.log("--- Iniciando Script de Otimização de Parâmetros ---");

    // 1. Carrega Configuração Base do Backtest
    let baseConfig;
    try {
        const configPath = path.join(__dirname, 'backtest_config.json');
        console.log(`Tentando carregar configuração de: ${configPath}`);
        const configFile = fs.readFileSync(configPath, 'utf-8');
        baseConfig = JSON.parse(configFile);
        console.log("Configuração de backtest carregada:");
        console.log(` -> Ativo: ${baseConfig.symbol}`);
        console.log(` -> Período: ${baseConfig.startDate} a ${baseConfig.endDate}`);
        console.log(` -> Capital Inicial: $${baseConfig.initialCapital}`);
        // Força useTrailingStop = false para esta otimização inicial (simplificação)
        baseConfig.strategy.useTrailingStop = false;
        baseConfig.strategy.useMaExitFilter = false; // Desativa MA Exit também para isolar SL/RSI
        console.log(" -> Estratégia Base (TP/MA Filter):", {
            takeProfitPercentage: baseConfig.strategy.takeProfitPercentage,
            useMaFilter: baseConfig.strategy.useMaFilter,
            maPeriod: baseConfig.strategy.maPeriod,
            rsiPeriod: baseConfig.strategy.rsiPeriod
         });
        console.log(" -> AVISO: Otimização atual forçará 'useTrailingStop: false' e 'useMaExitFilter: false'.");
    } catch (error) {
        console.error("Erro ao ler ou parsear backtest_config.json:", error.message);
        console.error("Verifique se o arquivo existe na raiz do projeto e está no formato JSON correto.");
        return;
    }

    // 2. Converte Datas para Timestamps
    const startTime = new Date(baseConfig.startDate + 'T00:00:00Z').getTime();
    const endTime = new Date(baseConfig.endDate + 'T23:59:59Z').getTime();
    if (isNaN(startTime) || isNaN(endTime) || startTime >= endTime) {
        console.error("Datas inválidas."); return;
    }
    console.log(`Timestamps (UTC): ${startTime} (${baseConfig.startDate}) a ${endTime} (${baseConfig.endDate})`);


    // 3. Inicializa Binance Service
    require('dotenv').config();
    try {
        binanceService.init();
    } catch (error) {
        console.error("Erro Binance Service:", error.message); return;
    }

    // 4. Busca Dados Históricos (UMA VEZ)
    let historicalKlines;
    try {
        console.log("Buscando dados históricos...");
        historicalKlines = await binanceService.getHistoricalKlines(baseConfig.symbol, '1m', startTime, endTime);
    } catch (error) {
        console.error("Falha ao buscar dados históricos."); return;
    }
    if (!historicalKlines || historicalKlines.length === 0) {
        console.error("Nenhum dado histórico encontrado."); return;
    }
    console.log(`Dados históricos carregados (${historicalKlines.length} klines).`);


    // 5. Gera Combinações de Parâmetros
    const paramCombinations = [];
    let rsiValue = optimizeParams.rsiOversold.start;
    while (rsiValue <= optimizeParams.rsiOversold.end) {
        let slValue = optimizeParams.stopLossPercentage.start;
        while (slValue <= optimizeParams.stopLossPercentage.end) {
            paramCombinations.push({
                rsiOversold: rsiValue,
                stopLossPercentage: parseFloat(slValue.toFixed(2)) // Arredonda
            });
            slValue += optimizeParams.stopLossPercentage.step;
        }
        rsiValue += optimizeParams.rsiOversold.step;
    }

    console.log(`Total de combinações a testar: ${paramCombinations.length}`);

    // 6. Roda Backtest para Cada Combinação
    const results = [];
    console.log("Iniciando backtests...");
    let count = 0;
    const totalCombinations = paramCombinations.length;

    for (const params of paramCombinations) {
        count++;
        // Cria cópia da estratégia base e aplica parâmetros atuais
        const currentStrategy = {
            ...baseConfig.strategy,
            ...params
        };

        // Roda o backtest (sem logs internos para acelerar)
        // console.log(`\nTestando: RSI=${params.rsiOversold}, SL=${params.stopLossPercentage}%`); // Descomente para log detalhado
        const backtestResult = backtesterEngine.runBacktest(historicalKlines, currentStrategy, baseConfig.initialCapital);

        // Calcula métricas
        const metrics = performanceMetrics.calculate(backtestResult.trades, baseConfig.initialCapital);
        const netProfit = backtestResult.finalBalance - baseConfig.initialCapital;

        // Guarda resultado
        results.push({
            params: params,
            netProfit: netProfit,
            profitFactor: metrics.profitFactor,
            winRate: metrics.winRate,
            maxDrawdownPercent: metrics.maxDrawdownPercent,
            totalTrades: metrics.totalTrades
        });

        // Mostra progresso sem poluir muito o console
        const progress = ((count / totalCombinations) * 100).toFixed(1);
        process.stdout.write(`Progresso: ${progress}% (${count}/${totalCombinations}) \r`);
    }
    console.log("\nBacktests concluídos. Processando resultados...");


    // 7. Ordena os Resultados
    results.sort((a, b) => {
        let metricA = a[optimizationMetric];
        let metricB = b[optimizationMetric];

        // Trata Infinity no Profit Factor
        if (optimizationMetric === 'profitFactor') {
            metricA = (metricA === Infinity) ? Number.MAX_SAFE_INTEGER : metricA;
            metricB = (metricB === Infinity) ? Number.MAX_SAFE_INTEGER : metricB;
        }
        // Trata NaN ou valores inválidos (coloca no final)
        metricA = isNaN(metricA) ? (sortOrder === 'desc' ? -Infinity : Infinity) : metricA;
        metricB = isNaN(metricB) ? (sortOrder === 'desc' ? -Infinity : Infinity) : metricB;


        if (sortOrder === 'desc') {
            return metricB - metricA; // Descendente (maior é melhor)
        } else {
            return metricA - metricB; // Ascendente (menor é melhor)
        }
    });


    // 8. Exibe os Melhores Resultados
    console.log(`\n--- Top ${topResultsToShow} Melhores Combinações (Otimizando por: ${optimizationMetric} [${sortOrder}]) ---`);
    for (let i = 0; i < Math.min(topResultsToShow, results.length); i++) {
        const res = results[i];
        console.log(`\nRank #${i + 1}:`);
        console.log(`  Parâmetros: RSI Compra <= ${res.params.rsiOversold}, Stop Loss = ${res.params.stopLossPercentage}%`);
        console.log(`  Lucro Líquido..: $${res.netProfit.toFixed(2)}`);
        console.log(`  Profit Factor..: ${res.profitFactor === Number.MAX_SAFE_INTEGER ? '∞' : res.profitFactor.toFixed(2)}`);
        console.log(`  Taxa de Acerto.: ${res.winRate.toFixed(1)}%`);
        console.log(`  Max Drawdown...: ${res.maxDrawdownPercent.toFixed(2)}%`);
        console.log(`  Total Trades...: ${res.totalTrades}`);
    }

    console.log("\n--- Fim do Script de Otimização ---");
}

main().catch(error => {
    console.error("\n !!! ERRO INESPERADO NO OTIMIZADOR !!!");
    console.error(error);
    process.exit(1);
});