import { describe, expect, it } from 'vitest';
import { describeToken, describeTokenAmount } from './index';

const SEP_USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const UNKNOWN = '0x2222222222222222222222222222222222222222';
const ZERO = '0x0000000000000000000000000000000000000000';

describe('describeToken / describeTokenAmount', () => {
  it('token names for sentences', () => {
    expect(describeToken(11155111, SEP_USDC)).toBe('USDC');
    expect(describeToken(1, ZERO)).toBe('ETH (네이티브)');
    expect(describeToken(1, UNKNOWN)).toBe('토큰 0x2222…2222');
    expect(describeToken(1, undefined)).toBe('알 수 없는 토큰');
  });

  it('amounts with their token', () => {
    expect(describeTokenAmount(11155111, SEP_USDC, 100_000_000n)).toBe('100 USDC');
    expect(describeTokenAmount(11155111, SEP_USDC, 'UNLIMITED')).toBe('USDC 무제한');
    expect(describeTokenAmount(1, ZERO, 10n ** 16n)).toBe('0.01 ETH');
    expect(describeTokenAmount(1, UNKNOWN, 5n)).toBe('토큰 0x2222…2222 5 (decimals 알 수 없음)');
    expect(describeTokenAmount(1, undefined, 'UNLIMITED')).toBe('알 수 없는 토큰 무제한');
  });
});
