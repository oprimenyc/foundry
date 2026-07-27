import { createHash, randomUUID } from "crypto";
import { existsSync } from "fs";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "child_process";
import { retainArtifact } from "@/lib/foundry/artifacts";
import {
  createMissionRunnerAdmissionRecord,
  createMissionRunnerEventRecord,
  createMissionRunnerIterationRecord,
  createMissionRunnerLockRecord,
  createMissionRunnerMissionRecord,
  createMissionRunnerProcessRecord,
  getStoreSnapshot,
  insertRecord,
  updateRecords,
} from "@/lib/foundry/store";
import type {
  MissionRunnerAdmissionRecord,
  MissionRunnerBudgetState,
  MissionRunnerEventRecord,
  MissionRunnerExecutionPolicy,
  MissionRunnerFailureReason,
  MissionRunnerIterationRecord,
  MissionRunnerIterationState,
  MissionRunnerLockRecord,
  MissionRunnerMissionRecord,
  MissionRunnerMissionState,
  MissionRunnerProcessRecord,
  MissionRunnerRepositoryBinding,
  MissionRunnerSliceClass,
  MissionRunnerTakeoverState,
} from "@/lib/foundry/types";

const TERMINAL_STATES = new Set<MissionRunnerMissionState>(["COMPLETED", "FAILED", "CANCELLED"]);
const VALID_MISSION_TRANSITIONS: Record<MissionRunnerMissionState, MissionRunnerMissionState[]> = {
  QUEUED: ["PREPARING", "CANCELLED"],
  PREPARING: ["RUNNING", "HUMAN_GATE", "FAILED", "CANCELLED"],
  RUNNING: ["VALIDATING", "WAITING_FOR_AGENT", "WAITING_FOR_EXTERNAL_SYSTEM", "RECOVERING", "HUMAN_GATE", "FAILED", "CANCELLED"],
  VALIDATING: ["RUNNING", "COMPLETED", "FAILED", "HUMAN_GATE"],
  RECOVERING: ["WAITING_FOR_AGENT", "RUNNING", "HUMAN_GATE", "FAILED", "CANCELLED"],
  WAITING_FOR_AGENT: ["RUNNING", "HUMAN_GATE", "FAILED", "CANCELLED"],
  WAITING_FOR_EXTERNAL_SYSTEM: ["RUNNING", "HUMAN_GATE", "FAILED", "CANCELLED"],
  HUMAN_GATE: ["RUNNING", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

const VALID_ITERATION_TRANSITIONS: Record<MissionRunnerIterationState, MissionRunnerIterationState[]> = {
  CREATED: ["PROMPTED", "SUPERSEDED"],
  PROMPTED: ["EXECUTING", "REJECTED", "SUPERSEDED"],
  EXECUTING: ["OUTPUT_DETECTED", "REPO_CHANGED", "CHECKS_RUNNING", "ACCEPTED", "REJECTED", "RETRYING", "SUPERSEDED"],
  OUTPUT_DETECTED: ["REPO_CHANGED", "CHECKS_RUNNING", "ACCEPTED", "REJECTED", "RETRYING"],
  REPO_CHANGED: ["CHECKS_RUNNING", "ACCEPTED", "REJECTED", "RETRYING"],
  CHECKS_RUNNING: ["ACCEPTED", "REJECTED", "RETRYING"],
  ACCEPTED: ["SUPERSEDED"],
  REJECTED: ["RETRYING", "SUPERSEDED"],
  RETRYING: ["PROMPTED", "EXECUTING", "SUPERSEDED"],
  SUPERSEDED: [],
};

const HUMAN_GATE_REASONS = new Set([
  "MFA",
  "CAPTCHA",
  "PAYMENT",
  "LEGAL_ACCEPTANCE",
  "UNAVAILABLE_CREDENTIAL",
  "OWNER_PROVIDER_DASHBOARD",
  "IRREVERSIBLE_PRODUCTION_ACTION",
  "MATERIAL_PRODUCT_DECISION",
]);

export interface CreateMissionInput {
  orgId: string;
  name: string;
  specification: string;
  repositoryPaths: string[];
  executionPolicy?: Partial<MissionRunnerExecutionPolicy>;
  budgetState?: MissionRunnerBudgetState;
  nextAction?: string;
}

export interface AgentSliceRequest {
  mission: MissionRunnerMissionRecord;
  iteration: MissionRunnerIterationRecord;
  prompt: string;
  repositoryPath: string;
  mode: "read_only" | "mutating";
  maxElapsedMs: number;
}

export interface AgentSliceResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  structuredEvents?: unknown[];
  completedRequirements: string[];
  remainingRequirements: string[];
  evidence: string[];
  telemetry?: MissionRunnerIterationRecord["telemetry"];
}

export interface AgentAdapter {
  provider: string;
  agent: string;
  defaultModel: string;
  buildCommand(config: { model?: string; effort?: string; sandbox?: string; approvalPolicy?: string; maxTurns?: number }): { command: string; args: string[] };
  validateConfig(config: Record<string, unknown>): { ok: boolean; errors: string[] };
  runSlice?(request: AgentSliceRequest): Promise<AgentSliceResult>;
}

export class CliAgentAdapter implements AgentAdapter {
  constructor(readonly provider: string, readonly agent: string, readonly executable: string, readonly defaultModel: string) {}

  buildCommand(config: { model?: string; effort?: string; sandbox?: string; approvalPolicy?: string; maxTurns?: number }) {
    const args: string[] = [];
    if (this.agent === "codex") {
      args.push("exec");
      if (config.model) args.push("--model", config.model);
      if (config.sandbox) args.push("--sandbox", config.sandbox);
      if (config.approvalPolicy) args.push("--approval-policy", config.approvalPolicy);
    } else if (this.agent === "claude") {
      args.push("-p", "--output-format", "stream-json");
      if (config.model) args.push("--model", config.model);
      if (config.effort) args.push("--effort", config.effort);
      if (config.maxTurns) args.push("--max-turns", String(config.maxTurns));
    }
    return { command: this.executable, args };
  }

  validateConfig(config: Record<string, unknown>) {
    const errors: string[] = [];
    if (typeof config.model !== "string" || !config.model.trim()) errors.push("model must be configured, not hardcoded");
    if (config.costBudgetUsd !== undefined && typeof config.costBudgetUsd !== "number") errors.push("costBudgetUsd must be numeric when provided");
    return { ok: errors.length === 0, errors };
  }
}

export class BoundaryAgentAdapter implements AgentAdapter {
  constructor(readonly provider: string, readonly agent: string, readonly defaultModel: string) {}

  buildCommand() {
    return { command: this.agent, args: [] };
  }

  validateConfig(config: Record<string, unknown>) {
    const errors: string[] = [];
    if (typeof config.endpoint !== "string" || !config.endpoint.trim()) errors.push(`${this.provider} endpoint is required`);
    if (typeof config.model !== "string" || !config.model.trim()) errors.push(`${this.provider} model is required`);
    if (config.productionAuthority === true) errors.push(`${this.provider} boundary is not admitted for production authority by default`);
    return { ok: errors.length === 0, errors };
  }
}

export class DeterministicFixtureAgentAdapter implements AgentAdapter {
  provider = "fixture";
  agent = "fixture-agent";
  defaultModel = "deterministic-fixture";

  buildCommand() {
    return { command: "fixture-agent", args: [] };
  }

  validateConfig() {
    return { ok: true, errors: [] };
  }

  async runSlice(request: AgentSliceRequest): Promise<AgentSliceResult> {
    const marker = path.join(request.repositoryPath, "FRUN_FIXTURE.txt");
    const current = existsSync(marker) ? await readFile(marker, "utf8") : "";
    const lines = current.split(/\r?\n/).filter(Boolean);
    const newlyCompleted: string[] = [];
    if (!lines.includes("criterion-a:complete")) {
      lines.push("criterion-a:complete");
      newlyCompleted.push("criterion-a");
    } else if (!lines.includes("criterion-b:complete")) {
      lines.push("criterion-b:complete");
      newlyCompleted.push("criterion-b");
    }
    await writeFile(marker, `${lines.join("\n")}\n`, "utf8");
    return {
      exitCode: 0,
      stdout: `updated ${path.basename(marker)}`,
      stderr: "",
      completedRequirements: newlyCompleted,
      remainingRequirements: lines.includes("criterion-b:complete") ? [] : ["criterion-b"],
      evidence: [marker],
      telemetry: { inputTokens: "UNKNOWN", outputTokens: "UNKNOWN", costUsd: "UNKNOWN" },
    };
  }
}

export const codexCliAdapter = new CliAgentAdapter("openai", "codex", "codex", "configured-by-policy");
export const claudeCodeAdapter = new CliAgentAdapter("anthropic", "claude", "claude", "configured-by-policy");
export const openRouterBoundaryAdapter = new BoundaryAgentAdapter("openrouter", "openrouter-boundary", "configured-by-policy");
export const ollamaBoundaryAdapter = new BoundaryAgentAdapter("ollama", "ollama-boundary", "configured-by-policy");

export async function createMission(input: CreateMissionInput): Promise<MissionRunnerMissionRecord> {
  const bindings = input.repositoryPaths.map((repoPath) => bindRepository(repoPath, true));
  const now = new Date().toISOString();
  const mission = createMissionRunnerMissionRecord({
    capabilityId: "FRUN-001",
    orgId: input.orgId,
    name: input.name,
    missionSpecDigest: sha256(input.specification),
    status: "QUEUED",
    repositoryBindings: bindings,
    executionPolicy: {
      maxTurns: 90,
      maxElapsedMs: 30 * 60_000,
      maxChangedFiles: 20,
      maxRepeatedFailureSignatures: 1,
      targetedTestsPreferred: true,
      checkpointAfterAcceptedSlice: true,
      defaultEffort: "medium",
      ...input.executionPolicy,
    },
    currentCheckpoint: "CREATED",
    completedCriteria: [],
    unresolvedCriteria: [],
    humanGates: [],
    evidenceManifest: [],
    budgetState: {
      tokenBudget: "UNKNOWN",
      costBudgetUsd: "UNKNOWN",
      consumedTokens: "UNKNOWN",
      consumedCostUsd: "UNKNOWN",
      ...input.budgetState,
    },
    nextAction: input.nextAction ?? "prepare repository and acquire lock",
    eveVerdict: "PENDING",
    createdAt: now,
    updatedAt: now,
  });
  await insertRecord("missionRunnerMissions", mission);
  await appendMissionEvent(mission.id, "mission.created", `Mission ${mission.name} created`, { capabilityId: "FRUN-001" });
  return mission;
}

export async function transitionMission(missionId: string, next: MissionRunnerMissionState, message = `mission -> ${next}`) {
  const snapshot = await getStoreSnapshot();
  const mission = snapshot.missionRunnerMissions.find((item) => item.id === missionId);
  if (!mission) throw new Error(`Mission ${missionId} not found`);
  if (!VALID_MISSION_TRANSITIONS[mission.status].includes(next)) {
    throw new Error(`Invalid mission transition ${mission.status} -> ${next}`);
  }
  await updateRecords("missionRunnerMissions", (item) => item.id === missionId, (item) => ({
    ...item,
    status: next,
    updatedAt: new Date().toISOString(),
  }));
  await appendMissionEvent(missionId, "mission.transition", message, { from: mission.status, to: next });
}

export async function createIteration(input: {
  missionId: string;
  sliceClass: MissionRunnerSliceClass;
  agent: string;
  provider: string;
  model: string;
  effort?: string;
}): Promise<MissionRunnerIterationRecord> {
  const snapshot = await getStoreSnapshot();
  const mission = snapshot.missionRunnerMissions.find((item) => item.id === input.missionId);
  if (!mission) throw new Error(`Mission ${input.missionId} not found`);
  const sequence = snapshot.missionRunnerIterations.filter((item) => item.missionId === input.missionId).length + 1;
  const binding = mission.repositoryBindings[0];
  const iteration = createMissionRunnerIterationRecord({
    missionId: input.missionId,
    sequence,
    state: "CREATED",
    sliceClass: input.sliceClass,
    agent: input.agent,
    provider: input.provider,
    model: input.model,
    effort: input.effort,
    startedAt: new Date().toISOString(),
    startCommit: binding?.currentCommit ?? "UNKNOWN",
    repositoryStatusDigest: binding?.dirtyStateDigest ?? "UNKNOWN",
    completedRequirements: [],
    remainingRequirements: [...mission.unresolvedCriteria],
    checks: [],
    evidenceManifest: [],
    telemetry: { inputTokens: "UNKNOWN", outputTokens: "UNKNOWN", costUsd: "UNKNOWN" },
  });
  await insertRecord("missionRunnerIterations", iteration);
  await appendMissionEvent(input.missionId, "iteration.created", `Iteration ${sequence} created`, { iterationId: iteration.id });
  return iteration;
}

export async function transitionIteration(iterationId: string, next: MissionRunnerIterationState) {
  const snapshot = await getStoreSnapshot();
  const iteration = snapshot.missionRunnerIterations.find((item) => item.id === iterationId);
  if (!iteration) throw new Error(`Iteration ${iterationId} not found`);
  if (!VALID_ITERATION_TRANSITIONS[iteration.state].includes(next)) {
    throw new Error(`Invalid iteration transition ${iteration.state} -> ${next}`);
  }
  await updateRecords("missionRunnerIterations", (item) => item.id === iterationId, (item) => ({
    ...item,
    state: next,
    endedAt: next === "ACCEPTED" || next === "REJECTED" || next === "SUPERSEDED" ? new Date().toISOString() : item.endedAt,
  }));
  await appendMissionEvent(iteration.missionId, "iteration.transition", `Iteration ${iteration.sequence} -> ${next}`, { iterationId, to: next });
}

export function bindRepository(repositoryPath: string, mutating: boolean): MissionRunnerRepositoryBinding {
  const resolved = path.resolve(repositoryPath);
  const root = git(resolved, ["rev-parse", "--show-toplevel"]);
  if (!root.ok) throw new Error(`Repository binding failed for ${resolved}: ${root.stderr || root.stdout}`);
  const repositoryRoot = path.resolve(root.stdout.trim());
  if (repositoryRoot !== resolved && !resolved.startsWith(repositoryRoot + path.sep)) {
    throw new Error(`Repository path escaped root: ${resolved}`);
  }
  const branch = git(repositoryRoot, ["branch", "--show-current"]).stdout.trim() || "DETACHED";
  const head = git(repositoryRoot, ["rev-parse", "HEAD"]).stdout.trim();
  const origin = git(repositoryRoot, ["config", "--get", "remote.origin.url"]).stdout.trim();
  const identity = sha256(`${repositoryRoot}|${origin}|${branch}`);
  return {
    repositoryPath: repositoryRoot,
    repositoryIdentity: identity,
    branch,
    startCommit: head,
    currentCommit: head,
    dirtyStateDigest: repoStatusDigest(repositoryRoot),
    mutating,
  };
}

export async function acquireRepositoryLock(input: {
  missionId: string;
  repositoryPath: string;
  branch: string;
  staleAfterMs?: number;
  readOnly?: boolean;
}): Promise<MissionRunnerLockRecord> {
  const binding = bindRepository(input.repositoryPath, !input.readOnly);
  if (binding.branch !== input.branch) throw new Error(`Branch binding mismatch: expected ${input.branch}, got ${binding.branch}`);
  const lockRoot = path.join(process.env.FOUNDRY_MISSION_LOCK_DIR || path.join(process.cwd(), ".foundry-data", "mission-locks"));
  const lockPath = path.join(lockRoot, sanitizeFileName(`${binding.repositoryIdentity}-${binding.branch}.lock`));
  await mkdir(lockRoot, { recursive: true });
  const snapshot = await getStoreSnapshot();
  const active = snapshot.missionRunnerLocks.find(
    (lock) => lock.repositoryIdentity === binding.repositoryIdentity && lock.branch === binding.branch && lock.status === "active"
  );
  if (active && !input.readOnly) {
    const staleMs = Date.now() - new Date(active.heartbeatAt).getTime();
    if (staleMs < (input.staleAfterMs ?? 10 * 60_000) && processIsAlive(active.processId)) {
      throw new Error(`Mutating mission lock already active for ${binding.repositoryPath} ${binding.branch}`);
    }
    await updateRecords("missionRunnerLocks", (lock) => lock.id === active.id, (lock) => ({ ...lock, status: "stale" }));
  }
  if (!input.readOnly) {
    try {
      await mkdir(lockPath);
    } catch {
      if (!active) throw new Error(`Lock path already exists and has no matching durable record: ${lockPath}`);
    }
  }
  const lock = createMissionRunnerLockRecord({
    repositoryIdentity: binding.repositoryIdentity,
    repositoryPath: binding.repositoryPath,
    branch: binding.branch,
    missionId: input.missionId,
    ownerId: randomUUID(),
    processId: process.pid,
    lockPath,
    heartbeatAt: new Date().toISOString(),
    acquiredAt: new Date().toISOString(),
    status: input.readOnly ? "recovered" : "active",
  });
  await insertRecord("missionRunnerLocks", lock);
  await appendMissionEvent(input.missionId, input.readOnly ? "lock.read_only_takeover" : "lock.acquired", `Repository lock recorded for ${binding.branch}`, {
    repositoryIdentity: binding.repositoryIdentity,
  });
  return lock;
}

export async function heartbeatLock(lockId: string) {
  await updateRecords("missionRunnerLocks", (lock) => lock.id === lockId, (lock) => ({ ...lock, heartbeatAt: new Date().toISOString() }));
}

export async function releaseRepositoryLock(lockId: string) {
  const snapshot = await getStoreSnapshot();
  const lock = snapshot.missionRunnerLocks.find((item) => item.id === lockId);
  if (!lock) return;
  if (lock.status === "active") await rm(lock.lockPath, { recursive: true, force: true });
  await updateRecords("missionRunnerLocks", (item) => item.id === lockId, (item) => ({
    ...item,
    status: "released",
    releasedAt: new Date().toISOString(),
  }));
}

export async function appendMissionEvent(
  missionId: string,
  type: string,
  message: string,
  data: MissionRunnerEventRecord["data"] = {}
): Promise<MissionRunnerEventRecord> {
  const snapshot = await getStoreSnapshot();
  const sequence = snapshot.missionRunnerEvents.filter((event) => event.missionId === missionId).length + 1;
  const event = createMissionRunnerEventRecord({ missionId, sequence, type, message, data });
  await insertRecord("missionRunnerEvents", event);
  return event;
}

export async function recordAdmission(input: Omit<MissionRunnerAdmissionRecord, "id" | "createdAt">) {
  const admission = createMissionRunnerAdmissionRecord(input);
  await insertRecord("missionRunnerAdmissions", admission);
  return admission;
}

export function assertProviderRouteAdmitted(admissions: MissionRunnerAdmissionRecord[], route: { orgId: string; provider: string; agent: string; model: string; action: string; production?: boolean }) {
  const admission = admissions.find(
    (item) => item.orgId === route.orgId && item.provider === route.provider && item.agent === route.agent && item.model === route.model
  );
  if (!admission) throw new Error(`No admission for ${route.provider}/${route.agent}/${route.model}`);
  if (admission.deniedActions.includes(route.action) || !admission.allowedActions.includes(route.action)) {
    throw new Error(`Action ${route.action} is not admitted for ${route.provider}/${route.model}`);
  }
  if (route.production && !admission.productionAuthority) throw new Error("Provider route cannot silently gain production authority");
  return admission;
}

export function classifyFailure(input: {
  exitCode?: number | null;
  signal?: string | null;
  stdout?: string;
  stderr?: string;
  structuredEvents?: Array<Record<string, unknown>>;
  noOutputMs?: number;
  timeoutMs?: number;
}): { reason: MissionRunnerFailureReason; retryAfterMs?: number; signature: string } {
  const text = `${input.stdout ?? ""}\n${input.stderr ?? ""}\n${JSON.stringify(input.structuredEvents ?? [])}`.toLowerCase();
  let reason: MissionRunnerFailureReason = "UNKNOWN_FAILURE";
  if (input.exitCode === 0 && !input.signal) reason = "SUCCESS";
  if (/session limit|usage limit|resets .*america/.test(text)) reason = "SESSION_LIMIT";
  else if (/context window|context limit|conversation is too long|prompt is too long|maximum context/.test(text)) reason = "CONTEXT_LIMIT";
  else if (/rate.?limit|429|retry-after/.test(text)) reason = "RATE_LIMIT";
  else if (/credit limit|insufficient credits|quota exceeded|billing quota/.test(text)) reason = "CREDIT_LIMIT";
  else if (/provider outage|temporarily unavailable|service unavailable|overloaded|capacity/.test(text)) reason = "PROVIDER_OUTAGE";
  else if (/auth failure|authentication failed|not authenticated|unauthorized|invalid api key|login required/.test(text)) reason = "AUTH_FAILURE";
  else if (/model unavailable|model not found|unsupported model/.test(text)) reason = "MODEL_UNAVAILABLE";
  else if (/tool failed|tool_error|tool failure/.test(text)) reason = "TOOL_FAILURE";
  else if ((input.noOutputMs ?? 0) >= (input.timeoutMs ?? Number.MAX_SAFE_INTEGER)) reason = "AGENT_STALL";
  else if (input.signal || (input.exitCode !== undefined && input.exitCode !== null && input.exitCode !== 0)) reason = "PROCESS_CRASH";
  if (/cancelled|canceled|user abort/.test(text)) reason = "USER_CANCELLED";
  const retryAfter = /retry-after[:= ]+(\d+)/.exec(text)?.[1];
  return {
    reason,
    retryAfterMs: retryAfter ? Number(retryAfter) * 1000 : undefined,
    signature: sha256(`${reason}|${normalizeFailureText(text)}`),
  };
}

export function routeAfterFailure(input: {
  reason: MissionRunnerFailureReason;
  retryAfterMs?: number;
  repeatedCount: number;
  exhaustedProviders: string[];
  eligibleRoutes: Array<{ provider: string; agent: string; model: string }>;
  currentProvider: string;
}): { missionState: MissionRunnerMissionState; action: string; nextRoute?: string; disableProvider?: string; humanGate?: string } {
  if (input.reason === "SUCCESS") return { missionState: "VALIDATING", action: "validate accepted slice" };
  if (input.repeatedCount > 0) {
    const next = input.eligibleRoutes.find((route) => route.provider !== input.currentProvider && !input.exhaustedProviders.includes(route.provider));
    return next
      ? { missionState: "RECOVERING", action: "switch provider after repeated failure signature", nextRoute: routeKey(next) }
      : { missionState: "FAILED", action: "stop repeated identical failure; no admitted alternate route" };
  }
  if (input.reason === "SESSION_LIMIT" || input.reason === "CONTEXT_LIMIT") {
    const next = input.eligibleRoutes.find((route) => route.provider !== input.currentProvider) ?? input.eligibleRoutes[0];
    return { missionState: "RECOVERING", action: "checkpoint, archive session, rotate worker", nextRoute: next ? routeKey(next) : undefined };
  }
  if (input.reason === "RATE_LIMIT") {
    if (input.retryAfterMs !== undefined && input.retryAfterMs <= 5 * 60_000) {
      return { missionState: "WAITING_FOR_EXTERNAL_SYSTEM", action: `wait ${input.retryAfterMs}ms then retry once` };
    }
    const next = input.eligibleRoutes.find((route) => route.provider !== input.currentProvider);
    return { missionState: "RECOVERING", action: "route around rate-limited provider", nextRoute: next ? routeKey(next) : undefined };
  }
  if (input.reason === "CREDIT_LIMIT") {
    const next = input.eligibleRoutes.find((route) => route.provider !== input.currentProvider);
    return { missionState: "RECOVERING", action: "disable exhausted provider and route", disableProvider: input.currentProvider, nextRoute: next ? routeKey(next) : undefined };
  }
  if (input.reason === "AUTH_FAILURE") {
    return { missionState: "HUMAN_GATE", action: "pause for credential/authentication recovery", humanGate: "UNAVAILABLE_CREDENTIAL" };
  }
  if (input.reason === "PROVIDER_OUTAGE" || input.reason === "MODEL_UNAVAILABLE") {
    const next = input.eligibleRoutes.find((route) => route.provider !== input.currentProvider);
    return { missionState: "RECOVERING", action: "bounded retry or admitted-provider fallback", nextRoute: next ? routeKey(next) : undefined };
  }
  return { missionState: "RECOVERING", action: "checkpoint and inspect failure before retry" };
}

export function classifyHumanGate(reason: string): boolean {
  return HUMAN_GATE_REASONS.has(reason);
}

export function selectChecks(input: { changedFiles: string[]; checkpointClosing: boolean; finalCertification: boolean; priorFullSuiteCommit?: string; currentCommit: string; riskRequiresFullSuite?: boolean }) {
  const docsOnly = input.changedFiles.length > 0 && input.changedFiles.every((file) => /\.(md|txt|json)$/.test(file));
  const staleFullSuite = input.priorFullSuiteCommit !== input.currentCommit;
  if (input.finalCertification || input.checkpointClosing || input.riskRequiresFullSuite || (!docsOnly && staleFullSuite)) {
    return { mode: "full_suite" as const, reason: "full suite required by closure, final certification, risk, or stale source evidence" };
  }
  return { mode: "targeted" as const, reason: docsOnly ? "documentation-only change" : "targeted tests preferred by policy" };
}

export async function generateContinuationPacket(missionId: string) {
  const snapshot = await getStoreSnapshot();
  const mission = snapshot.missionRunnerMissions.find((item) => item.id === missionId);
  if (!mission) throw new Error(`Mission ${missionId} not found`);
  const iterations = snapshot.missionRunnerIterations.filter((item) => item.missionId === missionId);
  const latest = iterations.at(-1);
  const packet = {
    missionId: mission.id,
    missionDigest: mission.missionSpecDigest,
    repositoryBindings: mission.repositoryBindings,
    dirtyStateSummary: mission.repositoryBindings.map((binding) => `${binding.repositoryPath}:${binding.dirtyStateDigest}`),
    branchAndHead: mission.repositoryBindings.map((binding) => `${binding.branch}@${binding.currentCommit}`),
    completedCriteria: mission.completedCriteria,
    remainingCriteria: mission.unresolvedCriteria,
    latestChecks: latest?.checks ?? [],
    failedChecks: latest?.checks.filter((check) => check.status === "failed") ?? [],
    openRisks: mission.currentBlocker ? [mission.currentBlocker] : [],
    decisionsAlreadyMade: ["FRUN-001 is native Foundry mission-continuity capability", "v4 bash runner retained only as emergency fallback"],
    prohibitedRepeatedWork: mission.completedCriteria,
    exactNextAction: mission.nextAction,
    evidenceReferences: mission.evidenceManifest,
    activeHumanGates: mission.humanGates,
    replacementAgentAuthority: "read-only until TAKEOVER reconciliation reaches AUTHORITY_GRANTED",
  };
  const artifact = await retainArtifact({
    kind: "mission_continuation_packet",
    content: packet,
    retentionClass: "AUDIT",
    producer: "foundry-mission-runner",
    source: `mission:${mission.id}`,
    projectId: mission.orgId,
  });
  await updateRecords("missionRunnerMissions", (item) => item.id === missionId, (item) => ({
    ...item,
    evidenceManifest: Array.from(new Set([...item.evidenceManifest, artifact.id])),
    updatedAt: new Date().toISOString(),
  }));
  return { packet, artifactId: artifact.id, markdown: continuationMarkdown(packet) };
}

export async function reconcileTakeover(input: {
  missionId: string;
  repositoryPath: string;
  expectedBranch: string;
  expectedHead: string;
  dirtyStateAllowed: boolean;
  currentTests: string[];
}): Promise<{ states: MissionRunnerTakeoverState[]; writeAuthority: boolean; reasons: string[] }> {
  const states: MissionRunnerTakeoverState[] = ["TAKEOVER_PENDING", "REPOSITORY_RECONCILIATION"];
  const binding = bindRepository(input.repositoryPath, false);
  const reasons: string[] = [];
  if (binding.branch !== input.expectedBranch) reasons.push(`branch mismatch ${binding.branch} != ${input.expectedBranch}`);
  if (binding.currentCommit !== input.expectedHead) reasons.push(`HEAD mismatch ${binding.currentCommit} != ${input.expectedHead}`);
  if (!input.dirtyStateAllowed && binding.dirtyStateDigest !== "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855") {
    reasons.push("unexplained dirty state blocks write authority");
  }
  const snapshot = await getStoreSnapshot();
  const mission = snapshot.missionRunnerMissions.find((item) => item.id === input.missionId);
  if (!mission) reasons.push("mission missing");
  if (input.currentTests.length === 0) reasons.push("current tests/failures not supplied");
  states.push("CHECKPOINT_CONFIRMED");
  const writeAuthority = reasons.length === 0;
  if (writeAuthority) states.push("AUTHORITY_GRANTED", "EXECUTION_RESUMED");
  await appendMissionEvent(input.missionId, "takeover.reconciliation", writeAuthority ? "Takeover authority granted" : "Takeover remains read-only", {
    writeAuthority,
  });
  return { states, writeAuthority, reasons };
}

export async function runProcess(input: {
  missionId: string;
  iterationId: string;
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
}): Promise<{ record: MissionRunnerProcessRecord; stdout: string; stderr: string }> {
  const startedAt = new Date().toISOString();
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    env: allowlistedEnv(input.env),
    windowsHide: true,
    shell: false,
  }) as ChildProcessWithoutNullStreams;
  let stdout = "";
  let stderr = "";
  let outputCursor = 0;
  let lastOutputAt = Date.now();
  child.stdout.on("data", (chunk: Buffer) => {
    const text = String(chunk);
    stdout += text;
    outputCursor += text.length;
    lastOutputAt = Date.now();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const text = String(chunk);
    stderr += text;
    outputCursor += text.length;
    lastOutputAt = Date.now();
  });
  const timer = setTimeout(() => child.kill("SIGTERM"), input.timeoutMs);
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  const stdoutArtifact = await retainArtifact({
    kind: "mission_process_stdout",
    content: truncate(stdout),
    retentionClass: "STANDARD",
    producer: "foundry-process-controller",
    source: `${input.command} ${input.args.join(" ")}`,
  });
  const stderrArtifact = await retainArtifact({
    kind: "mission_process_stderr",
    content: truncate(stderr),
    retentionClass: "STANDARD",
    producer: "foundry-process-controller",
    source: `${input.command} ${input.args.join(" ")}`,
  });
  const record = createMissionRunnerProcessRecord({
    missionId: input.missionId,
    iterationId: input.iterationId,
    command: input.command,
    args: input.args,
    cwd: path.resolve(input.cwd),
    startedAt,
    endedAt: new Date().toISOString(),
    exitCode: result.code,
    signal: result.signal,
    stdoutRef: stdoutArtifact.id,
    stderrRef: stderrArtifact.id,
    childProcessIds: child.pid ? [child.pid] : [],
    heartbeatAt: new Date().toISOString(),
    noOutputMs: Date.now() - lastOutputAt,
    outputCursor,
  });
  await insertRecord("missionRunnerProcesses", record);
  await appendMissionEvent(input.missionId, "process.completed", `${input.command} exited`, { exitCode: result.code ?? -1 });
  return { record, stdout, stderr };
}

