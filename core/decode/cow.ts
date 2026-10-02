import { decodeFunctionData, parseAbi, toFunctionSelector, type Address, type Hex } from 'viem';
import type {
  CowEthFlowOrderAction,
  CowOrderAction,
  CowPreSignatureAction,
  RouterNoopAction,
} from '../types';
import type { ParsedTypedData } from './typedData';
import { asAddress, toBigInt, ZERO_ADDRESS } from './util';

// CoWSwapEthFlow (cowprotocol/ethflowcontract src/libraries/EthFlowOrder.sol `Data`)
// and GPv2Settlement (cowprotocol/contracts) functions the CoW frontend calls.
const ETHFLOW_ORDER =
  '(address buyToken, address receiver, uint256 sellAmount, uint256 buyAmount, bytes32 appData, uint256 feeAmount, uint32 validTo, bool partiallyFillable, int64 quoteId)';

const COW_TX_ABI = parseAbi([
  `function createOrder(${ETHFLOW_ORDER} order)`,
  `function invalidateOrder(${ETHFLOW_ORDER} order)`,
  'function setPreSignature(bytes orderUid, bool signed)',
  'function invalidateOrder(bytes orderUid)',
]);

const SELECTORS = new Set(COW_TX_ABI.map((f) => toFunctionSelector(f).toLowerCase()));

/** CoW order typed data: `domain.name === 'Gnosis Protocol'`, `primaryType === 'Order'`. */
export function decodeCowOrder(td: ParsedTypedData): CowOrderAction | undefined {
  if (td.domainName !== 'Gnosis Protocol' || td.primaryType !== 'Order') return undefined;
  const m = td.message;
  const sellToken = asAddress(m.sellToken);
  const buyToken = asAddress(m.buyToken);
  const sellAmount = toBigInt(m.sellAmount);
  const buyAmount = toBigInt(m.buyAmount);
  // GPv2Order.RECEIVER_SAME_AS_OWNER is the zero address; treat an omitted receiver the same way.
  const receiver = m.receiver == null ? ZERO_ADDRESS : asAddress(m.receiver);
  if (!sellToken || !buyToken || sellAmount === undefined || buyAmount === undefined || !receiver) {
    return undefined;
  }
  return {
    kind: 'cowOrder',
    verifyingContract: td.verifyingContract,
    receiver,
    sellToken,
    buyToken,
    sellAmount,
    buyAmount,
  };
}

/** EthFlow `createOrder` / `invalidateOrder`, Settlement `setPreSignature` / `invalidateOrder`. */
export function decodeCowTx(
  to: Address,
  data: Hex,
): CowEthFlowOrderAction | CowPreSignatureAction | RouterNoopAction | undefined {
  if (!SELECTORS.has(data.slice(0, 10).toLowerCase())) return undefined;
  const { functionName, args } = decodeFunctionData({ abi: COW_TX_ABI, data });
  switch (functionName) {
    case 'createOrder': {
      const [o] = args;
      return {
        kind: 'cowEthFlowOrder',
        to,
        receiver: o.receiver,
        buyToken: o.buyToken,
        sellAmount: o.sellAmount,
        buyAmount: o.buyAmount,
      };
    }
    case 'setPreSignature':
      return { kind: 'cowPreSignature', to, orderUid: args[0], signed: args[1] };
    case 'invalidateOrder':
      // Cancelling: EthFlow refunds the order owner; Settlement just marks the UID invalid.
      return { kind: 'routerNoop', to, fn: 'invalidateOrder' };
  }
}
