import { describe, expect, it } from 'vitest';
import { ATTACKER, TOKENS, USER } from '../fixtures/addresses';
import {
  approve,
  ethFlowCreateOrder,
  ethFlowInvalidateOrder,
  setPreSignature,
  settlementInvalidateOrder,
} from '../fixtures/calldata';
import { cowOrder } from '../fixtures/typedData';
import { wl } from '../fixtures/whitelist';
import { decodeCowOrder, decodeCowTx } from './cow';
import { parseTypedData } from './typedData';
import { ZERO_ADDRESS } from './util';

const USDC = TOKENS.mainnetUSDC;
const WETH = wl(1, 'utilities', 'WETH');
const SETTLEMENT = wl(1, 'cow', 'GPv2Settlement');
const ETHFLOW = wl(1, 'cow', 'CoWSwapEthFlow');

const order = (receiver: `0x${string}`) =>
  parseTypedData(cowOrder({ chainId: 1, receiver, sellToken: USDC, buyToken: WETH }))!;

describe('decodeCowOrder', () => {
  it.each([
    ['0x0 (same as owner)', ZERO_ADDRESS],
    ['self', USER],
    ['someone else', ATTACKER],
  ])('receiver = %s', (_, receiver) => {
    expect(decodeCowOrder(order(receiver))).toEqual({
      kind: 'cowOrder',
      verifyingContract: SETTLEMENT,
      receiver,
      sellToken: USDC,
      buyToken: WETH,
      sellAmount: 100000000n,
      buyAmount: 25000000000000000n,
    });
  });

  it('omitted receiver means same-as-owner', () => {
    const p = cowOrder({ chainId: 1, receiver: USER, sellToken: USDC, buyToken: WETH });
    const { receiver: _omit, ...message } = p.message;
    void _omit;
    expect(decodeCowOrder(parseTypedData({ ...p, message })!)?.receiver).toBe(ZERO_ADDRESS);
  });

  it('keeps a forged settlement for the rules', () => {
    const td = parseTypedData(
      cowOrder({
        chainId: 1,
        receiver: USER,
        sellToken: USDC,
        buyToken: WETH,
        verifyingContract: ATTACKER,
      }),
    )!;
    expect(decodeCowOrder(td)?.verifyingContract).toBe(ATTACKER);
  });

  it('returns undefined for other domains or malformed orders', () => {
    const p = cowOrder({ chainId: 1, receiver: USER, sellToken: USDC, buyToken: WETH });
    expect(decodeCowOrder(parseTypedData({ ...p, primaryType: 'Other' })!)).toBeUndefined();
    expect(
      decodeCowOrder(parseTypedData({ ...p, domain: { ...p.domain, name: 'x' } })!),
    ).toBeUndefined();
    expect(
      decodeCowOrder(parseTypedData({ ...p, message: { ...p.message, receiver: 'bad' } })!),
    ).toBeUndefined();
    expect(
      decodeCowOrder(parseTypedData({ ...p, message: { ...p.message, buyAmount: 'x' } })!),
    ).toBeUndefined();
  });
});

describe('decodeCowTx', () => {
  it.each([
    ['self', USER],
    ['someone else', ATTACKER],
    ['0x0', ZERO_ADDRESS],
  ])('EthFlow createOrder receiver = %s', (_, receiver) => {
    const data = ethFlowCreateOrder({ buyToken: USDC, receiver, sellAmount: 10n ** 18n });
    expect(decodeCowTx(ETHFLOW, data)).toEqual({
      kind: 'cowEthFlowOrder',
      to: ETHFLOW,
      receiver,
      buyToken: USDC,
      sellAmount: 10n ** 18n,
      buyAmount: 100_000_000n,
    });
  });

  it('setPreSignature', () => {
    expect(decodeCowTx(SETTLEMENT, setPreSignature(true))).toMatchObject({
      kind: 'cowPreSignature',
      to: SETTLEMENT,
      signed: true,
    });
  });

  it('order cancellations are no-ops', () => {
    expect(decodeCowTx(SETTLEMENT, settlementInvalidateOrder())).toEqual({
      kind: 'routerNoop',
      to: SETTLEMENT,
      fn: 'invalidateOrder',
    });
    const data = ethFlowInvalidateOrder({ buyToken: USDC, receiver: USER, sellAmount: 1n });
    expect(decodeCowTx(ETHFLOW, data)?.kind).toBe('routerNoop');
  });

  it('ignores unrelated selectors', () => {
    expect(decodeCowTx(SETTLEMENT, approve(USER, 1n))).toBeUndefined();
  });
});
