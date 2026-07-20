import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  estimateAuroraColorado,
  estimateHfConditions,
  fluxTier,
  kpDrag,
  scoreToRating,
  xrayFluxToClass,
} from '../scripts/lib/hf-conditions.js';
import {
  buildSpaceWeatherSnapshot,
  fetchSpaceWeather,
  parseBoulderKp,
  parseGoesXray,
  parseNoaaScales,
  parsePlanetaryKp,
  parseSolarFlux,
} from '../scripts/fetch/adapters/space-weather.js';
import { synthesizeBottomLine } from '../public/js/bottom-line.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, 'fixtures/swpc');

/** @type {typeof globalThis.fetch | undefined} */
let originalFetch;

describe('hf-conditions', () => {
  it('maps scores and flux/kp tiers', () => {
    assert.equal(scoreToRating(0), 'poor');
    assert.equal(scoreToRating(1), 'fair');
    assert.equal(scoreToRating(2), 'good');
    assert.equal(scoreToRating(3), 'excellent');
    assert.equal(fluxTier(80), 0);
    assert.equal(fluxTier(100), 1);
    assert.equal(fluxTier(150), 2);
    assert.equal(fluxTier(200), 3);
    assert.equal(kpDrag(1), 0);
    assert.equal(kpDrag(4), 1);
    assert.equal(kpDrag(5), 2);
    assert.equal(kpDrag(8), 3);
  });

  it('converts X-ray flux to flare class', () => {
    assert.equal(xrayFluxToClass(1.2e-6), 'C1.2');
    assert.equal(xrayFluxToClass(3.5e-5), 'M3.5');
    assert.equal(xrayFluxToClass(2e-4), 'X2.0');
    assert.equal(xrayFluxToClass(null), null);
  });

  it('estimates HF bands from SFI and Kp', () => {
    assert.equal(estimateHfConditions(null, 2), null);
    const quiet = estimateHfConditions(150, 1);
    assert.ok(quiet);
    assert.equal(quiet.day['20m'], 'excellent');
    assert.match(quiet.disclaimer, /Heuristic/);
    const storm = estimateHfConditions(150, 8);
    assert.ok(storm);
    assert.equal(storm.day['20m'], 'poor');
    assert.equal(storm.night['40m'], 'poor');
  });

  it('estimates Colorado aurora chance from Kp', () => {
    assert.equal(estimateAuroraColorado(2)?.chance, 'unlikely');
    assert.equal(estimateAuroraColorado(5.5)?.chance, 'possible');
    assert.equal(estimateAuroraColorado(7)?.chance, 'likely');
    assert.equal(estimateAuroraColorado(null), null);
  });
});

describe('space-weather parsers', () => {
  it('parses NOAA scales', async () => {
    const raw = JSON.parse(await readFile(path.join(fixtures, 'noaa-scales.json'), 'utf8'));
    const scales = parseNoaaScales(raw);
    assert.ok(scales);
    assert.ok(scales.R);
    assert.ok(Array.isArray(scales.forecast));
    assert.ok(scales.forecast.length >= 1);
  });

  it('parses planetary and Boulder Kp', async () => {
    const kpRaw = JSON.parse(
      await readFile(path.join(fixtures, 'planetary_k_index_1m.json'), 'utf8'),
    );
    const bRaw = JSON.parse(await readFile(path.join(fixtures, 'boulder_k_index_1m.json'), 'utf8'));
    const kp = parsePlanetaryKp(kpRaw);
    const boulder = parseBoulderKp(bRaw);
    assert.ok(kp);
    assert.ok(Number.isFinite(kp.value));
    assert.equal(kp.source, 'planetary');
    assert.ok(boulder);
    assert.ok(Number.isFinite(boulder.value));
  });

  it('parses solar flux and GOES X-ray', async () => {
    const fluxRaw = JSON.parse(await readFile(path.join(fixtures, 'f107_cm_flux.json'), 'utf8'));
    const xrayRaw = JSON.parse(await readFile(path.join(fixtures, 'xrays-6-hour.json'), 'utf8'));
    const sfi = parseSolarFlux(fluxRaw);
    const xray = parseGoesXray(xrayRaw);
    assert.ok(sfi);
    assert.ok(sfi.value > 50);
    assert.ok(xray);
    assert.ok(xray.class);
    assert.match(String(xray.class), /^[ABCMX]/);
  });

  it('builds a snapshot with HF and aurora', async () => {
    const scales = parseNoaaScales(
      JSON.parse(await readFile(path.join(fixtures, 'noaa-scales.json'), 'utf8')),
    );
    const kp = parsePlanetaryKp(
      JSON.parse(await readFile(path.join(fixtures, 'planetary_k_index_1m.json'), 'utf8')),
    );
    const sfi = parseSolarFlux(
      JSON.parse(await readFile(path.join(fixtures, 'f107_cm_flux.json'), 'utf8')),
    );
    const snap = buildSpaceWeatherSnapshot({ scales, kp, sfi });
    assert.ok(snap.hf);
    assert.ok(snap.aurora_co);
    assert.ok(snap.links.swpc);
  });

  it('returns null for empty parses', () => {
    assert.equal(parseNoaaScales(null), null);
    assert.equal(parsePlanetaryKp([]), null);
    assert.equal(parseBoulderKp({}), null);
    assert.equal(parseSolarFlux([]), null);
    assert.equal(parseGoesXray([]), null);
  });
});

