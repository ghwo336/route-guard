import type { Address } from 'viem';
import { asAddress, isRecord } from './util';

export type ParsedTypedData = {
  domain: Record<string, unknown>;
  primaryType: string;
  message: Record<string, unknown>;
  types: Record<string, unknown>;
  domainName?: string;
  verifyingContract?: Address;
};

/** Parse an EIP-712 payload given as a JSON string or an object. Returns undefined if malformed. */
export function parseTypedData(raw: unknown): ParsedTypedData | undefined {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (!isRecord(value)) return undefined;
  const { domain, primaryType, message, types } = value;
  if (!isRecord(domain) || typeof primaryType !== 'string' || !isRecord(message)) return undefined;
  return {
    domain,
    primaryType,
    message,
    types: isRecord(types) ? types : {},
    domainName: typeof domain.name === 'string' ? domain.name : undefined,
    verifyingContract: asAddress(domain.verifyingContract),
  };
}

/**
 * `eth_signTypedData_v3/v4` params are `[address, typedData]`, but some dApps send them
 * reversed. Pick the non-address element as the payload.
 */
export function splitTypedDataParams(
  params: unknown,
): { signer?: Address; payload: unknown } | undefined {
  if (!Array.isArray(params) || params.length < 2) return undefined;
  const [a, b] = params as [unknown, unknown];
  const aAddr = asAddress(a);
  const bAddr = asAddress(b);
  if (aAddr && !bAddr) return { signer: aAddr, payload: b };
  if (bAddr && !aAddr) return { signer: bAddr, payload: a };
  return undefined;
}
