import { listApprovals } from "@/lib/vault/approvals";
import { listOrganizationReferences } from "@/lib/vault/registry";
import { probeProvider } from "./universal/health";
import { computeIntelligenceScore, openIncident, providerObservationSummary, resolveIncident } from "./universal/intelligence";
import { credentialStatusFor } from "./universal/credentials";
import { universalRegistry } from "./universal/catalog";
import {
  createOperationEvidenceRecord,
  createOperationalIncidentRecord,
  getStoreSnapshot,
  insertRecord,
  updateRecords,
} from "./store";
import { persistenceHealth } from "./service";
import type {
  OperationEvidenceRecord,
  OperationalIncidentRecord,
  OperationalIncidentSeverity,
  OperationalIncidentStatus,
} from "./types";

const STALE_ROTATION_DAYS = 90;
const EXPIRING_SOON_DAYS = 14;

type EnvironmentName = "development" | "staging" | "production";

export interface ProviderOperationsStatus {
  providerId: string;
  category: string;
  availability: "available" | "degraded" | "unavailable";
  latencyMs?: number;
  failures: number;
  quotas: "healthy" | "rate_limited" | "unknown";
  estimatedCostUsd: number;
  confidence: number;
  healthScore: number;
  credentialStatus: "configured" | "missing";
  detail: string;
}

export interface CredentialLifecycleStatus {
  providerId: string;
  providerCategory?: string;
  owner: string;
  source: "vault_reference" | "encrypted_store";
  projectIds: string[];
  dependencyProviders: string[];
  status: string;
  classification: string;
  expiresAt?: string;
  rotationRequired: boolean;
  approvalRequired: boolean;
  verification: "verified" | "warning" | "failed";
}

export interface DependencyGraphReport {
  nodes: Array<{ id: string; type: "project" | "provider"; label: string }>;
  edges: Array<{ from: string; to: string; kind: "consumes" | "depends_on" | "shared_provider" }>;
  sharedCapabilities: Array<{ providerId: string; projectIds: string[] }>;
  upstreamDependencies: Array<{ providerId: string; dependsOn: string[] }>;
  downstreamImpact: Array<{ providerId: string; projectIds: string[]; blastRadius: number }>;
  integrationRisks: string[];
  mermaid: string;
}

export interface EnvironmentSyncReport {
  missingSecrets: string[];
  inconsistentConfiguration: string[];
  staleEnvironmentVariables: string[];
  invalidConfiguration: string[];
  environments: Record<EnvironmentName, { referenceCount: number; healthyReferences: number }>;
}

export interface RuntimeHealthReport {
  score: number;
  services: Array<{ name: string; healthy: boolean; detail: string }>;
  providers: { healthy: number; degraded: number; unhealthy: number };
  runs: { queued: number; running: number; failed: number; completed: number };
  verifications: { passed: number; failed: number };
}

export interface ApprovalReport {
  pending: number;
  approved: number;
  rejected: number;
  requiredActions: Array<{ action: string; providerId: string; environment: string; risk: string }>;
}

export interface RollbackReport {
  available: number;
  completed: number;
  failed: number;
  pendingVerification: string[];
}

export interface OperationsReport {
  generatedAt: string;
  organizationId: string;
  providerHealth: ProviderOperationsStatus[];
  credentials: CredentialLifecycleStatus[];
  incidents: OperationalIncidentRecord[];
  dependencies: DependencyGraphReport;
  environmentSync: EnvironmentSyncReport;
  approvals: ApprovalReport;
  runtimeHealth: RuntimeHealthReport;
  rollback: RollbackReport;
  evidenceLedger: OperationEvidenceRecord[];
}

function severityRank(severity: OperationalIncidentSeverity): number {
  return { low: 1, medium: 2, high: 3, critical: 4 }[severity];
}

