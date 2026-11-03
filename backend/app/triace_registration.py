"""Pure helpers for TRIACE registration: privacy projection, CSV export, idempotency and safe tier removal."""
import csv
import io

CSV_COLUMNS = ["Team ID", "Team", "Captain", "Players", "Combined rating", "Selected tier", "Assigned tier", "Consent", "Rules accepted", "Status", "Registered at"]


def csv_cell(value: object) -> str:
    """Neutralise spreadsheet formulas: a leading = + - @ (after whitespace) gets an apostrophe prefix."""
    text = "" if value is None else str(value)
    return "'" + text if text.lstrip()[:1] in {"=", "+", "-", "@"} else text


def csv_text(rows: list[list[object]]) -> str:
    out = io.StringIO()
    writer = csv.writer(out, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
    writer.writerow(CSV_COLUMNS)
    for row in rows:
        writer.writerow([csv_cell(value) for value in row])
    return out.getvalue()


def first_name(display_name: str | None, user_id: str) -> str:
    """Public captain label: the first word of the display name, never the account id."""
    word = (display_name or "").strip().split(" ")[0]
    return word if word and word != user_id and "@" not in word else "Captain"


def registration_signature(name: str, members: list[tuple[str, float, int]], selected_tier: str) -> dict:
    """What identifies a registration for idempotent retries (order of players does not matter)."""
    return {"name": name.strip().lower(), "members": sorted([user_id, round(float(rating), 2), position] for user_id, rating, position in members), "selectedTier": selected_tier}


def removed_tier_ids(current: set[str], proposed: set[str]) -> set[str]:
    return current - proposed


def tiers_still_used(removed: set[str], team_metadata: list[dict]) -> set[str]:
    """Removed tier ids that some team is still assigned to or listed in."""
    used: set[str] = set()
    for meta in team_metadata:
        used |= (set(meta.get("listedTiers") or []) | ({meta["assignedTier"]} if meta.get("assignedTier") else set())) & removed
    return used
