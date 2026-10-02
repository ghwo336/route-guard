import type { Address } from 'viem';
import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import { ATTACKER, TOKENS, USER } from './fixtures/addresses';
import * as c from './fixtures/calldata';
import * as r from './fixtures/router';
import {
  cowOrder,
  eip2612Permit,
  permit2Batch,
  permit2Single,
  uniswapXOrder,
} from './fixtures/typedData';
import { wl } from './fixtures/whitelist';
import { byRisk, evaluateAction, maxLevel } from './rules';
import type { DecodedAction, SignRequest } from './types';
import { BUNDLED_WHITELISTS, resolveScope } from './whitelist';

const UNI = 'https://app.uniswap.org';
const COW = 'https://swap.cow.fi';
const USDC = TOKENS.mainnetUSDC;
const WETH = wl(1, 'utilities', 'WETH');
const PERMIT2 = wl(1, 'uniswap', 'Permit2');
const UR = wl(1, 'uniswap', 'UniversalRouter 2.1.2');
const PROXY = wl(1, 'uniswap', 'SwapProxy');
const NPM = wl(1, 'uniswap', 'NonfungiblePositionManager');
const FEE = wl(1, 'uniswap', 'FeeCollector');
const SETTLEMENT = wl(1, 'cow', 'GPv2Settlement');
const ETHFLOW = wl(1, 'cow', 'CoWSwapEthFlow');
const RELAYER = wl(1, 'cow', 'GPv2VaultRelayer');

const tx = (to: Address | undefined, data?: string, value?: string, origin = UNI): SignRequest => ({
  method: 'eth_sendTransaction',
  params: [{ from: USER, to, data, value }],
  chainId: 1,
  origin,
});
const sign = (
  payload: unknown,
  origin = UNI,
  method: SignRequest['method'] = 'eth_signTypedData_v4',
): SignRequest => ({
  method,
  params: [USER, JSON.stringify(payload)],
  chainId: 1,
  origin,
});
const run = (req: SignRequest) => analyze(req, BUNDLED_WHITELISTS, 'scoped');
const expectRule = (req: SignRequest, level: string, ruleIds: string[]) => {
  const v = run(req);
  expect({ level: v.level, ruleIds: v.ruleIds }).toEqual({ level, ruleIds });
  return v;
};

describe('R0 / R14 / R15', () => {
  it('R0: unprotected origin', () => {
    const v = expectRule(
      tx(USDC, c.approve(ATTACKER, c.MAX_UINT256), undefined, 'https://app.aave.com'),
      'LOW',
      ['R0'],
    );
    expect(v.details.protected).toBe(false);
  });

  it('R14: protected origin on a chain without whitelist', () => {
    expectRule({ ...tx(USDC, c.approve(ATTACKER, 1n)), chainId: 42161 }, 'MEDIUM', ['R14']);
  });

  it('R15: exceptions become "검사 실패"', () => {
    const boom = new Proxy({}, { get: () => { throw new Error('boom'); } }); // prettier-ignore
    const v = analyze(tx(USDC, '0x'), boom, 'scoped');
    expect(v).toMatchObject({ level: 'MEDIUM', ruleIds: ['R15'], summary: '검사 실패: boom' });
    const v2 = analyze(tx(USDC, '0x'), new Proxy({}, { get: () => { throw 'str'; } }), 'scoped'); // prettier-ignore
    expect(v2.summary).toBe('검사 실패: str');
  });
});

