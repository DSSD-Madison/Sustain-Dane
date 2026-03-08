import { useEffect, useState } from "react";
import styles from "./TraceMap.module.css"
import {
    Map,
    MapMarker,
    MarkerContent,
    MarkerPopup,
    MarkerTooltip,
    useMap,
} from "@/components/ui/map";
import * as turf from "@turf/turf";
import Bubble from "@/components/Bubble.jsx";

export function TraceMap() {
    const center = [-89.4075, 43.0765];
    const [midPoints, setMidPoints] = useState([
        {
            original: "University Ave / N Midvale Blvd, Madison WI",
            streetA: "University Ave",
            streetB: "N Midvale Blvd",
            coordinate: {
                lat: 43.0751656,
                lng: -89.4503393
            },
            infos:[
                {
                    implement: "Air Sealing",
                    co2: 470,
                    kWh: 39,
                    VMT: 1665,
                    total: 81
                }
            ]
        },
        {
            original: "Rethke Ave / Worthington Ave, Madison WI",
            streetA: "Rethke Ave",
            streetB: "Worthington Ave",
            coordinate: {
                lat: 43.1023451,
                lng: -89.3521902
            },
            infos:[
                {
                    implement: "Air Sealing",
                    co2: 470,
                    kWh: 39,
                    VMT: 1665,
                    total: 81
                }
            ]
        },
        {
            original: "E. Johnson St. / N. 6th St, Madison WI",
            streetA: "E. Johnson St.",
            streetB: "N. 6th St",
            coordinate: {
                lat: 43.0978842,
                lng: -89.3654421
            },
            infos:[
                {
                    implement: "Air Sealing",
                    co2: 100,
                    kWh: 39,
                    VMT: 1665,
                    total: 81
                }
            ]
        },
        {
            original: "Monterey Dr. / Trailsway, Madison WI",
            streetA: "Monterey Dr.",
            streetB: "Trailsway",
            coordinate: {
                lat: 43.0459921,
                lng: -89.4103377
            },
            infos:[
                {
                    implement: "Air Sealing",
                    co2: 570,
                    kWh: 39,
                    VMT: 1665,
                    total: 81
                }
            ]
        }
    ]);

    function getPolygonFromPoints(midPoints) {
        // Converte midPoints em FeatureCollection de pontos
        const points = turf.featureCollection(
            midPoints.map(p =>
                turf.point([p.coordinate.lng, p.coordinate.lat])
            )
        );

        // Cria o polígono convex hull
        const hull = turf.convex(points);

        return hull;
    }

    function CustomPolygonLayer({ midPoints }) {
        const { map, isLoaded } = useMap();

        const polygonGeoJSON = getPolygonFromPoints(midPoints);

        useEffect(() => {
            if (!map || !isLoaded) return;

            if (!map.getSource("polygon")) {
                map.addSource("polygon", {
                    type: "geojson",
                    data: polygonGeoJSON,
                });
            }

            if (!map.getLayer("polygon-fill")) {
                map.addLayer({
                    id: "polygon-fill",
                    type: "fill",
                    source: "polygon",
                    paint: {
                        "fill-color": "#22c55e", 
                        "fill-opacity": 0.4,
                    }
                });
            }

            if (!map.getLayer("polygon-outline")) {
                map.addLayer({
                    id: "polygon-outline",
                    type: "line",
                    source: "polygon",
                    paint: {
                        "line-color": "#16a34a",
                        "line-width": 2,
                    }
                });
            }
        }, [map, isLoaded]);

        return null;
    }


    //style real "https://tiles.openfreemap.org/styles/bright"
    return (
        <div className={styles.father}>
            <Map center={center} zoom={13} styles={{
                light: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
                dark: "https://basemaps.cartocdn.com/gl/voyager-nolabels-gl-style/style.json",
            }}>
                <CustomPolygonLayer midPoints={midPoints} />
                {midPoints.map((point, index) => (
                    <MapMarker
                        key={index}
                        longitude={point.coordinate.lng}
                        latitude={point.coordinate.lat}
                    >
                        <MarkerContent>
                            <Bubble point={point}></Bubble>
                        </MarkerContent>

                        <MarkerTooltip>
                            {point.original}
                        </MarkerTooltip>

                        <MarkerPopup>
                            <div className="space-y-1">
                                <p className="font-medium">{point.original}</p>
                                <p className="text-sm">
                                    CO₂: {point.infos[0].co2}
                                </p>
                                <p className="text-sm">
                                    kWh: {point.infos[0].kWh}
                                </p>
                                <p className="text-sm">
                                    VMT: {point.infos[0].VMT}
                                </p>
                            </div>
                        </MarkerPopup>
                    </MapMarker>
                ))}
            </Map>
        </div>
    );
}