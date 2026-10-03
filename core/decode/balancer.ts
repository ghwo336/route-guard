import {
  decodeFunctionData,
  getAddress,
  parseAbi,
  toFunctionSelector,
  type Address,
  type Hex,
} from 'viem';
import type { RouterCallAction, RouterKind, SetApprovalForAllAction } from '../types';
import type { ParsedTypedData } from './typedData';
import { MSG_SENDER } from './router';
import { asHex, ZERO_ADDRESS } from './util';

// Balancer V2 Vault — balancer-v2-monorepo pkg/interfaces/contracts/vault/IVault.sol
const FUNDS =
  '(address sender, bool fromInternalBalance, address recipient, bool toInternalBalance)';
const VAULT_ABI = parseAbi([
  `function swap((bytes32 poolId, uint8 kind, address assetIn, address assetOut, uint256 amount, bytes userData) singleSwap, ${FUNDS} funds, uint256 limit, uint256 deadline) payable returns (uint256)`,
  `function batchSwap(uint8 kind, (bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData)[] swaps, address[] assets, ${FUNDS} funds, int256[] limits, uint256 deadline) payable returns (int256[])`,
  'function setRelayerApproval(address sender, address relayer, bool approved)',
]);

// Balancer V3 Router / BatchRouter — balancer-v3-monorepo pkg/interfaces/contracts/vault/
// IRouter.sol, IBatchRouter.sol, BatchRouterTypes.sol, IRouterCommon.sol
const V3_ABI = parseAbi([
  'struct SwapPathStep { address pool; address tokenOut; bool isBuffer; }',
  'struct SwapPathExactAmountIn { address tokenIn; SwapPathStep[] steps; uint256 exactAmountIn; uint256 minAmountOut; }',
  'struct SwapPathExactAmountOut { address tokenIn; SwapPathStep[] steps; uint256 maxAmountIn; uint256 exactAmountOut; }',
  'function swapSingleTokenExactIn(address pool, address tokenIn, address tokenOut, uint256 exactAmountIn, uint256 minAmountOut, uint256 deadline, bool wethIsEth, bytes userData) payable returns (uint256)',
  'function swapSingleTokenExactOut(address pool, address tokenIn, address tokenOut, uint256 exactAmountOut, uint256 maxAmountIn, uint256 deadline, bool wethIsEth, bytes userData) payable returns (uint256)',
  'function swapExactIn(SwapPathExactAmountIn[] paths, uint256 deadline, bool wethIsEth, bytes userData) payable',
  'function swapExactOut(SwapPathExactAmountOut[] paths, uint256 deadline, bool wethIsEth, bytes userData) payable',
  'function permitBatchAndCall((address token, address owner, address spender, uint256 amount, uint256 nonce, uint256 deadline)[] permitBatch, bytes[] permitSignatures, ((address token, uint160 amount, uint48 expiration, uint48 nonce)[] details, address spender, uint256 sigDeadline) permit2Batch, bytes permit2Signature, bytes[] multicallData) payable',
  'function multicall(bytes[] data) payable',
]);

const sel = (abi: readonly Parameters<typeof toFunctionSelector>[0][]) =>
  new Set(abi.map((f) => toFunctionSelector(f).toLowerCase()));
const VAULT_SELECTORS = sel(VAULT_ABI);
const V3_SELECTORS = sel(V3_ABI);
const MAX_DEPTH = 3;

type Acc = {
  router?: RouterKind;
  recipients: Address[];
  floors: bigint[];
  tokenOut?: Address;
  hasSwap: boolean;
  /** V2 batchSwap without any negative limit: output floor cannot be told apart (no R10). */
  floorUnknown: boolean;
  errors: string[];
};

const first = (e: unknown) => (e as Error).message.split('\n')[0];

function relayerApproval(
  to: Address,
  relayer: Address,
  approved: boolean,
): SetApprovalForAllAction {
  return {
    kind: 'setApprovalForAll',
    scope: 'balancer-relayer',
    to,
    operator: getAddress(relayer),
    approved,
  };
}

/** V2 Vault swap / batchSwap. */
function decodeVaultSwap(data: Hex, acc: Acc): void {
  const { functionName, args } = decodeFunctionData({ abi: VAULT_ABI, data });
  acc.router = 'balancer-v2-vault';
  acc.hasSwap = true;
  if (functionName === 'swap') {
    const [single, funds, limit] = args;
    acc.recipients.push(getAddress(funds.recipient));
    acc.tokenOut = getAddress(single.assetOut);
    // GIVEN_IN (0): `limit` is the minimum out; GIVEN_OUT (1): `amount` is the exact out
    acc.floors.push(single.kind === 0 ? limit : single.amount);
    return;
  }
  if (functionName === 'batchSwap') {
    const [, , assets, funds, limits] = args;
    acc.recipients.push(getAddress(funds.recipient));
    // Vault checks delta <= limits[i]; outgoing assets have negative deltas, so a minimum
    // output shows up as a negative limit (b-sdk limitsBatchSwap: out = -minAmountOut).
    // An output with limit 0 cannot be told apart from an intermediate asset of a multi-hop
    // route (also 0), so without any negative limit we do not judge slippage (no R10).
    let best: { i: number; floor: bigint } | undefined;
    limits.forEach((l, i) => {
      if (l < 0n && (!best || -l > best.floor)) best = { i, floor: -l };
    });
    if (best) {
      acc.floors.push(best.floor);
      const out = assets[best.i];
      if (out) acc.tokenOut = getAddress(out);
    } else {
      acc.floorUnknown = true;
    }
    return;
  }
  throw new Error('스왑 함수가 아님');
}

