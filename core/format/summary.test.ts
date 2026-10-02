import { describe, expect, it } from 'vitest';
import { otherFindings, withOthers } from './summary';

const L = { level: 'LOW' as const };
const M = { level: 'MEDIUM' as const };
const H = { level: 'HIGH' as const };

describe('otherFindings', () => {
  it('LOW hits are not counted', () => {
    expect(otherFindings([H, L], H)).toBe(0); // S11: R8 + R1
    expect(otherFindings([L, L], L)).toBe(0);
  });

  it('counts MEDIUM/HIGH besides the headline', () => {
    expect(otherFindings([H, M, L], H)).toBe(1);
    expect(otherFindings([H, H, M], H)).toBe(2);
  });

  it('a LOW headline does not reduce the count', () => {
    expect(otherFindings([L, M], L)).toBe(1);
    expect(otherFindings([], undefined)).toBe(0);
  });

  it('withOthers', () => {
    expect(withOthers('a', 0)).toBe('a');
    expect(withOthers('a', 2)).toBe('a (외 2건)');
  });
});
