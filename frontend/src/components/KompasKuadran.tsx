/**
 * Kompas Kuadran — objek tanda tangan antarmuka ini.
 *
 * Ia merangkap tiga pekerjaan yang biasanya dipecah jadi tiga komponen terpisah:
 *
 *   1. LEGENDA  — empat sel, empat warna, empat glif
 *   2. FILTER   — klik satu sel, peta menyaring ke kuadran itu
 *   3. POSISI   — heksagon terpilih muncul sebagai titik pada koordinat aslinya
 *
 * Menggabungkannya bukan penghematan tempat. Kuadran ADALAH tesis produk ini:
 * sumbu datar "bagaimana lokasi terlihat", sumbu tegak "apa kata datanya", dan
 * seluruh gunanya produk ini terletak pada dua sudut tempat keduanya tidak
 * sejalan. Legenda yang terpisah dari peta menjadikan tesis itu keterangan kaki;
 * disatukan, ia jadi alat.
 *
 * Komponen yang sama dipakai pada dua ukuran. Kecil, melayang di atas peta.
 * Besar, ia menjadi diagram sebar RiskRadar dengan seluruh heksagon sebagai
 * titik — sumbu yang sama, warna yang sama, glif yang sama. Pengguna yang sudah
 * paham yang kecil tidak perlu belajar ulang yang besar.
 */

import { KUADRAN, URUTAN_KUADRAN } from '../config'
import type { Kuadran as NamaKuadran, TitikKuadran } from '../types'
import { Glif } from './primitif'

interface Props {
  /** Kuadran yang sedang disaring. null = tidak ada filter. */
  saring: NamaKuadran | null
  onSaring: (k: NamaKuadran | null) => void
  /** Heksagon terpilih, digambar sebagai titik pada posisi aslinya. */
  posisi?: { x: number | null; y: number | null; kuadran: NamaKuadran | null } | null
  /** Seluruh titik. Kalau ada, kompas berubah jadi diagram sebar penuh. */
  sebar?: TitikKuadran[]
  batas?: { x: number | null; y: number | null }
  onPilih?: (h3: string) => void
  besar?: boolean
  /** Tombol pembuka diagram penuh, ditaruh DI DALAM kartu. Sebagai elemen
      melayang terpisah ia menabrak kartunya sendiri di layar sempit. */
  onBukaPenuh?: () => void
}

const SEL: Record<string, { kolom: 0 | 1; baris: 0 | 1 }> = Object.fromEntries(
  Object.values(KUADRAN).map((q) => [q.kunci, { kolom: q.sel[0], baris: q.sel[1] }]),
)

