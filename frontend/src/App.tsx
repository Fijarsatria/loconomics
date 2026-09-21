
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'

import {
  BINGKAI_SEMUA,
  GAYA_BASEMAP,
  KERAPATAN_NAMA,
  KAWASAN_AWAL,
  KAWASAN_PILOT,
  KUADRAN,
  SEMUA_KAWASAN,
  ATRIBUSI_PETA,
  URUTAN_KUADRAN,
  LAYER,
  frasaKawasan,
  frasaPrestise,
  kodeLokasi,
  nomorLokasi,
  type NamaGaya,
  type NamaLayer,
  gayaSah,
} from './config'
import { BASEMAP_GELAP } from './lib/layer-peta'
import { api } from './lib/api'
import type {
  BedahBlok,
  ButirPantauan,
  DiagramKuadran,
  Kuadran as NamaKuadran,
  ProfilRute,
  SimpulTransit,
} from './types'
import DaftarLokasi from './components/DaftarLokasi'
import KompasKuadran from './components/KompasKuadran'
import Legenda from './components/Legenda'
import PanelAI from './components/PanelAI'
import PanelInsight from './components/PanelInsight'
const Gerbang = lazy(() => import('./components/Gerbang'))
import { PERISTIWA_BUKA_PETA, TombolAkun, useSesi, type DetailBukaPeta } from './components/Akun'
import { useBahasa, useNamaZona, useTema, useTeks, type Bahasa } from './lib/bahasa'
import { KabarPin, MenuKawasan } from './components/Premium'
const Rekomendasi = lazy(() => import('./components/Rekomendasi'))
// Kedua dialog ini besar dan jarang dibuka. MenuKawasan tetap statis - ia
// duduk di bilah atas dan harus ada sejak bingkai pertama.
const DialogKomparasi = lazy(() =>
  import('./components/Premium').then((m) => ({ default: m.DialogKomparasi })),
)
const DialogPantauan = lazy(() =>
  import('./components/Premium').then((m) => ({ default: m.DialogPantauan })),
)
const Simulasi = lazy(() => import('./components/Simulasi'))
const Pembuka = lazy(() => import('./components/Pembuka'))
// Dimuat saat dibuka, bukan di bundel pertama. Isinya `lib/ringkasan-data.ts`
// penuh - sumber, batasan, DAN keempat temuan berikut kalimatnya - dan itu
// berkas yang tumbuh tiap kali pipeline menemukan sesuatu.
const SumberData = lazy(() => import('./components/SumberData'))
import type { AksiPetaRef, KendaliPeta } from './components/PetaInteraktif'
const PetaInteraktif = lazy(() => import('./components/PetaInteraktif'))
import {
  Glif,
  Markah,
  Menu,
  MenuPengaturan,
  PapanNama,
  PilihBasemap,
  useTutupHalus,
} from './components/primitif'

/** Layer yang diwarnai menurut kuadran — hanya di sini Kompas benar. */
const LAYER_KUADRAN: NamaLayer[] = ['opportunity', 'hidden_gem']


/** Indeks H3 resolusi 9: 15 digit heksadesimal. Dipakai pencarian. */
const POLA_H3 = /^[0-9a-f]{15}$/i

// ---------------------------------------------------------------------------
// Keadaan tampilan yang bertahan melewati refresh
// ---------------------------------------------------------------------------

const KUNCI_TAMPILAN = 'loconomics.tampilan.v2'

/** Hanya menandai "sudah lewat gerbang di sesi ini". Sengaja di sessionStorage. */
const KUNCI_SESI = 'loconomics.sesi.v1'

interface TampilanTersimpan {
  masuk?: boolean
  kawasan?: string
  layer?: NamaLayer
  /** Apakah layer tematik menyala. Bawaannya mati — lihat state-nya di App. */
  layerNyala?: boolean
  namaTempat?: string
  gaya?: NamaGaya
  /** Mode 3D (kamera miring + gedung berdiri). */
  tigaDimensi?: boolean
}

function bersihkanKawasan(nilai: string | undefined): string | undefined {
  if (nilai === undefined) return undefined
  if (nilai === SEMUA_KAWASAN) return SEMUA_KAWASAN
  const sah = nilai.split(',').filter((n) => KAWASAN_PILOT.some((k) => k.nama === n))
  return sah.length ? sah.join(',') : undefined
}

function bacaSesiMasuk(): boolean {
  try {
    return sessionStorage.getItem(KUNCI_SESI) === '1'
  } catch {
    // Mode privat sebagian peramban melempar saat sessionStorage disentuh.
    // Jawaban yang aman "belum masuk": salah menuju gerbang cuma satu klik
    // tambahan, salah melewatinya menghilangkan perkenalan yang justru diminta.
    return false
  }
}

function tulisSesiMasuk(masuk: boolean): void {
  try {
    if (masuk) sessionStorage.setItem(KUNCI_SESI, '1')
    else sessionStorage.removeItem(KUNCI_SESI)
  } catch {
    /* mode privat; sesi ini tetap jalan, cuma tidak selamat dari refresh */
  }
}

function bacaTampilan(): TampilanTersimpan {
  try {
    const mentah = localStorage.getItem(KUNCI_TAMPILAN)
    if (!mentah) return {}
    const t = JSON.parse(mentah) as TampilanTersimpan
    // Divalidasi, bukan dipercaya. Isi localStorage bisa berasal dari versi
    // lama aplikasi ini - layer yang sudah dihapus akan membuat peta meminta
    // sesuatu yang tidak ada dan gagal tanpa keterangan.
    return {
      masuk: bacaSesiMasuk(),
      kawasan: bersihkanKawasan(t.kawasan),
      layer: t.layer && t.layer in LAYER ? t.layer : undefined,
      layerNyala: typeof t.layerNyala === 'boolean' ? t.layerNyala : undefined,
      namaTempat: t.namaTempat && t.namaTempat in KERAPATAN_NAMA ? t.namaTempat : undefined,
      gaya: t.gaya && t.gaya in GAYA_BASEMAP ? t.gaya : undefined,
      // Ditulis DAN dibaca sejak lahir - pelajaran `layerNyala` di atas.
      tigaDimensi: typeof t.tigaDimensi === 'boolean' ? t.tigaDimensi : undefined,
    }
  } catch {
    // JSON rusak, atau mode privat yang melempar. Keduanya berarti hal yang
    // sama untuk pemanggil: mulai dari awal.
    return {}
  }
}

const AWAL = bacaTampilan()

const URUTAN_TAB = ['rekomendasi', 'daftar', 'ai'] as const
type NamaTab = (typeof URUTAN_TAB)[number]

const URUTAN_NAV: readonly NamaTab[] = ['rekomendasi', 'ai', 'daftar']

