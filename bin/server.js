#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const DEFAULT_STORAGE_DIR = path.join(os.homedir(), ".roundtable_mcp");
const STORAGE_FILE =
  process.env.ROUNDTABLE_STORAGE_PATH ||
  path.join(DEFAULT_STORAGE_DIR, "debates.json");

function loadDebates() {
  if (!fs.existsSync(STORAGE_FILE)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(STORAGE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveDebates(data) {
  const dir = path.dirname(STORAGE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const tempFile = `${STORAGE_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tempFile, STORAGE_FILE);
}

const server = new Server(
  {
    name: "roundtable-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
      prompts: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_debate",
        description:
          "Create a new debate session with a topic, two opposing positions, and a maximum number of rounds.",
        inputSchema: {
          type: "object",
          properties: {
            debate_id: {
              type: "string",
              description: "Unique identifier for the debate session",
            },
            topic: {
              type: "string",
              description: "The topic or question to be debated",
            },
            position_a: {
              type: "string",
              description: "Description of Position A",
            },
            position_b: {
              type: "string",
              description: "Description of Position B",
            },
            max_rounds: {
              type: "number",
              description: "Maximum number of rounds (each round has 2 turns)",
              default: 3,
            },
            rules: {
              type: "string",
              description: "Debate rules and guidelines",
              default:
                "Be concise, address the previous turn directly, and provide technical evidence.",
            },
          },
          required: ["debate_id", "topic", "position_a", "position_b"],
        },
      },
      {
        name: "list_debates",
        description:
          "List available debates. Filter by status: 'all', 'open', or 'closed'.",
        inputSchema: {
          type: "object",
          properties: {
            status: {
              type: "string",
              description: "Filter by status ('all', 'open', 'closed')",
              default: "all",
            },
          },
        },
      },
      {
        name: "read_debate",
        description:
          "Read the full state and transcript of a debate, including whose turn is next.",
        inputSchema: {
          type: "object",
          properties: {
            debate_id: {
              type: "string",
              description: "Identifier of the debate to read",
            },
          },
          required: ["debate_id"],
        },
      },
      {
        name: "post_argument",
        description:
          "Post an argument or rebuttal to an open debate. Position should be 'A' or 'B'.",
        inputSchema: {
          type: "object",
          properties: {
            debate_id: {
              type: "string",
              description: "Identifier of the debate",
            },
            agent_name: {
              type: "string",
              description: "Name of the participating agent or client",
            },
            position: {
              type: "string",
              description: "Position defended ('A' or 'B')",
            },
            argument: {
              type: "string",
              description: "The argument or rebuttal content",
            },
          },
          required: ["debate_id", "agent_name", "position", "argument"],
        },
      },
      {
        name: "close_debate",
        description:
          "Close a debate and record the final synthesis, conclusion, or winning position ('A', 'B', or 'synthesis').",
        inputSchema: {
          type: "object",
          properties: {
            debate_id: {
              type: "string",
              description: "Identifier of the debate to close",
            },
            verdict: {
              type: "string",
              description: "Final synthesis and reasoning",
            },
            winner: {
              type: "string",
              description: "Winning position ('A', 'B', or 'synthesis')",
              default: "synthesis",
            },
          },
          required: ["debate_id", "verdict"],
        },
      },
      {
        name: "delete_debate",
        description: "Delete a debate session from storage.",
        inputSchema: {
          type: "object",
          properties: {
            debate_id: {
              type: "string",
              description: "Identifier of the debate to delete",
            },
          },
          required: ["debate_id"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const debates = loadDebates();

  if (name === "create_debate") {
    const {
      debate_id,
      topic,
      position_a,
      position_b,
      max_rounds = 3,
      rules = "Be concise, address the previous turn directly, and provide technical evidence.",
    } = args;

    debates[debate_id] = {
      debate_id,
      topic,
      position_a,
      position_b,
      max_rounds,
      rules,
      status: "open",
      created_at: new Date().toISOString(),
      next_expected_position: "A",
      turns: [],
      verdict: null,
      winner: null,
    };
    saveDebates(debates);

    return {
      content: [
        {
          type: "text",
          text:
            `Debate '${debate_id}' created.\n` +
            `Topic: ${topic}\n` +
            `Position A: ${position_a}\n` +
            `Position B: ${position_b}\n` +
            `Max rounds: ${max_rounds} (${max_rounds * 2} total turns)\n` +
            `Next turn: Position A`,
        },
      ],
    };
  }

  if (name === "list_debates") {
    const status = args.status || "all";
    const keys = Object.keys(debates);
    if (keys.length === 0) {
      return { content: [{ type: "text", text: "No debates found." }] };
    }
    const filtered = [];
    for (const [dId, info] of Object.entries(debates)) {
      if (status !== "all" && info.status !== status) continue;
      filtered.push({
        debate_id: dId,
        topic: info.topic,
        status: info.status,
        turns_count: (info.turns || []).length,
        max_turns: (info.max_rounds || 3) * 2,
        next_expected_position: info.next_expected_position,
      });
    }
    return {
      content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }],
    };
  }

  if (name === "read_debate") {
    const { debate_id } = args;
    if (!debates[debate_id]) {
      return {
        content: [
          {
            type: "text",
            text: `Debate '${debate_id}' not found. Available debates: ${JSON.stringify(
              Object.keys(debates)
            )}`,
          },
        ],
      };
    }
    return {
      content: [
        { type: "text", text: JSON.stringify(debates[debate_id], null, 2) },
      ],
    };
  }

  if (name === "post_argument") {
    const { debate_id, agent_name, position, argument } = args;
    if (!debates[debate_id]) {
      return {
        content: [{ type: "text", text: `Debate '${debate_id}' not found.` }],
      };
    }
    const debate = debates[debate_id];
    if (debate.status !== "open") {
      return {
        content: [
          { type: "text", text: `Debate '${debate_id}' is already closed.` },
        ],
      };
    }

    const turns = debate.turns || [];
    const maxTurns = (debate.max_rounds || 3) * 2;
    if (turns.length >= maxTurns) {
      return {
        content: [
          {
            type: "text",
            text: `Debate '${debate_id}' has reached the maximum of ${maxTurns} turns. Please call close_debate to record a final verdict.`,
          },
        ],
      };
    }

    let normalizedPos = String(position || "")
      .trim()
      .toUpperCase();
    if (normalizedPos !== "A" && normalizedPos !== "B") {
      normalizedPos = debate.next_expected_position || "A";
    }

    const turnNumber = turns.length + 1;
    const currentRound = Math.floor((turnNumber + 1) / 2);

    turns.push({
      turn: turnNumber,
      round: currentRound,
      agent: agent_name,
      position: normalizedPos,
      argument,
      timestamp: new Date().toISOString(),
    });

    debate.turns = turns;
    debate.next_expected_position = normalizedPos === "A" ? "B" : "A";
    saveDebates(debates);

    const remaining = maxTurns - turnNumber;
    return {
      content: [
        {
          type: "text",
          text: `Turn ${turnNumber} (Round ${currentRound}) recorded by ${agent_name} [Position ${normalizedPos}]. Remaining turns: ${remaining}. Next expected position: ${debate.next_expected_position}.`,
        },
      ],
    };
  }

  if (name === "close_debate") {
    const { debate_id, verdict, winner = "synthesis" } = args;
    if (!debates[debate_id]) {
      return {
        content: [{ type: "text", text: `Debate '${debate_id}' not found.` }],
      };
    }
    const debate = debates[debate_id];
    debate.status = "closed";
    debate.verdict = verdict;
    debate.winner = winner;
    debate.closed_at = new Date().toISOString();
    saveDebates(debates);

    return {
      content: [
        {
          type: "text",
          text: `Debate '${debate_id}' closed. Winner/Outcome: ${winner}.`,
        },
      ],
    };
  }

  if (name === "delete_debate") {
    const { debate_id } = args;
    if (!debates[debate_id]) {
      return {
        content: [{ type: "text", text: `Debate '${debate_id}' not found.` }],
      };
    }
    delete debates[debate_id];
    saveDebates(debates);
    return {
      content: [{ type: "text", text: `Debate '${debate_id}' deleted.` }],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: "moderate_debate",
        description:
          "Prompt template to instruct an agent how to run or participate in a structured debate.",
        arguments: [
          { name: "topic", description: "Debate topic", required: true },
          { name: "position_a", description: "Position A", required: true },
          { name: "position_b", description: "Position B", required: true },
          { name: "rounds", description: "Number of rounds", required: false },
        ],
      },
    ],
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  if (name !== "moderate_debate") {
    throw new Error(`Unknown prompt: ${name}`);
  }
  const rounds = args.rounds || 3;
  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Start a structured debate using the roundtable-mcp tools.\n` +
            `Topic: ${args.topic}\n` +
            `Position A: ${args.position_a}\n` +
            `Position B: ${args.position_b}\n` +
            `Rounds: ${rounds}\n\n` +
            `Instructions:\n` +
            `1. Call create_debate with a descriptive debate_id.\n` +
            `2. Alternate turns between Position A and Position B using post_argument (or spawn two subagents to represent each position).\n` +
            `3. After ${rounds} rounds, evaluate all arguments objectively and call close_debate with a final verdict.`,
        },
      },
    ],
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
