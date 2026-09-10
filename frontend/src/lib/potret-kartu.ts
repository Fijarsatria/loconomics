/**
 * Pemotret kartu peta — dijalankan SEKALI oleh skrip, bukan oleh pengguna.
 *
 * Berkas ini TIDAK pernah diimpor oleh kode aplikasi. Ia hanya diimpor secara
 * dinamis oleh `scripts/potret-kartu.mjs` lewat dev server, jadi ia tidak ikut
 * masuk bundel yang diunduh pengunjung — dan itulah seluruh gunanya: halaman
 * gerbang boleh menampilkan enam peta tanpa memuat MapLibre sama sekali.
 *
 * KENAPA BUKAN TANGKAPAN LAYAR BIASA
 * ==================================
 *
 * Gambar yang dipotret tangan lalu di-commit akan basi diam-diam. Ganti palet
 * kuadran, geser ambang, jalankan ulang `s7_publish` - keenam gambarnya tetap
 * memperlihatkan keadaan lama, dan tidak ada satu pun uji yang bisa menangkapnya.
 *
 * Yang di sini membangun peta MapLibre sungguhan, memakai ekspresi pewarnaan
 * yang SAMA dengan peta di dalam aplikasi (`lib/layer-peta.ts`), dan mengambil
 * heksagonnya dari `/hex/layer` yang sedang hidup. Jadi gambarnya tetap bisa
 * basi - tetapi menyegarkannya satu perintah, dan hasilnya dijamin sama dengan
 * apa yang akan dilihat orang begitu ia masuk ke aplikasinya.
 */

import { Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

import { urlGaya, type NamaGaya, type NamaLayer } from '../config'
import { api } from './api'
import {
  ANGKA_LAYER,
  FONT_ANGKA,
  GARIS_HEX,
  OPASITAS_LAYER,
  SELUBUNG,
  TEKS_HEX,
  WARNA_LAYER,
  idLabelPertama,
} from './layer-peta'

/**
 * Geometri heksagon SUNGGUHAN untuk lapisan sorot kartu gerbang.
 *
 * Kenapa ada: kartu Solusi dulu memakai kisi heksagon karangan yang menutupi
 * seluruh kotak gambar - kisi yang tidak berdiri di tempat mana pun, tidak
 * membawa satu angka pun, dan tidak menjawab pertanyaan kartunya. Dilaporkan
 * apa adanya: "animasi layer heksagon yang jelek dan ga nyambung sama masing
 * masing konteks".
 *
 * Yang keluar dari sini heksagon yang BENAR-BENAR ada di petanya, pada posisi
 * piksel yang sama persis dengan posisinya di dalam WebP di sebelahnya - kamera
 * `fitBounds` yang dipakai `potretKartu()` di atas dipakai ulang apa adanya.
 * Warnanya pun tidak ditebak: heksagonnya digambar MapLibre memakai
 * `WARNA_LAYER` yang sama dengan aplikasinya, lalu piksel di titik pusatnya
 * DIBACA kembali dari kanvas. Tidak ada salinan kedua aturan pewarnaan yang
 * bisa berpisah diam-diam.
 *
 * Dan yang disorot bukan sembarang heksagon: tiap kartu memilih yang MENJAWAB
 * pertanyaannya sendiri - skor tertinggi untuk kartu memilih lokasi, sewa
 * termurah untuk kartu menakar sewa, zona terlarang untuk ZoneGuard.
 */
export type PilihSorot = 'skor' | 'sewa-murah' | 'gem' | 'terlarang' | 'churn'

export interface PesananSorot {
  kawasan: string
  layer: NamaLayer
  lebar: number
  tinggi: number
  pilih: PilihSorot
  banyak: number
}

export interface HasilSorot {
  /** Kotak gambar, sama dengan potretnya. Jadi viewBox SVG di gerbang. */
  w: number
  h: number
  /** Pusat kawasan dalam piksel - titik asal gelombang, sama dengan di peta. */
  cx: number
  cy: number
  /**
   * Simpangan enam simpul dari pusat selnya, dalam piksel.
   *
   * SATU bentuk untuk seluruh sel di satu kartu. Bukan penyederhanaan yang
   * dikira-kira: simpangan terbesar antar sel pada kartu terbesar terukur
   * 0,01 piksel - di bawah seperseratus piksel, karena satu kawasan cuma
   * membentang dua kilometer dan distorsi Mercator sebesar itu tidak ada.
   * Menyimpan 108 poligon lengkap akan melipatgandakan berkasnya untuk
   * perbedaan yang tidak bisa dilihat alat ukur mana pun.
   */
  bentuk: number[]
  /** Pusat SELURUH sel: [x0, y0, x1, y1, ...]. Kisi konteks. */
  sel: number[]
  /** Yang menjawab pertanyaan kartu, URUT sesuai jawabannya. */
  sorot: { x: number; y: number; c: string }[]
  /**
   * Rute jalan kaki SUNGGUHAN dari heksagon teratas ke simpul terdekatnya,
   * dalam piksel kotak gambar yang sama.
   *
   * Datang dari `hex_routes` lewat `/hex/{h3}/simpul-terdekat` - geometri
   * OpenRouteService yang sama yang digambar peta, bukan garis lurus. Itu
   * bedanya: rute di sini memutar 1,6x dari jarak lurusnya rata-rata, dan garis
   * lurus akan menggambarkan janji yang tidak ditepati produk ini.
   *
   * null kalau heksagon teratasnya memang belum punya rute.
   */
  rute: { d: string; ax: number; ay: number; bx: number; by: number; menit: number; simpul: string } | null
}

/** Nilai yang dipakai memilih, dan arahnya. Null = tidak memenuhi syarat. */
function nilaiPilih(p: Record<string, unknown>, pilih: PilihSorot): number | null {
  const angka = (k: string) => (typeof p[k] === 'number' ? (p[k] as number) : null)
  if (pilih === 'skor') return angka('opportunity_score')
  if (pilih === 'gem') return angka('hidden_gem_score')
  if (pilih === 'churn') return angka('indeks_churn')
  if (pilih === 'sewa-murah') {
    const v = angka('harga_sewa_per_m2')
    // Dibalik supaya "besar = lebih dulu" berlaku untuk kelimanya: yang
    // termurah yang paling menjawab kartu "menakar sewa".
    return v === null ? null : -v
  }
  // ZoneGuard: yang DILARANG, dan hanya yang benar-benar berstatus false.
  // NULL berarti kawasannya belum punya RDTR digital - bukan larangan, dan
  // memperlakukannya sebagai larangan adalah tuduhan yang salah.
  return p.zona_izin_komersial === false ? 1 : null
}

export async function sorotKartu(p: PesananSorot): Promise<HasilSorot> {
  const wadah = document.createElement('div')
  wadah.style.cssText = `position:fixed;left:0;top:0;width:${p.lebar}px;height:${p.tinggi}px;z-index:-1;opacity:0;pointer-events:none`
  document.body.appendChild(wadah)

  const data = (await api.layerHeksagon({ kawasan: p.kawasan })) as {
    features: { geometry?: { coordinates?: number[][][] }; properties?: Record<string, unknown> }[]
  }

  // Gaya KOSONG, sengaja: yang dihitung di sini geometri dan warna isian, dan
  // keduanya tidak butuh satu ubin pun. Latarnya hitam legap supaya piksel yang
  // dibaca nanti benar-benar warna isian, bukan campuran dengan apa pun.
  const m = new MapLibreMap({
    container: wadah,
    style: {
      version: 8,
      sources: {},
      layers: [{ id: 'latar', type: 'background', paint: { 'background-color': '#000000' } }],
    },
    center: [106.81, -6.2],
    zoom: 12,
    pitch: 0,
    bearing: 0,
    interactive: false,
    attributionControl: false,
    canvasContextAttributes: { preserveDrawingBuffer: true },
    pixelRatio: 1,
  })
  await new Promise<void>((selesai) => m.on('load', () => selesai()))

  m.addSource('s', { type: 'geojson', data: data as never })
  m.addLayer({
    id: 's-isi',
    type: 'fill',
    source: 's',
    paint: {
      'fill-color': WARNA_LAYER[p.layer],
      // Legap DAN tanpa antialias: yang dibaca nanti satu piksel di titik
      // pusat, dan piksel itu harus warna ekspresinya apa adanya.
      'fill-opacity': 1,
      'fill-antialias': false,
    },
  })

  const b = bingkaiDari(data)
  if (b) {
    m.fitBounds(b, {
      padding: Math.round(Math.max(14, Math.min(p.tinggi * 0.13, p.lebar * 0.1, 90))),
      animate: false,
    })
  }
  await new Promise<void>((selesai) => m.once('idle', () => selesai()))

  // Piksel dibaca SEKALI untuk seluruh kanvas. Membacanya per heksagon berarti
  // 108 kali penyalinan kanvas untuk satu kartu.
  const salin = document.createElement('canvas')
  salin.width = p.lebar
  salin.height = p.tinggi
  const ctx = salin.getContext('2d')
  if (!ctx) throw new Error('kanvas 2d tidak tersedia')
  ctx.drawImage(m.getCanvas(), 0, 0, p.lebar, p.tinggi)
  const piksel = ctx.getImageData(0, 0, p.lebar, p.tinggi).data

  const dua = (v: number) => v.toString(16).padStart(2, '0')
  const warnaDi = (x: number, y: number) => {
    const i =
      (Math.min(p.tinggi - 1, Math.max(0, Math.round(y))) * p.lebar +
        Math.min(p.lebar - 1, Math.max(0, Math.round(x)))) *
      4
    return `#${dua(piksel[i])}${dua(piksel[i + 1])}${dua(piksel[i + 2])}`
  }

  const bulat = (v: number) => Math.round(v * 10) / 10
  const sel: number[] = []
  const simpul: number[][] = []
  const daftar: { x: number; y: number; nilai: number | null; h3: string }[] = []

  for (const f of data.features) {
    const cincin = f.geometry?.coordinates?.[0]
    if (!cincin || cincin.length < 6) continue
    const titik = cincin.slice(0, 6).map(([a, c]) => {
      const q = m.project([a, c])
      return [q.x, q.y]
    })
    const x = titik.reduce((a, t) => a + t[0], 0) / 6
    const y = titik.reduce((a, t) => a + t[1], 0) / 6
    sel.push(bulat(x), bulat(y))
    simpul.push(titik.flatMap((t) => [t[0] - x, t[1] - y]))
    daftar.push({
      x,
      y,
      nilai: nilaiPilih(f.properties ?? {}, p.pilih),
      h3: String(f.properties?.h3_index ?? ''),
    })
  }

  const bentuk = Array.from({ length: 12 }, (_, i) =>
    bulat(simpul.reduce((a, s) => a + s[i], 0) / (simpul.length || 1)),
  )

  const terpilih = daftar
    .filter((d): d is { x: number; y: number; nilai: number; h3: string } => d.nilai !== null)
    .sort((a, c) => c.nilai - a.nilai)
    .slice(0, p.banyak)
  const sorot = terpilih.map((d) => ({ x: bulat(d.x), y: bulat(d.y), c: warnaDi(d.x, d.y) }))

  // Rute heksagon TERATAS saja. Enam rute di satu kartu kecil berhenti jadi
  // rute dan jadi benang kusut; satu rute menyatakan hal yang sama.
  let rute: HasilSorot['rute'] = null
  if (terpilih[0]) {
    try {
      const k = await api.simpulTerdekat(terpilih[0].h3)
      const garis = k.rute?.find((r) => r.utama) ?? k.rute?.[0]
      const titik = garis?.koordinat
      if (titik && titik.length > 1 && k.simpul) {
        const px = titik.map(([a, b]) => m.project([a, b]))
        const d = px
          .map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`)
          .join('')
        const b = m.project([k.simpul.lon, k.simpul.lat])
        rute = {
          d,
          ax: bulat(px[0].x),
          ay: bulat(px[0].y),
          bx: bulat(b.x),
          by: bulat(b.y),
          menit: Math.round(k.menit_jalan ?? 0),
          simpul: k.simpul.nama,
        }
      }
    } catch {
      /* Heksagon tanpa rute bukan galat: kartunya cuma tidak menggambar apa
         pun. Yang salah justru menggambar garis lurus sebagai gantinya. */
    }
  }

  // Pusat gelombang: rerata posisi seluruh sel, persis `bubuhiUrutan` di peta.
  const cx = daftar.reduce((a, d) => a + d.x, 0) / (daftar.length || 1)
  const cy = daftar.reduce((a, d) => a + d.y, 0) / (daftar.length || 1)

  m.remove()
  wadah.remove()
  return { w: p.lebar, h: p.tinggi, cx: bulat(cx), cy: bulat(cy), bentuk, sel, sorot, rute }
}

/** Angka yang ikut dikirim bersama gambarnya, supaya kartunya punya isi. */
export interface RingkasKartu {
  n: number
  kuadran: Record<string, number>
  sorotan: { nilai: string; label: string }
}

export interface PesananKartu {
  kawasan: string
  gaya: NamaGaya
  layer: NamaLayer
  lebar: number
  tinggi: number
  /** Angka di dalam heksagon. Hanya masuk akal pada kartu yang besar. */
  angka: boolean
  /** 0..1. Makin rendah makin kecil berkasnya. */
  mutu: number
}

/**
 * Satu angka sorot per layer, dihitung dari data yang sama yang baru saja
 * digambar.
 *
 * Bukan angka hiasan: tiap satu menjawab pertanyaan yang memang dibawa layernya.
 * Yang tidak punya data TIDAK dipaksa jadi nol - ia mengaku "belum ada data",
 * persis aturan 4 repo ini.
 */
function median(a: number[]) {
  if (!a.length) return null
  const b = [...a].sort((x, y) => x - y)
  return b[Math.floor(b.length / 2)]
}

function ringkasKartu(data: { features: unknown[] }, layer: NamaLayer): RingkasKartu {
  const f = data.features as { properties?: Record<string, unknown> }[]
  const kuadran: Record<string, number> = {}
  for (const x of f) {
    const k = typeof x.properties?.kuadran === 'string' ? x.properties.kuadran : 'TANPA'
    kuadran[k] = (kuadran[k] ?? 0) + 1
  }
  const kolom = (kunci: string) =>
    f.map((x) => x.properties?.[kunci]).filter((v): v is number => typeof v === 'number')

  const kosong = (label: string) => ({ nilai: '—', label: `${label} belum ada` })

  if (layer === 'pricelens') {
    const m = median(kolom('harga_sewa_per_m2'))
    return {
      n: f.length,
      kuadran,
      sorotan:
        m === null
          ? kosong('data sewa')
          : { nilai: `Rp${Math.round(m / 1000).toLocaleString('id-ID')} rb`, label: 'sewa median per m²' },
    }
  }
  if (layer === 'hidden_gem') {
    const k = kolom('hidden_gem_score').length
    return {
      n: f.length,
      kuadran,
      sorotan: k ? { nilai: String(k), label: 'kandidat Hidden Gem' } : kosong('skor gem'),
    }
  }
  if (layer === 'risk_radar') {
    const m = median(kolom('indeks_churn'))
    return {
      n: f.length,
      kuadran,
      sorotan:
        m === null
          ? kosong('indeks pergantian')
          : { nilai: m.toFixed(2).replace('.', ','), label: 'pergantian usaha median' },
    }
  }
  if (layer === 'zoneguard') {
    const boleh = f.filter((x) => x.properties?.zona_izin_komersial === true).length
    const dilarang = f.filter((x) => x.properties?.zona_izin_komersial === false).length
    // NOL yang berarti "belum terbit" TIDAK boleh dicetak sebagai nol.
    //
    // L01 bertipe tiga-nilai: TRUE mengizinkan, FALSE melarang, NULL berarti
    // kawasan itu belum punya RDTR digital sama sekali. Menghitung yang TRUE
    // saja lalu mencetaknya sebagai "0 heksagon boleh usaha" membaca sebagai
    // "usaha dilarang di seluruh kawasan ini" - dan untuk Depok, yang memang
    // belum punya RDTR terbit, itu tuduhan yang salah sekaligus membantah
    // bagian batasan halaman ini sendiri.
    //
    // Nol yang jujur hanya kalau ada yang DILARANG. Kalau tidak ada yang
    // diizinkan DAN tidak ada yang dilarang, yang benar: datanya belum ada.
    if (boleh === 0 && dilarang === 0)
      return { n: f.length, kuadran, sorotan: { nilai: '—', label: 'zonasi RDTR belum terbit' } }
    return { n: f.length, kuadran, sorotan: { nilai: String(boleh), label: 'heksagon boleh usaha' } }
  }
  const m = median(kolom('opportunity_score'))
  return {
    n: f.length,
    kuadran,
    sorotan:
      m === null ? kosong('skor') : { nilai: String(Math.round(m)), label: 'opportunity score median' },
  }
}

/** Bingkai dari seluruh titik sudut poligon yang benar-benar dikembalikan. */
function bingkaiDari(data: { features: unknown[] }) {
  let x1 = 180
  let y1 = 90
  let x2 = -180
  let y2 = -90
  for (const f of data.features as { geometry?: { coordinates?: number[][][] } }[]) {
    for (const c of f.geometry?.coordinates?.[0] ?? []) {
      if (c[0] < x1) x1 = c[0]
      if (c[0] > x2) x2 = c[0]
      if (c[1] < y1) y1 = c[1]
      if (c[1] > y2) y2 = c[1]
    }
  }
  return x2 > x1 ? ([[x1, y1], [x2, y2]] as [[number, number], [number, number]]) : null
}

/**
 * Satu kartu, satu WebP.
 *
 * Mengembalikan data URL. Skrip pemanggilnya yang menuliskannya ke berkas —
 * modul ini tidak tahu apa-apa soal sistem berkas, dan memang tidak perlu.
 */
export async function potretKartu(
  p: PesananKartu,
): Promise<{ gambar: string; ringkas: RingkasKartu }> {
  const wadah = document.createElement('div')
  wadah.style.cssText = `position:fixed;left:0;top:0;width:${p.lebar}px;height:${p.tinggi}px;z-index:-1;opacity:0;pointer-events:none`
  document.body.appendChild(wadah)

  const data = (await api.layerHeksagon({ kawasan: p.kawasan })) as { features: unknown[] }

  const m = new MapLibreMap({
    container: wadah,
    style: urlGaya(p.gaya),
    center: [106.81, -6.2],
    zoom: 12,
    pitch: 0,
    bearing: 0,
    interactive: false,
    attributionControl: false,
    // Tanpa ini buffer gambarnya sudah dikosongkan sebelum toDataURL sempat
    // membacanya, dan yang keluar kanvas hitam. Di MapLibre v6 ia pindah ke
    // `canvasContextAttributes`, tidak lagi di akar MapOptions.
    canvasContextAttributes: { preserveDrawingBuffer: true },
    // Dikunci di 1: ukuran potretnya sudah ditentukan pemesan, dan mengalikannya
    // dengan devicePixelRatio mesin yang kebetulan memotret akan membuat berkas
    // yang sama menghasilkan ukuran berbeda di tiap komputer.
    pixelRatio: 1,
  })

  await new Promise<void>((selesai) => m.on('load', () => selesai()))

  for (const l of m.getStyle().layers ?? []) {
    if (/^poi/.test(l.id) && l.type === 'symbol') m.setLayoutProperty(l.id, 'visibility', 'none')
  }
  const selubung = SELUBUNG[p.gaya]
  m.addLayer(
    {
      id: 'p-selubung',
      type: 'background',
      paint: {
        'background-color': selubung.warna,
        // Setengah tebal selubung aplikasi: di kartu sekecil ini basemap adalah
        // satu-satunya yang memberi tahu ini kota mana.
        'background-opacity': selubung.opasitas * 0.5,
      },
    },
    idLabelPertama(m),
  )

  m.addSource('p', { type: 'geojson', data: data as never })
  m.addLayer({
    id: 'p-isi',
    type: 'fill',
    source: 'p',
    paint: {
      'fill-color': WARNA_LAYER[p.layer],
      // Ekspresi aslinya DIKALIKAN, bukan diganti - jadi seluruh logika
      // per-layer (HINDARI yang lebih redup, heksagon tanpa data yang nyaris
      // tak terlihat) ikut apa adanya.
      'fill-opacity': ['*', OPASITAS_LAYER[p.layer], 0.62] as never,
    },
  })
  m.addLayer({
    id: 'p-garis',
    type: 'line',
    source: 'p',
    paint: { 'line-color': GARIS_HEX(p.gaya), 'line-width': 0.55, 'line-opacity': 0.3 },
  })

  if (p.angka) {
    const teks = TEKS_HEX(p.gaya)
    m.addLayer({
      id: 'p-angka',
      type: 'symbol',
      source: 'p',
      minzoom: 11.3,
      layout: {
        'text-field': ANGKA_LAYER[p.layer],
        'text-font': FONT_ANGKA,
        'text-size': ['interpolate', ['linear'], ['zoom'], 11.3, 0, 12.4, 11.5, 14, 14],
        'text-allow-overlap': false,
        'text-padding': 2,
      },
      paint: {
        'text-color': teks.warna,
        'text-halo-color': teks.halo,
        'text-halo-width': 1.4,
      },
    })
  }

  const b = bingkaiDari(data)
  if (b) {
    m.fitBounds(b, {
      padding: Math.round(Math.max(14, Math.min(p.tinggi * 0.13, p.lebar * 0.1, 90))),
      animate: false,
    })
  }

  // `idle` menyala saat tidak ada lagi ubin yang dimuat DAN tidak ada transisi
  // yang berjalan - satu-satunya saat yang menjamin kanvasnya sudah utuh.
  await new Promise<void>((selesai) => m.once('idle', () => selesai()))

  const gambar = m.getCanvas().toDataURL('image/webp', p.mutu)
  m.remove()
  wadah.remove()
  return { gambar, ringkas: ringkasKartu(data, p.layer) }
}
