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

Without running `pnpm run fetch:data`, only committed snapshot data in `public/data/` is available.

## Scripts

| Command                   | Description                                                   |
| ------------------------- | ------------------------------------------------------------- |
| `pnpm fetch:data`         | Run the fetch orchestrator; write/update `public/data/*.json` |
| `pnpm test`               | Unit tests (fixtures only — no live API calls)                |
| `pnpm lint`               | ESLint                                                        |
| `pnpm validate:locations` | Validate `scripts/locations/colorado-locations.json`          |
| `pnpm format`             | Prettier                                                      |

## GitHub Pages

The site is deployed from the `public/` directory to the `gh-pages` branch on pushes to `main` (see `.github/workflows/pages.yml`).

**Live site:** https://rinchen.github.io/cowx/

### PR previews

Same-repo pull requests get a sticky comment with a live preview URL under `/pr-preview/pr-{N}/` (see `.github/workflows/preview.yml`). Previews use the PR’s committed `public/` tree (including weather JSON); they are removed when the PR closes. Fork PRs do not get automatic previews — use `npx serve public` locally. Preview URLs share the production GitHub Pages origin — treat them as **untrusted** until you review the PR.

**One-time setup** (after the first `gh-pages` deploy succeeds):

1. **Settings → Pages → Build and deployment → Source:** Deploy from a branch → `gh-pages` / `/` (not “GitHub Actions”).
2. **Settings → Actions → General → Workflow permissions:** Read and write permissions.

Weather data is refreshed on a **45-minute** schedule via `.github/workflows/update-weather.yml` (`*/45 * * * *` plus `workflow_dispatch`). When the **weather fetch step** fails, Actions can notify via `NOTIFY_WEBHOOK_URL` (if set; no GitHub Issue). Committed JSON in `public/data/` is what visitors see between runs. `public/.nojekyll` keeps GitHub Pages from running Jekyll on the static tree.

## GitHub Actions secrets

Optional secrets improve inline sensor/AQI data and failure alerting. Configure under **Settings → Secrets and variables → Actions**. Use these **names** only — never commit values:

| Secret name          | Purpose                                                                      |
| -------------------- | ---------------------------------------------------------------------------- |
| `PURPLEAIR_API_KEY`  | PurpleAir sensor readings at build time                                      |
| `AIRNOW_API_KEY`     | EPA AirNow AQI near locations                                                |
| `COTRIP_API_KEY`     | COtrip JSON feed (RWIS, incidents, planned events, road conditions)          |
| `NOTIFY_WEBHOOK_URL` | Webhook for Discord (or compatible) alerts when the weather fetch step fails |

The site works without these keys; affected sources degrade to skipped status in `meta.json` and offsite links in the UI. CDOT cameras, ArcGIS road alerts (fallback), CWOP PWS, HMS smoke, SPC fire weather, NIFC nearby fires, and burn-restriction links need no secrets. City webcam portals are catalog **links** (new tab), not embedded feeds. For local fetch testing, copy [`.env.example`](.env.example) to `.env` (gitignored); notify is Actions-only.

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

[MIT](LICENSE). Third-party data remains subject to each provider’s terms.
