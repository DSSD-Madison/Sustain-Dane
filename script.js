const map = L.map("map").setView([43.0731, -89.4012], 13);

// Add a Tile Layer (OpenStreetMap is free and doesn't require an API key)
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

// Add a Marker
const marker = L.marker([43.0731, -89.4012]).addTo(map);

// Add a Popup to the marker
marker.bindPopup("<b>Hello!</b><br>This is Madison, WI.").openPopup();

// Add a Circle
const circle = L.circle([43.075, -89.38], {
  color: "red",
  fillColor: "#f03",
  fillOpacity: 0.5,
  radius: 500,
}).addTo(map);
