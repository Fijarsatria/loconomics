
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import { KUADRAN, LAYER, kodeLokasi, type NamaLayer } from '../config'
import { api, GalatAPI } from '../lib/api'
import { JENIS_USAHA } from '../lib/jenis-usaha'
import { useBahasa, useNamaZona, useTeks, type Bahasa } from '../lib/bahasa'
import type { AksiPeta, JawabanAI, PesanRiwayat, SkorHeksagon, StatusAI } from '../types'
import { useSesi } from './Akun'
import type { KendaliPeta, Kriteria } from './PetaInteraktif'
import { Badge, Glif, Markdown, NamaBerombak, PapanNama } from './primitif'

interface Pesan {
  peran: 'pengguna' | 'asisten'
  teks: string
  jawaban?: JawabanAI
}

/** Satu percakapan tersimpan. */
interface Percakapan {
  id: string
  judul: string
  waktu: number
  pesan: Pesan[]
}

const K = {
  id: {
    konsultan: 'Konsultan lokasi',
    ajakan: 'Tanyakan apa saja tentang lokasi. Jawabannya sekaligus menggerakkan peta.',
    contoh: [
      'Lokasi kopi di bawah 3 juta per bulan dekat Manggarai',
      'Kenapa skor heksagon ini segitu?',
      'Mana yang berisiko menjebak di Dukuh Atas BNI?',
    ],
    riwayat: 'Riwayat percakapan',
    tutupRiwayat: 'Tutup riwayat',
    baru: 'Chat baru',
    kosongRiwayat: 'Belum ada percakapan tersimpan. Yang Anda tanyakan di sini disimpan di peramban ini saja.',
    hapus: 'Hapus percakapan ini',
    sedang: 'sedang dibuka',
    cari: 'Cari di percakapan',
    takAdaCocok: (q: string) => `Tidak ada percakapan yang memuat “${q}”.`,
    ubahJudul: 'Ubah judul',
    judulPercakapan: 'Judul percakapan',
    simpanJudul: 'Simpan judul',
    kelompok: {
      hariIni: 'Hari ini',
      kemarin: 'Kemarin',
      pekan: '7 hari terakhir',
      bulan: '30 hari terakhir',
      lama: 'Lebih lama',
    },
    nPesan: (n: number) => `${n} pesan`,
    langkah: (n: number) => `${n} langkah dijalankan`,
    sumber: 'Sumber angka',
    tertinggi: 'tertinggi di wilayah studi',
    lebihTinggi: (p: string) => `lebih tinggi dari ${p}% lokasi lain`,
    keLokasi: 'Lokasi yang disebut',
    bukaLokasi: (k: string) => `Terbangkan peta ke ${k}`,
    lihatPeta: 'Lihat di peta',
    sedangDibuka: 'Sedang dibuka',
    zonaLarang: 'Zona melarang',
    memuat: 'memuat…',
    tanyaHex: 'Tanya soal heksagon terpilih…',
    tanya: 'Tanya soal lokasi…',
    kirim: 'Kirim pertanyaan',
    mengirim: 'Mengirim…',
    labelTanya: 'Pertanyaan untuk Loconomics AI',
    berpikir: 'Loconomics AI sedang menganalisis',
    alat: {
      cari_lokasi: 'mencari lokasi',
      bandingkan: 'membandingkan dua lokasi',
      jelaskan_skor: 'membaca rincian skor',
      cek_harga: 'membaca harga sewa',
      pola_jam: 'membaca pola jam',
      cek_zona: 'memeriksa izin zona',
      cari_hidden_gem: 'mencari hidden gem',
      cek_risiko: 'memeriksa risiko',
      bedah_blok: 'membedah heksagon jadi tujuh blok',
      flyTo: 'menggerakkan peta',
      highlight: 'menyorot heksagon',
      setLayer: 'mengganti layer',
      filter: 'menyaring peta',
    } as Record<string, string>,
    kunci: {
      judul: 'Loconomics AI khusus Premium',
      isiTamu: 'Konsultan lokasi ini bagian dari Loconomics Premium. Masuk atau buat akun, lalu berlangganan untuk bertanya.',
      isiGratis: 'Konsultan lokasi ini bagian dari Loconomics Premium. Berlangganan untuk mulai bertanya.',
      tombolTamu: 'Masuk untuk berlangganan',
      tombolGratis: 'Berlangganan Premium',
      alasan: 'Loconomics AI bagian dari Loconomics Premium.',
    },
    galat: {
      premium: 'Loconomics AI khusus pelanggan Premium. Berlangganan untuk melanjutkan percakapan ini.',
      belumTersambung:
        'Loconomics AI belum tersambung ke penyedia modelnya. Bagian lain di peta — skor, kuadran, ZoneGuard, dan rekomendasi — tidak terpengaruh.',
      anggaran: 'Plafon biaya AI untuk hari ini sudah tercapai. Asisten aktif lagi besok.',
      terlaluBanyak: 'Terlalu banyak pertanyaan dalam waktu singkat. Tunggu sebentar lalu coba lagi.',
      basisData:
        'Basis data sedang tidak bisa dihubungi. Kalau ini terjadi setelah lama menganggur, coba lagi dalam beberapa puluh detik.',
      lambat: 'Asisten terlalu lama menyusun jawaban. Coba lagi, atau persempit pertanyaannya (misalnya sebut kawasannya).',
      lain: (t: string) => `Gagal menghubungi asisten: ${t}`,
    },
  },
  en: {
    konsultan: 'Location consultant',
    ajakan: 'Ask anything about a location. The answer moves the map with it.',
    contoh: [
      'Coffee spots under 3 million a month near Manggarai',
      'Why is this hexagon scored the way it is?',
      'Which places risk being a prestige trap in Dukuh Atas BNI?',
    ],
    riwayat: 'Conversation history',
    tutupRiwayat: 'Close history',
    baru: 'New chat',
    kosongRiwayat: 'Nothing saved yet. What you ask here stays in this browser.',
    hapus: 'Delete this conversation',
    sedang: 'open now',
    cari: 'Search conversations',
    takAdaCocok: (q: string) => `No conversation contains “${q}”.`,
    ubahJudul: 'Rename',
    judulPercakapan: 'Conversation title',
    simpanJudul: 'Save title',
    kelompok: {
      hariIni: 'Today',
      kemarin: 'Yesterday',
      pekan: 'Previous 7 days',
      bulan: 'Previous 30 days',
      lama: 'Older',
    },
    nPesan: (n: number) => `${n} messages`,
    langkah: (n: number) => `${n} steps taken`,
    sumber: 'Where the numbers come from',
    tertinggi: 'highest in the study area',
    lebihTinggi: (p: string) => `higher than ${p}% of other locations`,
    keLokasi: 'Locations mentioned',
    bukaLokasi: (k: string) => `Fly the map to ${k}`,
    lihatPeta: 'Show on map',
    sedangDibuka: 'Open now',
    zonaLarang: 'Zoning forbids',
    memuat: 'loading…',
    tanyaHex: 'Ask about the selected hexagon…',
    tanya: 'Ask about a location…',
    kirim: 'Send question',
    mengirim: 'Sending…',
    labelTanya: 'Question for Loconomics AI',
    berpikir: 'Loconomics AI is analysing',
    alat: {
      cari_lokasi: 'searching locations',
      bandingkan: 'comparing two locations',
      jelaskan_skor: 'reading the score breakdown',
      cek_harga: 'reading rent prices',
      pola_jam: 'reading hourly patterns',
      cek_zona: 'checking zoning permission',
      cari_hidden_gem: 'searching for hidden gems',
      cek_risiko: 'checking risk',
      bedah_blok: 'splitting the hexagon into seven blocks',
      flyTo: 'moving the map',
      highlight: 'highlighting hexagons',
      setLayer: 'switching layer',
      filter: 'filtering the map',
    } as Record<string, string>,
    kunci: {
      judul: 'Loconomics AI is Premium only',
      isiTamu: 'This location consultant is part of Loconomics Premium. Sign in or create an account, then subscribe to ask.',
      isiGratis: 'This location consultant is part of Loconomics Premium. Subscribe to start asking.',
      tombolTamu: 'Sign in to subscribe',
      tombolGratis: 'Subscribe to Premium',
      alasan: 'Loconomics AI is part of Loconomics Premium.',
    },
    galat: {
      premium: 'Loconomics AI is for Premium subscribers. Subscribe to continue this conversation.',
      belumTersambung:
        'Loconomics AI is not connected to its model provider yet. Everything else on the map — scores, quadrants, ZoneGuard, and recommendations — is unaffected.',
      anggaran: 'Today’s AI spending cap has been reached. The assistant is back tomorrow.',
      terlaluBanyak: 'Too many questions in a short time. Wait a moment and try again.',
      basisData:
        'The database cannot be reached right now. If this happened after a long idle period, try again in a few dozen seconds.',
      lambat: 'The assistant took too long to answer. Try again, or ask a narrower question (for example, name the area).',
      lain: (t: string) => `Could not reach the assistant: ${t}`,
    },
  },
}

