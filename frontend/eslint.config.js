import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['dist', 'node_modules', 'coverage'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      // Catch the genuine hooks bug (conditional/looped hook calls). The newer
      // react-hooks "recommended" preset also flags the ordinary setState-in-
      // effect pattern used throughout this app, and exhaustive-deps is advisory
      // (several effects intentionally omit deps) — both are left off here.
      'react-hooks/rules-of-hooks': 'error',
      // Allow intentionally-unused capitalised/underscored bindings (e.g. `_drop`
      // rest-destructuring discards, constant imports kept for clarity).
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      // Empty `catch {}` (fire-and-forget best-effort calls) is used throughout.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // Test files run under vitest/jsdom with node + browser globals.
    files: ['**/*.test.{js,jsx}', 'src/tests/**'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.vitest },
    },
  },
]
