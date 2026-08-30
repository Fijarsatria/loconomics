/**
 * Layar pembuka - JEMBATAN dari halaman gerbang ke peta, bukan layar pertama.
 *
 * Sampai 23 Agustus 2026 ia berdiri paling depan: dibuka, layar ini dulu yang
 * muncul, baru gerbang, baru peta. Tiga layar berturut-turut sebelum satu pun
 * heksagon terlihat, dan yang pertama dari ketiganya memuat sesuatu yang belum
 * tentu jadi dilihat orangnya.
 *
 * Sekarang urutannya gerbang -> pembuka -> peta, dan pemindahan itu memperbaiki
 * dua hal sekaligus. Halaman gerbang jadi hal pertama yang terlihat, tanpa
 * jeda; dan layar ini akhirnya berada di satu-satunya tempat di mana orang
 * memang sedang menunggu sesuatu - persis setelah menekan "Masuk". Peta sendiri
 * sudah dipasang di belakang gerbang sejak awal, jadi keempat pekerjaannya
 * biasanya sudah selesai sebelum layar ini sempat digambar; TAHAN_MINIMAL_MS
 * yang menahannya cukup lama untuk terbaca sebagai perpindahan.
 *
 * PALETNYA MENGIKUTI GERBANG, bukan aplikasi. Mint #DFF6F0 -> #6DD5C4 yang sama
 * dengan halaman sebelumnya, karena layar ini adalah kelanjutan halaman itu -
 * kalau warnanya berganti gelap di tengah perpindahan, yang terbaca bukan
 * "sedang memuat" melainkan "salah tekan". Warna aplikasi baru masuk bersama
 * petanya.
 *
 * Tiga hal terjadi bersamaan di sini, dan hanya satu yang menghias:
 *
 *   1. KOTA HEKSAGON 3D  — kanvas di belakang. Heksagon adalah bentuk data
 *      proyek ini (H3), jadi kolom yang tumbuh dari cakrawala ke arah penonton
 *      bukan hiasan sembarangan: itu wujud grid yang sedang dimuat.
 *   2. PAPAN NAMA        — sepuluh huruf naik satu per satu, lalu terus
 *      berayun pelan, dengan satu titik warna yang berjalan menyusurinya.
 *   3. KEMAJUAN SUNGGUHAN — bilah di bawah TIDAK palsu. Ia bergerak karena
 *      empat pekerjaan nyata selesai satu per satu.
 *
 * Nomor 3 itu yang penting. Layar pembuka yang menghitung mundur ke angka yang
 * sudah ditentukan adalah kebohongan kecil yang selalu ketahuan: ia penuh
 * padahal aplikasinya belum siap, atau berhenti di 90% padahal sudah siap. Di
 * sini setiap langkah adalah janji yang ditepati - dan kalau backend mati,
 * layar ini yang memberi tahu, lengkap dengan perintah untuk menyalakannya.
 * Persis galat "Failed to fetch" yang tanpa layar ini cuma muncul diam-diam di
 * pojok peta.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react'

import { RODA_WARNA, urlGaya } from '../config'
import { api } from '../lib/api'

const NAMA = 'LOCONOMICS'

/** Empat pekerjaan nyata. Bobotnya sama karena lamanya memang sebanding. */
const LANGKAH = [
  'Menghubungi mesin data',
  'Menyiapkan basemap MAPID',
  'Memuat tipografi',
  'Menyusun grid heksagon',
] as const

/** Kota tidak boleh lewat begitu saja. Di bawah ini pembuka terasa tersentak. */
const TAHAN_MINIMAL_MS = 2400

// ---------------------------------------------------------------------------
// Kota heksagon
// ---------------------------------------------------------------------------

/**
 * Proyeksi lubang jarum, bukan isometrik.
 *
 * Kamera duduk di (camX, TINGGI_KAMERA, 0) menghadap +Z, tanpa rotasi. Pilihan
 * itu disengaja: tanpa rotasi, cakrawala jatuh tepat di tengah kanvas dan
 * seluruh matematikanya cuma dua pembagian. Rotasi kamera akan menambah empat
 * baris trigonometri untuk hasil yang tidak berbeda di mata.
 *
 *   layar.x = cx + f * (X - camX) / (Z + Zdekat)
 *   layar.y = cy - f * (Y - camH) / (Z + Zdekat)
 *
 * Titik tanah punya Y = 0, jadi (Y - camH) negatif dan tanah selalu jatuh di
 * bawah cakrawala. Makin jauh, makin mendekati cakrawala. Itulah kedalamannya.
 */
