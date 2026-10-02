import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import { USER } from './fixtures/addresses';
import { buildScenarios, PLAYGROUND_ORIGIN, SCENARIO_CHAIN_ID } from './fixtures/scenarios';
import type { Mode, SignRequest } from './types';
import { BUNDLED_WHITELISTS } from './whitelist';

const scenarios = buildScenarios(USER);

const toRequest = (s: (typeof scenarios)[number], origin: string): SignRequest => ({
  ...s.request,
  chainId: SCENARIO_CHAIN_ID,
  origin,
});

describe('AGENTS.md 11장 시나리오 S0–S10', () => {
  it('covers S0..S10 exactly', () => {
    expect(scenarios.map((s) => s.id)).toEqual(Array.from({ length: 11 }, (_, i) => `S${i}`));
  });

  it.each(scenarios.map((s) => [s.id, s.title, s] as const))('%s %s', (_, __, s) => {
    const v = analyze(toRequest(s, PLAYGROUND_ORIGIN), BUNDLED_WHITELISTS, 'scoped');
    expect({ level: v.level, ruleIds: v.ruleIds }).toEqual(s.expected);
    expect(v.details.protected).toBe(true);
  });

  it.each(['scoped', 'global'] as Mode[])('same results in %s mode on the playground', (mode) => {
    for (const s of scenarios) {
      const v = analyze(toRequest(s, PLAYGROUND_ORIGIN), BUNDLED_WHITELISTS, mode);
      expect(v.level).toBe(s.expected.level);
    }
  });

  it('every scenario is R0 on an unprotected origin (scoped)', () => {
    for (const s of scenarios) {
      const v = analyze(toRequest(s, 'https://example.org'), BUNDLED_WHITELISTS, 'scoped');
      expect({ id: s.id, level: v.level, ruleIds: v.ruleIds }).toEqual({
        id: s.id,
        level: 'LOW',
        ruleIds: ['R0'],
      });
    }
  });

  it('the playground origin is not protected on mainnet', () => {
    const v = analyze(
      { ...scenarios[2]!.request, chainId: 1, origin: PLAYGROUND_ORIGIN },
      BUNDLED_WHITELISTS,
      'scoped',
    );
    expect(v.ruleIds).toEqual(['R0']);
  });

  it('requests survive a JSON round trip (what the page actually sends)', () => {
    for (const s of scenarios) {
      expect(JSON.parse(JSON.stringify(s.request))).toEqual(s.request);
    }
  });
});
