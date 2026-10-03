# PLAN.md — 커밋 단위 개발 계획

> 규칙: 위에서부터 순서대로 진행한다. 한 항목 = 한 커밋. 각 커밋은 `pnpm typecheck && pnpm test`를 통과해야 한다.
> 완료한 항목은 `[x]`로 체크하고, 커밋 해시를 옆에 적는다.
> 세부 스펙은 `AGENTS.md`를 따른다. 규칙 번호(R0~R16)와 시나리오 번호(S0~S11)는 AGENTS.md 9장과 11장 기준이다.

---

## Phase 0. 세팅

### [x] 01 `chore: scaffold WXT + TypeScript + vitest` — ed6d093
- WXT MV3 템플릿(vanilla TS), pnpm
- 의존성: viem, zod, vitest, @vitest/coverage-v8
- 스크립트: `dev`, `build`, `typecheck`, `test`, `lint`, `playground`
- tsconfig strict, eslint + prettier
- 빈 `core/`, `playground/` 폴더와 README 뼈대
- 커버리지 설정: `core/**` 대상, `pnpm test --coverage`로 분기 커버리지 확인 가능
- **완료 기준**: `pnpm dev`로 빈 확장이 크롬에 로드되고, `pnpm test`에서 샘플 테스트 1개 통과

---

## Phase 1. core (브라우저 없이 완성)

### [x] 02 `feat(core): define types` — 6b0ccc9
- `core/types.ts`
  - `SignRequest`: method, params, chainId, from, **origin**
  - `Mode`: `'scoped' | 'global'`
  - `RiskLevel`, `Verdict` (AGENTS.md 9장 형태)
  - `DecodedAction` 유니온: `Approve | SetApprovalForAll | Permit | Permit2 | CowOrder | CowEthFlowOrder | CowPreSignature | RouterCall | RouterNoop | Utility | Other | Transfer | UnknownCall | OpaqueSign | UnknownTypedData`
- `core/serialize.ts`: Verdict·SignRequest의 bigint ↔ 10진수 문자열 변환 (메시지·storage 경계 전용) + 왕복 테스트
- **완료 기준**: typecheck 통과, 직렬화 왕복 테스트 통과

### [x] 03 `feat(core): whitelist schema and loader` — 07e1eca
- `core/whitelist/schema.ts` (zod): dexes(origins/routers/spenders/others/feeRecipients), utilities, 엔트리 `version`(선택)
- `core/whitelist/loader.ts`
  - `getWhitelist(chainId)`
  - `resolveScope(origin, chainId, mode)` → `{ protected: boolean, noWhitelist?: boolean, dex?: string, allowed: { routers, spenders, utilities, others } }`
    - scoped: origin이 일치하는 DEX의 주소 + utilities만 허용
    - global: 모든 DEX의 주소 + utilities
    - 현재 chainId JSON이 없으면: origin이 다른 체인 JSON에서 protected면 `{ protected: true, noWhitelist: true }`(→ R14), 아니면 `{ protected: false }`(→ R0)
- 주소는 `getAddress()`로 정규화해서 비교
- **완료 기준**: 더미 JSON으로 scoped/global, 일치/불일치 origin, 화이트리스트 없는 체인(protected/비protected origin) 테스트 통과

### [x] 04 `feat(core): add Uniswap & CoW whitelist for mainnet/sepolia` — c9dda93
- `1.json`, `11155111.json` 작성. 공식 문서에서만 수집하고 엔트리마다 `source` 기입
- Uniswap: 공식 프론트엔드가 쓰는 router 전 버전, Permit2, (사용 시) UniswapX reactor
- Uniswap others: 공식 프론트엔드가 swap 외에 직접 호출하는 컨트랙트 (NonfungiblePositionManager, V4 PositionManager 등)
- CoW: GPv2Settlement, CoWSwapEthFlow(routers), GPv2VaultRelayer(spenders)
- utilities: WETH
- Sepolia JSON에만 playground origin `http://localhost:5173` 추가 (uniswap·cow 양쪽 origins에 넣고, 여러 DEX에 매칭되는 origin은 합집합으로 허용)
- 확인하지 못한 주소는 `verified: false`로 두고 커밋 본문에 목록 기재
- **완료 기준**: 스키마 검증 테스트 통과. **사람이 주소를 검수한 뒤 다음 단계로** (리뷰 포인트 ①)

