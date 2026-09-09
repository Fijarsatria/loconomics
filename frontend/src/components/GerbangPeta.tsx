/**
 * Bento "Enam keputusan" untuk halaman gerbang.
 *
 * DUA ELEMEN TEKS PER KARTU, dan itu batas keras. Versi pertama bento ini
 * memuat ENAM - eyebrow, judul, kalimat, angka besar, batang kuadran, dan baris
 * kaki - lalu dibandingkan berdampingan dengan susunan yang ditirunya. Bedanya
 * bukan warna maupun jarak: kartu yang ramai berhenti jadi kartu dan berubah
 * jadi tabel kecil, dan mata tidak tahu harus mendarat di mana.
 *
 * BARIS KAKI DICABUT 10 Sep 2026 ("Tanah Abang · 55 opportunity score median").
 * Ia elemen ketiga yang dibaca paling akhir dan paling jarang, ia mengulang
 * nama kawasan yang sudah terlihat di petanya sendiri, dan angkanya datang dari
 * manifes potret yang bisa basi tanpa ada yang tahu. Yang tersisa: nama alat,
 * judul, satu kalimat.
 *
 * TIGA BENTUK, bukan satu yang diulang enam kali. Deretan kartu seukuran
 * terbaca sebagai daftar; deretan yang bentuknya berbeda-beda terbaca sebagai
 * susunan yang dirancang. Bentuknya mengikuti berapa banyak LEBAR yang
 * dipunyai kartunya:
 *
 *   belah   teks di kiri, peta di kanan      - kartu selebar setengah baris
 *   atas    teks di atas, peta mengisi bawah - kolom sempit yang tinggi
 *   bawah   peta di atas, teks di bawah      - kebalikannya, supaya tak seragam
 *   banding DUA peta berdampingan            - kartu komparasi, dan hanya itu
 *
 * Semuanya `<img>`, dan halaman ini tidak memuat MapLibre sama sekali - satu
 * asersi audit menjaganya.
 *
 * KENAPA GAMBARNYA COCOK DENGAN KALIMATNYA. Tiap kartu dipasangkan menurut
 * LAYER yang benar-benar tergambar di berkasnya: kartu "menakar sewa" memakai
 * potret layer PriceLens, kartu "memastikan boleh" memakai potret ZoneGuard.
 */

import { useEffect, useRef } from 'react'

import { LAYER, type NamaLayer } from '../config'
import { KARTU_GERBANG, type KartuGerbang } from '../lib/kartu-gerbang'
import { useTeks, type Bahasa } from '../lib/bahasa'

export interface PilihanKawasan {
  kawasan: string
  layer: NamaLayer
}

/** Wajib ada walaupun petanya sudah jadi gambar diam. */
const ATRIBUSI = '© MAPID Maps · OpenMapTiles · OpenStreetMap'

type Bentuk = 'belah' | 'atas' | 'bawah' | 'banding'

interface Keputusan {
  /** Nama alat di dalam produk. */
  alat: string
  bentuk: Bentuk
  /**
   * Kelas kolom untuk lg ke atas, ditulis APA ADANYA.
   *
   * Bukan dirakit lewat template string: Tailwind memindai kelas sebagai TEKS
   * di dalam berkas sumber, dan kelas yang baru terbentuk saat program berjalan
   * tidak pernah ikut ke berkas CSS. Gagalnya diam - kelasnya ada di DOM,
   * aturannya tidak ada di mana pun.
   */
  rentang: string
}

/** Bentuk dan rentang kolom, dikunci ke nama berkas. Tidak ikut bahasa. */
const BENTUK: Record<string, Keputusan> = {
  'tanah-abang': { alat: 'Opportunity Score', bentuk: 'belah', rentang: 'lg:col-span-3' },
  manggarai: { alat: 'PriceLens', bentuk: 'belah', rentang: 'lg:col-span-3' },
  'dukuh-atas': { alat: 'GemFinder', bentuk: 'atas', rentang: 'lg:col-span-2' },
  'depok-baru': { alat: 'ZoneGuard', bentuk: 'bawah', rentang: 'lg:col-span-2' },
  bekasi: { alat: 'RiskRadar', bentuk: 'bawah', rentang: 'lg:col-span-2' },
  harjamukti: { alat: 'Komparasi', bentuk: 'banding', rentang: 'lg:col-span-6' },
}

