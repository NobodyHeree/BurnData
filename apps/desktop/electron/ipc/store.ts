import { ipcMain } from 'electron';
import Store from 'electron-store';
import { validateIPC, schemas } from '../utils/validate';

const ALLOWED_STORE_KEYS = [
    'settings',
    'platforms',
    'jobs',
    'onboarding',
    'theme',
    'windowBounds',
    'persistedJobs',
    'persistedQueue',
    'psn_username',
];

function isKeyAllowed(key: string): boolean {
    return ALLOWED_STORE_KEYS.some(
        allowed => key === allowed || key.startsWith(allowed + '.')
    );
}

export function registerStoreHandlers(store: Store): void {
    ipcMain.handle('store:get', (_, key: unknown) => {
        const validKey = validateIPC(schemas.storeKey, key, 'store:get');
        if (!isKeyAllowed(validKey)) {
            throw new Error(`Access denied for store key: ${validKey}`);
        }
        return store.get(validKey);
    });

    ipcMain.handle('store:set', (_, key: unknown, value: unknown) => {
        const validKey = validateIPC(schemas.storeKey, key, 'store:set');
        if (!isKeyAllowed(validKey)) {
            throw new Error(`Access denied for store key: ${validKey}`);
        }
        store.set(validKey, value);
        return true;
    });

    ipcMain.handle('store:delete', (_, key: unknown) => {
        const validKey = validateIPC(schemas.storeKey, key, 'store:delete');
        if (!isKeyAllowed(validKey)) {
            throw new Error(`Access denied for store key: ${validKey}`);
        }
        store.delete(validKey);
        return true;
    });

    ipcMain.handle('store:clear', () => {
        store.clear();
        return true;
    });
}
