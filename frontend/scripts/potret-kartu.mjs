/**
 * Membuat ulang gambar kartu peta di halaman gerbang, beserta manifesnya.
 *
 *   cd frontend && node scripts/potret-kartu.mjs
 *
 * Syaratnya dua, dan keduanya wajar untuk skrip yang dijalankan saat
 * mengembangkan: dev server hidup di :5173, dan backend hidup di :8000. Skrip
 * ini membuka dev server, lalu meminta HALAMAN ITU membangun petanya sendiri —
 * bukan membangunnya di Node.
 *
 * Kenapa lewat halaman: modul pemotretnya ditulis TypeScript dan mengimpor
 * `lib/layer-peta.ts`, tempat seluruh aturan pewarnaan peta aplikasi tinggal.
 * Dijalankan di dalam dev server, Vite yang mengurus transformasi dan resolusi
 * impornya, jadi gambar yang keluar dijamin memakai ekspresi yang sama persis
 * dengan peta di dalam aplikasi. Menyalin aturannya ke skrip ini akan membuat
 * salinan kedua yang cepat atau lambat berpisah tanpa ada yang menyadarinya.
 *
 * DUA KELUARAN, dan keduanya di-commit:
 *   public/kartu/*.webp        gambarnya
 *   src/lib/kartu-gerbang.ts   angka yang menyertainya
 *
 * Keduanya lahir dari data yang sama pada detik yang sama, jadi gambar dan
 * keterangannya tidak akan pernah bercerita hal yang berbeda.
 *
 * JALANKAN ULANG kalau salah satu dari ini berubah:
 *   - palet kuadran atau ekspresi pewarnaan layer
 *   - ambang skor, bobot, atau apa pun yang mengubah kuadran
 *   - isi basis data (mis. sesudah `s7_publish.py --muat`)
 */

import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const AKAR = dirname(dirname(fileURLToPath(import.meta.url)))
const TUJUAN = join(AKAR, 'public', 'kartu')
const ALAMAT = process.env.ALAMAT_DEV ?? 'http://localhost:5173/'

/**
 * Enam kartu. Pasangannya dipilih supaya dek menutupi seluruh ruang jawaban
 * produk: kelima layer muncul, dan empat gaya basemap MAPID muncul.
 *
 * HANYA SATU kartu bergaya gelap, dan itu disengaja. Dua kartu hitam di antara
 * enam membuat dek-nya terbaca sebagai setengah gagal dimuat, bukan sebagai
 * ragam gaya - dilaporkan begitu. Satu sudah cukup membuktikan basemap gelap
 * ada; dua mulai mendominasi halaman yang seluruhnya terang.
 *
 * Ukurannya sekitar 1,4x ukuran tampilnya — cukup tajam di layar retina tanpa
 * melipatempatkan besar berkasnya. Nisbahnya sengaja dibuat sama dengan nisbah
 * kotak tempatnya nanti dipasang, supaya `object-cover` tidak perlu memotong.
 *
 * Gaya `satellite` sengaja TIDAK dipakai: ubinnya datang dari api.mapbox.com
 * dan api.maptiler.com dengan kunci milik orang lain, sementara ketentuan A.3
 * menuntut basemap MAPID Maps. Lihat catatan panjangnya di `src/config.ts`.
 */
const DAFTAR = [
  { berkas: 'tanah-abang', kawasan: 'Tanah Abang', gaya: 'dasar', layer: 'opportunity', condong: -0.7, utama: true, lebar: 1120, tinggi: 720, angka: true, mutu: 0.74 },
  { berkas: 'manggarai', kawasan: 'Manggarai', gaya: 'terang', layer: 'pricelens', condong: 1.2, lebar: 620, tinggi: 380, angka: false, mutu: 0.72 },
  { berkas: 'dukuh-atas', kawasan: 'Dukuh Atas BNI', gaya: 'gelap', layer: 'hidden_gem', condong: -1.3, lebar: 620, tinggi: 380, angka: false, mutu: 0.72 },
  { berkas: 'depok-baru', kawasan: 'Depok Baru', gaya: 'jalan', layer: 'zoneguard', condong: 1.5, lebar: 620, tinggi: 380, angka: false, mutu: 0.72 },
  { berkas: 'bekasi', kawasan: 'Bekasi', gaya: 'dasar', layer: 'risk_radar', condong: -1, lebar: 620, tinggi: 380, angka: false, mutu: 0.72 },
  { berkas: 'harjamukti', kawasan: 'Harjamukti', gaya: 'terang', layer: 'opportunity', condong: 0.9, lebar: 620, tinggi: 380, angka: false, mutu: 0.72 },
]

