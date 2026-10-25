# Mobile UX reference audit

Status: **static evidence only (R1)**. No behavior of the reference application was observed on a device or simulator, so nothing here is verified as runtime behavior.

## What was inspected

- Reference package: a local UTR Sports 1.4.10 XAPK supplied by the project owner (`UTR+Sports_1.4.10_APKPure.xapk`). It contains a base APK, two configuration splits, and a manifest.
- Method: the base APK's `AndroidManifest.xml`, the screen (activity) list, and the English string-resource key names were read with jadx in resources-only mode (`--no-src`). No decompiled source was read, copied, or stored in this repository.
- Not inspected, by rule: API endpoints, Firebase or other service configuration values, credentials, tokens, private APIs, network traffic, and any image or branded asset.

## Verified from manifest and resource names

These are facts about what the package declares, not about how it behaves.

- **Screens.** The application declares a single main launcher activity; other declared activities are provider screens (payment, authentication, places search, and similar). The manifest does not show the internal screen tree.
- **Permissions requested.** Location (coarse and fine), Bluetooth, microphone, notifications, and network access. These are relevant to any future PPRC decision on location or notification prompts.
- **Feature vocabulary in resource keys.** Home feed; "my events", "play", and "recent result" feed tabs; team joining with a team passcode; lineup comparison; a profile with a claim-or-create step and rating-range prompts; match lists (for example "my matches" and "completed matches"); and tennis and pickleball team and event categories.

## Assumptions (not verified)

- The home feed and the event/match tabs are the primary entry points.
- Team joining by passcode is the main onboarding path for teams.
- The rating-range prompts are the reference's way to set starting ratings.

Each assumption needs an observed run on a device or simulator before PPRC relies on it.

## What PPRC takes from this audit

Only general usability principles, not the reference's structure or wording:

- Make a personal home dashboard the first destination, showing the next action (upcoming match, challenge, registration).
- Group tournaments, matches, and rankings as top-level destinations, with team and club actions reached from context.
- Show rating ranges and claim-or-create steps as clear, optional profile steps.

## Limitations

- Static resource names cannot show layout, interaction, or flow. Those need observation.
- The reference's rating scale and its UTR branding are not used here. PPRC ratings stay separate and labeled, as required.
