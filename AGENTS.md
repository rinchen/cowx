# AGENTS.md — Colorado Weather (COWX)

Guide for AI agents and contributors working on **COWX** (COlorado + Weather), a Colorado-scoped static weather site deployed on GitHub Pages. Data is fetched on a schedule, written to `public/data/`, and consumed by a client-side HTML/CSS/JS frontend.

**Scope:** Colorado only. Do not add locations outside Colorado or expand coverage to other states.

---

## Repo map

```
cowx/   # repo directory (brand: COWX)
├── AGENTS.md                 # This file
├── README.md                 # Human quick start
├── package.json              # pnpm scripts (fetch, test, lint, validate:locations)
├── schemas/                  # JSON Schema for locations, payloads, meta, index (reference contracts)
├── scripts/
│   ├── fetch/
│   │   ├── index.js          # Fetch orchestrator — runs adapters, writes public/data/
│   │   └── adapters/         # One module per upstream source (add new adapters here)
│   ├── locations/
│   │   ├── colorado-locations.json   # Curated Colorado location catalog (source of truth)
│   │   └── co-zips.json              # ZIP → nearest catalog point (copied to public/data/)
│   ├── lib/                  # Shared utilities (http, geo, slugify, rf-comms, wmo, etc.)
│   └── validate-locations.js # Validates colorado-locations.json (unique slug, CO bbox)
├── public/                   # Static site root (GitHub Pages)
│   ├── index.html            # Geo-first app shell
│   ├── how-it-works.html     # Architecture & privacy (user-facing)
│   ├── credits.html          # Data provider attribution
│   ├── css/app.css           # Shared styles
│   ├── js/                   # Client modules (workspace, intel, hyperlocal, geocode, geo, …)
│   └── data/                 # Generated JSON — committed after fetch runs
│       ├── index.json        # Slim location index for search/geo
│       ├── meta.json         # Build time + per-source status + apiCalls
│       ├── co-zips.json      # ZIP lookup table
│       ├── alerts.geojson    # NWS alert polygons
│       ├── cdot-cameras.geojson
│       ├── cdot-alerts.geojson
│       ├── cwop.geojson
│       ├── hms-smoke.geojson
│       ├── spc-firewx.geojson
│       ├── space-weather.json # NOAA SWPC planetary snapshot (ham / HF)
│       └── locations/{slug}.json   # Full per-location payload
├── tests/                    # Node test runner (`pnpm test`) — fixtures only, no live APIs
│   └── fixtures/             # Recorded API responses for adapter/unit tests
└── .github/workflows/
    ├── pr.yml                # Lint, test, validate locations on pull requests
    ├── pages.yml             # Deploy public/ to GitHub Pages on push to main
    └── update-weather.yml    # Scheduled fetch every 45 minutes + failure notify
```

### Key artifacts

| Path                                        | Purpose                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `scripts/locations/colorado-locations.json` | Input catalog for fetch; validated by `pnpm validate:locations`          |
| `public/data/meta.json`                     | `generatedAt`, `version`, `sources[]`, `apiCalls`, `forecastStaleCount`  |
| `public/data/index.json`                    | Client lookup: slug, name, lat, lon, summary fields                      |
| `public/data/locations/{slug}.json`         | Full drill-down weather/AQ payload for one location                      |
| `public/data/space-weather.json`            | Statewide NOAA SWPC snapshot (Kp, SFI, R/S/G, HF estimates)              |
| `schemas/*.schema.json`                     | Reference contracts for locations/payloads/meta (not yet enforced in CI) |

**Language:** The public UI is English-only. There is no i18n catalog or translation check script.

---

## Adding a location

Edit `scripts/locations/colorado-locations.json` (JSON array). Each entry must include:

| Field          | Type   | Notes                                                                 |
| -------------- | ------ | --------------------------------------------------------------------- |
| `slug`         | string | Lowercase kebab-case, unique, URL-safe (`^[a-z0-9]+(?:-[a-z0-9]+)*$`) |
| `name`         | string | Display name                                                          |
| `lat`          | number | WGS84 latitude (must fall in Colorado bounds)                         |
| `lon`          | number | WGS84 longitude (must fall in Colorado bounds)                        |
| `region`       | string | Display region (e.g. Front Range)                                     |
| `county`       | string | County name                                                           |
| `wfo`          | string | NWS office (`BOU`, `PUB`, `GJT`)                                      |
| `elevation_ft` | number | Elevation in feet                                                     |

