import { safeStorage } from 'electron';

export function encryptString(value: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Secure storage is not available on this system. Cannot store sensitive data.');
    }
    return safeStorage.encryptString(value).toString('base64');
}

export function decryptString(encrypted: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Secure storage is not available on this system. Cannot read sensitive data.');
    }
    try {
        return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch (e) {
        console.error('Failed to decrypt:', e);
        throw e;
    }
}
