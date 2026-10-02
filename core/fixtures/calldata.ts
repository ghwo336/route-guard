import { encodeFunctionData, parseAbi, type Address, type Hex } from 'viem';

const ETHFLOW_ORDER =
  '(address buyToken, address receiver, uint256 sellAmount, uint256 buyAmount, bytes32 appData, uint256 feeAmount, uint32 validTo, bool partiallyFillable, int64 quoteId)';

const abi = parseAbi([
  'function approve(address spender, uint256 amount)',
  'function setApprovalForAll(address operator, bool approved)',
  'function transfer(address to, uint256 amount)',
  'function transferFrom(address from, address to, uint256 amount)',
  'function deposit()',
  'function withdraw(uint256 wad)',
  `function createOrder(${ETHFLOW_ORDER} order)`,
  `function invalidateOrder(${ETHFLOW_ORDER} order)`,
  'function setPreSignature(bytes orderUid, bool signed)',
  'function invalidateOrder(bytes orderUid)',
]);

export const MAX_UINT256 = 2n ** 256n - 1n;

export const approve = (spender: Address, amount: bigint): Hex =>
  encodeFunctionData({ abi, functionName: 'approve', args: [spender, amount] });

export const setApprovalForAll = (operator: Address, approved: boolean): Hex =>
  encodeFunctionData({ abi, functionName: 'setApprovalForAll', args: [operator, approved] });

export const transfer = (to: Address, amount: bigint): Hex =>
  encodeFunctionData({ abi, functionName: 'transfer', args: [to, amount] });

export const transferFrom = (from: Address, to: Address, amount: bigint): Hex =>
  encodeFunctionData({ abi, functionName: 'transferFrom', args: [from, to, amount] });

export const wethDeposit = (): Hex => encodeFunctionData({ abi, functionName: 'deposit' });

export const wethWithdraw = (wad: bigint): Hex =>
  encodeFunctionData({ abi, functionName: 'withdraw', args: [wad] });

function ethFlowOrder(o: { buyToken: Address; receiver: Address; sellAmount: bigint }) {
  return {
    buyToken: o.buyToken,
    receiver: o.receiver,
    sellAmount: o.sellAmount,
    buyAmount: 100_000_000n,
    appData: `0x${'00'.repeat(32)}` as Hex,
    feeAmount: 0n,
    validTo: 1900000000,
    partiallyFillable: false,
    quoteId: 1n,
  };
}

export const ethFlowCreateOrder = (o: {
  buyToken: Address;
  receiver: Address;
  sellAmount: bigint;
}): Hex => encodeFunctionData({ abi, functionName: 'createOrder', args: [ethFlowOrder(o)] });

export const ethFlowInvalidateOrder = (o: {
  buyToken: Address;
  receiver: Address;
  sellAmount: bigint;
}): Hex => encodeFunctionData({ abi, functionName: 'invalidateOrder', args: [ethFlowOrder(o)] });

const ORDER_UID: Hex = `0x${'ab'.repeat(56)}`;

export const setPreSignature = (signed: boolean): Hex =>
  encodeFunctionData({ abi, functionName: 'setPreSignature', args: [ORDER_UID, signed] });

export const settlementInvalidateOrder = (): Hex =>
  encodeFunctionData({ abi, functionName: 'invalidateOrder', args: [ORDER_UID] });
