# roundtable-mcp

Model Context Protocol (MCP) server for orchestrating structured multi-agent debates and N-participant roundtables across different AI clients, including Google Antigravity, Claude Desktop, Claude Code, ChatGPT, and Cursor.

Supports both **Node.js (`npx`)** and **Python (`uvx`)** out of the box from the same repository.

Because all connected clients share the same persistent debate state (`~/.roundtable_mcp/debates.json`), you can either:
1. **Pit different AI clients against each other automatically** using `wait_for_turn` (for example, Antigravity defending Position A while Claude defends Position B).
2. **Run automated multi-agent debates or N-role roundtables** inside a single client using subagents.

---

## Features and MCP Tools

- `create_debate`: Initialize a classic 2-way debate (`position_a` vs. `position_b`) or an N-participant roundtable (`participants` array) with word limits, max rounds, and strict turn enforcement.
- `list_debates`: List all active or closed debates and see whose turn is next.
- `read_debate`: Read the full debate transcript, metadata, scoreboard, and turn status.
- `post_argument`: Submit an argument or rebuttal. Validates strict turn order (`next_expected_position`) and tracks word counts.
- `wait_for_turn`: Block/poll until the opposing client finishes its turn, enabling hands-free live debates between separate AI clients (e.g. Antigravity vs. Claude).
- `score_turn`: Score any turn on a 1-10 rubric (`technical_evidence`, `rebuttal_strength`, `operational_viability`, `clarity`) and automatically compute the aggregate `scoreboard`.
- `export_debate`: Export any debate as an **Architecture Decision Record (`adr`)** or clean **Markdown transcript (`markdown`)**, optionally writing it directly to a file in your repository.
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

### Scenario A: Hands-Free Cross-Client Debate (Antigravity vs. Claude)

1. **In Antigravity:**
   > "Using `roundtable-mcp`, create a 3-round debate `arch-01` on 'Microservices vs Modular Monolith'. For all 3 rounds, defend Position A: call `wait_for_turn` for Position A, post your argument with `post_argument`, and repeat until all rounds complete."

2. **In Claude:**
   > "Join debate `arch-01` in `roundtable-mcp` defending Position B. For all 3 rounds, call `wait_for_turn` for Position B, rebut Position A using `post_argument`, and repeat until all rounds complete."

3. **Scoring, Closing, and Exporting an ADR:**
   > "Read debate `arch-01`, score each turn with `score_turn`, close the debate with a final verdict, and export it as an ADR to `docs/adr/001-architecture.md` using `export_debate`."

### Scenario B: Multi-Role Roundtable (3+ Perspectives)

> "Create a roundtable in `roundtable-mcp` with 3 participants (`A`: Backend Architect, `B`: DevSecOps Engineer, `C`: FinOps Specialist) on 'Self-hosted Kubernetes vs Serverless Containers'. Run 2 rounds across subagents, score each turn, close with a synthesis, and export the ADR."

---

## Environment Variables

- `ROUNDTABLE_STORAGE_PATH`: Custom file path for storing debates JSON (defaults to `~/.roundtable_mcp/debates.json`).
