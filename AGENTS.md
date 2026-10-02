# AGENTS.md — route-guard

> 이 파일은 코딩 에이전트용 작업 지침이다. 작업 전 전체를 읽고, 커밋 단위 계획은 `PLAN.md`를 따른다.
> Claude Code를 쓰면 `CLAUDE.md`로 심볼릭 링크를 걸어둔다: `ln -s AGENTS.md CLAUDE.md`
> **상위 디렉터리의 `CLAUDE.md`(예: `~/CLAUDE.md`)와 내용이 충돌하면 이 문서가 우선한다.** (기술 스택, 체인, 엔드포인트 등 전부)

## 1. 프로젝트 한 줄 요약

**Verify what you sign, not what you see.**
DEX 프론트엔드가 이미 변조됐다고 가정한다. 사용자가 서명하기 직전에 지갑으로 가는 요청을 가로채서 **공식 컨트랙트 화이트리스트**와 비교하고, 위험하면 경고하는 크롬 확장(MV3)이다.

이 확장은 보안 리서치("익숙한 화면 속 자산 탈취")의 **실험 도구**다. 기능을 많이 넣는 것보다 판정 로직이 정확하고 테스트 가능한 것이 더 중요하다.

## 2. 용어

"라우터"는 특정 컨트랙트 이름이 아니라 **역할** 이름이다. 서비스마다 자기 라우터가 따로 있다.

| 용어 | 뜻 | Uniswap | CoW Swap |
|---|---|---|---|
| **router** (거래 진입 컨트랙트) | 사용자가 tx를 보내는 입구 | UniversalRouter, SwapRouter02 | GPv2Settlement |
| **spender** (권한 수령 컨트랙트) | 사용자 토큰을 꺼내 쓸 권한을 받는 주소 | Permit2 | GPv2VaultRelayer |
| **pool** | 실제로 교환이 일어나는 곳. 사용자는 직접 상호작용하지 않음 | 수집 안 함 | 수집 안 함 |
| **recipient / receiver** | 스왑 결과물을 받는 주소 | calldata 안에 있음 | 주문 서명 안에 있음 |
| **protected origin** | 엄격 검사를 적용하는 공식 도메인 | app.uniswap.org | swap.cow.fi |

## 3. 위협 모델

- **가정**: dApp 페이지의 JS는 신뢰할 수 없다. DNS 탈취(CoW Swap 사례), CDN·Cloudflare 스크립트 주입(BadgerDAO 사례), 공급망 변조 등으로 화면은 정상이지만 지갑에 넘어가는 요청이 바뀌어 있을 수 있다.
- **공격자가 돈을 가져가려면 요청 어딘가에 공격자 주소를 넣어야 한다.** 우리는 그 자리를 검사한다. 중요도 순서는 다음과 같다.
  1. **spender**: approve, Permit, Permit2, setApprovalForAll. 잔고 전체를 탈취할 수 있어서 실제 피해 대부분이 여기서 나온다. **최우선.**
  2. **서명 주문의 receiver/settlement**: CoW 주문
  3. **router 호출의 recipient**: 진짜 router를 쓰되 결과만 빼돌리는 경우
  4. **tx의 `to`**: 가짜 router
- **범위 밖**
  - 사이트 침해 자체를 막는 것
  - 멀티시그 서명 흐름(Bybit 유형)
  - 확장 프로그램 자체의 변조
  - 애그리게이터(1inch, 0x, ParaSwap 등): 실행 경로(executor, srcReceiver)를 임의로 지정할 수 있어서 디코딩 범위가 크다. 향후 과제로 둔다.
  - **가짜 토큰 경로 공격**: 공식 router와 본인 recipient를 쓰면서 경로만 공격자 토큰 풀로 보내는 경우. 사용자 의도를 알 수 없어서 원리적으로 판별하기 어렵다. 한계로 기록한다.
  - 온체인 레지스트리 (**사용하지 않기로 결정됨, 구현 금지**)
