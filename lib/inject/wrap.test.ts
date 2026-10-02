import { describe, expect, it, vi } from 'vitest';
import { installProviderHooks } from './install';
import { createWrapper, type Guard, type Provider, type RequestArgs } from './wrap';

function fakeProvider() {
  const calls: RequestArgs[] = [];
  const p = {
    request: vi.fn(async (args: RequestArgs) => {
      calls.push(args);
      return `ok:${args.method}`;
    }),
    sendAsync: vi.fn((payload: unknown, cb: (e: unknown, r?: unknown) => void) =>
      cb(null, { result: 'legacy', payload }),
    ),
    send: vi.fn((a: unknown, b?: unknown) => ({ legacySend: [a, b] })),
  };
  return { p, calls };
}

const passGuard: Guard = (_p, args, original) => original(args);

describe('createWrapper', () => {
  it('routes watched methods through the guard and leaves others alone', async () => {
    const { p, calls } = fakeProvider();
    const guard = vi.fn(passGuard);
    const wrap = createWrapper(guard);
    expect(wrap(p)).toBe(true);

    await expect(p.request({ method: 'eth_chainId' })).resolves.toBe('ok:eth_chainId');
    expect(guard).not.toHaveBeenCalled();

    await expect(p.request({ method: 'eth_sendTransaction', params: [{}] })).resolves.toBe(
      'ok:eth_sendTransaction',
    );
    expect(guard).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.method)).toEqual(['eth_chainId', 'eth_sendTransaction']);
  });

  it('wraps each provider once (WeakSet)', () => {
    const { p } = fakeProvider();
    const wrap = createWrapper(passGuard);
    expect(wrap(p)).toBe(true);
    const patched = p.request;
    expect(wrap(p)).toBe(false);
    expect(p.request).toBe(patched);
    expect(wrap(null)).toBe(false);
    expect(wrap({})).toBe(false);
  });

  it('can be rejected by the guard', async () => {
    const { p } = fakeProvider();
    createWrapper(async () => {
      throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
    })(p);
    await expect(p.request({ method: 'personal_sign', params: [] })).rejects.toMatchObject({
      code: 4001,
    });
  });

  it('patches non-writable request via defineProperty, warns when impossible', () => {
    const { p } = fakeProvider();
    Object.defineProperty(p, 'request', { value: p.request, writable: false, configurable: true });
    expect(createWrapper(passGuard)(p)).toBe(true);

    const frozen = Object.freeze({ request: async () => 1 });
    const warn = vi.fn();
    expect(createWrapper(passGuard, warn)(frozen)).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('legacy sendAsync: watched → guard, others → original, batches with signing rejected', async () => {
    const { p } = fakeProvider();
    const guard = vi.fn(passGuard);
    createWrapper(guard)(p);
    const cb = vi.fn();

    await new Promise<void>((done) =>
      p.sendAsync({ id: 7, method: 'eth_sign', params: ['0x1', '0x2'] }, (e, r) => {
        cb(e, r);
        done();
      }),
    );
    expect(cb).toHaveBeenCalledWith(null, { id: 7, jsonrpc: '2.0', result: 'ok:eth_sign' });
    expect(guard).toHaveBeenCalledTimes(1);

    p.sendAsync({ id: 8, method: 'eth_blockNumber' }, cb);
    expect(cb).toHaveBeenLastCalledWith(null, expect.objectContaining({ result: 'legacy' }));

    p.sendAsync([{ method: 'eth_sign' }], cb);
    expect(cb.mock.lastCall?.[0]).toMatchObject({ code: 4001 });
    p.sendAsync([{ method: 'eth_chainId' }], cb);
    expect(cb).toHaveBeenLastCalledWith(null, expect.objectContaining({ result: 'legacy' }));
  });

  it('legacy sendAsync forwards guard errors', async () => {
    const { p } = fakeProvider();
    createWrapper(async () => {
      throw new Error('no');
    })(p);
    const err = await new Promise((done) =>
      p.sendAsync({ id: 1, method: 'personal_sign' }, (e) => done(e)),
    );
    expect(err).toMatchObject({ message: 'no' });
  });

  it('legacy send overloads', async () => {
    const { p } = fakeProvider();
    const guard = vi.fn(passGuard);
    createWrapper(guard)(p);
    const send = p.send as (...a: unknown[]) => unknown;

    await expect(send('personal_sign', ['0x', '0x'])).resolves.toBe('ok:personal_sign');
    expect(() => send({ method: 'eth_sign' })).toThrow(/동기 send/);
    const cb = vi.fn();
    send({ method: 'eth_sign', id: 1 }, cb);
    await vi.waitFor(() => expect(cb).toHaveBeenCalled());
    expect(send('eth_chainId')).toEqual({ legacySend: ['eth_chainId', undefined] });
    expect(send({ method: 'eth_chainId' })).toEqual({
      legacySend: [{ method: 'eth_chainId' }, undefined],
    });
    expect(guard).toHaveBeenCalledTimes(2);
  });
});

describe('installProviderHooks', () => {
  function fakeWindow() {
    const win = new EventTarget() as EventTarget & {
      ethereum?: unknown;
      setTimeout: (fn: () => void, ms: number) => unknown;
      document: EventTarget;
    };
    const timers: (() => void)[] = [];
    win.setTimeout = (fn) => timers.push(fn);
    win.document = new EventTarget();
    return { win, timers };
  }

  it('wraps an existing window.ethereum and its providers[]', () => {
    const { win } = fakeWindow();
    const a = fakeProvider().p;
    const b = fakeProvider().p;
    win.ethereum = Object.assign(fakeProvider().p, { providers: [a, b] });
    const seen: unknown[] = [];
    installProviderHooks(win, (p) => seen.push(p));
    expect(seen).toContain(a);
    expect(seen).toContain(b);
  });

  it('catches a later assignment to window.ethereum', () => {
    const { win } = fakeWindow();
    const seen: unknown[] = [];
    installProviderHooks(win, (p) => seen.push(p));
    const p = fakeProvider().p;
    win.ethereum = p;
    expect(win.ethereum).toBe(p);
    expect(seen).toContain(p);
  });

  it('re-checks after a wallet redefines the property, and on ethereum#initialized', () => {
    const { win, timers } = fakeWindow();
    const seen: unknown[] = [];
    installProviderHooks(win, (p) => seen.push(p));
    const p = fakeProvider().p;
    Object.defineProperty(win, 'ethereum', { value: p, configurable: true });
    expect(seen).not.toContain(p);
    timers.forEach((t) => t());
    expect(seen).toContain(p);

    const q = fakeProvider().p;
    Object.defineProperty(win, 'ethereum', { value: q, configurable: true });
    win.dispatchEvent(new Event('ethereum#initialized'));
    expect(seen).toContain(q);
  });

  it('EIP-6963: requests announcements and wraps announced providers', () => {
    const { win } = fakeWindow();
    const requested = vi.fn();
    win.addEventListener('eip6963:requestProvider', requested);
    const seen: unknown[] = [];
    installProviderHooks(win, (p) => seen.push(p));
    expect(requested).toHaveBeenCalled();
    const p: Provider = fakeProvider().p;
    win.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', { detail: { info: {}, provider: p } }),
    );
    expect(seen).toContain(p);
  });

  it('tolerates a non-configurable window.ethereum owned by someone else', () => {
    const { win } = fakeWindow();
    Object.defineProperty(win, 'ethereum', { value: undefined, configurable: false });
    expect(() => installProviderHooks(win, () => {})).not.toThrow();
  });
});
