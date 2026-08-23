# Netrin Appearance Architecture

> **Current source of truth:** `ui-contract/interface-contract.json` is the
> style-neutral interface contract. It lists required elements, states, actions,
> accessibility and presentation boundaries without colors, fonts, shapes, or
> named visual styles. A creative brief is always supplied separately.
>
> Appearance delivery has two tiers: declarative `skin` packages may be validated
> and activated locally at runtime; source-level `phenotype` packages require
> TypeScript/build/screenshot review and ship with an application release. The
> existing Field Console described below is the bundled
> `field-guide-phenotype`, not a product-wide visual requirement.

Runtime skins use the breaking ZIP-based `.netrin-appearance` v3 format.
`docs/APPEARANCE_AUTHORING.md` defines the author interface; the machine schema is
`appearance/appearance.manifest.schema.json`, and three-layer token rules live in
`appearance/appearance.tokens.schema.json` plus `src/appearance/tokenContract.ts`. CSS is AST-parsed, scope-prefixed
to `.app-frame[data-appearance="<id>"]`, and previewed in Shadow DOM before
explicit activation. Only package-local PNG/JPEG/WebP/WOFF2 Blob URLs may be
used; provider canvas/attribution, global selectors, hidden required controls,
external requests, fixed overlays, excessive z-index and executable CSS are
rejected. v1/v2 packages are quarantined: they cannot be imported, activated, or
submitted, and their raw archives are only exportable or deletable.

> The historical Claude Design export is reference-only; this document,
> `ui-contract/`, `themes/field-guide-phenotype/`, and runtime code are the
> maintained sources. The design uses a dark "Field Console": near-black pixel canvas, hard
> pixel chrome, and an AMap JS API 2.0 online base with Netrin-owned route and
> navigation overlays. Runtime token
> source of truth: `src/styles.css` `:root`.
>
> **Appearance system status:** v3 author workflow is active development. This
> iteration covers source creation, live laboratory preview, static audit, real-route
> review, deterministic packaging, and reviewed submission. It does not add a mobile
> catalog, cross-device sync, auto-update, browser source editor, or new finished skins.

## Visual Direction

Netrin uses `field-guide-phenotype`: a mobile-first route authoring and guidance shell. Two
worlds, one system — the **app chrome** is a near-black pixel-dot console; the
**map** is the real AMap online base. Provider labels and road rendering remain
native; Netrin overlays and controls use crisp edges, restrained labels, and
hard pixel-offset shadows.

References:

- `examples/1.png` / `https://johnyvino.com/` — dark dot-grid field, restrained motion mood. → overall app aesthetic.
- `examples/Minna Bank iOS 71.png` — heavy headings, thin linework, black bottom navigation. → sheet density + bottom-nav pattern.

## Product Surface

- Primary frame: 390 x 844 mobile PWA.
- Bottom tabs (target labels): `地图` / `Map`, `发现` / `Discover`, `创作` / `Create`, `我的` / `Profile`.
- Home is the **map surface** (map-dominant, full-bleed), not a marketing page.
- Home preview keeps search, reset north, route overview, and recenter together in the top chrome; the duplicate map-internal compass is hidden on this screen. The four controls retain 44 px targets, with tighter six-pixel gaps and wordmark padding so the 390 px frame does not overflow.
- Product architecture is **nationwide and city-neutral**: no designated launch or sample city; the default map framing is a neutral national overview until the user grants location or chooses a city. This behavior is implemented in the current release.
- Settings lives inside `我的`; it is not a high-frequency bottom tab.
- Appearance authoring is the deliberate exception to the ordinary consumer shell: `/appearance-studio`
  has a public developer-guide tab plus a responsive same-site workbench. The workbench uses three
  columns only when all columns have safe shrink space, falls back to two columns at medium widths,
  and remains a fully accessible single column at 390×844. The fixed 390px Shadow DOM preview scrolls
  inside its own container instead of widening the page. It never replaces the mobile-first product surface.

### Additive repository surfaces

The repository and production runtime include these additive routes. The M2 route-planning Function and matching frontend release were activated on 2026-07-20:

