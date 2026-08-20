/**
 * Satu-satunya tempat frontend memanggil backend.
 *
 * Komponen tidak boleh memanggil `fetch` sendiri. Kalau nanti perlu retry,
 * pembatalan, atau header autentikasi, tempatnya hanya satu.
 */

import { API_BASE } from '../config'
import type {
  DetailHeksagon,
  JawabanAI,
  PermintaanAI,
  SimpulTransit,
  SkorHeksagon,
} from '../types'

type GeoJSON = { type: 'FeatureCollection'; features: unknown[] }

async function ambil<T>(jalur: string, opsi?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${jalur}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opsi,
  })
  if (!res.ok) {
    // Pesan backend jauh lebih berguna daripada "500 Internal Server Error".
    const pesan = await res.text().catch(() => '')
    throw new Error(`${res.status} ${jalur}${pesan ? ` — ${pesan}` : ''}`)
  }
  return res.json() as Promise<T>
}

const kueri = (params: Record<string, string | number | boolean | undefined>) => {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v))
  const s = q.toString()
  return s ? `?${s}` : ''
}

export const api = {
  sehat: () => ambil<{ status: string }>('/health'),

  // --- Heksagon ---
  layerHeksagon: (p: { kawasan?: string; min_score?: number; versi?: string } = {}) =>
    ambil<GeoJSON>(`/hex/layer${kueri(p)}`),

  detailHeksagon: (h3: string, versi?: string) =>
    ambil<DetailHeksagon>(`/hex/${h3}${kueri({ versi })}`),

  // --- Transit ---
  simpulTransit: (kawasan?: string) =>
    ambil<SimpulTransit[]>(`/transit/nodes${kueri({ kawasan })}`),

  catchment: (p: { node_id?: number; menit?: number } = {}) =>
    ambil<GeoJSON>(`/transit/catchment${kueri(p)}`),

  // --- Skor ---
  ranking: (p: { kawasan?: string; limit?: number; versi?: string } = {}) =>
    ambil<SkorHeksagon[]>(`/skor/ranking${kueri(p)}`),

  /** GemFinder — lokasi yang lolos minimal dua metode deteksi hidden gem. */
  hiddenGems: (p: { kawasan?: string; limit?: number; versi?: string } = {}) =>
    ambil<SkorHeksagon[]>(`/skor/hidden-gems${kueri(p)}`),

  /** RiskRadar — kuadran Jebakan Gengsi: terlihat mahal, ekonominya tidak mendukung. */
  riskRadar: (p: { kawasan?: string; limit?: number; versi?: string } = {}) =>
    ambil<SkorHeksagon[]>(`/skor/risk-radar${kueri(p)}`),

  // --- AI Consultant ---
  daftarFungsi: () => ambil<Record<string, unknown>>('/ai/fungsi'),

  tanyaAI: (permintaan: PermintaanAI) =>
    ambil<JawabanAI>('/ai/tanya', { method: 'POST', body: JSON.stringify(permintaan) }),
}
