import type { Address, Hex } from 'viem';

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export const WATCHED_METHODS = [
  'eth_sendTransaction',
  'wallet_sendCalls',
  'eth_signTypedData_v4',
  'eth_signTypedData_v3',
  'eth_signTypedData',
  'personal_sign',
  'eth_sign',
] as const;

export type WatchedMethod = (typeof WATCHED_METHODS)[number];

export function isWatchedMethod(method: unknown): method is WatchedMethod {
  return typeof method === 'string' && (WATCHED_METHODS as readonly string[]).includes(method);
}

/** A sign request intercepted from an EIP-1193 provider. */
export type SignRequest = {
  method: WatchedMethod;
  /** Raw `params` exactly as the (untrusted) page sent them. */
  params: unknown;
  chainId: number;
  /** Currently selected account, if known. Used when the params do not name a sender. */
  from?: Address;
  /** Set by the content script / background, never by the page. */
  origin: string;
};

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

export type Mode = 'scoped' | 'global';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export const RULE_IDS = [
  'R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8',
  'R9', 'R10', 'R11', 'R12', 'R13', 'R14', 'R15', 'R16',
] as const; // prettier-ignore

export type RuleId = (typeof RULE_IDS)[number];

export type Amount = bigint | 'UNLIMITED';

/** Display-only annotation for an address shown in the warning (never affects the verdict). */
export type AddressNote = {
  /** Replaces the raw address (e.g. sentinels). */
  display?: string;
  /** Short tag next to it, e.g. "본인", "공식 Uniswap Permit2", "⚠ 본인 아님". */
  badge?: string;
  tone: 'ok' | 'warn';
};

export type VerdictDetails = {
  origin: string;
  protected: boolean;
  method: string;
  chainId: number;
  /** tx `to` / typed-data `verifyingContract` */
  target?: Address;
  spender?: Address;
  recipients?: Address[];
  token?: Address;
  tokenOut?: Address;
  amount?: Amount;
  minAmountOut?: bigint;
  /** 'uniswap' | 'cow' */
  matchedDex?: string;
  /** Display-only labels for target / spender / recipients (same order as `recipients`). */
  notes?: { target?: AddressNote; spender?: AddressNote; recipients?: AddressNote[] };
};

export type Verdict = {
  level: RiskLevel;
  ruleIds: RuleId[];
  /** One human-readable line (Korean). */
  summary: string;
  details: VerdictDetails;
};

// ---------------------------------------------------------------------------
// Decoded actions
// ---------------------------------------------------------------------------

export type TokenAmount = { token: Address; amount: bigint };

/** ERC-20 `approve` / `increaseAllowance`, or Permit2 `approve` sent as a tx. */
export type ApproveAction = {
  kind: 'approve';
  fn: 'approve' | 'increaseAllowance' | 'permit2Approve';
  /** tx `to`: the token (or Permit2 for `permit2Approve`) */
  to: Address;
  /** For `permit2Approve` the token is an argument; otherwise equals `to`. */
  token: Address;
  spender: Address;
  amount: bigint;
};

export type SetApprovalForAllAction = {
  kind: 'setApprovalForAll';
  to: Address;
  operator: Address;
  approved: boolean;
};

/** EIP-2612 Permit (typed data). `verifyingContract` is the token. */
export type PermitAction = {
  kind: 'permit';
  verifyingContract?: Address;
  owner?: Address;
  spender: Address;
  amount: bigint;
};

/** The order carried in a Permit2 witness (UniswapX). `error` when it could not be read. */
export type UniswapXWitness = {
  orderType?: string;
  reactor?: Address;
  swapper?: Address;
  recipients?: Address[];
  tokenOut?: Address;
  minAmountOut?: bigint;
  error?: string;
};

export type Permit2Action = {
  kind: 'permit2';
  primaryType: string;
  verifyingContract?: Address;
  spender: Address;
  permitted: TokenAmount[];
  /** Present for witness signatures (UniswapX orders). */
  witness?: UniswapXWitness;
};

/** CoW Protocol order (typed data). */
export type CowOrderAction = {
  kind: 'cowOrder';
  verifyingContract?: Address;
  receiver: Address;
  sellToken: Address;
  buyToken: Address;
  sellAmount: bigint;
  buyAmount: bigint;
};

/** CoWSwapEthFlow `createOrder` (tx). */
export type CowEthFlowOrderAction = {
  kind: 'cowEthFlowOrder';
  to: Address;
  receiver: Address;
  buyToken: Address;
  sellAmount: bigint;
  buyAmount: bigint;
};

/** GPv2Settlement `setPreSignature` (tx). The order body is not visible. */
export type CowPreSignatureAction = {
  kind: 'cowPreSignature';
  to: Address;
  orderUid: Hex;
  signed: boolean;
};

export type RouterKind = 'universal-router' | 'swap-router-02' | 'swap-proxy';

/** A call into a router that moves funds to one or more recipients. */
export type RouterCallAction = {
  kind: 'routerCall';
  router: RouterKind;
  to: Address;
  value: bigint;
  /** Every address that may receive output, as encoded (sentinels kept as-is). */
  recipients: Address[];
  hasSwap: boolean;
  tokenOut?: Address;
  /** Strongest output floor across the whole call (see AGENTS.md 8.3). */
  minAmountOut?: bigint;
  /** SwapProxy: the UniversalRouter it forwards to. */
  innerRouter?: Address;
  /** Set when some part could not be decoded; recipients are then incomplete. */
  decodeError?: string;
};

/** Router-side call that moves nothing to third parties (e.g. cancelling an order). */
export type RouterNoopAction = {
  kind: 'routerNoop';
  to: Address;
  fn: string;
};

export type UtilityAction = {
  kind: 'utility';
  to: Address;
  fn: 'deposit' | 'withdraw';
  amount: bigint;
};

/** tx to a whitelisted `others` contract; calldata is not interpreted. */
export type OtherAction = {
  kind: 'other';
  to: Address;
  value: bigint;
};

export type TransferAction = {
  kind: 'transfer';
  fn: 'transfer' | 'transferFrom';
  /** the token */
  to: Address;
  from?: Address;
  recipient: Address;
  amount: bigint;
};

export type UnknownCallAction = {
  kind: 'unknownCall';
  to?: Address;
  value: bigint;
  hasData: boolean;
  reason?: string;
};

export type OpaqueSignAction = {
  kind: 'opaqueSign';
  method: WatchedMethod;
};

export type UnknownTypedDataAction = {
  kind: 'unknownTypedData';
  primaryType?: string;
  domainName?: string;
  verifyingContract?: Address;
  reason?: string;
};

export type DecodedAction =
  | ApproveAction
  | SetApprovalForAllAction
  | PermitAction
  | Permit2Action
  | CowOrderAction
  | CowEthFlowOrderAction
  | CowPreSignatureAction
  | RouterCallAction
  | RouterNoopAction
  | UtilityAction
  | OtherAction
  | TransferAction
  | UnknownCallAction
  | OpaqueSignAction
  | UnknownTypedDataAction;
