
import { useEffect, useRef, useState, type CSSProperties } from 'react'

import { RODA_WARNA, urlGaya } from '../config'
import { api, GalatAPI } from '../lib/api'
import { useTeks } from '../lib/bahasa'

const NAMA = 'LOCONOMICS'

/** Berapa pekerjaan nyata yang ditunggu. Nama tiap langkahnya ikut bahasa. */
const JUMLAH_LANGKAH = 4

const K = {
  id: {
    langkah: [
      'Menghubungi mesin data',
      'Menyiapkan basemap MAPID',
      'Memuat tipografi',
      'Menyusun grid heksagon',
    ],
    eyebrow: 'WebGIS · MAPID Competition 2026',
    tagline: 'Mencari lokasi usaha yang datanya bagus, bukan yang tampilannya mahal.',
    gagal: 'Gagal memuat',
    membangunkan: 'Membangunkan mesin data — sebentar',
    siap: 'Siap',
    memuat: (p: number) => `Memuat Loconomics, ${p} persen`,
    galatMesin: 'Mesin data belum bisa dihubungi.',
    tetapBisa:
      'Peta, skor, dan kuadran tetap bisa dilihat. Yang belum bisa dibuka hanya bagian yang menuntut mesin data: Loconomics AI, akun, dan rincian per lokasi.',
    lanjut: 'Lanjutkan ke peta',
    cobaLagi: 'Coba lagi',
  },
  en: {
    langkah: ['Reaching the data engine', 'Preparing the MAPID basemap', 'Loading typography', 'Laying the hexagon grid'],
    eyebrow: 'WebGIS · MAPID Competition 2026',
    tagline: 'Finding the business location whose data is good, not the one that looks expensive.',
    gagal: 'Failed to load',
    membangunkan: 'Waking the data engine — one moment',
    siap: 'Ready',
    memuat: (p: number) => `Loading Loconomics, ${p} percent`,
    galatMesin: 'The data engine could not be reached.',
    tetapBisa:
      'The map, scores, and quadrants still work. Only the parts that need the data engine are unavailable: Loconomics AI, accounts, and per-location detail.',
    lanjut: 'Continue to the map',
    cobaLagi: 'Try again',
  },
}

/** Kota tidak boleh lewat begitu saja. Di bawah ini pembuka terasa tersentak. */
const TAHAN_MINIMAL_MS = 2400


/** Satu percobaan. Pendek supaya kegagalan terlihat sebagai gerak, bukan beku. */
const KETUKAN_MS = 6_000
/** Jeda antar-percobaan. Cold start tidak akan selesai lebih cepat dari ini. */
const JEDA_KETUKAN_MS = 1_500
const ANGGARAN_BANGUN_MS = 90_000

function layakDicobaLagi(e: unknown): boolean {
  // `AbortSignal.timeout` melempar DOMException bernama TimeoutError - bukan
  // AbortError, yang dipakai pembatalan manual.
  if (e instanceof DOMException && e.name === 'TimeoutError') return true
  return e instanceof GalatAPI && [502, 503, 504].includes(e.status)
}

async function tungguMesinData(
  dibatalkan: () => boolean,
  onMenunggu: () => void,
): Promise<boolean> {
  const tenggat = performance.now() + ANGGARAN_BANGUN_MS
  let pertama = true
  for (;;) {
    if (dibatalkan()) return false
    try {
      await api.sehat({ signal: AbortSignal.timeout(KETUKAN_MS) })
      return true
    } catch (e) {
      if (dibatalkan() || !layakDicobaLagi(e)) return false
      if (performance.now() >= tenggat) return false
      // Baru DIUMUMKAN sesudah percobaan pertama gagal. Backend yang hangat
      // menjawab dalam ratusan milidetik, dan mengumumkan "sedang bangun"
      // untuk sesuatu yang sudah bangun cuma menambah kalimat yang berkedip.
      if (pertama) {
        pertama = false
        onMenunggu()
      }
      await new Promise((r) => setTimeout(r, JEDA_KETUKAN_MS))
    }
  }
}

// ---------------------------------------------------------------------------
// Kota heksagon
// ---------------------------------------------------------------------------

const SISI = 18 // jari-jari heksagon dalam satuan dunia
const TINGGI_KAMERA = 92
const TINGGI_KOLOM = 100

