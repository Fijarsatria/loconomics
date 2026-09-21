
import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl'

import { ABU_HINDARI, KUADRAN, type NamaGaya, type NamaLayer } from '../config'

/** Warna kuadran untuk kanvas peta - harfiah, bukan var(). Lihat config.ts. */
const q = (k: string) => KUADRAN[k].warnaPeta

// Satelit ikut GELAP: citra kota tropis didominasi atap, pohon, dan aspal yang
// gelap, jadi garis, angka, dan rute harus terang untuk terbaca di atasnya -
// jawaban yang sama dengan basemap gelap, bukan dengan basemap terang.
export const BASEMAP_GELAP: NamaGaya[] = ['gelap', 'satelit']

export const SELUBUNG: Record<NamaGaya, { warna: string; opasitas: number }> = {
  terang: { warna: '#ffffff', opasitas: 0.1 },
  dasar: { warna: '#ffffff', opasitas: 0.15 },
  jalan: { warna: '#ffffff', opasitas: 0.15 },
  gelap: { warna: '#000000', opasitas: 0.3 },
  // Tipis sekali. Orang memilih satelit justru untuk MELIHAT atap dan halaman
  // di bawah heksagonnya; selubung setebal gaya lain akan menghapus alasan itu.
  // Yang tersisa cuma sedikit peredupan supaya warna heksagon tetap menang.
  satelit: { warna: '#000000', opasitas: 0.14 },
}

export const WARNA_GEDUNG: Record<NamaGaya, { warna: string; opasitas: number }> = {
  terang: { warna: '#e3e8e4', opasitas: 0.88 },
  dasar: { warna: '#dcd6cc', opasitas: 0.85 },
  jalan: { warna: '#ddd6ca', opasitas: 0.88 },
  gelap: { warna: '#3a4642', opasitas: 0.9 },
  satelit: { warna: '#ece9e2', opasitas: 0.78 },
}

export const BIDANG_LAYER: Partial<
  Record<NamaLayer, { kunci: string; benda: string; bendaEn: string }>
> = {
  risk_radar: {
    kunci: 'indeks_churn',
    benda: 'data pergantian usaha',
    bendaEn: 'business turnover data',
  },
  pricelens: { kunci: 'harga_sewa_per_m2', benda: 'data harga sewa', bendaEn: 'rent data' },
  zoneguard: {
    kunci: 'zona_izin_komersial',
    benda: 'zonasi RDTR digital',
    bendaEn: 'digital RDTR zoning',
  },
}

export function cakupanLayer(
  layer: NamaLayer,
  fitur: { properties?: Record<string, unknown> | null }[] | null,
): { terisi: number; total: number; benda: string; bendaEn: string } | null {
  const bidang = BIDANG_LAYER[layer]
  if (!bidang || !fitur) return null
  let terisi = 0
  for (const f of fitur) {
    const v = f.properties?.[bidang.kunci]
    if (v !== null && v !== undefined) terisi++
  }
  return { terisi, total: fitur.length, benda: bidang.benda, bendaEn: bidang.bendaEn }
}

/** Garis batas heksagon harus melawan basemap, bukan menyatu dengannya. */
export const GARIS_HEX = (gaya: NamaGaya) =>
  BASEMAP_GELAP.includes(gaya) ? '#eef3f0' : '#16211c'

export const TEKS_HEX = (gaya: NamaGaya) =>
  BASEMAP_GELAP.includes(gaya)
    ? { warna: '#f2f6f4', halo: 'rgba(12,18,15,0.85)' }
    : { warna: '#16211c', halo: 'rgba(255,255,255,0.9)' }

export const WARNA_FOKUS = (gaya: NamaGaya) =>
  BASEMAP_GELAP.includes(gaya)
    ? { garis: '#f2f6f4', isi: '#f2f6f4', teks: '#12211f', halo: 'rgba(12,18,15,0.9)' }
    : { garis: '#16211c', isi: '#16211c', teks: '#ffffff', halo: 'rgba(255,255,255,0.92)' }

export const WARNA_RUTE = ['#2DE8C0', '#3B82F6', '#F59E0B', '#EF4444'] as const

export const WARNA_RUTE_TUNGGAL = (gaya: NamaGaya) =>
  BASEMAP_GELAP.includes(gaya) ? '#2DE8C0' : '#0EA88C'

