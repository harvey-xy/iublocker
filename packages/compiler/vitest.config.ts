import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { name: 'compiler', include: ['src/**/*.test.ts', 'test/**/*.test.ts'] },
});
