import { describe, expect, it } from 'vitest';
import { encodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import { ATTACKER, TOKENS, USER } from '../fixtures/addresses';
import { approve } from '../fixtures/calldata';
import * as f from '../fixtures/router';
import { wl } from '../fixtures/whitelist';
import { BUNDLED_WHITELISTS } from '../whitelist';
import { decodeRouterTx, isSentinel, urFamily } from './router';

const USDC = TOKENS.mainnetUSDC;
const WETH = wl(1, 'utilities', 'WETH');
const UR20 = wl(1, 'uniswap', 'UniversalRouter 2.0');
const UR211 = wl(1, 'uniswap', 'UniversalRouter 2.1.1');
const UR12 = wl(1, 'uniswap', 'UniversalRouter 1.2');
const SR02 = wl(1, 'uniswap', 'SwapRouter02');
const PROXY = wl(1, 'uniswap', 'SwapProxy');
const FEE = wl(1, 'uniswap', 'FeeCollector');

const versions = new Map<Address, string>();
for (const d of Object.values(BUNDLED_WHITELISTS[1]!.dexes)) {
  for (const r of d.routers) if (r.version) versions.set(r.address, r.version);
}
const versionOf = (a: Address) => versions.get(a);

const ur = (to: Address, cmds: f.Cmd[], value = 0n) =>
  decodeRouterTx(to, f.urExecute(cmds), value, versionOf)!;

describe('urFamily', () => {
  it.each([
    ['1.2', '1.2'],
    ['2.0', '2.0'],
    ['2.1.0', '2.0'],
    ['2.1.1', '2.1.1'],
    ['2.1.2', '2.1.1'],
    ['2.2.0', '2.1.1'],
    ['3.0', '2.1.1'],
    [undefined, '2.1.1'],
  ])('%s → %s', (v, fam) => expect(urFamily(v)).toBe(fam));
});

describe('isSentinel', () => {
  it('recognises MSG_SENDER and ADDRESS_THIS only', () => {
    expect(isSentinel(f.MSG_SENDER)).toBe(true);
    expect(isSentinel(f.ADDRESS_THIS)).toBe(true);
    expect(isSentinel(USER)).toBe(false);
  });
});

describe('UniversalRouter execute', () => {
  it('simple exact-in to MSG_SENDER', () => {
    const a = ur(UR20, [
      f.v3ExactIn({
        recipient: f.MSG_SENDER,
        amountIn: 100n,
        amountOutMin: 9n,
        path: [USDC, WETH],
      }),
    ]);
    expect(a).toEqual({
      kind: 'routerCall',
      router: 'universal-router',
      to: UR20,
      value: 0n,
      recipients: [f.MSG_SENDER],
      hasSwap: true,
      tokenOut: WETH,
      minAmountOut: 9n,
    });
  });

  it('explicit recipient = user', () => {
    const a = ur(UR20, [
      f.v3ExactIn({ recipient: USER, amountIn: 100n, amountOutMin: 9n, path: [USDC, WETH] }),
    ]);
    expect(a.recipients).toEqual([USER]);
  });

  it('recipient = attacker', () => {
    const a = ur(UR20, [
      f.v3ExactIn({ recipient: ATTACKER, amountIn: 100n, amountOutMin: 9n, path: [USDC, WETH] }),
    ]);
    expect(a.recipients).toEqual([ATTACKER]);
    expect(a.decodeError).toBeUndefined();
  });

  it('minOut = 0 with no other floor', () => {
    const a = ur(UR20, [
      f.v3ExactIn({
        recipient: f.MSG_SENDER,
        amountIn: 100n,
        amountOutMin: 0n,
        path: [USDC, WETH],
      }),
    ]);
    expect(a.minAmountOut).toBe(0n);
  });

  it('sdk custody shape: legs min 0 to router, fee portion, floored SWEEP (normal)', () => {
    const legs = [0, 1, 2].map(() =>
      f.v3ExactIn({
        recipient: f.ADDRESS_THIS,
        amountIn: 33n,
        amountOutMin: 0n,
        path: [USDC, WETH],
      }),
    );
    const a = ur(UR211, [
      ...legs,
      f.payPortion(WETH, FEE, 25n),
      f.sweep(WETH, f.MSG_SENDER, 1234n),
    ]);
    expect(a.recipients).toEqual([
      f.ADDRESS_THIS,
      f.ADDRESS_THIS,
      f.ADDRESS_THIS,
      FEE,
      f.MSG_SENDER,
    ]);
    expect(a.minAmountOut).toBe(1234n);
    expect(a.tokenOut).toBe(WETH);
  });

  it('USDC → ETH: swap to router then UNWRAP_WETH with floor', () => {
    const a = ur(UR20, [
      f.v3ExactIn({
        recipient: f.ADDRESS_THIS,
        amountIn: 100n,
        amountOutMin: 0n,
        path: [USDC, WETH],
      }),
      f.unwrapWeth(f.MSG_SENDER, 77n),
    ]);
    expect(a).toMatchObject({ tokenOut: f.ETH, minAmountOut: 77n });
  });

  it('final floor 0 everywhere → minAmountOut 0', () => {
    const a = ur(UR20, [
      f.v3ExactIn({
        recipient: f.ADDRESS_THIS,
        amountIn: 100n,
        amountOutMin: 0n,
        path: [USDC, WETH],
      }),
      f.unwrapWeth(f.MSG_SENDER, 0n),
    ]);
    expect(a.minAmountOut).toBe(0n);
  });

  it('ETH → USDC: WRAP_ETH to router, value carried', () => {
    const a = ur(
      UR20,
      [
        f.wrapEth(f.ADDRESS_THIS, 10n),
        f.v3ExactIn({
          recipient: f.MSG_SENDER,
          amountIn: 10n,
          amountOutMin: 5n,
          path: [WETH, USDC],
        }),
      ],
      10n,
    );
    expect(a).toMatchObject({
      value: 10n,
      recipients: [f.ADDRESS_THIS, f.MSG_SENDER],
      tokenOut: USDC,
    });
  });

  it('UR 2.1.1 swap input with trailing minHopPriceX36', () => {
    const a = ur(UR211, [
      f.v3ExactIn({
        recipient: f.MSG_SENDER,
        amountIn: 100n,
        amountOutMin: 9n,
        path: [USDC, WETH],
        withHopPrices: true,
      }),
    ]);
    expect(a).toMatchObject({ recipients: [f.MSG_SENDER], minAmountOut: 9n });
    expect(a.decodeError).toBeUndefined();
  });

  it('v3 exact-out: path reversed, amountOut counts as the floor', () => {
    const a = ur(UR20, [
      f.v3ExactOut({
        recipient: f.MSG_SENDER,
        amountOut: 50n,
        amountInMax: 100n,
        path: [USDC, WETH],
      }),
    ]);
    expect(a).toMatchObject({ tokenOut: WETH, minAmountOut: 50n });
  });

  it('v2 exact-in / exact-out (exact-out has no output floor)', () => {
    const ein = ur(UR20, [
      f.v2Swap({ exactIn: true, recipient: f.MSG_SENDER, a: 100n, b: 7n, path: [USDC, WETH] }),
    ]);
    expect(ein).toMatchObject({ tokenOut: WETH, minAmountOut: 7n });
    const eout = ur(UR20, [
      f.v2Swap({ exactIn: false, recipient: f.MSG_SENDER, a: 50n, b: 100n, path: [USDC, WETH] }),
    ]);
    expect(eout.minAmountOut).toBe(0n);
  });

  it('PERMIT2_TRANSFER_FROM / TRANSFER / batch recipients are collected', () => {
    const a = ur(UR20, [
      f.permit2TransferFrom(USDC, ATTACKER, 1n),
      f.transferCmd(USDC, USER, 1n),
      f.permit2TransferFromBatch([{ from: USER, to: ATTACKER, amount: 1n, token: USDC }]),
    ]);
    expect(a.recipients).toEqual([ATTACKER, USER, ATTACKER]);
    expect(a.hasSwap).toBe(false);
    expect(a.minAmountOut).toBeUndefined();
  });

  it('BALANCE_CHECK_ERC20 counts as an aggregate floor', () => {
    const a = ur(UR211, [
      f.v3ExactIn({ recipient: f.MSG_SENDER, amountIn: 1n, amountOutMin: 0n, path: [USDC, WETH] }),
      f.balanceCheck(USER, WETH, 99n),
    ]);
    expect(a.minAmountOut).toBe(99n);
  });

  it('PERMIT2_PERMIT inside execute is ignored; allow-revert flag is masked', () => {
    const a = ur(UR20, [
      f.rawCmd(0x0a, '0x1234'),
      { ...f.sweep(WETH, f.MSG_SENDER, 1n), cmd: 0x84 },
    ]);
    expect(a.recipients).toEqual([f.MSG_SENDER]);
    expect(a.decodeError).toBeUndefined();
  });

  it('EXECUTE_SUB_PLAN is decoded recursively', () => {
    const a = ur(UR20, [f.subPlan([f.sweep(WETH, ATTACKER, 1n)])]);
    expect(a.recipients).toEqual([ATTACKER]);
  });

  it('unknown command → decodeError, other commands still decoded', () => {
    const a = ur(UR20, [f.rawCmd(0x3e), f.sweep(WETH, f.MSG_SENDER, 1n)]);
    expect(a.decodeError).toMatch(/0x3e/);
    expect(a.recipients).toEqual([f.MSG_SENDER]);
  });

  it('position manager / bridge commands are not interpreted', () => {
    expect(ur(UR20, [f.rawCmd(0x12, '0x')]).decodeError).toBeDefined();
    expect(ur(UR20, [f.rawCmd(0x40, '0x')]).decodeError).toBeDefined();
    expect(ur(UR20, [f.rawCmd(0x13, '0x')]).decodeError).toBeUndefined();
  });

  it('UR 1.2: 0x10+ are NFT commands → decodeError', () => {
    const a = ur(UR12, [f.v4Swap([f.v4TakeAll(WETH, 1n)])]);
    expect(a.decodeError).toBeDefined();
    expect(ur(UR12, [f.rawCmd(0x07, '0x')]).decodeError).toBeDefined();
    expect(ur(UR12, [f.subPlan([])]).decodeError).toBeDefined();
  });

  it('truncated input → decodeError', () => {
    expect(ur(UR20, [f.rawCmd(0x00, '0x1234')]).decodeError).toBeDefined();
  });

  it('commands/inputs length mismatch → decodeError', () => {
    const data = encodeFunctionData({
      abi: parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline)']),
      functionName: 'execute',
      args: ['0x0404', [f.sweep(WETH, f.MSG_SENDER, 1n).input], 0n],
    });
    const a = decodeRouterTx(UR20, data, 0n, versionOf)!;
    expect(a.decodeError).toMatch(/길이 불일치/);
    expect(a.recipients).toEqual([f.MSG_SENDER]);
  });

  it('execute without deadline', () => {
    const data = f.urExecute([f.sweep(WETH, f.MSG_SENDER, 1n)], { deadline: false });
    expect(decodeRouterTx(UR20, data, 0n, versionOf)?.recipients).toEqual([f.MSG_SENDER]);
  });

  it('deep sub plans are cut off', () => {
    let c: f.Cmd = f.sweep(WETH, f.MSG_SENDER, 1n);
    for (let i = 0; i < 6; i++) c = f.subPlan([c]);
    expect(ur(UR20, [c]).decodeError).toMatch(/중첩/);
  });

  it('unwhitelisted address uses the newest layout', () => {
    const a = ur(ATTACKER, [f.sweep(WETH, ATTACKER, 1n)]);
    expect(a).toMatchObject({ to: ATTACKER, recipients: [ATTACKER] });
  });
});

