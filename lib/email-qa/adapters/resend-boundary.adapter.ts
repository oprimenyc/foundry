import { randomUUID } from "crypto";
import { ResendAdapter as ResendHttpClient } from "@/lib/providers/domains.adapter";
import type { EmailPayload } from "../types";
import type { EmailQaOutboundAdapter, EmailQaSendResult } from "./types";

/**
 * Resend adapter boundary for the QA harness. NOT the same class as
 * lib/foundry/providers.ts's ResendEmailAdapter (that one is Foundry's own
 * deployment-orchestration email step) — this one exists purely so the QA
 * harness can exercise "what would Resend receive" without ever requiring a
 * live send, and only performs one when BOTH gates below are true:
 *
 *  1. the caller explicitly passes `allowLiveSend: true` (a code-level opt-in
 *     at the call site — never implied by config or by credential presence
 *     alone), and
 *  2. the environment explicitly sets FOUNDRY_EMAIL_QA_ALLOW_LIVE_RESEND to
 *     the exact string "explicit-live-send" (this harness's own flag —
 *     deliberately distinct from Foundry's unrelated FOUNDRY_ALLOW_MOCKS so
 *     one can never satisfy the other).
 *
 * Default, with neither gate set, is "resend-test": deterministic, simulated,
 * zero network calls, zero cost — exactly what the mission requires.
 */
export interface ResendQaAdapterOptions {
  apiKey?: string;
  allowLiveSend?: boolean;
  client?: ResendHttpClient;
}

export function liveResendSendExplicitlyEnabled(): boolean {
  return process.env.FOUNDRY_EMAIL_QA_ALLOW_LIVE_RESEND === "explicit-live-send";
}

export class ResendQaAdapter implements EmailQaOutboundAdapter {
  readonly id = "resend";
  private readonly apiKey?: string;
  private readonly allowLiveSend: boolean;
  private readonly client?: ResendHttpClient;

  constructor(options: ResendQaAdapterOptions = {}) {
    this.apiKey = options.apiKey;
    this.allowLiveSend = options.allowLiveSend ?? false;
    this.client = options.client;
  }

  get mode(): "resend-test" | "resend-live" {
    return this.liveModeEnabled() ? "resend-live" : "resend-test";
  }

  private liveModeEnabled(): boolean {
    return Boolean(this.apiKey) && this.allowLiveSend && liveResendSendExplicitlyEnabled();
  }

  async send(payload: EmailPayload): Promise<EmailQaSendResult> {
    const sentAt = new Date().toISOString();

    if (!this.liveModeEnabled()) {
      return { providerReference: `resend_test_${randomUUID()}`, simulated: true, sentAt };
    }

    // Both gates verified by liveModeEnabled(); apiKey is guaranteed present here.
    const client = this.client ?? new ResendHttpClient(this.apiKey as string);
    const sent = await client.sendEmail({
      from: payload.fromName ? `${payload.fromName} <${payload.from}>` : payload.from,
      to: payload.recipient.address,
      subject: payload.subject,
      text: payload.renderedBody,
    });
    return { providerReference: `resend_live_${sent.id}`, simulated: false, sentAt };
  }
}
