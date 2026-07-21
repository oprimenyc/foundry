# Foundry Local Execution Evidence Adapter — Proof

Phase 1 of the dyln governance bridge mission. Module: `lib/local-execution/`. Machine-readable bundle: `proof/evidence/local-execution-evidence-proof.json` (run `npm run proof:local-execution` to regenerate).

## What this proves

Foundry can ingest, normalize, policy-evaluate, and expose an operator surface for **local-worker execution evidence** (Ollama, a local CLI agent, a PrimeOS-tier local runtime, ...) without ever executing a local worker itself, without ever calling a real provider, and without ever accepting raw secret material.

## Contract (`lib/local-execution/types.ts`)

Required fields all present: mission id, product/repo target, local adapter type (`jcode`/`wigolo`/`ollama`/`primeos_tier`/`generic`), local model/runtime, command class, allowed file scope, files touched, commands run, exit codes, wall-clock time, retries, cache/retrieval references, proof artifacts, secret-scan result, provider-mutation flag, source-mutation flag, final local verdict (`PASS`/`FAIL`/`BLOCKED`/`PASS_WITH_WARNINGS`).

## Ingest/normalize (`lib/local-execution/ingest.ts`)

| Rejection | Trigger | Result |
|---|---|---|
| `malformed_evidence` | not a JSON object / zod schema failure | rejected (hash-only ref retained) |
| `missing_mission_id` | no `missionId` | rejected |
| `missing_adapter_type` | no `adapterType` | rejected |
| `missing_command_log` | empty/absent `commandsRun` | rejected |
| `secret_exposure_detected` | any string field matches `scanForRawSecretMaterial` | rejected — raw match text never persisted |
| `unapproved_provider_mutation_claim` | `providerMutationOccurred: true` with **no gate reference at all** | rejected |

A provider-mutation claim that *does* reference a gate (even an unapproved one) is **accepted** and evaluated by policy as `BLOCKED` — distinguishing "structurally incomplete claim" (ingest-level refusal) from "complete evidence of a pending-approval action" (policy-level, still-reviewable evidence).

## Policy (`lib/local-execution/policy.ts`)

- Forbidden command class (`git_history_rewrite`) → `FAIL`.
- Out-of-scope file mutation → `FAIL`.
- Every command failed (no evidence of a successful local execution — e.g. tool not installed) → `BLOCKED`.
- Provider mutation with no/unapproved gate → `BLOCKED`.
- High-risk domain touched (auth/billing/security/deploy/database) → `BLOCKED` + `frontierReviewRequired: true`.
- Missing proof artifacts → `FAIL` at high/critical criticality, warning otherwise.
- Slow execution (>120s) → warning only.
- Every accepted record carries `requiresIndependentVerification: true` — a local `PASS` is never final authority on its own.

## The six required fixtures (`lib/local-execution/fixtures/`) — actual results

| Fixture | Status | Verdict | Why |
|---|---|---|---|
| `jcode-blocked.fixture.json` | accepted | `BLOCKED` | J-code CLI not installed (exit 127); all commands failed |
| `wigolo-blocked.fixture.json` | accepted | `BLOCKED` | `npm install -g wigolo` failed on local TLS/OpenSSL cert validation; all commands failed |
| `ollama-cpu-slow.fixture.json` | accepted | `PASS_WITH_WARNINGS` | CPU-only Ollama run succeeded but took 184.3s (>120s threshold) |
| `primeos-tier-proof.fixture.json` | accepted | `PASS` | Clean, fast, proof artifact attached |
| `blocked-provider-mutation.fixture.json` | accepted | `BLOCKED` | Provider mutation claimed under a gate that exists but is not approved |
| `blocked-secret-exposure.fixture.json` | **rejected** | n/a | GitHub-PAT-shaped fake token embedded in a command string — caught before policy ever ran |

Operator report over all six: `totalSubmissions=6, accepted=5, rejected=1, byVerdict={PASS:1, PASS_WITH_WARNINGS:1, BLOCKED:3, FAIL:0}, pendingEscalations=1`.

## Safety confirmations

- `realWorkersExecuted: false` — every fixture is a pre-recorded evidence submission; no local worker ran.
- `realProviderCallsMade: false` — the one provider-mutation claim was never treated as authorized.
- `secretValuesStored: false` — the fake token's literal text does not appear anywhere in the retained rejection record (verified by grep against the written evidence bundle).

## Operator/query surface (`lib/local-execution/operator.ts`, `app/api/local-execution/route.ts`)

`GET /api/local-execution?productTarget=<id>` returns, per submission: adapter, target repo/product, local verdict, policy verdict, required escalations, evidence refs, command summary, touched-files summary — plus an aggregate report (verdict tally, pending-escalation count). `POST` ingests one raw submission.
