import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("roundtable-mcp")

DEFAULT_STORAGE_DIR = Path.home() / ".roundtable_mcp"
STORAGE_FILE = Path(
    os.environ.get("ROUNDTABLE_STORAGE_PATH", str(DEFAULT_STORAGE_DIR / "debates.json"))
)


def _load_debates() -> dict:
    if not STORAGE_FILE.exists():
        return {}
    try:
        return json.loads(STORAGE_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _save_debates(data: dict) -> None:
    STORAGE_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp_file = STORAGE_FILE.with_suffix(".tmp")
    temp_file.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    temp_file.replace(STORAGE_FILE)


@mcp.tool()
def create_debate(
    debate_id: str,
    topic: str,
    position_a: str,
    position_b: str,
    max_rounds: int = 3,
    rules: str = "Be concise, address the previous turn directly, and provide technical evidence.",
) -> str:
    """Create a new debate session with a topic, two opposing positions, and a maximum number of rounds."""
    debates = _load_debates()
    debates[debate_id] = {
        "debate_id": debate_id,
        "topic": topic,
        "position_a": position_a,
        "position_b": position_b,
        "max_rounds": max_rounds,
        "rules": rules,
        "status": "open",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "next_expected_position": "A",
        "turns": [],
        "verdict": None,
        "winner": None,
    }
    _save_debates(debates)
    return (
        f"Debate '{debate_id}' created.\n"
        f"Topic: {topic}\n"
        f"Position A: {position_a}\n"
        f"Position B: {position_b}\n"
        f"Max rounds: {max_rounds} ({max_rounds * 2} total turns)\n"
        f"Next turn: Position A"
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
        filtered.append(
            {
                "debate_id": d_id,
                "topic": info.get("topic"),
                "status": info.get("status"),
                "turns_count": len(info.get("turns", [])),
                "max_turns": info.get("max_rounds", 3) * 2,
                "next_expected_position": info.get("next_expected_position"),
            }
        )
    return json.dumps(filtered, indent=2, ensure_ascii=False)


@mcp.tool()
def read_debate(debate_id: str) -> str:
    """Read the full state and transcript of a debate, including whose turn is next."""
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
) -> str:
    """Post an argument or rebuttal to an open debate. Position should be 'A' or 'B' (or the position description)."""
    debates = _load_debates()
    if debate_id not in debates:
        return f"Debate '{debate_id}' not found."

    debate = debates[debate_id]
    if debate["status"] != "open":
        return f"Debate '{debate_id}' is already closed."

    turns = debate["turns"]
    max_turns = debate.get("max_rounds", 3) * 2
    if len(turns) >= max_turns:
        return (
            f"Debate '{debate_id}' has reached the maximum of {max_turns} turns. "
            f"Please call close_debate to record a final verdict."
        )

    normalized_pos = position.strip().upper()
    if normalized_pos not in ("A", "B"):
        normalized_pos = debate.get("next_expected_position", "A")

    turn_number = len(turns) + 1
    current_round = (turn_number + 1) // 2

    turns.append(
        {
            "turn": turn_number,
            "round": current_round,
            "agent": agent_name,
            "position": normalized_pos,
            "argument": argument,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )

    debate["next_expected_position"] = "B" if normalized_pos == "A" else "A"
    _save_debates(debates)

    remaining = max_turns - turn_number
    return (
        f"Turn {turn_number} (Round {current_round}) recorded by {agent_name} [Position {normalized_pos}]. "
        f"Remaining turns: {remaining}. Next expected position: {debate['next_expected_position']}."
    )


@mcp.tool()
def close_debate(
    debate_id: str,
    verdict: str,
    winner: Optional[str] = "synthesis",
) -> str:
    """Close a debate and record the final synthesis, conclusion, or winning position ('A', 'B', or 'synthesis')."""
    debates = _load_debates()
    if debate_id not in debates:
        return f"Debate '{debate_id}' not found."

    debate = debates[debate_id]
    debate["status"] = "closed"
    debate["verdict"] = verdict
    debate["winner"] = winner
    debate["closed_at"] = datetime.now(timezone.utc).isoformat()
    _save_debates(debates)
    return f"Debate '{debate_id}' closed. Winner/Outcome: {winner}."


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
def moderate_debate(topic: str, position_a: str, position_b: str, rounds: int = 3) -> str:
    """Prompt template to instruct an agent how to run or participate in a structured debate."""
    return (
        f"Start a structured debate using the roundtable-mcp tools.\n"
        f"Topic: {topic}\n"
        f"Position A: {position_a}\n"
        f"Position B: {position_b}\n"
        f"Rounds: {rounds}\n\n"
        f"Instructions:\n"
        f"1. Call create_debate with a descriptive debate_id.\n"
        f"2. Alternate turns between Position A and Position B using post_argument (or spawn two subagents to represent each position).\n"
        f"3. After {rounds} rounds, evaluate all arguments objectively and call close_debate with a final verdict."
    )


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
