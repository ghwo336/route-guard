import { describe, expect, it, vi } from 'vitest';
import type { Verdict } from '@/core/types';
import type { WireRequest } from '../bridge/protocol';
import type { Check } from './client';
import { createGuard } from './guard';
import type { RequestArgs } from './wrap';

const verdict: Verdict = {
  level: 'LOW',
  ruleIds: ['R1'],
  summary: '',
  details: { origin: 'x', protected: true, method: 'personal_sign', chainId: 1 },
};

function setup(decision: 'proceed' | 'reject' = 'proceed') {
  const checks: WireRequest[] = [];
  const check = (req: WireRequest): Check => {
    checks.push(req);
    return { verdict: Promise.resolve(verdict), decision: Promise.resolve({ decision }) };
  };
  const listeners = new Map<string, (v: unknown) => void>();
  const calls: RequestArgs[] = [];
  const provider = {
    request: vi.fn(),
    on: (ev: string, fn: (v: unknown) => void) => listeners.set(ev, fn),
  };
  const original = vi.fn(async (a: RequestArgs) => {
    calls.push(a);
    if (a.method === 'eth_chainId') return '0xaa36a7';
    if (a.method === 'eth_accounts') return ['0xabc'];
    return 'signed';
  });
  const onVerdict = vi.fn();
  const guard = createGuard({ check, clone: structuredClone, onVerdict });
  return { guard, provider, original, checks, calls, listeners, onVerdict };
}

describe('guard', () => {
  it('holds until proceed, then calls the wallet with a private copy', async () => {
    const s = setup();
    const args = { method: 'personal_sign', params: ['0x00', '0xabc'] };
    const p = s.guard(s.provider, args, s.original);
    args.params[0] = '0xEVIL'; // page mutates after the call
    await expect(p).resolves.toBe('signed');
    expect(s.checks[0]).toEqual({
      method: 'personal_sign',
      params: ['0x00', '0xabc'],
      chainId: 11155111,
      from: '0xabc',
    });
    expect(s.calls.at(-1)).toEqual({ method: 'personal_sign', params: ['0x00', '0xabc'] });
    expect(s.onVerdict).toHaveBeenCalled();
  });

  it('rejects with 4001', async () => {
    const s = setup('reject');
    await expect(
      s.guard(s.provider, { method: 'eth_sign', params: [] }, s.original),
    ).rejects.toMatchObject({
      code: 4001,
    });
    expect(s.calls.map((c) => c.method)).toEqual(['eth_chainId', 'eth_accounts']);
  });

  it('caches chainId/account and follows chainChanged / accountsChanged', async () => {
    const s = setup();
    await s.guard(s.provider, { method: 'eth_sign', params: [] }, s.original);
    await s.guard(s.provider, { method: 'eth_sign', params: [] }, s.original);
    expect(s.calls.filter((c) => c.method === 'eth_chainId')).toHaveLength(1);
    s.listeners.get('chainChanged')?.('0x1');
    s.listeners.get('accountsChanged')?.(['0xdef']);
    await s.guard(s.provider, { method: 'eth_sign', params: [] }, s.original);
    expect(s.checks.at(-1)).toMatchObject({ chainId: 1, from: '0xdef' });
    s.listeners.get('accountsChanged')?.([]);
    s.listeners.get('chainChanged')?.('garbage');
    await s.guard(s.provider, { method: 'eth_sign', params: [] }, s.original);
    expect(s.checks.at(-1)).toMatchObject({ chainId: 11155111, from: '0xabc' });
  });

  it('providers without events are queried every time; failures fall back to 0 / undefined', async () => {
    const s = setup();
    const bare = { request: vi.fn() };
    const failing = vi.fn(async (a: RequestArgs) => {
      if (a.method === 'eth_chainId' || a.method === 'eth_accounts') throw new Error('nope');
      return 'ok';
    });
    await s.guard(bare, { method: 'eth_sign', params: [] }, failing);
    expect(s.checks[0]).toMatchObject({ chainId: 0, from: undefined });
    const throwingOn = { request: vi.fn(), on: () => { throw new Error('x'); } }; // prettier-ignore
    await s.guard(throwingOn, { method: 'eth_sign', params: [] }, s.original);
    await s.guard(throwingOn, { method: 'eth_sign', params: [] }, s.original);
    expect(s.calls.filter((c) => c.method === 'eth_chainId')).toHaveLength(2);
  });

  it('numeric chain ids and non-array accounts', async () => {
    const s = setup();
    const orig = vi.fn(async (a: RequestArgs) =>
      a.method === 'eth_chainId' ? 10 : a.method === 'eth_accounts' ? 'x' : 'ok',
    );
    await s.guard({ request: vi.fn() }, { method: 'eth_sign', params: [] }, orig);
    expect(s.checks[0]).toMatchObject({ chainId: 10, from: undefined });
  });

  it('uncloneable params are refused', async () => {
    const s = setup();
    await expect(
      s.guard(s.provider, { method: 'eth_sign', params: [() => 1] }, s.original),
    ).rejects.toMatchObject({ code: -32602 });
    expect(s.checks).toHaveLength(0);
  });
});
