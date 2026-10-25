# PWA validation

Status: **production Chromium shell/offline checks pass**. Offline and waiting-worker controls are implemented. Physical device installation and the complete multi-version update lifecycle remain unverified.

## Verified by the test suite

- The production build emits a web manifest, a service worker and precache entries (`vite build` with the PWA plugin, 19 precache entries in the last build).
- The `pwa` browser check (`tests/pwa.spec.ts`, via `playwright.pwa.config.ts`) passes in `./pprc.sh test-all`.
- App icons present in `apps/web/public`: `icon-192.png`, `icon-512.png`, `icon.svg`.

## Not yet verified

- Installability on iOS Safari and Android Chrome with a real device.
- Offline behavior beyond the tested application shell and a dedicated fallback page.
- Real multi-version update delivery on installed devices; the waiting-worker prompt is implemented.
- Cache versioning rules and that private user data is never cached.
- Deep-link handling after a refresh on every route, beyond the existing navigation tests.
- Offline score submission. This is **not** supported and must not be described as working.

## Next steps

Run the PWA checks against a production build on a device, confirm the cache excludes private routes, and add an update prompt before claiming offline or update behavior.


## October 25 review update

The source production PWA test explicitly waits for a controlling worker, goes offline, reloads the application shell and checks mobile width; earlier wording above that no offline behavior was tested was too broad. This is local Chromium shell evidence, not offline score synchronization or physical-device installation certification. Workbox has no runtime private-data caching rules.

`ConnectionStatus` now announces offline/reconnect state and surfaces a waiting service worker with an explicit Apply update control and save-first notice. Applying sends SKIP_WAITING and reloads after controllerchange. Offline UI state is browser-tested. A real multi-version update lifecycle on installed devices remains to be verified; no such certification is claimed.
