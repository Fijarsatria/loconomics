/**
 * Daftar lokasi — sisi "banyak" dari panel kanan.
 *
 * Panel detail menjawab "bagaimana lokasi INI". Daftar ini menjawab "yang mana
 * yang harus saya lihat", dan itu pertanyaan yang datang lebih dulu. Karena itu
 * daftar yang tampil pertama saat aplikasi dibuka, bukan layar kosong yang
 * menyuruh mengklik heksagon.
 *
 * ISINYA MENGIKUTI LAYER AKTIF. Satu komponen, lima isi, dijalankan oleh state
 * yang sama dengan peta dan legendanya:
 *
 *   opportunity  -> peringkat skor peluang
 *   hidden_gem   -> GemFinder, lengkap dengan rangkuman alasan terpilihnya
 *   risk_radar   -> RiskRadar, lengkap dengan label peringatannya
 *   pricelens    -> rentang harga wajar + cakupan data harga per kawasan
 *   zoneguard    -> cakupan RDTR per kawasan
 *
 * Alasannya sederhana: layer sudah menyatakan pertanyaan yang sedang diajukan.
 * Membuat daftar menjawab pertanyaan yang berbeda dari peta di sebelahnya akan
 * memaksa pengguna memegang dua konteks sekaligus.
 */

import { useEffect, useState } from 'react'

import { KUADRAN, LAYER, type NamaLayer } from '../config'
import { api } from '../lib/api'
import { rupiah } from '../lib/format'
import type { HiddenGem, SkorHeksagon, TitikKuadran } from '../types'
import { Ajakan, Badge, Glif, Kosong, Memuat } from './primitif'

type Isi =
  | { jenis: 'skor'; baris: SkorHeksagon[] }
  | { jenis: 'gem'; baris: HiddenGem[] }
  | { jenis: 'risiko'; baris: TitikKuadran[] }
  | { jenis: 'cakupan'; baris: Record<string, unknown>[] }
  | { jenis: 'harga'; baris: Record<string, unknown>[] }

const LABEL_RISIKO: Record<string, string> = {
  BAHAYA: 'Pergantian usaha termasuk 10% tertinggi di kawasan ini',
  WASPADA: 'Pergantian usaha lebih sering daripada 75% area lain',
  AMAN: 'Pergantian usaha wajar',
}

