# Foundry Implementation Report (live runtime + signing for cross-runtime proof)

## Summary

Brought Foundry up as a real independent local HTTP service producing RSA-PSS
signed evidence that E.V.E. (in VERIDIAN) independently verifies — the missing
link in the VERIDIAN → Foundry → E.V.E. chain. Foundry's core (execution, store,
signing, verification) already existed and was sound; this batch added reliable
launch/health/stop scripts and configured RSA-PSS local-dev signing without
weakening any production interface.

## Changes in Foundry (this batch)

- `scripts/start-foundry-local.ps1` — one-command launch: generates a local-dev
  RSA keypair under `.secrets/` (gitignored), configures file persistence +
  RSA-PSS signing, refuses duplicate servers, waits for real health, writes a PID
  file. Never prints secrets.
- `scripts/stop-foundry-local.ps1`, `scripts/test-foundry-health.ps1`.
- `.gitignore` — exclude `.secrets/`, `*.pem`, `*.key` (private-key material never enters git).
- Docs: `FOUNDRY_DISCOVERY_REPORT.md`, `FOUNDRY_LIVE_RUNTIME.md`,
  `FOUNDRY_SIGNING_AUTHORITY.md`, `FOUNDRY_MISSION_EXECUTION.md`,
  `FOUNDRY_RUNTIME_PROOF.md`, security-report amendment, this report.

No application/runtime source was modified — the existing executor, store, and
signer were used as-is (RSA-PSS was already implemented; it just needed a key +
provider env). This keeps Foundry's behavior identical while enabling the proof.

## Proven

- Live HTTP service + truthful health + restart-safe file persistence.
- Real mission execution → RSA-PSS signed evidence manifest.
- E.V.E. independent PASS over the signed evidence (see VERIDIAN docs).
- Tamper / wrong-key / unknown-signer / replay all rejected; Foundry-unavailable fails closed.

## Not done / boundaries

- Live external provider adapters (GitHub/Vercel/…) not exercised — deterministic
  mocks used (no paid APIs), which is an accepted proof mode.
- `external-kms` signer path not exercised (local-kms RSA-PSS used).
- Independent URL-reachability `/verify` view is not required for the E.V.E.
  verdict (mock URLs aren't routable); E.V.E.'s cryptographic verification is the
  independent check.
