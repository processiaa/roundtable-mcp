import { fail } from "./errors.js";

export const VERSION = "0.5.0";

export const EXECUTION_MODES = ["subagents", "cross_client", "single_agent"];
export const EFFORTS = ["high", "medium", "low"];
export const WORD_LIMIT_MODES = ["reject", "warn"];
/** Arguments up to max_words * (1 + tolerance) only get a warning in "reject" mode. */
export const WORD_LIMIT_TOLERANCE_PCT = 15;

/** Integer math on purpose: 100 * 1.15 is 114.99999999999999 in floating point. */
export function hardWordLimit(maxWords) {
  return Math.floor((maxWords * (100 + WORD_LIMIT_TOLERANCE_PCT)) / 100);
}
export const SCORE_CRITERIA = [
  "technical_evidence",
  "rebuttal_strength",
  "operational_viability",
  "clarity",
];

export const PLATFORM_PROFILES = {
  antigravity: {
    platform: "antigravity",
    display_name: "Google Antigravity",
    subagent_tool: "invoke_subagent (parameter Model: 'inherit' | 'pro' | 'flash' | 'flash_lite')",
    models: [
      { id: "inherit", label: "Inherit (Usar el modelo actual de la sesion)" },
      { id: "pro", label: "Pro (Maximo razonamiento arquitectonico)" },
      { id: "flash", label: "Flash (Balance entre velocidad y capacidad)" },
      { id: "flash_lite", label: "Flash Lite (Ultraligero y rapido)" },
    ],
    efforts: [
      {
        id: "high",
        label: "High (Analisis exhaustivo, casos borde y evidencia profunda)",
        directive:
          "EFFORT=HIGH: Perform deep step-by-step technical analysis, evaluate production edge cases, failure modes, and concrete architectural trade-offs before formulating your argument.",
      },
      {
        id: "medium",
        label: "Medium (Balanceado, directo al punto con soporte tecnico)",
        directive:
          "EFFORT=MEDIUM: Provide a balanced, well-structured technical argument directly addressing the opponent's points.",
      },
      {
        id: "low",
        label: "Low (Sintetico y rapido, enfocado en ideas clave)",
        directive:
          "EFFORT=LOW: Be brief and direct, focusing only on the top 2 core arguments without extended deliberation.",
      },
    ],
  },
  claude: {
    platform: "claude",
    display_name: "Anthropic Claude",
    subagent_tool: "Task / Agent tool (parameter model: 'opus' | 'sonnet' | 'haiku')",
    models: [
      { id: "inherit", label: "Inherit (Usar el modelo actual de la sesion)" },
      { id: "opus", label: "Claude Opus (Maximo razonamiento complejo)" },
      { id: "sonnet", label: "Claude Sonnet (Balance ideal velocidad/calidad)" },
      { id: "haiku", label: "Claude Haiku (Rapido y ligero)" },
    ],
    efforts: [
      {
        id: "high",
        label: "High (Ultrathink - Razonamiento extendido al maximo)",
        directive:
          "EFFORT=HIGH (ultrathink): Engage maximum extended thinking, stress-test every assumption, evaluate production failure modes, and build an airtight technical rebuttal.",
      },
      {
        id: "medium",
        label: "Medium (Think - Razonamiento estandar estructurado)",
        directive:
          "EFFORT=MEDIUM (think): Think carefully through the opponent's points and provide a rigorous, structured counter-argument.",
      },
      {
        id: "low",
        label: "Low (Respuesta directa sin pensamiento extendido)",
        directive: "EFFORT=LOW: Respond concisely and directly with the primary technical arguments.",
      },
    ],
  },
};

export const PLATFORMS = Object.keys(PLATFORM_PROFILES);

// ------------------------------------------------------------ platform

function platformFromText(text) {
  const clean = String(text || "").trim().toLowerCase();
  if (!clean) return null;
  if (clean.includes("claude") || clean.includes("anthropic")) return "claude";
  if (clean.includes("antigravity") || clean.includes("agy") || clean.includes("gemini")) {
    return "antigravity";
  }
  return null;
}

/**
 * Explicit value > MCP clientInfo.name > well-known env vars > "antigravity".
 * Only specific env vars are checked (v0.4 matched any variable containing
 * "CLAUDE", which misfired on unrelated tooling).
 */
export function detectClientPlatform({ explicit, clientName, env = process.env } = {}) {
  const fromExplicit = platformFromText(explicit);
  if (fromExplicit) return fromExplicit;
  const fromClient = platformFromText(clientName);
  if (fromClient) return fromClient;
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT || env.CLAUDE_ENTRYPOINT) return "claude";
  if (env.ANTIGRAVITY_CLI_ALIAS || env.AGY_ACCOUNT) return "antigravity";
  return "antigravity";
}

export function getEffortDirective(platform, effortId) {
  const profile = PLATFORM_PROFILES[platform] || PLATFORM_PROFILES.antigravity;
  const found = profile.efforts.find((e) => e.id === String(effortId || "high").toLowerCase());
  return found ? found.directive : profile.efforts[0].directive;
}

