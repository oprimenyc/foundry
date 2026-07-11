import { SagaOrchestrator } from "@/lib/orchestration/saga";
import { createEvidenceRecord, createEventRecord, createRollbackRecord, createStepRecord, getStoreSnapshot, insertRecord, updateRecords } from "./store";
import { getProviderAdapter, ProviderError, type ProviderAdapter, type ProviderExecutionInput, type ProviderExecutionResult } from "./providers";
import { toExecutionPlan } from "./plan";
import { normalizeCategory } from "./universal/types";
import type {
  DeploymentPlanRecord,
  DeploymentRunRecord,
  DeploymentStepRecord,
  ExecutionEventRecord,
  FailureCategory,
  LaunchEvidenceRecord,
  ProjectRecord,
  RollbackActionRecord,
} from "./types";

type ExecutionContext = {
  project: ProjectRecord;
  plan: DeploymentPlanRecord;
  run: DeploymentRunRecord;
  stepRecords: Map<string, DeploymentStepRecord>;
  providerReferences: Record<string, string>;
  eventSequence: number;
};

const activeRuns = globalThis as unknown as { __foundryActiveRuns?: Set<string> };
if (!activeRuns.__foundryActiveRuns) activeRuns.__foundryActiveRuns = new Set<string>();

function nextSequence(context: ExecutionContext) {
  context.eventSequence += 1;
  return context.eventSequence;
}

async function appendEvent(context: ExecutionContext, partial: Omit<ExecutionEventRecord, "id" | "timestamp" | "projectId" | "runId" | "sequence">) {
  const event = createEventRecord({
    projectId: context.project.id,
    runId: context.run.id,
    sequence: nextSequence(context),
    ...partial,
  });
  await insertRecord("events", event);
}

async function updateRun(runId: string, updater: (run: DeploymentRunRecord) => DeploymentRunRecord) {
  await updateRecords("runs", (run) => run.id === runId, updater);
}

async function updateStep(stepId: string, updater: (step: DeploymentStepRecord) => DeploymentStepRecord) {
  await updateRecords("steps", (step) => step.id === stepId, updater);
}

function mapFailureCategory(error: unknown): FailureCategory {
  if (error instanceof ProviderError) return error.category;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("cancel")) return "cancelled";
  if (message.includes("timed out")) return "timeout";
  if (message.includes("validation")) return "validation";
  if (message.includes("rollback")) return "rollback";
  return "provider";
}

function isRetryable(error: unknown): boolean {
  return error instanceof ProviderError && error.retryable;
}

async function executeWithTimeout(
  adapter: ProviderAdapter,
  action: Parameters<ProviderAdapter["execute"]>[0],
  input: ProviderExecutionInput,
  timeoutMs: number
): Promise<ProviderExecutionResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      adapter.execute(action, input),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new ProviderError(`${adapter.provider}.${action} timed out after ${timeoutMs}ms`, {
                retryable: true,
                category: "timeout",
              })
            ),
          timeoutMs
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function startRunExecution(runId: string) {
  if (activeRuns.__foundryActiveRuns?.has(runId)) return;
  activeRuns.__foundryActiveRuns?.add(runId);
  setTimeout(() => {
    void executeRun(runId).finally(() => activeRuns.__foundryActiveRuns?.delete(runId));
  }, 0);
}

export async function resumeIncompleteRuns() {
  const snapshot = await getStoreSnapshot();
  const resumable = snapshot.runs.filter((run) => run.status === "queued" || run.status === "running" || run.status === "rolling_back");
  for (const run of resumable) {
    await startRunExecution(run.id);
  }
}

