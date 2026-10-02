# route-guard

**Verify what you sign, not what you see.**

DEX 프론트엔드가 이미 변조됐다고 가정하고, 사용자가 서명하기 직전에 지갑으로 가는 요청을 가로채 **공식 컨트랙트 화이트리스트**와 비교하는 크롬 확장(MV3)입니다. 보안 리서치("익숙한 화면 속 자산 탈취")의 실험 도구이며, 기능 수보다 판정 로직의 정확성과 재현 가능성을 우선합니다.

대상은 **Uniswap**(app.uniswap.org)과 **CoW Swap**(swap.cow.fi), 체인은 **Ethereum mainnet**과 **Sepolia**입니다.

- 상세 스펙: [AGENTS.md](AGENTS.md)
- 커밋 단위 개발 기록: [PLAN.md](PLAN.md)

---

## 1. 용어

"라우터"는 컨트랙트 이름이 아니라 **역할** 이름입니다.

| 용어 | 뜻 | Uniswap | CoW Swap |
|---|---|---|---|
| **router** | 사용자가 tx를 보내는 입구 | UniversalRouter(1.2 / 2.0 / 2.1.x / 2.2.0), SwapRouter02, SwapProxy | GPv2Settlement, CoWSwapEthFlow |
| **spender** | 사용자 토큰을 꺼내 쓸 권한을 받는 주소 | Permit2, SwapProxy, SwapRouter02, UniswapX reactor, PositionManager(v3/v4) | GPv2VaultRelayer |
| **pool** | 실제 교환이 일어나는 곳. 사용자는 직접 호출하지 않음 | 수집 안 함 | 수집 안 함 |
| **recipient / receiver** | 스왑 결과물을 받는 주소 | router calldata 안 | 주문 서명 안 |
| **protected origin** | 엄격 검사를 적용하는 공식 도메인 | `https://app.uniswap.org` | `https://swap.cow.fi` |
| **센티널** | router가 "호출자 본인"/"router 자신"으로 해석하는 특수 주소 | `MSG_SENDER = address(1)`, `ADDRESS_THIS = address(2)` | — |

화이트리스트는 [core/whitelist/1.json](core/whitelist/1.json), [core/whitelist/11155111.json](core/whitelist/11155111.json)에 있고, 엔트리마다 공식 출처(`source`)가 붙어 있습니다.

## 2. 위협 모델

**가정**: dApp 페이지의 JS는 신뢰할 수 없습니다. DNS 탈취(CoW Swap 사례), CDN 스크립트 주입(BadgerDAO 사례), 공급망 변조로 화면은 정상인데 지갑에 넘어가는 요청만 바뀌어 있을 수 있습니다.

공격자가 돈을 가져가려면 **요청 어딘가에 공격자 주소를 넣어야** 합니다. route-guard는 그 자리를 검사합니다(중요도 순).

1. **spender**: `approve`, `increaseAllowance`, `setApprovalForAll`, EIP-2612 `Permit`, Permit2 서명과 `Permit2.approve`. 잔고 전체가 털릴 수 있어서 실제 피해 대부분이 여기서 나옵니다.
2. **서명 주문의 receiver / settlement**: CoW 주문, CoW EthFlow 주문
3. **router 호출의 recipient**: 진짜 router를 쓰되 결과물만 빼돌리는 경우
4. **tx의 `to`**: 가짜 router

**범위 밖**: 사이트 침해 자체를 막는 것, 멀티시그 서명 흐름(Bybit 유형), 확장 자체의 변조, 애그리게이터(1inch, 0x, ParaSwap 등), 가짜 토큰 경로, 온체인 화이트리스트 레지스트리.

## 3. 동작 구조

```
[dApp 페이지 (신뢰 X)]
   │  provider.request({ method, params })
   ▼
inject.content.ts  (MAIN world, document_start)
   │  감시 대상 메서드면 params를 즉시 복사(structuredClone)해 보류
   │  document_start에 한 번만 넘긴 private MessagePort로 전송
   ▼
content.ts  (ISOLATED world)
   │  bigint 직렬화, browser.runtime.sendMessage
   ▼
background.ts  (service worker)
   │  origin = sender.origin  (페이지가 보낸 값은 쓰지 않음)
   │  core/analyze(request, whitelist, mode) → Verdict
   │  LOW → 즉시 통과 / MEDIUM·HIGH → pending을 storage.session에 저장하고 경고 창
   ▼
warning.html  (확장 전용 popup window. 페이지 JS가 클릭할 수 없음)
   │  취소(기본 포커스·Esc) / 진행(HIGH는 1.5초 뒤 활성화) / 창 닫기 = 취소
   ▼
inject: 진행 → 복사해 둔 params로 원래 request 호출
        취소 → EIP-1193 에러 { code: 4001 }
```

