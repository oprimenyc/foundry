# Foundry — Provider Action Adapter Mega Run: Implementation Report

## Scope

Entirely inside Foundry's write boundary (`C:\Users\jp718\foundry`). No product repo (PantiCandy, vITALCore, dyln, PrimeOpp, VERIDIAN, fylr, NOCTUS, AMOS) was modified — three of them (PantiCandy, vITALCore, PrimeOpp) were read read-only to ground fixture content in real, already-documented facts rather than invented ones (see below). No live provider call, no credential rotation/revocation, no deployment env mutation, no restart/redeploy, no DNS change, no git history rewrite, no push.

## What was built

`lib/provider-actions/`, mirroring `lib/secret-remediation/`'s proven structure (contract types -> pure policy/verdict engine -> approval-gate store -> dry-run-only adapters -> evidence orchestrator -> operator surface -> API route -> proof script -> tests):

- `types.ts` — provider-neutral contract: 8 provider types, 8 action types, 3 target environments, 5 mutation-risk levels, the shared `PASS/FAIL/BLOCKED/PASS_WITH_WARNINGS` verdict vocabulary, 9 approval-gate reasons, a zod schema whose `superRefine` rejects any submission carrying secret-shaped material anywhere.
- `policy.ts` — `requiredApprovalGateReasons()` (pure function mapping action type + provider type + environment + `forcePushRequired` to the exact gates required) and `evaluateProviderActionPolicy()` (the verdict rule — see Proof doc for the full table).
- `gates.ts` — in-memory approval-gate store (pending/approved/rejected, decide-once immutability), modeled after `lib/secret-remediation/gates.ts` but without a TTL/expiry (this module tracks a *future* action, not a time-boxed live-run pause).
- `adapters/` — 11 dry-run-only adapters (GitHub PAT revocation, database credential rotation, Google OAuth rotation, NextAuth secret regeneration, Railway/Fly/Vercel env update, service restart/redeploy, health verification, DNS advisory, git-history-rewrite advisory) plus a registry matching each request to exactly one adapter by `(providerType, actionType)`. Restart/redeploy and health-verification are provider-parameterized classes (one file each, instantiated per Railway/Fly/Vercel) rather than nine near-duplicate files.
- `evidence.ts` — orchestrator: validate -> classify mutation risk -> resolve adapter -> raise gates -> advise -> policy -> retain (via the existing `lib/foundry/artifacts.ts` content-addressed store).
- `operator.ts` + `app/api/provider-actions/route.ts` — query surface; gate status is re-queried live on every read so a decision recorded after ingestion shows up immediately, while the retained evidence package's own verdict stays an immutable snapshot of what was known at ingest time (same discipline `lib/secret-remediation/operator.ts` already established).
- `fixtures/` — the 10 required scenarios (see below).
- `scripts/provider-action-adapter-proof.ts` (`npm run proof:provider-actions`), `tests/provider-actions.test.ts` (27 tests).

## Fixture content: grounded in real, already-documented facts

Rather than inventing plausible-sounding scenarios, three fixtures' `targetDescription`/`sourceReference` fields were sourced directly from each product's own pre-existing containment/readiness docs (read-only, never modified):

- **PantiCandy** (`C:\REPLIT PROJECTS\Panticandy\Panticandy`, HEAD `81ff4680d33a9ee24bb6a3f2d120b98002e2daaa`): the GitHub PAT revocation fixture references the actual embedded-credential finding in `PANTICANDY_SECRET_CONTAINMENT_CURRENT_TRUTH.md`; the DB credential rotation fixture is the explicit historical-exposure follow-up flagged (but explicitly not addressed) in `PANTICANDY_SECRET_CONTAINMENT_ACTIONS.md` item 4.
- **vITALCore** (`...\Active_Projects\vitalcore`, HEAD `f880dda76923229b8cb24ea2b4ea5fb9869a53dd`): all three rotation fixtures (NextAuth, Google OAuth, database) reference the three sensitive variable names `VITALCORE_ENV_CONTAINMENT_ACTIONS.md` confirms were tracked in `.env` and already pushed to `origin` across 4 commits.
- **PrimeOpp** (`C:\Users\jp718\Documents\GitHub\PrimeOpp`): the DNS advisory fixture reflects `PRIMEOPP_DOMAIN_READINESS.md`'s actual finding that no domain is purchased and the app deploys via Replit's own autoscale — **not** Railway/Fly/Vercel. This ruled out an earlier draft plan to frame PrimeOpp's env-update fixtures around those providers; the Railway/Fly/Vercel-specific fixtures were kept explicitly synthetic (`project: "foundry-ops-demo"`) instead of misattributing infrastructure PrimeOpp does not use.
- **dyln**'s staging-env-update fixture is explicitly noted as *not* a verified fact about dyln's real deployment provider — "railway" is used as a representative example only.

No secret value was read from any of these three repos at any point — only variable *names*, already-redacted findings, and doc prose that itself never carried a value.

## Design decisions worth flagging

1. **Verdict immutability vs. live gate status.** An evidence package's `verdict` is frozen at ingest time; only the operator surface's `approvalState`/`remainingOwnerActions` re-query gates live. A later-approved gate does not retroactively upgrade a `BLOCKED` evidence record to `PASS_WITH_WARNINGS` — a fresh submission with `preApprovedGateReasons` set is the intended way to produce a new, correctly-capped verdict. This mirrors `lib/secret-remediation/operator.ts` exactly and was chosen for consistency, not decided fresh.
2. **Mutating actions cap at `PASS_WITH_WARNINGS`, never `PASS`, even fully approved.** Deliberately stronger than the mission's literal requirement ("cannot be PASS if mutation was required but approval was missing") — Foundry has no live executor anywhere in this module, so *something* is always still owed to the human who performs the action, regardless of approval state.
3. **`knownPrerequisiteGaps` is a provider-neutral, caller-supplied string list**, not a per-provider typed field — keeps the Phase 1 contract genuinely provider-neutral while still letting each adapter check for its own prerequisite key (e.g. `"vercel-cli"`).

## Verification

- `npm test`: 169/169 pass (142 pre-existing + 27 new).
- `npm run typecheck`: clean.
- `npm run build`: succeeds; `/api/provider-actions` present in route table.
- `npm run proof:provider-actions`: 37/37 steps pass.
- Manual secret scan over every new file: clean (one deliberately-fake token confined to the rejection-path test, confirmed absent from all retained evidence).

## No real provider calls / no secret values stored / no provider state modified / no product repos modified / approval gates still required for live actions

All confirmed — see the Safety confirmations block in `FOUNDRY_PROVIDER_ADAPTER_MEGA_PROOF.md` and `proof/evidence/provider-action-adapter-proof.json`. Every adapter's `advise()` is pure and synchronous; none imports a live HTTP client or provider SDK. Every mutating action type requires at least `live_provider_mutation` approval before it can leave `BLOCKED`, and even fully approved it never reaches a plain `PASS`.
