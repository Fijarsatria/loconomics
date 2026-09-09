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

// --- Menunggu mesin data bangun -------------------------------------------
//
// Backend duduk di Render free tier: ia TIDUR sesudah 15 menit menganggur dan
// bangunnya memakan puluhan detik. Sebelum ini, layar pembuka memanggil
// /health SEKALI - jadi backend yang sedang bangun tidak bisa dibedakan dari
// backend yang mati, dan yang tertulis di layar pertama yang dilihat juri
// adalah "Mesin data belum bisa dihubungi" untuk mesin data yang beberapa
// detik lagi menjawab. Pernyataan yang keliru, dan keliru ke arah yang paling
// merugikan.
//
// Tiga angka, dan yang penting bukan besarnya melainkan pembagian tugasnya:
// KETUKAN memutus satu percobaan yang menggantung supaya bilahnya bergerak;
// ANGGARAN yang benar-benar memutuskan kapan menyerah.

/** Satu percobaan. Pendek supaya kegagalan terlihat sebagai gerak, bukan beku. */
const KETUKAN_MS = 6_000
/** Jeda antar-percobaan. Cold start tidak akan selesai lebih cepat dari ini. */
const JEDA_KETUKAN_MS = 1_500
/**
 * Total kesabaran. Cold start Render terukur di kisaran 50 detik, dan angka ini
 * sengaja di bawahnya: yang menutup selisihnya `bangunkan()` di `main.tsx`,
 * yang sudah mengetuk backend sejak halaman DIBUKA - biasanya puluhan detik
 * sebelum layar ini muncul, karena gerbang di antaranya memang dibuat untuk
 * dibaca. Anggaran ini hanya menanggung sisa jalannya, dan satu-satunya kasus
 * yang benar-benar memakainya adalah orang yang menyegarkan halaman langsung
 * ke peta saat backend baru saja tertidur.
 */
const ANGGARAN_BANGUN_MS = 40_000

/**
 * Layak dicoba lagi, atau sudah pasti percuma?
 *
 * Menunggu 40 detik itu benar untuk backend yang sedang bangun dan salah besar
 * untuk backend yang memang tidak ada - orang yang menjalankan frontend tanpa
 * `uvicorn` akan menatap bilah yang bergerak tanpa arti sebelum akhirnya
 * diberi tahu apa yang sudah jelas sejak detik pertama.
 *
 * Keduanya bisa dibedakan, dan bedanya bukan tebakan:
 *
 * - **Habis waktu** - sambungannya DITERIMA lalu digantung. Itu persis bentuk
 *   cold start Render: routernya menjawab sambungan sambil menyalakan
 *   layanannya di belakang. Layak ditunggu.
 * - **502/503/504** - router menjawab, layanan di belakangnya belum siap.
 *   Bentuk kedua dari cold start yang sama. Layak ditunggu.
 * - **Sisanya** - `TypeError: Failed to fetch` (tidak ada yang mendengarkan,
 *   nama host tidak terpecahkan) atau galat HTTP lain. Menunggu tidak
 *   mengubah apa pun.
 */
function layakDicobaLagi(e: unknown): boolean {
  // `AbortSignal.timeout` melempar DOMException bernama TimeoutError - bukan
  // AbortError, yang dipakai pembatalan manual.
  if (e instanceof DOMException && e.name === 'TimeoutError') return true
  return e instanceof GalatAPI && [502, 503, 504].includes(e.status)
}

/**
 * Ketuk /health sampai menjawab, atau sampai anggarannya habis.
 *
 * `dibatalkan` dibaca ULANG di tiap putaran, bukan ditangkap sekali: komponen
 * ini bisa dilepas di tengah penantian, dan penantian yang tidak pernah
 * memeriksanya akan tetap memanggil `setGalat` pada komponen yang sudah tidak
 * ada.
 */
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
/**
 * Kamera dan skala kota.
 *
 * Ketiganya disetel ulang 10 Sep 2026. Nilai lamanya (26 / 58 / 84) membuat
 * heksagon terdekat selebar hampir 500 px: yang terlihat di layar bukan kota
 * melainkan tiga lempeng raksasa. Petak yang lebih kecil DAN kamera yang lebih
 * tinggi menyelesaikan keduanya sekaligus - kotanya jadi padat, dan yang
 * terdekat pun masih terbaca sebagai bangunan.
 *
 * Satu batas yang mengikat ketiganya: dasar baris terdekat wajib memproyeksi
 * MELEWATI tepi bawah layar, kalau tidak muncul lagi pita kosong di kaki yang
 * jadi keluhan awalnya. Batasnya `Z_DEKAT <= f x TINGGI_KAMERA / (0,5 x tinggi)`;
 * pada 1440x900 itu 182, dan yang dipakai 171.
 */
