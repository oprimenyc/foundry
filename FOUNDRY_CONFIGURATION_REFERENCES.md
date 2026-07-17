# FOUNDRY_CONFIGURATION_REFERENCES

**Modules:** `lib/vault/*`, `lib/foundry/credentials.ts`, `lib/security/kms.ts` · **Status:** REAL control plane

## Real today

- **Reference-only model** — outside the trusted resolver, everything sees metadata-only
  `SecretReference`s (opaque backend URI, status, scope), never values.
- **Secret rule at intake** — plan/envelope validation requires credential config to be
  `secret:` references, not literals (fail-closed; tested).
- **KMS envelope store** — `lib/security/kms.ts` provides real AES-256-GCM DEK-wrap-under-
  master-key encryption for provider credentials (`credentials.ts`).
- **Redaction taint** — every plaintext the resolver releases is registered and scrubbed
  wherever it appears; Foundry records never persist raw secrets.
- **Versioning** — references carry `version`, `lastRotatedAt`, `expiresAt`; rotation
  results carry `newVersion` and previous-version linkage.

## Gap (honest)

Live vault backends (Infisical, OpenBao, AWS Secrets Manager) are interface-complete but
fail-closed and unconfigured; `configureVaultAdapter` has no runtime caller, so the trusted
resolver has no live adapter yet. Configuration/rollback reference tracking exists in the
model; wiring a live backend is a supervised next step.
