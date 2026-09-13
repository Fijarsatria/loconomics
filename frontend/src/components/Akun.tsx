/**
 * Akun, masuk/daftar, dan Loconomics Premium.
 *
 * Satu berkas, empat hal yang memang tidak bisa dipisah tanpa merugikan:
 *
 *   SesiProvider    keadaan sesi + PEMILIK kedua dialognya
 *   TombolAkun      tombol di bilah atas (peta maupun gerbang)
 *   DialogAkun      masuk / daftar
 *   DialogLangganan langganan dan layar QRIS
 *
 * KENAPA DIALOGNYA MILIK PROVIDER, bukan milik tombol. Yang membuka dialog
 * langganan bukan cuma tombol akun: tirai di panel detail membukanya, tombol
 * unduh laporan membukanya, tombol komparasi membukanya. Kalau dialognya
 * dimiliki masing-masing, ada empat salinan yang harus sepakat soal keadaan
 * mana yang sedang terbuka. Sebagai milik provider, siapa pun cukup memanggil
 * `mintaLangganan()` dan tidak perlu tahu dialognya ada di mana.
 *
 * SATU ATURAN YANG TIDAK BOLEH DILANGGAR DI BERKAS INI: tingkat akses SELALU
 * dibaca dari respons backend (`akun.tingkat`), tidak pernah disimpulkan dari
 * "ada tiket berarti sudah bayar". Tiket membuktikan SIAPA, bukan membuktikan
 * SUDAH BAYAR - dan produk ini punya tingkat 'gratis' yang justru berdiri
 * tepat di antara keduanya.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useBahasa, useTeks } from '../lib/bahasa'

import { api, GalatAPI, setTiket, adaTiket } from '../lib/api'
import { KAWASAN_PILOT } from '../config'
import { JENIS_USAHA, KELOMPOK_JENIS } from '../lib/jenis-usaha'
import { PapanNama, useTutupHalus } from './primitif'
import type { Akun, KatalogPaket, Tingkat } from '../types'

// ---------------------------------------------------------------------------
// Konteks sesi
// ---------------------------------------------------------------------------

type AlasanKunci = string | null

interface IsiSesi {
  akun: Akun | null
  tingkat: Tingkat
  premium: boolean
  /** true selama tiket tersimpan sedang divalidasi ke backend saat memuat. */
  memuat: boolean
  masuk: (identitas: string, sandi: string) => Promise<void>
  daftar: (p: { nama_pengguna: string; email: string; sandi: string }) => Promise<void>
  keluar: () => void
  segarkan: () => Promise<void>
  /**
   * Naik satu setiap kali daftar lokasi tersimpan berubah, dari mana pun.
   * Peta memakainya untuk menyegarkan pin tanpa harus tahu SIAPA yang
   * menyimpan - panel detail dan dialog Tersimpan sama-sama menaikkannya.
   */
  sinyalSimpan: number
  catatSimpan: () => void
  /**
   * Heksagon yang SEDANG tersimpan, menurut server.
   *
   * Naik ke sini 3 September 2026 untuk memperbaiki bug yang nyata: panel
   * detail menyimpan keadaan "sudah dipantau" sebagai state LOKAL yang hanya
   * pernah disetel oleh tombolnya sendiri. Akibatnya dua-duanya salah -
   * menyimpan lewat klik dua kali di peta tidak menyalakan tombolnya (jadi
   * orang menekannya lagi dan menyimpan dua kali), dan heksagon yang tersimpan
   * di sesi sebelumnya selalu tampil sebagai "Simpan lokasi".
   *
   * Satu himpunan di provider, dibaca peta DAN panel. Keadaan yang disalin ke
   * dua tempat adalah keadaan yang suatu saat berselisih - dan di sini ia sudah
   * berselisih.
   */
  tersimpan: Set<string>
  /** Buka dialog masuk. `alasan` tampil sebagai kalimat pengantar. */
  mintaMasuk: (alasan?: AlasanKunci) => void
  /** Buka dialog langganan. Kalau belum masuk, dialog masuk yang dibuka dulu. */
  mintaLangganan: (alasan?: AlasanKunci) => void
  /**
   * Buka dialog preferensi usaha.
   *
   * Milik provider, sama alasannya dengan kedua dialog lain: yang membukanya
   * bukan satu tombol melainkan tiga - menu akun, kartu kriteria di tab "Untuk
   * Anda", dan ajakan saat preferensinya masih kosong. Tiga salinan dialog
   * berarti tiga keadaan yang harus sepakat soal mana yang sedang terbuka.
   */
  mintaPreferensi: () => void
}

const Konteks = createContext<IsiSesi | null>(null)

export function useSesi(): IsiSesi {
  const s = useContext(Konteks)
  if (!s) throw new Error('useSesi dipakai di luar <SesiProvider>')
  return s
}

type Alur =
  | { langkah: 'akun'; alasan: AlasanKunci }
  | { langkah: 'paket'; alasan: AlasanKunci; rayakan: boolean }
  | { langkah: 'usaha'; pesan: string | null; rayakan: boolean }

/** Diumumkan saat orangnya menekan "Simpan & buka peta". Didengar `App`. */
export const PERISTIWA_BUKA_PETA = 'loconomics:buka-peta'
export interface DetailBukaPeta {
  kawasan: string | null
}

export function SesiProvider({ anak }: { anak: ReactNode }) {
  const [akun, setAkun] = useState<Akun | null>(null)
  const [memuat, setMemuat] = useState(adaTiket())
  /**
   * SATU alur untuk ketiga layar - masuk/daftar, paket, dan preferensi usaha.
   *
   * Sampai 13 Sep 2026 ketiganya tiga dialog terpisah dengan tirainya sendiri,
   * jadi berpindah dari "Daftar" ke "Pilih paket" ke "Preferensi usaha" berarti
   * tirai lama lenyap dan tirai baru muncul pada bingkai yang sama: kedipan,
   * tanpa transisi apa pun. Pemilik repo melaporkannya. Sekarang tirainya satu
   * dan tetap berdiri; yang berganti cuma isinya, lewat `Panggung`.
   */
  const [alur, setAlur] = useState<Alur | null>(null)

  // Validasi tiket tersimpan, sekali saat memuat. Tiket yang kedaluwarsa atau
  // akunnya dinonaktifkan mendarat di 401 dan langsung dibuang - lebih baik
  // daripada memakai tiket mati sampai ada permintaan yang kebetulan gagal.
  useEffect(() => {
    if (!adaTiket()) {
      setMemuat(false)
      return
    }
    let batal = false
    api
      .akunSaya()
      .then((a) => {
        if (batal) return
        setAkun(a)
      })
      .catch(() => {
        if (batal) return
        setTiket(null)
        setAkun(null)
      })
      .finally(() => !batal && setMemuat(false))
    return () => {
      batal = true
    }
  }, [])

  const pakaiSesi = useCallback(
    (s: { tiket: string; akun: Akun }) => {
      setTiket(s.tiket)
      setAkun(s.akun)
    },
    [],
  )

  const masuk = useCallback(
    async (identitas: string, sandi: string) => {
      pakaiSesi(await api.masuk({ identitas, sandi }))
    },
    [pakaiSesi],
  )

  const daftar = useCallback(
    async (p: { nama_pengguna: string; email: string; sandi: string }) => {
      pakaiSesi(await api.daftar(p))
    },
    [pakaiSesi],
  )

  const keluar = useCallback(() => {
    setTiket(null)
    setAkun(null)
  }, [])

  const segarkan = useCallback(async () => {
    try {
      setAkun(await api.akunSaya())
    } catch {
      keluar()
    }
  }, [keluar])

  const [sinyalSimpan, setSinyalSimpan] = useState(0)
  const catatSimpan = useCallback(() => setSinyalSimpan((n) => n + 1), [])

  /**
   * Daftar lokasi tersimpan, disegarkan tiap kali `sinyalSimpan` naik.
   *
   * Pemantauan fitur berbayar, jadi untuk tamu dan akun gratis ia SELALU
   * himpunan kosong - dan itu benar, bukan penyembunyian: mereka memang tidak
   * punya lokasi tersimpan. Backend tetap penjaganya.
   */
  const [tersimpan, setTersimpan] = useState<Set<string>>(new Set())
  const premiumKini = akun?.tingkat === 'premium'
  useEffect(() => {
    if (!premiumKini) {
      setTersimpan(new Set())
      return
    }
    let batal = false
    api
      .pantauan()
      .then((b) => {
        if (!batal) setTersimpan(new Set(b.map((x) => x.h3_index)))
      })
      .catch(() => {})
    return () => {
      batal = true
    }
  }, [premiumKini, sinyalSimpan])

  const mintaMasuk = useCallback((alasan: AlasanKunci = null) => {
    setAlur({ langkah: 'akun', alasan })
  }, [])

  const mintaPreferensi = useCallback(
    () => setAlur({ langkah: 'usaha', pesan: null, rayakan: false }),
    [],
  )

  const mintaLangganan = useCallback(
    (alasan: AlasanKunci = null) => {
      // Belum masuk? Masuk dulu. Menampilkan etalase harga kepada orang yang
      // belum punya akun berakhir di jalan buntu: ia menekan "Bayar", lalu
      // baru diminta mendaftar, dan kehilangan konteks kenapa ia di sini.
      if (!akun) setAlur({ langkah: 'akun', alasan: alasan ?? 'Masuk dulu untuk berlangganan.' })
      else setAlur({ langkah: 'paket', alasan, rayakan: false })
    },
    [akun],
  )

  const nilai = useMemo<IsiSesi>(
    () => ({
      akun,
      tingkat: akun ? akun.tingkat : 'tamu',
      premium: akun?.tingkat === 'premium',
      memuat,
      masuk,
      daftar,
      keluar,
      segarkan,
      sinyalSimpan,
      catatSimpan,
      tersimpan,
      mintaMasuk,
      mintaLangganan,
      mintaPreferensi,
    }),
    [akun, memuat, masuk, daftar, keluar, segarkan, sinyalSimpan, catatSimpan, tersimpan, mintaMasuk, mintaLangganan, mintaPreferensi],
  )

  return (
    <Konteks.Provider value={nilai}>
      {anak}
      {alur && (
        <TiraiAlur
          kunci={alur.langkah}
          judul={alur.langkah === 'akun' ? 'Akun Loconomics' : 'Loconomics Premium'}
          // Penanda tahap hanya untuk alur PENDAFTARAN. Orang yang membuka
          // preferensi dari menu akun tidak sedang menempuh tiga langkah apa pun.
          tahap={alur.langkah === 'akun' || !alur.rayakan ? null : alur.langkah === 'paket' ? 1 : 2}
          onTutup={() => setAlur(null)}
        >
          {alur.langkah === 'akun' ? (
            <DialogAkun
              alasan={alur.alasan}
              onTutup={() => setAlur(null)}
              onBerhasil={(baru) => {
                // Sesudah MENDAFTAR, langsung tawarkan Premium - permintaan
                // eksplisit pemilik repo. Sesudah MASUK, jangan: orang yang
                // kembali ke akunnya sedang menuju sesuatu, dan etalase harga
                // di tengah jalan terbaca sebagai penghalang.
                setAlur(baru ? { langkah: 'paket', alasan: null, rayakan: true } : null)
              }}
            />
          ) : alur.langkah === 'paket' ? (
            <DialogLangganan
              alasan={alur.alasan}
              rayakan={alur.rayakan}
              onTutup={() => setAlur(null)}
              onLanjut={(pesan) => setAlur({ langkah: 'usaha', pesan, rayakan: alur.rayakan })}
            />
          ) : (
            <DialogPreferensi
              pesan={alur.pesan}
              onTutup={() => setAlur(null)}
              onSelesai={(hasil) => {
                setAlur(null)
                // "Simpan & buka peta" benar-benar MEMBUKA peta. Sebelum 13 Sep
                // 2026 tombol ini cuma menutup dialog - dari halaman gerbang
                // orangnya tetap di gerbang, dan pemilik repo melaporkannya
                // sebagai bug. Provider tidak memiliki peta, jadi ia MENGUMUMKAN;
                // App yang memiliki peta yang mendengarkan.
                if (hasil) {
                  window.dispatchEvent(
                    new CustomEvent<DetailBukaPeta>(PERISTIWA_BUKA_PETA, { detail: hasil }),
                  )
                }
              }}
            />
          )}
        </TiraiAlur>
      )}
    </Konteks.Provider>
  )
}

