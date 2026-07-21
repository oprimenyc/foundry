import type { EmailPayload } from "../types";

/** Outbound send result — never a claim of delivery, only of dispatch. */
export interface EmailQaSendResult {
  providerReference: string;
  /** True whenever no real network call to a paid provider was made. */
  simulated: boolean;
  sentAt: string;
}

/**
 * Provider-neutral outbound adapter boundary for the QA harness. Distinct
 * from lib/foundry/providers.ts's ResendEmailAdapter, which is Foundry's own
 * deployment-orchestration email step — this boundary exists only to dispatch
 * (or simulate dispatching) the email under test.
 */
export interface EmailQaOutboundAdapter {
  readonly id: string;
  readonly mode: "fixture" | "resend-test" | "resend-live";
  send(payload: EmailPayload): Promise<EmailQaSendResult>;
}