/** Kalimat tiap kartu, dua bahasa, dikunci ke nama berkas yang sama. */
const KALIMAT: Record<Bahasa, Record<string, { judul: string; isi: string }>> = {
  id: {
    'tanah-abang': {
      judul: 'Memilih lokasi',
      isi: 'Skor peluang 0–100 untuk tiap heksagon, dari empat indeks yang bobotnya tertulis.',
    },
    manggarai: {
      judul: 'Menakar sewa',
      isi: 'Kuartil harga sewa di kawasan yang sedang dilihat, sebagai pembanding sebelum menandatangani.',
    },
    'dukuh-atas': {
      judul: 'Menemukan yang terlewat',
      isi: 'Heksagon yang datanya bagus tetapi tampilannya biasa saja.',
    },
    'depok-baru': {
      judul: 'Memastikan boleh',
      isi: 'Zona yang melarang usaha tidak pernah muncul sebagai rekomendasi.',
    },
    bekasi: {
      judul: 'Menghindari yang menjebak',
      isi: 'Terlihat mahal, terasa ramai, ekonominya tidak mendukung.',
    },
    harjamukti: {
      judul: 'Membandingkan berdampingan',
      isi: 'Dua kawasan, satu ukuran yang sama — sampai empat lokasi sekaligus dalam satu tabel.',
    },
  },
  en: {
    'tanah-abang': {
      judul: 'Choosing a location',
      isi: 'A 0–100 opportunity score for every hexagon, from four indices with published weights.',
    },
    manggarai: {
      judul: 'Sizing up the rent',
      isi: 'Rent quartiles for the area in view, as a benchmark before you sign.',
    },
    'dukuh-atas': {
      judul: 'Finding what was missed',
      isi: 'Hexagons with strong data and an ordinary face.',
    },
    'depok-baru': {
      judul: 'Making sure it’s allowed',
      isi: 'Zones that prohibit business never appear as a recommendation.',
    },
    bekasi: {
      judul: 'Avoiding the traps',
      isi: 'Looks expensive, feels busy, and the economics don’t hold up.',
    },
    harjamukti: {
      judul: 'Comparing side by side',
      isi: 'Two areas, one common yardstick — up to four locations at once in a single table.',
    },
  },
}

/** Label kecil yang ikut bahasa. */
const LABEL: Record<Bahasa, { buka: (k: string, l: string) => string; peta: (l: string, k: string) => string }> = {
  id: { buka: (k, l) => `Buka ${k} dengan layer ${l}`, peta: (l, k) => `Peta ${l} di ${k}` },
  en: { buka: (k, l) => `Open ${k} with the ${l} layer`, peta: (l, k) => `${l} map of ${k}` },
}

/* ==========================================================================
   Gelombang heksagon di atas potret peta
   ==========================================================================

   MENGGANTIKAN lima animasi SVG yang berdiri di sini sebelumnya - sapuan skor,
   batang kuartil, denyut hidden gem, zona yang ditolak, sapuan radar. Kelimanya
   digambar sendiri dan tidak satu pun benar-benar terjadi di peta; dilaporkan
   apa adanya sebagai "efek animasi layer yang ga jelas".

   Yang bergerak sekarang hal yang MEMANG dilakukan aplikasinya, dan cuma satu:
   layer heksagon MEKAR dari pusat kawasan, bertahan, lalu SURUT ke tepi - resep
   yang sama persis dengan `jalankanGelombang` di `PetaInteraktif.tsx`, sampai ke
   arah dan urutannya. Petanya sendiri tidak pernah ikut hilang: yang datang dan
   pergi cuma lapisan heksagonnya, seperti menyalakan dan mematikan layer.

   Undakannya dihitung dari JARAK KE PUSAT, bukan dari nomor urut - itu yang
   membuatnya terbaca sebagai gelombang melingkar alih-alih sebagai daftar yang
   menyala satu per satu. Sama dengan `bubuhiUrutan` di peta sungguhan.

   HANYA `transform` dan `opacity`, dan seluruhnya keyframe CSS: nol pekerjaan
   JavaScript per bingkai, dan berhenti sendiri saat kartunya di luar layar
   lewat `[data-tampil]` yang dipasang pengamat di bawah.
   ========================================================================== */

