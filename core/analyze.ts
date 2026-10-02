import { decodeRequest, type DecodeContext } from './decode';
import {
  byRisk,
  compareRuleIds,
  evaluateAction,
  maxLevel,
  type ActionResult,
  type RuleHit,
} from './rules';
import type { Mode, RuleId, SignRequest, Verdict, VerdictDetails } from './types';
import { resolveScope, type Scope, type Whitelists } from './whitelist/loader';

function baseDetails(req: SignRequest, scope: Scope | undefined): VerdictDetails {
  return {
    origin: req.origin,
    protected: scope?.protected ?? true,
    method: req.method,
    chainId: req.chainId,
    matchedDex: scope?.dexes.length === 1 ? scope.dexes[0] : undefined,
  };
}

function contextFor(scope: Scope): DecodeContext {
  return {
    versionOf: (a) => scope.allowed.routers.get(a)?.version,
    isOther: (a) => scope.allowed.others.has(a),
  };
}

function clean(d: VerdictDetails): VerdictDetails {
  return Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) as VerdictDetails;
}

/**
 * scope → decode → rules. Never throws: any exception becomes R15.
 * `wallet_sendCalls` is judged per call and the highest level wins.
 */
export function analyze(req: SignRequest, whitelists: Whitelists, mode: Mode): Verdict {
  let scope: Scope | undefined;
  try {
    scope = resolveScope(req.origin, req.chainId, mode, whitelists);
    if (!scope.protected) {
      return {
        level: 'LOW',
        ruleIds: ['R0'],
        summary: '보호 대상 사이트가 아니라 검사하지 않았습니다.',
        details: clean({ ...baseDetails(req, scope), protected: false }),
      };
    }
    if (scope.noWhitelist) {
      return {
        level: 'MEDIUM',
        ruleIds: ['R14'],
        summary: `이 네트워크(chainId ${req.chainId})는 검증 대상이 아닙니다.`,
        details: clean(baseDetails(req, scope)),
      };
    }

    const decoded = decodeRequest(req, contextFor(scope));
    const ctx = { allowed: scope.allowed, signer: decoded.signer };
    const results: ActionResult[] = decoded.actions.map((a) => evaluateAction(a, ctx));

    const hits: RuleHit[] = results.flatMap((r) => r.hits);
    const level = maxLevel(hits.map((h) => h.level));
    const ruleIds = [...new Set<RuleId>(hits.map((h) => h.ruleId))].sort(compareRuleIds);

    // Report the details/summary of the most severe action (first one on ties).
    const worstIdx = results.findIndex((r) => maxLevel(r.hits.map((h) => h.level)) === level);
    const worst = results[worstIdx]!;
    const top = [...worst.hits].sort(byRisk)[0];
    let summary = top?.message ?? worst.summary ?? '';
    const extra = hits.length - 1;
    if (top && extra > 0) summary += ` (외 ${extra}건)`;
    if (results.length > 1) summary = `[${results.length}개 호출 중 ${worstIdx + 1}번] ${summary}`;

    return {
      level,
      ruleIds,
      summary,
      details: clean({
        ...baseDetails(req, scope),
        ...worst.details,
        matchedDex: worst.details.matchedDex ?? baseDetails(req, scope).matchedDex,
      }),
    };
  } catch (e) {
    return {
      level: 'MEDIUM',
      ruleIds: ['R15'],
      summary: `검사 실패: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`,
      details: clean(baseDetails(req, scope)),
    };
  }
}
