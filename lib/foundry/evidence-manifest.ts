import { createHash, createHmac } from "crypto";
import { createEvidenceManifestRecord } from "./store";
import type { DeploymentPlanRecord, DeploymentRunRecord, LaunchEvidenceRecord, SignedEvidenceManifestRecord } from "./types";

export type EvidenceSignerPayload = {
  manifestHash: string;
};

export interface EvidenceManifestSigner {
  keyId(): string;
  algorithm(): SignedEvidenceManifestRecord["signatureAlgorithm"];
  sign(payload: EvidenceSignerPayload): string;
}

export class HmacEvidenceManifestSigner implements EvidenceManifestSigner {
  constructor(private readonly key: string, private readonly id: string) {
    if (!key.trim()) throw new Error("Foundry evidence signer key is empty");
    if (!id.trim()) throw new Error("Foundry evidence signer key id is empty");
  }

  keyId() {
    return this.id;
  }

  algorithm() {
    return "HMAC-SHA256" as const;
  }

  sign(payload: EvidenceSignerPayload) {
    return `hmac-sha256:${createHmac("sha256", this.key).update(canonicalJson(payload), "utf8").digest("hex")}`;
  }
}

export function defaultEvidenceManifestSigner(): EvidenceManifestSigner {
  const configuredKey = process.env.FOUNDRY_EVIDENCE_SIGNING_KEY;
  const keyId = process.env.FOUNDRY_EVIDENCE_SIGNING_KEY_ID || "foundry-local-dev-key";
  if (configuredKey) return new HmacEvidenceManifestSigner(configuredKey, keyId);
  if (process.env.NODE_ENV === "production") {
    throw new Error("FOUNDRY_EVIDENCE_SIGNING_KEY is required in production");
  }
  return new HmacEvidenceManifestSigner("foundry-local-development-signing-key", keyId);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Canonical(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

export function issueSignedEvidenceManifest(input: {
  run: DeploymentRunRecord;
  plan: DeploymentPlanRecord;
  evidence: LaunchEvidenceRecord;
  tenantId: string;
  extraEvidenceReferences?: string[];
  producerIdentity?: string;
  signer?: EvidenceManifestSigner;
}): SignedEvidenceManifestRecord {
  const signer = input.signer || defaultEvidenceManifestSigner();
  const evidenceItems = [
    {
      evidenceId: input.evidence.id,
      reference: input.evidence.id,
      hash: sha256Canonical(input.evidence),
      type: "launch-evidence",
    },
    ...Array.from(new Set(input.extraEvidenceReferences || [])).map((reference, index) => ({
      evidenceId: `event-evidence-${index + 1}`,
      reference,
      hash: sha256Canonical({ reference }),
      type: "execution-event-evidence",
    })),
  ];
  const unsigned = {
    manifestVersion: "foundry-evidence-manifest@1" as const,
    executionId: input.run.idempotencyKey,
    tenantId: input.tenantId,
    capabilityId: input.plan.prompt,
    producerIdentity: input.producerIdentity || "foundry-runtime",
    executionTimestamp: input.run.completedAt || input.evidence.verifiedAt,
    evidenceItems,
    issuedAt: new Date().toISOString(),
  };
  const manifestHash = sha256Canonical(unsigned);
  const signature = signer.sign({ manifestHash });
  return createEvidenceManifestRecord({
    ...unsigned,
    manifestHash,
    signatureAlgorithm: signer.algorithm(),
    signerKeyId: signer.keyId(),
    signature,
  });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}
