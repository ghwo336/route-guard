import { describe, expect, it } from 'vitest';
import { ATTACKER, TOKENS, USER } from '../fixtures/addresses';
import { permit2Single, uniswapXOrder } from '../fixtures/typedData';
import { wl } from '../fixtures/whitelist';
import { parseTypedData } from './typedData';
import { decodeUniswapXWitness } from './uniswapx';

const USDC = TOKENS.mainnetUSDC;
const WETH = wl(1, 'utilities', 'WETH');
const reactor = wl(1, 'uniswap', 'V2DutchOrderReactor (UniswapX)');
const base = () =>
  uniswapXOrder({
    chainId: 1,
    reactor,
    swapper: USER,
    tokenIn: USDC,
    amountIn: '100',
    tokenOut: WETH,
    minOut: '7',
    recipient: ATTACKER,
  });

/** Rewrite the witness into another order type's field layout. */
function asType(orderType: string, outputsKey: string, output: Record<string, unknown>) {
  const o = base();
  return {
    ...o,
    types: {
      ...o.types,
      PermitWitnessTransferFrom: o.types.PermitWitnessTransferFrom.map((f) =>
        f.name === 'witness' ? { ...f, type: orderType } : f,
      ),
    },
    message: { ...o.message, witness: { info: o.message.witness.info, [outputsKey]: [output] } },
  };
}

describe('decodeUniswapXWitness', () => {
  it('V2DutchOrder', () => {
    expect(decodeUniswapXWitness(parseTypedData(base())!)).toEqual({
      orderType: 'V2DutchOrder',
      reactor,
      swapper: USER,
      recipients: [ATTACKER],
      tokenOut: WETH,
      minAmountOut: 7n,
    });
  });

  it.each([
    [
      'ExclusiveDutchOrder',
      'outputs',
      { token: WETH, startAmount: '9', endAmount: '8', recipient: USER },
      8n,
    ],
    [
      'V3DutchOrder',
      'baseOutputs',
      {
        token: WETH,
        startAmount: '9',
        curve: {},
        recipient: USER,
        minAmount: '5',
        adjustmentPerGweiBaseFee: '0',
      },
      5n,
    ],
    [
      'PriorityOrder',
      'outputs',
      { token: WETH, amount: '6', mpsPerPriorityFeeWei: '0', recipient: USER },
      6n,
    ],
  ])('%s', (type, key, output, min) => {
    expect(decodeUniswapXWitness(parseTypedData(asType(type, key, output))!)).toMatchObject({
      orderType: type,
      recipients: [USER],
      minAmountOut: min,
    });
  });

  it('unsupported order types (e.g. RelayOrder) → error', () => {
    const td = parseTypedData(
      asType('RelayOrder', 'input', { token: USDC, amount: '1', recipient: USER }),
    )!;
    expect(decodeUniswapXWitness(td)).toEqual({
      orderType: 'RelayOrder',
      error: '해석하지 않는 주문 타입',
    });
  });

  it('malformed outputs → error', () => {
    const o = base();
    const bad = (witness: unknown) =>
      decodeUniswapXWitness(parseTypedData({ ...o, message: { ...o.message, witness } })!);
    expect(bad({ baseOutputs: [] })).toMatchObject({ error: '주문 형식 오류' });
    expect(bad({ baseOutputs: [{ token: WETH, recipient: 'nope' }] })).toMatchObject({
      error: '주문 형식 오류',
    });
    expect(bad('x')).toMatchObject({ error: '주문 형식 오류' });
    expect(bad({ baseOutputs: [{ recipient: USER }] })).toMatchObject({
      recipients: [USER],
      tokenOut: undefined,
      reactor: undefined,
    });
  });

  it('witness value without a declared type → error; no witness → undefined', () => {
    const o = base();
    const noType = {
      ...o,
      types: {
        ...o.types,
        PermitWitnessTransferFrom: o.types.PermitWitnessTransferFrom.filter(
          (f) => f.name !== 'witness',
        ),
      },
    };
    expect(decodeUniswapXWitness(parseTypedData(noType)!)).toEqual({
      error: 'witness 타입 정보 없음',
    });
    const noTypes = { ...o, types: undefined };
    expect(decodeUniswapXWitness(parseTypedData(noTypes)!)).toEqual({
      error: 'witness 타입 정보 없음',
    });
    expect(
      decodeUniswapXWitness(
        parseTypedData(permit2Single({ chainId: 1, token: USDC, spender: reactor }))!,
      ),
    ).toBeUndefined();
  });
});
