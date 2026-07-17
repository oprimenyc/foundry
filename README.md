# Foundry

Turn one sentence into a deployed project. Foundry is a Next.js 14 control plane with an AI planner, a durable saga-based execution engine, provider registries, vault-backed secret controls, and a reusable M4 operations center.

## Run

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Verify

```bash
npm run typecheck
npm test
npm run build
npm run proof:mock
npm run proof:github
npm run proof:profile
npm run proof:m4
npm run smoke
```

## Architecture

| Layer | Location | Notes |
|---|---|---|
| AI planner | `lib/ai/planner.ts` | Generates validated plans and fails closed without `ANTHROPIC_API_KEY`. |
| Execution engine | `lib/foundry/execution.ts`, `lib/orchestration/saga.ts` | Durable runs, retries, timeouts, cancellation, rollback, crash recovery, and verification evidence. |
| Provider system | `lib/foundry/providers.ts`, `lib/foundry/universal/*` | Capability-first provider registry, selection engine, health scoring, and provider intelligence. |
| Vault controls | `lib/vault/*` | Metadata-only secret references, approvals, policy, grants, resolver, and audit trail. |
| Persistence | `lib/foundry/store.ts` | File or sqlite persistence with production-safe sqlite enforcement. |
| Operations center | `lib/foundry/ops.ts`, `app/api/ops/route.ts` | Provider health, credential lifecycle, incidents, dependency discovery, environment sync, approvals, runtime health, rollback audit, and evidence ledger. |

## APIs

- `GET /api/healthz`: public liveness and configuration truth probe.
- `GET /api/providers`: provider capability metadata.
- `GET /api/ops`: authenticated autonomous operations snapshot for the caller organization.
- `POST /api/ops`: authenticated incident open and resolve workflow.

## Docs

- `docs/FOUNDRY_M4_OPERATIONS_CENTER.md`
- `docs/FOUNDRY_M4_API.md`
- `docs/FOUNDRY_M4_INTEGRATION_GUIDE.md`
- `docs/FOUNDRY_M3_VAULT_INTELLIGENCE.md`
- `docs/FOUNDRY_PROVIDER_MATRIX.md`

## Env

See `.env.example`. Core variables:

- `ANTHROPIC_API_KEY`
- `FOUNDRY_MASTER_KEY`
- `FOUNDRY_API_TOKEN` in production
- `FOUNDRY_PERSISTENCE`, `FOUNDRY_SQLITE_FILE`, `FOUNDRY_STORE_FILE`

Provider-specific credentials remain optional until those providers are used live. The ops API never exposes plaintext secrets.
