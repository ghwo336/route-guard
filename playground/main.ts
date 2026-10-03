import type { Address } from 'viem';
import type { RiskLevel } from '../core/types';
import {
  buildScenarios,
  PLAYGROUND_ORIGIN,
  SCENARIO_CHAIN_ID,
  type Scenario,
} from '../core/fixtures/scenarios';

type Eip1193 = { request: (args: { method: string; params?: unknown }) => Promise<unknown> };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (props.className) e.className = props.className;
  if (props.text !== undefined) e.textContent = props.text;
  e.append(...children);
  return e;
};
const eth = (): Eip1193 | undefined => (window as unknown as { ethereum?: Eip1193 }).ethereum;
const short = (a: string) =>
  /^0x[0-9a-fA-F]{40}$/.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
const SEPOLIA_HEX = `0x${SCENARIO_CHAIN_ID.toString(16)}`;
const PLACEHOLDER: Address = '0x0000000000000000000000000000000000000001';

/** How scenarios are grouped in the attacker panel. */
const GROUPS: { title: string; ids: string[] }[] = [
  { title: '정상 (공격 없음)', ids: ['S1', 'S0', 'S10'] },
  { title: '권한 탈취', ids: ['S2', 'S3', 'S6'] },
  { title: '스왑 결과 탈취', ids: ['S7', 'S9'] },
  { title: '주문 결과 탈취', ids: ['S4', 'S5', 'S11'] },
  { title: '보호 약화', ids: ['S8'] },
  { title: '다른 DEX (SushiSwap · Balancer)', ids: ['S12', 'S13', 'S14', 'S15'] },
];

/**
 * Only http://localhost:5173 is a protected origin (Sepolia whitelist). Served from anywhere
 * else (e.g. `pnpm playground:unprotected` on 127.0.0.1) every scenario is expected to be R0.
 */
const PROTECTED = location.origin === PLAYGROUND_ORIGIN;

function expected(s: Scenario): Scenario['expected'] & { text: string } {
  if (!PROTECTED) {
    return {
      level: 'LOW',
      ruleIds: ['R0'],
      text: '보호 대상 사이트가 아님 → 경고 없이 지갑 창이 바로 떠야 함',
    };
  }
  return {
    ...s.expected,
    text:
      s.expected.level === 'LOW'
        ? '경고 없이 지갑 창이 바로 떠야 함'
        : 'route-guard 경고 창이 지갑보다 먼저 떠야 함',
  };
}

let account: Address | undefined;
let chainId: number | undefined;
let selected = 'S1';
let busy = false;

const scenarios = () => buildScenarios(account ?? PLACEHOLDER);
const current = (): Scenario => scenarios().find((s) => s.id === selected)!;

// ---------------------------------------------------------------------------
// outcome classification (best effort: the page cannot see route-guard's verdict)
// ---------------------------------------------------------------------------

type Outcome = { kind: 'guard' | 'wallet' | 'passed' | 'error'; text: string; detail?: string };