export async function runDeterministicSlice(input: { missionId: string; adapter?: AgentAdapter; repositoryPath: string; prompt: string; sliceClass: MissionRunnerSliceClass }) {
  const adapter = input.adapter ?? new DeterministicFixtureAgentAdapter();
  const snapshot = await getStoreSnapshot();
  const mission = snapshot.missionRunnerMissions.find((item) => item.id === input.missionId);
  if (!mission) throw new Error(`Mission ${input.missionId} not found`);
  const iteration = await createIteration({
    missionId: input.missionId,
    sliceClass: input.sliceClass,
    agent: adapter.agent,
    provider: adapter.provider,
    model: adapter.defaultModel,
    effort: mission.executionPolicy.defaultEffort,
  });
  await transitionIteration(iteration.id, "PROMPTED");
  await transitionIteration(iteration.id, "EXECUTING");
  if (!adapter.runSlice) throw new Error(`${adapter.agent} does not provide direct runSlice`);
  const result = await adapter.runSlice({
    mission,
    iteration,
    prompt: input.prompt,
    repositoryPath: input.repositoryPath,
    mode: "mutating",
    maxElapsedMs: mission.executionPolicy.maxElapsedMs,
  });
  const binding = bindRepository(input.repositoryPath, true);
  const classification = classifyFailure({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr });
  await updateRecords("missionRunnerIterations", (item) => item.id === iteration.id, (item) => ({
    ...item,
    state: "ACCEPTED",
    endedAt: new Date().toISOString(),
    endCommit: binding.currentCommit,
    repositoryStatusDigest: binding.dirtyStateDigest,
    exitCode: result.exitCode,
    classifiedExitReason: classification.reason,
    completedRequirements: result.completedRequirements,
    remainingRequirements: result.remainingRequirements,
    evidenceManifest: result.evidence,
    retrySignature: classification.signature,
    telemetry: result.telemetry ?? item.telemetry,
  }));
  await updateRecords("missionRunnerMissions", (item) => item.id === input.missionId, (item) => ({
    ...item,
    status: result.remainingRequirements.length === 0 ? "VALIDATING" : "RUNNING",
    repositoryBindings: [binding],
    completedCriteria: Array.from(new Set([...item.completedCriteria, ...result.completedRequirements])),
    unresolvedCriteria: result.remainingRequirements,
    evidenceManifest: Array.from(new Set([...item.evidenceManifest, ...result.evidence])),
    activeProvider: adapter.provider,
    activeAgent: adapter.agent,
    activeModel: adapter.defaultModel,
    currentSlice: input.sliceClass,
    nextAction: result.remainingRequirements.length === 0 ? "run E.V.E. continuity verification" : `continue ${result.remainingRequirements[0]}`,
    updatedAt: new Date().toISOString(),
  }));
  return { iterationId: iteration.id, classification };
}