// ---------------------------------------------------------------------------
// Kerangka dialog
// ---------------------------------------------------------------------------

/**
 * Pembungkus dialog. `createPortal` ke body, dan itu WAJIB di repo ini.
 *
 * Bilah atas peta memakai `.kaca`, yang punya `backdrop-filter`. Elemen
 * ber-backdrop-filter menjadi containing block bagi SELURUH keturunan
 * `position: fixed` - jadi `fixed inset-0` di dalamnya berarti "sebesar bilah
 * atas", bukan "seluruh layar". Jebakan ini sudah pernah kena di repo ini dan
 * tercatat di CLAUDE.md.
 */
/**
 * Diisi `TiraiAlur`. Selama ada, `Tirai` TIDAK memasang tirainya sendiri: ia
 * cuma melaporkan lebar yang ia inginkan lalu merender isinya. Dengan begitu
 * ketiga dialog tetap ditulis seolah berdiri sendiri, dan tetap bisa dipakai
 * berdiri sendiri, sementara di dalam alur tirainya satu.
 */
const PanggungKonteks = createContext<((lebar: string) => void) | null>(null)

function Tirai({
  judul,
  onTutup,
  lebar = '34rem',
  children,
}: {
  judul: string
  onTutup: () => void
  lebar?: string
  children: ReactNode
}) {
  const lapor = useContext(PanggungKonteks)
  useEffect(() => {
    lapor?.(lebar)
  }, [lapor, lebar])
  if (lapor) return <>{children}</>
  return (
    <TiraiDasar judul={judul} onTutup={onTutup} lebar={lebar}>
      {children}
    </TiraiDasar>
  )
}

