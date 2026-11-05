// Child process used by concurrency.test.js: posts N arguments as fast as it can.
// argv: storageDir debateId agentName count startAt
import { Storage, resolveStoragePaths } from "../../lib/storage.js";
import { createToolHandler } from "../../lib/tools.js";

const [storageDir, debateId, agent, count, startAt] = process.argv.slice(2);
// `node --test` also loads files under test/; do nothing when run without arguments.
if (!count) process.exit(0);
const env = { ROUNDTABLE_STORAGE_PATH: storageDir };
const storage = new Storage(resolveStoragePaths(env), { lockTimeoutMs: 20000 });
const call = createToolHandler({ storage, env });

// Start all workers at the same instant to maximise contention.
while (Date.now() < Number(startAt || 0)) await new Promise((r) => setTimeout(r, 1));

const failures = [];
for (let i = 0; i < Number(count); i++) {
  const res = await call("post_argument", {
    debate_id: debateId,
    agent_name: agent,
    position: i % 2 === 0 ? "A" : "B",
    argument: `${agent} #${i}`,
  });
  if (res.isError) failures.push(res.content[0].text);
}
process.stdout.write(JSON.stringify({ failures }));
