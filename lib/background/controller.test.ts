import { describe, expect, it, vi } from 'vitest';
import { serialize } from '@/core/serialize';
import { ATTACKER, USER } from '@/core/fixtures/addresses';
import * as c from '@/core/fixtures/calldata';
import { BUNDLED_WHITELISTS } from '@/core/whitelist';
import { wl } from '@/core/fixtures/whitelist';
import type { RuntimeRequest } from '../bridge/protocol';
import { createController, RESULT_TTL_MS, type SessionStore } from './controller';

function memSession(): SessionStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (keys) => {
      if (keys === null) return Object.fromEntries(data);
      const ks = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        ks.filter((k) => data.has(k)).map((k) => [k, structuredClone(data.get(k))]),
      );
    },
    set: async (items) => {
      for (const [k, v] of Object.entries(items)) data.set(k, structuredClone(v));
    },
    remove: async (keys) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    },
  };
}

const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const tx = (data: string): RuntimeRequest => ({
  type: 'analyze',
  id: 'r1',
  origin: 'http://localhost:5173',
  request: {
    method: 'eth_sendTransaction',
    params: serialize([{ from: USER, to: USDC, data }]),
    chainId: 11155111,
    from: USER,
  },
});
const sender = { origin: 'http://localhost:5173', tab: { id: 7 }, frameId: 0, documentId: 'doc1' };

function setup(opts: { windowId?: number | undefined } = { windowId: 99 }) {
  const session = memSession();
  let now = 1_000;
  const deps = {
    session,
    whitelists: BUNDLED_WHITELISTS,
    getMode: async () => 'scoped' as const,
    openWarning: vi.fn(async () => opts.windowId),
    closeWindow: vi.fn(async () => {}),
    sendToTab: vi.fn(async () => {}),
    now: () => now,
    onFinished: vi.fn(),
  };
  const ctl = createController(deps);
  return { ctl, deps, session, advance: (ms: number) => (now += ms) };
}

