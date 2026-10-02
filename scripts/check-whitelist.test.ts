import { describe, expect, it } from 'vitest';
import mainnet from '../core/whitelist/1.json' with { type: 'json' };
import { checkWhitelists, unverifiedEntries } from './check-whitelist.mjs';

const entry = (label: string, verified: boolean) => ({
  address: '0x0000000000000000000000000000000000000001',
  label,
  source: 'https://example.com',
  verified,
});
const wl = (chainId: number, verified: boolean) => ({
  chainId,
  dexes: { a: { origins: [], routers: [entry('R', verified)], spenders: [entry('S', true)] } },
  utilities: [entry('WETH', verified)],
});

describe('check:whitelist', () => {
  it('lists unverified entries in every role', () => {
    expect(unverifiedEntries(wl(1, false)).map((e) => `${e.group}:${e.label}`)).toEqual([
      'a.routers:R',
      'utilities:WETH',
    ]);
    expect(unverifiedEntries({})).toEqual([]);
  });

  it('mainnet unverified → error, Sepolia unverified → warning only', () => {
    const r = checkWhitelists([
      { file: '1.json', json: wl(1, false) },
      { file: '11155111.json', json: wl(11155111, false) },
    ]);
    expect(r.errors).toHaveLength(2);
    expect(r.warnings).toHaveLength(2);
    expect(r.errors[0]).toContain('1.json (chainId 1) a.routers: R');
  });

  it('all verified → clean', () => {
    expect(checkWhitelists([{ file: '1.json', json: wl(1, true) }])).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it('a missing verified flag counts as unverified', () => {
    const j = wl(1, true);
    delete (j.utilities[0] as Partial<ReturnType<typeof entry>>).verified;
    expect(checkWhitelists([{ file: '1.json', json: j }]).errors).toHaveLength(1);
  });

  it('reports the current bundled mainnet list', () => {
    const labels = unverifiedEntries(mainnet).map((e) => e.label);
    // These await a live-site check (PLAN.md 18, 19). Update when they are confirmed.
    expect(labels).toEqual([
      'UniversalRouter 2.2.0',
      'SwapProxy',
      'SwapProxy',
      'V3DutchOrderReactor (UniswapX)',
    ]);
  });
});