function TiraiDasar({
  judul,
  onTutup,
  lebar,
  children,
}: {
  judul: string
  onTutup: () => void
  lebar: string
  children: ReactNode
}) {
  useEffect(() => {
    const kunci = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onTutup()
    }
    document.addEventListener('keydown', kunci)
    // Halaman di belakang dialog tidak boleh ikut bergulir. Gerbang menggulir
    // di wadahnya sendiri, jadi body saja tidak cukup - tapi body-lah yang
    // menggulir di halaman peta, dan gerbang sudah menutup dialognya sendiri.
    const semula = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', kunci)
      document.body.style.overflow = semula
    }
  }, [onTutup])

  return createPortal(
    <div
      // Tirainya HITAM, bukan `bg-ink`: di tema gelap `--color-ink` adalah
      // krem-putih, dan tirai putih 45% di atas halaman gerbang yang hitam
      // mengubah seluruh layar jadi abu-abu susu - terlihat begitu di potret.
      // Tirai gelap benar di kedua tema.
      className="tirai-latar fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/55 p-4 backdrop-blur-[4px] sm:p-6"
      onClick={onTutup}
      role="dialog"
      aria-modal="true"
      aria-label={judul}
    >
      <div
        className="kaca-tebal melayang tirai-panel my-auto w-full overflow-hidden rounded-xl"
        style={{ maxWidth: lebar }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

/**
 * Tirai yang TETAP BERDIRI selama alurnya berjalan; yang berganti isinya.
 *
 * Lebarnya ikut dianimasikan (`tirai-panel` punya transisi `max-width`), jadi
 * perpindahan dari formulir daftar yang sempit ke etalase paket yang lebar
 * terbaca sebagai satu kartu yang melebar - bukan dua kartu yang bergantian.
 */
function TiraiAlur({
  kunci,
  judul,
  tahap,
  onTutup,
  children,
}: {
  kunci: string
  judul: string
  tahap: number | null
  onTutup: () => void
  children: ReactNode
}) {
  const [lebar, setLebar] = useState('26.5rem')
  return (
    <PanggungKonteks.Provider value={setLebar}>
      <TiraiDasar judul={judul} onTutup={onTutup} lebar={lebar}>
        {tahap !== null && <Tahapan aktif={tahap} />}
        <Panggung kunci={kunci}>{children}</Panggung>
      </TiraiDasar>
    </PanggungKonteks.Provider>
  )
}

/**
 * Isi lama keluar ke kiri sambil memudar, isi baru masuk dari kanan, dan tinggi
 * kartunya berpindah halus di antara keduanya.
 *
 * Isi yang KELUAR dirender ulang dari elemen yang ditangkap, dengan `key` yang
 * sama seperti saat ia masih aktif - jadi React mempertahankan komponennya,
 * lengkap dengan keadaannya, selama 300 ms ia memudar. Tanpa kunci yang sama,
 * yang memudar adalah salinan baru yang sudah lupa isiannya.
 */
function Panggung({ kunci, children }: { kunci: string; children: ReactNode }) {
  const lapor = useContext(PanggungKonteks)
  const [kunciLalu, setKunciLalu] = useState(kunci)
  const [isiLalu, setIsiLalu] = useState<ReactNode>(children)
  const [keluar, setKeluar] = useState<{ kunci: string; isi: ReactNode } | null>(null)

  // Dihitung SAAT RENDER, bukan di efek. Versi pertama memasang lapisan keluar
  // dari `useLayoutEffect`, dan itu satu komit terlambat: komit pertama sudah
  // membuang isi lama, komit kedua memasangnya lagi sebagai komponen BARU -
  // yang lupa isiannya, dan yang efeknya melaporkan lebar lama SESUDAH isi
  // baru melaporkan lebarnya. Terukur di potret: langkah preferensi tetap
  // selebar etalase paket. Menyetel keadaan saat render membuat React merender
  // ulang sebelum komit, jadi komit pertama sudah memuat kedua lapisan.
  if (kunci !== kunciLalu) {
    setKeluar({ kunci: kunciLalu, isi: isiLalu })
    setKunciLalu(kunci)
    setIsiLalu(children)
  } else if (children !== isiLalu) {
    setIsiLalu(children)
  }

  useEffect(() => {
    if (!keluar) return
    const id = window.setTimeout(() => setKeluar(null), 320)
    return () => window.clearTimeout(id)
  }, [keluar])

  const aktif = useRef<HTMLDivElement>(null)
  const [tinggi, setTinggi] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = aktif.current
    if (!el) return
    setTinggi(el.offsetHeight)
    const ro = new ResizeObserver(() => setTinggi(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [kunci])

  // SATU larik berkunci, dengan pembungkus yang bentuknya sama untuk kedua
  // keadaan - supaya React mencocokkan lapisan lewat `key` dan mempertahankan
  // komponennya saat ia berpindah dari "aktif" ke "keluar".
  const lapisan = [
    ...(keluar ? [{ kunci: keluar.kunci, isi: keluar.isi, keluar: true }] : []),
    { kunci, isi: children, keluar: false },
  ]
  return (
    <div className="panggung" style={{ height: tinggi ?? undefined }}>
      {lapisan.map((l) => (
        <div
          key={l.kunci}
          ref={l.keluar ? undefined : aktif}
          className={l.keluar ? 'panggung-keluar' : keluar ? 'panggung-masuk' : undefined}
          aria-hidden={l.keluar || undefined}
          inert={l.keluar || undefined}
        >
          {/* Lapisan yang keluar tidak lagi berhak menentukan lebar kartu. */}
          <PanggungKonteks.Provider value={l.keluar ? diamLebar : lapor}>{l.isi}</PanggungKonteks.Provider>
        </div>
      ))}
    </div>
  )
}

const diamLebar = () => {}

const K_ALUR = {
  id: { label: 'Langkah pendaftaran', tahap: ['Akun', 'Paket', 'Usaha'] },
  en: { label: 'Sign-up steps', tahap: ['Account', 'Plan', 'Business'] },
}

/** Tiga titik bernomor dengan garis yang terisi saat langkahnya dilewati. */
function Tahapan({ aktif }: { aktif: number }) {
  const t = useTeks(K_ALUR)
  return (
    <ol className="alur-tahap" aria-label={t.label}>
      {t.tahap.map((nama, i) => (
        <li
          key={nama}
          data-keadaan={i < aktif ? 'lewat' : i === aktif ? 'kini' : 'nanti'}
          aria-current={i === aktif ? 'step' : undefined}
        >
          <span className="alur-titik">
            {i < aktif ? (
              <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden>
                <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              i + 1
            )}
          </span>
          <span className="alur-nama">{nama}</span>
        </li>
      ))}
    </ol>
  )
}

function TombolTutup({ onTutup }: { onTutup: () => void }) {
  return (
    <button
      onClick={onTutup}
      aria-label="Tutup"
      className="shrink-0 cursor-pointer rounded-full border border-line px-3.5 py-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
    >
      Tutup
    </button>
  )
}

// ---------------------------------------------------------------------------
// Dialog masuk / daftar
// ---------------------------------------------------------------------------

const KELAS_INPUT =
  'w-full rounded-sm border border-line bg-surface px-3.5 py-2.5 text-[14px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-gem'

function Kolom({
  label,
  children,
  galat,
}: {
  label: string
  children: ReactNode
  galat?: string | null
}) {
  return (
    <label className="block">
      <span className="eyebrow mb-1.5 block">{label}</span>
      {children}
      {galat && <span className="mt-1 block text-[12px] text-bahaya">{galat}</span>}
    </label>
  )
}

const K_DIALOG = {
  id: {
    masuk: 'Masuk',
    daftar: 'Daftar',
    tutup: 'Tutup',
    judulMasuk: 'Selamat datang kembali',
    judulDaftar: 'Buat akun Loconomics',
    subMasuk: 'Masuk untuk membuka pantauan dan preferensi Anda.',
    subDaftar: 'Gratis. Akun menyimpan pantauan dan preferensi; Premium membuka kedalaman datanya.',
    identitas: 'Nama pengguna atau surel',
    identitasContoh: 'nama pengguna atau surel Anda',
    namaPengguna: 'Nama pengguna',
    namaContoh: 'mis. calonjuragan',
    surel: 'Surel',
    surelContoh: 'nama@surel.com',
    sandi: 'Kata sandi',
    sandiMinimal: 'minimal 8 karakter',
    sandiContoh: 'kata sandi Anda',
    sembunyi: 'Sembunyi',
    lihat: 'Lihat',
    sebentar: 'Sebentar…',
    buatAkun: 'Buat akun — gratis',
    belumPunya: 'Belum punya akun?',
    daftarGratis: 'Daftar gratis',
    sudahPunya: 'Sudah punya akun?',
    galatNama: 'Nama pengguna minimal 3 karakter.',
    galatNamaKarakter: 'Nama pengguna hanya boleh huruf, angka, titik, _ dan -.',
    galatSurel: 'Surelnya belum lengkap.',
    galatSandi: 'Kata sandi minimal 8 karakter.',
    galatKosong: 'Isi dulu keduanya.',
    galatJaringan: 'Tidak bisa menghubungi server. Periksa koneksi lalu coba lagi.',
  },
  en: {
    masuk: 'Sign in',
    daftar: 'Sign up',
    tutup: 'Close',
    judulMasuk: 'Welcome back',
    judulDaftar: 'Create a Loconomics account',
    subMasuk: 'Sign in to open your watchlist and preferences.',
    subDaftar: 'Free. An account keeps your watchlist and preferences; Premium unlocks the depth of the data.',
    identitas: 'Username or email',
    identitasContoh: 'your username or email',
    namaPengguna: 'Username',
    namaContoh: 'e.g. futureowner',
    surel: 'Email',
    surelContoh: 'name@email.com',
    sandi: 'Password',
    sandiMinimal: 'at least 8 characters',
    sandiContoh: 'your password',
    sembunyi: 'Hide',
    lihat: 'Show',
    sebentar: 'One moment…',
    buatAkun: 'Create account — free',
    belumPunya: 'No account yet?',
    daftarGratis: 'Sign up for free',
    sudahPunya: 'Already have an account?',
    galatNama: 'Username must be at least 3 characters.',
    galatNamaKarakter: 'Username may only contain letters, digits, dots, _ and -.',
    galatSurel: 'That email looks incomplete.',
    galatSandi: 'Password must be at least 8 characters.',
    galatKosong: 'Fill in both fields first.',
    galatJaringan: 'Could not reach the server. Check your connection and try again.',
  },
}

function DialogAkun({
  alasan,
  onTutup,
  onBerhasil,
}: {
  alasan: AlasanKunci
  onTutup: () => void
  /** `baru` = true kalau ini pendaftaran, bukan masuk. */
  onBerhasil: (baru: boolean) => void
}) {
  const { masuk, daftar } = useSesi()
  const t = useTeks(K_DIALOG)
  const [mode, setMode] = useState<'masuk' | 'daftar'>('masuk')
  /** Arah perpindahan terakhir: +1 ke Daftar (kanan), -1 ke Masuk (kiri).
   *  Dipakai supaya isi barunya masuk dari sisi yang SAMA dengan arah
   *  geseran penunjuk sakelarnya - kalau berlawanan, keduanya terbaca
   *  sebagai dua kejadian yang tidak berhubungan. */
  const [arah, setArah] = useState<1 | -1>(1)
  const [identitas, setIdentitas] = useState('')
  const [namaPengguna, setNamaPengguna] = useState('')
  const [email, setEmail] = useState('')
  const [sandi, setSandi] = useState('')
  const [lihatSandi, setLihatSandi] = useState(false)
  const [sibuk, setSibuk] = useState(false)
  const [galat, setGalat] = useState<string | null>(null)
  const pertama = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Fokus ke kolom pertama, tapi TIDAK di layar sentuh: memfokuskan input di
    // sana memunculkan papan ketik yang langsung menutupi separuh dialognya.
    if (window.matchMedia('(hover: hover)').matches) pertama.current?.focus()
  }, [mode])

  const kirim = async (e: FormEvent) => {
    e.preventDefault()
    if (sibuk) return
    setGalat(null)

    // Diperiksa di sini SEBELUM jaringan, supaya kesalahan yang sudah pasti
    // tidak perlu perjalanan bolak-balik untuk diberitahukan.
    if (mode === 'daftar') {
      if (namaPengguna.trim().length < 3) return setGalat(t.galatNama)
      if (!/^[\w.-]+$/.test(namaPengguna.trim()))
        return setGalat(t.galatNamaKarakter)
      if (!email.includes('@')) return setGalat(t.galatSurel)
      if (sandi.length < 8) return setGalat(t.galatSandi)
    } else if (!identitas.trim() || !sandi) {
      return setGalat(t.galatKosong)
    }

    setSibuk(true)
    try {
      if (mode === 'daftar') {
        await daftar({
          nama_pengguna: namaPengguna.trim(),
          email: email.trim(),
          sandi,
        })
        onBerhasil(true)
      } else {
        await masuk(identitas.trim(), sandi)
        onBerhasil(false)
      }
    } catch (err) {
      // Pesan backend dipakai apa adanya: ia sudah ditulis untuk dibaca manusia,
      // dan menerjemahkannya lagi di sini berarti dua tempat yang harus sepakat.
      setGalat(
        err instanceof GalatAPI
          ? err.message
          : t.galatJaringan,
      )
    } finally {
      setSibuk(false)
    }
  }

  const gantiMode = (m: 'masuk' | 'daftar') => {
    if (m === mode) return
    setArah(m === 'daftar' ? 1 : -1)
    setMode(m)
    setGalat(null)
    setSandi('')
  }

  return (
    <Tirai judul={mode === 'masuk' ? t.masuk : t.daftar} onTutup={onTutup} lebar="26.5rem">
      {/* SATU kolom. Dirombak 9 Sep 2026.

          Versi sebelumnya dua kolom: sisi kiri berisi tiga fitur berbayar
          ("43 variabel", "Komparasi", "Laporan PDF") di atas potret peta yang
          dikuras warnanya, sisi kanan formulirnya. Yang terbaca di potret:
          dialog selebar 52rem untuk dua kolom isian, dan kolom kirinya
          menjual sesuatu kepada orang yang baru mau MASUK - bukan membeli.
          Orang yang membuka dialog ini sudah tahu kenapa; yang ia butuhkan
          dua kolom isian dan satu tombol, selebar yang perlu, tidak lebih. */}
      <div className="p-7 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          {/* NAMA LENGKAP, bukan inisial di dalam heksagon.
              
              Heksagon-berhuruf-L itu lambang yang tidak dipakai di mana pun
              lagi di produk ini: bilah atas peta, bilah gerbang, dan layar
              pembuka ketiganya memakai papan nama yang sama. Satu-satunya
              tempat orang bertemu "L" adalah dialog ini - jadi ia bukan
              pengingat identitas, ia identitas KEDUA.

              Komponen yang sama persis dengan yang di pojok kiri bilah
              pencarian, bukan tiruannya: perilaku per-hurufnya - melenting saat
              disentuh, lalu mengambil warna yang luntur beberapa detik kemudian
              - ikut apa adanya, dan tidak ada salinan yang bisa berpisah tempo
              pada perubahan berikutnya. */}
          <PapanNama teks="Loconomics" sebagai="div" kelas="text-[17px] leading-none text-ink" />
          <button
            onClick={onTutup}
            aria-label={t.tutup}
            className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <h2 key={mode} className="ak-tukar judul-bagian mt-6 text-[26px] leading-[1.1]" data-arah={arah}>
          {mode === 'masuk' ? t.judulMasuk : t.judulDaftar}
        </h2>
        <p className="mt-2 text-[13.5px] leading-snug text-ink-3">
          {alasan ?? (mode === 'masuk' ? t.subMasuk : t.subDaftar)}
        </p>

        {/* Sakelar dua posisi. Penunjuknya permukaan terangkat, bukan `bg-ink`:
            sakelar ini memilih tampilan, dan benda paling terang di dialog
            harus tetap tombol kirimnya. */}
        <div className="relative mt-6 grid grid-cols-2 rounded-full bg-surface-2 p-1">
          <div
            className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full border border-line-2 bg-surface transition-transform duration-300 ease-liquid"
            style={{ transform: mode === 'daftar' ? 'translateX(100%)' : 'none' }}
            aria-hidden
          />
          {(['masuk', 'daftar'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => gantiMode(m)}
              className={`relative cursor-pointer rounded-full py-2 text-[13.5px] font-semibold transition-colors duration-300 ${
                mode === m ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
              }`}
            >
              {m === 'masuk' ? t.masuk : t.daftar}
            </button>
          ))}
        </div>

        <form onSubmit={kirim} className="mt-5 space-y-3.5">
          {/* `key={mode}` mengganti simpulnya, jadi animasi masuknya menyala
              tiap pergantian dan fokus kembali ke kolom pertama yang baru. */}
          <div key={mode} data-arah={arah} className="ak-tukar space-y-3.5">
            {mode === 'masuk' ? (
              <Kolom label={t.identitas}>
                <input
                  ref={pertama}
                  className={KELAS_INPUT}
                  value={identitas}
                  onChange={(e) => setIdentitas(e.target.value)}
                  autoComplete="username"
                  placeholder={t.identitasContoh}
                />
              </Kolom>
            ) : (
              <>
                <Kolom label={t.namaPengguna}>
                  <input
                    ref={pertama}
                    className={KELAS_INPUT}
                    value={namaPengguna}
                    onChange={(e) => setNamaPengguna(e.target.value)}
                    autoComplete="username"
                    placeholder={t.namaContoh}
                  />
                </Kolom>
                <Kolom label={t.surel}>
                  <input
                    type="email"
                    className={KELAS_INPUT}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    placeholder={t.surelContoh}
                  />
                </Kolom>
              </>
            )}

            <Kolom label={t.sandi}>
              <div className="relative">
                <input
                  type={lihatSandi ? 'text' : 'password'}
                  className={`${KELAS_INPUT} pr-[4.5rem]`}
                  value={sandi}
                  onChange={(e) => setSandi(e.target.value)}
                  autoComplete={mode === 'masuk' ? 'current-password' : 'new-password'}
                  placeholder={mode === 'daftar' ? t.sandiMinimal : t.sandiContoh}
                />
                <button
                  type="button"
                  onClick={() => setLihatSandi((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-xs px-2 py-1 text-[12px] font-medium text-ink-3 transition-colors hover:text-ink"
                >
                  {lihatSandi ? t.sembunyi : t.lihat}
                </button>
              </div>
            </Kolom>
          </div>

          {galat && (
            <div
              role="alert"
              className="rounded-md border border-bahaya/30 bg-bahaya-soft px-3.5 py-2.5 text-[13px] leading-snug text-bahaya"
            >
              {galat}
            </div>
          )}

          <button
            type="submit"
            disabled={sibuk}
            className="mt-2 flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-full bg-ink px-6 py-3.5 text-[14.5px] font-semibold text-surface transition-all duration-300 ease-jelly hover:scale-[1.015] disabled:cursor-wait disabled:opacity-60"
          >
            {sibuk && <Pusaran />}
            {sibuk ? t.sebentar : mode === 'masuk' ? t.masuk : t.buatAkun}
          </button>
        </form>

        <p className="mt-5 text-center text-[12.5px] leading-snug text-ink-3">
          {mode === 'masuk' ? (
            <>
              {t.belumPunya}{' '}
              <button
                onClick={() => gantiMode('daftar')}
                className="cursor-pointer font-semibold text-ink underline-offset-[3px] hover:underline"
              >
                {t.daftarGratis}
              </button>
            </>
          ) : (
            <>
              {t.sudahPunya}{' '}
              <button
                onClick={() => gantiMode('masuk')}
                className="cursor-pointer font-semibold text-ink underline-offset-[3px] hover:underline"
              >
                {t.masuk}
              </button>
            </>
          )}
        </p>
      </div>
    </Tirai>
  )
}

// ---------------------------------------------------------------------------
// Dialog langganan
// ---------------------------------------------------------------------------


/**
 * Dialog langganan dan onboarding, dua bahasa.
 *
 * `p.nama`, `p.rincian`, dan `katalog.catatan_pembayaran` datang dari
 * `/akun/paket` dan dibiarkan apa adanya - katalog harga hidup di backend
 * supaya harganya bisa berubah tanpa menerbitkan ulang frontend, dan menyalin
 * namanya ke sini berarti dua daftar harga yang cepat atau lambat berselisih.
 */
const K_BAYAR = {
  id: {
    locale: 'id-ID',
    gagalPaket: 'Gagal memuat daftar paket.',
    premiumAktif: 'Loconomics Premium aktif. Seluruh fitur terbuka.',
    gagalAktivasi: 'Aktivasi gagal. Coba lagi.',
    selamatDatang: 'Selamat datang di Premium',
    judulDialog: 'Loconomics Premium',
    sudahAktif: 'Akun Anda sudah aktif',
    satuLangkah: 'Satu langkah lagi sebelum mulai',
    bukaKedalaman: 'Buka seluruh kedalaman datanya',
    alasanRayakan:
      'Akun gratis sudah bisa melihat peta, skor, dan zonasi. Premium yang membuka 43 variabel, komparasi, pemantauan, dan Laporan Kelayakan.',
    alasanBiasa: 'Satu langganan membuka semuanya. Tanpa ikatan — berhenti kapan saja.',
    memuatPaket: 'Memuat paket…',
    gratis: 'Gratis',
    gratisCatatan: 'Sudah aktif di akun Anda. Tanpa batas waktu.',
    gratisRincian: [
      'Seluruh grid heksagon di enam kawasan',
      'Opportunity Score, Hidden Gem, dan keempat kuadrannya',
      'Status zonasi ZoneGuard dan peringatan RiskRadar',
      'Daftar lokasi, pencarian, dan Loconomics AI',
    ],
    berlakuHari: (n: number) =>
      `Berlaku ${n} hari, otomatis berakhir — tidak ada tagihan berulang.`,
    pembayaran: 'Pembayaran',
    kodeQris: 'Kode pembayaran tampil di sini',
    paket: 'Paket',
    total: 'Total',
    mengaktifkan: 'Mengaktifkan…',
    aktifkan: 'Aktifkan sekarang',
    pilihDulu: 'Pilih paket dulu',
    belumTerpasang: 'Gerbang pembayaran belum terpasang di lingkungan ini.',
    masukSebagai: 'Masuk sebagai',
    palingHemat: 'Paling hemat',
    lanjutGratis: 'Lanjut dengan akun gratis',
    lanjutGratisCatatan: 'Premium bisa dibuka kapan saja dari menu akun.',
    akunGratisSiap: 'Akun gratis Anda aktif. Peta, skor, zonasi, dan Loconomics AI sudah bisa dipakai.',
    akunSiapJudul: 'Akun Anda siap',
    tanyaUsaha: 'Usaha apa yang Anda rencanakan?',
    tanyaKawasan: 'Di kawasan mana Anda mencari lokasi?',
    tanyaAnggaran: 'Berapa anggaran sewa per bulan?',
    opsional: 'opsional',
    ringkasan: 'Peta dibuka dengan',
    belumDipilih: 'Belum ada yang dipilih — semuanya boleh dilewati.',
    perBulanPendek: '/bln',
    anggaranLain: 'Nominal lain',
    juta: (n: number) => `${n} jt`,
    kelompok: { 'Makanan & minuman': 'Makanan & minuman', Ritel: 'Ritel', Jasa: 'Jasa' } as Record<string, string>,

    premiumAktifJudul: 'Premium aktif',
    disetelUntuk: 'Sebentar — Loconomics mau disetel untuk siapa?',
    disetelIsi:
      'Jawabannya menyetel bawaan simulasi dan kawasan yang dibuka lebih dulu. Tidak ada skor yang berubah, dan semuanya bisa diganti kapan saja.',
    rencanaUsaha: 'Rencana usaha',
    kawasanIncaran: 'Kawasan yang diincar',
    anggaran: 'Anggaran sewa per bulan (opsional)',
    contohAnggaran: 'mis. 15.000.000',
    lewati: 'Lewati',
    menyimpan: 'Menyimpan…',
    simpanBuka: 'Simpan & buka peta',
    preferensi: 'Preferensi usaha',
    preferensiPesan:
      'Kriteria ini menyaring rekomendasi dan menyetel bawaan simulasi. Tidak ada skor yang berubah karenanya.',
  },
  en: {
    locale: 'en-GB',
    gagalPaket: 'Could not load the plans.',
    premiumAktif: 'Loconomics Premium is active. Everything is open.',
    gagalAktivasi: 'Activation failed. Try again.',
    selamatDatang: 'Welcome to Premium',
    judulDialog: 'Loconomics Premium',
    sudahAktif: 'Your account is active',
    satuLangkah: 'One step left before you start',
    bukaKedalaman: 'Open the full depth of the data',
    alasanRayakan:
      'A free account already sees the map, the scores, and the zoning. Premium is what opens the 43 variables, comparison, watching, and the Feasibility Report.',
    alasanBiasa: 'One subscription opens everything. No lock-in — stop whenever you like.',
    memuatPaket: 'Loading plans…',
    gratis: 'Free',
    gratisCatatan: 'Already active on your account. No time limit.',
    gratisRincian: [
      'The whole hexagon grid across six areas',
      'Opportunity Score, Hidden Gem, and all four quadrants',
      'ZoneGuard permission status and RiskRadar warnings',
      'The location list, search, and Loconomics AI',
    ],
    berlakuHari: (n: number) => `Valid for ${n} days, then it simply ends — no recurring charge.`,
    pembayaran: 'Payment',
    kodeQris: 'The payment code appears here',
    paket: 'Plan',
    total: 'Total',
    mengaktifkan: 'Activating…',
    aktifkan: 'Activate now',
    pilihDulu: 'Pick a plan first',
    belumTerpasang: 'No payment gateway is wired up in this environment.',
    masukSebagai: 'Signed in as',
    palingHemat: 'Best value',
    lanjutGratis: 'Continue with a free account',
    lanjutGratisCatatan: 'Premium can be opened any time from the account menu.',
    akunGratisSiap: 'Your free account is active. The map, scores, zoning, and Loconomics AI are ready.',
    akunSiapJudul: 'Your account is ready',
    tanyaUsaha: 'What business are you planning?',
    tanyaKawasan: 'Which area are you looking in?',
    tanyaAnggaran: 'What is your monthly rent budget?',
    opsional: 'optional',
    ringkasan: 'The map opens with',
    belumDipilih: 'Nothing picked yet — every question can be skipped.',
    perBulanPendek: '/mo',
    anggaranLain: 'Other amount',
    juta: (n: number) => `${n}M`,
    kelompok: { 'Makanan & minuman': 'Food & drink', Ritel: 'Retail', Jasa: 'Services' } as Record<string, string>,

    premiumAktifJudul: 'Premium is active',
    disetelUntuk: 'One moment — who should Loconomics be set up for?',
    disetelIsi:
      'Your answers set the simulation defaults and which area opens first. No score changes, and everything can be changed later.',
    rencanaUsaha: 'The business you plan',
    kawasanIncaran: 'The areas you are after',
    anggaran: 'Monthly rent budget (optional)',
    contohAnggaran: 'e.g. 15,000,000',
    lewati: 'Skip',
    menyimpan: 'Saving…',
    simpanBuka: 'Save & open the map',
    preferensi: 'Business preferences',
    preferensiPesan:
      'These criteria filter the recommendations and set the simulation defaults. No score changes because of them.',
  },
}

const rp = (n: number, locale = 'id-ID') => `Rp${n.toLocaleString(locale)}`

function DialogLangganan({
  alasan,
  rayakan,
  onTutup,
  onLanjut,
}: {
  alasan: AlasanKunci
  /** Dibuka tepat sesudah mendaftar: sapaannya berbeda. */
  rayakan: boolean
  onTutup: () => void
  /** Pindah ke langkah preferensi usaha. `pesan` = kalimat keadaan akunnya. */
  onLanjut: (pesan: string | null) => void
}) {
  const t = useTeks(K_BAYAR)
  const { akun, segarkan } = useSesi()
  const [katalog, setKatalog] = useState<KatalogPaket | null>(null)
  const [pilih, setPilih] = useState<string | null>(null)
  const [sibuk, setSibuk] = useState(false)
  const [galat, setGalat] = useState<string | null>(null)

  useEffect(() => {
    api
      .katalogPaket()
      .then(setKatalog)
      .catch(() => setGalat(t.gagalPaket))
    // Tanpa `t` di dependensi: kalimat cadangan itu cuma terbaca kalau
    // permintaannya gagal, dan menambahkannya berarti katalog diminta ulang
    // tiap kali bahasa ditukar.
  }, [])

  const bayar = async () => {
    if (!pilih || sibuk) return
    setSibuk(true)
    setGalat(null)
    try {
      await api.berlangganan(pilih)
      await segarkan()
      // Sesudah langganan aktif, langkah berikutnya BUKAN tanda centang: ia
      // menanyakan usaha apa dan di mana, lalu membuka peta ke sana.
      onLanjut(t.premiumAktif)
    } catch (err) {
      setGalat(err instanceof GalatAPI ? err.message : t.gagalAktivasi)
    } finally {
      setSibuk(false)
    }
  }

  const paketTerpilih = katalog?.langganan.find((p) => p.kode === pilih)
  const harga = paketTerpilih?.harga_rp ?? null

  return (
    <Tirai judul={t.judulDialog} onTutup={onTutup} lebar="56rem">
      <div className="flex max-h-[86vh] flex-col">
        {/* --- Kepala ------------------------------------------------------ */}
        <div className="flex items-start justify-between gap-5 border-b border-line/70 px-6 py-5 sm:px-7">
          <div className="min-w-0">
            <p className="eyebrow">{rayakan ? t.sudahAktif : t.judulDialog}</p>
            <h2 className="papan mt-1 text-[21px] leading-tight">
              {rayakan ? t.satuLangkah : t.bukaKedalaman}
            </h2>
            <p className="mt-1.5 max-w-[34rem] text-[13.5px] leading-snug text-ink-2">
              {alasan ?? (rayakan ? t.alasanRayakan : t.alasanBiasa)}
            </p>
          </div>
          <TombolTutup onTutup={onTutup} />
        </div>

        <div className="scroll-tipis min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-6 p-6 sm:p-7 lg:flex-row">
            {/* --- Kiri: pilihan paket ---------------------------------- */}
            <div className="min-w-0 flex-1">
              {!katalog ? (
                <p className="text-[13.5px] text-ink-3">{t.memuatPaket}</p>
              ) : (
                <div className="space-y-3">
                  {/* Tingkat GRATIS ditulis sebagai kartu, bukan disembunyikan.
                      Orang yang baru mendaftar berhak melihat apa yang SUDAH ia
                      dapat tanpa membayar - etalase yang cuma memuat satu harga
                      terbaca sebagai dinding, dan dinding di layar kedua sesudah
                      mendaftar adalah tempat orang berhenti. */}
                  <div className="rounded-md border border-line bg-surface p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="papan text-[15px]">{t.gratis}</span>
                        <p className="mt-1 text-[12.5px] leading-snug text-ink-3">
                          {t.gratisCatatan}
                        </p>
                      </div>
                      <span className="tabular shrink-0 text-[15px] font-semibold text-ink">
                        Rp0
                      </span>
                    </div>
                    <ul className="mt-3 space-y-1.5 border-t border-line/60 pt-3">
                      {t.gratisRincian.map((r) => (
                        <li key={r} className="flex gap-2 text-[12.5px] leading-snug text-ink-2">
                          <Centang kecil />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {katalog.langganan.map((p) => (
                    <KartuPaket
                      key={p.kode}
                      dipilih={pilih === p.kode}
                      onPilih={() => setPilih(p.kode)}
                      judul={p.nama}
                      harga={`${rp(p.harga_rp, t.locale)} / ${p.satuan}`}
                      catatan={t.berlakuHari(p.hari)}
                      unggulan={p.unggulan}
                      rincian={p.rincian}
                    />
                  ))}
                </div>
              )}

              {/* Jalan keluar yang TIDAK membayar, dan sama terlihatnya dengan
                  yang membayar. Sesudah mendaftar, akun gratis tetap menempuh
                  langkah preferensi usaha - jawabannya berguna untuk semua
                  orang, bukan cuma untuk pelanggan. */}
              {rayakan && (
                <button
                  onClick={() => onLanjut(t.akunGratisSiap)}
                  className="group mt-4 flex w-full cursor-pointer items-center justify-between gap-3 rounded-md border border-dashed border-line-2 px-4 py-3 text-left transition-colors hover:border-ink/40 hover:bg-surface-2/60"
                >
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-semibold text-ink">{t.lanjutGratis}</span>
                    <span className="block text-[12px] leading-snug text-ink-3">{t.lanjutGratisCatatan}</span>
                  </span>
                  <svg width="18" height="18" viewBox="0 0 20 20" className="shrink-0 text-ink-3 transition-transform duration-300 ease-jelly group-hover:translate-x-1" aria-hidden>
                    <path d="M4 10h11m-4-4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
            </div>

                        {/* --- Kanan: pembayaran ------------------------------------ */}
            <div className="w-full shrink-0 lg:w-[19rem]">
              <div className="rounded-md border border-line bg-surface-2/60 p-5">
                <h3 className="eyebrow mb-3">{t.pembayaran}</h3>

                {/* Tempat QRIS. Sengaja kosong dan sengaja MENGATAKAN dirinya
                    kosong. Menaruh QR contoh yang tidak bisa dibayar jauh lebih
                    buruk: orang memindainya, gagal, lalu tidak percaya lagi. */}
                <div className="relative mx-auto grid aspect-square w-full max-w-[13rem] place-items-center overflow-hidden rounded-sm border-2 border-dashed border-line-2 bg-surface">
                  <SarangKecil pudar />
                  <div className="relative px-4 text-center">
                    <svg width="34" height="34" viewBox="0 0 24 24" className="mx-auto text-ink-3" aria-hidden>
                      <path
                        d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM16 16h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.3"
                      />
                    </svg>
                    <p className="mt-2.5 text-[12.5px] font-semibold text-ink-2">QRIS</p>
                    <p className="mt-0.5 text-[11.5px] leading-snug text-ink-3">
                      {t.kodeQris}
                    </p>
                  </div>
                </div>

                <dl className="mt-4 space-y-1.5 border-t border-line/70 pt-3.5 text-[13px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-3">{t.paket}</dt>
                    <dd className="truncate text-right font-medium text-ink">
                      {paketTerpilih?.nama ?? '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-3">{t.total}</dt>
                    <dd className="tabular text-right font-semibold text-ink">
                      {harga === null ? '—' : rp(harga, t.locale)}
                    </dd>
                  </div>
                </dl>

                {galat && (
                  <p role="alert" className="mt-3 text-[12.5px] leading-snug text-bahaya">
                    {galat}
                  </p>
                )}

                <button
                  onClick={bayar}
                  disabled={!pilih || sibuk}
                  className="mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[14px] font-semibold text-surface transition-all duration-300 ease-jelly hover:scale-[1.015] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
                >
                  {sibuk && <Pusaran />}
                  {sibuk ? t.mengaktifkan : pilih ? t.aktifkan : t.pilihDulu}
                </button>

                {/* Keadaan pembayaran dikatakan apa adanya. Ini yang membedakan
                    layar berbayar yang jujur dari layar berbayar palsu. */}
                <p className="mt-3 text-[11.5px] leading-snug text-ink-3">
                  {katalog?.catatan_pembayaran ?? t.belumTerpasang}
                </p>
              </div>

              {akun && (
                <p className="mt-3 text-center text-[12px] text-ink-3">
                  {t.masukSebagai}{' '}
                  <strong className="font-semibold text-ink-2">{akun.nama_pengguna}</strong>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </Tirai>
  )
}

function KartuPaket({
  dipilih,
  onPilih,
  judul,
  harga,
  catatan,
  unggulan,
  rincian,
}: {
  dipilih: boolean
  onPilih: () => void
  judul: string
  harga: string
  catatan?: string
  unggulan?: boolean
  rincian?: string[]
}) {
  const tp = useTeks(K_BAYAR)
  return (
    <button
      onClick={onPilih}
      aria-pressed={dipilih}
      className={`w-full cursor-pointer rounded-md border p-4 text-left transition-all duration-300 ${
        dipilih
          ? 'border-gem bg-gem-soft/40 shadow-[0_0_0_1px_var(--color-gem)]'
          : 'border-line bg-surface hover:border-line-2'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="papan text-[15px]">{judul}</span>
            {unggulan && (
              <span className="rounded-full bg-gem px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-white">
                {tp.palingHemat}
              </span>
            )}
          </div>
          {catatan && <p className="mt-1 text-[12.5px] leading-snug text-ink-3">{catatan}</p>}
        </div>
        <span className="tabular shrink-0 text-[15px] font-semibold text-ink">{harga}</span>
      </div>
      {rincian && (
        <ul className="mt-3 space-y-1.5 border-t border-line/60 pt-3">
          {rincian.map((r) => (
            <li key={r} className="flex gap-2 text-[12.5px] leading-snug text-ink-2">
              <Centang kecil />
              {r}
            </li>
          ))}
        </ul>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Tombol akun di bilah atas
// ---------------------------------------------------------------------------

/**
 * Tombol akun.
 *
 * `varian="gerbang"` dipakai di halaman perkenalan, yang punya palet sendiri
 * (hijau tua di atas latar terang) dan tidak memakai token `.kaca`.
 *
 * WADAHNYA `relative`, BUKAN `static`. Ini jebakan yang sudah kena di repo ini
 * dan tercatat di CLAUDE.md: begitu wadah jangkar berhenti jadi konteks posisi,
 * kartu ber-`absolute` di dalamnya naik menempel ke lapisan chrome setinggi
 * layar dan dirender jauh di luar layar.
 */
const K_TOMBOL = {
  id: {
    masukAtauDaftar: 'Masuk atau daftar',
    daftar: 'Daftar',
    daftarPanjang: 'Daftar untuk akses semua fitur',
    premium: 'Premium',
    gratis: 'Gratis',
    selamanya: 'Berlaku selamanya.',
    aktifSampai: (t: string) => `Aktif sampai ${t}.`,
    langgananAktif: 'Langganan aktif.',
    jadiPremium: 'Jadi Premium',
    perBulan: '/bln',
    preferensi: 'Preferensi usaha',
    preferensiCatatan: 'Jenis usaha, kawasan incaran, dan anggaran sewa',
    keluar: 'Keluar',
    keluarCatatan: (n: string) => `Sesi ${n} diakhiri`,
    tanggal: 'id-ID',
  },
  en: {
    masukAtauDaftar: 'Sign in or sign up',
    daftar: 'Sign up',
    daftarPanjang: 'Sign up for full access',
    premium: 'Premium',
    gratis: 'Free',
    selamanya: 'Valid forever.',
    aktifSampai: (t: string) => `Active until ${t}.`,
    langgananAktif: 'Subscription active.',
    jadiPremium: 'Go Premium',
    perBulan: '/mo',
    preferensi: 'Business preferences',
    preferensiCatatan: 'Business type, target areas, and rent budget',
    keluar: 'Sign out',
    keluarCatatan: (n: string) => `End ${n}’s session`,
    tanggal: 'en-GB',
  },
}

export function TombolAkun({ varian = 'peta' }: { varian?: 'peta' | 'gerbang' }) {
  const { akun, premium, memuat, keluar, mintaMasuk, mintaLangganan, mintaPreferensi } = useSesi()
  const t = useTeks(K_TOMBOL)
  const [buka, setBuka] = useState(false)
  // Dipanggil SEBELUM cabang tamu di bawah, yang keluar lebih awal: kait yang
  // hanya dipanggil sebagian waktu mengacaukan urutan kait React.
  const { tampil, menutup } = useTutupHalus(buka)
  const wadah = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!buka) return
    const luar = (e: MouseEvent) => {
      if (!wadah.current?.contains(e.target as Node)) setBuka(false)
    }
    const kunci = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBuka(false)
    }
    document.addEventListener('mousedown', luar)
    document.addEventListener('keydown', kunci)
    return () => {
      document.removeEventListener('mousedown', luar)
      document.removeEventListener('keydown', kunci)
    }
  }, [buka])

  // --- Tamu: ajakan, bukan ikon -------------------------------------------
  //
  // Orang yang belum punya akun tidak sedang mencari "akun"; ia belum tahu ada
  // yang bisa dibuka. Ikon orang-orangan menjawab pertanyaan yang belum ia
  // ajukan. Kalimatnya yang mengajukan pertanyaan itu untuknya.
  if (!akun) {
    const digerbang = varian === 'gerbang'
    // DIBALIK 11 Sep 2026, membatalkan keputusan 9 Sep.
    //
    // Dulu: di gerbang tombol ini pil biasa dan yang berpendar "Masuk ke peta".
    // Sekarang: selama BELUM ada akun, yang berpendar justru tombol ini - di
    // kedua tempatnya. Permintaan pemilik repo, dan alasannya kuat: peta bisa
    // dibuka siapa pun tanpa mendaftar, jadi mengarahkan mata ke sana lebih
    // dulu menunda satu-satunya langkah yang mengubah apa yang akan ia lihat
    // di sana. Begitu akunnya ada, cabang ini tidak dirender sama sekali dan
    // pendarnya kembali ke "Masuk ke peta" - lihat `tombolMasuk` di
    // Gerbang.tsx.
    const kelas = digerbang
      ? 'g-catalyst group inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold sm:px-5 sm:py-2.5 sm:text-[14.5px]'
      : 'g-catalyst group inline-flex cursor-pointer items-center gap-2 rounded-full px-3.5 py-2 text-[12.5px] font-semibold'
    const kelasTeks = 'g-catalyst-teks'
    return (
      <div ref={wadah} className="relative shrink-0">
        <button
          onClick={() => mintaMasuk(null)}
          disabled={memuat}
          className={kelas}
          title={t.masukAtauDaftar}
        >
          {!digerbang && <Kilau />}
          <span className={`hidden sm:inline ${kelasTeks}`}>{digerbang ? t.daftar : t.daftarPanjang}</span>
          <span className={`sm:hidden ${kelasTeks}`}>{t.daftar}</span>
        </button>
      </div>
    )
  }

  const inisial = (akun.nama_tampilan || akun.nama_pengguna).slice(0, 2).toUpperCase()

  return (
    <div ref={wadah} className="relative shrink-0">
      <button
        onClick={() => setBuka((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={buka}
        className={`flex cursor-pointer items-center gap-2 rounded-full border py-1 pl-1 pr-3 transition-all duration-300 ease-jelly hover:scale-[1.03] ${
          buka ? 'border-transparent bg-ink text-surface' : 'border-line text-ink hover:border-line-2'
        } ${varian === 'gerbang' ? 'sm:py-1.5 sm:pl-1.5 sm:pr-4' : ''}`}
        title={akun.nama_pengguna}
      >
        <span
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11.5px] font-bold ${
            premium ? 'bg-gem text-white' : 'bg-surface-2 text-ink-2'
          } ${varian === 'gerbang' ? 'sm:h-8 sm:w-8 sm:text-[12.5px]' : ''}`}
        >
          {inisial}
        </span>
        <span
          className={`hidden max-w-[7rem] truncate text-[12.5px] font-semibold sm:inline ${
            varian === 'gerbang' ? 'sm:max-w-[9rem] sm:text-[14px]' : ''
          }`}
        >
          {akun.nama_pengguna}
        </span>
        {premium && (
          <span className="hidden rounded-full bg-gem-soft px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-gem md:inline">
            Premium
          </span>
        )}
      </button>

      {/* `text-ink` ditulis, bukan diwarisi - sebab yang sama dengan menu
          Pengaturan di primitif.tsx. Nama tampilan di kepala menu tidak punya
          kelas warna, dan di bilah gerbang yang turun ke jurang pada tema
          terang ia mewarisi tinta GELAP gerbang di atas kaca yang sudah gelap:
          terlihat di potret sesi yang dipalsukan, 11 Sep 2026. */}
      {tampil && (
        <div
          role="menu"
          data-menutup={menutup ? '1' : undefined}
          className="kaca-tebal pop pop-kanan absolute right-0 top-[calc(100%+8px)] z-50 w-[19rem] overflow-hidden rounded-md text-ink"
        >
          <div className="border-b border-line/70 px-4 py-3.5">
            <div className="flex items-center gap-3">
              <span
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-[14px] font-bold ${
                  premium ? 'bg-gem text-white' : 'bg-surface-2 text-ink-2'
                }`}
              >
                {inisial}
              </span>
              <div className="min-w-0">
                <p className="papan truncate text-[14.5px]">
                  {akun.nama_tampilan || akun.nama_pengguna}
                </p>
                <p className="truncate text-[12px] text-ink-3">{akun.email}</p>
              </div>
            </div>

            <div className="mt-3.5 flex items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${
                  premium ? 'bg-gem text-white' : 'bg-surface-2 text-ink-2'
                }`}
              >
                {premium ? t.premium : t.gratis}
              </span>
              {akun.peran === 'admin' && (
                <span className="rounded-full bg-pemenang-soft px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-pemenang">
                  Admin
                </span>
              )}
            </div>

            {premium ? (
              <p className="mt-2.5 text-[12px] leading-snug text-ink-3">
                {akun.langganan?.selamanya
                  ? t.selamanya
                  : akun.langganan?.berlaku_sampai
                    ? t.aktifSampai(
                        new Date(akun.langganan.berlaku_sampai).toLocaleDateString(t.tanggal, {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        }),
                      )
                    : t.langgananAktif}
              </p>
            ) : (
              <button
                onClick={() => {
                  setBuka(false)
                  mintaLangganan(null)
                }}
                className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-surface transition-transform duration-300 ease-jelly hover:scale-[1.02]"
              >
                <Kilau />
                {t.jadiPremium} — {rp(25000)}{t.perBulan}
              </button>
            )}
          </div>

          <div className="p-1.5">
            <BarisMenu
              onClick={() => {
                setBuka(false)
                mintaPreferensi()
              }}
              label={t.preferensi}
              catatan={t.preferensiCatatan}
            />
            <BarisMenu
              onClick={() => {
                setBuka(false)
                keluar()
              }}
              label={t.keluar}
              catatan={t.keluarCatatan(akun.nama_pengguna)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function BarisMenu({
  onClick,
  label,
  catatan,
}: {
  onClick: () => void
  label: string
  catatan?: string
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="flex w-full cursor-pointer flex-col gap-0.5 rounded-sm px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
    >
      <span className="text-[13.5px] font-medium text-ink">{label}</span>
      {catatan && <span className="text-[11.5px] leading-snug text-ink-3">{catatan}</span>}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Hiasan kecil
// ---------------------------------------------------------------------------

function Centang({ kecil }: { kecil?: boolean }) {
  const s = kecil ? 13 : 16
  return (
    <svg width={s} height={s} viewBox="0 0 20 20" className="mt-0.5 shrink-0" aria-hidden>
      <path
        d="m4 10.5 4 4 8-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.85"
      />
    </svg>
  )
}

function Kilau() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" className="shrink-0" aria-hidden>
      <path
        d="M10 2.5 11.7 7l4.8 1.4L11.7 10l-1.7 4.5L8.3 10 3.5 8.4 8.3 7Z"
        fill="currentColor"
        opacity="0.95"
      />
      <circle cx="15.6" cy="14.6" r="1.5" fill="currentColor" opacity="0.7" />
    </svg>
  )
}

function Pusaran() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" className="shrink-0 animate-spin" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.6" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * Sarang lebah kecil sebagai tekstur latar.
 *
 * Satu `<pattern>`, bukan puluhan poligon - alasan yang sama dengan hero di
 * halaman gerbang, dan tercatat di CLAUDE.md: perender melukis ubinnya sekali
 * lalu mengulanginya sebagai tekstur.
 */
function SarangKecil({ pudar }: { pudar?: boolean } = {}) {
  const id = pudar ? 'sarang-qris' : 'sarang-akun'
  return (
    <svg className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <pattern id={id} width="36" height="62" patternUnits="userSpaceOnUse">
          {[
            [0, 0],
            [36, 0],
            [0, 62],
            [36, 62],
            [18, 31],
          ].map(([x, y], i) => (
            <polygon
              key={i}
              points="0,-20 17.3,-10 17.3,10 0,20 -17.3,10 -17.3,-10"
              transform={`translate(${x} ${y})`}
              fill="none"
              stroke={pudar ? 'var(--color-line)' : 'rgb(255 255 255 / 0.13)'}
              strokeWidth={pudar ? 1 : 1.2}
            />
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} opacity={pudar ? 0.5 : 1} />
    </svg>
  )
}


// ---------------------------------------------------------------------------
// Onboarding usaha
// ---------------------------------------------------------------------------

/** Pilihan cepat anggaran sewa, rupiah per bulan. Bukan saringan: cuma jalan
 *  pintas mengisi kolomnya, dan kolomnya tetap menerima angka apa pun. */
const PRESET_ANGGARAN = [5, 10, 15, 25]

/**
 * Tiga pertanyaan, seluruhnya boleh dilewati.
 *
 * Dirombak 13 Sep 2026 atas laporan pemilik repo: layar ini masih memegang
 * EMPAT jenis usaha - sisa sebelum simulasi diperluas jadi enam belas - dan
 * tampil sebagai satu formulir panjang tanpa hierarki. Sekarang daftarnya dari
 * `lib/jenis-usaha.ts` yang SAMA dengan simulasi, dikelompokkan dalam tiga
 * tab, dan tiap pertanyaan bernomor supaya terbaca sebagai langkah.
 *
 * Yang dijawab menyetel dua hal nyata: jenis usaha jadi bawaan panel simulasi,
 * kawasan memindahkan peta ke sana. Yang TIDAK berubah karenanya: satu pun
 * skor, peringkat, atau kuadran - itu milik pipeline, dan preferensi pengguna
 * tidak pernah boleh menyentuhnya.
 */
function OnboardingUsaha({
  pesan,
  judul,
  onSelesai,
  onLewati,
}: {
  pesan: string
  judul: string
  /** Sesudah disimpan. `kawasan` dipakai App untuk membuka peta ke sana. */
  onSelesai: (hasil: DetailBukaPeta) => void
  onLewati: () => void
}) {
  const t = useTeks(K_BAYAR)
  const { bahasa } = useBahasa()
  const ing = bahasa === 'en'
  const { akun, segarkan } = useSesi()
  const [jenis, setJenis] = useState<string | null>(akun?.preferensi?.jenis_usaha ?? null)
  const [kelompok, setKelompok] = useState<string>(
    JENIS_USAHA.find((j) => j.nilai === jenis)?.kelompok ?? KELOMPOK_JENIS[0],
  )
  const [kawasan, setKawasan] = useState<string | null>(akun?.preferensi?.kawasan ?? null)
  const [budget, setBudget] = useState<number | null>(
    akun?.preferensi?.budget_sewa_bulanan ?? null,
  )
  const [sibuk, setSibuk] = useState(false)

  const simpan = async () => {
    setSibuk(true)
    try {
      await api.simpanPreferensi({
        jenis_usaha: jenis,
        kawasan,
        budget_sewa_bulanan: budget,
      })
      await segarkan()
    } catch {
      // Preferensi yang gagal disimpan tidak boleh menahan orang di layar ini:
      // ia tetap dibawa ke peta, dan bisa mengisinya lagi dari menu akun.
    }
    onSelesai({ kawasan })
  }

  const jenisTerpilih = JENIS_USAHA.find((j) => j.nilai === jenis)
  const ringkas = [
    jenisTerpilih ? (ing ? jenisTerpilih.labelEn : jenisTerpilih.label) : null,
    kawasan,
    budget ? `${rp(budget, t.locale)}${t.perBulanPendek}` : null,
  ].filter(Boolean) as string[]

  return (
    <div className="flex max-h-[84vh] flex-col">
      {/* --- Kepala --------------------------------------------------------- */}
      <div className="flex items-start gap-3.5 border-b border-line/70 px-6 pb-4 pt-5 sm:px-7">
        <span className="onb-lencana grid h-11 w-11 shrink-0 place-items-center rounded-full">
          <svg width="21" height="21" viewBox="0 0 24 24" aria-hidden>
            <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div className="min-w-0">
          <h2 className="papan text-[19px] leading-tight">{judul}</h2>
          <p className="mt-1 text-[13px] leading-snug text-ink-2">{pesan}</p>
        </div>
      </div>

      <div className="scroll-tipis min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7">
        <p className="text-[14.5px] font-semibold text-ink">{t.disetelUntuk}</p>
        <p className="mt-1 text-[12.5px] leading-snug text-ink-3">{t.disetelIsi}</p>

        {/* --- 1. Jenis usaha ------------------------------------------------ */}
        <PertanyaanOnboarding nomor={1} judul={t.tanyaUsaha} terjawab={!!jenis}>
          <div role="tablist" className="onb-tab">
            {KELOMPOK_JENIS.map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={kelompok === k}
                onClick={() => setKelompok(k)}
                className="onb-tab-butir"
              >
                {t.kelompok[k] ?? k}
                {JENIS_USAHA.some((j) => j.kelompok === k && j.nilai === jenis) && (
                  <span className="onb-tab-titik" aria-hidden />
                )}
              </button>
            ))}
          </div>
          <div key={kelompok} className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {JENIS_USAHA.filter((j) => j.kelompok === kelompok).map((j, i) => {
              const dipilih = jenis === j.nilai
              return (
                <button
                  key={j.nilai}
                  aria-pressed={dipilih}
                  onClick={() => setJenis(dipilih ? null : j.nilai)}
                  className="onb-kartu group"
                  style={{ animationDelay: `${i * 35}ms` }}
                >
                  <span className="onb-ikon">
                    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
                      <path d={j.glif} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="mt-2 block text-[13px] font-semibold leading-tight text-ink">
                    {ing ? j.labelEn : j.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">
                    {ing ? j.contohEn : j.contoh}
                  </span>
                  <span className="onb-centang" aria-hidden>
                    <svg width="10" height="10" viewBox="0 0 24 24">
                      <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>
              )
            })}
          </div>
        </PertanyaanOnboarding>

        {/* --- 2. Kawasan ---------------------------------------------------- */}
        <PertanyaanOnboarding nomor={2} judul={t.tanyaKawasan} terjawab={!!kawasan}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {KAWASAN_PILOT.map((k) => {
              const dipilih = kawasan === k.nama
              return (
                <button
                  key={k.nama}
                  aria-pressed={dipilih}
                  onClick={() => setKawasan(dipilih ? null : k.nama)}
                  className="onb-kawasan"
                >
                  <span className="onb-moda" data-moda={k.moda}>
                    {k.moda}
                  </span>
                  <span className="min-w-0 truncate text-[13px] font-semibold text-ink">{k.nama}</span>
                </button>
              )
            })}
          </div>
        </PertanyaanOnboarding>

        {/* --- 3. Anggaran --------------------------------------------------- */}
        <PertanyaanOnboarding nomor={3} judul={t.tanyaAnggaran} catatan={t.opsional} terjawab={!!budget}>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_ANGGARAN.map((jt) => {
              const nilai = jt * 1_000_000
              const dipilih = budget === nilai
              return (
                <button
                  key={jt}
                  aria-pressed={dipilih}
                  onClick={() => setBudget(dipilih ? null : nilai)}
                  className="onb-pil"
                >
                  {t.juta(jt)}
                  <span className="text-ink-3">{t.perBulanPendek}</span>
                </button>
              )
            })}
          </div>
          <div className="relative mt-2.5">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-3">Rp</span>
            <input
              inputMode="numeric"
              aria-label={t.anggaranLain}
              value={budget ? budget.toLocaleString(t.locale) : ''}
              onChange={(e) => {
                const n = Number(e.target.value.replace(/\D/g, ''))
                setBudget(n > 0 ? n : null)
              }}
              placeholder={t.contohAnggaran}
              className={`${KELAS_INPUT} pl-9`}
            />
          </div>
        </PertanyaanOnboarding>
      </div>

      {/* --- Kaki ------------------------------------------------------------ */}
      <div className="border-t border-line/70 px-6 py-4 sm:px-7">
        <div className="mb-3 flex min-h-[1.6rem] flex-wrap items-center gap-1.5 text-[12px]">
          {ringkas.length > 0 ? (
            <>
              <span className="text-ink-3">{t.ringkasan}</span>
              {ringkas.map((r) => (
                <span key={r} className="onb-ringkas">
                  {r}
                </span>
              ))}
            </>
          ) : (
            <span className="text-ink-3">{t.belumDipilih}</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onLewati}
            className="cursor-pointer rounded-full border border-line px-4 py-2.5 text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-surface-2"
          >
            {t.lewati}
          </button>
          <button
            onClick={simpan}
            disabled={sibuk}
            className="group flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-ink px-6 py-2.5 text-[14px] font-semibold text-surface transition-transform duration-300 ease-jelly hover:scale-[1.015] disabled:opacity-60"
          >
            {sibuk && <Pusaran />}
            {sibuk ? t.menyimpan : t.simpanBuka}
            {!sibuk && (
              <svg width="16" height="16" viewBox="0 0 20 20" className="transition-transform duration-300 ease-jelly group-hover:translate-x-0.5" aria-hidden>
                <path d="M4 10h11m-4-4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Satu pertanyaan bernomor. Nomornya berganti jadi centang begitu dijawab. */
function PertanyaanOnboarding({
  nomor,
  judul,
  catatan,
  terjawab,
  children,
}: {
  nomor: number
  judul: string
  catatan?: string
  terjawab: boolean
  children: ReactNode
}) {
  return (
    <section className="onb-tanya mt-6" data-terjawab={terjawab || undefined}>
      <h3 className="mb-2.5 flex items-center gap-2 text-[13.5px] font-semibold text-ink">
        <span className="onb-nomor" aria-hidden>
          {terjawab ? (
            <svg width="10" height="10" viewBox="0 0 24 24">
              <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            nomor
          )}
        </span>
        {judul}
        {catatan && <span className="text-[11.5px] font-normal text-ink-3">({catatan})</span>}
      </h3>
      {children}
    </section>
  )
}

/**
 * Preferensi usaha: langkah ketiga alur pendaftaran, DAN layar yang bisa dibuka
 * kapan saja dari menu akun. Satu komponen untuk keduanya - kalau dipisah jadi
 * dua formulir, keduanya cepat atau lambat berbeda dalam hal yang tidak
 * disengaja. Persis itu yang terjadi pada daftar jenis usahanya.
 */
export function DialogPreferensi({
  pesan,
  onTutup,
  onSelesai,
}: {
  /** Kalimat keadaan akun dari langkah sebelumnya; kosong = dibuka dari menu. */
  pesan: string | null
  onTutup: () => void
  onSelesai: (hasil: DetailBukaPeta) => void
}) {
  const t = useTeks(K_BAYAR)
  const { premium } = useSesi()
  const judul = pesan === null ? t.preferensi : premium ? t.premiumAktifJudul : t.akunSiapJudul
  return (
    <Tirai judul={judul} onTutup={onTutup} lebar="40rem">
      <OnboardingUsaha
        judul={judul}
        pesan={pesan ?? t.preferensiPesan}
        onSelesai={onSelesai}
        onLewati={onTutup}
      />
    </Tirai>
  )
}
