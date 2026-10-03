import { toFunctionSelector, type Address, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { ATTACKER, TOKENS, USER } from '../fixtures/addresses';
import { curveExchange, NATIVE_EEEE } from '../fixtures/protocols';
import { CURVE_ABI, curveOutputToken, decodeCurveTx } from './curve';
import { MSG_SENDER } from './router';

const ROUTER = '0x45312ea0eFf7E09C83CBE249fa1d7598c4C8cd4e';
const USDC = TOKENS.mainnetUSDC;
const POOL1: Address = '0x4444444444444444444444444444444444444444';
const POOL2: Address = '0x5555555555555555555555555555555555555555';
const DAI: Address = '0x6B175474E89094C44Da98b954EedeAC495271d0F';

describe('Curve Router NG ABI', () => {
  it('selectors match the deployed overloads (docs/protocols-phase7.md 2.4)', () => {
    expect(CURVE_ABI.map((f) => toFunctionSelector(f))).toEqual([
      '0x371dc447',
      '0x5c9c18e2',
      '0xc872a3c5',
    ]);
  });
});

describe('curveOutputToken (Router.vy loop)', () => {
  const pad = (xs: Address[]) =>
    [
      ...xs,
      ...Array(11 - xs.length).fill('0x0000000000000000000000000000000000000000'),
    ] as Address[];
  it('single hop, multi hop, full route, empty', () => {
    expect(curveOutputToken(pad([USDC, POOL1, NATIVE_EEEE]))).toBe(NATIVE_EEEE);
    expect(curveOutputToken(pad([USDC, POOL1, DAI, POOL2, NATIVE_EEEE]))).toBe(NATIVE_EEEE);
    const full = [
      USDC,
      POOL1,
      DAI,
      POOL2,
      USDC,
      POOL1,
      DAI,
      POOL2,
      USDC,
      POOL1,
      NATIVE_EEEE,
    ] as Address[];
    expect(curveOutputToken(full)).toBe(NATIVE_EEEE);
    expect(curveOutputToken(pad([]))).toBeUndefined();
    expect(curveOutputToken([USDC, POOL1, DAI])).toBe(DAI); // short array
  });
});

describe('decodeCurveTx', () => {
  it('5-arg overload (what the frontend sends): receiver = msg.sender', () => {
    const data = curveExchange({ route: [USDC, POOL1, NATIVE_EEEE], amount: 100n, minDy: 9n });
    expect(decodeCurveTx(ROUTER, data, 0n)).toEqual({
      kind: 'routerCall',
      router: 'curve-router-ng',
      to: ROUTER,
      value: 0n,
      hasSwap: true,
      recipients: [MSG_SENDER],
      tokenOut: NATIVE_EEEE,
      minAmountOut: 9n,
    });
  });

  it('4-arg overload: receiver = msg.sender', () => {
    const data = curveExchange({
      route: [USDC, POOL1, DAI],
      amount: 1n,
      minDy: 1n,
      fourArgs: true,
    });
    expect(decodeCurveTx(ROUTER, data, 0n)).toMatchObject({
      recipients: [MSG_SENDER],
      tokenOut: DAI,
    });
  });

  it('6-arg overload: explicit receiver (self or attacker)', () => {
    for (const receiver of [USER, ATTACKER]) {
      const data = curveExchange({ route: [USDC, POOL1, DAI], amount: 1n, minDy: 0n, receiver });
      expect(decodeCurveTx(ROUTER, data, 0n)).toMatchObject({
        recipients: [receiver],
        minAmountOut: 0n,
      });
    }
  });

  it('broken calldata → decodeError; other selectors are not ours', () => {
    const data = curveExchange({ route: [USDC, POOL1, DAI], amount: 1n, minDy: 1n });
    expect(decodeCurveTx(ROUTER, data.slice(0, 100) as Hex, 0n)?.decodeError).toMatch(
      /Curve Router NG/,
    );
    expect(decodeCurveTx(ROUTER, '0xdeadbeef', 0n)).toBeUndefined();
  });
});
