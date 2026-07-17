# FOUNDRY_DEPLOYMENT_EXECUTION

**Modules:** `lib/foundry/providers.ts`, `lib/providers/vercel.adapter.ts` · **Status:** REAL (Vercel) / mock others

## Real today

- **Vercel** — real deploy via git source, status polling to `READY`, idempotent create,
  timeout, deployment URL/reference capture, `ERROR`-state failure, and compensation
  (cancel/delete). Selected only when `VERCEL_*` credentials are present.
- **Workflow** — the default launch pipeline is `repository → hosting`; each step is
  idempotent (completed steps skipped on resume), timeout-bounded, and reconciled on
  restart.
- **Health checks** — post-deployment launch verification + independent verification (see
  `FOUNDRY_POST_DEPLOYMENT_VERIFICATION.md`).

## Boundaries (honest)

- Railway / Fly / Netlify / Firebase / GitHub Actions deploy adapters are catalog mocks,
  not live.
- No arbitrary shell execution — a generic command adapter is intentionally not provided.
- Live production deployment was NOT performed in this mission.

Tested via injected HTTP client in `tests/foundry.test.ts` (Vercel poll/compensate) and
the end-to-end mock deployment in `scripts/governed-release-proof.ts`.
