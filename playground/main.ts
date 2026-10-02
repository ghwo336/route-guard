import type { Address } from 'viem';
import { buildScenarios, SCENARIO_CHAIN_ID } from '../core/fixtures/scenarios';

type Eip1193 = { request: (args: { method: string; params?: unknown }) => Promise<unknown> };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const eth = (): Eip1193 | undefined => (window as unknown as { ethereum?: Eip1193 }).ethereum;
const SEPOLIA_HEX = `0x${SCENARIO_CHAIN_ID.toString(16)}`;

let account: Address | undefined;

function errText(e: unknown): string {
  if (typeof e === 'object' && e !== null) {
    const { code, message } = e as { code?: unknown; message?: unknown };
    return `${code ?? ''} ${typeof message === 'string' ? message : ''}`.trim();
  }
  return String(e);
}

function render() {
  const body = $('scenarios');
  body.replaceChildren();
  // Without a wallet the requests are still shown, built for a placeholder address.
  const list = buildScenarios(account ?? '0x0000000000000000000000000000000000000001');
  for (const s of list) {
    const tr = document.createElement('tr');
    const btnTd = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'swapbtn';
    btn.textContent = '100 USDC → ETH 스왑';
    btn.dataset.id = s.id;
    btnTd.append(btn);

    const name = document.createElement('td');
    name.textContent = `${s.id} ${s.title}`;
    const actual = document.createElement('td');
    actual.textContent = s.actual;
    const expected = document.createElement('td');
    expected.textContent = `${s.expected.level} (${s.expected.ruleIds.join(', ')})`;
    expected.className = s.expected.level;
    const result = document.createElement('td');
    result.className = 'result';
    result.id = `result-${s.id}`;

    btn.onclick = async () => {
      const provider = eth();
      if (!provider || !account) {
        result.textContent = '먼저 지갑을 연결하세요.';
        return;
      }
      result.textContent = '요청 중…';
      try {
        const r = await provider.request(s.request);
        result.textContent = `통과: ${String(r).slice(0, 66)}`;
      } catch (e) {
        result.textContent = `거절: ${errText(e)}`;
      }
    };
    tr.append(btnTd, name, actual, expected, result);
    body.append(tr);
  }
}

$('connect').onclick = async () => {
  const provider = eth();
  if (!provider) {
    $('account').textContent = '지갑(window.ethereum)이 없습니다.';
    return;
  }
  const accs = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  account = accs[0] as Address | undefined;
  const chainId = (await provider.request({ method: 'eth_chainId' })) as string;
  $('account').textContent = `${account ?? '?'} · chainId ${Number(chainId)}${
    Number(chainId) === SCENARIO_CHAIN_ID ? '' : ' (Sepolia가 아님: 경고 대신 R14가 나올 수 있음)'
  }`;
  render();
};

$('sepolia').onclick = async () => {
  try {
    await eth()?.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: SEPOLIA_HEX }],
    });
    $('connect').click();
  } catch (e) {
    $('account').textContent = `전환 실패: ${errText(e)}`;
  }
};

render();
