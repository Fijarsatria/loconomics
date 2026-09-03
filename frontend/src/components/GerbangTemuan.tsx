/**
 * Bagian `#temuan` di halaman gerbang: empat kali pengukuran membantah dugaan.
 *
 * Berkas sendiri, bukan disisipkan ke `Gerbang.tsx`, dengan alasan yang sama
 * dengan `GerbangPeta.tsx`: bagian gerbang yang punya sub-komponen sendiri dan
 * tidak dipakai bagian lain. Gerbang sudah 2.900 baris, dan bagian ini membawa
 * grafik batangnya sendiri.
 *
 * SELURUH isinya - termasuk kalimatnya - datang dari `lib/ringkasan-data.ts`,
 * yang dibangkitkan `s7_publish.py --ekspor`. Tidak ada satu pun angka yang
 * ditulis di berkas ini, dan itu bukan kerapian melainkan syarat: halaman
 * gerbang pernah menjanjikan "43 variabel" saat 25 yang terisi, dan keenam
 * angka temuan di `CLAUDE.md` sudah meleset seluruhnya sebelum bagian ini ada.
 *
 * Kalau `TEMUAN` kosong, bagian ini TIDAK dirender sama sekali - bukan dirender
 * dengan judul di atas ruang kosong. Kekosongan yang berbicara lebih buruk
 * daripada kekosongan yang diam.
 */

import type { DeretTemuan, Temuan } from '../lib/ringkasan-data'
import { DIUKUR, TEMUAN } from '../lib/ringkasan-data'

/** Angka Indonesia dengan jumlah desimal yang ditentukan pembangkitnya. */
function angka(nilai: number, desimal: number): string {
  return nilai.toLocaleString('id-ID', {
    minimumFractionDigits: desimal,
    maximumFractionDigits: desimal,
  })
}

/**
 * Grafik batang mendatar. Label DI ATAS batangnya, bukan di sebelahnya.
 *
 * Sebelahnya terlihat lebih rapi di 1440px dan pecah di 390px: label seperti
 * "Stasiun Depok Baru · KRL" memaksa kolom batangnya tinggal beberapa piksel.
 * Di atas, ia benar di lebar berapa pun.
 *
 * Batangnya TIDAK dianimasikan. Panjang batang di sini adalah isi - ia satu-
 * satunya tempat perbandingan antar-baris terbaca - dan isi tidak boleh
 * bergantung pada animasi yang menyala. Kartunya sendiri sudah masuk lewat
 * `g-buram`, yang pemicunya per-elemen dan sudah terbukti.
 */
