/**
 * Kerangka aplikasi.
 *
 * Tiga bagian yang WAJIB ada menurut ketentuan lomba, semuanya terlihat sekaligus
 * tanpa berpindah halaman:
 *
 *   1. Peta Interaktif    — PetaInteraktif.tsx   (latar penuh)
 *   2. Insight / Analisis — PanelInsight.tsx     (panel kanan, bisa dilipat)
 *   3. Antarmuka AI       — PanelAI.tsx          (tab kedua di panel kanan)
 *
 * Menaruh ketiganya dalam satu layar bukan sekadar tata letak. Rantainya:
 * AI menggerakkan peta, peta memilih heksagon, heksagon mengisi panel insight.
 * Kalau ketiganya terpisah halaman, rantai itu putus dan demo kehilangan alurnya.
 *
 * TATA LETAK: peta mengisi seluruh layar, chrome melayang di atasnya.
 *
 * Seluruh chrome duduk di satu lapisan `pointer-events-none` — hanya panelnya
 * sendiri yang menerima klik, jadi peta tetap bisa digeser di sela-selanya.
 *
 * Tiga keputusan yang diambil setelah melihat versi pertama dipakai:
 *
 *   - Panel kanan BISA DILIPAT. Ia 25rem dan tidak pernah pergi; di layar 1280
 *     itu memakan sepertiga peta untuk daftar yang kadang cuma dilihat sekali.
 *   - Konsultan AI keluar dari kaki panel kanan jadi tombol melayang sendiri.
 *     Sebagai laci, ia berebut tinggi dengan daftar lokasi dan dua-duanya kalah.
 *   - Pencarian ada di bilah atas. Sebelumnya satu-satunya cara berpindah tempat
 *     adalah dropdown kawasan, padahal yang dicari orang biasanya nama stasiun.
 */

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
  KAWASAN_PILOT,
  KUADRAN,
  SEMUA_KAWASAN,
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
// Gerbang dan Simulasi dimuat MALAS, dan itu penghematan yang nyata, bukan
// hiasan: Gerbang menyeret GSAP + ScrollTrigger + 2.000 baris scrollytelling
// yang TIDAK PERNAH dirender untuk orang yang kembali (refresh langsung ke
// peta), dan Simulasi hanya hidup saat lembarnya dibuka. Keduanya keluar dari
// bundel awal; peta mendapat utas utamanya lebih cepat.
const Gerbang = lazy(() => import('./components/Gerbang'))
import { PERISTIWA_BUKA_PETA, TombolAkun, useSesi, type DetailBukaPeta } from './components/Akun'
import { useBahasa, useTema, useTeks, type Bahasa } from './lib/bahasa'
import { MenuKawasan } from './components/Premium'
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
/**
 * Peta dimuat MALAS, dan ini penghematan terbesar di seluruh berkas.
 *
 * MapLibre GL sendirian hampir satu megabyte, dan halaman perkenalan SENGAJA
 * tidak memakainya sama sekali (lihat CLAUDE.md: "Halaman gerbang tidak memuat
 * MapLibre"). Selama impornya statis, janji itu benar untuk RENDER tetapi bohong
 * untuk UNDUHAN: berkasnya tetap ikut di bundel pertama, dan orang yang baru
 * membuka landing page membayar ongkosnya sebelum melihat satu pun heksagon.
 *
 * Tipenya diimpor terpisah dengan `import type` - itu dihapus saat kompilasi,
 * jadi ia tidak menyeret modulnya kembali ke bundel utama.
 */
const PetaInteraktif = lazy(() => import('./components/PetaInteraktif'))
import { Glif, Menu, MenuPengaturan, PapanNama, PilihBasemap } from './components/primitif'

/** Layer yang diwarnai menurut kuadran — hanya di sini Kompas benar. */
/**
 * Layer yang isian petanya benar-benar diwarnai menurut kuadran.
 *
 * `risk_radar` dikeluarkan 22 Agustus 2026: sejak ia diwarnai oleh indeks churn,
 * Kompas di sampingnya menerangkan warna yang sudah tidak ada di layar. Itu
 * persis keluhan "RiskRadar kelihatan sama saja dengan Opportunity Score" - keduanya
 * memang menampilkan legenda yang sama.
 *
 * `hidden_gem` tetap di sini: gradasinya berjalan dari warna lembut ke warna
 * penuh kuadran HIDDEN_GEM, jadi Kompas masih menjelaskan warnanya.
 */
const LAYER_KUADRAN: NamaLayer[] = ['opportunity', 'hidden_gem']

/*
 * `GAYA_GELAP` DICABUT 11 Sep 2026, dan ini kali kedua ia dicabut - jadi
 * alasannya layak ditulis lengkap supaya tidak dikembalikan untuk ketiga kali.
 *
 * Ia dulu menurunkan terangnya chrome dari gaya basemap: memilih basemap Gelap
 * menggelapkan seluruh panel. Pencabutan PERTAMA (9 Sep) dibatalkan karena
 * penggantinya "gelap tanpa syarat", dan itu memang salah - kaca gelap di atas
 * basemap terang membuat chrome dan petanya terbaca sebagai dua produk yang
 * ditempel.
 *
 * Yang berbeda kali ini: penggantinya bukan "tanpa syarat" melainkan SAKELAR
 * yang dipegang pembacanya (`useTema`). Keberatan lama tetap benar dan tetap
 * bisa dijawab - orang yang memilih basemap gelap tinggal menekan sakelarnya -
 * dan sekarang orang yang menginginkan kebalikannya juga punya jalan. Yang
 * dulu tidak punya jalan sama sekali: halaman gerbang, yang tidak punya
 * basemap untuk diikuti.
 */

/** Indeks H3 resolusi 9: 15 digit heksadesimal. Dipakai pencarian. */
const POLA_H3 = /^[0-9a-f]{15}$/i

// ---------------------------------------------------------------------------
// Keadaan tampilan yang bertahan melewati refresh
// ---------------------------------------------------------------------------

/**
 * Menekan F5 di peta harus kembali ke PETA, bukan ke halaman perkenalan.
 *
 * Sebelumnya `gerbang` selalu lahir `true`, jadi setiap refresh melempar
 * orangnya kembali ke awal - dan bersama gerbangnya ikut hilang kawasan yang
 * sedang dilihat, layer yang sedang dipilih, dan heksagon yang sedang dibaca.
 * Untuk halaman yang dipakai sambil membandingkan beberapa lokasi, itu bukan
 * gangguan kecil; itu kehilangan pekerjaan.
 *
 * DUA penyimpanan, dan pembagiannya yang penting:
 *
 *   sessionStorage  `masuk` - sudahkah orang ini melewati gerbang DI SESI INI
 *   localStorage    kawasan, layer, gaya - latar kerjanya
 *
 * Sebabnya dua permintaan yang terdengar berlawanan tetapi sebenarnya tidak:
 * "refresh jangan kembali ke landing" dan "pertama kali masuk harus selalu
 * lewat landing". Keduanya bisa dipenuhi sekaligus karena MENEKAN F5 dan
 * MEMBUKA WEB adalah dua hal berbeda - dan sessionStorage persis membedakannya:
 * ia bertahan menembus refresh di tab yang sama, dan kosong di tab baru,
 * jendela baru, atau esok hari.
 *
 * Latar kerjanya tetap di localStorage. Yang diminta bukan melupakan kawasan
 * yang sedang dilihat, melainkan tidak melewati perkenalannya - jadi orang yang
 * kembali besok mendapat gerbang dulu, lalu petanya terbuka di kawasan dan
 * layer yang ia tinggalkan.
 *
 * Yang TIDAK disimpan: apa pun tentang akun. Tiket punya kuncinya sendiri di
 * `lib/api.ts`, dan tingkat langganan tidak pernah disimpan di peramban sama
 * sekali - ia dibaca ulang dari backend tiap kali memuat. Tingkat yang bisa
 * disunting dari devtools bukan tingkat.
 */
const KUNCI_TAMPILAN = 'loconomics.tampilan.v1'

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

