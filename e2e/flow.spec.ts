import { buildScenarios } from '../core/fixtures/scenarios';
import { expect, nextWarning, test, USER, type SendResult } from './fixtures';

const S = Object.fromEntries(buildScenarios(USER).map((s) => [s.id, s.request]));
type Req = (typeof S)[string];
const send = (page: import('@playwright/test').Page, req: Req) =>
  page.evaluate(
    (r) => (window as never as { __send: (r: unknown) => Promise<SendResult> }).__send(r),
    req,
  );

test('LOW passes without a window; non-watched methods untouched', async ({ dapp }) => {
  expect(await send(dapp, S.S0!)).toEqual({ ok: 'SIGNED:eth_sendTransaction' });
  expect(
    await dapp.evaluate(() =>
      (
        window as never as { ethereum: { request: (a: unknown) => Promise<unknown> } }
      ).ethereum.request({ method: 'eth_chainId' }),
    ),
  ).toBe('0xaa36a7');
});

test('HIGH → warning; cancel is focused and rejects with 4001', async ({ context, dapp }) => {
  const pending = send(dapp, S.S2!);
  const warn = await nextWarning(context);
  await expect(warn.locator('#badge')).toContainText('HIGH');
  await expect(warn.locator('#summary')).toContainText('등록되지 않은 주소');
  expect(await warn.evaluate(() => document.activeElement?.id)).toBe('cancel');
  await expect(warn.locator('#proceed')).toBeDisabled();
  await warn.click('#cancel');
  expect(await pending).toMatchObject({ err: 4001 });
});

test('HIGH → proceed (after the delay) calls the wallet', async ({ context, dapp }) => {
  const pending = send(dapp, S.S7!);
  const warn = await nextWarning(context);
  await expect(warn.locator('#proceed')).toBeEnabled({ timeout: 5000 });
  await warn.click('#proceed');
  expect(await pending).toEqual({ ok: 'SIGNED:eth_sendTransaction' });
});

test('MEDIUM → closing the window rejects; Esc rejects', async ({ context, dapp }) => {
  let pending = send(dapp, S.S8!);
  let warn = await nextWarning(context);
  await expect(warn.locator('#badge')).toContainText('MEDIUM');
  await warn.close();
  expect(await pending).toMatchObject({ err: 4001 });

  pending = send(dapp, S.S11!);
  warn = await nextWarning(context);
  await expect(warn.locator('#summary')).toContainText('UniswapX');
  // the window closes itself on Esc, which can race the end of the key press
  await warn.keyboard.press('Escape').catch(() => {});
  expect(await pending).toMatchObject({ err: 4001 });
});

test('the wallet gets the params as they were at call time', async ({ dapp }) => {
  const r = await dapp.evaluate(async (req) => {
    const w = window as never as {
      __send: (r: unknown) => Promise<SendResult>;
      __signed: { params: { to: string }[] }[];
    };
    const args = structuredClone(req) as { params: { to: string }[] };
    const p = w.__send(args);
    args.params[0]!.to = '0x000000000000000000000000000000000000dEaD';
    await p;
    return w.__signed.at(-1)!.params[0]!.to;
  }, S.S0!);
  expect(r).toBe((S.S0!.params[0] as { to: string }).to);
});

test('EIP-6963 providers are guarded; forged window messages cannot approve', async ({
  context,
  dapp,
}) => {
  const pending = dapp.evaluate((req) => {
    const w = window as never as {
      __send: (r: unknown, p: unknown) => Promise<SendResult>;
      __announced: unknown;
    };
    const p = w.__send(req, w.__announced);
    for (let i = 0; i < 5; i++)
      window.postMessage({ type: 'decision', id: 'x', decision: 'proceed' }, '*');
    return p;
  }, S.S6!);
  const warn = await nextWarning(context);
  await warn.waitForTimeout(300);
  expect(warn.isClosed()).toBe(false);
  await warn.click('#cancel');
  expect(await pending).toMatchObject({ err: 4001 });
});

test('unprotected origin is not checked (R0); global mode checks it', async ({
  context,
  extensionId,
  unprotectedUrl,
}) => {
  const page = await context.newPage();
  await page.goto(unprotectedUrl);
  expect(await send(page, S.S2!)).toEqual({ ok: 'SIGNED:eth_sendTransaction' });

  const opts = await context.newPage();
  await opts.goto(`chrome-extension://${extensionId}/options.html`);
  await opts.check('input[value=global]');
  await expect(opts.locator('#mode-status')).toContainText('global');
  const pending = send(page, S.S2!);
  const warn = await nextWarning(context);
  await warn.click('#cancel');
  expect(await pending).toMatchObject({ err: 4001 });
});

test('decisions are logged with the wallet address masked', async ({
  context,
  dapp,
  extensionId,
}) => {
  await send(dapp, S.S0!);
  const pending = send(dapp, S.S2!);
  await (await nextWarning(context)).click('#cancel');
  await pending;

  const opts = await context.newPage();
  await opts.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(opts.locator('#logs tr')).toHaveCount(2);
  const logs = (await opts.evaluate(async () => {
    // runs inside the extension page
    const c = (
      globalThis as never as {
        chrome: { storage: { local: { get: (k: string) => Promise<Record<string, unknown>> } } };
      }
    ).chrome;
    return (await c.storage.local.get('logs')).logs;
  })) as {
    userDecision: string;
  }[];
  expect(logs.map((l) => l.userDecision)).toEqual(['auto', 'reject']);
  const raw = JSON.stringify(logs).toLowerCase();
  expect(raw).not.toContain(USER.slice(2, 30));
  expect(raw).toContain('0x1111…1111');
});

test('a decision still arrives after the service worker is stopped', async ({
  context,
  dapp,
  extensionId,
}) => {
  const pending = send(dapp, S.S2!);
  const warn = await nextWarning(context);
  const cdp = await context.newCDPSession(dapp);
  const { targetInfos } = (await cdp.send('Target.getTargets')) as {
    targetInfos: { type: string; url: string; targetId: string }[];
  };
  const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(extensionId));
  expect(sw).toBeDefined();
  await cdp.send('Target.closeTarget', { targetId: sw!.targetId });
  await expect(warn.locator('#proceed')).toBeEnabled({ timeout: 5000 });
  await warn.click('#proceed');
  expect(await pending).toEqual({ ok: 'SIGNED:eth_sendTransaction' });
});
