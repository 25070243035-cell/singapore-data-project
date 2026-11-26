
from flask import Flask, request, jsonify
from flask_cors import CORS
import psycopg2
from psycopg2.extras import RealDictCursor
import os
import math
import re
from urllib.parse import urlsplit, unquote, parse_qs

app = Flask(__name__)
CORS(app)

# ---------------------------------------------------------------------------
# Database configuration
#
# Render Postgres (and Neon / Supabase / Heroku) expose a single connection
# string as DATABASE_URL. That takes priority. For local development the
# individual PG* variables are used instead, so `python app.py` keeps working
# against a laptop Postgres with no environment setup at all.
# ---------------------------------------------------------------------------
DATABASE_URL = os.getenv("DATABASE_URL")

DB_CONFIG = {
    "host": os.getenv("PGHOST", "localhost"),
    "port": os.getenv("PGPORT", "5432"),
    "dbname": os.getenv("PGDATABASE", "singapore_webgis"),
    "user": os.getenv("PGUSER", "postgres"),
    "password": os.getenv("PGPASSWORD"),
}

# Managed providers require TLS. Render's *internal* hostname does not, so
# sslmode is only forced for host names that are reachable from outside.
PGSSLMODE = os.getenv("PGSSLMODE")
if PGSSLMODE:
    DB_CONFIG["sslmode"] = PGSSLMODE
elif "." in str(DB_CONFIG["host"]) and DB_CONFIG["host"] not in ("127.0.0.1",):
    DB_CONFIG["sslmode"] = "require"


def url_to_kwargs(url):
    """Turn a postgres:// URL into psycopg2 keyword arguments.

    libpq splits a connection URI at the FIRST "@", so a password
    containing "@" (common in generated Supabase passwords) leaves the
    tail of the password glued to the front of the host name and the
    lookup fails with "could not translate host name". Python's urlsplit
    splits at the LAST "@" instead, which recovers the right host whether
    or not the password was percent-encoded.
    """
    parts = urlsplit(url)

    if parts.scheme not in ("postgres", "postgresql"):
        raise ValueError("DATABASE_URL must start with postgresql://")
    if not parts.hostname:
        raise ValueError("DATABASE_URL has no host name")

    kwargs = {"host": parts.hostname}

    if parts.port:
        kwargs["port"] = parts.port
    if parts.username:
        kwargs["user"] = unquote(parts.username)
    if parts.password:
        kwargs["password"] = unquote(parts.password)

    dbname = parts.path.lstrip("/")
    if dbname:
        kwargs["dbname"] = unquote(dbname)

    # Keep anything else the provider put in the query string, e.g. sslmode.
    for key, values in parse_qs(parts.query).items():
        if values:
            kwargs.setdefault(key, values[0])

    # Managed Postgres requires TLS. Render's internal hostname has no dot
    # and speaks plain TCP inside their network, so leave that one alone.
    local = parts.hostname in ("localhost", "127.0.0.1", "::1")
    if "sslmode" not in kwargs and "." in parts.hostname and not local:
        kwargs["sslmode"] = "require"

    return kwargs


def connect():
    """Open a new connection using whichever configuration is available."""
    if DATABASE_URL:
        return psycopg2.connect(**url_to_kwargs(DATABASE_URL))

    return psycopg2.connect(**DB_CONFIG)


def db_source():
    """Human-readable description of the active config, with no secrets."""
    if DATABASE_URL:
        return "DATABASE_URL"
    return "PG* variables (host=%s, db=%s)" % (
        DB_CONFIG["host"], DB_CONFIG["dbname"]
    )


def safe_error(exc):
    """The psycopg2 message, with anything credential-shaped removed.

    Connection errors name the host, port and user, which is exactly what
    makes them useful here. They can also echo back the DSN, so strip the
    password out before this is ever returned over HTTP.
    """
    text = str(exc).strip()

    # postgresql://user:secret@host  ->  postgresql://user:***@host
    text = re.sub(r"(://[^:/\s]+:)[^@/\s]+(@)", r"\1***\2", text)
    # password=secret  ->  password=***
    text = re.sub(r"(password\s*=\s*)\S+", r"\1***", text, flags=re.I)

    return text


@app.get("/")
def index():
    """Render's root URL used to 404 because only /api/* existed."""
    return jsonify({
        "service": "Sonar SG API",
        "status": "running",
        "frontend": "https://25070243035-cell.github.io/singapore-data-project/",
        "endpoints": {
            "GET /api/health": "database connectivity check",
            "GET /api/categories": "category and subcategory counts",
            "GET /api/services": (
                "nearby services; params: lat, lon, radius, category, "
                "subcategory, mode (radius|nearest), limit"
            )
        }
    })


@app.get("/healthz")
def healthz():
    """Cheap liveness probe for Render's health check (no database hit)."""
    return "ok", 200


@app.get("/api/health")
def health():
    # Reaching the server and finding the data are different problems,
    # and saying "could not connect" for a missing table sends you off
    # checking credentials that were never wrong.
    try:
        conn = connect()
    except Exception as exc:
        app.logger.exception("Database connection failed")
        return jsonify({
            "status": "error",
            "database": "unreachable",
            "message": "Could not connect to the database.",
            "config": db_source(),
            "detail": safe_error(exc)
        }), 500

    try:
        with conn.cursor() as cur:
            try:
                cur.execute("SELECT PostGIS_Version();")
                postgis = cur.fetchone()[0]
            except Exception:
                conn.rollback()
                postgis = None

            cur.execute("SELECT to_regclass('public.services');")
            table = cur.fetchone()[0]

            rows = None
            if table is not None:
                cur.execute("SELECT COUNT(*) FROM services;")
                rows = int(cur.fetchone()[0])

    except Exception as exc:
        app.logger.exception("Database query failed")
        return jsonify({
            "status": "error",
            "database": "connected",
            "message": "Connected to the database, but the query failed.",
            "config": db_source(),
            "detail": safe_error(exc)
        }), 500

    finally:
        conn.close()

    if postgis is None:
        return jsonify({
            "status": "error",
            "database": "connected",
            "message": (
                "Connected, but PostGIS is not installed. Run "
                "CREATE EXTENSION postgis; on this database."
            ),
            "config": db_source()
        }), 500

    if table is None:
        return jsonify({
            "status": "error",
            "database": "connected",
            "message": (
                "Connected, but there is no services table. Upload it with "
                "phase_3_postgis/scripts/push_to_render.ps1."
            ),
            "config": db_source(),
            "postgis": postgis
        }), 500

    return jsonify({
        "status": "ok" if rows else "empty",
        "database": "connected",
        "config": db_source(),
        "services_rows": rows,
        "postgis": postgis
    })


@app.get("/api/categories")
def categories():
    """Category → subcategory counts, so the frontend chips always
    match what is actually stored in PostGIS."""
    try:
        conn = connect()

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

        conn = connect()

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
    # Local development only. On Render the app is served by gunicorn.
    port = int(os.environ.get("PORT", 5000))

    app.run(
        host="0.0.0.0",
        port=port,
        debug=False
    )
