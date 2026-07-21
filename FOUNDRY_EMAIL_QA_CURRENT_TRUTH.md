# FOUNDRY_EMAIL_QA_CURRENT_TRUTH.md

Checkpoint 1 for the free/local email QA harness mission.

## Repo identity

- **Path:** `C:\Users\jp718\foundry`
- **Branch:** `mission/m3-vault-intelligence`
- **Starting HEAD:** `0a16160f5791de75a195f3a65afe953e25d35e73`
- **Working tree:** clean (`git status --short` empty) — nothing to preserve.

## Relevant existing modules (read before writing anything)

### Provider adapter conventions
- `lib/foundry/universal/types.ts` — `PROVIDER_CATEGORIES` includes `"email"`. `ProviderManifest` requires `id/name/category/supportedCapabilities/requiredCredentials/estimatedCost/estimatedLatencyMs/limitations/documentationUrl/runtimeStatus`. Mocks are truthful (`runtimeStatus: "mock"`), never masquerade as live.
- `lib/foundry/providers.ts` — `ResendEmailAdapter` (real, HTTP) already exists for **Foundry's own deployment-orchestration email step**, wired via `emailRegistry.register(process.env.RESEND_API_KEY ? new ResendEmailAdapter(...) : new MockDomainAdapter(...))`. `mocksExplicitlyAllowed()` gates mock-in-production on `FOUNDRY_ALLOW_MOCKS=explicit-test-mode` — this is the precedent pattern for "explicit env + test mode" gating that the email QA harness's Resend boundary must follow, using its own separate flag so it can never be satisfied by Foundry's unrelated deploy-time flag.
- `lib/providers/domains.adapter.ts` — `ResendAdapter` HTTP client (`sendEmail({from,to,subject,text})` via `ProviderHTTPClient`). Injectable transport for deterministic tests.
- `lib/providers/http-client.ts` — `ProviderHTTPClient`/`ProviderError` — retry/backoff HTTP wrapper used by all adapters.

**Scope note:** the QA harness is a *new, separate* concern from the existing Resend deploy-step adapter above — it validates product-facing customer emails (dyln, PrimeOpp, fylr, PantiCandy, vITAL Core) before they're ever sent, and does not touch or depend on `ResendEmailAdapter`/`emailRegistry`.

### Evidence / artifact / signing conventions
- `lib/foundry/evidence-manifest.ts` — `canonicalJson`, `sha256Canonical` (deterministic content hashing, key-sorted), `issueSignedEvidenceManifest` (HMAC/RSA-PSS/external-KMS signer). Reused directly for hashing config/payload in the QA evidence package.
- `lib/foundry/artifacts.ts` — `retainArtifact` (content-addressed, redacted-before-hash, retention-classed, provenance-stamped local file store under `.foundry-data/artifacts/`), `verifyArtifactIntegrity`, `listArtifacts`. This is the existing "Foundry persistence/evidence convention" the mission tells us to reuse for the virtual QA inbox and evidence packages, instead of inventing new storage.
- `lib/foundry/types.ts` — `ArtifactRecord`/`RetentionClass` (`EPHEMERAL|STANDARD|RELEASE|AUDIT|LEGAL_HOLD`).
- `lib/foundry/store.ts` — file/sqlite persistence pattern (write-temp-then-rename, queued writes). Not modified — QA harness reuses `retainArtifact`/`listArtifacts` rather than adding new collections to the shared `FoundryStore` schema (keeps blast radius local to the new `lib/email-qa/` tree).

### Redaction
- `lib/vault/redaction.ts` — `redactString`/`redactValue`/`containsSecretMaterial`. Reused so nothing written to the virtual inbox or evidence package can carry a live secret even if a caller feeds one in by mistake.

### Release-policy / verdict conventions
- `lib/foundry/release-policy.ts` — deterministic, fail-closed promotion decisions (`PROMOTION_ALLOWED|PROMOTION_ALLOWED_WITH_APPROVAL|PROMOTION_BLOCKED|MANUAL_REVIEW_REQUIRED`). Precedent for the QA harness's own verdict enum (`PASS|FAIL|BLOCKED|PASS_WITH_WARNINGS`) and for "fail-closed on unknown/missing signal" as a design default.

### Schema validation
- `lib/foundry/envelope.ts` — zod schemas (`z.object`, `.default(...)`, `z.infer` for the exported type) is the established pattern for provider-neutral contracts. The QA harness contracts use the same pattern.

### Test/build config
- `package.json` scripts: `test` → `node --import tsx --test tests/**/*.test.ts`; `typecheck` → `tsc --noEmit`; `build` → `next build`; several `proof:*` scripts run standalone `.ts` files via `node --import tsx`. No dedicated secret-scan script exists in this repo today.
- `tests/foundry.test.ts`, `scripts/governed-release-proof.ts` — style precedent: `node:test` + `node:assert/strict` for unit tests; proof scripts print `✓/✗ step — detail` and throw on first failure, writing a JSON evidence bundle under `proof/evidence/`.

### Product config conventions
- No existing per-product config convention exists yet in this repo (`dyln`, `fylr`, etc. are not currently referenced in Foundry's provider/config layer). The QA harness introduces the first one, scoped as `lib/email-qa/fixtures/*` and explicitly marked `sample: true` until a real product repo is wired.

## Conclusion

No existing email-QA, virtual-inbox, or product-email-config code exists in Foundry. This is new, additive work under a new `lib/email-qa/` tree plus `tests/email-qa.test.ts` and `scripts/email-qa-proof.ts`, built on top of the existing artifact/evidence/redaction/zod conventions above. No unrelated dirty files existed to preserve.
