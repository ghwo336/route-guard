import { BUNDLED_WHITELISTS } from '@/core/whitelist';
import { RuntimeRequest, WarningDecision } from '@/lib/bridge/protocol';
import { createController, type SessionStore } from '@/lib/background/controller';
import { appendLog, makeLogEntry, type LogStore } from '@/lib/background/log';
import { getSettings } from '@/lib/settings';

export default defineBackground(() => {
  const extensionOrigin = new URL(browser.runtime.getURL('/')).origin;

  const ctl = createController({
    session: browser.storage.session as unknown as SessionStore,
    whitelists: BUNDLED_WHITELISTS,
    getMode: async () => (await getSettings()).mode,
    openWarning: async (id) => {
      const win = await browser.windows.create({
        url: `${browser.runtime.getURL('/warning.html')}?id=${encodeURIComponent(id)}`,
        type: 'popup',
        width: 440,
        height: 660,
        focused: true,
      });
      return win?.id;
    },
    closeWindow: async (windowId) => {
      await browser.windows.remove(windowId);
    },
    sendToTab: async (tabId, msg, target) => {
      await browser.tabs.sendMessage(
        tabId,
        msg,
        target.documentId ? { documentId: target.documentId } : { frameId: target.frameId },
      );
    },
    now: () => Date.now(),
    onFinished: (e) =>
      appendLog(
        browser.storage.local as unknown as LogStore,
        makeLogEntry({ ...e, ts: Date.now() }),
      ),
  });

  browser.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    const analyze = RuntimeRequest.safeParse(msg);
    if (analyze.success) {
      if (!sender.tab) return; // only content scripts may ask for analysis
      ctl
        .analyze(analyze.data, sender)
        .then(sendResponse, (e: unknown) => sendResponse({ error: String(e) }));
      return true;
    }
    const decide = WarningDecision.safeParse(msg);
    // Decisions are accepted only from our own extension pages (the warning window),
    // never from a content script.
    if (decide.success && sender.url && new URL(sender.url).origin === extensionOrigin) {
      void ctl.decide(decide.data.id, decide.data.decision);
    }
    return undefined;
  });

  browser.windows.onRemoved.addListener((windowId) => void ctl.windowRemoved(windowId));
  browser.tabs.onRemoved.addListener((tabId) => void ctl.tabRemoved(tabId));
});
