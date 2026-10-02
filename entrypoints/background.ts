import { BUNDLED_WHITELISTS } from '@/core/whitelist';
import { RuntimeRequest, type AnalyzeResponse } from '@/lib/bridge/protocol';
import {
  runAnalysis,
  senderOrigin,
  serialize,
  toSignRequest,
} from '@/lib/background/analyzeRequest';
import { getSettings } from '@/lib/settings';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    const parsed = RuntimeRequest.safeParse(msg);
    if (!parsed.success) return;
    const m = parsed.data;
    void (async () => {
      const { mode } = await getSettings();
      const req = toSignRequest(m.request, senderOrigin(sender, m.origin));
      const verdict = runAnalysis(m.type, req, BUNDLED_WHITELISTS, mode);
      console.info('[route-guard] verdict', req.origin, req.method, verdict);
      const res: AnalyzeResponse = {
        verdict: serialize(verdict) as AnalyzeResponse['verdict'],
        needsDecision: false, // warnings are wired in a later step
      };
      sendResponse(res);
    })().catch((e: unknown) => sendResponse({ error: String(e) }));
    return true;
  });
});
