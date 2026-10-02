import { deserialize } from '@/core/serialize';
import type { Mode, Verdict } from '@/core/types';
import { exportLogsJson, LOGS_KEY, type LogEntry } from '@/lib/background/log';
import { getSettings, setSettings, SETTINGS_KEY } from '@/lib/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function loadLogs(): Promise<LogEntry[]> {
  return ((await browser.storage.local.get(LOGS_KEY))[LOGS_KEY] as LogEntry[] | undefined) ?? [];
}

function cell(text: string, cls?: string) {
  const td = document.createElement('td');
  td.textContent = text;
  if (cls) td.className = cls;
  return td;
}

async function renderLogs() {
  const logs = await loadLogs();
  $('count').textContent = `(${logs.length}건)`;
  const body = $('logs');
  body.replaceChildren(
    ...[...logs].reverse().map((e) => {
      const v = deserialize<Verdict>(e.verdict);
      const tr = document.createElement('tr');
      tr.append(
        cell(new Date(e.ts).toLocaleString()),
        cell(e.origin + (e.protected ? '' : ' (비보호)')),
        cell(e.mode),
        cell(e.method),
        cell(v.level, v.level),
        cell(v.ruleIds.join(', ') || '-'),
        cell(e.userDecision),
        cell(v.summary),
      );
      return tr;
    }),
  );
}

async function renderMode() {
  const { mode } = await getSettings();
  for (const el of document.querySelectorAll<HTMLInputElement>('input[name=mode]')) {
    el.checked = el.value === mode;
  }
  $('mode-status').textContent = `현재: ${mode} (변경 즉시 다음 요청부터 적용)`;
}

function main() {
  for (const el of document.querySelectorAll<HTMLInputElement>('input[name=mode]')) {
    el.addEventListener('change', () => {
      if (el.checked) void setSettings({ mode: el.value as Mode });
    });
  }

  $('export').addEventListener('click', () => {
    void loadLogs().then((logs) => {
      const blob = new Blob([exportLogsJson(logs)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `route-guard-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    });
  });

  // Two-step clear instead of a confirm() dialog.
  const clear = $<HTMLButtonElement>('clear');
  let armed: ReturnType<typeof setTimeout> | undefined;
  clear.addEventListener('click', () => {
    if (!armed) {
      clear.textContent = '한 번 더 누르면 삭제';
      clear.classList.add('armed');
      armed = setTimeout(() => {
        armed = undefined;
        clear.textContent = '초기화';
        clear.classList.remove('armed');
      }, 3000);
      return;
    }
    clearTimeout(armed);
    armed = undefined;
    clear.textContent = '초기화';
    clear.classList.remove('armed');
    void browser.storage.local.set({ [LOGS_KEY]: [] });
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (LOGS_KEY in changes) void renderLogs();
    if (SETTINGS_KEY in changes) void renderMode();
  });

  void renderMode();
  void renderLogs();
}

main();
