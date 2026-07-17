# FOUNDRY_SECURITY_REPORT

**Verdict:** PASS WITH FINDINGS (findings are documented boundaries, not regressions).

## Controls verified

| Control | Status | Evidence |
|---------|--------|----------|
| Cross-org isolation | PASS | Service-layer org scoping; `tests/foundry.test.ts`. |
| Unauthorized operation | PASS | Vault execution gate + kill switches on every run. |
| Stale / duplicate / replay envelope | PASS | Envelope intake blocks seen idempotency keys; run creation dedupes by idempotency key. |
| Provider-domain allowlist | PASS (existing) | Live adapters validate targets; browser domains allowlisted in manifest. |
| Shell/command injection | PASS | Envelope intake rejects shell-injection patterns in step config. |
| Raw-secret logging / in evidence | PASS | Central redaction; artifacts redacted before hash+write (tested). |
| Artifact tampering | PASS | sha256 integrity re-check detects on-disk tampering (tested). |
| Evidence tampering | PASS (existing) | Signed canonical-JSON manifests. |
| Irreversible op without approval | PASS | High/critical actions raise a human gate and pause. |
| Stale-plan / rejected-gate execution | PASS | Rejected gate fails the run and rolls back. |
| Rollback authorization | PASS (existing) | Rollback re-authorizes with its own vault scope. |
| Production protections | PASS | Mocks fail closed in production; production run needs durable persistence; production mutation not performed. |

## Findings (documented boundaries)

1. **Browser/HUMAN modes are non-executable** — routing returns `executable:false`; no
   automated browser/interactive execution exists. Not a vulnerability; a capability gap.
2. **Live vault backends unconfigured** — Infisical/OpenBao/AWS adapters fail closed; the
   trusted resolver has no adapter at runtime, so real secret resolution is not yet wired.
3. **Approval gate authorization** — the operator API authorizes by run org-scope; a
   dedicated approver-role check (separating requester from approver) is recommended next.

## Not performed

No production mutation, no credential entry, no external publish, no cross-repo writes.
