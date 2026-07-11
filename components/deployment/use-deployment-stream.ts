"use client";
import { useEffect, useState } from "react";
import type { ExecutionEventRecord } from "@/lib/foundry/types";

export function useDeploymentStream(projectId: string | null, runId: string | null) {
  const [logs, setLogs] = useState<ExecutionEventRecord[]>([]);

  useEffect(() => {
    if (!projectId || !runId) return;
    setLogs([]);
    const eventSource = new EventSource(`/api/projects/${projectId}/runs/${runId}/logs`);

    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as ExecutionEventRecord;
        setLogs((prev) => [...prev, event]);
        if (["completed", "failed", "cancelled", "rolled_back"].includes(event.status)) {
          eventSource.close();
        }
      } catch {
        // ignore malformed stream messages
      }
    };

    return () => eventSource.close();
  }, [projectId, runId]);

  return { logs };
}
