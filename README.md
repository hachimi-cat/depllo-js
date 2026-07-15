# @forjio/depllo

Official Node/TypeScript SDK for [Depllo](https://depllo.forjio.com) —
GitLab-CI-style CI/CD for your GitHub repos.

```bash
npm install @forjio/depllo
```

```ts
import { DeplloClient } from "@forjio/depllo";

const depllo = new DeplloClient({
  token: process.env.DEPLLO_TOKEN!, // Huudis access token (Bearer)
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

Every method returns the family envelope `{ data, error, meta }`. Failed
HTTP responses throw a `DeplloError` carrying the API `code` and
`status`. Mutating calls attach an `Idempotency-Key` automatically.

## Resources

- `projects` — `list`, `get`, `create`, `delete`
- `pipelines` — `list`, `run`, `get`, `cancel`, `retry`
- `jobs` — `get`, `log`, `retry`, `play`, `cancel`
- `runners` — `list`, `pause`, `resume`
- `usage` — `get`

See the [API reference](https://depllo.forjio.com/docs/api-reference).
