/**
 * Geocode cross-street labels in the Madison, WI area.
 *
 * Strategy (in order, best → fallback):
 *   1. Overpass API (OpenStreetMap) — find the actual shared node between the
 *      two named ways. This gives the TRUE geometric intersection straight
 *      from OSM, not an approximation.
 *   2. Overpass "closest approach" — if the two ways don't share a node (rare,
 *      but can happen with overpass/tunnel segmentations), find the nearest
 *      point between their geometries.
 *   3. Photon (Komoot) single combined query — ask Photon directly for the
 *      intersection as a place.
 *   4. Photon per-arm averaging — last resort (the old behaviour).
 *
 * Every candidate is validated against a Madison metro bounding box so an
 * out-of-state match never leaks into the final coordinate set.
 */

export const MADISON_CENTER = { lat: 43.073, lng: -89.401 };

/** Generous Dane County / Madison metro bounding box used for sanity checks. */
export const MADISON_BBOX = {
    minLat: 42.85,
    minLng: -89.85,
    maxLat: 43.35,
    maxLng: -89.00,
};

export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isInMadisonBbox(p) {
    return (
        p &&
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lng) &&
        p.lat >= MADISON_BBOX.minLat &&
        p.lat <= MADISON_BBOX.maxLat &&
        p.lng >= MADISON_BBOX.minLng &&
        p.lng <= MADISON_BBOX.maxLng
    );
}

export function fixStreetTypos(segment) {
    let s = String(segment ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\.$/, "");
    // Expand common abbreviations so OSM / Photon matches work
    s = s
        .replace(/^\s*W\.\s+/i, "West ")
        .replace(/^\s*E\.\s+/i, "East ")
        .replace(/^\s*N\.\s+/i, "North ")
        .replace(/^\s*S\.\s+/i, "South ")
        .replace(/^\s*W\s+(?=[A-Za-z])/i, "West ")
        .replace(/^\s*E\s+(?=[A-Za-z])/i, "East ")
        .replace(/^\s*N\s+(?=[A-Za-z])/i, "North ")
        .replace(/^\s*S\s+(?=[A-Za-z])/i, "South ")
        .replace(/\bLn\b\.?$/i, "Lane")
        .replace(/\bRd\b\.?$/i, "Road")
        .replace(/\bSt\b\.?$/i, "Street")
        .replace(/\bDr\b\.?$/i, "Drive")
        .replace(/\bAve\b\.?$/i, "Avenue")
        .replace(/\bBlvd\b\.?$/i, "Boulevard")
        .replace(/\bCt\b\.?$/i, "Court")
        .replace(/\bTer\b\.?$/i, "Terrace")
        .replace(/\bPl\b\.?$/i, "Place")
        .replace(/\bPkwy\b\.?$/i, "Parkway")
        .replace(/\bCir\b\.?$/i, "Circle");
    const fixes = [
        [/\bManona\b/gi, "Monona"],
        [/\bWillage\b/gi, "Village"],
        [/\bFieldler\b/gi, "Fiedler"],
        [/\bMuir Field\b/gi, "Muirfield"],
        [/\bThrush Ln\b/gi, "Thrush Lane"],
        [/\bVillage Green Lane E\b/gi, "East Village Green Lane"],
    ];
    for (const [re, rep] of fixes) s = s.replace(re, rep);
    return s;
}

export function splitCrossStreetArms(label) {
    return String(label ?? "")
        .split("/")
        .map(fixStreetTypos)
        .map((s) => s.trim())
        .filter(Boolean);
}

function distance2ToMadison(lng, lat) {
    const dlat = lat - MADISON_CENTER.lat;
    const dlng = lng - MADISON_CENTER.lng;
    return dlat * dlat + dlng * dlng;
}

