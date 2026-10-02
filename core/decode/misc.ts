import { decodeFunctionData, parseAbi, toFunctionSelector, type Address, type Hex } from 'viem';
import type { TransferAction, UtilityAction } from '../types';

const MISC_ABI = parseAbi([
  'function transfer(address to, uint256 amount)',
  'function transferFrom(address from, address to, uint256 amount)',
  // WETH9
  'function deposit() payable',
  'function withdraw(uint256 wad)',
]);

const SELECTORS = new Set(MISC_ABI.map((f) => toFunctionSelector(f).toLowerCase()));

export function decodeMiscTx(
  to: Address,
  data: Hex,
  value: bigint,
): TransferAction | UtilityAction | undefined {
  if (!SELECTORS.has(data.slice(0, 10).toLowerCase())) return undefined;
  const { functionName, args } = decodeFunctionData({ abi: MISC_ABI, data });
  switch (functionName) {
    case 'transfer':
      return { kind: 'transfer', fn: 'transfer', to, recipient: args[0], amount: args[1] };
    case 'transferFrom':
      return {
        kind: 'transfer',
        fn: 'transferFrom',
        to,
        from: args[0],
        recipient: args[1],
        amount: args[2],
      };
    case 'deposit':
      return { kind: 'utility', to, fn: 'deposit', amount: value };
    case 'withdraw':
      return { kind: 'utility', to, fn: 'withdraw', amount: args[0] };
  }
}
