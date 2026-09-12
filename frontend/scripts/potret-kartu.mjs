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
 *   src/lib/kartu-gerbang.ts   angka DAN geometri heksagon yang menyertainya
 *
 * Keduanya lahir dari data yang sama pada detik yang sama, jadi gambar dan
 * keterangannya tidak akan pernah bercerita hal yang berbeda.
 *
 * `--sorot` MENYEGARKAN GEOMETRINYA SAJA, tanpa menggambar ulang satu WebP pun.
 *
 * Ada karena keduanya punya syarat yang berbeda. Menggambar WebP menuntut ubin
 * MAPID hidup; menghitung geometri heksagon tidak menuntut apa pun selain
 * basis data - kameranya murni aritmetika, dan warnanya dibaca dari heksagon
 * yang digambar di atas latar polos. Saat ubin MAPID sedang tidak melayani
 * (401, sudah terjadi berhari-hari), mode penuh akan menerbitkan enam kartu
 * tanpa basemap; mode ini tetap bisa dijalankan dan gambarnya tidak disentuh.
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
/*
 * `pilih` MENGIKAT animasi kartu ke kalimat kartu.
 *
 * Tiap kartu menyorot heksagon yang menjawab pertanyaannya sendiri, bukan
 * sekumpulan heksagon yang kebetulan ada di sana: "memilih lokasi" menyorot
 * skor tertinggi, "menakar sewa" menyorot sewa termurah, "memastikan boleh"
 * menyorot yang zonanya melarang - lalu yang terlarang itu PERGI, persis yang
 * dijanjikan kalimatnya ("tidak pernah muncul sebagai rekomendasi").
 *
 * `banyak` sengaja belasan, bukan seluruhnya: yang disorot adalah JAWABAN, dan
 * jawaban yang menutupi seluruh kawasan bukan jawaban.
 */
const DAFTAR = [
  { berkas: 'tanah-abang', kawasan: 'Tanah Abang', gaya: 'dasar', layer: 'opportunity', condong: -0.7, utama: true, lebar: 1120, tinggi: 720, angka: true, mutu: 0.74, pilih: 'skor', banyak: 14 },
  { berkas: 'manggarai', kawasan: 'Manggarai', gaya: 'terang', layer: 'pricelens', condong: 1.2, lebar: 620, tinggi: 380, angka: false, mutu: 0.72, pilih: 'sewa-murah', banyak: 12 },
  { berkas: 'dukuh-atas', kawasan: 'Dukuh Atas BNI', gaya: 'gelap', layer: 'hidden_gem', condong: -1.3, lebar: 620, tinggi: 380, angka: false, mutu: 0.72, pilih: 'gem', banyak: 12 },
  { berkas: 'depok-baru', kawasan: 'Depok Baru', gaya: 'jalan', layer: 'zoneguard', condong: 1.5, lebar: 620, tinggi: 380, angka: false, mutu: 0.72, pilih: 'terlarang', banyak: 12 },
  { berkas: 'bekasi', kawasan: 'Bekasi', gaya: 'dasar', layer: 'risk_radar', condong: -1, lebar: 620, tinggi: 380, angka: false, mutu: 0.72, pilih: 'churn', banyak: 12 },
  { berkas: 'harjamukti', kawasan: 'Harjamukti', gaya: 'terang', layer: 'opportunity', condong: 0.9, lebar: 620, tinggi: 380, angka: false, mutu: 0.72, pilih: 'skor', banyak: 10 },
]

/**
 * Dua potret KHUSUS kartu komparasi, dengan kamera yang membingkai RUTE-nya.
 *
 * Sebelumnya kartu itu meminjam potret Harjamukti dan Manggarai milik kartu
 * lain lalu memperbesarnya 1,55x lewat CSS. Dua keluhan pemilik repo lahir dari
 * situ: rutenya terlalu pendek untuk terlihat, dan petanya harus "lebih zoom
 * lagi" - padahal WebP 620 px sudah mulai lunak pada 1,55x. Potret sendiri
 * dengan kamera sendiri menjawab keduanya tanpa satu piksel pun yang diperbesar.
 *
 * `tepi` dalam pecahan kotak. Peta KIRI diberi tepi kiri yang lebih lebar,
 * karena sisi itu bersentuhan dengan kolom teks dan dipudarkan; rutenya harus
 * berdiri di bagian yang tidak tertutup pudar itu. Peta kanan tidak dipudarkan
 * sama sekali, jadi tepinya simetris.
 */
