# UTR Sports reference audit

## Status: XAPK not available

No `.xapk`/`.apk` file exists in this workspace (searched the full filesystem on 2026-10-24), so **no binary inspection was performed**. Nothing below was extracted from the app. The categories are generic, publicly described tennis-app capabilities used as a *functional* checklist only. No UTR code, assets, branding, or rating algorithm is to be copied; PPRC keeps its own original rating (`lib/rating.ts`) and treats external UTR values as reference data.

If the XAPK is supplied later, put it outside the repo (e.g. `/home/user/refs/`) and re-run this audit by unpacking it into an empty directory and reviewing the manifest, screens and strings only.

## Functional categories to match (unverified against the app)

| Category | Reference capability | PPRC target |
| --- | --- | --- |
| Profiles | Player profile with photo, location, singles/doubles ratings, rating history | Phase 2 |
| Search | Find players/clubs by name, location, rating range | Phase 2 |
| Rankings | Leaderboards by region/age/gender | Phase 2 |
| Match history | Verified results, score, opponent, rating impact | Phase 2 |
| Analytics | Rating trend, win rate, performance vs. rating bands | Phase 2 |
| Clubs | Directory, membership, announcements | Phase 2 |
| Events | Discovery, registration, draws, results | Exists (Events app) |
| Team events | Team formats with rating caps/minimums | Phase 3 (TRIACE/KOC) |
| Notifications | Match/score/announcement alerts | Partially exists |

## Items needing a human decision
- Whether UTR data may be imported (licence/ToS) or only manually entered as `externalRating`.
- Whether the XAPK will be provided.