describe('approvals R1-R4', () => {
  it('R1: approve(Permit2, MAX) with unlimited amount shown', () => {
    const v = expectRule(tx(USDC, c.approve(PERMIT2, c.MAX_UINT256)), 'LOW', ['R1']);
    expect(v.details).toMatchObject({
      spender: PERMIT2,
      amount: 'UNLIMITED',
      matchedDex: 'uniswap',
      token: USDC,
    });
    expect(v.summary).toContain('무제한');
  });

  it('R2: approve(ATTACKER, MAX)', () => {
    const v = expectRule(tx(USDC, c.approve(ATTACKER, c.MAX_UINT256)), 'HIGH', ['R2']);
    expect(v.summary).toBe('등록되지 않은 주소 0xBAdB…BAD0에게 USDC 무제한 사용 권한을 줍니다.');
  });

  it('R2: approve to a router (not a spender) on a plain ERC-20', () => {
    expectRule(tx(USDC, c.approve(UR, 5n)), 'HIGH', ['R2']);
  });

  it('R4: revoke', () => {
    expectRule(tx(USDC, c.approve(ATTACKER, 0n)), 'LOW', ['R4']);
  });

  it('R2 is scoped: CoW relayer is not a Uniswap spender', () => {
    expectRule(tx(USDC, c.approve(RELAYER, 1n)), 'HIGH', ['R2']);
    expectRule(tx(USDC, c.approve(RELAYER, 1n), undefined, COW), 'LOW', ['R1']);
  });

  it('Permit2.approve tx: routers accepted, attacker rejected, fake Permit2 rejected', () => {
    const p2approve = (spender: Address) =>
      '0x87517c45' +
      [USDC, spender].map((a) => a.slice(2).toLowerCase().padStart(64, '0')).join('') +
      (2n ** 160n - 1n).toString(16).padStart(64, '0') +
      '1'.padStart(64, '0');
    expectRule(tx(PERMIT2, p2approve(UR)), 'LOW', ['R1']);
    expectRule(tx(PERMIT2, p2approve(ATTACKER)), 'HIGH', ['R2']);
    const v = expectRule(tx(ATTACKER, p2approve(UR)), 'HIGH', ['R1', 'R2']);
    expect(v.summary).toContain('공식 Permit2가 아닌');
  });

  it('R3 / R1 / R4: setApprovalForAll', () => {
    expectRule(tx(TOKENS.nft, c.setApprovalForAll(ATTACKER, true)), 'HIGH', ['R3']);
    expectRule(tx(TOKENS.nft, c.setApprovalForAll(PERMIT2, true)), 'LOW', ['R1']);
    expectRule(tx(TOKENS.nft, c.setApprovalForAll(ATTACKER, false)), 'LOW', ['R4']);
  });

  it('EIP-2612 permit', () => {
    const p = (spender: Address, value: string) =>
      sign(eip2612Permit({ chainId: 1, token: USDC, owner: USER, spender, value }), COW);
    expectRule(p(RELAYER, '100'), 'LOW', ['R1']);
    expectRule(p(ATTACKER, '100'), 'HIGH', ['R2']);
    expectRule(p(ATTACKER, '0'), 'LOW', ['R4']);
    const noVc = eip2612Permit({
      chainId: 1,
      token: USDC,
      owner: USER,
      spender: ATTACKER,
      value: '1',
    });
    const v = run(sign({ ...noVc, domain: { name: 'X' } }));
    expect(v.summary).toContain('알 수 없는 토큰 1 (decimals 알 수 없음)');
  });

  it('Permit2 typed data: UniversalRouter as spender is normal', () => {
    expectRule(sign(permit2Single({ chainId: 1, token: USDC, spender: UR })), 'LOW', ['R1']);
  });

  it('Permit2 typed data: attacker spender', () => {
    expectRule(sign(permit2Single({ chainId: 1, token: USDC, spender: ATTACKER })), 'HIGH', ['R2']);
  });

  it('Permit2 typed data: zero amount', () => {
    expectRule(
      sign(permit2Single({ chainId: 1, token: USDC, spender: ATTACKER, amount: '0' })),
      'LOW',
      ['R4'],
    );
  });

  it('Permit2 typed data: forged verifyingContract', () => {
    const v = expectRule(
      sign(permit2Single({ chainId: 1, token: USDC, spender: UR, verifyingContract: ATTACKER })),
      'HIGH',
      ['R1', 'R2'],
    );
    expect(v.summary).toContain('공식 Permit2가 아닙니다');
    const p = permit2Single({ chainId: 1, token: USDC, spender: UR });
    expect(run(sign({ ...p, domain: { name: 'Permit2' } })).summary).toContain('(없음)');
  });

  it('Permit2 batch sums amounts', () => {
    const v = expectRule(
      sign(permit2Batch({ chainId: 1, tokens: [USDC, WETH], spender: ATTACKER })),
      'HIGH',
      ['R2'],
    );
    expect(v.summary).toContain('무제한');
  });
});

