import {
  decodeAbiParameters,
  decodeFunctionData,
  getAddress,
  parseAbi,
  parseAbiParameters,
  sliceHex,
  toFunctionSelector,
  type Address,
  type Hex,
} from 'viem';
import type { RouterCallAction, RouterKind } from '../types';

// ---------------------------------------------------------------------------
// Sentinels. Same values in universal-router (v4-periphery ActionConstants),
// and swap-router-contracts (libraries/Constants.sol):
//   MSG_SENDER = address(1), ADDRESS_THIS = address(2)
// ---------------------------------------------------------------------------
export const MSG_SENDER: Address = '0x0000000000000000000000000000000000000001';
export const ADDRESS_THIS: Address = '0x0000000000000000000000000000000000000002';
/** Native ETH as a currency in UniversalRouter / v4 (Constants.ETH = address(0)). */
export const ETH: Address = '0x0000000000000000000000000000000000000000';
/** v4 ActionConstants.CONTRACT_BALANCE */
const CONTRACT_BALANCE = 2n ** 255n;

export function isSentinel(a: Address): boolean {
  const x = getAddress(a);
  return x === MSG_SENDER || x === ADDRESS_THIS;
}

// ---------------------------------------------------------------------------
// UniversalRouter commands (universal-router contracts/libraries/Commands.sol)
// ---------------------------------------------------------------------------
const CMD = {
  V3_SWAP_EXACT_IN: 0x00,
  V3_SWAP_EXACT_OUT: 0x01,
  PERMIT2_TRANSFER_FROM: 0x02,
  PERMIT2_PERMIT_BATCH: 0x03,
  SWEEP: 0x04,
  TRANSFER: 0x05,
  PAY_PORTION: 0x06,
  PAY_PORTION_FULL_PRECISION: 0x07,
  V2_SWAP_EXACT_IN: 0x08,
  V2_SWAP_EXACT_OUT: 0x09,
  PERMIT2_PERMIT: 0x0a,
  WRAP_ETH: 0x0b,
  UNWRAP_WETH: 0x0c,
  PERMIT2_TRANSFER_FROM_BATCH: 0x0d,
  BALANCE_CHECK_ERC20: 0x0e,
  V4_SWAP: 0x10,
  V3_POSITION_MANAGER_PERMIT: 0x11,
  V3_POSITION_MANAGER_CALL: 0x12,
  V4_INITIALIZE_POOL: 0x13,
  V4_POSITION_MANAGER_CALL: 0x14,
  EXECUTE_SUB_PLAN: 0x21,
  ACROSS_V4_DEPOSIT_V3: 0x40,
} as const;
const COMMAND_TYPE_MASK = 0x7f;

// v4-periphery src/libraries/Actions.sol
const ACT = {
  SWAP_EXACT_IN_SINGLE: 0x06,
  SWAP_EXACT_IN: 0x07,
  SWAP_EXACT_OUT_SINGLE: 0x08,
  SWAP_EXACT_OUT: 0x09,
  SETTLE: 0x0b,
  SETTLE_ALL: 0x0c,
  SETTLE_PAIR: 0x0d,
  TAKE: 0x0e,
  TAKE_ALL: 0x0f,
  TAKE_PORTION: 0x10,
  TAKE_PAIR: 0x11,
  CLOSE_CURRENCY: 0x12,
  CLEAR_OR_TAKE: 0x13,
  SWEEP: 0x14,
  WRAP: 0x15,
  UNWRAP: 0x16,
} as const;

