# roundtable-mcp

Model Context Protocol (MCP) server for orchestrating structured multi-agent debates across different AI clients, including Google Antigravity, Claude Desktop, Claude Code, ChatGPT, and Cursor.

Supports both **Node.js (`npx`)** and **Python (`uvx`)** out of the box from the same repository.

Because all connected clients share the same persistent debate state (`~/.roundtable_mcp/debates.json`), you can either:
1. **Pit different AI clients against each other** (for example, Antigravity defending Position A while Claude defends Position B).
2. **Run automated multi-agent debates** inside a single client using subagents.

---

## Features and MCP Tools

- `create_debate`: Initialize a debate room with a topic, Position A, Position B, rules, and maximum rounds.
- `list_debates`: List all active or closed debates and see whose turn is next.
- `read_debate`: Read the full debate transcript, metadata, and turn status.
- `post_argument`: Submit an argument or rebuttal for Position A or Position B.
- `close_debate`: Close the debate and record the final synthesis and verdict.
- `delete_debate`: Remove a debate session from storage.

---

## Quick Installation (Direct from GitHub)

You do not need to clone this repository manually. Any MCP-compatible client can run it directly from GitHub using either **`npx`** (Node.js) or **`uvx`** (Python).

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

In **Claude Code (CLI)**:

```bash
claude mcp add roundtable-mcp -- uvx --from git+https://github.com/processiaa/roundtable-mcp.git roundtable-mcp
```

---

## Usage Examples

### Scenario A: Cross-Client Debate (Antigravity vs. Claude)

1. **In Antigravity:**
   > "Using `roundtable-mcp`, create a debate with ID `arch-01` on the topic 'Microservices vs Modular Monolith for a 10-engineer startup', where Position A is Microservices and Position B is Modular Monolith (3 rounds). Then post Turn 1 as Antigravity defending Position A."

2. **In Claude:**
   > "Read debate `arch-01` from `roundtable-mcp` and post Turn 2 as Claude defending Position B, rebutting Antigravity's argument."

3. **Closing the Debate:**
   > "Read debate `arch-01` from `roundtable-mcp`, evaluate all rounds objectively, and close the debate with a final verdict."

### Scenario B: Automated Subagent Debate in One Client

> "Create a 3-round debate in `roundtable-mcp` about PostgreSQL vs MongoDB for an event-driven billing system. Spawn two subagents to debate each side turn by turn using the MCP tools, and then close the debate with your final synthesis."

---

## Environment Variables

- `ROUNDTABLE_STORAGE_PATH`: Custom file path for storing debates JSON (defaults to `~/.roundtable_mcp/debates.json`).
