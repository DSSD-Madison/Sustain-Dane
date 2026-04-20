import React, { useEffect, useState, useRef } from "react";
import * as XLSX from "xlsx";
import {
  MapContainer,
  TileLayer,
  Marker,
  Circle,
  CircleMarker,
  Polyline,
  ZoomControl,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import {
  geocodeCrossStreetIntersection,
  geocodeFreeformAddress,
  distanceMeters,
  sleep,
} from "@/lib/madisonGeocode.js";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import "leaflet/dist/leaflet.css";

// --- OLD HARD-CODED SAMPLE DATA (replaced by automatic loading) ---
/*
const data = [
    {
        id: 1,
        street: "University Ave / N Midvale Blvd",
        coordinate: { lat: 43.0751656, lng: -89.4503393 },
        story: "This historic Madison intersection underwent a revitalization in 2023, focusing on cycling infrastructure and AI-driven traffic signal timing. These changes reduced vehicle idling time and significantly boosted active transit usage.",
        infos: [{ co2: 470, kWh: 120, co2Goal: 1000, kWhGoal: 500 }]
    },
    {
        id: 2,
        street: "Capitol Square",
        coordinate: { lat: 43.0747, lng: -89.3841 },
        story: "The heart of Madison. The 'Green Square' initiative implemented green roofs on surrounding government buildings and expanded pedestrian-only zones during summer, resulting in substantial energy savings and emission cuts.",
        infos: [{ co2: 850, kWh: 310, co2Goal: 1000, kWhGoal: 500 }]
    }
];
*/

const TARGET_SHEETS = [
  "OEI by Measure",
  "CDBG and ARPA by Measure",
  "Madison Capital 2024",
  "Madison Capital & EECBG 2025",
];

const EXCEL_URL_CANDIDATES = [
  "/Efficiency Navigator Program - Data Support Group.xlsx",
  "/data/Efficiency Navigator Program - Data Support Group (2).xlsx",
];

const COORD_JSON_URL = "/data/cross_street_coords.json";

const GEOCODE_CACHE_KEY = "sustain-dane-intersection-geocode-v2";

function readGeoCache() {
  try {
    const raw = sessionStorage.getItem(GEOCODE_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeGeoCache(cache) {
  try {
    sessionStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* private mode */
  }
}

async function fetchFirstOk(urls) {
  for (const url of urls) {
    const r = await fetch(url);
    if (r.ok) return r;
  }
  return null;
}

const MARKER_REFERENCE_ZOOM = 14;

/** Screen-pixel scale: smaller markers when zoomed out, larger when zoomed in. */
function markerScaleForZoom(zoom) {
  const delta = zoom - MARKER_REFERENCE_ZOOM;
  return Math.min(1.9, Math.max(0.38, Math.pow(1.35, delta)));
}

function FitMapToData({ points, geolocationSettled, browserGeo }) {
  const map = useMap();
  useEffect(() => {
    if (!points?.length || !geolocationSettled) return;
    if (browserGeo) return;
    const latlngs = points.map((p) => [p.coordinate.lat, p.coordinate.lng]);
    if (latlngs.length === 1) {
      map.setView(latlngs[0], 15);
      return;
    }
    const b = L.latLngBounds(latlngs);
    map.fitBounds(b, { padding: [64, 64], maxZoom: 15 });
  }, [map, points, geolocationSettled, browserGeo]);
  return null;
}

/** After the user allows browser location, zoom to their nearest intersection (once). */
function FlyToNearestFromBrowserGeo({ userPoint, points }) {
  const map = useMap();
  const didRunRef = useRef(false);

  useEffect(() => {
    if (!userPoint || !points?.length || didRunRef.current) return;
    const result = findClosestIntersection(userPoint, points);
    if (!result) return;
    didRunRef.current = true;
    const { intersection, meters } = result;
    const intersectionLatLng = [
      intersection.coordinate.lat,
      intersection.coordinate.lng,
    ];
    if (meters > 150_000) {
      map.setView(intersectionLatLng, 14);
      return;
    }
    const b = L.latLngBounds(
      [userPoint.lat, userPoint.lng],
      intersectionLatLng,
    );
    map.fitBounds(b, { padding: [72, 72], maxZoom: 16, animate: true });
  }, [map, userPoint, points]);

  return null;
}

/** Keeps React state in sync with map zoom (batched with rAF for smooth zoom animations). */
/** Close the detail sidebar when the map (not a marker) is clicked. */
function MapClickCloseSidebar({ hasSelection, suppressRef, onClose }) {
  useMapEvents({
    click: () => {
      if (suppressRef.current) return;
      if (hasSelection) onClose();
    },
  });
  return null;
}

function MapZoomSync({ onZoomChange }) {
  const map = useMap();
  const rafRef = useRef(0);

  useEffect(() => {
    const emit = () => {
      const z = map.getZoom();
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        onZoomChange(z);
      });
    };
    map.on("zoom zoomend", emit);
    onZoomChange(map.getZoom());
    return () => {
      cancelAnimationFrame(rafRef.current);
      map.off("zoom zoomend", emit);
    };
  }, [map, onZoomChange]);

  return null;
}

function FlyToAddressSearch({ userPoint, intersection }) {
  const map = useMap();
  useEffect(() => {
    if (!userPoint || !intersection?.coordinate) return;
    const b = L.latLngBounds(
      [userPoint.lat, userPoint.lng],
      [intersection.coordinate.lat, intersection.coordinate.lng],
    );
    map.fitBounds(b, { padding: [72, 72], maxZoom: 16 });
  }, [map, userPoint, intersection]);
  return null;
}

function formatDistanceMeters(m) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function findClosestIntersection(userCoord, intersections) {
  if (!userCoord || !intersections?.length) return null;
  let best = null;
  let bestM = Infinity;
  for (const item of intersections) {
    const m = distanceMeters(userCoord, item.coordinate);
    if (m < bestM) {
      bestM = m;
      best = item;
    }
  }
  return best ? { intersection: best, meters: bestM } : null;
}

// helper functions copied from old TraceMap
function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function splitStreetParts(original) {
  const cleaned = normalizeText(original);
  const parts = cleaned.split("/").map((s) => s.trim());
  return {
    streetA: parts[0] ?? cleaned,
    streetB: parts[1] ?? "",
  };
}

function resolveCrossStreetHeader(headers) {
  for (const header of headers) {
    const lower = String(header).toLowerCase().trim();
    if (lower.includes("cross street")) return header;
    if (lower.includes("cross") && lower.includes("street")) return header;
  }
  return null;
}

/** Keys in cross_street_coords.json may not match Excel spacing/casing. */
function coordKeyForLookup(name) {
  return normalizeText(name)
    .toLowerCase()
    .replace(/\s*\/\s*/g, " / ");
}

function buildCoordLookup(raw) {
  const lookup = new globalThis.Map();
  if (!raw || typeof raw !== "object") return lookup;
  for (const [key, value] of Object.entries(raw)) {
    const coord = normalizeCoordinate(value);
    if (!coord) continue;
    const canon = coordKeyForLookup(key);
    const trimmed = normalizeText(key);
    lookup.set(canon, coord);
    if (trimmed !== canon) lookup.set(trimmed, coord);
  }
  return lookup;
}

function normalizeCoordinate(raw) {
  if (!raw || typeof raw !== "object") return null;
  const lat = Number(raw.lat ?? raw.latitude);
  const lng = Number(raw.lng ?? raw.lon ?? raw.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function getCoordForStreet(lookup, original) {
  const k = coordKeyForLookup(original);
  if (lookup.has(k)) return lookup.get(k);
  const trimmed = normalizeText(original);
  if (lookup.has(trimmed)) return lookup.get(trimmed);
  return null;
}

/** Shown when Excel/coords are missing or no rows match; keeps the map usable in dev. */
const DEMO_INTERSECTIONS = [
  {
    id: 1,
    original: "University Ave / N Midvale Blvd",
    street: "University Ave / N Midvale Blvd",
    streetA: "University Ave",
    streetB: "N Midvale Blvd",
    coordinate: { lat: 43.0751656, lng: -89.4503393 },
    story:
      "This historic Madison intersection underwent a revitalization in 2023, focusing on cycling infrastructure and traffic signal timing. These changes reduced vehicle idling time and boosted active transit usage.",
    infos: [
      {
        implement: "Sample measure (add public/data files for live data)",
        co2: 470,
        kWh: 120,
        VMT: 0,
        co2Goal: 1000,
        kWhGoal: 500,
      },
    ],
  },
  {
    id: 2,
    original: "Capitol Square",
    street: "Capitol Square",
    streetA: "Capitol Square",
    streetB: "",
    coordinate: { lat: 43.0747, lng: -89.3841 },
    story:
      "The heart of Madison. Green infrastructure and pedestrian zones support lower emissions downtown.",
    infos: [
      {
        implement: "Sample measure (add public/data files for live data)",
        co2: 850,
        kWh: 310,
        VMT: 0,
        co2Goal: 1000,
        kWhGoal: 500,
      },
    ],
  },
];

function resolveImplementationValue(row, headers, sheetName) {
  if (sheetName === "CDBG and ARPA by Measure") {
    const headerIndex = headers.findIndex((h) =>
      String(h).toLowerCase().includes("implementation"),
    );

    if (headerIndex > 0) {
      const leftHeader = headers[headerIndex - 1];
      const leftValue = row[leftHeader];
      if (normalizeText(leftValue) !== "") return leftValue;
    }
  }

  if (normalizeText(row["Implementation: Implementation"]) !== "") {
    return row["Implementation: Implementation"];
  }

  if (normalizeText(row["Implementation"]) !== "") {
    return row["Implementation"];
  }

  for (const header of headers) {
    const lower = String(header).toLowerCase().trim();

    if (
      lower.includes("implementation") ||
      lower.includes("therms projected")
    ) {
      const value = row[header];
      if (typeof value === "string" && normalizeText(value) !== "") {
        return value;
      }
    }
  }

  for (let i = 0; i < headers.length; i++) {
    const lower = String(headers[i]).toLowerCase().trim();
    if (
      lower.includes("implementation") ||
      lower.includes("therms projected")
    ) {
      if (i > 0) {
        const leftHeader = headers[i - 1];
        const leftValue = row[leftHeader];
        if (typeof leftValue === "string" && normalizeText(leftValue) !== "") {
          return leftValue;
        }
      }
    }
  }

  return "";
}

function parseWorkbook(workbook) {
  const streetMap = new globalThis.Map();

  for (const sheetName of TARGET_SHEETS) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json(sheet, {
      defval: "",
      raw: true,
    });

    if (!rows.length) continue;

    const headers = Object.keys(rows[0]);
    const crossStreetHeader = resolveCrossStreetHeader(headers);

    if (!crossStreetHeader) continue;

    let currentStreet = "";

    for (const row of rows) {
      const rowStreet = normalizeText(row[crossStreetHeader]);

      if (rowStreet !== "") {
        currentStreet = rowStreet;
      }

      if (currentStreet === "") continue;

      const implementation = normalizeText(
        resolveImplementationValue(row, headers, sheetName),
      );

      const kWh = toNumber(row["kWh Projected Savings"]);
      const co2 = toNumber(row["Yearly CO2 Emissions Savings (kg)"]);
      const VMT = toNumber(row["Projected VMT Avoided"]);

      if (!streetMap.has(currentStreet)) {
        const parts = splitStreetParts(currentStreet);
        streetMap.set(currentStreet, {
          original: currentStreet,
          street: currentStreet, // added for compatibility with existing Leaflet UI
          streetA: parts.streetA,
          streetB: parts.streetB,
          infos: [],
        });
      }

      if (
        implementation !== "" &&
        !implementation.toLowerCase().includes("total measures")
      ) {
        streetMap.get(currentStreet).infos.push({
          implement: implementation,
          co2,
          kWh,
          VMT,
          // keep existing donut-chart UI working
          co2Goal: 1000,
          kWhGoal: 500,
        });
      }
    }
  }

  return Array.from(streetMap.values());
}

/** ~kg CO₂ per mile, typical passenger car (EPA order-of-magnitude). */
const KG_CO2_PER_CAR_MILE = 0.404;
/** ~kg CO₂ per gallon gasoline combusted (well-to-pump ballpark). */
const KG_CO2_PER_GALLON_GAS = 8.89;

function formatEverydayMiles(miles) {
  if (miles < 1.5) return "about 1";
  if (miles < 10)
    return String(Math.round(miles * 10) / 10).replace(/\.0$/, "");
  if (miles < 100) return String(Math.round(miles));
  return String(Math.round(miles / 5) * 5);
}

function formatGasGallons(gal) {
  if (gal < 10) return String(Math.round(gal * 10) / 10).replace(/\.0$/, "");
  return String(Math.round(gal));
}

/** Plain-language CO₂ context for non-expert readers. */
function SidebarCo2Explainer({ kgAnnual }) {
  const kg = Math.max(0, Number(kgAnnual) || 0);
  const milesEq = kg > 0 ? kg / KG_CO2_PER_CAR_MILE : 0;
  const galEq = kg > 0 ? kg / KG_CO2_PER_GALLON_GAS : 0;

  return (
    <div
      style={{
        marginTop: "12px",
        padding: "14px 16px",
        background: "#fafafa",
        borderRadius: "12px",
        border: "1px solid #e7e5e4",
      }}
    >
      <p
        style={{
          fontSize: "13px",
          color: "#44403c",
          lineHeight: 1.65,
          margin: "0 0 10px 0",
        }}
      >
        <strong style={{ color: "#292524" }}>What this number means:</strong>{" "}
        Carbon dioxide (CO₂) is a greenhouse gas that traps heat in the
        atmosphere. The figure above is an{" "}
        <strong>estimated yearly amount</strong> of CO₂ this work helps{" "}
        <strong>avoid releasing</strong>—for example from using less energy or
        burning less fuel—compared to not doing the upgrade.
      </p>
      {kg <= 0 ? (
        <p
          style={{
            fontSize: "13px",
            color: "#78716c",
            lineHeight: 1.65,
            margin: 0,
            fontStyle: "italic",
          }}
        >
          Data not available for this intersection’s CO₂ savings.
        </p>
      ) : (
        <p
          style={{
            fontSize: "13px",
            color: "#44403c",
            lineHeight: 1.65,
            margin: 0,
          }}
        >
          <strong style={{ color: "#292524" }}>In everyday terms:</strong>{" "}
          {milesEq < 2 ? (
            <>
              This is a smaller yearly amount, but small savings add up across
              many buildings. Even modest cuts help slow climate change over
              time.
            </>
          ) : (
            <>
              As a rough comparison only: it is in the same ballpark as the
              pollution from driving a typical passenger car about{" "}
              <strong>{formatEverydayMiles(milesEq)} miles</strong>, or burning
              about <strong>{formatGasGallons(galEq)} gallons</strong> of
              gasoline. Real projects will differ; think of this as a relatable
              scale, not an exact match.
            </>
          )}
        </p>
      )}
      <p
        style={{
          fontSize: "11px",
          color: "#a8a29e",
          lineHeight: 1.5,
          margin: "12px 0 0 0",
        }}
      >
        * These are all estimates. For decisions or more accurate reporting,
        contact Sustain Dane.
      </p>
    </div>
  );
}

/** Rough equivalents for “everyday terms” (order-of-magnitude only). */
const KWH_PER_HAIR_DRYER_KW = 1;
const KWH_PER_FRIDGE_YEAR = 450;

/** Plain-language kWh / energy context for non-expert readers. */
function SidebarKwhExplainer({ kwhAnnual }) {
  const raw = Number(kwhAnnual);
  const kwh = Number.isFinite(raw) ? Math.max(0, raw) : 0;
  const dryerHoursAt1kW = kwh > 0 ? kwh / KWH_PER_HAIR_DRYER_KW : 0;
  const fridgeShare = kwh > 0 ? (kwh / KWH_PER_FRIDGE_YEAR) * 100 : 0;

  return (
    <div
      style={{
        marginTop: "12px",
        padding: "14px 16px",
        background: "#f8fafc",
        borderRadius: "12px",
        border: "1px solid #e2e8f0",
      }}
    >
      <p
        style={{
          fontSize: "13px",
          color: "#334155",
          lineHeight: 1.65,
          margin: "0 0 10px 0",
        }}
      >
        <strong style={{ color: "#1e293b" }}>What this number means:</strong> A{" "}
        <strong>kilowatt-hour (kWh)</strong> is a unit of{" "}
        <strong>energy</strong>—how much electricity you use over time. On a
        utility bill, your usage is often listed in kWh. The figure above is an{" "}
        <strong>estimated yearly amount</strong> of electricity this work helps{" "}
        <strong>save</strong> (less power needed for heating, cooling, lighting,
        and equipment) compared to not doing the upgrade.
      </p>
      {Number.isFinite(raw) && raw < 0 ? (
        <p
          style={{
            fontSize: "13px",
            color: "#64748b",
            lineHeight: 1.65,
            margin: 0,
            fontStyle: "italic",
          }}
        >
          This row has a <strong>negative</strong> kWh value in the data. That
          can happen from how savings are modeled or from a data entry issue.
          The ring chart treats it as <strong>no progress</strong> toward the
          goal so the graphic stays readable.
        </p>
      ) : kwh <= 0 ? (
        <p
          style={{
            fontSize: "13px",
            color: "#64748b",
            lineHeight: 1.65,
            margin: 0,
            fontStyle: "italic",
          }}
        >
          Data not available for this intersection’s electricity savings.
        </p>
      ) : dryerHoursAt1kW < 3 ? (
        <p
          style={{
            fontSize: "13px",
            color: "#334155",
            lineHeight: 1.65,
            margin: 0,
          }}
        >
          <strong style={{ color: "#1e293b" }}>In everyday terms:</strong> This
          is a smaller yearly amount on its own, but small savings add up across
          many homes and buildings. A kilowatt-hour is still the same idea:
          about one hour of a strong 1,000-watt appliance running at full power.
        </p>
      ) : (
        <p
          style={{
            fontSize: "13px",
            color: "#334155",
            lineHeight: 1.65,
            margin: 0,
          }}
        >
          <strong style={{ color: "#1e293b" }}>In everyday terms:</strong> One
          kWh is about what you use running a <strong>1,000-watt</strong>{" "}
          appliance (like a powerful hair dryer or small space heater on high)
          for <strong>one hour</strong>. So{" "}
          <strong>{Math.round(kwh)} kWh</strong> saved per year is in the same
          ballpark as running that 1,000-watt load for about{" "}
          <strong>{Math.round(dryerHoursAt1kW)} hours</strong> total over the
          year— spread across many devices and seasons in real life. Another
          picture: it is roughly{" "}
          <strong>
            {fridgeShare < 1 ? "under 1" : Math.round(fridgeShare)}%
          </strong>{" "}
          of the electricity a typical home refrigerator might use in a year (
          {KWH_PER_FRIDGE_YEAR} kWh is a common rough estimate). Your building
          will differ; treat this as a relatable scale.
        </p>
      )}
      <p
        style={{
          fontSize: "11px",
          color: "#94a3b8",
          lineHeight: 1.5,
          margin: "12px 0 0 0",
        }}
      >
        * These are all estimates. For decisions or more accurate reporting,
        contact Sustain Dane.
      </p>
    </div>
  );
}

/** ~average car trip length, used only to humanize VMT figures. */
const MILES_PER_AVG_CAR_TRIP = 9;

/** Plain-language VMT (vehicle miles traveled) context. */
function SidebarVmtExplainer({ milesAnnual }) {
  const raw = Number(milesAnnual);
  const miles = Number.isFinite(raw) ? Math.max(0, raw) : 0;
  const tripsAvoided = miles > 0 ? miles / MILES_PER_AVG_CAR_TRIP : 0;
  const co2FromMiles = miles > 0 ? miles * KG_CO2_PER_CAR_MILE : 0;

  return (
    <div
      style={{
        marginTop: "12px",
        padding: "14px 16px",
        background: "#fffbeb",
        borderRadius: "12px",
        border: "1px solid #fde68a",
      }}
    >
      <p
        style={{
          fontSize: "13px",
          color: "#78350f",
          lineHeight: 1.65,
          margin: "0 0 10px 0",
        }}
      >
        <strong style={{ color: "#7c2d12" }}>What this number means:</strong>{" "}
        <strong>VMT</strong> stands for{" "}
        <strong>vehicle miles traveled</strong>—the total miles cars and trucks
        drive. The figure above is an <strong>estimated yearly amount</strong>{" "}
        of driving that this work helps <strong>avoid</strong> (for example,
        through better walking, biking, transit, or trip-reduction options).
      </p>
      {miles <= 0 ? (
        <p
          style={{
            fontSize: "13px",
            color: "#92400e",
            lineHeight: 1.65,
            margin: 0,
            fontStyle: "italic",
          }}
        >
          Data not available for this intersection’s avoided vehicle miles.
        </p>
      ) : (
        <p
          style={{
            fontSize: "13px",
            color: "#78350f",
            lineHeight: 1.65,
            margin: 0,
          }}
        >
          <strong style={{ color: "#7c2d12" }}>In everyday terms:</strong>{" "}
          Avoiding <strong>{Math.round(miles).toLocaleString()} miles</strong>{" "}
          of driving per year is roughly the same as skipping about{" "}
          <strong>{Math.round(tripsAvoided).toLocaleString()}</strong> typical
          car trips (using ~{MILES_PER_AVG_CAR_TRIP} miles per trip as a rough
          average). That also keeps an estimated{" "}
          <strong>{Math.round(co2FromMiles).toLocaleString()} kg of CO₂</strong>{" "}
          out of the air from tailpipes alone.
        </p>
      )}
      <p
        style={{
          fontSize: "11px",
          color: "#a16207",
          lineHeight: 1.5,
          margin: "12px 0 0 0",
        }}
      >
        * These are all estimates. For decisions or more accurate reporting,
        contact Sustain Dane.
      </p>
    </div>
  );
}

/**
 * Summary card that adds up CO₂, kWh, and VMT across every measure listed for
 * the selected intersection (not just the first one shown above).
 */
function SidebarTotalSavings({ infos }) {
  const list = Array.isArray(infos) ? infos : [];
  const totals = list.reduce(
    (acc, info) => {
      const co2 = Number(info?.co2);
      const kwh = Number(info?.kWh);
      const vmt = Number(info?.VMT);
      if (Number.isFinite(co2)) acc.co2 += co2;
      if (Number.isFinite(kwh)) acc.kwh += kwh;
      if (Number.isFinite(vmt)) acc.vmt += vmt;
      return acc;
    },
    { co2: 0, kwh: 0, vmt: 0 },
  );

  const measureCount = list.length;
  const fmt = (n) => Math.round(n).toLocaleString();
  const renderValue = (n, unit, color) => {
    const isMissing = !Number.isFinite(n) || n <= 0;
    return (
      <div
        style={{
          fontSize: isMissing ? "14px" : "18px",
          fontWeight: "800",
          color,
          fontStyle: isMissing ? "italic" : "normal",
        }}
      >
        {isMissing ? "Data not available" : `${fmt(n)} ${unit}`}
      </div>
    );
  };

  return (
    <div
      style={{
        marginTop: "12px",
        padding: "16px",
        background:
          "linear-gradient(135deg, #ecfdf5 0%, #eff6ff 50%, #fff7ed 100%)",
        borderRadius: "15px",
        border: "1px solid #e5e7eb",
      }}
    >
      <h4
        style={{
          margin: "0 0 4px 0",
          fontSize: "15px",
          fontWeight: "800",
          color: "#111827",
        }}
      >
        Total Projected Savings
      </h4>
      <p
        style={{
          margin: "0 0 14px 0",
          fontSize: "12px",
          color: "#6b7280",
        }}
      >
        Combined across{" "}
        <strong>
          {measureCount} measure{measureCount === 1 ? "" : "s"}
        </strong>{" "}
        listed at this intersection.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: "10px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 12px",
            background: "white",
            borderRadius: "10px",
            border: "1px solid #dcfce7",
          }}
        >
          <span style={{ fontSize: "12px", color: "#15803d", fontWeight: 600 }}>
            CO₂ avoided / year
          </span>
          {renderValue(totals.co2, "kg", "#16a34a")}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 12px",
            background: "white",
            borderRadius: "10px",
            border: "1px solid #dbeafe",
          }}
        >
          <span style={{ fontSize: "12px", color: "#1d4ed8", fontWeight: 600 }}>
            Electricity saved / year
          </span>
          {renderValue(totals.kwh, "kWh", "#2563eb")}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 12px",
            background: "white",
            borderRadius: "10px",
            border: "1px solid #ffedd5",
          }}
        >
          <span style={{ fontSize: "12px", color: "#c2410c", fontWeight: 600 }}>
            Vehicle miles avoided / year
          </span>
          {renderValue(totals.vmt, "miles", "#c2410c")}
        </div>
      </div>

      <p
        style={{
          fontSize: "11px",
          color: "#6b7280",
          lineHeight: 1.5,
          margin: "12px 0 0 0",
        }}
      >
        * Totals are the sum of every measure row in the source spreadsheet for
        this intersection. Values of <em>0</em> or missing entries show as “Data
        not available.”
      </p>
    </div>
  );
}

