
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Map as MapLibreMap,
  AttributionControl,
  Marker,
  ScaleControl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type MapLayerTouchEvent,
  type Point,
  type StyleSpecification,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

// Aturan pewarnaan tinggal di lib/, bukan di sini - dipakai juga oleh dek kartu
// peta di halaman gerbang. Lihat catatan di berkasnya.
import {
  ANGKA_LAYER,
  BASEMAP_GELAP,
  FONT_ANGKA,
  GARIS_HEX,
  OPASITAS_GARIS,
  OPASITAS_LAYER,
  SELUBUNG,
  TEBAL_GARIS,
  TEKS_HEX,
  WARNA_FOKUS,
  WARNA_RUTE,
  cakupanLayer,
  WARNA_RUTE_ALT,
  WARNA_ISO,
  WARNA_RUTE_BAYANG,
  WARNA_RUTE_TUNGGAL,
  WARNA_GEDUNG,
  WARNA_BLOK,
  WARNA_GARIS_BLOK,
  WARNA_LAYER,
  idLabelPertama,
} from '../lib/layer-peta'

import {
  ATRIBUSI_PETA,
  ATRIBUSI_SATELIT,
  GAYA_BASEMAP,
  GLYPH_MAPID,
  KAWASAN_AWAL,
  KUADRAN,
  SUMBER_UBIN_MAPID,
  ZOOM_AWAL,
  adaKunciBasemap,
  bubuhiKunciBasemap,
  kunciBasemapSusulan,
  siapkanKunciBasemap,
  urlGaya,
  type NamaGaya,
  type NamaLayer,
  KERAPATAN_NAMA,
} from '../config'
import { api } from '../lib/api'
import { jarakSingkat } from '../lib/format'
import type { BedahBlok, KonteksSimpul, PropertiHeksagon, ProfilRute, RuteJalan, SimpulTransit } from '../types'
import { useBahasa, useNamaZona, useTeks } from '../lib/bahasa'

const SUMBER = 'heksagon'
const L_ISI = 'hex-isi'
const L_ARSIR = 'hex-arsir'
const L_GARIS = 'hex-garis'
const L_SOROT = 'hex-sorot'
const L_PILIH = 'hex-pilih'
const L_ANGKA = 'hex-angka'
const L_SELUBUNG = 'selubung-basemap'
const POLA = 'arsir-ketidakpastian'
const SUMBER_BLOK = 'blok'
const L_BLOK_ISI = 'blok-isi'
const L_BLOK_GARIS = 'blok-garis'
const L_BLOK_PILIH = 'blok-pilih'
const L_BLOK_ANGKA = 'blok-angka'
/** Sumber terpisah untuk lencana nomor heksagon pembanding. */
const SUMBER_FOKUS = 'fokus'
const L_NOMOR = 'fokus-nomor'
const L_NOMOR_TEKS = 'fokus-nomor-teks'

const SUMBER_ISO = 'catchment'
const L_ISO_ISI = 'catchment-isi'
const L_ISO_GARIS = 'catchment-garis'
const L_ISO_TEKS = 'catchment-teks'

const SUMBER_RUTE = 'rute'
const L_RUTE_BAYANG = 'rute-bayang'
const L_RUTE_ALT = 'rute-alt'
const L_RUTE = 'rute-utama'
const L_RUTE_TEKS = 'rute-teks'
/** Kepala bercahaya di ujung rute yang sedang tumbuh. Hanya ada selama animasi. */
const L_RUTE_KEPALA = 'rute-kepala'
const SUMBER_ALIR = 'rute-alir'
const L_ALIR = 'rute-alir-titik'
/** Pin titik awal (pusat heksagon) dan tujuan (simpul). */
const L_UJUNG = 'rute-ujung'

const GAMBAR_MS = 1700
/** Jeda tiap rute berikutnya berangkat. Berundak, bukan serempak. */
const UNDAK_MS = 240
/** Garis mulai tumbuh sesudah kamera mulai mundur, bukan bersamaan. */
const TUNDA_RUTE_MS = 380
/** Satu perjalanan penuh titik aliran, dari pusat heksagon ke simpulnya. */
const ALIR_MS = 2400
/** Jeda antar-langkah aliran. 16 langkah/detik - sama dengan alasan jam arus
 *  yang lama: mata sudah membacanya halus, dan rAF 60x berarti empat kali
 *  ongkos untuk gerak yang sama. */
const ALIR_LANGKAH_MS = 62

function panjangKumulatif(k: [number, number][]): number[] {
  const kum = [0]
  for (let i = 1; i < k.length; i++) {
    const dx = k[i][0] - k[i - 1][0]
    const dy = k[i][1] - k[i - 1][1]
    kum.push(kum[i - 1] + Math.hypot(dx, dy))
  }
  return kum
}

/** Titik di sepanjang polyline pada pecahan panjang `t` (0..1). */
function titikPada(k: [number, number][], kum: number[], t: number): [number, number] {
  const total = kum[kum.length - 1]
  if (total <= 0) return k[0]
  const target = total * Math.min(1, Math.max(0, t))
  let i = 1
  while (i < kum.length - 1 && kum[i] < target) i++
  const rentang = kum[i] - kum[i - 1] || 1
  const f = (target - kum[i - 1]) / rentang
  return [k[i - 1][0] + (k[i][0] - k[i - 1][0]) * f, k[i - 1][1] + (k[i][1] - k[i - 1][1]) * f]
}

function potongJalur(
  k: [number, number][],
  kum: number[],
  t: number,
): [number, number][] {
  if (t >= 1) return k
  const total = kum[kum.length - 1]
  if (total <= 0 || t <= 0) return [k[0], k[0]]
  const target = total * t
  const keluar: [number, number][] = []
  for (let i = 0; i < k.length; i++) {
    if (kum[i] <= target) keluar.push(k[i])
    else break
  }
  keluar.push(titikPada(k, kum, t))
  // Satu titik bukan garis; MapLibre tidak menggambar apa pun untuk itu.
  return keluar.length >= 2 ? keluar : [k[0], keluar[0]]
}

function buatPolaArsir(): ImageData {
  const s = 16 // digambar 2x lalu dipasang dengan pixelRatio 2
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  g.strokeStyle = 'rgba(22,33,28,0.34)'
  g.lineWidth = 2
  for (let i = -s; i < s * 2; i += 7) {
    g.beginPath()
    g.moveTo(i, 0)
    g.lineTo(i + s, s)
    g.stroke()
  }
  return g.getImageData(0, 0, s, s)
}

const ZOOM_POI: Record<string, number> = {
  poi_z14: 12.5,
  // Kedua ini dibiarkan seperti gaya aslinya. Yang diminta "penanda terlihat
  // saat di-zoom keluar", dan yang menandai sebuah tempat adalah rank 1-6 -
  // sisanya justru yang membuat layar penuh.
  poi_z15: 15,
  poi_z16: 16,
  poi_transit: 11,
}

const RE_NAMA_TEMPAT = /^(poi|place|water_name)|^(place|city|capital city|state|country|continent) labels$/i

/** Layer ekstrusi gedung milik kita, untuk gaya yang tidak membawanya sendiri. */
const L_GEDUNG = 'loc-gedung-3d'
/** Sumber ubin vektor MAPID yang ditambahkan ke gaya satelit untuk gedung 3D. */
const SUMBER_GEDUNG = 'loc-mapidtiles'

function bukaFungsiLama(v: unknown): unknown {
  if (Array.isArray(v)) {
    // Bentuk lama `["linear", x1, y1, x2, y2]` adalah "linear ber-easing" milik
    // Mapbox v0; padanannya di MapLibre adalah `["cubic-bezier", ...]`.
    // `["linear"]` polos (tanpa angka) sudah sah dan dibiarkan.
    if (v[0] === 'linear' && v.length === 5 && v.every((x, i) => i === 0 || typeof x === 'number')) {
      return ['cubic-bezier', ...v.slice(1)].map(bukaFungsiLama)
    }
    return v.map(bukaFungsiLama)
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const k = Object.keys(o)
    if ('value' in o && k.every((x) => x === 'value' || x === 'Count')) {
      return bukaFungsiLama(o.value)
    }
    if (k.length === 1 && Array.isArray(o.stops)) {
      const rata: unknown[] = ['interpolate', ['linear'], ['zoom']]
      for (const s of o.stops as [number, unknown][]) rata.push(s[0], bukaFungsiLama(s[1]))
      return rata
    }
    const keluar: Record<string, unknown> = {}
    for (const [kk, vv] of Object.entries(o)) keluar[kk] = bukaFungsiLama(vv)
    return keluar
  }
  return v
}

function rapiLapis(l: unknown): unknown {
  const lapis = l as { layout?: Record<string, unknown> }
  const ts = lapis.layout?.['text-size']
  if (ts === undefined) return l
  let n = 12
  if (typeof ts === 'number') n = ts
  else {
    const semua: number[] = []
    const kumpul = (v: unknown) => {
      if (typeof v === 'number') semua.push(v)
      else if (Array.isArray(v)) v.forEach(kumpul)
    }
    kumpul(ts)
    if (semua.length) n = semua[semua.length - 1]
  }
  return { ...lapis, layout: { ...lapis.layout, 'text-size': Math.min(14, Math.max(10, n)) } }
}

function tataGaya(gaya: NamaGaya) {
  return (_lama: StyleSpecification | undefined, baru: StyleSpecification): StyleSpecification => {
    if (!GAYA_BASEMAP[gaya]?.langsung) return baru
    const sumber = { ...baru.sources }
    const kunciCitra = Object.keys(sumber).find((k) => sumber[k]?.type === 'raster')
    if (kunciCitra) {
      sumber[kunciCitra] = { ...sumber[kunciCitra], attribution: ATRIBUSI_SATELIT } as never
    }
    const lapis = baru.layers.map((l) => rapiLapis(bukaFungsiLama(l))) as typeof baru.layers
    return { ...baru, glyphs: GLYPH_MAPID, sources: sumber, layers: lapis }
  }
}

/** Layer simbol basemap PERTAMA dalam urutan gaya - di bawahnya gedung berdiri. */
function labelBasemapPertama(m: MapLibreMap, kecuali: string): string | undefined {
  return (m.getStyle().layers ?? []).find(
    (l) => l.type === 'symbol' && l.id !== kecuali && !l.id.startsWith('hex-') && !l.id.startsWith('rute-') && !l.id.startsWith('fokus-') && !l.id.startsWith('catchment-') && !l.id.startsWith('blok-'),
  )?.id
}

function aturGedung3D(m: MapLibreMap, gaya: NamaGaya, nyala: boolean) {
  if (!m.isStyleLoaded() && !m.getStyle()?.layers?.length) return
  const bawaan = GAYA_BASEMAP[gaya]?.gedung3d
  const idGedung = bawaan && m.getLayer(bawaan) ? bawaan : L_GEDUNG

  if (!nyala) {
    if (m.getLayer(L_GEDUNG)) m.removeLayer(L_GEDUNG)
    // Gaya yang membawa gedungnya sendiri: kembalikan ke bawah heksagon, tempat
    // gayanya menaruhnya - di peta datar ia cuma tapak bangunan, dan tapak di
    // atas isian heksagon menutupi warnanya.
    if (bawaan && m.getLayer(bawaan) && m.getLayer(L_ISI)) m.moveLayer(bawaan, L_ISI)
    return
  }

  if (idGedung === L_GEDUNG && !m.getLayer(L_GEDUNG)) {
    let sumber = 'mapidtiles'
    if (!m.getSource(sumber)) {
      if (!m.getSource(SUMBER_GEDUNG)) m.addSource(SUMBER_GEDUNG, SUMBER_UBIN_MAPID)
      sumber = SUMBER_GEDUNG
    }
    const w = WARNA_GEDUNG[gaya] ?? WARNA_GEDUNG.terang
    m.addLayer({
      id: L_GEDUNG,
      type: 'fill-extrusion',
      source: sumber,
      'source-layer': 'building',
      minzoom: 14,
      paint: {
        'fill-extrusion-color': w.warna,
        'fill-extrusion-opacity': w.opasitas,
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      },
    })
  } else if (bawaan && idGedung === bawaan) {
    // Gedung bawaan gaya Jalan (MAPID `basic`) baru muncul di zoom 17. Diturunkan ke 14
    // supaya mode 3D langsung terlihat di zoom kerja kawasan, bukan hanya
    // saat orang sudah menempel ke satu atap.
    m.setLayerZoomRange(bawaan, 14, 24)
  }

  const sebelum = m.getLayer(L_ANGKA) ? L_ANGKA : labelBasemapPertama(m, idGedung)
  if (sebelum && sebelum !== idGedung) m.moveLayer(idGedung, sebelum)
}

function terapkanNamaTempat(m: MapLibreMap, kerapatan: string) {
  const aturan = KERAPATAN_NAMA[kerapatan] ?? KERAPATAN_NAMA.normal
  const geser = aturan.geser
  for (const l of m.getStyle().layers ?? []) {
    if (!RE_NAMA_TEMPAT.test(l.id) || l.type !== 'symbol') continue
    if (geser === null) {
      m.setLayoutProperty(l.id, 'visibility', 'none')
      continue
    }
    m.setLayoutProperty(l.id, 'visibility', 'visible')
    const z = ZOOM_POI[l.id]
    if (z !== undefined) {
      // Dijepit ke rentang yang sah MapLibre (0-24). Geseran negatif pada
      // ambang terendah bisa membawanya di bawah nol, dan `setLayerZoomRange`
      // menolaknya dengan galat yang menghentikan seluruh penerapan.
      m.setLayerZoomRange(l.id, Math.max(0, Math.min(23, z + geser)), 24)
    }
  }
}

