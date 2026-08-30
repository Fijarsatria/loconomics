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

import {
  ARTI_INDEKS,
  ARTI_KODE,
  ARTI_VARIABEL,
  TANYA_INDEKS,
  TINGGI_BAIK,
  kataIndeks,
  keKalimat,
  kodeLokasi,
} from '../config'
import { api, GalatAPI } from '../lib/api'
import { angka, rupiah } from '../lib/format'
import type { CommuterClock, DetailHeksagon, KonteksSimpul, PriceLensHeksagon } from '../types'
import BarHarga from './BarHarga'
import ChartJam from './ChartJam'
import { useSesi } from './Akun'
import { BagianRiwayat } from './Premium'
import {
  Ajakan,
  Angka,
  Badge,
  Bagian,
  Baris,
  ChipKuadran,
  Kosong,
  Terkunci,
  Memuat,
} from './primitif'

/**
 * Satu sumbu kuadran sebagai batang, dengan MEDIAN sebagai garis tegak.
 *
 * Bukan bar biasa: yang penting bukan seberapa panjang batangnya melainkan di
 * sisi mana ia berhenti terhadap garis. Karena itu garisnya digambar tebal dan
 * gelap, dan sisi mana yang "tinggi" ditulis apa adanya di bawahnya.
 */
function SumbuKuadran({
  label,
  nilai,
  batas,
  maks,
  format,
  tinggiBaik,
}: {
  label: string
  nilai: number
  batas: number
  maks: number
  format: (v: number) => string
  tinggiBaik?: boolean
}) {
  const p = Math.max(0, Math.min(100, (nilai / maks) * 100))
  const pb = Math.max(0, Math.min(100, (batas / maks) * 100))
  const diAtas = nilai >= batas
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11.5px]">
        <span className="text-ink-3">{label}</span>
        <span className="tabular font-semibold text-ink">{format(nilai)}</span>
      </div>
      <div className="relative h-2 rounded-full bg-ground-2" aria-hidden>
        <div
          className="h-full rounded-full bg-ink-3 transition-[width] duration-500 ease-liquid"
          style={{ width: `${p}%` }}
        />
        <span
          className="absolute -top-[3px] h-[14px] w-[2px] rounded-full bg-ink"
          style={{ left: `calc(${pb}% - 1px)` }}
        />
      </div>
      <p className="mt-1 text-[11px] leading-snug text-ink-3">
        Separuh lokasi ada di bawah {format(batas)}.{' '}
        <span className="font-semibold text-ink-2">
          Yang ini {diAtas ? 'di atas' : 'di bawah'} garis itu
        </span>
        {tinggiBaik ? ' — itu yang menentukan baris atas/bawah.' : ' — itu yang menentukan kolom kiri/kanan.'}
      </p>
    </div>
  )
}

