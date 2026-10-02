import type { Address } from 'viem';

/**
 * Test-only addresses. ATTACKER / USER are arbitrary and hold nothing.
 * Real contract addresses are read from the bundled whitelists, never typed here.
 */
export const USER: Address = '0x1111111111111111111111111111111111111111';
export const ATTACKER: Address = '0xBAdBadbADBaDBADBadbADbaDBadBaDBADBadBAD0';

/** Token addresses used only as fixture payloads (not compared to the whitelist). */
export const TOKENS = {
  mainnetUSDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  sepoliaUSDC: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  nft: '0x2222222222222222222222222222222222222222',
} as const satisfies Record<string, Address>;
