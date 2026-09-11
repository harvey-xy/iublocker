import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    name: 'extension',
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
  },
});
