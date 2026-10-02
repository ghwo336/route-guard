import { deserialize, serialize } from '@/core/serialize';
import type { Mode, Verdict } from '@/core/types';
import type { Whitelists } from '@/core/whitelist/loader';
import type {
  AnalyzeResponse,
  Decision,
  DecisionPush,
  PendingRecord,
  RuntimeRequest,
} from '../bridge/protocol';
import { needsDecision, runAnalysis, senderOrigin, toSignRequest } from './analyzeRequest';

/** Subset of browser.storage.session used here (injectable for tests). */
export type SessionStore = {
  get: (keys: string | string[] | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
};

export type Sender = {
  origin?: string;
  url?: string;
  tab?: { id?: number };
  frameId?: number;
  documentId?: string;
};

export type ControllerDeps = {
  session: SessionStore;
  whitelists: Whitelists;
  getMode: () => Promise<Mode>;
  openWarning: (id: string) => Promise<number | undefined>;
  closeWindow: (windowId: number) => Promise<void>;
  sendToTab: (
    tabId: number,
    msg: DecisionPush,
    target: { frameId?: number; documentId?: string },
  ) => Promise<void>;
  now: () => number;
  /** Called once per finished request (15: verdict log). */
  onFinished?: (e: {
    id: string;
    origin: string;
    method: string;
    mode: Mode;
    verdict: Verdict;
    from?: string;
    userDecision: 'auto' | Decision;
  }) => Promise<void> | void;
};

const P = (id: string) => `pending:${id}`;
const R = (id: string) => `result:${id}`;
/** Results are kept briefly so a late "timeout" for an already analysed id reuses them. */
export const RESULT_TTL_MS = 10 * 60 * 1000;

type StoredResult = { res: AnalyzeResponse; at: number; mode: Mode; from?: string };

export function createController(deps: ControllerDeps) {
  async function prune() {
    const all = await deps.session.get(null);
    const stale = Object.entries(all)
      .filter(
        ([k, v]) => k.startsWith('result:') && deps.now() - (v as StoredResult).at > RESULT_TTL_MS,
      )
      .map(([k]) => k);
    if (stale.length) await deps.session.remove(stale);
  }

  async function analyze(msg: RuntimeRequest, sender: Sender): Promise<AnalyzeResponse> {
    const cached = (await deps.session.get(R(msg.id)))[R(msg.id)] as StoredResult | undefined;
    if (cached) return cached.res;

    const mode = await deps.getMode();
    const req = toSignRequest(msg.request, senderOrigin(sender, msg.origin));
    const verdict = runAnalysis(msg.type, req, deps.whitelists, mode);
    const wire = serialize(verdict) as AnalyzeResponse['verdict'];
    const tabId = sender.tab?.id;
    const res: AnalyzeResponse = { verdict: wire, needsDecision: needsDecision(verdict) };
    await deps.session.set({ [R(msg.id)]: { res, at: deps.now(), mode, from: req.from } });
    void prune();

    if (!res.needsDecision) {
      await deps.onFinished?.({
        id: msg.id, origin: req.origin, method: req.method, mode, verdict, from: req.from, userDecision: 'auto',
      }); // prettier-ignore
      return res;
    }
    // A warning needs a tab to answer to; without one we cannot ask the user, so fail.
    if (tabId === undefined) throw new Error('탭 정보 없음');

    const record: PendingRecord = {
      id: msg.id,
      tabId,
      frameId: sender.frameId,
      documentId: sender.documentId,
      origin: req.origin,
      method: req.method,
      verdict: wire,
      createdAt: deps.now(),
    };
    await deps.session.set({ [P(msg.id)]: record });
    const windowId = await deps.openWarning(msg.id);
    if (windowId === undefined) {
      await decide(msg.id, 'reject');
    } else {
      // the window may already have been closed (or decided) while we were opening it
      const still = (await deps.session.get(P(msg.id)))[P(msg.id)] as PendingRecord | undefined;
      if (still) await deps.session.set({ [P(msg.id)]: { ...still, windowId } });
    }
    return res;
  }

  async function decide(id: string, decision: Decision): Promise<void> {
    const rec = (await deps.session.get(P(id)))[P(id)] as PendingRecord | undefined;
    if (!rec) return;
    await deps.session.remove(P(id));
    try {
      await deps.sendToTab(
        rec.tabId,
        { type: 'decision', id, decision },
        {
          frameId: rec.frameId,
          documentId: rec.documentId,
        },
      );
    } catch {
      // the page is gone; nothing to answer
    }
    if (rec.windowId !== undefined) await deps.closeWindow(rec.windowId).catch(() => {});
    const stored = (await deps.session.get(R(id)))[R(id)] as StoredResult | undefined;
    await deps.onFinished?.({
      id,
      origin: rec.origin,
      method: rec.method,
      mode: stored?.mode ?? 'scoped',
      verdict: deserialize<Verdict>(rec.verdict),
      from: stored?.from,
      userDecision: decision,
    });
  }

  async function pendingWhere(pred: (r: PendingRecord) => boolean): Promise<PendingRecord[]> {
    const all = await deps.session.get(null);
    return Object.entries(all)
      .filter(([k]) => k.startsWith('pending:'))
      .map(([, v]) => v as PendingRecord)
      .filter(pred);
  }

  return {
    analyze,
    decide,
    /** Closing the warning window counts as "cancel". */
    async windowRemoved(windowId: number) {
      for (const r of await pendingWhere((r) => r.windowId === windowId))
        await decide(r.id, 'reject');
    },
    /** The requesting tab is gone: drop its pending requests and their windows. */
    async tabRemoved(tabId: number) {
      for (const r of await pendingWhere((r) => r.tabId === tabId)) await decide(r.id, 'reject');
    },
    async getPending(id: string): Promise<PendingRecord | undefined> {
      return (await deps.session.get(P(id)))[P(id)] as PendingRecord | undefined;
    },
  };
}
