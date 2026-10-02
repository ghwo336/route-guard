import type { Address } from 'viem';
import { describe, expect, it } from 'vitest';
import { ATTACKER, USER } from '../fixtures/addresses';
import { wl } from '../fixtures/whitelist';
import type { DecodedAction, VerdictDetails } from '../types';
import { BUNDLED_WHITELISTS, resolveScope } from '../whitelist';
import { buildNotes, officialLabel, recipientNote, spenderNote, targetNote } from './addresses';

const allowed = resolveScope('https://app.uniswap.org', 1, 'scoped', BUNDLED_WHITELISTS).allowed;
const ctx = { allowed, signer: USER };
const PERMIT2 = wl(1, 'uniswap', 'Permit2');
const UR = wl(1, 'uniswap', 'UniversalRouter 2.1.2');
const PROXY = wl(1, 'uniswap', 'SwapProxy');
const FEE = wl(1, 'uniswap', 'FeeCollector');
const WETH = wl(1, 'utilities', 'WETH');
const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

describe('officialLabel', () => {
  it('names the DEX and flags unverified entries', () => {
    expect(officialLabel(allowed.spenders.get(PERMIT2)!)).toBe('공식 Uniswap Permit2');
    expect(officialLabel(allowed.routers.get(PROXY)!)).toBe('공식 Uniswap SwapProxy (미검증)');
    expect(officialLabel(allowed.utilities.get(WETH)!)).toBe('공식 WETH');
    expect(officialLabel({ ...allowed.spenders.get(PERMIT2)!, dex: 'other' })).toBe(
      '공식 other Permit2',
    );
  });
});

describe('recipientNote', () => {
  it('ok: sentinels, self, fee recipient', () => {
    expect(recipientNote('0x0000000000000000000000000000000000000001', ctx)).toEqual({
      display: '본인 (MSG_SENDER)',
      tone: 'ok',
    });
    expect(recipientNote('0x0000000000000000000000000000000000000002', ctx)).toEqual({
      display: '라우터 내부 보관 (ADDRESS_THIS)',
      tone: 'ok',
    });
    expect(recipientNote(USER, ctx)).toEqual({ badge: '본인', tone: 'ok' });
    expect(recipientNote(FEE, ctx)).toEqual({
      badge: '공식 Uniswap FeeCollector (수수료 수령)',
      tone: 'ok',
    });
  });

  it('warn: anyone else — even an official router (the rules flag it too)', () => {
    expect(recipientNote(ATTACKER, ctx)).toEqual({ badge: '⚠ 본인 아님', tone: 'warn' });
    expect(recipientNote(UR, ctx)).toEqual({ badge: '⚠ 본인 아님', tone: 'warn' });
    expect(recipientNote(ATTACKER, { allowed })).toEqual({
      badge: '⚠ 본인 확인 불가',
      tone: 'warn',
    });
  });
});

describe('recipientNote: CoW receiver 0x0', () => {
  const ZERO = '0x0000000000000000000000000000000000000000';
  it('is the order owner for CoW orders only', () => {
    expect(recipientNote(ZERO, ctx, { zeroIsOwner: true })).toEqual({
      display: '본인 (주문자, receiver=0x0)',
      tone: 'ok',
    });
    expect(recipientNote(ZERO, ctx)).toEqual({ badge: '⚠ 본인 아님', tone: 'warn' });
  });

  it('buildNotes applies it to CoW orders and EthFlow orders', () => {
    const base: VerdictDetails = {
      origin: 'x',
      protected: true,
      method: 'm',
      chainId: 1,
      recipients: [ZERO],
    };
    const order: DecodedAction = {
      kind: 'cowOrder', verifyingContract: ATTACKER, receiver: ZERO,
      sellToken: USDC, buyToken: WETH, sellAmount: 1n, buyAmount: 1n,
    }; // prettier-ignore
    expect(buildNotes({ ...base, target: ATTACKER }, order, ctx)).toEqual({
      target: { badge: '⚠ 미등록', tone: 'warn' },
      recipients: [{ display: '본인 (주문자, receiver=0x0)', tone: 'ok' }],
    });
    const flow: DecodedAction = {
      kind: 'cowEthFlowOrder',
      to: ATTACKER,
      receiver: ZERO,
      buyToken: USDC,
      sellAmount: 1n,
      buyAmount: 1n,
    };
    expect(buildNotes(base, flow, ctx)?.recipients).toEqual([
      { display: '본인 (주문자, receiver=0x0)', tone: 'ok' },
    ]);
  });
});

