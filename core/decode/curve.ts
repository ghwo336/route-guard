import {
  decodeFunctionData,
  getAddress,
  parseAbi,
  toFunctionSelector,
  type Address,
  type Hex,
} from 'viem';
import type { RouterCallAction } from '../types';
import { MSG_SENDER } from './router';

/**
 * Curve Router NG v1.2.0 (curvefi/curve-router-ng contracts/Router.vy):
 *   exchange(_route: address[11], _swap_params: uint256[5][5], _amount, _min_dy,
 *            _pools: address[5] = empty, _receiver: address = msg.sender)
 * Vyper default args give three overloads. The official frontend (curve-js) uses the 5-arg
 * form on mainnet, so the receiver is msg.sender; a 6-arg call names the receiver explicitly.
 */
export const CURVE_ABI = parseAbi([
  'function exchange(address[11] _route, uint256[5][5] _swap_params, uint256 _amount, uint256 _min_dy) payable returns (uint256)',
  'function exchange(address[11] _route, uint256[5][5] _swap_params, uint256 _amount, uint256 _min_dy, address[5] _pools) payable returns (uint256)',
  'function exchange(address[11] _route, uint256[5][5] _swap_params, uint256 _amount, uint256 _min_dy, address[5] _pools, address _receiver) payable returns (uint256)',
]);
const SELECTORS = new Set(CURVE_ABI.map((f) => toFunctionSelector(f).toLowerCase()));
const ZERO = '0x0000000000000000000000000000000000000000';

/**
 * Router.vy walks `_route` as token, pool, token, pool, …:
 *   output_token = _route[(i + 1) * 2]; stop when i == 4 or _route[i * 2 + 3] == empty(address)
 */
export function curveOutputToken(route: readonly Address[]): Address | undefined {
  let i = 0;
  while (i < 4 && route[i * 2 + 3] !== undefined && getAddress(route[i * 2 + 3]!) !== ZERO) i++;
  const out = route[(i + 1) * 2];
  return out && getAddress(out) !== ZERO ? getAddress(out) : undefined;
}

export function decodeCurveTx(to: Address, data: Hex, value: bigint): RouterCallAction | undefined {
  if (!SELECTORS.has(data.slice(0, 10).toLowerCase())) return undefined;
  const base = { kind: 'routerCall', router: 'curve-router-ng', to, value, hasSwap: true } as const;
  try {
    const { args } = decodeFunctionData({ abi: CURVE_ABI, data });
    const [route, , , minDy] = args;
    const receiver = args.length === 6 ? getAddress(args[5]) : MSG_SENDER;
    return {
      ...base,
      recipients: [receiver],
      tokenOut: curveOutputToken(route),
      minAmountOut: minDy,
    };
  } catch (e) {
    return {
      ...base,
      recipients: [],
      decodeError: `Curve Router NG 디코딩 실패: ${(e as Error).message.split('\n')[0]}`,
    };
  }
}
