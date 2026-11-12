# UI/UX Pro Max — манифест локальной установки

Дата установки: 11 сентября 2026 года.

Команда установки:

```powershell
npx.cmd --yes ui-ux-pro-max-cli@latest init --ai codex
```

Результат предварительной проверки:

- Node.js: `v24.18.0`
- npm: `11.16.0`
- Python: `3.12.14` (встроенная среда Codex)
- `AGENTS.md`: не изменён
- исходный код приложения: не изменён

Установщик создал 36 каталогов и 172 файла в репозиторном каталоге `.agents/skills/`.

## Созданные каталоги

```text
.agents/skills/banner-design
.agents/skills/banner-design/references
.agents/skills/brand
.agents/skills/brand/references
.agents/skills/brand/scripts
.agents/skills/brand/scripts/tests
.agents/skills/brand/templates
.agents/skills/design-system
.agents/skills/design-system/data
.agents/skills/design-system/references
.agents/skills/design-system/scripts
.agents/skills/design-system/scripts/tests
.agents/skills/design-system/templates
.agents/skills/design
.agents/skills/design/data
.agents/skills/design/data/cip
.agents/skills/design/data/icon
.agents/skills/design/data/logo
.agents/skills/design/references
.agents/skills/design/scripts
.agents/skills/design/scripts/cip
.agents/skills/design/scripts/icon
.agents/skills/design/scripts/logo
.agents/skills/slides
.agents/skills/slides/references
.agents/skills/ui-styling
.agents/skills/ui-styling/references
.agents/skills/ui-styling/scripts
.agents/skills/ui-styling/scripts/tests
.agents/skills/ui-ux-pro-max
.agents/skills/ui-ux-pro-max/data
.agents/skills/ui-ux-pro-max/data/stacks
.agents/skills/ui-ux-pro-max/scripts
.agents/skills/ui-ux-pro-max/scripts/tests
.agents/skills/ui-ux-pro-max/scripts/tests/fixtures
.agents/skills/ui-ux-pro-max/scripts/tests/fixtures/catalogs
```

## Созданные файлы

