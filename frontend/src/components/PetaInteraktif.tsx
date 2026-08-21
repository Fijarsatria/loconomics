/**
 * Bagian wajib 1 dari 3: Peta Interaktif.
 *
 * Dua keputusan visual yang perlu dipahami sebelum mengubah berkas ini.
 *
 * PERTAMA — arsir berarti "kami belum tahu". Heksagon yang nilainya hasil
 * imputasi model digambar dengan pola arsir di atas isiannya, bukan sekadar
 * dibuat lebih pudar. Pudar terbaca sebagai "kurang penting"; arsir terbaca
 * sebagai "jenisnya berbeda", dan itu yang benar. Aturan proyek menuntut
 * pengguna bisa membedakan yang disurvei dari yang ditebak model tanpa mengklik.
 *
 * KEDUA — HINDARI tidak punya warna. Validator palet membuktikan abu-abu tidak
 * bisa jadi warna kategorikal, dan itu justru petunjuk: kuadran itu memang
 * berarti tidak ada apa-apa di sini. Ia digambar hanya sebagai garis.
 *
 * Aksi peta (flyTo, highlight, filter) dieksekusi DI SINI, bukan di backend.
 * Kalau flyTo jalan di server, tidak ada yang bergerak di layar pengguna — dan
 * ketentuan C.2 justru meminta keluaran AI yang benar-benar mendarat di peta.
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
  ABU_HINDARI,
  KAWASAN_AWAL,
  KUADRAN,
  ZOOM_AWAL,
  urlGaya,
  type NamaGaya,
  type NamaLayer,
} from '../config'
import { api } from '../lib/api'
import type { PropertiHeksagon, SimpulTransit } from '../types'

const SUMBER = 'heksagon'
const L_ISI = 'hex-isi'
const L_ARSIR = 'hex-arsir'
const L_GARIS = 'hex-garis'
const L_SOROT = 'hex-sorot'
const L_PILIH = 'hex-pilih'
const L_SELUBUNG = 'selubung-basemap'
const POLA = 'arsir-ketidakpastian'

const q = (k: string) => KUADRAN[k].warna ?? ABU_HINDARI

/**
 * Pola arsir dibuat di kanvas, bukan dimuat sebagai berkas.
 * Satu berkas gambar berarti satu permintaan jaringan lagi yang bisa gagal saat
 * demo, untuk sesuatu yang isinya hanya empat garis miring.
 */
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

/** Warna isian per layer tematik. Satu tempat, lima aturan. */
const WARNA_LAYER: Record<NamaLayer, ExpressionSpecification> = {
  // Kuadran, bukan gradasi skor. Empat kategori terbaca sekilas; gradasi 0–100
  // menuntut mata membandingkan dua warna serupa untuk tahu mana yang lebih baik.
  opportunity: [
    'match',
    ['get', 'kuadran'],
    'HIDDEN_GEM', q('HIDDEN_GEM'),
    'PEMENANG_JELAS', q('PEMENANG_JELAS'),
    'JEBAKAN_GENGSI', q('JEBAKAN_GENGSI'),
    'HINDARI', ABU_HINDARI,
    ABU_HINDARI,
  ],

  // Hanya yang punya skor gem yang berwarna. Sisanya diabukan supaya jawabannya
  // berupa daftar pendek yang tegas, bukan peta penuh warna yang harus ditafsirkan.
  hidden_gem: [
    'case',
    ['==', ['get', 'hidden_gem_score'], null], ABU_HINDARI,
    ['interpolate', ['linear'], ['get', 'hidden_gem_score'], 0, KUADRAN.HIDDEN_GEM.lembut, 1, q('HIDDEN_GEM')],
  ],

  // Satu kuadran saja. Ini fitur peringatan, bukan fitur eksplorasi.
  risk_radar: [
    'case',
    ['==', ['get', 'kuadran'], 'JEBAKAN_GENGSI'], q('JEBAKAN_GENGSI'),
    ABU_HINDARI,
  ],

  // Sekuensial satu rona: murah terang, mahal gelap. Tanpa data tetap abu —
  // "sewanya murah" dan "belum ada yang mensurvei" tidak boleh sewarna.
  pricelens: [
    'case',
    ['==', ['get', 'harga_sewa_per_m2'], null], ABU_HINDARI,
    [
      'interpolate', ['linear'], ['get', 'harga_sewa_per_m2'],
      50_000, '#e4ece9',
      150_000, '#7ea79c',
      400_000, '#2c4f45',
    ],
  ],

  // Tiga status, tiga perlakuan. NULL TIDAK disamakan dengan FALSE.
  zoneguard: [
    'case',
    ['==', ['get', 'zona_izin_komersial'], true], '#8fbfb2',
    ['==', ['get', 'zona_izin_komersial'], false], '#b42318',
    ABU_HINDARI,
  ],
}