export async function missionControlReport(orgId: string) {
  const snapshot = await getStoreSnapshot();
  return snapshot.missionRunnerMissions
    .filter((mission) => mission.orgId === orgId)
    .map((mission) => {
      const latestIteration = snapshot.missionRunnerIterations.filter((item) => item.missionId === mission.id).at(-1);
      return {
        missionId: mission.id,
        missionName: mission.name,
        repository: mission.repositoryBindings[0]?.repositoryPath ?? "",
        branch: mission.repositoryBindings[0]?.branch ?? "",
        currentCommit: mission.repositoryBindings[0]?.currentCommit ?? "",
        activeAgent: mission.activeAgent,
        activeProvider: mission.activeProvider,
        activeModel: mission.activeModel,
        currentSlice: mission.currentSlice,
        missionState: mission.status,
        iterationState: latestIteration?.state,
        lastCompletedAction: snapshot.missionRunnerEvents.filter((event) => event.missionId === mission.id).at(-1)?.message ?? "",
        testsBuildStatus: latestIteration?.checks.at(-1)?.status ?? "skipped",
        currentBlocker: mission.currentBlocker,
        elapsedTimeMs: Date.now() - new Date(mission.createdAt).getTime(),
        budgetState: mission.budgetState,
        commits: mission.repositoryBindings.map((binding) => `${binding.branch}@${binding.currentCommit}`),
        evidenceStatus: mission.evidenceManifest.length > 0 ? "present" : "missing",
        eveVerdict: mission.eveVerdict ?? "PENDING",
        nextAutomaticAction: mission.nextAction,
      };
    });
}

