import { encodeFunctionData, parseAbi, type Address, type Hex } from 'viem';

/** Calldata builders for Phase 7 protocols (SushiSwap, Curve, Balancer). Test data only. */

export const NATIVE_EEEE: Address = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

const sushiAbi = parseAbi([
  'function snwap(address tokenIn, uint256 amountIn, address recipient, address tokenOut, uint256 amountOutMin, address executor, bytes executorData) payable returns (uint256)',
  'function snwapMultiple((address token, uint256 amountIn, address transferTo)[] inputTokens, (address token, address recipient, uint256 amountOutMin)[] outputTokens, (address executor, uint256 value, bytes data)[] executors) payable returns (uint256[])',
]);

export function sushiSnwap(o: {
  tokenIn: Address;
  amountIn: bigint;
  recipient: Address;
  tokenOut: Address;
  amountOutMin: bigint;
  executor: Address;
}): Hex {
  return encodeFunctionData({
    abi: sushiAbi,
    functionName: 'snwap',
    args: [
      o.tokenIn,
      o.amountIn,
      o.recipient,
      o.tokenOut,
      o.amountOutMin,
      o.executor,
      '0xba3f2165',
    ],
  });
}

export function sushiSnwapMultiple(o: {
  inputs: { token: Address; amountIn: bigint; transferTo: Address }[];
  outputs: { token: Address; recipient: Address; amountOutMin: bigint }[];
  executor: Address;
}): Hex {
  return encodeFunctionData({
    abi: sushiAbi,
    functionName: 'snwapMultiple',
    args: [o.inputs, o.outputs, [{ executor: o.executor, value: 0n, data: '0x' }]],
  });
}

const curveAbi = parseAbi([
  'function exchange(address[11] _route, uint256[5][5] _swap_params, uint256 _amount, uint256 _min_dy) payable returns (uint256)',
  'function exchange(address[11] _route, uint256[5][5] _swap_params, uint256 _amount, uint256 _min_dy, address[5] _pools) payable returns (uint256)',
  'function exchange(address[11] _route, uint256[5][5] _swap_params, uint256 _amount, uint256 _min_dy, address[5] _pools, address _receiver) payable returns (uint256)',
]);

const ZERO: Address = '0x0000000000000000000000000000000000000000';
const pad = <T>(xs: T[], n: number, fill: T): T[] => [...xs, ...Array<T>(n - xs.length).fill(fill)];

/**
 * Curve Router NG exchange. `route` = [token, pool, token, pool, …] (padded to 11).
 * `receiver` set → 6-arg overload; otherwise the 5-arg overload the frontend uses.
 */
export function curveExchange(o: {
  route: Address[];
  amount: bigint;
  minDy: bigint;
  receiver?: Address;
  fourArgs?: boolean;
}): Hex {
  const route = pad(o.route, 11, ZERO) as unknown as readonly [Address, Address, Address, Address, Address, Address, Address, Address, Address, Address, Address]; // prettier-ignore
  const params = Array.from({ length: 5 }, () => [1n, 0n, 1n, 1n, 2n] as const);
  const pools = [ZERO, ZERO, ZERO, ZERO, ZERO] as const;
  const swapParams = params as unknown as readonly [readonly [bigint, bigint, bigint, bigint, bigint], readonly [bigint, bigint, bigint, bigint, bigint], readonly [bigint, bigint, bigint, bigint, bigint], readonly [bigint, bigint, bigint, bigint, bigint], readonly [bigint, bigint, bigint, bigint, bigint]]; // prettier-ignore
  if (o.fourArgs) {
    return encodeFunctionData({
      abi: curveAbi,
      functionName: 'exchange',
      args: [route, swapParams, o.amount, o.minDy],
    });
  }
  if (o.receiver) {
    return encodeFunctionData({
      abi: curveAbi,
      functionName: 'exchange',
      args: [route, swapParams, o.amount, o.minDy, pools, o.receiver],
    });
  }
  return encodeFunctionData({
    abi: curveAbi,
    functionName: 'exchange',
    args: [route, swapParams, o.amount, o.minDy, pools],
  });
}

// --- Balancer ---------------------------------------------------------------

const FUNDS =
  '(address sender, bool fromInternalBalance, address recipient, bool toInternalBalance)';
