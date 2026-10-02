import { describe, expect, it } from 'vitest';
import { deserialize, serialize } from './serialize';
import type { Verdict } from './types';

describe('serialize', () => {
  const verdict: Verdict = {
    level: 'HIGH',
    ruleIds: ['R2'],
    summary: 'test',
    details: {
      origin: 'https://app.uniswap.org',
      protected: true,
      method: 'eth_sendTransaction',
      chainId: 1,
      amount: 2n ** 256n - 1n,
      minAmountOut: 0n,
    },
  };

  it('round-trips a verdict through JSON', () => {
    const wire = JSON.stringify(serialize(verdict));
    expect(deserialize<Verdict>(JSON.parse(wire))).toEqual(verdict);
  });

  it('keeps non-bigint values, including numeric strings and UNLIMITED', () => {
    const value = { a: '123', b: 'UNLIMITED', c: [1n, null, true], d: { e: -5n } };
    expect(deserialize(JSON.parse(JSON.stringify(serialize(value))))).toEqual(value);
  });

  it('drops undefined fields', () => {
    expect(serialize({ a: undefined, b: 1 })).toEqual({ b: 1 });
  });

  it('does not revive malformed tags', () => {
    const value = { $bigint: 'abc' };
    expect(deserialize(value)).toEqual(value);
  });
});
