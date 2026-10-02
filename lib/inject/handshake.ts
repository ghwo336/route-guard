import { HELLO_KEY } from '../bridge/protocol';

/**
 * Create the private channel and hand one end to the content script. Must run at
 * document_start, before page scripts exist, and only once: re-handshaking would let
 * the page grab a port and forge decisions.
 */
export function openChannel(win: Pick<Window, 'postMessage'>): MessagePort {
  const channel = new MessageChannel();
  win.postMessage({ [HELLO_KEY]: true }, '*', [channel.port2]);
  return channel.port1;
}
