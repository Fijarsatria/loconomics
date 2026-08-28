/**
 * Ambil kelima gaya basemap MAPID lewat proksi backend, simpan sebagai berkas
 * statis di `public/basemap/`.
 *
 * KENAPA STATIS, dan bukan dipanggil langsung saat aplikasi jalan.
 *
 * Kunci Map Services tidak boleh ada di peramban - diukur 29 Agu 2026, kunci
 * yang sama membuka data misi MENTAH (200, 100 baris per halaman). Jadi
 * style.json wajib melewati sisi server. Tetapi kalau peramban memintanya ke
 * backend saat peta dibuka, basemap ikut mati setiap kali Render free tier
 * sedang tidur - dan itu persis puluhan detik pertama saat juri membuka tautan.
 *
 * Mitigasi yang sudah tertulis di PRD untuk masalah yang sama: precompute, lalu
 * sajikan sebagai berkas statis dari CDN Cloudflare. Berkas ini menerapkannya
 * pada gaya basemap.
 *
 * Yang TIDAK ikut jadi statis: ubin, font, dan sprite. Ketiganya tetap diambil
 * peramban langsung dari MAPID, jadi pemakaian tetap tercatat di sisi mereka
 * dan petanya tetap peta MAPID - ketentuan A.3 tidak tersentuh.
 *
 * Jalankan ulang kalau MAPID mengubah gayanya:
 *
 *     cd backend && uvicorn app.main:app --port 8000     # di terminal lain
 *     cd frontend && node scripts/gaya-basemap.mjs
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DI_SINI = path.dirname(fileURLToPath(import.meta.url))
const KELUARAN = path.join(DI_SINI, '..', 'public', 'basemap')
const BACKEND = process.env.BACKEND ?? 'http://localhost:8000'

/** Harus sama dengan GAYA_BASEMAP di src/config.ts dan di backend. */
const GAYA = ['light', 'basic', 'street-2d-building', 'dark']

async function main() {
  await fs.mkdir(KELUARAN, { recursive: true })
  let gagal = 0

  for (const id of GAYA) {
    const url = `${BACKEND}/meta/basemap/${id}/style.json`
    let r
    try {
      r = await fetch(url)
    } catch (e) {
      console.error(`  ${id.padEnd(20)} GAGAL menghubungi backend: ${e.message}`)
      gagal++
      continue
    }
    if (!r.ok) {
      console.error(`  ${id.padEnd(20)} GAGAL HTTP ${r.status}`)
      gagal++
      continue
    }

    const teks = await r.text()

    // Penjaga, bukan basa-basi: berkas ini akan di-commit dan dilayani publik.
    // Kalau kuncinya sampai ikut, ia terbit bersama aplikasinya.
    if (/[?&]key=/.test(teks)) {
      console.error(`  ${id.padEnd(20)} DITOLAK - masih memuat parameter key=`)
      gagal++
      continue
    }

    const gaya = JSON.parse(teks)
    if (!gaya.sources || !gaya.layers) {
      console.error(`  ${id.padEnd(20)} DITOLAK - bukan gaya MapLibre yang sah`)
      gagal++
      continue
    }
    // TileJSON wajib sudah disisipkan backend. Kalau `url` masih ada, peramban
    // akan memintanya sendiri ke MAPID - permintaan lintas-asal yang terbukti
    // gagal sesekali dengan ERR_FAILED.
    for (const [nama, s] of Object.entries(gaya.sources)) {
      if (s.url) {
        console.warn(`  ${id.padEnd(20)} peringatan: source "${nama}" masih memakai url`)
      }
    }

    await fs.writeFile(path.join(KELUARAN, `${id}.json`), teks, 'utf-8')
    console.log(`  ${id.padEnd(20)} OK  ${(teks.length / 1024).toFixed(0)} KB`)
  }

  if (gagal) {
    console.error(`\n${gagal} gaya gagal. Pastikan backend hidup di ${BACKEND}.`)
    process.exit(1)
  }
  console.log(`\nSelesai -> ${path.relative(process.cwd(), KELUARAN)}`)
}

main()
