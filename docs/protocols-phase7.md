# Phase 7 조사: SushiSwap · Curve · Balancer (Ethereum 메인넷)

> 목적: 세 프로토콜의 **현재 공식 프론트엔드가 실제로 호출하는 컨트랙트**와 calldata 안의 받는 주소(recipient)·최소 수령량(minOut)·출력 토큰 위치를 정리한다. 화이트리스트·디코더 구현(Phase 7의 1·2단계)의 근거 문서다.
>
> 조사일: 2026-10-03. 공식 GitHub 저장소, 공식 문서, 공식 SDK, 검증된 컨트랙트 소스(Sourcify)만 사용했다. 프론트엔드 도메인은 실제 HTTP 응답(리다이렉트)으로 확인했다.
> **확인 못 한 항목은 "미확인"으로 표시했다.** 구현 시 `verified: false` 대상이다.

---

## 요약: 출발점과 달라진 점, 검토가 필요한 결정

| 프로토콜 | 출발점 가정 | 실제 확인 결과 |
|---|---|---|
| SushiSwap | V2 Router02 포크 또는 RouteProcessor `processRoute`, spender = router | **둘 다 아님.** 현재 스왑은 **RedSnwapper** `snwap(...)`. spender는 RedSnwapper. 실제 스왑은 calldata로 지정하는 **임의의 `executor`** 컨트랙트가 수행함 |
| Curve | Router NG `exchange(... _receiver)`, 풀 직접 호출 여부 확인 필요 | Router NG **v1.2.0**. 메인넷 프론트는 `_receiver` 없는 5인자 오버로드를 사용(수령인 = `msg.sender`). **풀 페이지의 Swap 탭은 풀 컨트랙트를 직접 호출함(확인됨)** |
| Balancer | V2 Vault `FundManagement`, V3 Router(Permit2, recipient = msg.sender) | **V2·V3 둘 다 사용.** 백엔드가 견적마다 더 나은 쪽을 고름. V3는 Permit2를 쓰고 recipient 파라미터가 없음(항상 `msg.sender`). V3 서명 플로우는 `permitBatchAndCall`로 스왑 calldata를 감쌈 |

### 리뷰 포인트 ⑤ 결정 (2026-10-03)

1. **SushiSwap은 executor 화이트리스트를 두지 않는다 → (B).**
   - 이유: 공식 executor라도 범용이라 calldata(`executorData`)만 바꾸면 탈취할 수 있다. 게다가 관측된 executor는 검증되지 않은 주소다.
   - **`snwap`·`snwapMultiple` 호출은 항상 R9 MEDIUM**으로 판정한다. 문구는 "실행 경로를 검증할 수 없는 스왑(임의 executor)"이고, 최소 수령량을 표시한다. recipient가 본인이 아니면 R8, 최소 수령량이 0이면 R10이 함께 걸린다.
   - RedSnwapper를 spender로 승인하는 요청(approve)은 기존대로 R1/R2로 판정한다.
   - executor `0xC10e…0fb4`와 수수료 주소 `0xFF64…a098`은 **화이트리스트에 넣지 않는다.**
   - 한계(리서치 5장용): **Sushi는 애그리게이터 구조라 recipient 검증만으로는 부족하다.**
2. **Curve 풀 직접 스왑은 R11 HIGH를 유지하고 한계로 문서화한다.**
   - 풀 직접 스왑에는 선행 `approve`(spender = 풀 또는 zap)가 필요하다. 이 spender는 미등록이므로 **approve 단계에서 R2 HIGH로 먼저 걸린다.**