- **알려진 한계** (README에 정직하게 기록할 것)
  - 이 확장은 변조된 페이지와 같은 JS 컨텍스트(MAIN world)에서 provider를 감싼다. 작정한 공격자는 우회할 여지가 있다. 지갑 내부 검증(예: MetaMask Snap)은 향후 과제다.
  - protected origin 밖에서는 보호하지 않는다(5장 정책).
  - CoW `setPreSignature`는 tx만으로 주문 내용(receiver 등)을 알 수 없어서 MEDIUM(R16)까지만 경고한다.
  - `others`(PositionManager 등) 호출은 `to`만 확인하고 calldata 안의 recipient는 해석하지 않는다.
  - `eth_signTypedData`(v1)는 내용을 해석하지 않고 MEDIUM(R13)으로만 처리한다.
  - UniswapX `RelayOrder` 등 해석하지 않는 주문 타입은 받는 주소를 확인하지 않고 MEDIUM(R9)으로만 처리한다.
  - typed data의 `domain.chainId`는 현재 체인과 비교하지 않는다.

## 4. 기술 스택

- **WXT** (MV3 확장 프레임워크) + **TypeScript** (strict)
- **viem**: ABI 디코딩, 주소 정규화, 타입
- **zod**: 화이트리스트 스키마 검증
- **vitest** + **@vitest/coverage-v8**: 단위 테스트, 분기 커버리지
- 패키지 매니저: pnpm
- UI는 프레임워크 없이 순수 TS + HTML로 작게 만든다. 필요하면 Preact까지만 허용한다.

## 5. 적용 범위 정책 (origin)

화이트리스트를 모든 사이트에 적용하면 Aave 승인 같은 정상 요청까지 전부 HIGH가 된다. 그러면 사용자가 경고에 무뎌진다. 그래서 **공식 도메인에서만 엄격하게 검사**한다. "정상 도메인이 변조된다"는 이번 위협 모델과도 맞는다.

- 화이트리스트 JSON에 DEX별 `origins`를 둔다 (예: `https://app.uniswap.org`).
- 요청의 `origin`이 어떤 DEX의 origin과 일치하면 → **그 DEX의 주소 + utilities**만 정상으로 인정하고 7장 규칙을 전부 적용한다.
- 일치하지 않으면 → R0: 경고 없이 통과하고 로그만 남긴다(`unprotected`).
- 현재 chainId의 화이트리스트 JSON이 없으면: origin이 **다른 체인 JSON에라도** protected origin으로 등록돼 있으면 R14(MEDIUM), 아니면 R0.
- 옵션에 `mode: 'scoped' | 'global'`을 둔다. 기본값은 `scoped`다. `global`은 오탐 측정 실험용으로, 모든 origin에서 전체 화이트리스트로 검사한다.
- playground(`http://localhost:5173`)는 Sepolia JSON에서만 개발용 origin으로 등록한다. 메인넷 JSON에는 절대 넣지 않는다.
- origin은 페이지 JS가 보내는 값을 믿지 않는다. content script의 `location.origin` 또는 background의 `sender.origin`을 쓴다.

## 6. 아키텍처

```
[dApp 페이지 (신뢰 X)]
   │  provider.request({ method, params })
   ▼
inject.ts (MAIN world, document_start)
   │  감시 대상 메서드면 보류 → window.postMessage
   ▼
content.ts (ISOLATED world)
   │  browser.runtime.sendMessage  (origin은 여기서 붙임)
   ▼
background.ts (service worker)
   │  core/analyze(request, whitelist, mode) → Verdict
   │  LOW → 즉시 통과 / 그 외 → 경고 창 열고 사용자 결정 대기
   │  (pending 요청은 browser.storage.session에 저장)
   ▼
warning 창 (확장 전용 popup window)
   │  진행 / 취소
   ▼
inject.ts: 진행 → 원본 request 호출, 취소 → EIP-1193 에러 4001 throw
```

