export interface SagaStep<TContext, TOutput> {
  name: string;
  execute: (context: TContext) => Promise<TOutput>;
  compensate?: (context: TContext, output: TOutput) => Promise<void>;
}

export interface SagaResult {
  ok: boolean;
  failedStep?: string;
  error?: string;
  /** True when a step signalled a governed pause (human gate) — NOT a failure, so no compensation runs. */
  paused?: boolean;
}

/**
 * Thrown by a step's execute() to halt the saga for a human gate. Unlike a
 * failure, a pause must NOT trigger compensation of completed steps — the run
 * will resume from the exact paused step once a human decides.
 */
export class SagaPauseSignal extends Error {
  readonly __sagaPause = true;
  constructor(message: string) {
    super(message);
    this.name = "SagaPauseSignal";
  }
}

function isPause(error: unknown): error is SagaPauseSignal {
  return !!error && typeof error === "object" && (error as { __sagaPause?: boolean }).__sagaPause === true;
}

export class SagaOrchestrator<TContext> {
  private steps: SagaStep<TContext, unknown>[] = [];

  constructor(private runId: string, private context: TContext) {}

  addStep<TOutput>(step: SagaStep<TContext, TOutput>) {
    this.steps.push(step as SagaStep<TContext, unknown>);
    return this;
  }

  // Durable execution events (recorded by the caller's step hooks) are the
  // source of truth; the saga only sequences execution and compensation.
  async execute(): Promise<SagaResult> {
    const completed: { step: SagaStep<TContext, unknown>; output: unknown }[] = [];

    for (const step of this.steps) {
      try {
        const output = await step.execute(this.context);
        completed.push({ step, output });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        // Governed pause: stop cleanly, preserve completed steps, do NOT compensate.
        if (isPause(error)) {
          return { ok: false, paused: true, failedStep: step.name, error: message };
        }

        for (let i = completed.length - 1; i >= 0; i--) {
          const { step: done, output } = completed[i];
          if (!done.compensate) continue;
          try {
            await done.compensate(this.context, output);
          } catch (compError) {
            const compMessage = compError instanceof Error ? compError.message : String(compError);
            console.error(`[foundry] CRITICAL: compensation failed for ${done.name} in run ${this.runId} — ${compMessage}. Manual cleanup required.`);
            return { ok: false, failedStep: step.name, error: `${message}; compensation also failed: ${compMessage}` };
          }
        }
        return { ok: false, failedStep: step.name, error: message };
      }
    }

    return { ok: true };
  }
}
