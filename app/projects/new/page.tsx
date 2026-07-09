"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Sparkles } from "lucide-react";
import { MagneticButton } from "@/components/magicui/magnetic-button";
import type { DeploymentPlan } from "@/lib/ai/planner";

export default function NewProjectPage() {
  const [prompt, setPrompt] = useState("Launch StaySafePets.com using Next.js, Supabase and Vercel.");
  const [plan, setPlan] = useState<DeploymentPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleGeneratePlan = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Planner failed (${res.status})`);
        return;
      }
      setPlan(body);
    } catch {
      setError("Could not reach the planner API.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative z-10 flex min-h-screen flex-col items-center justify-center p-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-3xl">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">What are we building today?</h1>
          <p className="mt-4 text-lg text-neutral-400">
            Describe your project. Foundry will architect, provision, and deploy it.
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
                <h3 className="mb-6 text-xl font-semibold text-white">
                  Execution Plan — {plan.config.name}
                </h3>
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
                        <p className="text-xs uppercase text-neutral-500">{step.provider}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