function IkonNav({ k, ukuran }: { k: NamaTab; ukuran: number }) {
  const p = {
    width: ukuran,
    height: ukuran,
    viewBox: '0 0 20 20',
    'aria-hidden': true,
    className: 'shrink-0',
  }
  if (k === 'ai')
    return (
      <svg {...p}>
        <path d="M10 2.4l1.9 4.6 4.6 1.9-4.6 1.9L10 15.4l-1.9-4.6L3.5 8.9l4.6-1.9z" fill="currentColor" />
        <path d="M4 14.2l.8 1.9 1.9.8-1.9.8L4 19.6l-.8-1.9-1.9-.8 1.9-.8z" fill="currentColor" opacity="0.75" />
      </svg>
    )
  if (k === 'rekomendasi')
    return (
      <svg {...p}>
        <circle cx="8" cy="6.6" r="3" fill="currentColor" />
        <path d="M2.8 16.6a5.2 5.2 0 0 1 10.4 0Z" fill="currentColor" />
        <path d="M15.6 2.8l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" fill="currentColor" />
      </svg>
    )
  return (
    <svg {...p}>
      <circle cx="4.6" cy="5.4" r="1.7" fill="currentColor" />
      <circle cx="4.6" cy="10" r="1.7" fill="currentColor" />
      <circle cx="4.6" cy="14.6" r="1.7" fill="currentColor" />
      <path
        d="M9 5.4h7M9 10h7M9 14.6h4.6"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Pencarian
// ---------------------------------------------------------------------------

type Hasil =
  | { jenis: 'kawasan'; nama: string; moda: string }
  | { jenis: 'simpul'; simpul: SimpulTransit }
  | { jenis: 'heksagon'; h3: string }

const K_APP: Record<
  Bahasa,
  {
    cari: string
    kembaliGerbang: string
    tanpaLayer: string
    tabRekomendasi: string
    tabDaftar: string
    tabAI: string
    navUntuk: string
    navLokasi: string
    navAI: string
    navBeranda: string
    navAkun: string
    navBawah: string
    lipat: string
    bukaPanel: string
    bukaPanelDaftar: string
    bukaDaftar: string
    atribusiJudul: string
    atribusiCatatan: string
    kembaliDaftar: string
    klikLain: string
    kosongkanBaki: string
    kosongkanBakiPanjang: string
    bandingkan: (n: number) => string
    tersimpan: string
    tersimpanPanjang: string
    simpanMasuk: string
    simpanPremium: string
    takCocok: string
    simulasiDiSini: string
    premium: string
    lepasPilihan: string
    lepasPilihanPanjang: string
    heksagon: (n: string) => string
    kosongJudul: (k: string) => string
    kosongIsi: string
    locale: string
    tutup: string
    sumberData: string
    diagramKuadran: string
    diagramJudul: (k: string) => string
    diagramIsi: string
    caraBaca: string
    caraBaca1: ReactNode
    caraBaca2: string
    sebarKuadran: string
    kuadranJumlah: (n: number, p: string) => string
    diagramBatas: (x: string, y: string) => string
    sumbuDatarApa: string
    diagramKaki: (n: string) => string
    memuatTitik: string
    ajakanJudul: string
    ajakanIsi: string
    nanti: string
    jadiPremium: string
    daftarSekarang: string
    ajakanLangganan: string
    ajakanMasuk: string
    basemap: Record<string, string>
    tigaDimensiNyala: string
    tigaDimensiMati: string
  }
> = {
  id: {
    cari: 'Cari stasiun, kawasan, atau indeks H3…',
    kembaliGerbang: 'Kembali ke halaman perkenalan',
    tanpaLayer: 'Tanpa layer',
    tabRekomendasi: 'Untuk Anda',
    tabDaftar: 'Daftar lokasi',
    tabAI: 'Loconomics AI',
    navUntuk: 'Untuk Anda',
    navLokasi: 'Lokasi',
    navAI: 'AI',
    navBeranda: 'Beranda',
    navAkun: 'Akun',
    navBawah: 'Navigasi utama',
    lipat: 'Lipat panel',
    bukaPanel: 'Buka panel',
    bukaPanelDaftar: 'Buka panel daftar lokasi',
    bukaDaftar: 'Buka daftar lokasi',
    atribusiJudul: 'Sumber peta',
    atribusiCatatan:
      'Rincian metodologi, cakupan, dan batasannya ada di menu Pengaturan → “Metodologi & sumber data”.',
    kembaliDaftar: 'Kembali ke daftar lokasi',
    klikLain: 'Klik heksagon lain di peta untuk membandingkan',
    kosongkanBaki: 'Kosongkan baki',
    kosongkanBakiPanjang: 'Kosongkan baki komparasi',
    bandingkan: (n) => `Bandingkan ${n}`,
    tersimpan: 'Lokasi tersimpan',
    tersimpanPanjang: 'Lokasi tersimpan dan dinamika kawasan',
    simpanMasuk: 'Buat akun dulu untuk menyimpan lokasi.',
    simpanPremium: 'Menyimpan dan memantau lokasi bagian dari Loconomics Premium.',
    takCocok:
      'Tidak ada yang cocok. Pencarian hanya mengenali kawasan pilot, simpul transit, dan indeks H3.',
    simulasiDiSini: 'Simulasi usaha di lokasi ini',
    premium: 'Premium',
    lepasPilihan: 'Lepas pilihan (Esc)',
    lepasPilihanPanjang: 'Lepas pilihan heksagon',
    heksagon: (n: string) => `${n} heksagon`,
    kosongJudul: (k: string) => `Belum ada heksagon di ${k}`,
    kosongIsi:
      'Basis datanya sudah tersambung, tetapi kawasan ini belum berisi. Jalankan pipeline sampai tahap terbit untuk mengisinya.',
    locale: 'id-ID',
    tutup: 'Tutup',
    sumberData: 'Sumber data',
    diagramKuadran: 'Diagram kuadran',
    diagramJudul: (k: string) => `Diagram kuadran · ${k}`,
    diagramIsi:
      'Sumbu datar: bagaimana lokasi terlihat. Sumbu tegak: apa kata datanya. Gunanya produk ini ada di dua sudut tempat keduanya tidak sejalan.',
    caraBaca: 'Cara membacanya',
    caraBaca1: (
      <>
        Sumbu tegak Opportunity Score, sumbu datar prestise visual. Batas keduanya{' '}
        <strong className="font-semibold text-ink">median</strong> — bukan angka bulat.
      </>
    ),
    caraBaca2: '',
    sebarKuadran: 'Sebaran kuadran',
    kuadranJumlah: (n: number, p: string) => `${n} heksagon · ${p}%`,
    diagramBatas: (x: string, y: string) => `Median prestise ${x} · median skor ${y}`,
    sumbuDatarApa: 'Sumbu datar berdiri di atas apa',
    diagramKaki: (n: string) =>
      `${n} heksagon. Klik satu titik untuk membukanya. Area berzona terlarang sengaja ikut ditampilkan — ini alat analisis, bukan rekomendasi.`,
    memuatTitik: 'Memuat titik…',
    ajakanJudul: 'Simpan & pantau lokasi',
    ajakanIsi:
      'Simpan lokasi pilihan Anda sebagai pin di peta, bekukan skornya hari ini, lalu lihat pergerakannya setiap kali pipeline menerbitkan versi baru — lengkap dengan sebaran churn kawasannya.',
    nanti: 'Nanti saja',
    jadiPremium: 'Jadi Premium',
    daftarSekarang: 'Sign Up sekarang',
    ajakanLangganan: 'Pemantauan bagian dari Loconomics Premium.',
    ajakanMasuk: 'Buat akun dulu untuk mulai memantau lokasi.',
    basemap: { terang: 'Terang', dasar: 'Jalan', gelap: 'Gelap', satelit: 'Satelit' },
    tigaDimensiNyala: 'Kembali ke peta datar',
    tigaDimensiMati: 'Tampilan 3D - gedung berdiri',
  },
  en: {
    cari: 'Search a station, area, or H3 index…',
    kembaliGerbang: 'Back to the intro page',
    tanpaLayer: 'No layer',
    tabRekomendasi: 'For you',
    tabDaftar: 'Locations',
    tabAI: 'Loconomics AI',
    navUntuk: 'For you',
    navLokasi: 'Places',
    navAI: 'AI',
    navBeranda: 'Home',
    navAkun: 'Account',
    navBawah: 'Main navigation',
    lipat: 'Collapse panel',
    bukaPanel: 'Open panel',
    bukaPanelDaftar: 'Open the locations panel',
    bukaDaftar: 'Open the location list',
    atribusiJudul: 'Map sources',
    atribusiCatatan:
      'Methodology, coverage, and their limits live in the Settings menu → “Methodology & data sources”.',
    kembaliDaftar: 'Back to the list',
    klikLain: 'Click another hexagon on the map to compare',
    kosongkanBaki: 'Clear tray',
    kosongkanBakiPanjang: 'Clear the comparison tray',
    bandingkan: (n) => `Compare ${n}`,
    tersimpan: 'Saved locations',
    tersimpanPanjang: 'Saved locations and area dynamics',
    simpanMasuk: 'Create an account first to save locations.',
    simpanPremium: 'Saving and watching locations is part of Loconomics Premium.',
    takCocok:
      'Nothing matches. The search only knows the pilot areas, the transit nodes, and H3 indexes.',
    simulasiDiSini: 'Simulate a business here',
    premium: 'Premium',
    lepasPilihan: 'Clear the selection (Esc)',
    lepasPilihanPanjang: 'Clear the selected hexagon',
    heksagon: (n: string) => `${n} hexagons`,
    kosongJudul: (k: string) => `No hexagons in ${k} yet`,
    kosongIsi:
      'The database is connected, but this area has nothing in it yet. Run the pipeline through the publish stage to fill it.',
    locale: 'en-GB',
    tutup: 'Close',
    sumberData: 'Data sources',
    diagramKuadran: 'Quadrant diagram',
    diagramJudul: (k: string) => `Quadrant diagram · ${k}`,
    diagramIsi:
      'Horizontal axis: how a location looks. Vertical axis: what its data says. This product earns its keep in the two corners where the two disagree.',
    caraBaca: 'How to read it',
    caraBaca1: (
      <>
        The vertical axis is the Opportunity Score, the horizontal axis visual prestige. The
        boundary on both is the <strong className="font-semibold text-ink">median</strong> —
        not a round number.
      </>
    ),
    caraBaca2: '',
    sebarKuadran: 'Quadrant spread',
    kuadranJumlah: (n: number, p: string) => `${n} hexagons · ${p}%`,
    diagramBatas: (x: string, y: string) => `Prestige median ${x} · score median ${y}`,
    sumbuDatarApa: 'What the horizontal axis stands on',
    diagramKaki: (n: string) =>
      `${n} hexagons. Click a point to open it. Locations in prohibited zones are shown on purpose — this is an analysis tool, not a recommendation.`,
    memuatTitik: 'Loading points…',
    ajakanJudul: 'Save & watch locations',
    ajakanIsi:
      'Save the locations you choose as pins on the map, freeze their score today, then watch them move every time the pipeline publishes a new version — area churn spread included.',
    nanti: 'Not now',
    jadiPremium: 'Go Premium',
    daftarSekarang: 'Sign up now',
    ajakanLangganan: 'Watching locations is part of Loconomics Premium.',
    ajakanMasuk: 'Create an account first to start watching locations.',
    basemap: { terang: 'Light', dasar: 'Street', gelap: 'Dark', satelit: 'Satellite' },
    tigaDimensiNyala: 'Back to the flat map',
    tigaDimensiMati: '3D view - standing buildings',
  },
}

function Cari({
  simpul,
  onPilihKawasan,
  onPilihSimpul,
  onPilihHeksagon,
  kelas = '',
}: {
  simpul: SimpulTransit[]
  onPilihKawasan: (nama: string) => void
  onPilihSimpul: (s: SimpulTransit) => void
  onPilihHeksagon: (h3: string) => void
  /* Kelas tambahan dari pemanggil. Dipakai App untuk menaruh pencarian di
     baris pertama grid bilah atas di layar sempit tanpa menyentuh desktop. */
  kelas?: string
}) {
  const t = useTeks(K_APP)
  const [q, setQ] = useState('')
  const [buka, setBuka] = useState(false)
  const [sorot, setSorot] = useState(0)
  const wadah = useRef<HTMLDivElement>(null)

  const hasil = useMemo<Hasil[]>(() => {
    const t = q.trim().toLowerCase()
    if (!t) return []
    const keluar: Hasil[] = []
    if (POLA_H3.test(t)) keluar.push({ jenis: 'heksagon', h3: t })
    for (const k of KAWASAN_PILOT)
      if (k.nama.toLowerCase().includes(t))
        keluar.push({ jenis: 'kawasan', nama: k.nama, moda: k.moda })
    for (const s of simpul)
      if (s.nama.toLowerCase().includes(t)) keluar.push({ jenis: 'simpul', simpul: s })
    return keluar.slice(0, 8)
  }, [q, simpul])

  useEffect(() => {
    if (!buka) return
    const luar = (e: MouseEvent) => {
      if (!wadah.current?.contains(e.target as Node)) setBuka(false)
    }
    document.addEventListener('mousedown', luar)
    return () => document.removeEventListener('mousedown', luar)
  }, [buka])

  const jalankan = (h: Hasil) => {
    if (h.jenis === 'kawasan') onPilihKawasan(h.nama)
    else if (h.jenis === 'simpul') onPilihSimpul(h.simpul)
    else onPilihHeksagon(h.h3)
    setQ('')
    setBuka(false)
  }

  return (
    <div ref={wadah} className={`relative min-w-0 flex-1 md:max-w-[19rem] ${kelas}`}>
      <div className="fokus-pil flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3.5 py-1.5 transition-colors focus-within:border-line-2 focus-within:bg-surface">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="shrink-0 text-ink-3">
          <circle cx="6" cy="6" r="4.3" stroke="currentColor" strokeWidth="1.6" fill="none" />
          <path d="M9.3 9.3 12.5 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setSorot(0)
            setBuka(true)
          }}
          onFocus={() => setBuka(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') return setBuka(false)
            if (!hasil.length) return
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSorot((i) => (i + 1) % hasil.length)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSorot((i) => (i - 1 + hasil.length) % hasil.length)
            } else if (e.key === 'Enter') {
              e.preventDefault()
              jalankan(hasil[sorot])
            }
          }}
          placeholder={t.cari}
          aria-label={t.cari}
          className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-ink-3 focus-visible:outline-none"
        />
        {q && (
          <button
            onClick={() => {
              setQ('')
              setBuka(false)
            }}
            aria-label="Kosongkan pencarian"
            className="shrink-0 cursor-pointer text-[15px] leading-none text-ink-3 transition-colors hover:text-ink"
          >
            ×
          </button>
        )}
      </div>

      {buka && q.trim() && (
        <ul className="kaca-tebal pop absolute left-0 top-[calc(100%+8px)] z-50 w-full min-w-[17rem] overflow-hidden rounded-md p-1.5">
          {hasil.length === 0 && (
            <li className="px-3 py-2.5 text-[13px] text-ink-3">{t.takCocok}</li>
          )}
          {hasil.map((h, i) => (
            <li key={`${h.jenis}-${i}`}>
              <button
                onMouseEnter={() => setSorot(i)}
                onClick={() => jalankan(h)}
                className={`flex w-full cursor-pointer items-baseline gap-2.5 rounded-sm px-3 py-2 text-left transition-colors ${
                  i === sorot ? 'bg-surface-2' : ''
                }`}
              >
                <span className="eyebrow shrink-0">
                  {h.jenis === 'kawasan' ? 'Kawasan' : h.jenis === 'simpul' ? 'Simpul' : 'H3'}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
                  {h.jenis === 'kawasan'
                    ? h.nama
                    : h.jenis === 'simpul'
                      ? h.simpul.nama
                      : h.h3}
                </span>
                <span className="shrink-0 text-[12px] text-ink-3">
                  {h.jenis === 'kawasan'
                    ? h.moda
                    : h.jenis === 'simpul'
                      ? `${h.simpul.moda} · ${h.simpul.kawasan}`
                      : 'buka heksagon'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Empat kolom sudah tidak muat di layar mana pun tanpa digulir menyamping. */
const MAKS_BANDING = 4

function BarKomparasi({
  baki,
  skor,
  onLepas,
  onKosongkan,
  onBuka,
  onSorot,
}: {
  baki: string[]
  skor: Map<string, { kawasan: string; skor: number | null; kuadran: NamaKuadran | null }>
  onLepas: (h3: string) => void
  onKosongkan: () => void
  onBuka: () => void
  onSorot: (h3: string) => void
}) {
  const t = useTeks(K_APP)
  const siap = baki.length >= 2
  return (
    <div className="kaca-tebal pointer-events-auto flex w-full max-w-[54rem] items-stretch gap-1 rounded-xl p-1.5 shadow-lg">
      <div className="flex min-w-0 flex-1 items-stretch gap-1">
        {baki.map((h3, i) => {
          const d = skor.get(h3)
          const q = d?.kuadran ? KUADRAN[d.kuadran] : null
          return (
            <div
              key={h3}
              className="group relative flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-surface-2"
              style={{ background: q ? `color-mix(in srgb, ${q.lembut} 55%, transparent)` : undefined }}
            >
              <button
                onClick={() => onSorot(h3)}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                title="Buka di peta"
              >
                {/* Nomor yang SAMA dengan lencana di peta. */}
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-bold text-surface">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="papan tabular text-[17px] leading-none">
                      {d?.skor === null || d?.skor === undefined ? '—' : d.skor.toFixed(0)}
                    </span>
                    {d?.kuadran && <Glif kuadran={d.kuadran} ukuran={9} />}
                  </span>
                  <span className="mt-0.5 block truncate text-[10.5px] leading-tight text-ink-3">
                    {d ? kodeLokasi(h3, d.kawasan) : nomorLokasi(h3)}
                  </span>
                </span>
              </button>
              <button
                onClick={() => onLepas(h3)}
                aria-label={`Keluarkan lokasi ${i + 1}`}
                title="Keluarkan"
                className="grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-full text-[13px] leading-none text-ink-3 opacity-0 transition-all hover:bg-bahaya-soft hover:text-bahaya group-hover:opacity-100"
              >
                x
              </button>
            </div>
          )
        })}

        {/* Slot kosong: bar yang menyusut tiap kali satu dikeluarkan terasa
            goyah. Slot bergaris putus-putus menahan bentuknya sekaligus
            mengatakan masih ada tempat. */}
        {baki.length < 2 && (
          <div className="flex min-w-0 flex-1 items-center justify-center rounded-lg border border-dashed border-line-2 px-3 py-1.5 text-center text-[11.5px] leading-snug text-ink-3">
            {t.klikLain}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 border-l border-line/70 pl-1.5">
        <button
          onClick={onKosongkan}
          title={t.kosongkanBaki}
          aria-label={t.kosongkanBakiPanjang}
          className="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden>
            <path d="M5 5l10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <button
          onClick={onBuka}
          disabled={!siap}
          className="flex cursor-pointer items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[13.5px] font-semibold text-surface transition-transform duration-300 ease-jelly hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
        >
          <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden className="shrink-0">
            <path d="M4 15V8M10 15V4M16 15v-5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
          </svg>
          {t.bandingkan(baki.length)}
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const t = useTeks(K_APP)
  const { bahasa } = useBahasa()
  const namaZona = useNamaZona()
  const [kawasan, setKawasan] = useState<string>(AWAL.kawasan ?? KAWASAN_AWAL.nama)
  const [layer, setLayer] = useState<NamaLayer>(AWAL.layer ?? 'opportunity')
  const [layerNyala, setLayerNyala] = useState(AWAL.layerNyala ?? true)
  const [namaTempat, setNamaTempat] = useState<string>(AWAL.namaTempat ?? 'normal')
  const { tema, gantiTema } = useTema()
  const [rutaTampil, setRutaTampil] = useState(false)
  const [gaya, setGaya] = useState<NamaGaya>(
    // `gayaSah` MEMETAKAN gaya yang sudah dipensiunkan, tidak membuangnya:
    // orang yang terakhir memakai "Jalan 2D" harus mendarat di "Jalan",
    // bukan dilempar ke bawaan yang tidak pernah ia pilih.
    (AWAL.gaya ? (gayaSah(AWAL.gaya) as NamaGaya) : undefined) ?? (tema === 'terang' ? 'dasar' : 'gelap'),
  )
  /** Mode 3D. Bawaannya datar: peta analitik dibaca dari atas, 3D dipilih sadar. */
  const [tigaDimensi, setTigaDimensi] = useState<boolean>(AWAL.tigaDimensi ?? false)
  const [hexTerpilih, setHexTerpilih] = useState<string | null>(null)

  const [blok, setBlok] = useState<BedahBlok | null>(null)
  const [blokTerpilih, setBlokTerpilih] = useState<string | null>(null)
  /** Blok yang sedang disimulasikan. Kosong = simulasi seluruh heksagon. */
  const [blokSimulasi, setBlokSimulasi] = useState<string | null>(null)

  useEffect(() => {
    setRutaTampil(false)
    setBlok(null)
    setBlokTerpilih(null)
    setBlokSimulasi(null)
  }, [hexTerpilih])

  const gantiGaya = useCallback(
    (g: NamaGaya) => {
      setGaya(g)
      const petaGelap = BASEMAP_GELAP.includes(g)
      if ((petaGelap ? 'gelap' : 'terang') !== tema) gantiTema()
    },
    [tema, gantiTema],
  )

  const gayaTerakhir = useRef<NamaGaya | null>(null)
  useEffect(() => {
    if (gaya !== 'satelit') gayaTerakhir.current = gaya
  }, [gaya])
  const kembalikanGaya = useCallback(() => {
    const g = gayaTerakhir.current
    if (!g) return
    setGaya(g)
    // Temanya ikut dikembalikan: satelit tidak punya versi gelap/terang, jadi
    // memilihnya tidak mengubah tema - tetapi peta yang kembali ke vektor tetap
    // harus segaya dengan chrome yang sedang terpasang.
    const petaGelap = BASEMAP_GELAP.includes(g)
    if ((petaGelap ? 'gelap' : 'terang') !== tema) gantiTema()
  }, [tema, gantiTema])

  const [saringKuadran, setSaringKuadran] = useState<NamaKuadran | null>(null)
  const [nHeksagon, setNHeksagon] = useState<number | null>(null)
  const [kuadranPenuh, setKuadranPenuh] = useState(false)
  const [sumberTerbuka, setSumberTerbuka] = useState(false)
  /** Pop-up "sumber peta": pengganti panel bawaan MapLibre yang menganga. */
  const [atribusiTerbuka, setAtribusiTerbuka] = useState(false)

  /** Penanda "sedang menutup" untuk dua dialog di atas peta; elemennya ditahan
   *  terpasang selama animasinya, jadi menutupnya tidak lagi hilang seketika. */
  const [menutupSumber, setMenutupSumber] = useState(false)
  const [menutupKuadran, setMenutupKuadran] = useState(false)
  const tutupSumber = useCallback(() => {
    setMenutupSumber(true)
    window.setTimeout(() => {
      setSumberTerbuka(false)
      setMenutupSumber(false)
    }, 200)
  }, [])
  const tutupKuadran = useCallback(() => {
    setMenutupKuadran(true)
    window.setTimeout(() => {
      setKuadranPenuh(false)
      setMenutupKuadran(false)
    }, 200)
  }, [])
  // Daftar dulu, detail belakangan. Pertanyaan pertama pengguna adalah "yang mana
  // yang harus saya lihat", bukan "bagaimana lokasi ini" - dan layar kosong yang
  // menyuruh mengklik heksagon menjawab pertanyaan yang belum diajukan.
  const [tab, setTab] = useState<NamaTab>('daftar')
  const [tabDikunjungi, setTabDikunjungi] = useState<ReadonlySet<NamaTab>>(() => new Set([tab]))
  if (!tabDikunjungi.has(tab)) setTabDikunjungi(new Set([...tabDikunjungi, tab]))
  const [panelTerbuka, setPanelTerbuka] = useState(
    () => typeof window === 'undefined' || window.matchMedia('(min-width: 1024px)').matches,
  )
  const [tingkat, setTingkat] = useState<'ringkas' | 'setengah' | 'penuh'>('setengah')
  /* Titik sentuh awal + penanda "barusan digeser", supaya klik setelah seretan
     tidak ikut membalik keadaan. Lihat penangan di kepala lembar. */
  const mulaiLembar = useRef(0)
  const geserLembar = useRef(false)
  const [tinggiSeret, setTinggiSeret] = useState<number | null>(null)
  const [seretLembar, setSeretLembar] = useState(false)
  const lembarRef = useRef<HTMLElement>(null)
  const tinggiAwal = useRef(0)
  const tinggiKini = useRef(0)

  /** Tinggi keadaan PENUH, dihitung sama dengan `.lembar-peta[data-tingkat='penuh']`. */
  const tinggiPenuhLembar = useCallback(() => {
    const probe = document.createElement('div')
    probe.style.cssText =
      'position:fixed;left:0;bottom:0;width:0;height:env(safe-area-inset-bottom)'
    document.body.appendChild(probe)
    const safe = probe.getBoundingClientRect().height
    probe.remove()
    return window.innerHeight - 10.5 * 16 - safe
  }, [])

  /** Tinggi tiap tingkat dalam piksel - satu sumber untuk snap dan tabrakan. */
  const tinggiTingkat = useCallback(
    (t: 'ringkas' | 'setengah' | 'penuh') =>
      t === 'ringkas'
        ? window.innerHeight * 0.26
        : t === 'setengah'
          ? window.innerHeight * 0.5
          : tinggiPenuhLembar(),
    [tinggiPenuhLembar],
  )

  const isiLembar = useRef('')
  useEffect(() => {
    if (!panelTerbuka) {
      isiLembar.current = ''
      return
    }
    const isi = `${tab}:${tab === 'daftar' && hexTerpilih ? 'detail' : 'daftar'}`
    if (isi === isiLembar.current) return
    isiLembar.current = isi
    setTingkat(tab === 'daftar' && hexTerpilih ? 'ringkas' : 'setengah')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelTerbuka, tab, hexTerpilih])

  const seretMulai = (e: React.PointerEvent<HTMLButtonElement>) => {
    const el = lembarRef.current
    if (!el) return
    mulaiLembar.current = e.clientY
    geserLembar.current = false
    tinggiAwal.current = el.getBoundingClientRect().height
    tinggiKini.current = tinggiAwal.current
    setSeretLembar(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const seretGerak = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!seretLembar) return
    const dy = e.clientY - mulaiLembar.current
    if (Math.abs(dy) > 6) geserLembar.current = true
    const penuh = tinggiPenuhLembar()
    const h = Math.max(window.innerHeight * 0.12, Math.min(penuh, tinggiAwal.current - dy))
    tinggiKini.current = h
    setTinggiSeret(h)
  }

  const seretLepas = () => {
    if (!seretLembar) return
    setSeretLembar(false)
    // Jari tidak bergerak: biarkan `onClick` yang membalik ringkas/penuh.
    if (!geserLembar.current) {
      setTinggiSeret(null)
      return
    }
    const h = tinggiKini.current
    const titik: Array<'ringkas' | 'setengah' | 'penuh'> = ['ringkas', 'setengah', 'penuh']
    const ringkas = tinggiTingkat('ringkas')
    if (h < ringkas - 40) {
      // Seret turun cukup jauh: tutup dengan gerakan, bukan lenyap seketika.
      setTinggiSeret(tinggiPenuhLembar() * 0.04)
      window.setTimeout(() => {
        setTinggiSeret(null)
        setPanelTerbuka(false)
      }, 240)
      return
    }
    // Snap ke tingkat dengan SELISIH TERKECIL, bukan ke ambang tetap: dengan
    // tiga titik, ambang tetap akan membuat seretan dari penuh ke setengah
    // mendarat di tempat yang tidak dipilih siapa pun.
    let terdekat: 'ringkas' | 'setengah' | 'penuh' = 'setengah'
    let selisih = Infinity
    for (const t of titik) {
      const d = Math.abs(tinggiTingkat(t) - h)
      if (d < selisih) {
        selisih = d
        terdekat = t
      }
    }
    setTingkat(terdekat)
    setTinggiSeret(null)
  }
  // Bawaannya TERTUTUP sejak 24 Agustus 2026 - keputusan pemilik repo: layar
  // pertama harus milik petanya. Kompas tetap satu klik jauhnya, dan tombolnya
  // duduk persis di tempat kartunya akan muncul.
  const [panelKiri, setPanelKiri] = useState<'tidak' | 'kartu' | 'basemap'>('tidak')
  const panelKiriTerbuka = panelKiri === 'kartu'
  const [filterTerbuka, setFilterTerbuka] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)
  const { tampil: filterTampil, menutup: filterMenutup } = useTutupHalus(filterTerbuka)
  const [diagram, setDiagram] = useState<DiagramKuadran | null>(null)
  const [simpul, setSimpul] = useState<SimpulTransit[]>([])
  const [pembuka, setPembuka] = useState(false)
  const [gerbang, setGerbang] = useState(!AWAL.masuk)

  useEffect(() => {
    document.body.classList.toggle('peta-gelap', tema === 'gelap')
    return () => document.body.classList.remove('peta-gelap')
  }, [tema])

  const temaSebelum = useRef(tema)
  useEffect(() => {
    if (temaSebelum.current === tema) return
    temaSebelum.current = tema
    setGaya((g) => {
      // Satelit tidak punya versi terang atau gelap - citra adalah citra. Orang
      // yang memilihnya lalu mengganti tema sedang mengganti warna CHROME, dan
      // melempar petanya ke gaya vektor akan membatalkan pilihan yang disengaja.
      if (g === 'satelit') return g
      if (tema === 'gelap') return g === 'gelap' ? g : 'gelap'
      return g === 'gelap' ? 'dasar' : g
    })
  }, [tema])
  /** Arah kompas & kemiringan peta. Tombol pelurus muncul hanya kalau miring. */
  const [arahPeta, setArahPeta] = useState({ bearing: 0, pitch: 0 })
  /** Simulasi terbuka di atas detail heksagon. Ditutup saat heksagon berganti. */
  const [simulasiTerbuka, setSimulasiTerbuka] = useState(false)
  /** Heksagon pembanding di simulasi, dipilih dengan mengklik peta. */
  const [hexBanding, setHexBanding] = useState<string | null>(null)

  // Tiap moda di layar persis satu profil tersimpan sejak sepeda menggantikan
  // motor - lihat `ProfilRute` di types.ts.
  const [profilRute, setProfilRute] = useState<ProfilRute>('foot-walking')

  const {
    premium,
    akun,
    mintaLangganan,
    mintaMasuk,
    mintaPreferensi,
    sinyalSimpan,
    catatSimpan,
    tersimpan,
  } = useSesi()


  const [kabarPin, setKabarPin] = useState<{ h3: string; baru: boolean; kunci: number } | null>(null)

  /** Daftar pin yang sedang tergambar - sumber kebenaran di sisi layar. */
  const pinKini = useRef<
    { lat: number; lon: number; h3: string; label: string; sendiri: boolean }[]
  >([])

  const pasangPin = useCallback((b: ButirPantauan[]) => {
    const daftar = b
      .filter(
        (x): x is typeof x & { lat: number; lon: number } => x.lat !== null && x.lon !== null,
      )
      .map((x) => ({
        lat: x.lat,
        lon: x.lon,
        h3: x.h3_index,
        label: x.nama ?? kodeLokasi(x.h3_index, x.kawasan ?? ''),
        sendiri: x.titik_sendiri,
      }))
    pinKini.current = daftar
    peta.current?.setPin(daftar)
  }, [])

  const taruhPin = useCallback(
    async (h3: string, lat: number, lon: number) => {
      const baru = !tersimpan.has(h3)
      // Pin digambar SEKETIKA, dari titik yang baru saja diklik. Versi
      // sebelumnya menunggu POST selesai lalu dua penyegaran daftar, jadi
      // tombolnya terasa mati beberapa detik di jaringan lambat.
      const lain = pinKini.current.filter((p) => p.h3 !== h3)
      pinKini.current = [
        ...lain,
        { lat, lon, h3, label: kodeLokasi(h3, kawasan), sendiri: true },
      ]
      peta.current?.setPin(pinKini.current)
      try {
        const item = await api.pantau(h3, { lat, lon })
        // Jawaban server yang berwenang soal nama dan titiknya; di sini cuma
        // labelnya yang mungkin berubah.
        pinKini.current = pinKini.current.map((p) =>
          p.h3 === item.h3_index
            ? {
                ...p,
                label: item.nama ?? kodeLokasi(item.h3_index, item.kawasan ?? ''),
                sendiri: item.titik_sendiri,
              }
            : p,
        )
        peta.current?.setPin(pinKini.current)
        catatSimpan()
        setKabarPin({ h3, baru, kunci: Date.now() })
      } catch {
        // Satu-satunya sebab yang wajar: titik jatuh tepat di tepi heksagon.
        // Daftarnya dikembalikan ke keadaan server supaya pin hantu tidak
        // tertinggal di peta.
        api
          .pantauan()
          .then(pasangPin)
          .catch(() => {})
      }
    },
    [tersimpan, catatSimpan, pasangPin, kawasan],
  )
  const [baki, setBaki] = useState<string[]>([])
  const [komparasiTerbuka, setKomparasiTerbuka] = useState(false)
  const [pantauanTerbuka, setPantauanTerbuka] = useState(false)

  const tambahBaki = useCallback((h3: string) => {
    setBaki((b) => {
      if (b.includes(h3)) return b.filter((x) => x !== h3)
      if (b.length >= MAKS_BANDING) return b
      if (b.length === 0) setPanelTerbuka(false)
      return [...b, h3]
    })
  }, [])

  const bukaSimulasi = useCallback(() => {
    // Simulasi usaha BERBAYAR sejak 24 Agustus 2026. Penjaga backend-nya di
    // /hex/{h3}/simulasi; yang di sini cuma pintunya - non-pelanggan diarahkan
    // ke dialog langganan alih-alih ke lembar yang seluruh permintaannya 401.
    if (!premium) {
      if (akun) mintaLangganan('Simulasi usaha bagian dari Loconomics Premium.')
      else mintaMasuk('Buat akun dulu untuk menjalankan simulasi usaha.')
      return
    }
    setBlokSimulasi(null)
    setSimulasiTerbuka(true)
    setPanelTerbuka(false)
  }, [premium, akun, mintaLangganan, mintaMasuk])

  /** Simulasi yang dipersempit ke SATU blok, dari rincian bedah blok. */
  const bukaSimulasiBlok = useCallback(
    (h3Blok: string) => {
      if (!premium) {
        if (akun) mintaLangganan('Simulasi usaha bagian dari Loconomics Premium.')
        else mintaMasuk('Buat akun dulu untuk menjalankan simulasi usaha.')
        return
      }
      setBlokSimulasi(h3Blok)
      setBlokTerpilih(h3Blok)
      setSimulasiTerbuka(true)
      setPanelTerbuka(false)
    },
    [premium, akun, mintaLangganan, mintaMasuk],
  )
  const peta = useRef<AksiPetaRef>(null)

  const tutupPembuka = useCallback(() => setPembuka(false), [])

  /** Fase tirai pulang. Lihat `keLanding` di bawah. */
  const [pulang, setPulang] = useState<'tutup' | 'buka' | null>(null)
  const jamPulang = useRef<number[]>([])
  /** Janji unduhan chunk tidak bisa dibatalkan seperti jam; yang dicek bendera ini. */
  const hidupPulang = useRef(true)
  useEffect(() => {
    hidupPulang.current = true
    // Larik yang sama yang diisi `push` - ditangkap di sini, bukan dibaca ulang
    // dari ref saat pembersihan.
    const jam = jamPulang.current
    return () => {
      hidupPulang.current = false
      jam.forEach((j) => window.clearTimeout(j))
    }
  }, [])

  const keLokasiAI = useCallback(
    (h3: string, kawasanLokasi?: string) => {
      if (
        kawasanLokasi &&
        kawasan !== SEMUA_KAWASAN &&
        !kawasan.split(',').includes(kawasanLokasi)
      ) {
        setKawasan(kawasanLokasi)
        setNHeksagon(null)
      }
      setHexTerpilih(h3)
      setHexBanding(null)
      setSimulasiTerbuka(false)
      setPanelTerbuka(true)
      setTab('daftar')
      peta.current?.highlight([h3])
      peta.current?.fokusHeksagon(h3)
    },
    [kawasan],
  )

  const keLanding = useCallback(() => {
    const selesaikan = () => {
      setGerbang(true)
      setHexTerpilih(null)
      setSimulasiTerbuka(false)
      tulisSesiMasuk(false)
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      selesaikan()
      return
    }
    setPulang('tutup')
    // Gagal mengunduh tidak boleh menahan tirai selamanya: Suspense di bawah
    // yang akan menanganinya, sama seperti sebelum tirai ini ada.
    const chunk = import('./components/Gerbang').catch(() => null)
    const tertutup = new Promise<void>((r) => {
      // 520ms: sinkron dengan durasi `pulang-tumbuh` di index.css. Angka yang
      // lebih pendek membuat halaman ditukar SEBELUM tirai menutup penuh -
      // satu bingkai peta masih terlihat di baliknya.
      jamPulang.current.push(window.setTimeout(r, 520))
    })
    void Promise.all([chunk, tertutup]).then(() => {
      if (!hidupPulang.current) return
      selesaikan()
      setPulang('buka')
      // Sedikit lebih lama dari `pulang-pudar` (460ms) supaya lapisannya tidak
      // dicabut tepat di bingkai terakhir animasinya.
      jamPulang.current.push(window.setTimeout(() => setPulang(null), 500))
    })
  }, [])

  const masukKePeta = useCallback((pilihan?: { kawasan: string; layer: NamaLayer }) => {
    if (pilihan) {
      setKawasan(pilihan.kawasan)
      setLayer(pilihan.layer)
      setLayerNyala(true)
      setHexTerpilih(null)
      setNHeksagon(null)
    }
    setGerbang(false)
    setPembuka(true)
  }, [])

  // Disimpan tiap kali salah satunya berubah. Ditulis di effect, bukan di
  // setiap penangan: penangannya ada belasan, dan satu yang lupa memanggil
  // penyimpan akan menghasilkan keadaan yang separuh benar setelah refresh.
  useEffect(() => {
    if (gerbang) return // masih di perkenalan; belum ada yang perlu diingat
    tulisSesiMasuk(true)
    try {
      // `masuk` sengaja TIDAK ikut ke sini. Kalau ia tertulis di localStorage,
      // orang yang membuka web besok akan melewati gerbang - dan itu persis
      // yang diminta untuk tidak terjadi.
      localStorage.setItem(
        KUNCI_TAMPILAN,
        JSON.stringify({ kawasan, layer, layerNyala, gaya, namaTempat, tigaDimensi }),
      )
    } catch {
      // Mode privat. Sesi tetap jalan, cuma tidak selamat dari refresh.
    }
  }, [gerbang, kawasan, layer, layerNyala, gaya, namaTempat, tigaDimensi])

  useEffect(() => {
    if (gerbang) return
    if (!premium) {
      peta.current?.setPin([])
      return
    }
    let batal = false
    api
      .pantauan()
      .then((b) => {
        if (!batal) pasangPin(b)
      })
      .catch(() => {})
    return () => {
      batal = true
    }
  }, [premium, sinyalSimpan, gerbang])

  const sudahKeRekomendasi = useRef(false)
  useEffect(() => {
    if (!akun || sudahKeRekomendasi.current) return
    sudahKeRekomendasi.current = true
    setTab('rekomendasi')
  }, [akun])

  const prefSebelum = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (!akun) return
    const kw = akun.preferensi?.kawasan ?? null
    if (prefSebelum.current === undefined) {
      prefSebelum.current = kw // akun baru mendarat: catat saja, jangan pindahkan
      return
    }
    if (kw && kw !== prefSebelum.current) {
      setKawasan(kw)
      setHexTerpilih(null)
      setNHeksagon(null)
    }
    prefSebelum.current = kw
  }, [akun])

  const kendali = useMemo<KendaliPeta>(
    () => ({
      zoomIn: () => peta.current?.zoomIn(),
      zoomOut: () => peta.current?.zoomOut(),
      flyTo: (lat, lon, zoom) => peta.current?.flyTo(lat, lon, zoom),
      fitBounds: (kotak) => peta.current?.fitBounds(kotak),
      fokusHeksagon: (h3) => peta.current?.fokusHeksagon(h3),
      resetArah: () => peta.current?.resetArah(),
      arah: () => peta.current?.arah() ?? { bearing: 0, pitch: 0 },
      highlight: (ids) => {
        peta.current?.highlight(ids)
        if (ids.length === 1) setHexTerpilih(ids[0])
      },
      filter: (kriteria) => peta.current?.filter(kriteria),
      setPin: (d) => peta.current?.setPin(d),
      setLayer,
      setGaya,
    }),
    [],
  )

  const pilihHeksagon = useCallback(
    (h3: string | null) => {
      if (simulasiTerbuka) {
        if (h3 && h3 !== hexTerpilih) {
          setHexBanding(h3)
          peta.current?.highlight([hexTerpilih, h3].filter(Boolean) as string[])
        }
        return
      }

      if (baki.length > 0 && h3) {
        if (!baki.includes(h3)) tambahBaki(h3)
        setHexTerpilih(h3)
        peta.current?.fokusHeksagon(h3)
        return
      }

      setHexTerpilih(h3)
      setSimulasiTerbuka(false)
      setHexBanding(null)
      if (h3) {
        setTab('daftar')
        setPanelTerbuka(true)
        peta.current?.fokusHeksagon(h3)
      }
    },
    [simulasiTerbuka, hexTerpilih, baki, tambahBaki],
  )

  const lepasPilihan = useCallback(() => {
    setHexTerpilih(null)
    setHexBanding(null)
    setSimulasiTerbuka(false)
    peta.current?.highlight([])
  }, [])

  useEffect(() => {
    const tekan = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Dialog menangani Esc-nya sendiri lewat portal; jangan ikut campur.
      if (document.querySelector('[role="dialog"]')) return
      if (simulasiTerbuka) {
        setSimulasiTerbuka(false)
        return
      }
      if (hexTerpilih) lepasPilihan()
    }
    window.addEventListener('keydown', tekan)
    return () => window.removeEventListener('keydown', tekan)
  }, [simulasiTerbuka, hexTerpilih, lepasPilihan])

  const arahkanKamera = useCallback((v: string) => {
    if (v === SEMUA_KAWASAN) {
      // Terbang ke bingkai yang memuat keenamnya. Terbang ke salah satu pusat
      // akan menyembunyikan lima kawasan lain yang justru baru saja diminta.
      peta.current?.fitBounds(BINGKAI_SEMUA)
      return
    }
    const dipilih = v
      .split(',')
      .map((n) => KAWASAN_PILOT.find((x) => x.nama === n))
      .filter((x): x is (typeof KAWASAN_PILOT)[number] => x !== undefined)
    if (!dipilih.length) return
    if (dipilih.length === 1) {
      peta.current?.flyTo(dipilih[0].pusat[1], dipilih[0].pusat[0], 14)
      return
    }
    const lon = dipilih.map((k) => k.pusat[0])
    const lat = dipilih.map((k) => k.pusat[1])
    const bantal = 0.02 // ±2 km, supaya heksagon tepi tidak menempel bingkai
    peta.current?.fitBounds([
      Math.min(...lon) - bantal,
      Math.min(...lat) - bantal,
      Math.max(...lon) + bantal,
      Math.max(...lat) + bantal,
    ])
  }, [])

  const kameraAwal = useRef(false)
  const catatMuat = useCallback(
    (n: number) => {
      setNHeksagon(n)
      if (!kameraAwal.current) {
        kameraAwal.current = true
        arahkanKamera(kawasan)
      }
    },
    [arahkanKamera, kawasan],
  )


  const gantiKawasan = useCallback(
    (v: string) => {
      setKawasan(v)
      setHexTerpilih(null)
      setNHeksagon(null)
      setTab('daftar')
      arahkanKamera(v)
    },
    [arahkanKamera],
  )

  useEffect(() => {
    const dengar = (e: Event) => {
      const kw = (e as CustomEvent<DetailBukaPeta>).detail?.kawasan ?? null
      if (gerbang) {
        if (kw) {
          setKawasan(kw)
          setHexTerpilih(null)
          setNHeksagon(null)
        }
        masukKePeta()
      } else if (kw) {
        gantiKawasan(kw)
      }
    }
    window.addEventListener(PERISTIWA_BUKA_PETA, dengar)
    return () => window.removeEventListener(PERISTIWA_BUKA_PETA, dengar)
  }, [gerbang, masukKePeta, gantiKawasan])

  // Seluruh simpul transit, untuk pencarian. Diminta sekali seumur sesi:
  // jumlahnya puluhan dan tidak berubah selama demo.
  useEffect(() => {
    let batal = false
    api
      .simpulTransit()
      .then((s) => !batal && setSimpul(s))
      .catch(() => !batal && setSimpul([]))
    return () => {
      batal = true
    }
  }, [])

  useEffect(() => {
    let batal = false
    setDiagram(null)
    api
      .diagramKuadran({ kawasan, limit: 2000 })
      .then((d) => !batal && setDiagram(d))
      .catch(() => !batal && setDiagram(null))
    return () => {
      batal = true
    }
  }, [kawasan])

  // Posisi heksagon terpilih di dalam Kompas kecil.
  const posisi = useMemo(() => {
    const t = diagram?.titik.find((x) => x.h3_index === hexTerpilih)
    return t ? { x: t.x_prestise, y: t.y_peluang, kuadran: t.kuadran } : null
  }, [diagram, hexTerpilih])

  const pakaiKompas = LAYER_KUADRAN.includes(layer)

  const frasaSumbuX = useMemo(
    () => frasaPrestise(diagram?.cakupan_prestise, 'wilayah', bahasa),
    [diagram, bahasa],
  )

  const sebarKuadran = useMemo(() => {
    const titik = diagram?.titik ?? []
    const hitung = titik.filter((x) => x.kuadran !== null).length
    return URUTAN_KUADRAN.map((kunci) => {
      const n = titik.filter((x) => x.kuadran === kunci).length
      return { kunci, n, pct: hitung ? (n / hitung) * 100 : 0 }
    })
  }, [diagram])

  const ringkasBaki = useMemo(() => {
    const m = new Map<
      string,
      { kawasan: string; skor: number | null; kuadran: NamaKuadran | null }
    >()
    for (const t of diagram?.titik ?? []) {
      m.set(t.h3_index, { kawasan: t.kawasan, skor: t.y_peluang, kuadran: t.kuadran })
    }
    return m
  }, [diagram])

  const pilihDariDaftar = useCallback((h3: string) => {
    setHexTerpilih(h3)
    setSimulasiTerbuka(false)
    setHexBanding(null)
    peta.current?.highlight([h3])
    peta.current?.fokusHeksagon(h3)
  }, [])
  const pilihDariRekomendasi = useCallback((h3: string) => {
    setHexTerpilih(h3)
    setTab('daftar')
    peta.current?.fokusHeksagon(h3)
  }, [])
  const bukaKuadranPenuh = useCallback(() => setKuadranPenuh(true), [])
  const batasKompas = useMemo(
    () => (diagram ? { x: diagram.batas_x, y: diagram.batas_y } : undefined),
    [diagram],
  )

  /** Di sisi mana sebuah pane menunggu, relatif terhadap tab yang aktif. */
  const sisiTab = (k: NamaTab): 'kiri' | 'aktif' | 'kanan' => {
    const selisih = URUTAN_TAB.indexOf(k) - URUTAN_TAB.indexOf(tab)
    return selisih === 0 ? 'aktif' : selisih < 0 ? 'kiri' : 'kanan'
  }

  const pilihTabBawah = useCallback(
    (k: NamaTab) => {
      if (tab === k && panelTerbuka) {
        setPanelTerbuka(false)
        return
      }
      setTab(k)
      setPanelTerbuka(true)
    },
    [tab, panelTerbuka],
  )

  /** Pop-up sumber peta: tutup lewat ketukan di luar atau Escape. */
  const atribusiRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!atribusiTerbuka) return
    const luar = (e: MouseEvent) => {
      if (!atribusiRef.current?.contains(e.target as Node)) setAtribusiTerbuka(false)
    }
    const kunci = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAtribusiTerbuka(false)
    }
    document.addEventListener('mousedown', luar)
    document.addEventListener('keydown', kunci)
    return () => {
      document.removeEventListener('mousedown', luar)
      document.removeEventListener('keydown', kunci)
    }
  }, [atribusiTerbuka])

  useEffect(() => {
    if (!filterTerbuka) return
    const luar = (e: MouseEvent) => {
      if (!filterRef.current?.contains(e.target as Node)) setFilterTerbuka(false)
    }
    const kunci = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFilterTerbuka(false)
    }
    document.addEventListener('mousedown', luar)
    document.addEventListener('keydown', kunci)
    return () => {
      document.removeEventListener('mousedown', luar)
      document.removeEventListener('keydown', kunci)
    }
  }, [filterTerbuka])

  const kendaliFilter = (arah: 'turun' | 'naik') => (
    <>
      <MenuKawasan nilai={kawasan} onUbah={gantiKawasan} arah={arah} />
      <Menu
        label="Layer"
        arah={arah}
        nilai={layerNyala ? layer : 'mati'}
        /* "Tanpa layer" DI ATAS, bukan di bawah: ia keadaan bawaan, dan keadaan
           bawaan yang harus dicari dulu di ujung daftar bukan keadaan bawaan
           yang berguna. */
        opsi={[
          { nilai: 'mati' as NamaLayer, label: t.tanpaLayer },
          ...Object.entries(LAYER).map(([k, l]) => ({
            nilai: k as NamaLayer,
            label: l.nama,
          })),
        ]}
        onUbah={(v) => {
          if ((v as string) === 'mati') {
            setLayerNyala(false)
            return
          }
          setLayer(v)
          setLayerNyala(true)
        }}
      />
    </>
  )

  const pengaturanEl = (
    /* Sakelar tema PINDAH ke dalam menu pengaturan (11 Sep 2026, permintaan
       pemilik repo). Preferensi tampilan bukan benda yang ditekan orang tiap
       menit, dan ia berdiri di sebelah sakelar bahasa yang sifatnya sama. */
    <MenuPengaturan
      namaTempat={namaTempat}
      onNamaTempat={setNamaTempat}
      tigaDimensi={tigaDimensi}
      onTigaDimensi={setTigaDimensi}
      onSumber={() => setSumberTerbuka(true)}
    />
  )

  return (
    <>
      {gerbang && (
        <Suspense fallback={<div className="gerbang fixed inset-0 z-40" data-tema={tema} aria-hidden />}>
          <Gerbang onMasuk={masukKePeta} />
        </Suspense>
      )}
      {/* Tirai pulang. DI ATAS gerbang (z 70) dan dialog (z 80), DI BAWAH layar
          pembuka (z 100) - keduanya tidak pernah hidup bersamaan, tapi urutan
          yang ditulis apa adanya lebih murah daripada urutan yang harus
          dibuktikan. `data-tema`: warnanya warna halaman TUJUAN, lihat
          `.pulang-heks` di index.css. */}
      {pulang && (
        <div className="pulang" data-fase={pulang} data-tema={tema} aria-hidden>
          <span className="pulang-heks" />
          {/* Markah di tengah tirai: jalan pulang sekarang MEMPERKENALKAN
              produknya lagi, bukan sekadar gelembung heksagon yang lewat.
              Bentuknya sama dengan favicon dan logo halaman gerbang. */}
          <span className="pulang-markah">
            <Markah kelas="h-16 w-16 sm:h-20 sm:w-20" />
          </span>
        </div>
      )}
      {pembuka && (
        <Suspense fallback={<div className="fixed inset-0 z-[100] bg-[#06090a]" />}>
          <Pembuka onSelesai={tutupPembuka} />
        </Suspense>
      )}

      <div className={`relative h-full overflow-hidden ${tema === 'gelap' ? 'peta-gelap' : ''}`}>
        {/* --- Lapisan 1: peta, seluruh layar ------------------------------
            Peta TIDAK dipasang selama halaman gerbang masih terbuka.

            Sebelumnya ia dipasang sejak render pertama supaya layar pembuka
            tidak perlu lama. Itu masuk akal ketika layar pembuka datang LEBIH
            DULU daripada gerbang - peta punya waktu memuat di baliknya. Sejak
            urutannya dibalik jadi gerbang -> pembuka -> peta, pemasangan dini
            itu jadi sisa yang tidak lagi membeli apa pun: satu konteks WebGL,
            708 heksagon, dan seluruh ubinnya hidup dan menggambar selama
            orangnya membaca halaman perkenalan yang panjang.

            Sekarang ia lahir bersamaan dengan layar pembuka - dan layar pembuka
            memang untuk itu. Keempat langkahnya nyata (menghubungi mesin data,
            menyiapkan basemap MAPID, memuat tipografi, menyusun grid) dan
            ditahan minimal 2,4 detik; petanya memuat persis di jendela itu.

            Wadahnya TETAP ada supaya tata letak tidak berubah saat isinya
            muncul. */}
        <div className="absolute inset-0">
          {!gerbang && (
          <Suspense fallback={null}>
          <PetaInteraktif
            ref={peta}
            kawasan={kawasan}
            layer={layer}
            layerNyala={layerNyala}
            namaTempat={namaTempat}
            rutaTampil={rutaTampil}
            gaya={gaya}
            tigaDimensi={tigaDimensi}
            terpilih={hexTerpilih}
            blok={blok}
            blokTerpilih={blokTerpilih}
            onPilihBlok={setBlokTerpilih}
            saringKuadran={saringKuadran}
            dibandingkan={baki}
            onPilihHeksagon={pilihHeksagon}
            onTaruhPin={premium ? taruhPin : undefined}
            profilRute={profilRute}
            onMuat={catatMuat}
            tampil={!pembuka && !gerbang}
            onGayaGagal={kembalikanGaya}
            onArah={(a) =>
              setArahPeta((p) =>
                // Dibandingkan dulu: `rotate` menyala tiap bingkai selama peta
                // diseret, dan menyetel state tiap bingkai berarti me-render
                // seluruh chrome 60 kali per detik untuk dua angka yang sama.
                Math.abs(p.bearing - a.bearing) < 0.5 && Math.abs(p.pitch - a.pitch) < 0.5 ? p : a,
              )
            }
          />
          </Suspense>
          )}
        </div>

        {/* --- Lapisan 2: chrome melayang -----------------------------------
            Lapisannya sendiri tidak menerima klik; hanya panel di dalamnya.
            Tanpa ini, seluruh peta jadi mati tersentuh oleh sebuah div kosong
            setinggi layar. */}
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col gap-3 p-3 max-lg:!gap-2 max-lg:!p-2.5 sm:gap-4 sm:p-4">
          {/* --- Bilah atas, SATU BARIS -------------------------------------
              Di desktop: jalan pulang + logo + pencarian + kawasan/layer +
              gerigi + akun, persis seperti semula.

              Di ponsel: logo Loconomics + pencarian + gerigi. Tombol jalan
              pulang TIDAK di sini - rumahnya tombol "Home" di bar bawah (kiri
              paling pojok), dan kawasan/layer pindah ke pil filter kiri-bawah.
              Seluruh busur `max-lg:` - desktop tidak tersentuh. */}
          <header className="kaca pointer-events-auto relative z-40 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2.5 rounded-lg px-4 py-2.5 max-lg:!flex max-lg:!flex-nowrap max-lg:!items-center max-lg:gap-x-2 max-lg:px-2.5 max-lg:py-2 sm:px-5">
            {/* Tombol pulang BERDIRI SENDIRI di sebelah kiri logo di desktop.
                Versi sebelumnya menyembunyikannya di dalam logo dengan panah
                yang baru muncul saat disorot - dan tidak ada yang menyorot logo
                untuk mencari jalan pulang. Pintu yang harus ditemukan dulu
                bukan pintu. Di ponsel ia disembunyikan karena tombol Home di
                bar bawah sudah mengambil alih perannya. */}
            <button
              onClick={keLanding}
              title={t.kembaliGerbang}
              aria-label={t.kembaliGerbang}
              className="group grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full border border-line text-ink-2 transition-all duration-300 ease-jelly hover:-translate-x-0.5 hover:border-line-2 hover:text-ink max-lg:hidden"
            >
              <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden>
                <path
                  d="M11.5 4.5 6 10l5.5 5.5"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {/* Logo Loconomics. Di desktop sudah tampil; di ponsel kini JUGA
                tampil - identitas produk tumbuh di bilah atas yang tinggal satu
                baris, persis seperti aplikasi peta. */}
            <div className="flex shrink-0 items-center gap-2 max-lg:gap-1.5">
              {/* Markah heksagon di KIRI teksnya, sama seperti di halaman
                  pembuka - jadi bilah atas peta dan bilah gerbang memakai
                  identitas yang persis sama (permintaan 19 Sep 2026). */}
              <Markah kelas="h-[19px] w-[19px] shrink-0 max-lg:h-[16px] max-lg:w-[16px]" />
              {/* Di ponsel logonya dikecilkan tiga kali: 20px membuat
                  "Loconomics" memakan hampir separuh bilah sampai pencariannya
                  tercekik, 16px masih dilaporkan "kegedean", dan 14px pun masih
                  ketat sesudah markahnya ikut berdiri di sebelahnya. 12,5px
                  masih terbaca sebagai papan nama tanpa berebut ruang. */}
              <PapanNama teks="Loconomics" kelas="text-[20px] leading-none max-lg:!text-[12.5px]" />
            </div>

            <Cari
              kelas="max-lg:!w-auto max-lg:!flex-1"
              simpul={simpul}
              onPilihKawasan={gantiKawasan}
              onPilihSimpul={(s) => {
                if (s.kawasan !== kawasan) gantiKawasan(s.kawasan)
                peta.current?.flyTo(s.lat, s.lon, 15)
              }}
              onPilihHeksagon={(h3) => {
                setHexTerpilih(h3)
                setTab('daftar')
                setPanelTerbuka(true)
                peta.current?.highlight([h3])
              }}
            />

            {/* Gerigi pengaturan DI PONSEL: tetap di bilah atas. Desktop
                memakai salinan di blok kendali bawah ini. */}
            <div className="hidden shrink-0 max-lg:block">{pengaturanEl}</div>

            {/* Kelompok kendali peta DI DESKTOP: satu blok flex yang didorong ke
                kanan (`ml-auto gap-2`), persis seperti semula. */}
            <div className="ml-auto hidden max-w-full shrink-0 flex-wrap items-center justify-end gap-2 lg:flex">
              {kendaliFilter('turun')}
              {pengaturanEl}
            </div>
            {/* Garis pemisah tipis di kiri tombol akun DIHAPUS (21 Sep 2026):
                jaraknya sudah cukup menyatakan kelompoknya sendiri, dan
                garisnya justru terbaca sebagai sisa tata letak. */}
            <div className="hidden shrink-0 lg:block">
              <TombolAkun />
            </div>
          </header>

          <div className="flex min-h-0 flex-1 gap-4">
            {/* --- Kolom kiri -----------------------------------------------
                pb-[42px] menyisakan baris skala + atribusi MapLibre di kiri
                bawah. Angkanya dikunci oleh .maplibregl-ctrl-bottom-left di
                index.css; kedua sisi angka ajaib ini ada di repo yang sama. */}
            {/* `max-lg:pb-[6rem]`: chip aksi (Simulasi di sini / baki komparasi)
                duduk sebaris dengan pil atribusi + kompas, di atas bilah bawah.
                Filter sudah pindah ke KIRI ATAS, jadi baris ini lengang dan
                chipnya bisa benar-benar di TENGAH - sebelumnya ia digeser kiri
                (`pr-[4.75rem]`) untuk menghindari tombol tersimpan. */}
            <div className="flex min-h-0 flex-1 flex-col gap-3 pb-[42px] max-lg:pb-[6rem]">
              {/* Baris bawah: legenda di kiri, tombol melayang di kanan, dan
                  pertanyaan layer TEPAT di tengah.

                  Percobaan pertama memakai left-50% + translate — tengah
                  sungguhan terhadap kolom peta. Itu salah begitu kolom Konsultan
                  AI dibuka: kolom petanya menyempit, titik tengahnya bergeser ke
                  kiri, dan chip-nya menabrak kartu Kompas.

                  Yang dipakai sekarang tengah terhadap RUANG YANG TERSISA di
                  antara legenda dan tombol. Sedikit bergeser dari tengah optis
                  saat kedua sisinya berbeda lebar, tapi ia tidak pernah bisa
                  menimpa apa pun — dan chip yang menutupi legenda jauh lebih
                  buruk daripada chip yang meleset beberapa piksel. */}
              <div className="relative mt-auto flex items-end justify-between gap-4">
                {/* Kartu Kompas/Legenda - anak flex, BUKAN elemen melayang.
                    Sebagai elemen melayang ia menimpa chip pertanyaan di
                    belakangnya; sebagai anak flex, membukanya mendorong chip ke
                    kanan dengan sendirinya dan tidak ada yang bisa bertumpuk. */}
                <div
                  className="kolom-kartu order-2 overflow-hidden"
                  onClick={(e) => {
                    if (e.target === e.currentTarget) setPanelKiri('tidak')
                  }}
                  data-buka={panelKiriTerbuka && !simulasiTerbuka}
                  style={
                    {
                      '--lebar-kartu': panelKiriTerbuka && !simulasiTerbuka ? '17rem' : '0rem',
                      '--geser-kartu': panelKiriTerbuka && !simulasiTerbuka ? '0rem' : '-1rem',
                      '--opasitas-kartu': panelKiriTerbuka && !simulasiTerbuka ? 1 : 0,
                    } as CSSProperties
                  }
                  aria-hidden={!panelKiriTerbuka}
                >
                  <div className="pointer-events-auto w-[17rem]">
                    {pakaiKompas ? (
                      <KompasKuadran
                        saring={saringKuadran}
                        onSaring={setSaringKuadran}
                        posisi={posisi}
                        batas={diagram ? { x: diagram.batas_x, y: diagram.batas_y } : undefined}
                        onBukaPenuh={() => setKuadranPenuh(true)}
                      />
                    ) : (
                      <Legenda key={kawasan} layer={layer} kawasan={kawasan} />
                    )}
                  </div>
                </div>

                <div
                  className={`pointer-events-none order-3 flex min-w-0 flex-1 justify-center pb-0.5 transition-opacity duration-300 ${
                    simulasiTerbuka ? 'opacity-0' : 'opacity-100'
                  }`}
                >
                  {baki.length > 0 ? (
                    /* Baki berisi: seluruh slot tengah jadi milik komparasi.
                       Ajakan simulasi sengaja MENGHILANG, bukan mengecil -
                       keduanya menjawab pertanyaan yang berbeda, dan dua ajakan
                       berdampingan memaksa orang memilih dulu sebelum
                       mengerjakan apa pun. */
                    <BarKomparasi
                      baki={baki}
                      skor={ringkasBaki}
                      onLepas={tambahBaki}
                      onKosongkan={() => setBaki([])}
                      onBuka={() => setKomparasiTerbuka(true)}
                      onSorot={(h3) => {
                        setHexTerpilih(h3)
                        peta.current?.fokusHeksagon(h3)
                      }}
                    />
                  ) : hexTerpilih ? (
                    /* Heksagon sudah dipilih: pertanyaan layer berhenti relevan
                       - pertanyaannya sekarang "kalau saya buka usaha DI SINI,
                       jadinya bagaimana", dan bar ini pintunya. Premium; yang
                       belum diarahkan ke dialog langganan oleh bukaSimulasi.

                       Di sebelahnya tombol BATAL, dan ia ada karena membatalkan
                       pilihan praktis mustahil sebelum ini. Jalan keluarnya cuma
                       satu: tombol "Kembali ke daftar lokasi" di dalam panel
                       kanan - panel yang BISA DILIPAT, dan yang memang dilipat
                       orang supaya petanya terlihat. Begitu dilipat, satu-satunya
                       cara melepas heksagon adalah mengklik heksagon lain, yang
                       bukan melepas melainkan mengganti.

                       Keluarga jebakan yang sama dengan baki komparasi yang
                       buntu: aksi yang hidup HANYA di dalam wadah yang bisa
                       disembunyikan sama dengan aksi yang tidak ada. */
                    <div className="pointer-events-auto flex max-w-full items-center gap-2">
                    <button
                      onClick={bukaSimulasi}
                      className="group flex w-fit min-w-0 cursor-pointer items-center gap-3 rounded-full bg-ink px-5 py-2.5 text-surface shadow-lg transition-transform duration-300 ease-jelly hover:scale-[1.03] max-lg:gap-2 max-lg:px-4 max-lg:py-2"
                    >
                      <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden className="shrink-0">
                        <path
                          d="M3 15.5 7.5 10l3 2.5L17 5.5"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path d="M12.8 5h4.2v4.2" stroke="currentColor" strokeWidth="1.9" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="truncate text-[13.5px] font-semibold">
                        {t.simulasiDiSini}
                      </span>
                      {!premium && (
                        <span className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider max-lg:hidden">
                          {t.premium}
                        </span>
                      )}
                      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="shrink-0 transition-transform duration-200 group-hover:translate-x-0.5">
                        <path d="M4 1.5 8.5 6 4 10.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button
                      onClick={lepasPilihan}
                      title={t.lepasPilihan}
                      aria-label={t.lepasPilihanPanjang}
                      className="kaca grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-2 transition-colors duration-200 hover:bg-surface-2 hover:text-ink"
                    >
                      <svg width="15" height="15" viewBox="0 0 14 14" aria-hidden>
                        <path
                          d="M2.5 2.5 11.5 11.5M11.5 2.5 2.5 11.5"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                    </div>
                  ) : (
                  <button
                    onClick={() => {
                      setTab('daftar')
                      setPanelTerbuka(true)
                    }}
                    title={t.bukaDaftar}
                    className="kaca pointer-events-auto flex w-fit max-w-full cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-left transition-colors duration-200 hover:bg-surface-2 max-lg:hidden"
                  >
                    <span className="truncate text-[13.5px] text-ink-2">
                      {bahasa === 'en' ? LAYER[layer].pertanyaanEn : LAYER[layer].pertanyaan}
                    </span>
                    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="shrink-0 text-ink-3">
                      <path d="M4 1.5 8.5 6 4 10.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  )}
                </div>


                {/* --- Tombol melayang: zoom + basemap + konsultan AI ------
                    Wadahnya WAJIB punya position selain static, supaya kartu AI
                    bisa digantung tepat di atas tombolnya tanpa koordinat tetap.

                    Dulu di sini tertulis `lg:static`, dan itu bug: di layar
                    >=1024px wadahnya berhenti jadi konteks posisi, jadi kartu AI
                    naik menempel ke lapisan chrome setinggi layar. `bottom:
                    calc(100% + 12px)` dari situ menaruhnya di y = -428px - klik
                    tombolnya dan tidak ada apa pun yang terlihat muncul.
                    `relative` ikut alur normal persis seperti `static`, bedanya
                    cuma ia tetap jadi jangkar. */}
                {/* Tumpukan kendali peta.

                    Di desktop ia tetap kolom yang duduk di alur baris bawah
                    (relative), persis seperti semula.

                    Di ponsel ia `fixed` di tepi KANAN ATAS, TEGAK, tepat di
                    bawah bilah atas - meniru tata letak MAPID, tempat pemilih
                    layer menggantung di bawah kolom pencarian. Kiri bawah sudah
                    dipakai pil filter, dan bar bawah sudah memuat navigasi,
                    jadi sudut kanan atas yang tersisa. */}
                <div className="tumpukan-peta pointer-events-auto absolute z-30 order-1 flex gap-2 max-lg:fixed max-lg:right-2.5 max-lg:top-[4.75rem] max-lg:flex-col max-lg:items-end lg:relative lg:bottom-auto lg:left-auto lg:mr-auto lg:flex-col lg:items-start">
                  {/* Tombol perbesar/perkecil DISEMBUNYIKAN di layar sempit.
                      Bukan karena tidak berguna, melainkan karena di sana ia
                      satu-satunya yang bisa pergi tanpa kehilangan apa pun:
                      layar sentuh sudah punya cubit-untuk-zoom, dan empat
                      kelompok tombol di atas lembar setinggi 56svh mendorong
                      kelompok teratas menembus bilah atas. Terukur di 390x844.
                      Ketiga sisanya - lokasi tersimpan, kompas, legenda - tidak
                      punya pengganti gerakan jari. */}
                  <div className="kaca hidden flex-col overflow-hidden rounded-full sm:flex">
                    <button
                      onClick={() => peta.current?.zoomIn()}
                      aria-label="Perbesar peta"
                      title="Perbesar"
                      className="grid h-10 w-11 cursor-pointer place-items-center text-[17px] leading-none transition-colors hover:bg-surface-2/70"
                    >
                      +
                    </button>
                    <span className="mx-2.5 h-px bg-line" />
                    <button
                      onClick={() => peta.current?.zoomOut()}
                      aria-label="Perkecil peta"
                      title="Perkecil"
                      className="grid h-10 w-11 cursor-pointer place-items-center text-[17px] leading-none transition-colors hover:bg-surface-2/70"
                    >
                      −
                    </button>
                    <span className="mx-2.5 h-px bg-line" />
                    {/* Sakelar 3D. Sesumbu dengan zoom karena keduanya mengubah
                        KAMERA, bukan isi peta. Tulisan "3D" alih-alih ikon kubus:
                        kubus di ukuran 17px terbaca sebagai ikon paket, dan dua
                        huruf ini justru kata yang dicari orang. */}
                    <button
                      onClick={() => setTigaDimensi((v) => !v)}
                      aria-pressed={tigaDimensi}
                      aria-label={tigaDimensi ? t.tigaDimensiNyala : t.tigaDimensiMati}
                      title={tigaDimensi ? t.tigaDimensiNyala : t.tigaDimensiMati}
                      className={`grid h-10 w-11 cursor-pointer place-items-center text-[12px] font-bold leading-none tracking-wide transition-colors ${
                        tigaDimensi ? 'bg-ink text-surface' : 'hover:bg-surface-2/70'
                      }`}
                    >
                      3D
                    </button>
                  </div>

                  {/* Pelurus peta. Muncul HANYA kalau peta sedang diputar atau
                      dimiringkan - klik-kanan-seret di MapLibre memutar peta, dan
                      orang yang tidak sengaja melakukannya sering tidak tahu cara
                      mengembalikannya. Tombol yang selalu ada akan memakan satu
                      slot permanen untuk keadaan yang jarang terjadi; yang muncul
                      saat dibutuhkan menjelaskan dirinya sendiri lewat kemunculannya. */}
                  {(Math.abs(arahPeta.bearing) > 0.5 || arahPeta.pitch > 0.5) && (
                    <button
                      onClick={() => peta.current?.resetArah()}
                      aria-label="Kembalikan arah peta ke utara"
                      title="Kembalikan arah peta ke utara"
                      className="pop grid h-12 w-12 shrink-0 cursor-pointer place-items-center rounded-full bg-ink text-surface shadow-[0_12px_30px_-10px_rgb(22_33_28/0.7)] transition-transform duration-200 ease-jelly hover:scale-[1.06]"
                    >
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 20 20"
                        aria-hidden
                        className="transition-transform duration-300 ease-liquid"
                        style={{ transform: `rotate(${-arahPeta.bearing}deg)` }}
                      >
                        <path d="M10 2.4 13.2 12 10 10.1 6.8 12Z" fill="currentColor" />
                        <path
                          d="M10 10.1 13.2 12 10 17.6 6.8 12Z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  )}

                  {/* Pemilih basemap. Urutannya dari atas: zoom, basemap,
                      konsultan AI - tiga tombol bulat sesumbu di tepi kanan.
                      Ia tidak lagi jadi dropdown di bilah atas: memilih tampilan
                      peta adalah tindakan DI peta, dan tempatnya dekat tangan
                      yang sedang menggeser peta itu. */}
                  {/* Lokasi tersimpan. Tempatnya DI SINI, sesumbu dengan
                      pemilih basemap dan pembuka Kompas, bukan lagi di bilah
                      atas: ketiganya tindakan DI peta, dan tangan yang sedang
                      menggeser peta tidak perlu naik ke ujung layar untuk satu
                      di antaranya.

                      Ia membuka DIALOG, bukan panel yang memanjang, jadi ia
                      tidak ikut ke dalam `panelKiri` - tetapi ia tetap menutup
                      apa pun yang sedang terbuka di tumpukan ini. Dialog yang
                      terbit di atas panel yang masih menganga terbaca sebagai
                      dua hal yang sama-sama aktif. */}
                  <button
                    onClick={() => {
                      setPanelKiri('tidak')
                      setPantauanTerbuka(true)
                    }}
                    title={t.tersimpanPanjang}
                    aria-label={t.tersimpan}
                    className="grid h-12 w-12 shrink-0 cursor-pointer place-items-center rounded-full bg-ink text-surface shadow-[0_12px_30px_-10px_rgb(22_33_28/0.7)] transition-transform duration-200 ease-jelly hover:scale-[1.06] max-lg:fixed max-lg:bottom-[10.75rem] max-lg:right-2.5"
                  >
                    <svg width="19" height="19" viewBox="0 0 20 20" aria-hidden>
                      <path d="M5.5 3.5h9V17L10 13.6 5.5 17Z" fill="currentColor" />
                    </svg>
                  </button>

                  {/* Di ponsel pemilih basemap DIPINDAH ke kolom kanan yang
                      sama dengan lokasi tersimpan (9,5rem) dan Kompas/legenda
                      (6rem) - dulu ia sendirian di kanan-ATAS, jadi tiga tombol
                      bulat itu tidak pernah segaris (permintaan 19 Sep 2026).
                      Ia masih memanjang ke KIRI (`arahSempit`), jadi tombolnya
                      tidak bergeser. */}
                  <div className="max-lg:fixed max-lg:bottom-[14.25rem] max-lg:right-2.5 max-lg:z-30">
                    <PilihBasemap
                      arah="kanan"
                      arahSempit="kiri"
                      nilai={gaya}
                      opsi={Object.entries(GAYA_BASEMAP).map(([k, g]) => ({
                        nilai: k as NamaGaya,
                        label: t.basemap[k] ?? g.label,
                      }))}
                      onUbah={gantiGaya}
                      buka={panelKiri === 'basemap'}
                      onBuka={(v) => setPanelKiri(v ? 'basemap' : 'tidak')}
                    />
                  </div>

                  {/* Pembuka Kompas Kuadran / Legenda. Ikonnya IKUT ISI yang
                      dibukanya: grid 2x2 untuk Kompas, tumpukan baris untuk
                      legenda. Tombol yang ikonnya tetap sama padahal isinya
                      bertukar akan membuat orang mengira ia rusak. */}
                  <button
                    onClick={() => setPanelKiri((v) => (v === 'kartu' ? 'tidak' : 'kartu'))}
                    aria-expanded={panelKiriTerbuka}
                    aria-label={`${panelKiriTerbuka ? 'Tutup' : 'Buka'} ${pakaiKompas ? 'Kompas Kuadran' : 'legenda'}`}
                    title={pakaiKompas ? 'Kompas Kuadran' : 'Legenda layer'}
                    className={`grid h-12 w-12 shrink-0 cursor-pointer place-items-center rounded-full transition-transform duration-200 ease-jelly hover:scale-[1.06] max-lg:fixed max-lg:bottom-[7.25rem] max-lg:right-2.5 ${
                      panelKiriTerbuka
                        ? 'kaca text-ink'
                        : 'bg-ink text-surface shadow-[0_12px_30px_-10px_rgb(22_33_28/0.7)]'
                    }`}
                  >
                    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
                      {pakaiKompas ? (
                        <>
                          <rect x="2.6" y="2.6" width="6.4" height="6.4" rx="1.3" fill="none" stroke="currentColor" strokeWidth="1.6" />
                          <rect x="11" y="2.6" width="6.4" height="6.4" rx="1.3" fill="currentColor" />
                          <rect x="2.6" y="11" width="6.4" height="6.4" rx="1.3" fill="none" stroke="currentColor" strokeWidth="1.6" />
                          <rect x="11" y="11" width="6.4" height="6.4" rx="1.3" fill="none" stroke="currentColor" strokeWidth="1.6" />
                        </>
                      ) : (
                        <>
                          <circle cx="4.4" cy="5" r="1.9" fill="currentColor" />
                          <circle cx="4.4" cy="11.6" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.5" />
                          <path d="M9 5h8M9 11.6h8M9 16.4h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        </>
                      )}
                    </svg>
                  </button>

                </div>
              </div>
            </div>

            {/* --- Panel kanan ---------------------------------------------
                Di bawah 1024px ia jadi lembar bawah, bukan kolom: panel selebar
                25rem di layar 900px menyisakan peta yang terlalu sempit untuk
                membandingkan heksagon — dan membandingkan heksagon adalah
                seluruh gunanya peta ini.

                Di ponsel lembar duduk DI ATAS bilah navigasi (`bottom: 6rem` +
                safe-area, lihat `.lembar-peta`) dan TIGA tingkatnya ditulis di
                css (`[data-tingkat]`): ringkas 26svh, setengah 50svh, penuh
                `calc(100svh - 10.5rem)` - berhenti tepat di bawah bilah atas. */}
            <aside
              ref={lembarRef}
              data-buka={panelTerbuka}
              data-tingkat={tingkat}
              aria-hidden={!panelTerbuka}
              className="kolom-geser lembar-peta melayang pointer-events-auto absolute inset-x-0 min-h-0 max-lg:z-40 max-lg:rounded-t-2xl max-lg:shadow-[0_-18px_50px_-24px_rgb(10_20_16/0.55)] max-lg:transition-[height] max-lg:duration-300 max-lg:ease-liquid lg:static lg:h-auto"
              style={
                {
                  '--lebar-kolom': panelTerbuka ? '25rem' : '0rem',
                  '--geser-kolom': panelTerbuka ? '0rem' : '-1rem',
                  '--opasitas-kolom': panelTerbuka ? 1 : 0,
                  ...(tinggiSeret != null ? { height: `${tinggiSeret}px` } : {}),
                  ...(seretLembar ? { transition: 'none' } : {}),
                } as CSSProperties
              }
            >
              <div className="kaca-tebal flex h-full w-full flex-col overflow-hidden rounded-lg max-lg:rounded-t-2xl max-lg:rounded-b-none lg:w-[25rem]">
                <div className="flex shrink-0 items-center gap-1 p-2">
                  {/* SATU penunjuk yang meluncur, bukan tiga latar yang
                      bergantian menyala. Versi sebelumnya memberi tiap tombol
                      `bg-ink`-nya sendiri, jadi berpindah tab terbaca sebagai
                      satu tombol padam dan tombol lain menyala - dua kejadian
                      di dua tempat. Penunjuk yang berjalan menyatakan satu hal:
                      pilihannya PINDAH, dan ke arah mana. Teknik yang sama
                      dengan sakelar Masuk/Daftar di Akun.tsx.

                      `grid-cols-3`, bukan `flex-1`, supaya ketiga sel pasti
                      sama lebar dan `translateX(i x 100%)` mendarat tepat -
                      tanpa satu pun pengukuran. Terukur sebelumnya: ketiga
                      tombol memang sudah sama lebar di 1440, 1024, 390, dan
                      360 px, di kedua bahasa. `whitespace-nowrap` + bantalan
                      yang menyempit di layar kecil: di 360 px "Loconomics AI"
                      (86 px) dulu terlipat jadi dua baris di sel 97 px.

                      "Untuk Anda" duluan: rekomendasi adalah inti produk ini,
                      dan tab yang harus dicari dulu bukan inti.

                      LABEL TERANG TIDAK DIWARNAI PER TOMBOL. Versi pertama
                      penunjuk ini masih mentransisikan warna tiap label, dan
                      dibekukan di 70 ms warnanya tertinggal dari penunjuknya:
                      "Daftar lokasi" masih putih di atas latar yang sudah
                      terbuka, "Loconomics AI" masih abu di atas penunjuk yang
                      sudah tiba. Sekarang tombolnya selalu berlabel redup, dan
                      yang terang adalah SALINAN label di dalam penunjuk yang
                      digeser berlawanan arah sejauh yang sama - dua transform
                      yang saling meniadakan (jebakan: sorotan yang mengikuti
                      kursor), jadi salinannya diam terhadap halaman dan warna
                      berganti persis di tepi penunjuk pada setiap bingkai.
                      Salinannya `aria-hidden`; yang dibaca pembaca layar tetap
                      tombolnya, dan penunjuknya `pointer-events-none` supaya
                      klik jatuh ke tombol di bawahnya. */}
                  <div className="relative grid min-w-0 flex-1 grid-cols-3 max-lg:hidden">
                    {URUTAN_TAB.map((k) => (
                      <button
                        key={k}
                        onClick={() => setTab(k)}
                        aria-current={tab === k ? 'page' : undefined}
                        className={`cursor-pointer whitespace-nowrap rounded-full px-1.5 py-2.5 text-[12.5px] font-semibold text-ink-3 transition-colors duration-300 ease-liquid sm:px-2.5 ${
                          tab === k ? '' : 'hover:bg-surface-2 hover:text-ink-2'
                        }`}
                      >
                        {k === 'rekomendasi' ? t.tabRekomendasi : k === 'daftar' ? t.tabDaftar : t.tabAI}
                      </button>
                    ))}
                    <span
                      aria-hidden
                      className="tab-penunjuk pointer-events-none absolute inset-y-0 left-0 w-1/3 overflow-hidden rounded-full bg-ink shadow-[0_6px_16px_-6px_rgb(22_33_28/0.6)]"
                      style={{ transform: `translateX(${URUTAN_TAB.indexOf(tab) * 100}%)` }}
                    >
                      <span
                        className="tab-penunjuk-isi absolute inset-y-0 left-0 grid w-[300%] grid-cols-3"
                        style={{ transform: `translateX(${(-URUTAN_TAB.indexOf(tab) * 100) / 3}%)` }}
                      >
                        {URUTAN_TAB.map((k) => (
                          <span
                            key={k}
                            className="grid place-items-center whitespace-nowrap px-1.5 text-[12.5px] font-semibold text-surface sm:px-2.5"
                          >
                            {k === 'rekomendasi' ? t.tabRekomendasi : k === 'daftar' ? t.tabDaftar : t.tabAI}
                          </span>
                        ))}
                      </span>
                    </span>
                  </div>
                  <button
                    onClick={() => setPanelTerbuka(false)}
                    aria-label={t.lipat}
                    title={t.lipat}
                    className="ml-1 grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink max-lg:hidden"
                  >
                    <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden>
                      <path
                        d="M4 1.5 8.5 6 4 10.5"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        fill="none"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>

                  {/* Pegangan lembar ponsel. Menggantikan deret tiga tab yang di
                      sana tinggal mengulang bilah bawah. Seret naik = mekar
                      penuh, seret turun = ringkas lalu tutup, ketuk = beralih.
                      `touch-none` supaya gerakannya tidak ikut menggulir isi.

                      Seretannya MENGIKUTI jari (`seretMulai`/`seretGerak`), lalu
                      di-`snap` (`seretLepas`) - bukan lagi "hitung jarak, ubah
                      tinggi sesudah lepas" yang terasa seperti tombol, bukan
                      lembar. */}
                  <button
                    type="button"
                    onClick={() => {
                      if (geserLembar.current) return
                      // Ketukan (tanpa seret) menaikkan SATU tingkat, lalu
                      // berputar kembali ke ringkas - supaya ketiga tingginya
                      // terjangkau tanpa harus menyeret sama sekali.
                      setTingkat((v) =>
                        v === 'ringkas' ? 'setengah' : v === 'setengah' ? 'penuh' : 'ringkas',
                      )
                    }}
                    onPointerDown={seretMulai}
                    onPointerMove={seretGerak}
                    onPointerUp={seretLepas}
                    onPointerCancel={seretLepas}
                    aria-label={tingkat === 'penuh' ? t.lipat : 'Perbesar panel'}
                    className="flex min-w-0 flex-1 cursor-grab touch-none flex-col items-center gap-1 py-1.5 active:cursor-grabbing lg:hidden"
                  >
                    <span className="h-1.5 w-10 rounded-full bg-line-2" />
                    <span className="truncate text-[12.5px] font-semibold text-ink-2">
                      {tab === 'rekomendasi'
                        ? t.tabRekomendasi
                        : tab === 'daftar'
                          ? t.tabDaftar
                          : t.tabAI}
                    </span>
                  </button>
                </div>

                {/* Tiga pane BERTUMPUK, masing-masing di sisinya sendiri:
                    yang di kiri tab aktif menunggu 16 px di kiri, yang di
                    kanan menunggu di kanan. Berpindah tab cuma mengganti
                    `data-sisi`, dan transisi CSS menggeser yang datang dari
                    arah penunjuknya sementara yang pergi memudar ke arah
                    sebaliknya - lihat `.panel-tab` di index.css.

                    `overflow-clip`, BUKAN `overflow-hidden`, dan bedanya
                    menentukan. `hidden` masih wadah gulir: bisa digulir lewat
                    skrip, dan pane yang menunggu 16 px di kanan melebarkan
                    area gulirnya. `scrollIntoView` di Loconomics AI - yang
                    berjalan saat jawaban tiba, juga saat tabnya sedang
                    ditinggalkan - akan menggeser SELURUH wadah beberapa
                    piksel tanpa satu pun galat. Dulu aman karena pane AI
                    `display: none`; sekarang ia cuma tak terlihat. `clip`
                    tidak bisa digulir oleh apa pun. */}
                <div className="relative min-h-0 flex-1 overflow-clip border-t border-line/70">
                  <div
                    className="panel-tab"
                    data-sisi={sisiTab('rekomendasi')}
                    inert={tab !== 'rekomendasi'}
                  >
                    {tabDikunjungi.has('rekomendasi') && (
                      <Suspense fallback={null}>
                        <Rekomendasi onPilih={pilihDariRekomendasi} onBukaAkun={mintaPreferensi} />
                      </Suspense>
                    )}
                  </div>

                  <div
                    className="panel-tab"
                    data-sisi={sisiTab('daftar')}
                    inert={tab !== 'daftar'}
                  >
                  {tabDikunjungi.has('daftar') && (
                    <div className="relative h-full min-h-0">
                      <div className="h-full min-h-0">
                        <DaftarLokasi
                          key={`${kawasan}-${layer}`}
                          layer={layer}
                          kawasan={kawasan}
                          terpilih={hexTerpilih}
                          onPilih={pilihDariDaftar}
                        />
                      </div>

                      {hexTerpilih && (
                        <div className="masuk-kanan absolute inset-0 z-10 flex flex-col bg-surface">
                          <button
                            onClick={lepasPilihan}
                            className="flex shrink-0 cursor-pointer items-center gap-2 border-b border-line/70 px-4 py-2.5 text-left text-[13px] font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink max-lg:px-3 max-lg:py-1.5 max-lg:text-[11.5px]"
                          >
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 12 12"
                              aria-hidden
                              className="shrink-0"
                            >
                              <path
                                d="M7.5 1.5 3 6l4.5 4.5"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                fill="none"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                            {t.kembaliDaftar}
                          </button>
                          <div className="min-h-0 flex-1 overflow-hidden">
                            <PanelInsight
                              h3={hexTerpilih}
                              profilRute={profilRute}
                              onGantiProfil={setProfilRute}
                              rutaTampil={rutaTampil}
                              onUbahRutaTampil={setRutaTampil}
                              blok={blok}
                              onBlok={setBlok}
                              blokTerpilih={blokTerpilih}
                              onPilihBlok={setBlokTerpilih}
                              posisi={posisi}
                              batas={batasKompas}
                              onBukaKuadran={bukaKuadranPenuh}
                              onBukaSimulasi={bukaSimulasi}
                              onSimulasiBlok={bukaSimulasiBlok}
                              onBandingkan={tambahBaki}
                              sedangDibandingkan={baki.includes(hexTerpilih)}
                            />
                          </div>

                        </div>
                      )}
                    </div>
                  )}
                  </div>

                  {/* PanelAI SELALU dimuat, sekalipun tab yang aktif bukan
                      'ai' - dibuktikan bug sebelum diperbaiki 4 Sep 2026: panel
                      ini hidup di dalam TERNARY tiga cabang, jadi berpindah ke
                      "Untuk Anda" atau "Daftar lokasi" MELEPAS komponennya dari
                      DOM. React membuang seluruh state lokalnya seketika itu -
                      riwayat percakapan, teks yang sedang diketik, semuanya -
                      dan begitu orang kembali ke tab AI, `PanelAI` dipasang
                      ULANG dari nol, kosong.

                      Diperbaiki dengan pola yang SAMA dengan detail-di-atas-
                      daftar di atas: tetap terpasang saat bukan gilirannya.
                      Sejak 11 Sep 2026 disembunyikan lewat `data-sisi` seperti
                      kedua tab lain, bukan lagi `hidden` - `display: none` tidak
                      bisa dipudarkan. Satu-satunya yang dipasang sejak awal
                      tanpa menunggu dibuka, seperti sebelumnya: permintaannya
                      saat dipasang cuma `/ai/status`, satu kali. */}
                  <div className="panel-tab" data-sisi={sisiTab('ai')} inert={tab !== 'ai'}>
                    <PanelAI
                      kendali={kendali}
                      hexTerpilih={hexTerpilih}
                      layerAktif={layer}
                      onKeLokasi={keLokasiAI}
                    />
                  </div>
                </div>
              </div>
            </aside>

            {/* Panel terlipat (desktop): kolom tiga pintasan, versi minimize
                bilah bawah ponsel. Menggantikan satu batang berteks vertikal
                yang terbaca sebagai benda miring dan tipis. */}
            {!panelTerbuka && (
              <div
                className="pointer-events-auto hidden shrink-0 flex-col justify-center gap-2 lg:flex"
                role="group"
                aria-label={t.bukaPanel}
              >
                {URUTAN_NAV.map((k) => {
                  const nama =
                    k === 'rekomendasi' ? t.tabRekomendasi : k === 'daftar' ? t.tabDaftar : t.tabAI
                  return (
                    <button
                      key={k}
                      onClick={() => {
                        setTab(k)
                        setPanelTerbuka(true)
                      }}
                      aria-label={`${t.bukaPanel}: ${nama}`}
                      title={nama}
                      className="kaca pop grid h-14 w-14 cursor-pointer place-items-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                    >
                      <IkonNav k={k} ukuran={24} />
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* --- Pil Filter kiri-atas (ponsel) ------------------------------
              Meniru "Community Filter" MAPID. Isinya dua dropdown yang di
              desktop duduk di bilah atas - kawasan dan layer. Desktop tidak
              merendernya (`lg:hidden`): di sana keduanya ada di bilah atas. */}
          {/* Pil Filter di KIRI-ATAS, di bawah bilah atas (permintaan 19 Sep
              2026: "ditaro di pojok kiri atas, biar kalau diklik memanjang
              kesamping kayak layer dan area"). Karena itu tombolnya DULUAN di
              DOM, lalu popover memanjang ke KANAN - bukan ke atas seperti pil
              kiri-bawah yang lama.

              `ref` duduk di WADAH, bukan di popover: dulu ia di popover, jadi
              ketukan pada tombolnya sendiri dianggap "di luar", penangan
              dokumen menutupnya lebih dulu, lalu `onClick` membukanya lagi -
              dan pilnya tidak pernah bisa ditutup dengan menekannya sekali lagi. */}
          <div
            ref={filterRef}
            className="pil-filter pointer-events-none absolute left-2.5 z-30 flex flex-row items-center gap-1.5 lg:hidden"
          >
            <button
              onClick={() => setFilterTerbuka((v) => !v)}
              aria-expanded={filterTerbuka}
              className="pointer-events-auto flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[13.5px] font-semibold text-surface shadow-[0_14px_30px_-12px_rgb(22_33_28/0.7)] transition-transform duration-200 ease-jelly hover:scale-[1.03]"
            >
              <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden className="shrink-0">
                <path
                  d="M3 5.5h14M5.5 10h9M8 14.5h4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
              {bahasa === 'en' ? 'Filters' : 'Filter'}
            </button>

            {filterTampil && (
              <div
                data-menutup={filterMenutup ? '1' : undefined}
                className="kendali-peta pop-dari-kiri kaca pointer-events-auto flex min-w-0 max-w-[calc(100vw_-_7.5rem)] flex-row items-center gap-1 rounded-full p-1.5"
              >
                {kendaliFilter('turun')}
              </div>
            )}
          </div>

          {/* --- Sumber peta (tombol "!") ------------------------------------
              Pop-up MILIK KITA, bukan panel bawaan MapLibre. Panel bawaan itu
              (a) menganga terus karena MapLibre menambahkan sendiri kelas
              `compact-show`, (b) duduk di kiri-bawah tempat kendali peta, jadi
              ia menutupi kompas, dan (c) tombolnya ikut bergerak ke atas
              sehingga susah ditutup. Di sini arah bukanya bisa diatur: ponsel
              ke ATAS (tidak ada ruang ke kanan), desktop memanjang ke KANAN.
              Kontrol MapLibre-nya tetap terpasang dan tersembunyi - isinya
              wajib ada di DOM (ketentuan A.3, dijaga `audit-prd`). */}
          <div
            ref={atribusiRef}
            className="tombol-atribusi pointer-events-none absolute bottom-[6rem] left-2.5 z-30 lg:bottom-auto lg:left-4 lg:top-[4.75rem]"
          >
            <div className="relative">
              <button
                onClick={() => setAtribusiTerbuka((v) => !v)}
                aria-expanded={atribusiTerbuka}
                title={t.atribusiJudul}
                className={`pointer-events-auto grid h-10 w-10 cursor-pointer place-items-center rounded-full text-[13px] font-bold transition-all duration-200 ease-jelly hover:scale-[1.06] ${
                  atribusiTerbuka
                    ? 'kaca text-ink'
                    : 'bg-ink text-surface shadow-[0_12px_30px_-10px_rgb(22_33_28/0.7)]'
                }`}
              >
                i
              </button>
              {atribusiTerbuka && (
                <div className="kaca pop pointer-events-auto absolute bottom-full left-0 mb-2 w-[min(20rem,calc(100vw-1.5rem))] rounded-xl p-3.5 sm:bottom-0 sm:left-full sm:mb-0 sm:ml-2.5 lg:top-0 lg:bottom-auto">
                  <p className="eyebrow mb-2">{t.atribusiJudul}</p>
                  <ul className="flex flex-col gap-1">
                    {ATRIBUSI_PETA.map((a) => (
                      <li key={a.nama} className="text-[12px] leading-snug">
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-ink underline decoration-line-2 underline-offset-2 transition-colors hover:decoration-ink"
                        >
                          © {a.nama}
                        </a>
                        {a.lisensi && <span className="text-ink-3"> · {a.lisensi}</span>}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2.5 border-t border-line/70 pt-2 text-[11px] leading-snug text-ink-3">
                    {t.atribusiCatatan}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* --- Lembar simulasi ------------------------------------------
              Dipasang di dalam lapisan chrome tapi menembus bantalannya lewat
              `-mx-3`/`-mb-3`: lembar ini memang harus menempel tepi layar dari
              kiri ke kanan, sementara seluruh panel lain melayang dengan jarak.
              Itu bukan ketidakkonsistenan - lembar yang melayang terbaca sebagai
              satu panel lagi di antara panel lain, dan yang dituju justru
              sebaliknya: sekarang kita sedang mengerjakan SATU hal. */}
          {simulasiTerbuka && hexTerpilih && (
            <Suspense fallback={null}>
            <Simulasi
              h3={hexTerpilih}
              h3Blok={blokSimulasi}
              onLepasBlok={() => setBlokSimulasi(null)}
              h3Banding={hexBanding}
              onLepasBanding={() => {
                setHexBanding(null)
                peta.current?.highlight([hexTerpilih])
              }}
              onKeDetail={() => {
                setSimulasiTerbuka(false)
                setHexBanding(null)
                setPanelTerbuka(true)
              }}
              onTutup={() => {
                setSimulasiTerbuka(false)
                setHexBanding(null)
                setPanelTerbuka(true)
              }}
            />
            </Suspense>
          )}

          {nHeksagon === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 lg:right-[27rem]">
              <div className="kaca-tebal pointer-events-auto melayang max-w-md rounded-lg p-6">
                <p className="papan text-[19px]">{t.kosongJudul(frasaKawasan(kawasan))}</p>
                <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">{t.kosongIsi}</p>
                <code className="mt-3.5 block rounded-sm bg-surface-2 px-3.5 py-3 font-mono text-[13px] leading-relaxed text-ink-2">
                  cd pipeline
                  <br />
                  python s7_publish.py --muat
                </code>
              </div>
            </div>
          )}

          {/* --- Bilah navigasi bawah (ponsel) -----------------------------
              Pintu masuk ketiga bagian wajib dalam satu layar, dalam bentuk
              yang dikenal dari aplikasi peta: pil kaca mengambang, item tengah
              "Lokasi" menonjol. Ketukan membuka lembar pada tab itu; ketukan
              pada tab yang sedang aktif menutupnya.

              Tidak dirender saat simulasi terbuka: lembar simulasi menempel
              dasar layar dan bilah ini hanya akan berebut tempat dengannya. */}
          {!simulasiTerbuka && (
            <nav
              aria-label={t.navBawah}
              className="nav-peta pointer-events-auto absolute inset-x-2.5 z-40 flex items-stretch gap-0.5 rounded-lg kaca px-1 py-1.5 shadow-[0_16px_36px_-16px_rgb(22_33_28/0.5)] lg:hidden"
            >
              {/* Butir kiri PALING POJOK: Beranda - pulang ke halaman gerbang.
                  Menggantikan tombol kembali yang dulu di bilah atas, atas
                  permintaan pemilik repo ("kasih aja tombol home untuk kembali
                  ke landing page"). */}
              <button
                onClick={keLanding}
                aria-label={t.navBeranda}
                title={t.navBeranda}
                className="flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl px-0.5 py-1.5 text-ink-3 transition-colors hover:text-ink"
              >
                <svg width={26} height={26} viewBox="0 0 20 20" aria-hidden className="shrink-0">
                  <path
                    d="M3 8.6 10 3l7 5.6V16a1 1 0 0 1-1 1h-3.6v-4.4H7.6V17H4a1 1 0 0 1-1-1z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="text-[10.5px] font-semibold leading-none">{t.navBeranda}</span>
              </button>

              {URUTAN_NAV.map((k) => {
                const aktif = panelTerbuka && tab === k
                const pusat = k === 'ai'
                const label =
                  k === 'rekomendasi' ? t.navUntuk : k === 'daftar' ? t.navLokasi : t.navAI
                const nama =
                  k === 'rekomendasi' ? t.tabRekomendasi : k === 'daftar' ? t.tabDaftar : t.tabAI
                return (
                  <button
                    key={k}
                    onClick={() => pilihTabBawah(k)}
                    aria-current={aktif ? 'page' : undefined}
                    aria-label={nama}
                    className={
                      pusat
                        ? // SLOT-nya selebar tombolnya sendiri (`w-[6.75rem]`,
                          'relative flex w-[6.75rem] shrink-0 cursor-pointer items-center justify-center'
                        : `flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl px-0.5 py-1.5 transition-colors ${
                            // TANPA `bg-surface-2`: yang menandai butir aktif
                            // adalah pendarnya di IKON (`.sinar-ikon`), bukan
                            // kotak di belakangnya - permintaan 19 Sep 2026.
                            aktif ? 'text-ink' : 'text-ink-3'
                          }`
                    }
                  >
                    {/* Loconomics AI: bulatan BESAR seperti FAB MAPID, tanpa
                        label, dan bilahnya ikut MEMBESAR di tengah - piringan
                        kaca seukuran ~1,2x bulatannya dipasang di belakangnya
                        dengan bahan yang SAMA dengan bilah (`kaca`), jadi
                        keduanya terbaca sebagai satu bilah yang melingkar di
                        tengah, bukan tombol yang menempel di atas bilah.

                        `bottom-[-0.375rem]` (6px = `py-1.5` bilah) menaruh sisi
                        BAWAHnya rata dengan dasar bilah, sementara atasnya
                        menembus keluar. Warna tombolnya `bg-ink text-surface`:
                        token itu memang TERBALIK mengikuti tema - gelap di mode
                        terang, terang di mode gelap - jadi ia selalu mencolok
                        tanpa satu pun aturan tema tambahan. */}
                    {pusat ? (
                      <span className="absolute bottom-[-0.375rem] left-1/2 grid -translate-x-1/2 place-items-center">
                        <span
                          aria-hidden
                          className="kaca absolute h-[7rem] w-[7rem] rounded-full"
                        />
                        <span
                          className={`ai-pendar relative grid h-[5.5rem] w-[5.5rem] place-items-center rounded-full bg-ink text-surface transition-transform duration-300 ease-jelly ${
                            aktif ? 'scale-105' : ''
                          }`}
                        >
                          <IkonNav k={k} ukuran={32} />
                        </span>
                      </span>
                    ) : (
                      <>
                        <span
                          className={`isolate relative grid place-items-center ${aktif ? 'sinar-ikon' : ''}`}
                        >
                          <IkonNav k={k} ukuran={29} />
                        </span>
                        <span className="text-[10.5px] font-semibold leading-none">{label}</span>
                      </>
                    )}
                  </button>
                )
              })}

              {/* Butir kanan PALING POJOK: akun, meniru tombol profil MAPID.
                  Tamu mendapat lingkaran berpendar (ajakan mendaftar); pelanggan
                  lingkaran berinisial. Menunya membuka KE ATAS. */}
              <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-0.5 py-1.5">
                <TombolAkun varian="bar" arahMenu="atas" />
                <span className="text-[10.5px] font-semibold leading-none text-ink-3">
                  {t.navAkun}
                </span>
              </div>
            </nav>
          )}
        </div>

        {/* --- Sumber data --------------------------------------------------
            Jawaban atas satu pertanyaan yang ditanyakan tiap juri dan tiap
            calon pengguna yang serius: "angka ini dari mana". Seluruh isinya
            dibangkitkan pipeline; tidak ada satu pun angka di sana yang
            diketik tangan. */}
        {sumberTerbuka && (
          <div
            data-menutup={menutupSumber ? '1' : undefined}
            className="tirai-peta fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 backdrop-blur-[3px] sm:p-6"
            onClick={tutupSumber}
            role="dialog"
            aria-modal="true"
            aria-label={t.sumberData}
          >
            <div
              className="tirai-peta-panel kaca-tebal my-auto w-[54rem] max-w-full overflow-hidden rounded-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <Suspense fallback={null}>
                <SumberData onTutup={tutupSumber} />
              </Suspense>
            </div>
          </div>
        )}

        {/* --- Diagram kuadran penuh --------------------------------------- */}
        {kuadranPenuh && (
          <div
            data-menutup={menutupKuadran ? '1' : undefined}
            className="tirai-peta fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-3 backdrop-blur-[3px] sm:items-center sm:p-6"
            onClick={tutupKuadran}
            role="dialog"
            aria-modal="true"
            aria-label={t.diagramKuadran}
          >
            <div
              className="tirai-peta-panel kaca-tebal my-auto flex w-[52rem] max-w-full flex-col overflow-hidden rounded-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-baseline justify-between gap-4 border-b border-line/70 px-4 py-4 sm:gap-6 sm:px-6 sm:py-5">
                <div>
                  <h2 className="papan text-[19px]">{t.diagramJudul(kawasan)}</h2>
                  <p className="mt-1 max-w-[42ch] text-[13.5px] leading-snug text-ink-2">
                    {t.diagramIsi}
                  </p>
                </div>
                <button
                  onClick={tutupKuadran}
                  className="shrink-0 cursor-pointer rounded-full border border-line px-4 py-1.5 text-[13.5px] font-medium transition-colors hover:bg-surface-2"
                >
                  {t.tutup}
                </button>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-5 p-6 lg:flex-row lg:items-start">
                <KompasKuadran
                  besar
                  saring={saringKuadran}
                  onSaring={setSaringKuadran}
                  sebar={diagram?.titik}
                  batas={diagram ? { x: diagram.batas_x, y: diagram.batas_y } : undefined}
                  onPilih={(h3) => {
                    setHexTerpilih(h3)
                    tutupKuadran()
                  }}
                />
                {/* Kolom kanan: penjelasan sumbu. Dipindah ke samping, bukan di
                    bawah - di bawah ia yang membuat dialognya melebihi tinggi
                    layar dan memaksa scroll. */}
                <div className="min-w-0 flex-1 lg:max-w-[19rem]">
                  <div className="rounded-md border border-line/70 bg-surface-2/60 p-4">
                    <h3 className="eyebrow mb-2">{t.caraBaca}</h3>
                    <p className="text-[13px] leading-relaxed text-ink-2">{t.caraBaca1}</p>
                    {t.caraBaca2 && (
                      <p className="mt-2.5 text-[13px] leading-relaxed text-ink-2">{t.caraBaca2}</p>
                    )}
                    {diagram && (
                      <p className="mt-2 text-[12px] leading-snug text-ink-3">
                        {t.diagramBatas(
                          diagram.batas_x === null ? '—' : diagram.batas_x.toFixed(2),
                          diagram.batas_y === null ? '—' : diagram.batas_y.toFixed(2),
                        )}
                      </p>
                    )}

                    <div className="mt-3 space-y-1.5 border-t border-line/60 pt-3">
                      <p className="eyebrow">{t.sebarKuadran}</p>
                      {sebarKuadran.map((b) => (
                        <div key={b.kunci} className="flex items-center gap-2 text-[12.5px]">
                          <span
                            aria-hidden
                            className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                            style={{ background: KUADRAN[b.kunci].warna }}
                          />
                          <span className="min-w-0 flex-1 truncate font-medium text-ink-2">
                            {namaZona(b.kunci)}
                          </span>
                          <span className="tabular shrink-0 text-ink-3">
                            {t.kuadranJumlah(b.n, b.pct.toFixed(1))}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Sumbu datar itu SETENGAH tesis produk ini, dan sampai hari
                        ini dua dari lima bahannya kosong — termasuk keduanya yang
                        menilai tampilan secara langsung. */}
                    {frasaSumbuX.length > 0 && (
                      <div className="mt-3 space-y-1.5 border-t border-line/60 pt-2.5">
                        <p className="eyebrow">{t.sumbuDatarApa}</p>
                        {frasaSumbuX.map((k) => (
                          <p key={k} className="text-[12.5px] leading-snug text-ink-3">
                            {k}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="mt-3.5 text-[12.5px] leading-snug text-ink-3">
                    {diagram
                      ? t.diagramKaki(diagram.titik.length.toLocaleString(t.locale))
                      : t.memuatTitik}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {komparasiTerbuka && baki.length >= 2 && (
        <Suspense fallback={null}>
        <DialogKomparasi
          h3={baki}
          onTutup={() => setKomparasiTerbuka(false)}
          onPilih={(h3) => {
            setKomparasiTerbuka(false)
            setHexTerpilih(h3)
            setPanelTerbuka(true)
            peta.current?.fokusHeksagon(h3)
          }}
        />
        </Suspense>
      )}

      {kabarPin && (
        <KabarPin
          key={kabarPin.kunci}
          h3={kabarPin.h3}
          baru={kabarPin.baru}
          onTutup={() => setKabarPin(null)}
        />
      )}
      {pantauanTerbuka &&
        (premium ? (
          <Suspense fallback={null}>
          <DialogPantauan
            kawasan={kawasan}
            onTutup={() => setPantauanTerbuka(false)}
            onBandingkanSemua={(ids) => {
              setBaki(ids)
              setPantauanTerbuka(false)
              setKomparasiTerbuka(true)
            }}
            onPilih={(h3) => {
              setPantauanTerbuka(false)
              setHexTerpilih(h3)
              setPanelTerbuka(true)
              peta.current?.fokusHeksagon(h3)
            }}
          />
          </Suspense>
        ) : (
          <AjakanPantauan onTutup={() => setPantauanTerbuka(false)} />
        ))}
    </>
  )
}

function AjakanPantauan({ onTutup }: { onTutup: () => void }) {
  const t = useTeks(K_APP)
  const { akun, mintaLangganan, mintaMasuk } = useSesi()
  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-ink/45 p-6 backdrop-blur-[4px]"
      onClick={onTutup}
      role="dialog"
      aria-modal="true"
      aria-label={t.tersimpan}
    >
      <div
        className="kaca-tebal melayang w-[28rem] max-w-full overflow-hidden rounded-xl p-7 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-ink text-surface">
          <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
            <path d="M6 9V6.5a4 4 0 0 1 8 0V9" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <rect x="4.5" y="9" width="11" height="7.5" rx="2" fill="currentColor" />
          </svg>
        </span>
        <h2 className="papan text-[19px]">{t.ajakanJudul}</h2>
        <p className="mx-auto mt-2 max-w-[36ch] text-[13.5px] leading-relaxed text-ink-2">
          {t.ajakanIsi}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button
            onClick={onTutup}
            className="cursor-pointer rounded-full border border-line px-4 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-2"
          >
            {t.nanti}
          </button>
          <button
            onClick={() => {
              onTutup()
              if (akun) mintaLangganan(t.ajakanLangganan)
              else mintaMasuk(t.ajakanMasuk)
            }}
            className="cursor-pointer rounded-full bg-ink px-5 py-2 text-[13px] font-semibold text-surface transition-transform duration-300 ease-jelly hover:scale-[1.03]"
          >
            {akun ? t.jadiPremium : t.daftarSekarang}
          </button>
        </div>
      </div>
    </div>
  )
}



