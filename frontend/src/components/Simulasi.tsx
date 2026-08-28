/**
 * Simulasi kelayakan usaha — lembar bawah, mode fokus.
 *
 * KENAPA BERKAS SENDIRI. Alasannya sama dengan `PanelAI.tsx`: ini kemampuan
 * produk bernama, dengan permintaan jaringannya sendiri, keadaan kendalinya
 * sendiri, dan siklus hidupnya sendiri.
 *
 * KENAPA LEMBAR BAWAH, BUKAN PANEL SAMPING. Simulasi menjawab pertanyaan yang
 * berbeda dari seluruh layar di belakangnya. Panel samping menempatkannya
 * sebagai salah satu tab di antara yang lain; lembar yang naik dari bawah dan
 * menutup separuh bawah layar menyatakan "sekarang kita sedang mengerjakan satu
 * hal". Tingginya dijaga di bawah setengah layar dengan sengaja - peta harus
 * tetap terlihat, karena heksagon yang sedang disimulasikan ada di sana, dan
 * membandingkannya dengan tetangganya adalah bagian dari pekerjaannya.
 *
 * YANG MEMBUATNYA JUJUR. Seluruh aritmetikanya di `backend/app/core/simulasi.py`
 * - komponen ini tidak menghitung satu angka pun. Yang ditampilkan dipisah tiga:
 *
 *   TERUKUR   angka basis data. Tidak bisa disentuh.
 *   ASUMSI    milik pengguna. Punya penggeser, bawaannya angka BULAT.
 *   TURUNAN   hasilnya, selalu dengan rumusnya tertulis di bawahnya.
 *
 * DUA HAL YANG SERING DIMINTA TAPI TIDAK ADA, dan tidak dikarang di sini:
 *   UMR                  data SK gubernur, di luar 43 variabel Kamus Data.
 *   Jumlah jalan akses   butuh agregasi jaringan jalan yang belum dikerjakan s4.
 * Keduanya tidak muncul sebagai baris kosong maupun sebagai tebakan.
 */

import { useEffect, useRef, useState } from 'react'

import { kodeLokasi, nomorLokasi } from '../config'
import { api } from '../lib/api'
import { useSesi } from './Akun'
import { angka, rupiah } from '../lib/format'
import type { Simulasi as HasilSimulasi } from '../types'
import { Badge, Memuat } from './primitif'

const JENIS = [
  {
    nilai: 'kuliner_ringan',
    label: 'Kopi & jajanan',
    contoh: 'kedai kopi, roti bakar, es teh',
    glif: 'M5 7h9v5a4.5 4.5 0 0 1-9 0Zm9 1h1.6a1.9 1.9 0 0 1 0 3.8H14M4 17.5h11',
  },
  {
    nilai: 'warung_makan',
    label: 'Warung makan',
    contoh: 'nasi, mi ayam, soto',
    glif: 'M5 4v6a2 2 0 0 0 4 0V4M7 10v9M13.5 4c-1 2-1.5 4-1.5 6a2 2 0 0 0 2 2v7',
  },
  {
    nilai: 'retail_kecil',
    label: 'Kelontong & ATK',
    contoh: 'sembako, fotokopi, pulsa',
    glif: 'M3.5 7h13l-1 10h-11ZM7 7V5.5a3 3 0 0 1 6 0V7',
  },
  {
    nilai: 'jasa',
    label: 'Jasa',
    contoh: 'barbershop, laundry, servis',
    glif: 'M6 4.5 14 15M14 4.5 6 15M4 16.5a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm8 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z',
  },
] as const

/** Bawaan per jenis usaha. Sama dengan JENIS_USAHA di backend — dijaga manual. */
const BAWAAN: Record<string, { jam: number; luas: number; margin: number }> = {
  kuliner_ringan: { jam: 12, luas: 12, margin: 35 },
  warung_makan: { jam: 11, luas: 24, margin: 28 },
  retail_kecil: { jam: 12, luas: 18, margin: 20 },
  jasa: { jam: 10, luas: 16, margin: 45 },
}

/**
 * Angka yang berjalan naik ke nilai barunya, bukan yang berganti seketika.
 *
 * Bukan kemeriahan. Satu geseran mengubah empat angka sekaligus, dan angka yang
 * berganti seketika tidak memberi tahu mana yang naik dan mana yang turun. Yang
 * berjalan menunjukkan ARAH — dan arah itulah yang sedang dicari orang saat
 * menggeser.
 */
function useAngkaBerjalan(target: number | null, durasi = 420) {
  const [nilai, setNilai] = useState(target ?? 0)
  const dari = useRef(target ?? 0)
  const raf = useRef(0)

  useEffect(() => {
    if (target === null) return
    const awal = dari.current
    const t0 = performance.now()
    const langkah = (now: number) => {
      const p = Math.min(1, (now - t0) / durasi)
      const v = awal + (target - awal) * (1 - Math.pow(1 - p, 3))
      setNilai(v)
      dari.current = v
      if (p < 1) raf.current = requestAnimationFrame(langkah)
    }
    raf.current = requestAnimationFrame(langkah)
    return () => cancelAnimationFrame(raf.current)
  }, [target, durasi])

  return target === null ? null : nilai
}

