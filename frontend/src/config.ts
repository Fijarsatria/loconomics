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
// TIDAK ADA KUNCI DI BERKAS INI, dan itu bukan kehati-hatian berlebihan.
// Diukur 29 Agu 2026: kunci Map Services yang dulu duduk di sini SAMA PERSIS
// dengan kunci di backend/.env, dan kunci itu menjawab 200 di
// server.mapid.io/web/competition/{menugo,struckgo,propertigo,activities} —
// 100 baris survei MENTAH per halaman. Vite mem-bundel setiap variabel VITE_
// ke berkas publik, jadi kunci itu praktis diterbitkan bersama aplikasinya.
//
// Yang membuat pencabutannya murah: dari seluruh rantai basemap MAPID, HANYA
// style.json yang menuntut kunci (401 tanpa kunci). Ubin, font, dan TileJSON
// dilayani 200 tanpa kunci — ubin z14 Jakarta 397 KB, byte-nya identik. Jadi
// backend memproksikan satu berkas JSON per gaya dan membuang kuncinya dari
// badan respons; ubinnya tetap diambil peramban langsung dari MAPID.
//
// Lihat backend/app/api/meta.py::gaya_basemap.

/**
 * Endpoint raster/XYZ MAPID yang tertulis di dokumentasi mengembalikan 404 di
 * setiap level zoom (sudah diverifikasi sampai 0/0/0). Jalur vector style.json
 * yang berfungsi — itu sebabnya proyek ini memakai MapLibre GL, bukan Leaflet.
 */
/**
 * Gaya `satellite` DICABUT 29 Agustus 2026. Empat yang tersisa seluruhnya
 * melayani ubin dari basemap.mapid.io.
 *
 * Sebelumnya ini ditandai "keputusan pemilik repo" karena tampak sebagai
 * pertimbangan kepatuhan yang bisa ditimbang dua arah. Yang mengubahnya satu
 * temuan konkret saat gaya mulai disimpan sebagai berkas statis: `satellite`
 * membawa `access_token` Mapbox sepanjang 93 karakter MILIK ORANG LAIN, plus
 * tiga sumber ke api.maptiler.com. Menyajikannya berarti ikut menerbitkan
 * kredensial pihak ketiga dari deployment kita sendiri - dan itu bukan lagi
 * soal menimbang A.3, melainkan soal tidak menyebarkan kunci orang.
 *
 * Aturan keras #6 sudah menyatakannya lebih dulu: tidak ada sumber tile lain.
 */
export const GAYA_BASEMAP: Record<string, { id: string; label: string }> = {
  terang: { id: 'light', label: 'Terang' },
  dasar: { id: 'basic', label: 'Dasar' },
  jalan: { id: 'street-2d-building', label: 'Jalan' },
  gelap: { id: 'dark', label: 'Gelap' },
}

export type NamaGaya = keyof typeof GAYA_BASEMAP

/**
 * Berkas STATIS di `public/basemap/`, bukan panggilan ke backend.
 *
 * Kuncinya tetap tidak pernah ada di peramban - berkas ini dibangkitkan
 * `scripts/gaya-basemap.mjs` lewat proksi backend, yang mengambilnya dari MAPID
 * dengan kunci lalu membuangnya dari badan respons.
 *
 * Statis, karena kalau peramban memintanya ke backend saat peta dibuka, basemap
 * ikut mati setiap kali Render free tier sedang tidur - persis puluhan detik
 * pertama saat juri membuka tautan. Ini penerapan mitigasi yang sudah tertulis
 * di PRD untuk masalah yang sama: precompute, lalu sajikan dari CDN.
 *
 * Ubin, font, dan sprite TIDAK ikut jadi statis - ketiganya tetap diambil
 * peramban langsung dari MAPID.
 */
