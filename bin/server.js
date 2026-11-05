#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Storage, resolveStoragePaths } from "../lib/storage.js";
import { TOOL_DEFINITIONS, createToolHandler } from "../lib/tools.js";
import { rootsFromMcp } from "../lib/export.js";
import { PLATFORM_PROFILES, VERSION, detectClientPlatform } from "../lib/core.js";

const storage = new Storage(resolveStoragePaths());

const server = new Server(
  { name: "roundtable-mcp", version: VERSION },
  { capabilities: { tools: {}, prompts: {} } }
);

function clientName() {
  try {
    return server.getClientVersion()?.name;
  } catch {
    return undefined;
  }
}

async function clientRoots() {
  if (!server.getClientCapabilities()?.roots) return [];
  try {
    const { roots } = await server.listRoots(undefined, { timeout: 3000 });
    return rootsFromMcp(roots);
  } catch {
    return [];
  }
}

const callTool = createToolHandler({ storage, getClientName: clientName, getClientRoots: clientRoots });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args = {} } = request.params;
  const progressToken = request.params._meta?.progressToken;
  const sendProgress =
    progressToken !== undefined
      ? async (progress, total, message) => {
          try {
            await extra.sendNotification({
              method: "notifications/progress",
              params: { progressToken, progress, total, message },
            });
          } catch {
            // Progress is best-effort.
          }
        }
      : undefined;
  return callTool(name, args, { signal: extra.signal, sendProgress });
});

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: "moderate_debate",
      description:
        "Prompt template to start, moderate, or participate in a structured multi-agent debate with platform-specific model, effort, and execution mode selection.",
      arguments: [
        { name: "topic", description: "Debate topic", required: false },
        { name: "position_a", description: "Position A", required: false },
        { name: "position_b", description: "Position B", required: false },
        { name: "execution_mode", description: "Execution mode: subagents, cross_client, or single_agent", required: false },
        {
          name: "model",
          description: "Model (Antigravity: inherit/pro/flash/flash_lite | Claude: inherit/opus/sonnet/haiku)",
          required: false,
        },
        { name: "effort", description: "Reasoning effort (low, medium, high)", required: false },
        { name: "rounds", description: "Number of rounds", required: false },
      ],
    },
  ],
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  if (name !== "moderate_debate") throw new Error(`Unknown prompt: ${name}`);
  const profile = PLATFORM_PROFILES[detectClientPlatform({ clientName: clientName() })];
  const rounds = args.rounds || 3;
  const hasTopic = args.topic && String(args.topic).trim() !== "" && String(args.topic) !== "undefined";
  const effortOptionsList = profile.efforts.map((e) => `'${e.id}' (${e.label})`).join(", ");

  if (!hasTopic) {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `I want to start a structured debate using the \`roundtable-mcp\` server.\n\n` +
              `Since I have not specified the parameters yet:\n` +
              `1. Call \`list_debates\` on \`roundtable-mcp\` to check if there is already an open debate to join.\n` +
              `2. Ask me (using your interactive question tool if available):\n` +
              `   - **Execution Mode (\`execution_mode\`)**: 'subagents' (spawn isolated subagents in this client), 'cross_client' (live debate between Antigravity and Claude), or 'single_agent'.\n` +
              `   - **Model**: If running in Antigravity: 'inherit', 'pro', 'flash', 'flash_lite'. If running in Claude: 'inherit', 'opus', 'sonnet', 'haiku'.\n` +
              `   - **Reasoning Effort**: ${effortOptionsList}.\n` +
              `   - **Topic and Positions** (or multiple roundtable roles).\n` +
              `3. Once I confirm, call \`create_debate\` passing \`client_platform\`, \`execution_mode\`, \`default_model\`, and \`default_effort\`. In 'subagents' mode, spawn an isolated subagent per position with a distinct \`agent_name\`. Score every turn with \`score_turn\` before calling \`close_debate\`.`,
          },
        },
      ],
    };
  }

  const mode = args.execution_mode || "subagents";
  const model = args.model || "inherit";
  const effort = args.effort || "high";
  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Start a structured debate using the roundtable-mcp tools.\n` +
            `Topic: ${args.topic}\n` +
            `Position A: ${args.position_a || "Pro / Option A"}\n` +
            `Position B: ${args.position_b || "Con / Option B"}\n` +
            `Execution Mode: ${mode}\nModel: ${model}\nEffort: ${effort}\nRounds: ${rounds}\n\n` +
            `Instructions:\n` +
            `1. Call create_debate with client_platform ('claude' or 'antigravity'), execution_mode="${mode}", default_model="${model}", and default_effort="${effort}".\n` +
            `2. If execution_mode is 'subagents', spawn isolated subagents per position with distinct agent_name values using the configured model and effort directive.\n` +
            `3. Score each turn objectively using score_turn.\n` +
            `4. After ${rounds} rounds, call close_debate with a final verdict and export the ADR via export_debate.`,
        },
      },
    ],
  };
});

async function main() {
  try {
    const report = await storage.migrateLegacy();
    if (report.migrated.length || report.skipped.length) {
      console.error(
        `[roundtable-mcp] Migrated ${report.migrated.length} debate(s) to ${storage.paths.debatesDir}; ` +
          `old file kept as ${report.backup}.` +
          (report.skipped.length ? ` Skipped: ${JSON.stringify(report.skipped)}` : "")
      );
    }
  } catch (error) {
    // Never block startup; the legacy file is left untouched.
    console.error(`[roundtable-mcp] Migration skipped: ${error.message}`);
  }
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
