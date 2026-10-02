import { isWatchedMethod } from '@/core/types';

export type RequestArgs = { method: string; params?: unknown };

type RequestFn = (args: RequestArgs) => Promise<unknown>;
type Callback = (error: unknown, response?: unknown) => void;

/** Minimal EIP-1193 provider shape (plus legacy send / sendAsync). */
export type Provider = {
  request: RequestFn;
  send?: (...args: unknown[]) => unknown;
  sendAsync?: (payload: unknown, callback: Callback) => void;
  on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
};

/**
 * Called for every watched method. `original` invokes the unwrapped provider.
 * `args` is a snapshot owned by the guard: the page cannot mutate it afterwards.
 */
export type Guard = (
  provider: Provider,
  args: RequestArgs,
  original: RequestFn,
) => Promise<unknown>;

export function isProvider(p: unknown): p is Provider {
  return typeof p === 'object' && p !== null && typeof (p as Provider).request === 'function';
}

function setMethod(target: object, key: string, fn: unknown): boolean {
  try {
    (target as Record<string, unknown>)[key] = fn;
    if ((target as Record<string, unknown>)[key] === fn) return true;
  } catch {
    // fall through
  }
  try {
    Object.defineProperty(target, key, { value: fn, writable: true, configurable: true });
    return (target as Record<string, unknown>)[key] === fn;
  } catch {
    return false;
  }
}

const rpcError = (code: number, message: string) => Object.assign(new Error(message), { code });

/**
 * Returns `wrapProvider(p)`, which patches `request` (and legacy `send` / `sendAsync`)
 * so watched methods go through `guard`. Each provider object is patched once.
 */
export function createWrapper(guard: Guard, warn: (msg: string, p: unknown) => void = () => {}) {
  const wrapped = new WeakSet<object>();

  return function wrapProvider(p: unknown): boolean {
    if (!isProvider(p) || wrapped.has(p)) return false;
    wrapped.add(p);

    const origRequest = p.request;
    const original: RequestFn = (args) => Reflect.apply(origRequest, p, [args]) as Promise<unknown>;

    const request: RequestFn = function (this: unknown, args) {
      if (typeof args === 'object' && args !== null && isWatchedMethod(args.method)) {
        return guard(p, args, original);
      }
      return Reflect.apply(origRequest, this ?? p, [args]) as Promise<unknown>;
    };
    if (!setMethod(p, 'request', request)) {
      warn('provider.request를 감쌀 수 없습니다', p);
      return false;
    }

    // Legacy sendAsync(payload, cb): route watched methods through the guarded request.
    const origSendAsync = p.sendAsync;
    if (typeof origSendAsync === 'function') {
      setMethod(p, 'sendAsync', function (this: unknown, payload: unknown, cb: Callback) {
        const watched = (x: unknown) =>
          typeof x === 'object' && x !== null && isWatchedMethod((x as RequestArgs).method);
        if (Array.isArray(payload)) {
          if (payload.some(watched)) {
            cb(rpcError(4001, 'route-guard: 서명 요청이 들어간 batch는 지원하지 않습니다.'));
            return;
          }
        } else if (watched(payload)) {
          const {
            id,
            jsonrpc = '2.0',
            method,
            params,
          } = payload as RequestArgs & {
            id?: unknown;
            jsonrpc?: string;
          };
          request({ method, params }).then(
            (result) => cb(null, { id, jsonrpc, result }),
            (error: unknown) => cb(error, { id, jsonrpc, error }),
          );
          return;
        }
        Reflect.apply(origSendAsync, this ?? p, [payload, cb]);
      });
    }

    // Legacy send: send(method, params) → Promise, send(payload, cb), send(payload) (sync).
    const origSend = p.send;
    if (typeof origSend === 'function') {
      setMethod(p, 'send', function (this: unknown, a: unknown, b?: unknown) {
        if (typeof a === 'string' && isWatchedMethod(a)) {
          return request({ method: a, params: b });
        }
        if (typeof a === 'object' && a !== null && isWatchedMethod((a as RequestArgs).method)) {
          if (typeof b === 'function') return p.sendAsync?.(a, b as Callback);
          throw rpcError(4200, 'route-guard: 동기 send로 서명 요청을 보낼 수 없습니다.');
        }
        return Reflect.apply(origSend, this ?? p, [a, b].slice(0, b === undefined ? 1 : 2));
      });
    }
    return true;
  };
}
