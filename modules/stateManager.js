// modules/stateManager.js
const fs = require('fs');
const path = require('path');

let STATE_FILE_PATH;

const DEFAULT_STATE = {
    portfolio: { cryptoBalance: 0, isOpened: false, lastBuyPrice: 0, totalProfitUsdt: 0, peakPrice: 0 },
    sessionSettings: {},
    isMonitoringActive: false,
    sessionStats: { totalTrades: 0, wins: 0, losses: 0, totalProfit: 0, totalLoss: 0 }
};

// A função 'init' recebe o objeto 'app' do Electron para descobrir onde salvar
function init(app) {
    STATE_FILE_PATH = path.join(app.getPath('userData'), 'state.json');
}

function saveState(data) {
    try {
        const state = { 
            portfolio: data.portfolio, 
            sessionSettings: data.sessionSettings, 
            isMonitoringActive: data.isMonitoringActive, 
            sessionStats: data.sessionStats 
        };
        fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(state, null, 2));
        console.log("Estado salvo com sucesso.");
    } catch (error) {
        console.error("Erro ao salvar o estado:", error);
    }
}

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE_PATH)) {
            const rawData = fs.readFileSync(STATE_FILE_PATH);
            console.log("Estado anterior carregado com sucesso.");
            const parsedState = JSON.parse(rawData);
            // Garante que todos os campos existam, mesclando com o padrão
            return { ...DEFAULT_STATE, ...parsedState };
        }
    } catch (error) {
        console.error("Erro ao carregar o estado:", error);
    }
    // Retorna um estado padrão se não houver arquivo ou der erro
    return { ...DEFAULT_STATE };
}

module.exports = { init, saveState, loadState };