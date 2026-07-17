# Foundry M4 API

Base route: `/api/ops`

Authentication matches the rest of Foundry: Bearer token or session cookie via `resolvePrincipal`.

## `GET /api/ops`

Returns a full operational snapshot for the authenticated principal's organization.

### Response Shape

```json
{
  "generatedAt": "2026-07-12T21:00:00.000Z",
  "organizationId": "org_local",
  "providerHealth": [],
  "credentials": [],
  "incidents": [],
  "dependencies": {
    "nodes": [],
    "edges": [],
    "sharedCapabilities": [],
    "upstreamDependencies": [],
    "downstreamImpact": [],
    "integrationRisks": [],
    "mermaid": "graph TD"
  },
  "environmentSync": {
    "missingSecrets": [],
    "inconsistentConfiguration": [],
    "staleEnvironmentVariables": [],
    "invalidConfiguration": [],
    "environments": {
      "development": { "referenceCount": 0, "healthyReferences": 0 },
      "staging": { "referenceCount": 0, "healthyReferences": 0 },
      "production": { "referenceCount": 0, "healthyReferences": 0 }
    }
  },
  "approvals": {
    "pending": 0,
    "approved": 0,
    "rejected": 0,
    "requiredActions": []
  },
  "runtimeHealth": {
    "score": 1,
    "services": [],
    "providers": { "healthy": 0, "degraded": 0, "unhealthy": 0 },
    "runs": { "queued": 0, "running": 0, "failed": 0, "completed": 0 },
    "verifications": { "passed": 0, "failed": 0 }
  },
  "rollback": {
    "available": 0,
    "completed": 0,
    "failed": 0,
    "pendingVerification": []
  },
  "evidenceLedger": []
}
```

## `POST /api/ops`

Supports operational incident open/resolve workflows.

### Open Incident

```json
{
  "action": "incident.open",
  "scope": "provider",
  "severity": "high",
  "summary": "Provider outage detected",
  "providerId": "github",
  "projectIds": ["proj_123"],
  "dependencies": ["vercel"],
  "impact": "Repository provisioning is blocked",
  "recommendedActions": ["Fail over to local-git"],
  "rollbackPlan": ["Pause new repository creates"],
  "evidence": [{ "key": "statusPage", "value": "degraded" }]
}
```

Response: `201` with the durable incident record.

### Resolve Incident

```json
{
  "action": "incident.resolve",
  "incidentId": "incident_123",
  "resolutionEvidence": "Runtime verification rerun passed"
}
```

Response: `200` with `{ "ok": true }`.

## Evidence Guarantees

Every scan or incident mutation writes an `operations` ledger record containing:

- actor
- operation
- scope
- status
- inputs
- outputs
- verification
- runtimeProof
- residualRisk

The ledger never stores plaintext secrets.
