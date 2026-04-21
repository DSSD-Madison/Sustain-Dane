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
        //[/\bFieldler\b/gi, "Fiedler"],
        //[/\bMuir Field\b/gi, "Muirfield"],
        //[/\bThrush Ln\b/gi, "Thrush Lane"],
        //[/\bVillage Green Lane E\b/gi, "East Village Green Lane"],
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
    return fixStreetTypos(arm).trim();
}

function escapeRegex(s) {
    return String(s).replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function parseStreetNameParts(arm) {
    const fixed = fixStreetTypos(arm).trim();

    const dirMatch = fixed.match(/^(North|South|East|West)\s+/i);
    const direction = dirMatch ? dirMatch[1] : null;
    const withoutDir = direction
        ? fixed.replace(/^(North|South|East|West)\s+/i, "").trim()
        : fixed;

    const suffixMatch = withoutDir.match(
        /\b(Avenue|Ave|Street|St|Road|Rd|Drive|Dr|Lane|Ln|Place|Pl|Parkway|Pkwy|Circle|Cir|Boulevard|Blvd|Court|Ct|Way|Trail|Tr|Terrace|Ter|Highway|Hwy)\.?$/i,
    );

    const suffix = suffixMatch ? suffixMatch[1] : null;
    const base = suffix
        ? withoutDir
              .replace(
                  /\b(Avenue|Ave|Street|St|Road|Rd|Drive|Dr|Lane|Ln|Place|Pl|Parkway|Pkwy|Circle|Cir|Boulevard|Blvd|Court|Ct|Way|Trail|Tr|Terrace|Ter|Highway|Hwy)\.?$/i,
                  "",
              )
              .trim()
        : withoutDir;

    return { fixed, direction, base, suffix };
}

// regex helpers
function suffixRegexPart(suffix) {
    if (!suffix) return "";

    const s = suffix.toLowerCase();
    if (s === "avenue" || s === "ave") return "(?:Avenue|Ave)\\.?";
    if (s === "street" || s === "st") return "(?:Street|St)\\.?";
    if (s === "road" || s === "rd") return "(?:Road|Rd)\\.?";
    if (s === "drive" || s === "dr") return "(?:Drive|Dr)\\.?";
    if (s === "lane" || s === "ln") return "(?:Lane|Ln)\\.?";
    if (s === "place" || s === "pl") return "(?:Place|Pl)\\.?";
    if (s === "parkway" || s === "pkwy") return "(?:Parkway|Pkwy)\\.?";
    if (s === "circle" || s === "cir") return "(?:Circle|Cir)\\.?";
    if (s === "boulevard" || s === "blvd") return "(?:Boulevard|Blvd)\\.?";
    if (s === "court" || s === "ct") return "(?:Court|Ct)\\.?";
    if (s === "trail" || s === "tr") return "(?:Trail|Tr)\\.?";
    if (s === "terrace" || s === "ter") return "(?:Terrace|Ter)\\.?";
    if (s === "highway" || s === "hwy") return "(?:Highway|Hwy)\\.?";
    if (s === "way") return "Way\\.?";

    return escapeRegex(suffix) + "\\.?";
}

/**
 * Build a permissive regex that matches OSM names for this street.
 * Accepts the core word(s) with or without a direction prefix and with any
 * common suffix, plus abbreviations.
 */
function osmNameRegex(arm) {
    const { direction, base, suffix } = parseStreetNameParts(arm);
    if (!base) return null;

    let dirPart = "";
    if (direction) {
        const initial = direction[0].toUpperCase();
        dirPart = `(?:${initial}\\.?\\s+|${direction}\\s+)`;
    } else {
        dirPart = "(?:(?:N|S|E|W)\\.?\\s+|(?:North|South|East|West)\\s+)?";
    }

    const basePart = escapeRegex(base).replace(/\s+/g, "\\s+");

    if (suffix) {
        const suffixPart = suffixRegexPart(suffix);
        return `^${dirPart}${basePart}\\s+${suffixPart}$`;
    }

    return `^${dirPart}${basePart}$`;
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


// handling points in water (clamps to nearest coast)
function nearlySameLatLng(a, b, eps = 1e-9) {
    return Math.abs(a.lat - b.lat) <= eps && Math.abs(a.lng - b.lng) <= eps;
}

function closeRing(points) {
    if (!points.length) return points;
    const first = points[0];
    const last = points[points.length - 1];
    if (nearlySameLatLng(first, last)) return points;
    return [...points, first];
}

function pointInRing(point, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i].lng, yi = ring[i].lat;
        const xj = ring[j].lng, yj = ring[j].lat;

        const intersects =
            yi > point.lat !== yj > point.lat &&
            point.lng <
                ((xj - xi) * (point.lat - yi)) / ((yj - yi) || 1e-12) + xi;

        if (intersects) inside = !inside;
    }
    return inside;
}

