/* ==========================================================================
   Sonar SG · Ping the city
   Nearby Services WebGIS for Singapore (Leaflet frontend)

   Talks to:
     - Flask + PostGIS API   GET /api/services   (lat, lon, radius, category,
                                                   subcategory, mode, limit)
                             GET /api/health, GET /api/categories (optional)
     - GeoServer WMS         singapore_webgis:services (+ CQL_FILTER per category)
     - OneMap Search API     address / postal-code autocomplete (no key needed)
     - Nominatim (OSM)       fallback geocoder + reverse geocoding for map clicks
   ========================================================================== */
(function () {
    "use strict";

    /* ------------------------------------------------------------------ config */
    const API_BASE = "http://127.0.0.1:5000/api";
    const API_URL = API_BASE + "/services";
    const GEOSERVER_WMS = "http://localhost:8080/geoserver/singapore_webgis/wms";
    const WMS_LAYER = "singapore_webgis:services";

    // Same study-area box the Flask API enforces
    const SG = { minLat: 1.15, maxLat: 1.48, minLon: 103.6, maxLon: 104.1 };
    const SG_CENTER = [1.3521, 103.8198];
    const SAMPLE_SPOT = { lat: 1.335210, lon: 103.846163, label: "Toa Payoh Towers", sub: "310145 · sample location" };

    const RADII = [500, 1000, 2000, 5000, 10000];
    const SEARCH_TIMEOUT_MS = 15000;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mqDesktop = window.matchMedia("(min-width: 1024px)");
    const mqMobile = window.matchMedia("(max-width: 639px)");

    /* One mapping drives chips, markers, popups, cards and the legend.
       Category → subcategory matches the PostGIS `services` table
       (data/processed/final/singapore_services.geojson). */
    const CATEGORIES = {
        "Healthcare":      { icon: "heart-pulse",    key: "healthcare", types: { "CHAS Clinic": "stethoscope", "Hospital": "hospital", "Pharmacy": "pill" } },
        "Food":            { icon: "utensils",       key: "food",       types: { "Cafe": "coffee", "Hawker Centre": "soup", "Restaurant": "utensils-crossed" } },
        "Transport":       { icon: "bus",            key: "transport",  types: { "Bus Stop": "bus", "MRT Station Exit": "train-front" } },
        "Education":       { icon: "graduation-cap", key: "education",  types: { "School": "school", "University": "graduation-cap" } },
        "Public Services": { icon: "shield",         key: "public",     types: { "Fire Station": "flame", "Police Station": "shield-check" } },
        "Commercial":      { icon: "store",          key: "commercial", types: { "ATM": "banknote", "Bank": "landmark", "Fuel Station": "fuel", "Hotel": "bed-double", "Shopping Mall": "shopping-bag", "Supermarket": "shopping-cart" } },
        "Recreation":      { icon: "trees",          key: "recreation", types: { "Gym": "dumbbell", "Library": "book-open", "Park": "trees", "Place of Worship": "church" } }
    };

    // Feature counts from the final dataset; replaced by /api/categories when available
    let TAXONOMY = {
        "Healthcare": { "CHAS Clinic": 1192, "Hospital": 15, "Pharmacy": 151 },
        "Food": { "Cafe": 1753, "Hawker Centre": 129, "Restaurant": 4165 },
        "Transport": { "Bus Stop": 5161, "MRT Station Exit": 613 },
        "Education": { "School": 334, "University": 5 },
        "Public Services": { "Fire Station": 16, "Police Station": 97 },
        "Commercial": { "ATM": 912, "Bank": 269, "Fuel Station": 16, "Hotel": 305, "Shopping Mall": 6, "Supermarket": 546 },
        "Recreation": { "Gym": 236, "Library": 40, "Park": 458, "Place of Worship": 68 }
    };

    const BASEMAPS = {
        osm: {
            name: "OpenStreetMap",
            url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            opts: { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
            thumb: "https://tile.openstreetmap.org/12/3229/2032.png"
        },
        /*
        light: {
            name: "CARTO Light",
            url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
            opts: { subdomains: "abcd", maxZoom: 20, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>' },
            thumb: "https://a.basemaps.cartocdn.com/light_all/12/3229/2032.png"
        },
        dark: {
            name: "CARTO Dark",
            url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
            opts: { subdomains: "abcd", maxZoom: 20, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>' },
            thumb: "https://a.basemaps.cartocdn.com/dark_all/12/3229/2032.png"
        },*/
                esriLight: {
            name: "Light Gray",
            url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
            opts: { maxZoom: 19, maxNativeZoom: 16, attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, OpenStreetMap contributors" },
            thumb: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/12/2032/3229"
        },
        esriDark: {
            name: "Dark Gray",
            url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
            opts: { maxZoom: 19, maxNativeZoom: 16, attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, OpenStreetMap contributors" },
            thumb: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/12/2032/3229"
        },
        onemap: {
            name: "OneMap SG",
            url: "https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png",
            opts: { maxZoom: 19, minNativeZoom: 11, bounds: [[1.144, 103.535], [1.494, 104.502]], attribution: '<img src="https://www.onemap.gov.sg/web-assets/images/logo/om_logo.png" style="height:16px;width:16px;" alt=""> <a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener noreferrer">OneMap</a> &copy; contributors | <a href="https://www.sla.gov.sg/" target="_blank" rel="noopener noreferrer">Singapore Land Authority</a>' },
            thumb: "https://www.onemap.gov.sg/maps/tiles/Default/12/3229/2032.png"
        },
        onemapNight: {
            name: "OneMap Night",
            url: "https://www.onemap.gov.sg/maps/tiles/Night/{z}/{x}/{y}.png",
            opts: { maxZoom: 19, minNativeZoom: 11, bounds: [[1.144, 103.535], [1.494, 104.502]], attribution: '<img src="https://www.onemap.gov.sg/web-assets/images/logo/om_logo.png" style="height:16px;width:16px;" alt=""> <a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener noreferrer">OneMap</a> &copy; contributors | <a href="https://www.sla.gov.sg/" target="_blank" rel="noopener noreferrer">Singapore Land Authority</a>' },
            thumb: "https://www.onemap.gov.sg/maps/tiles/Night/12/3229/2032.png"
        },
        satellite: {
            name: "Satellite",
            url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            opts: { maxZoom: 19, attribution: "Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics, GIS User Community" },
            thumb: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/12/2032/3229"
        }
    };

    /* ------------------------------------------------------------------ helpers */
    const $ = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
    const ICONS = window.SONAR_ICONS || {};
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

    function svg(name) {
        const p = ICONS[name] || ICONS["map-pin"];
        return '<svg class="lucide lucide-' + name + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + p + "</svg>";
    }

    function hydrateIcons(root) {
        $$("[data-icon]", root).forEach((el) => {
            if (!el.querySelector("svg")) el.insertAdjacentHTML("afterbegin", svg(el.dataset.icon));
        });
    }

    function esc(v) {
        return String(v == null ? "" : v)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function store(key, value) {
        try {
            if (value === undefined) return localStorage.getItem("sonar." + key);
            if (value === null) localStorage.removeItem("sonar." + key);
            else localStorage.setItem("sonar." + key, value);
        } catch (e) { /* storage blocked: fine */ }
        return null;
    }

    function fmtDist(m) {
        m = Number(m);
        if (!Number.isFinite(m)) return "–";
        if (m < 1000) return Math.round(m) + " m";
        return (m / 1000).toFixed(m < 10000 ? 2 : 1) + " km";
    }
    const fmtRadius = (m) => (m < 1000 ? m + " m" : m / 1000 + " km");
    const fmtNum = (n) => Number(n).toLocaleString("en-SG");
    const fmtCoord = (lat, lon) => lat.toFixed(5) + ", " + lon.toFixed(5);

    function inSingapore(lat, lon) {
        return lat >= SG.minLat && lat <= SG.maxLat && lon >= SG.minLon && lon <= SG.maxLon;
    }

    function iconFor(cat, sub) {
        const c = CATEGORIES[cat];
        if (!c) return "map-pin";
        return (c.types && c.types[sub]) || c.icon;
    }

    // scroll a child into view inside ONE scroll container (never the overflow:hidden panels)
    function scrollWithin(container, node, block, smooth) {
        if (!container || !node) return;
        const c = container.getBoundingClientRect();
        const r = node.getBoundingClientRect();
        let delta = 0;
        if (block === "center") delta = r.top + r.height / 2 - (c.top + c.height / 2);
        else if (r.top < c.top + 8) delta = r.top - c.top - 8;
        else if (r.bottom > c.bottom - 8) delta = r.bottom - c.bottom + 8;
        if (delta) container.scrollBy({ top: delta, behavior: smooth && !reduceMotion ? "smooth" : "auto" });
    }

    function cssVar(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    function titleCase(s) {
        const keep = /^(MRT|LRT|HDB|NTUC|CHAS|SG|NUS|NTU|SMU|SUTD|SIT|ITE|BLK|CPF|ICA|MOE|SAFRA|YMCA|UOB|OCBC|DBS|POSB|ATM|II|III|IV)$/;
        return String(s || "").toLowerCase().replace(/\b([a-z])([a-z'’]*)/g, (w, a, b) => {
            const up = w.toUpperCase();
            return keep.test(up) ? up : a.toUpperCase() + b;
        });
    }

    // CHAS / LTA records are often ALL CAPS: show them in title case
    function pretty(v) {
        const s = String(v == null ? "" : v).trim();
        return /[a-z]/.test(s) || !/[A-Z]/.test(s) ? s : titleCase(s);
    }

    function animateNumber(el, to, ms) {
        to = Number(to) || 0;
        if (reduceMotion || !ms) { el.textContent = fmtNum(to); return; }
        const start = performance.now();
        const from = 0;
        function tick(now) {
            const t = clamp((now - start) / ms, 0, 1);
            const e = 1 - Math.pow(1 - t, 3);
            el.textContent = fmtNum(Math.round(from + (to - from) * e));
            if (t < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    /* ------------------------------------------------------------------ state */
    const state = {
        location: null,          // { lat, lon, label, sub, source }
        category: "All",
        subcategory: "All",
        mode: "radius",
        radiusIdx: 1,
        limit: 100,
        results: [],             // last results, distance order, with .rank and ._key
        lastSearch: null,        // the search the results belong to
        stale: false,
        sortBy: "distance",
        activeKey: null,
        basemap: null,
        basemapManual: false,
        searchSeq: 0,
        ctrl: null,
        introDone: false,
        view: "idle"             // idle | loading | results | empty | error
    };

    /* ------------------------------------------------------------------ DOM */
    const el = {
        body: document.body,
        intro: $("#intro"),
        brandActions: $("#brandActions"),
        mobileActions: $("#mobileActions"),
        searchDock: $("#searchDock"),
        searchBar: $("#searchBar"),
        placeInput: $("#placeInput"),
        placeClear: $("#placeClear"),
        suggestions: $("#suggestions"),
        gpsBtn: $("#gpsBtn"),
        coordBtn: $("#coordBtn"),
        findBtn: $("#findBtn"),
        coordPopover: $("#coordPopover"),
        latInput: $("#latInput"),
        lonInput: $("#lonInput"),
        latErr: $("#latErr"),
        lonErr: $("#lonErr"),
        toast: $("#toast"),
        filterCard: $("#filterCard"),
        filterBody: $("#filterBody"),
        resultsCard: $("#resultsCard"),
        resultsBody: $("#resultsBody"),
        resultsTitleWrap: $(".results-title-wrap"),
        resultsSub: $("#resultsSub"),
        resultsToolbar: $("#resultsToolbar"),
        resultsList: $("#resultsList"),
        locChip: $("#locChip"),
        categoryChips: $("#categoryChips"),
        typeChips: $("#typeChips"),
        typeHint: $("#typeHint"),
        radiusRange: $("#radiusRange"),
        radiusOut: $("#radiusOut"),
        radiusWrap: $("#radiusWrap"),
        radiusNote: $("#radiusNote"),
        limitLabel: $("#limitLabel"),
        scanBtn: $("#scanBtn"),
        scanWrap: $("#scanWrap"),
        sortSelect: $("#sortSelect"),
        sheet: $("#sheet"),
        layersPanel: $("#layersPanel"),
        layersBtn: $("#layersBtn"),
        helpModal: $("#helpModal"),
        apiBanner: $("#apiBanner")
    };

    hydrateIcons(document);

    /* ================================================================== MAP */
    const map = L.map("map", {
        center: [1.345, 103.83],
        zoom: 12,
        minZoom: 10,
        maxZoom: 19,
        zoomControl: false,
        maxBounds: [[0.9, 103.25], [1.8, 104.45]],
        maxBoundsViscosity: 0.85,
        zoomSnap: 0.25,
        wheelPxPerZoomLevel: 90
    });

    let baseLayer = null;

    function setBasemap(id, opts) {
        opts = opts || {};
        if (!BASEMAPS[id]) id = "esriDark";
        if (state.basemap === id && baseLayer) return;
        const def = BASEMAPS[id];
        const next = L.tileLayer(def.url, Object.assign({ crossOrigin: true }, def.opts));
        const prev = baseLayer;
        next.addTo(map);
        next.bringToBack();
        if (prev) {
            // cross-fade: keep the old layer until the new one has drawn
            const done = () => { if (map.hasLayer(prev)) map.removeLayer(prev); };
            next.once("load", done);
            setTimeout(done, 1500);
        }
        baseLayer = next;
        state.basemap = id;
        if (opts.manual) {
            state.basemapManual = true;
            store("basemap", id);
        }
        const radio = $('#basemapGrid input[value="' + id + '"]');
        if (radio) radio.checked = true;
        $("#basemapNote").textContent = state.basemapManual
            ? "Your pick is kept across visits."
            : "Follows the theme until you pick one.";
    }

    function themeBasemap() {
        return currentTheme() === "dark" ? "oneMapNight" : "osm";
    }

    const savedBasemap = store("basemap");
    if (savedBasemap && BASEMAPS[savedBasemap]) {
        state.basemapManual = true;
        setBasemap(savedBasemap);
    } else {
        setBasemap(themeBasemap());
    }

    // ---- overlays
    function makeWms(extra) {
        const layer = L.tileLayer.wms(GEOSERVER_WMS, Object.assign({
            layers: WMS_LAYER,
            format: "image/png",
            transparent: true,
            version: "1.1.1",
            attribution: "Singapore Services | GeoServer"
        }, extra || {}));
        layer.on("tileerror", geoserverError);
        return layer;
    }

    let geoserverWarned = false;
    function geoserverError() {
        if (geoserverWarned) return;
        geoserverWarned = true;
        toast("error", "GeoServer isn't responding at localhost:8080. Start GeoServer to see WMS layers.");
    }

    const servicesWMS = makeWms();
    const categoryWMS = {};
    function getCategoryWms(cat) {
        if (!categoryWMS[cat]) {
            categoryWMS[cat] = makeWms({ CQL_FILTER: "category='" + cat.replace(/'/g, "''") + "'" });
        }
        return categoryWMS[cat];
    }

    const resultsCluster = L.markerClusterGroup({
        maxClusterRadius: 42,
        disableClusteringAtZoom: 17,
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        animate: !reduceMotion,
        iconCreateFunction: clusterIcon
    }).addTo(map);

    let heatLayer = null;
    let regionsLayer = null;

    function buildRegions() {
        if (!window.SG_REGIONS) return null;
        const group = L.layerGroup();
        const geo = L.geoJSON(window.SG_REGIONS, {
            interactive: false,
            style: () => ({
                color: cssVar("--primary"),
                weight: 1.2,
                opacity: 0.55,
                dashArray: "4 6",
                fillColor: cssVar("--primary"),
                fillOpacity: 0.025
            })
        });
        group.addLayer(geo);
        geo.eachLayer((lyr) => {
            // label at the centre of the largest polygon
            let best = null, bestArea = 0;
            const latlngs = lyr.getLatLngs();
            (Array.isArray(latlngs[0][0]) ? latlngs : [latlngs]).forEach((poly) => {
                const b = L.latLngBounds(poly[0]);
                const a = (b.getNorth() - b.getSouth()) * (b.getEast() - b.getWest());
                if (a > bestArea) { bestArea = a; best = b; }
            });
            if (best) {
                group.addLayer(L.marker(best.getCenter(), {
                    interactive: false,
                    keyboard: false,
                    icon: L.divIcon({ className: "region-label", html: esc(lyr.feature.properties.region.replace(" Region", "")), iconSize: [120, 14], iconAnchor: [60, 7] })
                }));
            }
        });
        group._geo = geo;
        return group;
    }

    function restyleRegions() {
        if (regionsLayer && regionsLayer._geo) {
            regionsLayer._geo.setStyle({ color: cssVar("--primary"), fillColor: cssVar("--primary") });
        }
    }

    regionsLayer = buildRegions();
    if (regionsLayer) regionsLayer.addTo(map);

        // ---- dim everything outside Singapore
    let maskLayer = null;

    function buildMask() {
        const src = window.SG_REGIONS;
        if (!src) return null;
        if (!map.getPane("maskPane")) {
            const pane = map.createPane("maskPane");
            pane.style.zIndex = 350;          // above tiles, below outlines/markers
            pane.style.pointerEvents = "none";
        }
        const world = [[-85, -180], [-85, 180], [85, 180], [85, -180]];
        const holes = [];
        (src.features || []).forEach((f) => {
            const g = f.geometry;
            if (!g) return;
            const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
            polys.forEach((p) => holes.push(p[0].map((c) => [c[1], c[0]]))); // outer ring, [lng,lat] → [lat,lng]
        });
        return L.polygon([world].concat(holes), {
            pane: "maskPane",
            stroke: false,
            fillColor: cssVar("--bg"),
            fillOpacity: 0.72,
            interactive: false
        });
    }

    maskLayer = buildMask();
    if (maskLayer) maskLayer.addTo(map);

    map.on("zoomend", () => {
        map.getContainer().classList.toggle("hide-region-labels", map.getZoom() > 13);
    });

    // ---- controls (bottom corners stack upwards in insertion order)
    L.control.scale({ position: "bottomleft", metric: true, imperial: false, maxWidth: 140 }).addTo(map);

    const CoordReadout = L.Control.extend({
        options: { position: "bottomleft" },
        onAdd: function () {
            const div = L.DomUtil.create("div", "map-ctl coord-readout");
            div.setAttribute("aria-hidden", "true");
            const show = (ll) => { div.innerHTML = "<b>" + ll.lat.toFixed(5) + "</b>, <b>" + ll.lng.toFixed(5) + "</b>"; };
            show(map.getCenter());
            map.on("mousemove", (e) => show(e.latlng));
            map.on("moveend", () => show(map.getCenter()));
            return div;
        }
    });
    new CoordReadout().addTo(map);

    const Legend = L.Control.extend({
        options: { position: "bottomleft" },
        onAdd: function () {
            const div = L.DomUtil.create("div", "map-ctl legend");
            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);
            const rows = Object.keys(CATEGORIES).map((cat) =>
                '<li data-cat="' + esc(cat) + '" data-legend="' + esc(cat) + '"><span class="lg-sw">' + svg(CATEGORIES[cat].icon) + '</span>' + esc(cat) + '<span class="lg-count"></span></li>'
            ).join("");
            div.innerHTML =
                '<button type="button" class="legend-head" aria-expanded="true">Legend' + svg("chevron-down") + "</button>" +
                '<div class="legend-body"><div><ul>' + rows +
                '<li class="lg-me"><span class="lg-sw"></span>You are here</li>' +
                '<li class="lg-ring"><span class="lg-sw"></span>Search area</li>' +
                "</ul></div></div>";
            const head = div.querySelector(".legend-head");
            const collapsed = store("legend") === "collapsed" || (store("legend") == null && mqMobile.matches);
            div.classList.toggle("is-collapsed", collapsed);
            head.setAttribute("aria-expanded", String(!collapsed));
            head.addEventListener("click", () => {
                const c = div.classList.toggle("is-collapsed");
                head.setAttribute("aria-expanded", String(!c));
                store("legend", c ? "collapsed" : "open");
            });
            return div;
        }
    });
    const legend = new Legend().addTo(map);
    let legendAutoCollapsed = false;
    function autoCollapseLegend() {
        // first results: tuck the legend away so it doesn't hide markers (unless the user chose)
        if (legendAutoCollapsed || store("legend") != null) return;
        legendAutoCollapsed = true;
        const div = legend.getContainer();
        div.classList.add("is-collapsed");
        div.querySelector(".legend-head").setAttribute("aria-expanded", "false");
    }

    const ZoomBar = L.Control.extend({
        options: { position: "bottomright" },
        onAdd: function () {
            const div = L.DomUtil.create("div", "leaflet-bar");
            const btn = (icon, label, fn) => {
                const a = L.DomUtil.create("a", "", div);
                a.href = "#";
                a.setAttribute("role", "button");
                a.setAttribute("aria-label", label);
                a.dataset.tip = label;
                a.innerHTML = svg(icon);
                L.DomEvent.on(a, "click", (e) => { L.DomEvent.preventDefault(e); fn(); });
            };
            btn("plus-fallback", "Zoom in", () => map.zoomIn());
            btn("minus-fallback", "Zoom out", () => map.zoomOut());
            btn("house", "Show all of Singapore", () => map.flyToBounds([[SG.minLat + 0.09, SG.minLon + 0.02], [SG.maxLat - 0.02, SG.maxLon - 0.06]], fitOpts({ maxZoom: 12 })));
            btn("locate", "Go to my search location", () => {
                if (state.location) map.flyTo([state.location.lat, state.location.lon], Math.max(map.getZoom(), 15), { duration: 0.8 });
                else toast("info", "No location yet. Search, use GPS or tap the map.");
            });
            L.DomEvent.disableClickPropagation(div);
            // plus / minus glyphs (not part of the icon subset)
            const links = div.querySelectorAll("a");
            links[0].innerHTML = '<svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
            links[1].innerHTML = '<svg class="lucide" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>';
            return div;
        }
    });
    new ZoomBar().addTo(map);

    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');

    /* ---------------------------------------------------- insets & fitting */
    function updateInsets() {
        const root = document.documentElement.style;
        const gap = mqMobile.matches ? 10 : (mqDesktop.matches ? 16 : 12);
        let left = 0, right = 0, bottom = 0;
        const fCollapsed = el.filterCard.classList.contains("is-collapsed");
        const rCollapsed = el.resultsCard.classList.contains("is-collapsed");

        if (mqMobile.matches) {
            bottom = el.sheet.getBoundingClientRect().height || 160;
        } else if (mqDesktop.matches) {
            left = gap + (fCollapsed ? 64 : 328);
            right = gap + (rCollapsed ? 64 : 372);
        } else {
            left = gap + (fCollapsed ? 64 : 340);
            const drawer = rCollapsed ? 60 : Math.min(window.innerHeight * 0.42, 420);
            bottom = gap + drawer;
            root.setProperty("--drawer-h", drawer + "px");
        }
        root.setProperty("--inset-left", left + "px");
        root.setProperty("--inset-right", right + "px");
        root.setProperty("--inset-bottom", bottom + "px");

        const top = mqMobile.matches ? 76 : 96;
        L.Popup.prototype.options.autoPanPaddingTopLeft = L.point(left + 16, top);
        L.Popup.prototype.options.autoPanPaddingBottomRight = L.point(right + 16, bottom + 16);
        el.body.classList.toggle("left-collapsed", fCollapsed);
        el.body.classList.toggle("right-collapsed", rCollapsed);
    }

    function fitOpts(extra) {
        const cs = getComputedStyle(document.documentElement);
        const l = parseFloat(cs.getPropertyValue("--inset-left")) || 0;
        const r = parseFloat(cs.getPropertyValue("--inset-right")) || 0;
        const b = parseFloat(cs.getPropertyValue("--inset-bottom")) || 0;
        const top = mqMobile.matches ? 80 : 110;
        return Object.assign({
            paddingTopLeft: [l + 24, top],
            paddingBottomRight: [r + 24, b + 24],
            duration: reduceMotion ? 0 : 0.9,
            maxZoom: 17
        }, extra || {});
    }

    /* ================================================================== THEME */
    function currentTheme() { return document.documentElement.dataset.theme === "light" ? "light" : "dark"; }

    function setTheme(theme, animate) {
        const apply = () => {
            document.documentElement.dataset.theme = theme;
            if (!state.basemapManual) setBasemap(themeBasemap());
            restyleMapGraphics();
        };
        if (animate && document.startViewTransition && !reduceMotion) {
            document.startViewTransition(apply);
        } else if (animate) {
            document.documentElement.classList.add("theme-fade");
            apply();
            setTimeout(() => document.documentElement.classList.remove("theme-fade"), 420);
        } else {
            apply();
        }
        $("#themeBtn").setAttribute("aria-label", theme === "dark" ? "Switch to light theme (T)" : "Switch to dark theme (T)");
    }

    $("#themeBtn").addEventListener("click", () => {
        const next = currentTheme() === "dark" ? "light" : "dark";
        store("theme", next);
        setTheme(next, true);
    });

    // follow the OS setting until the user picks a theme
    const mqLight = window.matchMedia("(prefers-color-scheme: light)");
    (mqLight.addEventListener ? mqLight.addEventListener.bind(mqLight, "change") : mqLight.addListener.bind(mqLight))(() => {
        if (!store("theme")) setTheme(mqLight.matches ? "light" : "dark", true);
    });

    /* ================================================================== TOAST */
    let toastTimer = null;

    function toast(type, message, opts) {
        opts = opts || {};
        const t = el.toast;
        clearTimeout(toastTimer);
        t.classList.remove("is-leaving");
        t.hidden = false;
        t.dataset.type = type;
        const iconEl = t.querySelector(".toast-icon");
        iconEl.innerHTML = type === "success" ? svg("check") : type === "error" ? "!" : type === "info" ? svg("info") : "";
        t.querySelector(".toast-msg").textContent = message;
        const action = t.querySelector(".toast-action");
        if (opts.action) {
            action.hidden = false;
            action.textContent = opts.action.label;
            action.onclick = () => { hideToast(); opts.action.run(); };
        } else {
            action.hidden = true;
            action.onclick = null;
        }
        // restart the entry animation
        t.style.animation = "none";
        void t.offsetWidth;
        t.style.animation = "";
        const hold = opts.hold != null ? opts.hold : (type === "loading" ? 0 : type === "error" ? 8000 : 5000);
        if (hold) toastTimer = setTimeout(hideToast, hold);
    }

    function hideToast() {
        const t = el.toast;
        if (t.hidden) return;
        t.classList.add("is-leaving");
        setTimeout(() => { t.hidden = true; t.classList.remove("is-leaving"); }, 300);
    }
    el.toast.querySelector(".toast-close").addEventListener("click", hideToast);

    /* ================================================================ TOOLTIP */
    const tipEl = document.createElement("div");
    tipEl.className = "tooltip";
    tipEl.setAttribute("role", "tooltip");
    document.body.appendChild(tipEl);
    let tipTarget = null, tipHideTimer = null;

    function showTip(target) {
        const text = target.dataset.tip;
        if (!text) return;
        tipTarget = target;
        tipEl.textContent = text;
        tipEl.classList.add("is-on");
        const r = target.getBoundingClientRect();
        const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
        let top = r.top - th - 10;
        if (top < 8) top = r.bottom + 10;
        const left = clamp(r.left + r.width / 2 - tw / 2, 8, window.innerWidth - tw - 8);
        tipEl.style.left = left + "px";
        tipEl.style.top = top + "px";
    }
    function hideTip() { tipTarget = null; tipEl.classList.remove("is-on"); }

    document.addEventListener("pointerover", (e) => {
        if (e.pointerType !== "mouse") return;
        const t = e.target.closest("[data-tip]");
        if (t && t !== tipTarget) showTip(t);
        else if (!t && tipTarget) hideTip();
    });
    document.addEventListener("pointerdown", (e) => {
        hideTip();
        // touch: tap an ⓘ to read it
        const tip = e.target.closest(".tip[data-tip]");
        if (tip && e.pointerType !== "mouse") {
            showTip(tip);
            clearTimeout(tipHideTimer);
            tipHideTimer = setTimeout(hideTip, 2800);
        }
    });
    document.addEventListener("focusin", (e) => {
        const t = e.target.closest && e.target.closest("[data-tip]");
        if (t && t.matches(":focus-visible")) showTip(t);
    });
    document.addEventListener("focusout", hideTip);
    window.addEventListener("scroll", hideTip, true);

    /* ================================================================= RIPPLE */
    if (!reduceMotion) {
        document.addEventListener("pointerdown", (e) => {
            const b = e.target.closest(".btn, .icon-btn, .rail-btn");
            if (!b || b.getAttribute("aria-disabled") === "true") return;
            const r = b.getBoundingClientRect();
            const s = Math.max(r.width, r.height);
            const span = document.createElement("span");
            span.className = "ripple";
            span.style.width = span.style.height = s + "px";
            span.style.left = e.clientX - r.left - s / 2 + "px";
            span.style.top = e.clientY - r.top - s / 2 + "px";
            b.appendChild(span);
            setTimeout(() => span.remove(), 650);
        });
    }

    /* ============================================================== LOCATION */
    let meMarker = null;
    let ring = null;

    function meIcon() {
        return L.divIcon({
            className: "me-pin",
            html: '<span class="me-pulse"></span><span class="me-pulse p2"></span><span class="me-dot"></span>',
            iconSize: [26, 26],
            iconAnchor: [13, 13],
            popupAnchor: [0, -14]
        });
    }

    function ringStyle(nearest) {
        return {
            color: cssVar("--primary"),
            weight: 2,
            opacity: 0.9,
            fillColor: cssVar("--primary"),
            fillOpacity: nearest ? 0.035 : 0.06,
            dashArray: nearest ? "8 8" : null,
            className: "search-ring" + (nearest ? " is-dashed" : ""),
            interactive: false
        };
    }

    function drawRing(radius, nearest) {
        if (!state.location) return;
        const ll = [state.location.lat, state.location.lon];
        if (ring) map.removeLayer(ring);
        ring = L.circle(ll, Object.assign({ radius: radius }, ringStyle(nearest)));
        if (overlayOn("ring")) ring.addTo(map);
    }

        function restyleMapGraphics() {
        if (ring) ring.setStyle({ color: cssVar("--primary"), fillColor: cssVar("--primary") });
        if (maskLayer) maskLayer.setStyle({ fillColor: cssVar("--bg") });
        restyleRegions();
    }

    function tapFeedback(latlng) {
        if (reduceMotion) return;
        const m = L.marker(latlng, {
            interactive: false,
            keyboard: false,
            icon: L.divIcon({ className: "tap-pin", html: "<span></span>", iconSize: [60, 60], iconAnchor: [30, 30] })
        }).addTo(map);
        setTimeout(() => map.removeLayer(m), 650);
    }

    /**
     * Accept a new search location. A rejected location never replaces
     * (or clears) the previous one: the old pin stays clearly labelled.
     */
    function setLocation(lat, lon, info) {
        info = info || {};
        lat = Number(lat);
        lon = Number(lon);
        const fail = (msg, opts) => (info.onError ? info.onError(msg) : toast("error", msg, opts));

        if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
            fail("Invalid coordinates. Latitude must be between −90 and 90, longitude between −180 and 180." + keptMsg());
            return false;
        }
        if (!inSingapore(lat, lon)) {
            fail("Outside Singapore (" + fmtCoord(lat, lon) + "). Choose a point between 1.15–1.48 N and 103.6–104.1 E." + keptMsg(), {
                action: state.location ? null : { label: "Try a sample spot", run: useSampleSpot }
            });
            return false;
        }

        const hadResults = state.results.length > 0 && !!state.lastSearch;
        state.location = {
            lat: lat,
            lon: lon,
            label: info.label || (info.source === "coordinates" ? "Custom coordinates" : "Dropped pin"),
            sub: info.sub || null,
            source: info.source || "map"
        };

        // you-are-here marker (recreated so the drop animation replays)
        if (meMarker) map.removeLayer(meMarker);
        meMarker = L.marker([lat, lon], { icon: meIcon(), zIndexOffset: 3000, draggable: true, keyboard: true, title: "Search location (drag to adjust)" })
            .addTo(map)
            .bindPopup(() => mePopup());
        meMarker.on("dragend", (e) => {
            const ll = e.target.getLatLng();
            if (!setLocation(ll.lat, ll.lng, { source: "drag" })) {
                // snap back to the previous valid location
                e.target.setLatLng([state.location.lat, state.location.lon]);
            }
        });

        clearResults({ keepRing: false, silent: true });
        if (state.mode === "radius") drawRing(RADII[state.radiusIdx], false);

        updateLocationUI();
        updateUrl();

        if (info.fly !== false) {
            if (state.mode === "radius" && ring) map.flyToBounds(ring.getBounds(), fitOpts({ maxZoom: 16 }));
            else map.flyTo([lat, lon], Math.max(map.getZoom(), 15), { duration: reduceMotion ? 0 : 0.9 });
        }

        if (!info.silent) {
            toast("success", state.location.label + (state.location.sub ? " · " + state.location.sub : ""));
        }

        if (!info.label) reverseGeocode(lat, lon);

        // keep results in sync with the pin: re-run the last search for the new spot
        if (hadResults && info.autoScan !== false) scan();
        return true;
    }

    function keptMsg() {
        return state.location ? " Kept your previous location (" + state.location.label + ")." : "";
    }

    function useSampleSpot() {
        setLocation(SAMPLE_SPOT.lat, SAMPLE_SPOT.lon, { label: SAMPLE_SPOT.label, sub: SAMPLE_SPOT.sub, source: "sample" });
    }

    function clearLocation() {
        abortSearch();
        state.location = null;
        if (meMarker) { map.removeLayer(meMarker); meMarker = null; }
        if (ring) { map.removeLayer(ring); ring = null; }
        clearResults({ silent: true });
        updateLocationUI();
        updateUrl();
        toast("info", "Location cleared. Search, use GPS or tap the map to set a new one.");
    }

    function mePopup() {
        const l = state.location;
        if (!l) return "";
        return '<div class="pp-me"><strong>' + esc(l.label) + "</strong>" + (l.sub ? "<br><span>" + esc(l.sub) + "</span>" : "") +
            "<br><code>" + fmtCoord(l.lat, l.lon) + "</code><br><small>Drag the pin to fine-tune.</small></div>";
    }

    function updateLocationUI() {
        const l = state.location;
        const chip = el.locChip;
        chip.classList.toggle("is-set", !!l);
        chip.classList.toggle("is-empty", !l);
        $(".loc-name", chip).textContent = l ? l.label : "No location yet";
        $(".loc-coords", chip).textContent = l ? (l.sub ? l.sub + " · " : "") + fmtCoord(l.lat, l.lon) : "Search, use GPS or tap the map";
        $("#locClear").hidden = !l;
        el.body.classList.toggle("has-location", !!l);
        if (l) {
            chip.classList.remove("flash");
            void chip.offsetWidth;
            chip.classList.add("flash");
            el.latInput.value = l.lat.toFixed(6);
            el.lonInput.value = l.lon.toFixed(6);
        }
        updateScanButton();
        if (state.view === "idle") renderIdle();
    }

    function updateScanButton() {
        const ready = !!state.location;
        el.scanBtn.setAttribute("aria-disabled", String(!ready));
        el.scanWrap.dataset.tip = ready ? "" : "Set a location first";
        el.scanBtn.classList.toggle("is-ready", ready && (state.stale || !state.results.length) && !el.scanBtn.classList.contains("is-loading"));
    }

    /* ---- reverse geocoding (Nominatim, ≤ 1 request per second) */
    let lastNominatim = 0;
    let reverseSeq = 0;

    async function nominatimSlot() {
        const wait = lastNominatim + 1100 - Date.now();
        if (wait > 0) await sleep(wait);
        lastNominatim = Date.now();
    }

    async function reverseGeocode(lat, lon) {
        const seq = ++reverseSeq;
        try {
            await nominatimSlot();
            if (seq !== reverseSeq) return;
            const url = "https://nominatim.openstreetmap.org/reverse?" + new URLSearchParams({
                format: "jsonv2", lat: lat, lon: lon, zoom: "17", addressdetails: "1"
            });
            const res = await fetch(url, { headers: { "Accept-Language": "en" } });
            if (!res.ok) return;
            const data = await res.json();
            if (seq !== reverseSeq || !state.location || state.location.lat !== lat || state.location.lon !== lon) return;
            const a = data.address || {};
            const name = data.name || a.amenity || a.building || a.road || a.neighbourhood || a.suburb;
            const area = a.suburb || a.neighbourhood || a.city_district || a.quarter || a.residential || "";
            if (name || area) {
                state.location.label = name || area;
                state.location.sub = [name && area && name !== area ? area : null, a.postcode].filter(Boolean).join(" · ") || null;
                updateLocationUI();
            }
        } catch (e) { /* label stays "Dropped pin" */ }
    }

    /* ---- map click */
    map.on("click", (e) => {
        if (!state.introDone || !$("#tour").hidden) return;
        closeFloating();
        tapFeedback(e.latlng);
        setLocation(e.latlng.lat, e.latlng.lng, { source: "map" });
    });

    /* ---- GPS */
    el.gpsBtn.addEventListener("click", useGps);

    function useGps() {
        if (!("geolocation" in navigator)) {
            toast("error", "This browser can't share your location. Search an address or tap the map instead.");
            return;
        }
        if (!window.isSecureContext) {
            toast("error", "Browser location needs HTTPS or localhost. Open the app from http://localhost, or tap the map instead.");
            return;
        }
        el.gpsBtn.classList.add("is-busy");
        el.gpsBtn.setAttribute("aria-busy", "true");
        toast("loading", "Finding your location…");
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                el.gpsBtn.classList.remove("is-busy");
                el.gpsBtn.removeAttribute("aria-busy");
                const { latitude, longitude, accuracy } = pos.coords;
                if (!inSingapore(latitude, longitude)) {
                    toast("error", "You appear to be outside Singapore (" + fmtCoord(latitude, longitude) + "). Sonar SG only covers Singapore." + keptMsg(), {
                        action: { label: "Try a sample spot", run: useSampleSpot },
                        hold: 10000
                    });
                    return;
                }
                setLocation(latitude, longitude, {
                    label: "My location",
                    sub: "±" + Math.round(accuracy) + " m accuracy",
                    source: "gps"
                });
                reverseGeocodeKeepLabel();
            },
            (err) => {
                el.gpsBtn.classList.remove("is-busy");
                el.gpsBtn.removeAttribute("aria-busy");
                const msg = {
                    1: "Location permission denied. Allow location for this site in your browser settings, or search / tap the map instead.",
                    2: "Your location is unavailable right now. Search an address or tap the map instead.",
                    3: "Getting your location timed out. Try again, or tap the map instead."
                }[err.code] || "Could not get your location.";
                toast("error", msg + keptMsg(), { action: { label: "Search instead", run: () => el.placeInput.focus() } });
            },
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
        );
    }

    // after GPS keep "My location" as the label, but add the area name
    async function reverseGeocodeKeepLabel() {
        const l = state.location;
        if (!l) return;
        const accuracy = l.sub;
        const seq = ++reverseSeq;
        try {
            await nominatimSlot();
            const res = await fetch("https://nominatim.openstreetmap.org/reverse?" + new URLSearchParams({ format: "jsonv2", lat: l.lat, lon: l.lon, zoom: "16", addressdetails: "1" }), { headers: { "Accept-Language": "en" } });
            if (!res.ok || seq !== reverseSeq || state.location !== l) return;
            const a = (await res.json()).address || {};
            const area = a.suburb || a.neighbourhood || a.city_district || a.road;
            if (area) { l.sub = area + " · " + accuracy; updateLocationUI(); }
        } catch (e) { /* ignore */ }
    }

    /* ---- coordinates popover */
    function openCoordPopover(open) {
        const show = open != null ? open : el.coordPopover.hidden;
        closeFloating(show ? "coord" : null);
        el.coordPopover.hidden = !show;
        el.coordBtn.setAttribute("aria-expanded", String(show));
        if (show) {
            el.latErr.textContent = el.lonErr.textContent = coordMsg.textContent = "";
            el.latInput.classList.remove("is-invalid");
            el.lonInput.classList.remove("is-invalid");
            setTimeout(() => el.latInput.focus(), 30);
        }
    }
    el.coordBtn.addEventListener("click", () => openCoordPopover());

    // pasting "1.35, 103.8" into the latitude box fills both fields
    el.latInput.addEventListener("input", () => {
        const m = el.latInput.value.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
        if (m) { el.latInput.value = m[1]; el.lonInput.value = m[2]; el.lonInput.focus(); }
    });

    $("#coordCentre").addEventListener("click", () => {
        const c = map.getCenter();
        el.latInput.value = c.lat.toFixed(6);
        el.lonInput.value = c.lng.toFixed(6);
    });

    const coordMsg = document.createElement("p");
    coordMsg.className = "field-error popover-msg";
    coordMsg.setAttribute("role", "alert");
    el.coordPopover.querySelector(".popover-actions").before(coordMsg);

    function validateCoordField(input, errEl, min, max, name) {
        const raw = input.value.trim();
        let msg = "";
        if (raw === "") msg = "Required";
        else if (!/^-?\d+(\.\d+)?$/.test(raw)) msg = "Enter a decimal number, e.g. " + (name === "Latitude" ? "1.3521" : "103.8198");
        else if (Number(raw) < min || Number(raw) > max) msg = name + " must be between " + min + " and " + max;
        errEl.textContent = msg;
        input.classList.toggle("is-invalid", !!msg);
        return msg ? null : Number(raw);
    }

    el.coordPopover.addEventListener("submit", (e) => {
        e.preventDefault();
        const lat = validateCoordField(el.latInput, el.latErr, -90, 90, "Latitude");
        const lon = validateCoordField(el.lonInput, el.lonErr, -180, 180, "Longitude");
        coordMsg.textContent = "";
        if (lat == null || lon == null) {
            coordMsg.textContent = "Check the highlighted fields." + keptMsg();
            return;
        }
        if (!inSingapore(lat, lon)) {
            if (lat < SG.minLat || lat > SG.maxLat) { el.latErr.textContent = "Singapore is 1.15 to 1.48"; el.latInput.classList.add("is-invalid"); }
            if (lon < SG.minLon || lon > SG.maxLon) { el.lonErr.textContent = "Singapore is 103.6 to 104.1"; el.lonInput.classList.add("is-invalid"); }
        }
        if (setLocation(lat, lon, { source: "coordinates", onError: (m) => { coordMsg.textContent = m; } })) openCoordPopover(false);
    });

    /* ---- address / postal-code search with autocomplete */
    let suggestCtrl = null, suggestTimer = null, suggestItems = [], suggestIdx = -1;

    async function oneMapSearch(q, signal) {
        const url = "https://www.onemap.gov.sg/api/common/elastic/search?" + new URLSearchParams({
            searchVal: q, returnGeom: "Y", getAddrDetails: "Y", pageNum: "1"
        });
        const res = await fetch(url, { signal: signal });
        if (!res.ok) throw new Error("OneMap HTTP " + res.status);
        const data = await res.json();
        return (data.results || []).map((r) => ({
            lat: Number(r.LATITUDE),
            lon: Number(r.LONGITUDE),
            main: titleCase(r.SEARCHVAL),
            sub: titleCase(r.ADDRESS).replace(/\bSingapore (\d{6})$/i, "Singapore $1"),
            postal: r.POSTAL && r.POSTAL !== "NIL" ? r.POSTAL : ""
        })).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
    }

    async function nominatimSearch(q) {
        await nominatimSlot();
        const res = await fetch("https://nominatim.openstreetmap.org/search?" + new URLSearchParams({
            format: "jsonv2", countrycodes: "sg", limit: "5", q: q, addressdetails: "1"
        }), { headers: { "Accept-Language": "en" } });
        if (!res.ok) throw new Error("Nominatim HTTP " + res.status);
        const list = await res.json();
        return list.filter((m) => !m.address || m.address.country_code === "sg").map((m) => ({
            lat: Number(m.lat),
            lon: Number(m.lon),
            main: m.name || m.display_name.split(",")[0],
            sub: m.display_name,
            postal: (m.address && m.address.postcode) || ""
        }));
    }

    function renderSuggestions(items, q) {
        suggestItems = items;
        suggestIdx = -1;
        const ul = el.suggestions;
        if (!items.length) {
            ul.innerHTML = '<li class="sg-empty" role="option" aria-disabled="true">No matches yet. Press Enter to search.</li>';
        } else {
            const rx = q ? new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig") : null;
            const hi = (s) => { const e = esc(s); return rx ? e.replace(rx, "<mark>$1</mark>") : e; };
            ul.innerHTML = items.map((it, i) =>
                '<li role="option" id="sg-' + i + '" aria-selected="false" data-i="' + i + '">' +
                '<span class="sg-ic">' + svg(it.postal && /^\d{6}$/.test(q) ? "map-pin" : "navigation") + "</span>" +
                '<span class="sg-text"><span class="sg-main">' + hi(it.main) + '</span><span class="sg-sub">' + hi(it.sub) + "</span></span></li>"
            ).join("");
        }
        ul.hidden = false;
        el.placeInput.setAttribute("aria-expanded", "true");
    }

    function closeSuggestions() {
        el.suggestions.hidden = true;
        el.placeInput.setAttribute("aria-expanded", "false");
        el.placeInput.removeAttribute("aria-activedescendant");
        suggestIdx = -1;
    }

    function moveSuggestion(dir) {
        if (el.suggestions.hidden || !suggestItems.length) return;
        suggestIdx = (suggestIdx + dir + suggestItems.length) % suggestItems.length;
        $$("li", el.suggestions).forEach((li, i) => li.setAttribute("aria-selected", String(i === suggestIdx)));
        el.placeInput.setAttribute("aria-activedescendant", "sg-" + suggestIdx);
        const li = $("#sg-" + suggestIdx);
        if (li) li.scrollIntoView({ block: "nearest" });
    }

    function pickSuggestion(it) {
        closeSuggestions();
        el.placeInput.value = it.main;
        el.placeClear.hidden = false;
        setLocation(it.lat, it.lon, { label: it.main, sub: it.postal || null, source: "address" });
    }

    el.placeInput.addEventListener("input", () => {
        const q = el.placeInput.value.trim();
        el.placeClear.hidden = !el.placeInput.value;
        clearTimeout(suggestTimer);
        if (suggestCtrl) suggestCtrl.abort();
        if (q.length < 3 || /^-?\d+(\.\d+)?\s*[,;\s]/.test(q)) { closeSuggestions(); return; }
        suggestTimer = setTimeout(async () => {
            suggestCtrl = new AbortController();
            try {
                const items = await oneMapSearch(q, suggestCtrl.signal);
                if (el.placeInput.value.trim() === q) renderSuggestions(items.slice(0, 6), q);
            } catch (e) {
                // OneMap unreachable: no live suggestions (Nominatim forbids autocomplete); Enter still works
                if (e.name !== "AbortError") closeSuggestions();
            }
        }, 280);
    });

    el.placeInput.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); moveSuggestion(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); moveSuggestion(-1); }
        else if (e.key === "Enter") {
            e.preventDefault();
            if (suggestIdx >= 0 && suggestItems[suggestIdx]) pickSuggestion(suggestItems[suggestIdx]);
            else findPlace();
        } else if (e.key === "Escape") {
            if (!el.suggestions.hidden) { e.stopPropagation(); closeSuggestions(); }
        }
    });

    el.suggestions.addEventListener("mousedown", (e) => e.preventDefault());
    el.suggestions.addEventListener("click", (e) => {
        const li = e.target.closest("li[data-i]");
        if (li) pickSuggestion(suggestItems[Number(li.dataset.i)]);
    });
    el.placeInput.addEventListener("blur", () => setTimeout(closeSuggestions, 120));

    el.placeClear.addEventListener("click", () => {
        el.placeInput.value = "";
        el.placeClear.hidden = true;
        closeSuggestions();
        el.placeInput.focus();
    });

    el.findBtn.addEventListener("click", findPlace);

    async function findPlace() {
        const q = el.placeInput.value.trim();
        closeSuggestions();
        if (!q) {
            toast("error", "Type a Singapore address, place name or 6-digit postal code.");
            shakeSearch();
            el.placeInput.focus();
            return;
        }
        // "lat, lon" typed straight into the search bar
        const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
        if (m) { setLocation(Number(m[1]), Number(m[2]), { source: "coordinates" }); return; }
        if (/^\d+$/.test(q) && q.length !== 6) {
            toast("error", "Singapore postal codes have 6 digits (e.g. 310145)." + keptMsg());
            shakeSearch();
            return;
        }

        el.findBtn.disabled = true;
        toast("loading", "Searching for “" + q + "”…");
        try {
            let items = [];
            try {
                items = await oneMapSearch(q);
            } catch (e) {
                items = await nominatimSearch(q);
            }
            if (!items.length) {
                toast("error", "No match for “" + q + "” in Singapore. Check the spelling or try a postal code." + keptMsg());
                shakeSearch();
                return;
            }
            pickSuggestion(items[0]);
        } catch (e) {
            console.error("Address search failed:", e);
            toast("error", "Address search is unavailable right now (network). Try coordinates or tap the map." + keptMsg());
        } finally {
            el.findBtn.disabled = false;
        }
    }

    function shakeSearch() {
        el.searchBar.classList.remove("shake");
        void el.searchBar.offsetWidth;
        el.searchBar.classList.add("shake");
    }

    $("#locEdit").addEventListener("click", () => {
        if (mqMobile.matches) setSheet("peek");
        el.placeInput.focus();
        el.placeInput.select();
    });
    $("#locClear").addEventListener("click", clearLocation);

    /* =============================================================== FILTERS */
    function chipHtml(name, value, group, icon, cat, count, delay, checked) {
        const id = group + "-" + value.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
        return '<input type="radio" name="' + group + '" id="' + id + '" value="' + esc(value) + '"' + (checked ? " checked" : "") + ">" +
            '<label for="' + id + '" class="chip" data-cat="' + esc(cat) + '" style="--d:' + delay + 'ms">' +
            '<span class="chip-ic">' + svg(icon) + "</span>" + esc(name) +
            (count != null ? ' <span class="chip-count">' + fmtNum(count) + "</span>" : "") + "</label>";
    }

    function categoryTotal(cat) {
        return Object.values(TAXONOMY[cat] || {}).reduce((a, b) => a + b, 0);
    }

    function buildCategoryChips() {
        const cats = Object.keys(TAXONOMY);
        const total = cats.reduce((s, c) => s + categoryTotal(c), 0);
        let html = chipHtml("All", "All", "category", "layout-grid", "All", null, 0, state.category === "All");
        cats.forEach((c, i) => {
            html += chipHtml(c, c, "category", (CATEGORIES[c] || {}).icon || "map-pin", c, null, (i + 1) * 35, state.category === c);
        });
        el.categoryChips.innerHTML = html;
        $$("label.chip", el.categoryChips).forEach((lab) => {
            const c = lab.dataset.cat;
            lab.dataset.tip = fmtNum(c === "All" ? total : categoryTotal(c)) + " services";
        });
        updateCatCount();

        // rail icons for the collapsed card
        $("#railCats").innerHTML = cats.map((c) =>
            '<button type="button" class="rail-btn' + (state.category === c ? " is-active" : "") + '" data-cat="' + esc(c) + '" data-rail-cat="' + esc(c) + '" data-tip="' + esc(c) + '" aria-label="' + esc(c) + '" tabindex="-1">' + svg((CATEGORIES[c] || {}).icon) + "</button>"
        ).join("");
    }

    function updateCatCount() {
        const cats = Object.keys(TAXONOMY);
        const n = state.category === "All" ? cats.reduce((s, c) => s + categoryTotal(c), 0)
            : state.subcategory !== "All" ? (TAXONOMY[state.category] || {})[state.subcategory] || 0
            : categoryTotal(state.category);
        $("#catCount").textContent = fmtNum(n) + " in DB";
    }

    function buildTypeChips() {
        const types = state.category === "All" ? [] : Object.keys(TAXONOMY[state.category] || {}).sort();
        el.typeHint.hidden = types.length > 0;
        if (!types.length) { el.typeChips.innerHTML = ""; return; }
        let html = chipHtml("All types", "All", "subcategory", (CATEGORIES[state.category] || {}).icon || "layout-grid", state.category, null, 0, state.subcategory === "All");
        types.forEach((t, i) => {
            html += chipHtml(t, t, "subcategory", iconFor(state.category, t), state.category, TAXONOMY[state.category][t], (i + 1) * 40, state.subcategory === t);
        });
        el.typeChips.innerHTML = html;
    }

    el.categoryChips.addEventListener("change", (e) => {
        state.category = e.target.value;
        state.subcategory = "All";
        buildTypeChips();
        updateCatCount();
        $$("#railCats .rail-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.railCat === state.category));
        updateLegendFocus();
        filtersChanged(true);
    });

    el.typeChips.addEventListener("change", (e) => {
        state.subcategory = e.target.value;
        updateCatCount();
        filtersChanged(true);
    });

    $("#railCats").addEventListener("click", (e) => {
        const b = e.target.closest("[data-rail-cat]");
        if (!b) return;
        const cat = state.category === b.dataset.railCat ? "All" : b.dataset.railCat;
        const radio = $('#categoryChips input[value="' + cat + '"]');
        if (radio) { radio.checked = true; radio.dispatchEvent(new Event("change", { bubbles: true })); }
        toast("info", cat === "All" ? "Showing all categories" : "Category: " + cat, { hold: 1800 });
    });

    // radius slider
    function syncRadiusUI() {
        const r = RADII[state.radiusIdx];
        el.radiusRange.value = state.radiusIdx;
        el.radiusRange.style.setProperty("--fill", (state.radiusIdx / 4) * 100 + "%");
        el.radiusOut.textContent = fmtRadius(r);
        el.radiusRange.setAttribute("aria-valuetext", r < 1000 ? r + " metres" : r / 1000 + " kilometres");
        $$(".range-ticks span").forEach((s, i) => s.classList.toggle("is-on", i === state.radiusIdx));
    }

    el.radiusRange.addEventListener("input", () => {
        state.radiusIdx = Number(el.radiusRange.value);
        syncRadiusUI();
        if (state.location && state.mode === "radius") {
            if (ring && !ring.options.dashArray) ring.setRadius(RADII[state.radiusIdx]);
            else drawRing(RADII[state.radiusIdx], false);
        }
    });
    el.radiusRange.addEventListener("change", () => {
        if (state.location && state.mode === "radius" && ring) map.flyToBounds(ring.getBounds(), fitOpts({ maxZoom: 16, duration: reduceMotion ? 0 : 0.6 }));
        filtersChanged(false);
    });

    // search type
    function syncModeUI() {
        const nearest = state.mode === "nearest";
        $("#modeRadius").checked = !nearest;
        $("#modeNearest").checked = nearest;
        el.radiusRange.disabled = nearest;
        el.radiusWrap.classList.toggle("is-disabled", nearest);
        el.radiusWrap.dataset.tip = nearest ? "Radius isn't used in Nearest N mode" : "";
        el.radiusNote.hidden = !nearest;
        el.radiusOut.style.opacity = nearest ? ".4" : "";
        el.limitLabel.textContent = nearest ? "How many nearest?" : "Maximum results";
    }

    $$('input[name="mode"]').forEach((r) => r.addEventListener("change", () => {
        state.mode = r.value;
        syncModeUI();
        if (state.location) {
            if (state.mode === "radius") drawRing(RADII[state.radiusIdx], false);
            else if (ring && !state.results.length) { map.removeLayer(ring); ring = null; }
        }
        filtersChanged(false);
    }));

    $$('input[name="limit"]').forEach((r) => r.addEventListener("change", () => {
        state.limit = Number(r.value);
        filtersChanged(false);
    }));

    function syncLimitUI() {
        const r = $('input[name="limit"][value="' + state.limit + '"]');
        if (r) r.checked = true;
    }

    /**
     * Category/type changes clear the old results (they no longer match).
     * Radius/mode/limit changes keep them visible but mark them as stale.
     * The location is never touched.
     */
    function filtersChanged(clear) {
        updateUrl();
        if (!state.results.length && !state.lastSearch) { updateScanButton(); return; }
        if (clear) {
            clearResults({ silent: true, keepRing: state.mode === "radius" });
            if (state.location) {
                renderIdle("Filters changed", "Press Scan nearby to search for " + searchLabel().toLowerCase() + ".");
            }
        } else {
            markStale();
        }
        updateScanButton();
    }

    function markStale() {
        if (!state.results.length) return;
        state.stale = true;
        el.resultsList.classList.add("is-stale");
        if (!$(".stale-banner", el.resultsBody)) {
            const div = document.createElement("div");
            div.className = "stale-banner";
            div.innerHTML = svg("info") + "<span>Search settings changed.</span>";
            const b = document.createElement("button");
            b.type = "button";
            b.className = "btn btn-primary btn-xs";
            b.textContent = "Scan again";
            b.addEventListener("click", () => scan());
            div.appendChild(b);
            el.resultsBody.insertBefore(div, el.resultsList);
        }
        updateScanButton();
    }

    function clearStale() {
        state.stale = false;
        el.resultsList.classList.remove("is-stale");
        const b = $(".stale-banner", el.resultsBody);
        if (b) b.remove();
    }

    $("#resetBtn").addEventListener("click", () => {
        state.category = "All";
        state.subcategory = "All";
        state.mode = "radius";
        state.radiusIdx = 1;
        state.limit = 100;
        buildCategoryChips();
        buildTypeChips();
        syncRadiusUI();
        syncModeUI();
        syncLimitUI();
        updateLegendFocus();
        clearResults({ silent: true });
        if (state.location) drawRing(RADII[state.radiusIdx], false);
        updateUrl();
        toast("info", "Filters reset. Your location was kept.", { hold: 2500 });
    });

    function searchLabel() {
        if (state.subcategory !== "All") return state.subcategory + (/(s|h)$/i.test(state.subcategory) ? "es" : "s");
        if (state.category !== "All") return state.category + " services";
        return "All services";
    }

    /* ================================================================== SCAN */
    el.scanBtn.addEventListener("click", () => scan());
    $("[data-rail-scan]").addEventListener("click", () => scan());

    function abortSearch() {
        if (state.ctrl) { state.ctrl.abort(); state.ctrl = null; }
        stopRipples(true);
        setScanning(false);
    }

    function setScanning(on) {
        el.body.classList.toggle("is-scanning", on);
        el.scanBtn.classList.toggle("is-loading", on);
        $(".scan-label", el.scanBtn).textContent = on ? "Scanning…" : "Scan nearby ✦";
        el.resultsList.setAttribute("aria-busy", String(on));
        updateScanButton();
    }

    let ripple = null;
    function startRipples() {
        stopRipples(true);
        if (reduceMotion || !state.location) return;
        const lat = state.location.lat;
        const mpp = 40075016.686 * Math.cos(lat * Math.PI / 180) / Math.pow(2, map.getZoom() + 8);
        const px = state.mode === "radius" ? clamp(RADII[state.radiusIdx] / mpp, 60, 900) : 220;
        const size = Math.round(px * 2);
        ripple = L.marker([lat, state.location.lon], {
            interactive: false,
            keyboard: false,
            zIndexOffset: -500,
            icon: L.divIcon({ className: "ripple-pin", html: '<span class="sweep"></span><span class="rp"></span><span class="rp"></span><span class="rp"></span>', iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
        }).addTo(map);
    }
    function stopRipples(now) {
        if (!ripple) return;
        const r = ripple;
        ripple = null;
        if (now) { map.removeLayer(r); return; }
        const node = r.getElement();
        if (node) node.classList.add("is-done");
        setTimeout(() => map.removeLayer(r), 1400);
    }

    async function scan() {
        if (!state.location) {
            toast("error", "Set a location first: search an address, use GPS, enter coordinates or tap the map.");
            shakeSearch();
            if (mqMobile.matches) setSheet("peek");
            if (!mqMobile.matches) el.placeInput.focus();
            return;
        }

        // cancel any in-flight request so a slow response can't overwrite a newer one
        if (state.ctrl) state.ctrl.abort();
        const ctrl = new AbortController();
        state.ctrl = ctrl;
        const seq = ++state.searchSeq;
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, SEARCH_TIMEOUT_MS);

        const search = {
            lat: state.location.lat,
            lon: state.location.lon,
            radius: RADII[state.radiusIdx],
            category: state.category,
            subcategory: state.subcategory,
            mode: state.mode,
            limit: state.limit
        };

        clearStale();
        setScanning(true);
        renderLoading();
        clearMarkers();
        if (state.mode === "radius") drawRing(search.radius, false);
        startRipples();
        if (mqMobile.matches) { switchSheetTab("results"); if (sheetState === "peek") setSheet("half"); }

        const params = new URLSearchParams({
            lat: search.lat.toFixed(6),
            lon: search.lon.toFixed(6),
            radius: String(search.radius),
            category: search.category,
            subcategory: search.subcategory,
            mode: search.mode,
            limit: String(search.limit)
        });

        try {
            const [res] = await Promise.all([
                fetch(API_URL + "?" + params.toString(), { signal: ctrl.signal }),
                sleep(reduceMotion ? 0 : 700) // let the radar sweep read as a scan
            ]);
            let data = null;
            try { data = await res.json(); } catch (e) { throw apiError("bad-json", "The server returned an invalid response."); }
            if (!res.ok) {
                throw apiError(res.status >= 500 ? "server" : "input", (data && data.error) || "Search failed (HTTP " + res.status + ").");
            }
            if (!data || !Array.isArray(data.results)) throw apiError("bad-json", "The server response has an unexpected format.");
            if (seq !== state.searchSeq) return;

            const results = data.results
                .filter((s) => Number.isFinite(Number(s.latitude)) && Number.isFinite(Number(s.longitude)) && inSingapore(Number(s.latitude), Number(s.longitude)))
                .map((s) => Object.assign({}, s, { latitude: Number(s.latitude), longitude: Number(s.longitude), distance_m: Number(s.distance_m) }))
                .sort((a, b) => a.distance_m - b.distance_m);
            results.forEach((s, i) => { s.rank = i + 1; s._key = String(s.service_id != null ? s.service_id : i); });

            hideApiBanner();
            state.results = results;
            state.lastSearch = search;
            state.activeKey = null;
            showResults();
            updateUrl(true);
        } catch (err) {
            if (seq !== state.searchSeq) return;               // superseded by a newer search
            if (err.name === "AbortError" && !timedOut) return; // cancelled on purpose
            console.error("Nearby services error:", err);
            let title = "Search failed", msg = err.message, kind = err.kind;
            if (timedOut) { title = "The search took too long"; msg = "The API didn't answer within " + SEARCH_TIMEOUT_MS / 1000 + " s. Check the Flask terminal, then retry."; }
            else if (err instanceof TypeError || kind === undefined) {
                title = "Can't reach the search API";
                msg = "Sonar SG couldn't connect to " + API_BASE + ". Start the Flask server (python backend/app.py) and retry.";
                showApiBanner("Can't reach the search API at " + API_BASE.replace(/^https?:\/\//, "") + ".");
            } else if (kind === "server") {
                title = "The database query failed";
                msg = err.message + " Check that PostgreSQL is running.";
            } else if (kind === "input") {
                title = "The API rejected the search";
            }
            state.results = [];
            renderError(title, msg);
            stopRipples(true);
        } finally {
            clearTimeout(timer);
            if (seq === state.searchSeq) {
                state.ctrl = null;
                setScanning(false);
                stopRipples(false);
            }
        }
    }

    function apiError(kind, message) {
        const e = new Error(message);
        e.kind = kind;
        return e;
    }

    /* =============================================================== RESULTS */
    const markersByKey = new Map();

    function clearMarkers() {
        resultsCluster.clearLayers();
        markersByKey.clear();
        if (heatLayer) heatLayer.setLatLngs([]);
        map.closePopup();
    }

    function clearResults(opts) {
        opts = opts || {};
        abortSearch();
        state.results = [];
        state.lastSearch = null;
        state.activeKey = null;
        clearStale();
        clearMarkers();
        if (!opts.keepRing && ring && state.mode === "nearest") { map.removeLayer(ring); ring = null; }
        if (ring && ring.options.dashArray && state.mode === "radius") drawRing(RADII[state.radiusIdx], false);
        el.resultsToolbar.hidden = true;
        updateCounts();
        updateLegendCounts();
        renderIdle();
        updateUrl();
    }

    $("#clearBtn").addEventListener("click", () => {
        clearResults();
        toast("info", "Results cleared. Your location and filters were kept.", { hold: 2500 });
    });

    function updateCounts(n) {
        const tabCount = $("#tabCount");
        $("#railCount").textContent = n || 0;
        tabCount.hidden = !n;
        tabCount.textContent = n || 0;
    }

    function stateBlock(kind, icon, title, text, actions) {
        const div = document.createElement("div");
        div.className = "state" + (kind === "error" ? " is-error" : "");
        div.innerHTML = '<div class="state-art">' + svg(icon) + "</div><h3>" + esc(title) + "</h3><p>" + esc(text) + "</p>";
        if (actions && actions.length) {
            const wrap = document.createElement("div");
            wrap.className = "state-actions";
            actions.forEach((a) => {
                const b = document.createElement("button");
                b.type = "button";
                b.className = "btn btn-sm " + (a.primary ? "btn-primary" : "btn-ghost");
                b.innerHTML = (a.icon ? svg(a.icon) : "") + esc(a.label);
                b.addEventListener("click", a.run);
                wrap.appendChild(b);
            });
            div.appendChild(wrap);
        }
        return div;
    }

    function renderIdle(title, text) {
        state.view = "idle";
        el.resultsToolbar.hidden = true;
        el.resultsList.replaceChildren();
        if (state.location) {
            el.resultsSub.textContent = "Ready to scan near " + state.location.label + ".";
            el.resultsList.appendChild(stateBlock("idle", "radar", title || "Ready when you are",
                text || "Pick a category if you like, then press Scan nearby to search around " + state.location.label + ".",
                [{ label: "Scan nearby", icon: "radar", primary: true, run: () => scan() }]));
        } else {
            el.resultsSub.textContent = "Set a location, then scan.";
            el.resultsList.appendChild(stateBlock("idle", "map-pin", "No search yet",
                "Search an address or postal code, use your location, enter coordinates, or tap anywhere on the map.",
                [{ label: "Use my location", icon: "locate-fixed", run: useGps }, { label: "Sample spot", icon: "map-pin", run: useSampleSpot }]));
        }
    }

    function renderLoading() {
        state.view = "loading";
        el.resultsToolbar.hidden = true;
        el.resultsSub.innerHTML = "Scanning for <strong>" + esc(searchLabel().toLowerCase()) + "</strong>…";
        const frag = document.createDocumentFragment();
        for (let i = 0; i < 6; i++) {
            const s = document.createElement("div");
            s.className = "skeleton";
            s.style.setProperty("--d", i * 60 + "ms");
            frag.appendChild(s);
        }
        el.resultsList.replaceChildren(frag);
    }

    function renderError(title, msg) {
        state.view = "error";
        el.resultsToolbar.hidden = true;
        el.resultsSub.textContent = "Search could not be completed.";
        el.resultsList.replaceChildren(stateBlock("error", "triangle-alert", title, msg, [{ label: "Retry", icon: "rotate-ccw", primary: true, run: () => scan() }]));
        updateCounts(0);
        if (mqMobile.matches) switchSheetTab("results");
    }

    function renderEmpty() {
        state.view = "empty";
        const s = state.lastSearch;
        const what = searchLabel().toLowerCase();
        const actions = [];
        let text;
        if (s.mode === "radius") {
            text = "Nothing within " + fmtRadius(s.radius) + " of " + state.location.label + ".";
            const next = RADII.findIndex((r) => r > s.radius);
            if (next !== -1) {
                actions.push({ label: "Try " + fmtRadius(RADII[next]), icon: "radar", primary: true, run: () => { state.radiusIdx = next; syncRadiusUI(); scan(); } });
            }
            actions.push({ label: "Nearest " + Math.min(state.limit, 10) + " instead", icon: "list", primary: next === -1, run: () => { state.mode = "nearest"; if (state.limit > 10) { state.limit = 10; syncLimitUI(); } syncModeUI(); scan(); } });
        } else {
            text = "The database has no " + what + ". Try another service type.";
        }
        if (state.category !== "All") actions.push({ label: "All categories", icon: "layout-grid", run: () => { const r = $('#categoryChips input[value="All"]'); r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); scan(); } });
        el.resultsList.replaceChildren(stateBlock("empty", "scan-search", "No " + what + " found", text, actions));
    }

    function showResults() {
        const s = state.lastSearch;
        const res = state.results;
        el.resultsToolbar.hidden = res.length === 0;
        updateCounts(res.length);
        updateLegendCounts();

        // the ring: fixed radius, or stretched to the farthest result in Nearest-N mode
        if (s.mode === "radius") {
            drawRing(s.radius, false);
        } else if (res.length) {
            drawRing(Math.max(res[res.length - 1].distance_m * 1.03, 60), true);
        }

        if (!res.length) {
            el.resultsSub.innerHTML = "<strong>0</strong> places found";
            renderEmpty();
            if (ring) map.flyToBounds(ring.getBounds(), fitOpts({ maxZoom: 16 }));
            return;
        }

        const nearest = res[0].distance_m;
        const farthest = res[res.length - 1].distance_m;
        el.resultsSub.innerHTML = '<span class="count-num">0</span> ' + (res.length === 1 ? "place" : "places") + " found · " +
            (s.mode === "radius" ? "nearest " + fmtDist(nearest) : "farthest " + fmtDist(farthest));
        animateNumber($(".count-num", el.resultsSub), res.length, 700);

        state.view = "results";
        renderMarkers();
        renderList(true);
        autoCollapseLegend();

        const bounds = ring ? ring.getBounds() : L.latLngBounds(res.map((r) => [r.latitude, r.longitude]));
        map.flyToBounds(bounds, fitOpts({ maxZoom: 17 }));

        if (heatLayer && map.hasLayer(heatLayer)) heatLayer.setLatLngs(res.map((r) => [r.latitude, r.longitude, 0.8]));
        if (mqMobile.matches) switchSheetTab("results");
    }

    function sortedResults() {
        const list = state.results.slice();
        if (state.sortBy === "name") list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
        else if (state.sortBy === "type") list.sort((a, b) => String(a.subcategory).localeCompare(String(b.subcategory)) || a.distance_m - b.distance_m);
        return list;
    }

    function renderList(animate) {
        const s = state.lastSearch;
        const maxD = s.mode === "radius" ? s.radius : Math.max(state.results[state.results.length - 1].distance_m, 1);
        const frag = document.createDocumentFragment();
        sortedResults().forEach((r, i) => frag.appendChild(resultCard(r, animate ? Math.min(i, 20) * 45 : 0, maxD)));
        el.resultsList.replaceChildren(frag);
        el.resultsList.scrollTop = 0;
        if (state.activeKey) markActiveCard(state.activeKey, false);
    }

    el.sortSelect.addEventListener("change", () => {
        state.sortBy = el.sortSelect.value;
        if (state.results.length) renderList(true);
    });

    function websiteUrl(w) {
        if (!w) return null;
        w = String(w).trim().split(/[;\s]+/)[0];
        if (/^https?:\/\//i.test(w)) return w;
        if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(w)) return "https://" + w;
        return null;
    }

    function directionsUrl(r) {
        const o = state.location;
        return "https://www.google.com/maps/dir/?api=1" +
            (o ? "&origin=" + o.lat.toFixed(6) + "," + o.lon.toFixed(6) : "") +
            "&destination=" + r.latitude.toFixed(6) + "," + r.longitude.toFixed(6) + "&travelmode=walking";
    }

    function addressLine(r) {
        const parts = [pretty(r.address), r.postcode && !String(r.address || "").includes(r.postcode) ? "Singapore " + r.postcode : null].filter(Boolean);
        return parts.join(", ");
    }

    function resultCard(r, delay, maxD) {
        const card = document.createElement("div");
        card.className = "rc";
        card.setAttribute("role", "listitem");
        card.dataset.key = r._key;
        card.dataset.cat = r.category;
        card.style.setProperty("--d", delay + "ms");

        const addr = addressLine(r);
        const pct = clamp((r.distance_m / maxD) * 100, 3, 100);
        const web = websiteUrl(r.website);
        const phone = r.phone ? String(r.phone).split(/[;,]/)[0].trim() : null;
        const detailsId = "rcd-" + r._key;

        card.innerHTML =
            '<button type="button" class="rc-main">' +
                '<span class="rc-ic">' + svg(iconFor(r.category, r.subcategory)) + '<span class="rc-rank">' + r.rank + "</span></span>" +
                '<span class="rc-body">' +
                    '<span class="rc-name">' + esc(pretty(r.name) || "Unnamed " + (r.subcategory || "service")) + "</span>" +
                    '<span class="rc-meta"><span class="rc-type">' + esc(r.subcategory || "") + "</span> · " + esc(r.category || "") + "</span>" +
                    '<span class="rc-dist"><strong>' + fmtDist(r.distance_m) + '</strong><span class="rc-bar"><i style="--w:' + pct.toFixed(1) + '%"></i></span></span>' +
                    (addr ? '<span class="rc-addr">' + esc(addr) + "</span>" : "") +
                "</span>" +
            "</button>" +
            '<button type="button" class="icon-btn icon-btn-sm rc-expand" aria-expanded="false" aria-controls="' + detailsId + '" aria-label="More details for ' + esc(pretty(r.name) || "this place") + '">' + svg("chevron-down") + "</button>" +
            '<div class="rc-details" id="' + detailsId + '"><div>' +
                '<dl class="rc-dl">' +
                    (addr ? "<div><dt>" + svg("map-pin") + '<span class="sr-only">Address</span></dt><dd>' + esc(addr) + "</dd></div>" : "") +
                    "<div><dt>" + svg("phone") + '<span class="sr-only">Phone</span></dt><dd>' + (phone ? '<a href="tel:' + esc(phone.replace(/[^\d+]/g, "")) + '">' + esc(r.phone) + "</a>" : '<span class="muted">No phone listed</span>') + "</dd></div>" +
                    "<div><dt>" + svg("globe") + '<span class="sr-only">Website</span></dt><dd>' + (web ? '<a href="' + esc(web) + '" target="_blank" rel="noopener noreferrer">' + esc(web.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")) + "</a>" : '<span class="muted">No website listed</span>') + "</dd></div>" +
                    "<div><dt>" + svg("clock") + '<span class="sr-only">Opening hours</span></dt><dd>' + (r.opening_hours ? esc(r.opening_hours) : '<span class="muted">Opening hours not listed</span>') + "</dd></div>" +
                    "<div><dt>" + svg("info") + '<span class="sr-only">Source</span></dt><dd><span class="muted">' + esc(r.source ? "Source: " + r.source : "Service ID " + (r.service_id != null ? r.service_id : "–")) + " · " + r.latitude.toFixed(5) + ", " + r.longitude.toFixed(5) + "</span></dd></div>" +
                "</dl>" +
                '<div class="rc-actions">' +
                    '<a class="btn btn-primary btn-xs" href="' + esc(directionsUrl(r)) + '" target="_blank" rel="noopener noreferrer">' + svg("route") + " Directions ↗</a>" +
                    (phone ? '<a class="btn btn-ghost btn-xs" href="tel:' + esc(phone.replace(/[^\d+]/g, "")) + '">' + svg("phone") + " Call</a>" : "") +
                    '<button type="button" class="btn btn-ghost btn-xs" data-copy>' + svg("copy") + " Copy coordinates</button>" +
                "</div>" +
            "</div></div>";

        $(".rc-main", card).addEventListener("click", () => selectResult(r._key, { source: "list" }));
        const exp = $(".rc-expand", card);
        exp.addEventListener("click", () => {
            const open = exp.getAttribute("aria-expanded") !== "true";
            exp.setAttribute("aria-expanded", String(open));
            $(".rc-details", card).classList.toggle("is-open", open);
        });
        $("[data-copy]", card).addEventListener("click", () => copyText(r.latitude.toFixed(6) + ", " + r.longitude.toFixed(6), "Coordinates copied"));
        return card;
    }

    /* ---- markers */
    function pinIcon(r, delay) {
        return L.divIcon({
            className: "svc-pin",
            html: '<div class="pin-wrap' + (delay != null ? " anim" : "") + '" data-cat="' + esc(r.category) + '"' + (delay != null ? ' style="--d:' + delay + 'ms"' : ' style="animation:none"') + ">" +
                '<span class="pin-halo"></span><span class="pin-body"></span><span class="pin-ic">' + svg(iconFor(r.category, r.subcategory)) + "</span>" +
                '<span class="pin-rank">' + r.rank + "</span></div>",
            iconSize: [34, 42],
            iconAnchor: [17, 38],
            popupAnchor: [0, -36]
        });
    }

    function clusterIcon(cluster) {
        const kids = cluster.getAllChildMarkers();
        const counts = {};
        kids.forEach((m) => { const c = m.options.svcCategory; counts[c] = (counts[c] || 0) + 1; });
        let acc = 0;
        const stops = Object.keys(counts).map((c) => {
            const from = (acc / kids.length) * 100;
            acc += counts[c];
            const to = (acc / kids.length) * 100;
            const key = (CATEGORIES[c] || {}).key || "all";
            return "var(--cd-" + key + ") " + from.toFixed(1) + "% " + to.toFixed(1) + "%";
        });
        return L.divIcon({
            className: "svc-cluster",
            html: '<div class="cl" style="--ring:conic-gradient(' + stops.join(",") + ')"><span>' + kids.length + "</span></div>",
            iconSize: [46, 46]
        });
    }

    function renderMarkers() {
        clearMarkers();
        const markers = state.results.map((r) => {
            const m = L.marker([r.latitude, r.longitude], {
                icon: pinIcon(r, reduceMotion ? null : Math.min(r.rank - 1, 30) * 45),
                title: pretty(r.name) || r.subcategory,
                alt: pretty(r.name) || r.subcategory,
                riseOnHover: true,
                svcCategory: r.category
            });
            m.bindPopup(() => popupHtml(r), { maxWidth: 300, minWidth: 260, className: "svc-popup" });
            m.on("click", () => selectResult(r._key, { source: "map" }));
            m.on("add", () => syncMarkerClass(m, r._key));
            markersByKey.set(r._key, m);
            return m;
        });
        resultsCluster.addLayers(markers);
        // after the pop-in, swap to static icons so zooming/clustering doesn't replay it
        if (!reduceMotion) {
            const seq = state.searchSeq;
            setTimeout(() => {
                if (seq !== state.searchSeq) return;
                state.results.forEach((r) => { const m = markersByKey.get(r._key); if (m) m.setIcon(pinIcon(r, null)); });
                if (state.activeKey) syncAllMarkerClasses();
            }, 2400);
        }
    }

    function syncMarkerClass(m, key) {
        const node = m.getElement();
        if (node) node.classList.toggle("is-selected", key === state.activeKey);
    }
    function syncAllMarkerClasses() {
        markersByKey.forEach((m, key) => syncMarkerClass(m, key));
    }

    function popupHtml(r) {
        const addr = addressLine(r);
        const web = websiteUrl(r.website);
        const phone = r.phone ? String(r.phone).split(/[;,]/)[0].trim() : null;
        return '<div class="pp" data-cat="' + esc(r.category) + '">' +
            '<div class="pp-head"><span class="pp-ic">' + svg(iconFor(r.category, r.subcategory)) + "</span><div>" +
                '<div class="pp-name">' + esc(pretty(r.name) || "Unnamed " + r.subcategory) + "</div>" +
                '<div class="pp-type">#' + r.rank + " · " + esc(r.subcategory) + " · " + esc(r.category) + "</div></div></div>" +
            '<span class="pp-dist">' + svg("navigation") + fmtDist(r.distance_m) + " away</span>" +
            '<div class="pp-rows">' +
                (addr ? "<div>" + svg("map-pin") + "<span>" + esc(addr) + "</span></div>" : "") +
                (r.opening_hours ? "<div>" + svg("clock") + "<span>" + esc(r.opening_hours) + "</span></div>" : "") +
                (phone ? "<div>" + svg("phone") + "<span>" + esc(r.phone) + "</span></div>" : "") +
            "</div>" +
            '<div class="pp-actions">' +
                '<a class="btn btn-primary" href="' + esc(directionsUrl(r)) + '" target="_blank" rel="noopener noreferrer">' + svg("route") + "Directions ↗</a>" +
                (phone ? '<a class="btn btn-ghost" href="tel:' + esc(phone.replace(/[^\d+]/g, "")) + '">' + svg("phone") + "Call</a>" : "") +
                (web ? '<a class="btn btn-ghost" href="' + esc(web) + '" target="_blank" rel="noopener noreferrer">' + svg("globe") + "Website</a>" : "") +
            "</div></div>";
    }

    /* ---- list ↔ map synchronisation */
    function markActiveCard(key, scroll) {
        $$(".rc", el.resultsList).forEach((c) => {
            const on = c.dataset.key === key;
            c.classList.toggle("is-active", on);
            const main = $(".rc-main", c);
            if (on) main.setAttribute("aria-current", "true"); else main.removeAttribute("aria-current");
            if (on && scroll) scrollWithin(el.resultsList, c, "nearest", true);
        });
    }

    function selectResult(key, opts) {
        opts = opts || {};
        const m = markersByKey.get(key);
        if (!m) return;
        state.activeKey = key;
        markActiveCard(key, true);
        syncAllMarkerClasses();
        m.setZIndexOffset(1000);
        markersByKey.forEach((other, k) => { if (k !== key) other.setZIndexOffset(0); });

        if (opts.source === "map") {
            // marker clicked: Leaflet opens the popup itself; reveal the card
            if (mqMobile.matches) $("#tabCount").classList.add("bump");
            return;
        }
        if (mqMobile.matches) setSheet("peek");
        resultsCluster.zoomToShowLayer(m, () => {
            const target = m.getLatLng();
            const z = Math.max(map.getZoom(), 17);
            const inView = map.getBounds().pad(-0.15).contains(target) && map.getZoom() >= 16;
            if (inView || reduceMotion) {
                if (!inView) map.setView(target, z);
                m.openPopup();
                return;
            }
            let opened = false;
            const open = () => { if (!opened) { opened = true; m.openPopup(); } };
            map.once("moveend", open);
            setTimeout(open, 1300);
            map.flyTo(target, z, { duration: opts.fast ? 0.5 : 0.9 });
        });
    }

    function stepResult(dir) {
        const list = sortedResults();
        if (!list.length) return;
        const idx = list.findIndex((r) => r._key === state.activeKey);
        const next = list[(idx + dir + list.length) % list.length] || list[0];
        selectResult(next._key, { source: "keyboard", fast: true });
    }

    /* ---- legend reflects the active filter and the results */
    function updateLegendFocus() {
        $$("[data-legend]").forEach((li) => li.classList.toggle("is-dim", state.category !== "All" && li.dataset.legend !== state.category));
    }
    function updateLegendCounts() {
        const counts = {};
        state.results.forEach((r) => { counts[r.category] = (counts[r.category] || 0) + 1; });
        $$("[data-legend]").forEach((li) => {
            const n = counts[li.dataset.legend];
            $(".lg-count", li).textContent = n ? n : "";
            if (state.results.length) li.classList.toggle("is-dim", !n);
        });
        if (!state.results.length) updateLegendFocus();
    }

    /* ================================================================ EXPORT */
    function download(name, mime, text) {
        const blob = new Blob([text], { type: mime });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }

    function exportResults(kind) {
        if (!state.results.length) return;
        const stamp = new Date().toISOString().slice(0, 10);
        const base = "sonar-sg_" + searchLabel().toLowerCase().replace(/[^a-z0-9]+/g, "-") + "_" + stamp;
        const fields = ["rank", "service_id", "name", "category", "subcategory", "distance_m", "address", "postcode", "phone", "website", "opening_hours", "source", "latitude", "longitude"];
        if (kind === "csv") {
            const q = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
            const rows = [fields.join(",")].concat(state.results.map((r) => fields.map((f) => q(r[f])).join(",")));
            download(base + ".csv", "text/csv;charset=utf-8", "﻿" + rows.join("\n"));
        } else {
            const fc = {
                type: "FeatureCollection",
                search: state.lastSearch,
                features: state.results.map((r) => ({
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [r.longitude, r.latitude] },
                    properties: fields.reduce((o, f) => { if (f !== "latitude" && f !== "longitude") o[f] = r[f] == null ? null : r[f]; return o; }, {})
                }))
            };
            download(base + ".geojson", "application/geo+json", JSON.stringify(fc, null, 2));
        }
        toast("success", "Downloaded " + state.results.length + " places as " + kind.toUpperCase());
    }

    const exportMenu = $("#exportMenu");
    $("#exportBtn").addEventListener("click", () => {
        const open = exportMenu.hidden;
        closeFloating(open ? "export" : null);
        exportMenu.hidden = !open;
        $("#exportBtn").setAttribute("aria-expanded", String(open));
        if (open) exportMenu.querySelector("button").focus();
    });
    exportMenu.addEventListener("click", (e) => {
        const b = e.target.closest("[data-export]");
        if (!b) return;
        exportMenu.hidden = true;
        $("#exportBtn").setAttribute("aria-expanded", "false");
        exportResults(b.dataset.export);
    });

    /* ============================================================ URL / SHARE */
    function updateUrl(includeRun) {
        const p = new URLSearchParams();
        if (state.location) {
            p.set("lat", state.location.lat.toFixed(6));
            p.set("lon", state.location.lon.toFixed(6));
            if (state.location.source === "address" || state.location.source === "sample") p.set("place", state.location.label);
        }
        if (state.category !== "All") p.set("cat", state.category);
        if (state.subcategory !== "All") p.set("sub", state.subcategory);
        if (state.mode !== "radius") p.set("mode", state.mode);
        if (state.radiusIdx !== 1) p.set("r", String(RADII[state.radiusIdx]));
        if (state.limit !== 100) p.set("n", String(state.limit));
        if ((includeRun || state.lastSearch) && state.location && state.results) p.set("scan", "1");
        const qs = p.toString();
        try { history.replaceState(null, "", qs ? "?" + qs : location.pathname); } catch (e) { /* file:// in some browsers */ }
    }

    function readUrl() {
        const p = new URLSearchParams(location.search);
        const out = {};
        if (p.has("cat") && (TAXONOMY[p.get("cat")] || p.get("cat") === "All")) out.category = p.get("cat");
        if (p.has("sub") && out.category && TAXONOMY[out.category] && TAXONOMY[out.category][p.get("sub")] != null) out.subcategory = p.get("sub");
        if (p.get("mode") === "nearest") out.mode = "nearest";
        const r = Number(p.get("r"));
        if (RADII.includes(r)) out.radiusIdx = RADII.indexOf(r);
        const n = Number(p.get("n"));
        if ([5, 10, 20, 50, 100].includes(n)) out.limit = n;
        const lat = Number(p.get("lat")), lon = Number(p.get("lon"));
        if (p.has("lat") && p.has("lon") && Number.isFinite(lat) && Number.isFinite(lon)) out.location = { lat: lat, lon: lon, label: p.get("place") || null };
        out.scan = p.get("scan") === "1";
        return out;
    }

    async function copyText(text, okMsg) {
        try {
            await navigator.clipboard.writeText(text);
            toast("success", okMsg);
        } catch (e) {
            toast("info", text, { hold: 12000 });
        }
    }

    $("#shareBtn").addEventListener("click", async () => {
        updateUrl(true);
        const url = location.href;
        if (navigator.share && mqMobile.matches) {
            try { await navigator.share({ title: "Sonar SG · " + searchLabel(), url: url }); return; } catch (e) { if (e.name === "AbortError") return; }
        }
        copyText(url, "Link copied. Anyone opening it sees this search.");
    });

    /* ================================================================ LAYERS */
    const OVERLAYS = [
        { id: "results", name: "Result markers", desc: "Category pins and clusters for the current search", icon: "map-pin", on: true,
          add: () => resultsCluster.addTo(map), remove: () => map.removeLayer(resultsCluster) },
                  { id: "mask", name: "Focus on Singapore", desc: "Dims the map outside the study area", icon: "map", on: true,
          add: () => { if (maskLayer) maskLayer.addTo(map); }, remove: () => { if (maskLayer) map.removeLayer(maskLayer); } },
        { id: "ring", name: "Search radius ring", desc: "The area being scanned", icon: "radar", on: true,
          add: () => { if (ring) ring.addTo(map); }, remove: () => { if (ring) map.removeLayer(ring); } },
        { id: "heat", name: "Heatmap of results", desc: "Where the current results concentrate", icon: "flame", on: false,
          add: () => {
              if (!L.heatLayer) { toast("error", "Heatmap library failed to load."); return; }
              if (!heatLayer) heatLayer = L.heatLayer([], { radius: 30, blur: 24, maxZoom: 17, minOpacity: 0.35, gradient: { 0.2: "#2de2c4", 0.5: "#7c5cff", 0.8: "#ffb547", 1: "#ff6b81" } });
              heatLayer.addTo(map);
              heatLayer.setLatLngs(state.results.map((r) => [r.latitude, r.longitude, 0.8]));
          },
          remove: () => { if (heatLayer) map.removeLayer(heatLayer); } },
        { id: "regions", name: "Planning regions", desc: "URA region boundaries (study area)", icon: "map", on: true,
          add: () => { if (regionsLayer) regionsLayer.addTo(map); }, remove: () => { if (regionsLayer) map.removeLayer(regionsLayer); } },
        { id: "wms", name: "All services (GeoServer WMS)", desc: "All 16,487 services from PostGIS, rendered by GeoServer", icon: "globe", on: false,
          add: () => servicesWMS.addTo(map), remove: () => map.removeLayer(servicesWMS) }
    ];
    const overlayState = {};
    function overlayOn(id) { return overlayState[id] !== false; }

    function buildLayersPanel() {
        $("#basemapGrid").innerHTML = Object.keys(BASEMAPS).map((id) =>
            '<input type="radio" name="basemap" id="bm-' + id + '" value="' + id + '"' + (state.basemap === id ? " checked" : "") + ">" +
            '<label for="bm-' + id + '" class="bm-card"><span class="bm-thumb"><span class="bm-fallback">' + svg("map") + '</span><img src="' + esc(BASEMAPS[id].thumb) + '" alt="" loading="lazy"><span class="bm-check">' + svg("check") + "</span></span>" + esc(BASEMAPS[id].name) + "</label>"
        ).join("");
        $$("#basemapGrid img").forEach((img) => img.addEventListener("error", () => img.remove()));
        $("#basemapGrid").addEventListener("change", (e) => setBasemap(e.target.value, { manual: true }));

        $("#overlayList").innerHTML = OVERLAYS.map((o) =>
            '<label class="ov-row"><span class="ov-ic">' + svg(o.icon) + '</span><span class="ov-text"><strong>' + esc(o.name) + "</strong><small>" + esc(o.desc) + '</small></span><input type="checkbox" class="switch" role="switch" data-ov="' + o.id + '"' + (o.on ? " checked" : "") + "></label>"
        ).join("");
        OVERLAYS.forEach((o) => { overlayState[o.id] = o.on; });
        $("#overlayList").addEventListener("change", (e) => {
            const o = OVERLAYS.find((x) => x.id === e.target.dataset.ov);
            if (!o) return;
            overlayState[o.id] = e.target.checked;
            (e.target.checked ? o.add : o.remove)();
        });

        $("#wmsCatList").innerHTML = Object.keys(CATEGORIES).map((c) =>
            '<label class="ov-row" data-cat="' + esc(c) + '"><span class="ov-ic">' + svg(CATEGORIES[c].icon) + '</span><span class="ov-text"><strong>' + esc(c) + '</strong></span><input type="checkbox" class="switch" role="switch" data-wms-cat="' + esc(c) + '"></label>'
        ).join("");
        $("#wmsCatList").addEventListener("change", (e) => {
            const c = e.target.dataset.wmsCat;
            if (!c) return;
            const layer = getCategoryWms(c);
            if (e.target.checked) layer.addTo(map); else map.removeLayer(layer);
        });
    }

    function toggleLayers(open) {
        const show = open != null ? open : el.layersPanel.hidden;
        closeFloating(show ? "layers" : null);
        el.layersPanel.hidden = !show;
        el.layersBtn.setAttribute("aria-expanded", String(show));
        if (show) el.layersPanel.querySelector("input:checked, input").focus({ preventScroll: true });
    }
    el.layersBtn.addEventListener("click", () => toggleLayers());
    $("#layersClose").addEventListener("click", () => toggleLayers(false));

    /* ======================================================= PANELS / SHEET */
    function setCollapsed(panel, collapsed) {
        panel.classList.toggle("is-collapsed", collapsed);
        const btn = $(".panel-collapse", panel);
        btn.setAttribute("aria-expanded", String(!collapsed));
        btn.setAttribute("aria-label", (collapsed ? "Expand " : "Collapse ") + (panel === el.filterCard ? "filters" : "results"));
        updateInsets();
    }

    $$("[data-collapse]").forEach((b) => b.addEventListener("click", () => {
        const panel = document.getElementById(b.dataset.collapse);
        setCollapsed(panel, !panel.classList.contains("is-collapsed"));
    }));
    $$("[data-expand]").forEach((b) => b.addEventListener("click", () => setCollapsed(document.getElementById(b.dataset.expand), false)));

    // ---- moving the panel bodies into the mobile sheet (listeners survive DOM moves)
    const moves = [
        { node: el.filterBody, home: el.filterCard, target: $("#sheetFilters") },
        { node: el.resultsTitleWrap, home: $(".results-head"), target: $("#sheetResults"), before: true },
        { node: el.resultsBody, home: el.resultsCard, target: $("#sheetResults") },
        { node: el.brandActions, home: $("#brandBar"), target: el.mobileActions }
    ];
    moves.forEach((m) => { m.next = m.node.nextSibling; });
    let layoutMode = null;

    function applyLayout() {
        const mode = mqMobile.matches ? "mobile" : mqDesktop.matches ? "desktop" : "tablet";
        if (mode === layoutMode) { updateInsets(); return; }
        const was = layoutMode;
        layoutMode = mode;
        if (mode === "mobile") {
            moves.forEach((m) => m.target.appendChild(m.node));
            setSheet(sheetState || "peek");
        } else if (was === "mobile" || was === null) {
            moves.forEach((m) => {
                if (m.node.parentNode !== m.home) {
                    if (m.before) m.home.insertBefore(m.node, m.home.firstChild);
                    else m.home.insertBefore(m.node, m.next && m.next.parentNode === m.home ? m.next : null);
                }
            });
        }
        if (mode === "tablet" && was !== "tablet") setCollapsed(el.filterCard, true);
        if (mode === "desktop" && was === "tablet") setCollapsed(el.filterCard, false);
        updateInsets();
    }

    // ---- bottom sheet (mobile)
    let sheetState = null;
    function sheetHeights() {
        const vh = window.innerHeight;
        return { peek: 162, half: Math.round(vh * 0.52), full: Math.round(vh - 76) };
    }

    function setSheet(name) {
        if (!mqMobile.matches) { sheetState = name; return; }
        sheetState = name;
        const h = sheetHeights()[name];
        document.documentElement.style.setProperty("--sheet-h", h + "px");
        el.body.classList.toggle("sheet-full", name === "full");
        el.body.classList.toggle("sheet-peek", name === "peek");
        $("#sheetGrip").setAttribute("aria-label", "Panel size: " + name + ". Press to resize.");
        setTimeout(updateInsets, 420);
        updateInsets();
    }

    function switchSheetTab(tab) {
        const results = tab === "results";
        $("#tabFilters").setAttribute("aria-selected", String(!results));
        $("#tabResults").setAttribute("aria-selected", String(results));
        $("#sheetFilters").hidden = results;
        $("#sheetResults").hidden = !results;
        el.sheet.classList.toggle("tab-results", results);
    }

    (function initSheetDrag() {
        const grip = $("#sheetGrip");
        const tabs = $(".sheet-tabs", el.sheet);
        let startY = 0, startH = 0, dragging = false, pid = null, lastY = 0, lastT = 0, vel = 0, suppressClick = false;

        function down(e) {
            if (!mqMobile.matches) return;
            pid = e.pointerId;
            startY = lastY = e.clientY;
            lastT = performance.now();
            startH = el.sheet.getBoundingClientRect().height;
            dragging = false;
        }
        function move(e) {
            if (pid !== e.pointerId) return;
            const dy = e.clientY - startY;
            if (!dragging && Math.abs(dy) > 6) {
                dragging = true;
                el.sheet.classList.add("is-dragging");
                try { e.currentTarget.setPointerCapture(pid); } catch (err) { /* ignore */ }
            }
            if (!dragging) return;
            const now = performance.now();
            vel = (e.clientY - lastY) / Math.max(1, now - lastT);
            lastY = e.clientY;
            lastT = now;
            const hs = sheetHeights();
            const h = clamp(startH - dy, hs.peek - 30, hs.full + 10);
            document.documentElement.style.setProperty("--sheet-h", h + "px");
        }
        function up(e) {
            if (pid !== e.pointerId) return;
            pid = null;
            if (!dragging) return;
            dragging = false;
            suppressClick = true;
            setTimeout(() => { suppressClick = false; }, 50);
            el.sheet.classList.remove("is-dragging");
            const hs = sheetHeights();
            const h = el.sheet.getBoundingClientRect().height;
            let target;
            if (vel < -0.6) target = h < hs.half ? "half" : "full";
            else if (vel > 0.6) target = h > hs.half ? "half" : "peek";
            else target = ["peek", "half", "full"].reduce((a, b) => (Math.abs(hs[b] - h) < Math.abs(hs[a] - h) ? b : a), "peek");
            setSheet(target);
        }
        [grip, tabs].forEach((t) => {
            t.addEventListener("pointerdown", down);
            t.addEventListener("pointermove", move);
            t.addEventListener("pointerup", up);
            t.addEventListener("pointercancel", up);
        });
        tabs.addEventListener("click", (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);

        grip.addEventListener("click", () => {
            if (suppressClick) return;
            setSheet(sheetState === "peek" ? "half" : sheetState === "half" ? "full" : "peek");
        });
        grip.addEventListener("keydown", (e) => {
            if (e.key === "ArrowUp") { e.preventDefault(); setSheet(sheetState === "peek" ? "half" : "full"); }
            else if (e.key === "ArrowDown") { e.preventDefault(); setSheet(sheetState === "full" ? "half" : "peek"); }
            else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); grip.click(); }
        });
    })();

    $("#tabFilters").addEventListener("click", () => { switchSheetTab("filters"); if (sheetState === "peek") setSheet("half"); });
    $("#tabResults").addEventListener("click", () => { switchSheetTab("results"); if (sheetState === "peek") setSheet("half"); $("#tabCount").classList.remove("bump"); });

    /* ============================================================ HELP & TOUR */
    function openHelp(tab) {
        closeFloating();
        el.helpModal.hidden = false;
        selectHelpTab(tab || "htQuick");
        setTimeout(() => $(".modal-tab[aria-selected='true']", el.helpModal).focus(), 30);
    }
    function closeHelp() {
        el.helpModal.hidden = true;
        $("#helpBtn").focus({ preventScroll: true });
    }
    function selectHelpTab(id) {
        $$(".modal-tab", el.helpModal).forEach((t) => {
            const on = t.id === id;
            t.setAttribute("aria-selected", String(on));
            t.tabIndex = on ? 0 : -1;
            document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
        });
    }
    $("#helpBtn").addEventListener("click", () => openHelp());
    $$("[data-close-modal]", el.helpModal).forEach((b) => b.addEventListener("click", closeHelp));
    $$(".modal-tab", el.helpModal).forEach((t) => {
        t.addEventListener("click", () => selectHelpTab(t.id));
        t.addEventListener("keydown", (e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            const tabs = $$(".modal-tab", el.helpModal);
            const i = tabs.indexOf(t) + (e.key === "ArrowRight" ? 1 : -1);
            const n = tabs[(i + tabs.length) % tabs.length];
            selectHelpTab(n.id);
            n.focus();
        });
    });
    // keep focus inside the dialog
    el.helpModal.addEventListener("keydown", (e) => {
        if (e.key !== "Tab") return;
        const f = $$("button, a[href], input, select", el.helpModal).filter((x) => !x.closest("[hidden]") && x.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
    $("#startTourBtn").addEventListener("click", () => { el.helpModal.hidden = true; startTour(); });

    const TOUR = [
        { target: () => el.searchBar, title: "Where are you?", text: "Type an address or 6-digit postal code, use your device location, enter coordinates, or simply tap the map.", prep: () => mqMobile.matches && setSheet("peek") },
        { target: () => $("#fgCategory"), title: "Pick a service category", text: "Icon chips for the seven categories. Choosing one reveals its service types, like Pharmacy or MRT Station Exit.", prep: () => prepFilters("#fgCategory") },
        { target: () => $("#fgMode"), title: "Radius or Nearest N", text: "Radius finds everything within a distance. Nearest N finds the closest N places, however far they are.", prep: () => prepFilters("#fgMode") },
        { target: () => $("#fgRadius"), title: "Set the search radius", text: "Snap from 500 m to 10 km. The ring on the map updates as you drag.", prep: () => prepFilters("#fgRadius") },
        { target: () => el.scanBtn, title: "Scan nearby", text: "Sends a PostGIS spatial query. A radar ripple runs while it searches.", prep: () => prepFilters("#scanRow") },
        { target: () => (mqMobile.matches ? el.sheet : el.resultsCard), title: "Results, nearest first", text: "Each card shows distance, address and details. Click a card to fly to its marker, or a marker to find its card. ↑ ↓ move through the list.", prep: () => { if (mqMobile.matches) { switchSheetTab("results"); setSheet("half"); } else setCollapsed(el.resultsCard, false); } }
    ];
    let tourIdx = 0;

    function prepFilters(sel) {
        if (mqMobile.matches) {
            switchSheetTab("filters");
            setSheet("full");
        } else {
            setCollapsed(el.filterCard, false);
        }
        scrollWithin(el.filterBody, $(sel), "center", false);
    }

    function startTour() {
        closeFloating();
        tourIdx = 0;
        $("#tour").hidden = false;
        $("#tourDots").innerHTML = TOUR.map(() => "<i></i>").join("");
        showTourStep();
    }

    function endTour() {
        $("#tour").hidden = true;
        store("tourDone", "1");
        if (mqMobile.matches) { switchSheetTab("filters"); setSheet("peek"); }
    }

    function showTourStep() {
        const step = TOUR[tourIdx];
        if (step.prep) step.prep();
        $("#tourStep").textContent = "Step " + (tourIdx + 1) + " of " + TOUR.length;
        $("#tourTitle").textContent = step.title;
        $("#tourText").textContent = step.text;
        $$("#tourDots i").forEach((d, i) => d.classList.toggle("is-on", i === tourIdx));
        $("#tourBack").disabled = tourIdx === 0;
        $("#tourNext").textContent = tourIdx === TOUR.length - 1 ? "Finish" : "Next";
        $("#tour").classList.add("is-measuring");
        setTimeout(positionTour, reduceMotion ? 0 : 420);
        $("#tourNext").focus({ preventScroll: true });
    }

    function positionTour() {
        if ($("#tour").hidden) return;
        const target = TOUR[tourIdx].target();
        const spot = $("#tourSpot");
        const card = $("#tourCard");
        const vw = window.innerWidth, vh = window.innerHeight;
        const r = target.getBoundingClientRect();
        const pad = 8;
        const sr = { left: Math.max(4, r.left - pad), top: Math.max(4, r.top - pad), right: Math.min(vw - 4, r.right + pad), bottom: Math.min(vh - 4, r.bottom + pad) };
        Object.assign(spot.style, { left: sr.left + "px", top: sr.top + "px", width: sr.right - sr.left + "px", height: sr.bottom - sr.top + "px" });
        requestAnimationFrame(() => $("#tour").classList.remove("is-measuring"));

        const cw = card.offsetWidth, ch = card.offsetHeight, gap = 16;
        let left, top;
        if (vw < 640) {
            left = (vw - cw) / 2;
            top = sr.top > vh / 2 ? Math.max(12, sr.top - ch - gap) : Math.min(vh - ch - 12, sr.bottom + gap);
            if (top + ch > sr.top && top < sr.bottom) top = 12; // overlaps: dock at top
        } else if (sr.right + gap + cw < vw - 8) { left = sr.right + gap; top = sr.top; }
        else if (sr.left - gap - cw > 8) { left = sr.left - gap - cw; top = sr.top; }
        else { left = sr.left + (sr.right - sr.left - cw) / 2; top = sr.bottom + gap + ch < vh ? sr.bottom + gap : sr.top - gap - ch; }
        card.style.left = clamp(left, 12, vw - cw - 12) + "px";
        card.style.top = clamp(top, 12, vh - ch - 12) + "px";
    }

    $("#tourNext").addEventListener("click", () => { if (tourIdx < TOUR.length - 1) { tourIdx++; showTourStep(); } else endTour(); });
    $("#tourBack").addEventListener("click", () => { if (tourIdx > 0) { tourIdx--; showTourStep(); } });
    $("#tourSkip").addEventListener("click", endTour);

    /* ============================================================= SHORTCUTS */
    function closeFloating(except) {
        if (except !== "layers" && !el.layersPanel.hidden) { el.layersPanel.hidden = true; el.layersBtn.setAttribute("aria-expanded", "false"); }
        if (except !== "coord" && !el.coordPopover.hidden) { el.coordPopover.hidden = true; el.coordBtn.setAttribute("aria-expanded", "false"); }
        if (except !== "export" && !exportMenu.hidden) { exportMenu.hidden = true; $("#exportBtn").setAttribute("aria-expanded", "false"); }
        if (except !== "suggest") closeSuggestions();
    }

    document.addEventListener("pointerdown", (e) => {
        const t = e.target;
        if (!el.layersPanel.hidden && !el.layersPanel.contains(t) && !el.layersBtn.contains(t)) toggleLayers(false);
        if (!el.coordPopover.hidden && !el.coordPopover.contains(t) && !el.coordBtn.contains(t)) openCoordPopover(false);
        if (!exportMenu.hidden && !t.closest(".menu-wrap")) { exportMenu.hidden = true; $("#exportBtn").setAttribute("aria-expanded", "false"); }
    });

    document.addEventListener("keydown", (e) => {
        const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && !["radio", "checkbox", "range"].includes(e.target.type);
        const tourOpen = !$("#tour").hidden;

        if (!state.introDone) {
            if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); leaveIntro(); }
            return;
        }
        if (tourOpen) {
            if (e.key === "Escape") endTour();
            else if (e.key === "ArrowRight") $("#tourNext").click();
            else if (e.key === "ArrowLeft") $("#tourBack").click();
            return;
        }
        if (e.key === "Escape") {
            if (!el.helpModal.hidden) { closeHelp(); return; }
            if (!el.layersPanel.hidden) { toggleLayers(false); el.layersBtn.focus(); return; }
            if (!el.coordPopover.hidden) { openCoordPopover(false); el.coordBtn.focus(); return; }
            if (!exportMenu.hidden) { closeFloating(); $("#exportBtn").focus(); return; }
            if (map._popup && map.hasLayer(map._popup)) { map.closePopup(); return; }
            if (mqMobile.matches && sheetState !== "peek") { setSheet("peek"); return; }
            if (typing) e.target.blur();
            return;
        }
        if (typing || e.ctrlKey || e.metaKey || e.altKey || !el.helpModal.hidden) return;

        if (e.key === "/") { e.preventDefault(); if (mqMobile.matches) setSheet("peek"); el.placeInput.focus(); el.placeInput.select(); }
        else if (e.key === "l" || e.key === "L") { toggleLayers(); }
        else if (e.key === "t" || e.key === "T") { $("#themeBtn").click(); }
        else if (e.key === "?" || e.key === "h" || e.key === "H") { openHelp(); }
        else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && state.results.length && document.activeElement !== map.getContainer()) {
            e.preventDefault();
            stepResult(e.key === "ArrowDown" ? 1 : -1);
        } else if (e.key === "Enter" && (e.target === document.body || e.target === map.getContainer())) {
            scan();
        }
    });

    window.addEventListener("resize", () => {
        applyLayout();
        if (mqMobile.matches && sheetState) setSheet(sheetState);
        positionTour();
    });

    /* ============================================================= API HEALTH */
    function showApiBanner(msg) {
        $(".api-msg", el.apiBanner).textContent = msg;
        el.apiBanner.hidden = false;
    }
    function hideApiBanner() { el.apiBanner.hidden = true; }

    async function checkApi() {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        try {
            const res = await fetch(API_BASE + "/health", { signal: ctrl.signal });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.status !== "ok") {
                showApiBanner("The API is running but can't reach PostgreSQL. Check the database service.");
                return false;
            }
            hideApiBanner();
            loadTaxonomy();
            return true;
        } catch (e) {
            showApiBanner("Can't reach the search API at " + API_BASE.replace(/^https?:\/\//, "") + ". Start Flask: python backend/app.py");
            return false;
        } finally {
            clearTimeout(t);
        }
    }
    $("#apiRetry").addEventListener("click", async () => {
        const ok = await checkApi();
        toast(ok ? "success" : "error", ok ? "Connected to the search API." : "Still can't reach the search API.");
    });

    // live category/type counts from PostGIS (optional endpoint)
    async function loadTaxonomy() {
        try {
            const res = await fetch(API_BASE + "/categories");
            if (!res.ok) return;
            const data = await res.json();
            if (!data || !Array.isArray(data.categories) || !data.categories.length) return;
            const tax = {};
            data.categories.forEach((row) => {
                if (!row.category || !row.subcategory) return;
                (tax[row.category] = tax[row.category] || {})[row.subcategory] = Number(row.count) || 0;
            });
            // keep the configured order; append anything new from the database
            const ordered = {};
            Object.keys(CATEGORIES).concat(Object.keys(tax)).forEach((c) => { if (tax[c] && !ordered[c]) ordered[c] = tax[c]; });
            TAXONOMY = ordered;
            if (TAXONOMY[state.category] == null) state.category = "All";
            if (state.category === "All" || !TAXONOMY[state.category][state.subcategory]) {
                if (state.subcategory !== "All" && !(TAXONOMY[state.category] || {})[state.subcategory]) state.subcategory = "All";
            }
            buildCategoryChips();
            buildTypeChips();
        } catch (e) { /* keep the built-in counts */ }
    }

    /* ================================================================= INTRO */
    function runIntroCounters() {
        $$(".intro-stats [data-count]").forEach((d, i) => setTimeout(() => animateNumber(d, Number(d.dataset.count), 1400), 600 + i * 120));
    }

    function leaveIntro(thenTour) {
        if (state.introDone) return;
        state.introDone = true;
        const mapEl = map.getContainer();
        if (!reduceMotion) {
            // freeze the Ken Burns pose, then ease it back to identity
            const pose = getComputedStyle(mapEl).transform;
            mapEl.style.transform = pose === "none" ? "" : pose;
        }
        el.body.classList.add("is-entering");
        el.body.classList.remove("is-intro");
        void mapEl.offsetWidth;
        mapEl.classList.add("kb-release");
        mapEl.style.transform = "none";
        el.intro.classList.add("is-leaving");
        el.intro.setAttribute("aria-hidden", "true");

        setTimeout(() => {
            el.intro.hidden = true;
            mapEl.classList.remove("kb-release");
            mapEl.style.transform = "";
            el.body.classList.remove("is-entering");
            map.invalidateSize();
            afterIntro(thenTour);
        }, reduceMotion ? 50 : 1000);
    }

    function afterIntro(thenTour) {
        const fromUrl = readUrl();
        if (fromUrl.location) {
            const ok = setLocation(fromUrl.location.lat, fromUrl.location.lon, {
                label: fromUrl.location.label || undefined,
                source: fromUrl.location.label ? "address" : "map",
                silent: true,
                autoScan: false
            });
            if (ok && fromUrl.scan) scan();
        } else if (!thenTour && mqDesktop.matches) {
            el.placeInput.focus({ preventScroll: true });
        }
        if (thenTour || !store("tourDone")) setTimeout(startTour, fromUrl.location ? 1400 : 350);
        if (!fromUrl.location) map.flyTo(SG_CENTER, mqMobile.matches ? 11 : 12, { duration: reduceMotion ? 0 : 1.2 });
    }

    $("#introStart").addEventListener("click", () => leaveIntro(false));
    $("#introTour").addEventListener("click", () => leaveIntro(true));

    /* ================================================================== INIT */
    (function init() {
        const fromUrl = readUrl();
        ["category", "subcategory", "mode", "radiusIdx", "limit"].forEach((k) => { if (fromUrl[k] != null) state[k] = fromUrl[k]; });

        buildCategoryChips();
        buildTypeChips();
        syncRadiusUI();
        syncModeUI();
        syncLimitUI();
        updateLegendFocus();
        buildLayersPanel();
        setTheme(currentTheme(), false);
        switchSheetTab("filters");
        applyLayout();
        updateLocationUI();
        renderIdle();
        updateCounts(0);

        runIntroCounters();
        checkApi();
        $("#introStart").focus({ preventScroll: true });
    })();
})();
