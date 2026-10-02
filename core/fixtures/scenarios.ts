import type { Address } from 'viem';
import type { RiskLevel, RuleId, SignRequest } from '../types';
import { ATTACKER, TOKENS } from './addresses';
import * as c from './calldata';
import * as r from './router';
import { cowOrder, permit2Single } from './typedData';
import { wl } from './whitelist';

/**
 * AGENTS.md 11장 시나리오. 화면에는 항상 "100 USDC → ETH 스왑"이 보이지만
 * 실제 요청은 시나리오마다 다르다. core 테스트와 playground가 같은 데이터를 쓴다.
 */

export const SCENARIO_CHAIN_ID = 11155111;
export const PLAYGROUND_ORIGIN = 'http://localhost:5173';

export type Scenario = {
  id: string;
  title: string;
  /** What is actually requested, in plain words. */
  actual: string;
  request: { method: SignRequest['method']; params: unknown[] };
  expected: { level: RiskLevel; ruleIds: RuleId[] };
};

const CHAIN = SCENARIO_CHAIN_ID;
const USDC = TOKENS.sepoliaUSDC;
const AMOUNT_IN = 100_000_000n; // 100 USDC (6 decimals)
const MIN_ETH_OUT = 25_000_000_000_000_000n; // 0.025 ETH

/** Build every scenario for the connected `account`. */
export function buildScenarios(account: Address): Scenario[] {
  const WETH = wl(CHAIN, 'utilities', 'WETH');
  const PERMIT2 = wl(CHAIN, 'uniswap', 'Permit2');
  const UR = wl(CHAIN, 'uniswap', 'UniversalRouter 2.0');

  const tx = (to: Address, data: string, value = '0x0') => ({
    method: 'eth_sendTransaction' as const,
    params: [{ from: account, to, data, value }],
  });
  const typed = (payload: unknown) => ({
    method: 'eth_signTypedData_v4' as const,
    params: [account, JSON.stringify(payload)],
  });
  /** 100 USDC → WETH (router custody, min 0) → UNWRAP_WETH to `recipient` with `minOut`. */
  const usdcToEth = (recipient: Address, minOut: bigint) =>
    r.urExecute([
      r.v3ExactIn({
        recipient: r.ADDRESS_THIS,
        amountIn: AMOUNT_IN,
        amountOutMin: 0n,
        path: [USDC, WETH],
      }),
      r.unwrapWeth(recipient, minOut),
    ]);

  return [
    {
      id: 'S0',
      title: '정상 승인',
      actual: 'approve(Permit2, MAX)',
      request: tx(USDC, c.approve(PERMIT2, c.MAX_UINT256)),
      expected: { level: 'LOW', ruleIds: ['R1'] },
    },
    {
      id: 'S1',
      title: '정상 스왑',
      actual: '공식 UniversalRouter, recipient = 본인, minOut > 0',
      request: tx(UR, usdcToEth(r.MSG_SENDER, MIN_ETH_OUT)),
      expected: { level: 'LOW', ruleIds: ['R7'] },
    },
    {
      id: 'S2',
      title: 'BadgerDAO형',
      actual: 'approve(ATTACKER, MAX)',
      request: tx(USDC, c.approve(ATTACKER, c.MAX_UINT256)),
      expected: { level: 'HIGH', ruleIds: ['R2'] },
    },
    {
      id: 'S3',
      title: 'Permit2 드레인',
      actual: 'Permit2 PermitSingle, spender = ATTACKER',
      request: typed(permit2Single({ chainId: CHAIN, token: USDC, spender: ATTACKER })),
      expected: { level: 'HIGH', ruleIds: ['R2'] },
    },
    {
      id: 'S4',
      title: 'CoW형',
      actual: 'CoW 주문, receiver = ATTACKER',
      request: typed(
        cowOrder({ chainId: CHAIN, receiver: ATTACKER, sellToken: USDC, buyToken: WETH }),
      ),
      expected: { level: 'HIGH', ruleIds: ['R6'] },
    },
    {
      id: 'S5',
      title: '가짜 settlement',
      actual: 'CoW 주문, verifyingContract = ATTACKER',
      request: typed(
        cowOrder({
          chainId: CHAIN,
          receiver: account,
          sellToken: USDC,
          buyToken: WETH,
          verifyingContract: ATTACKER,
        }),
      ),
      expected: { level: 'HIGH', ruleIds: ['R5'] },
    },
    {
      id: 'S6',
      title: 'NFT',
      actual: 'setApprovalForAll(ATTACKER, true)',
      request: tx(TOKENS.nft, c.setApprovalForAll(ATTACKER, true)),
      expected: { level: 'HIGH', ruleIds: ['R3'] },
    },
    {
      id: 'S7',
      title: '진짜 router 악용',
      actual: '공식 UniversalRouter, recipient = ATTACKER',
      request: tx(UR, usdcToEth(ATTACKER, MIN_ETH_OUT)),
      expected: { level: 'HIGH', ruleIds: ['R8'] },
    },
    {
      id: 'S8',
      title: '슬리피지 0',
      actual: '공식 UniversalRouter, recipient = 본인, minOut = 0',
      request: tx(UR, usdcToEth(r.MSG_SENDER, 0n)),
      expected: { level: 'MEDIUM', ruleIds: ['R10'] },
    },
    {
      id: 'S9',
      title: '가짜 router',
      actual: 'to = ATTACKER, 임의 calldata',
      request: tx(ATTACKER, '0x3593564c' + '00'.repeat(64)),
      expected: { level: 'HIGH', ruleIds: ['R11'] },
    },
    {
      id: 'S10',
      title: '권한 회수',
      actual: 'approve(ATTACKER, 0)',
      request: tx(USDC, c.approve(ATTACKER, 0n)),
      expected: { level: 'LOW', ruleIds: ['R4'] },
    },
  ];
}
