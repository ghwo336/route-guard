import { installProviderHooks } from '@/lib/inject/install';
import { createBridgeClient, type PortLike } from '@/lib/inject/client';
import { openChannel } from '@/lib/inject/handshake';
import { createWrapper } from '@/lib/inject/wrap';
import type { WatchedMethod } from '@/core/types';

// MAIN world: same JS context as the (untrusted) page. Runs before any page script, so the
// natives captured here cannot have been tampered with yet.
export default defineContentScript({
  matches: ['<all_urls>'],
  world: 'MAIN',
  runAt: 'document_start',
  allFrames: true,
  main() {
    const clone = globalThis.structuredClone.bind(globalThis);
    const randomUUID = crypto.randomUUID.bind(crypto);
    const setT = window.setTimeout.bind(window);
    const clearT = window.clearTimeout.bind(window);

    const raw = openChannel(window);
    const post = MessagePort.prototype.postMessage.bind(raw) as (m: unknown) => void;
    const port: PortLike = {
      postMessage: post,
      set onmessage(fn: PortLike['onmessage']) {
        raw.onmessage = fn;
      },
      get onmessage() {
        return raw.onmessage as PortLike['onmessage'];
      },
    };
    const client = createBridgeClient(port, {
      setTimeout: (fn, ms) => setT(fn, ms),
      clearTimeout: (t) => clearT(t as number),
      newId: randomUUID,
    });

    const wrap = createWrapper(
      async (_provider, args, original) => {
        const params = clone(args.params);
        const chainId = Number(await original({ method: 'eth_chainId' }));
        const accounts = (await original({ method: 'eth_accounts' }).catch(() => [])) as string[];
        const { verdict } = client.check({
          method: args.method as WatchedMethod,
          params,
          chainId,
          from: accounts[0],
        });
        verdict.then(
          (v) => console.info('[route-guard] verdict', v.level, v.ruleIds, v.summary),
          (e: unknown) => console.warn('[route-guard] no verdict', e),
        );
        return original(args);
      },
      (msg, p) => console.warn(`[route-guard] ${msg}`, p),
    );
    installProviderHooks(window as unknown as Parameters<typeof installProviderHooks>[0], wrap);
  },
});
