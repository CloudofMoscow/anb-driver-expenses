# UX/UI implementation checkpoint — 25 July 2026

This file records local implementation checkpoints because the repository already had unrelated
uncommitted work before the redesign. No Git history was rewritten and no remote push was made.

## Baseline

- `npm.cmd run check`: passed.
- `npm.cmd test`: 29 of 29 tests passed.
- Office and driver role separation confirmed.
- Driver compensation remains capability-gated and hidden by default.

## Checkpoint 1 — public/PWA contour

- Legacy `index.html` and `app.js` removed from the server allowlist and PWA precache.
- `/index.html` and `/app.js` now return 404 from the current server.
- Regression checks added.
- KPI copy, Russian date formatting, payment-count wording, Push blocked state and critical toast semantics improved.
- Test result after checkpoint: 29 of 29 passed.

## Checkpoint 2 — office information architecture

- Hash-based stable routes added for overview, trips, trip detail, drivers, fleet, profitability,
  customers, settings and trip creation.
- Browser Back/Forward and refresh use the same route state.
- Driver balances, transfers, rates and adjustments are separate subviews.
- Fleet rigs, vehicles and recurring costs are separate subviews.
- Access and expense categories moved to Settings without changing API or database structures.
- Trip list and trip detail are separated; a trip detail has a reproducible URL.
- Customer debt now exposes related unpaid trips and payment actions.

## Checkpoint 3 — dialogs and driver navigation

- Office business operations no longer use browser `prompt` or `confirm`.
- A reusable native-dialog pattern is used for route edits, measurement corrections, reviews,
  reversals, rate adjustments, trip confirmation and password/access changes.
- Driver tabs now have stable hash routes and complete tab/panel relationships.
- Driver history has a status filter.
- Duplicate “Start trip” action is hidden after its form is expanded.
- Driver prompts/confirms were replaced with the same accessible dialog pattern.

## Still in progress

- Finish the remaining responsive-size, reduced-motion and console browser checks.
- Produce the final implementation report and final screenshots.

## Checkpoint 4 — consolidated UI and browser verification (26 July 2026)

- Added a unified visual/accessibility layer for routes, compact trip lists, detailed trip views,
  section switchers, customer debt rows, dialogs, form focus, loading, disabled and empty states.
- Added a customer empty state with direct recovery actions.
- Added `aria-busy` handling to office forms, driver actions, contract upload and Push setup.
- Geolocation failure is now explained once without blocking an offline driver record.
- Moved Push, password and logout controls into compact account menus so the driver header keeps
  the trip context and sync status readable on narrow phones.
- Added static regression tests for stable hash routing, removal of browser prompt/confirm,
  tab/panel ARIA links and driver-compensation privacy.
- PWA cache version is now `v55`.
- `npm.cmd run check`: passed.
- `npm.cmd test`: 32 of 32 tests passed.
- Browser verified: office and driver Back/Forward/refresh, nested office routes, driver keyboard
  tab navigation, dialog focus return, no horizontal page overflow at 390 px, cached driver data
  while the demo server was unavailable, and successful reconnect after restart.
- The driver action form is collapsed until the primary action is selected on every width.
- Secondary trip facts use the existing “Детали рейса” disclosure on every width.
- Landscape phones keep the primary driver action above the fixed bottom navigation.
- Final `npm.cmd run check`: passed; final `npm.cmd test`: 32 of 32 passed.
