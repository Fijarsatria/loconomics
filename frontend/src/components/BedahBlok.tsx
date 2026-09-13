/**
 * Bedah heksagon jadi tujuh blok res-10.
 *
 * Pertanyaan yang dijawab berkas ini cuma satu, dan ia pertanyaan pertama yang
 * diajukan hampir setiap orang yang melihat peta heksagon: heksagon res-9
 * bergaris tengah ±350 m, jadi satu petak memuat sisi yang menempel jalan
 * besar DAN gang buntu di belakangnya — dan keduanya mendapat satu skor yang
 * sama. "Lokasi ini bagus" jadi pernyataan yang benar untuk sepertujuh
 * heksagonnya saja.
 *
 * Jawabannya BUKAN memperhalus grid. Mengubah res-9 jadi res-10 membuang 708
 * heksagon, 1.587 rute ORS, dan tiap variabel yang sudah terkumpul — dan
 * menukar satu masalah dengan masalah yang sama pada skala yang lebih kecil,
 * karena res-10 pun masih memuat dua sisi jalan. Yang dilakukan di sini:
 * heksagon tetap unit analisisnya, dan blok dipanggil saat diminta sebagai
 * pembanding DI DALAM satu heksagon.
 *
 * DIROMBAK 13 Sep 2026 atas laporan pemilik repo: "informasinya terlalu susah
 * untuk dipahami, masa dekat halte pake persentase". Versi sebelumnya
 * menuliskan sumbangan tiap indikator sebagai PANGSA skor ("Dekat halte 9%") -
 * jawaban untuk pertanyaan yang tidak diajukan siapa pun. Sekarang tiap alasan
 * ditulis sebagai FAKTA yang bisa dicek di lapangan ("Halte 49 m") ditemani
 * meteran lima titik seberapa bagus blok ini pada hal itu, dan ketujuh blok
 * digambar sebagai peta mini yang bentuk dan warnanya sama dengan di peta.
 *
 * Tiga hal yang sengaja TIDAK dilakukan komponen ini:
 *
 *   Tidak menghitung skor. Ketujuh skor, peringkat, alasan, peringatan, dan
 *   kekuatan tiap indikator datang jadi dari `/hex/{h3}/blok` (aturan 1).
 *
 *   Tidak memakai peringkat sebagai warna. Lihat `WARNA_BLOK` di
 *   `lib/layer-peta.ts` — peta mini memakai rona yang sama persis.
 *
 *   Tidak mengganti heksagon terpilih. Mengklik blok memilih BLOK; panel di
 *   atasnya tetap membicarakan heksagon yang sama.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { api, GalatAPI } from '../lib/api'
import { useTeks } from '../lib/bahasa'
import { angka, jarakSingkat } from '../lib/format'
import { warnaSkorBlok } from '../lib/layer-peta'
import type { BedahBlok as BedahBlokT, BlokDalamHeksagon, KontribusiBlok } from '../types'
import { Badge, Memuat, Rinci } from './primitif'

/** Nilai `kelas` yang berarti "tanpa kelas usaha tertentu". */
const UMUM = '_umum'