/** Kotak gambar gelombang. Dipotong `slice`, jadi ia menutupi bentuk apa pun. */
const W_ALUN = 120
const H_ALUN = 90
const R_ALUN = 14

/**
 * Warna tiap layer, TIGA rona per layer.
 *
 * Tiga, bukan satu: layer tematik yang sungguhan tidak pernah satu warna rata -
 * ia skala, dan skala itulah yang membuatnya terbaca sebagai data alih-alih
 * sebagai selubung berwarna. Ronanya sengaja diambil dari ujung-ujung skala
 * yang dipakai `lib/layer-peta.ts`, bukan dikarang baru.
 */
const RONA_LAYER: Record<NamaLayer, [string, string, string]> = {
  opportunity: ['#2de8c0', '#1f9f86', '#4c93f7'],
  pricelens: ['#5bf3d3', '#2de8c0', '#17be9b'],
  hidden_gem: ['#4c93f7', '#7cf7dd', '#2de8c0'],
  zoneguard: ['#29a35a', '#2de8c0', '#b01b1b'],
  risk_radar: ['#e58a00', '#d4443f', '#7c5cff'],
}

/** Sel gelombang: posisi, jarak ternormalkan dari pusat, dan ronanya. */
const SEL_ALUN = (() => {
  const sel: { x: number; y: number; d: number; i: number }[] = []
  const dx = R_ALUN * Math.sqrt(3)
  const dy = R_ALUN * 1.5
  const cx = W_ALUN / 2
  const cy = H_ALUN / 2
  let i = 0
  for (let baris = -1; baris <= H_ALUN / dy + 1; baris++) {
    for (let kolom = -1; kolom <= W_ALUN / dx + 1; kolom++) {
      const x = kolom * dx + (baris % 2 ? dx / 2 : 0)
      const y = baris * dy
      sel.push({ x, y, d: Math.hypot(x - cx, y - cy), i: i++ })
    }
  }
  const maks = Math.max(...sel.map((s) => s.d)) || 1
  return sel.map((s) => ({ ...s, d: s.d / maks }))
})()

/** Satu heksagon kecil berjari-jari r di (x, y). */
function heksMini(r: number, x: number, y: number) {
  return Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 180) * (60 * k - 30)
    return `${(x + r * Math.cos(a)).toFixed(2)},${(y + r * Math.sin(a)).toFixed(2)}`
  }).join(' ')
}

/**
 * Lapisan heksagon yang mekar lalu surut, di atas potret.
 *
 * `jeda` menggeser seluruh siklusnya - dipakai kartu komparasi supaya kedua
 * petanya tidak mekar berbarengan, yang justru menghapus kesan "yang satu, lalu
 * yang lain" yang jadi seluruh gunanya kartu itu.
 */
function GelombangHeks({ layer, jeda = 0 }: { layer: NamaLayer; jeda?: number }) {
  const rona = RONA_LAYER[layer]
  return (
    <svg
      viewBox={`0 0 ${W_ALUN} ${H_ALUN}`}
      preserveAspectRatio="xMidYMid slice"
      className="g-alun pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    >
      {SEL_ALUN.map((s) => (
        <polygon
          key={s.i}
          className="g-alun-sel"
          points={heksMini(R_ALUN - 0.9, s.x, s.y)}
          style={{
            fill: rona[s.i % 3],
            transformOrigin: `${s.x.toFixed(2)}px ${s.y.toFixed(2)}px`,
            // Yang di pusat berangkat lebih dulu; yang di tepi menyusul.
            // 1,45 dtk dari pusat ke tepi - cukup lambat untuk terbaca sebagai
            // gelombang, cukup cepat untuk selesai sebelum mata berpindah.
            animationDelay: `${(jeda + s.d * 1.45).toFixed(2)}s`,
          }}
        />
      ))}
    </svg>
  )
}

