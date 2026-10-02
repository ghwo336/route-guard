import { getAddress, type Address } from 'viem';
import type { Mode } from '../types';
import type { Whitelist, WhitelistEntry } from './schema';

export type Whitelists = Readonly<Record<number, Whitelist>>;

/** A whitelist entry plus the DEX it belongs to (undefined for utilities). */
export type ScopedEntry = WhitelistEntry & { dex?: string };

export type AllowedSet = {
  routers: ReadonlyMap<Address, ScopedEntry>;
  spenders: ReadonlyMap<Address, ScopedEntry>;
  utilities: ReadonlyMap<Address, ScopedEntry>;
  others: ReadonlyMap<Address, ScopedEntry>;
  feeRecipients: ReadonlyMap<Address, ScopedEntry>;
};

export type Scope = {
  /** Whether the request is checked at all. false → R0. */
  protected: boolean;
  /** The chain has no whitelist but the origin is protected elsewhere → R14. */
  noWhitelist?: boolean;
  /** DEX whose origin matched, if any. */
  dex?: string;
  allowed: AllowedSet;
};

const EMPTY: AllowedSet = {
  routers: new Map(),
  spenders: new Map(),
  utilities: new Map(),
  others: new Map(),
  feeRecipients: new Map(),
};

export function normalizeOrigin(origin: string): string | undefined {
  try {
    const o = new URL(origin).origin;
    return o === 'null' ? undefined : o;
  } catch {
    return undefined;
  }
}

export function getWhitelist(chainId: number, whitelists: Whitelists): Whitelist | undefined {
  return whitelists[chainId];
}

function dexForOrigin(wl: Whitelist, origin: string): string | undefined {
  for (const [name, dex] of Object.entries(wl.dexes)) {
    if (dex.origins.includes(origin)) return name;
  }
  return undefined;
}

function buildAllowed(wl: Whitelist, dexNames: string[]): AllowedSet {
  const routers = new Map<Address, ScopedEntry>();
  const spenders = new Map<Address, ScopedEntry>();
  const utilities = new Map<Address, ScopedEntry>();
  const others = new Map<Address, ScopedEntry>();
  const feeRecipients = new Map<Address, ScopedEntry>();
  const put = (m: Map<Address, ScopedEntry>, e: WhitelistEntry, dex?: string) =>
    m.set(getAddress(e.address), { ...e, dex });

  for (const name of dexNames) {
    const dex = wl.dexes[name];
    if (!dex) continue;
    dex.routers.forEach((e) => put(routers, e, name));
    dex.spenders.forEach((e) => put(spenders, e, name));
    dex.others.forEach((e) => put(others, e, name));
    dex.feeRecipients.forEach((e) => put(feeRecipients, e, name));
  }
  wl.utilities.forEach((e) => put(utilities, e));
  return { routers, spenders, utilities, others, feeRecipients };
}

/**
 * Decide whether `origin` is checked on `chainId` and which addresses count as official.
 * - scoped: only the DEX whose origin matches (+ utilities)
 * - global: every DEX (+ utilities), for any origin
 * - no whitelist for the chain: R14 if the origin is protected on some other chain, else R0
 */
export function resolveScope(
  origin: string,
  chainId: number,
  mode: Mode,
  whitelists: Whitelists,
): Scope {
  const o = normalizeOrigin(origin);
  const wl = getWhitelist(chainId, whitelists);

  if (!wl) {
    const knownElsewhere =
      o !== undefined && Object.values(whitelists).some((w) => dexForOrigin(w, o) !== undefined);
    if (mode === 'global' || knownElsewhere) {
      return { protected: true, noWhitelist: true, allowed: EMPTY };
    }
    return { protected: false, allowed: EMPTY };
  }

  const dex = o === undefined ? undefined : dexForOrigin(wl, o);
  if (mode === 'global') {
    return { protected: true, dex, allowed: buildAllowed(wl, Object.keys(wl.dexes)) };
  }
  if (dex === undefined) return { protected: false, allowed: EMPTY };
  return { protected: true, dex, allowed: buildAllowed(wl, [dex]) };
}

/** Find which list (if any) an address belongs to in the allowed set. */
export function lookup(
  allowed: AllowedSet,
  address: Address | undefined,
): { role: keyof AllowedSet; entry: ScopedEntry } | undefined {
  if (!address) return undefined;
  const a = getAddress(address);
  for (const role of ['routers', 'spenders', 'utilities', 'others', 'feeRecipients'] as const) {
    const entry = allowed[role].get(a);
    if (entry) return { role, entry };
  }
  return undefined;
}
