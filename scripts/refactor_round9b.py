import os

os.chdir("/app/backend")


def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b, 1)
    open(p, "w").write(s)


edit("app/ratings.py", [("from .rating_service import milestones_for, ratings_settled, recalculate_club, request_recalculation, score_fields", "from .rating_service import milestones_for, recalculate_club, request_recalculation, score_fields\nfrom .recalc_queue import ratings_settled")])
edit("app/challenges.py", [
    ("from .rating_service import ratings_settled", "from .recalc_queue import ratings_settled"),
    ('''async def h2h_player(session: AsyncSession, club_id: UUID, user_id: str, profile: PlayerProfile | None, name: str) -> dict:
    ratings = {}
    for kind in ("singles", "doubles"):
        ordered = await club_ratings(session, club_id, kind)
        row''', '''def h2h_player(user_id: str, profile: PlayerProfile | None, name: str, ordered_by_kind: dict) -> dict:
    ratings = {}
    for kind, ordered in ordered_by_kind.items():
        row'''),
    ('''    matches = [meeting_view(m, player_a, player_b, history, person) for m in meetings]
    return {
        "a": await h2h_player(session, club_id, player_a, profiles.get(player_a), names[player_a]),
        "b": await h2h_player(session, club_id, player_b, profiles.get(player_b), names[player_b]),''', '''    matches = [meeting_view(m, player_a, player_b, history, person) for m in meetings]
    ordered = {kind: await club_ratings(session, club_id, kind) for kind in ("singles", "doubles")}
    return {
        "a": h2h_player(player_a, profiles.get(player_a), names[player_a], ordered),
        "b": h2h_player(player_b, profiles.get(player_b), names[player_b], ordered),'''),
])
edit("app/main.py", [("from .rating_service import ratings_settled, sync_triace_fixture", "from .rating_service import sync_triace_fixture\nfrom .recalc_queue import ratings_settled")])
edit("app/rating_service.py", [("from .recalc_queue import ratings_settled  # noqa: F401  (re-exported for routers)\n", "")])
print("ok")
