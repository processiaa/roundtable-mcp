import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Storage, resolveStoragePaths } from "../lib/storage.js";
import { createToolHandler } from "../lib/tools.js";

export function tempDir(prefix = "roundtable-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function setup({ roots = [], env = {}, clientName } = {}) {
  const dir = tempDir();
  const fullEnv = { ROUNDTABLE_STORAGE_PATH: dir, ...env };
  const storage = new Storage(resolveStoragePaths(fullEnv));
  const call = createToolHandler({
    storage,
    env: fullEnv,
    getClientName: () => clientName,
    getClientRoots: async () => roots,
  });
  return { dir, storage, call };
}

export const text = (result) => result.content.map((c) => c.text).join("\n");

export function baseDebate(overrides = {}) {
  return {
    debate_id: "d1",
    topic: "Monolith vs microservices",
    client_platform: "claude",
    execution_mode: "subagents",
    default_model: "sonnet",
    default_effort: "medium",
    position_a: "Monolith",
    position_b: "Microservices",
    max_rounds: 2,
    max_words: 100,
    ...overrides,
  };
}

export function words(n) {
  return Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
}
