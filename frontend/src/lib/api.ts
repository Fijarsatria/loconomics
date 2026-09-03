/**
 * Satu-satunya tempat frontend memanggil backend.
 *
 * Komponen tidak boleh memanggil `fetch` sendiri. Kalau nanti perlu retry,
 * pembatalan, atau header autentikasi, tempatnya hanya satu.
 *
 * Header autentikasi itu sekarang ADA, dan ia dipasang di sini — bukan
 * diteruskan sebagai argumen dari tiap komponen yang kebetulan sedang memegang
 * tiket. Satu tempat memasangnya berarti tidak ada endpoint yang bisa lupa
 * membawanya, dan tidak ada komponen yang perlu tahu bentuk tiketnya.
 */

import { API_BASE } from '../config'
import type {
  Akun,
  ButirPantauan,
  CommuterClock,
  DetailHeksagon,
  DiagramKuadran,
  DinamikaKawasan,
  HasilRekomendasi,
  HiddenGem,
  KatalogPaket,
  Kesiapan,
  Komparasi,
  KonteksSimpul,
  ProfilRute,
  JawabanAI,
  PeringatanRisiko,
  PermintaanAI,
  MutasiToken,
  PriceLensHeksagon,
  RiwayatSkor,
  SesiAkun,
  SimpulTransit,
  Simulasi as SimulasiHasil,
  SkorHeksagon,
  StatusAI,
  StatusZoneGuard,
  TitikKuadran,
} from '../types'

type GeoJSON = { type: 'FeatureCollection'; features: unknown[] }

/** Kunci localStorage untuk tiket sesi. */
const KUNCI_TIKET = 'loconomics.tiket'

/**
 * Tiket disimpan di modul DAN di localStorage.
 *
 * Salinan di modul supaya `ambil()` tidak menyentuh localStorage di setiap
 * permintaan — pembacaannya sinkron dan memblokir utas utama, dan peta ini
 * memanggil backend puluhan kali saat memuat. Salinan di localStorage supaya
 * sesi selamat dari refresh; itu permintaan eksplisit pemilik repo.
 */
let tiketSekarang: string | null = null
try {
  tiketSekarang = localStorage.getItem(KUNCI_TIKET)
} catch {
  // Mode privat sebagian peramban melempar di sini. Sesi tanpa penyimpanan
  // tetap sesi yang sah — ia cuma tidak selamat dari refresh.
  tiketSekarang = null
}

export function setTiket(tiket: string | null): void {
  tiketSekarang = tiket
  try {
    if (tiket) localStorage.setItem(KUNCI_TIKET, tiket)
    else localStorage.removeItem(KUNCI_TIKET)
  } catch {
    /* lihat alasan di atas */
  }
}

export const adaTiket = (): boolean => tiketSekarang !== null

/**
 * Galat yang membawa KODE backend, bukan cuma teksnya.
 *
 * Ini yang membuat antarmuka bisa bercabang dengan benar: 401 membuka dialog
 * masuk, 402 BUTUH_PREMIUM membuka dialog langganan, 402 TOKEN_TIDAK_CUKUP
 * membuka etalase token. Mencabangkan pada teks pesan akan pecah begitu
 * pesannya diperbaiki — dan pesan memang sering diperbaiki.
 */
export class GalatAPI extends Error {
  // Ditulis sebagai field lalu diisi di badan constructor, bukan sebagai
  // parameter-property (`readonly kode: string` di daftar parameter). Yang
  // kedua lebih ringkas tetapi ditolak `erasableSyntaxOnly` di tsconfig repo
  // ini: ia sintaks TypeScript yang MENGHASILKAN kode, bukan yang hilang saat
  // tipe dilucuti.
  readonly status: number
  readonly kode: string
  readonly detail?: unknown

  constructor(status: number, kode: string, pesan: string, detail?: unknown) {
    super(pesan)
    this.name = 'GalatAPI'
    this.status = status
    this.kode = kode
    this.detail = detail
  }
}

