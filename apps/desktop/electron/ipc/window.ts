import { BrowserWindow, ipcMain } from 'electron';

export function registerWindowHandlers(mainWindow: BrowserWindow): void {
    ipcMain.handle('window:minimize', () => mainWindow.minimize());
    ipcMain.handle('window:maximize', () => {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    });
    ipcMain.handle('window:close', () => mainWindow.close());
}