const Z_DEKAT = 9.5 * SISI
/** Grid harus jauh lebih lebar daripada layar, karena kolom terjauh menyusut
    sampai seperlima. Yang di luar layar disingkirkan per bingkai, jadi lebar
    ini nyaris tidak berbiaya. */
const KOLOM = 17
const BARIS = 15

/** Heksagon bertopi datar: enam titik sudut pada kelipatan 60 derajat, di bidang XZ. */
const SUDUT = Array.from({ length: 6 }, (_, k) => {
  const a = (Math.PI / 180) * 60 * k
  return { x: Math.cos(a), z: Math.sin(a) }
})

type RGB = [number, number, number]

function urai(warna: string): RGB {
  if (warna.startsWith('#'))
    return [
      parseInt(warna.slice(1, 3), 16),
      parseInt(warna.slice(3, 5), 16),
      parseInt(warna.slice(5, 7), 16),
    ]
  const [r, g, b] = warna.slice(warna.indexOf('(') + 1, -1).split(',').map(Number)
  return [r, g, b]
}

const WARNA_KOTA = ['#1b3a38', '#2de8c0', '#6f55f0']
const LANGIT_ATAS = '#04070a'
const LANGIT_BAWAH = '#0e2b2f'
/** Dasar layar, di bawah cakrawala. Sama dengan dasar gerbang. */
const TANAH = '#060c0b'
/** Petak lantai dan garis tepinya. Bedanya kecil dengan sengaja: yang dicari
    tekstur, bukan kisi yang berebut perhatian dengan tulisan di atasnya. */
const LANTAI = '#091312'
const LANTAI_TEPI = '#14302c'
const TINTA_KOTA = '#030605'

const RGB_KOTA: RGB[] = WARNA_KOTA.map(urai)
const RGB_TINTA = urai(TINTA_KOTA)
const RGB_LANGIT_BAWAH = urai(LANGIT_BAWAH)
const RGB_LANTAI = urai(LANTAI)
const RGB_LANTAI_TEPI = urai(LANTAI_TEPI)
const RGB_PUTIH: RGB = [255, 255, 255]

