/**
 * Bagian wajib 3 dari 3: Antarmuka AI.
 *
 * Yang membuat bagian ini memenuhi ketentuan C.2 bukan kotak percakapannya,
 * melainkan `jalankanAksi()` di bawah: jawaban AI tidak berhenti sebagai teks,
 * ia menggerakkan peta.
 *
 *   cari_lokasi, jelaskan_skor, cek_harga, pola_jam, cek_zona,
 *   cari_hidden_gem, cek_risiko, bandingkan  → dijalankan backend
 *   flyTo, highlight, setLayer, filter        → dijalankan DI SINI
 *
 * Kalau flyTo dieksekusi backend, tidak ada yang bergerak di layar pengguna.
 *
 * Satu keputusan tampilan yang layak disebut: setiap jawaban membawa jejak alat
 * yang benar-benar dipanggil, dan jejak itu DITAMPILKAN, tidak disembunyikan di
 * log. Asisten yang bisa ditanya "dari mana angkanya" dan menjawab dengan daftar
 * fungsi yang ia jalankan jauh lebih layak dipercaya daripada yang hanya
 * terdengar meyakinkan.
 *
 * TIGA PERUBAHAN BESAR, 11 Sep 2026, seluruhnya atas permintaan pemilik repo:
 *
 *   BILAH JUDUL DICABUT. Ia memuat nama panel yang sudah tertulis di tab tepat
 *   di atasnya, dan mengkliknya membawa orang kembali ke daftar lokasi - persis
 *   yang dilakukan tab "Daftar lokasi" di sebelahnya. Dua pintu ke satu tempat,
 *   dan yang satu tidak menyatakan ke mana ia pergi. Lencana "Siap / Memeriksa"
 *   ikut pergi bersamanya: ia memberi kabar tentang mesinnya, bukan tentang
 *   pertanyaan orang yang sedang mengetik, dan kalau mesinnya memang mati
 *   kalimat lengkapnya sudah muncul di layar pembuka panel ini.
 *
 *   RIWAYAT. Percakapan disimpan di peramban orang yang memakainya - bukan di
 *   server, dan itu disengaja: isi percakapan bisa memuat lokasi incaran
 *   seseorang, dan tidak ada alasan hal itu perlu meninggalkan mesinnya.
 *
 *   PINTASAN LOKASI. Tiap jawaban yang menyebut heksagon membawa tombolnya
 *   sendiri, dan menekannya menerbangkan peta ke sana. Sebelum ini, asisten
 *   bisa menyebut "tiga lokasi terbaik di Manggarai" dan orangnya tetap harus
 *   mencari sendiri yang mana - jawaban yang benar tetapi tidak bisa diikuti.
 */

import { memo, useEffect, useRef, useState } from 'react'

