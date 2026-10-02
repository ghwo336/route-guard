import { describe, expect, it } from 'vitest';
import { lookup, normalizeOrigin, resolveScope, type Whitelists } from './loader';
import { parseWhitelist } from './schema';

const SRC = 'https://example.com/source';
const e = (address: string, label: string) => ({ address, label, source: SRC, verified: true });

// Dummy addresses: test data only, not real deployments.
const A = {
  dexARouter: '0x00000000000000000000000000000000000000a1',
  dexASpender: '0x00000000000000000000000000000000000000a2',
  dexAOther: '0x00000000000000000000000000000000000000a3',
  dexAFee: '0x00000000000000000000000000000000000000a4',
  dexBRouter: '0x00000000000000000000000000000000000000b1',
  dexBSpender: '0x00000000000000000000000000000000000000b2',
  weth: '0x00000000000000000000000000000000000000c1',
};

const wl = parseWhitelist({
  chainId: 1,
  dexes: {
    a: {
      origins: ['https://a.example'],
      routers: [e(A.dexARouter, 'RouterA')],
      spenders: [e(A.dexASpender, 'SpenderA')],
      others: [e(A.dexAOther, 'OtherA')],
      feeRecipients: [e(A.dexAFee, 'FeeA')],
    },
    b: {
      origins: ['https://b.example'],
      routers: [e(A.dexBRouter, 'RouterB')],
      spenders: [e(A.dexBSpender, 'SpenderB')],
    },
  },
  utilities: [e(A.weth, 'WETH')],
});

const whitelists: Whitelists = { 1: wl };

describe('parseWhitelist', () => {
  it('checksums addresses and defaults optional lists', () => {
    expect(wl.dexes.b?.others).toEqual([]);
    expect(wl.dexes.a?.routers[0]?.address).toBe('0x00000000000000000000000000000000000000A1');
  });

  it('rejects bad addresses, missing source, and non-origin URLs', () => {
    const base = { chainId: 1, dexes: {}, utilities: [] };
    expect(() => parseWhitelist({ ...base, utilities: [e('0x1234', 'x')] })).toThrow();
    expect(() =>
      parseWhitelist({ ...base, utilities: [{ address: A.weth, label: 'x', verified: true }] }),
    ).toThrow();
    expect(() =>
      parseWhitelist({
        ...base,
        dexes: { a: { origins: ['https://a.example/path'], routers: [], spenders: [] } },
      }),
    ).toThrow();
  });
});

describe('resolveScope', () => {
  it('scoped + matching origin: only that DEX + utilities', () => {
    const s = resolveScope('https://a.example', 1, 'scoped', whitelists);
    expect(s.protected).toBe(true);
    expect(s.dex).toBe('a');
    expect(lookup(s.allowed, A.dexARouter as `0x${string}`)?.role).toBe('routers');
    expect(lookup(s.allowed, A.dexAFee as `0x${string}`)?.role).toBe('feeRecipients');
    expect(lookup(s.allowed, A.weth as `0x${string}`)?.role).toBe('utilities');
    expect(lookup(s.allowed, A.dexBRouter as `0x${string}`)).toBeUndefined();
  });

  it('scoped + non-matching origin: unprotected', () => {
    const s = resolveScope('https://app.aave.com', 1, 'scoped', whitelists);
    expect(s.protected).toBe(false);
    expect(s.allowed.routers.size).toBe(0);
  });

  it('origin must match exactly (no subdomain / path tricks)', () => {
    expect(resolveScope('https://a.example.evil.com', 1, 'scoped', whitelists).protected).toBe(
      false,
    );
    expect(resolveScope('http://a.example', 1, 'scoped', whitelists).protected).toBe(false);
    expect(resolveScope('https://a.example/swap', 1, 'scoped', whitelists).dex).toBe('a');
  });

  it('global: every DEX for any origin', () => {
    const s = resolveScope('https://anything.example', 1, 'global', whitelists);
    expect(s.protected).toBe(true);
    expect(s.dex).toBeUndefined();
    expect(lookup(s.allowed, A.dexARouter as `0x${string}`)?.entry.dex).toBe('a');
    expect(lookup(s.allowed, A.dexBSpender as `0x${string}`)?.entry.dex).toBe('b');
  });

  it('chain without whitelist: R14 for origins protected elsewhere, R0 otherwise', () => {
    expect(resolveScope('https://a.example', 42161, 'scoped', whitelists)).toMatchObject({
      protected: true,
      noWhitelist: true,
    });
    expect(resolveScope('https://app.aave.com', 42161, 'scoped', whitelists).protected).toBe(false);
    expect(resolveScope('https://app.aave.com', 42161, 'global', whitelists)).toMatchObject({
      protected: true,
      noWhitelist: true,
    });
  });

  it('handles junk origins', () => {
    expect(normalizeOrigin('not a url')).toBeUndefined();
    expect(normalizeOrigin('null')).toBeUndefined();
    expect(resolveScope('not a url', 1, 'scoped', whitelists).protected).toBe(false);
    expect(resolveScope('not a url', 42161, 'scoped', whitelists).protected).toBe(false);
  });

  it('lookup handles undefined and lowercase input', () => {
    const s = resolveScope('https://a.example', 1, 'scoped', whitelists);
    expect(lookup(s.allowed, undefined)).toBeUndefined();
    expect(lookup(s.allowed, A.dexASpender as `0x${string}`)?.role).toBe('spenders');
  });
});
