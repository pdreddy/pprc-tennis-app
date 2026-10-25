# PPRC Sports Elite design system

Status: **partial consolidation**. `style.css` provides the base, `premium.css` the shared dark surfaces, and `workspace.css` the new workspace tokens/layout. The existing component architecture is preserved; a complete unified theme and light-mode switch remain open.

## Tokens as they exist today

- Dark base in `premium.css`: `color-scheme: dark`, text `#e8edf7`, background `#080d17`.
- Base palette in `style.css`: navy `#102c43`, teal `#087f80`, blue `#245bca`, line `#e1e7eb`, muted `#637586`.
- Champagne accent used for the active bottom-navigation tab and focus rings: `#efd4a0`.
- Bottom navigation surface: `#0b1323` at 95% opacity with backdrop blur.

The new workspace palette uses named CSS custom properties. Some inherited component values remain explicit and still need consolidation.

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
- Consistent confirmation/toast adoption and skeleton loading states across every route; shared confirmation and toast components already exist.
- Consistent tables and scorecard components across the match center and team screens.

## Feedback components

- `ConfirmDialog` (`feedback.tsx`): a confirmation for irreversible actions, built on the shared `Dialog`. Cancel receives focus first.
- `ToastProvider` and `useToast()`: non-blocking messages in a polite live region, cleared after four seconds. The provider is mounted at the app root. Neither component is yet used by every screen; adoption is still open.
- Reduced motion: animations and transitions are shortened when the user prefers reduced motion.


## October 25 workspace redesign

`workspace.css` adds a named midnight/champagne token family (`--workspace-bg`, `--workspace-panel`, `--workspace-raised`, `--workspace-text`, `--workspace-muted`, `--workspace-accent`, `--workspace-border`, radius/gap) layered over the existing styles. This is incremental consolidation; inherited styles are still present and light mode remains open.

`workspace.tsx` reuses the shared native Dialog/Field for a keyboard-accessible quick search. It searches authorized public event records and role-appropriate navigation, without exposing private events or suggesting unauthorized admin destinations. Header notices show a real unread indicator. Skip navigation and route focus target the main landmark; browser back/forward retains native scroll behavior.

The player home has a responsive two-column data layout, supplied-reference cards, live-query activity counts with explicit loading/error states, and a next-action card selected from owned incoming challenges, pending payment and upcoming singles. Completed or historically completed challenges are excluded from the active list. Event/team/challenge rows link to their existing functional workflows. Guest discovery retains its existing route and controls. No artificial statistics, scores or rating graphs were introduced.

Keyboard search, modal Escape/focus return, actual unread counts, offline indicator, route refresh, desktop/mobile overflow and serious/critical axe findings are covered in `tests/workspace.spec.ts`. Existing role-route WCAG samples remain enabled. This is not full manual WCAG certification or a complete every-control audit. Synthetic review screenshots: [desktop](screenshots/pprc-workspace-desktop.png) and [mobile](screenshots/pprc-workspace-mobile.png). These are real browser captures, not pixel-regression baselines.
