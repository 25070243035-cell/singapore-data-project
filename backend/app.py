
from flask import Flask, request, jsonify
from flask_cors import CORS
import psycopg2
from psycopg2.extras import RealDictCursor
import os
import math

app = Flask(__name__)
CORS(app)

# Configure database using environment variables.
DB_CONFIG = {
    "host": os.getenv("PGHOST", "localhost"),
    "port": os.getenv("PGPORT", "5432"),
    "dbname": os.getenv("PGDATABASE", "singapore_webgis"),
    "user": os.getenv("PGUSER", "postgres"),
    "password": os.getenv("PGPASSWORD")
}


@app.get("/api/health")
def health():
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        conn.close()

        return jsonify({
            "status": "ok",
            "database": "connected"
        })

    except Exception:
        app.logger.exception("Database health check failed")
        return jsonify({
            "status": "error",
            "message": "Could not connect to the database."
        }), 500


@app.get("/api/categories")
def categories():
    """Category → subcategory counts, so the frontend chips always
    match what is actually stored in PostGIS."""
    try:
        conn = psycopg2.connect(**DB_CONFIG)

        try:
            with conn.cursor(
                cursor_factory=RealDictCursor
            ) as cur:
                cur.execute("""
                    SELECT category, subcategory, COUNT(*) AS count
                    FROM services
                    GROUP BY category, subcategory
                    ORDER BY category, subcategory;
                """)
                rows = cur.fetchall()
        finally:
            conn.close()

        return jsonify({
            "total": sum(int(r["count"]) for r in rows),
            "categories": [
                {
                    "category": r["category"],
                    "subcategory": r["subcategory"],
                    "count": int(r["count"])
                }
                for r in rows
            ]
        })

    except Exception:
        app.logger.exception("Category query failed")
        return jsonify({
            "error": "Could not load service categories."
        }), 500


@app.get("/api/services")
def nearby_services():
    try:
        # Required and optional request parameters
        lat = float(request.args["lat"])
        lon = float(request.args["lon"])
        radius = float(request.args.get("radius", 1000))
        category = request.args.get("category", "All")
        subcategory = request.args.get("subcategory", "All")
        limit = int(request.args.get("limit", 100))
        mode = request.args.get("mode", "radius").lower()

        # Validate numeric values
        if not all(map(math.isfinite, [lat, lon, radius])):
            return jsonify({
                "error": "Coordinates and radius must be finite."
            }), 400

        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return jsonify({
                "error": "Invalid coordinates."
            }), 400

        # Restrict searches to Singapore
        if not (1.15 <= lat <= 1.48 and 103.6 <= lon <= 104.1):
            return jsonify({
                "error": "Choose a location in Singapore."
            }), 400

        if not (0 < radius <= 10000):
            return jsonify({
                "error": "Radius must be between 1 and 10000 metres."
            }), 400

        if not (1 <= limit <= 100):
            return jsonify({
                "error": "Limit must be between 1 and 100."
            }), 400

        if mode not in ("radius", "nearest"):
            return jsonify({
                "error": "Mode must be 'radius' or 'nearest'."
            }), 400

        # Radius mode filters by distance.
        # Nearest mode searches all services and returns the closest N.
        if mode == "radius":
            spatial_filter = """
                ST_DWithin(
                    geog,
                    ST_SetSRID(
                        ST_MakePoint(%s, %s), 4326
                    )::geography,
                    %s
                )
            """
            spatial_params = (lon, lat, radius)

        else:
            spatial_filter = "TRUE"
            spatial_params = ()

        # Calculate distances in metres using PostGIS geography.
        sql = f"""
            SELECT
                service_id,
                name,
                category,
                subcategory,
                address,
                postcode,
                phone,
                website,
                opening_hours,
                source,
                ST_Y(geometry) AS latitude,
                ST_X(geometry) AS longitude,
                ST_Distance(
                    geog,
                    ST_SetSRID(
                        ST_MakePoint(%s, %s), 4326
                    )::geography
                ) AS distance_m
            FROM services
            WHERE {spatial_filter}
              AND (%s = 'All' OR category = %s)
              AND (%s = 'All' OR subcategory = %s)
            ORDER BY distance_m ASC
            LIMIT %s;
        """

        params = (
            lon, lat,  # Distance calculation
            *spatial_params,
            category, category,
            subcategory, subcategory,
            limit
        )

        conn = psycopg2.connect(**DB_CONFIG)

        try:
            with conn.cursor(
                cursor_factory=RealDictCursor
            ) as cur:
                cur.execute(sql, params)
                rows = cur.fetchall()
        finally:
            conn.close()

        # Convert database results into JSON-compatible dictionaries.
        results = []

        for row in rows:
            item = dict(row)
            item["distance_m"] = round(
                float(item["distance_m"]), 2
            )
            results.append(item)

        return jsonify({
            "count": len(results),
            "search": {
                "latitude": lat,
                "longitude": lon,
                "mode": mode,
                "radius_m": radius,
                "limit": limit,
                "category": category,
                "subcategory": subcategory
            },
            "results": results
        })

    except (KeyError, ValueError):
        return jsonify({
            "error": (
                "Provide valid latitude and longitude values, "
                "and valid numeric radius and limit parameters."
            )
        }), 400

    except Exception:
        app.logger.exception("Nearby services query failed")
        return jsonify({
            "error": (
                "The nearby services query failed. "
                "Check the API terminal."
            )
        }), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))

    app.run(
        host="0.0.0.0",
        port=port,
        debug=False
    )
