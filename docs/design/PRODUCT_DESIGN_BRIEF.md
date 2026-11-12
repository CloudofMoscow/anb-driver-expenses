# Product Design Brief

## Product

ANB Fleet Finance is a role-based fleet operations and finance application. It connects trips, vehicles, drivers, customer payments, driver expenses, supporting documents, and profitability without mixing accrued amounts with actual cash movement.

The current product is an MVP for one fleet and must remain suitable for later multi-company SaaS development without introducing enterprise complexity prematurely.

## Users

- **Office:** owners and logistics staff who create and assign trips, record rates and payments, review driver expenses, manage the fleet, and monitor receivables and profitability.
- **Driver:** mobile-first users who receive trip information, record loading and unloading, submit odometer photos, add expenses and receipts, work through unstable connectivity, and communicate with the office.

Driver-facing responses must not expose customer rates, contracts, customer payments, receivables, salary calculations, per-kilometre rates, per diem calculations, or driver settlement totals while those features are disabled for drivers.

## Core Product Outcomes

- Make the status and profitability of each trip and vehicle understandable to the office.
- Make the driver's frequent actions fast, clear, and reliable on a phone.
- Keep financial concepts explicit: revenue, customer payments, debt, accruals, transfers, advances, expenses, and adjustments are separate events.
- Preserve an auditable history instead of silently overwriting important financial records.
- Keep submitted work safe when connectivity is weak or temporarily unavailable.

## Critical Workflows

### Office

1. Create and assign a trip with route, customer, agreed rate, and payment terms.
2. Monitor active trips and driver progress.
3. Record customer payments and transfers to drivers with an explicit purpose.
4. Review expenses and supporting documents, focusing attention on exceptions.
5. Find trips, customers, drivers, and vehicles quickly.
6. Review profitability and debt by trip, vehicle, driver, customer, and period.

### Driver

1. Open the assigned trip and understand the next required action.
2. Start the trip with loading details, odometer value, and odometer photo.
3. Add an expense and receipt with minimal input, including while offline.
4. Finish the trip with unloading details, final odometer value, and photo.
5. See synchronization state, requests for clarification, and office messages.

## Experience Requirements

- Prefer one clear primary action and progressive disclosure over many equally prominent cards or controls.
- Use plain, unambiguous language for money, status, responsibility, and required actions.
- Keep high-frequency actions immediately accessible without unnecessary scrolling.
- Provide search and relevant filters for operational lists.
- Preserve the original ANB Group logo and the established product identity while improving consistency and usability.
- Support both light and dark themes without losing contrast or status meaning.
- Do not represent approximate straight-line distance as remaining road distance.

## Platforms and Responsive Scope

- The office experience is desktop-first but must remain usable on phones and tablets.
- The driver experience is mobile-first for current iPhone and Android devices.
- The PWA must adapt across portrait widths from approximately 280 px to 430 px and support phone landscape layouts.
- Respect iPhone safe areas, browser and installed-PWA modes, the on-screen keyboard, touch targets, and reduced-motion preferences.
- Important driver actions and drafts must tolerate intermittent connectivity and communicate synchronization state honestly.

## Product Constraints

- Preserve existing functionality and business rules during visual redesign work.
- Do not change the application stack or dependencies without explicit approval.
- Reuse established components and tokens where possible; avoid parallel design systems.
- Geolocation is permission-based and does not promise continuous background tracking in a closed PWA.
- Push notifications accelerate delivery but in-app synchronization remains the source of truth.

## Design Responsibility and Validation

The AI is responsible for professional typography, color, spacing, grids, component behavior, hierarchy, responsive behavior, interaction states, and accessibility decisions. The user supplies product goals and feedback and is not expected to provide professional design specifications.

Significant UI changes must be inspected in the rendered application at relevant desktop and mobile sizes. The implementation should be iterated when visual inspection reveals usability, layout, hierarchy, or accessibility problems.

This brief defines product context and constraints, not the final visual system. Approved reusable visual decisions belong in `docs/design/DESIGN_DECISIONS.md`.

## Existing Project References

- `docs/PRODUCT_DECISIONS_2026-07-27.md`
- `docs/UX_UI_AUDIT_2026-09-10.md`
- `docs/UX_REDESIGN_AUDIT_2026-07-26.md`
- `docs/mobile-audit-2026-07-24.md`
- `docs/architecture.md`
