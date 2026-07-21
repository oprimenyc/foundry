# Foundry Provider Action Adapter — Proof

Module: `lib/provider-actions/`. Machine-readable bundle: `proof/evidence/provider-action-adapter-proof.json` (run `npm run proof:provider-actions` to regenerate).

## What this proves

Foundry can prepare, validate, dry-run-simulate, and evidence a future live provider action (credential revoke/rotate, deployment env update, restart/redeploy, health verification, DNS/git-history advisory) across GitHub, database, Google OAuth, NextAuth, Railway, Fly, Vercel, and generic-env providers — entirely without making a live call, storing a secret value, or letting an unapproved mutation reach a passing verdict.

## Contract (`lib/provider-actions/types.ts`)

Required fields all present: action id, project/repo, provider type, action type, target environment, required approval gates, mutation risk, rollback plan, verification plan, dry-run result, evidence refs, final verdict (`PASS`/`FAIL`/`BLOCKED`/`PASS_WITH_WARNINGS`). A zod `superRefine` scans every field for secret-shaped material and rejects the submission outright if any is found (reuses `lib/secret-remediation/secret-scan.ts`, the same detector `local-execution` and `secret-remediation` already rely on).

## Approval policy engine (`lib/provider-actions/policy.ts`)

| Action type | Required gates |
|---|---|
| `revoke_credential` | `live_provider_mutation`, `credential_revocation` (+ `production_target` in production) |
| `rotate_credential` | `live_provider_mutation`, `credential_rotation` (+ `deployment_env_mutation` if provider is `nextauth`; + `production_target` in production) |
| `update_deployment_env_var` | `live_provider_mutation`, `deployment_env_mutation` (+ `production_target` in production) |
| `restart_service` / `redeploy_service` | `live_provider_mutation`, `restart_redeploy` (+ `production_target` in production) |
| `verify_service_health` | none — non-mutating |
| `git_history_rewrite_advisory` | `git_history_rewrite` (+ `force_push` only if `forcePushRequired: true`) |
| `dns_advisory` | `dns_mutation` (never `production_target` — permanently advisory, not tiered) |

Verdict rule (mirrors `lib/secret-remediation`'s "Foundry never rotates a real credential, so a finding can reach PASS only when nothing further is owed"):
- a missing local prerequisite (e.g. a CLI not installed) always **BLOCKS**, regardless of approval;
- a mutating action is **BLOCKED** while any required gate is pending/rejected, and capped at **PASS_WITH_WARNINGS** even once every gate is approved — Foundry still never performs the live action itself;
- `verify_service_health` can reach a plain **PASS** — nothing is owed beyond the advisory;
- `git_history_rewrite_advisory`/`dns_advisory` are always **PASS_WITH_WARNINGS** — well-formed, but there is no live executor for either anywhere in this module by design.

## The ten required fixtures (`lib/provider-actions/fixtures/`) — actual results

| Fixture | Verdict | Why |
|---|---|---|
| `panticandy-github-pat-revocation` | BLOCKED | Pending approval (`live_provider_mutation`, `credential_revocation`, `production_target`) |
| `panticandy-db-credential-rotation` | BLOCKED | Pending approval; the historical-exposure follow-up flagged in `PANTICANDY_SECRET_CONTAINMENT_ACTIONS.md` |
| `vitalcore-nextauth-secret-regeneration` | BLOCKED | Pending approval, incl. the NextAuth-specific `deployment_env_mutation` gate |
| `vitalcore-google-oauth-rotation` | BLOCKED | Pending approval |
| `vitalcore-db-credential-rotation` | BLOCKED | Pending approval |
| `dyln-staging-env-update-advisory` | BLOCKED | Pending approval (staging — no `production_target` gate) |
| `primeopp-domain-env-deployment-advisory` | PASS_WITH_WARNINGS | `dns_advisory` — permanently advisory by design |
| `railway-staging-env-update-dryrun` | BLOCKED | Pending approval; demonstrates the full gate-decision lifecycle (see below) |
| `fly-health-verification-dryrun` | PASS | Non-mutating; no approval required |
| `vercel-missing-cli-blocked-advisory` | BLOCKED | `knownPrerequisiteGaps: ["vercel-cli"]` — prerequisite-missing BLOCKED, distinct from pending-approval BLOCKED |

Operator report over all ten: `totalActions=10, byVerdict={PASS:1, PASS_WITH_WARNINGS:1, BLOCKED:8, FAIL:0}, realProviderCallsMade=false`.

## Gate-decision lifecycle, demonstrated live

The proof script ingests `railway-staging-env-update-dryrun` (BLOCKED, gates pending), decides both required gates `approved` via `decideProviderActionGate`, and confirms the operator surface's `approvalState` reflects the decision immediately while the retained evidence package's own `verdict` stays the frozen `BLOCKED` it was at ingest time (evidence is immutable once retained — a fresh submission of the same plan with `preApprovedGateReasons` set is how a new, correctly-capped `PASS_WITH_WARNINGS` verdict is produced, never by mutating history). A second, fresh ingest with both gates pre-approved confirms that ceiling directly: `PASS_WITH_WARNINGS`, never a plain `PASS`.

## Safety confirmations

```
realProviderCallsMade: false
liveCredentialsRotated: false
liveCredentialsRevoked: false
deploymentEnvMutated: false
servicesRestarted: false
deploysTriggered: false
dnsModified: false
gitHistoryRewritten: false
secretValuesStored: false
```

Every one of the 11 adapters' `advise()` calls is pure and synchronous; none imports `lib/providers/*`'s live HTTP clients or any provider SDK.

## Operator/query surface (`lib/provider-actions/operator.ts`, `app/api/provider-actions/route.ts`)

`GET /api/provider-actions?actionId=<id>` returns one action's status; `GET /api/provider-actions?project=<id>` returns an aggregate report. `POST` ingests one action request. Every response includes provider, action type, project, environment, approval state, mutation state (always `"not_mutated"`), dry-run result, blocked reason, verification/rollback plans, evidence refs, remaining owner actions, and `realProviderCallsMade: false`.