// --- STYLIZED DONUT CHART ---
const DonutChart = ({ value, goal, color }) => {
  const v = Number(value);
  const g = Number(goal);
  const safeGoal =
    Number.isFinite(g) && g > 0 ? g : 500;
  const rawVal = Number.isFinite(v) ? v : 0;
  const achieved = Math.min(Math.max(0, rawVal), safeGoal);
  const remaining = Math.max(0, safeGoal - achieved);

  const chartData = [
    { name: "Achieved", value: achieved },
    { name: "Remaining", value: remaining },
  ];

  return (
    <div
      style={{
        width: "132px",
        height: "132px",
        flexShrink: 0,
        minWidth: "132px",
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart
          margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
          style={{ overflow: "visible" }}
        >
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius="34%"
            outerRadius="48%"
            paddingAngle={2}
            dataKey="value"
            startAngle={90}
            endAngle={-270}
            stroke="none"
          >
            <Cell fill={color} stroke="none" />
            <Cell fill="#f3f4f6" stroke="none" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

// --- Map pin + crossroads (size follows zoom; anchor = tip of pin) ---
function createIntersectionIcon(isActive, zoom = MARKER_REFERENCE_ZOOM) {
  const scale = markerScaleForZoom(zoom);
  const baseW = isActive ? 36 : 28;
  const w = Math.round(Math.min(52, Math.max(20, baseW * scale)));
  const h = Math.round(w * 1.28);
  const shadowY = Math.max(2, Math.round(5 * scale));
  const shadowBlur = Math.max(3, Math.round(10 * scale));
  const pinFill = isActive ? "#15803d" : "#16a34a";
  const pinStroke = isActive ? "#14532d" : "#166534";
  const sw = isActive ? 1.35 : 1.05;
  const crossOpacity = isActive ? 1 : 0.95;

  return L.divIcon({
    className: "custom-marker intersection-marker",
    html: `
      <div style="
        width:${w}px;
        height:${h}px;
        filter: drop-shadow(0 ${shadowY}px ${shadowBlur}px rgba(0,0,0,0.22));
        cursor: pointer;
      ">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 42" width="${w}" height="${h}" style="display:block" aria-hidden="true">
          <path d="M16 2.2c-5.8 0-10.2 4.5-10.2 10.1 0 3.1 1.4 5.8 2.8 8.1l7.4 12.8 7.4-12.8c1.4-2.3 2.8-5 2.8-8.1C26.2 6.7 21.8 2.2 16 2.2z"
            fill="${pinFill}" stroke="${pinStroke}" stroke-width="${sw}" stroke-linejoin="round"/>
          <g transform="translate(16 14.5)" opacity="${crossOpacity}">
            <rect x="-1.25" y="-6.75" width="2.5" height="13.5" rx="0.45" fill="#ffffff"/>
            <rect x="-6.75" y="-1.25" width="13.5" height="2.5" rx="0.45" fill="#ffffff"/>
          </g>
        </svg>
      </div>`,
    iconSize: [w, h],
    iconAnchor: [Math.round(w / 2), h],
  });
}

export default function SustainabilityDashboard() {
  const [hoveredId, setHoveredId] = useState(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState(null);

  // new automatic data state
  const [data, setData] = useState([]);
  const [loadNotice, setLoadNotice] = useState(null);
  const [mapLoading, setMapLoading] = useState(null);

  const [addressInput, setAddressInput] = useState("");
  const [addressSearchLoading, setAddressSearchLoading] = useState(false);
  const [addressSearchError, setAddressSearchError] = useState(null);
  const [searchUserPoint, setSearchUserPoint] = useState(null);
  const [searchNearest, setSearchNearest] = useState(null);
  const [searchDistanceM, setSearchDistanceM] = useState(null);
  const [mapZoom, setMapZoom] = useState(MARKER_REFERENCE_ZOOM);
  const [browserGeo, setBrowserGeo] = useState(null);
  const [geolocationSettled, setGeolocationSettled] = useState(false);
  const mapClickSuppressCloseRef = useRef(false);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeolocationSettled(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBrowserGeo({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setGeolocationSettled(true);
      },
      () => setGeolocationSettled(true),
      {
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 300000,
      },
    );
  }, []);

  useEffect(() => {
    async function loadAutoLocations() {
      try {
        setMapLoading("Loading workbook…");
        setLoadNotice(null);

        const excelResponse = await fetchFirstOk(EXCEL_URL_CANDIDATES);
        if (!excelResponse) {
          console.warn("Efficiency Navigator workbook not found in public/");
          setMapLoading(null);
          setLoadNotice(
            "Add Efficiency Navigator Program - Data Support Group.xlsx to sustain/public/ (or public/data/). Showing sample intersections.",
          );
          setData(DEMO_INTERSECTIONS);
          return;
        }

        const arrayBuffer = await excelResponse.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: "array" });
        const parsedPoints = parseWorkbook(workbook);

        let coordJson = {};
        const coordResponse = await fetch(COORD_JSON_URL);
        if (coordResponse.ok) {
          try {
            coordJson = await coordResponse.json();
          } catch {
            coordJson = {};
          }
        }

        const coordLookup = buildCoordLookup(coordJson);
        const geoCache = readGeoCache();
        let geocodedLive = 0;
        const pointsWithCoords = [];

        for (let i = 0; i < parsedPoints.length; i++) {
          const point = parsedPoints[i];
          setMapLoading(
            `Plotting intersections… ${i + 1} / ${parsedPoints.length}`,
          );

          let coordinate = getCoordForStreet(coordLookup, point.original);
          const cacheKey = coordKeyForLookup(point.original);
          if (!coordinate && geoCache[cacheKey]) {
            coordinate = geoCache[cacheKey];
          }
          if (!coordinate) {
            coordinate = await geocodeCrossStreetIntersection(point.original);
            if (coordinate) {
              geoCache[cacheKey] = coordinate;
              writeGeoCache(geoCache);
              geocodedLive++;
            }
            await sleep(100);
          }

          if (!coordinate) continue;

          pointsWithCoords.push({
            ...point,
            id: pointsWithCoords.length + 1,
            coordinate,
            story: point.infos?.[0]?.implement || "No story available yet.",
          });
        }

        setMapLoading(null);

        if (pointsWithCoords.length === 0) {
          console.warn(
            "No intersections could be placed on the map. Parsed:",
            parsedPoints.length,
          );
          setLoadNotice(
            parsedPoints.length === 0
              ? "No rows were parsed from the workbook (check sheet names and Cross Street column). Showing sample intersections."
              : "Could not geocode any intersections. Showing sample intersections.",
          );
          setData(DEMO_INTERSECTIONS);
          return;
        }

        const skipped = parsedPoints.length - pointsWithCoords.length;
        const parts = [];
        if (geocodedLive > 0) {
          parts.push(
            `${geocodedLive} location(s) were resolved online and cached in this browser (approximate; verify for reporting).`,
          );
        }
        if (skipped > 0) {
          parts.push(
            `${skipped} intersection(s) from the workbook could not be geocoded and are hidden.`,
          );
        }
        setLoadNotice(parts.length ? parts.join(" ") : null);
        setData(pointsWithCoords);
      } catch (error) {
        console.error("Failed to load map locations:", error);
        setMapLoading(null);
        setLoadNotice("Could not load map data. Showing sample intersections.");
        setData(DEMO_INTERSECTIONS);
      }
    }

    loadAutoLocations();
  }, []);

  async function handleFindNearestIntersection(e) {
    e?.preventDefault?.();
    setAddressSearchError(null);
    const q = normalizeText(addressInput);
    if (!q) {
      setAddressSearchError("Enter an address or place name.");
      return;
    }
    if (!data.length) {
      setAddressSearchError("Intersections are still loading.");
      return;
    }
    setAddressSearchLoading(true);
    try {
      const coord = await geocodeFreeformAddress(q);
      if (!coord) {
        setSearchUserPoint(null);
        setSearchNearest(null);
        setSearchDistanceM(null);
        setAddressSearchError(
          "Could not find that location. Try adding “Madison, WI” or a nearby landmark.",
        );
        return;
      }
      const closest = findClosestIntersection(coord, data);
      if (!closest) {
        setSearchUserPoint(coord);
        setSearchNearest(null);
        setSearchDistanceM(null);
        setAddressSearchError("No intersections to compare.");
        return;
      }
      setSearchUserPoint(coord);
      setSearchNearest(closest.intersection);
      setSearchDistanceM(closest.meters);
      setHoveredId(closest.intersection.id);
      setSelectedLocation(closest.intersection);
    } catch (err) {
      console.error(err);
      setAddressSearchError(
        "Search failed. Check your connection and try again.",
      );
    } finally {
      setAddressSearchLoading(false);
    }
  }

  function clearAddressSearch() {
    setSearchUserPoint(null);
    setSearchNearest(null);
    setSearchDistanceM(null);
    setAddressSearchError(null);
    setHoveredId(null);
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        minHeight: "100dvh",
        position: "relative",
        overflow: "hidden",
        backgroundColor: "#f3f4f6",
      }}
    >
      {mapLoading && (
        <div
          style={{
            position: "absolute",
            top: "16px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1250,
            maxWidth: "min(420px, 92vw)",
            padding: "12px 20px",
            background: "white",
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            fontFamily: "sans-serif",
            fontSize: "14px",
            color: "#374151",
            boxShadow: "0 8px 24px rgba(0,0,0,0.1)",
          }}
        >
          {mapLoading}
        </div>
      )}

      {loadNotice && !mapLoading && (
        <div
          style={{
            position: "absolute",
            top: "16px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1200,
            maxWidth: "min(560px, 92vw)",
            padding: "12px 16px",
            background: "#fffbeb",
            border: "1px solid #fcd34d",
            borderRadius: "12px",
            fontFamily: "sans-serif",
            fontSize: "13px",
            color: "#92400e",
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
          }}
        >
          {loadNotice}
        </div>
      )}

      <form
        onSubmit={handleFindNearestIntersection}
        style={{
          position: "absolute",
          top: "16px",
          left: "16px",
          zIndex: 1000,
          width: "min(340px, calc(100vw - 32px))",
          background: "white",
          borderRadius: "14px",
          border: "1px solid #e5e7eb",
          boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
          padding: "14px 14px 12px",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            fontSize: "13px",
            fontWeight: "700",
            color: "#111827",
            marginBottom: "8px",
          }}
        >
          Find nearest intersection
        </div>
        <div
          style={{
            fontSize: "11px",
            color: "#6b7280",
            marginBottom: "10px",
            lineHeight: 1.4,
          }}
        >
          Enter an address or place (Madison area). It will match to the closest
          Efficiency Navigator cross street on the map.
        </div>
        <input
          type="text"
          value={addressInput}
          onChange={(ev) => setAddressInput(ev.target.value)}
          placeholder="e.g. 210 Martin Luther King Jr Blvd"
          disabled={addressSearchLoading || mapLoading}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "10px 12px",
            borderRadius: "10px",
            border: "1px solid #d1d5db",
            fontSize: "14px",
            marginBottom: "10px",
            outline: "none",
          }}
        />
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button
            type="submit"
            disabled={addressSearchLoading || mapLoading || !data.length}
            style={{
              flex: 1,
              padding: "10px 14px",
              borderRadius: "10px",
              border: "none",
              background:
                addressSearchLoading || mapLoading || !data.length
                  ? "#9ca3af"
                  : "#16a34a",
              color: "white",
              fontWeight: "700",
              fontSize: "14px",
              cursor:
                addressSearchLoading || mapLoading || !data.length
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {addressSearchLoading ? "Searching…" : "Search"}
          </button>
          {(searchUserPoint || addressSearchError) && (
            <button
              type="button"
              onClick={clearAddressSearch}
              style={{
                padding: "10px 12px",
                borderRadius: "10px",
                border: "1px solid #e5e7eb",
                background: "#f9fafb",
                color: "#374151",
                fontSize: "13px",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          )}
        </div>
        {addressSearchError && (
          <p
            style={{
              margin: "10px 0 0",
              fontSize: "12px",
              color: "#b45309",
              lineHeight: 1.45,
            }}
          >
            {addressSearchError}
          </p>
        )}
        {searchNearest && searchDistanceM != null && !addressSearchError && (
          <p
            style={{
              margin: "10px 0 0",
              fontSize: "12px",
              color: "#166534",
              lineHeight: 1.45,
              fontWeight: "600",
            }}
          >
            Closest: {searchNearest.street} — about{" "}
            {formatDistanceMeters(searchDistanceM)} away (straight-line).
          </p>
        )}
      </form>

      <div
        style={{
          position: "absolute",
          bottom: "30px",
          right: "30px",
          zIndex: 1000,
          background: "white",
          padding: "12px 20px",
          borderRadius: "50px",
          boxShadow: "0 10px 25px rgba(0,0,0,0.1)",
          display: "flex",
          alignItems: "center",
          gap: "15px",
          fontFamily: "sans-serif",
          border: "1px solid #e5e7eb",
        }}
      >
        <span style={{ fontSize: "14px", color: "#374151", fontWeight: "600" }}>
          Enable Heatmap
        </span>
        <button
          onClick={() => setShowHeatmap(!showHeatmap)}
          style={{
            width: "44px",
            height: "24px",
            borderRadius: "50px",
            background: showHeatmap ? "#16a34a" : "#d1d5db",
            border: "none",
            cursor: "pointer",
            position: "relative",
            transition: "background 0.3s ease",
          }}
        >
          <div
            style={{
              width: "18px",
              height: "18px",
              background: "white",
              borderRadius: "50%",
              position: "absolute",
              top: "3px",
              left: showHeatmap ? "23px" : "3px",
              transition: "left 0.3s ease",
              boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
            }}
          />
        </button>
      </div>

      <div
        style={{
          position: "absolute",
          top: 0,
          right: selectedLocation ? 0 : "-420px",
          width: "380px",
          height: "100%",
          background: "white",
          zIndex: 1100,
          boxShadow: "-10px 0 40px rgba(0,0,0,0.1)",
          transition: "right 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
          padding: "40px 30px",
          display: "flex",
          flexDirection: "column",
          fontFamily: "sans-serif",
          borderLeft: "1px solid #f3f4f6",
          overflowY: "auto",
        }}
      >
        {selectedLocation && (
          <>
            <button
              onClick={() => setSelectedLocation(null)}
              style={{
                alignSelf: "flex-end",
                background: "#f3f4f6",
                border: "none",
                borderRadius: "50%",
                width: "32px",
                height: "32px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: "#4b5563",
              }}
            >
              ✕
            </button>
            <h2
              style={{
                margin: "20px 0 5px 0",
                fontSize: "24px",
                color: "#111827",
                fontWeight: "800",
              }}
            >
              {selectedLocation.street}
            </h2>
            <p
              style={{
                fontSize: "13px",
                color: "#16a34a",
                fontWeight: "bold",
                textTransform: "uppercase",
                letterSpacing: "1.5px",
                marginBottom: "30px",
              }}
            >
              Efficiency Navigator
            </p>

            <h3
              style={{
                fontSize: "16px",
                color: "#374151",
                marginBottom: "12px",
                fontWeight: "700",
              }}
            >
              Impact Story
            </h3>
            <p
              style={{
                fontSize: "15px",
                color: "#4b5563",
                lineHeight: "1.7",
                marginBottom: "40px",
                background: "#f9fafb",
                padding: "20px",
                borderRadius: "12px",
                border: "1px solid #f3f4f6",
              }}
            >
              {selectedLocation.story}
            </p>

            <h3
              style={{
                fontSize: "16px",
                color: "#374151",
                marginBottom: "20px",
                fontWeight: "700",
              }}
            >
              Sustainability Metrics
            </h3>

            <div
              style={{ display: "flex", flexDirection: "column", gap: "15px" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "15px",
                  background: "#f0fdf4",
                  borderRadius: "15px",
                  border: "1px solid #dcfce7",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    minWidth: 0,
                    overflow: "visible",
                  }}
                >
                  <DonutChart
                    value={selectedLocation.infos[0]?.co2 ?? 0}
                    goal={selectedLocation.infos[0]?.co2Goal ?? 1000}
                    color="#16a34a"
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    {(() => {
                      const v = Number(selectedLocation.infos[0]?.co2);
                      const isMissing = !Number.isFinite(v) || v <= 0;
                      return (
                        <>
                          <div
                            style={{
                              fontSize: isMissing ? "16px" : "22px",
                              fontWeight: "800",
                              color: "#16a34a",
                              fontStyle: isMissing ? "italic" : "normal",
                            }}
                          >
                            {isMissing ? "Data not available" : `${v} kg`}
                          </div>
                          <div
                            style={{
                              fontSize: "12px",
                              color: "#16a34a",
                              fontWeight: "600",
                            }}
                          >
                            Carbon dioxide avoided (estimated per year)
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>

              <SidebarCo2Explainer
                kgAnnual={selectedLocation.infos[0]?.co2 ?? 0}
              />

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "15px",
                  background: "#eff6ff",
                  borderRadius: "15px",
                  border: "1px solid #dbeafe",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    minWidth: 0,
                    overflow: "visible",
                  }}
                >
                  <DonutChart
                    value={selectedLocation.infos[0]?.kWh ?? 0}
                    goal={selectedLocation.infos[0]?.kWhGoal ?? 500}
                    color="#2563eb"
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    {(() => {
                      const v = Number(selectedLocation.infos[0]?.kWh);
                      const isMissing = !Number.isFinite(v) || v <= 0;
                      return (
                        <>
                          <div
                            style={{
                              fontSize: isMissing ? "16px" : "22px",
                              fontWeight: "800",
                              color: "#2563eb",
                              fontStyle: isMissing ? "italic" : "normal",
                            }}
                          >
                            {isMissing ? "Data not available" : `${v} kWh`}
                          </div>
                          <div
                            style={{
                              fontSize: "12px",
                              color: "#2563eb",
                              fontWeight: "600",
                            }}
                          >
                            Electricity saved (estimated per year)
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>

              <SidebarKwhExplainer
                kwhAnnual={selectedLocation.infos[0]?.kWh ?? 0}
              />

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "15px",
                  background: "#fff7ed",
                  borderRadius: "15px",
                  border: "1px solid #ffedd5",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    minWidth: 0,
                    overflow: "visible",
                  }}
                >
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      flexShrink: 0,
                      borderRadius: "50%",
                      background: "#fed7aa",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#c2410c",
                    }}
                    aria-hidden="true"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="28"
                      height="28"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2" />
                      <circle cx="6.5" cy="16.5" r="2.5" />
                      <circle cx="16.5" cy="16.5" r="2.5" />
                    </svg>
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    {(() => {
                      const v = Number(selectedLocation.infos[0]?.VMT);
                      const isMissing = !Number.isFinite(v) || v <= 0;
                      return (
                        <>
                          <div
                            style={{
                              fontSize: isMissing ? "16px" : "22px",
                              fontWeight: "800",
                              color: "#c2410c",
                              fontStyle: isMissing ? "italic" : "normal",
                            }}
                          >
                            {isMissing
                              ? "Data not available"
                              : `${v.toLocaleString()} miles`}
                          </div>
                          <div
                            style={{
                              fontSize: "12px",
                              color: "#c2410c",
                              fontWeight: "600",
                            }}
                          >
                            Vehicle miles avoided (projected per year)
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>

              <SidebarVmtExplainer
                milesAnnual={selectedLocation.infos[0]?.VMT ?? 0}
              />

              <SidebarTotalSavings infos={selectedLocation.infos || []} />
            </div>
          </>
        )}
      </div>

      <MapContainer
        center={[43.0745, -89.417]}
        zoom={14}
        style={{ height: "100%", width: "100%" }}
        zoomControl={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          attribution="&copy; OpenStreetMap"
        />
        <ZoomControl position="bottomleft" />
        <MapClickCloseSidebar
          hasSelection={!!selectedLocation}
          suppressRef={mapClickSuppressCloseRef}
          onClose={() => {
            setSelectedLocation(null);
            setHoveredId(null);
          }}
        />
        <MapZoomSync onZoomChange={setMapZoom} />
        <FitMapToData
          points={data}
          geolocationSettled={geolocationSettled}
          browserGeo={browserGeo}
        />
        <FlyToNearestFromBrowserGeo userPoint={browserGeo} points={data} />
        <FlyToAddressSearch
          userPoint={searchUserPoint}
          intersection={searchNearest}
        />

        {searchUserPoint && searchNearest && (
          <Polyline
            positions={[
              [searchUserPoint.lat, searchUserPoint.lng],
              [searchNearest.coordinate.lat, searchNearest.coordinate.lng],
            ]}
            pathOptions={{
              color: "#2563eb",
              dashArray: "10 10",
              weight: 3,
              opacity: 0.85,
            }}
          />
        )}

        {searchUserPoint && (
          <CircleMarker
            center={[searchUserPoint.lat, searchUserPoint.lng]}
            radius={Math.max(5, Math.round(8 * markerScaleForZoom(mapZoom)))}
            pathOptions={{
              color: "#1d4ed8",
              fillColor: "#3b82f6",
              fillOpacity: 1,
              weight: 3,
            }}
          >
            <Tooltip direction="top" offset={[0, -8]} permanent={false}>
              Your search location
            </Tooltip>
          </CircleMarker>
        )}

        {browserGeo &&
          (!searchUserPoint ||
            distanceMeters(browserGeo, searchUserPoint) > 75) && (
            <CircleMarker
              center={[browserGeo.lat, browserGeo.lng]}
              radius={Math.max(5, Math.round(7 * markerScaleForZoom(mapZoom)))}
              pathOptions={{
                color: "#6d28d9",
                fillColor: "#a78bfa",
                fillOpacity: 1,
                weight: 2,
              }}
            >
              <Tooltip direction="top" offset={[0, -8]} permanent={false}>
                Your location
              </Tooltip>
            </CircleMarker>
          )}

        {data.map((item) => {
          const isActive =
            hoveredId === item.id ||
            (selectedLocation && selectedLocation.id === item.id) ||
            (searchNearest && searchNearest.id === item.id);
          const primaryCo2 = item.infos?.[0]?.co2 ?? 0;

          return (
            <React.Fragment key={item.id}>
              {showHeatmap && (
                <Circle
                  center={[item.coordinate.lat, item.coordinate.lng]}
                  radius={Math.max(8, primaryCo2 * 0.5)}
                  pathOptions={{
                    fillColor: "#22c55e",
                    fillOpacity: isActive ? 0.35 : 0.15,
                    color: "#16a34a",
                    weight: 1,
                    stroke: true,
                  }}
                />
              )}

              <Marker
                position={[item.coordinate.lat, item.coordinate.lng]}
                icon={createIntersectionIcon(isActive, mapZoom)}
                eventHandlers={{
                  mouseover: () => setHoveredId(item.id),
                  mouseout: () => setHoveredId(null),
                  click: (e) => {
                    mapClickSuppressCloseRef.current = true;
                    if (e?.originalEvent) {
                      L.DomEvent.stopPropagation(e.originalEvent);
                    }
                    setSelectedLocation(item);
                    setTimeout(() => {
                      mapClickSuppressCloseRef.current = false;
                    }, 0);
                  },
                }}
              >
                {!selectedLocation && (
                  <Tooltip direction="top" offset={[0, -10]}>
                    {item.street}
                  </Tooltip>
                )}
              </Marker>
            </React.Fragment>
          );
        })}
      </MapContainer>
    </div>
  );
}
