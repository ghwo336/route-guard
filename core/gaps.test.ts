import type { Address } from 'viem';
import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import { ATTACKER, TOKENS, USER } from './fixtures/addresses';
import * as p from './fixtures/protocols';
import * as r from './fixtures/router';
import { wl } from './fixtures/whitelist';
import type { SignRequest } from './types';
import { BUNDLED_WHITELISTS } from './whitelist';

/**
 * Route / minimum-output manipulation (class 3 in docs/protocols-phase7.md section 6 and the
 * README limits): the attacker picks the path (arbitrary Curve pool, any registered Balancer
 * pool, a fake-token Uniswap route, a V4 hook) and a floor that protects nothing. The loss is
 * bounded by this transaction's input — unlike approval theft (whole balance, no expiry).
 *
 * - "caught by R10": floors below 0.000001 of a token with known decimals (review point 6)
 * - "알려진 한계 (현재 LOW)": a non-trivial but unfair floor (1% of the input value) still
 *   passes; judging fairness needs prices / simulation, which are out of scope.
 */

const USDC = TOKENS.mainnetUSDC;
const WETH = wl(1, 'utilities', 'WETH');
const FAKE: Address = '0x2222222222222222222222222222222222222222';
const INPUT = 1_000_000_000n; // 1,000 USDC
// 1% of 1,000 USDC ≈ 10 USDC ≈ 0.0025 WETH (assuming roughly 4,000 USD/ETH; illustrative only)
const ONE_PERCENT_IN_WETH = 2_500_000_000_000_000n;
const ONE_WEI = 1n;

const tx = (to: Address, data: string, origin: string): SignRequest => ({
  method: 'eth_sendTransaction',
  params: [{ from: USER, to, data, value: '0x0' }],
  chainId: 1,
  origin,
});
const judge = (to: Address, data: string, origin: string) => {
  const v = analyze(tx(to, data, origin), BUNDLED_WHITELISTS, 'scoped');
  return { level: v.level, ruleIds: v.ruleIds };
};

const CURVE_ROUTER = wl(1, 'curve', 'Router NG v1.2.0');
const VAULT = wl(1, 'balancer', 'Vault V2');
const UR = wl(1, 'uniswap', 'UniversalRouter 2.0');

describe('route / min-out manipulation: caught by R10 (negligible floor)', () => {
  it('Curve Router NG + receiver self + pool = ATTACKER + min_dy = 1 wei → MEDIUM (R10)', () => {
    // Router.vy approves `_route[1]` for max and calls its exchange(); the fake pool keeps the
    // input and returns 1 wei of real WETH.
    const data = p.curveExchange({ route: [USDC, ATTACKER, WETH], amount: INPUT, minDy: ONE_WEI });
    expect(judge(CURVE_ROUTER, data, 'https://www.curve.finance')).toEqual({
      level: 'MEDIUM',
      ruleIds: ['R10'],
    });
  });

  it('Balancer V2 swap through any registered poolId + limit = 1 wei → MEDIUM (R10)', () => {
    const data = p.balancerV2Swap({
      sender: USER,
      recipient: USER,
      assetIn: USDC,
      assetOut: WETH,
      amount: INPUT,
      limit: ONE_WEI,
    });
    expect(judge(VAULT, data, 'https://balancer.fi')).toEqual({
      level: 'MEDIUM',
      ruleIds: ['R10'],
    });
  });

  it('a non-self receiver is still R8 on top', () => {
    const data = p.curveExchange({
      route: [USDC, ATTACKER, WETH],
      amount: INPUT,
      minDy: ONE_WEI,
      receiver: ATTACKER,
    });
    expect(judge(CURVE_ROUTER, data, 'https://curve.fi')).toEqual({
      level: 'HIGH',
      ruleIds: ['R8', 'R10'],
    });
  });
});

describe('알려진 한계 (현재 LOW): an unfair but non-trivial floor (1% of the input)', () => {
  it('Curve: fake pool + min_dy = 1% of the input value → LOW (R7)', () => {
    const data = p.curveExchange({
      route: [USDC, ATTACKER, WETH],
      amount: INPUT,
      minDy: ONE_PERCENT_IN_WETH,
    });
    expect(judge(CURVE_ROUTER, data, 'https://www.curve.finance')).toEqual({
      level: 'LOW',
      ruleIds: ['R7'],
    });
  });

  it('Balancer: attacker-registered pool + limit = 1% of the input value → LOW (R7)', () => {
    const data = p.balancerV2Swap({
      sender: USER,
      recipient: USER,
      assetIn: USDC,
      assetOut: WETH,
      amount: INPUT,
      limit: ONE_PERCENT_IN_WETH,
    });
    expect(judge(VAULT, data, 'https://balancer.fi')).toEqual({ level: 'LOW', ruleIds: ['R7'] });
  });

  it('Uniswap: fake-token route USDC → FAKE → WETH with a 1% floor → LOW (R7)', () => {
    const data = r.urExecute([
      r.v3ExactIn({
        recipient: r.MSG_SENDER,
        amountIn: INPUT,
        amountOutMin: ONE_PERCENT_IN_WETH,
        path: [USDC, FAKE, WETH],
      }),
    ]);
    expect(judge(UR, data, 'https://app.uniswap.org')).toEqual({ level: 'LOW', ruleIds: ['R7'] });
  });
});
