/**
 * @forjio/depllo — official Node/TypeScript SDK for Depllo.
 *
 * Wraps the Depllo REST API (https://depllo.forjio.com/api/v1) and the
 * family `{ data, error, meta }` envelope. Every method returns the
 * envelope; a route that answers with bytes (a job artifact, a badge SVG)
 * returns a `DeplloFile` as its `data`. Failed HTTP responses reject with a
 * `DeplloError`.
 *
 * Auth = Bearer token: a workspace API key (`sk_live_…`, Dashboard → API
 * Keys) or a Huudis access token. Pass `token`, or set `DEPLLO_TOKEN`.
 *
 *   import { DeplloClient } from "@forjio/depllo";
 *   const depllo = new DeplloClient({ token: process.env.DEPLLO_TOKEN! });
 *   const { data } = await depllo.pipelines.run("proj_…", { ref: "main" });
 */

import { GeneratedApi } from './api.generated.js';
import { DeplloError } from './errors.js';

export { GeneratedApi } from './api.generated.js';
export {
  verifyWebhook,
  type DeplloWebhookEvent,
  type DeplloEventType,
  type DeplloProjectRef,
  type PipelineFinishedData,
  type JobFinishedData,
  type WebhookEndpointDisabledData,
} from './webhooks.js';

export interface Envelope<T> {
  data: T;
  error: DeplloApiError | null;
  meta?: { requestId?: string; timestamp?: string; cursor?: string | null; hasMore?: boolean };
}

export interface DeplloApiError {
  code: string;
  message: string;
}

/** A response that is bytes rather than JSON — a job artifact, a badge SVG —
 *  returned as the envelope's `data`. */
export interface DeplloFile {
  data: Uint8Array;
  contentType: string;
  /** From Content-Disposition, when the server names it. */
  filename: string | null;
}

/** A 2xx answer that is a file: not JSON, and not an HTML or plain-text page (a page at
 *  an API path is a misconfigured base URL or a proxy, and stays an error). */
function isFile(res: Response): boolean {
  const type = res.headers.get('content-type') ?? '';
  return res.ok && type !== '' && !/json|text\/(html|plain)/i.test(type);
}

export { DeplloError } from './errors.js';

export interface DeplloClientOptions {
  /** Bearer token — an `sk_live_…` API key (Dashboard → API Keys) or a Huudis
   *  access token. Defaults to the `DEPLLO_TOKEN` environment variable. */
  token?: string;
  /** API base, default `https://depllo.forjio.com/api/v1`. */
  baseUrl?: string;
  /** Custom fetch (e.g. for tests or a non-global runtime). */
  fetch?: typeof fetch;
}

/* ------------------------------------------------------------------ */
/* Resource shapes (mirror the API views)                             */
/* ------------------------------------------------------------------ */

export interface Project {
  id: string;
  name: string;
  repoFullName: string;
  defaultBranch: string;
  configPath: string;
  badgeToken: string;
  webhookStatus?: string;
  latestPipeline?: Pipeline | null;
}

export interface Pipeline {
  id: string;
  projectId: string;
  iid: number;
  sha: string;
  ref: string;
  source: string;
  status: string;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  jobs?: Job[];
}

export interface Job {
  id: string;
  pipelineId: string;
  name: string;
  stage: string;
  status: string;
  needs: string[];
  when: string;
  allowFailure: boolean;
  exitCode?: number | null;
  failureReason?: string | null;
  artifacts?: Array<{ id: string; name: string; sizeBytes: number }>;
}

export interface JobLog {
  jobId: string;
  status: string;
  complete: boolean;
  chunks: Array<{ seq: number; content: string }>;
  lastSeq: number;
}

export interface Runner {
  id: string;
  name: string;
  tags: string[];
  status: string;
  maxConcurrent: number;
  shared: boolean;
  lastContactAt?: string | null;
}

/** A webhook endpoint (GET /webhook-endpoints). The signing secret is only in the
 *  response that created it (`secret`); afterwards `secretPreview` shows its end. */
export interface WebhookEndpoint {
  id: string;
  url: string;
  /** Event types, prefixes ending in `*` (`depllo.job.*`), or `*`. */
  events: string[];
  description: string | null;
  active: boolean;
  secretPreview: string;
  /** Failed attempts in a row since the last 2xx. */
  consecutiveFailures: number;
  failingSince: string | null;
  /** Set when Depllo switched the endpoint off because it kept failing. */
  disabledAt: string | null;
  disabledReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryAttempt {
  attemptNumber: number;
  status: 'succeeded' | 'failed';
  responseCode: number | null;
  durationMs: number;
  error: string | null;
  nextRetryAt: string | null;
  attemptedAt: string;
}

/** One event sent to one endpoint (GET /webhook-deliveries). */
export interface WebhookDelivery {
  id: string;
  endpointId: string;
  endpointUrl: string;
  eventId: string;
  type: string;
  /** The exact JSON body sent on every attempt. */
  body: string;
  status: 'pending' | 'succeeded' | 'failed';
  attempts: number;
  nextRetryAt: string | null;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  responseCode: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  attemptLog: WebhookDeliveryAttempt[];
}

export interface Usage {
  accountId: string;
  periodStart: string;
  minutesUsed: number;
  tier: string;
  minutesLimit: number;
  softWarn: boolean;
  exhausted: boolean;
}

/* ------------------------------------------------------------------ */
/* Client                                                             */
/* ------------------------------------------------------------------ */

const DEFAULT_BASE = 'https://depllo.forjio.com/api/v1';

export class DeplloClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly doFetch: typeof fetch;

