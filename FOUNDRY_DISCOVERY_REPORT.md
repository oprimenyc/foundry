# Foundry Discovery Report

**Canonical Foundry repository confirmed.**

- **Path:** `C:\Users\jp718\foundry`
- **Git root:** `C:\Users\jp718\foundry`
- **Branch:** `mission/m3-vault-intelligence`
- **HEAD:** `9131f9f25a4cf52f50bd4a4748f0d301beeba147` — matches the expected HEAD exactly.
- **Worktree at start:** clean.

## Candidates inspected

| Candidate | Verdict | Reason |
|---|---|---|
| `C:\Users\jp718\foundry` | **ACCEPTED** | Git HEAD == `9131f9f`; `package.json` name `"foundry"`; App-Router Next.js with `app/api/projects/*/runs/*/verify`, `lib/foundry/{execution,evidence-manifest,verification,store,auth,providers}.ts`; commit history `foundry: end-to-end governed release proof…`. Architecture matches the VERIDIAN Foundry adapter contract exactly. |
| folders merely named "Foundry" elsewhere | rejected | Not selected on name; only the exact-HEAD repo with matching git history + architecture qualifies. |

## Confirmed facts

- **Runtime:** Next.js 14.2.5 App Router (`package.json`). `npm run dev` / `next start`. Node v22.18.0 (≥22.5 required for the optional sqlite persistence backend). Package manager: **npm** (`package-lock.json`).
- **HTTP host/port:** Next default; overridden via `next dev -p <port>`. Bound to 127.0.0.1 in the launch scripts.
- **Health endpoint:** `GET /api/healthz` (public) — real persistence read/write probe; reports planner/auth/persistence/mock-provider mode.
- **Mission execution API:** `POST /api/projects` → `POST /api/projects/[id]/plan` (accepts a `draftPlan`, avoiding the AI planner) → `POST /api/projects/[id]/runs` → `GET /api/projects/[id]/runs/[runId]` (returns `{run, steps, evidence, evidenceManifests, verifications}`) → `POST|GET /api/projects/[id]/runs/[runId]/verify`.
- **Evidence manifest model:** `SignedEvidenceManifestRecord` (`lib/foundry/types.ts`), `manifestVersion: foundry-evidence-manifest@1`.
- **Signing:** `lib/foundry/evidence-manifest.ts`. RSA-PSS via `FOUNDRY_EVIDENCE_SIGNER_PROVIDER=local-kms-rsa` + `FOUNDRY_EVIDENCE_KMS_PRIVATE_KEY_PEM` (`RsaPssEvidenceManifestSigner`, SHA-256, PSS padding, saltLength 32, `rsa-pss-sha256:` prefix). Also HMAC and external-KMS. Signer identity: key id/version via env (default `foundry-local-dev-key`/`v1`); this proof uses `foundry-eve-proof-rsa`/`v1`.
- **Key loading:** private key from env PEM (`\n`-unescaped); never committed.
- **Persistence:** single-document store (`lib/foundry/store.ts`): `file` (`.foundry-data/store.json`, atomic temp+rename) default in dev; `sqlite` (WAL, transactional) default in production. Restart recovery via `instrumentation.ts` → `resumeIncompleteRuns()`.
- **Provider adapters:** real HTTP adapters when credentialed (GitHub/Vercel/Cloudflare/Stripe/Resend/SignalWire), else deterministic labeled mocks + `local-git`/`local-storage`. Mocks fail closed in production.
- **Runtime executor:** `lib/foundry/execution.ts` `executeRun` — saga orchestrator, per-step timeout/retry, human/vault gates, routing; on success builds launch evidence and **issues the signed manifest**.
- **Retry/idempotency:** run idempotency dedupes by `(projectId, idempotencyKey)`; per-step `retryLimit`.
- **Auth:** `FOUNDRY_API_TOKEN`/`FOUNDRY_PRINCIPALS`; dev/test with none configured is open (`LOCAL_DEV_PRINCIPAL`, `org_local`).
- **Tests:** `npm test` = `node --import tsx --test tests/**/*.test.ts`. Proof scripts under `scripts/`. `npm run smoke`, `npm run typecheck`.
- **Launch scripts (added this mission):** `scripts/start-foundry-local.ps1`, `stop-foundry-local.ps1`, `test-foundry-health.ps1`.

## Discovered blockers (resolved)

- Planner requires `ANTHROPIC_API_KEY`; resolved by submitting a `draftPlan` (no AI planner needed).
- RSA-PSS signing requires a private key; resolved by generating a local-dev RSA keypair under `.secrets/` (gitignored), private key never committed and never shared with E.V.E.

*(Note: the misspelled `FOUNDARY_DISCOVERY_REPORT.md` was intentionally not created; this correctly-spelled file is the canonical report.)*