import { KUADRAN, LAYER, type NamaLayer } from '../config'
import { api } from '../lib/api'
import { useBahasa, useNamaZona, useTeks, type Bahasa } from '../lib/bahasa'
import type { AksiPeta, JawabanAI, PesanRiwayat, SkorHeksagon, StatusAI } from '../types'
import type { KendaliPeta, Kriteria } from './PetaInteraktif'
import { Badge, Markdown, NamaBerombak, PapanNama } from './primitif'

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
    baru: 'Percakapan baru',
    kosongRiwayat: 'Belum ada percakapan tersimpan. Yang Anda tanyakan di sini disimpan di peramban ini saja.',
    hapus: 'Hapus percakapan ini',
    sedang: 'sedang dibuka',
    langkah: (n: number) => `${n} langkah dijalankan`,
    sumber: 'Sumber angka',
    tertinggi: 'tertinggi di wilayah studi',
    lebihTinggi: (p: string) => `lebih tinggi dari ${p}% lokasi lain`,
    keLokasi: 'Lokasi yang disebut',
    bukaLokasi: (k: string) => `Terbangkan peta ke ${k}`,
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
      flyTo: 'menggerakkan peta',
      highlight: 'menyorot heksagon',
      setLayer: 'mengganti layer',
      filter: 'menyaring peta',
    } as Record<string, string>,
    galat: {
      belumTersambung:
        'Loconomics AI belum tersambung ke penyedia modelnya. Bagian lain di peta — skor, kuadran, ZoneGuard, dan rekomendasi — tidak terpengaruh.',
      anggaran: 'Plafon biaya AI untuk hari ini sudah tercapai. Asisten aktif lagi besok.',
      terlaluBanyak: 'Terlalu banyak pertanyaan dalam waktu singkat. Tunggu sebentar lalu coba lagi.',
      basisData:
        'Basis data sedang tidak bisa dihubungi. Kalau ini terjadi setelah lama menganggur, coba lagi dalam beberapa puluh detik.',
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
    baru: 'New conversation',
    kosongRiwayat: 'Nothing saved yet. What you ask here stays in this browser.',
    hapus: 'Delete this conversation',
    sedang: 'open now',
    langkah: (n: number) => `${n} steps taken`,
    sumber: 'Where the numbers come from',
    tertinggi: 'highest in the study area',
    lebihTinggi: (p: string) => `higher than ${p}% of other locations`,
    keLokasi: 'Locations mentioned',
    bukaLokasi: (k: string) => `Fly the map to ${k}`,
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
      flyTo: 'moving the map',
      highlight: 'highlighting hexagons',
      setLayer: 'switching layer',
      filter: 'filtering the map',
    } as Record<string, string>,
    galat: {
      belumTersambung:
        'Loconomics AI is not connected to its model provider yet. Everything else on the map — scores, quadrants, ZoneGuard, and recommendations — is unaffected.',
      anggaran: 'Today’s AI spending cap has been reached. The assistant is back tomorrow.',
      terlaluBanyak: 'Too many questions in a short time. Wait a moment and try again.',
      basisData:
        'The database cannot be reached right now. If this happened after a long idle period, try again in a few dozen seconds.',
      lain: (t: string) => `Could not reach the assistant: ${t}`,
    },
  },
}

type Teks = (typeof K)['id']

