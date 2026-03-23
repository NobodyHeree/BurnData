import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import path from 'path';

// Shared aliases for all builds (renderer + electron main + preload)
const sharedAliases = {
    '@': path.resolve(__dirname, './src'),
    '@services': path.resolve(__dirname, '../../packages/services/src'),
    '@core': path.resolve(__dirname, '../../packages/core/src'),
    '@ui': path.resolve(__dirname, '../../packages/ui/src'),
};

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        electron({
            main: {
                entry: 'electron/main.ts',
                vite: {
                    resolve: {
                        alias: sharedAliases,
                    },
                    build: {
                        outDir: 'dist-electron',
                        rollupOptions: {
                            external: ['electron', 'electron-store'],
                        },
                    },
                },
            },
            preload: {
                input: 'electron/preload.ts',
                vite: {
                    resolve: {
                        alias: sharedAliases,
                    },
                    build: {
                        outDir: 'dist-electron',
                    },
                },
            },
        }),
    ],
    resolve: {
        alias: sharedAliases,
    },
    server: {
        proxy: {
            '/discord-api': {
                target: 'https://discord.com/api/v10',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/discord-api/, ''),
                configure: (proxy) => {
                    proxy.on('proxyRes', (proxyRes) => {
                        // Expose Discord rate limit headers to the browser
                        const expose = [
                            'x-ratelimit-remaining',
                            'x-ratelimit-reset-after',
                            'x-ratelimit-limit',
                            'x-ratelimit-bucket',
                            'retry-after',
                        ].join(', ');
                        proxyRes.headers['access-control-expose-headers'] = expose;
                    });
                },
            },
        },
    },
    build: {
        outDir: 'dist',
    },
    clearScreen: false,
});