const K = {
  id: {
    buka: 'Bedah jadi 7 blok (±130 m)',
    tutup: 'Sembunyikan',
    memuat: 'Membedah heksagon…',
    gagal: 'Blok heksagon ini belum bisa ditampilkan.',
    kelasLabel: 'Untuk jenis usaha',
    umum: 'Semua jenis usaha',
    umumCatatan: 'Tanpa memperhitungkan pesaing sekelas',
    blokKe: (n: number) => `Blok #${n}`,
    dari7: (n: number) => `#${n} dari 7`,
    terbaik: 'Terbaik',
    terlemah: 'Terlemah',
    selisih: 'Selisih',
    poin: 'poin',
    // Kalimat selisih: PEMICUNYA dihitung dari data, jadi kalimatnya dihitung
    // juga. Menulisnya tetap akan berbohong untuk heksagon yang ketujuh
    // bloknya memang mirip - dan itu mayoritasnya.
    rentangSempit: 'Ketujuh blok praktis setara. Pilih yang sewanya paling wajar.',
    rentangSedang: 'Ada bedanya, tapi belum menentukan. Timbang bersama harga sewa.',
    rentangLebar: 'Sisi mana yang Anda ambil MENENTUKAN di heksagon ini.',
    petunjuk: 'Klik blok di peta mini, di daftar, atau langsung di peta.',
    kosong: '—',
    kenapa: 'Kenapa skornya segini',
    dataBlok: 'Sekilas blok ini',
    kBangunan: 'Bangunan',
    kTutupan: 'Tertutup bangunan',
    kPesaing: 'Pesaing sekelas',
    kSkorUmum: 'Skor umum',
    dalam150: 'dalam 150 m',
    takAda: 'belum ada data',
    zonaBoleh: 'Zona membolehkan usaha',
    zonaTidak: 'Zona MELARANG usaha',
    zonaTahu: 'Zona belum bisa dipastikan',
    pangsaZona: (p: string) => `${p} bidang berzona usaha`,
    simulasi: 'Simulasikan usaha di blok ini',
    simulasiCatatan: 'Omzet, sewa, dan titik impas — disesuaikan dengan kekuatan blok ini',
    tabel: 'Bandingkan angka ketujuh blok',
    kMenit: 'mnt',
    kJalan: 'ke jalan',
    kUsaha: 'usaha',
    kPenarik: 'penarik',
    kHalte: 'halte',
    kolMenit: 'Jalan kaki ke simpul',
    kolJalan: 'Jarak ke jalan utama',
    kolUsaha: 'Usaha dalam 150 m',
    kolPenarik: 'Penarik dalam 250 m',
    kolHalte: 'Jarak halte terdekat',
    tingkat: ['Lemah', 'Kurang', 'Cukup', 'Baik', 'Sangat baik'],
    risiko: ['Rendah', 'Sedang', 'Tinggi'],
    menaikkan: 'menaikkan skor',
    menurunkan: 'menurunkan skor',
    fakta: {
      menit: (m: number, simpul: string | null) =>
        `${Math.round(m)} menit jalan kaki${simpul ? ` ke ${simpul}` : ' ke simpul transit'}`,
      jalan: (d: string, nama: string | null) => `${d} dari ${nama ?? 'jalan utama'}`,
      usaha: (n: number) => `${n} usaha dalam 150 m`,
      penarik: (n: number, rincian: string) =>
        n === 0 ? 'Tidak ada penarik keramaian dalam 250 m' : `${n} penarik keramaian dalam 250 m${rincian ? ` (${rincian})` : ''}`,
      halte: (d: string) => `Halte atau henti angkutan ${d}`,
      tutupan: (p: string) => `${p} lahannya tertutup bangunan`,
      banjir: 'Menurut peta rawan banjir RDTR',
    },
    penarik: {
      pasar: 'pasar',
      ibadah: 'tempat ibadah',
      kantor: 'kantor',
      sekolah: 'sekolah',
      rumah_sakit: 'rumah sakit',
    } as Record<string, string>,
    // Bahasa Indonesia tidak menjamakkan kata benda setelah bilangan.
    jamak: {} as Record<string, string>,
  },
  en: {
    buka: 'Split into 7 blocks (±130 m)',
    tutup: 'Hide',
    memuat: 'Splitting the hexagon…',
    gagal: 'The blocks for this hexagon cannot be shown yet.',
    kelasLabel: 'For this business type',
    umum: 'All business types',
    umumCatatan: 'Same-type competitors not counted',
    blokKe: (n: number) => `Block #${n}`,
    dari7: (n: number) => `#${n} of 7`,
    terbaik: 'Best',
    terlemah: 'Weakest',
    selisih: 'Gap',
    poin: 'pts',
    rentangSempit: 'All seven blocks are practically equal. Take the one with the fairest rent.',
    rentangSedang: 'There is a difference, but not a deciding one. Weigh it with the rent.',
    rentangLebar: 'Which side you take DECIDES it in this hexagon.',
    petunjuk: 'Click a block on the mini map, in the list, or on the map itself.',
    kosong: '—',
    kenapa: 'Why this score',
    dataBlok: 'This block at a glance',
    kBangunan: 'Buildings',
    kTutupan: 'Built-up',
    kPesaing: 'Same-type rivals',
    kSkorUmum: 'General score',
    dalam150: 'within 150 m',
    takAda: 'no data yet',
    zonaBoleh: 'Zoning allows business',
    zonaTidak: 'Zoning FORBIDS business',
    zonaTahu: 'Zoning not confirmed yet',
    pangsaZona: (p: string) => `${p} of its plots zoned for business`,
    simulasi: 'Simulate a business on this block',
    simulasiCatatan: 'Revenue, rent, and break-even — adjusted to this block’s strength',
    tabel: 'Compare all seven blocks',
    kMenit: 'min',
    kJalan: 'to road',
    kUsaha: 'shops',
    kPenarik: 'draws',
    kHalte: 'stop',
    kolMenit: 'Walk to the node',
    kolJalan: 'Distance to a main road',
    kolUsaha: 'Businesses within 150 m',
    kolPenarik: 'Crowd generators within 250 m',
    kolHalte: 'Nearest transit stop',
    tingkat: ['Weak', 'Below average', 'Fair', 'Good', 'Very good'],
    risiko: ['Low', 'Medium', 'High'],
    menaikkan: 'lifts the score',
    menurunkan: 'lowers the score',
    fakta: {
      menit: (m: number, simpul: string | null) =>
        `${Math.round(m)} min walk${simpul ? ` to ${simpul}` : ' to the transit node'}`,
      jalan: (d: string, nama: string | null) => `${d} from ${nama ?? 'a main road'}`,
      usaha: (n: number) => `${n} businesses within 150 m`,
      penarik: (n: number, rincian: string) =>
        n === 0 ? 'No crowd generators within 250 m' : `${n} crowd generators within 250 m${rincian ? ` (${rincian})` : ''}`,
      halte: (d: string) => `Transit stop ${d} away`,
      tutupan: (p: string) => `${p} of the land is built up`,
      banjir: 'From the RDTR flood-prone map',
    },
    penarik: {
      pasar: 'market',
      ibadah: 'place of worship',
      kantor: 'office',
      sekolah: 'school',
      rumah_sakit: 'hospital',
    } as Record<string, string>,
    jamak: {
      pasar: 'markets',
      ibadah: 'places of worship',
      kantor: 'offices',
      sekolah: 'schools',
      rumah_sakit: 'hospitals',
    } as Record<string, string>,
  },
}

