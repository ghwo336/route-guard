# PLAN.md — 커밋 단위 개발 계획

> 규칙: 위에서부터 순서대로 진행한다. 한 항목 = 한 커밋. 각 커밋은 `pnpm typecheck && pnpm test`를 통과해야 한다.
> 완료한 항목은 `[x]`로 체크하고, 커밋 해시를 옆에 적는다.
> 세부 스펙은 `AGENTS.md`를 따른다. 규칙 번호(R0~R16)와 시나리오 번호(S0~S10)는 AGENTS.md 9장과 11장 기준이다.

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

### [x] 06 `feat(core): decode CoW orders`
- `core/decode/cow.ts`
  - typed data 주문: verifyingContract, receiver, sellToken, buyToken, buyAmount
  - EthFlow `createOrder(order)` calldata: receiver, buyToken, buyAmount (ABI는 cowprotocol/ethflowcontract 공식 소스에서 확인)
  - GPv2Settlement `setPreSignature(orderUid, signed)` → `CowPreSignature`
  - 주문 취소(EthFlow `invalidateOrder`, Settlement `invalidateOrder`) → `RouterNoop`
- **완료 기준**: 주문·EthFlow 각각 receiver = 0x0 / 본인 / 타인 케이스, setPreSignature 디코딩 테스트

### [ ] 07 `feat(core): decode router calls`
- `core/decode/router.ts`
  - UniversalRouter `execute`: command별 recipient, tokenOut, amountOutMin
  - SwapRouter02: exactInput*/exactOutput* + `multicall` 재귀
  - 센티널 값(MSG_SENDER, ADDRESS_THIS)은 공식 소스에서 확인해 상수로 정의
  - 모르는 command가 있으면 "디코딩 실패" 표시 (throw 금지)
  - 최소 수령량은 호출 전체 기준으로 계산: universal-router-sdk / router-sdk 소스에서 분할 경로·네이티브 출력 시 개별 swap min을 0으로 두고 최종 SWEEP/UNWRAP에서 검사하는지 확인하고, "최종 수령 단계의 min"을 `minAmountOut`으로 낸다. 확인 결과(소스 링크 포함)를 커밋 본문과 AGENTS.md 8.3에 반영해 R10 확정
- **완료 기준**: recipient = 본인 / 공격자 / 센티널 / 디코딩 불가, 최종 min = 0, 개별 min = 0이지만 최종 min > 0(정상) 케이스 테스트 통과

### [ ] 08 `feat(core): decode misc + request dispatcher`
- `core/decode/misc.ts`: transfer, transferFrom, WETH deposit/withdraw
- `core/decode/index.ts`: 메서드별 분기 (`eth_sendTransaction`, `wallet_sendCalls`, `eth_signTypedData_v4`, `eth_signTypedData_v3`, `eth_signTypedData`(v1 → `OpaqueSign`), `personal_sign`, `eth_sign`)
- `to`가 `others`면 `Other` 반환 (calldata 미해석)
- 잘못된 입력은 throw하지 않고 `UnknownCall` / `UnknownTypedData` / `OpaqueSign`으로 반환
- **완료 기준**: 메서드별 분기 테스트, 깨진 JSON·calldata 테스트

### [ ] 09 `feat(core): risk rules engine`
- `core/rules.ts`: AGENTS.md 9장 R0~R16을 적용 순서대로 구현
  - Permit2 typed data는 해당 DEX의 routers + spenders를 spender로 인정
  - R11(미등록 `to`)은 HIGH, R14는 `resolveScope`의 `noWhitelist` 기준
- `core/analyze.ts`: `analyze(req, whitelist, mode) → Verdict` (scope 판정 → decode → rules, 예외는 R15로 감싸기)
- `wallet_sendCalls`는 call별로 판정하고 최고 레벨 채택
- 사람이 읽는 `summary` 생성 (한국어, 주소 축약)
- **완료 기준**: 규칙별 테스트, `core/rules.ts` 분기 커버리지 100% (coverage-v8로 확인)

### [ ] 10 `test(core): shared scenario fixtures S0–S10`
- `core/fixtures/scenarios.ts`: AGENTS.md 11장 표를 데이터로 정의 (요청 + origin + 기대 level + 기대 ruleIds)
- 같은 fixture를 비 protected origin으로 돌리면 전부 R0이 나오는지 확인하는 테스트 추가
- **완료 기준**: 전 시나리오가 기대 결과와 일치 (리뷰 포인트 ②: 판정 로직 확정)

---

## Phase 2. 확장 연결

### [ ] 11 `feat(inject): wrap EIP-1193 providers (log only)`
- `entrypoints/inject.ts`: MAIN world, `document_start`
- `window.ethereum` + EIP-6963 announce 이벤트로 들어오는 provider 래핑, `WeakSet`으로 중복 방지, 레거시 `send`/`sendAsync` 처리
- 이 단계에서는 감시 대상 메서드를 **콘솔에 찍기만 하고** 그대로 통과
- **완료 기준**: MetaMask, Rabby에서 Uniswap 스왑 시 콘솔에 요청이 찍히고 기존 동작이 깨지지 않음

