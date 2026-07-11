# PROVIDER_INTERFACE.md

**Foundry Universal Provider Contract — M2**
**Source of truth:** `lib/foundry/universal/types.ts`

---

## UniversalProvider

Every provider implements the execution adapter contract plus the universal
declarations:

```ts
interface UniversalProvider extends ProviderAdapter {
  manifest: ProviderManifest;
  healthCheck(): Promise<ProviderHealthStatus>;
  verify(): Promise<ProviderVerificationResult>;
  execute(action, input): Promise<ProviderExecutionResult>;
  rollback(action, input): Promise<void>;   // alias of compensate
  compensate?(action, input): Promise<void>;
}
```

## ProviderManifest — every provider MUST declare

| Field | Meaning |
|---|---|
| `id` | unique provider id (e.g. `railway`) |
| `name` | display name |
| `category` | one of the 20 universal categories |
| `supportedCapabilities` | declared executable actions — the capability surface |
| `requiredCredentials` | env-var NAMES needed for live execution (never values) |
| `estimatedCost` | `{ currency, amountPerAction, monthlyFloor }` — planning estimate, not billing truth |
| `estimatedLatencyMs` | planning estimate |
| `limitations` | truthful caveats (e.g. "sent email cannot be recalled — no rollback") |
| `documentationUrl` | provider API docs |
| `runtimeStatus` | `live` \| `mock` \| `unavailable` — truthful at registration |

## Execution results carry generic references

`ProviderExecutionResult.references` maps generic keys (`repoUrl`,
`deploymentUrl`, `deploymentId`, `hostingProjectId`, `dnsRecordReference`, …)
that the execution engine merges into the run's `providerReferences`. Adapters
own the mapping; the engine never branches on a provider name
(`lib/foundry/execution.ts`).

## Honesty rules

- Providers that cannot roll an action back (email, SMS) do not declare a rollback — truthfully.
- Mock providers refuse production execution unless `FOUNDRY_ALLOW_MOCKS=explicit-test-mode`.
- `verify()` and `healthCheck()` state their basis (credential presence vs network probe) — they never fabricate runtime claims.