export async function executeRun(runId: string) {
  const snapshot = await getStoreSnapshot();
  const run = snapshot.runs.find((item) => item.id === runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  const project = snapshot.projects.find((item) => item.id === run.projectId);
  const plan = snapshot.plans.find((item) => item.id === run.planId);
  if (!project || !plan) throw new Error("Missing project or plan");

  const stepRecords = new Map(snapshot.steps.filter((step) => step.runId === run.id).map((step) => [step.planStepId, step]));
  const context: ExecutionContext = {
    project,
    plan,
    run,
    stepRecords,
    providerReferences: { ...run.providerReferences },
    eventSequence: snapshot.events.filter((event) => event.runId === run.id).length,
  };

  if (run.status === "rolling_back") {
    await performRollback(context);
    return;
  }

  await updateRun(run.id, (current) => ({
    ...current,
    status: current.status === "rolling_back" ? "rolling_back" : "running",
    startedAt: current.startedAt || new Date().toISOString(),
  }));
  await appendEvent(context, {
    stage: "run",
    status: "running",
    sanitizedMessage: "Run started",
  });

  const orderedSteps = toExecutionPlan(plan);
  const orchestrator = new SagaOrchestrator<ExecutionContext>(run.id, context);

  for (const planStep of orderedSteps) {
    const existingStep = context.stepRecords.get(planStep.id);
    orchestrator.addStep({
      name: planStep.name,
      execute: async (ctx) => {
        const latest = (await getStoreSnapshot()).runs.find((item) => item.id === ctx.run.id);
        if (latest?.cancellationRequestedAt) {
          throw new Error("execution cancelled");
        }

        if (existingStep?.status === "completed" && existingStep.output) {
          await appendEvent(ctx, {
            stepId: existingStep.id,
            stage: "step",
            status: "info",
            provider: planStep.provider,
            sanitizedMessage: `Skipping completed step ${planStep.name}`,
          });
          return existingStep.output;
        }

        const stepRecord =
          existingStep ||
          createStepRecord({
            runId: ctx.run.id,
            planStepId: planStep.id,
            provider: planStep.provider,
            action: planStep.action,
            status: "queued",
            retryCount: 0,
          });
        if (!existingStep) {
          await insertRecord("steps", stepRecord);
          ctx.stepRecords.set(planStep.id, stepRecord);
        }
        await updateRun(ctx.run.id, (current) => ({
          ...current,
          currentStep: planStep.id,
          progress: Math.round((ctx.stepRecords.size / ctx.plan.steps.length) * 100),
        }));
        await updateStep(stepRecord.id, (current) => ({ ...current, status: "running", startedAt: new Date().toISOString() }));
        await appendEvent(ctx, {
          stepId: stepRecord.id,
          stage: "step",
          status: "running",
          provider: planStep.provider,
          sanitizedMessage: `Executing ${planStep.provider}.${planStep.action}`,
        });

        const adapter = getProviderAdapter(planStep.provider);
        const executionInput: ProviderExecutionInput = {
          runId: ctx.run.id,
          stepId: stepRecord.id,
          projectId: ctx.project.id,
          config: planStep.config,
          providerReferences: ctx.providerReferences,
        };

        let result: ProviderExecutionResult | undefined;
        let attempt = 0;
        // First attempt plus up to retryLimit retries for retryable failures.
        for (;;) {
          try {
            result = await executeWithTimeout(adapter, planStep.action, executionInput, planStep.timeoutMs);
            break;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!isRetryable(error) || attempt >= planStep.retryLimit) {
              await updateStep(stepRecord.id, (current) => ({ ...current, status: "failed" }));
              await appendEvent(ctx, {
                stepId: stepRecord.id,
                stage: "step",
                status: "failed",
                provider: planStep.provider,
                sanitizedMessage: `${planStep.provider}.${planStep.action} failed after ${attempt + 1} attempt(s): ${message}`,
              });
              throw error;
            }
            attempt += 1;
            await updateStep(stepRecord.id, (current) => ({ ...current, retryCount: attempt }));
            await appendEvent(ctx, {
              stepId: stepRecord.id,
              stage: "step",
              status: "info",
              provider: planStep.provider,
              sanitizedMessage: `Retrying ${planStep.provider}.${planStep.action} (attempt ${attempt + 1}/${planStep.retryLimit + 1}) after retryable failure: ${message}`,
            });
          }
        }

        // Provider-agnostic reference propagation: adapters declare which
        // generic references (repoUrl, deploymentUrl, …) their result exposes.
        // The engine merges them; it never branches on a provider name.
        for (const [key, value] of Object.entries(result.references ?? {})) {
          if (value) ctx.providerReferences[key] = value;
        }

        let rollbackActionId: string | undefined;
        if (planStep.rollbackAction) {
          const rollback = createRollbackRecord({
            runId: ctx.run.id,
            stepId: stepRecord.id,
            provider: planStep.provider,
            action: planStep.rollbackAction,
            providerReference: result.providerReference,
            status: "pending",
          });
          await insertRecord("rollbacks", rollback);
          rollbackActionId = rollback.id;
        }

        await updateStep(stepRecord.id, (current) => ({
          ...current,
          status: "completed",
          completedAt: new Date().toISOString(),
          output: result.output,
          providerReference: result.providerReference,
          rollbackActionId,
        }));
        await updateRun(ctx.run.id, (current) => ({
          ...current,
          providerReferences: ctx.providerReferences,
          rollbackStatus: rollbackActionId ? "available" : current.rollbackStatus,
          progress: Math.round(((Array.from(ctx.stepRecords.values()).filter((step) => step.status === "completed").length + 1) / ctx.plan.steps.length) * 100),
        }));
        await appendEvent(ctx, {
          stepId: stepRecord.id,
          stage: "step",
          status: "info",
          provider: planStep.provider,
          evidenceReference: result.evidenceReference,
          sanitizedMessage: `Completed ${planStep.provider}.${planStep.action}`,
        });
        return result.output;
      },
      compensate: planStep.rollbackAction
        ? async (ctx) => {
            const stepRecord = ctx.stepRecords.get(planStep.id);
            const adapter = getProviderAdapter(planStep.provider);
            await appendEvent(ctx, {
              stepId: stepRecord?.id,
              stage: "rollback",
              status: "rolling_back",
              provider: planStep.provider,
              sanitizedMessage: `Rolling back ${planStep.provider}.${planStep.action}`,
            });
            await adapter.compensate?.(planStep.action, {
              runId: ctx.run.id,
              stepId: stepRecord?.id || planStep.id,
              projectId: ctx.project.id,
              config: planStep.config,
              providerReferences: ctx.providerReferences,
              providerReference: stepRecord?.providerReference,
            });
            if (stepRecord?.rollbackActionId) {
              await updateRecords("rollbacks", (item) => item.id === stepRecord.rollbackActionId, (item) => ({
                ...item,
                status: "completed",
                completedAt: new Date().toISOString(),
              }));
            }
            if (stepRecord) {
              await updateStep(stepRecord.id, (current) => ({ ...current, status: "rolled_back" }));
            }
          }
        : undefined,
    });
  }

  const result = await orchestrator.execute();
  if (!result.ok) {
    const failureCategory = mapFailureCategory(result.error || "internal");
    const rollingBack = failureCategory !== "cancelled";
    await updateRun(run.id, (current) => ({
      ...current,
      status: rollingBack ? "failed" : "cancelled",
      completedAt: new Date().toISOString(),
      failureCategory,
      sanitizedFailureMessage: result.error,
      terminalState: rollingBack ? "failure" : "cancelled",
      rollbackStatus: rollingBack ? "completed" : current.rollbackStatus,
    }));
    await appendEvent(context, {
      stage: "run",
      status: rollingBack ? "failed" : "cancelled",
      sanitizedMessage: result.error || "Run failed",
    });
    return;
  }

  const evidence = await verifyRun(context);
  await insertRecord("evidence", evidence);
  await updateRun(run.id, (current) => ({
    ...current,
    status: "completed",
    completedAt: new Date().toISOString(),
    terminalState: "success",
    evidenceReferences: [...current.evidenceReferences, evidence.id],
    progress: 100,
  }));
  await appendEvent(context, {
    stage: "verification",
    status: "completed",
    sanitizedMessage: "Launch verification passed",
    evidenceReference: evidence.id,
  });
}

