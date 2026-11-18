# Sonar SG: what changed

## Files

| File | Status | What it does |
|---|---|---|
| `webgis/index.html` | rewritten | Intro, header pill, search dock, filter and results cards, mobile bottom sheet, layers panel, help modal, tour |
| `webgis/css/style.css` | rewritten | Dark and light tokens, glass panels, every animation, responsive layouts for desktop, tablet and mobile, reduced-motion support |
| `webgis/js/app.js` | rewritten | All app logic (same API contract: `lat, lon, radius, category, subcategory, mode, limit`) |
| `webgis/js/icons.js` | new | Lucide icon paths, inlined so the markers work offline |
| `webgis/js/sg-regions.js` | new | Simplified URA planning-region boundaries for the study-area overlay |
| `backend/app.py` | edited | `/api/services` now also returns `opening_hours` and `source`. New `/api/categories` endpoint returns live category and type counts |
| `phase_3_postgis/sql/prepare_services.sql` | new | Adds the `geog` geography column and the GiST and attribute indexes. Safe to re-run |
| `geoserver/sonar_services.sld` | new | Category-coloured WMS style that matches the app's legend |

## Run it

```bash
# 1. database (once, after import_services.py)
psql -U postgres -d singapore_webgis -f phase_3_postgis/sql/prepare_services.sql

# 2. API
cd backend && python app.py                # http://127.0.0.1:5000

# 3. frontend (serve it; browser GPS needs http://localhost or https)
cd webgis && python -m http.server 8000    # open http://localhost:8000
```

GeoServer: upload `geoserver/sonar_services.sld` as the style `sonar_services` and set it as the default style of `singapore_webgis:services`.

## Bug fixed

Library and Place of Worship are stored under **Recreation** in PostGIS, but the old dropdown listed them under Education and Public Services. Those searches always came back empty. The chips now match the database, and when `/api/categories` is reachable they are built from the live table.
