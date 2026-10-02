import type { Verdict } from '@/core/types';
import {
  ContentMessage,
  type Decision,
  type InjectMessage,
  type WireRequest,
} from '../bridge/protocol';

export const ACK_TIMEOUT_MS = 1500;
export const ANALYSIS_TIMEOUT_MS = 5000;

export type PortLike = {
  postMessage: (msg: unknown) => void;
  onmessage: ((e: { data: unknown }) => void) | null;
};

export type Check = {
  /** Resolves with the verdict; rejects if the bridge never answered. */
  verdict: Promise<Verdict>;
  /**
   * Resolves once the request may continue or must be rejected. No timeout once a
   * warning is shown: the user decides (AGENTS.md 6장 규칙 7).
   */
  decision: Promise<{ decision: Decision; reason?: string }>;
};

type Pending = {
  request: WireRequest;
  resolveVerdict: (v: Verdict) => void;
  rejectVerdict: (e: Error) => void;
  resolveDecision: (d: { decision: Decision; reason?: string }) => void;
  timer?: unknown;
  stage: 'sent' | 'acked' | 'timedOut' | 'verdict';
};

export type ClientDeps = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (t: unknown) => void;
  newId: () => string;
  ackTimeoutMs?: number;
  analysisTimeoutMs?: number;
};

/**
 * Inject-side bridge client.
 * - no ack from the content script within ACK_TIMEOUT → bridge unavailable → reject (fail closed)
 * - acked but no verdict within ANALYSIS_TIMEOUT → ask background for the R15 path
 * - verdict without needsDecision → proceed; otherwise wait (no timeout) for the user's decision
 */
export function createBridgeClient(port: PortLike, deps: ClientDeps) {
  const pending = new Map<string, Pending>();
  const ackMs = deps.ackTimeoutMs ?? ACK_TIMEOUT_MS;
  const analysisMs = deps.analysisTimeoutMs ?? ANALYSIS_TIMEOUT_MS;
  const post = (m: InjectMessage) => port.postMessage(m);

  const finish = (id: string, p: Pending, d: Decision, reason?: string) => {
    deps.clearTimeout(p.timer);
    pending.delete(id);
    p.resolveDecision({ decision: d, reason });
  };

  const onTimeout = (id: string) => {
    const p = pending.get(id);
    if (!p) return;
    if (p.stage === 'sent') {
      p.rejectVerdict(new Error('route-guard 연결 없음'));
      finish(id, p, 'reject', 'bridge-unavailable');
      return;
    }
    if (p.stage === 'acked') {
      p.stage = 'timedOut';
      post({ type: 'timeout', id, request: p.request });
    }
  };

  port.onmessage = (e) => {
    const parsed = ContentMessage.safeParse(e.data);
    if (!parsed.success) return;
    const msg = parsed.data;
    const p = pending.get(msg.id);
    if (!p) return;
    switch (msg.type) {
      case 'ack':
        if (p.stage !== 'sent') return;
        p.stage = 'acked';
        deps.clearTimeout(p.timer);
        p.timer = deps.setTimeout(() => onTimeout(msg.id), analysisMs);
        return;
      case 'verdict': {
        if (p.stage === 'verdict') return;
        p.stage = 'verdict';
        deps.clearTimeout(p.timer);
        // content already revived bigints (structured clone carries them over the port)
        p.resolveVerdict(msg.verdict as unknown as Verdict);
        if (!msg.needsDecision) finish(msg.id, p, 'proceed');
        return;
      }
      case 'decision':
        if (p.stage !== 'verdict') return;
        finish(msg.id, p, msg.decision);
        return;
      case 'error':
        // Treat a failed analysis like a timeout: background decides (R15 or R0).
        if (p.stage === 'acked') {
          deps.clearTimeout(p.timer);
          onTimeout(msg.id);
        } else if (p.stage === 'timedOut') {
          // even the fallback failed: never hang, never pass unchecked
          p.rejectVerdict(new Error(msg.message));
          finish(msg.id, p, 'reject', 'analysis-failed');
        }
        return;
    }
  };

  return {
    check(request: WireRequest): Check {
      const id = deps.newId();
      let resolveVerdict!: Pending['resolveVerdict'];
      let rejectVerdict!: Pending['rejectVerdict'];
      let resolveDecision!: Pending['resolveDecision'];
      const verdict = new Promise<Verdict>((res, rej) => {
        resolveVerdict = res;
        rejectVerdict = rej;
      });
      verdict.catch(() => {}); // callers may only await `decision`
      const decision = new Promise<{ decision: Decision; reason?: string }>((res) => {
        resolveDecision = res;
      });
      const p: Pending = { request, resolveVerdict, rejectVerdict, resolveDecision, stage: 'sent' };
      pending.set(id, p);
      p.timer = deps.setTimeout(() => onTimeout(id), ackMs);
      post({ type: 'analyze', id, request });
      return { verdict, decision };
    },
    get size() {
      return pending.size;
    },
  };
}
