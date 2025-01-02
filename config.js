const isDev = process.env.NODE_ENV === 'development';
const { LogTypes } = require('./utils/logger');

const config = {
    development: isDev,
    port: 3000,
    devTools: isDev,
    debug: isDev,
    logLevel: isDev ? 'debug' : 'info',
    maxFiles: 1000,
    language: 'fr',
    mappings: []
};

module.exports = config;
