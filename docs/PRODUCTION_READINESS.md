# Remaining production readiness

The local application is not a production deployment certification. Required before a live club competition:

- Confirm staging isolation and explicitly authorize deployment; configure public Firebase client values, billing, APIs, IAM, Auth domains/providers, Storage bucket/CORS and first admin.
- Confirm the TRIACE 18.5 maximum, participation denominator, all-roster eligibility, doubles combinations, decider lineup and scoring/forfeit policies with club organizers. Defaults are documented, configurable, and locked after registration.
- Complete the real staging role/tournament/Stripe test/FCM/Scheduler/recovery drills in STAGING.md. No live charges are enabled in this implementation.
- Review club privacy, consent, waiver, audit retention, data residency, account deletion and financial record policies. Account deletion remains a reviewed operational request.
- Configure monitoring/error alerts, operational ownership, secrets rotation, dependency/security updates, rate/abuse controls and Firebase App Check policy. Restrict project/service-account privileges and protect export buckets.
- Validate physical iPhone/Safari and Android behavior, accessibility/contrast with real users, and network interruption/recovery during a competition.
- Load-test expected event sizes, transaction contention, event-wide queries, notification fanout, court buffers and late withdrawals. Current team limits are 16 teams/eight per group; this is a basic conflict-checked scheduler.
- Plan supervised roster/lineup changes: accepted rosters lock at registration, submitted lineups lock on submission, and downstream sporting records restrict corrections. Automatic substitutions/reopening and global multi-club onboarding are not implemented.
- Keep deploy/rollback and backup/restore procedures rehearsed. Preserve immutable history during application rollback and reconcile provider payments independently.

The existing individual Events functionality remains supported. Legacy Next.js, SQLite and its original rating prototype are not migrated or changed. PPRC Events/TRIACE stores external references only.
