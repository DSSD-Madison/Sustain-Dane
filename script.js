const map = L.map("map").setView([43.0731, -89.4012], 13);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const marker = L.marker([43.0731, -89.4012]).addTo(map);

marker
  .bindPopup(
    "<b>Hello!</b><br>Welcome to Sustain Dane's Efficiency Navigator Program."
  )
  .openPopup();

const circle = L.circle([43.075, -89.38], {
  color: "red",
  fillColor: "#f03",
  fillOpacity: 0.5,
  radius: 500,
}).addTo(map);
