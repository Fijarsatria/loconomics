/**
 * Dari mana angkanya — daftar sumber, cakupan, dan batasannya.
 *
 * Berkas ini lahir dari satu permintaan yang terdengar sederhana: "buatkan
 * daftar data mana yang resmi". Yang membuatnya tidak sederhana adalah bahwa
 * daftar seperti itu cuma berguna kalau ia TIDAK BISA berbohong — dan daftar
 * sumber yang ditulis tangan selalu berbohong ke arah yang sama, yaitu ke arah
 * yang menguntungkan penulisnya. Enam angka yang pernah ditulis tangan di
 * `CLAUDE.md` untuk keperluan ini sudah meleset seluruhnya saat diperiksa.
 *
 * Maka seluruh isinya datang dari `lib/ringkasan-data.ts`, yang DIBUAT
 * `pipeline/s7_publish.py --ekspor` dari basis data yang sama dengan yang
 * menggambar petanya. Tidak ada satu pun angka di layar ini yang diketik
 * manusia. Kalau sebuah sumber berhenti mengisi apa pun, cakupannya di sini
 * turun tanpa ada yang perlu ingat menyuntingnya.
 *
 * Pemisahan RESMI dan PERKIRAAN adalah isi pokoknya, bukan hiasan. Sumber
 * berjenis `perkiraan` tidak pernah mengisi satu kolom pun di `hex_features`,
 * tidak pernah menghitung skor, dan tidak pernah mewarnai peta — dan satu-
 * satunya cara pembaca bisa mempercayai pernyataan itu adalah kalau yang
 * lemah ikut tercantum dengan namanya sendiri, bukan disembunyikan di dokumen
 * lain.
 */

import { BATASAN, DIUKUR, RINGKASAN, SUMBER, TEMUAN } from '../lib/ringkasan-data'
import { useTeks } from '../lib/bahasa'
import { angka } from '../lib/format'

const K = {
  id: {
    judul: 'Dari mana angkanya',
    isi: 'Setiap angka di Loconomics berasal dari sumber yang bisa Anda buka sendiri. Daftar ini dibangkitkan dari basis data yang sama dengan yang menggambar petanya — bukan diketik ulang.',
    diukur: (t: string) => `Diukur ${t}`,
    resmiJudul: 'Data resmi — diukur, dan boleh mengisi kolom',
    resmiIsi: 'Yang di bawah ini menghitung skor, mewarnai peta, dan menentukan lencana keyakinan.',
    perkiraanJudul: 'Perkiraan — tidak pernah mengisi kolom',
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
    batasIsi:
      'Daftar ini sengaja ikut dicetak. Produk data yang cuma menyebut kekuatannya menuntut pembacanya menebak sisanya.',
    temuanJudul: 'Empat pengukuran yang membantah dugaan wajar',
    tutup: 'Tutup',
  },
  en: {
    judul: 'Where the numbers come from',
    isi: 'Every number in Loconomics comes from a source you can open yourself. This list is generated from the same database that draws the map — not retyped.',
    diukur: (t: string) => `Measured ${t}`,
    resmiJudul: 'Official data — measured, and allowed to fill columns',
    resmiIsi: 'These compute the scores, colour the map, and set the confidence badges.',
    perkiraanJudul: 'Estimates — never fill a column',
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
    batasIsi:
      'This list is printed on purpose. A data product that names only its strengths asks its reader to guess the rest.',
    temuanJudul: 'Four measurements that contradict a reasonable guess',
    tutup: 'Close',
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
    <div className="flex flex-col gap-6 px-5 py-5 sm:px-6">
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
        <p className="mt-1.5 max-w-[58ch] text-[13.5px] leading-relaxed text-ink-2">{t.isi}</p>
        <p className="mt-1 text-[11.5px] text-ink-3">{t.diukur(DIUKUR)}</p>
      </header>

      <section>
        <h3 className="eyebrow mb-2">{t.ringkasJudul}</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {angkaRingkas.map(([n, label]) => (
            <div key={label} className="rounded-lg border border-line px-2.5 py-2">
              <p className="tabular text-[18px] leading-none text-ink">{angka(n)}</p>
              <p className="mt-1 text-[11.5px] leading-tight text-ink-3">{label}</p>
            </div>
          ))}
          <div className="rounded-lg border border-line px-2.5 py-2">
            <p className="tabular text-[18px] leading-none text-ink">
              {RINGKASAN.variabelTerisi}/{RINGKASAN.variabelTotal}
            </p>
            <p className="mt-1 text-[11.5px] leading-tight text-ink-3">{t.rVariabel}</p>
          </div>
        </div>
      </section>

      <section>
        <h3 className="eyebrow mb-1 text-gem">{t.resmiJudul}</h3>
        <p className="mb-2 text-[12.5px] leading-snug text-ink-2">{t.resmiIsi}</p>
        <Tabel baris={resmi} t={t} />
      </section>

      {perkiraan.length > 0 && (
        <section>
          <h3 className="eyebrow mb-1 text-jebakan">{t.perkiraanJudul}</h3>
          <p className="mb-2 text-[12.5px] leading-snug text-ink-2">{t.perkiraanIsi}</p>
          <Tabel baris={perkiraan} t={t} />
        </section>
      )}

      {BATASAN.length > 0 && (
        <section>
          <h3 className="eyebrow mb-1">{t.batasJudul}</h3>
          <p className="mb-2 text-[12.5px] leading-snug text-ink-2">{t.batasIsi}</p>
          <ul className="flex flex-col gap-1.5">
            {BATASAN.map((b) => (
              <li
                key={b}
                className="rounded-lg border border-dashed border-line-2 px-2.5 py-2 text-[12.5px] leading-snug text-ink-2"
              >
                {b}
              </li>
            ))}
          </ul>
        </section>
      )}

      {TEMUAN.length > 0 && (
        <section>
          <h3 className="eyebrow mb-2">{t.temuanJudul}</h3>
          <ul className="flex flex-col gap-2">
            {TEMUAN.map((f) => (
              <li key={f.kunci} className="rounded-lg border border-line px-2.5 py-2">
                {/* DUGAAN dulu, temuan menyusul. Temuan yang berdiri sendiri
                    cuma angka; yang membuatnya temuan adalah bahwa ia
                    membantah sesuatu yang wajar dipercaya. */}
                <p className="text-[11.5px] leading-snug text-ink-3 italic">{f.dugaan}</p>
                <p className="mt-1 text-[13px] font-semibold text-ink">{f.judul}</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{f.uraian}</p>
                <p className="mt-1 text-[12px] leading-snug text-gem">{f.akibat}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