- **감시 대상 메서드**: `eth_sendTransaction`, `wallet_sendCalls`(call별로 판정해 최고 레벨 채택), `eth_signTypedData_v4`/`_v3`(같은 디코더), `eth_signTypedData`(v1, 해석 안 함), `personal_sign`, `eth_sign`. 그 밖의 메서드(`eth_call`, `eth_chainId` 등)는 손대지 않습니다.
- **provider 래핑**: `window.ethereum`(기존 값, 이후 할당, `ethereum#initialized`, 늦게 재정의하는 지갑을 위한 재확인, `ethereum.providers[]`), EIP-6963 announce. 같은 객체는 `WeakSet`으로 한 번만 감쌉니다. 레거시 `send`/`sendAsync`도 같은 경로를 탑니다.
- **Fail-safe**: content script가 응답하지 않으면(ack 1.5초) 요청을 거절합니다. 응답은 했지만 분석이 5초 안에 끝나지 않으면 background가 protected origin에서는 R15 "검사 실패" 경고를 띄우고, 아니면 R0으로 통과시킵니다. 경고 창이 뜬 뒤에는 시간제한이 없습니다(사용자가 결정).
- **서비스 워커 재시작**: pending 요청은 `storage.session`에 있어서, 경고 창이 열린 상태에서 워커가 종료돼도 결정이 정상 전달됩니다.
- `core/`는 네트워크·`browser.*`·DOM을 쓰지 않는 순수 함수이며, 브라우저 없이 vitest로 테스트합니다.

## 4. 적용 범위 정책 (scoped / global)

화이트리스트를 모든 사이트에 적용하면 Aave 승인 같은 정상 요청까지 전부 HIGH가 되고, 사용자가 경고에 무뎌집니다. 그래서 기본값은 **scoped**입니다.

- **scoped (기본)**: 요청 origin이 어떤 DEX의 `origins`와 정확히 일치할 때만 검사합니다. 이때 정상으로 인정하는 주소는 **그 DEX의 주소 + utilities(WETH)** 뿐입니다. 일치하지 않으면 R0(통과, 로그만 남김)입니다. "정상 도메인이 변조된다"는 위협 모델과 맞습니다.
- **global**: 모든 origin을 전체 화이트리스트(모든 DEX)로 검사합니다. 오탐 측정 실험용입니다.
- 현재 체인에 화이트리스트가 없을 때: origin이 다른 체인에서 protected이면 R14(MEDIUM), 아니면 R0입니다.
- playground origin `http://localhost:5173`은 **Sepolia JSON에만** 등록돼 있습니다(Uniswap·CoW 양쪽). 메인넷에서는 보호 대상이 아닙니다.

모드는 확장 옵션 페이지에서 바꾸며, 다음 요청부터 바로 적용됩니다.

## 5. 판정 규칙

여러 규칙이 걸리면 가장 높은 레벨을 쓰고, `ruleIds`에는 전부 기록합니다. 적용 순서는 범위(R0/R14) → 승인 → 주문 → router → 기타입니다. 승인을 먼저 보는 이유는 approve tx의 `to`(토큰 주소)가 "미등록 대상"으로 오판되지 않게 하기 위해서입니다.

