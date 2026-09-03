/**
 * Kerangka aplikasi.
 *
 * Tiga bagian yang WAJIB ada menurut ketentuan lomba, semuanya terlihat sekaligus
 * tanpa berpindah halaman:
 *
 *   1. Peta Interaktif    — PetaInteraktif.tsx   (latar penuh)
 *   2. Insight / Analisis — PanelInsight.tsx     (panel kanan, bisa dilipat)
 *   3. Antarmuka AI       — PanelAI.tsx          (tab kedua di panel kanan)
 *
 * Menaruh ketiganya dalam satu layar bukan sekadar tata letak. Rantainya:
 * AI menggerakkan peta, peta memilih heksagon, heksagon mengisi panel insight.
 * Kalau ketiganya terpisah halaman, rantai itu putus dan demo kehilangan alurnya.
 *
 * TATA LETAK: peta mengisi seluruh layar, chrome melayang di atasnya.
 *
 * Seluruh chrome duduk di satu lapisan `pointer-events-none` — hanya panelnya
 * sendiri yang menerima klik, jadi peta tetap bisa digeser di sela-selanya.
 *
 * Tiga keputusan yang diambil setelah melihat versi pertama dipakai:
 *
 *   - Panel kanan BISA DILIPAT. Ia 25rem dan tidak pernah pergi; di layar 1280
 *     itu memakan sepertiga peta untuk daftar yang kadang cuma dilihat sekali.
 *   - Konsultan AI keluar dari kaki panel kanan jadi tombol melayang sendiri.
 *     Sebagai laci, ia berebut tinggi dengan daftar lokasi dan dua-duanya kalah.
 *   - Pencarian ada di bilah atas. Sebelumnya satu-satunya cara berpindah tempat
 *     adalah dropdown kawasan, padahal yang dicari orang biasanya nama stasiun.
 */

import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'

import {
  BINGKAI_SEMUA,
  GAYA_BASEMAP,
  KAWASAN_PILOT,
  KUADRAN,
  SEMUA_KAWASAN,
  LAYER,
  frasaKawasan,
  frasaPrestise,
  kodeLokasi,
  nomorLokasi,
  type NamaGaya,
  type NamaLayer,
} from './config'
import { api } from './lib/api'
import type {
  DiagramKuadran,
  Kuadran as NamaKuadran,
  ProfilRute,
  SimpulTransit,
} from './types'
import DaftarLokasi from './components/DaftarLokasi'
import KompasKuadran from './components/KompasKuadran'
import Legenda from './components/Legenda'
import PanelAI from './components/PanelAI'
import PanelInsight from './components/PanelInsight'
// Gerbang dan Simulasi dimuat MALAS, dan itu penghematan yang nyata, bukan
// hiasan: Gerbang menyeret GSAP + ScrollTrigger + 2.000 baris scrollytelling
// yang TIDAK PERNAH dirender untuk orang yang kembali (refresh langsung ke
// peta), dan Simulasi hanya hidup saat lembarnya dibuka. Keduanya keluar dari
// bundel awal; peta mendapat utas utamanya lebih cepat.
const Gerbang = lazy(() => import('./components/Gerbang'))
import { TombolAkun, useSesi } from './components/Akun'
import { MenuKawasan } from './components/Premium'
const Rekomendasi = lazy(() => import('./components/Rekomendasi'))
// Kedua dialog ini besar dan jarang dibuka. MenuKawasan tetap statis - ia
// duduk di bilah atas dan harus ada sejak bingkai pertama.
const DialogKomparasi = lazy(() =>
  import('./components/Premium').then((m) => ({ default: m.DialogKomparasi })),
)
const DialogPantauan = lazy(() =>
  import('./components/Premium').then((m) => ({ default: m.DialogPantauan })),
)
const Simulasi = lazy(() => import('./components/Simulasi'))
const Pembuka = lazy(() => import('./components/Pembuka'))
import type { AksiPetaRef, KendaliPeta } from './components/PetaInteraktif'
/**
 * Peta dimuat MALAS, dan ini penghematan terbesar di seluruh berkas.
 *
 * MapLibre GL sendirian hampir satu megabyte, dan halaman perkenalan SENGAJA
 * tidak memakainya sama sekali (lihat CLAUDE.md: "Halaman gerbang tidak memuat
 * MapLibre"). Selama impornya statis, janji itu benar untuk RENDER tetapi bohong
 * untuk UNDUHAN: berkasnya tetap ikut di bundel pertama, dan orang yang baru
 * membuka landing page membayar ongkosnya sebelum melihat satu pun heksagon.
 *
 * Tipenya diimpor terpisah dengan `import type` - itu dihapus saat kompilasi,
 * jadi ia tidak menyeret modulnya kembali ke bundel utama.
 */
const PetaInteraktif = lazy(() => import('./components/PetaInteraktif'))
import { Glif, Menu, MenuPengaturan, PapanNama, PilihBasemap } from './components/primitif'

/** Layer yang diwarnai menurut kuadran — hanya di sini Kompas benar. */
/**
 * Layer yang isian petanya benar-benar diwarnai menurut kuadran.
 *
 * `risk_radar` dikeluarkan 22 Agustus 2026: sejak ia diwarnai oleh indeks churn,
 * Kompas di sampingnya menerangkan warna yang sudah tidak ada di layar. Itu
 * persis keluhan "RiskRadar kelihatan sama saja dengan Opportunity Score" - keduanya
 * memang menampilkan legenda yang sama.
 *
 * `hidden_gem` tetap di sini: gradasinya berjalan dari warna lembut ke warna
 * penuh kuadran HIDDEN_GEM, jadi Kompas masih menjelaskan warnanya.
 */
const LAYER_KUADRAN: NamaLayer[] = ['opportunity', 'hidden_gem']

/** Basemap yang membuat kaca terang tidak terbaca. Memicu tema kaca gelap. */
const GAYA_GELAP: NamaGaya[] = ['gelap']

/** Indeks H3 resolusi 9: 15 digit heksadesimal. Dipakai pencarian. */
const POLA_H3 = /^[0-9a-f]{15}$/i

// ---------------------------------------------------------------------------
// Keadaan tampilan yang bertahan melewati refresh
// ---------------------------------------------------------------------------

/**
 * Menekan F5 di peta harus kembali ke PETA, bukan ke halaman perkenalan.
 *
 * Sebelumnya `gerbang` selalu lahir `true`, jadi setiap refresh melempar
 * orangnya kembali ke awal - dan bersama gerbangnya ikut hilang kawasan yang
 * sedang dilihat, layer yang sedang dipilih, dan heksagon yang sedang dibaca.
 * Untuk halaman yang dipakai sambil membandingkan beberapa lokasi, itu bukan
 * gangguan kecil; itu kehilangan pekerjaan.
 *
 * DUA penyimpanan, dan pembagiannya yang penting:
 *
 *   sessionStorage  `masuk` - sudahkah orang ini melewati gerbang DI SESI INI
 *   localStorage    kawasan, layer, gaya - latar kerjanya
 *
 * Sebabnya dua permintaan yang terdengar berlawanan tetapi sebenarnya tidak:
 * "refresh jangan kembali ke landing" dan "pertama kali masuk harus selalu
 * lewat landing". Keduanya bisa dipenuhi sekaligus karena MENEKAN F5 dan
 * MEMBUKA WEB adalah dua hal berbeda - dan sessionStorage persis membedakannya:
 * ia bertahan menembus refresh di tab yang sama, dan kosong di tab baru,
 * jendela baru, atau esok hari.
 *
 * Latar kerjanya tetap di localStorage. Yang diminta bukan melupakan kawasan
 * yang sedang dilihat, melainkan tidak melewati perkenalannya - jadi orang yang
 * kembali besok mendapat gerbang dulu, lalu petanya terbuka di kawasan dan
 * layer yang ia tinggalkan.
 *
 * Yang TIDAK disimpan: apa pun tentang akun. Tiket punya kuncinya sendiri di
 * `lib/api.ts`, dan tingkat langganan tidak pernah disimpan di peramban sama
 * sekali - ia dibaca ulang dari backend tiap kali memuat. Tingkat yang bisa
 * disunting dari devtools bukan tingkat.
 */
const KUNCI_TAMPILAN = 'loconomics.tampilan.v1'

/** Hanya menandai "sudah lewat gerbang di sesi ini". Sengaja di sessionStorage. */
const KUNCI_SESI = 'loconomics.sesi.v1'

interface TampilanTersimpan {
  masuk?: boolean
  kawasan?: string
  layer?: NamaLayer
  gaya?: NamaGaya
}

/**
 * Nilai kawasan tersimpan boleh berisi BEBERAPA nama dipisah koma — itu bentuk
 * yang dipakai filter multi-kawasan.
 *
 * Versi sebelumnya hanya menerima satu nama pilot atau string kosong, jadi
 * setiap saringan gabungan dibuang diam-diam saat refresh dan petanya melompat
 * balik ke seluruh kawasan. Yang hilang bukan kenyamanan: multi-kawasan itu
 * baris pertama tabel fitur berbayar, dan fitur berbayar yang tidak selamat
 * dari F5 terbaca sebagai fitur yang rusak.
 *
 * Tiap potongan tetap diperiksa satu per satu — nama tak dikenal (misalnya dari
 * versi lama aplikasi ini) dibuang, sisanya dipertahankan.
 */
function bersihkanKawasan(nilai: string | undefined): string | undefined {
  if (nilai === undefined) return undefined
  if (nilai === SEMUA_KAWASAN) return SEMUA_KAWASAN
  const sah = nilai.split(',').filter((n) => KAWASAN_PILOT.some((k) => k.nama === n))
  return sah.length ? sah.join(',') : undefined
}

function bacaSesiMasuk(): boolean {
  try {
    return sessionStorage.getItem(KUNCI_SESI) === '1'
  } catch {
    // Mode privat sebagian peramban melempar saat sessionStorage disentuh.
    // Jawaban yang aman "belum masuk": salah menuju gerbang cuma satu klik
    // tambahan, salah melewatinya menghilangkan perkenalan yang justru diminta.
    return false
  }
}

function tulisSesiMasuk(masuk: boolean): void {
  try {
    if (masuk) sessionStorage.setItem(KUNCI_SESI, '1')
    else sessionStorage.removeItem(KUNCI_SESI)
  } catch {
    /* mode privat; sesi ini tetap jalan, cuma tidak selamat dari refresh */
  }
}

