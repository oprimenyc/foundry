import { EventEmitter } from "events";

// Deployment log bus. Uses Redis pub/sub when REDIS_URL is set (required for
// multi-instance deployments); otherwise an in-process EventEmitter, which is
// fine for a single dev/standalone instance.

export interface LogEvent {
  type: "log" | "error" | "done";
  message: string;
  at: string;
}

type Listener = (event: LogEvent) => void;

interface LogBus {
  publish(projectId: string, event: Omit<LogEvent, "at">): Promise<void>;
  subscribe(projectId: string, listener: Listener): () => void;
}

class MemoryBus implements LogBus {
  private emitter = new EventEmitter();

  async publish(projectId: string, event: Omit<LogEvent, "at">) {
    this.emitter.emit(projectId, { ...event, at: new Date().toISOString() });
  }

  subscribe(projectId: string, listener: Listener) {
    this.emitter.on(projectId, listener);
    return () => this.emitter.off(projectId, listener);
  }
}

class RedisBus implements LogBus {
  private pub;
  private sub;

  constructor(url: string) {
    // Lazy require so the app runs without ioredis native deps when unused.
    const Redis = require("ioredis");
    this.pub = new Redis(url);
    this.sub = new Redis(url);
  }

  async publish(projectId: string, event: Omit<LogEvent, "at">) {
    await this.pub.publish(
      `logs:${projectId}`,
      JSON.stringify({ ...event, at: new Date().toISOString() })
    );
  }

  subscribe(projectId: string, listener: Listener) {
    const channel = `logs:${projectId}`;
    const handler = (chan: string, message: string) => {
      if (chan === channel) listener(JSON.parse(message));
    };
    this.sub.subscribe(channel);
    this.sub.on("message", handler);
    return () => {
      this.sub.off("message", handler);
      this.sub.unsubscribe(channel);
    };
  }
}

const globalForBus = globalThis as unknown as { __foundryLogBus?: LogBus };

export function getLogBus(): LogBus {
  if (!globalForBus.__foundryLogBus) {
    globalForBus.__foundryLogBus = process.env.REDIS_URL
      ? new RedisBus(process.env.REDIS_URL)
      : new MemoryBus();
  }
  return globalForBus.__foundryLogBus;
}
