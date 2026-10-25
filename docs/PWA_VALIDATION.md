# PWA validation

Status: **the production PWA check passes**; installability on devices, offline behavior and update prompts are not validated.

## Verified by the test suite

- The production build emits a web manifest, a service worker and precache entries (`vite build` with the PWA plugin, 19 precache entries in the last build).
- The `pwa` browser check (`tests/pwa.spec.ts`, via `playwright.pwa.config.ts`) passes in `./pprc.sh test-all`.
- App icons present in `apps/web/public`: `icon-192.png`, `icon-512.png`, `icon.svg`.

## Not yet verified

- Installability on iOS Safari and Android Chrome with a real device.
- Offline shell and an offline fallback page.
- Update notifications when a new service worker is waiting.
- Cache versioning rules and that private user data is never cached.
- Deep-link handling after a refresh on every route, beyond the existing navigation tests.
- Offline score submission. This is **not** supported and must not be described as working.

## Next steps

Run the PWA checks against a production build on a device, confirm the cache excludes private routes, and add an update prompt before claiming offline or update behavior.
