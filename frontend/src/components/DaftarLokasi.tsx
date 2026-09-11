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
 *   opportunity  -> peringkat Opportunity Score
 *   hidden_gem   -> GemFinder, lengkap dengan rangkuman alasan terpilihnya
 *   risk_radar   -> RiskRadar, lengkap dengan label peringatannya
 *   pricelens    -> rentang harga wajar + cakupan data harga per kawasan
 *   zoneguard    -> cakupan RDTR per kawasan
 *
 * Alasannya sederhana: layer sudah menyatakan pertanyaan yang sedang diajukan.
 * Membuat daftar menjawab pertanyaan yang berbeda dari peta di sebelahnya akan
 * memaksa pengguna memegang dua konteks sekaligus.
 */

import { memo, useEffect, useRef, useState } from 'react'

import {
  KUADRAN,
  LAYER,
  SEMUA_KAWASAN,
  URUTAN_KUADRAN,
  frasaKawasan,
  kodeLokasi,
  type NamaLayer,
} from '../config'
import { api } from '../lib/api'
import { rupiah } from '../lib/format'
import type { HiddenGem, SkorHeksagon, TitikKuadran } from '../types'
import { Ajakan, Badge, Glif, Kosong, MemuatNama } from './primitif'
import { useBahasa, useNamaZona, useTeks } from '../lib/bahasa'

type Isi =
  | { jenis: 'skor'; baris: SkorHeksagon[] }
  | { jenis: 'gem'; baris: HiddenGem[] }
  | { jenis: 'risiko'; baris: TitikKuadran[] }
  | { jenis: 'cakupan'; baris: Record<string, unknown>[] }
  | { jenis: 'harga'; baris: Record<string, unknown>[] }

/**
 * Plafon `/skor/ranking`. Satu kawasan terbesar berisi 127 heksagon, jadi untuk
 * satu kawasan angka ini berarti "seluruhnya". Untuk SEMUA kawasan sekaligus
 * (sekitar 660 yang lolos ZoneGuard) ia benar-benar memotong - dan pemotongan
 * itu WAJIB dinyatakan, bukan dibiarkan terbaca sebagai jumlah sebenarnya.
 */
const BATAS_BARIS = 200

/**
 * Baris kawasan mana yang disorot di ringkasan PriceLens dan ZoneGuard.
 *
 * Tanpa saringan aktif SEMUANYA disorot, bukan tidak ada satu pun. Versi
 * sebelumnya membandingkan `nama === kawasanAktif` begitu saja, jadi pada
 * tampilan bawaan - "semua kawasan", yang nilainya string kosong - tidak ada
 * yang pernah cocok dan keenam barisnya diredupkan sekaligus. Daftar yang
 * seluruhnya redup terbaca sebagai daftar yang mati.
 */
const disorot = (kawasanAktif: string, nama: string) =>
  kawasanAktif === SEMUA_KAWASAN || kawasanAktif.split(',').includes(nama)

/**
 * Seluruh kalimat daftar ini, dua bahasa.
 *
 * Ditambahkan 11 Sep 2026: panel ini satu-satunya yang tetap berbahasa
 * Indonesia sekalipun sakelarnya digeser ke Inggris, dan yang paling terlihat
 * "Skor tertinggi dulu" duduk persis di antara dua tombol berbahasa Inggris.
 */
