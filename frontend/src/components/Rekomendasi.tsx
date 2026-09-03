/**
 * Rekomendasi personal — tab "Untuk Anda".
 *
 * BEDANYA DENGAN DAFTAR LOKASI, dan kenapa keduanya sama-sama ada:
 *
 *   Daftar lokasi  MEMERINGKAT. Semua orang melihat urutan yang sama, dan itu
 *                  memang yang dibutuhkan untuk MEMBACA sebuah kawasan.
 *   Untuk Anda     MEREKOMENDASIKAN. Disaring menurut anggaran dan kawasan yang
 *                  sudah dinyatakan orangnya, dan tiap barisnya membawa ALASAN
 *                  berupa angka lokasi itu sendiri.
 *
 * Perbedaan itu pernah nyata di data tetapi tidak terasa di layar — keduanya
 * tampil sebagai daftar kartu abu-abu yang mirip, dan pemilik repo melaporkannya
 * apa adanya: "sama aja aku lihat". Yang diperbaiki di sini bukan datanya,
 * melainkan cara tab ini menyatakan dirinya:
 *
 *   1. Kriteria yang dipakai ditulis besar di kepala, bukan sebagai catatan.
 *   2. Peringkat satu diberi kartu tersendiri — "yang paling cocok untuk Anda"
 *      adalah satu jawaban, bukan baris pertama dari dua belas.
 *   3. Tiap alasan membawa angkanya. "Lokasinya strategis" kalimat pemasaran;
 *      "2 menit jalan kaki ke stasiun" bisa diperiksa dan dibantah.
 *
 * Catatan (churn tinggi, RDTR kosong, data tipis) ikut ditampilkan, TIDAK
 * disembunyikan demi membuat rekomendasinya terlihat lebih meyakinkan. Daftar
 * rekomendasi yang menyembunyikan alasan untuk ragu bukan rekomendasi, itu iklan.
 */

import { useCallback, useEffect, useState } from 'react'

import { KUADRAN, kodeLokasi } from '../config'
import { api, GalatAPI } from '../lib/api'
import { rupiah } from '../lib/format'
import type { Rekomendasi as SatuRekomendasi, HasilRekomendasi } from '../types'
import { useSesi } from './Akun'
import { Ajakan, Badge, Glif, Memuat } from './primitif'

/** Ikon per jenis alasan. Bentuk lebih cepat dikenali daripada warna. */
function IkonAlasan({ jenis }: { jenis: 'cocok' | 'catatan' }) {
  return jenis === 'cocok' ? (
    <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden className="mt-0.5 shrink-0 text-gem">
      <path
        d="m4 10.5 4 4 8-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden className="mt-0.5 shrink-0 text-jebakan">
      <path d="M10 3.5 18 16.5H2Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M10 8v3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="10" cy="13.8" r="0.9" fill="currentColor" />
    </svg>
  )
}

/** Satu angka kunci di kaki kartu. Angka telanjang tanpa label tidak berarti apa-apa. */
function Angka({ label, nilai }: { label: string; nilai: string | null }) {
  if (!nilai) return null
  return (
    <span className="min-w-0 shrink-0">
      <span className="block whitespace-nowrap text-[9.5px] uppercase tracking-[0.06em] text-ink-3">
        {label}
      </span>
      <span className="tabular block whitespace-nowrap text-[12.5px] font-semibold text-ink-2">
        {nilai}
      </span>
    </span>
  )
}