describe('fetchSpaceWeather', () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it('assembles ok snapshot from fixtures', async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      let name = null;
      if (url.includes('noaa-scales')) name = 'noaa-scales.json';
      else if (url.includes('planetary_k_index')) name = 'planetary_k_index_1m.json';
      else if (url.includes('boulder_k_index')) name = 'boulder_k_index_1m.json';
      else if (url.includes('f107_cm_flux')) name = 'f107_cm_flux.json';
      else if (url.includes('xrays-6-hour')) name = 'xrays-6-hour.json';
      if (!name) {
        return /** @type {Response} */ ({
          ok: false,
          status: 404,
          text: async () => 'missing',
          json: async () => ({}),
        });
      }
      const body = await readFile(path.join(fixtures, name), 'utf8');
      return /** @type {Response} */ ({
        ok: true,
        status: 200,
        text: async () => body,
        json: async () => JSON.parse(body),
      });
    };

    const result = await fetchSpaceWeather();
    assert.equal(result.status, 'ok');
    assert.equal(result.calls, 5);
    assert.ok(result.snapshot);
    assert.ok(result.snapshot.kp || result.snapshot.sfi);
  });

  it('returns partial when some endpoints fail', async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('noaa-scales') || url.includes('planetary_k_index')) {
        const name = url.includes('noaa-scales') ? 'noaa-scales.json' : 'planetary_k_index_1m.json';
        const body = await readFile(path.join(fixtures, name), 'utf8');
        return /** @type {Response} */ ({
          ok: true,
          status: 200,
          text: async () => body,
          json: async () => JSON.parse(body),
        });
      }
      return /** @type {Response} */ ({
        ok: false,
        status: 503,
        text: async () => 'down',
        json: async () => ({}),
      });
    };
    const result = await fetchSpaceWeather();
    assert.equal(result.status, 'partial');
    assert.ok(result.snapshot);
    assert.ok(result.error);
  });

  it('returns error when all endpoints fail', async () => {
    globalThis.fetch = async () =>
      /** @type {Response} */ ({
        ok: false,
        status: 500,
        text: async () => 'fail',
        json: async () => ({}),
      });
    const result = await fetchSpaceWeather();
    assert.equal(result.status, 'error');
    assert.equal(result.snapshot, null);
    assert.ok(result.error);
  });
});

describe('synthesizeBottomLine space weather', () => {
  const quietBase = {
    current: { wind_speed_mph: 5, condition: 'Clear', humidity: 40, temp_f: 70 },
    alerts: [],
    hourly: { time: [] },
  };

  it('surfaces G3+ geomagnetic storms', () => {
    const { headline, priority } = synthesizeBottomLine(quietBase, {
      spaceWeather: {
        scales: { G: { scale: 3, text: 'strong' }, R: { scale: 0 }, S: { scale: 0 } },
      },
    });
    assert.equal(priority, 'space');
    assert.match(headline, /G3/);
  });

  it('surfaces R3+ radio blackouts', () => {
    const { priority, headline } = synthesizeBottomLine(quietBase, {
      spaceWeather: {
        scales: { R: { scale: 3, text: 'strong' }, G: { scale: 0 }, S: { scale: 0 } },
      },
    });
    assert.equal(priority, 'space');
    assert.match(headline, /R3/);
  });

  it('does not elevate quiet scales', () => {
    const { priority } = synthesizeBottomLine(quietBase, {
      spaceWeather: { scales: { G: { scale: 1 }, R: { scale: 0 }, S: { scale: 0 } } },
    });
    assert.notEqual(priority, 'space');
  });

  it('keeps NWS alerts above space weather', () => {
    const { priority, headline } = synthesizeBottomLine(
      {
        ...quietBase,
        alerts: [{ event: 'Tornado Warning', severity: 'Extreme' }],
      },
      {
        spaceWeather: { scales: { G: { scale: 5 }, R: { scale: 0 }, S: { scale: 0 } } },
      },
    );
    assert.equal(priority, 'hazard');
    assert.match(headline, /Tornado/);
  });
});