// ---------------------------------------------------------- validation

export function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    fail("INVALID_ARGUMENT", `'${field}' is required and must be a non-empty string.`);
  }
  return value.trim();
}

export function requireEnum(value, field, allowed, { optional = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (optional) return undefined;
    fail("INVALID_ARGUMENT", `'${field}' is required. Allowed values: ${allowed.join(", ")}.`);
  }
  const clean = String(value).trim().toLowerCase();
  if (!allowed.includes(clean)) {
    fail("INVALID_ARGUMENT", `Invalid ${field} '${value}'. Allowed values: ${allowed.join(", ")}.`);
  }
  return clean;
}

export function requireInt(value, field, { min, max, fallback } = {}) {
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) return fallback;
    fail("INVALID_ARGUMENT", `'${field}' is required.`);
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    fail("INVALID_ARGUMENT", `'${field}' must be an integer between ${min} and ${max} (got ${JSON.stringify(value)}).`);
  }
  return n;
}

export function requireScore(value, field) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1 || n > 10) {
    fail("INVALID_SCORE", `'${field}' must be a number between 1 and 10 (got ${JSON.stringify(value)}).`);
  }
  return n;
}

export function validateModel(platform, model, field) {
  const allowed = PLATFORM_PROFILES[platform].models.map((m) => m.id);
  return requireEnum(model, field, allowed);
}

export function normalizeParticipants({
  positionA,
  positionB,
  participants,
  platform,
  defaultModel,
  defaultEffort,
}) {
  let list;
  if (participants !== undefined && participants !== null) {
    if (!Array.isArray(participants) || participants.length < 2) {
      fail("INVALID_ARGUMENT", "'participants' must be an array with at least 2 entries.");
    }
    if (participants.length > 26) {
      fail("INVALID_ARGUMENT", "'participants' supports at most 26 entries.");
    }
    list = participants;
  } else {
    list = [
      { id: "A", role: positionA },
      { id: "B", role: positionB },
    ];
  }

  const seen = new Set();
  return list.map((item, idx) => {
    const fallbackId = String.fromCharCode(65 + idx);
    const entry = typeof item === "string" ? { role: item } : item || {};
    const id = String(entry.id ?? fallbackId).trim().toUpperCase();
    if (!/^[A-Z0-9_-]{1,16}$/.test(id)) {
      fail("INVALID_ARGUMENT", `Invalid participant id '${entry.id}'. Use 1-16 letters, digits, '_' or '-'.`);
    }
    if (seen.has(id)) fail("INVALID_ARGUMENT", `Duplicate participant id '${id}'.`);
    seen.add(id);

    const roleRaw = entry.role ?? entry.position;
    const role = typeof roleRaw === "string" && roleRaw.trim() ? roleRaw.trim() : null;
    if (!role) {
      fail(
        "INVALID_ARGUMENT",
        participants
          ? `Participant '${id}' needs a non-empty 'role'.`
          : `'position_${id.toLowerCase()}' is required when 'participants' is not provided.`
      );
    }
    const pPlatform = requireEnum(entry.platform ?? platform, `participants[${idx}].platform`, PLATFORMS);
    const model = validateModel(pPlatform, entry.model ?? defaultModel, `participants[${idx}].model`);
    const effort = requireEnum(entry.effort ?? defaultEffort, `participants[${idx}].effort`, EFFORTS);
    return {
      id,
      role,
      platform: pPlatform,
      model,
      effort,
      effort_directive: getEffortDirective(pPlatform, effort),
    };
  });
}

// ------------------------------------------------------------- helpers

export function participantsOf(debate) {
  return (
    debate.participants || [
      { id: "A", role: debate.position_a || "Position A" },
      { id: "B", role: debate.position_b || "Position B" },
    ]
  );
}

export function maxTurnsOf(debate) {
  return (debate.max_rounds || 3) * participantsOf(debate).length;
}

