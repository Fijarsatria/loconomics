

export interface GayaBasemap {
  id: string
  label: string
  labelEn: string
  langsung?: boolean
  gedung3d?: string
}

export const GAYA_BASEMAP: Record<string, GayaBasemap> = {
  terang: { id: 'light', label: 'Terang', labelEn: 'Light' },
  dasar: { id: 'basic', label: 'Jalan', labelEn: 'Street', gedung3d: 'building-3d' },
  gelap: { id: 'dark', label: 'Gelap', labelEn: 'Dark' },
  satelit: { id: 'satellite', label: 'Satelit', labelEn: 'Satellite', langsung: true },
}

const GAYA_PINDAH: Record<string, string> = { jalan: 'dasar' }

/** Nama gaya yang sah sekarang; yang sudah dipensiunkan dipetakan, bukan dibuang. */
export function gayaSah(nama: string | undefined | null): string {
  if (nama && nama in GAYA_BASEMAP) return nama
  return (nama && GAYA_PINDAH[nama]) || 'dasar'
}

export type NamaGaya = keyof typeof GAYA_BASEMAP

export const urlGaya = (nama: NamaGaya = 'terang') => {
  const g = GAYA_BASEMAP[nama] ?? GAYA_BASEMAP.terang
  return g.langsung
    ? `https://basemap.mapid.io/styles/${g.id}/style.json`
    : `${import.meta.env.BASE_URL}basemap/${g.id}.json`
}

export const SUMBER_UBIN_MAPID = {
  type: 'vector' as const,
  tiles: ['https://basemap.mapid.io/data/mapidtiles/{z}/{x}/{y}.pbf'],
  minzoom: 0,
  maxzoom: 14,
  attribution:
    '<a href="https://mapid.co.id/" target="_blank">&copy; MAPID Maps</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>',
}

/**
 * Sumber peta dan data yang wajib disebut di layar (ketentuan A.3).
 *
 * SATU sumber kebenaran untuk dua tempat: panel MapLibre yang tersembunyi
 * (HTML-nya dibangkitkan dari sini) dan pop-up "!" milik kita sendiri. Tiga
 * yang pertama sudah dibawa gaya MAPID di dalam berkasnya sendiri, jadi tidak
 * diulang ke MapLibre - tetapi tetap didaftar di sini supaya pop-upnya lengkap.
 */
export const ATRIBUSI_PETA: { nama: string; url: string; lisensi?: string; dariGaya?: boolean }[] = [
  { nama: 'MAPID Maps', url: 'https://mapid.co.id/', dariGaya: true },
  { nama: 'OpenMapTiles', url: 'https://www.openmaptiles.org/', dariGaya: true },
  {
    nama: 'OpenStreetMap contributors',
    url: 'https://www.openstreetmap.org/copyright',
    lisensi: 'ODbL',
    dariGaya: true,
  },
  { nama: 'openrouteservice', url: 'https://openrouteservice.org/' },
  { nama: 'WorldPop', url: 'https://www.worldpop.org/', lisensi: 'CC BY 4.0' },
  { nama: 'RDTR ATR/BPN', url: 'https://gistaru.atrbpn.go.id/rdtrinteraktif/', lisensi: 'GISTARU' },
]

export const ATRIBUSI_SATELIT =
  '<a href="https://mapid.co.id/" target="_blank">&copy; MAPID Maps</a> · Citra/Imagery <a href="https://www.maptiler.com/copyright/" target="_blank">&copy; MapTiler</a> <a href="https://www.mapbox.com/about/maps/" target="_blank">&copy; Mapbox</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>'

/** Font MAPID - server fontnya melayani Noto Sans (dipakai label satelit) dan
 *  Metropolis (angka heksagon). Diuji 12 Sep 2026: keduanya 200. */
export const GLYPH_MAPID = 'https://basemap.mapid.io/fonts/{fontstack}/{range}.pbf'

let KUNCI_BASEMAP: string = import.meta.env.VITE_MAPID_BASEMAP_KEY ?? ''
let janjiKunciBasemap: Promise<void> | null = null

export function siapkanKunciBasemap(): Promise<void> {
  if (KUNCI_BASEMAP) return Promise.resolve()
  janjiKunciBasemap ??= mintaKunciBasemap()
  return janjiKunciBasemap
}

