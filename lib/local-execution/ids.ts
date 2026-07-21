import { randomUUID } from "crypto";

/** Local id helper — deliberately independent of lib/foundry/store's persistence singleton. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
