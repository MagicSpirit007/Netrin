# Netrin Appearance v3 Authoring Guide

This page is the contract reference. Follow the [Appearance v3 development tutorial](./APPEARANCE_DEVELOPMENT_TUTORIAL.en.md) for the complete empty-directory workflow. In the Codex project, invoke `$author-netrin-appearance` for the two-gate collaboration.

## 1. Quick start

Appearance packages style Netrin-owned UI without changing business logic, AMap base-map settings, or data.

```bash
npm run appearance:init -- my-skin ../my-skin
npm run appearance:dev -- ../my-skin
npm run appearance:check -- ../my-skin
npm run appearance:package -- ../my-skin ../my-skin.netrin-appearance
npm run appearance:review -- ../my-skin ../my-skin-review
```

Open `/appearance-studio?tab=workbench`. Live development reads only the selected source directory and keeps the candidate in memory: it does not install, write IndexedDB, or contact Supabase, AMap, or external networks.

## 2. Package structure

The deterministic ZIP allows only `appearance.manifest.json`, `tokens.json`, `theme.css`, and `assets/*`. Assets may be PNG, JPEG, WebP, or WOFF2 and must pass path, size, SHA-256, and magic-byte checks.

## 3. Appearance Manifest v3

The fixed boundary is `schemaVersion: 3`, `interfaceContractVersion: 2`, and `type: "skin"`. Identity, summary, SemVer, author, license, compatibility, token/theme entrypoints, and packager-generated file/asset hashes are required. v3 has no `screens` or `components` claims.

v1/v2 packages cannot be imported, activated, or submitted and are not migrated. Existing raw archives may only be exported or deleted.

## 4. Three-layer tokens

`primitive` contains literals. `semantic` references primitive values for surface, foreground, border, signal, map, font, radius, shadow, and motion. `component` references semantic values for button, icon-button, field, panel, card, navigation, sheet, dialog, toast, focus, and control.

The compiler rejects unresolved references, inverted layers, cycles, wrong types, low contrast, and a resolved `component.control.min-target` below 44px. Stable variables include `--surface-app`, `--foreground-default`, `--signal-success`, `--button-bg`, `--field-border`, `--focus-ring`, and `--control-min-target`.

## 5. CSS hooks, screens, states, and slots

CSS may consume contract variables or declare package-prefixed private variables. It may target stable screen/hook/state/slot/ARIA/native-control attributes.

The ten screen families are `map-navigation`, `route-catalog`, `route-detail`, `route-authoring`, `ai-route-authoring`, `profile-community`, `appearance-studio`, `phone-auth`, `legal-document`, and `admin-moderation`.

The 21 hooks are `app-shell`, `top-bar`, `bottom-navigation`, `button`, `icon-button`, `text-field`, `switch`, `route-card`, `route-point-card`, `media-gallery`, `map-frame`, `map-controls`, `recorder-panel`, `route-plan-confirmation`, `navigation-instruction`, `sheet`, `dialog`, `toast`, `loading-state`, `empty-state`, and `error-state`.

The home brand label formally exposes four stable slots: `brand-wordmark` (the complete label), `brand-title` (`NETRIN`), `brand-name` (the localized application name), and `brand-mark` (the accessible status mark). Target these slots instead of private application classes such as `.home__wordmark`.

A text wordmark may use stable variables, CSS, and package-ID-prefixed private variables to change color, background, border, font, spacing, shadow, and material. Do not rewrite `NETRIN`, the localized brand name, the accessible name, or the status meaning. If any of the four stable slots is missing, the author or AI must stop appearance-source editing and report `需要先扩展应用契约` (the application contract must be extended first); it must not edit business components or fall back to private classes.

```css
[data-appearance-slot="brand-wordmark"] {
  background: var(--surface-paper);
  border: 1px solid var(--signal-info);
  box-shadow: var(--shadow-hard);
}
[data-appearance-slot="brand-title"],
[data-appearance-slot="brand-name"] {
  color: var(--signal-info);
  font-family: var(--font-display);
}
[data-appearance-slot="brand-mark"] { background: var(--signal-success); }
```

A fully graphical Logo may use only a Manifest-declared package-local PNG, JPEG, or WebP through a safe `url("assets/logo.webp")` mapping. SVG, Data URLs, external URLs, scripts, and runtime downloads are forbidden. Preserve the existing brand text or an equivalent accessible name. Runtime creates Blob URLs only for audited bytes and revokes them when the appearance unmounts.

## 6. Resource and safety limits

Scripts, external resources, global selectors, hidden critical controls, fixed full-screen overlays, traversal paths, AMap selectors, and motion without a reduced-motion override are forbidden. Maintain 4.5:1 text contrast, visible focus, 44px targets, no horizontal overflow at 390×844, and visible AMap attribution.

Reference packaged assets with a relative path such as `background-image: url("assets/logo.webp")`. The packager must declare the path in the generated asset list. Audit rejects undeclared paths and external URLs; runtime maps only audited bytes to temporary Blob URLs and revokes them when the appearance unmounts.

## 7. Packaging, validation, and route review

`appearance:check` reports only checks it actually ran, using `passed`, `failed`, or `not-run`; `appearance:validate` is its v3 alias. `appearance:review` packages the source, runs typecheck, production build, and real browser routes, then writes 20 bilingual 390×844 screenshots and `<id>.netrin-review.json`.

## 8. skin, phenotype, submission and review

Uploads are declarative skins only. The bundled Field Guide remains a source-shipped phenotype. Submission requires the v3 package plus a review sidecar with the matching package SHA-256 and no failed/not-run checks. The author report is untrusted evidence; the service reruns machine audit before pending. Administrators download, hash, and rerun review before approval.

## 9. Contract downloads and AI delivery

- [Development tutorial](./APPEARANCE_DEVELOPMENT_TUTORIAL.en.md)
- [Interface Contract v2](../ui-contract/interface-contract.json)
- [Manifest Schema v3](../appearance/appearance.manifest.schema.json)
- [Token Schema v3](../appearance/appearance.tokens.schema.json)
- [External AI prompt](../appearance/EXTERNAL_AI_PROMPT.md)

Legacy v1/v2 examples and old review screenshots have been removed from the repository. Use `appearance:init` to create a fresh v3 source when an example is needed. Deliver a source directory, deterministic package, review report, and screenshots.