const balV2Abi = parseAbi([
  `function swap((bytes32 poolId, uint8 kind, address assetIn, address assetOut, uint256 amount, bytes userData) singleSwap, ${FUNDS} funds, uint256 limit, uint256 deadline) payable returns (uint256)`,
  `function batchSwap(uint8 kind, (bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData)[] swaps, address[] assets, ${FUNDS} funds, int256[] limits, uint256 deadline) payable returns (int256[])`,
  'function setRelayerApproval(address sender, address relayer, bool approved)',
]);
const balV3Abi = parseAbi([
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

const POOL_ID: Hex = `0x${'11'.repeat(32)}`;
const funds = (sender: Address, recipient: Address, toInternalBalance = false) => ({
  sender,
  fromInternalBalance: false,
  recipient,
  toInternalBalance,
});

export function balancerV2Swap(o: {
  sender: Address;
  recipient: Address;
  assetIn: Address;
  assetOut: Address;
  amount: bigint;
  limit: bigint;
  givenOut?: boolean;
  toInternalBalance?: boolean;
}): Hex {
  return encodeFunctionData({
    abi: balV2Abi,
    functionName: 'swap',
    args: [
      {
        poolId: POOL_ID,
        kind: o.givenOut ? 1 : 0,
        assetIn: o.assetIn,
        assetOut: o.assetOut,
        amount: o.amount,
        userData: '0x',
      },
      funds(o.sender, o.recipient, o.toInternalBalance),
      o.limit,
      2n ** 53n,
    ],
  });
}

export function balancerV2BatchSwap(o: {
  sender: Address;
  recipient: Address;
  assets: Address[];
  limits: bigint[];
}): Hex {
  return encodeFunctionData({
    abi: balV2Abi,
    functionName: 'batchSwap',
    args: [
      0,
      [
        {
          poolId: POOL_ID,
          assetInIndex: 0n,
          assetOutIndex: BigInt(o.assets.length - 1),
          amount: 1n,
          userData: '0x',
        },
      ],
      o.assets,
      funds(o.sender, o.recipient),
      o.limits,
      2n ** 53n,
    ],
  });
}

export function balancerSetRelayerApproval(
  sender: Address,
  relayer: Address,
  approved: boolean,
): Hex {
  return encodeFunctionData({
    abi: balV2Abi,
    functionName: 'setRelayerApproval',
    args: [sender, relayer, approved],
  });
}

export function balancerV3SwapSingle(o: {
  tokenIn: Address;
  tokenOut: Address;
  amount: bigint;
  limit: bigint;
  exactOut?: boolean;
}): Hex {
  const args = [ZERO, o.tokenIn, o.tokenOut, o.amount, o.limit, 2n ** 53n, false, '0x'] as const;
  return o.exactOut
    ? encodeFunctionData({ abi: balV3Abi, functionName: 'swapSingleTokenExactOut', args })
    : encodeFunctionData({ abi: balV3Abi, functionName: 'swapSingleTokenExactIn', args });
}

export function balancerV3SwapExactIn(
  paths: { tokenIn: Address; tokenOut: Address; amountIn: bigint; minOut: bigint }[],
): Hex {
  return encodeFunctionData({
    abi: balV3Abi,
    functionName: 'swapExactIn',
    args: [
      paths.map((p) => ({
        tokenIn: p.tokenIn,
        steps: [{ pool: ZERO, tokenOut: p.tokenOut, isBuffer: false }],
        exactAmountIn: p.amountIn,
        minAmountOut: p.minOut,
      })),
      2n ** 53n,
      false,
      '0x',
    ],
  });
}

export function balancerV3SwapExactOut(
  paths: { tokenIn: Address; tokenOut: Address; maxIn: bigint; exactOut: bigint }[],
): Hex {
  return encodeFunctionData({
    abi: balV3Abi,
    functionName: 'swapExactOut',
    args: [
      paths.map((p) => ({
        tokenIn: p.tokenIn,
        steps: [{ pool: ZERO, tokenOut: p.tokenOut, isBuffer: false }],
        maxAmountIn: p.maxIn,
        exactAmountOut: p.exactOut,
      })),
      2n ** 53n,
      false,
      '0x',
    ],
  });
}

/** b-sdk buildCallWithPermit2: the swap call wrapped with an (already signed) Permit2 batch. */
export function balancerPermitBatchAndCall(calls: Hex[], spender: Address): Hex {
  return encodeFunctionData({
    abi: balV3Abi,
    functionName: 'permitBatchAndCall',
    args: [[], [], { details: [], spender, sigDeadline: 2n ** 53n }, '0x', calls],
  });
}

export function balancerMulticall(calls: Hex[]): Hex {
  return encodeFunctionData({ abi: balV3Abi, functionName: 'multicall', args: [calls] });
}

/** b-sdk RelayerAuthorization.signAuthorizationFor payload. */
export function balancerRelayerAuthorization(o: {
  chainId: number;
  vault: Address;
  primaryType: 'SetRelayerApproval' | 'Swap' | 'BatchSwap' | 'JoinPool';
  calldata: Hex;
  sender: Address;
}) {
  return {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      [o.primaryType]: [
        { name: 'calldata', type: 'bytes' },
        { name: 'sender', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    domain: {
      name: 'Balancer V2 Vault',
      version: '1',
      chainId: o.chainId,
      verifyingContract: o.vault,
    },
    primaryType: o.primaryType,
    message: {
      calldata: o.calldata,
      sender: o.sender,
      nonce: '0',
      deadline: (2n ** 256n - 1n).toString(),
    },
  };
}
