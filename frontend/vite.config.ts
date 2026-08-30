import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Ikutkan worker internal MapLibre ke hasil build.
 *
 * TANPA INI, BUILD PRODUKSI TIDAK PERNAH MENGGAMBAR SATU HEKSAGON PUN - dan
 * gagalnya sepenuhnya diam. Ini yang terjadi:
 *
 * MapLibre menyusun URL worker-nya sendiri dengan
 * `new URL('./maplibre-gl-worker.mjs', import.meta.url)`, jadi ia mengharapkan
 * berkas itu duduk di sebelah chunk-nya di `assets/`. Vite tidak pernah
 * mengemitnya - `optimizeDeps.exclude` yang sudah ada di bawah cuma berlaku
 * untuk dev server, bukan untuk build. Akibatnya:
 *
 *   1. worker dimuat dari URL yang 404
 *   2. worker mati sebelum sempat menjawab apa pun
 *   3. sumber GeoJSON tidak pernah diurai, jadi isinya NOL fitur
 *   4. layer terpasang, ekspresi cat benar, kamera benar - dan peta kosong
 *
 * Tidak ada galat di konsol, tidak ada permintaan gagal yang terlihat di tab
 * Network halaman (worker punya konteksnya sendiri), dan `npm run dev` bekerja
 * sempurna karena di sana Vite melayani berkasnya dari node_modules.
 *
 * Terukur: `querySourceFeatures` mengembalikan 0 dari 708 fitur yang baru saja
 * berhasil diunduh.
 *
 * `emitFile` dengan `fileName` TETAP, bukan `?url`: yang kedua menghasilkan
 * nama ber-hash, dan MapLibre mencari nama yang persis.
 */
function workerMaplibre(): Plugin {
  return {
    name: 'maplibre-worker',
    apply: 'build',
    generateBundle() {
      const require = createRequire(import.meta.url)
      // DUA berkas, bukan satu. `maplibre-gl-worker.mjs` mengimpor
      // `./maplibre-gl-shared.mjs` dari sebelahnya - mengemit worker-nya saja
      // membuatnya dijawab 200 lalu mati seketika saat impornya 404. Gejalanya
      // sama persis dengan tidak mengemit apa pun: peta kosong, nol galat.
      for (const nama of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
        this.emitFile({
          type: 'asset',
          fileName: `assets/${nama}`,
          source: readFileSync(require.resolve(`maplibre-gl/dist/${nama}`), 'utf-8'),
        })
      }
    },
  }
}

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
  plugins: [react(), tailwindcss(), workerMaplibre()],
  // maplibre-gl memuat worker internalnya sendiri lewat cara yang bikin bingung
  // dependency-pre-bundler Vite (error "maplibre-gl-worker.mjs does not exist").
  // Dikecualikan dari optimizeDeps supaya worker-nya dimuat apa adanya.
  optimizeDeps: { exclude: ['maplibre-gl'] },
})
