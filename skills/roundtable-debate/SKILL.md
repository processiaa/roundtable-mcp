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

## Enforcement Rules

- **Anti-Monologue Guardrail:** In `subagents` and `cross_client` modes, `post_argument` rejects any attempt by the same `agent_name` to post for multiple opposing positions. Each position must be defended by its own isolated subagent (with a unique `agent_name`, e.g. `Subagent-A-Opus`, `Subagent-B-Sonnet`) or separate client.
- **Scoreboard Guardrail:** Before calling `close_debate`, you must score every turn (`1..N`) using `score_turn` (`technical_evidence`, `rebuttal_strength`, `operational_viability`, `clarity`).
