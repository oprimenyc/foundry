# Foundry — dyln Governance Bridge: Current Truth

Read before any edit this mission made. Scope: what already existed in Foundry at HEAD `b094a82` before this mission touched anything.

## 1. Secret remediation workflow (`b094a82`)

Module root `lib/secret-remediation/`. The strongest existing precedent for "evidence + policy + verdict" in this repo:

- `types.ts` — contract types, `REMEDIATION_VERDICTS = [PASS, FAIL, BLOCKED, PASS_WITH_WARNINGS]`, a zod schema whose `.superRefine` runs every string field through `scanForRawSecretMaterial` and rejects raw secret material at the schema level.
- `secret-scan.ts` — `scanForRawSecretMaterial()` / `assertNoRawSecretMaterial()`, regex-based raw-secret detector (GitHub PAT, Stripe, AWS, Slack, Bearer/Basic auth, credentialed URLs, generic `KEY=value`). Reused directly by this mission's new `lib/local-execution/` module.
- `plan.ts` — pure `generateRemediationPlan()`.
- `gates.ts` — in-memory approval-gate store (pending/approved/rejected/expired, 72h TTL, decide-once immutability).
- `adapters/` — dry-run-only provider-classification advisors; `blocked: true` and `noRealMutationConfirmed: true` are literal type fields, not runtime checks.
- `evidence.ts` — orchestrator: validate → classify/verdict → plan → gate → advise → retain → return.
- `operator.ts` — query/report surface.
- Proof: `scripts/secret-remediation-proof.ts` (`npm run proof:secret-remediation`), `tests/secret-remediation.test.ts`.

## 2. Free local email QA harness (`428403f`)

Module root `lib/email-qa/`. `types.ts` (`ProductEmailConfig`, `EmailPayload`, `VERDICTS` — same 4-value vocabulary), `validate.ts` (`runEmailQaValidation` — sender/reply-to/placeholder/link/asset/template-var checks), `inbox.ts` (virtual inbox, redacted + hashed), `evidence.ts` (`runEmailQaAndProduceEvidence`), `adapters/` (`LocalFixtureAdapter` default; `resend-boundary.adapter.ts` gated behind two explicit flags, never the default).

## 3. dyln email QA fixture wiring (`90e09b7`)

`lib/email-qa/fixtures/dyln-loader.ts` — reads dyln's real fixture directory read-only (`server/services/__fixtures__/email/*.json` under `C:\REPLIT PROJECTS\dyln\dyln`, overridable via `DYLN_REPO_PATH`/`DYLN_EMAIL_FIXTURES_DIR`). Independent shape validation (`validateDylnFixtureShape`) — no dyln source imported. `mapDylnFixtureToPayload()` synthesizes a self-consistent `EmailPayload` (unmapped vars → `qa-synth-<var>`). `getDylnRepoState()` does a read-only `git -C <path> rev-parse HEAD` handshake. `runDylnEmailQaIntegration()` is the top-level entry, returning `DylnIntegrationEvidence` (dyln repo path/HEAD/branch, per-fixture `DylnFixtureEvidenceRef[]`). `lib/email-qa/fixtures/dyln.config.ts` holds the confirmed (non-sample) `DYLN_EMAIL_CONFIG` for all 17 Tier A email types. Proof: `npm run proof:email-qa-dyln`, test: `tests/email-qa-dyln.test.ts`.

**Known, pre-existing, documented gap**: `follow-up-email` sends from `noreply@getdyln.com` (not the `support@getdyln.com` every other Tier A template uses) — surfaces as an explained `FAIL` via `SENDER_MISMATCH`, not a harness defect.

## 4. Core `lib/foundry/` substrate

- `lib/foundry/artifacts.ts` — `retainArtifact()`/`listArtifacts()`/`verifyArtifactIntegrity()`: content-addressed local store (redact → hash → write, idempotent by checksum), the shared storage backend both `secret-remediation` and `email-qa` (and this mission's new `local-execution`) build on.
- `lib/foundry/evidence-manifest.ts` — `sha256Canonical()`/`canonicalJson()` (deterministic key-sorted JSON hash, `"sha256:<hex>"` form) — used everywhere for hashing, and confirmed (this mission) to be byte-for-byte compatible with VERIDIAN's own `sha256Canonical` in `src/lib/eve/evidence-authenticity.ts`.
- `lib/foundry/envelope.ts` — `ExecutionEnvelopeSchema` / `EnvelopeDecision`, the closest existing "verdict for an execution request" pattern for governed deployment operations (not directly reused by this mission; `local-execution` needed a run-scoped, not deployment-scoped, contract).
- `lib/foundry/human-gates.ts`, `lib/vault/*` — persisted approval-gate engine and risk/policy classification for deployment run steps; `secret-remediation/gates.ts` deliberately reimplements a lighter, in-memory variant since it has no run/step execution engine to pause. This mission's `lib/local-execution/` follows the same lighter pattern for the same reason.

No existing module named "manifest," "envelope," or "evidence" handled local-worker/Ollama-style execution before this mission — see `FOUNDRY_DYLN_GOVERNANCE_BRIDGE_IMPLEMENTATION_REPORT.md` for what Phase 1 added.

## 5. Test/proof running convention

`package.json` scripts (root, single Next.js 14 app, npm-managed, TypeScript, no jest/vitest — Node's built-in `node --test` runner via `tsx`):

```
"typecheck": "tsc --noEmit"
"test": "node --import tsx --test tests/**/*.test.ts"
"proof:<mission>": "node --import tsx scripts/<mission>-proof.ts"
```

Each mission's proof script runs its pipeline against fixtures and writes a JSON evidence bundle to `proof/evidence/<name>-proof.json` (checked into git). Each mission also ships a matching `tests/<name>.test.ts` and a `FOUNDRY_<MISSION>_{CURRENT_TRUTH,IMPLEMENTATION_REPORT,NEXT_SESSION_HANDOFF,PROOF,TEST_REPORT}.md` doc bundle at repo root — this doc bundle replicates that convention for the dyln governance bridge mission.

## 6. Repo layout

TypeScript/Next.js 14 (App Router), npm. `app/` (routes incl. `app/api/{auth,healthz,ops,plan,projects,providers,secret-remediation}`, and now `app/api/local-execution`), `lib/` (`foundry/`, `email-qa/`, `secret-remediation/`, `vault/`, `orchestration/`, `providers/`, `security/`, `ai/`, and now `local-execution/`), `scripts/`, `tests/` (flat `*.test.ts`), `proof/evidence/*.json`. Runtime artifacts write to `.foundry-data/artifacts/` (gitignored).

## 7. What this mission found and changed (see Implementation Report for full detail)

- Extended `lib/email-qa/fixtures/dyln-loader.ts`'s `DylnFixtureEvidenceRef`/`DylnIntegrationEvidence` with the fields the mission's evidence contract requires (`productConfigHash`, per-check validation summaries, `productionRecipient`, captured content + Foundry-committed per-field hashes for cross-repo tamper evidence, and a worst-of `finalVerdict`) — additive only, no existing behavior changed.
- Along the way, corrected what the new `capturedReplyToAddress` field should carry (the *effective* reply-to a recipient would observe, not only an explicitly-set header) after VERIDIAN's independent E.V.E. verifier legitimately flagged all 17 fixtures on the narrower interpretation — see the Implementation Report's "what E.V.E. caught" section.
- Added `lib/local-execution/` (Phase 1) from scratch, mirroring `lib/secret-remediation/`'s exact structure.
