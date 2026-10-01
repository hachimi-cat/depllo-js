# Changelog

## 0.3.0
- Webhooks: `client.webhookEndpoints` (`create`, `list`, `get`, `update`, `delete`, `eventTypes`) and `client.webhookDeliveries` (`list`, `get`, `retry`), typed `WebhookEndpoint` / `WebhookDelivery`; `client.api` gains the same routes (`webhookEndpointsCreate`, `webhookDeliveriesRetry`, …).
- `verifyWebhook({ rawBody, signature, secret })` checks a delivery's `Depllo-Signature` (HMAC-SHA256 over the raw body, 5-minute tolerance) and returns the event; payload types `PipelineFinishedData`, `JobFinishedData`, `WebhookEndpointDisabledData`.
- `DeplloError` lives in its own module (still exported from the package root).

## 0.2.0
- A route read by id next to its list is named `get` + the list's name: `client.api.projectsGetPipelines` (was `client.api.projectsPipelines2`). Each old name stays as a deprecated alias.

## 0.1.2
- `token` may be a workspace API key (`sk_live_…`); the client falls back to `DEPLLO_TOKEN`.
- `client.api` covers the API-key routes (`apiKeysList` / `apiKeysCreate` / `apiKeysDelete`).

## 0.1.1
- `client.api`: every feature route, one method each, generated from the API spec.

## 0.1.0
- First published release; source mirrored at github.com/hachimi-cat/depllo-js.
