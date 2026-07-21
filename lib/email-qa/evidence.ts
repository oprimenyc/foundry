import { sha256Canonical } from "@/lib/foundry/evidence-manifest";
import { retainArtifact } from "@/lib/foundry/artifacts";
import type { RetentionClass } from "@/lib/foundry/types";
import { runEmailQaValidation } from "./validate";
import { storeInboxMessage } from "./inbox";
import { LocalFixtureAdapter } from "./adapters/local-fixture.adapter";
import type { EmailQaOutboundAdapter } from "./adapters/types";
import type { DeliveryCorrelation, EmailPayload, EmailQaEvidencePackage, ProductEmailConfig } from "./types";

/**
 * Ties validate.ts + inbox.ts (+ optionally an outbound adapter) into the
 * standardized evidence package every QA run must produce (mission Task 5).
 */
export interface RunEmailQaOptions {
  /** Outbound adapter to exercise. Defaults to the local fixture adapter — no network, no cost. */
  adapter?: EmailQaOutboundAdapter;
  /** When true, actually calls adapter.send(). Default false: validation + inbox storage only, no dispatch leg at all. */
  dispatch?: boolean;
}

const EVIDENCE_ARTIFACT_KIND = "email_qa_evidence_package";

export async function runEmailQaAndProduceEvidence(
  config: ProductEmailConfig,
  payload: EmailPayload,
  options: RunEmailQaOptions = {}
): Promise<EmailQaEvidencePackage> {
  const validation = runEmailQaValidation(config, payload);

  let deliveryCorrelation: DeliveryCorrelation | undefined;
  if (options.dispatch) {
    const adapter = options.adapter ?? new LocalFixtureAdapter();
    const sent = await adapter.send(payload);
    deliveryCorrelation = {
      adapterId: adapter.id,
      mode: adapter.mode,
      providerReference: sent.providerReference,
      simulated: sent.simulated,
      sentAt: sent.sentAt,
    };
  }

  const inboxMessage = await storeInboxMessage({ config, payload, deliveryCorrelation });

  const productConfigHash = sha256Canonical(config);
  const renderedPayloadHash = sha256Canonical({
    subject: payload.subject,
    renderedBody: payload.renderedBody,
    templateInputs: payload.templateInputs,
    requiredLinks: payload.requiredLinks,
    requiredAssets: payload.requiredAssets,
  });

  const evidence: Omit<EmailQaEvidencePackage, "evidenceId"> = {
    productId: config.productId,
    emailType: payload.emailType,
    productConfigHash,
    renderedPayloadHash,
    validation,
    senderValidation: validation.checks.sender,
    replyToValidation: validation.checks.replyTo,
    placeholderCheck: { ok: validation.checks.placeholders.ok, unresolved: validation.checks.placeholders.unresolved },
    linkCheck: { ok: validation.checks.links.ok, missing: validation.checks.links.missing },
    assetCheck: { ok: validation.checks.assets.ok, missing: validation.checks.assets.missing },
    inboxMessageId: inboxMessage.messageId,
    deliveryCorrelation,
    verdict: validation.verdict,
    generatedAt: new Date().toISOString(),
  };

  const emailType = config.emailTypes.find((t) => t.id === payload.emailType);
  const retentionClass: RetentionClass = emailType?.releaseBlocking ? "RELEASE" : "STANDARD";

  const artifact = await retainArtifact({
    kind: EVIDENCE_ARTIFACT_KIND,
    content: evidence,
    contentType: "application/json",
    retentionClass,
    producer: "email-qa-harness",
    source: deliveryCorrelation?.adapterId ?? "validation-only",
    projectId: config.productId,
  });

  return { ...evidence, evidenceId: artifact.id };
}