function siapkanBasemap(m: MapLibreMap, gaya: NamaGaya, kerapatan: string) {
  const layers = m.getStyle().layers ?? []
  const gelap = BASEMAP_GELAP.includes(gaya)
  const kecilkanNama = window.matchMedia('(max-width: 1023.98px)').matches

  // Kerapatan penandanya diurus `terapkanNamaTempat` di bawah - satu tempat,
  // supaya pilihan pengguna dan pemuatan gaya tidak pernah berselisih.
  for (const l of layers) {
    if (RE_NAMA_TEMPAT.test(l.id) && l.type === 'symbol') {
      // Halo lebih tebal daripada bawaan gaya. Nama tempat sekarang berdiri di
      // atas isian heksagon yang berwarna, bukan di atas kertas putih.
      m.setPaintProperty(l.id, 'text-halo-width', 1.6)
      m.setPaintProperty(l.id, 'text-halo-blur', 0.3)
      if (kecilkanNama) {
        const ts = m.getLayoutProperty(l.id, 'text-size')
        if (typeof ts === 'number') {
          m.setLayoutProperty(l.id, 'text-size', ['*', ts, 0.8])
        } else if (Array.isArray(ts)) {
          m.setLayoutProperty(l.id, 'text-size', ['*', ts, 0.8])
        }
      }
    }

    if (gelap && l.type === 'symbol') {
      m.setPaintProperty(l.id, 'text-color', '#e6edea')
      m.setPaintProperty(l.id, 'text-halo-color', 'rgba(4, 10, 8, 0.92)')
      m.setPaintProperty(l.id, 'text-halo-width', 1.5)
      m.setPaintProperty(l.id, 'text-halo-blur', 0.4)
    }
  }

  const selubung = SELUBUNG[gaya] ?? SELUBUNG.terang
  if (m.getLayer(L_SELUBUNG)) m.removeLayer(L_SELUBUNG)
  m.addLayer(
    {
      id: L_SELUBUNG,
      type: 'background',
      paint: {
        'background-color': selubung.warna,
        'background-opacity': selubung.opasitas,
      },
    },
    idLabelPertama(m),
  )

  terapkanNamaTempat(m, kerapatan)
}

// ---------------------------------------------------------------------------
// Animasi kemunculan heksagon
// ---------------------------------------------------------------------------

function tungguTenang(m: MapLibreMap, batasMs = 1500): Promise<void> {
  return new Promise((selesai) => {
    if (m.loaded() && m.areTilesLoaded()) return selesai()
    let sudah = false
    const beres = () => {
      if (sudah) return
      sudah = true
      clearTimeout(jam)
      m.off('idle', beres)
      selesai()
    }
    const jam = setTimeout(beres, batasMs)
    m.once('idle', beres)
  })
}

const LEBAR_GELOMBANG = 0.3
const DURASI_MASUK = 950
const DURASI_KELUAR = 420
/** t saat seluruh heksagon sudah terlihat: 1 (jarak terjauh) + lebar gelombang. */
const T_PENUH = 1 + LEBAR_GELOMBANG

function gerbang(t: number) {
  return [
    'interpolate',
    ['linear'],
    // coalesce, bukan get telanjang: satu fitur tanpa properti sudah cukup
    // membuat interpolate melempar galat dan mematikan SELURUH layer. Yang
    // tidak punya urutan dianggap terjauh, jadi ia muncul paling akhir.
    ['coalesce', ['get', '_u'], 1],
    t - LEBAR_GELOMBANG,
    1,
    t,
    0,
  ] as unknown as ExpressionSpecification
}

const kali = (
  dasar: number | ExpressionSpecification,
  g: ExpressionSpecification,
  fokus: string[] = [],
) =>
  [
    '*',
    dasar,
    g,
    ['case', ['in', ['get', 'h3_index'], ['literal', fokus]], 0, 1],
  ] as unknown as ExpressionSpecification

function terapkanGelombang(
  m: MapLibreMap,
  layer: NamaLayer,
  t: number,
  fokus: string[] = [],
) {
  if (m.getLayer(L_ISI)) {
    m.setPaintProperty(L_ISI, 'fill-opacity', kali(OPASITAS_LAYER[layer], gerbang(t), fokus))
  }
}

/** Arsir & garis: sekali di awal gelombang, lalu dibiarkan memudar sendiri. */
function iringiGelombang(m: MapLibreMap, tampak: boolean, durasi: number) {
  if (m.getLayer(L_ARSIR)) {
    m.setPaintProperty(L_ARSIR, 'fill-opacity-transition', { duration: durasi, delay: 0 })
    m.setPaintProperty(L_ARSIR, 'fill-opacity', tampak ? 0.5 : 0)
  }
  if (m.getLayer(L_GARIS)) {
    m.setPaintProperty(L_GARIS, 'line-opacity-transition', { duration: durasi, delay: 0 })
    m.setPaintProperty(L_GARIS, 'line-opacity', tampak ? OPASITAS_GARIS : 0)
  }
  if (m.getLayer(L_ANGKA)) {
    m.setPaintProperty(L_ANGKA, 'text-opacity-transition', { duration: durasi, delay: 0 })
    m.setPaintProperty(L_ANGKA, 'text-opacity', tampak ? 1 : 0)
  }
}

function bubuhiUrutan(data: { features: unknown[] }) {
  type F = { geometry?: { coordinates?: number[][][] }; properties?: Record<string, unknown> }
  const fitur = data.features as F[]
  const titik = fitur.map((f) => f.geometry?.coordinates?.[0]?.[0] ?? [0, 0])
  if (!titik.length) return

  const cx = titik.reduce((a, t) => a + t[0], 0) / titik.length
  const cy = titik.reduce((a, t) => a + t[1], 0) / titik.length
  const jarak = titik.map((t) => Math.hypot(t[0] - cx, t[1] - cy))
  const maks = Math.max(...jarak) || 1

  fitur.forEach((f, i) => {
    f.properties = f.properties ?? {}
    f.properties._u = jarak[i] / maks
  })
}

/* ==========================================================================
   Pin ujung rute dan gelembung label
   ==========================================================================

   Cincin diganti PIN, dan itu membalik keputusan sebelumnya. Alasan lamanya
   ditulis begini: "pin punya ujung yang menunjuk, dan yang ditunjuknya di sini
   justru garis yang sudah ada." Itu benar untuk satu titik. Ia berhenti benar
   begitu ada DUA titik yang harus dibedakan sekilas: dua cincin berbeda warna
   di dua ujung satu garis tidak memberi tahu mana asal dan mana tujuan, dan
   orang membaca peta rute dengan mencari ujungnya lebih dulu.

   Pin sudah jadi kosakata yang tidak perlu dijelaskan: ujung runcingnya
   MENANDAI satu titik, bukan menunjuk garis. Biru untuk tempat Anda berdiri,
   merah untuk tujuan - urutan yang sama dipakai hampir setiap produk peta.

   KENAPA DIGAMBAR DI CANVAS, bukan SVG di DOM. `icon-image` MapLibre menerima
   gambar raster, dan gambar yang didaftarkan sekali dipakai untuk berapa pun
   pin di layar - satu tekstur, bukan satu simpul DOM per pin. Digambar pada
   DPR perangkat supaya tetap tajam di layar retina.

   PENTING: `setStyle` MENGHAPUS seluruh gambar terdaftar bersama layernya.
   Pendaftaran ini WAJIB dipanggil ulang tiap kali gaya basemap berganti, di
   tempat yang sama dengan penambahan layernya. Kalau tidak, yang terjadi bukan
   galat melainkan pin yang hilang diam-diam. */

/** Pin tetes-air. Lebar 26, tinggi 34 pada DPR 1. */
function gambarPin(warna: string, dpr: number): ImageData | null {
  const W = 26
  const H = 34
  const k = document.createElement('canvas')
  k.width = W * dpr
  k.height = H * dpr
  const c = k.getContext('2d')
  if (!c) return null
  c.scale(dpr, dpr)

  // Bayangan tipis di kaki pin: tanpa ini pin terlihat menempel di peta
  // alih-alih berdiri di atasnya.
  c.beginPath()
  c.ellipse(W / 2, H - 2.5, 5, 2.2, 0, 0, Math.PI * 2)
  c.fillStyle = 'rgba(0,0,0,0.28)'
  c.fill()

  // Badan: lingkaran atas yang meruncing ke bawah.
  const r = 9.5
  const cy = 11.5
  c.beginPath()
  c.arc(W / 2, cy, r, Math.PI * 0.86, Math.PI * 0.14, false)
  c.lineTo(W / 2, H - 3.5)
  c.closePath()
  c.fillStyle = warna
  c.strokeStyle = '#ffffff'
  c.lineWidth = 2.2
  c.fill()
  c.stroke()

  // Lubang putih di tengah: yang membuatnya terbaca sebagai penanda, bukan
  // sebagai tetesan berwarna.
  c.beginPath()
  c.arc(W / 2, cy, 3.4, 0, Math.PI * 2)
  c.fillStyle = '#ffffff'
  c.fill()

  return c.getImageData(0, 0, k.width, k.height)
}

function gambarGelembung(dpr: number): {
  data: ImageData
  opsi: { pixelRatio: number; stretchX: [number, number][]; stretchY: [number, number][]; content: [number, number, number, number] }
} | null {
  const W = 40
  const H = 30
  const R = 7
  const EKOR = 5
  const k = document.createElement('canvas')
  k.width = W * dpr
  k.height = H * dpr
  const c = k.getContext('2d')
  if (!c) return null
  c.scale(dpr, dpr)

  const bawah = H - EKOR
  c.beginPath()
  c.moveTo(R, 1)
  c.lineTo(W - R, 1)
  c.quadraticCurveTo(W - 1, 1, W - 1, 1 + R)
  c.lineTo(W - 1, bawah - R)
  c.quadraticCurveTo(W - 1, bawah, W - 1 - R, bawah)
  // Ekor di tengah bawah.
  c.lineTo(W / 2 + 4, bawah)
  c.lineTo(W / 2, H - 1)
  c.lineTo(W / 2 - 4, bawah)
  c.lineTo(R, bawah)
  c.quadraticCurveTo(1, bawah, 1, bawah - R)
  c.lineTo(1, 1 + R)
  c.quadraticCurveTo(1, 1, R, 1)
  c.closePath()
  c.fillStyle = '#ffffff'
  c.fill()
  c.strokeStyle = 'rgba(0,0,0,0.16)'
  c.lineWidth = 1
  c.stroke()

  return {
    data: c.getImageData(0, 0, k.width, k.height),
    opsi: {
      pixelRatio: dpr,
      // Yang boleh melar HANYA pita tengahnya - sudut membulat dan ekor tidak
      // pernah ikut teregang, dan itu justru gunanya nine-patch.
      stretchX: [[R + 2, W - R - 2]],
      stretchY: [[R + 2, bawah - R - 2]],
      content: [5, 4, W - 5, bawah - 3],
    },
  }
}

/** Warna pin. Biru = tempat Anda, merah = tujuan; urutan yang sudah baku. */
const PIN_AWAL = '#3B82F6'
const PIN_TUJUAN = '#E5484D'

function pasangGambarRute(m: MapLibreMap) {
  const dpr = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)))
  const daftar: [string, string][] = [
    ['pin-awal', PIN_AWAL],
    ['pin-tujuan', PIN_TUJUAN],
  ]
  for (const [nama, warna] of daftar) {
    if (m.hasImage(nama)) continue
    const d = gambarPin(warna, dpr)
    if (d) m.addImage(nama, d, { pixelRatio: dpr })
  }
  if (!m.hasImage('gelembung')) {
    const g = gambarGelembung(dpr)
    if (g) m.addImage('gelembung', g.data, g.opsi)
  }
}

/** Bentuk minimal satu fitur heksagon dari `/hex/layer`. */
type FiturHex = {
  geometry?: { coordinates?: number[][][] }
  properties?: Record<string, unknown> & { h3_index?: string }
}

function titikTengah(f: FiturHex): [number, number] | null {
  const cincin = f.geometry?.coordinates?.[0]
  if (!cincin?.length) return null
  let x = 0
  let y = 0
  for (const [a, b] of cincin) {
    x += a
    y += b
  }
  return [x / cincin.length, y / cincin.length]
}

export interface Kriteria {
  min_score?: number
  kuadran?: string
}

export interface AksiPetaRef {
  flyTo: (lat: number, lon: number, zoom?: number) => void
  highlight: (hexIds: string[]) => void
  filter: (kriteria: Kriteria | null) => void
  /** Dipakai tombol zoom kaca di App.tsx, pengganti NavigationControl. */
  zoomIn: () => void
  zoomOut: () => void
  /** Bingkai [barat, selatan, timur, utara]. Dipakai saat kawasan tak disaring. */
  fitBounds: (kotak: [number, number, number, number]) => void
  fokusHeksagon: (h3: string) => void
  /** Kembalikan arah & kemiringan ke utara-datar. */
  resetArah: () => void
  setPin: (daftar: { lat: number; lon: number; h3: string; label: string; sendiri: boolean }[]) => void
  /** Arah kompas & kemiringan saat ini, untuk memunculkan tombol reset. */
  arah: () => { bearing: number; pitch: number }
}

