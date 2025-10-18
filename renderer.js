const { ipcRenderer } = require('electron');

const symbolSelect = document.getElementById('symbol-select');
const startButton = document.getElementById('start-button');
const rsiInput = document.getElementById('rsi-input');
const tpInput = document.getElementById('tp-input');
const slInput = document.getElementById('sl-input');
const tslInput = document.getElementById('tsl-input');
const trailingStopToggle = document.getElementById('trailing-stop-toggle');
const logContainer = document.getElementById('logs');
const statusSymbolEl = document.getElementById('status-symbol');
const statusRsiEl = document.getElementById('status-rsi');
const statusMaEl = document.getElementById('status-ma');
const statusPriceEl = document.getElementById('status-price');
const isOpenedEl = document.getElementById('is-opened');
const positionQtyEl = document.getElementById('position-qty');
const buyPriceEl = document.getElementById('buy-price');
const totalProfitEl = document.getElementById('total-profit');
const balanceUsdtEl = document.getElementById('balance-usdt');
const actionButton = document.getElementById('action-button');
const assetIcon = document.getElementById('asset-icon');
const statsTotalTradesEl = document.getElementById('stats-total-trades');
const statsWinRateEl = document.getElementById('stats-win-rate');
const statsProfitFactorEl = document.getElementById('stats-profit-factor');
const maFilterToggle = document.getElementById('ma-filter-toggle');

let lastPrice = 0;

const ctx = document.getElementById('priceChart').getContext('2d');
const priceChart = new Chart(ctx, { type: 'line', data: { labels: [], datasets: [{ label: 'Preço', data: [], borderColor: '#f1b30a', backgroundColor: 'rgba(241, 179, 10, 0.1)', borderWidth: 2, pointRadius: 0, tension: 0.1, fill: true }] }, options: { responsive: true, maintainAspectRatio: false, scales: { x: { ticks: { color: '#7d8590', maxRotation: 0, autoSkip: true, maxTicksLimit: 7 }, grid: { color: 'rgba(125, 133, 144, 0.1)' } }, y: { ticks: { color: '#7d8590' }, grid: { color: 'rgba(125, 133, 144, 0.1)' }, suggestedMin: 0, suggestedMax: 100 } }, plugins: { legend: { display: false } } } });

const p = document.createElement('p');
p.textContent = `[${new Date().toLocaleTimeString()}] Bem-vindo ao Phobos Engine! Por favor, selecione um ativo para iniciar.`;
p.className = 'log-default';
logContainer.prepend(p);

ipcRenderer.on('config-loaded', (event, config) => {
    rsiInput.value = config.rsiOversold;
    tpInput.value = config.takeProfitPercentage;
    slInput.value = config.stopLossPercentage;
    tslInput.value = config.trailingStopPercentage;
    trailingStopToggle.checked = config.useTrailingStop;
    maFilterToggle.checked = config.useMaFilter;
});

ipcRenderer.on('symbols-loaded', (event, symbols) => {
    symbolSelect.innerHTML = '<option value="">-- Selecione um par --</option>';
    symbols.forEach(symbol => {
        const option = document.createElement('option');
        option.value = symbol;
        option.textContent = symbol;
        symbolSelect.appendChild(option);
    });
});

startButton.addEventListener('click', () => {
    const selectedSymbol = symbolSelect.value;
    if (selectedSymbol) {
        const settings = {
            symbol: selectedSymbol,
            rsiOversold: parseInt(rsiInput.value, 10),
            takeProfitPercentage: parseFloat(tpInput.value),
            stopLossPercentage: parseFloat(slInput.value),
            trailingStopPercentage: parseFloat(tslInput.value),
            useTrailingStop: trailingStopToggle.checked,
            useMaFilter: maFilterToggle.checked
        };
        document.getElementById('setup').classList.add('hidden');
        document.getElementById('dashboard').classList.remove('hidden');
        ipcRenderer.send('start-monitoring', settings);
    }
});

actionButton.addEventListener('click', () => {
    if (actionButton.textContent === 'Voltar ao Início') {
        window.location.reload();
    } else {
        ipcRenderer.send('primary-action-button-clicked');
    }
});

