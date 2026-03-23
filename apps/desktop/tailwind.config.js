/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
        "../../packages/ui/src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                // BurnData fire palette
                fire: {
                    DEFAULT: '#FF3B00',
                    light: '#ff5722',
                    dark: '#cc2f00',
                    glow: 'rgba(255,59,0,0.15)',
                },
                gold: {
                    DEFAULT: '#FFB800',
                    light: '#ffc633',
                    dark: '#cc9300',
                },
                burn: {
                    green: '#00FF88',
                    red: '#FF3B3B',
                    cream: '#FFF5E0',
                    text: '#E8D9B5',
                    muted: '#8C7A50',
                },
                // Keep discord colors for platform-specific use
                discord: {
                    blurple: '#5865F2',
                    green: '#57F287',
                    yellow: '#FEE75C',
                    fuchsia: '#EB459E',
                    red: '#ED4245',
                },
                // Dark theme — warm tinted
                dark: {
                    50: '#FFF5E0',
                    100: '#E8D9B5',
                    200: '#c4a872',
                    300: '#a08550',
                    400: '#8C7A50',
                    500: '#6b5a38',
                    600: '#4a3d24',
                    700: '#2d2210',
                    800: '#1A1200',
                    850: '#140e00',
                    900: '#0F0A00',
                    950: '#080500',
                },
            },
            fontFamily: {
                'display': ['"Bebas Neue"', 'sans-serif'],
                'heading': ['"Barlow Condensed"', 'sans-serif'],
                'body': ['Barlow', 'sans-serif'],
                'mono': ['"JetBrains Mono"', 'monospace'],
            },
            animation: {
                'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'spin-slow': 'spin 2s linear infinite',
                'bounce-subtle': 'bounce 2s ease-in-out infinite',
                'flame-pulse': 'flamePulse 3s ease-in-out infinite',
                'glow-pulse': 'glowPulse 2s ease-in-out infinite',
            },
            keyframes: {
                flamePulse: {
                    '0%, 100%': { opacity: '0.08', transform: 'scale(1)' },
                    '50%': { opacity: '0.14', transform: 'scale(1.05)' },
                },
                glowPulse: {
                    '0%, 100%': { boxShadow: '0 0 15px rgba(255,59,0,0.1)' },
                    '50%': { boxShadow: '0 0 25px rgba(255,59,0,0.25)' },
                },
            },
            backdropBlur: {
                xs: '2px',
            },
        },
    },
    plugins: [],
};
