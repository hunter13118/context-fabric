/** Central runtime configuration, read from environment with safe offline defaults. */
export const config = {
  aiProvider: (process.env.CF_AI_PROVIDER ?? "mock").toLowerCase(),
  aiApiKey: process.env.CF_AI_API_KEY ?? "",
  aiModel: process.env.CF_AI_MODEL ?? "",
  embedProvider: (process.env.CF_EMBED_PROVIDER ?? "mock").toLowerCase(),
  dbPath: process.env.CF_DB_PATH ?? "./data/context-fabric.db",
  apiPort: Number(process.env.CF_API_PORT ?? 8787),
  outDir: process.env.CF_OUT_DIR ?? "./out",
  embedDim: 256,
};

export type Config = typeof config;
