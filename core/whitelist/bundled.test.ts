import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import mainnetJson from './1.json';
import sepoliaJson from './11155111.json';
import { BUNDLED_WHITELISTS, lookup, resolveScope } from './index';
import { whitelistSchema, type Whitelist } from './schema';

const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const PLAYGROUND = 'http://localhost:5173';

function allEntries(wl: Whitelist) {
  return [
    ...Object.values(wl.dexes).flatMap((d) => [
      ...d.routers,
      ...d.spenders,
      ...d.others,
      ...d.feeRecipients,
    ]),
    ...wl.utilities,
  ];
}

describe('bundled whitelists', () => {
  it.each([
    [1, mainnetJson],
    [11155111, sepoliaJson],
  ])('chain %i passes the schema and matches its file name', (chainId, json) => {
    const wl = whitelistSchema.parse(json);
    expect(wl.chainId).toBe(chainId);
    expect(BUNDLED_WHITELISTS[chainId]).toBeDefined();
  });

  it('every entry has an https source', () => {
    for (const wl of Object.values(BUNDLED_WHITELISTS)) {
      for (const entry of allEntries(wl)) expect(entry.source).toMatch(/^https:\/\//);
    }
  });

  it('every UniversalRouter has a version', () => {
    for (const wl of Object.values(BUNDLED_WHITELISTS)) {
      for (const dex of Object.values(wl.dexes)) {
        for (const r of dex.routers.filter((r) => r.label.startsWith('UniversalRouter'))) {
          expect(r.version).toMatch(/^\d+\.\d+(\.\d+)?$/);
        }
      }
    }
  });

  it('the playground origin is never on mainnet', () => {
    const mainnet = BUNDLED_WHITELISTS[1]!;
    for (const dex of Object.values(mainnet.dexes)) expect(dex.origins).not.toContain(PLAYGROUND);
    expect(resolveScope(PLAYGROUND, 1, 'scoped', BUNDLED_WHITELISTS).protected).toBe(false);
  });

  it('the playground origin covers both DEXes on Sepolia', () => {
    const s = resolveScope(PLAYGROUND, 11155111, 'scoped', BUNDLED_WHITELISTS);
    expect(s.dexes).toEqual(['uniswap', 'cow']);
  });

  it('Permit2 is a Uniswap spender on both chains', () => {
    for (const chainId of [1, 11155111]) {
      const s = resolveScope('https://app.uniswap.org', chainId, 'scoped', BUNDLED_WHITELISTS);
      expect(lookup(s.allowed, PERMIT2)?.entry.label).toBe('Permit2');
    }
  });

  it('CoW scope does not include Uniswap contracts', () => {
    const s = resolveScope('https://swap.cow.fi', 1, 'scoped', BUNDLED_WHITELISTS);
    expect(lookup(s.allowed, PERMIT2)).toBeUndefined();
    expect(s.allowed.routers.size).toBe(2);
  });

  it('only SDK-only addresses awaiting a live-site check are unverified', () => {
    const unverified = new Set<string>();
    for (const wl of Object.values(BUNDLED_WHITELISTS)) {
      for (const e of allEntries(wl)) if (!e.verified) unverified.add(e.label);
    }
    expect([...unverified].sort()).toEqual([
      'ExclusiveDutchOrderReactor (UniswapX)', // Sepolia, SDK only
      'SwapProxy',
      'UniversalRouter 2.2.0',
      'V2DutchOrderReactor (UniswapX)', // Sepolia, SDK only
      'V3DutchOrderReactor (UniswapX)', // mainnet, SDK only
    ]);
  });

  it('no address appears under two different labels', () => {
    for (const wl of Object.values(BUNDLED_WHITELISTS)) {
      const labels = new Map<string, string>();
      for (const e of allEntries(wl)) {
        const a = getAddress(e.address);
        const prev = labels.get(a);
        if (prev) expect(prev).toBe(e.label);
        labels.set(a, e.label);
      }
    }
  });
});