/*
 * `banyak: 18` untuk peta A, bukan 10 seperti kartunya sendiri. Sepuluh
 * heksagon berskor tertinggi Harjamukti SEMUANYA berdiri dalam 1,2 km dari
 * LRT-nya - terukur: 409 sampai 1.167 m - jadi tidak satu pun punya rute yang
 * cukup panjang untuk terbaca. Rute 1,8 km baru muncul di peringkat ke-18.
 * Himpunan sorotnya yang dilebarkan, bukan asal rutenya yang dicari di luar
 * himpunan itu: penanda A harus tetap berdiri di atas heksagon yang disorot.
 */
const BANDING = [
  { berkas: 'banding-a', kawasan: 'Harjamukti', gaya: 'terang', layer: 'opportunity', lebar: 900, tinggi: 520, mutu: 0.8, pilih: 'skor', banyak: 18, tepi: { atas: 0.14, bawah: 0.14, kiri: 0.26, kanan: 0.08 } },
  // GemFinder, bukan PriceLens, sejak 13 Sep 2026. `harga_sewa_median` (P05)
  // kosong di 708 dari 708 heksagon - spanduk "DIKONTRAKAN" di lapangan hampir
  // tidak pernah mencantumkan harga, jadi A1 tidak membukanya (lihat
  // docs/ai.md). Pilihan 'sewa-murah' karena itu tidak akan pernah cocok
  // dengan satu heksagon pun, dan akibatnya dua lapis: potret ini DILEWATI
  // sehingga WebP lamanya tertinggal sebagai gambar basi, DAN `KARTU_BANDING`
  // tinggal satu entri sehingga `GerbangPeta` menyembunyikan seluruh bagian
  // komparasi (ia menuntut >= 2). Satu kolom kosong menghapus satu bagian
  // halaman, tanpa satu pun galat.
  //
  // Manggarai punya 15 heksagon ber-`hidden_gem_score` - selisih layer dengan
  // banding-a tetap terjaga, dan kali ini didukung data yang benar-benar ada.
  { berkas: 'banding-b', kawasan: 'Manggarai', gaya: 'terang', layer: 'hidden_gem', lebar: 900, tinggi: 520, mutu: 0.8, pilih: 'gem', banyak: 15, tepi: { atas: 0.14, bawah: 0.14, kiri: 0.1, kanan: 0.1 } },
]

/**
 * Panjang rute yang dicari untuk kartu komparasi. Lihat `pilihRute`.
 *
 * 2.400 m, bukan 1.300 m. Dengan zoom yang dikunci sama untuk kedua peta,
 * panjang rute di GAMBAR sebanding dengan panjangnya di jalan - dan rute
 * 1,2 km di Harjamukti tampil sepertiga panjang rute 2,6 km di Manggarai,
 * terkubur di bawah heksagon sorotnya sendiri. Terlihat begitu di potret.
 */
const SASARAN_RUTE_M = 2400

/** `--sorot`: segarkan geometri heksagonnya saja, jangan sentuh satu WebP pun. */
const hanyaSorot = process.argv.includes('--sorot')

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
let manifes = []
let manifesBanding = []

/*
 * Mode `--sorot` membaca angka kartu dari manifes yang SUDAH ada.
 *
 * Manifesnya ditulis `JSON.stringify`, jadi potongan di antara kurung siku
 * pertama dan terakhir memang JSON yang sah - tidak perlu penafsir TypeScript
 * hanya untuk membaca enam baris angka kembali.
 */
