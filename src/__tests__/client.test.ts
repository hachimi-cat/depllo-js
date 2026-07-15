import { describe, it, expect, vi } from 'vitest';
import { DeplloClient, DeplloError } from '../index.js';

function mockFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

describe('DeplloClient', () => {
  it('sends the bearer token and returns the envelope', async () => {
    const fetchImpl = mockFetch(200, { data: [{ id: 'proj_1' }], error: null, meta: {} });
    const client = new DeplloClient({ token: 'tok_abc', fetch: fetchImpl });
    const { data } = await client.projects.list();
    expect(data).toEqual([{ id: 'proj_1' }]);

    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('https://depllo.forjio.com/api/v1/projects');
    expect(call[1].headers.Authorization).toBe('Bearer tok_abc');
  });

  it('attaches an idempotency key on mutations', async () => {
    const fetchImpl = mockFetch(201, { data: { id: 'pipe_1', iid: 1 }, error: null });
    const client = new DeplloClient({ token: 't', fetch: fetchImpl });
    await client.pipelines.run('proj_1', { ref: 'main' });
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].method).toBe('POST');
    expect(call[1].headers['Idempotency-Key']).toMatch(/^sdk_/);
    expect(JSON.parse(call[1].body)).toEqual({ ref: 'main', variables: {} });
  });

  it('throws DeplloError with the API code on failure', async () => {
    const fetchImpl = mockFetch(404, { data: null, error: { code: 'NOT_FOUND', message: 'nope' } });
    const client = new DeplloClient({ token: 't', fetch: fetchImpl });
    await expect(client.projects.get('proj_x')).rejects.toMatchObject({
      name: 'DeplloError',
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('respects a custom baseUrl', async () => {
    const fetchImpl = mockFetch(200, { data: { minutesUsed: 5 }, error: null });
    const client = new DeplloClient({ token: 't', baseUrl: 'http://localhost:4200/api/v1', fetch: fetchImpl });
    await client.usage.get();
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('http://localhost:4200/api/v1/usage');
  });
});
