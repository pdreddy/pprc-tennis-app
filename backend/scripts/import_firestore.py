"""One-way Firebase Firestore to PostgreSQL importer for the PPRC cutover.

Run only against an exported/staging Firebase project. It is idempotent for the
PPRC club and records no credentials in the repository.
"""
import argparse
import asyncio
import json
import os
import sys
import uuid
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore
from sqlalchemy import func, select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.database import SessionLocal  # noqa: E402
from app.models import Club, Event, EventStatus, Membership, MembershipRole, Registration, RegistrationStatus  # noqa: E402

CLUB_NAMESPACE = uuid.UUID("f236c9a6-b95f-462d-9acd-8df0d34e55e7")


def source() -> firestore.Client:
    credential_path = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if not credential_path:
        raise RuntimeError("Set FIREBASE_SERVICE_ACCOUNT to a local service-account JSON file")
    firebase_admin.initialize_app(credentials.Certificate(credential_path))
    return firestore.client()


def value(data: dict, key: str, default=None):
    item = data.get(key, default)
    return item.to_datetime() if hasattr(item, "to_datetime") else item


async def firebase_counts(db: firestore.Client) -> dict[str, int]:
    return {
        "memberships": sum(1 for _ in db.collection("memberships").stream()),
        "events": sum(1 for _ in db.collection("events").stream()),
        "registrations": sum(1 for _ in db.collection("registrations").stream()),
    }


async def target_counts(session, club_id: uuid.UUID) -> dict[str, int]:
    return {
        "memberships": int(await session.scalar(select(func.count()).select_from(Membership).where(Membership.club_id == club_id)) or 0),
        "events": int(await session.scalar(select(func.count()).select_from(Event).where(Event.club_id == club_id)) or 0),
        "registrations": int(await session.scalar(select(func.count()).select_from(Registration).where(Registration.club_id == club_id)) or 0),
    }


async def import_pprc(apply: bool, report_path: Path | None) -> dict:
    db = source()
    club_id = uuid.uuid5(CLUB_NAMESPACE, "pprc")
    source_counts = await firebase_counts(db)
    report: dict = {
        "club_id": str(club_id),
        "source": source_counts,
        "target_before": {},
        "target_after": {},
        "applied": apply,
        "reconciled": False,
    }
    async with SessionLocal() as session:
        report["target_before"] = await target_counts(session, club_id)
        if not apply:
            report["target_after"] = report["target_before"]
            report["reconciled"] = source_counts == report["target_before"]
            if report_path:
                report_path.write_text(json.dumps(report, indent=2) + "\n")
            return report

        club = await session.get(Club, club_id)
        if club is None:
            club = Club(id=club_id, slug="pprc", name="Prosper Premier Racquet Club", sport="tennis")
            session.add(club)

        for document in db.collection("memberships").stream():
            data = document.to_dict() or {}
            user_id = data.get("userId", document.id)
            existing = await session.scalar(select(Membership).where(Membership.club_id == club_id, Membership.user_id == user_id))
            if existing is None:
                raw_role = data.get("role", "player")
                role = MembershipRole(raw_role) if raw_role in MembershipRole._value2member_map_ else MembershipRole.player
                session.add(Membership(club_id=club_id, user_id=user_id, display_name=data.get("displayName", user_id), role=role))

        event_ids: dict[str, uuid.UUID] = {}
        for document in db.collection("events").stream():
            data = document.to_dict() or {}
            event_id = uuid.uuid5(CLUB_NAMESPACE, f"event:{document.id}")
            event_ids[document.id] = event_id
            if await session.get(Event, event_id):
                continue
            raw_status = data.get("status", "draft")
            event_status = EventStatus(raw_status) if raw_status in EventStatus._value2member_map_ else EventStatus.draft
            starts_at = value(data, "startsAt") or value(data, "startAt")
            if starts_at is None:
                print(f"Skipping event {document.id}: no start date")
                continue
            session.add(Event(id=event_id, club_id=club_id, name=data.get("name", document.id), starts_at=starts_at, capacity=int(data.get("capacity", 32)), entry_fee_cents=int(data.get("entryFeeCents", 0)), status=event_status, rules=data.get("rules", {})))

        await session.flush()
        for document in db.collection("registrations").stream():
            data = document.to_dict() or {}
            event_id = event_ids.get(data.get("eventId"))
            user_id = data.get("userId") or data.get("playerId")
            if not event_id or not user_id:
                continue
            if await session.scalar(select(Registration).where(Registration.event_id == event_id, Registration.user_id == user_id)):
                continue
            raw_status = data.get("status", "pending")
            registration_status = RegistrationStatus(raw_status) if raw_status in RegistrationStatus._value2member_map_ else RegistrationStatus.pending
            session.add(Registration(club_id=club_id, event_id=event_id, user_id=user_id, status=registration_status, waitlist_position=data.get("waitlistPosition")))

        await session.commit()
        report["target_after"] = await target_counts(session, club_id)
    report["reconciled"] = source_counts == report["target_after"]
    if report_path:
        report_path.write_text(json.dumps(report, indent=2) + "\n")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create a Firebase-to-PostgreSQL PPRC reconciliation report")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="Read both sources and write counts without changes")
    mode.add_argument("--apply", action="store_true", help="Run idempotent import into the configured staging database")
    parser.add_argument("--report", type=Path, help="Path to a JSON reconciliation report")
    args = parser.parse_args()
    result = asyncio.run(import_pprc(apply=args.apply, report_path=args.report))
    print(json.dumps(result, indent=2))
    if not result["reconciled"]:
        raise SystemExit("Counts do not reconcile; do not cut over this club.")
