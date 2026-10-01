import crypto from 'node:crypto';
import { DeplloError } from './errors.js';

/**
 * Receiving Depllo webhooks. Every delivery is a POST with
 *
 *   Depllo-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 *
 * and the envelope { id, type, occurredAt, accountId, data } as its body. Verify the
 * signature over the RAW body (before any JSON parsing) with the endpoint's signing
 * secret (`whsec_…`, shown once when the endpoint was added).
 */

/** The event catalogue (GET /api/v1/webhook-endpoints/event-types). */
export type DeplloEventType =
  | 'depllo.pipeline.finished.v1'
  | 'depllo.job.finished.v1'
  | 'depllo.webhook_endpoint.disabled.v1';

export interface DeplloProjectRef {
  id: string;
  name: string;
  repoFullName: string;
}

/** `data` of depllo.pipeline.finished.v1. */
export interface PipelineFinishedData {
  pipelineId: string;
  iid: number;
  status: 'success' | 'failed' | 'canceled';
  /** `config_error` when the pipeline failed because its .depllo-ci.yml is invalid. */
  reason: string | null;
  ref: string;
  sha: string;
  source: string;
  prNumber: number | null;
  triggeredBy: string | null;
  projectId: string;
  project: DeplloProjectRef;
  jobs: { total: number; success: number; failed: number; canceled: number; skipped: number };
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number | null;
  url: string;
}

/** `data` of depllo.job.finished.v1. */
export interface JobFinishedData {
  jobId: string;
  name: string;
  stage: string;
  status: 'success' | 'failed' | 'canceled';
  exitCode: number | null;
  /** script_failure | stuck_timeout | runner_failure | canceled | config_error */
  failureReason: string | null;
  attempt: number;
  allowFailure: boolean;
  pipelineId: string;
  pipelineIid: number;
  ref: string;
  sha: string;
  projectId: string;
  project: DeplloProjectRef;
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number | null;
  url: string;
}

/** `data` of depllo.webhook_endpoint.disabled.v1. */
export interface WebhookEndpointDisabledData {
  id: string;
  url: string;
  description: string | null;
  disabledAt: string;
  disabledReason: string;
  consecutiveFailures: number;
  failingSince: string;
}

export interface DeplloWebhookEvent<T = unknown> {
  /** evt_… — the same on every delivery attempt; use it to drop duplicates. */
  id: string;
  type: DeplloEventType | string;
  occurredAt: string;
  accountId: string;
  data: T;
}

/**
 * Verify a delivery and return its event. Throws DeplloError (code `invalid_signature`)
 * when the header is missing or malformed, the timestamp is more than `toleranceSec`
 * (default 300) from now, the signature does not match, or the body is not JSON.
 *
 *   app.post('/hooks/depllo', express.raw({ type: 'application/json' }), (req, res) => {
 *     const event = verifyWebhook({
 *       rawBody: req.body,
 *       signature: req.header('Depllo-Signature'),
 *       secret: process.env.DEPLLO_WEBHOOK_SECRET!,
 *     });
 *     if (event.type === 'depllo.pipeline.finished.v1') { … }
 *     res.sendStatus(204);
 *   });
 */
export function verifyWebhook<T = unknown>(opts: {
  rawBody: string | Uint8Array;
  signature: string | undefined | null;
  secret: string;
  toleranceSec?: number;
  /** Seconds since the epoch — a clock for tests. */
  now?: number;
}): DeplloWebhookEvent<T> {
  const fail = (message: string): never => {
    throw new DeplloError(message, 'invalid_signature', 400);
  };
  if (!opts.signature) fail('missing Depllo-Signature header');
  const parts: Record<string, string> = {};
  for (const segment of String(opts.signature).split(',')) {
    const i = segment.indexOf('=');
    if (i > 0) parts[segment.slice(0, i).trim()] = segment.slice(i + 1).trim();
  }
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1 || !/^\d+$/.test(t)) fail('malformed Depllo-Signature header');
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const drift = Math.abs(now - Number(t));
  if (drift > (opts.toleranceSec ?? 300)) fail(`signature timestamp is ${drift}s from now`);

  const body =
    typeof opts.rawBody === 'string' ? opts.rawBody : Buffer.from(opts.rawBody).toString('utf8');
  const expected = Buffer.from(crypto.createHmac('sha256', opts.secret).update(`${t}.${body}`).digest('hex'));
  const given = Buffer.from(v1!);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) fail('signature does not match');
  try {
    return JSON.parse(body) as DeplloWebhookEvent<T>;
  } catch {
    return fail('webhook body is not valid JSON');
  }
}