// Command inputs. Only the leading (static-offset) fields are decoded; UR >= 2.1.1 appends
// `uint256[] minHopPriceX36` to swap inputs, which this prefix decoding tolerates.
const P = {
  swap: parseAbiParameters('address, uint256, uint256, bytes, bool'),
  v2swap: parseAbiParameters('address, uint256, uint256, address[], bool'),
  tokenRecipientAmount: parseAbiParameters('address, address, uint256'),
  recipientAmount: parseAbiParameters('address, uint256'),
  balanceCheck: parseAbiParameters('address, address, uint256'),
  transferBatch: parseAbiParameters('(address, address, uint160, address)[]'),
  subPlan: parseAbiParameters('bytes, bytes[]'),
  v4: parseAbiParameters('bytes, bytes[]'),
  currencyAmount: parseAbiParameters('address, uint256'),
  currencyRecipientAmount: parseAbiParameters('address, address, uint256'),
  takePair: parseAbiParameters('address, address, address'),
  currencyRecipient: parseAbiParameters('address, address'),
};

// v4 swap structs (v4-sdk V4Planner). UR 2.0 vs >= 2.1.1 (adds minHopPriceX36).
const POOL_KEY = '(address, address, uint24, int24, address)';
const PATH_KEY = '(address, uint256, int24, address, bytes)';
const V4_STRUCTS = {
  '2.0': {
    inSingle: parseAbiParameters(`(${POOL_KEY}, bool, uint128, uint128, bytes)`),
    in: parseAbiParameters(`(address, ${PATH_KEY}[], uint128, uint128)`),
    outSingle: parseAbiParameters(`(${POOL_KEY}, bool, uint128, uint128, bytes)`),
    out: parseAbiParameters(`(address, ${PATH_KEY}[], uint128, uint128)`),
  },
  '2.1.1': {
    inSingle: parseAbiParameters(`(${POOL_KEY}, bool, uint128, uint128, uint256, bytes)`),
    in: parseAbiParameters(`(address, ${PATH_KEY}[], uint256[], uint128, uint128)`),
    outSingle: parseAbiParameters(`(${POOL_KEY}, bool, uint128, uint128, uint256, bytes)`),
    out: parseAbiParameters(`(address, ${PATH_KEY}[], uint256[], uint128, uint128)`),
  },
};

type UrFamily = '1.2' | '2.0' | '2.1.1';

/** Map a whitelist `version` to the decoding family. Unknown → newest layout. */
export function urFamily(version: string | undefined): UrFamily {
  if (version === undefined) return '2.1.1';
  const [maj = 0, min = 0, patch = 0] = version.split('.').map((n) => Number(n));
  if (maj < 2) return '1.2';
  if (maj === 2 && min === 0) return '2.0';
  if (maj === 2 && min === 1 && patch < 1) return '2.0';
  return '2.1.1';
}

const UR_ABI = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
  'function execute(bytes commands, bytes[] inputs) payable',
]);

// universal-router-sdk swapRouter.ts PROXY_INTERFACE
const SWAP_PROXY_ABI = parseAbi([
  'function execute(address router, address token, uint256 amount, bytes commands, bytes[] inputs, uint256 deadline)',
]);

// swap-router-contracts: IV3SwapRouter, IV2SwapRouter, IPeripheryPaymentsWithFeeExtended,
// IMulticallExtended, ISelfPermit
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
  'function wrapETH(uint256 value) payable',
  'function pull(address token, uint256 value) payable',
  'function selfPermit(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable',
  'function selfPermitIfNecessary(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable',
  'function selfPermitAllowed(address token, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) payable',
  'function selfPermitAllowedIfNecessary(address token, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) payable',
  'function multicall(bytes[] data) payable',
  'function multicall(uint256 deadline, bytes[] data) payable',
  'function multicall(bytes32 previousBlockhash, bytes[] data) payable',
]);

const selectorsOf = (abi: readonly Parameters<typeof toFunctionSelector>[0][]) =>
  new Set(abi.map((f) => toFunctionSelector(f).toLowerCase()));
const UR_SELECTORS = selectorsOf(UR_ABI);
const PROXY_SELECTORS = selectorsOf(SWAP_PROXY_ABI);
const SR02_SELECTORS = selectorsOf(SR02_ABI);

const MAX_DEPTH = 4;

