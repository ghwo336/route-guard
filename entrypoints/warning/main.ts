import { deserialize } from '@/core/serialize';
import type { Verdict } from '@/core/types';
import type { Decision, PendingRecord, WarningDecision } from '@/lib/bridge/protocol';
import { LEVEL_TEXT, proceedDelayMs, verdictRows } from '@/lib/warning/rows';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function main() {
  const id = new URLSearchParams(location.search).get('id') ?? '';
  const key = `pending:${id}`;
  const rec = (await browser.storage.session.get(key))[key] as PendingRecord | undefined;
  const cancel = $<HTMLButtonElement>('cancel');
  const proceed = $<HTMLButtonElement>('proceed');

  if (!rec) {
    $('summary').textContent = '이미 처리된 요청입니다.';
    cancel.textContent = '닫기';
    cancel.onclick = () => window.close();
    return;
  }

  const verdict = deserialize<Verdict>(rec.verdict);
  $('app').dataset.level = verdict.level;
  $('badge').textContent = `${LEVEL_TEXT[verdict.level]} · ${verdict.level}`;
  $('summary').textContent = verdict.summary;
  document.title = `[${LEVEL_TEXT[verdict.level]}] route-guard`;

  const dl = $('rows');
  for (const row of verdictRows(verdict)) {
    const dt = document.createElement('dt');
    dt.textContent = row.label;
    const dd = document.createElement('dd');
    if (row.items) {
      // one line per address: the address (or its meaning) plus a tag
      for (const it of row.items) {
        const line = document.createElement('div');
        line.className = `addr${it.tone ? ` ${it.tone}` : ''}`;
        const text = document.createElement('span');
        text.className = 'mono';
        text.textContent = it.text;
        line.append(text);
        if (it.badge) {
          const tag = document.createElement('span');
          tag.className = `tag ${it.tone ?? ''}`;
          tag.textContent = it.badge;
          line.append(tag);
        }
        dd.append(line);
      }
    } else {
      dd.textContent = row.value;
      if (row.mono) dd.className = 'mono';
    }
    dl.append(dt, dd);
  }

  let sent = false;
  const decide = (decision: Decision) => {
    if (sent) return;
    sent = true;
    cancel.disabled = proceed.disabled = true;
    const msg: WarningDecision = { type: 'decide', id, decision };
    void browser.runtime.sendMessage(msg); // background answers the page and closes this window
  };
  cancel.onclick = () => decide('reject');
  proceed.onclick = () => decide('proceed');
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') decide('reject');
  });

  cancel.focus();
  setTimeout(() => {
    if (!sent) proceed.disabled = false;
  }, proceedDelayMs(verdict.level));
}

void main();
