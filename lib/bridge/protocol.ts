import { z } from 'zod';
import { WATCHED_METHODS } from '@/core/types';

/**
 * inject (MAIN) ⇄ content (ISOLATED): a private MessagePort handed over once at
 * document_start, before any page script runs.
 * content ⇄ background: browser.runtime messages. bigints are tagged by core/serialize.
 */

/** Marker on the one-time window.postMessage that carries the MessagePort. */
export const HELLO_KEY = '__routeGuardHello_v1';

export const Decision = z.enum(['proceed', 'reject']);
export type Decision = z.infer<typeof Decision>;

/** Request as sent by inject (serialized; origin is NOT included — content/background add it). */
export const WireRequest = z.object({
  method: z.enum(WATCHED_METHODS),
  params: z.unknown(),
  chainId: z.number().int().nonnegative(),
  from: z.string().optional(),
});
export type WireRequest = z.infer<typeof WireRequest>;

const id = z.string().min(1).max(100);

// inject → content
export const InjectMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('analyze'), id, request: WireRequest }),
  z.object({ type: z.literal('timeout'), id, request: WireRequest }),
]);
export type InjectMessage = z.infer<typeof InjectMessage>;

/** Serialized Verdict (bigints tagged). Validated loosely; produced by our own background. */
export const WireVerdict = z
  .object({
    level: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    ruleIds: z.array(z.string()),
    summary: z.string(),
  })
  .passthrough();

// content → inject
export const ContentMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ack'), id }),
  z.object({ type: z.literal('verdict'), id, verdict: WireVerdict, needsDecision: z.boolean() }),
  z.object({ type: z.literal('decision'), id, decision: Decision }),
  z.object({ type: z.literal('error'), id, message: z.string() }),
]);
export type ContentMessage = z.infer<typeof ContentMessage>;

// content → background
export const RuntimeRequest = z.discriminatedUnion('type', [
  z.object({ type: z.literal('analyze'), id, request: WireRequest, origin: z.string() }),
  z.object({ type: z.literal('timeout'), id, request: WireRequest, origin: z.string() }),
]);
export type RuntimeRequest = z.infer<typeof RuntimeRequest>;

export type AnalyzeResponse = {
  verdict: z.infer<typeof WireVerdict>;
  needsDecision: boolean;
};

// background → content (tabs.sendMessage)
export const DecisionPush = z.object({ type: z.literal('decision'), id, decision: Decision });
export type DecisionPush = z.infer<typeof DecisionPush>;

// warning page → background
export const WarningDecision = z.object({ type: z.literal('decide'), id, decision: Decision });
export type WarningDecision = z.infer<typeof WarningDecision>;

/** What the background keeps in storage.session while a warning is open. */
export type PendingRecord = {
  id: string;
  tabId: number;
  frameId?: number;
  documentId?: string;
  windowId?: number;
  origin: string;
  method: string;
  /** serialized Verdict */
  verdict: AnalyzeResponse['verdict'];
  createdAt: number;
};