// ---------------------------------------------------------------------------

type Acc = {
  recipients: Address[];
  hasSwap: boolean;
  tokenOut?: Address;
  /** Output floors seen anywhere in the call. The strongest one protects the trade. */
  floors: bigint[];
  errors: string[];
};

const newAcc = (): Acc => ({ recipients: [], hasSwap: false, floors: [], errors: [] });

const hex2 = (n: number) => `0x${n.toString(16).padStart(2, '0')}`;

function v3PathTokenOut(path: Hex, exactIn: boolean): Address {
  // path = token(20) | fee(3) | token(20) | ...; exact-out paths are encoded reversed
  const bytes = (path.length - 2) / 2;
  if (bytes < 43) throw new Error('v3 path too short');
  return getAddress(exactIn ? sliceHex(path, bytes - 20, bytes) : sliceHex(path, 0, 20));
}

function decodeUrCommands(
  commands: Hex,
  inputs: readonly Hex[],
  family: UrFamily,
  acc: Acc,
  depth: number,
): void {
  const n = (commands.length - 2) / 2;
  if (n !== inputs.length) acc.errors.push('commands/inputs 길이 불일치');
  for (let i = 0; i < Math.min(n, inputs.length); i++) {
    const cmd = parseInt(commands.slice(2 + i * 2, 4 + i * 2), 16) & COMMAND_TYPE_MASK;
    try {
      decodeUrCommand(cmd, inputs[i]!, family, acc, depth);
    } catch (e) {
      acc.errors.push(`command ${hex2(cmd)} 디코딩 실패: ${(e as Error).message.split('\n')[0]}`);
    }
  }
}

function decodeUrCommand(cmd: number, input: Hex, family: UrFamily, acc: Acc, depth: number) {
  switch (cmd) {
    case CMD.V3_SWAP_EXACT_IN:
    case CMD.V3_SWAP_EXACT_OUT: {
      const [recipient, a, b, path] = decodeAbiParameters(P.swap, input);
      const exactIn = cmd === CMD.V3_SWAP_EXACT_IN;
      acc.hasSwap = true;
      acc.recipients.push(recipient);
      acc.tokenOut = v3PathTokenOut(path, exactIn);
      // exact-in: b = amountOutMin. exact-out: a = amountOut, enforced by the v3 pool callback.
      acc.floors.push(exactIn ? b : a);
      return;
    }
    case CMD.V2_SWAP_EXACT_IN:
    case CMD.V2_SWAP_EXACT_OUT: {
      const [recipient, , b, path] = decodeAbiParameters(P.v2swap, input);
      acc.hasSwap = true;
      acc.recipients.push(recipient);
      const last = path[path.length - 1];
      if (last) acc.tokenOut = last;
      // v2 exact-out does not check the output (sdk: needs custody + SWEEP floor), so only
      // exact-in contributes a floor.
      if (cmd === CMD.V2_SWAP_EXACT_IN) acc.floors.push(b);
      return;
    }
    case CMD.PERMIT2_TRANSFER_FROM:
    case CMD.TRANSFER:
    case CMD.PAY_PORTION:
    case CMD.PAY_PORTION_FULL_PRECISION: {
      if (cmd === CMD.PAY_PORTION_FULL_PRECISION && family === '1.2') break;
      const [, recipient] = decodeAbiParameters(P.tokenRecipientAmount, input);
      acc.recipients.push(recipient);
      return;
    }
    case CMD.SWEEP: {
      const [token, recipient, amountMin] = decodeAbiParameters(P.tokenRecipientAmount, input);
      acc.recipients.push(recipient);
      acc.tokenOut = token;
      acc.floors.push(amountMin);
      return;
    }
    case CMD.WRAP_ETH: {
      const [recipient] = decodeAbiParameters(P.recipientAmount, input);
      acc.recipients.push(recipient);
      return;
    }
    case CMD.UNWRAP_WETH: {
      const [recipient, amountMin] = decodeAbiParameters(P.recipientAmount, input);
      acc.recipients.push(recipient);
      acc.tokenOut = ETH;
      acc.floors.push(amountMin);
      return;
    }
    case CMD.PERMIT2_TRANSFER_FROM_BATCH: {
      const [details] = decodeAbiParameters(P.transferBatch, input);
      for (const [, to] of details) acc.recipients.push(to);
      return;
    }
    case CMD.BALANCE_CHECK_ERC20: {
      const [, , minBalance] = decodeAbiParameters(P.balanceCheck, input);
      acc.floors.push(minBalance);
      return;
    }
    case CMD.PERMIT2_PERMIT:
    case CMD.PERMIT2_PERMIT_BATCH:
      // Executes a Permit2 signature the user already produced (and we already checked).
      return;
    case CMD.EXECUTE_SUB_PLAN: {
      if (family === '1.2') break;
      if (depth >= MAX_DEPTH) throw new Error('sub plan 중첩이 너무 깊음');
      const [c, ins] = decodeAbiParameters(P.subPlan, input);
      decodeUrCommands(c, ins, family, acc, depth + 1);
      return;
    }
    case CMD.V4_SWAP:
      if (family === '1.2') break;
      decodeV4Actions(input, family, acc);
      return;
    case CMD.V4_INITIALIZE_POOL:
      if (family === '1.2') break;
      return;
    case CMD.V3_POSITION_MANAGER_PERMIT:
    case CMD.V3_POSITION_MANAGER_CALL:
    case CMD.V4_POSITION_MANAGER_CALL:
      if (family === '1.2') break;
      throw new Error('포지션 매니저 호출은 해석하지 않음');
    case CMD.ACROSS_V4_DEPOSIT_V3:
      throw new Error('브리지 호출은 해석하지 않음');
  }
  throw new Error('알 수 없는 command');
}

