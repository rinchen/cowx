# AGENTS.md — Colorado Weather (COWX)

Guide for AI agents and contributors working on **COWX** (COlorado + Weather), a Colorado-scoped static weather site deployed on GitHub Pages. Data is fetched on a schedule, written to `public/data/`, and consumed by a client-side HTML/CSS/JS frontend.

**Scope:** Colorado only. Do not add locations outside Colorado or expand coverage to other states.

---

## Repo map

```
cowx/   # repo directory (brand: COWX)
├── AGENTS.md                 # This file
├── README.md                 # Human quick start
├── package.json              # pnpm scripts (fetch:data, test, lint, validate:locations, update)
├── schemas/                  # JSON Schema for locations, payloads, meta, index (reference contracts)
├── scripts/
│   ├── fetch/
│   │   ├── index.js          # Fetch orchestrator — runs adapters, writes public/data/
│   │   ├── climatology-only.js # ERA5 DOY normals backfill (`pnpm run fetch:climatology`)
│   │   └── adapters/         # One module per upstream source (add new adapters here)
│   ├── locations/
│   │   ├── colorado-locations.json   # Curated Colorado location catalog (source of truth)
│   │   └── co-zips.json              # ZIP → nearest catalog point (copied to public/data/)
│   ├── lib/                  # Shared utilities (http, geo, slugify, rf-comms, wmo, etc.)
│   ├── ci/                   # Pages/stale-data helpers used by GitHub Actions workflows
│   └── validate-locations.js # Validates catalog (unique slug, CO bbox, region/wfo enums, webcam https)
├── public/                   # Static site root (GitHub Pages)
│   ├── index.html            # Geo-first app shell
│   ├── how-it-works.html     # Architecture & privacy (user-facing)
│   ├── credits.html          # Data provider attribution
│   ├── css/app.css           # Shared styles
│   ├── js/                   # Client modules (app, workspace, intel, outlook, dashboard, map,
│   │                           hyperlocal, geocode, geo, nws-alerts, live, radar-loop, rf-comms,
│   │                           denver-time, search, favorites, provider-delay, climatology, rwis,
│   │                           sparkline, wind, aqi, bottom-line, imagery, astronomy, icons, …)
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
│       ├── firms-fires.geojson # NASA FIRMS VIIRS hotspots (when keyed)
│       ├── space-weather.json # NOAA SWPC planetary snapshot (ham / HF)
│       ├── colo-smoke-outlook.json # CDPHE Colorado Smoke Blog teaser
│       └── locations/{slug}.json   # Full per-location payload
├── tests/                    # Node test runner (`pnpm test`) — fixtures only, no live APIs
│   └── fixtures/             # Recorded API responses for adapter/unit tests
└── .github/workflows/
    ├── pr.yml                # Lint, test, validate locations on pull requests
    ├── preview.yml           # PR preview sites under /pr-preview/pr-N/ on gh-pages
    ├── pages.yml             # Deploy UI to gh-pages on code pushes (preserves data/)
    ├── update-weather.yml    # Scheduled fetch (~45m target) + deploy + failure notify
    └── check-stale-data.yml  # Every 30m: dispatch Update Weather at ≥ 90m; Discord + red only at ≥ 120m
```

### Key artifacts

