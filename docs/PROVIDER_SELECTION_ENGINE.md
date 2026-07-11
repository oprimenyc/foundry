# PROVIDER_SELECTION_ENGINE.md

**Foundry Provider Selection Engine — M2** (`foundry-selection-engine@1`)
**Source:** `lib/foundry/universal/selection.ts`

---

## Contract

The planner never says "deploy to Railway". It says `provider: "auto"` +
`category: "hosting"`. Selection resolves the vendor at plan-validation time
(`lib/foundry/plan.ts`) and stamps `config.selectedBy` on the step.

## Pipeline (fail closed, every rejection recorded)

1. **Category + action filter** — provider must declare the action in its manifest.
2. **Run-level exclusions** — providers already failed in this run (failover).
3. **Tenant policy** — blocked list, allowed list (exclusive if set), monthly cost cap, latency cap.
4. **Credential readiness** — live providers missing credentials are ineligible; mocks are ineligible in production (unless `FOUNDRY_ALLOW_MOCKS=explicit-test-mode`).
5. **Health floor** — rolling score < 0.25 is ineligible *when an alternative exists* (degraded availability beats none — Constitution Art. X).
6. **Ranking** — tenant preferred → health score desc → cost asc → latency asc → id (deterministic).

If nothing survives: `NoEligibleProviderError` carrying every
`{providerId, reason}` rejection. Every decision is explainable
(Constitution Art. VII): decisions carry `reasons[]`, `rejected[]`,
`decidedAt`, `engineVersion`.

## Tenant policy (`TenantPolicy`)

The ONLY place provider preference may live:
`preferredProviders`, `allowedProviders`, `blockedProviders`,
`maxMonthlyCostUsd`, `maxLatencyMs`, `requiredRegions`, `complianceRules`.
No provider names anywhere else in core code (test-enforced).

## Failover

`selectFailover(input, failedProviderId)` re-selects excluding the failure.
Runtime-proven in `tests/universal.test.ts` ("failover selection excludes…").
