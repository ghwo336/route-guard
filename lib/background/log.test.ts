import { describe, expect, it } from 'vitest';
import type { Verdict } from '@/core/types';
import {
  appendLog,
  exportLogsJson,
  LOGS_KEY,
  makeLogEntry,
  maskAddress,
  maskVerdict,
  type LogStore,
} from './log';

const ME = '0x1234567890AbcdEF1234567890aBcdef12345678';
const OTHER = '0xBAdBadbADBaDBADBadbADbaDBadBaDBADBadBAD0';
const v: Verdict = {
  level: 'HIGH',
  ruleIds: ['R8'],
  summary: 'x',
  details: {
    origin: 'https://app.uniswap.org',
    protected: true,
    method: 'eth_sendTransaction',
    chainId: 1,
    recipients: [ME.toLowerCase() as `0x${string}`, OTHER],
    minAmountOut: 5n,
  },
};

describe('log', () => {
  it('maskAddress keeps 4+4 hex digits', () => {
    expect(maskAddress(ME)).toBe('0x1234…5678');
    expect(maskAddress('not an address')).toBe('not an address');
  });

  it('maskVerdict masks only the user address, case-insensitively', () => {
    const m = maskVerdict(v, ME);
    expect(m.details.recipients).toEqual(['0x1234…5678', OTHER]);
    expect(m.details.minAmountOut).toBe(5n);
    expect(maskVerdict(v, undefined)).toBe(v);
  });

  it('makeLogEntry', () => {
    const e = makeLogEntry({
      ts: 1,
      origin: 'o',
      mode: 'scoped',
      method: 'm',
      verdict: v,
      from: ME,
      userDecision: 'reject',
    });
    expect(e).toMatchObject({
      ts: 1,
      protected: true,
      account: '0x1234…5678',
      userDecision: 'reject',
    });
    expect(JSON.stringify(e)).not.toContain(ME.slice(2, 30));
    expect(
      makeLogEntry({
        ts: 1,
        origin: 'o',
        mode: 'global',
        method: 'm',
        verdict: v,
        userDecision: 'auto',
      }).account,
    ).toBeUndefined();
  });

  it('appendLog caps the list', async () => {
    const data: Record<string, unknown> = {};
    const store: LogStore = {
      get: async (k) => ({ [k]: data[k] }),
      set: async (i) => void Object.assign(data, i),
    };
    const e = makeLogEntry({
      ts: 1,
      origin: 'o',
      mode: 'scoped',
      method: 'm',
      verdict: v,
      userDecision: 'auto',
    });
    for (let i = 0; i < 5; i++) await appendLog(store, { ...e, ts: i }, 3);
    expect((data[LOGS_KEY] as { ts: number }[]).map((x) => x.ts)).toEqual([2, 3, 4]);
  });

  it('exportLogsJson writes bigints as strings', () => {
    const e = makeLogEntry({
      ts: 1,
      origin: 'o',
      mode: 'scoped',
      method: 'm',
      verdict: v,
      userDecision: 'auto',
    });
    const out = JSON.parse(exportLogsJson([e])) as {
      verdict: { details: { minAmountOut: string } };
    }[];
    expect(out[0]?.verdict.details.minAmountOut).toBe('5');
  });
});