const SISI = 18 // jari-jari heksagon dalam satuan dunia
const TINGGI_KAMERA = 92
const TINGGI_KOLOM = 100

/**
 * Baris terdekat, dan angka ini yang memperbaiki keluhan "bawahnya ga sampai
 * bawah banget".
 *
 * Dulu 5,5 sisi. Dengan f = 0,62 x lebar, dasar kolom terdekat memproyeksi ke
 * y = cy + f x 58 / 143 - sekitar 70 piksel DI ATAS tepi bawah layar 900px.
 * Sisanya diisi warna tanah rata, dan pertemuan keduanya jadi satu garis
 * mendatar yang tegas melintasi layar. Terlihat begitu di potret yang dikirim
 * pemilik repo.
 *
 * 3,6 sisi membuat dasar kolom terdekat jatuh di y ~ 1019: LEWAT tepi bawah,
 * jadi ia terpotong bingkai - dan kolom yang terpotong bingkai justru yang
 * membuat orang merasa berdiri DI ANTARA bangunannya, bukan menonton maketnya.
 */
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

/**
 * KOTA MALAM YANG DIBANGUN DARI DATANYA SENDIRI.
 *
 * Tiga hal yang membedakannya dari versi sebelumnya, dan ketiganya menjawab
 * satu keluhan yang sama - "kurang tajem, kayak kurang aja":
 *
 *   LANTAI  Seluruh bidang di bawah cakrawala sekarang berupa LANTAI HEKSAGON
 *           yang menyurut ke kejauhan, bergaris tepi. Sebelumnya ia bidang
 *           warna rata; bidang rata tidak punya detail yang bisa dilihat mata,
 *           dan itulah yang terbaca sebagai "tidak tajam". Lantainya juga yang
 *           menjamin tidak ada satu piksel pun di bawah yang kosong.
 *   SAPUAN  Satu cincin terang menyapu dari dekat ke jauh, berulang. Bukan
 *           hiasan: itu gerakan yang sama dengan gelombang layer heksagon di
 *           petanya - hal pertama yang akan dilihat orang begitu layar ini
 *           hilang.
 *   KEMAJUAN Tinggi kotanya terikat pada KEMAJUAN MEMUAT, bukan cuma pada
 *           waktu. Kotanya benar-benar selesai dibangun tepat saat datanya
 *           selesai dimuat, jadi bilah di bawah dan kota di belakangnya
 *           menceritakan hal yang sama.
 *
 * Paletnya tetap malam, dan yang MENYALA tetap sedikit: tujuh dari sepuluh
 * kolom cuma bahan bangunan, sisanya teal (datanya kuat) atau ungu (terlihat
 * mahal) - dua kutub yang sama dengan seluruh sisa situs ini.
 */
type RGB = [number, number, number]

/**
 * Membaca "#rrggbb".
 *
 * Dulu ia juga harus mengerti "rgb(r,g,b)", karena `campur()` dipanggil
 * BERSARANG dan keluarannya sendiri berbentuk rgb(). Sejak pencampuran pindah
 * ke tupel angka, bentuk itu tidak pernah lagi jadi masukan - tetapi
 * penerimaannya DIPERTAHANKAN, dan alasannya sejarah yang mahal:
 *
 * Sampai 23 Agustus 2026 parser ini hanya mengerti heksadesimal, jadi setiap
 * masukan "rgb(...)" jadi `rgb(NaN,NaN,7)`. Kanvas menolak fillStyle yang tidak
 * sah TANPA melempar galat - ia diam-diam mempertahankan fillStyle sebelumnya,
 * yang di sini kebetulan gradien langit. Akibatnya seluruh kota digambar dengan
 * warna langit di atas langit, dan layar ini tampak kosong padahal 16.229
 * heksagon per bingkai benar-benar digambar. Kegagalan yang paling sulit
 * disadari adalah kegagalan yang tidak berbunyi.
 */
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
/**
 * Bayangan kolom dijatuhkan ke sini. Di langit malam, hitam hampir murni benar:
 * sisi yang tidak kena cahaya memang melebur ke latarnya, dan justru itu yang
 * memberi kolomnya bentuk.
 */
const TINTA_KOTA = '#030605'

