/**
 * RPA Video Editor - Native Desktop Application (Electron)
 * Developer: K Vanlalrengpuia (rengakhiangte@gmail.com)
 * License: Open Source (MIT)
 *
 * Provides a 100% offline desktop window shell with hardware-accelerated
 * canvas, integrated local media server, and direct screen/webcam recording.
 */

const { app, BrowserWindow, session, desktopCapturer, ipcMain, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Ensure offline desktop environment
process.env.OFFLINE_DESKTOP = '1';

// Import and start internal studio server
const { server, start, PORT, HOST } = require('./server/server');

let mainWindow = null;
let isProjectDirty = false;
let isQuittingForced = false;

// --- Security helpers -------------------------------------------------------

const OWN_ORIGIN = `http://${HOST}:${PORT}`;
const PROJECT_EXTENSIONS = ['.rpavideo', '.json'];
const EXPORT_EXTENSIONS = ['.webm', '.mp4', '.mkv', '.mov', '.wav'];

// Paths the user explicitly picked in a native Save dialog during this session.
const approvedSavePaths = new Set();

function isOwnUrl(candidate) {
    try {
        return new URL(candidate).origin === OWN_ORIGIN;
    } catch {
        return false;
    }
}

// Only the studio UI (top-level frame served by our own local server) may use the IPC bridge.
function isTrustedSender(event) {
    try {
        if (event.senderFrame && event.senderFrame.parent) return false;
        const url = event.senderFrame ? event.senderFrame.url : event.sender.getURL();
        return isOwnUrl(url);
    } catch {
        return false;
    }
}

function isExistingDirectory(dir) {
    try {
        return typeof dir === 'string' && path.isAbsolute(dir) && fs.statSync(dir).isDirectory();
    } catch {
        return false;
    }
}

// Reduce any caller-supplied name to a plain, safe file name (no folders, no odd characters).
function sanitizeFileName(name, fallback) {
    const base = path.basename(String(name || '')).replace(/[^a-zA-Z0-9_. -]/g, '_').replace(/^\.+/, '').trim();
    return base || fallback;
}

function withAllowedExtension(name, allowed, defaultExt) {
    return allowed.includes(path.extname(name).toLowerCase()) ? name : `${name}${defaultExt}`;
}

// IPC Handlers: Directory Picker
ipcMain.handle('dialog:select-directory', async (event, options = {}) => {
    if (!mainWindow || !isTrustedSender(event)) return null;
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
    if (!mainWindow || !isTrustedSender(event)) return null;
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
        approvedSavePaths.add(path.resolve(result.filePath));
        return result.filePath;
    }
    return null;
});

// IPC Handlers: Save Project Directly to Disk
ipcMain.handle('project:save-to-disk', async (event, { filePath, content, targetDirectory, fileName } = {}) => {
    if (!isTrustedSender(event)) return { success: false, error: 'Untrusted sender.' };
    try {
        if (typeof content !== 'string') throw new Error('Project content must be text.');

        let destPath;
        if (filePath) {
            // An explicit path is only accepted if the user picked it in the native Save dialog.
            const resolved = path.resolve(String(filePath));
            if (!approvedSavePaths.has(resolved)) {
                throw new Error('Save location was not chosen in the Save dialog.');
            }
            destPath = resolved;
        } else {
            const destDir = isExistingDirectory(targetDirectory)
                ? targetDirectory
                : path.join(app.getPath('documents'), 'RPA Video Editor');
            if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
            const cleanName = withAllowedExtension(sanitizeFileName(fileName, 'project'), PROJECT_EXTENSIONS, '.rpavideo');
            destPath = path.join(destDir, cleanName);
        }
        fs.writeFileSync(destPath, content, 'utf8');
        return { success: true, path: destPath };
    } catch (err) {
        console.error('[Project Save Error]', err);
        return { success: false, error: err.message };
    }
});

// IPC Handlers: Save Exported File Directly to Disk
ipcMain.handle('export:save-file', async (event, { buffer, filename, targetDirectory } = {}) => {
    if (!isTrustedSender(event)) return { success: false, error: 'Untrusted sender.' };
    try {
        if (!(buffer instanceof ArrayBuffer) && !ArrayBuffer.isView(buffer)) {
            throw new Error('Export data must be binary.');
        }
        const destDir = isExistingDirectory(targetDirectory)
            ? targetDirectory
            : path.join(app.getPath('videos'), 'RPA Video Editor');
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        const safeName = withAllowedExtension(sanitizeFileName(filename, `Export_${Date.now()}`), EXPORT_EXTENSIONS, '.webm');
        const filePath = path.join(destDir, safeName);
        const data = buffer instanceof ArrayBuffer
            ? Buffer.from(buffer)
            : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        fs.writeFileSync(filePath, data);
        return { success: true, path: filePath };
    } catch (err) {
        console.error('[Export Save Error]', err);
        return { success: false, error: err.message };
    }
});

// IPC Handlers: Unsaved State & Save Completion
ipcMain.on('app:set-dirty', (event, dirty) => {
    if (!isTrustedSender(event)) return;
    isProjectDirty = Boolean(dirty);
});

ipcMain.on('app:save-completed', (event, proceedToClose) => {
    if (!isTrustedSender(event)) return;
    isProjectDirty = false;
    if (proceedToClose && mainWindow) {
        isQuittingForced = true;
        mainWindow.destroy();
    }
});

async function createWindow() {
    // Start internal server
    try {
        await start(PORT, HOST);
    } catch (e) {
        console.error('[RPA Desktop] Server startup failed:', e.message);
        dialog.showErrorBox('RPA Video Editor could not start', e.message);
        app.quit();
        return;
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
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            preload: path.join(__dirname, 'preload.js'),
            backgroundThrottling: false,
            webgl: true
        }
    });

    // Remove default menu bar for clean professional studio look
    Menu.setApplicationMenu(null);

    // Desktop Media Capture handler for high-performance screen recording
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        if (!isOwnUrl(request.securityOrigin)) {
            callback({});
            return;
        }
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

    // Allow recording-related permissions, but only for the studio UI itself
    const allowedPermissions = ['media', 'display-capture', 'mediaKeySystem', 'notifications', 'fullscreen'];
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
        const requester = (details && details.requestingUrl) || webContents.getURL();
        callback(allowedPermissions.includes(permission) && isOwnUrl(requester));
    });
    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
        return allowedPermissions.includes(permission) && isOwnUrl(requestingOrigin);
    });

    // Keep the window locked to the studio UI
    mainWindow.webContents.on('will-navigate', (event, navUrl) => {
        if (!isOwnUrl(navUrl)) event.preventDefault();
    });
    mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        // Hand mail/web links to the system; never open new app windows
        if (/^(mailto:|https:)/i.test(url)) {
            shell.openExternal(url).catch(() => {});
        }
        return { action: 'deny' };
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
                isProjectDirty = false;
                mainWindow.destroy();
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
