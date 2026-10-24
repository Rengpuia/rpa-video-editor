/**
 * RPA Video Editor - Native Desktop Application (Electron)
 * Developer: K Vanlalrengpuia (rengakhiangte@gmail.com)
 * License: Open Source (MIT)
 *
 * Provides a 100% offline desktop window shell with hardware-accelerated
 * canvas, integrated local media server, and direct screen/webcam recording.
 */

const { app, BrowserWindow, session, desktopCapturer, ipcMain, Menu } = require('electron');
const path = require('path');

// Ensure offline desktop environment
process.env.OFFLINE_DESKTOP = '1';

// Import and start internal studio server
const { server, start, PORT, HOST } = require('./server/server');

let mainWindow = null;

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