/**
 * Opasitas isian per layer.
 *
 * Hanya layer `opportunity` yang memudarkan HINDARI, karena "hindari" adalah
 * gagasan kuadran. Di layer ZoneGuard, heksagon berkuadran HINDARI yang zonanya
 * terlarang justru HARUS terlihat penuh - memudarkannya berarti menyembunyikan
 * peringatan yang paling penting di layar hanya karena skor ekonominya rendah.
 */
const OPASITAS_LAYER: Record<NamaLayer, number | ExpressionSpecification> = {
  opportunity: ['case', ['==', ['get', 'kuadran'], 'HINDARI'], 0.14, 0.56],
  hidden_gem: ['case', ['==', ['get', 'hidden_gem_score'], null], 0.1, 0.62],
  risk_radar: ['case', ['==', ['get', 'kuadran'], 'JEBAKAN_GENGSI'], 0.62, 0.09],
  pricelens: ['case', ['==', ['get', 'harga_sewa_per_m2'], null], 0.1, 0.62],
  zoneguard: 0.5,
}

/**
 * Cari layer tempat heksagon harus disisipkan: tepat setelah isian dan garis
 * basemap terakhir, sebelum labelnya.
 */
function idLabelPertama(m: MapLibreMap): string | undefined {
  const layers = m.getStyle().layers ?? []
  let terakhirBukanSymbol = -1
  layers.forEach((l, i) => {
    if (l.type !== 'symbol' && l.type !== 'background') terakhirBukanSymbol = i
  })
  return layers[terakhirBukanSymbol + 1]?.id
}

/**
 * Tenangkan basemap sebelum data digambar di atasnya.
 *
 * Gaya MAPID menggambar setiap footprint bangunan dan setiap ikon POI - halte,
 * klinik, posyandu. Untuk peta navigasi itu benar; untuk peta analitik ia
 * berebut perhatian dengan hal yang justru ingin dibaca. Dua tindakan, keduanya
 * bisa dibalik dengan mengganti gaya:
 *
 *   1. Selubung putih tipis di atas isian basemap, di bawah heksagon. Jalan dan
 *      bangunan tetap ada sebagai konteks, tetapi berhenti bersaing.
 *   2. Ikon POI disembunyikan. Nama jalan dan nama tempat DIPERTAHANKAN - itu
 *      yang dipakai orang mengenali lokasi; ikon klinik tidak.
 */
function siapkanBasemap(m: MapLibreMap) {
  const layers = m.getStyle().layers ?? []

  for (const l of layers) {
    if (/^poi/.test(l.id) && l.type === 'symbol') {
      m.setLayoutProperty(l.id, 'visibility', 'none')
    }
  }

  if (!m.getLayer(L_SELUBUNG)) {
    m.addLayer(
      {
        id: L_SELUBUNG,
        type: 'background',
        paint: { 'background-color': '#ffffff', 'background-opacity': 0.58 },
      },
      idLabelPertama(m),
    )
  }
}

export interface Kriteria {
  min_score?: number
  kuadran?: string
}

export interface AksiPetaRef {
  flyTo: (lat: number, lon: number, zoom?: number) => void
  highlight: (hexIds: string[]) => void
  filter: (kriteria: Kriteria | null) => void
}

export interface KendaliPeta extends AksiPetaRef {
  setLayer: (namaLayer: NamaLayer) => void
  setGaya: (gaya: NamaGaya) => void
}

interface Props {
  kawasan: string
  layer: NamaLayer
  gaya: NamaGaya
  terpilih: string | null
  saringKuadran: string | null
  onPilihHeksagon: (h3: string | null) => void
  onMuat: (n: number) => void
}

