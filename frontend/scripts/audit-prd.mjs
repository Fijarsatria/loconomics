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

/**
 * Modul yang dibangkitkan `s7_publish.py --ekspor`, dibaca sebagai TEKS.
 *
 * Dibaca, bukan diimpor: ia TypeScript, dan skrip ini Node polos. Yang
 * dibutuhkan pun cuma teksnya — pertanyaan yang dijawab bagian `#temuan` di
 * bawah adalah "apakah angka ini ADA di sini", bukan "berapa nilainya".
 */
function sumberRingkasan() {
  const berkas = path.join(process.cwd(), 'src', 'lib', 'ringkasan-data.ts')
  return fs.existsSync(berkas) ? fs.readFileSync(berkas, 'utf8') : ''
}

/** Judul tiap temuan yang diterbitkan pembangkitnya. */
function judulTemuan(teks) {
  return [...teks.matchAll(/"judul":\s*"((?:[^"\\]|\\.)*)"/g)].map((m) =>
    JSON.parse(`"${m[1]}"`),
  )
}

const TOKEN_ANGKA = /\d[\d.,]*\d|\d/g

/**
 * Satu token angka jadi NILAI. Dibandingkan sebagai nilai, bukan sebagai teks.
 *
 * Wajib begitu, dan percobaan pertama membuktikannya dengan cara yang mahal:
 * membandingkan sebagai substring menuduh `1,50`, `2,31`, dan `3,00` ditulis
 * tangan, padahal ketiganya persis angka `1.5`, `2.31`, dan `3.0` dari modulnya
 * — yang berbeda cuma pemformatan Indonesia dan nol di belakang koma yang
 * ditambahkan `toLocaleString`. Penjaga yang menuduh berkas yang benar akan
 * dimatikan orang, dan penjaga yang dimatikan tidak menjaga apa-apa.
 *
 * `id` menandai ejaan Indonesia (titik ribuan, koma desimal); tanpanya ejaan
 * JavaScript. Modul yang dibangkitkan memuat KEDUANYA — angka JSON dalam ejaan
 * JS, dan angka di dalam prosa dalam ejaan Indonesia.
 */
function keNilai(token, id) {
  const bersih = id ? token.replace(/\./g, '').replace(',', '.') : token.replace(/,/g, '')
  const n = Number(bersih)
  return Number.isFinite(n) ? n : null
}

