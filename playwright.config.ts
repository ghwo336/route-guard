import { defineConfig } from '@playwright/test';

// `pnpm e2e` builds the extension first (.output/chrome-mv3), then runs these tests in
// Chromium with the extension loaded and a stub EIP-1193 wallet injected into pages.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  webServer: [
    {
      command: 'pnpm playground',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      // same page on an origin that is not protected → R0
      command: 'pnpm playground:unprotected',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
