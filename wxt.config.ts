import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'route-guard',
    description: 'Verify what you sign, not what you see.',
    permissions: ['storage'],
  },
});