function campurRGB(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function ke(c: RGB): string {
  return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`
}

/** Kolom mana yang menyala. Tujuh dari sepuluh gelap; sisanya teal atau ungu. */
function warnaKolom(r: number): RGB {
  if (r < 0.72) return RGB_KOTA[0]
  if (r < 0.9) return RGB_KOTA[1]
  return RGB_KOTA[2]
}

/** Acak yang stabil: kolom yang sama selalu dapat warna dan fase yang sama. */
function acak(i: number, j: number) {
  const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453
  return n - Math.floor(n)
}

function gambarKota(
  ctx: CanvasRenderingContext2D,
  lebar: number,
  tinggi: number,
  detik: number,
  maju: number,
) {
  const cx = lebar / 2
  const cy = tinggi * 0.5
  const f = Math.max(lebar, 900) * 0.62
  // Kamera menggeser pelan ke samping. Parallax inilah yang meyakinkan mata
  // bahwa yang dilihatnya ruang, bukan gambar.
  const camX = Math.sin(detik * 0.18) * SISI * 1.4

  const langit = ctx.createLinearGradient(0, 0, 0, tinggi)
  langit.addColorStop(0, LANGIT_ATAS)
  langit.addColorStop(0.5, LANGIT_BAWAH)
  langit.addColorStop(1, TANAH)
  ctx.fillStyle = langit
  ctx.fillRect(0, 0, lebar, tinggi)

  const zJauh = SISI * Math.sqrt(3) * BARIS + Z_DEKAT
  // Cincin sapuan, dinyatakan sebagai pecahan jarak. Berulang tiap ~2,4 detik.
  const sapuan = (detik * 0.42) % 1.35

  // Jauh dulu, dekat belakangan. Algoritma pelukis - tanpa buffer kedalaman,
  // urutan gambar ADALAH kedalamannya. Baris NEGATIF ada supaya lantainya
  // menembus tepi bawah layar; tanpa itu selalu tersisa pita kosong di kaki.
  for (let j = BARIS; j >= -2; j--) {
    for (let i = -KOLOM; i <= KOLOM; i++) {
      const X = SISI * 1.5 * i
      const Z = SISI * Math.sqrt(3) * (j + (Math.abs(i) % 2 === 1 ? 0.5 : 0))
      const dz = Z + Z_DEKAT
      if (dz < 8) continue

      // Buang yang di luar layar SEBELUM menghitung apa pun tentangnya. Grid
      // 45x20 hanya menyisakan sekitar seperempat kolom yang benar-benar
      // digambar, dan uji ini dua perkalian.
      const layarX = cx + (f * (X - camX)) / dz
      const lebarLayar = (f * 2 * SISI) / dz
      if (layarX < -lebarLayar || layarX > lebar + lebarLayar) continue
      if (lebarLayar < 3.5) continue

      const kabut = Math.min(1, Math.max(0, (dz - Z_DEKAT) / (zJauh - Z_DEKAT)))
      if (kabut > 0.965) continue

      const proyeksi = (vx: number, vz: number, vy: number) => {
        const pz = Z + vz + Z_DEKAT
        return {
          x: cx + (f * (X + vx - camX)) / pz,
          y: cy - (f * (vy - TINGGI_KAMERA)) / pz,
        }
      }
      const bawah = SUDUT.map((s) => proyeksi(s.x * SISI, s.z * SISI, 0))

      ctx.fillStyle = ke(campurRGB(RGB_LANTAI, RGB_LANGIT_BAWAH, kabut * 0.92))
      ctx.beginPath()
      bawah.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      ctx.closePath()
      ctx.fill()
      // Garis tepi lantai hanya untuk petak yang cukup besar. Di kejauhan ia
      // lebih tipis daripada satu piksel dan cuma menambah kerja.
      if (lebarLayar > 22) {
        ctx.strokeStyle = ke(campurRGB(RGB_LANTAI_TEPI, RGB_LANGIT_BAWAH, kabut * 0.95))
        ctx.lineWidth = Math.max(0.5, lebarLayar * 0.004)
        ctx.stroke()
      }

      // --- 2 · Kolom -------------------------------------------------------
      const r = acak(i, j)
      // Gelombang berjalan dari cakrawala ke arah penonton: kota yang sedang
      // dibangun, bukan kota yang sudah berdiri.
      const fase = detik * 1.15 - j * 0.42 + i * 0.22
      const naik = Math.min(1, Math.max(0, detik * 1.6 - j * 0.09))
      const tinggiRelatif = Math.min(naik, 0.25 + 0.75 * maju)
      const h =
        TINGGI_KOLOM * (0.18 + 0.82 * (0.5 + 0.5 * Math.sin(fase))) * tinggiRelatif * (0.55 + r * 0.75)
      if (h < 1.5) continue

      const dasar = warnaKolom(r)
      // Dijepit di 1: pengali tinggi acak bisa membawa h melewati TINGGI_KOLOM,
      // dan campur() dengan t > 1 mengekstrapolasi keluar rentang warna.
      const terang = Math.min(1, 0.35 + 0.65 * (h / TINGGI_KOLOM))
      // Cincin sapuan: sel yang sedang dilewatinya ikut terang sebentar.
      const jarakSapu = Math.abs(kabut - sapuan)
      const sapu = jarakSapu < 0.11 ? Math.pow(1 - jarakSapu / 0.11, 2) : 0

      const atas = SUDUT.map((s) => proyeksi(s.x * SISI, s.z * SISI, h))

      const rinci = lebarLayar > 9

      // Sisi yang menghadap kamera saja. Normal keluar sebuah rusuk sama dengan
      // titik tengahnya (heksagon berpusat di titik asal), jadi tidak perlu
      // menghitung silang.
      for (let k = 0; rinci && k < 6; k++) {
        const k2 = (k + 1) % 6
        const nx = (SUDUT[k].x + SUDUT[k2].x) / 2
        const nz = (SUDUT[k].z + SUDUT[k2].z) / 2
        const pandang = { x: X - camX, z: dz }
        if (nx * pandang.x + nz * pandang.z >= 0) continue

        const cahaya = 0.26 + 0.48 * (0.5 - nx / 2)
        ctx.fillStyle = ke(
          campurRGB(
            campurRGB(RGB_TINTA, dasar, Math.min(1, terang * cahaya + sapu * 0.28)),
            RGB_LANGIT_BAWAH,
            kabut,
          ),
        )
        ctx.beginPath()
        ctx.moveTo(atas[k].x, atas[k].y)
        ctx.lineTo(atas[k2].x, atas[k2].y)
        ctx.lineTo(bawah[k2].x, bawah[k2].y)
        ctx.lineTo(bawah[k].x, bawah[k].y)
        ctx.closePath()
        ctx.fill()
      }

      // Tutup atas: bidang paling terang, dan satu-satunya yang menerima
      // sapuan penuh. Ia yang membuat deretan kolom terbaca sebagai atap-atap
      // alih-alih sebagai pagar.
      ctx.fillStyle = ke(
        campurRGB(
          campurRGB(RGB_TINTA, dasar, Math.min(1, terang + sapu * 0.55)),
          RGB_LANGIT_BAWAH,
          kabut,
        ),
      )
      ctx.beginPath()
      atas.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      ctx.closePath()
      ctx.fill()
      // Garis tepi atap, hanya untuk yang cukup besar. Satu piksel terang di
      // tepi atap memberi ketajaman yang tidak bisa diberikan isian mana pun.
      if (lebarLayar > 26) {
        ctx.strokeStyle = ke(campurRGB(campurRGB(dasar, RGB_PUTIH, 0.22), RGB_LANGIT_BAWAH, kabut))
        ctx.lineWidth = Math.max(0.5, lebarLayar * 0.005)
        ctx.stroke()
      }
    }
  }

  const kabutAtas = ctx.createLinearGradient(0, cy - tinggi * 0.24, 0, cy + tinggi * 0.08)
  kabutAtas.addColorStop(0, 'rgba(14,43,47,0)')
  kabutAtas.addColorStop(0.76, LANGIT_BAWAH)
  kabutAtas.addColorStop(1, 'rgba(14,43,47,0)')
  ctx.fillStyle = kabutAtas
  ctx.fillRect(0, cy - tinggi * 0.24, lebar, tinggi * 0.32)
}

function KotaHeksagon({ maju }: { maju: React.RefObject<number> }) {
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
      gambarKota(ctx, el.clientWidth, el.clientHeight, (t - mulai) / 1000, maju.current ?? 0)
      if (!diam) rafId = requestAnimationFrame(bingkai)
    }

    ukur()
    // Satu bingkai pada detik ke-3 dengan kota yang sudah jadi: gerak dimatikan
    // berarti tidak ada yang menunggu untuk dilihat, jadi yang ditampilkan
    // keadaan akhirnya - bukan keadaan setengah jadi yang tidak akan berubah.
    if (diam) gambarKota(ctx, el.clientWidth, el.clientHeight, 3, 1)
    else rafId = requestAnimationFrame(bingkai)

    const ulang = () => {
      ukur()
      if (diam) gambarKota(ctx, el.clientWidth, el.clientHeight, 3, 1)
    }
    window.addEventListener('resize', ulang)
    return () => {
      lepas = true
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', ulang)
    }
  }, [maju])

  return <canvas ref={kanvas} className="absolute inset-0 h-full w-full" aria-hidden />
}

// ---------------------------------------------------------------------------
// Pembuka
// ---------------------------------------------------------------------------

export default function Pembuka({ onSelesai }: { onSelesai: () => void }) {
  const t = useTeks(K)
  const [selesai, setSelesai] = useState(0)
  const maju = useRef(0)
  const [galat, setGalat] = useState<string | null>(null)
  /** Percobaan pertama ke /health gagal - backend ada, tetapi masih bangun. */
  const [membangunkan, setMembangunkan] = useState(false)
  const [pergi, setPergi] = useState(false)
  const [kepala, setKepala] = useState(0)

  // Titik warna yang berjalan menyusuri nama. Ia memakai roda warna yang sama
  // dengan papan nama di bilah atas, jadi gerakan yang dilihat orang di layar
  // pembuka adalah gerakan yang nanti bisa mereka picu sendiri dengan kursor.
  useEffect(() => {
    const iv = setInterval(() => setKepala((k) => k + 1), 130)
    return () => clearInterval(iv)
  }, [])

  // Kemajuan disalin ke ref di EFEK, bukan saat render: menulis ref di badan
  // komponen berjalan juga pada render yang dibuang React, dan kanvas di
  // belakangnya membaca ref itu tiap bingkai.
  useEffect(() => {
    maju.current = selesai / JUMLAH_LANGKAH
  }, [selesai])

  useEffect(() => {
    let batal = false
    const t0 = performance.now()
    const naik = () => !batal && setSelesai((n) => n + 1)

    const jalan = async () => {
      if (import.meta.env.VITE_API_BASE_URL) {
        const hidup = await tungguMesinData(
          () => batal,
          () => !batal && setMembangunkan(true),
        )
        if (!hidup) {
          if (!batal) setGalat('mesin')
          return
        }
        if (!batal) setMembangunkan(false)
      }
      naik()

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

  const persen = Math.round((selesai / JUMLAH_LANGKAH) * 100)
  const keterangan = galat
    ? t.gagal
    : membangunkan
      ? t.membangunkan
      : selesai >= JUMLAH_LANGKAH
        ? t.siap
        : t.langkah[selesai]

  return (
    <div
      className={`fixed inset-0 z-[100] overflow-hidden bg-[#06090a] transition-opacity duration-500 ease-liquid ${
        pergi ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
      role="status"
      aria-live="polite"
      aria-label={t.memuat(persen)}
    >
      <KotaHeksagon maju={maju} />

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
      {/* Peredup untuk kota malam: yang menjaga jarak baca adalah GELAP di
          tengah, bukan kabut putih - teksnya terang, jadi alasnya harus lebih
          gelap daripada kota di sekelilingnya. Tepinya dibiarkan terbuka
          supaya kolom yang menyala tetap terlihat mengelilingi tulisannya. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_56%_40%_at_50%_50%,rgba(6,9,10,0.95)_0%,rgba(6,9,10,0.66)_58%,rgba(6,9,10,0.08)_100%)]" />

      <div className="relative flex h-full flex-col items-center justify-center px-6">
        <p className="eyebrow mb-5 text-[#8aa39c]">{t.eyebrow}</p>

        <h1
          className="papan flex select-none whitespace-nowrap text-[clamp(2rem,8vw,6.2rem)] leading-none tracking-[0.02em] text-[#e8f5f1]"
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

        <p className="mt-5 max-w-[34ch] text-center text-[15px] leading-relaxed text-[#c2d7d1]">
          {t.tagline}
        </p>

        {/* --- Kemajuan ---------------------------------------------------- */}
        <div className="mt-11 w-full max-w-[26rem]">
          <div
            className="h-[6px] w-full overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-valuenow={persen}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-liquid"
              style={{
                width: `${galat ? 100 : Math.max(persen, 6)}%`,
                background: galat
                  ? '#e5484d'
                  : 'linear-gradient(90deg, #6f55f0, #2de8c0 70%, #7cf7dd)',
              }}
            />
          </div>

          <div className="mt-3 flex items-baseline justify-between gap-4">
            <p className="text-[13.5px] text-[#c2d7d1]">
              {keterangan}
              {!galat && selesai < JUMLAH_LANGKAH && '…'}
            </p>
            {!galat && (
              <p className="tabular text-[13.5px] text-[#8aa39c]">{persen}%</p>
            )}
          </div>

          {galat && (
            <div className="mt-4 rounded-md border border-white/12 bg-white/[0.06] p-4">
              <p className="text-[14px] leading-relaxed text-[#e8f5f1]">{t.galatMesin}</p>
              {/* Ini layar PERTAMA yang dilihat pengunjung, dan sebelumnya ia
                  menyuruh mereka menjalankan `uvicorn app.main:app --reload` -
                  perintah untuk orang yang memegang kode, dibaca orang yang
                  cuma membuka tautan. Keluarga yang sama dengan catatan
                  Commuter Clock yang menyuruh "jalankan pipeline s4_spatial".

                  Peta, skor, dan kuadran tetap bisa dilihat tanpa mesin data,
                  jadi jalan keluarnya disebut lebih dulu - bukan disembunyikan
                  di tombol kedua. */}
              <p className="mt-2 text-[13.5px] leading-relaxed text-[#8aa39c]">{t.tetapBisa}</p>
              <div className="mt-3.5 flex gap-2">
                <button
                  onClick={onSelesai}
                  className="cursor-pointer rounded-full bg-[#e8f5f1] px-4 py-2 text-[13.5px] font-semibold text-[#06100e] transition-opacity hover:opacity-85"
                >
                  {t.lanjut}
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="cursor-pointer rounded-full border border-white/20 px-4 py-2 text-[13.5px] font-medium text-[#c2d7d1] transition-colors hover:bg-white/10"
                >
                  {t.cobaLagi}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