const K = {
  id: {
    lokasi: 'lokasi',
    teratas: 'teratas',
    saring: 'Semua zona',
    saringSatu: (n: string) => n,
    tutupSaring: 'Tutup daftar zona',
    semua: 'Tampilkan semua',
    urutTurun: 'Skor tertinggi dulu',
    urutNaik: 'Skor terendah dulu',
    balik: 'Balik urutan',
    terlarang: 'Lokasi berzona terlarang tidak pernah muncul di daftar ini, berapa pun skornya.',
    potong: (n: number) =>
      `Menampilkan ${n} berskor tertinggi. Pilih satu kawasan untuk melihat seluruh isinya.`,
    memuat: 'sedang menyiapkan daftar lokasi…',
    metode: (n: number) => `${n}/3 metode`,
    zonaRagu: 'zona belum pasti',
    zonaBelum: 'Zona belum bisa dipastikan',
    churn: (v: string) => ` · indeks churn ${v}`,
    risiko: {
      BAHAYA: 'Pergantian usaha termasuk 10% tertinggi di kawasan ini',
      WASPADA: 'Pergantian usaha lebih sering daripada 75% area lain',
      AMAN: 'Pergantian usaha wajar',
    } as Record<string, string>,
    hargaKosong: 'Belum ada heksagon berharga di kawasan mana pun',
    cakupanHarga: (persen: string, n: string) => ` · cakupan data ${persen}% dari ${n} heksagon`,
    zonaKosong: 'Belum ada heksagon berzona',
    terdata: (persen: string) => `aturan tata ruangnya sudah terdata di ${persen}% lokasi`,
    izinkan: (n: number) => `${n} mengizinkan`,
    larang: (n: number) => `${n} melarang`,
    takTahu: (n: number) => `${n} belum diketahui`,
    takAdaRdtr: (n: number) => `${n} belum ada RDTR digital`,
    kosong: {
      risikoJudul: 'Tidak ada peringatan di sini',
      gemJudul: 'Belum ada hidden gem',
      skorJudul: 'Belum ada lokasi berskor',
      risiko: (k: string) =>
        `Tidak ada area di ${k} yang pergantian usahanya melewati ambang wajar kawasannya sendiri. Itu kabar baik.`,
      gem: (k: string) =>
        `Belum ada heksagon di ${k} yang lolos minimal dua dari tiga metode deteksi. Coba kawasan yang prestise visualnya lebih rendah.`,
      skor: (k: string) => `Skor untuk ${k} belum dihitung. Jalankan pipeline sampai tahap terbit.`,
    },
  },
  en: {
    lokasi: 'locations',
    teratas: 'top',
    saring: 'All zones',
    saringSatu: (n: string) => n,
    tutupSaring: 'Close the zone list',
    semua: 'Show all',
    urutTurun: 'Highest score first',
    urutNaik: 'Lowest score first',
    balik: 'Reverse the order',
    terlarang: 'Locations in prohibited zones never appear in this list, whatever their score.',
    potong: (n: number) =>
      `Showing the top ${n} by score. Pick a single area to see all of it.`,
    memuat: 'putting the location list together…',
    metode: (n: number) => `${n}/3 methods`,
    zonaRagu: 'zoning uncertain',
    zonaBelum: 'Zoning cannot be confirmed',
    churn: (v: string) => ` · churn index ${v}`,
    risiko: {
      BAHAYA: 'Business turnover is in the top 10% of this area',
      WASPADA: 'Businesses change hands more often than in 75% of other areas',
      AMAN: 'Business turnover is normal',
    } as Record<string, string>,
    hargaKosong: 'No priced hexagon in any area yet',
    cakupanHarga: (persen: string, n: string) => ` · data coverage ${persen}% of ${n} hexagons`,
    zonaKosong: 'No zoned hexagon yet',
    terdata: (persen: string) => `zoning rules recorded for ${persen}% of locations`,
    izinkan: (n: number) => `${n} allow`,
    larang: (n: number) => `${n} prohibit`,
    takTahu: (n: number) => `${n} unknown`,
    takAdaRdtr: (n: number) => `${n} without digital RDTR`,
    kosong: {
      risikoJudul: 'No warnings here',
      gemJudul: 'No hidden gems yet',
      skorJudul: 'No scored locations yet',
      risiko: (k: string) =>
        `No area in ${k} has business turnover past its own area's normal threshold. That is good news.`,
      gem: (k: string) =>
        `No hexagon in ${k} passes at least two of the three detection methods. Try an area with lower visual prestige.`,
      skor: (k: string) => `Scores for ${k} have not been computed. Run the pipeline through publishing.`,
    },
  },
}

