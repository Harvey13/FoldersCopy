const { contextBridge, ipcRenderer } = require('electron');

// Exposer l'API à la fenêtre de rendu
contextBridge.exposeInMainWorld('api', {
    // Configuration
    getConfig: () => ipcRenderer.invoke('get-config'),
    saveConfig: (config) => ipcRenderer.invoke('save-config', config),
    updateConfig: (partial) => ipcRenderer.invoke('update-config', partial),
    
    // Mappings
    getMappings: () => ipcRenderer.invoke('get-mappings'),
    saveMappings: (mappings) => ipcRenderer.invoke('save-mappings', mappings),

    // Événements de configuration
    onConfigUpdate: (callback) => {
        // Supprimer l'ancien listener s'il existe
        ipcRenderer.removeAllListeners('config-updated');
        ipcRenderer.on('config-updated', (event, newConfig) => callback(newConfig));
    },

    // Événements de mapping
    onMappingAdded: (callback) => {
        ipcRenderer.removeAllListeners('mapping-added');
        ipcRenderer.on('mapping-added', () => callback());
    },
    onMappingUpdate: (callback) => {
        ipcRenderer.removeAllListeners('mapping-update');
        ipcRenderer.on('mapping-update', (event, mapping) => callback(mapping));
    },
    onMappingDelete: (callback) => {
        ipcRenderer.removeAllListeners('mapping-delete');
        ipcRenderer.on('mapping-delete', (event, id) => callback(id));
    },
    onMappingProgress: (callback) => {
        ipcRenderer.removeAllListeners('mapping-progress');
        ipcRenderer.on('mapping-progress', (event, data) => callback(data));
    },

    // Fenêtre de configuration
    openConfig: () => ipcRenderer.invoke('open-config'),
    closeConfig: () => ipcRenderer.invoke('close-config'),

    // Événements de copie
    onCopyProgress: (callback) => {
        const wrappedCallback = (event, data) => {
            callback(data);
        };
        
        ipcRenderer.removeAllListeners('copy-progress');
        ipcRenderer.on('copy-progress', wrappedCallback);
        
        return () => {
            ipcRenderer.removeListener('copy-progress', wrappedCallback);
        };
    },

    onCopyComplete: (callback) => {
        const wrappedCallback = (event, data) => {
            callback(data);
        };
        
        ipcRenderer.removeAllListeners('copy-complete');
        ipcRenderer.on('copy-complete', wrappedCallback);
        
        return () => {
            ipcRenderer.removeListener('copy-complete', wrappedCallback);
        };
    },

    onCopyError: (callback) => {
        const wrappedCallback = (event, error) => {
            callback(error);
        };
        
        ipcRenderer.removeAllListeners('copy-error');
        ipcRenderer.on('copy-error', wrappedCallback);
        
        return () => {
            ipcRenderer.removeListener('copy-error', wrappedCallback);
        };
    },


    // Méthodes de sélection de dossier
    selectMobileFolder: () => ipcRenderer.invoke('select-local-folder'),
    listSftpDirectory: (options, remotePath) => ipcRenderer.invoke('sftp-list-directory', options, remotePath),
    testSftpConnection: (options) => ipcRenderer.invoke('sftp-test-connection', options),
    selectLocalFolder: () => ipcRenderer.invoke('select-local-folder'),

    // Méthodes de copie
    startCopy: (mappingId) => ipcRenderer.invoke('start-copy', mappingId),
    cancelCopy: (mappingId) => ipcRenderer.invoke('cancel-copy', mappingId),

    // Événements de sélection de dossier PC
    onPcFolderSelected: (callback) => {
        const wrappedCallback = (event, data) => {
            callback(data);
        };
        
        ipcRenderer.removeAllListeners('pc-folder-selected');
        ipcRenderer.on('pc-folder-selected', wrappedCallback);
        
        return () => {
            ipcRenderer.removeListener('pc-folder-selected', wrappedCallback);
        };
    },

    onPcFolderError: (callback) => {
        const wrappedCallback = (event, error) => {
            callback(error);
        };
        
        ipcRenderer.removeAllListeners('pc-folder-error');
        ipcRenderer.on('pc-folder-error', wrappedCallback);
        
        return () => {
            ipcRenderer.removeListener('pc-folder-error', wrappedCallback);
        };
    },

    // Méthodes de sélection de dossier PC
    selectPcFolder: async () => {
        try {
            return await ipcRenderer.invoke('select-pc-folder');
        } catch (error) {
            console.error('Erreur lors de la sélection du dossier PC:', error);
            throw error;
        }
    },

    // Méthodes de gestion des mappings
    saveMapping: async (mapping) => {
        try {
            return await ipcRenderer.invoke('save-mapping', mapping);
        } catch (error) {
            console.error('Erreur lors de la sauvegarde du mapping:', error);
            throw error;
        }
    },

    updateMapping: async (mapping) => {
        try {
            return await ipcRenderer.invoke('update-mapping', mapping);
        } catch (error) {
            console.error('Erreur lors de la mise à jour du mapping:', error);
            throw error;
        }
    },

    deleteMapping: async (mappingId) => {
        try {
            return await ipcRenderer.invoke('delete-mapping', mappingId);
        } catch (error) {
            console.error('Erreur lors de la suppression du mapping:', error);
            throw error;
        }
    },

    // Méthodes de navigation
    closeEditor: () => ipcRenderer.invoke('close-editor'),
    cancelEditing: () => ipcRenderer.invoke('cancel-editing'),

    // Événement de fermeture de l'application
    onAppClosing: (callback) => {
        const wrappedCallback = async () => {
            try {
                await callback();
            } catch (error) {
                console.error('Erreur lors de la fermeture:', error);
            }
        };
        
        ipcRenderer.removeAllListeners('app-closing');
        ipcRenderer.on('app-closing', wrappedCallback);
        
        return () => {
            ipcRenderer.removeListener('app-closing', wrappedCallback);
        };
    },
});
