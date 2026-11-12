# Design QA — responsive redesign v69

## Evidence

- Office source visual truth: `C:\Users\danil\.codex\generated_images\019f75eb-0b33-7ac0-9139-fce81646e9b0\exec-e7b0db74-1dca-4d75-a274-0305fa86b4ac.png`
- Office desktop implementation screenshot: `C:\Users\danil\OneDrive\Документы\ANB расходы\anb-driver-expenses\artifacts\qa-office-v64.png`
- Office phone implementation screenshot: `C:\Users\danil\OneDrive\Документы\ANB расходы\anb-driver-expenses\artifacts\qa-office-390x844-v67.png`
- Office compact implementation screenshots: `artifacts\qa-office-280x653-v65.png`, `artifacts\qa-office-320x568-v65.png`
- Office combined comparison: `C:\Users\danil\OneDrive\Документы\ANB расходы\anb-driver-expenses\artifacts\qa-office-comparison-v67.png`
- Driver source visual truth: `C:\Users\danil\.codex\generated_images\019f75eb-0b33-7ac0-9139-fce81646e9b0\exec-3a12ef1d-817b-49bb-9c4f-7afb3f87402f.png`
- Driver implementation screenshot: `C:\Users\danil\OneDrive\Документы\ANB расходы\anb-driver-expenses\artifacts\qa-driver-390x844-v67.png`
- Driver compact implementation screenshots: `artifacts\qa-driver-280x653-v66.png`, `artifacts\qa-driver-320x568-v65.png`
- Driver combined comparison: `C:\Users\danil\OneDrive\Документы\ANB расходы\anb-driver-expenses\artifacts\qa-driver-comparison-v67.png`
- Login implementation screenshot: `C:\Users\danil\OneDrive\Документы\ANB расходы\anb-driver-expenses\artifacts\qa-login-390x844-v68.png`
- Browser-rendered implementation: `http://127.0.0.1:8787/`

## Normalization

- Office source: 1486 × 1059 px. Desktop implementation: 1473 × 1017 px at a 1488 × 1027 CSS viewport, density 1. The small crop difference is browser framing. The new responsive rules are scoped to widths up to 680 px and do not change this desktop comparison.
- Driver source: 853 × 1844 px, treated as an approximately 426.5 × 922 CSS-pixel @2x reference. The current phone capture is 375 × 812 px from a 390 × 844 CSS viewport; the source was proportionally fitted to the same pixel dimensions for the side-by-side comparison.
- Full-view source and implementation were opened together in `qa-office-comparison-v67.png` and `qa-driver-comparison-v67.png` before judging fidelity.
- Focused regions checked: office header/search/quick actions/task filters; driver header/long route/timeline/primary action/quick actions/bottom navigation; login branding/form/theme control.

## Comparison history

### Iteration 1 — blocked

- [P1] Office overview still used the older KPI-and-active-trips dashboard instead of the selected task workspace.
  - Fix: replaced the above-the-fold overview with global search, four quick actions, “Сегодня”, “Контроль”, “Последние” and recent objects. Existing financial detail remains in its dedicated sections.
- [P2] Driver bottom navigation collapsed to three grid columns and wrapped “Сообщения” onto a second row at 390 px.
  - Fix: overrode the capability-gated three-column selector with four equal columns and verified a 68 px single-row bottom bar.
- [P2] The mobile account control occupied a large header block and changed the above-the-fold proportions.
  - Fix: reduced it to a compact text control while keeping theme, password and logout available.
- [P2] The third driver quick action was geolocation rather than the selected “Сообщить офису”.
  - Fix: restored “Сообщить офису” and moved manual location refresh into the active timeline step.

### Iteration 2 — passed

- Office implementation now follows the selected hierarchy and proportions: fixed sidebar, search, four equal actions, dominant task list, compact control column and recent objects.
- Driver implementation now follows the selected mobile hierarchy: branded header, active route timeline, dominant expense CTA, three quick actions, sync status and four-item bottom navigation.
- No horizontal overflow was found at 390, 426, 1440 or 1488 px.
- Browser console: no errors or warnings in final office and driver states.

