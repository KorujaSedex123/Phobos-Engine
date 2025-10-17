// logger.js
const winston = require('winston');
require('winston-daily-rotate-file');

const logger = winston.createLogger({
    level: 'info', // Nível mínimo de log para ser salvo nos arquivos
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json() // Salva os logs em formato JSON
    ),
    defaultMeta: { service: 'phobos-engine-bot' },
    transports: [
        // Transporte para salvar TODOS os logs de nível 'info' e acima
        new winston.transports.DailyRotateFile({
            filename: 'logs/phobos-engine-%DATE%.log', // Nome do arquivo
            datePattern: 'YYYY-MM-DD',
            zippedArchive: true, // Compacta os logs antigos em .gz
            maxSize: '20m',      // Tamanho máximo do arquivo antes de rotacionar
            maxFiles: '14d'      // Mantém os logs apenas dos últimos 14 dias
        }),
        // Transporte para salvar APENAS os logs de erro em um arquivo separado
        new winston.transports.DailyRotateFile({
            level: 'error',
            filename: 'logs/phobos-engine-errors-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            zippedArchive: true,
            maxSize: '20m',
            maxFiles: '30d' // Mantém os logs de erro por 30 dias
        })
    ]
});

// Se não estivermos em "produção" (ex: rodando no seu PC), também mostra logs no terminal
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

module.exports = logger;