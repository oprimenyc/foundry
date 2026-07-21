import { readFile } from "fs/promises";
import { retainArtifact, listArtifacts } from "@/lib/foundry/artifacts";
import { redactString } from "@/lib/vault/redaction";
import { sha256Canonical } from "@/lib/foundry/evidence-manifest";
import type { ArtifactRecord } from "@/lib/foundry/types";
import type { DeliveryCorrelation, EmailPayload, ProductEmailConfig, RecipientType } from "./types";

/**
 * Virtual QA inbox. Built on the existing Foundry artifact/evidence
 * conventions (content-addressed, redacted-before-hash, retention-classed —
 * see lib/foundry/artifacts.ts) instead of a new storage backend: every
 * stored message is a retained artifact of kind "email_qa_inbox_message".
 */
const INBOX_ARTIFACT_KIND = "email_qa_inbox_message";

export interface VirtualInboxMessage {
  messageId: string;
  productId: string;
  productName: string;
  emailType: string;
  recipient: { type: RecipientType; address: string };
  sender: { from: string; fromName?: string; replyTo?: string };
  subject: string;
  bodyHash: string;
  /** Redacted before storage — see lib/vault/redaction.ts. */
  body: string;
  headers: Record<string, string>;
  deliveryCorrelation?: DeliveryCorrelation;
  createdAt: string;
  evidenceRefs: string[];
}

export interface StoreInboxMessageInput {
  config: ProductEmailConfig;
  payload: EmailPayload;
  deliveryCorrelation?: DeliveryCorrelation;
  evidenceRefs?: string[];
}

type InboxMessageContent = Omit<VirtualInboxMessage, "messageId" | "createdAt">;

export async function storeInboxMessage(input: StoreInboxMessageInput): Promise<VirtualInboxMessage> {
  const { config, payload } = input;
  const body = redactString(payload.renderedBody);
  const bodyHash = sha256Canonical(body);

  const content: InboxMessageContent = {
    productId: config.productId,
    productName: config.productName,
    emailType: payload.emailType,
    recipient: payload.recipient,
    sender: { from: payload.from, fromName: payload.fromName, replyTo: payload.replyTo },
    subject: payload.subject,
    bodyHash,
    body,
    headers: payload.headers,
    deliveryCorrelation: input.deliveryCorrelation,
    evidenceRefs: input.evidenceRefs ?? [],
  };

  const artifact = await retainArtifact({
    kind: INBOX_ARTIFACT_KIND,
    content,
    contentType: "application/json",
    retentionClass: "STANDARD",
    producer: "email-qa-harness",
    source: input.deliveryCorrelation?.adapterId ?? "unsent",
    projectId: config.productId,
  });

  return { ...content, messageId: artifact.id, createdAt: artifact.createdAt };
}

async function readArtifactContent<T>(artifact: ArtifactRecord): Promise<T> {
  const filePath = artifact.storageUri.replace(/^file:\/\//, "");
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function listInboxMessages(filter: { productId?: string; emailType?: string } = {}): Promise<VirtualInboxMessage[]> {
  const artifacts = (await listArtifacts({ projectId: filter.productId })).filter((a) => a.kind === INBOX_ARTIFACT_KIND);
  const messages = await Promise.all(
    artifacts.map(async (artifact) => {
      const content = await readArtifactContent<InboxMessageContent>(artifact);
      return { ...content, messageId: artifact.id, createdAt: artifact.createdAt };
    })
  );
  return filter.emailType ? messages.filter((m) => m.emailType === filter.emailType) : messages;
}

export async function getInboxMessage(messageId: string): Promise<VirtualInboxMessage | undefined> {
  const artifact = (await listArtifacts({})).find((a) => a.kind === INBOX_ARTIFACT_KIND && a.id === messageId);
  if (!artifact) return undefined;
  const content = await readArtifactContent<InboxMessageContent>(artifact);
  return { ...content, messageId: artifact.id, createdAt: artifact.createdAt };
}
