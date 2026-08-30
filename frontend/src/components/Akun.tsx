/**
 * Akun, masuk/daftar, dan Loconomics Premium.
 *
 * Satu berkas, empat hal yang memang tidak bisa dipisah tanpa merugikan:
 *
 *   SesiProvider    keadaan sesi + PEMILIK kedua dialognya
 *   TombolAkun      tombol di bilah atas (peta maupun gerbang)
 *   DialogAkun      masuk / daftar
 *   DialogLangganan langganan, token, dan layar QRIS
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
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

import { api, GalatAPI, setTiket, adaTiket } from '../lib/api'
import { KARTU_GERBANG } from '../lib/kartu-gerbang'
import { KAWASAN_PILOT } from '../config'
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
  /** Heksagon yang sudah dibuka dengan token oleh akun ini. */
  terbuka: Set<string>
  masuk: (identitas: string, sandi: string) => Promise<void>
  daftar: (p: { nama_pengguna: string; email: string; sandi: string }) => Promise<void>
  keluar: () => void
  segarkan: () => Promise<void>
  tandaiTerbuka: (h3: string) => void
  /**
   * Naik satu setiap kali daftar lokasi tersimpan berubah, dari mana pun.
   * Peta memakainya untuk menyegarkan pin tanpa harus tahu SIAPA yang
   * menyimpan - panel detail dan dialog Tersimpan sama-sama menaikkannya.
   */
  sinyalSimpan: number
  catatSimpan: () => void
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

