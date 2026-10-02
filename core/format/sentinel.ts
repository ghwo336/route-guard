import { getAddress, isAddress } from 'viem';
import { ADDRESS_THIS, MSG_SENDER } from '../decode/router';

/**
 * Display label for a recipient. Router sentinels are shown by meaning
 * (MSG_SENDER = the caller, ADDRESS_THIS = held by the router mid-route).
 * Display only: rules treat sentinels the same way regardless of this label.
 */
export function recipientLabel(address: string): string {
  if (!isAddress(address, { strict: false })) return address;
  const a = getAddress(address);
  if (a === MSG_SENDER) return '본인 (MSG_SENDER)';
  if (a === ADDRESS_THIS) return '라우터 내부 보관 (ADDRESS_THIS)';
  return a;
}
