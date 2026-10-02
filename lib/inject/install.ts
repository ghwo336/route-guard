import { isProvider } from './wrap';

type Win = EventTarget & {
  ethereum?: unknown;
  setTimeout: (fn: () => void, ms: number) => unknown;
  document?: EventTarget;
};

/**
 * Find every injected provider and pass it to `wrap`:
 * - `window.ethereum` (now, on assignment, on `ethereum#initialized`, and a few late re-checks
 *   for wallets that redefine the property), including `ethereum.providers[]`
 * - EIP-6963 `eip6963:announceProvider` events (and we request a re-announce)
 */
export function installProviderHooks(win: Win, wrap: (p: unknown) => void): void {
  const fromEthereum = () => {
    const eth = win.ethereum;
    wrap(eth);
    const list = isProvider(eth) ? (eth as { providers?: unknown }).providers : undefined;
    if (Array.isArray(list)) list.forEach(wrap);
  };

  fromEthereum();

  if (!Object.getOwnPropertyDescriptor(win, 'ethereum')) {
    let current: unknown;
    try {
      Object.defineProperty(win, 'ethereum', {
        configurable: true,
        enumerable: true,
        get: () => current,
        set: (v: unknown) => {
          current = v;
          fromEthereum();
        },
      });
    } catch {
      // another script owns the property; the re-checks below still apply
    }
  }

  win.addEventListener('ethereum#initialized', fromEthereum);
  win.addEventListener('eip6963:announceProvider', (e: Event) => {
    wrap((e as CustomEvent<{ provider?: unknown }>).detail?.provider);
  });
  win.dispatchEvent(new Event('eip6963:requestProvider'));

  win.document?.addEventListener('DOMContentLoaded', fromEthereum);
  win.addEventListener('load', fromEthereum);
  for (const ms of [0, 50, 250, 1000, 3000]) win.setTimeout(fromEthereum, ms);
}