export interface KendaliPeta extends AksiPetaRef {
  setLayer: (namaLayer: NamaLayer) => void
  setGaya: (gaya: NamaGaya) => void
}

interface Props {
  kawasan: string
  layer: NamaLayer
  /** false = tidak ada layer tematik. Heksagon disembunyikan. */
  layerNyala?: boolean
  /** false = rute & kawasan jangkau TIDAK digambar sampai diminta. */
  rutaTampil?: boolean
  /** Serapat apa nama tempat basemap ditampilkan. Lihat `KERAPATAN_NAMA`. */
  namaTempat?: string
  gaya: NamaGaya
  terpilih: string | null
  saringKuadran: string | null
  dibandingkan: string[]
  blok?: BedahBlok | null
  blokTerpilih?: string | null
  /** Mengklik satu blok di peta. TIDAK mengubah heksagon terpilih. */
  onPilihBlok?: (h3Blok: string | null) => void
  onPilihHeksagon: (h3: string | null) => void
  onTaruhPin?: (h3: string, lat: number, lon: number) => void
  profilRute?: ProfilRute
  onMuat: (n: number) => void
  tampil: boolean
  onArah?: (a: { bearing: number; pitch: number }) => void
  /** Mode 3D: kamera miring dan gedung MAPID berdiri. Milik App, disimpan di peramban. */
  tigaDimensi?: boolean
  onGayaGagal?: () => void
}

/** Satu kalimat yang muncul di kartu sorot peta. */
const K_PETA = {
  id: {
    belum: 'belum berkuadran',
    layerKosong: (benda: string) => `Layer ini belum punya ${benda}`,
    layerSebagian: (a: number, b: number, benda: string) =>
      `${a} dari ${b} heksagon punya ${benda}`,
    nolDari: (b: number) =>
      `Nol dari ${b} heksagon. Heksagon yang tergambar abu semuanya karena memang belum ada yang diukur — bukan karena nilainya rendah.`,
    ubinRingkas: 'Ubin MAPID menolak',
    ubinSisa: (n: number) => `· mencoba lagi ${n}x`,
    ubinHabis: '· percobaan habis',
    ubinJudul: 'Server ubin MAPID sedang menolak',
    basemapJudul: 'Basemap gagal dimuat',
    heksJudul: 'Layer heksagon gagal dimuat',
    heksLanjut: 'Mesin data mungkin sedang bangun dari tidur. Muat ulang halaman dalam semenit.',
    tanpaSambungan: 'Mesin data tidak bisa dihubungi.',
    ubinIsi:
      'Gaya basemap-nya sendiri termuat — ia berkas statis di server ini. Yang ditolak permintaan ubinnya, di sisi MAPID.',
    ubinLanjut:
      'Gaya vektor MAPID memakai server ubin yang sama, jadi berganti ke gaya vektor lain tidak menolong. Heksagon, skor, dan seluruh analisisnya tidak terpengaruh.',
    basemapLanjut:
      'Pilih basemap lain lewat menu di kanan atas; heksagon dan skornya tidak terpengaruh.',
    satelitGagal:
      'Citra satelit tidak dapat dimuat sekarang. Basemap sebelumnya tetap dipakai.',
    cobaLagi: 'Coba muat ulang basemap',
    otomatis: (n: number) =>
      `Peta juga mencoba sendiri tiap menit, ${n} kali lagi. Pemadaman seperti ini biasanya pulih dalam belasan menit.`,
    otomatisHabis: 'Percobaan otomatis sudah habis. Tekan tombol di atas kalau ingin mencoba lagi.',
  },
  en: {
    belum: 'no zone yet',
    layerKosong: (benda: string) => `This layer has no ${benda} yet`,
    layerSebagian: (a: number, b: number, benda: string) =>
      `${a} of ${b} hexagons have ${benda}`,
    nolDari: (b: number) =>
      `Zero of ${b} hexagons. Every hexagon is drawn grey because nothing has been measured yet — not because the values are low.`,
    ubinRingkas: 'MAPID tiles refusing',
    ubinSisa: (n: number) => `· ${n} more tries`,
    ubinHabis: '· out of tries',
    ubinJudul: 'The MAPID tile server is refusing',
    basemapJudul: 'The basemap failed to load',
    heksJudul: 'The hexagon layer failed to load',
    heksLanjut: 'The data engine may be waking up. Reload the page in a minute.',
    tanpaSambungan: 'The data engine could not be reached.',
    ubinIsi:
      'The basemap style itself loaded — it is a static file on this server. What is being refused are the tile requests, on the MAPID side.',
    ubinLanjut:
      'The MAPID vector styles share the same tile server, so switching to another vector style does not help. The hexagons, the scores, and every analysis are unaffected.',
    basemapLanjut:
      'Pick another basemap from the menu at the top right; hexagons and scores are unaffected.',
    satelitGagal:
      'The satellite imagery cannot be loaded right now. The previous basemap is kept.',
    cobaLagi: 'Try reloading the basemap',
    otomatis: (n: number) =>
      `The map also retries by itself every minute, ${n} more times. Outages like this usually clear within a quarter of an hour.`,
    otomatisHabis: 'Automatic retries are used up. Press the button above to try again.',
  },
}

