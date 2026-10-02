import type { Verdict } from '@/core/types';

export type Row = { label: string; value: string; mono?: boolean };

const fmt = (v: bigint | 'UNLIMITED') => (v === 'UNLIMITED' ? '무제한' : v.toString());

/** Facts shown in the warning window, in display order. Missing fields are skipped. */
export function verdictRows(v: Verdict): Row[] {
  const d = v.details;
  const rows: (Row | undefined)[] = [
    { label: '사이트', value: d.origin, mono: true },
    d.matchedDex ? { label: '매칭된 DEX', value: d.matchedDex } : undefined,
    { label: '요청', value: `${d.method} (chainId ${d.chainId})`, mono: true },
    d.target ? { label: '대상 컨트랙트', value: d.target, mono: true } : undefined,
    d.spender ? { label: '권한 받는 주소 (spender)', value: d.spender, mono: true } : undefined,
    d.recipients?.length
      ? { label: '받는 주소 (recipient)', value: d.recipients.join('\n'), mono: true }
      : undefined,
    d.token ? { label: '토큰', value: d.token, mono: true } : undefined,
    d.amount !== undefined ? { label: '금액', value: fmt(d.amount), mono: true } : undefined,
    d.tokenOut ? { label: '받을 토큰', value: d.tokenOut, mono: true } : undefined,
    d.minAmountOut !== undefined
      ? { label: '최소 수령량', value: d.minAmountOut.toString(), mono: true }
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
