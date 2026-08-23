---
name: author-netrin-appearance
description: Create, edit, validate, package, and review Netrin v3 appearance skins through a two-checkpoint human-AI workflow with separate explicit approvals. Use when users ask to design or revise a Netrin appearance, skin, theme, 外观组, tokens.json, or theme.css. Stop before submission, moderation, Function deployment, or server changes.
---

# Author a Netrin Appearance

Turn a visual direction into an audited Netrin v3 source directory and a review-ready delivery. Keep the package declarative and stop for human approval twice: before the first write and before packaging.

## Establish the workspace

1. Work from the Netrin cell repository root. Verify that `package.json` exposes `appearance:init`, `appearance:dev`, `appearance:check`, `appearance:package`, and `appearance:review`.
2. Read `../../../AGENTS.md` and every required entry document it names before editing.
3. Read these canonical appearance sources completely:
   - `../../../docs/APPEARANCE_DEVELOPMENT_TUTORIAL.md`
   - `../../../docs/APPEARANCE_AUTHORING.md`
   - `../../../appearance/appearance.manifest.schema.json`
   - `../../../appearance/appearance.tokens.schema.json`
   - `../../../ui-contract/interface-contract.json`
4. Default the source directory to `appearance-work/<id>` and the artifact directory to `appearance-output/<id>`. Respect an explicit user path instead.
5. Require the ID to match `^[a-z0-9]+(?:-[a-z0-9]+)*$`. Derive a proposed ID from the requested name when possible.

## Gate 1: confirm the visual brief

Extract or request only the missing high-impact decisions:

- package name and lowercase ID;
- author, license, summary, and version;
- mood, palette, typography, density, material, and motion;
- reference images or optional asset needs;
- source and artifact paths when overriding the defaults.

Present a concise brief containing those decisions and the safety boundary. Ask the user to confirm it. Do not create, edit, package, or install anything before confirmation.

Gate 1 is a hard turn boundary for both new and existing appearances, including one-line repairs. The original task never counts as Gate 1 approval, even when it says to proceed automatically or contains every required decision. End the turn after presenting the brief. Continue only after the user sends a separate later message that explicitly confirms the presented brief. Before that message, only read files and run non-mutating static checks; do not start the development service or any other long-running process.

## Create or open the source

After Gate 1 approval:

1. If the source directory does not exist or is empty, run:

   ```powershell
   npm run appearance:init -- <id> appearance-work/<id>
   ```

2. If it contains a schema v3 manifest with the same ID, treat the task as an edit and do not run init.
3. If it is non-empty but is not that appearance source, stop and request another directory. Never overwrite it.
4. Start `npm run appearance:dev -- <source-directory>` with the environment's long-running-process mechanism. Surface the local URL and keep the process available for preview until delivery.

## Author and iterate

Modify only `appearance.manifest.json`, `tokens.json`, `theme.css`, and optional `assets/*` inside the selected source directory. Leave the generated `README.md` alone unless the user asks to update it.

Apply these rules:

- Keep Manifest schema 3, Interface Contract 2, and type `skin`; never add coverage claims.
- Keep primitive values literal, semantic values referencing primitive, and component values referencing semantic.
- Preserve 4.5:1 text contrast, visible focus, reduced-motion behavior, 44px targets, 390×844 fit, and visible AMap attribution.
- Consume stable CSS variables or declare only package-ID-prefixed private variables. Use stable screen, hook, state, slot, ARIA, and native-control selectors.
- Never add JavaScript, HTML, SVG, external or data URLs, global selectors, hidden critical controls, fixed full-screen overlays, AMap-provider selectors, or unprotected motion.
- Default to tokens and CSS. Add PNG, JPEG, WebP, or WOFF2 only when the user explicitly requests an asset or the confirmed brief requires it. Invoke an available image-generation capability only for an explicitly requested generated bitmap. Require license confirmation for a user-provided WOFF2 font. Never download a font or image from an external URL.
- Do not edit Netrin application code, appearance contracts, historical examples, submission code, server files, or production configuration.

### Brand label and Logo slots

Before changing the brand label or Logo, verify that all four stable entries exist in `appearance/contract.ts`, `ui-contract/interface-contract.json`, the real home DOM, and the workbench fixture:

