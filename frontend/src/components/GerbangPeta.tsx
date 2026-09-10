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
 *
 * YANG BERGERAK DI ATASNYA adalah heksagon SUNGGUHAN kartu itu (11 Sep 2026).
 *
 * Sebelumnya di sini berdiri kisi heksagon karangan yang menutupi seluruh kotak
 * gambar: ia tidak berdiri di tempat mana pun, tidak membawa satu angka pun,
 * dan tidak menjawab pertanyaan kartunya. Dilaporkan apa adanya - "animasi
 * layer heksagon yang jelek dan ga nyambung sama masing masing konteks". Kisi
 * itu memang tidak nyambung; ia tidak bisa nyambung, karena tidak pernah ada
 * hubungannya dengan peta di belakangnya.
 *
 * Yang menggantikannya datang dari `KARTU_GERBANG[i].sorot`, dihitung
 * `scripts/potret-kartu.mjs --sorot` dengan KAMERA YANG SAMA dengan WebP-nya -
 * jadi tiap heksagon berdiri persis di atas dirinya sendiri di dalam gambar.
 * Warnanya pun dibaca kembali dari peta yang digambar MapLibre, bukan ditebak.
 *
 * Dan yang DISOROT menjawab pertanyaan kartunya: skor tertinggi untuk "memilih
 * lokasi", sewa termurah untuk "menakar sewa", zona terlarang untuk "memastikan
 * boleh" - yang lalu PERGI, persis yang dijanjikan kalimatnya.
 */

import { useEffect, useMemo, useRef } from 'react'

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
   Lapisan heksagon di atas potret peta
   ==========================================================================

   TIGA hal yang membuatnya "beneran dari mapsnya", dan ketiganya bisa
   diperiksa:

   1. POSISINYA. `sorot.sel` berisi pusat tiap heksagon dalam piksel kotak
      gambar, dihitung dengan `fitBounds` yang sama persis dengan yang dipakai
      menggambar WebP-nya. Diuji: kamera aritmetika di skrip dan `map.project`
      MapLibre berselisih 0,0000 piksel.

   2. BENTUKNYA. `sorot.bentuk` simpangan enam simpul dari pusat sel, dirata-
      ratakan atas seluruh sel kartu itu. Simpangan antar sel terukur 0,01
      piksel - satu kawasan cuma membentang dua kilometer.

   3. WARNANYA. Dibaca kembali dari kanvas MapLibre yang menggambar heksagon
      memakai `WARNA_LAYER` milik aplikasi. Tidak ada tabel warna kedua di
      berkas ini yang bisa berpisah diam-diam dari peta.

   Geraknya mengutip `jalankanGelombang` di peta: kisi MEKAR dari pusat kawasan,
   heksagon yang menjawab menyusul satu per satu, semuanya bertahan, lalu SURUT.
   Undakannya dihitung dari JARAK KE PUSAT untuk kisi dan dari PERINGKAT untuk
   jawabannya - yang pertama membuatnya terbaca sebagai gelombang melingkar,
   yang kedua membuatnya terbaca sebagai daftar yang sedang dibacakan.

   HANYA `transform` dan `opacity`, seluruhnya keyframe CSS: nol pekerjaan
   JavaScript per bingkai, dan berhenti sendiri di luar layar lewat
   `[data-tampil]` yang dipasang pengamat di bawah.
   ========================================================================== */

/** Berapa cincin jarak dipakai mengundak kisi. Tujuh sudah terbaca sebagai gelombang. */
/**
 * Perbesaran kedua peta di kartu komparasi.
 *
 * Kamera potretnya membingkai SELURUH heksagon satu kawasan, dan pada kartu
 * selebar 300 px itu membuat rute jalan kakinya - yang justru jadi alasan
 * kartu ini ada - tinggal beberapa piksel. 1,55 cukup untuk membuat garis
 * bertitiknya terbaca sebagai jalur, dan masih di bawah ambang tempat WebP
 * 620 px mulai terlihat lunak.
 */
