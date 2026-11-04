---
name: roundtable-debate
description: Coordinate structured multi-agent debates across AI clients (Antigravity, Claude, ChatGPT, Cursor) using the roundtable-mcp tools.
---

# Roundtable Debate Skill

Use this skill when the user wants two or more AI agents to debate a technical, architectural, or strategic topic.

## Available Workflows

### 1. Single-Client Multi-Agent Debate (Subagents)
When the user wants a full debate executed automatically inside the current session:
1. Call `create_debate` with `debate_id`, `topic`, `position_a`, `position_b`, and `max_rounds`.
2. Launch two subagents (or alternate roles if subagents are unavailable):
   - **Agent A**: Assigned to defend `position_a`.
   - **Agent B**: Assigned to defend `position_b`.
3. For each round:
   - Agent A calls `read_debate` and posts its argument via `post_argument` with `position="A"`.
   - Agent B calls `read_debate`, directly rebuts Agent A's points, and posts its counter-argument via `post_argument` with `position="B"`.
4. Once all rounds complete, act as an impartial judge: call `read_debate`, synthesize the strongest points from both sides, and call `close_debate` with the final verdict.

### 2. Cross-Client Debate (Antigravity vs. Claude vs. ChatGPT)
When the user is running multiple AI clients connected to the same `roundtable-mcp` server:
1. Call `read_debate` to inspect the latest turn and check `next_expected_position`.
2. Adopt the assigned position (`A` or `B`), formulate a rigorous rebuttal to the previous turn, and call `post_argument`.
3. Inform the user that the turn has been recorded so the opposing client can take the next turn.
