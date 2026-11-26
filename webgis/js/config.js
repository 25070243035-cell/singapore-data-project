/* ==========================================================================
   Sonar SG · deployment configuration

   This is the only file to edit when the API or GeoServer moves. app.js reads
   these values and falls back to localhost when the page is opened locally,
   so local development needs no changes here.
   ========================================================================== */
(function () {
    "use strict";

    const host = location.hostname;
    const isLocal =
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "" ||              // file:// 
        host.endsWith(".local");

    // Live Flask API on Render. Keep the trailing "/api".
    const REMOTE_API = "https://singapore-data-project.onrender.com/api";

    // Local Flask from `python backend/app.py`.
    const LOCAL_API = "http://127.0.0.1:5000/api";

    window.SONAR_CONFIG = {
        apiBase: isLocal ? LOCAL_API : REMOTE_API,

        // GeoServer is only ever run locally for this project, so the WMS
        // overlays are disabled on the published site instead of failing.
        geoserverWms: isLocal
            ? "http://localhost:8080/geoserver/singapore_webgis/wms"
            : null,

        isLocal: isLocal,

        // Render's free plan suspends idle services; the first request after
        // a sleep can take ~50 s while the container cold-starts.
        coldStart: !isLocal
    };
}());
