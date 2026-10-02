import { analyze } from '@/core/analyze';
import { deserialize } from '@/core/serialize';
import type { Mode, SignRequest, Verdict } from '@/core/types';
import { normalizeOrigin, resolveScope, type Whitelists } from '@/core/whitelist/loader';
import type { WireRequest } from '../bridge/protocol';
import type { Address } from 'viem';

/** Origin from the browser (sender), never from the page. */
export function senderOrigin(
  sender: { origin?: string; url?: string },
  contentOrigin: string,
): string {
  return (
    (sender.origin && normalizeOrigin(sender.origin)) ??
    (sender.url && normalizeOrigin(sender.url)) ??
    normalizeOrigin(contentOrigin) ??
    'null'
  );
}

export function toSignRequest(wire: WireRequest, origin: string): SignRequest {
  return {
    method: wire.method,
    params: deserialize(wire.params),
    chainId: wire.chainId,
    from: wire.from as Address | undefined,
    origin,
  };
}

/** Verdict for an analysis that timed out or failed: R15 when protected, R0 otherwise. */
export function timeoutVerdict(req: SignRequest, whitelists: Whitelists, mode: Mode): Verdict {
  const scope = resolveScope(req.origin, req.chainId, mode, whitelists);
  const details = {
    origin: req.origin,
    protected: scope.protected,
    method: req.method,
    chainId: req.chainId,
  };
  return scope.protected
    ? {
        level: 'MEDIUM',
        ruleIds: ['R15'],
        summary: '검사 실패: 분석 시간이 초과되었습니다.',
        details,
      }
    : {
        level: 'LOW',
        ruleIds: ['R0'],
        summary: '보호 대상 사이트가 아니라 검사하지 않았습니다.',
        details,
      };
}

export function needsDecision(v: Verdict): boolean {
  return v.level !== 'LOW';
}

export function runAnalysis(
  kind: 'analyze' | 'timeout',
  req: SignRequest,
  whitelists: Whitelists,
  mode: Mode,
): Verdict {
  return kind === 'analyze'
    ? analyze(req, whitelists, mode)
    : timeoutVerdict(req, whitelists, mode);
}