describe('UniswapX orders', () => {
  const REACTOR = wl(1, 'uniswap', 'V2DutchOrderReactor (UniswapX)');
  const order = (recipient: Address, extra: Partial<Parameters<typeof uniswapXOrder>[0]> = {}) =>
    sign(
      uniswapXOrder({
        chainId: 1,
        reactor: REACTOR,
        swapper: USER,
        tokenIn: USDC,
        amountIn: '100000000',
        tokenOut: WETH,
        minOut: '25000000000000000',
        recipient,
        ...extra,
      }),
    );

  it('normal order: recipient self, fee output to the fee recipient → LOW', () => {
    const v = expectRule(order(USER, { fee: { recipient: FEE, amount: '1' } }), 'LOW', ['R1']);
    expect(v.details).toMatchObject({
      recipients: [USER, FEE],
      tokenOut: WETH,
      minAmountOut: 25000000000000000n,
    });
  });

  it('R8: output to the attacker', () => {
    const v = expectRule(order(ATTACKER), 'HIGH', ['R1', 'R8']);
    expect(v.summary).toBe(
      'UniswapX 주문(V2DutchOrder)의 결과물 일부를 본인이 아닌 0xBAdB…BAD0이 받습니다.',
    );
  });

  it('R8 + R2: attacker reactor and attacker recipient', () => {
    const v = expectRule(order(ATTACKER, { reactor: ATTACKER }), 'HIGH', ['R2', 'R8']);
    expect(v.summary).toMatch(/\(외 1건\)$/); // two HIGH findings
  });

  it('R9: order type we do not decode', () => {
    const v = expectRule(order(USER, { orderType: 'RelayOrder' }), 'MEDIUM', ['R1', 'R9']);
    expect(v.summary).toContain('RelayOrder');
    const o = uniswapXOrder({
      chainId: 1,
      reactor: REACTOR,
      swapper: USER,
      tokenIn: USDC,
      amountIn: '1',
      tokenOut: WETH,
      minOut: '1',
      recipient: USER,
    });
    const untyped = {
      ...o,
      types: {
        ...o.types,
        PermitWitnessTransferFrom: o.types.PermitWitnessTransferFrom.filter(
          (f) => f.name !== 'witness',
        ),
      },
    };
    expect(run(sign(untyped)).summary).toContain('UniswapX 주문(witness)');
  });

  it('R9: signer unknown', () => {
    const o = uniswapXOrder({
      chainId: 1,
      reactor: REACTOR,
      swapper: USER,
      tokenIn: USDC,
      amountIn: '1',
      tokenOut: WETH,
      minOut: '1',
      recipient: USER,
    });
    expectRule(
      { method: 'eth_signTypedData_v4', params: ['not-an-address', o], chainId: 1, origin: UNI },
      'MEDIUM',
      ['R13'],
    );
    const allowed = resolveScope(UNI, 1, 'scoped', BUNDLED_WHITELISTS).allowed;
    const a: DecodedAction = {
      kind: 'permit2', primaryType: 'PermitWitnessTransferFrom', verifyingContract: PERMIT2, spender: REACTOR,
      permitted: [{ token: USDC, amount: 1n }], witness: { orderType: 'V2DutchOrder', recipients: [USER] },
    }; // prettier-ignore
    expect(evaluateAction(a, { allowed }).hits.map((h) => h.ruleId)).toEqual(['R1', 'R9']);
    const noRecipients: DecodedAction = { ...a, witness: {} } as DecodedAction;
    expect(evaluateAction(noRecipients, { allowed, signer: USER }).hits[1]?.message).toContain(
      '수령 주소 없음',
    );
  });
});