function decodeV4Actions(input: Hex, family: UrFamily, acc: Acc) {
  const [actions, params] = decodeAbiParameters(P.v4, input);
  const structs = V4_STRUCTS[family === '2.0' ? '2.0' : '2.1.1'];
  const n = (actions.length - 2) / 2;
  if (n !== params.length) throw new Error('v4 actions/params 길이 불일치');
  for (let i = 0; i < n; i++) {
    const act = parseInt(actions.slice(2 + i * 2, 4 + i * 2), 16);
    const p = params[i]!;
    switch (act) {
      case ACT.SWAP_EXACT_IN_SINGLE: {
        const [s] = decodeAbiParameters(structs.inSingle, p);
        const [key, zeroForOne, , amountOutMinimum] = s;
        acc.hasSwap = true;
        acc.tokenOut = zeroForOne ? key[1] : key[0];
        acc.floors.push(amountOutMinimum);
        break;
      }
      case ACT.SWAP_EXACT_IN: {
        const [s] = decodeAbiParameters(structs.in, p);
        const path = s[1];
        const amountOutMinimum = s[s.length - 1] as bigint;
        acc.hasSwap = true;
        const last = path[path.length - 1];
        if (last) acc.tokenOut = last[0];
        acc.floors.push(amountOutMinimum);
        break;
      }
      case ACT.SWAP_EXACT_OUT_SINGLE: {
        const [s] = decodeAbiParameters(structs.outSingle, p);
        acc.hasSwap = true;
        acc.tokenOut = s[1] ? s[0][1] : s[0][0];
        // exact-out delivery is floored by an exact TAKE (sdk), not by the swap itself
        break;
      }
      case ACT.SWAP_EXACT_OUT: {
        const [s] = decodeAbiParameters(structs.out, p);
        acc.hasSwap = true;
        acc.tokenOut = s[0];
        break;
      }
      case ACT.TAKE: {
        const [currency, recipient, amount] = decodeAbiParameters(P.currencyRecipientAmount, p);
        acc.recipients.push(recipient);
        acc.tokenOut = currency;
        // 0 = OPEN_DELTA (take everything); otherwise an exact amount acts as a floor
        if (amount !== 0n && amount !== CONTRACT_BALANCE) acc.floors.push(amount);
        break;
      }
      case ACT.TAKE_ALL: {
        const [currency, minAmount] = decodeAbiParameters(P.currencyAmount, p);
        acc.recipients.push(MSG_SENDER);
        acc.tokenOut = currency;
        acc.floors.push(minAmount);
        break;
      }
      case ACT.TAKE_PORTION: {
        const [, recipient] = decodeAbiParameters(P.currencyRecipientAmount, p);
        acc.recipients.push(recipient);
        break;
      }
      case ACT.TAKE_PAIR: {
        const [, , recipient] = decodeAbiParameters(P.takePair, p);
        acc.recipients.push(recipient);
        break;
      }
      case ACT.SWEEP: {
        const [, recipient] = decodeAbiParameters(P.currencyRecipient, p);
        acc.recipients.push(recipient);
        break;
      }
      case ACT.CLEAR_OR_TAKE:
        // takes to msgSender if the delta exceeds amountMax
        acc.recipients.push(MSG_SENDER);
        break;
      case ACT.SETTLE:
      case ACT.SETTLE_ALL:
      case ACT.SETTLE_PAIR:
      case ACT.CLOSE_CURRENCY:
      case ACT.WRAP:
      case ACT.UNWRAP:
        break;
      default:
        throw new Error(`알 수 없는 v4 action ${hex2(act)}`);
    }
  }
}

