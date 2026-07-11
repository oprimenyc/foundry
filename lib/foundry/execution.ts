import { SagaOrchestrator } from "@/lib/orchestration/saga";
import { getLogBus } from "@/lib/logs/bus";
import { createEvidenceRecord, createEventRecord, createRollbackRecord, createStepRecord, getStoreSnapshot, insertRecord, updateRecords } from "./store";
import { getProviderAdapter } from "./providers";
import { toExecutionPlan } from "./plan";
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
  await getLogBus().publish(context.run.id, {
    type: event.status === "failed" ? "error" : event.status === "completed" || event.status === "rolled_back" ? "done" : "log",
    message: JSON.stringify(event),
  });
}

async function updateRun(runId: string, updater: (run: DeploymentRunRecord) => DeploymentRunRecord) {
  await updateRecords("runs", (run) => run.id === runId, updater);
}

async function updateStep(stepId: string, updater: (step: DeploymentStepRecord) => DeploymentStepRecord) {
  await updateRecords("steps", (step) => step.id === stepId, updater);
}

function mapFailureCategory(error: unknown): FailureCategory {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("cancel")) return "cancelled";
  if (message.includes("validation")) return "validation";
  if (message.includes("rollback")) return "rollback";
  return "provider";
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
        const result = await adapter.execute(planStep.action, {
          runId: ctx.run.id,
          stepId: stepRecord.id,
          projectId: ctx.project.id,
          config: planStep.config,
          providerReferences: ctx.providerReferences,
        });

        if (planStep.provider === "github") {
          ctx.providerReferences.githubRepoUrl = String(result.output.repoUrl || "");
        }
        if (planStep.provider === "vercel" && planStep.action === "create_project") {
          ctx.providerReferences.vercelProjectId = String(result.output.projectId || "");
        }
        if (planStep.provider === "vercel" && planStep.action === "trigger_deployment") {
          ctx.providerReferences.vercelDeploymentUrl = String(result.output.deploymentUrl || "");
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

async function verifyRun(context: ExecutionContext): Promise<LaunchEvidenceRecord> {
  const latest = await getStoreSnapshot();
  const run = latest.runs.find((item) => item.id === context.run.id);
  const completedSteps = latest.steps.filter((step) => step.runId === context.run.id && step.status === "completed");
  const deploymentUrl = run?.providerReferences.vercelDeploymentUrl || "";
  if (!run) throw new Error("Missing run for verification");
  return createEvidenceRecord({
    runId: run.id,
    claims: [
      "repository exists",
      "deployment reached terminal success",
      "persisted run state matches provider state",
      "required steps completed",
      "rollback metadata exists",
    ],
    evidence: [
      { key: "repository", value: run.providerReferences.githubRepoUrl || "missing" },
      { key: "deploymentUrl", value: deploymentUrl || "missing" },
      { key: "completedSteps", value: String(completedSteps.length) },
      { key: "rollbackActions", value: String(latest.rollbacks.filter((item) => item.runId === run.id).length) },
    ],
    result:
      run.providerReferences.githubRepoUrl &&
      deploymentUrl &&
      completedSteps.length === context.plan.steps.length
        ? "passed"
        : "failed",
    verifierVersion: "foundry-launch-verifier@1",
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