function daysUntil(isoDate: string): number {
  return Math.ceil((new Date(isoDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function daysSince(isoDate: string): number {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / (24 * 60 * 60 * 1000));
}

function providerProjects(snapshot: Awaited<ReturnType<typeof getStoreSnapshot>>, projectIdByProvider: Map<string, Set<string>>) {
  for (const plan of snapshot.plans) {
    const project = snapshot.projects.find((item) => item.id === plan.projectId);
    if (!project) continue;
    for (const step of plan.steps) {
      const bucket = projectIdByProvider.get(step.provider) ?? new Set<string>();
      bucket.add(project.id);
      projectIdByProvider.set(step.provider, bucket);
    }
  }
  for (const credential of snapshot.credentials) {
    const bucket = projectIdByProvider.get(credential.provider) ?? new Set<string>();
    if (credential.projectId) bucket.add(credential.projectId);
    projectIdByProvider.set(credential.provider, bucket);
  }
}

async function recordOpsEvidence(
  input: Omit<OperationEvidenceRecord, "id" | "timestamp">
): Promise<OperationEvidenceRecord> {
  const record = createOperationEvidenceRecord(input);
  await insertRecord("operations", record);
  return record;
}

function mapProviderAvailability(healthy: boolean, score: number): ProviderOperationsStatus["availability"] {
  if (!healthy || score < 0.35) return "unavailable";
  if (score < 0.7) return "degraded";
  return "available";
}

export async function collectProviderHealth(actor = "ops-center"): Promise<ProviderOperationsStatus[]> {
  const providers = universalRegistry.list().map((providerId) => universalRegistry.get(providerId));
  const statuses: ProviderOperationsStatus[] = [];
  for (const provider of providers) {
    const probe = await probeProvider(provider);
    const observations = providerObservationSummary(provider.provider);
    const intelligence = computeIntelligenceScore(provider.provider, {
      capability: provider.manifest.category,
      credentialAvailable: credentialStatusFor(provider.manifest).satisfied,
    });
    statuses.push({
      providerId: provider.provider,
      category: provider.manifest.category,
      availability: mapProviderAvailability(probe.healthy, intelligence.score),
      latencyMs: observations.averageLatencyMs ?? probe.latencyMs,
      failures: observations.failures + observations.authFailures + observations.credentialFailures,
      quotas: observations.rateLimits > 0 ? "rate_limited" : "unknown",
      estimatedCostUsd: provider.manifest.estimatedCost.amountPerAction,
      confidence: intelligence.components.confidence,
      healthScore: intelligence.score,
      credentialStatus: credentialStatusFor(provider.manifest).satisfied ? "configured" : "missing",
      detail: probe.detail,
    });
  }

  await recordOpsEvidence({
    operation: "provider.health.scan",
    actor,
    scope: "provider",
    status: statuses.some((item) => item.availability === "unavailable") ? "warning" : "passed",
    inputs: { providers: String(statuses.length) },
    outputs: {
      unavailable: String(statuses.filter((item) => item.availability === "unavailable").length),
      degraded: String(statuses.filter((item) => item.availability === "degraded").length),
    },
    verification: ["active provider probes completed", "intelligence scores recalculated"],
    runtimeProof: statuses.map((item) => `${item.providerId}:${item.availability}:${item.healthScore}`),
    residualRisk: statuses.filter((item) => item.credentialStatus === "missing").map((item) => `${item.providerId} missing credentials`),
  });

  return statuses.sort((a, b) => a.providerId.localeCompare(b.providerId));
}

export async function discoverCredentials(organizationId: string, actor = "ops-center"): Promise<CredentialLifecycleStatus[]> {
  const snapshot = await getStoreSnapshot();
  const references = listOrganizationReferences(organizationId);
  const projectNames = new Map(snapshot.projects.map((project) => [project.id, project.name]));
  const dependencies = buildProviderDependencyMap(snapshot);

  const vaultEntries: CredentialLifecycleStatus[] = references.map((reference) => ({
    providerId: reference.providerId || "unassigned",
    providerCategory: reference.category,
    owner: projectNames.get(reference.projectId) || reference.projectId,
    source: "vault_reference" as const,
    projectIds: [reference.projectId],
    dependencyProviders: dependencies.get(reference.providerId || "unassigned") || [],
    status: reference.status,
    classification: reference.capabilities.join(",") || "general",
    expiresAt: reference.expiresAt,
    rotationRequired:
      reference.status === "rotation_due" ||
      reference.status === "expired" ||
      (!!reference.lastRotatedAt && daysSince(reference.lastRotatedAt) >= STALE_ROTATION_DAYS) ||
      (!!reference.expiresAt && daysUntil(reference.expiresAt) <= EXPIRING_SOON_DAYS),
    approvalRequired: reference.requiresApproval,
    verification:
      reference.status === "available" || reference.status === "rotation_due" ? "verified" : reference.status === "missing" ? "warning" : "failed",
  }));

  const encryptedEntries: CredentialLifecycleStatus[] = snapshot.credentials
    .filter((credential) => credential.orgId === organizationId)
    .map((credential) => ({
      providerId: credential.provider,
      providerCategory: universalRegistry.has(credential.provider) ? universalRegistry.get(credential.provider).manifest.category : undefined,
      owner: credential.projectId ? projectNames.get(credential.projectId) || credential.projectId : organizationId,
      source: "encrypted_store" as const,
      projectIds: credential.projectId ? [credential.projectId] : [],
      dependencyProviders: dependencies.get(credential.provider) || [],
      status: credential.rotatedAt ? "rotated" : "active",
      classification: credential.purpose,
      expiresAt: undefined,
      rotationRequired: !credential.rotatedAt || daysSince(credential.rotatedAt) >= STALE_ROTATION_DAYS,
      approvalRequired: false,
      verification: "verified" as const,
    }));

  const combined = [...vaultEntries, ...encryptedEntries].sort((a, b) => `${a.providerId}:${a.owner}`.localeCompare(`${b.providerId}:${b.owner}`));

  await recordOpsEvidence({
    operation: "credentials.discovery",
    actor,
    scope: "credential",
    status: combined.some((item) => item.rotationRequired || item.verification !== "verified") ? "warning" : "passed",
    inputs: { organizationId },
    outputs: { credentials: String(combined.length) },
    verification: ["secret values were not read", "metadata-only lifecycle scan completed"],
    runtimeProof: combined.map((item) => `${item.providerId}:${item.source}:${item.status}`),
    residualRisk: combined.filter((item) => item.rotationRequired).map((item) => `${item.providerId} requires rotation review`),
  });

  return combined;
}

function buildProviderDependencyMap(snapshot: Awaited<ReturnType<typeof getStoreSnapshot>>): Map<string, string[]> {
  const upstream = new Map<string, Set<string>>();
  for (const plan of snapshot.plans) {
    const stepById = new Map(plan.steps.map((step) => [step.id, step]));
    for (const step of plan.steps) {
      const bucket = upstream.get(step.provider) ?? new Set<string>();
      for (const dependencyId of step.dependsOn) {
        const dependencyStep = stepById.get(dependencyId);
        if (dependencyStep && dependencyStep.provider !== step.provider) bucket.add(dependencyStep.provider);
      }
      upstream.set(step.provider, bucket);
    }
  }
  return new Map(Array.from(upstream.entries()).map(([providerId, providers]) => [providerId, Array.from(providers).sort()]));
}

export async function discoverDependencies(organizationId: string, actor = "ops-center"): Promise<DependencyGraphReport> {
  const snapshot = await getStoreSnapshot();
  const orgProjects = snapshot.projects.filter((project) => project.orgId === organizationId);
  const nodes: DependencyGraphReport["nodes"] = [];
  const edges: DependencyGraphReport["edges"] = [];
  const sharedByProvider = new Map<string, Set<string>>();
  const upstream = buildProviderDependencyMap(snapshot);

  for (const project of orgProjects) {
    nodes.push({ id: project.id, type: "project", label: project.name });
    const plan = snapshot.plans
      .filter((item) => item.projectId === project.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!plan) continue;
    for (const step of plan.steps) {
      const providerId = step.provider;
      if (!nodes.some((node) => node.id === providerId)) {
        nodes.push({ id: providerId, type: "provider", label: providerId });
      }
      edges.push({ from: project.id, to: providerId, kind: "consumes" });
      const bucket = sharedByProvider.get(providerId) ?? new Set<string>();
      bucket.add(project.id);
      sharedByProvider.set(providerId, bucket);
      for (const dependencyId of step.dependsOn) {
        const dependency = plan.steps.find((candidate) => candidate.id === dependencyId);
        if (dependency && dependency.provider !== providerId) {
          edges.push({ from: providerId, to: dependency.provider, kind: "depends_on" });
        }
      }
    }
  }

  const sharedCapabilities = Array.from(sharedByProvider.entries())
    .map(([providerId, projectIds]) => ({ providerId, projectIds: Array.from(projectIds).sort() }))
    .filter((item) => item.projectIds.length > 1)
    .sort((a, b) => a.providerId.localeCompare(b.providerId));

  const downstreamImpact = Array.from(sharedByProvider.entries())
    .map(([providerId, projectIds]) => ({
      providerId,
      projectIds: Array.from(projectIds).sort(),
      blastRadius: projectIds.size,
    }))
    .sort((a, b) => b.blastRadius - a.blastRadius || a.providerId.localeCompare(b.providerId));

  const integrationRisks = downstreamImpact
    .filter((item) => item.blastRadius > 1)
    .map((item) => `${item.providerId} is shared by ${item.blastRadius} projects`)
    .concat(
      Array.from(upstream.entries())
        .filter(([, dependencies]) => dependencies.length > 0)
        .map(([providerId, dependencies]) => `${providerId} depends on ${dependencies.join(", ")}`)
    );

  const mermaidLines = [
    "graph TD",
    ...orgProjects.map((project) => `  ${sanitizeNodeId(project.id)}[\"${project.name}\"]`),
    ...Array.from(sharedByProvider.keys()).map((providerId) => `  ${sanitizeNodeId(providerId)}((\"${providerId}\"))`),
    ...edges.map((edge) => `  ${sanitizeNodeId(edge.from)} --> ${sanitizeNodeId(edge.to)}`),
  ];

  const report: DependencyGraphReport = {
    nodes,
    edges,
    sharedCapabilities,
    upstreamDependencies: Array.from(upstream.entries()).map(([providerId, dependsOn]) => ({ providerId, dependsOn })),
    downstreamImpact,
    integrationRisks,
    mermaid: mermaidLines.join("\n"),
  };

  await recordOpsEvidence({
    operation: "dependencies.scan",
    actor,
    scope: "dependency",
    status: integrationRisks.length > 0 ? "warning" : "passed",
    inputs: { organizationId, projects: String(orgProjects.length) },
    outputs: { edges: String(edges.length), sharedProviders: String(sharedCapabilities.length) },
    verification: ["project-to-provider edges derived from plans", "provider-to-provider dependencies derived from step ordering"],
    runtimeProof: downstreamImpact.map((item) => `${item.providerId}:${item.blastRadius}`),
    residualRisk: integrationRisks,
  });

  return report;
}

function sanitizeNodeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, "_");
}

export async function analyzeEnvironmentSync(organizationId: string, actor = "ops-center"): Promise<EnvironmentSyncReport> {
  const references = listOrganizationReferences(organizationId);
  const environments: EnvironmentName[] = ["development", "staging", "production"];
  const envSummary: EnvironmentSyncReport["environments"] = {
    development: { referenceCount: 0, healthyReferences: 0 },
    staging: { referenceCount: 0, healthyReferences: 0 },
    production: { referenceCount: 0, healthyReferences: 0 },
  };
  for (const reference of references) {
    envSummary[reference.environment].referenceCount += 1;
    if (reference.status === "available" || reference.status === "rotation_due") {
      envSummary[reference.environment].healthyReferences += 1;
    }
  }

  const byProjectProvider = new Map<string, Map<EnvironmentName, string>>();
  for (const reference of references) {
    const key = `${reference.projectId}:${reference.providerId || "unassigned"}:${reference.displayName}`;
    const entry = byProjectProvider.get(key) ?? new Map<EnvironmentName, string>();
    entry.set(reference.environment, reference.status);
    byProjectProvider.set(key, entry);
  }

  const missingSecrets: string[] = [];
  const inconsistentConfiguration: string[] = [];
  const staleEnvironmentVariables: string[] = [];
  const invalidConfiguration: string[] = [];

  for (const [key, statusByEnv] of Array.from(byProjectProvider.entries())) {
    const [projectId, providerId, displayName] = key.split(":");
    for (const environment of environments) {
      if (!statusByEnv.has(environment)) {
        missingSecrets.push(`${projectId}/${providerId}/${displayName} missing in ${environment}`);
      }
    }
    const uniqueStatuses = new Set(Array.from(statusByEnv.values()));
    if (uniqueStatuses.size > 1) {
      inconsistentConfiguration.push(`${projectId}/${providerId}/${displayName} differs across environments`);
    }
  }

  for (const reference of references) {
    if (reference.lastRotatedAt && daysSince(reference.lastRotatedAt) >= STALE_ROTATION_DAYS) {
      staleEnvironmentVariables.push(`${reference.projectId}/${reference.displayName} not rotated in ${daysSince(reference.lastRotatedAt)} days`);
    }
    if (reference.status === "revoked" || reference.status === "unhealthy") {
      invalidConfiguration.push(`${reference.projectId}/${reference.displayName} is ${reference.status}`);
    }
  }

  const report: EnvironmentSyncReport = {
    missingSecrets,
    inconsistentConfiguration,
    staleEnvironmentVariables,
    invalidConfiguration,
    environments: envSummary,
  };

  await recordOpsEvidence({
    operation: "environment.sync.scan",
    actor,
    scope: "environment",
    status:
      missingSecrets.length > 0 || inconsistentConfiguration.length > 0 || staleEnvironmentVariables.length > 0 || invalidConfiguration.length > 0
        ? "warning"
        : "passed",
    inputs: { organizationId, references: String(references.length) },
    outputs: {
      missing: String(missingSecrets.length),
      inconsistent: String(inconsistentConfiguration.length),
      stale: String(staleEnvironmentVariables.length),
      invalid: String(invalidConfiguration.length),
    },
    verification: ["environment reference coverage compared across development/staging/production"],
    runtimeProof: environments.map((environment) => `${environment}:${envSummary[environment].referenceCount}`),
    residualRisk: [...missingSecrets, ...invalidConfiguration],
  });

  return report;
}

async function ensureOperationalIncident(
  snapshot: Awaited<ReturnType<typeof getStoreSnapshot>>,
  input: Omit<OperationalIncidentRecord, "id" | "createdAt" | "updatedAt" | "status"> & { status?: OperationalIncidentStatus }
): Promise<OperationalIncidentRecord> {
  const existing = snapshot.incidents.find(
    (incident) =>
      incident.status !== "resolved" &&
      incident.scope === input.scope &&
      incident.summary === input.summary &&
      incident.providerId === input.providerId &&
      incident.credentialReferenceId === input.credentialReferenceId
  );
  if (existing) return existing;

  const created = createOperationalIncidentRecord({
    ...input,
    status: input.status ?? "open",
  });
  await insertRecord("incidents", created);

  if (created.providerId) {
    const providerIncident = openIncident({
      providerId: created.providerId,
      severity: mapUniversalSeverity(created.severity),
      summary: created.summary,
    });
    await updateRecords("incidents", (incident) => incident.id === created.id, (incident) => ({
      ...incident,
      evidence: [...incident.evidence, { key: "providerIncidentId", value: providerIncident.id }],
      updatedAt: new Date().toISOString(),
    }));
    return {
      ...created,
      evidence: [...created.evidence, { key: "providerIncidentId", value: providerIncident.id }],
      updatedAt: new Date().toISOString(),
    };
  }

  return created;
}

function mapUniversalSeverity(severity: OperationalIncidentSeverity): "minor" | "major" | "critical" {
  if (severity === "critical") return "critical";
  if (severity === "high") return "major";
  return "minor";
}

export async function syncOperationalIncidents(
  organizationId: string,
  providerHealth: ProviderOperationsStatus[],
  credentials: CredentialLifecycleStatus[],
  environmentSync: EnvironmentSyncReport,
  actor = "ops-center"
): Promise<OperationalIncidentRecord[]> {
  const snapshot = await getStoreSnapshot();
  const projectIdByProvider = new Map<string, Set<string>>();
  providerProjects(snapshot, projectIdByProvider);

  const derivedCandidates: Array<Omit<OperationalIncidentRecord, "id" | "createdAt" | "updatedAt" | "status">> = [];
  for (const provider of providerHealth) {
    if (provider.availability === "unavailable") {
      derivedCandidates.push({
        scope: "provider",
        severity: provider.healthScore < 0.2 ? "critical" : "high",
        summary: `${provider.providerId} provider health is ${provider.availability}`,
        providerId: provider.providerId,
        projectIds: Array.from(projectIdByProvider.get(provider.providerId) ?? []),
        dependencies: [],
        impact: `${provider.providerId} cannot reliably serve dependent workloads`,
        recommendedActions: [
          `Fail over ${provider.providerId} traffic to an alternate provider when available`,
          `Validate credentials, quota state, and recent deployment outcomes for ${provider.providerId}`,
        ],
        rollbackPlan: [`Pause new operations using ${provider.providerId}`, "Use the most recent successful deployment baseline"],
        evidence: [
          { key: "healthScore", value: String(provider.healthScore) },
          { key: "detail", value: provider.detail },
        ],
        source: "derived",
      });
    }
  }
  for (const credential of credentials) {
    if (credential.rotationRequired || credential.verification === "failed") {
      derivedCandidates.push({
        scope: "credential",
        severity: credential.verification === "failed" ? "high" : "medium",
        summary: `${credential.providerId} credential lifecycle requires intervention`,
        providerId: credential.providerId,
        projectIds: credential.projectIds,
        dependencies: credential.dependencyProviders,
        impact: `${credential.providerId} execution may fail or drift`,
        recommendedActions: [
          `Rotate or re-verify the ${credential.providerId} credential`,
          "Validate downstream projects after replacement",
        ],
        rollbackPlan: ["Restore the previous verified secret version", "Re-run provider verification before enabling production traffic"],
        evidence: [
          { key: "status", value: credential.status },
          { key: "verification", value: credential.verification },
        ],
        source: "derived",
      });
    }
  }
  for (const issue of environmentSync.missingSecrets) {
    derivedCandidates.push({
      scope: "environment",
      severity: "medium",
      summary: `Environment sync gap: ${issue}`,
      projectIds: [],
      dependencies: [],
      impact: "Cross-environment promotion may fail or diverge",
      recommendedActions: ["Backfill the missing secret reference", "Verify environment parity before deployment"],
      rollbackPlan: ["Block the next promotion until parity is restored"],
      evidence: [{ key: "missing", value: issue }],
      source: "derived",
    });
  }

  const createdOrExisting: OperationalIncidentRecord[] = [];
  for (const candidate of derivedCandidates) {
    createdOrExisting.push(await ensureOperationalIncident(snapshot, candidate));
  }

  const incidents = (await getStoreSnapshot()).incidents
    .filter((incident) => {
      if (incident.projectIds.length === 0) return true;
      const orgProjectIds = new Set(
        snapshot.projects.filter((project) => project.orgId === organizationId).map((project) => project.id)
      );
      return incident.projectIds.some((projectId) => orgProjectIds.has(projectId));
    })
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.updatedAt.localeCompare(a.updatedAt));

  await recordOpsEvidence({
    operation: "incidents.sync",
    actor,
    scope: "incident",
    status: incidents.some((item) => item.status !== "resolved" && item.severity === "critical") ? "warning" : "passed",
    inputs: { organizationId, derivedCandidates: String(derivedCandidates.length) },
    outputs: { incidents: String(incidents.length) },
    verification: ["provider, credential, and environment incident derivation completed"],
    runtimeProof: incidents.slice(0, 10).map((item) => `${item.severity}:${item.summary}`),
    residualRisk: incidents.filter((item) => item.status !== "resolved").map((item) => item.summary),
  });

  return incidents;
}

