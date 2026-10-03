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
    expect(s.dexes).toEqual(['uniswap', 'cow', 'sushiswap', 'balancer']);
  });

  it('Permit2 is a Uniswap spender on both chains', () => {
    for (const chainId of [1, 11155111]) {
      const s = resolveScope('https://app.uniswap.org', chainId, 'scoped', BUNDLED_WHITELISTS);
      expect(lookup(s.allowed, PERMIT2)?.entry.label).toBe('Permit2');
    }
  });

  it('SushiSwap: redirect domain is protected too; RedSnwapper is router and spender', () => {
    const RS = '0xAC4c6e212A361c968F1725b4d055b47E63F80b75';
    for (const origin of ['https://sushi.com', 'https://www.sushi.com']) {
      const s = resolveScope(origin, 1, 'scoped', BUNDLED_WHITELISTS);
      expect(s.dexes).toEqual(['sushiswap']);
      expect(s.allowed.routers.get(RS)?.label).toBe('RedSnwapper');
      expect(s.allowed.spenders.get(RS)?.label).toBe('RedSnwapper');
      expect(s.allowed.routers.size).toBe(1);
    }
    expect(
      resolveScope('https://www.sushi.com', 11155111, 'scoped', BUNDLED_WHITELISTS).dexes,
    ).toEqual(['sushiswap']);
  });

  it('Curve: mainnet only, redirect domains protected, Router NG v1.2.0 is router and spender', () => {
    const ROUTER = '0x45312ea0eFf7E09C83CBE249fa1d7598c4C8cd4e';
    for (const origin of [
      'https://curve.fi',
      'https://www.curve.fi',
      'https://curve.finance',
      'https://www.curve.finance',
    ]) {
      const s = resolveScope(origin, 1, 'scoped', BUNDLED_WHITELISTS);
      expect(s.dexes).toEqual(['curve']);
      expect(s.allowed.routers.get(ROUTER)?.label).toBe('Router NG v1.2.0');
      expect(s.allowed.spenders.has(ROUTER)).toBe(true);
    }
    // no Sepolia deployment: Sepolia has a whitelist without Curve, so the origin is R0 there
    expect(
      resolveScope('https://www.curve.finance', 11155111, 'scoped', BUNDLED_WHITELISTS),
    ).toMatchObject({
      protected: false,
    });
  });

  it('Balancer: V2 Vault / V3 routers / Relayer v6 as routers; Vault, Permit2, Relayer as spenders', () => {
    for (const chainId of [1, 11155111]) {
      for (const origin of [
        'https://balancer.fi',
        'https://www.balancer.fi',
        'https://app.balancer.fi',
      ]) {
        const s = resolveScope(origin, chainId, 'scoped', BUNDLED_WHITELISTS);
        expect(s.dexes).toEqual(['balancer']);
        expect([...s.allowed.routers.values()].map((e) => e.label).sort()).toEqual([
          'BalancerRelayer v6',
          'V3 BatchRouter',
          'V3 Router v2',
          'Vault V2',
        ]);
        expect([...s.allowed.spenders.values()].map((e) => e.label).sort()).toEqual([
          'BalancerRelayer v6',
          'Permit2',
          'Vault V2',
        ]);
      }
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
