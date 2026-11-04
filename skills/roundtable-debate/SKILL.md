---
name: roundtable-debate
description: Coordinate structured multi-agent debates and N-participant roundtables across Antigravity and Claude with platform-specific model and effort selection using the roundtable-mcp tools.
---

# Roundtable Debate Skill

Use this skill when the user wants two or more AI agents to debate a technical, architectural, or strategic topic.

## Platform-Specific Models and Effort

Call `get_client_models` (or inspect the current environment) to offer the exact models supported by the active client:

### 1. Google Antigravity (`client_platform: "antigravity"`)
- **Models (`invoke_subagent` `Model` parameter):**
  - `inherit` (Default - current session model)
  - `pro` (Deep architectural reasoning)
  - `flash` (Balanced speed and capability)
  - `flash_lite` (Fast, lightweight)
- **Reasoning Effort (`effort`):** `high`, `medium`, `low`

### 2. Anthropic Claude (`client_platform: "claude"`)
- **Models (`Task` subagent `model` parameter):**
  - `inherit` (Default - current session model)
  - `opus` (Deep complex reasoning)
  - `sonnet` (Balanced speed and quality)
  - `haiku` (Fast and lightweight)
- **Reasoning Effort (`effort`):** `high` (`ultrathink`), `medium` (`think`), `low`

## Available Workflows

### 1. Single-Client Multi-Agent Debate or Roundtable (Subagents)
1. Ask the user for the topic, positions/roles, platform model, and effort level.
2. Call `create_debate` with `debate_id`, `topic`, `client_platform`, `default_model`, `default_effort`, and `participants`.
3. Launch subagents passing the participant's `model` directly to the subagent tool (`invoke_subagent` in Antigravity or `Task` in Claude) and include `effort_directive` in each subagent's prompt.
4. Score each turn via `score_turn`, close via `close_debate`, and export the ADR via `export_debate`.

### 2. Automated Cross-Client Debate (Antigravity vs. Claude)
1. Call `wait_for_turn` with your assigned `position`.
2. When `wait_for_turn` returns `"event": "your_turn"`, follow the returned `effort_directive` and call `post_argument` passing the `model` and `effort` used.