export default function PanelInsight({
  h3,
  onBukaKuadran,
  posisi,
  batas,
  onBukaSimulasi,
  onBandingkan,
  sedangDibandingkan,
}: {
  h3: string | null
  onBukaKuadran: () => void
  /** Letak heksagon ini di kedua sumbu kuadran. */
  posisi?: { x: number | null; y: number | null } | null
  /** Median kedua sumbu - garis yang memisahkan kuadran. */
  batas?: { x: number | null; y: number | null }
  /** Membuka simulasi kelayakan usaha untuk heksagon ini. */
  onBukaSimulasi?: () => void
  /** Menambahkan heksagon ini ke baki komparasi. */
  onBandingkan?: (h3: string) => void
  /** Sudah ada di baki komparasi. */
  sedangDibandingkan?: boolean
}) {
  const { premium, mintaLangganan, mintaMasuk, akun, segarkan, tandaiTerbuka, terbuka, catatSimpan } =
    useSesi()
  const [aksiSibuk, setAksiSibuk] = useState<string | null>(null)
  const [aksiPesan, setAksiPesan] = useState<string | null>(null)
  const [dipantau, setDipantau] = useState(false)
  const [detail, setDetail] = useState<DetailHeksagon | null>(null)
  const [harga, setHarga] = useState<PriceLensHeksagon | null>(null)
  const [jam, setJam] = useState<CommuterClock | null>(null)
  const [konteks, setKonteks] = useState<KonteksSimpul | null>(null)
  const [memuat, setMemuat] = useState(false)
  const [galat, setGalat] = useState<string | null>(null)

  useEffect(() => {
    if (!h3) {
      setDetail(null)
      setHarga(null)
      setJam(null)
      setKonteks(null)
      return
    }
    let batal = false
    // Dikosongkan DULU, baru diminta. Tanpa ini panel terus memegang angka
    // heksagon SEBELUMNYA sampai permintaan baru mendarat: bukan sekadar terasa
    // lambat, tapi salah - judul, skor, dan harga milik heksagon lain terbaca
    // sebagai milik yang baru diklik.
    setDetail(null)
    setHarga(null)
    setJam(null)
    setKonteks(null)
    setMemuat(true)
    setGalat(null)
    // Pesan dan penanda milik heksagon SEBELUMNYA. Dibiarkan hidup, "Sudah
    // dipantau" akan menempel di lokasi yang baru diklik dan belum dipantau.
    setAksiPesan(null)
    setDipantau(false)

    // Ketiganya diminta bersamaan, bukan berurutan. Menunggu satu selesai
    // sebelum meminta berikutnya akan melipattigakan waktu tunggu di jaringan
    // yang lambat, tanpa alasan.
    //
    // Kartu harga dan Commuter Clock BERBAYAR sejak 23 Agustus. Untuk yang
    // belum boleh, keduanya tidak diminta sama sekali - dua permintaan yang
    // sudah pasti dijawab 401 cuma membebani jaringan dan mengotori konsol.
    // Backend tetap penjaganya; ini sekadar tidak mengetuk pintu yang terkunci.
    const bolehDalam = premium || terbuka.has(h3)
    Promise.allSettled([
      api.detailHeksagon(h3),
      bolehDalam ? api.kartuHarga(h3) : Promise.reject(new Error('terkunci')),
      bolehDalam ? api.commuterClock(h3) : Promise.reject(new Error('terkunci')),
      // GRATIS, jadi tidak ikut penjaga di atas. Peta sudah memintanya untuk
      // menggambar garisnya, dan backend men-cache-nya 15 menit - jadi yang ini
      // hampir selalu dijawab dari cache, bukan dari basis data.
      api.simpulTerdekat(h3),
    ])
      .then(([d, p, c, s]) => {
        if (batal) return
        if (d.status === 'fulfilled') setDetail(d.value)
        else setGalat(d.reason instanceof Error ? d.reason.message : 'gagal memuat')
        setHarga(p.status === 'fulfilled' ? p.value : null)
        setJam(c.status === 'fulfilled' ? c.value : null)
        setKonteks(s.status === 'fulfilled' ? s.value : null)
      })
      .finally(() => !batal && setMemuat(false))

    return () => {
      batal = true
    }
    // `premium` ikut jadi dependensi: begitu langganan aktif, detailnya diminta
    // ULANG supaya 43 variabelnya benar-benar datang. Respons yang sudah ada di
    // state dibuat untuk tingkat yang lama, dan tidak ada cara menambalnya di
    // frontend - isinya memang tidak pernah dikirim.
  }, [h3, premium, terbuka])

  if (!h3)
    return (
      <Ajakan
        judul="Pilih satu heksagon"
        anak="Klik heksagon mana pun di peta untuk melihat skornya, harga sewanya, dan kapan lokasi itu ramai."
      />
    )
  if (memuat) return <Memuat baris={5} />
  if (galat)
    return (
      <Ajakan
        judul="Gagal memuat heksagon"
        anak={galat}
        aksi={
          <code className="mt-1 rounded-xs bg-ground-2 px-1.5 py-0.5 font-mono text-[12.5px] text-ink-2">
            {h3}
          </code>
        }
      />
    )
  if (!detail) return null

  const { skor, indeks, faktor, zoneguard, risiko } = detail

  // Dibaca dari BACKEND, bukan dari `premium` di frontend.
  //
  // Keduanya biasanya sepakat, tetapi ada satu keadaan penting di mana tidak:
  // akun gratis yang sudah membelanjakan token untuk heksagon INI. Backend
  // tahu itu dan mengirim isi penuhnya dengan `terkunci: []`; `premium` di
  // frontend tetap false. Kalau tirainya digambar dari `premium`, orang yang
  // sudah membayar tetap melihat tirai di atas data yang sudah ia beli.
  const terkunci = detail.terkunci.length > 0

  const ajakanBuka = () =>
    akun
      ? mintaLangganan('Bagian ini terbuka untuk pelanggan Loconomics Premium.')
      : mintaMasuk('Buat akun dulu, lalu buka seluruh kedalaman datanya.')

  const terlarang = zoneguard.filter_mutlak
  const tanpaRdtr = zoneguard.status === 'TIDAK_DIKETAHUI'

  return (
    <div key={h3} className="masuk scroll-tipis h-full overflow-y-auto">
      {/* --- Kepala --------------------------------------------------------- */}
      <div className="border-b border-line bg-surface px-4 py-3">
        {/* Nama yang bisa dibaca di depan, indeks H3 di belakangnya dan
            kecil. Indeksnya TETAP ada - ia yang dipakai kalau seseorang perlu
            menelusuri ke basis data - tapi ia bukan yang dicari mata saat
            panel ini terbuka. */}
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-semibold text-ink">
              {kodeLokasi(skor.h3_index, skor.kawasan)}
            </span>
            <code className="block truncate font-mono text-[10.5px] text-ink-3">
              {skor.h3_index}
            </code>
          </span>
          <Badge badge={skor.keyakinan} />
        </div>

        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="flex items-baseline gap-1.5">
              <span
                className={`papan tabular text-[42px] leading-none ${
                  terlarang ? 'text-ink-3 line-through decoration-bahaya decoration-2' : ''
                }`}
              >
                {skor.opportunity_score?.toFixed(0) ?? '—'}
              </span>
              <span className="text-[13px] text-ink-3">/ 100</span>
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
          <p className="mt-2 text-[13.5px] leading-snug text-ink-2">
            {detail.kuadran_penjelasan}
          </p>
        )}

        {/* --- Kenapa kuadrannya begitu --------------------------------------
            Pertanyaan yang paling sering muncul soal layar ini: kenapa skor 58
            bisa Hidden Gem sementara 50 justru Aman tapi Mahal. Jawabannya
            selalu ada tapi tidak pernah terlihat - kuadran ditentukan DUA sumbu,
            dan panel ini cuma pernah menampilkan satu.

            Dua batang di bawah menampilkan keduanya sekaligus dengan mediannya
            sebagai garis tegak. Begitu garisnya terlihat, penempatannya berhenti
            terasa sewenang-wenang. */}
        {posisi?.x != null && posisi.y != null && batas?.x != null && batas.y != null && (
          <div className="mt-3 rounded-sm border border-line/70 bg-surface-2/60 px-3 py-2.5">
            <p className="eyebrow mb-2">Kenapa kuadrannya begitu</p>
            <SumbuKuadran
              label="Skor peluang"
              nilai={posisi.y}
              batas={batas.y}
              maks={100}
              format={(v) => v.toFixed(0)}
              tinggiBaik
            />
            <div className="mt-2">
              <SumbuKuadran
                label="Prestise visual"
                nilai={posisi.x}
                batas={batas.x}
                maks={1}
                format={(v) => v.toFixed(2)}
              />
            </div>
          </div>
        )}
      </div>

      {/* --- Pintasan simulasi ----------------------------------------------
          Ditaruh di paling atas, sebelum satu pun angka.

          Panel ini menjawab "lokasi ini seperti apa"; yang dibawa pelaku UMKM
          ke sini adalah pertanyaan lain: "kalau saya buka di sini, jadinya
          bagaimana". Menyembunyikan jawabannya di kaki panel berarti menuntut
          orang membaca 43 variabel dulu untuk menemukan pertanyaannya sendiri. */}
      {/* --- Aksi berbayar --------------------------------------------------
          Ketiganya SELALU terlihat, juga untuk tamu. Tombol yang disembunyikan
          sampai seseorang berlangganan tidak pernah bisa jadi alasan orang
          berlangganan - ia harus tahu alat itu ada. Yang ditolak adalah
          tindakannya, dengan dialog yang menjelaskan kenapa, bukan tombolnya.

          Yang TIDAK ditawarkan ke tamu: "Pantau". Memantau menuntut tempat
          menyimpan, dan tempat menyimpan menuntut akun. Menawarkannya lalu
          menolaknya adalah janji yang ditarik kembali. */}
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        {/* BANDINGKAN disorot, dua lainnya tidak. Bukan soal selera: dari ketiga
            aksi ini hanya membandingkan yang menuntut langkah KEDUA - orangnya
            harus memilih heksagon lain sesudahnya. Aksi yang menyeret orang ke
            langkah berikutnya harus terlihat sebagai ajakan; yang selesai dalam
            satu klik cukup jadi tombol biasa. */}
        <button
          onClick={() =>
            premium
              ? onBandingkan?.(h3)
              : akun
                ? mintaLangganan('Komparasi berdampingan bagian dari Loconomics Premium.')
                : mintaMasuk('Buat akun dulu untuk membandingkan beberapa lokasi.')
          }
          className={`flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold transition-all duration-300 ease-jelly hover:scale-[1.02] ${
            sedangDibandingkan
              ? 'bg-gem-soft text-gem shadow-[inset_0_0_0_1.5px_var(--color-gem)]'
              : 'bg-ink text-surface shadow-[0_6px_18px_-8px_rgb(22_33_28/0.8)]'
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden className="shrink-0">
            <path d="M4 15V8M10 15V4M16 15v-5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
          </svg>
          {sedangDibandingkan ? 'Ada di baki banding' : 'Bandingkan lokasi ini'}
          {!premium && <Gembok />}
        </button>

        {/* Bulat, ikon saja - bentuk yang sama dengan tombol Tersimpan di bilah
            atas, karena keduanya mengurus benda yang sama. */}
        <TombolBulat
          label={dipantau ? 'Lokasi tersimpan' : 'Simpan lokasi'}
          aktif={dipantau}
          sibuk={aksiSibuk === 'pantau'}
          gembok={!premium}
          onClick={async () => {
            if (!akun) return mintaMasuk('Buat akun dulu untuk menyimpan lokasi.')
            if (!premium)
              return mintaLangganan('Menyimpan dan memantau lokasi bagian dari Loconomics Premium.')
            setAksiSibuk('pantau')
            try {
              await api.pantau(h3)
              setDipantau(true)
              catatSimpan()
              setAksiPesan(
                'Lokasi tersimpan dan skornya dibekukan — perubahan berikutnya dilaporkan di menu Tersimpan.',
              )
            } catch (e) {
              setAksiPesan(e instanceof GalatAPI ? e.message : 'Gagal menambahkan pantauan.')
            } finally {
              setAksiSibuk(null)
            }
          }}
        >
          <path d="M5.5 3.5h9V17L10 13.6 5.5 17Z" fill="currentColor" />
        </TombolBulat>

        <TombolBulat
          label="Unduh Laporan Kelayakan (PDF)"
          sibuk={aksiSibuk === 'laporan'}
          gembok={!premium}
          onClick={async () => {
            if (!akun) return mintaMasuk('Buat akun dulu untuk mengunduh Laporan Kelayakan.')
            setAksiSibuk('laporan')
            try {
              await api.unduhLaporan(h3, skor.kawasan)
              setAksiPesan('Laporan Kelayakan terunduh.')
              await segarkan()
            } catch (e) {
              if (e instanceof GalatAPI && (e.kode === 'BUTUH_PREMIUM' || e.kode === 'TOKEN_TIDAK_CUKUP'))
                mintaLangganan(e.message)
              else setAksiPesan(e instanceof GalatAPI ? e.message : 'Gagal mengunduh laporan.')
            } finally {
              setAksiSibuk(null)
            }
          }}
        >
          <path
            d="M10 3v9m0 0 3.2-3.2M10 12 6.8 8.8M4.5 14.5v1a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-1"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </TombolBulat>
      </div>

      {/* Jalan keluar kedua untuk akun gratis: bayar satu lokasi ini saja. */}
      {akun && !premium && terkunci && (
        <button
          onClick={async () => {
            setAksiSibuk('token')
            try {
              await api.bukaHeksagon(h3)
              tandaiTerbuka(h3)
              await segarkan()
              setDetail(await api.detailHeksagon(h3))
              setAksiPesan('Lokasi ini terbuka permanen untuk akun Anda.')
            } catch (e) {
              if (e instanceof GalatAPI && e.kode === 'TOKEN_TIDAK_CUKUP') mintaLangganan(e.message)
              else setAksiPesan(e instanceof GalatAPI ? e.message : 'Gagal membuka lokasi.')
            } finally {
              setAksiSibuk(null)
            }
          }}
          className="flex w-full cursor-pointer items-center justify-center gap-1.5 border-b border-line bg-surface-2/60 px-4 py-2 text-[11.5px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          {aksiSibuk === 'token'
            ? 'Membuka…'
            : `Buka lokasi ini saja — 1 token (${akun.saldo_token} tersisa)`}
        </button>
      )}

      {aksiPesan && (
        <p
          role="status"
          className="border-b border-line bg-surface-2 px-4 py-2 text-[12.5px] leading-snug text-ink-2"
        >
          {aksiPesan}
        </p>
      )}

      {onBukaSimulasi && (
        <button
          onClick={onBukaSimulasi}
          className="group flex w-full cursor-pointer items-center gap-3 border-b border-line bg-ink px-4 py-3 text-left text-surface transition-all duration-200 ease-jelly hover:brightness-110"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface/15 transition-transform duration-300 ease-jelly group-hover:scale-110">
            <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
              <path
                d="M3 15.5 7 9.5l3.4 3.2L17 4.5"
                stroke="currentColor"
                strokeWidth="1.8"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M12.6 4.5H17v4.4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold leading-tight">
              Simulasi usaha di sini
            </span>
            <span className="block text-[12px] leading-snug text-surface/70">
              Omzet, sewa, dan titik impas dari angka heksagon ini
            </span>
          </span>
          <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden className="shrink-0 transition-transform duration-200 group-hover:translate-x-0.5">
            <path d="M4 1.5 8.5 6 4 10.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {/* --- 0. Jalan kaki ke stasiun --------------------------------------
          Di ATAS ZoneGuard karena ia menjawab pertanyaan yang lebih dulu
          ditanyakan orang saat melihat sebuah titik di peta transit: "ini
          sebenarnya berapa lama jalan kakinya?" - dan jawabannya sering
          mengejutkan.

          Yang ditampilkan waktu dan jarak RUTE, bukan garis lurus. Kalau
          keduanya berselisih jauh, selisih itu ikut dinyatakan: lokasi yang
          terlihat 300 m dari stasiun tetapi butuh berjalan 900 m adalah persis
          "Jebakan Gengsi" versi kaki, dan orang berhak tahu sebelum menyewa. */}
      {konteks?.simpul && !konteks.garis_lurus && konteks.jarak_m !== null && (
        <div className="border-b border-line bg-surface px-4 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="papan tabular text-[19px] leading-none text-ink">
              {Math.round(konteks.menit_jalan ?? 0)}
            </span>
            <span className="text-[12px] text-ink-2">
              menit jalan kaki ke{' '}
              <strong className="font-semibold text-ink">{konteks.simpul.nama}</strong>
            </span>
          </div>
          <p className="mt-1 text-[11.5px] leading-snug text-ink-3">
            {konteks.jarak_m >= 1000
              ? `${(konteks.jarak_m / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} km`
              : `${Math.round(konteks.jarak_m)} m`}{' '}
            lewat jalan yang ada
            {konteks.faktor_memutar && konteks.faktor_memutar >= 1.4 ? (
              <>
                {' '}
                &mdash;{' '}
                <strong className="font-semibold text-hati">
                  {konteks.faktor_memutar.toLocaleString('id-ID', { maximumFractionDigits: 1 })}x
                  lebih jauh dari kelihatannya di peta
                </strong>
                . Ada yang menghalangi jalan langsungnya.
              </>
            ) : (
              '.'
            )}
            {konteks.rute.length > 1 && ` ${konteks.rute.length - 1} jalur alternatif tergambar di peta.`}
          </p>
        </div>
      )}

      {/* --- 1. ZoneGuard ---------------------------------------------------
          Zona yang DIIZINKAN kini ikut dinyatakan, tidak lagi diam.
          Sebelumnya bagian ini hanya muncul untuk zona terlarang atau tanpa
          RDTR, jadi lokasi yang izinnya justru bersih tidak menampilkan apa pun
          soal zonasi - dan pembacanya tidak bisa membedakan "sudah diperiksa,
          aman" dari "belum diperiksa". Untuk fitur yang tabelnya menjanjikan
          "status zonasi" ke tingkat gratis, diam bukan jawaban. */}
      {!terlarang && !tanpaRdtr && (
        <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2">
          <span
            aria-hidden
            className="grid h-4 w-4 shrink-0 place-items-center rounded-xs bg-gem text-white"
          >
            <svg width="9" height="9" viewBox="0 0 20 20">
              <path
                d="m4 10.5 4 4 8-9"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="text-[12.5px] leading-snug text-ink-2">
            <strong className="font-semibold text-ink">ZoneGuard — zona mengizinkan usaha</strong>
            {zoneguard.kelas_zona && (
              <span className="text-ink-3"> · kelas {zoneguard.kelas_zona}</span>
            )}
          </span>
        </div>
      )}

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
                className={`text-[14px] font-semibold ${terlarang ? 'text-bahaya' : 'text-ink'}`}
              >
                {terlarang ? 'ZoneGuard — tidak boleh dipakai usaha' : 'Belum ada RDTR digital'}
              </p>
              <p className="mt-0.5 text-[13.5px] leading-snug text-ink-2">
                {zoneguard.penjelasan}
              </p>
              {zoneguard.kelas_zona && (
                <p className="mt-1 font-mono text-[12.5px] text-ink-3">
                  Kelas zona {zoneguard.kelas_zona}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- 2. PriceLens ---------------------------------------------------
          BERBAYAR sejak 23 Agustus 2026 - keputusan pemilik repo. Peta harga
          (layer PriceLens) tetap gratis; yang berbayar kartu rinciannya:
          sewa/bulan, NJOP, dan posisi terhadap rentang wajar kawasan. */}
      <Bagian judul="PriceLens — harga sewa">
        {terkunci ? (
          <Terkunci
            judul="Rincian harga lokasi ini"
            kalimat="Sewa per m² dan posisinya di rentang wajar kawasan, sewa per bulan, belanja per jam, dan NJOP."
            labelAksi="Gabung Loconomics Premium"
            baris={4}
            onBuka={ajakanBuka}
            aksiKedua={
              akun ? (
                <button
                  onClick={ajakanBuka}
                  className="cursor-pointer text-[11.5px] text-ink-3 underline underline-offset-2 hover:text-ink-2"
                >
                  atau buka lokasi ini saja dengan 1 token
                </button>
              ) : undefined
            }
          />
        ) : harga ? (
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
            <span className="rounded-xs bg-surface-2 px-1.5 py-0.5 text-[12px] font-semibold text-ink-2">
              {jam.dominasi === 'captive'
                ? 'Didominasi captive'
                : jam.dominasi === 'choice'
                  ? 'Didominasi choice'
                  : 'Seimbang'}
            </span>
          )
        }
      >
        {terkunci ? (
          <Terkunci
            judul="Pola jam lokasi ini"
            kalimat="Grafik 18 jam: kapan uangnya berpindah, jam puncaknya, dan pembagian captive vs choice rider."
            labelAksi="Gabung Loconomics Premium"
            baris={4}
            onBuka={ajakanBuka}
          />
        ) : jam ? (
          <>
            <ChartJam jam={jam.jam} jamPuncak={jam.jam_puncak} />
            <p className="mt-2 text-[13.5px] leading-snug text-ink-2">
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
              <p className="mt-1.5 flex gap-1.5 text-[13px] leading-snug text-ink-3">
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

      {/* --- 4. RiskRadar ---------------------------------------------------
          Tiga keadaan, bukan dua. `AMAN` sengaja diam — peringatan yang selalu
          muncul berhenti dibaca. `TIDAK_DIKETAHUI` TIDAK boleh ikut diam:
          diam di situ berarti pembaca menyimpulkan "sudah diperiksa, aman"
          dari sesuatu yang tidak pernah diperiksa. Ia dapat satu baris tenang,
          persis seperti zona RDTR yang diizinkan. */}
      {risiko.tingkat === 'TIDAK_DIKETAHUI' && (
        <Bagian judul="RiskRadar — pergantian usaha">
          <Kosong teks="Data pergantian usaha belum ada — lokasi ini belum bisa dinilai risikonya" />
        </Bagian>
      )}

      {(risiko.tingkat === 'WASPADA' || risiko.tingkat === 'BAHAYA') && (
        <Bagian judul="RiskRadar — pergantian usaha">
          <div className="flex gap-2.5 rounded-sm border border-bahaya/25 bg-bahaya-soft p-2.5">
            <span
              aria-hidden
              className={`mt-0.5 h-4 w-4 shrink-0 rounded-xs ${
                risiko.tingkat === 'BAHAYA' ? 'bg-bahaya' : 'border-2 border-bahaya'
              }`}
            />
            <div>
              <p className="text-[14px] font-semibold text-bahaya">{risiko.label}</p>
              <p className="mt-0.5 text-[13.5px] leading-snug text-ink-2">
                Usaha di sini lebih sering berganti daripada kebanyakan area lain di
                kawasan yang sama. Itu tanda lokasi yang terus-menerus membuat
                penyewanya menyerah.
              </p>
            </div>
          </div>
        </Bagian>
      )}

      {/* --- 5. Empat indeks ------------------------------------------------ */}
      {/* --- Empat hal yang dinilai ----------------------------------------
          Ditulis ulang 30 Agustus 2026, dan yang berubah bukan cuma kata-katanya.

          Versi lama menampilkan empat angka desimal - "akses ke stasiun 0,79",
          "biaya dan risiko 0,49" - dengan keterangan "tinggi = buruk" di
          sebagiannya. Dua hal salah sekaligus di situ.

          Pertama, angkanya tidak menjawab pertanyaan siapa pun. Orang yang
          sedang menimbang ruko tidak bertanya "berapa indeks potensi transit
          di sini", ia bertanya "berapa menit jalan kaki ke stasiun" - dan
          angka itu ADA, sudah diambil, dan sudah tampil beberapa baris di atas.

          Kedua, dan ini yang lebih serius: variabel kosong DINETRALKAN ke 0,5,
          bukan dinolkan. Terukur atas 708 heksagon, hanya 1% bobot "perputaran
          uang" dan 5% bobot "biaya dan risiko" yang benar-benar berasal dari
          pengukuran. Sisanya nilai tengah. Jadi "0,487" di layar berarti
          "belum diketahui", dan tidak ada satu pun cara pembacanya bisa tahu.
          Itu keluarga kesalahan yang sama dengan badge yang dulu mengaku
          disurvei dan RiskRadar yang menyebut AMAN untuk lokasi tanpa data.

          Sekarang: kata, bukan desimal; angka sungguhan kalau ada; dan indeks
          yang bahannya belum terukur MENGATAKANNYA. */}
      <Bagian judul="Empat hal yang dinilai">
        <p className="mb-3 text-[13px] leading-relaxed text-ink-2">
          Skor lokasi ini disusun dari empat hal di bawah. Semuanya dihitung di
          luar aplikasi, sekali, dari data yang bisa ditunjuk sumbernya — bukan
          dikarang saat Anda membukanya.
        </p>
        {(
          [
            ['IPT', indeks.ipt],
            ['IAE', indeks.iae],
            ['IKP', indeks.ikp],
            ['IBR', indeks.ibr],
          ] as const
        ).map(([kode, nilai]) => {
          const cakupan = indeks.cakupan?.[kode]
          // Belum layak tampil = bahannya nyaris seluruhnya kosong. Angkanya
          // ADA (0,487) tetapi ia nilai tengah, bukan temuan.
          const terukur = cakupan ? cakupan.layak_tampil : nilai !== null
          const kata = terukur ? kataIndeks(kode, nilai) : null
          const baik = TINGGI_BAIK[kode]
          // Angka sungguhan yang sudah kita punya, gratis, untuk baris ini.
          const fakta =
            kode === 'IPT' && konteks?.simpul && konteks.menit_jalan !== null
              ? `${Math.round(konteks.menit_jalan)} menit jalan kaki ke ${konteks.simpul.nama}`
              : null

          return (
            <div key={kode} className="border-t border-line-2 py-2.5 first:border-t-0 first:pt-0">
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="text-[14px] font-medium text-ink first-letter:uppercase">
                  {ARTI_INDEKS[kode]}
                </span>
                {kata ? (
                  <span className="shrink-0 text-[14px] font-semibold text-ink">{kata}</span>
                ) : (
                  <span className="shrink-0 text-[13px] text-ink-3">Belum terukur</span>
                )}
              </div>
              <p className="mb-1.5 text-[12.5px] leading-snug text-ink-3">
                {TANYA_INDEKS[kode]}
              </p>
              {terukur ? (
                <>
                  <div className="h-1.5 overflow-hidden rounded-full bg-ground-2">
                    <div
                      className={`h-full rounded-full ${baik ? 'bg-ink' : 'bg-ink-3'}`}
                      style={{ width: `${Math.min(100, Math.max(3, (nilai ?? 0) * 100))}%` }}
                    />
                  </div>
                  {fakta && (
                    <p className="mt-1.5 text-[12.5px] text-ink-2">
                      <strong className="font-semibold text-ink">{fakta}</strong>
                    </p>
                  )}
                  {cakupan && cakupan.terukur < cakupan.total && (
                    <p className="mt-1 text-[12px] leading-snug text-ink-3">
                      {cakupan.terukur} dari {cakupan.total} bahannya sudah terukur. Belum ada:{' '}
                      {cakupan.kosong.map((k) => keKalimat(ARTI_KODE[k] ?? k)).join(', ')}.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-[12.5px] leading-snug text-ink-3">
                  {cakupan
                    ? `Butuh survei lapangan dulu. Belum ada: ${cakupan.kosong
                        .map((k) => keKalimat(ARTI_KODE[k] ?? k))
                        .join(', ')}.`
                    : 'Datanya belum ada untuk lokasi ini.'}
                </p>
              )}
            </div>
          )
        })}
      </Bagian>

      {/* --- 6. Faktor ------------------------------------------------------
          Bagian ini dan yang di bawahnya BERBAYAR. Tabel fitur menempatkan
          "pembongkaran data mendalam hingga variabel granular pembentuk indeks"
          di kolom berbayar; ringkasan di atas - skor, kuadran, Commuter Clock,
          RiskRadar, ZoneGuard - tetap gratis dan tidak pernah tertutup tirai. */}
      {terkunci ? (
        <Bagian judul="Kenapa skornya segitu">
          <Terkunci
            judul="Pembongkaran skor"
            kalimat="Lihat angka mana yang menaikkan dan menurunkan skor lokasi ini, dan seberapa jauh posisinya dibanding lokasi lain."
            labelAksi="Gabung Loconomics Premium"
            baris={4}
            onBuka={ajakanBuka}
            aksiKedua={
              <button
                onClick={ajakanBuka}
                className="cursor-pointer text-[11.5px] text-ink-3 underline underline-offset-2 hover:text-ink-2"
              >
                atau buka lokasi ini saja dengan 1 token
              </button>
            }
          />
        </Bagian>
      ) : (
        faktor.length > 0 && (
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
                <span className="flex-1 text-[14px] leading-snug text-ink-2">
                  <span title={`${f.kode_variabel} · ${f.indeks}`}>
                    {ARTI_KODE[f.kode_variabel] ?? f.kode_variabel}
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
                <span className="tabular shrink-0 text-[13px] text-ink-3">
                  {ARTI_INDEKS[f.indeks]}
                </span>
              </li>
            ))}
          </ul>
        </Bagian>
        )
      )}

      {/* --- 7. Variabel lengkap -------------------------------------------- */}
      {terkunci ? (
        <Bagian judul="Seluruh 43 angka lokasi ini">
          <Terkunci
            judul="Seluruh 43 angka lokasi ini"
            kalimat="Semua angka yang dipakai menilai lokasi ini — orang di sekitarnya, kebiasaan belanjanya, pesaingnya, biayanya, risikonya, dan bentuk bangunannya."
            labelAksi="Gabung Loconomics Premium"
            baris={6}
            onBuka={ajakanBuka}
          />
        </Bagian>
      ) : (
      <Bagian judul="Seluruh 43 angka lokasi ini">
        <details className="group">
          <summary className="cursor-pointer list-none text-[14px] text-ink-2 underline decoration-line-2 underline-offset-2 hover:text-ink">
            Tampilkan tabel lengkap
          </summary>
          {/* Tabel data adalah jalur alternatif untuk grafik di atas — pembaca
              layar dan pengguna yang tidak membedakan warna tetap bisa membaca
              seluruh angkanya. */}
          <div className="scroll-tipis mt-2 max-h-64 overflow-y-auto rounded-sm border border-line">
            <table className="w-full text-[13px]">
              <tbody>
                {Object.entries(detail.variabel).map(([nama, nilai], i) => {
                  // Nama benda, bukan nama kolom. "pop 100m" tidak berarti apa
                  // pun bagi calon pemilik warung; "Penduduk di sekitar"
                  // berarti. Kodenya tetap ada sebagai judul tooltip untuk yang
                  // perlu menelusuri ke Kamus Data.
                  const arti = ARTI_VARIABEL[nama]
                  return (
                    <tr key={nama} className={i % 2 ? 'bg-surface-2' : ''}>
                      <td className="px-2 py-1 text-ink-2" title={arti?.kode ?? nama}>
                        {arti?.nama ?? nama.replace(/_/g, ' ')}
                      </td>
                      <td className="tabular px-2 py-1 text-right whitespace-nowrap">
                        {nilai === null || nilai === undefined ? (
                          <Kosong teks="—" />
                        ) : typeof nilai === 'boolean' ? (
                          nilai ? 'ya' : 'tidak'
                        ) : typeof nilai === 'number' ? (
                          <>
                            {angka(nilai, nilai < 10 ? 2 : 0)}
                            {arti?.satuan && (
                              <span className="ml-1 text-[11px] font-normal text-ink-3">
                                {arti.satuan}
                              </span>
                            )}
                          </>
                        ) : (
                          String(nilai)
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </details>
      </Bagian>
      )}

      {/* --- 8. Riwayat skor (berbayar) ------------------------------------ */}
      <Bagian judul="Riwayat perubahan skor">
        <BagianRiwayat h3={h3} />
      </Bagian>

      <p className="px-4 pb-6 pt-1 text-[12.5px] leading-snug text-ink-3">
        Angka di kartu ini dihitung sekali oleh pipeline dan dibaca apa adanya.
        Informasi untuk pertimbangan, bukan nasihat investasi.
      </p>
    </div>
  )
}

/** Gembok kecil, dipakai di dalam tombol yang belum terbuka. */
function Gembok() {
  return (
    <svg width="10" height="10" viewBox="0 0 20 20" aria-hidden className="shrink-0 opacity-70">
      <path d="M6 9V6.5a4 4 0 0 1 8 0V9" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="4.5" y="9" width="11" height="7.5" rx="2" fill="currentColor" />
    </svg>
  )
}

/**
 * Tombol aksi berbentuk lingkaran.
 *
 * `gembok` menandai yang belum terbuka tetapi TIDAK menonaktifkan tombolnya:
 * tombol mati tidak bisa menjelaskan dirinya, dan yang dibutuhkan orang yang
 * menekannya justru penjelasan. Yang ditekan tetap merespons — dengan dialog
 * yang mengatakan apa yang kurang.
 */
function TombolBulat({
  label,
  onClick,
  aktif,
  sibuk,
  gembok,
  children,
}: {
  label: string
  onClick: () => void
  aktif?: boolean
  sibuk?: boolean
  gembok?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={sibuk}
      title={label}
      aria-label={label}
      className={`relative grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full border transition-all duration-300 ease-jelly hover:scale-105 disabled:cursor-wait disabled:opacity-60 ${
        aktif
          ? 'border-gem bg-gem-soft text-gem'
          : 'border-line text-ink-2 hover:border-line-2 hover:text-ink'
      }`}
    >
      {sibuk ? (
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-line-2 border-t-ink" />
      ) : (
        <svg width="17" height="17" viewBox="0 0 20 20" aria-hidden>
          {children}
        </svg>
      )}
      {gembok && !sibuk && (
        <span className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-surface text-ink-3 shadow-[0_0_0_1px_var(--color-line)]">
          <Gembok />
        </span>
      )}
    </button>
  )
}
