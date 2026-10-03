import type { Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { ATTACKER, TOKENS, USER } from '../fixtures/addresses';
import { NATIVE_EEEE, sushiSnwap, sushiSnwapMultiple } from '../fixtures/protocols';
import { decodeSushiTx } from './sushiswap';

const RS = '0xAC4c6e212A361c968F1725b4d055b47E63F80b75';
const USDC = TOKENS.mainnetUSDC;

describe('decodeSushiTx', () => {
  it('snwap: recipient, tokenOut, minOut; execution is always opaque', () => {
    const data = sushiSnwap({
      tokenIn: USDC,
      amountIn: 100n,
      recipient: USER,
      tokenOut: NATIVE_EEEE,
      amountOutMin: 7n,
      executor: ATTACKER,
    });
    expect(decodeSushiTx(RS, data, 0n)).toEqual({
      kind: 'routerCall',
      router: 'sushi-redsnwapper',
      to: RS,
      value: 0n,
      hasSwap: true,
      recipients: [USER],
      tokenOut: NATIVE_EEEE,
      minAmountOut: 7n,
      opaqueExecution: '임의 executor',
    });
  });

  it('snwapMultiple: every output recipient, weakest floor', () => {
    const data = sushiSnwapMultiple({
      inputs: [{ token: USDC, amountIn: 1n, transferTo: ATTACKER }],
      outputs: [
        { token: NATIVE_EEEE, recipient: USER, amountOutMin: 9n },
        { token: USDC, recipient: ATTACKER, amountOutMin: 2n },
      ],
      executor: ATTACKER,
    });
    expect(decodeSushiTx(RS, data, 0n)).toMatchObject({
      recipients: [USER, ATTACKER],
      tokenOut: NATIVE_EEEE,
      minAmountOut: 2n,
      opaqueExecution: '임의 executor',
    });
    const ascending = sushiSnwapMultiple({
      inputs: [],
      outputs: [
        { token: USDC, recipient: USER, amountOutMin: 2n },
        { token: USDC, recipient: USER, amountOutMin: 9n },
      ],
      executor: ATTACKER,
    });
    expect(decodeSushiTx(RS, ascending, 0n)?.minAmountOut).toBe(2n);
    const empty = sushiSnwapMultiple({ inputs: [], outputs: [], executor: ATTACKER });
    expect(decodeSushiTx(RS, empty, 0n)).toMatchObject({
      recipients: [],
      tokenOut: undefined,
      minAmountOut: 0n,
    });
  });

  it('broken calldata → decodeError, never throws', () => {
    const data = sushiSnwap({
      tokenIn: USDC,
      amountIn: 1n,
      recipient: USER,
      tokenOut: USDC,
      amountOutMin: 1n,
      executor: ATTACKER,
    });
    expect(decodeSushiTx(RS, data.slice(0, 80) as Hex, 0n)).toMatchObject({
      recipients: [],
      opaqueExecution: '임의 executor',
      decodeError: expect.stringMatching(/RedSnwapper 디코딩 실패/),
    });
  });

  it('other selectors are not ours', () => {
    expect(decodeSushiTx(RS, '0xdeadbeef', 0n)).toBeUndefined();
  });
});
