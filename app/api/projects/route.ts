import { requireApiAuth } from "@/lib/foundry/auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createProject, seedMockCredentials } from "@/lib/foundry/service";

const BodySchema = z.object({
  name: z.string().min(2).max(120),
  prompt: z.string().min(10).max(2000),
});

export async function POST(req: NextRequest) {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid project payload" }, { status: 400 });
  }
  const project = await createProject(parsed.data);
  await seedMockCredentials(project.id);
  return NextResponse.json(project, { status: 201 });
}
