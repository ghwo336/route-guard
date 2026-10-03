import type { Address } from 'viem';
import { tokenMeta } from './format/amount';

/**
 * R10 "no slippage protection": the output floor is 0, or — when the output token's decimals
 * are known from the static metadata (core/format/tokens.json) — below 0.000001 of a token
 * (10^(decimals-6) base units), which protects nothing (e.g. "min_dy = 1 wei").
 * Tokens without metadata keep the old rule: only exactly 0.
 * This does NOT judge whether the floor is fair for the price (no price lookups; see
 * docs/protocols-phase7.md section 6).
 */
export const NEGLIGIBLE_DECIMALS = 6;

export function negligibleFloor(chainId: number, token: Address | undefined): bigint {
  const m = tokenMeta(chainId, token);
  if (!m || m.decimals <= NEGLIGIBLE_DECIMALS) return 1n; // "< 1" ⇔ 0
  return 10n ** BigInt(m.decimals - NEGLIGIBLE_DECIMALS);
}

export function isNegligibleMin(chainId: number, token: Address | undefined, min: bigint): boolean {
  return min < negligibleFloor(chainId, token);
}
