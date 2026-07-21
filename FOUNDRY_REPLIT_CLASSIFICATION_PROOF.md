# Foundry — Replit Deployment Classification: Proof

## Files read

- `lib/provider-actions/types.ts`, `lib/provider-actions/fixtures/primeopp-domain-env-deployment-advisory.fixture.json`, `FOUNDRY_PROVIDER_ADAPTER_MEGA_IMPLEMENTATION_REPORT.md`, `tests/provider-actions.test.ts` (search + verification).

## Files changed

- **`lib/provider-actions/types.ts`** — added `REPLIT_CLASSIFICATION_STATUSES` (`not_applicable` / `dev_stack_origin_only` / `scrub_required`), `REPLIT_DEPLOYMENT_TARGET_STATUSES` (`undecided` / `non_replit_required` / `approved_non_replit_selected`), and an optional `replitClassification` field on the request schema — so a correction like this is a real, schema-validated, evidence-preserved contract field, not just fixture-file prose that a future ingest would silently strip (zod's default `z.object()` behavior strips unrecognized keys).
- **`lib/provider-actions/fixtures/primeopp-domain-env-deployment-advisory.fixture.json`** — `sourceReference` reworded to remove the under-qualified "deployment target is Replit's own autoscale" phrasing; added a `replitClassification: { status: "dev_stack_origin_only", deploymentTargetStatus: "undecided", explanation: "..." }` block making the correction explicit and machine-checkable.
- **`FOUNDRY_PROVIDER_ADAPTER_MEGA_IMPLEMENTATION_REPORT.md`** — corrected the PrimeOpp paragraph to state Replit is PrimeOpp's *current dev-stack host only*, not a deployment recommendation, and to reference this doc bundle.
- **`tests/provider-actions.test.ts`** — 5 new tests (see below).
- **`proof/evidence/provider-action-adapter-proof.json`** — regenerated (`npm run proof:provider-actions`); the PrimeOpp fixture's evidence bundle now carries the `replitClassification` correction.

## Commands run / exit codes

| Command | Result |
|---|---|
| `node --import tsx --test tests/provider-actions.test.ts` | 32/32 pass, exit 0 |
| `npm run typecheck` | clean, exit 0 |
| `npm run proof:provider-actions` | 37/37 steps pass, exit 0 |
| `npm test` (full suite) | 174/174 pass, exit 0 |
| `npm run build` | compiles successfully, exit 0 |
| Manual secret scan (grep) over `lib/provider-actions/` and the regenerated evidence bundle | clean, 0 matches |

## New tests added

1. `Replit is not, and never will be, a value in PROVIDER_TYPES` — asserts the enum itself.
2. `submitting providerType: "replit" is rejected by schema validation` — proves Replit is blocked as a deployment/provider-action target, not merely undocumented.
3. `a request can honestly record Replit as dev-stack-origin-only without that ever counting as a deployment recommendation` — proves the new field round-trips correctly.
4. `the evidence package preserves the replitClassification correction end to end` — proves it is not silently stripped by the schema (the specific risk this fix addresses).
5. `an invalid (uppercase / non-enum) replitClassification.status is rejected` — proves the classification itself is validated, not free-form.

## Confirmations

```
Replit as deployment target: REMOVED from all Foundry prose; BLOCKED at the schema level (never a valid providerType).
Replit as dev provenance: PRESERVED where factual (PrimeOpp's current Replit host is still stated as fact — see PRIMEOPP_DOMAIN_READINESS.md, unmodified — just no longer phrased as if it were a recommendation).
Provider state modified: NO.
Secrets printed/exposed: NO.
Path/provenance mentions (e.g. "C:\REPLIT PROJECTS\dyln\dyln" as a Windows folder name) are unrelated to this fix and were left untouched — that is filesystem provenance, not a deployment claim, and grep confirms no such path string was altered.
```
