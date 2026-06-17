/** Force an in-memory DB for tests before any module reads config. */
process.env.CF_DB_PATH = ":memory:";
process.env.CF_AI_PROVIDER = "mock";
process.env.CF_EMBED_PROVIDER = "mock";