### [x] 05 `feat(core): decode approvals` — d4254b6
- `core/decode/approval.ts`
  - tx: approve, increaseAllowance, setApprovalForAll, Permit2 `approve(token, spender, amount, expiration)`
  - typed data: EIP-2612 Permit, Permit2 (Single/Batch/TransferFrom/BatchTransferFrom/WitnessTransferFrom)
- 무제한 판정 유틸: `amount >= 2n**160n - 1n`
- typed data 입력은 v3/v4 공통 (문자열 JSON 또는 객체 모두 허용)
- **완료 기준**: 형식별 디코딩 테스트, 실제 모양의 샘플 fixture 사용

### [x] 06 `feat(core): decode CoW orders` — e856ae7
- `core/decode/cow.ts`
  - typed data 주문: verifyingContract, receiver, sellToken, buyToken, buyAmount
  - EthFlow `createOrder(order)` calldata: receiver, buyToken, buyAmount (ABI는 cowprotocol/ethflowcontract 공식 소스에서 확인)
  - GPv2Settlement `setPreSignature(orderUid, signed)` → `CowPreSignature`
  - 주문 취소(EthFlow `invalidateOrder`, Settlement `invalidateOrder`) → `RouterNoop`
- **완료 기준**: 주문·EthFlow 각각 receiver = 0x0 / 본인 / 타인 케이스, setPreSignature 디코딩 테스트

### [x] 07 `feat(core): decode router calls` — 48cbb44
- `core/decode/router.ts`
  - UniversalRouter `execute`: command별 recipient, tokenOut, amountOutMin
  - SwapRouter02: exactInput*/exactOutput* + `multicall` 재귀
  - 센티널 값(MSG_SENDER, ADDRESS_THIS)은 공식 소스에서 확인해 상수로 정의
  - 모르는 command가 있으면 "디코딩 실패" 표시 (throw 금지)
  - 최소 수령량은 호출 전체 기준으로 계산: universal-router-sdk / router-sdk 소스에서 분할 경로·네이티브 출력 시 개별 swap min을 0으로 두고 최종 SWEEP/UNWRAP에서 검사하는지 확인하고, "최종 수령 단계의 min"을 `minAmountOut`으로 낸다. 확인 결과(소스 링크 포함)를 커밋 본문과 AGENTS.md 8.3에 반영해 R10 확정
- **완료 기준**: recipient = 본인 / 공격자 / 센티널 / 디코딩 불가, 최종 min = 0, 개별 min = 0이지만 최종 min > 0(정상) 케이스 테스트 통과

### [x] 08 `feat(core): decode misc + request dispatcher` — 5432a7a
- `core/decode/misc.ts`: transfer, transferFrom, WETH deposit/withdraw
- `core/decode/index.ts`: 메서드별 분기 (`eth_sendTransaction`, `wallet_sendCalls`, `eth_signTypedData_v4`, `eth_signTypedData_v3`, `eth_signTypedData`(v1 → `OpaqueSign`), `personal_sign`, `eth_sign`)
- `to`가 `others`면 `Other` 반환 (calldata 미해석)
- 잘못된 입력은 throw하지 않고 `UnknownCall` / `UnknownTypedData` / `OpaqueSign`으로 반환
- **완료 기준**: 메서드별 분기 테스트, 깨진 JSON·calldata 테스트

### [x] 09 `feat(core): risk rules engine` — 75ca596
- `core/rules.ts`: AGENTS.md 9장 R0~R16을 적용 순서대로 구현
  - Permit2 typed data는 해당 DEX의 routers + spenders를 spender로 인정
  - R11(미등록 `to`)은 HIGH, R14는 `resolveScope`의 `noWhitelist` 기준
