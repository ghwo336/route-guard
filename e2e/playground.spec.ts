import { buildScenarios } from '../core/fixtures/scenarios';
import { expect, nextWarning, test, USER } from './fixtures';

test('unprotected origin (127.0.0.1:5174): S2 reaches the wallet without a warning (R0)', async ({
  context,
  extensionId,
}) => {
  void extensionId;
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5174/');
  await expect(page.locator('#origin-note')).toBeVisible();
  await page.click('#connect');
  await expect(page.locator('#network')).toHaveAttribute('data-chain-id', '11155111');
  await page.check('input[name=scenario][value=S2]');
  await expect(page.locator('#timeline')).toContainText('R0');
  let warned = false;
  context.on('page', (p) => {
    if (p.url().includes('/warning.html')) warned = true;
  });
  await page.click('#swap');
  await expect(page.locator('#timeline .outcome')).toHaveText(/지갑까지 전달 → 서명/);
  expect(warned).toBe(false);
});

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