/**
 * Isian rupiah. Beda dari `Penggeser` bukan cuma bentuknya: penggeser cocok
 * untuk asumsi yang rentangnya kita tahu (jam buka 4-24), sedangkan sewa dan
 * harga jual adalah angka yang penggunanya SUDAH PEGANG - memaksanya menggeser
 * ke Rp4.500.000 lewat penggeser adalah cara paling cepat membuat orang
 * menyerah dan menerima angka yang salah.
 *
 * Kosong berarti "belum diisi", dan itu dikirim sebagai `undefined` - bukan 0.
 * Nol akan terbaca backend sebagai sewa gratis kalau penjaganya lengah.
 */
function IsianRupiah({
  label,
  nilai,
  bantuan,
  onUbah,
}: {
  label: string
  nilai: number | null
  bantuan?: string
  onUbah: (v: number | null) => void
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[12px] text-ink-2">{label}</span>
        {nilai !== null && (
          <span className="text-[10px] font-medium text-aksen">dari Anda</span>
        )}
      </span>
      <div className="mt-1 flex items-center gap-1 rounded-sm border border-line bg-surface px-2 py-1 focus-within:border-ink-3">
        <span className="text-[11px] text-ink-3">Rp</span>
        <input
          type="text"
          inputMode="numeric"
          value={nilai === null ? '' : nilai.toLocaleString('id-ID')}
          placeholder="belum diisi"
          onChange={(e) => {
            const angka = e.target.value.replace(/[^0-9]/g, '')
            onUbah(angka === '' ? null : Number(angka))
          }}
          className="tabular w-full bg-transparent text-[12.5px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink-3"
        />
      </div>
      {bantuan && (
        <span className="mt-0.5 block text-[10.5px] leading-snug text-ink-3">{bantuan}</span>
      )}
    </label>
  )
}

function Penggeser({
  label,
  nilai,
  min,
  maks,
  satuan,
  bantuan,
  onUbah,
}: {
  label: string
  nilai: number
  min: number
  maks: number
  satuan: string
  bantuan?: string
  onUbah: (v: number) => void
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] text-ink-2">{label}</span>
        <span className="tabular text-[12.5px] font-semibold text-ink">
          {nilai}
          <span className="ml-0.5 text-[10.5px] font-normal text-ink-3">{satuan}</span>
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={maks}
        value={nilai}
        onChange={(e) => onUbah(Number(e.target.value))}
        className="penggeser mt-1 w-full"
      />
      {bantuan && <span className="mt-0.5 block text-[10.5px] leading-snug text-ink-3">{bantuan}</span>}
    </label>
  )
}

/**
 * Satu fakta lingkungan: label, angka, dan sebatang bar.
 *
 * Bar-nya relatif terhadap `puncak` yang diberikan pemanggil — bukan terhadap
 * nilai maksimum sepanjang masa, yang tidak diketahui siapa pun. Tanpa bar,
 * "8,5 pesaing" tidak berarti apa-apa bagi orang yang belum pernah melihat
 * angka pesaing di heksagon lain.
 */
function Fakta({
  label,
  nilai,
  satuan,
  bagian,
  bagus,
  bantuan,
}: {
  label: string
  nilai: number | null | undefined
  satuan?: string
  /** 0..1 — panjang bar. null berarti tidak ada bar yang jujur bisa digambar. */
  bagian?: number | null
  /** true = makin panjang makin baik. false = makin panjang makin buruk. */
  bagus?: boolean
  bantuan?: string
}) {
  const ada = nilai !== null && nilai !== undefined
  return (
    <div title={bantuan}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-[11.5px] text-ink-3">{label}</span>
        <span className="tabular shrink-0 text-[12.5px] font-semibold text-ink">
          {ada ? (
            <>
              {angka(nilai, nilai < 10 ? 1 : 0)}
              {satuan && <span className="ml-0.5 text-[10.5px] font-normal text-ink-3">{satuan}</span>}
            </>
          ) : (
            <span className="text-[11px] font-normal italic text-ink-3">belum ada</span>
          )}
        </span>
      </div>
      {bagian !== null && bagian !== undefined && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ground-2" aria-hidden>
          <div
            className="h-full rounded-full transition-[width] duration-700 ease-liquid"
            style={{
              width: `${Math.max(2, Math.min(100, bagian * 100))}%`,
              background: bagus === false ? 'var(--q-jebakan)' : 'var(--q-menang)',
            }}
          />
        </div>
      )}
    </div>
  )
}

