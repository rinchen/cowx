# Meteocons (vendored)

Weather icons from [Meteocons](https://meteocons.com/), MIT license (Bas Milius).

Path layout matches the [CDN docs](https://meteocons.com/docs/cdn/):

`{format}/{style}/{slug}.svg` — formats `svg` (animated) and `svg-static`.

Vendored from `https://cdn.meteocons.com/3.0.0-next.10/` (`latest` and `1.0.0` currently 404).
Also includes `barometer` (fill + svg-static) from `@meteocons/svg@3.0.0-next.10` via jsDelivr for the At a Glance pressure metric.
Re-download when upgrading the icon set.
