
import type { ReactNode } from 'react'

import { BATASAN, DIUKUR, RINGKASAN, SUMBER, TEMUAN } from '../lib/ringkasan-data'
import { useTeks } from '../lib/bahasa'
import { angka } from '../lib/format'

const K = {
  id: {
    judul: 'Metodologi & sumber data',
    isi: 'Setiap angka di Loconomics berasal dari sumber yang bisa Anda buka sendiri. Daftar ini dibangkitkan dari basis data yang sama dengan yang menggambar petanya — bukan diketik ulang.',
    diukur: (t: string) => `Diukur ${t}`,
    resmiJudul: 'Data resmi — diukur, dan boleh mengisi kolom',
    resmiRingkas: 'menghitung skor & keyakinan',
    resmiIsi: 'Yang di bawah ini menghitung skor, mewarnai peta, dan menentukan lencana keyakinan.',
    perkiraanJudul: 'Perkiraan — tidak pernah mengisi kolom',
    perkiraanRingkas: 'tidak menghitung apa pun',
    perkiraanIsi:
      'Yang di bawah ini hanya tampil di panel detail, selalu berlabel Perkiraan. Ia tidak pernah menghitung skor, tidak pernah mewarnai peta, dan tidak pernah menaikkan lencana keyakinan.',
    kolSumber: 'Sumber',
    kolMengisi: 'Mengisi',
    kolLisensi: 'Lisensi',
    kolCakupan: 'Cakupan',
    takDiukur: 'tidak per heksagon',
    dariHeks: (n: string, dari: string) => `${n} dari ${dari} heksagon`,
    ringkasJudul: 'Yang terkumpul sampai hari ini',
    rHeksagon: 'heksagon',
    rKawasan: 'kawasan pilot',
    rVariabel: 'variabel terisi',
    rSurvei: 'heksagon disurvei',
    rObservasi: 'observasi misi MAPID',
    rPoi: 'POI OpenStreetMap',
    rRute: 'rute jalan kaki',
    batasJudul: 'Yang belum ada, disebut apa adanya',
    batasRingkas: 'kekurangan yang ikut dicetak',
    batasIsi:
      'Daftar ini sengaja ikut dicetak. Produk data yang cuma menyebut kekuatannya menuntut pembacanya menebak sisanya.',
    temuanJudul: 'Empat pengukuran yang membantah dugaan wajar',
    temuanRingkas: 'empat temuan berangka',
    tutup: 'Tutup',
    metodeJudul: 'Metodologi — dari data mentah ke rekomendasi',
    metodeRingkas: 'enam langkah',
    metode: [
      ['Kumpulkan', 'Data misi MAPID (Menu Go, Struk Go, Properti Go) dan Community Maps ditarik lewat API MAPID, disaring per poligon enam kawasan pilot; ditambah OpenStreetMap, openrouteservice, WorldPop, dan RDTR ATR/BPN.'],
      ['Bersihkan & baca foto', 'Koordinat di luar wilayah dibuang, satuan diseragamkan, kosong tetap kosong. Foto struk dan spanduk dibaca Gemini Vision menjadi angka terstruktur yang divalidasi skema.'],
      ['Satukan di heksagon', 'Seluruh sumber diagregasi ke 708 heksagon H3 resolusi 9 (±350 m): spatial join POI & titik survei, rute jaringan jalan, isochrone, dan zonasi yang ditimbang menurut luas perpotongan.'],
      ['Hitung empat indeks', 'Potensi Transit, Aktivitas Ekonomi, Kompetisi, serta Biaya & Risiko — dinormalisasi per kawasan, lalu Opportunity Score = 0,35·IPT + 0,35·IAE − 0,20·IKP − 0,10·IBR. Zona yang melarang usaha membuat skornya 0.'],
      ['Tentukan kuadran & Hidden Gem', 'Skor dibandingkan dengan prestise visual (batas median) jadi empat kuadran. Hidden Gem wajib lolos 2 dari 3 metode: residual biaya, kuadran, dan IPTT (pedagang keliling yang ramai pembeli di tempat yang minim usaha menetap).'],
      ['Jelaskan lewat AI', 'Loconomics AI (Gemini) memilih alat dari daftar tertutup, membaca hasilnya dari basis data, dan menggerakkan peta. Ia TIDAK PERNAH menghitung skor; setiap jawaban membawa jejak alat yang dipanggil.'],
    ] as [string, string][],
    surveiJudul: 'Survey activities — peran data lapangan',
    surveiRingkas: 'peran data lapangan',
    surveiIsi:
      'Survei dilakukan lewat MAPID APPS (misi Menu Go, Struk Go, Properti Go, dan Community Maps). Datanya ditarik per poligon, jadi yang masuk adalah kumpulan seluruh peserta yang titiknya jatuh di enam kawasan pilot — termasuk survei tim kami.',
    surveiAngka: (ditarik: string, masuk: string, heks: string) =>
      `${ditarik} titik misi ditarik · ${masuk} jatuh di dalam wilayah studi · ${heks} heksagon tersentuh`,
    surveiPeran: [
      'Mengisi variabel yang hanya bisa diukur orang di lokasi: harga per porsi, keramaian pembeli, pedagang keliling, dan pasokan ruang sewa.',
      'Membentuk IPTT — metrik orisinal yang hanya mungkin karena misi Menu Go mencatat mobilitas pedagang dan kondisi pembeli.',
      'Menentukan lencana keyakinan tiap heksagon (jumlah titik survei, tingkat keyakinan, asal data).',
      'Menjadi pembanding untuk menguji model perkiraan: selisihnya terhadap pengukuran lapangan ditampilkan apa adanya di panel detail.',
    ],
    surveiBatas:
      'Data mentah survei tidak pernah ditampilkan — yang keluar hanya rangkuman per heksagon, dan rangkuman dari satu baris survei pun ditahan.',
    estimasiJudul: 'Estimasi pengisi untuk peragaan',
    estimasiRingkas: 'sel yang diisi estimasi',
    estimasiIsi:
      'Pada rilis ini, sel yang belum punya sumber lapangan untuk harga sewa, NJOP, pergantian usaha (churn), pola jam, prestise visual, proksi penumpang, dan kepadatan kos DIISI ESTIMASI supaya PriceLens, RiskRadar, dan Commuter Clock bisa diperagakan. Estimasi diturunkan dari sinyal nyata heksagon itu sendiri (jarak ke simpul, penduduk, jumlah usaha terpetakan), ikut dihitung mesin skor yang sama, dan lencana keyakinan TIDAK dinaikkan. Zonasi dan seluruh variabel survei MAPID tidak pernah diisi estimasi. Seluruh sel tercatat dan dapat dicabut kembali.',
    rekomJudul: 'Rekomendasi untuk pemangku kepentingan',
    rekomRingkas: 'empat pemakainya',
    rekom: {
      umkm: 'Calon pelaku UMKM',
      pemda: 'Pemerintah daerah & perencana kota',
      operator: 'Operator transportasi',
      properti: 'Pemilik properti & pengembang TOD',
    },
    rekomUmkm: (rute: string | null) =>
      `Nilai akses dari rute jalan kaki sungguhan, bukan jarak lurus${rute ? ` — rata-rata rutenya ${rute} lebih panjang` : ''}. Utamakan Hidden Gem, waspadai Jebakan Gengsi, dan pastikan zonasinya diizinkan sebelum menandatangani sewa.`,
    rekomPemda: (tanpaRdtr: string | null) =>
      `Percepat terbitnya RDTR digital${tanpaRdtr ? `: ${tanpaRdtr} heksagon di wilayah studi belum bisa dinilai legalitasnya` : ''}, terutama Kota Depok dan Kota Bekasi. Pakai layer Hidden Gem dan IPTT untuk menentukan titik pembinaan UMKM dan pedagang keliling.`,
    rekomOperator: (jangkau: string | null) =>
      `Perbaiki akses pejalan kaki di sekitar simpul yang jangkauannya sempit${jangkau ? ` — ${jangkau}` : ''}. Jalur pejalan kaki yang pendek memperluas pasar setiap usaha di sekitar stasiun.`,
    rekomProperti:
      'Tawarkan ruang di heksagon Hidden Gem dengan harga yang mengikuti potensinya, dan pilih jenis tenant menurut kelas usaha yang kompetisinya masih longgar di blok itu (bedah 7 blok).',

  },
  en: {
    judul: 'Methodology & data sources',
    isi: 'Every number in Loconomics comes from a source you can open yourself. This list is generated from the same database that draws the map — not retyped.',
    diukur: (t: string) => `Measured ${t}`,
    resmiJudul: 'Official data — measured, and allowed to fill columns',
    resmiRingkas: 'computes scores & confidence',
    resmiIsi: 'These compute the scores, colour the map, and set the confidence badges.',
    perkiraanJudul: 'Estimates — never fill a column',
    perkiraanRingkas: 'computes nothing at all',
    perkiraanIsi:
      'These only appear in the detail panel, always labelled Estimate. They never compute a score, never colour the map, and never raise a confidence badge.',
    kolSumber: 'Source',
    kolMengisi: 'Fills',
    kolLisensi: 'Licence',
    kolCakupan: 'Coverage',
    takDiukur: 'not per hexagon',
    dariHeks: (n: string, dari: string) => `${n} of ${dari} hexagons`,
    ringkasJudul: 'What has been collected so far',
    rHeksagon: 'hexagons',
    rKawasan: 'pilot areas',
    rVariabel: 'variables filled',
    rSurvei: 'hexagons surveyed',
    rObservasi: 'MAPID mission observations',
    rPoi: 'OpenStreetMap POIs',
    rRute: 'walking routes',
    batasJudul: 'What is missing, said plainly',
    batasRingkas: 'the gaps, printed too',
    batasIsi:
      'This list is printed on purpose. A data product that names only its strengths asks its reader to guess the rest.',
    temuanJudul: 'Four measurements that contradict a reasonable guess',
    temuanRingkas: 'four numbered findings',
    tutup: 'Close',
    metodeJudul: 'Methodology — from raw data to recommendations',
    metodeRingkas: 'six steps',
    metode: [
      ['Collect', 'MAPID mission data (Menu Go, Struk Go, Properti Go) and Community Maps are pulled through the MAPID API, filtered by the polygons of the six pilot areas; plus OpenStreetMap, openrouteservice, WorldPop, and ATR/BPN zoning (RDTR).'],
      ['Clean & read photos', 'Coordinates outside the study area are dropped, units are standardised, and empty stays empty. Receipt and banner photos are read by Gemini Vision into structured, schema-validated numbers.'],
      ['Unify on hexagons', 'Every source is aggregated to 708 H3 resolution-9 hexagons (±350 m): spatial joins of POIs and survey points, street-network routes, isochrones, and zoning weighted by overlap area.'],
      ['Compute four indices', 'Transit Potential, Economic Activity, Competition, and Cost & Risk — normalised per area, then Opportunity Score = 0.35·IPT + 0.35·IAE − 0.20·IKP − 0.10·IBR. Zoning that forbids business sets the score to 0.'],
      ['Assign quadrants & Hidden Gems', 'The score is compared with visual prestige (median split) into four quadrants. A Hidden Gem must pass 2 of 3 methods: cost residual, quadrant, and IPTT (busy roaming vendors where few fixed businesses operate).'],
      ['Explain with AI', 'Loconomics AI (Gemini) picks tools from a closed list, reads their results from the database, and moves the map. It NEVER computes a score; every answer carries the trace of the tools it called.'],
    ] as [string, string][],
    surveiJudul: 'Survey activities — the role of field data',
    surveiRingkas: 'why field data matters',
    surveiIsi:
      'Surveys are done with MAPID APPS (Menu Go, Struk Go, Properti Go missions and Community Maps). The data is pulled by polygon, so it is the combined work of every participant whose points fall in the six pilot areas — including our team’s surveys.',
    surveiAngka: (ditarik: string, masuk: string, heks: string) =>
      `${ditarik} mission points pulled · ${masuk} inside the study area · ${heks} hexagons touched`,
    surveiPeran: [
      'Fills the variables only a person on site can measure: price per portion, buyer crowding, roaming vendors, and rentable-space supply.',
      'Builds IPTT — an original metric that exists only because Menu Go records vendor mobility and buyer conditions.',
      'Sets each hexagon’s confidence badge (survey points, confidence level, data origin).',
      'Serves as the benchmark for testing the estimation model: its error against field measurements is shown as-is in the detail panel.',
    ],
    surveiBatas:
      'Raw survey rows are never shown — only per-hexagon summaries leave the system, and even a summary of a single survey row is withheld.',
    estimasiJudul: 'Placeholder estimates for demonstration',
    estimasiRingkas: 'cells filled by estimate',
    estimasiIsi:
      'In this release, cells with no field source yet for rent, land value (NJOP), business churn, hourly patterns, visual prestige, ridership proxy, and boarding-house density ARE FILLED WITH ESTIMATES so PriceLens, RiskRadar, and Commuter Clock can be demonstrated. Estimates are derived from real signals of the same hexagon (distance to the station, population, mapped businesses), pass through the same scoring engine, and confidence badges are NOT raised. Zoning and every MAPID survey variable are never estimated. Every filled cell is recorded and can be removed.',
    rekomJudul: 'Recommendations for stakeholders',
    rekomRingkas: 'four kinds of reader',
    rekom: {
      umkm: 'Aspiring small-business owners',
      pemda: 'Local government & city planners',
      operator: 'Transit operators',
      properti: 'Property owners & TOD developers',
    },
    rekomUmkm: (rute: string | null) =>
      `Judge access by real walking routes, not straight-line distance${rute ? ` — routes are on average ${rute} longer` : ''}. Favour Hidden Gems, beware Prestige Traps, and confirm zoning allows business before signing a lease.`,
    rekomPemda: (tanpaRdtr: string | null) =>
      `Speed up digital RDTR zoning${tanpaRdtr ? `: ${tanpaRdtr} hexagons in the study area cannot yet be assessed for legality` : ''}, especially Depok and Bekasi. Use the Hidden Gem and IPTT layers to target support for small businesses and roaming vendors.`,
    rekomOperator: (jangkau: string | null) =>
      `Improve pedestrian access around stations with a narrow reach${jangkau ? ` — ${jangkau}` : ''}. Shorter walking routes widen the market of every business around a station.`,
    rekomProperti:
      'Offer space in Hidden Gem hexagons at prices that follow their potential, and choose tenants by business class where competition in that block is still loose (7-block breakdown).',

  },
}

