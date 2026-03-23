import { ipcMain } from 'electron';
import Store from 'electron-store';
import { encryptString, decryptString } from '../services/encryption';
import { validateIPC, schemas } from '../utils/validate';

export function registerTokenHandlers(store: Store): void {
    ipcMain.handle('tokens:get', (_, platform: unknown) => {
        const validPlatform = validateIPC(schemas.platform, platform, 'tokens:get');
        const encrypted = store.get(`tokens.${validPlatform}`) as string;
        if (!encrypted) return null;
        return decryptString(encrypted);
    });

    ipcMain.handle('tokens:set', (_, platform: unknown, token: unknown) => {
        const validPlatform = validateIPC(schemas.platform, platform, 'tokens:set');
        const validToken = validateIPC(schemas.token, token, 'tokens:set');
        const encrypted = encryptString(validToken);
        store.set(`tokens.${validPlatform}`, encrypted);
        return true;
    });

    ipcMain.handle('tokens:delete', (_, platform: unknown) => {
        const validPlatform = validateIPC(schemas.platform, platform, 'tokens:delete');
        store.delete(`tokens.${validPlatform}`);
        return true;
    });

    // NOTE: tokens:getAll intentionally removed for security.
    // Renderer should never have access to all tokens at once.
}
