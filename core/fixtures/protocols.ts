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