| # | 그룹 | 조건 | 결과 |
|---|---|---|---|
| R0 | 범위 | origin이 protected가 아님 (scoped) | 통과, 로그만 |
| R1 | 승인 | spender가 화이트리스트에 있음 (Permit2 서명·`Permit2.approve`는 routers도 인정) | LOW (무제한이면 표시) |
| R2 | 승인 | spender 미등록 & amount > 0, 또는 Permit2 `verifyingContract`가 공식 Permit2가 아님 | **HIGH** |
| R3 | 승인 | `setApprovalForAll(operator, true)`, operator 미등록 | **HIGH** |
| R4 | 승인 | 권한 회수 (`approve(x, 0)` 등) | LOW |
| R5 | 주문 | CoW 주문의 `verifyingContract`가 미등록 | **HIGH** |
| R6 | 주문 | CoW 주문 / EthFlow 주문의 receiver가 0x0도 본인도 아님 | **HIGH** |
| R16 | 주문 | CoW `setPreSignature` (주문 내용 확인 불가) | MEDIUM |
| R7 | router | 화이트리스트 router/utility 호출, recipient가 전부 본인·센티널·feeRecipient. 또는 `others` 호출 | LOW |
| R8 | router | 화이트리스트 router인데 recipient 중 하나가 본인이 아님. UniswapX 주문의 출력 recipient도 같음 | **HIGH** |
| R9 | router | recipient 디코딩 실패 (모르는 command, 해석하지 않는 UniswapX 주문 타입 등) | MEDIUM |
| R10 | router | swap이 있는데 호출 전체의 output floor 최댓값이 0 | MEDIUM |
| R11 | 기타 | 미등록 `to`에 calldata 또는 ETH 전송 | **HIGH** |
| R12 | 기타 | `transfer` / `transferFrom` | MEDIUM |
| R13 | 기타 | 해석 불가 서명, 알 수 없는 typed data | MEDIUM |
| R14 | 기타 | 이 체인에 화이트리스트 없음 (origin은 다른 체인에서 protected) | MEDIUM |
| R15 | 기타 | 분석 중 예외 / 시간 초과 | MEDIUM |

**무제한 판정**: `amount >= 2^160 - 1`. 무제한 자체는 위험 신호가 아닙니다(정상 Uniswap도 `approve(Permit2, MAX)`가 기본). 판단 기준은 "누구에게"입니다.

**R10 세부 (Uniswap SDK 확인 결과)**: 분할 경로·네이티브 출력·수수료가 있는 거래는 각 swap leg가 `ADDRESS_THIS`로 min 0을 받고, 마지막 `SWEEP`/`UNWRAP_WETH`에 전체 min이 들어갑니다. 그래서 개별 leg의 min이 아니라 **호출 전체에서 가장 강한 floor**로 판단합니다. 자세한 내용은 [AGENTS.md](AGENTS.md) 8.3에 있습니다.

경고 문구는 사실만 보여 주고 "해킹"이라고 단정하지 않습니다. 예: `등록되지 않은 주소 0xBAdB…BAD0에게 토큰 0x1c7D…7238 무제한 사용 권한을 줍니다.`

## 6. 한계

정직하게 기록합니다.

- **MAIN world 우회 가능성**: provider를 변조된 페이지와 같은 JS 컨텍스트에서 감쌉니다. 다음과 같이 우회를 어렵게 만들었지만 작정한 공격자는 우회할 여지가 있습니다.
  - 네이티브 함수는 `document_start`에 미리 잡아 둡니다.
  - 채널은 private MessagePort이고 handshake는 한 번만 합니다.
  - params는 복사본을 분석하고 지갑에도 그 복사본을 보냅니다.

  우회 예로는 확장보다 먼저 provider를 가로채기, 지갑의 다른 내부 API 쓰기 등이 있습니다. 지갑 내부 검증(예: MetaMask Snap)은 향후 과제입니다.
- **protected origin 밖은 보호하지 않음** (scoped). 피싱 도메인 자체는 이 도구의 범위가 아닙니다.
- **가짜 토큰 경로**: 공식 router와 본인 recipient를 쓰면서 경로만 공격자 토큰 풀로 보내는 경우는 사용자 의도를 알 수 없어 판별하기 어렵습니다.
- **애그리게이터** 미지원 (executor, srcReceiver 등 디코딩 범위가 큼).
- **멀티시그** 서명 흐름 미지원.
- **확장 자체의 변조**는 막지 못합니다.
- **CoW `setPreSignature`**: tx에는 주문 UID만 있어서 receiver를 확인할 수 없습니다(R16 MEDIUM).
- **UniswapX 주문**: ExclusiveDutch / V2Dutch / V3Dutch / Priority 주문은 출력 recipient까지 검사하지만, `RelayOrder` 등 그 밖의 주문 타입은 받는 주소를 확인하지 않고 MEDIUM(R9)만 표시합니다.
- **`others`**(PositionManager 등) 호출은 `to`만 확인하고 calldata 안의 recipient는 해석하지 않습니다. UniversalRouter의 포지션 매니저 command, Across 브리지 command도 해석하지 않습니다(R9).
- **`eth_signTypedData`(v1)**은 해석하지 않습니다(R13).
- typed data의 `domain.chainId`는 현재 체인과 비교하지 않습니다.
- 토큰 심볼·소수점은 조회하지 않습니다(외부 API·온체인 조회 금지 정책). 금액은 원시 정수로 표시합니다.
- 화이트리스트는 확장에 번들됩니다. 공식 프론트엔드가 새 router를 배포하면 JSON을 갱신해야 하며, 그 전까지는 R11 오탐이 날 수 있습니다.

