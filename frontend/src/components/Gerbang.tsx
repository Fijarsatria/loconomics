/**
 * Gerbang — halaman pertama. Perkenalan sekaligus pintu masuk ke peta.
 *
 * KENAPA BUKAN FORMULIR LOGIN. Diminta "halaman login", dan yang dibuat di sini
 * halaman gerbang. Bedanya disengaja: proyek ini belum punya autentikasi sama
 * sekali — tidak ada Supabase Auth, tidak ada sesi, tidak ada pengguna. Formulir
 * yang meminta surel dan kata sandi lalu menerima apa pun bukan sekadar belum
 * selesai; ia BERBOHONG tentang apa yang terjadi pada yang diketik ke dalamnya,
 * dan halaman ini akan dibaca juri.
 *
 * URUTAN LAYAR: gerbang → pembuka → peta. Lihat catatan di Pembuka.tsx.
 *
 * SATU BAGIAN, SATU LAYAR. Tiap bagian dibuat setinggi layar dan diberi ruang
 * napas sendiri. Bukan demi kelegaan: gulir yang membawa dua bagian sekaligus
 * ke dalam pandangan membuat animasi masuk keduanya bertabrakan, dan yang
 * terbaca bukan dua gagasan melainkan satu kebisingan.
 *
 * EMPAT CARA MENGGULIR, dan tiap bagian memilih yang cocok dengan isinya:
 *
 *   TEGAK    bagian biasa — hero, dek kawasan, fitur, angka, penutup.
 *   LINTANG  empat kuadran. Gulir turun menggeser panelnya ke SAMPING, dan
 *            panelnya saling MENIMPA: yang sedang dibaca maju ke depan,
 *            tetangganya menyelinap ke belakang. Empat kuadran adalah satu
 *            sumbu perbandingan; menyusunnya ke bawah membuat orang
 *            membandingkannya dengan ingatan.
 *   CAIRAN   pipeline. Satu gumpalan turun menyusuri rel dan MELEBUR dengan
 *            tiap simpul yang dilewatinya. Penggabungan itu tidak bisa dibuat
 *            transisi CSS mana pun — ia butuh blur lalu ambang alfa.
 *   JURANG   bagian tim. Turun ke bawah berarti turun ke dalam, sampai hitam.
 *
 * TENTANG PUSTAKANYA. Referensi yang diberikan pemilik repo memasang shadcn/ui,
 * lucide-react, radix-slot, dan class-variance-authority. Tidak satu pun dipakai
 * di sini: repo ini sudah punya sistem visualnya sendiri, dan empat dependensi
 * baru akan menambah sistem kedua yang harus dijaga sinkron dengan yang pertama.
 *
 * Satu batas yang tetap dipegang: prefers-reduced-motion. Kalau pengguna
 * memintanya, seluruh timeline dilewati — termasuk gulir lintang, yang berubah
 * jadi tumpukan tegak biasa.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

import { FITUR, IDENTITAS, KUADRAN, PENDIRI, URUTAN_KUADRAN } from '../config'
import { Glif, PapanNama } from './primitif'
import { TombolAkun } from './Akun'
import DekKawasan, { type PilihanKawasan } from './GerbangPeta'
import { DIPOTRET, KARTU_GERBANG } from '../lib/kartu-gerbang'

gsap.registerPlugin(ScrollTrigger)

const NAMA = 'LOCONOMICS'
const AJAKAN = 'Masuk ke peta'

/**
 * Nama tampilan untuk `opportunity_score` di halaman ini.
 *
 * HANYA di halaman ini. Di dalam aplikasi ia tetap "Skor Peluang" — nama itu
 * dipakai di layer, panel, daftar, dokumen lomba, dan di kontrak alat yang
 * dikirim ke penyedia LLM.
 */
const LABEL_SKOR = 'Peluang Strategis'

// ---------------------------------------------------------------------------
// Isi halaman
// ---------------------------------------------------------------------------

const TESIS =
  'Lokasi terbaik bukan yang paling ramai dilihat, melainkan yang paling jarang dihitung.'

/**
 * Tiga kalimat yang menjelaskan apa yang dikerjakan produk ini.
 *
 * Sengaja tanpa kata "visi" dan "misi" — keduanya memaksa pembaca memilah dulu
 * mana yang cita-cita dan mana yang rencana, padahal yang ingin ia tahu cuma
 * satu: ini alat untuk apa.
 */
const PENDIRIAN: { kepala: string; isi: string }[] = [
  {
    kepala: 'Dibaca, bukan ditafsirkan',
    isi: 'Hasil survei lapangan jadi peta yang bisa dibaca siapa saja — bukan laporan yang harus diterjemahkan lebih dulu.',
  },
  {
    kepala: 'Dua arah, sama kerasnya',
    isi: 'Menunjukkan yang bagus tapi belum terlihat, dan memperingatkan yang sebaliknya dengan suara yang sama kerasnya.',
  },
  {
    kepala: 'Sampai ke rumusnya',
    isi: 'Setiap angka bisa ditelusuri sampai ke rumus yang membuatnya, supaya keputusannya tetap milik Anda.',
  },
]

const LANGKAH_TESIS: { kunci: string; kepala: string; isi: string }[] = [
  {
    kunci: 'HIDDEN_GEM',
    kepala: 'Yang dicari orang',
    isi: 'Datanya bagus, tampilannya biasa saja. Orang lewat tanpa menoleh, sewanya belum ikut naik, dan angkanya sudah mendukung sejak sekarang. Inilah alasan produk ini dibuat.',
  },
  {
    kunci: 'JEBAKAN_GENGSI',
    kepala: 'Yang menjebak',
    isi: 'Tampak mahal, terasa ramai, dan ekonominya tidak mendukung. Kuadran ini yang paling sering dibayar mahal — karena satu-satunya yang memperingatkannya adalah angka, dan angkanya jarang dilihat sebelum kontrak sewa ditandatangani.',
  },
  {
    kunci: 'PEMENANG_JELAS',
    kepala: 'Yang aman, dan mahal',
    isi: 'Datanya bagus dan tampilannya sudah mahal. Tidak ada yang salah di sini — Anda hanya ikut membayar gengsi yang sudah dihargai orang lain lebih dulu.',
  },
  {
    kunci: 'HINDARI',
    kepala: 'Yang sepi',
    isi: 'Potensi ekonomi dan daya tarik visualnya sama-sama rendah. Digambar paling redup di peta, karena memang tidak ada apa-apa untuk ditunjukkan di sana.',
  },
]

const PIPA: { nomor: string; kepala: string; isi: string; tanda: string }[] = [
  {
    nomor: '01',
    kepala: 'Survei misi MAPID, lalu OCR',
    isi: 'Data lapangan dari misi survei MAPID, ditambah pembacaan otomatis papan sewa dan struk. Hasilnya 43 variabel per titik — dan yang belum tersurvei tetap kosong, tidak pernah diisi nol.',
    tanda: '43 variabel',
  },
  {
    nomor: '02',
    kepala: 'Diagregasi ke heksagon H3',
    isi: 'Seluruh titik dijatuhkan ke grid heksagon H3 resolusi 9, sekitar 0,1 km² per sel. Sejak titik ini tidak ada lagi baris survei perorangan yang bisa direkonstruksi — hanya agregat per heksagon.',
    tanda: '0,1 km² per sel',
  },
  {
    nomor: '03',
    kepala: 'Empat indeks komposit',
    isi: 'Potensi transit, aktivitas ekonomi, kompetisi, dan risiko dihitung terpisah lalu dinormalisasi. Variabel yang harus dinetralkan bernilai 0,5 — tengah skala — bukan nol.',
    tanda: 'IPT · IAE · IKP · IBR',
  },
  {
    nomor: '04',
    kepala: 'Regresi residual',
    isi: 'Di sinilah "terlihat mahal" dipisahkan dari "datanya bagus". Yang tersisa setelah prestise visual dijelaskan oleh harga adalah selisih yang dicari: lokasi yang datanya melampaui tampilannya.',
    tanda: 'residual, bukan mentah',
  },
  {
    nomor: '05',
    kepala: 'Kuadran dan badge keyakinan',
    isi: 'Dua sumbu, empat kuadran, dibelah di median — bukan di tengah kotak. Setiap skor keluar bersama badge keyakinan, jadi lokasi yang datanya masih tipis mengaku sejak baris pertama.',
    tanda: 'Q01 · Q02 · Q03',
  },
]

const ANGKA: { nilai: number; satuan: string; catatan: string }[] = [
  { nilai: 708, satuan: 'heksagon terpetakan', catatan: 'lewat pipeline yang sama dengan produksi' },
  { nilai: 6, satuan: 'kawasan pilot', catatan: 'KRL, MRT, dan LRT Jabodetabek' },
  { nilai: 43, satuan: 'variabel per heksagon', catatan: 'berkode D, B, C, L, P — semuanya bernama' },
  { nilai: 18, satuan: 'jam profil harian', catatan: 'pukul 05.00 sampai 22.00' },
]

// ---------------------------------------------------------------------------
// Gambar-gambar kecil
//
// Semuanya SVG yang digambar di tempat, bukan berkas. Alasannya sama dengan
// alasan kartu peta memotret dirinya sendiri: aset yang disimpan akan basi
// diam-diam pada perubahan palet berikutnya, dan tidak ada uji yang bisa
// menangkapnya. Yang di bawah ini mengambil warnanya dari `currentColor` atau
// dari token kuadran, jadi ia selalu ikut.
// ---------------------------------------------------------------------------

