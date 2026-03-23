/** @type {import('eslint').Linter.Config} */
module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        ecmaFeatures: {
            jsx: true,
        },
    },
    plugins: ['@typescript-eslint'],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'prettier',
    ],
    ignorePatterns: ['node_modules', 'dist', 'dist-electron', 'release', 'redact-clone', '**/__tests__/**'],
    rules: {
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/no-unused-vars': [
            'warn',
            { argsIgnorePattern: '^_' },
        ],
        'no-console': 'warn',
        'prefer-const': 'warn',
        'no-case-declarations': 'warn',
        'no-constant-condition': 'warn',
    },
    overrides: [
        {
            files: ['*.tsx'],
            plugins: ['react', 'react-hooks'],
            extends: [
                'plugin:react/recommended',
                'prettier',
            ],
            rules: {
                'react-hooks/rules-of-hooks': 'warn', // TODO: fix conditional hooks in PlatformPage.tsx (Phase 1)
                'react/react-in-jsx-scope': 'off',
                'react/prop-types': 'off',
            },
            settings: {
                react: {
                    version: 'detect',
                },
            },
        },
        {
            files: ['**/electron/**/*.ts'],
            rules: {
                'no-console': 'off',
            },
        },
    ],
};
