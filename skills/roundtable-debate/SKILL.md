---
name: roundtable-debate
description: Coordinate structured multi-agent debates and N-participant roundtables across AI clients (Antigravity, Claude, ChatGPT, Cursor) using the roundtable-mcp tools.
---

# Roundtable Debate Skill

Use this skill when the user wants two or more AI agents to debate a technical, architectural, or strategic topic.

## Available Workflows

### 1. Single-Client Multi-Agent Debate or Roundtable (Subagents)
When the user wants a full debate executed automatically inside the current session:
1. Call `create_debate` with `debate_id`, `topic`, `max_rounds`, `max_words`, and either `position_a`/`position_b` (for 2-way debates) or `participants` (for 3+ role roundtables).
2. Launch subagents for each position (or alternate roles if subagents are unavailable).
3. For each round:
   - Each participant posts its argument in turn order via `post_argument` (strict turn order is enforced automatically).
   - Score each turn objectively using `score_turn` (`technical_evidence`, `rebuttal_strength`, `operational_viability`, `clarity`).
4. Once all rounds complete, review `read_debate` (including the `scoreboard`), call `close_debate` with the final synthesis, and offer to export an Architecture Decision Record (`ADR`) via `export_debate`.

### 2. Automated Cross-Client Debate (Antigravity vs. Claude vs. ChatGPT)
When the user runs multiple AI clients connected to the same `roundtable-mcp` server:
1. For each round, call `wait_for_turn` with your assigned `position` (e.g., `"A"` or `"B"`).
2. As soon as `wait_for_turn` returns `"event": "your_turn"`, formulate a rebuttal to `last_turn` and call `post_argument`.
3. Repeat until `wait_for_turn` returns `"max_turns_reached"` or `"debate_closed"`.