- `core/analyze.ts`: `analyze(req, whitelist, mode) → Verdict` (scope 판정 → decode → rules, 예외는 R15로 감싸기)
- `wallet_sendCalls`는 call별로 판정하고 최고 레벨 채택
- 사람이 읽는 `summary` 생성 (한국어, 주소 축약)
- **완료 기준**: 규칙별 테스트, `core/rules.ts` 분기 커버리지 100% (coverage-v8로 확인)

### [x] 10 `test(core): shared scenario fixtures S0–S10` — 2c43ca6
- `core/fixtures/scenarios.ts`: AGENTS.md 11장 표를 데이터로 정의 (요청 + origin + 기대 level + 기대 ruleIds)
- 같은 fixture를 비 protected origin으로 돌리면 전부 R0이 나오는지 확인하는 테스트 추가
- **완료 기준**: 전 시나리오가 기대 결과와 일치 (리뷰 포인트 ②: 판정 로직 확정)

---

## Phase 2. 확장 연결

### [x] 11 `feat(inject): wrap EIP-1193 providers (log only)` — b5d9461
- `entrypoints/inject.content.ts` (WXT 명명 규칙) + `lib/inject/`: MAIN world, `document_start`
- `window.ethereum` + EIP-6963 announce 이벤트로 들어오는 provider 래핑, `WeakSet`으로 중복 방지, 레거시 `send`/`sendAsync` 처리
- 이 단계에서는 감시 대상 메서드를 **콘솔에 찍기만 하고** 그대로 통과
- **완료 기준**: MetaMask, Rabby에서 Uniswap 스왑 시 콘솔에 요청이 찍히고 기존 동작이 깨지지 않음

### [x] 12 `feat(bridge): inject ↔ content ↔ background messaging` — afeb878
- 요청 id(UUID)를 붙여 postMessage → runtime.sendMessage → 응답 매칭
- inject ↔ content는 document_start에 한 번만 넘긴 private `MessagePort`로 통신 (페이지가 결정 메시지를 위조하지 못하게). 직렬화는 content(ISOLATED)에서
- origin은 content script의 `location.origin`(또는 `sender.origin`)으로 붙임. 페이지가 보낸 값은 무시
- 메시지 source 검증, **분석 타임아웃** 처리 (요청 → Verdict 수신까지, 넘으면 R15)
- bigint는 `core/serialize.ts`로 직렬화해서 주고받음
- background는 `analyze()` 결과만 돌려줌 (UI 없음)
- **완료 기준**: 콘솔에 Verdict가 찍힘

### [x] 13 `feat(background): hold request until verdict` — 59b6ab5
- inject에서 감시 대상 요청을 Verdict가 올 때까지 보류
- LOW / R0 → 원본 request 호출. 그 외 → 일단 콘솔 경고 후 통과 (UI는 다음 커밋)
- chainId는 `eth_chainId`로 조회해 캐시하고, `chainChanged` 이벤트로 갱신
- **완료 기준**: 보류-재개 흐름에서 dApp이 정상 동작