function Tabel({ baris, t }: { baris: typeof SUMBER; t: typeof K.id }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[34rem] border-collapse text-left text-[12.5px]">
        <thead className="bg-surface-2 text-ink-3">
          <tr>
            <th className="px-2.5 py-1.5 font-semibold">{t.kolSumber}</th>
            <th className="px-2.5 py-1.5 font-semibold">{t.kolMengisi}</th>
            <th className="px-2.5 py-1.5 font-semibold">{t.kolLisensi}</th>
            <th className="px-2.5 py-1.5 text-right font-semibold">{t.kolCakupan}</th>
          </tr>
        </thead>
        <tbody>
          {baris.map((s) => (
            <tr key={s.nama} className="border-t border-line align-top">
              <td className="px-2.5 py-2">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-ink underline decoration-line-2 underline-offset-2 hover:text-gem"
                >
                  {s.nama}
                </a>
              </td>
              <td className="px-2.5 py-2 text-ink-2">{s.mengisi}</td>
              <td className="px-2.5 py-2 text-ink-3">{s.lisensi}</td>
              <td className="tabular px-2.5 py-2 text-right whitespace-nowrap text-ink-2">
                {/* "tidak per heksagon" BUKAN nol, dan bukan sel kosong.
                    Basemap menyentuh seluruh peta tanpa mengisi satu kolom pun;
                    sel kosong akan terbaca sebagai sumber yang tidak dipakai. */}
                {s.cakupan === null
                  ? <span className="text-ink-3 italic">{t.takDiukur}</span>
                  : t.dariHeks(angka(s.cakupan) ?? String(s.cakupan), angka(RINGKASAN.heksagon) ?? '')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function SumberData({ onTutup }: { onTutup?: () => void }) {
  const t = useTeks(K)
  const resmi = SUMBER.filter((s) => s.jenis !== 'perkiraan')
  const perkiraan = SUMBER.filter((s) => s.jenis === 'perkiraan')
  const angkaRingkas: [number, string][] = [
    [RINGKASAN.heksagon, t.rHeksagon],
    [RINGKASAN.kawasan, t.rKawasan],
    [RINGKASAN.heksagonBersurvei, t.rSurvei],
    [RINGKASAN.observasiMisi, t.rObservasi],
    [RINGKASAN.poiOsm, t.rPoi],
    [RINGKASAN.ruteOrs, t.rRute],
  ]

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-5">
      <header>
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="papan text-[19px]">{t.judul}</h2>
          {onTutup && (
            <button
              onClick={onTutup}
              className="shrink-0 cursor-pointer rounded-full border border-line px-3.5 py-1.5 text-[13px] font-medium transition-colors hover:bg-surface-2"
            >
              {t.tutup}
            </button>
          )}
        </div>
        <p className="mt-1.5 max-w-[58ch] text-[13px] leading-relaxed text-ink-2">{t.isi}</p>
      </header>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {angkaRingkas.map(([n, label]) => (
          <div key={label} className="rounded-lg border border-line px-2.5 py-2">
            <p className="tabular text-[17px] leading-none text-ink">{angka(n)}</p>
            <p className="mt-1 text-[11px] leading-tight text-ink-3">{label}</p>
          </div>
        ))}
        <div className="rounded-lg border border-line px-2.5 py-2">
          <p className="tabular text-[17px] leading-none text-ink">
            {RINGKASAN.variabelTerisi}/{RINGKASAN.variabelTotal}
          </p>
          <p className="mt-1 text-[11px] leading-tight text-ink-3">{t.rVariabel}</p>
        </div>
      </section>

      {/* Sembilan bagian panjang jadi daftar yang bisa dibuka satu per satu.
          Yang tampil lebih dulu cuma judul + satu baris ringkasannya, jadi
          layarnya bersih; isinya utuh begitu diketuk, dan di layar lebar
          bagian-bagiannya tersusun dua kolom. Yang bernilai di sini justru isi
          yang bisa diperiksa, bukan dinding teks yang dilewati. */}
      <div className="grid gap-2 lg:grid-cols-2">
        <Lipat judul={t.metodeJudul} ringkas={t.metodeRingkas}>
          <ol className="grid gap-2 sm:grid-cols-2">
            {t.metode.map(([judul, isi], i) => (
              <li key={judul} className="flex gap-2.5">
                <span className="tabular grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-2 text-[12px] font-semibold text-ink">
                  {i + 1}
                </span>
                <span>
                  <span className="block text-[13px] font-semibold text-ink">{judul}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-2">{isi}</span>
                </span>
              </li>
            ))}
          </ol>
        </Lipat>

        <Lipat judul={t.surveiJudul} ringkas={t.surveiRingkas}>
          <p className="tabular mb-2 rounded-lg bg-surface-2 px-2.5 py-2 text-[12.5px] font-semibold text-ink">
            {t.surveiAngka(
              angka(RINGKASAN.titikMisiDitarik) ?? String(RINGKASAN.titikMisiDitarik),
              angka(RINGKASAN.observasiMisi) ?? String(RINGKASAN.observasiMisi),
              angka(RINGKASAN.heksagonBersurvei) ?? String(RINGKASAN.heksagonBersurvei),
            )}
          </p>
          <ul className="flex flex-col gap-1.5">
            {t.surveiPeran.map((p) => (
              <li key={p} className="flex gap-2 text-[12.5px] leading-snug text-ink-2">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-gem" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] leading-snug text-ink-3 italic">{t.surveiBatas}</p>
        </Lipat>

        <Lipat judul={t.rekomJudul} ringkas={t.rekomRingkas}>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                [t.rekom.umkm, t.rekomUmkm(TEMUAN.find((f) => f.kunci === 'rute')?.angka ?? null)],
                [
                  t.rekom.pemda,
                  t.rekomPemda(
                    angka(
                      TEMUAN.find((f) => f.kunci === 'zonasi')?.deret.find((d) =>
                        d.label.includes('RDTR'),
                      )?.nilai ?? null,
                    ) ?? null,
                  ),
                ],
                [
                  t.rekom.operator,
                  t.rekomOperator(TEMUAN.find((f) => f.kunci === 'jangkau')?.judul ?? null),
                ],
                [t.rekom.properti, t.rekomProperti],
              ] as [string, string][]
            ).map(([siapa, isi]) => (
              <div key={siapa}>
                <p className="text-[13px] font-semibold text-ink">{siapa}</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{isi}</p>
              </div>
            ))}
          </div>
        </Lipat>

        <Lipat judul={t.resmiJudul} ringkas={t.resmiRingkas} nada="text-gem">
          <Tabel baris={resmi} t={t} />
        </Lipat>

        {perkiraan.length > 0 && (
          <Lipat judul={t.perkiraanJudul} ringkas={t.perkiraanRingkas} nada="text-jebakan">
            <p className="mb-2 text-[12.5px] leading-snug text-ink-2">{t.perkiraanIsi}</p>
            <Tabel baris={perkiraan} t={t} />
          </Lipat>
        )}

        <Lipat judul={t.temuanJudul} ringkas={t.temuanRingkas}>
          <ul className="flex flex-col gap-2.5">
            {TEMUAN.map((f) => (
              <li key={f.kunci}>
                <p className="text-[11.5px] leading-snug text-ink-3 italic">{f.dugaan}</p>
                <p className="mt-1 text-[13px] font-semibold text-ink">{f.judul}</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{f.uraian}</p>
                <p className="mt-1 text-[12px] leading-snug text-gem">{f.akibat}</p>
              </li>
            ))}
          </ul>
        </Lipat>

        {BATASAN.length > 0 && (
          <Lipat judul={t.batasJudul} ringkas={t.batasRingkas}>
            <p className="mb-2 text-[12.5px] leading-snug text-ink-2">{t.batasIsi}</p>
            <ul className="flex flex-col gap-1.5">
              {BATASAN.map((b) => (
                <li key={b} className="text-[12.5px] leading-snug text-ink-2">
                  • {b}
                </li>
              ))}
            </ul>
          </Lipat>
        )}

        <Lipat judul={t.estimasiJudul} ringkas={t.estimasiRingkas} nada="text-jebakan">
          <p className="text-[12.5px] leading-snug text-ink-2">{t.estimasiIsi}</p>
        </Lipat>
      </div>

      <p className="text-[11.5px] leading-snug text-ink-3">{t.diukur(DIUKUR)}</p>
    </div>
  )
}

/** Satu bagian yang bisa dibuka. Ringkasannya satu baris, isinya utuh. */
function Lipat({
  judul,
  ringkas,
  nada,
  children,
}: {
  judul: string
  ringkas: string
  nada?: string
  children: ReactNode
}) {
  return (
    <details className="group overflow-hidden rounded-lg border border-line">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 transition-colors hover:bg-surface-2">
        <span className={`eyebrow flex-1 ${nada ?? ''}`}>{judul}</span>
        <span className="hidden shrink-0 text-[11.5px] text-ink-3 sm:inline">{ringkas}</span>
        <svg
          width="11"
          height="11"
          viewBox="0 0 12 12"
          aria-hidden
          className="shrink-0 text-ink-3 transition-transform duration-200 ease-liquid group-open:rotate-90"
        >
          <path d="M4 1.5 8.5 6 4 10.5" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" />
        </svg>
      </summary>
      <div className="border-t border-line/60 px-3 py-3">{children}</div>
    </details>
  )
}

