import { randomUUID, createHash } from "node:crypto";

export const newId = (prefix: string): string => `${prefix}_${randomUUID().slice(0, 12)}`;

export const contentHash = (s: string): string =>
  createHash("sha256").update(s).digest("hex").slice(0, 32);

export const nowIso = (): string => new Date().toISOString();
