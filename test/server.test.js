// End-to-end: talks to bin/server.js over stdio with the official MCP client.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { tempDir } from "./helpers.js";

const SERVER = fileURLToPath(new URL("../bin/server.js", import.meta.url));

test("stdio server: migrates legacy data, lists tools and flags errors with isError", async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "debates.json"), JSON.stringify({ legacy: { debate_id: "legacy", topic: "old", status: "open", turns: [] } }));

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { ...process.env, ROUNDTABLE_STORAGE_PATH: dir },
    stderr: "pipe",
  });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(transport);
  try {
    assert.equal(client.getServerVersion().version, "0.5.0");
    const { tools } = await client.listTools();
    assert.equal(tools.length, 10);

    const listed = await client.callTool({ name: "list_debates", arguments: {} });
    assert.match(listed.content[0].text, /"debate_id": "legacy"/);
    assert.ok(fs.existsSync(path.join(dir, "debates.json.bak")));

    const args = {
      debate_id: "e2e", topic: "t", client_platform: "claude", execution_mode: "subagents",
      default_model: "opus", default_effort: "high", position_a: "a", position_b: "b",
    };
    const created = await client.callTool({ name: "create_debate", arguments: args });
    assert.ok(!created.isError);
    const dup = await client.callTool({ name: "create_debate", arguments: args });
    assert.equal(dup.isError, true);

    const { prompts } = await client.listPrompts();
    assert.equal(prompts[0].name, "moderate_debate");
  } finally {
    await client.close();
  }
});
