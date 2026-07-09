"use client";
import { useEffect, useState } from "react";
import type { LogEvent } from "@/lib/logs/bus";

export function useDeploymentStream(projectId: string | null) {
  const [logs, setLogs] = useState<LogEvent[]>([]);

  useEffect(() => {
    if (!projectId) return;
    const eventSource = new EventSource(`/api/projects/${projectId}/logs`);

    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as LogEvent;
        setLogs((prev) => [...prev, event]);
        if (event.type === "done") eventSource.close();
      } catch {
        setLogs((prev) => [...prev, { type: "log", message: e.data, at: new Date().toISOString() }]);
      }
    };

    return () => eventSource.close();
  }, [projectId]);

  return { logs };
}
