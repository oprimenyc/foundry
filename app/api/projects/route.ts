import { resolvePrincipal } from "@/lib/foundry/auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createProject, seedMockCredentials } from "@/lib/foundry/service";

const BodySchema = z.object({
  name: z.string().min(2).max(120),
  prompt: z.string().min(10).max(2000),
});

export async function POST(req: NextRequest) {
  const auth = resolvePrincipal(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid project payload" }, { status: 400 });
  }
  const project = await createProject({ ...parsed.data, orgId: auth.principal.orgId, requestedBy: auth.principal.id });
  await seedMockCredentials(project.id, auth.principal.orgId);
  return NextResponse.json(project, { status: 201 });
}
