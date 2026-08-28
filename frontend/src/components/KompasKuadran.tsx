/**
 * Kompas Kuadran — objek tanda tangan antarmuka ini.
 *
 * Ia merangkap tiga pekerjaan yang biasanya dipecah jadi tiga komponen terpisah:
 *
 *   1. LEGENDA  — empat sel, empat warna, empat glif
 *   2. FILTER   — klik satu sel, peta menyaring ke kuadran itu
 *   3. POSISI   — heksagon terpilih muncul sebagai titik pada koordinat aslinya
 *
 * Menggabungkannya bukan penghematan tempat. Kuadran ADALAH tesis produk ini:
 * sumbu datar "bagaimana lokasi terlihat", sumbu tegak "apa kata datanya", dan
 * seluruh gunanya produk ini terletak pada dua sudut tempat keduanya tidak
 * sejalan. Legenda yang terpisah dari peta menjadikan tesis itu keterangan kaki;
 * disatukan, ia jadi alat.
 *
 * Komponen yang sama dipakai pada dua ukuran. Kecil, melayang di atas peta.
 * Besar, ia menjadi diagram sebar RiskRadar dengan seluruh heksagon sebagai
 * titik — sumbu yang sama, warna yang sama, glif yang sama. Pengguna yang sudah
 * paham yang kecil tidak perlu belajar ulang yang besar.
 *
 * BISA DIRINGKAS. Yang kecil pun memakan sudut kiri bawah peta, dan kadang yang
 * ditutupinya justru heksagon yang sedang dilihat. Tombol di kanan atas kartu
 * menyusutkannya jadi satu baris glif.
 *
 * Ringkas TIDAK sama dengan sembunyi, dan bedanya disengaja: keempat glif tetap
 * bisa diklik dalam keadaan ringkas. Kalau meringkasnya sekalian mematikan
 * filter, orang jadi harus memilih antara melihat peta dan menyaringnya —
 * padahal keduanya adalah satu pekerjaan yang sama.
 */

import { KUADRAN, URUTAN_KUADRAN } from '../config'
import type { Kuadran as NamaKuadran, TitikKuadran } from '../types'
import { Glif } from './primitif'

interface Props {
  /** Kuadran yang sedang disaring. null = tidak ada filter. */
  saring: NamaKuadran | null
  onSaring: (k: NamaKuadran | null) => void
  /** Heksagon terpilih, digambar sebagai titik pada posisi aslinya. */
  posisi?: { x: number | null; y: number | null; kuadran: NamaKuadran | null } | null
  /** Seluruh titik. Kalau ada, kompas berubah jadi diagram sebar penuh. */
  sebar?: TitikKuadran[]
  batas?: { x: number | null; y: number | null }
  onPilih?: (h3: string) => void
  besar?: boolean
  /** Tombol pembuka diagram penuh, ditaruh DI DALAM kartu. Sebagai elemen
      melayang terpisah ia menabrak kartunya sendiri di layar sempit. */
  onBukaPenuh?: () => void
}

const SEL: Record<string, { kolom: 0 | 1; baris: 0 | 1 }> = Object.fromEntries(
  Object.values(KUADRAN).map((q) => [q.kunci, { kolom: q.sel[0], baris: q.sel[1] }]),
)

/**
 * Bantalan tepi kotak, dalam persen.
 *
 * Titik berskor 0 atau 100 tepat di tepi akan tergunting separuh oleh
 * overflow-hidden, dan justru titik-titik ekstrem itu yang paling ingin dilihat.
 */
const BANTAL = 3

/** Prestise 0..1 -> persen dari kiri. */
const keX = (x: number) => BANTAL + x * (100 - 2 * BANTAL)

/** Skor peluang 0..100 -> persen dari bawah. */
const keY = (y: number) => BANTAL + (y / 100) * (100 - 2 * BANTAL)

/**
 * Batas bawaan kalau backend belum menjawab: tengah kotak.
 *
 * Ini SATU-SATUNYA tempat 0,5/50 masih boleh muncul. Dulu ia dipakai sebagai
 * batas sungguhan - grid 2x2 kaku - dan itu bugnya: pipeline membelah di MEDIAN
 * (x 0,413 · y 40,7), bukan di tengah kotak, jadi 40% titik digambar di sel
 * yang bertentangan dengan labelnya sendiri. Sebuah heksagon JEBAKAN_GENGSI
 * berskor 36 muncul di petak HINDARI, dan itu bukan salah baca: petaknya memang
 * salah gambar.
 */
const BATAS_BAWAAN = { x: 0.5, y: 50 }

