# roundtable-mcp

Model Context Protocol (MCP) server for orchestrating structured multi-agent debates and N-participant roundtables across **Google Antigravity** and **Anthropic Claude** (Claude Code / Claude Desktop).

Supports both **Node.js (`npx`)** and **Python (`uvx`)** out of the box from the same repository.

---

## Execution Modes (`execution_mode`)

1. **`subagents` (Multi-Agent inside a single client: Claude or Antigravity)**
   - The main agent acts as Moderator/Judge and spawns an isolated subagent per position (`Task`/`Agent` in Claude, `invoke_subagent` in Antigravity) with the selected model and effort.
   - **Anti-Monologue Guardrail:** `post_argument` blocks a single `agent_name` from defending multiple positions.
2. **`cross_client` (Live fight between separate AI clients: Antigravity vs. Claude)**
   - Each client window defends its assigned position, posts via `post_argument`, and calls `wait_for_turn` to wait for the opposing client.
3. **`single_agent` (Roleplay fallback)**
   - Used only when a client has no subagent capability and the user explicitly requests single-agent simulation.

---

## Platform-Specific Models and Effort

- **Google Antigravity (`client_platform: "antigravity"`):**
  - Models: `inherit`, `pro`, `flash`, `flash_lite`
  - Effort: `high`, `medium`, `low`
- **Anthropic Claude (`client_platform: "claude"`):**
  - Models: `inherit`, `opus`, `sonnet`, `haiku`
  - Effort: `high` (`ultrathink`), `medium` (`think`), `low`

---

## Features and MCP Tools

- `get_client_models`: Return available models and effort levels for `antigravity` and `claude`.
- `create_debate`: Initialize a 2-way debate or N-participant roundtable (`client_platform`, `execution_mode`, `default_model`, and `default_effort` are required so the agent asks the user before starting).
- `list_debates`: List all active or closed debates and see whose turn is next.
- `read_debate`: Read the full debate transcript, model/effort profiles, scoreboard, and turn status.
- `post_argument`: Submit an argument or rebuttal. Enforces strict turn order, blocks single-agent monologues in `subagents`/`cross_client` modes, and records `model` and `effort`.
- `wait_for_turn`: Block/poll until the opposing client finishes its turn.
- `score_turn`: Score any turn on a 1-10 rubric (`technical_evidence`, `rebuttal_strength`, `operational_viability`, `clarity`).
- `close_debate`: Close the debate and record the final synthesis and verdict (requires all turns to be scored via `score_turn` first).
- `export_debate`: Export any debate as an **Architecture Decision Record (`adr`)** or **Markdown transcript (`markdown`)**.
- `delete_debate`: Remove a debate session from storage.

---

## Quick Installation (Direct from GitHub)

### Option A: Using `npx` (Node.js - Recommended)

On Windows (`mcp_config.json` / `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "roundtable-mcp": {
      "command": "npx.cmd",
      "args": [
        "-y",
        "--prefer-online",
        "github:processiaa/roundtable-mcp"
      ]
    }
  }
}
```

On macOS / Linux:

```json
{
  "mcpServers": {
    "roundtable-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "--prefer-online",
        "github:processiaa/roundtable-mcp"
      ]
    }
  }
}
```

In **Claude Code (CLI)**:

```bash
claude mcp add roundtable-mcp -- npx -y --prefer-online github:processiaa/roundtable-mcp
```

---

### Option B: Using `uvx` (Python)

```json
{
  "mcpServers": {
    "roundtable-mcp": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/processiaa/roundtable-mcp.git",
        "roundtable-mcp"
      ]
    }
  }
}
```

---

## Environment Variables

- `ROUNDTABLE_STORAGE_PATH`: Custom file path for storing debates JSON (defaults to `~/.roundtable_mcp/debates.json`).
