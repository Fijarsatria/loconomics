/**
 * Bagian wajib 2 dari 3: Insight / Analisis.
 *
 * Menampilkan hasil, tidak pernah menghitung. Setiap angka di sini berasal dari
 * `location_scores` yang diisi `pipeline/s6_score.py`. Kalau suatu saat ada
 * aritmetika skor muncul di berkas ini, itu bug.
 */

import { useEffect, useState } from 'react'

import { LABEL_KUADRAN, WARNA_KEYAKINAN, WARNA_KUADRAN } from '../config'
import { api } from '../lib/api'
import type { BadgeKeyakinan, DetailHeksagon } from '../types'

/**
 * Badge keyakinan (Q01–Q03). Wajib muncul di setiap tempat skor ditampilkan —
 * pengguna berhak tahu sebuah angka lahir dari 40 titik survei atau dari 3.
 */
export function Badge({ badge }: { badge: BadgeKeyakinan }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: WARNA_KEYAKINAN[badge.tingkat] }}
      title={`${badge.n_titik_misi} titik misi · ${
        badge.sumber === 'observed' ? 'hasil survei' : 'hasil imputasi model'
      }`}
    >
      {badge.tingkat}
      <span className="opacity-80">· {badge.n_titik_misi} titik</span>
      {badge.sumber === 'predicted' && <span className="opacity-80">· prediksi</span>}
    </span>
  )
}

function Angka({ label, nilai, satuan }: { label: string; nilai: number | null; satuan?: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-slate-100 py-1.5">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-sm font-medium tabular-nums text-slate-900">
        {nilai === null || nilai === undefined ? (
          // Kosong tetap kosong. "Belum disurvei" bukan "nol".
          <span className="text-slate-400">belum ada data</span>
        ) : (
          `${nilai.toLocaleString('id-ID', { maximumFractionDigits: 2 })}${satuan ?? ''}`
        )}
      </span>
    </div>
  )
}

/** B01–B04 sebagai batang sederhana. Inilah fitur Commuter Clock. */
function CommuterClock({ jam }: { jam: Record<string, number | null> }) {
  const rentang = [
    ['puncak_pagi', 'Pagi', '05–09'],
    ['puncak_siang', 'Siang', '11–14'],
    ['puncak_sore', 'Sore', '16–19'],
    ['puncak_malam', 'Malam', '19–23'],
  ] as const
  const maks = Math.max(...rentang.map(([k]) => jam[k] ?? 0), 0.0001)

  return (
    <div className="space-y-1.5">
      {rentang.map(([kunci, nama, waktu]) => {
        const nilai = jam[kunci]
        return (
          <div key={kunci} className="flex items-center gap-2">
            <span className="w-12 text-xs text-slate-600">{nama}</span>
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-blue-500"
                style={{ width: `${((nilai ?? 0) / maks) * 100}%` }}
              />
            </div>
            <span className="w-10 text-right text-xs tabular-nums text-slate-500">{waktu}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function PanelInsight({ h3 }: { h3: string | null }) {
  const [detail, setDetail] = useState<DetailHeksagon | null>(null)
  const [memuat, setMemuat] = useState(false)
  const [galat, setGalat] = useState<string | null>(null)

  useEffect(() => {
    if (!h3) {
      setDetail(null)
      return
    }
    let batal = false
    setMemuat(true)
    setGalat(null)

    api
      .detailHeksagon(h3)
      .then((d) => !batal && setDetail(d))
      .catch((e: Error) => !batal && setGalat(e.message))
      .finally(() => !batal && setMemuat(false))

    return () => {
      batal = true
    }
  }, [h3])

  if (!h3) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-500">
        Klik salah satu heksagon di peta untuk melihat rincian 41 variabelnya.
      </div>
    )
  }
  if (memuat) return <div className="p-6 text-sm text-slate-500">Memuat…</div>
  if (galat) return <div className="p-6 text-sm text-red-600">Gagal memuat: {galat}</div>
  if (!detail) return null

  const { skor, indeks, faktor, commuter_clock } = detail
  const kuadran = skor.kuadran ?? 'HINDARI'

  return (
    <div className="h-full overflow-y-auto p-4">
      {/* --- Kepala: skor + badge --- */}
      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-mono text-xs text-slate-500">{skor.h3_index}</span>
          <Badge badge={skor.keyakinan} />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums text-slate-900">
            {skor.opportunity_score?.toFixed(1) ?? '—'}
          </span>
          <span className="text-sm text-slate-500">Skor Peluang</span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span
            className="rounded px-2 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: WARNA_KUADRAN[kuadran] }}
          >
            {LABEL_KUADRAN[kuadran]}
          </span>
          <span className="text-xs text-slate-500">
            {skor.kawasan}
            {skor.peringkat !== null && ` · peringkat ${skor.peringkat}`}
          </span>
        </div>

        {/* ZoneGuard. Ditampilkan sebagai peringatan, bukan disembunyikan. */}
        {skor.zona_izin_komersial === false && (
          <p className="mt-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">
            <strong>ZoneGuard:</strong> zona RDTR di sini tidak mengizinkan kegiatan
            usaha. Skor dinolkan berapa pun nilai variabel lainnya.
          </p>
        )}
        {skor.zona_izin_komersial === null && (
          <p className="mt-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Kawasan tanpa RDTR digital — status izin belum bisa dipastikan. Skor
            tetap dihitung, tetapi verifikasi manual tetap diperlukan.
          </p>
        )}
      </div>

      {/* --- Empat indeks komposit --- */}
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Indeks Komposit
      </h3>
      <Angka label="IPT — Potensi Transit" nilai={indeks.ipt} />
      <Angka label="IAE — Aktivitas Ekonomi" nilai={indeks.iae} />
      <Angka label="IKP — Kompetisi (tinggi = buruk)" nilai={indeks.ikp} />
      <Angka label="IBR — Biaya & Risiko (tinggi = buruk)" nilai={indeks.ibr} />

      {/* --- Commuter Clock --- */}
      {Object.keys(commuter_clock).length > 0 && (
        <>
          <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Commuter Clock
          </h3>
          <CommuterClock jam={commuter_clock} />
        </>
      )}

      {/* --- Faktor pembentuk skor. Bahan mentah "kenapa skornya segitu?" --- */}
      {faktor.length > 0 && (
        <>
          <h3 className="mb-1 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Faktor Terbesar
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1 font-normal">Variabel</th>
                <th className="py-1 font-normal">Indeks</th>
                <th className="py-1 text-right font-normal">Persentil</th>
                <th className="py-1 text-right font-normal">Kontribusi</th>
              </tr>
            </thead>
            <tbody>
              {faktor.slice(0, 8).map((f) => (
                <tr key={f.kode_variabel} className="border-b border-slate-100">
                  <td className="py-1 font-mono text-xs">{f.kode_variabel}</td>
                  <td className="py-1 text-xs text-slate-600">{f.indeks}</td>
                  <td className="py-1 text-right tabular-nums text-xs">
                    {f.persentil?.toFixed(0) ?? '—'}
                  </td>
                  <td className="py-1 text-right tabular-nums text-xs">
                    {f.kontribusi?.toFixed(2) ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
