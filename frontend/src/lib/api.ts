
import { API_BASE } from '../config'
import type {
  Akun,
  BedahBlok,
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
  PriceLensHeksagon,
  RiwayatSkor,
  SesiAkun,
  SimpulTransit,
  Simulasi as SimulasiHasil,
  SkorHeksagon,
  StatusAI,
  StatusZoneGuard,
  TitikKuadran,
  UsahaHeksagon,
} from '../types'

type GeoJSON = { type: 'FeatureCollection'; features: unknown[] }

/** Kunci localStorage untuk tiket sesi. */
const KUNCI_TIKET = 'loconomics.tiket'

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

export class GalatAPI extends Error {
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

const BATAS_WAKTU_MS = 25_000

function bahasaKini(): string | null {
  if (typeof document === 'undefined') return null
  return document.documentElement.lang === 'en' ? 'en' : null
}

async function ambil<T>(jalur: string, opsi?: RequestInit): Promise<T> {
  const kepala: Record<string, string> = { 'Content-Type': 'application/json' }
  if (tiketSekarang) kepala.Authorization = `Bearer ${tiketSekarang}`

  const bhs = bahasaKini()
  const alamat = bhs ? `${jalur}${jalur.includes('?') ? '&' : '?'}bahasa=${bhs}` : jalur

  const res = await fetch(`${API_BASE}${alamat}`, {
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
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v))
  const s = q.toString()
  return s ? `?${s}` : ''
}

/** Isian simulasi. Satu bentuk, dipakai permintaan JSON-nya DAN unduhan PDF-nya. */
export interface ParamSimulasi {
  [k: string]: string | number | boolean | undefined
  jenis_usaha?: string
  jam_buka?: number
  luas_m2?: number
  pangsa_persen?: number
  margin_persen?: number
  /** Sewa yang ditawarkan ke pengguna, per bulan. Dikirim hanya kalau > 0. */
  sewa_bulanan_diminta?: number
  /** Harga rata-rata per pembeli menurut rencana pengguna sendiri. */
  harga_rata_rata?: number
  /** Omzet bulanan usaha yang sudah berjalan, untuk mengukur pertumbuhan. */
  omzet_sekarang_bulanan?: number
}

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

export function bangunkan(): void {
  if (!API_BASE) return
  void fetch(`${API_BASE}/health`, {
    signal: AbortSignal.timeout(BATAS_WAKTU_MS),
  }).catch(() => null)
}

export const api = {
  sehat: (opsi?: RequestInit) => ambil<{ status: string }>('/health', opsi),

  kesiapan: () => ambil<Kesiapan>('/meta/siap'),

  // --- Heksagon ---
  /** `kawasan` boleh satu nama atau beberapa dipisah koma (alat Premium). */
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

    if (!API_BASE) return statis()

    try {
      return await ambil<GeoJSON>(`/hex/layer${kueri(p)}`)
    } catch (e) {
      if (e instanceof GalatAPI) throw e
      return statis()
    }
  },

  detailHeksagon: (h3: string, versi?: string) =>
    ambil<DetailHeksagon>(`/hex/${h3}${kueri({ versi })}`),

  simpulTerdekat: (h3: string, profil?: ProfilRute) =>
    ambil<KonteksSimpul>(
      `/hex/${h3}/simpul-terdekat${profil ? `?profil=${encodeURIComponent(profil)}` : ''}`,
    ),

  /** Commuter Clock — 18 titik jam, captive vs choice rider. */
  commuterClock: (h3: string) => ambil<CommuterClock>(`/hex/${h3}/commuter-clock`),

  blokHeksagon: (h3: string, kelas?: string | null) =>
    ambil<BedahBlok>(`/hex/${h3}/blok${kueri({ kelas: kelas ?? undefined })}`),

  /** Simulasi kelayakan usaha. BUKAN skor — lihat backend/app/core/simulasi.py. */
  simulasi: (h3: string, p: ParamSimulasi = {}) =>
    ambil<SimulasiHasil>(`/hex/${h3}/simulasi${kueri(p)}`),

  // --- PriceLens ---
  layerHarga: (p: { kawasan?: string; maks_sewa_per_m2?: number; hanya_berdata?: boolean } = {}) =>
    ambil<GeoJSON>(`/pricelens/layer${kueri(p)}`),

  kartuHarga: (h3: string) => ambil<PriceLensHeksagon>(`/pricelens/${h3}`),