| Path                                        | Purpose                                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/locations/colorado-locations.json` | Input catalog for fetch; validated by `pnpm validate:locations`                                                                                                                            |
| `public/data/meta.json`                     | `generatedAt`, `version`, `sources[]`, `apiCalls`, `forecastStaleCount`, `locationCount`, `openmeteoCoverage`                                                                              |
| `public/data/index.json`                    | Client lookup: slug, name, lat, lon, summary fields                                                                                                                                        |
| `public/data/locations/{slug}.json`         | Full drill-down weather/AQ payload for one location                                                                                                                                        |
| `public/data/space-weather.json`            | Statewide NOAA SWPC snapshot (Kp, SFI, R/S/G, HF estimates)                                                                                                                                |
| `public/data/colo-smoke-outlook.json`       | Statewide CDPHE Colorado Smoke Blog teaser (title, publishedAt, snippet, link)                                                                                                             |
| `schemas/*.schema.json`                     | Contracts (`location`, `locations-array`, `weather-payload`, `meta`, `index-entry`, `space-weather`, `colo-smoke-outlook`); catalog/meta/index samples enforced by `pnpm validate:schemas` |

**PR previews / Pages:** Weather JSON is published only by `update-weather.yml`. Code pushes use `pages.yml` for **UI only** (`clean-exclude: pr-preview` + `data`, omits `public/data` from the payload) so merges cannot roll back live weather. Bot data commits with `GITHUB_TOKEN` do not trigger `pages.yml`. All writers share the `gh-pages` concurrency group. Same-repo PRs get `/pr-preview/pr-N/` via `preview.yml` (treat as untrusted). Previews ship **UI only** (no duplicated `public/data/`) and read live JSON from production `/cowx/data` — legacy Pages builds fail on a full doubled tree. Production deploys strip any leftover `pr-preview/*/data` and **fail the workflow** if the GitHub Pages build errors (so Actions cannot stay green while the CDN is frozen). Keep `public/.nojekyll` so Pages/Jekyll does not rewrite the tree. See README for one-time Pages setup.

**Language:** The public UI is English-only. There is no i18n catalog or translation check script.

---

## Adding a location

Edit `scripts/locations/colorado-locations.json` (JSON array). Each entry must include:

| Field          | Type   | Notes                                                                                                                                       |
| -------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `slug`         | string | Lowercase kebab-case, unique, URL-safe (`^[a-z0-9]+(?:-[a-z0-9]+)*$`)                                                                       |
| `name`         | string | Display name (non-empty after trim)                                                                                                         |
| `lat`          | number | WGS84 latitude (must fall in Colorado bounds)                                                                                               |
| `lon`          | number | WGS84 longitude (must fall in Colorado bounds)                                                                                              |
| `region`       | string | Kebab-case enum: `front-range`, `mountains`, `western-slope`, `eastern-plains`, `southwest`, `northwest` (enforced by `validate:locations`) |
| `county`       | string | County name (non-empty after trim)                                                                                                          |
| `wfo`          | string | NWS office enum: `BOU`, `PUB`, or `GJT` (enforced by `validate:locations`)                                                                  |
| `elevation_ft` | number | Elevation in feet (finite, `>= 0`)                                                                                                          |

Optional fields used by adapters (add when known):

- `icao` — nearest airport for aviation METAR/TAF
- `coagmet_id` — CoAgMET station crosswalk
- `pws_id` — Weather Underground station id (**offsite dashboard link only** — not live-fetched)
- `webcam_links` — array of `{ name, url, kind? }` for municipal/ski/NWS camera portals that must **not** be embedded; UI opens them in a new tab (`https://` only). Prefer official city/county/DOT/NWS pages.

