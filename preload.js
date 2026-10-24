/**
 * RPA Video Editor - Desktop Preload Script
 * Provides secure bridge between Electron main process and Studio Renderer.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rpaNative', {
    isDesktop: true,
    platform: process.platform,
    version: '2.0.0',
    selectDirectory: (options) => ipcRenderer.invoke('dialog:select-directory', options),
    showSaveProjectDialog: (options) => ipcRenderer.invoke('dialog:show-save-project', options),
    saveProjectToDisk: (data) => ipcRenderer.invoke('project:save-to-disk', data),
    saveExportedFile: (data) => ipcRenderer.invoke('export:save-file', data),
    setDirtyState: (isDirty) => ipcRenderer.send('app:set-dirty', isDirty),
    onPromptSaveBeforeClose: (callback) => ipcRenderer.on('app:prompt-save-before-close', callback),
    confirmSaveComplete: (proceedToClose) => ipcRenderer.send('app:save-completed', proceedToClose)
});
