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

/**
 * Salin Content-Security-Policy dari `public/_headers` ke `<meta http-equiv>`
 * di hasil build.
 *
 * KENAPA PERLU. Frontend ini naik ke DUA tempat, dan hanya satu di antaranya
 * bisa mengirim header respons:
 *
 *   Cloudflare Pages   membaca `public/_headers`. CSP-nya benar-benar terkirim.
 *   GitHub Pages       mengabaikannya sepenuhnya - diukur 2 Sep 2026, nol dari
 *                      empat header itu muncul di responsnya.
 *
 * Jadi tanpa plugin ini, terbitan cadangan berjalan tanpa CSP sama sekali
 * sementara berkas `_headers` di sebelahnya membuat setiap pembacanya yakin ia
 * terlindungi. `<meta http-equiv>` adalah satu-satunya cara memasang CSP di
 * hosting yang tidak bisa mengirim header.
 *
 * KENAPA `apply: 'build'`, BUKAN DITULIS LANGSUNG DI index.html. Karena
 * index.html juga dipakai `npm run dev`, dan CSP ini mengizinkan `connect-src`
 * hanya ke backend produksi - dipasang di sana, ia memblokir SETIAP panggilan
 * ke `http://localhost:8000` dan mematikan seluruh pengembangan lokal. Sudah
 * diukur di peramban sebelum ditulis begini: 6 pelanggaran, peta kosong, dan
 * tidak satu pun uji yang menangkapnya karena uji tidak membuka peramban.
 *
 * KENAPA DIBACA DARI `_headers`, BUKAN DISALIN. Dua salinan CSP yang bergeser
 * sedikit saja menghasilkan IRISAN di Cloudflare - di mana keduanya berlaku
 * sekaligus - dan irisan itu memblokir hal yang tidak pernah diniatkan siapa
 * pun, tanpa galat dan tanpa pesan. Satu sumber, jadi keduanya tidak bisa
 * berselisih.
 *
 * `frame-ancestors` sengaja DIBUANG: ia diabaikan kalau datang lewat <meta>,
 * dan peramban menuliskan peringatannya ke konsol situs yang dibuka juri.
 * X-Frame-Options di `_headers` yang mengurusnya, di terbitan yang memang bisa
 * mengirimnya.
 */
function cspDariHeaders(): Plugin {
  let asalApi = ''
  return {
    name: 'csp-meta',
    apply: 'build',
    // Asal backend diambil dari env YANG BENAR-BENAR DIPAKAI build ini, bukan
    // dari daftar tetap. Lihat alasannya di bawah, di tempat ia ditambahkan.
    configResolved(konfig) {
      const url = konfig.env.VITE_API_BASE_URL as string | undefined
      try {
        asalApi = url ? new URL(url).origin : ''
      } catch {
        asalApi = ''
      }
    },
    transformIndexHtml(html) {
      const teks = readFileSync(new URL('./public/_headers', import.meta.url), 'utf-8')
      const baris = teks
        .split('\n')
        .map((b) => b.trim())
        .filter((b) => b.startsWith('Content-Security-Policy:'))
      // Build GAGAL kalau tidak ketemu, bukan melanjutkan tanpa CSP. Build yang
      // diam-diam menghilangkan penjagaan adalah build yang naik ke produksi.
      if (baris.length !== 1) {
        throw new Error(
          `public/_headers harus memuat TEPAT SATU baris Content-Security-Policy, ketemu ${baris.length}`,
        )
      }
      const arahan = baris[0]
        .slice('Content-Security-Policy:'.length)
        .split(';')
        .map((a) => a.trim())
        .filter((a) => a && !a.startsWith('frame-ancestors'))

      // Asal backend build INI diizinkan, kalau ia belum disebut `_headers`.
      //
      // Kenapa bukan sekadar memakai daftar `_headers` apa adanya: daftar itu
      // menyebut backend PRODUKSI saja, dan itu benar untuk terbitan publik.
      // Tetapi cara yang DIWAJIBKAN CLAUDE.md untuk memeriksa build sebelum
      // deploy adalah `vite build && vite preview` lalu mengklik petanya -
      // dengan backend lokal di localhost:8000. CSP yang cuma mengenal Azure
      // memblokir setiap panggilan ke sana, dan hasilnya bukan galat yang
      // terbaca melainkan peta yang terbuka dengan daftar lokasi kosong. Jadi
      // satu-satunya pemeriksaan yang bisa menangkap jebakan #1 justru
      // dimatikan oleh penjagaan yang dipasang di sini.
      //
      // Dibaca dari `VITE_API_BASE_URL` build ini, jadi tidak ada asal
      // pengembangan yang bisa menyelinap ke terbitan publik: build deploy
      // mengisi variabel itu dengan URL Azure, yang memang sudah ada di daftar
      // dan karenanya tidak menambah apa pun.
      if (asalApi) {
        const i = arahan.findIndex((a) => a.startsWith('connect-src'))
        if (i >= 0 && !arahan[i].split(/\s+/).includes(asalApi)) {
          arahan[i] = `${arahan[i]} ${asalApi}`
        }
      }
      const csp = arahan.join('; ')
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: csp },
            injectTo: 'head-prepend',
          },
        ],
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
  plugins: [react(), tailwindcss(), workerMaplibre(), cspDariHeaders()],
  // maplibre-gl memuat worker internalnya sendiri lewat cara yang bikin bingung
  // dependency-pre-bundler Vite (error "maplibre-gl-worker.mjs does not exist").
  // Dikecualikan dari optimizeDeps supaya worker-nya dimuat apa adanya.
  optimizeDeps: { exclude: ['maplibre-gl'] },
})
