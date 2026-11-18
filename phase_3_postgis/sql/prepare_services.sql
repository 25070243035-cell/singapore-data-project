-- =====================================================================
-- Sonar SG · prepare the `services` table for fast, metre-accurate
-- nearby searches. Run once after phase_3_postgis/scripts/import_services.py:
--
--   psql -U postgres -d singapore_webgis -f phase_3_postgis/sql/prepare_services.sql
--
-- Safe to re-run.
-- =====================================================================

-- 1. Geography column (WGS 84 / EPSG:4326). ST_DWithin / ST_Distance on
--    geography measure true metres on the spheroid, so no projection to
--    SVY21 (EPSG:3414) is needed for distance handling.
ALTER TABLE services
    ADD COLUMN IF NOT EXISTS geog geography(Point, 4326);

UPDATE services
SET geog = geometry::geography
WHERE geog IS NULL;

-- 2. Spatial indexes: geog for the API, geometry for GeoServer WMS/WFS
CREATE INDEX IF NOT EXISTS services_geog_gix
    ON services USING GIST (geog);

CREATE INDEX IF NOT EXISTS services_geometry_gix
    ON services USING GIST (geometry);

-- 3. Attribute index for category / subcategory filtering
CREATE INDEX IF NOT EXISTS services_category_idx
    ON services (category, subcategory);

ANALYZE services;

-- 4. Quick checks
SELECT COUNT(*)                         AS services,
       COUNT(geog)                      AS with_geography,
       Find_SRID('public', 'services', 'geometry') AS geometry_srid
FROM services;

-- Example: the 5 nearest pharmacies to Toa Payoh (1.33521, 103.84616)
SELECT name,
       subcategory,
       ROUND(ST_Distance(geog, ST_SetSRID(ST_MakePoint(103.84616, 1.33521), 4326)::geography)) AS distance_m
FROM services
WHERE subcategory = 'Pharmacy'
ORDER BY geog <-> ST_SetSRID(ST_MakePoint(103.84616, 1.33521), 4326)::geography
LIMIT 5;
