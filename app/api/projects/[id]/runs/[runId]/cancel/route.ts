import { NextResponse } from "next/server";
import { requestCancellation } from "@/lib/foundry/execution";

export async function POST(_: Request, { params }: { params: { id: string; runId: string } }) {
  await requestCancellation(params.runId);
  return NextResponse.json({ ok: true }, { status: 202 });
}
