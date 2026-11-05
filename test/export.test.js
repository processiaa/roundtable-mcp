import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setup, tempDir, text, baseDebate } from "./helpers.js";

async function withDebate(opts) {
  const ctx = setup(opts);
  await ctx.call("create_debate", baseDebate());
  return ctx;
}

const exportedPath = (res) => text(res).split("\n")[0].replace(/^.* to /, "");

test("default export goes to the exports folder and can be re-exported", async () => {
  const { call, storage } = await withDebate();
  const first = await call("export_debate", { debate_id: "d1" });
  assert.equal(first.isError, undefined, text(first));
  const file = path.join(storage.paths.exportsDir, "d1-adr.md");
  assert.ok(fs.existsSync(file));
  const again = await call("export_debate", { debate_id: "d1" });
  assert.equal(again.isError, undefined, "overwriting inside exports is allowed");
});

test("a bare file name is saved in the exports folder", async () => {
  const { call, storage } = await withDebate();
  const res = await call("export_debate", { debate_id: "d1", output_path: "001-decision.md", format: "markdown" });
  assert.equal(res.isError, undefined, text(res));
  assert.match(fs.readFileSync(path.join(storage.paths.exportsDir, "001-decision.md"), "utf-8"), /# Debate Transcript/);
});

test("relative paths resolve against the client's project root and never overwrite", async () => {
  const project = tempDir("project-");
  const { call } = await withDebate({ roots: [project] });
  const res = await call("export_debate", { debate_id: "d1", output_path: "docs/adr/001.md" });
  assert.equal(res.isError, undefined, text(res));
  const target = path.join(project, "docs", "adr", "001.md");
  assert.ok(fs.existsSync(target));
  assert.equal(fs.realpathSync(exportedPath(res)), fs.realpathSync(target));

  const again = await call("export_debate", { debate_id: "d1", output_path: "docs/adr/001.md" });
  assert.equal(again.isError, true);
  assert.match(text(again), /already exists/);
});

test("paths outside the allowed roots are rejected", async () => {
  const project = tempDir("project-");
  const outside = tempDir("outside-");
  const { call } = await withDebate({ roots: [project] });

  for (const output_path of [
    path.join(outside, "x.md"),
    "../escape.md",
    "docs/../../escape.md",
  ]) {
    const res = await call("export_debate", { debate_id: "d1", output_path });
    assert.equal(res.isError, true, output_path);
    assert.match(text(res), /outside the allowed export folders/);
  }
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("non-.md targets and ambiguous relative paths are rejected", async () => {
  const { call } = await withDebate();
  const bashrc = await call("export_debate", { debate_id: "d1", output_path: "/home/user/.bashrc" });
  assert.equal(bashrc.isError, true);
  assert.match(text(bashrc), /must end in '.md'/);

  const rel = await call("export_debate", { debate_id: "d1", output_path: "docs/adr/001.md" });
  assert.equal(rel.isError, true);
  assert.match(text(rel), /did not share its project folder/);
});

test("ROUNDTABLE_EXPORT_ROOTS allows extra folders, still without overwriting", async () => {
  const extra = tempDir("extra-");
  const { call } = await withDebate({ env: { ROUNDTABLE_EXPORT_ROOTS: extra } });
  const target = path.join(extra, "adr.md");
  fs.writeFileSync(target, "precious");
  const res = await call("export_debate", { debate_id: "d1", output_path: target });
  assert.equal(res.isError, true);
  assert.equal(fs.readFileSync(target, "utf-8"), "precious");

  const ok = await call("export_debate", { debate_id: "d1", output_path: path.join(extra, "new.md") });
  assert.equal(ok.isError, undefined, text(ok));
});

test("symlinks cannot be used to escape the allowed roots", { skip: process.platform === "win32" }, async () => {
  const project = tempDir("project-");
  const outside = tempDir("outside-");
  fs.symlinkSync(outside, path.join(project, "link"));
  const { call } = await withDebate({ roots: [project] });
  const res = await call("export_debate", { debate_id: "d1", output_path: "link/pwn.md" });
  assert.equal(res.isError, true);
  assert.deepEqual(fs.readdirSync(outside), []);
});
