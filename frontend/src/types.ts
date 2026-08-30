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

/**
 * Berapa bahan sebuah indeks yang benar-benar terukur.
 *
 * Variabel kosong DINETRALKAN ke 0,5, bukan dinolkan - benar untuk perhitungan,
 * berbahaya untuk tampilan. Tanpa ini, indeks yang seluruh bahannya kosong
 * tetap tampil sebagai angka di sekitar 0,5 dan tidak bisa dibedakan dari hasil
 * pengukuran. Terukur 30 Agu 2026: "perputaran uang" 1% terukur, "biaya dan
 * risiko" 5%.
 */
export interface CakupanIndeks {
  terukur: number
  total: number
  kosong: string[]
  /** false = angkanya nyaris seluruhnya asumsi. Tulis "belum terukur". */
  layak_tampil: boolean
}

export interface IndeksKomposit {
  ipt: number | null // Potensi Transit — tinggi = baik
  iae: number | null // Aktivitas Ekonomi — tinggi = baik
  ikp: number | null // Kompetisi — tinggi = BURUK
  ibr: number | null // Biaya & Risiko — tinggi = BURUK
  /** Berkunci 'IPT' | 'IAE' | 'IKP' | 'IBR'. Gratis untuk semua tingkat. */
  cakupan: Record<string, CakupanIndeks>
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

export interface Simulasi {
  h3_index: string
  kawasan: string
  masukan: {
    jenis_usaha: string
    label_usaha: string
    jam_buka: number
    luas_m2: number
    pangsa_persen: number
    margin_persen: number
    hari_per_bulan: number
    /** Diisi pengguna. Menang atas angka basis data kalau > 0. */
    sewa_bulanan_diminta: number | null
    harga_rata_rata: number | null
  }
  /**
   * Asal tiap angka yang bisa datang dari dua arah. `null` = belum ada dari
   * mana pun. Tanpa ini, angka yang diketik orang dan angka yang diukur
   * pipeline terlihat sama persis di layar.
   */
  sumber: {
    sewa: 'pengguna' | 'data' | null
    harga_rata_rata: 'pengguna' | 'data' | null
  }
  /** Dari basis data. Tidak bisa diubah pengguna. */
  terukur: {
    belanja_per_jam: number | null
    nominal_median_struk: number | null
    harga_median_porsi: number | null
    harga_sewa_per_m2: number | null
    indeks_kompetisi: number | null
    indeks_churn: number | null
  }
  /** Turunan. Semuanya boleh null - kosong tetap kosong, tidak pernah nol. */
  hasil: {
    omzet_harian: number | null
    omzet_bulanan: number | null
    sewa_bulanan: number | null
    laba_kotor_bulanan: number | null
    rasio_sewa_terhadap_omzet: number | null
    pembeli_impas_per_hari: number | null
    /**
     * Pangsa yang membuat laba tepat nol.
     *
     * Angka paling layak dipercaya di seluruh simulasi: ia TIDAK memuat asumsi
     * pangsa milik pengguna sama sekali - cuma harga sewa dibagi uang yang
     * benar-benar terukur di heksagon itu.
     */
    pangsa_impas_persen: number | null
    /** Sewa bulanan x 12. Ruko lazim ditagih setahun di muka. */
    sewa_tahun_pertama: number | null
    /** Hanya terisi kalau sewanya diisi sendiri - untuk disandingkan
     *  dengan sewa terukur di heksagon ini. */
    sewa_per_m2_tersirat: number | null
  }
  /** Laba pada beberapa nilai pangsa - rumus yang sama, masukan berbeda. */
  sensitivitas: { pangsa_persen: number; laba_kotor_bulanan: number | null }[]
  rumus: Record<string, string>
  peringatan: { kode: string; tingkat: 'INFO' | 'WASPADA' | 'BAHAYA'; pesan: string }[]
  keyakinan: BadgeKeyakinan
  jam_teramai: number[]
  /** Keadaan sekitar. Seluruhnya terukur — yang tidak ada dikirim null. */
  lingkungan: {
    populasi_100m: number | null
    populasi_usia_produktif: number | null
    n_kompetitor_langsung: number | null
    keragaman_kuliner: number | null
    n_menetap_kuliner: number | null
    jarak_simpul_m: number | null
    waktu_jalan_menit: number | null
    skor_simpul: number | null
    ridership_proksi: number | null
    kepadatan_poi_total: number | null
    kepadatan_kantor: number | null
    kepadatan_kos: number | null
    rasio_weekend: number | null
  }
  /** 05.00–22.00, `relatif` dinormalkan ke jam tersibuk heksagon ini. */
  profil_jam: { jam: number; relatif: number; pangsa_captive: number | null }[]
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
  /**
   * 43 variabel analisis, sudah teragregasi. Tidak pernah memuat record misi mentah.
   *
   * KOSONG untuk tamu dan akun gratis — backend tidak mengirimnya sama sekali,
   * bukan mengirim lalu membiarkan frontend memburamkannya. Periksa `terkunci`,
   * jangan `Object.keys(variabel).length`: keduanya kebetulan sepakat sekarang,
   * tetapi yang pertama menyatakan MAKSUD dan yang kedua cuma gejalanya.
   */
  variabel: Record<string, unknown>
  faktor: FaktorSkor[]
  /** Nama bagian yang ditahan backend karena tingkat akun. Kosong = terbuka penuh. */
  terkunci: string[]
  /** 'tamu' | 'gratis' | 'premium' — menurut BACKEND, bukan menurut state lokal. */
  tingkat_akun: string
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

export type TingkatRisiko = 'AMAN' | 'WASPADA' | 'BAHAYA' | 'TIDAK_DIKETAHUI'

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

/**
 * Hubungan satu heksagon dengan stasiun terdekatnya.
 *
 * BUKAN isochrone. Isochrone mengikuti jaringan jalan dan tinggal di
 * `catchment_areas` — masih kosong sampai routing dikerjakan. Yang ini garis
 * lurus, dan `garis_lurus` ada supaya antarmuka tidak bisa lupa mengatakannya.
 */
/**
 * Satu jalur jalan kaki heksagon -> simpul. Cermin `schemas.RuteJalan`.
 *
 * `koordinat` sudah [lon, lat], urutan GeoJSON - bisa langsung dipakai sebagai
 * geometri LineString tanpa dibalik.
 */
export interface RuteJalan {
  urutan: number
  jarak_m: number
  menit: number
  utama: boolean
  koordinat: [number, number][]
}

export interface KonteksSimpul {
  h3_index: string
  lat: number
  lon: number
  simpul: SimpulTransit | null
  jarak_m: number | null
  menit_jalan: number | null
  jarak_lurus_m: number | null
  /** jarak rute / jarak lurus. 1,7 = memutar 70% lebih jauh dari kelihatannya. */
  faktor_memutar: number | null
  rute: RuteJalan[]
  /** true = heksagon ini belum dirutekan, jaraknya jatuh ke garis lurus. */
  garis_lurus: boolean
  catatan: string
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

export interface PesanRiwayat {
  peran: 'pengguna' | 'asisten'
  teks: string
}

export interface PermintaanAI {
  pertanyaan: string
  /**
   * Giliran sebelumnya, terlama dulu. Dikirim ulang tiap giliran — backend
   * tanpa-status, jadi tidak ada sesi yang bisa bocor antarpengguna atau hilang
   * saat proses Render tidur. Backend membatasi 20 pesan.
   */
  riwayat?: PesanRiwayat[]
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

/**
 * Kesiapan backend.
 *
 * `data_sintetis` DITURUNKAN backend dari jumlah heksagon bertanda `predicted`,
 * bukan sakelar yang disetel tangan — jadi pitanya menyusut sendiri begitu
 * survei masuk, dan tidak bisa berbohong ke arah sebaliknya.
 *
 * `heksagon_predicted` ikut dibawa supaya TEKS pitanya juga bisa diturunkan dari
 * angka. Versi pertama menurunkan PEMICUNYA dari data tetapi menulis teksnya
 * dengan tangan ("Data demo — belum ada survei lapangan"), dan begitu variabel
 * sintetis dikosongkan, kedua bagian kalimat itu jadi salah sekaligus: datanya
 * bukan demo, dan survei lapangannya bukan nol.
 */
export interface Kesiapan {
  siap: boolean
  lingkungan: string
  basis_data: {
    terjangkau: boolean
    heksagon?: number
    heksagon_predicted?: number
    observasi_misi?: number
  }
  data_sintetis: boolean
  catatan_data: string | null
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


// --- Akun, langganan, token ------------------------------------------------

/**
 * Tingkat akses. Selalu dibaca dari respons backend, tidak pernah disimpulkan
 * di frontend dari "ada tiket berarti premium" — tiket cuma membuktikan siapa,
 * bukan membuktikan sudah bayar.
 */
export type Tingkat = 'tamu' | 'gratis' | 'premium'

export interface RingkasLangganan {
  paket: string
  selamanya: boolean
  berlaku_sampai: string | null
  dimulai_pada: string | null
}

export interface PreferensiUsaha {
  jenis_usaha: string | null
  kawasan: string | null
  budget_sewa_bulanan: number | null
}

export interface Akun {
  id: number
  nama_pengguna: string
  email: string
  nama_tampilan: string | null
  peran: string
  tingkat: 'gratis' | 'premium'
  saldo_token: number
  dibuat_pada: string | null
  langganan: RingkasLangganan | null
  /** Diisi saat onboarding premium. Menyetel bawaan simulasi dan saringan peta. */
  preferensi: PreferensiUsaha | null
}

export interface SesiAkun {
  tiket: string
  akun: Akun
}

export interface PaketLangganan {
  kode: string
  nama: string
  harga_rp: number
  satuan: string
  hari: number
  unggulan?: boolean
  rincian: string[]
}

export interface PaketToken {
  kode: string
  nama: string
  token: number
  harga_rp: number
}

export interface KatalogPaket {
  langganan: PaketLangganan[]
  token: PaketToken[]
  biaya_token: Record<string, number>
  mata_uang: string
  pembayaran_aktif: boolean
  catatan_pembayaran: string
}

export interface MutasiToken {
  jumlah: number
  keperluan: string
  catatan: string | null
  h3_index: string | null
  saldo_sesudah: number
  dibuat_pada: string
}

export interface ButirPantauan {
  h3_index: string
  kawasan: string | null
  /** Centroid heksagon, untuk pin di peta. */
  lat: number | null
  lon: number | null
  catatan: string | null
  skor_saat_dipantau: number | null
  skor_sekarang: number | null
  selisih: number | null
  versi_saat_dipantau: string | null
  versi_sekarang: string | null
  kuadran: Kuadran | null
  risiko: string | null
  dibuat_pada: string
}

export interface TitikRiwayat {
  versi: string
  dihitung_pada: string | null
  opportunity_score: number | null
  hidden_gem_score: number | null
  kuadran: Kuadran | null
  peringkat: number | null
}

export interface RiwayatSkor {
  h3_index: string
  titik: TitikRiwayat[]
  /** false = belum ada dua versi. JANGAN gambar garis tren; tulis catatannya. */
  cukup_untuk_tren: boolean
  catatan: string
}

export interface BarisKomparasi {
  h3_index: string
  kawasan: string
  opportunity_score: number | null
  hidden_gem_score: number | null
  kuadran: Kuadran | null
  peringkat: number | null
  indeks: IndeksKomposit
  zoneguard: StatusZoneGuard
  risiko: PeringatanRisiko
  harga_sewa_per_m2: number | null
  belanja_per_jam: number | null
  waktu_jalan_menit: number | null
  n_kompetitor_langsung: number | null
  keyakinan: BadgeKeyakinan
}

export interface Komparasi {
  baris: BarisKomparasi[]
  /**
   * Per metrik, h3_index yang menang — sudah memperhitungkan arah di BACKEND.
   * IKP dan IBR tinggi itu buruk; frontend tidak perlu tahu itu, cukup
   * menebalkan yang disebut. Nilai null = tidak ada kolom yang punya datanya.
   */
  menang: Record<string, string | null>
}

export interface AlasanRekomendasi {
  kode: string
  teks: string
  nilai: number | null
  /** cocok = mendukung, catatan = hal yang tetap harus diketahui. */
  jenis: 'cocok' | 'catatan'
}

export interface Rekomendasi {
  skor: SkorHeksagon
  kawasan: string
  lat: number | null
  lon: number | null
  harga_sewa_median: number | null
  harga_sewa_per_m2: number | null
  belanja_per_jam: number | null
  waktu_jalan_menit: number | null
  n_kompetitor_langsung: number | null
  indeks_churn: number | null
  zoneguard: StatusZoneGuard
  risiko: PeringatanRisiko
  alasan: AlasanRekomendasi[]
  ringkasan: string
}

export interface HasilRekomendasi {
  hasil: Rekomendasi[]
  total_cocok: number
  kriteria: {
    jenis_usaha: string | null
    kawasan: string[] | null
    budget_sewa_bulanan: number | null
    ringkas: string | null
  }
  /** true = daftar dipendekkan karena tingkat akun. `total_cocok` tetap jujur. */
  dipotong: boolean
  catatan: string
}

export interface DinamikaKawasan {
  kawasan: string
  n_heksagon: number
  churn_p50: number | null
  churn_p75: number | null
  churn_p90: number | null
  n_waspada: number
  n_bahaya: number
  per_kuadran: Record<string, number>
  rata_opportunity: number | null
  cakupan_survei: number | null
  versi: string
  catatan: string
}
