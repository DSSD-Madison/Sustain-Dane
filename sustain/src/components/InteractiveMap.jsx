import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { MapContainer, TileLayer, Marker, Circle, ZoomControl, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import 'leaflet/dist/leaflet.css';

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

// helper functions copied from old TraceMap
function normalizeText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
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
    }
    return null;
}

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

// --- STYLIZED DONUT CHART ---
const DonutChart = ({ value, goal, color }) => {
    const chartData = [
        { name: 'Achieved', value: value },
        { name: 'Remaining', value: Math.max(0, goal - value) },
    ];

    return (
        <div style={{ width: '100px', height: '100px' }}>
            <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                    <Pie
                        data={chartData}
                        cx="50%" cy="50%"
                        innerRadius={30} outerRadius={42}
                        paddingAngle={5}
                        dataKey="value"
                        startAngle={90} endAngle={-270}
                    >
                        <Cell fill={color} stroke="none" />
                        <Cell fill="#f3f4f6" stroke="none" />
                    </Pie>
                </PieChart>
            </ResponsiveContainer>
        </div>
    );
};

// --- DYNAMIC WHITE ICON ---
const createWhiteIcon = (isActive, co2Value) => {
    const size = isActive ? 85 : 55;
    return L.divIcon({
        className: 'custom-marker',
        html: `
      <div style="
        width:${size}px; height:${size}px; 
        background: white; border: 2px solid #16a34a; border-radius: 50%; 
        display:flex; flex-direction:column; align-items:center; justify-content:center; 
        color:#16a34a; font-family:sans-serif;
        transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); 
        box-shadow: 0 6px 16px rgba(0,0,0,0.12);
        cursor: pointer;
      ">
        <span style="font-size: ${isActive ? '18px' : '14px'}; font-weight: 800; line-height: 1;">
            ${co2Value}
        </span>
        <span style="
            font-size: ${isActive ? '10px' : '0px'}; 
            opacity: ${isActive ? '1' : '0'};
            font-weight: 600;
            margin-top: 2px;
            transition: opacity 0.2s ease;
            text-transform: uppercase;
        ">
            kg saved
        </span>
      </div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
    });
};

export default function SustainabilityDashboard() {
    const [hoveredId, setHoveredId] = useState(null);
    const [showHeatmap, setShowHeatmap] = useState(true);
    const [selectedLocation, setSelectedLocation] = useState(null);

    // new automatic data state
    const [data, setData] = useState([]);

    useEffect(() => {
        async function loadAutoLocations() {
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
                    .map((point, index) => {
                        const coordinate = coordMap[point.original];
                        if (!coordinate) return null;

                        return {
                            ...point,
                            id: index + 1, // added for compatibility with existing UI
                            coordinate,
                            // optional placeholder since old Leaflet sidebar expects story
                            story: point.infos?.[0]?.implement || "No story available yet.",
                        };
                    })
                    .filter(Boolean);

                setData(pointsWithCoords);
            } catch (error) {
                console.error("Failed to load map locations:", error);
            }
        }

        loadAutoLocations();
    }, []);

    return (
        <div style={{ width: '100%', height: '100vh', position: 'relative', overflow: 'hidden', backgroundColor: '#f3f4f6' }}>

            <div style={{
                position: 'absolute', bottom: '30px', right: '30px', zIndex: 1000,
                background: 'white', padding: '12px 20px', borderRadius: '50px',
                boxShadow: '0 10px 25px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center',
                gap: '15px', fontFamily: 'sans-serif', border: '1px solid #e5e7eb'
            }}>
                <span style={{ fontSize: '14px', color: '#374151', fontWeight: '600' }}>Enable Heatmap</span>
                <button
                    onClick={() => setShowHeatmap(!showHeatmap)}
                    style={{
                        width: '44px', height: '24px', borderRadius: '50px',
                        background: showHeatmap ? '#16a34a' : '#d1d5db',
                        border: 'none', cursor: 'pointer', position: 'relative',
                        transition: 'background 0.3s ease'
                    }}
                >
                    <div style={{
                        width: '18px', height: '18px', background: 'white', borderRadius: '50%',
                        position: 'absolute', top: '3px', left: showHeatmap ? '23px' : '3px',
                        transition: 'left 0.3s ease', boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                    }} />
                </button>
            </div>

            <div style={{
                position: 'absolute', top: 0, right: selectedLocation ? 0 : '-420px',
                width: '380px', height: '100%', background: 'white', zIndex: 1100,
                boxShadow: '-10px 0 40px rgba(0,0,0,0.1)', transition: 'right 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                padding: '40px 30px', display: 'flex', flexDirection: 'column',
                fontFamily: 'sans-serif', borderLeft: '1px solid #f3f4f6', overflowY: 'auto'
            }}>
                {selectedLocation && (
                    <>
                        <button
                            onClick={() => setSelectedLocation(null)}
                            style={{ alignSelf: 'flex-end', background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#4b5563' }}
                        >
                            ✕
                        </button>
                        <h2 style={{ margin: '20px 0 5px 0', fontSize: '24px', color: '#111827', fontWeight: '800' }}>{selectedLocation.street}</h2>
                        <p style={{ fontSize: '13px', color: '#16a34a', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '30px' }}>Madison, Wisconsin</p>

                        <h3 style={{ fontSize: '16px', color: '#374151', marginBottom: '12px', fontWeight: '700' }}>Impact Story</h3>
                        <p style={{ fontSize: '15px', color: '#4b5563', lineHeight: '1.7', marginBottom: '40px', background: '#f9fafb', padding: '20px', borderRadius: '12px', border: '1px solid #f3f4f6' }}>
                            {selectedLocation.story}
                        </p>

                        <h3 style={{ fontSize: '16px', color: '#374151', marginBottom: '20px', fontWeight: '700' }}>Sustainability Metrics</h3>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '15px', background: '#f0fdf4', borderRadius: '15px', border: '1px solid #dcfce7'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <DonutChart value={selectedLocation.infos[0]?.co2 ?? 0} goal={selectedLocation.infos[0]?.co2Goal ?? 1000} color="#16a34a" />
                                    <div>
                                        <div style={{ fontSize: '22px', fontWeight: '800', color: '#16a34a' }}>{selectedLocation.infos[0]?.co2 ?? 0} kg</div>
                                        <div style={{ fontSize: '12px', color: '#16a34a', fontWeight: '600' }}>Carbon Saved</div>
                                    </div>
                                </div>
                            </div>

                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '15px', background: '#eff6ff', borderRadius: '15px', border: '1px solid #dbeafe'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <DonutChart value={selectedLocation.infos[0]?.kWh ?? 0} goal={selectedLocation.infos[0]?.kWhGoal ?? 500} color="#2563eb" />
                                    <div>
                                        <div style={{ fontSize: '22px', fontWeight: '800', color: '#2563eb' }}>{selectedLocation.infos[0]?.kWh ?? 0} kWh</div>
                                        <div style={{ fontSize: '12px', color: '#2563eb', fontWeight: '600' }}>Energy Saved</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>

            <MapContainer
                center={[43.0745, -89.4170]}
                zoom={14}
                style={{ height: '100%', width: '100%' }}
                zoomControl={false}
            >
                <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                    attribution="&copy; OpenStreetMap"
                />
                <ZoomControl position="topleft" />

                {data.map((item) => {
                    const isActive = hoveredId === item.id || (selectedLocation && selectedLocation.id === item.id);

                    return (
                        <React.Fragment key={item.id}>
                            {showHeatmap && (
                                <Circle
                                    center={[item.coordinate.lat, item.coordinate.lng]}
                                    radius={item.infos[0].co2 * 0.5}
                                    pathOptions={{
                                        fillColor: '#22c55e',
                                        fillOpacity: isActive ? 0.35 : 0.15,
                                        color: '#16a34a',
                                        weight: 1,
                                        stroke: true
                                    }}
                                />
                            )}

                            <Marker
                                position={[item.coordinate.lat, item.coordinate.lng]}
                                icon={createWhiteIcon(isActive, item.infos[0].co2)}
                                eventHandlers={{
                                    mouseover: () => setHoveredId(item.id),
                                    mouseout: () => setHoveredId(null),
                                    click: () => setSelectedLocation(item),
                                }}
                            >
                                {!selectedLocation && <Tooltip direction="top" offset={[0, -10]}>{item.street}</Tooltip>}
                            </Marker>
                        </React.Fragment>
                    );
                })}
            </MapContainer>
        </div>
    );
}