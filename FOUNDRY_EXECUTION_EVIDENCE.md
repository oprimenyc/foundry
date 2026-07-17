# FOUNDRY_EXECUTION_EVIDENCE

**Modules:** `lib/foundry/evidence-manifest.ts`, `execution.ts`, `artifacts.ts` · **Status:** VERIFIED

## Evidence bundle per run

- **Event log** — sequenced, timestamped, redacted execution events (run/step/verification/
  rollback), including routing-mode decisions and gate approvals.
- **Launch evidence** — capability-derived reference completeness (`LaunchEvidenceRecord`).
- **Independent verification** — `VerificationRecord`s (never mutate history).
- **Signed manifest** — `issueSignedEvidenceManifest`: canonical-JSON sha256 over
  per-item-hashed evidence, signed via HMAC-SHA256 / RSASSA-PSS-SHA256 / external-KMS.
  Production fails closed without a real key. Rollback evidence is linked.
- **Retained artifacts** — the release plan (`RELEASE`) and signed manifest (`AUDIT`) are
  content-addressed, checksummed, redacted, and stored (see `FOUNDRY_ARTIFACT_RETENTION.md`).

## Redaction proof

All evidence crosses redaction before persistence. Artifacts are redacted **before** hashing
and writing, so the stored bytes and checksum both exclude secret material (tested).

## Machine-readable output

`scripts/governed-release-proof.ts` emits `proof/evidence/governed-release-proof.json`
containing envelope id, run id, per-stage results, routing modes, gate decision, artifact
ids + checksums, promotion decision, and `productionMutated: false`.
