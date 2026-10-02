import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  numberToHex,
  parseAbi,
  parseAbiParameters,
  type Address,
  type Hex,
} from 'viem';

export const MSG_SENDER: Address = '0x0000000000000000000000000000000000000001';
export const ADDRESS_THIS: Address = '0x0000000000000000000000000000000000000002';
export const ETH: Address = '0x0000000000000000000000000000000000000000';

export type Cmd = { cmd: number; input: Hex };

const byte = (n: number) => numberToHex(n, { size: 1 });

export function v3Path(tokens: Address[], fee = 3000): Hex {
  const parts: Hex[] = [];
  tokens.forEach((t, i) => {
    parts.push(t);
    if (i < tokens.length - 1) parts.push(numberToHex(fee, { size: 3 }));
  });
  return concatHex(parts);
}

/** V3_SWAP_EXACT_IN. `withHopPrices` appends UR >= 2.1.1's trailing minHopPriceX36. */
export function v3ExactIn(o: {
  recipient: Address;
  amountIn: bigint;
  amountOutMin: bigint;
  path: Address[];
  withHopPrices?: boolean;
}): Cmd {
  const input = o.withHopPrices
    ? encodeAbiParameters(parseAbiParameters('address, uint256, uint256, bytes, bool, uint256[]'), [
        o.recipient,
        o.amountIn,
        o.amountOutMin,
        v3Path(o.path),
        true,
        [0n],
      ])
    : encodeAbiParameters(parseAbiParameters('address, uint256, uint256, bytes, bool'), [
        o.recipient,
        o.amountIn,
        o.amountOutMin,
        v3Path(o.path),
        true,
      ]);
  return { cmd: 0x00, input };
}

/** V3_SWAP_EXACT_OUT (path reversed: tokenOut first). */
export function v3ExactOut(o: {
  recipient: Address;
  amountOut: bigint;
  amountInMax: bigint;
  path: Address[];
}): Cmd {
  return {
    cmd: 0x01,
    input: encodeAbiParameters(parseAbiParameters('address, uint256, uint256, bytes, bool'), [
      o.recipient,
      o.amountOut,
      o.amountInMax,
      v3Path([...o.path].reverse()),
      true,
    ]),
  };
}

export function v2Swap(o: {
  exactIn: boolean;
  recipient: Address;
  a: bigint;
  b: bigint;
  path: Address[];
}): Cmd {
  return {
    cmd: o.exactIn ? 0x08 : 0x09,
    input: encodeAbiParameters(parseAbiParameters('address, uint256, uint256, address[], bool'), [
      o.recipient,
      o.a,
      o.b,
      o.path,
      true,
    ]),
  };
}

const tra =
  (cmd: number) =>
  (token: Address, recipient: Address, amount: bigint): Cmd => ({
    cmd,
    input: encodeAbiParameters(parseAbiParameters('address, address, uint256'), [
      token,
      recipient,
      amount,
    ]),
  });

export const permit2TransferFrom = tra(0x02);
export const sweep = tra(0x04);
export const transferCmd = tra(0x05);
export const payPortion = tra(0x06);

export const wrapEth = (recipient: Address, amount: bigint): Cmd => ({
  cmd: 0x0b,
  input: encodeAbiParameters(parseAbiParameters('address, uint256'), [recipient, amount]),
});

export const unwrapWeth = (recipient: Address, amountMin: bigint): Cmd => ({
  cmd: 0x0c,
  input: encodeAbiParameters(parseAbiParameters('address, uint256'), [recipient, amountMin]),
});

export const permit2TransferFromBatch = (
  items: { from: Address; to: Address; amount: bigint; token: Address }[],
): Cmd => ({
  cmd: 0x0d,
  input: encodeAbiParameters(parseAbiParameters('(address, address, uint160, address)[]'), [
    items.map((i) => [i.from, i.to, i.amount, i.token] as const),
  ]),
});