function decodeSr02(data: Hex, acc: Acc, depth: number): void {
  const { functionName, args } = decodeFunctionData({ abi: SR02_ABI, data });
  switch (functionName) {
    case 'exactInputSingle': {
      const [p] = args;
      acc.hasSwap = true;
      acc.recipients.push(p.recipient);
      acc.tokenOut = p.tokenOut;
      acc.floors.push(p.amountOutMinimum);
      return;
    }
    case 'exactInput': {
      const [p] = args;
      acc.hasSwap = true;
      acc.recipients.push(p.recipient);
      acc.tokenOut = v3PathTokenOut(p.path, true);
      acc.floors.push(p.amountOutMinimum);
      return;
    }
    case 'exactOutputSingle': {
      const [p] = args;
      acc.hasSwap = true;
      acc.recipients.push(p.recipient);
      acc.tokenOut = p.tokenOut;
      acc.floors.push(p.amountOut);
      return;
    }
    case 'exactOutput': {
      const [p] = args;
      acc.hasSwap = true;
      acc.recipients.push(p.recipient);
      acc.tokenOut = v3PathTokenOut(p.path, false);
      acc.floors.push(p.amountOut);
      return;
    }
    case 'swapExactTokensForTokens': {
      const [, amountOutMin, path, to] = args;
      acc.hasSwap = true;
      acc.recipients.push(to);
      const last = path[path.length - 1];
      if (last) acc.tokenOut = last;
      acc.floors.push(amountOutMin);
      return;
    }
    case 'swapTokensForExactTokens': {
      const [amountOut, , path, to] = args;
      acc.hasSwap = true;
      acc.recipients.push(to);
      const last = path[path.length - 1];
      if (last) acc.tokenOut = last;
      acc.floors.push(amountOut);
      return;
    }
    case 'unwrapWETH9':
    case 'unwrapWETH9WithFee': {
      const [amountMinimum] = args;
      acc.tokenOut = ETH;
      acc.floors.push(amountMinimum);
      if (functionName === 'unwrapWETH9') {
        acc.recipients.push(args.length === 2 ? args[1] : MSG_SENDER);
      } else if (args.length === 4) {
        acc.recipients.push(args[1], args[3]);
      } else {
        acc.recipients.push(MSG_SENDER, args[2]);
      }
      return;
    }
    case 'sweepToken':
    case 'sweepTokenWithFee': {
      const [token, amountMinimum] = args;
      acc.tokenOut = token;
      acc.floors.push(amountMinimum);
      if (functionName === 'sweepToken') {
        acc.recipients.push(args.length === 3 ? args[2] : MSG_SENDER);
      } else if (args.length === 5) {
        acc.recipients.push(args[2], args[4]);
      } else {
        acc.recipients.push(MSG_SENDER, args[3]);
      }
      return;
    }
    case 'multicall': {
      if (depth >= MAX_DEPTH) throw new Error('multicall 중첩이 너무 깊음');
      const calls = args.length === 1 ? args[0] : args[1];
      for (const call of calls) {
        try {
          decodeSr02(call, acc, depth + 1);
        } catch (e) {
          acc.errors.push(`multicall 내부 디코딩 실패: ${(e as Error).message.split('\n')[0]}`);
        }
      }
      return;
    }
    case 'refundETH': // refunds msg.sender
    case 'wrapETH': // wraps into the router
    case 'pull': // pulls from msg.sender into the router
    case 'selfPermit':
    case 'selfPermitIfNecessary':
    case 'selfPermitAllowed':
    case 'selfPermitAllowedIfNecessary':
      return;
  }
}

