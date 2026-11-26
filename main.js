const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const express = require('express');
const os = require('os');
const http = require('http');
const { Server } = require('socket.io');
const logger = require(path.join(__dirname, 'utils', 'logger'));
const { LogTypes } = logger;
const { createConfigManager, getConfigManager } = require('./src/config');
const { SftpSource } = require('./src/sftpSource');
const { processMapping, cancelCopy, resetCancelFlag } = require('./src/fileProcessor');

// Détecter le mode développement
const isDev = process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';
logger.console_log(LogTypes.CONFIG, 'Running in development mode:', isDev);

// Variables globales
let mainWindow = null;
let configWindow = null;
let expressApp = null;
let io = null;
let copyInProgress = false;
let cancelCopyRequested = false;
let currentConfig = null;
let configManager = null;
let connectionManager = null;

const PING_TIMEOUT = 3000; // 3 secondes

// Configuration minimale par défaut (utilisée uniquement à la première installation)
const MINIMAL_CONFIG = {
    maxFiles: 1000,
    language: 'fr',
    mappings: [],
    localMode: false,
    logs: {
        activeTypes: ['CONFIG', 'INFO', 'ERROR']
    }
};

// Gestionnaire de connexion
class ConnectionManager {
    constructor() {
        this.isConnected = false;
        this.deviceInfo = null;
    }

    setStatus(connected, info = null) {
        this.isConnected = connected;
        this.deviceInfo = info;
        this.notifyStatusChange();
    }

    getStatus() {
        return {
            connected: this.isConnected,
            deviceInfo: this.deviceInfo
        };
    }

    notifyStatusChange() {
        BrowserWindow.getAllWindows().forEach(window => {
            window.webContents.send('connection-status', this.getStatus());
        });
    }
}

// Initialiser Express et Socket.IO
function createServer() {
    expressApp = express();
    const server = http.createServer(expressApp);
    
    // Servir les fichiers statiques
    expressApp.use(express.static(path.join(__dirname, 'public')));

    // Configuration de Socket.IO
    io = new Server(server);

    // Gestion des connexions Socket.IO
    io.on('connection', (socket) => {
        logger.console_log(LogTypes.CONNECT, 'New client connected');
        
        socket.on('web-connect', () => {
            logger.console_log(LogTypes.CONNECT, 'Web client connected');
        });
        
        socket.on('disconnect', () => {
            logger.console_log(LogTypes.CONNECT, 'Client disconnected');
        });
    });

    // Démarrer le serveur
    const port = 3000;
    server.listen(port, () => {
        logger.console_log(LogTypes.SERVER, `Server listening on port ${port}`);
    });

    return server;
}

// Gestion des fenêtres
function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            devTools: true // Toujours activer les devtools
        }
    });

    // En mode dev, ouvrir les devtools automatiquement
    if (isDev) {
        mainWindow.webContents.openDevTools();
        logger.console_log(LogTypes.CONFIG, 'DevTools opened in development mode');
    }

    mainWindow.removeMenu(); // Supprimer le menu
    mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function createConfigWindow() {
    configWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // Charger la page de configuration
    configWindow.loadFile(path.join(__dirname, 'public', 'config.html'));

    // Ouvrir les DevTools en mode développement
    if (process.env.NODE_ENV === 'development') {
        console.log('[CONFIG] Opening DevTools in config window');
        configWindow.webContents.openDevTools();
    }

    // Gérer la fermeture de la fenêtre
    configWindow.on('closed', () => {
        configWindow = null;
    });
}

function createMappingWindow() {
    mappingWindow = new BrowserWindow({
        width: 600,
        height: 400,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            devTools: true // Activer les devtools
        },
        parent: mainWindow,
        modal: true,
        show: false
    });

    mappingWindow.loadFile(path.join(__dirname, 'public', 'mapping.html'));
    mappingWindow.once('ready-to-show', () => {
        mappingWindow.show();
        // Ouvrir les devtools en mode dev
        if (isDev) {
            mappingWindow.webContents.openDevTools();
        }
    });
}

// Gestionnaire IPC pour la sauvegarde
ipcMain.handle('save-config', async (event, newConfig) => {
    return configManager.saveConfig(newConfig);
});

// Pour les mises à jour de configuration dans le code
async function updateAppConfig(partialConfig) {
    return configManager.updateConfig(partialConfig);
}

