# FOUNDRY_ARTIFACT_RETENTION

**Module:** `lib/foundry/artifacts.ts` · **Status:** VERIFIED (local adapter)

Content-addressed retention for execution and release artifacts.

## Guarantees

- **Deterministic ids** — `art_<sha256-prefix>`; identical content ⇒ same id (idempotent,
  no duplicate write).
- **Checksums** — sha256 over the stored bytes; `verifyArtifactIntegrity` re-reads and
  re-hashes to detect tampering/corruption.
- **Redaction first** — content is redacted *before* hashing and writing, so neither the
  on-disk bytes nor the checksum can reconstruct a secret.
- **Retention classes** — `EPHEMERAL` (1h), `STANDARD` (30d), `RELEASE` (1y), `AUDIT`
  (∞), `LEGAL_HOLD` (∞). `RELEASE/AUDIT/LEGAL_HOLD` are immutable.
- **Provenance** — `{producer, source, createdFrom}`, plus `runId/projectId/envelopeId`.
- **Expiry** — `expiredArtifacts(asOf)` lists elapsed, non-immutable artifacts (no
  immutable class is ever returned).
- **Storage adapter boundary** — the local `file://` adapter under
  `.foundry-data/artifacts` (overridable via `FOUNDRY_ARTIFACT_DIR`) is the safe default;
  a production object-store adapter would implement the same `retainArtifact` contract.

## Integration

On successful run completion, `executeRun` retains the release plan (`RELEASE`) and the
signed evidence manifest (`AUDIT`). A retention failure is a **visible degraded-mode
event** (constitution §1), never swallowed.

## Non-goal

This is deliberately NOT a general document-management system. Retained kinds are limited
to execution/release artifacts. Tested in `tests/operations.test.ts`
(content-address/idempotency, tamper detection, redaction, expiry).
