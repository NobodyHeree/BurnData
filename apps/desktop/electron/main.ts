import { app, BrowserWindow, session, shell } from 'electron';
import path from 'path';
import Store from 'electron-store';
import { registerAllHandlers } from './ipc';
import { JobQueueManager } from './services/jobQueue';

// Initialize store (no encryption key needed as we use safeStorage manually)
// We still use it for non-sensitive config
const store = new Store({
    name: 'burndata-config',
});

const jobManager = new JobQueueManager(store);

let mainWindow: BrowserWindow | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        frame: false,
        titleBarStyle: 'hidden',
        trafficLightPosition: { x: 15, y: 15 },
        backgroundColor: '#09090b',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            // webSecurity defaults to true - API calls routed via IPC
        },
    });

    // Content Security Policy (production only — Vite dev server needs inline scripts for HMR)
    if (!isDev) {
        session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
            // Only apply CSP to our own app pages, not login windows on other partitions
            const isAppPage = details.url.startsWith('file://') || details.url.startsWith('devtools://');
            if (!isAppPage) {
                callback({ responseHeaders: details.responseHeaders });
                return;
            }
            callback({
                responseHeaders: {
                    ...details.responseHeaders,
                    'Content-Security-Policy': [
                        "default-src 'self'; " +
                        "script-src 'self'; " +
                        "style-src 'self' 'unsafe-inline'; " +
                        "img-src 'self' data: https://cdn.discordapp.com https://image.api.playstation.com; " +
                        "connect-src 'self' https://discord.com https://*.discord.com https://*.playstation.com; " +
                        "font-src 'self'; " +
                        "object-src 'none'; " +
                        "base-uri 'self'"
                    ],
                },
            });
        });
    }

    jobManager.setMainWindow(mainWindow);
    registerAllHandlers(mainWindow, store, jobManager);

    if (isDev) {
        const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
        mainWindow.loadURL(devServerUrl);
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Recover orphaned jobs from previous session
    jobManager.recoverOrphanedJobs();
}

// App lifecycle
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