type Teks = typeof K.id

/** Di bawah ini selisihnya tidak layak dipakai memilih; di atas yang kedua ia menentukan. */
const RENTANG_SEMPIT = 5
const RENTANG_LEBAR = 15

/** Glif 16x16 per indikator, dan satu cadangan. */
const GLIF: Record<string, string> = {
  menit_jalan_inv: 'M8.5 2.6a1.3 1.3 0 1 1 0 .01M7 5.6 5.4 8.4l2.1 1.2L7 13.6M7.6 6.2l2 2 2.2.6M7.5 9.6l2.2 1.6.6 2.6',
  jarak_jalan_utama_m_inv: 'M5.5 2 3 14M10.5 2 13 14M8 3.2v1.8M8 7.2V9M8 11.4v1.6',
  n_usaha_150m: 'M2.8 6.4 3.8 3h8.4l1 3.4M3.2 6.4h9.6v6.8H3.2ZM6.6 13.2V9.6h2.8v3.6M2.8 6.4c0 1 .8 1.6 1.7 1.6s1.7-.6 1.7-1.6c0 1 .8 1.6 1.8 1.6s1.8-.6 1.8-1.6c0 1 .7 1.6 1.7 1.6s1.7-.6 1.7-1.6',
  n_penarik_250m: 'M8 2.2a3.8 3.8 0 0 1 3.8 3.8C11.8 9 8 13.8 8 13.8S4.2 9 4.2 6A3.8 3.8 0 0 1 8 2.2ZM8 4.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8Z',
  jarak_halte_m_inv: 'M4 2.6h8a1 1 0 0 1 1 1v7.2H3V3.6a1 1 0 0 1 1-1ZM3 7.4h10M5.2 12.6v1.2M10.8 12.6v1.2M5.4 9.2h.01M10.6 9.2h.01',
  rasio_tutupan_bangunan: 'M2.6 13.4h10.8M3.6 13.4V6.6l3-2v8.8M6.6 4.6l5.8 2v6.8M8.6 8h1.8M8.6 10.4h1.8',
  risiko_banjir_inv: 'M2 10.2c1.2 0 1.2.8 2.4.8s1.2-.8 2.4-.8 1.2.8 2.4.8 1.2-.8 2.4-.8 1.2.8 2.4.8M2 13c1.2 0 1.2.8 2.4.8s1.2-.8 2.4-.8 1.2.8 2.4.8 1.2-.8 2.4-.8 1.2.8 2.4.8M8 1.8s-2.6 3-2.6 4.6a2.6 2.6 0 0 0 5.2 0C10.6 4.8 8 1.8 8 1.8Z',
}

/**
 * Pemilih kelas usaha, SELEBAR panel.
 *
 * `Menu` di `primitif.tsx` sengaja tidak dipakai di sini: ia dibuat untuk BILAH
 * ATAS - pil selebar isinya, berjangkar ke kanan. Di dalam panel ia berdiri
 * pendek dan bertepi kanan - "bar nya kayak ga rapih dengan bar utamanya",
 * dilaporkan pemilik repo 13 Sep 2026.
 */
