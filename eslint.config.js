// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/rulesets/**', '.cache/**', 'artifacts/**', '**/*.d.ts', 'e2e/test-results/**', 'e2e/playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    // Scriptlet bodies run in the page MAIN world and are serialised; allow any/globals.
    files: ['packages/scriptlets/src/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off', 'no-console': 'off' },
  },
  {
    files: ['tools/**', 'packages/compiler/src/cli/**', 'e2e/**', '**/scripts/**'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ["**/test/**", "**/*.test.ts", "e2e/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  prettier,
);
