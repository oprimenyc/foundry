# FOUNDRY_FYLR_BILLING_BRIDGE_CURRENT_TRUTH.md

Checkpoint 1 for the fylr billing governance bridge mission (hard start condition).

## Repo identity

- **Path**: `C:\Users\jp718\foundry`
- **Branch**: `mission/m3-vault-intelligence`
- **Starting HEAD**: `365e96e690fb70dc7f2bbefc7509d75e7100099e` (matches the mission's expected starting state exactly)
- **Working tree at start**: clean (0 changes, `git status --porcelain` empty)

## Relevant existing modules (read before writing anything)

- **Read-only bridge convention** (product HEAD/branch capture without ever writing to the product repo): `lib/amos-youtube/fixtures/amos-loader.ts::getAmosRepoState()` — reused pattern for `lib/fylr-billing/fixtures/fylr-loader.ts::getFylrRepoState()`.
- **Evidence-package builder convention**: `lib/amos-youtube/evidence.ts::buildAmosYoutubePackageEvidence()` — capability-coverage checklist + rejection-findings list + verdict aggregation (`rejectionFindings.length > 0` → `BLOCKED`; missing coverage → `PASS_WITH_WARNINGS`; else `PASS`). Reused directly for `lib/fylr-billing/evidence.ts::buildFylrBillingEvidence()`.
- **Artifact retention**: `lib/foundry/artifacts.ts::retainArtifact()` — content-addressed, redacted-before-hash, idempotent. Reused as-is, no changes.
- **Raw-secret rejection**: `lib/secret-remediation/secret-scan.ts::scanForRawSecretMaterial()`. Reused as-is, no changes.
- **Operator/query surface convention**: `lib/amos-youtube/operator.ts::getAmosYoutubeBridgeOperatorReport()` — Foundry-side operator report with `eveVerificationVerdict: "NOT_RUN_FROM_FOUNDRY"` always, since Foundry never runs VERIDIAN's E.V.E. itself. Reused directly for `lib/fylr-billing/operator.ts`.
- **Proof-script convention**: `scripts/amos-youtube-bridge-proof.ts` — sandbox reset (`.foundry-proof-<name>/`), `FOUNDRY_PERSISTENCE=file` env vars, `resetFoundryPersistence()`, numbered `record(step, ok, detail)` assertions that throw on first failure, evidence bundle written to `proof/evidence/<name>-proof.json`. Reused directly for `scripts/fylr-billing-bridge-proof.ts`.
- **Test/build config**: `package.json` scripts — `typecheck: tsc --noEmit`, `test: node --import tsx --test tests/**/*.test.ts`, `build: next build`, `proof:<name>: node --import tsx scripts/<name>-proof.ts`. Extended with `proof:fylr-billing-bridge`.
- **No existing billing/Stripe/subscription-lifecycle schema anywhere in Foundry** (`lib/foundry/providers.ts::StripePaymentsAdapter` is a payments-provisioning adapter only — `create_product`/`verify_product`/archive-on-rollback; no subscription/webhook/grace-period concept). This bridge is genuinely new, not an extension of anything Stripe-shaped already in Foundry.

## Unrelated dirty files preserved

None — working tree was clean at start. Nothing to preserve or avoid staging beyond the mission's own new files.

## fylr read-only status

fylr (`C:\REPLIT PROJECTS\fylr\fylr`, branch `main`, HEAD `beba52a9a178a9935ef90b157dceb585aa8f4f2d` — exact match to the mission's expected `beba52a` commit) was read only:
- `app/billing.py` read in full (Stripe webhook route, subscription lifecycle handlers, pricing tiers).
- `tests/test_billing_lifecycle.py` read in full (7 tests covering payment recovery, past_due/unpaid grace preservation, cancellation-to-FREE downgrade, unknown-customer no-op, full lifecycle integration).
- `tests/test_silent_failures.py` grepped for supporting webhook idempotency/failure-path tests (2 additional tests used).
- fylr's own committed pytest suite was invoked read-only (`python -m pytest tests/test_billing_lifecycle.py tests/test_silent_failures.py::test_webhook_idempotency_no_double_fulfill tests/test_silent_failures.py::test_sf05_webhook_double_commit_failure_returns_5xx -v --tb=short`, cwd=fylr repo) — this forces `DATABASE_URL=sqlite://` (in-memory) itself and never touches fylr's real database or files. fylr's git HEAD was confirmed unchanged before and after every run.
- No fylr file was written, edited, or staged. No live Stripe call was made — every webhook test patches `app.billing.stripe` and posts a genuine offline HMAC-signed payload to the real `/billing/webhook` route.

## Remaining mission work at this checkpoint

None outstanding for Foundry's side — `lib/fylr-billing/*`, `scripts/fylr-billing-bridge-proof.ts`, the `proof:fylr-billing-bridge` package.json script, and the evidence bundle at `proof/evidence/fylr-billing-bridge-proof.json` are all in place and passing. See `FOUNDRY_FYLR_BILLING_BRIDGE_IMPLEMENTATION_REPORT.md` for what was built and `FOUNDRY_FYLR_BILLING_BRIDGE_PROOF.md` / `FOUNDRY_FYLR_BILLING_BRIDGE_TEST_REPORT.md` for verification evidence.