type Teks = (typeof K)['id']

/** Terjemahkan galat backend jadi kalimat yang bisa ditindaklanjuti. */
function pesanGalat(e: unknown, t: Teks): string {
  // Batas waktu peramban dilempar sebagai DOMException bernama TimeoutError,
  // dan pesan mentahnya ("signal timed out") dulu ditempel apa adanya ke layar.
  if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError'))
    return t.galat.lambat
  if (e instanceof GalatAPI && (e.status === 401 || e.status === 402)) return t.galat.premium
  const teks = e instanceof Error ? e.message : String(e)
  if (teks.includes('501')) return t.galat.belumTersambung
  if (teks.includes('ANGGARAN_AI_HABIS')) return t.galat.anggaran
  if (teks.includes('TERLALU_BANYAK')) return t.galat.terlaluBanyak
  if (teks.includes('BASIS_DATA')) return t.galat.basisData
  return t.galat.lain(teks)
}

/* --------------------------------------------------------------------------
   Riwayat percakapan

   DI PERAMBAN, bukan di server, dan itu keputusan yang disengaja: isi
   percakapan di sini bisa memuat lokasi yang sedang diincar seseorang untuk
   membuka usaha, dan tidak ada satu pun alasan hal itu perlu meninggalkan
   mesinnya. Backend memang sudah tanpa-status - riwayat dikirim ulang tiap
   giliran - jadi menyimpannya di sisi ini tidak mengubah apa pun untuk model.

   Dibatasi 20. Bukan demi kuota localStorage (percakapan teks jauh dari 5 MB),
   melainkan demi daftarnya sendiri: riwayat yang harus digulir untuk mencari
   percakapan kemarin berhenti jadi riwayat.
   -------------------------------------------------------------------------- */

const KUNCI_RIWAYAT = 'loconomics:ai-percakapan'
const MAKS_SIMPAN = 20

function bacaArsip(): Percakapan[] {
  try {
    const t = localStorage.getItem(KUNCI_RIWAYAT)
    if (!t) return []
    const d = JSON.parse(t)
    return Array.isArray(d) ? (d as Percakapan[]) : []
  } catch {
    /* localStorage bisa ditolak, isinya bisa rusak. Riwayat kosong tetap sah. */
    return []
  }
}

function tulisArsip(d: Percakapan[]) {
  try {
    localStorage.setItem(KUNCI_RIWAYAT, JSON.stringify(d))
  } catch {
    /* diam: percakapan yang sedang berjalan tidak terganggu */
  }
}

/** "3 mnt", "2 jam", "5 hr" - cukup untuk membedakan, tanpa jam dinding. */
type KunciKelompok = 'hariIni' | 'kemarin' | 'pekan' | 'bulan' | 'lama'

const URUTAN_KELOMPOK: KunciKelompok[] = ['hariIni', 'kemarin', 'pekan', 'bulan', 'lama']

function kelompokUmur(waktu: number, sekarang = Date.now()): KunciKelompok {
  // Dibandingkan menurut HARI KALENDER, bukan menurut selisih jam: percakapan
  // pukul 23.50 tadi malam adalah "kemarin" bagi pembacanya, bukan "hari ini"
  // hanya karena baru lewat sepuluh menit.
  const awalHariIni = new Date(sekarang).setHours(0, 0, 0, 0)
  const hari = Math.floor((awalHariIni - new Date(waktu).setHours(0, 0, 0, 0)) / 86_400_000)
  if (hari <= 0) return 'hariIni'
  if (hari === 1) return 'kemarin'
  if (hari <= 7) return 'pekan'
  if (hari <= 30) return 'bulan'
  return 'lama'
}

/** Cuplikan pesan terakhir, untuk membedakan dua percakapan berjudul mirip. */
function cuplikan(p: { pesan: { teks: string }[] }): string {
  const t = p.pesan[p.pesan.length - 1]?.teks ?? ''
  return t.replace(/\s+/g, ' ').slice(0, 90)
}

