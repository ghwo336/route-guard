export const STRICT_CHAINS: number[];
export type Unverified = { group: string; label?: string; address?: string; source?: string };
export function unverifiedEntries(wl: unknown): Unverified[];
export function checkWhitelists(lists: { file: string; json: unknown }[]): {
  errors: string[];
  warnings: string[];
};
