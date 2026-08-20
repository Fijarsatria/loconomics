import { MapContainer, TileLayer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

// Placeholder basemap OSM — ganti ke MAPID MAPS begitu API key sudah didapat.
// Stasiun Manggarai dipakai sebagai titik tengah awal (salah satu dari 6 kawasan pilot).
const MANGGARAI: [number, number] = [-6.2131, 106.8496]

function App() {
  return (
    <div className="h-full w-full">
      <MapContainer center={MANGGARAI} zoom={15} className="h-full w-full">
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />
      </MapContainer>
    </div>
  )
}

export default App
