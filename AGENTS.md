# AGENTS.md — Colorado Weather (cowx)

Guide for AI agents and contributors working on **cowx**, a Colorado-scoped static weather site deployed on GitHub Pages. Data is fetched on a schedule, written to `public/data/`, and consumed by a client-side HTML/CSS/JS frontend.

**Scope:** Colorado only. Do not add locations outside Colorado or expand coverage to other states.

---

## Repo map

```
cowx/
├── AGENTS.md                 # This file
├── README.md                 # Human quick start
├── package.json              # pnpm scripts (fetch, test, lint, validate:locations)
├── schemas/                  # JSON Schema for locations, payloads, meta, index
├── scripts/
│   ├── fetch/
│   │   ├── index.js          # Fetch orchestrator — runs adapters, writes public/data/
│   │   └── adapters/         # One module per upstream source (add new adapters here)
│   ├── locations/
│   │   └── colorado-locations.json   # Curated Colorado location catalog (source of truth)
│   ├── lib/                  # Shared utilities (slugify, geo/haversine, etc.)
│   └── validate-locations.js # Validates colorado-locations.json structure
├── public/                   # Static site root (GitHub Pages)
│   ├── index.html            # Geo-first app shell
│   ├── how-it-works.html     # Architecture & privacy (user-facing)
│   ├── credits.html          # Data provider attribution
│   ├── css/app.css           # Shared styles (when present)
│   ├── js/                   # Client modules
│   └── data/                 # Generated JSON — committed after fetch runs
│       ├── index.json        # Slim location index for search/geo
│       ├── meta.json         # Build time + per-source status
│       ├── alerts.geojson    # NWS alert polygons (when implemented)
│       └── locations/{slug}.json   # Full per-location payload
├── tests/                    # Node test runner (`pnpm test`) — fixtures only, no live APIs
│   └── fixtures/             # Recorded API responses for adapter/unit tests
└── .github/workflows/
    ├── pr.yml                # Lint, test, validate locations on pull requests
    ├── pages.yml             # Deploy public/ to GitHub Pages on push to main
    └── update.yml            # Scheduled fetch every 45 minutes (when implemented)
```

### Key artifacts

| Path                                        | Purpose                                                                           |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| `scripts/locations/colorado-locations.json` | Input catalog for fetch; validated by `pnpm validate:locations`                   |
| `public/data/meta.json`                     | `generatedAt`, `version`, `sources[]` with `ok` / `partial` / `error` / `skipped` |
| `public/data/index.json`                    | Client lookup: slug, name, lat, lon, summary fields                               |
| `public/data/locations/{slug}.json`         | Full drill-down weather/AQ payload for one location                               |
| `schemas/*.schema.json`                     | Contract for locations, payloads, meta — validate outputs in CI                   |

---

## Adding a location

Edit `scripts/locations/colorado-locations.json` (JSON array). Each entry must include:

| Field  | Type   | Notes                                                                 |
| ------ | ------ | --------------------------------------------------------------------- |
| `id`   | string | Stable internal id (often same as slug)                               |
| `name` | string | Display name                                                          |
| `slug` | string | Lowercase kebab-case, unique, URL-safe (`^[a-z0-9]+(?:-[a-z0-9]+)*$`) |
| `lat`  | number | WGS84 latitude (-90 … 90)                                             |
| `lon`  | number | WGS84 longitude (-180 … 180)                                          |

Optional fields used by adapters (add when known):

- `elevationFt`, `county`, `region`
- `wfo` — NWS office (`BOU`, `PUB`, `GJT`)
- `icao` — nearest airport for aviation METAR/TAF
- `purpleAirId` — PurpleAir sensor id for inline PM readings
- `airNowSiteId` — AirNow monitoring site
- `coagmetId`, `pwsId` — ag / personal weather station crosswalks

**Steps:**

1. Add the object to the array (Colorado locations only).
2. Ensure `slug` is unique across the file.
3. Run `pnpm validate:locations`.
4. Run `pnpm fetch` (or wait for the scheduled Action) so `public/data/` includes the new site.
5. If the frontend uses ZIP search, update `public/data/co-zips.json` when that file exists.

Use `scripts/lib/slugify.js` to derive slugs from names when needed.

---

## Adding a fetch adapter

Adapters live in `scripts/fetch/adapters/`. Each adapter is an ES module that exports a small interface consumed by `scripts/fetch/index.js`.

### Adapter interface

```js
/** @typedef {{ locations: import('../../schemas/location.schema.json')[], env: NodeJS.ProcessEnv }} FetchContext */

export const name = 'openmeteo'; // stable source id → meta.json sources[].id

/**
 * Fetch raw data for all catalog locations (or a batch).
 * @param {FetchContext} ctx
 * @returns {Promise<{ status: 'ok'|'partial'|'error'|'skipped', records?: Record<string, unknown>, error?: string }>}
 */
export async function fetch(ctx) {
  // Call upstream API with timeouts; never throw uncaught — return status + error
}

/**
 * Merge this source's records into a per-location weather payload.
 * @param {Record<string, unknown>} locationPayload — mutable payload for one slug
 * @param {Record<string, unknown>} sourceRecords — output from fetch() for this slug
 */
export function merge(locationPayload, sourceRecords) {
  // Set fields + locationPayload.sources[name] = { status, updatedAt }
}
```

**Orchestrator responsibilities** (`scripts/fetch/index.js`):

1. Load `colorado-locations.json`.
2. Run each adapter; collect per-source status for `meta.json`.
3. Merge adapter output into per-slug payloads.
4. Write `public/data/index.json`, `public/data/locations/{slug}.json`, `public/data/meta.json`.
5. Validate against `schemas/` where validation is wired.

