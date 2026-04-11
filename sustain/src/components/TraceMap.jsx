import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import styles from "./TraceMap.module.css";
import {
    Map,
    MapMarker,
    MarkerContent,
    MarkerPopup,
    MarkerTooltip,
    useMap,
} from "@/components/ui/map";
import Bubble from "@/components/Bubble.jsx";

export function TraceMap() {
    const center = [-89.4075, 43.0765];

    /*
    const [midPoints] = useState([
        {
            original: "University Ave / N Midvale Blvd, Madison WI",
            streetA: "University Ave",
            streetB: "N Midvale Blvd",
            coordinate: { lat: 43.0751656, lng: -89.4503393 },
            infos:[{ co2: 470, kWh: 39, VMT: 1665 }]
        },
        {
            original: "Rethke Ave / Worthington Ave, Madison WI",
            streetA: "Rethke Ave",
            streetB: "Worthington Ave",
            coordinate: { lat: 43.1023451, lng: -89.3521902 },
            infos:[{ co2: 470, kWh: 39, VMT: 1665 }]
        },
        {
            original: "E. Johnson St. / N. 6th St, Madison WI",
            streetA: "E. Johnson St.",
            streetB: "N. 6th St",
            coordinate: { lat: 43.0978842, lng: -89.3654421 },
            infos:[{ co2: 100, kWh: 39, VMT: 1665 }]
        },
        {
            original: "Monterey Dr. / Trailsway, Madison WI",
            streetA: "Monterey Dr.",
            streetB: "Trailsway",
            coordinate: { lat: 43.0459921, lng: -89.4103377 },
            infos:[{ co2: 570, kWh: 39, VMT: 1665 }]
        }
    ]);
    */

    const [autoMidPoints, setAutoMidPoints] = useState([]);

    const TARGET_SHEETS = [
        "OEI by Measure",
        "CDBG and ARPA by Measure",
        "Madison Capital 2024",
        "Madison Capital & EECBG 2025",
    ];

    // helper functions for parsing the Excel data
    function normalizeText(value) {
        return String(value ?? "").replace(/\s+/g, " ").trim();
    }

    function toNumber(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
    }

    // splits street names that are in the format "Street A / Street B"
    function splitStreetParts(original) {
        const cleaned = normalizeText(original);
        const parts = cleaned.split("/").map((s) => s.trim());
        return {
            streetA: parts[0] ?? cleaned,
            streetB: parts[1] ?? "",
        };
    }

    // gets cross street headers
    function resolveCrossStreetHeader(headers) {
        for (const header of headers) {
            const lower = String(header).toLowerCase().trim();
            if (lower.includes("cross street")) return header;
        }
        return null;
    }

    // cdbg and arpa sheet has a missing header name for the implementation column
    function resolveImplementationValue(row, headers, sheetName) {
        if (sheetName === "CDBG and ARPA by Measure") {
            const headerIndex = headers.findIndex((h) =>
                String(h).toLowerCase().includes("implementation")
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
                    if (
                        typeof leftValue === "string" &&
                        normalizeText(leftValue) !== ""
                    ) {
                        return leftValue;
                    }
                }
            }
        }

        return "";
    }

    // parse excel workbook and extract relevant data
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
                    resolveImplementationValue(row, headers, sheetName)
                );

                const kWh = toNumber(row["kWh Projected Savings"]);
                const co2 = toNumber(row["Yearly CO2 Emissions Savings (kg)"]);
                const VMT = toNumber(row["Projected VMT Avoided"]);

                if (!streetMap.has(currentStreet)) {
                    const parts = splitStreetParts(currentStreet);
                    streetMap.set(currentStreet, {
                        original: currentStreet,
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
                    });
                }
            }
        }

        return Array.from(streetMap.values());
    }
    
    // moved geocoding to a separate script
    /*
    async function geocodeStreet(street) {
        const q = encodeURIComponent(`${street}, Madison WI`);
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${q}`;

        const res = await fetch(url, {
            headers: {
                "Accept-Language": "en",
            },
        });

        const data = await res.json();

        if (!Array.isArray(data) || data.length === 0) return null;

        return {
            lat: Number(data[0].lat),
            lng: Number(data[0].lon),
        };
    }

    async function geocodeAll(points) {
        const results = [];

        for (const point of points) {
            const coordinate = await geocodeStreet(point.original);

            if (coordinate) {
                results.push({
                    ...point,
                    coordinate,
                });
            }

            await new Promise((resolve) => setTimeout(resolve, 1100));
        }

        return results;
    }
    */

    useEffect(() => {
        async function loadAutoMidPoints() {
            try {
                const [excelResponse, coordResponse] = await Promise.all([
                    fetch("/data/Efficiency Navigator Program - Data Support Group (2).xlsx"),
                    fetch("/data/cross_street_coords.json"),
                ]);

                const arrayBuffer = await excelResponse.arrayBuffer();
                const workbook = XLSX.read(arrayBuffer, { type: "array" });
                const coordMap = await coordResponse.json();

                const parsedPoints = parseWorkbook(workbook);

                const pointsWithCoords = parsedPoints
                    .map((point) => {
                        const coordinate = coordMap[point.original];
                        if (!coordinate) return null;

                        return {
                            ...point,
                            coordinate,
                        };
                    })
                    .filter(Boolean);

                /*
                const withFakeCoords = parsedPoints.map(p => ({
                    ...p,
                    coordinate: {
                        lat: 43.07 + Math.random() * 0.05,
                        lng: -89.4 + Math.random() * 0.05
                    }
                }));
                */

                setAutoMidPoints(pointsWithCoords);
            } catch (error) {
                console.error("Failed to load midpoints:", error);
            }
        }

        loadAutoMidPoints();
    }, []);

    
    // heatmap
    function HeatmapLayer({ midPoints }) {
        const { map, isLoaded } = useMap();

        useEffect(() => {
            if (!map || !isLoaded) return;

            const validPoints = midPoints.filter(
                (p) =>
                    p?.coordinate &&
                    Number.isFinite(p.coordinate.lat) &&
                    Number.isFinite(p.coordinate.lng)
            );

            const data = {
                type: "FeatureCollection",
                features: validPoints.map((p) => ({
                    type: "Feature",
                    properties: {
                        co2: p?.infos?.[0]?.co2 ?? 0,
                    },
                    geometry: {
                        type: "Point",
                        coordinates: [p.coordinate.lng, p.coordinate.lat],
                    },
                })),
            };

            if (map.getSource("heatmap")) {
                map.getSource("heatmap").setData(data);
                return;
            }

            map.addSource("heatmap", {
                type: "geojson",
                data,
            });

            const layers = map.getStyle().layers;
            const firstLabel = layers.find((l) => l.type === "symbol")?.id;

            map.addLayer(
                {
                    id: "heatmap-layer",
                    type: "heatmap",
                    source: "heatmap",
                    maxzoom: 15,
                    paint: {
                        "heatmap-weight": [
                            "interpolate",
                            ["linear"],
                            ["get", "co2"],
                            0, 0,
                            100, 0.3,
                            300, 0.6,
                            600, 1,
                        ],
                        "heatmap-intensity": [
                            "interpolate",
                            ["linear"],
                            ["zoom"],
                            0, 1,
                            13, 3,
                        ],
                        "heatmap-color": [
                            "interpolate",
                            ["linear"],
                            ["heatmap-density"],
                            0, "rgba(0,0,0,0)",
                            0.2, "#d9f99d",
                            0.4, "#86efac",
                            0.6, "#4ade80",
                            0.8, "#22c55e",
                            1, "#14532d",
                        ],
                        "heatmap-radius": [
                            "interpolate",
                            ["linear"],
                            ["zoom"],
                            0, 100,
                            10, 120,
                            13, 180,
                        ],
                        "heatmap-opacity": 0.6,
                    },
                },
                firstLabel
            );
        }, [map, isLoaded, midPoints]);

        return null;
    }

    const [color, setColor] = useState("claro");

    const toggleModo = () => {
        setColor((prevModo) => (prevModo === "claro" ? "escuro" : "claro"));
    };

    return (
        <div className={styles.father}>
            <button onClick={toggleModo} >Change style</button>
            <Map
                center={center}
                zoom={13}
                styles={{
                    light:
                        color === "claro"
                            ? "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
                            : "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
                    dark:
                        color === "claro"
                            ? "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
                            : "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
                }}
            >
                <HeatmapLayer midPoints={autoMidPoints} />

                {autoMidPoints.map((point, index) => (
                    <MapMarker
                        key={index}
                        longitude={point.coordinate.lng}
                        latitude={point.coordinate.lat}
                    >
                        <MarkerContent>
                            <Bubble point={point} />
                        </MarkerContent>

                        <MarkerTooltip>{point.original}</MarkerTooltip>

                        {/*<MarkerPopup>*/}
                        {/*    <div className="space-y-1">*/}
                        {/*        <p className="font-medium">{point.original}</p>*/}
                        {/*        <p className="text-sm">CO₂: {point.infos[0].co2}</p>*/}
                        {/*        <p className="text-sm">kWh: {point.infos[0].kWh}</p>*/}
                        {/*        <p className="text-sm">VMT: {point.infos[0].VMT}</p>*/}
                        {/*    </div>*/}
                        {/*</MarkerPopup>*/}
                    </MapMarker>
                ))}
            </Map>
        </div>
    );
}