/** Heksagon bertopi runcing, dipusatkan di (0,0). */
function jalurHeks(r: number) {
  return Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 180) * (60 * k - 30)
    return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`
  }).join(' ')
}

/**
 * Sarang lebah hidup di latar hero.
 *
 * Bentuknya bukan hiasan: heksagon ADALAH bentuk data proyek ini (H3), jadi
 * latar yang bergerak di sini sekaligus memperkenalkan grid yang akan dipakai
 * di seluruh aplikasi.
 *
 * Dua salinan sarang yang sama ditumpuk — yang bawah samar dan diam, yang atas
 * penuh warna tetapi ditutup masker lingkaran yang bergerak pelan. Lihat
 * `.g-sapu` di index.css untuk alasan kenapa yang bergerak maskernya, bukan
 * ketiga ratus heksagonnya.
 */
const R_SARANG = 44
/** Ubin sarang: selebar satu heksagon bertopi runcing, setinggi dua baris. */
const UBIN_W = R_SARANG * Math.sqrt(3)
const UBIN_H = R_SARANG * 3

/**
 * Sarang digambar sebagai SATU `<pattern>`, bukan sebagai ratusan poligon.
 *
 * Versi pertama menaruh 24 x 13 heksagon sebagai elemen `<polygon>` sungguhan —
 * 312 simpul DOM per salinan, 700 untuk dua salinan. Perender harus melukis
 * setiap satu setiap kali lapisannya perlu digambar ulang. `<pattern>` membuat
 * perender melukis ubinnya SEKALI lalu mengulanginya sebagai tekstur.
 *
 * Lima heksagon per ubin, bukan dua: yang di keempat sudut harus digambar utuh
 * supaya potongannya menyambung dengan ubin sebelahnya. Pattern menggunting di
 * tepi ubin, jadi heksagon yang berpusat di sudut hanya tampil seperempat — dan
 * seperempat itulah yang melengkapi tetangganya.
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

/** Kunci localStorage tampilan gerbang. Terpisah dari `loconomics.tampilan.v1`
 *  milik aplikasi: yang ini soal halaman perkenalan, bukan soal peta. */
const KUNCI_TEMA = 'loconomics.tema-gerbang'

/** Lebar perjalanan gumpalan sakelar tema, piksel. */
const LUNCUR_SAKELAR = 38
/** Lama gumpalan melar sebelum kembali bulat. Sama dengan durasi geseranya. */
const LUNCUR_SAKELAR_MS = 520

/**
 * Sakelar terang/gelap halaman gerbang.
 *
 * MENGGANTIKAN kalimat "belum ada autentikasi di proyek ini" yang dulu berdiri
 * di sini. Kalimat itu sudah tidak benar sejak akun dan langganan masuk, dan
 * ruang di bawah tombol utama terlalu berharga untuk diisi keterangan yang
 * salah.
 *
 * KENAPA GUMPALAN, BUKAN KNOP. Yang membuatnya terbaca sebagai cairan bukan
 * warnanya melainkan MELAR-nya: selama berpindah ia memanjang mendatar dan
 * memipih, seperti tetesan yang ditarik, lalu bulat lagi begitu sampai. Ditambah
 * filter penggabung, ujung-ujung relnya ikut "meleleh" menyambut gumpalan itu
 * alih-alih menunggu di tempat.
 *
 * Polanya sama persis dengan lensa di PilihBasemap - satu benda yang BERPINDAH,
 * bukan dua keadaan yang bergantian menyala. Bedanya cuma di sini benda itu
 * lewat filter yang membuat batasnya bisa menyatu.
 */
function SakelarTema({ gelap, onUbah }: { gelap: boolean; onUbah: (v: boolean) => void }) {
  const [luncur, setLuncur] = useState(false)
  const jam = useRef<number | undefined>(undefined)
  useEffect(() => () => clearTimeout(jam.current), [])

  const tekan = () => {
    setLuncur(true)
    clearTimeout(jam.current)
    jam.current = window.setTimeout(() => setLuncur(false), LUNCUR_SAKELAR_MS)
    onUbah(!gelap)
  }

  return (
    <div className="g-masuk-awal mt-6 flex items-center justify-center gap-3">
      <span className="text-[11.5px] font-medium text-[color:var(--g-ink-3)]">Terang</span>
      <button
        type="button"
        role="switch"
        aria-checked={gelap}
        aria-label="Tampilan gelap"
        onClick={tekan}
        className="g-sakelar relative grid h-[38px] w-[78px] shrink-0 cursor-pointer place-items-center rounded-full"
      >
        {/* Lapisan bergumpal. Filter penggabungnya duduk DI SINI, bukan di
            tombolnya: ikon matahari dan bulan adalah garis tipis, dan garis
            tipis di dalam lapisan ber-filter dimakan ambang alfanya - jebakan
            yang sudah pernah kena di rel pipeline. Yang masuk ke dalam filter
            cuma bentuk-bentuk tebal. */}
        <span className="g-sakelar-cair pointer-events-none absolute inset-0" aria-hidden>
          <span className="g-sakelar-ujung absolute left-[3px] top-1/2 h-[26px] w-[26px] -translate-y-1/2 rounded-full" />
          <span className="g-sakelar-ujung absolute right-[3px] top-1/2 h-[26px] w-[26px] -translate-y-1/2 rounded-full" />
          <span
            className="g-sakelar-gumpal absolute left-[3px] top-1/2 h-[32px] w-[32px] rounded-full"
            style={{
              transform: `translate(${gelap ? LUNCUR_SAKELAR : 0}px, -50%) scale(${
                luncur ? 1.34 : 1
              }, ${luncur ? 0.82 : 1})`,
            }}
          />
        </span>

        {/* Ikon DI ATAS gumpalan, dan tidak ikut difilter. Yang aktif memakai
            warna latar sakelarnya sendiri supaya ia terbaca sebagai lubang di
            gumpalan, bukan sebagai stiker yang menempel di atasnya. */}
        <span className="pointer-events-none absolute inset-0 flex items-center justify-between px-[10px]">
          <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden className="transition-colors duration-500" style={{ color: gelap ? 'var(--g-ink-4)' : 'var(--g-utama-teks)' }}>
            <circle cx="10" cy="10" r="3.7" fill="currentColor" />
            {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
              <line
                key={a}
                x1="10"
                y1="2.6"
                x2="10"
                y2="4.6"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                transform={`rotate(${a} 10 10)`}
              />
            ))}
          </svg>
          <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden className="transition-colors duration-500" style={{ color: gelap ? 'var(--g-utama-teks)' : 'var(--g-ink-4)' }}>
            <path
              d="M16 12.4A6.6 6.6 0 0 1 7.6 4a6.9 6.9 0 1 0 8.4 8.4Z"
              fill="currentColor"
            />
          </svg>
        </span>
      </button>
      <span className="text-[11.5px] font-medium text-[color:var(--g-ink-3)]">Gelap</span>
    </div>
  )
}

/**
 * Pembatas antar-bagian: garis rambut yang memudar di kedua ujung, dengan satu
 * heksagon kecil di tengahnya.
 *
 * Ada karena bagian-bagian halaman ini berbatasan langsung tanpa apa pun di
 * antaranya - yang bagus selama latarnya seragam, tetapi begitu tiap bagian
 * punya motif sendiri, batasnya jadi tempat dua motif bertabrakan tanpa
 * penengah. Garis ini penengahnya.
 *
 * Ia MENGGAMBAR DIRINYA saat masuk layar: lebarnya tumbuh dari nol. Itu
 * `transform: scaleX`, bukan `width` - lebar memaksa tata letak dihitung ulang
 * tiap bingkai, skala tidak menyentuhnya sama sekali.
 */
function Pembatas() {
  return (
    <div className="g-pembatas relative mx-auto flex h-16 w-full max-w-[62rem] items-center justify-center px-6" aria-hidden>
      <span className="g-pembatas-garis h-px flex-1 origin-right" />
      <svg width="16" height="18" viewBox="0 0 16 18" className="g-pembatas-heks mx-3 shrink-0">
        <polygon
          points="8,0.8 15.2,4.9 15.2,13.1 8,17.2 0.8,13.1 0.8,4.9"
          fill="none"
          stroke="var(--g-garis-halus)"
          strokeWidth="1.4"
        />
      </svg>
      <span className="g-pembatas-garis h-px flex-1 origin-left" />
    </div>
  )
}

/** Satu heksagon berjari-jari r, dipindah ke (x, y). */
function heks(r: number, x = 0, y = 0, kunci?: string | number) {
  return (
    <polygon
      key={kunci ?? `${r}-${x}-${y}`}
      points={jalurHeks(r)}
      transform={`translate(${x} ${y})`}
      fill="none"
    />
  )
}

/**
 * Komposisi latar per bagian. Semuanya heksagon bergaris - satu bahasa bentuk,
 * sama dengan terowongan di dasar jurang yang sudah ada sejak awal - tetapi
 * SUSUNANNYA berbeda, dan susunan itu mengacu pada isi bagiannya.
 *
 * Itu bedanya dengan percobaan sebelumnya. Yang pertama memberi tiap bagian
 * diagram yang sama sekali berbeda (grid, sumbu, rel, batang) dan halamannya
 * terasa seperti tujuh halaman. Yang kedua memberi semuanya terowongan yang
 * sama dan tiap bagian kehilangan wajahnya. Yang ini menahan bentuk dasarnya
 * dan memvariasikan susunannya.
 *
 * Digambar pada kanvas -100..100; ukuran layarnya diatur wadahnya.
 */
const KOMPOSISI: Record<string, ReactNode> = {
  // Terowongan konsentris - gema langsung dari dasar jurang.
  pendirian: <>{[92, 70, 50, 33, 19].map((r) => heks(r))}</>,

  // Sarang: satu di tengah, enam mengelilinginya. Enam kawasan pilot.
  kawasan: (
    <>
      {heks(30)}
      {[0, 60, 120, 180, 240, 300].map((a) => {
        const rad = (Math.PI / 180) * a
        return heks(30, Math.cos(rad) * 54, Math.sin(rad) * 54, a)
      })}
      {heks(96)}
    </>
  ),

  // Empat kuadran: dua sumbu membelah satu heksagon besar, satu heksagon kecil
  // di tiap petaknya. Persis yang digambar Kompas di depannya.
  kuadran: (
    <>
      {heks(94)}
      <path d="M-94 0 H94" />
      <path d="M0 -82 V82" />
      {[
        [-44, -40],
        [44, -40],
        [-44, 40],
        [44, 40],
      ].map(([x, y]) => heks(24, x, y, `${x}:${y}`))}
    </>
  ),

  // Rantai menurun: lima heksagon bersambung, bentuk pipeline s1..s7.
  'cara-kerja': (
    <>
      {[-76, -38, 0, 38, 76].map((y, i) => heks(26 - i * 2, i % 2 ? 22 : -22, y, y))}
      <path d="M-22 -76 L22 -38 L-22 0 L22 38 L-22 76" />
    </>
  ),

  // Enam alat mengelilingi satu peta - susunan yang sama dengan kartunya.
  fitur: (
    <>
      {heks(34)}
      {[0, 60, 120, 180, 240, 300].map((a) => {
        const rad = (Math.PI / 180) * (a + 30)
        return heks(20, Math.cos(rad) * 72, Math.sin(rad) * 72, a)
      })}
    </>
  ),

  // Empat heksagon yang meninggi - empat angka yang bisa diperiksa.
  angka: (
    <>
      {[
        [-72, 14],
        [-24, 22],
        [24, 30],
        [72, 40],
      ].map(([x, r]) => heks(r, x, 60 - r, x))}
      <path d="M-96 76 H96" />
    </>
  ),

  // Terowongan lagi, lebih dalam - jembatan menuju jurang di bawahnya.
  penutup: <>{[96, 74, 55, 39, 26, 15, 7].map((r) => heks(r))}</>,
}

/** Seberapa jauh cincinnya berputar sepanjang perjalanan bagiannya, per bagian. */
const PUTAR: Record<string, number> = {
  pendirian: 12,
  kawasan: -9,
  kuadran: 15,
  'cara-kerja': -13,
  fitur: 10,
  angka: -11,
  penutup: 14,
}

function LatarBagian({ motif }: { motif: keyof typeof KOMPOSISI }) {
  return (
    // Dipusatkan lewat MARGIN, bukan `-translate-x/y-1/2`: geseran, skala, dan
    // putaran di bawah ditulis GSAP ke properti transform yang sama, dan apa pun
    // yang dititipkan di transform akan tertimpa pada penulisan pertama.
    //
    // `top-0`, BUKAN `top-1/2`. Posisi tegaknya diatur penggeraknya supaya motif
    // selalu duduk di tengah LAYAR selama bagiannya terlihat - bukan di tengah
    // BAGIANNYA. Bedanya baru terasa di bagian kuadran, yang setinggi 3.250 px
    // karena ia spacer gulir lintang: dipusatkan ke bagian, motifnya mendarat
    // 1.625 px di bawah dan yang terlihat cuma potongan bawahnya.
    <div
      className="g-motif pointer-events-none absolute left-1/2 top-0 -ml-[42vmin] hidden h-[84vmin] w-[84vmin] lg:block"
      data-motif={motif}
      data-putar={PUTAR[motif]}
      aria-hidden
    >
      <svg viewBox="-100 -100 200 200" className="h-full w-full" stroke="var(--g-motif-garis)" strokeWidth="0.55" fill="none">
        {KOMPOSISI[motif]}
      </svg>
    </div>
  )
}

/** Jari-jari lensa kursor, piksel./** Jari-jari lensa kursor, piksel./** Jari-jari lensa kursor, piksel. Dipakai juga untuk menghitung lawan-geser. */
const R_LENSA = 170

/**
 * Bungkus geseran ke dalam (-periode, 0].
 *
 * Sarangnya `<pattern>` yang berulang, jadi menggesernya sejauh TEPAT satu ubin
 * tidak mengubah apa pun yang terlihat. Itu dipakai untuk menahan elemen isinya
 * tetap kecil: tanpa ini ia harus selebar seluruh hero supaya jendelanya tetap
 * tertutup di posisi kursor mana pun. Dengan pembungkusan, cukup seukuran
 * jendelanya plus satu ubin di tiap sisi.
 */
function bungkus(nilai: number, periode: number): number {
  return nilai - Math.ceil(nilai / periode) * periode
}

/**
 * Latar hero: kisi heksagon yang garis tepinya MENYALA di sekitar kursor.
 *
 * TINGGAL DI DALAM HERO, bukan lapisan `fixed` seukuran layar. Versi sebelumnya
 * melayang di atas seluruh viewport dan disembunyikan lewat IntersectionObserver
 * saat hero lewat - tetapi selama hero masih terhitung terlihat, lapisan itu
 * tetap menutupi SELURUH layar, termasuk bagian berikutnya yang sudah masuk.
 * Akibatnya bagian "Yang kami percaya" ikut berlatar kisi hero. Ambang pengamat
 * tidak bisa memperbaikinya; yang salah tempatnya, bukan angkanya. Sebagai anak
 * `absolute` di dalam hero yang sudah `overflow-hidden`, ia tidak akan pernah
 * bisa keluar dari sana.
 *
 * TIDAK ADA GERAK SENDIRI. Tidak bernafas, tidak berdenyut, tidak beriak. Kisi
 * dasarnya diam; yang menyala cuma yang sedang disentuh kursor.
 *
 * CARANYA, dan kenapa begini. Yang diinginkan: garis tepi heksagon di sekitar
 * kursor menyala. Cara paling lurus - menganimasikan `mask-position` pada
 * selapis sarang terang - adalah properti tahap PAINT: tiap gerakan kursor
 * memaksa selapis penuh dilukis ulang.
 *
 * Yang dipakai dua transform yang saling meniadakan:
 *
 *   LENSA  jendela bundar yang digeser ke posisi kursor.
 *   ISI    sarang terang di dalamnya, digeser BERLAWANAN sejauh yang sama.
 *
 * Karena keduanya persis berlawanan, sarang terang itu DIAM terhadap halaman -
 * tepat menimpa sarang redup di bawahnya, heksagon demi heksagon. Yang bergerak
 * cuma jendelanya. Keduanya `transform`, satu-satunya properti gerak yang
 * benar-benar ditangani compositor: nol piksel dilukis ulang.
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

    // Layar sentuh tidak punya kursor untuk diikuti, dan gerak yang tidak
    // diminta tetap tidak diminta. Keduanya membiarkan lensanya diam di tengah,
    // yang terbaca sebagai kisi yang sedikit lebih terang di tengah - bukan
    // sebagai sesuatu yang rusak.
    const diam =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !window.matchMedia('(hover: hover)').matches

    // Kotak wadahnya dibaca SEKALI, lalu hanya kalau ada yang mengubahnya.
    // Memanggil getBoundingClientRect() di dalam pointermove berarti satu layout
    // paksa per kejadian, dan tetikus 500Hz mengirim delapan kejadian per
    // bingkai - jebakan yang sama dengan yang sudah kena di gulir lintang.
    let kotak = wadah.getBoundingClientRect()
    let basi = false
    const usang = () => {
      basi = true
    }

    let tx = kotak.width / 2
    let ty = kotak.height / 2
    let x = tx
    let y = ty

    // `quickSetter` menulis transform tanpa membuat tween sama sekali. Kedua
    // elemen ditulis dari x/y yang SAMA di bingkai yang sama - dulu keduanya
    // digerakkan tween terpisah, dan tween yang terpisah bisa berselisih.
    // Selisih sepiksel pun terlihat sebagai bayangan ganda, sebab sarang terang
    // harus menimpa sarang redup persis heksagon demi heksagon.
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

    // Peluk eksponensial: tiap bingkai lensanya menutup sebagian tetap dari sisa
    // jaraknya. Sebagian itu dihitung dari dt lewat `1 - exp(-dt/TAU)`, bukan
    // konstanta lerp polos - konstanta polos diam-diam berjalan dua kali lebih
    // cepat begitu layarnya 120Hz alih-alih 60Hz.
    const TAU_IKUT = 0.055
    const TAU_PULANG = 0.3
    let tau = TAU_IKUT

    let id = 0
    let sebelum = 0
    const bingkai = (t: number) => {
      id = requestAnimationFrame(bingkai)
      // Pengukuran ulang duduk DI SINI, sebelum satu pun tulisan: baca dulu,
      // tulis kemudian, tidak pernah berselang-seling.
      if (basi) {
        kotak = wadah.getBoundingClientRect()
        basi = false
      }
      // Dibatasi supaya kembali dari tab yang lama ditinggal tidak meloncat.
      const dt = sebelum ? Math.min((t - sebelum) / 1000, 0.1) : 1 / 60
      sebelum = t
      const k = 1 - Math.exp(-dt / tau)
      x += (tx - x) * k
      y += (ty - y) * k
      tulis()
      // Berhenti begitu sampai. Bingkai yang tidak menggambar apa pun tetap
      // bingkai yang harus dihitung, dan hero ini hidup selama orang membaca.
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

    // Penangannya tidak menghitung apa pun - ia cuma menaruh koordinat. Delapan
    // kejadian dalam satu bingkai jadi tujuh timpaan yang hampir gratis alih-
    // alih tujuh kali kerja penuh.
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

    // Dipasang pada bagian heronya, bukan pada window: begitu kursor pindah ke
    // bagian lain halaman, tidak ada lagi satu pun kejadian yang perlu diurus.
    const induk = wadah.parentElement ?? wadah
    induk.addEventListener('pointermove', gerak, { passive: true })
    induk.addEventListener('pointerleave', pulang)
    window.addEventListener('resize', usang)
    // Hero ikut bergeser saat halaman digulir, jadi kotaknya ikut usang.
    // Gerbang menggulir di wadahnya sendiri, dan `scroll` tidak menggelembung -
    // fase tangkap yang membuatnya tetap terdengar.
    window.addEventListener('scroll', usang, { capture: true, passive: true })
    return () => {
      induk.removeEventListener('pointermove', gerak)
      induk.removeEventListener('pointerleave', pulang)
      window.removeEventListener('resize', usang)
      window.removeEventListener('scroll', usang, { capture: true })
      if (id) cancelAnimationFrame(id)
    }
  }, [])

  // Isinya cuma perlu menutupi jendelanya: dua kali jari-jari lensa, plus satu
  // ubin di tiap sisi sebagai bantalan bagi geseran yang dibungkus.
  const sisi = R_LENSA * 2 + 2 * Math.max(UBIN_W, UBIN_H)

  return (
    <div
      ref={akar}
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      // Memudar ke bawah. Tanpa ini kisinya berhenti MENDADAK di batas hero -
      // `overflow-hidden` memotongnya sebagai garis lurus melintang, dan garis
      // itu terbaca sebagai jahitan yang lupa dirapikan. Maskernya statis:
      // dihitung sekali, tidak pernah lagi.
      style={{
        maskImage: 'linear-gradient(to bottom, #000 52%, transparent 96%)',
        WebkitMaskImage: 'linear-gradient(to bottom, #000 52%, transparent 96%)',
      }}
      aria-hidden
    >
      {/* Kisi dasar. Diam, dan tidak pernah disentuh apa pun. */}
      <Sarang id="sarang-dasar" warna="var(--g-sarang)" tebal={1.15} />

      {/* Lensa. `marginLeft/Top` -R membuat transform x/y bisa dipakai sebagai
          koordinat kursor apa adanya, tanpa perlu menambah pergeseran tengah di
          setiap perhitungan. */}
      <div
        ref={lensa}
        className="g-lensa absolute left-0 top-0 overflow-hidden"
        style={{
          width: R_LENSA * 2,
          height: R_LENSA * 2,
          marginLeft: -R_LENSA,
          marginTop: -R_LENSA,
        }}
      >
        <div
          ref={isi}
          className="g-lensa-isi absolute left-0 top-0"
          style={{ width: sisi, height: sisi }}
        >
          <Sarang id="sarang-nyala" warna="var(--g-sarang-nyala)" tebal={1.7} />
        </div>
      </div>
    </div>
  )
}

/**
 * Ladang heksagon yang berdenyut — pendamping kalimat tesis.
 *
 * Isinya persis apa yang dikatakan kalimat di sebelahnya: hampir semuanya
 * redup, dan yang menyala justru yang tidak menonjol. Kalau kalimatnya benar,
 * gambarnya harus bisa dibaca tanpa keterangan.
 */
function LadangDenyut() {
  const R = 15
  const W = R * Math.sqrt(3)
  const H = R * 1.5
  const sel: { x: number; y: number; nyala: number }[] = []
  for (let baris = 0; baris < 7; baris++) {
    for (let kolom = 0; kolom < 7; kolom++) {
      const n = Math.sin(kolom * 127.1 + baris * 311.7) * 43758.5453
      sel.push({
        x: 30 + kolom * W + (baris % 2 ? W / 2 : 0),
        y: 26 + baris * H,
        nyala: n - Math.floor(n),
      })
    }
  }
  return (
    <svg viewBox="0 0 260 220" className="h-auto w-full" aria-hidden>
      {sel.map((s, i) => {
        // Empat sel saja yang menyala, dan letaknya tidak di tengah.
        const pilih = s.nyala > 0.93
        return (
          <g key={i} transform={`translate(${s.x} ${s.y})`}>
            <polygon
              points={jalurHeks(R - 1.2)}
              fill={pilih ? 'var(--q-gem)' : 'var(--g-garis-halus-2)'}
              stroke={pilih ? 'var(--q-gem)' : 'var(--g-garis-halus-2)'}
              strokeWidth="1"
              className={pilih ? 'g-nyala' : undefined}
              style={pilih ? { animationDelay: `${(i % 5) * 420}ms` } : undefined}
            />
          </g>
        )
      })}
    </svg>
  )
}

/** Enam gambar fitur. Satu bentuk per alat, semuanya dari satu kosakata garis. */
const GAMBAR_FITUR: Record<string, ReactNode> = {
  PriceLens: (
    <>
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={10 + i * 15}
          y={44 - [10, 22, 32, 18][i]}
          width="9"
          height={[10, 22, 32, 18][i]}
          rx="2.5"
          fill="currentColor"
          opacity={0.28 + i * 0.18}
          className="g-tumbuh"
          style={{ animationDelay: `${i * 90}ms` }}
        />
      ))}
      <path d="M6 48h60" stroke="currentColor" strokeWidth="1.4" opacity="0.35" />
    </>
  ),
  GemFinder: (
    <>
      <polygon points={jalurHeks(19)} transform="translate(36 27)" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.3" />
      <polygon points={jalurHeks(11)} transform="translate(36 27)" fill="currentColor" opacity="0.85" className="g-denyut-halus" />
      <circle cx="36" cy="27" r="24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.2" className="g-riak" />
    </>
  ),
  RiskRadar: (
    <>
      {[9, 16, 23].map((r, i) => (
        <circle key={r} cx="36" cy="27" r={r} fill="none" stroke="currentColor" strokeWidth="1.2" opacity={0.34 - i * 0.08} className="g-riak" style={{ animationDelay: `${i * 620}ms` }} />
      ))}
      <path d="M36 27 58 14" stroke="currentColor" strokeWidth="1.6" opacity="0.7" />
      <circle cx="36" cy="27" r="3" fill="currentColor" />
    </>
  ),
  ZoneGuard: (
    <>
      <path d="M36 7 57 15v14c0 11-9 18-21 22-12-4-21-11-21-22V15Z" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
      <path d="M27 27l6.5 7L46 21" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="g-gambar-garis" />
    </>
  ),
  'Commuter Clock': (
    <>
      <circle cx="36" cy="27" r="20" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.35" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (Math.PI / 6) * i
        return <line key={i} x1={36 + Math.cos(a) * 16} y1={27 + Math.sin(a) * 16} x2={36 + Math.cos(a) * 19} y2={27 + Math.sin(a) * 19} stroke="currentColor" strokeWidth="1.2" opacity="0.3" />
      })}
      <line x1="36" y1="27" x2="36" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="g-jarum" />
      <line x1="36" y1="27" x2="47" y2="31" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
    </>
  ),
  'Konsultan AI': (
    <>
      <rect x="8" y="10" width="42" height="27" rx="9" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
      <path d="M18 37v7l9-7" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4" strokeLinejoin="round" />
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={20 + i * 9} cy="23" r="2.6" fill="currentColor" opacity="0.75" className="g-denyut-halus" style={{ animationDelay: `${i * 220}ms` }} />
      ))}
      <polygon points={jalurHeks(9)} transform="translate(56 40)" fill="currentColor" opacity="0.25" />
    </>
  ),
}

/**
 * Petak 2x2 mini: di mana kuadran INI duduk pada kedua sumbunya.
 *
 * Kompas besar berdiri diam di kiri dan hanya terlihat di layar lebar. Petak
 * kecil ini ikut bersama kartunya ke mana pun kartunya pergi, jadi pembaca di
 * layar sempit tetap tahu sudut mana yang sedang dibicarakan - tanpa harus
 * mengingat gambar yang tadi ada di sebelah kiri.
 */
function PetakKuadran({ kunci }: { kunci: string }) {
  return (
    <div className="relative h-[68px] w-[68px] shrink-0 overflow-hidden rounded-[12px] border border-[color:var(--g-ink)]/12 bg-white/40">
      {URUTAN_KUADRAN.map((k) => {
        const [kolom, baris] = KUADRAN[k].sel
        const ini = k === kunci
        return (
          <span
            key={k}
            className="absolute transition-colors duration-500"
            style={{
              left: kolom === 0 ? 0 : '50%',
              right: kolom === 0 ? '50%' : 0,
              top: baris === 0 ? 0 : '50%',
              bottom: baris === 0 ? '50%' : 0,
              background: ini ? KUADRAN[k].warna : 'transparent',
              borderRight: kolom === 0 ? '1px solid var(--g-garis-halus-2)' : undefined,
              borderBottom: baris === 0 ? '1px solid var(--g-garis-halus-2)' : undefined,
            }}
          />
        )
      })}
    </div>
  )
}

/**
 * Sebaran keempat kuadran atas SELURUH heksagon, dijumlah dari manifes kartu.
 *
 * Keenam kartu dek adalah keenam kawasan pilot, tidak kurang tidak lebih, jadi
 * menjumlahkannya memberi angka global yang benar — 708. Angkanya ikut
 * disegarkan tiap kali `scripts/potret-kartu.mjs` dijalankan, jadi ia tidak bisa
 * berpisah dari peta yang ditampilkan di sebelahnya.
 */
const SEBARAN_KUADRAN = (() => {
  const per: Record<string, number> = {}
  let total = 0
  for (const k of KARTU_GERBANG) {
    total += k.n
    for (const [q, j] of Object.entries(k.kuadran)) per[q] = (per[q] ?? 0) + j
  }
  return { total, per }
})()

/**
 * Satu panel kuadran. Dipakai dua kali dengan tata letak yang berbeda: berderet
 * menyamping saat gerak menyala, bertumpuk tegak saat gerak dimatikan.
 *
 * Isinya sengaja lebih dari sekadar nama dan penjelasan. Kuadran adalah tesis
 * produk ini, dan tesis yang tidak membawa angka cuma pendapat: tiap panel
 * menyatakan berapa banyak dari 708 heksagon benar-benar jatuh di sana.
 */
function PanelKuadran({
  l,
  i,
  lintang,
}: {
  l: (typeof LANGKAH_TESIS)[number]
  i: number
  lintang?: boolean
}) {
  const q = KUADRAN[l.kunci]
  const jumlah = SEBARAN_KUADRAN.per[l.kunci] ?? 0
  const persen = SEBARAN_KUADRAN.total
    ? Math.round((jumlah / SEBARAN_KUADRAN.total) * 100)
    : 0

  return (
    <article
      className={`g-kaca-tebal rounded-[30px] p-9 sm:p-11 ${
        lintang ? `w-[min(40rem,86vw)] shrink-0 ${i > 0 ? '-ml-16 lg:-ml-24' : ''}` : ''
      }`}
      style={lintang ? { transformStyle: 'preserve-3d' } : undefined}
    >
      <div className="flex items-start gap-5">
        <PetakKuadran kunci={l.kunci} />
        <div className="min-w-0 flex-1">
          <p className="eyebrow mb-2.5 text-[color:var(--g-ink-3)]">
            {String(i + 1).padStart(2, '0')} · {l.kepala}
          </p>
          <h3 className="papan flex items-center gap-3 text-[clamp(1.6rem,3.6vw,2.4rem)] leading-tight">
            <Glif kuadran={l.kunci} ukuran={26} />
            <span style={{ color: q.warna }}>{q.nama}</span>
          </h3>
        </div>
      </div>

      <p className="mt-7 text-[15.5px] leading-relaxed text-[color:var(--g-ink-2)]">{l.isi}</p>

      {/* Angka, dan seberapa besar bagiannya. Batang di bawahnya memakai warna
          kuadran itu sendiri, jadi tidak ada legenda kedua yang harus dibaca. */}
      <div className="mt-8 border-t border-[color:var(--g-ink)]/12 pt-6">
        <div className="flex items-baseline gap-3">
          <span className="papan tabular text-[30px] leading-none" style={{ color: q.warna }}>
            {jumlah}
          </span>
          <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-[color:var(--g-ink-3)]">
            dari {SEBARAN_KUADRAN.total} heksagon jatuh di sini
          </span>
          <span className="tabular shrink-0 text-[12.5px] font-semibold text-[color:var(--g-ink-2)]">
            {persen}%
          </span>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--g-ink)]/8">
          <span
            className="block h-full rounded-full"
            style={{ width: `${persen}%`, background: q.warna }}
          />
        </div>
        <p className="mt-4 text-[13px] font-medium" style={{ color: q.warna }}>
          {q.ringkas}
        </p>
      </div>
    </article>
  )
}

/** Heksagon bergaris yang tergambar sendiri — bingkai tiap angka besar. */
function HeksagonAngka({ anak }: { anak: ReactNode }) {
  return (
    <div className="relative grid h-[104px] w-[92px] shrink-0 place-items-center">
      <svg viewBox="-50 -50 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
        <polygon points={jalurHeks(44)} fill="var(--g-kartu-pekat)" stroke="var(--g-garis-halus-2)" strokeWidth="1.5" />
        <polygon
          points={jalurHeks(44)}
          fill="none"
          stroke="var(--q-gem)"
          strokeWidth="2.4"
          strokeLinejoin="round"
          pathLength={100}
          strokeDasharray="100"
          className="g-gores"
        />
      </svg>
      <span className="relative">{anak}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bagian-bagian kecil
// ---------------------------------------------------------------------------

const LAPIS_3D = 8

/**
 * Teks yang benar-benar punya ketebalan.
 *
 * Delapan salinan huruf yang sama ditumpuk mundur di sumbu Z, jadi ketika induk
 * 3D-nya berputar, sisi tebalnya IKUT berputar. Bayangan tidak bisa melakukan
 * itu — ia selalu menghadap ke arah yang sama.
 *
 * Syaratnya satu: tidak boleh ada `overflow` selain `visible` antara sini dan
 * pemegang `perspective`. Overflow apa pun memaksa keturunannya kembali datar.
 */
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
 * Tombol yang tertarik ke kursor.
 *
 * Dua penjaga, keduanya bukan formalitas. `hover:hover` menolak layar sentuh —
 * di sana `pointermove` cuma menyala saat jari sudah menempel, jadi tombolnya
 * meloncat menjauh persis pada saat ditekan. `prefers-reduced-motion` menolak
 * gerak yang tidak diminta siapa pun.
 *
 * Titik jangkarnya diukur saat kursor MASUK, bukan tiap kali kursor bergerak.
 * Dua sebab, dan yang kedua bukan soal kecepatan: getBoundingClientRect() pada
 * tombol yang sedang ditarik ikut membawa geserannya, jadi acuannya bergerak
 * bersama yang diukur - tombolnya mengejar sasaran yang mundur tiap kali ia
 * mendekat, dan yang terasa adalah gerak yang lembek. `offsetWidth` dan
 * pengurangan geseran yang kita tulis sendiri kebal terhadap itu.
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
    // Geseran yang SEDANG terpasang, disimpan sendiri. Ia dipakai dua kali:
    // untuk membersihkan kotak ukur dari geserannya sendiri, dan untuk
    // menyerahkan keadaan ke GSAP saat kursor keluar.
    let x = 0
    let y = 0
    let tx = 0
    let ty = 0
    // Pusat tombol dalam keadaan diam, koordinat viewport.
    let px = 0
    let py = 0

    const ukur = () => {
      const r = n.getBoundingClientRect()
      px = r.left - x + n.offsetWidth / 2
      py = r.top - y + n.offsetHeight / 2
    }

    let id = 0
    let sebelum = 0
    // 70 ms. Bentuk `1 - exp(-dt/TAU)`, bukan konstanta lerp polos: konstanta
    // polos diam-diam berjalan dua kali lebih cepat di layar 120Hz.
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
      // Pulangnya dianimasikan GSAP; ambil alih dulu, lalu baca posisinya
      // kembali supaya tidak ada loncatan di titik serah terima.
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
    // Pulangnya tetap milik GSAP: pantulan elastis adalah wataknya tombol ini,
    // dan ia cuma sekali per lepas-hover. Loop di atas dihentikan lebih dulu
    // supaya tidak pernah ada dua yang menulis transform yang sama.
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

/** Kompas ringkas yang berdiri diam di gulir lintang. */
function KompasCerita({ aktif }: { aktif: string | null }) {
  return (
    // `bg-white/[0.9]` menimpa isian .g-kaca-tebal, dan itu disengaja: panel
    // kuadran lewat DI BELAKANG kartu ini. Sejak backdrop-filter dicabut demi
    // kecepatan, tidak ada lagi blur yang mengaburkan apa pun di belakangnya —
    // jadi yang harus menutup isiannya sendiri.
    <div className="g-kaca-tebal rounded-[22px] bg-[color:var(--g-kartu-pekat)] p-5">
      <p className="eyebrow mb-3.5 text-[color:var(--g-ink-3)]">Kompas Kuadran</p>
      <div className="flex items-stretch gap-2.5">
        <span className="eyebrow shrink-0 self-center rotate-180 whitespace-nowrap text-[color:var(--g-ink-3)] [writing-mode:vertical-rl]">
          {LABEL_SKOR}
        </span>
        <div className="min-w-0 flex-1">
          <div className="relative aspect-square w-full">
            {URUTAN_KUADRAN.map((kunci) => {
              const q = KUADRAN[kunci]
              const [kolom, baris] = q.sel
              const nyala = aktif === kunci
              return (
                <div
                  key={kunci}
                  data-q={kunci}
                  className="absolute flex flex-col p-3 transition-all duration-500 ease-liquid"
                  style={{
                    left: kolom === 0 ? 0 : '50%',
                    right: kolom === 0 ? '50%' : 0,
                    top: baris === 0 ? 0 : '50%',
                    bottom: baris === 0 ? '50%' : 0,
                    background: nyala ? q.lembut : 'transparent',
                    opacity: aktif === null ? 0.9 : nyala ? 1 : 0.3,
                    borderRight: kolom === 0 ? '1px solid var(--g-garis-halus)' : undefined,
                    borderBottom: baris === 0 ? '1px solid var(--g-garis-halus)' : undefined,
                    alignItems: kolom === 1 ? 'flex-end' : 'flex-start',
                    justifyContent: baris === 1 ? 'flex-end' : 'flex-start',
                    textAlign: kolom === 1 ? 'right' : 'left',
                  }}
                >
                  <Glif kuadran={kunci} ukuran={16} />
                  <span className="mt-1.5 text-[12.5px] font-semibold leading-[1.15]" style={{ color: q.warna }}>
                    {q.nama}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="mt-2 grid grid-cols-[auto_1fr_auto] items-baseline gap-1.5 text-[color:var(--g-ink-3)]">
            <span className="text-[10.5px]">biasa</span>
            <span className="eyebrow whitespace-nowrap text-center text-[10px] text-[color:var(--g-ink-3)]">Prestise visual</span>
            <span className="text-[10.5px]">mahal</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function PitaBerjalan() {
  return (
    // Dua lapis: yang dalam dimiringkan lalu dibesarkan 6% supaya ujungnya tetap
    // menutup layar setelah diputar; tanpa pembungkus yang menggunting,
    // kelebihan 6% itu menambah 44px ke scrollWidth halaman.
    // `py-7` pada pembungkus luar BUKAN jarak hiasan.
    //
    // Pita di dalamnya dimiringkan 1,6 derajat, dan kemiringan tidak mengubah
    // tinggi tata letak - pembungkusnya tetap setinggi pita yang belum diputar.
    // Akibatnya sudut kanan-atas dan kiri-bawah pita menonjol keluar kotak lalu
    // digunting `overflow-hidden`, dan yang terlihat pita yang terpotong miring
    // di kedua ujungnya. Setengah lebar pita 763px x sin(1,6 derajat) = 21px,
    // jadi 28px sudah cukup dengan sisa.
    <div className="relative overflow-hidden py-7" aria-hidden>
      {/* Tanpa backdrop-blur: pita ini selebar layar, dan yang di belakangnya
          gradien halaman - yang di-blur maupun tidak, hasilnya sama. */}
      <div
        className="-rotate-[1.6deg] scale-[1.06] overflow-hidden py-3.5"
        style={{
          // Ikut palet, bukan putih mati. Pita putih di atas halaman gelap
          // terbaca sebagai potongan yang lupa diwarnai - dan tulisannya
          // ikut jatuh di bawah ambang baca.
          background: 'var(--g-kaca-isi)',
          borderTop: '1px solid var(--g-kaca-tepi)',
          borderBottom: '1px solid var(--g-kaca-tepi)',
        }}
      >
        <div className="g-jalan flex w-max">
          {[0, 1].map((salinan) => (
            <div
              key={salinan}
              className="flex shrink-0 items-center gap-9 pr-9 text-[11px] font-semibold uppercase tracking-[0.28em] text-[color:var(--g-ink-2)]"
            >
              {FITUR.map((f) => (
                <span key={f.nama} className="flex shrink-0 items-center gap-9 whitespace-nowrap">
                  {f.nama}
                  <span className="text-[color:var(--g-teal-2)]">✦</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Halaman
// ---------------------------------------------------------------------------

export default function Gerbang({ onMasuk }: { onMasuk: (pilihan?: PilihanKawasan) => void }) {
  const akar = useRef<HTMLDivElement>(null)
  const hero = useRef<HTMLElement>(null)
  /** Wadah setinggi beberapa layar; ia yang memberi jarak gulir. */
  const lintasan = useRef<HTMLDivElement>(null)
  /** Deret panel yang digeser ke samping di dalamnya. */
  const rel = useRef<HTMLDivElement>(null)

  const [gerakMati] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  /**
   * Kuadran yang disorot pada render PERTAMA saja.
   *
   * Sesudah itu sorotan tidak lagi lewat React — lintasan gulir menulisnya
   * langsung ke DOM (lihat `sorot()` di efek di bawah), karena satu render
   * ulang seluruh halaman tiap kali panel berganti jatuh persis di bingkai yang
   * paling terlihat. Nilainya tetap dipakai untuk keadaan awal dan untuk mode
   * gerak-dimatikan, yang memang tidak punya lintasan gulir.
   */
  const [langkah] = useState<number | null>(() => (gerakMati ? 0 : null))
  /** Simpul pipeline yang sedang disentuh gumpalan cairan. */
  const [simpul, setSimpul] = useState(-1)
  /** Bilah atas berganti bahan begitu halaman masuk jurang. */
  const [navGelap, setNavGelap] = useState(false)

  /**
   * Tampilan gelap halaman gerbang.
   *
   * Dibaca lewat INISIALISATOR useState, bukan lewat efek. Nilai yang dipulihkan
   * dari localStorage lalu dipakai di efek yang cuma jalan sekali adalah pola
   * yang sudah dua kali salah di repo ini - basemap gelap yang tidak pernah
   * terpasang, dan kamera yang tidak pernah terbang ke kawasan tersimpan.
   * Inisialisator tidak punya celah itu: nilainya sudah benar di render pertama.
   */
  const [gelap, setGelapMentah] = useState(() => {
    try {
      return localStorage.getItem(KUNCI_TEMA) === 'gelap'
    } catch {
      // Mode penyamaran memblokir localStorage sama sekali. Halamannya tetap
      // harus tampil, cuma tanpa mengingat pilihannya.
      return false
    }
  })
  const setGelap = useCallback((v: boolean) => {
    setGelapMentah(v)
    try {
      localStorage.setItem(KUNCI_TEMA, v ? 'gelap' : 'terang')
    } catch {
      /* sama alasannya dengan di atas */
    }
  }, [])

  const keBagian = useCallback((id: string) => {
    const wadah = akar.current
    const sasaran = wadah?.querySelector<HTMLElement>(`#${id}`)
    if (!wadah || !sasaran) return
    wadah.scrollTo({ top: sasaran.offsetTop - 72, behavior: 'smooth' })
  }, [])

  const keAtas = useCallback(() => akar.current?.scrollTo({ top: 0, behavior: 'smooth' }), [])

  useEffect(() => {
    if (gerakMati) return

    // Yang menggulir adalah AKAR halaman ini, bukan window. `.gerbang` dipasang
    // `fixed inset-0 overflow-y-auto` supaya ia menutupi aplikasi di belakangnya
    // tanpa mengubah tinggi dokumen — akibatnya ScrollTrigger, yang secara
    // bawaan memantau window, tidak pernah melihat satu piksel pun bergulir.
    // `scroller` WAJIB ada di SETIAP ScrollTrigger di berkas ini.
    const scroller = akar.current
    if (!scroller) return
    /** Pembersih yang tidak diurus gsap.context — pendengar global miliknya. */
    const pembersih: (() => void)[] = []

    // Lingkupnya ELEMEN, bukan objek ref.
    //
    // `gsap.context(fn, akar)` menerima ref dan membacanya lewat
    // `value.current` setiap kali sebuah selektor dipakai. Itu baik-baik saja
    // selama komponennya hidup - tetapi `ctx.revert()` di pembersihan berjalan
    // SESUDAH React melepas ref-nya, jadi `akar.current` sudah null dan GSAP
    // memperingatkan "Invalid scope" untuk tiap selektor yang ia bereskan.
    // Terukur: enam belas peringatan, semuanya tepat saat gerbang ditutup.
    //
    // Elemennya sendiri tidak pernah jadi null. Diambil sekali di sini, ia
    // tetap sah sampai pembersihan selesai.
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

      // Kartu dek melayang: SEKARANG ANIMASI CSS, bukan tween GSAP.
      //
      // Tween tak berujung menulis transform dari JavaScript setiap bingkai,
      // selamanya - termasuk saat kartunya jauh di luar layar. Enam kartu di
      // sini plus tiga bola kaca di hero berarti sembilan penulisan transform
      // per bingkai yang tidak pernah berhenti. Terukur saat halaman DIAM:
      // 0,49 dtk skrip dalam delapan detik, 10,4% utas utama terbakar untuk
      // halaman yang tidak sedang diapa-apakan siapa pun.
      //
      // `@keyframes` pada `transform` berjalan di compositor: nol pekerjaan
      // utas utama. Kemiringan statisnya ikut pindah ke CSS lewat variabel
      // `--condong`, jadi tidak ada lagi dua penulis untuk satu properti.
      gsap.utils.toArray<HTMLElement>('.g-apung').forEach((el, i) => {
        // Cuma jeda dan durasinya yang berbeda per kartu. Keduanya properti
        // animasi, bukan isi keyframe, jadi keduanya tidak menghalangi
        // pengompositan - beda dengan nilai transform yang memakai var().
        el.style.animationDelay = `${(i * 0.28).toFixed(2)}s`
        el.style.animationDuration = `${(3.1 + i * 0.37).toFixed(2)}s`
      })

      // --- ADEGAN: tiap bagian masuk dan keluar layar sebagai satu benda -----
      //
      // Satu timeline yang dipetakan ke SELURUH perjalanan bagian itu melewati
      // layar: seperempat pertama untuk masuk, separuh tengah diam, seperempat
      // terakhir untuk mundur. Karena `scrub`, seluruhnya terikat jari - bukan
      // klip yang berjalan sendiri lalu selesai sebelum sempat dilihat.
      //
      // Yang mundur TIDAK sampai hilang (0,25, bukan 0). Bagian yang benar-benar
      // menghilang membuat orang yang menggulir balik merasa halamannya kosong.
      gsap.utils.toArray<HTMLElement>('.g-adegan').forEach((el) => {
        gsap
          .timeline({
            scrollTrigger: {
              scroller,
              trigger: el,
              start: 'top bottom',
              end: 'bottom top',
              scrub: 0.7,
              /**
               * `will-change` dipasang dan DICABUT, bukan ditulis permanen di
               * CSS.
               *
               * Ia memindahkan bagian ini ke lapisan komposit sendiri, jadi
               * perubahan opacity dan transform-nya diurus compositor alih-alih
               * memaksa seluruh isinya dilukis ulang. Tapi lapisan setinggi
               * layar juga memakan memori GPU, dan menuliskannya di CSS berarti
               * KEENAM bagian memegang lapisannya masing-masing selamanya -
               * termasuk lima yang sedang jauh di luar layar.
               *
               * Dipasang lewat onToggle, yang hidup cuma dua sampai tiga
               * sekaligus: yang sedang lewat, dan tetangganya.
               */
              onToggle: (self) => {
                el.style.willChange = self.isActive ? 'transform, opacity' : 'auto'
              },
            },
          })
          .fromTo(
            el,
            { y: 84, opacity: 0, scale: 0.975 },
            { y: 0, opacity: 1, scale: 1, ease: 'power2.out', duration: 0.28 },
          )
          .to(el, { duration: 0.44 })
          .to(el, { y: -64, opacity: 0.25, scale: 0.985, ease: 'power2.in', duration: 0.28 })
      })

      /**
       * Netralkan adegan SEBELUM ScrollTrigger mengukur apa pun.
       *
       * Ini bukan kehati-hatian berlebihan. Bagian yang sedang di-scrub membawa
       * `y` sampai +84px, dan seluruh pemicu DI DALAMNYA - kartu, rel cairan,
       * angka - diukur dengan `getBoundingClientRect`. Kalau pengukuran terjadi
       * saat bagiannya sedang tergeser, tiap pemicu di dalamnya ikut tergeser
       * 84px dan menyala di tempat yang salah. Penyegaran memang terjadi
       * berkali-kali: setelah kartu dek selesai memotret, dan pada tiap
       * perubahan ukuran jendela.
       *
       * `refreshInit` menyala sebelum pengukuran, `refresh` sesudahnya - jadi
       * jendela netralnya persis selebar yang dibutuhkan.
       */
      const netralkan = () => gsap.set('.g-adegan', { y: 0, opacity: 1, scale: 1 })
      ScrollTrigger.addEventListener('refreshInit', netralkan)
      pembersih.push(() => ScrollTrigger.removeEventListener('refreshInit', netralkan))

      // --- Kartu dek: masuk dan keluar mengikuti gulir ----------------------
      //
      // Lapisan sendiri, bukan menumpang pada pembungkus yang melayang maupun
      // pada tombol yang condong mengikuti kursor — ketiganya menulis transform,
      // dan GSAP menulis seluruh transform sekaligus.
      gsap.utils.toArray<HTMLElement>('.g-kartu-masuk').forEach((el) => {
        gsap
          .timeline({
            scrollTrigger: { scroller, trigger: el, start: 'top bottom', end: 'bottom top', scrub: 0.6 },
          })
          .fromTo(
            el,
            { y: 96, opacity: 0, scale: 0.9 },
            { y: 0, opacity: 1, scale: 1, ease: 'power2.out', duration: 0.3 },
          )
          .to(el, { duration: 0.42 })
          .to(el, { y: -76, opacity: 0, scale: 0.93, ease: 'power2.in', duration: 0.28 })
      })

      // --- Kemunculan bagian: tiga cara, dipilih menurut isinya --------------
      //
      // Satu animasi masuk untuk segalanya membuat halaman terasa seperti satu
      // template. Yang di bawah ini tiga gerakan yang berbeda sifatnya, dan
      // tiap bagian memakai yang cocok.

      // (a) TIRAI — judul terungkap dari bawah ke atas lewat clip-path.
      gsap.utils.toArray<HTMLElement>('.g-tirai').forEach((el) => {
        gsap.from(el, {
          clipPath: 'inset(100% 0% 0% 0%)',
          y: 34,
          duration: 1.05,
          ease: 'power4.out',
          scrollTrigger: { scroller, trigger: el, start: 'top 88%' },
        })
      })

      // (b) DALAM — kartu datang dari kedalaman.
      //
      // Dulu ia juga menganimasikan `filter: blur(14px)`. Blur bukan properti
      // compositor: tiap bingkai animasinya, seluruh kartu harus dilukis ulang
      // lalu di-blur ulang — dan empat belas kartu memakainya. Yang tersisa
      // sekarang y + opacity + scale, ketiganya ditangani compositor, dan
      // bedanya di mata nyaris tidak ada.
      gsap.utils.toArray<HTMLElement>('.g-buram').forEach((el, i) => {
        gsap.from(el, {
          y: 58,
          opacity: 0,
          scale: 0.94,
          duration: 0.95,
          delay: (i % 3) * 0.09,
          ease: 'power3.out',
          scrollTrigger: { scroller, trigger: el, start: 'top 90%' },
        })
      })

      // (c) BALIK — kartu berputar masuk pada sumbu tegaknya.
      gsap.utils.toArray<HTMLElement>('.g-balik').forEach((el, i) => {
        gsap.from(el, {
          rotateY: -46,
          z: -160,
          opacity: 0,
          duration: 1,
          delay: (i % 3) * 0.1,
          ease: 'power3.out',
          scrollTrigger: { scroller, trigger: el, start: 'top 90%' },
        })
      })

      // --- Tesis: kata demi kata, terikat gulir ------------------------------
      //
      // Mulai dari 0,14 dan bukan 0. Kata yang benar-benar tak terlihat membuat
      // paragrafnya berubah panjang di mata pembaca saat terisi; jejak samar
      // menjaga bentuknya utuh, dan yang berubah cuma kontrasnya.
      gsap.fromTo(
        '.g-kata',
        { opacity: 0.14 },
        {
          opacity: 1,
          ease: 'none',
          stagger: 0.5,
          scrollTrigger: { scroller, trigger: '.g-tesis', start: 'top 80%', end: 'bottom 66%', scrub: 0.6 },
        },
      )

      // --- LINTANG: gulir turun, panel bergeser ke samping DAN saling menimpa -
      //
      // TANPA `pin`. Yang menahan bagiannya di layar `position: sticky` di
      // markupnya, dan itu diurus peramban di compositor. Yang dikerjakan di
      // sini tinggal satu: menggeser lintasannya ke kiri sejauh gulir.
      //
      // Rentangnya diikat pada WADAH lintasan, bukan pada elemen yang menempel:
      // `top top` menyala saat wadahnya mulai menempel, `bottom bottom` selesai
      // saat wadahnya berhenti menempel. Jadi geseran menyamping persis sepanjang
      // umur menempelnya, tidak sedetik lebih.
      const relEl = rel.current
      const wadahEl = lintasan.current
      if (relEl && wadahEl && scroller) {
        const jarak = () => Math.max(0, relEl.scrollWidth - scroller.clientWidth)

        /**
         * Tinggi wadah = jarak geser + satu layar.
         *
         * Itu satu-satunya tinggi yang membuat geseran menyamping berhenti
         * TEPAT saat elemen yang menempel dilepas. Ditulis sebagai angka vh, ia
         * hanya benar untuk satu lebar layar: pada layar lebar panelnya sudah
         * habis lama sebelum lintasannya, dan yang terlihat satu layar penuh
         * yang menempel tanpa satu pun yang bergerak.
         *
         * Dipasang di `refreshInit`, yang menyala SEBELUM ScrollTrigger mengukur
         * apa pun — jadi tinggi barunya sudah berlaku ketika seluruh pemicu di
         * halaman ini menghitung posisinya.
         */
        const aturTinggi = () => {
          wadahEl.style.height = `${jarak() + scroller.clientHeight}px`
        }
        aturTinggi()
        ScrollTrigger.addEventListener('refreshInit', aturTinggi)
        pembersih.push(() => ScrollTrigger.removeEventListener('refreshInit', aturTinggi))

        /**
         * Geometri panel dibaca SEKALI per penyegaran, bukan tiap bingkai.
         *
         * `getBoundingClientRect()` di dalam `onUpdate` memaksa peramban
         * menghitung ulang tata letak sebelum menjawab — empat kali per bingkai,
         * di tengah animasi yang juga sedang menulis transform. `offsetLeft` dan
         * `clientWidth` tidak ikut bergeser bersama transform, jadi keduanya
         * cukup dibaca saat penyegaran.
         */
        let geo: { tengah: number; lebar: number }[] = []
        let baca = 0

        const ukurUlang = () => {
          const awal = relEl.children[0] as HTMLElement | undefined
          if (!awal) return
          // Semua dalam koordinat lintasan itu sendiri, jadi tidak ada satu pun
          // pembacaan yang bergantung posisi gulir saat diukur.
          baca = awal.offsetLeft + awal.clientWidth / 2
          geo = Array.from(relEl.children).map((c) => {
            const el = c as HTMLElement
            return { tengah: el.offsetLeft + el.clientWidth / 2, lebar: el.clientWidth }
          })
        }

        /**
         * Satu lintasan, dua pekerjaan: menentukan panel yang sedang dibaca DAN
         * menyusun kedalaman seluruh panel.
         *
         * Panel tidak sekadar bergeser — ia menimpa. Yang sedang dibaca maju ke
         * depan dan tegak; makin jauh dari titik baca, makin ia berputar
         * menjauh, mundur di sumbu Z, dan mengecil. Karena panelnya sengaja
         * dibuat bertumpang (margin negatif), susunan itulah yang menentukan
         * mana yang menutupi mana.
         */
        /**
         * Sorotan kompas dan titik kemajuan ditulis LANGSUNG ke DOM, tidak lewat
         * state React.
         *
         * Versi sebelumnya memanggil `setLangkah()` dari dalam lintasan gulir.
         * React memang berhenti kalau nilainya sama, tetapi begitu panel
         * berganti — empat kali sepanjang bagian ini — ia me-render ulang
         * SELURUH komponen gerbang: 767 elemen direkonsiliasi, tepat pada
         * bingkai yang sedang juga menggeser empat kartu. Itu tersendat, dan
         * tersendatnya jatuh persis di saat yang paling terlihat.
         *
         * Yang diubah di sini cuma dua properti pada delapan elemen, dan
         * keduanya sudah punya `transition` di CSS-nya masing-masing — jadi
         * pergantiannya tetap halus tanpa satu pun render React.
         */
        //
        // TANPA penjaga "kalau indeksnya sama, lewati". React masih boleh
        // me-render ulang komponen ini karena sebab lain (bilah atas berubah
        // gelap, simpul pipeline bergeser), dan render itu MENGEMBALIKAN gaya
        // sebaris ke keadaan awalnya. Dengan penjaga, sorotannya hilang dan
        // tidak pernah kembali karena indeksnya memang tidak berubah. Menulis
        // ulang delapan properti gaya per detak tidak memaksa perhitungan tata
        // letak apa pun; harganya nol dibanding kelas kesalahan yang dihapusnya.
        const sorot = (i: number) => {
          const kunci = LANGKAH_TESIS[i]?.kunci
          if (!kunci) return
          for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-q]'))) {
            const ini = el.dataset.q === kunci
            el.style.background = ini ? KUADRAN[el.dataset.q ?? ''].lembut : 'transparent'
            el.style.opacity = ini ? '1' : '0.3'
          }
          for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-titik]'))) {
            const ini = Number(el.dataset.titik) === i
            el.style.width = ini ? '34px' : '10px'
            el.style.background = ini
              ? KUADRAN[LANGKAH_TESIS[Number(el.dataset.titik)].kunci].warna
              : 'var(--g-garis-halus)'
          }
        }

        const susun = () => {
          if (!geo.length) return
          // Dibaca dari cache transform milik GSAP, bukan dari tata letak.
          const geser = (gsap.getProperty(relEl, 'x') as number) || 0
          let pilih = 0
          let dekat = Infinity
          for (let i = 0; i < geo.length; i++) {
            const d = (geo[i].tengah + geser - baca) / geo[i].lebar
            const jauh = Math.min(Math.abs(d), 1.6)
            // TANPA `z`. Menggeser di sumbu Z memaksa perender menggambar
            // ulang kartunya pada kedalaman baru tiap bingkai — dan yang
            // dibelinya cuma perbedaan skala yang sudah dikerjakan `scale`
            // langsung, jauh lebih murah. Kesan menimpanya datang dari
            // rotateY + zIndex, dan keduanya tetap.
            gsap.set(relEl.children[i], {
              rotateY: Math.max(-28, Math.min(28, -d * 24)),
              scale: 1 - jauh * 0.11,
              opacity: 1 - jauh * 0.6,
              zIndex: Math.round(100 - jauh * 40),
            })
            if (Math.abs(d) < dekat) {
              dekat = Math.abs(d)
              pilih = i
            }
          }
          sorot(pilih)
        }
        ukurUlang()

        gsap.to(relEl, {
          x: () => -jarak(),
          ease: 'none',
          onUpdate: susun,
          scrollTrigger: {
            scroller,
            trigger: wadahEl,
            start: 'top top',
            end: 'bottom bottom',
            scrub: 0.5,
            invalidateOnRefresh: true,
            // Keempat panel dipromosikan ke lapisannya sendiri HANYA selama
            // bagian ini dilewati. Tanpa itu, tiap bingkai memaksa keempat
            // kartu kaca berbayang lebar dilukis ulang pada sudut dan skala
            // yang baru; dengan itu, teksturnya dilukis sekali lalu diputar di
            // GPU. Dicabut lagi begitu bagiannya lewat — empat lapisan sebesar
            // kartu ini tidak perlu memegang memori GPU sepanjang halaman.
            onToggle: (self) => {
              const nilai = self.isActive ? 'transform, opacity' : 'auto'
              for (const c of Array.from(relEl.children)) {
                ;(c as HTMLElement).style.willChange = nilai
              }
            },
            onRefresh: () => {
              ukurUlang()
              susun()
            },
          },
        })
      }

      // --- CAIRAN: gumpalan menuruni rel pipeline ---------------------------
      //
      // Yang membuatnya terbaca sebagai cairan bukan bentuknya, melainkan
      // PENGGABUNGANNYA: gumpalan yang turun dan simpul yang diam melebur jadi
      // satu badan saat berdekatan, lalu terlepas lagi. Efek itu datang dari
      // filter #g-lengket — blur lalu ambang alfa — dan tidak bisa ditiru satu
      // transisi CSS pun.
      /**
       * Simpul diletakkan di TENGAH kartunya masing-masing, bukan dibagi rata
       * sepanjang rel.
       *
       * Kartunya tidak sama tinggi — satu paragraf lebih panjang dari yang lain
       * — jadi pembagian rata membuat gumpalan melebur di simpul yang sedang
       * tidak sejajar dengan kartu mana pun. Seluruh gunanya efek ini justru
       * pertemuan itu.
       */
      const taruhSimpul = () => {
        const relPipa = document.querySelector<HTMLElement>('.g-rel-cairan')
        if (!relPipa) return
        const dasar = relPipa.getBoundingClientRect().top
        const kartu = Array.from(document.querySelectorAll<HTMLElement>('.g-pipa article'))
        document.querySelectorAll<HTMLElement>('.g-simpul').forEach((simpulEl, i) => {
          const k = kartu[i]
          if (!k) return
          const r = k.getBoundingClientRect()
          simpulEl.style.top = `${Math.round(r.top + r.height / 2 - dasar - simpulEl.offsetHeight / 2)}px`
        })
      }
      taruhSimpul()

      const gumpal = { t: 0 }
      gsap.to(gumpal, {
        t: 1,
        ease: 'none',
        // Pemicunya REL-nya sendiri, dan batasnya 'top 50%' → 'bottom 50%'.
        //
        // Itu bukan angka yang dicoba-coba: dengan batas ini kemajuan bernilai
        // 0 tepat saat ujung atas rel menyentuh garis tengah layar dan 1 saat
        // ujung bawahnya menyentuh garis yang sama. Karena posisi gumpalan
        // dihitung sebagai kemajuan x tinggi rel, gumpalannya jadi selalu
        // berada persis di garis tengah layar - tempat mata membaca.
        //
        // Versi sebelumnya memicu dari SECTION dengan 'top 74%', dan bagian ini
        // setinggi layar: gumpalannya sudah sampai simpul keempat ketika yang
        // terbaca di layar baru kartu kedua.
        scrollTrigger: {
          scroller,
          trigger: '.g-rel-cairan',
          start: 'top 50%',
          end: 'bottom 50%',
          scrub: 0.45,
          onRefresh: taruhSimpul,
        },
        onUpdate: () => {
          const relPipa = document.querySelector<HTMLElement>('.g-rel-cairan')
          const bola = document.querySelector<HTMLElement>('.g-gumpal')
          if (!relPipa || !bola) return
          const tinggi = relPipa.clientHeight
          gsap.set(bola, { y: gumpal.t * tinggi })
          // Simpul yang sedang disentuh dihitung dari posisi gumpalan itu
          // sendiri, bukan dari kemajuan gulir — keduanya tidak sebanding
          // karena simpulnya tidak berjarak sama.
          const simpulEl = Array.from(document.querySelectorAll<HTMLElement>('.g-simpul'))
          let pilih = -1
          let dekat = Infinity
          simpulEl.forEach((s, i) => {
            const d = Math.abs(s.offsetTop + s.clientHeight / 2 - gumpal.t * tinggi)
            if (d < dekat && d < 110) {
              dekat = d
              pilih = i
            }
          })
          setSimpul(pilih)
        },
      })
      gsap.fromTo(
        '.g-rel-isi',
        { scaleY: 0 },
        {
          scaleY: 1,
          ease: 'none',
          scrollTrigger: {
            scroller,
            trigger: '.g-rel-cairan',
            start: 'top 50%',
            end: 'bottom 50%',
            scrub: 0.45,
          },
        },
      )

      // --- Angka yang berjalan naik ------------------------------------------
      //
      // Nilai akhirnya sudah tertulis di HTML, jadi kalau efek ini tidak pernah
      // jalan — gerak dimatikan, JavaScript gagal — yang terbaca tetap angka
      // yang benar, bukan nol.
      gsap.utils.toArray<HTMLElement>('.g-hitung').forEach((el) => {
        const akhir = Number(el.dataset.nilai ?? '0')
        const kotak = { n: 0 }
        gsap.to(kotak, {
          n: akhir,
          duration: 1.5,
          ease: 'power2.out',
          scrollTrigger: { scroller, trigger: el, start: 'top 88%', once: true },
          onUpdate: () => {
            el.textContent = Math.round(kotak.n).toLocaleString('id-ID')
          },
        })
      })

      // Heksagon bingkai angka tergambar bersamaan dengan angkanya berjalan
      // naik. Dua gerakan, satu pemicu - kalau dipisah, garisnya selesai
      // sebelum angkanya mulai dan keduanya terbaca sebagai dua kejadian.
      gsap.utils.toArray<HTMLElement>('.g-gores').forEach((el) => {
        gsap.to(el, {
          strokeDashoffset: 0,
          duration: 1.5,
          ease: 'power2.out',
          scrollTrigger: { scroller, trigger: el, start: 'top 88%', once: true },
        })
      })

      // --- Nama raksasa di penutup, bergerak lebih lambat dari halamannya ----
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
          scrollTrigger: { scroller, trigger: '.g-jurang', start: 'top 72%', end: 'top -5%', scrub: 0.4 },
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
          scrollTrigger: { scroller, trigger: '.g-jurang', start: 'top 85%', end: 'top -20%', scrub: 0.5 },
        },
      )
      gsap.to('.g-turun', {
        y: -70,
        opacity: 0,
        ease: 'none',
        scrollTrigger: { scroller, trigger: '.g-jurang', start: 'top 55%', end: 'top 5%', scrub: 0.4 },
      })
      // Bilah atas ikut turun ke gelap. Ambangnya sedikit lebih awal daripada
      // saat hitamnya penuh, supaya bilahnya tidak sempat jadi papan putih
      // menyala di atas latar yang sudah separuh gelap.
      ScrollTrigger.create({
        scroller,
        trigger: '.g-jurang',
        start: 'top 46%',
        end: 'bottom top',
        onEnter: () => setNavGelap(true),
        onEnterBack: () => setNavGelap(true),
        onLeaveBack: () => setNavGelap(false),
      })
      // Kartu tim: pemicu PER-ELEMEN. Satu tween berundak yang dipicu wadahnya
      // pernah berhenti di keadaan awalnya tanpa satu pun galat.
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

      // --- Bola kaca: dua gerakan sekaligus ---------------------------------
      //
      // `yPercent` diikat gulir, `x` dan `scale` berjalan sendiri. Keduanya
      // menulis ke properti transform yang sama, tetapi GSAP menyimpan tiap
      // komponen transform terpisah dan menyusunnya ulang - jadi dua tween pada
      // satu elemen tidak saling menimpa selama propertinya berbeda.
      //
      // Hanyut sendiri itu yang membuat hero tidak pernah benar-benar diam,
      // bahkan sebelum satu piksel pun digulir.
      gsap.utils.toArray<HTMLElement>('.g-bola').forEach((el, i) => {
        gsap.to(el, {
          yPercent: -28 - i * 16,
          ease: 'none',
          scrollTrigger: { scroller, trigger: akar.current, start: 'top top', end: 'bottom bottom', scrub: 0.9 },
        })
        // Hanyut sendirinya PINDAH KE CSS, dan dipasang pada PEMBUNGKUS -
        // bukan pada bola yang sama. Dua penulis untuk satu properti transform
        // tidak pernah bisa akur: GSAP menulis seluruh transform sekaligus,
        // jadi apa pun yang ditulis CSS di elemen yang sama akan tertimpa pada
        // tween berikutnya. Pembungkus memberi masing-masing propertinya
        // sendiri - parallax gulir di dalam, hanyut di luar.
        const bungkus = el.parentElement
        if (bungkus?.classList.contains('g-bola-bungkus')) {
          // Arahnya dipilih lewat NAMA keyframe, bukan lewat variabel di dalam
          // keyframe-nya. Dua keyframe berisi angka harfiah tetap bisa
          // dikomposit; satu keyframe ber-`var()` tidak.
          bungkus.style.animationName = i % 2 ? 'g-bola-kanan' : 'g-bola-kiri'
          bungkus.style.animationDelay = `${(i * 0.8).toFixed(2)}s`
          bungkus.style.animationDuration = `${(5.4 + i * 1.5).toFixed(2)}s`
        }
      })
    }, scroller)

    // --- Paralaks motif latar ---------------------------------------------
    //
    // Pendengar gulir langsung, BUKAN ScrollTrigger. Percobaan pertama memakai
    // ScrollTrigger dengan `trigger: akar.current` - dan `akar.current` adalah
    // scroller-nya sendiri. Pemicu yang sama dengan scroller-nya degenerate:
    // start dan end jatuh di titik yang sama, `onUpdate` tidak pernah menyala,
    // dan motifnya diam sepenuhnya. Gagalnya diam - `transform: none` di setiap
    // posisi gulir, tanpa satu pun galat.
    //
    // Pendengar gulir tidak punya semantik pemicu yang bisa salah dipahami.
    // Ia juga lebih murah: satu penulisan per bingkai yang benar-benar bergulir,
    // dan tidak ada apa pun saat halaman diam.
    const motif = Array.from(akar.current?.querySelectorAll<HTMLElement>('.g-motif') ?? [])
    if (motif.length) {
      const tulis = motif.map((el) => gsap.quickSetter(el, 'css'))
      // Berapa derajat cincinnya berputar sepanjang perjalanan bagiannya, dan
      // seberapa besar dasarnya. Dibaca dari elemen supaya tiap bagian bisa
      // punya wajah sendiri tanpa daftar kedua di sini yang harus dijaga tetap
      // sinkron dengan daftar di TEROWONGAN.
      const putar = motif.map((el) => Number(el.dataset.putar ?? 12))

      // Diukur dari PERJALANAN bagiannya melewati layar, bukan dari jarak gulir
      // mentah. Versi pertama memakai `(scrollTop - offsetTop) * laju`, dan
      // konsekuensinya baru terlihat pada bagian yang tinggi: bagian setinggi
      // 3.250 px membuat motifnya berjalan 550 px - jauh keluar dari bagiannya
      // sendiri, lalu tergunting. Dinyatakan sebagai pecahan perjalanan,
      // jaraknya selalu ±amp berapa pun tinggi bagiannya.
      let kotak = motif.map((el) => {
        const s = el.offsetParent as HTMLElement | null
        return { atas: s?.offsetTop ?? 0, tinggi: s?.offsetHeight ?? 1 }
      })
      let layar = scroller.clientHeight
      const ukurUlang = () => {
        layar = scroller.clientHeight
        kotak = motif.map((el) => {
          const s = el.offsetParent as HTMLElement | null
          return { atas: s?.offsetTop ?? 0, tinggi: s?.offsetHeight ?? 1 }
        })
      }

      let rafGeser = 0
      const geser = () => {
        rafGeser = 0
        const y = scroller.scrollTop
        for (let i = 0; i < motif.length; i++) {
          const { atas, tinggi } = kotak[i]
          const sisi = motif[i].offsetHeight
          // -1 saat bagiannya baru mau masuk dari bawah, +1 saat ia baru saja
          // keluar di atas, 0 tepat saat pusatnya di pusat layar.
          const p = Math.max(-1, Math.min(1, (y + layar / 2 - (atas + tinggi / 2)) / ((layar + tinggi) / 2)))
          // Duduk di tengah LAYAR, lalu dijepit supaya tidak keluar dari
          // bagiannya sendiri. Bagian yang lebih pendek daripada layar akan
          // menjepitnya ke tengah bagian, dan itu memang yang benar di sana.
          const tengah = y + layar / 2 - atas - sisi / 2
          const batas = Math.max(0, tinggi - sisi)
          tulis[i]({
            y: Math.max(-sisi * 0.15, Math.min(batas + sisi * 0.15, tengah)),
            // Membesar terus sepanjang perjalanannya - itu yang membuatnya
            // terbaca sebagai sesuatu yang DIDEKATI, bukan yang mengembang lalu
            // mengempis lagi.
            scale: 0.84 + (p + 1) * 0.22,
            rotation: p * putar[i],
            // Memuncak saat bagiannya di tengah layar, hilang di kedua ujungnya.
            // Itu yang menjaga perbatasan antar-bagian tetap bersih.
            opacity: 1 - Math.abs(p),
          })
        }
      }
      const saatGulir = () => {
        if (!rafGeser) rafGeser = requestAnimationFrame(geser)
      }
      geser()
      scroller.addEventListener('scroll', saatGulir, { passive: true })
      window.addEventListener('resize', ukurUlang)
      pembersih.push(() => {
        scroller.removeEventListener('scroll', saatGulir)
        window.removeEventListener('resize', ukurUlang)
        if (rafGeser) cancelAnimationFrame(rafGeser)
      })
    }

    // --- Animasi di bagian yang tidak terlihat DIHENTIKAN -----------------
    //
    // Halaman ini setinggi dua belas ribu piksel dan memuat 28 animasi CSS.
    // Yang terlihat pada satu saat paling banyak sepertiganya; sisanya tetap
    // dikomposit tiap bingkai untuk piksel yang tidak akan dilihat siapa pun.
    //
    // IntersectionObserver, bukan ScrollTrigger ke-18: ia berjalan di luar
    // jalur gulir, jadi menambahnya tidak menambah kerja per bingkai gulir.
    // Bantalan 15% supaya animasinya sudah hidup sebelum bagiannya masuk layar
    // - animasi yang baru mulai tepat saat terlihat akan tertangkap mata
    // sebagai sesuatu yang menyala terlambat.
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

    // Pembatas menggambar dirinya saat masuk layar. Pengamat TERPISAH karena
    // ambangnya berbeda: bagian dijeda dengan bantalan 15% supaya animasinya
    // sudah hidup sebelum terlihat, sementara pembatas justru harus menunggu
    // sampai benar-benar terlihat - garis yang sudah selesai tergambar sebelum
    // orangnya sampai bukan garis yang menggambar dirinya.
    const pengamatBatas = new IntersectionObserver(
      (masuk) => {
        for (const e of masuk) {
          if (e.isIntersecting) {
            ;(e.target as HTMLElement).dataset.tampil = ''
            pengamatBatas.unobserve(e.target)
          }
        }
      },
      { root: akar.current, threshold: 0.6 },
    )
    akar.current?.querySelectorAll('.g-pembatas').forEach((s) => pengamatBatas.observe(s))

    // Kartu dek memotret dirinya asinkron dan bagian lintang mengukur lebarnya
    // sendiri. Dua penyegaran lebih murah daripada menebak urutannya.
    const jam1 = window.setTimeout(() => ScrollTrigger.refresh(), 1400)
    const jam2 = window.setTimeout(() => ScrollTrigger.refresh(), 4200)

    return () => {
      pengamat.disconnect()
      pengamatBatas.disconnect()
      clearTimeout(jam1)
      clearTimeout(jam2)
      pembersih.forEach((f) => f())
      ctx.revert()
    }
  }, [gerakMati])

  return (
    <div
      ref={akar}
      data-tema={gelap ? 'gelap' : 'terang'}
      className="gerbang fixed inset-0 z-[70] overflow-y-auto overflow-x-hidden text-[color:var(--g-ink)]"
    >
      {/* Filter cairan. Nol piksel, dipakai lewat `filter: url(#g-lengket)`. */}
      <svg width="0" height="0" className="absolute" aria-hidden focusable="false">
        <defs>
          <filter id="g-lengket">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="kabur" />
            {/* Ambang alfa: yang setengah transparan hasil blur dipaksa jadi
                pekat atau hilang, dan di situlah dua bentuk yang berdekatan
                menyatu jadi satu badan. */}
            <feColorMatrix
              in="kabur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
            />
          </filter>
          {/* Versi kecil untuk sakelar tema. Blur-nya jauh lebih tipis: rel
              sakelarnya cuma 78px, dan stdDeviation 6 akan melumerkan seluruh
              benda jadi satu gumpalan tanpa bentuk. 3,4 cukup untuk membuat
              gumpalan dan bulatan ujung menyatu saat berdekatan, tidak cukup
              untuk menghapus keduanya. */}
          <filter id="g-cair">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3.4" result="kabur" />
            <feColorMatrix
              in="kabur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8"
            />
          </filter>
        </defs>
      </svg>

      {/* --- Bola kaca latar. aria-hidden: murni hiasan. ------------------- */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {/* Pembungkus membawa hanyut CSS, bola di dalamnya membawa parallax
            gulir dari GSAP. Dua transform yang tidak pernah berebut. */}
        <span className="g-bola-bungkus absolute left-[7%] top-[16%] h-64 w-64">
          <span className="g-bola g-kaca block h-full w-full rounded-full" />
        </span>
        <span className="g-bola-bungkus absolute right-[5%] top-[34%] h-80 w-80">
          <span className="g-bola g-kaca block h-full w-full rounded-full" />
        </span>
        <span className="g-bola-bungkus absolute left-[20%] top-[62%] h-52 w-52">
          <span className="g-bola g-kaca block h-full w-full rounded-full" />
        </span>
      </div>

      {/* --- Bilah atas yang ikut menempel ---------------------------------
          `sticky`, bukan `fixed`. Keduanya terlihat sama di sini, tapi `fixed`
          di dalam wadah yang punya backdrop-filter di salah satu leluhurnya
          adalah kelas jebakan yang sudah pernah kena di repo ini. */}
      <div className="sticky top-0 z-50 px-4 pt-4 sm:px-6">
        <nav
          className={`mx-auto flex max-w-[72rem] items-center gap-4 rounded-full py-2 pl-5 pr-2 transition-colors duration-500 ease-liquid ${
            navGelap ? 'g-nav-gelap' : 'g-nav'
          }`}
        >
          <span className={`papan shrink-0 text-[15px] tracking-[0.02em] ${navGelap ? 'text-white' : ''}`}>
            Loconomics
          </span>
          <span
            className={`hidden min-w-0 flex-1 truncate text-[12px] sm:block ${navGelap ? 'text-white/55' : 'text-[color:var(--g-ink-3)]'}`}
          >
            {IDENTITAS.judulResmi}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {[
              ['Cara kerjanya', 'cara-kerja'],
              ['Tim', 'tim'],
            ].map(([teks, id]) => (
              <button
                key={id}
                onClick={() => keBagian(id)}
                className={`hidden cursor-pointer rounded-full px-4 py-2 text-[13px] font-medium transition-colors sm:block ${
                  navGelap ? 'text-white/70 hover:bg-white/10' : 'text-[color:var(--g-ink-2)] hover:bg-white/50'
                }`}
              >
                {teks}
              </button>
            ))}
            {/* Tombol akun DI SEBELAH KIRI "Masuk ke peta", bukan menggantikannya.
                Keduanya menjawab pertanyaan yang berbeda: yang satu "boleh saya
                lihat dulu?", yang lain "apa yang saya dapat kalau bergabung?".
                Menukar salah satunya dengan yang lain akan menutup satu jalan. */}
            <TombolAkun varian="gerbang" />
            <button
              onClick={() => onMasuk()}
              className={`cursor-pointer rounded-full px-5 py-2.5 text-[13.5px] font-semibold ${
                navGelap ? 'g-nav-terbalik' : 'g-utama'
              }`}
            >
              {AJAKAN}
            </button>
          </div>
        </nav>
      </div>

      {/* ================= 1 · HERO ====================================== */}
      <section
        ref={hero}
        className="relative flex min-h-[calc(100vh-5.5rem)] flex-col items-center justify-center overflow-hidden px-6 pb-16 pt-6 text-center"
      >
        {/* Kisi heksagon yang menyala mengikuti kursor. Anak hero, bukan lapisan
            melayang - jadi ia tidak bisa bocor ke bagian mana pun di bawahnya. */}
        <LatarHero />
        <div
          className="pointer-events-none absolute left-1/2 top-[calc(100%-120px)] -z-10 h-[420px] w-[150%] -translate-x-1/2 rounded-[100%] bg-[radial-gradient(closest-side,var(--g-elips)_78%,transparent)] opacity-80"
          aria-hidden
        />

        <p className="g-masuk-awal g-pil mb-7 inline-flex items-center gap-2 rounded-full px-5 py-2 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-[color:var(--g-ink-2)]">
          {IDENTITAS.lomba} · {IDENTITAS.tim}
          <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden className="shrink-0">
            <path d="M4.5 2.5 8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </p>

        {/* Papan nama yang SAMA dengan bilah atas aplikasi — komponen yang
            sama, tempo yang sama, arah getar yang sama. Bedanya cuma ukuran. */}
        <PapanNama
          teks={NAMA}
          kelas="g-judul select-none whitespace-nowrap text-[clamp(2.1rem,9.4vw,6.4rem)] leading-[1.02] tracking-[-0.015em]"
        />

        <p className="g-masuk-awal mx-auto mt-6 max-w-[36rem] text-[clamp(1rem,1.7vw,1.2rem)] leading-relaxed text-[color:var(--g-ink-2)]">
          {IDENTITAS.judulResmi}. Memilih lokasi usaha di sekitar simpul transportasi massal
          Jabodetabek — dengan data survei, bukan firasat.
        </p>

        <div className="g-masuk-awal mt-9 flex flex-wrap items-center justify-center gap-3">
          <Magnet
            onClick={() => onMasuk()}
            kelas="g-utama group inline-flex cursor-pointer items-center gap-3 rounded-full px-8 py-4 text-[15px] font-semibold"
            anak={
              <>
                {AJAKAN}
                <span className="grid h-7 w-7 place-items-center rounded-full bg-white/15 transition-transform duration-300 ease-jelly group-hover:translate-x-1">
                  <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden>
                    <path d="M2 6h8M6.5 2.5 10 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </>
            }
          />
          <Magnet
            onClick={() => keBagian('kawasan')}
            kekuatan={0.22}
            kelas="g-pil cursor-pointer rounded-full px-7 py-4 text-[15px] font-semibold text-[color:var(--g-ink)]"
            anak="Lihat petanya dulu"
          />
        </div>

        <SakelarTema gelap={gelap} onUbah={setGelap} />

        <button
          onClick={() => keBagian('kawasan')}
          className="g-masuk-awal mt-14 flex cursor-pointer items-center gap-2 text-[12px] text-[color:var(--g-ink-3)] transition-opacity hover:opacity-70"
        >
          <span className="g-panah inline-block">↓</span> enam kawasan, enam sudut pandang
        </button>
      </section>

      {/* ================= 2 · PENDIRIAN ================================ */}
      <Pembatas />

      <section
        id="pendirian"
        className="g-adegan relative flex min-h-screen flex-col justify-center px-6 py-28"
      >
        <LatarBagian motif="pendirian" />
        <div className="mx-auto grid w-full max-w-[74rem] items-center gap-14 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div>
            <p className="g-tirai eyebrow mb-6 text-[color:var(--g-ink-3)]">Yang kami percaya</p>
            <h2 className="g-tesis papan text-[clamp(1.7rem,4.6vw,3.3rem)] leading-[1.14] tracking-[-0.01em]">
              {TESIS.split(' ').map((kata, i) => (
                <span key={i} className="g-kata inline-block">
                  {kata}&nbsp;
                </span>
              ))}
            </h2>
          </div>

          {/* Gambar pendamping. Isinya persis apa yang dikatakan kalimatnya:
              hampir semuanya redup, dan yang menyala bukan yang menonjol. */}
          <div className="g-buram g-panel rounded-[26px] p-7">
            <LadangDenyut />
            <p className="mt-4 text-center text-[12px] leading-snug text-[color:var(--g-ink-3)]">
              Yang menyala di sini bukan yang paling menonjol — melainkan yang datanya melampaui
              tampilannya.
            </p>
          </div>
        </div>

        <div className="mx-auto mt-16 grid w-full max-w-[74rem] gap-5 sm:grid-cols-3">
          {PENDIRIAN.map((p, i) => (
            <article key={p.kepala} className="g-buram g-panel rounded-[22px] p-7">
              <span className="tabular mb-4 block text-[11px] font-semibold tracking-[0.16em] text-[color:var(--g-ink-4)]">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="papan text-[16.5px] leading-snug">{p.kepala}</h3>
              <p className="mt-2.5 text-[13.5px] leading-relaxed text-[color:var(--g-ink-2)]">{p.isi}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ================= 3 · DEK KAWASAN =============================== */}
      {/* `g-adegan` dipasang pada bagian yang isinya tidak dipatok maupun
          menempel. Bagian kuadran memakai `pin` dan bagian tim memakai `sticky`;
          transform pada leluhur keduanya akan mematahkan keduanya, jadi
          keduanya memakai transisinya sendiri - gulir lintang dan jurang. */}
      <Pembatas />

      <section
        id="kawasan"
        className="relative flex min-h-screen flex-col justify-center px-6 py-24"
      >
        <LatarBagian motif="kawasan" />
        <div className="mx-auto mb-12 max-w-[48rem] text-center">
          <p className="g-tirai eyebrow mb-4 text-[color:var(--g-ink-3)]">Yang akan Anda pakai</p>
          <h2 className="g-tirai papan text-[clamp(1.6rem,4vw,2.8rem)] leading-tight">
            Enam kawasan pilot, enam sudut pandang
          </h2>
          <p className="g-tirai mx-auto mt-4 max-w-[38rem] text-[14.5px] leading-relaxed text-[color:var(--g-ink-2)]">
            Tiap kartu memakai basemap MAPID dan layer yang berbeda, dan semuanya memuat heksagon
            sungguhan dari basis data — bukan gambar contoh. Sentuh untuk memiringkannya, klik untuk
            membukanya langsung di peta.
          </p>
        </div>

        <DekKawasan onBuka={onMasuk} />

        <p className="mx-auto mt-9 max-w-[44rem] text-center text-[11.5px] leading-snug text-[color:var(--g-ink-4)]">
          Keenamnya gambar diam yang dibuat dari basis data lewat pipeline yang sama dengan
          aplikasinya, bukan tangkapan layar — jadi halaman ini tidak memuat mesin peta sama sekali.
          Angka di tiap kartu dihitung dari data yang sama pada detik yang sama, dipotret{' '}
          <span className="tabular">{DIPOTRET}</span>. Peta yang sesungguhnya, yang bisa digeser dan
          ditanyai, ada di balik tombolnya.
        </p>
      </section>

      <PitaBerjalan />

      {/* ================= 4 · EMPAT KUADRAN (lintasan menempel) =========
          Dibangun ulang 23 Agustus 2026: `pin` milik ScrollTrigger DICABUT,
          diganti `position: sticky`.

          Pin di dalam wadah yang menggulir sendiri (bukan window) tidak bisa
          memakai `position: fixed` — GSAP terpaksa MENGGESER BALIK elemennya
          tiap bingkai sejauh halaman bergulir, supaya ia terlihat diam. Selisih
          sekecil apa pun antara saat peramban menggambar gulirnya dan saat GSAP
          menulis transform-nya terlihat sebagai goyangan, dan selisih itu tidak
          bisa dihilangkan: keduanya berjalan di jalur yang berbeda.

          `sticky` tidak punya masalah itu sama sekali. Yang menahan elemennya
          peramban sendiri, di compositor, tanpa satu baris JavaScript pun —
          jadi tidak ada dua sumber kebenaran yang bisa berselisih. Yang tersisa
          untuk GSAP cuma satu: menggeser lintasannya ke samping.

          Efek sampingnya bonus: tanpa pin tidak ada spacer yang disisipkan, jadi
          seluruh bagian di bawahnya berhenti bergeser saat penyegaran. */}
      <Pembatas />

      <section id="kuadran" className="relative">
        <LatarBagian motif="kuadran" />
        <div className="mx-auto max-w-[52rem] px-6 pt-28 text-center">
          <p className="g-tirai eyebrow mb-4 text-[color:var(--g-ink-3)]">Tesis produk</p>
          <h2 className="g-tirai papan text-[clamp(1.7rem,4.4vw,3rem)] leading-tight">
            Dua sumbu, empat kuadran, dan dua sudut tempat keduanya tidak sejalan
          </h2>
          <p className="g-tirai mx-auto mt-5 max-w-[40rem] text-[15px] leading-relaxed text-[color:var(--g-ink-2)]">
            Sumbu datar: bagaimana sebuah lokasi terlihat. Sumbu tegak: apa kata datanya. Seluruh
            gunanya produk ini terletak pada dua kuadran tempat keduanya berselisih.
          </p>
        </div>

        {gerakMati ? (
          /* Gerak dimatikan: tumpukan tegak biasa. Lintasan menyamping
             bergantung penuh pada gulir; tanpa itu ia jadi baris yang melebihi
             layar tanpa satu pun cara menggulirnya. */
          <div className="mx-auto mt-14 grid max-w-[58rem] gap-6 px-6">
            {LANGKAH_TESIS.map((l, i) => (
              <PanelKuadran key={l.kunci} l={l} i={i} />
            ))}
          </div>
        ) : (
          /* Tinggi lintasan menentukan berapa jauh harus digulir untuk melewati
             keempat panel. Empat panel x 88vh terasa pas: cukup lambat untuk
             dibaca, tidak sampai terasa macet. */
          <div
            ref={lintasan}
            /* Tingginya disetel `aturTinggi()` di efek GSAP, dari jarak geser
               yang sesungguhnya — angka vh apa pun cuma benar untuk satu lebar
               layar. */
            className="relative mt-10"
          >
            {/* `overflow-hidden` WAJIB, dan sempat dicoba dilepas.
                Alasan melepasnya masuk akal — `.gerbang` sudah `overflow-x-hidden`
                jadi luapannya toh tergunting di tingkat halaman — tetapi
                terukur, itu SALAH: dengan `overflow-x: hidden` bersama
                `overflow-y: auto`, peramban tetap melaporkan `scrollWidth`
                selebar isinya. Halaman langsung melompat dari 1440 ke 3296, dan
                lebar berlebih itu ikut dipakai menghitung `100vw` di mana pun.
                Ongkos guntingnya sendiri tidak terukur: median bingkai bagian
                ini sama saja dengan maupun tanpanya. */}
            <div className="sticky top-0 flex h-screen items-center overflow-hidden">
              {/* Kolom kiri: konteks yang tidak ikut bergeser. */}
              <div className="pointer-events-none absolute left-8 top-1/2 z-20 hidden w-[20rem] -translate-y-1/2 lg:block">
                <KompasCerita aktif={langkah === null ? null : LANGKAH_TESIS[langkah].kunci} />
                <p className="mt-5 text-[12px] leading-relaxed text-[color:var(--g-ink-3)]">
                  Batasnya dibelah di <strong className="font-semibold">median</strong>, bukan di
                  tengah kotak — jadi keempat kuadran selalu berisi, berapa pun sebaran datanya.
                </p>
              </div>

              <div
                ref={rel}
                className="flex w-max items-center px-8 lg:pl-[32rem] lg:pr-[32rem]"
                style={{ perspective: 1600 }}
              >
                {LANGKAH_TESIS.map((l, i) => (
                  <PanelKuadran key={l.kunci} l={l} i={i} lintang />
                ))}
              </div>

              {/* Penunjuk kemajuan. Gulir menyamping menghapus satu-satunya
                  petunjuk yang biasanya dipakai orang — bilah gulir. */}
              <div className="pointer-events-none absolute bottom-10 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2">
                {LANGKAH_TESIS.map((l, i) => (
                  <span
                    key={l.kunci}
                    data-titik={i}
                    className="h-1.5 rounded-full transition-all duration-500 ease-liquid"
                    style={{
                      width: langkah === i ? 34 : 10,
                      background: langkah === i ? KUADRAN[l.kunci].warna : 'var(--g-garis-halus)',
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ================= 5 · CARA KERJA (cairan) ====================== */}
      <Pembatas />

      <section
        id="cara-kerja"
        className="g-adegan g-pipa relative flex min-h-screen flex-col justify-center px-6 py-28"
      >
        <LatarBagian motif="cara-kerja" />
        <div className="mx-auto max-w-[48rem] text-center">
          <p className="g-tirai eyebrow mb-4 text-[color:var(--g-ink-3)]">Dari lapangan ke layar</p>
          <h2 className="g-tirai papan text-[clamp(1.7rem,4.4vw,3rem)] leading-tight">
            Lima langkah, dan tidak satu pun yang disembunyikan
          </h2>
        </div>

        <div className="relative mx-auto mt-16 w-full max-w-[52rem] pl-20 sm:pl-28">
          {/* Rel cairan. Rel, simpul, dan gumpalan semuanya di dalam satu
              lapisan ber-filter — hanya benda di dalam lapisan yang sama yang
              bisa melebur satu sama lain. */}
          <div className="g-rel-cairan pointer-events-none absolute bottom-8 left-5 top-8 w-14 sm:left-9" aria-hidden>
            {/* Rel statis DI LUAR lapisan cairan.
                Garis setipis ini tidak pernah selamat dari ambang alfa: setelah
                di-blur, puncak alfanya jatuh jauh di bawah ambang dan ia hilang
                seluruhnya - terukur, versi pertama menggambar relnya di dalam
                filter dan yang tampil cuma titik-titik melayang tanpa jalur. */}
            <span className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-[color:var(--g-ink)]/14" />

            {/* Yang di dalam filter WAJIB tebal. Apa pun yang lebih tipis dari
                sekitar dua kali simpangan blur akan lenyap, bukan melebur. */}
            <div className="g-lengket absolute inset-0">
              <span className="g-rel-isi absolute inset-y-0 left-1/2 w-[15px] -translate-x-1/2 origin-top rounded-full bg-[color:var(--g-teal-terang)]" />
              {PIPA.map((p) => (
                <span
                  key={p.nomor}
                  className="g-simpul absolute left-1/2 top-0 h-7 w-7 -translate-x-1/2 rounded-full bg-[color:var(--g-teal-terang)]"
                />
              ))}
              <span className="g-gumpal absolute left-1/2 top-0 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color:var(--g-teal-tua)]" />
            </div>
          </div>

          {PIPA.map((p, i) => {
            const kena = simpul === i
            return (
              <article
                key={p.nomor}
                className={`g-panel relative mb-6 rounded-[22px] p-7 transition-all duration-500 ease-liquid last:mb-0 ${
                  kena ? 'shadow-[0_28px_60px_-28px_rgb(6_60_53/0.55)]' : ''
                }`}
                style={{
                  transform: kena ? 'translateX(10px)' : 'translateX(0)',
                  borderColor: kena ? 'rgb(47 168 145 / 0.55)' : undefined,
                }}
              >
                <div className="mb-2.5 flex flex-wrap items-center gap-3">
                  <span
                    className="tabular grid h-8 w-8 shrink-0 place-items-center rounded-full text-[12px] font-semibold transition-colors duration-500"
                    style={{
                      background: kena ? 'var(--g-teal)' : 'var(--g-garis-halus-2)',
                      color: kena ? 'var(--g-teks-terang)' : 'var(--g-ink-2)',
                    }}
                  >
                    {p.nomor}
                  </span>
                  <h3 className="papan min-w-0 flex-1 text-[17.5px] leading-snug">{p.kepala}</h3>
                  <span className="shrink-0 rounded-full bg-[color:var(--g-ink)]/6 px-2.5 py-1 text-[11px] font-medium text-[color:var(--g-ink-3)]">
                    {p.tanda}
                  </span>
                </div>
                <p className="text-[14px] leading-relaxed text-[color:var(--g-ink-2)]">{p.isi}</p>
              </article>
            )
          })}
        </div>

        <p className="g-tirai mx-auto mt-12 max-w-[42rem] rounded-[20px] border border-[color:var(--g-ink)]/12 bg-white/45 p-6 text-center text-[13.5px] leading-relaxed text-[color:var(--g-ink-2)]">
          Skornya dihitung di satu tempat saja, di pipeline. Konsultan AI membaca hasilnya dan
          menjelaskannya — ia tidak pernah menghitung sendiri, dan tidak pernah bisa mengubah satu
          angka pun.
        </p>
      </section>

      {/* ================= 6 · ENAM FITUR =============================== */}
      <Pembatas />

      <section
        id="fitur"
        className="g-adegan relative flex min-h-screen flex-col justify-center px-6 py-28"
      >
        <LatarBagian motif="fitur" />
        <div className="mx-auto max-w-[48rem] text-center">
          <p className="g-tirai eyebrow mb-4 text-[color:var(--g-ink-3)]">Yang bisa dilakukan di dalam</p>
          <h2 className="g-tirai papan text-[clamp(1.7rem,4.4vw,3rem)] leading-tight">Enam alat, satu peta</h2>
          <p className="g-tirai mx-auto mt-5 max-w-[36rem] text-[14.5px] leading-relaxed text-[color:var(--g-ink-2)]">
            Semuanya membaca basis data yang sama, dan semuanya menjawab satu pertanyaan yang bisa
            ditanyakan dengan bahasa sehari-hari.
          </p>
        </div>

        <div className="mx-auto mt-14 grid w-full max-w-[74rem] gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FITUR.map((f) => (
            <article
              key={f.nama}
              className="g-balik g-panel group flex flex-col rounded-[24px] p-7"
              style={{ transformStyle: 'preserve-3d' }}
            >
              <div className="mb-5 h-[54px] w-[72px] text-[color:var(--g-teal)] transition-transform duration-500 ease-jelly group-hover:scale-110">
                <svg viewBox="0 0 72 54" className="h-full w-full" aria-hidden>
                  {GAMBAR_FITUR[f.nama]}
                </svg>
              </div>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h3 className="papan text-[18px]">{f.nama}</h3>
                <span className="shrink-0 text-[11.5px] text-[color:var(--g-ink-4)]">{f.ringkas}</span>
              </div>
              <p className="text-[13.5px] leading-relaxed text-[color:var(--g-ink-2)]">{f.isi}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ================= 7 · ANGKA ==================================== */}
      <Pembatas />

      <section className="g-adegan relative flex min-h-screen flex-col justify-center px-6 py-24">
        <LatarBagian motif="angka" />
        <div className="mx-auto mb-14 max-w-[46rem] text-center">
          <p className="g-tirai eyebrow mb-4 text-[color:var(--g-ink-3)]">Yang sudah berdiri</p>
          <h2 className="g-tirai papan text-[clamp(1.5rem,3.6vw,2.4rem)] leading-tight">
            Empat angka yang semuanya bisa diperiksa
          </h2>
        </div>

        <div className="mx-auto grid w-full max-w-[74rem] gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {ANGKA.map((a) => (
            <div key={a.satuan} className="g-buram g-panel flex items-center gap-4 rounded-[22px] p-6">
              <HeksagonAngka
                anak={
                  <span className="papan tabular text-[clamp(1.4rem,2.6vw,1.9rem)] leading-none">
                    <span className="g-hitung" data-nilai={a.nilai}>
                      {a.nilai.toLocaleString('id-ID')}
                    </span>
                  </span>
                }
              />
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold leading-snug text-[color:var(--g-ink-2)]">{a.satuan}</p>
                <p className="mt-1 text-[11.5px] leading-snug text-[color:var(--g-ink-4)]">{a.catatan}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-8 max-w-[42rem] text-center text-[11.5px] leading-snug text-[color:var(--g-ink-4)]">
          Angka di atas berasal dari data demo yang dijalankan lewat pipeline sungguhan, bukan dari
          survei lapangan penuh. Begitu data survei masuk, uji sensitivitasnya diulang dan hasilnya
          dilaporkan apa adanya.
        </p>
      </section>

      {/* ================= 8 · PENUTUP ================================== */}
      <section className="g-adegan g-penutup relative overflow-hidden px-6 pb-14 pt-28">
        <LatarBagian motif="penutup" />
        {/* Tanpa `blur-[70px]`. Elemen sebesar 62vh x 86vw yang di-blur lalu
            di-scale tiap bingkai harus di-blur ULANG tiap bingkai; gradien
            radialnya sendiri sudah selembut hasil blur-nya. */}
        <div className="g-aurora pointer-events-none absolute left-1/2 top-1/2 h-[62vh] w-[86vw] rounded-[50%]" aria-hidden />
        <div className="g-kisi pointer-events-none absolute inset-0" aria-hidden />
        <div className="g-raksasa papan pointer-events-none absolute inset-x-0 bottom-0 select-none text-center" aria-hidden>
          {NAMA}
        </div>

        {/* Judul penutup dibuat benar-benar setebal benda, bukan diberi bayangan
            yang menyerupainya: delapan salinan huruf ditumpuk mundur di sumbu Z.
            `perspective` dipasang di pembungkusnya, dan tidak boleh ada
            `overflow` selain visible di antara keduanya. */}
        <div className="relative mx-auto max-w-[46rem] text-center" style={{ perspective: 900 }}>
          <h2 className="g-tirai">
            <Teks3D
              teks="Siap melihat petanya?"
              kelas="papan text-[clamp(1.8rem,4.6vw,3.2rem)] leading-tight"
            />
          </h2>
          <p className="g-tirai mx-auto mt-4 max-w-[34rem] text-[15px] leading-relaxed text-[color:var(--g-ink-2)]">
            708 heksagon di enam kawasan pilot, lengkap dengan badge keyakinannya masing-masing.
          </p>
          <div className="g-tirai mt-9 flex justify-center">
            <Magnet
              onClick={() => onMasuk()}
              kelas="g-utama group inline-flex cursor-pointer items-center gap-3 rounded-full px-10 py-5 text-[16px] font-semibold"
              anak={
                <>
                  {AJAKAN}
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-white/15 transition-transform duration-300 ease-jelly group-hover:translate-x-1">
                    <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden>
                      <path d="M2 6h8M6.5 2.5 10 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </>
              }
            />
          </div>
        </div>

        {/* --- Kaki. Sengaja DI ATAS bagian tim: yang di bawahnya bukan lagi
            bagian dari halaman produk, melainkan ruangnya sendiri. -------- */}
        <div className="relative mx-auto mt-24 flex max-w-[70rem] flex-col items-center justify-between gap-5 border-t border-[color:var(--g-ink)]/12 pt-7 sm:flex-row">
          <p className="order-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--g-ink-3)] sm:order-1">
            {IDENTITAS.produk} · {IDENTITAS.lomba}
          </p>
          <p className="g-pil order-1 rounded-full px-5 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--g-ink-2)] sm:order-2">
            {IDENTITAS.tema}
          </p>
          <Magnet
            onClick={keAtas}
            label="Kembali ke atas"
            kekuatan={0.4}
            kelas="g-pil order-3 grid h-12 w-12 cursor-pointer place-items-center rounded-full text-[color:var(--g-ink-2)]"
            anak={
              <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
                <path d="M10 15.5V4.5M4.8 9.7 10 4.5l5.2 5.2" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
          />
        </div>
      </section>

      {/* ================= 9 · JURANG → TIM ============================== */}
      <section id="tim" className="g-jurang relative">
        {/* Latar jurang. `sticky` supaya ia menutupi layar selama bagian ini
            dilewati, dan margin bawah negatif setinggi dirinya sendiri supaya
            ia TIDAK memakan tinggi dokumen. */}
        <div className="pointer-events-none sticky top-0 -mb-[100vh] h-screen overflow-hidden" aria-hidden>
          <div className="g-gelap absolute inset-0 opacity-0" />
          <svg
            className="g-terowongan absolute left-1/2 top-1/2 h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2"
            viewBox="-100 -100 200 200"
          >
            {[100, 76, 55, 38, 24, 13].map((r) => (
              <polygon key={r} points={jalurHeks(r)} fill="none" stroke="var(--g-teal-muda)" strokeWidth="0.5" opacity={0.55} />
            ))}
          </svg>
        </div>

        <div className="relative flex h-[115vh] flex-col items-center justify-center px-6 text-center">
          <p className="g-turun eyebrow mb-4 text-[color:var(--g-ink-3)]">Terakhir</p>
          <p className="g-turun papan max-w-[26rem] text-[clamp(1.3rem,3.4vw,2.1rem)] leading-tight">
            Turun lebih dalam
          </p>
          <span className="g-turun g-panah mt-6 block text-[20px] text-[color:var(--g-ink-3)]" aria-hidden>
            ↓
          </span>
        </div>

        <div className="relative px-6 pb-36">
          <div className="mx-auto max-w-[46rem] text-center">
            <p className="eyebrow mb-4 text-white/45">Lima orang</p>
            <h2 className="papan text-[clamp(1.7rem,4.2vw,2.9rem)] leading-tight text-white">Tim di baliknya</h2>
            <p className="mx-auto mt-3 text-[13.5px] text-white/55">
              {IDENTITAS.institusi} · {IDENTITAS.tim}
            </p>
          </div>

          <div className="g-tim-grid mx-auto mt-14 grid max-w-[74rem] gap-5 sm:grid-cols-2 lg:grid-cols-3" style={{ perspective: 1400 }}>
            {PENDIRI.map((o) => (
              <article
                key={o.peran}
                className="g-orang g-kaca-gelap group relative overflow-hidden rounded-[22px] p-7"
                style={{ transformStyle: 'preserve-3d' }}
              >
                {/* Cahaya yang menyala di belakang inisial saat kartunya
                    disentuh. Satu-satunya warna di dasar jurang. */}
                <span
                  className="pointer-events-none absolute -left-10 -top-10 h-40 w-40 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
                  // Satu-satunya warna yang SENGAJA tetap ditulis mati di berkas
                  // ini. Bagian tim duduk di dasar jurang yang selalu hitam di
                  // kedua tampilan, jadi mengikatnya ke palet gerbang justru akan
                  // membuatnya berubah mengikuti tampilan yang tidak berlaku di sini.
                  style={{ background: 'radial-gradient(circle,#2fa891,transparent 70%)' }}
                  aria-hidden
                />
                <div className="relative flex items-start gap-4">
                  <span className="relative grid h-14 w-14 shrink-0 place-items-center" aria-hidden>
                    <svg viewBox="-50 -50 100 100" className="absolute inset-0 h-full w-full">
                      <polygon points={jalurHeks(46)} fill="rgb(255 255 255 / 0.09)" stroke="rgb(255 255 255 / 0.28)" strokeWidth="2" />
                    </svg>
                    <span className="relative text-[14px] font-semibold text-white">{o.inisial}</span>
                  </span>
                  <div className="min-w-0">
                    <p className="text-[15.5px] font-semibold leading-tight text-white">{o.nama}</p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-white/55">
                      {o.peran}
                      {o.ketua && (
                        <span className="rounded-full bg-white/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-white/80">
                          Ketua tim
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <p className="relative mt-5 border-t border-white/10 pt-4 text-[13px] leading-relaxed text-white/65">
                  {o.kerja}
                </p>
              </article>
            ))}
          </div>

          <div className="mt-16 flex justify-center">
            <button
              onClick={keAtas}
              className="g-pil-gelap flex cursor-pointer items-center gap-2.5 rounded-full px-6 py-3 text-[13px] font-medium text-white/70"
            >
              <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden>
                <path d="M10 15.5V4.5M4.8 9.7 10 4.5l5.2 5.2" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Kembali ke permukaan
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
