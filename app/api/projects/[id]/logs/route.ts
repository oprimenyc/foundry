import { NextRequest } from "next/server";
import { getLogBus } from "@/lib/logs/bus";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const bus = getLogBus();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Flush headers immediately so clients see the stream open.
      controller.enqueue(encoder.encode(": connected\n\n"));
      const unsubscribe = bus.subscribe(params.id, (event) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      });

      req.signal.addEventListener("abort", () => {
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
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