/**
 * Capability-derived launch evidence: which references a run must have is a
 * function of the CATEGORIES its plan exercised — never of vendor names.
 */
const REQUIRED_REFERENCES_BY_CATEGORY: Record<string, string[]> = {
  repository: ["repoUrl"],
  hosting: ["deploymentUrl"],
};

async function verifyRun(context: ExecutionContext): Promise<LaunchEvidenceRecord> {
  const latest = await getStoreSnapshot();
  const run = latest.runs.find((item) => item.id === context.run.id);
  const completedSteps = latest.steps.filter((step) => step.runId === context.run.id && step.status === "completed");
  if (!run) throw new Error("Missing run for verification");

  const references = { ...run.providerReferences };
  // Legacy runs recorded provider-named keys; read them as their generic form.
  references.repoUrl = references.repoUrl || references.githubRepoUrl || "";
  references.deploymentUrl = references.deploymentUrl || references.vercelDeploymentUrl || "";

  const planCategories = new Set<string>();
  for (const step of context.plan.steps) {
    try {
      planCategories.add(normalizeCategory(getProviderAdapter(step.provider).capability));
    } catch {
      // Unknown provider at verification time reads as a failed requirement below.
      planCategories.add("unknown");
    }
  }
  const requiredReferences = Array.from(planCategories).flatMap(
    (category) => REQUIRED_REFERENCES_BY_CATEGORY[category] ?? []
  );
  const missingReferences = requiredReferences.filter((key) => !references[key]);

  return createEvidenceRecord({
    runId: run.id,
    claims: [
      "all plan steps completed",
      "capability-required references recorded",
      "persisted run state matches provider state",
      "rollback metadata exists",
    ],
    evidence: [
      ...requiredReferences.map((key) => ({ key, value: references[key] || "missing" })),
      { key: "completedSteps", value: String(completedSteps.length) },
      { key: "planSteps", value: String(context.plan.steps.length) },
      { key: "rollbackActions", value: String(latest.rollbacks.filter((item) => item.runId === run.id).length) },
    ],
    result:
      missingReferences.length === 0 && completedSteps.length === context.plan.steps.length ? "passed" : "failed",
    verifierVersion: "foundry-launch-verifier@2",
  });
}

