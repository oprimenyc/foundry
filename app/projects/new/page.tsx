"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Sparkles } from "lucide-react";
import { MagneticButton } from "@/components/magicui/magnetic-button";
import { useDeploymentStream } from "@/components/deployment/use-deployment-stream";
import type { DeploymentPlanRecord, DeploymentRunRecord, ProjectRecord } from "@/lib/foundry/types";

type RunView = {
  run: DeploymentRunRecord;
  steps: Array<{ id: string; status: string; action: string; provider: string }>;
  evidence: Array<{ id: string; result: string }>;
};

export default function NewProjectPage() {
  const [prompt, setPrompt] = useState("Launch StaySafePets.com using Next.js, Supabase and Vercel.");
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [plan, setPlan] = useState<DeploymentPlanRecord | null>(null);
  const [run, setRun] = useState<DeploymentRunRecord | null>(null);
  const [runView, setRunView] = useState<RunView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const { logs } = useDeploymentStream(project?.id ?? null, run?.id ?? null);

  const handleGeneratePlan = async () => {
    setLoading(true);
    setError(null);
    setRun(null);
    setRunView(null);
    try {
      const projectRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: prompt.split(" ").slice(0, 4).join(" "), prompt }),
      });
      const projectBody = await projectRes.json();
      if (!projectRes.ok) {
        setError(projectBody.error ?? `Project creation failed (${projectRes.status})`);
        return;
      }
      setProject(projectBody);

      const res = await fetch(`/api/projects/${projectBody.id}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? body.plan?.validationErrors?.join(", ") ?? `Plan failed (${res.status})`);
        return;
      }
      setPlan(body.plan);
    } catch {
      setError("Could not reach the planner API.");
    } finally {
      setLoading(false);
    }
  };

  const handleStartRun = async () => {
    if (!project || !plan) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Run creation failed (${res.status})`);
        return;
      }
      setRun(body);
    } catch {
      setError("Could not start the deployment run.");
    } finally {
      setRunning(false);
    }
  };

  const handleRollback = async () => {
    if (!project || !run) return;
    await fetch(`/api/projects/${project.id}/runs/${run.id}/rollback`, { method: "POST" });
  };

  useEffect(() => {
    if (!project || !run) return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/projects/${project.id}/runs/${run.id}`);
      if (!res.ok) return;
      const body = (await res.json()) as RunView;
      setRunView(body);
    }, 500);
    return () => clearInterval(interval);
  }, [project, run]);

  return (
    <div className="relative z-10 flex min-h-screen flex-col items-center justify-center p-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-5xl">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">What are we building today?</h1>
          <p className="mt-4 text-lg text-neutral-400">
            Describe your project. Foundry will validate, persist, execute, and verify one launch path.
          </p>
        </div>

        <div className="glass glow-violet rounded-2xl p-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full resize-none bg-transparent p-4 text-lg text-neutral-100 placeholder-neutral-500 focus:outline-none"
            rows={3}
          />
        </div>

        <div className="mt-6 flex justify-center">
          <MagneticButton
            onClick={handleGeneratePlan}
            disabled={loading}
            className="bg-gradient-to-r from-cyan-500 to-violet-500 text-white"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Generating...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 inline h-4 w-4" /> Generate Plan
              </>
            )}
          </MagneticButton>
        </div>

        {error && (
          <p className="mt-6 text-center text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        <AnimatePresence mode="wait">
          {plan && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-12 overflow-hidden">
              <div className="glass rounded-2xl p-8">
                <h3 className="mb-6 text-xl font-semibold text-white">Execution Plan - {plan.config.name}</h3>
                <div className="space-y-4">
                  {plan.steps.map((step, index) => (
                    <motion.div
                      key={step.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className="flex items-center space-x-4"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5">
                        <span className="text-xs font-bold text-neutral-400">{index + 1}</span>
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-white">{step.name}</p>
                        <p className="text-xs uppercase text-neutral-500">
                          {step.provider} / {step.action}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </div>
                <div className="mt-6 flex gap-3">
                  <MagneticButton onClick={handleStartRun} disabled={running} className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white">
                    {running ? "Starting..." : "Start Deployment Run"}
                  </MagneticButton>
                  {run && (
                    <MagneticButton onClick={handleRollback} className="bg-neutral-800 text-white">
                      Rollback
                    </MagneticButton>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {runView && (
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <div className="glass rounded-2xl p-6 text-sm text-neutral-200">
              <h3 className="mb-4 text-lg font-semibold text-white">Run Status</h3>
              <p>Status: {runView.run.status}</p>
              <p>Progress: {runView.run.progress}%</p>
              <p>Current step: {runView.run.currentStep ?? "none"}</p>
              <p>Rollback: {runView.run.rollbackStatus}</p>
              <div className="mt-4 space-y-2">
                {runView.steps.map((step) => (
                  <div key={step.id} className="rounded-lg border border-white/10 p-3">
                    <p>
                      {step.provider}.{step.action}
                    </p>
                    <p className="text-xs uppercase text-neutral-500">{step.status}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="glass rounded-2xl p-6 text-sm text-neutral-200">
              <h3 className="mb-4 text-lg font-semibold text-white">Execution Events</h3>
              <div className="max-h-80 space-y-2 overflow-auto">
                {logs.map((event) => (
                  <div key={event.id} className="rounded-lg border border-white/10 p-3">
                    <p>{event.sanitizedMessage}</p>
                    <p className="text-xs uppercase text-neutral-500">
                      {event.stage} / {event.status}
                    </p>
                  </div>
                ))}
              </div>
              {runView.evidence.length > 0 && (
                <div className="mt-4">
                  <p className="font-medium text-white">Verification</p>
                  {runView.evidence.map((item) => (
                    <p key={item.id} className="text-xs uppercase text-neutral-500">
                      {item.result}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
