import { buildScenarios } from '../core/fixtures/scenarios';
import { expect, nextWarning, test, USER } from './fixtures';

// Every attacker-panel scenario, end to end: pick it, press the one swap button.
// LOW goes straight to the wallet; MEDIUM/HIGH open the warning window (then we cancel).
for (const s of buildScenarios(USER)) {
  test(`${s.id} ${s.title} → ${s.expected.level}`, async ({ context, dapp }) => {
    await dapp.click('#connect');
    await expect(dapp.locator('#network')).toHaveAttribute('data-chain-id', '11155111');
    await dapp.check(`input[name=scenario][value=${s.id}]`);
    const outcome = dapp.locator('#timeline .outcome');

    if (s.expected.level === 'LOW') {
      await dapp.click('#swap');
      await expect(outcome).toHaveText(/지갑까지 전달 → 서명/);
    } else {
      const warning = nextWarning(context);
      await dapp.click('#swap');
      const warn = await warning;
      await expect(warn.locator('#badge')).toContainText(s.expected.level);
      await expect(dapp.locator('#swap')).toBeDisabled();
      await warn.click('#cancel');
      await expect(outcome).toHaveText(/route-guard 경고에서 취소됨/);
    }
    await expect(dapp.locator('#swap')).toBeEnabled();
    await expect(dapp.locator('#history tr')).toHaveCount(1);
  });
}