export async function markEveVerified(missionId: string, evidenceRef: string) {
  await updateRecords("missionRunnerMissions", (item) => item.id === missionId, (item) => ({
    ...item,
    status: "COMPLETED",
    finalStatus: "PASS",
    eveVerdict: "VERIFIED",
    evidenceManifest: Array.from(new Set([...item.evidenceManifest, evidenceRef])),
    updatedAt: new Date().toISOString(),
  }));
  await appendMissionEvent(missionId, "eve.verified", "E.V.E. verified mission continuity evidence", { evidenceRef });
}

function git(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  return { ok: result.status === 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function repoStatusDigest(repositoryRoot: string) {
  const status = git(repositoryRoot, ["status", "--porcelain=v1"]);
  return sha256(status.stdout || "");
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function processIsAlive(pid: number) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function normalizeFailureText(text: string) {
  return text.replace(/[0-9a-f]{7,64}/g, "<hash>").replace(/\d+/g, "<n>").slice(0, 400);
}

function routeKey(route: { provider: string; agent: string; model: string }) {
  return `${route.provider}/${route.agent}/${route.model}`;
}

function allowlistedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const allowed = ["PATH", "SYSTEMROOT", "TEMP", "TMP", "COMSPEC", "NODE_ENV"];
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV || "test" };
  for (const key of allowed) {
    if (process.env[key]) env[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(extra)) {
    if (/^(FOUNDRY_|NODE_ENV$|CI$)/.test(key)) env[key] = value;
  }
  return env;
}

function truncate(text: string, limit = 40_000) {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n[truncated; full output exceeded ${limit} chars]`;
}

function continuationMarkdown(packet: Record<string, unknown>) {
  return [
    "# FRUN-001 Continuation Packet",
    "",
    `Mission: ${packet.missionId}`,
    `Digest: ${packet.missionDigest}`,
    `Next action: ${packet.exactNextAction}`,
    "",
    "## Completed Criteria",
    ...((packet.completedCriteria as string[]) ?? []).map((item) => `- ${item}`),
    "",
    "## Remaining Criteria",
    ...((packet.remainingCriteria as string[]) ?? []).map((item) => `- ${item}`),
    "",
    "## Replacement Authority",
    String(packet.replacementAgentAuthority),
  ].join("\n");
}
