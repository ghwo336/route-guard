import type { Address } from 'viem';
import type { UniswapXWitness } from '../types';
import type { ParsedTypedData } from './typedData';
import { asAddress, isRecord, toBigInt } from './util';

/**
 * UniswapX orders are Permit2 `PermitWitnessTransferFrom` signatures whose `witness` is the
 * order. Witness type names and output fields from @uniswap/uniswapx-sdk (src/order/*.ts):
 * - ExclusiveDutchOrder (v1): outputs[] { token, startAmount, endAmount, recipient }
 * - V2DutchOrder:           baseOutputs[] { token, startAmount, endAmount, recipient }
 * - V3DutchOrder:           baseOutputs[] { token, startAmount, curve, recipient, minAmount, … }
 * - PriorityOrder:          outputs[] { token, amount, mpsPerPriorityFeeWei, recipient }
 * Other witness types (e.g. RelayOrder) are not decoded.
 */
const ORDER_SPECS: Record<string, { outputs: string; min: string }> = {
  ExclusiveDutchOrder: { outputs: 'outputs', min: 'endAmount' },
  V2DutchOrder: { outputs: 'baseOutputs', min: 'endAmount' },
  V3DutchOrder: { outputs: 'baseOutputs', min: 'minAmount' },
  PriorityOrder: { outputs: 'outputs', min: 'amount' },
};

/** The EIP-712 type name of `message.witness`, if the primary type declares one. */
function witnessTypeName(td: ParsedTypedData): string | undefined {
  const fields = td.types[td.primaryType];
  if (!Array.isArray(fields)) return undefined;
  const f = fields.find(
    (x): x is { name: string; type: string } => isRecord(x) && x.name === 'witness',
  );
  return typeof f?.type === 'string' ? f.type : undefined;
}

/**
 * Decode the order inside a Permit2 witness signature. Returns undefined when the
 * signature carries no witness at all.
 */
export function decodeUniswapXWitness(td: ParsedTypedData): UniswapXWitness | undefined {
  const typeName = witnessTypeName(td);
  if (typeName === undefined && td.message.witness === undefined) return undefined;
  if (typeName === undefined) return { error: 'witness 타입 정보 없음' };

  const spec = ORDER_SPECS[typeName];
  if (!spec) return { orderType: typeName, error: '해석하지 않는 주문 타입' };

  const w = td.message.witness;
  const outputs = isRecord(w) ? w[spec.outputs] : undefined;
  if (!Array.isArray(outputs) || outputs.length === 0) {
    return { orderType: typeName, error: '주문 형식 오류' };
  }
  const recipients: Address[] = [];
  for (const o of outputs) {
    const r = isRecord(o) ? asAddress(o.recipient) : undefined;
    if (!r) return { orderType: typeName, error: '주문 형식 오류' };
    recipients.push(r);
  }
  const first = outputs[0] as Record<string, unknown>;
  const info = isRecord(w) && isRecord(w.info) ? w.info : {};
  return {
    orderType: typeName,
    reactor: asAddress(info.reactor),
    swapper: asAddress(info.swapper),
    recipients,
    tokenOut: asAddress(first.token),
    minAmountOut: toBigInt(first[spec.min]),
  };
}
