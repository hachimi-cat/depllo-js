/**
 * @forjio/depllo — official Node/TypeScript SDK for Depllo.
 *
 * Wraps the Depllo REST API (https://depllo.forjio.com/api/v1) and the
 * family `{ data, error, meta }` envelope. Every method returns the
 * envelope; failed HTTP responses reject with a `DeplloError`.
 *
 *   import { DeplloClient } from "@forjio/depllo";
 *   const depllo = new DeplloClient({ token: process.env.DEPLLO_TOKEN! });
 *   const { data } = await depllo.pipelines.run("proj_…", { ref: "main" });
 */

export interface Envelope<T> {
  data: T;
  error: DeplloApiError | null;
  meta?: { requestId?: string; timestamp?: string; cursor?: string | null; hasMore?: boolean };
}

export interface DeplloApiError {
  code: string;
  message: string;
}

export class DeplloError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DeplloError';
  }
}

export interface DeplloClientOptions {
  /** Huudis access token (Bearer). Required for authenticated calls. */
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

  constructor(opts: DeplloClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
    this.token = opts.token;
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