/** Gaya yang latarnya gelap butuh pita nama layer yang terang di kartunya. */
const GAYA_GELAP = ['gelap']

const peramban = await chromium.launch()
const halaman = await peramban.newPage({ viewport: { width: 1400, height: 900 } })
halaman.on('pageerror', (e) => console.error('  galat halaman:', String(e).slice(0, 160)))

await halaman.goto(ALAMAT, { waitUntil: 'load', timeout: 30000 })
// Beri kesempatan Vite menyelesaikan pemuatan modul pertamanya.
await halaman.waitForTimeout(2500)

await mkdir(TUJUAN, { recursive: true })

let totalKb = 0
const manifes = []

for (const p of DAFTAR) {
  const mulai = Date.now()
  const hasil = await halaman.evaluate(async (pesan) => {
    const mod = await import('/src/lib/potret-kartu.ts')
    return mod.potretKartu(pesan)
  }, p)

  const isi = Buffer.from(hasil.gambar.split(',')[1], 'base64')
  await writeFile(join(TUJUAN, p.berkas + '.webp'), isi)
  const kb = isi.length / 1024
  totalKb += kb

  manifes.push({
    berkas: p.berkas,
    kawasan: p.kawasan,
    layer: p.layer,
    gelap: GAYA_GELAP.includes(p.gaya),
    condong: p.condong,
    utama: p.utama === true,
    lebar: p.lebar,
    tinggi: p.tinggi,
    n: hasil.ringkas.n,
    kuadran: hasil.ringkas.kuadran,
    sorotan: hasil.ringkas.sorotan,
  })

  const detik = ((Date.now() - mulai) / 1000).toFixed(1)
  console.log(
    '  ' + p.berkas.padEnd(14) +
    String(hasil.ringkas.n).padStart(4) + ' heksagon  ' +
    String(p.lebar).padStart(4) + 'x' + p.tinggi + '  ' +
    kb.toFixed(0).padStart(4) + ' KB  ' +
    hasil.ringkas.sorotan.nilai.padStart(9) + '  ' + detik + 's',
  )
}

/**
 * Manifesnya ditulis sebagai MODUL TS, bukan JSON di public/.
 *
 * Dua alasan. Pertama, ia jadi ikut diperiksa `tsc` — kartu yang layernya salah
 * nama ketahuan saat build, bukan saat demo. Kedua, ia diimpor statis jadi tidak
 * ada satu pun permintaan jaringan tambahan hanya untuk membaca enam baris
 * angka.
 */
const baris = [
  '/**',
  ' * DIBUAT OTOMATIS oleh `scripts/potret-kartu.mjs`. Jangan disunting tangan.',
  ' *',
  ' * Angkanya dihitung dari data yang sama yang dipakai menggambar berkas WebP',
  ' * di `public/kartu/`, pada detik yang sama. Untuk menyegarkannya:',
  ' *',
  ' *   cd frontend && node scripts/potret-kartu.mjs',
  ' */',
  '',
  "import type { NamaLayer } from '../config'",
  '',
  'export interface KartuGerbang {',
  '  berkas: string',
  '  kawasan: string',
  '  layer: NamaLayer',
  '  gelap: boolean',
  '  condong: number',
  '  utama: boolean',
  '  lebar: number',
  '  tinggi: number',
  '  /** Jumlah heksagon kawasan ini pada saat dipotret. */',
  '  n: number',
  '  kuadran: Record<string, number>',
  '  sorotan: { nilai: string; label: string }',
  '}',
  '',
  '/** Tanggal potret terakhir, dinyatakan apa adanya di halamannya. */',
  "export const DIPOTRET = '" + new Date().toISOString().slice(0, 10) + "'",
  '',
  'export const KARTU_GERBANG: KartuGerbang[] = ' + JSON.stringify(manifes, null, 2),
  '',
].join('\n')

await writeFile(join(AKAR, 'src', 'lib', 'kartu-gerbang.ts'), baris, 'utf-8')

console.log(
  '\n  ' + DAFTAR.length + ' kartu, total ' + totalKb.toFixed(0) + ' KB -> public/kartu/' +
  '\n  manifes -> src/lib/kartu-gerbang.ts',
)
await peramban.close()