const SISI = 26 // jari-jari heksagon dalam satuan dunia
const TINGGI_KAMERA = 58
const TINGGI_KOLOM = 80
/** Baris terdekat tidak boleh menempel di lensa; 5,5 sisi memberi latar depan
    yang besar tanpa satu kolom pun menutupi layar. */
const Z_DEKAT = 5.5 * SISI
/** Grid harus jauh lebih lebar daripada layar, karena kolom terjauh menyusut
    sampai seperlima. Kurang dari ini, cakrawala berakhir sebagai pita sempit
    dengan gelap di kiri-kanannya. Yang di luar layar disingkirkan per bingkai,
    jadi lebar ini nyaris tidak berbiaya. */
const KOLOM = 20
const BARIS = 15

/** Heksagon bertopi datar: enam titik sudut pada kelipatan 60°, di bidang XZ. */
const SUDUT = Array.from({ length: 6 }, (_, k) => {
  const a = (Math.PI / 180) * 60 * k
  return { x: Math.cos(a), z: Math.sin(a) }
})

/**
 * Kota tidak lagi memakai warna kuadran.
 *
 * Dulu ia meminjam ketiganya, dan itu memakai warna yang punya arti tepat di
 * layar yang belum punya satu pun data untuk diartikan. Sekarang tiga tingkat
 * teal dari palet gerbang - masih tiga warna supaya kolomnya tidak rata, tetapi
 * tidak satu pun yang menjanjikan sesuatu.
 */
const WARNA_KOTA = ['#1f8f7d', '#2fa891', '#17766a']
const LANGIT_ATAS = '#e9faf5'
const LANGIT_BAWAH = '#7fd3c2'
/** Dasar layar, di bawah cakrawala. Ujung gelap gradien mint gerbang. */
const TANAH = '#4fbfab'
/**
 * Bayangan kolom dijatuhkan ke teal SEDANG, bukan ke hitam dan bukan ke teal
 * gelap.
 *
 * Di langit gelap yang lama, hitam adalah dasar yang benar - sisi yang tidak
 * kena cahaya memang melebur ke latarnya. Di langit mint, apa pun yang lebih
 * gelap dari ini terbaca sebagai lubang di layar, dan lubangnya harus ditutup
 * peredam yang begitu tebal sampai kotanya sendiri ikut hilang - itu yang
 * terjadi pada percobaan pertama, kotanya tidak terlihat sama sekali.
 *
 * Kota di sini watermark, bukan siluet - tapi watermark tetap harus terlihat.
 * Percobaan kedua menaruhnya di #2F8F7F dengan kolom teal muda, dan hasilnya
 * kotanya lenyap sama sekali: tinta, isian, dan langit ketiganya jatuh dalam
 * rentang terang yang sama, jadi tidak ada satu tepi pun yang bisa dibedakan.
 * Yang membuatnya terbaca sebagai ruang adalah beda terang antar sisi heksagon
 * yang sama - dan beda itu butuh jarak dari langitnya.
 */
const TINTA_KOTA = '#124f47'

/** Acak yang stabil: kolom yang sama selalu dapat warna dan fase yang sama. */
function acak(i: number, j: number) {
  const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453
  return n - Math.floor(n)
}

