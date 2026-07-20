# COWX — Colorado Weather

**COWX** (COlorado + Weather) aggregates weather and air-quality data for Colorado locations, built as a static site on GitHub Pages. A scheduled fetch job merges public data sources into JSON under `public/data/`; the browser app geo-locates you to the nearest site and offers deep drill-down panels.

**Scope:** Colorado only. Unofficial project — not affiliated with NWS, NOAA, or other government agencies.

## Quick start

**Requirements:** Node 20+, [pnpm](https://pnpm.io/) 10+

```bash
git clone <repository-url>
cd cowx
pnpm install
pnpm validate:locations
pnpm fetch:data
npx serve public
```

Open the URL printed by `serve` (typically `http://localhost:3000`). The app loads data from `public/data/`.

Without running `fetch`, only committed snapshot data in `public/data/` is available.

## Scripts

| Command                   | Description                                                   |
| ------------------------- | ------------------------------------------------------------- |
| `pnpm fetch:data`         | Run the fetch orchestrator; write/update `public/data/*.json` |
| `pnpm test`               | Unit tests (fixtures only — no live API calls)                |
| `pnpm lint`               | ESLint                                                        |
| `pnpm validate:locations` | Validate `scripts/locations/colorado-locations.json`          |
| `pnpm format`             | Prettier                                                      |

## GitHub Pages

The site is deployed from the `public/` directory on pushes to `main` (see `.github/workflows/pages.yml`).

**Live site:** https://rinchen.github.io/cowx/

Weather data is refreshed on a **45-minute** schedule via `.github/workflows/update-weather.yml` (`*/45 * * * *` plus `workflow_dispatch`). Failures notify via `NOTIFY_WEBHOOK_URL` and a GitHub Issue. Committed JSON in `public/data/` is what visitors see between runs.

## GitHub Actions secrets

Optional secrets improve inline sensor/AQI data and failure alerting. Configure under **Settings → Secrets and variables → Actions**. Use these **names** only — never commit values:

| Secret name          | Purpose                                                            |
| -------------------- | ------------------------------------------------------------------ |
| `PURPLEAIR_API_KEY`  | PurpleAir sensor readings at build time                            |
| `AIRNOW_API_KEY`     | EPA AirNow AQI near locations                                      |
| `SYNOPTIC_API_TOKEN` | Optional Synoptic/MesoWest denser neighborhood PWS                 |
| `NOTIFY_WEBHOOK_URL` | Webhook for Discord (or compatible) alerts when fetch/update fails |

The site works without these keys; affected sources degrade to skipped status in `meta.json` and offsite links in the UI. CDOT cameras, road alerts, CWOP PWS, HMS smoke, SPC fire weather, NIFC nearby fires, and burn-restriction links need no secrets. City webcam portals are catalog **links** (new tab), not embedded feeds.

## Privacy

- **No accounts** and no server-side storage of personal data.
- **Favorites, last-viewed location, and hyperlocal pin** are stored only in your browser (`localStorage` keys such as `cowx:favorites`, `cowx:lastLocation`, and `cowx:hyperlocalPin`). The pin (lat/lon) survives refresh; searching a city clears it. Address query text is not retained after geocoding.
- **IP geolocation** runs in the browser from public CORS geo APIs to suggest the nearest Colorado site. Coordinates are not sent to a COWX backend (there is none).
- **No third-party analytics** by default.

See [how-it-works.html](public/how-it-works.html) for details.

## Documentation

- [ADAPT.md](ADAPT.md) — fork this site for another US state (catalog, adapters, branding)
- [AGENTS.md](AGENTS.md) — contributor and agent guide (adapters, locations, CI, a11y)
- [How it works](public/how-it-works.html) — architecture, update cadence, failure modes
- [Credits](public/credits.html) — data sources and attribution

## License

See repository license file when present. Third-party data remains subject to each provider’s terms.