function Kartu({
  r,
  no,
  utama,
  onPilih,
}: {
  r: SatuRekomendasi
  no: number
  /** Peringkat satu: kartu penuh dengan pita, bukan baris biasa. */
  utama?: boolean
  onPilih: (h3: string) => void
}) {
  const cocok = r.alasan.filter((a) => a.jenis === 'cocok')
  const catatan = r.alasan.filter((a) => a.jenis === 'catatan')
  const q = r.skor.kuadran ? KUADRAN[r.skor.kuadran] : null

  return (
    <button
      onClick={() => onPilih(r.skor.h3_index)}
      className={`ungkap group w-full cursor-pointer text-left transition-all duration-300 ${
        utama
          ? 'rounded-xl border border-line bg-surface p-4 shadow-[0_10px_30px_-18px_rgb(22_33_28/0.45)] hover:-translate-y-0.5 hover:border-line-2'
          : 'border-b border-line px-4 py-3.5 hover:bg-surface-2'
      }`}
      style={{
        animationDelay: `${Math.min(no, 8) * 40}ms`,
        ...(utama && q ? { background: `linear-gradient(180deg, ${q.lembut} 0%, var(--color-surface) 42%)` } : {}),
      }}
    >
      {utama && (
        <span className="mb-2.5 inline-flex items-center gap-1.5 rounded-full bg-ink px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.09em] text-surface">
          <svg width="10" height="10" viewBox="0 0 20 20" aria-hidden>
            <path d="M10 2.5 11.7 7l4.8 1.4L11.7 10l-1.7 4.5L8.3 10 3.5 8.4 8.3 7Z" fill="currentColor" />
          </svg>
          Paling cocok untuk Anda
        </span>
      )}

      <div className="flex items-start gap-3">
        {!utama && (
          <span className="tabular mt-1 w-4 shrink-0 text-[12px] font-semibold text-ink-3">{no}</span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={`papan tabular leading-none ${utama ? 'text-[38px]' : 'text-[22px]'}`}>
              {r.skor.opportunity_score?.toFixed(0) ?? '—'}
            </span>
            <span className="text-[11px] text-ink-3">/ 100</span>
            {r.skor.kuadran && (
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                <Glif kuadran={r.skor.kuadran} ukuran={utama ? 12 : 10} />
                {utama && q && (
                  <span className="text-[12px] font-semibold" style={{ color: q.warna }}>
                    {q.nama}
                  </span>
                )}
              </span>
            )}
          </div>

          <p className="mt-1 truncate text-[12.5px] font-medium text-ink-2">
            {kodeLokasi(r.skor.h3_index, r.kawasan)}
          </p>

          <ul className="mt-2.5 space-y-1">
            {cocok.slice(0, utama ? 5 : 3).map((a) => (
              <li key={a.kode} className="flex gap-1.5 text-[12px] leading-snug text-ink-2">
                <IkonAlasan jenis="cocok" />
                {a.teks}
              </li>
            ))}
            {catatan.map((a) => (
              <li key={a.kode} className="flex gap-1.5 text-[12px] leading-snug text-jebakan">
                <IkonAlasan jenis="catatan" />
                {a.teks}
              </li>
            ))}
          </ul>

          <div className="mt-3 flex items-end justify-between gap-3 border-t border-line/70 pt-2.5">
            <div className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1.5">
              <Angka
                label="Sewa / bln"
                nilai={r.harga_sewa_median === null ? null : rupiah(r.harga_sewa_median)}
              />
              <Angka
                label="Ke stasiun"
                nilai={
                  r.waktu_jalan_menit === null
                    ? null
                    : `${r.waktu_jalan_menit.toFixed(0)} mnt${
                        r.jarak_simpul_m === null
                          ? ''
                          : r.jarak_simpul_m >= 1000
                            ? ` · ${(r.jarak_simpul_m / 1000).toLocaleString('id-ID', {
                                maximumFractionDigits: 1,
                              })} km`
                            : ` · ${Math.round(r.jarak_simpul_m)} m`
                      }`
                }
              />
              <Angka
                label="Pesaing"
                nilai={
                  r.n_kompetitor_langsung === null ? null : r.n_kompetitor_langsung.toFixed(0)
                }
              />
            </div>
            <span className="shrink-0">
              <Badge badge={r.skor.keyakinan} ringkas />
            </span>
          </div>
        </div>
      </div>
    </button>
  )
}

export default function Rekomendasi({
  onPilih,
  onBukaAkun,
}: {
  onPilih: (h3: string) => void
  /** Membuka dialog preferensi supaya kriterianya bisa diubah. */
  onBukaAkun: () => void
}) {
  const { akun, premium, mintaMasuk, mintaLangganan } = useSesi()
  const [data, setData] = useState<HasilRekomendasi | null>(null)
  const [galat, setGalat] = useState<string | null>(null)

  const muat = useCallback(() => {
    if (!akun) return
    setData(null)
    setGalat(null)
    api
      .rekomendasi()
      .then(setData)
      .catch((e) => setGalat(e instanceof GalatAPI ? e.message : 'Rekomendasi gagal dimuat.'))
  }, [akun])

  // Dimuat ulang saat akun ATAU preferensinya berubah — kriteria yang baru
  // disimpan harus langsung terlihat, bukan menunggu tab dibuka ulang.
  useEffect(() => {
    muat()
  }, [muat, akun?.preferensi?.kawasan, akun?.preferensi?.budget_sewa_bulanan, premium])

  // --- Belum masuk --------------------------------------------------------
  if (!akun)
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-ink text-surface">
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
            <path d="M10 2.5 11.7 7l4.8 1.4L11.7 10l-1.7 4.5L8.3 10 3.5 8.4 8.3 7Z" fill="currentColor" />
          </svg>
        </span>
        <h2 className="papan text-[19px]">Rekomendasi khusus Anda</h2>
        <p className="mx-auto mt-2 max-w-[34ch] text-[13.5px] leading-relaxed text-ink-2">
          Daftar lokasi memeringkat semuanya sama untuk semua orang. Tab ini menyaring
          menurut <strong className="font-semibold text-ink">anggaran</strong> dan{' '}
          <strong className="font-semibold text-ink">kawasan incaran Anda</strong>, lalu
          menjelaskan tiap lokasi dengan angkanya sendiri.
        </p>
        <button
          onClick={() => mintaMasuk('Rekomendasi disusun dari preferensi akun Anda.')}
          className="mt-4 cursor-pointer rounded-full bg-ink px-5 py-2.5 text-[13.5px] font-semibold text-surface transition-transform duration-300 ease-jelly hover:scale-[1.03]"
        >
          Buat akun gratis
        </button>
      </div>
    )

  if (galat) return <Ajakan judul="Gagal memuat" anak={galat} />
  if (!data) return <Memuat baris={4} teks="Menyusun rekomendasi…" />

  const tanpaKriteria = !data.kriteria.ringkas

  return (
    <div className="scroll-tipis h-full overflow-y-auto">
      {/* --- Kepala: kriteria yang dipakai, ditulis besar ------------------
          Orang berhak tahu atas dasar apa daftar ini disusun — dan kalau salah
          satu kriterianya bukan yang ia maksud, ia melihatnya DI SINI alih-alih
          menyimpulkan produknya salah. */}
      <div className="sticky top-0 z-10 border-b border-line bg-surface/95 px-4 py-3.5 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow flex items-center gap-1.5">
              <svg width="10" height="10" viewBox="0 0 20 20" aria-hidden className="text-gem">
                <path d="M10 2.5 11.7 7l4.8 1.4L11.7 10l-1.7 4.5L8.3 10 3.5 8.4 8.3 7Z" fill="currentColor" />
              </svg>
              Disusun untuk Anda
            </p>
            <p className="papan mt-1 text-[15px] leading-snug">
              {tanpaKriteria ? (
                <span className="text-ink-3">Belum ada preferensi tersimpan</span>
              ) : (
                data.kriteria.ringkas
              )}
            </p>
          </div>
          <button
            onClick={onBukaAkun}
            className="shrink-0 cursor-pointer rounded-full border border-line px-3 py-1.5 text-[11.5px] font-semibold text-ink-2 transition-colors hover:border-ink hover:text-ink"
          >
            {tanpaKriteria ? 'Isi kriteria' : 'Ubah'}
          </button>
        </div>

        {/* Angka yang membedakan tab ini dari Daftar lokasi: berapa yang
            benar-benar COCOK, bukan berapa yang ada. */}
        <div className="mt-2.5 flex items-baseline gap-2">
          <span className="papan tabular text-[20px] leading-none text-ink">{data.total_cocok}</span>
          <span className="text-[12px] leading-snug text-ink-2">
            lokasi memenuhi kriteria Anda
            {data.dipotong && (
              <span className="text-ink-3"> · {data.hasil.length} ditampilkan</span>
            )}
          </span>
        </div>
      </div>

      {data.hasil.length === 0 ? (
        <Ajakan
          judul="Tidak ada yang cocok"
          anak="Belum ada lokasi yang memenuhi kriteria itu. Coba naikkan anggaran, atau lepaskan batasan kawasannya."
          aksi={
            <button
              onClick={onBukaAkun}
              className="mt-3 cursor-pointer rounded-full border border-line px-4 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:border-ink hover:text-ink"
            >
              Ubah kriteria
            </button>
          }
        />
      ) : (
        <>
          <div className="p-4 pb-2">
            <Kartu r={data.hasil[0]} no={1} utama onPilih={onPilih} />
          </div>
          {data.hasil.length > 1 && (
            <>
              <p className="eyebrow px-4 pb-1 pt-2">Pilihan lain untuk Anda</p>
              <ul>
                {data.hasil.slice(1).map((r, i) => (
                  <li key={r.skor.h3_index}>
                    <Kartu r={r} no={i + 2} onPilih={onPilih} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {/* --- Sisanya terkunci ---------------------------------------------
          Jumlahnya disebut apa adanya. Menyembunyikan angkanya membuat tawaran
          ini terdengar seperti gertakan; menyebutnya membuatnya bisa ditimbang. */}
      {data.dipotong && (
        <div className="border-y border-line bg-surface-2/70 px-4 py-5 text-center">
          <p className="papan text-[15px] text-ink">
            {data.total_cocok - data.hasil.length} lokasi lain juga cocok
          </p>
          <p className="mx-auto mt-1 max-w-[34ch] text-[12.5px] leading-snug text-ink-2">
            Daftar penuh beserta alasan tiap lokasinya terbuka untuk pelanggan Loconomics
            Premium.
          </p>
          <button
            onClick={() => mintaLangganan('Rekomendasi penuh bagian dari Loconomics Premium.')}
            className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[12.5px] font-semibold text-surface transition-transform duration-300 ease-jelly hover:scale-[1.04]"
          >
            <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden>
              <path d="M10 2.5 11.7 7l4.8 1.4L11.7 10l-1.7 4.5L8.3 10 3.5 8.4 8.3 7Z" fill="currentColor" />
            </svg>
            Gabung Loconomics Premium
          </button>
        </div>
      )}

      <p className="px-4 py-4 text-[11.5px] leading-snug text-ink-3">
        Urutannya memakai Opportunity Score yang dihitung pipeline — preferensi Anda
        menyaring dan menjelaskan, tidak pernah mengubah skornya. Lokasi berzona terlarang
        tidak pernah muncul di daftar ini.
      </p>
    </div>
  )
}
