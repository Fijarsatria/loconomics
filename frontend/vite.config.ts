import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // maplibre-gl memuat worker internalnya sendiri lewat cara yang bikin bingung
  // dependency-pre-bundler Vite (error "maplibre-gl-worker.mjs does not exist").
  // Dikecualikan dari optimizeDeps supaya worker-nya dimuat apa adanya.
  optimizeDeps: { exclude: ['maplibre-gl'] },
})
