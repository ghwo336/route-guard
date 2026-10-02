import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['core/**/*.test.ts', 'lib/**/*.test.ts', 'scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['core/**/*.ts', 'lib/**/*.ts'],
      exclude: ['**/*.test.ts', 'core/fixtures/**', 'core/**/*.json'],
    },
  },
});