export default function KompasKuadran({
  saring,
  onSaring,
  posisi,
  sebar,
  batas,
  onPilih,
  besar,
  onBukaPenuh,
}: Props) {
  const sisi = besar ? 400 : 168

  return (
    <div
      className={
        besar
          ? 'rounded-md border border-line bg-surface p-4'
          : 'rounded-md border border-line bg-surface/95 p-2.5 shadow-[0_2px_10px_rgb(22_33_28/0.10)] backdrop-blur-sm'
      }
    >
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="eyebrow">Kompas Kuadran</h3>
        {saring && (
          <button
            onClick={() => onSaring(null)}
            className="cursor-pointer text-[10px] font-semibold text-ink-2 underline decoration-line-2 underline-offset-2 transition-colors hover:text-ink"
          >
            Tampilkan semua
          </button>
        )}
      </div>

      <div className="flex items-stretch gap-1.5">
        {/* Sumbu tegak. Ditulis vertikal karena mendampingi sumbu yang vertikal —
            bukan demi gaya. */}
        <span className="eyebrow shrink-0 self-center [writing-mode:vertical-rl] rotate-180 tracking-[0.14em]">
          Skor peluang
        </span>

        <div className="min-w-0 shrink-0" style={{ width: sisi }}>
          <div
            className="relative grid w-full grid-cols-2 grid-rows-2 overflow-hidden rounded-sm border border-line-2"
            style={{ width: sisi, height: sisi }}
          >
            {URUTAN_KUADRAN.map((kunci) => {
              const q = KUADRAN[kunci]
              const aktif = saring === kunci
              const redup = saring !== null && !aktif
              const sel = SEL[kunci]

              return (
                <button
                  key={kunci}
                  onClick={() => onSaring(aktif ? null : (kunci as NamaKuadran))}
                  aria-pressed={aktif}
                  title={q.arti}
                  className="group relative cursor-pointer text-left transition-opacity duration-200"
                  style={{
                    gridColumn: sel.kolom + 1,
                    gridRow: sel.baris + 1,
                    background: aktif ? q.lembut : 'transparent',
                    opacity: redup ? 0.38 : 1,
                    // Garis dalam digambar dari posisi grid, bukan dari urutan
                    // nth-child. Urutan bisa berubah tanpa disadari; posisinya tidak.
                    borderRight: sel.kolom === 0 ? '1px solid var(--color-line-2)' : undefined,
                    borderBottom: sel.baris === 0 ? '1px solid var(--color-line-2)' : undefined,
                  }}
                >
                  <span
                    className={`absolute inset-0 transition-colors ${
                      aktif ? '' : 'group-hover:bg-surface-2'
                    }`}
                  />
                  <span
                    className={`relative flex h-full flex-col ${besar ? 'gap-1 p-3' : 'gap-0.5 p-2'}`}
                  >
                    <Glif kuadran={kunci} ukuran={besar ? 16 : 12} />
                    <span
                      className={`font-semibold leading-[1.15] ${besar ? 'text-[11px]' : 'text-[10px]'}`}
                      style={{ color: q.warna ?? 'var(--color-ink-3)' }}
                    >
                      {q.nama}
                    </span>

                  </span>
                </button>
              )
            })}

            {/* Titik sebar — hanya pada mode besar */}
            {besar &&
              sebar?.map((t) =>
                t.x_prestise === null || t.y_peluang === null ? null : (
                  <button
                    key={t.h3_index}
                    onClick={() => onPilih?.(t.h3_index)}
                    title={`${t.h3_index} · peluang ${t.y_peluang?.toFixed(1)} · risiko ${t.risiko}`}
                    className="absolute -translate-x-1/2 translate-y-1/2 cursor-pointer rounded-full transition-transform hover:scale-150"
                    style={{
                      // Dijepit 3-97%: titik berskor 0 atau 100 tepat di tepi
                      // akan tergunting separuh oleh overflow-hidden, dan justru
                      // titik-titik ekstrem itu yang paling ingin dilihat.
                      left: `${3 + t.x_prestise * 94}%`,
                      bottom: `${3 + (t.y_peluang / 100) * 94}%`,
                      width: 7,
                      height: 7,
                      // Cincin permukaan 2px supaya titik yang bertumpuk tetap
                      // bisa dihitung, bukan meleleh jadi satu gumpalan.
                      background: t.kuadran ? (KUADRAN[t.kuadran].warna ?? 'var(--color-line-2)') : 'var(--color-line-2)',
                      boxShadow: '0 0 0 1.5px var(--color-surface)',
                      opacity: t.risiko === 'AMAN' ? 0.75 : 1,
                    }}
                  >
                    <span className="sr-only">{t.h3_index}</span>
                  </button>
                ),
              )}

            {/* Garis pemisah — median kedua sumbu, sama seperti yang dipakai pipeline */}
            {besar && batas?.x != null && (
              <span
                className="pointer-events-none absolute inset-y-0 w-px bg-ink-3/25"
                style={{ left: `${3 + batas.x * 94}%` }}
              />
            )}

            {/* Posisi heksagon terpilih */}
            {!besar && posisi?.x != null && posisi.y != null && (
              <span
                className="pointer-events-none absolute z-10 -translate-x-1/2 translate-y-1/2 rounded-full transition-[left,bottom] duration-300 ease-out"
                style={{
                  left: `${3 + posisi.x * 94}%`,
                  bottom: `${3 + (posisi.y / 100) * 94}%`,
                  width: 9,
                  height: 9,
                  background: posisi.kuadran
                    ? (KUADRAN[posisi.kuadran].warna ?? 'var(--color-ink)')
                    : 'var(--color-ink)',
                  boxShadow: '0 0 0 2px var(--color-surface), 0 0 0 3.5px var(--color-ink)',
                }}
                aria-hidden
              />
            )}
          </div>

          {/* Sumbu datar */}
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-[9px] text-ink-3">biasa</span>
            <span className="eyebrow tracking-[0.12em]">Prestise visual</span>
            <span className="text-[9px] text-ink-3">mahal</span>
          </div>
        </div>
      </div>

      {besar && (
        <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3">
          {URUTAN_KUADRAN.map((kunci) => {
            const q = KUADRAN[kunci]
            return (
              <li key={kunci} className="flex gap-2">
                <span className="mt-[3px] shrink-0">
                  <Glif kuadran={kunci} ukuran={11} />
                </span>
                <span className="text-[10.5px] leading-snug">
                  <span
                    className="font-semibold"
                    style={{ color: q.warna ?? 'var(--color-ink-2)' }}
                  >
                    {q.nama}
                  </span>
                  <span className="block text-ink-3">{q.arti}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {!besar && (
        <div className="mt-2 border-t border-line pt-2">
          {posisi?.x == null && (
            <p className="mb-1.5 text-[10px] leading-snug text-ink-3">
              Klik satu kuadran untuk menyaring peta.
            </p>
          )}
          {onBukaPenuh && (
            <button
              onClick={onBukaPenuh}
              className="cursor-pointer text-[10.5px] font-semibold text-ink-2 underline decoration-line-2 underline-offset-2 transition-colors hover:text-ink"
            >
              Buka diagram penuh
            </button>
          )}
        </div>
      )}
    </div>
  )
}
