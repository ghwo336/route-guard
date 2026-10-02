import { formatUnits, getAddress, isAddress, type Address } from 'viem';
import tokens from './tokens.json' with { type: 'json' };

/**
 * Display-only token metadata. Static JSON (tokens.json) — never queried on-chain.
 * Unknown tokens keep their raw integer amount.
 */
export type TokenMeta = { symbol: string; decimals: number; native?: boolean };

/** Native ETH as a currency: address(0) (UniversalRouter / v4), and CoW's BUY_ETH_ADDRESS. */
export const NATIVE_ADDRESSES: readonly Address[] = [
  '0x0000000000000000000000000000000000000000',
  '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
];
const NATIVE: TokenMeta = { symbol: 'ETH', decimals: 18, native: true };

type Entry = { address: string; symbol: string; decimals: number };
const TABLE: ReadonlyMap<string, TokenMeta> = new Map(
  Object.entries(tokens as Record<string, Entry[]>).flatMap(([chainId, list]) =>
    list.map((t) => [
      `${chainId}:${getAddress(t.address)}`,
      { symbol: t.symbol, decimals: t.decimals },
    ]),
  ),
);

export function isNative(token: string | undefined): boolean {
  return (
    token !== undefined &&
    isAddress(token, { strict: false }) &&
    NATIVE_ADDRESSES.includes(getAddress(token))
  );
}

export function tokenMeta(chainId: number, token: string | undefined): TokenMeta | undefined {
  if (token === undefined || !isAddress(token, { strict: false })) return undefined;
  if (isNative(token)) return NATIVE;
  return TABLE.get(`${chainId}:${getAddress(token)}`);
}

const short = (a: string) => `${getAddress(a).slice(0, 6)}…${getAddress(a).slice(-4)}`;

/** "USDC", "ETH (네이티브)", or a shortened address for unknown tokens. */
export function tokenLabel(chainId: number, token: string): string {
  const m = tokenMeta(chainId, token);
  if (m?.native) return 'ETH (네이티브)';
  if (m) return m.symbol;
  return isAddress(token, { strict: false }) ? short(token) : token;
}

/**
 * "100 USDC", "0.025 ETH", "무제한", or "<raw> (decimals 알 수 없음)" for unknown tokens.
 * `token` undefined means the amount's token is not known at all (raw value kept).
 */
export function formatAmount(
  chainId: number,
  token: string | undefined,
  amount: bigint | 'UNLIMITED',
): string {
  if (amount === 'UNLIMITED') return '무제한';
  const m = tokenMeta(chainId, token);
  if (!m) return `${amount.toString()} (decimals 알 수 없음)`;
  return `${formatUnits(amount, m.decimals)} ${m.symbol}`;
}
