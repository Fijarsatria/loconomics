/**
 * Sumber kebenaran tunggal untuk frontend.
 *
 * Padanan `pipeline/config.py` di sisi peramban. Jangan menulis ulang nilai-nilai
 * di bawah langsung di komponen — kalau ada di dua tempat, cepat atau lambat
 * keduanya berbeda.
 */

// --- Basemap MAPID ---------------------------------------------------------
// Ketentuan lomba A.3: basemap WAJIB MAPID Maps. Jangan menambah sumber tile lain.
//
// Kunci ini aman berada di frontend — menurut briefing MAPID, kunci basemap hanya
// dipakai untuk menghitung pemakaian, bukan untuk otorisasi. Yang TIDAK BOLEH ada
// di sini: kunci MAPID Data API (x-api-key) dan kunci penyedia LLM. Keduanya
// backend-only.
const MAPID_KEY = import.meta.env.VITE_MAPID_MAPS_API_KEY

/**
 * Endpoint raster/XYZ MAPID yang tertulis di dokumentasi mengembalikan 404 di
 * setiap level zoom (sudah diverifikasi sampai 0/0/0). Jalur vector style.json
 * yang berfungsi — itu sebabnya proyek ini memakai MapLibre GL, bukan Leaflet.
 */
export const GAYA_BASEMAP: Record<string, { id: string; label: string }> = {
  terang: { id: 'light', label: 'Terang' },
  dasar: { id: 'basic', label: 'Dasar' },
  jalan: { id: 'street-2d-building', label: 'Jalan' },
  gelap: { id: 'dark', label: 'Gelap' },
  satelit: { id: 'satellite', label: 'Satelit' },
}

export type NamaGaya = keyof typeof GAYA_BASEMAP

export const urlGaya = (nama: NamaGaya = 'terang') =>
  `https://basemap.mapid.io/styles/${GAYA_BASEMAP[nama].id}/style.json?key=${MAPID_KEY}`

// --- Kuadran ---------------------------------------------------------------
// Satu-satunya warna jenuh di seluruh antarmuka. Lolos enam pemeriksaan
// validator palet: pita terang, lantai chroma, separasi CVD (deutan 19,0 ·
// tritan 12,9), lantai penglihatan normal 25,2, kontras >= 3:1.
//
// HINDARI sengaja tanpa warna. Abu-abu selalu jatuh di bawah lantai chroma
// sebagai warna kategorikal — dan itu justru benar maknanya: tidak ada apa-apa
// di sini, jadi ia digambar tanpa isian.
//
// `glif` ada karena warna saja tidak pernah cukup. Setiap kuadran punya bentuk
// sendiri, jadi peta tetap terbaca dicetak hitam-putih maupun oleh pembaca yang
// tidak membedakan warna.

export interface Kuadran {
  kunci: string
  nama: string
  warna: string | null
  lembut: string
  glif: string
  arti: string
  /** Posisi di grid 2×2 Kompas Kuadran: [kolom, baris], baris 0 = atas. */
  sel: [0 | 1, 0 | 1]
}

export const KUADRAN: Record<string, Kuadran> = {
  HIDDEN_GEM: {
    kunci: 'HIDDEN_GEM',
    nama: 'Hidden Gem',
    warna: '#109184',
    lembut: '#d8efec',
    glif: 'M8 1.6 14.4 8 8 14.4 1.6 8Z', // belah ketupat — sesuatu yang ditemukan
    arti: 'Datanya bagus, tampilannya biasa saja. Sewanya biasanya jauh lebih murah.',
    sel: [0, 0],
  },
  PEMENANG_JELAS: {
    kunci: 'PEMENANG_JELAS',
    nama: 'Pemenang Jelas',
    warna: '#6849cc',
    lembut: '#e5e0f8',
    glif: 'M8 1.5A6.5 6.5 0 1 1 8 14.5 6.5 6.5 0 0 1 8 1.5Z', // lingkaran penuh
    arti: 'Datanya bagus dan tampilannya mahal. Aman, tetapi Anda ikut membayar gengsinya.',
    sel: [1, 0],
  },
  JEBAKAN_GENGSI: {
    kunci: 'JEBAKAN_GENGSI',
    nama: 'Jebakan Gengsi',
    warna: '#c97400',
    lembut: '#f6e7cf',
    glif: 'M8 1.4 15 14.2H1Z', // segitiga — rambu peringatan
    arti: 'Tampilannya mahal tetapi ekonominya tidak mendukung. Kuadran yang paling sering menjebak.',
    sel: [1, 1],
  },
  HINDARI: {
    kunci: 'HINDARI',
    nama: 'Hindari',
    warna: null,
    lembut: 'transparent',
    glif: 'M2.5 2.5h11v11h-11Z', // kotak kosong — tidak ada apa-apa
    arti: 'Potensi ekonomi dan daya tarik visualnya sama-sama rendah.',
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

// --- Layer tematik ---------------------------------------------------------
// Nilai-nilai ini harus sama persis dengan FUNGSI_FRONTEND["setLayer"]["nama_layer"]
// di backend/app/api/ai.py — itu kontrak yang dikirim ke penyedia LLM.

export interface Layer {
  nama: string
  pertanyaan: string
}

export const LAYER: Record<string, Layer> = {
  opportunity: { nama: 'Skor Peluang', pertanyaan: 'Di mana yang paling menjanjikan?' },
  pricelens: { nama: 'PriceLens', pertanyaan: 'Berapa harga sewa yang wajar di sini?' },
  hidden_gem: { nama: 'GemFinder', pertanyaan: 'Mana yang bagus tapi belum dilirik?' },
  risk_radar: { nama: 'RiskRadar', pertanyaan: 'Mana yang berisiko menjebak?' },
  zoneguard: { nama: 'ZoneGuard', pertanyaan: 'Boleh buka usaha di sini?' },
}

export type NamaLayer = keyof typeof LAYER

// --- Wilayah studi ---------------------------------------------------------
// Enam kawasan pilot. Sama persis dengan KAWASAN_PILOT di pipeline/config.py dan
// app/core/aturan.py — kesamaannya dijaga oleh backend/tests/test_aturan.py.
// MapLibre memakai urutan [lon, lat], kebalikan dari Leaflet.

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
  { nama: 'Harjamukti', pusat: [106.8556, -6.3706], moda: 'LRT' },
]

export const KAWASAN_AWAL = KAWASAN_PILOT[0]
export const ZOOM_AWAL = 14

// --- Badge keyakinan (Q01–Q03) ---------------------------------------------
// WAJIB tampil di setiap tempat skor muncul. Ambangnya didefinisikan di backend
// (pipeline/config.py::tingkat_keyakinan); di sini hanya tampilannya.
//
// Perhatikan: tingkat keyakinan TIDAK memakai warna kuadran, dan tidak memakai
// merah-kuning-hijau. Ia memakai jumlah balok terisi — ukuran, bukan suasana
// hati. Keyakinan rendah bukan kesalahan yang perlu ditandai merah; ia hanya
// berarti datanya belum banyak.

export const KEYAKINAN: Record<string, { balok: number; teks: string }> = {
  TINGGI: { balok: 3, teks: 'Didukung survei yang rapat' },
  SEDANG: { balok: 2, teks: 'Didukung survei secukupnya' },
  RENDAH: { balok: 1, teks: 'Datanya masih tipis, perlu verifikasi lapangan' },
}

// --- Commuter Clock --------------------------------------------------------

export const JAM_MULAI = 5
export const JAM_SELESAI = 22

// --- API -------------------------------------------------------------------

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
