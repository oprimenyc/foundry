# FOUNDRY_DYLN_EMAIL_QA_TEST_REPORT.md

## Targeted tests

`node --import tsx --test tests/email-qa.test.ts tests/email-qa-dyln.test.ts`

**20/20 pass** (12 pre-existing generic tests + 1 new product-identity regression test in `email-qa.test.ts`; 7 new tests in `email-qa-dyln.test.ts`).

New tests in `tests/email-qa-dyln.test.ts`, mapped to the mission's required scenarios:

| Required scenario | Test |
|---|---|
| valid fixture | `valid dyln fixture maps to a payload that passes Foundry QA` |
| missing fixture | `missing fixture directory throws a clear error, never returns silently empty` |
| malformed fixture | `malformed fixture (invalid JSON and missing required field) is rejected, not silently accepted` (covers both invalid-JSON and missing-required-field cases) |
| wrong product identity | `payload claiming the wrong product identity fails against the dyln config` |
| unresolved placeholder | `unresolved placeholder against the confirmed dyln config is BLOCKED (welcome is release-blocking)` |
| no provider call | `full dyln integration: 17 real fixtures, no provider call, inbox capture, evidence refs all present` (asserts `providerCallMade === false` for all 17, not a sample) |
| inbox capture | same test — asserts `listInboxMessages({productId:"dyln"})` returns 17 messages |
| evidence refs | same test — asserts every fixture ref carries `evidenceId`, `inboxMessageId`, `sha256:`-prefixed `fixtureHash`/`renderedPayloadHash`, and the bundle carries `dylnRepoPath`/`dylnRepoHead` (40-hex-char SHA validated) |

Plus:
- `dyln's known sender-mismatch gap ... surfaces as an explained FAIL, not a silent pass` — regression-pins design decision #2 (see implementation report) so a future change can't silently "fix" it into a false PASS without a test noticing.
- `loader parses all 17 real dyln fixture files without throwing` — direct loader smoke test against the real fixtures directory (no dir override).

Added to the existing generic suite (`tests/email-qa.test.ts`):
- `payload productId mismatched against config productId fails` — regression test for the new generic `productIdentity` check.

## Full Foundry test suite

`npm test` — **111/111 pass** on the final run.

One transient failure was observed on an earlier run (`rollback executes compensation in reverse`, `tests/foundry.test.ts`, `ENOENT` on `.foundry-test-data/rollback.json`). Investigated before proceeding: reproduced on the **unmodified baseline commit** (`428403f`, via `git stash`) as well — 1/110 failing there too, same test, same error shape. This is a pre-existing cross-test-file race (Node's test runner executes `tests/**/*.test.ts` files in parallel by default; `tests/foundry.test.ts` shares a top-level `.foundry-test-data` root across concurrently-running test files) — not caused by this mission's changes. Confirmed by re-running with this mission's changes restored: 111/111 clean. Not fixed in this mission (pre-existing, unrelated file, out of scope) — flagged here per Constitution §1 rather than silently ignored.

## Proof scripts

`npm run proof:email-qa` — **6/6 steps PASS** (generic harness proof, updated for the confirmed dyln config).
`npm run proof:email-qa-dyln` — **6/6 steps PASS**:
1. All 17 real dyln Tier A fixtures loaded and run.
2. dyln repo path/HEAD/branch captured read-only (`9f03187b9ec5e5dbe9ba80c781a1b514db62c63b`, `feat/v1-deterministic-layer`).
3. Zero real provider calls across all 17 fixtures.
4. Every fixture has evidence/inbox/hash refs.
5. Verdict breakdown: 16 PASS, 1 FAIL (`follow-up-email`, the known/expected sender-mismatch gap), 0 BLOCKED.
6. Evidence bundle written to `proof/evidence/dyln-email-qa-integration-proof.json` and retained as Foundry artifact `art_1fa2080aa0a6d53559bef11f`.

## Typecheck

`npm run typecheck` — clean (one pre-existing-shape TS2345 in the new `dyln-loader.ts`, found and fixed during this mission — see implementation report).

## Build

`npm run build` — `next build` compiles and generates all 6 static/dynamic routes successfully.

## Secret scan

No dedicated secret-scan tool exists in this repo (confirmed absent in `node_modules/.bin`, consistent with the prior session's own finding). Ran a manual regex sweep (`api[_-]?key|secret|password|token|bearer|-----BEGIN|AKIA...|sk-...|re_...`) across every new/changed file and both generated evidence JSON bundles (`proof/evidence/{email-qa,dyln-email-qa-integration}-proof.json`). Findings: only test/proof-script stub keys (`re_test_key`, `re_proof_key`) that were already present in the pre-existing test suite — no real credentials, no real dyln recipient addresses (only `support@getdyln.com` as a `from` field, which is a real but non-secret production sender identity, never a recipient). **PASS** (manual scan, not an automated tool — stated plainly per Constitution §1).