export default function KompasKuadran({
  saring,
  onSaring,
  posisi,
  sebar,
  batas,
  onPilih,
  besar,
  onBukaPenuh,
}: Props) {
  // Yang KECIL tidak lagi punya lebar sama sekali - ia mengambil sisa ruang.
  //
  // Dulu angkanya 232px, dihitung tangan sebagai "17rem dikurangi bantalan
  // kartu dan label sumbu tegak". Hitungannya meleset 10px: bantalan kartu 2 x
  // 14px dan label tegak + jarak 22px menyisakan 222px, bukan 232px. Karena
  // kotaknya `shrink-0`, kelebihan itu tidak dikembalikan - ia menembus
  // bantalan kanan kartu, lalu terpotong `overflow-hidden` milik kolomnya.
  // Diukur di 1440px: tepi kanan kotak dan tepi kanan kartu sama-sama di 362px,
  // jadi bantalan kanan kartu hilang sepenuhnya dan kata "mahal" terpenggal
  // jadi "maha".
  //
  // `flex-1 min-w-0` + `aspect-square` menghapus seluruh kelas kesalahan itu:
  // tidak ada lagi angka yang harus dijaga tetap cocok dengan lebar kartu,
  // berapa pun kartunya nanti diubah.
  //
  // Yang besar tetap punya ukuran, tetapi TIDAK 430px tetap. Angka tetap
  // memaksa dialognya lebih tinggi dari layar pendek, dan satu-satunya jalan
  // keluar waktu itu `overflow-auto` - diagram sebar yang harus di-scroll untuk
  // dilihat utuh sudah berhenti jadi diagram. `min()` membuatnya mengalah pada
  // layar, bukan sebaliknya.
  const sisi = 'min(430px, 44vh)'

  // Garis pemisah sungguhan. Sel, titik sebar, dan penanda posisi WAJIB memakai
  // angka yang sama - kalau tidak, label dan tempatnya kembali bertentangan.
  const belahX = keX(batas?.x ?? BATAS_BAWAAN.x)
  const belahY = keY(batas?.y ?? BATAS_BAWAAN.y)

  return (
    <div className={besar ? '' : 'kaca pop-naik-kiri rounded-lg p-3.5'}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="eyebrow">Kompas Kuadran</h3>
        <div className="flex items-center gap-1">
          {saring && (
            <button
              onClick={() => onSaring(null)}
              className="cursor-pointer rounded-full px-2.5 py-1 text-[12.5px] font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              Tampilkan semua
            </button>
          )}
        </div>
      </div>

      <div className="flex items-stretch gap-2">
        {/* Sumbu tegak. Ditulis vertikal karena mendampingi sumbu yang vertikal —
            bukan demi gaya. */}
        <span className="eyebrow shrink-0 self-center [writing-mode:vertical-rl] rotate-180 tracking-[0.14em]">
          Skor peluang
        </span>

        <div
          className={besar ? 'min-w-0 shrink-0' : 'min-w-0 flex-1'}
          style={besar ? { width: sisi } : undefined}
        >
          {/* Bingkai kotak dicabut 23 Agustus 2026.
              Kartu kaca sudah satu kotak; menggambar kotak kedua di dalamnya
              membuat dua bingkai bersarang yang berebut jadi tepi - dan yang
              dalam selalu kalah karena ia yang paling dekat dengan isinya.
              Batas kuadran sudah digambar oleh salib median di bawah, dan
              luasnya sudah dinyatakan oleh label sumbu; bingkainya tidak pernah
              menambahkan informasi apa pun. */}
          <div
            className={`relative w-full overflow-hidden rounded-md ${besar ? '' : 'aspect-square'}`}
            style={besar ? { width: sisi, height: sisi } : undefined}
          >
            {URUTAN_KUADRAN.map((kunci) => {
              const q = KUADRAN[kunci]
              const aktif = saring === kunci
              const redup = saring !== null && !aktif
              const sel = SEL[kunci]

              return (
                <button
                  key={kunci}
                  onClick={() => onSaring(aktif ? null : (kunci as NamaKuadran))}
                  aria-pressed={aktif}
                  title={q.arti}
                  className="group absolute cursor-pointer text-left transition-opacity duration-200"
                  style={{
                    // Kotak mutlak, bukan sel grid. Grid hanya bisa membelah di
                    // tempat yang ditentukan template-nya; batas kuadran ada di
                    // median, dan median tidak pernah jatuh di tengah kotak.
                    left: sel.kolom === 0 ? 0 : `${belahX}%`,
                    right: sel.kolom === 0 ? `${100 - belahX}%` : 0,
                    top: sel.baris === 0 ? 0 : `${100 - belahY}%`,
                    bottom: sel.baris === 0 ? `${belahY}%` : 0,
                    background: aktif ? q.lembut : 'transparent',
                    opacity: redup ? 0.38 : 1,
                    borderRight: sel.kolom === 0 ? '1px solid var(--color-line-2)' : undefined,
                    borderBottom: sel.baris === 0 ? '1px solid var(--color-line-2)' : undefined,
                  }}
                >
                  <span
                    className={`absolute inset-0 transition-colors ${
                      aktif ? '' : 'group-hover:bg-surface-2/70'
                    }`}
                  />
                  {/* Label duduk di sudut LUAR petaknya, bukan selalu di kiri
                      atas. Perempatan median adalah tempat titik paling padat;
                      label yang menempel ke situ pasti tertimpa. Menjauhkannya
                      ke sudut terluar membuat keduanya tidak pernah berebut
                      ruang, berapa pun mediannya bergeser. */}
                  <span
                    className={`relative flex h-full flex-col ${
                      besar ? 'gap-1.5 p-3.5' : 'gap-1 p-2.5'
                    } ${sel.baris === 1 ? 'justify-end' : ''} ${
                      sel.kolom === 1 ? 'items-end text-right' : ''
                    }`}
                  >
                    <Glif kuadran={kunci} ukuran={besar ? 18 : 14} />
                    <span
                      className={`font-semibold leading-[1.12] ${besar ? 'text-[13px]' : 'text-[11.5px]'}`}
                      style={{ color: q.warna ?? 'var(--color-ink-3)' }}
                    >
                      {q.nama}
                    </span>
                  </span>
                </button>
              )
            })}

            {/* Titik sebar — hanya pada mode besar */}
            {besar &&
              sebar?.map((t) =>
                t.x_prestise === null || t.y_peluang === null ? null : (
                  <button
                    key={t.h3_index}
                    onClick={() => onPilih?.(t.h3_index)}
                    title={`${t.h3_index} · peluang ${t.y_peluang?.toFixed(1)} · risiko ${t.risiko}`}
                    className="absolute -translate-x-1/2 translate-y-1/2 cursor-pointer rounded-full transition-transform hover:scale-150"
                    style={{
                      left: `${keX(t.x_prestise)}%`,
                      bottom: `${keY(t.y_peluang)}%`,
                      width: 7,
                      height: 7,
                      // Cincin permukaan 2px supaya titik yang bertumpuk tetap
                      // bisa dihitung, bukan meleleh jadi satu gumpalan.
                      background: t.kuadran
                        ? (KUADRAN[t.kuadran].warna ?? 'var(--color-line-2)')
                        : 'var(--color-line-2)',
                      boxShadow: '0 0 0 1.5px var(--color-surface)',
                      opacity: t.risiko === 'AMAN' ? 0.75 : 1,
                    }}
                  >
                    <span className="sr-only">{t.h3_index}</span>
                  </button>
                ),
              )}

            {/* Posisi heksagon terpilih */}
            {!besar && posisi?.x != null && posisi.y != null && (
              <span
                className="pointer-events-none absolute z-10 -translate-x-1/2 translate-y-1/2 rounded-full transition-[left,bottom] duration-500 ease-liquid"
                style={{
                  left: `${keX(posisi.x)}%`,
                  bottom: `${keY(posisi.y)}%`,
                  width: 10,
                  height: 10,
                  background: posisi.kuadran
                    ? (KUADRAN[posisi.kuadran].warna ?? 'var(--color-ink)')
                    : 'var(--color-ink)',
                  boxShadow: '0 0 0 2px var(--color-surface), 0 0 0 3.5px var(--color-ink)',
                }}
                aria-hidden
              />
            )}
          </div>

          {/* Sumbu datar.
              Grid [auto 1fr auto], bukan `justify-between`. Bedanya: dengan
              justify-between judul sumbu duduk di tengah SISA ruang, jadi ia
              bergeser tiap kali salah satu ujungnya berubah panjang. Kolom 1fr
              membuatnya terpusat pada kotaknya sendiri, dan itu kolom yang sama
              yang membelah kotak di atasnya. */}
          <div className="mt-1.5 grid grid-cols-[auto_1fr_auto] items-baseline gap-1.5">
            <span className="text-[10.5px] text-ink-3">biasa</span>
            <span className="eyebrow whitespace-nowrap text-center text-[10px] tracking-[0.08em]">
              Prestise visual
            </span>
            <span className="text-[10.5px] text-ink-3">mahal</span>
          </div>
        </div>
      </div>

      {besar && (
        <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2.5 border-t border-line pt-3.5">
          {URUTAN_KUADRAN.map((kunci) => {
            const q = KUADRAN[kunci]
            return (
              <li key={kunci} className="flex gap-2.5">
                <span className="mt-[4px] shrink-0">
                  <Glif kuadran={kunci} ukuran={13} />
                </span>
                <span className="text-[12.5px] leading-snug">
                  <span
                    className="font-semibold"
                    style={{ color: q.warna ?? 'var(--color-ink-2)' }}
                  >
                    {q.nama}
                  </span>
                  <span className="block text-ink-3">{q.ringkas}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {!besar && (
        <div className="mt-3 border-t border-line/70 pt-2.5">
          {posisi?.x == null && (
            <p className="mb-2 text-[12px] leading-snug text-ink-3">
              Klik satu kuadran untuk menyaring peta.
            </p>
          )}
          {onBukaPenuh && (
            <button
              onClick={onBukaPenuh}
              className="cursor-pointer text-[12.5px] font-semibold text-ink-2 underline decoration-line-2 underline-offset-[3px] transition-colors hover:text-ink"
            >
              Buka diagram penuh
            </button>
          )}
        </div>
      )}
    </div>
  )
}