describe('background controller', () => {
  it('LOW: answered immediately, logged as auto, no window', async () => {
    const s = setup();
    const res = await s.ctl.analyze(
      tx(c.approve(wl(11155111, 'uniswap', 'Permit2'), c.MAX_UINT256)),
      sender,
    );
    expect(res.needsDecision).toBe(false);
    expect(res.verdict).toMatchObject({ level: 'LOW', ruleIds: ['R1'] });
    expect(s.deps.openWarning).not.toHaveBeenCalled();
    expect(s.deps.onFinished).toHaveBeenCalledWith(
      expect.objectContaining({ userDecision: 'auto', from: USER }),
    );
  });

  it('HIGH: stores pending, opens the window, then delivers the decision to that frame', async () => {
    const s = setup();
    const res = await s.ctl.analyze(tx(c.approve(ATTACKER, c.MAX_UINT256)), sender);
    expect(res).toMatchObject({ needsDecision: true, verdict: { level: 'HIGH' } });
    expect(s.deps.openWarning).toHaveBeenCalledWith('r1');
    expect(await s.ctl.getPending('r1')).toMatchObject({
      tabId: 7,
      windowId: 99,
      documentId: 'doc1',
    });

    await s.ctl.decide('r1', 'proceed');
    expect(s.deps.sendToTab).toHaveBeenCalledWith(
      7,
      { type: 'decision', id: 'r1', decision: 'proceed' },
      { frameId: 0, documentId: 'doc1' },
    );
    expect(s.deps.closeWindow).toHaveBeenCalledWith(99);
    expect(await s.ctl.getPending('r1')).toBeUndefined();
    expect(s.deps.onFinished).toHaveBeenLastCalledWith(
      expect.objectContaining({ userDecision: 'proceed', mode: 'scoped' }),
    );

    await s.ctl.decide('r1', 'reject'); // second decision: no-op
    expect(s.deps.sendToTab).toHaveBeenCalledTimes(1);
  });

  it('closing the warning window = reject', async () => {
    const s = setup();
    await s.ctl.analyze(tx(c.approve(ATTACKER, 1n)), sender);
    await s.ctl.windowRemoved(12345);
    expect(s.deps.sendToTab).not.toHaveBeenCalled();
    await s.ctl.windowRemoved(99);
    expect(s.deps.sendToTab).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ decision: 'reject' }),
      expect.anything(),
    );
  });

  it('closing the tab drops its pending requests', async () => {
    const s = setup();
    await s.ctl.analyze(tx(c.approve(ATTACKER, 1n)), sender);
    await s.ctl.tabRemoved(8);
    expect(await s.ctl.getPending('r1')).toBeDefined();
    s.deps.sendToTab.mockRejectedValueOnce(new Error('no tab'));
    await s.ctl.tabRemoved(7);
    expect(await s.ctl.getPending('r1')).toBeUndefined();
    expect(s.deps.closeWindow).toHaveBeenCalledWith(99);
  });

  it('survives a service worker restart (state lives in the session store)', async () => {
    const s = setup();
    await s.ctl.analyze(tx(c.approve(ATTACKER, 1n)), sender);
    const restarted = createController({ ...s.deps });
    await restarted.decide('r1', 'reject');
    expect(s.deps.sendToTab).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ decision: 'reject' }),
      expect.anything(),
    );
  });

  it('window failing to open = reject', async () => {
    const s = setup({ windowId: undefined });
    await s.ctl.analyze(tx(c.approve(ATTACKER, 1n)), sender);
    expect(s.deps.sendToTab).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ decision: 'reject' }),
      expect.anything(),
    );
  });

  it('window closed before its id was recorded', async () => {
    const s = setup();
    s.deps.openWarning.mockImplementationOnce(async () => {
      await s.ctl.decide('r1', 'reject');
      return 99;
    });
    await s.ctl.analyze(tx(c.approve(ATTACKER, 1n)), sender);
    expect(await s.ctl.getPending('r1')).toBeUndefined();
  });

  it('a late "timeout" for an analysed id reuses the stored result', async () => {
    const s = setup();
    const first = await s.ctl.analyze(tx(c.approve(ATTACKER, 1n)), sender);
    const again = await s.ctl.analyze({ ...tx(c.approve(ATTACKER, 1n)), type: 'timeout' }, sender);
    expect(again).toEqual(first);
    expect(s.deps.openWarning).toHaveBeenCalledTimes(1);
  });

  it('timeout without a prior result → R15 warning on protected origins', async () => {
    const s = setup();
    const res = await s.ctl.analyze({ ...tx('0x'), type: 'timeout' }, sender);
    expect(res).toMatchObject({ needsDecision: true, verdict: { ruleIds: ['R15'] } });
  });

  it('no tab → error (inject then fails closed)', async () => {
    const s = setup();
    await expect(
      s.ctl.analyze(tx(c.approve(ATTACKER, 1n)), { origin: sender.origin }),
    ).rejects.toThrow('탭 정보 없음');
  });

  it('prunes old results', async () => {
    const s = setup();
    await s.ctl.analyze(tx(c.approve(ATTACKER, 0n)), sender);
    s.advance(RESULT_TTL_MS + 1);
    await s.ctl.analyze({ ...tx(c.approve(ATTACKER, 0n)), id: 'r2' }, sender);
    await vi.waitFor(() => expect(s.session.data.has('result:r1')).toBe(false));
    expect(s.session.data.has('result:r2')).toBe(true);
  });

  it('decide without stored result falls back to scoped mode', async () => {
    const s = setup();
    await s.ctl.analyze(tx(c.approve(ATTACKER, 1n)), sender);
    s.session.data.delete('result:r1');
    await s.ctl.decide('r1', 'reject');
    expect(s.deps.onFinished).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'scoped', from: undefined }),
    );
  });
});