function usia(waktu: number, bahasa: Bahasa): string {
  const detik = Math.max(0, (Date.now() - waktu) / 1000)
  const satuan: [number, string, string][] = [
    [86400, 'hr', 'd'],
    [3600, 'jam', 'h'],
    [60, 'mnt', 'm'],
  ]
  for (const [n, id, en] of satuan) {
    if (detik >= n) return `${Math.floor(detik / n)} ${bahasa === 'en' ? en : id}`
  }
  return bahasa === 'en' ? 'just now' : 'baru saja'
}

/* --------------------------------------------------------------------------
   Pintasan lokasi

   `hex_disebut` sudah dibawa setiap jawaban sejak awal - yang belum ada cuma
   cara menekannya. Labelnya TIDAK dikarang di sini: ia diambil dari
   `/hex/{h3}`, bagian yang gratis untuk semua tingkat (kawasan, skor, kuadran),
   jadi tombolnya menyatakan hal yang sama dengan yang akan dilihat orang begitu
   petanya sampai.

   Singgahan seumur-halaman, bukan per-komponen: membuka kembali percakapan
   lama tidak perlu meminta ulang belasan heksagon yang sama.
   -------------------------------------------------------------------------- */

const SINGGAH = new Map<string, SkorHeksagon>()

function idBaru() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function PintasLokasi({
  h3,
  urutan,
  aktif,
  onBuka,
  t,
}: {
  h3: string
  /** Urutan penyebutan di jawaban, mulai 1. */
  urutan: number
  /** Heksagon ini yang sedang terbuka di panel detail. */
  aktif: boolean
  onBuka: (h3: string, kawasan?: string) => void
  t: Teks
}) {
  const [skor, setSkor] = useState<SkorHeksagon | null>(() => SINGGAH.get(h3) ?? null)
  const namaZona = useNamaZona()
  const { bahasa } = useBahasa()

  useEffect(() => {
    // Sudah disinggahkan: nilainya sudah dipungut oleh penginisialisasi state
    // di atas. Daftarnya ber-`key={h3}`, jadi h3 yang berubah berarti komponen
    // baru - tidak ada keadaan basi yang perlu disusul di sini.
    if (SINGGAH.has(h3)) return
    let hidup = true
    api
      .detailHeksagon(h3)
      .then((d) => {
        SINGGAH.set(h3, d.skor)
        if (hidup) setSkor(d.skor)
      })
      .catch(() => {
        /* Kartunya tetap ada dan tetap bisa ditekan; cuma isinya yang
           tinggal kerangka. Peta tidak butuh label untuk terbang. */
      })
    return () => {
      hidup = false
    }
  }, [h3])

  const q = skor?.kuadran ? KUADRAN[skor.kuadran] : null
  const nilai = typeof skor?.opportunity_score === 'number' ? Math.round(skor.opportunity_score) : null
  const warna = q?.warna ?? 'var(--color-ink-3)'
  const terlarang = skor?.zona_izin_komersial === false

  return (
    <button
      onClick={() => onBuka(h3, skor?.kawasan)}
      title={
        skor
          ? `${t.bukaLokasi(kodeLokasi(h3, skor.kawasan))}${q ? ` · ${namaZona(q.kunci)} — ${bahasa === 'en' ? q.ringkasEn : q.ringkas}` : ''}${nilai === null ? '' : ` · ${nilai}`}`
          : t.bukaLokasi(h3)
      }
      aria-current={aktif || undefined}
      data-aktif={aktif || undefined}
      className="ai-kartu-lokasi group"
      style={{ '--kartu-warna': warna, animationDelay: `${(urutan - 1) * 70}ms` } as CSSProperties}
    >
      <span className="flex items-center justify-between gap-1">
        <span className="ai-kartu-urutan tabular">{urutan}</span>
        {/* Heksagon kecil berwarna kuadran - bentuk yang sama dengan petaknya
            di peta, jadi kartu dan petak terbaca sebagai benda yang sama. */}
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden className="ai-kartu-heks shrink-0">
          <path
            d="M12 1.8 21 7v10l-9 5.2L3 17V7Z"
            fill={q ? warna : 'none'}
            fillOpacity={q ? 0.22 : 0}
            stroke={warna}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          {q && <circle cx="12" cy="12" r="3.2" fill={warna} />}
        </svg>
      </span>

      {skor ? (
        <>
          <span className="mt-1.5 flex items-baseline gap-0.5">
            <span className="tabular text-[26px] font-semibold leading-none tracking-tight text-ink">
              {nilai ?? '—'}
            </span>
            <span className="text-[10.5px] font-medium text-ink-3">/100</span>
          </span>
          <span className="ai-kartu-batang" aria-hidden>
            <span style={{ width: `${Math.max(3, Math.min(100, nilai ?? 0))}%` }} />
          </span>
          <span className="mt-2 flex min-w-0 items-center gap-1">
            {q && <Glif kuadran={q.kunci} ukuran={10} />}
            <span className="truncate text-[12px] font-semibold" style={{ color: warna }}>
              {q ? namaZona(q.kunci) : '—'}
            </span>
          </span>
          {terlarang && <span className="ai-kartu-larang">{t.zonaLarang}</span>}
        </>
      ) : (
        <span className="mt-2 flex flex-col gap-1.5" aria-label={t.memuat}>
          <span className="ai-kartu-kerangka h-6 w-12" />
          <span className="ai-kartu-kerangka h-1.5 w-full" />
          <span className="ai-kartu-kerangka h-3 w-16" />
          <span className="ai-kartu-kerangka mt-2 h-2.5 w-20" />
        </span>
      )}

      {/* Satu baris kaki untuk dua isi yang BERGANTIAN: kode lokasi saat diam,
          "Lihat di peta" saat disorot. Kartu persegi tidak punya tempat untuk
          dua baris, dan keduanya tidak pernah dibutuhkan bersamaan. */}
      <span className="ai-kartu-kaki">
        <span className="ai-kartu-kode">{skor ? kodeLokasi(h3, skor.kawasan) : ''}</span>
        <span className="ai-kartu-aksi">
        {aktif ? t.sedangDibuka : t.lihatPeta}
        <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden>
          <path
            d="M3 6h6M6.5 3 9.5 6l-3 3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        </span>
      </span>
    </button>
  )
}

