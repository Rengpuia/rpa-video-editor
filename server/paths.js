/**
 * RPA Video Editor - Storage & Directory Path Resolver
 * Handles writable paths for Electron packaged (asar/unpacked), Portable, and standalone Node modes.
 */

const path = require('path');
const fs = require('fs');

function resolveStorageDirs() {
    let baseDir = null;

    // 1. Electron Portable mode (portable .exe folder)
    if (process.env.PORTABLE_EXECUTABLE_DIR && fs.existsSync(process.env.PORTABLE_EXECUTABLE_DIR)) {
        baseDir = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'RPA_Studio_Data');
    }
    // 2. Electron packaged mode
    else if (process.versions && process.versions.electron) {
        try {
            const electron = require('electron');
            const app = electron.app || (electron.remote && electron.remote.app);
            if (app && typeof app.getPath === 'function') {
                baseDir = path.join(app.getPath('documents'), 'RPA Video Editor');
            }
        } catch (e) {}
    }

    // 3. Fallback / Standalone Node mode
    if (!baseDir) {
        const root = path.resolve(__dirname, '..');
        // If running inside app.asar (read-only archive)
        if (root.includes('app.asar')) {
            const userDocs = process.env.USERPROFILE || process.env.HOME || process.env.LOCALAPPDATA || '.';
            baseDir = path.join(userDocs, 'Documents', 'RPA Video Editor');
        } else {
            baseDir = root;
        }
    }

    const projectsDir = path.join(baseDir, 'projects');
    const exportsDir = path.join(baseDir, 'exports');

    try {
        if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir, { recursive: true });
        if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
    } catch (err) {
        console.warn('[RPA Paths] Directory initialization notification:', err.message);
    }

    return {
        BASE_DIR: baseDir,
        PROJECTS_DIR: projectsDir,
        EXPORTS_DIR: exportsDir
    };
}

const { BASE_DIR, PROJECTS_DIR, EXPORTS_DIR } = resolveStorageDirs();

// Project IDs become file names, so only a conservative character set is accepted.
// This blocks path separators, "..", drive letters and absolute paths.
const PROJECT_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,119}$/;

function isValidProjectId(id) {
    return typeof id === 'string' && PROJECT_ID_RE.test(id) && !id.includes('..');
}

/** Derive a valid, filesystem-safe project ID from a free-form title. */
function idFromTitle(title, fallback = 'untitled') {
    let id = String(title == null ? '' : title).trim().replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    id = id.replace(/^[_-]+|[_-]+$/g, '').slice(0, 100);
    return id || fallback;
}

/**
 * Resolve a project ID to a .rpavideo path guaranteed to be inside PROJECTS_DIR.
 * Throws an Error for invalid IDs so callers can report a clean failure.
 */
function projectPath(id) {
    if (!isValidProjectId(id)) {
        throw new Error('Invalid project id.');
    }
    const full = path.join(PROJECTS_DIR, `${id}.rpavideo`);
    if (path.dirname(full) !== PROJECTS_DIR) {
        throw new Error('Invalid project id.');
    }
    return full;
}

module.exports = {
    BASE_DIR,
    PROJECTS_DIR,
    EXPORTS_DIR,
    resolveStorageDirs,
    isValidProjectId,
    idFromTitle,
    projectPath
};
