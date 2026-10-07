# explore-vp data

One file per radar and dataset: `<dataset>/dc_<radar>.json.gz`, gzip-compressed JSON
(about 13x smaller than plain JSON; the browser decompresses it in `evp.js`).

- `vp-raw/`: 2018, raw vertical profiles
- `vp-clean/`: 2018, cleaned vertical profiles
- `vp-2019/`: 2019, raw vertical profiles
- `radar_list.json`: radar metadata (location, elevation, scan range, days of data)
- `available.json`: radars that have a data file, per dataset; the radar selector is built from it

Each file holds `name`, `lat`, `lon`, `height` (radar elevation, m a.s.l.), `maxrange` (km),
`alt` (altitude bins, m a.s.l.), `time` (UTC, `YYYY-MM-DD HH:MM`) and `dens`
(bird density in bird/km³, one row per altitude bin, `null` = no data).
Known quirks the viewer handles: 2019 timestamps have trailing spaces and a few
`NaN-NaN-NaN` entries (with no data); some radars mix time resolutions; six Swedish
2018 raw files repeat timestamps (averaged when displayed).

The 2018 profiles are archived at https://doi.org/10.5281/zenodo.3610184.

To add or replace a file: `gzip -9 -n dc_<radar>.json`, then regenerate `available.json`:

```sh
python3 -c "import json,os; json.dump({d: sorted(f[3:-8] for f in os.listdir(d) if f.endswith('.json.gz')) for d in ['vp-raw','vp-clean','vp-2019']}, open('available.json','w'), separators=(',',':'))"
```
