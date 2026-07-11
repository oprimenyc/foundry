// Minimal declaration for the experimental node:sqlite builtin (Node >= 22.5).
// The installed @types/node predates it; only the surface Foundry uses is declared.
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }

  export interface StatementSync {
    get(...params: Array<string | number | null>): unknown;
    run(...params: Array<string | number | null>): { changes: number | bigint; lastInsertRowid: number | bigint };
    all(...params: Array<string | number | null>): unknown[];
  }
}