### 핵심 설계 규칙

1. **경고 UI는 페이지 안에 그리지 않는다.** 페이지 DOM에 오버레이를 그리면 변조된 JS가 자동으로 "진행"을 누를 수 있다. 반드시 `browser.windows.create({ type: 'popup' })`로 확장 전용 창을 띄운다.
2. **`core/`는 순수 함수만 둔다.** 네트워크, `browser.*`, DOM 접근을 금지한다. 요청과 화이트리스트를 입력으로 받아 Verdict 하나를 돌려준다. 브라우저 없이 vitest로 전부 테스트할 수 있어야 한다.
3. **Fail-safe 정책**: protected origin에서 분석 중 에러나 타임아웃이 나면 조용히 통과시키지 않는다. "검사 실패" 경고를 띄운다. 감시 대상이 아닌 메서드(`eth_call`, `eth_chainId` 등)는 손대지 않고 그대로 통과시킨다.
4. **주소를 지어내지 않는다.** 화이트리스트 주소는 반드시 각 DEX의 공식 문서나 deployments 저장소에서 가져오고, 엔트리마다 `source` URL을 남긴다. 확인하지 못한 주소는 `verified: false`로 두고 커밋 본문에 목록을 적는다.
5. 주소 비교는 항상 `getAddress()`로 체크섬 정규화한 뒤 한다.
6. **bigint 직렬화**: `core/` 안에서는 금액을 `bigint`로 다루고, 메시지(`postMessage`, `runtime.sendMessage`)와 `storage` 경계를 넘을 때만 10진수 문자열로 직렬화·역직렬화한다. 변환 함수는 한 곳(`core/serialize.ts`)에 둔다.
7. **타임아웃 분리**: (a) **분석 타임아웃**: 요청 전송부터 Verdict 수신까지. 넘으면 R15. (b) **사용자 결정 대기**: 경고 창이 열린 뒤에는 타임아웃을 두지 않는다. 진행/취소/창 닫기로만 끝난다. MV3 서비스 워커가 대기 중에 종료돼도 복구할 수 있도록 pending 요청(`{ id, tabId, windowId, verdict, createdAt }`)을 `browser.storage.session`에 저장하고, 워커 재시작 시 이를 읽어 응답을 이어간다.

## 7. 감시 대상 요청

| 메서드 | 처리 |
|---|---|
| `eth_sendTransaction` | `to`, `value`, `data` 디코딩 |
| `wallet_sendCalls` (EIP-5792) | `calls[]` 각각을 tx로 보고 가장 높은 위험도 채택 |
| `eth_signTypedData_v4`, `eth_signTypedData_v3` | `params[1]`(JSON 문자열 또는 객체) 파싱 후 typed data 디코딩 (v3도 v4와 같은 디코더) |
| `eth_signTypedData` (v1) | 해석하지 않음 → protected origin에서 MEDIUM (R13) |
| `personal_sign`, `eth_sign` | 내용 해석 불가 → MEDIUM (R13) |

provider 래핑 대상:
- `window.ethereum`: 이미 있으면 바로 패치하고, 아직 없으면 정의되는 시점을 잡아 패치한다.
- EIP-6963 `eip6963:announceProvider` 이벤트로 들어오는 모든 `detail.provider`
- 같은 객체를 두 번 패치하지 않도록 `WeakSet`으로 관리한다.
- 레거시 `send` / `sendAsync`도 감싼다. 최소한 감시 대상 메서드면 `request` 경로로 우회시킨다.

## 8. 디코딩 대상

