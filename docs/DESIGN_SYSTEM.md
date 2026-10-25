# PPRC Sports Elite design system

Status: **partial**. The app uses two stylesheets, `style.css` (base tokens and older components) and `premium.css` (dark surfaces, mobile navigation, newer components). They are not yet merged into one token set, and there is no light/dark theme switch.

## Tokens as they exist today

- Dark base in `premium.css`: `color-scheme: dark`, text `#e8edf7`, background `#080d17`.
- Base palette in `style.css`: navy `#102c43`, teal `#087f80`, blue `#245bca`, line `#e1e7eb`, muted `#637586`.
- Champagne accent used for the active bottom-navigation tab and focus rings: `#efd4a0`.
- Bottom navigation surface: `#0b1323` at 95% opacity with backdrop blur.

These values are not yet defined as CSS custom properties, so a theme change means editing several rules.

## Reusable components (existing)

- `Panel`, `Empty`, `Badge`, `Field`, `Form` in `apps/web/src/ui.tsx`: sections, empty states, status labels, labelled controls, and submit forms with pending, success and error states.
- `EventCard`, `Panel`-based tables, the mobile bottom navigation (`.mobile-nav`), `.quick-links`, `.group-tabs`, `.profile-summary`, `.calendar-export`.

## Accessibility notes

- Interactive targets in the new components are at least 44 px high.
- Focus rings use a 3 px champagne outline with a 2 px offset.
- Navigation uses `aria-label` on each landmark, `aria-current="page"` on the active destination, and `aria-pressed` on toggle tabs.

Contrast has not been measured against WCAG 2.2 AA for every surface. That check is still open.

## Not implemented

- Shared design tokens as CSS custom properties, with a light theme.
- A reusable confirmation dialog, toast system, and skeleton loading states.
- Consistent tables and scorecard components across the match center and team screens.

## Feedback components

- `ConfirmDialog` (`feedback.tsx`): a confirmation for irreversible actions, built on the shared `Dialog`. Cancel receives focus first.
- `ToastProvider` and `useToast()`: non-blocking messages in a polite live region, cleared after four seconds. The provider is mounted at the app root. Neither component is yet used by every screen; adoption is still open.
- Reduced motion: animations and transitions are shortened when the user prefers reduced motion.