3. **Balancer Relayer v6는 router로 등록하고 R9 MEDIUM으로 판정한다(A).**
   - 추가로 relayer 승인 경로를 디코딩한다.
     - tx: Vault `setRelayerApproval(address sender, address relayer, bool approved)`
     - 서명: EIP-712 typed data. domain `Balancer V2 Vault`, primaryType `SetRelayerApproval`이고 `message.calldata`에 위 호출이 들어 있다. 출처는 [b-sdk `src/entities/relayer/authorization.ts`](https://github.com/balancer/b-sdk/blob/main/src/entities/relayer/authorization.ts) `signAuthorizationFor`, [`index.ts`](https://github.com/balancer/b-sdk/blob/main/src/entities/relayer/index.ts) `signRelayerApproval`이다.
   - 판정
     - 미등록 relayer 승인(`approved = true`) → **R3 HIGH** (`setApprovalForAll`과 같은 "전체 권한 위임")
     - 승인 해제 → **R4 LOW**
     - 공식 Relayer v6 승인 → R1 LOW
   - 시나리오에 "미등록 relayer 승인 → HIGH"를 추가한다.
4. **보호 origin에 리다이렉트 도메인도 포함한다.**
   - 이유: 실제 하이재킹(2022 Curve)에서는 리다이렉트 도메인(`curve.fi`) 자체가 탈취됐다. 빼면 R0으로 통과한다.
   - 등록할 origin
     - SushiSwap: `https://sushi.com`, `https://www.sushi.com`
     - Curve: `https://curve.fi`, `https://www.curve.fi`, `https://curve.finance`, `https://www.curve.finance`
     - Balancer: `https://balancer.fi`, `https://www.balancer.fi`, `https://app.balancer.fi`
   - `https://www.curve.fi`는 결정 목록에 없었지만 같은 이유(리다이렉트 도메인)로 포함한다.
5. **미확인 항목**
   - Sushi executor와 수수료 주소는 결정 1에 따라 더 이상 필요 없다.
   - `https://www.balancer.fi`는 origin에 포함하되, 앱 실행 여부는 **미확인**으로 남긴다(봇 차단 429).

---

## 1. SushiSwap

### 1.1 공식 도메인
| origin | 확인 결과 |
|---|---|
| `https://www.sushi.com` | **앱 실행 origin.** `/ethereum/swap` → 200 |
| `https://sushi.com` | 308 → `https://www.sushi.com/` (리다이렉트만) |

### 1.2 스왑 tx의 `to` (router)
- 프론트는 router 주소를 직접 고르지 않는다. **Sushi API 응답(`tx.to`, `tx.data`)을 그대로 지갑에 보낸다.**
  - 요청: `GET https://api.sushi.com/swap/v7/{chainId}`
  - 전송 코드: `sushi-labs/sushiswap` `apps/web/src/app/(networks)/(evm)/[chainId]/(trade)/swap/_ui/simple-swap-trade-review-dialog/use-evm-simple-swap-trade-review.ts` (`const { to, gas, data, value } = trade.tx`)
- 메인넷 router 상수: **RedSnwapper `0xAC4c6e212A361c968F1725b4d055b47E63F80b75`**
  - 출처: [sushi-labs/sushi `src/evm/config/features/red-snwapper.ts`](https://github.com/sushi-labs/sushi/blob/5082d90dc76a87aaf731e9f3668384869ddf885b/src/evm/config/features/red-snwapper.ts) (`RED_SNWAPPER_ADDRESS[ETHEREUM]`)
  - 소스 검증: [Sourcify exact match](https://sourcify.dev/server/v2/contract/1/0xAC4c6e212A361c968F1725b4d055b47E63F80b75) (`contracts/RedSnwapper.sol`), 공식 문서 [docs.sushi.com/contracts/red-snwapper](https://docs.sushi.com/contracts/red-snwapper)
  - 메인넷 견적 4건(USDC→ETH, WETH→DAI, ETH→USDT, SUSHI→USDC) 모두 `tx.to = RedSnwapper`, selector `0x5f3bd1c8` (`snwap`)
- **이번 범위에서 제외하는 주소**
  - 레거시 `SushiSwapRouter` `0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F`: 웹앱에서는 V2 풀 유동성 추가·제거에만 쓰고 스왑에는 쓰지 않는다.
  - RouteProcessor 6~9: SDK v6.2.2에서 설정이 제거됐다(changelog PR #345).

### 1.3 spender
- **RedSnwapper 자신**(Permit2 아님). 출처: `sushi-labs/sushiswap` `.../swap/_ui/simple-swap-trade-button.tsx` (`contract={isRedSnwapperChainId(chainId) ? RED_SNWAPPER_ADDRESS[chainId] : undefined}`)
- 참고: SDK 문서의 allowance 예시는 RP6 주소를 보여 주는데, 이는 갱신되지 않은 문서다.

### 1.4 스왑 함수와 파라미터 위치
```solidity
// 검증된 소스 contracts/RedSnwapper.sol
function snwap(
  IERC20 tokenIn, uint amountIn, address recipient, IERC20 tokenOut,
  uint amountOutMin, address executor, bytes calldata executorData
) external payable returns (uint amountOut)                          // selector 0x5f3bd1c8

function snwapMultiple(
  InputToken[] inputTokens,   // (token, amountIn, transferTo)
  OutputToken[] outputTokens, // (token, recipient, amountOutMin)
  Executor[] executors        // (executor, value, data)
) external payable returns (uint[] amountOut)
```
| 항목 | `snwap` | `snwapMultiple` |
|---|---|---|
| recipient | 인자 2 `recipient` | 각 `outputTokens[i].recipient` |
| 출력 토큰 | 인자 3 `tokenOut` (네이티브 = `0xEeee…EEeE`) | 각 `outputTokens[i].token` |
| minOut | 인자 4 `amountOutMin` | 각 `outputTokens[i].amountOutMin` |
| **입력이 가는 곳** | **`executor` (인자 5)** | **각 `inputTokens[i].transferTo`** |

### 1.5 Sepolia
- **있음.** RedSnwapper는 같은 주소 `0xAC4c6e212A361c968F1725b4d055b47E63F80b75`에 배포되어 있다.
  - 출처: 위 SDK 파일의 `RED_SNWAPPER_ADDRESS[SEPOLIA]`, Sepolia Sourcify exact match
- Sepolia 견적 API는 동작하지 않았다(`fault filter abort`). playground 시나리오는 정적 calldata로 만들 수 있다.

### 1.6 recipient 검사가 불완전해지는 지점
1. **`recipient`는 잔고 증가만 확인하고, 실제 자금 흐름은 확인하지 않는다.**
   ```solidity
   uint initialOutputBalance = tokenOut.universalBalanceOf(recipient);
   if (amountIn > 0) tokenIn.safeTransferFrom(msg.sender, executor, amountIn);
   safeExecutor.execute{value: msg.value}(executor, executorData);
   amountOut = tokenOut.universalBalanceOf(recipient) - initialOutputBalance;
   if (amountOut < amountOutMin) revert MinimalOutputBalanceViolation(...);
   ```
2. **`executor`는 임의 주소이고, 사용자 토큰(및 ETH)이 그쪽으로 바로 간다.** `executor = 공격자`, `amountOutMin` 최소값이면 승인 금액이 전부 빠져나간다. → 결정 1
3. **`executorData` 안에 수령인이 더 있다.**
   - 실제 견적의 executor는 `0xC10eE9031F2a0B84766A86B55a8D90F357910fb4`다(**미확인**: 소스 미검증, SDK 설정 없음, API 응답에서만 관측). 호출 selector는 `0xba3f2165` = `processRouteWithTransferValueOutput(address transferValueTo, uint256 amountValueTransfer, address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOutQuote, address to, bytes route, bool takeSurplus, uint32 referralCode)`다.
   - `transferValueTo`는 수수료 수령 주소로 관측됐다: `0xFF64C2d5e23e9c48e8b42a23dc70055EEC9ea098`(**미확인**, 프론트의 기본 `feeReceiver`).
   - RouteProcessor 계열의 `route` 바이트는 hop마다 자체 목적지를 가진다.
4. `snwapMultiple`은 수령인과 `transferTo`가 여러 개다.

**구현 (결정 1)**:
- `to == RedSnwapper`이면 `recipient`(R8), `amountOutMin`(R10)을 꺼내 표시하고, **항상 R9 MEDIUM**("실행 경로를 검증할 수 없는 스왑(임의 executor)")으로 판정한다.
- `executor`와 `executorData`는 검증하지 않는다(한계).
- `snwapMultiple`은 모든 `outputTokens[].recipient`를 검사하고, 마찬가지로 R9로 판정한다.

---

## 2. Curve

### 2.1 공식 도메인
| origin | 확인 결과 |
|---|---|
| `https://www.curve.finance` | **앱 실행 origin.** `/dex/ethereum/swap` → 200 |
| `https://curve.finance` | 307 → `https://www.curve.finance/` |
| `https://curve.fi` | 301 → `https://curve.finance/` |
| `https://www.curve.fi` | 301 → `https://www.curve.finance/` |

### 2.2 스왑 tx의 `to` (router)
| 주소 | 버전 | 상태 |
|---|---|---|
| `0x45312ea0eFf7E09C83CBE249fa1d7598c4C8cd4e` | Router NG **v1.2.0** | **현재 사용** |
| `0x16C6521Dff6baB339122a0FE25a9116693265353` | Router NG v1.1.0 | 이전 버전. curve-js에서 주석 처리 |
| `0xfA9a30350048B2BF66865ee20363067c66f67e58` | 구 router | `router_deprecated` |
| `0x99a58482bd75cbab83b27ec03ca68ff489b5788f` | registry exchange | `registry_exchange_deprecated` |

출처:
- curve-js가 router를 정하는 위치: [`src/constants/network_constants.ts` 56–57행](https://github.com/curvefi/curve-js/blob/master/src/constants/network_constants.ts) (`"router": "0x45312ea0…", // v1.2.0`, 바로 위에 v1.1.0이 주석 처리)
- 프론트(curve-frontend)는 `@curvefi/api` 2.70.2를 사용하고, 이 npm 패키지에도 같은 값이 들어 있다.
- [curve-router-ng README](https://github.com/curvefi/curve-router-ng/blob/master/README.md)(Ethereum = `0x45312ea…`), [`contracts/Router.vy`](https://github.com/curvefi/curve-router-ng/blob/master/contracts/Router.vy)(`@title CurveRouter v1.2`, `version = "1.2.0"`)
- [docs.curve.finance/developer/deployments](https://docs.curve.finance/developer/deployments)

**제안**: v1.2.0만 등록한다. v1.1.0과 구 router는 현재 프론트가 쓰지 않으므로 넣지 않는다.

### 2.3 spender
- **Router 자신.** curve-js `src/router.ts`의 `swapApprove`가 `ALIASES.router`를 spender로 쓴다. Router는 일반 `transferFrom(msg.sender, self, amount)`로 토큰을 가져간다.
- **Permit2는 쓰지 않는다.** curve-js, curve-frontend, curve-router-ng 코드 검색에서 결과가 없었다.

### 2.4 스왑 함수와 파라미터 위치
```vyper
# contracts/Router.vy (v1.2.0)
def exchange(
    _route: address[11],
    _swap_params: uint256[5][5],
    _amount: uint256,
    _min_dy: uint256,
    _pools: address[5]=empty(address[5]),
    _receiver: address=msg.sender
) -> uint256:
```
Vyper 기본값 때문에 오버로드가 3개 생긴다.

| selector | 시그니처 | recipient |
|---|---|---|
| `0x371dc447` | `exchange(address[11],uint256[5][5],uint256,uint256)` | `msg.sender` |
| `0x5c9c18e2` | `exchange(address[11],uint256[5][5],uint256,uint256,address[5])` | `msg.sender` ← **메인넷 프론트가 사용** |
| `0xc872a3c5` | `exchange(address[11],uint256[5][5],uint256,uint256,address[5],address)` | 인자 6 `_receiver` |

- **minOut**: 인자 4 `_min_dy`(소스: `assert amount >= _min_dy, "Slippage"`)
- **출력 토큰**: `_route`는 토큰·풀·토큰·풀… 순서다. 마지막으로 0이 아닌 짝수 인덱스 항목(`_route[2]`, `[4]`, `[6]`, `[8]`, `[10]` 중)이 출력 토큰이다. 네이티브 ETH는 `0xEeee…EEeE`다.
- curve-js는 메인넷(OLD_CHAINS)에서 항상 `_pools`를 채우고 `_receiver`는 넘기지 않는다(`src/router.ts` 431–496행). 따라서 정상 요청은 5인자 오버로드다. **6인자 오버로드에 본인이 아닌 `_receiver`가 들어 있으면 공격 신호(R8)로 본다.**

### 2.5 풀 직접 호출 (확인됨)
- 풀 페이지의 Swap 탭은 router를 거치지 않고 **풀(또는 zap) 컨트랙트를 직접 호출**한다.
  - 프론트: `apps/main/src/dex/store/createPoolSwapSlice.ts` → curve-js `p.swap(...)`
  - curve-js: `src/pools/mixins/swapMixins.ts`에서 `contract[exchange | exchange_underlying](i, j, _amount, _minRecvAmount)`를 호출한다. 대상은 `PoolTemplate._swapContractAddress()`이고, 풀 주소이거나 일부 메타 풀의 zap이다. spender도 같은 컨트랙트다.
- **풀 호출에는 recipient 인자가 없다.** 결과물은 항상 `msg.sender`에게 간다.
- 입금과 출금도 풀을 직접 호출한다. 예외로 deposit-and-stake만 zap `0x56C526b0159a258887e0d79ec3a80dfb940d0cD7`을 거친다.
- **처리 (결정 2)**: 풀 주소는 수집하지 않는다. 풀 페이지 스왑과 유동성 작업은 **R11 HIGH**로 판정된다(오탐, 한계). 그보다 먼저 필요한 `approve(풀 또는 zap)`가 미등록 spender라 **R2 HIGH로 먼저 걸린다.**

### 2.6 Sepolia
- **없음.** curve-js 체인 맵, curve-router-ng 배포 목록, docs.curve.finance 어디에도 Ethereum Sepolia가 없다. → playground 시나리오 없이 core 테스트만 한다.

### 2.7 범위 밖
- 렌딩 레버리지(LlamaLend)는 Enso, 0x(AllowanceHolder), curve-solver 같은 외부 애그리게이터를 쓴다. 애그리게이터는 이번 범위가 아니다(PLAN Ideas).

---

## 3. Balancer

### 3.1 공식 도메인
| origin | 확인 결과 |
|---|---|
| `https://balancer.fi` | **앱 실행 origin.** 스왑은 `/swap/...` 경로다. 출처: [frontend-monorepo `packages/lib/config/projects/balancer.ts`](https://github.com/balancer/frontend-monorepo/blob/main/packages/lib/config/projects/balancer.ts) (`projectUrl: 'https://balancer.fi'`) |
| `https://app.balancer.fi` | 301 → `https://balancer.fi/pools` (리다이렉트만) |
| `https://www.balancer.fi` | 앱 실행 여부 **미확인** (봇 차단 429). 결정 4에 따라 origin에는 포함 |

### 3.2 V2 / V3 중 무엇을 쓰나
- **둘 다 쓴다.** 프론트가 `sorGetSwapPaths`를 호출하면 백엔드가 V2와 V3 견적을 모두 계산해 더 나은 쪽을 돌려준다.
  - 출처: [backend `modules/sor/sor.service.ts`](https://github.com/balancer/backend/blob/v3-canary/modules/sor/sor.service.ts) `getBestSwapPathFromBothVersions`
- 애그리게이터나 CoW 라우팅은 없다. "CoW AMM"은 풀 타입이고 스왑 경로가 아니다.

### 3.3 V2 Vault
- **주소**: `0xBA12222222228d8Ba445958a75a0704d566BF2C8` (task `20210418-vault`, ACTIVE)
  - 출처: [balancer-deployments `addresses/mainnet.json`](https://github.com/balancer/balancer-deployments/blob/master/addresses/mainnet.json)
- **spender**: V2 Vault. 출처: frontend-monorepo `packages/lib/modules/swap/useSwapSteps.tsx` (`spenderAddress: isPermit2 ? permit2Address(chain) : vaultAddress`)
- **함수**: 출처 [IVault.sol](https://github.com/balancer/balancer-v2-monorepo/blob/master/pkg/interfaces/contracts/vault/IVault.sol)
  ```solidity
  function swap(SingleSwap singleSwap, FundManagement funds, uint256 limit, uint256 deadline) payable returns (uint256);
  function batchSwap(SwapKind kind, BatchSwapStep[] swaps, IAsset[] assets, FundManagement funds,
                     int256[] limits, uint256 deadline) payable returns (int256[]);
  struct SingleSwap { bytes32 poolId; SwapKind kind; IAsset assetIn; IAsset assetOut; uint256 amount; bytes userData; }
  struct FundManagement { address sender; bool fromInternalBalance; address payable recipient; bool toInternalBalance; }
  enum SwapKind { GIVEN_IN, GIVEN_OUT }
  ```

| 항목 | `swap` | `batchSwap` |
|---|---|---|
| recipient | `funds.recipient` | `funds.recipient` |
| 토큰을 내는 쪽 | `funds.sender` (`msg.sender`가 아니면 relayer 승인 필요) | 같음 |
| 출력 토큰 | `singleSwap.assetOut` (ETH = `address(0)`) | `limits[i] < 0`인 자산 |
| minOut | GIVEN_IN: `limit` (`amountOut >= limit`) / GIVEN_OUT: `singleSwap.amount` (정확한 출력) | 출력 자산의 `-limits[i]` (`delta <= limits[i]`이고 출력 delta는 음수) |

- 프론트는 항상 `sender = recipient = 계정`, `fromInternalBalance = toInternalBalance = false`로 보낸다(`BaseDefaultSwap.handler.ts`).
- **batchSwap의 R10**: SDK가 GIVEN_IN에서 출력 자산에 `-minAmountOut`을 넣으므로, minOut은 "음수 limit의 절댓값"으로 명확히 정해진다. 이 규칙대로 R10을 적용하자고 제안한다. 다만 출력 자산이 여러 개이거나 limit이 0 이상인 비정상 구성이면 R10을 적용하지 않고, 그 이유를 주석으로 남긴다.

### 3.4 V3 (Permit2 사용, recipient = 항상 `msg.sender`)
| 컨트랙트 | 주소 | task | 상태 |
|---|---|---|---|
| Vault | `0xbA1333333333a1BA1108E8412f11850A5C319bA9` | `20241204-v3-vault` | ACTIVE |
| **Router (v2)** | `0xAE563E3f8219521950555F5962419C8919758Ea2` | `20250307-v3-router-v2` | ACTIVE |
| **BatchRouter** | `0x136f1EFcC3f8f88516B9E94110D56FDBfB1778d1` | `20241205-v3-batch-router` | ACTIVE |
| Router (v1) | `0x5C6fb490BDFD3246EB0bB062c168DeCAF4bD9FDd` | `20241205-v3-router` | DEPRECATED → 넣지 않음 |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `00000000-permit2` | — |

- 출처: 위 `addresses/mainnet.json`, [b-sdk `src/utils/balancerV3Contracts.ts`](https://github.com/balancer/b-sdk/blob/main/src/utils/balancerV3Contracts.ts)
- **스왑 함수** (b-sdk `src/entities/swap/swaps/v3/index.ts` `buildCall`)
  ```solidity
  // Router
  swapSingleTokenExactIn(address pool, IERC20 tokenIn, IERC20 tokenOut, uint256 exactAmountIn,
                         uint256 minAmountOut, uint256 deadline, bool wethIsEth, bytes userData)
  swapSingleTokenExactOut(address pool, IERC20 tokenIn, IERC20 tokenOut, uint256 exactAmountOut,
                          uint256 maxAmountIn, uint256 deadline, bool wethIsEth, bytes userData)
  // BatchRouter
  swapExactIn(SwapPathExactAmountIn[] paths, uint256 deadline, bool wethIsEth, bytes userData)
  swapExactOut(SwapPathExactAmountOut[] paths, uint256 deadline, bool wethIsEth, bytes userData)
  // SwapPathExactAmountIn { IERC20 tokenIn; SwapPathStep[] steps; uint256 exactAmountIn; uint256 minAmountOut; }
  // SwapPathStep { address pool; IERC20 tokenOut; bool isBuffer; }
  ```
- **recipient 파라미터가 없다.** [Router.sol](https://github.com/balancer/balancer-v3-monorepo/blob/main/pkg/vault/contracts/Router.sol)의 `swapSingleTokenExactIn`은 `sender: msg.sender`로 hook을 호출하고, RouterHooks의 `_sendTokenOut(params.sender, …)`가 결과물을 그 주소로 보낸다. BatchRouter도 같다. **그래서 V3는 "공식 router인가(`to`) + minOut"만 검사하면 된다.**
- **minOut과 출력 토큰**
  - Router: `minAmountOut`, `tokenOut`
  - BatchRouter: path마다 `minAmountOut`이 있고, 출력 토큰은 `steps`의 마지막 `tokenOut`
  - ExactOut은 정확한 출력이 floor다.
- **Permit2 흐름**
  1. ERC20 `approve(token → Permit2)` (`useSwapSteps.tsx`)
  2. Permit2 `PermitBatch` 서명(spender = Router 또는 BatchRouter) 또는 `Permit2.approve(token, router, …)` tx
  3. 서명했으면 스왑 calldata가 `permitBatchAndCall(PermitApproval[], bytes[], PermitBatch, bytes, bytes[] multicallData)`로 감싸져 같은 Router·BatchRouter로 간다. **디코더는 `multicallData` 안의 스왑 호출을 꺼내야 한다.**
- **화이트리스트 반영**
  - spenders: V2 Vault, Permit2
  - routers: V2 Vault, V3 Router v2, BatchRouter

  기존 규칙(R1)은 Permit2 서명에서 해당 DEX의 routers와 spenders를 spender로 인정하므로 그대로 맞는다.

### 3.5 기타 진입점
- **BalancerRelayer v6** `0x35Cea9e57A393ac66Aaa7E25C391D52C74B5648f` (task `20231031-batch-relayer-v6`, ACTIVE): 프론트가 **auraBAL 스왑에만** 쓴다. `multicall(bytes[])` 안에 BatchRelayerLibrary 호출이 중첩된다. → 결정 3: router와 spender(relayer 승인 대상)로 등록하고, multicall은 해석하지 않아 R9로 판정한다.
- **relayer 승인**: Vault `setRelayerApproval(sender, relayer, approved)` tx와 EIP-712 서명(위 결정 3)을 디코딩한다. 미등록 relayer 승인은 R3, 해제는 R4다.
- 폐기된 relayer v1~v5와 V3 Router v1은 넣지 않는다.
- Native/LST wrap 스왑은 토큰 컨트랙트를 직접 호출한다. 주소는 미확인이고 이번 범위 밖이다.

### 3.6 Sepolia
- **있음** ([`addresses/sepolia.json`](https://github.com/balancer/balancer-deployments/blob/master/addresses/sepolia.json))

| 컨트랙트 | 주소 | 상태 |
|---|---|---|
| V2 Vault | `0xBA12222222228d8Ba445958a75a0704d566BF2C8` | ACTIVE |
| V3 Vault | `0xbA1333333333a1BA1108E8412f11850A5C319bA9` | ACTIVE |
| V3 Router (v2) | `0x5e315f96389C1aaF9324D97d3512ae1e0Bf3C21a` | ACTIVE |
| V3 BatchRouter | `0xC85b652685567C1B074e8c0D4389f83a2E458b1C` | ACTIVE |
| BalancerRelayer v6 | `0x7852fB9d0895e6e8b3EedA553c03F6e2F9124dF9` | ACTIVE |

→ playground 시나리오(S12~)를 추가할 수 있다.

---

## 4. 기존 규칙과의 매핑 (구현 시)

| 상황 | Sushi | Curve | Balancer | 규칙 |
|---|---|---|---|---|
| 공식 router, 수령인 본인, minOut > 0 | — (`snwap`은 항상 R9) | `exchange` 4·5인자 오버로드, 6인자에서 `_receiver` = 본인 | V2 `funds.recipient` = 본인 / V3 전부 | R7 LOW |
| 수령인이 본인 아님 | `recipient` | `_receiver` | V2 `funds.recipient` | R8 HIGH |
| 수령인·실행 경로 확인 불가 | **`snwap`·`snwapMultiple` 전부(결정 1)**, 모르는 selector | 모르는 selector | Relayer multicall, 모르는 selector | R9 MEDIUM |
| minOut = 0 | `amountOutMin` | `_min_dy` | `limit` / `-limits` / `minAmountOut` | R10 MEDIUM |
| `approve(공격자, MAX)` | spender ≠ RedSnwapper | spender ≠ router | spender ∉ {V2 Vault, Permit2} | R2 HIGH |
| 미등록 컨트랙트로 스왑 | `to` ≠ RedSnwapper | `to` ≠ router (**풀 직접 호출 포함, 결정 2**) | `to` ∉ {Vault, Router, BatchRouter} | R11 HIGH |

| 미등록 relayer 승인 (Balancer) | — | — | `setRelayerApproval(…, 미등록, true)` tx 또는 서명 | R3 HIGH (해제는 R4) |

규칙 번호는 바꾸지 않는다. Sushi의 "항상 R9"와 Balancer relayer 승인(R3/R4)은 결정 1·3에 따라 기존 규칙에 매핑한 것이다.

## 5. 미확인 목록
- `https://www.balancer.fi`: 앱 실행 여부 미확인(429). origin에는 포함(결정 4).
- (결정 1로 불필요해짐) SushiSwap executor `0xC10eE9031F2a0B84766A86B55a8D90F357910fb4`, 수수료 수령 주소 `0xFF64C2d5e23e9c48e8b42a23dc70055EEC9ea098`: 화이트리스트에 넣지 않는다.
- Balancer 배포 바이트코드가 `main` 브랜치 인터페이스와 정확히 일치하는지는 확인하지 않았다(시그니처는 공식 SDK·인터페이스 기준).
- Curve 운영 사이트 번들이 curve-js 2.70.2와 같은지는 확인하지 않았다(저장소와 npm 기준).

---

## 6. Phase 8 조사: 공식 router 경로 안의 임의 풀 (2026-10-03)

> 재현 테스트: [core/gaps.test.ts](../core/gaps.test.ts). "KNOWN GAP" 테스트는 **현재의 안전하지 않은 판정을 고정**해 둔 것이다. 대응을 구현할 때 의도적으로 뒤집는다.

### 6.1 Curve Router NG: 확인됨

[`contracts/Router.vy`](https://github.com/curvefi/curve-router-ng/blob/master/contracts/Router.vy) `exchange` (v1.2.0)의 동작:
```vyper
assert ERC20(input_token).transferFrom(msg.sender, self, amount, default_return_value=True)   # 사용자 → router
for i in range(5):
    swap: address = _route[i * 2 + 1]                 # 풀 주소: calldata 그대로, 검증 없음
    output_token = _route[(i + 1) * 2]
    output_token_initial_balance = ERC20(output_token).balanceOf(self)
    if not self.is_approved[input_token][swap]:
        assert ERC20(input_token).approve(swap, max_value(uint256), ...)   # 임의 주소에 무제한 승인
        self.is_approved[input_token][swap] = True
    ...
    StablePool(swap).exchange(i, j, amount, 0)       # 임의 컨트랙트 호출, 풀 단위 min = 0
    amount = 잔고 변화량
...
assert amount >= _min_dy, "Slippage"                  # 최종 출력만 검사
```
- **결론**: `_route`의 풀 자리에 공격자 컨트랙트를 넣으면, router가 그 컨트랙트에 입력 토큰을 **무제한 승인**하고 `exchange`를 호출한다. 가짜 풀은 입력을 전부 가져가고 진짜 WETH 1 wei만 돌려주면 된다. `_min_dy = 1`이면 통과한다.
- **현재 판정**: 공식 router(R11 아님) + 수령인 본인(R8 아님) + min_dy > 0(R10 아님)이라 **LOW(R7)**다. 경고창에도 "받을 토큰 WETH"로 정상처럼 보인다.
- **피해 범위**: 이번 tx의 `_amount`다. `_amount`도 calldata라 사용자 잔고 전체로 설정할 수 있다. router에 남는 무제한 승인은 router가 tx 사이에 자금을 보유하지 않으므로 추가 피해는 거의 없다.

### 6.2 Balancer: 풀 등록은 누구나 할 수 있지만 정산은 Vault가 한다

- **누구나 풀 등록 가능**
  - V2 [`PoolRegistry.registerPool`](https://github.com/balancer/balancer-v2-monorepo/blob/master/pkg/vault/contracts/PoolRegistry.sol): 접근 제어가 없다. `poolId`는 `msg.sender`(풀 컨트랙트)에서 만들어진다.
  - V3 [`VaultExtension.registerPool`](https://github.com/balancer/balancer-v3-monorepo/blob/main/pkg/vault/contracts/VaultExtension.sol): 파일 주석이 "permissionless functions"이고, 검증은 토큰 구성만 한다.
- **정산 구조가 Curve와 다르다**
  - 사용자가 승인한 대상은 Vault(V2)나 Permit2→Router(V3)다. 풀에는 **승인이 넘어가지 않는다.**
  - Vault는 GIVEN_IN의 `amount`(V3는 `exactAmountIn`)만 가져가고, 출력이 `limit`(`minAmountOut`) 이상인지 확인한다.
  - 악성 풀은 수학(hook 포함)으로 출력을 최소로 만든 뒤, 자기 Vault 잔고에 쌓인 입력을 유동성 제거로 빼낼 수 있다.
- **결론**: 피해는 "이번 tx의 입력량 − 최소 수령량"으로 제한된다. Curve처럼 임의 컨트랙트에 승인이 넘어가지는 않는다. 하지만 **min을 1 wei로 두면 결과적으로 입력 전체를 잃는다는 점은 같다.** 재현 결과, 현재 LOW(R7)이다.

### 6.3 이건 "최소 수령량이 의미 없이 작다"는 문제다 (R10 한계)

Curve, Balancer, Uniswap 모두 공통으로, 공격자가 경로(풀·hook·가짜 토큰)를 고르고 min을 1 wei로 두면 입력을 잃는다.
- Uniswap V2·V3 풀은 factory로 주소가 정해져 임의 코드가 아니다. 하지만 공격자가 만든 가짜 토큰 풀이나 불균형 풀을 거치면 같은 결과다(README "가짜 토큰 경로").
- Uniswap V4는 PoolKey에 **임의 hook 주소**가 들어가므로 같은 종류의 문제가 있다.

근본 대응은 "시세 대비 min이 적정한가"인데, 가격 조회를 하지 않는 정책이라 판단할 수 없다(README: "R10은 1 wei 등으로 우회 가능한 보조 휴리스틱"). 아래 선택지는 **"임의 코드 풀"이라는 가장 쉬운 경로를 막는 것**이다.

### 6.4 대응 선택지 (Curve)

**Curve API 풀 규모** (`https://api.curve.finance/v1/getPools/{registry}/ethereum`, 2026-10-03 조회, 총 2,477개)

| registry | 풀 수 | TVL ≥ $100K | TVL < $1K | 배포 |
|---|---|---|---|---|
| main | 49 | 23 | 4 | Curve 팀 큐레이션 |
| crypto | 8 | 4 | 3 | Curve 팀 큐레이션 |
| factory | 381 | 26 | 298 | **누구나 배포** (공식 구현 코드) |
| factory-crypto | 401 | 14 | 340 | 누구나 배포 |
| factory-stable-ng | 1,065 | 130 | 798 | 누구나 배포 |
| factory-twocrypto | 419 | 27 | 356 | 누구나 배포 |
| factory-tricrypto | 125 | 8 | 103 | 누구나 배포 |

**(A) Curve 공식 API 풀 목록의 정적 스냅샷을 화이트리스트로 쓴다**
- `_route`의 모든 풀이 스냅샷에 있을 때만 R7, 아니면 R9 또는 R11. 스냅샷은 체인별로 저장하고 출처 URL과 날짜를 기록한다. 런타임 조회는 없다(정책 유지).
- **막을 수 있는 것**: 임의 코드 컨트랙트(진짜 가짜 풀). 6.1의 재현 시나리오가 여기에 해당한다.
- **못 막는 것**: factory 풀은 공식 코드지만 **누구나 배포하고 유동성을 넣을 수 있다.** 공격자가 만든 불균형 factory 풀 + min 1 wei는 여전히 통과한다. "전체 2,477개"를 넣으면 이 경로가 열려 있다. "TVL ≥ $100K"(약 232개)로 거르면 많이 줄지만, TVL은 시점에 따라 변하고 새 풀이나 작은 풀을 쓰는 정상 스왑이 경고된다.
- 비용: 풀 목록 갱신 절차가 필요하다(`pnpm check:whitelist`와 같은 출처·날짜 관리).

**(B) Router NG `exchange`를 Sushi처럼 항상 R9 MEDIUM으로 판정한다**
- 구현이 단순하고 우회 여지가 없다.
- 대가: **Curve 메인 Swap 페이지의 모든 정상 스왑이 구조적 오탐(MEDIUM)**이 된다. 지금은 LOW다.

**(C) 절충**: 스냅샷(main + crypto + TVL 기준을 넘는 factory)에 있는 풀만 R7로 판정하고, 하나라도 없으면 R9로 판정한다.
- 정상 사용자의 대부분은 유동성 큰 풀을 지나므로 LOW로 남는다.
- 임의 코드 풀과 작은 factory 풀 경로는 MEDIUM이 된다.
- 기준(TVL 임계값, 갱신 주기)을 정해야 한다.

**추천은 (C)다.** (B)는 안전하지만 Curve 정상 사용 전체를 MEDIUM으로 만들어 경고 피로를 키운다. (A)를 전체 목록으로 하면 factory 풀 경로가 그대로 열린다. 어느 쪽이든 "min 1 wei" 문제는 남으므로(6.3) 한계 문서는 그대로 둔다.

### 6.5 Balancer 제안

- Curve와 달리 임의 컨트랙트에 승인이 넘어가지 않으므로 **현재 판정을 유지하고 한계로 문서화**하는 걸 제안한다.
- 같은 수준의 방어를 원하면 Curve (C)와 같은 방식(Balancer API 풀 스냅샷 + 미등록 풀 R9)을 적용할 수 있다.
  - V2는 `poolId`(풀 주소 포함), V3는 `pool` 주소와 BatchRouter `steps[].pool`이 calldata에 있으므로 디코딩은 가능하다.
- V3 hook도 풀 등록 시 지정되는 임의 컨트랙트다. 풀 스냅샷을 쓰면 hook도 그 풀의 일부로 같이 신뢰하게 된다.

### 6.6 결정이 필요한 것

1. Curve: (A) 전체 스냅샷 / (B) 항상 R9 / **(C) 스냅샷 + 미등록 풀 R9 (추천)**. (C)라면 TVL 임계값과 갱신 주기
2. Balancer: 한계로 문서화만 (추천) / Curve와 같은 스냅샷 방식
3. Uniswap V4 hook(임의 코드)을 같은 관점에서 다룰지 (지금은 hook을 검사하지 않음)