describe('orders R5 / R6 / R16', () => {
  const order = (receiver: Address, verifyingContract?: Address) =>
    sign(
      cowOrder({ chainId: 1, receiver, sellToken: USDC, buyToken: WETH, verifyingContract }),
      COW,
    );

  it('normal orders: receiver 0x0 or self', () => {
    const v = expectRule(order('0x0000000000000000000000000000000000000000'), 'LOW', []);
    expect(v.summary).toContain('CoW 주문');
    expectRule(order(USER), 'LOW', []);
  });

  it('R6: receiver = attacker', () => {
    expectRule(order(ATTACKER), 'HIGH', ['R6']);
  });

  it('R5: fake settlement', () => {
    expectRule(order(USER, ATTACKER), 'HIGH', ['R5']);
    const p = cowOrder({ chainId: 1, receiver: USER, sellToken: USDC, buyToken: WETH });
    expect(run(sign({ ...p, domain: { name: 'Gnosis Protocol' } }, COW)).summary).toContain(
      '(없음)',
    );
  });

  it('CoW order on the Uniswap origin: settlement not in scope → R5', () => {
    expectRule(
      sign(cowOrder({ chainId: 1, receiver: USER, sellToken: USDC, buyToken: WETH })),
      'HIGH',
      ['R5'],
    );
  });

  it('EthFlow createOrder', () => {
    const data = (receiver: Address) =>
      c.ethFlowCreateOrder({ buyToken: USDC, receiver, sellAmount: 1n });
    expectRule(tx(ETHFLOW, data(USER), '0x1', COW), 'LOW', []);
    expectRule(
      tx(ETHFLOW, data('0x0000000000000000000000000000000000000000'), '0x1', COW),
      'LOW',
      [],
    );
    expectRule(tx(ETHFLOW, data(ATTACKER), '0x1', COW), 'HIGH', ['R6']);
    expectRule(tx(ATTACKER, data(USER), '0x1', COW), 'HIGH', ['R11']);
  });

  it('R16: setPreSignature; cancellations', () => {
    expectRule(tx(SETTLEMENT, c.setPreSignature(true), undefined, COW), 'MEDIUM', ['R16']);
    expectRule(tx(ATTACKER, c.setPreSignature(true), undefined, COW), 'HIGH', ['R11']);
    expectRule(tx(SETTLEMENT, c.settlementInvalidateOrder(), undefined, COW), 'LOW', ['R7']);
    expectRule(tx(ATTACKER, c.settlementInvalidateOrder(), undefined, COW), 'HIGH', ['R11']);
  });
});

