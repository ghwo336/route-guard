import { getAddress, type Address } from 'viem';
import type { AllowedSet } from './whitelist/loader';
import { lookup } from './whitelist/loader';

/** 0xAbCd…1234 */
export function shortAddress(a: Address): string {
  const x = getAddress(a);
  return `${x.slice(0, 6)}…${x.slice(-4)}`;
}

/** "Label(0xAbCd…1234)" for whitelisted addresses, else the short address. */
export function describeAddress(a: Address, allowed: AllowedSet): string {
  const hit = lookup(allowed, a);
  if (!hit) return shortAddress(a);
  return `${hit.entry.label}${hit.entry.verified ? '' : ' (미검증)'}(${shortAddress(a)})`;
}

export function describeAmount(amount: bigint | 'UNLIMITED'): string {
  return amount === 'UNLIMITED' ? '무제한' : amount.toString();
}
