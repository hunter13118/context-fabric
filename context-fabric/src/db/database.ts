import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

/** Open (or create) the SQLite database and apply the schema. Idempotent. */
export function getDb(): Database.Database {
  if (db) return db;
  const path = config.dbPath;
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf8");
  db.exec(schema);
  return db;
}

/** Drop all rows — used by the demo to start from a clean slate. */
export function resetDb(): void {
  const d = getDb();
  const tables = [
    "tenant", "app_user", "app_connection", "external_object",
    "canonical_entity", "context_relationship", "event", "context_chunk",
    "context_summary", "access_policy", "audit_log", "ai_request",
  ];
  for (const t of tables) d.exec(`DELETE FROM ${t};`);
}

export function closeDb(): void {
  db?.close();
  db = null;
}
