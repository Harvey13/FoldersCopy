const path = require('path');
const fs = require('fs').promises;
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { setupServer, setupSocketIO } = require('./server');
const { log, LogTypes, log_cli } = require('./logger');
const fileProcessor = require('./fileProcessor');

// Variables globales
let mainWindow = null;
let server = null;

// Configuration des chemins
const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'src');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const APP_PATH = app.getAppPath();

// Utilitaire de logging
function debugLog(...args) {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    log_cli('DEBUG', `[${timestamp}] [Main] ${args.join(' ')}`);
}

debugLog('📂 Répertoires:');
debugLog('- ROOT:', ROOT_DIR);
debugLog('- SRC:', SRC_DIR);
debugLog('- PUBLIC:', PUBLIC_DIR);

// Vérification de la validité de mainWindow
function isWindowValid() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        debugLog('❌ mainWindow non valide');
        return false;
    }
    return true;
}

function createWindow() {
    debugLog('🎨 Création de la fenêtre principale');
    
    // Vérification des chemins critiques
    const preloadPath = path.join(SRC_DIR, 'preload.js');
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    
    debugLog('📜 Preload:', preloadPath);
    debugLog('📄 Index:', indexPath);
    
    if (!fs.existsSync(preloadPath)) {
        debugLog('❌ Preload script introuvable:', preloadPath);
        app.quit();
        return;
    }
    
    if (!fs.existsSync(indexPath)) {
        debugLog('❌ Index HTML introuvable:', indexPath);
        app.quit();
        return;
    }
    
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: preloadPath,
            sandbox: false
        }
    });

    mainWindow.loadFile(indexPath);
    
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
        debugLog('🔧 DevTools ouverts');
    }
    
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        debugLog('❌ Erreur de chargement:', errorCode, errorDescription);
    });

    mainWindow.webContents.on('did-finish-load', () => {
        debugLog('✅ Chargement terminé');
    });
    
    mainWindow.webContents.on('dom-ready', () => {
        debugLog('📄 DOM ready');
    });

    mainWindow.webContents.on('console-message', (event, level, message) => {
        debugLog('💬 Console:', message);
    });
    
    debugLog('✅ Fenêtre principale créée');
}

