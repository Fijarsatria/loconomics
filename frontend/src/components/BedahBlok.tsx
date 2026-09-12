/**
 * Bedah heksagon jadi tujuh blok res-10.
 *
 * Pertanyaan yang dijawab berkas ini cuma satu, dan ia pertanyaan pertama yang
 * diajukan hampir setiap orang yang melihat peta heksagon: heksagon res-9
 * bergaris tengah ±350 m, jadi satu petak memuat sisi yang menempel jalan
 * besar DAN gang buntu di belakangnya — dan keduanya mendapat satu skor yang
 * sama. "Lokasi ini bagus" jadi pernyataan yang benar untuk sepertujuh
 * heksagonnya saja.
 *
 * Jawabannya BUKAN memperhalus grid. Mengubah res-9 jadi res-10 membuang 708
 * heksagon, 1.587 rute ORS, dan tiap variabel yang sudah terkumpul — dan
 * menukar satu masalah dengan masalah yang sama pada skala yang lebih kecil,
 * karena res-10 pun masih memuat dua sisi jalan. Yang dilakukan di sini:
 * heksagon tetap unit analisisnya, dan blok dipanggil saat diminta sebagai
 * pembanding DI DALAM satu heksagon.
 *
 * Tiga hal yang sengaja TIDAK dilakukan komponen ini:
 *
 *   Tidak menghitung apa pun. Ketujuh skor, peringkat, alasan, dan
 *   peringatannya datang jadi dari `/hex/{h3}/blok`; yang dihitung di sini cuma
 *   selisih terbesar-terkecil untuk satu kalimat keterangan, dan itu bukan skor
 *   karena ia tidak memeringkat apa pun (aturan 1).
 *
 *   Tidak memakai peringkat sebagai warna. Lihat `WARNA_BLOK` di
 *   `lib/layer-peta.ts` — alasannya panjang dan penting.
 *
 *   Tidak mengganti heksagon terpilih. Mengklik blok memilih BLOK; panel di
 *   atasnya tetap membicarakan heksagon yang sama. Kalau memilih blok ikut
 *   memindahkan pilihan heksagon, seluruh panel akan dimuat ulang tiap kali
 *   orangnya membandingkan dua blok bersebelahan.
 */

import { useEffect, useRef, useState } from 'react'

import { api, GalatAPI } from '../lib/api'
import { useTeks } from '../lib/bahasa'
import { angka, jarakSingkat } from '../lib/format'
import type { BedahBlok as BedahBlokT, BlokDalamHeksagon } from '../types'
import { Badge, Memuat, Rinci } from './primitif'

/** Tanda minus tipografis (U+2212), bukan hubung. Ditulis sebagai konstanta
 *  supaya ia tidak perlu ditempel sebagai escape di dalam teks JSX - di sana
 *  escape unicode tidak pernah ditafsirkan. */
const MINUS = '−'

/** Nilai `kelas` yang berarti "tanpa kelas usaha tertentu". */
const UMUM = '_umum'