/** Potret layer + gelombangnya + atribusi. */
function Potret({ d, jeda = 0 }: { d: KartuGerbang; jeda?: number }) {
  const label = useTeks(LABEL)
  return (
    <>
      <img
        src={`/kartu/${d.berkas}.webp`}
        alt={label.peta(LAYER[d.layer].nama, d.kawasan)}
        /* Ukuran intrinsik ditulis supaya peramban menyediakan ruangnya sebelum
           berkasnya sampai — tanpa ini tata letak melompat saat tiap gambar
           selesai dimuat, dan lompatan itu menggeser seluruh pengukuran
           ScrollTrigger di bawahnya. */
        width={d.lebar}
        height={d.tinggi}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="g-bento-gambar absolute inset-0 h-full w-full object-cover"
      />
      <GelombangHeks layer={d.layer} jeda={jeda} />
      {/* Atribusi ditulis sendiri: kontrol MapLibre tidak ikut terpotret, dan
          ketentuan A.3 tidak gugur cuma karena gambarnya statis. */}
      <span className="pointer-events-none absolute bottom-1.5 right-2.5 max-w-[70%] truncate text-[8.5px] text-white/40">
        {ATRIBUSI}
      </span>
    </>
  )
}

/** Nama alat, judul, satu kalimat. Tidak ada elemen keempat. */
function Teks({ d, k }: { d: KartuGerbang; k: Keputusan }) {
  const kal = useTeks(KALIMAT)[d.berkas]
  return (
    <>
      <p className="eyebrow mb-2 text-[color:var(--g-ink-4)]">{k.alat}</p>
      <h3 className="papan flex items-center gap-2 text-[clamp(1.05rem,1.7vw,1.3rem)] leading-snug text-[color:var(--g-ink)]">
        {kal.judul}
        {/* Panahnya menempel di JUDUL sejak baris kaki dicabut. Kartu yang bisa
            diklik harus menyatakannya di suatu tempat, dan tempat yang tersisa
            cuma di sini. */}
        <span
          className="shrink-0 text-[color:var(--g-ink-4)] transition-transform duration-300 ease-jelly group-hover:translate-x-1 group-hover:text-[color:var(--g-teal)]"
          aria-hidden
        >
          →
        </span>
      </h3>
      <p className="mt-2.5 max-w-[36ch] text-[14px] leading-relaxed text-[color:var(--g-ink-2)]">{kal.isi}</p>
    </>
  )
}

