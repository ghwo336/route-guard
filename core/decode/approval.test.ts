import { encodeFunctionData, parseAbi } from 'viem';
import { describe, expect, it } from 'vitest';
import { ATTACKER, TOKENS, USER } from '../fixtures/addresses';
import { eip2612Permit, permit2Batch, permit2Single, permit2Witness } from '../fixtures/typedData';
import { wl } from '../fixtures/whitelist';
import { decodeApprovalTx, decodePermit, decodePermit2 } from './approval';
import { parseTypedData, splitTypedDataParams } from './typedData';
import { isUnlimited, toBigInt } from './util';

const abi = parseAbi([
  'function approve(address spender, uint256 amount)',
  'function increaseAllowance(address spender, uint256 addedValue)',
  'function setApprovalForAll(address operator, bool approved)',
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
  'function transfer(address to, uint256 amount)',
]);
const MAX256 = 2n ** 256n - 1n;
const USDC = TOKENS.mainnetUSDC;
const PERMIT2 = wl(1, 'uniswap', 'Permit2');
const UR = wl(1, 'uniswap', 'UniversalRouter 2.0');

describe('decodeApprovalTx', () => {
  it('approve(Permit2, MAX)', () => {
    const data = encodeFunctionData({ abi, functionName: 'approve', args: [PERMIT2, MAX256] });
    expect(decodeApprovalTx(USDC, data)).toEqual({
      kind: 'approve',
      fn: 'approve',
      to: USDC,
      token: USDC,
      spender: PERMIT2,
      amount: MAX256,
    });
  });

  it('increaseAllowance', () => {
    const data = encodeFunctionData({
      abi,
      functionName: 'increaseAllowance',
      args: [ATTACKER, 5n],
    });
    expect(decodeApprovalTx(USDC, data)).toMatchObject({
      fn: 'increaseAllowance',
      spender: ATTACKER,
      amount: 5n,
    });
  });

  it('setApprovalForAll', () => {
    const data = encodeFunctionData({
      abi,
      functionName: 'setApprovalForAll',
      args: [ATTACKER, true],
    });
    expect(decodeApprovalTx(TOKENS.nft, data)).toEqual({
      kind: 'setApprovalForAll',
      to: TOKENS.nft,
      operator: ATTACKER,
      approved: true,
    });
  });

  it('Permit2.approve sent as a tx', () => {
    const data = encodeFunctionData({
      abi,
      functionName: 'approve',
      args: [USDC, ATTACKER, 2n ** 160n - 1n, 1900000000],
    });
    expect(decodeApprovalTx(PERMIT2, data)).toMatchObject({
      fn: 'permit2Approve',
      to: PERMIT2,
      token: USDC,
      spender: ATTACKER,
    });
  });

  it('ignores other selectors', () => {
    const data = encodeFunctionData({ abi, functionName: 'transfer', args: [USER, 1n] });
    expect(decodeApprovalTx(USDC, data)).toBeUndefined();
  });

  it('throws on truncated calldata with a known selector (dispatcher catches it)', () => {
    expect(() => decodeApprovalTx(USDC, '0x095ea7b30000')).toThrow();
  });
});

