# Design Decisions

## Product Visual Direction

- 2026-11-17: calm operational ANB UI: neutral themed surfaces, one red primary action, restrained 8–12px radii, sparse shadows. Preserve logo and financial semantics. No decorative charts or invented data.

## Information Architecture

TBD

## Typography

- 2026-11-17: system stack (`-apple-system`, BlinkMacSystemFont, Segoe UI, Roboto, Arial). Driver route 20–24px/1.3; ordinary form controls 16px, amount 24px with tabular figures; persistent field labels 14px. Header identity 18–20px, secondary role/network copy 12px. No remote font dependency.

## Color System

- 2026-11-12, F02: application surfaces use existing `--surface` / `--surface-soft` tokens in both themes, including access buttons, selected subsections, driver notifications, history, dialogs, and menus. Authentication inputs deliberately retain white backgrounds paired with fixed dark text.
- `--danger` remains the solid destructive action fill, paired with white text. `--danger-ink` is the readable semantic text colour: `#b61117` in light mode, `#ff7378` in dark mode. Use it for negative financial values, overdue amounts, corrections, errors, and urgent task labels. Do not replace the solid action fill with a light error text colour.
- `--accent-ink` supplies readable brand links and selected state indicators (`#b61117` / `#ff7378`). The original ANB primary action red remains `--accent: #d71920`.
- The light strong control border is `#89919c` (3.18:1 against white). Dark surfaces and the existing success/warning palette are retained. Warning and danger control dots use semantic tokens.

## Spacing and Layout

- 2026-11-17: driver max width 800px; desktop office sidebar 224px (200px at 901–1100px), office gutters 24–40px. Main working rhythm 8/12/16/20/24px. Driver header natural minimum 64px, logo 40px. Timeline height follows content, with 20px markers; full addresses remain available.

## Navigation

- 2026-11-17: driver tabs share one flex row across roles/capabilities; hidden expense/money never reserve grid cells. Messages receives extra width for its full Russian label. Fixed bottom navigation at ≤900px, sticky in-flow navigation above that; reserve height plus safe-area. Do not hide navigation merely because an input has focus.
- Office sidebar persists on desktop; phone navigation shows Overview/Trips/Expenses plus More containing all remaining routes. Working headers scroll in document flow on mobile, avoiding two stacked sticky headers. Search has a permanently visible label above its input.

## Components

TBD

## Tables and Data-Dense Interfaces

TBD

## Forms and Inputs

- 2026-11-12: `.field-error` appears in normal flow directly after the field; `.form-error-summary` shares the themed error panel treatment with `.form-error`. Invalid fields use `--danger-ink` borders. Error text and focus are separate indicators. HTML/ARIA, validation, retention of drafts, and submit lifecycle are specified in `QA_FIX_SPEC_2026-11-12.md` and implemented by development.
- 2026-11-17: expense submit remains static in document flow, ≥54px, with a shell reserve under bottom navigation. Native date/time controls and grid children have min-inline-size:0/max-inline-size:100%; WebKit edit value stays shrinkable. No custom date picker, VisualViewport keyboard heuristic, zoom restriction, or data reset. Photo input retains its original file and visible filename contract from development.

## Icons

TBD

## Status System

TBD

## Charts and Data Visualization

TBD

## Interaction States

- 2026-11-12: keep the existing 3px focus outline with a 3px offset. In dark mode `--focus: #ff7378`; the fixed dark authentication card uses the same focus colour in either theme. Focus contrast is evaluated against the adjacent surface. Selected subsection buttons also have a brand underline, so selection is not conveyed only by a subtle surface difference.

## Motion

- 2026-11-17: operational tabs appear without entrance animation; hover feedback changes colour/border without positional jumps. Keep existing reduced-motion handling and never make interaction correctness depend on an animation.

## Responsive Behavior

- 2026-11-17: safe areas use existing `--safe-*` tokens. Top/bottom padding adds the inset to the base gutter, left/right use max(gutter,inset); driver bottom reserve accounts for fixed navigation. No global overflow-x clipping. Focus alone is not a keyboard signal. Native Safari controls receive preventive sizing, while real iOS keyboard/camera/PWA still require field testing.

## Accessibility

TBD

## Design Decisions Log

- 2026-11-12 — QA F02 CSS correction and F07/F08/F10/F11 UX specification. Reused existing vanilla CSS, portal components, theme tokens, brand, type and layout. Static token pair contrast: 51/51 pass; evidence in `artifacts/qa-2026-11-12/f02-contrast-results.json`. Browser verification in the design chat was blocked when Windows Computer Use could not reliably determine the Chrome URL; no new viewport or flow is claimed as tested. Ready for repeat QA, not a release approval.
- 2026-11-17 — responsive shell consolidated (415 duplicate selector overrides removed); driver home/expense and office overview styled and smoke-checked in **Microsoft Edge extension at 390×844 and 1280×800**. Light/dark office, phone driver home and form, desktop dark driver home/form inspected; zero root X-overflow in measured scenarios. Details and limits in `UI_SHELL_SPEC_2026-11-17.md`. Final QA depends on development moving the home CTA before the long timeline and refreshing the PWA version after CSS freeze. Complete device matrix and physical iOS are not claimed as checked.

- 2026-11-17 — integration completed at v87: existing home CTA moved before the timeline; expense uses the visible parent Expenses tab with matching ARIA controls; completed/assigned/empty trip hints follow the actual state. CSS remained frozen through independent QA. See UI_SHELL_QA_2026-11-17.md for the measured matrix and physical-device limits.