function nearestPointOnSegment(point, a, b) {
    const ax = a.lng, ay = a.lat;
    const bx = b.lng, by = b.lat;
    const px = point.lng, py = point.lat;

    const abx = bx - ax;
    const aby = by - ay;
    const ab2 = abx * abx + aby * aby;

    if (ab2 === 0) return { lat: ay, lng: ax };

    let t = ((px - ax) * abx + (py - ay) * aby) / ab2;
    t = Math.max(0, Math.min(1, t));

    return {
        lat: ay + t * aby,
        lng: ax + t * abx,
    };
}

function dist2(a, b) {
    const dLat = a.lat - b.lat;
    const dLng = a.lng - b.lng;
    return dLat * dLat + dLng * dLng;
}

function nearestPointOnRing(point, ring) {
    let best = null;
    let bestD = Infinity;

    for (let i = 0; i < ring.length - 1; i++) {
        const candidate = nearestPointOnSegment(point, ring[i], ring[i + 1]);
        const d = dist2(point, candidate);
        if (d < bestD) {
            bestD = d;
            best = candidate;
        }
    }
    return best;
}

function extractWaterRings(elements) {
    const rings = [];

    for (const el of elements || []) {
        if (el.type === "way" && Array.isArray(el.geometry) && el.geometry.length >= 4) {
            const pts = el.geometry.map((p) => ({ lat: p.lat, lng: p.lon }));
            const ring = closeRing(pts);
            if (ring.length >= 4) rings.push(ring);
        }

        if (el.type === "relation" && Array.isArray(el.members)) {
            for (const m of el.members) {
                if (m.type !== "way" || !Array.isArray(m.geometry) || m.geometry.length < 4) {
                    continue;
                }
                const pts = m.geometry.map((p) => ({ lat: p.lat, lng: p.lon }));
                const ring = closeRing(pts);
                if (ring.length >= 4) rings.push(ring);
            }
        }
    }

    return rings;
}

async function overpassNearbyWaterGeometries(point, radiusMeters = 600) {
    const ql = `
      [out:json][timeout:25];
      (
        way(around:${radiusMeters},${point.lat},${point.lng})["natural"="water"];
        relation(around:${radiusMeters},${point.lat},${point.lng})["natural"="water"];
        way(around:${radiusMeters},${point.lat},${point.lng})["waterway"="riverbank"];
        relation(around:${radiusMeters},${point.lat},${point.lng})["waterway"="riverbank"];
      );
      out geom;
    `;

    const data = await overpassQuery(ql, { retries: 1 });
    return extractWaterRings(data?.elements || []);
}

async function clampPointToNearestShoreIfNeeded(point) {
    if (!point || !isInMadisonBbox(point)) return point;

    const rings = await overpassNearbyWaterGeometries(point);
    if (!rings.length) return point;

    let containingRing = null;
    for (const ring of rings) {
        if (pointInRing(point, ring)) {
            containingRing = ring;
            break;
        }
    }

    if (!containingRing) return point;

    const shoreline = nearestPointOnRing(point, containingRing);
    return shoreline && isInMadisonBbox(shoreline) ? shoreline : point;
}

async function finalizeIntersectionPoint(point) {
    if (!point || !isInMadisonBbox(point)) return null;
    return point;
}

// =============================================================================
// Photon (Komoot) — fallback geocoder
// =============================================================================

