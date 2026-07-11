import { getStoreSnapshot, insertRecord, newId } from "./store";
import type { VerificationRecord } from "./types";

export const VERIFIER_VERSION = "foundry-independent-verifier@1";

export type VerificationFetch = (url: string) => Promise<{ ok: boolean; status: number }>;

/**
 * Independent verification: looks up the deployed/created resources recorded
 * by a run and checks them against the outside world (HTTP), APPENDING
 * verification records. It never mutates runs, steps, or events — execution
 * history stays exactly as the engine wrote it, so a verifier can disagree
 * with a run's own success claim and both remain visible.
 *
 * fetchImpl is injectable: stubs locally, real fetch when live verification
 * is wanted. Re-running verification appends a new attempt (independent
 * retry); consumers read the latest record per target and can see staleness
 * via checkedAt.
 */
export async function verifyRunIndependently(
  runId: string,
  options: { fetchImpl?: VerificationFetch } = {}
): Promise<VerificationRecord[]> {
  const fetchImpl: VerificationFetch =
    options.fetchImpl ??
    (async (url) => {
      const res = await fetch(url, { method: "GET", redirect: "follow" });
      return { ok: res.ok, status: res.status };
    });

  const snapshot = await getStoreSnapshot();
  const run = snapshot.runs.find((item) => item.id === runId);
  if (!run) throw new Error(`Run ${runId} not found`);

  const targets: VerificationRecord["target"][] = [];
  if (run.providerReferences.vercelDeploymentUrl) {
    targets.push({ kind: "deployment_url", reference: run.providerReferences.vercelDeploymentUrl });
  }
  if (run.providerReferences.githubRepoUrl) {
    targets.push({ kind: "repository_url", reference: run.providerReferences.githubRepoUrl });
  }
  if (targets.length === 0) {
    const record: VerificationRecord = {
      id: newId("verify"),
      runId,
      target: { kind: "deployment_url", reference: "" },
      status: "failed",
      detail: "no verifiable provider references recorded on this run",
      attempt: nextAttempt(snapshot.verifications, runId),
      checkedAt: new Date().toISOString(),
      verifierVersion: VERIFIER_VERSION,
    };
    await insertRecord("verifications", record);
    return [record];
  }

  const attempt = nextAttempt(snapshot.verifications, runId);
  const records: VerificationRecord[] = [];
  for (const target of targets) {
    let status: VerificationRecord["status"];
    let detail: string;
    try {
      const result = await fetchImpl(target.reference);
      status = result.ok ? "passed" : "failed";
      detail = `GET ${target.reference} → ${result.status}`;
    } catch (error) {
      status = "failed";
      detail = `GET ${target.reference} failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    const record: VerificationRecord = {
      id: newId("verify"),
      runId,
      target,
      status,
      detail,
      attempt,
      checkedAt: new Date().toISOString(),
      verifierVersion: VERIFIER_VERSION,
    };
    await insertRecord("verifications", record);
    records.push(record);
  }
  return records;
}

function nextAttempt(existing: VerificationRecord[], runId: string): number {
  return existing.filter((item) => item.runId === runId).reduce((max, item) => Math.max(max, item.attempt), 0) + 1;
}

/** Latest verification per target for a run, plus the overall verdict. */
export async function getVerificationView(runId: string) {
  const snapshot = await getStoreSnapshot();
  const records = snapshot.verifications
    .filter((item) => item.runId === runId)
    .sort((a, b) => a.attempt - b.attempt || a.checkedAt.localeCompare(b.checkedAt));
  const latestByTarget = new Map<string, VerificationRecord>();
  for (const record of records) {
    latestByTarget.set(`${record.target.kind}:${record.target.reference}`, record);
  }
  const latest = Array.from(latestByTarget.values());
  return {
    records,
    latest,
    independentlyVerified: latest.length > 0 && latest.every((item) => item.status === "passed"),
  };
}
