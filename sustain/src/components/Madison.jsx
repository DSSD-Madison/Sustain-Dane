import { useCallback, useEffect, useState } from "react";
import { Map, MapControls, useMap } from "@/components/ui/map";

const center = [-89.4075, 43.0765];

const createBox = (lng, lat, offsetLng = 0.008, offsetLat = 0.0008) => {
    return {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                properties: {
                    name: "University Avenue",
                    description: "A lot of CO2 compiler",
                },
                geometry: {
                    type: "Polygon",
                    coordinates: [
                        [
                            [lng - offsetLng, lat - offsetLat],
                            [lng + offsetLng, lat - offsetLat],
                            [lng + offsetLng, lat + offsetLat],
                            [lng - offsetLng, lat + offsetLat],
                            [lng - offsetLng, lat - offsetLat],
                        ],
                    ],
                },
            },
        ],
    };
};

function UniversityBoxLayer() {
    const { map, isLoaded } = useMap();
    const [popupCoords, setPopupCoords] = useState(null);

    const addLayer = useCallback(() => {
        if (!map) return;

        const geojson = createBox(center[0], center[1], 0.0020, 0.0006);

        if (!map.getSource("university-box")) {
            map.addSource("university-box", {
                type: "geojson",
                data: geojson,
            });
        }

        if (!map.getLayer("university-box-fill")) {
            map.addLayer({
                id: "university-box-fill",
                type: "fill",
                source: "university-box",
                paint: {
                    "fill-color": "#2563eb",
                    "fill-opacity": 0.35,
                },
            });
        }
    }, [map]);

    useEffect(() => {
        if (!map || !isLoaded) return;

        addLayer();

        const handleClick = (e) => {
            const features = map.queryRenderedFeatures(e.point, {
                layers: ["university-box-fill"],
            });

            if (features.length) {
                setPopupCoords(e.lngLat);
            }
        };

        map.on("click", "university-box-fill", handleClick);

        return () => {
            map.off("click", "university-box-fill", handleClick);
        };
    }, [map, isLoaded, addLayer]);

    return (
        <>
            {popupCoords && (
                <div
                    className="absolute z-50 bg-white text-black text-sm p-2 rounded shadow-md"
                    style={{
                        left: "50%",
                        top: "20px",
                        transform: "translateX(-50%)",
                    }}
                >
                    <strong>University Avenue</strong>
                    <br />
                    A lot of CO2
                </div>
                // where we can add some informations about CO2
            )}
        </>
    );
}



export function Madison () {
    return (
        <div className="h-[90vh] w-full">
            <Map center={center} zoom={15}>
                <MapControls />
                <UniversityBoxLayer />
            </Map>
        </div>
    );
}
