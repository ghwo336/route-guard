import type { Address, Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { ATTACKER, TOKENS, USER } from '../fixtures/addresses';
import * as p from '../fixtures/protocols';
import { approve } from '../fixtures/calldata';
import { decodeBalancerTx, decodeBalancerTypedData } from './balancer';
import { MSG_SENDER } from './router';
import { parseTypedData } from './typedData';

const VAULT: Address = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';
const ROUTER: Address = '0xAE563E3f8219521950555F5962419C8919758Ea2';
const BATCH: Address = '0x136f1EFcC3f8f88516B9E94110D56FDBfB1778d1';
const RELAYER: Address = '0x35Cea9e57A393ac66Aaa7E25C391D52C74B5648f';
const USDC = TOKENS.mainnetUSDC;
const WETH: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const ETH: Address = '0x0000000000000000000000000000000000000000';

describe('Balancer V2 Vault', () => {
  it('swap GIVEN_IN: funds.recipient, assetOut, limit as floor', () => {
    const data = p.balancerV2Swap({
      sender: USER,
      recipient: USER,
      assetIn: USDC,
      assetOut: ETH,
      amount: 100n,
      limit: 7n,
    });
    expect(decodeBalancerTx(VAULT, data, 0n)).toEqual({
      kind: 'routerCall',
      router: 'balancer-v2-vault',
      to: VAULT,
      value: 0n,
      recipients: [USER],
      hasSwap: true,
      tokenOut: ETH,
      minAmountOut: 7n,
    });
  });

  it('swap GIVEN_OUT: the exact amount is the floor; toInternalBalance to self is fine', () => {
    const data = p.balancerV2Swap({
      sender: USER,
      recipient: ATTACKER,
      assetIn: USDC,
      assetOut: WETH,
      amount: 5n,
      limit: 999n,
      givenOut: true,
      toInternalBalance: true,
    });
    expect(decodeBalancerTx(VAULT, data, 0n)).toMatchObject({
      recipients: [ATTACKER],
      minAmountOut: 5n,
    });
  });

  it('batchSwap: output floor = -(negative limit)', () => {
    const data = p.balancerV2BatchSwap({
      sender: USER,
      recipient: USER,
      assets: [USDC, WETH, ETH],
      limits: [100n, 0n, -42n],
    });
    expect(decodeBalancerTx(VAULT, data, 0n)).toMatchObject({
      recipients: [USER],
      tokenOut: ETH,
      minAmountOut: 42n,
    });
    const two = p.balancerV2BatchSwap({
      sender: USER,
      recipient: USER,
      assets: [USDC, WETH, ETH],
      limits: [100n, -3n, -42n],
    });
    expect(decodeBalancerTx(VAULT, two, 0n)).toMatchObject({ tokenOut: ETH, minAmountOut: 42n });
    const first = p.balancerV2BatchSwap({
      sender: USER,
      recipient: USER,
      assets: [WETH, ETH, USDC],
      limits: [-50n, -3n, 100n],
    });
    expect(decodeBalancerTx(VAULT, first, 0n)).toMatchObject({ tokenOut: WETH, minAmountOut: 50n });
  });

  it('batchSwap without negative limits: floor unknown → minAmountOut left unset (no R10)', () => {
    const data = p.balancerV2BatchSwap({
      sender: USER,
      recipient: USER,
      assets: [USDC, ETH],
      limits: [100n, 0n],
    });
    const a = decodeBalancerTx(VAULT, data, 0n);
    expect(a).toMatchObject({ hasSwap: true, recipients: [USER] });
    expect(a && 'minAmountOut' in a ? a.minAmountOut : 'absent').toBe('absent');
  });

  it('setRelayerApproval → operator-style approval', () => {
    expect(decodeBalancerTx(VAULT, p.balancerSetRelayerApproval(USER, ATTACKER, true), 0n)).toEqual(
      {
        kind: 'setApprovalForAll',
        scope: 'balancer-relayer',
        to: VAULT,
        operator: ATTACKER,
        approved: true,
      },
    );
  });

  it('broken Vault calldata → decodeError', () => {
    const data = p.balancerV2Swap({
      sender: USER,
      recipient: USER,
      assetIn: USDC,
      assetOut: ETH,
      amount: 1n,
      limit: 1n,
    });
    expect(decodeBalancerTx(VAULT, data.slice(0, 90) as Hex, 0n)).toMatchObject({
      router: 'balancer-v2-vault',
      decodeError: expect.stringMatching(/Vault 디코딩 실패/),
    });
  });
});

describe('Balancer V3 routers (recipient is always msg.sender)', () => {
  it('Router swapSingleTokenExactIn / ExactOut', () => {
    expect(
      decodeBalancerTx(
        ROUTER,
        p.balancerV3SwapSingle({ tokenIn: USDC, tokenOut: WETH, amount: 100n, limit: 9n }),
        0n,
      ),
    ).toEqual({
      kind: 'routerCall',
      router: 'balancer-v3-router',
      to: ROUTER,
      value: 0n,
      recipients: [MSG_SENDER],
      hasSwap: true,
      tokenOut: WETH,
      minAmountOut: 9n,
    });
    const out = p.balancerV3SwapSingle({
      tokenIn: USDC,
      tokenOut: WETH,
      amount: 4n,
      limit: 100n,
      exactOut: true,
    });
    // ExactOut: the 4th arg (exact output) is the floor; the 5th (maxAmountIn = 100) is not
    expect(decodeBalancerTx(ROUTER, out, 0n)).toMatchObject({ minAmountOut: 4n });
  });

  it('BatchRouter swapExactIn sums per-path minimums; swapExactOut uses exact outputs', () => {
    const data = p.balancerV3SwapExactIn([
      { tokenIn: USDC, tokenOut: WETH, amountIn: 50n, minOut: 3n },
      { tokenIn: USDC, tokenOut: WETH, amountIn: 50n, minOut: 4n },
    ]);
    expect(decodeBalancerTx(BATCH, data, 0n)).toMatchObject({
      router: 'balancer-v3-batch-router',
      recipients: [MSG_SENDER],
      tokenOut: WETH,
      minAmountOut: 7n,
    });
    const zero = p.balancerV3SwapExactIn([
      { tokenIn: USDC, tokenOut: WETH, amountIn: 50n, minOut: 0n },
    ]);
    expect(decodeBalancerTx(BATCH, zero, 0n)?.['minAmountOut' as never]).toBe(0n);
    const out = p.balancerV3SwapExactOut([
      { tokenIn: USDC, tokenOut: WETH, maxIn: 99n, exactOut: 6n },
    ]);
    expect(decodeBalancerTx(BATCH, out, 0n)).toMatchObject({ minAmountOut: 6n });
  });

  it('permitBatchAndCall and multicall unwrap the swap', () => {
    const swap = p.balancerV3SwapSingle({ tokenIn: USDC, tokenOut: WETH, amount: 100n, limit: 9n });
    expect(
      decodeBalancerTx(ROUTER, p.balancerPermitBatchAndCall([swap], ROUTER), 0n),
    ).toMatchObject({
      router: 'balancer-v3-router',
      recipients: [MSG_SENDER],
      minAmountOut: 9n,
    });
    expect(decodeBalancerTx(ROUTER, p.balancerMulticall([swap]), 0n)).toMatchObject({
      recipients: [MSG_SENDER],
    });
  });

  it('Relayer v6 multicall (library calls) → decodeError (R9)', () => {
    const a = decodeBalancerTx(RELAYER, p.balancerMulticall(['0x12345678', approve(USER, 1n)]), 0n);
    expect(a).toMatchObject({ kind: 'routerCall', recipients: [], hasSwap: false });
    expect(a && 'decodeError' in a ? a.decodeError : '').toMatch(
      /multicall 내부 호출 해석 불가 \(0x12345678\)/,
    );
  });

  it('nested multicalls are cut off', () => {
    let data = p.balancerV3SwapSingle({ tokenIn: USDC, tokenOut: WETH, amount: 1n, limit: 1n });
    for (let i = 0; i < 5; i++) data = p.balancerMulticall([data]);
    const a = decodeBalancerTx(ROUTER, data, 0n);
    expect(a && 'decodeError' in a ? a.decodeError : '').toMatch(/중첩/);
  });

  it('broken V3 calldata → decodeError; unknown selectors are not ours', () => {
    const data = p.balancerV3SwapSingle({ tokenIn: USDC, tokenOut: WETH, amount: 1n, limit: 1n });
    const a = decodeBalancerTx(ROUTER, data.slice(0, 60) as Hex, 0n);
    expect(a && 'decodeError' in a ? a.decodeError : '').toMatch(/Balancer router 디코딩 실패/);
    expect(decodeBalancerTx(ROUTER, '0xdeadbeef', 0n)).toBeUndefined();
  });
});

describe('relayer authorization signatures (EIP-712, b-sdk)', () => {
  const td = (
    primaryType: 'SetRelayerApproval' | 'Swap' | 'BatchSwap' | 'JoinPool',
    calldata: Hex,
  ) =>
    parseTypedData(
      p.balancerRelayerAuthorization({
        chainId: 1,
        vault: VAULT,
        primaryType,
        calldata,
        sender: RELAYER,
      }),
    )!;

  it('SetRelayerApproval → relayer approval', () => {
    expect(
      decodeBalancerTypedData(
        td('SetRelayerApproval', p.balancerSetRelayerApproval(USER, ATTACKER, true)),
      ),
    ).toMatchObject({
      kind: 'setApprovalForAll',
      scope: 'balancer-relayer',
      operator: ATTACKER,
      approved: true,
    });
  });

  it('Swap authorization → the authorized Vault swap', () => {
    const swap = p.balancerV2Swap({
      sender: USER,
      recipient: ATTACKER,
      assetIn: USDC,
      assetOut: WETH,
      amount: 1n,
      limit: 1n,
    });
    expect(decodeBalancerTypedData(td('Swap', swap))).toMatchObject({
      kind: 'routerCall',
      recipients: [ATTACKER],
    });
  });

  it('not handled: other primary types, other domains, missing calldata', () => {
    expect(decodeBalancerTypedData(td('JoinPool', '0x'))).toBeUndefined();
    const t = td('Swap', '0x1234');
    expect(decodeBalancerTypedData({ ...t, domainName: 'Other' })).toBeUndefined();
    expect(decodeBalancerTypedData({ ...t, message: {} })).toBeUndefined();
    expect(decodeBalancerTypedData({ ...t, verifyingContract: undefined })).toBeUndefined(); // 0x1234 matches no selector
  });
});
