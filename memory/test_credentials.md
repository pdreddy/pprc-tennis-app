# Test credentials (preview)

## Real sign-in (Emergent-managed: Google or one-time email code)
The hosted preview now uses Emergent-managed auth. `+clerk_test` emails always receive the code **424242** (no real email is sent).

| Account | Email | Notes |
| --- | --- | --- |
| Alex Tester | alex+clerk_test@example.com | PPRC player, 5 verified singles wins, has milestones |
| Blair Tester | blair+clerk_test@example.com | PPRC player, Alex's opponent |
| Club admin | damu.palavali@gmail.com | ADMIN_EMAIL: joins PPRC as club admin on first verified sign-in (owner's real account) |

Password for the two test users (if password sign-in is ever enabled): Test-pass-12345!
Automation (bot protection blocks headless sign-up): run `cd /app/backend && /root/.venv/bin/python scripts/clerk_preview_testers.py > /app/data/testers.json`; it prints a one-time sign-in ticket for Alex. Open `<preview>/sign-in?__clerk_ticket=<ticket>` (or run `Clerk.client.signIn.create({strategy:'ticket', ticket})` then `Clerk.setActive`).
API calls: Clerk session token as `Authorization: Bearer <jwt>` (the script shows how to mint one with the dev secret key).

## Seeded demo data
Demo players player1..player16 and the admin uid `admin` still exist as data (rankings, ladder) but cannot sign in in the hosted preview.
The `X-PPRC-User` header works only on a backend started with `PPRC_ENVIRONMENT=development` (local Docker / temporary test server), not on the hosted preview.
Club id: 82a25bc1-9def-58d4-bc37-4be4c1b8fd6d (slug `pprc`)