const PERBESAR_BANDING = 1.55

const N_CINCIN = 7

/** Poligon dari satu pusat dan simpangan enam simpulnya. */
function poligon(bentuk: number[], x: number, y: number) {
  let d = ''
  for (let i = 0; i < 6; i++) {
    d += `${i ? 'L' : 'M'}${(x + bentuk[i * 2]).toFixed(1)},${(y + bentuk[i * 2 + 1]).toFixed(1)}`
  }
  return d + 'Z'
}

/**
 * Lapisan heksagon sungguhan di atas potret.
 *
 * `jeda` menggeser seluruh siklusnya - dipakai kartu komparasi supaya kedua
 * petanya tidak menyala berbarengan, yang justru menghapus kesan "yang satu,
 * lalu yang lain" yang jadi seluruh gunanya kartu itu.
 */
function LapisanHeks({
  d,
  jeda = 0,
  rute,
}: {
  d: KartuGerbang
  jeda?: number
  /** Huruf penanda titik asal. Ada = rute jalan kakinya ikut digambar. */
  rute?: 'A' | 'B'
}) {
  const s = d.sorot

  /**
   * Kisi dipecah jadi tujuh CINCIN, bukan satu path tunggal maupun 108 simpul.
   *
   * Satu path tidak bisa diundak - dan tanpa undakan tidak ada gelombang, cuma
   * kisi yang berkedip. Seratus delapan simpul bisa diundak, tetapi itu 108
   * elemen yang dianimasikan di enam kartu sekaligus, dan halaman ini sudah
   * pernah dibuat berat oleh hal yang persis seperti itu. Tujuh path membeli
   * gelombangnya dengan tujuh elemen.
   */
  const cincin = useMemo(() => {
    const jarak: number[] = []
    let maks = 0
    for (let i = 0; i < s.sel.length; i += 2) {
      const j = Math.hypot(s.sel[i] - s.cx, s.sel[i + 1] - s.cy)
      jarak.push(j)
      if (j > maks) maks = j
    }
    const kotak: string[] = Array.from({ length: N_CINCIN }, () => '')
    for (let i = 0; i < jarak.length; i++) {
      const k = Math.min(N_CINCIN - 1, Math.floor((jarak[i] / (maks || 1)) * N_CINCIN))
      kotak[k] += poligon(s.bentuk, s.sel[i * 2], s.sel[i * 2 + 1])
    }
    return kotak
  }, [s])

  // Garis kisi harus melawan basemapnya, sama alasannya dengan `GARIS_HEX` di
  // peta: garis gelap di atas basemap gelap tidak menggambar apa pun.
  const garis = d.gelap ? 'rgba(233,244,240,0.5)' : 'rgba(16,33,28,0.42)'
  /**
   * Cincin heksagon yang menjawab. WARNANYA LAWAN BASEMAP, bukan warna isinya.
   *
   * Percobaan pertama memakai warna isian juga, dan itu gagal persis di kartu
   * yang paling membutuhkannya: ujung MURAH skala PriceLens `#e4ece9` - hampir
   * putih - digambar di atas basemap terang, dengan garis yang juga hampir
   * putih. Yang terlihat noda pucat, bukan heksagon yang dipilih. Isinya tetap
   * membawa datanya; cincinnya yang membuatnya terbaca sebagai "yang ini".
   */
  const tepiJawab = d.gelap ? 'rgba(255,255,255,0.92)' : 'rgba(12,22,18,0.78)'

  return (
    <svg
      viewBox={`0 0 ${s.w} ${s.h}`}
      preserveAspectRatio="xMidYMid slice"
      className="g-heks pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    >
      {cincin.map((jalur, i) =>
        jalur ? (
          <path
            key={i}
            className="g-heks-cincin"
            d={jalur}
            fill="none"
            stroke={garis}
            strokeWidth="0.9"
            style={{
              transformOrigin: `${s.cx}px ${s.cy}px`,
              animationDelay: `${(jeda + (i / N_CINCIN) * 0.62).toFixed(2)}s`,
            }}
          />
        ) : null,
      )}
      {s.sorot.map((h, i) => (
        <path
          key={i}
          className="g-heks-jawab"
          d={poligon(s.bentuk, h.x, h.y)}
          fill={h.c}
          stroke={tepiJawab}
          strokeWidth="1.5"
          style={{
            transformOrigin: `${h.x}px ${h.y}px`,
            animationDelay: `${(jeda + 0.5 + i * 0.085).toFixed(2)}s`,
          }}
        />
      ))}

      {/* --- Rute jalan kaki SUNGGUHAN, dari heksagon teratas ke simpulnya ---
          Ditambahkan 11 Sep 2026 untuk kartu komparasi, permintaan pemilik
          repo ("dikasih lihat juga kayak route gitu, dari titik A ke B").

          Geometrinya dari `hex_routes` - jalur OpenRouteService yang sama yang
          digambar peta, bukan garis lurus antara dua titik. Bedanya bukan
          kerapian: rute di enam kawasan ini memutar rata-rata 1,8x dari jarak
          lurusnya, dan garis lurus di kartu produk yang seluruh tesisnya
          "jaraknya tidak seperti kelihatannya" akan membantah dirinya sendiri.

          BERTITIK, dan tebalnya dua lapis - resep yang sama dengan rute jalan
          kaki di peta: bayangan gelap yang juga bertitik di bawah titik
          terangnya, supaya titiknya terbaca di atas jalan maupun di atas atap. */}
      {rute && s.rute && (
        <g className="g-heks-rute" style={{ animationDelay: `${(jeda + 1.1).toFixed(2)}s` }}>
          <path
            d={s.rute.d}
            fill="none"
            stroke="rgba(8,16,13,0.6)"
            strokeWidth="4.6"
            strokeLinecap="round"
            strokeDasharray="0 6.4"
          />
          <path
            d={s.rute.d}
            fill="none"
            stroke="#7cf7dd"
            strokeWidth="3.3"
            strokeLinecap="round"
            strokeDasharray="0 8.9"
          />
          {/* Simpul: cincin, bukan pin. Pin menandai tujuan yang dipilih; ini
              stasiun yang sudah ada di sana sebelum siapa pun memilih apa pun. */}
          <circle cx={s.rute.bx} cy={s.rute.by} r="5" fill="rgba(8,16,13,0.8)" stroke="#e8f5f1" strokeWidth="1.6" />
          <circle cx={s.rute.bx} cy={s.rute.by} r="1.7" fill="#e8f5f1" />
          {/* Titik asal, berhuruf. A di peta kiri, B di kanan - huruf yang sama
              dipakai tabel komparasi di dalam aplikasinya. */}
          <circle cx={s.rute.ax} cy={s.rute.ay} r="7.4" fill="#5bf3d3" stroke="rgba(8,16,13,0.75)" strokeWidth="1.4" />
          <text
            x={s.rute.ax}
            y={s.rute.ay + 2.9}
            textAnchor="middle"
            fontSize="8.4"
            fontWeight="700"
            fill="#08100d"
            style={{ fontFamily: 'inherit' }}
          >
            {rute}
          </text>
        </g>
      )}
    </svg>
  )
}