export async function resolveOperationalIncidentRecord(incidentId: string, actor: string, resolutionEvidence: string) {
  const snapshot = await getStoreSnapshot();
  const incident = snapshot.incidents.find((item) => item.id === incidentId);
  if (!incident) throw new Error(`Operational incident ${incidentId} not found`);
  const providerIncidentId = incident.evidence.find((item) => item.key === "providerIncidentId")?.value;
  await updateRecords("incidents", (item) => item.id === incidentId, (item) => ({
    ...item,
    status: "resolved",
    resolvedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    evidence: [...item.evidence, { key: "resolutionEvidence", value: resolutionEvidence }],
  }));
  if (incident.providerId && providerIncidentId) {
    resolveIncident(incident.providerId, providerIncidentId, resolutionEvidence);
  }
  await recordOpsEvidence({
    operation: "incident.resolve",
    actor,
    scope: "incident",
    status: "passed",
    inputs: { incidentId },
    outputs: { resolution: resolutionEvidence },
    verification: ["incident marked resolved", "linked provider incident resolved when present"],
    runtimeProof: [incident.summary],
    residualRisk: [],
    relatedIncidentId: incidentId,
  });
}

export async function summarizeApprovals(organizationId: string, actor = "ops-center"): Promise<ApprovalReport> {
  const approvals = listApprovals({ organizationId });
  const report: ApprovalReport = {
    pending: approvals.filter((item) => item.status === "pending").length,
    approved: approvals.filter((item) => item.status === "approved").length,
    rejected: approvals.filter((item) => item.status === "rejected").length,
    requiredActions: approvals
      .filter((item) => item.status === "pending")
      .map((item) => ({
        action: item.request.intendedAction,
        providerId: item.request.providerId,
        environment: item.request.environment,
        risk: item.request.riskLevel,
      })),
  };
  await recordOpsEvidence({
    operation: "approvals.scan",
    actor,
    scope: "approval",
    status: report.pending > 0 ? "warning" : "passed",
    inputs: { organizationId },
    outputs: { pending: String(report.pending), approved: String(report.approved) },
    verification: ["manual approval queue enumerated"],
    runtimeProof: report.requiredActions.map((item) => `${item.providerId}:${item.action}:${item.risk}`),
    residualRisk: report.requiredActions.map((item) => `${item.providerId}.${item.action} awaiting approval`),
  });
  return report;
}