function DaftarLokasi({
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
  const namaZona = useNamaZona()
  const t = useTeks(K)
  const { bahasa } = useBahasa()
  /**
   * Kuadran yang sedang disaring di dalam daftar. null = semuanya.
   *
   * Tidak pernah di-reset lewat efek: App memasang key={kawasan-layer}, jadi
   * berganti kawasan atau layer memasang ulang komponen ini dan saringannya
   * kembali kosong dengan sendirinya. Saringan yang tertinggal dari layar
   * sebelumnya membuat daftar terlihat kosong tanpa sebab yang terlihat.
   */
  const [saring, setSaring] = useState<string | null>(null)
  /** Urutan baris. Keduanya sisi-klien: datanya sudah ada seluruhnya. */
  const [urut, setUrut] = useState<'skor-turun' | 'skor-naik'>('skor-turun')
  const [isi, setIsi] = useState<Isi | null>(null)
  const [memuat, setMemuat] = useState(true)
  const [galat, setGalat] = useState<string | null>(null)

  /**
   * Bahasa ikut memicu permintaan ulang - tetapi HANYA untuk layer yang
   * kalimatnya dirakit backend. `/skor/hidden-gems` dan `/skor/risk-radar`
   * menerima `bahasa`; peringkat skor, cakupan zona, dan ringkasan harga tidak.
   *
   * Dulu tidak perlu dipikirkan: daftar ini dicabut tiap kali tabnya
   * ditinggalkan, jadi mengganti bahasa di menu pengaturan lalu kembali ke sini
   * selalu memasangnya ulang dalam bahasa yang baru. Sejak panel kanan
   * mempertahankan tabnya tetap terpasang (11 Sep 2026), yang tidak meminta
   * ulang akan tetap menulis alasan GemFinder dalam bahasa lama. Untuk layer
   * lain `null`, supaya mengganti bahasa tidak membuang saringan dan posisi
   * gulir demi angka yang sama persis.
   */
  const bahasaKalimat = layer === 'hidden_gem' || layer === 'risk_radar' ? bahasa : null

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
          // 200 = plafon endpoint, dan kawasan terbesar berisi 127 heksagon -
          // jadi ini "seluruhnya", bukan "halaman pertama". Versi sebelumnya
          // meminta 25 dan itulah sebabnya daftar terasa jauh lebih pendek
          // daripada jumlah heksagon yang tergambar di peta.
          return { jenis: 'skor', baris: await api.ranking({ kawasan, limit: BATAS_BARIS }) }
      }
    }

    minta()
      .then((h) => !batal && setIsi(h))
      .catch((e: Error) => !batal && setGalat(e.message))
      .finally(() => !batal && setMemuat(false))

    return () => {
      batal = true
    }
  }, [layer, kawasan, bahasaKalimat])

  if (memuat) return <MemuatNama teks={t.memuat} />
  if (galat) return <Ajakan judul="Daftar gagal dimuat" anak={galat} />
  // Sebaran kuadran seluruh kawasan. Urutannya mengikuti URUTAN_KUADRAN supaya
  // pita dan legendanya selalu sejajar dengan Kompas.
  const ringkasKuadran = (() => {
    // HANYA untuk daftar peringkat skor. Di PriceLens dan ZoneGuard isi
    // daftarnya ringkasan per kawasan, bukan heksagon - menampilkan sebaran
    // kuadran di sana adalah angka yang benar di layar yang salah, dan itu
    // lebih menyesatkan daripada tidak menampilkan apa pun.
    if (isi?.jenis !== 'skor') return null

    // Dihitung dari BARIS YANG ADA DI DAFTAR INI, bukan dari seluruh heksagon
    // kawasan. Keduanya berbeda: daftar ini melewati saring_zoneguard(), jadi
    // 122 heksagon Manggarai muncul sebagai 112 baris. Memakai angka kawasan
    // membuat kepala daftar menulis "122 lokasi" di atas 112 baris - dan
    // angka yang bertentangan dengan yang bisa dihitung sendiri oleh pembaca
    // merusak kepercayaan pada semua angka lain di layar yang sama.
    const n: Record<string, number> = {}
    for (const t of isi.baris) if (t.kuadran) n[t.kuadran] = (n[t.kuadran] ?? 0) + 1
    const bagian = URUTAN_KUADRAN.filter((k) => n[k]).map((k) => ({ kunci: k, n: n[k] }))
    const total = bagian.reduce((a, b) => a + b.n, 0)
    return total ? { bagian, total } : null
  })()

  if (!isi) return null

  return (
    <div className="scroll-tipis h-full overflow-y-auto">
      {/* --- Kepala daftar -------------------------------------------------
          DIRAMPINGKAN 11 Sep 2026, permintaan pemilik repo ("dihapus teksnya
          biar rapih"). Yang pergi dua paragraf:

            "Di mana yang paling menjanjikan?" - pertanyaan layernya. Ia sudah
            tertulis di menu Layer yang memilihnya, dan mengulanginya di kepala
            daftar berarti dua tempat menyebut hal yang sama pada layar yang sama.

            "Peringkat untuk semua orang. Untuk daftar yang disaring anggaran
            dan kawasan Anda, buka tab Untuk Anda." - tiga baris untuk
            membedakan dua tab yang sudah berjudul berbeda tepat di atasnya.

          Yang tersisa: nama layer, jumlah lokasi, pita sebaran, satu tombol
          saringan, dan satu tombol urutan. Lima baris jadi dua. */}
      <div className="sticky top-0 z-10 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="eyebrow">{LAYER[layer].nama}</h2>
          {ringkasKuadran && (
            <span className="tabular shrink-0 text-[12px] text-ink-3">
              {ringkasKuadran.total.toLocaleString('id-ID')}{' '}
              {isi?.jenis === 'skor' && isi.baris.length >= BATAS_BARIS ? t.teratas : t.lokasi}
            </span>
          )}
        </div>

        {ringkasKuadran && (
          <>
            {/* Pita sebaran. Lebarnya sebanding jumlahnya, jadi "kawasan ini
                isinya Hindari semua" terbaca sebelum satu baris pun dibaca. */}
            <div className="mt-2.5 flex h-2 gap-[2px] overflow-hidden rounded-full" aria-hidden>
              {ringkasKuadran.bagian.map((b) => (
                <span
                  key={b.kunci}
                  title={`${namaZona(b.kunci)}: ${b.n}`}
                  style={{
                    width: `${(b.n / ringkasKuadran.total) * 100}%`,
                    background: KUADRAN[b.kunci].warna,
                  }}
                />
              ))}
            </div>

            <div className="mt-2.5 flex items-center gap-2">
              <SaringZona
                bagian={ringkasKuadran.bagian}
                nilai={saring}
                onUbah={setSaring}
                t={t}
              />
              <button
                onClick={() => setUrut((u) => (u === 'skor-turun' ? 'skor-naik' : 'skor-turun'))}
                className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line px-2.5 py-1.5 text-[11.5px] text-ink-2 transition-colors hover:border-line-2 hover:text-ink"
                title={t.balik}
              >
                <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
                  <path
                    d={urut === 'skor-turun' ? 'M6 1.5v9M2.5 7 6 10.5 9.5 7' : 'M6 10.5v-9M2.5 5 6 1.5 9.5 5'}
                    stroke="currentColor"
                    strokeWidth="1.5"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {urut === 'skor-turun' ? t.urutTurun : t.urutNaik}
              </button>
            </div>

            {/* Kalimat ini dulu tenggelam di kaki daftar dan pemilik repo
                melaporkannya tidak terlihat. Ia bukan catatan kaki: ia satu-
                satunya keterangan kenapa jumlah baris di sini bisa lebih sedikit
                daripada jumlah heksagon di peta. */}
            <p className="mt-2 flex items-start gap-1.5 rounded-sm bg-surface-2 px-2 py-1.5 text-[11px] leading-snug text-ink-2">
              <span className="mt-[3px] h-2 w-2 shrink-0 rounded-[2px] bg-bahaya" aria-hidden />
              {t.terlarang}
            </p>

            {/* Pemotongan dinyatakan, tidak dibiarkan terbaca sebagai jumlah
                sebenarnya. Daftar yang berhenti di 200 tanpa berkata apa-apa
                akan terbaca sebagai "cuma segini yang ada". */}
            {isi.baris.length >= BATAS_BARIS && (
              <p className="mt-1.5 text-[11px] leading-snug text-ink-3">{t.potong(BATAS_BARIS)}</p>
            )}
          </>
        )}
      </div>

      {isi.jenis === 'cakupan' ? (
        <Cakupan baris={isi.baris} kawasanAktif={kawasan} />
      ) : isi.jenis === 'harga' ? (
        <RentangKawasan baris={isi.baris} kawasanAktif={kawasan} />
      ) : isi.baris.length === 0 ? (
        <Ajakan
          judul={
            layer === 'risk_radar'
              ? t.kosong.risikoJudul
              : layer === 'hidden_gem'
                ? t.kosong.gemJudul
                : t.kosong.skorJudul
          }
          anak={
            layer === 'risk_radar'
              ? t.kosong.risiko(frasaKawasan(kawasan))
              : layer === 'hidden_gem'
                ? t.kosong.gem(frasaKawasan(kawasan))
                : t.kosong.skor(frasaKawasan(kawasan))
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
                kawasan={g.skor.kawasan}
                aktif={terpilih === g.skor.h3_index}
                onPilih={onPilih}
                kuadran={g.skor.kuadran}
                nilai={g.skor.hidden_gem_score?.toFixed(2) ?? '—'}
                satuan="skor gem"
                badge={g.skor.keyakinan}
              >
                {/* Satu kalimat, satu pengukur, dan buktinya DILIPAT.
                    (3 Sep 2026, keluhan "kebanyakan teks, jelek sekali".)

                    Baris lama menumpuk empat blok teks di satu kartu: ringkasan,
                    sampai tiga butir bukti, dan satu baris "Lolos N dari 3".
                    Dikalikan sepuluh kartu, daftar peringkat berubah jadi enam
                    layar prosa - dan yang dicari orang di daftar berperingkat
                    justru kebalikannya: memindai cepat, lalu berhenti di satu.

                    Buktinya TIDAK dibuang. Ia yang membuat tiap klaim bisa
                    ditelusuri, dan itu justru bagian yang paling berharga di
                    sini - ia cuma tidak lagi terbuka semuanya sekaligus. */}
                <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-ink-2">
                  {g.ringkasan}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  {/* Tiga titik = tiga metode. Lebih cepat dibaca daripada
                      "Lolos 2 dari 3 metode", dan memakan seperlima ruangnya. */}
                  <span className="flex shrink-0 items-center gap-1" aria-hidden>
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className={`h-1.5 w-1.5 rounded-full ${
                          i < g.n_metode_lolos ? 'bg-gem' : 'bg-line-2'
                        }`}
                      />
                    ))}
                  </span>
                  <span className="text-[11.5px] text-ink-3">
                    {t.metode(g.n_metode_lolos)}
                    {g.zoneguard.status === 'TIDAK_DIKETAHUI' && ` · ${t.zonaRagu}`}
                  </span>
                </div>
              </Kartu>
            ))}

          {isi.jenis === 'risiko' &&
            /* `x`, bukan `t`: `t` sudah dipakai cabang kamus komponen ini. */
            isi.baris.map((x, i) => (
              <Kartu
                key={x.h3_index}
                no={i + 1}
                h3={x.h3_index}
                kawasan={x.kawasan}
                aktif={terpilih === x.h3_index}
                onPilih={onPilih}
                kuadran={x.kuadran}
                nilai={x.y_peluang?.toFixed(0) ?? '—'}
                satuan="Opportunity Score"
                badge={x.keyakinan}
              >
                {/* Label peringatan — inti kriteria penerimaan RiskRadar. */}
                <p
                  className={`mt-1 inline-flex items-center gap-1.5 rounded-xs px-1.5 py-[3px] text-[12.5px] font-semibold ${
                    x.risiko === 'BAHAYA'
                      ? 'bg-bahaya-soft text-bahaya'
                      : 'text-bahaya ring-1 ring-inset ring-bahaya/35'
                  }`}
                >
                  <span
                    aria-hidden
                    className={`h-2.5 w-2.5 rounded-[2px] ${
                      x.risiko === 'BAHAYA' ? 'bg-bahaya' : 'border-[1.5px] border-bahaya'
                    }`}
                  />
                  {x.risiko}
                </p>
                <p className="mt-1 text-[13.5px] leading-snug text-ink-2">
                  {t.risiko[x.risiko]}
                  {x.indeks_churn !== null && (
                    <span className="tabular text-ink-3">{t.churn(x.indeks_churn.toFixed(2))}</span>
                  )}
                </p>
              </Kartu>
            ))}

          {isi.jenis === 'skor' &&
            isi.baris
              .filter((s) => !saring || s.kuadran === saring)
              .sort((a, b) => {
                const d = (b.opportunity_score ?? -1) - (a.opportunity_score ?? -1)
                return urut === 'skor-turun' ? d : -d
              })
              .map((s, i) => (
                <Kartu
                  key={s.h3_index}
                  no={i + 1}
                  h3={s.h3_index}
                  kawasan={s.kawasan}
                  aktif={terpilih === s.h3_index}
                  onPilih={onPilih}
                  kuadran={s.kuadran}
                  nilai={s.opportunity_score?.toFixed(0) ?? '—'}
                  satuan="Opportunity Score"
                  badge={s.keyakinan}
                >
                  {s.kuadran && (
                    <p
                      className="mt-1 text-[13px] font-semibold leading-snug"
                      style={{ color: KUADRAN[s.kuadran].warna ?? 'var(--color-ink-3)' }}
                      title={bahasa === 'en' ? KUADRAN[s.kuadran].artiEn : KUADRAN[s.kuadran].arti}
                    >
                      {namaZona(s.kuadran)}
                    </p>
                  )}
                  {s.zona_izin_komersial === null && (
                    <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-ink-3">
                      <span
                        aria-hidden
                        className="arsir h-2.5 w-2.5 rounded-[2px] border border-line-2"
                      />
                      {t.zonaBelum}
                    </p>
                  )}
                </Kartu>
              ))}
        </ol>
      )}

    </div>
  )
}

