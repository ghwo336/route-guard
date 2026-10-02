import type { Address } from 'viem';
import { describe, expect, it } from 'vitest';
import { ATTACKER, TOKENS, USER } from '../fixtures/addresses';
import {
  approve,
  ethFlowCreateOrder,
  MAX_UINT256,
  setPreSignature,
  transfer,
  transferFrom,
  wethDeposit,
  wethWithdraw,
} from '../fixtures/calldata';
import * as r from '../fixtures/router';
import { cowOrder, eip2612Permit, permit2Single } from '../fixtures/typedData';
import { wl } from '../fixtures/whitelist';
import type { SignRequest } from '../types';
import { decodeRequest, decodeTx, type DecodeContext } from './index';
import { decodeMiscTx } from './misc';

const USDC = TOKENS.mainnetUSDC;
const WETH = wl(1, 'utilities', 'WETH');
const UR = wl(1, 'uniswap', 'UniversalRouter 2.1.2');
const NPM = wl(1, 'uniswap', 'NonfungiblePositionManager');
const ETHFLOW = wl(1, 'cow', 'CoWSwapEthFlow');
const SETTLEMENT = wl(1, 'cow', 'GPv2Settlement');

const ctx: DecodeContext = {
  versionOf: (a: Address) => (a === UR ? '2.1.2' : undefined),
  isOther: (a: Address) => a === NPM,
};

const req = (method: SignRequest['method'], params: unknown, from?: Address): SignRequest => ({
  method,
  params,
  chainId: 1,
  origin: 'https://app.uniswap.org',
  from,
});

describe('decodeMiscTx', () => {
  it('transfer / transferFrom / WETH deposit / withdraw', () => {
    expect(decodeMiscTx(USDC, transfer(ATTACKER, 5n), 0n)).toEqual({
      kind: 'transfer',
      fn: 'transfer',
      to: USDC,
      recipient: ATTACKER,
      amount: 5n,
    });
    expect(decodeMiscTx(USDC, transferFrom(USER, ATTACKER, 5n), 0n)).toMatchObject({
      fn: 'transferFrom',
      from: USER,
      recipient: ATTACKER,
    });
    expect(decodeMiscTx(WETH, wethDeposit(), 3n)).toEqual({
      kind: 'utility',
      to: WETH,
      fn: 'deposit',
      amount: 3n,
    });
    expect(decodeMiscTx(WETH, wethWithdraw(4n), 0n)).toMatchObject({ fn: 'withdraw', amount: 4n });
    expect(decodeMiscTx(WETH, approve(USER, 1n), 0n)).toBeUndefined();
  });
});

describe('decodeTx', () => {
  it('routes by selector', () => {
    expect(decodeTx({ to: USDC, data: approve(ATTACKER, MAX_UINT256) }, ctx).kind).toBe('approve');
    expect(
      decodeTx(
        {
          to: ETHFLOW,
          data: ethFlowCreateOrder({ buyToken: USDC, receiver: USER, sellAmount: 1n }),
          value: '0x1',
        },
        ctx,
      ).kind,
    ).toBe('cowEthFlowOrder');
    expect(decodeTx({ to: SETTLEMENT, data: setPreSignature(true) }, ctx).kind).toBe(
      'cowPreSignature',
    );
    expect(
      decodeTx({ to: UR, data: r.urExecute([r.sweep(WETH, r.MSG_SENDER, 1n)]) }, ctx).kind,
    ).toBe('routerCall');
    expect(decodeTx({ to: USDC, data: transfer(ATTACKER, 1n) }, ctx).kind).toBe('transfer');
  });

  it('accepts `input` instead of `data`, hex and decimal values', () => {
    expect(decodeTx({ to: WETH, input: wethDeposit(), value: '0x0a' }, ctx)).toMatchObject({
      kind: 'utility',
      amount: 10n,
    });
    expect(decodeTx({ to: WETH, data: wethDeposit(), value: 7 }, ctx)).toMatchObject({
      amount: 7n,
    });
  });

  it('`others` contracts are not interpreted', () => {
    expect(decodeTx({ to: NPM, data: transfer(ATTACKER, 1n), value: '0x1' }, ctx)).toEqual({
      kind: 'other',
      to: NPM,
      value: 1n,
    });
  });

  it('plain value transfer and empty calls', () => {
    expect(decodeTx({ to: ATTACKER, value: '0x10' }, ctx)).toEqual({
      kind: 'unknownCall',
      to: ATTACKER,
      value: 16n,
      hasData: false,
    });
  });

  it('unknown selector', () => {
    expect(decodeTx({ to: ATTACKER, data: '0xdeadbeef' }, ctx)).toEqual({
      kind: 'unknownCall',
      to: ATTACKER,
      value: 0n,
      hasData: true,
    });
  });

  it('broken calldata with a known selector does not throw', () => {
    expect(decodeTx({ to: USDC, data: '0x095ea7b3ff' }, ctx)).toMatchObject({
      kind: 'unknownCall',
      reason: expect.stringMatching(/디코딩 실패/),
    });
  });

  it('malformed tx objects', () => {
    expect(decodeTx(null, ctx)).toMatchObject({ kind: 'unknownCall', reason: 'tx 형식 오류' });
    expect(decodeTx({ to: USDC, data: 'zz' }, ctx)).toMatchObject({
      reason: 'data/value 형식 오류',
    });
    expect(decodeTx({ to: USDC, value: 'abc' }, ctx)).toMatchObject({
      reason: 'data/value 형식 오류',
    });
    expect(decodeTx({ data: '0x6080' }, ctx)).toMatchObject({
      reason: '컨트랙트 생성',
      hasData: true,
    });
    expect(decodeTx({ to: 'nope', data: '0x' }, ctx)).toMatchObject({ reason: 'to 형식 오류' });
  });
});

