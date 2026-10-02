import { describe, expect, it } from 'vitest';
import { isWatchedMethod } from './types';

describe('isWatchedMethod', () => {
  it('accepts watched methods only', () => {
    expect(isWatchedMethod('eth_signTypedData_v3')).toBe(true);
    expect(isWatchedMethod('eth_call')).toBe(false);
    expect(isWatchedMethod(42)).toBe(false);
  });
});
