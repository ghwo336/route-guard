import { formatAmount, tokenLabel } from '@/core/format/amount';
import { recipientLabel } from '@/core/format/sentinel';
import type { AddressNote, Verdict } from '@/core/types';

export type RowItem = { text: string; badge?: string; tone?: 'ok' | 'warn' };
/** `value` is the plain-text form; `items` (when present) is what the window renders. */
export type Row = { label: string; value: string; mono?: boolean; items?: RowItem[] };

function itemsRow(label: string, items: RowItem[]): Row {
  const value = items.map((i) => (i.badge ? `${i.text} · ${i.badge}` : i.text)).join('\n');
  return { label, value, mono: true, items };
}

const item = (address: string, note?: AddressNote): RowItem => ({
  text: note?.display ?? recipientLabel(address),
  badge: note?.badge,
  tone: note?.tone,
});

/** Facts shown in the warning window, in display order. Missing fields are skipped. */
export function verdictRows(v: Verdict): Row[] {
  const d = v.details;
  const token = (t: string) => `${tokenLabel(d.chainId, t)}\n${t}`;
  // A trade (CoW / UniswapX order, EthFlow) has both sides: what is sold, then what comes back.
  const trade = d.tokenOut !== undefined && (d.token !== undefined || d.amount !== undefined);
  const rows: (Row | undefined)[] = [
    { label: '사이트', value: d.origin, mono: true },
    d.matchedDex ? { label: '매칭된 DEX', value: d.matchedDex } : undefined,
    { label: '요청', value: `${d.method} (chainId ${d.chainId})`, mono: true },
    d.target ? itemsRow('대상 컨트랙트', [item(d.target, d.notes?.target)]) : undefined,
    d.spender
      ? itemsRow('권한 받는 주소 (spender)', [item(d.spender, d.notes?.spender)])
      : undefined,
    d.recipients?.length
      ? itemsRow(
          '받는 주소 (recipient)',
          d.recipients.map((r, i) => item(r, d.notes?.recipients?.[i])),
        )
      : undefined,
    d.token
      ? { label: trade ? '판매 토큰' : '토큰', value: token(d.token), mono: true }
      : undefined,
    d.amount !== undefined
      ? {
          label: trade ? '판매 금액' : '금액',
          value: formatAmount(d.chainId, d.token, d.amount),
          mono: true,
        }
      : undefined,
    d.tokenOut ? { label: '받을 토큰', value: token(d.tokenOut), mono: true } : undefined,
    d.minAmountOut !== undefined
      ? {
          label: '최소 수령량',
          value: formatAmount(d.chainId, d.tokenOut, d.minAmountOut),
          mono: true,
        }
      : undefined,
    { label: '규칙', value: v.ruleIds.join(', ') || '-' },
  ];
  return rows.filter((r): r is Row => r !== undefined);
}

export const LEVEL_TEXT: Record<Verdict['level'], string> = {
  HIGH: '위험',
  MEDIUM: '주의',
  LOW: '정상',
};

/** Delay before "진행" becomes clickable, so a reflex click cannot approve a HIGH request. */
export function proceedDelayMs(level: Verdict['level']): number {
  return level === 'HIGH' ? 1500 : 0;
}
