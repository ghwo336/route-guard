import mainnet from './1.json';
import sepolia from './11155111.json';
import type { Whitelists } from './loader';
import { parseWhitelist } from './schema';

/** Whitelists bundled with the extension, validated at load time. */
export const BUNDLED_WHITELISTS: Whitelists = Object.freeze({
  1: parseWhitelist(mainnet),
  11155111: parseWhitelist(sepolia),
});

export * from './loader';
export * from './schema';
