# Design Decisions

## Product Visual Direction

TBD

## Information Architecture

TBD

## Typography

TBD

## Color System

- 2026-11-12, F02: application surfaces use existing `--surface` / `--surface-soft` tokens in both themes, including access buttons, selected subsections, driver notifications, history, dialogs, and menus. Authentication inputs deliberately retain white backgrounds paired with fixed dark text.
- `--danger` remains the solid destructive action fill, paired with white text. `--danger-ink` is the readable semantic text colour: `#b61117` in light mode, `#ff7378` in dark mode. Use it for negative financial values, overdue amounts, corrections, errors, and urgent task labels. Do not replace the solid action fill with a light error text colour.
- `--accent-ink` supplies readable brand links and selected state indicators (`#b61117` / `#ff7378`). The original ANB primary action red remains `--accent: #d71920`.
- The light strong control border is `#89919c` (3.18:1 against white). Dark surfaces and the existing success/warning palette are retained. Warning and danger control dots use semantic tokens.

## Spacing and Layout

TBD

## Navigation

TBD

## Components

TBD

## Tables and Data-Dense Interfaces

TBD

## Forms and Inputs

- 2026-11-12: `.field-error` appears in normal flow directly after the field; `.form-error-summary` shares the themed error panel treatment with `.form-error`. Invalid fields use `--danger-ink` borders. Error text and focus are separate indicators. HTML/ARIA, validation, retention of drafts, and submit lifecycle are specified in `QA_FIX_SPEC_2026-11-12.md` and implemented by development.

## Icons

TBD

## Status System

TBD

## Charts and Data Visualization

TBD

## Interaction States

- 2026-11-12: keep the existing 3px focus outline with a 3px offset. In dark mode `--focus: #ff7378`; the fixed dark authentication card uses the same focus colour in either theme. Focus contrast is evaluated against the adjacent surface. Selected subsection buttons also have a brand underline, so selection is not conveyed only by a subtle surface difference.

## Motion

TBD

## Responsive Behavior

TBD

## Accessibility

TBD

## Design Decisions Log

- 2026-11-12 — QA F02 CSS correction and F07/F08/F10/F11 UX specification. Reused existing vanilla CSS, portal components, theme tokens, brand, type and layout. Static token pair contrast: 51/51 pass; evidence in `artifacts/qa-2026-11-12/f02-contrast-results.json`. Browser verification in the design chat was blocked when Windows Computer Use could not reliably determine the Chrome URL; no new viewport or flow is claimed as tested. Ready for repeat QA, not a release approval.
