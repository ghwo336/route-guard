import { describe, expect, it } from 'vitest';
import { serialize } from '@/core/serialize';
import { BUNDLED_WHITELISTS } from '@/core/whitelist';
import { USER } from '@/core/fixtures/addresses';
import {
  needsDecision,
  runAnalysis,
  senderOrigin,
  timeoutVerdict,
  toSignRequest,
} from './analyzeRequest';

describe('background analyze helpers', () => {
  it('senderOrigin prefers the browser-provided origin', () => {
    expect(senderOrigin({ origin: 'https://app.uniswap.org' }, 'https://evil.example')).toBe(
      'https://app.uniswap.org',
    );
    expect(senderOrigin({ url: 'https://swap.cow.fi/#/1/swap' }, 'x')).toBe('https://swap.cow.fi');
    expect(senderOrigin({}, 'http://localhost:5173')).toBe('http://localhost:5173');
    expect(senderOrigin({ origin: 'null' }, 'nonsense')).toBe('null');
  });

  it('toSignRequest revives bigints', () => {
    const r = toSignRequest(
      {
        method: 'eth_sendTransaction',
        params: serialize([{ value: 5n }]) as unknown,
        chainId: 1,
        from: USER,
      },
      'https://app.uniswap.org',
    );
    expect(r).toEqual({
      method: 'eth_sendTransaction',
      params: [{ value: 5n }],
      chainId: 1,
      from: USER,
      origin: 'https://app.uniswap.org',
    });
  });

  it('timeoutVerdict: R15 when protected, R0 otherwise', () => {
    const base = { method: 'personal_sign' as const, params: [], chainId: 1 };
    expect(
      timeoutVerdict({ ...base, origin: 'https://app.uniswap.org' }, BUNDLED_WHITELISTS, 'scoped'),
    ).toMatchObject({
      level: 'MEDIUM',
      ruleIds: ['R15'],
    });
    expect(
      timeoutVerdict({ ...base, origin: 'https://x.example' }, BUNDLED_WHITELISTS, 'scoped'),
    ).toMatchObject({
      level: 'LOW',
      ruleIds: ['R0'],
    });
  });

  it('runAnalysis / needsDecision', () => {
    const r = {
      method: 'personal_sign' as const,
      params: ['0x00', USER],
      chainId: 1,
      origin: 'https://app.uniswap.org',
    };
    const v = runAnalysis('analyze', r, BUNDLED_WHITELISTS, 'scoped');
    expect(v.ruleIds).toEqual(['R13']);
    expect(needsDecision(v)).toBe(true);
    expect(runAnalysis('timeout', r, BUNDLED_WHITELISTS, 'scoped').ruleIds).toEqual(['R15']);
    expect(needsDecision({ ...v, level: 'LOW' })).toBe(false);
  });
});
