import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { mkdirSync } from "fs";
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
  type SignedEvidenceManifestRecord,
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
  evidenceManifests: [],
  verifications: [],
};

/** Backward compatibility: stores persisted before a collection existed gain it as empty. */
function normalizeStore(raw: FoundryStore): FoundryStore {
  for (const key of Object.keys(DEFAULT_STORE) as CollectionKey[]) {
    if (!Array.isArray(raw[key])) (raw as unknown as Record<string, unknown>)[key] = [];
  }
  return raw;
}

type CollectionKey = keyof FoundryStore;

export type PersistenceMode = "file" | "sqlite";

export interface FoundryPersistence {
  mode(): PersistenceMode;
  /** True when the backing store gives atomic, durable, crash-safe writes on a single node. */
  productionSafe(): boolean;
  read(): Promise<FoundryStore>;
  write(mutator: (draft: FoundryStore) => void): Promise<FoundryStore>;
  /** Real read/write probe against the backing store; throws on failure. */
  probe(): Promise<void>;
}

class FilePersistence implements FoundryPersistence {
  private queue = Promise.resolve();

  constructor(private readonly filePath: string) {}

  mode() {
    return "file" as const;
  }

  productionSafe() {
    // JSON.stringify + non-atomic writeFile: a crash mid-write corrupts the store.
    return false;
  }

  async probe() {
    await this.write(() => {});
  }

  async read(): Promise<FoundryStore> {
    await this.queue;
    return this.readRaw();
  }

  private async readRaw(): Promise<FoundryStore> {
    await this.ensureFile();
    const raw = await readFile(this.filePath, "utf8");
    return normalizeStore(JSON.parse(raw) as FoundryStore);
  }

  async write(mutator: (draft: FoundryStore) => void): Promise<FoundryStore> {
    this.queue = this.queue.then(async () => {
      const current = await this.readRaw();
      mutator(current);
      // Write-to-temp + rename so a crash mid-write never truncates the live store.
      const tmpPath = `${this.filePath}.tmp`;
      await writeFile(tmpPath, JSON.stringify(current, null, 2), "utf8");
      await rename(tmpPath, this.filePath);
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

class SqlitePersistence implements FoundryPersistence {
  private queue = Promise.resolve();
  // Type from node:sqlite (experimental builtin); loaded lazily so file mode never touches it.
  private db: import("node:sqlite").DatabaseSync;

  constructor(private readonly dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    // process.getBuiltinModule works in both CJS and ESM and keeps bundlers from
    // trying to resolve the experimental builtin statically.
    const sqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite") | undefined;
    if (!sqlite) throw new Error("node:sqlite is unavailable in this Node runtime; sqlite persistence requires Node >= 22.5");
    const { DatabaseSync } = sqlite;
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = FULL;");
    this.db.exec("CREATE TABLE IF NOT EXISTS foundry_store (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)");
    const row = this.db.prepare("SELECT id FROM foundry_store WHERE id = 1").get();
    if (!row) {
      this.db.prepare("INSERT INTO foundry_store (id, data) VALUES (1, ?)").run(JSON.stringify(DEFAULT_STORE));
    }
  }

  mode() {
    return "sqlite" as const;
  }

  productionSafe() {
    // WAL journal + FULL sync + transactional single-row update: atomic and crash-safe on a single node.
    return true;
  }

  async read(): Promise<FoundryStore> {
    await this.queue;
    return this.readRaw();
  }

  private readRaw(): FoundryStore {
    const row = this.db.prepare("SELECT data FROM foundry_store WHERE id = 1").get() as { data: string } | undefined;
    if (!row) throw new Error("SQLite store row missing — store not initialized");
    return normalizeStore(JSON.parse(row.data) as FoundryStore);
  }

  async write(mutator: (draft: FoundryStore) => void): Promise<FoundryStore> {
    let result: FoundryStore | undefined;
    this.queue = this.queue.then(async () => {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const current = this.readRaw();
        mutator(current);
        this.db.prepare("UPDATE foundry_store SET data = ? WHERE id = 1").run(JSON.stringify(current));
        this.db.exec("COMMIT");
        result = current;
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    });
    await this.queue;
    if (!result) throw new Error("SQLite write produced no result");
    return result;
  }

  async probe() {
    await this.write(() => {});
  }
}

const globalForStore = globalThis as unknown as {
  __foundryStore?: FoundryPersistence;
};

const VALID_MODES: PersistenceMode[] = ["file", "sqlite"];

function resolvePersistenceMode(): PersistenceMode {
  const configured = process.env.FOUNDRY_PERSISTENCE;
  if (configured) {
    if (!VALID_MODES.includes(configured as PersistenceMode)) {
      throw new Error(
        `Unknown FOUNDRY_PERSISTENCE mode "${configured}". Valid modes: ${VALID_MODES.join(", ")}`
      );
    }
    return configured as PersistenceMode;
  }
  // Default: durable sqlite in production, file for dev/test convenience.
  return process.env.NODE_ENV === "production" ? "sqlite" : "file";
}

export function getFoundryPersistence(): FoundryPersistence {
  if (!globalForStore.__foundryStore) {
    const mode = resolvePersistenceMode();
    if (mode === "sqlite") {
      const dbPath = process.env.FOUNDRY_SQLITE_FILE || path.join(process.cwd(), ".foundry-data", "store.sqlite");
      globalForStore.__foundryStore = new SqlitePersistence(dbPath);
    } else {
      const filePath = process.env.FOUNDRY_STORE_FILE || path.join(process.cwd(), ".foundry-data", "store.json");
      globalForStore.__foundryStore = new FilePersistence(filePath);
    }
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
export function createEvidenceManifestRecord(input: Omit<SignedEvidenceManifestRecord, "id">): SignedEvidenceManifestRecord {
  return { ...input, id: newId("manifest") };
}


export function createCredentialRecord(
  input: Omit<ProviderCredentialReferenceRecord, "id" | "createdAt">
): ProviderCredentialReferenceRecord {
  return { ...input, id: newId("cred"), createdAt: new Date().toISOString() };
}
