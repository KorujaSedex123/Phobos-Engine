// testing-renderer.js
const { ipcRenderer } = require('electron');

// Elementos da UI
const oosSymbolSelect = document.getElementById('oos-symbol');
const isStartDateInput = document.getElementById('is-start-date');
const isEndDateInput = document.getElementById('is-end-date');
const oosStartDateInput = document.getElementById('oos-start-date');
const oosEndDateInput = document.getElementById('oos-end-date');
const runOosButton = document.getElementById('run-oos-button');
const oosStatusSpan = document.getElementById('oos-status');
const oosResultsArea = document.getElementById('oos-results-area');
const oosMetricsPre = document.getElementById('oos-metrics');
const testingLogsDiv = document.getElementById('testing-logs');

// --- Carregar Símbolos ---
// Pede a lista de símbolos ao main process assim que a janela carrega
ipcRenderer.send('request-symbol-list-for-testing');

ipcRenderer.on('symbols-loaded-for-testing', (event, symbols) => {
    oosSymbolSelect.innerHTML = '<option value="">-- Selecione --</option>'; // Limpa "Carregando..."
    symbols.forEach(symbol => {
        const option = document.createElement('option');
        option.value = symbol;
        option.textContent = symbol;
        oosSymbolSelect.appendChild(option);
    });
});

// --- Lógica do Teste OOS ---
runOosButton.addEventListener('click', () => {
    const config = {
        symbol: oosSymbolSelect.value,
        isStartDate: isStartDateInput.value,
        isEndDate: isEndDateInput.value,
        oosStartDate: oosStartDateInput.value,
        oosEndDate: oosEndDateInput.value,
        // TODO: Adicionar aqui parâmetros de otimização (quais variar, intervalos)
        //       e parâmetros fixos (feeRate, slippage, etc., talvez de um config?)
    };

    // Validação básica
    if (!config.symbol || !config.isStartDate || !config.isEndDate || !config.oosStartDate || !config.oosEndDate) {
        addLog("Por favor, preencha todos os campos para o Teste OOS.", "log-error");
        return;
    }

    addLog(`Iniciando Teste OOS para ${config.symbol}...`, "log-info");
    oosStatusSpan.textContent = "Executando...";
    runOosButton.disabled = true;
    oosResultsArea.classList.add('hidden'); // Esconde resultados antigos

    // Envia configuração para o main process
    ipcRenderer.send('run-oos-test', config);
});

// Recebe resultados do Teste OOS do main process
ipcRenderer.on('oos-test-results', (event, results) => {
    oosMetricsPre.textContent = JSON.stringify(results, null, 2); // Exibe o JSON formatado
    oosResultsArea.classList.remove('hidden');
    oosStatusSpan.textContent = "Concluído.";
    runOosButton.disabled = false;
    addLog("Teste OOS concluído com sucesso!", "log-success");
});

// Recebe erros do main process
ipcRenderer.on('test-error', (event, errorMessage) => {
    addLog(`ERRO: ${errorMessage}`, "log-error");
    oosStatusSpan.textContent = "Erro.";
    runOosButton.disabled = false;
});

// --- Lógica de Logs ---
ipcRenderer.on('log-testing-message', (event, message) => {
    // Determina a classe com base na mensagem (simplificado)
    let logClass = 'log-default';
    if (message.toLowerCase().includes('erro')) logClass = 'log-error';
    if (message.toLowerCase().includes('sucesso') || message.toLowerCase().includes('concluído')) logClass = 'log-success';
    if (message.toLowerCase().includes('iniciando')) logClass = 'log-info';

    addLog(message, logClass);
});

function addLog(message, className = 'log-default') {
    const p = document.createElement('p');
    p.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    p.className = className;
    testingLogsDiv.prepend(p); // Adiciona no topo (devido ao flex-direction-reverse)

    // Limita o número de logs para evitar consumo excessivo de memória
    const maxLogs = 100;
    if (testingLogsDiv.childElementCount > maxLogs) {
        testingLogsDiv.removeChild(testingLogsDiv.lastChild);
    }
}

// Log inicial
addLog("Janela de Análise Avançada pronta.");