### [ ] 12 `feat(bridge): inject ↔ content ↔ background messaging`
- 요청 id(UUID)를 붙여 postMessage → runtime.sendMessage → 응답 매칭
- origin은 content script의 `location.origin`(또는 `sender.origin`)으로 붙임. 페이지가 보낸 값은 무시
- 메시지 source 검증, **분석 타임아웃** 처리 (요청 → Verdict 수신까지, 넘으면 R15)
- bigint는 `core/serialize.ts`로 직렬화해서 주고받음
- background는 `analyze()` 결과만 돌려줌 (UI 없음)
- **완료 기준**: 콘솔에 Verdict가 찍힘

### [ ] 13 `feat(background): hold request until verdict`
- inject에서 감시 대상 요청을 Verdict가 올 때까지 보류
- LOW / R0 → 원본 request 호출. 그 외 → 일단 콘솔 경고 후 통과 (UI는 다음 커밋)
- chainId는 `eth_chainId`로 조회해 캐시하고, `chainChanged` 이벤트로 갱신
- **완료 기준**: 보류-재개 흐름에서 dApp이 정상 동작

### [ ] 14 `feat(ui): warning popup window`
- `entrypoints/warning/`: `browser.windows.create({ type: 'popup' })`
- 표시 내용: 레벨, summary, origin, 매칭된 DEX, 대상/spender/recipient, 토큰·금액, (swap이면) 출력 토큰·최소 수령량
- 버튼: **취소**(기본 포커스), 진행
- 취소하거나 창을 닫으면 inject에서 `{ code: 4001, message: 'User rejected the request.' }` throw
- **사용자 결정 대기에는 타임아웃 없음** (분석 타임아웃과 분리). inject 쪽 분석 타임아웃은 Verdict 수신 시점에 해제
- pending 요청 `{ id, tabId, windowId, verdict, createdAt }`을 `browser.storage.session`에 저장하고, 서비스 워커 재시작 시 복구. 탭이 닫히면 정리
- **완료 기준**: MEDIUM/HIGH에서 창이 뜨고, 진행·취소·창 닫기 세 경우 모두 정상 처리. 창을 띄운 채 서비스 워커를 강제 종료(chrome://serviceworker-internals)해도 진행/취소가 정상 처리

### [ ] 15 `feat(options): mode toggle + verdict log export`
- 옵션 페이지: `scoped` / `global` 모드 전환 (기본 scoped)
- background에서 `{ ts, origin, protected, mode, method, verdict, userDecision }`을 storage에 저장 (주소 마스킹, bigint는 문자열 직렬화)
- 로그 목록, JSON 내보내기, 초기화
- **완료 기준**: 모드 전환이 즉시 반영되고, 시나리오를 한 바퀴 돌린 로그가 JSON으로 나옴

---

## Phase 3. 실험

### [ ] 16 `feat(playground): fake compromised dApp`
- `playground/`: Vite 단일 페이지(`http://localhost:5173`), 화면 문구는 항상 "100 USDC → ETH 스왑"
- 시나리오 버튼 S0~S10, 요청 데이터는 `core/fixtures/scenarios.ts` 재사용
- **완료 기준**: 확장을 켜고 각 버튼을 누르면 기대 레벨대로 경고가 뜸

### [ ] 17 `docs: README, threat model, experiment guide`
- 용어 정의(router / spender / pool / recipient), 위협 모델, 동작 구조 그림, 판정 규칙 표
- 적용 범위 정책(scoped/global)과 그렇게 정한 이유
- **한계**: MAIN world 우회 가능성, protected origin 밖 미보호, 가짜 토큰 경로, 애그리게이터, 멀티시그, 확장 자체 변조, CoW `setPreSignature` 내용 미확인(R16), `others` calldata 미해석, `eth_signTypedData` v1 미해석
- 실험 재현 절차: 빌드 → 로드 → playground → 로그 내보내기
- 오탐 실험: 실제 app.uniswap.org / swap.cow.fi에서 정상 스왑·승인 N회
- 대조 실험: 같은 시나리오를 MetaMask 기본 경고와 Rabby에도 돌려 결과를 표로 기록
- **완료 기준**: 처음 보는 사람이 README만 보고 실험을 재현할 수 있음

---

## 리뷰 포인트 (사람이 확인)

1. **04 이후**: 화이트리스트 주소를 공식 출처와 대조
2. **10 이후**: 판정 결과표가 AGENTS.md 11장 시나리오 표와 일치하는지
3. **14 이후**: 실제 지갑 두 개로 수동 테스트 (실제 Uniswap/CoW에서 오탐 없는지 포함)
4. **17 이후**: 4장 실험 진행

---

## Ideas (범위 밖 — 메모만)

- 지갑 내부 검증 (MetaMask Snap Transaction Insights)
- 애그리게이터 지원 (1inch 등: executor, srcReceiver, minReturn 검증)
- 가짜 토큰 경로 대응 (출력 토큰 allowlist 등)
- 온체인 화이트리스트 레지스트리 (멀티시그 + 타임락): 현재 사용하지 않기로 결정
- 트랜잭션 시뮬레이션으로 잔고 변화 표시
- 지원 DEX/체인 확장