Optional fields used by adapters (add when known):

- `icao` — nearest airport for aviation METAR/TAF
- `coagmet_id` — CoAgMET station crosswalk
- `pws_id` — Weather Underground station id (**offsite dashboard link only** — not live-fetched)
- `webcam_links` — array of `{ name, url, kind? }` for municipal/ski/NWS camera portals that must **not** be embedded; UI opens them in a new tab (`https://` only). Prefer official city/county/DOT/NWS pages.

PurpleAir and AirNow resolve by nearest sensor/grid point (no per-location sensor ids in the catalog).

**Webcam link example:**

```json
"webcam_links": [
  {
    "name": "Longmont street snow cams",
    "url": "https://longmontcolorado.gov/transportation/snow-ice-control/street-snow-cams/",
    "kind": "city"
  }
]
```

**Steps:**

1. Add the object to the array (Colorado locations only).
2. Ensure `slug` is unique across the file.
3. Run `pnpm validate:locations`.
4. Run `pnpm fetch:data` (or wait for the scheduled Action) so `public/data/` includes the new site.
5. For ZIP search, update `scripts/locations/co-zips.json` (copied to `public/data/co-zips.json` on fetch).

Use `scripts/lib/slugify.js` to derive slugs from names when needed.

---

## Adding a fetch adapter

Adapters live in `scripts/fetch/adapters/`. Each adapter is an ES module exporting a named `fetch*` function consumed by `scripts/fetch/index.js`. Merge into per-location payloads happens **inline in the orchestrator** (there is no per-adapter `merge` export).

### Adapter pattern

```js
/**
 * @param {import('../lib/types.js').Location[]} locations
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{
 *   status: 'ok'|'partial'|'error'|'skipped',
 *   bySlug: Map<string, unknown>,
 *   calls?: number,
 *   error?: string,
 * }>}
 */
export async function fetchExample(locations, env = process.env) {
  // Call upstream API with timeouts via scripts/lib/http.js
  // Prefer returning status + error over throwing (orchestrator also wraps each adapter in try/catch)
}
```

**Orchestrator responsibilities** (`scripts/fetch/index.js`):

1. Load `colorado-locations.json`.
2. Run each adapter via `runAdapterSafely` (unexpected throws become `status: 'error'`); collect per-source status for `meta.json`.
3. Merge adapter `bySlug` maps into per-slug payloads (inline).
4. Write `public/data/index.json`, `locations/{slug}.json`, `meta.json`, `alerts.geojson`, `cdot-cameras.geojson`, `cwop.geojson`, `hms-smoke.geojson`, `spc-firewx.geojson`, and copy `co-zips.json`.
5. Schemas under `schemas/` are reference contracts — CI currently runs lint/test/`validate:locations` only.

**Resilience rules:**

- Wrap each adapter in try/catch; one failure must not abort unrelated sources.
- If a secret is missing, return `{ status: 'skipped' }` — do not fail the whole job.
- Use timeouts on all network I/O (`scripts/lib/http.js`).
- Set `User-Agent` on NWS (`api.weather.gov`) requests per their policy.
- Record errors in `meta.sources[].error` with secrets redacted (`sanitizeErrorMessage` / `sanitizeUrlForError`).

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
| `SYNOPTIC_API_TOKEN` | Optional Synoptic/MesoWest denser PWS/mesonet (skip if unset)         |
| `NOTIFY_WEBHOOK_URL` | Discord (or compatible) webhook URL for fetch/workflow failure alerts |

**Never** commit secret values to git, docs, issues, logs, or test fixtures. Reference secret **names** only.

---

## Fetch cadence & API budget

- **Schedule:** GitHub Actions runs `pnpm fetch:data` **every 45 minutes** (`*/45 * * * *`) plus manual `workflow_dispatch` (`.github/workflows/update-weather.yml`).
- **Runs per day:** ~32 scheduled fetches.
- **Design goal:** Stay within free-tier limits; do not poll faster than 45 minutes.

Approximate call budget per run (scales with catalog size; actual counts are written to `meta.json` as `apiCalls`):

