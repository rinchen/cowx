/**
 * Client-side RF ducting estimate (mirrors scripts/lib/rf-comms.js).
 * @param {{ temp_f?: number | null, wind_speed_mph?: number | null, wind_gust_mph?: number | null }} current
 * @param {number | null | undefined} temp850C
 * @param {number | null | undefined} elevationFt
 */
export function estimateRfComms(current, temp850C, elevationFt) {
  if (current?.temp_f == null || temp850C == null || !Number.isFinite(Number(temp850C))) {
    return null;
  }

  const surfaceF = Number(current.temp_f);
  const t850F = (Number(temp850C) * 9) / 5 + 32;
  const elev =
    elevationFt != null && Number.isFinite(Number(elevationFt)) ? Number(elevationFt) : null;
  const gust = Number(current.wind_gust_mph ?? current.wind_speed_mph ?? 0);
  const wind = Number(current.wind_speed_mph ?? 0);

  if (elev != null && elev > 8500) {
    if (gust >= 35 || wind >= 30) {
      return {
        status: 'poor',
        detail: 'High-elevation mixing and strong winds — ducting unlikely (model estimate).',
      };
    }
    return {
      status: 'nominal',
      detail: 'High-elevation site; 850 mb profile less diagnostic (model estimate).',
    };
  }

  const deltaF = t850F - surfaceF;
  if (deltaF >= 4 && wind < 25 && gust < 30) {
    return {
      status: 'ducting_likely',
      detail: `Surface ${Math.round(surfaceF)}°F cooler than 850 mb (${Math.round(t850F)}°F) — inversion (model estimate).`,
    };
  }

  if (gust >= 35 || wind >= 30) {
    return {
      status: 'poor',
      detail: 'Strong winds mix the boundary layer — ducting unlikely (model estimate).',
    };
  }

  if (deltaF >= 1) {
    return {
      status: 'nominal',
      detail: 'Weak stability aloft; VHF/UHF roughly nominal (model estimate).',
    };
  }

  return {
    status: 'nominal',
    detail: 'No strong low-level inversion indicated (model estimate).',
  };
}
