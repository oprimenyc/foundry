import { listRunEvents } from "@/lib/foundry/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string; runId: string } }) {
  const encoder = new TextEncoder();
  let cursor = Number(req.headers.get("last-event-id") || "0");

  const stream = new ReadableStream({
    async start(controller) {
      const initial = await listRunEvents(params.runId, cursor);
      for (const event of initial) {
        cursor = event.sequence;
        controller.enqueue(encoder.encode(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`));
      }

      const interval = setInterval(async () => {
        const latest = await listRunEvents(params.runId, cursor);
        for (const event of latest) {
          cursor = event.sequence;
          controller.enqueue(encoder.encode(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`));
        }
        if (latest.some((event) => ["completed", "failed", "cancelled", "rolled_back"].includes(event.status))) {
          clearInterval(interval);
          controller.close();
        }
      }, 250);

      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        try {
          controller.close();
        } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
