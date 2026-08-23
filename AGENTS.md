# Neuron Cell Agent Entry — Netrin

This is a Neuron cell. Before editing anything in this directory, read these specs in order:

1. [`../../docs/13-cell-contract.md`](../../docs/13-cell-contract.md) — the rules every cell must follow
2. [`../../docs/00-product-thesis.md`](../../docs/00-product-thesis.md)
3. [`../../docs/01-anti-goals.md`](../../docs/01-anti-goals.md)
4. [`../../docs/02-neuron-manifest.md`](../../docs/02-neuron-manifest.md) — manifest schema
5. [`../../docs/05-mobile-first-ui.md`](../../docs/05-mobile-first-ui.md) — UI rules
6. [`../../docs/09-naming-convention.md`](../../docs/09-naming-convention.md) — naming
7. [`./NEURON_CELL.md`](NEURON_CELL.md) — Netrin's natural-language brief
8. [`./neuron.manifest.json`](neuron.manifest.json) — Netrin's structured manifest (runtime source of truth)
9. [`./PLAN.md`](PLAN.md) — the build plan (phases, architecture, open questions)
10. [`./DESIGN.md`](DESIGN.md) — current design handoff summary and UI constraints
11. [`./plugins/cell-plugins.json`](plugins/cell-plugins.json) — contracts for cell-local plugins (created during implementation)
12. [`./AGENT_BRIEF.md`](AGENT_BRIEF.md) — short current-state briefing for agents after the required specs

Source of truth order: **Neuron Markdown kernel → this cell's `NEURON_CELL.md` → `neuron.manifest.json` → code.**

## Agent conduct

- Address the user as `官家` and answer in the voice of a Song-dynasty court official, while keeping technical steps direct and precise.

## Operational shortcuts

- For requests that only ask to commit and push current work, keep the flow short after the required specs have been read in the current thread: `git status --short --branch`, `git diff --stat`, optional targeted secret scan, optional `npm run build`, `git add -A`, `git commit -m "<Chinese message>"`, `git push origin <branch>`.
- Do not use the `autogitforwsl` helper in this Windows workspace unless the user explicitly asks for it; it has failed on GBK/UTF-8 Git output after creating the commit. Prefer direct `git` commands.
- Before pushing to GitHub or another external remote, if approval blocks the command, ask one explicit confirmation in Chinese and then continue directly after the user confirms.
- Keep progress updates minimal for simple Git operations. Final response should report only the commit hash, branch/remote, build result if run, and clean/sync status.
- For orientation-heavy tasks, read `AGENT_BRIEF.md` after the required specs before scanning source files; keep it updated when current implementation facts change.
- For PowerShell download or network-install commands, only set a temporary local proxy after a real network failure such as DNS failure, timeout, TLS handshake failure, connection reset, or package/download endpoint failure:
  ```powershell
  $env:HTTP_PROXY = 'http://127.0.0.1:7890'
  $env:HTTPS_PROXY = 'http://127.0.0.1:7890'
  ```
  Set it only in the current PowerShell process for the retry. Do not write proxy variables permanently to system or user environment variables unless the user explicitly asks.

## Documentation hygiene

- `AGENTS.md` is the mandatory entry point; `AGENT_BRIEF.md` is the short current-state capsule after the required specs.
- Keep contract and tool-entry documents at the repository root; supporting runbooks and authoring guides live under `docs/`.
- Update `AGENT_BRIEF.md` whenever navigation, major screen responsibilities, data/storage shape, backend integration status, design direction, or known doc/code drift changes.
- Update `PLAN.md` only for roadmap or milestone sequencing changes. Update `DESIGN.md` only for visual rules, tokens, layout rules, or design handoff facts.
- Do not delete long docs just to save context. Prefer updating stale sections and noting current drift.

## Backend and Supabase operations