/**
 * Membaca "#rrggbb" MAUPUN "rgb(r,g,b)".
 *
 * Bentuk kedua bukan kelonggaran, melainkan syarat: campur() dipanggil
 * BERSARANG - hasil pencampuran warna dasar dipakai lagi sebagai masukan
 * pencampuran kabut - dan keluarannya sendiri "rgb(...)".
 *
 * Sampai 23 Agustus 2026 parser di sini hanya mengerti heksadesimal, jadi
 * panggilan LUAR selalu mem-parse "rgb(41,148,142)" sebagai heksadesimal dan
 * menghasilkan `rgb(NaN,NaN,7)`. Kanvas menolak fillStyle yang tidak sah TANPA
 * melempar galat: ia diam-diam mempertahankan fillStyle sebelumnya - yang di
 * sini kebetulan gradien langit. Akibatnya seluruh kota digambar dengan warna
 * langit di atas langit, dan layar pembuka ini tampak kosong padahal 16.229
 * heksagon per bingkai benar-benar digambar.
 *
 * Bug ini lebih tua daripada palet terang. Sebelumnya WARNA_KOTA mengambil
 * `KUADRAN.*.warna`, yang sejak palet kuadran pindah ke variabel CSS berisi
 * "var(--q-gem)" - juga bukan heksadesimal, juga NaN, juga diam.
 */
function urai(warna: string): [number, number, number] {
  if (warna.startsWith('#'))
    return [
      parseInt(warna.slice(1, 3), 16),
      parseInt(warna.slice(3, 5), 16),
      parseInt(warna.slice(5, 7), 16),
    ]
  const [r, g, b] = warna.slice(warna.indexOf('(') + 1, -1).split(',').map(Number)
  return [r, g, b]
}

function campur(dari: string, ke: string, t: number) {
  const [r1, g1, b1] = urai(dari)
  const [r2, g2, b2] = urai(ke)
  const m = (a: number, b: number) => Math.round(a + (b - a) * t)
  return `rgb(${m(r1, r2)},${m(g1, g2)},${m(b1, b2)})`
}

