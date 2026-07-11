import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import {
  type DeploymentPlanRecord,
  type DeploymentRunRecord,
  type DeploymentStepRecord,
  type ExecutionEventRecord,
  type FoundryStore,
  type LaunchEvidenceRecord,
  type ProjectRecord,
  type ProviderCredentialReferenceRecord,
  type RollbackActionRecord,
} from "./types";

const DEFAULT_STORE: FoundryStore = {
  projects: [],
  plans: [],
  runs: [],
  steps: [],
  credentials: [],
  events: [],
  rollbacks: [],
  evidence: [],
};

type CollectionKey = keyof FoundryStore;

export interface FoundryPersistence {
  mode(): "file" | "supabase";
  read(): Promise<FoundryStore>;
  write(mutator: (draft: FoundryStore) => void): Promise<FoundryStore>;
}

class FilePersistence implements FoundryPersistence {
  private queue = Promise.resolve();

  constructor(private readonly filePath: string) {}

  mode() {
    return "file" as const;
  }

  async read(): Promise<FoundryStore> {
    await this.queue;
    return this.readRaw();
  }

  private async readRaw(): Promise<FoundryStore> {
    await this.ensureFile();
    const raw = await readFile(this.filePath, "utf8");
    return JSON.parse(raw) as FoundryStore;
  }

  async write(mutator: (draft: FoundryStore) => void): Promise<FoundryStore> {
    this.queue = this.queue.then(async () => {
      const current = await this.readRaw();
      mutator(current);
      await writeFile(this.filePath, JSON.stringify(current, null, 2), "utf8");
    });
    await this.queue;
    return this.read();
  }

  private async ensureFile() {
    const dir = path.dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    try {
      await readFile(this.filePath, "utf8");
    } catch {
      await writeFile(this.filePath, JSON.stringify(DEFAULT_STORE, null, 2), "utf8");
    }
  }
}

const globalForStore = globalThis as unknown as {
  __foundryStore?: FoundryPersistence;
};

export function getFoundryPersistence(): FoundryPersistence {
  if (!globalForStore.__foundryStore) {
    const filePath = process.env.FOUNDRY_STORE_FILE || path.join(process.cwd(), ".foundry-data", "store.json");
    globalForStore.__foundryStore = new FilePersistence(filePath);
  }
  return globalForStore.__foundryStore;
}

export function resetFoundryPersistence() {
  delete globalForStore.__foundryStore;
}

export function newId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

export async function insertRecord<TKey extends CollectionKey, TValue extends FoundryStore[TKey][number]>(
  key: TKey,
  value: TValue
) {
  await getFoundryPersistence().write((draft) => {
    (draft[key] as TValue[]).push(value);
  });
  return value;
}

export async function updateRecords<TKey extends CollectionKey, TValue extends FoundryStore[TKey][number]>(
  key: TKey,
  predicate: (value: TValue) => boolean,
  updater: (value: TValue) => TValue
) {
  return getFoundryPersistence().write((draft) => {
    draft[key] = (draft[key] as TValue[]).map((value) => (predicate(value) ? updater(value) : value)) as FoundryStore[TKey];
  });
}

export async function getStoreSnapshot() {
  return getFoundryPersistence().read();
}

export function createProjectRecord(input: Omit<ProjectRecord, "id" | "createdAt" | "updatedAt">): ProjectRecord {
  const now = new Date().toISOString();
  return { ...input, id: newId("proj"), createdAt: now, updatedAt: now };
}

export function createPlanRecord(input: Omit<DeploymentPlanRecord, "id" | "createdAt">): DeploymentPlanRecord {
  return { ...input, id: newId("plan"), createdAt: new Date().toISOString() };
}

export function createRunRecord(input: Omit<DeploymentRunRecord, "id" | "createdAt">): DeploymentRunRecord {
  return { ...input, id: newId("run"), createdAt: new Date().toISOString() };
}

export function createStepRecord(input: Omit<DeploymentStepRecord, "id">): DeploymentStepRecord {
  return { ...input, id: newId("step") };
}

export function createEventRecord(input: Omit<ExecutionEventRecord, "id" | "timestamp">): ExecutionEventRecord {
  return { ...input, id: newId("evt"), timestamp: new Date().toISOString() };
}

export function createRollbackRecord(input: Omit<RollbackActionRecord, "id" | "createdAt">): RollbackActionRecord {
  return { ...input, id: newId("rb"), createdAt: new Date().toISOString() };
}

export function createEvidenceRecord(input: Omit<LaunchEvidenceRecord, "id" | "createdAt" | "verifiedAt">): LaunchEvidenceRecord {
  const now = new Date().toISOString();
  return { ...input, id: newId("evidence"), createdAt: now, verifiedAt: now };
}

export function createCredentialRecord(
  input: Omit<ProviderCredentialReferenceRecord, "id" | "createdAt">
): ProviderCredentialReferenceRecord {
  return { ...input, id: newId("cred"), createdAt: new Date().toISOString() };
}
