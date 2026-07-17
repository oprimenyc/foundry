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

---

## E.V.E. cross-runtime signing scope (2026-07-17 amendment)

| Control | Status | Evidence |
|---|---|---|
| RSA-PSS private-key storage | PASS | Key under `.secrets/` only; `.gitignore` excludes `.secrets/`, `*.pem`, `*.key`; never printed (fingerprint only). |
| Public-key trust boundary | PASS | E.V.E. receives only the public key; private key never leaves Foundry. |
| Algorithm confusion | PASS | E.V.E. verifies strictly by `signatureAlgorithm`; unsupported → BLOCKED, never HMAC-downgraded. |
| Unknown signer / tamper / replay | PASS | Proven against a real Foundry manifest: UNKNOWN_SIGNER / CHECKSUM_MISMATCH / REPLAYED. |
| Secret redaction in launch scripts | PASS | `start-foundry-local.ps1` prints fingerprint + status only. |

Foundry cannot self-certify: E.V.E. (a separate runtime) independently re-derives the
manifest hash and verifies the RSA-PSS signature with the trusted public key. See the
VERIDIAN repo `LIVE_FACTORY_INTEGRATION.md` and `FACTORY_RUNTIME_PROOF.md`.
