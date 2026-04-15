import { useEffect, useState } from "react";
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

    //array with all streets
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


    function HeatmapLayer({ midPoints }) {

        const { map, isLoaded } = useMap();

        useEffect(() => {

            if (!map || !isLoaded) return;

            const data = {
                type: "FeatureCollection",
                features: midPoints.map((p) => ({
                    type: "Feature",
                    properties: {
                        co2: p?.infos?.[0]?.co2 ?? 0
                    },
                    geometry: {
                        type: "Point",
                        coordinates: [p.coordinate.lng, p.coordinate.lat]
                    }
                }))
            };

            if (map.getSource("heatmap")) {
                map.getSource("heatmap").setData(data);
                return;
            }

            map.addSource("heatmap", {
                type: "geojson",
                data
            });

            const layers = map.getStyle().layers;
            const firstLabel = layers.find(l => l.type === "symbol")?.id;
// border? try borders for levels
            map.addLayer({
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
                        600, 1
                    ],

                    "heatmap-intensity": [
                        "interpolate",
                        ["linear"],
                        ["zoom"],
                        0, 1,
                        13, 3
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
                        1, "#14532d"
                    ],

                    "heatmap-radius": [
                        "interpolate",
                        ["linear"],
                        ["zoom"],
                        0, 100,
                        10, 120,
                        13, 180
                    ],

                    "heatmap-opacity": 0.6
                }

            }, firstLabel);

        }, [map, isLoaded, midPoints]);

        return null;
    }

    const [color, setColor] = useState("claro")

    const toggleModo = () => {
        setColor(prevModo => (prevModo === "claro" ? "escuro" : "claro"));
    };



    return (
        <div className={styles.father}>
            <button onClick={toggleModo} >Change style</button>
            <Map
                center={center}
                zoom={13}
                styles={{
                    light: color === "claro" ? "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json" : "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
                    dark: color === "claro" ? "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json" : "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
                }}
            >

                <HeatmapLayer midPoints={midPoints} />

                {midPoints.map((point, index) => (
                    <MapMarker
                        key={index}
                        longitude={point.coordinate.lng}
                        latitude={point.coordinate.lat}
                    >

                        <MarkerContent>
                            <Bubble point={point}/>
                        </MarkerContent>

                        <MarkerTooltip>
                            {point.original}
                        </MarkerTooltip>

                        {/*<MarkerPopup> */}
                        {/*    <div className="space-y-1">*/}
                        {/*        <p className="font-medium">{point.original}</p>*/}
                        {/*        <p className="text-sm">CO₂: {point.infos[0].co2}</p>*/}
                        {/*        <p className="text-sm">kWh: {point.infos[0].kWh}</p>*/}
                        {/*        <p className="text-sm">VMT: {point.infos[0].VMT}</p>*/}
                        {/*    </div>*/}
                        {/*</MarkerPopup> change it (less descriptive)*/}

                    </MapMarker>
                ))}

            </Map>

        </div>
    );
}