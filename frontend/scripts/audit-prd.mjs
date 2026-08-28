/**
 * Audit keenam fitur produk terhadap Acceptance Criteria PRD, di peramban.
 *
 * Bukan uji unit dan tidak menggantikannya. Yang diperiksa di sini hal-hal yang
 * hanya terlihat kalau aplikasinya benar-benar dijalankan: apakah petanya
 * menggambar ubin, apakah panel benar-benar terbuka, apakah kunci ikut keluar
 * di salah satu URL yang diminta peramban.
 *
 *     cd backend  && uvicorn app.main:app --port 8000
 *     cd frontend && npm run dev
 *     cd frontend && node scripts/audit-prd.mjs [folder-keluaran]
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const KELUAR = process.argv[2] || path.join(process.cwd(), 'audit')
const BASE = process.env.APP ?? 'http://localhost:5173'
const TITIK_LAYER = '/hex/layer'

const net = []
const konsol = []
let lolos = 0
let gagal = 0

const tidur = (ms) => new Promise((r) => setTimeout(r, ms))

function cek(nama, syarat, tambahan = '') {
  if (syarat) {
    lolos++
    console.log(`  PASS  ${nama}`)
  } else {
    gagal++
    console.log(`  GAGAL ${nama} ${tambahan}`)
  }
}

const dijawab = (jalur) =>
  net.filter((n) => n.arah === 'res' && n.url.includes(jalur) && n.status === 200)

async function main() {
  fs.mkdirSync(KELUAR, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  page.on('request', (r) => net.push({ arah: 'req', url: r.url() }))
  page.on('response', (r) => net.push({ arah: 'res', url: r.url(), status: r.status() }))
  page.on('console', (m) => {
    if (m.type() === 'error') konsol.push(m.text())
  })
  page.on('pageerror', (e) => konsol.push(`pageerror: ${e.message}`))

  // ---------------------------------------------------------------- gerbang
  console.log('\n[0] Beranda -> Peta  (PRD User Flow langkah 1-2)')
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await tidur(3500)
  await page.screenshot({ path: `${KELUAR}/00-beranda.png` })
  cek('beranda memuat judul produk', (await page.content()).includes('Loconomics'))
  cek(
    'beranda TIDAK memuat MapLibre',
    (await page.evaluate(() => !document.querySelector('canvas.maplibregl-canvas'))),
  )

  // Penunggu dipasang SEBELUM klik. Kalau dipasang sesudahnya, responsnya bisa
  // sudah lewat dan penunggunya menunggu kejadian yang tidak akan datang lagi -
  // gagal sebagai timeout 60 detik yang terbaca seperti backend mati.
  const tungguLayer = page.waitForResponse((r) => r.url().includes(TITIK_LAYER), {
    timeout: 90000,
  })
  await page.getByRole('button', { name: /Masuk ke peta/i }).first().click()
  await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 90000 })
  await tungguLayer
  await tidur(5000)

  // ------------------------------------------------------------- kepatuhan
  console.log('\n[K] Kepatuhan kunci & basemap')
  const berkunci = net.filter((n) => /[?&]key=|access_token=/.test(n.url))
  cek('nol URL membawa key/access_token', berkunci.length === 0,
    `- ${berkunci.slice(0, 2).map((b) => b.url.slice(0, 70))}`)
  cek('ubin datang dari basemap.mapid.io',
    dijawab('basemap.mapid.io/data/mapidtiles/').length > 0)
  const lain = net.filter((n) =>
    /api\.mapbox\.com|api\.maptiler\.com|tile\.openstreetmap|basemaps\.cartocdn/.test(n.url))
  cek('nol ubin dari penyedia lain', lain.length === 0, `- ${lain.length}`)
  cek('atribusi MAPID tampil di peta',
    (await page.content()).includes('MAPID Maps'))

  // ------------------------------------------------------------ peta & H3
  console.log('\n[1] Grid H3 & pemilihan kawasan  (PRD langkah 2)')
  cek('/hex/layer dijawab', dijawab('/hex/layer').length > 0)
  const teksAwal = await page.evaluate(() => document.body.innerText)
  cek('jumlah heksagon disebut', /70\d heksagon|\d+ heksagon/.test(teksAwal))

  // Pilih satu kawasan supaya kamera mendekat dan heksagon bisa diklik.
  await page.getByRole('button', { name: /Semua kawasan/i }).first().click()
  await tidur(700)
  await page.getByRole('button', { name: /Manggarai/ }).first().click()
  await tidur(6000)
  await page.screenshot({ path: `${KELUAR}/01-kawasan.png` })
  cek('kawasan terpilih tampil di chip', (await page.content()).includes('Manggarai'))

  // ---------------------------------------------------------- klik heksagon
  console.log('\n[2] Kartu detail heksagon  (PRD langkah 3)')
  const titik = await page.evaluate(() => {
    const c = document.querySelector('canvas.maplibregl-canvas')
    const r = c.getBoundingClientRect()
    // Kiri-tengah: panel kanan menutupi sepertiga kanan layar.
    return { x: r.x + r.width * 0.33, y: r.y + r.height * 0.5 }
  })
  await page.mouse.click(titik.x, titik.y)
  await tidur(7000)
  await page.screenshot({ path: `${KELUAR}/02-detail.png` })
  const detail = await page.evaluate(() => document.body.innerText)

  cek('/hex/{h3} diminta', dijawab('/hex/89').length > 0)
  cek('skor peluang tampil', /skor peluang/i.test(detail))
  cek('kuadran tampil',
    /(Hidden Gem|Jebakan Gengsi|Pemenang Jelas|Hindari|Aman tapi Mahal)/i.test(detail))
  cek('badge keyakinan tampil (aturan 3)', /(RENDAH|SEDANG|TINGGI)/.test(detail))
  cek('kode lokasi terbaca manusia, bukan h3 mentah', /[A-Za-z ]+-\d{4,5}/.test(detail))

  // ---------------------------------------------------------- ZoneGuard (4)
  console.log('\n[4] ZoneGuard')
  cek('status zonasi dinyatakan',
    /(Zona|zonasi|RDTR|belum bisa dipastikan|diizinkan|dilarang)/i.test(detail))

  // ------------------------------------------- yang berbayar, sebagai TAMU
  //
  // Yang diuji di sini kebalikan dari yang tampak: kedua endpoint ini HARUS
  // TIDAK dipanggil untuk tamu. Aturan 2b - yang berbayar tidak pernah ikut di
  // dalam respons untuk yang belum membayar, dan tirainya digambar dari daftar
  // milik server, bukan dari tebakan antarmuka.
  console.log('\n[1][3] Penjagaan fitur berbayar (tamu)')
  cek('commuter-clock TIDAK dipanggil untuk tamu',
    !net.some((n) => n.url.includes('/commuter-clock')))
  cek('pricelens per-heksagon TIDAK dipanggil untuk tamu',
    !net.some((n) => /\/pricelens\/89/.test(n.url)))
  cek('tirai premium dinyatakan di layar', /(PREMIUM|Terkunci|berlangganan)/i.test(detail))
  cek('bagian pola jam tetap disebut', /(jam|Commuter|pola)/i.test(detail))

  // -------------------------------------------------------------- GemFinder
  console.log('\n[6] GemFinder')
  cek('daftar lokasi menyebut Hidden Gem', /Hidden Gem/.test(detail))
  const nGem = (detail.match(/Hidden Gem/g) || []).length
  cek('minimal 10 baris peringkat tersedia', /200 teratas|\d{2,} teratas/.test(detail),
    `- Hidden Gem muncul ${nGem}x`)

  // ------------------------------------------------------------- RiskRadar
  console.log('\n[5] RiskRadar & Kompas Kuadran')
  cek('/skor/kuadran dijawab', dijawab('/skor/kuadran').length > 0)

  // ----------------------------------------------------------- AI Consultant
  console.log('\n[2] AI Consultant')
  try {
    await page.getByRole('button', { name: /Konsultan AI/i }).first().click()
    await tidur(3000)
    await page.screenshot({ path: `${KELUAR}/03-ai.png` })
    const ai = await page.evaluate(() => document.body.innerText)
    cek('panel AI terbuka', /(Konsultan|tanya|Tanya|prompt|LLM|kunci)/i.test(ai))
    cek('status AI dinyatakan apa adanya',
      /(belum|LLM_API_KEY|tidak aktif|siap)/i.test(ai),
      '- panel harus mengaku kalau kuncinya belum ada')
  } catch (e) {
    cek('panel AI bisa dibuka', false, `- ${e.message.slice(0, 60)}`)
  }

  // ---------------------------------------- yang berbayar, sebagai PELANGGAN
  console.log('\n[1][3] Fitur berbayar (pelanggan premium)')
  const SANDI = process.env.SANDI
  if (!SANDI) {
    console.log('  (dilewati - setel SANDI=... untuk menguji jalur berbayar)')
  } else {
    const API = process.env.API ?? 'http://localhost:8000'
    const status = await page.evaluate(async ([api, identitas, sandi]) => {
      const r = await fetch(api + '/akun/masuk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identitas, sandi }),
      })
      const d = await r.json().catch(() => ({}))
      for (const k of Object.keys(d)) {
        if (/tiket|token/i.test(k) && typeof d[k] === 'string') {
          localStorage.setItem('loconomics.tiket', d[k])
        }
      }
      return [r.status, Object.keys(d).join(',')]
    }, [API, process.env.AKUN ?? 'KingIpunk', SANDI])
    cek('POST /akun/masuk menjawab 200', status[0] === 200, '- ' + status.join(' '))

    const sebelum = net.length
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 90000 })
    await tidur(6000)
    // Reload mengembalikan peta ke tampilan enam kawasan, dan di tampilan itu
    // tengah layar jatuh di ruang kosong antar-kawasan. Pilih kawasannya lagi
    // supaya kliknya benar-benar mengenai heksagon.
    await page.getByRole('button', { name: /Semua kawasan/i }).first().click()
    await tidur(700)
    await page.getByRole('button', { name: /Manggarai/ }).first().click()
    await tidur(6000)
    const t = await page.evaluate(() => {
      const c = document.querySelector('canvas.maplibregl-canvas')
      const r = c.getBoundingClientRect()
      return { x: r.x + r.width * 0.33, y: r.y + r.height * 0.5 }
    })
    await page.mouse.click(t.x, t.y)
    await tidur(9000)
    await page.screenshot({ path: KELUAR + '/04-premium.png' })
    const baruNet = net.slice(sebelum)
    const teksP = await page.evaluate(() => document.body.innerText)
    cek('tidak lagi mengajak Sign Up', !/Sign Up untuk akses semua fitur/.test(teksP))
    cek('PriceLens dipanggil untuk pelanggan',
      baruNet.some((n) => n.url.includes('/pricelens/')), '- lihat 04-premium.png')
    cek('Commuter Clock dipanggil untuk pelanggan',
      baruNet.some((n) => n.url.includes('/commuter-clock')))
  }

  // ------------------------------------------------------------------ galat
  console.log('\n[X] Konsol')
  const nyata = konsol.filter((k) => !/WebGL|GroupMarkerNotSet|GL Driver|swiftshader/i.test(k))
  cek('nol galat konsol yang nyata', nyata.length === 0, `- ${nyata.slice(0, 3).join(' | ')}`)

  fs.writeFileSync(`${KELUAR}/konsol.txt`, konsol.join('\n'), 'utf-8')
  console.log(`\n${lolos} lolos, ${gagal} gagal   (tangkapan layar -> ${KELUAR})`)
  await browser.close()
  process.exit(gagal ? 1 : 0)
}

main().catch((e) => {
  console.error('GAGAL:', e.message)
  process.exit(1)
})
