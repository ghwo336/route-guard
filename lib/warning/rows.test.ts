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
      '받는 주소 (recipient)', '판매 토큰', '판매 금액', '받을 토큰', '최소 수령량', '규칙',
    ]); // prettier-ignore
    expect(rows.find((r) => r.label === '판매 금액')?.value).toBe('무제한');
    expect(rows.find((r) => r.label === '받는 주소 (recipient)')?.value.split('\n')).toEqual([
      '0x3333333333333333333333333333333333333333',
      '본인 (MSG_SENDER)',
    ]);
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
      ['금액', '5 (decimals 알 수 없음)'],
      ['규칙', '-'],
    ]);
  });

  it('formats known token amounts and labels tokens', () => {
    const rows = verdictRows({
      level: 'HIGH',
      ruleIds: ['R8'],
      summary: '',
      details: {
        origin: 'x',
        protected: true,
        method: 'eth_sendTransaction',
        chainId: 11155111,
        token: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        amount: 100_000_000n,
        tokenOut: '0x0000000000000000000000000000000000000000',
        minAmountOut: 25_000_000_000_000_000n,
      },
    });
    const get = (l: string) => rows.find((r) => r.label === l)?.value;
    expect(get('판매 토큰')).toBe('USDC\n0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238');
    expect(get('판매 금액')).toBe('100 USDC');
    expect(get('받을 토큰')?.split('\n')[0]).toBe('ETH (네이티브)');
    expect(get('최소 수령량')).toBe('0.025 ETH');
  });

  it('approvals (no output token) keep plain 토큰 / 금액 labels', () => {
    const rows = verdictRows({
      level: 'HIGH',
      ruleIds: ['R2'],
      summary: '',
      details: {
        origin: 'x',
        protected: true,
        method: 'eth_sendTransaction',
        chainId: 1,
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: 'UNLIMITED',
      },
    });
    expect(rows.map((r) => r.label)).toEqual(['사이트', '요청', '토큰', '금액', '규칙']);
  });

  it('address rows carry notes as items (badge + tone)', () => {
    const rows = verdictRows({
      level: 'HIGH',
      ruleIds: ['R8'],
      summary: '',
      details: {
        origin: 'x',
        protected: true,
        method: 'eth_sendTransaction',
        chainId: 1,
        target: '0x1111111111111111111111111111111111111111',
        recipients: [
          '0x0000000000000000000000000000000000000002',
          '0x3333333333333333333333333333333333333333',
        ],
        notes: {
          target: { badge: '공식 Uniswap UniversalRouter 2.0', tone: 'ok' },
          recipients: [
            { display: '라우터 내부 보관 (ADDRESS_THIS)', tone: 'ok' },
            { badge: '⚠ 본인 아님', tone: 'warn' },
          ],
        },
      },
    });
    const rec = rows.find((r) => r.label === '받는 주소 (recipient)')!;
    expect(rec.items).toEqual([
      { text: '라우터 내부 보관 (ADDRESS_THIS)', badge: undefined, tone: 'ok' },
      { text: '0x3333333333333333333333333333333333333333', badge: '⚠ 본인 아님', tone: 'warn' },
    ]);
    expect(rec.value).toBe(
      '라우터 내부 보관 (ADDRESS_THIS)\n0x3333333333333333333333333333333333333333 · ⚠ 본인 아님',
    );
    expect(rows.find((r) => r.label === '대상 컨트랙트')?.value).toBe(
      '0x1111111111111111111111111111111111111111 · 공식 Uniswap UniversalRouter 2.0',
    );
  });

  it('delays proceed only for HIGH', () => {
    expect(proceedDelayMs('HIGH')).toBeGreaterThan(0);
    expect(proceedDelayMs('MEDIUM')).toBe(0);
  });
});
