/**
 * Bagian wajib 2 dari 3: Insight / Analisis.
 *
 * Menampilkan hasil, tidak pernah menghitung. Setiap angka di sini berasal dari
 * `location_scores` yang diisi `pipeline/s6_score.py`. Kalau suatu saat ada
 * aritmetika skor muncul di berkas ini, itu bug.
 *
 * Urutan bagiannya mengikuti urutan pertanyaan yang benar-benar ditanyakan calon
 * penyewa, bukan urutan tabel di basis data:
 *
 *   1. Boleh tidak buka usaha di sini?      ZoneGuard — kalau tidak, sisanya sia-sia
 *   2. Seberapa bagus lokasinya?            Skor + kuadran
 *   3. Berapa sewanya, wajar tidak?         PriceLens
 *   4. Kapan ramainya?                      Commuter Clock
 *   5. Ada yang perlu diwaspadai?           RiskRadar
 *   6. Kenapa skornya segitu?               Faktor
 *
 * ZoneGuard di urutan pertama bukan kebetulan. Kalau zonanya melarang, seluruh
 * angka di bawahnya tidak relevan, dan menaruhnya di bawah berarti membiarkan
 * orang membaca enam bagian sebelum tahu lokasinya tidak boleh dipakai.
 */

import { useEffect, useState } from 'react'

import { api } from '../lib/api'
import { angka, rupiah } from '../lib/format'
import type { CommuterClock, DetailHeksagon, PriceLensHeksagon } from '../types'
import BarHarga from './BarHarga'
import ChartJam from './ChartJam'
import {
  Ajakan,
  Angka,
  Badge,
  Bagian,
  Baris,
  ChipKuadran,
  Kosong,
  Memuat,
} from './primitif'

// Terjemahan kode variabel ke bahasa manusia. Pengguna tidak pernah melihat
// "D05" — ia melihat apa yang D05 ukur. Kode tetap disimpan sebagai judul
// tooltip supaya tim masih bisa menelusurinya.
const ARTI_VARIABEL: Record<string, string> = {
  D01: 'jumlah penduduk di sekitar',
  D04: 'waktu jalan kaki ke simpul transit',
  D05: 'seberapa penting simpul transitnya',
  D06: 'perkiraan jumlah penumpang',
  D10: 'seberapa ramai saat disurvei',
  D11: 'kepadatan transaksi',
  B07: 'harga makanan per porsi',
  B09: 'nominal belanja per struk',
  C03: 'keragaman jenis usaha',
  C05: 'banyaknya waralaba',
  C06: 'kompetitor per penduduk',
  C07: 'banyaknya pedagang keliling',
  C08: 'usaha kuliner yang menetap',
  P01: 'NJOP tanah',
  P05: 'harga sewa',
  P06: 'seringnya usaha berganti',
  L03: 'risiko banjir',
  M03: 'kesan visual lokasi',
}

const ARTI_INDEKS: Record<string, string> = {
  IPT: 'potensi transit',
  IAE: 'aktivitas ekonomi',
  IKP: 'kompetisi',
  IBR: 'biaya & risiko',
}

