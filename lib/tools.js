import { RoundtableError, fail } from "./errors.js";
import { sleep } from "./storage.js";
import {
  EFFORTS,
  EXECUTION_MODES,
  PLATFORMS,
  PLATFORM_PROFILES,
  SCORE_CRITERIA,
  WORD_LIMIT_MODES,
  hardWordLimit,
  computeScoreboard,
  countWords,
  detectClientPlatform,
  formatDebateMarkdown,
  getEffortDirective,
  maxTurnsOf,
  normalizeParticipants,
  participantsOf,
  requireEnum,
  requireInt,
  requireScore,
  requireString,
  validateModel,
} from "./core.js";
import { resolveExportTarget, rootsFromEnv, writeExport } from "./export.js";

const DEFAULT_RULES = "Be concise, address the previous turn directly, and provide technical evidence.";
const WAIT_POLL_MS = 1000;

export const TOOL_DEFINITIONS = [
  {
    name: "get_client_models",
    description:
      "Return the available models and effort levels for Antigravity ('inherit', 'pro', 'flash', 'flash_lite') or Claude ('inherit', 'opus', 'sonnet', 'haiku'). Call this first if you need to check valid model/effort options.",
    inputSchema: {
      type: "object",
      properties: {
        platform: { type: "string", description: "Platform name: 'claude' or 'antigravity'" },
      },
    },
  },
  {
    name: "create_debate",
    description:
      "Create a new debate or N-participant roundtable session. " +
      "MANDATORY PRE-CHECK: Before calling create_debate, if the user did NOT explicitly specify " +
      "(1) execution_mode ('subagents' to spawn isolated subagents in this client, 'cross_client' to fight against another AI client like Antigravity vs Claude, or 'single_agent'), " +
      "(2) default_model (Claude: 'inherit', 'opus', 'sonnet', 'haiku' | Antigravity: 'inherit', 'pro', 'flash', 'flash_lite'), and " +
      "(3) default_effort ('high', 'medium', 'low'), you MUST ask the user to choose them first! " +
      "Fails if debate_id already exists unless overwrite=true.",
    inputSchema: {
      type: "object",
      properties: {
        debate_id: {
          type: "string",
          description: "Unique identifier (letters, digits, '.', '_' or '-'; max 100 chars)",
        },
        topic: { type: "string", description: "The topic or question to be debated" },
        client_platform: {
          type: "string",
          enum: PLATFORMS,
          description:
            "REQUIRED: Set to 'claude' if you are Claude (Claude Code / Claude Desktop), or 'antigravity' if you are Google Antigravity.",
        },
        execution_mode: {
          type: "string",
          enum: EXECUTION_MODES,
          description:
            "REQUIRED: 'subagents' (spawn a separate isolated subagent per position using Task/Agent in Claude or invoke_subagent in Antigravity), 'cross_client' (live debate between two separate AI clients using wait_for_turn), or 'single_agent' (only when subagents are unavailable and user explicitly wants one agent to roleplay all sides).",
        },
        default_model: {
          type: "string",
          description:
            "REQUIRED: Default model for participants. If client_platform='claude', choose 'inherit', 'opus', 'sonnet', or 'haiku'. If client_platform='antigravity', choose 'inherit', 'pro', 'flash', or 'flash_lite'.",
        },
        default_effort: {
          type: "string",
          enum: EFFORTS,
          description: "REQUIRED: Reasoning effort ('high', 'medium', or 'low').",
        },
        position_a: {
          type: "string",
          description: "Description of Position A (required if participants is not provided)",
        },
        position_b: {
          type: "string",
          description: "Description of Position B (required if participants is not provided)",
        },
        participants: {
          type: "array",
          description:
            "List of 2 or more participants with optional custom model/effort per role (e.g. [{'id': 'A', 'role': 'Option A', 'model': 'opus', 'effort': 'high'}, {'id': 'B', 'role': 'Option B', 'model': 'sonnet', 'effort': 'high'}])",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              role: { type: "string" },
              platform: { type: "string", enum: PLATFORMS },
              model: { type: "string" },
              effort: { type: "string", enum: EFFORTS },
            },
          },
        },
        max_rounds: { type: "integer", minimum: 1, maximum: 20, description: "Maximum number of rounds (1-20)", default: 3 },
        max_words: {
          type: "integer",
          minimum: 20,
          maximum: 5000,
          description: "Maximum words per argument (20-5000)",
          default: 200,
        },
        word_limit_mode: {
          type: "string",
          enum: WORD_LIMIT_MODES,
          description:
            "'reject' (default): warn up to max_words +15%, reject above that. 'warn': never reject, only warn.",
          default: "reject",
        },
        strict_turn_order: { type: "boolean", description: "Reject out-of-turn arguments automatically", default: true },
        rules: { type: "string", description: "Debate rules and guidelines", default: DEFAULT_RULES },
        overwrite: {
          type: "boolean",
          description: "Replace an existing debate with the same debate_id (its history is lost)",
          default: false,
        },
      },
      required: ["debate_id", "topic", "client_platform", "execution_mode", "default_model", "default_effort"],
    },
  },
  {
    name: "list_debates",
    description: "List available debates. Filter by status: 'all', 'open', or 'closed'.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["all", "open", "closed"], description: "Filter by status", default: "all" },
      },
    },
  },
  {
    name: "read_debate",
    description:
      "Read the full state, model/effort profile, scoreboard, and transcript of a debate, including whose turn is next.",
    inputSchema: {
      type: "object",
      properties: { debate_id: { type: "string", description: "Identifier of the debate to read" } },
      required: ["debate_id"],
    },
  },
  {
    name: "post_argument",
    description:
      "Post an argument or rebuttal to an open debate. In 'subagents' and 'cross_client' modes, each position MUST have a distinct agent_name (a single agent cannot post for multiple opposing positions). Arguments longer than max_words +15% are rejected when word_limit_mode='reject'.",
    inputSchema: {
      type: "object",
      properties: {
        debate_id: { type: "string", description: "Identifier of the debate" },
        agent_name: {
          type: "string",
          description:
            "Unique name of the subagent or client defending this position (e.g. 'Subagent-A-Opus', 'Subagent-B-Sonnet', 'Antigravity-A', 'Claude-B'). Do NOT reuse the same agent_name across different positions.",
        },
        position: { type: "string", description: "Position ID defended (e.g. 'A', 'B', 'C')" },
        argument: { type: "string", description: "The argument or rebuttal content" },
        model: { type: "string", description: "Model used for this turn (defaults to participant's configured model)" },
        effort: {
          type: "string",
          enum: EFFORTS,
          description: "Reasoning effort used (defaults to participant's configured effort)",
        },
        force: {
          type: "boolean",
          description: "Bypass the turn-order and anti-monologue checks (use only to recover a stuck debate)",
          default: false,
        },
      },
      required: ["debate_id", "agent_name", "position", "argument"],
    },
  },
  {
    name: "wait_for_turn",
    description:
      "Wait until it is the specified position's turn in an open debate (used in 'cross_client' mode when Antigravity and Claude are debating each other live). Returns event 'timeout' if nothing happens; call it again to keep waiting.",
    inputSchema: {
      type: "object",
      properties: {
        debate_id: { type: "string", description: "Identifier of the debate" },
        position: { type: "string", description: "Position ID waiting for its turn (e.g. 'A' or 'B')" },
        timeout_seconds: {
          type: "integer",
          minimum: 5,
          maximum: 300,
          description:
            "Maximum seconds to wait (5-300). Keep the default 50 unless your client allows long tool calls; many MCP clients abort calls after 60 s.",
          default: 50,
        },
      },
      required: ["debate_id", "position"],
    },
  },
  {
    name: "score_turn",
    description:
      "Score a specific turn using a structured rubric (each criterion 1-10) and update the debate scoreboard. All turns must be scored before calling close_debate.",
    inputSchema: {
      type: "object",
      properties: {
        debate_id: { type: "string", description: "Identifier of the debate" },
        turn_number: { type: "integer", minimum: 1, description: "Turn number to score (1-based)" },
        judge_name: { type: "string", description: "Name of the judge agent", default: "Judge" },
        technical_evidence: { type: "number", minimum: 1, maximum: 10, description: "Technical evidence and rigor (1-10)" },
        rebuttal_strength: { type: "number", minimum: 1, maximum: 10, description: "Directly addressing opponent points (1-10)" },
        operational_viability: { type: "number", minimum: 1, maximum: 10, description: "Practical real-world viability (1-10)" },
        clarity: { type: "number", minimum: 1, maximum: 10, description: "Clarity and conciseness (1-10)" },
        notes: { type: "string", description: "Brief justification for the score" },
      },
      required: ["debate_id", "turn_number", ...SCORE_CRITERIA],
    },
  },
  {
    name: "export_debate",
    description:
      "Export a debate as an Architecture Decision Record ('adr') or Markdown transcript ('markdown'). " +
      "Without output_path (or with a bare file name) it is saved in ~/.roundtable_mcp/exports. " +
      "Other paths must end in .md and be inside your project folder (MCP roots) or ROUNDTABLE_EXPORT_ROOTS; existing files there are never overwritten.",
    inputSchema: {
      type: "object",
      properties: {
        debate_id: { type: "string", description: "Identifier of the debate to export" },
        format: { type: "string", enum: ["adr", "markdown"], description: "Export format", default: "adr" },
        output_path: {
          type: "string",
          description: "Optional .md file name or path (e.g. '001-decision.md' or 'docs/adr/001-decision.md')",
        },
      },
      required: ["debate_id"],
    },
  },
  {
    name: "close_debate",
    description:
      "Close a debate and record the final synthesis, conclusion, or winning position. Requires at least one turn and every turn scored via score_turn (unless force=true).",
    inputSchema: {
      type: "object",
      properties: {
        debate_id: { type: "string", description: "Identifier of the debate to close" },
        verdict: { type: "string", description: "Final synthesis and reasoning" },
        winner: {
          type: "string",
          description: "Winning position id ('A', 'B', ...), 'synthesis' or 'draw'",
          default: "synthesis",
        },
        force: {
          type: "boolean",
          description: "Close even with no turns or unscored turns",
          default: false,
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
      properties: { debate_id: { type: "string", description: "Identifier of the debate to delete" } },
      required: ["debate_id"],
    },
  },
];

// ----------------------------------------------------------------- helpers

const ok = (text) => ({ content: [{ type: "text", text }] });
const okJson = (value) => ok(JSON.stringify(value, null, 2));
const errorResult = (text) => ({ content: [{ type: "text", text }], isError: true });

function notFound(debateId) {
  return new RoundtableError("NOT_FOUND", `Debate '${debateId}' not found. Use list_debates to see available debates.`);
}

function requireOpen(debate, debateId) {
  if (!debate) throw notFound(debateId);
  if (debate.status !== "open") fail("DEBATE_CLOSED", `Debate '${debateId}' is already closed.`);
}

/**
 * Builds the tool dispatcher.
 * @param {object} deps
 * @param {import("./storage.js").Storage} deps.storage
 * @param {() => string|undefined} [deps.getClientName]
 * @param {() => Promise<string[]>} [deps.getClientRoots] filesystem paths shared by the client
 * @param {object} [deps.env]
 */
export function createToolHandler({ storage, getClientName = () => undefined, getClientRoots = async () => [], env = process.env }) {
  const handlers = {
    async get_client_models(args) {
      const detected = detectClientPlatform({ explicit: args.platform, clientName: getClientName(), env });
      return okJson({
        detected_platform: detected,
        active_profile: PLATFORM_PROFILES[detected],
        all_supported_platforms: PLATFORM_PROFILES,
      });
    },

    async create_debate(args) {
      const debateId = requireString(args.debate_id, "debate_id");
      const topic = requireString(args.topic, "topic");
      const platform =
        args.client_platform !== undefined && args.client_platform !== null && args.client_platform !== ""
          ? requireEnum(args.client_platform, "client_platform", PLATFORMS)
          : detectClientPlatform({ clientName: getClientName(), env });
      const executionMode = requireEnum(args.execution_mode, "execution_mode", EXECUTION_MODES);
      const defaultModel = validateModel(platform, args.default_model, "default_model");
      const defaultEffort = requireEnum(args.default_effort, "default_effort", EFFORTS);
      const maxRounds = requireInt(args.max_rounds, "max_rounds", { min: 1, max: 20, fallback: 3 });
      const maxWords = requireInt(args.max_words, "max_words", { min: 20, max: 5000, fallback: 200 });
      const wordLimitMode =
        requireEnum(args.word_limit_mode, "word_limit_mode", WORD_LIMIT_MODES, { optional: true }) || "reject";
      const strictTurnOrder = args.strict_turn_order !== false;
      const rules = typeof args.rules === "string" && args.rules.trim() ? args.rules.trim() : DEFAULT_RULES;
      const overwrite = args.overwrite === true;

      const participants = normalizeParticipants({
        positionA: args.position_a,
        positionB: args.position_b,
        participants: args.participants,
        platform,
        defaultModel,
        defaultEffort,
      });
      const profile = PLATFORM_PROFILES[platform];

      const debate = {
        debate_id: debateId,
        topic,
        client_platform: platform,
        execution_mode: executionMode,
        default_model: defaultModel,
        default_effort: defaultEffort,
        position_a: participants[0].role,
        position_b: participants[1].role,
        participants,
        max_rounds: maxRounds,
        max_words: maxWords,
        word_limit_mode: wordLimitMode,
        strict_turn_order: strictTurnOrder,
        rules,
        status: "open",
        created_at: new Date().toISOString(),
        next_expected_position: participants[0].id,
        turns: [],
        verdict: null,
        winner: null,
      };
      debate.scoreboard = computeScoreboard(debate);

      let replaced = false;
      await storage.update(debateId, (current) => {
        if (current && !overwrite) {
          fail(
            "DUPLICATE_DEBATE_ID",
            `Debate '${debateId}' already exists (status: ${current.status}, ${(current.turns || []).length} turns). ` +
              `Choose another debate_id, or pass overwrite=true to replace it and lose its history.`
          );
        }
        replaced = Boolean(current);
        return { save: debate };
      });

      const participantSummary = participants
        .map((p) => `Position ${p.id} [Platform: ${p.platform}, Model: ${p.model}, Effort: ${p.effort}]: ${p.role}`)
        .join("\n");

      let modeInstructions = "";
      if (executionMode === "subagents") {
        modeInstructions =
          `\nMANDATORY EXECUTION RULES (execution_mode='subagents'):\n` +
          `1. Do NOT post arguments for multiple positions from your main agent context.\n` +
          `2. Spawn an isolated subagent for each position using ${profile.subagent_tool}.\n` +
          `3. Pass each participant's configured model and effort_directive to its subagent.\n` +
          `4. Each subagent MUST use a distinct agent_name (e.g. 'Subagent-A', 'Subagent-B'). Reusing the same agent_name across different positions will be rejected by post_argument.\n` +
          `5. After all turns complete, score every turn with score_turn before calling close_debate.`;
      } else if (executionMode === "cross_client") {
        modeInstructions =
          `\nMANDATORY EXECUTION RULES (execution_mode='cross_client'):\n` +
          `1. Defend ONLY your assigned position in this client window.\n` +
          `2. After calling post_argument for your position, call wait_for_turn to wait for the opposing AI client (Antigravity / Claude) to submit its turn.`;
      }

      const hardLimit = hardWordLimit(maxWords);
      return ok(
        `Debate '${debateId}' ${replaced ? "replaced (previous history discarded)" : "created"}.\n` +
          `Topic: ${topic}\n` +
          `Platform: ${platform}\n` +
          `Execution Mode: ${executionMode}\n` +
          `${participantSummary}\n` +
          `Max rounds: ${maxRounds} (${maxRounds * participants.length} total turns)\n` +
          `Word limit per turn: ${maxWords}` +
          (wordLimitMode === "reject" ? ` (arguments over ${hardLimit} words are rejected)` : " (warning only)") +
          `\nNext turn: Position ${participants[0].id}\n` +
          modeInstructions
      );
    },

    async list_debates(args) {
      const status = requireEnum(args.status ?? "all", "status", ["all", "open", "closed"]);
      const { debates, errors } = await storage.list();
      const filtered = debates
        .filter((d) => status === "all" || d.status === status)
        .map((info) => ({
          debate_id: info.debate_id,
          topic: info.topic,
          status: info.status,
          client_platform: info.client_platform || "antigravity",
          execution_mode: info.execution_mode || "subagents",
          default_model: info.default_model || "inherit",
          default_effort: info.default_effort || "high",
          turns_count: (info.turns || []).length,
          max_turns: maxTurnsOf(info),
          next_expected_position: info.next_expected_position,
          winner: info.winner || null,
        }));
      if (filtered.length === 0 && errors.length === 0) return ok("No debates found.");
      return okJson(errors.length ? { debates: filtered, unreadable_files: errors } : filtered);
    },

    async read_debate(args) {
      const debateId = requireString(args.debate_id, "debate_id");
      const debate = await storage.read(debateId);
      if (!debate) throw notFound(debateId);
      return okJson(debate);
    },

    async post_argument(args) {
      const debateId = requireString(args.debate_id, "debate_id");
      const agentName = requireString(args.agent_name, "agent_name");
      const argument = requireString(args.argument, "argument");
      const requestedPos = requireString(args.position, "position").toUpperCase();
      const force = args.force === true;

      return storage.update(debateId, (debate) => {
        requireOpen(debate, debateId);
        const participants = participantsOf(debate);
        const turns = debate.turns || [];
        const maxTurns = maxTurnsOf(debate);
        if (turns.length >= maxTurns) {
          fail(
            "MAX_TURNS_REACHED",
            `Debate '${debateId}' has reached the maximum of ${maxTurns} turns. Score all turns with score_turn and then call close_debate.`
          );
        }

        const validIds = participants.map((p) => String(p.id).toUpperCase());
        if (!validIds.includes(requestedPos)) {
          fail("INVALID_POSITION", `Position '${requestedPos}' does not exist in this debate. Valid positions: ${validIds.join(", ")}.`);
        }
        const expectedPos = String(debate.next_expected_position || validIds[0]).toUpperCase();
        if (debate.strict_turn_order !== false && !force && requestedPos !== expectedPos) {
          fail(
            "OUT_OF_TURN",
            `Out-of-turn submission rejected: Position '${requestedPos}' attempted to post, but next_expected_position is '${expectedPos}'. ` +
              `Wait for Position '${expectedPos}' to complete its turn (or use wait_for_turn).`
          );
        }

        const execMode = debate.execution_mode || "subagents";
        if (execMode !== "single_agent" && !force) {
          const cleanAgent = agentName.toLowerCase();
          const conflicting = turns.find(
            (t) =>
              String(t.agent || "").trim().toLowerCase() === cleanAgent &&
              String(t.position || "").toUpperCase() !== requestedPos
          );
          if (conflicting) {
            fail(
              "MONOLOGUE_BLOCKED",
              `MONOLOGUE BLOCKED (execution_mode='${execMode}'): Agent '${agentName}' already defended Position '${conflicting.position}' and cannot also defend Position '${requestedPos}'. ` +
                (execMode === "subagents"
                  ? `You MUST spawn a separate isolated subagent (using Task/Agent in Claude or invoke_subagent in Antigravity) for Position '${requestedPos}' and give it a distinct agent_name (e.g. 'Subagent-${requestedPos}').`
                  : `In 'cross_client' mode, each AI client defends only its own position. Call wait_for_turn so the opposing client can post Position '${requestedPos}'.`)
            );
          }
        }

        const wordCount = countWords(argument);
        const maxWords = debate.max_words || 200;
        const hardLimit = hardWordLimit(maxWords);
        const mode = debate.word_limit_mode || "warn"; // debates created before v0.5 only warned
        if (mode === "reject" && wordCount > hardLimit) {
          fail(
            "WORD_LIMIT_EXCEEDED",
            `Argument rejected: ${wordCount} words exceeds the limit of ${maxWords} (+15% tolerance = ${hardLimit}). Shorten it and post again; the turn was not recorded.`
          );
        }
        const wordWarning =
          wordCount > maxWords ? ` Note: Argument has ${wordCount} words (exceeds recommended limit of ${maxWords} words).` : "";

        const config = participants.find((p) => String(p.id).toUpperCase() === requestedPos) || {};
        const platform = config.platform || debate.client_platform || "antigravity";
        const resolvedModel =
          args.model !== undefined && args.model !== null && args.model !== ""
            ? validateModel(platform, args.model, "model")
            : config.model || debate.default_model || "inherit";
        const resolvedEffort =
          requireEnum(args.effort, "effort", EFFORTS, { optional: true }) ||
          String(config.effort || debate.default_effort || "high").toLowerCase();

        const turnNumber = turns.length + 1;
        const round = Math.floor((turnNumber - 1) / participants.length) + 1;
        turns.push({
          turn: turnNumber,
          round,
          agent: agentName,
          position: requestedPos,
          model: resolvedModel,
          effort: resolvedEffort,
          word_count: wordCount,
          argument,
          timestamp: new Date().toISOString(),
          ...(force ? { forced: true } : {}),
        });
        debate.turns = turns;
        debate.next_expected_position = validIds[(validIds.indexOf(requestedPos) + 1) % validIds.length];

        const remaining = maxTurns - turnNumber;
        const next = participants.find((p) => String(p.id).toUpperCase() === debate.next_expected_position) || {};
        const nextStepHint =
          remaining > 0
            ? execMode === "subagents"
              ? `\nNext action: Spawn/message the isolated subagent for Position ${debate.next_expected_position} [Model: ${next.model || debate.default_model || "inherit"}, Effort: ${next.effort || debate.default_effort || "high"}] with a distinct agent_name.`
              : execMode === "cross_client"
                ? `\nNext action: Call wait_for_turn for your position so the opposing client can post Position ${debate.next_expected_position}.`
                : ""
            : `\nAll ${maxTurns} turns are complete! Next action: Call score_turn for every turn (1..${maxTurns}) before calling close_debate.`;

        return {
          save: debate,
          result: ok(
            `Turn ${turnNumber} (Round ${round}) recorded by ${agentName} ` +
              `[Position ${requestedPos}, Model: ${resolvedModel}, Effort: ${resolvedEffort}, ${wordCount} words]. ` +
              `Remaining turns: ${remaining}. Next expected position: ${debate.next_expected_position}.${wordWarning}${nextStepHint}`
          ),
        };
      });
    },

    async wait_for_turn(args, extra = {}) {
      const debateId = requireString(args.debate_id, "debate_id");
      const targetPos = requireString(args.position, "position").toUpperCase();
      const timeoutSeconds = requireInt(args.timeout_seconds, "timeout_seconds", { min: 5, max: 300, fallback: 50 });
      const started = Date.now();
      const deadline = started + timeoutSeconds * 1000;
      let checkedPosition = false;

      for (;;) {
        if (extra.signal?.aborted) fail("CANCELLED", "wait_for_turn was cancelled by the client.");
        const debate = await storage.read(debateId);
        if (!debate) throw notFound(debateId);
        const participants = participantsOf(debate);
        if (!checkedPosition) {
          const ids = participants.map((p) => String(p.id).toUpperCase());
          if (!ids.includes(targetPos)) {
            fail("INVALID_POSITION", `Position '${targetPos}' does not exist in this debate. Valid positions: ${ids.join(", ")}.`);
          }
          checkedPosition = true;
        }
        const turns = debate.turns || [];
        const maxTurns = maxTurnsOf(debate);

        if (debate.status !== "open") {
          return okJson({ event: "debate_closed", status: debate.status, winner: debate.winner, verdict: debate.verdict });
        }
        if (turns.length >= maxTurns) {
          return okJson({
            event: "max_turns_reached",
            turns_count: turns.length,
            max_turns: maxTurns,
            last_turn: turns[turns.length - 1] || null,
          });
        }
        if (String(debate.next_expected_position).toUpperCase() === targetPos) {
          const me = participants.find((p) => String(p.id).toUpperCase() === targetPos) || {};
          const effort = me.effort || debate.default_effort || "high";
          return okJson({
            event: "your_turn",
            debate_id: debateId,
            your_position: targetPos,
            assigned_model: me.model || debate.default_model || "inherit",
            assigned_effort: effort,
            effort_directive: me.effort_directive || getEffortDirective(debate.client_platform || "antigravity", effort),
            turns_completed: turns.length,
            max_turns: maxTurns,
            last_turn: turns[turns.length - 1] || null,
          });
        }
        if (Date.now() >= deadline) {
          return okJson({
            event: "timeout",
            message: `Timed out after ${timeoutSeconds}s waiting for Position ${targetPos}. Call wait_for_turn again to keep waiting.`,
            next_expected_position: debate.next_expected_position || null,
            turns_completed: turns.length,
          });
        }
        if (extra.sendProgress) {
          await extra.sendProgress(Math.round((Date.now() - started) / 1000), timeoutSeconds,
            `Waiting for Position ${debate.next_expected_position} to post`);
        }
        await sleep(Math.min(WAIT_POLL_MS, Math.max(0, deadline - Date.now())));
      }
    },

    async score_turn(args) {
      const debateId = requireString(args.debate_id, "debate_id");
      const turnNumber = requireInt(args.turn_number, "turn_number", { min: 1, max: 100000 });
      const scores = {};
      for (const criterion of SCORE_CRITERIA) scores[criterion] = requireScore(args[criterion], criterion);
      const judge = typeof args.judge_name === "string" && args.judge_name.trim() ? args.judge_name.trim() : "Judge";
      const notes = typeof args.notes === "string" ? args.notes : "";

      return storage.update(debateId, (debate) => {
        if (!debate) throw notFound(debateId);
        if (debate.status !== "open") {
          fail("DEBATE_CLOSED", `Debate '${debateId}' is closed; its scores can no longer change.`);
        }
        const turn = (debate.turns || []).find((t) => t.turn === turnNumber);
        if (!turn) {
          fail("TURN_NOT_FOUND", `Turn ${turnNumber} not found in debate '${debateId}' (it has ${(debate.turns || []).length} turns).`);
        }
        const average = Number((SCORE_CRITERIA.reduce((sum, c) => sum + scores[c], 0) / SCORE_CRITERIA.length).toFixed(2));
        turn.score = { judge, ...scores, average, notes, scored_at: new Date().toISOString() };
        debate.scoreboard = computeScoreboard(debate);
        const unscored = debate.turns.filter((t) => !t.score).map((t) => t.turn);
        return {
          save: debate,
          result: ok(
            `Turn ${turnNumber} (${turn.agent}, Position ${turn.position}) scored: ${average}/10.\n` +
              (unscored.length ? `Unscored turns: ${unscored.join(", ")}.\n` : "All turns are scored.\n") +
              `Updated Scoreboard:\n${JSON.stringify(debate.scoreboard, null, 2)}`
          ),
        };
      });
    },

    async export_debate(args) {
      const debateId = requireString(args.debate_id, "debate_id");
      const format = requireEnum(args.format ?? "adr", "format", ["adr", "markdown"]);
      const debate = await storage.read(debateId);
      if (!debate) throw notFound(debateId);
      const markdown = formatDebateMarkdown(debate, format);

      const target = resolveExportTarget({
        outputPath: args.output_path,
        debateId,
        format,
        exportsDir: storage.paths.exportsDir,
        envRoots: rootsFromEnv(env),
        clientRoots: await getClientRoots(),
      });
      const file = writeExport(target, markdown);
      return ok(`Debate '${debateId}' exported (${format}) to ${file}\n\n${markdown}`);
    },

    async close_debate(args) {
      const debateId = requireString(args.debate_id, "debate_id");
      const verdict = requireString(args.verdict, "verdict");
      const force = args.force === true;
      const winnerRaw = typeof args.winner === "string" && args.winner.trim() ? args.winner.trim() : "synthesis";

      return storage.update(debateId, (debate) => {
        requireOpen(debate, debateId);
        const ids = participantsOf(debate).map((p) => String(p.id).toUpperCase());
        let winner;
        if (["synthesis", "draw"].includes(winnerRaw.toLowerCase())) winner = winnerRaw.toLowerCase();
        else if (ids.includes(winnerRaw.toUpperCase())) winner = winnerRaw.toUpperCase();
        else fail("INVALID_WINNER", `Invalid winner '${winnerRaw}'. Use one of: ${[...ids, "synthesis", "draw"].join(", ")}.`);

        const turns = debate.turns || [];
        if (!force) {
          if (turns.length === 0) {
            fail("NO_TURNS", `CLOSE REJECTED: Debate '${debateId}' has no turns yet. Run the debate first (or pass force=true).`);
          }
          const unscored = turns.filter((t) => !t.score).map((t) => t.turn);
          if (unscored.length) {
            fail(
              "UNSCORED_TURNS",
              `CLOSE REJECTED: Unscored turns remain (Turns: ${unscored.join(", ")}). ` +
                `You MUST call score_turn for every turn first so the Evaluation Scoreboard is populated before calling close_debate.`
            );
          }
        }
        debate.status = "closed";
        debate.verdict = verdict;
        debate.winner = winner;
        debate.closed_at = new Date().toISOString();
        debate.scoreboard = computeScoreboard(debate);
        return {
          save: debate,
          result: ok(`Debate '${debateId}' closed. Winner/Outcome: ${winner}.\nFinal Scoreboard:\n${JSON.stringify(debate.scoreboard, null, 2)}`),
        };
      });
    },

    async delete_debate(args) {
      const debateId = requireString(args.debate_id, "debate_id");
      return storage.update(debateId, (debate) => {
        if (!debate) throw notFound(debateId);
        return { remove: true, result: ok(`Debate '${debateId}' deleted.`) };
      });
    },
  };

  return async function callTool(name, args = {}, extra = {}) {
    const handler = Object.prototype.hasOwnProperty.call(handlers, name) ? handlers[name] : null;
    if (!handler) return errorResult(`Unknown tool: ${name}`);
    try {
      return await handler(args || {}, extra);
    } catch (error) {
      if (error instanceof RoundtableError) return errorResult(error.message);
      return errorResult(`Internal error in ${name}: ${error.message}`);
    }
  };
}
