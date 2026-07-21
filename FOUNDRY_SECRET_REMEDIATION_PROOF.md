# FOUNDRY_SECRET_REMEDIATION_PROOF.md

Runtime proof for the governed secret exposure remediation orchestrator. Run:
`npm run proof:secret-remediation`. Machine-readable bundle:
`proof/evidence/secret-remediation-proof.json`
(`proof: "foundry-secret-remediation-orchestrator@1"`, `realProviderCallsMade: false`, `secretValuesStored: false`).

## Steps executed and verified

| Step | Status | Detail |
|---|---|---|
| 1. raw secret value is rejected, not merely redacted | PASS | a finding carrying a fake `ghp_...`-shaped PAT in its `notes` field throws `SecretExposureFindingValidationError` before a finding is ever created |
| 2. all 6 fixture cases ingest end-to-end | PASS | `ingested=6`, every adapter advisory across all 6 is `blocked=true`/`noRealMutationConfirmed=true` |
| 3. no fixture silently claims full PASS while rotation is outstanding | PASS | all 6 verdicts are `PASS_WITH_WARNINGS` — every real-world case still has an owner action outstanding (rotation, deployment env update, or an open history-rewrite decision), so none can honestly reach `PASS` |
| 4. evidence packages carry no raw secret material | PASS | `clean=true` — the in-memory evidence object and every on-disk artifact file are re-scanned with `scanForRawSecretMaterial` |
| 5. at least one fixture raises a `git_history_rewrite` gate | PASS | `found=true` (the PantiCandy historical-`.env` and all 3 vITALCore git-history-scoped findings raise it) |
| 5a. deciding the rotation gate leaves the history-rewrite gate untouched | PASS | `rotation=approved, rewrite=pending` — confirms the two gates are independently decidable, not a single combined approval |
| 6a. operator surface returns per-finding status with empty live-steps | PASS | `found=true, liveSteps=0` |
| 6b. operator aggregate report covers all ingested findings | PASS | `totalFindings=6` |
| 7. evidence is independently listable via the artifact backend | PASS | `listed=6`, read back via `lib/foundry/artifacts.ts`'s content-addressed store, not from in-process state |

All 9 steps PASSED on a clean sandbox (`.foundry-proof-secret-remediation/`,
deleted and recreated at the start of the run, gitignored) — nothing in this
proof depends on state left over from a previous run.

## What step 3 actually demonstrates

Foundry's verdict rule (`computeRemediationVerdict` in `lib/secret-remediation/types.ts`)
caps every finding at `PASS_WITH_WARNINGS` whenever rotation, a deployment env
update, or an open history-rewrite decision is still outstanding — which is
true of every one of the 6 real fixture cases, because Foundry never performs
any of those three actions itself. This is a deliberate honesty property: a
finding can only reach a bare `PASS` once nothing is left owed, and Foundry
has no path to make that become true on its own.

## What steps 1 and 4 actually demonstrate together

Step 1 proves rejection at the input boundary (schema-level, in
`SecretExposureFindingInputSchema`'s `superRefine`). Step 4 proves it again,
independently, at the storage boundary (`assertNoRawSecretMaterial` right
before `retainArtifact` in `lib/secret-remediation/evidence.ts`, re-checked
here by re-reading every written artifact file off disk). Two separate checks
at two separate boundaries, neither trusting the other.

## Independent re-verification

Anyone can reproduce this proof with zero credentials and zero cost:

```
npm run proof:secret-remediation
```

The script fails closed — any step that doesn't hold throws before printing
`All N proof steps PASSED`, so a truncated or partial run is never mistaken
for success (consistent with `PrimeOS/CONSTITUTION.md` §1, No Silent Failures).
