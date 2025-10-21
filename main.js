// main.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
require('dotenv').config();

// Importa os novos módulos
const stateManager = require('./modules/stateManager');
const binanceService = require('./modules/binanceService');
const discordService = require('./modules/discordService');
const tradingEngine = require('./modules/tradingEngine');
const advancedTester = require('./modules/advancedTester');
const config = require('./config.json');

let mainWindow;
let testingWindow;

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
            .catch(err => console.error("Erro ao carregar símbolos:", err)); // Erro deve desaparecer

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('config-loaded', config);
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// --- INICIALIZAÇÃO DO BOT (O MAESTRO) ---

// 1. Inicia o State Manager (precisa do 'app' para saber onde salvar)
stateManager.init(app);
const initialState = stateManager.loadState();
binanceService.init('production');


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
    const environment = settings.environment || 'production';
    uiHelper.log(`--- REINICIALIZANDO AMBIENTE PARA: ${environment.toUpperCase()} ---`); // Log informativo

    // ***** NOVO: Inicializa o binanceService AGORA *****
    const initSuccess = binanceService.init(environment);
    if (initSuccess) {
        // Só inicia o trading engine se a conexão for bem sucedida
        tradingEngine.start(settings, false); // 'false' indica nova sessão
    } else {
        // Informa o utilizador sobre a falha
        uiHelper.log(`❌ Falha ao inicializar o ambiente ${environment.toUpperCase()}. Verifique as chaves API e a conexão.`);
        // TODO: Talvez voltar para a tela de setup ou mostrar erro na UI?
        // Por agora, apenas loga o erro. O bot não iniciará.
    }
});

ipcMain.on('primary-action-button-clicked', () => {
    const { portfolio, isMonitoringActive } = tradingEngine.getState();

    if (portfolio.isOpened) {
        tradingEngine.liquidatePosition();
    } else if (isMonitoringActive) {
        tradingEngine.stop();
    }
});

// --- Função para criar a Janela de Teste (MANTÉM) ---
function createTestingWindow() {
    if (testingWindow) {
        testingWindow.focus();
        return;
    }
    testingWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        title: "Phobos Engine - Análise Avançada",
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    testingWindow.loadFile('testing.html');
    testingWindow.on('closed', () => { testingWindow = null; });
    // Opcional: Remover a barra de menu da janela de teste, se não a quiser
    // testingWindow.setMenuBarVisibility(false);

    testingWindow.on('closed', () => {
        testingWindow = null;
    });
}
// --- FIM Função Janela de Teste -

ipcMain.on('open-testing-window', () => {
    console.log("Recebido pedido 'open-testing-window'. Chamando createTestingWindow..."); // Log para depuração
    createTestingWindow(); // Chama a função que cria a nova janela
});
ipcMain.on('request-symbol-list-for-testing', async (event) => {
    try {
        const symbols = await binanceService.getSymbolList();
        // Garante que a janela ainda existe antes de enviar
        if (testingWindow && !testingWindow.isDestroyed()) {
            testingWindow.webContents.send('symbols-loaded-for-testing', symbols);
        }
    } catch (error) {
        console.error("Erro ao buscar símbolos para janela de teste:", error);
        if (testingWindow && !testingWindow.isDestroyed()) {
            testingWindow.webContents.send('test-error', "Falha ao carregar lista de símbolos.");
        }
    }
});
// Executa o Teste OOS (MODIFICADO)
ipcMain.on('run-oos-test', async (event, testConfig) => {
    // Cria um logger específico para esta execução
    const testLogger = {
        log: (message) => {
            console.log(`[TEST LOG] ${message}`); // Log no console principal
            if (testingWindow && !testingWindow.isDestroyed()) {
                testingWindow.webContents.send('log-testing-message', message); // Envia para a janela de teste
            }
        }
    };

    try {
        testLogger.log(`Iniciando Teste Out-of-Sample para ${testConfig.symbol}...`);
        // Passa o logger para a função
        const results = await advancedTester.performOOSTest(testConfig, testLogger);
        if (testingWindow && !testingWindow.isDestroyed()) {
            testingWindow.webContents.send('oos-test-results', results);
        }
        // testLogger.log("Teste OOS concluído com sucesso."); // O renderer já faz isso
    } catch (error) {
        console.error("Erro durante Teste OOS:", error);
        const errorMsg = error.message || "Erro desconhecido";
        // Usa o logger para enviar o erro para a janela de teste
        testLogger.log(`ERRO no Teste OOS: ${errorMsg}`);
        if (testingWindow && !testingWindow.isDestroyed()) {
            // Pode opcionalmente enviar um evento de erro específico também
            testingWindow.webContents.send('test-error', `Erro no Teste OOS: ${errorMsg}`);
        }
    }
});