## 7. 실험 재현

### 7.1 빌드와 로드

```sh
pnpm install
pnpm test         # core + lib 단위 테스트
pnpm coverage     # core/rules.ts 분기 커버리지 100%
pnpm build        # → .output/chrome-mv3
```

1. 크롬에서 `chrome://extensions` → 개발자 모드 → **압축해제된 확장 프로그램 로드** → `.output/chrome-mv3` 선택
2. MetaMask 또는 Rabby를 설치하고 테스트용 계정을 만든 뒤 **Sepolia**로 전환 (잔고는 필요 없습니다)
3. 확장 아이콘 → 옵션에서 모드가 `scoped`인지 확인

개발 중에는 `pnpm dev`로 확장을 로드한 별도 브라우저를 띄울 수 있습니다(지갑은 그 브라우저에 따로 설치해야 합니다).

### 7.2 playground 시나리오 (S0–S11)

```sh
pnpm playground   # http://localhost:5173
```

1. **지갑 연결** → **Sepolia로 전환**
2. 각 행의 "100 USDC → ETH 스왑" 버튼을 차례로 누릅니다. 화면은 같지만 실제 요청은 시나리오마다 다릅니다.
3. 기대 결과:
   - LOW: 경고 창 없이 지갑 창이 뜹니다. 지갑에서 **거절**하세요.
   - MEDIUM/HIGH: 경고 창이 뜹니다. **취소**를 누르세요.

| 시나리오 | 실제 요청 | 기대 |
|---|---|---|
| S0 정상 승인 | `approve(Permit2, MAX)` | LOW (R1) |
| S1 정상 스왑 | 공식 UniversalRouter, recipient = 본인, minOut > 0 | LOW (R7) |
| S2 BadgerDAO형 | `approve(ATTACKER, MAX)` | HIGH (R2) |
| S3 Permit2 드레인 | Permit2 `PermitSingle`, spender = ATTACKER | HIGH (R2) |
| S4 CoW형 | CoW 주문, receiver = ATTACKER | HIGH (R6) |
| S5 가짜 settlement | CoW 주문, verifyingContract = ATTACKER | HIGH (R5) |
| S6 NFT | `setApprovalForAll(ATTACKER, true)` | HIGH (R3) |
| S7 진짜 router 악용 | 공식 UniversalRouter, recipient = ATTACKER | HIGH (R8) |
| S8 슬리피지 0 | 공식 UniversalRouter, recipient = 본인, minOut = 0 | MEDIUM (R10) |
| S9 가짜 router | `to` = ATTACKER, 임의 calldata | HIGH (R11) |
| S10 권한 회수 | `approve(ATTACKER, 0)` | LOW (R4) |
| S11 UniswapX 결과 탈취 | UniswapX 주문(공식 reactor), output recipient = ATTACKER | HIGH (R1 + R8) |

같은 데이터([core/fixtures/scenarios.ts](core/fixtures/scenarios.ts))로 `pnpm test`가 판정 결과를 검증합니다.

### 7.3 로그 내보내기

옵션 페이지의 **판정 로그**에서 **JSON 내보내기**를 누릅니다. 각 항목의 형식은 다음과 같습니다.

```json
{
  "ts": 1790000000000,
  "origin": "http://localhost:5173",
  "protected": true,
  "mode": "scoped",
  "method": "eth_sendTransaction",
  "verdict": { "level": "HIGH", "ruleIds": ["R2"], "summary": "…", "details": { … } },
  "userDecision": "reject",
  "account": "0x1234…abcd"
}
```