describe('decodePermit2', () => {
  it('PermitSingle (Uniswap frontend shape, JSON string)', () => {
    const td = parseTypedData(
      JSON.stringify(permit2Single({ chainId: 1, token: USDC, spender: UR })),
    )!;
    const a = decodePermit2(td)!;
    expect(a).toMatchObject({
      primaryType: 'PermitSingle',
      spender: UR,
      verifyingContract: PERMIT2,
    });
    expect(a.permitted).toEqual([{ token: USDC, amount: 2n ** 160n - 1n }]);
    expect(isUnlimited(a.permitted[0]!.amount)).toBe(true);
  });

  it('PermitBatch', () => {
    const td = parseTypedData(
      permit2Batch({ chainId: 1, tokens: [USDC, TOKENS.nft], spender: ATTACKER }),
    )!;
    expect(decodePermit2(td)?.permitted.map((p) => p.token)).toEqual([USDC, TOKENS.nft]);
  });

  it('PermitWitnessTransferFrom (UniswapX)', () => {
    const reactor = wl(1, 'uniswap', 'V2DutchOrderReactor (UniswapX)');
    const td = parseTypedData(
      permit2Witness({ chainId: 1, token: USDC, spender: reactor, amount: '100000000' }),
    )!;
    expect(decodePermit2(td)).toMatchObject({
      primaryType: 'PermitWitnessTransferFrom',
      spender: reactor,
      permitted: [{ token: USDC, amount: 100000000n }],
    });
  });

  it('keeps a forged verifyingContract for the rules to reject', () => {
    const td = parseTypedData(
      permit2Single({ chainId: 1, token: USDC, spender: UR, verifyingContract: ATTACKER }),
    )!;
    expect(decodePermit2(td)?.verifyingContract).toBe(ATTACKER);
  });

  it('returns undefined for non-Permit2 or malformed messages', () => {
    const p = permit2Single({ chainId: 1, token: USDC, spender: UR });
    expect(decodePermit2(parseTypedData({ ...p, domain: { name: 'Other' } })!)).toBeUndefined();
    expect(
      decodePermit2(parseTypedData({ ...p, message: { ...p.message, spender: 'nope' } })!),
    ).toBeUndefined();
    expect(
      decodePermit2(parseTypedData({ ...p, message: { ...p.message, details: { token: USDC } } })!),
    ).toBeUndefined();
    expect(
      decodePermit2(parseTypedData({ ...p, message: { ...p.message, details: [] } })!),
    ).toBeUndefined();
  });
});

describe('decodePermit (EIP-2612)', () => {
  it('USDC permit', () => {
    const td = parseTypedData(
      eip2612Permit({ chainId: 1, token: USDC, owner: USER, spender: ATTACKER, value: '7' }),
    )!;
    expect(decodePermit(td)).toEqual({
      kind: 'permit',
      verifyingContract: USDC,
      owner: USER,
      spender: ATTACKER,
      amount: 7n,
    });
  });

  it('DAI-style permit (holder / allowed)', () => {
    const base = eip2612Permit({
      chainId: 1,
      token: USDC,
      owner: USER,
      spender: ATTACKER,
      value: '0',
    });
    const mk = (allowed: boolean) =>
      parseTypedData({
        ...base,
        message: { holder: USER, spender: ATTACKER, nonce: 0, expiry: 0, allowed },
      })!;
    expect(decodePermit(mk(true))?.amount).toBe(MAX256);
    expect(decodePermit(mk(false))).toMatchObject({ amount: 0n, owner: USER });
  });

  it('returns undefined when not a Permit or fields are missing', () => {
    const base = eip2612Permit({
      chainId: 1,
      token: USDC,
      owner: USER,
      spender: ATTACKER,
      value: '1',
    });
    expect(decodePermit(parseTypedData({ ...base, primaryType: 'Other' })!)).toBeUndefined();
    expect(
      decodePermit(parseTypedData({ ...base, message: { ...base.message, spender: 1 } })!),
    ).toBeUndefined();
    expect(
      decodePermit(parseTypedData({ ...base, message: { ...base.message, value: 'x' } })!),
    ).toBeUndefined();
  });
});

describe('typed data helpers', () => {
  it('parseTypedData rejects junk', () => {
    expect(parseTypedData('{not json')).toBeUndefined();
    expect(parseTypedData(42)).toBeUndefined();
    expect(parseTypedData({ domain: {}, primaryType: 1, message: {} })).toBeUndefined();
  });

  it('parseTypedData tolerates missing types', () => {
    expect(parseTypedData({ domain: {}, primaryType: 'X', message: {} })?.types).toEqual({});
  });

  it('splitTypedDataParams handles both orders and rejects ambiguity', () => {
    expect(splitTypedDataParams([USER, '{}'])).toEqual({ signer: USER, payload: '{}' });
    expect(splitTypedDataParams(['{}', USER])).toEqual({ signer: USER, payload: '{}' });
    expect(splitTypedDataParams([USER, USER])).toBeUndefined();
    expect(splitTypedDataParams([USER])).toBeUndefined();
    expect(splitTypedDataParams('x')).toBeUndefined();
  });

  it('toBigInt', () => {
    expect(toBigInt('0x10')).toBe(16n);
    expect(toBigInt(' 12 ')).toBe(12n);
    expect(toBigInt(3)).toBe(3n);
    expect(toBigInt(1.5)).toBeUndefined();
    expect(toBigInt('1e3')).toBeUndefined();
    expect(toBigInt(null)).toBeUndefined();
    expect(toBigInt(5n)).toBe(5n);
  });
});
