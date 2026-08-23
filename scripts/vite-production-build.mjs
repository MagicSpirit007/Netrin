import { build } from 'vite'

// A production build is same-origin by default, even when a developer has a
// stale ignored VITE_AI_ROUTE_API_BASE in .env.local. Explicit process-level
// overrides remain available to owned review tooling and cross-origin tests.
if (!Object.hasOwn(process.env, 'VITE_AI_ROUTE_API_BASE')) {
  process.env.VITE_AI_ROUTE_API_BASE = ''
}

await build()