describe('V4_SWAP', () => {
  const key = f.poolKey(USDC, WETH);
  const usdcIs0 = key[0] === USDC;

  it.each(['2.0', '2.1.1'] as const)('exact-in single, layout %s', (layout) => {
    const to = layout === '2.0' ? UR20 : UR211;
    const a = ur(to, [
      f.v4Swap([
        f.v4ExactInSingle({
          layout,
          key,
          zeroForOne: usdcIs0,
          amountIn: 100n,
          amountOutMinimum: 8n,
        }),
        f.v4SettleAll(USDC, 100n),
        f.v4TakeAll(WETH, 8n),
      ]),
    ]);
    expect(a).toMatchObject({
      recipients: [f.MSG_SENDER],
      hasSwap: true,
      tokenOut: WETH,
      minAmountOut: 8n,
    });
    expect(a.decodeError).toBeUndefined();
  });

  it('wrong layout for the router version → decodeError', () => {
    const a = ur(UR211, [
      f.v4Swap([
        f.v4ExactIn({
          layout: '2.0',
          currencyIn: USDC,
          path: [WETH],
          amountIn: 1n,
          amountOutMinimum: 1n,
        }),
      ]),
    ]);
    expect(a.decodeError).toBeDefined();
  });

  it.each(['2.0', '2.1.1'] as const)(
    'sdk exact-in multi-hop + TAKE(recipient, 0), layout %s',
    (layout) => {
      const to = layout === '2.0' ? UR20 : UR211;
      const a = ur(to, [
        f.v4Swap([
          f.v4ExactIn({
            layout,
            currencyIn: USDC,
            path: [f.ETH, WETH],
            amountIn: 100n,
            amountOutMinimum: 5n,
          }),
          f.v4Settle(USDC, 0n, true),
          f.v4Take(WETH, f.MSG_SENDER, 0n),
        ]),
      ]);
      expect(a).toMatchObject({ recipients: [f.MSG_SENDER], tokenOut: WETH, minAmountOut: 5n });
    },
  );

  it('exact-out uses the exact TAKE as floor', () => {
    const a = ur(UR211, [
      f.v4Swap([
        f.v4ExactOutSingle({ key, zeroForOne: usdcIs0, amountOut: 40n }),
        f.v4Settle(USDC, 0n, true),
        f.v4Take(WETH, f.MSG_SENDER, 40n),
      ]),
    ]);
    expect(a).toMatchObject({ tokenOut: WETH, minAmountOut: 40n });
    const b = ur(UR211, [
      f.v4Swap([
        f.v4ExactOut({ currencyOut: WETH, path: [USDC], amountOut: 40n }),
        f.v4Take(WETH, f.MSG_SENDER, 2n ** 255n),
      ]),
    ]);
    expect(b).toMatchObject({ tokenOut: WETH, minAmountOut: 0n });
  });

  it('TAKE / TAKE_PORTION / TAKE_PAIR / SWEEP recipients', () => {
    const a = ur(UR211, [
      f.v4Swap([
        f.v4Take(WETH, ATTACKER, 0n),
        f.v4TakePortion(WETH, FEE, 25n),
        f.v4TakePair(USDC, WETH, USER),
        f.v4Sweep(USDC, ATTACKER),
        f.v4Raw(0x13, '0x'),
        f.v4Raw(0x0d, '0x'),
        f.v4Raw(0x12, '0x'),
        f.v4Raw(0x15, '0x'),
        f.v4Raw(0x16, '0x'),
      ]),
    ]);
    expect(a.recipients).toEqual([ATTACKER, FEE, USER, ATTACKER, f.MSG_SENDER]);
    expect(a.decodeError).toBeUndefined();
  });

  it('unknown v4 action → decodeError', () => {
    expect(ur(UR211, [f.v4Swap([f.v4Raw(0x02)])]).decodeError).toMatch(/v4 action 0x02/);
  });
});