/**
 * Nilai kawasan tersimpan boleh berisi BEBERAPA nama dipisah koma — itu bentuk
 * yang dipakai filter multi-kawasan.
 *
 * Versi sebelumnya hanya menerima satu nama pilot atau string kosong, jadi
 * setiap saringan gabungan dibuang diam-diam saat refresh dan petanya melompat
 * balik ke seluruh kawasan. Yang hilang bukan kenyamanan: multi-kawasan itu
 * baris pertama tabel fitur berbayar, dan fitur berbayar yang tidak selamat
 * dari F5 terbaca sebagai fitur yang rusak.
 *
 * Tiap potongan tetap diperiksa satu per satu — nama tak dikenal (misalnya dari
 * versi lama aplikasi ini) dibuang, sisanya dipertahankan.
 */
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
      // Dibaca dari sessionStorage, BUKAN dari `t`. Nilai `masuk` yang lama
      // mungkin masih tertinggal di localStorage dari versi sebelum pembagian
      // ini; membacanya akan diam-diam melewati gerbang untuk orang yang justru
      // baru membuka webnya.
      masuk: bacaSesiMasuk(),
      kawasan: bersihkanKawasan(t.kawasan),
      layer: t.layer && t.layer in LAYER ? t.layer : undefined,
      // DITULIS sejak layer tematik bisa dimatikan, tetapi baru DIBACA 9 Sep
      // 2026. Sebelumnya `layerNyala` ikut disimpan tiap perubahan dan tidak
      // pernah dipulihkan: layer yang dinyalakan orang mati lagi sesudah
      // refresh, tanpa satu pun galat - dan audit menangkapnya sebagai
      // "PriceLens tidak dipanggil untuk pelanggan", gejala yang menunjuk ke
      // tempat yang salah sama sekali.
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

/**
 * Tiga tab panel kanan, URUT dari kiri ke kanan.
 *
 * Urutan ini bukan cuma urutan tombol: ia juga yang menentukan dari sisi mana
 * isi tab masuk. Tab di sebelah kanan tab yang aktif menunggu di kanan, yang di
 * kiri menunggu di kiri - jadi isinya selalu datang dari arah yang sama dengan
 * geseran penunjuknya. Satu larik untuk keduanya supaya tidak bisa berselisih.
 */
const URUTAN_TAB = ['rekomendasi', 'daftar', 'ai'] as const
type NamaTab = (typeof URUTAN_TAB)[number]

// ---------------------------------------------------------------------------
// Pencarian
// ---------------------------------------------------------------------------

type Hasil =
  | { jenis: 'kawasan'; nama: string; moda: string }
  | { jenis: 'simpul'; simpul: SimpulTransit }
  | { jenis: 'heksagon'; h3: string }

/**
 * Pencarian atas data sendiri, bukan geocoder.
 *
 * Yang bisa dicari: enam kawasan pilot, seluruh simpul transit yang dikenal
 * backend, dan indeks H3 kalau seseorang menempelkannya dari laporan. TIDAK ada
 * pencarian alamat bebas — itu butuh layanan geocoding pihak ketiga, dan
 * ketentuan lomba mengunci peta ini pada MAPID saja. Kotak yang menjanjikan
 * "cari alamat apa pun" lalu tidak menemukan apa-apa lebih buruk daripada kotak
 * yang jujur mencari tiga hal dan menemukan ketiganya.
 */
/**
 * Kalimat chrome aplikasi, dua bahasa. Kalimat yang datang dari backend -
 * catatan per heksagon, temuan, galat - TIDAK ada di sini; yang diterjemahkan
 * cuma bingkainya.
 */
