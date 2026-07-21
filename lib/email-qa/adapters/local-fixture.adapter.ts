import { randomUUID } from "crypto";
import type { EmailPayload } from "../types";
import type { EmailQaOutboundAdapter, EmailQaSendResult } from "./types";

/**
 * Local/free outbound adapter. Never touches the network, never requires a
 * credential — the default adapter for the QA harness.
 */
export class LocalFixtureAdapter implements EmailQaOutboundAdapter {
  readonly id = "local-fixture";
  readonly mode = "fixture" as const;

  async send(_payload: EmailPayload): Promise<EmailQaSendResult> {
    return {
      providerReference: `fixture_${randomUUID()}`,
      simulated: true,
      sentAt: new Date().toISOString(),
    };
  }
}