function setupIPC() {
    debugLog('🔌 Configuration des événements IPC');

    // Configuration du mapping
    ipcMain.handle('open-mapping-dialog', async () => {
        debugLog('📂 Ouverture dialogue mapping');
        if (!isWindowValid()) return { error: 'Fenêtre non valide' };

        try {
            const result = await dialog.showOpenDialog(mainWindow, {
                properties: ['openDirectory', 'multiSelections'],
                title: 'Sélectionner les dossiers à synchroniser'
            });

            if (!result.canceled) {
                debugLog('📂 Dossiers sélectionnés:', result.filePaths);
                return { success: true, paths: result.filePaths };
            }
            return { canceled: true };
        } catch (error) {
            debugLog('❌ Erreur dialogue mapping:', error);
            return { error: error.message };
        }
    });

    // Configuration des paramètres
    ipcMain.handle('open-settings-dialog', async () => {
        debugLog('⚙️ Ouverture dialogue paramètres');
        if (!isWindowValid()) return { error: 'Fenêtre non valide' };

        try {
            const result = await dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Paramètres',
                message: 'Configuration de Cp2Pc',
                detail: 'Choisissez une option :',
                buttons: [
                    'Nombre max de fichiers',
                    'Langue',
                    'Annuler'
                ],
                cancelId: 2
            });

            if (result.response === 2) {
                return { canceled: true };
            }

            switch (result.response) {
                case 0: // Nombre max de fichiers
                    const maxFilesResult = await dialog.showMessageBox(mainWindow, {
                        type: 'question',
                        title: 'Nombre max de fichiers',
                        message: 'Choisissez le nombre maximum de fichiers à synchroniser :',
                        detail: 'Valeur actuelle : 1000',
                        buttons: ['100', '500', '1000', '5000', 'Illimité', 'Annuler'],
                        defaultId: 2,
                        cancelId: 5
                    });

                    if (maxFilesResult.response === 5) {
                        return { canceled: true };
                    }

                    const maxFilesValues = [100, 500, 1000, 5000, -1];
                    const maxFiles = maxFilesValues[maxFilesResult.response];
                    
                    return { 
                        success: true, 
                        setting: 'maxFiles', 
                        value: maxFiles,
                        saveToStorage: true 
                    };

                case 1: // Langue
                    const langResult = await dialog.showMessageBox(mainWindow, {
                        type: 'question',
                        title: 'Langue',
                        message: 'Choisissez la langue :',
                        buttons: ['Français', 'English', 'Annuler'],
                        defaultId: 0,
                        cancelId: 2
                    });

                    if (langResult.response === 2) {
                        return { canceled: true };
                    }

                    const languages = ['fr', 'en'];
                    const lang = languages[langResult.response];
                    
                    return { 
                        success: true, 
                        setting: 'language', 
                        value: lang,
                        saveToStorage: true 
                    };
            }

            return { canceled: true };
        } catch (error) {
            debugLog('❌ Erreur dialogue paramètres:', error);
            return { error: error.message };
        }
    });

    ipcMain.on('openConfig', (event) => {
        const configWindow = new BrowserWindow({
            width: 400,
            height: 600,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
            }
        });
        configWindow.loadFile(path.join(PUBLIC_DIR, 'config.html'));
        configWindow.on('closed', () => {
            configWindow = null;
        });
    });

    ipcMain.on('mobile-folder-selected', (event, folderPath) => {
        // Logic to handle the selected folder path
        // You can send a response back to the renderer if needed
    });

    // Gestion de la copie
    ipcMain.handle('start-copy', async (event, specificMappings = null) => {
        log('INFO', '🚀 Démarrage de la copie', { 
            mappings: specificMappings,
            timestamp: new Date().toISOString()
        });
        
        try {
            // Récupérer les mappings à traiter
            const mappingsToProcess = specificMappings || currentConfig.mappings;
            log('INFO', '📊 Initialisation de la copie', { 
                count: mappingsToProcess.length,
                mappings: mappingsToProcess.map(m => ({
                    id: m.id,
                    title: m.title
                }))
            });

            // Vérifier la validité des mappings
            for (const mapping of mappingsToProcess) {
                if (!mapping.sourcePath || !mapping.destPath) {
                    throw new Error(`Mapping invalide: chemins manquants pour ${mapping.title}`);
                }
            }

            // Traiter chaque mapping
            for (const mapping of mappingsToProcess) {
                try {
                    await fileProcessor.processMapping({
                        mapping,
                        onProgress: (progress) => {
                            event.sender.send('copy-progress', {
                                mapping: mapping.title,
                                current: progress.current,
                                total: progress.total,
                                status: progress.status,
                                file: progress.file
                            });
                        },
                        onComplete: (result) => {
                            event.sender.send('copy-progress', {
                                mapping: mapping.title,
                                current: result.total,
                                total: result.total,
                                status: 'completed'
                            });
                        }
                    });
                } catch (error) {
                    log('ERROR', '❌ Erreur lors du traitement du mapping', { 
                        title: mapping.title,
                        error: error.message,
                        stack: error.stack
                    });
                    throw error;
                }
            }

            log('INFO', '✅ Processus de copie terminé avec succès', {
                totalMappings: mappingsToProcess.length
            });
            return { success: true };
        } catch (error) {
            log('ERROR', '❌ Erreur globale dans le processus de copie', {
                error: error.message,
                stack: error.stack
            });
            return { error: error.message };
        }
    });

    ipcMain.handle('getConnectionStatus', async (event) => {
        // Logic to determine connection status
        const status = await someFunctionToGetStatus(); // Replace with your actual logic
        return status;
    });

    debugLog('✅ Événements IPC configurés');
}

// Service de découverte réseau
function setupDiscoveryService(port) {
    debugLog('🔍 Configuration du service de découverte');
    
    // Stocker les informations de découverte
    const discoveryInfo = {
        serverPort: port,
        timestamp: new Date().toISOString()
    };
    
    // Répondre aux requêtes de découverte
    ipcMain.on('discovery-request', (event) => {
        debugLog('🔍 Requête de découverte reçue');
        event.sender.send('discovery-response', discoveryInfo);
    });
    
    debugLog('✅ Service de découverte configuré');
}

// Gestion des erreurs globales
process.on('uncaughtException', (error) => {
    debugLog('❌ Erreur non gérée:', error);
});

process.on('unhandledRejection', (error) => {
    debugLog('❌ Promise rejetée non gérée:', error);
});

const defaultConfig = {
    logs: {
        activeTypes: [LogTypes.CONFIG, LogTypes.INFO, LogTypes.ERROR, LogTypes.DEBUG]
    }
};

app.whenReady().then(async () => {
    debugLog('🎬 Application prête');
    
    // Configuration des événements IPC avant la création de la fenêtre
    setupIPC();
    debugLog('🔌 IPC configuré');
    
    // Démarrer le serveur Socket.IO
    server = setupServer();
    const io = setupSocketIO(server);
    debugLog('🔌 Serveur Socket.IO configuré');
    
    createWindow();
});

app.on('window-all-closed', () => {
    debugLog('🚪 Toutes les fenêtres fermées');
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    debugLog('🔄 Activation de l\'application');
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