const K_APP: Record<
  Bahasa,
  {
    cari: string
    kembaliGerbang: string
    tanpaLayer: string
    tabRekomendasi: string
    tabDaftar: string
    tabAI: string
    lipat: string
    bukaPanel: string
    bukaPanelDaftar: string
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
    lipat: 'Lipat panel',
    bukaPanel: 'Buka panel',
    bukaPanelDaftar: 'Buka panel daftar lokasi',
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
        Kuadran <strong className="font-semibold text-ink">tidak</strong> ditentukan oleh
        Opportunity Score saja. Sumbu tegak Opportunity Score, sumbu datar prestise visual,
        dan batas keduanya adalah <strong className="font-semibold text-ink">median</strong>{' '}
        seluruh heksagon — bukan angka bulat.
      </>
    ),
    caraBaca2:
      'Karena itu skor 58 bisa jatuh di Hidden Gem sementara 50 jatuh di Aman tapi Mahal: keduanya di atas median, dan yang membedakan prestise visualnya.',
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
    lipat: 'Collapse panel',
    bukaPanel: 'Open panel',
    bukaPanelDaftar: 'Open the locations panel',
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
        The quadrant is <strong className="font-semibold text-ink">not</strong> decided by the
        Opportunity Score alone. The vertical axis is the Opportunity Score, the horizontal axis
        is visual prestige, and the boundary on both is the{' '}
        <strong className="font-semibold text-ink">median</strong> across every hexagon —
        not a round number.
      </>
    ),
    caraBaca2:
      'That is why a score of 58 can land in Hidden Gem while 50 lands in Prestige Trap: both are above the median, and what separates them is visual prestige.',
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
}: {
  simpul: SimpulTransit[]
  onPilihKawasan: (nama: string) => void
  onPilihSimpul: (s: SimpulTransit) => void
  onPilihHeksagon: (h3: string) => void
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
    <div ref={wadah} className="relative min-w-0 flex-1 md:max-w-[19rem]">
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

/**
 * Bar komparasi — menggantikan ajakan simulasi di tengah bawah.
 *
 * KENAPA MENGGANTIKAN, bukan menumpuk. Keduanya menjawab pertanyaan yang
 * berbeda tentang hal yang berbeda: simulasi bertanya "kalau saya buka DI SINI",
 * komparasi bertanya "yang MANA dari beberapa ini". Menampilkan keduanya
 * sekaligus memaksa orang memilih dulu sebelum mengerjakan apa pun.
 *
 * Bar dibagi RATA sebanyak heksagon yang dipilih: dua jadi kiri-kanan, tiga jadi
 * kiri-tengah-kanan. Nomor kolomnya sama dengan nomor lencana di peta, dan itu
 * satu-satunya hal yang menghubungkan keduanya - kalau urutannya bergeser,
 * seluruh bar berhenti berarti.
 */
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
  /**
   * Kawasan yang sedang disaring. SEMUA_KAWASAN ('') = tidak disaring.
   *
   * Bawaannya sengaja "semua": layar pertama seharusnya memperlihatkan cakupan
   * produknya, bukan satu dari enam kawasan yang kebetulan ditulis pertama di
   * daftar. Menyempitkan ke satu kawasan adalah tindakan yang dipilih pengguna,
   * bukan keadaan yang ia warisi.
   */
  const [kawasan, setKawasan] = useState<string>(AWAL.kawasan ?? SEMUA_KAWASAN)
  const [layer, setLayer] = useState<NamaLayer>(AWAL.layer ?? 'opportunity')
  /**
   * Apakah layer tematik menyala. Bawaannya MATI.
   *
   * Peta yang langsung penuh 708 heksagon berwarna memaksa orang membaca
   * kesimpulan sebelum ia sempat mengenali di mana ia sedang melihat -
   * dan bagi yang baru pertama membuka, itu bukan peta melainkan grafik.
   *
   * Terpisah dari `layer` dan bukan `NamaLayer | null` dengan sengaja:
   * mematikan layer tidak boleh MELUPAKAN layer mana yang tadi dilihat.
   */
  const [layerNyala, setLayerNyala] = useState(AWAL.layerNyala ?? false)
  /**
   * Serapat apa nama tempat basemap ditampilkan.
   *
   * Bawaannya `normal` - yaitu persis seperti sebelum setelan ini ada, jadi
   * yang tidak pernah membukanya tidak melihat satu pun perubahan.
   */
  const [namaTempat, setNamaTempat] = useState<string>(AWAL.namaTempat ?? 'normal')
  const { tema, gantiTema } = useTema()
  /**
   * Apakah rute & kawasan jangkau digambar untuk heksagon yang dipilih.
   *
   * Bawaannya MATI, dan ia SENGAJA tidak disimpan ke localStorage: ini pilihan
   * per-lokasi, bukan latar kerja. Menyimpannya berarti membuka aplikasi besok
   * dengan rute yang tergambar untuk heksagon yang tidak sedang ditanyakan
   * siapa pun.
   */
  const [rutaTampil, setRutaTampil] = useState(false)
  // Yang tersimpan di localStorage tetap menang. Tanpa pilihan tersimpan,
  // basemap pertama DITURUNKAN DARI TEMA - gelap untuk gelap, `dasar` untuk
  // terang, pasangan yang sama dengan yang dipilih sakelar tema di bawah.
  //
  // Dulu bawaannya selalu 'gelap', dan di DEV SERVER itu tidak pernah terlihat
  // salah: StrictMode menjalankan efek penyelaras tema di bawah DUA kali saat
  // dipasang, jadi lintasan keduanya lolos dari penjaga "lewati yang pertama"
  // dan menukar basemapnya ke terang. Build produksi menjalankannya sekali -
  // orang yang kembali dengan tema terang membuka peta hitam di bawah panel
  // putih. Terlihat 11 Sep 2026 di `vite preview`, bukan di dev.
  const [gaya, setGaya] = useState<NamaGaya>(
    // `gayaSah` MEMETAKAN gaya yang sudah dipensiunkan, tidak membuangnya:
    // orang yang terakhir memakai "Jalan 2D" harus mendarat di "Jalan",
    // bukan dilempar ke bawaan yang tidak pernah ia pilih.
    (AWAL.gaya ? (gayaSah(AWAL.gaya) as NamaGaya) : undefined) ?? (tema === 'terang' ? 'dasar' : 'gelap'),
  )
  /** Mode 3D. Bawaannya datar: peta analitik dibaca dari atas, 3D dipilih sadar. */
  const [tigaDimensi, setTigaDimensi] = useState<boolean>(AWAL.tigaDimensi ?? false)
  const [hexTerpilih, setHexTerpilih] = useState<string | null>(null)

  /**
   * Bedah blok: tujuh petak res-10 di dalam heksagon terpilih, dan yang disorot.
   *
   * Hidup di App, bukan di panel, karena PETA yang menggambarnya sementara
   * TOMBOLNYA ada di panel. Dua pemakai, satu nilai - dan nilai yang disalin ke
   * dua tempat adalah nilai yang suatu saat berselisih. Alasan yang sama persis
   * dengan `profilRute` di bawah.
   *
   * Tidak disimpan ke localStorage, alasan yang sama dengan `rutaTampil`: ini
   * pilihan per-lokasi, bukan latar kerja.
   */
  const [blok, setBlok] = useState<BedahBlok | null>(null)
  const [blokTerpilih, setBlokTerpilih] = useState<string | null>(null)

  // Pilihan menampilkan rute berlaku untuk SATU heksagon. Berpindah heksagon
  // mengembalikannya ke mati - kalau tidak, heksagon berikutnya langsung
  // menggambar rutenya, dan gerbangnya jadi tidak ada gunanya.
  //
  // Blok ikut di sini, dan untuk blok ini bukan sekadar soal selera: petaknya
  // digambar dari koordinat heksagon LAMA. Dibiarkan hidup, tujuh petak
  // menggantung di tempat yang tidak sedang dibicarakan panel mana pun.
  useEffect(() => {
    setRutaTampil(false)
    setBlok(null)
    setBlokTerpilih(null)
  }, [hexTerpilih])

  /**
   * Memilih basemap ikut menyetel TEMA - arah kebalikan dari efek di atas, dan
   * dengan filosofi yang sama persis: titik berangkat, bukan kunci.
   *
   * Tanpa ini keduanya terasa tidak nyambung (dilaporkan pemilik repo): peta
   * gelap di bawah chrome terang terbaca sebagai dua produk yang ditempel, dan
   * satu-satunya cara menyelaraskannya adalah menemukan sakelar tema yang
   * tersembunyi di menu lain.
   *
   * Tidak bisa berputar: menyetel tema menjalankan efek di atas, dan efek itu
   * mengembalikan gaya yang SAMA untuk setiap kombinasi yang dihasilkan di
   * sini - satelit dibiarkan, gelap sudah gelap, terang bukan gelap.
   */
  const gantiGaya = useCallback(
    (g: NamaGaya) => {
      setGaya(g)
      const petaGelap = BASEMAP_GELAP.includes(g)
      if ((petaGelap ? 'gelap' : 'terang') !== tema) gantiTema()
    },
    [tema, gantiTema],
  )

  const [saringKuadran, setSaringKuadran] = useState<NamaKuadran | null>(null)
  const [nHeksagon, setNHeksagon] = useState<number | null>(null)
  const [kuadranPenuh, setKuadranPenuh] = useState(false)
  const [sumberTerbuka, setSumberTerbuka] = useState(false)
  // Daftar dulu, detail belakangan. Pertanyaan pertama pengguna adalah "yang mana
  // yang harus saya lihat", bukan "bagaimana lokasi ini" - dan layar kosong yang
  // menyuruh mengklik heksagon menjawab pertanyaan yang belum diajukan.
  /**
   * Dua tab, bukan tiga - dan "detail" BUKAN salah satunya.
   *
   * Detail heksagon dulu jadi tab sendiri, dan itu memaksa dua hal yang
   * canggung: tab yang mati sampai ada yang dipilih, dan label "Detail
   * heksagon" yang harus dibaca padahal orang sudah tahu apa yang baru saja
   * ia klik. Sekarang detail adalah LAPISAN DI DALAM daftar, dengan tombol
   * kembali - persis pola yang sudah dikenal dari daftar-ke-rincian di mana
   * pun. Slot yang dibebaskannya dipakai Konsultan AI, yang sebelumnya
   * menggantung sebagai kolom terpisah.
   */
  /**
   * Tab awal: DAFTAR, bukan rekomendasi — walau rekomendasi inti produknya.
   *
   * Untuk tamu, "Untuk Anda" hanya bisa menawarkan formulir pendaftaran, dan
   * layar pertama yang isinya formulir adalah layar yang ditutup. Daftar lokasi
   * langsung berguna tanpa akun, dan tab rekomendasinya duduk di sebelah kiri
   * daftar - terlihat sejak detik pertama.
   *
   * Yang SUDAH punya akun dipindahkan ke rekomendasi sekali oleh efek di bawah:
   * bagi mereka daftar itu memang sudah tersedia isinya.
   */
  const [tab, setTab] = useState<NamaTab>('daftar')
  /**
   * Tab yang PERNAH dibuka. Isinya dipasang saat pertama kali dibuka, lalu
   * TETAP terpasang - disembunyikan, bukan dicabut.
   *
   * Sebelum 11 Sep 2026 "Untuk Anda" dan "Daftar lokasi" dicabut dari DOM tiap
   * kali ditinggalkan. Dua akibatnya, dan keduanya melawan perpindahan yang
   * rapi: yang pergi tidak bisa dianimasikan keluar karena elemennya sudah
   * tidak ada, dan yang kembali MEMINTA ULANG datanya - `ambil()` tidak punya
   * cache - jadi tiap kembali ke daftar berarti layar tunggu lagi dan posisi
   * gulirnya hilang. Loconomics AI sudah lama tetap terpasang karena alasan
   * yang sama (riwayat percakapannya); sekarang ketiganya sama.
   *
   * Tidak semua dipasang sejak awal: "Untuk Anda" meminta rekomendasi ke
   * backend begitu dipasang, dan tamu yang tidak pernah membukanya tidak perlu
   * membayar permintaan itu. Disesuaikan saat render, bukan lewat efek - lewat
   * efek, bingkai pertama tab barunya kosong.
   */
  const [tabDikunjungi, setTabDikunjungi] = useState<ReadonlySet<NamaTab>>(() => new Set([tab]))
  if (!tabDikunjungi.has(tab)) setTabDikunjungi(new Set([...tabDikunjungi, tab]))
  const [panelTerbuka, setPanelTerbuka] = useState(true)
  /**
   * Kompas Kuadran / Legenda: sekarang dibuka lewat tombol, tidak berdiri terus.
   *
   * Bawaannya TERBUKA. Kompas adalah tesis produk ini - orang yang baru masuk
   * harus melihatnya tanpa mencari - tapi ia juga menutupi sepetak peta, dan
   * sekarang bisa disingkirkan.
   */
  // Bawaannya TERTUTUP sejak 24 Agustus 2026 - keputusan pemilik repo: layar
  // pertama harus milik petanya. Kompas tetap satu klik jauhnya, dan tombolnya
  // duduk persis di tempat kartunya akan muncul.
  /**
   * Panel mana yang sedang terbuka di tumpukan kiri - PALING BANYAK SATU.
   *
   * Dulu masing-masing tombol memegang keadaannya sendiri, dan akibatnya
   * terlihat langsung: membuka pemilih basemap mendorong isi ke kanan, lalu
   * membuka Kompas Kuadran mendorongnya LAGI ke kanan alih-alih menutup yang
   * pertama. Dua benda mengaku menempati ruang yang sama.
   *
   * Satu nilai untuk seluruh tumpukan membuat keadaan itu mustahil dinyatakan,
   * bukan sekadar dihindari.
   */
  const [panelKiri, setPanelKiri] = useState<'tidak' | 'kartu' | 'basemap'>('tidak')
  const panelKiriTerbuka = panelKiri === 'kartu'
  const [diagram, setDiagram] = useState<DiagramKuadran | null>(null)
  const [simpul, setSimpul] = useState<SimpulTransit[]>([])
  /**
   * Layar pembuka. Bawaannya MATI - ia bukan lagi layar pertama.
   *
   * Urutan lama: pembuka -> gerbang -> peta. Tiga layar berturut-turut sebelum
   * satu heksagon pun terlihat, dan yang pertama dari ketiganya memuat sesuatu
   * yang belum tentu jadi dilihat orangnya.
   *
   * Urutan sekarang: gerbang -> pembuka -> peta. Yang berubah cuma nilai awal
   * dua state di bawah ini; sisanya - termasuk `tampil` pada PetaInteraktif -
   * sudah menuliskan syaratnya sebagai "bukan pembuka DAN bukan gerbang", jadi
   * ia tetap benar tanpa disentuh.
   *
   * Layar pembuka menahan chrome, TIDAK menahan peta. Peta tetap dipasang di
   * belakang keduanya sejak render pertama, supaya MapLibre sudah selesai
   * mengunduh gaya dan tile pertama jauh sebelum ada yang menekan "Masuk".
   */
  const [pembuka, setPembuka] = useState(false)
  /**
   * Gerbang: halaman perkenalan, dan sekarang halaman pertama.
   *
   * Ditutup lewat tombol, dan sekali ditutup tidak pernah kembali selama sesi
   * ini - halaman perkenalan yang muncul lagi setiap kali orang menutup panel
   * berhenti jadi perkenalan dan mulai jadi penghalang.
   */
  const [gerbang, setGerbang] = useState(!AWAL.masuk)

  /**
   * Kelas tema dipasang di <body>, bukan cuma di wadah aplikasi.
   *
   * Ketiga dialog dirender lewat `createPortal` ke <body> - secara DOM mereka
   * di LUAR wadah aplikasi. Tanpa kelas di akar, dialognya tidak pernah ikut
   * gelap, dan yang terlihat panel putih mengambang di atas aplikasi gelap.
   *
   * DARI SAKELAR TEMA, bukan lagi dari gaya basemap (11 Sep 2026).
   *
   * Sampai hari ini terangnya chrome mengikuti basemap yang kebetulan dipilih:
   * memilih basemap Gelap menggelapkan seluruh panel. Itu pintar dan salah -
   * orang yang ingin basemap gelap dengan panel terang tidak punya cara
   * menyatakannya, dan gerbang tidak ikut sama sekali. Sekarang temanya berdiri
   * sendiri, bawaannya gelap, dan basemap cuma soal peta.
   *
   * Ini sekaligus memperbaiki bug yang dilaporkan pemilik repo dengan potret:
   * kolom nama pengguna dan sandi di dialog Masuk tampil sebagai BILAH PUTIH di
   * atas halaman yang hitam pekat. Sebabnya tempat dialognya berdiri - gerbang
   * membawa paletnya sendiri lewat kelas `.gerbang`, sementara dialognya
   * dirender `createPortal` ke <body>, di luar simpul itu. Dengan tema yang
   * berdiri sendiri, <body> dan gerbang selalu menyatakan hal yang sama.
   */
  useEffect(() => {
    document.body.classList.toggle('peta-gelap', tema === 'gelap')
    return () => document.body.classList.remove('peta-gelap')
  }, [tema])

  /**
   * Basemap IKUT saat temanya diganti - tapi hanya saat DIGANTI, bukan saat
   * dimuat.
   *
   * Keberatan lama masih berlaku dan masih benar: kaca gelap di atas basemap
   * terang membuat chrome dan petanya terbaca sebagai dua produk yang ditempel.
   * Yang salah dulu bukan menyelaraskan keduanya, melainkan MENGUNCI-nya - orang
   * yang ingin kombinasi lain tidak punya jalan.
   *
   * Jadi: sakelar tema menyelaraskan keduanya sebagai TITIK BERANGKAT, lalu
   * menu Basemap tetap berkuasa penuh sesudahnya. Efek ini hanya bekerja saat
   * temanya BENAR-BENAR berubah, jadi basemap yang dipulihkan dari localStorage
   * tidak pernah ditimpa hanya karena aplikasinya baru dimuat.
   *
   * Dibandingkan dengan tema SEBELUMNYA, bukan dengan bendera "jalan pertama".
   * Bendera itu cuma benar di produksi: StrictMode di dev menjalankan efeknya
   * dua kali saat dipasang, lintasan kedua lolos dari benderanya, dan dev
   * diam-diam menimpa basemap tersimpan sementara produksi tidak - dua perilaku
   * untuk kode yang sama. Tema sebelumnya sama di kedua lintasan itu.
   */
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

  /**
   * Profil rute yang sedang digambar: jalan kaki atau mobil.
   *
   * Tinggal di App, bukan di panel maupun di peta, karena KEDUANYA memakainya:
   * panel memilih dan menyebut angkanya, peta menggambar garisnya. Dua salinan
   * dari nilai yang sama adalah dua salinan yang suatu saat berselisih - dan
   * yang terlihat waktu itu garis mobil dengan keterangan jalan kaki.
   */
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
  } = useSesi()

  /**
   * Simpan lokasi lewat klik dua kali di peta.
   *
   * Penjaganya SAMA PERSIS dengan tombol "Simpan lokasi" di panel detail -
   * belum masuk diminta masuk, sudah masuk tapi belum berlangganan diminta
   * berlangganan. Disalin sengaja alih-alih dilonggarkan: kalau jalan pintas
   * ini punya syarat yang lebih longgar, "menyimpan lokasi butuh langganan"
   * berhenti benar, dan yang membuktikannya bukan uji melainkan pengguna.
   *
   * `catatSimpan()` yang membuat pinnya langsung muncul. Tanpa itu, pin baru
   * datang setelah muat ulang - dan pin yang menunggu muat ulang bukan fitur.
   */
  const simpanCepat = useCallback(
    async (h3: string) => {
      if (!akun) return mintaMasuk(t.simpanMasuk)
      if (!premium)
        return mintaLangganan(t.simpanPremium)
      try {
        await api.pantau(h3)
        catatSimpan()
      } catch {
        // Diam di sini disengaja. Klik dua kali di peta tidak punya tempat
        // menampilkan galat, dan satu-satunya sebab yang wajar - lokasinya
        // sudah tersimpan - bukan kabar yang perlu disampaikan sebagai galat.
        // Panel detail tetap melaporkan sebabnya kalau ditekan dari sana.
      }
    },
    [akun, premium, mintaMasuk, mintaLangganan, catatSimpan],
  )
  /**
   * Baki komparasi: heksagon yang dikumpulkan untuk dibandingkan berdampingan.
   *
   * Baki, bukan langsung buka dialog. Membandingkan menuntut MINIMAL DUA, dan
   * yang kedua dipilih dengan mengklik peta - jadi harus ada tempat yang
   * menampung yang pertama sementara orangnya mencari yang kedua, dan yang
   * mengingatkan bahwa ia sedang di tengah tindakan itu.
   */
  const [baki, setBaki] = useState<string[]>([])
  const [komparasiTerbuka, setKomparasiTerbuka] = useState(false)
  const [pantauanTerbuka, setPantauanTerbuka] = useState(false)

  const tambahBaki = useCallback((h3: string) => {
    setBaki((b) => {
      if (b.includes(h3)) return b.filter((x) => x !== h3)
      if (b.length >= MAKS_BANDING) return b
      // Heksagon PERTAMA yang masuk baki menutup panel kanan. Yang kedua harus
      // dipilih dari peta, dan panel selebar 25rem menutupi tepat bagian peta
      // tempat tetangga heksagon pertama berada - yaitu justru yang paling
      // masuk akal jadi pembandingnya.
      if (b.length === 0) setPanelTerbuka(false)
      return [...b, h3]
    })
  }, [])

  /**
   * Membuka simulasi = masuk mode fokus.
   *
   * Panel kanan ditutup, chip pertanyaan dan kartu Kompas disembunyikan. Bukan
   * demi kerapian: lembar simulasi menutupi separuh bawah layar, dan sisa
   * setengahnya harus berisi PETA - heksagon yang sedang disimulasikan beserta
   * tetangganya, karena membandingkannya bagian dari pekerjaannya. Chrome yang
   * tetap berdiri di situ cuma menyisakan sepetak peta yang terlalu sempit
   * untuk itu.
   */
  const bukaSimulasi = useCallback(() => {
    // Simulasi usaha BERBAYAR sejak 24 Agustus 2026. Penjaga backend-nya di
    // /hex/{h3}/simulasi; yang di sini cuma pintunya - non-pelanggan diarahkan
    // ke dialog langganan alih-alih ke lembar yang seluruh permintaannya 401.
    if (!premium) {
      if (akun) mintaLangganan('Simulasi usaha bagian dari Loconomics Premium.')
      else mintaMasuk('Buat akun dulu untuk menjalankan simulasi usaha.')
      return
    }
    setSimulasiTerbuka(true)
    setPanelTerbuka(false)
  }, [premium, akun, mintaLangganan, mintaMasuk])
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

  /**
   * Pintasan lokasi di jawaban AI ditekan.
   *
   * Petanya terbang dan heksagonnya TERPILIH - tapi tabnya TIDAK diganti, dan
   * itu keputusan yang sengaja. Melempar orang ke tab "Daftar lokasi" berarti
   * menutup percakapan yang barusan menyebut lokasi ini, dan pertanyaan
   * berikutnya hampir selalu tentang lokasi yang sama ("kenapa skornya
   * segitu?"). Panel detailnya cuma satu ketukan tab dari sini.
   */
  const keLokasiAI = useCallback((h3: string) => {
    setHexTerpilih(h3)
    setHexBanding(null)
    setSimulasiTerbuka(false)
    setPanelTerbuka(true)
    peta.current?.highlight([h3])
    peta.current?.fokusHeksagon(h3)
  }, [])

  /**
   * Kembali ke halaman perkenalan, atas permintaan eksplisit penggunanya.
   *
   * Penanda sesi ikut DIHAPUS. Tanpa itu, refresh berikutnya membacanya dan
   * melempar orangnya kembali ke peta - persis kebalikan dari yang baru saja
   * ia minta.
   *
   * LEWAT TIRAI, bukan pertukaran seketika (11 Sep 2026, permintaan pemilik
   * repo). Jalan MASUK sudah punya layar pembukanya sendiri - empat langkah,
   * kota heksagon yang dibangun - sementara jalan PULANG mengganti seluruh
   * layar dalam satu bingkai. Yang terbaca bukan "kembali", melainkan aplikasi
   * yang mendadak hilang.
   *
   * Tirainya heksagon yang MEKAR dari tengah sampai menutupi layar, lalu
   * memudar di atas halaman perkenalan yang animasi masuknya sudah berjalan di
   * baliknya. Dua fase, dua jam, dan keduanya dibersihkan saat komponen dilepas
   * supaya tidak ada `setState` yang mendarat di komponen yang sudah pergi.
   *
   * TIRAINYA MENUNGGU CHUNK-NYA. Fase kedua dulu dipatok ke 430 ms, dan itu
   * benar selama chunk gerbang sudah pernah diunduh - yaitu selama orang
   * datang ke peta LEWAT gerbang. Sesi yang dimulai di peta (refresh di peta)
   * belum pernah memuatnya: tirainya memudar tepat di atas fallback Suspense
   * yang masih menunggu, dan halaman perkenalannya baru muncul ~420 ms sesudah
   * tirainya MULAI memudar - di tema terang bahkan sesudah tirainya hilang
   * sama sekali. Terukur lewat pencatat per bingkai. Sekarang unduhannya
   * dimulai saat tombolnya ditekan, dan fase kedua menunggu KEDUANYA - tirai
   * sudah menutup dan chunk sudah tiba. `import()` yang sama dengan `lazy` di
   * kepala berkas, jadi Vite memberinya chunk yang sama; tidak ada yang pindah
   * ke bundel pertama.
   *
   * Yang TIDAK bisa dihapus dari sini: `lazy` yang belum pernah dirender tetap
   * menangguhkan satu kali walau modulnya sudah terunduh (React 19.2 membaca
   * hasil `import()` lewat `.then`, yang asinkron), jadi isi gerbang di jalur
   * dingin masih menyusul ±470 ms sesudah tirai mulai memudar - terukur di
   * build produksi. Yang membuatnya tidak terlihat: fallback-nya kini latar
   * `.gerbang` yang sama persis, jadi yang tersingkap halaman kosong berwarna
   * benar, lalu isi hero masuk dengan animasinya sendiri.
   */
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
      jamPulang.current.push(window.setTimeout(r, 430))
    })
    void Promise.all([chunk, tertutup]).then(() => {
      if (!hidupPulang.current) return
      selesaikan()
      setPulang('buka')
      jamPulang.current.push(window.setTimeout(() => setPulang(null), 430))
    })
  }, [])

  /**
   * Menekan "Masuk" di gerbang: gerbang pergi, layar pembuka mengambil alih.
   *
   * Keduanya disetel dalam satu penangan, jadi tidak pernah ada satu bingkai
   * pun di mana keduanya mati bersamaan - dan satu bingkai saja sudah cukup
   * untuk memperlihatkan peta secara kilat sebelum tirainya turun.
   *
   * `pilihan` datang dari dek kartu peta di gerbang: mengklik kartu Bekasi
   * RiskRadar harus membuka Bekasi dengan RiskRadar, bukan membuka keadaan
   * bawaan lalu meninggalkan orangnya mencari sendiri apa yang barusan ia lihat.
   * Petanya TIDAK diperintahkan terbang di sini - `gantiKawasan` yang biasanya
   * melakukannya butuh instance peta yang sudah hidup, sementara di sini
   * petanya masih di balik dua lapis tirai. Yang disetel cuma state-nya; peta
   * membaca `kawasan` sebagai prop dan memasang bingkainya sendiri saat muat.
   */
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

  /**
   * Pin lokasi tersimpan di peta - hanya untuk pelanggan.
   *
   * `sinyalSimpan` naik satu setiap kali ada yang disimpan atau dilepas, dari
   * mana pun (panel detail, dialog Tersimpan). Tanpa sinyal itu, pin baru
   * muncul setelah refresh - dan pin yang menunggu refresh bukan fitur.
   */
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
        if (batal) return
        peta.current?.setPin(
          b
            .filter((x): x is typeof x & { lat: number; lon: number } =>
              x.lat !== null && x.lon !== null,
            )
            .map((x) => ({ lat: x.lat, lon: x.lon, h3: x.h3_index })),
        )
      })
      .catch(() => {})
    return () => {
      batal = true
    }
  }, [premium, sinyalSimpan, gerbang])

  /**
   * Preferensi onboarding diterapkan SEKALI per perubahan, bukan tiap muat.
   *
   * Menyetel kawasan setiap kali halaman dibuka akan menyeret orang kembali ke
   * kawasan preferensinya justru saat ia sengaja sedang melihat kawasan lain.
   * Yang diinginkan cuma: begitu onboarding selesai (nilainya BERUBAH),
   * petanya pindah ke sana.
   */
  /**
   * Pemilik akun mendarat di rekomendasinya, SEKALI per sesi.
   *
   * `sekali` menjaganya tetap sekali: tanpa itu, setiap kali `akun` berubah -
   * termasuk sesudah menyimpan preferensi - tab orangnya
   * dilempar kembali ke rekomendasi di tengah ia mengerjakan hal lain.
   */
  const sudahKeRekomendasi = useRef(false)
  useEffect(() => {
    if (!akun || sudahKeRekomendasi.current) return
    sudahKeRekomendasi.current = true
    setTab('rekomendasi')
  }, [akun])

  const prefSebelum = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    // MENUNGGU akunnya benar-benar ada sebelum mulai mencatat.
    //
    // Versi pertama memakai `undefined` sebagai penanda "belum pernah lihat",
    // tetapi render pertama sudah menjalankan efek ini dengan `akun === null`
    // (tiketnya masih divalidasi). Penandanya habis di situ, lalu begitu akun
    // mendarat, kawasan preferensi terbaca sebagai PERUBAHAN - dan heksagon
    // yang baru saja dipulihkan dari refresh ikut dibersihkan. Terukur: panel
    // detail selalu kembali ke daftar sesudah refresh.
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
      // Selagi simulasi terbuka, klik di peta berarti "bandingkan dengan yang
      // ini" - BUKAN "ganti subjeknya". Mengganti subjek di tengah simulasi
      // akan membuang seluruh asumsi yang baru saja disetel, dan itu justru
      // kebalikan dari yang diinginkan orang yang sedang membanding-bandingkan.
      if (simulasiTerbuka) {
        // Heksagon LAIN jadi pembanding; heksagon yang sama tidak melakukan
        // apa-apa. Yang penting: selagi mode fokus, klik di peta TIDAK PERNAH
        // menutup lembar simulasi. Versi pertama membiarkannya jatuh ke cabang
        // bawah, jadi mengklik heksagon yang sedang disimulasikan justru
        // membatalkan simulasinya - kebalikan dari yang dimaksud.
        if (h3 && h3 !== hexTerpilih) {
          setHexBanding(h3)
          peta.current?.highlight([hexTerpilih, h3].filter(Boolean) as string[])
        }
        return
      }

      // Selagi BAKI KOMPARASI terisi, klik di peta berarti "masukkan yang ini
      // juga". Tanpa cabang ini fiturnya buntu total, dan buntunya diam-diam:
      // menambahkan heksagon pertama menutup panel kanan (supaya petanya
      // terlihat), tetapi tombol "Bandingkan lokasi ini" HANYA hidup di dalam
      // panel itu. Jadi tidak ada satu pun jalan menambahkan yang kedua -
      // bakinya mentok di satu heksagon dan tombol "Bandingkan 1" mati
      // selamanya, sementara bakinya sendiri tertulis "Klik heksagon lain di
      // peta untuk membandingkan".
      //
      // Janji itu yang sekarang ditepati. Bakinya sendiri yang mengubah arti
      // klik, jadi tidak ada mode tersembunyi: selama ada yang di baki,
      // petanya memang sedang dipakai memilih pembanding.
      if (baki.length > 0 && h3) {
        // Yang SUDAH di baki cuma disorot, tidak dikeluarkan. `tambahBaki`
        // memang mengungkit, dan itu benar untuk tombol - tapi di peta, klik
        // pada heksagon yang sedang dibandingkan jauh lebih sering berarti
        // "lihat yang ini" daripada "batalkan yang ini". Yang mengeluarkan
        // tetap ada dan terlihat: tanda x di kolomnya sendiri.
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
        peta.current?.fokusHeksagon(h3)
      }
    },
    [simulasiTerbuka, hexTerpilih, baki, tambahBaki],
  )

  /**
   * Lepas pilihan heksagon. Satu tempat, dipakai tombol X dan tombol Esc.
   *
   * Dipisah jadi fungsi sendiri karena ia dipanggil dari tiga tempat, dan
   * versi sebelumnya menuliskan isinya sebaris di dalam onClick panel kanan -
   * jadi tombol X di peta akan jadi salinan keempat yang harus diingat untuk
   * ikut berubah.
   *
   * Ia TIDAK menyentuh baki komparasi: melepas heksagon yang sedang dilihat
   * tidak sama dengan membatalkan perbandingan yang sedang disusun.
   */
  const lepasPilihan = useCallback(() => {
    setHexTerpilih(null)
    setHexBanding(null)
    setSimulasiTerbuka(false)
    peta.current?.highlight([])
  }, [])

  /**
   * Esc melepas apa pun yang sedang terbuka, dari yang paling dalam ke luar.
   *
   * Urutannya penting: kalau simulasi terbuka, Esc menutup simulasi dan
   * MEMBIARKAN heksagonnya terpilih. Menutup keduanya sekaligus membuat satu
   * ketukan membatalkan dua keputusan, dan yang kedua tidak diminta.
   */
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

  /**
   * Bawa kamera ke kawasan `v`. Dipisah dari `gantiKawasan` dengan sengaja.
   *
   * Kalau ia tinggal di dalam `gantiKawasan`, satu-satunya cara kamera pindah
   * adalah lewat seseorang MENGKLIK pemilih kawasan - dan kawasan yang
   * dipulihkan dari localStorage tidak pernah lewat situ. Akibatnya persis
   * jebakan basemap gelap yang sudah pernah kena: chip di bilah atas menulis
   * "Bekasi", petanya diam di Jakarta, dan layarnya kosong melompong tanpa satu
   * pun galat, karena heksagon Bekasi memang dua puluh kilometer di luar layar.
   */
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
    // Beberapa kawasan sekaligus: bingkai yang memuat SEMUANYA. Tanpa ini peta
    // diam di tempat saat kawasan kedua ditambahkan - dan Bekasi ke Depok Baru
    // berjarak dua puluh kilometer, jadi separuh yang baru saja diminta berada
    // di luar layar tanpa ada yang memberi tahu.
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

  /**
   * Muatan heksagon PERTAMA sekaligus jadi tanda petanya sudah bisa diperintah.
   *
   * Tidak ada prop `onSiap`, dan menambahnya cuma untuk ini berarti satu jalur
   * lagi yang harus dijaga tetap benar. Datangnya heksagon sudah membuktikan
   * hal yang sama - peta ada, gayanya termuat, sumbernya terpasang - dan ia
   * datang tepat sekali per kawasan.
   */
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

  /**
   * "Simpan & buka peta" dari langkah preferensi usaha.
   *
   * Didengarkan di sini karena App yang memiliki peta dan gerbang; dialognya
   * tinggal di SesiProvider, di atas App. Dari gerbang: masuk ke peta di
   * kawasan pilihannya. Dari peta yang sudah hidup: terbang ke sana. Tanpa
   * kawasan: tetap dibuka - orangnya menekan "buka peta", bukan "tutup".
   */
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

  // Titik kuadran diminta sekali per kawasan, bukan saat diagram penuh dibuka.
  //
  // Percobaan pertama menundanya sampai modal dibuka, dan itu salah: Kompas kecil
  // memakai data yang sama untuk menaruh titik heksagon terpilih, jadi titiknya
  // tidak pernah muncul sampai seseorang kebetulan membuka diagram penuh dulu.
  // Satu permintaan per kawasan, dipakai dua tempat, dan backend sudah men-cache-nya.
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

  /**
   * Sumbu datar diagram ini berdiri di atas bahan apa.
   *
   * Ikut TERSARING KAWASAN, karena backend menghitungnya dari titik yang
   * dikembalikan - keterangan sumbu harus menerangkan diagram yang sedang
   * dilihat orangnya, bukan basis data seluruhnya. Larik kosong = kelima
   * bahannya terukur dan tidak ada yang perlu dinyatakan.
   */
  const frasaSumbuX = useMemo(
    () => frasaPrestise(diagram?.cakupan_prestise, 'wilayah', bahasa),
    [diagram, bahasa],
  )

  /**
   * Skor ringkas untuk bar komparasi, diambil dari titik kuadran yang SUDAH
   * dimuat. Tidak ada permintaan tambahan: bar cuma perlu angka dan kuadran,
   * dan keduanya sudah ada di tangan sejak Kompas dimuat.
   */
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

  /**
   * Prop pane tab yang STABIL - fungsi dan objek yang tidak dibuat ulang tiap
   * render.
   *
   * Ada karena ketiga pane kini tetap terpasang. Tiap `setTab` merender ulang
   * App, dan tanpa ini React ikut merender ulang seluruh isi pane yang sedang
   * tidak terlihat - 200 baris daftar lokasi, panel AI, rekomendasi - karena
   * fungsi sebaris seperti `onPilih={(h3) => ...}` selalu fungsi yang BARU.
   * Terukur di dev: bingkai pertama sesudah klik tab 350 ms (tugas panjang
   * ~300 ms), sementara kode sebelum pane dipertahankan 33 ms. Transisinya baru
   * mulai sesudah tugas itu selesai, jadi yang terasa bukan elegan melainkan
   * berat. Keempat komponennya dibungkus `memo` di berkasnya masing-masing;
   * yang di sini memastikan bungkus itu punya sesuatu yang bisa disamakan.
   */
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

  return (
    <>
      {gerbang && (
        // Fallback berwarna latar gerbang, bukan putih: kedipan putih satu
        // bingkai saat chunk-nya diunduh terbaca sebagai kerusakan.
        //
        // Warnanya DIPINJAM dari `.gerbang` itu sendiri, bukan ditulis. Dulu
        // `bg-[#eaf6f1]` - mint pucat dari masa gerbang cuma punya wajah
        // terang - dan sejak gerbang gelap jadi bawaan, fallback yang
        // dimaksudkan menyamarkan pemuatan justru jadi kilatan putih penuh:
        // terukur luminansi 218 dari 255 di tengah tirai pulang yang gelap,
        // dilaporkan pemilik repo sebagai "sekilas layarnya memutih". Kelas
        // `.gerbang` + `data-tema` membuat latarnya `--g-latar` yang sama
        // persis di kedua tema, jadi tidak ada salinan warna yang bisa
        // tertinggal lagi. `data-tema` dari React, bukan dari <html>:
        // atribut akar baru ditulis efek SESUDAH render pertama.
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
        </div>
      )}
      {pembuka && (
        // Fallback WAJIB legap, dan alasannya sama persis dengan alasan gerbang
        // di atas - tetapi akibatnya lebih buruk, jadi sempat luput.
        //
        // `fallback={null}` berarti: selama chunk Pembuka diunduh, TIDAK ADA
        // yang menutupi layar. Gerbang sudah pergi (gerbang=false) dan chrome
        // aplikasi sudah dirender, jadi yang terlihat aplikasinya sendiri -
        // lalu layar pembuka datang belakangan dan menutupinya, lalu pergi
        // lagi. Urutan yang terbaca "peta muncul - loading - peta lagi".
        //
        // Gejalanya cuma muncul di KUNJUNGAN PERTAMA: sesudah chunk-nya
        // ter-cache, Pembuka terpasang di commit yang sama dan tidak ada
        // jendela kosong sama sekali. Itu sebabnya ia terlihat seperti
        // keanehan acak, bukan bug - dan tidak ada uji yang menangkapnya.
        //
        // Terukur pada cache dingin: jendela kosongnya 315 ms.
        //
        // Legap SAJA belum cukup - warnanya harus warna layar pembuka itu
        // sendiri. Dulu `bg-[#dff6f0]`, mint dari masa layar pembuka masih
        // "langit mint". Sejak ia jadi kota malam (`bg-[#06090a]` di
        // Pembuka.tsx), jendela kosong itu jadi satu kilatan putih penuh di
        // antara gerbang gelap dan kota malam: terukur luminansi 241 dari 255,
        // 100% piksel terang, tiap kali "Masuk ke peta" ditekan pertama kali.
        // Layar pembuka gelap di KEDUA tema, jadi warnanya tidak ikut tema.
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
            onSimpanCepat={simpanCepat}
            profilRute={profilRute}
            onMuat={catatMuat}
            // Gelombang heksagon menunggu GERBANG juga, bukan cuma layar
            // pembuka. Kalau tidak, ia habis diputar di balik halaman
            // perkenalan dan penonton tidak pernah melihatnya - persis jebakan
            // yang sama yang dulu terjadi dengan layar pembuka.
            tampil={!pembuka && !gerbang}
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
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col gap-3 p-3 sm:gap-4 sm:p-4">
          {/* --- Bilah atas ------------------------------------------------ */}
          <header className="kaca pointer-events-auto relative z-30 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2.5 rounded-lg px-4 py-2.5 sm:px-5">
            {/* Tombol pulang BERDIRI SENDIRI di sebelah kiri logo, selalu
                terlihat. Versi sebelumnya menyembunyikannya di dalam logo dengan
                panah yang baru muncul saat disorot - dan tidak ada yang menyorot
                logo untuk mencari jalan pulang. Pintu yang harus ditemukan dulu
                bukan pintu. */}
            <button
              onClick={keLanding}
              title={t.kembaliGerbang}
              aria-label={t.kembaliGerbang}
              className="group grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full border border-line text-ink-2 transition-all duration-300 ease-jelly hover:-translate-x-0.5 hover:border-line-2 hover:text-ink"
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
            <div className="flex shrink-0 items-baseline gap-2.5">
              <PapanNama teks="Loconomics" />
            </div>

            <Cari
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

            <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
              <MenuKawasan nilai={kawasan} onUbah={gantiKawasan} />
              <Menu
                label="Layer"
                nilai={layerNyala ? layer : 'mati'}
                /* "Tanpa layer" DI ATAS, bukan di bawah: ia keadaan bawaan, dan
                   keadaan bawaan yang harus dicari dulu di ujung daftar bukan
                   keadaan bawaan yang berguna. */
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
              {/* Tombol "Lokasi tersimpan" pindah ke tumpukan kiri di atas
                  peta, sesumbu dengan pemilih basemap. Lihat alasannya di sana. */}
              {/* Sakelar tema BERDIRI SENDIRI, bukan di dalam menu pengaturan.
                  Ia satu-satunya setelan yang diubah orang berkali-kali dalam
                  satu sesi - siang di kereta, malam di rumah - dan setelan
                  sesering itu tidak boleh butuh dua ketukan. */}
              {/* Sakelar tema PINDAH ke dalam menu pengaturan (11 Sep 2026,
                  permintaan pemilik repo). Bilah ini sudah memuat pencarian,
                  kawasan, layer, pengaturan, dan akun; preferensi tampilan
                  bukan benda yang ditekan orang tiap menit, dan ia berdiri di
                  sebelah sakelar bahasa yang sifatnya sama persis. */}
              <MenuPengaturan
                namaTempat={namaTempat}
                onNamaTempat={setNamaTempat}
                tigaDimensi={tigaDimensi}
                onTigaDimensi={setTigaDimensi}
                onSumber={() => setSumberTerbuka(true)}
              />
              {/* Pemisah tipis: akun bukan pengaturan peta, dan tanpa jeda
                  visual keduanya terbaca sebagai satu kelompok tombol. */}
              <span className="mx-0.5 hidden h-6 w-px shrink-0 bg-line sm:block" aria-hidden />
              <TombolAkun />
            </div>
          </header>

          <div className="flex min-h-0 flex-1 gap-4">
            {/* --- Kolom kiri -----------------------------------------------
                pb-[42px] menyisakan baris skala + atribusi MapLibre di kiri
                bawah. Angkanya dikunci oleh .maplibregl-ctrl-bottom-left di
                index.css; kedua sisi angka ajaib ini ada di repo yang sama. */}
            <div className="flex min-h-0 flex-1 flex-col gap-3 pb-[42px]">
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
                      className="group flex w-fit min-w-0 cursor-pointer items-center gap-3 rounded-full bg-ink px-5 py-2.5 text-surface shadow-lg transition-transform duration-300 ease-jelly hover:scale-[1.03]"
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
                        <span className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
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
                  <div className="kaca pointer-events-auto flex w-fit max-w-full items-center gap-3 rounded-full px-4 py-2">
                    <span className="truncate text-[13.5px] text-ink-2">
                      {bahasa === 'en' ? LAYER[layer].pertanyaanEn : LAYER[layer].pertanyaan}
                    </span>
                    {nHeksagon !== null && (
                      <span className="tabular shrink-0 border-l border-line pl-3 text-[12.5px] text-ink-3">
                        {t.heksagon(nHeksagon.toLocaleString(t.locale))}
                      </span>
                    )}
                  </div>
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
                <div className="pointer-events-auto absolute bottom-[calc(56svh+0.75rem)] left-0 z-30 order-1 flex flex-col items-start gap-2 lg:relative lg:bottom-auto lg:left-auto lg:mr-auto">
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
                    className="grid h-12 w-12 shrink-0 cursor-pointer place-items-center rounded-full bg-ink text-surface shadow-[0_12px_30px_-10px_rgb(22_33_28/0.7)] transition-transform duration-200 ease-jelly hover:scale-[1.06]"
                  >
                    <svg width="19" height="19" viewBox="0 0 20 20" aria-hidden>
                      <path d="M5.5 3.5h9V17L10 13.6 5.5 17Z" fill="currentColor" />
                    </svg>
                  </button>

                  <PilihBasemap
                    arah="kanan"
                    nilai={gaya}
                    opsi={Object.entries(GAYA_BASEMAP).map(([k, g]) => ({
                      nilai: k as NamaGaya,
                      label: t.basemap[k] ?? g.label,
                    }))}
                    onUbah={gantiGaya}
                    buka={panelKiri === 'basemap'}
                    onBuka={(v) => setPanelKiri(v ? 'basemap' : 'tidak')}
                  />

                  {/* Pembuka Kompas Kuadran / Legenda. Ikonnya IKUT ISI yang
                      dibukanya: grid 2x2 untuk Kompas, tumpukan baris untuk
                      legenda. Tombol yang ikonnya tetap sama padahal isinya
                      bertukar akan membuat orang mengira ia rusak. */}
                  <button
                    onClick={() => setPanelKiri((v) => (v === 'kartu' ? 'tidak' : 'kartu'))}
                    aria-expanded={panelKiriTerbuka}
                    aria-label={`${panelKiriTerbuka ? 'Tutup' : 'Buka'} ${pakaiKompas ? 'Kompas Kuadran' : 'legenda'}`}
                    title={pakaiKompas ? 'Kompas Kuadran' : 'Legenda layer'}
                    className={`grid h-12 w-12 shrink-0 cursor-pointer place-items-center rounded-full transition-transform duration-200 ease-jelly hover:scale-[1.06] ${
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
                seluruh gunanya peta ini. */}
            <aside
              data-buka={panelTerbuka}
              aria-hidden={!panelTerbuka}
              /* `56svh`, BUKAN `56%`, dan itu memperbaiki tumpang tindih yang
                 nyata di ponsel. Lembar ini dan tumpukan tombol kiri sama-sama
                 memakai angka 56 - tetapi PERSEN selalu relatif terhadap induk
                 masing-masing, dan keduanya punya induk yang berbeda. Terukur di
                 390x844: lembar 473px tinggi (56% dari lapisan chrome), tombol
                 kiri berhenti di 571px (56% dari pembungkus dalamnya yang cuma
                 369px) - jadi tiga tombol terbawah duduk DI ATAS daftar lokasi.
                 `svh` diukur terhadap viewport untuk keduanya, jadi angkanya
                 tidak bisa lagi berarti dua hal. */
              className="kolom-geser melayang absolute inset-x-0 bottom-0 h-[56svh] min-h-0 lg:static lg:h-auto"
              style={
                {
                  '--lebar-kolom': panelTerbuka ? '25rem' : '0rem',
                  '--geser-kolom': panelTerbuka ? '0rem' : '-1rem',
                  '--opasitas-kolom': panelTerbuka ? 1 : 0,
                } as CSSProperties
              }
            >
              <div className="kaca-tebal flex h-full w-full flex-col overflow-hidden rounded-lg lg:w-[25rem]">
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
                  <div className="relative grid min-w-0 flex-1 grid-cols-3">
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
                    className="ml-1 grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
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
                    // Detail adalah LAPISAN DI ATAS daftar, bukan penggantinya.
                    //
                    // Percobaan pertama mengganti isinya, dan daftar jadi
                    // dicabut tiap kali detail dibuka - kembali dari detail lalu
                    // berarti meminta ulang seluruh 112 baris dan kehilangan
                    // posisi gulir. Ditumpuk, daftarnya tetap hidup di
                    // belakangnya dan kembali terasa seketika.
                    //
                    // Lapisan detailnya ikut tetap terpasang saat tab lain yang
                    // aktif. Satu akibat yang disengaja: pintasan lokasi di
                    // jawaban Loconomics AI - yang sengaja TIDAK memindah tab -
                    // sekarang sudah memuat rinciannya di belakang, jadi satu
                    // ketukan ke "Daftar lokasi" langsung menampilkannya.
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
                            className="flex shrink-0 cursor-pointer items-center gap-2 border-b border-line/70 px-4 py-2.5 text-left text-[13px] font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
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

            {!panelTerbuka && (
              <button
                onClick={() => setPanelTerbuka(true)}
                className="kaca pop pointer-events-auto absolute bottom-0 right-0 flex cursor-pointer items-center gap-2 rounded-full px-4 py-2.5 text-[13.5px] font-semibold transition-transform duration-200 ease-jelly hover:scale-105 lg:static lg:h-full lg:flex-col lg:justify-center lg:rounded-lg lg:px-2.5 lg:py-4 lg:hover:scale-100"
                aria-label={t.bukaPanelDaftar}
                title={t.bukaPanel}
              >
                <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden className="shrink-0">
                  <path
                    d="M8 1.5 3.5 6 8 10.5"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="lg:[writing-mode:vertical-rl] lg:rotate-180 lg:tracking-[0.08em]">
                  Daftar lokasi
                </span>
              </button>
            )}
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
        </div>

        {/* --- Sumber data --------------------------------------------------
            Jawaban atas satu pertanyaan yang ditanyakan tiap juri dan tiap
            calon pengguna yang serius: "angka ini dari mana". Seluruh isinya
            dibangkitkan pipeline; tidak ada satu pun angka di sana yang
            diketik tangan. */}
        {sumberTerbuka && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 backdrop-blur-[3px] sm:p-6"
            onClick={() => setSumberTerbuka(false)}
            role="dialog"
            aria-modal="true"
            aria-label={t.sumberData}
          >
            <div
              className="kaca-tebal melayang my-auto w-[54rem] max-w-full overflow-hidden rounded-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <Suspense fallback={null}>
                <SumberData onTutup={() => setSumberTerbuka(false)} />
              </Suspense>
            </div>
          </div>
        )}

        {/* --- Diagram kuadran penuh --------------------------------------- */}
        {kuadranPenuh && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-6 backdrop-blur-[3px]"
            onClick={() => setKuadranPenuh(false)}
            role="dialog"
            aria-modal="true"
            aria-label={t.diagramKuadran}
          >
            {/* `overflow-auto` DICABUT. Diagram yang harus digulir untuk
                dilihat utuh sudah berhenti jadi diagram - separuh gunanya
                justru melihat keempat kuadran sekaligus. Yang mengalah sekarang
                ukuran diagramnya (min(430px, 44vh) di KompasKuadran), bukan
                keutuhannya. */}
            <div
              className="kaca-tebal melayang flex max-h-full w-[52rem] max-w-full flex-col overflow-hidden rounded-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-baseline justify-between gap-6 border-b border-line/70 px-6 py-5">
                <div>
                  <h2 className="papan text-[19px]">{t.diagramJudul(kawasan)}</h2>
                  <p className="mt-1 max-w-[42ch] text-[13.5px] leading-snug text-ink-2">
                    {t.diagramIsi}
                  </p>
                </div>
                <button
                  onClick={() => setKuadranPenuh(false)}
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
                    setKuadranPenuh(false)
                  }}
                />
                {/* Kolom kanan: penjelasan sumbu. Dipindah ke samping, bukan di
                    bawah - di bawah ia yang membuat dialognya melebihi tinggi
                    layar dan memaksa scroll. */}
                <div className="min-w-0 flex-1 lg:max-w-[19rem]">
                  <div className="rounded-md border border-line/70 bg-surface-2/60 p-4">
                    <h3 className="eyebrow mb-2">{t.caraBaca}</h3>
                    <p className="text-[13px] leading-relaxed text-ink-2">{t.caraBaca1}</p>
                    <p className="mt-2.5 text-[13px] leading-relaxed text-ink-2">{t.caraBaca2}</p>
                    {/* Sumbu datar itu SETENGAH tesis produk ini, dan sampai hari
                        ini dua dari lima bahannya kosong — termasuk keduanya yang
                        menilai tampilan secara langsung. Panel ini satu-satunya
                        tempat sumbu itu DIJELASKAN, jadi ia tempat yang benar
                        untuk menyatakannya; label sumbu di kompas tidak punya
                        ruang, dan menempelkan keterangan di sana akan mengubah
                        legenda jadi paragraf. */}
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

/**
 * Yang dilihat non-pelanggan saat menekan "Pantauan".
 *
 * Dialog tersendiri, bukan DialogPantauan yang isinya ditutup tirai: panel itu
 * memanggil /akun/pantauan dan /skor/dinamika saat dipasang, dan keduanya akan
 * dijawab 401/402. Memasangnya cuma untuk memburamkan hasilnya berarti dua
 * permintaan yang sudah pasti gagal di setiap pembukaan.
 */
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