if (hanyaSorot) {
  const { readFile } = await import('node:fs/promises')
  const teks = await readFile(join(AKAR, 'src', 'lib', 'kartu-gerbang.ts'), 'utf-8')
  // Dua daftar di satu berkas, masing-masing ditutup PENANDA - bukan kurung
  // siku terakhir, yang sejak ada daftar kedua menunjuk ke daftar yang salah.
  const potong = (nama) => {
    const mulai = teks.indexOf('[', teks.indexOf('=', teks.indexOf('export const ' + nama)))
    const penanda = teks.indexOf('// akhir ' + nama, mulai)
    const akhir = penanda === -1 ? teks.length : penanda
    return JSON.parse(teks.slice(mulai, teks.lastIndexOf(']', akhir) + 1))
  }
  manifes = potong('KARTU_GERBANG')
  manifesBanding = teks.includes('export const KARTU_BANDING') ? potong('KARTU_BANDING') : []
  console.log('  --sorot: ' + manifes.length + ' kartu dibaca dari manifes, WebP tidak disentuh')
}

for (const p of hanyaSorot ? [] : DAFTAR) {
  const mulai = Date.now()
  const hasil = await halaman.evaluate(async (pesan) => {
    const mod = await import('/src/lib/potret-kartu.ts')
    return mod.potretKartu(pesan)
  }, p)

  const isi = Buffer.from(hasil.gambar.split(',')[1], 'base64')
  await writeFile(join(TUJUAN, p.berkas + '.webp'), isi)
  const kb = isi.length / 1024
  totalKb += kb

  /*
   * Kartu bergaya GELAP mendapat kembaran bergaya TERANG untuk halaman terang.
   *
   * Dilaporkan pemilik repo dengan potret: di mode terang, kartu GemFinder
   * tampil sebagai peta hitam pekat di tengah halaman putih. Menyaring gambar
   * gelapnya lewat CSS (`invert`) membalik warna heksagonnya juga; menggambar
   * ulang dengan gaya terang dan KAMERA YANG SAMA tidak membalik apa pun - dan
   * karena kameranya sama, geometri sorotnya tetap berlaku untuk keduanya.
   */
  let berkasTerang = null
  if (GAYA_GELAP.includes(p.gaya)) {
    const kembar = await halaman.evaluate(async (pesan) => {
      const mod = await import('/src/lib/potret-kartu.ts')
      return mod.potretKartu(pesan)
    }, { ...p, gaya: 'terang' })
    const isiKembar = Buffer.from(kembar.gambar.split(',')[1], 'base64')
    berkasTerang = p.berkas + '-terang'
    await writeFile(join(TUJUAN, berkasTerang + '.webp'), isiKembar)
    totalKb += isiKembar.length / 1024
  }

  manifes.push({
    berkas: p.berkas,
    berkasTerang,
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

/*
 * Lapisan sorot: heksagon sungguhan, pada posisi piksel yang sama dengan
 * potretnya. Selalu dihitung, di kedua mode - kalau WebP baru saja digambar
 * ulang, geometrinya wajib ikut, kalau tidak keduanya berselisih separuh
 * piksel dan tidak ada yang memberi tahu.
 */
for (const p of DAFTAR) {
  const baris = manifes.find((m) => m.berkas === p.berkas)
  if (!baris) continue
  const hasil = await halaman.evaluate(async (pesan) => {
    const mod = await import('/src/lib/potret-kartu.ts')
    return mod.sorotKartu(pesan)
  }, { kawasan: p.kawasan, layer: p.layer, lebar: p.lebar, tinggi: p.tinggi, pilih: p.pilih, banyak: p.banyak })
  baris.sorot = hasil
  console.log(
    '  sorot ' + p.berkas.padEnd(14) +
    String(hasil.sel.length / 2).padStart(4) + ' sel  ' +
    String(hasil.sorot.length).padStart(3) + ' disorot (' + p.pilih + ')  ' +
    'r=' + Math.hypot(hasil.bentuk[0], hasil.bentuk[1]).toFixed(1) + 'px' +
    (hasil.rute ? '  rute ' + hasil.rute.menit + ' mnt -> ' + hasil.rute.simpul : '  tanpa rute'),
  )
}

/*
 * Kartu komparasi. Urutannya wajib: rute DULU (menentukan kameranya), baru
 * potret dan sorotnya dengan kamera itu. `--sorot` tetap menghitung ulang
 * rute dan kameranya - tanpa itu geometri baru berdiri di atas gambar yang
 * dipotret dengan kamera lama.
 */
const bandingLama = manifesBanding
manifesBanding = []

/*
 * SATU zoom untuk kedua peta: yang terkecil di antara zoom yang dibutuhkan
 * masing-masing rutenya, dan tidak lebih dekat dari ZOOM_BANDING_MAKS. Kartunya
 * berbunyi "satu ukuran yang sama"; dua peta berskala berbeda membantahnya
 * sebelum kalimatnya selesai dibaca.
 */
// Batas atas, bukan sasaran: zoom sebenarnya yang TERKECIL di antara kedua
// kebutuhan rute. Di atas 15 panel selebar 450 px memuat kurang dari lima
// heksagon dan kisinya berhenti terbaca sebagai kisi.
const ZOOM_BANDING_MAKS = 15
const pilihanBanding = []
for (const p of BANDING) {
  const pilihan = await halaman.evaluate(async (pesan) => {
    const mod = await import('/src/lib/potret-kartu.ts')
    return mod.pilihRute(pesan)
  }, { kawasan: p.kawasan, pilih: p.pilih, banyak: p.banyak, sasaranM: SASARAN_RUTE_M })
  if (!pilihan) {
    console.log('  banding ' + p.berkas + ': tidak ada heksagon berute - dilewati')
    continue
  }
  const zoom = await halaman.evaluate(async (pesan) => {
    const mod = await import('/src/lib/potret-kartu.ts')
    return mod.zoomKamera(pesan)
  }, { lebar: p.lebar, tinggi: p.tinggi, kamera: { bingkai: pilihan.bingkai, tepi: p.tepi } })
  pilihanBanding.push({ p, pilihan, zoom })
}
const zoomBersama = Math.min(ZOOM_BANDING_MAKS, ...pilihanBanding.map((x) => x.zoom))
console.log('  banding zoom bersama ' + zoomBersama.toFixed(2) + ' (' + pilihanBanding.map((x) => x.zoom.toFixed(2)).join(', ') + ')')

for (const { p, pilihan } of pilihanBanding) {
  const kamera = { bingkai: pilihan.bingkai, tepi: p.tepi, zoom: zoomBersama }

  if (!hanyaSorot) {
    const hasil = await halaman.evaluate(async (pesan) => {
      const mod = await import('/src/lib/potret-kartu.ts')
      return mod.potretKartu(pesan)
    }, { kawasan: p.kawasan, gaya: p.gaya, layer: p.layer, lebar: p.lebar, tinggi: p.tinggi, angka: false, mutu: p.mutu, kamera })
    const isi = Buffer.from(hasil.gambar.split(',')[1], 'base64')
    await writeFile(join(TUJUAN, p.berkas + '.webp'), isi)
    totalKb += isi.length / 1024
  } else if (!bandingLama.some((b) => b.berkas === p.berkas)) {
    console.log('  banding ' + p.berkas + ': belum pernah dipotret - jalankan tanpa --sorot')
    continue
  }

  const sorot = await halaman.evaluate(async (pesan) => {
    const mod = await import('/src/lib/potret-kartu.ts')
    return mod.sorotKartu(pesan)
  }, { kawasan: p.kawasan, layer: p.layer, lebar: p.lebar, tinggi: p.tinggi, pilih: p.pilih, banyak: p.banyak, kamera, ruteH3: pilihan.h3 })

  manifesBanding.push({
    berkas: p.berkas,
    berkasTerang: null,
    kawasan: p.kawasan,
    layer: p.layer,
    gelap: GAYA_GELAP.includes(p.gaya),
    condong: 0,
    utama: false,
    lebar: p.lebar,
    tinggi: p.tinggi,
    n: sorot.sel.length / 2,
    kuadran: {},
    sorotan: { nilai: '', label: '' },
    sorot,
  })
  console.log(
    '  banding ' + p.berkas.padEnd(12) + ' rute ' + pilihan.jarakM + ' m dari ' + pilihan.h3 +
    (sorot.rute ? '  (' + sorot.rute.menit + ' mnt -> ' + sorot.rute.simpul + ')' : '  TANPA RUTE'),
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
  '  /** Kembaran bergaya terang untuk halaman terang. Hanya kartu bergaya gelap. */',
  '  berkasTerang: string | null',
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
  '  /**',
  '   * Heksagon sungguhan kartu ini, dalam piksel kotak gambarnya.',
  '   *',
  '   * `sel` pusat SELURUH heksagon; `sorot` yang menjawab pertanyaan kartunya,',
  '   * urut sesuai jawabannya, dengan warna yang DIBACA dari peta - bukan dari',
  '   * salinan kedua aturan pewarnaan. `bentuk` dipakai bersama keduanya.',
  '   */',
  '  sorot: {',
  '    w: number',
  '    h: number',
  '    cx: number',
  '    cy: number',
  '    bentuk: number[]',
  '    sel: number[]',
  '    sorot: { x: number; y: number; c: string }[]',
  '    rute: {',
  '      d: string',
  '      ax: number',
  '      ay: number',
  '      bx: number',
  '      by: number',
  '      menit: number',
  '      simpul: string',
  '    } | null',
  '  }',
  '}',
  '',
  '/**',
  ' * Berkas dan basemap yang BENAR-BENAR dipakai untuk tema yang sedang berlaku.',
  ' *',
  ' * Kartu bergaya gelap punya kembaran terang (`berkasTerang`), dan di halaman',
  ' * terang kembaran itulah yang dipasang - dilaporkan pemilik repo: kartu',
  ' * GemFinder tampil sebagai peta hitam di tengah halaman putih. `gelap` ikut',
  ' * dihitung ulang dari berkas yang dipakai, BUKAN dibaca dari manifes: garis',
  ' * kisi yang dipilih untuk basemap hitam jadi garis putih di atas peta putih.',
  ' *',
  ' * Tinggal di sini, di sebelah manifesnya, karena ia satu-satunya yang tahu',
  ' * arti `berkasTerang` - dan dipakai dua komponen (Solusi dan Ekosistem).',
  ' */',
  "export function potretUntukTema(d: KartuGerbang, tema: 'terang' | 'gelap') {",
  "  const kembar = tema === 'terang' && d.berkasTerang !== null",
  '  return { berkas: kembar ? (d.berkasTerang as string) : d.berkas, gelap: kembar ? false : d.gelap }',
  '}',
  '',
  '/** Tanggal potret terakhir, dinyatakan apa adanya di halamannya. */',
  "export const DIPOTRET = '" + new Date().toISOString().slice(0, 10) + "'",
  '',
  'export const KARTU_GERBANG: KartuGerbang[] = ' + JSON.stringify(manifes, null, 2),
  '// akhir KARTU_GERBANG',
  '',
  '/** Dua potret kartu komparasi, dibingkai pada rutenya. A lalu B. */',
  'export const KARTU_BANDING: KartuGerbang[] = ' + JSON.stringify(manifesBanding, null, 2),
  '// akhir KARTU_BANDING',
  '',
].join('\n')

await writeFile(join(AKAR, 'src', 'lib', 'kartu-gerbang.ts'), baris, 'utf-8')

console.log(
  '\n  ' + (hanyaSorot ? 'WebP tidak disentuh' : DAFTAR.length + ' kartu, total ' + totalKb.toFixed(0) + ' KB -> public/kartu/') +
  '\n  manifes -> src/lib/kartu-gerbang.ts',
)
await peramban.close()
