import { describe, expect, it } from 'vitest';
import type { Verdict } from '@/core/types';
import type { WireRequest } from '../bridge/protocol';
import { createBridgeClient, type PortLike } from './client';

function harness() {
  const sent: unknown[] = [];
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let nextTimer = 1;
  let nextId = 1;
  const port: PortLike = { postMessage: (m) => sent.push(m), onmessage: null };
  const client = createBridgeClient(port, {
    setTimeout: (fn, ms) => {
      const t = nextTimer++;
      timers.set(t, { fn, ms });
      return t;
    },
    clearTimeout: (t) => timers.delete(t as number),
    newId: () => `id${nextId++}`,
  });
  const reply = (m: unknown) => port.onmessage?.({ data: m });
  const fire = () => {
    const all = [...timers.entries()];
    timers.clear();
    all.forEach(([, t]) => t.fn());
  };
  return { client, sent, timers, reply, fire };
}

const req: WireRequest = { method: 'personal_sign', params: ['0x00'], chainId: 1 };
const verdict = (level: Verdict['level']): Verdict => ({
  level,
  ruleIds: level === 'LOW' ? ['R1'] : ['R2'],
  summary: 's',
  details: { origin: 'https://x', protected: true, method: 'personal_sign', chainId: 1 },
});

describe('bridge client', () => {
  it('LOW verdict → proceed', async () => {
    const h = harness();
    const c = h.client.check(req);
    expect(h.sent).toEqual([{ type: 'analyze', id: 'id1', request: req }]);
    h.reply({ type: 'ack', id: 'id1' });
    expect([...h.timers.values()][0]?.ms).toBe(5000);
    h.reply({ type: 'verdict', id: 'id1', verdict: verdict('LOW'), needsDecision: false });
    await expect(c.verdict).resolves.toMatchObject({ level: 'LOW' });
    await expect(c.decision).resolves.toEqual({ decision: 'proceed', reason: undefined });
    expect(h.client.size).toBe(0);
    expect(h.timers.size).toBe(0);
  });

  it('warning → waits without timeout for the user decision', async () => {
    const h = harness();
    const c = h.client.check(req);
    h.reply({ type: 'ack', id: 'id1' });
    h.reply({ type: 'verdict', id: 'id1', verdict: verdict('HIGH'), needsDecision: true });
    expect(h.timers.size).toBe(0);
    h.reply({ type: 'verdict', id: 'id1', verdict: verdict('LOW'), needsDecision: false }); // ignored
    h.reply({ type: 'decision', id: 'id1', decision: 'reject' });
    await expect(c.decision).resolves.toEqual({ decision: 'reject', reason: undefined });
  });

  it('decision before verdict is ignored', () => {
    const h = harness();
    h.client.check(req);
    h.reply({ type: 'ack', id: 'id1' });
    h.reply({ type: 'decision', id: 'id1', decision: 'proceed' });
    expect(h.client.size).toBe(1);
  });

  it('no ack → bridge unavailable → reject (fail closed)', async () => {
    const h = harness();
    const c = h.client.check(req);
    expect([...h.timers.values()][0]?.ms).toBe(1500);
    h.fire();
    await expect(c.verdict).rejects.toThrow('연결 없음');
    await expect(c.decision).resolves.toEqual({ decision: 'reject', reason: 'bridge-unavailable' });
  });

  it('acked but slow → asks background for the R15 path, then accepts its verdict', async () => {
    const h = harness();
    const c = h.client.check(req);
    h.reply({ type: 'ack', id: 'id1' });
    h.fire();
    expect(h.sent[1]).toEqual({ type: 'timeout', id: 'id1', request: req });
    h.reply({ type: 'ack', id: 'id1' }); // ack for the timeout message: ignored
    expect(h.timers.size).toBe(0);
    h.reply({ type: 'verdict', id: 'id1', verdict: verdict('MEDIUM'), needsDecision: true });
    h.reply({ type: 'decision', id: 'id1', decision: 'proceed' });
    await expect(c.decision).resolves.toMatchObject({ decision: 'proceed' });
  });

  it('analysis error → same as timeout', () => {
    const h = harness();
    h.client.check(req);
    h.reply({ type: 'error', id: 'id1', message: 'x' }); // before ack: ignored
    expect(h.sent).toHaveLength(1);
    h.reply({ type: 'ack', id: 'id1' });
    h.reply({ type: 'error', id: 'id1', message: 'boom' });
    expect(h.sent[1]).toMatchObject({ type: 'timeout', id: 'id1' });
    h.fire(); // stale timers do nothing
    expect(h.sent).toHaveLength(2);
  });

  it('fallback also failing → reject instead of hanging', async () => {
    const h = harness();
    const c = h.client.check(req);
    h.reply({ type: 'ack', id: 'id1' });
    h.fire();
    h.reply({ type: 'error', id: 'id1', message: 'still broken' });
    await expect(c.verdict).rejects.toThrow('still broken');
    await expect(c.decision).resolves.toEqual({ decision: 'reject', reason: 'analysis-failed' });
  });

  it('ignores junk and unknown ids', () => {
    const h = harness();
    h.client.check(req);
    h.reply('junk');
    h.reply({ type: 'verdict', id: 'nope', verdict: verdict('LOW'), needsDecision: false });
    h.reply({ type: 'decision', id: 'id1', decision: 'maybe' });
    expect(h.client.size).toBe(1);
  });

  it('timer firing after completion is harmless', async () => {
    const h = harness();
    const c = h.client.check(req);
    const [t] = [...h.timers.values()];
    h.reply({ type: 'ack', id: 'id1' });
    h.reply({ type: 'verdict', id: 'id1', verdict: verdict('LOW'), needsDecision: false });
    t?.fn();
    await expect(c.decision).resolves.toMatchObject({ decision: 'proceed' });
  });
});
