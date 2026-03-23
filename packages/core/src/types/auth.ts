export type AuthMethod = 'oauth2' | 'token' | 'session' | 'npsso' | 'phone';

export interface AuthCredentials {
    method: AuthMethod;
    token?: string;
    username?: string;
    password?: string;
    npsso?: string;
    phone?: string;
    code?: string;
}

export interface AuthResult {
    success: boolean;
    userId?: string;
    username?: string;
    displayName?: string;
    avatarUrl?: string;
    token?: string;
    refreshToken?: string;
    expiresAt?: number;
    error?: string;
}

export interface AuthState {
    authenticated: boolean;
    userId?: string;
    username?: string;
    displayName?: string;
    avatarUrl?: string;
}