export const balanceCheck = (owner: Address, token: Address, minBalance: bigint): Cmd => ({
  cmd: 0x0e,
  input: encodeAbiParameters(parseAbiParameters('address, address, uint256'), [
    owner,
    token,
    minBalance,
  ]),
});

export const subPlan = (cmds: Cmd[]): Cmd => ({
  cmd: 0x21,
  input: encodeAbiParameters(parseAbiParameters('bytes, bytes[]'), [
    concatHex(['0x', ...cmds.map((c) => byte(c.cmd))]),
    cmds.map((c) => c.input),
  ]),
});

export const rawCmd = (cmd: number, input: Hex = '0x'): Cmd => ({ cmd, input });

// --- v4 -------------------------------------------------------------------

export type Action = { act: number; param: Hex };
type PoolKey = readonly [Address, Address, number, number, Address];
const POOL_KEY = '(address, address, uint24, int24, address)';
const PATH_KEY = '(address, uint256, int24, address, bytes)';

export function poolKey(a: Address, b: Address): PoolKey {
  const [c0, c1] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return [c0, c1, 3000, 60, ETH];
}

export function v4ExactInSingle(o: {
  layout: '2.0' | '2.1.1';
  key: PoolKey;
  zeroForOne: boolean;
  amountIn: bigint;
  amountOutMinimum: bigint;
}): Action {
  const param =
    o.layout === '2.0'
      ? encodeAbiParameters(parseAbiParameters(`(${POOL_KEY}, bool, uint128, uint128, bytes)`), [
          [o.key, o.zeroForOne, o.amountIn, o.amountOutMinimum, '0x'],
        ])
      : encodeAbiParameters(
          parseAbiParameters(`(${POOL_KEY}, bool, uint128, uint128, uint256, bytes)`),
          [[o.key, o.zeroForOne, o.amountIn, o.amountOutMinimum, 0n, '0x']],
        );
  return { act: 0x06, param };
}

export function v4ExactIn(o: {
  layout: '2.0' | '2.1.1';
  currencyIn: Address;
  path: Address[];
  amountIn: bigint;
  amountOutMinimum: bigint;
}): Action {
  const pk = o.path.map((c) => [c, 3000n, 60, ETH, '0x'] as const);
  const param =
    o.layout === '2.0'
      ? encodeAbiParameters(parseAbiParameters(`(address, ${PATH_KEY}[], uint128, uint128)`), [
          [o.currencyIn, pk, o.amountIn, o.amountOutMinimum],
        ])
      : encodeAbiParameters(
          parseAbiParameters(`(address, ${PATH_KEY}[], uint256[], uint128, uint128)`),
          [[o.currencyIn, pk, pk.map(() => 0n), o.amountIn, o.amountOutMinimum]],
        );
  return { act: 0x07, param };
}

export function v4ExactOutSingle(o: {
  key: PoolKey;
  zeroForOne: boolean;
  amountOut: bigint;
}): Action {
  return {
    act: 0x08,
    param: encodeAbiParameters(
      parseAbiParameters(`(${POOL_KEY}, bool, uint128, uint128, uint256, bytes)`),
      [[o.key, o.zeroForOne, o.amountOut, 2n ** 100n, 0n, '0x']],
    ),
  };
}

export function v4ExactOut(o: {
  currencyOut: Address;
  path: Address[];
  amountOut: bigint;
}): Action {
  const pk = o.path.map((c) => [c, 3000n, 60, ETH, '0x'] as const);
  return {
    act: 0x09,
    param: encodeAbiParameters(
      parseAbiParameters(`(address, ${PATH_KEY}[], uint256[], uint128, uint128)`),
      [[o.currencyOut, pk, pk.map(() => 0n), o.amountOut, 2n ** 100n]],
    ),
  };
}

const ca =
  (act: number) =>
  (currency: Address, amount: bigint): Action => ({
    act,
    param: encodeAbiParameters(parseAbiParameters('address, uint256'), [currency, amount]),
  });
export const v4SettleAll = ca(0x0c);
export const v4TakeAll = ca(0x0f);

