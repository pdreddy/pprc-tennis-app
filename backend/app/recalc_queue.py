"""Registry of in-flight background rating replays. Imports nothing from the app, so any module may use it."""
import asyncio
from collections.abc import Awaitable, Callable
from uuid import UUID

_dirty: set[UUID] = set()
_workers: dict[UUID, asyncio.Task] = {}


def start(club_id: UUID, replay: Callable[[UUID], Awaitable[None]]) -> None:
    """Mark the club for a replay; one worker per club drains repeated requests."""
    _dirty.add(club_id)
    if club_id not in _workers:
        _workers[club_id] = asyncio.get_running_loop().create_task(_run(club_id, replay))


async def _run(club_id: UUID, replay: Callable[[UUID], Awaitable[None]]) -> None:
    try:
        while club_id in _dirty:
            _dirty.discard(club_id)
            await replay(club_id)
    finally:
        _workers.pop(club_id, None)


async def ratings_settled(club_id: UUID | None = None) -> None:
    """Wait for any pending replay (one club, or all) so reads never show half-updated ratings."""
    current = asyncio.current_task()
    tasks = [t for c, t in list(_workers.items()) if (club_id is None or c == club_id) and t is not current]
    if tasks:
        await asyncio.wait(tasks)