### 8.1 승인 (최우선)
- tx: `approve(spender, amount)`, `increaseAllowance(spender, added)`, `setApprovalForAll(operator, approved)`
- EIP-2612 **Permit**: `primaryType: "Permit"` → `message.spender`, `message.value`
- **Permit2**: `domain.name === "Permit2"`
  - `PermitSingle` / `PermitBatch` → `message.spender`, `details[].amount`
  - `PermitTransferFrom` / `PermitBatchTransferFrom` / `PermitWitnessTransferFrom` → `message.spender`, `permitted`
  - `domain.verifyingContract`가 공식 Permit2 주소인지도 확인한다.
  - Permit2 typed data의 spender는 **해당 DEX의 `routers` + `spenders` 모두** 정상으로 인정한다. (정상 Uniswap은 `PermitSingle.spender` = UniversalRouter)
  - **UniswapX 주문** = witness가 있는 Permit2 서명. spender(reactor) 검사에 더해 witness 안의 출력 recipient를 꺼낸다(@uniswap/uniswapx-sdk 기준): `ExclusiveDutchOrder`·`PriorityOrder`는 `outputs[]`, `V2DutchOrder`·`V3DutchOrder`는 `baseOutputs[]`. recipient가 본인·`feeRecipients`가 아니면 R8, 해석하지 않는 witness 타입(`RelayOrder` 등)이나 형식 오류는 R9.
- ⚠️ approve tx의 `to`와 EIP-2612 Permit의 `verifyingContract`는 **토큰 주소**라서 토큰마다 다르다. 이 값은 화이트리스트와 비교하지 않는다. **spender만 비교한다.**

### 8.2 서명 주문
- **CoW 주문**: `domain.name === "Gnosis Protocol"`, `primaryType: "Order"` → `domain.verifyingContract`(Settlement), `message.receiver`, `sellToken`, `buyToken`, `buyAmount`
- **CoW EthFlow** (네이티브 ETH 판매): tx `to` = CoWSwapEthFlow, `createOrder(order)` calldata에서 `receiver`, `buyToken`, `buyAmount` 추출. receiver 판정은 R6과 같다.
- **CoW `setPreSignature`** (tx `to` = GPv2Settlement): 주문 UID만 있어서 내용 확인 불가 → R16 MEDIUM.