/** Great-circle distance in meters (WGS84 sphere). */
export function distanceMeters(a, b) {
    const R = 6371000;
    const φ1 = (a.lat * Math.PI) / 180;
    const φ2 = (b.lat * Math.PI) / 180;
    const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
    const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
    const s =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// =============================================================================
// Overpass (OpenStreetMap) — true intersection finder
// =============================================================================

const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
];

async function overpassQuery(ql, { retries = 2 } = {}) {
    let lastErr = null;
    for (const url of OVERPASS_ENDPOINTS) {
        for (let i = 0; i <= retries; i++) {
            try {
                const res = await fetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                    body: "data=" + encodeURIComponent(ql),
                });
                if (!res.ok) {
                    if (res.status === 429 || res.status >= 500) {
                        await sleep(800 * (i + 1));
                        continue;
                    }
                    lastErr = new Error(`HTTP ${res.status}`);
                    break;
                }
                return await res.json();
            } catch (err) {
                lastErr = err;
                await sleep(400);
            }
        }
    }
    if (lastErr) {
        // swallow the error so the higher-level cascade can try Photon
        // but surface it for debugging
        console.warn("Overpass query failed:", lastErr.message);
    }
    return null;
}

/** Strip direction prefix + common suffix so "N. Crowley Ave" → "Crowley". */
function streetCoreForRegex(arm) {
    let s = fixStreetTypos(arm);
    s = s.replace(/^(North|South|East|West)\s+/i, "");
    s = s.replace(
        /\s+(Avenue|Street|Road|Drive|Lane|Place|Parkway|Circle|Boulevard|Court|Way|Trail|Terrace|Highway)\.?$/i,
        "",
    );
    return s.trim();
}

