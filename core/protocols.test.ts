import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import { USER } from './fixtures/addresses';
import { buildProtocolScenarios } from './fixtures/protocolScenarios';
import { BUNDLED_WHITELISTS } from './whitelist';

const scenarios = buildProtocolScenarios(USER);

describe('Phase 7 protocol scenarios (mainnet)', () => {
  it.each(scenarios.map((s) => [s.protocol, s.title, s] as const))('%s · %s', (_, __, s) => {
    const v = analyze({ ...s.request, chainId: 1, origin: s.origin }, BUNDLED_WHITELISTS, 'scoped');
    expect({ level: v.level, ruleIds: v.ruleIds }).toEqual(s.expected);
  });

  it('each protocol has the four required cases', () => {
    for (const protocol of ['SushiSwap', 'Curve', 'Balancer'] as const) {
      const list = scenarios.filter((s) => s.protocol === protocol);
      expect(list.some((s) => s.expected.ruleIds.includes('R8'))).toBe(true);
      expect(
        list.some(
          (s) => s.title.startsWith('approve(ATTACKER') && s.expected.ruleIds.includes('R2'),
        ),
      ).toBe(true);
      expect(list.some((s) => s.expected.ruleIds.includes('R11'))).toBe(true);
      expect(list.some((s) => s.title.startsWith('정상'))).toBe(true);
    }
  });

  it('the same requests are R0 on an unrelated origin', () => {
    for (const s of scenarios) {
      const v = analyze(
        { ...s.request, chainId: 1, origin: 'https://example.org' },
        BUNDLED_WHITELISTS,
        'scoped',
      );
      expect(v.ruleIds).toEqual(['R0']);
    }
  });

  it("one protocol's contracts are not trusted on another protocol's origin", () => {
    const balancerV3 = scenarios.find(
      (s) => s.protocol === 'Balancer' && s.title.startsWith('정상 V3'),
    )!;
    const v = analyze(
      { ...balancerV3.request, chainId: 1, origin: 'https://www.sushi.com' },
      BUNDLED_WHITELISTS,
      'scoped',
    );
    expect(v.ruleIds).toContain('R11');
  });
});
