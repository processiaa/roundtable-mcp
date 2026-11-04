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
  const tempFile = `${STORAGE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tempFile, STORAGE_FILE);
}

function normalizeParticipants(positionA, positionB, participantsInput) {
  if (Array.isArray(participantsInput) && participantsInput.length >= 2) {
    return participantsInput.map((item, idx) => {
      const defaultId = String.fromCharCode(65 + idx);
      if (typeof item === "string") {
        return { id: defaultId, role: item };
      }
      return {
        id: String(item.id || defaultId).trim().toUpperCase(),
        role: String(item.role || item.position || `Position ${defaultId}`),
      };
    });
  }
  return [
    { id: "A", role: positionA || "Position A" },
    { id: "B", role: positionB || "Position B" },
  ];
}

function computeScoreboard(debate) {
  const board = {};
  const participants = debate.participants || [
    { id: "A", role: debate.position_a || "Position A" },
    { id: "B", role: debate.position_b || "Position B" },
  ];
  for (const p of participants) {
    board[p.id] = {
      role: p.role,
      scored_turns: 0,
      total_points: 0,
      average_score: 0,
    };
  }
  for (const turn of debate.turns || []) {
    if (turn.score && typeof turn.score.average === "number") {
      const pos = turn.position;
      if (!board[pos]) {
        board[pos] = {
          role: pos,
          scored_turns: 0,
          total_points: 0,
          average_score: 0,
        };
      }
      board[pos].scored_turns += 1;
      board[pos].total_points = Number(
        (board[pos].total_points + turn.score.average).toFixed(2)
      );
      board[pos].average_score = Number(
        (board[pos].total_points / board[pos].scored_turns).toFixed(2)
      );
    }
  }
  return board;
}

function formatDebateMarkdown(debate, format = "adr") {
  const participants = debate.participants || [
    { id: "A", role: debate.position_a || "Position A" },
    { id: "B", role: debate.position_b || "Position B" },
  ];
  const lines = [];

  if (format === "adr") {
    lines.push(`# ADR: ${debate.topic}`);
    lines.push("");
    lines.push(`- **Debate ID:** \`${debate.debate_id}\``);
    lines.push(`- **Status:** ${debate.status === "closed" ? "Accepted / Closed" : "Proposed / Open"}`);
    lines.push(`- **Created At:** ${debate.created_at}`);
    if (debate.closed_at) {
      lines.push(`- **Decided At:** ${debate.closed_at}`);
    }
    if (debate.winner) {
      lines.push(`- **Selected Outcome:** ${debate.winner}`);
    }
    lines.push("");
    lines.push("## 1. Context and Problem Statement");
    lines.push("");
    lines.push(`Topic evaluated: **${debate.topic}**`);
    lines.push("");
    lines.push(`Rules applied: ${debate.rules || "Standard technical debate rules."}`);
    lines.push("");
    lines.push("## 2. Considered Options (Positions)");
    lines.push("");
    for (const p of participants) {
      lines.push(`- **Position ${p.id}:** ${p.role}`);
    }
    lines.push("");
    lines.push("## 3. Deliberation and Key Arguments");
    lines.push("");
    for (const turn of debate.turns || []) {
      lines.push(
        `### Round ${turn.round} - Turn ${turn.turn}: ${turn.agent} (Position ${turn.position})`
      );
      lines.push("");
      lines.push(turn.argument);
      if (turn.score) {
        lines.push("");
        lines.push(
          `*Score (${turn.score.judge}): ${turn.score.average}/10 ` +
            `(Evidence: ${turn.score.technical_evidence}, Rebuttal: ${turn.score.rebuttal_strength}, ` +
            `Viability: ${turn.score.operational_viability}, Clarity: ${turn.score.clarity})*`
        );
        if (turn.score.notes) {
          lines.push(`*Judge Notes: ${turn.score.notes}*`);
        }
      }
      lines.push("");
    }
    if (debate.scoreboard) {
      lines.push("## 4. Evaluation Scoreboard");
      lines.push("");
      lines.push("| Position | Role | Scored Turns | Total Points | Average Score (1-10) |");
      lines.push("| :--- | :--- | :---: | :---: | :---: |");
      for (const [posId, stats] of Object.entries(debate.scoreboard)) {
        lines.push(
          `| ${posId} | ${stats.role} | ${stats.scored_turns} | ${stats.total_points} | ${stats.average_score} |`
        );
      }
      lines.push("");
    }
    lines.push("## 5. Decision Outcome and Verdict");
    lines.push("");
    lines.push(`**Outcome:** ${debate.winner || "Pending"}`);
    lines.push("");
    lines.push(debate.verdict || "Debate is still open; no final verdict recorded yet.");
    lines.push("");
  } else {
    lines.push(`# Debate Transcript: ${debate.topic}`);
    lines.push("");
    lines.push(`- **ID:** \`${debate.debate_id}\``);
    lines.push(`- **Status:** ${debate.status}`);
    lines.push(`- **Rounds:** ${debate.max_rounds}`);
    lines.push("");
    lines.push("## Positions");
    lines.push("");
    for (const p of participants) {
      lines.push(`- **${p.id}:** ${p.role}`);
    }
    lines.push("");
    lines.push("## Turns");
    lines.push("");
    for (const turn of debate.turns || []) {
      lines.push(
        `### [Round ${turn.round} | Turn ${turn.turn}] ${turn.agent} (Position ${turn.position})`
      );
      lines.push("");
      lines.push(turn.argument);
      lines.push("");
    }
    if (debate.verdict) {
      lines.push("## Verdict");
      lines.push("");
      lines.push(`**Winner / Synthesis:** ${debate.winner}`);
      lines.push("");
      lines.push(debate.verdict);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const server = new Server(
  {
    name: "roundtable-mcp",
    version: "0.2.0",
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
          "Create a new debate or N-participant roundtable session with a topic, positions/participants, and rules.",
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
              description: "Description of Position A (optional if participants is provided)",
            },
            position_b: {
              type: "string",
              description: "Description of Position B (optional if participants is provided)",
            },
            participants: {
              type: "array",
              description:
                "Optional list of 2 or more participants for multi-role roundtables (e.g. [{'id': 'A', 'role': 'Cloud Architect'}, {'id': 'B', 'role': 'Security Engineer'}, {'id': 'C', 'role': 'FinOps'}])",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  role: { type: "string" },
                },
              },
            },
            max_rounds: {
              type: "number",
              description: "Maximum number of rounds",
              default: 3,
            },
            max_words: {
              type: "number",
              description: "Maximum recommended words per argument",
              default: 200,
            },
            strict_turn_order: {
              type: "boolean",
              description: "Reject out-of-turn arguments automatically",
              default: true,
            },
            rules: {
              type: "string",
              description: "Debate rules and guidelines",
              default:
                "Be concise, address the previous turn directly, and provide technical evidence.",
            },
          },
          required: ["debate_id", "topic"],
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
          "Read the full state, scoreboard, and transcript of a debate, including whose turn is next.",
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
          "Post an argument or rebuttal to an open debate. Enforces turn order unless force=true.",
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
              description: "Position ID defended (e.g. 'A', 'B', 'C')",
            },
            argument: {
              type: "string",
              description: "The argument or rebuttal content",
            },
            force: {
              type: "boolean",
              description: "Bypass strict turn order check if true",
              default: false,
            },
          },
          required: ["debate_id", "agent_name", "position", "argument"],
        },
      },
      {
        name: "wait_for_turn",
        description:
          "Wait until it is the specified position's turn in an open debate (useful when two separate AI clients are debating each other live).",
        inputSchema: {
          type: "object",
          properties: {
            debate_id: {
              type: "string",
              description: "Identifier of the debate",
            },
            position: {
              type: "string",
              description: "Position ID waiting for its turn (e.g. 'A' or 'B')",
            },
            timeout_seconds: {
              type: "number",
              description: "Maximum seconds to wait before returning",
              default: 90,
            },
          },
          required: ["debate_id", "position"],
        },
      },
      {
        name: "score_turn",
        description:
          "Score a specific turn using a structured rubric (1-10) and update the debate scoreboard.",
        inputSchema: {
          type: "object",
          properties: {
            debate_id: {
              type: "string",
              description: "Identifier of the debate",
            },
            turn_number: {
              type: "number",
              description: "Turn number to score (1-based)",
            },
            judge_name: {
              type: "string",
              description: "Name of the judge agent",
              default: "Judge",
            },
            technical_evidence: {
              type: "number",
              description: "Score for technical evidence and rigor (1-10)",
            },
            rebuttal_strength: {
              type: "number",
              description: "Score for directly addressing opponent points (1-10)",
            },
            operational_viability: {
              type: "number",
              description: "Score for practical real-world viability (1-10)",
            },
            clarity: {
              type: "number",
              description: "Score for clarity and conciseness (1-10)",
            },
            notes: {
              type: "string",
              description: "Brief justification for the score",
            },
          },
          required: [
            "debate_id",
            "turn_number",
            "technical_evidence",
            "rebuttal_strength",
            "operational_viability",
            "clarity",
          ],
        },
      },
      {
        name: "export_debate",
        description:
          "Export a debate as a clean Markdown transcript or Architecture Decision Record (ADR), optionally saving it to a file.",
        inputSchema: {
          type: "object",
          properties: {
            debate_id: {
              type: "string",
              description: "Identifier of the debate to export",
            },
            format: {
              type: "string",
              description: "Export format: 'adr' or 'markdown'",
              default: "adr",
            },
            output_path: {
              type: "string",
              description: "Optional absolute or relative path to save the exported .md file",
            },
          },
          required: ["debate_id"],
        },
      },
      {
        name: "close_debate",
        description:
          "Close a debate and record the final synthesis, conclusion, or winning position.",
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
              description: "Winning position ('A', 'B', 'C', or 'synthesis')",
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

  if (name === "create_debate") {
    const debates = loadDebates();
    const {
      debate_id,
      topic,
      position_a,
      position_b,
      participants: rawParticipants,
      max_rounds = 3,
      max_words = 200,
      strict_turn_order = true,
      rules = "Be concise, address the previous turn directly, and provide technical evidence.",
    } = args;

    const participants = normalizeParticipants(
      position_a,
      position_b,
      rawParticipants
    );

    debates[debate_id] = {
      debate_id,
      topic,
      position_a: participants[0]?.role || position_a || "Position A",
      position_b: participants[1]?.role || position_b || "Position B",
      participants,
      max_rounds,
      max_words,
      strict_turn_order,
      rules,
      status: "open",
      created_at: new Date().toISOString(),
      next_expected_position: participants[0].id,
      turns: [],
      scoreboard: computeScoreboard({ participants, turns: [] }),
      verdict: null,
      winner: null,
    };
    saveDebates(debates);

    const participantSummary = participants
      .map((p) => `Position ${p.id}: ${p.role}`)
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text:
            `Debate '${debate_id}' created.\n` +
            `Topic: ${topic}\n` +
            `${participantSummary}\n` +
            `Max rounds: ${max_rounds} (${max_rounds * participants.length} total turns)\n` +
            `Word limit per turn: ${max_words}\n` +
            `Strict turn order: ${strict_turn_order}\n` +
            `Next turn: Position ${participants[0].id}`,
        },
      ],
    };
  }

  if (name === "list_debates") {
    const debates = loadDebates();
    const status = args.status || "all";
    const keys = Object.keys(debates);
    if (keys.length === 0) {
      return { content: [{ type: "text", text: "No debates found." }] };
    }
    const filtered = [];
    for (const [dId, info] of Object.entries(debates)) {
      if (status !== "all" && info.status !== status) continue;
      const numParticipants = (info.participants || []).length || 2;
      filtered.push({
        debate_id: dId,
        topic: info.topic,
        status: info.status,
        turns_count: (info.turns || []).length,
        max_turns: (info.max_rounds || 3) * numParticipants,
        next_expected_position: info.next_expected_position,
        winner: info.winner || null,
      });
    }
    return {
      content: [{ type: "text", text: JSON.stringify(filtered, null, 2) }],
    };
  }

  if (name === "read_debate") {
    const debates = loadDebates();
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
    const debates = loadDebates();
    const {
      debate_id,
      agent_name,
      position,
      argument,
      force = false,
    } = args;

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

    const participants = debate.participants || [
      { id: "A", role: debate.position_a || "Position A" },
      { id: "B", role: debate.position_b || "Position B" },
    ];
    const turns = debate.turns || [];
    const maxTurns = (debate.max_rounds || 3) * participants.length;

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

    const requestedPos = String(position || "")
      .trim()
      .toUpperCase();
    const expectedPos = String(debate.next_expected_position || "A")
      .trim()
      .toUpperCase();

    if (debate.strict_turn_order !== false && !force && requestedPos !== expectedPos) {
      return {
        content: [
          {
            type: "text",
            text:
              `Out-of-turn submission rejected: Position '${requestedPos}' attempted to post, ` +
              `but next_expected_position is '${expectedPos}'. ` +
              `Wait for Position '${expectedPos}' to complete its turn (or use wait_for_turn).`,
          },
        ],
      };
    }

    const validIds = participants.map((p) => p.id.toUpperCase());
    const normalizedPos = validIds.includes(requestedPos)
      ? requestedPos
      : expectedPos;

    const wordCount = String(argument || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    const maxWords = debate.max_words || 200;
    const wordWarning =
      wordCount > maxWords
        ? ` Note: Argument has ${wordCount} words (exceeds recommended limit of ${maxWords} words).`
        : "";

    const turnNumber = turns.length + 1;
    const currentRound = Math.floor((turnNumber - 1) / participants.length) + 1;

    turns.push({
      turn: turnNumber,
      round: currentRound,
      agent: agent_name,
      position: normalizedPos,
      word_count: wordCount,
      argument,
      timestamp: new Date().toISOString(),
    });

    const currentIdx = validIds.indexOf(normalizedPos);
    const nextIdx = (currentIdx + 1) % validIds.length;
    debate.turns = turns;
    debate.next_expected_position = validIds[nextIdx];
    saveDebates(debates);

    const remaining = maxTurns - turnNumber;
    return {
      content: [
        {
          type: "text",
          text:
            `Turn ${turnNumber} (Round ${currentRound}) recorded by ${agent_name} [Position ${normalizedPos}, ${wordCount} words]. ` +
            `Remaining turns: ${remaining}. Next expected position: ${debate.next_expected_position}.${wordWarning}`,
        },
      ],
    };
  }

  if (name === "wait_for_turn") {
    const {
      debate_id,
      position,
      timeout_seconds = 90,
    } = args;
    const targetPos = String(position || "")
      .trim()
      .toUpperCase();
    const deadline = Date.now() + Math.min(Math.max(timeout_seconds, 5), 300) * 1000;

    while (Date.now() < deadline) {
      const debates = loadDebates();
      if (!debates[debate_id]) {
        return {
          content: [{ type: "text", text: `Debate '${debate_id}' not found.` }],
        };
      }
      const debate = debates[debate_id];
      const participants = debate.participants || [
        { id: "A", role: debate.position_a },
        { id: "B", role: debate.position_b },
      ];
      const maxTurns = (debate.max_rounds || 3) * participants.length;
      const turns = debate.turns || [];

      if (debate.status !== "open") {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  event: "debate_closed",
                  status: debate.status,
                  winner: debate.winner,
                  verdict: debate.verdict,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (turns.length >= maxTurns) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  event: "max_turns_reached",
                  turns_count: turns.length,
                  max_turns: maxTurns,
                  last_turn: turns[turns.length - 1] || null,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (String(debate.next_expected_position).toUpperCase() === targetPos) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  event: "your_turn",
                  debate_id,
                  your_position: targetPos,
                  turns_completed: turns.length,
                  max_turns: maxTurns,
                  last_turn: turns[turns.length - 1] || null,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      await sleep(1500);
    }

    const debates = loadDebates();
    const current = debates[debate_id] || {};
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              event: "timeout",
              message: `Timed out after ${timeout_seconds}s waiting for Position ${targetPos}.`,
              next_expected_position: current.next_expected_position || null,
              turns_completed: (current.turns || []).length,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  if (name === "score_turn") {
    const debates = loadDebates();
    const {
      debate_id,
      turn_number,
      judge_name = "Judge",
      technical_evidence,
      rebuttal_strength,
      operational_viability,
      clarity,
      notes = "",
    } = args;

    if (!debates[debate_id]) {
      return {
        content: [{ type: "text", text: `Debate '${debate_id}' not found.` }],
      };
    }
    const debate = debates[debate_id];
    const turn = (debate.turns || []).find((t) => t.turn === turn_number);
    if (!turn) {
      return {
        content: [
          {
            type: "text",
            text: `Turn ${turn_number} not found in debate '${debate_id}'.`,
          },
        ],
      };
    }

    const average = Number(
      (
        (Number(technical_evidence) +
          Number(rebuttal_strength) +
          Number(operational_viability) +
          Number(clarity)) /
        4
      ).toFixed(2)
    );

    turn.score = {
      judge: judge_name,
      technical_evidence: Number(technical_evidence),
      rebuttal_strength: Number(rebuttal_strength),
      operational_viability: Number(operational_viability),
      clarity: Number(clarity),
      average,
      notes,
      scored_at: new Date().toISOString(),
    };

    debate.scoreboard = computeScoreboard(debate);
    saveDebates(debates);

    return {
      content: [
        {
          type: "text",
          text:
            `Turn ${turn_number} (${turn.agent}, Position ${turn.position}) scored: ${average}/10.\n` +
            `Updated Scoreboard:\n${JSON.stringify(debate.scoreboard, null, 2)}`,
        },
      ],
    };
  }

  if (name === "export_debate") {
    const debates = loadDebates();
    const { debate_id, format = "adr", output_path } = args;
    if (!debates[debate_id]) {
      return {
        content: [{ type: "text", text: `Debate '${debate_id}' not found.` }],
      };
    }

    const markdown = formatDebateMarkdown(debates[debate_id], format);
    if (output_path) {
      const resolved = path.resolve(output_path);
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, markdown, "utf-8");
      return {
        content: [
          {
            type: "text",
            text: `Debate '${debate_id}' exported (${format}) to ${resolved}\n\n${markdown}`,
          },
        ],
      };
    }

    return {
      content: [{ type: "text", text: markdown }],
    };
  }

  if (name === "close_debate") {
    const debates = loadDebates();
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
    debate.scoreboard = computeScoreboard(debate);
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
    const debates = loadDebates();
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
          "Prompt template to start, moderate, or participate in a structured multi-agent debate.",
        arguments: [
          { name: "topic", description: "Debate topic", required: false },
          { name: "position_a", description: "Position A", required: false },
          { name: "position_b", description: "Position B", required: false },
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
  const hasTopic =
    args.topic &&
    String(args.topic).trim() !== "" &&
    String(args.topic) !== "undefined";

  if (!hasTopic) {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "I want to start a structured debate using the `roundtable-mcp` server.\n\n" +
              "Since I have not specified the topic or positions yet:\n" +
              "1. First call `list_debates` on `roundtable-mcp` to check if there is already an open debate to join.\n" +
              "2. Ask me what topic and positions (or multiple roundtable roles) I want to debate, and whether I want to run it automatically here with subagents or across different AI clients using `wait_for_turn`.\n" +
              "3. Once I confirm, create the debate with `create_debate`, run the rounds, score the turns with `score_turn`, close with `close_debate`, and offer to export an ADR using `export_debate`.",
          },
        },
      ],
    };
  }

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
            `Rounds: ${rounds}\n\n` +
            `Instructions:\n` +
            `1. Call create_debate with a descriptive debate_id.\n` +
            `2. Alternate turns between positions using post_argument (or spawn subagents to represent each position).\n` +
            `3. Score each turn objectively using score_turn.\n` +
            `4. After ${rounds} rounds, call close_debate with a final verdict and export the result as an ADR using export_debate.`,
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
