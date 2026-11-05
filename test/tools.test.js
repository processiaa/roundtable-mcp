import test from "node:test";
import assert from "node:assert/strict";
import { setup, text, baseDebate, words } from "./helpers.js";

async function postTurns(call, id, n, start = 0) {
  const positions = ["A", "B"];
  for (let i = start; i < start + n; i++) {
    const pos = positions[i % 2];
    const res = await call("post_argument", { debate_id: id, agent_name: `Sub-${pos}`, position: pos, argument: `arg ${i}` });
    assert.equal(res.isError, undefined, text(res));
  }
}

async function scoreAll(call, id, n) {
  for (let t = 1; t <= n; t++) {
    const res = await call("score_turn", {
      debate_id: id, turn_number: t, technical_evidence: 7, rebuttal_strength: 8, operational_viability: 6, clarity: 9,
    });
    assert.equal(res.isError, undefined, text(res));
  }
}

test("full debate flow: create -> post -> score -> close -> export", async () => {
  const { call } = setup();
  const created = await call("create_debate", baseDebate());
  assert.equal(created.isError, undefined, text(created));
  assert.match(text(created), /arguments over 115 words are rejected/);

  await postTurns(call, "d1", 4);
  const full = await call("post_argument", { debate_id: "d1", agent_name: "Sub-A", position: "A", argument: "x" });
  assert.equal(full.isError, true);
  assert.match(text(full), /maximum of 4 turns/);

  await scoreAll(call, "d1", 4);
  const closed = await call("close_debate", { debate_id: "d1", verdict: "Monolith first", winner: "a" });
  assert.equal(closed.isError, undefined, text(closed));
  assert.match(text(closed), /Winner\/Outcome: A/);

  const exported = await call("export_debate", { debate_id: "d1" });
  assert.equal(exported.isError, undefined, text(exported));
  assert.match(text(exported), /# ADR: Monolith vs microservices/);
  assert.match(text(exported), /\| A \| Monolith \| sonnet \| medium \| 2 \| 15 \| 7.5 \|/);
});

test("create_debate rejects a duplicate debate_id unless overwrite=true", async () => {
  const { call } = setup();
  await call("create_debate", baseDebate());
  await postTurns(call, "d1", 1);

  const dup = await call("create_debate", baseDebate());
  assert.equal(dup.isError, true);
  assert.match(text(dup), /already exists .*1 turns/);
  const kept = JSON.parse(text(await call("read_debate", { debate_id: "d1" })));
  assert.equal(kept.turns.length, 1, "original history must survive");

  const replaced = await call("create_debate", baseDebate({ overwrite: true }));
  assert.equal(replaced.isError, undefined);
  assert.match(text(replaced), /replaced/);
  const fresh = JSON.parse(text(await call("read_debate", { debate_id: "d1" })));
  assert.equal(fresh.turns.length, 0);
});

test("create_debate validates its inputs", async () => {
  const { call } = setup();
  const cases = [
    [{ debate_id: "../evil" }, /Invalid debate_id/],
    [{ debate_id: "CON" }, /reserved device name/],
    [{ execution_mode: undefined }, /'execution_mode' is required/],
    [{ execution_mode: "solo" }, /Invalid execution_mode/],
    [{ default_model: "pro" }, /Invalid default_model 'pro'/],
    [{ default_effort: "max" }, /Invalid default_effort/],
    [{ max_rounds: 0 }, /'max_rounds' must be an integer between 1 and 20/],
    [{ max_rounds: "3x" }, /'max_rounds' must be an integer/],
    [{ max_words: 5 }, /'max_words' must be an integer between 20/],
    [{ position_b: undefined }, /'position_b' is required/],
    [{ participants: [{ id: "A", role: "x" }, { id: "a", role: "y" }] }, /Duplicate participant id 'A'/],
    [{ participants: [{ id: "A", role: "x" }] }, /at least 2 entries/],
    [{ participants: [{ id: "A", role: "x" }, { id: "B", role: "y", model: "flash" }] }, /Invalid participants\[1\]\.model/],
    [{ topic: "  " }, /'topic' is required/],
  ];
  for (const [override, pattern] of cases) {
    const res = await call("create_debate", baseDebate(override));
    assert.equal(res.isError, true, `expected error for ${JSON.stringify(override)}`);
    assert.match(text(res), pattern);
  }
  const listed = await call("list_debates", {});
  assert.equal(text(listed), "No debates found.");
});

test("participants allow mixed platforms with their own models", async () => {
  const { call } = setup();
  const res = await call("create_debate", baseDebate({
    execution_mode: "cross_client",
    participants: [
      { id: "A", role: "Claude side", platform: "claude", model: "opus" },
      { id: "B", role: "Antigravity side", platform: "antigravity", model: "pro", effort: "low" },
    ],
  }));
  assert.equal(res.isError, undefined, text(res));
  const d = JSON.parse(text(await call("read_debate", { debate_id: "d1" })));
  assert.equal(d.participants[1].platform, "antigravity");
  assert.match(d.participants[1].effort_directive, /EFFORT=LOW/);
});

test("post_argument enforces position, turn order and anti-monologue", async () => {
  const { call } = setup();
  await call("create_debate", baseDebate());

  const bogus = await call("post_argument", { debate_id: "d1", agent_name: "x", position: "Z", argument: "hi" });
  assert.equal(bogus.isError, true);
  assert.match(text(bogus), /Position 'Z' does not exist/);

  const forcedBogus = await call("post_argument", { debate_id: "d1", agent_name: "x", position: "Z", argument: "hi", force: true });
  assert.equal(forcedBogus.isError, true, "force must not remap an invalid position");

  const early = await call("post_argument", { debate_id: "d1", agent_name: "Sub-B", position: "B", argument: "hi" });
  assert.equal(early.isError, true);
  assert.match(text(early), /Out-of-turn/);

  await call("post_argument", { debate_id: "d1", agent_name: "Solo", position: "A", argument: "a" });
  const mono = await call("post_argument", { debate_id: "d1", agent_name: "solo ", position: "B", argument: "b" });
  assert.equal(mono.isError, true);
  assert.match(text(mono), /MONOLOGUE BLOCKED/);

  const missing = await call("post_argument", { debate_id: "nope", agent_name: "a", position: "A", argument: "x" });
  assert.equal(missing.isError, true);
  assert.match(text(missing), /not found/);
});

test("single_agent mode allows one agent to post every position", async () => {
  const { call } = setup();
  await call("create_debate", baseDebate({ execution_mode: "single_agent" }));
  await call("post_argument", { debate_id: "d1", agent_name: "Solo", position: "A", argument: "a" });
  const res = await call("post_argument", { debate_id: "d1", agent_name: "Solo", position: "B", argument: "b" });
  assert.equal(res.isError, undefined, text(res));
});

test("word limit: warn within +15%, reject above it", async () => {
  const { call, storage } = setup();
  await call("create_debate", baseDebate({ max_words: 100 }));

  const tolerated = await call("post_argument", { debate_id: "d1", agent_name: "A1", position: "A", argument: words(115) });
  assert.equal(tolerated.isError, undefined);
  assert.match(text(tolerated), /115 words \(exceeds recommended limit of 100/);

  const rejected = await call("post_argument", { debate_id: "d1", agent_name: "B1", position: "B", argument: words(116) });
  assert.equal(rejected.isError, true);
  assert.match(text(rejected), /116 words exceeds the limit of 100 \(\+15% tolerance = 115\)/);
  assert.equal((await storage.read("d1")).turns.length, 1, "rejected turn must not be stored");

  await call("create_debate", baseDebate({ debate_id: "d2", word_limit_mode: "warn" }));
  const warned = await call("post_argument", { debate_id: "d2", agent_name: "A1", position: "A", argument: words(500) });
  assert.equal(warned.isError, undefined);
});

test("debates created before v0.5 (no word_limit_mode) only warn", async () => {
  const { call, storage } = setup();
  await storage.update("legacy", () => ({
    save: {
      debate_id: "legacy", topic: "t", status: "open", position_a: "a", position_b: "b",
      max_rounds: 1, max_words: 10, next_expected_position: "A", turns: [],
    },
  }));
  const res = await call("post_argument", { debate_id: "legacy", agent_name: "x", position: "A", argument: words(50) });
  assert.equal(res.isError, undefined, text(res));
});

test("score_turn validates scores and blocks NaN", async () => {
  const { call } = setup();
  await call("create_debate", baseDebate());
  await postTurns(call, "d1", 1);
  const base = { debate_id: "d1", turn_number: 1, technical_evidence: 7, rebuttal_strength: 7, operational_viability: 7, clarity: 7 };

  for (const [override, pattern] of [
    [{ clarity: undefined }, /'clarity' must be a number between 1 and 10/],
    [{ clarity: 11 }, /between 1 and 10/],
    [{ clarity: 0 }, /between 1 and 10/],
    [{ clarity: "abc" }, /between 1 and 10/],
    [{ turn_number: 2 }, /Turn 2 not found/],
    [{ turn_number: 1.5 }, /'turn_number' must be an integer/],
  ]) {
    const res = await call("score_turn", { ...base, ...override });
    assert.equal(res.isError, true, JSON.stringify(override));
    assert.match(text(res), pattern);
  }
  const good = await call("score_turn", { ...base, clarity: "8.5" });
  assert.equal(good.isError, undefined, text(good));
  assert.match(text(good), /scored: 7.38\/10/);
});

test("close_debate requires turns, scores and a valid winner", async () => {
  const { call } = setup();
  await call("create_debate", baseDebate());

  const empty = await call("close_debate", { debate_id: "d1", verdict: "v" });
  assert.equal(empty.isError, true);
  assert.match(text(empty), /no turns yet/);

  await postTurns(call, "d1", 2);
  const unscored = await call("close_debate", { debate_id: "d1", verdict: "v" });
  assert.equal(unscored.isError, true);
  assert.match(text(unscored), /Unscored turns remain \(Turns: 1, 2\)/);

  await scoreAll(call, "d1", 2);
  const badWinner = await call("close_debate", { debate_id: "d1", verdict: "v", winner: "C" });
  assert.equal(badWinner.isError, true);
  assert.match(text(badWinner), /Invalid winner 'C'/);

  const closed = await call("close_debate", { debate_id: "d1", verdict: "v", winner: "Draw" });
  assert.equal(closed.isError, undefined);
  const again = await call("close_debate", { debate_id: "d1", verdict: "v" });
  assert.equal(again.isError, true);
  const rescore = await call("score_turn", { debate_id: "d1", turn_number: 1, technical_evidence: 1, rebuttal_strength: 1, operational_viability: 1, clarity: 1 });
  assert.equal(rescore.isError, true, "closed debates keep their scores");

  await call("create_debate", baseDebate({ debate_id: "d2" }));
  const forced = await call("close_debate", { debate_id: "d2", verdict: "abandoned", force: true });
  assert.equal(forced.isError, undefined);
});

test("wait_for_turn returns your_turn, timeout and reports progress", async () => {
  const { call } = setup();
  await call("create_debate", baseDebate({ execution_mode: "cross_client" }));

  const mine = JSON.parse(text(await call("wait_for_turn", { debate_id: "d1", position: "a" })));
  assert.equal(mine.event, "your_turn");
  assert.equal(mine.assigned_model, "sonnet");

  const progress = [];
  const t0 = Date.now();
  const res = await call("wait_for_turn", { debate_id: "d1", position: "B", timeout_seconds: 5 }, {
    sendProgress: async (p, total) => progress.push([p, total]),
  });
  assert.equal(JSON.parse(text(res)).event, "timeout");
  assert.ok(Date.now() - t0 >= 4900);
  assert.ok(progress.length >= 3, "progress notifications keep the client from timing out");

  const bad = await call("wait_for_turn", { debate_id: "d1", position: "Q", timeout_seconds: 5 });
  assert.equal(bad.isError, true);
  assert.match(text(bad), /Position 'Q' does not exist/);
});

test("wait_for_turn wakes up when the other side posts", async () => {
  const { call } = setup();
  await call("create_debate", baseDebate({ execution_mode: "cross_client" }));
  const waiting = call("wait_for_turn", { debate_id: "d1", position: "B", timeout_seconds: 10 });
  setTimeout(() => call("post_argument", { debate_id: "d1", agent_name: "Claude-A", position: "A", argument: "go" }), 300);
  const res = JSON.parse(text(await waiting));
  assert.equal(res.event, "your_turn");
  assert.equal(res.last_turn.agent, "Claude-A");
});

test("delete_debate, list_debates and unknown tools", async () => {
  const { call } = setup();
  await call("create_debate", baseDebate());
  await call("create_debate", baseDebate({ debate_id: "d2" }));
  await postTurns(call, "d2", 1);
  await call("close_debate", { debate_id: "d2", verdict: "x", force: true });

  const open = JSON.parse(text(await call("list_debates", { status: "open" })));
  assert.deepEqual(open.map((d) => d.debate_id), ["d1"]);

  assert.equal((await call("delete_debate", { debate_id: "d1" })).isError, undefined);
  assert.equal((await call("delete_debate", { debate_id: "d1" })).isError, true);
  assert.equal((await call("read_debate", { debate_id: "d1" })).isError, true);

  const unknown = await call("nope", {});
  assert.equal(unknown.isError, true);
});

test("get_client_models detects the platform without misfiring on unrelated env vars", async () => {
  const { call } = setup({ env: { MY_CLAUDE_NOTES: "1" } });
  const res = JSON.parse(text(await call("get_client_models", {})));
  assert.equal(res.detected_platform, "antigravity");

  const { call: call2 } = setup({ clientName: "claude-ai" });
  assert.equal(JSON.parse(text(await call2("get_client_models", {}))).detected_platform, "claude");
});
