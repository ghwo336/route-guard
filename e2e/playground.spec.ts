import { buildScenarios } from '../core/fixtures/scenarios';
import { expect, nextWarning, test, USER } from './fixtures';

// Every playground button, end to end: LOW passes straight to the wallet, MEDIUM/HIGH
// open the warning window at the expected level (then we cancel).
for (const s of buildScenarios(USER)) {
  test(`${s.id} ${s.title} → ${s.expected.level}`, async ({ context, dapp }) => {
    await dapp.click('#connect');
    await expect(dapp.locator('#account')).toContainText('11155111');
    const result = dapp.locator(`#result-${s.id}`);

    if (s.expected.level === 'LOW') {
      await dapp.click(`button[data-id="${s.id}"]`);
      await expect(result).toHaveText(/^통과/);
      return;
    }
    const warning = nextWarning(context);
    await dapp.click(`button[data-id="${s.id}"]`);
    const warn = await warning;
    await expect(warn.locator('#badge')).toContainText(s.expected.level);
    await warn.click('#cancel');
    await expect(result).toHaveText(/^거절: 4001/);
  });
}
