import type { Verdict, WatchedMethod } from '@/core/types';
import type { Check } from './client';
import type { WireRequest } from '../bridge/protocol';
import type { Guard, Provider, RequestArgs } from './wrap';

type ProviderState = { chainId?: number; account?: string; subscribed: boolean };

export type GuardDeps = {
  check: (req: WireRequest) => Check;
  /** Native structuredClone captured at document_start. */
  clone: <T>(v: T) => T;
  onVerdict?: (v: Verdict, args: RequestArgs) => void;
};

export const rpcError = (code: number, message: string) =>
  Object.assign(new Error(message), { code });

export const userRejected = () => rpcError(4001, 'User rejected the request.');

function parseChainId(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
  if (typeof v === 'string' && /^(0x[0-9a-fA-F]+|\d+)$/.test(v)) return Number(v);
  return undefined;
}

/**
 * Holds every watched request until the bridge decides. The wallet is called with a
 * private copy of the params taken at entry, so the page cannot swap them after analysis.
 */
export function createGuard(deps: GuardDeps): Guard {
  const states = new WeakMap<object, ProviderState>();

  const stateOf = (p: Provider): ProviderState => {
    let s = states.get(p);
    if (!s) {
      s = { subscribed: false };
      states.set(p, s);
    }
    if (!s.subscribed && typeof p.on === 'function') {
      s.subscribed = true;
      const st = s;
      try {
        p.on('chainChanged', (id: unknown) => {
          st.chainId = parseChainId(id);
        });
        p.on('accountsChanged', (accs: unknown) => {
          st.account = Array.isArray(accs) && typeof accs[0] === 'string' ? accs[0] : undefined;
        });
      } catch {
        // some providers throw on unknown events; fall back to querying every time
        st.subscribed = false;
      }
    }
    return s;
  };

  return async (provider, args, original) => {
    let snapshot: RequestArgs;
    let callArgs: RequestArgs;
    try {
      snapshot = deps.clone({ method: args.method, params: args.params });
      callArgs = deps.clone(snapshot);
    } catch {
      throw rpcError(-32602, 'route-guard: 요청 내용을 복사할 수 없어 보낼 수 없습니다.');
    }

    const st = stateOf(provider);
    if (st.chainId === undefined || !st.subscribed) {
      st.chainId = parseChainId(await original({ method: 'eth_chainId' }).catch(() => undefined));
    }
    if (st.account === undefined || !st.subscribed) {
      const accs = await original({ method: 'eth_accounts' }).catch(() => undefined);
      st.account = Array.isArray(accs) && typeof accs[0] === 'string' ? accs[0] : undefined;
    }

    const { verdict, decision } = deps.check({
      method: snapshot.method as WatchedMethod,
      params: snapshot.params,
      chainId: st.chainId ?? 0,
      from: st.account,
    });
    if (deps.onVerdict)
      verdict.then(
        (v) => deps.onVerdict?.(v, snapshot),
        () => {},
      );

    const d = await decision;
    if (d.decision === 'reject') throw userRejected();
    return original(callArgs);
  };
}
