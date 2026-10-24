/**
 * RPA Video Editor - Desktop Preload Script
 * Provides secure bridge between Electron main process and Studio Renderer.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rpaNative', {
    isDesktop: true,
    platform: process.platform,
    version: '2.0.0'
});
