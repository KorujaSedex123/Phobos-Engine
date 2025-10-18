// modules/discordService.js
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { RSI } = require('technicalindicators');
const binanceService = require('./binanceService'); // Importa o binanceService
const config = require('../config.json');

const discordToken = process.env.DISCORD_BOT_TOKEN;
const userId = process.env.DISCORD_USER_ID;
const discordClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent] });
let notificationTarget;

// Callbacks serão as funções do 'tradingEngine'
let commandCallbacks = {}; 

function init(callbacks) {
    commandCallbacks = callbacks; // Salva os callbacks (ex: onStatusCommand)

    if (!discordToken || !userId) return;

    discordClient.login(discordToken);
    discordClient.on('ready', async () => {
        try {
            notificationTarget = await discordClient.users.fetch(userId);
            console.log(`Bot de notificações conectado ao Discord. A ouvir o utilizador ID: ${userId}`);
            sendNotification({ type: 'info', title: 'Phobos Engine Online', message: 'Aplicação de desktop iniciada.' });
        } catch (error) {
            console.error(`Erro ao buscar alvo do Discord: ${error.message}`);
        }
    });

    discordClient.on('messageCreate', message => handleCommands(message));
}

function sendNotification({ type, title, message }) {
    if (!notificationTarget) return;
    const embed = new EmbedBuilder().setTitle(title).setDescription(message).setTimestamp();
    switch (type) {
        case 'buy': embed.setColor(0x3498DB); break;
        case 'profit': embed.setColor(0x2ECC71); break;
        case 'loss': embed.setColor(0xE74C3C); break;
        case 'error': embed.setColor(0x992D22); break;
        default: embed.setColor(0x95A5A6); break;
    }
    notificationTarget.send({ embeds: [embed] });
}

async function handleCommands(message) {
    if (message.author.bot || message.author.id !== userId || !message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const symbol = args[0] ? args[0].toUpperCase() : null;

    if (command === 'status' && commandCallbacks.onStatusCommand) {
        const statusMessage = commandCallbacks.onStatusCommand();
        sendNotification({ type: 'info', title: 'Status Atual', message: statusMessage });
    
    } else if (command === 'info') {
        if (!symbol) return sendNotification({ type: 'error', title: 'Argumento em Falta', message: 'Ex: `!info BTCUSDT`' });
        try {
            const ticker = await binanceService.getSymbolTicker(symbol);
            const { lastPrice, priceChangePercent, highPrice, lowPrice, volume } = ticker.data;
            const messageBody = `**Preço:** $${parseFloat(lastPrice).toFixed(2)}\n` +
                          `**Variação 24h:** ${parseFloat(priceChangePercent).toFixed(2)}%\n` +
                          `**Máxima 24h:** $${parseFloat(highPrice).toFixed(2)}\n` +
                          `**Mínima 24h:** $${parseFloat(lowPrice).toFixed(2)}\n` +
                          `**Volume 24h:** ${parseFloat(volume).toFixed(2)} ${symbol.replace('USDT','')}`;
            sendNotification({ type: 'info', title: `Relatório de Mercado: ${symbol}`, message: messageBody });
        } catch (error) {
            sendNotification({ type: 'error', title: `Erro ao buscar info para ${symbol}`, message: 'Verifique se o símbolo é válido.' });
        }

    } else if (command === 'rsi') {
        if (!symbol) return sendNotification({ type: 'error', title: 'Argumento em Falta', message: 'Ex: `!rsi BTCUSDT`' });
        try {
            const closePrices = await binanceService.getSymbolRSI(symbol);
            const rsiValues = RSI.calculate({ period: config.rsiPeriod, values: closePrices });
            const lastRsi = rsiValues[rsiValues.length - 1];
            sendNotification({ type: 'info', title: `RSI (${config.rsiPeriod}, 1m) para ${symbol}`, message: `O RSI atual é **${lastRsi.toFixed(2)}**.` });
        } catch (error) {
            sendNotification({ type: 'error', title: `Erro ao buscar RSI para ${symbol}`, message: 'Verifique se o símbolo é válido.' });
        }
    }
}

module.exports = { init, sendNotification };