  readonly projects: ProjectsResource;
  readonly pipelines: PipelinesResource;
  readonly jobs: JobsResource;
  readonly runners: RunnersResource;
  readonly usage: UsageResource;
  readonly webhookEndpoints: WebhookEndpointsResource;
  readonly webhookDeliveries: WebhookDeliveriesResource;
  /** Every feature route, one method each (generated from the API spec: api.generated.ts). */
  readonly api: GeneratedApi;

  constructor(opts: DeplloClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
    this.token =
      opts.token ?? (typeof process !== 'undefined' ? process.env?.DEPLLO_TOKEN : undefined) ?? undefined;
    const f = opts.fetch ?? (globalThis.fetch as typeof fetch | undefined);
    if (!f) {
      throw new DeplloError('No fetch implementation available — pass one via options.fetch.');
    }
    this.doFetch = f;

    this.projects = new ProjectsResource(this);
    this.pipelines = new PipelinesResource(this);
    this.jobs = new JobsResource(this);
    this.runners = new RunnersResource(this);
    this.usage = new UsageResource(this);
    this.webhookEndpoints = new WebhookEndpointsResource(this);
    this.webhookDeliveries = new WebhookDeliveriesResource(this);
    this.api = new GeneratedApi(this);
  }

  /** The call behind `client.api.*`: the same bearer token, idempotency key and
   *  envelope as every other call. The spec's paths carry the /api/v1 prefix the base
   *  URL already ends in. */
  apigenRequest(
    method: string,
    path: string,
    query: Record<string, unknown> | undefined,
    body: unknown,
  ): Promise<Envelope<unknown>> {
    const rel = path.startsWith('/api/v1/') ? path.slice('/api/v1'.length) : path;
    const q = query
      ? Object.fromEntries(
          Object.entries(query).map(([k, v]): [string, string] => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
        )
      : undefined;
    return this.request<unknown>(method, rel, { query: q, body });
  }

  /** @internal */
  async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; query?: Record<string, string | number | undefined> } = {},
  ): Promise<Envelope<T>> {
    const url = new URL(this.baseUrl + (path.startsWith('/') ? path : `/${path}`));
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && method !== 'HEAD') {
      headers['Idempotency-Key'] = `sdk_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }

    const res = await this.doFetch(url.toString(), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    if (isFile(res)) {
      const disposition = res.headers.get('content-disposition') ?? '';
      const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
      const plain = /filename="?([^";]+)"?/i.exec(disposition);
      const file: DeplloFile = {
        data: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get('content-type') ?? 'application/octet-stream',
        filename: star ? decodeURIComponent(star[1]!) : (plain?.[1] ?? null),
      };
      return { data: file as T, error: null };
    }

    const text = await res.text();
    let parsed: Envelope<T> | null = null;
    try {
      parsed = text ? (JSON.parse(text) as Envelope<T>) : null;
    } catch {
      /* non-JSON body */
    }

    if (!res.ok) {
      throw new DeplloError(
        parsed?.error?.message ?? `HTTP ${res.status} ${res.statusText}`,
        parsed?.error?.code,
        res.status,
      );
    }
    if (!parsed) throw new DeplloError('Empty or non-JSON response from server.');
    return parsed;
  }
}

class ProjectsResource {
  constructor(private readonly c: DeplloClient) {}
  list(): Promise<Envelope<Project[]>> {
    return this.c.request('GET', '/projects');
  }
  get(projectId: string): Promise<Envelope<Project>> {
    return this.c.request('GET', `/projects/${projectId}`);
  }
  create(input: {
    repoFullName: string;
    name?: string;
    defaultBranch?: string;
    configPath?: string;
    cloneToken?: string;
  }): Promise<Envelope<Project>> {
    return this.c.request('POST', '/projects', { body: input });
  }
  delete(projectId: string): Promise<Envelope<{ deleted: boolean; id: string }>> {
    return this.c.request('DELETE', `/projects/${projectId}`);
  }
}

class PipelinesResource {
  constructor(private readonly c: DeplloClient) {}
  list(projectId: string, opts: { cursor?: string } = {}): Promise<Envelope<Pipeline[]>> {
    return this.c.request('GET', `/projects/${projectId}/pipelines`, { query: { cursor: opts.cursor } });
  }
  /** Trigger a pipeline for a ref. */
  run(
    projectId: string,
    input: { ref: string; variables?: Record<string, string> },
  ): Promise<Envelope<Pipeline>> {
    return this.c.request('POST', `/projects/${projectId}/pipelines`, {
      body: { ref: input.ref, variables: input.variables ?? {} },
    });
  }
  get(projectId: string, iid: number | string): Promise<Envelope<Pipeline>> {
    return this.c.request('GET', `/projects/${projectId}/pipelines/${iid}`);
  }
  cancel(projectId: string, iid: number | string): Promise<Envelope<{ id: string; status: string }>> {
    return this.c.request('POST', `/projects/${projectId}/pipelines/${iid}/cancel`);
  }
  retry(projectId: string, iid: number | string): Promise<Envelope<{ id: string; status: string }>> {
    return this.c.request('POST', `/projects/${projectId}/pipelines/${iid}/retry`);
  }
}

class JobsResource {
  constructor(private readonly c: DeplloClient) {}
  get(jobId: string): Promise<Envelope<Job>> {
    return this.c.request('GET', `/jobs/${jobId}`);
  }
  /** Read log chunks from a sequence number. */
  log(jobId: string, opts: { from?: number } = {}): Promise<Envelope<JobLog>> {
    return this.c.request('GET', `/jobs/${jobId}/log`, { query: { from: opts.from } });
  }
  retry(jobId: string): Promise<Envelope<Job>> {
    return this.c.request('POST', `/jobs/${jobId}/retry`);
  }
  play(jobId: string): Promise<Envelope<Job>> {
    return this.c.request('POST', `/jobs/${jobId}/play`);
  }
  cancel(jobId: string): Promise<Envelope<Job>> {
    return this.c.request('POST', `/jobs/${jobId}/cancel`);
  }
}

class RunnersResource {
  constructor(private readonly c: DeplloClient) {}
  list(): Promise<Envelope<Runner[]>> {
    return this.c.request('GET', '/runners');
  }
  pause(runnerId: string): Promise<Envelope<Runner>> {
    return this.c.request('POST', `/runners/${runnerId}/pause`);
  }
  resume(runnerId: string): Promise<Envelope<Runner>> {
    return this.c.request('POST', `/runners/${runnerId}/resume`);
  }
}

class UsageResource {
  constructor(private readonly c: DeplloClient) {}
  get(): Promise<Envelope<Usage>> {
    return this.c.request('GET', '/usage');
  }
}

class WebhookEndpointsResource {
  constructor(private readonly c: DeplloClient) {}
  /** The event types an endpoint can subscribe to. */
  eventTypes(): Promise<Envelope<{ eventTypes: Array<{ type: string; description: string }> }>> {
    return this.c.request('GET', '/webhook-endpoints/event-types');
  }
  list(): Promise<Envelope<WebhookEndpoint[]>> {
    return this.c.request('GET', '/webhook-endpoints');
  }
  get(endpointId: string): Promise<Envelope<WebhookEndpoint>> {
    return this.c.request('GET', `/webhook-endpoints/${encodeURIComponent(endpointId)}`);
  }
  /** Register an endpoint. `secret` is in this response only — store it. */
  create(input: { url: string; events?: string[]; description?: string }): Promise<Envelope<WebhookEndpoint & { secret: string }>> {
    return this.c.request('POST', '/webhook-endpoints', { body: input });
  }
  /** `active: true` re-enables an endpoint Depllo switched off and clears its failure streak. */
  update(
    endpointId: string,
    patch: { url?: string; events?: string[]; description?: string | null; active?: boolean },
  ): Promise<Envelope<WebhookEndpoint>> {
    return this.c.request('PATCH', `/webhook-endpoints/${encodeURIComponent(endpointId)}`, { body: patch });
  }
  delete(endpointId: string): Promise<Envelope<{ deleted: boolean; id: string }>> {
    return this.c.request('DELETE', `/webhook-endpoints/${encodeURIComponent(endpointId)}`);
  }
}

class WebhookDeliveriesResource {
  constructor(private readonly c: DeplloClient) {}
  /** Newest first; page with `meta.cursor` while `meta.hasMore`. */
  list(
    opts: { endpointId?: string; status?: 'pending' | 'succeeded' | 'failed'; type?: string; limit?: number; cursor?: string } = {},
  ): Promise<Envelope<WebhookDelivery[]>> {
    return this.c.request('GET', '/webhook-deliveries', { query: { ...opts } });
  }
  get(deliveryId: string): Promise<Envelope<WebhookDelivery>> {
    return this.c.request('GET', `/webhook-deliveries/${encodeURIComponent(deliveryId)}`);
  }
  /** One more attempt now (202). 409 ALREADY_QUEUED / ENDPOINT_DISABLED. */
  retry(deliveryId: string): Promise<Envelope<WebhookDelivery>> {
    return this.c.request('POST', `/webhook-deliveries/${encodeURIComponent(deliveryId)}/retry`);
  }
}
