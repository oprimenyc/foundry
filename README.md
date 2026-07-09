# Foundry

Turn one sentence into a deployed project. Next.js 14 app: an AI planner (Claude API) produces a deployment plan; a saga orchestrator executes provider steps with automatic rollback; deployment logs stream to the browser over SSE.

## Run

```bash
npm install
cp .env.example .env.local   # fill in ANTHROPIC_API_KEY + FOUNDRY_MASTER_KEY
npm run dev                  # http://localhost:3000
```

Verify: `npm run typecheck`, then with the dev server running, `npm run smoke`.

## Architecture

| Layer | Location | Notes |
|---|---|---|
| AI planner | `lib/ai/planner.ts` | Claude API, Zod-validated JSON plan. Refuses to run without `ANTHROPIC_API_KEY` — never fakes a plan. |
| Saga engine | `lib/orchestration/saga.ts` | Ordered steps with compensations; rolls back completed steps on failure and reports compensation failures loudly. |
| Provider adapters | `lib/providers/` | Retry/backoff HTTP client with idempotency keys; Vercel adapter (create/delete project). |
| Secrets | `lib/security/kms.ts` | Envelope encryption (AES-256-GCM). Local master-key provider; swap in a real KMS by implementing `IKMSProvider`. No passthrough stubs. |
| Log streaming | `lib/logs/bus.ts` → `app/api/projects/[id]/logs` | Redis pub/sub when `REDIS_URL` set, in-process bus otherwise. SSE to the browser. |
| Persistence | `lib/db/supabase.ts`, `supabase/migrations/` | Optional; app runs without it. |

## Integration

`GET /api/healthz` reports service status and configuration (planner/persistence/log bus) — consumed by Chief of Staff (`FOUNDRY_URL` env var) for its integrations status panel.

## Env vars

See [.env.example](.env.example). Required: `ANTHROPIC_API_KEY`, `FOUNDRY_MASTER_KEY`. Optional: `REDIS_URL`, Supabase pair, `VERCEL_API_TOKEN`, `FOUNDRY_PLANNER_MODEL`.