function PilihKelas({
  label,
  nilai,
  opsi,
  onUbah,
}: {
  label: string
  nilai: string
  opsi: { nilai: string; label: string; catatan?: string }[]
  onUbah: (v: string) => void
}) {
  const [buka, setBuka] = useState(false)
  const wadah = useRef<HTMLDivElement>(null)
  const terpilih = opsi.find((o) => o.nilai === nilai)

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

  return (
    <div ref={wadah} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={buka}
        aria-label={`${label}: ${terpilih?.label ?? ''}`}
        onClick={() => setBuka((v) => !v)}
        className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
          buka ? 'border-ink-3 bg-surface' : 'border-line bg-surface-2 hover:border-ink-3'
        }`}
      >
        <span className="min-w-0">
          <span className="block text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">{label}</span>
          <span className="block truncate text-[13.5px] font-medium text-ink">{terpilih?.label ?? '—'}</span>
        </span>
        <svg
          width="11"
          height="11"
          viewBox="0 0 10 10"
          aria-hidden
          className={`shrink-0 text-ink-3 transition-transform duration-200 ease-liquid ${buka ? 'rotate-180' : ''}`}
        >
          <path d="M1 3.5 5 7.5 9 3.5" stroke="currentColor" strokeWidth="1.7" fill="none" />
        </svg>
      </button>
      {buka && (
        <ul
          role="listbox"
          aria-label={label}
          className="kaca-tebal melayang absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[15rem] overflow-auto rounded-xl p-1"
        >
          {opsi.map((o) => (
            <li key={o.nilai}>
              <button
                type="button"
                role="option"
                aria-selected={o.nilai === nilai}
                onClick={() => {
                  onUbah(o.nilai)
                  setBuka(false)
                }}
                className={`w-full cursor-pointer rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                  o.nilai === nilai ? 'bg-gem-soft text-gem' : 'text-ink-2 hover:bg-surface-2'
                }`}
              >
                <span className="block">{o.label}</span>
                {o.catatan && <span className="block text-[11px] text-ink-3">{o.catatan}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function BedahBlok({
  h3,
  data,
  onData,
  terpilih,
  onPilih,
  onSimulasi,
}: {
  h3: string
  /** Hasil bedah yang sedang tergambar di peta. Dimiliki App — peta memakainya juga. */
  data: BedahBlokT | null
  onData: (d: BedahBlokT | null) => void
  terpilih: string | null
  onPilih: (h3Blok: string | null) => void
  /** Buka simulasi usaha yang dipersempit ke satu blok. */
  onSimulasi?: (h3Blok: string) => void
}) {
  const t = useTeks(K)
  const [kelas, setKelas] = useState<string>(UMUM)
  const [memuat, setMemuat] = useState(false)
  const [galat, setGalat] = useState<string | null>(null)
  /**
   * Permintaan terakhir menang.
   *
   * Mengganti kelas usaha dua kali dengan cepat mengirim dua permintaan, dan
   * yang lebih dulu berangkat tidak selalu lebih dulu pulang. Tanpa penanda
   * ini, peta bisa berakhir memegang peringkat untuk kelas yang TIDAK sedang
   * tertulis di pemilihnya — salah tanpa satu pun galat.
   */
  const permintaan = useRef(0)

  const ambil = async (k: string) => {
    const nomor = ++permintaan.current
    setMemuat(true)
    setGalat(null)
    try {
      const d = await api.blokHeksagon(h3, k === UMUM ? null : k)
      if (nomor !== permintaan.current) return
      onData(d)
    } catch (e) {
      if (nomor !== permintaan.current) return
      onData(null)
      setGalat(e instanceof GalatAPI ? e.message : t.gagal)
    } finally {
      if (nomor === permintaan.current) setMemuat(false)
    }
  }

  const tutup = () => {
    permintaan.current++
    setMemuat(false)
    setGalat(null)
    onPilih(null)
    onData(null)
  }

  const gantiKelas = (k: string) => {
    setKelas(k)
    if (data) void ambil(k)
  }

  if (!data) {
    return (
      <>
        <button
          onClick={() => void ambil(kelas)}
          disabled={memuat}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[13.5px] font-semibold text-surface transition-all duration-300 ease-jelly hover:scale-[1.015] disabled:cursor-wait disabled:opacity-60"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
            <path
              d="M8 1.6 13.6 4.8v6.4L8 14.4 2.4 11.2V4.8Z M8 1.6V8 M8 8l5.6 3.2 M8 8 2.4 11.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {memuat ? t.memuat : t.buka}
        </button>
        {memuat && <Memuat baris={3} teks={t.memuat} />}
        {galat && <p className="mt-2 text-[13px] leading-snug text-bahaya">{galat}</p>}
      </>
    )
  }

  const berskor = data.blok.filter((b) => b.skor != null)
  const terbaik = berskor[0] ?? null
  const terlemah = berskor.length > 1 ? berskor[berskor.length - 1] : null
  const rentang = terbaik && terlemah ? (terbaik.skor ?? 0) - (terlemah.skor ?? 0) : null
  const kalimatRentang =
    rentang == null
      ? null
      : rentang < RENTANG_SEMPIT
        ? t.rentangSempit
        : rentang > RENTANG_LEBAR
          ? t.rentangLebar
          : t.rentangSedang

  const opsi = [
    { nilai: UMUM, label: t.umum, catatan: t.umumCatatan },
    ...Object.entries(data.kelas_tersedia).map(([k, nama]) => ({ nilai: k, label: nama })),
  ]
  const blokAktif = data.blok.find((b) => b.h3_blok === terpilih) ?? null

  return (
    <div className="blok-bedah">
      {/* --- Kepala: pemilih kelas + tutup, SATU baris sejajar ------------- */}
      <div className="flex items-stretch gap-2">
        <div className="min-w-0 flex-1">
          <PilihKelas label={t.kelasLabel} nilai={kelas} opsi={opsi} onUbah={gantiKelas} />
        </div>
        <button
          onClick={tutup}
          aria-label={t.tutup}
          title={t.tutup}
          className="grid w-11 shrink-0 cursor-pointer place-items-center rounded-xl border border-line bg-surface-2 text-ink-3 transition-colors hover:border-ink-3 hover:text-ink"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {memuat ? (
        <Memuat baris={3} teks={t.memuat} />
      ) : (
        <>
          {/* --- Peta mini + ringkasan ------------------------------------ */}
          <div className="blok-ringkas mt-3">
            <PetaMini blok={data.blok} terpilih={terpilih} onPilih={onPilih} />
            <div className="min-w-0 flex-1">
              {terbaik && (
                <BarisRingkas label={t.terbaik} b={terbaik} t={t} onPilih={onPilih} />
              )}
              {terlemah && (
                <BarisRingkas label={t.terlemah} b={terlemah} t={t} onPilih={onPilih} />
              )}
              {rentang != null && (
                <div className="mt-2 border-t border-line/70 pt-2">
                  <p className="flex items-baseline gap-1.5 text-[12px] text-ink-3">
                    {t.selisih}
                    <span className="tabular text-[15px] font-semibold text-ink">
                      {angka(rentang, 1)}
                    </span>
                    {t.poin}
                  </p>
                  {kalimatRentang && (
                    <p className="mt-0.5 text-[12px] leading-snug text-ink-2">{kalimatRentang}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* --- Daftar ketujuh blok -------------------------------------- */}
          <ul className="mt-3 flex flex-col gap-1.5">
            {data.blok.map((b, i) => (
              <Blok
                key={b.h3_blok}
                b={b}
                t={t}
                urutan={i}
                simpul={data.nama_simpul}
                aktif={terpilih === b.h3_blok}
                onPilih={() => onPilih(terpilih === b.h3_blok ? null : b.h3_blok)}
                onSimulasi={onSimulasi}
              />
            ))}
          </ul>
          {!blokAktif && <p className="mt-2 text-[11.5px] text-ink-3">{t.petunjuk}</p>}
        </>
      )}

      <Rinci ringkas={t.tabel}>
        <Tabel blok={data.blok} t={t} />
      </Rinci>

      <div className="mt-2.5 flex items-start gap-2">
        <Badge badge={data.keyakinan} ringkas />
      </div>
      <p className="mt-1.5 text-[11.5px] leading-snug text-ink-3">{data.catatan}</p>
    </div>
  )
}

/**
 * Ketujuh blok digambar sebagai heksagon kecil pada POSISI SEBENARNYA.
 *
 * Diproyeksikan dari koordinat poligonnya sendiri, bukan diletakkan pada pola
 * "satu di tengah enam mengelilingi" yang dihafal: blok res-10 tidak pernah
 * tersusun serapi itu di dalam induk res-9, dan pola hafalan akan menaruh
 * "blok utara" di tempat yang bukan utara. Warnanya `warnaSkorBlok`, rona yang
 * sama dengan layer di peta, jadi yang terlihat di sini dan di peta satu hal.
 */
function PetaMini({
  blok,
  terpilih,
  onPilih,
}: {
  blok: BlokDalamHeksagon[]
  terpilih: string | null
  onPilih: (h3Blok: string | null) => void
}) {
  const bentuk = useMemo(() => {
    const semua = blok.flatMap((b) => b.koordinat)
    if (semua.length === 0) return null
    const lat0 = semua.reduce((a, [, la]) => a + la, 0) / semua.length
    const kos = Math.cos((lat0 * Math.PI) / 180)
    const xy = (lon: number, lat: number): [number, number] => [lon * kos, -lat]
    const titik = semua.map(([lo, la]) => xy(lo, la))
    const minX = Math.min(...titik.map((p) => p[0]))
    const maksX = Math.max(...titik.map((p) => p[0]))
    const minY = Math.min(...titik.map((p) => p[1]))
    const maksY = Math.max(...titik.map((p) => p[1]))
    const UKURAN = 112
    const tepi = 5
    const skala = (UKURAN - tepi * 2) / Math.max(maksX - minX, maksY - minY)
    const ox = (UKURAN - (maksX - minX) * skala) / 2
    const oy = (UKURAN - (maksY - minY) * skala) / 2
    const pr = (lo: number, la: number) => {
      const [x, y] = xy(lo, la)
      return [ox + (x - minX) * skala, oy + (y - minY) * skala] as [number, number]
    }
    return blok.map((b) => ({
      b,
      d: b.koordinat.map(([lo, la], i) => `${i ? 'L' : 'M'}${pr(lo, la).map((v) => v.toFixed(1)).join(' ')}`).join('') + 'Z',
      pusat: pr(b.lon, b.lat),
    }))
  }, [blok])

  if (!bentuk) return null
  return (
    <svg viewBox="0 0 112 112" className="blok-mini" role="group" aria-label="7 blok">
      {bentuk.map(({ b, d, pusat }) => {
        const aktif = b.h3_blok === terpilih
        const dilarang = b.izin_komersial === false
        const isi = warnaSkorBlok(b.skor, dilarang)
        const gelap = !dilarang && (b.skor ?? 0) >= 60
        return (
          <g
            key={b.h3_blok}
            className="blok-mini-sel"
            data-aktif={aktif || undefined}
            onClick={() => onPilih(aktif ? null : b.h3_blok)}
          >
            <path d={d} fill={isi} />
            <text
              x={pusat[0]}
              y={pusat[1]}
              textAnchor="middle"
              dominantBaseline="central"
              className="blok-mini-angka"
              fill={gelap ? '#ffffff' : '#16211c'}
            >
              {b.peringkat}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function BarisRingkas({
  label,
  b,
  t,
  onPilih,
}: {
  label: string
  b: BlokDalamHeksagon
  t: Teks
  onPilih: (h3Blok: string) => void
}) {
  return (
    <button
      onClick={() => onPilih(b.h3_blok)}
      className="flex w-full cursor-pointer items-center gap-2 rounded-lg py-1 text-left transition-colors hover:bg-surface-2/70"
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: warnaSkorBlok(b.skor, b.izin_komersial === false) }}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">{label}</span>
        <span className="block truncate text-[12.5px] text-ink">
          {b.nama_jalan_utama ?? t.blokKe(b.peringkat)}
        </span>
      </span>
      <span className="tabular shrink-0 text-[14px] font-semibold text-ink">{angka(b.skor, 1) ?? t.kosong}</span>
    </button>
  )
}

function Blok({
  b,
  t,
  urutan,
  simpul,
  aktif,
  onPilih,
  onSimulasi,
}: {
  b: BlokDalamHeksagon
  t: Teks
  urutan: number
  simpul: string | null
  aktif: boolean
  onPilih: () => void
  onSimulasi?: (h3Blok: string) => void
}) {
  const dilarang = b.izin_komersial === false
  const warna = warnaSkorBlok(b.skor, dilarang)
  return (
    <li className="blok-baris" data-aktif={aktif || undefined} style={{ animationDelay: `${urutan * 30}ms` }}>
      <button onClick={onPilih} aria-pressed={aktif} className="blok-baris-tombol">
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[12px] font-bold"
          style={{ background: warna, color: !dilarang && (b.skor ?? 0) >= 60 ? '#fff' : '#16211c' }}
          aria-hidden
        >
          {b.peringkat}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[13.5px] font-medium text-ink">
              {b.nama_jalan_utama ?? t.blokKe(b.peringkat)}
            </span>
            <span className="tabular shrink-0 text-[14px] font-semibold text-ink">
              {angka(b.skor, 1) ?? t.kosong}
            </span>
          </span>
          {/* Batang skor 0-100. Lebar = skornya sendiri, bukan peringkat. */}
          <span className="mt-1 block h-[5px] overflow-hidden rounded-full bg-ground-2">
            <span
              className="blok-batang block h-full rounded-full"
              style={{ width: `${Math.max(2, b.skor ?? 0)}%`, background: warna }}
            />
          </span>
          <span className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11.5px] text-ink-3">
            {b.menit_jalan != null && (
              <Fakta glif={GLIF.menit_jalan_inv}>
                {Math.round(b.menit_jalan)} {t.kMenit}
              </Fakta>
            )}
            {b.jarak_jalan_utama_m != null && (
              <Fakta glif={GLIF.jarak_jalan_utama_m_inv}>{jarakSingkat(b.jarak_jalan_utama_m)}</Fakta>
            )}
            <Fakta glif={GLIF.n_usaha_150m}>
              {b.n_usaha_150m} {t.kUsaha}
            </Fakta>
            {dilarang && <span className="font-semibold text-bahaya">{t.zonaTidak}</span>}
          </span>
        </span>
      </button>

      {/* Rincian dibuka HANYA untuk blok yang sedang dipilih. Tujuh blok yang
          semuanya terbuka berhenti bisa dibandingkan - yang justru gunanya. */}
      {aktif && <RincianBlok b={b} t={t} simpul={simpul} onSimulasi={onSimulasi} />}
    </li>
  )
}

function Fakta({ glif, children }: { glif: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden className="shrink-0">
        <path d={glif} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {children}
    </span>
  )
}

/** Kalimat fakta untuk satu indikator, dari angka blok itu sendiri. */
function faktaIndikator(k: KontribusiBlok, b: BlokDalamHeksagon, t: Teks, simpul: string | null): string | null {
  switch (k.kode) {
    case 'menit_jalan_inv':
      return b.menit_jalan == null ? null : t.fakta.menit(b.menit_jalan, simpul)
    case 'jarak_jalan_utama_m_inv':
      return b.jarak_jalan_utama_m == null ? null : t.fakta.jalan(jarakSingkat(b.jarak_jalan_utama_m), b.nama_jalan_utama)
    case 'n_usaha_150m':
      return t.fakta.usaha(b.n_usaha_150m)
    case 'n_penarik_250m': {
      const rincian = Object.entries(b.penarik_250m ?? {})
        .filter(([, n]) => n > 0)
        .sort((a, c) => c[1] - a[1])
        .slice(0, 2)
        .map(([jenis, n]) => `${n} ${(n > 1 ? t.jamak[jenis] : undefined) ?? t.penarik[jenis] ?? jenis}`)
        .join(', ')
      return t.fakta.penarik(b.n_penarik_250m, rincian)
    }
    case 'jarak_halte_m_inv':
      return b.jarak_halte_m == null ? null : t.fakta.halte(jarakSingkat(b.jarak_halte_m))
    case 'rasio_tutupan_bangunan':
      return b.rasio_tutupan_bangunan == null ? null : t.fakta.tutupan(`${angka(b.rasio_tutupan_bangunan * 100, 0)}%`)
    case 'risiko_banjir_inv':
      return t.fakta.banjir
    default:
      return null
  }
}

/**
 * Kenapa skor blok ini segitu - sebagai FAKTA dan meteran, bukan persentase.
 *
 * `kekuatan` dihitung backend dari sumbangan pipeline dibagi bobotnya (aturan
 * 1 tetap utuh). Lima titik dipilih karena lima adalah skala yang dibaca orang
 * tanpa berpikir - bintang ulasan, sinyal ponsel.
 */
function RincianBlok({
  b,
  t,
  simpul,
  onSimulasi,
}: {
  b: BlokDalamHeksagon
  t: Teks
  simpul: string | null
  onSimulasi?: (h3Blok: string) => void
}) {
  const zona =
    b.izin_komersial === true
      ? { teks: t.zonaBoleh, kelas: 'blok-zona-boleh' }
      : b.izin_komersial === false
        ? { teks: t.zonaTidak, kelas: 'blok-zona-tidak' }
        : { teks: t.zonaTahu, kelas: 'blok-zona-tahu' }

  return (
    <div className="blok-rinci">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-ink-2">
          {t.dari7(b.peringkat)}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${zona.kelas}`}>
          {zona.teks}
          {b.kelas_zona ? ` · ${b.kelas_zona}` : ''}
        </span>
        {b.pangsa_zona_usaha != null && b.pangsa_zona_usaha > 0 && (
          <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-3">
            {t.pangsaZona(`${angka(b.pangsa_zona_usaha * 100, 0)}%`)}
          </span>
        )}
      </div>

      {b.kontribusi.length > 0 && (
        <>
          <p className="eyebrow mb-2 mt-3">{t.kenapa}</p>
          <ul className="flex flex-col gap-2">
            {b.kontribusi.map((k) => {
              const banjir = k.kode === 'risiko_banjir_inv'
              const kuat = k.kekuatan ?? 0
              const titik = Math.max(0, Math.min(5, Math.round(kuat * 5)))
              const kata = banjir
                ? t.risiko[kuat >= 0.66 ? 2 : kuat >= 0.33 ? 1 : 0]
                : // Kata mengikuti JUMLAH TITIK yang tergambar, bukan ambang sendiri -
                  // empat titik yang dibaca "Sangat baik" adalah dua skala berselisih.
                  t.tingkat[Math.max(0, titik - 1)]
              const fakta = faktaIndikator(k, b, t, simpul)
              return (
                <li key={k.kode} className="blok-alasan" data-menekan={banjir || undefined}>
                  <span className="blok-alasan-ikon" aria-hidden>
                    <svg width="15" height="15" viewBox="0 0 16 16">
                      <path d={GLIF[k.kode] ?? GLIF.n_penarik_250m} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 text-[12.5px] font-semibold leading-tight text-ink">{k.nama}</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className="blok-meter" aria-hidden>
                          {[0, 1, 2, 3, 4].map((i) => (
                            <span key={i} data-isi={i < titik || undefined} />
                          ))}
                        </span>
                        <span className="w-[5.6rem] text-right text-[11px] font-medium text-ink-2">{kata}</span>
                      </span>
                    </span>
                    {fakta && <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-3">{fakta}</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <p className="eyebrow mb-2 mt-3.5">{t.dataBlok}</p>
      <div className="grid grid-cols-2 gap-1.5">
        <Ubin label={t.kBangunan} nilai={String(b.n_bangunan)} />
        <Ubin
          label={t.kTutupan}
          nilai={b.rasio_tutupan_bangunan == null ? t.takAda : `${angka(b.rasio_tutupan_bangunan * 100, 0)}%`}
        />
        <Ubin
          label={t.kPesaing}
          nilai={b.n_pesaing_150m == null ? t.kosong : String(b.n_pesaing_150m)}
          catatan={b.n_pesaing_150m == null ? undefined : t.dalam150}
        />
        <Ubin label={t.kSkorUmum} nilai={angka(b.skor_umum, 1) ?? t.takAda} />
      </div>

      {/* Hanya PERINGATAN dari backend. Alasannya sudah tertulis sebagai fakta
          di atas - menaruhnya lagi sebagai daftar kalimat berarti tiap angka
          terbaca dua kali, dan itu yang membuat panel ini dulu terasa penuh. */}
      {b.peringatan.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {b.peringatan.map((a) => (
            <li key={a} className="flex gap-1.5 text-[12px] leading-snug text-jebakan">
              <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-jebakan" aria-hidden />
              {a}
            </li>
          ))}
        </ul>
      )}

      {onSimulasi && (
        <button onClick={() => onSimulasi(b.h3_blok)} className="blok-simulasi group">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface/15">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="M2.5 13.5h11M4 11V8M7 11V5M10 11V7M13 11V3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-[13px] font-semibold">{t.simulasi}</span>
            <span className="block text-[11px] leading-snug opacity-75">{t.simulasiCatatan}</span>
          </span>
          <svg width="15" height="15" viewBox="0 0 20 20" className="shrink-0 transition-transform duration-300 ease-jelly group-hover:translate-x-1" aria-hidden>
            <path d="M4 10h11m-4-4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  )
}

function Ubin({ label, nilai, catatan }: { label: string; nilai: string; catatan?: string }) {
  return (
    <div className="rounded-lg bg-surface px-2.5 py-2">
      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">{label}</p>
      <p className="tabular mt-0.5 text-[15px] font-semibold leading-tight text-ink">
        {nilai}
        {catatan && <span className="ml-1 text-[10.5px] font-normal text-ink-3">{catatan}</span>}
      </p>
    </div>
  )
}

/**
 * Tujuh baris, lima kolom - untuk yang ingin menaruh angka bersebelahan.
 *
 * `overflow-x-auto`: lima kolom angka tidak masuk di 390 px, dan tabel yang
 * melebar memaksa SELURUH panel menggulir ke samping.
 */
function Tabel({ blok, t }: { blok: BlokDalamHeksagon[]; t: Teks }) {
  const kolom: { kepala: string; panjang: string; isi: (b: BlokDalamHeksagon) => string }[] = [
    { kepala: t.kMenit, panjang: t.kolMenit, isi: (b) => (b.menit_jalan == null ? t.kosong : `${Math.round(b.menit_jalan)}`) },
    { kepala: t.kJalan, panjang: t.kolJalan, isi: (b) => (b.jarak_jalan_utama_m == null ? t.kosong : jarakSingkat(b.jarak_jalan_utama_m)) },
    { kepala: t.kUsaha, panjang: t.kolUsaha, isi: (b) => String(b.n_usaha_150m) },
    { kepala: t.kPenarik, panjang: t.kolPenarik, isi: (b) => String(b.n_penarik_250m) },
    { kepala: t.kHalte, panjang: t.kolHalte, isi: (b) => (b.jarak_halte_m == null ? t.kosong : jarakSingkat(b.jarak_halte_m)) },
  ]
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[19rem] border-collapse text-[11.5px]">
        <thead>
          <tr className="text-ink-3">
            <th className="py-1 pr-2 text-left font-medium">#</th>
            {kolom.map((k) => (
              <th key={k.kepala} className="py-1 pr-2 text-right font-medium" title={k.panjang}>
                {k.kepala}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {blok.map((b) => (
            <tr key={b.h3_blok} className="border-t border-line">
              <td className="py-1 pr-2 font-mono text-ink-2">{b.peringkat}</td>
              {kolom.map((k) => (
                <td key={k.kepala} className="py-1 pr-2 text-right font-mono text-ink-2">
                  {k.isi(b)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