AirGradient and AirNow resolve by nearest sensor/grid point (no per-location sensor ids in the catalog). Community PM2.5 comes from [AirGradient](https://www.airgradient.com/)’s free public feed (PurpleAir’s paid API is not used).

**Pollen / allergy (Colorado-wide):** There is no free redistributable US pollen API in the fetch budget. At merge time every catalog location gets `links.pollen` from the nearest ZIP in `co-zips.json` (Pollen.com offsite) plus statewide AAAAI NAB reference links. No live pollen grains are fetched or stored.

**Astronomy:** Sun/moon/twilight times are computed locally per location lat/lon (`scripts/lib/astronomy.js`) and written into each payload as `astronomy` — no network call.

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
4. Run `pnpm run fetch:data` (or wait for the scheduled Action) so `public/data/` includes the new site. Prefer `pnpm run fetch:data` — bare `pnpm fetch` is a pnpm builtin, not this project's script.
5. For ZIP search, update `scripts/locations/co-zips.json` (copied to `public/data/co-zips.json` on fetch).

**Removing a location:** Deleting an entry from the catalog does **not** remove the orphan `public/data/locations/{slug}.json` (or its index row until the next successful fetch rewrite). Delete stale slug files under `public/data/locations/` manually (or wipe and re-fetch) when pruning the catalog.

Use `scripts/lib/slugify.js` to derive slugs from names when needed.

---

## Adding a fetch adapter

Adapters live in `scripts/fetch/adapters/`. Each adapter is an ES module exporting a named `fetch*` function consumed by `scripts/fetch/index.js`. Merge into per-location payloads happens **inline in the orchestrator** (there is no per-adapter `merge` export).

### Adapter pattern

```js
/**
 * @param {import('../../lib/types.js').Location[]} locations
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
4. Write `public/data/index.json`, `locations/{slug}.json`, `meta.json`, `alerts.geojson`, `cdot-cameras.geojson`, `cdot-alerts.geojson`, `cwop.geojson`, `hms-smoke.geojson`, `spc-firewx.geojson`, `space-weather.json`, `colo-smoke-outlook.json`, and copy `co-zips.json`.
5. Schemas under `schemas/` are reference contracts — CI currently runs lint/test/`validate:locations` only.

**Resilience rules:**

- Wrap each adapter in try/catch; one failure must not abort unrelated sources.
- If a secret is missing, return `{ status: 'skipped' }` — do not fail the whole job.
- Use timeouts on all network I/O (`scripts/lib/http.js`).
- Set `User-Agent` on NWS (`api.weather.gov`) requests per their policy.
- Record errors in `meta.sources[].error` with secrets redacted (`sanitizeErrorMessage` / `sanitizeUrlForError`).

**Optional secrets** (read from `process.env` / GitHub Actions secrets — names only, never commit values):

| Env var          | Adapter                                   |
| ---------------- | ----------------------------------------- |
| `AIRNOW_API_KEY` | EPA AirNow AQI / observations             |
| `COTRIP_API_KEY` | COtrip RWIS / incidents / road conditions |
| `FIRMS_MAP_KEY`  | NASA FIRMS VIIRS active-fire detections   |

If unset, AirNow, COtrip, and FIRMS adapters should skip gracefully; the UI falls back to offsite links, cameras, and ArcGIS alerts where available. AirGradient needs no key.

---

## Secrets (names only)

Configure in **GitHub Actions → Secrets** (repository settings) or a local `.env` file (gitignored):

| Secret name          | Purpose                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| `AIRNOW_API_KEY`     | AirNow API access for official AQI near locations                       |
| `COTRIP_API_KEY`     | COtrip JSON feed (weather stations, incidents, events, road conditions) |
| `FIRMS_MAP_KEY`      | NASA FIRMS MAP_KEY for VIIRS active-fire detections (free registration) |
| `NOTIFY_WEBHOOK_URL` | Discord webhook for fetch/Pages failure and stale live-data alerts      |

**Never** commit secret values to git, docs, issues, logs, or test fixtures. Reference secret **names** only.

---

## Fetch cadence & API budget

- **Schedule:** `update-weather.yml` uses two staggered crons (`5,25,45` and `15,35,55`) plus `workflow_dispatch`. A decide job skips when live CDN `meta.json` is < 40 minutes old (target cadence ~45 minutes despite GitHub schedule delay); if live is stale but `main`’s `public/data/meta.json` is fresh, it deploy-only; otherwise it runs `pnpm fetch:data`.
- **Stale watchdog:** `check-stale-data.yml` every 30 minutes (`*/30 * * * *`), two tiers on production `generatedAt`:
  - **≥ `STALE_MINUTES` (90):** **dispatch** `update-weather.yml` (self-heal) and stay green — no Discord. GitHub often delays weather crons by 1–3 hours; without this catch-up the CDN stays frozen.
  - **≥ `NOTIFY_MINUTES` (120):** dispatch Update Weather, then **wait** (~20m) for live `meta.json` to recover (age under 90m, or `generatedAt` newer than the baseline). Discord-alert (when `NOTIFY_WEBHOOK_URL` is set) and fail the run only if still unrecovered after the wait. Unreachable / unparseable live `meta.json` alerts immediately (no wait).
  - Keep the alert tier at 2 hours: a Discord ping must mean the mitigations failed, not that a cron slipped or overlapped an in-flight fetch.
- **External keepalive:** GitHub has delayed both scheduled workflows for several hours simultaneously, so its schedules cannot enforce the 2-hour target alone. A cron-job.org job must POST `workflow_dispatch` to `check-stale-data.yml` every 15 minutes with `{"ref":"main","inputs":{"source":"external"}}`, using a repository-scoped fine-grained PAT with **Actions: Read and write** only. Store the PAT only in cron-job.org; never commit or log it. See README for the complete request.
- **Design goal:** Stay within free-tier limits; do not fetch more often than ~45 minutes when the CDN is already fresh.

Approximate call budget per run (scales with catalog size; actual counts are written to `meta.json` as `apiCalls`):

| Source                                        | Calls / run (approx @ ~338 locs)                                        | Auth              |
| --------------------------------------------- | ----------------------------------------------------------------------- | ----------------- |
| Open-Meteo Forecast                           | ~34+ (chunk 20 + NBM per chunk)                                         | None              |
| Open-Meteo Air Quality                        | ~9 (chunk 40)                                                           | None              |
| Open-Meteo ERA5 climatology                   | ~0 most runs; ~monthly / cold-start (capped ~24 locs/run × year slices) | None              |
| NWS alerts + AFD/HWO/FWF                      | ~13–19 (alerts + AFD/HWO/FWF per office)                                | User-Agent header |
| CoAgMET                                       | 1–2                                                                     | None              |
| Aviation Weather METAR/TAF                    | 1–3 batched                                                             | None              |
| USGS NWIS                                     | 1                                                                       | None              |
| SNOTEL                                        | 1–2                                                                     | None              |
| CDOT cameras + ArcGIS alerts                  | 3                                                                       | None              |
| COtrip (stations/incidents/events/conditions) | up to ~43 page calls total when keyed (8+10+10+15 across four feeds)    | `COTRIP_API_KEY`  |
| CWOP / APRS (aprs.me grid)                    | ~35–40                                                                  | None              |
| NOAA HMS smoke                                | 1–3 (zip download)                                                      | None              |
| SPC fire weather (Day 1–2)                    | 4 (Wind/RH + DryT GeoJSON)                                              | None              |
| NIFC WFIGS nearby fires                       | 1 (CO incidents)                                                        | None              |
| NASA FIRMS VIIRS hotspots                     | 1 (CO bbox, only if key set)                                            | `FIRMS_MAP_KEY`   |
| CBRFC water-supply guidance                   | 1 (ESP JSON, nearest CO point per location)                             | None              |
| COEM burn restrictions                        | 1 (HTML status + curated links)                                         | None              |
| NOAA SWPC space weather                       | ~5 (scales, Kp, Boulder K, SFI, X-ray)                                  | None              |
| CDPHE Colorado Smoke Blog (Blogspot RSS)      | 1 (latest post teaser → `colo-smoke-outlook.json`)                      | None              |
| AirGradient                                   | 1 (public world current; CO-filtered)                                   | None              |
| AirNow                                        | ~200–220 grid points when keyed (@0.2°)                                 | `AIRNOW_API_KEY`  |
| Catalog `webcam_links` / CAIC offsite links   | 0 (copied into payloads; no CAIC scrape)                                | None              |

Partial adapter failure is acceptable; total failure (zero locations written or all critical adapters down) should fail the workflow so notifications fire.

---

## Audience data coverage (not UI filters)

Citizen, pilot, farmer, firefighter, and ham radio operator needs define **what fields the fetch pipeline must collect** (forecast depth, METAR/TAF, CoAgMET, AQI/smoke cues, road alerts, NOAA SWPC space weather / HF cues, etc.). The public workspace shows **all** available sections for every location — there is no persona filter bar.

Locality pages open a dual-pane **workspace**: RainViewer radar map beside an **At a Glance** hero (bottom-line headline, now conditions, AQI, optional pin “At your location” strip), then full-width **Short-Term Outlook** (compact hours + scrubbable 24h meteograms), a specialty band (CDOT cameras/RWIS/road alerts & conditions, local webcam **new-tab links**, nearby PWS/CoAgMET/SNOTEL, astronomy, fire weather cues, ham radio / RF), and collapsed deep panels (48h hourly, 10-day daily, alert text + `alerts.geojson` polygons, air quality & pollen **offsite links**, NOAA/NWS and CSU CIRA imagery). Planetary space weather is written once to `public/data/space-weather.json` (not duplicated per location). The CDPHE Colorado Smoke Blog teaser is written once to `public/data/colo-smoke-outlook.json` (not duplicated per location).

**Hyperlocal pin (client, no API keys):** Locate (high-accuracy GPS), IP “Go to”, or Colorado street-address Set pin (`public/js/geocode.js` → Nominatim, CO-bounded, submit-only) stores a browser-persistent pin (`localStorage` `cowx:hyperlocalPin`; migrates any legacy `sessionStorage` value). Survives refresh and new tabs; cleared when the user searches a catalog city or clears site data. Always force-refresh the workspace after setting a pin even if the catalog slug is unchanged. The workspace still loads the nearest catalog `locations/{slug}.json` for full forecast tables. With a pin, `public/js/hyperlocal.js` re-ranks statewide `cdot-cameras.geojson`, `cdot-alerts.geojson`, and `cwop.geojson` by haversine from the pin, and may fetch **one** keyless Open-Meteo `current=` response for the pin strip (fallback status if that fails). Searching a city clears the pin. Do not add client API **keys**; keep address geocode user-triggered and Colorado-bounded.

Scheduled fetches deploy `public/` (including `data/`) to `gh-pages` in the same workflow (`deploy-pages` job). Do not rely on the data push alone to trigger `pages.yml` — `GITHUB_TOKEN` commits do not start new workflow runs. Code pushes to `main` use `pages.yml` for UI only and leave `gh-pages` `data/` intact.

---

## Accessibility (WCAG 2.2 AA)

All UI changes in `public/` must meet **WCAG 2.2 Level AA**:

- **Perceivable:** Text contrast ≥ 4.5:1 (3:1 for large text); do not rely on color alone for alert severity.
- **Operable:** Full keyboard access; visible focus indicators; skip link to main content; respect `prefers-reduced-motion`.
- **Understandable:** Labels on form controls; clear error/empty states; consistent navigation.
- **Robust:** Semantic HTML; ARIA only when native elements are insufficient; live regions for dynamic weather updates where appropriate.

Before merging frontend work: manually tab through geo resolve, search, favorites, and the location workspace. Automated axe/pa11y smoke tests are aspirational (not wired in CI yet).

Map layers must have a non-map alternative (list/table) for keyboard and screen-reader users.

---

## Testing

- Run `pnpm test` — Node built-in test runner (**always under `TZ=UTC`** via the `test` script). Open-Meteo times are America/Denver local ISO without offset; never parse them with host-local `new Date(t)`. Coverage lives in `tests/denver-tz-invariant.test.js`.
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
- Client geo resolves to the **nearest catalog point in Colorado**; out-of-state visitors see nearest CO site plus search. Optional saved pin refines cameras/PWS/alerts and pin-current without changing the catalog slug.
- Do not add national/global primary views or non-CO location catalogs.
- To fork this project for another state, follow [ADAPT.md](ADAPT.md).

---

## Failure notifications

When the **weather fetch step** in `update-weather.yml` fails (`weather_fetch`), or the **gh-pages deploy / Pages build verification** fails, a notify job POSTs a summary to `NOTIFY_WEBHOOK_URL` (if set). Install/push races after a successful fetch do **not** notify. Separately, `check-stale-data.yml` auto-dispatches Update Weather at ≥ 90 minutes **silently**, and at ≥ 120 minutes waits for recovery before POSTing (or immediately if live `meta.json` is unreachable) — i.e. only when self-heal did not land. Neither opens a GitHub Issue. Never log or echo the webhook URL. See `how-it-works.html` for the user-facing explanation.

---

## Local commands

```bash
pnpm install
pnpm validate:locations
pnpm run fetch:data   # writes public/data/ (requires network). Prefer `pnpm run` — bare `pnpm fetch` is a pnpm builtin.
pnpm run fetch:climatology  # ERA5 DOY normals only (slow; optional CLIMATOLOGY_MAX_LOCS=N)
pnpm test                 # always TZ=UTC (catches Denver local-ISO Date traps)
pnpm lint
pnpm format           # Prettier
npx serve public      # local preview
```

Use Node **22.19+** (see `.nvmrc`). For local adapter keys, copy `.env.example` to `.env` (gitignored). `NOTIFY_WEBHOOK_URL` is Actions-only.

Open-Meteo forecast times use `timezone=America/Denver` and arrive as offset-less local ISO (`2026-07-22T12:00` = noon Mountain). Compare them with `currentHourIndex` / `nearestHourIndex` / `denverHourKey` / `precipTodayInches` from `public/js/denver-time.js` — never `new Date(t)` on those strings. Use `currentHourIndex` (latest hour ≤ now) for At a Glance / “now” conditions; `nearestHourIndex` is for absolute closeness only.
