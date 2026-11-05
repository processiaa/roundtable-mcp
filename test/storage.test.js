import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Storage, resolveStoragePaths } from "../lib/storage.js";
import { setup, tempDir, text } from "./helpers.js";

test("each debate is stored in its own file", async () => {
  const { call, storage } = setup();
  for (const id of ["one", "two"]) {
    await call("create_debate", {
      debate_id: id, topic: "t", client_platform: "claude", execution_mode: "subagents",
      default_model: "inherit", default_effort: "low", position_a: "a", position_b: "b",
    });
  }
  const files = fs.readdirSync(storage.paths.debatesDir).sort();
  assert.deepEqual(files, ["one.json", "two.json"]);
  assert.deepEqual(fs.readdirSync(storage.paths.locksDir), [], "locks are released");
});

test("a corrupt debate file raises an error and is never overwritten", async () => {
  const { call, storage } = setup();
  fs.mkdirSync(storage.paths.debatesDir, { recursive: true });
  const file = path.join(storage.paths.debatesDir, "broken.json");
  fs.writeFileSync(file, "{ not json");

  const res = await call("post_argument", { debate_id: "broken", agent_name: "x", position: "A", argument: "y" });
  assert.equal(res.isError, true);
  assert.match(text(res), /not valid JSON/);
  assert.equal(fs.readFileSync(file, "utf-8"), "{ not json");

  const created = await call("create_debate", {
    debate_id: "broken", topic: "t", client_platform: "claude", execution_mode: "subagents",
    default_model: "inherit", default_effort: "low", position_a: "a", position_b: "b", overwrite: true,
  });
  assert.equal(created.isError, true, "even overwrite must not silently replace an unreadable file");
  assert.equal(fs.readFileSync(file, "utf-8"), "{ not json");

  const listed = JSON.parse(text(await call("list_debates", {})));
  assert.equal(listed.unreadable_files[0].file, "broken.json");
});

test("read errors other than ENOENT are reported instead of treated as empty", async () => {
  const { storage } = setup();
  fs.mkdirSync(path.join(storage.paths.debatesDir, "dir.json"), { recursive: true });
  await assert.rejects(() => storage.read("dir"), /Could not read/);
});

test("legacy debates.json is migrated to one file per debate and kept as .bak", async () => {
  const dir = tempDir();
  const legacy = path.join(dir, "debates.json");
  fs.writeFileSync(legacy, JSON.stringify({
    "old-1": { debate_id: "old-1", topic: "first", status: "closed", turns: [{ turn: 1 }] },
    "old 2": { debate_id: "old 2", topic: "bad id", status: "open", turns: [] },
    "old-3": { topic: "missing id field", status: "open", turns: [] },
  }));
  const storage = new Storage(resolveStoragePaths({ ROUNDTABLE_STORAGE_PATH: legacy }));
  const report = await storage.migrateLegacy();

  assert.deepEqual(report.migrated.sort(), ["old-1", "old-3"]);
  assert.equal(report.skipped[0].id, "old 2");
  assert.equal(report.backup, `${legacy}.bak`);
  assert.ok(!fs.existsSync(legacy));
  assert.ok(fs.existsSync(`${legacy}.bak`));
  assert.equal((await storage.read("old-1")).turns.length, 1);
  assert.equal((await storage.read("old-3")).debate_id, "old-3");

  // Running again is a no-op.
  assert.deepEqual((await storage.migrateLegacy()).migrated, []);
});

test("a corrupt legacy file is left untouched", async () => {
  const dir = tempDir();
  const legacy = path.join(dir, "debates.json");
  fs.writeFileSync(legacy, "garbage");
  const storage = new Storage(resolveStoragePaths({ ROUNDTABLE_STORAGE_PATH: dir }));
  await assert.rejects(() => storage.migrateLegacy(), /not valid JSON/);
  assert.equal(fs.readFileSync(legacy, "utf-8"), "garbage");
});

test("migration never overwrites a debate that already exists in the new store", async () => {
  const dir = tempDir();
  const storage = new Storage(resolveStoragePaths({ ROUNDTABLE_STORAGE_PATH: dir }));
  await storage.update("same", () => ({ save: { debate_id: "same", topic: "new" } }));
  fs.writeFileSync(path.join(dir, "debates.json"), JSON.stringify({ same: { topic: "old" } }));
  const report = await storage.migrateLegacy();
  assert.equal(report.skipped[0].id, "same");
  assert.equal((await storage.read("same")).topic, "new");
  assert.ok(fs.existsSync(path.join(dir, "debates.json.bak")), "old data still recoverable from the backup");
});

test("stale locks left by a crashed process are broken; fresh ones time out", async () => {
  const dir = tempDir();
  const storage = new Storage(resolveStoragePaths({ ROUNDTABLE_STORAGE_PATH: dir }), {
    staleLockMs: 200,
    lockTimeoutMs: 100,
  });
  storage.ensureDirs();
  const lock = path.join(storage.paths.locksDir, "debate-x.lock");

  fs.writeFileSync(lock, "{}");
  await assert.rejects(() => storage.update("x", () => ({})), /Could not lock/);

  const old = new Date(Date.now() - 5000);
  fs.utimesSync(lock, old, old);
  await storage.update("x", () => ({ save: { debate_id: "x" } }));
  assert.ok(!fs.existsSync(lock));
});

test("ROUNDTABLE_STORAGE_PATH accepts a folder or a v0.4 json file", () => {
  const folder = resolveStoragePaths({ ROUNDTABLE_STORAGE_PATH: "/tmp/rt-x" });
  assert.equal(folder.debatesDir, path.resolve("/tmp/rt-x/debates"));
  const file = resolveStoragePaths({ ROUNDTABLE_STORAGE_PATH: "/tmp/rt-y/custom.json" });
  assert.equal(file.legacyFile, path.resolve("/tmp/rt-y/custom.json"));
  assert.equal(file.debatesDir, path.resolve("/tmp/rt-y/debates"));
});