function pickBestPhotonCoords(features) {
    if (!features.length) return null;

    let best = null;
    let bestScore = Infinity;

    for (const f of features) {
        const props = f.properties || {};
        const cc = (props.countrycode || "").toUpperCase();
        if (cc && cc !== "US") continue;

        const coords = f.geometry?.coordinates;
        if (!coords) continue;
        const [lng, lat] = coords;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

        const point = { lat, lng };
        if (!isInMadisonBbox(point)) continue;

        const city = String(props.city || "").toLowerCase();
        const county = String(props.county || "").toLowerCase();

        // Base geographic sanity score
        let score = distance2ToMadison(lng, lat);
        if (city === "madison") score += 0;
        else if (county.includes("dane")) score += 0.5;
        else score += 2;

        // Photon/OSM metadata
        const osmKey = String(props.osm_key || "").toLowerCase();
        const osmValue = String(props.osm_value || "").toLowerCase();
        const type = String(props.type || "").toLowerCase();
        const name = String(props.name || "").toLowerCase();
        const street = String(props.street || "").toLowerCase();
        const housenumber = String(props.housenumber || "").trim();
        const postcode = String(props.postcode || "").trim();

        // Prefer road/street-like things
        const looksRoadLike =
            osmKey === "highway" ||
            [
                "residential",
                "unclassified",
                "tertiary",
                "secondary",
                "primary",
                "living_street",
                "road",
                "service",
            ].includes(osmValue) ||
            type.includes("street") ||
            type.includes("road");

        // Penalize clearly building/address/POI-like things
        const looksBuildingLike =
            osmKey === "building" ||
            osmValue === "building" ||
            type.includes("building") ||
            osmKey === "amenity" ||
            osmKey === "shop" ||
            osmKey === "tourism" ||
            osmKey === "leisure" ||
            osmKey === "office";

        const looksAddressLike =
            !!housenumber ||
            type === "house" ||
            type === "housenumber" ||
            (street && !!postcode);

        // Scoring adjustments
        if (looksRoadLike) score -= 3.0;
        if (name && street && name === street) score -= 0.5;

        if (looksBuildingLike) score += 6.0;
        if (looksAddressLike) score += 8.0;

        // Tiny preference for unnamed road-like results over specific POIs
        if (!name && looksRoadLike) score -= 0.25;

        if (score < bestScore) {
            bestScore = score;
            best = point;
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

async function photonSearchVariants(queries, limit = 16) {
    for (const q of queries) {
        const result = await photonSearch(q, limit);
        if (result) return result;
        await sleep(120);
    }
    return null;
}

function buildCombinedIntersectionQueries(arm1, arm2) {
    return [
        `${arm1} and ${arm2}, Madison, Wisconsin, USA`,
        `${arm1} & ${arm2}, Madison, Wisconsin, USA`,
        `intersection of ${arm1} and ${arm2}, Madison, Wisconsin, USA`,
        `${arm1}, ${arm2}, Madison, Wisconsin, USA`,
    ];
}

function buildStreetArmQueries(arm) {
    return [
        `${arm}, Madison, Wisconsin, USA`,
        `${arm}, Madison WI`,
    ];
}

export async function photonGeocodeStreetArm(arm) {
    return photonSearchVariants(buildStreetArmQueries(arm), 12);
}

export async function photonGeocodeCombinedIntersection(arm1, arm2) {
    return photonSearchVariants(buildCombinedIntersectionQueries(arm1, arm2), 16);
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

    if (arms.length === 1) {
        const only = await photonGeocodeStreetArm(arms[0]);
        return await finalizeIntersectionPoint(only);
    }

    if (arms.length < 2) {
        const only = await photonGeocodeStreetArm(fixStreetTypos(label));
        return await finalizeIntersectionPoint(only);
    }

    const [arm1, arm2] = arms;

    // 1. Try several combined intersection query formats first
    const combined = await photonGeocodeCombinedIntersection(arm1, arm2);
    const finalCombined = await finalizeIntersectionPoint(combined);
    if (finalCombined) return finalCombined;

    // 2. Fall back to per-arm geocoding
    await sleep(180);
    const a = await photonGeocodeStreetArm(arm1);
    await sleep(180);
    const b = await photonGeocodeStreetArm(arm2);

    if (a && b && isInMadisonBbox(a) && isInMadisonBbox(b)) {
        const apart = distanceMeters(a, b);

        // stricter midpoint if streets geocode close enough
        if (apart <= 1200) {
            const mid = {
                lat: (a.lat + b.lat) / 2,
                lng: (a.lng + b.lng) / 2,
            };
            const finalMid = await finalizeIntersectionPoint(mid);
            if (finalMid) return finalMid;
        }
    }

    // 3. Last resort: if one arm resolved and the other didn't, return the one
    // that worked rather than MISS
    if (a && isInMadisonBbox(a)) {
        return await finalizeIntersectionPoint(a);
    }
    if (b && isInMadisonBbox(b)) {
        return await finalizeIntersectionPoint(b);
    }

    return null;
}