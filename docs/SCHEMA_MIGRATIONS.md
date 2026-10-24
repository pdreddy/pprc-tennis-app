# Firestore compatibility and migration

Existing event IDs, registrations, payments, matches and results remain valid. Missing `competition` means `individual`. TRIACE events add `competition: 'triace'`, `schemaVersion: 2` and validated `triaceRules`; individual events may carry `schemaVersion: 1`.

| Collection        | Purpose / read scope                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `teams`           | Event-scoped captain and accepted three-slot roster; members/operators read drafts, public approved roster follows event visibility             |
| `invitations`     | Player/captain participants and operators only; Pending/Accepted/Declined/Revoked                                                               |
| `registrations`   | Existing collection; team entries add `kind`, `teamId`, combined reference and immutable snapshots; existing captain/payment ownership retained |
| `ratingSnapshots` | Higher singles/doubles references, source, verification and capture time; player owns their snapshot; event operators can review                |
| `teamGroups`      | Published group assignment, standings and audited tie resolutions                                                                               |
| `teamEncounters`  | Group/playoff fixtures, schedule, aggregate rubber wins, successor and champion path                                                            |
| `lineups`         | Accepted roster combinations; private until both captains submit                                                                                |
| `rubbers`         | Authorized players, kind, version and confirmed score per encounter                                                                             |
| `rubberResults`   | Submitted/Disputed/Final/Superseded versions; participants/operators see pending, public sees confirmed results                                 |
| `disputes`        | Participant/operator review with required reason and recorded resolution                                                                        |
| `operationLimits` | Trusted per-actor mutation rate limit; no client access                                                                                         |

All mutations use `execute()`'s Firestore transaction, request hash/receipt and immutable audit commit. TRIACE audit actions use `triace.ACTION`. No browser can write sporting or financial documents directly, including an authenticated admin browser. Notifications retain the existing restricted read-state update. Firestore indexes include the exact event/member/publication/result filters used by the app. Firestore does not accept directly nested arrays; doubles pairs and table groups use arrays of maps.

From the repository root with demo emulators running:

```bash
pnpm events:migrate --dry-run
pnpm events:migrate --apply
pnpm events:migrate --apply  # idempotent; no further changes expected
```

The migration only queries `clubId == 'pprc'`. It adds compatibility metadata to events lacking a schema version and writes an audit record. It never migrates SQLite, rewrites results, imports actual players, replaces rules, or copies credentials. Unknown competition values stop the operation for review. Back up before any real-project migration.

Staging migration requires the configured staging alias, explicit project selection, `--approve-staging`, `--apply`, and `PPRC_ALLOW_STAGING_WRITE` matching that project. A dry run does not authorize applying it. See STAGING.md. Deploy the additive rules/indexes and backward-compatible application together; retain the previous application build for rollback. Do not delete version-two documents or immutable audits during an application rollback.
