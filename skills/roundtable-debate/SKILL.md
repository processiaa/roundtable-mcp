---
name: roundtable-debate
description: Coordinate structured multi-agent debates and N-participant roundtables across Antigravity and Claude with platform-specific model, effort, and execution mode guardrails using the roundtable-mcp tools.
---

# Roundtable Debate Skill

Use this skill when the user wants two or more AI agents to debate a technical, architectural, or strategic topic.

## Mandatory Pre-Check Before Creating a Debate

Before calling `create_debate`, if the user has not specified the following parameters, ask the user first:
1. **`execution_mode`:**
   - `subagents`: Spawn a separate isolated subagent per position inside this client (`Task`/`Agent` in Claude, `invoke_subagent` in Antigravity).
   - `cross_client`: Live debate between two separate AI clients (e.g. Antigravity vs. Claude) using `wait_for_turn`.
   - `single_agent`: Only when subagents are unavailable and the user explicitly wants one agent to simulate all positions.
2. **`default_model`:**
   - **Antigravity (`client_platform: "antigravity"`):** `inherit`, `pro`, `flash`, `flash_lite`.
   - **Claude (`client_platform: "claude"`):** `inherit`, `opus`, `sonnet`, `haiku`.
3. **`default_effort`:** `high`, `medium`, or `low`.

Pick a new `debate_id` (letters, digits, `.`, `_`, `-`). `create_debate` fails if it already exists; only pass `overwrite: true` if the user agrees to lose that debate.

## Enforcement Rules

- **Errors:** Rejections come back as tool errors (`isError: true`). Read the message, fix the call, and retry; do not use `force` to get around them.
- **Anti-Monologue Guardrail:** In `subagents` and `cross_client` modes, `post_argument` rejects any attempt by the same `agent_name` to post for multiple opposing positions. Each position must be defended by its own isolated subagent (with a unique `agent_name`, e.g. `Subagent-A-Opus`, `Subagent-B-Sonnet`) or separate client.
- **Word Limit:** Tell each subagent the `max_words` limit. Arguments above `max_words` +15% are rejected and must be shortened and posted again.
- **Waiting:** In `cross_client` mode, `wait_for_turn` returns `timeout` after ~50 s; call it again until you get `your_turn`, `max_turns_reached` or `debate_closed`.
- **Scoreboard Guardrail:** Before calling `close_debate`, you must score every turn (`1..N`) using `score_turn` (`technical_evidence`, `rebuttal_strength`, `operational_viability`, `clarity`, each 1-10).
- **Export:** `export_debate` without `output_path` saves to `~/.roundtable_mcp/exports`. To save into the user's repository use a relative `.md` path such as `docs/adr/001-topic.md`; existing files there are never overwritten, so choose a new name.