function mintaKunciBasemap(): Promise<void> {
  return fetch(`${API_BASE}/meta/kunci-basemap`, { signal: AbortSignal.timeout(6000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { kunci?: unknown } | null) => {
      if (d && typeof d.kunci === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(d.kunci)) KUNCI_BASEMAP = d.kunci
    })
    .catch(() => {})
}

export async function kunciBasemapSusulan(): Promise<boolean> {
  const tenggat = performance.now() + 90_000
  while (!KUNCI_BASEMAP && performance.now() < tenggat) {
    await new Promise((r) => setTimeout(r, 3000))
    await mintaKunciBasemap()
  }
  return !!KUNCI_BASEMAP
}

export const adaKunciBasemap = () => !!KUNCI_BASEMAP

/** Host yang menuntut kunci itu. Sengaja sempit: kunci tidak boleh menempel
 *  pada permintaan ke mana pun selain pemiliknya. */
const HOST_BASEMAP = 'basemap.mapid.io'

export function bubuhiKunciBasemap(url: string): string {
  if (!KUNCI_BASEMAP || !url.includes(HOST_BASEMAP)) return url
  if (url.includes('key=')) return url
  return `${url}${url.includes('?') ? '&' : '?'}key=${KUNCI_BASEMAP}`
}


export interface Kuadran {
  kunci: string
  nama: string
  namaEn: string
  ringkas: string
  /** `ringkas` dan `arti` dalam bahasa Inggris. Keduanya kalimat, bukan nama -
   *  jadi keduanya berpasangan; `nama` tidak (lihat `namaEn`). */
  ringkasEn: string
  artiEn: string
  warna: string
  warnaPeta: string
  lembut: string
  lembutPeta: string
  glif: string
  arti: string
  /** Posisi di grid 2×2 Kompas Kuadran: [kolom, baris], baris 0 = atas. */
  sel: [0 | 1, 0 | 1]
}

export const KUADRAN: Record<string, Kuadran> = {
  HIDDEN_GEM: {
    kunci: 'HIDDEN_GEM',
    nama: 'Hidden Gem',
    // Namanya sudah bahasa Inggris di kedua tampilan, dan itu disengaja: ia
    // istilah yang dipakai apa adanya oleh pelaku usaha di Indonesia.
    namaEn: 'Hidden Gem',
    ringkas: 'bagus, belum mahal',
    ringkasEn: 'good, and not expensive yet',
    warna: 'var(--q-gem)',
    warnaPeta: '#4C93F7',
    lembut: 'var(--q-gem-lembut)',
    lembutPeta: '#DCEAFD',
    glif: 'M8 1.6 14.4 8 8 14.4 1.6 8Z', // belah ketupat — sesuatu yang ditemukan
    arti: 'Datanya bagus, tampilannya biasa saja. Sewanya biasanya jauh lebih murah.',
    artiEn: 'The data is good, the looks are ordinary. The rent is usually far cheaper.',
    sel: [0, 0],
  },
  PEMENANG_JELAS: {
    kunci: 'PEMENANG_JELAS',
    nama: 'Aman',
    namaEn: 'Safe',
    ringkas: 'bagus, dan Anda membayar gengsinya',
    ringkasEn: 'good, and you pay for the prestige',
    warna: 'var(--q-menang)',
    warnaPeta: '#15803D',
    lembut: 'var(--q-menang-lembut)',
    lembutPeta: '#D7ECDF',
    glif: 'M8 1.5A6.5 6.5 0 1 1 8 14.5 6.5 6.5 0 0 1 8 1.5Z', // lingkaran penuh
    arti: 'Datanya bagus dan tampilannya mahal. Aman, tetapi Anda ikut membayar gengsinya.',
    artiEn: 'The data is good and it looks expensive. Safe, but you pay for the prestige too.',
    sel: [1, 0],
  },
  JEBAKAN_GENGSI: {
    kunci: 'JEBAKAN_GENGSI',
    nama: 'Jebakan Gengsi',
    namaEn: 'Prestige Trap',
    ringkas: 'terlihat mahal, datanya lemah',
    ringkasEn: 'looks expensive, the data is weak',
    warna: 'var(--q-jebakan)',
    warnaPeta: '#E58A00',
    lembut: 'var(--q-jebakan-lembut)',
    lembutPeta: '#FCECD4',
    glif: 'M8 1.4 15 14.2H1Z', // segitiga — rambu peringatan
    arti: 'Tampilannya mahal tetapi ekonominya tidak mendukung. Kuadran yang paling sering menjebak.',
    artiEn: 'It looks expensive but the economics do not back it up. The quadrant that traps people most often.',
    sel: [1, 1],
  },
  HINDARI: {
    kunci: 'HINDARI',
    nama: 'Hindari',
    namaEn: 'Avoid',
    ringkas: 'sepi, dan tidak menonjol juga',
    ringkasEn: 'quiet, and not striking either',
    warna: 'var(--q-hindari)',
    warnaPeta: '#B01B1B',
    lembut: 'var(--q-hindari-lembut)',
    lembutPeta: '#F8DCDC',
    glif: 'M2.5 2.5h11v11h-11Z', // kotak kosong — tidak ada apa-apa
    arti: 'Potensi ekonomi dan daya tarik visualnya sama-sama rendah.',
    artiEn: 'Both the economic potential and the visual pull are low.',
    sel: [0, 1],
  },
}

export const URUTAN_KUADRAN = [
  'HIDDEN_GEM',
  'PEMENANG_JELAS',
  'HINDARI',
  'JEBAKAN_GENGSI',
] as const

/** Warna isian peta. HINDARI mengembalikan warna garis, bukan isian. */
export const ABU_HINDARI = '#bcc5bf'

export const RODA_WARNA = [
  '#8B5CF6', '#A855F7', '#D946EF', '#EC4899', '#F43F5E', '#EF4444',
  '#F97316', '#F59E0B', '#EAB308', '#84CC16', '#22C55E', '#10B981',
  '#14B8A6', '#06B6D4', '#0EA5E9', '#3B82F6', '#6366F1',
]

export const IDENTITAS = {
  produk: 'Loconomics',
  judulResmi: 'Transit-oriented Retail Recommender',
  lomba: 'MAPID WebGIS Competition #2 2026',
  tema: 'Maps That Think! — Mass Transportation Edition',
  tim: 'Tim #33 · Top 50',
  institusi: 'Telkom University, Bandung',
  ketua: 'Irvan Tegar Yunadi',
  /** Kontak yang dipakai di menu Pengaturan. Diisi 21 Sep 2026 atas
   *  permintaan pemilik repo; surel sengaja dibiarkan kosong daripada diisi
   *  alamat yang tidak dipakai. */
  penanggungJawab: 'Fijar Satria Pinandita Mangkauna',
  email: '',
  instagram: '@fjrs_07',
  situs: 'loconomics.mapid.io',
  repositori: 'github.com/Fijarsatria',
}

export interface Pendiri {
  /** Nama panggilan. Tampil hanya selama `namaLengkap` belum diisi. */
  nama: string
  namaLengkap?: string
  prodi?: string
  angkatan?: number
  peran: string
  /** Inisial untuk avatar. Dikosongkan berarti kartunya belum terisi. */
  inisial: string
  /** Satu kalimat: apa yang benar-benar ia kerjakan di produk ini. */
  kerja: string
  /** Kalimat yang sama dalam bahasa Inggris, untuk sakelar bahasa gerbang. */
  kerjaEn?: string
  /** Ditandai di kartu. Hanya satu orang yang boleh membawanya. */
  ketua?: boolean
  rona: readonly [string, string]
}

export const PENDIRI: Pendiri[] = [
  {
    nama: 'Ajis',
    peran: 'Data Analyst',
    inisial: 'AG',
    namaLengkap: 'Azziz Abdul Ghofur',
    prodi: 'Informatika',
    angkatan: 2023,
    rona: ['#2de8c0', '#22d3ee'],
    kerja: 'Inventarisasi dan pembersihan data misi MAPID, feature engineering, analisis spasial, sampai scoring 43 variabel per heksagon — termasuk membiarkan yang kosong tetap kosong.',
    kerjaEn: 'Inventories and cleans the MAPID mission data, engineers the features, runs the spatial analysis, and scores all 43 variables per hexagon — including leaving the blanks blank.',
  },
  {
    nama: 'Ukas',
    peran: 'AI Engineer',
    inisial: 'UK',
    namaLengkap: 'Ukasyah',
    prodi: 'Teknik Komputer',
    angkatan: 2024,
    rona: ['#8b5cf6', '#6366f1'],
    kerja: 'Membaca struk dan spanduk survei lewat OCR, melatih model untuk variabel yang kosong, lalu membangun Loconomics AI: dua belas alat mode ketat dalam satu loop agentik — beserta evaluasi dan validasinya.',
    kerjaEn: 'Reads survey receipts and banners with OCR, trains the model that fills missing variables, then builds Loconomics AI: twelve strict-mode tools in one agentic loop — evaluation and validation included.',
  },
  {
    nama: 'Wily',
    peran: 'UI/UX Designer',
    inisial: 'WT',
    namaLengkap: 'Wily Franklyn Togatorop',
    prodi: 'Teknologi Informasi',
    angkatan: 2024,
    rona: ['#e879f9', '#f472b6'],
    kerja: 'Pengalaman pengguna dan responsivitasnya — dari wireframe dan mockup sampai sistem visual: peta, panel, dan Kompas Kuadran yang terbaca tanpa penjelasan.',
    kerjaEn: 'User experience and responsiveness — from wireframes and mockups to the visual system: the map, the panels, and a Quadrant Compass anyone can read without a walkthrough.',
  },
  {
    nama: 'Fijar',
    peran: 'WebGIS Developer',
    inisial: 'FM',
    namaLengkap: 'Fijar Satria Pinandita Mangkauna',
    prodi: 'Teknologi Informasi',
    angkatan: 2024,
    rona: ['#38bdf8', '#3b82f6'],
    kerja: 'Arsitektur frontend dan backend, peta MapLibre di atas basemap MAPID, API FastAPI, basis data PostGIS di Supabase, sampai penerbitannya ke domain publik.',
    kerjaEn: 'The frontend and backend architecture, the MapLibre map on a MAPID basemap, the FastAPI API, the PostGIS database on Supabase, and the deployment to its public domain.',
  },
  {
    nama: IDENTITAS.ketua,
    peran: 'Business Analyst',
    inisial: 'IY',
    namaLengkap: IDENTITAS.ketua,
    prodi: 'Informatika',
    angkatan: 2023,
    rona: ['#fbbf24', '#fb923c'],
    kerja: 'Menyusun alur pengguna, narasi masalah, dan kebutuhan bisnisnya — termasuk merumuskan dua pertanyaan yang dijawab produk ini: mana yang tersembunyi, dan mana yang menjebak.',
    kerjaEn: 'Shapes the user flow, the problem narrative, and the business needs — including the two questions this product answers: which places are hidden, and which ones are traps.',
    ketua: true,
  },
]

export interface FiturProduk {
  nama: string
  ringkas: string
  isi: string
}

export const FITUR: FiturProduk[] = [
  {
    nama: 'PriceLens',
    ringkas: 'sewa yang wajar',
    isi: 'Kuartil harga sewa per m² di kawasan yang sedang dilihat, dari struk dan papan sewa yang benar-benar disurvei.',
  },
  {
    nama: 'GemFinder',
    ringkas: 'yang belum dilirik',
    isi: 'Heksagon dengan data bagus tetapi prestise visual rendah — selisih antara apa kata data dan apa kata mata.',
  },
  {
    nama: 'RiskRadar',
    ringkas: 'yang menjebak',
    isi: 'Indeks pergantian usaha: seberapa sering usaha di sini datang lalu pergi.',
  },
  {
    nama: 'ZoneGuard',
    ringkas: 'boleh atau tidak',
    isi: 'Zona RDTR yang melarang usaha dinolkan skornya dan tidak pernah ikut direkomendasikan.',
  },
  {
    nama: 'Commuter Clock',
    ringkas: 'ramai jam berapa',
    isi: 'Profil per jam dari 05.00 sampai 22.00 — kapan orang benar-benar lewat, bukan kapan menurut perasaan.',
  },
  {
    nama: 'Loconomics AI',
    ringkas: 'tanya biasa saja',
    isi: 'Bertanya dengan bahasa sehari-hari. Modelnya memanggil alat, membaca angka pipeline, lalu menjelaskan — tanpa mengarang satu pun.',
  },
]

// --- Layer tematik ---------------------------------------------------------
// Nilai-nilai ini harus sama persis dengan FUNGSI_FRONTEND["setLayer"]["nama_layer"]
// di backend/app/api/ai.py — itu kontrak yang dikirim ke penyedia LLM.

export interface Layer {
  nama: string
  pertanyaan: string
  /** Pertanyaan yang sama dalam bahasa Inggris. `nama` TIDAK punya pasangan:
   *  PriceLens, GemFinder, ZoneGuard adalah nama, bukan kata. */
  pertanyaanEn: string
  /** Satu kalimat di kepala daftar. Opportunity Score sengaja TANPA ini - ia
   *  ringkasan seluruh lapisan yang lain, dan namanya sudah cukup. */
  deskripsi?: string
  deskripsiEn?: string
}

export const LAYER: Record<string, Layer> = {
  opportunity: {
    nama: 'Opportunity Score',
    pertanyaan: 'Di mana yang paling menjanjikan?',
    pertanyaanEn: 'Where is the most promising place?',
  },
  pricelens: {
    nama: 'PriceLens',
    pertanyaan: 'Berapa harga sewa yang wajar di sini?',
    pertanyaanEn: 'What is a fair rent around here?',
    deskripsi: 'Harga sewa per m² hasil survei, dari termurah ke termahal.',
    deskripsiEn: 'Surveyed rent per m², cheapest to most expensive.',
  },
  hidden_gem: {
    nama: 'GemFinder',
    pertanyaan: 'Mana yang bagus tapi belum dilirik?',
    pertanyaanEn: 'Which places are good but still overlooked?',
    deskripsi: 'Lokasi berskor bagus yang tampilannya belum kelihatan istimewa.',
    deskripsiEn: 'Well-scored places that still look ordinary.',
  },
  risk_radar: {
    nama: 'RiskRadar',
    pertanyaan: 'Mana yang berisiko menjebak?',
    pertanyaanEn: 'Which places risk becoming a trap?',
    deskripsi: 'Lokasi yang terlihat bagus tetapi usahanya sering berganti.',
    deskripsiEn: 'Places that look good but where businesses turn over fast.',
  },
  zoneguard: {
    nama: 'ZoneGuard',
    pertanyaan: 'Boleh buka usaha di sini?',
    pertanyaanEn: 'Is business allowed here?',
    deskripsi: 'Status izin usaha menurut RDTR: diizinkan, dilarang, atau belum dipastikan.',
    deskripsiEn: 'Business-permission status from the zoning plan: allowed, prohibited, or unknown.',
  },
}

export type NamaLayer = keyof typeof LAYER

export const KERAPATAN_NAMA: Record<string, { geser: number | null }> = {
  mati: { geser: null },
  jarang: { geser: 2 },
  normal: { geser: 0 },
  rapat: { geser: -1.5 },
}

export type KerapatanNama = keyof typeof KERAPATAN_NAMA


export interface Kawasan {
  nama: string
  pusat: [number, number]
  moda: string
}

export const KAWASAN_PILOT: Kawasan[] = [
  { nama: 'Manggarai', pusat: [106.8496, -6.2131], moda: 'KRL' },
  { nama: 'Tanah Abang', pusat: [106.8117, -6.1858], moda: 'KRL' },
  { nama: 'Depok Baru', pusat: [106.8194, -6.3906], moda: 'KRL' },
  { nama: 'Bekasi', pusat: [106.9971, -6.2356], moda: 'KRL' },
  { nama: 'Dukuh Atas BNI', pusat: [106.8228, -6.2005], moda: 'MRT' },
  // OSM node/6720467138, network=LRT Jabodebek. Diperbaiki 29 Agu 2026.
  { nama: 'Harjamukti', pusat: [106.89567, -6.37389], moda: 'LRT' },
]

export const SEMUA_KAWASAN = ''

/** Label untuk keadaan tanpa saringan. */
export const LABEL_SEMUA_KAWASAN = 'Semua kawasan'


/** Untuk chip, judul kartu, dan kepala panel. */
export const labelKawasan = (kawasan: string): string =>
  kawasan === SEMUA_KAWASAN
    ? LABEL_SEMUA_KAWASAN
    : kawasan.split(',').filter(Boolean).join(' + ')

export const frasaKawasan = (kawasan: string): string =>
  kawasan === SEMUA_KAWASAN
    ? 'seluruh kawasan pilot'
    : kawasan.split(',').filter(Boolean).join(' dan ')

export const BINGKAI_SEMUA: [number, number, number, number] = [106.79, -6.41, 107.02, -6.17]

/** Bawaan sekarang SEMUA kawasan: layar pertama menunjukkan seluruh cakupan. */
export const KAWASAN_AWAL = KAWASAN_PILOT[0]
export const ZOOM_AWAL = 14

// --- Nama heksagon yang bisa dibaca orang ----------------------------------
export const kodeLokasi = (h3: string, kawasan: string): string =>
  `${kawasan}-${String(parseInt(h3.slice(7, 11), 16)).padStart(5, '0')}`

/** Tanpa nama kawasan — untuk tempat sempit seperti kepala kolom komparasi. */
export const nomorLokasi = (h3: string): string =>
  String(parseInt(h3.slice(7, 11), 16)).padStart(5, '0')

// --- Bahasa untuk orang awam -----------------------------------------------
export const ARTI_VARIABEL: Record<string, { kode: string; nama: string; satuan: string }> = {
  pop_100m: { kode: 'D01', nama: 'Penduduk di sekitar', satuan: 'jiwa' },
  pop_usia_produktif: { kode: 'D02', nama: 'Penduduk usia kerja', satuan: 'jiwa' },
  jarak_simpul_m: { kode: 'D03', nama: 'Jarak ke stasiun', satuan: 'm' },
  waktu_jalan_menit: { kode: 'D04', nama: 'Jalan kaki ke stasiun', satuan: 'menit' },
  skor_simpul: { kode: 'D05', nama: 'Seberapa penting stasiunnya', satuan: '' },
  ridership_proksi: { kode: 'D06', nama: 'Penumpang stasiun per hari', satuan: 'orang' },
  kepadatan_kos: { kode: 'D07', nama: 'Banyaknya kos', satuan: '' },
  kepadatan_kantor: { kode: 'D08', nama: 'Banyaknya kantor', satuan: '' },
  generator_keramaian: { kode: 'D09', nama: 'Sekolah, pasar, rumah sakit', satuan: 'tempat' },
  skor_ramai_terkoreksi: { kode: 'D10', nama: 'Seberapa ramai', satuan: '' },
  intensitas_transaksi: { kode: 'D11', nama: 'Kepadatan transaksi', satuan: '' },
  aktivitas_komunitas: { kode: 'D12', nama: 'Kegiatan warga', satuan: '' },
  puncak_pagi: { kode: 'B01', nama: 'Belanja pagi (05-09)', satuan: '%' },
  puncak_siang: { kode: 'B02', nama: 'Belanja siang (11-14)', satuan: '%' },
  puncak_sore: { kode: 'B03', nama: 'Belanja sore (16-19)', satuan: '%' },
  puncak_malam: { kode: 'B04', nama: 'Belanja malam (19-23)', satuan: '%' },
  rasio_weekend: { kode: 'B05', nama: 'Akhir pekan vs hari kerja', satuan: 'x' },
  pangsa_digital: { kode: 'B06', nama: 'Bayar non-tunai', satuan: '%' },
  harga_median_porsi: { kode: 'B07', nama: 'Harga makanan per porsi', satuan: 'Rp' },
  spread_harga: { kode: 'B08', nama: 'Selisih harga antartempat', satuan: '' },
  nominal_median_struk: { kode: 'B09', nama: 'Belanja per struk', satuan: 'Rp' },
  belanja_per_jam: { kode: 'B10', nama: 'Uang berpindah per jam', satuan: 'Rp' },
  n_kompetitor_langsung: { kode: 'C01', nama: 'Pesaing sejenis', satuan: 'tempat' },
  kepadatan_poi_total: { kode: 'C02', nama: 'Total tempat usaha', satuan: 'tempat' },
  keragaman_usaha: { kode: 'C03', nama: 'Keragaman jenis usaha', satuan: '' },
  keragaman_kuliner: { kode: 'C04', nama: 'Keragaman jenis makanan', satuan: '' },
  pangsa_waralaba: { kode: 'C05', nama: 'Porsi merek waralaba', satuan: '%' },
  rasio_kompetitor_per_kapita: { kode: 'C06', nama: 'Pesaing per penduduk', satuan: '' },
  rasio_keliling: { kode: 'C07', nama: 'Porsi pedagang keliling', satuan: '%' },
  n_menetap_kuliner: { kode: 'C08', nama: 'Warung makan menetap', satuan: 'tempat' },
  njop_m2: { kode: 'P01', nama: 'NJOP tanah', satuan: 'Rp/m2' },
  njop_persentil: { kode: 'P02', nama: 'Posisi NJOP di kawasan', satuan: '%' },
  pasokan_sewa_komersial: { kode: 'P03', nama: 'Ruang usaha tersedia', satuan: 'unit' },
  rasio_sewa_jual: { kode: 'P04', nama: 'Sewa setahun dibagi harga jual', satuan: '' },
  harga_sewa_median: { kode: 'P05', nama: 'Sewa per bulan', satuan: 'Rp' },
  indeks_churn: { kode: 'P06', nama: 'Seberapa sering usaha berganti', satuan: '' },
  harga_sewa_per_m2: { kode: 'P07', nama: 'Sewa per m2', satuan: 'Rp/m2' },
  zona_izin_komersial: { kode: 'L01', nama: 'Boleh dipakai usaha', satuan: '' },
  kelas_zona: { kode: 'L02', nama: 'Jenis zona menurut aturan tata ruang', satuan: '' },
  risiko_banjir: { kode: 'L03', nama: 'Risiko banjir', satuan: '' },
  rasio_tutupan_bangunan: { kode: 'M01', nama: 'Padatnya bangunan', satuan: '%' },
  luas_bangunan_median: { kode: 'M02', nama: 'Luas bangunan rata-rata', satuan: 'm2' },
  skor_prestise_visual: { kode: 'M03', nama: 'Kesan mewah dari foto', satuan: 'dari 5' },
}

export const ARTI_VARIABEL_EN: Record<string, { nama: string; satuan: string }> = {
  pop_100m: { nama: 'Residents nearby', satuan: 'people' },
  pop_usia_produktif: { nama: 'Working-age residents', satuan: 'people' },
  jarak_simpul_m: { nama: 'Distance to the station', satuan: 'm' },
  waktu_jalan_menit: { nama: 'Walk to the station', satuan: 'min' },
  skor_simpul: { nama: 'How important the station is', satuan: '' },
  ridership_proksi: { nama: 'Station riders per day', satuan: 'people' },
  kepadatan_kos: { nama: 'Boarding houses around', satuan: '' },
  kepadatan_kantor: { nama: 'Offices around', satuan: '' },
  generator_keramaian: { nama: 'Schools, markets, hospitals', satuan: 'places' },
  skor_ramai_terkoreksi: { nama: 'How busy it gets', satuan: '' },
  intensitas_transaksi: { nama: 'Transaction density', satuan: '' },
  aktivitas_komunitas: { nama: 'Community activity', satuan: '' },
  puncak_pagi: { nama: 'Morning spending (05-09)', satuan: '%' },
  puncak_siang: { nama: 'Midday spending (11-14)', satuan: '%' },
  puncak_sore: { nama: 'Afternoon spending (16-19)', satuan: '%' },
  puncak_malam: { nama: 'Night spending (19-23)', satuan: '%' },
  rasio_weekend: { nama: 'Weekend vs weekday', satuan: 'x' },
  pangsa_digital: { nama: 'Cashless payment', satuan: '%' },
  harga_median_porsi: { nama: 'Food price per serving', satuan: 'Rp' },
  spread_harga: { nama: 'Price gap between places', satuan: '' },
  nominal_median_struk: { nama: 'Spend per receipt', satuan: 'Rp' },
  belanja_per_jam: { nama: 'Money moving per hour', satuan: 'Rp' },
  n_kompetitor_langsung: { nama: 'Direct rivals', satuan: 'places' },
  kepadatan_poi_total: { nama: 'Businesses in total', satuan: 'places' },
  keragaman_usaha: { nama: 'Variety of business types', satuan: '' },
  keragaman_kuliner: { nama: 'Variety of food types', satuan: '' },
  pangsa_waralaba: { nama: 'Share of franchise brands', satuan: '%' },
  rasio_kompetitor_per_kapita: { nama: 'Rivals per resident', satuan: '' },
  rasio_keliling: { nama: 'Share of street vendors', satuan: '%' },
  n_menetap_kuliner: { nama: 'Permanent food stalls', satuan: 'places' },
  njop_m2: { nama: 'NJOP land value', satuan: 'Rp/m2' },
  njop_persentil: { nama: 'NJOP rank within the area', satuan: '%' },
  pasokan_sewa_komersial: { nama: 'Commercial space available', satuan: 'units' },
  rasio_sewa_jual: { nama: 'Yearly rent over sale price', satuan: '' },
  harga_sewa_median: { nama: 'Rent per month', satuan: 'Rp' },
  indeks_churn: { nama: 'How often businesses change hands', satuan: '' },
  harga_sewa_per_m2: { nama: 'Rent per m2', satuan: 'Rp/m2' },
  zona_izin_komersial: { nama: 'Business is allowed', satuan: '' },
  kelas_zona: { nama: 'Zone class under the spatial plan', satuan: '' },
  risiko_banjir: { nama: 'Flood risk', satuan: '' },
  rasio_tutupan_bangunan: { nama: 'How built-up it is', satuan: '%' },
  luas_bangunan_median: { nama: 'Typical building footprint', satuan: 'm2' },
  skor_prestise_visual: { nama: 'Upmarket look from photos', satuan: 'of 5' },
}

/** kode → nama awam. Daftar faktor pembentuk skor berkunci KODE, bukan kolom. */
export const ARTI_KODE: Record<string, string> = Object.fromEntries(
  Object.values(ARTI_VARIABEL).map((v) => [v.kode, v.nama]),
)

/** Kembarannya dalam bahasa Inggris, dirakit dari pasangan kunci yang sama. */
export const ARTI_KODE_EN: Record<string, string> = Object.fromEntries(
  Object.entries(ARTI_VARIABEL).map(([kolom, v]) => [
    v.kode,
    ARTI_VARIABEL_EN[kolom]?.nama ?? v.nama,
  ]),
)

/** Keempat indeks dalam bahasa biasa. */
export const ARTI_INDEKS: Record<string, string> = {
  IPT: 'akses ke stasiun',
  IAE: 'perputaran uang',
  IKP: 'ketatnya persaingan',
  IBR: 'biaya dan risiko',
}

export const ARTI_INDEKS_EN: Record<string, string> = {
  IPT: 'access to the station',
  IAE: 'money in circulation',
  IKP: 'how tight the competition is',
  IBR: 'cost and risk',
}

export const TANYA_INDEKS: Record<string, string> = {
  IPT: 'Gampang tidak orang sampai ke sini?',
  IAE: 'Ada tidak uang berputar di sini?',
  IKP: 'Sudah ramai pesaing atau belum?',
  IBR: 'Mahal dan berisiko tidak?',
}

export const TANYA_INDEKS_EN: Record<string, string> = {
  IPT: 'Can people get here easily?',
  IAE: 'Is money actually moving here?',
  IKP: 'Is it already crowded with rivals?',
  IBR: 'Is it expensive and risky?',
}

const AMBANG_KATA = [0.75, 0.55, 0.35] as const

const KATA_INDEKS: Record<string, readonly [string, string, string, string]> = {
  // urut dari nilai TERTINGGI ke terendah
  IPT: ['Sangat mudah', 'Mudah', 'Lumayan', 'Sulit'],
  IAE: ['Sangat ramai', 'Ramai', 'Sedang', 'Sepi'],
  IKP: ['Sangat ketat', 'Ketat', 'Sedang', 'Masih longgar'],
  IBR: ['Mahal', 'Agak mahal', 'Sedang', 'Murah'],
}

const KATA_INDEKS_EN: Record<string, readonly [string, string, string, string]> = {
  IPT: ['Very easy', 'Easy', 'Fair', 'Hard'],
  IAE: ['Very busy', 'Busy', 'Moderate', 'Quiet'],
  IKP: ['Very tight', 'Tight', 'Moderate', 'Still roomy'],
  IBR: ['Expensive', 'Somewhat expensive', 'Moderate', 'Cheap'],
}

export const TINGGI_BAIK: Record<string, boolean> = {
  IPT: true,
  IAE: true,
  IKP: false,
  IBR: false,
}

export function keKalimat(teks: string): string {
  const kata = teks.split(' ')[0] ?? ''
  if (kata.length > 1 && kata === kata.toUpperCase()) return teks
  return teks.charAt(0).toLowerCase() + teks.slice(1)
}

/** "a", "a dan b", "a, b, dan c". Daftar yang disambung koma saja terbaca putus. */
function rangkai(bagian: string[], sambung: string): string {
  if (bagian.length <= 1) return bagian[0] ?? ''
  return `${bagian.slice(0, -1).join(', ')} ${sambung} ${bagian[bagian.length - 1]}`
}

export function frasaPrestise(
  cakupan: { terisi: string[]; kosong: string[]; diukur_langsung: boolean } | null | undefined,
  lingkup: 'lokasi' | 'wilayah',
  bahasa: 'id' | 'en' = 'id',
): string[] {
  if (!cakupan) return []
  const { terisi, kosong, diukur_langsung } = cakupan
  // Kelimanya terukur: tidak ada yang perlu dinyatakan, dan baris keterangan
  // yang isinya "semuanya lengkap" cuma menambah teks tanpa menambah kejujuran.
  if (kosong.length === 0) return []

  const en = bahasa === 'en'
  const di = en
    ? lingkup === 'lokasi'
      ? 'at this location'
      : 'at any location'
    : lingkup === 'lokasi'
      ? 'di lokasi ini'
      : 'di satu pun lokasi'
  const nama = (kode: string) => keKalimat((en ? ARTI_KODE_EN[kode] : ARTI_KODE[kode]) ?? kode)
  const daftar = (kode: string[]) => rangkai(kode.map(nama), en ? 'and' : 'dan')

  if (terisi.length === 0) {
    return [
      en
        ? `Not one ingredient of this axis has been measured ${di}.`
        : `Belum ada satu pun bahan sumbu ini yang terukur ${di}.`,
    ]
  }

  const kalimat = [
    en
      ? `Estimated from ${terisi.length} of ${terisi.length + kosong.length} ingredients: ` +
        `${daftar(terisi)}.`
      : `Diperkirakan dari ${terisi.length} dari ${terisi.length + kosong.length} bahan: ` +
        `${daftar(terisi)}.`,
  ]
  if (!diukur_langsung) {
    kalimat.push(
      en
        ? `No ingredient judges its appearance directly; ` +
          `not yet measured ${di}: ${daftar(kosong)}.`
        : `Belum ada satu pun bahan yang menilai tampilannya secara langsung; ` +
          `yang belum terukur ${di}: ${daftar(kosong)}.`,
    )
  }
  return kalimat
}

export function kataIndeks(
  kode: string,
  nilai: number | null,
  bahasa: 'id' | 'en' = 'id',
): string | null {
  const daftar = bahasa === 'en' ? KATA_INDEKS_EN : KATA_INDEKS
  if (nilai === null || !daftar[kode]) return null
  const kata = daftar[kode]
  if (nilai >= AMBANG_KATA[0]) return kata[0]
  if (nilai >= AMBANG_KATA[1]) return kata[1]
  if (nilai >= AMBANG_KATA[2]) return kata[2]
  return kata[3]
}


export const KEYAKINAN: Record<
  string,
  { balok: number; teks: string; label: string; teksEn: string; labelEn: string }
> = {
  TINGGI: {
    balok: 3,
    teks: 'Didukung survei yang rapat',
    label: 'Data kuat',
    teksEn: 'Backed by a dense survey',
    labelEn: 'Strong data',
  },
  SEDANG: {
    balok: 2,
    teks: 'Didukung survei secukupnya',
    label: 'Data sedang',
    teksEn: 'Backed by a fair amount of survey',
    labelEn: 'Fair data',
  },
  RENDAH: {
    balok: 1,
    teks: 'Datanya masih tipis, perlu verifikasi lapangan',
    label: 'Data tipis',
    teksEn: 'The data is still thin; it needs checking on the ground',
    labelEn: 'Thin data',
  },
}

// --- Commuter Clock --------------------------------------------------------

export const JAM_MULAI = 5
export const JAM_SELESAI = 22

// --- API -------------------------------------------------------------------

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
