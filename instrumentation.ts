// Runs once per server boot (Next.js instrumentation hook).
// Recovery: any run left queued/running/rolling_back by a crashed or
// restarted process is resumed from its durable state.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { resumeIncompleteRuns } = await import("@/lib/foundry/execution");
    try {
      await resumeIncompleteRuns();
      console.log("[foundry] startup recovery: incomplete runs resumed");
    } catch (error) {
      // Surfaced loudly rather than swallowed; the server still boots so
      // operators can diagnose via /api/healthz and logs.
      console.error("[foundry] startup recovery failed:", error);
    }
  }
}