describe('router R7-R10', () => {
  const swap = (recipient: Address, min: bigint) =>
    r.urExecute([
      r.v3ExactIn({ recipient, amountIn: 100n, amountOutMin: min, path: [USDC, WETH] }),
    ]);

  it('R7: official router, recipient self/sentinel', () => {
    const v = expectRule(tx(UR, swap(r.MSG_SENDER, 1n)), 'LOW', ['R7']);
    expect(v.details).toMatchObject({
      target: UR,
      tokenOut: WETH,
      minAmountOut: 1n,
      matchedDex: 'uniswap',
    });
    expectRule(tx(UR, swap(USER, 1n)), 'LOW', ['R7']);
  });

  it('R7: fee recipient portion is normal', () => {
    const data = r.urExecute([
      r.v3ExactIn({
        recipient: r.ADDRESS_THIS,
        amountIn: 1n,
        amountOutMin: 0n,
        path: [USDC, WETH],
      }),
      r.payPortion(WETH, FEE, 25n),
      r.sweep(WETH, r.MSG_SENDER, 5n),
    ]);
    expectRule(tx(UR, data), 'LOW', ['R7']);
  });

  it('R8: recipient = attacker', () => {
    const v = expectRule(tx(UR, swap(ATTACKER, 1n)), 'HIGH', ['R8']);
    expect(v.summary).toContain('0xBAdB…BAD0');
  });

  it('R9: decode failure (and still R8 if a bad recipient was seen)', () => {
    expectRule(tx(UR, r.urExecute([r.rawCmd(0x3e)])), 'MEDIUM', ['R9']);
    expectRule(tx(UR, r.urExecute([r.rawCmd(0x3e), r.sweep(WETH, ATTACKER, 1n)])), 'HIGH', [
      'R8',
      'R9',
    ]);
  });

  it('R9: signer unknown', () => {
    const req: SignRequest = {
      method: 'eth_sendTransaction',
      params: [{ to: UR, data: swap(USER, 1n) }],
      chainId: 1,
      origin: UNI,
    };
    const v = expectRule(req, 'MEDIUM', ['R9']);
    expect(v.summary).toBe('수령 주소를 확인할 수 없습니다.');
  });

  it('R10: no slippage protection', () => {
    expectRule(tx(UR, swap(r.MSG_SENDER, 0n)), 'MEDIUM', ['R10']);
  });

  it('R11: router calldata sent to an unregistered address', () => {
    expectRule(tx(ATTACKER, swap(r.MSG_SENDER, 1n)), 'HIGH', ['R11']);
  });

  it('unverified whitelist entries are labelled in summaries', () => {
    const ok = [
      r.v3ExactIn({ recipient: r.MSG_SENDER, amountIn: 1n, amountOutMin: 1n, path: [USDC, WETH] }),
    ];
    expect(run(tx(PROXY, r.swapProxyExecute(UR, USDC, 1n, ok))).summary).toContain(
      'SwapProxy (미검증)',
    );
  });

  it('SwapProxy: inner router must be whitelisted', () => {
    const inner = [
      r.v3ExactIn({ recipient: r.MSG_SENDER, amountIn: 1n, amountOutMin: 1n, path: [USDC, WETH] }),
    ];
    expectRule(tx(PROXY, r.swapProxyExecute(UR, USDC, 1n, inner)), 'LOW', ['R7']);
    expectRule(tx(PROXY, r.swapProxyExecute(ATTACKER, USDC, 1n, inner)), 'HIGH', ['R11']);
  });

  it('utilities: WETH deposit/withdraw; fake WETH', () => {
    expectRule(tx(WETH, c.wethDeposit(), '0x5'), 'LOW', ['R7']);
    expectRule(tx(WETH, c.wethWithdraw(5n)), 'LOW', ['R7']);
    expectRule(tx(ATTACKER, c.wethDeposit(), '0x5'), 'HIGH', ['R11']);
  });

  it('others: position manager calls are LOW', () => {
    expectRule(tx(NPM, '0xdeadbeef'), 'LOW', ['R7']);
  });
});

describe('amounts in summaries', () => {
  it('known tokens are scaled, unknown tokens keep raw values, ETH is native', () => {
    expect(run(tx(USDC, c.transfer(ATTACKER, 100_000_000n))).summary).toContain('100 USDC');
    expect(run(tx(TOKENS.nft, c.transfer(ATTACKER, 5n))).summary).toContain(
      '토큰 0x2222…2222 5 (decimals 알 수 없음)',
    );
    expect(run(tx(USDC, c.approve(ATTACKER, 0n))).summary).toContain('USDC 사용 권한을 회수');
    expect(run(tx(WETH, c.wethDeposit(), '0x58d15e176280000')).summary).toContain(
      'deposit 0.4 ETH',
    );
    expect(run(tx(WETH, c.wethWithdraw(10n ** 18n))).summary).toContain('withdraw 1 WETH');
    expect(run(tx(WETH, undefined, '0xde0b6b3a7640000')).summary).toContain('1 ETH');
    expect(run(tx(ATTACKER, undefined, '0xde0b6b3a7640000')).details.token).toBe(
      '0x0000000000000000000000000000000000000000',
    );
  });

  it('CoW summaries name tokens', () => {
    const v = run(
      sign(cowOrder({ chainId: 1, receiver: USER, sellToken: USDC, buyToken: WETH }), COW),
    );
    expect(v.summary).toBe('CoW 주문: USDC → WETH, 수령인 본인.');
    expect(v.details).toMatchObject({
      token: USDC,
      amount: 100000000n,
      tokenOut: WETH,
      minAmountOut: 25000000000000000n,
    });
    const e = run(
      tx(
        ETHFLOW,
        c.ethFlowCreateOrder({ buyToken: USDC, receiver: USER, sellAmount: 1n }),
        '0x1',
        COW,
      ),
    );
    expect(e.summary).toBe('CoW ETH 주문: ETH (네이티브) → USDC, 수령인 본인.');
    expect(e.details).toMatchObject({
      token: '0x0000000000000000000000000000000000000000',
      amount: 1n,
      tokenOut: USDC,
    });
  });
});

