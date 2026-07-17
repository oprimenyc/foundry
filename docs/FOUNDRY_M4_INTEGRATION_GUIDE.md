# Foundry M4 Integration Guide

The M4 operations center is designed as a shared control plane for ecosystem products. Consumers should treat Foundry as the authoritative operational observer and incident ledger, not as product-specific business logic.

## Integration Pattern

1. Authenticate with a Foundry principal scoped to the consumer organization's `orgId`.
2. Call `GET /api/ops` to fetch the current operations snapshot.
3. Render or act on:
   - `providerHealth` for provider selection or failover hints
   - `credentials` for rotation queues and ownership workflows
   - `incidents` for alerting and escalation
   - `dependencies` for blast-radius and change-impact analysis
   - `environmentSync` before promotion to staging or production
   - `approvals` before destructive or high-risk actions
   - `runtimeHealth` and `rollback` for deployment safety gates
4. Use `POST /api/ops` for manual incident creation and resolution when an upstream system detects a verified problem first.

## Recommended Consumer Behavior

- VERIDIAN / DYLN / FYLR / PrimeOS: block production deployment when `environmentSync.invalidConfiguration` is non-empty or `runtimeHealth.score` drops below your release threshold.
- Chief-of-Staff style orchestrators: surface `approvals.requiredActions` to humans only when non-empty.
- Provider selection flows: consume `providerHealth` and `incidents` as advisory or gating inputs, not raw vendor heuristics.
- Compliance/audit flows: persist `evidenceLedger` identifiers or snapshots alongside release approvals.

## Secret Handling Rules

- Never expect plaintext secrets from the ops API.
- Use the vault resolver and execution-grant flow for runtime secret access.
- Treat `credentials` as lifecycle metadata only.

## Operational Contracts

- Missing or degraded providers must be handled via incident or failover policy, not hardcoded product exceptions.
- Rollback is considered verified only when rollback metadata and follow-up evidence both exist.
- Shared-provider blast radius is encoded in `dependencies.downstreamImpact`.

## Runtime Verification

Before integrating against M4 in a new consumer, run:

```bash
npm run typecheck
npm test
npm run proof:m4
```

That proves the integration surface, runtime scan, incident derivation, rollback audit, and evidence ledger all match the current implementation.