function PanelAI({
  kendali,
  hexTerpilih,
  layerAktif,
  onKeLokasi,
}: {
  kendali: KendaliPeta
  hexTerpilih: string | null
  layerAktif: NamaLayer
  onKeLokasi: (h3: string, kawasan?: string) => void
}) {
  const t = useTeks(K)
  const { bahasa } = useBahasa()
  const [pesan, setPesan] = useState<Pesan[]>([])
  const [input, setInput] = useState('')
  const [memuat, setMemuat] = useState(false)
  const [status, setStatus] = useState<StatusAI | null>(null)
  const [arsip, setArsip] = useState<Percakapan[]>(bacaArsip)
  const [lihatRiwayat, setLihatRiwayat] = useState(false)
  /** Pencarian di dalam laci riwayat. Judul DAN isi pesannya ikut dicari. */
  const [cariRiwayat, setCariRiwayat] = useState('')
  /** Id percakapan yang judulnya sedang disunting, plus teks sementaranya. */
  const [suntingJudul, setSuntingJudul] = useState<{ id: string; teks: string } | null>(null)
  const akhir = useRef<HTMLDivElement>(null)
  const gulirKeAkhir = () => {
    const daftar = akhir.current?.parentElement
    if (daftar) daftar.scrollTo({ top: daftar.scrollHeight, behavior: 'smooth' })
  }
  const [idSesi, setIdSesi] = useState<string | null>(null)

  // Kesiapan diperiksa saat memuat, bukan saat pertanyaan pertama gagal.
  // Memberi tahu di awal jauh lebih sopan daripada membiarkan orang mengetik
  // pertanyaan panjang lalu menolaknya.
  useEffect(() => {
    api.statusAI().then(setStatus).catch(() => setStatus(null))
  }, [])

  useEffect(() => {
    if (status?.dibatasi !== true) return
    const id = setInterval(() => {
      api.statusAI().then(setStatus).catch(() => {})
    }, 120_000)
    return () => clearInterval(id)
  }, [status?.dibatasi])

  useEffect(() => {
    if (!pesan.length || !idSesi) return
    const judul = pesan.find((m) => m.peran === 'pengguna')?.teks.slice(0, 96) ?? '…'
    const lama = bacaArsip()
    tulisArsip(
      [
        { id: idSesi, judul, waktu: Date.now(), pesan },
        ...lama.filter((x) => x.id !== idSesi),
      ].slice(0, MAKS_SIMPAN),
    )
  }, [pesan, idSesi])

  function jalankanAksi(aksi: AksiPeta) {
    const arg = aksi.argumen
    switch (aksi.fungsi) {
      case 'flyTo':
        if (typeof arg.lat === 'number' && typeof arg.lon === 'number')
          kendali.flyTo(arg.lat, arg.lon, typeof arg.zoom === 'number' ? arg.zoom : undefined)
        break
      case 'highlight':
        if (Array.isArray(arg.hex_ids))
          kendali.highlight(arg.hex_ids.filter((x): x is string => typeof x === 'string'))
        break
      case 'setLayer':
        if (typeof arg.nama_layer === 'string' && arg.nama_layer in LAYER)
          kendali.setLayer(arg.nama_layer as NamaLayer)
        break
      case 'filter':
        kendali.filter(
          arg.kriteria && typeof arg.kriteria === 'object' ? (arg.kriteria as Kriteria) : null,
        )
        break
      default:
        // Alat backend sudah dijalankan di server; hasilnya ada di dalam `teks`.
        break
    }
  }

  const { premium, akun, memuat: memuatSesi, mintaMasuk, mintaLangganan } = useSesi()
  const terkunci = !memuatSesi && !premium

  const saran = useMemo(() => {
    const p = akun?.preferensi
    const jenis = JENIS_USAHA.find((j) => j.nilai === p?.jenis_usaha)
    const namaJenis = jenis ? (bahasa === 'en' ? jenis.labelEn : jenis.label) : null
    const kw = p?.kawasan ?? null
    const anggaran = p?.budget_sewa_bulanan
      ? `Rp${p.budget_sewa_bulanan.toLocaleString(bahasa === 'en' ? 'en-US' : 'id-ID')}`
      : null
    if (!namaJenis && !kw) return t.contoh
    const keluar: string[] = []
    if (namaJenis) {
      keluar.push(
        bahasa === 'en'
          ? `${namaJenis}${anggaran ? ` under ${anggaran} a month` : ''}${kw ? ` near ${kw}` : ''}`
          : `${namaJenis}${anggaran ? ` di bawah ${anggaran} per bulan` : ''}${kw ? ` dekat ${kw}` : ''}`,
      )
      keluar.push(
        bahasa === 'en'
          ? `Which ${namaJenis} spots${kw ? ` in ${kw}` : ''} are good but still overlooked?`
          : `Mana ${namaJenis}${kw ? ` di ${kw}` : ''} yang bagus tapi belum dilirik?`,
      )
    } else if (kw) {
      keluar.push(
        bahasa === 'en'
          ? `Where in ${kw} is the most promising place?`
          : `Di ${kw}, mana yang paling menjanjikan?`,
      )
    }
    for (const c of t.contoh) {
      if (keluar.length >= 3) break
      if (!keluar.includes(c)) keluar.push(c)
    }
    return keluar.slice(0, 3)
  }, [akun, bahasa, t.contoh])
  const bukaKunci = () => (akun ? mintaLangganan(t.kunci.alasan) : mintaMasuk(t.kunci.alasan))

  /** Luncuran tombol kirim: nyala sesaat, lalu padam sendiri. */
  const [luncur, setLuncur] = useState(false)
  useEffect(() => {
    if (!luncur) return
    const id = window.setTimeout(() => setLuncur(false), 650)
    return () => window.clearTimeout(id)
  }, [luncur])

  async function kirim(pertanyaan: string) {
    if (!pertanyaan.trim() || memuat) return
    if (terkunci) {
      bukaKunci()
      return
    }
    setLuncur(true)
    // Percakapan baru lahir di sini, bukan di effect penyimpan. Keduanya
    // dibatch React dalam satu render, jadi effect itu langsung melihat idnya.
    if (!idSesi) setIdSesi(idBaru())
    setPesan((s) => [...s, { peran: 'pengguna', teks: pertanyaan }])
    setInput('')
    setMemuat(true)
    // Gulir ke gelembung baru SEGERA, bukan sesudah jawabannya datang: tanpa
    // ini pertanyaan yang baru dikirim bisa meluncur masuk di bawah tepi
    // panel, dan satu-satunya bukti bahwa ia terkirim tidak terlihat.
    requestAnimationFrame(gulirKeAkhir)

    try {
      // Riwayat dikirim ulang tiap giliran; backend tidak menyimpan sesi.
      // Dipotong 20 pesan supaya sama dengan batas backend — kalau lebih,
      // permintaannya ditolak validasi, bukan dipotong diam-diam.
      const riwayat: PesanRiwayat[] = pesan
        .slice(-20)
        .map((m) => ({ peran: m.peran, teks: m.teks }))

      const jawaban = await api.tanyaAI({
        pertanyaan,
        riwayat,
        hex_terpilih: hexTerpilih,
        layer_aktif: layerAktif,
      })
      jawaban.aksi_peta.forEach(jalankanAksi)
      setPesan((s) => [...s, { peran: 'asisten', teks: jawaban.teks, jawaban }])
    } catch (e) {
      setPesan((s) => [...s, { peran: 'asisten', teks: pesanGalat(e, t) }])
      // Tiket kedaluwarsa atau langganan berakhir di tengah percakapan.
      if (e instanceof GalatAPI && (e.status === 401 || e.status === 402)) bukaKunci()
    } finally {
      setMemuat(false)
      requestAnimationFrame(gulirKeAkhir)
    }
  }

  function percakapanBaru() {
    setIdSesi(null)
    setPesan([])
    setInput('')
    setLihatRiwayat(false)
  }

  function bukaPercakapan(p: Percakapan) {
    setIdSesi(p.id)
    setPesan(p.pesan)
    setLihatRiwayat(false)
  }

  function ubahJudul(id: string, judul: string) {
    const bersih = judul.trim().slice(0, 80)
    if (!bersih) return
    const baru = bacaArsip().map((p) => (p.id === id ? { ...p, judul: bersih } : p))
    tulisArsip(baru)
    setArsip(baru)
  }

  function hapusPercakapan(id: string) {
    const baru = bacaArsip().filter((p) => p.id !== id)
    tulisArsip(baru)
    setArsip(baru)
    if (idSesi === id) percakapanBaru()
  }

  function bukaLaci() {
    setArsip(bacaArsip())
    // Pencarian lama dikosongkan. Laci yang dibuka kembali masih menyaring
    // menurut kata yang diketik setengah jam lalu tampak KOSONG, dan yang
    // terbaca "riwayat saya hilang" - bukan "saringannya masih hidup".
    setCariRiwayat('')
    setSuntingJudul(null)
    setLihatRiwayat(true)
  }

  const dibatasi = status?.dibatasi === true
  const mati = terkunci || (status !== null && !status.siap && !dibatasi)
  /** Ada sesuatu yang perlu diberitahukan - entah mati, entah cuma dibatasi. */
  const berkabar = status !== null && !status.siap

  return (
    <div className="relative h-full">
      {/* Belum Premium: SELURUH panel diburamkan dan tidak bisa disentuh, dengan
          satu ajakan di atasnya - bentuk yang sama dengan tab "Untuk Anda"
          (14 Sep 2026, permintaan pemilik repo). Yang diburamkan cuma papan
          nama dan kotak ketik; tidak ada jawaban berbayar yang pernah dikirim ke
          sini (aturan 2b dijaga `/ai/tanya`). Animasinya DIHENTIKAN: buram di
          atas cahaya yang bergerak memaksa peramban melukis ulang tiap bingkai. */}
      <div
        className={`flex h-full flex-col ${
          terkunci ? 'pointer-events-none select-none blur-[6px] [&_*]:[animation-play-state:paused]' : ''
        }`}
        inert={terkunci}
        aria-hidden={terkunci || undefined}
      >
      {/* --- Bilah alat -----------------------------------------------------
          Dua tombol, tanpa judul. Nama panel ini sudah tertulis di tab tepat di
          atasnya; menulisnya lagi cuma memakan baris. */}
      <div className="flex shrink-0 items-center gap-1 border-b border-line/70 px-2.5 py-2">
        <button
          onClick={() => (lihatRiwayat ? setLihatRiwayat(false) : bukaLaci())}
          aria-expanded={lihatRiwayat}
          title={lihatRiwayat ? t.tutupRiwayat : t.riwayat}
          className={`flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
            lihatRiwayat ? 'bg-ink text-surface' : 'text-ink-3 hover:bg-surface-2 hover:text-ink'
          }`}
        >
          <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden className="shrink-0">
            <circle cx="7" cy="7" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M7 4.2V7l2 1.4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </svg>
          {t.riwayat}
          {arsip.length > 0 && (
            <span className="tabular text-[11px] opacity-60">{arsip.length}</span>
          )}
        </button>

        {/* BERLABEL, bukan "+" polos (13 Sep 2026, permintaan pemilik repo -
            "kayak ChatGPT atau Gemini"). Tanda tambah sendirian di pojok panel
            terbaca sebagai "tambah sesuatu", dan sesuatu itu tidak disebut. */}
        <button
          onClick={percakapanBaru}
          title={t.baru}
          disabled={!pesan.length}
          className="ai-chat-baru ml-auto flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden className="shrink-0">
            <path
              d="M9.6 2.6H4.4A1.8 1.8 0 0 0 2.6 4.4v7.2a1.8 1.8 0 0 0 1.8 1.8h7.2a1.8 1.8 0 0 0 1.8-1.8V6.4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path d="M12.4 1.8 14.2 3.6 8.6 9.2 6.4 9.6l.4-2.2Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          {t.baru}
        </button>
      </div>

      {/* --- Laci riwayat ---------------------------------------------------
          Menutupi percakapan, tidak menggesernya: daftar yang mendorong isi ke
          bawah membuat posisi gulir percakapan hilang tiap kali dibuka. */}
      {lihatRiwayat && (
        <div className="ai-laci absolute inset-x-0 top-[3.05rem] bottom-0 z-10 flex flex-col bg-surface">
          {/* Kepala laci yang TIDAK ikut menggulir: tombol percakapan baru dan
              kotak cari harus tetap terjangkau sesudah tiga puluh baris. */}
          <div className="shrink-0 space-y-2 border-b border-line/70 px-2.5 py-2.5">
            <button
              onClick={percakapanBaru}
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg bg-ink px-3 py-2 text-[13.5px] font-semibold text-surface transition-transform duration-300 ease-jelly hover:scale-[1.01]"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="shrink-0">
                <path d="M7 2.4v9.2M2.4 7h9.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              {t.baru}
            </button>
            {arsip.length > 3 && (
              <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5">
                <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden className="shrink-0 text-ink-3">
                  <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M9.2 9.2 12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <input
                  value={cariRiwayat}
                  onChange={(e) => setCariRiwayat(e.target.value)}
                  placeholder={t.cari}
                  aria-label={t.cari}
                  className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-3"
                />
              </div>
            )}
          </div>

          <div className="scroll-tipis min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
            {(() => {
              const q = cariRiwayat.trim().toLowerCase()
              // Judul DAN isi pesan ikut dicari: yang diingat orang dari
              // percakapan lama biasanya kalimat yang ia ketik, bukan judul
              // yang dibuatkan untuknya.
              const cocok = q
                ? arsip.filter(
                    (p) =>
                      p.judul.toLowerCase().includes(q) ||
                      p.pesan.some((m) => m.teks.toLowerCase().includes(q)),
                  )
                : arsip
              if (arsip.length === 0) {
                return (
                  <p className="px-1.5 py-6 text-center text-[13px] leading-relaxed text-ink-3">
                    {t.kosongRiwayat}
                  </p>
                )
              }
              if (cocok.length === 0) {
                return (
                  <p className="px-1.5 py-6 text-center text-[13px] leading-relaxed text-ink-3">
                    {t.takAdaCocok(cariRiwayat.trim())}
                  </p>
                )
              }
              return URUTAN_KELOMPOK.map((k) => {
                const isi = cocok.filter((p) => kelompokUmur(p.waktu) === k)
                if (isi.length === 0) return null
                return (
                  <section key={k} className="mb-2">
                    <h4 className="eyebrow px-1.5 py-1.5">{t.kelompok[k]}</h4>
                    <ul className="space-y-0.5">
                      {isi.map((p) => (
                        <li key={p.id} className="group flex items-start gap-1">
                          {suntingJudul?.id === p.id ? (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault()
                                ubahJudul(p.id, suntingJudul.teks)
                                setSuntingJudul(null)
                              }}
                              className="min-w-0 flex-1 px-1.5 py-1"
                            >
                              <input
                                autoFocus
                                value={suntingJudul.teks}
                                onChange={(e) => setSuntingJudul({ id: p.id, teks: e.target.value })}
                                onBlur={() => {
                                  ubahJudul(p.id, suntingJudul.teks)
                                  setSuntingJudul(null)
                                }}
                                aria-label={t.judulPercakapan}
                                className="w-full rounded-md border border-ink-3 bg-surface px-2 py-1 text-[13.5px] outline-none"
                              />
                            </form>
                          ) : (
                            <button
                              onClick={() => bukaPercakapan(p)}
                              className={`min-w-0 flex-1 cursor-pointer rounded-md px-2.5 py-2 text-left transition-colors ${
                                idSesi === p.id ? 'bg-gem-soft/60' : 'hover:bg-surface-2'
                              }`}
                            >
                              <span className="block truncate text-[13.5px] leading-snug text-ink">
                                {p.judul}
                              </span>
                              {/* Cuplikan pesan terakhir. Dua percakapan
                                  berjudul mirip tidak bisa dibedakan dari
                                  judulnya saja - dan judulnya dibuatkan, bukan
                                  ditulis orangnya. */}
                              <span className="mt-0.5 block truncate text-[11.5px] leading-snug text-ink-3">
                                {cuplikan(p)}
                              </span>
                              <span className="mt-0.5 block text-[11px] text-ink-3">
                                {usia(p.waktu, bahasa)} · {t.nPesan(p.pesan.length)}
                                {idSesi === p.id ? ` · ${t.sedang}` : ''}
                              </span>
                            </button>
                          )}
                          <span className="flex shrink-0 flex-col gap-0.5 pt-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                            <button
                              onClick={() => setSuntingJudul({ id: p.id, teks: p.judul })}
                              title={t.ubahJudul}
                              aria-label={t.ubahJudul}
                              className="grid h-7 w-7 cursor-pointer place-items-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                            >
                              <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
                                <path d="M8.1 1.9 10.1 3.9 4.2 9.8 1.6 10.4 2.2 7.8Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                              </svg>
                            </button>
                            <button
                              onClick={() => hapusPercakapan(p.id)}
                              title={t.hapus}
                              aria-label={t.hapus}
                              className="grid h-7 w-7 cursor-pointer place-items-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-bahaya"
                            >
                              <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
                                <path d="M2.6 2.6 9.4 9.4M9.4 2.6 2.6 9.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                              </svg>
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              })
            })()}
          </div>
        </div>
      )}

      <div className="scroll-tipis flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 max-lg:px-3 max-lg:py-2">
        {/* --- Pembuka -------------------------------------------------------
            TIDAK dilepas dari DOM begitu ada pesan pertama; ia DITUTUP.
            Melepasnya membuat percakapan melompat ke atas sejauh tinggi
            pembuka ini pada bingkai yang sama dengan gelembung pertama muncul,
            dan lompatan itu terbaca sebagai kedipan. Dengan `grid-template-rows`
            1fr -> 0fr, tingginya menyusut sendiri sementara isinya memudar dan
            naik sedikit — satu gerakan, bukan dua kejadian.

            `g-ai-pembuka-penuh` membuatnya MENGISI panel selama masih kosong,
            dan itu yang menaruh papan namanya di tengah-tengah - bukan di
            tengah atas, tempat ia berdiri sebelumnya karena tingginya cuma
            setinggi isinya sendiri.

            Semua yang dianimasikan di sini `opacity` dan `transform`, kecuali
            baris grid-nya sendiri yang memang tidak punya padanan compositor. */}
        <div
          className={`g-ai-pembuka ${pesan.length ? 'g-ai-pembuka-tutup' : 'g-ai-pembuka-penuh'}`}
          aria-hidden={pesan.length > 0}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="flex h-full flex-col items-center justify-center px-1 py-4 text-center">
              {/* --- Mercusuar -----------------------------------------------
                  Papan nama yang SAMA dengan yang di pojok kiri atas, bukan
                  tiruannya. Komponennya sendiri sudah membawa perilaku per-huruf
                  - melenting saat disentuh, lalu mengambil warna yang luntur
                  beberapa detik kemudian - dan menyalinnya untuk mengubah satu
                  kelas akan membuat kedua salinan berpisah tempo pada perubahan
                  berikutnya.

                  TIGA lapis cahaya di belakangnya, dan ketiganya punya tugas
                  yang berbeda. Halo yang bernapas menyatakan panel ini hidup
                  walaupun belum ada yang mengetik. Cincin conic yang berputar
                  pelan memberi arah - cahaya yang diam terbaca sebagai gambar,
                  cahaya yang berputar terbaca sebagai sumber. Dan satu sapuan
                  spekular melintasi namanya tiap tujuh detik: itu yang membuat
                  hurufnya terbaca sebagai BAHAN, bukan sebagai teks berwarna.

                  Semuanya `transform` dan `opacity`; tidak satu pun gradiennya
                  dihitung ulang per bingkai. */}
              <span className="g-ai-mercu relative mb-5 inline-flex flex-col items-center max-lg:mb-3">
                <span className="g-ai-nyala pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full max-lg:h-[190px] max-lg:w-[190px]" aria-hidden />
                <span className="g-ai-kilau pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[220px] w-[220px] -translate-x-1/2 -translate-y-1/2 rounded-full max-lg:h-[150px] max-lg:w-[150px]" aria-hidden />
                <span className="g-ai-cincin-kabut pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[152px] w-[152px] -translate-x-1/2 -translate-y-1/2 rounded-full max-lg:h-[104px] max-lg:w-[104px]" aria-hidden />
                {/* Aurora dan orbit, 13 Sep 2026 - "lebih hidup, lebih dinamis".
                    Tiga gumpal cahaya yang HANYUT dengan periode berbeda (9, 13,
                    dan 17 detik) tidak pernah kembali ke susunan yang sama dalam
                    hitungan menit, jadi latarnya tidak terbaca sebagai putaran
                    ulang. Tiga titik mengorbit pada jari-jari dan kecepatan yang
                    berbeda memberi GERAK DEPAN - yang dulu tidak ada: semua lapis
                    lama bergerak di tempat. Posisinya lewat margin, bukan kelas
                    translate Tailwind, alasannya sama dengan catatan `g-napas`. */}
                <span className="g-ai-aurora" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                <span className="g-ai-orbit" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>

                <span className="g-ai-tanda relative inline-flex items-center gap-3">
                  <svg width="27" height="27" viewBox="0 0 16 16" aria-hidden className="shrink-0 text-ink-2">
                    <path
                      d="M8 1.5c.4 2.6 1.4 3.6 4 4-2.6.4-3.6 1.4-4 4-.4-2.6-1.4-3.6-4-4 2.6-.4 3.6-1.4 4-4Z"
                      fill="currentColor"
                    />
                    <path
                      d="M13 9.5c.25 1.5.8 2.05 2.3 2.3-1.5.25-2.05.8-2.3 2.3-.25-1.5-.8-2.05-2.3-2.3 1.5-.25 2.05-.8 2.3-2.3Z"
                      fill="currentColor"
                      opacity="0.6"
                    />
                  </svg>
                  <PapanNama teks="Loconomics" sebagai="div" kelas="text-[34px] leading-none text-ink max-lg:text-[20px]" />
                  <span className="g-ai-sapuan pointer-events-none absolute inset-y-[-22px] inset-x-[-18px]" aria-hidden />
                </span>

                <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-3">
                  {t.konsultan}
                </p>
              </span>

              <p className="max-w-[24rem] text-[14px] leading-relaxed text-ink-2">{t.ajakan}</p>

              {/* Pesannya dipakai APA ADANYA, tidak lagi disisipkan ke tengah
                  kalimat yang dirakit di sini. Kalimat rakitan itulah yang dulu
                  membuat teks backend terbaca sebagai instruksi untuk
                  pembacanya, dan ia akan mengulanginya untuk setiap sebab
                  berikutnya. */}
              {!terkunci && berkabar && (
                <p
                  className={`mt-3 w-full rounded-sm border px-2.5 py-2 text-left text-[13.5px] leading-snug ${
                    dibatasi
                      ? 'border-jebakan/40 bg-jebakan-soft text-jebakan'
                      : 'border-line bg-surface-2 text-ink-2'
                  }`}
                  role={dibatasi ? 'status' : undefined}
                >
                  {status?.pesan}
                </p>
              )}

              {!terkunci && (
              <div className="mt-6 w-full space-y-1.5 max-lg:mt-3">
                {saran.map((c, i) => (
                  <button
                    key={c}
                    onClick={() => kirim(c)}
                    disabled={mati}
                    /* Berundak: tiap saran datang 70ms sesudah yang di atasnya.
                       Tiga benda yang muncul bersamaan terbaca sebagai satu
                       blok; berundak, ketiganya terbaca sebagai tiga pilihan. */
                    style={{ animationDelay: `${140 + i * 70}ms` }}
                    className="g-ai-saran group flex w-full cursor-pointer items-center gap-2 rounded-sm border border-line px-2.5 py-2 text-left text-[13.5px] leading-snug text-ink-2 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <span className="min-w-0 flex-1">{c}</span>
                    <span
                      className="shrink-0 text-ink-3 transition-transform duration-300 ease-jelly group-hover:translate-x-0.5"
                      aria-hidden
                    >
                      →
                    </span>
                  </button>
                ))}
              </div>
              )}
            </div>
          </div>
        </div>

        {pesan.map((m, i) => (
          <div key={i} className={m.peran === 'pengguna' ? 'flex shrink-0 justify-end' : 'shrink-0'}>
            {m.peran === 'pengguna' ? (
              <p className="ai-gelembung-pengguna max-w-[85%] rounded-md rounded-br-xs bg-ink px-3.5 py-2 text-[14.5px] leading-snug text-surface">
                {m.teks}
              </p>
            ) : (
              <div className="ai-jawaban-masuk max-w-[94%] text-[14.5px] text-ink">
                {/* Jawaban model dirender sebagai Markdown, bukan teks polos.
                    Prompt A1-A4 memang meminta daftar bernomor dan tebal, dan
                    sampai sekarang tanda bintangnya tampil apa adanya di layar. */}
                <Markdown teks={m.teks} />

                {/* --- Pintasan ke lokasi yang disebut ----------------------
                    Inilah yang mengubah "AI menyebut tiga lokasi" jadi "AI
                    mengantar ke tiga lokasi". Tanpa ini jawabannya benar tetapi
                    tidak bisa diikuti: orangnya tetap harus mencari sendiri
                    heksagon mana yang barusan dimaksud. */}
                {m.jawaban && m.jawaban.hex_disebut.length > 0 && (
                  <div className="mt-2.5">
                    <p className="eyebrow mb-1.5">
                      {t.keLokasi}
                      <span className="ml-1 text-ink-3">· {Math.min(6, m.jawaban.hex_disebut.length)}</span>
                    </p>
                    <div className="ai-kartu-kisi">
                      {m.jawaban.hex_disebut.slice(0, 6).map((h3, k) => (
                        <PintasLokasi
                          key={h3}
                          h3={h3}
                          urutan={k + 1}
                          aktif={hexTerpilih === h3}
                          onBuka={onKeLokasi}
                          t={t}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Jejak: alat apa yang benar-benar dipanggil. Ditampilkan,
                    bukan disembunyikan — inilah yang membuat prosesnya bisa
                    diperiksa alih-alih hanya terdengar meyakinkan. */}
                {m.jawaban && m.jawaban.jejak.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer list-none text-[12.5px] text-ink-3 underline decoration-line-2 underline-offset-2 hover:text-ink-2">
                      {t.langkah(m.jawaban.jejak.length)}
                    </summary>
                    <ol className="mt-1 space-y-0.5 border-l border-line pl-2.5">
                      {m.jawaban.jejak.map((j, k) => (
                        <li key={k} className="text-[12.5px] leading-snug text-ink-3">
                          <span className="text-ink-2">{t.alat[j.fungsi] ?? j.fungsi}</span>
                          {' — '}
                          {j.ringkas_hasil}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}

                {m.jawaban && m.jawaban.sumber_angka.length > 0 && (
                  <div className="mt-1.5 rounded-sm bg-surface-2 px-2.5 py-1.5">
                    <p className="eyebrow mb-1">{t.sumber}</p>
                    <ul className="space-y-0.5">
                      {m.jawaban.sumber_angka.slice(0, 5).map((f) => (
                        <li key={f.kode_variabel} className="text-[12.5px] text-ink-2">
                          <span className="font-mono">{f.kode_variabel}</span>
                          {f.persentil !== null && (
                            <span className="text-ink-3">
                              {' '}
                              ·{' '}
                              {f.persentil >= 99.5 ? t.tertinggi : t.lebihTinggi(f.persentil.toFixed(0))}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {m.jawaban?.keyakinan && (
                  <div className="mt-1.5">
                    <Badge badge={m.jawaban.keyakinan} ringkas />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Nama yang berombak, bukan titik berdenyut. Titik berdenyut
            menyatakan SESUATU sedang berjalan; yang sebenarnya ingin diketahui
            orang yang baru menekan kirim adalah bahwa pertanyaannya SAMPAI dan
            sedang dikerjakan - dan tidak ada yang menyatakan itu sebaik nama
            yang mengerjakannya. Komponennya bersama dengan daftar lokasi dan
            rekomendasi; lihat `NamaBerombak` di primitif.tsx. */}
        {memuat && (
          <div className="ai-berpikir-masuk">
            <NamaBerombak teks="Loconomics AI" kelas="justify-start text-[15px]" label={t.berpikir} />
          </div>
        )}
        <div ref={akhir} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          kirim(input)
        }}
        className="shrink-0 border-t border-line p-2.5"
      >
        {/* Kaca cair. Cincin warnanya PINDAH ke tombol kirim (4 Sep 2026,
            permintaan pemilik repo) - sebelumnya ia melingkari seluruh pil
            termasuk kotak ketiknya, dan itu salah alamat: yang sedang
            "berpikir" adalah jawabannya, bukan tulisan yang sedang diketik
            orang. Tombolnya sendiri jadi satu-satunya yang menyala. */}
        <div className="ai-kaca flex items-center gap-1.5 rounded-full p-1.5">
          <label className="sr-only" htmlFor="tanya-ai">
            {t.labelTanya}
          </label>
          <input
            id="tanya-ai"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={mati}
            placeholder={hexTerpilih ? t.tanyaHex : t.tanya}
            className="min-w-0 flex-1 bg-transparent px-3 py-1.5 text-[14.5px] outline-none disabled:opacity-45"
          />
          {/* Ikon saja, tanpa kata "Kirim".

              Panah ke atas adalah kosakata yang sudah dipakai setiap kotak
              tanya yang pernah dipakai pembacanya, jadi ia tidak menuntut
              dibaca. Yang didapat bukan cuma ruang: tombol bundar seukuran
              jempol jauh lebih gampang ditekan di ponsel daripada pil teks
              setinggi 34px.

              `aria-label` menggantikan katanya untuk pembaca layar - ikon
              tanpa nama adalah tombol tanpa nama, dan berubah jadi "Mengirim…"
              selama menjawab supaya pembaca layar tahu keadaannya berubah.

              `data-berpikir` sekarang di WADAH TOMBOL ini, bukan di `.ai-kaca` -
              cincinnya cuma perlu tahu keadaan tombol yang membungkusnya. */}
          <span className="ai-tombol relative shrink-0" data-berpikir={memuat} data-luncur={luncur || undefined}>
            <span className="ai-cincin" aria-hidden />
            <button
              type="submit"
              disabled={memuat || mati || !input.trim()}
              aria-label={memuat ? t.mengirim : t.kirim}
              className={`relative grid h-9 w-9 place-items-center rounded-full bg-white text-[#101a16] transition-all duration-300 ease-jelly ai-kirim ${
                memuat
                  ? 'cursor-wait'
                  : mati || !input.trim()
                    ? 'cursor-not-allowed opacity-25'
                    : 'cursor-pointer hover:scale-[1.07]'
              }`}
            >
              {memuat ? (
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="ai-spin">
                  <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" opacity="0.18" />
                  <circle
                    className="ai-spin-busur"
                    cx="8"
                    cy="8"
                    r="6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                  <path
                    d="M8 13V3.4M3.8 7.6 8 3.4l4.2 4.2"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          </span>
        </div>
      </form>
      </div>

      {terkunci && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-surface/45 px-6 text-center max-lg:px-4">
          <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-ink text-surface max-lg:mb-2 max-lg:h-10 max-lg:w-10">
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden className="max-lg:h-4 max-lg:w-4">
              <path d="M10 2.5 11.7 7l4.8 1.4L11.7 10l-1.7 4.5L8.3 10 3.5 8.4 8.3 7Z" fill="currentColor" />
            </svg>
          </span>
          <h2 className="papan text-[19px] max-lg:text-[16px]">{t.kunci.judul}</h2>
          <p className="mx-auto mt-2 max-w-[34ch] text-[13.5px] leading-relaxed text-ink-2 max-lg:mt-1.5 max-lg:text-[12px]">
            {akun ? t.kunci.isiGratis : t.kunci.isiTamu}
          </p>
          <button
            onClick={bukaKunci}
            className="mt-4 cursor-pointer rounded-full bg-ink px-5 py-2.5 text-[13.5px] font-semibold text-surface transition-transform duration-300 ease-jelly hover:scale-[1.03] max-lg:mt-3 max-lg:px-4 max-lg:py-2 max-lg:text-[12.5px]"
          >
            {akun ? t.kunci.tombolGratis : t.kunci.tombolTamu}
          </button>
        </div>
      )}
    </div>
  )
}

// Dibungkus `memo`: pane ini tetap terpasang di balik tab lain, dan tidak perlu
// dirender ulang tiap kali tab lain dibuka. Lihat prop pane yang stabil di App.tsx.
export default memo(PanelAI)

