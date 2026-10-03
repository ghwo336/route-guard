import { getAddress, isAddress, type Address } from 'viem';
import { z } from 'zod';

export const addressSchema = z
  .string()
  .refine((s) => isAddress(s, { strict: false }), { message: 'invalid address' })
  .transform((s) => getAddress(s) as Address);

export const entrySchema = z.object({
  address: addressSchema,
  label: z.string().min(1),
  source: z.url(),
  verified: z.boolean(),
  /** UniversalRouter version ('1.2' | '2.0' | '2.1.1' | ...). Decoding depends on it. */
  version: z.string().optional(),
});

export const originSchema = z.url().refine((s) => new URL(s).origin === s, {
  message: 'must be a bare origin (scheme://host[:port])',
});

export const dexSchema = z.object({
  origins: z.array(originSchema).min(1),
  /** Entry points users send txs to. */
  routers: z.array(entrySchema),
  /** Addresses that receive token allowances. */
  spenders: z.array(entrySchema),
  /** Other contracts the official frontend calls directly. calldata is not interpreted. */
  others: z.array(entrySchema).default([]),
  /** Non-user recipients the official frontend routes a portion of output to (interface fees). */
  feeRecipients: z.array(entrySchema).default([]),
  /**
   * Operators that may act on the user's behalf inside a protocol (Balancer V2 Vault relayers).
   * Judged only for relayer approvals; an ERC-20 approve to them is still R2.
   */
  relayers: z.array(entrySchema).default([]),
});

export const whitelistSchema = z.object({
  chainId: z.number().int().positive(),
  dexes: z.record(z.string().min(1), dexSchema),
  utilities: z.array(entrySchema),
});

export type WhitelistEntry = z.infer<typeof entrySchema>;
export type Dex = z.infer<typeof dexSchema>;
export type Whitelist = z.infer<typeof whitelistSchema>;

export function parseWhitelist(json: unknown): Whitelist {
  return whitelistSchema.parse(json);
}
