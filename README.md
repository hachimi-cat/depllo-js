# @forjio/depllo

Official Node/TypeScript SDK for [Depllo](https://depllo.forjio.com) —
GitLab-CI-style CI/CD for your GitHub repos.

```bash
npm install @forjio/depllo
```

```ts
import { DeplloClient } from "@forjio/depllo";

const depllo = new DeplloClient({
  token: process.env.DEPLLO_TOKEN!, // an sk_live_… API key (Dashboard → API Keys)
  // baseUrl defaults to https://depllo.forjio.com/api/v1
});

const { data: projects } = await depllo.projects.list();

const { data: pipeline } = await depllo.pipelines.run("proj_01hx…", {
  ref: "main",
  variables: { DEPLOY_ENV: "staging" },
});

const { data: log } = await depllo.jobs.log("job_01hx…");
const { data: usage } = await depllo.usage.get();
```

Every method returns the family envelope `{ data, error, meta }` — for a
route that answers with bytes (a job artifact, a badge SVG) `data` is a
`DeplloFile` (`{ data: Uint8Array, contentType, filename }`). Failed HTTP
responses throw a `DeplloError` carrying the API `code` and `status`. Mutating calls attach an `Idempotency-Key` automatically.

`token` may be a workspace API key (`sk_live_…`, created at Dashboard → API
Keys) or a Huudis access token; when omitted, the client reads
`DEPLLO_TOKEN`. See [API authentication](https://depllo.forjio.com/docs/api-auth).

## `client.api` — every feature route

`depllo.api` has one method per Depllo feature route (`projectsList`,
`projectsCreatePipelines`, `jobsLog`, `apiKeysList`, …) — the same names as the
CLI's `depllo api <area> <action>` commands. It is generated from the API spec,
made from Depllo's own code, so it always covers the whole API.

```ts
const { data } = await depllo.api.projectsCreatePipelines("proj_01hx…", { ref: "main" });
```

## Resources

- `projects` — `list`, `get`, `create`, `delete`
- `pipelines` — `list`, `run`, `get`, `cancel`, `retry`
- `jobs` — `get`, `log`, `retry`, `play`, `cancel`
- `runners` — `list`, `pause`, `resume`
- `usage` — `get`

See the [API reference](https://depllo.forjio.com/docs/api-reference).