- `brand-wordmark` — the complete localized brand-label container;
- `brand-title` — the stable `NETRIN` title;
- `brand-name` — the localized application name;
- `brand-mark` — the accessible status seal or brand mark.

When those entries exist, do not create replacements or raise the Manifest schema or Interface Contract version. Use their stable `data-appearance-slot` selectors. A text wordmark may use CSS, stable variables, and package-private variables to change color, background, border, font, spacing, shadow, and material. For example, a request for a xuan-paper ground, mineral-blue type, mineral-green seal, and Song-style title must be implemented through these four slots; never claim that the Logo cannot be changed merely because private application classes are unavailable.

Do not target `.home__wordmark`, `.home__brand-name`, or any other application-private class. Preserve the literal brand text, localization semantics, accessible name, and the live/status meaning of `brand-mark`. Do not edit React, business components, application CSS, or contracts to bypass the appearance boundary.

If any required stable slot is absent, stop editing the appearance source and report exactly: `需要先扩展应用契约` (the application contract must be extended first). Do not fall back to a private selector.

For a fully graphical Logo, require a user-provided or explicitly approved package-local PNG, JPEG, or WebP asset. It must live under `assets/`, be declared by the generated Manifest file list, and be referenced only through a safe `url("assets/...")` mapping. SVG, Data URLs, external URLs, scripts, and runtime downloads are forbidden. Keep the existing accessible brand text or an equivalent application-provided accessible name; CSS must not erase the brand semantics. The runtime must map only audited bytes to Blob URLs and revoke them when the appearance unmounts. If no compliant bitmap is available, request one rather than substituting an external or invented runtime resource.

After each substantial change, run:

```powershell
npm run appearance:check -- <source-directory> --json
```

Use `file`, `line`, `column`, `selector`, and `tokenPath` diagnostics to make targeted fixes. Continue until the static audit passes. Do not describe `not-run` as passed.

Review all ten screen families, all 21 hooks, their state matrix, and the token/CSS/inherited coverage source. When browser control is available, inspect `/appearance-studio?tab=workbench` directly. Otherwise give the user the URL and state exactly which visual checks require their observation.

## Gate 2: confirm the preview

When static audit passes and the preview matrix has been reviewed, summarize:

- source hash and audit status;
- the visual decisions implemented;
- inherited areas that remain intentional;
- any limitations or items the human must inspect.

Ask the user to approve packaging. Do not run `appearance:package` or `appearance:review` before approval.

Gate 2 is also a hard turn boundary. A request made before the preview summary never counts as approval. End the turn after presenting the summary, and continue only after a separate later user message explicitly approves packaging and review.

## Package and review

Before any release handoff, run `npm run validate:appearance`. Submission always re-exports the currently selected package and compares its live SHA-256, ID, version and Interface Contract with the report. Administrator approval is Function-only and repeats the private-package machine audit; never invoke the database review RPC from a browser or CLI using an authenticated user token.

After Gate 2 approval, use one artifact directory for both commands:

```powershell
npm run appearance:package -- <source-directory> appearance-output/<id>/<id>.netrin-appearance
npm run appearance:review -- <source-directory> appearance-output/<id>
npm run appearance:check -- appearance-output/<id>/<id>.netrin-appearance --json
```

Require all eight review checks to be `passed`, exactly 20 bilingual 390×844 screenshots, and matching package SHA-256 values in the final package audit and `.netrin-review.json`. Treat `failed`, `not-run`, missing evidence, or a hash mismatch as incomplete; fix an appearance-source cause and rerun. Do not repair unrelated application failures without separate authorization.

Inspect the generated screenshots for obvious visual regressions when local image inspection is available. Stop the development process after the final verification.

## Deliver and stop

Report clickable paths to the source directory, `.netrin-appearance`, `.netrin-review.json`, and screenshot directory. Summarize the eight review statuses and SHA-256 match.

Stop before submission, replacement, moderation, approval, Function deployment, SSH, migration, server mutation, Git commit, or push. If the user asks for one of those actions, explain that it requires a separate request and the applicable authorization.
