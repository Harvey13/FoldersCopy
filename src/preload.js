const { contextBridge, ipcRenderer } = require('electron');

function debugLog(...args) {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`[${timestamp}] [Preload]`, ...args);
}

debugLog('🔄 Chargement du preload script...');
debugLog('📂 __dirname:', __dirname);
debugLog('📂 process.cwd():', process.cwd());

// Liste des canaux IPC autorisés
const validChannels = {
    invoke: [
        'open-mapping-dialog',
        'open-settings-dialog',
        'getConnectionStatus',
        'onFolderSelected'
    ],
};

try {
    // Configuration de l'API Electron pour le renderer
    contextBridge.exposeInMainWorld('electronAPI', {
        // Méthodes IPC
        invoke: (channel, data) => {
            debugLog('📤 Invoke:', channel, data);
            if (validChannels.invoke.includes(channel)) {
                return ipcRenderer.invoke(channel, data);
            }
            return Promise.reject(new Error(`Canal IPC non autorisé: ${channel}`));
        },
        
        // Écouteurs d'événements
        on: (channel, callback) => {
            debugLog('👂 Ajout écouteur:', channel);
            if (validChannels.on && validChannels.on.includes(channel)) {
                ipcRenderer.on(channel, (event, ...args) => callback(...args));
            }
        },
        
        // Suppression des écouteurs
        removeAllListeners: (channel) => {
            debugLog('🗑️ Suppression écouteurs:', channel);
            if (validChannels.removeListeners && validChannels.removeListeners.includes(channel)) {
                ipcRenderer.removeAllListeners(channel);
            }
        },
        
        getConnectionStatus: () => ipcRenderer.invoke('getConnectionStatus'),
        onFolderSelected: (callback) => ipcRenderer.on('mobile-folder-selected', callback)
    });

    debugLog('✅ API Electron exposée au renderer');
} catch (error) {
    debugLog('❌ Erreur lors de l\'exposition de l\'API:', error);
}
