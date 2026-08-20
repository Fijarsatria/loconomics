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
export const GAYA_BASEMAP = {
  dasar: 'basic',
  terang: 'light',
  gelap: 'dark',
  jalan: 'street-2d-building',
  satelit: 'satellite',
} as const

export type NamaGaya = keyof typeof GAYA_BASEMAP

export const urlGaya = (nama: NamaGaya = 'dasar') =>
  `https://basemap.mapid.io/styles/${GAYA_BASEMAP[nama]}/style.json?key=${MAPID_KEY}`

// --- Layer tematik ---------------------------------------------------------
// Nilai-nilai ini harus sama persis dengan FUNGSI_FRONTEND["setLayer"]["nama_layer"]
// di backend/app/api/ai.py — itu kontrak yang dikirim ke penyedia LLM.

export const LAYER: Record<string, { nama: string; keterangan: string }> = {
  opportunity: { nama: 'Skor Peluang', keterangan: 'Empat kuadran' },
  hidden_gem: { nama: 'GemFinder', keterangan: 'Lolos ≥ 2 dari 3 metode' },
  risk_radar: { nama: 'RiskRadar', keterangan: 'Kuadran Jebakan Gengsi' },
  pricelens: { nama: 'PriceLens', keterangan: 'Harga sewa median' },
  zoneguard: { nama: 'ZoneGuard', keterangan: 'Status izin RDTR' },
}

export type NamaLayer = 'opportunity' | 'hidden_gem' | 'risk_radar' | 'pricelens' | 'zoneguard'

// --- Wilayah studi ---------------------------------------------------------
// Enam kawasan pilot. Sama persis dengan KAWASAN_PILOT di pipeline/config.py.
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

// --- Warna kuadran ---------------------------------------------------------
// Empat kuadran, empat makna berbeda. JEBAKAN_GENGSI sengaja ditampilkan juga —
// itu yang membuat platform tidak hanya merekomendasikan, tapi juga melindungi.

export const WARNA_KUADRAN: Record<string, string> = {
  HIDDEN_GEM: '#10b981', // hijau — potensi tinggi, tampilan biasa
  PEMENANG_JELAS: '#3b82f6', // biru — potensi tinggi, tampilan mahal
  JEBAKAN_GENGSI: '#f59e0b', // amber — tampilan mahal, ekonomi tidak mendukung
  HINDARI: '#94a3b8', // abu — keduanya rendah
}

export const LABEL_KUADRAN: Record<string, string> = {
  HIDDEN_GEM: 'Hidden Gem',
  PEMENANG_JELAS: 'Pemenang Jelas',
  JEBAKAN_GENGSI: 'Jebakan Gengsi',
  HINDARI: 'Hindari',
}

// --- Badge keyakinan (Q01–Q03) ---------------------------------------------
// WAJIB tampil di setiap tempat skor muncul. Aturan ambangnya didefinisikan di
// backend (pipeline/config.py::tingkat_keyakinan); di sini hanya tampilannya.

export const WARNA_KEYAKINAN: Record<string, string> = {
  TINGGI: '#10b981',
  SEDANG: '#f59e0b',
  RENDAH: '#ef4444',
}

// --- API -------------------------------------------------------------------

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