- `/route/:routeId`: route line, walking/cycling mode, a four-tile distance/duration/highlights/share summary, ordered highlights, geometry/text offline save, and start-guide action. Social actions do not exist. Offline implementation diagnostics and all image-cache controls are absent.
- `/guide/:routeId`: immersive guide route using persisted WGS-84 geometry and hiding the bottom tab bar.
- `/create` keeps the three established manual choices and shows one manifest/runtime-capability-gated AI card when the Provider registry is reachable. An empty API base means same-origin `/v1/ai-route/*`, not feature disablement; registry loading and retryable unavailable states remain explicit and never block manual creation. `/create/ai` is a 390×844-first prompt/file selector → local text extraction/status → fixed-or-custom Provider setup → disambiguation → route-review flow. Production Provider 1.3 advertises prompt and TXT/MD/DOCX/text-PDF only; scanned PDFs are rejected and mixed PDFs show a warning. There is no URL, image, vision, OCR or aggregate-model-directory surface. Custom setup shows saved non-secret presets, normalized ASCII public HTTPS:443 host, model discovery/manual fallback, mandatory connection/tool probe and per-session host confirmation. Key controls expose clear-current/clear-all actions. Visible constraints include loop, must-include, avoid and preferences; start/end hints remain backward-compatible extraction fields but are not shown as separate ineffective controls. Controls remain at least 44 px, keyboard/focus state stays visible, and the map never replaces the ordered review list. `/create/:draftId` keeps the same `route-recorder` appearance contract for all authoring modes.
- `/discover` is the device-local route picker: it merges bundled, downloaded, and non-empty authored routes, then applies list/map modes and URL-backed filters. `/workshop` is an independent moderated cloud catalog with peer `Guide routes` and `Appearance sets` tabs. Guide routes owns route/nearby sub-controls, shares the same collapsible city/mode/distance/duration/difficulty filter as Discover, and opens route details for offline download. Appearance sets uses the approved catalog.
- `/creator/:publicId` and `/notifications` do not exist. `/legal` and `/legal/:type` render the same static service, privacy, and third-party notice so old deep links and the `legal-document` appearance family stay stable.

Interface Contract v2 maps real routes to ten screen families: map navigation, catalog,
detail, manual and AI authoring, profile/settings, Studio, phone auth, legal notice, and admin.
The map-navigation wordmark additionally exposes four stable appearance slots:
`brand-wordmark`, `brand-title`, `brand-name`, and `brand-mark`. They are an additive
v2 contract surface and do not increase the twenty-one component Hook count.

The create/discover/detail/guide/share surfaces are current production behavior. Creator profiles, notifications, and social write controls were permanently removed; the legal screen is a static notice. Appearance coverage follows the shared v2 contract constant rather than manifest-declared arrays.

## Tokens

- Canvas: near-black `--ink-900 #0b0c0e` under a faint white dot-grid.
- App "paper" surfaces remain dark panels (`--paper #101214`) with crisp light borders (`--line-ink #f4f5f2`).
- The app chrome stays restrained and mostly monochrome. The map-style selector exposes seven approved AMap JS API 2.0 styles in provider order: `normal`, `dark`, `light`, `fresh`, `grey`, `macaron`, and `darkblue`. User-facing labels are localized; removed persisted choices (`whitesmoke`, `graffiti`, `blue`, `wine`) normalize to the default `dark` style.
- Radius: 8px maximum for cards/panels/buttons; circular only for the location pulse and nav dot.
- Borders: crisp 2px white-ink (`--stroke-2`) on dark; 1px hairlines divide list rows.
- Shadows: hard pixel offsets (`4px 4px 0 #000`), no blur. Soft shadows only for sheets/popovers over the map.
- Backgrounds: repeating dot-grid textures, never gradients.

## Typography

- One Latin/number face: **Space Grotesk** (display, headings, body, labels). No pixel-art type.
- CJK: **LXGW WenKai (霞鹜文楷)** — a true 楷体, OFL, free for commercial use; falls back to system KaiTi.
- Mono micro-labels: UPPERCASE, tracked out (still Space Grotesk).
- Headings large but not viewport-scaled. No negative letter spacing.
- All user-facing copy routes through i18n; route and highlight content comes from data files or user content.

## Components