/**
 * Saringan zona sebagai DROPDOWN, bukan deretan pil.
 *
 * Dirombak 11 Sep 2026, permintaan pemilik repo. Versi sebelumnya menaruh
 * keempat zona sebagai pil yang selalu terlihat: ia sekaligus legenda pita di
 * atasnya, dan itu memang alasan yang baik - tetapi empat pil berlabel panjang
 * ("Jebakan Gengsi", "Prestige Trap") membungkus jadi dua baris di panel
 * selebar 25rem, dan dua baris kontrol di atas daftar yang sudah padat terbaca
 * sebagai kekacauan, bukan sebagai pilihan.
 *
 * Sekarang satu tombol yang menyatakan keadaan saringannya, dan daftarnya baru
 * terbuka kalau diminta. Warna dan jumlah tiap zona tetap ada DI DALAM daftar
 * itu, jadi ia tidak berhenti jadi legenda - ia cuma tidak lagi memakan dua
 * baris sepanjang waktu.
 */
function SaringZona({
  bagian,
  nilai,
  onUbah,
  t,
}: {
  bagian: { kunci: string; n: number }[]
  nilai: string | null
  onUbah: (k: string | null) => void
  t: (typeof K)['id']
}) {
  const namaZona = useNamaZona()
  const { bahasa } = useBahasa()
  const [buka, setBuka] = useState(false)
  const wadah = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!buka) return
    const luar = (e: MouseEvent) => {
      if (!wadah.current?.contains(e.target as Node)) setBuka(false)
    }
    const kunci = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBuka(false)
    }
    document.addEventListener('mousedown', luar)
    document.addEventListener('keydown', kunci)
    return () => {
      document.removeEventListener('mousedown', luar)
      document.removeEventListener('keydown', kunci)
    }
  }, [buka])

  const q = nilai ? KUADRAN[nilai] : null

  return (
    <div ref={wadah} className="relative min-w-0 flex-1">
      <button
        onClick={() => setBuka((v) => !v)}
        aria-expanded={buka}
        aria-haspopup="listbox"
        className={`flex w-full cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11.5px] transition-colors ${
          q ? 'border-transparent text-ink' : 'border-line text-ink-2 hover:border-line-2 hover:text-ink'
        }`}
        style={{ background: q ? q.lembut : undefined }}
      >
        {q && (
          <span
            className="h-2 w-2 shrink-0 rounded-[2px]"
            style={{ background: q.warna }}
            aria-hidden
          />
        )}
        <span className="min-w-0 flex-1 truncate text-left">
          {q ? t.saringSatu(namaZona(q.kunci)) : t.saring}
        </span>
        <svg
          width="9"
          height="9"
          viewBox="0 0 10 10"
          aria-hidden
          className={`shrink-0 transition-transform duration-200 ${buka ? 'rotate-180' : ''}`}
        >
          <path d="M1 3.5 5 7.5 9 3.5" stroke="currentColor" strokeWidth="1.6" fill="none" />
        </svg>
      </button>

      {buka && (
        <ul
          role="listbox"
          /* LEGAP, bukan kaca. Popover ini hidup DI DALAM panel yang sudah
             ber-`backdrop-filter`, dan backdrop-filter bersarang tidak melihat
             menembus leluhurnya - jadi `kaca-tebal` di sini tinggal 88%
             opasitasnya tanpa buram sama sekali, dan kalimat di belakangnya
             terbaca menembus daftar. Terlihat begitu di potret. */
          className="pop absolute left-0 top-[calc(100%+6px)] z-30 w-[13.5rem] overflow-hidden rounded-md border border-line bg-surface py-1 shadow-[0_20px_44px_-16px_rgb(0_0_0/0.55)]"
        >
          <li>
            <button
              role="option"
              aria-selected={nilai === null}
              onClick={() => {
                onUbah(null)
                setBuka(false)
              }}
              className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-surface-2 ${
                nilai === null ? 'text-ink' : 'text-ink-2'
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{t.semua}</span>
              <span className="tabular shrink-0 text-[11.5px] text-ink-3">
                {bagian.reduce((a, b) => a + b.n, 0)}
              </span>
            </button>
          </li>
          {bagian.map((b) => (
            <li key={b.kunci}>
              <button
                role="option"
                aria-selected={nilai === b.kunci}
                onClick={() => {
                  onUbah(nilai === b.kunci ? null : b.kunci)
                  setBuka(false)
                }}
                title={bahasa === 'en' ? KUADRAN[b.kunci].ringkasEn : KUADRAN[b.kunci].ringkas}
                className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[12.5px] transition-colors hover:bg-surface-2 ${
                  nilai === b.kunci ? 'text-ink' : 'text-ink-2'
                }`}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                  style={{ background: KUADRAN[b.kunci].warna }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">{namaZona(b.kunci)}</span>
                <span className="tabular shrink-0 text-[11.5px] text-ink-3">{b.n}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Satu baris daftar. Bentuknya sama untuk ketiga jenis isi. */
function Kartu({
  no,
  h3,
  kawasan,
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
  kawasan: string
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
          <span className="tabular papan mt-[1px] w-5 shrink-0 text-[15px] text-ink-3">
            {no}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex items-baseline gap-1.5">
                <span className="papan tabular text-[22px] leading-none">{nilai}</span>
                <span className="text-[12px] text-ink-3">{satuan}</span>
              </span>
              {kuadran && <Glif kuadran={kuadran} ukuran={11} />}
            </div>

            <div className="mt-1 flex items-center gap-2">
              {/* Nama yang bisa dibaca, bukan lima belas karakter heksadesimal.
                  Indeks H3-nya tetap ada di panel detail. */}
              <span className="truncate text-[12px] text-ink-3">{kodeLokasi(h3, kawasan)}</span>
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
  const t = useTeks(K)
  const berisi = baris.filter((r) => {
    const w = r.sewa_per_m2 as Record<string, number | null> | undefined
    return w?.p50 != null
  })
  if (berisi.length === 0) return <Kosong teks={t.hargaKosong} />

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
            <li key={nama} className={disorot(kawasanAktif, nama) ? '' : 'opacity-55'}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-[14.5px] font-medium">{nama}</span>
                <span className="tabular text-[13px] text-ink-2">
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
              <p className="tabular mt-1 text-[12.5px] text-ink-3">
                {rupiah(w.p25)} – {rupiah(w.p75)}
                {t.cakupanHarga((cakupan * 100).toFixed(0), String(r.total_heksagon))}
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
  const t = useTeks(K)
  if (baris.length === 0) return <Kosong teks={t.zonaKosong} />

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
            <li key={nama} className={disorot(kawasanAktif, nama) ? '' : 'opacity-60'}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-[14.5px] font-medium">{nama}</span>
                <span className="tabular text-[13px] text-ink-3">
                  {t.terdata((cakupan * 100).toFixed(0))}
                </span>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-xs bg-ground-2">
                <span
                  className="bg-[#c9dbd4]"
                  style={{ width: `${(diizinkan / total) * 100}%` }}
                  title={t.izinkan(diizinkan)}
                />
                <span
                  className="bg-bahaya"
                  style={{ width: `${(dilarang / total) * 100}%` }}
                  title={t.larang(dilarang)}
                />
                <span
                  className="arsir bg-line-2 text-ink-3"
                  style={{ width: `${(takTahu / total) * 100}%` }}
                  title={t.takAdaRdtr(takTahu)}
                />
              </div>
              <p className="tabular mt-1 text-[12.5px] text-ink-3">
                {t.izinkan(diizinkan)} · {t.larang(dilarang)} · {t.takTahu(takTahu)}
              </p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// Dibungkus `memo`: panel kanan mempertahankan tabnya tetap terpasang, dan tanpa ini
// 200 baris daftar ikut dirender ulang tiap kali tab LAIN dibuka - terukur 350 ms
// per klik di dev. Lihat `pilihDariDaftar` di App.tsx.
export default memo(DaftarLokasi)
