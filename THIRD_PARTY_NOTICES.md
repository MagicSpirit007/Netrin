# Third-party notices

Netrin includes or depends on third-party software. Those components remain
under their own licenses; the project's AGPL-3.0-or-later license does not
replace those terms.

The authoritative package inventory, exact versions, integrity hashes, and
declared SPDX expressions are recorded in:

- `package-lock.json` for the web application and development tools;
- `services/netrin-ai-orchestrator/package-lock.json` for the AI service.

Run `npm run licenses:check` after every dependency change. The checker covers
both lockfiles, fails on missing or previously unreviewed license expressions,
and requires this notice to remain present.

## Reviewed license families

The current lockfiles contain dependencies offered under these reviewed
expressions: 0BSD, Apache-2.0, BSD, BSD-2-Clause, BSD-3-Clause,
BlueOak-1.0.0, CC-BY-4.0, ISC, MIT, (MIT AND Zlib), MIT OR Apache-2.0,
(MIT OR CC0-1.0), MPL-2.0, and Unlicense.

`jszip` 3.10.1 is offered under `(MIT OR GPL-3.0-or-later)`. Netrin elects
the MIT branch for distribution.

License texts and notices shipped by each npm package are available in the
installed package directory after `npm ci`. When redistributing a compiled
bundle, preserve notices required by the applicable package licenses.

## OpenStreetMap data

`public/data/campus-paths.json` is derived from OpenStreetMap data:

- © OpenStreetMap contributors
- Open Data Commons Open Database License 1.0 (ODbL-1.0)
- https://www.openstreetmap.org/copyright
- https://opendatacommons.org/licenses/odbl/1-0/

This dataset is licensed separately from Netrin source code. See
`LICENSES/ODbL-1.0.md` and `public/data/README.md`.

## Future assets and data

No project-owned binary image, font, audio, video, archive, or document asset
is part of the current tracked release snapshot, and bundled natural-route
content is empty. Any future code, data, or media contribution must include a
verifiable source and redistribution license before it is accepted.