```text
.agents/skills/banner-design/references/banner-sizes-and-styles.md
.agents/skills/banner-design/SKILL.md
.agents/skills/brand/references/approval-checklist.md
.agents/skills/brand/references/asset-organization.md
.agents/skills/brand/references/brand-guideline-template.md
.agents/skills/brand/references/color-palette-management.md
.agents/skills/brand/references/consistency-checklist.md
.agents/skills/brand/references/logo-usage-rules.md
.agents/skills/brand/references/messaging-framework.md
.agents/skills/brand/references/typography-specifications.md
.agents/skills/brand/references/update.md
.agents/skills/brand/references/visual-identity.md
.agents/skills/brand/references/voice-framework.md
.agents/skills/brand/scripts/extract-colors.cjs
.agents/skills/brand/scripts/inject-brand-context.cjs
.agents/skills/brand/scripts/sync-brand-to-tokens.cjs
.agents/skills/brand/scripts/tests/test_sync_brand_to_tokens.py
.agents/skills/brand/scripts/validate-asset.cjs
.agents/skills/brand/SKILL.md
.agents/skills/brand/templates/brand-guidelines-starter.md
.agents/skills/design-system/data/slide-backgrounds.csv
.agents/skills/design-system/data/slide-charts.csv
.agents/skills/design-system/data/slide-color-logic.csv
.agents/skills/design-system/data/slide-copy.csv
.agents/skills/design-system/data/slide-layout-logic.csv
.agents/skills/design-system/data/slide-layouts.csv
.agents/skills/design-system/data/slide-strategies.csv
.agents/skills/design-system/data/slide-typography.csv
.agents/skills/design-system/references/component-specs.md
.agents/skills/design-system/references/component-tokens.md
.agents/skills/design-system/references/primitive-tokens.md
.agents/skills/design-system/references/semantic-tokens.md
.agents/skills/design-system/references/states-and-variants.md
.agents/skills/design-system/references/tailwind-integration.md
.agents/skills/design-system/references/token-architecture.md
.agents/skills/design-system/scripts/embed-tokens.cjs
.agents/skills/design-system/scripts/fetch-background.py
.agents/skills/design-system/scripts/generate-slide.py
.agents/skills/design-system/scripts/generate-tokens.cjs
.agents/skills/design-system/scripts/html-token-validator.py
.agents/skills/design-system/scripts/search-slides.py
.agents/skills/design-system/scripts/slide_search_core.py
.agents/skills/design-system/scripts/slide-token-validator.py
.agents/skills/design-system/scripts/tests/test_validate_tokens.py
.agents/skills/design-system/scripts/validate-tokens.cjs
.agents/skills/design-system/SKILL.md
.agents/skills/design-system/templates/design-tokens-starter.json
.agents/skills/design/data/cip/deliverables.csv
.agents/skills/design/data/cip/industries.csv
.agents/skills/design/data/cip/mockup-contexts.csv
.agents/skills/design/data/cip/styles.csv
.agents/skills/design/data/icon/styles.csv
.agents/skills/design/data/logo/colors.csv
.agents/skills/design/data/logo/industries.csv
.agents/skills/design/data/logo/styles.csv
.agents/skills/design/references/banner-sizes-and-styles.md
.agents/skills/design/references/cip-deliverable-guide.md
.agents/skills/design/references/cip-design.md
.agents/skills/design/references/cip-prompt-engineering.md
.agents/skills/design/references/cip-style-guide.md
.agents/skills/design/references/design-routing.md
.agents/skills/design/references/icon-design.md
.agents/skills/design/references/logo-color-psychology.md
.agents/skills/design/references/logo-design.md
.agents/skills/design/references/logo-prompt-engineering.md
.agents/skills/design/references/logo-style-guide.md
.agents/skills/design/references/slides-copywriting-formulas.md
.agents/skills/design/references/slides-create.md
.agents/skills/design/references/slides-html-template.md
.agents/skills/design/references/slides-layout-patterns.md
.agents/skills/design/references/slides-strategies.md
.agents/skills/design/references/slides.md
.agents/skills/design/references/social-photos-design.md
.agents/skills/design/scripts/cip/core.py
.agents/skills/design/scripts/cip/generate.py
.agents/skills/design/scripts/cip/render-html.py
.agents/skills/design/scripts/cip/search.py
.agents/skills/design/scripts/icon/generate.py
.agents/skills/design/scripts/logo/core.py
.agents/skills/design/scripts/logo/generate.py
.agents/skills/design/scripts/logo/search.py
.agents/skills/design/SKILL.md
.agents/skills/slides/references/copywriting-formulas.md
.agents/skills/slides/references/create.md
.agents/skills/slides/references/html-template.md
.agents/skills/slides/references/layout-patterns.md
.agents/skills/slides/references/slide-strategies.md
.agents/skills/slides/SKILL.md
.agents/skills/ui-styling/LICENSE.txt
.agents/skills/ui-styling/references/canvas-design-system.md
.agents/skills/ui-styling/references/shadcn-accessibility.md
.agents/skills/ui-styling/references/shadcn-components.md
.agents/skills/ui-styling/references/shadcn-theming.md
.agents/skills/ui-styling/references/tailwind-customization.md
.agents/skills/ui-styling/references/tailwind-responsive.md
.agents/skills/ui-styling/references/tailwind-utilities.md
.agents/skills/ui-styling/scripts/requirements.txt
.agents/skills/ui-styling/scripts/shadcn_add.py
.agents/skills/ui-styling/scripts/tailwind_config_gen.py
.agents/skills/ui-styling/scripts/tests/coverage-ui.json
.agents/skills/ui-styling/scripts/tests/requirements.txt
.agents/skills/ui-styling/scripts/tests/test_shadcn_add.py
.agents/skills/ui-styling/scripts/tests/test_tailwind_config_gen.py
.agents/skills/ui-styling/SKILL.md
.agents/skills/ui-ux-pro-max/data/app-interface.csv
.agents/skills/ui-ux-pro-max/data/catalog-summary.json
.agents/skills/ui-ux-pro-max/data/charts.csv
.agents/skills/ui-ux-pro-max/data/colors.csv
.agents/skills/ui-ux-pro-max/data/data-provenance.json
.agents/skills/ui-ux-pro-max/data/google-font-licenses.json
.agents/skills/ui-ux-pro-max/data/google-fonts.csv
.agents/skills/ui-ux-pro-max/data/icons.csv
.agents/skills/ui-ux-pro-max/data/landing.csv
.agents/skills/ui-ux-pro-max/data/motion.csv
.agents/skills/ui-ux-pro-max/data/phosphor-icons-upstream.json
.agents/skills/ui-ux-pro-max/data/products.csv
.agents/skills/ui-ux-pro-max/data/react-performance.csv
.agents/skills/ui-ux-pro-max/data/stacks/angular.csv
.agents/skills/ui-ux-pro-max/data/stacks/astro.csv
.agents/skills/ui-ux-pro-max/data/stacks/avalonia.csv
.agents/skills/ui-ux-pro-max/data/stacks/flutter.csv
.agents/skills/ui-ux-pro-max/data/stacks/html-tailwind.csv
.agents/skills/ui-ux-pro-max/data/stacks/javafx.csv
.agents/skills/ui-ux-pro-max/data/stacks/jetpack-compose.csv
.agents/skills/ui-ux-pro-max/data/stacks/laravel.csv
.agents/skills/ui-ux-pro-max/data/stacks/nextjs.csv
.agents/skills/ui-ux-pro-max/data/stacks/nuxt-ui.csv
.agents/skills/ui-ux-pro-max/data/stacks/nuxtjs.csv
.agents/skills/ui-ux-pro-max/data/stacks/react-native.csv
.agents/skills/ui-ux-pro-max/data/stacks/react.csv
.agents/skills/ui-ux-pro-max/data/stacks/shadcn.csv
.agents/skills/ui-ux-pro-max/data/stacks/svelte.csv
.agents/skills/ui-ux-pro-max/data/stacks/swiftui.csv
.agents/skills/ui-ux-pro-max/data/stacks/threejs.csv
.agents/skills/ui-ux-pro-max/data/stacks/uno.csv
.agents/skills/ui-ux-pro-max/data/stacks/uwp.csv
.agents/skills/ui-ux-pro-max/data/stacks/vue.csv
.agents/skills/ui-ux-pro-max/data/stacks/winui.csv
.agents/skills/ui-ux-pro-max/data/stacks/wpf.csv
.agents/skills/ui-ux-pro-max/data/styles.csv
.agents/skills/ui-ux-pro-max/data/typography.csv
.agents/skills/ui-ux-pro-max/data/ui-reasoning.csv
.agents/skills/ui-ux-pro-max/data/ux-guidelines.csv
.agents/skills/ui-ux-pro-max/scripts/core.py
.agents/skills/ui-ux-pro-max/scripts/design_system.py
.agents/skills/ui-ux-pro-max/scripts/reasoning_contract.py
.agents/skills/ui-ux-pro-max/scripts/search.py
.agents/skills/ui-ux-pro-max/scripts/tests/fixtures/catalogs/google-api.json
.agents/skills/ui-ux-pro-max/scripts/tests/fixtures/catalogs/google-catalog.json
.agents/skills/ui-ux-pro-max/scripts/tests/fixtures/catalogs/google-existing.csv
.agents/skills/ui-ux-pro-max/scripts/tests/fixtures/catalogs/google-metadata.json
.agents/skills/ui-ux-pro-max/scripts/tests/fixtures/catalogs/google-overrides.json
.agents/skills/ui-ux-pro-max/scripts/tests/fixtures/catalogs/icons-curated.csv
.agents/skills/ui-ux-pro-max/scripts/tests/fixtures/catalogs/phosphor-core.json
.agents/skills/ui-ux-pro-max/scripts/tests/fixtures/catalogs/phosphor-package.json
.agents/skills/ui-ux-pro-max/scripts/tests/fixtures/catalogs/phosphor-react-exports.json
.agents/skills/ui-ux-pro-max/scripts/tests/fixtures/catalogs/phosphor-react-package.json
.agents/skills/ui-ux-pro-max/scripts/tests/fixtures/relevance-baseline.json
.agents/skills/ui-ux-pro-max/scripts/tests/fixtures/relevance-cases.json
.agents/skills/ui-ux-pro-max/scripts/tests/fixtures/relevance-thresholds.json
.agents/skills/ui-ux-pro-max/scripts/tests/test_catalog_refresh.py
.agents/skills/ui-ux-pro-max/scripts/tests/test_core_data_quality.py
.agents/skills/ui-ux-pro-max/scripts/tests/test_core.py
.agents/skills/ui-ux-pro-max/scripts/tests/test_data_contracts.py
.agents/skills/ui-ux-pro-max/scripts/tests/test_design_system_mode.py
.agents/skills/ui-ux-pro-max/scripts/tests/test_native_desktop_stack_freshness.py
.agents/skills/ui-ux-pro-max/scripts/tests/test_relevance_evaluator.py
.agents/skills/ui-ux-pro-max/scripts/tests/test_style_taxonomy.py
.agents/skills/ui-ux-pro-max/scripts/tests/test_text_layout_resilience.py
.agents/skills/ui-ux-pro-max/scripts/tests/test_web_stack_freshness.py
.agents/skills/ui-ux-pro-max/scripts/validate_data.py
.agents/skills/ui-ux-pro-max/SKILL.md
```

## Проверка обнаружения

- Основной файл навыка: `.agents/skills/ui-ux-pro-max/SKILL.md`.
- Frontmatter содержит `name: ui-ux-pro-max` и описание области применения.
- Локальный Python-поиск навыка выполнен успешно с кодом выхода `0`.
- Каталог `.agents/skills/` является репозиторным расположением навыков Codex.
- Свежая изолированная сессия `codex exec --ephemeral --sandbox read-only` вернула `DISCOVERED`.
