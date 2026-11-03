import re

p = "/app/memory/PRD.md"
s = open(p).read()
s = s.replace("""## Backlog
- P1: background worker for recalculation; admin UI to promote members; Playwright flows for Emergent sign-in (ticket based).
- P2: ladder expiry background job; groups+knockout same-group R1 avoidance; split admin.tsx/player.tsx; Stripe live payments.""", """- 2026-06 round 7: PPRC Rating replay moved to a per-club background worker after commit (results return immediately; every club read waits for a pending replay so it never shows half-updated ratings); ladder challenge deadlines applied by the 15-minute scheduler; groups+knockout draw swaps lower seeds so no first-round match pairs players from the same group; challenge expiry mode per club (default counts from sending; admins can switch to restart on each new suggested time, migration 013); Playwright real sign-in suite tests/auth.spec.ts + `./pprc.sh test-auth-ui` (5/5 on hosted preview). 126 dev tests + 58 hosted-preview tests pass.

## Backlog
- P2: split admin.tsx/player.tsx; Stripe live payments (on hold by user choice).""")
open(p, "w").write(s)
r = "/app/README.md"
t = open(r).read()
if "test-auth-ui" not in t:
    t += "\n\n### Real sign-in browser tests\n`PPRC_PREVIEW_URL=<hosted preview origin> ./pprc.sh test-auth-ui` mints one-time sign-in tickets for the two `+clerk_test` users and runs `tests/auth.spec.ts` (player and club-admin flows).\n"
    open(r, "w").write(t)
print("ok")