export const WARNA_RUTE_ALT = (gaya: NamaGaya) =>
  BASEMAP_GELAP.includes(gaya) ? 'rgba(233,168,255,0.55)' : 'rgba(147,51,234,0.5)'

export const WARNA_ISO = (gaya: NamaGaya) =>
  BASEMAP_GELAP.includes(gaya) ? '#93c5fd' : '#1d4ed8'

/** Garis putih/gelap di BAWAH rute, supaya ia terbaca di atas isian apa pun. */
export const WARNA_RUTE_BAYANG = (gaya: NamaGaya) =>
  BASEMAP_GELAP.includes(gaya) ? 'rgba(8,14,12,0.85)' : 'rgba(255,255,255,0.92)'

/** Font yang PASTI ada di gaya MAPID - diverifikasi ke style.json-nya. */
export const FONT_ANGKA = ['Metropolis Regular', 'Noto Sans Regular']

export const ANGKA_LAYER: Record<NamaLayer, ExpressionSpecification> = {
  opportunity: [
    'case',
    ['==', ['get', 'opportunity_score'], null], '',
    ['to-string', ['round', ['get', 'opportunity_score']]],
  ] as unknown as ExpressionSpecification,
  // Indeks churn dua desimal - satuannya 0..1, jadi membulatkannya ke bilangan
  // bulat akan menghasilkan "0" untuk hampir semua heksagon.
  risk_radar: [
    'case',
    ['==', ['get', 'indeks_churn'], null], '',
    ['to-string', ['/', ['round', ['*', ['get', 'indeks_churn'], 100]], 100]],
  ] as unknown as ExpressionSpecification,
  // Skor gem 0..1 dinaikkan ke 0..100 supaya sebaris dengan skor lain di layar.
  hidden_gem: [
    'case',
    ['==', ['get', 'hidden_gem_score'], null], '',
    ['to-string', ['round', ['*', ['get', 'hidden_gem_score'], 100]]],
  ] as unknown as ExpressionSpecification,
  // Ribuan rupiah. "168" jauh lebih terbaca di dalam heksagon daripada "168429".
  pricelens: [
    'case',
    ['==', ['get', 'harga_sewa_per_m2'], null], '',
    ['concat', ['to-string', ['round', ['/', ['get', 'harga_sewa_per_m2'], 1000]]], 'rb'],
  ] as unknown as ExpressionSpecification,
  // Zonasi bukan angka. Tiga keadaan, tiga tanda - dan yang ketiga WAJIB
  // berbeda dari keduanya: null berarti belum ada RDTR digital, bukan larangan.
  zoneguard: [
    'case',
    ['==', ['get', 'zona_izin_komersial'], true], '✓',
    ['==', ['get', 'zona_izin_komersial'], false], '✕',
    '?',
  ] as unknown as ExpressionSpecification,
}



export const CHURN_STOP = [
  { nilai: 0.1, warna: '#dcece4', label: 'jarang berganti' },
  { nilai: 0.35, warna: KUADRAN.JEBAKAN_GENGSI.warnaPeta, label: 'mulai sering' },
  { nilai: 0.6, warna: KUADRAN.HINDARI.warnaPeta, label: 'sering berganti' },
] as const

