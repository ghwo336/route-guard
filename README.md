# route-guard

**Verify what you sign, not what you see.**

변조된 DEX 프론트엔드를 가정하고, 지갑으로 가는 서명 요청을 공식 컨트랙트 화이트리스트(Uniswap, CoW Swap)와 비교해 경고하는 크롬 확장(MV3)입니다.

> 작업 중입니다. 스펙은 [AGENTS.md](AGENTS.md), 진행 계획은 [PLAN.md](PLAN.md)를 보세요.

## 개발

```sh
pnpm install
pnpm dev          # 크롬에 확장 로드 (WXT)
pnpm test         # 단위 테스트
pnpm coverage     # 커버리지
pnpm typecheck
pnpm lint
pnpm playground   # http://localhost:5173
```

## 문서 (PLAN.md 17에서 작성)

- 용어 / 위협 모델 / 동작 구조
- 판정 규칙 표, 적용 범위 정책
- 한계
- 실험 재현 절차