export async function summarizeRollbackReadiness(actor = "ops-center"): Promise<RollbackReport> {
  const snapshot = await getStoreSnapshot();
  const pendingVerification = snapshot.runs
    .filter((run) => run.rollbackStatus === "completed" && !snapshot.evidence.some((evidence) => evidence.runId === run.id && evidence.result === "passed"))
    .map((run) => run.id);
  const report: RollbackReport = {
    available: snapshot.runs.filter((run) => run.rollbackStatus === "available").length,
    completed: snapshot.runs.filter((run) => run.rollbackStatus === "completed").length,
    failed: snapshot.runs.filter((run) => run.rollbackStatus === "failed").length,
    pendingVerification,
  };
  await recordOpsEvidence({
    operation: "rollback.audit",
    actor,
    scope: "rollback",
    status: report.failed > 0 || report.pendingVerification.length > 0 ? "warning" : "passed",
    inputs: { runs: String(snapshot.runs.length) },
    outputs: {
      available: String(report.available),
      completed: String(report.completed),
      failed: String(report.failed),
    },
    verification: ["rollback status inventory generated", "post-rollback evidence checked"],
    runtimeProof: pendingVerification,
    residualRisk: pendingVerification.map((runId) => `${runId} rollback lacks passing evidence`),
  });
  return report;
}