/** Semua nilai yang muncul di modul, dibaca dengan kedua ejaan sekaligus. */
function nilaiDiModul(teks) {
  const set = new Set()
  for (const t of teks.match(TOKEN_ANGKA) ?? []) {
    for (const id of [false, true]) {
      const v = keNilai(t, id)
      if (v !== null) set.add(v)
    }
  }
  return set
}

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

  // ------------------------------------------------------ temuan di gerbang
  //
  // Bagian `#temuan` menyatakan KESIMPULAN, dan seluruh isinya - termasuk
  // kalimatnya - dibangkitkan `s7_publish.py --ekspor`. Yang dijaga di sini
  // satu invarian, dan ia hanya bisa diperiksa di tempat ini: SETIAP ANGKA
  // YANG TERLIHAT di bagian itu wajib ada di dalam `ringkasan-data.ts`.
  //
  // Kenapa di peramban dan bukan di uji unit: percobaan pertama memindai
  // `GerbangTemuan.tsx` dari Python dan lolos atas STRING KOSONG - pengupas
  // `{...}` berulangnya ikut memakan badan setiap fungsi, karena badan fungsi
  // juga `{...}`. Ia disisipi satu angka tulis tangan dan tetap hijau. Teks
  // yang dirender tidak bisa ditebak salah seperti itu.
  console.log('\n[T] Temuan di gerbang — nol angka tulis tangan')
  const ringkasanTs = sumberRingkasan()
  const judul = judulTemuan(ringkasanTs)
  cek('ringkasan-data.ts memuat temuan', judul.length > 0, '- jalankan s7_publish.py --ekspor')

  const temuanTeks = await page.evaluate(() => {
    const s = document.querySelector('#temuan')
    if (!s) return null
    s.scrollIntoView({ block: 'start' })
    return s.innerText
  })
  cek('bagian #temuan ada di gerbang', temuanTeks !== null)

  if (temuanTeks && judul.length) {
    cek(
      'setiap judul temuan benar-benar dirender',
      judul.every((j) => temuanTeks.includes(j)),
      `- hilang: ${judul.filter((j) => !temuanTeks.includes(j)).slice(0, 1)}`,
    )

    // Tiap angka yang TERLIHAT harus punya pasangan nilai di modulnya.
    const adaDiModul = nilaiDiModul(ringkasanTs)
    const liar = [...new Set(temuanTeks.match(TOKEN_ANGKA) ?? [])].filter((t) => {
      const v = keNilai(t, true)
      return v !== null && !adaDiModul.has(v)
    })
    cek(
      'nol angka di #temuan yang tidak ada di ringkasan-data.ts',
      liar.length === 0,
      `- ditulis tangan: ${liar.slice(0, 5).join(', ')}`,
    )
  }

  await page.screenshot({ path: `${KELUAR}/00b-temuan.png` })
  await page.evaluate(() => {
    const w = document.querySelector('.gerbang') ?? document.scrollingElement
    w.scrollTo({ top: 0 })
  })
  await tidur(600)

  // Penunggu dipasang SEBELUM klik. Kalau dipasang sesudahnya, responsnya bisa
  // sudah lewat dan penunggunya menunggu kejadian yang tidak akan datang lagi -
  // gagal sebagai timeout 60 detik yang terbaca seperti backend mati.
  const tungguLayer = page.waitForResponse((r) => r.url().includes(TITIK_LAYER), {
    timeout: 90000,
  })
  // Ubin ditunggu juga, dan bukan lewat `tidur`. MapLibre MEMBATALKAN ubin yang
  // sudah tidak dibutuhkan begitu kamera bergeser - terukur 18 dari 30
  // permintaan pulang sebagai `ERR_ABORTED` pada satu kali muat yang sehat. Jadi
  // "sudah lewat 5 detik" tidak sama dengan "ada ubin yang pulang", dan asersi
  // kepatuhan di bawah sempat merah pada basemap yang baik-baik saja.
  //
  // `.catch` supaya pemadaman MAPID sungguhan tidak menghentikan seluruh audit:
  // yang melaporkannya asersi di bawah, bukan pengecualian di tengah jalan.
  const tungguUbin = page
    .waitForResponse(
      (r) => r.url().includes('basemap.mapid.io/data/mapidtiles/') && r.status() === 200,
      { timeout: 45000 },
    )
    .catch(() => null)
  await page.getByRole('button', { name: /Masuk ke peta/i }).first().click()
  await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 90000 })
  await tungguLayer
  await tungguUbin
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
  //
  // `role: 'option'`, BUKAN 'button'. Item dropdown-nya memang elemen <button>,
  // tetapi ia membawa `role="option"` eksplisit - dan peran eksplisit menimpa
  // peran implisitnya, jadi `getByRole('button')` tidak pernah mengkliknya.
  // Selama berbulan-bulan langkah ini tidak melakukan apa pun dan tidak ada yang
  // tahu, karena asersi di bawahnya dulu berbunyi `content().includes(
  // 'Manggarai')` - dan "Manggarai" memang ada di DOM sebagai salah satu PILIHAN
  // di dropdown, terpilih atau tidak. Asersi yang tetap benar saat aksinya gagal
  // bukan asersi.
  await page.getByRole('button', { name: /Semua kawasan/i }).first().click()
  await tidur(700)
  await page.getByRole('option', { name: /Manggarai/ }).first().click()
  await tidur(6000)
  await page.screenshot({ path: `${KELUAR}/01-kawasan.png` })
  const labelKawasan = await page.evaluate(
    () =>
      [...document.querySelectorAll('button[aria-haspopup="listbox"]')]
        .map((b) => b.textContent?.trim() ?? '')
        .find((t) => /kawasan/i.test(t)) ?? '',
  )
  cek('kawasan terpilih tampil di chip', /Manggarai/.test(labelKawasan), `- chip: "${labelKawasan}"`)
  cek(
    'diagram kuadran ikut disaring ke kawasan itu',
    net.some((n) => n.arah === 'res' && /\/skor\/kuadran\?.*kawasan=Manggarai/.test(n.url)),
    '- /skor/kuadran tidak pernah diminta ulang dengan kawasannya',
  )

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
  // "Skor Peluang" diganti "Opportunity Score" (3 Sep 2026). Asersi lama
  // mencari /skor peluang/i dan akan GAGAL DIAM sesudah penggantian itu -
  // persis bentuk uji yang lolos karena menanyakan hal yang sudah tidak ada.
  // Keduanya diterima supaya audit ini tidak ikut merah kalau ada layar yang
  // belum sempat ikut diganti.
  cek('opportunity score tampil', /(opportunity score|skor peluang)/i.test(detail))
  cek('kuadran tampil',
    /(Hidden Gem|Jebakan Gengsi|Pemenang Jelas|Hindari|Aman)/i.test(detail))
  cek('badge keyakinan tampil (aturan 3)', /(RENDAH|SEDANG|TINGGI)/.test(detail))
  cek('kode lokasi terbaca manusia, bukan h3 mentah', /[A-Za-z ]+-\d{4,5}/.test(detail))

  // -------------------------------------------------- kejujuran sumbu prestise
  //
  // Sumbu datar kuadran dirata-ratakan dari LIMA bahan dengan `skipna=True`, dan
  // dua di antaranya kosong di seluruh 708 heksagon - keduanya justru
  // satu-satunya yang menilai tampilan secara LANGSUNG (M03 dari foto, P02 dari
  // nilai tanah). Panel ini dulu menulis "Bangunan dan tokonya TERLIHAT lebih
  // mahal", dan itu mengaku ada yang melihat.
  //
  // Yang dijaga di sini tidak bisa hidup di uji unit mana pun: apakah angka di
  // dalam KALIMAT YANG DIRENDER sama dengan panjang larik yang benar-benar
  // dikirim backend. Kalimat yang ditulis tangan akan tetap berbunyi "tiga dari
  // lima" berbulan-bulan sesudah M03 masuk, dan tidak satu pun uji unit bisa
  // membedakannya dari kalimat yang dibangkitkan.
  console.log('\n[2] Sumbu prestise menyebut ia berdiri di atas apa')
  const urlDetail = net
    .filter((n) => n.arah === 'res' && /\/hex\/(89[0-9a-f]{13})(\?|$)/.test(n.url))
    .pop()?.url
  cek('respons detail heksagon terekam', Boolean(urlDetail))

  const cakupanX = urlDetail
    ? await page.evaluate(
        async (u) => (await (await fetch(u)).json()).cakupan_prestise,
        urlDetail,
      )
    : null
  cek(
    'backend mengirim cakupan_prestise ke TAMU (ia keterangan mutu, bukan isi berbayar)',
    Boolean(cakupanX) && Array.isArray(cakupanX.terisi) && Array.isArray(cakupanX.kosong),
    `- ${JSON.stringify(cakupanX)}`,
  )

  const frasa = detail.match(/Diperkirakan dari (\d+) dari (\d+) bahan/)
  cek('panel menyatakan sumbu prestise diperkirakan dari berapa bahan', Boolean(frasa),
    '- kalimatnya tidak ada di layar')
  if (frasa && cakupanX) {
    cek(
      'angka di kalimat sama dengan yang dikirim backend',
      Number(frasa[1]) === cakupanX.terisi.length &&
        Number(frasa[2]) === cakupanX.terisi.length + cakupanX.kosong.length,
      `- layar ${frasa[1]}/${frasa[2]}, backend ${cakupanX.terisi.length}/` +
        `${cakupanX.terisi.length + cakupanX.kosong.length}`,
    )
  }
  if (cakupanX && !cakupanX.diukur_langsung) {
    cek(
      'panel menyatakan tidak ada penilai tampilan langsung',
      /menilai tampilannya secara langsung/.test(detail),
    )
  }
  // Kalimatnya sendiri harus berbunyi PERKIRAAN, bukan pengamatan. Menambah
  // keterangan jujur di bawah kalimat yang mengaku melihat cuma membuat panel
  // ini menyatakan dua hal sekaligus.
  //
  // Ditulis sebagai asersi POSITIF, dan itu perbaikan atas versi pertamanya.
  // Versi pertama berbunyi `!/terlihat lebih mahal/` - dan ia TETAP HIJAU saat
  // klaim lama sengaja dikembalikan, karena kalimat itu cuma satu dari DUA
  // cabang dan heksagon yang diklik audit kebetulan merender cabang yang lain.
  // Asersi negatif atas cabang yang tidak dirender tidak menguji apa pun.
  //
  // Yang di sini tetap cuma menguji SATU cabang - yang benar-benar dirender -
  // dan itu memang batas satu klik. Cabang yang satunya dijaga
  // `test_klaim_melihat_bangunan_tidak_ada_lagi_di_mana_pun` di
  // backend/tests/test_aturan.py, yang menyapu seluruh `src/`. Keduanya
  // diperiksa arah gagalnya: yang ini berteriak untuk cabang bawah-median, yang
  // di sana untuk kedua-duanya.
  cek(
    'kalimat sumbu prestise berbunyi perkiraan, bukan pengamatan',
    /Diperkirakan tampak lebih (mahal|biasa) daripada separuh lokasi lain/.test(detail),
    '- kalimat yang dirender bukan bentuk perkiraan',
  )

  // Diagram penuh: satu-satunya tempat sumbu itu DIJELASKAN, jadi keterangannya
  // harus sampai ke sana juga. Kalimat yang sama pernah diperbaiki di satu
  // tempat lalu tertinggal di tempat lain - Legenda menuduh angkanya tebakan
  // model di TIGA tempat berbulan-bulan sesudah tooltipnya dibetulkan.
  await page.click('[title="Lihat posisinya di diagram kuadran"]').catch(() => {})
  await tidur(1500)
  const dialogKuadran = await page.evaluate(
    () => document.querySelector('[aria-label="Diagram kuadran"]')?.innerText ?? '',
  )
  cek('diagram kuadran penuh terbuka', dialogKuadran.length > 0)
  cek(
    'penjelasan sumbu ikut menyebut ia berdiri di atas apa',
    // Case-insensitive, dan itu bukan kelonggaran. `.eyebrow` memakai
    // `text-transform: uppercase`, dan `innerText` mengembalikan teks SESUDAH
    // transformasi CSS - jadi judul yang di sumbernya "Sumbu datar berdiri di
    // atas apa" sampai ke sini sebagai "SUMBU DATAR BERDIRI DI ATAS APA".
    // Versi pertama asersi ini peka huruf dan MENUDUH kode yang benar.
    /sumbu datar berdiri di atas apa/i.test(dialogKuadran) &&
      /Diperkirakan dari \d+ dari \d+ bahan/.test(dialogKuadran),
    '- keterangan yang sama tidak sampai ke diagram penuh',
  )
  await page.screenshot({ path: `${KELUAR}/02b-kuadran-penuh.png` })
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Tutup')
    t?.click()
  })
  await tidur(800)

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
  // Kepalanya menulis "N teratas" kalau daftarnya kena BATAS_BARIS, "N lokasi"
  // kalau tidak - dan sejak saringan kawasan benar-benar bekerja, Manggarai
  // (122 baris) selalu jatuh ke bentuk kedua. Versi sebelumnya cuma menerima
  // "teratas", jadi ia mengukur ADA-TIDAKNYA saringan, bukan ada-tidaknya
  // daftar. Yang ditanyakan asersi ini jumlahnya, jadi yang dibaca angkanya.
  const jumlahBaris = detail.match(/(\d[\d.]*)\s+(?:teratas|lokasi)/)
  cek('minimal 10 baris peringkat tersedia',
    Boolean(jumlahBaris) && Number(jumlahBaris[1].replaceAll('.', '')) >= 10,
    `- ${jumlahBaris ? jumlahBaris[0] : 'jumlah baris tidak tercetak'}, Hidden Gem ${nGem}x`)

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
    // Kawasan BERTAHAN menembus reload - ia disimpan di localStorage, dan itu
    // disengaja: yang tidak boleh diulang sesudah refresh cuma perkenalannya,
    // bukan latar kerjanya. Jadi kamera sudah berada di Manggarai dan klik di
    // bawah langsung mengenai heksagon.
    //
    // Versi sebelumnya membuka dropdown lagi di sini, dengan komentar yang
    // menyatakan reload mengembalikan peta ke enam kawasan. Itu keliru, dan
    // tidak pernah ketahuan karena pemilihan pertamanya pun tidak pernah
    // berhasil - dua langkah yang sama-sama tidak melakukan apa-apa saling
    // membenarkan.
    const kawasanSesudahMuatUlang = await page.evaluate(
      () =>
        [...document.querySelectorAll('button[aria-haspopup="listbox"]')]
          .map((b) => b.textContent?.trim() ?? '')
          .find((t) => /kawasan/i.test(t)) ?? '',
    )
    cek(
      'kawasan bertahan menembus refresh',
      /Manggarai/.test(kawasanSesudahMuatUlang),
      `- chip: "${kawasanSesudahMuatUlang}"`,
    )
    // Kamera TERBANG ke kawasan yang dipulihkan, dan penerbangannya belum
    // selesai pada detik keenam. Klik yang mendahuluinya mendarat di peta yang
    // masih bergerak, tidak memilih apa pun, dan gagalnya muncul jauh di
    // bawah sebagai "PriceLens tidak dipanggil" - gejala yang menunjuk ke
    // tempat yang salah sama sekali.
    await tidur(7000)
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
