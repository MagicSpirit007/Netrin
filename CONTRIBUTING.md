# Contributing to Netrin

Thank you for helping improve Netrin.

## Before contributing

1. Search existing issues and pull requests.
2. Open an issue before a large feature, schema change, or public contract
   change so scope and compatibility can be discussed.
3. Never include credentials, production infrastructure details, personal
   data, or material whose source and redistribution rights cannot be proven.

## License model

Netrin uses an inbound-equals-outbound model. By contributing, you agree that
your contribution is licensed under **AGPL-3.0-or-later**, the same terms used
for Netrin's original source code. OpenStreetMap-derived database material
remains under ODbL-1.0 and must retain its separate attribution and provenance.

Do not submit code, data, fonts, images, or other assets unless you have the
right to redistribute them and include their source and license information.

## Developer Certificate of Origin

Every commit must include a `Signed-off-by` trailer certifying the
[Developer Certificate of Origin 1.1](https://developercertificate.org/):

```text
Signed-off-by: Your Name <you@example.com>
```

Create it automatically with `git commit -s`. Pull requests containing an
unsigned commit will not be merged.

## Development workflow

Use Node.js 22.19.0 or newer and install from the lockfiles with `npm ci`.
Before submitting a pull request, run:

```text
npm run validate:cell
npm run licenses:check
npm run lint
npm run typecheck
npm test
npm run shell:check
npm run validate:appearance
npm run build
npm --prefix services/netrin-ai-orchestrator ci
npm --prefix services/netrin-ai-orchestrator run typecheck
npm --prefix services/netrin-ai-orchestrator test
```

User-facing strings must use the i18n resources. Geospatial business data must
remain WGS-84; provider coordinate conversion belongs only at provider
boundaries. New public data or assets must add provenance and license records.

## Pull requests

Keep changes focused, describe user-visible and security effects, list the
commands you ran, and call out any skipped gate. Update the relevant contract
or design documentation when behavior changes.
