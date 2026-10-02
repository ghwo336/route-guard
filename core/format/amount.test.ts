import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import tokens from './tokens.json' with { type: 'json' };
import { formatAmount, isNative, tokenLabel, tokenMeta } from './amount';

const SEP_USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const SEP_WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14';
const MAIN_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const UNKNOWN = '0x2222222222222222222222222222222222222222';
const ZERO = '0x0000000000000000000000000000000000000000';

describe('tokens.json', () => {
  it('is well-formed, sourced, and checksummed', () => {
    const entry = z.object({
      address: z.string().refine((a) => getAddress(a) === a, 'checksummed'),
      symbol: z.string().min(1),
      decimals: z.number().int().min(0).max(36),
      source: z.url(),
    });
    z.record(z.string().regex(/^\d+$/), z.array(entry)).parse(tokens);
  });
});

describe('formatAmount', () => {
  it('scales known tokens by decimals', () => {
    expect(formatAmount(11155111, SEP_USDC, 100_000_000n)).toBe('100 USDC');
    expect(formatAmount(11155111, SEP_WETH, 25_000_000_000_000_000n)).toBe('0.025 WETH');
    expect(formatAmount(1, MAIN_USDC, 1n)).toBe('0.000001 USDC');
    expect(formatAmount(1, MAIN_USDC.toLowerCase(), 0n)).toBe('0 USDC');
  });

  it('native ETH (address(0) and CoW BUY_ETH_ADDRESS)', () => {
    expect(formatAmount(1, ZERO, 25_000_000_000_000_000n)).toBe('0.025 ETH');
    expect(formatAmount(11155111, '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', 10n ** 18n)).toBe(
      '1 ETH',
    );
  });

  it('unknown tokens keep the raw value', () => {
    expect(formatAmount(1, UNKNOWN, 100_000_000n)).toBe('100000000 (decimals 알 수 없음)');
    expect(formatAmount(1, undefined, 5n)).toBe('5 (decimals 알 수 없음)');
    expect(formatAmount(1, 'nope', 5n)).toBe('5 (decimals 알 수 없음)');
    // metadata is per chain
    expect(formatAmount(1, SEP_USDC, 1n)).toBe('1 (decimals 알 수 없음)');
  });

  it('unlimited stays "무제한"', () => {
    expect(formatAmount(1, MAIN_USDC, 'UNLIMITED')).toBe('무제한');
  });
});

describe('tokenLabel / tokenMeta', () => {
  it('labels', () => {
    expect(tokenLabel(11155111, SEP_USDC)).toBe('USDC');
    expect(tokenLabel(1, ZERO)).toBe('ETH (네이티브)');
    expect(tokenLabel(1, UNKNOWN)).toBe('0x2222…2222');
    expect(tokenLabel(1, 'not-an-address')).toBe('not-an-address');
  });

  it('meta / native', () => {
    expect(tokenMeta(1, MAIN_USDC)).toEqual({ symbol: 'USDC', decimals: 6 });
    expect(tokenMeta(1, undefined)).toBeUndefined();
    expect(isNative(ZERO)).toBe(true);
    expect(isNative(UNKNOWN)).toBe(false);
    expect(isNative(undefined)).toBe(false);
  });
});