### [x] 14 `feat(ui): warning popup window` — 289ff3a
- `entrypoints/warning/`: `browser.windows.create({ type: 'popup' })`
- 표시 내용: 레벨, summary, origin, 매칭된 DEX, 대상/spender/recipient, 토큰·금액, (swap이면) 출력 토큰·최소 수령량
- 버튼: **취소**(기본 포커스, Esc), 진행 (HIGH는 1.5초 뒤 활성화)
- 취소하거나 창을 닫으면 inject에서 `{ code: 4001, message: 'User rejected the request.' }` throw
- **사용자 결정 대기에는 타임아웃 없음** (분석 타임아웃과 분리). inject 쪽 분석 타임아웃은 Verdict 수신 시점에 해제
- pending 요청 `{ id, tabId, windowId, verdict, createdAt }`을 `browser.storage.session`에 저장하고, 서비스 워커 재시작 시 복구. 탭이 닫히면 정리
- **완료 기준**: MEDIUM/HIGH에서 창이 뜨고, 진행·취소·창 닫기 세 경우 모두 정상 처리. 창을 띄운 채 서비스 워커를 강제 종료(chrome://serviceworker-internals)해도 진행/취소가 정상 처리

### [x] 15 `feat(options): mode toggle + verdict log export` — 3437ee4
- 옵션 페이지: `scoped` / `global` 모드 전환 (기본 scoped)
- background에서 `{ ts, origin, protected, mode, method, verdict, userDecision }`을 storage에 저장 (주소 마스킹, bigint는 문자열 직렬화)
- 로그 목록, JSON 내보내기, 초기화
- **완료 기준**: 모드 전환이 즉시 반영되고, 시나리오를 한 바퀴 돌린 로그가 JSON으로 나옴

---

## Phase 3. 실험

### [x] 16 `feat(playground): fake compromised dApp` — 1b99ef9
- `playground/`: Vite 단일 페이지(`http://localhost:5173`), 화면 문구는 항상 "100 USDC → ETH 스왑"
- 시나리오 버튼 S0~S10, 요청 데이터는 `core/fixtures/scenarios.ts` 재사용
- **완료 기준**: 확장을 켜고 각 버튼을 누르면 기대 레벨대로 경고가 뜸

### [x] 17 `docs: README, threat model, experiment guide` — b920c26
- 용어 정의(router / spender / pool / recipient), 위협 모델, 동작 구조 그림, 판정 규칙 표
- 적용 범위 정책(scoped/global)과 그렇게 정한 이유
- **한계**: MAIN world 우회 가능성, protected origin 밖 미보호, 가짜 토큰 경로, 애그리게이터, 멀티시그, 확장 자체 변조, CoW `setPreSignature` 내용 미확인(R16), `others` calldata 미해석, `eth_signTypedData` v1 미해석
- 실험 재현 절차: 빌드 → 로드 → playground → 로그 내보내기
- 오탐 실험: 실제 app.uniswap.org / swap.cow.fi에서 정상 스왑·승인 N회
- 대조 실험: 같은 시나리오를 MetaMask 기본 경고와 Rabby에도 돌려 결과를 표로 기록
- **완료 기준**: 처음 보는 사람이 README만 보고 실험을 재현할 수 있음

---

## Phase 4. 리뷰 반영

### [x] 18 `chore(core): mark UR 2.2.0 and SwapProxy as unverified` — c95378a
- 실사이트에서 `to` 주소를 확인하기 전까지 `verified: false`. 판정에는 그대로 쓰되, 표시에 "(미검증)"을 붙인다

### [x] 19 `feat(core): decode UniswapX order recipients` — 8467bfb
- Permit2 witness 주문(ExclusiveDutch / V2Dutch / V3Dutch / Priority)의 `outputs[].recipient` 디코딩 → 본인·feeRecipients가 아니면 R8
- 디코딩할 수 없는 witness 타입(Relay 등)은 R9 MEDIUM
- S11 (UniswapX recipient = ATTACKER → HIGH R8) 추가

### [x] 20 `test(e2e): add Playwright e2e (pnpm e2e)` — 020dddf
- 스텁 지갑 + 빌드한 확장으로 경고 흐름과 playground S0–S11 검증

### [x] 21 `docs: note R10 is a bypassable heuristic` — 23b2d33

### [x] 22 `chore: add check:whitelist gate before experiments` — 719b048
- `pnpm check:whitelist`: 메인넷 JSON에 `verified: false`가 있으면 실패, Sepolia는 경고만
- 리서치 4장 실험(README 7.5·7.6) 전에 반드시 통과

### [x] 23 `feat(playground): redesign as one swap screen + attacker panel` — a1a7ec5
- 한 화면에 스왑 버튼 하나, 시나리오는 별도 "공격자 패널"에서 선택 (화면은 그대로, 요청만 바뀜)
- "이번 요청" 타임라인: 화면에 보인 것 → 실제 요청 → 기대 판정 → 결과(route-guard 차단 / 지갑까지 전달 / 지갑 거절, 추정 표시)
- 요청 중에는 버튼·패널 잠금, 실행 기록 누적. 실제 서비스 브랜딩은 쓰지 않음
- README 한계: R10은 1 wei 등으로 우회 가능한 보조 휴리스틱

---

## Phase 5. playground QA 반영 (경고창 UX)

판정 로직(rules, level, ruleIds)은 바꾸지 않는다. 표시 계층(요약 문구, 경고창, 포맷 유틸)만 수정한다.

### [x] 24 `fix(ui): pin warning buttons to the bottom` — db704eb
- 본문만 스크롤, 취소/진행 버튼은 하단 고정. 창 기본 높이 660 → 760

### [x] 25 `feat(format): show token amounts with decimals` — 59510fd
- 정적 토큰 메타데이터(`core/format/tokens.json`, 체인별 symbol·decimals). 온체인 조회 금지
- 아는 토큰은 `100 USDC`, 모르는 토큰은 주소 + "decimals 알 수 없음" + 원시값, `0x0…0`은 "ETH (네이티브)", 무제한은 "무제한"

### [x] 26 `feat(format): label sentinel recipients` — 886d8a7
- `MSG_SENDER` → "본인 (MSG_SENDER)", `ADDRESS_THIS` → "라우터 내부 보관 (ADDRESS_THIS)" (표시만)

### [x] 27 `fix(format): pick Korean particles by final consonant` — 69a389c
- 을/를, 이/가, 은/는(+ 으로/로) 선택 유틸을 summary 생성 전체에 적용. 숫자·영문은 읽는 소리로 판단, 끝의 괄호는 무시

### [x] 28 `feat(ui): show CoW sell token and amount` — c77c0f9
- 판매 토큰·금액 → 받을 토큰·최소 수령량 순서

### [x] 29 `chore(playground): add playground:unprotected for R0 checks` — e5f8c65
- `127.0.0.1`에서 띄우는 스크립트. protected origin이 아니므로 S2도 경고 없이 통과해야 정상

---

## Phase 6. 경고창 가독성 (Phase 5 후속)

판정 로직은 바꾸지 않는다. 라벨·강조 판단은 `core/format/`의 순수 함수로 둔다.

### [x] 30 `fix(format): count only MEDIUM/HIGH findings in "(외 N건)"` — 84606ff
- LOW 규칙(R1, R4, R7 …)은 개수에서 제외. `ruleIds`는 그대로

### [x] 31 `feat(ui): highlight spender and recipients` — c7253a8
- 본인/센티널/화이트리스트가 아닌 주소에 "⚠ 본인 아님" / "⚠ 미등록" 배지와 경고색, 정상 주소에는 "본인", "공식 Uniswap Permit2" 같은 라벨

### [x] 32 `feat(format): label CoW receiver 0x0 as the order owner` — 8290514
- "본인 (주문자, receiver=0x0)". 판정은 기존대로 정상

---

## Phase 7. SushiSwap · Curve · Balancer (Ethereum 메인넷 우선)

목표: Uniswap/CoW와 같은 수준(공식 주소 화이트리스트 + calldata 안의 recipient 검증). 라우터 주소만 추가하는 건 금지. 규칙 번호·판정 로직은 바꾸지 않는다. 애그리게이터는 범위 밖.

### [x] 33 `docs: research SushiSwap, Curve, Balancer contracts` — 51debd0
- `docs/protocols-phase7.md`: 공식 도메인, router·spender 주소와 버전, 스왑 함수의 recipient·minOut·출력 토큰 위치, Sepolia 여부, 한계
- 리뷰 포인트 ⑤ 결정 반영: Sushi `snwap`은 항상 R9 / Curve 풀 직접 스왑은 R11+한계 / Balancer Relayer v6는 router+R9, relayer 승인은 R3·R4 / 리다이렉트 도메인도 보호 origin

### [x] 34 `feat(core): add SushiSwap whitelist` — 4dcbd14
- origins `sushi.com`(리다이렉트), `www.sushi.com` / RedSnwapper = router·spender (메인넷·Sepolia). executor·수수료 주소는 넣지 않음
### [x] 35 `feat(core): add Curve whitelist` — bbd5e8f
- 메인넷만 (Sepolia 배포 없음). origins `curve.fi`·`www.curve.fi`·`curve.finance`(리다이렉트)·`www.curve.finance` / Router NG v1.2.0 = router·spender. 풀 주소는 넣지 않음(풀 직접 스왑은 R11·R2, 한계)
### [x] 36 `feat(core): add Balancer whitelist` — 230171d
- 메인넷·Sepolia. origins `balancer.fi`·`www.balancer.fi`(앱 실행 미확인)·`app.balancer.fi`(리다이렉트) / routers: Vault V2, V3 Router v2, V3 BatchRouter, Relayer v6 / spenders: Vault V2, Permit2, Relayer v6(relayer 승인 판정용)
### [x] 37 `feat(core): decode SushiSwap RedSnwapper calls` — 27fe02b
- `snwap` / `snwapMultiple`: recipient(들)·tokenOut·minOut 추출, 실행 경로는 항상 R9("실행 경로를 검증할 수 없는 스왑(임의 executor)", 최소 수령량 표시)
### [x] 38 `feat(core): decode Curve Router NG calls`
- `exchange` 3개 오버로드: 6인자는 `_receiver`, 4·5인자는 `msg.sender`. 출력 토큰은 Router.vy 루프와 같은 방식으로 `_route`에서 계산, minOut = `_min_dy`
### [ ] 39 `feat(core): decode Balancer V2/V3 swaps`
### [ ] 40 `test(core): Phase 7 protocol scenarios`
- 프로토콜마다 정상 LOW / recipient=ATTACKER R8 / approve(ATTACKER) R2 / 미등록 컨트랙트 R11. Sepolia 배포가 있는 프로토콜(Sushi, Balancer)만 playground S12~
### [ ] 41 `docs: README protocol table, limits, DNS hijack notes`

---

## 리뷰 포인트 (사람이 확인)

1. **04 이후**: 화이트리스트 주소를 공식 출처와 대조
2. **10 이후**: 판정 결과표가 AGENTS.md 11장 시나리오 표와 일치하는지
3. **14 이후**: 실제 지갑 두 개로 수동 테스트 (실제 Uniswap/CoW에서 오탐 없는지 포함)
4. **17 이후**: `pnpm check:whitelist` 통과 확인 후 4장 실험 진행
5. **33 이후**: `docs/protocols-phase7.md` 검토. 특히 문서 상단 "리뷰 포인트 ⑤에서 결정할 것" 4개(Sushi executor 스키마 확장, Curve 풀 직접 호출 R11 처리, Balancer Relayer 처리, 리다이렉트 origin)

---

## Ideas (범위 밖 — 메모만)

- 지갑 내부 검증 (MetaMask Snap Transaction Insights)
- 애그리게이터 지원 (1inch 등: executor, srcReceiver, minReturn 검증)
- 가짜 토큰 경로 대응 (출력 토큰 allowlist 등)
- 온체인 화이트리스트 레지스트리 (멀티시그 + 타임락): 현재 사용하지 않기로 결정
- 트랜잭션 시뮬레이션으로 잔고 변화 표시
- 지원 DEX/체인 확장
- 애그리게이터 지원 확장: Curve 레버리지가 쓰는 Enso / 0x(AllowanceHolder) / curve-solver 포함
- typed data `domain.chainId`와 현재 체인 비교
