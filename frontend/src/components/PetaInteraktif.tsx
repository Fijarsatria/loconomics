/**
 * Bagian wajib 1 dari 3: Peta Interaktif.
 *
 * Memegang instance MapLibre dan mengekspos aksi peta lewat `ref`. Aksi itulah
 * yang dipanggil PanelAI saat LLM mengembalikan `aksi_peta` — flyTo, highlight,
 * setLayer, dan filter dijalankan di sini, bukan di backend. Kalau flyTo
 * dieksekusi backend, tidak ada yang bergerak di layar.
 *
 * Nama dan argumen keempat aksi harus sama persis dengan `FUNGSI_FRONTEND`
 * di `backend/app/api/ai.py` — itu kontrak yang dikirim ke penyedia LLM.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  type ExpressionSpecification,
  type GeoJSONSource,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

import {
  KAWASAN_AWAL,
  WARNA_KUADRAN,
  ZOOM_AWAL,
  urlGaya,
  type NamaGaya,
  type NamaLayer,
} from '../config'
import { api } from '../lib/api'
import type { PropertiHeksagon } from '../types'

const SUMBER_HEX = 'heksagon'
const LAYER_ISI = 'heksagon-isi'
const LAYER_GARIS = 'heksagon-garis'
const LAYER_SOROT = 'heksagon-sorot'

const ABU = '#cbd5e1'

/**
 * Lima layer tematik. Masing-masing menjawab satu pertanyaan, jadi masing-masing
 * mewarnai dengan aturan sendiri — bukan satu gradasi yang dipakai ulang.
 */
const WARNA_LAYER: Record<NamaLayer, ExpressionSpecification> = {
  // Peluang: warna mengikuti kuadran, bukan skor mentah. Empat kategori lebih
  // mudah dibaca sekilas daripada gradasi 0–100, dan kategorinya yang membawa
  // makna — hijau layak dilirik, amber justru harus diwaspadai.
  opportunity: [
    'match',
    ['get', 'kuadran'],
    'HIDDEN_GEM', WARNA_KUADRAN.HIDDEN_GEM,
    'PEMENANG_JELAS', WARNA_KUADRAN.PEMENANG_JELAS,
    'JEBAKAN_GENGSI', WARNA_KUADRAN.JEBAKAN_GENGSI,
    'HINDARI', WARNA_KUADRAN.HINDARI,
    ABU,
  ],

  // GemFinder: hanya yang punya hidden_gem_score yang berwarna. Heksagon tanpa
  // skor gem sengaja diabukan — daftar pendek yang tegas lebih berguna daripada
  // peta penuh warna yang harus ditafsirkan sendiri.
  hidden_gem: [
    'case',
    ['==', ['get', 'hidden_gem_score'], null], ABU,
    ['interpolate', ['linear'], ['get', 'hidden_gem_score'], 0, '#d1fae5', 1, '#047857'],
  ],

  // RiskRadar: satu kuadran saja. Ini fitur peringatan, bukan fitur eksplorasi.
  risk_radar: [
    'case',
    ['==', ['get', 'kuadran'], 'JEBAKAN_GENGSI'], WARNA_KUADRAN.JEBAKAN_GENGSI,
    ABU,
  ],

  // PriceLens: harga sewa median. Murah = biru muda, mahal = biru tua.
  pricelens: [
    'case',
    ['==', ['get', 'harga_sewa_median'], null], ABU,
    [
      'interpolate', ['linear'], ['get', 'harga_sewa_median'],
      1_000_000, '#dbeafe',
      50_000_000, '#1e3a8a',
    ],
  ],

  // ZoneGuard: tiga status, tiga warna. NULL TIDAK disamakan dengan FALSE —
  // "belum ada RDTR digital" bukan "dilarang".
  zoneguard: [
    'case',
    ['==', ['get', 'zona_izin_komersial'], true], '#10b981',
    ['==', ['get', 'zona_izin_komersial'], false], '#ef4444',
    '#f59e0b',
  ],
}

export interface Kriteria {
  min_score?: number
  kuadran?: string
}

/** Tiga aksi yang benar-benar milik peta. Dipegang lewat ref. */
export interface AksiPetaRef {
  flyTo: (lat: number, lon: number, zoom?: number) => void
  highlight: (hexIds: string[]) => void
  filter: (kriteria: Kriteria | null) => void
}

/**
 * Yang dipegang AI Consultant: tiga aksi peta di atas + dua penukar tampilan
 * yang state-nya ada di App. Digabung supaya tombol di layar dan perintah AI
 * selalu menunjuk sumber kebenaran yang sama.
 */
export interface KendaliPeta extends AksiPetaRef {
  setLayer: (namaLayer: NamaLayer) => void
  setGaya: (gaya: NamaGaya) => void
}

interface Props {
  kawasan: string
  layer: NamaLayer
  gaya: NamaGaya
  onPilihHeksagon: (h3: string | null) => void
}

