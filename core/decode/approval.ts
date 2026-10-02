import { decodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import type {
  ApproveAction,
  Permit2Action,
  PermitAction,
  SetApprovalForAllAction,
  TokenAmount,
} from '../types';
import type { ParsedTypedData } from './typedData';
import { asAddress, isRecord, toBigInt } from './util';

const APPROVAL_ABI = parseAbi([
  'function approve(address spender, uint256 amount)',
  'function increaseAllowance(address spender, uint256 addedValue)',
  'function setApprovalForAll(address operator, bool approved)',
  // Permit2 AllowanceTransfer.approve, sent directly as a tx
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
]);

const SELECTORS = new Set(['0x095ea7b3', '0x39509351', '0xa22cb465', '0x87517c45']);

export function decodeApprovalTx(
  to: Address,
  data: Hex,
): ApproveAction | SetApprovalForAllAction | undefined {
  if (!SELECTORS.has(data.slice(0, 10).toLowerCase())) return undefined;
  const { functionName, args } = decodeFunctionData({ abi: APPROVAL_ABI, data });
  switch (functionName) {
    case 'approve':
      if (args.length === 4) {
        const [token, spender, amount] = args;
        return { kind: 'approve', fn: 'permit2Approve', to, token, spender, amount };
      }
      return { kind: 'approve', fn: 'approve', to, token: to, spender: args[0], amount: args[1] };
    case 'increaseAllowance':
      return {
        kind: 'approve',
        fn: 'increaseAllowance',
        to,
        token: to,
        spender: args[0],
        amount: args[1],
      };
    case 'setApprovalForAll':
      return { kind: 'setApprovalForAll', to, operator: args[0], approved: args[1] };
  }
}

function tokenAmount(v: unknown): TokenAmount | undefined {
  if (!isRecord(v)) return undefined;
  const token = asAddress(v.token);
  const amount = toBigInt(v.amount);
  return token !== undefined && amount !== undefined ? { token, amount } : undefined;
}

function tokenAmounts(v: unknown): TokenAmount[] | undefined {
  const list = Array.isArray(v) ? v : [v];
  const out = list.map(tokenAmount);
  return out.every((x): x is TokenAmount => x !== undefined) ? out : undefined;
}

/**
 * Permit2 (`domain.name === 'Permit2'`): PermitSingle / PermitBatch use `details`,
 * the SignatureTransfer family (incl. witness variants used by UniswapX) uses `permitted`.
 */
export function decodePermit2(td: ParsedTypedData): Permit2Action | undefined {
  if (td.domainName !== 'Permit2') return undefined;
  const spender = asAddress(td.message.spender);
  const permitted = tokenAmounts(td.message.details ?? td.message.permitted);
  if (!spender || !permitted || permitted.length === 0) return undefined;
  return {
    kind: 'permit2',
    primaryType: td.primaryType,
    verifyingContract: td.verifyingContract,
    spender,
    permitted,
  };
}

/** EIP-2612 `Permit`, plus the DAI-style variant (`holder`, `allowed`). */
export function decodePermit(td: ParsedTypedData): PermitAction | undefined {
  if (td.primaryType !== 'Permit' || td.domainName === 'Permit2') return undefined;
  const m = td.message;
  const spender = asAddress(m.spender);
  if (!spender) return undefined;
  let amount = toBigInt(m.value);
  if (amount === undefined && typeof m.allowed === 'boolean') {
    amount = m.allowed ? 2n ** 256n - 1n : 0n;
  }
  if (amount === undefined) return undefined;
  return {
    kind: 'permit',
    verifyingContract: td.verifyingContract,
    owner: asAddress(m.owner ?? m.holder),
    spender,
    amount,
  };
}
