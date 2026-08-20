/**
 * Cerminan `backend/app/schemas.py`.
 *
 * Kalau skema backend berubah, berkas ini harus ikut berubah. Tidak ada
 * pembangkitan otomatis — jumlah tipenya sedikit dan stabil, dan menuliskannya
 * tangan membuat perbedaan langsung terlihat saat `tsc` dijalankan.
 */

export type TingkatKeyakinan = 'TINGGI' | 'SEDANG' | 'RENDAH'
export type SumberData = 'observed' | 'predicted'
export type Kuadran = 'HIDDEN_GEM' | 'JEBAKAN_GENGSI' | 'PEMENANG_JELAS' | 'HINDARI'

/**
 * Wajib menyertai setiap skor. Backend dirancang supaya tidak mungkin mengirim
 * skor tanpa badge — tipe di sini menegakkan aturan yang sama di frontend.
 */
export interface BadgeKeyakinan {
  n_titik_misi: number
  tingkat: TingkatKeyakinan
  sumber: SumberData
}

export interface IndeksKomposit {
  ipt: number | null // Potensi Transit — tinggi = baik
  iae: number | null // Aktivitas Ekonomi — tinggi = baik
  ikp: number | null // Kompetisi — tinggi = BURUK
  ibr: number | null // Biaya & Risiko — tinggi = BURUK
}

export interface SkorHeksagon {
  h3_index: string
  kawasan: string
  opportunity_score: number | null
  hidden_gem_score: number | null
  kuadran: Kuadran | null
  peringkat: number | null
  /** FALSE = ZoneGuard menolkan skor. NULL = kawasan tanpa RDTR digital, bukan larangan. */
  zona_izin_komersial: boolean | null
  keyakinan: BadgeKeyakinan
}

export interface FaktorSkor {
  kode_variabel: string
  indeks: 'IPT' | 'IAE' | 'IKP' | 'IBR'
  nilai_mentah: number | null
  nilai_normalisasi: number | null
  persentil: number | null
  kontribusi: number | null
}

export interface DetailHeksagon {
  skor: SkorHeksagon
  indeks: IndeksKomposit
  /** 41 variabel analisis, sudah teragregasi. Tidak pernah memuat record misi mentah. */
  variabel: Record<string, unknown>
  faktor: FaktorSkor[]
  /** B01–B04: distribusi transaksi per rentang jam. */
  commuter_clock: Record<string, number | null>
}

export interface SimpulTransit {
  id: number
  nama: string
  moda: string
  kawasan: string
  lat: number
  lon: number
}

// --- AI Consultant ---------------------------------------------------------

/** Tiga yang pertama dijalankan backend; empat sisanya aksi peta di frontend. */
export type NamaFungsi =
  | 'cari_lokasi'
  | 'bandingkan'
  | 'jelaskan_skor'
  | 'flyTo'
  | 'highlight'
  | 'setLayer'
  | 'filter'

/**
 * Bentuk konkret "spatial output" yang diminta ketentuan C.2: jawaban AI tidak
 * berhenti sebagai teks, tapi menggerakkan peta.
 */
export interface AksiPeta {
  fungsi: NamaFungsi
  argumen: Record<string, unknown>
}

export interface PermintaanAI {
  pertanyaan: string
  hex_terpilih?: string | null
  layer_aktif?: string | null
  viewport?: Record<string, number> | null
}

export interface JawabanAI {
  teks: string
  aksi_peta: AksiPeta[]
  /** Setiap angka di `teks` harus bisa ditelusuri ke sini. Kosong = tidak mengutip angka. */
  sumber_angka: FaktorSkor[]
  keyakinan: BadgeKeyakinan | null
}

// --- GeoJSON ---------------------------------------------------------------

/** Properti tiap feature dari GET /hex/layer. */
export interface PropertiHeksagon {
  h3_index: string
  kawasan: string
  opportunity_score: number | null
  hidden_gem_score: number | null
  kuadran: Kuadran | null
  zona_izin_komersial: boolean | null
  tingkat_keyakinan: TingkatKeyakinan
  n_titik_misi: number
  data_source: SumberData
}
