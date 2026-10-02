import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['core/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['core/**/*.ts'],
      exclude: ['core/**/*.test.ts', 'core/fixtures/**', 'core/**/*.json'],
    },
  },
});