ipcRenderer.on('log-message', (event, message) => {
    const p = document.createElement('p');
    p.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    if (message.includes('COMPRA')) p.className = 'log-buy';
    else if (message.includes('LUCRO')) p.className = 'log-sell-profit';
    else if (message.includes('PERDA') || message.includes('Liquidando') || message.includes('parado')) p.className = 'log-sell-loss';
    else if (message.includes('Erro')) p.className = 'log-error';
    else p.className = 'log-default';
    logContainer.prepend(p);
});

// renderer.js

ipcRenderer.on('update-data', (event, data) => {
    // Desestrutura os dados principais
    const { price, lastRsi, lastSma, portfolio, balances, klines, isMonitoringActive, sessionStats } = data;
    
    // ***** INÍCIO DA CORREÇÃO *****
    // Puxa o 'symbol' de dentro do 'sessionSettings'
    const { symbol } = data.sessionSettings || {}; 
    // ***** FIM DA CORREÇÃO *****

    const baseAsset = symbol ? symbol.replace("USDT", "") : '';

    if (baseAsset) {
        assetIcon.src = `./assets/default.png`; // Você precisará ter essa pasta/imagem
        assetIcon.onerror = () => { assetIcon.src = './assets/default.png'; }; // Fallback
        assetIcon.classList.remove('hidden');
    } else {
        assetIcon.classList.add('hidden');
    }

    // Esta verificação agora vai funcionar
    if (price !== undefined && lastRsi !== undefined && symbol && lastSma !== undefined) { 
        statusPriceEl.classList.remove('positive', 'negative');
        if (price > lastPrice && lastPrice !== 0) statusPriceEl.classList.add('positive');
        if (price < lastPrice) statusPriceEl.classList.add('negative');
        
        lastPrice = price;
        statusSymbolEl.textContent = symbol;
        statusRsiEl.textContent = lastRsi.toFixed(2);
        statusMaEl.textContent = `$${lastSma.toFixed(2)}`;
        statusPriceEl.textContent = `$${price.toFixed(2)}`;
    }
    if (portfolio) {
        isOpenedEl.textContent = portfolio.isOpened ? 'Sim' : 'Não';
        positionQtyEl.textContent = portfolio.cryptoBalance.toFixed(8);
        buyPriceEl.textContent = `$${portfolio.lastBuyPrice.toFixed(2)}`;
        totalProfitEl.textContent = `$${portfolio.totalProfitUsdt.toFixed(2)}`;
        totalProfitEl.classList.remove('positive', 'negative');
        if (portfolio.totalProfitUsdt > 0) totalProfitEl.classList.add('positive');
        if (portfolio.totalProfitUsdt < 0) totalProfitEl.classList.add('negative');
    }
    if (balances) {
        const usdtBalance = balances.find(b => b.asset === 'USDT')?.free || 0;
        balanceUsdtEl.textContent = `$${parseFloat(usdtBalance).toFixed(2)}`;
    }
    const actionButton = document.getElementById('action-button');
    if (portfolio && portfolio.isOpened) {
        actionButton.textContent = 'Liquidar Posição';
        actionButton.className = 'liquidate';
        actionButton.classList.remove('hidden');
    } else if (isMonitoringActive) {
        actionButton.textContent = 'Parar Monitoramento';
        actionButton.className = 'stop';
        actionButton.classList.remove('hidden');
    } else if (isMonitoringActive === false && document.getElementById('dashboard').classList.contains('hidden') === false) {
        actionButton.textContent = 'Voltar ao Início';
        actionButton.className = 'restart';
        actionButton.classList.remove('hidden');
    } else {
        actionButton.classList.add('hidden');
    }
    if (klines && klines.length > 0) {
        const labels = klines.map(k => new Date(k[0]).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
        const prices = klines.map(k => parseFloat(k[4]));
        priceChart.data.labels = labels;
        priceChart.data.datasets[0].data = prices;
        priceChart.options.scales.y.suggestedMin = null;
        priceChart.options.scales.y.suggestedMax = null;
        priceChart.update('none');
    }
    if (sessionStats) {
        statsTotalTradesEl.textContent = sessionStats.totalTrades;
        const winRate = sessionStats.totalTrades > 0 ? (sessionStats.wins / sessionStats.totalTrades) * 100 : 0;
        statsWinRateEl.textContent = `${winRate.toFixed(1)}%`;
        const profitFactor = sessionStats.totalLoss > 0 ? sessionStats.totalProfit / sessionStats.totalLoss : 0;
        statsProfitFactorEl.textContent = profitFactor.toFixed(2);
    }
});