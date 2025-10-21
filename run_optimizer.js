// run_optimizer.js
const fs = require('fs');
const path = require('path');
const binanceService = require('./modules/binanceService'); //
// Importa a função de otimização do módulo advancedTester
const { runOptimization } = require('./modules/advancedTester'); //
// Importa performanceMetrics para exibir métricas adicionais do melhor resultado
const performanceMetrics = require('./modules/performanceMetrics'); //

// --- Configurações da Otimização (Mantém-se aqui para controlo do script) ---
const optimizationParamsConfig = {
    rsiOversold: { start: 20, end: 40, step: 2 },
    stopLossPercentage: { start: 1, end: 5, step: 0.5 }
    // Adicione mais parâmetros aqui se a função runOptimization for atualizada para os suportar
};

// Métrica para otimizar
const optimizationMetric = 'profitFactor'; // ou 'netProfit' ou outra métrica retornada por performanceMetrics
const sortOrder = 'desc'; // 'desc' para maximizar

const topResultsToShow = 1; // Mostrar apenas o melhor resultado aqui (a função já o encontra)
// --- Fim das Configurações ---


async function main() {
    console.log("--- Iniciando Script de Otimização de Parâmetros (Refatorado) ---");

    // 1. Carrega Configuração Base do Backtest
    let baseConfig;
    try {
        const configPath = path.join(__dirname, 'backtest_config.json'); //
        console.log(`Carregando configuração base de: ${configPath}`);
        const configFile = fs.readFileSync(configPath, 'utf-8');
        baseConfig = JSON.parse(configFile);
        console.log("Configuração base carregada:");
        console.log(` -> Ativo: ${baseConfig.symbol}`);
        console.log(` -> Período: ${baseConfig.startDate} a ${baseConfig.endDate}`);
        console.log(` -> Capital Inicial: $${baseConfig.initialCapital}`);
        console.log(` -> Taxa: ${baseConfig.feeRate * 100}%, Slippage: ${baseConfig.slippagePercent * 100}%, Valor Fixo: $${baseConfig.fixedTradeAmountUSD}`);
        // Força TSL e MA Exit off para isolar otimização RSI/SL (como antes)
        baseConfig.strategy.useTrailingStop = false;
        baseConfig.strategy.useMaExitFilter = false;
        console.log(" -> AVISO: Otimização atual forçará 'useTrailingStop: false' e 'useMaExitFilter: false'.");
    } catch (error) {
        console.error("Erro ao ler backtest_config.json:", error.message);
        return;
    }

    // 2. Converte Datas para Timestamps (Igual antes)
    const startTime = new Date(baseConfig.startDate + 'T00:00:00Z').getTime();
    const endTime = new Date(baseConfig.endDate + 'T23:59:59Z').getTime();
    if (isNaN(startTime) || isNaN(endTime) || startTime >= endTime) {
        console.error("Datas inválidas."); return;
    }
    console.log(`Timestamps (UTC): ${startTime} (${baseConfig.startDate}) a ${endTime} (${baseConfig.endDate})`);

    // 3. Inicializa Binance Service (Igual antes)
    require('dotenv').config();
    try {
        binanceService.init();
    } catch (error) {
        console.error("Erro Binance Service:", error.message); return;
    }

    // 4. Busca Dados Históricos (UMA VEZ - Igual antes)
    let historicalKlines;
    try {
        console.log(`Buscando dados históricos para ${baseConfig.symbol}...`);
        historicalKlines = await binanceService.getHistoricalKlines(baseConfig.symbol, '1m', startTime, endTime); //
    } catch (error) {
        console.error("Falha ao buscar dados históricos."); return;
    }
    if (!historicalKlines || historicalKlines.length === 0) {
        console.error("Nenhum dado histórico encontrado."); return;
    }
    console.log(`Dados históricos carregados (${historicalKlines.length} klines).`);

    // 5. Prepara Configuração Base para Backtests e Estratégia Base
     const runConfigBase = {
        initialCapital: baseConfig.initialCapital,
        feeRate: baseConfig.feeRate,
        slippagePercent: baseConfig.slippagePercent,
        fixedTradeAmountUSD: baseConfig.fixedTradeAmountUSD,
        symbol: baseConfig.symbol
    };
    const baseStrategyForOpt = {
        ...baseConfig.strategy, // Pega MA Period, RSI Period, useMaFilter, etc.
        useTrailingStop: false, // Força TSL off
        useMaExitFilter: false // Força MA Exit off
    };

    // 6. Cria um Logger Simples para a Função de Otimização
    const optimizerLogger = {
        log: (message, level = 'info') => {
            // Mapeia níveis se necessário, por agora apenas imprime no console
            if (level === 'log-error') {
                console.error(message);
            } else {
                // Imprime progresso e mensagens informativas
                 // Evita imprimir cada passo individual do backtest
                 if (!message.startsWith(' -> Teste')) {
                     console.log(message);
                 }
                 // Mostra progresso
                 if (message.startsWith('[Optimizer] Progresso:')) {
                      process.stdout.write(`${message}\r`);
                 } else if (message.includes('concluídos')) {
                      process.stdout.write('\n'); // Nova linha após progresso
                 }
            }
        }
    };


    // 7. Chama a Função de Otimização Refatorada
    console.log(`\nInvocando runOptimization de advancedTester.js...`);
    const optimizationResult = await runOptimization(
        historicalKlines,       // Dados
        runConfigBase,          // Config base (capital, taxas...)
        baseStrategyForOpt,     // Estratégia base (filtros fixos...)
        optimizationParamsConfig, // Ranges (RSI, SL)
        optimizationMetric,     // Métrica alvo
        sortOrder,              // Ordem
        optimizerLogger         // Logger
    ); //

    // 8. Exibe o Melhor Resultado
    if (optimizationResult && optimizationResult.bestParams) {
        console.log(`\n--- Melhor Combinação Encontrada (Otimizando por: ${optimizationMetric} [${sortOrder}]) ---`);
        const bestParams = optimizationResult.bestParams;
        const bestValue = optimizationResult.bestMetricValue;

        console.log(`\n Parâmetros: RSI Compra <= ${bestParams.rsiOversold}, Stop Loss = ${bestParams.stopLossPercentage}%`);
        console.log(` Valor da Métrica (${optimizationMetric}): ${bestValue === Infinity ? '∞' : bestValue.toFixed(2)}`);

        // Opcional: Re-rodar o backtest com os melhores params para obter todas as métricas
        console.log("\n Re-executando backtest com os melhores parâmetros para métricas completas...");
        const finalRunConfig = { ...runConfigBase, strategy: bestParams };
        const finalBacktestResult = backtesterEngine.runBacktest(historicalKlines, finalRunConfig); //
        const finalMetrics = performanceMetrics.calculate(
            finalBacktestResult.trades,
            finalRunConfig.initialCapital,
            finalBacktestResult.finalBalance,
            finalBacktestResult.equity
        ); //

        console.log(`\n--- Métricas Completas da Melhor Combinação ---`);
        console.log(` Lucro Líquido..: $${finalMetrics.netProfit.toFixed(2)} (${finalMetrics.netProfitPercent.toFixed(2)}%)`);
        console.log(` Total Trades...: ${finalMetrics.totalTrades}`);
        console.log(` Taxa de Acerto.: ${finalMetrics.winRate.toFixed(1)}%`);
        console.log(` Profit Factor..: ${finalMetrics.profitFactor === Infinity ? '∞' : finalMetrics.profitFactor.toFixed(2)}`);
        console.log(` Expectativa....: $${finalMetrics.expectancy.toFixed(2)}`);
        console.log(` Max Drawdown...: ${finalMetrics.maxDrawdownPercent.toFixed(2)}% ($${finalMetrics.maxDrawdown.toFixed(2)})`);
        console.log(` Payoff Ratio...: ${finalMetrics.payoffRatio === Infinity ? '∞' : finalMetrics.payoffRatio.toFixed(2)}`);

    } else {
        console.log("\nOtimização concluída, mas nenhum resultado válido foi encontrado.");
    }

    console.log("\n--- Fim do Script de Otimização ---");
}

main().catch(error => {
    console.error("\n !!! ERRO INESPERADO NO SCRIPT OTIMIZADOR !!!");
    console.error(error);
    process.exit(1);
});