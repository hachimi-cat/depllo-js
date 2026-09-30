import { describe, it, expect, vi } from 'vitest';
import { DeplloClient, GeneratedApi, type DeplloFile } from '../index.js';

// client.api: every feature route, generated from the API spec (scripts/apigen.sh).
function capture() {
  const seen: Array<{ url: string; method: string; body?: string; auth?: string; idem?: string }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.push({
      url: typeof input === 'string' ? input : input.toString(),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
      auth: headers.Authorization,
      idem: headers['Idempotency-Key'],
    });
    return new Response(JSON.stringify({ data: { ok: true }, error: null, meta: { requestId: 'r' } }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

describe('client.api (generated from the spec)', () => {
  it('is exported and mounted on the client', () => {
    const client = new DeplloClient({ token: 't', fetch: capture().fetchImpl });
    expect(client.api).toBeInstanceOf(GeneratedApi);
  });

  it('creates a project variable with the fields Depllo validates, bearer-signed', async () => {
    const { seen, fetchImpl } = capture();
    const client = new DeplloClient({ token: 'tok_abc', fetch: fetchImpl });
    const res = await client.api.projectsCreateVariables('proj_1', { key: 'API_URL', value: 'x', masked: true });
    expect(res).toEqual({ data: { ok: true }, error: null, meta: { requestId: 'r' } });
    expect(seen[0]!.method).toBe('POST');
    expect(seen[0]!.url).toBe('https://depllo.forjio.com/api/v1/projects/proj_1/variables');
    expect(JSON.parse(seen[0]!.body!)).toEqual({ key: 'API_URL', value: 'x', masked: true });
    expect(seen[0]!.auth).toBe('Bearer tok_abc');
    expect(seen[0]!.idem).toMatch(/^sdk_/);
  });

  it('puts path parameters in the path and query fields in the query', async () => {
    const { seen, fetchImpl } = capture();
    const client = new DeplloClient({ token: 't', baseUrl: 'http://localhost:4200/api/v1/', fetch: fetchImpl });
    await client.api.projectsDeleteSchedules('proj 1', 'sch/2');
    await client.api.jobsLog('job_1', { from: 5 });
    expect(seen[0]!.method).toBe('DELETE');
    expect(seen[0]!.url).toBe('http://localhost:4200/api/v1/projects/proj%201/schedules/sch%2F2');
    const log = new URL(seen[1]!.url);
    expect(log.pathname).toBe('/api/v1/jobs/job_1/log');
    expect(Object.fromEntries(log.searchParams)).toEqual({ from: '5' });
    expect(seen[1]!.method).toBe('GET');
    expect(seen[1]!.idem).toBeUndefined();
  });
});

describe('token', () => {
  it('is an sk_live_ API key from DEPLLO_TOKEN when none is passed', async () => {
    const before = process.env.DEPLLO_TOKEN;
    process.env.DEPLLO_TOKEN = 'sk_live_from_env';
    try {
      const { seen, fetchImpl } = capture();
      await new DeplloClient({ fetch: fetchImpl }).api.apiKeysList();
      expect(seen[0]!.url).toBe('https://depllo.forjio.com/api/v1/api-keys');
      expect(seen[0]!.auth).toBe('Bearer sk_live_from_env');
    } finally {
      if (before === undefined) delete process.env.DEPLLO_TOKEN;
      else process.env.DEPLLO_TOKEN = before;
    }
  });

  it('returns a file route (a job artifact) as bytes in the envelope', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(new Uint8Array([80, 75, 3, 4]), {
        headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="dist.zip"' },
      }),
    ) as unknown as typeof fetch;
    const client = new DeplloClient({ token: 't', fetch: fetchImpl });
    const res = await client.api.jobsArtifactsDownload('job_1', 'art_1');
    const file = (res as { data: DeplloFile }).data;
    expect(file.data).toEqual(new Uint8Array([80, 75, 3, 4]));
    expect(file.contentType).toBe('application/zip');
    expect(file.filename).toBe('dist.zip');
  });

  it('still refuses an HTML page at an API path (a wrong base URL)', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } })) as unknown as typeof fetch;
    const client = new DeplloClient({ token: 't', fetch: fetchImpl });
    await expect(client.api.projectsList()).rejects.toThrow(/non-JSON/);
  });
});
