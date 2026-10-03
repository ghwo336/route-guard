import type { Address } from 'viem';
import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import { ATTACKER, TOKENS, USER } from './fixtures/addresses';
import * as p from './fixtures/protocols';
import { wl } from './fixtures/whitelist';
import type { SignRequest } from './types';
import { BUNDLED_WHITELISTS } from './whitelist';

/**
 * KNOWN GAPS — these tests pin down *current* behaviour that is NOT safe, so a later fix
 * flips them deliberately. See docs/protocols-phase7.md section 6 (PLAN Phase 8 #44).
 */

const USDC = TOKENS.mainnetUSDC;
const WETH = wl(1, 'utilities', 'WETH');
const ONE_WEI = 1n;
const tx = (to: Address, data: string, origin: string): SignRequest => ({
  method: 'eth_sendTransaction',
  params: [{ from: USER, to, data, value: '0x0' }],
  chainId: 1,
  origin,
});

describe('KNOWN GAP: arbitrary pool inside an official router path', () => {
  it('Curve Router NG + receiver = self + pool = ATTACKER + min_dy = 1 wei → LOW (R7)', () => {
    // Router.vy approves `_route[1]` for max and calls its exchange(); a fake pool can take
    // the whole input and hand back 1 wei of real WETH, which satisfies _min_dy = 1.
    const data = p.curveExchange({
      route: [USDC, ATTACKER, WETH],
      amount: 1_000_000_000n,
      minDy: ONE_WEI,
    });
    const v = analyze(
      tx(wl(1, 'curve', 'Router NG v1.2.0'), data, 'https://www.curve.finance'),
      BUNDLED_WHITELISTS,
      'scoped',
    );
    expect({ level: v.level, ruleIds: v.ruleIds }).toEqual({ level: 'LOW', ruleIds: ['R7'] });
    expect(v.details.tokenOut).toBe(WETH); // looks like an honest WETH output
    expect(v.details.minAmountOut).toBe(ONE_WEI); // R10 only fires on exactly 0
  });

  it('Balancer V2 Vault swap through any registered poolId + min = 1 wei → LOW (R7)', () => {
    // Pool registration is permissionless (V2 PoolRegistry.registerPool, V3
    // VaultExtension.registerPool); the poolId is not checked. The Vault settles, so the pool
    // cannot pull more than `amount`, but the output can be as low as `limit`.
    const data = p.balancerV2Swap({
      sender: USER,
      recipient: USER,
      assetIn: USDC,
      assetOut: WETH,
      amount: 1_000_000_000n,
      limit: ONE_WEI,
    });
    const v = analyze(
      tx(wl(1, 'balancer', 'Vault V2'), data, 'https://balancer.fi'),
      BUNDLED_WHITELISTS,
      'scoped',
    );
    expect({ level: v.level, ruleIds: v.ruleIds }).toEqual({ level: 'LOW', ruleIds: ['R7'] });
  });

  it('for contrast: the same Curve call with min_dy = 0 is R10, a non-self receiver is R8', () => {
    const router = wl(1, 'curve', 'Router NG v1.2.0');
    const zero = p.curveExchange({ route: [USDC, ATTACKER, WETH], amount: 1n, minDy: 0n });
    expect(
      analyze(tx(router, zero, 'https://curve.fi'), BUNDLED_WHITELISTS, 'scoped').ruleIds,
    ).toEqual(['R10']);
    const steal = p.curveExchange({
      route: [USDC, ATTACKER, WETH],
      amount: 1n,
      minDy: 1n,
      receiver: ATTACKER,
    });
    expect(
      analyze(tx(router, steal, 'https://curve.fi'), BUNDLED_WHITELISTS, 'scoped').ruleIds,
    ).toEqual(['R8']);
  });
});
