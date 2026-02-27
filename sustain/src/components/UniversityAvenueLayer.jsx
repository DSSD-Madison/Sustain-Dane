import { useEffect } from "react";
import { useMap } from "@/components/ui/map";

export function UniversityAvenueLayer() {
    const { map, isLoaded } = useMap();

    useEffect(() => {
        if (!map || !isLoaded) return;

        const loadStreet = async () => {
            const res = await fetch(
                "https://nominatim.openstreetmap.org/search?format=geojson&q=West Johnson St, Madison WI&polygon_geojson=1"
            );

            const data = await res.json();

            if (!data.features || data.features.length === 0) return;

            if (map.getLayer("street-fill")) map.removeLayer("street-fill");
            if (map.getLayer("street-outline")) map.removeLayer("street-outline");
            if (map.getSource("street")) map.removeSource("street");

            map.addSource("street", {
                type: "geojson",
                data: data,
            });

            map.addLayer({
                id: "street-fill",
                type: "fill",
                source: "street",
                paint: {
                    "fill-color": "#22c55e",
                    "fill-opacity": 0.4,
                },
            });

            map.addLayer({
                id: "street-outline",
                type: "line",
                source: "street",
                paint: {
                    "line-color": "#16a34a",
                    "line-width": 3,
                },
            });
        };

        loadStreet();
    }, [map, isLoaded]);

    return null;
}
