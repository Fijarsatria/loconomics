import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages menyajikan repo di /<nama-repo>/, bukan di akar. Dibaca dari
  // env supaya `npm run dev` tetap di / dan build produksi bisa diarahkan
  // tanpa menyentuh berkas ini.
  //
  // Seluruh aset yang dirujuk dari kode memakai `import.meta.env.BASE_URL` -
  // gaya basemap, kartu gerbang, dan cadangan GeoJSON heksagon - jadi mengubah
  // nilai ini cukup untuk memindahkan seluruh aplikasi ke sub-jalur.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  // maplibre-gl memuat worker internalnya sendiri lewat cara yang bikin bingung
  // dependency-pre-bundler Vite (error "maplibre-gl-worker.mjs does not exist").
  // Dikecualikan dari optimizeDeps supaya worker-nya dimuat apa adanya.
  optimizeDeps: { exclude: ['maplibre-gl'] },
})
