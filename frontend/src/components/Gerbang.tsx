/**
 * Gerbang — halaman pertama. Perkenalan sekaligus pintu masuk ke peta.
 *
 * ENAM BAGIAN, dan urutannya adalah ceritanya:
 *
 *   1. HERO       nama, satu kalimat, satu tombol.
 *   2. MASALAH    latar belakang DAN alasan produk ini ada, dijadikan SATU.
 *                 Sebelumnya dua blok berjudul besar yang berdiri sendiri-
 *                 sendiri ("Keramaian bisa dilihat…" lalu "Dua dunia yang belum
 *                 pernah dipertemukan…") - dua tesis untuk satu gagasan, dan
 *                 pembacanya harus menyambung sendiri. Sekarang satu judul,
 *                 lalu TIGA masalah yang dijelaskan satu per satu, masing-
 *                 masing dengan gambarnya sendiri, dan ditutup satu panel yang
 *                 mempertemukan ketiganya.
 *   3. SOLUSI     enam keputusan, enam potret peta sungguhan.
 *   4. EKOSISTEM  enam bagian produk, ZIG-ZAG satu per satu.
 *   5. PENUTUP    ajakan terakhir dan kaki halaman.
 *   6. TIM        jurang hitam, lima orang.
 *
 * TIAP BAGIAN MASUK DENGAN CARANYA SENDIRI.
 *
 *   MENUTUP   hero DIPATOK (sticky) dan bagian berikutnya menggulir NAIK
 *             MENUTUPINYA seperti lembaran. Yang di bawah menyusut dan meredup.
 *   BERGANTIAN Masalah: tiga baris, masing-masing masuk DARI SISI GAMBARNYA,
 *             dan sisinya berselang. Di antaranya JEDA - satu tali yang tumbuh
 *             mengikuti gulir, supaya hero sempat selesai menutup sebelum
 *             bagian berikutnya mulai berbicara.
 *   MENYAPU   judul Solusi terungkap dari kiri ke kanan lewat clip-path, lalu
 *             kartunya mekar dari tengah susunan ke tepinya.
 *   MERANGKAI Ekosistem: tulang punggung tumbuh mengikuti gulir, tiap simpul
 *             menyala saat dilewati, dan tiap barisnya masuk DARI SISINYA
 *             sendiri - kiri, kanan, kiri - jadi zig-zagnya ikut terasa waktu
 *             masuknya, bukan cuma terlihat di tata letaknya.
 *   TENGGELAM huruf raksasa penutup bergerak lebih lambat daripada halamannya.
 *   JURANG    bagian tim: turun ke bawah berarti turun ke dalam, sampai hitam.
 *
 * Semua gerak HANYA `transform`, `opacity`, dan `clip-path`. Tidak ada blur,
 * tidak ada bayangan yang dianimasikan - pelajaran yang sudah mahal dibayar
 * halaman ini (jebakan #116, #124).
 *
 * DUA BAHASA. Seluruh kalimat di berkas ini hidup di `K` di bawah, dalam dua
 * cabang yang bertipe sama. Kalimat yang tidak punya pasangan Inggrisnya
 * gagal di `tsc` - lihat `lib/bahasa.tsx`.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'

import { IDENTITAS, KUADRAN, PENDIRI, URUTAN_KUADRAN } from '../config'
import { MenuPengaturan, PapanNama } from './primitif'
import { TombolAkun, useSesi } from './Akun'
import BentoKeputusan, { type PilihanKawasan } from './GerbangPeta'
import { KARTU_GERBANG, potretUntukTema } from '../lib/kartu-gerbang'
import { SUMBER } from '../lib/ringkasan-data'
import { useBahasa, useNamaZona, useTeks, useTema } from '../lib/bahasa'

gsap.registerPlugin(ScrollTrigger, SplitText)

const NAMA = 'LOCONOMICS'

// ---------------------------------------------------------------------------
// Kamus
// ---------------------------------------------------------------------------

const K = {
  id: {
    masuk: 'Masuk ke peta',
    lihatSolusi: 'Lihat solusinya',
    gulir: 'gulir',
    hero: {
      isi: 'Memilih lokasi usaha di sekitar simpul transportasi Jabodetabek — dari data survei, bukan firasat.',
    },
    masalah: {
      eyebrow: 'Latar belakang',
      judul: 'Ramai belum tentu laku.',
      isi: 'Orang memilih tempat usaha dari yang bisa dilihat: mana yang ramai, mana yang kelihatan mahal. Yang sebenarnya menentukan laku atau tidak justru tidak terlihat dari trotoar.',
      antar: 'Tiga hal yang membuatnya begitu',
      poin: [
        {
          tanda: 'Datanya ada, tidak sampai',
          kepala: 'Angka orang yang lewat berhenti di tengah jalan',
          isi: 'Ratusan ribu orang melewati stasiun setiap hari, dan hampir semuanya tercatat di suatu tempat. Catatan itu tidak pernah sampai ke orang yang mau buka warung di sebelahnya.',
        },
        {
          tanda: 'Harga ikut tampilan',
          kepala: 'Sewa dipatok dari gengsi, bukan dari penjualan',
          isi: 'Tempat yang kelihatan mahal dipasang harga mahal. Padahal ramai belum tentu berbelanja — dan yang dibayar tiap bulan tetap sewanya.',
        },
        {
          tanda: 'Yang bagus tidak menonjol',
          kepala: 'Lokasi terbaik sering tidak kelihatan istimewa',
          isi: 'Ada tempat yang datanya bagus tetapi tampilannya biasa saja. Justru itu yang paling sering terlewat, karena belum ada yang menghitungnya.',
        },
      ],
      alat: {
        simpul: 'Stasiun',
        usaha: 'Calon usaha',
        putus: 'terputus di sini',
        tampilan: 'Tampilan',
        jual: 'Penjualan',
        sewa: 'Sewa',
        hitung: 'Menghitung',
        temu: 'Hidden Gem',
      },
      penutup:
        'Loconomics menghitungnya. Data orang yang lewat dan data belanja di sekitarnya dipertemukan di satu peta, lalu tiap lokasi diberi satu dari empat zona — supaya keputusannya berdiri di atas angka, bukan firasat.',
    },
    kontras: {
      judul: 'Satu kawasan, dua cara melihat',
      kiri: 'Kasat mata',
      kanan: 'Menurut data',
      simpul: 'stasiun',
      mata: 'Dari luar, yang menonjol cuma yang ramai dan kelihatan mahal.',
      data: (n: number) =>
        `Menurut data, ${n} lokasi di sini bagus tanpa terlihat mahal — dan sewanya belum ikut naik.`,
    },
    solusi: {
      eyebrow: 'Solusi',
      judul: 'Enam keputusan yang bisa diambil dengan angka',
      isi: 'Semuanya heksagon sungguhan dari basis data. Klik untuk membukanya di peta.',
      catatan:
        'Potret diam yang dibuat dari basis data lewat pipeline yang sama dengan aplikasinya — bukan tangkapan layar. Peta yang bisa digeser dan ditanyai ada di balik tombolnya.',
    },
    ekosistem: {
      eyebrow: 'Ekosistem Loconomics',
      judul: 'Enam bagian, satu peta yang berpikir',
      isi: 'Tiap bagian menjawab satu pertanyaan, dan semuanya membaca data yang sama.',
      item: [
        {
          nama: 'Loconomics AI',
          isi: 'Tanya dengan bahasa sehari-hari. Ia memanggil alatnya sendiri, membaca angkanya, lalu menggerakkan peta — dan tidak pernah menghitung sendiri.',
          tanda: 'Tanya, bukan cari',
        },
        {
          nama: 'Heksagon Layer',
          isi: 'Satu grid heksagon untuk seluruh kawasan transit. Skor, harga sewa, zonasi, dan risiko dibaca di petak yang sama persis.',
          tanda: 'Satu grid, lima layer',
        },
        {
          nama: 'Loconomics Insight',
          isi: 'Panel per lokasi: skor, zona, tingkat keyakinan, dan setiap angka yang membentuknya — sampai ke rumusnya.',
          tanda: 'Sampai ke rumusnya',
        },
        {
          nama: 'Loconomics Maps',
          isi: 'Basemap MAPID dengan layer tematik yang bisa dinyalakan, dimatikan, dan berganti — mekar dari pusat kawasan.',
          tanda: 'Empat basemap',
        },
        {
          nama: 'Loconomics Route',
          isi: 'Rute jalan kaki, mobil, dan sepeda sungguhan ke simpul terdekat, lengkap dengan kawasan jangkau 5 sampai 60 menit.',
          tanda: 'Jalan kaki · mobil · sepeda',
        },
        {
          nama: 'Loconomics Feature',
          isi: 'Membandingkan lokasi berdampingan, menyimulasikan usaha, memantau lokasi incaran, dan menerbitkan laporan PDF.',
          tanda: 'Untuk pengajuan modal',
        },
      ],
      panel: {
        tanya: 'Di mana yang paling menjanjikan?',
        jawab: 'Tiga teratas di Manggarai',
        layer: ['Opportunity Score', 'PriceLens', 'Hidden Gem', 'RiskRadar'],
        skor: 'Opportunity Score',
        zona: 'Zona',
        keyakinan: 'Keyakinan',
        sedang: 'Sedang',
        basemap: ['Terang', 'Dasar', 'Jalan', 'Gelap'],
        moda: ['Jalan kaki', 'Mobil', 'Sepeda'],
        banding: 'Bandingkan',
        barisBanding: ['Skor', 'Sewa', 'Pesaing'],
        lokasiA: 'Lokasi A',
        lokasiB: 'Lokasi B',
      },
    },
    penutup: {
      judul: 'Siap melihat petanya?',
      isi: 'Enam kawasan transit Jabodetabek, dan setiap angkanya bisa ditelusuri sampai ke sumbernya.',
      data: 'Data',
      keAtas: 'Kembali ke atas',
    },
    tim: {
      terakhir: 'Terakhir',
      turun: 'Turun lebih dalam',
      eyebrow: 'Lima orang',
      judul: 'Tim di baliknya',
      ketua: 'Ketua tim',
      angkatan: 'Angkatan',
      permukaan: 'Kembali ke permukaan',
    },
  },
  en: {
    masuk: 'Open the map',
    lihatSolusi: 'See the solutions',
    gulir: 'scroll',
    hero: {
      isi: 'Choosing a business location around Jabodetabek’s transit hubs — from survey data, not gut feeling.',
    },
    masalah: {
      eyebrow: 'Background',
      judul: 'Busy doesn’t mean profitable.',
      isi: 'People pick a shop location by what they can see: what looks busy, what looks expensive. What actually decides whether it sells cannot be seen from the pavement.',
      antar: 'Three reasons it works out that way',
      poin: [
        {
          tanda: 'The data exists, elsewhere',
          kepala: 'Footfall numbers stop halfway down the line',
          isi: 'Hundreds of thousands of people pass through a station every day, and nearly all of it is recorded somewhere. That record never reaches the person about to open a shop next door.',
        },
        {
          tanda: 'Price follows the facade',
          kepala: 'Rent is set by prestige, not by sales',
          isi: 'A place that looks expensive is priced expensive. But a crowd is not the same as customers — and the rent is due either way.',
        },
        {
          tanda: 'The good ones look ordinary',
          kepala: 'The best locations rarely look special',
          isi: 'Some places have strong data and an ordinary face. Those are the ones most often missed, precisely because nobody has counted them yet.',
        },
      ],
      alat: {
        simpul: 'Station',
        usaha: 'New shop',
        putus: 'stops here',
        tampilan: 'Looks',
        jual: 'Sales',
        sewa: 'Rent',
        hitung: 'Counting',
        temu: 'Hidden Gem',
      },
      penutup:
        'Loconomics counts them. Footfall data and the spending around it meet on one map, and every location is placed in one of four zones — so the decision rests on numbers, not instinct.',
    },
    kontras: {
      judul: 'One area, two ways of seeing',
      kiri: 'By eye',
      kanan: 'By data',
      simpul: 'station',
      mata: 'From the outside, only the busy and the expensive-looking stand out.',
      data: (n: number) =>
        `In the data, ${n} of these are strong without looking expensive — and the rent hasn’t caught up yet.`,
    },
    solusi: {
      eyebrow: 'Solutions',
      judul: 'Six decisions you can make with numbers',
      isi: 'All of them are real hexagons from the database. Click one to open it on the map.',
      catatan:
        'Still images rendered from the database by the same pipeline as the app — not screenshots. The map you can pan and ask questions of is behind the button.',
    },
    ekosistem: {
      eyebrow: 'The Loconomics ecosystem',
      judul: 'Six parts, one map that thinks',
      isi: 'Each part answers one question, and all of them read the same data.',
      item: [
        {
          nama: 'Loconomics AI',
          isi: 'Ask in plain language. It calls its own tools, reads the numbers, then moves the map — and never does the math itself.',
          tanda: 'Ask, don’t search',
        },
        {
          nama: 'Heksagon Layer',
          isi: 'One hexagon grid for every transit area. Score, rent, zoning, and risk are all read on exactly the same cell.',
          tanda: 'One grid, five layers',
        },
        {
          nama: 'Loconomics Insight',
          isi: 'A panel per location: score, zone, confidence, and every number that shaped it — right down to the formula.',
          tanda: 'Down to the formula',
        },
        {
          nama: 'Loconomics Maps',
          isi: 'MAPID basemap with thematic layers you can switch on, off, and between — blooming from the centre of the area.',
          tanda: 'Four basemaps',
        },
        {
          nama: 'Loconomics Route',
          isi: 'Real walking, driving, and cycling routes to the nearest hub, with 5-to-60-minute reach areas.',
          tanda: 'Walk · drive · cycle',
        },
        {
          nama: 'Loconomics Feature',
          isi: 'Compare locations side by side, simulate a business, watch the ones you want, and export a PDF report.',
          tanda: 'For funding applications',
        },
      ],
      panel: {
        tanya: 'Where is the most promising?',
        jawab: 'Top three in Manggarai',
        layer: ['Opportunity Score', 'PriceLens', 'Hidden Gem', 'RiskRadar'],
        skor: 'Opportunity Score',
        zona: 'Zone',
        keyakinan: 'Confidence',
        sedang: 'Medium',
        basemap: ['Light', 'Basic', 'Street', 'Dark'],
        moda: ['Walking', 'Driving', 'Cycling'],
        banding: 'Compare',
        barisBanding: ['Score', 'Rent', 'Rivals'],
        lokasiA: 'Location A',
        lokasiB: 'Location B',
      },
    },
    penutup: {
      judul: 'Ready to see the map?',
      isi: 'Six transit areas across Jabodetabek, and every number traceable to its source.',
      data: 'Data',
      keAtas: 'Back to top',
    },
    tim: {
      terakhir: 'Lastly',
      turun: 'Go deeper',
      eyebrow: 'Five people',
      judul: 'The team behind it',
      ketua: 'Team lead',
      angkatan: 'Class of',
      permukaan: 'Back to the surface',
    },
  },
}

// ---------------------------------------------------------------------------
// Gambar-gambar kecil
//
// Semuanya SVG yang digambar di tempat, bukan berkas. Aset yang disimpan akan
// basi diam-diam pada perubahan palet berikutnya, dan tidak ada uji yang bisa
// menangkapnya. Yang di bawah ini mengambil warnanya dari token halaman.
// ---------------------------------------------------------------------------

/** Heksagon bertopi runcing, dipusatkan di (0,0). */
function jalurHeks(r: number) {
  return Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 180) * (60 * k - 30)
    return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`
  }).join(' ')
}

/**
 * Letak satu kartu di kisi tim: tiga sebaris di layar lebar, dua di layar
 * sedang, satu di ponsel - dan baris terakhir yang tidak penuh selalu di
 * TENGAH. Permintaan pemilik repo, 11 Sep 2026: "3 di atas, 2 di bawah".
 * Sebelumnya dua kartu terakhir menempel ke kiri dan menyisakan lubang
 * selebar satu kartu di kanan.
 *
 * Kisinya enam kolom di `lg` supaya "dua kartu di tengah" bisa dinyatakan
 * tanpa angka ajaib: tiap kartu dua kolom, dan baris sisanya berangkat dari
 * kolom 2 (dua kartu) atau kolom 3 (satu kartu). Ditulis untuk jumlah orang
 * berapa pun, bukan untuk lima - dan setiap kelas ditulis utuh, karena
 * Tailwind hanya membangkitkan kelas yang muncul harfiah di sumber.
 */
function kelasSelTim(i: number, n: number): string {
  const kelas = ['lg:col-span-2']
  const sisaLebar = n % 3
  if (sisaLebar && i === n - sisaLebar) kelas.push(sisaLebar === 2 ? 'lg:col-start-2' : 'lg:col-start-3')
  if (n % 2 === 1 && i === n - 1) {
    kelas.push('sm:col-span-2 sm:mx-auto sm:w-[calc(50%-0.625rem)] lg:mx-0 lg:w-auto')
  }
  return kelas.join(' ')
}

/**
 * Sarang lebah hidup di latar hero.
 *
 * Bentuknya bukan hiasan: heksagon ADALAH bentuk data proyek ini (H3), jadi
 * latar yang bergerak di sini sekaligus memperkenalkan grid yang akan dipakai
 * di seluruh aplikasi.
 */
const R_SARANG = 44
const UBIN_W = R_SARANG * Math.sqrt(3)
const UBIN_H = R_SARANG * 3

/**
 * Sarang digambar sebagai SATU `<pattern>`, bukan sebagai ratusan poligon.
 * Perender melukis ubinnya SEKALI lalu mengulanginya sebagai tekstur. Lima
 * heksagon per ubin: yang di keempat sudut harus digambar utuh supaya
 * potongannya menyambung dengan ubin sebelahnya.
 */
function Sarang({ id, warna, tebal }: { id: string; warna: string; tebal: number }) {
  const titik = jalurHeks(R_SARANG - 2.5)
  const pusat: [number, number][] = [
    [0, 0],
    [UBIN_W, 0],
    [0, UBIN_H],
    [UBIN_W, UBIN_H],
    [UBIN_W / 2, UBIN_H / 2],
  ]
  return (
    <svg className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <pattern id={id} width={UBIN_W} height={UBIN_H} patternUnits="userSpaceOnUse">
          {pusat.map(([x, y], i) => (
            <polygon
              key={i}
              points={titik}
              transform={`translate(${x} ${y})`}
              fill="none"
              stroke={warna}
              strokeWidth={tebal}
            />
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}

/** Jari-jari lensa kursor, piksel. */
const R_LENSA = 170

/** Bungkus geseran ke dalam (-periode, 0]. Sarangnya `<pattern>` yang berulang,
 *  jadi menggesernya sejauh TEPAT satu ubin tidak mengubah apa pun yang terlihat. */
function bungkus(nilai: number, periode: number): number {
  return nilai - Math.ceil(nilai / periode) * periode
}

/**
 * Latar hero: kisi heksagon yang garis tepinya MENYALA di sekitar kursor.
 *
 * Dua transform yang saling meniadakan: LENSA (jendela bundar digeser ke
 * kursor) dan ISI (sarang terang di dalamnya, digeser berlawanan sejauh yang
 * sama). Sarang terang itu DIAM terhadap halaman - tepat menimpa sarang redup
 * di bawahnya. Yang bergerak cuma jendelanya, dan keduanya `transform`: nol
 * piksel dilukis ulang.
 */
function LatarHero() {
  const akar = useRef<HTMLDivElement>(null)
  const lensa = useRef<HTMLDivElement>(null)
  const isi = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const wadah = akar.current
    const lensaEl = lensa.current
    const isiEl = isi.current
    if (!wadah || !lensaEl || !isiEl) return

    const diam =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !window.matchMedia('(hover: hover)').matches

    let kotak = wadah.getBoundingClientRect()
    let basi = false
    const usang = () => {
      basi = true
    }

    let tx = kotak.width / 2
    let ty = kotak.height / 2
    let x = tx
    let y = ty

    const setLensa = gsap.quickSetter(lensaEl, 'css')
    const setIsi = gsap.quickSetter(isiEl, 'css')
    const tulis = () => {
      setLensa({ x, y })
      setIsi({
        x: bungkus(R_LENSA - x, UBIN_W),
        y: bungkus(R_LENSA - y, UBIN_H),
      })
    }
    tulis()
    if (diam) return

    const TAU_IKUT = 0.055
    const TAU_PULANG = 0.3
    let tau = TAU_IKUT

    let id = 0
    let sebelum = 0
    const bingkai = (t: number) => {
      id = requestAnimationFrame(bingkai)
      if (basi) {
        kotak = wadah.getBoundingClientRect()
        basi = false
      }
      const dt = sebelum ? Math.min((t - sebelum) / 1000, 0.1) : 1 / 60
      sebelum = t
      const k = 1 - Math.exp(-dt / tau)
      x += (tx - x) * k
      y += (ty - y) * k
      tulis()
      if (Math.abs(tx - x) < 0.05 && Math.abs(ty - y) < 0.05) {
        x = tx
        y = ty
        tulis()
        cancelAnimationFrame(id)
        id = 0
      }
    }
    const jalan = () => {
      if (!id) {
        sebelum = 0
        id = requestAnimationFrame(bingkai)
      }
    }

    const gerak = (e: PointerEvent) => {
      tau = TAU_IKUT
      tx = e.clientX - kotak.left
      ty = e.clientY - kotak.top
      jalan()
    }
    const pulang = () => {
      tau = TAU_PULANG
      tx = kotak.width / 2
      ty = kotak.height / 2
      jalan()
    }

    const induk = wadah.parentElement ?? wadah
    induk.addEventListener('pointermove', gerak, { passive: true })
    induk.addEventListener('pointerleave', pulang)
    window.addEventListener('resize', usang)
    window.addEventListener('scroll', usang, { capture: true, passive: true })
    return () => {
      induk.removeEventListener('pointermove', gerak)
      induk.removeEventListener('pointerleave', pulang)
      window.removeEventListener('resize', usang)
      window.removeEventListener('scroll', usang, { capture: true })
      if (id) cancelAnimationFrame(id)
    }
  }, [])

  const sisi = R_LENSA * 2 + 2 * Math.max(UBIN_W, UBIN_H)

  return (
    <div
      ref={akar}
      className="g-hero-latar pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      style={{
        maskImage: 'linear-gradient(to bottom, #000 52%, transparent 96%)',
        WebkitMaskImage: 'linear-gradient(to bottom, #000 52%, transparent 96%)',
      }}
      aria-hidden
    >
      <Sarang id="sarang-dasar" warna="var(--g-sarang)" tebal={1.15} />
      <div
        ref={lensa}
        className="g-lensa absolute left-0 top-0 overflow-hidden"
        style={{ width: R_LENSA * 2, height: R_LENSA * 2, marginLeft: -R_LENSA, marginTop: -R_LENSA }}
      >
        <div ref={isi} className="g-lensa-isi absolute left-0 top-0" style={{ width: sisi, height: sisi }}>
          <Sarang id="sarang-nyala" warna="var(--g-sarang-nyala)" tebal={1.7} />
        </div>
      </div>
    </div>
  )
}
/* ==========================================================================
   Tiga gambar untuk tiga masalah
   ==========================================================================

   BUKAN ilustrasi yang menghiasi kalimat di sebelahnya - masing-masing
   MENGGAMBARKAN kalimatnya, dan kalau kalimatnya berubah gambarnya ikut salah.
   Itu satu-satunya alasan gambar boleh ada di halaman seperti ini.

   Ketiganya sengaja memakai bahasa visual yang BERBEDA dari bagian Ekosistem
   di bawahnya. Ekosistem memakai foto peta sungguhan dalam bingkai membulat;
   yang di sini alat ukur: pelat gelap, siku di keempat sudut, label huruf
   mono kecil. Dua bagian yang berurutan harus bisa dibedakan tanpa membaca
   judulnya, kalau tidak halamannya terbaca sebagai satu bagian yang panjang.

   TIDAK ADA SATU ANGKA PUN di ketiganya, dan itu disengaja. Ini gambar tentang
   gagasan; angka sungguhan ada di enam kartu bagian berikutnya, lengkap dengan
   sumbernya. Angka karangan di gambar yang terlihat seperti alat ukur adalah
   persis jebakan yang sudah tercatat di repo ini.

   Geraknya HANYA `transform` dan `opacity`, seluruhnya keyframe CSS, dan
   berhenti sendiri di luar layar lewat `[data-diam]` yang dipasang pengamat
   di Gerbang().
   ========================================================================== */

type AlatTeks = (typeof K)['id']['masalah']['alat']

/** Siku di keempat sudut pelat. Menandai "ini bidang ukur", bukan bingkai foto. */
function SikuPelat() {
  const d = [
    'M6 20V6h14',
    'M300 6h14v14',
    'M314 160v14h-14',
    'M20 174H6v-14',
  ]
  return (
    <g stroke="var(--g-mas-siku)" strokeWidth="1.2" fill="none" strokeLinecap="square">
      {d.map((j) => (
        <path key={j} d={j} />
      ))}
    </g>
  )
}

/** Label huruf mono kecil di dalam pelat. */
function LabelAlat({
  x,
  y,
  teks,
  anchor = 'middle',
}: {
  x: number
  y: number
  teks: string
  anchor?: 'start' | 'middle' | 'end'
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fontSize="8.5"
      fill="var(--g-ink-4)"
      style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}
    >
      {teks.toUpperCase()}
    </text>
  )
}

/**
 * 1 · Angka orang yang lewat berhenti di tengah jalan.
 *
 * Titik-titik berangkat dari stasiun, menyusuri jalur, lalu PADAM di sebuah
 * garis putus - dan yang di seberang garis itu tidak pernah menerima satu pun.
 * Gerakan yang berhenti sebelum sampai adalah satu-satunya cara menggambarkan
 * "datanya ada, tapi tidak sampai" tanpa satu kata pun.
 */
function AlatSampai({ t }: { t: AlatTeks }) {
  return (
    <svg viewBox="0 0 320 180" className="block h-auto w-full" aria-hidden>
      <SikuPelat />
      {/* Jalur. Ruas sesudah dinding digambar putus-putus: ia ada, tapi kosong. */}
      <path d="M58 96h134" stroke="var(--g-mas-jalur)" strokeWidth="1.4" fill="none" />
      <path
        d="M200 96h58"
        stroke="var(--g-mas-jalur)"
        strokeWidth="1.4"
        strokeDasharray="3 6"
        fill="none"
      />

      {/* Stasiun: cincin bertitik, sama dengan yang dipakai panel kontras. */}
      <g transform="translate(44 96)">
        <circle r="12" fill="none" stroke="var(--g-teal)" strokeWidth="1.4" strokeOpacity="0.5" />
        <circle r="6" fill="var(--g-latar-pekat)" stroke="var(--g-ink)" strokeWidth="1.6" />
        <circle r="2" fill="var(--g-ink)" />
      </g>
      <LabelAlat x={44} y={130} teks={t.simpul} />

      {/* Enam titik yang berangkat berurutan dan padam di dinding. */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <circle
          key={i}
          className="g-mas-alir"
          cx="60"
          cy="96"
          r="3.2"
          fill="var(--g-teal)"
          style={{ animationDelay: `${(i * 0.42).toFixed(2)}s` }}
        />
      ))}

      {/* Dinding. Ungu, rona yang sama dipakai "kasat mata" di panel kontras -
          di halaman ini ungu selalu berarti "yang terlihat, bukan yang terukur". */}
      <path
        d="M196 60v72"
        stroke="var(--g-ungu-terang)"
        strokeWidth="1.6"
        strokeDasharray="5 5"
        fill="none"
      />
      <LabelAlat x={196} y={148} teks={t.putus} />

      {/* Calon usaha: kotak dengan tenda, kosong. */}
      <g transform="translate(258 96)">
        <rect x="-19" y="-16" width="38" height="32" rx="4" fill="none" stroke="var(--g-ink-4)" strokeWidth="1.4" />
        <path d="M-19-16h38" stroke="var(--g-ink-3)" strokeWidth="2.4" />
        <path d="M-6 4h12" stroke="var(--g-ink-4)" strokeWidth="1.4" strokeLinecap="round" />
      </g>
      <LabelAlat x={258} y={130} teks={t.usaha} />
    </svg>
  )
}

/**
 * 2 · Sewa dipatok dari gengsi, bukan dari penjualan.
 *
 * Dua batang tumbuh berbeda tinggi, dan GARIS SEWA naik mengikuti yang KIRI.
 * Yang membuatnya terbaca bukan batangnya melainkan garis itu: ia berhenti
 * sejajar dengan tampilan, jauh di atas penjualan, dan di situlah selisih yang
 * dibayar tiap bulan.
 */
function AlatSewa({ t }: { t: AlatTeks }) {
  return (
    <svg viewBox="0 0 320 180" className="block h-auto w-full" aria-hidden>
      <SikuPelat />
      <path d="M40 146h240" stroke="var(--g-mas-jalur)" strokeWidth="1.2" fill="none" />

      {/* Batang tampilan - tinggi, ungu: yang dilihat mata. */}
      <rect
        className="g-mas-batang"
        x="86"
        y="52"
        width="46"
        height="94"
        rx="3"
        fill="var(--g-ungu)"
        fillOpacity="0.75"
        style={{ animationDelay: '0.1s' }}
      />
      <LabelAlat x={109} y={162} teks={t.tampilan} />

      {/* Batang penjualan - pendek, teal: yang terukur. */}
      <rect
        className="g-mas-batang"
        x="188"
        y="118"
        width="46"
        height="28"
        rx="3"
        fill="var(--g-teal)"
        fillOpacity="0.7"
        style={{ animationDelay: '0.45s' }}
      />
      <LabelAlat x={211} y={162} teks={t.jual} />

      {/* Garis sewa: naik terlambat, lalu berhenti sejajar dengan TAMPILAN. */}
      <g className="g-mas-sewa">
        <path d="M46 52h228" stroke="var(--g-ink)" strokeWidth="1.4" strokeDasharray="6 5" fill="none" />
        <text
          x={274}
          y={42}
          textAnchor="end"
          fontSize="8.5"
          fill="var(--g-ink-2)"
          style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}
        >
          {t.sewa.toUpperCase()}
        </text>
      </g>
    </svg>
  )
}

/**
 * Yang jadi jawabannya, sebagai INDEKS ke `SEL_KONTRAS`.
 *
 * Sel ke-5 di sana ditulis `[-1, 1, 0.35, 'HIDDEN_GEM']`: menonjolnya 0,35 -
 * di bawah ambang "terlihat menonjol" - dan zonanya Hidden Gem. Persis kalimat
 * yang sedang digambarkan: datanya bagus, tampilannya biasa saja. Kalau suatu
 * saat sel itu diubah, gambar ini ikut salah, dan `assert` di bawah yang
 * memberitahunya - bukan mata siapa pun berbulan-bulan kemudian.
 */
const I_TEMU = 5

/**
 * 3 · Lokasi terbaik sering tidak kelihatan istimewa.
 *
 * Petaknya SAMA PERSIS dengan petak panel "satu kawasan, dua cara melihat" di
 * bawah - dan itu bukan penghematan, itu kalimatnya. Gambar ini memperlihatkan
 * kawasan yang sama sebelum ada yang menghitung: seluruh petaknya seragam, dan
 * tidak ada satu pun yang terlihat lebih menjanjikan. Satu sapuan lewat, satu
 * petak berubah jadi Hidden Gem, dan panel di bawah melanjutkan dari situ
 * dengan keempat zonanya.
 *
 * Yang membuat gambar ini bekerja adalah petak itu tidak pernah terlihat
 * berbeda sebelum sapuannya sampai.
 */
function AlatTemu({ t }: { t: AlatTeks }) {
  const r = 15
  const titik = jalurHeks(r - 1.4)
  const pos = (q: number, rr: number) => ({
    x: 160 + r * Math.sqrt(3) * (q + rr / 2),
    y: 88 + r * 1.5 * rr,
  })
  const temu = pos(SEL_KONTRAS[I_TEMU][0], SEL_KONTRAS[I_TEMU][1])
  return (
    <svg viewBox="0 0 320 180" className="block h-auto w-full" aria-hidden>
      <SikuPelat />
      <defs>
        {/* Sapuan yang terlalu pekat berhenti jadi sapuan dan jadi TIANG -
            benda yang berdiri di depan petaknya alih-alih melewatinya.
            Terlihat begitu di potret pada 0,5; 0,26 menyapu tanpa menutupi. */}
        <linearGradient id="g-sapu-temu" x1="0" x2="1">
          <stop offset="0%" stopColor="var(--g-teal)" stopOpacity="0" />
          <stop offset="50%" stopColor="var(--g-teal)" stopOpacity="0.26" />
          <stop offset="100%" stopColor="var(--g-teal)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {SEL_KONTRAS.map(([q, rr], i) => {
        const { x, y } = pos(q, rr)
        return (
          <polygon
            key={i}
            points={titik}
            transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}
            fill="var(--g-ink-4)"
            fillOpacity="0.16"
            stroke="var(--g-kontras-garis)"
            strokeWidth="1"
          />
        )
      })}

      {/* Jawabannya, digambar DI ATAS petak seragam tadi.
          DUA `<g>`, dan itu bukan kelebihan satu simpul: `transform` dari CSS
          MENIMPA atribut `transform` milik SVG, ia tidak ditumpuk di atasnya.
          Menaruh keduanya di simpul yang sama membuat heksagon ini melompat ke
          pojok kiri atas pelat begitu animasinya menulis `scale()` - terlihat
          persis begitu di potret sebelum dipisah. */}
      <g transform={`translate(${temu.x.toFixed(1)} ${temu.y.toFixed(1)})`}>
        <g className="g-mas-temu">
          <polygon points={titik} fill={warnaZona('HIDDEN_GEM')} fillOpacity="0.85" />
          <polygon points={jalurHeks(r + 1.4)} fill="none" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="1.5" />
        </g>
      </g>

      {/* Sapuan. Lebar tetap, bergerak mendatar - `transform`, bukan `x`. */}
      <rect className="g-mas-sapu" x="-26" y="18" width="52" height="128" fill="url(#g-sapu-temu)" />

      <LabelAlat x={26} y={168} teks={t.hitung} anchor="start" />
      <LabelAlat x={294} y={168} teks={t.temu} anchor="end" />
    </svg>
  )
}

/** Pelat alat ukur: satu bingkai untuk ketiga gambar di atas. */
function PelatMasalah({ i, t }: { i: number; t: AlatTeks }) {
  return (
    <div className="g-mas-plat relative overflow-hidden rounded-[18px] p-3 sm:p-4">
      {i === 0 ? <AlatSampai t={t} /> : i === 1 ? <AlatSewa t={t} /> : <AlatTemu t={t} />}
    </div>
  )
}


/* ==========================================================================
   Satu kawasan, dua cara melihat
   ==========================================================================

   Pusat bagian latar belakang, dan satu-satunya gambar yang bergerak sendiri
   di halaman ini. Ia menggambar TEPAT kalimat dari dokumen konsep tim: "tempat
   yang kalau dilihat kasat mata nggak worth it, tapi dari data yang kita
   kumpulkan ternyata worth it".

   TANPA GESERAN, sejak 10 Sep 2026. Versi sebelumnya menyerahkan pergantiannya
   ke `input[type=range]` yang harus digeser sendiri - dan gambar yang harus
   dioperasikan dulu sebelum berbicara adalah gambar yang sebagian besar
   pembacanya lewati. Sekarang ia berganti sendiri, bolak-balik, dengan
   pergantian warna yang sama halusnya.

   YANG DITAMPILKAN SISI KANANNYA: KEEMPAT ZONA SUNGGUHAN - Hidden Gem, Aman,
   Jebakan Gengsi, Hindari - dengan warna yang sama persis dengan yang nanti
   dilihat orang di peta. Sebelumnya sisi ini cuma gradien teal "kuat/lemah",
   yang tidak mengajarkan apa pun. Kosakata yang dipakai produk ini sebaiknya
   diperkenalkan di tempat pertama ia bisa diperkenalkan.

   Warnanya diambil dari `KUADRAN` di config - satu sumber dengan peta, legenda,
   dan kartu - lalu dicerahkan ke arah putih. Palet itu dirancang untuk basemap
   TERANG; di atas hitam, hijau #15803D dan merah #B01B1B jatuh terlalu dekat ke
   latarnya. Yang digeser terangnya saja, ronanya tidak.

   Yang bergerak cuma DUA `opacity` - satu per kelompok - dan keduanya
   diserahkan ke transisi CSS. React cuma mengganti satu bilangan tiap ~3,6
   detik; tidak ada satu pun bingkai yang dihitung JavaScript.
   ========================================================================== */

const R_KONTRAS = 21
type KunciKuadran = (typeof URUTAN_KUADRAN)[number]

/**
 * q, r (koordinat aksial), seberapa MENONJOL ia terlihat (0..1), lalu zona
 * yang keluar dari datanya.
 *
 * Angkanya dirancang, bukan diukur - ini gambar tentang sebuah gagasan, dan
 * angka sungguhan ada di enam kartu bagian berikutnya. Yang dijaga cuma
 * hubungannya: tiap sel yang ber-zona Hidden Gem TIDAK boleh terlihat menonjol,
 * dan tiap Jebakan Gengsi HARUS terlihat menonjol - kalau tidak, gambarnya
 * membantah kalimat yang menyertainya.
 */
const SEL_KONTRAS: [number, number, number, KunciKuadran][] = [
  [0, 0, 0.95, 'PEMENANG_JELAS'],
  [1, 0, 0.85, 'JEBAKAN_GENGSI'],
  [1, -1, 0.7, 'PEMENANG_JELAS'],
  [0, -1, 0.55, 'HINDARI'],
  [-1, 0, 0.8, 'JEBAKAN_GENGSI'],
  [-1, 1, 0.35, 'HIDDEN_GEM'],
  [0, 1, 0.62, 'PEMENANG_JELAS'],
  [2, 0, 0.3, 'HINDARI'],
  [2, -1, 0.32, 'HIDDEN_GEM'],
  [2, -2, 0.25, 'HINDARI'],
  [1, -2, 0.5, 'HINDARI'],
  [0, -2, 0.72, 'JEBAKAN_GENGSI'],
  [-1, -1, 0.3, 'HINDARI'],
  [-2, 0, 0.22, 'HIDDEN_GEM'],
  [-2, 1, 0.35, 'HINDARI'],
  [-2, 2, 0.25, 'HINDARI'],
  [-1, 2, 0.45, 'HIDDEN_GEM'],
  [0, 2, 0.28, 'HIDDEN_GEM'],
  [1, 1, 0.66, 'PEMENANG_JELAS'],
]

/** Dicerahkan ke arah putih supaya terbaca di atas hitam. Ronanya tidak digeser. */
const warnaZona = (k: KunciKuadran) => `color-mix(in srgb, ${KUADRAN[k].warna} 76%, #ffffff)`

/** Ambang "terlihat menonjol". Dipakai menghitung kalimat di bawah gambar. */
const AMBANG_MENONJOL = 0.6

/**
 * Gambar ketiga bagian masalah meminjam sel ini dan MENYEBUTNYA Hidden Gem
 * yang tidak menonjol. Kalau daftarnya diurut ulang, gambarnya jadi berbohong
 * tanpa satu pun galat - jadi biarkan ini yang berteriak lebih dulu.
 */
if (import.meta.env.DEV) {
  const s = SEL_KONTRAS[I_TEMU]
  if (!s || s[3] !== 'HIDDEN_GEM' || s[2] >= AMBANG_MENONJOL) {
    throw new Error('SEL_KONTRAS[I_TEMU] bukan lagi Hidden Gem yang tidak menonjol')
  }
}

function KontrasKawasan() {
  const k = useTeks(K).kontras
  const namaZona = useNamaZona()
  const akar = useRef<HTMLDivElement>(null)
  const [fase, setFase] = useState(0)

  /**
   * Pergantiannya BERHENTI saat gambarnya di luar layar.
   *
   * Bukan demi hemat - satu interval 3,6 detik nyaris gratis - melainkan demi
   * yang membaca: kalau ia terus berdetak sementara tidak terlihat, orang yang
   * baru menggulir ke sini mendarat di tengah pergantian, dan setengah
   * pergantian tidak menyatakan apa pun. Dengan ini ia selalu mulai dari
   * "kasat mata", yaitu dari cara orang melihat sebelum ada datanya.
   */
  useEffect(() => {
    const el = akar.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setFase(1)
      return
    }
    let jam = 0
    const mulai = () => {
      if (jam) return
      jam = window.setInterval(() => setFase((f) => (f ? 0 : 1)), 3600)
    }
    const henti = () => {
      window.clearInterval(jam)
      jam = 0
    }
    if (typeof IntersectionObserver === 'undefined') {
      mulai()
      return () => henti()
    }
    const pengamat = new IntersectionObserver(
      ([m]) => {
        if (m.isIntersecting) mulai()
        else {
          henti()
          setFase(0)
        }
      },
      { threshold: 0.25 },
    )
    pengamat.observe(el)
    return () => {
      pengamat.disconnect()
      henti()
    }
  }, [])

  const cx = 160
  const cy = 146
  const titikHeks = jalurHeks(R_KONTRAS - 1.6)
  const posisi = (q: number, r: number) => ({
    x: cx + R_KONTRAS * Math.sqrt(3) * (q + r / 2),
    y: cy + R_KONTRAS * 1.5 * r,
  })
  /** Yang datanya bagus TANPA terlihat mahal - inti seluruh produk ini. */
  const permata = SEL_KONTRAS.filter(([, , m, z]) => z === 'HIDDEN_GEM' && m < AMBANG_MENONJOL).length
  const lentur = 'opacity 1500ms cubic-bezier(0.33, 0.9, 0.28, 1)'

  return (
    <div ref={akar} className="g-kontras relative rounded-[22px] p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="judul-anak text-[15px] leading-snug text-[color:var(--g-ink)]">{k.judul}</p>
        {/* Penunjuk fase, bukan tombol: gambarnya berganti sendiri. Yang aktif
            memakai warna sisinya sendiri - ungu untuk yang dilihat mata, teal
            untuk yang dibaca dari data. */}
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em]" aria-hidden>
          <span
            className="transition-colors duration-700"
            style={{ color: fase ? 'var(--g-ink-4)' : 'var(--g-ungu-terang)' }}
          >
            {k.kiri}
          </span>
          <span className="text-[color:var(--g-ink-4)]">/</span>
          <span
            className="transition-colors duration-700"
            style={{ color: fase ? 'var(--g-teal)' : 'var(--g-ink-4)' }}
          >
            {k.kanan}
          </span>
        </p>
      </div>

      {/* viewBox dipangkas ke kotak yang benar-benar dipakai gugusannya.
          Dengan 0 0 320 296 gugusan 19 selnya cuma mengisi bagian tengah dan
          panelnya jadi dua pertiga ruang kosong - terlihat begitu di potret. */}
      <svg viewBox="64 58 192 178" className="mx-auto mt-2 block h-auto w-full max-w-[330px]" aria-hidden>
        {/* Garis tepi tiap sel, selalu ada. Ia yang membuat petaknya tetap
            terbaca sebagai grid saat kedua kelompok isian sedang berpapasan. */}
        {SEL_KONTRAS.map(([q, r], i) => {
          const { x, y } = posisi(q, r)
          return (
            <polygon
              key={`t${i}`}
              points={titikHeks}
              transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`}
              fill="none"
              stroke="var(--g-kontras-garis)"
              strokeWidth="1"
            />
          )
        })}

        {/* KASAT MATA: satu rona, terangnya mengikuti seberapa menonjol. */}
        <g style={{ opacity: fase ? 0 : 1, transition: lentur }}>
          {SEL_KONTRAS.map(([q, r, m], i) => {
            const { x, y } = posisi(q, r)
            return (
              <polygon
                key={`m${i}`}
                points={titikHeks}
                transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`}
                fill="var(--g-ungu)"
                fillOpacity={0.1 + 0.75 * m}
              />
            )
          })}
        </g>

        {/* MENURUT DATA: empat zona, warna yang sama dengan di peta. */}
        <g style={{ opacity: fase ? 1 : 0, transition: lentur }}>
          {SEL_KONTRAS.map(([q, r, m, z], i) => {
            const { x, y } = posisi(q, r)
            const disorot = z === 'HIDDEN_GEM' && m < AMBANG_MENONJOL
            return (
              <g key={`d${i}`} transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`}>
                <polygon points={titikHeks} fill={warnaZona(z)} fillOpacity={0.82} />
                {/* Yang jadi alasan produk ini ada diberi cincin, bukan warna
                    kelima: warna kelima akan jadi zona kelima yang tidak ada. */}
                {disorot && (
                  <polygon
                    points={jalurHeks(R_KONTRAS + 1.4)}
                    fill="none"
                    stroke="#ffffff"
                    strokeOpacity="0.85"
                    strokeWidth="1.5"
                  />
                )}
              </g>
            )
          })}
        </g>

        {/* Stasiun di pusatnya. Cincin bertitik, bukan pin: pin menandai tujuan,
            dan di gambar ini stasiunnya justru pusat yang dikelilingi. */}
        <g transform={`translate(${cx} ${cy})`}>
          <circle r="5.5" fill="var(--g-latar-pekat)" stroke="var(--g-ink)" strokeWidth="1.6" />
          <circle r="1.8" fill="var(--g-ink)" />
        </g>
        {/* Halo lewat `paint-order: stroke`. Tanpa itu labelnya jatuh di atas
            isian heksagon pusat - ungu pekat di satu fase, hijau di fase lain -
            dan hilang sama sekali di keduanya. */}
        <text
          x={cx}
          y={cy + 16}
          textAnchor="middle"
          fontSize="8"
          fill="var(--g-ink-2)"
          stroke="var(--g-latar-pekat)"
          strokeWidth="2.6"
          paintOrder="stroke"
          style={{ fontFamily: 'inherit', letterSpacing: '0.09em' }}
        >
          {k.simpul.toUpperCase()}
        </text>
      </svg>

      {/* Satu kalimat pada satu waktu, dan kalimatnya menyebut apa yang sedang
          terlihat. Dua kalimat sekaligus akan membuat orang membaca yang tidak
          sedang digambar. */}
      <p
        key={fase}
        className="g-kontras-teks mt-2 min-h-[3.2em] text-[13px] leading-relaxed text-[color:var(--g-ink-2)]"
      >
        {fase ? k.data(permata) : k.mata}
      </p>

      {/* Legenda keempat zona. Meredup saat sisi kiri sedang tampil - ia belum
          berlaku di sana, dan legenda yang berlaku untuk gambar yang tidak
          sedang terlihat adalah legenda yang menyesatkan. */}
      <ul
        className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] transition-opacity duration-700"
        style={{ opacity: fase ? 1 : 0.3 }}
      >
        {URUTAN_KUADRAN.map((z) => (
          <li key={z} className="flex items-center gap-1.5 text-[color:var(--g-ink-3)]">
            <span
              className="inline-block h-2 w-2 rounded-[2px]"
              style={{ background: warnaZona(z) }}
              aria-hidden
            />
            {namaZona(z)}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ==========================================================================
   Panel kecil untuk tiap baris ekosistem
   ==========================================================================

   Susunan yang ditiru bagian ini memakai TANGKAPAN LAYAR produk: peta besar
   dengan satu panel antarmuka melayang di atasnya. Yang di bawah bukan
   tangkapan layar - ia panel yang digambar ulang dari komponen halaman ini,
   di atas potret peta yang memang dirender dari basis data kita sendiri.

   Bedanya penting dan disengaja. Tangkapan layar palsu berisi angka yang tidak
   pernah dihitung siapa pun; yang di bawah ini cuma memuat LABEL yang benar-
   benar ada di aplikasinya - nama layer, nama zona, nama moda, nama basemap.
   Batang dan garisnya jelas skematis, dan tidak satu pun di antaranya membawa
   angka yang mengaku terukur.
   ========================================================================== */

type PanelTeks = (typeof K)['id']['ekosistem']['panel']

function PanelEko({ i, teks }: { i: number; teks: PanelTeks }) {
  const namaZona = useNamaZona()
  const kotak = 'g-eko-panel rounded-[13px] p-3.5'
  switch (i) {
    // --- Loconomics AI: pertanyaan, lalu jawabannya menggerakkan peta -------
    case 0:
      return (
        <div className={`${kotak} w-[15.5rem]`}>
          <p className="ml-auto w-fit max-w-full rounded-[10px] rounded-br-[4px] bg-[color:var(--g-teal)]/16 px-2.5 py-1.5 text-[11px] leading-snug text-[color:var(--g-ink)]">
            {teks.tanya}
          </p>
          <p className="mt-2.5 flex items-center gap-1.5 text-[10.5px] font-semibold text-[color:var(--g-teal)]">
            <svg width="10" height="11" viewBox="-50 -55 100 110" aria-hidden>
              <polygon points={jalurHeks(46)} fill="currentColor" />
            </svg>
            {teks.jawab}
          </p>
          <div className="mt-2 space-y-1.5">
            {[1, 0.72, 0.46].map((w, n) => (
              <span
                key={n}
                className="block h-[5px] rounded-full bg-[color:var(--g-ink)]/14"
                style={{ width: `${w * 100}%` }}
              />
            ))}
          </div>
        </div>
      )
    // --- Heksagon Layer: satu grid, layer yang bisa ditukar -----------------
    case 1:
      return (
        <div className={`${kotak} w-[13.5rem]`}>
          {teks.layer.map((l, n) => (
            <p
              key={l}
              className={`flex items-center gap-2 py-[5px] text-[11px] ${
                n === 0 ? 'font-semibold text-[color:var(--g-ink)]' : 'text-[color:var(--g-ink-3)]'
              }`}
            >
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]"
                style={{
                  background: n === 0 ? 'var(--g-teal)' : 'var(--g-ink-4)',
                  opacity: n === 0 ? 1 : 0.5,
                }}
                aria-hidden
              />
              {l}
            </p>
          ))}
        </div>
      )
    // --- Insight: skor, zona, keyakinan ------------------------------------
    case 2:
      return (
        <div className={`${kotak} w-[14.5rem]`}>
          <p className="eyebrow text-[9.5px] text-[color:var(--g-ink-4)]">{teks.skor}</p>
          <span
            className="mt-2 block h-[6px] w-full overflow-hidden rounded-full bg-[color:var(--g-ink)]/12"
            aria-hidden
          >
            <span className="block h-full w-[78%] rounded-full bg-[color:var(--g-teal)]" />
          </span>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span
              className="rounded-full px-2 py-[3px] text-[10px] font-semibold"
              style={{
                background: `color-mix(in srgb, ${warnaZona('HIDDEN_GEM')} 22%, transparent)`,
                color: warnaZona('HIDDEN_GEM'),
              }}
            >
              {teks.zona}: {namaZona('HIDDEN_GEM')}
            </span>
            <span className="rounded-full bg-[color:var(--g-ink)]/10 px-2 py-[3px] text-[10px] text-[color:var(--g-ink-2)]">
              {teks.keyakinan}: {teks.sedang}
            </span>
          </div>
        </div>
      )
    // --- Maps: empat basemap, satu aktif -----------------------------------
    case 3:
      return (
        <div className={`${kotak} w-[14rem]`}>
          <div className="grid grid-cols-2 gap-1.5">
            {teks.basemap.map((b, n) => (
              <span
                key={b}
                className={`rounded-[8px] px-2 py-1.5 text-center text-[10.5px] font-medium ${
                  n === 3 ? 'bg-[color:var(--g-ink)]/14 text-[color:var(--g-ink)]' : 'text-[color:var(--g-ink-3)]'
                }`}
              >
                {b}
              </span>
            ))}
          </div>
        </div>
      )
    // --- Route: tiga moda, dan jalurnya ------------------------------------
    case 4:
      return (
        <div className={`${kotak} w-[15rem]`}>
          <svg viewBox="0 0 200 52" className="block h-auto w-full" aria-hidden>
            {/* Titik bulat berderet - resep yang sama dengan rute jalan kaki di
                peta: dash sepanjang NOL yang diberi tutup bulat. */}
            <path
              d="M18 42 C 60 42, 62 14, 100 14 S 150 30, 182 12"
              fill="none"
              stroke="var(--g-teal)"
              strokeWidth="3.4"
              strokeLinecap="round"
              strokeDasharray="0 7.5"
            />
            <circle cx="18" cy="42" r="4.6" fill="#3B82F6" stroke="#fff" strokeWidth="1.6" />
            <circle cx="182" cy="12" r="4.6" fill="#E5484D" stroke="#fff" strokeWidth="1.6" />
          </svg>
          <div className="mt-2 flex gap-1.5">
            {teks.moda.map((m, n) => (
              <span
                key={m}
                className={`flex-1 rounded-[8px] px-1.5 py-1 text-center text-[9.5px] font-medium ${
                  n === 0 ? 'bg-[color:var(--g-teal)]/16 text-[color:var(--g-teal)]' : 'text-[color:var(--g-ink-3)]'
                }`}
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      )
    // --- Feature: dua lokasi berdampingan ----------------------------------
    default:
      return (
        <div className={`${kotak} w-[15.5rem]`}>
          <p className="eyebrow mb-2 text-[9.5px] text-[color:var(--g-ink-4)]">{teks.banding}</p>
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-2">
            <span />
            <span className="text-[9.5px] font-semibold text-[color:var(--g-teal)]">{teks.lokasiA}</span>
            <span className="text-[9.5px] font-semibold text-[color:var(--g-ungu-terang)]">{teks.lokasiB}</span>
            {teks.barisBanding.map((b, n) => (
              <BarisBanding key={b} label={b} a={[0.82, 0.44, 0.62][n]} b={[0.55, 0.78, 0.35][n]} />
            ))}
          </div>
        </div>
      )
  }
}

/** Satu baris tabel banding: label, lalu dua batang yang panjangnya berbeda. */
function BarisBanding({ label, a, b }: { label: string; a: number; b: number }) {
  return (
    <>
      <span className="text-[10.5px] text-[color:var(--g-ink-3)]">{label}</span>
      {[
        [a, 'var(--g-teal)'],
        [b, 'var(--g-ungu-terang)'],
      ].map(([w, c], n) => (
        <span
          key={n}
          className="block h-[5px] w-9 overflow-hidden rounded-full bg-[color:var(--g-ink)]/12"
          aria-hidden
        >
          <span
            className="block h-full rounded-full"
            style={{ width: `${(w as number) * 100}%`, background: c as string }}
          />
        </span>
      ))}
    </>
  )
}

/**
 * Teks yang benar-benar setebal benda: delapan salinan huruf ditumpuk mundur
 * di sumbu Z. `perspective` dipasang di pembungkusnya.
 */
const LAPIS_3D = 8
function Teks3D({ teks, kelas }: { teks: string; kelas?: string }) {
  return (
    <span className={`relative inline-block ${kelas ?? ''}`} style={{ transformStyle: 'preserve-3d' }} aria-label={teks}>
      {Array.from({ length: LAPIS_3D }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={i === 0 ? 'relative block' : 'absolute inset-0 block'}
          style={{
            transform: `translateZ(${-i * 2.4}px)`,
            color: i === 0 ? 'var(--g-ink)' : `rgba(9,52,47,${0.62 - i * 0.06})`,
            zIndex: -i,
          }}
        >
          {teks}
        </span>
      ))}
    </span>
  )
}

/**
 * Tombol yang tertarik ke kursor. Titik jangkarnya diukur saat kursor MASUK,
 * bukan tiap kali kursor bergerak; pulangnya pantulan elastis milik GSAP.
 */
function Magnet({
  anak,
  kelas,
  onClick,
  label,
  kekuatan = 0.32,
}: {
  anak: ReactNode
  kelas: string
  onClick?: () => void
  label?: string
  kekuatan?: number
}) {
  const el = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const n = el.current
    if (!n) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (!window.matchMedia('(hover: hover)').matches) return

    const set = gsap.quickSetter(n, 'css')
    let x = 0
    let y = 0
    let tx = 0
    let ty = 0
    let px = 0
    let py = 0

    const ukur = () => {
      const r = n.getBoundingClientRect()
      px = r.left - x + n.offsetWidth / 2
      py = r.top - y + n.offsetHeight / 2
    }

    let id = 0
    let sebelum = 0
    const TAU = 0.07
    const bingkai = (t: number) => {
      id = requestAnimationFrame(bingkai)
      const dt = sebelum ? Math.min((t - sebelum) / 1000, 0.1) : 1 / 60
      sebelum = t
      const k = 1 - Math.exp(-dt / TAU)
      x += (tx - x) * k
      y += (ty - y) * k
      set({ x, y })
      if (Math.abs(tx - x) < 0.05 && Math.abs(ty - y) < 0.05) {
        x = tx
        y = ty
        set({ x, y })
        cancelAnimationFrame(id)
        id = 0
      }
    }
    const jalan = () => {
      if (!id) {
        sebelum = 0
        id = requestAnimationFrame(bingkai)
      }
    }

    const masuk = () => {
      gsap.killTweensOf(n)
      x = (gsap.getProperty(n, 'x') as number) || 0
      y = (gsap.getProperty(n, 'y') as number) || 0
      ukur()
    }
    const geser = (e: PointerEvent) => {
      tx = (e.clientX - px) * kekuatan
      ty = (e.clientY - py) * kekuatan
      jalan()
    }
    const pulang = () => {
      if (id) {
        cancelAnimationFrame(id)
        id = 0
      }
      gsap.set(n, { x, y })
      gsap.to(n, {
        x: 0,
        y: 0,
        duration: 1.1,
        ease: 'elastic.out(1, 0.35)',
        onUpdate: () => {
          x = gsap.getProperty(n, 'x') as number
          y = gsap.getProperty(n, 'y') as number
        },
      })
      tx = 0
      ty = 0
    }

    n.addEventListener('pointerenter', masuk)
    n.addEventListener('pointermove', geser, { passive: true })
    n.addEventListener('pointerleave', pulang)
    return () => {
      n.removeEventListener('pointerenter', masuk)
      n.removeEventListener('pointermove', geser)
      n.removeEventListener('pointerleave', pulang)
      if (id) cancelAnimationFrame(id)
      gsap.killTweensOf(n)
    }
  }, [kekuatan])

  return (
    <button ref={el} onClick={onClick} aria-label={label} className={kelas}>
      {anak}
    </button>
  )
}

function PanahKanan() {
  return (
    <span className="grid h-7 w-7 place-items-center rounded-full bg-[color:var(--g-ink)]/10 transition-transform duration-300 ease-jelly group-hover:translate-x-1">
      <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden>
        <path
          d="M2 6h8M6.5 2.5 10 6l-3.5 3.5"
          stroke="currentColor"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Halaman
// ---------------------------------------------------------------------------

export default function Gerbang({ onMasuk }: { onMasuk: (pilihan?: PilihanKawasan) => void }) {
  const akar = useRef<HTMLDivElement>(null)
  const teks = useTeks(K)
  const { bahasa } = useBahasa()
  const { tema } = useTema()

  const [gerakMati] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  /** Bilah atas berganti bahan begitu halaman masuk jurang. */
  const [navGelap, setNavGelap] = useState(false)

  const keBagian = useCallback((id: string) => {
    const wadah = akar.current
    const sasaran = wadah?.querySelector<HTMLElement>(`#${id}`)
    if (!wadah || !sasaran) return
    // Diukur lewat rect, bukan `offsetTop`: bagian-bagiannya duduk di dalam
    // pembungkus `relative`, jadi offsetTop-nya relatif terhadap pembungkus itu,
    // bukan terhadap wadah yang menggulir.
    const atas = sasaran.getBoundingClientRect().top - wadah.getBoundingClientRect().top + wadah.scrollTop
    wadah.scrollTo({ top: atas - 64, behavior: 'smooth' })
  }, [])

  const keAtas = useCallback(() => akar.current?.scrollTo({ top: 0, behavior: 'smooth' }), [])

  useEffect(() => {
    if (gerakMati) return

    // Yang menggulir adalah AKAR halaman ini, bukan window. `scroller` WAJIB
    // ada di SETIAP ScrollTrigger di berkas ini.
    const scroller = akar.current
    if (!scroller) return
    const pembersih: (() => void)[] = []

    // Lingkupnya ELEMEN, bukan objek ref: `ctx.revert()` berjalan SESUDAH React
    // melepas ref-nya, dan GSAP akan memperingatkan "Invalid scope".
    const ctx = gsap.context(() => {
      // --- Masuk pertama ----------------------------------------------------
      gsap.from('.g-judul > span', {
        yPercent: 115,
        opacity: 0,
        rotateX: -68,
        stagger: 0.042,
        duration: 0.9,
        ease: 'power4.out',
        delay: 0.12,
      })
      gsap.from('.g-masuk-awal', {
        y: 26,
        opacity: 0,
        stagger: 0.1,
        duration: 0.8,
        ease: 'power3.out',
        delay: 0.55,
      })

      /**
       * Dipakai DUA blok di bawah, jadi ia diukur sekali di sini.
       *
       * Geseran mendatar hanya boleh di layar lebar, dan itu bukan selera:
       * elemen yang PARKIR di keadaan awalnya (`x: 54`) sebelum pemicunya
       * sampai benar-benar berdiri 54 px di luar wadahnya. Terukur di 390 px:
       * halaman jadi bisa digulir MENDATAR sampai 420 px, persis gejala yang
       * dilarang B.6.
       */
      const lebarBesar = window.matchMedia('(min-width: 1024px)').matches

      // --- MENUTUP: hero dipatok, bagian berikutnya menggulir menutupinya ---
      //
      // Hero-nya `sticky`, jadi pembungkus di bawahnya naik MENIMPANYA. Yang
      // dianimasikan cuma isi hero: menyusut dan meredup seiring tertutup,
      // supaya yang terbaca adalah lembaran yang menutup benda di bawahnya -
      // bukan dua bagian yang kebetulan bertumpuk.
      gsap.to('.g-hero-isi', {
        scale: 0.93,
        y: -36,
        opacity: 0.18,
        ease: 'none',
        scrollTrigger: { scroller, trigger: '.g-tutup', start: 'top bottom', end: 'top 12%', scrub: 0.5 },
      })

      /**
       * Latar hero DIPADAMKAN begitu lembar penutupnya benar-benar menutupinya.
       *
       * Hero itu `sticky`, jadi ia tidak pernah keluar dari viewport dan tidak
       * pernah dipadamkan pengamat `[data-diam]` - dan sarang heksagon plus
       * lensanya terus DILUKIS di belakang lembar pekat sepanjang halaman.
       * Terukur di build produksi, gulir 55px/bingkai: bingkai median 43,2 ms
       * dengan latar itu hidup, 32,0 ms tanpa. Sebelas milidetik per bingkai
       * untuk gambar yang tidak bisa dilihat siapa pun.
       *
       * Yang dipadamkan HANYA lapisan hiasnya, yang memang sudah `aria-hidden`.
       * Isi hero - judul, kalimat, kedua tombol - dibiarkan utuh: ia masih di
       * pohon aksesibilitas, dan pembaca layar yang menggulir kembali ke atas
       * tetap menemukannya.
       */
      ScrollTrigger.create({
        scroller,
        trigger: '.g-tutup',
        start: 'top top',
        onEnter: () => akar.current?.querySelector('.g-hero')?.setAttribute('data-tertutup', '1'),
        onLeaveBack: () => akar.current?.querySelector('.g-hero')?.removeAttribute('data-tertutup'),
      })

      // --- JEDA: tali yang tumbuh mengikuti gulir --------------------------
      //
      // `scrub`, bukan tween yang berjalan sendiri: benda yang menandai JARAK
      // harus tumbuh sepanjang jarak itu, bukan selesai dalam satu detik lalu
      // menunggu. Yang tumbuh `scaleY` dengan titik asal di atas.
      gsap.fromTo(
        '.g-jeda-isi',
        { scaleY: 0 },
        {
          scaleY: 1,
          ease: 'none',
          scrollTrigger: { scroller, trigger: '.g-jeda', start: 'top 78%', end: 'bottom 62%', scrub: 0.5 },
        },
      )
      // Heksagon di ujung tali ikut SCRUB yang sama, bukan tween sendiri.
      //
      // Tween `from` di sini pernah meninggalkannya di opacity 0 selamanya:
      // pemicunya `bottom 72%`, dan siapa pun yang mendarat di bagian ini lewat
      // tautan langsung sudah melewatinya sebelum ScrollTrigger sempat
      // mengukurnya. Jebakan yang sama persis pernah memakan tombol "gulir" di
      // hero. Diikat ke scrub, ia tidak punya keadaan "belum dipicu".
      gsap.fromTo(
        '.g-jeda-heks',
        { scale: 0.2, opacity: 0 },
        {
          scale: 1,
          opacity: 1,
          ease: 'none',
          scrollTrigger: { scroller, trigger: '.g-jeda', start: 'top 60%', end: 'bottom 70%', scrub: 0.5 },
        },
      )

      // --- Kosakata gerak bersama: MASALAH dan SOLUSI ------------------------
      //
      // Diminta pemilik repo, 11 Sep 2026: "semuanya dikasih animasi/transisi
      // kemunculan yang keren dan mewah/elegan" untuk bagian Latar belakang,
      // dan Solusi "dipermewah". Sebelumnya di bagian Latar belakang cuma tiga
      // baris masalah yang bergerak; judul, paragraf pembuka, garis pengantar,
      // dan panel penutupnya sudah berdiri diam sebelum orang sampai.
      //
      // YANG MEMBUATNYA TERBACA MEWAH, dan tidak satu pun berupa efek tambahan:
      //
      //   1. KURVA. `expo.out` - berangkat cepat, lalu mendarat sangat panjang.
      //      Benda murah berhenti mendadak; benda mahal melambat lama.
      //   2. TOPENG. Kata dan baris naik dari balik tepi yang tidak terlihat,
      //      bukan memudar di tempat. Mata membacanya sebagai huruf yang
      //      DIBUKA, seperti cetakan yang diangkat dari kertasnya.
      //   3. URUTAN. Tidak ada dua benda yang tiba bersamaan: garis dulu, label,
      //      judul kata demi kata, lalu paragrafnya baris demi baris.
      //
      // Semua gerak tetap HANYA `transform`, `opacity`, dan `clip-path` - kepala
      // berkas ini. Dan semuanya SEKALI JALAN: tidak ada scrub, jadi tidak ada
      // yang dilukis ulang tiap bingkai selama orang menggulir.
      const MEWAH = 'expo.out'

      /**
       * Kata atau baris yang naik dari balik topengnya sendiri.
       *
       * `autoSplit` + tween yang DIKEMBALIKAN dari `onSplit`: saat font selesai
       * dimuat atau lebar berubah, SplitText memecah ulang dan GSAP memutar
       * ulang tween-nya pada potongan yang baru - bukan menganimasikan baris
       * lama yang sudah tidak ada di DOM.
       */
      const pecahNaik = (pilih: string, jenis: 'words' | 'lines', mulai: string) => {
        gsap.utils.toArray<HTMLElement>(pilih).forEach((el) => {
          const jeda = Number(el.dataset.jeda ?? 0)
          const pecah = SplitText.create(el, {
            type: jenis,
            mask: jenis,
            // Kelas dipasang supaya TOPENGNYA bisa diberi ruang di index.css
            // (`.g-kata-mask`, `.g-pecah-mask`): topeng setinggi kotak baris
            // memotong ekor huruf p, y, g - "profitable" kehilangan kakinya.
            wordsClass: 'g-kata',
            linesClass: 'g-pecah',
            autoSplit: true,
            onSplit: (diri) =>
              gsap.from(jenis === 'words' ? diri.words : diri.lines, {
                yPercent: jenis === 'words' ? 118 : 110,
                // Kata-kata judul sedikit MIRING lalu tegak saat mendarat -
                // dua derajat, cukup untuk terasa seperti huruf yang diletakkan,
                // tidak cukup untuk terbaca sebagai huruf yang jatuh.
                rotate: jenis === 'words' ? 2.5 : 0,
                transformOrigin: '0% 100%',
                opacity: 0,
                duration: jenis === 'words' ? 1.3 : 1.15,
                stagger: jenis === 'words' ? 0.055 : 0.09,
                delay: jeda,
                ease: MEWAH,
                scrollTrigger: { scroller, trigger: el, start: mulai },
              }),
          })
          pembersih.push(() => pecah.revert())
        })
      }
      pecahNaik('.g-pecah-kata', 'words', 'top 86%')
      pecahNaik('.g-pecah-baris', 'lines', 'top 88%')

      // Label kecil yang tersapu terbuka. Dari kiri untuk yang rata kiri, dari
      // TENGAH untuk yang rata tengah - label di tengah yang tersapu dari kiri
      // terlihat seperti kalimat yang sedang diketik, bukan yang dibuka.
      gsap.utils.toArray<HTMLElement>('.g-sapu-kiri, .g-sapu-tengah').forEach((el) => {
        gsap.fromTo(
          el,
          { clipPath: el.classList.contains('g-sapu-tengah') ? 'inset(0% 50% 0% 50%)' : 'inset(0% 100% 0% 0%)' },
          {
            clipPath: 'inset(0% 0% 0% 0%)',
            duration: 1.1,
            ease: 'expo.inOut',
            scrollTrigger: { scroller, trigger: el, start: 'top 90%' },
          },
        )
      })

      // Garis rambut yang TUMBUH, mendatar dan tegak. Satu-satunya benda yang
      // bergerak pelan-cepat-pelan (`inOut`): garis yang melesat lalu mengerem
      // terbaca sebagai benda yang ditarik, bukan dilempar.
      gsap.utils.toArray<HTMLElement>('.g-garis-tumbuh').forEach((el) => {
        gsap.from(el, {
          scaleX: 0,
          duration: 1.6,
          ease: 'expo.inOut',
          scrollTrigger: { scroller, trigger: el, start: 'top 90%' },
        })
      })
      gsap.utils.toArray<HTMLElement>('.g-garis-tegak').forEach((el) => {
        gsap.from(el, {
          scaleY: 0,
          duration: 1.3,
          ease: 'expo.inOut',
          scrollTrigger: { scroller, trigger: el, start: 'top 85%' },
        })
      })

      // --- BERGANTIAN: tiga masalah, satu per satu -------------------------
      //
      // Tiap baris masuk DARI SISI GAMBARNYA, dan sisinya berselang - jadi
      // arah masuknya sendiri yang memberi tahu bahwa ini masalah berikutnya,
      // bukan lanjutan dari yang barusan.
      //
      // Pelatnya kini TERBUKA seperti tirai dari sisinya (clip-path), bukan
      // cuma meluncur sambil memudar, dan gambar di dalamnya mendarat dari
      // sedikit lebih besar - dua gerak yang berlawanan arah, jadi yang
      // terbaca adalah JENDELA yang dibuka, bukan kartu yang digeser.
      //
      // TANPA hanyut pada pelatnya, dan itu keputusan yang diukur, bukan selera.
      //
      // Versi pertama menghanyutkan pelat 3,5% naik-turun sepanjang barisnya
      // lewat. Terlihat bagus, dan mahal: pelat itu berlatar dua gradien
      // bergaris seperti kertas milimeter, dan menggesernya tiap bingkai
      // memaksa seluruh latar itu DILUKIS ULANG bersama SVG di atasnya.
      // Terukur di build produksi, gulir sungguhan 55px/bingkai: bingkai median
      // 48,2 ms dengan hanyut, 40,4 ms tanpa - hampir seluruh ongkos tiga
      // pelat ini ada di sana, untuk gerakan setinggi sepuluh piksel. Tween
      // sekali jalan di bawah ini tidak membayar ongkos itu: ia selesai dalam
      // satu setengah detik dan tidak disetir gulir.
      gsap.utils.toArray<HTMLElement>('.g-mas-baris').forEach((el) => {
        const kiri = el.dataset.sisi === 'kiri'
        const panggung = el.querySelector('.g-mas-panggung')
        const plat = el.querySelector('.g-mas-plat')
        const gambar = plat?.querySelector('svg')
        const tanda = el.querySelector('.g-mas-tanda')
        const kepala = el.querySelector('.g-mas-kepala')
        const isi = el.querySelector('.g-mas-isi')
        const tl = gsap.timeline({ scrollTrigger: { scroller, trigger: el, start: 'top 80%' } })
        if (plat) {
          tl.fromTo(
            plat,
            { clipPath: kiri ? 'inset(0% 100% 0% 0% round 18px)' : 'inset(0% 0% 0% 100% round 18px)' },
            {
              clipPath: 'inset(0% 0% 0% 0% round 18px)',
              duration: 1.35,
              ease: 'expo.inOut',
              // Dicabut sesudah selesai: `inset(0)` tetap memotong apa pun yang
              // keluar sepiksel dari tepinya, termasuk bayangan yang nanti
              // ditambahkan siapa pun ke pelat ini.
              clearProps: 'clipPath',
            },
            0,
          )
        }
        if (panggung) {
          tl.from(
            panggung,
            lebarBesar ? { x: kiri ? -36 : 36, duration: 1.5, ease: MEWAH } : { y: 30, duration: 1.3, ease: MEWAH },
            0,
          )
        }
        if (gambar) tl.from(gambar, { scale: 1.12, opacity: 0, duration: 1.6, ease: MEWAH }, 0.35)
        if (tanda) {
          tl.fromTo(
            tanda,
            { clipPath: 'inset(0% 100% 0% 0%)' },
            { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.9, ease: 'expo.inOut' },
            0.3,
          )
        }
        if (kepala) tl.from(kepala, { y: 34, opacity: 0, duration: 1.2, ease: MEWAH }, 0.45)
        if (isi) tl.from(isi, { y: 24, opacity: 0, duration: 1.2, ease: MEWAH }, 0.6)
      })

      // Panel "satu kawasan, dua cara melihat" menutup bagian: TERBUKA DARI
      // BAWAH, dan naik sedikit - satu-satunya benda di bagian ini yang dibuka
      // ke atas, karena ia satu-satunya yang merangkum, bukan menambah.
      gsap.utils.toArray<HTMLElement>('.g-mas-kontras').forEach((el) => {
        gsap.fromTo(
          el,
          { clipPath: 'inset(100% 0% 0% 0% round 22px)', y: 46 },
          {
            clipPath: 'inset(0% 0% 0% 0% round 22px)',
            y: 0,
            duration: 1.5,
            ease: 'expo.out',
            clearProps: 'clipPath',
            scrollTrigger: { scroller, trigger: el, start: 'top 84%' },
          },
        )
      })

      // --- SOLUSI: kartu TERBUKA dari tengah susunan, petanya MENDARAT -------
      //
      // Tiga gerak per kartu, berundak, dan ketiganya berbeda jenis:
      //   bingkai  terbuka dari potongan yang lebih kecil ke ukuran penuhnya
      //   peta     mendarat dari perbesaran 1,3x - seperti kamera yang turun
      //   kata     naik sesudah bingkainya cukup lebar untuk menampungnya
      // lalu satu kilau menyapu permukaannya SEKALI.
      //
      // Undakannya dari TENGAH susunan ke tepinya (`from: 'center'`), sama
      // dengan heksagon yang mekar dari pusat kawasan di peta sungguhan.
      const bento = gsap.utils.toArray<HTMLElement>('.g-bento')
      if (bento.length) {
        const undak = { each: 0.09, from: 'center', grid: 'auto' } as const
        const tl = gsap.timeline({ scrollTrigger: { scroller, trigger: '.g-bento-grid', start: 'top 80%' } })
        tl.fromTo(
          bento,
          { clipPath: 'inset(9% 7% 9% 7% round 16px)', y: 70, opacity: 0 },
          {
            clipPath: 'inset(0% 0% 0% 0% round 16px)',
            y: 0,
            opacity: 1,
            duration: 1.45,
            ease: MEWAH,
            stagger: undak,
            // Tanpa dicabut, `inset(0)` memotong cincin 1 px yang dipasang
            // `:hover` di luar tepi kartu - kartunya kehilangan sorotnya.
            clearProps: 'clipPath',
          },
          0,
        )
        const dalam = (pilih: string) => bento.flatMap((b) => Array.from(b.querySelectorAll<HTMLElement>(pilih)))
        tl.from(dalam('.g-bento-masuk'), { scale: 1.3, duration: 2, ease: MEWAH, stagger: undak }, 0.05)
        tl.from(
          dalam('.g-bento-teks > *'),
          { y: 22, opacity: 0, duration: 1.1, ease: MEWAH, stagger: { each: 0.05, from: 'start' } },
          0.3,
        )
        tl.fromTo(
          dalam('.g-bento-kilau'),
          { xPercent: -120, opacity: 0 },
          {
            keyframes: [
              { opacity: 1, duration: 0.25 },
              { xPercent: 260, duration: 1.1 },
              { opacity: 0, duration: 0.3 },
            ],
            ease: 'power2.inOut',
            stagger: undak,
          },
          0.55,
        )
        tl.from('.g-bento-catatan', { y: 16, opacity: 0, duration: 1.1, ease: MEWAH }, 0.9)
      }

      // --- MERANGKAI: ekosistem ---------------------------------------------
      //
      // Judulnya memakai kedua gerakan yang dulu membuka bagian MASALAH -
      // tirai clip-path dan baris yang naik dari balik topeng. Dipindahkan ke
      // sini atas permintaan pemilik repo: bagian pertama sesudah hero tidak
      // butuh gerakan tambahan, bagian keempat butuh sesuatu yang menandai
      // bahwa ceritanya berganti babak.
      gsap.utils.toArray<HTMLElement>('.g-tirai').forEach((el) => {
        gsap.from(el, {
          clipPath: 'inset(100% 0% 0% 0%)',
          y: 28,
          duration: 1,
          ease: 'power4.out',
          scrollTrigger: { scroller, trigger: el, start: 'top 88%' },
        })
      })
      gsap.utils.toArray<HTMLElement>('.g-baris').forEach((el) => {
        const pecah = SplitText.create(el, {
          type: 'lines',
          mask: 'lines',
          autoSplit: true,
          onSplit: (diri) =>
            gsap.from(diri.lines, {
              yPercent: 118,
              opacity: 0,
              duration: 1,
              stagger: 0.085,
              ease: 'power4.out',
              scrollTrigger: { scroller, trigger: el, start: 'top 86%' },
            }),
        })
        pembersih.push(() => pecah.revert())
      })

      // Tulang punggung TUMBUH mengikuti gulir. `scaleY` dengan titik asal di
      // atas - bukan `height`, yang memaksa tata letak dihitung ulang tiap
      // bingkai untuk garis selebar satu piksel.
      gsap.fromTo(
        '.g-eko-tulang-isi',
        { scaleY: 0 },
        {
          scaleY: 1,
          ease: 'none',
          scrollTrigger: {
            scroller,
            trigger: '.g-eko-alur',
            start: 'top 62%',
            end: 'bottom 72%',
            scrub: 0.5,
          },
        },
      )

      // Tiap baris masuk DARI SISINYA sendiri. Itu yang membuat zig-zagnya
      // terasa sebagai jalur, bukan sebagai dua kolom yang kebetulan berselang.
      //
      // GESERAN MENDATARNYA HANYA DI LAYAR LEBAR, dan itu bukan selera. Di
      // bawah `lg` barisnya satu kolom - tidak ada kiri dan kanan untuk
      // dimasuki - dan yang lebih menentukan: elemen yang PARKIR di keadaan
      // awalnya (`x: 54`) sebelum pemicunya sampai benar-benar berdiri 54 px di
      // luar wadahnya. Terukur di 390 px: halaman jadi bisa digulir MENDATAR
      // sampai 420 px, persis gejala yang dilarang B.6. Di layar sempit
      // gerakannya jadi tegak, yang tidak pernah menambah lebar.
      gsap.utils.toArray<HTMLElement>('.g-eko-baris').forEach((el) => {
        const kiri = el.dataset.sisi === 'kiri'
        const media = el.querySelector('.g-eko-media')
        const kata = el.querySelector('.g-eko-kata')
        const simpul = el.querySelector('.g-eko-simpul')
        const lengan = el.querySelector('.g-eko-lengan')
        const tl = gsap.timeline({
          scrollTrigger: { scroller, trigger: el, start: 'top 82%' },
        })
        if (media) {
          tl.from(
            media,
            lebarBesar
              ? { x: kiri ? -54 : 54, opacity: 0, duration: 0.95, ease: 'power3.out' }
              : { y: 34, opacity: 0, duration: 0.9, ease: 'power3.out' },
            0,
          )
        }
        if (kata) tl.from(kata, { y: 26, opacity: 0, duration: 0.85, ease: 'power3.out' }, 0.12)
        if (lengan) tl.from(lengan, { scaleX: 0, duration: 0.5, ease: 'power2.out' }, 0.2)
        if (simpul) tl.from(simpul, { scale: 0, opacity: 0, duration: 0.5, ease: 'back.out(2.2)' }, 0.28)
      })

      // --- TENGGELAM: nama raksasa di penutup -------------------------------
      gsap.fromTo(
        '.g-raksasa',
        { yPercent: 14 },
        {
          yPercent: -6,
          ease: 'none',
          scrollTrigger: { scroller, trigger: '.g-penutup', start: 'top bottom', end: 'bottom bottom', scrub: 1 },
        },
      )

      // --- JURANG ------------------------------------------------------------
      gsap.fromTo(
        '.g-gelap',
        { opacity: 0 },
        {
          opacity: 1,
          ease: 'none',
          scrollTrigger: { scroller, trigger: '.g-jurang', start: 'top bottom', end: 'top 8%', scrub: 0.6 },
        },
      )
      gsap.fromTo(
        '.g-terowongan',
        { scale: 0.35, opacity: 0, rotate: 0 },
        {
          scale: 6,
          opacity: 0.32,
          rotate: 26,
          ease: 'none',
          scrollTrigger: { scroller, trigger: '.g-jurang', start: 'top bottom', end: 'top -15%', scrub: 0.7 },
        },
      )
      gsap.to('.g-turun', {
        y: -70,
        opacity: 0,
        ease: 'none',
        scrollTrigger: { scroller, trigger: '.g-jurang', start: 'top 40%', end: 'top -18%', scrub: 0.4 },
      })
      // `top 14%`, bukan `top 34%`.
      //
      // Ambangnya setinggi 46vh (52vh di halaman terang) dan berakhir TEPAT di
      // atas `.g-jurang`, jadi saat puncak jurang berada 34% dari atas layar,
      // bilah atas masih berdiri di sepertiga pertama gradien itu - tempat
      // alfanya belum 0,05. Bilahnya tetap berbahan terang di atas latar yang
      // sudah nyaris hitam, dan tulisan "Loconomics" hilang ke dalamnya.
      // Terlihat di potret mode terang, dan sudah ada sejak ambangnya
      // ditinggikan.
      //
      // 14% menaruh bilah itu di sekitar 85% gradien - tempat alfanya sudah
      // melewati 0,7 - dan angka yang sama bekerja untuk kedua tinggi ambang.
      ScrollTrigger.create({
        scroller,
        trigger: '.g-jurang',
        start: 'top 14%',
        end: 'bottom top',
        onEnter: () => setNavGelap(true),
        onEnterBack: () => setNavGelap(true),
        onLeaveBack: () => setNavGelap(false),
      })
      gsap.utils.toArray<HTMLElement>('.g-orang').forEach((el, i) => {
        gsap.from(el, {
          y: 80,
          opacity: 0,
          rotateX: 24,
          duration: 0.95,
          delay: (i % 3) * 0.08,
          ease: 'power3.out',
          scrollTrigger: { scroller, trigger: el, start: 'top 92%' },
        })
      })
    }, scroller)

    // Animasi CSS di bagian yang tidak terlihat DIHENTIKAN lewat atribut yang
    // dibaca index.css. IntersectionObserver, bukan ScrollTrigger tambahan.
    const pengamat = new IntersectionObserver(
      (masuk) => {
        for (const e of masuk) {
          const el = e.target as HTMLElement
          if (e.isIntersecting) delete el.dataset.diam
          else el.dataset.diam = '1'
        }
      },
      { root: akar.current, rootMargin: '15% 0px' },
    )
    akar.current?.querySelectorAll('section').forEach((s) => pengamat.observe(s))

    // Kartu dek memotret dirinya asinkron; dua penyegaran lebih murah daripada
    // menebak urutannya.
    const jam1 = window.setTimeout(() => ScrollTrigger.refresh(), 1400)
    const jam2 = window.setTimeout(() => ScrollTrigger.refresh(), 4200)

    return () => {
      pengamat.disconnect()
      clearTimeout(jam1)
      clearTimeout(jam2)
      pembersih.forEach((f) => f())
      ctx.revert()
    }
    // Bahasa ikut jadi dep: pergantian bahasa menulis ulang setiap judul, dan
    // SplitText harus memecah teks yang baru - bukan memegang baris yang lama.
  }, [gerakMati, bahasa])

  /**
   * `sorot` menentukan tombol ini BERPENDAR atau tidak.
   *
   * Di bilah atas ia berpendar hanya untuk yang SUDAH masuk. Sebelum itu yang
   * berpendar "Daftar" - permintaan pemilik repo, 11 Sep 2026, membalik
   * keputusan 9 Sep: "saya gamau button itu di highlight kalau belum sign up".
   * Alasannya masuk akal dan bukan selera: peta bisa dibuka siapa pun, jadi
   * mengarahkan mata ke sana lebih dulu berarti menunda satu-satunya langkah
   * yang benar-benar mengubah apa yang akan ia lihat di sana.
   *
   * Di HERO tombolnya tetap berpendar apa pun keadaannya - di sana tidak ada
   * tombol daftar untuk berebut perhatian, dan hero tanpa satu ajakan yang
   * jelas adalah hero tanpa ajakan.
   */
  const { akun } = useSesi()

  const tombolMasuk = (kelas: string, ukuran: 'kecil' | 'besar', sorot = true) => (
    <Magnet
      onClick={() => onMasuk()}
      kelas={
        sorot
          ? `g-catalyst group inline-flex cursor-pointer items-center gap-3 rounded-full font-semibold ${kelas}`
          : `g-pil inline-flex cursor-pointer items-center gap-3 rounded-full font-semibold text-[color:var(--g-ink)] ${kelas}`
      }
      anak={
        <>
          <span
            className={`${sorot ? 'g-catalyst-teks' : ''} ${
              ukuran === 'besar' ? 'text-[15px]' : 'text-[14.5px]'
            }`}
          >
            {teks.masuk}
          </span>
          {ukuran === 'besar' && <PanahKanan />}
        </>
      }
    />
  )

  return (
    <div
      ref={akar}
      data-tema={tema}
      className="gerbang fixed inset-0 z-[70] overflow-y-auto overflow-x-hidden text-[color:var(--g-ink)]"
    >
      {/* --- Bilah atas yang ikut menempel ---------------------------------
          `sticky`, bukan `fixed`: `fixed` di dalam wadah yang punya
          backdrop-filter di salah satu leluhurnya adalah jebakan yang sudah
          pernah kena di repo ini. */}
      {/* DIPERBESAR 11 Sep 2026, permintaan pemilik repo ("perbesar gitu nah
          bar atas nya, biar bagus"). Tingginya naik dari ~54 px ke ~66 px, dan
          lebarnya ikut kisi bento di bawahnya (76rem) - bilah yang lebih sempit
          daripada isi halamannya terbaca sebagai benda yang mengambang di luar
          susunan. Tanda heksagon di depan nama bukan hiasan: itu satuan data
          produk ini, bentuk yang sama dengan simpul tulang punggung Ekosistem.

          Tinggi bilah + jarak atasnya = `-mt-[5.4rem]` di hero. Keduanya WAJIB
          berubah bersama: kalau tidak, hero berhenti tepat di bawah bilah dan
          sarang heksagonnya meninggalkan pita polos di atasnya. */}
      <div className="sticky top-0 z-50 px-4 pt-4 sm:px-6 sm:pt-5">
        <nav
          className={`mx-auto flex max-w-[76rem] items-center gap-2 rounded-full py-2 pl-5 pr-2 transition-colors duration-500 ease-liquid sm:gap-3 sm:py-2.5 sm:pl-7 sm:pr-2.5 ${
            navGelap ? 'g-nav-gelap' : 'g-nav'
          }`}
        >
          {/* Nama di bilah ini papan nama yang SAMA dengan bilah peta - tiap
              huruf yang tersentuh melenting lalu mengambil warnanya sendiri.
              Dulu teks polos, dan dilaporkan pemilik repo: "ga ada interaktif/
              bergetar/berwarna ... ga kayak yang pas masuk di maps". Komponennya
              dipakai apa adanya, bukan ditiru, supaya tempo getar dan lunturnya
              tidak pernah berpisah dari yang di peta.

              `sebagai="span"` karena ia duduk di dalam tombol, dan `aria-label`
              di tombolnya karena hurufnya disembunyikan dari pembaca layar. */}
          <button
            onClick={keAtas}
            aria-label={IDENTITAS.produk}
            className={`flex shrink-0 cursor-pointer items-center gap-2.5 ${navGelap ? 'text-white' : ''}`}
          >
            <svg viewBox="-50 -55 100 110" className="h-[18px] w-[16px] sm:h-5 sm:w-[18px]" aria-hidden>
              <polygon
                points={jalurHeks(44)}
                fill="none"
                stroke={navGelap ? '#7cf7dd' : 'var(--g-teal)'}
                strokeWidth="11"
                strokeLinejoin="round"
              />
              <circle r="11" fill={navGelap ? '#7cf7dd' : 'var(--g-teal)'} />
            </svg>
            <PapanNama
              teks={IDENTITAS.produk}
              sebagai="span"
              kelas="text-[16px] tracking-[0.02em] sm:text-[18px]"
            />
          </button>
          {/* Di bawah `sm` tombol "Masuk ke peta" di bilah ini disembunyikan:
              terukur di 390px, isi bilahnya 442px di dalam bilah selebar 358px
              dan halaman jadi bisa digulir MENDATAR - tanpa tombol itu 297px.
              (Diukur ulang 11 Sep 2026 sesudah sakelar bahasa pindah ke menu
              pengaturan; angka lamanya 445px.) Yang disembunyikan yang paling
              tidak dibutuhkan di sini - tombol yang sama berdiri dua kali lebih
              besar tepat di bawahnya, di hero. */}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {/* Bahasa DAN tema tinggal di menu pengaturan, bukan berdiri di
                bilah ini dan di hero - permintaan pemilik repo, 11 Sep 2026:
                "dimasukkan ke dalam tombol setting gitu nah kayak di maps".
                Menunya komponen yang SAMA dengan bilah peta: dua menu yang
                ditulis dua kali adalah dua menu yang suatu saat berbeda isi.
                Yang tidak ikut cuma "Nama tempat" - itu setelan basemap, dan
                halaman ini tidak punya basemap. */}
            <MenuPengaturan varian="gerbang" />
            <TombolAkun varian="gerbang" />
            <span className="hidden sm:inline-flex">
              {tombolMasuk('px-5 py-2.5', 'kecil', Boolean(akun))}
            </span>
          </div>
        </nav>
      </div>

      {/* ================= 1 · HERO (dipatok) ============================= */}
      <section
        id="hero"
        className="g-hero sticky top-0 z-0 -mt-[4.5rem] flex min-h-[100svh] flex-col items-center justify-center overflow-hidden px-6 pb-16 pt-24 text-center sm:-mt-[5.4rem]"
      >
        <LatarHero />
        <div
          className="pointer-events-none absolute left-1/2 top-[calc(100%-120px)] -z-10 h-[420px] w-[150%] -translate-x-1/2 rounded-[100%] bg-[radial-gradient(closest-side,var(--g-elips)_78%,transparent)] opacity-80"
          aria-hidden
        />

        <div className="g-hero-isi flex flex-col items-center">
          <PapanNama
            teks={NAMA}
            kelas="g-judul select-none whitespace-nowrap text-[clamp(2.1rem,9.4vw,6.4rem)] leading-[1.02] tracking-[-0.015em]"
          />

          <p className="g-masuk-awal mx-auto mt-6 max-w-[34rem] text-[clamp(1rem,1.7vw,1.2rem)] leading-relaxed text-[color:var(--g-ink-2)]">
            {teks.hero.isi}
          </p>

          <div className="g-masuk-awal mt-9 flex flex-wrap items-center justify-center gap-3">
            {tombolMasuk('px-8 py-4', 'besar')}
            <Magnet
              onClick={() => keBagian('solusi')}
              kekuatan={0.22}
              kelas="g-pil cursor-pointer rounded-full px-7 py-4 text-[15px] font-semibold text-[color:var(--g-ink)]"
              anak={teks.lihatSolusi}
            />
          </div>

          {/* TANPA `transition-opacity`. GSAP menganimasikan opacity tombol ini
              saat masuk, dan transisi CSS pada properti yang sama membuat nilai
              terhitungnya tertinggal di belakang nilai inline - `gsap.from`
              lalu merekam nilai tertinggal itu (nol) sebagai tujuan tweennya.
              Terukur: tombol ini diam di opacity 0 selamanya, tanpa galat. */}
          <button
            onClick={() => keBagian('masalah')}
            className="g-masuk-awal mt-16 flex cursor-pointer items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[color:var(--g-ink-4)] transition-colors hover:text-[color:var(--g-ink-2)]"
          >
            <span className="g-panah inline-block">↓</span> {teks.gulir}
          </button>
        </div>
      </section>

      {/* Pembungkus yang MENUTUP hero. Latarnya pekat: yang di bawahnya harus
          benar-benar tertutup, bukan tembus. */}
      <div className="g-tutup relative z-10">
        {/* --- JARAK SENGAJA antara hero dan latar belakang -------------
            Bukan ruang yang lupa diisi. Hero-nya dipatok dan menyusut di
            baliknya; tanpa jeda ini judul bagian berikutnya sudah menutupinya
            sebelum gerakan itu sempat terbaca sebagai gerakan.

            Yang berdiri di sini cuma satu garis rambut yang TUMBUH mengikuti
            gulir, dan sebuah heksagon di ujungnya. Satu benda, satu gerakan -
            jeda yang diisi lebih dari itu berhenti jadi jeda. */}
        <div className="g-jeda relative flex min-h-[58vh] items-end justify-center px-6 pb-2 sm:min-h-[68vh]">
          <span className="relative block h-[30vh] w-px" aria-hidden>
            <span className="g-jeda-rel absolute inset-0 block" />
            <span className="g-jeda-isi absolute inset-0 block origin-top" />
            <span className="g-jeda-heks absolute -bottom-[10px] left-1/2 block h-[20px] w-[18px] -translate-x-1/2">
              <svg viewBox="-50 -55 100 110" className="h-full w-full">
                <polygon
                  points={jalurHeks(46)}
                  fill="var(--g-latar-pekat)"
                  stroke="var(--g-teal)"
                  strokeWidth="9"
                />
              </svg>
            </span>
          </span>
        </div>

        {/* ================= 2 · MASALAH ==================================
            SATU bagian, satu judul, TIGA masalah yang dijelaskan satu per satu.

            Dirombak 11 Sep 2026. Sebelumnya ketiganya berdiri sebagai tiga
            baris daftar bergaris rambut di kolom kiri, dan gambarnya satu untuk
            ketiganya di kolom kanan - jadi tidak ada satu pun masalah yang
            benar-benar punya gambarnya sendiri, dan pembacanya harus memutuskan
            sendiri gambar itu menerangkan yang mana.

            Sekarang tiap masalah punya barisnya sendiri, gambarnya sendiri, dan
            gilirannya sendiri saat digulir - berselang kiri-kanan, jadi mata
            berhenti tiga kali alih-alih sekali.

            BEDANYA DENGAN EKOSISTEM di bawah, dan bedanya harus terbaca tanpa
            membaca judul: Ekosistem memakai tulang punggung di tengah, simpul
            heksagon, dan FOTO peta dalam bingkai membulat. Di sini tidak ada
            tulang punggung sama sekali, dan gambarnya PELAT ALAT UKUR - siku di
            sudut, garis tipis, label huruf mono. Satu bagian menunjukkan produk;
            yang ini menerangkan keadaan sebelum produknya ada. */}
        <section id="masalah" className="g-latar-titik relative overflow-hidden px-6 pb-40 pt-20 sm:pb-52 sm:pt-28">
          <div className="mx-auto w-full max-w-[74rem]">
            {/* Pembuka EDITORIAL: judul kiri, paragraf kanan. Ekosistem membuka
                di tengah; dua bagian berurutan yang membuka dengan susunan yang
                sama terbaca sebagai satu bagian yang panjang. */}
            <div className="g-mas-buka grid gap-x-14 gap-y-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-end">
              <div>
                <p className="g-sapu-kiri eyebrow mb-5 text-[color:var(--g-ink-3)]">{teks.masalah.eyebrow}</p>
                <h2 className="g-pecah-kata judul-bagian text-[clamp(2rem,4.6vw,3.4rem)]">{teks.masalah.judul}</h2>
              </div>
              <p
                data-jeda="0.3"
                className="g-pecah-baris max-w-[34rem] text-[15.5px] leading-relaxed text-[color:var(--g-ink-2)] lg:pb-2"
              >
                {teks.masalah.isi}
              </p>
            </div>

            {/* Pengantar ke ketiga baris. Garis rambut penuh lebar sebagai
                batas - bukan judul kedua, yang akan jadi tesis kedua untuk satu
                gagasan (kesalahan yang persis pernah dibuat halaman ini).

                Garisnya ELEMEN, bukan `border-top`: border tidak bisa tumbuh,
                dan yang diminta di bagian ini justru setiap bendanya punya
                kemunculannya sendiri. */}
            <div className="g-mas-antar relative mt-14 flex items-center gap-4 pt-5 sm:mt-20">
              <span
                className="g-garis-tumbuh absolute inset-x-0 top-0 block h-px origin-left bg-[color:var(--g-garis-halus-2)]"
                aria-hidden
              />
              <span className="g-sapu-kiri eyebrow text-[color:var(--g-ink-4)]">{teks.masalah.antar}</span>
            </div>

            {/* Tiga baris, berselang kiri-kanan. */}
            <div className="g-mas-alur">
              {teks.masalah.poin.map((butir, i) => {
                const kiri = i % 2 === 0
                return (
                  <div
                    key={butir.kepala}
                    data-sisi={kiri ? 'kiri' : 'kanan'}
                    className="g-mas-baris relative grid items-center gap-8 py-10 sm:py-12 lg:grid-cols-2 lg:gap-16 lg:py-16"
                  >
                    <figure className={`g-mas-panggung relative ${kiri ? 'lg:order-1' : 'lg:order-2'}`}>
                      <PelatMasalah i={i} t={teks.masalah.alat} />
                    </figure>
                    <div className={`g-mas-kata ${kiri ? 'lg:order-2 lg:pl-6' : 'lg:order-1 lg:pr-6'}`}>
                      <p className="g-mas-tanda eyebrow mb-3 text-[color:var(--g-ink-4)]">{butir.tanda}</p>
                      <h3 className="g-mas-kepala judul-anak text-[clamp(1.22rem,2.1vw,1.7rem)] leading-tight text-[color:var(--g-ink)]">
                        {butir.kepala}
                      </h3>
                      <p className="g-mas-isi mt-3.5 max-w-[30rem] text-[14.5px] leading-relaxed text-[color:var(--g-ink-2)]">
                        {butir.isi}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Ketiganya bertemu di sini: satu kawasan, dilihat dua cara.
                Panel ini yang menutup bagian, dan kalimat penutupnya berdiri di
                sebelahnya - bukan di bawah seluruh halaman, tempat ia kehilangan
                gambar yang seharusnya membuktikannya. */}
            {/* Panel di KANAN, kalimat di kiri - dan urutannya penting.
                Ketiga baris di atas menaruh gambarnya kiri, kanan, kiri; baris
                penutup ini semula menaruh panelnya di kiri lagi, jadi dua baris
                berturut-turut punya susunan yang sama dan zig-zagnya patah
                persis di baris terakhir. Dilaporkan pemilik repo: "biar kanan
                kiri kanan kiri gitu nah".

                `lg:order-*`, bukan urutan DOM yang dibalik: yang dibaca pembaca
                layar dan yang dibaca mata boleh berbeda, dan di layar sempit
                gambarnya memang harus datang lebih dulu seperti tiga baris di
                atasnya. */}
            <div className="g-mas-tutup relative mt-8 grid items-center gap-10 pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] lg:gap-14 sm:mt-12">
              <span
                className="g-garis-tumbuh absolute inset-x-0 top-0 block h-px origin-left bg-[color:var(--g-garis-halus-2)]"
                aria-hidden
              />
              <div className="g-mas-panggung g-mas-kontras lg:order-2">
                <KontrasKawasan />
              </div>
              {/* Aksen kiri juga ELEMEN, bukan `border-l`, dengan alasan yang
                  sama dengan garis di atas: ia tumbuh dari atas ke bawah
                  sebelum kalimatnya naik. */}
              <div className="relative max-w-[32rem] pl-6 lg:order-1">
                <span
                  className="g-garis-tegak absolute inset-y-0 left-0 block w-[2px] origin-top rounded-full bg-[color:var(--g-teal)]/45"
                  aria-hidden
                />
                <p
                  data-jeda="0.35"
                  className="g-pecah-baris text-[clamp(1rem,1.6vw,1.2rem)] leading-relaxed text-[color:var(--g-ink)]"
                >
                  {teks.masalah.penutup}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ================= 3 · SOLUSI ================================== */}
        {/* Latarnya TANDA SILANG berkisi - tanda registrasi lembar peta cetak,
            tempat dua garis koordinat bertemu. Bagian ini berisi enam potret
            peta, dan latar yang menyatakan "ini lembar peta" tanpa satu garis
            jalan pun tidak berebut perhatian dengan peta sungguhan di atasnya.
            Lihat `.g-latar-silang` di index.css. */}
        <section id="solusi" className="g-latar-silang relative px-6 py-40 sm:py-52">
          <div className="mx-auto mb-12 max-w-[48rem] text-center">
            <p className="g-sapu-tengah eyebrow mb-4 text-[color:var(--g-ink-3)]">{teks.solusi.eyebrow}</p>
            <h2 className="g-pecah-kata judul-bagian text-[clamp(1.5rem,2.8vw,2.35rem)]">{teks.solusi.judul}</h2>
            <p
              data-jeda="0.35"
              className="g-pecah-baris mx-auto mt-4 max-w-[38rem] text-[14.5px] leading-relaxed text-[color:var(--g-ink-2)]"
            >
              {teks.solusi.isi}
            </p>
          </div>

          <BentoKeputusan onBuka={onMasuk} />

          <p className="g-bento-catatan mx-auto mt-9 max-w-[44rem] text-center text-[11.5px] leading-snug text-[color:var(--g-ink-4)]">
            {teks.solusi.catatan}
          </p>
        </section>

        {/* ================= 4 · EKOSISTEM (zig-zag) ===================== */}
        <section id="ekosistem" className="g-latar-mesh relative px-6 py-40 sm:py-52">
          <div className="mx-auto mb-16 max-w-[48rem] text-center sm:mb-24">
            <p className="g-tirai eyebrow mb-4 text-[color:var(--g-ink-3)]">{teks.ekosistem.eyebrow}</p>
            <h2 className="g-baris judul-bagian text-[clamp(1.5rem,2.8vw,2.35rem)]">{teks.ekosistem.judul}</h2>
            <p className="g-tirai mx-auto mt-4 max-w-[36rem] text-[14.5px] leading-relaxed text-[color:var(--g-ink-2)]">
              {teks.ekosistem.isi}
            </p>
          </div>

          {/* Tulang punggung + enam baris berselang-seling. Garis tegaknya
              berdiri di lorong antara kedua kolom, jadi ia sama benarnya untuk
              baris yang gambarnya di kiri maupun di kanan. Di bawah `lg`
              seluruh rangkaiannya disembunyikan: satu kolom tidak punya lorong,
              dan garis yang menempel di tepi cuma jadi hiasan. */}
          <div className="g-eko-alur relative mx-auto w-full max-w-[74rem]">
            <span
              className="g-eko-tulang pointer-events-none absolute inset-y-0 left-1/2 hidden w-px -translate-x-1/2 lg:block"
              aria-hidden
            >
              <span className="g-eko-tulang-isi absolute inset-0 block origin-top" />
            </span>

            {teks.ekosistem.item.map((it, i) => {
              const kiri = i % 2 === 0
              const kartu = KARTU_GERBANG[i % KARTU_GERBANG.length]
              const potret = potretUntukTema(kartu, tema)
              return (
                <div
                  key={it.nama}
                  data-sisi={kiri ? 'kiri' : 'kanan'}
                  className="g-eko-baris relative grid items-center gap-8 py-8 sm:py-10 lg:grid-cols-2 lg:gap-16 lg:py-14"
                >
                  {/* Simpul + lengan, hanya di lg ke atas. */}
                  <span
                    className={`g-eko-lengan pointer-events-none absolute top-1/2 hidden h-px w-[2.6rem] lg:block ${
                      kiri ? 'right-1/2 origin-right' : 'left-1/2 origin-left'
                    }`}
                    aria-hidden
                  />
                  <span
                    className="g-eko-simpul pointer-events-none absolute left-1/2 top-1/2 hidden h-[18px] w-[16px] -translate-x-1/2 -translate-y-1/2 lg:block"
                    aria-hidden
                  >
                    <svg viewBox="-50 -55 100 110" className="h-full w-full">
                      <polygon
                        points={jalurHeks(46)}
                        fill="var(--g-latar-pekat)"
                        stroke="var(--g-teal)"
                        strokeWidth="9"
                      />
                    </svg>
                  </span>

                  {/* MEDIA: potret peta sungguhan, diredupkan jadi konteks,
                      dengan satu panel antarmuka di depannya. */}
                  <figure className={`g-eko-media relative ${kiri ? 'lg:order-1' : 'lg:order-2'}`}>
                    <div className="g-eko-bingkai relative overflow-hidden rounded-[20px]">
                      <img
                        src={`${import.meta.env.BASE_URL}kartu/${potret.berkas}.webp`}
                        alt=""
                        aria-hidden
                        width={kartu.lebar}
                        height={kartu.tinggi}
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        // Peredupannya berbeda menurut basemap potretnya. Lima
                        // dari enam kartu dipotret di atas basemap TERANG dan
                        // satu di atas gelap; satu angka untuk keduanya membuat
                        // barisnya terbaca sebagai enam gambar dari enam tempat
                        // yang berbeda - terlihat begitu di potret, kartu kedua
                        // menyala jauh lebih terang daripada tetangganya.
                        //
                        // Pindah ke CSS 11 Sep 2026: angkanya sekarang harus
                        // bergantung pada TEMA juga, dan tema tidak bisa dibaca
                        // dari ternary di dalam `style`. `brightness(0.24)` yang
                        // benar di halaman hitam mengubah kartunya jadi lubang
                        // hitam di halaman putih.
                        data-gelap={potret.gelap ? '1' : '0'}
                        className="g-eko-gambar block h-[16rem] w-full scale-[1.06] object-cover sm:h-[18.5rem]"
                      />
                      <span className="g-eko-scrim pointer-events-none absolute inset-0" aria-hidden />
                      <div
                        className={`pointer-events-none absolute bottom-5 ${
                          kiri ? 'right-5' : 'left-5'
                        } max-w-[calc(100%-2.5rem)]`}
                      >
                        <PanelEko i={i} teks={teks.ekosistem.panel} />
                      </div>
                    </div>
                  </figure>

                  {/* KATA */}
                  <div className={`g-eko-kata ${kiri ? 'lg:order-2 lg:pl-8' : 'lg:order-1 lg:pr-8'}`}>
                    <p className="eyebrow mb-3 text-[color:var(--g-ink-4)]">{it.tanda}</p>
                    <h3 className="judul-anak text-[clamp(1.3rem,2.2vw,1.85rem)] leading-tight text-[color:var(--g-ink)]">
                      {it.nama}
                    </h3>
                    <p className="mt-3.5 max-w-[30rem] text-[14.5px] leading-relaxed text-[color:var(--g-ink-2)]">
                      {it.isi}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* ================= 5 · PENUTUP ================================= */}
        <section className="g-penutup relative overflow-hidden px-6 pb-14 pt-44">
          <div
            className="g-aurora pointer-events-none absolute left-1/2 top-1/2 h-[62vh] w-[86vw] rounded-[50%]"
            aria-hidden
          />
          <div className="g-kisi pointer-events-none absolute inset-0" aria-hidden />
          <div
            className="g-raksasa papan pointer-events-none absolute inset-x-0 bottom-0 select-none text-center"
            aria-hidden
          >
            {NAMA}
          </div>
          <div className="g-ambang pointer-events-none absolute inset-x-0 bottom-0 h-[46vh]" aria-hidden />

          <div className="relative mx-auto max-w-[46rem] text-center" style={{ perspective: 900 }}>
            <h2 className="g-tirai">
              <Teks3D teks={teks.penutup.judul} kelas="judul-bagian text-[clamp(1.8rem,4.6vw,3.2rem)] font-medium leading-tight" />
            </h2>
            <p className="g-tirai mx-auto mt-4 max-w-[34rem] text-[15px] leading-relaxed text-[color:var(--g-ink-2)]">
              {teks.penutup.isi}
            </p>
            <div className="g-tirai mt-9 flex justify-center">{tombolMasuk('px-10 py-5', 'besar')}</div>
          </div>

          {/* --- Kaki. Sumber datanya disebut di sini, apa adanya, dengan
              tautan - ini tempat paling ringkas yang tetap jujur. --------- */}
          <div className="relative mx-auto mt-24 max-w-[70rem] border-t border-[color:var(--g-ink)]/12 pt-7">
            <p className="text-center text-[11.5px] leading-relaxed text-[color:var(--g-ink-4)]">
              {teks.penutup.data}:{' '}
              {/* Hanya yang RESMI. Baris ini atribusi - ia menjawab "peta ini
                  digambar dari data siapa", dan model perkiraan tidak
                  menyumbang satu angka pun ke peta. Mencantumkannya di sini
                  akan membuat daftar atribusi berbohong ke arah yang paling
                  menguntungkan kami. Daftar LENGKAPNYA, berikut yang
                  perkiraan, ada di Pengaturan -> Sumber data. */}
              {SUMBER.filter((s) => s.jenis !== 'perkiraan').map((s, i) => (
                <span key={s.nama}>
                  {i > 0 && <span className="mx-1.5">·</span>}
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[color:var(--g-ink-3)] underline decoration-[color:var(--g-ink)]/20 underline-offset-[3px] transition-colors hover:text-[color:var(--g-ink)]"
                  >
                    {s.nama}
                  </a>
                </span>
              ))}
            </p>
            <div className="mt-6 flex flex-col items-center justify-between gap-4 sm:flex-row">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--g-ink-3)]">
                {IDENTITAS.produk} · {IDENTITAS.institusi}
              </p>
              <p className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--g-ink-4)]">{IDENTITAS.lomba}</p>
              <Magnet
                onClick={keAtas}
                label={teks.penutup.keAtas}
                kekuatan={0.4}
                kelas="g-pil grid h-11 w-11 cursor-pointer place-items-center rounded-full text-[color:var(--g-ink-2)]"
                anak={
                  <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
                    <path
                      d="M10 15.5V4.5M4.8 9.7 10 4.5l5.2 5.2"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                }
              />
            </div>
          </div>
        </section>

        {/* ================= 6 · JURANG → TIM ============================ */}
        <section id="tim" className="g-jurang relative">
          <div className="pointer-events-none sticky top-0 -mb-[100vh] h-screen overflow-hidden" aria-hidden>
            <div className="g-gelap absolute inset-0 opacity-0" />
            <svg
              className="g-terowongan absolute left-1/2 top-1/2 h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2"
              viewBox="-100 -100 200 200"
            >
              {[100, 76, 55, 38, 24, 13].map((r) => (
                <polygon
                  key={r}
                  points={jalurHeks(r)}
                  fill="none"
                  stroke="var(--g-teal-muda)"
                  strokeWidth="0.5"
                  opacity={0.5}
                />
              ))}
            </svg>
          </div>

          <div className="relative flex h-[170vh] flex-col items-center justify-center px-6 text-center">
            <p className="g-turun eyebrow mb-4 text-[color:var(--g-ink-3)]">{teks.tim.terakhir}</p>
            <p className="g-turun judul-bagian max-w-[26rem] text-[clamp(1.3rem,3.4vw,2.1rem)] leading-tight">
              {teks.tim.turun}
            </p>
            <span className="g-turun g-panah mt-6 block text-[20px] text-[color:var(--g-ink-3)]" aria-hidden>
              ↓
            </span>
          </div>

          <div className="relative px-6 pb-36">
            <div className="mx-auto max-w-[46rem] text-center">
              <p className="eyebrow mb-4 text-white/45">{teks.tim.eyebrow}</p>
              <h2 className="judul-bagian text-[clamp(1.7rem,4.2vw,2.9rem)] leading-tight text-white">{teks.tim.judul}</h2>
              <p className="mx-auto mt-3 text-[13.5px] text-white/55">{IDENTITAS.institusi}</p>
            </div>

            {/* Kartu POTRET, bukan kartu mendatar - permintaan pemilik repo:
                "cardnya itu memanjang kebawah" dan "efek background ... tiap
                orang itu beda beda". Kepala kartu adalah panggung dengan cahaya
                berwarna identitas orangnya (`rona` di config.ts) yang hanyut
                pelan di belakang terowongan heksagon - bentuk yang sama dengan
                terowongan jurang di atas, sekarang satu per orang.

                DUA LAPIS, dan pembagiannya bukan kerapian. GSAP menganimasikan
                `transform` `.g-orang` saat kartunya masuk, lalu meninggalkan
                `transform: translate(0px, 0px)` sebaris - yang mengalahkan
                `:hover` di CSS mana pun. Terukur pada kartu versi sebelumnya:
                efek angkatnya terangkat 0,00 px, tidak pernah bekerja sejak
                animasi masuk dipasang. Sekarang GSAP memegang bingkai luar,
                dan hover memegang kartu di dalamnya. */}
            <div
              className="g-tim-grid mx-auto mt-14 grid max-w-[74rem] gap-5 sm:auto-rows-fr sm:grid-cols-2 lg:grid-cols-6"
              style={{ perspective: 1400 }}
            >
              {PENDIRI.map((o, i) => (
                <article
                  key={o.peran}
                  className={`g-orang flex ${kelasSelTim(i, PENDIRI.length)}`}
                  style={{ transformStyle: 'preserve-3d' }}
                >
                  <div
                    className="g-kartu-orang group relative flex w-full flex-col overflow-hidden rounded-[24px]"
                    style={
                      { '--rona': o.rona[0], '--rona-2': o.rona[1], '--urutan': i } as CSSProperties
                    }
                  >
                    <div
                      className="g-orang-panggung relative h-52 shrink-0 overflow-hidden sm:h-60 lg:h-[18.5rem]"
                      aria-hidden
                    >
                      <span className="g-orang-cahaya absolute" />
                      <svg
                        className="g-orang-cincin absolute left-1/2 top-1/2 h-[140%] w-[140%] -translate-x-1/2 -translate-y-1/2"
                        viewBox="-100 -100 200 200"
                      >
                        {[92, 70, 50].map((r) => (
                          <polygon key={r} points={jalurHeks(r)} />
                        ))}
                      </svg>
                      <span className="g-orang-lencana absolute left-1/2 top-1/2 grid h-24 w-24 -translate-x-1/2 -translate-y-1/2 place-items-center">
                        <svg viewBox="-50 -50 100 100" className="absolute inset-0 h-full w-full">
                          <polygon points={jalurHeks(46)} />
                        </svg>
                        <span className="papan relative text-[22px] leading-none text-white">{o.inisial}</span>
                      </span>
                    </div>

                    <div className="relative flex flex-1 flex-col px-6 pb-7 pt-5">
                      <p className="g-orang-peran text-[11.5px] font-semibold uppercase tracking-[0.09em]">
                        {o.peran}
                      </p>
                      <h3 className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[19px] font-semibold leading-tight text-white">
                        {o.namaLengkap ?? o.nama}
                        {o.ketua && (
                          <span className="rounded-full bg-white/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-white/85">
                            {teks.tim.ketua}
                          </span>
                        )}
                      </h3>
                      {/* Prodi dan angkatan - hanya yang benar-benar diisi. Nama
                          prodi tidak diterjemahkan: ia nama resmi, sama seperti
                          "Telkom University" yang tetap di layar Inggris. */}
                      {(o.prodi || o.angkatan) && (
                        <p className="mt-2 text-[12.5px] leading-snug text-white/55">
                          {o.prodi}
                          {o.prodi && o.angkatan ? ' · ' : null}
                          {/* Sebaris utuh: "Angkatan" yang tertinggal di ujung baris
                              dengan tahunnya di baris berikutnya terbaca patah. */}
                          {o.angkatan ? (
                            <span className="whitespace-nowrap">
                              {teks.tim.angkatan} {o.angkatan}
                            </span>
                          ) : null}
                        </p>
                      )}
                      <span className="g-orang-garis mt-4 block h-px w-full" aria-hidden />
                      <p className="mt-4 text-[13px] leading-relaxed text-white/65">
                        {bahasa === 'en' && o.kerjaEn ? o.kerjaEn : o.kerja}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <div className="mt-16 flex justify-center">
              <button
                onClick={keAtas}
                className="g-pil-gelap flex cursor-pointer items-center gap-2.5 rounded-full px-6 py-3 text-[13px] font-medium text-white/70"
              >
                <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden>
                  <path
                    d="M10 15.5V4.5M4.8 9.7 10 4.5l5.2 5.2"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {teks.tim.permukaan}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