function KartuKeputusan({
  d,
  k,
  pembanding,
  onBuka,
}: {
  d: KartuGerbang
  k: Keputusan
  /** Potret KEDUA, hanya untuk kartu komparasi. */
  pembanding?: KartuGerbang
  onBuka: (p: PilihanKawasan) => void
}) {
  const label = useTeks(LABEL)
  // Arah scrim mengikuti sisi tempat gambar bertemu teks — dan itu berbeda di
  // tiap bentuk. Scrim yang arahnya salah menggelapkan sisi yang tidak
  // bersentuhan dengan apa pun, dan itu terbaca sebagai noda.
  const arahScrim =
    k.bentuk === 'atas'
      ? 'g-bento-media-atas'
      : k.bentuk === 'bawah'
        ? 'g-bento-media-bawah'
        : 'g-bento-media-samping'

  const media = (
    <div className={`g-bento-media ${arahScrim} relative min-h-[150px] flex-1 self-stretch overflow-hidden`}>
      <Potret d={d} />
    </div>
  )

  /**
   * Kartu komparasi memperlihatkan DUA peta, dipisah satu garis rambut.
   *
   * Sebelumnya ia satu potret seperti kelima kartu lain - kartu yang berbicara
   * tentang membandingkan dua tempat sambil menunjukkan satu tempat. Sekarang
   * bentuknya sendiri yang mengatakannya, dan gelombang heksagonnya digeser
   * setengah siklus supaya yang kiri mekar lebih dulu.
   */
  const mediaBanding = pembanding && (
    <div className="relative flex min-h-[150px] flex-1 self-stretch overflow-hidden">
      <div className="g-bento-media g-bento-media-samping relative min-w-0 flex-1 overflow-hidden">
        <Potret d={d} />
      </div>
      <span className="w-px shrink-0 bg-[color:var(--g-kartu-tepi)]" aria-hidden />
      <div className="g-bento-media g-bento-media-samping relative min-w-0 flex-1 overflow-hidden">
        <Potret d={pembanding} jeda={2.1} />
      </div>
    </div>
  )

  const teks = (
    <div className="flex shrink-0 flex-col justify-center p-6 sm:p-7">
      <Teks d={d} k={k} />
    </div>
  )

  return (
    <button
      onClick={() => onBuka({ kawasan: d.kawasan, layer: d.layer })}
      aria-label={label.buka(d.kawasan, LAYER[d.layer].nama)}
      className={`g-bento group relative flex cursor-pointer items-stretch overflow-hidden rounded-[16px] text-left ${k.rentang} ${
        k.bentuk === 'belah' || k.bentuk === 'banding'
          ? 'flex-col sm:min-h-[212px] sm:flex-row'
          : 'min-h-[392px] flex-col'
      }`}
    >
      {k.bentuk === 'belah' || k.bentuk === 'banding' ? (
        <>
          <div
            className={`flex flex-col justify-center p-6 sm:p-7 ${
              k.bentuk === 'banding' ? 'sm:basis-[38%]' : 'sm:basis-[52%]'
            }`}
          >
            <Teks d={d} k={k} />
          </div>
          {k.bentuk === 'banding' ? mediaBanding : media}
        </>
      ) : k.bentuk === 'atas' ? (
        <>
          {teks}
          {media}
        </>
      ) : (
        <>
          {media}
          {teks}
        </>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Bento
// ---------------------------------------------------------------------------

export default function BentoKeputusan({ onBuka }: { onBuka: (p: PilihanKawasan) => void }) {
  const grid = useRef<HTMLDivElement>(null)

  /**
   * Gelombang HANYA berjalan selagi kartunya terlihat.
   *
   * Enam animasi tak berujung yang terus memutar dirinya walaupun jauh di luar
   * layar adalah persis yang membuat halaman ini dulu berat. Di sini
   * `animation-play-state` dibalik lewat satu atribut, dan satu pengamat
   * mengurus keenamnya.
   */
  useEffect(() => {
    const n = grid.current
    if (!n) return
    const kartu = Array.from(n.querySelectorAll<HTMLElement>('.g-bento'))
    // Tanpa IntersectionObserver (peramban sangat lama), semuanya dibiarkan
    // menyala: lebih baik boros daripada halaman yang diam sama sekali.
    if (typeof IntersectionObserver === 'undefined') {
      kartu.forEach((k) => k.setAttribute('data-tampil', '1'))
      return
    }
    const pengamat = new IntersectionObserver(
      (masuk) => {
        for (const m of masuk) {
          ;(m.target as HTMLElement).setAttribute('data-tampil', m.isIntersecting ? '1' : '0')
        }
      },
      { rootMargin: '120px' },
    )
    kartu.forEach((k) => pengamat.observe(k))
    return () => pengamat.disconnect()
  }, [])

  /** Pembanding kartu komparasi: potret kedua yang BUKAN dirinya sendiri. */
  const pembanding = KARTU_GERBANG.find((k) => k.berkas === 'dukuh-atas') ?? KARTU_GERBANG[0]

  return (
    // ENAM kolom, bukan tiga: kartu selebar setengah baris butuh 3, kolom
    // sempit butuh 2, dan kartu penutup butuh 6. Tiga kolom memaksa ketiganya
    // jadi ukuran yang sama - dan kartu seukuran itu persis yang membuat versi
    // sebelumnya terbaca sebagai daftar, bukan sebagai susunan.
    <div ref={grid} className="g-bento-grid mx-auto grid w-full max-w-[76rem] gap-4 sm:grid-cols-2 lg:grid-cols-6">
      {KARTU_GERBANG.map((d) => {
        const k = BENTUK[d.berkas]
        if (!k) return null
        return (
          <KartuKeputusan
            key={d.berkas}
            d={d}
            k={k}
            pembanding={k.bentuk === 'banding' ? pembanding : undefined}
            onBuka={onBuka}
          />
        )
      })}
    </div>
  )
}