function bacaTampilan(): TampilanTersimpan {
  try {
    const mentah = localStorage.getItem(KUNCI_TAMPILAN)
    if (!mentah) return {}
    const t = JSON.parse(mentah) as TampilanTersimpan
    // Divalidasi, bukan dipercaya. Isi localStorage bisa berasal dari versi
    // lama aplikasi ini - layer yang sudah dihapus akan membuat peta meminta
    // sesuatu yang tidak ada dan gagal tanpa keterangan.
    return {
      // Dibaca dari sessionStorage, BUKAN dari `t`. Nilai `masuk` yang lama
      // mungkin masih tertinggal di localStorage dari versi sebelum pembagian
      // ini; membacanya akan diam-diam melewati gerbang untuk orang yang justru
      // baru membuka webnya.
      masuk: bacaSesiMasuk(),
      kawasan: bersihkanKawasan(t.kawasan),
      layer: t.layer && t.layer in LAYER ? t.layer : undefined,
      gaya: t.gaya && t.gaya in GAYA_BASEMAP ? t.gaya : undefined,
    }
  } catch {
    // JSON rusak, atau mode privat yang melempar. Keduanya berarti hal yang
    // sama untuk pemanggil: mulai dari awal.
    return {}
  }
}

const AWAL = bacaTampilan()

// ---------------------------------------------------------------------------
// Pencarian
// ---------------------------------------------------------------------------

type Hasil =
  | { jenis: 'kawasan'; nama: string; moda: string }
  | { jenis: 'simpul'; simpul: SimpulTransit }
  | { jenis: 'heksagon'; h3: string }

/**
 * Pencarian atas data sendiri, bukan geocoder.
 *
 * Yang bisa dicari: enam kawasan pilot, seluruh simpul transit yang dikenal
 * backend, dan indeks H3 kalau seseorang menempelkannya dari laporan. TIDAK ada
 * pencarian alamat bebas — itu butuh layanan geocoding pihak ketiga, dan
 * ketentuan lomba mengunci peta ini pada MAPID saja. Kotak yang menjanjikan
 * "cari alamat apa pun" lalu tidak menemukan apa-apa lebih buruk daripada kotak
 * yang jujur mencari tiga hal dan menemukan ketiganya.
 */
