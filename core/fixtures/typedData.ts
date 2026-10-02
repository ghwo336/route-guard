import type { Address } from 'viem';
import { wl } from './whitelist';

const MAX_UINT160 = (2n ** 160n - 1n).toString();
const DEADLINE = '1900000000';

const EIP712_DOMAIN_NAMED = [
  { name: 'name', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
];

/** Permit2 PermitSingle, shaped like the Uniswap frontend's request. */
export function permit2Single(opts: {
  chainId: number;
  token: Address;
  spender: Address;
  amount?: string;
  verifyingContract?: Address;
}) {
  return {
    types: {
      EIP712Domain: EIP712_DOMAIN_NAMED,
      PermitSingle: [
        { name: 'details', type: 'PermitDetails' },
        { name: 'spender', type: 'address' },
        { name: 'sigDeadline', type: 'uint256' },
      ],
      PermitDetails: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint160' },
        { name: 'expiration', type: 'uint48' },
        { name: 'nonce', type: 'uint48' },
      ],
    },
    domain: {
      name: 'Permit2',
      chainId: opts.chainId,
      verifyingContract: opts.verifyingContract ?? wl(opts.chainId, 'uniswap', 'Permit2'),
    },
    primaryType: 'PermitSingle',
    message: {
      details: {
        token: opts.token,
        amount: opts.amount ?? MAX_UINT160,
        expiration: DEADLINE,
        nonce: '0',
      },
      spender: opts.spender,
      sigDeadline: DEADLINE,
    },
  };
}

export function permit2Batch(opts: { chainId: number; tokens: Address[]; spender: Address }) {
  const single = permit2Single({
    chainId: opts.chainId,
    token: opts.tokens[0]!,
    spender: opts.spender,
  });
  return {
    ...single,
    types: {
      ...single.types,
      PermitBatch: [
        { name: 'details', type: 'PermitDetails[]' },
        { name: 'spender', type: 'address' },
        { name: 'sigDeadline', type: 'uint256' },
      ],
    },
    primaryType: 'PermitBatch',
    message: {
      details: opts.tokens.map((token) => ({
        token,
        amount: MAX_UINT160,
        expiration: DEADLINE,
        nonce: '0',
      })),
      spender: opts.spender,
      sigDeadline: DEADLINE,
    },
  };
}

/** Permit2 SignatureTransfer with witness, as used for UniswapX orders. */
export function permit2Witness(opts: {
  chainId: number;
  token: Address;
  spender: Address;
  amount: string;
}) {
  return {
    types: {
      EIP712Domain: EIP712_DOMAIN_NAMED,
      PermitWitnessTransferFrom: [
        { name: 'permitted', type: 'TokenPermissions' },
        { name: 'spender', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'witness', type: 'V2DutchOrder' },
      ],
      TokenPermissions: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
    },
    domain: {
      name: 'Permit2',
      chainId: opts.chainId,
      verifyingContract: wl(opts.chainId, 'uniswap', 'Permit2'),
    },
    primaryType: 'PermitWitnessTransferFrom',
    message: {
      permitted: { token: opts.token, amount: opts.amount },
      spender: opts.spender,
      nonce: '1',
      deadline: DEADLINE,
      witness: {},
    },
  };
}

/** EIP-2612 Permit (USDC-style domain with version). */
export function eip2612Permit(opts: {
  chainId: number;
  token: Address;
  owner: Address;
  spender: Address;
  value: string;
}) {
  return {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    domain: {
      name: 'USD Coin',
      version: '2',
      chainId: opts.chainId,
      verifyingContract: opts.token,
    },
    primaryType: 'Permit',
    message: {
      owner: opts.owner,
      spender: opts.spender,
      value: opts.value,
      nonce: '0',
      deadline: DEADLINE,
    },
  };
}