const K = {
  id: {
    buka: 'Bedah jadi 7 blok (±130 m)',
    tutup: 'Sembunyikan blok',
    memuat: 'Membedah heksagon…',
    gagal: 'Blok heksagon ini belum bisa ditampilkan.',
    kelasLabel: 'Untuk jenis usaha',
    umum: 'Semua jenis usaha',
    umumCatatan: 'Tanpa memperhitungkan pesaing sekelas',
    blokKe: (n: number) => `Blok #${n}`,
    // Kalimat selisih: PEMICUNYA dihitung dari data, jadi kalimatnya dihitung
    // juga. Menulisnya tetap ("blok terbaik jauh lebih baik") akan berbohong
    // untuk heksagon yang ketujuh bloknya memang mirip - dan itu mayoritasnya.
    rentangSempit: (r: string) =>
      `Ketujuh blok praktis setara — selisih terbaik dan terlemah hanya ${r} poin. Di heksagon ini letak persisnya bukan penentu; pilih yang sewanya paling wajar.`,
    rentangSedang: (r: string) =>
      `Selisih blok terbaik dan terlemah ${r} poin. Cukup untuk jadi pertimbangan, belum cukup untuk membatalkan pilihan kalau sewanya jauh lebih murah.`,
    rentangLebar: (r: string) =>
      `Selisih blok terbaik dan terlemah ${r} poin. Di heksagon ini sisi mana yang Anda ambil menentukan — satu alamat bisa jauh lebih baik daripada alamat di seberangnya.`,
    tabel: 'Bandingkan angkanya',
    kMenit: 'mnt',
    kJalan: 'ke jalan',
    kUsaha: 'usaha',
    kPenarik: 'penarik',
    kHalte: 'halte',
    kolMenit: 'Jalan kaki ke simpul',
    kolJalan: 'Jarak ke jalan utama',
    kolUsaha: 'Usaha dalam 150 m',
    kolPenarik: 'Penarik dalam 250 m',
    kolHalte: 'Jarak halte terdekat',
    kosong: '—',
    petunjuk: 'Klik satu blok untuk menyorotnya di peta.',
    kenapa: 'Kenapa skornya segini',
    menekan: 'menekan skor',
    dataBlok: 'Data blok ini',
    kZona: 'Zona RDTR',
    kBangunan: 'Bangunan terpetakan',
    kTutupan: 'Tutupan bangunan',
    kPesaing: 'Pesaing sekelas dalam 150 m',
    kSkorUmum: 'Skor tanpa kelas usaha',
    takAda: 'belum ada data',
  },
  en: {
    buka: 'Split into 7 blocks (±130 m)',
    tutup: 'Hide blocks',
    memuat: 'Splitting the hexagon…',
    gagal: 'The blocks for this hexagon cannot be shown yet.',
    kelasLabel: 'For this business type',
    umum: 'All business types',
    umumCatatan: 'Same-type competitors not counted',
    blokKe: (n: number) => `Block #${n}`,
    rentangSempit: (r: string) =>
      `All seven blocks are practically equal — only ${r} points between best and weakest. Inside this hexagon the exact spot is not the deciding factor; take the one with the fairest rent.`,
    rentangSedang: (r: string) =>
      `${r} points between the best and the weakest block. Enough to weigh, not enough to rule a spot out if its rent is far lower.`,
    rentangLebar: (r: string) =>
      `${r} points between the best and the weakest block. Which side you take here decides it — one address can be far better than the one across the street.`,
    tabel: 'Compare the numbers',
    kMenit: 'min',
    kJalan: 'to road',
    kUsaha: 'shops',
    kPenarik: 'draws',
    kHalte: 'stop',
    kolMenit: 'Walk to the node',
    kolJalan: 'Distance to a main road',
    kolUsaha: 'Businesses within 150 m',
    kolPenarik: 'Crowd generators within 250 m',
    kolHalte: 'Nearest transit stop',
    kosong: '—',
    petunjuk: 'Click a block to highlight it on the map.',
    kenapa: 'Why this score',
    menekan: 'pushes the score down',
    dataBlok: 'This block\u2019s data',
    kZona: 'RDTR zoning',
    kBangunan: 'Buildings mapped',
    kTutupan: 'Built-up ratio',
    kPesaing: 'Same-type competitors within 150 m',
    kSkorUmum: 'Score without a business type',
    takAda: 'no data yet',
  },
}

/** Di bawah ini selisihnya tidak layak dipakai memilih; di atas yang kedua ia menentukan. */
const RENTANG_SEMPIT = 5
const RENTANG_LEBAR = 15

/**
 * Pemilih kelas usaha, SELEBAR panel.
 *
 * `Menu` di `primitif.tsx` sengaja tidak dipakai di sini walaupun isinya sama:
 * ia dibuat untuk BILAH ATAS - pil yang lebarnya mengikuti isinya, labelnya
 * disembunyikan di bawah 2xl, catatannya di bawah lg, dan daftarnya
 * berjangkar ke kanan. Di dalam panel selebar 26rem, di bawah tombol yang
 * selebar penuh, ia berdiri pendek dan bertepi kanan - "bar nya kayak ga rapih
 * dengan bar utamanya", dilaporkan pemilik repo 13 Sep 2026.
 *
 * Yang di sini mengikuti tombol di atasnya: lebar penuh, sudut yang sama,
 * daftar yang juga selebar penuh.
 */