function Cari({
  simpul,
  onPilihKawasan,
  onPilihSimpul,
  onPilihHeksagon,
}: {
  simpul: SimpulTransit[]
  onPilihKawasan: (nama: string) => void
  onPilihSimpul: (s: SimpulTransit) => void
  onPilihHeksagon: (h3: string) => void
}) {
  const [q, setQ] = useState('')
  const [buka, setBuka] = useState(false)
  const [sorot, setSorot] = useState(0)
  const wadah = useRef<HTMLDivElement>(null)

  const hasil = useMemo<Hasil[]>(() => {
    const t = q.trim().toLowerCase()
    if (!t) return []
    const keluar: Hasil[] = []
    if (POLA_H3.test(t)) keluar.push({ jenis: 'heksagon', h3: t })
    for (const k of KAWASAN_PILOT)
      if (k.nama.toLowerCase().includes(t))
        keluar.push({ jenis: 'kawasan', nama: k.nama, moda: k.moda })
    for (const s of simpul)
      if (s.nama.toLowerCase().includes(t)) keluar.push({ jenis: 'simpul', simpul: s })
    return keluar.slice(0, 8)
  }, [q, simpul])

  useEffect(() => {
    if (!buka) return
    const luar = (e: MouseEvent) => {
      if (!wadah.current?.contains(e.target as Node)) setBuka(false)
    }
    document.addEventListener('mousedown', luar)
    return () => document.removeEventListener('mousedown', luar)
  }, [buka])

  const jalankan = (h: Hasil) => {
    if (h.jenis === 'kawasan') onPilihKawasan(h.nama)
    else if (h.jenis === 'simpul') onPilihSimpul(h.simpul)
    else onPilihHeksagon(h.h3)
    setQ('')
    setBuka(false)
  }

  return (
    <div ref={wadah} className="relative min-w-0 flex-1 md:max-w-[19rem]">
      <div className="fokus-pil flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3.5 py-1.5 transition-colors focus-within:border-line-2 focus-within:bg-surface">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="shrink-0 text-ink-3">
          <circle cx="6" cy="6" r="4.3" stroke="currentColor" strokeWidth="1.6" fill="none" />
          <path d="M9.3 9.3 12.5 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setSorot(0)
            setBuka(true)
          }}
          onFocus={() => setBuka(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') return setBuka(false)
            if (!hasil.length) return
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSorot((i) => (i + 1) % hasil.length)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSorot((i) => (i - 1 + hasil.length) % hasil.length)
            } else if (e.key === 'Enter') {
              e.preventDefault()
              jalankan(hasil[sorot])
            }
          }}
          placeholder="Cari stasiun, kawasan, atau indeks H3…"
          aria-label="Cari stasiun, kawasan, atau indeks H3"
          className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-ink-3 focus-visible:outline-none"
        />
        {q && (
          <button
            onClick={() => {
              setQ('')
              setBuka(false)
            }}
            aria-label="Kosongkan pencarian"
            className="shrink-0 cursor-pointer text-[15px] leading-none text-ink-3 transition-colors hover:text-ink"
          >
            ×
          </button>
        )}
      </div>

      {buka && q.trim() && (
        <ul className="kaca-tebal pop absolute left-0 top-[calc(100%+8px)] z-50 w-full min-w-[17rem] overflow-hidden rounded-md p-1.5">
          {hasil.length === 0 && (
            <li className="px-3 py-2.5 text-[13px] text-ink-3">
              Tidak ada yang cocok. Pencarian hanya mengenali kawasan pilot,
              simpul transit, dan indeks H3.
            </li>
          )}
          {hasil.map((h, i) => (
            <li key={`${h.jenis}-${i}`}>
              <button
                onMouseEnter={() => setSorot(i)}
                onClick={() => jalankan(h)}
                className={`flex w-full cursor-pointer items-baseline gap-2.5 rounded-sm px-3 py-2 text-left transition-colors ${
                  i === sorot ? 'bg-surface-2' : ''
                }`}
              >
                <span className="eyebrow shrink-0">
                  {h.jenis === 'kawasan' ? 'Kawasan' : h.jenis === 'simpul' ? 'Simpul' : 'H3'}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
                  {h.jenis === 'kawasan'
                    ? h.nama
                    : h.jenis === 'simpul'
                      ? h.simpul.nama
                      : h.h3}
                </span>
                <span className="shrink-0 text-[12px] text-ink-3">
                  {h.jenis === 'kawasan'
                    ? h.moda
                    : h.jenis === 'simpul'
                      ? `${h.simpul.moda} · ${h.simpul.kawasan}`
                      : 'buka heksagon'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Empat kolom sudah tidak muat di layar mana pun tanpa digulir menyamping. */
const MAKS_BANDING = 4

/**
 * Bar komparasi — menggantikan ajakan simulasi di tengah bawah.
 *
 * KENAPA MENGGANTIKAN, bukan menumpuk. Keduanya menjawab pertanyaan yang
 * berbeda tentang hal yang berbeda: simulasi bertanya "kalau saya buka DI SINI",
 * komparasi bertanya "yang MANA dari beberapa ini". Menampilkan keduanya
 * sekaligus memaksa orang memilih dulu sebelum mengerjakan apa pun.
 *
 * Bar dibagi RATA sebanyak heksagon yang dipilih: dua jadi kiri-kanan, tiga jadi
 * kiri-tengah-kanan. Nomor kolomnya sama dengan nomor lencana di peta, dan itu
 * satu-satunya hal yang menghubungkan keduanya - kalau urutannya bergeser,
 * seluruh bar berhenti berarti.
 */
function BarKomparasi({
  baki,
  skor,
  onLepas,
  onKosongkan,
  onBuka,
  onSorot,
}: {
  baki: string[]
  skor: Map<string, { kawasan: string; skor: number | null; kuadran: NamaKuadran | null }>
  onLepas: (h3: string) => void
  onKosongkan: () => void
  onBuka: () => void
  onSorot: (h3: string) => void
}) {
  const siap = baki.length >= 2
  return (
    <div className="kaca-tebal pointer-events-auto flex w-full max-w-[54rem] items-stretch gap-1 rounded-xl p-1.5 shadow-lg">
      <div className="flex min-w-0 flex-1 items-stretch gap-1">
        {baki.map((h3, i) => {
          const d = skor.get(h3)
          const q = d?.kuadran ? KUADRAN[d.kuadran] : null
          return (
            <div
              key={h3}
              className="group relative flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-surface-2"
              style={{ background: q ? `color-mix(in srgb, ${q.lembut} 55%, transparent)` : undefined }}
            >
              <button
                onClick={() => onSorot(h3)}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                title="Buka di peta"
              >
                {/* Nomor yang SAMA dengan lencana di peta. */}
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-bold text-surface">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="papan tabular text-[17px] leading-none">
                      {d?.skor === null || d?.skor === undefined ? '—' : d.skor.toFixed(0)}
                    </span>
                    {d?.kuadran && <Glif kuadran={d.kuadran} ukuran={9} />}
                  </span>
                  <span className="mt-0.5 block truncate text-[10.5px] leading-tight text-ink-3">
                    {d ? kodeLokasi(h3, d.kawasan) : nomorLokasi(h3)}
                  </span>
                </span>
              </button>
              <button
                onClick={() => onLepas(h3)}
                aria-label={`Keluarkan lokasi ${i + 1}`}
                title="Keluarkan"
                className="grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-full text-[13px] leading-none text-ink-3 opacity-0 transition-all hover:bg-bahaya-soft hover:text-bahaya group-hover:opacity-100"
              >
                x
              </button>
            </div>
          )
        })}

        {/* Slot kosong: bar yang menyusut tiap kali satu dikeluarkan terasa
            goyah. Slot bergaris putus-putus menahan bentuknya sekaligus
            mengatakan masih ada tempat. */}
        {baki.length < 2 && (
          <div className="flex min-w-0 flex-1 items-center justify-center rounded-lg border border-dashed border-line-2 px-3 py-1.5 text-center text-[11.5px] leading-snug text-ink-3">
            Klik heksagon lain di peta untuk membandingkan
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 border-l border-line/70 pl-1.5">
        <button
          onClick={onKosongkan}
          title="Kosongkan baki"
          aria-label="Kosongkan baki komparasi"
          className="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden>
            <path d="M5 5l10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <button
          onClick={onBuka}
          disabled={!siap}
          className="flex cursor-pointer items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[13.5px] font-semibold text-surface transition-transform duration-300 ease-jelly hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
        >
          <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden className="shrink-0">
            <path d="M4 15V8M10 15V4M16 15v-5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
          </svg>
          Bandingkan {baki.length}
        </button>
      </div>
    </div>
  )
}

export default function App() {
  /**
   * Kawasan yang sedang disaring. SEMUA_KAWASAN ('') = tidak disaring.
   *
   * Bawaannya sengaja "semua": layar pertama seharusnya memperlihatkan cakupan
   * produknya, bukan satu dari enam kawasan yang kebetulan ditulis pertama di
   * daftar. Menyempitkan ke satu kawasan adalah tindakan yang dipilih pengguna,
   * bukan keadaan yang ia warisi.
   */
  const [kawasan, setKawasan] = useState<string>(AWAL.kawasan ?? SEMUA_KAWASAN)
  const [layer, setLayer] = useState<NamaLayer>(AWAL.layer ?? 'opportunity')
  const [gaya, setGaya] = useState<NamaGaya>(AWAL.gaya ?? 'terang')
  const [hexTerpilih, setHexTerpilih] = useState<string | null>(null)
  const [saringKuadran, setSaringKuadran] = useState<NamaKuadran | null>(null)
  const [nHeksagon, setNHeksagon] = useState<number | null>(null)
  const [kuadranPenuh, setKuadranPenuh] = useState(false)
  // Daftar dulu, detail belakangan. Pertanyaan pertama pengguna adalah "yang mana
  // yang harus saya lihat", bukan "bagaimana lokasi ini" - dan layar kosong yang
  // menyuruh mengklik heksagon menjawab pertanyaan yang belum diajukan.
  /**
   * Dua tab, bukan tiga - dan "detail" BUKAN salah satunya.
   *
   * Detail heksagon dulu jadi tab sendiri, dan itu memaksa dua hal yang
   * canggung: tab yang mati sampai ada yang dipilih, dan label "Detail
   * heksagon" yang harus dibaca padahal orang sudah tahu apa yang baru saja
   * ia klik. Sekarang detail adalah LAPISAN DI DALAM daftar, dengan tombol
   * kembali - persis pola yang sudah dikenal dari daftar-ke-rincian di mana
   * pun. Slot yang dibebaskannya dipakai Konsultan AI, yang sebelumnya
   * menggantung sebagai kolom terpisah.
   */
  /**
   * Tab awal: DAFTAR, bukan rekomendasi — walau rekomendasi inti produknya.
   *
   * Untuk tamu, "Untuk Anda" hanya bisa menawarkan formulir pendaftaran, dan
   * layar pertama yang isinya formulir adalah layar yang ditutup. Daftar lokasi
   * langsung berguna tanpa akun, dan tab rekomendasinya duduk di sebelah kiri
   * daftar - terlihat sejak detik pertama.
   *
   * Yang SUDAH punya akun dipindahkan ke rekomendasi sekali oleh efek di bawah:
   * bagi mereka daftar itu memang sudah tersedia isinya.
   */
  const [tab, setTab] = useState<'rekomendasi' | 'daftar' | 'ai'>('daftar')
  const [panelTerbuka, setPanelTerbuka] = useState(true)
  /**
   * Kompas Kuadran / Legenda: sekarang dibuka lewat tombol, tidak berdiri terus.
   *
   * Bawaannya TERBUKA. Kompas adalah tesis produk ini - orang yang baru masuk
   * harus melihatnya tanpa mencari - tapi ia juga menutupi sepetak peta, dan
   * sekarang bisa disingkirkan.
   */
  // Bawaannya TERTUTUP sejak 24 Agustus 2026 - keputusan pemilik repo: layar
  // pertama harus milik petanya. Kompas tetap satu klik jauhnya, dan tombolnya
  // duduk persis di tempat kartunya akan muncul.
  /**
   * Panel mana yang sedang terbuka di tumpukan kiri - PALING BANYAK SATU.
   *
   * Dulu masing-masing tombol memegang keadaannya sendiri, dan akibatnya
   * terlihat langsung: membuka pemilih basemap mendorong isi ke kanan, lalu
   * membuka Kompas Kuadran mendorongnya LAGI ke kanan alih-alih menutup yang
   * pertama. Dua benda mengaku menempati ruang yang sama.
   *
   * Satu nilai untuk seluruh tumpukan membuat keadaan itu mustahil dinyatakan,
   * bukan sekadar dihindari.
   */
  const [panelKiri, setPanelKiri] = useState<'tidak' | 'kartu' | 'basemap'>('tidak')
  const panelKiriTerbuka = panelKiri === 'kartu'
  const [diagram, setDiagram] = useState<DiagramKuadran | null>(null)
  const [simpul, setSimpul] = useState<SimpulTransit[]>([])
  /**
   * Layar pembuka. Bawaannya MATI - ia bukan lagi layar pertama.
   *
   * Urutan lama: pembuka -> gerbang -> peta. Tiga layar berturut-turut sebelum
   * satu heksagon pun terlihat, dan yang pertama dari ketiganya memuat sesuatu
   * yang belum tentu jadi dilihat orangnya.
   *
   * Urutan sekarang: gerbang -> pembuka -> peta. Yang berubah cuma nilai awal
   * dua state di bawah ini; sisanya - termasuk `tampil` pada PetaInteraktif -
   * sudah menuliskan syaratnya sebagai "bukan pembuka DAN bukan gerbang", jadi
   * ia tetap benar tanpa disentuh.
   *
   * Layar pembuka menahan chrome, TIDAK menahan peta. Peta tetap dipasang di
   * belakang keduanya sejak render pertama, supaya MapLibre sudah selesai
   * mengunduh gaya dan tile pertama jauh sebelum ada yang menekan "Masuk".
   */
  const [pembuka, setPembuka] = useState(false)
  /**
   * Gerbang: halaman perkenalan, dan sekarang halaman pertama.
   *
   * Ditutup lewat tombol, dan sekali ditutup tidak pernah kembali selama sesi
   * ini - halaman perkenalan yang muncul lagi setiap kali orang menutup panel
   * berhenti jadi perkenalan dan mulai jadi penghalang.
   */
  const [gerbang, setGerbang] = useState(!AWAL.masuk)
  /** Arah kompas & kemiringan peta. Tombol pelurus muncul hanya kalau miring. */
  const [arahPeta, setArahPeta] = useState({ bearing: 0, pitch: 0 })
  /** Simulasi terbuka di atas detail heksagon. Ditutup saat heksagon berganti. */
  const [simulasiTerbuka, setSimulasiTerbuka] = useState(false)
  /** Heksagon pembanding di simulasi, dipilih dengan mengklik peta. */
  const [hexBanding, setHexBanding] = useState<string | null>(null)

  /**
   * Profil rute yang sedang digambar: jalan kaki atau mobil.
   *
   * Tinggal di App, bukan di panel maupun di peta, karena KEDUANYA memakainya:
   * panel memilih dan menyebut angkanya, peta menggambar garisnya. Dua salinan
   * dari nilai yang sama adalah dua salinan yang suatu saat berselisih - dan
   * yang terlihat waktu itu garis mobil dengan keterangan jalan kaki.
   */
  const [profilRute, setProfilRute] = useState<ProfilRute>('foot-walking')

  const {
    premium,
    akun,
    terbuka,
    mintaLangganan,
    mintaMasuk,
    mintaPreferensi,
    sinyalSimpan,
    catatSimpan,
  } = useSesi()

  /**
   * Simpan lokasi lewat klik dua kali di peta.
   *
   * Penjaganya SAMA PERSIS dengan tombol "Simpan lokasi" di panel detail -
   * belum masuk diminta masuk, sudah masuk tapi belum berlangganan diminta
   * berlangganan. Disalin sengaja alih-alih dilonggarkan: kalau jalan pintas
   * ini punya syarat yang lebih longgar, "menyimpan lokasi butuh langganan"
   * berhenti benar, dan yang membuktikannya bukan uji melainkan pengguna.
   *
   * `catatSimpan()` yang membuat pinnya langsung muncul. Tanpa itu, pin baru
   * datang setelah muat ulang - dan pin yang menunggu muat ulang bukan fitur.
   */
  const simpanCepat = useCallback(
    async (h3: string) => {
      if (!akun) return mintaMasuk('Buat akun dulu untuk menyimpan lokasi.')
      if (!premium)
        return mintaLangganan('Menyimpan dan memantau lokasi bagian dari Loconomics Premium.')
      try {
        await api.pantau(h3)
        catatSimpan()
      } catch {
        // Diam di sini disengaja. Klik dua kali di peta tidak punya tempat
        // menampilkan galat, dan satu-satunya sebab yang wajar - lokasinya
        // sudah tersimpan - bukan kabar yang perlu disampaikan sebagai galat.
        // Panel detail tetap melaporkan sebabnya kalau ditekan dari sana.
      }
    },
    [akun, premium, mintaMasuk, mintaLangganan, catatSimpan],
  )
  /**
   * Baki komparasi: heksagon yang dikumpulkan untuk dibandingkan berdampingan.
   *
   * Baki, bukan langsung buka dialog. Membandingkan menuntut MINIMAL DUA, dan
   * yang kedua dipilih dengan mengklik peta - jadi harus ada tempat yang
   * menampung yang pertama sementara orangnya mencari yang kedua, dan yang
   * mengingatkan bahwa ia sedang di tengah tindakan itu.
   */
  const [baki, setBaki] = useState<string[]>([])
  const [komparasiTerbuka, setKomparasiTerbuka] = useState(false)
  const [pantauanTerbuka, setPantauanTerbuka] = useState(false)

  const tambahBaki = useCallback((h3: string) => {
    setBaki((b) => {
      if (b.includes(h3)) return b.filter((x) => x !== h3)
      if (b.length >= MAKS_BANDING) return b
      // Heksagon PERTAMA yang masuk baki menutup panel kanan. Yang kedua harus
      // dipilih dari peta, dan panel selebar 25rem menutupi tepat bagian peta
      // tempat tetangga heksagon pertama berada - yaitu justru yang paling
      // masuk akal jadi pembandingnya.
      if (b.length === 0) setPanelTerbuka(false)
      return [...b, h3]
    })
  }, [])

  /**
   * Membuka simulasi = masuk mode fokus.
   *
   * Panel kanan ditutup, chip pertanyaan dan kartu Kompas disembunyikan. Bukan
   * demi kerapian: lembar simulasi menutupi separuh bawah layar, dan sisa
   * setengahnya harus berisi PETA - heksagon yang sedang disimulasikan beserta
   * tetangganya, karena membandingkannya bagian dari pekerjaannya. Chrome yang
   * tetap berdiri di situ cuma menyisakan sepetak peta yang terlalu sempit
   * untuk itu.
   */
  const bukaSimulasi = useCallback(() => {
    // Simulasi usaha BERBAYAR sejak 24 Agustus 2026. Penjaga backend-nya di
    // /hex/{h3}/simulasi; yang di sini cuma pintunya - non-pelanggan diarahkan
    // ke dialog langganan alih-alih ke lembar yang seluruh permintaannya 401.
    if (!premium && !(hexTerpilih && terbuka.has(hexTerpilih))) {
      if (akun) mintaLangganan('Simulasi usaha bagian dari Loconomics Premium.')
      else mintaMasuk('Buat akun dulu untuk menjalankan simulasi usaha.')
      return
    }
    setSimulasiTerbuka(true)
    setPanelTerbuka(false)
  }, [premium, terbuka, hexTerpilih, akun, mintaLangganan, mintaMasuk])
  const peta = useRef<AksiPetaRef>(null)

  const tutupPembuka = useCallback(() => setPembuka(false), [])

  /**
   * Kembali ke halaman perkenalan, atas permintaan eksplisit penggunanya.
   *
   * Penanda sesi ikut DIHAPUS. Tanpa itu, refresh berikutnya membacanya dan
   * melempar orangnya kembali ke peta - persis kebalikan dari yang baru saja
   * ia minta.
   */
  const keLanding = useCallback(() => {
    setGerbang(true)
    setHexTerpilih(null)
    setSimulasiTerbuka(false)
    tulisSesiMasuk(false)
  }, [])

  /**
   * Menekan "Masuk" di gerbang: gerbang pergi, layar pembuka mengambil alih.
   *
   * Keduanya disetel dalam satu penangan, jadi tidak pernah ada satu bingkai
   * pun di mana keduanya mati bersamaan - dan satu bingkai saja sudah cukup
   * untuk memperlihatkan peta secara kilat sebelum tirainya turun.
   *
   * `pilihan` datang dari dek kartu peta di gerbang: mengklik kartu Bekasi
   * RiskRadar harus membuka Bekasi dengan RiskRadar, bukan membuka keadaan
   * bawaan lalu meninggalkan orangnya mencari sendiri apa yang barusan ia lihat.
   * Petanya TIDAK diperintahkan terbang di sini - `gantiKawasan` yang biasanya
   * melakukannya butuh instance peta yang sudah hidup, sementara di sini
   * petanya masih di balik dua lapis tirai. Yang disetel cuma state-nya; peta
   * membaca `kawasan` sebagai prop dan memasang bingkainya sendiri saat muat.
   */
  const masukKePeta = useCallback((pilihan?: { kawasan: string; layer: NamaLayer }) => {
    if (pilihan) {
      setKawasan(pilihan.kawasan)
      setLayer(pilihan.layer)
      setHexTerpilih(null)
      setNHeksagon(null)
    }
    setGerbang(false)
    setPembuka(true)
  }, [])

  // Disimpan tiap kali salah satunya berubah. Ditulis di effect, bukan di
  // setiap penangan: penangannya ada belasan, dan satu yang lupa memanggil
  // penyimpan akan menghasilkan keadaan yang separuh benar setelah refresh.
  useEffect(() => {
    if (gerbang) return // masih di perkenalan; belum ada yang perlu diingat
    tulisSesiMasuk(true)
    try {
      // `masuk` sengaja TIDAK ikut ke sini. Kalau ia tertulis di localStorage,
      // orang yang membuka web besok akan melewati gerbang - dan itu persis
      // yang diminta untuk tidak terjadi.
      localStorage.setItem(KUNCI_TAMPILAN, JSON.stringify({ kawasan, layer, gaya }))
    } catch {
      // Mode privat. Sesi tetap jalan, cuma tidak selamat dari refresh.
    }
  }, [gerbang, kawasan, layer, gaya])

  /**
   * Pin lokasi tersimpan di peta - hanya untuk pelanggan.
   *
   * `sinyalSimpan` naik satu setiap kali ada yang disimpan atau dilepas, dari
   * mana pun (panel detail, dialog Tersimpan). Tanpa sinyal itu, pin baru
   * muncul setelah refresh - dan pin yang menunggu refresh bukan fitur.
   */
  useEffect(() => {
    if (gerbang) return
    if (!premium) {
      peta.current?.setPin([])
      return
    }
    let batal = false
    api
      .pantauan()
      .then((b) => {
        if (batal) return
        peta.current?.setPin(
          b
            .filter((x): x is typeof x & { lat: number; lon: number } =>
              x.lat !== null && x.lon !== null,
            )
            .map((x) => ({ lat: x.lat, lon: x.lon, h3: x.h3_index })),
        )
      })
      .catch(() => {})
    return () => {
      batal = true
    }
  }, [premium, sinyalSimpan, gerbang])

  /**
   * Preferensi onboarding diterapkan SEKALI per perubahan, bukan tiap muat.
   *
   * Menyetel kawasan setiap kali halaman dibuka akan menyeret orang kembali ke
   * kawasan preferensinya justru saat ia sengaja sedang melihat kawasan lain.
   * Yang diinginkan cuma: begitu onboarding selesai (nilainya BERUBAH),
   * petanya pindah ke sana.
   */
  /**
   * Pemilik akun mendarat di rekomendasinya, SEKALI per sesi.
   *
   * `sekali` menjaganya tetap sekali: tanpa itu, setiap kali `akun` berubah -
   * termasuk sesudah menyimpan preferensi atau membeli token - tab orangnya
   * dilempar kembali ke rekomendasi di tengah ia mengerjakan hal lain.
   */
  const sudahKeRekomendasi = useRef(false)
  useEffect(() => {
    if (!akun || sudahKeRekomendasi.current) return
    sudahKeRekomendasi.current = true
    setTab('rekomendasi')
  }, [akun])

  const prefSebelum = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    // MENUNGGU akunnya benar-benar ada sebelum mulai mencatat.
    //
    // Versi pertama memakai `undefined` sebagai penanda "belum pernah lihat",
    // tetapi render pertama sudah menjalankan efek ini dengan `akun === null`
    // (tiketnya masih divalidasi). Penandanya habis di situ, lalu begitu akun
    // mendarat, kawasan preferensi terbaca sebagai PERUBAHAN - dan heksagon
    // yang baru saja dipulihkan dari refresh ikut dibersihkan. Terukur: panel
    // detail selalu kembali ke daftar sesudah refresh.
    if (!akun) return
    const kw = akun.preferensi?.kawasan ?? null
    if (prefSebelum.current === undefined) {
      prefSebelum.current = kw // akun baru mendarat: catat saja, jangan pindahkan
      return
    }
    if (kw && kw !== prefSebelum.current) {
      setKawasan(kw)
      setHexTerpilih(null)
      setNHeksagon(null)
    }
    prefSebelum.current = kw
  }, [akun])

  const kendali = useMemo<KendaliPeta>(
    () => ({
      zoomIn: () => peta.current?.zoomIn(),
      zoomOut: () => peta.current?.zoomOut(),
      flyTo: (lat, lon, zoom) => peta.current?.flyTo(lat, lon, zoom),
      fitBounds: (kotak) => peta.current?.fitBounds(kotak),
      fokusHeksagon: (h3) => peta.current?.fokusHeksagon(h3),
      resetArah: () => peta.current?.resetArah(),
      arah: () => peta.current?.arah() ?? { bearing: 0, pitch: 0 },
      highlight: (ids) => {
        peta.current?.highlight(ids)
        if (ids.length === 1) setHexTerpilih(ids[0])
      },
      filter: (kriteria) => peta.current?.filter(kriteria),
      setPin: (d) => peta.current?.setPin(d),
      setLayer,
      setGaya,
    }),
    [],
  )

  const pilihHeksagon = useCallback(
    (h3: string | null) => {
      // Selagi simulasi terbuka, klik di peta berarti "bandingkan dengan yang
      // ini" - BUKAN "ganti subjeknya". Mengganti subjek di tengah simulasi
      // akan membuang seluruh asumsi yang baru saja disetel, dan itu justru
      // kebalikan dari yang diinginkan orang yang sedang membanding-bandingkan.
      if (simulasiTerbuka) {
        // Heksagon LAIN jadi pembanding; heksagon yang sama tidak melakukan
        // apa-apa. Yang penting: selagi mode fokus, klik di peta TIDAK PERNAH
        // menutup lembar simulasi. Versi pertama membiarkannya jatuh ke cabang
        // bawah, jadi mengklik heksagon yang sedang disimulasikan justru
        // membatalkan simulasinya - kebalikan dari yang dimaksud.
        if (h3 && h3 !== hexTerpilih) {
          setHexBanding(h3)
          peta.current?.highlight([hexTerpilih, h3].filter(Boolean) as string[])
        }
        return
      }

      // Selagi BAKI KOMPARASI terisi, klik di peta berarti "masukkan yang ini
      // juga". Tanpa cabang ini fiturnya buntu total, dan buntunya diam-diam:
      // menambahkan heksagon pertama menutup panel kanan (supaya petanya
      // terlihat), tetapi tombol "Bandingkan lokasi ini" HANYA hidup di dalam
      // panel itu. Jadi tidak ada satu pun jalan menambahkan yang kedua -
      // bakinya mentok di satu heksagon dan tombol "Bandingkan 1" mati
      // selamanya, sementara bakinya sendiri tertulis "Klik heksagon lain di
      // peta untuk membandingkan".
      //
      // Janji itu yang sekarang ditepati. Bakinya sendiri yang mengubah arti
      // klik, jadi tidak ada mode tersembunyi: selama ada yang di baki,
      // petanya memang sedang dipakai memilih pembanding.
      if (baki.length > 0 && h3) {
        // Yang SUDAH di baki cuma disorot, tidak dikeluarkan. `tambahBaki`
        // memang mengungkit, dan itu benar untuk tombol - tapi di peta, klik
        // pada heksagon yang sedang dibandingkan jauh lebih sering berarti
        // "lihat yang ini" daripada "batalkan yang ini". Yang mengeluarkan
        // tetap ada dan terlihat: tanda x di kolomnya sendiri.
        if (!baki.includes(h3)) tambahBaki(h3)
        setHexTerpilih(h3)
        peta.current?.fokusHeksagon(h3)
        return
      }

      setHexTerpilih(h3)
      setSimulasiTerbuka(false)
      setHexBanding(null)
      if (h3) {
        setTab('daftar')
        peta.current?.fokusHeksagon(h3)
      }
    },
    [simulasiTerbuka, hexTerpilih, baki, tambahBaki],
  )

  /**
   * Lepas pilihan heksagon. Satu tempat, dipakai tombol X dan tombol Esc.
   *
   * Dipisah jadi fungsi sendiri karena ia dipanggil dari tiga tempat, dan
   * versi sebelumnya menuliskan isinya sebaris di dalam onClick panel kanan -
   * jadi tombol X di peta akan jadi salinan keempat yang harus diingat untuk
   * ikut berubah.
   *
   * Ia TIDAK menyentuh baki komparasi: melepas heksagon yang sedang dilihat
   * tidak sama dengan membatalkan perbandingan yang sedang disusun.
   */
  const lepasPilihan = useCallback(() => {
    setHexTerpilih(null)
    setHexBanding(null)
    setSimulasiTerbuka(false)
    peta.current?.highlight([])
  }, [])

  /**
   * Esc melepas apa pun yang sedang terbuka, dari yang paling dalam ke luar.
   *
   * Urutannya penting: kalau simulasi terbuka, Esc menutup simulasi dan
   * MEMBIARKAN heksagonnya terpilih. Menutup keduanya sekaligus membuat satu
   * ketukan membatalkan dua keputusan, dan yang kedua tidak diminta.
   */
  useEffect(() => {
    const tekan = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Dialog menangani Esc-nya sendiri lewat portal; jangan ikut campur.
      if (document.querySelector('[role="dialog"]')) return
      if (simulasiTerbuka) {
        setSimulasiTerbuka(false)
        return
      }
      if (hexTerpilih) lepasPilihan()
    }
    window.addEventListener('keydown', tekan)
    return () => window.removeEventListener('keydown', tekan)
  }, [simulasiTerbuka, hexTerpilih, lepasPilihan])

  /**
   * Bawa kamera ke kawasan `v`. Dipisah dari `gantiKawasan` dengan sengaja.
   *
   * Kalau ia tinggal di dalam `gantiKawasan`, satu-satunya cara kamera pindah
   * adalah lewat seseorang MENGKLIK pemilih kawasan - dan kawasan yang
   * dipulihkan dari localStorage tidak pernah lewat situ. Akibatnya persis
   * jebakan basemap gelap yang sudah pernah kena: chip di bilah atas menulis
   * "Bekasi", petanya diam di Jakarta, dan layarnya kosong melompong tanpa satu
   * pun galat, karena heksagon Bekasi memang dua puluh kilometer di luar layar.
   */
  const arahkanKamera = useCallback((v: string) => {
    if (v === SEMUA_KAWASAN) {
      // Terbang ke bingkai yang memuat keenamnya. Terbang ke salah satu pusat
      // akan menyembunyikan lima kawasan lain yang justru baru saja diminta.
      peta.current?.fitBounds(BINGKAI_SEMUA)
      return
    }
    const dipilih = v
      .split(',')
      .map((n) => KAWASAN_PILOT.find((x) => x.nama === n))
      .filter((x): x is (typeof KAWASAN_PILOT)[number] => x !== undefined)
    if (!dipilih.length) return
    if (dipilih.length === 1) {
      peta.current?.flyTo(dipilih[0].pusat[1], dipilih[0].pusat[0], 14)
      return
    }
    // Beberapa kawasan sekaligus: bingkai yang memuat SEMUANYA. Tanpa ini peta
    // diam di tempat saat kawasan kedua ditambahkan - dan Bekasi ke Depok Baru
    // berjarak dua puluh kilometer, jadi separuh yang baru saja diminta berada
    // di luar layar tanpa ada yang memberi tahu.
    const lon = dipilih.map((k) => k.pusat[0])
    const lat = dipilih.map((k) => k.pusat[1])
    const bantal = 0.02 // ±2 km, supaya heksagon tepi tidak menempel bingkai
    peta.current?.fitBounds([
      Math.min(...lon) - bantal,
      Math.min(...lat) - bantal,
      Math.max(...lon) + bantal,
      Math.max(...lat) + bantal,
    ])
  }, [])

  /**
   * Muatan heksagon PERTAMA sekaligus jadi tanda petanya sudah bisa diperintah.
   *
   * Tidak ada prop `onSiap`, dan menambahnya cuma untuk ini berarti satu jalur
   * lagi yang harus dijaga tetap benar. Datangnya heksagon sudah membuktikan
   * hal yang sama - peta ada, gayanya termuat, sumbernya terpasang - dan ia
   * datang tepat sekali per kawasan.
   */
  const kameraAwal = useRef(false)
  const catatMuat = useCallback(
    (n: number) => {
      setNHeksagon(n)
      if (!kameraAwal.current) {
        kameraAwal.current = true
        arahkanKamera(kawasan)
      }
    },
    [arahkanKamera, kawasan],
  )


  const gantiKawasan = useCallback(
    (v: string) => {
      setKawasan(v)
      setHexTerpilih(null)
      setNHeksagon(null)
      setTab('daftar')
      arahkanKamera(v)
    },
    [arahkanKamera],
  )

  // Seluruh simpul transit, untuk pencarian. Diminta sekali seumur sesi:
  // jumlahnya puluhan dan tidak berubah selama demo.
  useEffect(() => {
    let batal = false
    api
      .simpulTransit()
      .then((s) => !batal && setSimpul(s))
      .catch(() => !batal && setSimpul([]))
    return () => {
      batal = true
    }
  }, [])

  // Titik kuadran diminta sekali per kawasan, bukan saat diagram penuh dibuka.
  //
  // Percobaan pertama menundanya sampai modal dibuka, dan itu salah: Kompas kecil
  // memakai data yang sama untuk menaruh titik heksagon terpilih, jadi titiknya
  // tidak pernah muncul sampai seseorang kebetulan membuka diagram penuh dulu.
  // Satu permintaan per kawasan, dipakai dua tempat, dan backend sudah men-cache-nya.
  useEffect(() => {
    let batal = false
    setDiagram(null)
    api
      .diagramKuadran({ kawasan, limit: 2000 })
      .then((d) => !batal && setDiagram(d))
      .catch(() => !batal && setDiagram(null))
    return () => {
      batal = true
    }
  }, [kawasan])

  // Posisi heksagon terpilih di dalam Kompas kecil.
  const posisi = useMemo(() => {
    const t = diagram?.titik.find((x) => x.h3_index === hexTerpilih)
    return t ? { x: t.x_prestise, y: t.y_peluang, kuadran: t.kuadran } : null
  }, [diagram, hexTerpilih])

  const pakaiKompas = LAYER_KUADRAN.includes(layer)

  /**
   * Sumbu datar diagram ini berdiri di atas bahan apa.
   *
   * Ikut TERSARING KAWASAN, karena backend menghitungnya dari titik yang
   * dikembalikan - keterangan sumbu harus menerangkan diagram yang sedang
   * dilihat orangnya, bukan basis data seluruhnya. Larik kosong = kelima
   * bahannya terukur dan tidak ada yang perlu dinyatakan.
   */
  const frasaSumbuX = useMemo(
    () => frasaPrestise(diagram?.cakupan_prestise, 'wilayah'),
    [diagram],
  )

  /**
   * Skor ringkas untuk bar komparasi, diambil dari titik kuadran yang SUDAH
   * dimuat. Tidak ada permintaan tambahan: bar cuma perlu angka dan kuadran,
   * dan keduanya sudah ada di tangan sejak Kompas dimuat.
   */
  const ringkasBaki = useMemo(() => {
    const m = new Map<
      string,
      { kawasan: string; skor: number | null; kuadran: NamaKuadran | null }
    >()
    for (const t of diagram?.titik ?? []) {
      m.set(t.h3_index, { kawasan: t.kawasan, skor: t.y_peluang, kuadran: t.kuadran })
    }
    return m
  }, [diagram])

  return (
    <>
      {gerbang && (
        // Fallback berwarna latar gerbang, bukan putih: kedipan putih satu
        // bingkai saat chunk-nya diunduh terbaca sebagai kerusakan.
        <Suspense fallback={<div className="fixed inset-0 z-40 bg-[#eaf6f1]" />}>
          <Gerbang onMasuk={masukKePeta} />
        </Suspense>
      )}
      {pembuka && (
        // Fallback WAJIB legap, dan alasannya sama persis dengan alasan gerbang
        // di atas - tetapi akibatnya lebih buruk, jadi sempat luput.
        //
        // `fallback={null}` berarti: selama chunk Pembuka diunduh, TIDAK ADA
        // yang menutupi layar. Gerbang sudah pergi (gerbang=false) dan chrome
        // aplikasi sudah dirender, jadi yang terlihat aplikasinya sendiri -
        // lalu layar pembuka datang belakangan dan menutupinya, lalu pergi
        // lagi. Urutan yang terbaca "peta muncul - loading - peta lagi".
        //
        // Gejalanya cuma muncul di KUNJUNGAN PERTAMA: sesudah chunk-nya
        // ter-cache, Pembuka terpasang di commit yang sama dan tidak ada
        // jendela kosong sama sekali. Itu sebabnya ia terlihat seperti
        // keanehan acak, bukan bug - dan tidak ada uji yang menangkapnya.
        //
        // Terukur pada cache dingin: jendela kosongnya 315 ms.
        <Suspense fallback={<div className="fixed inset-0 z-[100] bg-[#dff6f0]" />}>
          <Pembuka onSelesai={tutupPembuka} />
        </Suspense>
      )}

      <div
        className={`relative h-full overflow-hidden ${
          GAYA_GELAP.includes(gaya) ? 'peta-gelap' : ''
        }`}
      >
        {/* --- Lapisan 1: peta, seluruh layar ------------------------------
            Peta TIDAK dipasang selama halaman gerbang masih terbuka.

            Sebelumnya ia dipasang sejak render pertama supaya layar pembuka
            tidak perlu lama. Itu masuk akal ketika layar pembuka datang LEBIH
            DULU daripada gerbang - peta punya waktu memuat di baliknya. Sejak
            urutannya dibalik jadi gerbang -> pembuka -> peta, pemasangan dini
            itu jadi sisa yang tidak lagi membeli apa pun: satu konteks WebGL,
            708 heksagon, dan seluruh ubinnya hidup dan menggambar selama
            orangnya membaca halaman perkenalan yang panjang.

            Sekarang ia lahir bersamaan dengan layar pembuka - dan layar pembuka
            memang untuk itu. Keempat langkahnya nyata (menghubungi mesin data,
            menyiapkan basemap MAPID, memuat tipografi, menyusun grid) dan
            ditahan minimal 2,4 detik; petanya memuat persis di jendela itu.

            Wadahnya TETAP ada supaya tata letak tidak berubah saat isinya
            muncul. */}
        <div className="absolute inset-0">
          {!gerbang && (
          <Suspense fallback={null}>
          <PetaInteraktif
            ref={peta}
            kawasan={kawasan}
            layer={layer}
            gaya={gaya}
            terpilih={hexTerpilih}
            saringKuadran={saringKuadran}
            dibandingkan={baki}
            onPilihHeksagon={pilihHeksagon}
            onSimpanCepat={simpanCepat}
            profilRute={profilRute}
            onMuat={catatMuat}
            // Gelombang heksagon menunggu GERBANG juga, bukan cuma layar
            // pembuka. Kalau tidak, ia habis diputar di balik halaman
            // perkenalan dan penonton tidak pernah melihatnya - persis jebakan
            // yang sama yang dulu terjadi dengan layar pembuka.
            tampil={!pembuka && !gerbang}
            onArah={(a) =>
              setArahPeta((p) =>
                // Dibandingkan dulu: `rotate` menyala tiap bingkai selama peta
                // diseret, dan menyetel state tiap bingkai berarti me-render
                // seluruh chrome 60 kali per detik untuk dua angka yang sama.
                Math.abs(p.bearing - a.bearing) < 0.5 && Math.abs(p.pitch - a.pitch) < 0.5 ? p : a,
              )
            }
          />
          </Suspense>
          )}
        </div>

        {/* --- Lapisan 2: chrome melayang -----------------------------------
            Lapisannya sendiri tidak menerima klik; hanya panel di dalamnya.
            Tanpa ini, seluruh peta jadi mati tersentuh oleh sebuah div kosong
            setinggi layar. */}
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col gap-3 p-3 sm:gap-4 sm:p-4">
          {/* --- Bilah atas ------------------------------------------------ */}
          <header className="kaca pointer-events-auto relative z-30 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2.5 rounded-lg px-4 py-2.5 sm:px-5">
            {/* Tombol pulang BERDIRI SENDIRI di sebelah kiri logo, selalu
                terlihat. Versi sebelumnya menyembunyikannya di dalam logo dengan
                panah yang baru muncul saat disorot - dan tidak ada yang menyorot
                logo untuk mencari jalan pulang. Pintu yang harus ditemukan dulu
                bukan pintu. */}
            <button
              onClick={keLanding}
              title="Kembali ke halaman perkenalan"
              aria-label="Kembali ke halaman perkenalan"
              className="group grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full border border-line text-ink-2 transition-all duration-300 ease-jelly hover:-translate-x-0.5 hover:border-line-2 hover:text-ink"
            >
              <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden>
                <path
                  d="M11.5 4.5 6 10l5.5 5.5"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <div className="flex shrink-0 items-baseline gap-2.5">
              <PapanNama teks="Loconomics" />
            </div>

            <Cari
              simpul={simpul}
              onPilihKawasan={gantiKawasan}
              onPilihSimpul={(s) => {
                if (s.kawasan !== kawasan) gantiKawasan(s.kawasan)
                peta.current?.flyTo(s.lat, s.lon, 15)
              }}
              onPilihHeksagon={(h3) => {
                setHexTerpilih(h3)
                setTab('daftar')
                setPanelTerbuka(true)
                peta.current?.highlight([h3])
              }}
            />

            <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
              <MenuKawasan nilai={kawasan} onUbah={gantiKawasan} />
              <Menu
                label="Layer"
                nilai={layer}
                opsi={Object.entries(LAYER).map(([k, l]) => ({
                  nilai: k as NamaLayer,
                  label: l.nama,
                }))}
                onUbah={setLayer}
              />
              {/* Tombol "Lokasi tersimpan" pindah ke tumpukan kiri di atas
                  peta, sesumbu dengan pemilih basemap. Lihat alasannya di sana. */}
              <MenuPengaturan />
              {/* Pemisah tipis: akun bukan pengaturan peta, dan tanpa jeda
                  visual keduanya terbaca sebagai satu kelompok tombol. */}
              <span className="mx-0.5 hidden h-6 w-px shrink-0 bg-line sm:block" aria-hidden />
              <TombolAkun />
            </div>
          </header>

          <div className="flex min-h-0 flex-1 gap-4">
            {/* --- Kolom kiri -----------------------------------------------
                pb-[42px] menyisakan baris skala + atribusi MapLibre di kiri
                bawah. Angkanya dikunci oleh .maplibregl-ctrl-bottom-left di
                index.css; kedua sisi angka ajaib ini ada di repo yang sama. */}
            <div className="flex min-h-0 flex-1 flex-col gap-3 pb-[42px]">
              {/* Baris bawah: legenda di kiri, tombol melayang di kanan, dan
                  pertanyaan layer TEPAT di tengah.

                  Percobaan pertama memakai left-50% + translate — tengah
                  sungguhan terhadap kolom peta. Itu salah begitu kolom Konsultan
                  AI dibuka: kolom petanya menyempit, titik tengahnya bergeser ke
                  kiri, dan chip-nya menabrak kartu Kompas.

                  Yang dipakai sekarang tengah terhadap RUANG YANG TERSISA di
                  antara legenda dan tombol. Sedikit bergeser dari tengah optis
                  saat kedua sisinya berbeda lebar, tapi ia tidak pernah bisa
                  menimpa apa pun — dan chip yang menutupi legenda jauh lebih
                  buruk daripada chip yang meleset beberapa piksel. */}
              <div className="relative mt-auto flex items-end justify-between gap-4">
                {/* Kartu Kompas/Legenda - anak flex, BUKAN elemen melayang.
                    Sebagai elemen melayang ia menimpa chip pertanyaan di
                    belakangnya; sebagai anak flex, membukanya mendorong chip ke
                    kanan dengan sendirinya dan tidak ada yang bisa bertumpuk. */}
                <div
                  className="kolom-kartu order-2 overflow-hidden"
                  data-buka={panelKiriTerbuka && !simulasiTerbuka}
                  style={
                    {
                      '--lebar-kartu': panelKiriTerbuka && !simulasiTerbuka ? '17rem' : '0rem',
                      '--geser-kartu': panelKiriTerbuka && !simulasiTerbuka ? '0rem' : '-1rem',
                      '--opasitas-kartu': panelKiriTerbuka && !simulasiTerbuka ? 1 : 0,
                    } as CSSProperties
                  }
                  aria-hidden={!panelKiriTerbuka}
                >
                  <div className="pointer-events-auto w-[17rem]">
                    {pakaiKompas ? (
                      <KompasKuadran
                        saring={saringKuadran}
                        onSaring={setSaringKuadran}
                        posisi={posisi}
                        batas={diagram ? { x: diagram.batas_x, y: diagram.batas_y } : undefined}
                        onBukaPenuh={() => setKuadranPenuh(true)}
                      />
                    ) : (
                      <Legenda key={kawasan} layer={layer} kawasan={kawasan} />
                    )}
                  </div>
                </div>

                <div
                  className={`pointer-events-none order-3 flex min-w-0 flex-1 justify-center pb-0.5 transition-opacity duration-300 ${
                    simulasiTerbuka ? 'opacity-0' : 'opacity-100'
                  }`}
                >
                  {baki.length > 0 ? (
                    /* Baki berisi: seluruh slot tengah jadi milik komparasi.
                       Ajakan simulasi sengaja MENGHILANG, bukan mengecil -
                       keduanya menjawab pertanyaan yang berbeda, dan dua ajakan
                       berdampingan memaksa orang memilih dulu sebelum
                       mengerjakan apa pun. */
                    <BarKomparasi
                      baki={baki}
                      skor={ringkasBaki}
                      onLepas={tambahBaki}
                      onKosongkan={() => setBaki([])}
                      onBuka={() => setKomparasiTerbuka(true)}
                      onSorot={(h3) => {
                        setHexTerpilih(h3)
                        peta.current?.fokusHeksagon(h3)
                      }}
                    />
                  ) : hexTerpilih ? (
                    /* Heksagon sudah dipilih: pertanyaan layer berhenti relevan
                       - pertanyaannya sekarang "kalau saya buka usaha DI SINI,
                       jadinya bagaimana", dan bar ini pintunya. Premium; yang
                       belum diarahkan ke dialog langganan oleh bukaSimulasi.

                       Di sebelahnya tombol BATAL, dan ia ada karena membatalkan
                       pilihan praktis mustahil sebelum ini. Jalan keluarnya cuma
                       satu: tombol "Kembali ke daftar lokasi" di dalam panel
                       kanan - panel yang BISA DILIPAT, dan yang memang dilipat
                       orang supaya petanya terlihat. Begitu dilipat, satu-satunya
                       cara melepas heksagon adalah mengklik heksagon lain, yang
                       bukan melepas melainkan mengganti.

                       Keluarga jebakan yang sama dengan baki komparasi yang
                       buntu: aksi yang hidup HANYA di dalam wadah yang bisa
                       disembunyikan sama dengan aksi yang tidak ada. */
                    <div className="pointer-events-auto flex max-w-full items-center gap-2">
                    <button
                      onClick={bukaSimulasi}
                      className="group flex w-fit min-w-0 cursor-pointer items-center gap-3 rounded-full bg-ink px-5 py-2.5 text-surface shadow-lg transition-transform duration-300 ease-jelly hover:scale-[1.03]"
                    >
                      <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden className="shrink-0">
                        <path
                          d="M3 15.5 7.5 10l3 2.5L17 5.5"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path d="M12.8 5h4.2v4.2" stroke="currentColor" strokeWidth="1.9" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="truncate text-[13.5px] font-semibold">
                        Simulasi usaha di lokasi ini
                      </span>
                      {!premium && (
                        <span className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                          Premium
                        </span>
                      )}
                      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="shrink-0 transition-transform duration-200 group-hover:translate-x-0.5">
                        <path d="M4 1.5 8.5 6 4 10.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button
                      onClick={lepasPilihan}
                      title="Lepas pilihan (Esc)"
                      aria-label="Lepas pilihan heksagon"
                      className="kaca grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-2 transition-colors duration-200 hover:bg-surface-2 hover:text-ink"
                    >
                      <svg width="15" height="15" viewBox="0 0 14 14" aria-hidden>
                        <path
                          d="M2.5 2.5 11.5 11.5M11.5 2.5 2.5 11.5"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                    </div>
                  ) : (
                  <div className="kaca pointer-events-auto flex w-fit max-w-full items-center gap-3 rounded-full px-4 py-2">
                    <span className="truncate text-[13.5px] text-ink-2">
                      {LAYER[layer].pertanyaan}
                    </span>
                    {nHeksagon !== null && (
                      <span className="tabular shrink-0 border-l border-line pl-3 text-[12.5px] text-ink-3">
                        {nHeksagon.toLocaleString('id-ID')} heksagon
                      </span>
                    )}
                  </div>
                  )}
                </div>


                {/* --- Tombol melayang: zoom + basemap + konsultan AI ------
                    Wadahnya WAJIB punya position selain static, supaya kartu AI
                    bisa digantung tepat di atas tombolnya tanpa koordinat tetap.

                    Dulu di sini tertulis `lg:static`, dan itu bug: di layar
                    >=1024px wadahnya berhenti jadi konteks posisi, jadi kartu AI
                    naik menempel ke lapisan chrome setinggi layar. `bottom:
                    calc(100% + 12px)` dari situ menaruhnya di y = -428px - klik
                    tombolnya dan tidak ada apa pun yang terlihat muncul.
                    `relative` ikut alur normal persis seperti `static`, bedanya
                    cuma ia tetap jadi jangkar. */}
                <div className="pointer-events-auto absolute bottom-[calc(56%+0.75rem)] left-0 z-30 order-1 flex flex-col items-start gap-2 lg:relative lg:bottom-auto lg:left-auto lg:mr-auto">
                  <div className="kaca flex flex-col overflow-hidden rounded-full">
                    <button
                      onClick={() => peta.current?.zoomIn()}
                      aria-label="Perbesar peta"
                      title="Perbesar"
                      className="grid h-10 w-11 cursor-pointer place-items-center text-[17px] leading-none transition-colors hover:bg-surface-2/70"
                    >
                      +
                    </button>
                    <span className="mx-2.5 h-px bg-line" />
                    <button
                      onClick={() => peta.current?.zoomOut()}
                      aria-label="Perkecil peta"
                      title="Perkecil"
                      className="grid h-10 w-11 cursor-pointer place-items-center text-[17px] leading-none transition-colors hover:bg-surface-2/70"
                    >
                      −
                    </button>
                  </div>

                  {/* Pelurus peta. Muncul HANYA kalau peta sedang diputar atau
                      dimiringkan - klik-kanan-seret di MapLibre memutar peta, dan
                      orang yang tidak sengaja melakukannya sering tidak tahu cara
                      mengembalikannya. Tombol yang selalu ada akan memakan satu
                      slot permanen untuk keadaan yang jarang terjadi; yang muncul
                      saat dibutuhkan menjelaskan dirinya sendiri lewat kemunculannya. */}
                  {(Math.abs(arahPeta.bearing) > 0.5 || arahPeta.pitch > 0.5) && (
                    <button
                      onClick={() => peta.current?.resetArah()}
                      aria-label="Kembalikan arah peta ke utara"
                      title="Kembalikan arah peta ke utara"
                      className="pop grid h-12 w-12 shrink-0 cursor-pointer place-items-center rounded-full bg-ink text-surface shadow-[0_12px_30px_-10px_rgb(22_33_28/0.7)] transition-transform duration-200 ease-jelly hover:scale-[1.06]"
                    >
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 20 20"
                        aria-hidden
                        className="transition-transform duration-300 ease-liquid"
                        style={{ transform: `rotate(${-arahPeta.bearing}deg)` }}
                      >
                        <path d="M10 2.4 13.2 12 10 10.1 6.8 12Z" fill="currentColor" />
                        <path
                          d="M10 10.1 13.2 12 10 17.6 6.8 12Z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  )}

                  {/* Pemilih basemap. Urutannya dari atas: zoom, basemap,
                      konsultan AI - tiga tombol bulat sesumbu di tepi kanan.
                      Ia tidak lagi jadi dropdown di bilah atas: memilih tampilan
                      peta adalah tindakan DI peta, dan tempatnya dekat tangan
                      yang sedang menggeser peta itu. */}
                  {/* Lokasi tersimpan. Tempatnya DI SINI, sesumbu dengan
                      pemilih basemap dan pembuka Kompas, bukan lagi di bilah
                      atas: ketiganya tindakan DI peta, dan tangan yang sedang
                      menggeser peta tidak perlu naik ke ujung layar untuk satu
                      di antaranya.

                      Ia membuka DIALOG, bukan panel yang memanjang, jadi ia
                      tidak ikut ke dalam `panelKiri` - tetapi ia tetap menutup
                      apa pun yang sedang terbuka di tumpukan ini. Dialog yang
                      terbit di atas panel yang masih menganga terbaca sebagai
                      dua hal yang sama-sama aktif. */}
                  <button
                    onClick={() => {
                      setPanelKiri('tidak')
                      setPantauanTerbuka(true)
                    }}
                    title="Lokasi tersimpan dan dinamika kawasan"
                    aria-label="Lokasi tersimpan"
                    className="grid h-12 w-12 shrink-0 cursor-pointer place-items-center rounded-full bg-ink text-surface shadow-[0_12px_30px_-10px_rgb(22_33_28/0.7)] transition-transform duration-200 ease-jelly hover:scale-[1.06]"
                  >
                    <svg width="19" height="19" viewBox="0 0 20 20" aria-hidden>
                      <path d="M5.5 3.5h9V17L10 13.6 5.5 17Z" fill="currentColor" />
                    </svg>
                  </button>

                  <PilihBasemap
                    arah="kanan"
                    nilai={gaya}
                    opsi={Object.entries(GAYA_BASEMAP).map(([k, g]) => ({
                      nilai: k as NamaGaya,
                      label: g.label,
                    }))}
                    onUbah={setGaya}
                    buka={panelKiri === 'basemap'}
                    onBuka={(v) => setPanelKiri(v ? 'basemap' : 'tidak')}
                  />

                  {/* Pembuka Kompas Kuadran / Legenda. Ikonnya IKUT ISI yang
                      dibukanya: grid 2x2 untuk Kompas, tumpukan baris untuk
                      legenda. Tombol yang ikonnya tetap sama padahal isinya
                      bertukar akan membuat orang mengira ia rusak. */}
                  <button
                    onClick={() => setPanelKiri((v) => (v === 'kartu' ? 'tidak' : 'kartu'))}
                    aria-expanded={panelKiriTerbuka}
                    aria-label={`${panelKiriTerbuka ? 'Tutup' : 'Buka'} ${pakaiKompas ? 'Kompas Kuadran' : 'legenda'}`}
                    title={pakaiKompas ? 'Kompas Kuadran' : 'Legenda layer'}
                    className={`grid h-12 w-12 shrink-0 cursor-pointer place-items-center rounded-full transition-transform duration-200 ease-jelly hover:scale-[1.06] ${
                      panelKiriTerbuka
                        ? 'kaca text-ink'
                        : 'bg-ink text-surface shadow-[0_12px_30px_-10px_rgb(22_33_28/0.7)]'
                    }`}
                  >
                    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
                      {pakaiKompas ? (
                        <>
                          <rect x="2.6" y="2.6" width="6.4" height="6.4" rx="1.3" fill="none" stroke="currentColor" strokeWidth="1.6" />
                          <rect x="11" y="2.6" width="6.4" height="6.4" rx="1.3" fill="currentColor" />
                          <rect x="2.6" y="11" width="6.4" height="6.4" rx="1.3" fill="none" stroke="currentColor" strokeWidth="1.6" />
                          <rect x="11" y="11" width="6.4" height="6.4" rx="1.3" fill="none" stroke="currentColor" strokeWidth="1.6" />
                        </>
                      ) : (
                        <>
                          <circle cx="4.4" cy="5" r="1.9" fill="currentColor" />
                          <circle cx="4.4" cy="11.6" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.5" />
                          <path d="M9 5h8M9 11.6h8M9 16.4h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        </>
                      )}
                    </svg>
                  </button>

                </div>
              </div>
            </div>

            {/* --- Panel kanan ---------------------------------------------
                Di bawah 1024px ia jadi lembar bawah, bukan kolom: panel selebar
                25rem di layar 900px menyisakan peta yang terlalu sempit untuk
                membandingkan heksagon — dan membandingkan heksagon adalah
                seluruh gunanya peta ini. */}
            <aside
              data-buka={panelTerbuka}
              aria-hidden={!panelTerbuka}
              className="kolom-geser melayang absolute inset-x-0 bottom-0 h-[56%] min-h-0 lg:static lg:h-auto"
              style={
                {
                  '--lebar-kolom': panelTerbuka ? '25rem' : '0rem',
                  '--geser-kolom': panelTerbuka ? '0rem' : '-1rem',
                  '--opasitas-kolom': panelTerbuka ? 1 : 0,
                } as CSSProperties
              }
            >
              <div className="kaca-tebal flex h-full w-full flex-col overflow-hidden rounded-lg lg:w-[25rem]">
                <div className="flex shrink-0 items-center gap-1 p-2">
                  {(
                    [
                      // "Untuk Anda" duluan, dan ia yang terbuka pertama:
                      // rekomendasi adalah inti produk ini, dan tab yang harus
                      // dicari dulu bukan inti.
                      ['rekomendasi', 'Untuk Anda'],
                      ['daftar', 'Daftar lokasi'],
                      ['ai', 'Loconomics AI'],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => setTab(k)}
                      aria-current={tab === k ? 'page' : undefined}
                      className={`flex-1 cursor-pointer rounded-full px-2.5 py-2.5 text-[12.5px] font-semibold transition-all duration-300 ease-liquid ${
                        tab === k
                          ? 'bg-ink text-surface shadow-[0_6px_16px_-6px_rgb(22_33_28/0.6)]'
                          : 'text-ink-3 hover:bg-surface-2 hover:text-ink-2'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    onClick={() => setPanelTerbuka(false)}
                    aria-label="Lipat panel"
                    title="Lipat panel"
                    className="ml-1 grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden>
                      <path
                        d="M4 1.5 8.5 6 4 10.5"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        fill="none"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-hidden border-t border-line/70">
                  {tab === 'rekomendasi' && (
                    <Suspense fallback={null}>
                      <Rekomendasi
                        onPilih={(h3) => {
                          setHexTerpilih(h3)
                          setTab('daftar')
                          peta.current?.fokusHeksagon(h3)
                        }}
                        onBukaAkun={mintaPreferensi}
                      />
                    </Suspense>
                  )}

                  {tab !== 'ai' && tab !== 'rekomendasi' && (
                    // Detail adalah LAPISAN DI ATAS daftar, bukan penggantinya.
                    //
                    // Percobaan pertama mengganti isinya, dan daftar jadi
                    // dicabut tiap kali detail dibuka - kembali dari detail lalu
                    // berarti meminta ulang seluruh 112 baris dan kehilangan
                    // posisi gulir. Ditumpuk, daftarnya tetap hidup di
                    // belakangnya dan kembali terasa seketika.
                    <div className="relative h-full min-h-0">
                      <div className="h-full min-h-0">
                        <DaftarLokasi
                          key={`${kawasan}-${layer}`}
                          layer={layer}
                          kawasan={kawasan}
                          terpilih={hexTerpilih}
                          onPilih={(h3) => {
                            setHexTerpilih(h3)
                            setSimulasiTerbuka(false)
                            setHexBanding(null)
                            peta.current?.highlight([h3])
                            peta.current?.fokusHeksagon(h3)
                          }}
                        />
                      </div>

                      {hexTerpilih && (
                        <div className="masuk-kanan absolute inset-0 z-10 flex flex-col bg-surface">
                          <button
                            onClick={lepasPilihan}
                            className="flex shrink-0 cursor-pointer items-center gap-2 border-b border-line/70 px-4 py-2.5 text-left text-[13px] font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                          >
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 12 12"
                              aria-hidden
                              className="shrink-0"
                            >
                              <path
                                d="M7.5 1.5 3 6l4.5 4.5"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                fill="none"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                            Kembali ke daftar lokasi
                          </button>
                          <div className="min-h-0 flex-1 overflow-hidden">
                            <PanelInsight
                              h3={hexTerpilih}
                              profilRute={profilRute}
                              onGantiProfil={setProfilRute}
                              posisi={posisi}
                              batas={
                                diagram ? { x: diagram.batas_x, y: diagram.batas_y } : undefined
                              }
                              onBukaKuadran={() => setKuadranPenuh(true)}
                              onBukaSimulasi={bukaSimulasi}
                              onBandingkan={tambahBaki}
                              sedangDibandingkan={baki.includes(hexTerpilih)}
                            />
                          </div>

                        </div>
                      )}
                    </div>
                  )}

                  {/* PanelAI SELALU dimuat, sekalipun tab yang aktif bukan
                      'ai' - dibuktikan bug sebelum diperbaiki 4 Sep 2026: panel
                      ini hidup di dalam TERNARY tiga cabang, jadi berpindah ke
                      "Untuk Anda" atau "Daftar lokasi" MELEPAS komponennya dari
                      DOM. React membuang seluruh state lokalnya seketika itu -
                      riwayat percakapan, teks yang sedang diketik, semuanya -
                      dan begitu orang kembali ke tab AI, `PanelAI` dipasang
                      ULANG dari nol, kosong.

                      Diperbaiki dengan pola yang SAMA dengan detail-di-atas-
                      daftar tepat di bawah ini: tetap terpasang, disembunyikan
                      lewat CSS (`hidden`, bukan pelepasan komponen) saat bukan
                      gilirannya. `terbuka` tetap `true` - itu keadaan "terbuka"
                      MILIK PANELNYA SENDIRI, terpisah dari tab mana yang
                      sedang dilihat orang. */}
                  <div className={tab === 'ai' ? 'h-full min-h-0' : 'hidden'}>
                    <PanelAI
                      kendali={kendali}
                      hexTerpilih={hexTerpilih}
                      layerAktif={layer}
                      terbuka
                      onLipat={() => setTab('daftar')}
                    />
                  </div>
                </div>
              </div>
            </aside>

            {!panelTerbuka && (
              <button
                onClick={() => setPanelTerbuka(true)}
                className="kaca pop pointer-events-auto absolute bottom-0 right-0 flex cursor-pointer items-center gap-2 rounded-full px-4 py-2.5 text-[13.5px] font-semibold transition-transform duration-200 ease-jelly hover:scale-105 lg:static lg:h-full lg:flex-col lg:justify-center lg:rounded-lg lg:px-2.5 lg:py-4 lg:hover:scale-100"
                aria-label="Buka panel daftar lokasi"
                title="Buka panel"
              >
                <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden className="shrink-0">
                  <path
                    d="M8 1.5 3.5 6 8 10.5"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="lg:[writing-mode:vertical-rl] lg:rotate-180 lg:tracking-[0.08em]">
                  Daftar lokasi
                </span>
              </button>
            )}
          </div>

          {/* --- Lembar simulasi ------------------------------------------
              Dipasang di dalam lapisan chrome tapi menembus bantalannya lewat
              `-mx-3`/`-mb-3`: lembar ini memang harus menempel tepi layar dari
              kiri ke kanan, sementara seluruh panel lain melayang dengan jarak.
              Itu bukan ketidakkonsistenan - lembar yang melayang terbaca sebagai
              satu panel lagi di antara panel lain, dan yang dituju justru
              sebaliknya: sekarang kita sedang mengerjakan SATU hal. */}
          {simulasiTerbuka && hexTerpilih && (
            <Suspense fallback={null}>
            <Simulasi
              h3={hexTerpilih}
              h3Banding={hexBanding}
              onLepasBanding={() => {
                setHexBanding(null)
                peta.current?.highlight([hexTerpilih])
              }}
              onKeDetail={() => {
                setSimulasiTerbuka(false)
                setHexBanding(null)
                setPanelTerbuka(true)
              }}
              onTutup={() => {
                setSimulasiTerbuka(false)
                setHexBanding(null)
                setPanelTerbuka(true)
              }}
            />
            </Suspense>
          )}

          {nHeksagon === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 lg:right-[27rem]">
              <div className="kaca-tebal pointer-events-auto melayang max-w-md rounded-lg p-6">
                <p className="papan text-[19px]">
                  Belum ada heksagon di {frasaKawasan(kawasan)}
                </p>
                <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">
                  Basis datanya sudah tersambung, tetapi kawasan ini belum berisi.
                  Jalankan pipeline sampai tahap terbit untuk mengisinya.
                </p>
                <code className="mt-3.5 block rounded-sm bg-surface-2 px-3.5 py-3 font-mono text-[13px] leading-relaxed text-ink-2">
                  cd pipeline
                  <br />
                  python s7_publish.py --muat
                </code>
              </div>
            </div>
          )}
        </div>

        {/* --- Diagram kuadran penuh --------------------------------------- */}
        {kuadranPenuh && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-6 backdrop-blur-[3px]"
            onClick={() => setKuadranPenuh(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Diagram kuadran"
          >
            {/* `overflow-auto` DICABUT. Diagram yang harus digulir untuk
                dilihat utuh sudah berhenti jadi diagram - separuh gunanya
                justru melihat keempat kuadran sekaligus. Yang mengalah sekarang
                ukuran diagramnya (min(430px, 44vh) di KompasKuadran), bukan
                keutuhannya. */}
            <div
              className="kaca-tebal melayang flex max-h-full w-[52rem] max-w-full flex-col overflow-hidden rounded-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-baseline justify-between gap-6 border-b border-line/70 px-6 py-5">
                <div>
                  <h2 className="papan text-[19px]">Diagram kuadran · {kawasan}</h2>
                  <p className="mt-1 max-w-[42ch] text-[13.5px] leading-snug text-ink-2">
                    Sumbu datar: bagaimana lokasi terlihat. Sumbu tegak: apa kata
                    datanya. Gunanya produk ini ada di dua sudut tempat keduanya
                    tidak sejalan.
                  </p>
                </div>
                <button
                  onClick={() => setKuadranPenuh(false)}
                  className="shrink-0 cursor-pointer rounded-full border border-line px-4 py-1.5 text-[13.5px] font-medium transition-colors hover:bg-surface-2"
                >
                  Tutup
                </button>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-5 p-6 lg:flex-row lg:items-start">
                <KompasKuadran
                  besar
                  saring={saringKuadran}
                  onSaring={setSaringKuadran}
                  sebar={diagram?.titik}
                  batas={diagram ? { x: diagram.batas_x, y: diagram.batas_y } : undefined}
                  onPilih={(h3) => {
                    setHexTerpilih(h3)
                    setKuadranPenuh(false)
                  }}
                />
                {/* Kolom kanan: penjelasan sumbu. Dipindah ke samping, bukan di
                    bawah - di bawah ia yang membuat dialognya melebihi tinggi
                    layar dan memaksa scroll. */}
                <div className="min-w-0 flex-1 lg:max-w-[19rem]">
                  <div className="rounded-md border border-line/70 bg-surface-2/60 p-4">
                    <h3 className="eyebrow mb-2">Cara membacanya</h3>
                    <p className="text-[13px] leading-relaxed text-ink-2">
                      Kuadran <strong className="font-semibold text-ink">tidak</strong> ditentukan
                      oleh Opportunity Score saja. Sumbu tegak Opportunity Score, sumbu datar prestise
                      visual, dan batas keduanya adalah <strong className="font-semibold text-ink">median</strong>{' '}
                      seluruh heksagon — bukan angka bulat.
                    </p>
                    <p className="mt-2.5 text-[13px] leading-relaxed text-ink-2">
                      Karena itu skor 58 bisa jatuh di Hidden Gem sementara 50 jatuh di Aman tapi
                      Mahal: keduanya di atas median, dan yang membedakan prestise visualnya.
                    </p>
                    {/* Sumbu datar itu SETENGAH tesis produk ini, dan sampai hari
                        ini dua dari lima bahannya kosong — termasuk keduanya yang
                        menilai tampilan secara langsung. Panel ini satu-satunya
                        tempat sumbu itu DIJELASKAN, jadi ia tempat yang benar
                        untuk menyatakannya; label sumbu di kompas tidak punya
                        ruang, dan menempelkan keterangan di sana akan mengubah
                        legenda jadi paragraf. */}
                    {frasaSumbuX.length > 0 && (
                      <div className="mt-3 space-y-1.5 border-t border-line/60 pt-2.5">
                        <p className="eyebrow">Sumbu datar berdiri di atas apa</p>
                        {frasaSumbuX.map((k) => (
                          <p key={k} className="text-[12.5px] leading-snug text-ink-3">
                            {k}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="mt-3.5 text-[12.5px] leading-snug text-ink-3">
                    {diagram
                      ? `${diagram.titik.length.toLocaleString('id-ID')} heksagon. Klik satu titik untuk membukanya. Area berzona terlarang sengaja ikut ditampilkan — ini alat analisis, bukan rekomendasi.`
                      : 'Memuat titik…'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {komparasiTerbuka && baki.length >= 2 && (
        <Suspense fallback={null}>
        <DialogKomparasi
          h3={baki}
          onTutup={() => setKomparasiTerbuka(false)}
          onPilih={(h3) => {
            setKomparasiTerbuka(false)
            setHexTerpilih(h3)
            setPanelTerbuka(true)
            peta.current?.fokusHeksagon(h3)
          }}
        />
        </Suspense>
      )}

      {pantauanTerbuka &&
        (premium ? (
          <Suspense fallback={null}>
          <DialogPantauan
            kawasan={kawasan}
            onTutup={() => setPantauanTerbuka(false)}
            onBandingkanSemua={(ids) => {
              setBaki(ids)
              setPantauanTerbuka(false)
              setKomparasiTerbuka(true)
            }}
            onPilih={(h3) => {
              setPantauanTerbuka(false)
              setHexTerpilih(h3)
              setPanelTerbuka(true)
              peta.current?.fokusHeksagon(h3)
            }}
          />
          </Suspense>
        ) : (
          <AjakanPantauan onTutup={() => setPantauanTerbuka(false)} />
        ))}
    </>
  )
}

/**
 * Yang dilihat non-pelanggan saat menekan "Pantauan".
 *
 * Dialog tersendiri, bukan DialogPantauan yang isinya ditutup tirai: panel itu
 * memanggil /akun/pantauan dan /skor/dinamika saat dipasang, dan keduanya akan
 * dijawab 401/402. Memasangnya cuma untuk memburamkan hasilnya berarti dua
 * permintaan yang sudah pasti gagal di setiap pembukaan.
 */
function AjakanPantauan({ onTutup }: { onTutup: () => void }) {
  const { akun, mintaLangganan, mintaMasuk } = useSesi()
  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-ink/45 p-6 backdrop-blur-[4px]"
      onClick={onTutup}
      role="dialog"
      aria-modal="true"
      aria-label="Lokasi tersimpan"
    >
      <div
        className="kaca-tebal melayang w-[28rem] max-w-full overflow-hidden rounded-xl p-7 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-ink text-surface">
          <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
            <path d="M6 9V6.5a4 4 0 0 1 8 0V9" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <rect x="4.5" y="9" width="11" height="7.5" rx="2" fill="currentColor" />
          </svg>
        </span>
        <h2 className="papan text-[19px]">Simpan &amp; pantau lokasi</h2>
        <p className="mx-auto mt-2 max-w-[36ch] text-[13.5px] leading-relaxed text-ink-2">
          Simpan lokasi pilihan Anda sebagai pin di peta, bekukan skornya hari ini,
          lalu lihat pergerakannya setiap kali pipeline menerbitkan versi baru —
          lengkap dengan sebaran churn kawasannya.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button
            onClick={onTutup}
            className="cursor-pointer rounded-full border border-line px-4 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-2"
          >
            Nanti saja
          </button>
          <button
            onClick={() => {
              onTutup()
              if (akun) mintaLangganan('Pemantauan bagian dari Loconomics Premium.')
              else mintaMasuk('Buat akun dulu untuk mulai memantau lokasi.')
            }}
            className="cursor-pointer rounded-full bg-ink px-5 py-2 text-[13px] font-semibold text-surface transition-transform duration-300 ease-jelly hover:scale-[1.03]"
          >
            {akun ? 'Jadi Premium' : 'Sign Up sekarang'}
          </button>
        </div>
      </div>
    </div>
  )
}
