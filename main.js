// main.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
require('dotenv').config();

// Importa os novos módulos
const stateManager = require('./modules/stateManager');
const binanceService = require('./modules/binanceService');
const discordService = require('./modules/discordService');
const tradingEngine = require('./modules/tradingEngine');
const config = require('./config.json');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200, height: 800,
        icon: path.join(__dirname, 'build/icon.ico'), // Verifique se este caminho existe
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
    mainWindow.loadFile('index.html');

    mainWindow.webContents.on('did-finish-load', () => {
        // Envia a lista de símbolos e config para a UI
        binanceService.getSymbolList()
            .then(symbols => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('symbols-loaded', symbols);
                }
            })
            .catch(err => console.error("Erro ao carregar símbolos:", err));
        
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('config-loaded', config);
        }
    });
}

// --- INICIALIZAÇÃO DO BOT (O MAESTRO) ---

// 1. Inicia o State Manager (precisa do 'app' para saber onde salvar)
stateManager.init(app);
const initialState = stateManager.loadState();

// 2. Inicia o Binance Service
binanceService.init();

// 3. Define os "helpers" que o Engine usará para falar com a UI
// Isso garante que nunca tentaremos falar com uma janela destruída
const uiHelper = {
    log: (message) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('log-message', message);
        } else {
            console.log(`[LOG SEM JANELA] ${message}`);
        }
    },
    update: (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-data', data);
        }
    }
};

// 4. Inicia o Trading Engine, injetando todas as dependências
tradingEngine.init({
    binance: binanceService,
    discord: discordService,
    ui: uiHelper,
    state: stateManager
}, initialState);

// 5. Inicia o Discord Service, passando os callbacks do Engine
discordService.init({
    onStatusCommand: tradingEngine.getStatusCommand
});

// --- FIM DA INICIALIZAÇÃO ---


// --- GERENCIAMENTO DO APP ELECTRON ---
app.whenReady().then(() => {
    createWindow();

    // 6. Se o bot estava ativo, reinicia o monitoramento
    if (initialState.isMonitoringActive && initialState.sessionSettings.symbol) {
        console.log("Reiniciando monitoramento a partir do estado salvo.");
        // Damos um pequeno 'delay' para a UI carregar
        setTimeout(() => {
            uiHelper.log(`Restaurando sessão anterior para ${initialState.sessionSettings.symbol}...`);
            tradingEngine.start(initialState.sessionSettings, true); // O 'true' indica que é uma restauração
        }, 2000);
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (event) => {
    const { portfolio } = tradingEngine.getState();
    if (portfolio.isOpened) {
        console.log("Posição aberta detectada, liquidando antes de fechar...");
        event.preventDefault(); // Impede o fechamento imediato
        await tradingEngine.liquidatePosition('APP_QUIT');
        app.quit(); // Agora sim, fecha o app
    }
});


// --- GERENCIAMENTO DE EVENTOS DA UI (IPC) ---
// Os handlers IPC agora são simples e diretos

ipcMain.on('start-monitoring', (event, settings) => {
    tradingEngine.start(settings, false); // 'false' indica que é uma nova sessão
});

ipcMain.on('primary-action-button-clicked', () => {
    const { portfolio, isMonitoringActive } = tradingEngine.getState();
    
    if (portfolio.isOpened) {
        tradingEngine.liquidatePosition();
    } else if (isMonitoringActive) {
        tradingEngine.stop();
    }
});