/**
 * Satu-satunya tempat frontend memanggil backend.
 *
 * Komponen tidak boleh memanggil `fetch` sendiri. Kalau nanti perlu retry,
 * pembatalan, atau header autentikasi, tempatnya hanya satu.
 */

import { API_BASE } from '../config'
import type {
  CommuterClock,
  DetailHeksagon,
  DiagramKuadran,
  HiddenGem,
  JawabanAI,
  PeringatanRisiko,
  PermintaanAI,
  PriceLensHeksagon,
  SimpulTransit,
  SkorHeksagon,
  StatusAI,
  StatusZoneGuard,
  TitikKuadran,
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

  /** Commuter Clock — 18 titik jam, captive vs choice rider. */
  commuterClock: (h3: string) => ambil<CommuterClock>(`/hex/${h3}/commuter-clock`),

  // --- PriceLens ---
  layerHarga: (p: { kawasan?: string; maks_sewa_per_m2?: number; hanya_berdata?: boolean } = {}) =>
    ambil<GeoJSON>(`/pricelens/layer${kueri(p)}`),

  kartuHarga: (h3: string) => ambil<PriceLensHeksagon>(`/pricelens/${h3}`),

  /** Rentang wajar + cakupan data tiap kawasan. Cakupan rendah wajib ditampilkan. */
  ringkasanHarga: () => ambil<Record<string, unknown>[]>('/pricelens/ringkasan'),

  // --- Transit ---
  simpulTransit: (kawasan?: string) =>
    ambil<SimpulTransit[]>(`/transit/nodes${kueri({ kawasan })}`),

  catchment: (p: { node_id?: number; menit?: number } = {}) =>
    ambil<GeoJSON>(`/transit/catchment${kueri(p)}`),

  // --- Skor ---
  ranking: (p: { kawasan?: string; limit?: number; versi?: string } = {}) =>
    ambil<SkorHeksagon[]>(`/skor/ranking${kueri(p)}`),

  /** GemFinder — lolos minimal dua metode, lengkap dengan rangkuman alasannya. */
  hiddenGems: (p: { kawasan?: string; limit?: number; versi?: string } = {}) =>
    ambil<HiddenGem[]>(`/skor/hidden-gems${kueri(p)}`),

  /** RiskRadar — Jebakan Gengsi yang churn-nya melewati ambang wajar kawasan. */
  riskRadar: (p: {
    kawasan?: string
    hanya_berperingatan?: boolean
    limit?: number
    versi?: string
  } = {}) => ambil<TitikKuadran[]>(`/skor/risk-radar${kueri(p)}`),

  /** Titik sebar diagram kuadran. TIDAK menyaring ZoneGuard — ini alat analisis. */
  diagramKuadran: (p: { kawasan?: string; limit?: number; versi?: string } = {}) =>
    ambil<DiagramKuadran>(`/skor/kuadran${kueri(p)}`),

  risikoHeksagon: (h3: string) => ambil<PeringatanRisiko>(`/skor/risiko/${h3}`),

  // --- ZoneGuard ---
  statusZona: (h3: string) => ambil<StatusZoneGuard>(`/skor/zoneguard/${h3}`),

  /** Cakupan RDTR per kawasan. Angka `tidak_diketahui` besar adalah kabar penting. */
  cakupanZona: () => ambil<Record<string, unknown>[]>('/skor/zoneguard/ringkasan'),

  // --- AI Consultant ---
  daftarFungsi: () => ambil<Record<string, unknown>>('/ai/fungsi'),

  /** Dipanggil saat memuat, supaya panel AI bisa menampilkan keadaan sebenarnya. */
  statusAI: () => ambil<StatusAI>('/ai/status'),

  tanyaAI: (permintaan: PermintaanAI) =>
    ambil<JawabanAI>('/ai/tanya', { method: 'POST', body: JSON.stringify(permintaan) }),
}