export default function PanelInsight({
  h3,
  onBukaKuadran,
}: {
  h3: string | null
  onBukaKuadran: () => void
}) {
  const [detail, setDetail] = useState<DetailHeksagon | null>(null)
  const [harga, setHarga] = useState<PriceLensHeksagon | null>(null)
  const [jam, setJam] = useState<CommuterClock | null>(null)
  const [memuat, setMemuat] = useState(false)
  const [galat, setGalat] = useState<string | null>(null)

  useEffect(() => {
    if (!h3) {
      setDetail(null)
      setHarga(null)
      setJam(null)
      return
    }
    let batal = false
    setMemuat(true)
    setGalat(null)

    // Ketiganya diminta bersamaan, bukan berurutan. Menunggu satu selesai
    // sebelum meminta berikutnya akan melipattigakan waktu tunggu di jaringan
    // yang lambat, tanpa alasan.
    Promise.allSettled([
      api.detailHeksagon(h3),
      api.kartuHarga(h3),
      api.commuterClock(h3),
    ])
      .then(([d, p, c]) => {
        if (batal) return
        if (d.status === 'fulfilled') setDetail(d.value)
        else setGalat(d.reason instanceof Error ? d.reason.message : 'gagal memuat')
        setHarga(p.status === 'fulfilled' ? p.value : null)
        setJam(c.status === 'fulfilled' ? c.value : null)
      })
      .finally(() => !batal && setMemuat(false))

    return () => {
      batal = true
    }
  }, [h3])

  if (!h3)
    return (
      <Ajakan
        judul="Pilih satu heksagon"
        anak="Klik heksagon mana pun di peta untuk melihat skornya, harga sewanya, dan kapan lokasi itu ramai."
      />
    )
  if (memuat && !detail) return <Memuat baris={5} />
  if (galat)
    return (
      <Ajakan
        judul="Gagal memuat heksagon"
        anak={galat}
        aksi={
          <code className="mt-1 rounded-xs bg-ground-2 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2">
            {h3}
          </code>
        }
      />
    )
  if (!detail) return null

  const { skor, indeks, faktor, zoneguard, risiko } = detail
  const terlarang = zoneguard.filter_mutlak
  const tanpaRdtr = zoneguard.status === 'TIDAK_DIKETAHUI'

  return (
    <div key={h3} className="masuk scroll-tipis h-full overflow-y-auto">
      {/* --- Kepala --------------------------------------------------------- */}
      <div className="sticky top-0 z-10 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="mb-2 flex items-center justify-between gap-2">
          <code className="font-mono text-[10.5px] tracking-tight text-ink-3">
            {skor.h3_index}
          </code>
          <Badge badge={skor.keyakinan} />
        </div>

        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="flex items-baseline gap-1.5">
              <span
                className={`papan tabular text-[34px] leading-none ${
                  terlarang ? 'text-ink-3 line-through decoration-bahaya decoration-2' : ''
                }`}
              >
                {skor.opportunity_score?.toFixed(0) ?? '—'}
              </span>
              <span className="text-[11px] text-ink-3">/ 100</span>
            </div>
            <p className="eyebrow mt-1">
              Skor peluang
              {skor.peringkat !== null && ` · peringkat ${skor.peringkat}`}
            </p>
          </div>
          <button
            onClick={onBukaKuadran}
            className="cursor-pointer transition-opacity hover:opacity-70"
            title="Lihat posisinya di diagram kuadran"
          >
            <ChipKuadran kuadran={skor.kuadran} />
          </button>
        </div>

        {detail.kuadran_penjelasan && (
          <p className="mt-2 text-[11.5px] leading-snug text-ink-2">
            {detail.kuadran_penjelasan}
          </p>
        )}
      </div>

      {/* --- 1. ZoneGuard --------------------------------------------------- */}
      {(terlarang || tanpaRdtr) && (
        <div
          className={`border-b px-4 py-3 ${
            terlarang
              ? 'border-bahaya/25 bg-bahaya-soft'
              : 'border-line bg-surface-2'
          }`}
          role={terlarang ? 'alert' : undefined}
        >
          <div className="flex gap-2.5">
            <span
              aria-hidden
              className={`mt-0.5 h-4 w-4 shrink-0 rounded-xs ${
                terlarang ? 'bg-bahaya' : 'arsir border border-line-2 text-ink-3'
              }`}
            />
            <div>
              <p
                className={`text-[12px] font-semibold ${terlarang ? 'text-bahaya' : 'text-ink'}`}
              >
                {terlarang ? 'ZoneGuard — tidak boleh dipakai usaha' : 'Belum ada RDTR digital'}
              </p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-ink-2">
                {zoneguard.penjelasan}
              </p>
              {zoneguard.kelas_zona && (
                <p className="mt-1 font-mono text-[10.5px] text-ink-3">
                  Kelas zona {zoneguard.kelas_zona}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- 2. PriceLens --------------------------------------------------- */}
      <Bagian judul="PriceLens — harga sewa">
        {harga ? (
          <>
            <BarHarga
              nilai={harga.harga_sewa_per_m2}
              wajar={harga.wajar_sewa_per_m2}
              posisi={harga.posisi_sewa}
              selisih={harga.selisih_persen_dari_median}
              format={(n) => (n === null ? null : `${rupiah(n)}/m²`)}
              kawasan={harga.kawasan}
            />
            <div className="mt-3 border-t border-line pt-2">
              <Baris label="Sewa per bulan" bantuan="P05 — angka yang tertulis di spanduk">
                <Angka nilai={rupiah(harga.harga_sewa_median)} />
              </Baris>
              <Baris
                label="Uang berpindah per jam"
                bantuan="B10 — total nominal struk dibagi jam operasional teramati"
              >
                <Angka nilai={rupiah(harga.belanja_per_jam)} />
              </Baris>
              <Baris label="Harga makanan per porsi" bantuan="B07">
                <Angka nilai={rupiah(harga.harga_median_porsi)} />
              </Baris>
              <Baris label="NJOP" bantuan="P01 — pembanding independen dari OCR">
                <Angka nilai={rupiah(harga.njop_m2)} satuan="/m²" />
              </Baris>
            </div>
          </>
        ) : (
          <Kosong teks="Data harga belum tersedia untuk heksagon ini" />
        )}
      </Bagian>

      {/* --- 3. Commuter Clock ---------------------------------------------- */}
      <Bagian
        judul="Commuter Clock — kapan uang berpindah"
        aksi={
          jam?.dominasi && (
            <span className="rounded-xs bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink-2">
              {jam.dominasi === 'captive'
                ? 'Didominasi captive'
                : jam.dominasi === 'choice'
                  ? 'Didominasi choice'
                  : 'Seimbang'}
            </span>
          )
        }
      >
        {jam ? (
          <>
            <ChartJam jam={jam.jam} jamPuncak={jam.jam_puncak} />
            <p className="mt-2 text-[11.5px] leading-snug text-ink-2">
              {jam.jam_puncak !== null ? (
                <>
                  Paling ramai pukul{' '}
                  <span className="tabular font-semibold">
                    {String(jam.jam_puncak).padStart(2, '0')}:00
                  </span>
                  .{' '}
                  {jam.dominasi === 'captive'
                    ? 'Arusnya menumpuk dua kali sehari dan sepi di antaranya — cocok untuk usaha yang cepat melayani.'
                    : jam.dominasi === 'choice'
                      ? 'Arusnya lebih rata sepanjang hari — cocok untuk usaha yang butuh orang berlama-lama.'
                      : 'Arusnya tidak condong ke salah satu jenis penumpang.'}
                </>
              ) : (
                'Belum ada jam transaksi yang tercatat.'
              )}
            </p>
            {jam.catatan && (
              <p className="mt-1.5 flex gap-1.5 text-[11px] leading-snug text-ink-3">
                <span
                  aria-hidden
                  className="arsir mt-[3px] h-3 w-3 shrink-0 rounded-[2px] border border-line-2"
                />
                {jam.catatan}
              </p>
            )}
          </>
        ) : (
          <Kosong teks="Profil jam belum tersedia" />
        )}
      </Bagian>

      {/* --- 4. RiskRadar --------------------------------------------------- */}
      {risiko.tingkat !== 'AMAN' && (
        <Bagian judul="RiskRadar — pergantian usaha">
          <div className="flex gap-2.5 rounded-sm border border-bahaya/25 bg-bahaya-soft p-2.5">
            <span
              aria-hidden
              className={`mt-0.5 h-4 w-4 shrink-0 rounded-xs ${
                risiko.tingkat === 'BAHAYA' ? 'bg-bahaya' : 'border-2 border-bahaya'
              }`}
            />
            <div>
              <p className="text-[12px] font-semibold text-bahaya">{risiko.label}</p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-ink-2">
                Usaha di sini lebih sering berganti daripada kebanyakan area lain di
                kawasan yang sama. Itu tanda lokasi yang terus-menerus membuat
                penyewanya menyerah.
              </p>
            </div>
          </div>
        </Bagian>
      )}

      {/* --- 5. Empat indeks ------------------------------------------------ */}
      <Bagian judul="Empat indeks pembentuk skor">
        {(
          [
            ['ipt', 'Potensi transit', indeks.ipt, false],
            ['iae', 'Aktivitas ekonomi', indeks.iae, false],
            ['ikp', 'Kompetisi', indeks.ikp, true],
            ['ibr', 'Biaya & risiko', indeks.ibr, true],
          ] as const
        ).map(([kunci, label, nilai, terbalik]) => (
          <div key={kunci} className="py-[5px]">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-[12px] text-ink-2">
                {label}
                {terbalik && <span className="ml-1 text-[10px] text-ink-3">tinggi = buruk</span>}
              </span>
              <span className="tabular text-[12px] font-medium">
                {nilai === null ? <Kosong teks="—" /> : nilai.toFixed(2)}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-ground-2">
              <div
                className={`h-full rounded-full ${terbalik ? 'bg-ink-3' : 'bg-ink-2'}`}
                style={{ width: `${Math.min(100, (nilai ?? 0) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </Bagian>

      {/* --- 6. Faktor ------------------------------------------------------ */}
      {faktor.length > 0 && (
        <Bagian judul="Kenapa skornya segitu">
          <ul className="space-y-1.5">
            {faktor.slice(0, 6).map((f) => (
              <li key={f.kode_variabel} className="flex items-baseline gap-2">
                <span
                  className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    background:
                      f.indeks === 'IKP' || f.indeks === 'IBR'
                        ? 'var(--color-ink-3)'
                        : 'var(--color-ink)',
                  }}
                  aria-hidden
                />
                <span className="flex-1 text-[12px] leading-snug text-ink-2">
                  <span title={`${f.kode_variabel} · ${f.indeks}`}>
                    {ARTI_VARIABEL[f.kode_variabel] ?? f.kode_variabel}
                  </span>
                  {f.persentil !== null && (
                    <span className="text-ink-3">
                      {' '}
                      — lebih tinggi daripada{' '}
                      <span className="tabular font-medium text-ink-2">
                        {f.persentil.toFixed(0)}
                      </span>{' '}
                      dari 100 lokasi lain
                    </span>
                  )}
                </span>
                <span className="tabular shrink-0 text-[11px] text-ink-3">
                  {ARTI_INDEKS[f.indeks]}
                </span>
              </li>
            ))}
          </ul>
        </Bagian>
      )}

      {/* --- 7. Variabel lengkap -------------------------------------------- */}
      <Bagian judul="Seluruh 43 variabel">
        <details className="group">
          <summary className="cursor-pointer list-none text-[12px] text-ink-2 underline decoration-line-2 underline-offset-2 hover:text-ink">
            Tampilkan tabel lengkap
          </summary>
          {/* Tabel data adalah jalur alternatif untuk grafik di atas — pembaca
              layar dan pengguna yang tidak membedakan warna tetap bisa membaca
              seluruh angkanya. */}
          <div className="scroll-tipis mt-2 max-h-64 overflow-y-auto rounded-sm border border-line">
            <table className="w-full text-[11px]">
              <tbody>
                {Object.entries(detail.variabel).map(([nama, nilai], i) => (
                  <tr key={nama} className={i % 2 ? 'bg-surface-2' : ''}>
                    <td className="px-2 py-1 text-ink-2">{nama.replace(/_/g, ' ')}</td>
                    <td className="tabular px-2 py-1 text-right">
                      {nilai === null || nilai === undefined ? (
                        <Kosong teks="—" />
                      ) : typeof nilai === 'boolean' ? (
                        nilai ? 'ya' : 'tidak'
                      ) : typeof nilai === 'number' ? (
                        angka(nilai, 2)
                      ) : (
                        String(nilai)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Bagian>

      <p className="px-4 pb-6 pt-1 text-[10.5px] leading-snug text-ink-3">
        Angka di kartu ini dihitung sekali oleh pipeline dan dibaca apa adanya.
        Informasi untuk pertimbangan, bukan nasihat investasi.
      </p>
    </div>
  )
}
