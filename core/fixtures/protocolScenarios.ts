import type { Address, Hex } from 'viem';
import type { RiskLevel, RuleId, SignRequest } from '../types';
import { ATTACKER, TOKENS } from './addresses';
import * as c from './calldata';
import * as p from './protocols';
import { wl } from './whitelist';

/**
 * Phase 7 protocol scenarios on Ethereum mainnet (chainId 1), judged on each protocol's
 * official origin. Used by core tests and by the README "실제 공격 요청" table.
 */
export type ProtocolScenario = {
  protocol: 'SushiSwap' | 'Curve' | 'Balancer';
  title: string;
  origin: string;
  request: Pick<SignRequest, 'method' | 'params'>;
  expected: { level: RiskLevel; ruleIds: RuleId[] };
};

const USDC = TOKENS.mainnetUSDC;
const WETH = wl(1, 'utilities', 'WETH');
const ETH: Address = '0x0000000000000000000000000000000000000000';
const CURVE_POOL: Address = '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7'; // 3pool: not whitelisted on purpose
const MIN = 25_000_000_000_000_000n;

export function buildProtocolScenarios(account: Address): ProtocolScenario[] {
  const tx = (to: Address, data: Hex) => ({
    method: 'eth_sendTransaction' as const,
    params: [{ from: account, to, data, value: '0x0' }],
  });
  const typed = (payload: unknown) => ({
    method: 'eth_signTypedData_v4' as const,
    params: [account, JSON.stringify(payload)],
  });

  const SUSHI = 'https://www.sushi.com';
  const RS = wl(1, 'sushiswap', 'RedSnwapper');
  const snwap = (recipient: Address, executor: Address) =>
    p.sushiSnwap({
      tokenIn: USDC,
      amountIn: 100_000_000n,
      recipient,
      tokenOut: p.NATIVE_EEEE,
      amountOutMin: MIN,
      executor,
    });

  const CURVE = 'https://www.curve.finance';
  const CR = wl(1, 'curve', 'Router NG v1.2.0');
  const exchange = (receiver?: Address) =>
    p.curveExchange({
      route: [USDC, CURVE_POOL, WETH],
      amount: 100_000_000n,
      minDy: MIN,
      receiver,
    });

  const BAL = 'https://balancer.fi';
  const VAULT = wl(1, 'balancer', 'Vault V2');
  const V3 = wl(1, 'balancer', 'V3 Router v2');
  const v2swap = (recipient: Address) =>
    p.balancerV2Swap({
      sender: account,
      recipient,
      assetIn: USDC,
      assetOut: ETH,
      amount: 100_000_000n,
      limit: MIN,
    });
  const v3swap = p.balancerV3SwapSingle({
    tokenIn: USDC,
    tokenOut: WETH,
    amount: 100_000_000n,
    limit: MIN,
  });

  return [
    // SushiSwap — every RedSnwapper swap is R9 (arbitrary executor, review decision 1)
    { protocol: 'SushiSwap', title: '정상 스왑 (본인 수령, minOut > 0)', origin: SUSHI, request: tx(RS, snwap(account, ATTACKER)), expected: { level: 'MEDIUM', ruleIds: ['R9'] } },
    { protocol: 'SushiSwap', title: 'recipient = ATTACKER', origin: SUSHI, request: tx(RS, snwap(ATTACKER, ATTACKER)), expected: { level: 'HIGH', ruleIds: ['R8', 'R9'] } },
    { protocol: 'SushiSwap', title: '정상 승인 approve(RedSnwapper, MAX)', origin: SUSHI, request: tx(USDC, c.approve(RS, c.MAX_UINT256)), expected: { level: 'LOW', ruleIds: ['R1'] } },
    { protocol: 'SushiSwap', title: 'approve(ATTACKER, MAX)', origin: SUSHI, request: tx(USDC, c.approve(ATTACKER, c.MAX_UINT256)), expected: { level: 'HIGH', ruleIds: ['R2'] } },
    { protocol: 'SushiSwap', title: '미등록 컨트랙트로 snwap', origin: SUSHI, request: tx(ATTACKER, snwap(account, ATTACKER)), expected: { level: 'HIGH', ruleIds: ['R9', 'R11'] } },

    // Curve — Router NG v1.2.0
    { protocol: 'Curve', title: '정상 스왑 (5인자, 수령인 = msg.sender)', origin: CURVE, request: tx(CR, exchange()), expected: { level: 'LOW', ruleIds: ['R7'] } },
    { protocol: 'Curve', title: '_receiver = ATTACKER (6인자)', origin: CURVE, request: tx(CR, exchange(ATTACKER)), expected: { level: 'HIGH', ruleIds: ['R8'] } },
    { protocol: 'Curve', title: 'approve(ATTACKER, MAX)', origin: CURVE, request: tx(USDC, c.approve(ATTACKER, c.MAX_UINT256)), expected: { level: 'HIGH', ruleIds: ['R2'] } },
    { protocol: 'Curve', title: '미등록 컨트랙트로 exchange', origin: CURVE, request: tx(ATTACKER, exchange()), expected: { level: 'HIGH', ruleIds: ['R11'] } },
    { protocol: 'Curve', title: '풀 직접 approve (풀 페이지, 한계)', origin: 'https://curve.fi', request: tx(USDC, c.approve(CURVE_POOL, c.MAX_UINT256)), expected: { level: 'HIGH', ruleIds: ['R2'] } },

    // Balancer — V2 Vault (funds.recipient), V3 Router (msg.sender), relayer approvals
    { protocol: 'Balancer', title: '정상 V3 스왑 (Router, 수령인 = msg.sender)', origin: BAL, request: tx(V3, v3swap), expected: { level: 'LOW', ruleIds: ['R7'] } },
    { protocol: 'Balancer', title: '정상 V2 스왑 (Vault, recipient = 본인)', origin: BAL, request: tx(VAULT, v2swap(account)), expected: { level: 'LOW', ruleIds: ['R7'] } },
    { protocol: 'Balancer', title: 'V2 funds.recipient = ATTACKER', origin: BAL, request: tx(VAULT, v2swap(ATTACKER)), expected: { level: 'HIGH', ruleIds: ['R8'] } },
    { protocol: 'Balancer', title: 'approve(ATTACKER, MAX)', origin: BAL, request: tx(USDC, c.approve(ATTACKER, c.MAX_UINT256)), expected: { level: 'HIGH', ruleIds: ['R2'] } },
    { protocol: 'Balancer', title: '미등록 컨트랙트로 Vault swap', origin: BAL, request: tx(ATTACKER, v2swap(account)), expected: { level: 'HIGH', ruleIds: ['R11'] } },
    { protocol: 'Balancer', title: '미등록 relayer 승인 (tx)', origin: BAL, request: tx(VAULT, p.balancerSetRelayerApproval(account, ATTACKER, true)), expected: { level: 'HIGH', ruleIds: ['R3'] } },
    {
      protocol: 'Balancer',
      title: '미등록 relayer 승인 (서명)',
      origin: 'https://app.balancer.fi',
      request: typed(p.balancerRelayerAuthorization({ chainId: 1, vault: VAULT, primaryType: 'SetRelayerApproval', calldata: p.balancerSetRelayerApproval(account, ATTACKER, true), sender: ATTACKER })),
      expected: { level: 'HIGH', ruleIds: ['R3'] },
    },
  ]; // prettier-ignore
}
