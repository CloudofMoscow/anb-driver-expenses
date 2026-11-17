# Project instructions

## UX/UI and responsive design

- При любых UI-задачах использовать проектный навык `$fleet-product-design` из `.agents/skills/fleet-product-design/SKILL.md`.
- Сохранять существующую бизнес-логику; не менять стек и зависимости без подтверждения пользователя.
- Переиспользовать существующие компоненты и дизайн-токены, не создавать параллельную дизайн-систему без необходимости.
- Проверять изменённый интерфейс в реальном браузере на мобильном и компьютерном размерах.
- По прямому предпочтению владельца от 17 ноября 2026 года для браузерной проверки предпочитать Microsoft Edge через подключённое расширение. Если Edge недоступен и используется другой браузер, явно указать это в результатах проверки.
- Не завершать UI-задачу только на основании успешной сборки.
- В итоговом сообщении перечислять реально проверенные размеры экрана и пользовательские сценарии.

## Product Design

- For UI/UX and frontend visual design work, use the installed `$ui-ux-pro-max` skill in addition to the existing `$fleet-product-design` rule.
- Read `docs/design/PRODUCT_DESIGN_BRIEF.md` before significant design work.
- The AI is responsible for professional UI/UX decisions.
- Do not expect the user to define typography, color systems, spacing systems, component systems, grids, or other professional design specifications.
- Preserve all existing product functionality.
- Check significant UI changes in the actual rendered application, not only by reviewing source code.
- Visually inspect the implementation and iterate when necessary.
- Document established reusable design decisions in `docs/design/DESIGN_DECISIONS.md`.

## Codex working context

- Read `docs/CODEX_PROJECT_CONTEXT.md` when starting work in this checkout. It records the selected branch, module map, important business rules, and verified baseline.
- The owner selected `codex/foundation-v1` as the basis for further work on 12 November 2026. `main` contains the old local-only prototype.
- Use the isolated demo or test databases for verification; do not use the owner's production database for development checks.

<!-- BEGIN ui-craft (managed — do not edit) -->
# ui-craft skill

The ui-craft skill is installed at: C:\Users\DELL\.codex\skills\ui-craft

Load it at the start of any UI design or implementation task.
<!-- END ui-craft -->
