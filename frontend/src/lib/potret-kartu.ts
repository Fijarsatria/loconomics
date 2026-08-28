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
    return { n: f.length, kuadran, sorotan: { nilai: String(boleh), label: 'heksagon boleh usaha' } }
  }
  const m = median(kolom('opportunity_score'))
  return {
    n: f.length,
    kuadran,
    sorotan:
      m === null ? kosong('skor') : { nilai: String(Math.round(m)), label: 'skor peluang median' },
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