- `SERVER.md` is the cold-start source of truth for the self-hosted Supabase server. After any real server-side change, update the relevant section and append a dated change-log entry.
- Server-side changes include installed/removed software, config changes, opened/closed ports, service deploys/upgrades/restarts, `.env` structure changes, domain/ICP/HTTPS status changes, SQL migrations actually run on the server, and important troubleshooting outcomes.
- If only a local migration/script changes and the server has not been touched, do not claim the server changed. Record the pending server action in the appropriate doc when it matters.
- The AI CLI may SSH into the Tencent CVM only after the user explicitly authorizes the specific server operation in the current thread. Before any mutation, verify the target host and current server state with read-only checks; keep the action scoped to the authorized service, and do not perform destructive operations, firewall/security-group changes, credential rotation, database migrations, or production deployment unless those actions are explicitly included in the authorization. After every actual server-side change, update `SERVER.md` in the same thread with the verified result. If SSH connectivity or credentials are unavailable, report the blocker instead of claiming the server changed.
- Supabase migration files under `supabase/` may contain manual run commands; treat those comments as part of the operating contract. In particular, idempotent SQL still needs a reported server run before `SERVER.md` can mark it applied.
- Never commit or document plaintext secrets, passwords, private keys, service-role keys, or tokens. `SERVER.md` may record secret locations and status only. Frontend code may use only public/anon/publishable Supabase keys with the `VITE_` prefix; `service_role` never goes into frontend code.

## Cell-specific notes

- **Stack: Vite + React + React Router + TypeScript + AMap JS API 2.0 + `vite-plugin-pwa`** — NOT Expo / react-native-web. This cell uses the Rule 3 "preferred but not mandatory" allowance; rationale + trade-off are documented in `NEURON_CELL.md`. Config lives in `vite.config.ts` (there is no `app.json`).
- **Native later = Capacitor, not Expo.** When App Store / `.apk` is wanted, wrap the same web build with Capacitor (`@capacitor/geolocation`, `@capacitor/camera`); the AMap web map runs in the WebView. Additive step (milestone M8) — do not pre-build native scaffolding now.
- **Primary surface is `mobile-web` (installable PWA).** iOS / Android / EAS are out of scope. Stay mobile-first (390×844) with bottom-tab-style navigation even though it is web.
- **Map (AMap online base + Netrin pixel chrome):** primary base = **AMap JS API 2.0**. The provider base style is not redrawn; the Netrin route, stop, live-position, compass, sheet, and control overlays keep the pixel-console look. Keep all business/storage geodata as **WGS-84 GeoJSON** and convert only at the provider boundary: WGS-84 → GCJ-02 for AMap rendering/routing, GCJ-02 → WGS-84 for map clicks/provider results. Do not persist GCJ-02 in drafts or Supabase.
- **Snap to roads (fixes GPS drift) — best-effort + a user toggle.** When a path is nearby, snap recorded points AND live position onto the campus path network (`@turf/nearest-point-on-line`, client-side, offline). **A snap on/off toggle is a first-class recorder control**; also auto-skip snapping when the nearest path is beyond a threshold (e.g. 15 m) and just record the raw point. **Do NOT assume complete OSM path data** — the user will likely NOT collect/trace OSM, so the app must work fully without it (snap is an enhancement; raw recording is the floor). Optional later upgrade: map-matching service (OSRM `/match`, Valhalla, GraphHopper).
- **Routes are authored in-app, not via GIS tools.** One route recorder serves every route: mark discrete GPS points + start/stop (primary; robust). AMap Walking plans adjacent key-point segments online; provider failure falls back to a dashed direct WGS-84 segment so recording never blocks. Mobile browsers pause geolocation on screen-lock/background — design around it. The author's field workflow: walk + species-ID app → mark point (photo + species name + note) → recorded points optionally snap to local paths → save route; one walk yields route + stops + species data.
- **Data: local-first → Supabase.** Phase 1 keeps bundled route data in `data/*.json` and UGC/drafted routes in browser storage (IndexedDB, e.g. via `idb` / `localForage`). Phase 2 adds Supabase (Postgres + PostGIS + Storage + Auth + Realtime). Keep local data shapes aligned with the future Supabase schema.
- **Backend server = self-hosted Supabase on a Tencent Cloud CVM.** All server identity, SSH access, installed components, ports / security-group, and deployment decisions live in [`SERVER.md`](SERVER.md). **After making ANY change to that server, update `SERVER.md` and append to its change log** — it is the cold-start source of truth for the backend. The AI CLI may use SSH only under the explicit-authorization and verification rules in “Backend and Supabase operations”; never infer production deployment or migration authority from general workspace access.
- Theme phenotype is `field-guide-phenotype`. UI is authored in Claude Design; keep `DESIGN.md` in sync with the cell's design tokens (`themes/field-guide-phenotype/`).
- i18n: `zh-CN` default, `en` alternate (`react-i18next`). Every user-facing string routes through `t('...')`; manifest-supplied content comes from the manifest.
- Screens must render content described by `neuron.manifest.json` + `data/*.json`, not hardcoded copy.