### 8.3 router 호출
진짜 router라도 수령 주소를 공격자로 바꾸면 자산이 탈취된다. 그래서 recipient까지 꺼낸다.
- Uniswap **UniversalRouter** `execute(commands, inputs[, deadline])`: command별 input에서 `recipient`, 출력 토큰, `amountOutMin`을 추출한다(V2/V3/V4 swap, SWEEP, TRANSFER, UNWRAP_WETH 등). `MSG_SENDER`·`ADDRESS_THIS` 센티널 값은 정상으로 처리한다. 정확한 값은 공식 소스(Constants.sol)에서 확인한다.
- **SwapProxy** (`execute(router, token, amount, commands, inputs, deadline)`): 내부 UR plan을 같은 방식으로 디코딩하고, `router` 인자가 화이트리스트 router인지도 확인한다.
- **SwapRouter02**: `exactInput*`/`exactOutput*`의 `recipient`, `amountOutMinimum`. `multicall` 내부 호출은 재귀로 디코딩한다.
- **최소 수령량은 호출 전체 기준으로 판단한다.** SDK는 분할 경로·네이티브 출력일 때 개별 swap의 min을 0으로 두고 마지막 `SWEEP`/`UNWRAP_WETH`(또는 `unwrapWETH9`/`sweepToken`)에서 한꺼번에 검사할 수 있다. 따라서 "사용자에게 최종으로 전달되는 단계"의 min이 0일 때만 R10이다. **07에서 확정한 내용** (출처: [universal-router-sdk `entities/actions/uniswap.ts`](https://github.com/Uniswap/sdks/blob/main/sdks/universal-router-sdk/src/entities/actions/uniswap.ts)):
  - `routerMustCustody`(3개 이상 분할 exact-in, 출력 형태 변환, 수수료, V2 exact-out 등)이면 각 swap leg는 recipient=`ADDRESS_THIS`, min=0으로 인코딩되고, 마지막 `SWEEP`/`UNWRAP_WETH`에 전체 min이 들어간다.
  - 수수료는 `PAY_PORTION`/`PAY_PORTION_FULL_PRECISION`(또는 flat fee `TRANSFER`)로 fee recipient에게 보낸다 → `feeRecipients`.
  - exact-output 거래 뒤의 잔액 환불 `SWEEP`/`UNWRAP_WETH`는 min=0이 정상이다.
  - V4: exact-in은 swap action의 `amountOutMinimum`, exact-out은 정확한 금액의 `TAKE`가 floor다. `TAKE(…, 0)`은 OPEN_DELTA(전부 수령)라서 floor가 아니다.
  - V2 exact-out swap 자체는 출력을 검사하지 않는다(floor 아님).
  - `BALANCE_CHECK_ERC20`도 집계 floor로 본다.
  - **판정**: 호출 전체(sub plan, multicall 포함)의 floor 중 최댓값을 `minAmountOut`으로 쓰고, swap이 있는데 이 값이 0일 때만 R10이다.
  - UR 2.1.1부터 swap input 끝에 `minHopPriceX36`이 추가되고, V4 swap struct 레이아웃이 바뀐다(2.0과 다름). 화이트리스트의 router `version`으로 레이아웃을 고른다. 1.2에는 V4/sub plan이 없고 0x10 이상은 NFT command다.

### 8.4 기타
- `transfer(to, amount)`, `transferFrom(from, to, amount)`
- utilities: WETH `deposit` / `withdraw`
- 나머지 calldata: `to`가 화이트리스트(routers / spenders / utilities / others)에 있는지만 판단

### 무제한 판정
`amount >= 2n ** 160n - 1n`이면 무제한으로 본다. Permit2의 uint160 max와 uint256 max를 둘 다 포함하는 기준이다.
**무제한 자체는 위험 신호가 아니다.** 정상 Uniswap도 `approve(Permit2, MAX)`가 기본값이다. 판단 기준은 "누구에게"이고, 금액은 표시용이다.

## 9. 판정 규칙 (`core/rules.ts`)

RiskLevel: `LOW` | `MEDIUM` | `HIGH`. 여러 규칙이 걸리면 가장 높은 레벨을 쓰고, `ruleIds`에는 전부 기록한다.

| # | 그룹 | 조건 | 결과 |
|---|---|---|---|
| R0 | 범위 | origin이 protected가 아님 (scoped 모드) | 통과, 로그만 |
| R1 | 승인 | spender가 해당 DEX 화이트리스트에 있음 | LOW (무제한이면 info 표시) |
| R2 | 승인 | spender가 미등록이고 amount > 0, 또는 Permit2 `verifyingContract`가 공식 Permit2가 아님 (Permit2는 routers+spenders를 등록으로 봄) | **HIGH** |
| R3 | 승인 | `setApprovalForAll(operator, true)`인데 operator가 미등록 | **HIGH** |
| R4 | 승인 | 권한 회수: `approve(x, 0)` / `setApprovalForAll(x, false)` | LOW |
| R5 | 주문 | CoW 주문의 `verifyingContract`가 미등록 | **HIGH** |
| R6 | 주문 | CoW 주문 또는 EthFlow `createOrder`의 `receiver`가 0x0도 서명자 본인도 아님 | **HIGH** |
| R16 | 주문 | CoW `setPreSignature` (주문 내용 확인 불가) | MEDIUM |
| R7 | router | `to`가 화이트리스트 router 또는 utility이고, recipient가 전부 본인·센티널·`feeRecipients`. 또는 `to`가 `others` (calldata 미해석) | LOW |
| R8 | router | `to`가 화이트리스트 router인데 recipient 중 하나가 본인이 아님. UniswapX 주문의 출력 recipient도 같음 | **HIGH** |
| R9 | router | router 호출 또는 UniswapX 주문인데 recipient 디코딩 실패 | MEDIUM ("수령 주소 확인 불가") |
| R10 | router | swap이 있는데 호출 전체의 output floor 최댓값이 0 (8.3) | MEDIUM ("슬리피지 보호 없음") |
| R11 | 기타 | 미등록 `to`(routers/spenders/utilities/others 어디에도 없음)에 calldata 또는 ETH value 전송 | **HIGH** |
| R12 | 기타 | `transfer` / `transferFrom` | MEDIUM (받는 주소 그대로 표시) |
| R13 | 기타 | 해석 불가 서명(personal_sign, eth_sign, eth_signTypedData v1), 알 수 없는 typed data | MEDIUM |
| R14 | 기타 | 현재 chainId에 화이트리스트가 없고, origin이 다른 체인 JSON에서 protected origin임 (아니면 R0) | MEDIUM ("이 네트워크는 검증 대상 아님") |
| R15 | 기타 | 분석 중 예외 | MEDIUM ("검사 실패") |

R1~R16은 R0을 통과한(=검사 대상인) 요청에만 적용되므로, R11의 HIGH는 사실상 protected origin(또는 global 모드)에서만 나온다.

**적용 순서**: R0/R14(범위) → 승인(R1~R4) → 주문(R5, R6, R16) → router(R7~R10) → 기타(R11~R13, R15). 승인류를 R11보다 먼저 판정해야 approve tx(`to` = 토큰)가 "미등록 대상"으로 오판되지 않는다.

**"미등록 주소라서 해킹"이라고 단정하지 않는다.** 경고 문구는 사실만 보여준다. 예: "등록되지 않은 주소 0xAb…12 에게 USDC 무제한 사용 권한을 줍니다."

Verdict 형태:
```ts
type Verdict = {
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  ruleIds: string[];          // ['R2']
  summary: string;            // 사람이 읽는 한 줄 (한국어)
  details: {
    origin: string;
    protected: boolean;
    method: string;
    chainId: number;
    target?: Address;         // tx to / verifyingContract
    spender?: Address;
    recipients?: Address[];
    token?: Address;
    tokenOut?: Address;
    amount?: bigint | 'UNLIMITED';   // 메시지/storage 경계에서는 문자열로 직렬화
    minAmountOut?: bigint;
    matchedDex?: string;      // 'uniswap' | 'cow'
  };
};
```

## 10. 화이트리스트 (`core/whitelist/`)

- 체인별 JSON: `1.json`(Ethereum), `11155111.json`(Sepolia)
- 스키마:
```json
{
  "chainId": 1,
  "dexes": {
    "uniswap": {
      "origins":  ["https://app.uniswap.org"],
      "routers":  [{ "address": "0x...", "label": "UniversalRouter", "source": "https://...", "verified": true }],
      "spenders": [{ "address": "0x...", "label": "Permit2", "source": "https://...", "verified": true }],
      "others":   [{ "address": "0x...", "label": "NonfungiblePositionManager", "source": "https://...", "verified": true }]
    },
    "cow": {
      "origins":  ["https://swap.cow.fi"],
      "routers":  [
        { "address": "0x...", "label": "GPv2Settlement", "source": "https://...", "verified": true },
        { "address": "0x...", "label": "CoWSwapEthFlow", "source": "https://...", "verified": true }
      ],
      "spenders": [{ "address": "0x...", "label": "GPv2VaultRelayer", "source": "https://...", "verified": true }],
      "others":   []
    }
  },
  "utilities": [{ "address": "0x...", "label": "WETH", "source": "https://...", "verified": true }]
}
```
- 대상 DEX는 **Uniswap, CoW Swap 두 개만**이다. 범위를 넓히지 않는다.
- router와 spender는 다른 경우가 많으므로 반드시 따로 수집한다.
- `feeRecipients`(선택): 공식 프론트엔드가 출력의 일부를 보내는 수수료 수령 주소(Uniswap `PAY_PORTION`/`TRANSFER` 대상 FeeCollector). router recipient 판정에서 본인·센티널과 함께 정상으로 본다. 없으면 정상 스왑이 R8로 오탐된다.
- `version`(router 엔트리, 선택): UniversalRouter 버전. command 집합(1.2는 V4 없음)과 V4 swap struct 레이아웃(2.0 vs 2.1.1+)이 버전마다 달라 디코딩에 필요하다.
- `others`: 공식 프론트엔드가 swap 외에 직접 호출하는 컨트랙트(Uniswap NonfungiblePositionManager, V4 PositionManager 등). R11 오탐을 막기 위한 것이며 calldata는 해석하지 않는다.
- CoW `routers`에는 GPv2Settlement와 CoWSwapEthFlow를 둘 다 넣는다.
- pool 주소는 수집하지 않는다. 사용자 tx는 router로 가고, pool 호출은 router 내부에서 일어난다.
- router는 **현재 공식 프론트엔드가 실제로 쓰는 모든 버전**을 넣는다(UniversalRouter 구버전·신버전, SwapRouter02 등). Uniswap 프론트엔드가 UniswapX 주문을 쓰면 Permit2 witness의 spender(reactor)도 spenders에 넣는다.
- 스키마 검증 테스트를 둔다.

## 11. 실험용 playground (`playground/`)

"변조된 dApp"을 흉내 내는 로컬 Vite 페이지(`http://localhost:5173`)다. 화면에는 항상 **"100 USDC → ETH 스왑"**이라고 표시하고, 버튼마다 실제로는 다른 요청을 보낸다.

| 시나리오 | 실제 요청 | 기대 결과 |
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

- `ATTACKER`는 의미 없는 테스트 주소 상수로 둔다.
- Sepolia 기준이고 실제 자금은 필요 없다. 확장 단계에서 차단하거나 지갑에서 거절하면 된다.
- 시나리오 정의는 `core` 테스트 fixture와 **같은 데이터**를 재사용한다.

## 12. 실험 로그

- background가 모든 판정을 `browser.storage.local`에 남긴다: `{ ts, origin, protected, mode, method, verdict, userDecision }`
- 옵션 페이지에서 JSON으로 내보낼 수 있게 한다. 리서치 4장 결과표의 원천 데이터가 된다.
- 지갑 주소는 앞뒤 4자리만 남기고 마스킹해서 저장한다.

## 13. 코딩 규칙

- TypeScript strict, `any` 금지 (불가피하면 주석으로 이유를 적는다)
- 금액은 항상 `bigint`. number 변환 금지. 메시지·storage 경계에서만 문자열 직렬화 (6장 설계 규칙 6)
- 커밋 메시지는 Conventional Commits (`feat(core): ...`, `test(core): ...`, `chore: ...`)
- **커밋 하나 = `PLAN.md`의 한 항목.** 커밋마다 `pnpm typecheck && pnpm test`가 통과해야 한다.
- 계획에 없는 기능(시뮬레이션, 가격 조회, 외부 API, 온체인 조회, 애그리게이터 지원)은 추가하지 않는다. `PLAN.md` 맨 아래 "Ideas"에 메모만 한다.
- 막히거나 계획과 다르게 가야 하면 임의로 진행하지 말고, 이유를 남기고 멈춘다.

## 14. 완료 정의 (Definition of Done)

- [ ] playground S0~S11가 기대 결과와 일치
- [ ] 실제 app.uniswap.org / swap.cow.fi에서 정상 스왑·승인 시 경고가 뜨지 않음 (오탐 0)
- [ ] MetaMask, Rabby 둘 다에서 동작 확인 (EIP-6963 경로 포함)
- [ ] `core/` 테스트 커버리지: rules 100% 분기
- [ ] 판정 로그 JSON 내보내기 동작
- [ ] README에 위협 모델, 적용 범위 정책, 한계(MAIN world 우회, 가짜 토큰 경로, 애그리게이터), 실험 재현 방법 기재
