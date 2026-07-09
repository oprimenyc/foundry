import { getLogBus } from "@/lib/logs/bus";

export interface SagaStep<TContext, TOutput> {
  name: string;
  execute: (context: TContext) => Promise<TOutput>;
  compensate?: (context: TContext, output: TOutput) => Promise<void>;
}

export interface SagaResult {
  ok: boolean;
  failedStep?: string;
  error?: string;
}

export class SagaOrchestrator<TContext> {
  private steps: SagaStep<TContext, unknown>[] = [];

  constructor(private projectId: string, private context: TContext) {}

  addStep<TOutput>(step: SagaStep<TContext, TOutput>) {
    this.steps.push(step as SagaStep<TContext, unknown>);
    return this;
  }

  async execute(): Promise<SagaResult> {
    const bus = getLogBus();
    const completed: { step: SagaStep<TContext, unknown>; output: unknown }[] = [];

    for (const step of this.steps) {
      try {
        await bus.publish(this.projectId, { type: "log", message: `Executing: ${step.name}` });
        const output = await step.execute(this.context);
        completed.push({ step, output });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await bus.publish(this.projectId, {
          type: "error",
          message: `Failed: ${step.name} — ${message}. Rolling back ${completed.length} step(s)...`,
        });

        for (let i = completed.length - 1; i >= 0; i--) {
          const { step: done, output } = completed[i];
          if (!done.compensate) continue;
          try {
            await done.compensate(this.context, output);
            await bus.publish(this.projectId, { type: "log", message: `Rolled back: ${done.name}` });
          } catch (compError) {
            const compMessage = compError instanceof Error ? compError.message : String(compError);
            await bus.publish(this.projectId, {
              type: "error",
              message: `CRITICAL: compensation failed for ${done.name} — ${compMessage}. Manual cleanup required.`,
            });
            return { ok: false, failedStep: step.name, error: `${message}; compensation also failed: ${compMessage}` };
          }
        }
        return { ok: false, failedStep: step.name, error: message };
      }
    }

    await bus.publish(this.projectId, { type: "done", message: "All steps completed." });
    return { ok: true };
  }
}
