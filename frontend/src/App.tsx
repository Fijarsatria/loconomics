import { useEffect, useRef } from 'react'
import { Map as MapLibreMap, NavigationControl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

// Stasiun Manggarai dipakai sebagai titik tengah awal (salah satu dari 6 kawasan pilot).
const MANGGARAI: [number, number] = [106.8496, -6.2131] // MapLibre pakai urutan [lon, lat]

const MAPID_KEY = import.meta.env.VITE_MAPID_MAPS_API_KEY
const MAPID_STYLE_URL = `https://basemap.mapid.io/styles/basic/style.json?key=${MAPID_KEY}`

function App() {
  const mapContainer = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!mapContainer.current) return

    const map = new MapLibreMap({
      container: mapContainer.current,
      style: MAPID_STYLE_URL,
      center: MANGGARAI,
      zoom: 15,
    })
    map.addControl(new NavigationControl(), 'top-right')

    return () => map.remove()
  }, [])

  return (
    <div
      ref={mapContainer}
      className="h-full w-full"
      style={{ position: 'absolute', inset: 0 }}
    />
  )
}

export default App
