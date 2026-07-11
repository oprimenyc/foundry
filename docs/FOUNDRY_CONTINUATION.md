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
npm test            # 27/27 (node:test via tsx)
npm run build       # clean (instrumentationHook warning is expected on 14.2)
npm run proof:mock  # mock e2e: completed + rolled_back
# live smoke (auth enforced):
FOUNDRY_API_TOKEN=smoke-test-token-0123456789 FOUNDRY_PERSISTENCE=sqlite npm run start -- -p 3113 &
BASE_URL=http://localhost:3113 FOUNDRY_API_TOKEN=smoke-test-token-0123456789 node scripts/smoke.mjs   # 7/7
# crash recovery proof: see scripts/crash-recovery-proof.ts header
```

## Status 2026-07-11 (third loop — M2 + M3)

- M2 universal provider orchestration committed (`3571260`, branch
  `mission/m2-universal-providers`, queued as MQ-005). 20 categories /
  34 providers, vendor-free execution core.
- M3 Prime Vault + Provider Intelligence completed on
  `mission/m3-vault-intelligence`: `lib/vault/*` control plane (references,
  policy, approvals, grants, trusted resolver, redaction, execution gate,
  memory/openbao/infisical/aws adapters) wired into the execution engine, and
  deterministic provider-intelligence scoring in the selection engine.
  65/65 tests; `npm run proof:m2` PASS with the gate live. See
  docs/FOUNDRY_M3_VAULT_INTELLIGENCE.md. Live vault-backend proof is
  credential-blocked (founder).

## Status 2026-07-11 (second loop)

Milestones 9-14 are complete: real GitHub adapter, org tenancy, durable-event
consolidation, independent verification, domain expansion (dns/email/payments/
telephony/storage) with launch profiles, and final gate proofs. 41/41 tests.
All remaining work is credential-blocked live proving or demand-deferred
(production object store, CoS approval workflow, multi-instance persistence).
See FOUNDRY_PROVIDER_MATRIX.md and the completion ledger.

## Next milestones, in priority order (historical — superseded above)

1. ~~Cancellation regression coverage~~ — done (`34d71bf`).
2. ~~Live Vercel deployment actions~~ — implemented with stubbed-transport
   tests (`1916c64`); live-API proof still needs `VERCEL_API_TOKEN`.
3. **Repository provider: real GitHub adapter** — mock only today. Same pattern
   as Vercel: registry-registered, fail-closed without `GITHUB_TOKEN`.
4. **DNS / email / payments / telephony domains** — not started; build only
   against actual product demand (see FOUNDARY_IMPLEMENTATION_ROADMAP.md).
5. **Log bus cleanup** — lib/logs/bus.ts + saga bus publishes are now only an
   in-memory echo (durable events are the source of truth); consider removing
   the redundant publishes.
6. **Per-user identity/tenancy** — single shared token today; orgId is a
   hardcoded `org_local`.
7. ~~README/docs refresh~~ — done (`691bd4d`); orphaned Supabase client,
   api-keys.ts, and migrations removed.

## Known human blockers

- Real provider credentials (VERCEL_API_TOKEN, GITHUB_TOKEN, ANTHROPIC_API_KEY)
  are required for any live-provider proof. Configure in `.env`; verify via
  `/api/healthz` (`planner: configured`) and a real deploy run.