export async function summarizeRuntimeHealth(providerHealth: ProviderOperationsStatus[], actor = "ops-center"): Promise<RuntimeHealthReport> {
  const snapshot = await getStoreSnapshot();
  const persistence = await persistenceHealth();
  const verificationPassed = snapshot.verifications.filter((item) => item.status === "passed").length;
  const verificationFailed = snapshot.verifications.filter((item) => item.status === "failed").length;
  const providerCounts = {
    healthy: providerHealth.filter((item) => item.availability === "available").length,
    degraded: providerHealth.filter((item) => item.availability === "degraded").length,
    unhealthy: providerHealth.filter((item) => item.availability === "unavailable").length,
  };
  const services = [
    {
      name: "persistence",
      healthy: persistence.reachable && persistence.productionSafe,
      detail: persistence.reachable ? `${persistence.mode} reachable` : persistence.probeError || "persistence unavailable",
    },
    {
      name: "execution-engine",
      healthy: snapshot.runs.filter((run) => run.status === "failed").length === 0,
      detail: `${snapshot.runs.filter((run) => run.status === "running").length} running, ${snapshot.runs.filter((run) => run.status === "failed").length} failed`,
    },
    {
      name: "provider-plane",
      healthy: providerCounts.unhealthy === 0,
      detail: `${providerCounts.healthy} healthy / ${providerHealth.length} total providers`,
    },
  ];

  const scoreBase =
    (services.filter((service) => service.healthy).length / services.length) * 0.4 +
    (providerHealth.length === 0 ? 1 : providerCounts.healthy / providerHealth.length) * 0.4 +
    (verificationPassed + verificationFailed === 0 ? 1 : verificationPassed / (verificationPassed + verificationFailed)) * 0.2;

  const report: RuntimeHealthReport = {
    score: Number(scoreBase.toFixed(4)),
    services,
    providers: providerCounts,
    runs: {
      queued: snapshot.runs.filter((run) => run.status === "queued").length,
      running: snapshot.runs.filter((run) => run.status === "running").length,
      failed: snapshot.runs.filter((run) => run.status === "failed").length,
      completed: snapshot.runs.filter((run) => run.status === "completed").length,
    },
    verifications: { passed: verificationPassed, failed: verificationFailed },
  };
  await recordOpsEvidence({
    operation: "runtime.health.scan",
    actor,
    scope: "runtime",
    status: report.score < 0.75 ? "warning" : "passed",
    inputs: { providers: String(providerHealth.length), runs: String(snapshot.runs.length) },
    outputs: { score: String(report.score) },
    verification: ["persistence probe evaluated", "run and verification inventories checked"],
    runtimeProof: services.map((service) => `${service.name}:${service.healthy}`),
    residualRisk: services.filter((service) => !service.healthy).map((service) => `${service.name} unhealthy`),
  });
  return report;
}

