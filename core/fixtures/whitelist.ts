import type { Address } from 'viem';
import { BUNDLED_WHITELISTS } from '../whitelist';
import type { WhitelistEntry } from '../whitelist/schema';

/** Look up a bundled whitelist address by chain, dex and label so fixtures never hardcode one. */
export function wl(chainId: number, dex: string | 'utilities', label: string): Address {
  const w = BUNDLED_WHITELISTS[chainId];
  if (!w) throw new Error(`no whitelist for ${chainId}`);
  const entries: WhitelistEntry[] =
    dex === 'utilities'
      ? w.utilities
      : (() => {
          const d = w.dexes[dex];
          if (!d) throw new Error(`no dex ${dex}`);
          return [...d.routers, ...d.spenders, ...d.others, ...d.feeRecipients];
        })();
  const e = entries.find((x) => x.label === label);
  if (!e) throw new Error(`no ${label} in ${dex}@${chainId}`);
  return e.address;
}
