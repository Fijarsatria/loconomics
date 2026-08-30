/**
 * PriceLens — satu nilai terhadap rentang wajar kawasannya.
 *
 * Bentuknya sengaja bukan batang biasa. Pertanyaan yang dijawab bukan "berapa
 * harganya" melainkan "mahal atau murah", dan pertanyaan kedua tidak bisa
 * dijawab angka tunggal tanpa pembanding. Rp 180.000 per m² tidak berarti apa-apa
 * sampai Anda tahu tetangganya berapa.
 *
 * Jadi yang digambar adalah rentangnya lebih dulu — pita persentil 25–75 kawasan
 * — lalu posisi heksagon ini di dalam atau di luar pita itu. Kuartil, bukan
 * simpangan baku, karena sebaran harga sewa berekor panjang: beberapa ruko premium
 * menggeser rata-rata tetapi tidak menggeser kuartil.
 *
 * Perbandingan selalu terhadap kawasan sendiri. Rp 200.000 per m² di Dukuh Atas
 * murah; di Harjamukti mahal.
 */

import type { PosisiHarga, RentangWajar } from '../types'
import { Kosong } from './primitif'

const LABEL: Record<PosisiHarga, string> = {
  MURAH: 'Di bawah rentang wajar',
  WAJAR: 'Di dalam rentang wajar',
  MAHAL: 'Di atas rentang wajar',
  TIDAK_DIKETAHUI: 'Belum bisa dibandingkan',
}

export default function BarHarga({
  nilai,
  wajar,
  posisi,
  selisih,
  format,
  kawasan,
}: {
  nilai: number | null
  wajar: RentangWajar
  posisi: PosisiHarga
  selisih: number | null
  format: (n: number | null) => string | null
  kawasan: string
}) {
  if (wajar.p25 === null || wajar.p75 === null || wajar.p50 === null) {
    return (
      <Kosong teks={`Rentang wajar ${kawasan} belum bisa dihitung — data harganya masih terlalu sedikit`} />
    )
  }

  // Skala diperluas 35% di kedua sisi supaya nilai di luar pita punya ruang
  // untuk terlihat berada di luar, bukan menempel di tepi.
  const lebar = wajar.p75 - wajar.p25 || wajar.p50 || 1
  const min = wajar.p25 - lebar * 0.35
  const maks = wajar.p75 + lebar * 0.35
  const pos = (n: number) => Math.min(100, Math.max(0, ((n - min) / (maks - min)) * 100))

  const luar = posisi === 'MURAH' || posisi === 'MAHAL'

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="papan tabular text-[24px] leading-none">
          {format(nilai) ?? <Kosong />}
        </span>
        {nilai !== null && (
          <span
            className={`text-[13px] font-semibold ${luar ? 'text-jebakan' : 'text-ink-2'}`}
          >
            {LABEL[posisi]}
          </span>
        )}
      </div>

      <div className="relative h-8">
        {/* Sumbu tipis sepanjang skala */}
        <span className="absolute inset-x-0 top-3.5 h-px bg-line-2" />

        {/* Pita wajar: p25–p75 */}
        <span
          className="absolute top-1.5 h-5 rounded-xs bg-ground-2"
          style={{ left: `${pos(wajar.p25)}%`, width: `${pos(wajar.p75) - pos(wajar.p25)}%` }}
          title={`Rentang wajar ${kawasan}: ${format(wajar.p25)} – ${format(wajar.p75)}`}
        />

        {/* Median kawasan */}
        <span
          className="absolute top-1 h-6 w-px bg-ink-3"
          style={{ left: `${pos(wajar.p50)}%` }}
          title={`Median ${kawasan}: ${format(wajar.p50)}`}
        />

        {/* Nilai heksagon ini. Cincin permukaan supaya tetap terbaca saat
            kebetulan jatuh persis di atas garis median. */}
        {nilai !== null && (
          <span
            className="absolute top-[3px] h-[26px] w-[3px] rounded-full bg-ink"
            style={{
              left: `${pos(nilai)}%`,
              boxShadow: '0 0 0 2px var(--color-surface)',
            }}
            title={`Heksagon ini: ${format(nilai)}`}
          />
        )}
      </div>

      <div className="flex justify-between text-[12px] text-ink-3">
        <span className="tabular">{format(wajar.p25)}</span>
        <span>
          rentang wajar {kawasan}
          <span className="tabular text-ink-3/70"> · {wajar.n_sampel} heksagon</span>
        </span>
        <span className="tabular">{format(wajar.p75)}</span>
      </div>

      {selisih !== null && (
        <p className="mt-1.5 text-[13.5px] leading-snug text-ink-2">
          {selisih === 0 ? (
            'Persis di median kawasan.'
          ) : (
            <>
              <span className="tabular font-semibold">
                {Math.abs(selisih).toLocaleString('id-ID', { maximumFractionDigits: 0 })}%
              </span>{' '}
              {selisih > 0 ? 'lebih mahal' : 'lebih murah'} daripada harga tengah di {kawasan}.
            </>
          )}
        </p>
      )}
    </div>
  )
}
