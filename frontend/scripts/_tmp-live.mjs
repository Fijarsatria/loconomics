/** Buka situs yang SUDAH TERBIT, bukan yang lokal. */
import { chromium } from 'playwright'
const K = process.argv[2]
const URL = 'https://fijarsatria.github.io/loconomics/'
const tidur = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
const err = []
const net = []
p.on('pageerror', (e) => err.push(e.message))
p.on('console', (m) => { if (m.type() === 'error') err.push(m.text().slice(0, 120)) })
p.on('response', (r) => net.push({ u: r.url(), s: r.status() }))

await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 })
await tidur(6000)
await p.screenshot({ path: `${K}/live-gerbang.png` })
console.log('judul   :', await p.title())
console.log('gerbang :', await p.evaluate(() => /LOCONOMICS/.test(document.body.innerText)))

await p.getByRole('button', { name: /Masuk ke peta/i }).first().click()
await p.waitForSelector('canvas.maplibregl-canvas', { timeout: 90000 })
await tidur(12000)
await p.screenshot({ path: `${K}/live-peta.png` })

const geo = net.filter((n) => n.u.includes('hex-') && n.u.endsWith('.geojson'))
console.log('geojson :', geo.map((g) => `${g.s} ${g.u.split('/').pop()}`).join(', ') || '(tidak diminta)')
const nHex = await p.evaluate(() =>
  document.body.innerText.match(/([\d.]+)\s*heksagon/)?.[1] ?? null)
console.log('heksagon:', nHex)
const gagal = net.filter((n) => n.s >= 400 && !n.u.includes('mapid.io'))
console.log('gagal   :', gagal.length ? gagal.slice(0, 3).map((g) => `${g.s} ${g.u.slice(-50)}`) : 'nol')
console.log('galat JS:', err.length, err.slice(0, 2))
await b.close()
