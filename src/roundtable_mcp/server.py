import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("roundtable-mcp")

DEFAULT_STORAGE_DIR = Path.home() / ".roundtable_mcp"
STORAGE_FILE = Path(
    os.environ.get("ROUNDTABLE_STORAGE_PATH", str(DEFAULT_STORAGE_DIR / "debates.json"))
)

PLATFORM_PROFILES: dict[str, dict[str, Any]] = {
    "antigravity": {
        "platform": "antigravity",
        "display_name": "Google Antigravity",
        "subagent_tool": "invoke_subagent (parameter Model: 'inherit' | 'pro' | 'flash' | 'flash_lite')",
        "models": [
            {"id": "inherit", "label": "Inherit (Usar el modelo actual de la sesion)"},
            {"id": "pro", "label": "Pro (Maximo razonamiento arquitectonico)"},
            {"id": "flash", "label": "Flash (Balance entre velocidad y capacidad)"},
            {"id": "flash_lite", "label": "Flash Lite (Ultraligero y rapido)"},
        ],
        "efforts": [
            {
                "id": "high",
                "label": "High (Analisis exhaustivo, casos borde y evidencia profunda)",
                "directive": (
                    "EFFORT=HIGH: Perform deep step-by-step technical analysis, evaluate production "
                    "edge cases, failure modes, and concrete architectural trade-offs before formulating your argument."
                ),
            },
            {
                "id": "medium",
                "label": "Medium (Balanceado, directo al punto con soporte tecnico)",
                "directive": (
                    "EFFORT=MEDIUM: Provide a balanced, well-structured technical argument directly "
                    "addressing the opponent's points."
                ),
            },
            {
                "id": "low",
                "label": "Low (Sintetico y rapido, enfocado en ideas clave)",
                "directive": (
                    "EFFORT=LOW: Be brief and direct, focusing only on the top 2 core arguments "
                    "without extended deliberation."
                ),
            },
        ],
    },
    "claude": {
        "platform": "claude",
        "display_name": "Anthropic Claude",
        "subagent_tool": "Task / Agent tool (parameter model: 'opus' | 'sonnet' | 'haiku')",
        "models": [
            {"id": "inherit", "label": "Inherit (Usar el modelo actual de la sesion)"},
            {"id": "opus", "label": "Claude Opus (Maximo razonamiento complejo)"},
            {"id": "sonnet", "label": "Claude Sonnet (Balance ideal velocidad/calidad)"},
            {"id": "haiku", "label": "Claude Haiku (Rapido y ligero)"},
        ],
        "efforts": [
            {
                "id": "high",
                "label": "High (Ultrathink - Razonamiento extendido al maximo)",
                "directive": (
                    "EFFORT=HIGH (ultrathink): Engage maximum extended thinking, stress-test every assumption, "
                    "evaluate production failure modes, and build an airtight technical rebuttal."
                ),
            },
            {
                "id": "medium",
                "label": "Medium (Think - Razonamiento estandar estructurado)",
                "directive": (
                    "EFFORT=MEDIUM (think): Think carefully through the opponent's points and provide "
                    "a rigorous, structured counter-argument."
                ),
            },
            {
                "id": "low",
                "label": "Low (Respuesta directa sin pensamiento extendido)",
                "directive": "EFFORT=LOW: Respond concisely and directly with the primary technical arguments.",
            },
        ],
    },
}


def _detect_client_platform(explicit_platform: Optional[str] = None) -> str:
    if explicit_platform:
        clean = explicit_platform.strip().lower()
        if "claude" in clean or "anthropic" in clean:
            return "claude"
        if "antigravity" in clean or "agy" in clean or "gemini" in clean:
            return "antigravity"
    env_keys = " ".join(os.environ.keys()).upper()
    if (
        os.environ.get("CLAUDECODE")
        or os.environ.get("CLAUDE_ENTRYPOINT")
        or os.environ.get("CLAUDE_CONFIG_DIR")
        or "CLAUDE" in env_keys
    ):
        return "claude"
    if (
        os.environ.get("ANTIGRAVITY_CLI_ALIAS")
        or os.environ.get("AGY_ACCOUNT")
        or "ANTIGRAVITY" in env_keys
    ):
        return "antigravity"
    return "antigravity"


