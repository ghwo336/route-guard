import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';

describe('smoke', () => {
  it('normalizes addresses with viem', () => {
    expect(getAddress('0x000000000022d473030f116ddee9f6b43ac78ba3')).toBe(
      '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    );
  });
});