describe('decodeRequest', () => {
  it('eth_sendTransaction takes signer from tx.from, else req.from', () => {
    const d = decodeRequest(
      req('eth_sendTransaction', [{ from: USER, to: USDC, data: approve(USER, 0n) }]),
      ctx,
    );
    expect(d.signer).toBe(USER);
    expect(d.actions).toHaveLength(1);
    const d2 = decodeRequest(
      req('eth_sendTransaction', [{ to: USDC, data: approve(USER, 0n) }], ATTACKER),
      ctx,
    );
    expect(d2.signer).toBe(ATTACKER);
    expect(decodeRequest(req('eth_sendTransaction', 'junk'), ctx).actions[0]?.kind).toBe(
      'unknownCall',
    );
  });

  it('wallet_sendCalls decodes every call', () => {
    const d = decodeRequest(
      req('wallet_sendCalls', [
        {
          version: '2.0.0',
          chainId: '0x1',
          from: USER,
          calls: [
            { to: USDC, data: approve(wl(1, 'uniswap', 'Permit2'), MAX_UINT256) },
            { to: UR, data: r.urExecute([r.sweep(WETH, r.MSG_SENDER, 1n)]) },
          ],
        },
      ]),
      ctx,
    );
    expect(d.signer).toBe(USER);
    expect(d.actions.map((a) => a.kind)).toEqual(['approve', 'routerCall']);
  });

  it('wallet_sendCalls with no calls', () => {
    expect(decodeRequest(req('wallet_sendCalls', [{ calls: [] }], USER), ctx)).toEqual({
      signer: USER,
      actions: [{ kind: 'unknownCall', value: 0n, hasData: false, reason: 'calls 형식 오류' }],
    });
    expect(decodeRequest(req('wallet_sendCalls', []), ctx).actions[0]?.kind).toBe('unknownCall');
  });

  it.each(['eth_signTypedData_v4', 'eth_signTypedData_v3'] as const)(
    '%s decodes Permit2 / Permit / CoW',
    (method) => {
      const p2 = permit2Single({ chainId: 1, token: USDC, spender: UR });
      expect(decodeRequest(req(method, [USER, JSON.stringify(p2)]), ctx)).toMatchObject({
        signer: USER,
        actions: [{ kind: 'permit2' }],
      });
      const p = eip2612Permit({ chainId: 1, token: USDC, owner: USER, spender: UR, value: '1' });
      expect(decodeRequest(req(method, [USER, p]), ctx).actions[0]?.kind).toBe('permit');
      const c = cowOrder({ chainId: 1, receiver: USER, sellToken: USDC, buyToken: WETH });
      expect(decodeRequest(req(method, [JSON.stringify(c), USER]), ctx).actions[0]?.kind).toBe(
        'cowOrder',
      );
    },
  );

  it('unknown and broken typed data', () => {
    const other = {
      domain: { name: 'Seaport', verifyingContract: USDC },
      primaryType: 'OrderComponents',
      message: {},
    };
    expect(decodeRequest(req('eth_signTypedData_v4', [USER, other]), ctx).actions[0]).toEqual({
      kind: 'unknownTypedData',
      primaryType: 'OrderComponents',
      domainName: 'Seaport',
      verifyingContract: USDC,
    });
    expect(decodeRequest(req('eth_signTypedData_v4', [USER, '{oops'], ATTACKER), ctx)).toEqual({
      signer: USER,
      actions: [{ kind: 'unknownTypedData', reason: 'typed data 형식 오류' }],
    });
    expect(decodeRequest(req('eth_signTypedData_v4', 'x', ATTACKER), ctx).signer).toBe(ATTACKER);
  });

  it('opaque signatures', () => {
    expect(decodeRequest(req('personal_sign', ['0x68656c6c6f', USER]), ctx)).toEqual({
      signer: USER,
      actions: [{ kind: 'opaqueSign', method: 'personal_sign' }],
    });
    expect(decodeRequest(req('eth_sign', [USER, '0x00']), ctx).signer).toBe(USER);
    expect(decodeRequest(req('eth_signTypedData', [[{ type: 'string' }], USER]), ctx)).toEqual({
      signer: USER,
      actions: [{ kind: 'opaqueSign', method: 'eth_signTypedData' }],
    });
  });
});