const PetaInteraktif = forwardRef<AksiPetaRef, Props>(function PetaInteraktif(
  { kawasan, layer, gaya, onPilihHeksagon },
  ref,
) {
  const wadah = useRef<HTMLDivElement>(null)
  const peta = useRef<MapLibreMap | null>(null)
  const [siap, setSiap] = useState(false)
  const [galat, setGalat] = useState<string | null>(null)

  // --- Inisialisasi peta. Sekali saja seumur komponen. ---
  useEffect(() => {
    if (!wadah.current) return

    const m = new MapLibreMap({
      container: wadah.current,
      style: urlGaya('dasar'),
      center: KAWASAN_AWAL.pusat,
      zoom: ZOOM_AWAL,
    })
    m.addControl(new NavigationControl(), 'top-right')
    m.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')
    m.on('load', () => setSiap(true))
    peta.current = m

    return () => {
      m.remove()
      peta.current = null
    }
  }, [])

  // --- Ganti gaya basemap MAPID ---
  // setStyle membuang seluruh sumber & layer, jadi `siap` direset supaya efek
  // pemuatan heksagon di bawah berjalan ulang setelah gaya baru selesai dimuat.
  useEffect(() => {
    const m = peta.current
    if (!m || !siap) return
    setSiap(false)
    m.once('styledata', () => setSiap(true))
    m.setStyle(urlGaya(gaya))
    // `siap` sengaja tidak masuk daftar dependensi: memasukkannya membuat efek
    // ini memanggil dirinya sendiri lewat setSiap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gaya])

  // --- Muat layer heksagon setiap kawasan (atau gaya) berubah ---
  useEffect(() => {
    const m = peta.current
    if (!m || !siap) return
    let batal = false

    api
      .layerHeksagon({ kawasan })
      .then((data) => {
        if (batal || !peta.current) return
        setGalat(null)

        const sumber = m.getSource(SUMBER_HEX)
        if (sumber) {
          ;(sumber as GeoJSONSource).setData(data as never)
          return
        }

        m.addSource(SUMBER_HEX, { type: 'geojson', data: data as never })

        m.addLayer({
          id: LAYER_ISI,
          type: 'fill',
          source: SUMBER_HEX,
          paint: {
            'fill-color': WARNA_LAYER[layer],
            // Heksagon hasil imputasi digambar lebih transparan. Pembaca harus
            // bisa membedakan "disurvei" dari "ditebak model" tanpa mengklik.
            'fill-opacity': ['case', ['==', ['get', 'data_source'], 'predicted'], 0.28, 0.6],
          },
        })

        m.addLayer({
          id: LAYER_GARIS,
          type: 'line',
          source: SUMBER_HEX,
          paint: { 'line-color': '#ffffff', 'line-width': 0.5, 'line-opacity': 0.4 },
        })

        // Layer sorot dipakai fungsi highlight() milik AI. Awalnya kosong.
        m.addLayer({
          id: LAYER_SOROT,
          type: 'line',
          source: SUMBER_HEX,
          paint: { 'line-color': '#0f172a', 'line-width': 3 },
          filter: ['in', ['get', 'h3_index'], ['literal', []]],
        })

        m.on('click', LAYER_ISI, (e) => {
          const p = e.features?.[0]?.properties as PropertiHeksagon | undefined
          onPilihHeksagon(p?.h3_index ?? null)
        })
        m.on('mouseenter', LAYER_ISI, () => {
          m.getCanvas().style.cursor = 'pointer'
        })
        m.on('mouseleave', LAYER_ISI, () => {
          m.getCanvas().style.cursor = ''
        })
      })
      .catch((e: Error) => !batal && setGalat(e.message))

    return () => {
      batal = true
    }
  }, [kawasan, siap, layer, onPilihHeksagon])

  // --- Ganti layer tematik tanpa memuat ulang data ---
  useEffect(() => {
    const m = peta.current
    if (!m?.getLayer(LAYER_ISI)) return
    m.setPaintProperty(LAYER_ISI, 'fill-color', WARNA_LAYER[layer])
  }, [layer, siap])

  // --- Aksi yang dipanggil dari luar (termasuk oleh AI) ---
  useImperativeHandle(ref, (): AksiPetaRef => ({
    flyTo: (lat, lon, zoom = 15) => peta.current?.flyTo({ center: [lon, lat], zoom }),

    highlight: (hexIds) => {
      if (peta.current?.getLayer(LAYER_SOROT)) {
        peta.current.setFilter(LAYER_SOROT, [
          'in',
          ['get', 'h3_index'],
          ['literal', hexIds],
        ])
      }
    },

    filter: (kriteria) => {
      if (!peta.current?.getLayer(LAYER_ISI)) return
      const syarat: ExpressionSpecification[] = []
      if (typeof kriteria?.min_score === 'number') {
        syarat.push(['>=', ['get', 'opportunity_score'], kriteria.min_score])
      }
      if (kriteria?.kuadran) {
        syarat.push(['==', ['get', 'kuadran'], kriteria.kuadran])
      }
      const f = syarat.length ? (['all', ...syarat] as ExpressionSpecification) : null
      peta.current.setFilter(LAYER_ISI, f)
      peta.current.setFilter(LAYER_GARIS, f)
    },
  }), [])

  return (
    <div className="relative h-full w-full">
      <div ref={wadah} className="absolute inset-0" />
      {galat && (
        <div className="absolute left-3 top-3 z-10 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 shadow">
          Gagal memuat layer heksagon: {galat}
        </div>
      )}
    </div>
  )
})

export default PetaInteraktif
