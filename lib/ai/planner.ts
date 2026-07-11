import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

// Deployment planner backed by the Claude API (the original scaffold used an
// OpenAI stub). Fails loudly without a key — it never returns a fake plan.

export const PlanSchema = z.object({
  config: z.object({
    name: z.string(),
    hosting: z.string().optional(),
    database: z.string().optional(),
  }),
  steps: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        category: z.string(),
      })
    )
    .min(1),
});

export type DeploymentPlan = z.infer<typeof PlanSchema>;

// The planner is provider-agnostic by design: it declares WHAT capability each
// step needs (a category), never WHICH vendor fulfills it. The Provider
// Selection Engine chooses the vendor from health, cost, availability, and
// tenant policy at validation time.
const SYSTEM_PROMPT = `You are a deployment architect. Given a one-sentence project description, produce a JSON deployment plan.
Respond with ONLY a JSON object (no markdown fences) matching:
{
  "config": { "name": string },
  "steps": [{ "id": string, "name": string, "category": string }]
}
Steps must be concrete provisioning/deployment actions in execution order.
Each step declares a capability category — one of: hosting, repository, dns, email, sms, voice, database, payments, identity, storage, analytics, monitoring, browser_automation, llm, search_console, business_listing, maps, calendar, crm, forms.
NEVER name a vendor or provider. The execution engine selects providers separately.`;

export async function generateDeploymentPlan(prompt: string): Promise<DeploymentPlan> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set — the planner cannot run without it.");
  }

  const anthropic = new Anthropic({ apiKey });
  const response = await anthropic.messages.create({
    model: process.env.FOUNDRY_PLANNER_MODEL || "claude-sonnet-5",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Planner returned non-JSON output: ${text.slice(0, 200)}`);
  }

  const result = PlanSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Planner output failed validation: ${result.error.message}`);
  }
  return result.data;
}
