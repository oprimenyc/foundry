# Foundry M3 — Prime Vault + Provider Intelligence

**Status:** Implemented on `mission/m3-vault-intelligence` · typecheck clean · 65/65 tests · `npm run proof:m2` PASS with the gate live in the execution path.

## What M3 adds

### 1. Prime Vault (`lib/vault/`)
A **control plane over established secret backends** — never a crypto implementation, never a plaintext store.

| Module | Responsibility |
|---|---|
| `types.ts` | Domain model: `SecretReference` (metadata-only, can never carry a value), `VaultAccessRequest/Decision`, `ExecutionGrant`, `ResolvedSecretLease`, `VaultAccessError` |
| `registry.ts` | Reference index scoped by org/project/environment. Cross-tenant or environment-escalating reads fail as **nonexistence** (no enumeration signal) |
| `policy.ts` | Deterministic risk classification (`classifyActionRisk`), cost ceilings per risk, kill switches (global / emergency / project / provider / capability / machine identity). High/critical risk always requires a manual approval; standing approvals only cover low/moderate |
| `approvals.ts` | One-time, per-run, time-boxed (`allow_until`) and standing (`allow_recurring_policy`) approvals |
| `leases.ts` | `ExecutionGrant`: short-lived, single/limited-use, bound to run+provider+capability+action+references+scope, revocable. `consumeGrant` validates and consumes atomically; every failure is an audited denial |
| `resolver.ts` | **The only module allowed to resolve secret values.** Re-checks kill switches, consumes the grant, re-validates reference scope/status, then delegates to the backend adapter. Browser contexts fail closed. Import guard test enforces nothing outside `lib/vault` imports it |
| `redaction.ts` | Three-layer scrubbing (sensitive keys, runtime taint registry of released plaintexts, pattern matching for bearer/basic/sk_live/ghp/AKIA/xox/URL creds) applied to execution failure messages |
| `execution-gate.ts` | `authorizeStepExecution`: tier 1 (kill switches) binds **every** run; tier 2 (risk/approval enforcement) binds runs registered with a vault context. Rollback needs its own `scope:"rollback"` grant — forward grants never cover it |
| `adapters/` | `interface.ts` + backends: `memory` (dev/test only; refuses production), `openbao`, `infisical`, `aws-secrets-manager` |
| `audit.ts` | Append-only audit events; reference IDs only, never values |

### 2. Provider Intelligence (`lib/foundry/universal/intelligence.ts`)
Deterministic, explainable scoring — recorded components, no opaque model:
- `recordObservation` (success/failure/rollback/auth/rate-limit) with a 200-observation rolling window
- Incidents: open critical incident **disqualifies** a provider when an alternative exists; major/minor apply penalties
- `computeIntelligenceScore`: weighted blend of health, historical/capability/tenant reliability, cost, latency; confidence `n/(n+10)` blends toward a 0.7 neutral prior so **cold-start ordering is identical to pre-M3**
- Selection engine tiebreak: after health, before cost. Winner's components + reasons are returned on `SelectionDecision.intelligence`

### 3. Execution engine wiring (`lib/foundry/execution.ts`)
- Every step and every rollback (saga compensate + `performRollback`) passes through `authorizeStepExecution`; denials fail the step with a redacted, reason-coded message
- Step outcomes feed `recordObservation` (success/failure with latency, rollbacks, gate denials as `auth_failure`)
- Failure messages pass through `redactString` before persistence/events
- With `SelectionInput.vaultScope`, credential availability during selection is answered by secret **references** (status/expiry/capability match — values are never touched). Without it, M2 env-presence behavior is preserved bit-for-bit

## Invariants (test-enforced in `tests/vault.test.ts`)
1. A `SecretReference` can never carry a value (`reference_carries_value`)
2. Scope violations read as nonexistence
3. High/critical actions never execute without a consumed, run-bound grant
4. Grants are single-use, non-transferable, revocable; rollback scope is separate
5. Kill switches dominate policy, resolution, and execution — for all runs
6. Released plaintexts are taint-registered and scrubbed at every boundary
7. `lib/vault/resolver` is imported nowhere outside `lib/vault` (source scan)
8. Memory backend refuses to run in production
9. Cold-start intelligence preserves pre-M3 selection ordering

## Human blockers (unchanged)
Live backend proof needs real OpenBao/Infisical/AWS credentials — founder-supplied, per DL-009 fail-closed rule.
