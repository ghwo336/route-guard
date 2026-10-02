import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export const EXTENSION_DIR = path.resolve(import.meta.dirname, '../.output/chrome-mv3');
export const USER = '0x1111111111111111111111111111111111111111';
export const PLAYGROUND = 'http://localhost:5173/';

/**
 * Stub wallet, injected before page scripts: a `window.ethereum` that records what it
 * would sign, plus a second provider announced via EIP-6963.
 */
function stubWallet(user: string) {
  type Req = { method: string; params?: unknown };
  const signed: Req[] = [];
  const make = (name: string) => ({
    name,
    async request({ method, params }: Req) {
      if (method === 'eth_chainId') return '0xaa36a7';
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [user];
      if (method === 'wallet_switchEthereumChain') return null;
      signed.push({ method, params });
      return `SIGNED:${method}`;
    },
    on() {},
  });
  const w = window as unknown as Record<string, unknown>;
  w.ethereum = make('injected');
  const announced = make('eip6963');
  const announce = () =>
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: Object.freeze({
          info: { uuid: '1', name: 'Stub', icon: '', rdns: 'test.stub' },
          provider: announced,
        }),
      }),
    );
  window.addEventListener('eip6963:requestProvider', announce);
  announce();
  w.__signed = signed;
  w.__announced = announced;
  w.__send = (req: Req, p = w.ethereum as ReturnType<typeof make>) =>
    p.request(req).then(
      (ok) => ({ ok }),
      (e: { code?: number; message?: string }) => ({ err: e.code, msg: e.message }),
    );
}

type Fixtures = {
  context: BrowserContext;
  extensionId: string;
  dapp: Page;
  unprotectedUrl: string;
};

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixture signature
  context: async ({}, use) => {
    if (!fs.existsSync(path.join(EXTENSION_DIR, 'manifest.json'))) {
      throw new Error('extension not built: run `pnpm build` (pnpm e2e does it for you)');
    }
    const ctx = await chromium.launchPersistentContext(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rg-e2e-')),
      {
        channel: 'chromium',
        headless: true,
        args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
      },
    );
    await ctx.addInitScript(stubWallet, USER);
    await use(ctx);
    await ctx.close();
  },
  extensionId: async ({ context }, use) => {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(new URL(sw.url()).host);
  },
  /** A page on an origin that is in no whitelist (→ R0). Pages fulfilled via page.route
   * do not get content scripts, so this is a real local server. */
  // eslint-disable-next-line no-empty-pattern -- Playwright fixture signature
  unprotectedUrl: async ({}, use) => {
    const server = http.createServer((_, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>unprotected</title>');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as { port: number };
    await use(`http://127.0.0.1:${port}/`);
    server.close();
  },
  dapp: async ({ context, extensionId }, use) => {
    void extensionId; // make sure the extension is up first
    const page = await context.newPage();
    await page.goto(PLAYGROUND);
    await use(page);
  },
});

export const expect = test.expect;

/** Waits for the warning window and for its content to be rendered. */
export async function nextWarning(context: BrowserContext): Promise<Page> {
  const warn = await context.waitForEvent('page', {
    predicate: (p) => p.url().includes('/warning.html'),
    timeout: 10_000,
  });
  await warn.waitForFunction(
    () => document.getElementById('summary')?.textContent !== '불러오는 중…',
  );
  return warn;
}

export type SendResult = { ok?: string; err?: number; msg?: string };