function gambarKota(
  ctx: CanvasRenderingContext2D,
  lebar: number,
  tinggi: number,
  detik: number,
) {
  const cx = lebar / 2
  const cy = tinggi * 0.52
  const f = Math.max(lebar, 900) * 0.62
  // Kamera menggeser pelan ke samping. Parallax inilah yang meyakinkan mata
  // bahwa yang dilihatnya ruang, bukan gambar.
  const camX = Math.sin(detik * 0.18) * SISI * 1.4

  const langit = ctx.createLinearGradient(0, 0, 0, tinggi)
  langit.addColorStop(0, LANGIT_ATAS)
  langit.addColorStop(0.55, LANGIT_BAWAH)
  langit.addColorStop(1, TANAH)
  ctx.fillStyle = langit
  ctx.fillRect(0, 0, lebar, tinggi)

  const zJauh = SISI * Math.sqrt(3) * BARIS + Z_DEKAT

  // Jauh dulu, dekat belakangan. Algoritma pelukis - tanpa buffer kedalaman,
  // urutan gambar ADALAH kedalamannya.
  for (let j = BARIS; j >= 0; j--) {
    for (let i = -KOLOM; i <= KOLOM; i++) {
      const X = SISI * 1.5 * i
      const Z = SISI * Math.sqrt(3) * (j + (Math.abs(i) % 2 === 1 ? 0.5 : 0))
      const dz = Z + Z_DEKAT
      if (dz < 1) continue

      // Buang yang di luar layar SEBELUM menghitung apa pun tentangnya. Grid
      // 41×16 hanya menyisakan sekitar seperempat kolom yang benar-benar
      // digambar, dan uji ini dua perkalian.
      const layarX = cx + (f * (X - camX)) / dz
      const lebarLayar = (f * 2 * SISI) / dz
      if (layarX < -lebarLayar || layarX > lebar + lebarLayar) continue
      if (lebarLayar < 2.5) continue

      const r = acak(i, j)
      // Gelombang berjalan dari cakrawala ke arah penonton: kota yang sedang
      // dibangun, bukan kota yang sudah berdiri.
      const fase = detik * 1.15 - j * 0.42 + i * 0.22
      const naik = Math.min(1, Math.max(0, detik * 1.6 - j * 0.09))
      const h = TINGGI_KOLOM * (0.18 + 0.82 * (0.5 + 0.5 * Math.sin(fase))) * naik * (0.55 + r * 0.75)

      const kabut = Math.min(1, Math.max(0, (dz - Z_DEKAT) / (zJauh - Z_DEKAT)))
      if (kabut > 0.985) continue

      const dasar = WARNA_KOTA[Math.floor(r * WARNA_KOTA.length) % WARNA_KOTA.length]
      // Dijepit di 1: pengali tinggi acak bisa membawa h melewati TINGGI_KOLOM,
      // dan campur() dengan t > 1 mengekstrapolasi keluar rentang warna.
      const terang = Math.min(1, 0.35 + 0.65 * (h / TINGGI_KOLOM))

      const proyeksi = (vx: number, vz: number, vy: number) => {
        const pz = Z + vz + Z_DEKAT
        return {
          x: cx + (f * (X + vx - camX)) / pz,
          y: cy - (f * (vy - TINGGI_KAMERA)) / pz,
          z: pz,
        }
      }

      const atas = SUDUT.map((s) => proyeksi(s.x * SISI, s.z * SISI, h))
      const bawah = SUDUT.map((s) => proyeksi(s.x * SISI, s.z * SISI, 0))

      // Sisi yang menghadap kamera saja. Normal keluar sebuah rusuk sama dengan
      // titik tengahnya (heksagon berpusat di titik asal), jadi tidak perlu
      // menghitung silang.
      for (let k = 0; k < 6; k++) {
        const k2 = (k + 1) % 6
        const nx = (SUDUT[k].x + SUDUT[k2].x) / 2
        const nz = (SUDUT[k].z + SUDUT[k2].z) / 2
        const pandang = { x: X - camX, z: dz }
        if (nx * pandang.x + nz * pandang.z >= 0) continue

        // Cahaya dari kiri atas. Sisi kiri lebih terang daripada sisi kanan -
        // tanpa beda ini kolomnya terbaca sebagai siluet datar.
        const cahaya = 0.32 + 0.34 * (0.5 - nx / 2)
        ctx.fillStyle = campur(campur(TINTA_KOTA, dasar, terang * cahaya), LANGIT_BAWAH, kabut)
        ctx.beginPath()
        ctx.moveTo(atas[k].x, atas[k].y)
        ctx.lineTo(atas[k2].x, atas[k2].y)
        ctx.lineTo(bawah[k2].x, bawah[k2].y)
        ctx.lineTo(bawah[k].x, bawah[k].y)
        ctx.closePath()
        ctx.fill()
      }

      ctx.fillStyle = campur(campur(TINTA_KOTA, dasar, terang), LANGIT_BAWAH, kabut)
      ctx.beginPath()
      atas.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      ctx.closePath()
      ctx.fill()
    }
  }

  // Kabut cakrawala menutup baris terjauh supaya grid tidak berhenti mendadak.
  const kabutAtas = ctx.createLinearGradient(0, cy - tinggi * 0.22, 0, cy + tinggi * 0.06)
  kabutAtas.addColorStop(0, LANGIT_BAWAH)
  kabutAtas.addColorStop(1, 'rgba(127,211,194,0)')
  ctx.fillStyle = kabutAtas
  ctx.fillRect(0, cy - tinggi * 0.22, lebar, tinggi * 0.28)
}

function KotaHeksagon() {
  const kanvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const el = kanvas.current
    if (!el) return
    const ctx = el.getContext('2d')
    if (!ctx) return

    const diam = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let rafId = 0
    let lepas = false
    const mulai = performance.now()

    const ukur = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      el.width = Math.floor(el.clientWidth * dpr)
      el.height = Math.floor(el.clientHeight * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const bingkai = (t: number) => {
      if (lepas) return
      gambarKota(ctx, el.clientWidth, el.clientHeight, (t - mulai) / 1000)
      if (!diam) rafId = requestAnimationFrame(bingkai)
    }

    ukur()
    // Satu bingkai pada detik ke-3: kota sudah berdiri, tidak sedang tumbuh.
    if (diam) gambarKota(ctx, el.clientWidth, el.clientHeight, 3)
    else rafId = requestAnimationFrame(bingkai)

    const ulang = () => {
      ukur()
      if (diam) gambarKota(ctx, el.clientWidth, el.clientHeight, 3)
    }
    window.addEventListener('resize', ulang)
    return () => {
      lepas = true
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', ulang)
    }
  }, [])

  return <canvas ref={kanvas} className="absolute inset-0 h-full w-full" aria-hidden />
}

// ---------------------------------------------------------------------------
// Pembuka
// ---------------------------------------------------------------------------

