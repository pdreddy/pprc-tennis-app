# Player experience and club onboarding

Use `./pprc.sh setup`, `./pprc.sh start`, `./pprc.sh seed`, then `./pprc.sh doctor` for the isolated demo environment. The existing React PWA and Firebase backend serve all these workflows. The legacy prototype's seed/database are unrelated.

## New player

Create an account on the sign-in screen. Complete the player profile, including separate singles/doubles references if known. Supplied references remain separate from PPRC results. Editing a verified reference removes its old verification; only a trusted club administrator can verify it again.

Visit the Club page and request membership. The request does not grant access or let the applicant choose a role. A club administrator reviews it under Members with a reason shared privately with the player. Approval grants player membership, sends a linked notification, and allows discovery/registration for member events. Applicants can withdraw pending requests; rejected applicants can resubmit. An administrator can close applications without removing existing members.

Register for an event and use the existing waiver, reservation/payment, approval, check-in and scoring flow. Demo payments only simulate successful checkout in the emulator. Live payments are disabled.

## Search, references and performance

- Players searches opt-in public names, cities and playing levels. Club directory membership comes from trusted membership records, never a browser-provided role. Public profiles exclude date of birth, contacts, membership applications and notification preferences.
- Reference leaderboard sorts supplied public singles or doubles references. Equal values share a rank. This is not an official UTR ranking or a calculated PPRC rating.
- My performance shows the signed-in player's persisted, confirmed individual results and team rubbers they were actually assigned to play. Pending/superseded results do not count; a correction appears once at its final version. Empty history stays empty rather than displaying invented statistics.
- Registration reference history shows the player's immutable team-registration snapshots, not a historical external rating feed. The view caps retrieved history at 500 records and discloses truncation.
- Choosing Private profile removes the public projection, including directory and reference leaderboard visibility. The owner retains access to their private performance. Existing publicly published event/team results follow the event's publication and roster-consent policy.

Mobile bottom navigation links to existing Events, Schedule, Teams, Club and Profile routes. Financial or score mutations still require the trusted online backend; the PWA offline shell does not simulate them.

## Data and migration

Additive collection: `membershipRequests/{playerUid}`. Clients can read only their own request; PPRC club administrators/support can inspect scoped applications, and support cannot decide them. All client writes are denied. Trusted callable transactions maintain `memberships`, notifications, public projections, immutable audits and request receipts.

Existing public profile projections can be rebuilt with `pnpm events:migrate --public-profiles --dry-run`, then `--public-profiles --apply` on the synthetic emulator. The migration strips private fields, removes opted-out/orphan projections, and derives member status from trusted membership. It is idempotent. Configured staging writes additionally require the documented explicit staging guard; no migration against real data was authorized or executed.

Declared compound indexes are in `firestore.indexes.json`. Emulator success does not prove those indexes exist in a remote project; any approved staging rollout must include rules/indexes and the projection migration. See `INTEGRATION_TEST_REPORT.md` for executed tests and outstanding external checks.
