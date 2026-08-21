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
  /** 43 variabel analisis, sudah teragregasi. Tidak pernah memuat record misi mentah. */
  variabel: Record<string, unknown>
  faktor: FaktorSkor[]
  /** B01–B04: empat ember yang masuk skoring. Pola per jam ada di CommuterClock. */
  commuter_clock: Record<string, number | null>
  zoneguard: StatusZoneGuard
  risiko: PeringatanRisiko
  kuadran_penjelasan: string | null
}

// --- ZoneGuard (fitur 4) ---------------------------------------------------

export type StatusZona = 'DIIZINKAN' | 'DILARANG' | 'TIDAK_DIKETAHUI'

export interface StatusZoneGuard {
  status: StatusZona
  kelas_zona: string | null
  /** TRUE = skor dinolkan dan lokasi ini tidak pernah muncul di rekomendasi. */
  filter_mutlak: boolean
  penjelasan: string
}

// --- Commuter Clock (fitur 3) ----------------------------------------------

export interface TitikJam {
  jam: number
  n_transaksi: number
  nominal_total: number | null
  nominal_median: number | null
  /** 0–1. Penumpang tanpa alternatif selain transit. Estimasi dari proksi. */
  pangsa_captive: number | null
  pangsa_choice: number | null
  metode: 'observed' | 'proxy'
}

export interface CommuterClock {
  h3_index: string
  /** Selalu 18 titik, 05:00–22:00. Jam kosong tetap dikirim dengan n_transaksi 0. */
  jam: TitikJam[]
  ember: Record<string, number | null>
  jam_puncak: number | null
  pangsa_captive_harian: number | null
  dominasi: 'captive' | 'choice' | 'seimbang' | null
  keyakinan: BadgeKeyakinan
  /** Terisi kalau seluruh angkanya proxy — WAJIB ditampilkan kalau ada. */
  catatan: string | null
}

// --- PriceLens (fitur 1) ---------------------------------------------------

export interface RentangWajar {
  p25: number | null
  p50: number | null
  p75: number | null
  n_sampel: number
}

export type PosisiHarga = 'MURAH' | 'WAJAR' | 'MAHAL' | 'TIDAK_DIKETAHUI'

export interface PriceLensHeksagon {
  h3_index: string
  kawasan: string
  /** P07, rupiah per m² per bulan. Satu-satunya angka sewa yang bisa dibandingkan. */
  harga_sewa_per_m2: number | null
  harga_sewa_median: number | null
  belanja_per_jam: number | null
  harga_median_porsi: number | null
  njop_m2: number | null
  wajar_sewa_per_m2: RentangWajar
  wajar_belanja_per_jam: RentangWajar
  posisi_sewa: PosisiHarga
  selisih_persen_dari_median: number | null
  keyakinan: BadgeKeyakinan
}

// --- RiskRadar (fitur 5) ---------------------------------------------------

export type TingkatRisiko = 'AMAN' | 'WASPADA' | 'BAHAYA'

export interface PeringatanRisiko {
  tingkat: TingkatRisiko
  label: string
  indeks_churn: number | null
  ambang_waspada: number | null
  ambang_bahaya: number | null
}

export interface TitikKuadran {
  h3_index: string
  kawasan: string
  /** Sumbu datar: bagaimana lokasi terlihat. */
  x_prestise: number | null
  /** Sumbu tegak: apa kata datanya. */
  y_peluang: number | null
  kuadran: Kuadran | null
  indeks_churn: number | null
  risiko: TingkatRisiko
  keyakinan: BadgeKeyakinan
}

export interface DiagramKuadran {
  titik: TitikKuadran[]
  batas_x: number | null
  batas_y: number | null
  keterangan: Record<string, string>
}

// --- GemFinder (fitur 6) ---------------------------------------------------

export interface AlasanGem {
  metode: 'residual_biaya' | 'kuadran' | 'iptt'
  bukti: string
  kode_variabel: string[]
}

export interface HiddenGem {
  skor: SkorHeksagon
  /** Minimal 2 dari 3 metode. Angka resmi dari pipeline. */
  n_metode_lolos: number
  alasan: AlasanGem[]
  ringkasan: string
  zoneguard: StatusZoneGuard
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

/** Delapan yang pertama dijalankan backend; empat sisanya aksi peta di frontend. */
export type NamaFungsi =
  | 'cari_lokasi'
  | 'bandingkan'
  | 'jelaskan_skor'
  | 'cek_harga'
  | 'pola_jam'
  | 'cek_zona'
  | 'cari_hidden_gem'
  | 'cek_risiko'
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

/** Satu langkah yang benar-benar dijalankan backend. Bukti untuk ketentuan C.1. */
export interface JejakFungsi {
  fungsi: NamaFungsi
  argumen: Record<string, unknown>
  ringkas_hasil: string
}

export interface JawabanAI {
  teks: string
  aksi_peta: AksiPeta[]
  /** Setiap angka di `teks` harus bisa ditelusuri ke sini. Kosong = tidak mengutip angka. */
  sumber_angka: FaktorSkor[]
  keyakinan: BadgeKeyakinan | null
  /** Alat apa saja yang dipanggil — inilah yang membuat prosesnya bisa diperiksa. */
  jejak: JejakFungsi[]
  model: string | null
  hex_disebut: string[]
}

export interface StatusAI {
  siap: boolean
  model: string | null
  n_alat_backend: number
  n_alat_peta: number
  pesan: string | null
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
  indeks_churn: number | null
  harga_sewa_median: number | null
  harga_sewa_per_m2: number | null
  belanja_per_jam: number | null
  njop_m2: number | null
  tingkat_keyakinan: TingkatKeyakinan
  n_titik_misi: number
  data_source: SumberData
}
