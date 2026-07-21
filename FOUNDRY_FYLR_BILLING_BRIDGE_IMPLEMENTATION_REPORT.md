# FOUNDRY_FYLR_BILLING_BRIDGE_IMPLEMENTATION_REPORT.md

## Mission

Build Foundry's half of the fylr billing governance bridge: a
machine-readable evidence package proving fylr's Stripe subscription billing
lifecycle is correctly implemented, derived entirely from fylr's own
already-committed code and passing tests, invoked read-only, with zero live
Stripe calls and zero mutation of fylr or any provider.

## What already existed and was reused (not rebuilt)

This bridge follows the exact structural precedent set by
`lib/amos-youtube/*` (the AMOS YouTube package bridge — also a read-only
external-product bridge):

- Read-only repo-state capture pattern (`getAmosRepoState` → `getFylrRepoState`)
- Evidence-package builder pattern: capability/coverage checklist +
  rejection-findings list + verdict aggregation
  (`buildAmosYoutubePackageEvidence` → `buildFylrBillingEvidence`)
- Operator/query surface pattern (`getAmosYoutubeBridgeOperatorReport` →
  `getFylrBillingBridgeOperatorReport`)
- Proof-script sandbox/record() pattern (`amos-youtube-bridge-proof.ts` →
  `fylr-billing-bridge-proof.ts`)
- `lib/foundry/artifacts.ts::retainArtifact()` (unmodified)
- `lib/secret-remediation/secret-scan.ts::scanForRawSecretMaterial()` (unmodified)

## What is genuinely new

fylr has no pre-built, machine-readable "evidence contract" file the way AMOS
does (AMOS commits `proofs/youtube-package/youtube-package.json`). Instead,
fylr's evidence is its own passing pytest suite. So instead of reading a
static JSON file, `lib/fylr-billing/fixtures/fylr-loader.ts::runFylrBillingLifecycleTests()`
**dynamically invokes** fylr's real, already-committed test files via
`spawnSync("python", [...pytest args...], { cwd: fylrRepoPath })` and parses
the real `PASSED`/`FAILED` output — this is stronger evidence than reading a
static claim, at the cost of requiring a working Python/pytest environment on
the machine running the proof (already true in this environment).

`lib/fylr-billing/evidence.ts::buildLifecycleCoverage()` maps each required
lifecycle behavior (mission Phase 2's required list) onto a specific,
real, named fylr test:

| Coverage code | Backed by fylr test |
|---|---|
| `PAYMENT_RECOVERY_CLEARS_GRACE_PERIOD` | `test_payment_succeeded_clears_grace_period` |
| `PAST_DUE_PRESERVES_GRACE_PERIOD` | `test_subscription_past_due_does_not_downgrade_and_preserves_grace` |
| `UNPAID_STARTS_DEFENSIVE_GRACE_PERIOD` | `test_subscription_past_due_starts_defensive_grace_if_none_active` |
| `CANCELLATION_DELETED_DOWNGRADES_TO_FREE` | `test_subscription_deleted_downgrades_to_free` |
| `CANCELLATION_UPDATED_DOWNGRADES_TO_FREE` | `test_subscription_updated_canceled_downgrades_to_free` |
| `UNKNOWN_CUSTOMER_SAFE_NOOP` | `test_webhook_unknown_customer_is_safe_noop` |
| `FULL_LIFECYCLE_RECOVERY_INTEGRATION` | `test_full_lifecycle_recovery_never_downgrades` |
| `WEBHOOK_IDEMPOTENT_DUPLICATE_HANDLING` | `test_webhook_idempotency_no_double_fulfill` (tests/test_silent_failures.py) |
| `WEBHOOK_FAILURE_PATH_RETURNS_5XX` | `test_sf05_webhook_double_commit_failure_returns_5xx` (tests/test_silent_failures.py) |
| `UNSIGNED_WEBHOOK_REJECTION_UNIT_TESTED` | **not found** — honestly reported `present: false`, drives `PASS_WITH_WARNINGS` |

Rejection rules enforced (mission Phase 3): missing product HEAD, missing
test proof refs, a failed pytest run, a missing cancellation→FREE
confirmation, a missing grace-period confirmation, and raw-secret detection
all collapse the verdict to `BLOCKED`. Live-provider/mutation flags
(`liveStripeCallFlag`, `providerMutatedFlag`, `productMutatedFlag`) are
structurally always `false` — this bridge has no code path that could ever
set them `true`.

## Files created

- `lib/fylr-billing/types.ts`
- `lib/fylr-billing/fixtures/fylr-loader.ts`
- `lib/fylr-billing/evidence.ts`
- `lib/fylr-billing/operator.ts`
- `scripts/fylr-billing-bridge-proof.ts`
- `proof/evidence/fylr-billing-bridge-proof.json` (generated evidence artifact)

## Files modified

- `package.json` — added `"proof:fylr-billing-bridge": "node --import tsx scripts/fylr-billing-bridge-proof.ts"`
- `.gitignore` — added `.foundry-proof-fylr-billing-bridge/`

## Blast radius

Zero existing files' logic touched. No route, page, or existing module
imports anything under `lib/fylr-billing/` — this bridge is additive only,
verified by a clean full-repo `tsc --noEmit`, a clean `next build`, and the
full existing 183-test suite passing unchanged.

## Operator/query surface (Phase 6)

No new UI or API route was added — mirrors the AMOS bridge precedent, which
also exposes its operator surface purely through `lib/amos-youtube/operator.ts`
(no Next.js route). `lib/fylr-billing/operator.ts::getFylrBillingBridgeOperatorReport()`
exposes: product, billing domain, lifecycle event coverage (total/present/missing),
Foundry evidence verdict, `eveVerificationVerdict: "NOT_RUN_FROM_FOUNDRY"`
(VERIDIAN's own evidence carries the real E.V.E. verdict), blocker/warning
summary, all three safety flags, evidence refs, and remaining owner actions.