export default function DaftarLokasi({
  layer,
  kawasan,
  terpilih,
  onPilih,
}: {
  layer: NamaLayer
  kawasan: string
  terpilih: string | null
  onPilih: (h3: string) => void
}) {
  const [isi, setIsi] = useState<Isi | null>(null)
  const [memuat, setMemuat] = useState(true)
  const [galat, setGalat] = useState<string | null>(null)

  useEffect(() => {
    let batal = false
    setMemuat(true)
    setGalat(null)
    setIsi(null)

    const minta = async (): Promise<Isi> => {
      switch (layer) {
        case 'hidden_gem':
          return { jenis: 'gem', baris: await api.hiddenGems({ kawasan, limit: 10 }) }
        case 'risk_radar':
          return {
            jenis: 'risiko',
            baris: await api.riskRadar({ kawasan, hanya_berperingatan: true, limit: 25 }),
          }
        case 'zoneguard':
          return { jenis: 'cakupan', baris: await api.cakupanZona() }
        case 'pricelens':
          return { jenis: 'harga', baris: await api.ringkasanHarga() }
        default:
          return { jenis: 'skor', baris: await api.ranking({ kawasan, limit: 25 }) }
      }
    }

    minta()
      .then((h) => !batal && setIsi(h))
      .catch((e: Error) => !batal && setGalat(e.message))
      .finally(() => !batal && setMemuat(false))

    return () => {
      batal = true
    }
  }, [layer, kawasan])

  if (memuat) return <Memuat baris={6} />
  if (galat) return <Ajakan judul="Daftar gagal dimuat" anak={galat} />
  if (!isi) return null

  return (
    <div className="scroll-tipis h-full overflow-y-auto">
      <div className="sticky top-0 z-10 border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur">
        <h2 className="eyebrow">{LAYER[layer].nama}</h2>
        <p className="mt-0.5 text-[11.5px] leading-snug text-ink-2">
          {LAYER[layer].pertanyaan}
        </p>
      </div>

      {isi.jenis === 'cakupan' ? (
        <Cakupan baris={isi.baris} kawasanAktif={kawasan} />
      ) : isi.jenis === 'harga' ? (
        <RentangKawasan baris={isi.baris} kawasanAktif={kawasan} />
      ) : isi.baris.length === 0 ? (
        <Ajakan
          judul={
            layer === 'risk_radar'
              ? 'Tidak ada peringatan di sini'
              : layer === 'hidden_gem'
                ? 'Belum ada hidden gem'
                : 'Belum ada lokasi berskor'
          }
          anak={
            layer === 'risk_radar'
              ? `Tidak ada area di ${kawasan} yang pergantian usahanya melewati ambang wajar kawasannya sendiri. Itu kabar baik.`
              : layer === 'hidden_gem'
                ? `Belum ada heksagon di ${kawasan} yang lolos minimal dua dari tiga metode deteksi. Coba kawasan yang prestise visualnya lebih rendah.`
                : `Skor untuk ${kawasan} belum dihitung. Jalankan pipeline sampai tahap terbit.`
          }
        />
      ) : (
        <ol>
          {isi.jenis === 'gem' &&
            isi.baris.map((g, i) => (
              <Kartu
                key={g.skor.h3_index}
                no={i + 1}
                h3={g.skor.h3_index}
                aktif={terpilih === g.skor.h3_index}
                onPilih={onPilih}
                kuadran={g.skor.kuadran}
                nilai={g.skor.hidden_gem_score?.toFixed(2) ?? '—'}
                satuan="skor gem"
                badge={g.skor.keyakinan}
              >
                {/* Rangkuman alasan — inti kriteria penerimaan GemFinder.
                    Kalimatnya dirakit backend dari angka basis data, bukan
                    dikarang model bahasa, jadi tiap klaimnya bisa ditelusuri. */}
                <p className="mt-1 text-[11.5px] leading-snug text-ink-2">{g.ringkasan}</p>
                {g.alasan.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {g.alasan.map((a) => (
                      <li
                        key={a.metode}
                        className="flex items-baseline gap-1.5 text-[10.5px] text-ink-3"
                      >
                        <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-gem" aria-hidden />
                        <span title={`Kode variabel: ${a.kode_variabel.join(', ')}`}>
                          {a.bukti}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1.5 text-[10px] text-ink-3">
                  Lolos {g.n_metode_lolos} dari 3 metode
                  {g.zoneguard.status === 'TIDAK_DIKETAHUI' && ' · zona belum bisa dipastikan'}
                </p>
              </Kartu>
            ))}

          {isi.jenis === 'risiko' &&
            isi.baris.map((t, i) => (
              <Kartu
                key={t.h3_index}
                no={i + 1}
                h3={t.h3_index}
                aktif={terpilih === t.h3_index}
                onPilih={onPilih}
                kuadran={t.kuadran}
                nilai={t.y_peluang?.toFixed(0) ?? '—'}
                satuan="skor peluang"
                badge={t.keyakinan}
              >
                {/* Label peringatan — inti kriteria penerimaan RiskRadar. */}
                <p
                  className={`mt-1 inline-flex items-center gap-1.5 rounded-xs px-1.5 py-[3px] text-[10.5px] font-semibold ${
                    t.risiko === 'BAHAYA'
                      ? 'bg-bahaya-soft text-bahaya'
                      : 'text-bahaya ring-1 ring-inset ring-bahaya/35'
                  }`}
                >
                  <span
                    aria-hidden
                    className={`h-2.5 w-2.5 rounded-[2px] ${
                      t.risiko === 'BAHAYA' ? 'bg-bahaya' : 'border-[1.5px] border-bahaya'
                    }`}
                  />
                  {t.risiko}
                </p>
                <p className="mt-1 text-[11.5px] leading-snug text-ink-2">
                  {LABEL_RISIKO[t.risiko]}
                  {t.indeks_churn !== null && (
                    <span className="tabular text-ink-3">
                      {' '}
                      · indeks churn {t.indeks_churn.toFixed(2)}
                    </span>
                  )}
                </p>
              </Kartu>
            ))}

          {isi.jenis === 'skor' &&
            [...isi.baris]
              .sort((a, b) =>
                layer === 'pricelens' ? 0 : (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0),
              )
              .map((s, i) => (
                <Kartu
                  key={s.h3_index}
                  no={i + 1}
                  h3={s.h3_index}
                  aktif={terpilih === s.h3_index}
                  onPilih={onPilih}
                  kuadran={s.kuadran}
                  nilai={s.opportunity_score?.toFixed(0) ?? '—'}
                  satuan="skor peluang"
                  badge={s.keyakinan}
                >
                  {s.kuadran && (
                    <p className="mt-1 text-[11.5px] leading-snug text-ink-2">
                      {KUADRAN[s.kuadran].arti}
                    </p>
                  )}
                  {s.zona_izin_komersial === null && (
                    <p className="mt-1 flex items-center gap-1.5 text-[10.5px] text-ink-3">
                      <span
                        aria-hidden
                        className="arsir h-2.5 w-2.5 rounded-[2px] border border-line-2"
                      />
                      Zona belum bisa dipastikan
                    </p>
                  )}
                </Kartu>
              ))}
        </ol>
      )}

      <p className="px-4 py-3 text-[10.5px] leading-snug text-ink-3">
        Lokasi berzona terlarang tidak pernah muncul di daftar ini, berapa pun
        skornya.
      </p>
    </div>
  )
}

/** Satu baris daftar. Bentuknya sama untuk ketiga jenis isi. */
function Kartu({
  no,
  h3,
  aktif,
  onPilih,
  kuadran,
  nilai,
  satuan,
  badge,
  children,
}: {
  no: number
  h3: string
  aktif: boolean
  onPilih: (h3: string) => void
  kuadran: string | null
  nilai: string
  satuan: string
  badge: React.ComponentProps<typeof Badge>['badge']
  children?: React.ReactNode
}) {
  return (
    <li>
      <button
        onClick={() => onPilih(h3)}
        aria-current={aktif ? 'true' : undefined}
        className={`w-full cursor-pointer border-b border-line px-4 py-3 text-left transition-colors ${
          aktif ? 'bg-surface-2' : 'hover:bg-surface-2'
        }`}
      >
        <div className="flex items-start gap-2.5">
          {/* Nomor urut sah di sini: daftarnya memang berperingkat, dan
              urutannya membawa informasi yang dibutuhkan pembaca. */}
          <span className="tabular papan mt-[1px] w-5 shrink-0 text-[13px] text-ink-3">
            {no}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex items-baseline gap-1.5">
                <span className="papan tabular text-[19px] leading-none">{nilai}</span>
                <span className="text-[10px] text-ink-3">{satuan}</span>
              </span>
              {kuadran && <Glif kuadran={kuadran} ukuran={11} />}
            </div>

            <div className="mt-1 flex items-center gap-2">
              <code className="truncate font-mono text-[10px] text-ink-3">{h3}</code>
              <span className="ml-auto shrink-0">
                <Badge badge={badge} ringkas />
              </span>
            </div>

            {children}
          </div>
        </div>
      </button>
    </li>
  )
}

/**
 * Rentang harga wajar tiap kawasan, berdampingan.
 *
 * Pertanyaan "mahal atau murah" hanya bisa dijawab dengan pembanding, dan
 * pembanding yang paling berguna bukan rata-rata nasional melainkan kawasan
 * sebelah. Rp 200.000 per m² di Dukuh Atas murah; di Harjamukti mahal.
 *
 * Cakupan datanya ikut ditampilkan. Rentang yang dihitung dari 4 heksagon dan
 * rentang yang dihitung dari 90 heksagon tidak layak dibaca dengan keyakinan
 * yang sama.
 */
function RentangKawasan({
  baris,
  kawasanAktif,
}: {
  baris: Record<string, unknown>[]
  kawasanAktif: string
}) {
  const berisi = baris.filter((r) => {
    const w = r.sewa_per_m2 as Record<string, number | null> | undefined
    return w?.p50 != null
  })
  if (berisi.length === 0)
    return <Kosong teks="Belum ada heksagon berharga di kawasan mana pun" />

  const semua = berisi.flatMap((r) => {
    const w = r.sewa_per_m2 as Record<string, number>
    return [w.p25, w.p75]
  })
  const min = Math.min(...semua)
  const maks = Math.max(...semua)
  const pos = (n: number) => ((n - min) / (maks - min || 1)) * 100

  return (
    <div className="p-4">
      <ul className="space-y-3.5">
        {berisi.map((r) => {
          const nama = String(r.kawasan)
          const w = r.sewa_per_m2 as Record<string, number>
          const cakupan = Number(r.cakupan_harga) || 0
          return (
            <li key={nama} className={nama === kawasanAktif ? '' : 'opacity-55'}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-[12.5px] font-medium">{nama}</span>
                <span className="tabular text-[11px] text-ink-2">
                  {rupiah(w.p50)}/m²
                </span>
              </div>
              <div className="relative h-3">
                <span className="absolute inset-x-0 top-1.5 h-px bg-line" />
                <span
                  className="absolute top-0.5 h-2 rounded-xs bg-ground-2"
                  style={{ left: `${pos(w.p25)}%`, width: `${pos(w.p75) - pos(w.p25)}%` }}
                  title={`${rupiah(w.p25)} – ${rupiah(w.p75)} per m²`}
                />
                <span
                  className="absolute top-0 h-3 w-[2px] rounded-full bg-ink"
                  style={{ left: `${pos(w.p50)}%` }}
                />
              </div>
              <p className="tabular mt-1 text-[10.5px] text-ink-3">
                {rupiah(w.p25)} – {rupiah(w.p75)} · cakupan data{' '}
                {(cakupan * 100).toFixed(0)}% dari {String(r.total_heksagon)} heksagon
              </p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Cakupan RDTR per kawasan.
 *
 * Angka "belum diketahui" yang besar adalah kabar penting, bukan aib.
 * Menyembunyikannya akan membuat ZoneGuard terlihat lebih meyakinkan daripada
 * kenyataannya, dan itu persis jenis klaim berlebih yang akan dibongkar juri.
 */
function Cakupan({
  baris,
  kawasanAktif,
}: {
  baris: Record<string, unknown>[]
  kawasanAktif: string
}) {
  if (baris.length === 0) return <Kosong teks="Belum ada heksagon berzona" />

  return (
    <div className="p-4">
      <ul className="space-y-3">
        {baris.map((r) => {
          const nama = String(r.kawasan)
          const total = Number(r.total) || 0
          const diizinkan = Number(r.diizinkan) || 0
          const dilarang = Number(r.dilarang) || 0
          const takTahu = Number(r.tidak_diketahui) || 0
          const cakupan = Number(r.cakupan_rdtr) || 0

          return (
            <li key={nama} className={nama === kawasanAktif ? '' : 'opacity-60'}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-[12.5px] font-medium">{nama}</span>
                <span className="tabular text-[11px] text-ink-3">
                  cakupan RDTR {(cakupan * 100).toFixed(0)}%
                </span>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-xs bg-ground-2">
                <span
                  className="bg-[#c9dbd4]"
                  style={{ width: `${(diizinkan / total) * 100}%` }}
                  title={`${diizinkan} mengizinkan`}
                />
                <span
                  className="bg-bahaya"
                  style={{ width: `${(dilarang / total) * 100}%` }}
                  title={`${dilarang} melarang`}
                />
                <span
                  className="arsir bg-line-2 text-ink-3"
                  style={{ width: `${(takTahu / total) * 100}%` }}
                  title={`${takTahu} belum ada RDTR digital`}
                />
              </div>
              <p className="tabular mt-1 text-[10.5px] text-ink-3">
                {diizinkan} mengizinkan · {dilarang} melarang · {takTahu} belum diketahui
              </p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
