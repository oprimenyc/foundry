# FOUNDRY_TEST_REPORT

## Result

- **Typecheck** (`tsc --noEmit`): PASS
- **Full test suite** (`node --test tests/**/*.test.ts`): **91 pass / 0 fail**
  (68 pre-existing + 23 new in `tests/operations.test.ts`).
- **Build** (`next build`): PASS.
- **End-to-end proof** (`npm run proof:release`): PASS (11/11 stages).

## New coverage (`tests/operations.test.ts`, 23 tests)

- Envelope intake: accept, accept-with-gates, reject (invalid/expired/forbidden-command),
  block (literal secret, replay). (7)
- Routing: API executable, UNSUPPORTED unknown provider fail-closed, high-risk human gate. (3)
- Release policy: allow, block-on-failed-gate, block-no-rollback, unknown→manual-review,
  production approval gating, critical-always-review. (6)
- Artifact retention: content-address/idempotency, tamper detection, redaction, expiry. (4)
- Human gates: requirement evaluation; pause→approve→complete; pause→reject→fail. (3)

## Pre-existing note

A single sqlite test ("survives process-level reset") failed once transiently during one
combined run, then passed 3/3 consecutively and in isolation. Root cause is the
pre-existing `setTimeout`-based background execution model leaking async writes across test
files when the whole suite runs together — not introduced by this mission. Recommend
isolating background-run lifecycles per test in a future pass.

## Secret scan

New source files scanned for live key shapes (`sk_live`, `ghp_…`, `AKIA…`, PEM headers):
clean. Artifact redaction verified to keep secret material off disk and out of checksums.

---

## Live cross-runtime amendment (2026-07-17)

- `npm run typecheck` — PASS (0 errors).
- `npm test` — **91 passed / 0 failed / 0 skipped** (~65s).
- `npm run build` — PASS (exit 0).
- Live runtime smoke: `GET /api/healthz` 200; real create→plan(draftPlan)→run→RSA-PSS signed manifest observed.
- Cross-runtime: VERIDIAN `/api/factory/live-mission` → E.V.E. independent **PASS** over Foundry's RSA-PSS signed evidence; tamper/wrong-key/unknown-signer/replay rejected; Foundry-unavailable → 503 fail-closed. See VERIDIAN `FACTORY_RUNTIME_PROOF.md`.