**Resilience rules:**

- Wrap each adapter in try/catch; one failure must not abort unrelated sources.
- If a secret is missing, return `{ status: 'skipped' }` — do not fail the whole job.
- Use timeouts on all network I/O.
- Set `User-Agent` on NWS (`api.weather.gov`) requests per their policy.
- Record errors in `meta.sources[].error` (no secrets in logs).

**Optional secrets** (read from `process.env` / GitHub Actions secrets — names only, never commit values):

| Env var             | Adapter                       |
| ------------------- | ----------------------------- |
| `PURPLEAIR_API_KEY` | PurpleAir inline sensor data  |
| `AIRNOW_API_KEY`    | EPA AirNow AQI / observations |

If unset, PurpleAir and AirNow adapters should skip gracefully and the UI falls back to offsite links.

---

## Secrets (names only)

Configure in **GitHub Actions → Secrets** (repository settings) or a local `.env` file (gitignored):

| Secret name          | Purpose                                                               |
| -------------------- | --------------------------------------------------------------------- |
| `PURPLEAIR_API_KEY`  | PurpleAir API access for build-time sensor snapshots                  |
| `AIRNOW_API_KEY`     | AirNow API access for official AQI near locations                     |
| `NOTIFY_WEBHOOK_URL` | Discord (or compatible) webhook URL for fetch/workflow failure alerts |

**Never** commit secret values to git, docs, issues, logs, or test fixtures. Reference secret **names** only.

---

## Fetch cadence & API budget

- **Schedule:** GitHub Actions runs `pnpm fetch` **every 45 minutes** (`*/45 * * * *`) plus manual `workflow_dispatch`.
- **Runs per day:** ~32 scheduled fetches.
- **Design goal:** Stay within free-tier limits; do not poll faster than 45 minutes.

Approximate call budget per run (target — record counts in `meta.json` when implemented):

| Source                     | Calls / run (target)       | Auth                |
| -------------------------- | -------------------------- | ------------------- |
| Open-Meteo Forecast        | 4–8 (chunk ≤100 locations) | None                |
| Open-Meteo Air Quality     | 1–2 batched                | None                |
| NWS alerts + AFD + grid    | ~8–12 selective            | User-Agent header   |
| CoAgMET `latest.json`      | 1                          | None                |
| Aviation Weather METAR/TAF | 1–3 batched                | None                |
| PurpleAir                  | 1–2 (only if key set)      | `PURPLEAIR_API_KEY` |
| AirNow                     | 1–2 (only if key set)      | `AIRNOW_API_KEY`    |

Partial adapter failure is acceptable; total failure (zero locations written or all critical adapters down) should fail the workflow so notifications fire.

---

## Audience data coverage (not UI filters)

Citizen, pilot, farmer, and firefighter needs define **what fields the fetch pipeline must collect** (forecast depth, METAR/TAF, CoAgMET, AQI/smoke cues, etc.). The public dashboard shows **all** available sections for every location — there is no persona filter bar.

Data commits may use `[skip ci]` when only JSON snapshots change, to avoid redundant Pages deploys — follow workflow conventions in `.github/workflows/`.

---

## Accessibility (WCAG 2.2 AA)

All UI changes in `public/` must meet **WCAG 2.2 Level AA**:

- **Perceivable:** Text contrast ≥ 4.5:1 (3:1 for large text); do not rely on color alone for alert severity.
- **Operable:** Full keyboard access; visible focus indicators; skip link to main content; respect `prefers-reduced-motion`.
- **Understandable:** Labels on form controls; clear error/empty states; consistent navigation.
- **Robust:** Semantic HTML; ARIA only when native elements are insufficient; live regions for dynamic weather updates where appropriate.

Before merging frontend work: run axe/pa11y smoke tests when wired in CI; manually tab through geo resolve, search, favorites, and location dashboard.

Map layers must have a non-map alternative (list/table) for keyboard and screen-reader users.

---

## Testing

- Run `pnpm test` — Node built-in test runner.
- **Do not hit live APIs in unit tests.** Use fixtures under `tests/fixtures/` and mock `fetch` / adapter inputs.
- Adapter tests should assert merge behavior, error handling, and schema-shaped output.
- `pnpm validate:locations` must pass before merging location catalog changes.

---

## Conventional commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix      | Use                          |
| ----------- | ---------------------------- |
| `feat:`     | New feature                  |
| `fix:`      | Bug fix                      |
| `docs:`     | Documentation only           |
| `chore:`    | Maintenance, deps, config    |
| `refactor:` | Code change without fix/feat |
| `test:`     | Tests only                   |

Include a detailed body for non-trivial changes: **what** changed and **why**. For `feat:` / `fix:` tied to a GitHub issue, add `Fixes #NNN` in the footer.

---

## Colorado-only scope

- Locations must be in Colorado (including passes, peaks, parks, and CDOT-relevant sites).
- Client geo resolves to the **nearest catalog point in Colorado**; out-of-state visitors see nearest CO site plus search.
- Do not add national/global primary views or non-CO location catalogs.

---

## Failure notifications

When the update workflow fails, a separate notify job (when implemented) POSTs a summary to the webhook named `NOTIFY_WEBHOOK_URL` and opens/updates a GitHub Issue. Never log or echo the webhook URL. See `how-it-works.html` for the user-facing explanation.

---

## Local commands

```bash
pnpm install
pnpm validate:locations
pnpm fetch          # writes public/data/ (requires network for live fetch)
pnpm test
pnpm lint
npx serve public    # local preview
```

Use Node **20+** (see `.nvmrc`).
