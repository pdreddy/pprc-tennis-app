# PPRC Events validation

Validated in the current cloud workspace on October 19, 2026. Node 22.23.3 (official distribution, SHA-256 verified), pnpm 11.25, Java 21 and system Chromium. The application uses actual Firebase Auth, Firestore, Functions and Storage emulators; no client-side fake backend replaces tournament logic.

| Check | Result | Evidence |
| --- | --- | --- |
| Shared unit tests | 26 passed | Capacity, eligibility, assigned roles, deterministic brackets/byes, all-pairs round robin, percentages/ties, legal scores, conflicts, DST windows, CSV injection escaping |
| Firebase emulator integration | 15 passed | Contended registration, exact capacity, promotion, payment ownership, idempotent request receipts, approvals, score finalization, role checks, immutable-audit/direct-write denial, playoff qualification, unpublication, private profiles, admin verification, Storage ownership and waiver access, venues/courts, disputed-score corrections |
| Full browser tournament tests | 3 passed | Four-player registration/payment → approvals/seeds/check-in → draw/publish → schedule → three scores with winner advancement → completed event → CSV download; waitlist promotion; five-step create/publish wizard |
| Browser shell checks | 3 passed | Discovery/navigation, mobile overflow checks, unauthorized route gates, labeled sign-in controls and native email validation |
| TypeScript / lint | Passed | All three new workspaces; source ESLint checks |
| Production build | Passed | Standalone Functions runtime package; Vite application, manifest, icons and Workbox worker |
| PWA runtime smoke | Passed | Manifest/icons fetched, active worker confirmed, offline shell reload succeeded |
| Seed/start repeatability | Passed | Seed executed twice, three real event cards loaded, emulator export persisted |
| Legacy tests | 4 passed | Existing rating/parser tests retained, unchanged |
| Legacy data isolation | Passed | Read-only inspection found original 160-player SQLite database; no Events operation accesses that file |

The emulator suite initially exposed two Firestore serialization errors (timestamp transforms inside audit arrays and directly nested round-robin arrays). Both were fixed and the affected real emulator workflows passed. The browser suite exposed ambiguous wrapped-select labels and an asynchronous waitlist assertion; explicit label associations and server-confirmed transition waits fixed them. Final successful browser runs used fresh emulator data and no source edits during execution.

## Configured versus environment-dependent

Implemented and validated locally: Firebase-backed registration/payment simulation, permissions, seeding, knockout and group-to-playoff logic, scores, corrections, audits, private/public profile projection, media rules, event wizard, schedules, check-in and CSV reports.

Implemented but requiring real project configuration and staging validation: Google sign-in, Stripe Checkout/signed webhooks/full refunds, FCM delivery, Cloud Scheduler deadline/reminder invocation, Hosting deployment, bucket CORS and production IAM. The Functions emulator initializes the scheduled handler but does not run Cloud Scheduler on a real schedule. The maintenance domain operations are present; timed production invocation has not been verified. The service worker caches the app shell, not authenticated tournament writes.

No live payments, real push delivery, production deployment or new-task snapshot restoration are claimed. Account deletion is an audited club review request; final erasure/retention is an operational club responsibility. Large events and multi-division unknown-player scheduling need staging load and conflict review before live competition.

The environment draft includes Firebase binary download domains and reusable startup/install instructions. Draft persistence is distinct from publishing the environment or deploying the application.