/** Grafik batang 05.00–22.00. Tumbuh dari bawah, berurutan dari kiri. */
function GrafikJam({ profil, teramai }: { profil: HasilSimulasi['profil_jam']; teramai: number[] }) {
  if (!profil.length) {
    return (
      <p className="text-[12px] italic leading-snug text-ink-3">
        Belum ada profil jam untuk heksagon ini.
      </p>
    )
  }
  // Sumbu SELALU 05.00-22.00 penuh, jam yang tak berdata digambar sebagai
  // rongga - bukan dimampatkan.
  //
  // Versi pertama memetakan baris apa adanya. Cuma 58 dari 474 heksagon punya
  // 18 jam penuh; sisanya 4-17 jam. Dengan `flex-1` per baris, heksagon yang
  // datanya cuma pukul 06,07,08,15,16,17 tampil sebagai enam batang berdempet
  // dengan label "06.00 ... 17.00" - terbaca sebagai enam jam berurutan yang
  // ramai merata, padahal ada tujuh jam sepi di tengahnya yang tidak pernah
  // disurvei. Itu persis yang dilarang aturan 4 repo ini: kosong tetap kosong,
  // dan kosong yang dimampatkan berubah jadi pernyataan yang tidak benar.
  const JAM_AWAL = 5
  const JAM_AKHIR = 22
  const menurutJam = new Map(profil.map((j) => [j.jam, j]))
  const slot = Array.from({ length: JAM_AKHIR - JAM_AWAL + 1 }, (_, i) => {
    const jam = JAM_AWAL + i
    return { jam, data: menurutJam.get(jam) ?? null }
  })
  const nKosong = slot.filter((x) => !x.data).length

  return (
    <div>
      <div className="flex h-[86px] items-end gap-[3px]">
        {slot.map(({ jam, data }, i) => {
          const puncak = teramai.includes(jam)
          if (!data)
            return (
              <div
                key={jam}
                className="flex min-w-0 flex-1 flex-col justify-end"
                title={`${String(jam).padStart(2, '0')}.00 — belum ada transaksi tercatat`}
              >
                {/* Garis rambut di dasar: menempati ruangnya, tetapi tidak
                    pernah bisa disalahbaca sebagai batang pendek. */}
                <div className="h-[2px] w-full rounded-full bg-line" />
              </div>
            )
          return (
            <div key={jam} className="group relative flex min-w-0 flex-1 flex-col justify-end">
              <div
                className="batang-jam w-full rounded-t-[3px]"
                style={{
                  height: `${Math.max(3, data.relatif * 100)}%`,
                  background: puncak ? 'var(--q-menang)' : 'var(--color-line-2)',
                  animationDelay: `${i * 24}ms`,
                }}
                title={`${String(jam).padStart(2, '0')}.00 — ${Math.round(data.relatif * 100)}% dari jam tersibuk`}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-3">
        <span>05.00</span>
        <span className="font-semibold text-ink-2">
          teramai {teramai.map((j) => `${String(j).padStart(2, '0')}`).join(' · ')}
        </span>
        <span>22.00</span>
      </div>
      {nKosong > 0 && (
        <p className="mt-1 text-[10px] leading-snug text-ink-3">
          {nKosong} jam tanpa transaksi tercatat digambar sebagai rongga — bukan
          berarti sepi, berarti belum ada yang mensurvei jam itu.
        </p>
      )}
    </div>
  )
}

function Turunan({
  label,
  nilai,
  rumus,
  besar,
  raksasa,
  warna,
}: {
  label: string
  nilai: number | null
  rumus?: string
  besar?: boolean
  /** Angka utama slide pertama. Ia satu-satunya jawaban di layar itu. */
  raksasa?: boolean
  warna?: string
}) {
  const berjalan = useAngkaBerjalan(nilai)
  return (
    <div>
      {label && <p className="eyebrow text-[9.5px]">{label}</p>}
      <p
        className={`papan tabular leading-none ${
          raksasa ? 'mt-1 text-[44px]' : besar ? 'text-[30px]' : 'text-[16px]'
        }`}
        style={{ color: warna }}
      >
        {berjalan === null ? (
          <span className="text-[13px] font-normal italic text-ink-3">belum ada data</span>
        ) : (
          rupiah(Math.round(berjalan))
        )}
      </p>
      {rumus && <p className="mt-0.5 text-[10px] leading-snug text-ink-3">{rumus}</p>}
    </div>
  )
}

export default function Simulasi({
  h3,
  h3Banding,
  onLepasBanding,
  onKeDetail,
  onTutup,
}: {
  h3: string
  /** Heksagon pembanding, dipilih dengan mengklik peta selagi lembar terbuka. */
  h3Banding?: string | null
  onLepasBanding: () => void
  onKeDetail: () => void
  onTutup: () => void
}) {
  // Preferensi onboarding jadi BAWAAN, bukan paksaan: kalau sudah pernah
  // menjawab "kopi & jajanan", lembar ini langsung membuka skenarionya alih-alih
  // menanyakan hal yang sama untuk kesekian kalinya. Tetap bisa diganti lewat
  // tombol "Ganti jenis usaha".
  const { akun } = useSesi()
  const [jenis, setJenis] = useState<string | null>(
    akun?.preferensi?.jenis_usaha ?? null,
  )
  const bawaanAwal = BAWAAN[akun?.preferensi?.jenis_usaha ?? ''] ?? {
    jam: 12,
    luas: 12,
    margin: 35,
  }
  const [jam, setJam] = useState(bawaanAwal.jam)
  const [luas, setLuas] = useState(bawaanAwal.luas)
  const [pangsa, setPangsa] = useState(5)
  const [margin, setMargin] = useState(bawaanAwal.margin)
  // Sengaja TANPA nilai bawaan. Bawaan apa pun di sini akan jadi angka karangan
  // yang menyamar jadi hitungan - persis yang dihindari seluruh modul simulasi.
  // `null` berarti "belum diisi", dan simulasi menyatakannya apa adanya.
  const [sewaDiisi, setSewaDiisi] = useState<number | null>(null)
  const [hargaDiisi, setHargaDiisi] = useState<number | null>(null)
  const [hasil, setHasil] = useState<HasilSimulasi | null>(null)
  const [banding, setBanding] = useState<HasilSimulasi | null>(null)
  const hasilBanding = banding
  const [galat, setGalat] = useState<string | null>(null)

  // Ditunda 240ms: penggeser mengirim satu perubahan per piksel, dan tanpa
  // penundaan satu geseran jadi puluhan permintaan yang urutan mendaratnya
  // tidak dijamin.
  useEffect(() => {
    if (!jenis) return
    let batal = false
    const p = {
      jenis_usaha: jenis,
      jam_buka: jam,
      luas_m2: luas,
      pangsa_persen: pangsa,
      margin_persen: margin,
      // `undefined` supaya `kueri()` membuangnya dari URL. Mengirim 0 akan
      // membuat URL-nya mengaku sudah diisi padahal belum.
      sewa_bulanan_diminta: sewaDiisi ?? undefined,
      harga_rata_rata: hargaDiisi ?? undefined,
    }
    const t = setTimeout(() => {
      Promise.all([
        api.simulasi(h3, p),
        h3Banding ? api.simulasi(h3Banding, p) : Promise.resolve(null),
      ])
        .then(([a, b]) => {
          if (batal) return
          setHasil(a)
          setBanding(b)
          setGalat(null)
        })
        .catch((e: Error) => !batal && setGalat(e.message))
    }, 240)
    return () => {
      batal = true
      clearTimeout(t)
    }
  }, [h3, h3Banding, jenis, jam, luas, pangsa, margin, sewaDiisi, hargaDiisi])

  // Escape menutup lembarnya, sama dengan setiap dialog lain di aplikasi ini.
  // Tanpa ini ia satu-satunya lapisan menutup layar yang tidak menanggapi
  // Escape - dan lapisan yang berperilaku lain dari saudara-saudaranya terbaca
  // sebagai macet, bukan sebagai pengecualian yang disengaja.
  useEffect(() => {
    const kunci = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onTutup()
    }
    document.addEventListener('keydown', kunci)
    return () => document.removeEventListener('keydown', kunci)
  }, [onTutup])

  const pilihJenis = (v: string) => {
    const b = BAWAAN[v]
    if (b) {
      setJam(b.jam)
      setLuas(b.luas)
      setMargin(b.margin)
    }
    setJenis(v)
  }

  /**
   * Slide mana yang sedang dibaca.
   *
   * Lembar ini dulu memuat empat kolom sekaligus dalam 46vh, dan pemilik repo
   * melaporkannya apa adanya: "kurang besar, mungkin karena terlalu banyak".
   * Diagnosisnya benar - masalahnya bukan tingginya, melainkan bahwa empat
   * pertanyaan berbeda dijawab serentak di satu layar sempit, jadi tidak ada
   * satu pun yang mendapat ruang untuk dibaca.
   *
   * Sekarang satu slide satu pertanyaan, selebar lembar. Digeser dengan
   * `scroll-snap` - jadi trackpad, layar sentuh, tombol panah, dan titik
   * navigasi semuanya bekerja tanpa satu baris pun kode gerak.
   */
  const [slide, setSlide] = useState(0)
  const rel = useRef<HTMLDivElement>(null)

  const keSlide = (i: number) => {
    const n = rel.current
    if (!n) return
    n.scrollTo({ left: n.clientWidth * i, behavior: 'smooth' })
  }

  const laba = hasil?.hasil.laba_kotor_bulanan ?? null
  const untung = laba !== null && laba > 0
  // Sejak omzet menuntut data survei sementara sewa dan harga jual boleh diisi
  // sendiri, judulnya harus mengikuti apa yang BISA dihitung - bukan selalu
  // laba. Tanpa ini, heksagon tanpa data belanja memasang judul "Perkiraan
  // kekurangan tiap bulan" di atas angka kosong, lalu menutupnya dengan
  // "omzetnya belum menutup sewa" - kalimat yang menyatakan sesuatu yang justru
  // tidak diketahui.
  const impasPembeli = hasil?.hasil.pembeli_impas_per_hari ?? null
  const bisaLaba = laba !== null
  const bisaImpas = !bisaLaba && impasPembeli !== null
  const L = hasil?.lingkungan
  const impas = hasil?.hasil.pangsa_impas_persen ?? null

  const SLIDE = [
    { kunci: 'hasil', judul: 'Untung atau rugi?' },
    { kunci: 'peka', judul: 'Kalau ramainya beda' },
    { kunci: 'jam', judul: 'Ramai jam berapa' },
    { kunci: 'sekitar', judul: 'Sekitar sini' },
  ]

  return (
    <section
      className="kaca-tebal lembar-naik pointer-events-auto absolute inset-x-0 bottom-0 z-40 flex max-h-[64vh] min-h-[19rem] flex-col overflow-hidden rounded-t-xl border-b-0"
      aria-label="Simulasi usaha"
    >
      {/* --- Bilah lembar ---------------------------------------------------- */}
      <div className="flex shrink-0 items-center gap-3 border-b border-line/70 px-4 py-2.5">
        <button
          onClick={onKeDetail}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12.5px] font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
            <path
              d="M7.5 1.5 3 6l4.5 4.5"
              stroke="currentColor"
              strokeWidth="1.8"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Detail lokasi
        </button>

        <div className="min-w-0 flex-1">
          <p className="eyebrow">Simulasi usaha</p>
          <p className="truncate text-[12px] font-medium text-ink-2">
            {hasil ? kodeLokasi(h3, hasil.kawasan) : nomorLokasi(h3)}
            {h3Banding && hasilBanding ? ` vs ${kodeLokasi(h3Banding, hasilBanding.kawasan)}` : ''}
          </p>
        </div>

        {h3Banding ? (
          <button
            onClick={onLepasBanding}
            className="shrink-0 cursor-pointer rounded-full border border-line px-3 py-1.5 text-[11.5px] font-medium text-ink-2 transition-colors hover:border-line-2 hover:text-ink"
          >
            Lepas pembanding
          </button>
        ) : (
          jenis && (
            <span className="hidden shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-[11.5px] text-ink-3 lg:inline">
              Klik heksagon lain di peta untuk membandingkan
            </span>
          )
        )}
        {hasil && <Badge badge={hasil.keyakinan} />}
        <button
          onClick={onTutup}
          aria-label="Tutup simulasi"
          className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden>
            <path d="M5 5l10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {!jenis ? (
        // --- Langkah 1: satu pertanyaan saja --------------------------------
        // Empat penggeser dan tiga grafik yang muncul sekaligus akan membuat
        // orang menutup lembar ini sebelum membacanya. Satu pertanyaan dulu.
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
          <p className="mb-1 text-center text-[19px] font-semibold text-ink">
            Mau buka usaha apa di sini?
          </p>
          <p className="mb-5 text-center text-[13px] text-ink-2">
            Pilih satu, lalu kami hitungkan untung ruginya pakai angka lokasi ini.
          </p>
          <div className="mx-auto grid max-w-[52rem] grid-cols-2 gap-3 lg:grid-cols-4">
            {JENIS.map((j) => (
              <button
                key={j.nilai}
                onClick={() => pilihJenis(j.nilai)}
                className="group flex cursor-pointer flex-col items-center gap-2.5 rounded-xl border border-line bg-surface p-5 text-center transition-all duration-300 ease-jelly hover:-translate-y-1 hover:border-ink"
              >
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-ink text-surface transition-transform duration-300 ease-jelly group-hover:scale-110">
                  <svg width="26" height="26" viewBox="0 0 20 20" aria-hidden>
                    <path
                      d={j.glif}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span>
                  <span className="block text-[14.5px] font-semibold leading-tight">{j.label}</span>
                  <span className="mt-1 block text-[12px] leading-snug text-ink-3">{j.contoh}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : galat ? (
        <p className="px-5 py-8 text-center text-[13.5px] leading-snug text-ink-2">{galat}</p>
      ) : !hasil ? (
        <Memuat baris={3} teks="Menghitung skenario…" />
      ) : (
        <>
          {/* --- Navigasi slide ---------------------------------------------- */}
          <div className="flex shrink-0 items-center gap-1 border-b border-line/70 px-3 py-1.5">
            {SLIDE.map((s, i) => (
              <button
                key={s.kunci}
                onClick={() => keSlide(i)}
                aria-current={slide === i ? 'true' : undefined}
                className={`cursor-pointer rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-all duration-300 ease-liquid ${
                  slide === i
                    ? 'bg-ink text-surface shadow-[0_5px_14px_-6px_rgb(22_33_28/0.7)]'
                    : 'text-ink-3 hover:bg-surface-2 hover:text-ink-2'
                }`}
              >
                {s.judul}
              </button>
            ))}
            <span className="ml-auto hidden text-[11px] text-ink-3 lg:inline">
              geser untuk melihat semuanya
            </span>
          </div>

          {/* --- Rel slide -----------------------------------------------------
              `scroll-snap` milik peramban, bukan JavaScript. Yang menahan
              posisinya compositor, jadi geserannya tetap mulus walau peta di
              belakangnya sedang menggambar ulang - pelajaran yang sama dengan
              gulir lintang di halaman gerbang. */}
          <div
            ref={rel}
            onScroll={(e) => {
              const n = e.currentTarget
              const i = Math.round(n.scrollLeft / n.clientWidth)
              if (i !== slide) setSlide(i)
            }}
            className="scroll-tipis flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden"
          >
            {/* ================= 1. Untung atau rugi ======================== */}
            <div className="min-w-full shrink-0 snap-center overflow-y-auto px-5 py-4">
              <div className="mx-auto grid max-w-[60rem] gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                <div>
                  <div
                    className="rounded-xl p-5"
                    style={{
                      background: untung
                        ? 'color-mix(in srgb, var(--q-menang-lembut) 70%, transparent)'
                        : bisaLaba
                          ? 'color-mix(in srgb, var(--q-jebakan-lembut) 65%, transparent)'
                          : 'var(--color-surface-2)',
                    }}
                  >
                    <p className="text-[13px] font-medium text-ink-2">
                      {bisaLaba
                        ? untung
                          ? 'Perkiraan sisa uang tiap bulan'
                          : 'Perkiraan kekurangan tiap bulan'
                        : bisaImpas
                          ? 'Pembeli per hari agar sewa tertutup'
                          : 'Belum bisa dihitung'}
                    </p>

                    {bisaLaba ? (
                      <Turunan
                        label=""
                        nilai={Math.abs(laba as number)}
                        raksasa
                        warna={untung ? 'var(--q-menang)' : 'var(--q-jebakan)'}
                      />
                    ) : bisaImpas ? (
                      <p className="papan tabular mt-1 text-[44px] leading-none text-ink">
                        {Math.ceil(impasPembeli as number)}
                        <span className="ml-1.5 text-[15px] font-normal text-ink-2">
                          orang / hari
                        </span>
                      </p>
                    ) : (
                      <p className="papan tabular mt-1 text-[44px] leading-none text-ink-3">—</p>
                    )}

                    <p className="mt-1 text-[12px] leading-snug text-ink-2">
                      {bisaLaba
                        ? untung
                          ? 'Sudah dikurangi sewa. Belum dikurangi gaji, listrik, dan bahan.'
                          : 'Dengan asumsi sekarang, omzetnya belum menutup sewa.'
                        : bisaImpas
                          ? 'Sekadar menutup sewa — belum untung. Dihitung dari sewa dan harga jual yang Anda isi, tanpa satu pun tebakan kami.'
                          : 'Isi sewa yang ditawarkan dan harga rata-rata per pembeli di bawah. Keduanya ada di tangan Anda, bukan di peta.'}
                    </p>

                    {hasil.hasil.omzet_bulanan !== null && hasil.hasil.sewa_bulanan !== null && (
                      <div className="mt-4">
                        <div className="flex h-3.5 overflow-hidden rounded-full bg-surface/70" aria-hidden>
                          <div
                            style={{
                              width: `${Math.min(100, (hasil.hasil.sewa_bulanan / Math.max(hasil.hasil.omzet_bulanan, 1)) * 100)}%`,
                              background: 'var(--q-jebakan)',
                            }}
                          />
                        </div>
                        <p className="mt-1.5 flex items-baseline justify-between gap-2 text-[12px] text-ink-2">
                          <span>Sewa {rupiah(hasil.hasil.sewa_bulanan)}</span>
                          <span>Omzet {rupiah(hasil.hasil.omzet_bulanan)}</span>
                        </p>
                      </div>
                    )}
                  </div>

                  {banding && (
                    <div className="masuk mt-3 rounded-lg border border-line bg-surface-2/60 px-4 py-3">
                      <p className="eyebrow mb-1">Pembanding</p>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[12px] text-ink-3">
                          {kodeLokasi(banding.h3_index, banding.kawasan)}
                        </span>
                        <span
                          className="tabular text-[15px] font-semibold"
                          style={{
                            color:
                              (banding.hasil.laba_kotor_bulanan ?? 0) > 0
                                ? 'var(--q-menang)'
                                : 'var(--q-jebakan)',
                          }}
                        >
                          {banding.hasil.laba_kotor_bulanan === null
                            ? '—'
                            : rupiah(Math.abs(Math.round(banding.hasil.laba_kotor_bulanan)))}
                        </span>
                      </div>
                      {laba !== null && banding.hasil.laba_kotor_bulanan !== null && (
                        <p className="mt-1 text-[12px] leading-snug text-ink-2">
                          {laba >= banding.hasil.laba_kotor_bulanan
                            ? 'Lokasi yang Anda buka lebih baik.'
                            : 'Pembandingnya lebih baik untuk skenario ini.'}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  {/* PANGSA IMPAS - angka paling layak dipercaya di lembar ini,
                      karena ia tidak memuat satu pun tebakan pangsa: cuma harga
                      sewa dibagi uang yang benar-benar terukur. */}
                  {impas !== null && (
                    <div
                      className="rounded-xl border p-4"
                      style={{
                        borderColor:
                          impas > 25
                            ? 'color-mix(in srgb, var(--q-hindari) 45%, transparent)'
                            : 'var(--color-line)',
                        background:
                          impas > 25
                            ? 'color-mix(in srgb, var(--q-hindari-lembut) 55%, transparent)'
                            : 'var(--color-surface-2)',
                      }}
                    >
                      <p className="text-[12px] font-medium text-ink-2">
                        Supaya sewanya tertutup, Anda harus menangkap
                      </p>
                      <p className="papan tabular mt-1 text-[34px] leading-none">
                        {angka(impas, 1)}%
                      </p>
                      <p className="mt-1 text-[12px] leading-snug text-ink-2">
                        dari seluruh uang belanja yang berputar di sini.{' '}
                        {impas > 25
                          ? 'Itu porsi yang sangat besar untuk pendatang baru.'
                          : `Perkiraan Anda sekarang ${angka(pangsa, 1)}%.`}
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-line p-3.5">
                      <p className="eyebrow text-[9.5px]">Omzet tiap hari</p>
                      <p className="papan tabular mt-1 text-[19px] leading-none">
                        {hasil.hasil.omzet_harian === null
                          ? '—'
                          : rupiah(Math.round(hasil.hasil.omzet_harian))}
                      </p>
                    </div>
                    <div className="rounded-lg border border-line p-3.5">
                      <p className="eyebrow text-[9.5px]">Pembeli / hari agar impas</p>
                      <p className="papan tabular mt-1 text-[19px] leading-none">
                        {hasil.hasil.pembeli_impas_per_hari === null
                          ? '—'
                          : Math.ceil(hasil.hasil.pembeli_impas_per_hari)}
                      </p>
                      <p className="mt-1 text-[10.5px] leading-snug text-ink-3">
                        {hasil.sumber.harga_rata_rata === 'pengguna'
                          ? `dari harga rata-rata ${rupiah(hasil.masukan.harga_rata_rata)} yang Anda isi`
                          : hasil.sumber.harga_rata_rata === 'data'
                            ? `dari belanja rata-rata ${rupiah(hasil.terukur.nominal_median_struk)} di lokasi ini`
                            : 'isi harga rata-rata per pembeli untuk menghitungnya'}
                      </p>
                    </div>
                  </div>

                  {hasil.hasil.sewa_per_m2_tersirat !== null && (
                    <p className="rounded-lg bg-surface-2 px-3.5 py-2.5 text-[12px] leading-snug text-ink-2">
                      Sewa yang Anda isi setara{' '}
                      <strong className="font-semibold text-ink">
                        {rupiah(Math.round(hasil.hasil.sewa_per_m2_tersirat))}/m²
                      </strong>
                      {hasil.terukur.harga_sewa_per_m2 !== null ? (
                        <>
                          {' '}— sewa terukur di heksagon ini{' '}
                          {rupiah(Math.round(hasil.terukur.harga_sewa_per_m2))}/m².
                        </>
                      ) : (
                        <> — belum ada sewa terukur di heksagon ini untuk dibandingkan.</>
                      )}
                    </p>
                  )}

                  {hasil.hasil.sewa_tahun_pertama !== null && (
                    <p className="rounded-lg bg-surface-2 px-3.5 py-2.5 text-[12px] leading-snug text-ink-2">
                      Sewa tahun pertama{' '}
                      <strong className="font-semibold text-ink">
                        {rupiah(hasil.hasil.sewa_tahun_pertama)}
                      </strong>{' '}
                      — ruko lazim ditagih setahun di muka.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* ================= 2. Kepekaan ================================ */}
            <div className="min-w-full shrink-0 snap-center overflow-y-auto px-5 py-4">
              <div className="mx-auto max-w-[46rem]">
                <p className="text-[14.5px] font-semibold text-ink">
                  Kalau Anda dapat lebih ramai — atau lebih sepi
                </p>
                <p className="mt-1 text-[12.5px] leading-snug text-ink-2">
                  Rumus yang sama, hanya perkiraan ramainya yang diganti. Bandingkan
                  dengan perasaan Anda sendiri soal berapa yang realistis.
                </p>
                <div className="mt-4 space-y-2.5">
                  {hasil.sensitivitas.map((t) => {
                    const positif = (t.laba_kotor_bulanan ?? 0) > 0
                    const kini = Math.abs(t.pangsa_persen - pangsa) < 0.05
                    const puncak = Math.max(
                      ...hasil.sensitivitas.map((x) => Math.abs(x.laba_kotor_bulanan ?? 0)),
                      1,
                    )
                    const lebar = ((Math.abs(t.laba_kotor_bulanan ?? 0) / puncak) * 50).toFixed(1)
                    return (
                      <div
                        key={t.pangsa_persen}
                        className={`rounded-lg px-3.5 py-2.5 ${kini ? 'bg-surface-2' : ''}`}
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="tabular text-[13px] text-ink-2">
                            Menangkap{' '}
                            <strong className="font-semibold text-ink">
                              {angka(t.pangsa_persen, 1)}%
                            </strong>
                            {kini && <span className="ml-1.5 text-[11px] text-ink-3">perkiraan Anda</span>}
                          </span>
                          <span
                            className="tabular text-[14px] font-semibold"
                            style={{ color: positif ? 'var(--q-menang)' : 'var(--q-jebakan)' }}
                          >
                            {t.laba_kotor_bulanan === null
                              ? '—'
                              : `${positif ? 'sisa ' : 'kurang '}${rupiah(Math.abs(t.laba_kotor_bulanan))}`}
                          </span>
                        </div>
                        {/* Batang dua arah dari tengah: rugi ke kiri, untung ke
                            kanan. Tanda plus-minus mudah terlewat; arah tidak. */}
                        <div className="relative mt-1.5 h-2 rounded-full bg-ground-2" aria-hidden>
                          <span className="absolute inset-y-0 left-1/2 w-px bg-line-2" />
                          <span
                            className="absolute inset-y-0 rounded-full transition-[width] duration-500 ease-liquid"
                            style={{
                              width: `${lebar}%`,
                              [positif ? 'left' : 'right']: '50%',
                              background: positif ? 'var(--q-menang)' : 'var(--q-jebakan)',
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* ================= 3. Jam ===================================== */}
            <div className="min-w-full shrink-0 snap-center overflow-y-auto px-5 py-4">
              <div className="mx-auto max-w-[46rem]">
                <p className="text-[14.5px] font-semibold text-ink">Kapan uangnya berpindah</p>
                <p className="mt-1 text-[12.5px] leading-snug text-ink-2">
                  Dibaca dari jam yang tercetak di struk — kapan orang benar-benar
                  membayar, bukan kapan tokonya buka.
                </p>
                <div className="mt-4">
                  <GrafikJam profil={hasil.profil_jam} teramai={hasil.jam_teramai} />
                </div>
                {L?.rasio_weekend !== null && L?.rasio_weekend !== undefined && (
                  <div className="mt-5 max-w-[22rem]">
                    <Fakta
                      label="Akhir pekan vs hari kerja"
                      nilai={L.rasio_weekend}
                      satuan="x"
                      bagian={L.rasio_weekend / 2}
                      bantuan="1,0 berarti akhir pekan sama ramai dengan hari kerja. Di atas 1 berarti lebih bergantung pada Sabtu-Minggu."
                    />
                  </div>
                )}
              </div>
            </div>

            {/* ================= 4. Sekitar sini ============================ */}
            <div className="min-w-full shrink-0 snap-center overflow-y-auto px-5 py-4">
              <div className="mx-auto max-w-[52rem]">
                <p className="text-[14.5px] font-semibold text-ink">Keadaan di sekitar lokasi</p>
                <p className="mt-1 text-[12.5px] leading-snug text-ink-2">
                  Seluruhnya terukur. Yang belum ada datanya ditulis apa adanya — tidak
                  ditebak.
                </p>
                <div className="mt-4 grid gap-x-8 gap-y-3.5 sm:grid-cols-2 lg:grid-cols-3">
                  <Fakta label="Penduduk di sekitar" nilai={L?.populasi_100m} satuan="jiwa" bagian={null} />
                  <Fakta label="Penduduk usia kerja" nilai={L?.populasi_usia_produktif} satuan="jiwa" bagian={null} />
                  <Fakta label="Jalan kaki ke stasiun" nilai={L?.waktu_jalan_menit} satuan="menit" bagian={null} />
                  <Fakta label="Pesaing sejenis" nilai={L?.n_kompetitor_langsung} satuan="tempat" bagian={null} bagus={false} />
                  <Fakta label="Warung makan menetap" nilai={L?.n_menetap_kuliner} satuan="tempat" bagian={null} />
                  <Fakta label="Total tempat usaha" nilai={L?.kepadatan_poi_total} satuan="tempat" bagian={null} />
                  <Fakta label="Penumpang stasiun / hari" nilai={L?.ridership_proksi} satuan="orang" bagian={null} />
                  <Fakta label="Banyaknya kantor" nilai={L?.kepadatan_kantor} bagian={null} />
                  <Fakta label="Banyaknya kos" nilai={L?.kepadatan_kos} bagian={null} />
                </div>

                {hasil.peringatan.length > 0 && (
                  <ul className="mt-5 space-y-2">
                    {hasil.peringatan.map((p) => (
                      <li
                        key={p.kode}
                        className="flex gap-2 rounded-lg border border-line bg-surface-2/60 px-3.5 py-2.5 text-[12.5px] leading-snug text-ink-2"
                      >
                        <span
                          aria-hidden
                          className={`mt-[3px] h-2.5 w-2.5 shrink-0 rounded-[3px] ${
                            p.tingkat === 'BAHAYA'
                              ? 'bg-bahaya'
                              : p.tingkat === 'WASPADA'
                                ? 'bg-jebakan'
                                : 'bg-line-2'
                          }`}
                        />
                        {p.pesan}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* --- Asumsi: selalu terlihat, di kaki lembar --------------------
              Bukan di dalam salah satu slide. Setiap angka di keempat slide
              bergantung pada keempat penggeser ini, jadi menyembunyikannya di
              slide tertentu berarti orang harus menggeser bolak-balik untuk
              melihat akibat dari yang baru saja ia ubah. */}
          <div className="shrink-0 border-t border-line/70 bg-surface-2/50 px-5 py-3">
            <div className="mx-auto flex max-w-[60rem] flex-wrap items-end gap-x-6 gap-y-3">
              <div className="shrink-0">
                <p className="eyebrow text-[9.5px]">Rencana Anda</p>
                <button
                  onClick={() => setJenis(null)}
                  className="mt-0.5 cursor-pointer text-[13px] font-semibold text-ink underline decoration-line-2 underline-offset-2 hover:decoration-ink"
                >
                  {hasil.masukan.label_usaha}
                </button>
              </div>
              <div className="min-w-[9rem] flex-1">
                <IsianRupiah
                  label="Sewa per bulan"
                  nilai={sewaDiisi}
                  bantuan="Angka dari pemiliknya, bukan dari peta"
                  onUbah={setSewaDiisi}
                />
              </div>
              <div className="min-w-[9rem] flex-1">
                <IsianRupiah
                  label="Harga rata-rata"
                  nilai={hargaDiisi}
                  bantuan="Rencana harga jual Anda sendiri"
                  onUbah={setHargaDiisi}
                />
              </div>
              <div className="min-w-[7rem] flex-1">
                <Penggeser label="Jam buka" nilai={jam} min={4} maks={24} satuan="jam" onUbah={setJam} />
              </div>
              <div className="min-w-[8rem] flex-1">
                <Penggeser label="Luas tempat" nilai={luas} min={4} maks={120} satuan="m2" onUbah={setLuas} />
              </div>
              <div className="min-w-[8rem] flex-1">
                <Penggeser
                  label="Perkiraan ramai"
                  nilai={pangsa}
                  min={1}
                  maks={40}
                  satuan="%"
                  onUbah={setPangsa}
                />
              </div>
              <div className="min-w-[8rem] flex-1">
                <Penggeser
                  label="Untung per penjualan"
                  nilai={margin}
                  min={5}
                  maks={80}
                  satuan="%"
                  onUbah={setMargin}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