  /** Rentang wajar + cakupan data tiap kawasan. Cakupan rendah wajib ditampilkan. */
  ringkasanHarga: () => ambil<Record<string, unknown>[]>('/pricelens/ringkasan'),

  // --- Transit ---
  simpulTransit: (kawasan?: string) =>
    ambil<SimpulTransit[]>(`/transit/nodes${kueri({ kawasan })}`),

  catchment: (p: { node_id?: number; menit?: number; profil?: ProfilRute } = {}) =>
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

  /** Daftar per heksagon untuk layer PriceLens/ZoneGuard. TIDAK menyaring ZoneGuard. */
  daftarLayer: (p: {
    layer: 'pricelens' | 'zoneguard'
    kawasan?: string
    limit?: number
    versi?: string
  }) => ambil<SkorHeksagon[]>(`/skor/daftar-layer${kueri(p)}`),

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
    ambil<JawabanAI>('/ai/tanya', {
      method: 'POST',
      body: JSON.stringify(permintaan),
      signal: AbortSignal.timeout(150_000),
    }),

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

  /** Preferensi usaha dari onboarding. Menyetel bawaan simulasi + saringan peta. */
  simpanPreferensi: (p: {
    jenis_usaha?: string | null
    kawasan?: string | null
    budget_sewa_bulanan?: number | null
  }) => ambil<Akun>('/akun/preferensi', { method: 'POST', body: JSON.stringify(p) }),

  // --- Pemantauan ---
  pantauan: () => ambil<ButirPantauan[]>('/akun/pantauan'),

  /** Simpan lokasi. `lat`/`lon` = titik favorit DI DALAM heksagon (opsional). */
  pantau: (h3_index: string, opsi: { lat?: number; lon?: number; nama?: string } = {}) =>
    ambil<ButirPantauan>('/akun/pantauan', {
      method: 'POST',
      body: JSON.stringify({ h3_index, ...opsi }),
    }),

  /** Beri nama lokasi tersimpan. Kosong = kembali ke kode lokasi. */
  namaiPantauan: (h3: string, nama: string | null) =>
    ambil<{ h3_index: string; nama: string | null }>(`/akun/pantauan/${h3}`, {
      method: 'PATCH',
      body: JSON.stringify({ nama }),
    }),

  /** Simpan rencana pengembangan lokasi tersimpan: catatan, jenis usaha, omzet
   *  usaha yang sudah jalan. Bidang yang tidak dikirim tidak disentuh. */
  simpanRencana: (
    h3: string,
    p: {
      catatan?: string | null
      rencana_jenis_usaha?: string | null
      rencana_omzet_bulanan?: number | null
      nama_usaha?: string | null
      deskripsi?: string | null
    },
  ) =>
    ambil<{
      h3_index: string
      catatan: string | null
      rencana_jenis_usaha: string | null
      rencana_omzet_bulanan: number | null
      nama_usaha: string | null
      deskripsi: string | null
    }>(`/akun/pantauan/${h3}`, { method: 'PATCH', body: JSON.stringify(p) }),

  // --- Usaha & penjualan (bagian dari Premium) ---
  usaha: (h3: string) => ambil<UsahaHeksagon>(`/akun/usaha/${h3}`),

  catatPenjualan: (
    h3: string,
    p: { bulan: string; omzet?: number | null; pembeli?: number | null; catatan?: string | null },
  ) =>
    ambil<UsahaHeksagon>(`/akun/usaha/${h3}/penjualan`, {
      method: 'PUT',
      body: JSON.stringify(p),
    }),

  hapusPenjualan: (h3: string, bulan: string) =>
    ambil<UsahaHeksagon>(`/akun/usaha/${h3}/penjualan/${bulan}`, { method: 'DELETE' }),

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

  unduhKomparasi: (h3: string[]) => {
    const q = new URLSearchParams()
    for (const x of h3) q.append('h3', x)
    return unduhPdf(`/akun/laporan-komparasi?${q.toString()}`, `Perbandingan-${h3.length}-lokasi.pdf`)
  },

  unduhSimulasi: (h3: string, namaKawasan: string, p: ParamSimulasi = {}) =>
    unduhPdf(
      `/akun/laporan-simulasi/${h3}${kueri(p)}`,
      `Simulasi-Usaha-${namaKawasan.replace(/ /g, '-')}-${h3.slice(0, 8)}.pdf`,
    ),

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