const PetaInteraktif = forwardRef<AksiPetaRef, Props>(function PetaInteraktif(
  {
    kawasan,
    layer,
    layerNyala = true,
    rutaTampil = false,
    namaTempat = 'normal',
    gaya,
    terpilih,
    saringKuadran,
    dibandingkan,
    blok = null,
    blokTerpilih = null,
    onPilihBlok,
    onPilihHeksagon,
    onTaruhPin,
    profilRute = 'foot-walking',
    onMuat,
    tampil,
    onArah,
    tigaDimensi = false,
    onGayaGagal,
  },
  ref,
) {
  const wadah = useRef<HTMLDivElement>(null)
  const peta = useRef<MapLibreMap | null>(null)
  const pinAktif = useRef<Map<string, { marker: Marker; el: HTMLElement; label: string }>>(new Map())
  /** Timer langkah gelombang yang sedang berjalan. Wajib dibatalkan saat
      komponen dilepas: timer yang masih hidup akan menyentuh peta yang sudah
      dibuang. */
  const rafGelombang = useRef(0)
  const selesaikanGelombang = useRef<(() => void) | null>(null)
  const layerKini = useRef(layer)
  layerKini.current = layer
  const namaZona = useNamaZona()
  const teksZona = useTeks(K_PETA)
  const { bahasa } = useBahasa()
  const nyalaKini = useRef(layerNyala)
  nyalaKini.current = layerNyala
  // Dibaca DI DALAM pemuatan gaya, yang berjalan di luar render - jadi ref,
  // bukan nilai yang tertangkap closure dan basi pada pemuatan berikutnya.
  const namaKini = useRef(namaTempat)
  namaKini.current = namaTempat
  /** Dibaca efek pemuatan heksagon, yang sengaja tidak bergantung padanya. */
  const tigaDimensiRef = useRef(tigaDimensi)
  tigaDimensiRef.current = tigaDimensi
  /** Kamera sebelum 3D dinyalakan, untuk dikembalikan saat dimatikan. */
  const kameraDatar = useRef<{ pitch: number; bearing: number; zoom: number } | null>(null)
  const fokusRef = useRef<string[]>([])
  fokusRef.current = [terpilih, ...dibandingkan].filter(Boolean) as string[]
  const dataRef = useRef<{ features: FiturHex[] } | null>(null)
  const gayaAwal = useRef(gaya)
  /** Sama alasannya dengan layerKini: efek inisialisasi hanya berjalan sekali. */
  const onArahRef = useRef(onArah)
  onArahRef.current = onArah
  const onPilihRef = useRef(onPilihHeksagon)
  onPilihRef.current = onPilihHeksagon
  // Alasan yang sama persis dengan `onPilihRef` di atas: pendengar peta
  // dipasang SEKALI di efek tanpa dependensi, jadi ia tidak boleh menangkap
  // prop yang identitasnya berganti tiap render.
  const onTaruhPinRef = useRef(onTaruhPin)
  onTaruhPinRef.current = onTaruhPin
  const terpilihRef = useRef(terpilih)
  terpilihRef.current = terpilih
  const onMuatRef = useRef(onMuat)
  onMuatRef.current = onMuat
  // Alasan yang sama dengan `onPilihRef`: pendengar blok dipasang SEKALI di
  // efek tanpa dependensi, jadi ia tidak boleh menangkap prop yang identitasnya
  // berganti tiap render.
  const onPilihBlokRef = useRef(onPilihBlok)
  onPilihBlokRef.current = onPilihBlok
  const tampilRef = useRef(tampil)
  tampilRef.current = tampil
  /** Saringan kuadran sebelumnya, untuk membedakan "pengguna menyaring" dari
      "efek ini kebetulan berjalan lagi". */
  const saringLalu = useRef<string | null>(saringKuadran)
  const [siap, setSiap] = useState(false)
  /** Naik sekali saat kunci basemap tiba terlambat; memicu efek ganti gaya. */
  const [kunciTerlambat, setKunciTerlambat] = useState(false)


  // Pilihan kerapatan nama tempat, diterapkan ulang tiap kali berubah.
  useEffect(() => {
    const m = peta.current
    if (!m || !siap) return
    terapkanNamaTempat(m, namaTempat)
  }, [namaTempat, siap])

  const [galat, setGalat] = useState<string | null>(null)
  /** Galat basemap, terpisah dari galat layer heksagon: sebabnya lain, dan
      tindak lanjutnya juga lain.
      `ubin` membedakan dua kegagalan yang menuntut tindakan berbeda: server
      ubin MAPID yang sedang menolak (tidak ada yang bisa kita lakukan), dan
      gaya yang memang salah (itu urusan kita). */
  const [galatPeta, setGalatPeta] = useState<{ pesan: string; ubin: boolean } | null>(null)
  const [cakupan, setCakupan] = useState<{
    terisi: number
    total: number
    benda: string
    bendaEn: string
  } | null>(null)

  const [sorot, setSorot] = useState<PropertiHeksagon | null>(null)
  const [simpul, setSimpul] = useState<SimpulTransit[]>([])

  useEffect(() => {
    let batal = false
    api
      .simpulTransit(kawasan)
      .then((s) => !batal && setSimpul(s))
      .catch(() => !batal && setSimpul([]))
    return () => {
      batal = true
    }
  }, [kawasan])

  // --- Inisialisasi. Sekali saja seumur komponen. ---
  useEffect(() => {
    if (!wadah.current) return
    const m = new MapLibreMap({
      container: wadah.current,
      center: KAWASAN_AWAL.pusat,
      zoom: ZOOM_AWAL,
      // SATU kait untuk gaya, TileJSON, ubin, font, dan sprite sekaligus.
      // Kuncinya dibubuhkan di sini alih-alih dituliskan ke berkas gaya,
      // supaya berkas yang di-commit tetap bersih dari kunci.
      transformRequest: (url) => ({ url: bubuhiKunciBasemap(url) }),
      // Atribusi dipasang sendiri di bawah, bukan lewat opsi ini, supaya
      // posisinya bisa dipindah ke kiri bawah.
      attributionControl: false,
    })
    m.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')
    m.addControl(
      new AttributionControl({
        compact: true,
        // Panelnya SENDIRI tidak pernah terlihat: yang tampil di layar adalah
        // tombol "!" kita dan pop-upnya (App.tsx). Kontrol ini tetap dipasang
        // supaya isinya ada di DOM - ketentuan A.3, dan `audit-prd` menjaga
        // 'MAPID Maps' tetap ada di sana. Tiga sumber pertama dibawa gaya MAPID
        // sendiri, jadi yang dikirim ke sini cuma yang belum disebut.
        customAttribution: ATRIBUSI_PETA.filter((a) => !a.dariGaya).map(
          (a) =>
            `<a href="${a.url}" target="_blank" rel="noreferrer">© ${a.nama}${
              a.lisensi ? ` (${a.lisensi})` : ''
            }</a>`,
        ),
      }),
      'bottom-left',
    )
    // Panel sumber peta SELALU mulai dalam keadaan terlipat - hanya tombol (i)
    // yang terlihat, persis seperti sebelumnya. MapLibre menambah
    // `maplibregl-compact-show` sendiri saat gaya selesai dimuat (karena
    // atribusinya lebih dari satu), jadi kelasnya dibuang lagi tiap kali gaya
    // terpasang - bukan sekali di sini. Tanpa ini panelnya menganga terus dan
    // menutupi kendali peta, dan tombolnya berhenti terlihat seperti tombol.
    const lipatAttrib = () => {
      m.getContainer()
        .querySelector('.maplibregl-ctrl-attrib')
        ?.classList.remove('maplibregl-compact-show')
    }
    lipatAttrib()
    m.on('styledata', lipatAttrib)
    m.on('load', () => setSiap(true))
    m.once('styledata', () => setSiap(true))
    // Gaya awal dipasang SESUDAH kunci basemap siap. Terbitan tanpa kunci
    // bawaan (Cloudflare Pages) memintanya ke backend; ubin yang berangkat
    // lebih dulu akan ditolak MAPID dan MapLibre tidak pernah memintanya lagi.
    let dibongkar = false
    void siapkanKunciBasemap().then(() => {
      if (dibongkar) return
      m.setStyle(urlGaya(gayaAwal.current), { transformStyle: tataGaya(gayaAwal.current) })
      if (!adaKunciBasemap()) {
        void kunciBasemapSusulan().then((tiba) => {
          if (tiba && !dibongkar) setKunciTerlambat(true)
        })
      }
    })

    const adaBlokDi = (titik: Point) =>
      m.getLayer(L_BLOK_ISI) && m.queryRenderedFeatures(titik, { layers: [L_BLOK_ISI] }).length > 0

    m.on('click', L_BLOK_ISI, (e) => {
      const h3b = (e.features?.[0]?.properties as { h3_blok?: string } | undefined)?.h3_blok
      if (!h3b || !onPilihBlokRef.current) return
      onPilihBlokRef.current(h3b)
    })

    // Simpan lokasi = TAHAN di dalam heksagon yang sudah terbuka, bukan klik
    // sekali. Versi klik-sekali membuat satu gerakan punya dua arti, dan di
    // layar sentuh ia bertabrakan dengan seret peta: tersimpan berulang, dan
    // sering meleset karena ketukan pertama sudah memindahkan petanya.
    const TAHAN_MS = 460
    let jamTahan = 0
    let asalTahan: Point | null = null
    let abaikanKlik = 0
    const batalTahan = () => {
      if (jamTahan) window.clearTimeout(jamTahan)
      jamTahan = 0
      asalTahan = null
    }
    const mulaiTahan = (e: MapLayerMouseEvent | MapLayerTouchEvent) => {
      // Sudah ada tahanan berjalan: satu sentuhan bisa sampai ke sini DUA kali
      // (touchstart-nya sendiri, lalu mousedown yang disintesis peramban), dan
      // dua pewaktu untuk satu gerakan = tersimpan dua kali.
      if (jamTahan) return
      const p = e.features?.[0]?.properties as PropertiHeksagon | undefined
      if (!onTaruhPinRef.current || !p?.h3_index) return
      if (p.h3_index !== terpilihRef.current || adaBlokDi(e.point)) return
      asalTahan = e.point
      const h3 = p.h3_index
      const { lat, lng } = e.lngLat
      jamTahan = window.setTimeout(() => {
        jamTahan = 0
        if (!asalTahan) return
        asalTahan = null
        abaikanKlik = Date.now()
        onTaruhPinRef.current?.(h3, lat, lng)
      }, TAHAN_MS)
    }
    // Jari yang bergeser sedikit pun membatalkan: yang menahan sambil menyeret
    // peta sedang menggeser peta, bukan menandai tempat. Pergerakan inilah
    // SATU-SATUNYA pembatalnya - `movestart` dan `dragstart` TIDAK dipakai,
    // karena di layar sentuh keduanya menyala begitu jari menyentuh layar,
    // sebelum tahanannya sempat berjalan (terukur: tahan 750 ms tidak pernah
    // tersimpan sama sekali).
    const jagaTahan = (e: { point: Point }) => {
      if (asalTahan && Math.hypot(e.point.x - asalTahan.x, e.point.y - asalTahan.y) > 9) {
        batalTahan()
      }
    }
    m.on('mousedown', L_ISI, mulaiTahan)
    m.on('touchstart', L_ISI, mulaiTahan)
    m.on('mouseup', () => batalTahan())
    m.on('touchend', () => batalTahan())
    m.on('touchcancel', () => batalTahan())
    m.on('mousemove', jagaTahan)
    m.on('touchmove', jagaTahan)

    m.on('click', L_ISI, (e) => {
      if (adaBlokDi(e.point)) return
      // Klik yang menyusul tahanan yang sudah tersimpan jangan memilih ulang -
      // apalagi menerbangkan peta ke heksagon yang sama. Berbatas waktu: kalau
      // ternyata tidak ada klik yang menyusul, jangan sampai klik berikutnya
      // yang sungguhan ikut dimakan.
      if (abaikanKlik && Date.now() - abaikanKlik < 900) {
        abaikanKlik = 0
        return
      }
      const p = e.features?.[0]?.properties as PropertiHeksagon | undefined
      onPilihRef.current(p?.h3_index ?? null)
    })
    m.on('mousemove', L_ISI, (e) => {
      const p = e.features?.[0]?.properties as PropertiHeksagon | undefined
      setSorot(p ?? null)
      // Kursor bidik di heksagon yang terbuka: satu-satunya petunjuk bahwa
      // TAHAN di sini menaruh titik, bukan memilih.
      m.getCanvas().style.cursor =
        p?.h3_index && p.h3_index === terpilihRef.current && onTaruhPinRef.current && !adaBlokDi(e.point)
          ? 'crosshair'
          : 'pointer'
      if (p && m.getLayer(L_SOROT)) {
        m.setFilter(L_SOROT, ['in', ['get', 'h3_index'], ['literal', [p.h3_index]]])
      }
    })
    m.on('mouseleave', L_ISI, () => {
      setSorot(null)
      m.getCanvas().style.cursor = ''
      if (m.getLayer(L_SOROT)) {
        m.setFilter(L_SOROT, ['in', ['get', 'h3_index'], ['literal', []]])
      }
    })

    m.setMissingStyleImageResolver((id) => {
      if (!m.hasImage(id)) {
        m.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) })
      }
    })

    m.on('error', (e) => {
      const pesan = (e as unknown as { error?: Error }).error?.message
      if (!pesan) return
      // URL-nya ada di dua tempat tergantung versi MapLibre: properti `url`
      // milik AJAXError, dan di dalam pesannya sendiri. Dibaca dari keduanya.
      const url = (e as unknown as { error?: { url?: string } }).error?.url ?? ''
      const keUbin = /basemap\.mapid\.io\/data\//.test(url) || /basemap\.mapid\.io\/data\//.test(pesan)

      if (/non-existing layer|does not exist in the map's style/i.test(pesan)) {
        console.warn('[basemap] penataan layer mendahului pemasangannya:', pesan)
        return
      }

      if (/\/sprites?[./@]/i.test(url || pesan)) {
        console.warn('[basemap] lembar ikon gaya MAPID tidak terambil:', pesan)
        return
      }

      if (/api\.(maptiler|mapbox)\.com/.test(url || pesan)) {
        console.warn('[basemap] citra satelit ditolak penyedianya:', pesan)
        setGalatPeta((g) => g ?? { pesan, ubin: false })
        return
      }

      if (keUbin) {
        console.warn('[basemap] permintaan ubin ditolak:', pesan, url || '(url tidak disebutkan)')
        return
      }
      if (!m.isStyleLoaded()) {
        console.warn('[basemap] gaya gagal dimuat:', pesan)
        setGalatPeta({ pesan, ubin: false })
      }
    })

    // `rotate` dan `pitch` menyala tiap bingkai selama diseret; itu tidak apa-apa
    // karena yang dikirim cuma dua angka dan App membandingkannya sebelum
    // menyetel state.
    const laporArah = () => onArahRef.current?.({ bearing: m.getBearing(), pitch: m.getPitch() })
    m.on('rotate', laporArah)
    m.on('pitch', laporArah)

    peta.current = m
    return () => {
      dibongkar = true
      clearTimeout(rafGelombang.current)
      m.remove()
      peta.current = null
    }
  }, [])

  useEffect(() => {
    setCakupan(
      cakupanLayer(
        layer,
        dataRef.current?.features as unknown as
          | { properties?: Record<string, unknown> | null }[]
          | null,
      ),
    )
  }, [layer])

  // --- Ganti gaya basemap ---
  // setStyle membuang seluruh sumber & layer, jadi `siap` direset supaya efek
  // pemuatan heksagon di bawah berjalan ulang setelah gaya baru selesai dimuat.
  useEffect(() => {
    const m = peta.current
    if (!m || !siap) return
    const pasang = (berkas: string | object) => {
      setSiap(false)
      setGalatPeta(null)
      m.once('styledata', () => setSiap(true))
      m.setStyle(berkas as string, { diff: false, transformStyle: tataGaya(gaya) })
    }
    if (!GAYA_BASEMAP[gaya]?.langsung) {
      pasang(urlGaya(gaya))
      return
    }
    const ambilGaya = async () => {
      let galatTerakhir: unknown = new Error('gaya satelit tidak terambil')
      for (let i = 0; i < 2; i++) {
        const batas = new AbortController()
        const jam = window.setTimeout(() => batas.abort(), 12000)
        try {
          const r = await fetch(bubuhiKunciBasemap(urlGaya(gaya)), { signal: batas.signal })
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return await r.json()
        } catch (e) {
          galatTerakhir = e
        } finally {
          window.clearTimeout(jam)
        }
      }
      throw galatTerakhir
    }
    let batal = false
    ambilGaya()
      .then((json) => {
        if (batal) return
        pasang(json)
      })
      .catch((e: unknown) => {
        if (batal) return
        // Gaya lama dipertahankan - peta tidak mendadak kosong - DAN pilihannya
        // dikembalikan, supaya pemilih basemap tidak menulis "Satelit" di atas
        // peta vektor. Pita kecilnya menjelaskan kenapa.
        console.warn('[basemap] gaya satelit tidak terambil; gaya sebelumnya dipertahankan', e)
        setGalatPeta((g) => g ?? { pesan: teksZona.satelitGagal, ubin: false })
        onGayaGagal?.()
      })
    return () => {
      batal = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gaya, kunciTerlambat])

  const tigaSebelum = useRef(tigaDimensi)
  useEffect(() => {
    const m = peta.current
    if (!m || !siap) return
    aturGedung3D(m, gaya, tigaDimensi)
    if (tigaSebelum.current === tigaDimensi) return
    tigaSebelum.current = tigaDimensi
    const diam = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (tigaDimensi) {
      // Kamera SEBELUM dimiringkan disimpan, supaya mematikan 3D benar-benar
      // mengembalikan tampilan yang tadi - bukan sekadar meratakannya ke utara
      // dan meninggalkan zoom yang terlanjur didekatkan.
      kameraDatar.current = {
        pitch: m.getPitch(),
        bearing: m.getBearing(),
        zoom: m.getZoom(),
      }
      m.easeTo({
        pitch: 58,
        bearing: -18,
        // Gedung baru terlihat mulai zoom 14; di bawahnya "3D" cuma peta miring.
        zoom: Math.max(m.getZoom(), 15.2),
        duration: diam ? 0 : 900,
      })
    } else {
      const k = kameraDatar.current
      m.easeTo({
        pitch: 0,
        bearing: 0,
        // Zoom dikembalikan HANYA kalau 3D yang mendekatkannya. Kalau orangnya
        // sendiri yang memperbesar selagi 3D menyala, mengembalikannya akan
        // membuang pekerjaannya.
        ...(k && m.getZoom() > k.zoom + 0.01 && m.getZoom() <= 15.3 ? { zoom: k.zoom } : {}),
        duration: diam ? 0 : 700,
      })
      kameraDatar.current = null
    }
  }, [tigaDimensi, siap, gaya])

  const jalankanGelombang = useCallback(
    (dari: number, ke: number, durasi: number) =>
      new Promise<void>((selesai) => {
        const m = peta.current
        if (!m) return selesai()

        clearTimeout(rafGelombang.current)
        selesaikanGelombang.current?.()
        selesaikanGelombang.current = selesai

        const tuntas = () => {
          selesaikanGelombang.current = null
          selesai()
        }

        // Arsir dan garis mengikuti arah gelombangnya, sekali saja. `ke` yang
        // lebih besar dari `dari` berarti masuk; sebaliknya berarti surut.
        iringiGelombang(m, ke > dari, Math.round(durasi * 0.8))

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          terapkanGelombang(m, layerKini.current, ke, fokusRef.current)
          return tuntas()
        }
        const LANGKAH = 8
        const jeda = durasi / LANGKAH
        m.setPaintProperty(L_ISI, 'fill-opacity-transition', { duration: jeda, delay: 0 })

        const t0 = performance.now()
        const maju = () => {
          if (!peta.current) return tuntas()
          const p = Math.min(1, (performance.now() - t0) / durasi)
          // Melambat di ujung. Gelombang berkecepatan tetap terbaca sebagai
          // penggaris yang bergeser, bukan sebagai sesuatu yang mendarat.
          const e = 1 - Math.pow(1 - p, 3)
          terapkanGelombang(peta.current, layerKini.current, dari + (ke - dari) * e, fokusRef.current)
          if (p < 1) rafGelombang.current = window.setTimeout(maju, jeda)
          else tuntas()
        }
        terapkanGelombang(m, layerKini.current, dari, fokusRef.current)
        rafGelombang.current = window.setTimeout(maju, jeda)
      }),
    [],
  )

  const nyalaSebelum = useRef(layerNyala)
  useEffect(() => {
    const m = peta.current
    if (!m || !siap) return
    const pasangTampak = (v: 'visible' | 'none') => {
      for (const id of [L_ISI, L_ARSIR, L_GARIS, L_ANGKA, L_SOROT]) {
        if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', v)
      }
    }
    const sebelum = nyalaSebelum.current
    nyalaSebelum.current = layerNyala
    if (layerNyala) {
      terapkanGelombang(m, layerKini.current, 0, fokusRef.current)
      pasangTampak('visible')
      void jalankanGelombang(0, T_PENUH, 1050)
    } else if (sebelum) {
      void jalankanGelombang(T_PENUH, 0, 600).then(() => {
        if (!nyalaKini.current && peta.current) pasangTampak('none')
      })
    } else {
      pasangTampak('none')
    }
  }, [layerNyala, siap, jalankanGelombang])

  // --- Muat heksagon ---
  useEffect(() => {
    const m = peta.current
    if (!m || !siap) return
    let batal = false

    api
      .layerHeksagon({ kawasan })
      .then(async (data) => {
        if (batal || !peta.current) return
        setGalat(null)
        const fitur = (data.features as unknown[]) ?? []
        onMuatRef.current(fitur.length)
        bubuhiUrutan(data as { features: unknown[] })
        dataRef.current = data as unknown as { features: FiturHex[] }
        setCakupan(cakupanLayer(layerKini.current, fitur as { properties?: Record<string, unknown> | null }[]))

        const sumber = m.getSource(SUMBER)
        if (sumber) {
          // Kawasan berganti: heksagon lama surut dulu ke tepi, baru yang baru
          // mekar. Tanpa jeda ini, satu kawasan berubah jadi kawasan lain dalam
          // satu bingkai dan mata kehilangan jejak apa yang barusan diganti.
          if (tampilRef.current) await jalankanGelombang(T_PENUH, 0, DURASI_KELUAR)
          if (batal || !peta.current) return
          ;(sumber as GeoJSONSource).setData(data as never)
          if (tampilRef.current) await jalankanGelombang(0, T_PENUH, DURASI_MASUK)
          else terapkanGelombang(m, layerKini.current, T_PENUH, fokusRef.current)
          return
        }

        if (!m.hasImage(POLA)) {
          m.addImage(POLA, buatPolaArsir(), { pixelRatio: 2 })
        }
        m.addSource(SUMBER, { type: 'geojson', data: data as never })

        siapkanBasemap(m, gaya, namaKini.current)

        const labelPertama = idLabelPertama(m)

        m.addLayer(
          {
            id: L_ISI,
            type: 'fill',
            source: SUMBER,
            layout: { visibility: nyalaKini.current ? 'visible' : 'none' },
            paint: {
              'fill-color': WARNA_LAYER[layerKini.current],
              // Lahir tak terlihat; jalankanGelombang di bawah yang memunculkan.
              'fill-opacity': kali(OPASITAS_LAYER[layer], gerbang(0), fokusRef.current),
            },
          },
          labelPertama,
        )

        // Arsir ketidakpastian: satu layer di atas isian, berlaku untuk kelima
        // layer tematik. Warnanya tidak perlu ikut berubah - yang disampaikannya
        // bukan nilai, melainkan bahwa nilainya belum terukur.
        m.addLayer(
          {
            id: L_ARSIR,
            type: 'fill',
            source: SUMBER,
            layout: { visibility: nyalaKini.current ? 'visible' : 'none' },
            filter: ['==', ['get', 'data_source'], 'predicted'],
            paint: { 'fill-pattern': POLA, 'fill-opacity': kali(0.5, gerbang(0)) },
          },
          labelPertama,
        )

        // Garis batas cukup gelap untuk memisahkan heksagon sewarna. Garis putih
        // tipis hilang begitu dua heksagon bersebelahan berwarna sama, dan
        // keduanya melebur jadi satu gumpalan yang tidak bisa diklik dengan yakin.
        m.addLayer(
          {
            id: L_GARIS,
            type: 'line',
            source: SUMBER,
            layout: { visibility: nyalaKini.current ? 'visible' : 'none' },
            paint: {
              'line-color': GARIS_HEX(gaya),
              'line-width': TEBAL_GARIS,
              'line-opacity': kali(OPASITAS_GARIS, gerbang(0)),
            },
          },
          labelPertama,
        )

        const teks = TEKS_HEX(gaya)
        m.addLayer(
          {
            id: L_ANGKA,
          type: 'symbol',
          source: SUMBER,
          minzoom: 12,
          layout: {
            visibility: nyalaKini.current ? 'visible' : 'none',
            'text-field': ANGKA_LAYER[layerKini.current],
            'text-font': FONT_ANGKA,
            'text-size': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, 10, 15, 13, 17, 15],
            'text-allow-overlap': false,
            'text-ignore-placement': false,
            'text-padding': 2,
          },
          paint: {
            'text-color': teks.warna,
            'text-halo-color': teks.halo,
            'text-halo-width': 1.4,
            'text-opacity': 0,
          },
        },
        labelPertama,
      )

        m.addLayer({
          id: L_SOROT,
          type: 'line',
          source: SUMBER,
          layout: { visibility: nyalaKini.current ? 'visible' : 'none' },
          paint: { 'line-color': GARIS_HEX(gaya), 'line-width': 1.5 },
          filter: ['in', ['get', 'h3_index'], ['literal', []]],
        })

        // Bingkai mode fokus. Tebal, karena ia satu-satunya yang menandai
        // heksagon terpilih sekarang - isiannya sengaja dihilangkan supaya
        // jalan dan bangunan di bawahnya terlihat utuh.
        m.addLayer({
          id: L_PILIH,
          type: 'line',
          source: SUMBER,
          paint: {
            'line-color': GARIS_HEX(gaya),
            'line-width': 3.4,
            'line-opacity': 0.95,
          },
          filter: ['in', ['get', 'h3_index'], ['literal', []]],
        })

        m.addSource(SUMBER_BLOK, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] } as never,
        })
        m.addLayer({
          id: L_BLOK_ISI,
          type: 'fill',
          source: SUMBER_BLOK,
          paint: { 'fill-color': WARNA_BLOK, 'fill-opacity': 0.62 },
        })
        m.addLayer({
          id: L_BLOK_GARIS,
          type: 'line',
          source: SUMBER_BLOK,
          paint: { 'line-color': WARNA_GARIS_BLOK(gaya), 'line-width': 1 },
        })
        // Blok yang disorot. Filter kosong = tidak ada yang disorot; itu
        // keadaan bawaannya, dan `setFilter` di efek bawah yang mengisinya.
        m.addLayer({
          id: L_BLOK_PILIH,
          type: 'line',
          source: SUMBER_BLOK,
          paint: { 'line-color': GARIS_HEX(gaya), 'line-width': 2.8, 'line-opacity': 0.95 },
          filter: ['in', ['get', 'h3_blok'], ['literal', []]],
        })
        m.addLayer({
          id: L_BLOK_ANGKA,
          type: 'symbol',
          source: SUMBER_BLOK,
          layout: {
            'text-field': ['get', 'peringkat'],
            'text-font': FONT_ANGKA,
            'text-size': 12,
            'text-allow-overlap': true,
          },
          paint: {
            'text-color': TEKS_HEX(gaya).warna,
            'text-halo-color': TEKS_HEX(gaya).halo,
            'text-halo-width': 1.3,
          },
        })

        const fokus = WARNA_FOKUS(gaya)
        m.addSource(SUMBER_FOKUS, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] } as never,
        })

        m.addSource(SUMBER_ISO, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] } as never,
        })
        m.addLayer({
          id: L_ISO_ISI,
          type: 'fill',
          source: SUMBER_ISO,
          paint: {
            'fill-color': [
              'interpolate', ['linear'], ['get', 'menit'],
              5, '#f2b705',
              10, '#f07818',
              15, '#dc3f6a',
              30, '#8b3bb8',
              60, '#3b41b8',
            ],
            'fill-opacity': [
              'interpolate', ['linear'], ['get', 'menit'],
              5, 0.05,
              10, 0.035,
              15, 0.022,
              30, 0.012,
              60, 0.008,
            ],
          },
        })
        // Garis bayang di BAWAH garis isochrone. Tanpa ini, tepi pita hilang
        // begitu ia kebetulan melintasi heksagon berwarna senada - dan yang
        // hilang justru satu-satunya hal yang membuat pita punya bentuk.
        m.addLayer({
          id: `${L_ISO_GARIS}-bayang`,
          type: 'line',
          source: SUMBER_ISO,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': WARNA_RUTE_BAYANG(gaya),
            // Ditipiskan dari 5,5/3,6/2,8 dan 0,55. Garis bayang ada supaya tepi
            // pita tidak hilang di atas heksagon senada - itu tetap perlu -
            // tetapi setebal itu ia sendiri yang menghapus jalan di bawahnya.
            'line-width': [
              'interpolate', ['linear'], ['get', 'menit'],
              5, 3, 15, 2.2, 60, 1.8,
            ],
            'line-opacity': 0.34,
          },
        })
        m.addLayer({
          id: L_ISO_GARIS,
          type: 'line',
          source: SUMBER_ISO,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': [
              'interpolate', ['linear'], ['get', 'menit'],
              5, '#f2b705',
              10, '#f07818',
              15, '#dc3f6a',
              30, '#8b3bb8',
              60, '#3b41b8',
            ],
            // Makin lama pitanya, makin tipis garisnya - urutan yang sama
            // dengan urutan pentingnya bagi orang yang mencari lokasi.
            'line-width': [
              'interpolate', ['linear'], ['get', 'menit'],
              5, 3.2, 15, 1.9, 60, 1.4,
            ],
            'line-opacity': 0.62,
            // Pita TERDALAM utuh, sisanya putus-putus. Bentuknya ikut membawa
            // arti: yang utuh batas yang paling layak dipercaya sekaligus yang
            // paling sering dipakai orang.
            'line-dasharray': ['case', ['==', ['get', 'menit'], 5], ['literal', [1, 0]], ['literal', [2.6, 1.8]]],
          },
        })
        m.addLayer({
          id: L_ISO_TEKS,
          type: 'symbol',
          source: SUMBER_ISO,
          layout: {
            'symbol-placement': 'line',
            'symbol-spacing': 1100,
            // "5 menit jalan kaki", bukan "5 menit jalan". Dua kata lebih
            // panjang, dan menghapus satu-satunya pertanyaan yang tersisa.
            'text-field': ['concat', ['to-string', ['get', 'menit']], ' menit jalan kaki'],
            'text-font': FONT_ANGKA,
            'text-size': ['case', ['==', ['get', 'menit'], 5], 12.5, 11.5],
            'text-offset': [0, -1],
            'text-allow-overlap': false,
            'text-ignore-placement': false,
          },
          paint: {
            'text-color': WARNA_ISO(gaya),
            'text-halo-color': WARNA_RUTE_BAYANG(gaya),
            'text-halo-width': 2.6,
            'text-halo-blur': 0.4,
          },
        })

        m.addSource(SUMBER_RUTE, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] } as never,
        })
        // Sumber titik kecil untuk aliran rute yang terus berjalan. Titiknya
        // digerakkan efek rute sesudah garisnya selesai tumbuh.
        m.addSource(SUMBER_ALIR, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] } as never,
        })

        m.addLayer({
          id: L_RUTE_BAYANG,
          type: 'line',
          source: SUMBER_RUTE,
          filter: ['get', 'utama'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': WARNA_RUTE_BAYANG(gaya),
            'line-width': [
              'interpolate', ['linear'], ['zoom'],
              11, 6.8,
              15, 10,
              18, 12.8,
            ],
            'line-opacity': 0.9,
            // Sepeda: kapsul yang sama dengan garis utamanya, dibagi 1,35 -
            // alasan yang persis sama dengan titik jalan kaki di atas.
            'line-dasharray': [
              'case',
              ['==', ['get', 'profil'], 'driving-car'],
              ['literal', [1, 0]],
              ['==', ['get', 'profil'], 'cycling-regular'],
              ['literal', [1.04, 1.78]],
              ['literal', [0, 1.63]],
            ],
          },
        })
        m.addLayer({
          id: L_RUTE_ALT,
          type: 'line',
          source: SUMBER_RUTE,
          filter: ['!', ['get', 'utama']],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': WARNA_RUTE_ALT(gaya),
            'line-width': 1.8,
            'line-opacity': 0.5,
            'line-dasharray': [1, 0],
          },
        })
        m.addLayer({
          id: L_RUTE,
          type: 'line',
          source: SUMBER_RUTE,
          filter: ['get', 'utama'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ['get', 'warna'],
            'line-width': [
              'interpolate', ['linear'], ['zoom'],
              11, ['case', ['==', ['get', 'profil'], 'driving-car'], 5, 5],
              15, ['case', ['==', ['get', 'profil'], 'driving-car'], 7.4, 7.4],
              18, ['case', ['==', ['get', 'profil'], 'driving-car'], 9.5, 9.5],
            ],
            'line-dasharray': [
              'case',
              ['==', ['get', 'profil'], 'driving-car'],
              ['literal', [1, 0]],
              ['==', ['get', 'profil'], 'cycling-regular'],
              ['literal', [1.4, 2.4]],
              ['literal', [0, 2.2]],
            ],
          },
        })


        m.addLayer({
          id: L_RUTE_KEPALA,
          type: 'circle',
          source: SUMBER_RUTE,
          filter: ['==', ['get', 'jenis'], 'kepala'],
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4.5, 16, 7],
            'circle-color': '#ffffff',
            'circle-stroke-color': ['get', 'warna'],
            'circle-stroke-width': 3,
            'circle-blur': 0.15,
          },
        })

        // Aliran yang berjalan MENUJU lokasi. Digambar di atas kepala animasi
        // dan di bawah pin, jadi ia menempel pada garisnya tanpa menutup
        // penanda asal/tujuan.
        m.addLayer({
          id: L_ALIR,
          type: 'circle',
          source: SUMBER_ALIR,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3.2, 16, 5.4, 18, 6.4],
            'circle-color': ['get', 'warna'],
            'circle-stroke-color': 'rgba(255,255,255,0.92)',
            'circle-stroke-width': 1.6,
            'circle-blur': 0.1,
          },
        })

        pasangGambarRute(m)

        m.addLayer({
          id: L_UJUNG,
          type: 'symbol',
          source: SUMBER_RUTE,
          // Menurut JENIS, bukan menurut tipe geometri: sejak label rute ikut
          // jadi titik, saringan "semua titik" akan menggambar pin di tengah
          // rute juga.
          filter: ['==', ['get', 'jenis'], 'pin'],
          layout: {
            'icon-image': ['case', ['get', 'tujuan'], 'pin-tujuan', 'pin-awal'],
            // Jangkar BAWAH: ujung runcing pin yang menandai titiknya, bukan
            // tengahnya. Dengan jangkar tengah, pin tampak melayang setengah
            // badan di atas tempat yang ditandainya.
            'icon-anchor': 'bottom',
            'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.72, 15, 0.95, 18, 1.1],
            // Pin TIDAK BOLEH hilang berebut ruang dengan nama tempat: ia
            // satu-satunya penanda asal dan tujuan di layar.
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            // Tujuan digambar di ATAS asal saat keduanya berdekatan.
            'symbol-sort-key': ['case', ['get', 'tujuan'], 0, 1],
          },
        })

        m.addLayer({
          id: L_RUTE_TEKS,
          type: 'symbol',
          source: SUMBER_RUTE,
          filter: ['==', ['get', 'jenis'], 'label'],
          layout: {
            // Yang utama ditempatkan lebih dulu saat berebut ruang. Tanpa ini
            // label alternatif bisa menang dan yang tercepat justru tak berlabel.
            'symbol-sort-key': ['case', ['get', 'utama'], 0, 1],
            'text-field': ['get', 'label'],
            'text-font': FONT_ANGKA,
            'text-size': ['case', ['get', 'utama'], 12.5, 11],
            // Gelembung: latar putih yang MELAR mengikuti panjang teksnya, dengan
            // ekor kecil yang menyatakan garis mana yang sedang dibicarakan.
            // Label bergaris-halo saja terbaca, tetapi ia melayang tanpa pijakan.
            'icon-image': 'gelembung',
            'icon-text-fit': 'both',
            'icon-text-fit-padding': [3, 7, 6, 7],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            // Ekor gelembung mendarat TEPAT di titik tengah rutenya. Dengan
            // jangkar tengah, gelembung menutupi ruas yang sedang dibicarakannya.
            'text-anchor': 'bottom',
            'icon-anchor': 'bottom',
            'text-allow-overlap': true,
          },
          paint: {
            'text-color': ['get', 'warna'],
            'text-halo-color': WARNA_RUTE_BAYANG(gaya),
            'text-halo-width': 2,
          },
        })

        m.addLayer({
          id: L_NOMOR,
          type: 'circle',
          source: SUMBER_FOKUS,
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-radius': 13,
            'circle-color': fokus.isi,
            'circle-stroke-width': 2.5,
            'circle-stroke-color': fokus.teks,
          },
        })
        m.addLayer({
          id: L_NOMOR_TEKS,
          type: 'symbol',
          source: SUMBER_FOKUS,
          filter: ['==', ['geometry-type'], 'Point'],
          layout: {
            'text-field': ['get', 'nomor'],
            'text-font': FONT_ANGKA,
            'text-size': 14,
            'text-allow-overlap': true,
            'text-ignore-placement': true,
          },
          paint: { 'text-color': fokus.teks },
        })

        // Penangan klik/sorot TIDAK dipasang di sini lagi - lihat efek
        // inisialisasi. Yang tersisa di sini hanya urutan gedung 3D, yang
        // memang harus disusun ulang tiap kali layer heksagon lahir kembali.
        aturGedung3D(m, gaya, tigaDimensiRef.current)

        if (tampilRef.current) {
          await tungguTenang(m)
          if (!batal && peta.current) void jalankanGelombang(0, T_PENUH, DURASI_MASUK)
        } else {
          terapkanGelombang(m, layerKini.current, T_PENUH, fokusRef.current)
        }
      })
      .catch((e: Error) => !batal && setGalat(e.message))

    return () => {
      batal = true
    }
    // `layer` SENGAJA tidak ada di sini. Warna awal dibaca lewat layerKini, dan
    // pergantian layer diurus efeknya sendiri di bawah - memasukkannya ke sini
    // berarti seluruh data diminta ulang hanya karena warnanya berganti.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `onPilihHeksagon` dan `onMuat` SENGAJA tidak ada di sini - keduanya dibaca
    // lewat ref. Memasukkannya berarti seluruh data diminta ulang, seluruh layer
    // dipasang ulang, dan satu penangan klik lagi menumpuk setiap kali identitas
    // callback-nya berubah.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kawasan, siap, gaya, jalankanGelombang])

  // Pembuka menyingkir: inilah saat gelombang pertama benar-benar ditonton.
  useEffect(() => {
    const m = peta.current
    if (!tampil || !m?.getLayer(L_ISI)) return
    void tungguTenang(m).then(() => {
      if (peta.current?.getLayer(L_ISI)) void jalankanGelombang(0, T_PENUH, DURASI_MASUK)
    })
    // Sengaja hanya bergantung pada `tampil`: efek ini adalah "pembuka baru
    // saja hilang", bukan "sesuatu berubah". Menambah dep lain membuatnya
    // memutar ulang gelombang di saat yang tidak diminta siapa pun.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tampil])

  const layerSebelum = useRef(layer)
  useEffect(() => {
    const m = peta.current
    if (!m?.getLayer(L_ISI)) return
    const ganti = () => {
      if (!peta.current?.getLayer(L_ISI)) return
      peta.current.setPaintProperty(L_ISI, 'fill-color', WARNA_LAYER[layer])
      // Angkanya ikut berganti arti: skor di layer kuadran, harga di PriceLens,
      // tanda izin di ZoneGuard.
      if (peta.current.getLayer(L_ANGKA)) {
        peta.current.setLayoutProperty(L_ANGKA, 'text-field', ANGKA_LAYER[layer])
      }
    }
    const berganti = layerSebelum.current !== layer
    layerSebelum.current = layer
    if (!berganti || !nyalaKini.current) {
      ganti()
      return
    }
    let batal = false
    void jalankanGelombang(T_PENUH, 0, 400).then(() => {
      if (batal) return
      ganti()
      void jalankanGelombang(0, T_PENUH, 820)
    })
    return () => {
      batal = true
    }
  }, [layer, siap, jalankanGelombang])

  useEffect(() => {
    const m = peta.current
    if (!m?.getLayer(L_ISI)) return

    const pasangSaringan = () => {
      const f = saringKuadran
        ? (['==', ['get', 'kuadran'], saringKuadran] as ExpressionSpecification)
        : null
      // Diperiksa ULANG di sini, bukan cuma di kepala efeknya: `pasangSaringan`
      // juga dipanggil dari `styledata`, dan di antara pemeriksaan pertama dan
      // pemanggilan itu gaya basemap bisa sudah dibongkar.
      if (!m.getLayer(L_ISI)) return
      m.setFilter(L_ISI, f)
      if (m.getLayer(L_GARIS)) m.setFilter(L_GARIS, f)
      // Angka WAJIB ikut tersaring. Tanpa baris ini, heksagon yang disembunyikan
      // filter kuadran meninggalkan angkanya melayang di atas peta kosong.
      if (m.getLayer(L_ANGKA)) m.setFilter(L_ANGKA, f)
      if (m.getLayer(L_ARSIR)) {
        m.setFilter(
          L_ARSIR,
          saringKuadran
            ? ([
                'all',
                ['==', ['get', 'data_source'], 'predicted'],
                ['==', ['get', 'kuadran'], saringKuadran],
              ] as ExpressionSpecification)
            : (['==', ['get', 'data_source'], 'predicted'] as ExpressionSpecification),
        )
      }
    }

    // Efek ini juga berjalan saat gaya dimuat ulang, dengan saringan yang sama
    // persis. Menganimasikannya di situ berarti heksagon berkedip tanpa sebab.
    const berubah = saringLalu.current !== saringKuadran
    saringLalu.current = saringKuadran
    if (!berubah || !tampil) {
      pasangSaringan()
      return
    }

    let batal = false
    const jalan = async () => {
      await jalankanGelombang(T_PENUH, 0, 280)
      if (batal || !peta.current) return
      pasangSaringan()
      await jalankanGelombang(0, T_PENUH, 720)
    }
    void jalan()
    return () => {
      batal = true
    }
  }, [saringKuadran, siap, tampil, jalankanGelombang])

  const [konteks, setKonteks] = useState<Map<string, KonteksSimpul>>(new Map())
  const dimintaRef = useRef(new Set<string>())
  /** Profil yang diminta. Namanya sisa masa ketika moda "Motor" menumpang
   *  jalur mobil; sejak sepeda menggantikannya, tiap moda persis satu profil. */
  const profilNyata = profilRute
  const kunciKt = useCallback((h: string) => `${profilNyata}|${h}`, [profilNyata])
  const hidupRef = useRef(true)
  useEffect(() => {
    hidupRef.current = true
    return () => {
      hidupRef.current = false
    }
  }, [])

  const kunciBanding = dibandingkan.join(',')
  const perluRute = useMemo(() => {
    // Heksagon yang DIBANDINGKAN selalu dirutekan: membandingkan itu tindakan
    // yang sudah eksplisit, dan garisnya bagian dari jawabannya.
    const d = [...dibandingkan]
    // Yang DIPILIH hanya dirutekan kalau diminta. Mengklik satu heksagon
    // seharusnya membuka keterangannya, bukan langsung menimpa peta dengan
    // rute dan pita jangkauan yang belum tentu sedang dicari orangnya.
    if (rutaTampil && terpilih && !d.includes(terpilih)) d.push(terpilih)
    return d
  }, [terpilih, kunciBanding, rutaTampil]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const belum = perluRute.filter((h) => !dimintaRef.current.has(kunciKt(h)))
    if (!belum.length) return
    belum.forEach((h) => dimintaRef.current.add(kunciKt(h)))
    Promise.all(
      belum.map((h) =>
        api
          .simpulTerdekat(h, profilNyata)
          .then((k) => [kunciKt(h), k] as const)
          .catch(() => {
            // Gagal sekali tidak boleh jadi gagal selamanya: heksagonnya
            // dilepas dari daftar "sudah diminta" supaya percobaan berikutnya
            // benar-benar mencoba lagi.
            dimintaRef.current.delete(kunciKt(h))
            return null
          }),
      ),
    ).then((hasil) => {
      if (!hidupRef.current) return
      const ada = hasil.filter(Boolean) as (readonly [string, KonteksSimpul])[]
      if (ada.length) setKonteks((m) => new Map([...m, ...ada]))
    })
  }, [perluRute, profilNyata, kunciKt])

  useEffect(() => {
    const m = peta.current
    if (!m?.getLayer(L_PILIH)) return
    const fokus = fokusRef.current

    m.setFilter(L_PILIH, ['in', ['get', 'h3_index'], ['literal', fokus]])
    if (m.getLayer(L_ISI)) {
      m.setPaintProperty(
        L_ISI,
        'fill-opacity',
        kali(OPASITAS_LAYER[layer], gerbang(T_PENUH), fokus),
      )
    }
    // Arsir ikut dimatikan. Kalau tidak, heksagon fokus masih tertutup garis
    // miring dan "mode fokus" berhenti memperlihatkan apa pun.
    if (m.getLayer(L_ARSIR)) {
      m.setPaintProperty(L_ARSIR, 'fill-opacity', kali(0.5, gerbang(T_PENUH), fokus))
    }

    const sumber = m.getSource(SUMBER_FOKUS) as GeoJSONSource | undefined
    if (!sumber) return

    const menurutH3 = new Map(
      (dataRef.current?.features ?? []).map((f) => [String(f.properties?.h3_index), f]),
    )
    const fitur: unknown[] = []

    // Lencana nomor - HANYA saat membandingkan. Satu heksagon terpilih tidak
    // perlu diberi angka "1"; ia sudah jelas dari bingkainya.
    if (dibandingkan.length > 1) {
      dibandingkan.forEach((h3, i) => {
        const f = menurutH3.get(h3)
        const titik = f && titikTengah(f)
        if (titik) {
          fitur.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: titik },
            properties: { nomor: String(i + 1) },
          })
        }
      })
    }

    sumber.setData({ type: 'FeatureCollection', features: fitur } as never)
  }, [terpilih, kunciBanding, dibandingkan, layer, siap])

  const blokLalu = useRef<string | null>(null)
  useEffect(() => {
    const m = peta.current
    if (!m || !siap) return
    const sumber = m.getSource(SUMBER_BLOK) as GeoJSONSource | undefined
    if (!sumber) return

    if (!blok) {
      sumber.setData({ type: 'FeatureCollection', features: [] } as never)
      blokLalu.current = null
      return
    }

    sumber.setData({
      type: 'FeatureCollection',
      features: blok.blok.map((b) => ({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [b.koordinat] },
        properties: {
          h3_blok: b.h3_blok,
          peringkat: String(b.peringkat),
          // Skor untuk KELAS yang sedang dipilih, bukan skor umum - ia yang
          // tertulis di panel, dan peta yang mewarnai menurut angka lain dari
          // yang terbaca di sebelahnya adalah peta yang berbohong.
          skor: b.skor,
          dilarang: b.izin_komersial === false,
        },
      })),
    } as never)

    if (blokLalu.current !== blok.h3_index) {
      blokLalu.current = blok.h3_index
      // Tujuh blok ±130 m baru terbaca sebagai tujuh petak mulai zoom ~16.
      if (m.getZoom() < 16.2) {
        const diam = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        m.easeTo({ zoom: 16.8, duration: diam ? 0 : 700 })
      }
    }
  }, [blok, siap])

  // Blok yang disorot. Efek sendiri, bukan disatukan dengan yang di atas:
  // menyorot satu blok tidak boleh mengirim ulang tujuh poligon.
  useEffect(() => {
    const m = peta.current
    if (!m?.getLayer(L_BLOK_PILIH)) return
    m.setFilter(L_BLOK_PILIH, [
      'in',
      ['get', 'h3_blok'],
      ['literal', blokTerpilih ? [blokTerpilih] : []],
    ])
  }, [blokTerpilih, siap, blok])

  const isoRef = useRef(new Map<number, unknown>())
  // Kawasan jangkau ikut gerbang yang sama dengan rute: keduanya jawaban atas
  // pertanyaan yang sama, dan menampilkan salah satunya saja membuat peta
  // separuh menjawab.
  const nodeTujuan =
    rutaTampil && terpilih ? (konteks.get(kunciKt(terpilih))?.simpul?.id ?? null) : null

  useEffect(() => {
    const m = peta.current
    if (!m || !siap) return
    const sumber = m.getSource(SUMBER_ISO) as GeoJSONSource | undefined
    if (!sumber) return

    const kosong = { type: 'FeatureCollection', features: [] }
    if (nodeTujuan === null) {
      sumber.setData(kosong as never)
      return
    }

    const tersimpan = isoRef.current.get(nodeTujuan)
    if (tersimpan) {
      sumber.setData(tersimpan as never)
      return
    }

    let batal = false
    api
      .catchment({ node_id: nodeTujuan })
      .then((gj) => {
        if (batal) return
        isoRef.current.set(nodeTujuan, gj)
        const f = [...((gj as { features?: { properties?: { menit?: number } }[] }).features ?? [])]
        f.sort((a, b) => (b.properties?.menit ?? 0) - (a.properties?.menit ?? 0))
        sumber.setData({ type: 'FeatureCollection', features: f } as never)
      })
      .catch(() => {
        // Tabelnya boleh kosong - itu keadaan yang sah selama isochrone belum
        // dihitung. Yang tidak boleh: menggambar lingkaran sebagai gantinya.
        if (!batal) sumber.setData(kosong as never)
      })
    return () => {
      batal = true
    }
  }, [nodeTujuan, siap])

  const rafRute = useRef(0)
  /** Kunci rute yang kameranya sudah dibingkai, supaya tidak dibingkai ulang
   *  tiap kali efeknya berjalan lagi (ganti gaya, konteks baru). */
  const ruteDibingkai = useRef('')
  /** Jam arus rute. setInterval, BUKAN rAF: 14 langkah/detik sudah halus
   *  untuk mata, dan rAF akan menjalankannya 60 kali - empat kali ongkos
   *  untuk gerak yang sama. */
  const kunciKonteks = perluRute
    .map((h) => `${h}:${konteks.get(kunciKt(h))?.rute.length ?? -1}`)
    .join('|')

  useEffect(() => {
    const m = peta.current
    if (!m || !siap) return
    const sumber = m.getSource(SUMBER_RUTE) as GeoJSONSource | undefined
    if (!sumber) return

    const kosong = { type: 'FeatureCollection', features: [] }
    const berhenti = () => {
      if (rafRute.current) cancelAnimationFrame(rafRute.current)
      rafRute.current = 0
    }
    berhenti()
    const alirSumber = m.getSource(SUMBER_ALIR) as GeoJSONSource | undefined
    let idAlir = 0
    const hentiAlir = () => {
      if (idAlir) window.clearInterval(idAlir)
      idAlir = 0
      alirSumber?.setData(kosong as never)
    }
    hentiAlir()

    const membandingkan = dibandingkan.length > 1
    const jalur: {
      k: [number, number][]
      kum: number[]
      warna: string
      label: string
      utama: boolean
      profil: string
    }[] = []
    const ujung: unknown[] = []

    perluRute.forEach((h3) => {
      const kt = konteks.get(kunciKt(h3))
      if (!kt || !kt.rute.length) return
      const i = dibandingkan.indexOf(h3)
      const warna = membandingkan && i >= 0 ? WARNA_RUTE[i % WARNA_RUTE.length] : WARNA_RUTE_TUNGGAL(gaya)
      const dipakai: RuteJalan[] = membandingkan ? kt.rute.slice(0, 1) : kt.rute
      dipakai.forEach((r) => {
        const k = r.koordinat as [number, number][]
        if (k.length < 2) return
        jalur.push({
          k,
          kum: panjangKumulatif(k),
          warna,
          utama: r.utama,
          profil: r.profil ?? 'foot-walking',
          label: r.utama ? `${jarakSingkat(r.jarak_m)} · ${Math.round(r.menit)} mnt` : '',
        })
      })
      ujung.push(
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [kt.lon, kt.lat] },
          properties: { jenis: 'pin', warna, tujuan: false },
        },
        ...(kt.simpul
          ? [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [kt.simpul.lon, kt.simpul.lat] },
                properties: { jenis: 'pin', warna, tujuan: true },
              },
            ]
          : []),
      )
    })

    if (!jalur.length) {
      ruteDibingkai.current = ''
      sumber.setData(kosong as never)
      return
    }

    const garis = (potong: (j: (typeof jalur)[number], i: number) => [number, number][], berlabel: boolean) => ({
      type: 'FeatureCollection',
      features: [
        ...jalur.map((j, i) => ({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: potong(j, i) },
          properties: {
            jenis: 'garis',
            warna: j.warna,
            utama: j.utama,
            profil: j.profil,
          },
        })),
        ...ujung,
        // Label ditahan sampai garisnya sampai. Label yang ikut bergeser
        // bersama ujung yang sedang tumbuh terbaca sebagai teks yang lari.
        ...(berlabel
          ? jalur
              .filter((j) => j.utama)
              .map((j) => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: titikPada(j.k, j.kum, 0.5) },
                properties: { jenis: 'label', warna: j.warna, utama: true, label: j.label },
              }))
          : []),
      ],
    })

    // Arus: satu setPaintProperty per langkah, pada layer berisi <=4 fitur.
    // Menggantikan titik berjalan yang dulu menghitung posisi tiap rute tiap
    // bingkai lalu menulis ulang seluruh GeoJSON-nya.

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      sumber.setData(garis((j) => j.k, true) as never)
      return () => berhenti()
    }

    const kunciBingkai = `${kunciKonteks}|${profilNyata}`
    if (!membandingkan && ruteDibingkai.current !== kunciBingkai) {
      ruteDibingkai.current = kunciBingkai
      let [w, sLat, e, n] = [Infinity, Infinity, -Infinity, -Infinity]
      for (const j of jalur)
        for (const [x, y] of j.k) {
          if (x < w) w = x
          if (x > e) e = x
          if (y < sLat) sLat = y
          if (y > n) n = y
        }
      const lebar = m.getContainer().clientWidth
      const tinggi = m.getContainer().clientHeight
      const padding =
        lebar >= 1024
          ? { top: 110, bottom: 110, left: 110, right: Math.min(520, lebar * 0.36) }
          : { top: 80, bottom: Math.round(tinggi * 0.46), left: 40, right: 40 }
      if (Number.isFinite(w)) m.fitBounds([w, sLat, e, n], { padding, duration: 1100, maxZoom: 16.6 })
    }

    const t0 = performance.now() + TUNDA_RUTE_MS
    const total = GAMBAR_MS + UNDAK_MS * (jalur.length - 1)
    const maju = () => {
      const lewat = performance.now() - t0
      const kepala: unknown[] = []
      const data = garis((j, i) => {
        const pp = Math.min(1, Math.max(0, (lewat - i * UNDAK_MS) / GAMBAR_MS))
        // Melambat di ujung, sama dengan gelombang heksagon: laju tetap
        // terbaca sebagai penggaris yang bergeser, bukan sebagai sesuatu yang
        // mendarat.
        const f = 1 - Math.pow(1 - pp, 3)
        if (j.utama && pp > 0 && pp < 1)
          kepala.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: titikPada(j.k, j.kum, f) },
            properties: { jenis: 'kepala', warna: j.warna },
          })
        return potongJalur(j.k, j.kum, f)
      }, false)
      data.features.push(...(kepala as never[]))
      sumber.setData(data as never)
      if (lewat < total) {
        rafRute.current = requestAnimationFrame(maju)
      } else {
        sumber.setData(garis((j) => j.k, true) as never)
        mulaiAlir()
      }
    }
    const mulaiAlir = () => {
      const utama = jalur.filter((j) => j.utama)
      if (!alirSumber || !utama.length) return
      const t1 = performance.now()
      const langkah = () => {
        const t = ((performance.now() - t1) % ALIR_MS) / ALIR_MS
        alirSumber.setData({
          type: 'FeatureCollection',
          features: utama.map((j) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: titikPada(j.k, j.kum, t) },
            properties: { warna: j.warna },
          })),
        } as never)
      }
      langkah()
      idAlir = window.setInterval(langkah, ALIR_LANGKAH_MS)
    }
    rafRute.current = requestAnimationFrame(maju)

    return () => {
      berhenti()
      hentiAlir()
    }
  }, [kunciKonteks, perluRute, konteks, dibandingkan, gaya, siap, profilNyata, kunciKt])

  // --- Aksi yang dipanggil dari luar, termasuk oleh AI ---
  useImperativeHandle(
    ref,
    (): AksiPetaRef => ({
      zoomIn: () => peta.current?.zoomIn({ duration: 320 }),
      zoomOut: () => peta.current?.zoomOut({ duration: 320 }),

      flyTo: (lat, lon, zoom = 15) =>
        peta.current?.flyTo({ center: [lon, lat], zoom, duration: 900 }),

      fitBounds: (kotak) =>
        peta.current?.fitBounds(kotak, { padding: 60, duration: 900 }),

      setPin: (daftar) => {
        const m = peta.current
        if (!m) return
        // Penanda yang sudah ada cuma DIPINDAH dan diberi label baru. Versi
        // lama membongkar-pasang semuanya tiap panggilan, dan `setPin` dipanggil
        // tiga kali per satu simpan (optimistis, sesudah POST, lalu sesudah
        // daftar disegarkan) - jadi satu kali tahan terlihat seperti tiga kali
        // penanda muncul, masing-masing mengulang animasi jatuhnya.
        const tetap = new Set(daftar.map((p) => p.h3))
        for (const [h3, pin] of pinAktif.current) {
          if (!tetap.has(h3)) {
            pin.marker.remove()
            pinAktif.current.delete(h3)
          }
        }
        for (const { lat, lon, h3, label, sendiri } of daftar) {
          const ada = pinAktif.current.get(h3)
          if (ada) {
            ada.marker.setLngLat([lon, lat])
            if (ada.label !== label) {
              ada.label = label
              ada.el.setAttribute('aria-label', label)
              const n = ada.el.querySelector('.pin-simpan-nama')
              if (n) n.textContent = label
            }
            if (sendiri) ada.el.dataset.sendiri = '1'
            else delete ada.el.dataset.sendiri
            continue
          }
          const el = document.createElement('button')
          el.type = 'button'
          el.className = 'pin-simpan'
          if (sendiri) el.dataset.sendiri = '1'
          el.setAttribute('aria-label', label)
          // Glif digambar inline (berkas ini tidak boleh menambah aset). Label
          // namanya diisi lewat `textContent`, TIDAK PERNAH lewat innerHTML:
          // nama itu diketik pengguna, dan innerHTML di sini adalah XSS.
          el.innerHTML =
            '<span class="pin-simpan-kepala"><svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true">' +
            '<path d="M5.5 3.5h9V17L10 13.6 5.5 17Z" fill="currentColor"/></svg></span>' +
            '<span class="pin-simpan-nama"></span>'
          const namaEl = el.querySelector('.pin-simpan-nama')
          if (namaEl) namaEl.textContent = label
          // Klik pin = buka detail heksagonnya. Kejadiannya dihentikan di sini
          // supaya peta di bawahnya tidak ikut menerima klik yang sama - klik
          // itu jatuh DI DALAM heksagon terbuka dan akan menaruh titik baru.
          const henti = (ev: Event) => ev.stopPropagation()
          el.addEventListener('mousedown', henti)
          el.addEventListener('dblclick', henti)
          el.addEventListener('click', (ev) => {
            ev.stopPropagation()
            onPilihRef.current(h3)
          })
          const marker = new Marker({ element: el, anchor: 'bottom' })
            .setLngLat([lon, lat])
            .addTo(m)
          pinAktif.current.set(h3, { marker, el, label })
        }
      },

      resetArah: () =>
        peta.current?.easeTo({ bearing: 0, pitch: 0, duration: 600 }),

      arah: () => ({
        bearing: peta.current?.getBearing() ?? 0,
        pitch: peta.current?.getPitch() ?? 0,
      }),

      fokusHeksagon: (h3) => {
        const m = peta.current
        if (!m) return

        const bingkai = () => {
          const f =
            dataRef.current?.features.find((x) => x.properties?.h3_index === h3) ??
            (m.getSource(SUMBER)
              ? (m.querySourceFeatures(SUMBER, {
                  filter: ['==', ['get', 'h3_index'], h3] as ExpressionSpecification,
                })[0] as unknown as FiturHex | undefined)
              : undefined)
          const cincin = f?.geometry?.coordinates?.[0]
          if (!cincin?.length) return false
          let [w, sLat, e, n] = [Infinity, Infinity, -Infinity, -Infinity]
          for (const [x, y] of cincin) {
            if (x < w) w = x
            if (x > e) e = x
            if (y < sLat) sLat = y
            if (y > n) n = y
          }
          const lebar = m.getContainer().clientWidth
          const tinggi = m.getContainer().clientHeight
          const padding =
            lebar >= 1024
              ? { top: 96, bottom: 96, left: 96, right: Math.min(520, lebar * 0.36) }
              : { top: 72, bottom: Math.round(tinggi * 0.46), left: 36, right: 36 }
          m.fitBounds([w, sLat, e, n], { padding, duration: 900, maxZoom: 17.4 })
          return true
        }

        if (bingkai()) return
        // 10 detik, bukan 3: sejak kartu lokasi AI bisa memindahkan kawasan,
        // yang ditunggu di sini bisa berupa SELURUH layer kawasan baru dari
        // backend, bukan cuma ubin yang sedang dibangun.
        const batas = window.setTimeout(() => m.off('sourcedata', coba), 10_000)
        function coba() {
          if (bingkai()) {
            window.clearTimeout(batas)
            m?.off('sourcedata', coba)
          }
        }
        m.on('sourcedata', coba)
      },

      highlight: (hexIds) => {
        if (peta.current?.getLayer(L_PILIH)) {
          peta.current.setFilter(L_PILIH, ['in', ['get', 'h3_index'], ['literal', hexIds]])
        }
      },

      filter: (kriteria) => {
        const m = peta.current
        if (!m?.getLayer(L_ISI)) return
        const syarat: ExpressionSpecification[] = []
        if (typeof kriteria?.min_score === 'number') {
          syarat.push(['>=', ['get', 'opportunity_score'], kriteria.min_score])
        }
        if (kriteria?.kuadran) syarat.push(['==', ['get', 'kuadran'], kriteria.kuadran])
        const f = syarat.length ? (['all', ...syarat] as ExpressionSpecification) : null
        m.setFilter(L_ISI, f)
        m.setFilter(L_GARIS, f)
        if (m.getLayer(L_ANGKA)) m.setFilter(L_ANGKA, f)
      },
    }),
    [],
  )

  return (
    <div className="relative h-full w-full">
      {/* Tinggi diberi lewat h-full, BUKAN lewat absolute+inset-0.
          Alasannya konkret: maplibre-gl.css mendeklarasikan
          `.maplibregl-map { position: relative }` dengan spesifisitas yang sama
          dengan `.absolute` milik Tailwind, dan ia dimuat belakangan - jadi ia
          menang, `inset-0` berhenti memberi tinggi, dan wadahnya jadi nol tanpa
          satu pun galat di konsol. Peta ter-inisialisasi, kontrol muncul, tetapi
          tidak ada yang terlihat. */}
      <div ref={wadah} className="h-full w-full" />

      {/* Simpul transit. Ini produk transit-oriented, dan peta tanpa stasiun
          menghilangkan titik acuan yang membuat seluruh skor punya arti.

          Bentuknya meminjam kosakata rambu stasiun: kotak bermoda, bukan pin
          generik yang bisa berarti apa saja. */}
      <PenandaSimpul peta={peta} simpul={simpul} siap={siap} />

      {/* Kartu sorot mengikuti kursor di sudut, bukan tooltip melayang.
          Tooltip yang menempel pada kursor menutupi heksagon di sebelahnya —
          persis yang sedang dibandingkan pengguna. */}
      {sorot && (
        <div className="kaca pop pointer-events-none absolute left-1/2 top-[8.75rem] z-10 flex -translate-x-1/2 items-center gap-3.5 rounded-full px-5 py-2.5 max-lg:top-[4.5rem] max-lg:gap-2 max-lg:px-3 max-lg:py-1.5 lg:top-[5.75rem]">
          <p className="papan tabular text-[26px] leading-none max-lg:text-[17px]">
            {sorot.opportunity_score?.toFixed(0) ?? '—'}
          </p>
          {/* Indeks H3 sengaja TIDAK di sini. Lima belas karakter heksadesimal
              tidak menolong siapa pun yang sedang menyapukan kursor di atas
              peta - yang ia butuhkan cuma tahu ini di mana. Indeksnya tetap ada
              di panel detail, tempat orang memang sedang menelusuri satu
              lokasi tertentu. */}
          <p className="text-[12.5px] leading-tight text-ink-3 max-lg:text-[10px]">
            Opportunity Score
            <span className="block text-[11.5px] font-medium text-ink-2 max-lg:text-[9.5px]">{sorot.kawasan}</span>
          </p>
          <p className="flex items-center gap-1.5 border-l border-line pl-3.5 text-[13.5px] text-ink-2 max-lg:pl-2.5 max-lg:text-[11px]">
            <span className="flex flex-col leading-tight">
              <span className="font-semibold" style={{ color: sorot.kuadran ? KUADRAN[sorot.kuadran].warna : undefined }}>
                {sorot.kuadran ? namaZona(sorot.kuadran) : teksZona.belum}
              </span>
              {sorot.kuadran && (
                <span className="text-[11.5px] text-ink-3 max-lg:text-[9.5px]">
                  {bahasa === 'en' ? KUADRAN[sorot.kuadran].ringkasEn : KUADRAN[sorot.kuadran].ringkas}
                </span>
              )}
            </span>
            {sorot.data_source === 'predicted' && (
              <span className="arsir h-2.5 w-2.5 rounded-[2px] border border-line-2 text-ink-3" />
            )}
          </p>
        </div>
      )}

      {/* ================= Tumpukan kiri atas ==========================

          Peringatan ubin PINDAH ke sini dari tengah-bawah (3 Sep 2026,
          permintaan pemilik repo). Di tengah bawah ia menutupi pil layer, baki
          komparasi, dan ajakan simulasi sekaligus - tiga hal yang justru sedang
          dipakai orang saat peringatannya muncul.

          Kiri atas juga tempat yang benar secara arti: keduanya - layer yang
          kosong dan ubin yang menolak - menjawab pertanyaan yang sama, "kenapa
          yang saya lihat begini". Menaruhnya bersebelahan membuat keduanya
          terbaca sebagai satu keluarga, bukan dua kejadian yang tidak
          berhubungan.

          `top-4` semula - dan itu bug NYATA, bukan cuma kurang rapi: bilah
          logo + pencarian di App.tsx duduk di atas peta yang sama pada posisi
          hampir identik, jadi tumpukan ini lahir TERTIMBUN sejak bingkai
          pertama. `top-[5.75rem]` bukan angka tebakan - itu offset yang SUDAH
          dipakai pil info layer beberapa baris di bawah untuk masalah yang
          persis sama, jadi keduanya sekarang sejajar dan sama-sama di bawah
          bilah atas. */}
      <div className="pointer-events-none absolute left-4 top-[8.75rem] z-10 flex max-w-[calc(100%-2rem)] flex-col items-start gap-2 sm:max-w-[24rem] lg:top-[9.25rem]">
        {/* --- Layer ini punya berapa data ---------------------------------

            Muncul HANYA kalau cakupannya di bawah separuh. Pemberitahuan yang
            selalu ada berhenti dibaca, dan Opportunity - satu-satunya layer yang
            708/708 - tidak pernah perlu menjelaskan dirinya.

            Angkanya dihitung dari fitur yang termuat, jadi ia menghilang sendiri
            begitu sumbernya masuk. Tidak ada yang perlu ingat memperbaruinya. */}
        {cakupan && cakupan.total > 0 && cakupan.terisi < cakupan.total / 2 && (
          <div
            role="status"
            className={`kaca pop pointer-events-auto rounded-md px-3.5 py-2.5 ${
              cakupan.terisi === 0 ? 'border-l-[3px] border-l-bahaya' : ''
            }`}
          >
            <p className="text-[12.5px] font-semibold text-ink">
              {cakupan.terisi === 0
                ? teksZona.layerKosong(bahasa === 'en' ? cakupan.bendaEn : cakupan.benda)
                : teksZona.layerSebagian(
                    cakupan.terisi,
                    cakupan.total,
                    bahasa === 'en' ? cakupan.bendaEn : cakupan.benda,
                  )}
            </p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-ink-2">
              {cakupan.terisi === 0
                ? teksZona.nolDari(cakupan.total)
                : 'Sisanya digambar abu: belum terukur, bukan bernilai rendah.'}
            </p>
          </div>
        )}

      {galatPeta && !galatPeta.ubin && (
        <div
          role="alert"
          // bottom-24, bukan bottom-4: kaki peta sudah ditempati pil pertanyaan
          // layer / ajakan simulasi / baki komparasi, dan pesan ini lebih
          // tinggi daripada versi satu-barisnya. Ditaruh di atas keduanya.
          className="kaca pop pointer-events-auto relative max-w-[22rem] rounded-md px-4 py-3 max-lg:max-w-[13.5rem] max-lg:rounded-lg max-lg:px-2.5 max-lg:py-1.5"
        >
          {/* Di ponsel kartu ini dikecilkan: yang perlu terbaca cuma "petanya
              kenapa". Pesan teknis dari MapLibre (nama layer, nama properti)
              tidak menolong siapa pun yang sedang melihat peta - ia cuma
              membuat layar terlihat rusak - jadi di sana ia dipotong dua baris
              dan dikecilkan, bukan disembunyikan (isinya tetap bisa dibaca). */}
          {/* Dua kegagalan, dua kalimat.

              Versi sebelumnya selalu menulis "Basemap gagal dimuat" lalu
              menyarankan "pilih basemap lain". Saran itu KELIRU untuk kasus
              yang paling sering terjadi: keempat gaya menarik ubin dari
              `basemap.mapid.io/data/mapidtiles` yang sama persis, jadi orang
              yang menurutinya akan mencoba keempatnya dan gagal keempat kali -
              lalu menyimpulkan aplikasinya yang rusak.

              Terukur saat pemadaman: ubin menolak SEMUA bentuk otentikasi
              (dengan kunci pun 401), sementara `styles/*` menjawab 200 dengan
              kunci yang sama dan `fonts/*` 200 tanpa kunci. Jadi kuncinya sah
              dan yang padam sisi MAPID. */}
          <p className="pr-7 text-[13.5px] font-semibold text-bahaya max-lg:pr-0 max-lg:text-[11px]">
            {teksZona.basemapJudul}
          </p>
          <p
            className="mt-1 text-[13px] leading-relaxed text-ink-2 max-lg:mt-0.5 max-lg:line-clamp-2 max-lg:text-[10px]"
            title={galatPeta.pesan}
          >
            {galatPeta.pesan}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3 max-lg:hidden">
            {teksZona.basemapLanjut}
          </p>
        </div>
      )}
      </div>

      {galat && (
        <div
          role="alert"
          className="absolute bottom-4 left-1/2 z-10 max-w-md -translate-x-1/2 rounded-md border border-bahaya/30 bg-bahaya-soft px-4 py-3 text-[15px] text-bahaya shadow-[0_18px_40px_-14px_rgb(22_33_28/0.35)] max-lg:max-w-[15rem] max-lg:px-2.5 max-lg:py-2 max-lg:text-[11.5px] lg:left-[calc(50%-13rem)]"
        >
          <p className="font-semibold">{teksZona.heksJudul}</p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2 max-lg:mt-0.5 max-lg:line-clamp-2 max-lg:text-[10.5px]">
            {/* `TypeError` peramban ("Failed to fetch") bukan kalimat untuk pengunjung. */}
            {galat === 'Failed to fetch' ? teksZona.tanpaSambungan : galat}
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">{teksZona.heksLanjut}</p>
        </div>
      )}
    </div>
  )
})