/**
 * Batas waktu satu permintaan. Jaring pengaman, bukan mekanisme utama.
 *
 * `fetch` tanpa `signal` menunggu SELAMANYA - peramban baru menyerah setelah
 * satu-dua menit, dan sampai saat itu tidak ada satu pun galat yang bisa
 * ditangkap. Itu jadi masalah nyata begitu backend duduk di Render free tier:
 * layanannya TIDUR sesudah 15 menit menganggur dan bangunnya memakan puluhan
 * detik, jadi permintaan pertama tidak gagal - ia menggantung. Yang terlihat
 * di layar bukan pesan galat melainkan antarmuka yang membeku, dan cadangan
 * statis di `layerHeksagon` tidak pernah menyala karena tidak ada yang dilempar.
 *
 * 25 detik, bukan lima: yang dijaga di sini backend yang TIDAK MENJAWAB, bukan
 * backend yang lambat. `/meta/siap` sendiri butuh 2,6 dtk lewat Supabase, dan
 * memutus permintaan yang sebenarnya masih dalam perjalanan menghasilkan
 * kegagalan yang kita karang sendiri.
 */
const BATAS_WAKTU_MS = 25_000

async function ambil<T>(jalur: string, opsi?: RequestInit): Promise<T> {
  const kepala: Record<string, string> = { 'Content-Type': 'application/json' }
  if (tiketSekarang) kepala.Authorization = `Bearer ${tiketSekarang}`

  const res = await fetch(`${API_BASE}${jalur}`, {
    signal: AbortSignal.timeout(BATAS_WAKTU_MS),
    ...opsi,
    headers: { ...kepala, ...(opsi?.headers as Record<string, string> | undefined) },
  })
  if (!res.ok) {
    // Amplop galat backend selalu berbentuk { galat: { kode, pesan, ... } }.
    // Kalau ternyata bukan JSON (proxy mati, HTML 502), jangan ikut runtuh —
    // pakai teks apa adanya dan beri kode generik.
    let kode = `HTTP_${res.status}`
    let pesan = `${res.status} ${jalur}`
    let detail: unknown
    const mentah = await res.text().catch(() => '')
    try {
      const j = JSON.parse(mentah)
      if (j?.galat) {
        kode = j.galat.kode ?? kode
        pesan = j.galat.pesan ?? pesan
        detail = j.galat.detail
      }
    } catch {
      // Badan yang BUKAN JSON ikut ditempel ke pesan - berguna saat proxy
      // menjawab teks pendek, dan merusak saat ia menjawab halaman HTML:
      // yang muncul di layar jadi potongan `<!doctype html><head><meta ...`.
      // Terlihat di terbitan statis, tempat setiap endpoint backend dijawab
      // halaman 404 GitHub Pages.
      const htmlSaja = /^\s*<(!doctype|html)/i.test(mentah)
      if (mentah && !htmlSaja) pesan = `${pesan} — ${mentah.slice(0, 200)}`
      else if (htmlSaja) pesan = `${pesan} — mesin data tidak menjawab di alamat ini`
    }
    throw new GalatAPI(res.status, kode, pesan, detail)
  }
  return res.json() as Promise<T>
}

const kueri = (params: Record<string, string | number | boolean | undefined>) => {
  const q = new URLSearchParams()
  // String KOSONG diperlakukan sama dengan undefined: dibuang, bukan dikirim.
  //
  // Antarmuka memakai '' untuk "kawasan tidak disaring", dan backend memakai
  // parameter yang TIDAK ADA untuk hal yang sama. Tanpa baris ini yang terkirim
  // adalah ?kawasan= , dan periksa_kawasan() menolaknya sebagai nama kawasan
  // yang tidak dikenal - benar menurut aturannya sendiri, tapi bukan yang
  // dimaksud. Angka 0 dan false TETAP dikirim; keduanya nilai yang sah.
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v))
  const s = q.toString()
  return s ? `?${s}` : ''
}

