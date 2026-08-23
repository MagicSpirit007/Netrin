# Netrin

**English** | [简体中文](README.zh-CN.md)

Netrin is a mobile-first, installable web app for authoring, reviewing,
sharing, downloading, and guiding walking, CityWalk, and recreational cycling
routes. Route geometry is stored as WGS-84 GeoJSON and converted only at map
provider boundaries.

The current release is a Vite + React + TypeScript PWA with AMap JS API 2.0,
local-first route drafts, an optional Supabase backend, and an optional
route-intent AI service.

Live demo: [utopians.cloud/netrin](https://utopians.cloud/netrin/)

## What is included

- Map planning, field recording, and GPX/GeoJSON import.
- Optional best-effort snap-to-path using bundled OpenStreetMap-derived data.
- Route moderation, offline saves, and guidance flows.
- Self-hosted Supabase SQL and Edge Function sources.
- A separately deployable Node.js AI route orchestrator.
- Chinese (`zh-CN`) and English UI resources.

Netrin is not official navigation, a safety service, or an emergency service.

## Requirements

- Node.js 22.19.0 or newer
- npm (the version bundled with Node.js is sufficient)
- An AMap JS API web key for online map features
- Optional: a Supabase project for account, storage, moderation, and cloud data

The packages remain `private: true`; this repository is not an npm package.

## Quick start

```powershell
npm ci
Copy-Item .env.local.example .env.local
npm run dev
```

Edit `.env.local` with your own public browser credentials. Never place a
Supabase `service_role` key, database password, model API key, private key, or
server credential in a `VITE_` variable or commit it to the repository.

The local development wrapper provides a deterministic mock for the AI route
service. To run the real service separately:

```powershell
npm --prefix services/netrin-ai-orchestrator ci
Copy-Item services/netrin-ai-orchestrator/.env.example services/netrin-ai-orchestrator/.env
npm --prefix services/netrin-ai-orchestrator run start
```

## Configuration

| Variable | Scope | Purpose |
| --- | --- | --- |
| `VITE_AMAP_KEY` | browser | AMap JS API 2.0 web key |
| `VITE_AMAP_SERVICE_HOST` | browser | Optional same-origin AMap security proxy |
| `VITE_SUPABASE_URL` | browser | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | browser | Public anon/publishable key only |
| `VITE_AI_ROUTE_API_BASE` | browser | Optional public AI service base; blank means same origin |

See `.env.local.example` and
`services/netrin-ai-orchestrator/.env.example` for the complete templates.

## Verification

```powershell
npm run validate:cell
npm run licenses:check
npm run lint
npm run typecheck
npm test
npm run shell:check
npm run validate:appearance
npm run build

npm --prefix services/netrin-ai-orchestrator run typecheck
npm --prefix services/netrin-ai-orchestrator test
```

Dependency vulnerability gates use the public npm registry:

```powershell
npm audit --audit-level=moderate --registry=https://registry.npmjs.org/
npm --prefix services/netrin-ai-orchestrator audit --audit-level=moderate --registry=https://registry.npmjs.org/
```

## Architecture and deployment

- `src/`: PWA UI, local-first data flows, map/provider adapters.
- `public/data/`: bundled public data and its provenance metadata.
- `supabase/`: reusable schema/migration sources and Edge Functions.
- `services/netrin-ai-orchestrator/`: isolated route-intent service.
- `themes/`: appearance definitions and validation fixtures.
- `docs/`: reusable product and deployment guidance.

Production hosts, credentials, DNS, database state, and private operational
history are deliberately outside this repository. Deployment files are
templates: review and parameterize them for your own environment before use.
No production mutation is performed by the build or test commands above.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. All
commits must carry a DCO `Signed-off-by` line. Please report vulnerabilities
privately as described in [SECURITY.md](SECURITY.md), not in a public issue.

## Licenses and attribution

- Netrin's original source code: **AGPL-3.0-or-later**. See [LICENSE](LICENSE).
- `public/data/campus-paths.json`: **ODbL-1.0**, © OpenStreetMap contributors.
  See [LICENSES/ODbL-1.0.md](LICENSES/ODbL-1.0.md) and
  [public/data/README.md](public/data/README.md).
- Third-party packages: their respective licenses. See
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Commercial use is permitted by AGPL-3.0-or-later, subject to its conditions,
including the network-source obligations that may apply when a modified
version is offered to users over a network.