function Batang({ deret, satuan, desimal }: { deret: DeretTemuan[]; satuan: string; desimal: number }) {
  const puncak = Math.max(...deret.map((d) => d.nilai), 0)

  return (
    <div>
      <ul className="flex flex-col gap-1">
        {deret.map((d, i) => (
          /* Tiap baris bisa disorot DAN difokus keyboard.
             `tabIndex` bukan hiasan aksesibilitas: barisnya membawa satu-
             satunya perbandingan yang jadi pokok temuan, dan perbandingan yang
             hanya bisa dilihat dengan tetikus tidak bisa dilihat separuh
             pembacanya. `aria-label` menyatukan label + angka + satuan jadi
             satu kalimat, karena ketiganya terpisah di layar. */
          <li
            key={d.label}
            tabIndex={0}
            aria-label={`${d.label}: ${angka(d.nilai, desimal)} ${satuan}`}
            className="g-baris-temuan group -mx-3 cursor-default rounded-[13px] px-3 py-2 outline-none transition-colors duration-300"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-baseline gap-2">
                {/* Nomor urut. Deretnya SUDAH terurut dari pembangkitnya;
                    menomorinya cuma membuat urutan itu terbaca tanpa harus
                    membandingkan panjang batang satu per satu. */}
                <span className="tabular shrink-0 text-[10px] font-semibold tabular-nums text-[color:var(--g-ink-4)]/70">
                  {i + 1}
                </span>
                <span
                  className={`truncate text-[12px] leading-snug ${
                    d.tekan
                      ? 'font-semibold text-[color:var(--g-ink)]'
                      : 'text-[color:var(--g-ink-3)]'
                  }`}
                >
                  {d.label}
                </span>
              </span>
              <span
                className={`tabular shrink-0 text-[13px] leading-snug transition-transform duration-300 ease-jelly group-hover:scale-[1.09] group-focus-visible:scale-[1.09] ${
                  d.tekan
                    ? 'font-semibold text-[color:var(--g-teal)]'
                    : 'text-[color:var(--g-ink-2)]'
                }`}
              >
                {angka(d.nilai, desimal)}
              </span>
            </div>
            {/* Rel dinaikkan dari 5px ke 9px. Di 5px batangnya terbaca sebagai
                garis pemisah, bukan sebagai ukuran - dan ukuran itulah isinya. */}
            <div className="mt-2 h-[9px] w-full overflow-hidden rounded-full bg-[color:var(--g-ink)]/[0.07]">
              {/* `Math.max(..., 1.5)` supaya nilai yang sangat kecil tetap
                  terlihat sebagai batang, bukan menghilang jadi rel kosong -
                  0,39 POI/heksagon melawan 6,26 menghasilkan 6% lebar. Yang
                  hilang dari layar terbaca sebagai "tidak ada datanya",
                  padahal justru ia yang jadi pokok temuannya.

                  LEBARNYA tetap tidak dianimasikan, dan itu keputusan lama yang
                  masih berlaku: panjang batang di sini ADALAH isi, dan isi tidak
                  boleh bergantung pada animasi yang menyala. Yang bergerak cuma
                  kilau di atas batang yang ditekan - hiasan murni, dan kalau ia
                  tidak pernah menyala tidak ada satu pun angka yang hilang. */}
              <span
                className={`block h-full rounded-full ${d.tekan ? 'g-batang-tekan' : ''}`}
                style={{
                  width: `${puncak ? Math.max((d.nilai / puncak) * 100, 1.5) : 0}%`,
                  background: d.tekan
                    ? 'linear-gradient(90deg, var(--g-teal) 0%, var(--g-teal-muda) 100%)'
                    : 'var(--g-ink-4)',
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3.5 text-[11px] leading-snug text-[color:var(--g-ink-4)]">{satuan}</p>
    </div>
  )
}

function KartuTemuan({ t }: { t: Temuan }) {
  return (
    <article className="g-buram g-panel grid gap-8 rounded-[26px] p-7 sm:p-9 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-12">
      {/* --- Kiri: dugaan yang dibantah, lalu temuannya ------------------- */}
      <div className="min-w-0">
        <p className="eyebrow mb-2 text-[color:var(--g-ink-4)]">Yang wajar dikira</p>
        {/* Dugaannya dikutip apa adanya. Ia tidak dicoret dan tidak diberi
            tanda salah: sebagian besarnya memang dugaan yang masuk akal, dan
            itu justru yang membuat pengukurannya layak diceritakan. */}
        <p className="mb-6 border-l-2 border-[color:var(--g-ink)]/15 pl-4 text-[14px] italic leading-relaxed text-[color:var(--g-ink-3)]">
          {t.dugaan}
        </p>

        <h3 className="papan text-[clamp(1.15rem,2.2vw,1.55rem)] leading-tight text-balance">
          {t.judul}
        </h3>

        <p className="mt-4 text-[13.5px] leading-relaxed text-[color:var(--g-ink-2)]">{t.uraian}</p>

        <div className="mt-6 rounded-[16px] bg-[color:var(--g-teal)]/8 px-5 py-4">
          <p className="eyebrow mb-1.5 text-[color:var(--g-teal)]">Yang berubah di produk</p>
          <p className="text-[13px] leading-relaxed text-[color:var(--g-ink-2)]">{t.akibat}</p>
        </div>
      </div>

      {/* --- Kanan: angkanya, lalu bahan perbandingannya ------------------ */}
      <div className="flex min-w-0 flex-col gap-7 lg:border-l lg:border-[color:var(--g-ink)]/10 lg:pl-10">
        <div>
          <p className="papan tabular text-[clamp(2.1rem,5vw,3rem)] leading-none text-[color:var(--g-teal)]">
            {t.angka}
          </p>
          <p className="mt-2 text-[12.5px] leading-snug text-[color:var(--g-ink-3)]">{t.satuan}</p>
        </div>
        <Batang deret={t.deret} satuan={t.deretSatuan} desimal={t.desimal} />
      </div>
    </article>
  )
}

export default function BagianTemuan() {
  if (!TEMUAN.length) return null

  return (
    <div className="mx-auto w-full max-w-[74rem]">
      <div className="mx-auto max-w-[46rem] text-center">
        <p className="g-tirai eyebrow mb-4 text-[color:var(--g-ink-3)]">Apa kata datanya</p>
        <h2 className="g-tirai papan text-[clamp(1.7rem,4.4vw,3rem)] leading-tight">
          {TEMUAN.length === 1
            ? 'Satu kali data membantah dugaan'
            : `${TEMUAN.length} kali data membantah dugaan`}
        </h2>
        <p className="g-tirai mx-auto mt-5 max-w-[40rem] text-[14.5px] leading-relaxed text-[color:var(--g-ink-2)]">
          Bukan daftar fitur. Ini yang berubah di produk karena angkanya keluar berbeda dari yang
          diduga — dan tiap angkanya dihitung ulang dari basis data pada {DIUKUR}, termasuk
          kalimat yang menerangkannya.
        </p>
      </div>

      <div className="mt-14 flex flex-col gap-6">
        {TEMUAN.map((t) => (
          <KartuTemuan key={t.kunci} t={t} />
        ))}
      </div>
    </div>
  )
}
