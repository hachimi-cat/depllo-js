import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DeplloClient, DeplloError, verifyWebhook } from '../index.js';

const secret = 'whsec_test_secret';
const body = JSON.stringify({
  id: 'evt_1',
  type: 'depllo.pipeline.finished.v1',
  occurredAt: '2026-10-01T12:00:00.000Z',
  accountId: 'acc_1',
  data: { pipelineId: 'pipe_1', status: 'success' },
});
const sign = (t: number, b = body, s = secret) =>
  `t=${t},v1=${crypto.createHmac('sha256', s).update(`${t}.${b}`).digest('hex')}`;

describe('verifyWebhook', () => {
  const now = 1_790_000_000;

  it('returns the event for a good signature (string or bytes)', () => {
    const event = verifyWebhook({ rawBody: body, signature: sign(now), secret, now });
    expect(event).toMatchObject({ id: 'evt_1', type: 'depllo.pipeline.finished.v1', data: { status: 'success' } });
    expect(verifyWebhook({ rawBody: Buffer.from(body), signature: sign(now), secret, now }).id).toBe('evt_1');
  });

  it('refuses a wrong secret, a changed body, an old timestamp, a missing or malformed header', () => {
    const bad = (opts: Parameters<typeof verifyWebhook>[0]) => {
      try {
        verifyWebhook(opts);
      } catch (e) {
        expect(e).toBeInstanceOf(DeplloError);
        expect((e as DeplloError).code).toBe('invalid_signature');
        return (e as Error).message;
      }
      throw new Error('expected a refusal');
    };
    expect(bad({ rawBody: body, signature: sign(now, body, 'whsec_other'), secret, now })).toMatch(/does not match/);
    expect(bad({ rawBody: body.replace('success', 'failed'), signature: sign(now), secret, now })).toMatch(/does not match/);
    expect(bad({ rawBody: body, signature: sign(now - 301), secret, now })).toMatch(/from now/);
    expect(bad({ rawBody: body, signature: undefined, secret, now })).toMatch(/missing/);
    expect(bad({ rawBody: body, signature: 'v1=abc', secret, now })).toMatch(/malformed/);
    expect(verifyWebhook({ rawBody: body, signature: sign(now - 301), secret, now, toleranceSec: 600 }).id).toBe('evt_1');
  });
});

function capture() {
  const seen: Array<{ url: string; method: string; body?: string }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({
      url: typeof input === 'string' ? input : input.toString(),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    return new Response(JSON.stringify({ data: {}, error: null, meta: {} }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

describe('webhook resources', () => {
  it('call the webhook routes', async () => {
    const { seen, fetchImpl } = capture();
    const c = new DeplloClient({ token: 't', fetch: fetchImpl });
    await c.webhookEndpoints.create({ url: 'https://h.example.com', events: ['depllo.job.*'] });
    await c.webhookEndpoints.update('whe_1', { active: true });
    await c.webhookDeliveries.list({ status: 'failed', limit: 10 });
    await c.webhookDeliveries.retry('whd_1');
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      'POST https://depllo.forjio.com/api/v1/webhook-endpoints',
      'PATCH https://depllo.forjio.com/api/v1/webhook-endpoints/whe_1',
      'GET https://depllo.forjio.com/api/v1/webhook-deliveries?status=failed&limit=10',
      'POST https://depllo.forjio.com/api/v1/webhook-deliveries/whd_1/retry',
    ]);
    expect(JSON.parse(seen[0]!.body!)).toEqual({ url: 'https://h.example.com', events: ['depllo.job.*'] });
  });
});

describe('hand-written resources match the API spec', () => {
  it('every hand-written call is a route the server serves', async () => {
    const spec = JSON.parse(readFileSync(path.resolve(__dirname, '../../../../backend/openapi.json'), 'utf8')) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const routes = Object.entries(spec.paths).flatMap(([p, item]) =>
      Object.keys(item).map((m) => ({ method: m.toUpperCase(), re: new RegExp(`^${p.replace(/\{[^}]+\}/g, '[^/]+')}$`) })),
    );
    const { seen, fetchImpl } = capture();
    const c = new DeplloClient({ token: 't', fetch: fetchImpl });
    await Promise.all([
      c.projects.list(), c.projects.get('proj_1'), c.projects.create({ repoFullName: 'a/b' } as never), c.projects.delete('proj_1'),
      c.pipelines.list('proj_1'), c.pipelines.run('proj_1', { ref: 'main' }), c.pipelines.get('proj_1', 1),
      c.pipelines.cancel('proj_1', 1), c.pipelines.retry('proj_1', 1),
      c.jobs.get('job_1'), c.jobs.log('job_1'), c.jobs.retry('job_1'), c.jobs.play('job_1'), c.jobs.cancel('job_1'),
      c.runners.list(), c.runners.pause('rnr_1'), c.runners.resume('rnr_1'),
      c.usage.get(),
      c.webhookEndpoints.eventTypes(), c.webhookEndpoints.list(), c.webhookEndpoints.get('whe_1'),
      c.webhookEndpoints.create({ url: 'https://h' }), c.webhookEndpoints.update('whe_1', {}), c.webhookEndpoints.delete('whe_1'),
      c.webhookDeliveries.list(), c.webhookDeliveries.get('whd_1'), c.webhookDeliveries.retry('whd_1'),
    ]);
    const missing = seen
      .map((s) => ({ method: s.method, path: new URL(s.url).pathname }))
      .filter((s) => !routes.some((r) => r.method === s.method && r.re.test(s.path)));
    expect(missing).toEqual([]);
  });
});
