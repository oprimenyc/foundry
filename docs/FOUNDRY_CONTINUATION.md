# Foundry Continuation

Resume instructions for the next session. Repo: `C:\Users\jp718\foundry` (note:
sessions sometimes launch in the wrong cwd — verify with `git log --oneline -3`;
HEAD should be at or after `c20a83b`).

## Current verified state (2026-07-11)

- Registry-driven providers (repository: github-mock, local-git; deployment:
  vercel-mock or real Vercel HTTP adapter when `VERCEL_API_TOKEN` is set).
- Durable execution: plan validation → idempotent run creation → saga steps
  with enforced per-step timeout + retry policy → durable events → launch
  evidence → rollback/compensation → cancellation flag → boot-time resume.
- Persistence: `FOUNDRY_PERSISTENCE=file|sqlite` (fails closed on unknown).
  sqlite (node:sqlite, WAL) is the production-safe mode; production execution
  and healthz gate on it truthfully. `FOUNDRY_SQLITE_FILE` / `FOUNDRY_STORE_FILE`
  override paths.
- Auth: `FOUNDRY_API_TOKEN` (≥16 chars) as Bearer or httpOnly session cookie
  (`POST /api/auth/session`). Production without token → 503 fail-closed on all
  protected routes. Healthz is public and reports `auth` mode.
- Secrets: AES-encrypted credential storage; `FOUNDRY_MASTER_KEY` required in
  production (fails closed).

## Verification commands

```bash
npm run typecheck   # clean
npm test            # 23/23 (node:test via tsx)
npm run build       # clean (instrumentationHook warning is expected on 14.2)
npm run proof:mock  # mock e2e: completed + rolled_back
# live smoke (auth enforced):
FOUNDRY_API_TOKEN=smoke-test-token-0123456789 FOUNDRY_PERSISTENCE=sqlite npm run start -- -p 3113 &
BASE_URL=http://localhost:3113 FOUNDRY_API_TOKEN=smoke-test-token-0123456789 node scripts/smoke.mjs   # 7/7
# crash recovery proof: see scripts/crash-recovery-proof.ts header
```

## Next milestones, in priority order

1. **Cancellation regression coverage** — `requestCancellation` sets a flag
   checked before each step, but no test exercises cancel-during-active-run or
   the cancel API route. Add one.
2. **Live Vercel deployment actions** — `VercelHttpAdapter` fails closed on
   `trigger_deployment`/`verify_deployment` (not implemented). Implement against
   the Vercel deployments API. Requires `VERCEL_API_TOKEN` (human blocker for
   live proof; implement + test against a stub HTTP layer without it).
3. **Repository provider: real GitHub adapter** — mock only today. Same pattern
   as Vercel: registry-registered, fail-closed without `GITHUB_TOKEN`.
4. **DNS / email / payments / telephony domains** — not started; build only
   against actual product demand (see FOUNDARY_IMPLEMENTATION_ROADMAP.md).
5. **Log bus cleanup** — lib/logs/bus.ts + saga bus publishes are now only an
   in-memory echo (durable events are the source of truth); consider removing
   the redundant publishes.
6. **Per-user identity/tenancy** — single shared token today; orgId is a
   hardcoded `org_local`.
7. **README/docs refresh** — document env vars (FOUNDRY_PERSISTENCE,
   FOUNDRY_SQLITE_FILE, FOUNDRY_API_TOKEN, FOUNDRY_MASTER_KEY, VERCEL_API_TOKEN)
   and operations (backup = copy sqlite file while stopped, or use WAL checkpoint).

## Known human blockers

- Real provider credentials (VERCEL_API_TOKEN, GITHUB_TOKEN, ANTHROPIC_API_KEY)
  are required for any live-provider proof. Configure in `.env`; verify via
  `/api/healthz` (`planner: configured`) and a real deploy run.
