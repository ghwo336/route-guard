import {
  decodeFunctionData,
  getAddress,
  parseAbi,
  toFunctionSelector,
  type Address,
  type Hex,
} from 'viem';
import type { RouterCallAction } from '../types';

/**
 * SushiSwap RedSnwapper (sushi-labs/sushi RED_SNWAPPER_ADDRESS, verified source
 * contracts/RedSnwapper.sol). The swap is performed by a caller-chosen `executor` that
 * receives the user's tokenIn directly; the contract only checks that `recipient`'s balance
 * of tokenOut grew by at least `amountOutMin`. So the execution path cannot be verified and
 * every call is flagged (review decision 1 → R9), while recipient / minOut are still read.
 */
const ABI = parseAbi([
  'function snwap(address tokenIn, uint256 amountIn, address recipient, address tokenOut, uint256 amountOutMin, address executor, bytes executorData) payable returns (uint256)',
  'function snwapMultiple((address token, uint256 amountIn, address transferTo)[] inputTokens, (address token, address recipient, uint256 amountOutMin)[] outputTokens, (address executor, uint256 value, bytes data)[] executors) payable returns (uint256[])',
]);
const SELECTORS = new Set(ABI.map((f) => toFunctionSelector(f).toLowerCase()));

const OPAQUE = '임의 executor';

export function decodeSushiTx(to: Address, data: Hex, value: bigint): RouterCallAction | undefined {
  if (!SELECTORS.has(data.slice(0, 10).toLowerCase())) return undefined;
  const base = {
    kind: 'routerCall',
    router: 'sushi-redsnwapper',
    to,
    value,
    hasSwap: true,
  } as const;
  try {
    const { functionName, args } = decodeFunctionData({ abi: ABI, data });
    if (functionName === 'snwap') {
      const [, , recipient, tokenOut, amountOutMin] = args;
      return {
        ...base,
        recipients: [getAddress(recipient)],
        tokenOut: getAddress(tokenOut),
        minAmountOut: amountOutMin,
        opaqueExecution: OPAQUE,
      };
    }
    const [, outputs] = args;
    // several outputs: report the first token and the weakest floor
    const floors = outputs.map((o) => o.amountOutMin);
    return {
      ...base,
      recipients: outputs.map((o) => getAddress(o.recipient)),
      tokenOut: outputs[0] ? getAddress(outputs[0].token) : undefined,
      minAmountOut: floors.length ? floors.reduce((m, x) => (x < m ? x : m)) : 0n,
      opaqueExecution: OPAQUE,
    };
  } catch (e) {
    return {
      ...base,
      recipients: [],
      opaqueExecution: OPAQUE,
      decodeError: `RedSnwapper 디코딩 실패: ${(e as Error).message.split('\n')[0]}`,
    };
  }
}
