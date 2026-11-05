import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setup, baseDebate } from "./helpers.js";

const WORKER = fileURLToPath(new URL("./fixtures/worker.js", import.meta.url));

function runWorker(storageDir, debateId, agent, count, startAt) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER, storageDir, debateId, agent, String(count), String(startAt)]);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`worker exited ${code}: ${err}`));
      resolve(JSON.parse(out));
    });
  });
}

const PROCESSES = 4;
const POSTS_EACH = 50;
const startAt = () => Date.now() + 1500;

test("several processes writing the same debate lose no turns", async () => {
  const { dir, call, storage } = setup();
  // single_agent + no strict order so every process may post any position.
  await call("create_debate", baseDebate({
    execution_mode: "single_agent",
    strict_turn_order: false,
    max_rounds: 20,
    max_words: 1000,
    // 10 participants x 20 rounds = 200 turns of room.
    participants: "ABCDEFGHIJ".split("").map((id) => ({ id, role: id })),
  }));

  const at = startAt();
  const results = await Promise.all(
    Array.from({ length: PROCESSES }, (_, i) => runWorker(dir, "d1", `w${i}`, POSTS_EACH, at))
  );
  for (const r of results) assert.deepEqual(r.failures, []);

  const debate = await storage.read("d1");
  assert.equal(debate.turns.length, PROCESSES * POSTS_EACH, "every post must be persisted");
  assert.deepEqual(debate.turns.map((t) => t.turn), Array.from({ length: PROCESSES * POSTS_EACH }, (_, i) => i + 1));
});

test("processes writing different debates do not clobber each other", async () => {
  const { dir, call, storage } = setup();
  const ids = Array.from({ length: PROCESSES }, (_, i) => `deb-${i}`);
  for (const id of ids) {
    await call("create_debate", baseDebate({
      debate_id: id, execution_mode: "single_agent", strict_turn_order: false, max_rounds: 20, max_words: 1000,
      participants: "ABC".split("").map((pid) => ({ id: pid, role: pid })),
    }));
  }
  const at = startAt();
  const results = await Promise.all(ids.map((id, i) => runWorker(dir, id, `w${i}`, POSTS_EACH, at)));
  for (const r of results) assert.deepEqual(r.failures, []);
  for (const id of ids) assert.equal((await storage.read(id)).turns.length, POSTS_EACH);
});