export default function Pembuka({ onSelesai }: { onSelesai: () => void }) {
  const [selesai, setSelesai] = useState(0)
  const [galat, setGalat] = useState<string | null>(null)
  const [pergi, setPergi] = useState(false)
  const [kepala, setKepala] = useState(0)

  // Titik warna yang berjalan menyusuri nama. Ia memakai roda warna yang sama
  // dengan papan nama di bilah atas, jadi gerakan yang dilihat orang di layar
  // pembuka adalah gerakan yang nanti bisa mereka picu sendiri dengan kursor.
  useEffect(() => {
    const iv = setInterval(() => setKepala((k) => k + 1), 130)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    let batal = false
    const t0 = performance.now()
    const naik = () => !batal && setSelesai((n) => n + 1)

    const jalan = async () => {
      // Tanpa backend yang DIKONFIGURASI, jangan mengetuk pintunya sama sekali.
      //
      // Terbitan statis (GitHub Pages) sengaja berjalan tanpa backend: heksagon
      // datang dari GeoJSON di `public/data/`. Sebelum ini, layar pembuka tetap
      // memanggil /health, gagal, lalu MEMBLOKIR seluruh aplikasi di balik
      // pesan galat - padahal petanya sudah siap digambar di baliknya.
      if (!import.meta.env.VITE_API_BASE_URL) {
        naik()
        naik()
        naik()
        naik()
        return
      }
      try {
        await api.sehat()
      } catch {
        if (!batal) setGalat('Mesin data belum bisa dihubungi.')
        return
      }
      naik()

      // Basemap diambil di sini supaya peta tidak mulai dari nol setelah layar
      // ini hilang. Gagalnya TIDAK menghentikan pembuka - peta bisa mencoba
      // sendiri nanti, dan menahan seluruh aplikasi karena satu berkas gaya
      // adalah hukuman yang terlalu berat.
      await fetch(urlGaya('terang')).catch(() => null)
      naik()

      await document.fonts.ready.catch(() => null)
      naik()

      const sisa = TAHAN_MINIMAL_MS - (performance.now() - t0)
      if (sisa > 0) await new Promise((r) => setTimeout(r, sisa))
      naik()

      if (batal) return
      setPergi(true)
      setTimeout(() => !batal && onSelesai(), 560)
    }

    void jalan()
    return () => {
      batal = true
    }
  }, [onSelesai])

  const persen = Math.round((selesai / LANGKAH.length) * 100)
  const keterangan = galat
    ? 'Gagal memuat'
    : selesai >= LANGKAH.length
      ? 'Siap'
      : LANGKAH[selesai]

  return (
    <div
      className={`fixed inset-0 z-[100] overflow-hidden bg-[#dff6f0] transition-opacity duration-500 ease-liquid ${
        pergi ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
      role="status"
      aria-live="polite"
      aria-label={`Memuat Loconomics, ${persen} persen`}
    >
      <KotaHeksagon />

      {/* Peredup supaya teks tetap terbaca berapa pun tinggi kolom di belakangnya */}
      {/* Peredup terbalik DUA KALI.
          Pertama arahnya: dulu ia menggelapkan, sekarang ia mencerahkan - di
          atas langit mint, yang menjaga jarak baca adalah kabut putih, bukan
          bayangan.
          Kedua bentuknya: dulu paling tebal di TEPI, sekarang paling tebal di
          TENGAH. Versi pertama menyalin bentuk lama apa adanya dan hasilnya
          seluruh layar tertutup 62-90% putih - kotanya tidak terlihat sama
          sekali, dan yang tersisa cuma bidang mint kosong. Sekarang bagian
          tengah jadi alas bersih untuk teks, dan kotanya muncul justru di
          sekelilingnya. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_62%_44%_at_50%_50%,rgba(233,250,245,0.95)_0%,rgba(228,248,243,0.6)_58%,rgba(223,246,240,0.12)_100%)]" />

      <div className="relative flex h-full flex-col items-center justify-center px-6">
        <p className="eyebrow mb-5 text-[#2b6a61]">WebGIS · MAPID Competition 2026</p>

        <h1
          className="papan flex select-none whitespace-nowrap text-[clamp(2rem,8vw,6.2rem)] leading-none tracking-[0.02em] text-[#0b3d37]"
          aria-label={NAMA}
        >
          {[...NAMA].map((huruf, i) => {
            // Jarak huruf ini dari kepala sapuan. Tiga huruf di belakangnya
            // ikut berwarna dengan intensitas menurun - ekor inilah yang
            // membuat sapuannya terbaca sebagai gerak, bukan sebagai kedipan.
            const jarak = (kepala - i + NAMA.length * 4) % (NAMA.length + 5)
            const nyala = jarak < 3
            return (
              <span
                key={i}
                aria-hidden
                className="inline-block animate-[gelombang_3.2s_ease-in-out_infinite]"
                style={
                  {
                    color: nyala ? RODA_WARNA[(i + kepala) % RODA_WARNA.length] : undefined,
                    opacity: nyala ? 1 : 0.92,
                    transition: 'color 420ms cubic-bezier(0.6,0.4,0,1)',
                    animationDelay: `${i * 105}ms`,
                  } as CSSProperties
                }
              >
                {huruf}
              </span>
            )
          })}
        </h1>

        <p className="mt-5 max-w-[34ch] text-center text-[15px] leading-relaxed text-[#12564d]">
          Mencari lokasi usaha yang datanya bagus, bukan yang tampilannya mahal.
        </p>

        {/* --- Kemajuan ---------------------------------------------------- */}
        <div className="mt-11 w-full max-w-[26rem]">
          <div
            className="h-[7px] w-full overflow-hidden rounded-full bg-[#0b3d37]/10"
            role="progressbar"
            aria-valuenow={persen}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-liquid"
              style={{
                width: `${galat ? 100 : Math.max(persen, 6)}%`,
                // Gradien palet gerbang, bukan warna kuadran - alasan yang
                // sama dengan WARNA_KOTA di atas. Arahnya gelap ke terang
                // supaya ujung yang sudah terisi tetap terbaca di atas jalur
                // yang terang.
                background: galat
                  ? '#b42318'
                  : 'linear-gradient(90deg, #0b3d37, #1f8f7d 55%, #6dd5c4)',
              }}
            />
          </div>

          <div className="mt-3 flex items-baseline justify-between gap-4">
            <p className="text-[13.5px] text-[#12564d]">
              {keterangan}
              {!galat && selesai < LANGKAH.length && '…'}
            </p>
            {!galat && (
              <p className="tabular text-[13.5px] text-[#4c8078]">{persen}%</p>
            )}
          </div>

          {galat && (
            <div className="mt-4 rounded-md border border-[#0b3d37]/12 bg-white/60 p-4">
              <p className="text-[14px] leading-relaxed text-[#0b3d37]">{galat}</p>
              {/* Ini layar PERTAMA yang dilihat pengunjung, dan sebelumnya ia
                  menyuruh mereka menjalankan `uvicorn app.main:app --reload` -
                  perintah untuk orang yang memegang kode, dibaca orang yang
                  cuma membuka tautan. Keluarga yang sama dengan catatan
                  Commuter Clock yang menyuruh "jalankan pipeline s4_spatial".

                  Peta, skor, dan kuadran tetap bisa dilihat tanpa mesin data,
                  jadi jalan keluarnya disebut lebih dulu - bukan disembunyikan
                  di tombol kedua. */}
              <p className="mt-2 text-[13.5px] leading-relaxed text-[#2b6a61]">
                Peta, skor, dan kuadran tetap bisa dilihat. Yang belum bisa dibuka
                hanya bagian yang menuntut mesin data: Konsultan AI, akun, dan
                rincian per lokasi.
              </p>
              <div className="mt-3.5 flex gap-2">
                <button
                  onClick={onSelesai}
                  className="cursor-pointer rounded-sm bg-[#0b3d37] px-4 py-2 text-[13.5px] font-semibold text-[#e8fbf6] transition-opacity hover:opacity-85"
                >
                  Lanjutkan ke peta
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="cursor-pointer rounded-sm border border-[#0b3d37]/20 px-4 py-2 text-[13.5px] font-medium text-[#12564d] transition-colors hover:bg-white/60"
                >
                  Coba lagi
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
