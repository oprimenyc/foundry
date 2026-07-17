import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { createArtifactRecord, getStoreSnapshot, insertRecord } from "./store";
import { redactString } from "@/lib/vault/redaction";
import type { ArtifactRecord, RetentionClass } from "./types";

/**
 * Artifact retention backend (Mission 8).
 *
 * A content-addressed local store for execution and release artifacts. Every
 * artifact is:
 *  - deterministically identified by the sha256 of its (redacted) content,
 *  - checksum-verified on read,
 *  - classed by retention (with an expiry derived from the class),
 *  - redacted before it is ever written (no secrets, cookies, or tokens land
 *    on disk or in the record),
 *  - provenance-stamped.
 *
 * This is a storage *adapter boundary*: the local file adapter is the safe
 * default; a production object-store adapter would implement the same contract.
 * It is deliberately NOT a general document-management system.
 */

const RETENTION_TTL_MS: Record<RetentionClass, number | null> = {
  EPHEMERAL: 60 * 60_000, // 1 hour
  STANDARD: 30 * 24 * 60 * 60_000, // 30 days
  RELEASE: 365 * 24 * 60 * 60_000, // 1 year
  AUDIT: null, // kept indefinitely
  LEGAL_HOLD: null, // kept indefinitely, immutable
};

const IMMUTABLE_CLASSES = new Set<RetentionClass>(["RELEASE", "AUDIT", "LEGAL_HOLD"]);

function artifactRoot(): string {
  return process.env.FOUNDRY_ARTIFACT_DIR || path.join(process.cwd(), ".foundry-data", "artifacts");
}

export interface RetainArtifactInput {
  kind: string;
  content: unknown;
  contentType?: string;
  retentionClass: RetentionClass;
  producer: string;
  source: string;
  runId?: string;
  projectId?: string;
  envelopeId?: string;
  createdFrom?: string;
}

/**
 * Retain an artifact. Idempotent: retaining identical content twice returns the
 * existing record (same content-addressed id) without a second write.
 */
export async function retainArtifact(input: RetainArtifactInput): Promise<ArtifactRecord> {
  const serialized =
    typeof input.content === "string" ? input.content : JSON.stringify(input.content, null, 2);
  // Redact BEFORE hashing/writing — the stored bytes and the checksum are both
  // over redacted content, so no secret can ever be reconstructed from either.
  const redacted = redactString(serialized);
  const checksum = createHash("sha256").update(redacted, "utf8").digest("hex");

  const existing = (await getStoreSnapshot()).artifacts.find((a) => a.checksum === checksum);
  if (existing) return existing;

  const now = new Date();
  const ttl = RETENTION_TTL_MS[input.retentionClass];
  const expiresAt = ttl === null ? undefined : new Date(now.getTime() + ttl).toISOString();

  const root = artifactRoot();
  await mkdir(root, { recursive: true });
  const fileName = `${checksum}.json`;
  const filePath = path.join(root, fileName);
  await writeFile(filePath, redacted, "utf8");

  const record = createArtifactRecord({
    runId: input.runId,
    projectId: input.projectId,
    envelopeId: input.envelopeId,
    kind: input.kind,
    contentType: input.contentType || (typeof input.content === "string" ? "text/plain" : "application/json"),
    checksum,
    sizeBytes: Buffer.byteLength(redacted, "utf8"),
    storageUri: `file://${filePath}`,
    retentionClass: input.retentionClass,
    immutable: IMMUTABLE_CLASSES.has(input.retentionClass),
    redacted: redacted !== serialized,
    provenance: { producer: input.producer, source: input.source, createdFrom: input.createdFrom },
    createdAt: now.toISOString(),
    expiresAt,
  });
  await insertRecord("artifacts", record);
  return record;
}

export interface ArtifactIntegrity {
  artifactId: string;
  ok: boolean;
  detail: string;
}

/**
 * Verify a retained artifact against its recorded checksum by re-reading and
 * re-hashing the stored bytes. Detects tampering of the on-disk content.
 */
export async function verifyArtifactIntegrity(artifactId: string): Promise<ArtifactIntegrity> {
  const record = (await getStoreSnapshot()).artifacts.find((a) => a.id === artifactId);
  if (!record) return { artifactId, ok: false, detail: "artifact not found" };
  const filePath = record.storageUri.replace(/^file:\/\//, "");
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    return { artifactId, ok: false, detail: `content unreadable: ${(error as Error).message}` };
  }
  const actual = createHash("sha256").update(content, "utf8").digest("hex");
  if (actual !== record.checksum) {
    return { artifactId, ok: false, detail: "checksum mismatch — artifact tampered or corrupted" };
  }
  return { artifactId, ok: true, detail: "checksum verified" };
}

export async function listArtifacts(filter: { runId?: string; projectId?: string; retentionClass?: RetentionClass } = {}): Promise<ArtifactRecord[]> {
  const artifacts = (await getStoreSnapshot()).artifacts;
  return artifacts.filter(
    (a) =>
      (!filter.runId || a.runId === filter.runId) &&
      (!filter.projectId || a.projectId === filter.projectId) &&
      (!filter.retentionClass || a.retentionClass === filter.retentionClass)
  );
}

/** Artifacts whose retention window has elapsed (never immutable classes). */
export async function expiredArtifacts(asOf = new Date().toISOString()): Promise<ArtifactRecord[]> {
  return (await getStoreSnapshot()).artifacts.filter(
    (a) => !a.immutable && a.expiresAt !== undefined && a.expiresAt < asOf
  );
}
