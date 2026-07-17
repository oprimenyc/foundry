# FOUNDRY_ENVIRONMENT_PROMOTION

**Status:** PARTIAL (policy real; pipeline scaffolded)

## Real today

- **Environment scoping** — `VaultEnvironment` (`development|staging|production`) scopes
  secrets; a lower environment cannot read a higher environment's secret
  (`lib/vault/registry.ts`).
- **Parity reporting** — `analyzeEnvironmentSync` (`lib/foundry/ops.ts`) reports
  configuration/secret-reference gaps across dev/staging/production.
- **Promotion decision** — `evaluatePromotion` (`lib/foundry/release-policy.ts`) is the
  governed gate for `test → preview → staging → production` moves: it evaluates the target
  environment, risk, all signals, approvals, artifact completeness, rollback readiness, and
  change window before allowing a promotion.

## Gap (honest)

A concrete promotion *pipeline* that carries a source artifact between real, distinct
hosting environments (preview→staging→production URLs) is not built — Foundry has one real
hosting adapter (Vercel) and does not create fake environments. Promotion is proven at the
decision + evidence level (end-to-end proof stages 2 & 9), not as a multi-environment
artifact hand-off. Real multi-env promotion requires configured target environments per
provider, which is deferred to a supervised production batch.
