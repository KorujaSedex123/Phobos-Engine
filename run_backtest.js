// run_backtest.js
const fs = require('fs');
const path = require('path'); // <<< CORREÇÃO: Adiciona a importação do módulo 'path'
const binanceService = require('./modules/binanceService');
const backtesterEngine = require('./modules/backtesterEngine');
const performanceMetrics = require('./modules/performanceMetrics');

async function main() {
    console.log("--- Iniciando Script de Backtest ---");

    // 1. Carrega Configuração
    let config;
    try {
        // Agora path.join vai funcionar corretamente
        const configPath = path.join(__dirname, 'backtest_config.json');
        console.log(`Tentando carregar configuração de: ${configPath}`);
        const configFile = fs.readFileSync(configPath, 'utf-8');
        config = JSON.parse(configFile);
        console.log("Configuração de backtest carregada:");
        console.log(` -> Ativo: ${config.symbol}`);
        console.log(` -> Período: ${config.startDate} a ${config.endDate}`);
        console.log(` -> Capital Inicial: $${config.initialCapital}`);
        console.log(" -> Estratégia:", config.strategy);
    } catch (error) {
        console.error("Erro ao ler ou parsear backtest_config.json:", error.message);
        console.error("Verifique se o arquivo existe na raiz do projeto e está no formato JSON correto.");
        return; // Aborta o script
    }

    // 2. Converte Datas para Timestamps Unix (milissegundos)
    const startTime = new Date(config.startDate + 'T00:00:00Z').getTime(); // Assume UTC
    const endTime = new Date(config.endDate + 'T23:59:59Z').getTime(); // Assume UTC
    if (isNaN(startTime) || isNaN(endTime) || startTime >= endTime) {
        console.error("Datas de início/fim inválidas no backtest_config.json. Use o formato YYYY-MM-DD e garanta que startDate < endDate.");
        return;
    }
    console.log(`Timestamps (UTC): ${startTime} (${config.startDate}) a ${endTime} (${config.endDate})`);


    // 3. Inicializa Binance Service
    require('dotenv').config(); // Carrega .env
    try {
        binanceService.init();
    } catch (error) {
        console.error("Erro ao inicializar o serviço da Binance:", error.message);
        console.error("Verifique se as chaves API_KEY e API_SECRET estão corretas no arquivo .env.");
        return;
    }


    // 4. Busca Dados Históricos da Binance
    let historicalKlines;
    try {
        console.log("Buscando dados históricos da Binance (intervalo 1m)... Isso pode levar um momento.");
        historicalKlines = await binanceService.getHistoricalKlines(config.symbol, '1m', startTime, endTime);
    } catch (error) {
        console.error("Falha ao buscar dados históricos da Binance. Abortando backtest.");
        return;
    }

    if (!historicalKlines || historicalKlines.length === 0) {
        console.error(`Nenhum dado histórico (kline) encontrado para ${config.symbol} no período de ${config.startDate} a ${config.endDate}.`);
        console.error("Verifique se o símbolo está correto e se há dados disponíveis na Binance para esse período.");
        return;
    }


    // 5. Roda o Backtest Engine
    console.log(`\nIniciando simulação com ${historicalKlines.length} klines...`);
    const results = backtesterEngine.runBacktest(historicalKlines, config.strategy, config.initialCapital);


    // 6. Calcula Métricas Detalhadas
    const metrics = performanceMetrics.calculate(results.trades, config.initialCapital);


    // 7. Exibe Resultados Completos e Métricas
    console.log("\n--- ============================ ---");
    console.log("---   RESULTADOS DO BACKTEST   ---");
    console.log("--- ============================ ---");
    console.log(` Período Analisado: ${config.startDate} a ${config.endDate}`);
    console.log(` Ativo Simulado...: ${config.symbol}`);
    console.log(` Capital Inicial..: $${config.initialCapital.toFixed(2)}`);
    console.log(` Saldo Final......: $${results.finalBalance.toFixed(2)}`);

    const totalNetProfit = results.finalBalance - config.initialCapital;
    const totalNetProfitPercent = (totalNetProfit / config.initialCapital) * 100;
    console.log(` Lucro/Prej. Líq..: $${totalNetProfit.toFixed(2)} (${totalNetProfitPercent.toFixed(2)}%)`);

    console.log("\n--- Métricas de Performance ---");
    console.log(` Total de Trades..: ${metrics.totalTrades}`);
    console.log(` Trades Vencedores: ${metrics.wins}`);
    console.log(` Trades Perdedores: ${metrics.losses}`);
    console.log(` Taxa de Acerto...: ${metrics.winRate.toFixed(1)}%`);
    console.log(` Lucro Bruto Total: $${metrics.totalProfit.toFixed(2)} (Soma dos ganhos)`);
    console.log(` Prejuízo Bruto T.: $${metrics.totalLoss.toFixed(2)} (Soma das perdas)`);
    console.log(` Profit Factor....: ${metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)} (Lucro Bruto / Prejuízo Bruto)`);
    console.log(` Máximo Drawdown..: $${metrics.maxDrawdown.toFixed(2)} (${metrics.maxDrawdownPercent.toFixed(2)}%) (Maior queda do pico)`);

    // Opcional: Salvar resultados em arquivos
    try {
        // fs.writeFileSync('backtest_trades.json', JSON.stringify(results.trades, null, 2));
        // fs.writeFileSync('backtest_equity_curve.json', JSON.stringify(metrics.equityCurve, null, 2));
        // console.log("\nArquivos de resultado salvos (descomente para ativar).");
    } catch(error){
        console.warn("Aviso: Falha ao salvar arquivos de resultado.", error.message);
    }

    console.log("\n--- Fim do Script de Backtest ---");
}

main().catch(error => {
    console.error("\n !!! ERRO INESPERADO NO SCRIPT PRINCIPAL !!!");
    console.error(error);
    process.exit(1); // Encerra com código de erro
});