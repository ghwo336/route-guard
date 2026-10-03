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