export const urlGaya = (nama: NamaGaya = 'terang') =>
  `${import.meta.env.BASE_URL}basemap/${GAYA_BASEMAP[nama].id}.json`

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
  /**
   * Satu frasa polos, untuk dibaca orang yang belum pernah melihat layar ini.
   *
   * "Pemenang Jelas" tidak memberi tahu apa pun tentang APA yang menang, dan
   * "Hidden Gem" cuma berarti sesuatu kalau tesis produknya sudah dijelaskan
   * lebih dulu. Nama kuadran tetap dipakai - ia identitas produk, dan kuncinya
   * tersimpan di basis data - tapi ia tidak pernah lagi berdiri sendirian.
   */
  ringkas: string
  /**
   * Warna untuk DOM. Sengaja `var(...)`, bukan hex.
   *
   * Hex harfiah membuat warna kuadran tidak bisa mengikuti tema: hijau #15803D
   * yang pas di atas kaca terang berubah jadi nyaris hitam di atas kaca gelap,
   * dan tidak ada satu pun cara memperbaikinya dari CSS karena nilainya tertulis
   * di atribut style inline. Lewat variabel, `.peta-gelap` cukup mendefinisikan
   * ulang empat baris.
   */
  warna: string
  /**
   * Warna untuk MapLibre. WAJIB hex harfiah - kanvas WebGL tidak mengenal
   * variabel CSS, dan `var(...)` di sana tidak menghasilkan galat, cuma
   * heksagon yang diam-diam tidak terwarnai.
   */
  warnaPeta: string
  lembut: string
  glif: string
  arti: string
  /** Posisi di grid 2×2 Kompas Kuadran: [kolom, baris], baris 0 = atas. */
  sel: [0 | 1, 0 | 1]
}

/**
 * Palet kuadran, dirombak 22 Agustus 2026 atas permintaan pemilik repo:
 * hijau = aman, biru = temuan, oranye = hati-hati, merah = jangan.
 *
 * Versi sebelumnya memakai teal/ungu/oranye dan MEMBIARKAN HINDARI tanpa warna,
 * dengan alasan abu-abu tidak lolos lantai chroma sebagai warna kategorikal.
 * Alasan itu benar tapi menyelesaikan masalah yang salah: yang dibutuhkan
 * bukan abu-abu, melainkan merah - dan "jangan" memang punya warna yang sudah
 * dipahami semua orang tanpa dijelaskan.
 *
 * Hue-nya tidak dipilih dari selera. Empat kandidat diuji dengan simulasi
 * dikromat Vienot 1999, diukur sebagai jarak minimum antar pasangan di CIELAB:
 *
 *                        normal  deutan  protan  tritan   minimum
 *   palet lama             32,7    17,2    11,4    23,9      11,4
 *   palet ini              51,1    27,1    14,9    18,9      14,9
 *
 * Jadi ia BUKAN penurunan mutu demi selera: lantai terburuknya justru naik dari
 * 11,4 ke 14,9. Yang dikorbankan cuma tritan (biru vs hijau, 23,9 -> 18,9), dan
 * itu ditebus oleh jarak terang-gelap yang sengaja dibuat lebar antara biru
 * #4C93F7 dan hijau #15803D - plus glif per kuadran, yang sejak awal memang ada
 * karena warna saja tidak pernah cukup.
 */