const PetaInteraktif = forwardRef<AksiPetaRef, Props>(function PetaInteraktif(
  { kawasan, layer, gaya, terpilih, saringKuadran, onPilihHeksagon, onMuat },
  ref,
) {
  const wadah = useRef<HTMLDivElement>(null)
  const peta = useRef<MapLibreMap | null>(null)
  const [siap, setSiap] = useState(false)
  const [galat, setGalat] = useState<string | null>(null)
  const [sorot, setSorot] = useState<PropertiHeksagon | null>(null)
  const [simpul, setSimpul] = useState<SimpulTransit[]>([])

  // Simpul transit dimuat terpisah dari heksagon: jumlahnya sedikit, jarang
  // berubah, dan digambar sebagai elemen HTML di atas peta - bukan layer
  // MapLibre. Alasannya bukan kemudahan: penanda HTML bisa difokuskan keyboard
  // dan dibaca pembaca layar, sedangkan simbol di kanvas tidak bisa keduanya.
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
      style: urlGaya('terang'),
      center: KAWASAN_AWAL.pusat,
      zoom: ZOOM_AWAL,
      attributionControl: { compact: true },
    })
    m.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    m.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right')
    m.on('load', () => setSiap(true))
    peta.current = m
    return () => {
      m.remove()
      peta.current = null
    }
  }, [])

  // --- Ganti gaya basemap ---
  // setStyle membuang seluruh sumber & layer, jadi `siap` direset supaya efek
  // pemuatan heksagon di bawah berjalan ulang setelah gaya baru selesai dimuat.
  useEffect(() => {
    const m = peta.current
    if (!m || !siap) return
    setSiap(false)
    m.once('styledata', () => setSiap(true))
    m.setStyle(urlGaya(gaya))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gaya])

  // --- Muat heksagon ---
  useEffect(() => {
    const m = peta.current
    if (!m || !siap) return
    let batal = false

    api
      .layerHeksagon({ kawasan })
      .then((data) => {
        if (batal || !peta.current) return
        setGalat(null)
        const fitur = (data.features as unknown[]) ?? []
        onMuat(fitur.length)

        const sumber = m.getSource(SUMBER)
        if (sumber) {
          ;(sumber as GeoJSONSource).setData(data as never)
          return
        }

        if (!m.hasImage(POLA)) {
          m.addImage(POLA, buatPolaArsir(), { pixelRatio: 2 })
        }
        m.addSource(SUMBER, { type: 'geojson', data: data as never })

        siapkanBasemap(m)

        // Heksagon disisipkan DI ATAS seluruh isian dan garis basemap, tetapi
        // DI BAWAH labelnya. Kalau heksagon menutupi nama jalan dan stasiun,
        // pengguna kehilangan satu-satunya cara mengenali tempat yang sedang
        // dilihatnya, dan peta berubah jadi hamparan warna yang tidak menunjuk
        // apa pun.
        //
        // Percobaan pertama menyisipkannya sebelum layer symbol PERTAMA, dan itu
        // salah: symbol pertama di gaya MAPID adalah `water_name` pada indeks 8
        // dari 54, jadi seluruh jalan dan bangunan justru tergambar DI ATAS
        // heksagon dan menyapunya habis. Yang benar: setelah layer bukan-symbol
        // TERAKHIR.
        const labelPertama = idLabelPertama(m)

        m.addLayer(
          {
            id: L_ISI,
            type: 'fill',
            source: SUMBER,
            paint: {
              'fill-color': WARNA_LAYER[layer],
              'fill-opacity': OPASITAS_LAYER[layer],
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
            filter: ['==', ['get', 'data_source'], 'predicted'],
            paint: { 'fill-pattern': POLA, 'fill-opacity': 0.5 },
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
            paint: { 'line-color': '#16211c', 'line-width': 0.8, 'line-opacity': 0.38 },
          },
          labelPertama,
        )

        m.addLayer({
          id: L_SOROT,
          type: 'line',
          source: SUMBER,
          paint: { 'line-color': '#16211c', 'line-width': 1.5 },
          filter: ['in', ['get', 'h3_index'], ['literal', []]],
        })

        m.addLayer({
          id: L_PILIH,
          type: 'line',
          source: SUMBER,
          paint: { 'line-color': '#16211c', 'line-width': 2.5 },
          filter: ['in', ['get', 'h3_index'], ['literal', []]],
        })

        m.on('click', L_ISI, (e) => {
          const p = e.features?.[0]?.properties as PropertiHeksagon | undefined
          onPilihHeksagon(p?.h3_index ?? null)
        })
        m.on('mousemove', L_ISI, (e) => {
          const p = e.features?.[0]?.properties as PropertiHeksagon | undefined
          setSorot(p ?? null)
          m.getCanvas().style.cursor = 'pointer'
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
      })
      .catch((e: Error) => !batal && setGalat(e.message))

    return () => {
      batal = true
    }
  }, [kawasan, siap, layer, onPilihHeksagon, onMuat])

  // --- Ganti layer tematik tanpa memuat ulang data ---
  useEffect(() => {
    const m = peta.current
    if (!m?.getLayer(L_ISI)) return
    m.setPaintProperty(L_ISI, 'fill-color', WARNA_LAYER[layer])
    m.setPaintProperty(L_ISI, 'fill-opacity', OPASITAS_LAYER[layer])
  }, [layer, siap])

  // --- Saring kuadran dari Kompas ---
  useEffect(() => {
    const m = peta.current
    if (!m?.getLayer(L_ISI)) return
    const f = saringKuadran
      ? (['==', ['get', 'kuadran'], saringKuadran] as ExpressionSpecification)
      : null
    m.setFilter(L_ISI, f)
    m.setFilter(L_GARIS, f)
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
  }, [saringKuadran, siap])

  // --- Tandai heksagon terpilih ---
  useEffect(() => {
    const m = peta.current
    if (!m?.getLayer(L_PILIH)) return
    m.setFilter(L_PILIH, ['in', ['get', 'h3_index'], ['literal', terpilih ? [terpilih] : []]])
  }, [terpilih, siap])

  // --- Aksi yang dipanggil dari luar, termasuk oleh AI ---
  useImperativeHandle(
    ref,
    (): AksiPetaRef => ({
      flyTo: (lat, lon, zoom = 15) =>
        peta.current?.flyTo({ center: [lon, lat], zoom, duration: 900 }),

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
        <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-sm border border-line bg-surface/95 px-2.5 py-2 shadow-[0_2px_10px_rgb(22_33_28/0.10)] backdrop-blur-sm">
          <p className="font-mono text-[10px] text-ink-3">{sorot.h3_index}</p>
          <p className="papan tabular mt-0.5 text-[17px] leading-none">
            {sorot.opportunity_score?.toFixed(0) ?? '—'}
            <span className="ml-1 text-[10px] font-normal text-ink-3">skor peluang</span>
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-[10.5px] text-ink-2">
            {sorot.kuadran ? KUADRAN[sorot.kuadran].nama : 'belum berkuadran'}
            {sorot.data_source === 'predicted' && (
              <span className="arsir h-2.5 w-2.5 rounded-[2px] border border-line-2 text-ink-3" />
            )}
          </p>
        </div>
      )}

      {galat && (
        <div
          role="alert"
          className="absolute left-3 top-3 z-10 max-w-sm rounded-sm border border-bahaya/30 bg-bahaya-soft px-3 py-2 text-[12px] text-bahaya"
        >
          <p className="font-semibold">Layer heksagon gagal dimuat</p>
          <p className="mt-0.5 text-[11.5px] text-ink-2">{galat}</p>
        </div>
      )}
    </div>
  )
})

/**
 * Penanda simpul yang mengikuti kamera peta.
 *
 * Diposisikan ulang tiap kali peta bergerak lewat project(). Marker bawaan
 * MapLibre juga bisa, tetapi ia membungkus isinya dengan DOM sendiri yang lebih
 * sulit diberi gaya dan tidak menerima fokus keyboard secara wajar.
 */
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
                className="grid h-5 w-5 place-items-center rounded-[3px] bg-ink text-[9px] font-bold tracking-tight text-surface shadow-[0_0_0_2px_var(--color-surface)]"
                aria-hidden
              >
                {s.moda === 'TERMINAL' ? 'T' : s.moda.slice(0, 1)}
              </span>
              <span className="whitespace-nowrap rounded-xs bg-surface/92 px-1.5 py-[2px] text-[10.5px] font-semibold shadow-[0_1px_3px_rgb(22_33_28/0.14)] backdrop-blur-sm">
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