/** Warna isian per layer tematik. Satu tempat, lima aturan. */
export const WARNA_LAYER: Record<NamaLayer, ExpressionSpecification> = {
  // Kuadran, bukan gradasi skor. Empat kategori terbaca sekilas; gradasi 0–100
  // menuntut mata membandingkan dua warna serupa untuk tahu mana yang lebih baik.
  opportunity: [
    'match',
    ['get', 'kuadran'],
    'HIDDEN_GEM', q('HIDDEN_GEM'),
    'PEMENANG_JELAS', q('PEMENANG_JELAS'),
    'JEBAKAN_GENGSI', q('JEBAKAN_GENGSI'),
    // HINDARI kini merah, bukan abu-abu. Yang tanpa kuadran sama sekali - baris
    // yang belum diskor - tetap abu-abu, dan bedanya penting: "sudah dihitung,
    // hasilnya jelek" tidak boleh terlihat sama dengan "belum dihitung".
    'HINDARI', q('HINDARI'),
    ABU_HINDARI,
  ],

  hidden_gem: [
    'case',
    ['==', ['get', 'hidden_gem_score'], null], ABU_HINDARI,
    ['interpolate', ['linear'], ['get', 'hidden_gem_score'], 0, KUADRAN.HIDDEN_GEM.lembutPeta, 1, q('HIDDEN_GEM')],
  ],

  risk_radar: [
    'case',
    ['==', ['get', 'indeks_churn'], null], ABU_HINDARI,
    [
      'interpolate', ['linear'], ['get', 'indeks_churn'],
      ...CHURN_STOP.flatMap((s) => [s.nilai, s.warna]),
    ],
  ] as unknown as ExpressionSpecification,

  // Sekuensial satu rona: murah terang, mahal gelap. Tanpa data tetap abu —
  // "sewanya murah" dan "belum ada yang mensurvei" tidak boleh sewarna.
  pricelens: [
    'case',
    ['==', ['get', 'harga_sewa_per_m2'], null], ABU_HINDARI,
    [
      'interpolate', ['linear'], ['get', 'harga_sewa_per_m2'],
      50_000, '#e4ece9',
      150_000, '#7ea79c',
      400_000, '#2c4f45',
    ],
  ],

  zoneguard: [
    'case',
    ['==', ['get', 'zona_izin_komersial'], true], '#1f9d5f',
    ['==', ['get', 'zona_izin_komersial'], false], '#c81e1e',
    ABU_HINDARI,
  ],
}

export const OPASITAS_LAYER: Record<NamaLayer, number | ExpressionSpecification> = {
  opportunity: ['case', ['==', ['get', 'kuadran'], 'HINDARI'], 0.11, 0.19],
  hidden_gem: ['case', ['==', ['get', 'hidden_gem_score'], null], 0.05, 0.21],
  risk_radar: ['case', ['==', ['get', 'indeks_churn'], null], 0.05, 0.2],
  pricelens: ['case', ['==', ['get', 'harga_sewa_per_m2'], null], 0.05, 0.21],
  // ZoneGuard turun paling sedikit. Ia satu-satunya layer yang menyatakan
  // LARANGAN, dan larangan yang nyaris tidak terlihat berhenti jadi larangan.
  zoneguard: 0.23,
}

export const TEBAL_GARIS = 1.7
export const OPASITAS_GARIS = 0.9

export function idLabelPertama(m: MapLibreMap): string | undefined {
  const layers = m.getStyle().layers ?? []
  let terakhirBukanSymbol = -1
  layers.forEach((l, i) => {
    if (l.type !== 'symbol' && l.type !== 'background') terakhirBukanSymbol = i
  })
  return layers[terakhirBukanSymbol + 1]?.id
}


const STOP_BLOK: [number, string][] = [
  [0, '#eef3f1'],
  [40, '#a8cfc3'],
  [65, '#55b096'],
  [85, '#137c65'],
  [100, '#0a5b4a'],
]

export const WARNA_BLOK: ExpressionSpecification = [
  'case',
  ['==', ['get', 'dilarang'], true], KUADRAN.HINDARI.warnaPeta,
  ['==', ['get', 'skor'], null], ABU_HINDARI,
  ['interpolate', ['linear'], ['get', 'skor'], ...STOP_BLOK.flat()] as ExpressionSpecification,
]

export function warnaSkorBlok(skor: number | null, dilarang: boolean): string {
  if (dilarang) return KUADRAN.HINDARI.warnaPeta
  if (skor == null) return ABU_HINDARI
  const s = Math.max(0, Math.min(100, skor))
  for (let i = 1; i < STOP_BLOK.length; i++) {
    const [s1, w1] = STOP_BLOK[i]
    const [s0, w0] = STOP_BLOK[i - 1]
    if (s <= s1) {
      const f = (s - s0) / (s1 - s0)
      const hex = (w: string, k: number) => parseInt(w.slice(1 + k * 2, 3 + k * 2), 16)
      const c = [0, 1, 2].map((k) => Math.round(hex(w0, k) + (hex(w1, k) - hex(w0, k)) * f))
      return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
    }
  }
  return STOP_BLOK[STOP_BLOK.length - 1][1]
}

export const WARNA_GARIS_BLOK = (gaya: NamaGaya) =>
  BASEMAP_GELAP.includes(gaya) ? 'rgba(238,243,240,0.55)' : 'rgba(22,33,28,0.5)'
