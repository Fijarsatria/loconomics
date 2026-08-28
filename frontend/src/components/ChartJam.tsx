/**
 * Commuter Clock — pola transaksi per jam, 05:00–22:00.
 *
 * Namanya "clock", dan godaan untuk menggambarnya sebagai dial melingkar besar.
 * Bentuk itu ditolak: pekerjaan datanya adalah membandingkan besaran antarjam,
 * dan mata jauh lebih buruk membandingkan panjang busur daripada tinggi batang.
 * Nama fitur boleh puitis; bentuknya harus jujur.
 *
 * Captive dan choice rider adalah dua bagian dari SATU besaran yang sama —
 * jumlah transaksi pada jam itu. Jadi encoding yang benar bukan dua warna
 * kategorikal melainkan dua langkah dari satu rona: gelap dan terang. Memberi
 * keduanya warna berbeda akan menyiratkan dua hal yang tidak berhubungan.
 *
 * Jam yang angkanya berasal dari proksi diberi arsir, mengikuti aturan
 * tekstur = kami belum tahu.
 */

import { useState } from 'react'

import { JAM_MULAI, JAM_SELESAI } from '../config'
import type { TitikJam } from '../types'
import { Kosong } from './primitif'

const TINGGI = 96
const CELAH = 2 // celah permukaan antarsegmen, sesuai spesifikasi mark

export default function ChartJam({
  jam,
  jamPuncak,
}: {
  jam: TitikJam[]
  jamPuncak: number | null
}) {
  const [aktif, setAktif] = useState<number | null>(null)

  const maks = Math.max(...jam.map((t) => t.n_transaksi), 1)
  const adaIsi = jam.some((t) => t.n_transaksi > 0)
  if (!adaIsi) return <Kosong teks="Belum ada struk berjam untuk heksagon ini" />

  const sorot = aktif !== null ? jam.find((t) => t.jam === aktif) : null

  return (
    <div>
      {/* Keterangan selalu ada untuk dua seri, dan tidak pernah warna saja —
          ada label langsung di sebelah setiap contoh warnanya. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-jam-kuat" />
          Captive — tak punya pilihan lain
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-jam-lemah" />
          Choice — punya kendaraan, memilih transit
        </span>
      </div>

      <div
        className="relative flex items-end gap-[3px]"
        style={{ height: TINGGI }}
        onMouseLeave={() => setAktif(null)}
        role="img"
        aria-label={`Pola transaksi per jam ${JAM_MULAI} sampai ${JAM_SELESAI}. Jam tersibuk ${
          jamPuncak ?? 'belum diketahui'
        }.`}
      >
        {jam.map((t) => {
          const total = (t.n_transaksi / maks) * TINGGI
          const captive = t.pangsa_captive ?? 0
          const tinggiCaptive = Math.max(0, total * captive - CELAH / 2)
          const tinggiChoice = Math.max(0, total * (1 - captive) - CELAH / 2)
          const puncak = t.jam === jamPuncak
          const proxy = t.metode === 'proxy'

          return (
            <button
              key={t.jam}
              onFocus={() => setAktif(t.jam)}
              onBlur={() => setAktif(null)}
              onMouseEnter={() => setAktif(t.jam)}
              className="group relative flex-1 cursor-pointer"
              style={{ height: TINGGI }}
              aria-label={`Pukul ${t.jam}:00, ${t.n_transaksi} transaksi, ${Math.round(
                captive * 100,
              )} persen captive`}
            >
              {/* Alur latar supaya jam kosong tetap punya tempat yang terlihat.
                  Jam tanpa transaksi adalah informasi, bukan ketiadaan. */}
              <span className="absolute inset-x-0 bottom-0 top-0 rounded-t-[2px] bg-ground-2/45 transition-colors group-hover:bg-ground-2" />

              <span className="absolute inset-x-0 bottom-0 flex flex-col-reverse">
                {tinggiChoice > 0 && (
                  <span
                    className={`w-full rounded-t-[3px] bg-jam-lemah ${proxy ? 'arsir text-ink' : ''}`}
                    style={{ height: tinggiChoice, marginBottom: CELAH }}
                  />
                )}
                {tinggiCaptive > 0 && (
                  <span
                    className={`w-full rounded-t-[3px] bg-jam-kuat ${proxy ? 'arsir text-surface' : ''}`}
                    style={{ height: tinggiCaptive }}
                  />
                )}
              </span>

              {puncak && (
                <span
                  className="absolute inset-x-0 -top-0.5 mx-auto h-1 w-1 rounded-full bg-ink"
                  aria-hidden
                />
              )}
            </button>
          )
        })}

        {sorot && (
          <div className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-sm bg-ink px-2 py-1 text-[12.5px] text-surface shadow-lg">
            <span className="tabular font-semibold">{String(sorot.jam).padStart(2, '0')}:00</span>
            {' · '}
            <span className="tabular">{sorot.n_transaksi} transaksi</span>
            {sorot.pangsa_captive !== null && (
              <>
                {' · '}
                <span className="tabular">
                  {Math.round(sorot.pangsa_captive * 100)}% captive
                </span>
              </>
            )}
            {sorot.metode === 'proxy' && (
              <span className="text-surface/70"> · estimasi</span>
            )}
          </div>
        )}
      </div>

      {/* Sumbu: hanya jam yang menjadi penanda, bukan kedelapan belasnya.
          Label di setiap batang akan berubah jadi pagar yang tidak terbaca. */}
      <div className="mt-1 flex text-[11.5px] text-ink-3">
        {jam.map((t) => (
          <span key={t.jam} className="tabular flex-1 text-center">
            {[5, 8, 11, 14, 17, 20, 22].includes(t.jam) ? String(t.jam).padStart(2, '0') : ''}
          </span>
        ))}
      </div>
    </div>
  )
}