function finish(
  router: RouterKind,
  to: Address,
  value: bigint,
  acc: Acc,
  innerRouter?: Address,
): RouterCallAction {
  const action: RouterCallAction = {
    kind: 'routerCall',
    router,
    to,
    value,
    recipients: acc.recipients.map((a) => getAddress(a)),
    hasSwap: acc.hasSwap,
  };
  if (acc.tokenOut) action.tokenOut = getAddress(acc.tokenOut);
  if (acc.hasSwap || acc.floors.length > 0) {
    action.minAmountOut = acc.floors.reduce((m, x) => (x > m ? x : m), 0n);
  }
  if (innerRouter) action.innerRouter = innerRouter;
  if (acc.errors.length > 0) action.decodeError = acc.errors.join('; ');
  return action;
}

/**
 * Decode a router call by function selector (UniversalRouter, SwapProxy, SwapRouter02).
 * Returns undefined when the selector is not a router entry point.
 * Never throws for malformed command payloads: they end up in `decodeError`.
 *
 * `versionOf` gives the UniversalRouter version for an address (from the whitelist).
 */
export function decodeRouterTx(
  to: Address,
  data: Hex,
  value: bigint,
  versionOf: (address: Address) => string | undefined,
): RouterCallAction | undefined {
  const selector = data.slice(0, 10).toLowerCase();
  const acc = newAcc();

  if (UR_SELECTORS.has(selector)) {
    try {
      const { args } = decodeFunctionData({ abi: UR_ABI, data });
      decodeUrCommands(args[0], args[1], urFamily(versionOf(to)), acc, 0);
    } catch (e) {
      acc.errors.push(`execute 디코딩 실패: ${(e as Error).message.split('\n')[0]}`);
    }
    return finish('universal-router', to, value, acc);
  }

  if (PROXY_SELECTORS.has(selector)) {
    let inner: Address | undefined;
    try {
      const { args } = decodeFunctionData({ abi: SWAP_PROXY_ABI, data });
      inner = getAddress(args[0]);
      decodeUrCommands(args[3], args[4], urFamily(versionOf(inner)), acc, 0);
    } catch (e) {
      acc.errors.push(`SwapProxy 디코딩 실패: ${(e as Error).message.split('\n')[0]}`);
    }
    return finish('swap-proxy', to, value, acc, inner);
  }

  if (SR02_SELECTORS.has(selector)) {
    try {
      decodeSr02(data, acc, 0);
    } catch (e) {
      acc.errors.push(`SwapRouter02 디코딩 실패: ${(e as Error).message.split('\n')[0]}`);
    }
    return finish('swap-router-02', to, value, acc);
  }

  return undefined;
}
