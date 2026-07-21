# FOUNDRY_SECRET_REMEDIATION_IMPLEMENTATION_REPORT.md

## What was built

A governed secret exposure remediation orchestrator under
`lib/secret-remediation/`, architected as a self-contained module mirroring
`lib/email-qa/`'s shape (provider-neutral contract + pure plan engine +
evidence via the existing artifact backend + adapters as the only
vendor-aware layer + fixtures). It ingests a secret exposure finding,
classifies the provider and severity, generates a remediation plan, raises
the human approval gates that plan requires, produces dry-run advisories from
six provider-classification-aware (but never live-calling) adapters, and
retains everything as a single evidence artifact — all without ever reading,
storing, or printing a secret value, and without ever calling GitHub, Neon,
Supabase, Google, or Railway.

## Files added

| File | Purpose |
|---|---|
| `lib/secret-remediation/types.ts` | Task 1 contract: zod schema for `SecretExposureFindingInput` (project/repo, file/path, source reference, category, exposure location, severity, containment status, rotation/history-rewrite/deployment-env flags), plus `RemediationPlan`, `RemediationGateRecord`, `RemediationAdvisory`, `SecretRemediationEvidencePackage` types, `classifyProvider`, and the `computeRemediationVerdict` rule. |
| `lib/secret-remediation/secret-scan.ts` | Raw-secret rejection: pattern-matches known secret shapes (GitHub PAT, Stripe, AWS, Slack, Bearer/Basic, URL-embedded creds, `KEY=value` .env-line shape) across every string leaf of an input; deliberately excludes bare hex/base64 blobs so ordinary git commit SHAs are never false-flagged. |
| `lib/secret-remediation/plan.ts` | Task 2 plan engine: pure function, category templates (github_pat/database_url/google_oauth_client_secret/nextauth_secret/generic_env_secret) × exposure-location-conditional containment/rollback steps → `RemediationPlan`. |
| `lib/secret-remediation/gates.ts` | Task 3 approval gates: `RemediationGateRecord` (pending/approved/rejected/expired, 72h TTL, decide-once immutability), scoped to a plan/finding rather than a deployment run (this feature has no execution engine to pause/resume). |
| `lib/secret-remediation/adapters/types.ts` + 6 adapter files + `registry.ts` | Task 4 safe adapter stubs: GitHub PAT, database credential, Google OAuth, NextAuth secret, deployment env update, git history rewrite. Every `advise()` call is synchronous and pure — no adapter has a live-mode escape hatch at all (unlike `lib/email-qa/adapters/resend-boundary.adapter.ts`, which does, behind two explicit flags — deliberately not mirrored here per this mission's absolute "no real provider calls" constraint). |
| `lib/secret-remediation/evidence.ts` | Ties classify → plan → gate → advise together; validates input, rejects raw secrets a second time (defense-in-depth) immediately before persistence, retains the result via `lib/foundry/artifacts.ts`'s `retainArtifact` (content-addressed, redacted-before-hash, retention-classed — `AUDIT` for high/critical severity, `STANDARD` otherwise). |
| `lib/secret-remediation/fixtures/panticandy.fixtures.ts`, `vitalcore.fixtures.ts`, `index.ts` | Task 5 fixture cases, authored directly from the read-only containment docs (see `FOUNDRY_SECRET_REMEDIATION_CURRENT_TRUTH.md`). No secret value from those docs is reproduced — only category, location, and the commit/config metadata those docs themselves already disclosed. |
| `lib/secret-remediation/operator.ts` | Task 6 operator surface: per-finding status (`getRemediationStatus`) and an aggregate report (`getRemediationOperatorReport`) — severity, provider classification, containment state, required approvals (queried live from `gates.ts`, not the frozen evidence snapshot), remediation plan, blocked steps, an always-empty `liveStepsExecuted`, evidence refs, remaining owner actions. |
| `app/api/secret-remediation/route.ts` | Task 6 API surface, mirroring `app/api/ops/route.ts`'s `resolvePrincipal` auth + action-discriminated-union POST convention: `GET` (one finding or the aggregate report), `POST {action:"finding.ingest",...}`, `POST {action:"gate.decide",...}`. |
| `tests/secret-remediation.test.ts` | 13 tests covering every required scenario (see test report). |
| `scripts/secret-remediation-proof.ts` | Runnable end-to-end proof (`npm run proof:secret-remediation`), emits `proof/evidence/secret-remediation-proof.json`. |

`package.json` gained one script: `"proof:secret-remediation"`. `.gitignore`
gained one entry: `.foundry-proof-secret-remediation/`.

## Design decisions and why

- **No new shared schema.** Findings, plans, and evidence are retained as
  content-addressed artifacts via the existing `retainArtifact`/`listArtifacts`
  backend, never as new collections on the shared `FoundryStore` type in
  `lib/foundry/types.ts`/`store.ts`. Same rationale as `lib/email-qa/`: keeps
  the entire mission additive, contained to `lib/secret-remediation/`, and
  zero-risk to every other Foundry module's persistence shape.
- **Gates are their own lightweight store, not `lib/foundry/human-gates.ts`.**
  That module's `ApprovalGateRecord` is bound to a `DeploymentRun`/`PlanStep`
  and a saga pause/resume engine; secret remediation findings have neither.
  `lib/secret-remediation/gates.ts` reimplements the same
  pending/approved/rejected/expired + decide-once-immutable shape (a proven
  pattern already validated in this repo) against a `globalThis`-backed
  module store, the same singleton technique `lib/vault/policy.ts` uses for
  kill switches — this keeps gate decisions fast and testable without wiring
  a second collection into the shared persistence layer.
- **No live-call escape hatch on any adapter, by design.** The email-qa
  Resend boundary has a deliberate two-flag live-mode gate; this mission's
  adapters have none at all, because the mission text is unconditional ("Do
  not call GitHub/Supabase/Neon/Google/Railway APIs") rather than "default
  off." Every adapter's `blocked`/`noRealMutationConfirmed` fields are
  hardcoded `true` literals in the TypeScript type itself (`blocked: true`,
  `noRealMutationConfirmed: true` in `RemediationAdvisory`), not merely
  runtime values that happen to be true today.
- **Verdict can never be a bare `PASS` while anything is still owed.**
  `computeRemediationVerdict` caps at `PASS_WITH_WARNINGS` whenever rotation,
  a deployment env update, or an open history-rewrite decision remains —
  which is every real fixture case, since Foundry itself never performs any
  of those three actions. This is an honesty property, not a limitation to
  work around: a finding reaching true `PASS` would be a false claim unless a
  human had actually gone and rotated the credential outside Foundry.
- **History rewrite and force-push are gated separately from rotation and
  revocation**, per Task 3's explicit list of six distinct gate reasons.
  Approving a rotation gate never auto-approves the history-rewrite gate for
  the same finding (see test 8 / proof step 5a) — the mission's real source
  docs (`PANTICANDY_ENV_HISTORY_ACTIONS.md`, `VITALCORE_ENV_CONTAINMENT_ACTIONS.md`)
  independently treat "rotate now" and "decide on a history rewrite" as two
  separate decisions with different disruption profiles, and the gate model
  reflects that directly.
- **Raw-secret rejection at two independent boundaries.** Schema-level
  (`SecretExposureFindingInputSchema`'s `superRefine`, Task 1's "raw secret
  forbidden" requirement) and again immediately before persistence
  (`assertNoRawSecretMaterial` in `evidence.ts`) — neither trusts the other,
  and both are exercised and re-verified in tests/proof by reading back the
  actual bytes written to disk, not just the in-memory object.
- **Commit-hash false-positive avoided deliberately.** An early version of
  the secret-shape scanner included a bare 32+-char hex/base64 pattern, which
  would have flagged every ordinary 40-char git SHA (routinely stored in
  `sourceReference`) as a raw secret. Removed in favor of only the
  specifically-shaped patterns (`ghp_`, `sk_`, `AKIA`, `xox`, Bearer/Basic,
  URL-embedded creds, `KEY=value` .env-line shape) — verified by a dedicated
  test asserting a real commit SHA scans clean.

## What was intentionally NOT built

- No real GitHub/Neon/Supabase/Google/Railway API call anywhere in this
  mission's code, tests, fixtures, or proof script — verified by the
  `blocked`/`noRealMutationConfirmed` invariant on every adapter and by the
  absence of any HTTP client import in `lib/secret-remediation/adapters/*`.
- No credential rotation, no git history rewrite, no force-push — all six are
  advisory-only, gated, human-executed-elsewhere actions.
- No modification to PrimeOS, PantiCandy, vITALCore, or any other read-only
  input repo — all three were read-only inputs; only Foundry was written to.
- No UI. The mission asked for an orchestrator + operator surface, not a
  dashboard; the API route's JSON responses are the operator surface.
