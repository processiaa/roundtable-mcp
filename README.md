# roundtable-mcp

Model Context Protocol (MCP) server for orchestrating structured multi-agent debates and N-participant roundtables across **Google Antigravity** and **Anthropic Claude** (Claude Code / Claude Desktop).

Runs on **Node.js (`npx`)**. The Python (`uvx`) implementation was removed in v0.5.0 (see [Upgrading from v0.4](#upgrading-from-v04)).

---

## Execution Modes (`execution_mode`)

1. **`subagents` (Multi-Agent inside a single client: Claude or Antigravity)**
   - The main agent acts as Moderator/Judge and spawns an isolated subagent per position (`Task`/`Agent` in Claude, `invoke_subagent` in Antigravity) with the selected model and effort.
   - **Anti-Monologue Guardrail:** `post_argument` blocks a single `agent_name` from defending multiple positions.
2. **`cross_client` (Live fight between separate AI clients: Antigravity vs. Claude)**
   - Each client window defends its assigned position, posts via `post_argument`, and calls `wait_for_turn` to wait for the opposing client.
3. **`single_agent` (Roleplay fallback)**
   - Used only when a client has no subagent capability and the user explicitly requests single-agent simulation.

> The guardrails guide well-behaved agents; they are not a security boundary. `agent_name`, `model` and `effort` are self-reported, and `force: true` bypasses turn order and the anti-monologue check (forced turns are marked `"forced": true`).

---

## Platform-Specific Models and Effort

- **Google Antigravity (`client_platform: "antigravity"`):**
  - Models: `inherit`, `pro`, `flash`, `flash_lite`
  - Effort: `high`, `medium`, `low`
- **Anthropic Claude (`client_platform: "claude"`):**
  - Models: `inherit`, `opus`, `sonnet`, `haiku`
  - Effort: `high` (`ultrathink`), `medium` (`think`), `low`

Models are validated against the participant's platform (e.g. `pro` is rejected for a Claude participant). In `participants`, each entry may set its own `platform`, so a cross-client debate can mix Claude and Antigravity models.

---

## MCP Tools

| Tool | Purpose |
| :--- | :--- |
| `get_client_models` | Available models and effort levels for `antigravity` and `claude`. |
| `create_debate` | Start a 2-way debate or N-participant roundtable. `client_platform`, `execution_mode`, `default_model` and `default_effort` are required. **Rejects an existing `debate_id`** unless `overwrite: true`. |
| `list_debates` | List debates (`all` / `open` / `closed`) and whose turn is next. |
| `read_debate` | Full transcript, model/effort profiles, scoreboard and turn status. |
| `post_argument` | Submit an argument. Enforces turn order, valid positions, the anti-monologue rule and the word limit. |
| `wait_for_turn` | Block until it is your position's turn (default 50 s, sends MCP progress notifications). Returns `timeout` so you can call it again. |
| `score_turn` | Score a turn 1-10 on `technical_evidence`, `rebuttal_strength`, `operational_viability`, `clarity`. |
| `close_debate` | Record the verdict. Requires at least one turn and every turn scored (unless `force: true`). `winner` must be a position id, `synthesis` or `draw`. |
| `export_debate` | Export as an **ADR** (`adr`) or transcript (`markdown`). See [Exports](#exports). |
| `delete_debate` | Remove a debate. |

Every rejection (out-of-turn, monologue, duplicate id, invalid score, not found, …) is returned with **`isError: true`**, so clients show it as a failed tool call.

### Validation rules

- `debate_id`: 1-100 characters, letters/digits/`.`/`_`/`-` (it is used as a file name).
- `max_rounds`: integer 1-20 (default 3). `max_words`: integer 20-5000 (default 200).
- `word_limit_mode`: `reject` (default) warns up to `max_words` **+15%** and rejects above that without recording the turn; `warn` never rejects. Debates created before v0.5 behave as `warn`.
- Participant ids must be unique (1-16 letters, digits, `_`, `-`).
- Scores must be numbers between 1 and 10. Closed debates cannot be re-scored.

---

## Exports

`export_debate` only writes `.md` files, and only inside allowed folders:

| `output_path` | Written to | Overwrite? |
| :--- | :--- | :---: |
| *(omitted)* | `~/.roundtable_mcp/exports/<debate_id>-<format>.md` | yes |
| `001-decision.md` (bare name) | `~/.roundtable_mcp/exports/001-decision.md` | yes |
| `docs/adr/001.md` (relative) | the project folder your client shares via MCP *roots* | **no** |
| `/abs/path/001.md` | must be inside an MCP root or `ROUNDTABLE_EXPORT_ROOTS` | **no** |

Outside the exports folder existing files are never replaced, so a prompt-injected export cannot clobber code or configuration. If your client does not share MCP roots, either pass an absolute path inside a folder listed in `ROUNDTABLE_EXPORT_ROOTS` or export to the exports folder.

---

## Installation

Pin a release tag so every client runs the same version (`npx` caches GitHub installs, and `--prefer-online` alone does not guarantee you get the latest commit).

### Windows (`mcp_config.json` / `claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "roundtable-mcp": {
      "command": "npx.cmd",
      "args": ["-y", "github:processiaa/roundtable-mcp#v0.5.0"]
    }
  }
}
```

### macOS / Linux

```json
{
  "mcpServers": {
    "roundtable-mcp": {
      "command": "npx",
      "args": ["-y", "github:processiaa/roundtable-mcp#v0.5.0"]
    }
  }
}
```

### Claude Code (CLI)

```bash
claude mcp add roundtable-mcp -- npx -y github:processiaa/roundtable-mcp#v0.5.0
```

---

## Storage

Each debate lives in its own file: `~/.roundtable_mcp/debates/<debate_id>.json`.

- Writes take a per-debate lock (`~/.roundtable_mcp/locks/`), so several MCP processes (e.g. Claude and Antigravity in `cross_client` mode) can write at the same time without losing updates. Locks older than 10 s are treated as left behind by a crashed process and removed.
- Writes are atomic (temp file + rename) and retried on transient Windows errors (`EPERM`, `EBUSY`).
- A file that cannot be read or parsed raises an error and is left untouched; it is never replaced by an empty store.

## Environment Variables

- `ROUNDTABLE_STORAGE_PATH`: base folder for storage (default `~/.roundtable_mcp`). A path ending in `.json` (v0.4 style) is still accepted: that file is migrated and the new layout is created next to it.
- `ROUNDTABLE_EXPORT_ROOTS`: extra folders where `export_debate` may write, separated by `;` on Windows and `:` on macOS/Linux.

---

## Upgrading from v0.4

- On first start, v0.5 moves every debate from `debates.json` into `debates/<id>.json` and renames the old file to `debates.json.bak` (it is never deleted). Debates whose id is not a valid file name are reported on stderr and stay in the backup.
- The `uvx` / Python package is gone. Switch your config to the `npx` command above.
- `create_debate` no longer replaces an existing debate silently: pass `overwrite: true` to do that.
- `wait_for_turn` defaults to 50 s (was 90 s) because many MCP clients abort tool calls after 60 s; call it again on `timeout`.

---

## Development

```bash
npm install
npm test        # node --test: unit, export-safety, multi-process concurrency and stdio end-to-end tests
```
