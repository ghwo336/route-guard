import { deserialize, serialize } from '@/core/serialize';
import {
  DecisionPush,
  HELLO_KEY,
  InjectMessage,
  type AnalyzeResponse,
  type ContentMessage,
  type RuntimeRequest,
} from '@/lib/bridge/protocol';

// ISOLATED world. Relays between the inject script's private port and the background,
// attaching the frame's real origin. Serialization happens here, not in the page's world.
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: true,
  main() {
    let port: MessagePort | undefined;
    const send = (m: ContentMessage) => port?.postMessage(m);

    const onHello = (e: MessageEvent) => {
      const data: unknown = e.data;
      if (port || e.source !== window || e.ports.length !== 1) return;
      if (typeof data !== 'object' || data === null || !(HELLO_KEY in data)) return;
      port = e.ports[0]!;
      window.removeEventListener('message', onHello); // accept exactly one handshake
      port.onmessage = (ev) => void relay(ev.data);
    };
    window.addEventListener('message', onHello);

    async function relay(data: unknown) {
      const parsed = InjectMessage.safeParse(data);
      if (!parsed.success) return;
      const msg = parsed.data;
      send({ type: 'ack', id: msg.id });
      const out: RuntimeRequest = {
        type: msg.type,
        id: msg.id,
        origin: location.origin,
        request: { ...msg.request, params: serialize(msg.request.params) },
      };
      try {
        const res = (await browser.runtime.sendMessage(out)) as AnalyzeResponse | undefined;
        if (!res || typeof res !== 'object' || !('verdict' in res)) throw new Error('응답 없음');
        send({
          type: 'verdict',
          id: msg.id,
          verdict: deserialize(res.verdict),
          needsDecision: res.needsDecision,
        });
      } catch (err) {
        send({
          type: 'error',
          id: msg.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    browser.runtime.onMessage.addListener((m: unknown) => {
      const d = DecisionPush.safeParse(m);
      if (d.success) send(d.data);
    });
  },
});