| Source                       | Calls / run (approx @ ~340 locs)       | Auth                 |
| ---------------------------- | -------------------------------------- | -------------------- |
| Open-Meteo Forecast          | ~34+ (chunk 20 + NBM per chunk)        | None                 |
| Open-Meteo Air Quality       | ~9 (chunk 40)                          | None                 |
| NWS alerts + AFD/HWO         | ~8–12 selective                        | User-Agent header    |
| CoAgMET                      | 1–2                                    | None                 |
| Aviation Weather METAR/TAF   | 1–3 batched                            | None                 |
| USGS NWIS                    | 1                                      | None                 |
| SNOTEL                       | 1–2                                    | None                 |
| CDOT cameras + RWIS + alerts | 4                                      | None                 |
| CWOP / APRS (aprs.me grid)   | ~35–40                                 | None                 |
| Synoptic latest              | 0–1 (only if token set)                | `SYNOPTIC_API_TOKEN` |
| NOAA HMS smoke               | 1–3 (zip download)                     | None                 |
| SPC fire weather (Day 1–2)   | 4 (Wind/RH + DryT GeoJSON)             | None                 |
| NIFC WFIGS nearby fires      | 1 (CO incidents)                       | None                 |
| COEM burn restrictions       | 1 (HTML status + curated links)        | None                 |
| NOAA SWPC space weather      | ~5 (scales, Kp, Boulder K, SFI, X-ray) | None                 |
| PurpleAir                    | 1–2 (only if key set)                  | `PURPLEAIR_API_KEY`  |
| AirNow                       | many grid points when keyed            | `AIRNOW_API_KEY`     |
| Catalog `webcam_links`       | 0 (copied into payloads)               | None                 |

Partial adapter failure is acceptable; total failure (zero locations written or all critical adapters down) should fail the workflow so notifications fire.

---

## Audience data coverage (not UI filters)

Citizen, pilot, farmer, firefighter, and ham radio operator needs define **what fields the fetch pipeline must collect** (forecast depth, METAR/TAF, CoAgMET, AQI/smoke cues, road alerts, NOAA SWPC space weather / HF cues, etc.). The public dashboard shows **all** available sections for every location — there is no persona filter bar.

Locality pages are dual-pane **workspace** views: glass intel column (bottom-line headline, optional pin “At your location” current strip, 24h meteograms, CDOT cameras/RWIS/road alerts, local webcam **new-tab links**, nearby PWS, fire weather (SPC outlooks, HMS smoke, nearby NIFC incidents, burn-restriction links), ham radio / RF (SWPC scales, SFI/Kp, HF band estimates, VHF ducting)) beside an animated RainViewer radar map, with expandable 48h hourly metrics, full 10-day daily tables, alert text + `alerts.geojson` polygons, NOAA/NWS and CSU CIRA imagery click-throughs, and in-section source links. Planetary space weather is written once to `public/data/space-weather.json` (not duplicated per location).

**Hyperlocal pin (client, no API keys):** Locate (high-accuracy GPS), IP “Go to”, or Colorado street-address Set pin (`public/js/geocode.js` → Nominatim, CO-bounded, submit-only) stores a session-only pin (`sessionStorage` `cowx:hyperlocalPin`). Always force-refresh the workspace after setting a pin even if the catalog slug is unchanged. The workspace still loads the nearest catalog `locations/{slug}.json` for full forecast tables. With a pin, `public/js/hyperlocal.js` re-ranks statewide `cdot-cameras.geojson`, `cdot-alerts.geojson`, and `cwop.geojson` by haversine from the pin, and may fetch **one** keyless Open-Meteo `current=` response for the pin strip (fallback status if that fails). Searching a city clears the pin. Do not add client API **keys**; keep address geocode user-triggered and Colorado-bounded.

Scheduled data commits should **not** use `[skip ci]` — Pages must redeploy so the live site picks up fresh JSON. Code-only pushes still trigger Pages as usual.

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
- Client geo resolves to the **nearest catalog point in Colorado**; out-of-state visitors see nearest CO site plus search. Optional session pin refines cameras/PWS/alerts and pin-current without changing the catalog slug.
- Do not add national/global primary views or non-CO location catalogs.
- To fork this project for another state, follow [ADAPT.md](ADAPT.md).

---

## Failure notifications

When `update-weather.yml` fails, a notify job POSTs a summary to `NOTIFY_WEBHOOK_URL` (if set) and opens/updates a GitHub Issue. Never log or echo the webhook URL. See `how-it-works.html` for the user-facing explanation.

---

## Local commands

```bash
pnpm install
pnpm validate:locations
pnpm fetch:data     # writes public/data/ (requires network for live fetch)
pnpm test
pnpm lint
npx serve public    # local preview
```

Use Node **20+** (see `.nvmrc`).
