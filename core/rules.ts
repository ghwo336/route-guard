import { getAddress, type Address } from 'viem';
import { isSentinel } from './decode/router';
import { isUnlimited, sameAddress, ZERO_ADDRESS } from './decode/util';
import { describeAddress, describeAmount, shortAddress } from './format';
import type { Amount, DecodedAction, RiskLevel, RuleId, VerdictDetails } from './types';
import { lookup, type AllowedSet } from './whitelist/loader';

export type RuleHit = {
  ruleId: RuleId;
  level: RiskLevel;
  message: string;
};

export type ActionResult = {
  hits: RuleHit[];
  /** LOW with no rule hit at all (e.g. a normal CoW order). */
  summary?: string;
  details: Partial<VerdictDetails>;
};

export type RuleContext = {
  allowed: AllowedSet;
  signer?: Address;
};

const LEVEL_RANK: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export function maxLevel(levels: RiskLevel[]): RiskLevel {
  return levels.reduce<RiskLevel>((m, l) => (LEVEL_RANK[l] > LEVEL_RANK[m] ? l : m), 'LOW');
}

export function compareRuleIds(a: RuleId, b: RuleId): number {
  return Number(a.slice(1)) - Number(b.slice(1));
}

/** Most severe first, then by rule number. */
export function byRisk(a: RuleHit, b: RuleHit): number {
  return LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || compareRuleIds(a.ruleId, b.ruleId);
}

const amountOf = (a: bigint): Amount => (isUnlimited(a) ? 'UNLIMITED' : a);

const has = (m: ReadonlyMap<Address, unknown>, a: Address | undefined) =>
  a !== undefined && m.has(getAddress(a));

function permit2Addresses(allowed: AllowedSet): Address[] {
  return [...allowed.spenders.values()].filter((e) => e.label === 'Permit2').map((e) => e.address);
}

function dexOf(allowed: AllowedSet, a: Address | undefined): string | undefined {
  return lookup(allowed, a)?.entry.dex;
}

// ---------------------------------------------------------------------------
// R1-R4: approvals
// ---------------------------------------------------------------------------

function grant(
  ctx: RuleContext,
  o: {
    spender: Address;
    token: Address;
    amount: bigint;
    /** Permit2 permits/approvals also accept the DEX routers as spenders. */
    allowRouters: boolean;
    revocable: boolean;
  },
): RuleHit {
  const { allowed } = ctx;
  const amt = describeAmount(amountOf(o.amount));
  const who = describeAddress(o.spender, allowed);
  const token = shortAddress(o.token);
  if (o.revocable && o.amount === 0n) {
    return {
      ruleId: 'R4',
      level: 'LOW',
      message: `${who}의 토큰 ${token} 사용 권한을 회수합니다.`,
    };
  }
  const known =
    has(allowed.spenders, o.spender) || (o.allowRouters && has(allowed.routers, o.spender));
  if (known) {
    return {
      ruleId: 'R1',
      level: 'LOW',
      message: `공식 주소 ${who}에게 토큰 ${token} ${amt} 사용 권한을 줍니다.`,
    };
  }
  return {
    ruleId: 'R2',
    level: 'HIGH',
    message: `등록되지 않은 주소 ${who}에게 토큰 ${token} ${amt} 사용 권한을 줍니다.`,
  };
}

// ---------------------------------------------------------------------------

function recipientsCheck(
  ctx: RuleContext,
  recipients: Address[],
): { bad: Address[]; unverifiable: boolean } {
  const bad: Address[] = [];
  let unverifiable = false;
  for (const r of recipients) {
    if (isSentinel(r) || has(ctx.allowed.feeRecipients, r)) continue;
    if (ctx.signer === undefined) {
      unverifiable = true;
      continue;
    }
    if (!sameAddress(r, ctx.signer)) bad.push(r);
  }
  return { bad, unverifiable };
}

function unregisteredTo(ctx: RuleContext, to: Address, what: string): RuleHit {
  return {
    ruleId: 'R11',
    level: 'HIGH',
    message: `등록되지 않은 컨트랙트 ${shortAddress(to)}에 ${what}을(를) 보냅니다.`,
  };
}