- Bottom tab: black bar, pixel SVG icons, white active dot.
- Route cards: repeated items show route-shell copy, ordered point count, available point media, and selected/downloaded state. Provider distance and duration are runtime or refreshable snapshots, never the sole source of truth for the authored geometry.
- Map: **AMap JS API 2.0**. Business data is WGS-84; the adapter converts to GCJ-02 for provider calls and converts provider routes back for in-memory display only. AMap failure leaves point content available and pauses navigation with retry; no straight line is presented as navigation. Appearance packages control Netrin overlays and chrome but cannot remove the provider surface or attribution.
- Record controls: thumb-reachable; the snap-to-roads toggle is a first-class `Switch`. On the small recorder map, compass and recenter are compact, grouped in the top-right corner, and use the dark pixel recenter-button style.
- Map planning and field recording are deliberately different acquisition surfaces inside the shared editor. Map planning is search-first: administrative-area results move the map without creating content; POIs are ranked with the current visible map bounds first and distance from the current map center second. A labeled AMap POI result or direct map tap becomes a temporary **square numbered stop marker**, and only the explicit `add as key point N` action appends it to the ordered draft. The search result name seeds `highlightTitle`; its address and provider identity remain transient. Field recording keeps the GPS, accuracy, optional snapping, and start/stop vocabulary and does not expose the place-search planner.
- The map-planning phone layout orders search, map, preview card, ordered start/via/destination list, travel mode, and geometry confirmation before shared route metadata. Search loading, empty, error/retry, keyboard listbox navigation, and 44 px targets are required; a search outage must not remove the direct map-tap fallback.
- Shared route metadata does not expose editable city/adcode fields. The first committed map, field, or imported point supplies city metadata through the POI result or reverse geocoding; later points do not overwrite it, and clearing every point clears it. The route-note textarea starts at 68 px at every supported width and may still be resized vertically.
- Unified editor: tentative provider/import geometry is visually and semantically separate from author-confirmed geometry. Changing mode, route, or planning anchors returns to an explicit confirmation state; title, description, media, tags, difficulty, loop and cover edits do not.
- Discovery: the list is the accessible alternative to map pins and never depends on the cloud service; exact filters operate on the device-local catalog. A route card's main surface opens its details, while the explicit trailing control independently selects the route or cancels the current selection. Discover and Workshop reuse one collapsible filter surface without a dedicated tag field. The independent workshop nests route/nearby beneath Guide routes and keeps Appearance sets as a peer catalog type. Nearby access is an explicit one-time location action, and city selection uses AMap city-name results while retaining adcodes only at the URL/storage or RPC boundary.
- Route detail: distance, duration, highlight count and share form one equal four-tile grid; share is the fourth tile to the right of highlights. Highlight descriptions use the normal secondary foreground token rather than low-contrast decorative ink. Offline save/refresh and start-guide actions remain, but package diagnostics and authorization/budget explanations do not render.
- Create entry, Workshop, and Profile use compact title-only top bars at their root level; explanatory copy belongs in the cards and controls below, not beside the primary page title.
- Service notice: `/legal` uses paper panels, plain language, and short readable sections. It never renders placeholder operator details, agreement checkboxes, or legal-review claims.
- Profile: a mobile account card plus focused entries for `语言`, `下载路线`, `离线数据`, `外观`, `我的投稿`, and `声明`; the administrator entry is rendered only for the server-granted role. The mobile `外观` view contains exactly two selectors in order: provider map style, then installed appearance set. Import, audit, preview, catalog, export, deletion, and submission live only in `/appearance-studio`.
- Statement: `声明` is a profile subview for project status, AMap/location and content sources, appearance authoring, privacy, and current service boundaries. It first presents these topics as a secondary menu; selecting one topic opens only that topic's detail, and Back returns to the statement menu before leaving the subview. The appearance-authoring detail links to the responsive Studio.
- Appearance Studio: `/appearance-studio` exposes URL-synced `workbench` / `guide` tabs. Both are fully accessible on mobile; the workbench progressively lays out as one, two, or three columns without page-level horizontal overflow. `appearance:dev` adds a development-only, memory-only Shadow DOM laboratory with ten screen families, twenty-one Hook fixtures, four independent brand-slot fixtures, Token/CSS/default-inheritance provenance, diagnostics, and source hash. Submission requires a verified phone account plus a matching all-passed review sidecar; `phenotype` remains source/build-reviewed.
- Auth: `/auth` is a narrow single-column mainland-China phone flow for sign-in, registration, six-digit OTP confirmation, password recovery, and legacy-anonymous upgrade. Public browsing stays ungated. Phone values are normalized to `+86` E.164 and masked when displayed. Editable fields render at 16 px or larger to prevent iOS focus zoom, and safe localized error classes preserve actionable Auth failure causes without exposing internal messages. Its appearance family is `phone-auth`.
- Admin: `/admin` remains mobile-first rather than a desktop sidebar. Five horizontally scrollable sections (`审核队列`, `全部路线`, `外观方案`, `账号管理`, `操作记录`) use the existing panel, field, badge, and button vocabulary. Full route editing exposes explicit WGS-84 fields and ordered media without altering the provider boundary.
- Pixel icons: inline SVG (`PixelIcon`), `currentColor`, `crispEdges`. The old "reuse only existing icons" rule is abolished: add new cell-local `PixelIcon` glyphs when a screen needs a clearer symbol. Keep them monochrome/pixel-aligned; do not substitute an external icon library or emoji.

## Photography and media

- **Allowed:** real user-generated route covers and highlight photos (JPEG pipeline, private storage, signed read URLs). UGC imagery is primary content, not decoration.
- **Forbidden:** decorative stock photography, marketing hero photos, and bokeh/orb lifestyle imagery used as chrome filler.
- Line-art, pixel glyphs, and dotted texture remain the default for non-UGC chrome.
- Offline route packages contain geometry and text only. Remote route photos remain online-only; there is no reader photo opt-in, media budget, LRU or authoring permission switch. Author-local draft photos may still render from their existing local Blob records and are not part of route-package downloading.

## Forbidden Patterns

- No desktop sidebar for the primary product shell.
- No forum tables, floor numbering, or admin density on consumer screens.
- No generic purple gradients, bokeh/orbs, or marketing hero layout.
- No social controls, community-release language, agreement consent, or “coming later” copy for the permanently removed R2 scope.
- No placeholder text on finished screens that implies retired quality telemetry or media-cache backends are live.
