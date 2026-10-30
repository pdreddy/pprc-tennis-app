# Season 1 Migration Plan

Season 1 may be migrated only after a source-field review. The existing importer supports memberships, events, and registrations. Team competition history needs a mapping approved from the actual source collection fields.

## Step 1: read-only inventory

```bash
export FIREBASE_SERVICE_ACCOUNT=/absolute/path/to/season1-service-account.json
python backend/scripts/season1_preflight.py \
  --expected-project YOUR_SEASON1_FIREBASE_PROJECT_ID \
  --report season1-preflight.json
```

Review the generated report before granting any write permission or applying the importer. It contains field names and sample counts only, not player data.

## Required mapping decisions

- Which Season 1 event represents TRIACE, and its target division(s).
- Team document fields for captain, roster, player UTR, and approval state.
- Match/result fields for opponent teams, dates, scores, singles appearances, corrections, and finalization.
- Whether historical registrations should remain historical, be imported as confirmed, or stay outside the active event.

## Safe execution order

1. Run the preflight against Season 1.
2. Apply all PostgreSQL migrations to a staging Supabase project.
3. Run the existing importer with `--dry-run` and reconcile counts.
4. Add the approved Season 1 team/fixture mapping and test it against staging only.
5. Take a target database backup, run the idempotent import, reconcile counts and samples, then approve cutover.

Never point the importer at production until this evidence is recorded.
