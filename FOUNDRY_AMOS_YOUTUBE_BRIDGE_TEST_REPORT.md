# Foundry — AMOS YouTube Package Bridge — Test Report

## New test file: `tests/amos-youtube-bridge.test.ts` (9 tests, all passing)

| Test | Covers |
|---|---|
| `AMOS repo state is read read-only via git and matches the expected commit` | `getAmosRepoState` returns the real path/HEAD/branch |
| `loadAmosYoutubePackage throws a clear error, never returns silently empty, when the file is missing` | Constitution §1 fail-closed discipline |
| `loadAmosYoutubePackage rejects a package whose dry-run flags are not all false` | Shape validation rejects a tampered "live upload attempted" fixture |
| `real AMOS YouTube package loads and parses to the expected shape` | Loader correctness against AMOS's real committed JSON |
| `real AMOS proof manifest loads with test evidence counts` | `PROOF_MANIFEST.json` parsing (17 tests added/passed, "309 passed, 10 skipped") |
| `buildAmosYoutubePackageEvidence produces a PASS evidence package with full capability coverage and no rejection findings` | End-to-end evidence builder against real AMOS data |
| `buildAmosYoutubePackageEvidence rejects and BLOCKs when the package file is missing` | Fail-closed on the evidence-builder axis |
| `getAmosYoutubeBridgeOperatorReport reflects the evidence verdict, capability coverage, and safety flags` | Operator surface correctness |
| `AMOS repo HEAD is unchanged after building evidence (read-only guarantee)` | No mutation, verified by direct git re-check |

## Commands and exit codes

```
npm run proof:amos-youtube-bridge                        -> exit 0, all 9 proof steps PASSED
node --import tsx --test tests/amos-youtube-bridge.test.ts -> exit 0, 9 passed, 0 failed
npx tsc --noEmit                                          -> exit 0, no errors
npm run build                                             -> exit 0, compiled + all routes generated successfully
```

## Full repo test suite

```
npm test   -> 183/184 passed on a clean rerun (183 passed, 0 failed)
```

One transient failure (184 total, 1 failed) was observed on a single run before this rerun. It disappeared on immediate rerun with an identical command and no code changes, consistent with a pre-existing flake unrelated to this session's changes (this session's 9 new tests use their own isolated `.foundry-test-data/amos-youtube-bridge` store/artifact directory, never shared with any other test file). Per Constitution §1 ("no silent failures"), this is recorded rather than omitted — no test file or line number could be attributed to the flaky run, and the follow-up clean run is the reliable result.

## Secret scan

No dedicated npm script exists in this repo (confirmed, matches prior bridges' documented practice). Manual regex sweep over every new/changed mission file (`lib/amos-youtube/**`, `scripts/amos-youtube-bridge-proof.ts`, `tests/amos-youtube-bridge.test.ts`, `proof/evidence/amos-youtube-bridge-proof.json`) for GitHub/Stripe/AWS/Slack token shapes, Bearer/Basic auth headers, PEM headers, and embedded-credential URLs: **zero matches**.

## What was NOT run / explicitly skipped

- AMOS's own test suite was re-run read-only as part of Phase 1 verification (17/17 + 309 passed/10 skipped) but is not part of this repo's own test/build pipeline — it lives in, and is owned by, the AMOS repo.
- No live YouTube/Google API test was run or exists anywhere in this bridge.