export const v4Settle = (currency: Address, amount: bigint, payerIsUser: boolean): Action => ({
  act: 0x0b,
  param: encodeAbiParameters(parseAbiParameters('address, uint256, bool'), [
    currency,
    amount,
    payerIsUser,
  ]),
});

const cra =
  (act: number) =>
  (currency: Address, recipient: Address, amount: bigint): Action => ({
    act,
    param: encodeAbiParameters(parseAbiParameters('address, address, uint256'), [
      currency,
      recipient,
      amount,
    ]),
  });
export const v4Take = cra(0x0e);
export const v4TakePortion = cra(0x10);

export const v4TakePair = (c0: Address, c1: Address, recipient: Address): Action => ({
  act: 0x11,
  param: encodeAbiParameters(parseAbiParameters('address, address, address'), [c0, c1, recipient]),
});

export const v4Sweep = (currency: Address, recipient: Address): Action => ({
  act: 0x14,
  param: encodeAbiParameters(parseAbiParameters('address, address'), [currency, recipient]),
});

export const v4Raw = (act: number, param: Hex = '0x'): Action => ({ act, param });

export const v4Swap = (actions: Action[]): Cmd => ({
  cmd: 0x10,
  input: encodeAbiParameters(parseAbiParameters('bytes, bytes[]'), [
    concatHex(['0x', ...actions.map((a) => byte(a.act))]),
    actions.map((a) => a.param),
  ]),
});

// --- entry points ---------------------------------------------------------

const UR_ABI = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
  'function execute(bytes commands, bytes[] inputs) payable',
]);

export function urExecute(cmds: Cmd[], opts: { deadline?: boolean } = {}): Hex {
  const commands = concatHex(['0x', ...cmds.map((c) => byte(c.cmd))]);
  const inputs = cmds.map((c) => c.input);
  return opts.deadline === false
    ? encodeFunctionData({ abi: UR_ABI, functionName: 'execute', args: [commands, inputs] })
    : encodeFunctionData({
        abi: UR_ABI,
        functionName: 'execute',
        args: [commands, inputs, 1900000000n],
      });
}

const PROXY_ABI = parseAbi([
  'function execute(address router, address token, uint256 amount, bytes commands, bytes[] inputs, uint256 deadline)',
]);

export function swapProxyExecute(
  router: Address,
  token: Address,
  amount: bigint,
  cmds: Cmd[],
): Hex {
  return encodeFunctionData({
    abi: PROXY_ABI,
    functionName: 'execute',
    args: [
      router,
      token,
      amount,
      concatHex(['0x', ...cmds.map((c) => byte(c.cmd))]),
      cmds.map((c) => c.input),
      1900000000n,
    ],
  });
}

const SR02_ABI = parseAbi([
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable',
  'function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) payable',
  'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable',
  'function exactOutput((bytes path, address recipient, uint256 amountOut, uint256 amountInMaximum) params) payable',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to) payable',
  'function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to) payable',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
  'function unwrapWETH9(uint256 amountMinimum) payable',
  'function unwrapWETH9WithFee(uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable',
  'function unwrapWETH9WithFee(uint256 amountMinimum, uint256 feeBips, address feeRecipient) payable',
  'function sweepToken(address token, uint256 amountMinimum, address recipient) payable',
  'function sweepToken(address token, uint256 amountMinimum) payable',
  'function sweepTokenWithFee(address token, uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable',
  'function sweepTokenWithFee(address token, uint256 amountMinimum, uint256 feeBips, address feeRecipient) payable',
  'function refundETH() payable',
  'function multicall(bytes[] data) payable',
  'function multicall(uint256 deadline, bytes[] data) payable',
  'function multicall(bytes32 previousBlockhash, bytes[] data) payable',
]);

export const sr02 = {
  abi: SR02_ABI,
  call: (functionName: string, args: readonly unknown[]): Hex =>
    encodeFunctionData({ abi: SR02_ABI, functionName, args } as never),
};