export function SesiProvider({ anak }: { anak: ReactNode }) {
  const [akun, setAkun] = useState<Akun | null>(null)
  const [memuat, setMemuat] = useState(adaTiket())
  const [terbuka, setTerbuka] = useState<Set<string>>(new Set())

  const [dialogAkun, setDialogAkun] = useState<{ alasan: AlasanKunci } | null>(null)
  const [dialogPaket, setDialogPaket] = useState<{ alasan: AlasanKunci; rayakan: boolean } | null>(
    null,
  )
  const [dialogPreferensi, setDialogPreferensi] = useState(false)

  const muatTerbuka = useCallback(async () => {
    try {
      setTerbuka(new Set(await api.heksagonTerbuka()))
    } catch {
      // Daftar pembukaan cuma optimasi tampilan: tanpa itu, tirai tetap muncul
      // dan backend tetap mengirim isi penuh untuk heksagon yang sudah dibayar.
      // Gagal di sini tidak boleh menghentikan apa pun.
      setTerbuka(new Set())
    }
  }, [])

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
        void muatTerbuka()
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
  }, [muatTerbuka])

  const pakaiSesi = useCallback(
    (s: { tiket: string; akun: Akun }) => {
      setTiket(s.tiket)
      setAkun(s.akun)
      void muatTerbuka()
    },
    [muatTerbuka],
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
    setTerbuka(new Set())
  }, [])

  const segarkan = useCallback(async () => {
    try {
      setAkun(await api.akunSaya())
    } catch {
      keluar()
    }
  }, [keluar])

  const tandaiTerbuka = useCallback((h3: string) => {
    setTerbuka((s) => (s.has(h3) ? s : new Set(s).add(h3)))
  }, [])

  const [sinyalSimpan, setSinyalSimpan] = useState(0)
  const catatSimpan = useCallback(() => setSinyalSimpan((n) => n + 1), [])

  const mintaMasuk = useCallback((alasan: AlasanKunci = null) => {
    setDialogAkun({ alasan })
  }, [])

  const mintaPreferensi = useCallback(() => setDialogPreferensi(true), [])

  const mintaLangganan = useCallback(
    (alasan: AlasanKunci = null) => {
      // Belum masuk? Masuk dulu. Menampilkan etalase harga kepada orang yang
      // belum punya akun berakhir di jalan buntu: ia menekan "Bayar", lalu
      // baru diminta mendaftar, dan kehilangan konteks kenapa ia di sini.
      if (!akun) setDialogAkun({ alasan: alasan ?? 'Masuk dulu untuk berlangganan.' })
      else setDialogPaket({ alasan, rayakan: false })
    },
    [akun],
  )

  const nilai = useMemo<IsiSesi>(
    () => ({
      akun,
      tingkat: akun ? akun.tingkat : 'tamu',
      premium: akun?.tingkat === 'premium',
      memuat,
      terbuka,
      masuk,
      daftar,
      keluar,
      segarkan,
      tandaiTerbuka,
      sinyalSimpan,
      catatSimpan,
      mintaMasuk,
      mintaLangganan,
      mintaPreferensi,
    }),
    [akun, memuat, terbuka, masuk, daftar, keluar, segarkan, tandaiTerbuka, sinyalSimpan, catatSimpan, mintaMasuk, mintaLangganan, mintaPreferensi],
  )

  return (
    <Konteks.Provider value={nilai}>
      {anak}
      {dialogAkun && (
        <DialogAkun
          alasan={dialogAkun.alasan}
          onTutup={() => setDialogAkun(null)}
          onBerhasil={(baru) => {
            setDialogAkun(null)
            // Sesudah MENDAFTAR, langsung tawarkan Premium - permintaan
            // eksplisit pemilik repo. Sesudah MASUK, jangan: orang yang kembali
            // ke akunnya sedang menuju sesuatu, dan etalase harga di tengah
            // jalan itu terbaca sebagai penghalang, bukan sebagai tawaran.
            if (baru) setDialogPaket({ alasan: null, rayakan: true })
          }}
        />
      )}
      {dialogPaket && (
        <DialogLangganan
          alasan={dialogPaket.alasan}
          rayakan={dialogPaket.rayakan}
          onTutup={() => setDialogPaket(null)}
        />
      )}
      {dialogPreferensi && <DialogPreferensi onTutup={() => setDialogPreferensi(false)} />}
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
      className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-ink/45 p-4 backdrop-blur-[4px] sm:p-6"
      onClick={onTutup}
      role="dialog"
      aria-modal="true"
      aria-label={judul}
    >
      <div
        className="kaca-tebal melayang my-auto w-full overflow-hidden rounded-xl"
        style={{ maxWidth: lebar }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
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
  const [mode, setMode] = useState<'masuk' | 'daftar'>('masuk')
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
      if (namaPengguna.trim().length < 3) return setGalat('Nama pengguna minimal 3 karakter.')
      if (!/^[\w.-]+$/.test(namaPengguna.trim()))
        return setGalat('Nama pengguna hanya boleh huruf, angka, titik, _ dan -.')
      if (!email.includes('@')) return setGalat('Surelnya belum lengkap.')
      if (sandi.length < 8) return setGalat('Kata sandi minimal 8 karakter.')
    } else if (!identitas.trim() || !sandi) {
      return setGalat('Isi dulu keduanya.')
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
          : 'Tidak bisa menghubungi server. Periksa koneksi lalu coba lagi.',
      )
    } finally {
      setSibuk(false)
    }
  }

  const gantiMode = (m: 'masuk' | 'daftar') => {
    setMode(m)
    setGalat(null)
    setSandi('')
  }

  return (
    <Tirai judul={mode === 'masuk' ? 'Masuk' : 'Daftar'} onTutup={onTutup} lebar="52rem">
      <div className="flex flex-col sm:flex-row">
        {/* --- Sisi kiri: kenapa harus punya akun -------------------------- */}
        <aside className="relative hidden shrink-0 overflow-hidden bg-[#0b3d37] p-7 text-white sm:block sm:w-[19rem]">
          {/* Latarnya POTRET PETA SUNGGUHAN - salah satu kartu WebP halaman
              gerbang, dirender dari basis data dengan ekspresi pewarnaan yang
              sama dengan aplikasi. Pola heksagon dekoratif yang dulu di sini
              cuma wallpaper; ini memperlihatkan barang yang sebenarnya sedang
              didaftari orangnya. */}
          <img
            src={`/kartu/${(KARTU_GERBANG.find((k) => k.utama) ?? KARTU_GERBANG[0]).berkas}.webp`}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full scale-[1.12] object-cover opacity-90"
          />
          {/* Dua gradien: bawah menggelap supaya teks putihnya selalu lolos
              kontras, atas tipis supaya potret petanya tetap terlihat hidup. */}
          <div className="absolute inset-0 bg-gradient-to-b from-[#0b3d37]/70 via-[#0b3d37]/45 to-[#06231f]/95" aria-hidden />
          <div className="relative">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
              Loconomics
            </p>
            <h2 className="papan mt-3 text-[25px] leading-[1.15] text-white">
              Data survei,
              <br />
              bukan firasat.
            </h2>
            <p className="mt-3.5 text-[13.5px] leading-relaxed text-white/75">
              Akun gratis menyimpan pantauan dan preferensi Anda. Premium membuka
              kedalaman datanya.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                ['43 variabel', 'Seluruh angka pembentuk indeks, bukan ringkasannya'],
                ['Komparasi', 'Empat lokasi berdampingan dalam satu tabel'],
                ['Laporan PDF', 'Dokumen resmi untuk pengajuan modal atau sewa'],
              ].map(([j, k]) => (
                <li key={j} className="flex gap-2.5">
                  <Centang />
                  <span className="text-[13px] leading-snug">
                    <strong className="font-semibold text-white">{j}</strong>
                    <span className="block text-white/60">{k}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* --- Sisi kanan: formulir ---------------------------------------- */}
        <div className="min-w-0 flex-1 p-6 sm:p-7">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="papan text-[20px]">
                {mode === 'masuk' ? 'Masuk ke Loconomics' : 'Buat akun Loconomics'}
              </h2>
              {alasan && <p className="mt-1 text-[13px] leading-snug text-ink-2">{alasan}</p>}
            </div>
            <TombolTutup onTutup={onTutup} />
          </div>

          {/* Sakelar dua posisi dengan penunjuk yang menggeser. Transform,
              bukan lebar - lihat CLAUDE.md soal properti yang murah dianimasikan. */}
          <div className="relative mb-5 grid grid-cols-2 rounded-full bg-surface-2 p-1">
            <div
              className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-ink transition-transform duration-300 ease-liquid"
              style={{ transform: mode === 'daftar' ? 'translateX(100%)' : 'none' }}
              aria-hidden
            />
            {(['masuk', 'daftar'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => gantiMode(m)}
                className={`relative cursor-pointer rounded-full py-2 text-[13.5px] font-semibold transition-colors duration-300 ${
                  mode === m ? 'text-surface' : 'text-ink-2 hover:text-ink'
                }`}
              >
                {m === 'masuk' ? 'Masuk' : 'Daftar'}
              </button>
            ))}
          </div>

          <form onSubmit={kirim} className="space-y-3.5">
            {mode === 'masuk' ? (
              <Kolom label="Nama pengguna atau surel">
                <input
                  ref={pertama}
                  className={KELAS_INPUT}
                  value={identitas}
                  onChange={(e) => setIdentitas(e.target.value)}
                  autoComplete="username"
                  placeholder="nama pengguna atau surel Anda"
                />
              </Kolom>
            ) : (
              <>
                <Kolom label="Nama pengguna">
                  <input
                    ref={pertama}
                    className={KELAS_INPUT}
                    value={namaPengguna}
                    onChange={(e) => setNamaPengguna(e.target.value)}
                    autoComplete="username"
                    placeholder="mis. calonjuragan"
                  />
                </Kolom>
                <Kolom label="Surel">
                  <input
                    type="email"
                    className={KELAS_INPUT}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    placeholder="nama@surel.com"
                  />
                </Kolom>
              </>
            )}

            <Kolom label="Kata sandi">
              <div className="relative">
                <input
                  type={lihatSandi ? 'text' : 'password'}
                  className={`${KELAS_INPUT} pr-[4.5rem]`}
                  value={sandi}
                  onChange={(e) => setSandi(e.target.value)}
                  autoComplete={mode === 'masuk' ? 'current-password' : 'new-password'}
                  placeholder={mode === 'daftar' ? 'minimal 8 karakter' : 'kata sandi Anda'}
                />
                <button
                  type="button"
                  onClick={() => setLihatSandi((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-xs px-2 py-1 text-[12px] font-medium text-ink-3 transition-colors hover:text-ink"
                >
                  {lihatSandi ? 'Sembunyi' : 'Lihat'}
                </button>
              </div>
            </Kolom>

            {galat && (
              <div
                role="alert"
                className="rounded-sm border border-bahaya/30 bg-bahaya-soft px-3.5 py-2.5 text-[13px] leading-snug text-bahaya"
              >
                {galat}
              </div>
            )}

            <button
              type="submit"
              disabled={sibuk}
              className="mt-1 flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-full bg-ink px-6 py-3 text-[14.5px] font-semibold text-surface transition-all duration-300 ease-jelly hover:scale-[1.015] disabled:cursor-wait disabled:opacity-60"
            >
              {sibuk && <Pusaran />}
              {sibuk
                ? 'Sebentar…'
                : mode === 'masuk'
                  ? 'Masuk'
                  : 'Buat akun — gratis'}
            </button>
          </form>

          <p className="mt-4 text-[12px] leading-snug text-ink-3">
            {mode === 'masuk' ? (
              <>
                Belum punya akun?{' '}
                <button
                  onClick={() => gantiMode('daftar')}
                  className="cursor-pointer font-semibold text-ink underline-offset-2 hover:underline"
                >
                  Daftar gratis
                </button>
                .
              </>
            ) : (
              <>
                Akun gratis tetap bisa melihat seluruh grid heksagon, skor, dan status
                zonasi. Yang berbayar cuma kedalaman datanya.
              </>
            )}
          </p>
        </div>
      </div>
    </Tirai>
  )
}

// ---------------------------------------------------------------------------
// Dialog langganan
// ---------------------------------------------------------------------------

const rp = (n: number) => `Rp${n.toLocaleString('id-ID')}`

function DialogLangganan({
  alasan,
  rayakan,
  onTutup,
}: {
  alasan: AlasanKunci
  /** Dibuka tepat sesudah mendaftar: sapaannya berbeda. */
  rayakan: boolean
  onTutup: () => void
}) {
  const { akun, segarkan } = useSesi()
  const [katalog, setKatalog] = useState<KatalogPaket | null>(null)
  const [tab, setTab] = useState<'langganan' | 'token'>('langganan')
  const [pilih, setPilih] = useState<string | null>(null)
  const [sibuk, setSibuk] = useState(false)
  const [galat, setGalat] = useState<string | null>(null)
  const [sukses, setSukses] = useState<string | null>(null)

  useEffect(() => {
    api
      .katalogPaket()
      .then(setKatalog)
      .catch(() => setGalat('Gagal memuat daftar paket.'))
  }, [])

  const bayar = async () => {
    if (!pilih || sibuk) return
    setSibuk(true)
    setGalat(null)
    try {
      if (tab === 'langganan') {
        await api.berlangganan(pilih)
        setSukses('Loconomics Premium aktif. Seluruh fitur terbuka.')
      } else {
        const a = await api.beliToken(pilih)
        setSukses(`Token masuk. Saldo Anda sekarang ${a.saldo_token}.`)
      }
      await segarkan()
    } catch (err) {
      setGalat(err instanceof GalatAPI ? err.message : 'Aktivasi gagal. Coba lagi.')
    } finally {
      setSibuk(false)
    }
  }

  if (sukses) {
    // Sesudah langganan aktif, layar ini BUKAN sekadar tanda centang: ia
    // menanyakan usaha apa dan di mana, lalu menyetel peta ke sana. Ditanyakan
    // di sini karena inilah satu-satunya saat orangnya sudah pasti berhenti
    // dan membaca - sesudah ini ia akan langsung menuju petanya.
    return (
      <Tirai judul="Selamat datang di Premium" onTutup={onTutup} lebar="34rem">
        <OnboardingUsaha pesan={sukses} onSelesai={onTutup} />
      </Tirai>
    )
  }

  const paketTerpilih =
    tab === 'langganan'
      ? katalog?.langganan.find((p) => p.kode === pilih)
      : katalog?.token.find((p) => p.kode === pilih)
  const harga = paketTerpilih?.harga_rp ?? null

  return (
    <Tirai judul="Loconomics Premium" onTutup={onTutup} lebar="56rem">
      <div className="flex max-h-[86vh] flex-col">
        {/* --- Kepala ------------------------------------------------------ */}
        <div className="flex items-start justify-between gap-5 border-b border-line/70 px-6 py-5 sm:px-7">
          <div className="min-w-0">
            <p className="eyebrow">{rayakan ? 'Akun Anda sudah aktif' : 'Loconomics Premium'}</p>
            <h2 className="papan mt-1 text-[21px] leading-tight">
              {rayakan ? 'Satu langkah lagi sebelum mulai' : 'Buka seluruh kedalaman datanya'}
            </h2>
            <p className="mt-1.5 max-w-[34rem] text-[13.5px] leading-snug text-ink-2">
              {alasan ??
                (rayakan
                  ? 'Akun gratis sudah bisa melihat peta, skor, dan zonasi. Premium yang membuka 43 variabel, komparasi, pemantauan, dan Laporan Kelayakan.'
                  : 'Satu langganan membuka semuanya. Tanpa ikatan — berhenti kapan saja.')}
            </p>
          </div>
          <TombolTutup onTutup={onTutup} />
        </div>

        <div className="scroll-tipis min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-6 p-6 sm:p-7 lg:flex-row">
            {/* --- Kiri: pilihan paket ---------------------------------- */}
            <div className="min-w-0 flex-1">
              <div className="mb-4 inline-flex rounded-full bg-surface-2 p-1">
                {(['langganan', 'token'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setTab(t)
                      setPilih(null)
                    }}
                    className={`cursor-pointer rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${
                      tab === t ? 'bg-ink text-surface' : 'text-ink-2 hover:text-ink'
                    }`}
                  >
                    {t === 'langganan' ? 'Langganan' : 'Token satuan'}
                  </button>
                ))}
              </div>

              {!katalog ? (
                <p className="text-[13.5px] text-ink-3">Memuat paket…</p>
              ) : tab === 'langganan' ? (
                <div className="space-y-3">
                  {/* Tingkat GRATIS ditulis sebagai kartu, bukan disembunyikan.
                      Orang yang baru mendaftar berhak melihat apa yang SUDAH ia
                      dapat tanpa membayar - etalase yang cuma memuat satu harga
                      terbaca sebagai dinding, dan dinding di layar kedua sesudah
                      mendaftar adalah tempat orang berhenti. */}
                  <div className="rounded-md border border-line bg-surface p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="papan text-[15px]">Gratis</span>
                        <p className="mt-1 text-[12.5px] leading-snug text-ink-3">
                          Sudah aktif di akun Anda. Tanpa batas waktu.
                        </p>
                      </div>
                      <span className="tabular shrink-0 text-[15px] font-semibold text-ink">
                        Rp0
                      </span>
                    </div>
                    <ul className="mt-3 space-y-1.5 border-t border-line/60 pt-3">
                      {[
                        'Seluruh grid heksagon di enam kawasan',
                        'Skor peluang, Hidden Gem, dan keempat kuadrannya',
                        'Status zonasi ZoneGuard dan peringatan RiskRadar',
                        'Daftar lokasi, pencarian, dan Konsultan AI',
                      ].map((r) => (
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
                      harga={`${rp(p.harga_rp)} / ${p.satuan}`}
                      catatan={`Berlaku ${p.hari} hari, otomatis berakhir — tidak ada tagihan berulang.`}
                      unggulan={p.unggulan}
                      rincian={p.rincian}
                    />
                  ))}
                </div>
              ) : (
                <>
                  <p className="mb-3 text-[13px] leading-snug text-ink-2">
                    Untuk yang butuh satu-dua lokasi saja. 1 token membuka seluruh
                    variabel satu heksagon <strong className="font-semibold text-ink">selamanya</strong>;{' '}
                    {katalog.biaya_token.laporan ?? 2} token untuk satu Laporan Kelayakan.
                  </p>
                  <div className="space-y-3">
                    {katalog.token.map((p) => (
                      <KartuPaket
                        key={p.kode}
                        dipilih={pilih === p.kode}
                        onPilih={() => setPilih(p.kode)}
                        judul={`${p.nama} — ${p.token} token`}
                        harga={rp(p.harga_rp)}
                        catatan={`≈ ${rp(Math.round(p.harga_rp / p.token))} per lokasi`}
                      />
                    ))}
                  </div>
                  <p className="mt-3.5 rounded-sm bg-surface-2 px-3.5 py-2.5 text-[12.5px] leading-snug text-ink-2">
                    Berlangganan {rp(katalog.langganan[0]?.harga_rp ?? 25000)} sebulan membuka
                    semuanya tanpa hitungan token — lebih murah begitu Anda melihat lebih dari
                    sepuluh lokasi.
                  </p>
                </>
              )}
            </div>

            {/* --- Kanan: pembayaran ------------------------------------ */}
            <div className="w-full shrink-0 lg:w-[19rem]">
              <div className="rounded-md border border-line bg-surface-2/60 p-5">
                <h3 className="eyebrow mb-3">Pembayaran</h3>

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
                      Kode pembayaran tampil di sini
                    </p>
                  </div>
                </div>

                <dl className="mt-4 space-y-1.5 border-t border-line/70 pt-3.5 text-[13px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-3">Paket</dt>
                    <dd className="truncate text-right font-medium text-ink">
                      {paketTerpilih?.nama ?? '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-3">Total</dt>
                    <dd className="tabular text-right font-semibold text-ink">
                      {harga === null ? '—' : rp(harga)}
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
                  {sibuk ? 'Mengaktifkan…' : pilih ? 'Aktifkan sekarang' : 'Pilih paket dulu'}
                </button>

                {/* Keadaan pembayaran dikatakan apa adanya. Ini yang membedakan
                    layar berbayar yang jujur dari layar berbayar palsu. */}
                <p className="mt-3 text-[11.5px] leading-snug text-ink-3">
                  {katalog?.catatan_pembayaran ??
                    'Gerbang pembayaran belum terpasang di lingkungan ini.'}
                </p>
              </div>

              {akun && (
                <p className="mt-3 text-center text-[12px] text-ink-3">
                  Masuk sebagai <strong className="font-semibold text-ink-2">{akun.nama_pengguna}</strong>
                  {akun.saldo_token > 0 && ` · ${akun.saldo_token} token`}
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
                Paling hemat
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
export function TombolAkun({ varian = 'peta' }: { varian?: 'peta' | 'gerbang' }) {
  const { akun, premium, memuat, keluar, mintaMasuk, mintaLangganan, mintaPreferensi } = useSesi()
  const [buka, setBuka] = useState(false)
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
    const kelas =
      varian === 'gerbang'
        ? 'g-utama group inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold'
        : 'group inline-flex cursor-pointer items-center gap-2 rounded-full bg-ink px-3.5 py-2 text-[12.5px] font-semibold text-surface transition-all duration-300 ease-jelly hover:scale-[1.03]'
    return (
      <div ref={wadah} className="relative shrink-0">
        <button
          onClick={() => mintaMasuk(null)}
          disabled={memuat}
          className={kelas}
          title="Masuk atau daftar"
        >
          <Kilau />
          <span className="hidden sm:inline">Sign Up untuk akses semua fitur</span>
          <span className="sm:hidden">Sign Up</span>
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
        }`}
        title={akun.nama_pengguna}
      >
        <span
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11.5px] font-bold ${
            premium ? 'bg-gem text-white' : 'bg-surface-2 text-ink-2'
          }`}
        >
          {inisial}
        </span>
        <span className="hidden max-w-[7rem] truncate text-[12.5px] font-semibold sm:inline">
          {akun.nama_pengguna}
        </span>
        {premium && (
          <span className="hidden rounded-full bg-gem-soft px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-gem md:inline">
            Premium
          </span>
        )}
      </button>

      {buka && (
        <div
          role="menu"
          className="kaca-tebal pop pop-kanan absolute right-0 top-[calc(100%+8px)] z-50 w-[19rem] overflow-hidden rounded-md"
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
                {premium ? 'Premium' : 'Gratis'}
              </span>
              {akun.peran === 'admin' && (
                <span className="rounded-full bg-pemenang-soft px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-pemenang">
                  Admin
                </span>
              )}
              <span className="tabular ml-auto text-[12px] text-ink-3">
                {akun.saldo_token} token
              </span>
            </div>

            {premium ? (
              <p className="mt-2.5 text-[12px] leading-snug text-ink-3">
                {akun.langganan?.selamanya
                  ? 'Berlaku selamanya.'
                  : akun.langganan?.berlaku_sampai
                    ? `Aktif sampai ${new Date(akun.langganan.berlaku_sampai).toLocaleDateString(
                        'id-ID',
                        { day: 'numeric', month: 'long', year: 'numeric' },
                      )}.`
                    : 'Langganan aktif.'}
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
                Jadi Premium — {rp(25000)}/bln
              </button>
            )}
          </div>

          <div className="p-1.5">
            <BarisMenu
              onClick={() => {
                setBuka(false)
                mintaPreferensi()
              }}
              label="Preferensi usaha"
              catatan="Jenis usaha, kawasan incaran, dan anggaran sewa"
            />
            {!premium && (
              <BarisMenu
                onClick={() => {
                  setBuka(false)
                  mintaLangganan(null)
                }}
                label="Beli token satuan"
                catatan="Buka satu lokasi tanpa berlangganan"
              />
            )}
            <BarisMenu
              onClick={() => {
                setBuka(false)
                keluar()
              }}
              label="Keluar"
              catatan={`Sesi ${akun.nama_pengguna} diakhiri`}
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

/** Sama dengan JENIS_USAHA di backend. Dijaga manual - lihat Simulasi.tsx. */
const JENIS_ONBOARDING = [
  { nilai: 'kuliner_ringan', label: 'Kopi & jajanan', contoh: 'kedai kopi, roti bakar' },
  { nilai: 'warung_makan', label: 'Warung makan', contoh: 'nasi, mi ayam, soto' },
  { nilai: 'retail_kecil', label: 'Kelontong & ATK', contoh: 'sembako, fotokopi' },
  { nilai: 'jasa', label: 'Jasa', contoh: 'barbershop, laundry' },
]

/**
 * Tiga pertanyaan, seluruhnya boleh dilewati.
 *
 * Yang dijawab menyetel dua hal nyata: jenis usaha jadi bawaan panel simulasi,
 * kawasan memindahkan peta ke sana. Yang TIDAK berubah karenanya: satu pun
 * skor, peringkat, atau kuadran - itu tetap milik pipeline, dan preferensi
 * pengguna tidak pernah boleh menyentuhnya.
 */
function OnboardingUsaha({
  pesan,
  onSelesai,
  judul = 'Premium aktif',
}: {
  pesan: string
  onSelesai: () => void
  /** Berbeda saat dibuka sebagai preferensi biasa, bukan sesudah berlangganan. */
  judul?: string
}) {
  const { akun, segarkan } = useSesi()
  const [jenis, setJenis] = useState<string | null>(akun?.preferensi?.jenis_usaha ?? null)
  const [kawasan, setKawasan] = useState<string | null>(akun?.preferensi?.kawasan ?? null)
  const [budget, setBudget] = useState<string>(
    akun?.preferensi?.budget_sewa_bulanan ? String(akun.preferensi.budget_sewa_bulanan) : '',
  )
  const [sibuk, setSibuk] = useState(false)

  const simpan = async () => {
    setSibuk(true)
    try {
      await api.simpanPreferensi({
        jenis_usaha: jenis,
        kawasan,
        budget_sewa_bulanan: budget ? Number(budget.replace(/\D/g, '')) || null : null,
      })
      await segarkan()
    } catch {
      // Preferensi gagal disimpan tidak boleh menahan orang di layar ini -
      // langganannya SUDAH aktif, dan itu yang penting. Ia bisa mengisinya
      // lagi nanti dari menu akun.
    } finally {
      setSibuk(false)
      onSelesai()
    }
  }

  return (
    <div className="p-6 sm:p-7">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gem-soft">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
            <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="var(--color-gem)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div className="min-w-0">
          <h2 className="papan text-[19px] leading-tight">{judul}</h2>
          <p className="mt-1 text-[13px] leading-snug text-ink-2">{pesan}</p>
        </div>
      </div>

      <div className="mt-6 border-t border-line/70 pt-5">
        <p className="text-[14.5px] font-semibold text-ink">
          Sebentar — Loconomics mau disetel untuk siapa?
        </p>
        <p className="mt-1 text-[12.5px] leading-snug text-ink-3">
          Jawabannya menyetel bawaan simulasi dan kawasan yang dibuka lebih dulu.
          Tidak ada skor yang berubah, dan semuanya bisa diganti kapan saja.
        </p>

        <p className="eyebrow mt-5 mb-2">Rencana usaha</p>
        <div className="grid grid-cols-2 gap-2">
          {JENIS_ONBOARDING.map((j) => (
            <button
              key={j.nilai}
              onClick={() => setJenis(jenis === j.nilai ? null : j.nilai)}
              className={`cursor-pointer rounded-sm border p-2.5 text-left transition-colors ${
                jenis === j.nilai
                  ? 'border-gem bg-gem-soft/40'
                  : 'border-line hover:border-line-2'
              }`}
            >
              <span className="block text-[13px] font-semibold text-ink">{j.label}</span>
              <span className="block text-[11px] leading-snug text-ink-3">{j.contoh}</span>
            </button>
          ))}
        </div>

        <p className="eyebrow mt-5 mb-2">Kawasan yang diincar</p>
        <div className="flex flex-wrap gap-1.5">
          {KAWASAN_PILOT.map((k) => (
            <button
              key={k.nama}
              onClick={() => setKawasan(kawasan === k.nama ? null : k.nama)}
              className={`cursor-pointer rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                kawasan === k.nama
                  ? 'border-ink bg-ink text-surface'
                  : 'border-line text-ink-2 hover:border-line-2 hover:text-ink'
              }`}
            >
              {k.nama}
            </button>
          ))}
        </div>

        <p className="eyebrow mt-5 mb-2">Anggaran sewa per bulan (opsional)</p>
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-3">
            Rp
          </span>
          <input
            inputMode="numeric"
            value={budget ? Number(budget.replace(/\D/g, '') || 0).toLocaleString('id-ID') : ''}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="mis. 15.000.000"
            className={`${KELAS_INPUT} pl-9`}
          />
        </div>
      </div>

      <div className="mt-6 flex gap-2">
        <button
          onClick={onSelesai}
          className="cursor-pointer rounded-full border border-line px-4 py-2.5 text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-surface-2"
        >
          Lewati
        </button>
        <button
          onClick={simpan}
          disabled={sibuk}
          className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-ink px-6 py-2.5 text-[14px] font-semibold text-surface transition-transform duration-300 ease-jelly hover:scale-[1.015] disabled:opacity-60"
        >
          {sibuk && <Pusaran />}
          {sibuk ? 'Menyimpan…' : 'Simpan & buka peta'}
        </button>
      </div>
    </div>
  )
}

/**
 * Preferensi yang bisa dibuka kapan saja, bukan cuma sekali saat berlangganan.
 *
 * Isi ulangnya memakai komponen yang sama dengan onboarding - kalau dipisah
 * jadi dua formulir, keduanya cepat atau lambat akan berbeda dalam hal yang
 * tidak disengaja.
 */
export function DialogPreferensi({ onTutup }: { onTutup: () => void }) {
  return (
    <Tirai judul="Preferensi usaha" onTutup={onTutup} lebar="34rem">
      <OnboardingUsaha
        judul="Preferensi usaha"
        pesan="Kriteria ini menyaring rekomendasi dan menyetel bawaan simulasi. Tidak ada skor yang berubah karenanya."
        onSelesai={onTutup}
      />
    </Tirai>
  )
}