function classify(result: { ok: unknown } | { err: unknown }): Outcome {
  if ('ok' in result) {
    return {
      kind: 'passed',
      text: '지갑까지 전달 → 서명/전송됨',
      detail: short(String(result.ok)).slice(0, 80),
    };
  }
  const e = result.err as { code?: unknown; message?: unknown };
  const msg = typeof e?.message === 'string' ? e.message : String(result.err);
  if (e?.code === 4001 && msg === 'User rejected the request.') {
    return { kind: 'guard', text: 'route-guard 경고에서 취소됨 (지갑에는 안 감)', detail: msg };
  }
  if (e?.code === 4001)
    return { kind: 'wallet', text: '지갑까지 전달 → 지갑에서 거절함', detail: msg };
  return { kind: 'error', text: `오류 (code ${String(e?.code ?? '?')})`, detail: msg };
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

function badge(level: RiskLevel, rules?: string[]) {
  return el('span', {
    className: `badge ${level}`,
    text: rules?.length ? `${level} · ${rules.join(', ')}` : level,
  });
}

function renderScenarios() {
  const byId = new Map(scenarios().map((s) => [s.id, s]));
  const listed = new Set(GROUPS.flatMap((g) => g.ids));
  const groups = [
    ...GROUPS,
    { title: '기타', ids: [...byId.keys()].filter((id) => !listed.has(id)) },
  ];
  const root = $('scenarios');
  root.replaceChildren();
  for (const g of groups) {
    const items = g.ids.map((id) => byId.get(id)).filter((s): s is Scenario => s !== undefined);
    if (items.length === 0) continue;
    root.append(el('div', { className: 'group-title', text: g.title }));
    for (const s of items) {
      const input = el('input');
      input.type = 'radio';
      input.name = 'scenario';
      input.value = s.id;
      input.checked = s.id === selected;
      input.onchange = () => {
        selected = s.id;
        renderTimeline();
      };
      const label = el(
        'label',
        { className: 'scenario' },
        input,
        el('span', { className: 'name', text: `${s.id} ${s.title}` }),
        badge(expected(s).level),
        el('span', { className: 'actual', text: s.actual }),
      );
      label.dataset.id = s.id;
      root.append(label);
    }
  }
}

function requestFacts(s: Scenario): HTMLElement {
  const dl = el('dl', { className: 'kv mono' });
  const add = (k: string, v: string) => dl.append(el('dt', { text: k }), el('dd', { text: v }));
  add('method', s.request.method);
  const p0 = s.request.params[0];
  if (s.request.method === 'eth_sendTransaction' && typeof p0 === 'object' && p0 !== null) {
    const tx = p0 as { to?: string; data?: string };
    if (tx.to) add('to', short(tx.to));
    if (tx.data) add('data', `${tx.data.slice(0, 10)}… (${(tx.data.length - 2) / 2} bytes)`);
  } else {
    add('형태', '서명 요청 (트랜잭션 아님)');
  }
  add('실제 내용', s.actual);
  return dl;
}

function renderTimeline(outcome?: Outcome | 'pending') {
  const s = current();
  const step = (n: number, title: string, body: Node | string) =>
    el(
      'li',
      {},
      el('span', { className: 'step', text: String(n) }),
      el('span', { className: 'step-title', text: title }),
      el('div', { className: 'step-body' }, body),
    );

  let result: Node;
  if (outcome === 'pending') {
    result = el('span', {
      className: 'outcome pending',
      text: '대기 중 — route-guard 경고 창 또는 지갑 창을 확인하세요',
    });
  } else if (outcome) {
    result = el(
      'div',
      {},
      el('div', { className: `outcome ${outcome.kind}`, text: outcome.text }),
      el('div', { className: 'mono muted', text: outcome.detail ?? '' }),
    );
  } else {
    result = el('span', { className: 'muted', text: '스왑을 누르면 표시됩니다' });
  }

  const exp = expected(s);

  $('timeline').replaceChildren(
    step(1, '화면에 보인 것', '100 USDC → 0.025 ETH 스왑, 받는 주소: 내 지갑'),
    step(2, '실제로 지갑에 보낸 요청', requestFacts(s)),
    step(
      3,
      '기대 판정',
      el(
        'div',
        {},
        badge(exp.level, exp.ruleIds),
        el('span', { className: 'muted', text: `  ${exp.text}` }),
      ),
    ),
    step(4, '결과', result),
  );
}

function addHistory(s: Scenario, o: Outcome) {
  const body = $('history');
  body.querySelector('tr.empty')?.remove();
  const row = el(
    'tr',
    {},
    el('td', { text: `${s.id} ${s.title}` }),
    el('td', {}, badge(expected(s).level, expected(s).ruleIds)),
    el('td', {}, el('span', { className: `outcome ${o.kind}`, text: o.text })),
  );
  body.prepend(row);
}

function renderWallet() {
  const net = $('network');
  const sepolia = $<HTMLButtonElement>('sepolia');
  if (!account) {
    net.textContent = eth() ? '지갑 미연결' : '지갑 없음 (window.ethereum)';
    net.className = 'pill muted';
    sepolia.hidden = true;
    return;
  }
  const onSepolia = chainId === SCENARIO_CHAIN_ID;
  net.textContent = `${short(account)} · ${onSepolia ? 'Sepolia' : `chainId ${chainId ?? '?'}`}`;
  net.className = `pill ${onSepolia ? 'ok' : 'warn'}`;
  net.dataset.chainId = String(chainId ?? '');
  sepolia.hidden = onSepolia;
  $('connect').textContent = '다시 연결';
}

/** The request in flight belongs to the selected scenario: keep it fixed until it settles. */
function lockScenarios(locked: boolean) {
  $('scenarios').classList.toggle('locked', locked);
  for (const i of document.querySelectorAll<HTMLInputElement>('input[name=scenario]'))
    i.disabled = locked;
}

function setHint(text: string, isBusy = false) {
  const h = $('hint');
  h.textContent = text;
  h.className = `hint${isBusy ? ' busy' : ''}`;
}

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------

async function connect() {
  const provider = eth();
  if (!provider) return renderWallet();
  const accs = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  account = accs[0] as Address | undefined;
  chainId = Number(await provider.request({ method: 'eth_chainId' }));
  renderWallet();
  renderScenarios();
  renderTimeline();
  if (chainId !== SCENARIO_CHAIN_ID)
    setHint('Sepolia로 전환하세요 (다른 체인에서는 R14가 나옵니다).');
  else setHint('');
}

async function swap() {
  const provider = eth();
  if (busy) return;
  if (!provider || !account) {
    setHint('먼저 지갑을 연결하세요.');
    return;
  }
  const s = current();
  busy = true;
  lockScenarios(true);
  const btn = $<HTMLButtonElement>('swap');
  btn.disabled = true;
  btn.textContent = '확인 대기 중…';
  setHint('경고 창이나 지갑 창이 안 보이면 ⌘+` 로 창을 전환해 보세요.', true);
  renderTimeline('pending');

  let outcome: Outcome;
  try {
    outcome = classify({ ok: await provider.request(s.request) });
  } catch (err) {
    outcome = classify({ err });
  }
  renderTimeline(outcome);
  addHistory(s, outcome);
  busy = false;
  lockScenarios(false);
  btn.disabled = false;
  btn.textContent = '스왑';
  setHint('');
}

$('connect').onclick = () =>
  void connect().catch((e: unknown) => setHint(`연결 실패: ${String((e as Error)?.message ?? e)}`));
$('sepolia').onclick = async () => {
  try {
    await eth()?.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: SEPOLIA_HEX }],
    });
    await connect();
  } catch (e) {
    setHint(`전환 실패: ${String((e as Error)?.message ?? e)}`);
  }
};
$('swap').onclick = () => void swap();

if (!PROTECTED) {
  const note = $('origin-note');
  note.hidden = false;
  note.textContent = `이 주소(${location.origin})는 route-guard의 보호 대상이 아닙니다(R0). 모든 시나리오가 경고 없이 지갑으로 가야 정상입니다. 보호 대상 데모는 ${PLAYGROUND_ORIGIN} 에서 여세요.`;
}
renderWallet();
renderScenarios();
renderTimeline();
