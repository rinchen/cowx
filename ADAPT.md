# Adapt COWX for another state

COWX is a **Colorado-scoped** static weather site: a location catalog, scheduled fetch into `public/data/`, and a client that snaps visitors to the nearest catalog point. There is no server and no state polygon gate — **scope is whatever you put in the catalog**.

This guide is for forking the repo and replacing Colorado details with another US state (or region).

---

## 1. Fork and run locally

**Requirements:** Node 20+, [pnpm](https://pnpm.io/) 10+

```bash
git clone https://github.com/<you>/<your-repo>.git
cd <your-repo>
pnpm install
pnpm validate:locations
pnpm fetch:data     # needs network; writes public/data/
pnpm test
npx serve public
```

Point GitHub Pages at the `gh-pages` branch (deployed from `public/` by `.github/workflows/pages.yml`). Keep `clean-exclude: pr-preview` if you use PR previews. Leave `public/.nojekyll` in place so GitHub Pages does not run Jekyll over the static tree. Optional Actions secrets: `PURPLEAIR_API_KEY`, `AIRNOW_API_KEY`, `NOTIFY_WEBHOOK_URL` — names only; never commit values.

### GitHub Pages / PR previews

1. **Settings → Pages → Source:** Deploy from a branch → `gh-pages` / `/` (not “GitHub Actions”).
2. **Settings → Actions → Workflow permissions:** Read and write.
3. Same-repo PRs publish under `/pr-preview/pr-N/` via `.github/workflows/preview.yml` (fork PRs are skipped). Treat preview URLs as **untrusted** — they share the production `*.github.io` origin.
4. Do not remove `clean-exclude: pr-preview` from `pages.yml` or production deploys will wipe open PR previews.

---

## 2. Checklist (order matters)

1. **Location catalog + ZIPs** — primary data work
2. **Schemas** — region / WFO enums must match the catalog
3. **Fetch adapters** — NWS area, WFOs, timezone, bbox, ICAOs; ag network
4. **Frontend** — brand strings, map center, flag, `localStorage` keys
5. **Docs / CI copy** — README, AGENTS, HTML pages, notify messages
6. **Regenerate data** — `pnpm validate:locations` → `pnpm fetch:data` → `pnpm test`

---

## 3. Location catalog (required)

**Source of truth:** [`scripts/locations/colorado-locations.json`](scripts/locations/colorado-locations.json)

Replace every entry with sites in your state. Each object needs at least:

| Field          | Notes                                                                                                                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slug`         | Stable kebab-case, unique (`denver`, `pueblo`)                                                                                                                                                                                     |
| `name`         | Display name                                                                                                                                                                                                                       |
| `lat`, `lon`   | WGS84 (must fall in your target state bbox in the validator)                                                                                                                                                                       |
| `region`       | Kebab-case region string; update `schemas/location.schema.json` enums for contracts. `pnpm validate:locations` does **not** enforce region/wfo enums — only required fields, slug shape, CO (or your) bbox, and webcam link rules. |
| `county`       | County name                                                                                                                                                                                                                        |
| `wfo`          | NWS office id (e.g. `BOU`) — update schema enum for documentation; CI validator does not check the enum                                                                                                                            |
| `elevation_ft` | Elevation                                                                                                                                                                                                                          |

Useful optional fields: `icao`, `pws_id` (WU dashboard link only), `coagmet_id`,
`webcam_links` (municipal/ski/NWS camera **portals** as new-tab links — do not scrape or hotlink stills).

### Local webcam links (forking)

City and county camera portals are rarely embeddable. Add them to the catalog:

```json
"webcam_links": [
  { "name": "City traffic cameras", "url": "https://example.gov/cameras/", "kind": "city" }
]
```

Rules:

- Prefer **official** city/county/NWS/DOT `https://` pages
- UI opens each link in a **new tab** (`target="_blank"` `rel="noopener noreferrer"`)
- Do **not** scrape private feeds or embed third-party stills without clear redistribution rights
- Replace Colorado examples (Longmont, Boulder, Larimer, Colorado Springs) with your state’s portals, or omit
- Extend `schemas/location.schema.json` if you change the `webcam_links` shape

Also update state filters in adapters that hardcode Colorado:

- `scripts/fetch/adapters/usgs.js` (`stateCd=CO`)
- `scripts/fetch/adapters/snotel.js` (`stateCode === 'CO'`)
- CDOT / CWOP adapters (Colorado-centric sources — replace or remove for other states)

Rename the file if you want (e.g. `montana-locations.json`), then update paths in:

- `scripts/fetch/index.js`
- `scripts/validate-locations.js`
- `package.json` (`validate:locations` script)
- `AGENTS.md` / this doc

**ZIPs:** [`scripts/locations/co-zips.json`](scripts/locations/co-zips.json) powers ZIP search. Replace with your state’s ZIP centroids (or equivalent). Fetch copies it to `public/data/co-zips.json`; if you rename the file, update the fetch writer and [`public/js/app.js`](public/js/app.js) loader.

Nearest-location behavior ([`public/js/geo.js`](public/js/geo.js)) is haversine over the catalog only — out-of-state visitors still get the nearest **catalog** point.

---

## 4. Schemas

Edit [`schemas/location.schema.json`](schemas/location.schema.json):

- `properties.region.enum` → your regions
- `properties.wfo.enum` → NWS offices that cover your state

Keep slug / lat / lon rules unless you have a reason to change them.

---

## 5. Fetch adapters (state-specific knobs)

Most sources are national APIs keyed by lat/lon. These are Colorado-hardcoded today:

| File                                                                                         | Change                                                                                                                   |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [`scripts/fetch/adapters/nws.js`](scripts/fetch/adapters/nws.js)                             | `area=CO` → your state code; `OFFICES = ['BOU','PUB','GJT']` → your WFOs                                                 |
| [`scripts/fetch/adapters/openmeteo.js`](scripts/fetch/adapters/openmeteo.js)                 | `timezone=America/Denver` → your IANA zone(s)                                                                            |
| [`scripts/fetch/adapters/openmeteo-aq.js`](scripts/fetch/adapters/openmeteo-aq.js)           | Same timezone                                                                                                            |
| [`scripts/fetch/adapters/purpleair.js`](scripts/fetch/adapters/purpleair.js)                 | Bounding box constants (N/S/W/E)                                                                                         |
| [`scripts/fetch/adapters/aviation.js`](scripts/fetch/adapters/aviation.js)                   | Seed ICAO list (`KDEN`, …) → major airports in your state                                                                |
| [`scripts/fetch/adapters/coagmet.js`](scripts/fetch/adapters/coagmet.js)                     | **Colorado-only** (CSU CoAgMET). Replace with your ag network or remove the adapter, orchestrator wiring, and UI section |
| [`scripts/fetch/adapters/cdot.js`](scripts/fetch/adapters/cdot.js)                           | Colorado DOT cameras / RWIS / alerts — replace with your DOT traveler feeds or remove                                    |
| [`scripts/fetch/adapters/cwop.js`](scripts/fetch/adapters/cwop.js)                           | Adjust CO bbox / sample grid                                                                                             |
| [`scripts/fetch/adapters/hms.js`](scripts/fetch/adapters/hms.js)                             | National HMS smoke — keep; adjust CO bbox clip if desired                                                                |
| [`scripts/fetch/adapters/spc-firewx.js`](scripts/fetch/adapters/spc-firewx.js)               | National SPC fire weather — keep; adjust CO bbox clip if desired                                                         |
| [`scripts/fetch/adapters/nifc-fires.js`](scripts/fetch/adapters/nifc-fires.js)               | Filter `POOState='US-CO'` → your state code                                                                              |
| [`scripts/fetch/adapters/burn-restrictions.js`](scripts/fetch/adapters/burn-restrictions.js) | Colorado COEM/DFPC links — replace with your state’s restriction aggregator or curated county links                      |
| [`scripts/fetch/adapters/space-weather.js`](scripts/fetch/adapters/space-weather.js)         | NOAA SWPC planetary snapshot → `space-weather.json`; keep (national). Adjust aurora/HF copy if state-specific            |
| [`scripts/lib/hf-conditions.js`](scripts/lib/hf-conditions.js)                               | HF band estimate helpers used by space-weather merge / UI — keep or retune heuristics for your latitude                  |
| [`scripts/lib/http.js`](scripts/lib/http.js)                                                 | NWS `User-Agent` string — use your project name + contact URL/email                                                      |

National / keep with new coords: Open-Meteo forecast & AQ, AirNow (with key), RainViewer, NWS point links.

After adapter edits:

```bash
pnpm validate:locations
pnpm fetch:data
pnpm test
```

Wipe stale Colorado payloads under `public/data/locations/` if old slugs remain.

---

## 6. Frontend brand and map

Sweep “COWX”, “Colorado”, and the flag:

| Area                   | Files                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Titles / meta / nav    | `public/index.html`, `how-it-works.html`, `credits.html`                                                                                                   |
| UI shell / routing     | `public/js/app.js` (“Find your Colorado weather”, document title `COWX — Colorado Weather`)                                                                |
| Workspace / intel      | `public/js/workspace.js`, `intel.js`, `hyperlocal.js`, `bottom-line.js`, `radar-loop.js`, `geocode.js` — brand strings, pin copy, Colorado-bounded geocode |
| Map overview           | `public/js/map.js` — `CO_CENTER`, `CO_ZOOM` (and aria labels)                                                                                              |
| Snapshot / deep panels | `public/js/dashboard.js` — “Colorado snapshot…”, CoAgMET labels if removed                                                                                 |
| Short-Term Outlook     | `public/js/outlook.js`, `public/js/intel.js`, `public/js/sparkline.js` — period copy, meteograms, scrubber                                                 |
| Wind compass           | `public/js/wind.js` — direction labels / SVG                                                                                                               |
| Imagery defaults       | `public/js/imagery.js` — default map center for CIRA/NWS deep links                                                                                        |
| Favicon / logo         | `public/favicon.svg`, `public/img/colorado-flag.svg` (replace + update `src`)                                                                              |
| localStorage           | `public/js/favorites.js` + `public/js/geo.js` — `cowx:favorites`, `cowx:lastLocation`, `cowx:hyperlocalPin` → your prefix                                  |
| package / schemas      | `package.json` name & description; schema `$id` / titles if desired                                                                                        |

Deploy URL and GitHub links in HTML should point at **your** repo / Pages site.

---

## 7. Docs and CI text

Update Colorado framing in:

- [`README.md`](README.md)
- [`AGENTS.md`](AGENTS.md) (especially “Colorado-only scope”)
- User pages: `public/how-it-works.html`, `public/credits.html`
- `.github/workflows/update-weather.yml` notify copy (“COWX weather fetch failed…”)

Keep this file (`ADAPT.md`) and adjust examples to your brand once stable.

---

## 8. What you can leave alone

- Client routing (`#/`, `#/search`, `#/refine`, `#/l/{slug}`), favorites UX, forecast tables
- Generic haversine helpers (`scripts/lib/geo.js`, `public/js/geo.js`)
- Pages / PR workflows (paths), unless you rename scripts — keep `preview.yml`, `pages.yml` `clean-exclude: pr-preview`, and `public/.nojekyll`
- RainViewer / Leaflet map plumbing (re-center only)

Hash routes: `#/` home/resolve, `#/search` find-location (no auto-redirect), `#/refine` pin refine flow, `#/l/{slug}` locality workspace.

---

## 9. Minimal “hello state” path

If you want a thin proof fork before a full catalog:

1. Trim `colorado-locations.json` to 5–10 cities in your state (valid `region` / `wfo` enums).
2. Set NWS `area=XX` and matching `OFFICES`.
3. Set Open-Meteo timezone and map `CO_CENTER`.
4. Rename brand strings in `index.html` + `app.js`.
5. `pnpm validate:locations && pnpm fetch:data && npx serve public`.

Then expand the catalog, ZIPs, PurpleAir bbox, aviation ICAOs, and decide on an ag-data adapter.

---

## Attribution and scope

Upstream data (NWS, Open-Meteo, AirNow, etc.) remains under each provider’s terms. This project is unofficial and not affiliated with those agencies. When you publish a fork, update Credits and your NWS User-Agent so operators can contact **you**.