- `userDecision`: `auto`(LOW, 창 없이 통과) / `proceed` / `reject`
- 사용자 지갑 주소는 앞뒤 4자리만 남기고 마스킹되며, bigint는 문자열로 내보냅니다.
- 실험 회차마다 **초기화**(두 번 클릭) 후 진행하면 회차별 로그를 분리할 수 있습니다.

### 7.4 오탐 실험 (실제 사이트)

목표: 공식 사이트의 정상 사용에서 경고가 **한 번도** 뜨지 않는지(오탐 0) 확인합니다.

1. 모드 `scoped`, 로그 초기화
2. **app.uniswap.org** (Sepolia 또는 소액 mainnet)에서 N회 실행:
   - 토큰 승인(Permit2 approve), Permit2 서명
   - ERC-20 → ERC-20 스왑, ERC-20 → ETH, ETH → ERC-20
   - (가능하면) 분할 경로가 나오는 큰 금액 견적, UniswapX 견적
3. **swap.cow.fi**에서 N회 실행: 토큰 승인, 주문 서명, ETH 판매(EthFlow), 주문 취소
4. 로그 JSON을 내보내 `verdict.level != "LOW"`인 항목 수를 셉니다. 오탐이 있었다면 `summary`와 `details.target`으로 원인을 분류합니다. 예: 화이트리스트에 없는 새 router, 해석하지 않는 command.
5. (선택) 모드 `global`로 바꿔 Aave, Lido 등 다른 사이트에서 같은 절차를 반복하면, 범위 정책이 없을 때의 오탐률을 측정할 수 있습니다.

결과 기록 양식:

| 사이트 | 동작 | 횟수 N | 경고 수 | 오탐 원인 |
|---|---|---|---|---|
| app.uniswap.org | 승인 | | | |
| app.uniswap.org | 스왑 | | | |
| swap.cow.fi | 주문 서명 | | | |
| swap.cow.fi | EthFlow | | | |

### 7.5 대조 실험 (MetaMask 기본 경고 / Rabby)

같은 S0–S11을 다음 세 조건에서 돌리고, **사용자가 위험을 알아챌 수 있는 표시**가 나오는지 기록합니다.

1. route-guard 끔 + MetaMask (기본 보안 경고)
2. route-guard 끔 + Rabby
3. route-guard 켬 + MetaMask (또는 Rabby)

route-guard를 끄려면 `chrome://extensions`에서 비활성화합니다.

| 시나리오 | MetaMask 기본 | Rabby | route-guard |
|---|---|---|---|
| S0 | | | LOW |
| S1 | | | LOW |
| S2 | | | HIGH |
| S3 | | | HIGH |
| S4 | | | HIGH |
| S5 | | | HIGH |
| S6 | | | HIGH |
| S7 | | | HIGH |
| S8 | | | MEDIUM |
| S9 | | | HIGH |
| S10 | | | LOW |
| S11 | | | HIGH |

칸에는 "경고 없음 / 일반 경고 / 구체적 경고(주소·금액 표시)"처럼 표시 수준을 적습니다. 지갑 경고는 버전에 따라 달라지므로 **지갑 버전과 날짜**를 함께 기록하세요.

## 8. 개발

```sh
pnpm dev          # 확장을 로드한 브라우저 (WXT)
pnpm typecheck
pnpm test
pnpm coverage
pnpm lint
pnpm playground
```

| 경로 | 내용 |
|---|---|
| `core/` | 순수 판정 로직: 타입, 화이트리스트(JSON + zod), 디코더(approval / cow / router / misc), 규칙, `analyze()` |
| `core/fixtures/` | 테스트·playground 공용 fixture (시나리오 S0–S11) |
| `lib/inject/` | provider 래핑, 보류(guard), inject 쪽 bridge client |
| `lib/bridge/` | 메시지 프로토콜(zod) |
| `lib/background/` | pending 관리(controller), 로그 |
| `entrypoints/` | WXT entrypoint: `inject.content.ts`(MAIN), `content.ts`(ISOLATED), `background.ts`, `warning/`, `options/` |
| `playground/` | 변조된 dApp 흉내 페이지 |

커밋 규칙과 단계별 기록은 [PLAN.md](PLAN.md)에 있습니다.