function PenandaSimpul({
  peta,
  simpul,
  siap,
}: {
  peta: React.RefObject<MapLibreMap | null>
  simpul: SimpulTransit[]
  siap: boolean
}) {
  const [, paksaGambar] = useState(0)

  useEffect(() => {
    const m = peta.current
    if (!m || !siap) return
    const gambar = () => paksaGambar((n) => n + 1)
    m.on('move', gambar)
    gambar()
    return () => {
      m.off('move', gambar)
    }
  }, [peta, siap, simpul])

  const m = peta.current
  if (!m || !siap || simpul.length === 0) return null

  return (
    <>
      {simpul.map((s) => {
        const t = m.project([s.lon, s.lat])
        return (
          <div
            key={s.id}
            className="pointer-events-none absolute z-[5] -translate-x-1/2 -translate-y-1/2"
            style={{ left: t.x, top: t.y }}
          >
            <div className="flex items-center gap-1.5">
              <span
                className="grid h-5 w-5 place-items-center rounded-[3px] bg-ink text-[11px] font-bold tracking-tight text-surface shadow-[0_0_0_2px_var(--color-surface)]"
                aria-hidden
              >
                {s.moda === 'TERMINAL' ? 'T' : s.moda.slice(0, 1)}
              </span>
              <span className="whitespace-nowrap rounded-xs bg-surface/92 px-1.5 py-[2px] text-[12.5px] font-semibold shadow-[0_1px_3px_rgb(22_33_28/0.14)] backdrop-blur-sm">
                {s.nama}
                <span className="ml-1 font-normal text-ink-3">{s.moda}</span>
              </span>
            </div>
          </div>
        )
      })}
    </>
  )
}

export default PetaInteraktif