function PilihKelas({
  label,
  nilai,
  opsi,
  onUbah,
}: {
  label: string
  nilai: string
  opsi: { nilai: string; label: string; catatan?: string }[]
  onUbah: (v: string) => void
}) {
  const [buka, setBuka] = useState(false)
  const wadah = useRef<HTMLDivElement>(null)
  const terpilih = opsi.find((o) => o.nilai === nilai)

  useEffect(() => {
    if (!buka) return
    const luar = (e: MouseEvent) => {
      if (!wadah.current?.contains(e.target as Node)) setBuka(false)
    }
    const kunci = (e: KeyboardEvent) => e.key === 'Escape' && setBuka(false)
    document.addEventListener('mousedown', luar)
    document.addEventListener('keydown', kunci)
    return () => {
      document.removeEventListener('mousedown', luar)
      document.removeEventListener('keydown', kunci)
    }
  }, [buka])

  return (
    <div ref={wadah} className="relative">
      <p className="eyebrow mb-1.5">{label}</p>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={buka}
        aria-label={`${label}: ${terpilih?.label ?? ''}`}
        onClick={() => setBuka((v) => !v)}
        className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-[13.5px] transition-colors ${
          buka ? 'border-ink-3 bg-surface' : 'border-line bg-surface-2 hover:border-ink-3'
        }`}
      >
        <span className="min-w-0">
          <span className="block truncate font-medium text-ink">{terpilih?.label ?? '—'}</span>
          {terpilih?.catatan && (
            <span className="block truncate text-[11.5px] text-ink-3">{terpilih.catatan}</span>
          )}
        </span>
        <svg
          width="11"
          height="11"
          viewBox="0 0 10 10"
          aria-hidden
          className={`shrink-0 text-ink-3 transition-transform duration-200 ease-liquid ${buka ? 'rotate-180' : ''}`}
        >
          <path d="M1 3.5 5 7.5 9 3.5" stroke="currentColor" strokeWidth="1.7" fill="none" />
        </svg>
      </button>
      {buka && (
        <ul
          role="listbox"
          aria-label={label}
          className="kaca-tebal melayang absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[15rem] overflow-auto rounded-lg p-1"
        >
          {opsi.map((o) => (
            <li key={o.nilai}>
              <button
                type="button"
                role="option"
                aria-selected={o.nilai === nilai}
                onClick={() => {
                  onUbah(o.nilai)
                  setBuka(false)
                }}
                className={`w-full cursor-pointer rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                  o.nilai === nilai ? 'bg-gem-soft text-gem' : 'text-ink-2 hover:bg-surface-2'
                }`}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function BedahBlok({
  h3,
  data,
  onData,
  terpilih,
  onPilih,
}: {
  h3: string
  /** Hasil bedah yang sedang tergambar di peta. Dimiliki App — peta memakainya juga. */
  data: BedahBlokT | null
  onData: (d: BedahBlokT | null) => void
  terpilih: string | null
  onPilih: (h3Blok: string | null) => void
}) {
  const t = useTeks(K)
  const [kelas, setKelas] = useState<string>(UMUM)
  const [memuat, setMemuat] = useState(false)
  const [galat, setGalat] = useState<string | null>(null)
  /**
   * Permintaan terakhir menang.
   *
   * Mengganti kelas usaha dua kali dengan cepat mengirim dua permintaan, dan
   * yang lebih dulu berangkat tidak selalu lebih dulu pulang. Tanpa penanda
   * ini, peta bisa berakhir memegang peringkat untuk kelas yang TIDAK sedang
   * tertulis di pemilihnya — salah tanpa satu pun galat.
   */
  const permintaan = useRef(0)

  const ambil = async (k: string) => {
    const nomor = ++permintaan.current
    setMemuat(true)
    setGalat(null)
    try {
      const d = await api.blokHeksagon(h3, k === UMUM ? null : k)
      if (nomor !== permintaan.current) return
      onData(d)
    } catch (e) {
      if (nomor !== permintaan.current) return
      onData(null)
      setGalat(e instanceof GalatAPI ? e.message : t.gagal)
    } finally {
      if (nomor === permintaan.current) setMemuat(false)
    }
  }

  const tutup = () => {
    permintaan.current++
    setMemuat(false)
    setGalat(null)
    onPilih(null)
    onData(null)
  }

  const gantiKelas = (k: string) => {
    setKelas(k)
    // Hanya kalau bloknya SEDANG tergambar. Mengganti kelas di panel yang
    // tertutup lalu menariknya diam-diam berarti satu permintaan jaringan
    // untuk sesuatu yang tidak dilihat siapa pun.
    if (data) void ambil(k)
  }

  if (!data) {
    return (
      <>
        <button
          onClick={() => void ambil(kelas)}
          disabled={memuat}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[13.5px] font-semibold text-surface transition-all duration-300 ease-jelly hover:scale-[1.015] disabled:cursor-wait disabled:opacity-60"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
            <path
              d="M8 1.6 13.6 4.8v6.4L8 14.4 2.4 11.2V4.8Z M8 1.6V8 M8 8l5.6 3.2 M8 8 2.4 11.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {memuat ? t.memuat : t.buka}
        </button>
        {memuat && <Memuat baris={3} teks={t.memuat} />}
        {galat && <p className="mt-2 text-[13px] leading-snug text-bahaya">{galat}</p>}
      </>
    )
  }

  const nilai = data.blok.map((b) => b.skor).filter((s): s is number => s != null)
  const rentang = nilai.length > 1 ? Math.max(...nilai) - Math.min(...nilai) : null
  const rentangTeks = rentang == null ? null : (angka(rentang, 1) ?? String(rentang))
  const kalimatRentang =
    rentang == null || rentangTeks == null
      ? null
      : rentang < RENTANG_SEMPIT
        ? t.rentangSempit(rentangTeks)
        : rentang > RENTANG_LEBAR
          ? t.rentangLebar(rentangTeks)
          : t.rentangSedang(rentangTeks)

  const opsi = [
    { nilai: UMUM, label: t.umum, catatan: t.umumCatatan },
    ...Object.entries(data.kelas_tersedia).map(([k, nama]) => ({ nilai: k, label: nama })),
  ]

  return (
    <>
      <button
        onClick={tutup}
        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-line bg-surface-2 px-4 py-2.5 text-[13.5px] font-semibold text-ink-2 transition-all duration-300 ease-jelly hover:text-ink"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
          <path
            d="M8 1.6 13.6 4.8v6.4L8 14.4 2.4 11.2V4.8Z M3 3l10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {t.tutup}
      </button>

      <div className="mt-3">
        <PilihKelas label={t.kelasLabel} nilai={kelas} opsi={opsi} onUbah={gantiKelas} />
      </div>

      {kalimatRentang && (
        <p className="mt-2.5 text-[13px] leading-snug text-ink-2">{kalimatRentang}</p>
      )}

      {memuat ? (
        <Memuat baris={3} teks={t.memuat} />
      ) : (
        <ul className="mt-2.5 flex flex-col gap-1.5">
          {data.blok.map((b) => (
            <Blok
              key={b.h3_blok}
              b={b}
              t={t}
              aktif={terpilih === b.h3_blok}
              onPilih={() => onPilih(terpilih === b.h3_blok ? null : b.h3_blok)}
            />
          ))}
        </ul>
      )}

      <p className="mt-2 text-[11.5px] text-ink-3">{t.petunjuk}</p>

      <Rinci ringkas={t.tabel}>
        <Tabel blok={data.blok} t={t} />
      </Rinci>

      <div className="mt-2.5 flex items-start gap-2">
        <Badge badge={data.keyakinan} ringkas />
      </div>
      <p className="mt-1.5 text-[11.5px] leading-snug text-ink-3">{data.catatan}</p>
    </>
  )
}

function Blok({
  b,
  t,
  aktif,
  onPilih,
}: {
  b: BlokDalamHeksagon
  t: typeof K.id
  aktif: boolean
  onPilih: () => void
}) {
  const dilarang = b.izin_komersial === false
  return (
    <li>
      <button
        onClick={onPilih}
        aria-pressed={aktif}
        className={`w-full cursor-pointer rounded-lg border px-2.5 py-2 text-left transition-all duration-300 ease-jelly ${
          aktif
            ? 'border-gem bg-gem-soft/40'
            : 'border-line hover:border-ink-3'
        }`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-baseline gap-2">
            <span
              className={`grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                dilarang ? 'bg-bahaya text-surface' : 'bg-ground-2 text-ink-2'
              }`}
              aria-hidden
            >
              {b.peringkat}
            </span>
            <span className="truncate text-[13.5px] text-ink">
              {b.nama_jalan_utama ?? t.blokKe(b.peringkat)}
            </span>
          </span>
          <span className="shrink-0 font-mono text-[13.5px] font-semibold text-ink">
            {angka(b.skor, 1) ?? t.kosong}
          </span>
        </div>
        {/* Alasan dari backend, bukan dirangkai di sini: kalimat yang sama
            dicetak Laporan PDF dan diucapkan Konsultan AI. */}
        {b.alasan.length > 0 && (
          <p className="mt-0.5 text-[12px] leading-snug text-ink-3">
            {b.alasan.slice(0, 2).join(' · ')}
          </p>
        )}
        {b.peringatan.length > 0 && (
          <p className="mt-0.5 text-[12px] leading-snug text-jebakan">{b.peringatan[0]}</p>
        )}
      </button>

      {/* Rincian dibuka HANYA untuk blok yang sedang dipilih.
          Tujuh blok yang semuanya terbuka berarti empat puluh sembilan baris
          angka sekaligus, dan daftar sepanjang itu berhenti bisa dibandingkan -
          yang justru satu-satunya gunanya. */}
      {aktif && <RincianBlok b={b} t={t} />}
    </li>
  )
}

/**
 * Kenapa skor blok ini segitu, dan data mentahnya.
 *
 * Sumbangan tiap indikator DIHITUNG PIPELINE (`s6_score.skor_blok`) dan dibaca
 * apa adanya di sini - aturan 1. Batangnya memakai `pangsa`, bukan `nilai`,
 * supaya bisa dibandingkan antar-indikator tanpa pembacanya perlu tahu bobot
 * mana yang 0,30 dan mana yang 0,10.
 */
function RincianBlok({ b, t }: { b: BlokDalamHeksagon; t: typeof K.id }) {
  const sisa = b.alasan.slice(2)
  return (
    <div className="mt-1.5 rounded-lg border border-line bg-surface-2/60 px-2.5 py-2.5">
      {b.kontribusi.length > 0 && (
        <>
          <p className="eyebrow mb-1.5">{t.kenapa}</p>
          <ul className="flex flex-col gap-1">
            {b.kontribusi.map((k) => (
              <li key={k.kode} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{k.nama}</span>
                <span className="h-[7px] w-[46%] shrink-0 overflow-hidden rounded-full bg-ground-2">
                  <span
                    className={`block h-full rounded-full ${k.nilai < 0 ? 'bg-bahaya' : 'bg-gem'}`}
                    style={{ width: `${Math.min(100, Math.abs(k.pangsa) * 100)}%` }}
                  />
                </span>
                <span className="tabular w-[3.2rem] shrink-0 text-right text-[11.5px] text-ink-3">
                  {k.nilai < 0 ? '\u2212' : ''}
                  {Math.round(Math.abs(k.pangsa) * 100)}%
                </span>
              </li>
            ))}
          </ul>
          {b.kontribusi.some((k) => k.nilai < 0) && (
            <p className="mt-1 text-[11px] text-ink-3">
              {/* Dalam TEKS JSX, escape unicode BUKAN escape - ia ditulis apa
                  adanya. Ia hanya ditafsirkan di dalam literal string, jadi
                  tandanya dipasang sebagai ekspresi. */}
              <span className="text-bahaya">{MINUS}</span> {t.menekan}
            </p>
          )}
        </>
      )}

      <p className="eyebrow mb-1.5 mt-3">{t.dataBlok}</p>
      <ul className="flex flex-col gap-0.5 text-[12px]">
        {[
          [t.kZona, b.kelas_zona ?? t.takAda],
          [t.kBangunan, `${b.n_bangunan}`],
          [
            t.kTutupan,
            b.rasio_tutupan_bangunan == null
              ? t.takAda
              : `${angka(b.rasio_tutupan_bangunan * 100, 0)} %`,
          ],
          [t.kPesaing, b.n_pesaing_150m == null ? t.takAda : `${b.n_pesaing_150m}`],
          [t.kSkorUmum, angka(b.skor_umum, 1) ?? t.takAda],
        ].map(([label, nilai]) => (
          <li key={label} className="flex items-baseline justify-between gap-3">
            <span className="text-ink-3">{label}</span>
            <span className="tabular text-right text-ink-2">{nilai}</span>
          </li>
        ))}
      </ul>

      {/* Sisa alasan yang tidak muat di baris ringkasnya. Kalimatnya dari
          backend - yang sama dengan yang dicetak Laporan PDF. */}
      {sisa.length > 0 && (
        <p className="mt-2 text-[11.5px] leading-snug text-ink-3">{sisa.join(' \u00b7 ')}</p>
      )}
      {b.peringatan.length > 1 && (
        <p className="mt-1 text-[11.5px] leading-snug text-jebakan">
          {b.peringatan.slice(1).join(' \u00b7 ')}
        </p>
      )}
    </div>
  )
}

/**
 * Tujuh baris, lima kolom.
 *
 * Daftar di atas menjawab "mana yang terbaik"; tabel ini menjawab "kenapa", dan
 * itu pertanyaan yang cuma bisa dijawab dengan menaruh angka yang sama
 * bersebelahan. Dilipat karena ia jawaban untuk pertanyaan kedua, bukan
 * pertama.
 *
 * `overflow-x-auto`: lima kolom angka tidak masuk di 390 px, dan tabel yang
 * melebar memaksa SELURUH panel menggulir ke samping.
 */
function Tabel({ blok, t }: { blok: BlokDalamHeksagon[]; t: typeof K.id }) {
  const kolom: { kepala: string; panjang: string; isi: (b: BlokDalamHeksagon) => string }[] = [
    { kepala: t.kMenit, panjang: t.kolMenit, isi: (b) => (b.menit_jalan == null ? t.kosong : `${Math.round(b.menit_jalan)}`) },
    { kepala: t.kJalan, panjang: t.kolJalan, isi: (b) => (b.jarak_jalan_utama_m == null ? t.kosong : jarakSingkat(b.jarak_jalan_utama_m)) },
    { kepala: t.kUsaha, panjang: t.kolUsaha, isi: (b) => String(b.n_usaha_150m) },
    { kepala: t.kPenarik, panjang: t.kolPenarik, isi: (b) => String(b.n_penarik_250m) },
    { kepala: t.kHalte, panjang: t.kolHalte, isi: (b) => (b.jarak_halte_m == null ? t.kosong : jarakSingkat(b.jarak_halte_m)) },
  ]
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[19rem] border-collapse text-[11.5px]">
        <thead>
          <tr className="text-ink-3">
            <th className="py-1 pr-2 text-left font-medium">#</th>
            {kolom.map((k) => (
              <th key={k.kepala} className="py-1 pr-2 text-right font-medium" title={k.panjang}>
                {k.kepala}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {blok.map((b) => (
            <tr key={b.h3_blok} className="border-t border-line">
              <td className="py-1 pr-2 font-mono text-ink-2">{b.peringkat}</td>
              {kolom.map((k) => (
                <td key={k.kepala} className="py-1 pr-2 text-right font-mono text-ink-2">
                  {k.isi(b)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
