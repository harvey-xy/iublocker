import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { name: 'scriptlets', environment: 'jsdom', include: ['src/**/*.test.ts', 'test/**/*.test.ts'] },
});
