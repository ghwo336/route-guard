import type { RiskLevel } from '../types';

/**
 * How many *other* findings to mention after the headline ("(외 N건)").
 * LOW hits (R1 official spender, R4 revoke, R7 normal router call, …) are not findings,
 * so only MEDIUM/HIGH hits are counted. Display only: ruleIds still lists every rule.
 */
export function otherFindings(
  hits: { level: RiskLevel }[],
  headline: { level: RiskLevel } | undefined,
): number {
  const findings = hits.filter((h) => h.level !== 'LOW').length;
  return headline && headline.level !== 'LOW' ? findings - 1 : findings;
}

export function withOthers(message: string, others: number): string {
  return others > 0 ? `${message} (외 ${others}건)` : message;
}