export function countWords(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

export function computeScoreboard(debate) {
  const board = {};
  for (const p of participantsOf(debate)) {
    board[p.id] = {
      role: p.role,
      platform: p.platform || debate.client_platform || "antigravity",
      model: p.model || debate.default_model || "inherit",
      effort: p.effort || debate.default_effort || "high",
      scored_turns: 0,
      total_points: 0,
      average_score: 0,
    };
  }
  for (const turn of debate.turns || []) {
    const avg = turn.score?.average;
    if (typeof avg !== "number" || !Number.isFinite(avg)) continue;
    const pos = turn.position;
    if (!board[pos]) {
      board[pos] = {
        role: pos,
        platform: debate.client_platform || "antigravity",
        model: turn.model || "inherit",
        effort: turn.effort || "high",
        scored_turns: 0,
        total_points: 0,
        average_score: 0,
      };
    }
    board[pos].scored_turns += 1;
    board[pos].total_points = Number((board[pos].total_points + avg).toFixed(2));
    board[pos].average_score = Number((board[pos].total_points / board[pos].scored_turns).toFixed(2));
  }
  return board;
}

// ------------------------------------------------------------ markdown

export function formatDebateMarkdown(debate, format = "adr") {
  const participants = participantsOf(debate);
  const lines = [];

  if (format === "adr") {
    lines.push(`# ADR: ${debate.topic}`, "");
    lines.push(`- **Debate ID:** \`${debate.debate_id}\``);
    lines.push(`- **Status:** ${debate.status === "closed" ? "Accepted / Closed" : "Proposed / Open"}`);
    lines.push(`- **Platform:** ${debate.client_platform || "antigravity"}`);
    lines.push(`- **Execution Mode:** \`${debate.execution_mode || "subagents"}\``);
    lines.push(
      `- **Default Model / Effort:** \`${debate.default_model || "inherit"}\` / \`${debate.default_effort || "high"}\``
    );
    lines.push(`- **Created At:** ${debate.created_at}`);
    if (debate.closed_at) lines.push(`- **Decided At:** ${debate.closed_at}`);
    if (debate.winner) lines.push(`- **Selected Outcome:** ${debate.winner}`);
    lines.push("", "## 1. Context and Problem Statement", "");
    lines.push(`Topic evaluated: **${debate.topic}**`, "");
    lines.push(`Rules applied: ${debate.rules || "Standard technical debate rules."}`, "");
    lines.push("## 2. Considered Options (Positions and Model Profiles)", "");
    for (const p of participants) {
      lines.push(
        `- **Position ${p.id}** [Platform: \`${p.platform || "antigravity"}\`, Model: \`${p.model || "inherit"}\`, Effort: \`${p.effort || "high"}\`]: ${p.role}`
      );
    }
    lines.push("", "## 3. Deliberation and Key Arguments", "");
    for (const turn of debate.turns || []) {
      const modelTag = turn.model ? ` | Model: ${turn.model}` : "";
      const effortTag = turn.effort ? ` | Effort: ${turn.effort}` : "";
      lines.push(
        `### Round ${turn.round} - Turn ${turn.turn}: ${turn.agent} (Position ${turn.position}${modelTag}${effortTag})`,
        "",
        turn.argument
      );
      if (turn.score) {
        lines.push(
          "",
          `*Score (${turn.score.judge}): ${turn.score.average}/10 ` +
            `(Evidence: ${turn.score.technical_evidence}, Rebuttal: ${turn.score.rebuttal_strength}, ` +
            `Viability: ${turn.score.operational_viability}, Clarity: ${turn.score.clarity})*`
        );
        if (turn.score.notes) lines.push(`*Judge Notes: ${turn.score.notes}*`);
      }
      lines.push("");
    }
    const board = debate.scoreboard || computeScoreboard(debate);
    lines.push("## 4. Evaluation Scoreboard", "");
    lines.push("| Position | Role | Model | Effort | Scored Turns | Total Points | Average Score (1-10) |");
    lines.push("| :--- | :--- | :---: | :---: | :---: | :---: | :---: |");
    for (const [posId, stats] of Object.entries(board)) {
      lines.push(
        `| ${posId} | ${stats.role} | ${stats.model || "inherit"} | ${stats.effort || "high"} | ${stats.scored_turns} | ${stats.total_points} | ${stats.average_score} |`
      );
    }
    lines.push("", "## 5. Decision Outcome and Verdict", "");
    lines.push(`**Outcome:** ${debate.winner || "Pending"}`, "");
    lines.push(debate.verdict || "Debate is still open; no final verdict recorded yet.", "");
  } else {
    lines.push(`# Debate Transcript: ${debate.topic}`, "");
    lines.push(`- **ID:** \`${debate.debate_id}\``);
    lines.push(`- **Status:** ${debate.status}`);
    lines.push(`- **Execution Mode:** ${debate.execution_mode || "subagents"}`);
    lines.push(`- **Rounds:** ${debate.max_rounds}`, "");
    lines.push("## Positions", "");
    for (const p of participants) {
      lines.push(`- **${p.id}** (Model: \`${p.model || "inherit"}\`, Effort: \`${p.effort || "high"}\`): ${p.role}`);
    }
    lines.push("", "## Turns", "");
    for (const turn of debate.turns || []) {
      const modelTag = turn.model ? ` | Model: ${turn.model}` : "";
      const effortTag = turn.effort ? ` | Effort: ${turn.effort}` : "";
      lines.push(
        `### [Round ${turn.round} | Turn ${turn.turn}] ${turn.agent} (Position ${turn.position}${modelTag}${effortTag})`,
        "",
        turn.argument,
        ""
      );
    }
    if (debate.verdict) {
      lines.push("## Verdict", "", `**Winner / Synthesis:** ${debate.winner}`, "", debate.verdict, "");
    }
  }
  return lines.join("\n");
}
