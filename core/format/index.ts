import { getAddress, type Address } from 'viem';
import type { AllowedSet } from '../whitelist/loader';
import { lookup } from '../whitelist/loader';
import { formatAmount, tokenMeta } from './amount';

export * from './amount';
export * from './josa';
export * from './sentinel';

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

/** Token name for sentences: "USDC", "ETH (네이티브)", "토큰 0x2222…2222", "알 수 없는 토큰". */
export function describeToken(chainId: number, token: Address | undefined): string {
  if (token === undefined) return '알 수 없는 토큰';
  const m = tokenMeta(chainId, token);
  if (m?.native) return 'ETH (네이티브)';
  return m ? m.symbol : `토큰 ${shortAddress(token)}`;
}

/** Amount with its token for sentences: "100 USDC", "USDC 무제한", "토큰 0x2222…2222 5 (decimals 알 수 없음)". */
export function describeTokenAmount(
  chainId: number,
  token: Address | undefined,
  amount: bigint | 'UNLIMITED',
): string {
  const m = tokenMeta(chainId, token);
  if (amount === 'UNLIMITED' || !m)
    return `${describeToken(chainId, token)} ${formatAmount(chainId, token, amount)}`;
  return formatAmount(chainId, token, amount);
}