describe('SwapProxy', () => {
  it('decodes inner plan with the inner router version', () => {
    const data = f.swapProxyExecute(UR211, USDC, 100n, [
      f.v3ExactIn({
        recipient: f.MSG_SENDER,
        amountIn: 100n,
        amountOutMin: 3n,
        path: [USDC, WETH],
      }),
    ]);
    expect(decodeRouterTx(PROXY, data, 0n, versionOf)).toMatchObject({
      router: 'swap-proxy',
      innerRouter: UR211,
      recipients: [f.MSG_SENDER],
      minAmountOut: 3n,
    });
  });

  it('malformed proxy call → decodeError', () => {
    const data = f.swapProxyExecute(UR211, USDC, 1n, []).slice(0, 80) as Hex;
    expect(decodeRouterTx(PROXY, data, 0n, versionOf)?.decodeError).toBeDefined();
  });
});

describe('SwapRouter02', () => {
  const s = f.sr02.call;

  it('exactInputSingle', () => {
    const data = s('exactInputSingle', [
      {
        tokenIn: USDC,
        tokenOut: WETH,
        fee: 3000,
        recipient: USER,
        amountIn: 1n,
        amountOutMinimum: 2n,
        sqrtPriceLimitX96: 0n,
      },
    ]);
    expect(decodeRouterTx(SR02, data, 0n, versionOf)).toMatchObject({
      router: 'swap-router-02',
      recipients: [USER],
      tokenOut: WETH,
      minAmountOut: 2n,
    });
  });

  it('multicall: exactInput to router + unwrapWETH9 (recursively decoded)', () => {
    const inner = [
      s('exactInput', [
        {
          path: f.v3Path([USDC, WETH]),
          recipient: f.ADDRESS_THIS,
          amountIn: 1n,
          amountOutMinimum: 0n,
        },
      ]),
      s('unwrapWETH9', [9n, USER]),
    ];
    const a = decodeRouterTx(SR02, s('multicall', [1900000000n, inner]), 0n, versionOf)!;
    expect(a).toMatchObject({
      recipients: [f.ADDRESS_THIS, USER],
      tokenOut: f.ETH,
      minAmountOut: 9n,
    });
  });

  it('all multicall overloads and payment helpers', () => {
    const inner = [
      s('exactOutputSingle', [
        {
          tokenIn: USDC,
          tokenOut: WETH,
          fee: 3000,
          recipient: f.MSG_SENDER,
          amountOut: 4n,
          amountInMaximum: 9n,
          sqrtPriceLimitX96: 0n,
        },
      ]),
      s('exactOutput', [
        {
          path: f.v3Path([WETH, USDC]),
          recipient: f.MSG_SENDER,
          amountOut: 4n,
          amountInMaximum: 9n,
        },
      ]),
      s('swapExactTokensForTokens', [1n, 1n, [USDC, WETH], ATTACKER]),
      s('swapTokensForExactTokens', [1n, 1n, [USDC, WETH], f.MSG_SENDER]),
      s('unwrapWETH9', [0n]),
      s('unwrapWETH9WithFee', [0n, USER, 10n, FEE]),
      s('unwrapWETH9WithFee', [0n, 10n, FEE]),
      s('sweepToken', [USDC, 0n, USER]),
      s('sweepToken', [USDC, 0n]),
      s('sweepTokenWithFee', [USDC, 0n, USER, 1n, FEE]),
      s('sweepTokenWithFee', [USDC, 0n, 1n, FEE]),
      s('refundETH', []),
    ];
    for (const mc of [s('multicall', [inner]), s('multicall', [`0x${'11'.repeat(32)}`, inner])]) {
      const a = decodeRouterTx(SR02, mc, 0n, versionOf)!;
      expect(a.recipients).toEqual([
        f.MSG_SENDER, f.MSG_SENDER, ATTACKER, f.MSG_SENDER, f.MSG_SENDER, USER, FEE,
        f.MSG_SENDER, FEE, USER, f.MSG_SENDER, USER, FEE, f.MSG_SENDER, FEE,
      ]); // prettier-ignore
      expect(a.decodeError).toBeUndefined();
    }
  });

  it('broken inner call → decodeError, rest kept', () => {
    const a = decodeRouterTx(
      SR02,
      s('multicall', [[approve(USER, 1n), s('sweepToken', [USDC, 1n, USER])]]),
      0n,
      versionOf,
    )!;
    expect(a.decodeError).toMatch(/multicall/);
    expect(a.recipients).toEqual([USER]);
  });

  it('truncated top-level call → decodeError', () => {
    const data = s('exactInputSingle', [
      {
        tokenIn: USDC,
        tokenOut: WETH,
        fee: 3000,
        recipient: USER,
        amountIn: 1n,
        amountOutMinimum: 2n,
        sqrtPriceLimitX96: 0n,
      },
    ]).slice(0, 50) as Hex;
    expect(decodeRouterTx(SR02, data, 0n, versionOf)?.decodeError).toBeDefined();
  });

  it('nested multicalls are cut off', () => {
    let data = s('sweepToken', [USDC, 1n, USER]);
    for (let i = 0; i < 6; i++) data = s('multicall', [[data]]);
    expect(decodeRouterTx(SR02, data, 0n, versionOf)?.decodeError).toMatch(/중첩/);
  });
});

describe('non-router calldata', () => {
  it('returns undefined', () => {
    expect(decodeRouterTx(UR20, approve(USER, 1n), 0n, versionOf)).toBeUndefined();
    expect(decodeRouterTx(UR20, '0x', 0n, versionOf)).toBeUndefined();
  });
});