export async function getOperationsReport(organizationId: string, actor = "ops-center"): Promise<OperationsReport> {
  const providerHealth = await collectProviderHealth(actor);
  const credentials = await discoverCredentials(organizationId, actor);
  const environmentSync = await analyzeEnvironmentSync(organizationId, actor);
  const incidents = await syncOperationalIncidents(organizationId, providerHealth, credentials, environmentSync, actor);
  const dependencies = await discoverDependencies(organizationId, actor);
  const approvals = await summarizeApprovals(organizationId, actor);
  const rollback = await summarizeRollbackReadiness(actor);
  const runtimeHealth = await summarizeRuntimeHealth(providerHealth, actor);
  const snapshot = await getStoreSnapshot();
  const evidenceLedger = snapshot.operations.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return {
    generatedAt: new Date().toISOString(),
    organizationId,
    providerHealth,
    credentials,
    incidents,
    dependencies,
    environmentSync,
    approvals,
    runtimeHealth,
    rollback,
    evidenceLedger,
  };
}

export async function openManualOperationalIncident(input: {
  actor: string;
  scope: OperationalIncidentRecord["scope"];
  severity: OperationalIncidentSeverity;
  summary: string;
  providerId?: string;
  credentialReferenceId?: string;
  projectIds?: string[];
  dependencies?: string[];
  impact: string;
  recommendedActions: string[];
  rollbackPlan: string[];
  evidence?: Array<{ key: string; value: string }>;
}) {
  const snapshot = await getStoreSnapshot();
  const incident = await ensureOperationalIncident(snapshot, {
    scope: input.scope,
    severity: input.severity,
    summary: input.summary,
    providerId: input.providerId,
    credentialReferenceId: input.credentialReferenceId,
    projectIds: input.projectIds ?? [],
    dependencies: input.dependencies ?? [],
    impact: input.impact,
    recommendedActions: input.recommendedActions,
    rollbackPlan: input.rollbackPlan,
    evidence: input.evidence ?? [],
    source: "manual",
  });
  await recordOpsEvidence({
    operation: "incident.open",
    actor: input.actor,
    scope: "incident",
    status: "info",
    inputs: { summary: input.summary, severity: input.severity },
    outputs: { incidentId: incident.id },
    verification: ["incident stored in durable ledger"],
    runtimeProof: [incident.summary],
    residualRisk: [incident.impact],
    relatedIncidentId: incident.id,
  });
  return incident;
}