### Iteration 3 — responsive matrix blocked, then fixed

- [P1] At portrait widths 320–430 px the office page was wider than the viewport (up to 455 px), so search and the notification action created horizontal page scrolling.
  - Fix: rebuilt the mobile top bar as a constrained grid, added `min-width: 0` to flex/grid children, isolated horizontal scrolling inside menus and chips, and prevented page-level x overflow.
- [P2] At 844 × 390 landscape the four visible driver tabs inherited an obsolete three-column grid and could wrap.
  - Fix: the landscape navigation now always uses four equal columns.
- [P2] At 280–320 px long route names, account controls and bottom-navigation labels were cramped.
  - Fix: added compact typography/spacing, safe-area-aware gutters, controlled wrapping, a shorter visual label «Связь» at the narrow breakpoint and a one-column quick-action fallback below 300 px.
- [P2] The login theme toggle had insufficient text contrast on the black authentication card.
  - Fix: raised the text and border contrast while preserving the agreed dark ANB login surface.

### Iteration 4 — passed

- No horizontal page overflow at 280 × 653, 320 × 568, 360 × 640, 375 × 667, 390 × 844, 412 × 915, 430 × 932, 568 × 320 or 844 × 390 in the tested office and driver states.
- The office quick actions are 1 column at 280 px, 2 × 2 from 320–680 px and 4 columns on desktop.
- Driver bottom navigation remains one row of four controls in portrait and landscape phone modes.
- Login at 390 × 844 fills the available height without page overflow; focus, labels, primary action and theme control remain visible.
- Dark office theme at 390 × 844 has no horizontal overflow; sampled foreground `rgb(245, 246, 248)` on surface `rgb(25, 28, 32)` remains readable.
- Final browser console check: no warnings or errors.

## Required fidelity surfaces

- Fonts and typography: Segoe UI/Inter-compatible system stack, strong 700–750 task/route hierarchy, muted supporting copy and controlled `overflow-wrap` for real long Russian routes and names. Compact navigation copy does not force the page wider.
- Spacing and layout rhythm: office retains the selected desktop work area/control column and becomes a 2 × 2 or 1-column action layout on phones; driver keeps a single vertical rhythm and one-row bottom navigation with safe-area padding.
- Colors and tokens: white/light-gray surfaces, black primary text, ANB red actions, green success, orange warning and red debt/urgent states. Dark tokens were verified separately with readable foreground/background contrast.
- Image quality and asset fidelity: the original vector `anb-logo.svg` is used in every portal. No replacement logo, emoji or placeholder imagery is present.
- Copy and content: driver financial figures remain hidden. “Аванс” in operational expense context is “Деньги на расходы от офиса”; customers remain a complete directory with “Только с долгом”. The compact «Связь» label retains the full accessible «Сообщения» control name in HTML.

## Primary interactions tested

- Office: horizontal mobile menu, global search, four quick actions, dedicated expenses route, theme toggle, task filters and the compact/landscape layout states.
- Driver: four-tab navigation, long multi-stop route wrapping, expense CTA, quick actions, compact bottom navigation and landscape layout states.
- Login: labels, focus state, primary action, protected-data message and light/dark theme control at the phone viewport.
- Server: authenticated driver location write, latest location returned to driver and office, invalid/non-active trip protection and 180-day retention cleanup.

## Follow-up polish (P3)

- Add a consistent production icon library for the task-list and bottom-navigation icons; the current build intentionally keeps text-first controls and the original logo rather than inventing icons.
- Once a Russian road-routing provider is selected, replace the honest “Расстояние по дорогам пока не рассчитано” state with a routed distance and timestamp.
- Verify geolocation permission, battery impact and installed-PWA behavior on the actual iPhone and Android devices.
- Final safe-area and keyboard behavior still needs physical-device verification on at least one notched iPhone and one Android device with gesture navigation; browser emulation cannot reproduce every OS inset and keyboard behavior.