export const KUADRAN: Record<string, Kuadran> = {
  HIDDEN_GEM: {
    kunci: 'HIDDEN_GEM',
    nama: 'Hidden Gem',
    ringkas: 'bagus, belum mahal',
    warna: 'var(--q-gem)',
    warnaPeta: '#4C93F7',
    lembut: 'var(--q-gem-lembut)',
    glif: 'M8 1.6 14.4 8 8 14.4 1.6 8Z', // belah ketupat — sesuatu yang ditemukan
    arti: 'Datanya bagus, tampilannya biasa saja. Sewanya biasanya jauh lebih murah.',
    sel: [0, 0],
  },
  PEMENANG_JELAS: {
    kunci: 'PEMENANG_JELAS',
    // Dipendekkan jadi "Aman" (3 Sep 2026). "Aman tapi Mahal" memuat DUA
    // pernyataan dalam satu nama, dan yang kedua sudah dikatakan `ringkas` dan
    // `arti` di bawah - jadi harganya cuma nama yang panjang dan sulit dibaca
    // di lencana peta. Kuncinya tetap PEMENANG_JELAS.
    nama: 'Aman',
    ringkas: 'bagus, dan Anda membayar gengsinya',
    warna: 'var(--q-menang)',
    warnaPeta: '#15803D',
    lembut: 'var(--q-menang-lembut)',
    glif: 'M8 1.5A6.5 6.5 0 1 1 8 14.5 6.5 6.5 0 0 1 8 1.5Z', // lingkaran penuh
    arti: 'Datanya bagus dan tampilannya mahal. Aman, tetapi Anda ikut membayar gengsinya.',
    sel: [1, 0],
  },
  JEBAKAN_GENGSI: {
    kunci: 'JEBAKAN_GENGSI',
    nama: 'Jebakan Gengsi',
    ringkas: 'terlihat mahal, datanya lemah',
    warna: 'var(--q-jebakan)',
    warnaPeta: '#E58A00',
    lembut: 'var(--q-jebakan-lembut)',
    glif: 'M8 1.4 15 14.2H1Z', // segitiga — rambu peringatan
    arti: 'Tampilannya mahal tetapi ekonominya tidak mendukung. Kuadran yang paling sering menjebak.',
    sel: [1, 1],
  },
  HINDARI: {
    kunci: 'HINDARI',
    nama: 'Hindari',
    ringkas: 'sepi, dan tidak menonjol juga',
    warna: 'var(--q-hindari)',
    warnaPeta: '#B01B1B',
    lembut: 'var(--q-hindari-lembut)',
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

/**
 * Roda warna: 17 langkah, urut mengelilingi roda, TIDAK acak.
 *
 * Urutan inilah efeknya. Penghitungnya global dan maju satu langkah tiap huruf
 * yang tersentuh — bukan satu warna tetap per huruf — sehingga satu sapuan
 * kursor meninggalkan gradasi yang menyambung. Warna acak menghasilkan
 * kebisingan; urutan roda menghasilkan sesuatu yang terlihat disengaja.
 *
 * Ini PENGECUALIAN terhadap "warna jenuh hanya berarti kuadran" di index.css,
 * dan dicatat juga di sana. Ia aman justru karena tidak pernah menyentuh data:
 * yang diwarnai hanya identitas, hanya selama kursor ada di atasnya, dan tidak
 * satu pun angka atau heksagon ikut berubah.
 */
export const RODA_WARNA = [
  '#8B5CF6', '#A855F7', '#D946EF', '#EC4899', '#F43F5E', '#EF4444',
  '#F97316', '#F59E0B', '#EAB308', '#84CC16', '#22C55E', '#10B981',
  '#14B8A6', '#06B6D4', '#0EA5E9', '#3B82F6', '#6366F1',
]

/**
 * Identitas tim, untuk menu Tentang & Kontak di bilah atas.
 *
 * Ditaruh di sini, bukan ditulis di dalam komponen, karena ini DATA - dan data
 * yang belum ada harus terlihat belum ada. Yang kosong dirender sebagai
 * "belum diisi", persis aturan 4 repo ini: kosong tetap kosong, tidak
 * disamarkan jadi sesuatu yang terlihat lengkap.
 *
 * Empat baris terakhir sengaja dibiarkan kosong sampai pemilik repo mengisinya
 * dengan alamat yang benar-benar berlaku. Menebak alamat surel tim di halaman
 * yang akan dibaca juri jauh lebih buruk daripada mengakui belum ada.
 */
export const IDENTITAS = {
  produk: 'Loconomics',
  judulResmi: 'Transit-oriented Retail Recommender',
  lomba: 'MAPID WebGIS Competition #2 2026',
  tema: 'Maps That Think! — Mass Transportation Edition',
  tim: 'Tim #33 · Top 50',
  institusi: 'Telkom University, Bandung',
  ketua: 'Irvan Tegar Yunadi',
  email: '',
  instagram: '',
  situs: '',
  repositori: '',
}

/**
 * Tim di balik Loconomics, untuk halaman gerbang.
 *
 * Kelimanya diberikan langsung oleh pemilik repo pada 23 Agustus 2026. Empat
 * ditulis dengan nama panggilan sebagaimana diberikan; hanya ketua tim yang
 * memakai nama lengkap, karena hanya nama itu yang tercatat di PRD. Nama
 * lengkap yang lain TIDAK dikarang untuk menyeragamkan tampilan - halaman ini
 * dibaca juri, dan nama karangan di sana jauh lebih mahal daripada dua gaya
 * penulisan yang berbeda dalam satu barisan kartu.
 *
 * `kerja` bukan basa-basi jabatan. Tiap baris menunjuk ke sesuatu yang benar
 * ada di repositori ini, jadi kartunya bisa diperiksa, bukan cuma dibaca.
 */
export interface Pendiri {
  nama: string
  peran: string
  /** Inisial untuk avatar. Dikosongkan berarti kartunya belum terisi. */
  inisial: string
  /** Satu kalimat: apa yang benar-benar ia kerjakan di produk ini. */
  kerja: string
  /** Ditandai di kartu. Hanya satu orang yang boleh membawanya. */
  ketua?: boolean
}

export const PENDIRI: Pendiri[] = [
  {
    nama: 'Ajis',
    peran: 'Data Analyst',
    inisial: 'AJ',
    kerja: 'Mengubah hasil misi survei MAPID jadi Kamus Data 43 variabel per heksagon — termasuk membiarkan yang kosong tetap kosong.',
  },
  {
    nama: 'Ukas',
    peran: 'AI Engineer',
    inisial: 'UK',
    kerja: 'Konsultan AI: dua belas alat mode strict di dalam satu loop agentik. Modelnya menjawab, tidak pernah menghitung.',
  },
  {
    nama: 'Wily',
    peran: 'UI/UX Designer',
    inisial: 'WL',
    kerja: 'Sistem visual dan Kompas Kuadran — empat kuadran yang bisa dipahami tanpa seorang pun menjelaskannya lebih dulu.',
  },
  {
    nama: 'Fijar',
    peran: 'WebGIS Developer',
    inisial: 'FJ',
    kerja: 'Peta MapLibre di atas basemap MAPID, API FastAPI, dan basis data PostGIS di Supabase.',
  },
  {
    nama: IDENTITAS.ketua,
    peran: 'Business Analyst',
    inisial: 'IR',
    kerja: 'Merumuskan dua pertanyaan yang dijawab produk ini: mana yang tersembunyi, dan mana yang menjebak.',
    ketua: true,
  },
]

/**
 * Enam fitur produk, untuk halaman gerbang.
 *
 * Sama persis dengan enam fitur di PRD dan dengan yang benar-benar terpasang di
 * backend. Tidak ada fitur ketujuh yang "sedang dikerjakan" di daftar ini —
 * halaman perkenalan yang menjanjikan sesuatu yang belum ada adalah utang yang
 * ditagih tepat saat demo.
 */
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
    nama: 'Konsultan AI',
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
}

export const LAYER: Record<string, Layer> = {
  opportunity: { nama: 'Opportunity Score', pertanyaan: 'Di mana yang paling menjanjikan?' },
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
//
// KOORDINATNYA juga dijaga uji, dan itu perbaikan 29 Agu 2026. Sebelumnya daftar
// ini salah satu dari TIGA salinan pusat kawasan (bersama pipeline/s1_ingest.py
// dan pipeline/demo_seed.py). Ketiganya cocok satu sama lain, jadi tidak ada uji
// yang bisa menangkap bahwa ketiganya sama-sama salah — dan memang ada yang
// salah: pusat Harjamukti duduk 4.443 m dari stasiun LRT-nya. Sekarang Python
// punya satu sumber (pipeline/config.py::PUSAT) dan berkas ini dibandingkan
// dengannya.

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

/**
 * Nilai kawasan yang berarti "jangan disaring".
 *
 * Backend sudah memperlakukan `kawasan` yang tidak dikirim sebagai seluruh
 * kawasan (`periksa_kawasan(None)` mengembalikan None, filternya tidak dipasang),
 * jadi yang perlu ditambahkan hanya cara MENYATAKANNYA dari antarmuka. Sengaja
 * string kosong, bukan kata "Semua": string kosong tidak akan pernah lolos
 * `periksa_kawasan()` kalau suatu saat ikut terkirim, jadi salah pakai berujung
 * galat yang terlihat - bukan diam-diam menyaring ke kawasan yang tidak ada.
 */
export const SEMUA_KAWASAN = ''

/** Label untuk keadaan tanpa saringan. */
export const LABEL_SEMUA_KAWASAN = 'Semua kawasan'

/**
 * Nilai saringan kawasan itu bentuk MESIN: string kosong berarti "semua", koma
 * berarti "beberapa". Keduanya benar sebagai parameter kueri dan keduanya salah
 * begitu ditempel ke layar.
 *
 * Tanpa kedua fungsi di bawah, kalimat `Belum ada heksagon di {kawasan}`
 * berhenti di "Belum ada heksagon di " — dan justru pada tampilan BAWAAN, yang
 * paling sering dilihat orang.
 */

/** Untuk chip, judul kartu, dan kepala panel. */
export const labelKawasan = (kawasan: string): string =>
  kawasan === SEMUA_KAWASAN
    ? LABEL_SEMUA_KAWASAN
    : kawasan.split(',').filter(Boolean).join(' + ')

/**
 * Untuk DI DALAM kalimat. Bedanya bukan gaya: "di Semua kawasan" terbaca
 * sebagai salah ketik, sedangkan "di seluruh kawasan pilot" terbaca sebagai
 * kalimat. Tidak menyebut angka enam supaya tidak bisa berselisih dengan
 * KAWASAN_PILOT kalau daftarnya berubah.
 */
export const frasaKawasan = (kawasan: string): string =>
  kawasan === SEMUA_KAWASAN
    ? 'seluruh kawasan pilot'
    : kawasan.split(',').filter(Boolean).join(' dan ')

/**
 * Bingkai yang memuat keenam kawasan pilot sekaligus, [barat, selatan, timur,
 * utara]. Dipakai saat kawasan tidak disaring - terbang ke salah satu pusatnya
 * akan menyembunyikan lima yang lain.
 */
export const BINGKAI_SEMUA: [number, number, number, number] = [106.79, -6.41, 107.02, -6.17]

/** Bawaan sekarang SEMUA kawasan: layar pertama menunjukkan seluruh cakupan. */
export const KAWASAN_AWAL = KAWASAN_PILOT[0]
export const ZOOM_AWAL = 14

// --- Nama heksagon yang bisa dibaca orang ----------------------------------
/**
 * `898c1079dd7ffff` → `Manggarai-40407`.
 *
 * Indeks H3 adalah alamat sel di grid global Uber H3 resolusi 9. Ia kunci utama
 * basis data dan tidak akan pernah diganti — tetapi lima belas karakter
 * heksadesimal tidak bisa dibaca, tidak bisa diingat, dan tidak bisa disebutkan
 * lewat telepon. Nama di bawah untuk mata; indeksnya tetap ada di panel detail
 * bagi yang memang membutuhkannya.
 *
 * TANPA KEADAAN — diturunkan dari indeksnya sendiri, bukan nomor urut. Nomor
 * urut menuntut seluruh himpunan diketahui, dan tiap heksagon baru akan
 * menggeser nomor tetangganya, termasuk yang sudah tercetak di Laporan
 * Kelayakan orang. Potongan `h3[7:11]` adalah bagian yang membedakan sel
 * bertetangga: diuji ke seluruh 708 heksagon, nol bentrok, bahkan tanpa nama
 * kawasannya.
 *
 * Kembarannya di backend: `core/aturan.py::kode_lokasi`.
 */
export const kodeLokasi = (h3: string, kawasan: string): string =>
  `${kawasan}-${String(parseInt(h3.slice(7, 11), 16)).padStart(5, '0')}`

/** Tanpa nama kawasan — untuk tempat sempit seperti kepala kolom komparasi. */
export const nomorLokasi = (h3: string): string =>
  String(parseInt(h3.slice(7, 11), 16)).padStart(5, '0')

// --- Bahasa untuk orang awam -----------------------------------------------
/**
 * Yang membaca layar ini calon pemilik warung, bukan analis data.
 *
 * Tiga aturan: nama benda bukan nama kolom; PENDEK (satu frasa, bukan satu
 * kalimat); satuannya ikut. Kode variabel tetap ada di kolom pertama karena ia
 * identitas kanonik — yang berubah hanya apa yang sampai ke mata.
 *
 * Cerminan `backend/app/core/aturan.py::ARTI_VARIABEL`, dijaga sama oleh
 * `backend/tests/test_aturan.py`.
 */
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

/** kode → nama awam. Daftar faktor pembentuk skor berkunci KODE, bukan kolom. */
export const ARTI_KODE: Record<string, string> = Object.fromEntries(
  Object.values(ARTI_VARIABEL).map((v) => [v.kode, v.nama]),
)

/** Keempat indeks dalam bahasa biasa. */
export const ARTI_INDEKS: Record<string, string> = {
  IPT: 'akses ke stasiun',
  IAE: 'perputaran uang',
  IKP: 'ketatnya persaingan',
  IBR: 'biaya dan risiko',
}

/**
 * Pertanyaan yang sebenarnya dijawab tiap indeks, dalam kalimat orang.
 *
 * "Indeks Potensi Transit 0,79" tidak menjawab pertanyaan siapa pun. Yang
 * dicari orang yang sedang menimbang lokasi adalah "gampang nggak orang ke
 * sini", dan itu yang ditulis di layar.
 */
export const TANYA_INDEKS: Record<string, string> = {
  IPT: 'Gampang tidak orang sampai ke sini?',
  IAE: 'Ada tidak uang berputar di sini?',
  IKP: 'Sudah ramai pesaing atau belum?',
  IBR: 'Mahal dan berisiko tidak?',
}

/**
 * Angka 0-1 diterjemahkan jadi KATA, per indeks.
 *
 * Empat kosakata terpisah, bukan satu "bagus/sedang/buruk" untuk semuanya, dan
 * itu bukan hiasan: dua dari empat indeks BERBALIK arah. Persaingan yang tinggi
 * bukan "bagus", dan biaya yang tinggi bukan "buruk" begitu saja - ia mahal.
 * Memakai satu kosakata memaksa antarmuka menempelkan "tinggi = buruk" di
 * sebelahnya, dan itu persis kalimat yang membuat orang berhenti membaca.
 *
 * Ambangnya aturan TAMPILAN. Menggesernya mengubah kata yang muncul, tidak
 * pernah mengubah peringkat satu lokasi pun.
 */
const AMBANG_KATA = [0.75, 0.55, 0.35] as const

const KATA_INDEKS: Record<string, readonly [string, string, string, string]> = {
  // urut dari nilai TERTINGGI ke terendah
  IPT: ['Sangat mudah', 'Mudah', 'Lumayan', 'Sulit'],
  IAE: ['Sangat ramai', 'Ramai', 'Sedang', 'Sepi'],
  IKP: ['Sangat ketat', 'Ketat', 'Sedang', 'Masih longgar'],
  IBR: ['Mahal', 'Agak mahal', 'Sedang', 'Murah'],
}

/**
 * Apakah nilai TINGGI pada indeks ini kabar baik.
 *
 * Dipakai untuk mewarnai bilahnya, bukan untuk menempelkan kata "buruk":
 * lokasi yang persaingannya ketat belum tentu salah dipilih - kadang justru
 * di situ pembelinya.
 */
export const TINGGI_BAIK: Record<string, boolean> = {
  IPT: true,
  IAE: true,
  IKP: false,
  IBR: false,
}

/**
 * Turunkan sebuah label jadi bentuk yang layak di TENGAH kalimat.
 *
 * `.toLowerCase()` saja tidak cukup: ia mengecilkan akronim juga, dan
 * "NJOP tanah" jadi "njop tanah". Yang benar cuma huruf pertama, dan itu pun
 * tidak kalau kata pertamanya memang ditulis kapital seluruhnya.
 */
export function keKalimat(teks: string): string {
  const kata = teks.split(' ')[0] ?? ''
  if (kata.length > 1 && kata === kata.toUpperCase()) return teks
  return teks.charAt(0).toLowerCase() + teks.slice(1)
}

/** "a", "a dan b", "a, b, dan c". Daftar yang disambung koma saja terbaca putus. */
function rangkai(bagian: string[]): string {
  if (bagian.length <= 1) return bagian[0] ?? ''
  return `${bagian.slice(0, -1).join(', ')} dan ${bagian[bagian.length - 1]}`
}

/**
 * Sumbu datar kuadran berdiri di atas bahan apa — satu sampai dua kalimat.
 *
 * ADA KARENA `pipeline/s6_score.py::hitung_prestise_visual()` merata-ratakan
 * lima bahan dengan `skipna=True`: bahan yang kosong dilewati begitu saja, dan
 * sumbunya tetap menghasilkan angka untuk setiap heksagon. Terukur 2 Sep 2026,
 * DUA bahan kosong di seluruh wilayah studi — dan keduanya justru satu-satunya
 * yang menilai tampilan secara LANGSUNG (M03 dinilai dari foto, P02 dari nilai
 * tanah). Yang menggerakkan sumbunya tinggal porsi waralaba dan bentuk
 * bangunan: proksi yang masuk akal, tetapi proksi. Angkanya benar; nama sumbunya
 * yang menjanjikan lebih banyak daripada yang diukur.
 *
 * Ambang berbasis JUMLAH sengaja tidak dipakai — tiga dari lima itu 60%, jadi
 * ambang apa pun lolos dengan mulus justru pada keadaan yang jadi masalahnya.
 * Yang menentukan bahan yang MANA, jadi yang disebutkan daftarnya.
 *
 * Kalimatnya DITURUNKAN dari daftar itu, tidak ditulis tetap: begitu satu bahan
 * terisi ia berubah sendiri, dan begitu kelimanya terisi ia hilang sendiri.
 * Aturan yang sama dengan pita status dan bagian temuan di gerbang — kalau
 * sebuah pemicu perlu dihitung dari data supaya tidak berbohong, kalimat yang
 * menyertainya perlu dihitung juga.
 *
 * SATU fungsi untuk kedua tempat yang memakainya. Kalau dipecah, "sumbu ini
 * berdiri di atas apa" akan berarti dua hal berbeda di dua layar yang
 * memperlihatkan sumbu yang sama.
 */
export function frasaPrestise(
  cakupan: { terisi: string[]; kosong: string[]; diukur_langsung: boolean } | null | undefined,
  lingkup: 'lokasi' | 'wilayah',
): string[] {
  if (!cakupan) return []
  const { terisi, kosong, diukur_langsung } = cakupan
  // Kelimanya terukur: tidak ada yang perlu dinyatakan, dan baris keterangan
  // yang isinya "semuanya lengkap" cuma menambah teks tanpa menambah kejujuran.
  if (kosong.length === 0) return []

  const di = lingkup === 'lokasi' ? 'di lokasi ini' : 'di satu pun lokasi'
  const nama = (kode: string) => keKalimat(ARTI_KODE[kode] ?? kode)

  if (terisi.length === 0) {
    return [`Belum ada satu pun bahan sumbu ini yang terukur ${di}.`]
  }

  const kalimat = [
    `Diperkirakan dari ${terisi.length} dari ${terisi.length + kosong.length} bahan: ` +
      `${rangkai(terisi.map(nama))}.`,
  ]
  if (!diukur_langsung) {
    // DUA pernyataan, dipisah titik koma, dan pemisahan itu bukan gaya bahasa.
    // Yang kedua mendaftar SELURUH yang kosong, termasuk proksi seperti porsi
    // waralaba - kalau ia digabung jadi satu klausa dengan yang pertama, daftar
    // itu terbaca seolah seluruh isinya penilai tampilan langsung, dan itu
    // tidak benar. Memisahkannya juga yang membuat frontend tidak perlu
    // menyalin BAHAN_PRESTISE_LANGSUNG dari backend: daftar yang dipelihara di
    // dua tempat akan berpisah, dan `diukur_langsung` sudah menjawabnya.
    kalimat.push(
      `Belum ada satu pun bahan yang menilai tampilannya secara langsung; ` +
        `yang belum terukur ${di}: ${rangkai(kosong.map(nama))}.`,
    )
  }
  return kalimat
}

export function kataIndeks(kode: string, nilai: number | null): string | null {
  if (nilai === null || !KATA_INDEKS[kode]) return null
  const kata = KATA_INDEKS[kode]
  if (nilai >= AMBANG_KATA[0]) return kata[0]
  if (nilai >= AMBANG_KATA[1]) return kata[1]
  if (nilai >= AMBANG_KATA[2]) return kata[2]
  return kata[3]
}

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
