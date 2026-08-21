/**
 * Potongan kecil yang dipakai di banyak tempat.
 *
 * Dua di antaranya menegakkan aturan proyek, bukan sekadar merapikan tampilan:
 *
 *   Badge   — setiap skor wajib membawa tingkat keyakinannya. Komponen ini yang
 *             membuatnya sulit dilupakan: ia diminta oleh tipe di setiap tempat
 *             skor ditampilkan.
 *   Angka   — nilai kosong ditampilkan sebagai "belum ada data", TIDAK PERNAH
 *             sebagai 0. "Nol transaksi tercatat" dan "belum ada yang mensurvei
 *             di sini" adalah dua pernyataan yang sangat berbeda, dan yang kedua
 *             tidak boleh menyamar jadi yang pertama.
 */

import type { ReactNode } from 'react'

import { KEYAKINAN, KUADRAN } from '../config'
import type { BadgeKeyakinan, Kuadran as NamaKuadran } from '../types'

/** Nilai yang belum ada. Selalu terlihat berbeda dari nol. */
export function Kosong({ teks = 'belum ada data' }: { teks?: string }) {
  return <span className="text-ink-3 italic text-[12px]">{teks}</span>
}

export function Angka({
  nilai,
  satuan,
  besar,
}: {
  nilai: string | null
  satuan?: string
  besar?: boolean
}) {
  if (nilai === null) return <Kosong />
  return (
    <span className={besar ? 'papan tabular text-[22px] leading-none' : 'tabular font-medium'}>
      {nilai}
      {satuan && <span className="text-ink-3 font-normal text-[11px] ml-0.5">{satuan}</span>}
    </span>
  )
}

// --- Badge keyakinan (Q01–Q03) ---------------------------------------------

/**
 * Tiga balok, bukan tiga warna.
 *
 * Merah-kuning-hijau akan membuat keyakinan rendah terbaca sebagai kesalahan.
 * Ia bukan kesalahan — ia hanya berarti datanya belum banyak, dan itu keadaan
 * yang normal di kawasan yang belum disurvei. Balok terisi menyampaikan "sedikit
 * atau banyak" tanpa menyampaikan "buruk atau baik".
 *
 * Sumber `predicted` mendapat arsir, mengikuti aturan tekstur = belum tahu.
 */
export function Badge({ badge, ringkas }: { badge: BadgeKeyakinan; ringkas?: boolean }) {
  const k = KEYAKINAN[badge.tingkat]
  const prediksi = badge.sumber === 'predicted'
  const judul = `${k.teks} · ${badge.n_titik_misi} titik misi · ${
    prediksi ? 'nilai hasil imputasi model' : 'hasil survei lapangan'
  }`

  return (
    <span
      title={judul}
      className="inline-flex items-center gap-1.5 rounded-xs border border-line bg-surface-2 px-1.5 py-[3px]"
    >
      <span className="flex items-end gap-[2px]" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`w-[3px] rounded-[1px] ${i < k.balok ? 'bg-ink-2' : 'bg-line-2'}`}
            style={{ height: 4 + i * 3 }}
          />
        ))}
      </span>
      <span className="text-[10px] font-semibold tracking-wide text-ink-2">
        {badge.tingkat}
      </span>
      {!ringkas && (
        <span className="tabular text-[10px] text-ink-3">{badge.n_titik_misi} titik</span>
      )}
      {prediksi && (
        <span
          className="arsir text-ink-3 h-3 w-3 rounded-[2px] border border-line-2"
          title="Nilai ini hasil imputasi model, bukan survei langsung"
          aria-label="hasil imputasi model"
        />
      )}
      <span className="sr-only">{judul}</span>
    </span>
  )
}

// --- Kuadran ---------------------------------------------------------------

export function Glif({ kuadran, ukuran = 12 }: { kuadran: string; ukuran?: number }) {
  const q = KUADRAN[kuadran]
  if (!q) return null
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden className="shrink-0">
      <path
        d={q.glif}
        fill={q.warna ?? 'none'}
        stroke={q.warna ?? 'var(--color-line-2)'}
        strokeWidth={q.warna ? 0 : 1.5}
      />
    </svg>
  )
}

/** Nama kuadran + glifnya. Warna tidak pernah sendirian. */
export function ChipKuadran({ kuadran }: { kuadran: NamaKuadran | null }) {
  if (!kuadran) return <Kosong teks="kuadran belum dihitung" />
  const q = KUADRAN[kuadran]
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-xs px-1.5 py-[3px] text-[11px] font-semibold"
      style={{
        background: q.warna ? q.lembut : 'var(--color-surface-2)',
        color: q.warna ?? 'var(--color-ink-2)',
        boxShadow: q.warna ? 'none' : 'inset 0 0 0 1px var(--color-line)',
      }}
    >
      <Glif kuadran={kuadran} />
      {q.nama}
    </span>
  )
}

// --- Struktur panel --------------------------------------------------------

export function Bagian({
  judul,
  aksi,
  children,
}: {
  judul: string
  aksi?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="border-t border-line px-4 py-3.5 first:border-t-0">
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <h3 className="eyebrow">{judul}</h3>
        {aksi}
      </div>
      {children}
    </section>
  )
}

export function Baris({
  label,
  children,
  bantuan,
}: {
  label: string
  children: ReactNode
  bantuan?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[5px]">
      <span className="text-[12px] text-ink-2" title={bantuan}>
        {label}
      </span>
      <span className="text-right text-[13px]">{children}</span>
    </div>
  )
}

/**
 * Layar kosong adalah ajakan bertindak, bukan pengumuman kegagalan.
 * Selalu menyebut apa yang harus dilakukan berikutnya.
 */
export function Ajakan({
  judul,
  anak,
  aksi,
}: {
  judul: string
  anak: string
  aksi?: ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 py-10 text-center">
      <p className="papan text-[15px] text-ink">{judul}</p>
      <p className="max-w-[26ch] text-[12.5px] leading-relaxed text-ink-3">{anak}</p>
      {aksi}
    </div>
  )
}

export function Memuat({ baris = 3 }: { baris?: number }) {
  return (
    <div className="space-y-2 p-4" aria-live="polite" aria-busy="true">
      <span className="sr-only">Memuat…</span>
      {Array.from({ length: baris }).map((_, i) => (
        <div
          key={i}
          className="h-3 rounded-xs bg-ground-2"
          style={{ width: `${100 - i * 14}%` }}
        />
      ))}
    </div>
  )
}