/**
 * Palet yang sama, sudah diurai jadi angka SEKALI di muat modul.
 *
 * Ini perbaikan kinerja, bukan kerapian. Versi sebelumnya menyimpan warnanya
 * sebagai string dan memanggil `campur()` empat sampai lima kali per sel -
 * dan tiap panggilan mem-parse ulang kedua string masukannya. Pada ~600 sel
 * yang benar-benar digambar itu berarti sekitar 5.000 penguraian string per
 * BINGKAI. Terukur di Chromium tanpa GPU: bingkai median 66,7 ms, yaitu 15
 * bingkai per detik untuk layar yang seluruh gunanya terasa mulus.
 *
 * Yang dipakai di dalam gelung sekarang `campurRGB` - aritmetika murni di atas
 * tupel - dan string cuma dirakit sekali per isian, saat menyerahkannya ke
 * `fillStyle` yang memang menuntut string.
 */
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

      // --- 1 · Petak lantai ------------------------------------------------
      // Digambar untuk SETIAP sel, termasuk yang kolomnya belum berdiri. Ia
      // yang mengisi seluruh kaki layar, dan garis tepinya yang memberi
      // ketajaman yang hilang dari bidang warna rata.
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
      // Dua pengunci sekaligus. `naik` yang lama menahan barisnya sampai
      // waktunya tiba; `maju` menahan SELURUHNYA sampai datanya benar-benar
      // sampai. Yang dipakai yang terkecil, jadi kotanya tidak pernah lebih
      // jadi daripada muatannya.
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

      // TINGKAT RINCIAN. Di bawah 9 px, ketiga sisi kolom bersama-sama cuma
      // selebar satu sampai dua piksel dan tidak menyumbang satu pun tepi yang
      // bisa dilihat - tetapi tetap dibayar penuh: tiga jalur, tiga isian, dan
      // tiga perakitan string warna. Yang jauh cukup atapnya saja.
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

        // Cahaya dari kiri atas. Rentangnya dilebarkan dari 0,32-0,66 jadi
        // 0,26-0,74: dua sisi yang terangnya berdekatan melebur jadi satu
        // siluet datar, dan siluet datar itulah yang terbaca sebagai "kurang
        // tajam". Yang membuat sebuah kotak terlihat sebagai kotak adalah
        // selisih antar-sisinya, bukan jumlah pikselnya.
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

  // Kabut cakrawala menutup baris terjauh supaya grid tidak berhenti mendadak.
  // Ia memuncak DI cakrawala dan tembus di kedua ujungnya: versi yang dimulai
  // pekat di tepi atas menggambar satu garis mendatar tegas melintasi layar,
  // karena langit di atasnya lebih gelap daripada kabutnya sendiri.
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
      // Tetap 2, bukan 2,5. Ketajaman yang dicari datang dari GARIS TEPI yang
      // digambar di tiap petak lantai dan tiap atap, bukan dari kerapatan
      // pikselnya - dan menaikkan dpr menaikkan ongkos isian secara kuadratik
      // untuk perbaikan yang nyaris tidak terlihat. Terukur: 2,5 menyeret
      // bingkai median ke 66,7 ms.
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
  /**
   * Kemajuan memuat, DIBACA PER BINGKAI oleh kota di belakangnya.
   *
   * Ref, bukan state yang diteruskan sebagai prop: kanvasnya menggambar 60 kali
   * sedetik dan tidak boleh menunggu React merender ulang untuk tahu angkanya
   * berubah. Efek di bawah yang menyalinnya tiap langkah selesai.
   */
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
      // Tanpa backend yang DIKONFIGURASI, jangan mengetuk pintunya sama sekali.
      //
      // Terbitan statis (GitHub Pages) sengaja berjalan tanpa backend: heksagon
      // datang dari GeoJSON di `public/data/`. Sebelum ini, layar pembuka tetap
      // memanggil /health, gagal, lalu MEMBLOKIR seluruh aplikasi di balik
      // pesan galat - padahal petanya sudah siap digambar di baliknya.
      //
      // Yang dilewati HANYA pemeriksaannya. Percobaan pertama melewati seluruh
      // urutan lalu `return`, dan akibatnya layar pembuka berhenti di "Siap
      // 100%" selamanya - `setPergi`/`onSelesai` ada di ujung urutan yang baru
      // saja dilompati. Gagal yang lebih halus daripada sebelumnya, dan sama
      // saja memblokir aplikasinya.
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

  const persen = Math.round((selesai / JUMLAH_LANGKAH) * 100)
  // Menyebut SEBAB, dalam bahasa orang yang membuka tautan - bukan "cold start",
  // bukan nama penyedianya. Yang dijawabnya satu pertanyaan yang muncul sendiri
  // di kepala orang saat sebuah bilah berhenti bergerak: ini macet, atau memang
  // sedang mengerjakan sesuatu?
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
                // Gradien palet gerbang, bukan warna kuadran - alasan yang
                // sama dengan WARNA_KOTA di atas. Arahnya gelap ke terang
                // supaya ujung yang sudah terisi tetap terbaca di atas jalur
                // yang terang.
                // Ungu ke teal: dua kutub yang sama dengan kolom yang menyala
                // di kota di belakangnya, dan dengan gradien tombol ajakan di
                // gerbang. Satu bahasa warna dari layar pertama sampai peta.
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
