import { randomUUID } from "crypto";
import { redactValue } from "./redaction";
import type { VaultAuditEvent } from "./types";

/**
 * Vault audit trail. Append-only in process memory (dev control plane);
 * production deployments point this at durable storage. Every event is
 * redacted at write time — reference IDs, never values.
 */
const globalAudit = globalThis as unknown as { __primeVaultAudit?: VaultAuditEvent[] };
if (!globalAudit.__primeVaultAudit) globalAudit.__primeVaultAudit = [];
const events = globalAudit.__primeVaultAudit;

export function recordAudit(input: Omit<VaultAuditEvent, "id" | "timestamp">): VaultAuditEvent {
  const event: VaultAuditEvent = redactValue({
    ...input,
    metadata: redactValue(input.metadata ?? {}),
    id: `audit_${randomUUID()}`,
    timestamp: new Date().toISOString(),
  });
  events.push(event);
  return event;
}

export function listAuditEvents(filter?: { correlationId?: string; actor?: string }): VaultAuditEvent[] {
  return events.filter(
    (event) =>
      (!filter?.correlationId || event.correlationId === filter.correlationId) &&
      (!filter?.actor || event.actor === filter.actor)
  );
}

export function resetAuditTrail(): void {
  events.length = 0;
}