// Gestion des IPC
function setupIPC() {
    const configManager = getConfigManager();
    
    // Initialiser le ConnectionManager s'il n'existe pas
    if (!connectionManager) {
        connectionManager = new ConnectionManager();
    }
    
    // Supprimer les gestionnaires existants
    ipcMain.removeHandler('get-mappings');
    ipcMain.removeHandler('get-config');
    ipcMain.removeHandler('save-config');
    ipcMain.removeHandler('start-copy');
    ipcMain.removeHandler('cancel-copy');
    ipcMain.removeHandler('sftp-list-directory');
    ipcMain.removeHandler('sftp-test-connection');
    
    // Ajouter le gestionnaire pour ouvrir la fenêtre de configuration
    ipcMain.handle('open-config', () => {
        if (!configWindow) {
            createConfigWindow();
        } else {
            configWindow.focus();
        }
    });

    // Ajouter le gestionnaire pour fermer la fenêtre de configuration
    ipcMain.handle('close-config', () => {
        if (configWindow) {
            configWindow.close();
        }
    });

    // Enregistrer les nouveaux gestionnaires
    ipcMain.handle('get-mappings', async () => {
        try {
            const config = configManager.getConfig();
            return config.mappings || [];
        } catch (error) {
            console.error('[CONFIG] Erreur lors de la récupération des mappings:', error);
            throw error;
        }
    });

    ipcMain.handle('save-mappings', async (event, mappings) => {
        try {
            const config = configManager.getConfig();
            config.mappings = mappings;
            await configManager.updateConfig(config);
            return mappings;
        } catch (error) {
            console.error('[CONFIG] Erreur lors de la sauvegarde des mappings:', error);
            throw error;
        }
    });

    ipcMain.handle('get-config', async () => {
        try {
            return configManager.getConfig();
        } catch (error) {
            console.error('[CONFIG] Erreur lors de la récupération de la config:', error);
            throw error;
        }
    });

    ipcMain.handle('save-config', async (event, newConfig) => {
        try {
            const updatedConfig = await configManager.updateConfig(newConfig);
            // Notifier tous les renderers de la mise à jour
            BrowserWindow.getAllWindows().forEach(window => {
                window.webContents.send('config-updated', updatedConfig);
            });
            return updatedConfig;
        } catch (error) {
            console.error('[CONFIG] Erreur lors de la sauvegarde:', error);
            throw error;
        }
    });


    ipcMain.handle('select-local-folder', async () => {
        try {
            const result = await dialog.showOpenDialog(mainWindow, {
                properties: ['openDirectory'],
                title: 'Sélectionner un dossier local'
            });
            
            if (!result.canceled) {
                return { path: result.filePaths[0] };
            }
            return { canceled: true };
        } catch (error) {
            console.error('[FOLDER] Erreur lors de la sélection du dossier:', error);
            throw error;
        }
    });

    // Gestionnaire de sélection de dossier PC
    ipcMain.handle('select-pc-folder', async () => {
        try {
            const result = await dialog.showOpenDialog(mainWindow, {
                properties: ['openDirectory'],
                title: 'Sélectionner un dossier sur le PC'
            });

            if (!result.canceled) {
                const selectedPath = result.filePaths[0];
                
                // Notifier tous les renderers
                BrowserWindow.getAllWindows().forEach(window => {
                    window.webContents.send('pc-folder-selected', {
                        path: selectedPath
                    });
                });

                return { path: selectedPath };
            }
            
            return { canceled: true };
        } catch (error) {
            console.error('[FOLDER] Erreur lors de la sélection du dossier PC:', error);
            
            // Notifier l'erreur
            BrowserWindow.getAllWindows().forEach(window => {
                window.webContents.send('pc-folder-error', {
                    error: error.message
                });
            });
            
            throw error;
        }
    });

    // Navigation SFTP et test de connexion (lecture seule).
    ipcMain.handle('sftp-list-directory', async (_event, options, remotePath = '/') => {
        const source = await SftpSource.connect(options);
        try {
            return { entries: await source.listDirectory(remotePath), hostFingerprint: source.hostFingerprint };
        } finally {
            source.close();
        }
    });

    ipcMain.handle('sftp-test-connection', async (_event, options) => {
        const source = await SftpSource.connect(options);
        try {
            return { success: true, hostFingerprint: source.hostFingerprint };
        } finally {
            source.close();
        }
    });

    // Démarrage réel du moteur de sauvegarde.
    ipcMain.handle('start-copy', async (event, requestedMappings) => {
        if (copyInProgress) throw new Error('Une sauvegarde est déjà en cours.');
        const config = getConfigManager().getConfig();
        let mappings;
        if (Array.isArray(requestedMappings)) mappings = requestedMappings;
        else if (typeof requestedMappings === 'string') mappings = (config.mappings || []).filter(m => m.id === requestedMappings);
        else mappings = config.mappings || [];
        if (!mappings.length) throw new Error('Aucun mapping à sauvegarder.');

        copyInProgress = true;
        cancelCopyRequested = false;
        resetCancelFlag();
        const sendProgress = (data) => {
            const target = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
            if (target) target.webContents.send('copy-progress', data);
            else if (event.sender && !event.sender.isDestroyed()) event.sender.send('copy-progress', data);
        };
        sendProgress({ status: 'start', total: mappings.length });
        const results = [];
        try {
            for (const mapping of mappings) {
                if (cancelCopyRequested) break;
                sendProgress({ status: 'starting', mapping: mapping.title, total: 0 });
                const result = await processMapping({
                    mapping,
                    onProgress: sendProgress,
                    onComplete: (value) => {
                        if (value && value.error) sendProgress({ status: 'error', error: value.error });
                        else sendProgress({ status: 'completed', mapping: mapping.title, result: value });
                    }
                });
                results.push({ mappingId: mapping.id, ...result });
            }
            sendProgress({ status: 'finished', results, cancelled: cancelCopyRequested });
            return { success: true, results, cancelled: cancelCopyRequested };
        } catch (error) {
            sendProgress({ status: 'error', error: error.message });
            throw error;
        } finally {
            copyInProgress = false;
            cancelCopyRequested = false;
        }
    });

    ipcMain.handle('cancel-copy', async () => {
        cancelCopyRequested = true;
        cancelCopy();
        return { success: true };
    });

    // Gestionnaires de mapping
    ipcMain.handle('save-mapping', async (event, mapping) => {
        try {
            const config = configManager.getConfig();
            const mappings = config.mappings || [];
            
            if (mapping.id) {
                // Mise à jour d'un mapping existant
                const index = mappings.findIndex(m => m.id === mapping.id);
                if (index !== -1) {
                    mappings[index] = mapping;
                }
            } else {
                // Nouveau mapping
                mapping.id = Date.now().toString();
                mappings.push(mapping);
            }
            
            config.mappings = mappings;
            await configManager.updateConfig(config);

            // Notifier tous les renderers
            BrowserWindow.getAllWindows().forEach(window => {
                window.webContents.send('mappings-updated', mappings);
            });

            return { success: true, mapping };
        } catch (error) {
            console.error('[MAPPING] Erreur lors de la sauvegarde:', error);
            throw error;
        }
    });

    ipcMain.handle('update-mapping', async (event, mapping) => {
        try {
            const config = configManager.getConfig();
            const mappings = config.mappings || [];
            const index = mappings.findIndex(m => m.id === mapping.id);
            
            if (index !== -1) {
                mappings[index] = mapping;
                config.mappings = mappings;
                await configManager.updateConfig(config);

                // Notifier tous les renderers
                BrowserWindow.getAllWindows().forEach(window => {
                    window.webContents.send('mappings-updated', mappings);
                });

                return { success: true, mapping };
            }
            throw new Error('Mapping non trouvé');
        } catch (error) {
            console.error('[MAPPING] Erreur lors de la mise à jour:', error);
            throw error;
        }
    });

    ipcMain.handle('delete-mapping', async (event, mappingId) => {
        try {
            const config = configManager.getConfig();
            const mappings = config.mappings || [];
            const index = mappings.findIndex(m => m.id === mappingId);
            
            if (index !== -1) {
                mappings.splice(index, 1);
                config.mappings = mappings;
                await configManager.updateConfig(config);

                // Notifier tous les renderers
                BrowserWindow.getAllWindows().forEach(window => {
                    window.webContents.send('mappings-updated', mappings);
                });

                return { success: true };
            }
            throw new Error('Mapping non trouvé');
        } catch (error) {
            console.error('[MAPPING] Erreur lors de la suppression:', error);
            throw error;
        }
    });

    // Gestionnaires de navigation
    ipcMain.handle('close-editor', () => {
        if (mainWindow) {
            mainWindow.webContents.send('editor-closed');
        }
        return { success: true };
    });

    ipcMain.handle('cancel-editing', () => {
        if (mainWindow) {
            mainWindow.webContents.send('editing-cancelled');
        }
        return { success: true };
    });

    console.log('[IPC] Gestionnaires IPC configurés');
}

// Initialisation de l'application
app.whenReady().then(async () => {
    // Initialiser le gestionnaire de configuration
    configManager = createConfigManager();
    connectionManager = new ConnectionManager();
    
    const config = configManager.getConfig();
    setupIPC();
    createMainWindow();
    createServer();
    startConnectionCheck();
});

// Quitter quand toutes les fenêtres sont fermées
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});
