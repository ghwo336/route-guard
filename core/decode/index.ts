import type { Address } from 'viem';
import type { DecodedAction, SignRequest } from '../types';
import { decodeApprovalTx, decodePermit, decodePermit2 } from './approval';
import { decodeCowOrder, decodeCowTx } from './cow';
import { decodeMiscTx } from './misc';
import { decodeRouterTx } from './router';
import { decodeSushiTx } from './sushiswap';
import { decodeCurveTx } from './curve';
import { parseTypedData, splitTypedDataParams } from './typedData';
import { asAddress, asHex, isRecord, toBigInt } from './util';

export type DecodeContext = {
  /** UniversalRouter version for a whitelisted router address. */
  versionOf: (address: Address) => string | undefined;
  /** Whether `to` is a whitelisted `others` contract (calldata not interpreted). */
  isOther: (address: Address) => boolean;
};

export type DecodedRequest = {
  /** One action per call (wallet_sendCalls) or a single action. Never empty. */
  actions: DecodedAction[];
  /** The account that signs / sends, if it can be determined. */
  signer?: Address;
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message.split('\n')[0] : String(e));

/** Decode one transaction-like object `{ to, data|input, value }`. Never throws. */
export function decodeTx(tx: unknown, ctx: DecodeContext): DecodedAction {
  if (!isRecord(tx))
    return { kind: 'unknownCall', value: 0n, hasData: false, reason: 'tx 형식 오류' };
  const to = asAddress(tx.to);
  const rawData = tx.data ?? tx.input;
  const data = rawData === undefined || rawData === null ? '0x' : asHex(rawData);
  const value = tx.value === undefined || tx.value === null ? 0n : toBigInt(tx.value);

  if (data === undefined || value === undefined) {
    return {
      kind: 'unknownCall',
      to,
      value: value ?? 0n,
      hasData: data !== '0x',
      reason: 'data/value 형식 오류',
    };
  }
  const hasData = data.length > 2;
  if (!to) {
    return {
      kind: 'unknownCall',
      value,
      hasData,
      reason: tx.to == null ? '컨트랙트 생성' : 'to 형식 오류',
    };
  }
  if (ctx.isOther(to)) return { kind: 'other', to, value };
  if (!hasData) return { kind: 'unknownCall', to, value, hasData };

  try {
    return (
      decodeApprovalTx(to, data) ??
      decodeCowTx(to, data) ??
      decodeRouterTx(to, data, value, ctx.versionOf) ??
      decodeSushiTx(to, data, value) ??
      decodeCurveTx(to, data, value) ??
      decodeMiscTx(to, data, value) ?? { kind: 'unknownCall', to, value, hasData }
    );
  } catch (e) {
    return {
      kind: 'unknownCall',
      to,
      value,
      hasData,
      reason: `calldata 디코딩 실패: ${errMsg(e)}`,
    };
  }
}

function decodeTypedData(params: unknown, fallbackSigner?: Address): DecodedRequest {
  const split = splitTypedDataParams(params);
  const td = split ? parseTypedData(split.payload) : undefined;
  const signer = split?.signer ?? fallbackSigner;
  if (!td) {
    return { signer, actions: [{ kind: 'unknownTypedData', reason: 'typed data 형식 오류' }] };
  }
  const action: DecodedAction = decodePermit2(td) ??
    decodePermit(td) ??
    decodeCowOrder(td) ?? {
      kind: 'unknownTypedData',
      primaryType: td.primaryType,
      domainName: td.domainName,
      verifyingContract: td.verifyingContract,
    };
  return { signer, actions: [action] };
}

/** Dispatch by method. Never throws: malformed input becomes UnknownCall / UnknownTypedData. */
export function decodeRequest(req: SignRequest, ctx: DecodeContext): DecodedRequest {
  const params = Array.isArray(req.params) ? (req.params as unknown[]) : [];
  switch (req.method) {
    case 'eth_sendTransaction': {
      const tx = params[0];
      const signer = (isRecord(tx) ? asAddress(tx.from) : undefined) ?? req.from;
      return { signer, actions: [decodeTx(tx, ctx)] };
    }
    case 'wallet_sendCalls': {
      const p = params[0];
      const signer = (isRecord(p) ? asAddress(p.from) : undefined) ?? req.from;
      const calls = isRecord(p) && Array.isArray(p.calls) ? p.calls : undefined;
      if (!calls || calls.length === 0) {
        return {
          signer,
          actions: [{ kind: 'unknownCall', value: 0n, hasData: false, reason: 'calls 형식 오류' }],
        };
      }
      return { signer, actions: calls.map((c) => decodeTx(c, ctx)) };
    }
    case 'eth_signTypedData_v4':
    case 'eth_signTypedData_v3':
      return decodeTypedData(req.params, req.from);
    case 'eth_signTypedData':
      // v1: [typedDataArray, address] — not interpreted
      return {
        signer: asAddress(params[1]) ?? req.from,
        actions: [{ kind: 'opaqueSign', method: req.method }],
      };
    case 'personal_sign':
      return {
        signer: asAddress(params[1]) ?? req.from,
        actions: [{ kind: 'opaqueSign', method: req.method }],
      };
    case 'eth_sign':
      return {
        signer: asAddress(params[0]) ?? req.from,
        actions: [{ kind: 'opaqueSign', method: req.method }],
      };
  }
}
