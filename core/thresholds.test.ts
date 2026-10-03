import { describe, expect, it } from 'vitest';
import { isNegligibleMin, negligibleFloor } from './thresholds';

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const ETH = '0x0000000000000000000000000000000000000000';
const UNKNOWN = '0x2222222222222222222222222222222222222222';

describe('negligible minimum (R10)', () => {
  it('18-decimals tokens: below 0.000001 token (1e12 base units)', () => {
    expect(negligibleFloor(1, WETH)).toBe(10n ** 12n);
    expect(isNegligibleMin(1, WETH, 1n)).toBe(true);
    expect(isNegligibleMin(1, WETH, 10n ** 12n - 1n)).toBe(true);
    expect(isNegligibleMin(1, WETH, 10n ** 12n)).toBe(false);
    expect(isNegligibleMin(1, ETH, 999_999_999_999n)).toBe(true); // native
  });

  it('6-decimals tokens: 1 base unit already is 0.000001, so only 0', () => {
    expect(negligibleFloor(1, USDC)).toBe(1n);
    expect(isNegligibleMin(1, USDC, 0n)).toBe(true);
    expect(isNegligibleMin(1, USDC, 1n)).toBe(false);
  });

  it('unknown decimals (or token): only 0', () => {
    expect(isNegligibleMin(1, UNKNOWN, 0n)).toBe(true);
    expect(isNegligibleMin(1, UNKNOWN, 1n)).toBe(false);
    expect(isNegligibleMin(1, undefined, 1n)).toBe(false);
    expect(isNegligibleMin(11155111, WETH, 1n)).toBe(false); // mainnet WETH address, Sepolia metadata
  });
});
