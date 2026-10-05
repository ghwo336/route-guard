import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import '@/lib/bridge/protocol';
import './whitelist/schema';

describe('zod config', () => {
  it('schema modules turn off the JIT probe (Function() trips page CSP / Trusted Types)', () => {
    expect(z.config().jitless).toBe(true);
  });
});