describe('particles in summaries', () => {
  it('을/를, 이/가, 으로/로 follow the final sound', () => {
    expect(run(tx(ATTACKER, r.urExecute([r.sweep(WETH, r.MSG_SENDER, 1n)]))).summary).toBe(
      '등록되지 않은 컨트랙트 0xBAdB…BAD0에 swap 호출을 보냅니다.',
    );
    expect(run(tx(ATTACKER, '0xdeadbeef')).summary).toContain('호출 데이터를 보냅니다');
    expect(run(tx(USDC, c.transfer(ATTACKER, 100_000_000n))).summary).toContain('100 USDC를 ');
    expect(run(tx(ATTACKER, undefined, '0xde0b6b3a7640000')).summary).toContain('1 ETH를 보냅니다');
    const s7 = r.urExecute([
      r.v3ExactIn({ recipient: TOKENS.nft, amountIn: 1n, amountOutMin: 1n, path: [USDC, WETH] }),
    ]);
    expect(run(tx(UR, s7)).summary).toContain('0x2222…2222가 받습니다');
    const inner = [
      r.v3ExactIn({ recipient: r.MSG_SENDER, amountIn: 1n, amountOutMin: 1n, path: [USDC, WETH] }),
    ];
    expect(run(tx(PROXY, r.swapProxyExecute(ATTACKER, USDC, 1n, inner))).summary).toContain(
      'router 0xBAdB…BAD0으로 전달합니다',
    );
    for (const req of [tx(ATTACKER, '0xdeadbeef'), tx(USDC, c.transfer(ATTACKER, 1n))]) {
      expect(run(req).summary).not.toMatch(/\((을|를|이|가)\)/);
    }
  });
});

describe('misc R11-R13', () => {
  it('R12: transfer / transferFrom', () => {
    const v = expectRule(tx(USDC, c.transfer(ATTACKER, 5n)), 'MEDIUM', ['R12']);
    expect(v.details.recipients).toEqual([ATTACKER]);
    expectRule(tx(USDC, c.transferFrom(USER, ATTACKER, 5n)), 'MEDIUM', ['R12']);
  });

  it('R11: unregistered to with data or value; contract creation', () => {
    expectRule(tx(ATTACKER, '0xdeadbeef'), 'HIGH', ['R11']);
    expectRule(tx(ATTACKER, undefined, '0x1'), 'HIGH', ['R11']);
    expect(run(tx(undefined, '0x6080')).summary).toContain('컨트랙트 생성');
    const bad: SignRequest = { ...tx(USDC), params: [{ from: USER, to: 'zz', data: '0x' }] };
    expect(run(bad).summary).toContain('to 형식 오류');
  });

  it('fee recipient as tx target is not trusted', () => {
    expectRule(tx(FEE, '0xdeadbeef'), 'HIGH', ['R11']);
  });

  it('whitelisted to with unknown calldata → R9; plain ETH → R7', () => {
    const v = expectRule(tx(UR, '0xdeadbeef'), 'MEDIUM', ['R9']);
    expect(v.summary).toMatch(/해석할 수 없습니다\.$/);
    expect(run(tx(UR, '0x095ea7b3ff')).summary).toContain('디코딩 실패');
    expectRule(tx(WETH, undefined, '0x5'), 'LOW', ['R7']);
  });

  it('empty tx to an unknown address', () => {
    const v = expectRule(tx(ATTACKER), 'LOW', []);
    expect(v.summary).toContain('빈 트랜잭션');
  });

  it('R13: opaque and unknown signatures', () => {
    expectRule(
      { method: 'personal_sign', params: ['0x68', USER], chainId: 1, origin: UNI },
      'MEDIUM',
      ['R13'],
    );
    expectRule(
      { method: 'eth_signTypedData', params: [[], USER], chainId: 1, origin: UNI },
      'MEDIUM',
      ['R13'],
    );
    const v = expectRule(
      sign({ domain: { name: 'Seaport' }, primaryType: 'OrderComponents', message: {} }),
      'MEDIUM',
      ['R13'],
    );
    expect(v.summary).toContain('Seaport / OrderComponents');
    expect(run(sign({ domain: {}, primaryType: 'X', message: {} })).summary).toContain('? / X');
    expect(run(sign('garbage')).summary).toBe('알 수 없는 형식의 서명 요청입니다.');
  });
});

