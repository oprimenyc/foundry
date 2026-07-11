import { requireApiAuth } from "@/lib/foundry/auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateDeploymentPlan } from "@/lib/ai/planner";

export const dynamic = "force-dynamic";

const BodySchema = z.object({ prompt: z.string().min(10).max(2000) });

export async function POST(req: NextRequest) {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "prompt must be a string of 10–2000 chars" }, { status: 400 });
  }

  try {
    const plan = await generateDeploymentPlan(parsed.data.prompt);
    return NextResponse.json(plan);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Planner failed";
    const status = message.includes("ANTHROPIC_API_KEY") ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
