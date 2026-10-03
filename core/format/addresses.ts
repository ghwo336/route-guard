import { getAddress, type Address } from 'viem';
import { isSentinel } from '../decode/router';
import { sameAddress, ZERO_ADDRESS } from '../decode/util';
import type { AddressNote, DecodedAction, VerdictDetails } from '../types';
import { lookup, type AllowedSet, type ScopedEntry } from '../whitelist/loader';
import { recipientLabel } from './sentinel';

/**
 * Display-only labels that make the offending address stand out in the warning.
 * They mirror the rules (core/rules.ts) but never feed back into the verdict.
 */
export type NoteContext = { allowed: AllowedSet; signer?: Address };

const DEX_NAMES: Record<string, string> = {
  uniswap: 'Uniswap',
  cow: 'CoW Swap',
  sushiswap: 'SushiSwap',
  curve: 'Curve',
  balancer: 'Balancer',
};

/** "공식 Uniswap Permit2", "공식 WETH", "공식 Uniswap SwapProxy (미검증)". */
export function officialLabel(entry: ScopedEntry): string {
  const dex = entry.dex ? `${DEX_NAMES[entry.dex] ?? entry.dex} ` : '';
  return `공식 ${dex}${entry.label}${entry.verified ? '' : ' (미검증)'}`;
}

/**
 * Same notion of "fine" as the rules: self, router sentinel, or an official fee recipient.
 * For CoW orders a zero receiver means "same as the order owner" (GPv2Order.RECEIVER_SAME_AS_OWNER).
 */
export function recipientNote(
  address: Address,
  ctx: NoteContext,
  opts: { zeroIsOwner?: boolean } = {},
): AddressNote {
  if (opts.zeroIsOwner && sameAddress(address, ZERO_ADDRESS)) {
    return { display: '본인 (주문자, receiver=0x0)', tone: 'ok' };
  }
  if (isSentinel(address)) return { display: recipientLabel(address), tone: 'ok' };
  const fee = ctx.allowed.feeRecipients.get(getAddress(address));
  if (fee) return { badge: `${officialLabel(fee)} (수수료 수령)`, tone: 'ok' };
  if (ctx.signer === undefined) return { badge: '⚠ 본인 확인 불가', tone: 'warn' };
  if (sameAddress(address, ctx.signer)) return { badge: '본인', tone: 'ok' };
  return { badge: '⚠ 본인 아님', tone: 'warn' };
}

/**
 * Official spender (routers count only for Permit2 permits / Permit2.approve). For a Balancer
 * relayer approval the "spender" is the relayer, judged against `relayers` like the rules do.
 */
export function spenderNote(
  address: Address,
  ctx: NoteContext,
  opts: { routersAllowed: boolean; relayer?: boolean },
): AddressNote {
  const a = getAddress(address);
  const entry = opts.relayer
    ? ctx.allowed.relayers.get(a)
    : (ctx.allowed.spenders.get(a) ??
      (opts.routersAllowed ? ctx.allowed.routers.get(a) : undefined));
  return entry ? { badge: officialLabel(entry), tone: 'ok' } : { badge: '⚠ 미등록', tone: 'warn' };
}

/**
 * Whitelisted targets get their official label. An unknown target is only suspicious when
 * it is supposed to be a DEX contract — not when `to` is just the token being approved.
 */
export function targetNote(
  address: Address,
  ctx: NoteContext,
  opts: { mustBeOfficial: boolean },
): AddressNote | undefined {
  const hit = lookup(ctx.allowed, address);
  if (hit && hit.role !== 'feeRecipients') return { badge: officialLabel(hit.entry), tone: 'ok' };
  return opts.mustBeOfficial ? { badge: '⚠ 미등록', tone: 'warn' } : undefined;
}

/** `to` / verifyingContract is the token itself for these, so "unknown" is expected. */
function targetIsToken(action: DecodedAction): boolean {
  switch (action.kind) {
    case 'approve':
      return action.fn !== 'permit2Approve';
    case 'setApprovalForAll':
    case 'permit':
    case 'transfer':
    case 'unknownTypedData':
    case 'opaqueSign':
      return true;
    default:
      return false;
  }
}

export function buildNotes(
  details: VerdictDetails,
  action: DecodedAction,
  ctx: NoteContext,
): VerdictDetails['notes'] {
  const routersAllowed =
    action.kind === 'permit2' || (action.kind === 'approve' && action.fn === 'permit2Approve');
  const notes: NonNullable<VerdictDetails['notes']> = {};
  if (details.target) {
    const t = targetNote(details.target, ctx, { mustBeOfficial: !targetIsToken(action) });
    if (t) notes.target = t;
  }
  const relayer = action.kind === 'setApprovalForAll' && action.scope === 'balancer-relayer';
  if (details.spender)
    notes.spender = spenderNote(details.spender, ctx, { routersAllowed, relayer });
  const zeroIsOwner = action.kind === 'cowOrder' || action.kind === 'cowEthFlowOrder';
  if (details.recipients?.length) {
    notes.recipients = details.recipients.map((r) => recipientNote(r, ctx, { zeroIsOwner }));
  }
  return notes;
}
