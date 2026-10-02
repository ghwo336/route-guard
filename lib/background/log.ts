import { deserialize, serialize } from '@/core/serialize';
import type { Mode, Verdict } from '@/core/types';
import type { Decision } from '../bridge/protocol';

export const LOGS_KEY = 'logs';
export const MAX_LOGS = 2000;

export type UserDecision = 'auto' | Decision;

/** Stored form (bigints tagged by core/serialize). */
export type LogEntry = {
  ts: number;
  origin: string;
  protected: boolean;
  mode: Mode;
  method: string;
  verdict: unknown;
  userDecision: UserDecision;
  /** wallet address, masked */
  account?: string;
};

/** 0x1234…abcd: keep the first and last 4 hex digits only. */
export function maskAddress(a: string): string {
  return /^0x[0-9a-fA-F]{40}$/.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** Replace every occurrence of the user's own address inside the verdict. */
export function maskVerdict(v: Verdict, account: string | undefined): Verdict {
  if (!account) return v;
  const me = account.toLowerCase();
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') return x.toLowerCase() === me ? maskAddress(x) : x;
    if (Array.isArray(x)) return x.map(walk);
    if (typeof x === 'object' && x !== null && typeof x !== 'bigint') {
      return Object.fromEntries(Object.entries(x).map(([k, val]) => [k, walk(val)]));
    }
    return x;
  };
  return walk(v) as Verdict;
}

export function makeLogEntry(e: {
  ts: number;
  origin: string;
  mode: Mode;
  method: string;
  verdict: Verdict;
  from?: string;
  userDecision: UserDecision;
}): LogEntry {
  return {
    ts: e.ts,
    origin: e.origin,
    protected: e.verdict.details.protected,
    mode: e.mode,
    method: e.method,
    verdict: serialize(maskVerdict(e.verdict, e.from)),
    userDecision: e.userDecision,
    account: e.from ? maskAddress(e.from) : undefined,
  };
}

export type LogStore = {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

export async function appendLog(store: LogStore, entry: LogEntry, max = MAX_LOGS): Promise<void> {
  const cur = ((await store.get(LOGS_KEY))[LOGS_KEY] as LogEntry[] | undefined) ?? [];
  const next = [...cur, entry];
  await store.set({ [LOGS_KEY]: next.length > max ? next.slice(next.length - max) : next });
}

/** JSON export with bigints as decimal strings (for the research result tables). */
export function exportLogsJson(entries: LogEntry[]): string {
  return JSON.stringify(
    entries.map((e) => ({ ...e, verdict: deserialize(e.verdict) })),
    (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
    2,
  );
}