describe('spenderNote', () => {
  it('official spenders; routers only for Permit2', () => {
    expect(spenderNote(PERMIT2, ctx, { routersAllowed: false })).toEqual({
      badge: '공식 Uniswap Permit2',
      tone: 'ok',
    });
    expect(spenderNote(UR, ctx, { routersAllowed: true })).toEqual({
      badge: '공식 Uniswap UniversalRouter 2.1.2',
      tone: 'ok',
    });
    expect(spenderNote(UR, ctx, { routersAllowed: false })).toEqual({
      badge: '⚠ 미등록',
      tone: 'warn',
    });
    expect(spenderNote(ATTACKER, ctx, { routersAllowed: true })).toEqual({
      badge: '⚠ 미등록',
      tone: 'warn',
    });
  });
});

describe('targetNote', () => {
  it('labels official targets; unknown is only suspicious where a DEX contract is expected', () => {
    expect(targetNote(UR, ctx, { mustBeOfficial: true })).toEqual({
      badge: '공식 Uniswap UniversalRouter 2.1.2',
      tone: 'ok',
    });
    expect(targetNote(ATTACKER, ctx, { mustBeOfficial: true })).toEqual({
      badge: '⚠ 미등록',
      tone: 'warn',
    });
    expect(targetNote(USDC, ctx, { mustBeOfficial: false })).toBeUndefined();
    expect(targetNote(FEE, ctx, { mustBeOfficial: true })).toEqual({
      badge: '⚠ 미등록',
      tone: 'warn',
    });
  });
});

describe('buildNotes', () => {
  const base: VerdictDetails = { origin: 'x', protected: true, method: 'm', chainId: 1 };

  it('approve: token target gets no tag, spender is judged', () => {
    const a: DecodedAction = {
      kind: 'approve',
      fn: 'approve',
      to: USDC,
      token: USDC,
      spender: ATTACKER,
      amount: 1n,
    };
    expect(buildNotes({ ...base, target: USDC, spender: ATTACKER }, a, ctx)).toEqual({
      spender: { badge: '⚠ 미등록', tone: 'warn' },
    });
  });

  it('Permit2.approve / permit2 permits accept routers as spender', () => {
    const p2: DecodedAction = {
      kind: 'approve',
      fn: 'permit2Approve',
      to: PERMIT2,
      token: USDC,
      spender: UR,
      amount: 1n,
    };
    expect(buildNotes({ ...base, target: PERMIT2, spender: UR }, p2, ctx)).toEqual({
      target: { badge: '공식 Uniswap Permit2', tone: 'ok' },
      spender: { badge: '공식 Uniswap UniversalRouter 2.1.2', tone: 'ok' },
    });
    const sig: DecodedAction = {
      kind: 'permit2',
      primaryType: 'PermitSingle',
      verifyingContract: PERMIT2,
      spender: UR,
      permitted: [],
    };
    expect(buildNotes({ ...base, target: PERMIT2, spender: UR }, sig, ctx)?.spender?.tone).toBe(
      'ok',
    );
  });

  it('router calls: unknown target and each recipient', () => {
    const r: DecodedAction = {
      kind: 'routerCall',
      router: 'universal-router',
      to: ATTACKER,
      value: 0n,
      recipients: [],
      hasSwap: true,
    };
    expect(
      buildNotes(
        {
          ...base,
          target: ATTACKER,
          recipients: ['0x0000000000000000000000000000000000000002', ATTACKER],
        },
        r,
        ctx,
      ),
    ).toEqual({
      target: { badge: '⚠ 미등록', tone: 'warn' },
      recipients: [
        { display: '라우터 내부 보관 (ADDRESS_THIS)', tone: 'ok' },
        { badge: '⚠ 본인 아님', tone: 'warn' },
      ],
    });
  });

  it.each([
    { kind: 'setApprovalForAll', to: USDC, operator: ATTACKER, approved: true },
    { kind: 'permit', spender: ATTACKER, amount: 1n },
    { kind: 'transfer', fn: 'transfer', to: USDC, recipient: ATTACKER, amount: 1n },
    { kind: 'unknownTypedData' },
    { kind: 'opaqueSign', method: 'personal_sign' },
  ] as DecodedAction[])('$kind: target is a token / not a DEX contract', (a) => {
    expect(buildNotes({ ...base, target: USDC }, a, ctx)).toEqual({});
  });

  it('nothing to annotate', () => {
    const o: DecodedAction = { kind: 'opaqueSign', method: 'eth_sign' };
    expect(buildNotes(base, o, ctx)).toEqual({});
  });
});