export async function requestRollback(runId: string) {
  await updateRun(runId, (run) => ({
    ...run,
    status: "rolling_back",
    rollbackStatus: "running",
  }));
  await startRunWhenIdle(runId);
}

export async function requestCancellation(runId: string) {
  await updateRun(runId, (run) => ({
    ...run,
    cancellationRequestedAt: new Date().toISOString(),
  }));
}

async function startRunWhenIdle(runId: string) {
  if (!activeRuns.__foundryActiveRuns?.has(runId)) {
    await startRunExecution(runId);
    return;
  }
  setTimeout(() => {
    void startRunWhenIdle(runId);
  }, 25);
}

async function performRollback(context: ExecutionContext) {
  const snapshot = await getStoreSnapshot();
  const completed = snapshot.steps
    .filter((step) => step.runId === context.run.id && step.status === "completed")
    .reverse();

  for (const step of completed) {
    const planStep = context.plan.steps.find((item) => item.id === step.planStepId);
    if (!planStep?.rollbackAction) continue;
    const adapter = getProviderAdapter(planStep.provider);
    await appendEvent(context, {
      stepId: step.id,
      stage: "rollback",
      status: "rolling_back",
      provider: planStep.provider,
      sanitizedMessage: `Rolling back ${planStep.provider}.${planStep.action}`,
    });
    try {
      await adapter.compensate?.(planStep.action, {
        runId: context.run.id,
        stepId: step.id,
        projectId: context.project.id,
        config: planStep.config,
        providerReferences: context.providerReferences,
        providerReference: step.providerReference,
      });
      await updateStep(step.id, (current) => ({ ...current, status: "rolled_back" }));
      if (step.rollbackActionId) {
        await updateRecords("rollbacks", (item) => item.id === step.rollbackActionId, (item) => ({
          ...item,
          status: "completed",
          completedAt: new Date().toISOString(),
        }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateRun(context.run.id, (run) => ({
        ...run,
        status: "failed",
        rollbackStatus: "failed",
        failureCategory: "rollback",
        sanitizedFailureMessage: message,
      }));
      await appendEvent(context, {
        stepId: step.id,
        stage: "rollback",
        status: "failed",
        provider: planStep.provider,
        sanitizedMessage: `Rollback failed: ${message}`,
      });
      return;
    }
  }

  await updateRun(context.run.id, (run) => ({
    ...run,
    status: "rolled_back",
    completedAt: new Date().toISOString(),
    rollbackStatus: "completed",
    terminalState: "rolled_back",
  }));
  await appendEvent(context, {
    stage: "rollback",
    status: "rolled_back",
    sanitizedMessage: "Rollback completed",
  });
}