/** Potret layer + heksagonnya + atribusi. */
function Potret({
  d,
  jeda = 0,
  rute,
  perbesar = 1,
}: {
  d: KartuGerbang
  jeda?: number
  rute?: 'A' | 'B'
  /**
   * Perbesaran optis kartu, dipakai kartu komparasi.
   *
   * GAMBAR DAN HEKSAGONNYA DISKALA BERSAMA, dalam satu pembungkus - bukan
   * masing-masing. Keduanya menempati kotak yang sama persis (`inset-0`) dan
   * `LapisanHeks` memakai viewBox seukuran WebP-nya, jadi satu `transform` di
   * atas keduanya menjaga heksagon tetap duduk di petak yang benar. Menskala
   * salah satunya saja akan menggeser seluruh kisi terhadap petanya, dan
   * itu tidak akan pernah memunculkan galat - cuma heksagon yang meleset.
   *
   * Titik pusatnya BUKAN tengah gambar melainkan tengah RUTE-nya, kalau ada.
   * Yang diminta pemilik repo justru rutenya terlihat, dan rute berangkat dari
   * heksagon menuju stasiun - sering di tepi bingkai, tempat pembesaran dari
   * tengah justru membuangnya keluar layar.
   */
  perbesar?: number
}) {
  const label = useTeks(LABEL)
  const r = d.sorot.rute
  const pusat =
    perbesar === 1 || !r
      ? undefined
      : `${(((r.ax + r.bx) / 2) / d.sorot.w) * 100}% ${(((r.ay + r.by) / 2) / d.sorot.h) * 100}%`
  return (
    <>
      <div
        className="absolute inset-0"
        style={perbesar === 1 ? undefined : { transform: `scale(${perbesar})`, transformOrigin: pusat }}
      >
      <img
        // `BASE_URL`, BUKAN garis miring di depan. Terbitan GitHub Pages
        // disajikan di /loconomics/, jadi jalur berakar seperti `/kartu/...`
        // menunjuk ke akar domain dan pulang 404 - keenam potret hilang tanpa
        // satu pun galat JavaScript. Terukur di terbitan hidup 9 Sep 2026.
        // Gaya basemap dan GeoJSON statis sudah memakai pola ini sejak awal.
        src={`${import.meta.env.BASE_URL}kartu/${d.berkas}.webp`}
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
      <LapisanHeks d={d} jeda={jeda} rute={rute} />
      </div>
      {/* Atribusi ditulis sendiri: kontrol MapLibre tidak ikut terpotret, dan
          ketentuan A.3 tidak gugur cuma karena gambarnya statis. DI LUAR
          pembungkus berskala: atribusi yang ikut diperbesar bisa terdorong
          keluar bingkai, dan A.3 tidak mengenal alasan itu. */}
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
      <h3 className="judul-anak flex items-center gap-2 text-[clamp(1.05rem,1.7vw,1.3rem)] leading-snug text-[color:var(--g-ink)]">
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
   * bentuknya sendiri yang mengatakannya, dan lapisan heksagonnya digeser
   * setengah siklus supaya yang kiri menyala lebih dulu.
   */
  const mediaBanding = pembanding && (
    <div className="relative flex min-h-[150px] flex-1 self-stretch overflow-hidden">
      <div className="g-bento-media g-bento-media-samping relative min-w-0 flex-1 overflow-hidden">
        <Potret d={d} rute="A" perbesar={PERBESAR_BANDING} />
      </div>
      <span className="w-px shrink-0 bg-[color:var(--g-kartu-tepi)]" aria-hidden />
      <div className="g-bento-media g-bento-media-samping relative min-w-0 flex-1 overflow-hidden">
        <Potret d={pembanding} jeda={2.1} rute="B" perbesar={PERBESAR_BANDING} />
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
   * Lapisan heksagon HANYA berjalan selagi kartunya terlihat.
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

  /**
   * Pembanding kartu komparasi: potret kedua yang BUKAN dirinya sendiri.
   *
   * `manggarai`, bukan `dukuh-atas`, dan sebabnya bukan selera. Dukuh Atas
   * dipotret di atas basemap GELAP; Harjamukti di atas basemap terang. Di
   * halaman hitam keduanya menyatu, di halaman PUTIH kartu itu jadi separuh
   * peta terang bertemu separuh lubang hitam dengan sambungan tegas di
   * tengahnya - persis yang dilaporkan pemilik repo. Manggarai dipotret dengan
   * gaya `terang` yang sama, jadi keduanya terbaca sebagai dua peta yang
   * sedang dibandingkan, bukan sebagai satu kartu yang rusak.
   */
  const pembanding = KARTU_GERBANG.find((k) => k.berkas === 'manggarai') ?? KARTU_GERBANG[0]

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
