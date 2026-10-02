import { getAddress, isAddress, isHex, type Address, type Hex } from 'viem';

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function asAddress(v: unknown): Address | undefined {
  return typeof v === 'string' && isAddress(v, { strict: false }) ? getAddress(v) : undefined;
}

/** Accepts bigint, safe integers, decimal strings and 0x-hex strings. */
export function toBigInt(v: unknown): bigint | undefined {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return Number.isSafeInteger(v) ? BigInt(v) : undefined;
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^-?\d+$/.test(s) || /^0x[0-9a-fA-F]+$/.test(s)) {
      try {
        return BigInt(s);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function asHex(v: unknown): Hex | undefined {
  return typeof v === 'string' && isHex(v) ? v : undefined;
}

export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/** `amount >= 2^160 - 1` counts as unlimited (covers uint160 max for Permit2 and uint256 max). */
export const UNLIMITED_THRESHOLD = 2n ** 160n - 1n;

export function isUnlimited(amount: bigint): boolean {
  return amount >= UNLIMITED_THRESHOLD;
}

export function sameAddress(a: Address | undefined, b: Address | undefined): boolean {
  return a !== undefined && b !== undefined && getAddress(a) === getAddress(b);
}
