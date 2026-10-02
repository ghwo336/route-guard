import { createBridgeClient, type PortLike } from '@/lib/inject/client';
import { createGuard } from '@/lib/inject/guard';
import { openChannel } from '@/lib/inject/handshake';
import { installProviderHooks } from '@/lib/inject/install';
import { createWrapper } from '@/lib/inject/wrap';

// MAIN world: same JS context as the (untrusted) page. Runs before any page script, so the
// natives captured here cannot have been tampered with yet.
export default defineContentScript({
  matches: ['<all_urls>'],
  world: 'MAIN',
  runAt: 'document_start',
  allFrames: true,
  main() {
    const clone = globalThis.structuredClone.bind(globalThis) as <T>(v: T) => T;
    const randomUUID = crypto.randomUUID.bind(crypto);
    const setT = window.setTimeout.bind(window);
    const clearT = window.clearTimeout.bind(window);
    const info = console.info.bind(console);
    const warn = console.warn.bind(console);

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

    const guard = createGuard({
      check: client.check,
      clone,
      onVerdict: (v, args) => {
        if (v.level === 'LOW') info('[route-guard]', args.method, v.ruleIds, v.summary);
        else warn(`[route-guard] ${v.level}`, args.method, v.ruleIds, v.summary);
      },
    });
    const wrap = createWrapper(guard, (msg, p) => warn(`[route-guard] ${msg}`, p));
    installProviderHooks(window as unknown as Parameters<typeof installProviderHooks>[0], wrap);
  },
});
