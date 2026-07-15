import { constants, createHash, createHmac, createSign } from "crypto";
import { spawnSync } from "child_process";
import { createEvidenceManifestRecord } from "./store";
import type { DeploymentPlanRecord, DeploymentRunRecord, LaunchEvidenceRecord, SignedEvidenceManifestRecord } from "./types";

export type EvidenceSignerPayload = {
  manifestHash: string;
};

export interface EvidenceManifestSigner {
  provider(): string;
  keyId(): string;
  keyVersion(): string;
  algorithm(): SignedEvidenceManifestRecord["signatureAlgorithm"];
  sign(payload: EvidenceSignerPayload): string;
}

export class HmacEvidenceManifestSigner implements EvidenceManifestSigner {
  constructor(private readonly key: string, private readonly id: string, private readonly version = "v1", private readonly providerId = "local-hmac") {
    if (!key.trim()) throw new Error("Foundry evidence signer key is empty");
    if (!id.trim()) throw new Error("Foundry evidence signer key id is empty");
    if (!version.trim()) throw new Error("Foundry evidence signer key version is empty");
  }

  provider() {
    return this.providerId;
  }

  keyId() {
    return this.id;
  }

  keyVersion() {
    return this.version;
  }

  algorithm() {
    return "HMAC-SHA256" as const;
  }

  sign(payload: EvidenceSignerPayload) {
    return `hmac-sha256:${createHmac("sha256", this.key).update(canonicalJson(payload), "utf8").digest("hex")}`;
  }
}

export class RsaPssEvidenceManifestSigner implements EvidenceManifestSigner {
  constructor(private readonly privateKeyPem: string, private readonly id: string, private readonly version = "v1", private readonly providerId = "local-kms-rsa") {
    if (!privateKeyPem.trim()) throw new Error("Foundry KMS RSA private key is empty");
    if (!id.trim()) throw new Error("Foundry KMS RSA key id is empty");
    if (!version.trim()) throw new Error("Foundry KMS RSA key version is empty");
  }

  provider() {
    return this.providerId;
  }

  keyId() {
    return this.id;
  }

  keyVersion() {
    return this.version;
  }

  algorithm() {
    return "RSASSA-PSS-SHA256" as const;
  }

  sign(payload: EvidenceSignerPayload) {
    const signature = createSign("sha256").update(canonicalJson(payload), "utf8").sign({
      key: this.privateKeyPem,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    }, "base64");
    return `rsa-pss-sha256:${signature}`;
  }
}

export class ExternalKmsEvidenceManifestSigner implements EvidenceManifestSigner {
  constructor(private readonly command: string[], private readonly id: string, private readonly version = "v1", private readonly providerId = "external-kms") {
    if (!command.length) throw new Error("Foundry external KMS command is required");
    if (!id.trim()) throw new Error("Foundry external KMS key id is empty");
    if (!version.trim()) throw new Error("Foundry external KMS key version is empty");
  }

  provider() {
    return this.providerId;
  }

  keyId() {
    return this.id;
  }

  keyVersion() {
    return this.version;
  }

  algorithm() {
    return "RSASSA-PSS-SHA256" as const;
  }

  sign(payload: EvidenceSignerPayload) {
    const result = spawnSync(this.command[0], this.command.slice(1), {
      input: canonicalJson({
        payload,
        keyId: this.id,
        keyVersion: this.version,
      }),
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(`Foundry external KMS signer failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
    }
    const parsed = JSON.parse(result.stdout);
    if (!parsed || typeof parsed.signature !== "string" || !parsed.signature.trim()) {
      throw new Error("Foundry external KMS signer returned no signature");
    }
    return parsed.signature;
  }
}

export function defaultEvidenceManifestSigner(): EvidenceManifestSigner {
  const provider = process.env.FOUNDRY_EVIDENCE_SIGNER_PROVIDER || "local-hmac";
  const configuredKey = process.env.FOUNDRY_EVIDENCE_SIGNING_KEY;
  const keyId = process.env.FOUNDRY_EVIDENCE_SIGNING_KEY_ID || "foundry-local-dev-key";
  const keyVersion = process.env.FOUNDRY_EVIDENCE_SIGNING_KEY_VERSION || "v1";
  if (provider === "external-kms") {
    const command = process.env.FOUNDRY_EVIDENCE_KMS_COMMAND;
    if (!command) throw new Error("FOUNDRY_EVIDENCE_KMS_COMMAND is required for external-kms signing");
    return new ExternalKmsEvidenceManifestSigner(command.split(" "), keyId, keyVersion, provider);
  }
  if (provider === "local-kms-rsa") {
    const privateKey = process.env.FOUNDRY_EVIDENCE_KMS_PRIVATE_KEY_PEM;
    if (!privateKey) throw new Error("FOUNDRY_EVIDENCE_KMS_PRIVATE_KEY_PEM is required for local-kms-rsa signing");
    return new RsaPssEvidenceManifestSigner(privateKey.replace(/\\n/g, "\n"), keyId, keyVersion, provider);
  }
  if (configuredKey) return new HmacEvidenceManifestSigner(configuredKey, keyId, keyVersion, provider);
  if (process.env.NODE_ENV === "production") {
    throw new Error("FOUNDRY_EVIDENCE_SIGNER_PROVIDER=external-kms or FOUNDRY_EVIDENCE_SIGNING_KEY is required in production");
  }
  return new HmacEvidenceManifestSigner("foundry-local-development-signing-key", keyId, keyVersion, provider);
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
  rollbackEvidenceReferences?: string[];
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
    ...Array.from(new Set(input.rollbackEvidenceReferences || [])).map((reference, index) => ({
      evidenceId: `rollback-evidence-${index + 1}`,
      reference,
      hash: sha256Canonical({ reference }),
      type: "rollback-evidence",
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
    signerProvider: signer.provider(),
    signerKeyId: signer.keyId(),
    signerKeyVersion: signer.keyVersion(),
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