describe('wallet_sendCalls', () => {
  it('takes the highest level and reports that call', () => {
    const v = run({
      method: 'wallet_sendCalls',
      params: [
        {
          from: USER,
          calls: [
            { to: USDC, data: c.approve(PERMIT2, c.MAX_UINT256) },
            { to: USDC, data: c.approve(ATTACKER, 1n) },
          ],
        },
      ],
      chainId: 1,
      origin: UNI,
    });
    expect(v.level).toBe('HIGH');
    expect(v.ruleIds).toEqual(['R1', 'R2']);
    expect(v.summary).toMatch(/^\[2개 호출 중 2번\] 등록되지 않은 주소 .* 사용 권한을 줍니다\.$/);
    expect(v.ruleIds).toEqual(['R1', 'R2']); // LOW R1 is not counted in the text, but kept here
    expect(v.details.spender).toBe(ATTACKER);
  });
});

describe('global mode', () => {
  it('checks any origin against every DEX', () => {
    const v = analyze(
      tx(USDC, c.approve(RELAYER, 1n), undefined, 'https://random.example'),
      BUNDLED_WHITELISTS,
      'global',
    );
    expect(v).toMatchObject({ level: 'LOW', ruleIds: ['R1'] });
    expect(v.details.matchedDex).toBe('cow');
  });
});

describe('helpers', () => {
  it('maxLevel / byRisk', () => {
    expect(maxLevel([])).toBe('LOW');
    expect(maxLevel(['LOW', 'HIGH', 'MEDIUM'])).toBe('HIGH');
    const hits = [
      { ruleId: 'R10', level: 'MEDIUM', message: '' },
      { ruleId: 'R9', level: 'MEDIUM', message: '' },
      { ruleId: 'R8', level: 'HIGH', message: '' },
    ] as const;
    expect([...hits].sort(byRisk).map((h) => h.ruleId)).toEqual(['R8', 'R9', 'R10']);
  });

  it('evaluateAction covers actions that the dispatcher cannot produce directly', () => {
    const allowed = resolveScope(UNI, 1, 'scoped', BUNDLED_WHITELISTS).allowed;
    const a: DecodedAction = { kind: 'unknownCall', value: 0n, hasData: false };
    expect(evaluateAction(a, { allowed }).hits[0]?.message).toContain('형식 오류');
    const u: DecodedAction = { kind: 'unknownTypedData' };
    expect(evaluateAction(u, { allowed }).details).toEqual({ target: undefined });
    const ru: DecodedAction = {
      kind: 'routerCall',
      router: 'universal-router',
      to: UR,
      value: 0n,
      recipients: [],
      hasSwap: false,
    };
    expect(evaluateAction(ru, { allowed }).hits.map((h) => h.ruleId)).toEqual(['R7']);
    const pr: DecodedAction = {
      kind: 'routerCall',
      router: 'swap-proxy',
      to: PROXY,
      value: 0n,
      recipients: [],
      hasSwap: false,
      innerRouter: UR,
    };
    expect(evaluateAction(pr, { allowed }).hits.map((h) => h.ruleId)).toEqual(['R7']);
  });
});