/**
 * Unduh berkas PDF.
 *
 * Satu-satunya jalur yang TIDAK lewat `ambil()`: jawabannya berkas, bukan JSON,
 * jadi `res.json()` akan meledak. Amplop galatnya tetap dibaca dengan bentuk
 * yang sama supaya cabang 402 di pemanggil tidak perlu tahu bedanya.
 */
async function unduhPdf(jalur: string, namaBerkas: string): Promise<void> {
  const kepala: Record<string, string> = {}
  if (tiketSekarang) kepala.Authorization = `Bearer ${tiketSekarang}`
  const res = await fetch(`${API_BASE}${jalur}`, { headers: kepala })
  if (!res.ok) {
    let kode = `HTTP_${res.status}`
    let pesan = 'Gagal mengunduh berkas.'
    try {
      const j = JSON.parse(await res.text())
      kode = j?.galat?.kode ?? kode
      pesan = j?.galat?.pesan ?? pesan
    } catch {
      /* biarkan pesan bawaan */
    }
    throw new GalatAPI(res.status, kode, pesan)
  }
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = namaBerkas
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Dicabut setelah klik sempat diproses. Mencabutnya langsung membatalkan
  // unduhan di sebagian peramban.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Ketuk backend sekali saat halaman dibuka, lalu lupakan hasilnya.
 *
 * Render free tier TIDUR sesudah 15 menit menganggur, dan bangunnya memakan
 * puluhan detik. Yang menanggung ongkos itu selalu permintaan PERTAMA - dan di
 * alur produk ini permintaan pertama jatuh tepat di layar pembuka, yaitu satu
 * dari dua layar yang pasti dilihat juri.
 *
 * Yang membuat ini nyaris gratis: urutannya gerbang -> pembuka -> peta, dan
 * gerbang adalah halaman scrollytelling sembilan bagian yang sengaja dibuat
 * untuk dibaca. Puluhan detik itu sudah ada di sana, dan sebelumnya dihabiskan
 * dengan backend yang tetap tertidur. Sesudah ini ia dipakai membangunkannya.
 *
 * Sengaja `void` dan tanpa penanganan galat: tidak ada satu pun keputusan di
 * antarmuka yang bergantung pada jawabannya. Yang memeriksa kesiapan tetap
 * layar pembuka, dengan percobaan ulangnya sendiri.
 */
export function bangunkan(): void {
  if (!API_BASE) return
  void fetch(`${API_BASE}/health`, {
    signal: AbortSignal.timeout(BATAS_WAKTU_MS),
  }).catch(() => null)
}

export const api = {
  /**
   * `opsi` ada untuk satu pemanggil: layar pembuka, yang memeriksa berkali-kali
   * dengan batas waktu pendek alih-alih sekali dengan batas waktu panjang.
   */
  sehat: (opsi?: RequestInit) => ambil<{ status: string }>('/health', opsi),

  /**
   * Kesiapan backend, dipanggil sekali saat memuat.
   *
   * Dipakai untuk satu hal di antarmuka: memutuskan apakah pita "data demo"
   * dipasang. Backend yang menurunkan jawabannya dari jumlah baris observasi
   * misi, jadi frontend tidak pernah perlu tahu - apalagi menebak - apakah isi
   * petanya sungguhan.
   */
  kesiapan: () => ambil<Kesiapan>('/meta/siap'),

  // --- Heksagon ---
  /** `kawasan` boleh satu nama atau beberapa dipisah koma (alat Premium). */
  /**
   * Grid heksagon. SATU-SATUNYA endpoint yang punya sumber cadangan statis.
   *
   * Kenapa hanya yang ini: tanpa heksagon, layar utama produk ini kosong
   * melompong dan tidak ada satu pun yang bisa ditunjukkan. Sisanya - daftar,
   * kuadran, detail - boleh gagal dengan pesan yang jujur, karena kegagalannya
   * terlihat sebagai bagian yang kosong, bukan sebagai aplikasi yang mati.
   *
   * Berkasnya dibangkitkan `s7_publish.py --ekspor`, isinya SAMA PERSIS dengan
   * respons endpoint ini - 708 fitur, 840 KB untuk keenam kawasan. Dipakai
   * hanya kalau backend tidak bisa dihubungi sama sekali; kalau backend
   * menjawab dengan galat, galatnya diteruskan apa adanya. Backend yang SALAH
   * tidak boleh disamarkan jadi backend yang TIDAK ADA.
   */
  layerHeksagon: async (p: { kawasan?: string; min_score?: number; versi?: string } = {}) => {
    const statis = async () => {
      const nama =
        !p.kawasan || p.kawasan.includes(',')
          ? 'semua'
          : p.kawasan.toLowerCase().replace(/ /g, '-')
      const res = await fetch(`${import.meta.env.BASE_URL}data/hex-${nama}.geojson`)
      if (!res.ok) throw new GalatAPI(res.status, 'STATIS_TIDAK_ADA', `data/hex-${nama}.geojson`)
      return (await res.json()) as GeoJSON
    }

    // TIDAK ADA backend dan BACKEND YANG MENOLAK adalah dua keadaan berbeda,
    // dan membedakannya harus dari konfigurasi - bukan dari bentuk galatnya.
    //
    // Versi pertama membedakannya lewat `e instanceof GalatAPI`, dan itu salah:
    // dengan API_BASE kosong, permintaannya jadi relatif dan GitHub Pages
    // menjawab 404 HTML - yang terbaca persis seperti backend yang menolak.
    // Jadi cadangannya tidak akan pernah dipakai, tepat di satu-satunya
    // keadaan yang ia dibuat untuknya.
    if (!API_BASE) return statis()

    try {
      return await ambil<GeoJSON>(`/hex/layer${kueri(p)}`)
    } catch (e) {
      // Backend DIKONFIGURASI tapi tidak terjangkau (mati, tidur, jaringan
      // putus): pakai cadangan supaya peta tetap tergambar. Backend yang
      // menjawab dengan galat diteruskan apa adanya - backend yang SALAH tidak
      // boleh disamarkan jadi backend yang TIDAK ADA.
      if (e instanceof GalatAPI) throw e
      return statis()
    }
  },

  detailHeksagon: (h3: string, versi?: string) =>
    ambil<DetailHeksagon>(`/hex/${h3}${kueri({ versi })}`),

  /**
   * Stasiun terdekat + jarak garis lurus, untuk garis penghubung di peta.
   * GRATIS: ini konteks peta, bukan kedalaman data.
   */
  simpulTerdekat: (h3: string, profil?: ProfilRute) =>
    ambil<KonteksSimpul>(
      `/hex/${h3}/simpul-terdekat${profil ? `?profil=${encodeURIComponent(profil)}` : ''}`,
    ),

  /** Commuter Clock — 18 titik jam, captive vs choice rider. */
  commuterClock: (h3: string) => ambil<CommuterClock>(`/hex/${h3}/commuter-clock`),

  /** Simulasi kelayakan usaha. BUKAN skor — lihat backend/app/core/simulasi.py. */
  simulasi: (
    h3: string,
    p: {
      jenis_usaha?: string
      jam_buka?: number
      luas_m2?: number
      pangsa_persen?: number
      margin_persen?: number
      /** Sewa yang ditawarkan ke pengguna, per bulan. Dikirim hanya kalau > 0. */
      sewa_bulanan_diminta?: number
      /** Harga rata-rata per pembeli menurut rencana pengguna sendiri. */
      harga_rata_rata?: number
    } = {},
  ) => ambil<SimulasiHasil>(`/hex/${h3}/simulasi${kueri(p)}`),

  // --- PriceLens ---
  layerHarga: (p: { kawasan?: string; maks_sewa_per_m2?: number; hanya_berdata?: boolean } = {}) =>
    ambil<GeoJSON>(`/pricelens/layer${kueri(p)}`),

  kartuHarga: (h3: string) => ambil<PriceLensHeksagon>(`/pricelens/${h3}`),

  /** Rentang wajar + cakupan data tiap kawasan. Cakupan rendah wajib ditampilkan. */
  ringkasanHarga: () => ambil<Record<string, unknown>[]>('/pricelens/ringkasan'),

  // --- Transit ---
  simpulTransit: (kawasan?: string) =>
    ambil<SimpulTransit[]>(`/transit/nodes${kueri({ kawasan })}`),

  catchment: (p: { node_id?: number; menit?: number } = {}) =>
    ambil<GeoJSON>(`/transit/catchment${kueri(p)}`),

  // --- Skor ---
  ranking: (p: { kawasan?: string; limit?: number; versi?: string } = {}) =>
    ambil<SkorHeksagon[]>(`/skor/ranking${kueri(p)}`),

  /** GemFinder — lolos minimal dua metode, lengkap dengan rangkuman alasannya. */
  hiddenGems: (p: { kawasan?: string; limit?: number; versi?: string } = {}) =>
    ambil<HiddenGem[]>(`/skor/hidden-gems${kueri(p)}`),

  /** RiskRadar — Jebakan Gengsi yang churn-nya melewati ambang wajar kawasan. */
  riskRadar: (p: {
    kawasan?: string
    hanya_berperingatan?: boolean
    limit?: number
    versi?: string
  } = {}) => ambil<TitikKuadran[]>(`/skor/risk-radar${kueri(p)}`),

  /** Titik sebar diagram kuadran. TIDAK menyaring ZoneGuard — ini alat analisis. */
  diagramKuadran: (p: { kawasan?: string; limit?: number; versi?: string } = {}) =>
    ambil<DiagramKuadran>(`/skor/kuadran${kueri(p)}`),

  risikoHeksagon: (h3: string) => ambil<PeringatanRisiko>(`/skor/risiko/${h3}`),

  // --- ZoneGuard ---
  statusZona: (h3: string) => ambil<StatusZoneGuard>(`/skor/zoneguard/${h3}`),

  /** Cakupan RDTR per kawasan. Angka `tidak_diketahui` besar adalah kabar penting. */
  cakupanZona: () => ambil<Record<string, unknown>[]>('/skor/zoneguard/ringkasan'),

  // --- AI Consultant ---
  daftarFungsi: () => ambil<Record<string, unknown>>('/ai/fungsi'),

  /** Dipanggil saat memuat, supaya panel AI bisa menampilkan keadaan sebenarnya. */
  statusAI: () => ambil<StatusAI>('/ai/status'),

  tanyaAI: (permintaan: PermintaanAI) =>
    ambil<JawabanAI>('/ai/tanya', { method: 'POST', body: JSON.stringify(permintaan) }),

  // --- Akun ---
  daftar: (p: {
    nama_pengguna: string
    email: string
    sandi: string
    nama_tampilan?: string
  }) => ambil<SesiAkun>('/akun/daftar', { method: 'POST', body: JSON.stringify(p) }),

  masuk: (p: { identitas: string; sandi: string }) =>
    ambil<SesiAkun>('/akun/masuk', { method: 'POST', body: JSON.stringify(p) }),

  /** Memvalidasi tiket tersimpan saat memuat. 401 = tiket sudah tidak berlaku. */
  akunSaya: () => ambil<Akun>('/akun/saya'),

  katalogPaket: () => ambil<KatalogPaket>('/akun/paket'),

  berlangganan: (paket: string) =>
    ambil<Akun>('/akun/langganan', { method: 'POST', body: JSON.stringify({ paket }) }),

  beliToken: (paket: string) =>
    ambil<Akun>('/akun/token/beli', { method: 'POST', body: JSON.stringify({ paket }) }),

  riwayatToken: () => ambil<MutasiToken[]>('/akun/token/riwayat'),

  /** Preferensi usaha dari onboarding. Menyetel bawaan simulasi + saringan peta. */
  simpanPreferensi: (p: {
    jenis_usaha?: string | null
    kawasan?: string | null
    budget_sewa_bulanan?: number | null
  }) => ambil<Akun>('/akun/preferensi', { method: 'POST', body: JSON.stringify(p) }),

  /** Belanjakan token untuk membuka satu heksagon selamanya. Idempoten. */
  bukaHeksagon: (h3: string) => ambil<Akun>(`/akun/buka/${h3}`, { method: 'POST' }),

  heksagonTerbuka: () => ambil<string[]>('/akun/terbuka'),

  // --- Pemantauan ---
  pantauan: () => ambil<ButirPantauan[]>('/akun/pantauan'),

  pantau: (h3_index: string, catatan?: string) =>
    ambil<ButirPantauan>('/akun/pantauan', {
      method: 'POST',
      body: JSON.stringify({ h3_index, catatan }),
    }),

  lepasPantauan: (h3: string) =>
    ambil<{ dihapus: string }>(`/akun/pantauan/${h3}`, { method: 'DELETE' }),

  // --- Premium ---
  /** 2-4 heksagon. Backend menolak di luar rentang itu, bukan diam-diam memotong. */
  komparasi: (h3: string[], versi?: string) => {
    const q = new URLSearchParams()
    for (const x of h3) q.append('h3', x)
    if (versi) q.set('versi', versi)
    return ambil<Komparasi>(`/skor/komparasi?${q.toString()}`)
  },

  riwayatSkor: (h3: string) => ambil<RiwayatSkor>(`/skor/riwayat/${h3}`),

  /** Rekomendasi personal dari preferensi akun. Butuh masuk. */
  rekomendasi: (p: { kawasan?: string; budget?: number; limit?: number } = {}) =>
    ambil<HasilRekomendasi>(`/skor/rekomendasi${kueri(p)}`),

  dinamikaKawasan: (kawasan: string) =>
    ambil<DinamikaKawasan>(`/skor/dinamika${kueri({ kawasan })}`),

  /**
   * Laporan Kelayakan. Satu-satunya panggilan yang TIDAK lewat `ambil()`:
   * jawabannya berkas PDF, bukan JSON, jadi `res.json()` akan meledak.
   * Amplop galatnya tetap dibaca dengan bentuk yang sama supaya cabang 402
   * di pemanggil tidak perlu tahu bedanya.
   */
  unduhKomparasi: (h3: string[]) => {
    const q = new URLSearchParams()
    for (const x of h3) q.append('h3', x)
    return unduhPdf(`/akun/laporan-komparasi?${q.toString()}`, `Perbandingan-${h3.length}-lokasi.pdf`)
  },

  unduhLaporan: async (h3: string, namaKawasan: string): Promise<void> => {
    const kepala: Record<string, string> = {}
    if (tiketSekarang) kepala.Authorization = `Bearer ${tiketSekarang}`
    const res = await fetch(`${API_BASE}/akun/laporan/${h3}`, { headers: kepala })
    if (!res.ok) {
      let kode = `HTTP_${res.status}`
      let pesan = 'Gagal mengunduh laporan.'
      try {
        const j = JSON.parse(await res.text())
        kode = j?.galat?.kode ?? kode
        pesan = j?.galat?.pesan ?? pesan
      } catch {
        /* biarkan pesan bawaan */
      }
      throw new GalatAPI(res.status, kode, pesan)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Laporan-Kelayakan-${namaKawasan.replace(/ /g, '-')}-${h3.slice(0, 8)}.pdf`
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Dicabut setelah klik sempat diproses. Mencabutnya langsung membatalkan
    // unduhan di sebagian peramban.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  },
}