/** V3 Router / BatchRouter calls; output always goes to msg.sender (no recipient argument). */
function decodeV3(data: Hex, acc: Acc, depth: number): void {
  const { functionName, args } = decodeFunctionData({ abi: V3_ABI, data });
  switch (functionName) {
    case 'swapSingleTokenExactIn':
    case 'swapSingleTokenExactOut': {
      acc.router ??= 'balancer-v3-router';
      acc.hasSwap = true;
      acc.recipients.push(MSG_SENDER);
      acc.tokenOut = getAddress(args[2]);
      // ExactIn: (…, exactAmountIn, minAmountOut, …); ExactOut: (…, exactAmountOut, maxAmountIn, …)
      acc.floors.push(functionName === 'swapSingleTokenExactIn' ? args[4] : args[3]);
      return;
    }
    case 'swapExactIn':
    case 'swapExactOut': {
      acc.router ??= 'balancer-v3-batch-router';
      acc.hasSwap = true;
      acc.recipients.push(MSG_SENDER);
      const [paths] = args;
      const lastStep = paths[0]?.steps.at(-1);
      if (lastStep) acc.tokenOut = getAddress(lastStep.tokenOut);
      // per-path limits add up to the total (b-sdk checks the sum)
      acc.floors.push(
        paths.reduce((s, p) => s + ('minAmountOut' in p ? p.minAmountOut : p.exactAmountOut), 0n),
      );
      return;
    }
    case 'permitBatchAndCall':
    case 'multicall': {
      if (depth >= MAX_DEPTH) throw new Error('multicall 중첩이 너무 깊음');
      // Permits inside were signed by the user beforehand (checked at signing time).
      const calls = functionName === 'multicall' ? args[0] : args[4];
      for (const call of calls) {
        try {
          decodeV3(call, acc, depth + 1);
        } catch (e) {
          acc.errors.push(`multicall 내부 호출 해석 불가 (${call.slice(0, 10)}): ${first(e)}`);
        }
      }
      return;
    }
  }
}

function finish(to: Address, value: bigint, acc: Acc): RouterCallAction {
  const action: RouterCallAction = {
    kind: 'routerCall',
    router: acc.router ?? 'balancer-v3-router',
    to,
    value,
    recipients: acc.recipients,
    hasSwap: acc.hasSwap,
  };
  if (acc.tokenOut) action.tokenOut = acc.tokenOut;
  if (acc.hasSwap && !acc.floorUnknown) {
    action.minAmountOut = acc.floors.reduce((m, x) => (x > m ? x : m), 0n);
  }
  if (acc.errors.length) action.decodeError = acc.errors.join('; ');
  return action;
}

/**
 * Balancer txs by selector. `preferred` lets the dispatcher try this decoder first when
 * `to` is a Balancer contract (multicall(bytes[]) collides with Uniswap SwapRouter02).
 * Relayer v6 multicalls contain BatchRelayerLibrary calls we do not decode → R9.
 */
export function decodeBalancerTx(
  to: Address,
  data: Hex,
  value: bigint,
): RouterCallAction | SetApprovalForAllAction | undefined {
  const selector = data.slice(0, 10).toLowerCase();
  const acc: Acc = { recipients: [], floors: [], hasSwap: false, floorUnknown: false, errors: [] };
  if (VAULT_SELECTORS.has(selector)) {
    try {
      const { functionName, args } = decodeFunctionData({ abi: VAULT_ABI, data });
      if (functionName === 'setRelayerApproval') return relayerApproval(to, args[1], args[2]);
      decodeVaultSwap(data, acc);
    } catch (e) {
      acc.router = 'balancer-v2-vault';
      acc.errors.push(`Vault 디코딩 실패: ${first(e)}`);
    }
    return finish(to, value, acc);
  }
  if (V3_SELECTORS.has(selector)) {
    try {
      decodeV3(data, acc, 0);
    } catch (e) {
      acc.errors.push(`Balancer router 디코딩 실패: ${first(e)}`);
    }
    return finish(to, value, acc);
  }
  return undefined;
}

/**
 * Relayer authorizations signed as EIP-712 (b-sdk RelayerAuthorization.signAuthorizationFor):
 * domain 'Balancer V2 Vault', primaryType SetRelayerApproval | Swap | BatchSwap, and
 * `message.calldata` is the Vault call being authorized.
 */
export function decodeBalancerTypedData(
  td: ParsedTypedData,
): RouterCallAction | SetApprovalForAllAction | undefined {
  if (td.domainName !== 'Balancer V2 Vault') return undefined;
  if (!['SetRelayerApproval', 'Swap', 'BatchSwap'].includes(td.primaryType)) return undefined;
  const calldata = asHex(td.message.calldata);
  if (!calldata) return undefined;
  const decoded = decodeBalancerTx(td.verifyingContract ?? ZERO_ADDRESS, calldata, 0n);
  return decoded;
}
