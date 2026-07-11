# Foundry

Turn one sentence into a deployed project. Next.js 14 app: an AI planner (Claude API) produces a validated deployment plan; a durable, saga-orchestrated execution engine runs provider steps with retries, timeouts, cancellation, rollback, and crash recovery; execution events stream to the browser over SSE.

## Run

```bash
npm install
cp .env.example .env.local   # fill in ANTHROPIC_API_KEY + FOUNDRY_MASTER_KEY
npm run dev                  # http://localhost:3000
```

Verify:

```bash
npm run typecheck
npm test              # node:test suite (41 tests)
npm run build
npm run proof:mock    # mock end-to-end: plan → run → evidence → rollback
npm run smoke         # against a live server (BASE_URL, FOUNDRY_API_TOKEN aware)
npm run proof:github  # offline stub-transport GitHub proof (GITHUB_PROOF_LIVE=1 for live)
npm run proof:profile # DYLN launch-profile proof: 8 steps across 6 providers + verify + rollback
```

Crash-recovery proof: see the header of `scripts/crash-recovery-proof.ts`.

## Architecture

| Layer | Location | Notes |
|---|---|---|
| AI planner | `lib/ai/planner.ts` | Claude API, Zod-validated JSON plan. Refuses to run without `ANTHROPIC_API_KEY` — never fakes a plan. |
| Plan validation | `lib/foundry/plan.ts` | Schema + registry-driven provider/action validation; invalid plans persist as `rejected` and cannot run. |
| Execution engine | `lib/foundry/execution.ts` + `lib/orchestration/saga.ts` | Durable runs/steps/events; per-step timeout + retry policy (`ProviderError` classification); cancellation flag honored between steps; reverse-order compensation on failure or explicit rollback; boot-time resume via `instrumentation.ts`. |
| Provider registry | `lib/foundry/registry.ts`, `lib/foundry/providers.ts` | Capability registries for repository (github, local-git), deployment (vercel), dns (cloudflare), email (resend), payments (stripe), telephony (signalwire), storage (dev-only). Real adapters activate when their credential is set; otherwise clearly-labeled mocks that FAIL CLOSED in production (override only via `FOUNDRY_ALLOW_MOCKS=explicit-test-mode`, reported loudly by healthz). Unknown providers/actions fail closed. `GET /api/providers` exposes full capability metadata. See docs/FOUNDRY_PROVIDER_MATRIX.md. |
| Persistence | `lib/foundry/store.ts` | `FOUNDRY_PERSISTENCE=file\|sqlite` (unknown values fail closed). sqlite (node:sqlite, WAL, transactional) is the production-safe mode and the production default; file mode is dev-only. Production execution is refused on non-production-safe persistence. |
| Auth | `lib/foundry/auth.ts` | `FOUNDRY_API_TOKEN` (≥16 chars) as Bearer header or httpOnly session cookie (`POST /api/auth/session` — cookie exists because EventSource cannot send headers). Production without a token fails closed (503) on every protected route; dev without a token runs open. |
| Secrets | `lib/security/kms.ts` via `lib/foundry/credentials.ts` | Envelope encryption (AES-256-GCM); `FOUNDRY_MASTER_KEY` required in production. |
| Event streaming | `app/api/projects/[id]/runs/[runId]/logs` | SSE replay of durable execution events with Last-Event-ID cursor; org-scoped; closes on terminal states. Durable events are the only event source — there is no separate in-memory log bus. |

## Integration

`GET /api/healthz` (public) reports service status truthfully: planner config, auth mode (`token|open-dev|misconfigured`), persistence mode + a live read/write probe (`production_safe_persistence`), the durable event model, and the mock-provider lock state. Consumed by Chief of Staff (`FOUNDRY_URL` env var).

## Env vars

See [.env.example](.env.example). Required: `ANTHROPIC_API_KEY`, `FOUNDRY_MASTER_KEY`; in production also `FOUNDRY_API_TOKEN` (API is disabled without it) and production-safe persistence (sqlite is the default). Optional: `FOUNDRY_PRINCIPALS` (multi-org service clients), `FOUNDRY_ORG_ID`, `FOUNDRY_PERSISTENCE`, `FOUNDRY_SQLITE_FILE`, `FOUNDRY_STORE_FILE`, `VERCEL_API_TOKEN`, `GITHUB_TOKEN`, `CLOUDFLARE_API_TOKEN`(+`CLOUDFLARE_ZONE_ID`), `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `SIGNALWIRE_*`, `FOUNDRY_PLANNER_MODEL`.

Operations: back up the sqlite store by copying `FOUNDRY_SQLITE_FILE` (default `.foundry-data/store.sqlite`) while the server is stopped. Status docs live in `docs/` (completion ledger, continuation notes).
