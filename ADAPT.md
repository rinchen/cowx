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
pnpm fetch          # needs network; writes public/data/
pnpm test
npx serve public
```

Point GitHub Pages at `public/` (see `.github/workflows/pages.yml`). Optional Actions secrets: `PURPLEAIR_API_KEY`, `AIRNOW_API_KEY`, `NOTIFY_WEBHOOK_URL` — names only; never commit values.

---

## 2. Checklist (order matters)

1. **Location catalog + ZIPs** — primary data work
2. **Schemas** — region / WFO enums must match the catalog
3. **Fetch adapters** — NWS area, WFOs, timezone, bbox, ICAOs; ag network
4. **Frontend** — brand strings, map center, flag, `localStorage` keys
5. **Docs / CI copy** — README, AGENTS, HTML pages, notify messages
6. **Regenerate data** — `pnpm validate:locations` → `pnpm fetch` → `pnpm test`

---

## 3. Location catalog (required)

**Source of truth:** [`scripts/locations/colorado-locations.json`](scripts/locations/colorado-locations.json)

Replace every entry with sites in your state. Each object needs at least:

| Field          | Notes                                                          |
| -------------- | -------------------------------------------------------------- |
| `slug`         | Stable kebab-case, unique (`denver`, `pueblo`)                 |
| `name`         | Display name                                                   |
| `lat`, `lon`   | WGS84 (must fall in your target state bbox in the validator)   |
| `region`       | Must match `schemas/location.schema.json` enums (update those) |
| `county`       | County name                                                    |
| `wfo`          | NWS office id (e.g. `BOU`) — update schema enum                |
| `elevation_ft` | Elevation                                                      |

Useful optional fields: `icao`, `pws_id`, `coagmet_id`. PurpleAir and AirNow resolve by nearest
sensor/grid (no per-location sensor ids).

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

| File                                                                               | Change                                                                                                                   |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [`scripts/fetch/adapters/nws.js`](scripts/fetch/adapters/nws.js)                   | `area=CO` → your state code; `OFFICES = ['BOU','PUB','GJT']` → your WFOs                                                 |
| [`scripts/fetch/adapters/openmeteo.js`](scripts/fetch/adapters/openmeteo.js)       | `timezone=America/Denver` → your IANA zone(s)                                                                            |
| [`scripts/fetch/adapters/openmeteo-aq.js`](scripts/fetch/adapters/openmeteo-aq.js) | Same timezone                                                                                                            |
| [`scripts/fetch/adapters/purpleair.js`](scripts/fetch/adapters/purpleair.js)       | Bounding box constants (N/S/W/E)                                                                                         |
| [`scripts/fetch/adapters/aviation.js`](scripts/fetch/adapters/aviation.js)         | Seed ICAO list (`KDEN`, …) → major airports in your state                                                                |
| [`scripts/fetch/adapters/coagmet.js`](scripts/fetch/adapters/coagmet.js)           | **Colorado-only** (CSU CoAgMET). Replace with your ag network or remove the adapter, orchestrator wiring, and UI section |
| [`scripts/lib/http.js`](scripts/lib/http.js)                                       | NWS `User-Agent` string — use your project name + contact URL/email                                                      |

National / keep with new coords: Open-Meteo forecast & AQ, AirNow (with key), RainViewer, NWS point links.

After adapter edits:

```bash
pnpm validate:locations
pnpm fetch
pnpm test
```

Wipe stale Colorado payloads under `public/data/locations/` if old slugs remain.

---

## 6. Frontend brand and map

Sweep “COWX”, “Colorado”, and the flag:

| Area                | Files                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------- |
| Titles / meta / nav | `public/index.html`, `how-it-works.html`, `credits.html`                               |
| UI copy             | `public/js/app.js` (“Find your Colorado weather”, “Colorado overview”, document title) |
| Map overview        | `public/js/map.js` — `CO_CENTER`, `CO_ZOOM` (and aria labels)                          |
| Imagery defaults    | `public/js/imagery.js` — default map center for CIRA/NWS deep links                    |
| Snapshot copy       | `public/js/dashboard.js` — “Colorado snapshot…”, CoAgMET labels if removed             |
| Favicon / logo      | `public/favicon.svg`, `public/img/colorado-flag.svg` (replace + update `src`)          |
| localStorage        | `public/js/favorites.js` — `cowx:favorites`, `cowx:lastLocation` → your prefix         |
| package / schemas   | `package.json` name & description; schema `$id` / titles if desired                    |

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

- Client routing (`#/`, `#/l/{slug}`), favorites UX, forecast tables
- Generic haversine helpers (`scripts/lib/geo.js`, `public/js/geo.js`)
- Pages / PR workflows (paths), unless you rename scripts
- RainViewer / Leaflet map plumbing (re-center only)

---

## 9. Minimal “hello state” path

If you want a thin proof fork before a full catalog:

1. Trim `colorado-locations.json` to 5–10 cities in your state (valid `region` / `wfo` enums).
2. Set NWS `area=XX` and matching `OFFICES`.
3. Set Open-Meteo timezone and map `CO_CENTER`.
4. Rename brand strings in `index.html` + `app.js`.
5. `pnpm validate:locations && pnpm fetch && npx serve public`.

Then expand the catalog, ZIPs, PurpleAir bbox, aviation ICAOs, and decide on an ag-data adapter.

---

## Attribution and scope

Upstream data (NWS, Open-Meteo, AirNow, etc.) remains under each provider’s terms. This project is unofficial and not affiliated with those agencies. When you publish a fork, update Credits and your NWS User-Agent so operators can contact **you**.