def _get_effort_directive(platform: str, effort_id: str) -> str:
    profile = PLATFORM_PROFILES.get(platform, PLATFORM_PROFILES["antigravity"])
    clean_effort = (effort_id or "high").strip().lower()
    for item in profile["efforts"]:
        if item["id"] == clean_effort:
            return item["directive"]
    return profile["efforts"][0]["directive"]


def _load_debates() -> dict:
    if not STORAGE_FILE.exists():
        return {}
    try:
        return json.loads(STORAGE_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _save_debates(data: dict) -> None:
    STORAGE_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp_file = STORAGE_FILE.with_suffix(f".{os.getpid()}.tmp")
    temp_file.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    temp_file.replace(STORAGE_FILE)


def _normalize_participants(
    position_a: Optional[str],
    position_b: Optional[str],
    participants_input: Optional[list[Any]],
    default_platform: str = "antigravity",
    default_model: str = "inherit",
    default_effort: str = "high",
) -> list[dict[str, str]]:
    effort_norm = (default_effort or "high").strip().lower()
    if isinstance(participants_input, list) and len(participants_input) >= 2:
        normalized = []
        for idx, item in enumerate(participants_input):
            default_id = chr(65 + idx)
            if isinstance(item, str):
                normalized.append(
                    {
                        "id": default_id,
                        "role": item,
                        "platform": default_platform,
                        "model": default_model,
                        "effort": effort_norm,
                        "effort_directive": _get_effort_directive(default_platform, effort_norm),
                    }
                )
            elif isinstance(item, dict):
                p_id = str(item.get("id") or default_id).strip().upper()
                role = str(item.get("role") or item.get("position") or f"Position {default_id}")
                p_platform = str(item.get("platform") or default_platform).strip().lower()
                p_model = str(item.get("model") or default_model).strip()
                p_effort = str(item.get("effort") or effort_norm).strip().lower()
                normalized.append(
                    {
                        "id": p_id,
                        "role": role,
                        "platform": p_platform,
                        "model": p_model,
                        "effort": p_effort,
                        "effort_directive": _get_effort_directive(p_platform, p_effort),
                    }
                )
        return normalized

    directive = _get_effort_directive(default_platform, effort_norm)
    return [
        {
            "id": "A",
            "role": position_a or "Position A",
            "platform": default_platform,
            "model": default_model,
            "effort": effort_norm,
            "effort_directive": directive,
        },
        {
            "id": "B",
            "role": position_b or "Position B",
            "platform": default_platform,
            "model": default_model,
            "effort": effort_norm,
            "effort_directive": directive,
        },
    ]


def _compute_scoreboard(debate: dict) -> dict:
    board: dict[str, dict[str, Any]] = {}
    participants = debate.get("participants") or [
        {"id": "A", "role": debate.get("position_a") or "Position A"},
        {"id": "B", "role": debate.get("position_b") or "Position B"},
    ]
    for p in participants:
        board[p["id"]] = {
            "role": p["role"],
            "platform": p.get("platform") or debate.get("client_platform") or "antigravity",
            "model": p.get("model") or debate.get("default_model") or "inherit",
            "effort": p.get("effort") or debate.get("default_effort") or "high",
            "scored_turns": 0,
            "total_points": 0.0,
            "average_score": 0.0,
        }
    for turn in debate.get("turns", []):
        score = turn.get("score")
        if isinstance(score, dict) and isinstance(score.get("average"), (int, float)):
            pos = turn.get("position", "A")
            if pos not in board:
                board[pos] = {
                    "role": pos,
                    "platform": debate.get("client_platform") or "antigravity",
                    "model": turn.get("model") or "inherit",
                    "effort": turn.get("effort") or "high",
                    "scored_turns": 0,
                    "total_points": 0.0,
                    "average_score": 0.0,
                }
            board[pos]["scored_turns"] += 1
            board[pos]["total_points"] = round(
                board[pos]["total_points"] + float(score["average"]), 2
            )
            board[pos]["average_score"] = round(
                board[pos]["total_points"] / board[pos]["scored_turns"], 2
            )
    return board


def _format_debate_markdown(debate: dict, fmt: str = "adr") -> str:
    participants = debate.get("participants") or [
        {"id": "A", "role": debate.get("position_a") or "Position A"},
        {"id": "B", "role": debate.get("position_b") or "Position B"},
    ]
    lines: list[str] = []

    if fmt == "adr":
        lines.append(f"# ADR: {debate.get('topic')}")
        lines.append("")
        lines.append(f"- **Debate ID:** `{debate.get('debate_id')}`")
        status_label = "Accepted / Closed" if debate.get("status") == "closed" else "Proposed / Open"
        lines.append(f"- **Status:** {status_label}")
        lines.append(f"- **Platform:** {debate.get('client_platform') or 'antigravity'}")
        lines.append(f"- **Execution Mode:** `{debate.get('execution_mode') or 'subagents'}`")
        lines.append(
            f"- **Default Model / Effort:** `{debate.get('default_model') or 'inherit'}` / "
            f"`{debate.get('default_effort') or 'high'}`"
        )
        lines.append(f"- **Created At:** {debate.get('created_at')}")
        if debate.get("closed_at"):
            lines.append(f"- **Decided At:** {debate.get('closed_at')}")
        if debate.get("winner"):
            lines.append(f"- **Selected Outcome:** {debate.get('winner')}")
        lines.append("")
        lines.append("## 1. Context and Problem Statement")
        lines.append("")
        lines.append(f"Topic evaluated: **{debate.get('topic')}**")
        lines.append("")
        lines.append(f"Rules applied: {debate.get('rules') or 'Standard technical debate rules.'}")
        lines.append("")
        lines.append("## 2. Considered Options (Positions and Model Profiles)")
        lines.append("")
        for p in participants:
            lines.append(
                f"- **Position {p['id']}** [Platform: `{p.get('platform') or 'antigravity'}`, "
                f"Model: `{p.get('model') or 'inherit'}`, Effort: `{p.get('effort') or 'high'}`]: {p['role']}"
            )
        lines.append("")
        lines.append("## 3. Deliberation and Key Arguments")
        lines.append("")
        for turn in debate.get("turns", []):
            model_tag = f" | Model: {turn.get('model')}" if turn.get("model") else ""
            effort_tag = f" | Effort: {turn.get('effort')}" if turn.get("effort") else ""
            lines.append(
                f"### Round {turn.get('round')} - Turn {turn.get('turn')}: "
                f"{turn.get('agent')} (Position {turn.get('position')}{model_tag}{effort_tag})"
            )
            lines.append("")
            lines.append(str(turn.get("argument", "")))
            score = turn.get("score")
            if isinstance(score, dict):
                lines.append("")
                lines.append(
                    f"*Score ({score.get('judge')}): {score.get('average')}/10 "
                    f"(Evidence: {score.get('technical_evidence')}, "
                    f"Rebuttal: {score.get('rebuttal_strength')}, "
                    f"Viability: {score.get('operational_viability')}, "
                    f"Clarity: {score.get('clarity')})*"
                )
                if score.get("notes"):
                    lines.append(f"*Judge Notes: {score.get('notes')}*")
            lines.append("")
        scoreboard = debate.get("scoreboard")
        if isinstance(scoreboard, dict):
            lines.append("## 4. Evaluation Scoreboard")
            lines.append("")
            lines.append(
                "| Position | Role | Model | Effort | Scored Turns | Total Points | Average Score (1-10) |"
            )
            lines.append("| :--- | :--- | :---: | :---: | :---: | :---: | :---: |")
            for pos_id, stats in scoreboard.items():
                lines.append(
                    f"| {pos_id} | {stats.get('role')} | {stats.get('model') or 'inherit'} | "
                    f"{stats.get('effort') or 'high'} | {stats.get('scored_turns')} | "
                    f"{stats.get('total_points')} | {stats.get('average_score')} |"
                )
            lines.append("")
        lines.append("## 5. Decision Outcome and Verdict")
        lines.append("")
        lines.append(f"**Outcome:** {debate.get('winner') or 'Pending'}")
        lines.append("")
        lines.append(
            debate.get("verdict") or "Debate is still open; no final verdict recorded yet."
        )
        lines.append("")
    else:
        lines.append(f"# Debate Transcript: {debate.get('topic')}")
        lines.append("")
        lines.append(f"- **ID:** `{debate.get('debate_id')}`")
        lines.append(f"- **Status:** {debate.get('status')}")
        lines.append(f"- **Execution Mode:** {debate.get('execution_mode') or 'subagents'}")
        lines.append(f"- **Rounds:** {debate.get('max_rounds')}")
        lines.append("")
        lines.append("## Positions")
        lines.append("")
        for p in participants:
            lines.append(
                f"- **{p['id']}** (Model: `{p.get('model') or 'inherit'}`, "
                f"Effort: `{p.get('effort') or 'high'}`): {p['role']}"
            )
        lines.append("")
        lines.append("## Turns")
        lines.append("")
        for turn in debate.get("turns", []):
            model_tag = f" | Model: {turn.get('model')}" if turn.get("model") else ""
            effort_tag = f" | Effort: {turn.get('effort')}" if turn.get("effort") else ""
            lines.append(
                f"### [Round {turn.get('round')} | Turn {turn.get('turn')}] "
                f"{turn.get('agent')} (Position {turn.get('position')}{model_tag}{effort_tag})"
            )
            lines.append("")
            lines.append(str(turn.get("argument", "")))
            lines.append("")
        if debate.get("verdict"):
            lines.append("## Verdict")
            lines.append("")
            lines.append(f"**Winner / Synthesis:** {debate.get('winner')}")
            lines.append("")
            lines.append(str(debate.get("verdict")))
            lines.append("")

    return "\n".join(lines)


@mcp.tool()
def get_client_models(platform: Optional[str] = None) -> str:
    """Return the available models and effort levels for Antigravity ('inherit', 'pro', 'flash', 'flash_lite') or Claude ('inherit', 'opus', 'sonnet', 'haiku')."""
    detected = _detect_client_platform(platform)
    return json.dumps(
        {
            "detected_platform": detected,
            "active_profile": PLATFORM_PROFILES[detected],
            "all_supported_platforms": PLATFORM_PROFILES,
        },
        indent=2,
        ensure_ascii=False,
    )


@mcp.tool()
def create_debate(
    debate_id: str,
    topic: str,
    client_platform: str,
    execution_mode: str,
    default_model: str,
    default_effort: str,
    position_a: Optional[str] = None,
    position_b: Optional[str] = None,
    participants: Optional[list[dict[str, str]]] = None,
    max_rounds: int = 3,
    max_words: int = 200,
    strict_turn_order: bool = True,
    rules: str = "Be concise, address the previous turn directly, and provide technical evidence.",
) -> str:
    """Create a new debate or N-participant roundtable session.
    MANDATORY PRE-CHECK: Before calling create_debate, if the user did NOT explicitly specify
    (1) execution_mode ('subagents', 'cross_client', or 'single_agent'),
    (2) default_model (Claude: 'inherit', 'opus', 'sonnet', 'haiku' | Antigravity: 'inherit', 'pro', 'flash', 'flash_lite'), and
    (3) default_effort ('high', 'medium', 'low'), you MUST ask the user to choose them first!"""
    debates = _load_debates()
    detected_platform = _detect_client_platform(client_platform)
    profile = PLATFORM_PROFILES.get(detected_platform, PLATFORM_PROFILES["antigravity"])
    norm_participants = _normalize_participants(
        position_a,
        position_b,
        participants,
        detected_platform,
        default_model,
        default_effort,
    )

    debates[debate_id] = {
        "debate_id": debate_id,
        "topic": topic,
        "client_platform": detected_platform,
        "execution_mode": execution_mode,
        "default_model": default_model,
        "default_effort": default_effort.strip().lower(),
        "position_a": norm_participants[0]["role"],
        "position_b": norm_participants[1]["role"] if len(norm_participants) > 1 else "Position B",
        "participants": norm_participants,
        "max_rounds": max_rounds,
        "max_words": max_words,
        "strict_turn_order": strict_turn_order,
        "rules": rules,
        "status": "open",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "next_expected_position": norm_participants[0]["id"],
        "turns": [],
        "scoreboard": _compute_scoreboard(
            {
                "client_platform": detected_platform,
                "default_model": default_model,
                "default_effort": default_effort,
                "participants": norm_participants,
                "turns": [],
            }
        ),
        "verdict": None,
        "winner": None,
    }
    _save_debates(debates)

    participant_summary = "\n".join(
        f"Position {p['id']} [Platform: {p['platform']}, Model: {p['model']}, Effort: {p['effort']}]: {p['role']}"
        for p in norm_participants
    )

    mode_instructions = ""
    if execution_mode == "subagents":
        mode_instructions = (
            f"\nMANDATORY EXECUTION RULES (execution_mode='subagents'):\n"
            f"1. Do NOT post arguments for multiple positions from your main agent context.\n"
            f"2. Spawn an isolated subagent for each position using {profile['subagent_tool']}.\n"
            f"3. Pass each participant's configured model ('{default_model}') and effort_directive to its subagent.\n"
            f"4. Each subagent MUST use a distinct agent_name (e.g. 'Subagent-A', 'Subagent-B'). Reusing the same agent_name across different positions will be rejected by post_argument.\n"
            f"5. After all turns complete, score every turn with score_turn before calling close_debate."
        )
    elif execution_mode == "cross_client":
        mode_instructions = (
            f"\nMANDATORY EXECUTION RULES (execution_mode='cross_client'):\n"
            f"1. Defend ONLY your assigned position in this client window.\n"
            f"2. After calling post_argument for your position, call wait_for_turn to wait for the opposing AI client (Antigravity / Claude) to submit its turn."
        )

    return (
        f"Debate '{debate_id}' created.\n"
        f"Topic: {topic}\n"
        f"Platform: {detected_platform}\n"
        f"Execution Mode: {execution_mode}\n"
        f"{participant_summary}\n"
        f"Max rounds: {max_rounds} ({max_rounds * len(norm_participants)} total turns)\n"
        f"Word limit per turn: {max_words}\n"
        f"Next turn: Position {norm_participants[0]['id']}\n"
        f"{mode_instructions}"
    )


@mcp.tool()
def list_debates(status: str = "all") -> str:
    """List available debates. Filter by status: 'all', 'open', or 'closed'."""
    debates = _load_debates()
    if not debates:
        return "No debates found."

    filtered = []
    for d_id, info in debates.items():
        if status != "all" and info.get("status") != status:
            continue
        num_participants = len(info.get("participants") or []) or 2
        filtered.append(
            {
                "debate_id": d_id,
                "topic": info.get("topic"),
                "status": info.get("status"),
                "client_platform": info.get("client_platform", "antigravity"),
                "execution_mode": info.get("execution_mode", "subagents"),
                "default_model": info.get("default_model", "inherit"),
                "default_effort": info.get("default_effort", "high"),
                "turns_count": len(info.get("turns", [])),
                "max_turns": info.get("max_rounds", 3) * num_participants,
                "next_expected_position": info.get("next_expected_position"),
                "winner": info.get("winner"),
            }
        )
    return json.dumps(filtered, indent=2, ensure_ascii=False)


@mcp.tool()
def read_debate(debate_id: str) -> str:
    """Read the full state, model/effort profile, scoreboard, and transcript of a debate, including whose turn is next."""
    debates = _load_debates()
    if debate_id not in debates:
        available = list(debates.keys())
        return f"Debate '{debate_id}' not found. Available debates: {available}"
    return json.dumps(debates[debate_id], indent=2, ensure_ascii=False)


@mcp.tool()
def post_argument(
    debate_id: str,
    agent_name: str,
    position: str,
    argument: str,
    model: Optional[str] = None,
    effort: Optional[str] = None,
    force: bool = False,
) -> str:
    """Post an argument or rebuttal to an open debate. In 'subagents' and 'cross_client' modes, each position MUST have a distinct agent_name."""
    debates = _load_debates()
    if debate_id not in debates:
        return f"Debate '{debate_id}' not found."

    debate = debates[debate_id]
    if debate["status"] != "open":
        return f"Debate '{debate_id}' is already closed."

    participants = debate.get("participants") or [
        {"id": "A", "role": debate.get("position_a") or "Position A"},
        {"id": "B", "role": debate.get("position_b") or "Position B"},
    ]
    turns = debate["turns"]
    max_turns = debate.get("max_rounds", 3) * len(participants)
    if len(turns) >= max_turns:
        return (
            f"Debate '{debate_id}' has reached the maximum of {max_turns} turns. "
            f"Score all turns with score_turn and then call close_debate."
        )

    requested_pos = position.strip().upper()
    expected_pos = str(debate.get("next_expected_position", "A")).strip().upper()

    if debate.get("strict_turn_order", True) and not force and requested_pos != expected_pos:
        return (
            f"Out-of-turn submission rejected: Position '{requested_pos}' attempted to post, "
            f"but next_expected_position is '{expected_pos}'. "
            f"Wait for Position '{expected_pos}' to complete its turn (or use wait_for_turn)."
        )

    valid_ids = [p["id"].upper() for p in participants]
    normalized_pos = requested_pos if requested_pos in valid_ids else expected_pos

    exec_mode = debate.get("execution_mode", "subagents")
    if exec_mode != "single_agent" and not force:
        clean_agent = agent_name.strip().lower()
        conflicting_turn = next(
            (
                t
                for t in turns
                if str(t.get("agent", "")).strip().lower() == clean_agent
                and str(t.get("position", "")).upper() != normalized_pos
            ),
            None,
        )
        if conflicting_turn:
            mode_msg = (
                f"You MUST spawn a separate isolated subagent (using Task/Agent in Claude or invoke_subagent in Antigravity) "
                f"for Position '{normalized_pos}' and give it a distinct agent_name (e.g. 'Subagent-{normalized_pos}')."
                if exec_mode == "subagents"
                else f"In 'cross_client' mode, each AI client defends only its own position. Call wait_for_turn so the opposing client can post Position '{normalized_pos}'."
            )
            return (
                f"MONOLOGUE BLOCKED (execution_mode='{exec_mode}'): "
                f"Agent '{agent_name}' already defended Position '{conflicting_turn.get('position')}' and cannot also defend Position '{normalized_pos}'. "
                f"{mode_msg}"
            )

    participant_cfg = next(
        (p for p in participants if p["id"].upper() == normalized_pos), {}
    )

    resolved_model = (
        model or participant_cfg.get("model") or debate.get("default_model") or "inherit"
    )
    resolved_effort = (
        effort or participant_cfg.get("effort") or debate.get("default_effort") or "high"
    ).lower()

    word_count = len(argument.strip().split())
    max_words = debate.get("max_words", 200)
    word_warning = (
        f" Note: Argument has {word_count} words (exceeds recommended limit of {max_words} words)."
        if word_count > max_words
        else ""
    )

    turn_number = len(turns) + 1
    current_round = ((turn_number - 1) // len(participants)) + 1

    turns.append(
        {
            "turn": turn_number,
            "round": current_round,
            "agent": agent_name,
            "position": normalized_pos,
            "model": resolved_model,
            "effort": resolved_effort,
            "word_count": word_count,
            "argument": argument,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )

    current_idx = valid_ids.index(normalized_pos)
    next_idx = (current_idx + 1) % len(valid_ids)
    debate["next_expected_position"] = valid_ids[next_idx]
    _save_debates(debates)

    remaining = max_turns - turn_number
    next_participant = next(
        (p for p in participants if p["id"].upper() == debate["next_expected_position"]),
        {},
    )
    if remaining > 0:
        if exec_mode == "subagents":
            next_step_hint = (
                f"\nNext action: Spawn/message the isolated subagent for Position {debate['next_expected_position']} "
                f"[Model: {next_participant.get('model') or debate.get('default_model') or 'inherit'}, "
                f"Effort: {next_participant.get('effort') or debate.get('default_effort') or 'high'}] with a distinct agent_name."
            )
        elif exec_mode == "cross_client":
            next_step_hint = (
                f"\nNext action: Call wait_for_turn for your position so the opposing client can post Position {debate['next_expected_position']}."
            )
        else:
            next_step_hint = ""
    else:
        next_step_hint = (
            f"\nAll {max_turns} turns are complete! Next action: Call score_turn for every turn (1..{max_turns}) before calling close_debate."
        )

    return (
        f"Turn {turn_number} (Round {current_round}) recorded by {agent_name} "
        f"[Position {normalized_pos}, Model: {resolved_model}, Effort: {resolved_effort}, {word_count} words]. "
        f"Remaining turns: {remaining}. Next expected position: {debate['next_expected_position']}.{word_warning}{next_step_hint}"
    )


@mcp.tool()
def wait_for_turn(
    debate_id: str,
    position: str,
    timeout_seconds: int = 90,
) -> str:
    """Wait until it is the specified position's turn in an open debate."""
    target_pos = position.strip().upper()
    clamped_timeout = min(max(timeout_seconds, 5), 300)
    deadline = time.monotonic() + clamped_timeout

    while time.monotonic() < deadline:
        debates = _load_debates()
        if debate_id not in debates:
            return f"Debate '{debate_id}' not found."
        debate = debates[debate_id]
        participants = debate.get("participants") or [
            {"id": "A", "role": debate.get("position_a")},
            {"id": "B", "role": debate.get("position_b")},
        ]
        max_turns = debate.get("max_rounds", 3) * len(participants)
        turns = debate.get("turns", [])

        if debate.get("status") != "open":
            return json.dumps(
                {
                    "event": "debate_closed",
                    "status": debate.get("status"),
                    "winner": debate.get("winner"),
                    "verdict": debate.get("verdict"),
                },
                indent=2,
                ensure_ascii=False,
            )

        if len(turns) >= max_turns:
            return json.dumps(
                {
                    "event": "max_turns_reached",
                    "turns_count": len(turns),
                    "max_turns": max_turns,
                    "last_turn": turns[-1] if turns else None,
                },
                indent=2,
                ensure_ascii=False,
            )

        if str(debate.get("next_expected_position", "")).upper() == target_pos:
            my_profile = next(
                (p for p in participants if str(p.get("id")).upper() == target_pos), {}
            )
            return json.dumps(
                {
                    "event": "your_turn",
                    "debate_id": debate_id,
                    "your_position": target_pos,
                    "assigned_model": my_profile.get("model")
                    or debate.get("default_model")
                    or "inherit",
                    "assigned_effort": my_profile.get("effort")
                    or debate.get("default_effort")
                    or "high",
                    "effort_directive": my_profile.get("effort_directive")
                    or _get_effort_directive(
                        debate.get("client_platform", "antigravity"),
                        my_profile.get("effort") or debate.get("default_effort") or "high",
                    ),
                    "turns_completed": len(turns),
                    "max_turns": max_turns,
                    "last_turn": turns[-1] if turns else None,
                },
                indent=2,
                ensure_ascii=False,
            )

        time.sleep(1.5)

    debates = _load_debates()
    current = debates.get(debate_id, {})
    return json.dumps(
        {
            "event": "timeout",
            "message": f"Timed out after {timeout_seconds}s waiting for Position {target_pos}.",
            "next_expected_position": current.get("next_expected_position"),
            "turns_completed": len(current.get("turns", [])),
        },
        indent=2,
        ensure_ascii=False,
    )


@mcp.tool()
def score_turn(
    debate_id: str,
    turn_number: int,
    technical_evidence: float,
    rebuttal_strength: float,
    operational_viability: float,
    clarity: float,
    judge_name: str = "Judge",
    notes: str = "",
) -> str:
    """Score a specific turn using a structured rubric (1-10) and update the debate scoreboard."""
    debates = _load_debates()
    if debate_id not in debates:
        return f"Debate '{debate_id}' not found."

    debate = debates[debate_id]
    target_turn = next(
        (t for t in debate.get("turns", []) if t.get("turn") == turn_number), None
    )
    if not target_turn:
        return f"Turn {turn_number} not found in debate '{debate_id}'."

    average = round(
        (
            float(technical_evidence)
            + float(rebuttal_strength)
            + float(operational_viability)
            + float(clarity)
        )
        / 4.0,
        2,
    )

    target_turn["score"] = {
        "judge": judge_name,
        "technical_evidence": float(technical_evidence),
        "rebuttal_strength": float(rebuttal_strength),
        "operational_viability": float(operational_viability),
        "clarity": float(clarity),
        "average": average,
        "notes": notes,
        "scored_at": datetime.now(timezone.utc).isoformat(),
    }

    debate["scoreboard"] = _compute_scoreboard(debate)
    _save_debates(debates)
    return (
        f"Turn {turn_number} ({target_turn.get('agent')}, Position {target_turn.get('position')}) "
        f"scored: {average}/10.\n"
        f"Updated Scoreboard:\n{json.dumps(debate['scoreboard'], indent=2, ensure_ascii=False)}"
    )


@mcp.tool()
def export_debate(
    debate_id: str,
    format: str = "adr",
    output_path: Optional[str] = None,
) -> str:
    """Export a debate as a clean Markdown transcript or Architecture Decision Record (ADR), optionally saving it to a file."""
    debates = _load_debates()
    if debate_id not in debates:
        return f"Debate '{debate_id}' not found."

    markdown = _format_debate_markdown(debates[debate_id], format)
    if output_path:
        target = Path(output_path).resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(markdown, encoding="utf-8")
        return f"Debate '{debate_id}' exported ({format}) to {target}\n\n{markdown}"
    return markdown


@mcp.tool()
def close_debate(
    debate_id: str,
    verdict: str,
    winner: Optional[str] = "synthesis",
    force: bool = False,
) -> str:
    """Close a debate and record the final synthesis, conclusion, or winning position. Requires all turns to be scored via score_turn first (unless force=True)."""
    debates = _load_debates()
    if debate_id not in debates:
        return f"Debate '{debate_id}' not found."

    debate = debates[debate_id]
    turns = debate.get("turns", [])
    unscored = [str(t.get("turn")) for t in turns if not t.get("score")]

    if turns and unscored and not force:
        return (
            f"CLOSE REJECTED: Unscored turns remain (Turns: {', '.join(unscored)}). "
            f"You MUST call score_turn for every turn first so the Evaluation Scoreboard is populated before calling close_debate."
        )

    debate["status"] = "closed"
    debate["verdict"] = verdict
    debate["winner"] = winner
    debate["closed_at"] = datetime.now(timezone.utc).isoformat()
    debate["scoreboard"] = _compute_scoreboard(debate)
    _save_debates(debates)
    return (
        f"Debate '{debate_id}' closed. Winner/Outcome: {winner}.\n"
        f"Final Scoreboard:\n{json.dumps(debate['scoreboard'], indent=2, ensure_ascii=False)}"
    )


@mcp.tool()
def delete_debate(debate_id: str) -> str:
    """Delete a debate session from storage."""
    debates = _load_debates()
    if debate_id not in debates:
        return f"Debate '{debate_id}' not found."
    del debates[debate_id]
    _save_debates(debates)
    return f"Debate '{debate_id}' deleted."


@mcp.prompt()
def moderate_debate(
    topic: str = "",
    position_a: str = "",
    position_b: str = "",
    execution_mode: str = "",
    model: str = "",
    effort: str = "",
    rounds: int = 3,
) -> str:
    """Prompt template to start, moderate, or participate in a structured multi-agent debate with platform-specific model, effort, and execution mode selection."""
    detected_platform = _detect_client_platform()
    profile = PLATFORM_PROFILES.get(detected_platform, PLATFORM_PROFILES["antigravity"])
    has_topic = bool(topic and topic.strip() and topic.strip() != "undefined")

    effort_options_list = ", ".join(
        f"'{e['id']}' ({e['label']})" for e in profile["efforts"]
    )

    if not has_topic:
        return (
            f"I want to start a structured debate using the `roundtable-mcp` server.\n\n"
            f"Since I have not specified the parameters yet:\n"
            f"1. Call `list_debates` on `roundtable-mcp` to check if there is already an open debate to join.\n"
            f"2. Ask me (using your interactive question tool if available):\n"
            f"   - **Execution Mode (`execution_mode`)**: 'subagents' (spawn isolated subagents in this client), 'cross_client' (live debate between Antigravity and Claude), or 'single_agent'.\n"
            f"   - **Model**: If running in Antigravity: 'inherit', 'pro', 'flash', 'flash_lite'. If running in Claude: 'inherit', 'opus', 'sonnet', 'haiku'.\n"
            f"   - **Reasoning Effort**: {effort_options_list}.\n"
            f"   - **Topic and Positions** (or multiple roundtable roles).\n"
            f"3. Once I confirm, call `create_debate` passing `client_platform`, `execution_mode`, `default_model`, and `default_effort`. In 'subagents' mode, spawn an isolated subagent per position with a distinct `agent_name`. Score every turn with `score_turn` before calling `close_debate`."
        )

    resolved_mode = (
        execution_mode if execution_mode and execution_mode != "undefined" else "subagents"
    )
    resolved_model = model if model and model != "undefined" else "inherit"
    resolved_effort = effort if effort and effort != "undefined" else "high"
    return (
        f"Start a structured debate using the roundtable-mcp tools.\n"
        f"Topic: {topic}\n"
        f"Position A: {position_a or 'Pro / Option A'}\n"
        f"Position B: {position_b or 'Con / Option B'}\n"
        f"Execution Mode: {resolved_mode}\n"
        f"Model: {resolved_model}\n"
        f"Effort: {resolved_effort}\n"
        f"Rounds: {rounds}\n\n"
        f"Instructions:\n"
        f"1. Call create_debate with client_platform ('claude' or 'antigravity'), execution_mode=\"{resolved_mode}\", default_model=\"{resolved_model}\", and default_effort=\"{resolved_effort}\".\n"
        f"2. If execution_mode is 'subagents', spawn isolated subagents per position with distinct agent_name values using the configured model and effort directive.\n"
        f"3. Score each turn objectively using score_turn.\n"
        f"4. After {rounds} rounds, call close_debate with a final verdict and export the ADR via export_debate."
    )


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