final result: passed

## Iteration 5 — login field contrast

- [P1] The redesigned form rules changed the login fields to a white surface, while an older authentication-card rule kept the entered text white. This produced white text on a white field.
- Fix: the authentication fields now explicitly use dark text and caret on the white surface; placeholders and Chromium/WebKit autofill receive matching readable colors in both application themes.
- Verified in the running app at 360 × 800, 390 × 844 and 1280 × 800. The computed field foreground is `rgb(17, 17, 17)`, the surface is `rgb(255, 255, 255)`, and no horizontal page overflow was found.
- PWA cache revision advanced to `v70` so installed and mobile clients receive the corrected stylesheet.
- Static checks passed; automated test suite passed 32/32.

final result: passed

## Iteration 6 — audit implementation and information-density reduction

- Reworked the office information hierarchy without changing the API or financial model: four persistent quick actions remain above the fold; profitability now starts with revenue, total costs and result; detailed cost composition is disclosed on demand.
- Reworked trip and driver-balance cards around three decision-making figures. The full calculation, accrual breakdown and expense reconciliation remain available in expandable sections.
- Changed customer and access settings flows to “search/list first, creation second”. Creation forms are collapsed until requested, so routine checks no longer begin with long empty forms.
- Simplified the driver-transfer form: recipient, direction, date and allocation are primary; method, trip, note and proof are optional details. “Advance” wording was replaced with “money for expenses” and “confirmed by receipts”.
- Expanded global search to customers, trips, drivers, rigs, tractors and trailers. Search results are now cleared and closed whenever the user navigates away.
- Added a compact mobile “More” menu. At widths up to 480 px, the top row contains Overview, Trips and Expenses; Drivers, Fleet, Customers, Profitability and Settings remain one tap away.
- Driver home action is state-aware: start an assigned trip, add an expense during an active trip, or open trip details in other states. Driver salary and per-diem amounts remain invisible.
- Fixed the expense form so its save action does not collide with the fixed bottom navigation. Fixed trip-row action/status collision at intermediate desktop widths.
- Increased remaining interactive targets to at least 44 × 44 CSS px and raised dark-theme red helper text to a readable contrast color.
- The original `anb-logo.svg` remains the only product logo. Existing ANB tokens, typography and component patterns were reused; no new framework or production dependency was added.
- Superdesign CLI authenticated successfully. Its available design-system references were inspected; the approved ANB direction was retained instead of generating a competing visual style.

### Final responsive QA

- Browser-tested at 360 × 800, 390 × 844, 412 × 915, 768 × 1024, 1280 × 800, 1440 × 900 and 1920 × 1080.
- No horizontal page overflow at any tested viewport.
- Mobile office quick actions contain Create trip, Record payment, Transfer to driver and Add expense; mobile overflow navigation opens above the workspace and closes after selection.
- Driver expense save action and fixed navigation do not overlap; visible driver controls meet the 44 px touch-target minimum.
- Search verified with a vehicle query (`КамАЗ`) and a customer/trip query (`Север`).
- Dark theme checked in the office and driver portals. The driver portal exposes no visible salary or per-diem text.
- `npm run check`: passed.
- `npm test`: 32/32 passed.
- PWA cache revision advanced to `v74`.

final result: passed

## Iteration 7 — global-search label state

- Fixed the desktop search label so “Что найти или сделать?” fades out when the field receives focus or contains text. Entered text now uses the normal left padding instead of appearing after the label.
- When the field is empty and blurred, the label returns. Mobile keeps the native placeholder behavior.
- Browser-tested with a real `КамАЗ` search at 360 × 800, 390 × 844 and 1280 × 800. No label overlap or horizontal overflow was found.
- PWA cache revision advanced to `v75`; `npm run check` passed and `npm test` passed 32/32.

final result: passed
