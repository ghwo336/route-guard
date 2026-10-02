import { installProviderHooks } from '@/lib/inject/install';
import { createWrapper } from '@/lib/inject/wrap';

// MAIN world: same JS context as the (untrusted) page. Runs before any page script.
export default defineContentScript({
  matches: ['<all_urls>'],
  world: 'MAIN',
  runAt: 'document_start',
  allFrames: true,
  main() {
    const wrap = createWrapper(
      async (_provider, args, original) => {
        console.info('[route-guard] watched request', args.method, args.params);
        return original(args);
      },
      (msg, p) => console.warn(`[route-guard] ${msg}`, p),
    );
    installProviderHooks(window as unknown as Parameters<typeof installProviderHooks>[0], wrap);
  },
});
