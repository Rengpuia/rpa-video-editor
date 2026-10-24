/**
 * RPA Video Editor - Native Desktop Application (Electron)
 * Developer: K Vanlalrengpuia (rengakhiangte@gmail.com)
 * License: Open Source (MIT)
 *
 * Provides a 100% offline desktop window shell with hardware-accelerated
 * canvas, integrated local media server, and direct screen/webcam recording.
 */

const { app, BrowserWindow, session, desktopCapturer, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Ensure offline desktop environment
process.env.OFFLINE_DESKTOP = '1';

// Import and start internal studio server
const { server, start, PORT, HOST } = require('./server/server');

let mainWindow = null;
let isProjectDirty = false;
let isQuittingForced = false;

// IPC Handlers: Directory Picker
ipcMain.handle('dialog:select-directory', async (event, options = {}) => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
        title: options.title || 'Select Folder Destination',
        defaultPath: options.defaultPath,
        properties: ['openDirectory', 'createDirectory']
    });
    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

// IPC Handlers: Native Save Project Dialog
ipcMain.handle('dialog:show-save-project', async (event, { defaultName, defaultPath } = {}) => {
    if (!mainWindow) return null;
    const initialName = (defaultName || 'project').replace(/[^a-zA-Z0-9_-]/g, '_');
    const startPath = defaultPath || path.join(app.getPath('documents'), 'RPA Video Editor', `${initialName}.rpavideo`);
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Save RPA Video Project',
        defaultPath: startPath,
        filters: [
            { name: 'RPA Video Project (*.rpavideo)', extensions: ['rpavideo'] },
            { name: 'JSON Project File (*.json)', extensions: ['json'] },
            { name: 'All Files (*.*)', extensions: ['*'] }
        ]
    });
    if (!result.canceled && result.filePath) {
        return result.filePath;
    }
    return null;
});

// IPC Handlers: Save Project Directly to Disk
ipcMain.handle('project:save-to-disk', async (event, { filePath, content, targetDirectory, fileName }) => {
    try {
        let destPath = filePath;
        if (!destPath) {
            const destDir = (targetDirectory && fs.existsSync(targetDirectory))
                ? targetDirectory
                : path.join(app.getPath('documents'), 'RPA Video Editor');
            if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
            const cleanName = (fileName || 'project').replace(/[^a-zA-Z0-9_.-]/g, '_');
            destPath = path.join(destDir, cleanName.endsWith('.rpavideo') || cleanName.endsWith('.json') ? cleanName : `${cleanName}.rpavideo`);
        }
        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(destPath, content, 'utf8');
        return { success: true, path: destPath };
    } catch (err) {
        console.error('[Project Save Error]', err);
        return { success: false, error: err.message };
    }
});

// IPC Handlers: Save Exported File Directly to Disk
ipcMain.handle('export:save-file', async (event, { buffer, filename, targetDirectory }) => {
    try {
        const destDir = (targetDirectory && fs.existsSync(targetDirectory)) 
            ? targetDirectory 
            : path.join(app.getPath('videos'), 'RPA Video Editor');
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        const filePath = path.join(destDir, filename || `Export_${Date.now()}.webm`);
        fs.writeFileSync(filePath, Buffer.from(buffer));
        return { success: true, path: filePath };
    } catch (err) {
        console.error('[Export Save Error]', err);
        return { success: false, error: err.message };
    }
});

// IPC Handlers: Unsaved State & Save Completion
ipcMain.on('app:set-dirty', (event, dirty) => {
    isProjectDirty = Boolean(dirty);
});

ipcMain.on('app:save-completed', (event, proceedToClose) => {
    isProjectDirty = false;
    if (proceedToClose && mainWindow) {
        isQuittingForced = true;
        mainWindow.close();
    }
});

async function createWindow() {
    // Start internal server
    try {
        await start(PORT, HOST);
    } catch (e) {
        console.warn('[RPA Desktop] Server startup notification:', e.message);
    }

    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 700,
        title: 'RPA Video Editor - Studio Pro',
        icon: path.join(__dirname, 'client', 'favicon.ico'),
        backgroundColor: '#101216',
        autoHideMenuBar: true,
        show: false, // Show when ready to prevent white flash
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            backgroundThrottling: false,
            webgl: true
        }
    });

    // Remove default menu bar for clean professional studio look
    Menu.setApplicationMenu(null);

    // Desktop Media Capture handler for high-performance screen recording
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
            if (sources && sources.length > 0) {
                // Return primary screen stream
                callback({ video: sources[0] });
            } else {
                callback({});
            }
        }).catch((err) => {
            console.error('[RPA Desktop] Capture error:', err);
            callback({});
        });
    });

    // Automatically allow media permissions for recording
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowed = ['media', 'display-capture', 'mediaKeySystem', 'notifications', 'fullscreen'];
        if (allowed.includes(permission)) {
            callback(true);
        } else {
            callback(false);
        }
    });

    // Load Studio UI from local media server
    mainWindow.loadURL(`http://${HOST}:${PORT}`);

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
    });

    mainWindow.on('close', (e) => {
        if (isProjectDirty && !isQuittingForced) {
            e.preventDefault();
            const choice = dialog.showMessageBoxSync(mainWindow, {
                type: 'question',
                buttons: ['Save Project', "Don't Save", 'Cancel'],
                defaultId: 0,
                cancelId: 2,
                title: 'Unsaved Project Changes',
                message: 'You have unsaved changes in your project.\nDo you want to save before closing?'
            });
            if (choice === 0) { // Save Project
                mainWindow.webContents.send('app:prompt-save-before-close');
            } else if (choice === 1) { // Don't Save
                isQuittingForced = true;
                mainWindow.close();
            }
            // If Cancel (choice === 2), event was prevented so stays open!
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Single instance enforcement
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(createWindow);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    if (server && server.listening) {
        try {
            server.close();
        } catch (e) {}
    }
});