function escapeRegex(s) {
    return String(s).replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

/**
 * Build a permissive regex that matches OSM names for this street.
 * Accepts the core word(s) with or without a direction prefix and with any
 * common suffix, plus abbreviations.
 */
function osmNameRegex(arm) {
    const fixed = fixStreetTypos(arm);
    const core = streetCoreForRegex(fixed);
    if (!core) return null;

    const dirMatch = fixed.match(/^(North|South|East|West)\s+/i);
    const direction = dirMatch ? dirMatch[1] : null;

    // Direction alternation: allow OSM to spell it "North" or "N" or missing
    let dirAlt = "(?:(?:N|S|E|W)\\.?\\s+|(?:North|South|East|West)\\s+)?";
    if (direction) {
        const initial = direction[0].toUpperCase();
        dirAlt = `(?:${initial}\\.?\\s+|${direction}\\s+)?`;
    }

    return `^${dirAlt}${escapeRegex(core)}(?:\\s+(?:Avenue|Ave|Street|St|Road|Rd|Drive|Dr|Lane|Ln|Place|Pl|Parkway|Pkwy|Circle|Cir|Boulevard|Blvd|Court|Ct|Way|Trail|Tr|Terrace|Ter|Highway|Hwy))?\\.?$`;
}

/** Choose the candidate closest to Madison center (squared-degrees heuristic). */
function pickClosestToCenter(points) {
    let best = null;
    let bestScore = Infinity;
    for (const p of points) {
        if (!isInMadisonBbox(p)) continue;
        const s = distance2ToMadison(p.lng, p.lat);
        if (s < bestScore) {
            bestScore = s;
            best = { lat: p.lat, lng: p.lng };
        }
    }
    return best;
}

/**
 * Find the true intersection node shared by two OSM ways.
 *
 * When two named streets cross each other at more than one point
 * (e.g. divided highways, streets that bend and re-cross), pick the
 * candidate closest to Madison city center, which in this dataset is
 * virtually always the intended intersection.
 *
 * Returns { lat, lng } or null if no shared node exists.
 */
export async function overpassIntersectionNode(arm1, arm2) {
    const re1 = osmNameRegex(arm1);
    const re2 = osmNameRegex(arm2);
    if (!re1 || !re2) return null;

    const bb = `${MADISON_BBOX.minLat},${MADISON_BBOX.minLng},${MADISON_BBOX.maxLat},${MADISON_BBOX.maxLng}`;

    // Only match "highway" ways that are actually drivable/walkable streets
    // (exclude footway/cycleway/service parking aisles so we don't snap to a
    // sidewalk segment when two roads happen to have overlapping paths).
    // `name` is required so we never match an unnamed connector.
    const ql = `
      [out:json][timeout:25];
      way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|road)$"]["name"~"${re1}",i](${bb}) -> .a;
      way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|road)$"]["name"~"${re2}",i](${bb}) -> .b;
      node(w.a)(w.b);
      out body 20;
    `;

    const data = await overpassQuery(ql);
    const nodes = (data?.elements || []).filter((e) => e.type === "node");
    if (!nodes.length) return null;

    return pickClosestToCenter(
        nodes.map((n) => ({ lat: n.lat, lng: n.lon })),
    );
}

/**
 * Fallback when two ways don't share a node (happens with segmented
 * overpasses, bridges, divided highways): fetch both geometries and compute
 * the closest-approach point between their line segments.
 */
export async function overpassClosestApproach(arm1, arm2) {
    const re1 = osmNameRegex(arm1);
    const re2 = osmNameRegex(arm2);
    if (!re1 || !re2) return null;

    const bb = `${MADISON_BBOX.minLat},${MADISON_BBOX.minLng},${MADISON_BBOX.maxLat},${MADISON_BBOX.maxLng}`;

    const ql = `
      [out:json][timeout:25];
      (
        way["highway"]["name"~"${re1}",i](${bb});
      ) -> .a;
      (
        way["highway"]["name"~"${re2}",i](${bb});
      ) -> .b;
      (.a; .b;);
      out geom;
    `;

    const data = await overpassQuery(ql);
    const elements = data?.elements || [];
    if (!elements.length) return null;

    // Separate ways by which regex they match — Overpass returns them all
    // together, so we re-test names here.
    const rx1 = new RegExp(re1, "i");
    const rx2 = new RegExp(re2, "i");
    const ways1 = [];
    const ways2 = [];
    for (const el of elements) {
        if (el.type !== "way" || !el.geometry) continue;
        const name = el.tags?.name || "";
        if (rx1.test(name)) ways1.push(el.geometry);
        else if (rx2.test(name)) ways2.push(el.geometry);
    }
    if (!ways1.length || !ways2.length) return null;

    // Brute-force nearest pair of vertices across the two sets. For the sizes
    // we deal with in Madison this is O(n*m) ≤ a few thousand comparisons.
    let best = null;
    let bestD = Infinity;
    for (const g1 of ways1) {
        for (const p1 of g1) {
            const a = { lat: p1.lat, lng: p1.lon };
            if (!isInMadisonBbox(a)) continue;
            for (const g2 of ways2) {
                for (const p2 of g2) {
                    const b = { lat: p2.lat, lng: p2.lon };
                    if (!isInMadisonBbox(b)) continue;
                    const d = distanceMeters(a, b);
                    if (d < bestD) {
                        bestD = d;
                        best = {
                            lat: (a.lat + b.lat) / 2,
                            lng: (a.lng + b.lng) / 2,
                        };
                    }
                }
            }
        }
    }
    // Only trust a "closest approach" answer if the two streets actually come
    // close together — otherwise this is almost certainly the wrong pair of
    // streets. 120 m ≈ width of a large intersection.
    if (best && bestD <= 120) return best;
    return null;
}

// =============================================================================
// Photon (Komoot) — fallback geocoder
// =============================================================================

function pickBestPhotonCoords(features) {
    if (!features.length) return null;
    let best = null;
    let bestScore = Infinity;
    for (const f of features) {
        const cc = (f.properties?.countrycode || "").toUpperCase();
        if (cc && cc !== "US") continue;
        const coords = f.geometry?.coordinates;
        if (!coords) continue;
        const [lng, lat] = coords;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        if (!isInMadisonBbox({ lat, lng })) continue;
        const city = (f.properties?.city || "").toLowerCase();
        const county = (f.properties?.county || "").toLowerCase();
        let penalty = 2;
        if (city === "madison") penalty = 0;
        else if (county.includes("dane")) penalty = 0.5;
        const score = distance2ToMadison(lng, lat) + penalty;
        if (score < bestScore) {
            bestScore = score;
            best = { lat, lng };
        }
    }
    return best;
}

async function photonSearch(query, limit = 12) {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lon=${MADISON_CENTER.lng}&lat=${MADISON_CENTER.lat}&limit=${limit}&lang=en`;
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        return pickBestPhotonCoords(data.features || []);
    } catch {
        return null;
    }
}

export async function photonGeocodeStreetArm(arm) {
    return photonSearch(`${arm}, Madison, Wisconsin, USA`);
}

export async function photonGeocodeCombinedIntersection(arm1, arm2) {
    return photonSearch(
        `${arm1} and ${arm2}, Madison, Wisconsin, USA`,
        16,
    );
}

/**
 * Geocode a freeform address or place (biased toward Madison area).
 * Used by the "find nearest intersection" widget.
 */
export async function geocodeFreeformAddress(address) {
    const raw = String(address ?? "").trim();
    if (!raw) return null;
    const hasContext = /madison|dane|wi\b|wisconsin/i.test(raw);
    const q = hasContext ? raw : `${raw}, Madison, Wisconsin, USA`;
    return photonSearch(q, 16);
}

// =============================================================================
// Top-level cascade — this is what callers should use
// =============================================================================

/**
 * Resolve a cross-street label ("A St / B Ave") to its best-known coordinate.
 * Tries OSM (Overpass) first for true intersections, falls back to Photon.
 * Returns null only if every strategy fails or every result falls outside
 * the Madison metro bbox.
 */
export async function geocodeCrossStreetIntersection(label) {
    const arms = splitCrossStreetArms(label);

    // --- Single-arm label (no slash): just geocode the one street ---
    if (arms.length === 1) {
        const only = await photonGeocodeStreetArm(arms[0]);
        if (only && isInMadisonBbox(only)) return only;
        return null;
    }
    if (arms.length < 2) {
        const only = await photonGeocodeStreetArm(fixStreetTypos(label));
        if (only && isInMadisonBbox(only)) return only;
        return null;
    }

    const [arm1, arm2] = arms;

    // 1. True intersection via shared OSM node
    try {
        const exact = await overpassIntersectionNode(arm1, arm2);
        if (exact && isInMadisonBbox(exact)) return exact;
    } catch {
        // fall through
    }

    // 2. Closest approach between two OSM ways
    await sleep(220);
    try {
        const near = await overpassClosestApproach(arm1, arm2);
        if (near && isInMadisonBbox(near)) return near;
    } catch {
        // fall through
    }

    // 3. Photon combined-query "A and B, Madison"
    await sleep(220);
    const combined = await photonGeocodeCombinedIntersection(arm1, arm2);
    if (combined && isInMadisonBbox(combined)) return combined;

    // 4. Last resort: per-arm averaging. Only trusted when both Photon
    //    responses land close to one another (≤ 600m) — averaging two street
    //    centroids on opposite sides of the city gives a meaningless midpoint,
    //    so in that case we'd rather return null and let the caller skip the
    //    intersection than plot it in the wrong place.
    await sleep(220);
    const a = await photonGeocodeStreetArm(arm1);
    await sleep(220);
    const b = await photonGeocodeStreetArm(arm2);
    if (a && b && isInMadisonBbox(a) && isInMadisonBbox(b)) {
        const apart = distanceMeters(a, b);
        if (apart <= 600) {
            const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
            if (isInMadisonBbox(mid)) return mid;
        }
    }
    return null;
}
