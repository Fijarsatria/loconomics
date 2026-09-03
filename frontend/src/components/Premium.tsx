/**
 * Empat alat berbayar, sesuai tabel fitur.
 *
 *   MenuKawasan      "filter multi-kawasan secara simultan"      (baris 1)
 *   DialogKomparasi  "side-by-side comparison beberapa titik"    (baris 4)
 *   DialogPantauan   "pemantauan churn rate & dinamika kawasan"  (baris 5)
 *   BagianRiwayat    "riwayat perubahan skor"                    (baris 2)
 *
 * Baris 3 (43 variabel granular) tidak di sini - ia sudah hidup di dalam
 * PanelInsight dan cukup ditutup tirai. Baris 6 (PDF Export) juga tidak: ia
 * satu tombol, dan tombolnya duduk di tempat dokumennya diterbitkan.
 *
 * SATU KEPUTUSAN YANG BERULANG DI SELURUH BERKAS INI, dan yang paling mudah
 * dilanggar tanpa sadar: kalau datanya tidak ada, katakan tidak ada. Riwayat
 * dari satu versi skor bukan tren; dinamika dari satu potret bukan deret waktu.
 * Backend sudah mengirim `cukup_untuk_tren` dan `catatan` justru supaya
 * frontend tidak perlu menebak - dan supaya tidak ada yang tergoda menggambar
 * garis mendatar yang terlihat meyakinkan.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  KAWASAN_PILOT,
  KUADRAN,
  LABEL_SEMUA_KAWASAN,
  SEMUA_KAWASAN,
  kodeLokasi,
} from '../config'
import { api, GalatAPI } from '../lib/api'
import { angka, rupiah } from '../lib/format'
import type {
  ButirPantauan,
  DinamikaKawasan,
  Komparasi,
  Kuadran as NamaKuadran,
  RiwayatSkor,
} from '../types'
import { useSesi } from './Akun'
import { Badge, Glif, Kosong, Memuat, Terkunci } from './primitif'

// ---------------------------------------------------------------------------
// Kerangka dialog (sama dengan Akun.tsx — createPortal, lihat CLAUDE.md)
// ---------------------------------------------------------------------------

function Lembar({
  judul,
  keterangan,
  onTutup,
  lebar = '62rem',
  aksi,
  children,
}: {
  judul: string
  keterangan?: string
  onTutup: () => void
  lebar?: string
  /** Tombol tambahan di kepala lembar, mis. "Unduh PDF". */
  aksi?: React.ReactNode
  children: React.ReactNode
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onTutup()
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onTutup])

  return createPortal(
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-ink/45 p-4 backdrop-blur-[4px] sm:p-6"
      onClick={onTutup}
      role="dialog"
      aria-modal="true"
      aria-label={judul}
    >
      <div
        className="kaca-tebal melayang flex max-h-[88vh] w-full flex-col overflow-hidden rounded-xl"
        style={{ maxWidth: lebar }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-5 border-b border-line/70 px-6 py-4">
          <div className="min-w-0">
            <h2 className="papan text-[19px] leading-tight">{judul}</h2>
            {keterangan && (
              <p className="mt-1 max-w-[52ch] text-[12.5px] leading-snug text-ink-3">
                {keterangan}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {aksi}
            <button
              onClick={onTutup}
              className="cursor-pointer rounded-full border border-line px-4 py-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              Tutup
            </button>
          </div>
        </div>
        <div className="scroll-tipis min-h-0 flex-1 overflow-auto">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// 1 · Filter multi-kawasan
// ---------------------------------------------------------------------------

/**
 * Pengganti menu Kawasan yang bisa memilih beberapa sekaligus.
 *
 * `nilai` tetap SATU STRING, bukan array — 'Bekasi,Depok Baru'. Bentuk itu
 * dipilih supaya seluruh rantai yang sudah ada tidak perlu diubah: state di
 * App, parameter kueri, dan kunci cache backend semuanya sudah berupa string,
 * dan mengubahnya jadi array berarti menyentuh belasan tempat demi keuntungan
 * yang nol.
 *
 * Untuk yang belum berlangganan, menunya tetap BEKERJA PENUH sebagai pemilih
 * tunggal - keenam kawasan tetap bisa dibuka satu per satu, dan "Semua kawasan"
 * tetap ada. Yang terkunci cuma kemampuan menggabungkan beberapa. Mengunci
 * seluruh menunya akan melanggar baris pertama tabel fitur sendiri, yang
 * menyatakan seluruh grid terbuka untuk dilihat.
 */
export function MenuKawasan({
  nilai,
  onUbah,
}: {
  nilai: string
  onUbah: (v: string) => void
}) {
  const { premium, mintaLangganan } = useSesi()
  const [buka, setBuka] = useState(false)
  const wadah = useRef<HTMLDivElement>(null)

  const dipilih = useMemo(
    () => (nilai === SEMUA_KAWASAN ? [] : nilai.split(',').filter(Boolean)),
    [nilai],
  )

  useEffect(() => {
    if (!buka) return
    const luar = (e: MouseEvent) => {
      if (!wadah.current?.contains(e.target as Node)) setBuka(false)
    }
    const kunci = (e: KeyboardEvent) => e.key === 'Escape' && setBuka(false)
    document.addEventListener('mousedown', luar)
    document.addEventListener('keydown', kunci)
    return () => {
      document.removeEventListener('mousedown', luar)
      document.removeEventListener('keydown', kunci)
    }
  }, [buka])

  const label =
    dipilih.length === 0
      ? LABEL_SEMUA_KAWASAN
      : dipilih.length === 1
        ? dipilih[0]
        : `${dipilih.length} kawasan`

  const alih = (nama: string) => {
    if (!premium) {
      onUbah(nama) // pemilih tunggal, persis seperti sebelumnya
      setBuka(false)
      return
    }
    const baru = dipilih.includes(nama)
      ? dipilih.filter((k) => k !== nama)
      : [...dipilih, nama]
    // Nol terpilih berarti "semua" — bukan "tidak ada". Peta kosong tanpa
    // sebab yang terlihat adalah kegagalan yang paling membingungkan.
    onUbah(baru.length === 0 ? SEMUA_KAWASAN : baru.join(','))
  }

  return (
    <div ref={wadah} className="relative shrink-0">
      <button
        onClick={() => setBuka((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={buka}
        className={`flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors ${
          buka
            ? 'border-line-2 bg-surface'
            : 'border-line bg-surface/60 hover:border-line-2 hover:bg-surface'
        }`}
      >
        <span className="eyebrow hidden 2xl:inline">Kawasan</span>
        <span className="whitespace-nowrap">{label}</span>
        {dipilih.length > 1 && (
          <span className="rounded-full bg-gem px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-white">
            Multi
          </span>
        )}
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden
          className={`text-ink-3 transition-transform duration-200 ease-liquid ${buka ? 'rotate-180' : ''}`}
        >
          <path d="M1 3.5 5 7.5 9 3.5" stroke="currentColor" strokeWidth="1.7" fill="none" />
        </svg>
      </button>

      {buka && (
        <div
          role="listbox"
          aria-label="Kawasan"
          className="kaca-tebal pop pop-kanan absolute right-0 top-[calc(100%+8px)] z-50 w-[17rem] overflow-hidden rounded-md"
        >
          <div className="p-1.5">
            <button
              role="option"
              aria-selected={dipilih.length === 0}
              onClick={() => {
                onUbah(SEMUA_KAWASAN)
                setBuka(false)
              }}
              className={`flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-3 py-2 text-left text-[13.5px] transition-colors hover:bg-surface-2 ${
                dipilih.length === 0 ? 'font-semibold' : 'font-medium text-ink-2'
              }`}
            >
              <Kotak aktif={dipilih.length === 0} bulat />
              {LABEL_SEMUA_KAWASAN}
              <span className="ml-auto text-[12px] text-ink-3">6 kawasan</span>
            </button>

            <div className="my-1 h-px bg-line/70" />

            {KAWASAN_PILOT.map((k) => {
              const aktif = dipilih.includes(k.nama)
              return (
                <button
                  key={k.nama}
                  role="option"
                  aria-selected={aktif}
                  onClick={() => alih(k.nama)}
                  className={`flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-3 py-2 text-left text-[13.5px] transition-colors hover:bg-surface-2 ${
                    aktif ? 'font-semibold' : 'font-medium text-ink-2'
                  }`}
                >
                  <Kotak aktif={aktif} bulat={!premium} />
                  <span className="truncate">{k.nama}</span>
                  <span className="ml-auto shrink-0 text-[12px] text-ink-3">{k.moda}</span>
                </button>
              )
            })}
          </div>

          {!premium && (
            <button
              onClick={() => {
                setBuka(false)
                mintaLangganan(
                  'Filter multi-kawasan menggabungkan beberapa kawasan dalam satu tampilan.',
                )
              }}
              className="flex w-full cursor-pointer items-start gap-2.5 border-t border-line/70 bg-surface-2/60 px-3.5 py-3 text-left transition-colors hover:bg-surface-2"
            >
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink text-surface">
                <svg width="9" height="9" viewBox="0 0 20 20" aria-hidden>
                  <path d="M6 9V6.5a4 4 0 0 1 8 0V9" fill="none" stroke="currentColor" strokeWidth="2" />
                  <rect x="4.5" y="9" width="11" height="7.5" rx="2" fill="currentColor" />
                </svg>
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-semibold text-ink">
                  Pilih beberapa kawasan sekaligus
                </span>
                <span className="block text-[11.5px] leading-snug text-ink-3">
                  Bandingkan Bekasi dan Depok Baru dalam satu peta — Premium.
                </span>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Kotak({ aktif, bulat }: { aktif: boolean; bulat?: boolean }) {
  return (
    <span
      className={`grid h-4 w-4 shrink-0 place-items-center border transition-colors ${
        bulat ? 'rounded-full' : 'rounded-[4px]'
      } ${aktif ? 'border-ink bg-ink text-surface' : 'border-line-2'}`}
      aria-hidden
    >
      {aktif && (
        <svg width="10" height="10" viewBox="0 0 12 12">
          <path
            d="M1.5 6.2 4.4 9 10.5 2.8"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// 2 · Komparasi berdampingan
// ---------------------------------------------------------------------------

/**
 * Metrik yang dibandingkan, berurutan dari yang paling menentukan.
 *
 * `arah` menyatakan sisi mana yang lebih baik, dan itulah satu-satunya hal yang
 * membuat tabel ini bisa dibaca tanpa berpikir: IKP dan IBR RENDAH yang bagus,
 * dan pembaca tidak seharusnya perlu mengingat itu. Backend sudah menghitung
 * pemenangnya; `arah` di sini hanya mengarahkan panjang barnya.
 *
 * Namanya bahasa orang, bukan nama indeks. "IPT 0,93" tidak berarti apa pun
 * bagi calon pemilik warung; "Akses ke stasiun" berarti.
 */
const METRIK: {
  kunci: string
  label: string
  bantuan: string
  ambil: (b: Komparasi['baris'][number]) => number | null
  format: (v: number | null) => string | null
  arah: 'tinggi' | 'rendah'
  utama?: boolean
}[] = [
  {
    kunci: 'opportunity_score',
    label: 'Opportunity Score',
    bantuan: 'ringkasan semuanya, 0-100',
    ambil: (b) => b.opportunity_score,
    format: (v) => angka(v, 0),
    arah: 'tinggi',
    utama: true,
  },
  {
    kunci: 'harga_sewa_per_m2',
    label: 'Sewa per m²',
    bantuan: 'makin murah makin baik',
    ambil: (b) => b.harga_sewa_per_m2,
    format: (v) => rupiah(v),
    arah: 'rendah',
    utama: true,
  },
  {
    kunci: 'belanja_per_jam',
    label: 'Uang berpindah per jam',
    bantuan: 'seberapa deras uang mengalir',
    ambil: (b) => b.belanja_per_jam,
    format: (v) => rupiah(v),
    arah: 'tinggi',
    utama: true,
  },
  {
    kunci: 'n_kompetitor_langsung',
    label: 'Pesaing sejenis',
    bantuan: 'makin sedikit makin lapang',
    ambil: (b) => b.n_kompetitor_langsung,
    format: (v) => (v === null ? null : `${angka(v, 0)} tempat`),
    arah: 'rendah',
    utama: true,
  },
  {
    kunci: 'waktu_jalan_menit',
    label: 'Jalan kaki ke stasiun',
    bantuan: 'makin dekat makin ramai dilewati',
    ambil: (b) => b.waktu_jalan_menit,
    format: (v) => (v === null ? null : `${angka(v, 0)} menit`),
    arah: 'rendah',
    utama: true,
  },
  {
    kunci: 'hidden_gem_score',
    label: 'Skor hidden gem',
    bantuan: 'bagus tapi belum dilirik',
    ambil: (b) => b.hidden_gem_score,
    format: (v) => angka(v, 2),
    arah: 'tinggi',
  },
  {
    kunci: 'ipt',
    label: 'Akses ke stasiun',
    bantuan: 'indeks IPT',
    ambil: (b) => b.indeks.ipt,
    format: (v) => angka(v, 2),
    arah: 'tinggi',
  },
  {
    kunci: 'iae',
    label: 'Perputaran uang',
    bantuan: 'indeks IAE',
    ambil: (b) => b.indeks.iae,
    format: (v) => angka(v, 2),
    arah: 'tinggi',
  },
  {
    kunci: 'ikp',
    label: 'Ketatnya persaingan',
    bantuan: 'indeks IKP',
    ambil: (b) => b.indeks.ikp,
    format: (v) => angka(v, 2),
    arah: 'rendah',
  },
  {
    kunci: 'ibr',
    label: 'Biaya dan risiko',
    bantuan: 'indeks IBR',
    ambil: (b) => b.indeks.ibr,
    format: (v) => angka(v, 2),
    arah: 'rendah',
  },
]

/**
 * Satu baris metrik: label di kiri, satu bar per lokasi di bawahnya.
 *
 * Bar, bukan angka telanjang. "Rp150.776 vs Rp204.014" menuntut mata
 * membandingkan dua deret digit; dua bar dengan panjang berbeda menjawabnya
 * sebelum angkanya sempat dibaca.
 */
function BarisMetrik({
  m,
  data,
  besar,
}: {
  m: (typeof METRIK)[number]
  data: Komparasi
  besar?: boolean
}) {
  const nilai = data.baris.map((b) => m.ambil(b))
  const ada = nilai.filter((v): v is number => v !== null)
  const maks = ada.length ? Math.max(...ada) : 0
  const min = ada.length ? Math.min(...ada) : 0
  const juara = data.menang[m.kunci]

  return (
    <div className="border-t border-line/70 px-5 py-3">
      <div className="mb-2 flex items-baseline gap-2">
        <span className={`font-semibold text-ink ${besar ? 'text-[13.5px]' : 'text-[12.5px]'}`}>
          {m.label}
        </span>
        <span className="min-w-0 truncate text-[11px] text-ink-3">{m.bantuan}</span>
      </div>
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${data.baris.length}, minmax(0,1fr))` }}
      >
        {data.baris.map((b, i) => {
          const v = m.ambil(b)
          const menang = juara === b.h3_index && data.baris.length > 1
          /**
           * Panjang bar relatif terhadap yang dibandingkan saja, bukan terhadap
           * skala absolut — yang ingin dilihat pembaca adalah selisih di antara
           * pilihannya sendiri.
           *
           * Untuk metrik "rendah lebih baik", barnya DIBALIK: yang termurah
           * jadi yang terpanjang. Kalau tidak, kolom termahal tampil paling
           * panjang dan mata membacanya sebagai yang terbaik — persis
           * kebalikannya.
           */
          const lebar =
            v === null || maks === 0
              ? 0
              : m.arah === 'tinggi'
                ? (v / maks) * 100
                : maks === min
                  ? 100
                  : ((maks - v) / (maks - min)) * 88 + 12
          return (
            <div key={b.h3_index}>
              <div className="mb-1 flex items-baseline gap-1.5">
                <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-ink text-[9.5px] font-bold text-surface">
                  {i + 1}
                </span>
                <span
                  className={`tabular min-w-0 truncate text-[13px] ${
                    menang ? 'font-bold text-ink' : 'font-medium text-ink-2'
                  }`}
                >
                  {m.format(v) ?? '—'}
                </span>
                {menang && (
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 20 20"
                    aria-hidden
                    className="shrink-0 text-gem"
                  >
                    <path
                      d="m4 10.5 4 4 8-9"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-ground-2">
                <div
                  className="h-full rounded-full transition-[width] duration-700 ease-liquid"
                  style={{
                    width: `${v === null ? 0 : Math.max(6, lebar)}%`,
                    // Bukan `line-2`: warnanya nyaris sama dengan rel di
                    // belakangnya (#bcc5bf vs #dde2df), jadi bar yang kalah
                    // praktis tak terlihat - dan panjang bar itulah SATU-
                    // SATUNYA gunanya baris ini. `ink-3` cukup gelap untuk
                    // dibandingkan, cukup netral untuk tidak berebut dengan
                    // hijau pemenangnya.
                    background: menang ? 'var(--color-gem)' : 'var(--color-ink-3)',
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function DialogKomparasi({
  h3,
  onTutup,
  onPilih,
}: {
  h3: string[]
  onTutup: () => void
  onPilih: (h3: string) => void
}) {
  const [data, setData] = useState<Komparasi | null>(null)
  const [galat, setGalat] = useState<string | null>(null)
  const [sibuk, setSibuk] = useState(false)
  const { premium, akun, mintaLangganan, mintaMasuk } = useSesi()

  useEffect(() => {
    let batal = false
    setData(null)
    setGalat(null)
    api
      .komparasi(h3)
      .then((d) => !batal && setData(d))
      .catch(
        (e) => !batal && setGalat(e instanceof GalatAPI ? e.message : 'Gagal memuat komparasi.'),
      )
    return () => {
      batal = true
    }
  }, [h3])

  /**
   * Berapa metrik yang dimenangkan tiap lokasi.
   *
   * Ini yang dicari orang lebih dulu — "jadi yang mana?" — dan tanpa baris ini
   * ia harus menghitung sendiri sepuluh baris. Dihitung dari `menang` milik
   * backend, jadi arah tiap metrik tidak pernah ditebak ulang di sini.
   */
  const skorMenang = useMemo(() => {
    const n = new Map<string, number>()
    for (const juara of Object.values(data?.menang ?? {})) {
      if (juara) n.set(juara, (n.get(juara) ?? 0) + 1)
    }
    return n
  }, [data])

  const unduh = async () => {
    if (!premium) {
      return akun
        ? mintaLangganan('Ekspor PDF perbandingan bagian dari Loconomics Premium.')
        : mintaMasuk('Buat akun dulu untuk mengunduh perbandingan.')
    }
    setSibuk(true)
    try {
      await api.unduhKomparasi(h3)
    } catch (e) {
      setGalat(e instanceof GalatAPI ? e.message : 'Gagal mengunduh PDF.')
    } finally {
      setSibuk(false)
    }
  }

  const terbanyak = Math.max(0, ...skorMenang.values())

  return (
    <Lembar
      judul={`Membandingkan ${h3.length} lokasi`}
      keterangan="Bar paling panjang berarti paling baik di baris itu — arahnya sudah diperhitungkan, jadi sewa termurah dan pesaing tersedikit juga tampil sebagai bar terpanjang."
      onTutup={onTutup}
      aksi={
        <button
          onClick={unduh}
          disabled={sibuk || !data}
          className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full bg-ink px-4 py-2 text-[12.5px] font-semibold text-surface transition-transform duration-300 ease-jelly hover:scale-[1.03] disabled:opacity-50"
        >
          <svg width="13" height="13" viewBox="0 0 20 20" aria-hidden>
            <path
              d="M10 3v9m0 0 3.2-3.2M10 12 6.8 8.8M4.5 14.5v1a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-1"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {sibuk ? 'Menyiapkan…' : 'Unduh PDF'}
        </button>
      }
    >
      {galat ? (
        <p className="p-6 text-[13.5px] text-bahaya">{galat}</p>
      ) : !data ? (
        <Memuat baris={6} teks="Menyusun perbandingan…" />
      ) : (
        <>
          {/* --- Kepala: satu kartu per lokasi, bernomor SAMA dengan peta --- */}
          <div
            className="grid gap-2.5 border-b border-line/70 p-5"
            style={{ gridTemplateColumns: `repeat(${data.baris.length}, minmax(0,1fr))` }}
          >
            {data.baris.map((b, i) => {
              const q = b.kuadran ? KUADRAN[b.kuadran as NamaKuadran] : null
              const menang = skorMenang.get(b.h3_index) ?? 0
              const dilarang = b.zoneguard.filter_mutlak
              const unggul =
                !dilarang && menang > 0 && menang === terbanyak && data.baris.length > 1
              return (
                <button
                  key={b.h3_index}
                  onClick={() => onPilih(b.h3_index)}
                  title="Buka di peta"
                  className={`cursor-pointer rounded-lg border p-3.5 text-left transition-all duration-300 ease-jelly hover:-translate-y-0.5 ${
                    dilarang
                      ? 'border-bahaya bg-bahaya-soft/40'
                      : unggul
                        ? 'border-gem bg-gem-soft/45 shadow-[0_0_0_1px_var(--color-gem)]'
                        : 'border-line bg-surface hover:border-line-2'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-bold text-surface">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-semibold text-ink">
                        {kodeLokasi(b.h3_index, b.kawasan)}
                      </span>
                    </span>
                  </div>

                  <div className="mt-3 flex items-baseline gap-1.5">
                    <span className="papan tabular text-[28px] leading-none">
                      {angka(b.opportunity_score, 0) ?? '—'}
                    </span>
                    <span className="text-[11px] text-ink-3">/ 100</span>
                    {b.kuadran && (
                      <span className="ml-auto">
                        <Glif kuadran={b.kuadran} ukuran={12} />
                      </span>
                    )}
                  </div>
                  {q && (
                    <span
                      className="mt-1 block text-[11.5px] font-semibold leading-tight"
                      style={{ color: q.warna }}
                    >
                      {q.nama}
                    </span>
                  )}

                  <div className="mt-2.5 border-t border-line/60 pt-2.5">
                    {/* Satu kalimat kesimpulan, di kartu, sebelum sembilan
                        baris metrik di bawahnya. Yang dicari orang awam di
                        layar ini "jadi yang mana?", dan sampai sekarang
                        jawabannya cuma bisa disimpulkan sendiri dari sembilan
                        pasang batang. */}
                    {dilarang ? (
                      <span className="block text-[11.5px] font-semibold leading-snug text-bahaya">
                        Zona melarang usaha — berapa pun skornya
                      </span>
                    ) : (
                      <span
                        className={`block text-[11.5px] font-semibold leading-snug ${
                          unggul ? 'text-gem' : 'text-ink-3'
                        }`}
                      >
                        {unggul && '★ '}
                        Unggul di {menang} dari {METRIK.length} hal
                      </span>
                    )}
                    <span className="mt-1.5 block">
                      <Badge badge={b.keyakinan} ringkas />
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Lima hal yang paling menentukan dulu; indeksnya dilipat. */}
          {METRIK.filter((m) => m.utama).map((m) => (
            <BarisMetrik key={m.kunci} m={m} data={data} besar />
          ))}

          <details className="border-t border-line/70">
            <summary className="cursor-pointer list-none px-5 py-3 text-[12.5px] font-medium text-ink-2 transition-colors hover:text-ink">
              Lihat empat indeks pembentuk skor
            </summary>
            {METRIK.filter((m) => !m.utama).map((m) => (
              <BarisMetrik key={m.kunci} m={m} data={data} />
            ))}
          </details>

          {/* --- Status: tidak punya pemenang, jadi tidak diberi bar --- */}
          <div className="border-t border-line/70 p-5">
            <p className="eyebrow mb-2.5">Izin dan risiko</p>
            <div
              className="grid gap-2.5"
              style={{ gridTemplateColumns: `repeat(${data.baris.length}, minmax(0,1fr))` }}
            >
              {data.baris.map((b, i) => (
                <div key={b.h3_index} className="rounded-md border border-line bg-surface p-3">
                  <span className="mb-2 flex items-center gap-1.5 text-[11px] text-ink-3">
                    <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-ink text-[9.5px] font-bold text-surface">
                      {i + 1}
                    </span>
                    <span className="min-w-0 truncate">{kodeLokasi(b.h3_index, b.kawasan)}</span>
                  </span>
                  <p
                    className={`flex items-start gap-1.5 text-[12.5px] font-semibold leading-snug ${
                      b.zoneguard.filter_mutlak ? 'text-bahaya' : 'text-ink-2'
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`mt-[3px] h-2.5 w-2.5 shrink-0 rounded-[3px] ${
                        b.zoneguard.status === 'DIIZINKAN'
                          ? 'bg-gem'
                          : b.zoneguard.status === 'DILARANG'
                            ? 'bg-bahaya'
                            : 'arsir border border-line-2'
                      }`}
                    />
                    {b.zoneguard.status === 'DIIZINKAN'
                      ? 'Boleh dipakai usaha'
                      : b.zoneguard.status === 'DILARANG'
                        ? 'Zona melarang usaha'
                        : 'Izin belum bisa dipastikan'}
                  </p>
                  <p className="mt-1.5 text-[11.5px] leading-snug text-ink-3">{b.risiko.label}</p>
                </div>
              ))}
            </div>
          </div>

          <p className="border-t border-line/70 px-5 py-3.5 text-[11.5px] leading-snug text-ink-3">
            Lokasi berzona terlarang sengaja ikut ditampilkan — ini alat perbandingan,
            bukan rekomendasi, dan alasan terkuat untuk tidak memilih sebuah lokasi tidak
            boleh disembunyikan.
          </p>
        </>
      )}
    </Lembar>
  )
}

// ---------------------------------------------------------------------------
// 3 · Pemantauan
// ---------------------------------------------------------------------------

export function DialogPantauan({
  kawasan,
  onTutup,
  onPilih,
  onBandingkanSemua,
}: {
  /** Kawasan yang sedang aktif, untuk panel dinamika. */
  kawasan: string
  onTutup: () => void
  onPilih: (h3: string) => void
  /** Kirim 2-4 lokasi tersimpan langsung ke baki komparasi. */
  onBandingkanSemua?: (h3: string[]) => void
}) {
  const [butir, setButir] = useState<ButirPantauan[] | null>(null)
  const [dinamika, setDinamika] = useState<DinamikaKawasan | null>(null)
  const [galat, setGalat] = useState<string | null>(null)

  // Kawasan tunggal saja yang punya dinamika. Untuk "semua" atau gabungan
  // beberapa, sebaran churn-nya bercampur dan persentilnya berhenti berarti.
  const kawasanTunggal =
    kawasan !== SEMUA_KAWASAN && !kawasan.includes(',') ? kawasan : null

  const muat = useCallback(() => {
    api
      .pantauan()
      .then(setButir)
      .catch((e) => setGalat(e instanceof GalatAPI ? e.message : 'Gagal memuat pantauan.'))
  }, [])

  useEffect(() => {
    muat()
  }, [muat])

  useEffect(() => {
    if (!kawasanTunggal) {
      setDinamika(null)
      return
    }
    let batal = false
    api
      .dinamikaKawasan(kawasanTunggal)
      .then((d) => !batal && setDinamika(d))
      .catch(() => !batal && setDinamika(null))
    return () => {
      batal = true
    }
  }, [kawasanTunggal])

  const { catatSimpan } = useSesi()
  const lepas = async (h3: string) => {
    await api.lepasPantauan(h3).catch(() => {})
    catatSimpan() // pin ikut hilang dari peta, bukan menunggu refresh
    muat()
  }

  return (
    <Lembar
      judul="Lokasi tersimpan"
      keterangan="Selisih dihitung terhadap skor yang dibekukan saat Anda menyimpan lokasinya — bukan terhadap angka yang dihitung ulang sekarang."
      onTutup={onTutup}
      lebar="54rem"
    >
      <div className="grid gap-6 p-6 lg:grid-cols-[1fr_18rem]">
        {/* --- Daftar pantauan ------------------------------------------- */}
        <div className="min-w-0">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="eyebrow">Lokasi yang Anda simpan</h3>
            {onBandingkanSemua && butir && butir.length >= 2 && (
              <button
                onClick={() => onBandingkanSemua(butir.slice(0, 4).map((b) => b.h3_index))}
                className="cursor-pointer rounded-full border border-line px-3 py-1 text-[11.5px] font-medium text-ink-2 transition-colors hover:border-ink hover:text-ink"
              >
                Bandingkan {Math.min(butir.length, 4)} teratas
              </button>
            )}
          </div>
          {galat ? (
            <p className="text-[13px] text-bahaya">{galat}</p>
          ) : !butir ? (
            <Memuat baris={3} teks="Memuat pantauan…" />
          ) : butir.length === 0 ? (
            <div className="rounded-md border border-dashed border-line-2 px-5 py-8 text-center">
              <p className="text-[13.5px] font-medium text-ink-2">Belum ada lokasi tersimpan</p>
              <p className="mx-auto mt-1 max-w-[34ch] text-[12.5px] leading-snug text-ink-3">
                Buka satu heksagon di peta lalu tekan “Simpan lokasi”. Ia muncul
                sebagai pin di peta, skornya dibekukan saat itu juga, dan
                perubahannya dilaporkan di sini.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {butir.map((b) => (
                <li
                  key={b.h3_index}
                  className="flex items-center gap-3 rounded-md border border-line bg-surface px-3.5 py-3"
                >
                  {/* Didetailkan 3 Sep 2026: baris lama cuma menyebut nama
                      kawasan dan dua belas karakter heksadesimal.

                      "Manggarai" saja tidak cukup untuk mengingat lokasi mana
                      yang disimpan - satu kawasan punya 122 heksagon, dan
                      seluruh baris di daftar ini akan berbunyi "Manggarai".
                      Yang membuatnya bisa diingat justru tiga hal yang sudah
                      ada di responsnya dan tidak pernah ditampilkan: kode
                      lokasi yang terbaca, NAMA kuadrannya, dan kapan ia
                      disimpan. */}
                  <button
                    onClick={() => onPilih(b.h3_index)}
                    className="min-w-0 flex-1 cursor-pointer text-left"
                    title="Buka di peta"
                  >
                    <span className="papan block truncate text-[14px]">
                      {kodeLokasi(b.h3_index, b.kawasan ?? '')}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {b.kuadran && (
                        <span
                          className="inline-flex items-center gap-1 text-[11.5px] font-semibold"
                          style={{ color: KUADRAN[b.kuadran as NamaKuadran]?.warna }}
                        >
                          <Glif kuadran={b.kuadran} ukuran={9} />
                          {KUADRAN[b.kuadran as NamaKuadran]?.nama}
                        </span>
                      )}
                      <span className="text-[11px] text-ink-3">
                        disimpan{' '}
                        {new Date(b.dibuat_pada).toLocaleDateString('id-ID', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    </span>
                  </button>

                  <div className="shrink-0 text-right">
                    <span className="tabular block text-[15px] font-semibold text-ink">
                      {angka(b.skor_sekarang, 1) ?? '—'}
                    </span>
                    <Selisih nilai={b.selisih} />
                    {/* Skor BEKU-nya ikut disebut. Tanpa itu, "+0,4" menuntut
                        pembacanya mengingat angka berapa yang dulu ia simpan -
                        dan kalau ia mengingatnya, selisihnya tidak perlu
                        dihitungkan untuknya. */}
                    {b.skor_saat_dipantau !== null && b.selisih !== null && b.selisih !== 0 && (
                      <span className="tabular mt-0.5 block text-[10.5px] text-ink-3">
                        dari {angka(b.skor_saat_dipantau, 1)}
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => lepas(b.h3_index)}
                    aria-label={`Berhenti memantau ${b.h3_index}`}
                    className="shrink-0 cursor-pointer rounded-full border border-line px-2.5 py-1 text-[11.5px] text-ink-3 transition-colors hover:border-bahaya hover:text-bahaya"
                  >
                    Lepas
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* --- Dinamika kawasan ------------------------------------------ */}
        <div className="min-w-0">
          <h3 className="eyebrow mb-3">Dinamika kawasan</h3>
          {!kawasanTunggal ? (
            <p className="rounded-md bg-surface-2 px-4 py-3.5 text-[12.5px] leading-snug text-ink-2">
              Pilih satu kawasan di bilah atas untuk melihat sebaran churn-nya.
              Menggabungkan beberapa kawasan membuat persentilnya bercampur dan
              berhenti berarti.
            </p>
          ) : !dinamika ? (
            <Memuat baris={3} teks="Menghitung sebaran…" />
          ) : (
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="papan text-[15px]">{dinamika.kawasan}</p>
              <p className="mt-0.5 text-[12px] text-ink-3">
                {dinamika.n_heksagon.toLocaleString('id-ID')} heksagon dihitung
              </p>

              {dinamika.churn_p50 === null &&
              dinamika.churn_p75 === null &&
              dinamika.churn_p90 === null ? (
                <p className="mt-3.5 rounded-sm border border-line/70 bg-surface-2 px-3 py-2.5 text-[12px] leading-snug text-ink-3">
                  <span className="font-medium text-ink-2">Pergantian usaha belum terukur.</span>{' '}
                  Ketiga ambangnya — tengah, waspada, bahaya — dihitung dari data yang belum ada
                  sumbernya, jadi kawasan ini belum bisa dinilai risikonya.
                </p>
              ) : (
                <dl className="mt-3.5 space-y-2 border-t border-line/70 pt-3">
                  <BarisAngka
                    label="Pergantian usaha, lokasi tengah"
                    nilai={angka(dinamika.churn_p50, 3)}
                  />
                  <BarisAngka
                    label="Batas mulai waspada"
                    nilai={angka(dinamika.churn_p75, 3)}
                  />
                  <BarisAngka label="Batas bahaya" nilai={angka(dinamika.churn_p90, 3)} />
                </dl>
              )}

              <dl className="mt-3.5 space-y-2 border-t border-line/70 pt-3">
                <BarisAngka
                  label="Lokasi yang sudah lewat batas waspada"
                  nilai={`${dinamika.n_waspada} lokasi`}
                  tekan={dinamika.n_waspada > 0}
                />
                <BarisAngka
                  label="Lokasi yang sudah lewat batas bahaya"
                  nilai={`${dinamika.n_bahaya} lokasi`}
                  tekan={dinamika.n_bahaya > 0}
                />
                <BarisAngka
                  label="Opportunity Score rata-rata"
                  nilai={angka(dinamika.rata_opportunity, 1)}
                />
                <BarisAngka
                  label="Sudah disurvei langsung"
                  nilai={
                    dinamika.cakupan_survei === null
                      ? null
                      : `${Math.round(dinamika.cakupan_survei * 100)}% lokasi`
                  }
                />
              </dl>

              <div className="mt-3.5 border-t border-line/70 pt-3">
                <p className="eyebrow mb-2">Komposisi kuadran</p>
                {/* Satu pita bersusun DI ATAS daftarnya.

                    Daftar angka menjawab "berapa banyak"; yang sebenarnya
                    ditanyakan orang saat membuka panel bernama komposisi adalah
                    "kawasan ini isinya apa" - dan itu pertanyaan tentang
                    PROPORSI, yang tidak bisa dijawab dengan membandingkan 52,
                    38, 28, dan 4 di kepala sendiri.

                    Warnanya warna kuadran yang sama persis dengan di peta, jadi
                    pita ini terbaca sebagai ringkasan petaknya - bukan sebagai
                    palet baru yang harus dipelajari lagi. */}
                {(() => {
                  const urut = Object.entries(dinamika.per_kuadran).sort((a, z) => z[1] - a[1])
                  const total = urut.reduce((s, [, n]) => s + n, 0)
                  return (
                    <>
                      {total > 0 && (
                        <div className="mb-2.5 flex h-2.5 overflow-hidden rounded-full bg-ground-2">
                          {urut.map(([k, n]) => (
                            <span
                              key={k}
                              title={`${KUADRAN[k as NamaKuadran]?.nama ?? k}: ${n}`}
                              style={{
                                width: `${(n / total) * 100}%`,
                                background: KUADRAN[k as NamaKuadran]?.warna ?? 'var(--color-ink-3)',
                              }}
                            />
                          ))}
                        </div>
                      )}
                      <ul className="space-y-1.5">
                        {urut.map(([k, n]) => (
                          <li key={k} className="flex items-center gap-2 text-[12.5px]">
                            {k in KUADRAN && <Glif kuadran={k} ukuran={10} />}
                            <span className="truncate text-ink-2">
                              {KUADRAN[k as NamaKuadran]?.nama ?? k.replace(/_/g, ' ').toLowerCase()}
                            </span>
                            <span className="tabular ml-auto font-medium text-ink">{n}</span>
                            {/* Persennya dihitung dari dua angka yang SUDAH di
                                layar (n dan totalnya), bukan angka baru. */}
                            <span className="tabular w-9 shrink-0 text-right text-[11.5px] text-ink-3">
                              {total > 0 ? `${Math.round((n / total) * 100)}%` : '—'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )
                })()}
              </div>

              {/* Catatan backend ditampilkan APA ADANYA. Ia yang menyatakan
                  bahwa ini potret, bukan deret waktu — dan itu justru bagian
                  yang paling penting dibaca di panel bernama "dinamika". */}
              <p className="mt-3.5 border-t border-line/70 pt-3 text-[11.5px] leading-snug text-ink-3">
                {dinamika.catatan}
              </p>
            </div>
          )}
        </div>
      </div>
    </Lembar>
  )
}

function BarisAngka({
  label,
  nilai,
  tekan,
}: {
  label: string
  nilai: string | null
  tekan?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[12.5px] text-ink-3">{label}</dt>
      <dd
        className={`tabular text-[13px] ${tekan ? 'font-semibold text-jebakan' : 'font-medium text-ink'}`}
      >
        {nilai ?? <Kosong teks="—" />}
      </dd>
    </div>
  )
}

function Selisih({ nilai }: { nilai: number | null }) {
  if (nilai === null) return <span className="text-[11px] text-ink-3">belum ada acuan</span>
  if (Math.abs(nilai) < 0.05)
    return <span className="text-[11px] text-ink-3">belum berubah</span>
  const naik = nilai > 0
  return (
    <span
      className={`tabular text-[11.5px] font-semibold ${naik ? 'text-gem' : 'text-bahaya'}`}
    >
      {naik ? '▲' : '▼'} {Math.abs(nilai).toFixed(1)}
    </span>
  )
}

// ---------------------------------------------------------------------------
// 4 · Riwayat skor, di dalam panel detail
// ---------------------------------------------------------------------------

export function BagianRiwayat({ h3 }: { h3: string }) {
  const { premium, akun, mintaLangganan, mintaMasuk } = useSesi()
  const [data, setData] = useState<RiwayatSkor | null>(null)
  const [galat, setGalat] = useState(false)

  useEffect(() => {
    if (!premium) return
    let batal = false
    setData(null)
    setGalat(false)
    api
      .riwayatSkor(h3)
      .then((d) => !batal && setData(d))
      .catch(() => !batal && setGalat(true))
    return () => {
      batal = true
    }
  }, [h3, premium])

  if (!premium)
    return (
      <Terkunci
        judul="Riwayat perubahan skor"
        kalimat="Lihat bagaimana skor lokasi ini bergerak setiap kali pipeline menerbitkan versi baru."
        labelAksi={akun ? 'Buka dengan Premium' : 'Sign Up untuk membuka'}
        baris={3}
        onBuka={() =>
          akun
            ? mintaLangganan('Riwayat skor bagian dari Loconomics Premium.')
            : mintaMasuk('Buat akun dulu untuk membuka riwayat skor.')
        }
      />
    )

  if (galat) return <p className="text-[13px] text-ink-3">Riwayat tidak bisa dimuat.</p>
  if (!data) return <p className="text-[13px] text-ink-3">Memuat riwayat…</p>

  return (
    <>
      {data.titik.length > 0 && (
        <ul className="mb-2.5 space-y-1.5">
          {data.titik.map((t) => (
            <li key={t.versi} className="flex items-baseline gap-2 text-[13px]">
              <span className="font-mono text-[11.5px] text-ink-3">
                {t.versi === 'baseline' ? 'awal' : t.versi}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink-3">
                {t.dihitung_pada
                  ? new Date(t.dihitung_pada).toLocaleDateString('id-ID', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })
                  : '—'}
              </span>
              <span className="tabular font-semibold text-ink">
                {angka(t.opportunity_score, 1) ?? '—'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {/* Kalau cuma satu versi, yang tampil KETERANGANNYA - bukan grafik garis
          dari satu titik. Lihat kepala berkas ini. */}
      <p
        className={`text-[12px] leading-snug ${
          data.cukup_untuk_tren ? 'text-ink-2' : 'text-ink-3'
        }`}
      >
        {data.catatan}
      </p>
    </>
  )
}
