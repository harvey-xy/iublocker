import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'tools',
    root: import.meta.dirname,
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