/** Terjemahkan galat backend jadi kalimat yang bisa ditindaklanjuti. */
function pesanGalat(e: unknown, t: Teks): string {
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

/**
 * Id percakapan. Waktu DAN acak.
 *
 * Waktu saja tidak cukup: dua tab yang mengirim pertanyaan pertamanya pada
 * milidetik yang sama akan menimpa percakapan satu sama lain di localStorage
 * yang mereka bagi. Empat huruf acak membuat itu tidak mungkin.
 *
 * Di luar komponen, dan itu bukan kerapian: `Date.now()` dan `Math.random()`
 * di dalam badan komponen dilaporkan oxlint sebagai fungsi tak-murni yang
 * dipanggil saat render - benar sebagai aturan, keliru untuk penangan
 * peristiwa, dan cara membuatnya benar sekaligus tenang adalah dengan tidak
 * menaruhnya di sana sama sekali.
 */
function idBaru() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function PintasLokasi({
  h3,
  onBuka,
  t,
}: {
  h3: string
  onBuka: (h3: string) => void
  t: Teks
}) {
  const [skor, setSkor] = useState<SkorHeksagon | null>(() => SINGGAH.get(h3) ?? null)
  const namaZona = useNamaZona()

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
        /* Tombolnya tetap ada dan tetap bisa ditekan; cuma labelnya yang
           tinggal kode heksagon. Peta tidak butuh label untuk terbang. */
      })
    return () => {
      hidup = false
    }
  }, [h3])

  const q = skor?.kuadran ? KUADRAN[skor.kuadran] : null
  const nilai = typeof skor?.opportunity_score === 'number' ? Math.round(skor.opportunity_score) : null

  /**
   * SKORNYA yang berdiri di depan, bukan nama kawasannya.
   *
   * Terlihat begitu di potret pertama: delapan pintasan berturut-turut yang
   * seluruhnya berbunyi "Manggarai" - benar, dan sama sekali tidak membantu
   * siapa pun memilih yang mana. Jawaban AI hampir selalu menyebut beberapa
   * heksagon di SATU kawasan, jadi nama kawasan adalah bagian yang paling
   * sering sama dan skor adalah yang paling sering berbeda.
   */
  return (
    <button
      onClick={() => onBuka(h3)}
      title={
        skor
          ? `${t.bukaLokasi(skor.kawasan)}${q ? ` · ${namaZona(q.kunci)}` : ''}${nilai === null ? '' : ` · ${nilai}`}`
          : t.bukaLokasi(h3)
      }
      className="g-ai-pintas group flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[12.5px] text-ink-2"
    >
      {/* Pin, bukan panah: yang dituju sebuah TEMPAT, dan pin sudah jadi
          kosakata untuk itu di setiap produk peta yang pernah dipakai orang. */}
      <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden className="shrink-0 text-ink-3">
        <path
          d="M6 11S1.8 7.4 1.8 4.7a4.2 4.2 0 1 1 8.4 0C10.2 7.4 6 11 6 11Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <circle cx="6" cy="4.6" r="1.5" fill="currentColor" />
      </svg>
      {q && (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
          style={{ background: q.warna }}
          aria-hidden
        />
      )}
      {nilai !== null && <span className="tabular shrink-0 font-semibold text-ink">{nilai}</span>}
      <span className="min-w-0 truncate text-ink-3">
        {q ? namaZona(q.kunci) : (skor?.kawasan ?? t.memuat)}
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
  /**
   * Layer yang sedang tampil, diteruskan ke model sebagai konteks.
   *
   * Prompt sistem menyuruh asisten mengganti layer sesuai pertanyaan
   * ("soal harga -> pricelens"). Tanpa tahu layer mana yang SEDANG aktif, ia
   * memanggil setLayer untuk layer yang sudah terpasang - peta tidak bergerak,
   * dan aksi peta yang dijanjikan ketentuan C.2 jadi tidak terlihat.
   */
  layerAktif: NamaLayer
  /**
   * Pintasan lokasi ditekan.
   *
   * Pemilihan heksagon MILIK App, bukan panel ini: peta, daftar, baki
   * komparasi, dan panel detail semuanya membacanya, dan panel yang memilih
   * sendiri akan jadi pemilik kedua untuk satu keadaan yang sama.
   */
  onKeLokasi: (h3: string) => void
}) {
  const t = useTeks(K)
  const { bahasa } = useBahasa()
  const [pesan, setPesan] = useState<Pesan[]>([])
  const [input, setInput] = useState('')
  const [memuat, setMemuat] = useState(false)
  const [status, setStatus] = useState<StatusAI | null>(null)
  const [arsip, setArsip] = useState<Percakapan[]>(bacaArsip)
  const [lihatRiwayat, setLihatRiwayat] = useState(false)
  const akhir = useRef<HTMLDivElement>(null)
  /**
   * Id percakapan yang sedang dibuka.
   *
   * STATE, bukan ref, dan itu bukan selera: daftar riwayat menandai mana yang
   * sedang dibuka, dan penanda yang dibaca dari `ref.current` saat render tidak
   * pernah dijamin ikut berubah. Idnya dibuat di penangan `kirim` - bukan di
   * dalam effect penyimpan - supaya tidak ada satu pun `setState` di dalam
   * effect: keduanya dibatch dalam satu render, jadi effect penyimpan sudah
   * melihat id yang baru pada giliran pertamanya.
   */
  const [idSesi, setIdSesi] = useState<string | null>(null)

  // Kesiapan diperiksa saat memuat, bukan saat pertanyaan pertama gagal.
  // Memberi tahu di awal jauh lebih sopan daripada membiarkan orang mengetik
  // pertanyaan panjang lalu menolaknya.
  useEffect(() => {
    api.statusAI().then(setStatus).catch(() => setStatus(null))
  }, [])

  /**
   * Status disegarkan lagi tiap dua menit SELAMA sedang dibatasi.
   *
   * Jatah penyedia pulih sendiri, dan pita "sedang dibatasi" yang hanya
   * diambil sekali saat panel dipasang akan tetap terpampang sampai orangnya
   * memuat ulang halaman - memberitahukan keadaan yang sudah tidak benar lagi.
   * Tidak dijalankan saat sehat: memanggil /ai/status tiap dua menit untuk
   * mendengar "masih sehat" adalah lalu lintas yang tidak membeli apa pun.
   */
  useEffect(() => {
    if (status?.dibatasi !== true) return
    const id = setInterval(() => {
      api.statusAI().then(setStatus).catch(() => {})
    }, 120_000)
    return () => clearInterval(id)
  }, [status?.dibatasi])

  /**
   * Percakapan disimpan tiap kali isinya berubah, bukan saat panel ditutup.
   *
   * Tidak ada "saat panel ditutup" yang bisa diandalkan: tab bisa ditutup,
   * peramban bisa mati, dan halaman ini juga dipakai dari ponsel. Menyimpan
   * pada setiap perubahan berarti tidak ada satu pun jalan keluar yang
   * kehilangan percakapan.
   */
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

  /**
   * Menerjemahkan `aksi_peta` dari LLM menjadi gerakan peta yang sebenarnya.
   *
   * Nama fungsi divalidasi lewat `switch`, bukan dipanggil dinamis. Setiap
   * argumen juga diperiksa tipenya: keluaran model diperlakukan sebagai data
   * yang belum tentu benar, bukan perintah yang tinggal dijalankan.
   */
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

  async function kirim(pertanyaan: string) {
    if (!pertanyaan.trim() || memuat) return
    // Percakapan baru lahir di sini, bukan di effect penyimpan. Keduanya
    // dibatch React dalam satu render, jadi effect itu langsung melihat idnya.
    if (!idSesi) setIdSesi(idBaru())
    setPesan((s) => [...s, { peran: 'pengguna', teks: pertanyaan }])
    setInput('')
    setMemuat(true)

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
    } finally {
      setMemuat(false)
      requestAnimationFrame(() => akhir.current?.scrollIntoView({ behavior: 'smooth' }))
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

  function hapusPercakapan(id: string) {
    const baru = bacaArsip().filter((p) => p.id !== id)
    tulisArsip(baru)
    setArsip(baru)
    if (idSesi === id) percakapanBaru()
  }

  /**
   * Arsip dibaca ULANG tiap laci dibuka, bukan dijaga sinkron tiap giliran.
   *
   * Yang menulisnya effect penyimpan di atas, dan ia menulis ke localStorage
   * saja - tanpa `setState`. Membacanya kembali di sini menjaga satu sumber
   * kebenaran (berkas di peramban) alih-alih dua yang harus dijaga sepakat,
   * dan sekaligus memunculkan percakapan dari TAB LAIN yang kebetulan terbuka.
   */
  function bukaLaci() {
    setArsip(bacaArsip())
    setLihatRiwayat(true)
  }

  /**
   * MATI hanya untuk yang strukturil.
   *
   * `siap: false` punya dua sebab yang menuntut antarmuka berbeda. Belum
   * tersambung ke penyedia (tidak ada kunci) memang mematikan kotak ketik -
   * pertanyaan apa pun tidak akan pernah sampai ke mana-mana. Tetapi "jatah
   * hariannya habis" pulih sendiri, dan mematikan kotak ketik di sana membuat
   * orangnya tidak bisa mencoba lagi walaupun jatahnya sudah pulih semenit
   * kemudian. Terjadi 13 Sep 2026 dan langsung dilaporkan pemilik repo
   * sebagai "Loconomics AI kok kayak gabisa ngetik".
   */
  const dibatasi = status?.dibatasi === true
  const mati = status !== null && !status.siap && !dibatasi
  /** Ada sesuatu yang perlu diberitahukan - entah mati, entah cuma dibatasi. */
  const berkabar = status !== null && !status.siap

  return (
    <div className="relative flex h-full flex-col">
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

        <button
          onClick={percakapanBaru}
          title={t.baru}
          aria-label={t.baru}
          disabled={!pesan.length}
          className="ml-auto grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path d="M7 2.4v9.2M2.4 7h9.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* --- Laci riwayat ---------------------------------------------------
          Menutupi percakapan, tidak menggesernya: daftar yang mendorong isi ke
          bawah membuat posisi gulir percakapan hilang tiap kali dibuka. */}
      {lihatRiwayat && (
        <div className="ai-laci scroll-tipis absolute inset-x-0 top-[3.05rem] bottom-0 z-10 overflow-y-auto bg-surface px-2.5 py-2">
          {arsip.length === 0 ? (
            <p className="px-1.5 py-6 text-center text-[13px] leading-relaxed text-ink-3">
              {t.kosongRiwayat}
            </p>
          ) : (
            <ul className="space-y-1">
              {arsip.map((p) => (
                <li key={p.id} className="group flex items-center gap-1">
                  <button
                    onClick={() => bukaPercakapan(p)}
                    className="min-w-0 flex-1 cursor-pointer rounded-sm px-2.5 py-2 text-left transition-colors hover:bg-surface-2"
                  >
                    <span className="block truncate text-[13.5px] leading-snug text-ink">{p.judul}</span>
                    <span className="mt-0.5 block text-[11.5px] text-ink-3">
                      {usia(p.waktu, bahasa)}
                      {idSesi === p.id ? ` · ${t.sedang}` : ''}
                    </span>
                  </button>
                  <button
                    onClick={() => hapusPercakapan(p.id)}
                    title={t.hapus}
                    aria-label={t.hapus}
                    className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-full text-ink-3 opacity-0 transition-all hover:bg-surface-2 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
                      <path d="M2.6 2.6 9.4 9.4M9.4 2.6 2.6 9.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="scroll-tipis flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
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
              <span className="g-ai-mercu relative mb-5 inline-flex flex-col items-center">
                <span className="g-ai-nyala pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full" aria-hidden />
                <span className="g-ai-kilau pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[220px] w-[220px] -translate-x-1/2 -translate-y-1/2 rounded-full" aria-hidden />
                <span className="g-ai-cincin-kabut pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[152px] w-[152px] -translate-x-1/2 -translate-y-1/2 rounded-full" aria-hidden />

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
                  <PapanNama teks="Loconomics" sebagai="div" kelas="text-[34px] leading-none text-ink" />
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
              {berkabar && (
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

              <div className="mt-6 w-full space-y-1.5">
                {t.contoh.map((c, i) => (
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
            </div>
          </div>
        </div>

        {pesan.map((m, i) => (
          <div key={i} className={m.peran === 'pengguna' ? 'flex shrink-0 justify-end' : 'shrink-0'}>
            {m.peran === 'pengguna' ? (
              <p className="max-w-[85%] rounded-md rounded-br-xs bg-ink px-3.5 py-2 text-[14.5px] leading-snug text-surface">
                {m.teks}
              </p>
            ) : (
              <div className="max-w-[94%] text-[14.5px] text-ink">
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
                    <p className="eyebrow mb-1.5">{t.keLokasi}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {m.jawaban.hex_disebut.slice(0, 6).map((h3) => (
                        <PintasLokasi key={h3} h3={h3} onBuka={onKeLokasi} t={t} />
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
          <NamaBerombak teks="Loconomics AI" kelas="justify-start text-[15px]" label={t.berpikir} />
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
          <span className="ai-tombol relative shrink-0" data-berpikir={memuat}>
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
                // Busur tiga-perempat yang berputar - spinner, bukan panah
                // yang dibekukan. Sama animasinya (`ai-putar`) dengan cincin
                // di belakangnya, cuma jauh lebih cepat, jadi keduanya terbaca
                // sebagai SATU gerakan, bukan dua animasi yang kebetulan
                // tumpang tindih.
                <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden className="ai-spin">
                  <circle
                    cx="8"
                    cy="8"
                    r="6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeDasharray="21 17"
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
  )
}

// Dibungkus `memo`: pane ini tetap terpasang di balik tab lain, dan tidak perlu
// dirender ulang tiap kali tab lain dibuka. Lihat prop pane yang stabil di App.tsx.
export default memo(PanelAI)
