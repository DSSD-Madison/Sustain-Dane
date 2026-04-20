/** Geocode cross-street labels in the Madison, WI area via Photon (Komoot). */

export const MADISON_CENTER = { lat: 43.073, lng: -89.401 };

export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function fixStreetTypos(segment) {
    let s = String(segment ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\.$/, "");
    // Expand common abbreviations so Photon matches OSM better
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
        .replace(/\bPl\b\.?$/i, "Place")
        .replace(/\bPkwy\b\.?$/i, "Parkway")
        .replace(/\bCir\b\.?$/i, "Circle");
    const fixes = [
        [/\bManona\b/gi, "Monona"],
        [/\bWillage\b/gi, "Village"],
        // City data entry "Fieldler" — OSM uses "Fiedler" (W Badger & Fiedler)
        [/\bFieldler\b/gi, "Fiedler"],
        [/\bMuir Field\b/gi, "Muirfield"],
        [/\bThrush Ln\b/gi, "Thrush Lane"],
        // Excel uses "… Green Lane E"; OSM uses "East Village Green Lane" in places
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

/**
 * Geocode a freeform address or place (biased toward Madison area).
 */
export async function geocodeFreeformAddress(address) {
    const raw = String(address ?? "").trim();
    if (!raw) return null;
    const hasContext = /madison|dane|wi\b|wisconsin/i.test(raw);
    const q = hasContext ? raw : `${raw}, Madison, Wisconsin, USA`;
    return photonSearch(q, 16);
}

async function photonSearch(query, limit = 12) {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lon=${MADISON_CENTER.lng}&lat=${MADISON_CENTER.lat}&limit=${limit}&lang=en`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return pickBestPhotonCoords(data.features || []);
}

/**
 * Geocode a single street name (or place) near Madison.
 */
export async function photonGeocodeStreetArm(arm) {
    return photonSearch(`${arm}, Madison, Wisconsin, USA`);
}

/**
 * Single Photon query with both street names (finds named intersections or nearby POIs).
 */
export async function photonGeocodeCombinedIntersection(arm1, arm2) {
    return photonSearch(`${arm1} ${arm2}, Madison, Wisconsin, USA`, 16);
}

/**
 * "A St / B Ave" → midpoint of geocoded arms (works when intersection search fails).
 */
export async function geocodeCrossStreetIntersection(label) {
    const arms = splitCrossStreetArms(label);
    if (arms.length >= 2) {
        const a = await photonGeocodeStreetArm(arms[0]);
        await sleep(220);
        const b = await photonGeocodeStreetArm(arms[1]);
        let result = null;
        if (a && b) {
            result = {
                lat: (a.lat + b.lat) / 2,
                lng: (a.lng + b.lng) / 2,
            };
        } else {
            result = a || b;
        }
        if (!result) {
            await sleep(220);
            result = await photonGeocodeCombinedIntersection(arms[0], arms[1]);
        }
        return result;
    }
    if (arms.length === 1) {
        return photonGeocodeStreetArm(arms[0]);
    }
    return photonGeocodeStreetArm(fixStreetTypos(label));
}
