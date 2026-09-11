import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/shared',
      'packages/compiler',
      'packages/scriptlets',
      'packages/extension',
    ],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});
