import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import { ATTACKER, TOKENS, USER } from './fixtures/addresses';
import { cowOrder } from './fixtures/typedData';
import { buildScenarios, PLAYGROUND_ORIGIN, SCENARIO_CHAIN_ID } from './fixtures/scenarios';
import type { Mode, SignRequest } from './types';
import { BUNDLED_WHITELISTS } from './whitelist';

const scenarios = buildScenarios(USER);

const toRequest = (s: (typeof scenarios)[number], origin: string): SignRequest => ({
  ...s.request,
  chainId: SCENARIO_CHAIN_ID,
  origin,
});

describe('AGENTS.md 11장 시나리오 S0–S15', () => {
  it('covers S0..S15 exactly', () => {
    expect(scenarios.map((s) => s.id)).toEqual(Array.from({ length: 16 }, (_, i) => `S${i}`));
  });

  it.each(scenarios.map((s) => [s.id, s.title, s] as const))('%s %s', (_, __, s) => {
    const v = analyze(toRequest(s, PLAYGROUND_ORIGIN), BUNDLED_WHITELISTS, 'scoped');
    expect({ level: v.level, ruleIds: v.ruleIds }).toEqual(s.expected);
    expect(v.details.protected).toBe(true);
  });

  it.each(['scoped', 'global'] as Mode[])('same results in %s mode on the playground', (mode) => {
    for (const s of scenarios) {
      const v = analyze(toRequest(s, PLAYGROUND_ORIGIN), BUNDLED_WHITELISTS, mode);
      expect(v.level).toBe(s.expected.level);
    }
  });

  it('every scenario is R0 on an unprotected origin (scoped)', () => {
    for (const s of scenarios) {
      const v = analyze(toRequest(s, 'https://example.org'), BUNDLED_WHITELISTS, 'scoped');
      expect({ id: s.id, level: v.level, ruleIds: v.ruleIds }).toEqual({
        id: s.id,
        level: 'LOW',
        ruleIds: ['R0'],
      });
    }
  });

  it('the playground origin is not protected on mainnet', () => {
    const v = analyze(
      { ...scenarios[2]!.request, chainId: 1, origin: PLAYGROUND_ORIGIN },
      BUNDLED_WHITELISTS,
      'scoped',
    );
    expect(v.ruleIds).toEqual(['R0']);
  });

  it('requests survive a JSON round trip (what the page actually sends)', () => {
    for (const s of scenarios) {
      expect(JSON.parse(JSON.stringify(s.request))).toEqual(s.request);
    }
  });
});

describe('warning labels for the offending address (display only)', () => {
  const v = (id: string) => {
    const s = scenarios.find((x) => x.id === id)!;
    return analyze(toRequest(s, PLAYGROUND_ORIGIN), BUNDLED_WHITELISTS, 'scoped');
  };

  it('S2 / S3: the attacker spender is flagged', () => {
    expect(v('S2').details.notes?.spender).toEqual({ badge: '⚠ 미등록', tone: 'warn' });
    expect(v('S3').details.notes).toMatchObject({
      target: { badge: '공식 Uniswap Permit2', tone: 'ok' },
      spender: { badge: '⚠ 미등록', tone: 'warn' },
    });
  });

  it('S7: router is official, the attacker recipient is flagged', () => {
    expect(v('S7').details.notes).toEqual({
      target: { badge: '공식 Uniswap UniversalRouter 2.0', tone: 'ok' },
      recipients: [
        { display: '라우터 내부 보관 (ADDRESS_THIS)', tone: 'ok' },
        { badge: '⚠ 본인 아님', tone: 'warn' },
      ],
    });
  });

  it('S11: official reactor and Permit2, attacker recipient flagged', () => {
    expect(v('S11').details.notes).toEqual({
      target: { badge: '공식 Uniswap Permit2', tone: 'ok' },
      spender: { badge: '공식 Uniswap V2DutchOrderReactor (UniswapX) (미검증)', tone: 'ok' },
      recipients: [{ badge: '⚠ 본인 아님', tone: 'warn' }],
    });
    expect(v('S11').summary).toBe(
      'UniswapX 주문(V2DutchOrder)의 결과물 일부를 본인이 아닌 0xBAdB…BAD0이 받습니다.',
    );
  });

  it('CoW order with receiver 0x0 and a fake settlement: owner shown as 본인, settlement flagged', () => {
    const r = analyze(
      {
        method: 'eth_signTypedData_v4',
        params: [
          USER,
          JSON.stringify(
            cowOrder({
              chainId: SCENARIO_CHAIN_ID,
              receiver: '0x0000000000000000000000000000000000000000',
              sellToken: TOKENS.sepoliaUSDC,
              buyToken: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
              verifyingContract: ATTACKER,
            }),
          ),
        ],
        chainId: SCENARIO_CHAIN_ID,
        origin: PLAYGROUND_ORIGIN,
      },
      BUNDLED_WHITELISTS,
      'scoped',
    );
    expect(r.ruleIds).toEqual(['R5']); // unchanged verdict
    expect(r.details.notes).toEqual({
      target: { badge: '⚠ 미등록', tone: 'warn' },
      recipients: [{ display: '본인 (주문자, receiver=0x0)', tone: 'ok' }],
    });
  });

  it('S1: everything reads as normal', () => {
    expect(v('S1').details.notes).toEqual({
      target: { badge: '공식 Uniswap UniversalRouter 2.0', tone: 'ok' },
      recipients: [
        { display: '라우터 내부 보관 (ADDRESS_THIS)', tone: 'ok' },
        { display: '본인 (MSG_SENDER)', tone: 'ok' },
      ],
    });
  });
});
