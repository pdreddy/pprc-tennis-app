# PPRC Sports Elite — Permanent Agent Rules

These rules apply throughout this repository.

- Preserve the existing React, TypeScript, Firebase, and PWA architecture.
- Enhance existing functionality instead of rebuilding or duplicating it.
- Implement complete frontend-to-database workflows.
- Enforce server-side authorization and Firestore security rules.
- Use synthetic data and Firebase emulators for testing.
- For every code change, run relevant focused tests.
- Before declaring any implementation task complete, run `./pprc.sh test-all`.
- Never replace integrated tests with simulated checks.
- Never skip, weaken, or remove failing tests to achieve a green build.
- If the full suite fails, fix the cause and rerun it.
- Preserve previously passing tests and workflows.
- Record actual results in `docs/INTEGRATION_TEST_REPORT.md`.
- Keep implementation documentation and feature status current.
- Maintain `docs/UTR_FEATURE_COMPARISON.md` and `docs/IMPLEMENTATION_BACKLOG.md`; distinguish observed reference behavior from unverified assumptions.
- Inspect reference packages only with permitted local tools; never bypass authentication/security or extract credentials/private APIs.
- Do not deploy production resources or enable live payments without explicit approval.
- Do not copy proprietary code, assets, or branding from reference applications.
- Work on a feature branch and keep changes reviewable.
- Report completion only after a successful full integrated test run.

The root Next.js/SQLite legacy prototype is independent of `apps/web` Events and
must remain unchanged unless the user explicitly requests changes to it. Use the
existing `events:*` commands and `pprc.sh` for Events/TRIACE work.
