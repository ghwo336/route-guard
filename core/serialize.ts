/**
 * bigint <-> string conversion for crossing message / storage boundaries
 * (`postMessage`, `runtime.sendMessage`, `storage`), which cannot carry bigint.
 *
 * bigints are encoded as `{ "$bigint": "<decimal>" }` so that ordinary strings
 * are never mistaken for numbers on the way back.
 */

const TAG = '$bigint';

type Encoded = { [TAG]: string };

function isEncoded(value: unknown): value is Encoded {
  if (typeof value !== 'object' || value === null) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 1 &&
    keys[0] === TAG &&
    typeof (value as Record<string, unknown>)[TAG] === 'string' &&
    /^-?\d+$/.test((value as Record<string, string>)[TAG] ?? '')
  );
}

/** Recursively replace bigints with tagged strings. The result is JSON-safe. */
export function serialize<T>(value: T): unknown {
  if (typeof value === 'bigint') return { [TAG]: value.toString(10) };
  if (Array.isArray(value)) return value.map((v) => serialize(v));
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = serialize(v);
    }
    return out;
  }
  return value;
}

/** Inverse of `serialize`. The caller is responsible for the resulting type. */
export function deserialize<T>(value: unknown): T {
  return revive(value) as T;
}

function revive(value: unknown): unknown {
  if (isEncoded(value)) return BigInt(value[TAG]);
  if (Array.isArray(value)) return value.map(revive);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = revive(v);
    return out;
  }
  return value;
}
