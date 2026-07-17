# FOUNDRY_PROVIDER_SESSIONS

**Modules:** `lib/vault/types.ts`, `leases.ts`, `resolver.ts`, `execution-gate.ts` · **Status:** PARTIAL

## Real today

- **Machine identity + grant binding** — `ExecutionGrant` binds run/provider/capability/
  action/scope/expiry/uses; `consumeGrant` re-validates every field server-side; a
  "forward" grant never authorizes rollback.
- **Trusted resolver** — import-guarded, fail-closed, registers released plaintext with the
  redaction taint registry so it is scrubbed on sight. Raw cookies/secrets are never
  persisted in audit records.
- **Kill switches** — machine identities can be revoked globally.
- **API-caller identity** — `Principal`/`resolvePrincipal` with org-scoping is enforced on
  every route.

## Gap (honest)

Runs do not yet register a full vault context by default (`authorizeStepExecution` treats
a context-less run with M2 behavior + kill switches). Wiring `registerRunVaultContext` +
`issueExecutionGrant` into the standard run path — so every high/critical step consumes a
scoped grant — is the recommended next step. The machinery is built and unit-tested
(`tests/vault.test.ts`); it is the run-path integration that remains.

No raw cookies or credentials are stored in Foundry records.
