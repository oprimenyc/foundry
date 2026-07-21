# FOUNDRY_DYLN_EMAIL_QA_PROOF.md

Runtime proof that Foundry's email QA harness is genuinely wired to dyln's real fixtures — no mocked wiring, no simulated success.

## What was executed

```
npm run proof:email-qa-dyln
```

Output (verbatim):

```
✓ 1. all dyln Tier A fixtures loaded and run — loaded 17 fixture(s) from C:\REPLIT PROJECTS\dyln\dyln\server\services\__fixtures__\email
✓ 2. dyln repo path/HEAD/branch captured — path=C:\REPLIT PROJECTS\dyln\dyln, head=9f03187b9ec5e5dbe9ba80c781a1b514db62c63b, branch=feat/v1-deterministic-layer
✓ 3. no real provider call made for any dyln fixture — providerCallMade=true count: 0
✓ 4. every fixture has evidence/inbox/hash refs — checked 17 fixture(s)
✓ 5. only the known follow-up-email sender-mismatch gap fails; nothing else FAILs or is BLOCKED — verdicts={"PASS":16,"FAIL":1}
✓ 6. evidence bundle written and retained as a Foundry artifact — artifactId=art_1fa2080aa0a6d53559bef11f, path=C:\Users\jp718\foundry\proof\evidence\dyln-email-qa-integration-proof.json

All 6 proof steps PASSED. No real provider calls were made. dyln repo was not written to.
```

## Evidence bundle

`proof/evidence/dyln-email-qa-integration-proof.json` (also retained as Foundry artifact `art_1fa2080aa0a6d53559bef11f`, content-addressed and checksum-verified per `lib/foundry/artifacts.ts`). Top-level fields:

```json
{
  "proof": "foundry-dyln-email-qa-integration@1",
  "realProviderCallsMade": false,
  "dylnRepoWritten": false,
  "bundle": {
    "dylnRepoPath": "C:\\REPLIT PROJECTS\\dyln\\dyln",
    "dylnRepoHead": "9f03187b9ec5e5dbe9ba80c781a1b514db62c63b",
    "dylnRepoBranch": "feat/v1-deterministic-layer",
    "fixtures": [ /* 17 entries: fixtureId, functionName, module, fixtureHash, verdict, evidenceId, inboxMessageId, renderedPayloadHash, providerCallMade */ ]
  }
}
```

Verdict breakdown: **16 PASS, 1 FAIL, 0 BLOCKED.** The single FAIL (`follow-up-email`) is the dyln-inventory-documented sender-address inconsistency (gap #3: `noreply@getdyln.com` vs. the canonical `support@getdyln.com`) — an expected, explained result, not a wiring defect. Verified by a dedicated regression test (see test report).

## What this proves

- **Read-only, live wiring, not a stub.** `dylnRepoHead` above was captured via `git -C "C:\REPLIT PROJECTS\dyln\dyln" rev-parse HEAD` at proof-execution time (`lib/email-qa/fixtures/dyln-loader.ts:getDylnRepoState`) — not hardcoded. Re-running this proof after dyln's repo advances will reflect the new HEAD automatically.
- **17 fixtures, not a sample.** Every one of dyln's Tier A `*.json` files was read (`readdirSync` on the real directory, no override used for this run) and produced its own evidence/inbox/hash entry.
- **Zero provider calls, verified per-fixture, not just in aggregate.** `providerCallMade` is computed from each individual `DeliveryCorrelation.simulated` flag, not a single global assumption.
- **Virtual inbox actually persisted 17 messages** — confirmed both by this proof script's step 4 (evidence refs) and directly in `tests/email-qa-dyln.test.ts` via `listInboxMessages({productId:"dyln"})`.
- **No dyln file was touched.** `git status --porcelain` on the dyln repo was checked before and after this mission's work; only pre-existing, unrelated dirty files remained (deployment logs, graphify output) — none newly modified by Foundry.

## Confirmations (explicit, per mission requirement)

- **Real email sent:** NO.
- **Resend called:** NO — `ResendQaAdapter`/real Resend HTTP client was never constructed or invoked anywhere in this mission's code paths; the integration exclusively uses `LocalFixtureAdapter`.
- **Production users emailed:** NO — every fixture recipient is `@dyln.test` (RFC-2606-style reserved test domain) or the synthetic `qa+admin@dyln.test`, never a real dyln inbox.
- **DNS/provider state mutated:** NO.
- **dyln repository modified:** NO.
