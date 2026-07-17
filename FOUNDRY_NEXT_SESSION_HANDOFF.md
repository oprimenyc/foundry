# FOUNDRY_NEXT_SESSION_HANDOFF

## State at handoff

- Branch `mission/m3-vault-intelligence`. Typecheck clean, **91/91 tests pass**, build
  passes, end-to-end governed release proof passes (11/11). No production mutation, no
  cross-repo writes, nothing pushed.
- New real+tested modules: `envelope.ts`, `routing.ts`, `human-gates.ts`, `artifacts.ts`,
  `release-policy.ts`; human gates wired into `execution.ts`/`saga.ts`; approvals API route.
- Pre-existing uncommitted M4 Operations Center work (`lib/foundry/ops.ts`, `app/api/ops`,
  `tests/ops.test.ts`, `scripts/m4-ops-proof.ts`, `docs/FOUNDRY_M4_*.md`) was preserved and
  committed alongside — it was present at session start, not authored here.

## Highest-value next batch (in order)

1. **Wire vault run-context by default** — call `registerRunVaultContext` +
   `issueExecutionGrant` in the standard run path so every high/critical step consumes a
   scoped grant (machinery built + unit-tested; only run-path integration remains).
2. **Approver-role separation** — the approvals API currently authorizes by run org-scope;
   add a distinct approver role so requester ≠ approver.
3. **Real browser execution** — add Playwright + a `BrowserProvider` adapter to turn
   routing `BROWSER` from `executable:false` into real automation (see
   `FOUNDRY_BROWSER_EXECUTION.md`).
4. **Live vault backend** — instantiate one real backend (Infisical/OpenBao/AWS) via
   `configureVaultAdapter` so the trusted resolver resolves real secrets.
5. **Multi-environment promotion pipeline** — carry a source artifact across real preview→
   staging→production targets (requires configured environments; supervised).
6. **`foundry` CLI** — thin wrapper over the existing API/library operations.
7. **Background-run test isolation** — fix the rare cross-file async leak noted in
   `FOUNDRY_TEST_REPORT.md`.

## Safety constraints unchanged

No production mutation without explicit approval; no MFA/CAPTCHA bypass; no fake provider/
deployment/rollback success; supervised production only after PrimeOS + VERIDIAN complete
their occupied work.
