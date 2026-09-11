# Meteocons (vendored)

Weather icons from [Meteocons](https://meteocons.com/), MIT license (Bas Milius).

Path layout matches the [CDN docs](https://meteocons.com/docs/cdn/):

`{format}/{style}/{slug}.svg` — formats `svg` (animated) and `svg-static`.

Vendored from `https://cdn.meteocons.com/3.0.0-next.10/` (`latest` and `1.0.0` currently 404).
Also includes At a Glance metric glyphs (`barometer`, `humidity`, `uv-index`, `thermometer-water`, `umbrella`, `raindrop`, `cloudy`) and moon-phase glyphs (`moon-new`, `moon-waxing-crescent`, `moon-first-quarter`, `moon-waxing-gibbous`, `moon-full`, `moon-waning-gibbous`, `moon-last-quarter`, `moon-waning-crescent`) from `@meteocons/svg@3.0.0-next.10` via CDN.
Re-download when upgrading the icon set.
