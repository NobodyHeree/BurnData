import { app, BrowserWindow, ipcMain } from 'electron';
import Store from 'electron-store';
import { registerWindowHandlers } from './window';
import { registerStoreHandlers } from './store';
import { registerTokenHandlers } from './tokens';
import { registerDiscordHandlers } from './discord';
import { registerPSNHandlers } from './psn';

import { JobQueueManager } from '../services/jobQueue';

export function registerAllHandlers(
    mainWindow: BrowserWindow,
    store: Store,
    jobManager: JobQueueManager
): void {
    registerWindowHandlers(mainWindow);
    registerStoreHandlers(store);
    registerTokenHandlers(store);
    registerDiscordHandlers(mainWindow, store, jobManager);
    registerPSNHandlers(mainWindow, store);

    // App info
    ipcMain.handle('app:version', () => app.getVersion());
    ipcMain.handle('app:platform', () => process.platform);
}
