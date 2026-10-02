import { describe, expect, it } from 'vitest';
import type { Verdict } from '@/core/types';
import { proceedDelayMs, verdictRows } from './rows';

describe('verdictRows', () => {
  it('lists present facts only', () => {
    const v: Verdict = {
      level: 'HIGH',
      ruleIds: ['R2'],
      summary: 's',
      details: {
        origin: 'https://app.uniswap.org',
        protected: true,
        method: 'eth_sendTransaction',
        chainId: 1,
        target: '0x1111111111111111111111111111111111111111',
        spender: '0x2222222222222222222222222222222222222222',
        recipients: [
          '0x3333333333333333333333333333333333333333',
          '0x0000000000000000000000000000000000000001',
        ],
        token: '0x4444444444444444444444444444444444444444',
        amount: 'UNLIMITED',
        tokenOut: '0x5555555555555555555555555555555555555555',
        minAmountOut: 0n,
        matchedDex: 'uniswap',
      },
    };
    const rows = verdictRows(v);
    expect(rows.map((r) => r.label)).toEqual([
      '사이트', '매칭된 DEX', '요청', '대상 컨트랙트', '권한 받는 주소 (spender)',
      '받는 주소 (recipient)', '토큰', '금액', '받을 토큰', '최소 수령량', '규칙',
    ]); // prettier-ignore
    expect(rows.find((r) => r.label === '금액')?.value).toBe('무제한');
    expect(rows.find((r) => r.label === '받는 주소 (recipient)')?.value.split('\n')).toHaveLength(
      2,
    );
  });

  it('minimal verdict', () => {
    const rows = verdictRows({
      level: 'MEDIUM',
      ruleIds: [],
      summary: '',
      details: { origin: 'x', protected: true, method: 'personal_sign', chainId: 1, amount: 5n },
    });
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ['사이트', 'x'],
      ['요청', 'personal_sign (chainId 1)'],
      ['금액', '5'],
      ['규칙', '-'],
    ]);
  });

  it('delays proceed only for HIGH', () => {
    expect(proceedDelayMs('HIGH')).toBeGreaterThan(0);
    expect(proceedDelayMs('MEDIUM')).toBe(0);
  });
});
