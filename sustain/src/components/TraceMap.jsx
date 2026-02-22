import { useEffect, useState } from "react";
import styles from "./TraceMap.module.css"
import {
    Map,
    MapMarker,
    MarkerContent,
    MarkerPopup,
    MarkerTooltip,
} from "@/components/ui/map";
import Bubble from "@/components/Bubble.jsx";

export function TraceMap() {
    const center = [-89.4075, 43.0765];

    const [mapList] = useState([
        {
            address: { street: "University Ave / N Midvale Blvd, Madison WI" }
        },
        {
            address: { street: "Rethke Ave / Worthington Ave, Madison WI" }
        },
        {
            address: { street: "E. Johnson St. / N. 6th St, Madison WI" }
        },
        {
            address: { street: "Monterey Dr. / Trailsway, Madison WI" }
        }
    ]);

    const [locations, setLocations] = useState([]);
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

    // async function fetchStreets(mapList) {
    //     const results = [];
    //
    //     for (let i = 0; i < mapList.length; i++) {
    //
    //         const fullAddress = mapList[i].address.street;
    //         const streets = fullAddress.split("/");
    //
    //         const streetData = [];
    //
    //         for (let j = 0; j < streets.length; j++) {
    //
    //             const query = encodeURIComponent(streets[j].trim());
    //
    //             const response = await fetch(
    //                 `https://nominatim.openstreetmap.org/search?format=geojson&q=${query}&polygon_geojson=1`,
    //                 {
    //                     headers: {
    //                         "User-Agent": "trace-map-app"
    //                     }
    //                 }
    //             );
    //
    //             const data = await response.json();
    //
    //             streetData.push({
    //                 name: streets[j].trim(),
    //                 geojson: data
    //             });
    //         }
    //
    //         results.push({
    //             original: fullAddress,
    //             streets: streetData
    //         });
    //     }
    //
    //     return results;
    // }

    // function segmentsIntersect(p1, p2, q1, q2) {
    //     const det = (a, b, c, d) => a * d - b * c;
    //
    //     const x1 = p1[0], y1 = p1[1];
    //     const x2 = p2[0], y2 = p2[1];
    //     const x3 = q1[0], y3 = q1[1];
    //     const x4 = q2[0], y4 = q2[1];
    //
    //     const denominator = det(x1 - x2, y1 - y2, x3 - x4, y3 - y4);
    //     if (denominator === 0) return null;
    //
    //     const px = det(
    //         det(x1, y1, x2, y2),
    //         x1 - x2,
    //         det(x3, y3, x4, y4),
    //         x3 - x4
    //     ) / denominator;
    //
    //     const py = det(
    //         det(x1, y1, x2, y2),
    //         y1 - y2,
    //         det(x3, y3, x4, y4),
    //         y3 - y4
    //     ) / denominator;
    //
    //     function between(a, b, c) {
    //         return a >= Math.min(b, c) && a <= Math.max(b, c);
    //     }
    //
    //     if (
    //         between(px, x1, x2) &&
    //         between(px, x3, x4) &&
    //         between(py, y1, y2) &&
    //         between(py, y3, y4)
    //     ) {
    //         return [px, py];
    //     }
    //
    //     return null;
    // }
    //
    // function extractAllCoordinates(geojson) {
    //     const allCoords = [];
    //
    //     for (let i = 0; i < geojson.features.length; i++) {
    //         const geometry = geojson.features[i].geometry;
    //
    //         if (geometry.type === "LineString") {
    //             allCoords.push(...geometry.coordinates);
    //         }
    //     }
    //
    //     return allCoords;
    // }
    //
    // function findAllIntersections(processedData) {
    //     const intersections = [];
    //
    //     for (let i = 0; i < processedData.length; i++) {
    //
    //         const streetA = processedData[i].streets[0].geojson;
    //         const streetB = processedData[i].streets[1].geojson;
    //
    //         const coordsA = extractAllCoordinates(streetA);
    //         const coordsB = extractAllCoordinates(streetB);
    //
    //         for (let a = 0; a < coordsA.length - 1; a++) {
    //             for (let b = 0; b < coordsB.length - 1; b++) {
    //
    //                 const intersect = segmentsIntersect(
    //                     coordsA[a],
    //                     coordsA[a + 1],
    //                     coordsB[b],
    //                     coordsB[b + 1]
    //                 );
    //
    //                 if (intersect) {
    //                     intersections.push({
    //                         original: processedData[i].original,
    //                         coordinate: intersect
    //                     });
    //                 }
    //             }
    //         }
    //     }
    //
    //     return intersections;
    // }

    useEffect(() => {
        async function load() {
            //const data = await fetchStreets(mapList);
            // console.log(data)
            // setLocations(data);
            //const crosses = findAllIntersections(data);
            //console.log(crosses)
            console.log("geojetson " + geoJsonData)
            //setMidPoints(crosses);

        }
        console.log(midPoints)
        load();
    }, []);

    const geoJsonData = {
        type: "FeatureCollection",
        features: midPoints.map((point) => ({
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [
                    point.coordinate.lng,
                    point.coordinate.lat,
                ],
            },
            properties: {
                co2: point.infos[0].co2,
                original: point.original,
            },
        })),
    };

    //style real "https://tiles.openfreemap.org/styles/bright"
    return (
        <div className={styles.father}>
            <Map center={center} zoom={13} styles={{
                light: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
                dark: "https://basemaps.cartocdn.com/gl/voyager-nolabels-gl-style/style.json",
            }}>
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