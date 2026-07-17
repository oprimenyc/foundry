# FOUNDRY_CURRENT_RUNTIME_TRUTH

Checkpoint 1 — evidence-based runtime truth, established by reading source (not docs)
at the start of the Production Operations + Governed Release mission.

- **Repo:** `C:\Users\jp718\foundry`
- **Branch:** `mission/m3-vault-intelligence`
- **Starting HEAD:** `9e2a33fd6eac6d557ceef8b648375f6db3b2e4da`
- **Runtime:** Next.js 14 + TypeScript, node test runner (`tsx`), Zod validation.
- **Persistence:** dual-mode `FoundryPersistence` — atomic file (dev) / `node:sqlite` WAL+FULL (prod). Single JSON-blob store, single-node, write-serialized. `lib/foundry/store.ts`.
- **Baseline at mission start:** `tsc --noEmit` clean; `node --test` → **68/68 pass**.

## Capability classification (before this mission's work)

| # | Capability | Class | Evidence |
|---|------------|-------|----------|
| 1 | Execution envelope intake | PARTIAL | `plan.ts` validates a deployment plan draft (Zod, budget, action↔adapter, cycles, secret-ref rule). No canonical *envelope* boundary (mission/operation/environment/expiry/idempotency/rollback requirements). |
| 2 | Execution state machine | REAL (imperative) | `RunStatus` 7 states persisted (`types.ts:1`); transitions driven in `executeRun`/`performRollback`; no declarative guard table; no pause state. |
| 3 | Provider routing (API/CLI/browser/human mode) | BOUNDARY_ONLY | No mode selection existed — one `execute()` path; "browser"/"human" were catalog manifest entries only. |
| 4 | Real provider bindings | REAL (6 HTTP) | GitHub, Vercel, Cloudflare, Resend, Stripe, SignalWire make real `fetch` calls with retry/backoff; selected only when their env credential is set, else fail-closed mock. ~25 others are catalog mocks. |
| 5 | Browser execution (Playwright) | STUB | `playwright` is a `CatalogMockProvider` manifest only; no browser driver/dep. |
| 6 | Human gate pause/resume | PARTIAL (unwired) | Vault approvals/policy/leases fully built + tested in isolation, but **never invoked by the execution engine**; `approvalRequired` steps were *rejected at validation*. No pause/resume. |
| 7 | Provider sessions / identity binding | PARTIAL | `ExecutionGrant`/`machineIdentity` real in vault, but runs never register a vault context. API-caller `Principal` scoping IS real + enforced. |
| 8 | Artifact retention | STUB | No artifact object store, checksums, or retention classes. Only evidence-manifest hashing existed. |
| 9 | Release policy engine | ABSENT | No promotion-decision engine. Only vault access policy + tenant selection policy. |
| 10 | Environment promotion | BOUNDARY_ONLY | Environments exist as vault secret scopes + parity reporting; no promotion pipeline. |
| 11 | Deployment execution | REAL (Vercel) / mock | Real Vercel deploy+poll; Railway/Fly/Netlify are mocks. |
| 12 | Configuration/secret references (Vault) | REAL control plane / scaffold adapters | Metadata-only references, redacted audit, trusted resolver (import-guarded, fail-closed). Live backends (Infisical/OpenBao/AWS) are unconfigured HTTP scaffolds. AES-256-GCM KMS envelope store IS real (`lib/security/kms.ts`). |
| 13 | Post-deployment verification | REAL (2 layers) | In-run launch verification + independent `verifyRunIndependently` (real HTTP, never mutates run history). |
| 14 | Rollback | REAL | Saga compensation in reverse; per-adapter `compensate`; rollback re-authorizes with its own vault scope; truthful about irreversibility. |
| 15 | Restart/reconciliation | REAL | `instrumentation.ts` → `resumeIncompleteRuns`; skips completed steps; double-execution guard. |
| 16 | Execution evidence + signing | REAL | Canonical-JSON sha256 manifests, HMAC / RSA-PSS / external-KMS signers, prod fails closed without a key. |
| 17 | Operator commands | REAL (API) / no CLI | Rich `/api/ops` report + per-run cancel/rollback/verify/logs/plan routes; all auth-gated. No CLI binary. |

## What this mission adds (all Foundry-only, real, tested)

1. **Execution envelope intake** — canonical `lib/foundry/envelope.ts` boundary returning `ACCEPTED / ACCEPTED_WITH_GATES / BLOCKED / REJECTED`, wrapping existing plan validation.
2. **Provider routing modes** — `lib/foundry/routing.ts`: explicit `API | CLI | BROWSER | HUMAN | UNSUPPORTED` per step, persisted, no silent fallback.
3. **Human gate pause/resume** — new persisted `approvalGates` collection + `awaiting_approval` run state; execution pauses at gated steps and resumes from the exact step on approval (survives restart).
4. **Artifact retention** — `lib/foundry/artifacts.ts`: content-addressed local store, sha256 checksums, retention classes (`EPHEMERAL/STANDARD/RELEASE/AUDIT/LEGAL_HOLD`), provenance, redaction, expiry.
5. **Release policy engine** — `lib/foundry/release-policy.ts`: deterministic promotion decision over environment/risk/tests/build/runtime/verification/approvals/artifacts/rollback-readiness.
6. **End-to-end governed release proof** — `scripts/governed-release-proof.ts` exercising the full lifecycle on a safe fixture.

## Honest non-goals this mission does NOT claim
- Real browser (Playwright) automation — remains BOUNDARY_ONLY (documented, honestly blocked).
- Live production deployment/mutation — NOT performed (no production authorization).
- Live vault backend (Infisical/OpenBao/AWS) instantiation — remains scaffold.