/** Apply R1-R16 to one decoded action. Order follows AGENTS.md 9장. */
export function evaluateAction(action: DecodedAction, ctx: RuleContext): ActionResult {
  const { allowed } = ctx;
  switch (action.kind) {
    case 'approve': {
      const isPermit2 = action.fn === 'permit2Approve';
      const hits = [
        grant(ctx, {
          spender: action.spender,
          token: action.token,
          amount: action.amount,
          allowRouters: isPermit2,
          revocable: true,
        }),
      ];
      if (isPermit2 && !permit2Addresses(allowed).some((p) => sameAddress(p, action.to))) {
        hits.push({
          ruleId: 'R2',
          level: 'HIGH',
          message: `공식 Permit2가 아닌 컨트랙트 ${shortAddress(action.to)}에 Permit2 형식의 승인을 보냅니다.`,
        });
      }
      return {
        hits,
        details: {
          target: action.to,
          spender: action.spender,
          token: action.token,
          amount: amountOf(action.amount),
          matchedDex: dexOf(allowed, action.spender),
        },
      };
    }

    case 'setApprovalForAll': {
      const who = describeAddress(action.operator, allowed);
      const collection = shortAddress(action.to);
      let hit: RuleHit;
      if (!action.approved) {
        hit = {
          ruleId: 'R4',
          level: 'LOW',
          message: `${who}의 컬렉션 ${collection} 전체 권한을 회수합니다.`,
        };
      } else if (has(allowed.spenders, action.operator)) {
        hit = {
          ruleId: 'R1',
          level: 'LOW',
          message: `공식 주소 ${who}에게 컬렉션 ${collection} 전체 권한을 줍니다.`,
        };
      } else {
        hit = {
          ruleId: 'R3',
          level: 'HIGH',
          message: `등록되지 않은 주소 ${who}에게 컬렉션 ${collection}의 모든 NFT 권한을 줍니다.`,
        };
      }
      return {
        hits: [hit],
        details: {
          target: action.to,
          spender: action.operator,
          token: action.to,
          matchedDex: dexOf(allowed, action.operator),
        },
      };
    }

    case 'permit': {
      const token = action.verifyingContract;
      const hit = grant(ctx, {
        spender: action.spender,
        token: token ?? ZERO_ADDRESS,
        amount: action.amount,
        allowRouters: false,
        revocable: true,
      });
      return {
        hits: [hit],
        details: {
          target: token,
          spender: action.spender,
          token,
          amount: amountOf(action.amount),
          matchedDex: dexOf(allowed, action.spender),
        },
      };
    }

    case 'permit2': {
      const total = action.permitted.reduce((s, p) => s + p.amount, 0n);
      const first = action.permitted[0]!;
      const hits = [
        grant(ctx, {
          spender: action.spender,
          token: first.token,
          amount: action.permitted.length === 1 ? first.amount : total,
          allowRouters: true,
          revocable: true,
        }),
      ];
      if (!permit2Addresses(allowed).some((p) => sameAddress(p, action.verifyingContract))) {
        const vc = action.verifyingContract ? shortAddress(action.verifyingContract) : '(없음)';
        hits.push({
          ruleId: 'R2',
          level: 'HIGH',
          message: `서명 대상(verifyingContract ${vc})이 공식 Permit2가 아닙니다.`,
        });
      }
      const w = action.witness;
      if (w) {
        const name = w.orderType ?? 'witness';
        if (w.error !== undefined || w.recipients === undefined) {
          hits.push({
            ruleId: 'R9',
            level: 'MEDIUM',
            message: `UniswapX 주문(${name})의 받는 주소를 확인할 수 없습니다 (${w.error ?? '수령 주소 없음'}).`,
          });
        } else {
          const { bad, unverifiable } = recipientsCheck(ctx, w.recipients);
          if (bad.length > 0) {
            hits.push({
              ruleId: 'R8',
              level: 'HIGH',
              message: `UniswapX 주문(${name})의 결과물 일부를 본인이 아닌 ${bad.map(shortAddress).join(', ')}가 받습니다.`,
            });
          }
          if (unverifiable) {
            hits.push({
              ruleId: 'R9',
              level: 'MEDIUM',
              message: '수령 주소를 확인할 수 없습니다.',
            });
          }
        }
      }
      return {
        hits,
        details: {
          target: action.verifyingContract,
          spender: action.spender,
          token: first.token,
          amount: amountOf(first.amount),
          recipients: w?.recipients,
          tokenOut: w?.tokenOut,
          minAmountOut: w?.minAmountOut,
          matchedDex: dexOf(allowed, action.spender),
        },
      };
    }

    case 'cowOrder': {
      const hits: RuleHit[] = [];
      if (!has(allowed.routers, action.verifyingContract)) {
        const vc = action.verifyingContract ? shortAddress(action.verifyingContract) : '(없음)';
        hits.push({
          ruleId: 'R5',
          level: 'HIGH',
          message: `CoW 주문의 정산 컨트랙트(${vc})가 공식 GPv2Settlement가 아닙니다.`,
        });
      }
      if (
        !sameAddress(action.receiver, ZERO_ADDRESS) &&
        !sameAddress(action.receiver, ctx.signer)
      ) {
        hits.push({
          ruleId: 'R6',
          level: 'HIGH',
          message: `CoW 주문의 결과물을 본인이 아닌 ${shortAddress(action.receiver)}가 받습니다.`,
        });
      }
      return {
        hits,
        summary: `CoW 주문: 토큰 ${shortAddress(action.sellToken)} → ${shortAddress(action.buyToken)}, 수령인 본인.`,
        details: {
          target: action.verifyingContract,
          recipients: [action.receiver],
          token: action.sellToken,
          tokenOut: action.buyToken,
          minAmountOut: action.buyAmount,
          matchedDex: dexOf(allowed, action.verifyingContract),
        },
      };
    }

    case 'cowEthFlowOrder': {
      const hits: RuleHit[] = [];
      if (!has(allowed.routers, action.to)) hits.push(unregisteredTo(ctx, action.to, 'ETH 주문'));
      if (
        !sameAddress(action.receiver, ZERO_ADDRESS) &&
        !sameAddress(action.receiver, ctx.signer)
      ) {
        hits.push({
          ruleId: 'R6',
          level: 'HIGH',
          message: `CoW ETH 주문의 결과물을 본인이 아닌 ${shortAddress(action.receiver)}가 받습니다.`,
        });
      }
      return {
        hits,
        summary: `CoW ETH 주문: ETH → 토큰 ${shortAddress(action.buyToken)}, 수령인 본인.`,
        details: {
          target: action.to,
          recipients: [action.receiver],
          tokenOut: action.buyToken,
          amount: action.sellAmount,
          minAmountOut: action.buyAmount,
          matchedDex: dexOf(allowed, action.to),
        },
      };
    }

    case 'cowPreSignature': {
      const hit: RuleHit = has(allowed.routers, action.to)
        ? {
            ruleId: 'R16',
            level: 'MEDIUM',
            message:
              'CoW 주문을 tx로 사전 서명합니다. 주문 내용(받는 주소 등)은 여기서 확인할 수 없습니다.',
          }
        : unregisteredTo(ctx, action.to, '주문 사전 서명');
      return { hits: [hit], details: { target: action.to, matchedDex: dexOf(allowed, action.to) } };
    }

    case 'routerNoop': {
      const hit: RuleHit = has(allowed.routers, action.to)
        ? {
            ruleId: 'R7',
            level: 'LOW',
            message: `공식 컨트랙트 ${describeAddress(action.to, allowed)}에서 주문을 취소합니다.`,
          }
        : unregisteredTo(ctx, action.to, '주문 취소');
      return { hits: [hit], details: { target: action.to, matchedDex: dexOf(allowed, action.to) } };
    }

    case 'routerCall': {
      const hits: RuleHit[] = [];
      const details: Partial<VerdictDetails> = {
        target: action.to,
        recipients: action.recipients,
        tokenOut: action.tokenOut,
        minAmountOut: action.minAmountOut,
        matchedDex: dexOf(allowed, action.to),
      };
      if (!has(allowed.routers, action.to)) hits.push(unregisteredTo(ctx, action.to, 'swap 호출'));
      if (action.innerRouter !== undefined && !has(allowed.routers, action.innerRouter)) {
        hits.push({
          ruleId: 'R11',
          level: 'HIGH',
          message: `SwapProxy가 등록되지 않은 router ${shortAddress(action.innerRouter)}로 전달합니다.`,
        });
      }
      const { bad, unverifiable } = recipientsCheck(ctx, action.recipients);
      if (bad.length > 0) {
        hits.push({
          ruleId: 'R8',
          level: 'HIGH',
          message: `swap 결과물 일부를 본인이 아닌 ${bad.map(shortAddress).join(', ')}가 받습니다.`,
        });
      }
      if (action.decodeError !== undefined || unverifiable) {
        hits.push({
          ruleId: 'R9',
          level: 'MEDIUM',
          message: `수령 주소를 확인할 수 없습니다${action.decodeError ? ` (${action.decodeError})` : ''}.`,
        });
      }
      if (action.hasSwap && action.minAmountOut === 0n) {
        hits.push({
          ruleId: 'R10',
          level: 'MEDIUM',
          message: '최소 수령량이 0입니다 (슬리피지 보호 없음).',
        });
      }
      if (hits.length === 0) {
        hits.push({
          ruleId: 'R7',
          level: 'LOW',
          message: `공식 router ${describeAddress(action.to, allowed)} 호출, 수령인 본인.`,
        });
      }
      return { hits, details };
    }

    case 'utility': {
      const hit: RuleHit = has(allowed.utilities, action.to)
        ? {
            ruleId: 'R7',
            level: 'LOW',
            message: `${describeAddress(action.to, allowed)} ${action.fn} ${action.amount}.`,
          }
        : unregisteredTo(ctx, action.to, `${action.fn} 호출`);
      return { hits: [hit], details: { target: action.to, amount: action.amount } };
    }

    case 'other':
      return {
        hits: [
          {
            ruleId: 'R7',
            level: 'LOW',
            message: `공식 컨트랙트 ${describeAddress(action.to, allowed)} 호출 (내용은 해석하지 않음).`,
          },
        ],
        details: { target: action.to, matchedDex: dexOf(allowed, action.to) },
      };

    case 'transfer':
      return {
        hits: [
          {
            ruleId: 'R12',
            level: 'MEDIUM',
            message: `토큰 ${shortAddress(action.to)} ${action.amount}을(를) ${describeAddress(action.recipient, allowed)}에게 직접 보냅니다.`,
          },
        ],
        details: {
          target: action.to,
          token: action.to,
          recipients: [action.recipient],
          amount: amountOf(action.amount),
        },
      };

    case 'unknownCall': {
      const details: Partial<VerdictDetails> = { target: action.to, amount: action.value };
      if (action.to === undefined) {
        return {
          hits: [
            {
              ruleId: 'R11',
              level: 'HIGH',
              message: `대상 주소가 없는 트랜잭션입니다 (${action.reason ?? '형식 오류'}).`,
            },
          ],
          details,
        };
      }
      const known = lookup(allowed, action.to);
      if (known && known.role !== 'feeRecipients') {
        details.matchedDex = known.entry.dex;
        if (!action.hasData) {
          return {
            hits: [
              {
                ruleId: 'R7',
                level: 'LOW',
                message: `공식 컨트랙트 ${describeAddress(action.to, allowed)}에 ETH ${action.value}을(를) 보냅니다.`,
              },
            ],
            details,
          };
        }
        return {
          hits: [
            {
              ruleId: 'R9',
              level: 'MEDIUM',
              message: `공식 컨트랙트 ${describeAddress(action.to, allowed)} 호출 내용을 해석할 수 없습니다${action.reason ? ` (${action.reason})` : ''}.`,
            },
          ],
          details,
        };
      }
      if (action.hasData || action.value > 0n) {
        return {
          hits: [
            unregisteredTo(ctx, action.to, action.hasData ? '호출 데이터' : `ETH ${action.value}`),
          ],
          details,
        };
      }
      return { hits: [], summary: `${shortAddress(action.to)}에 빈 트랜잭션을 보냅니다.`, details };
    }

    case 'opaqueSign':
      return {
        hits: [
          {
            ruleId: 'R13',
            level: 'MEDIUM',
            message: `내용을 해석할 수 없는 서명 요청입니다 (${action.method}).`,
          },
        ],
        details: {},
      };

    case 'unknownTypedData':
      return {
        hits: [
          {
            ruleId: 'R13',
            level: 'MEDIUM',
            message: `알 수 없는 형식의 서명 요청입니다${action.primaryType ? ` (${action.domainName ?? '?'} / ${action.primaryType})` : ''}.`,
          },
        ],
        details: { target: action.verifyingContract },
      };
  }
}
