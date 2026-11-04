# roundtable-mcp

Model Context Protocol (MCP) server for orchestrating structured multi-agent debates and N-participant roundtables across **Google Antigravity** and **Anthropic Claude** (Claude Code / Claude Desktop).

Supports both **Node.js (`npx`)** and **Python (`uvx`)** out of the box from the same repository.

---

## Features and MCP Tools

- `get_client_models`: Automatically detects whether the connected client is **Antigravity** or **Claude** and returns the native models and effort levels for that platform:
  - **Antigravity models:** `inherit`, `pro`, `flash`, `flash_lite` + effort (`high`, `medium`, `low`).
  - **Claude models:** `inherit`, `opus`, `sonnet`, `haiku` + effort (`high` / `ultrathink`, `medium` / `think`, `low`).
- `create_debate`: Initialize a 2-way debate or N-participant roundtable with platform-specific `default_model`, `default_effort`, or per-participant model/effort overrides.
- `list_debates`: List all active or closed debates and see whose turn is next.
- `read_debate`: Read the full debate transcript, model/effort profiles, scoreboard, and turn status.
- `post_argument`: Submit an argument or rebuttal. Enforces strict turn order, tracks word counts, and records the `model` and `effort` used on each turn.
- `wait_for_turn`: Block/poll until the opposing client finishes its turn, returning the participant's assigned model and `effort_directive`.
- `score_turn`: Score any turn on a 1-10 rubric (`technical_evidence`, `rebuttal_strength`, `operational_viability`, `clarity`) and update the aggregate `scoreboard`.
- `export_debate`: Export any debate as an **Architecture Decision Record (`adr`)** or **Markdown transcript (`markdown`)** including model and effort metadata per turn.
- `close_debate`: Close the debate and record the final synthesis and verdict.
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
        "github:processiaa/roundtable-mcp"
      ]
    }
  }
}
```

In **Claude Code (CLI)**:

```bash
claude mcp add roundtable-mcp -- npx -y github:processiaa/roundtable-mcp
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
