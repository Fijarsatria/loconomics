/**
 * Dek kartu peta untuk halaman gerbang.
 *
 * Enam kawasan pilot, enam kartu, masing-masing memperlihatkan LAYER dan
 * BASEMAP yang berbeda — dan tidak satu pun dari keenamnya adalah peta yang
 * hidup. Semuanya `<img>`, dan halaman ini tidak memuat MapLibre sama sekali.
 *
 * Gambar dan angkanya sama-sama dibuat `scripts/potret-kartu.mjs`, dari data
 * yang sama pada detik yang sama — jadi gambar dan keterangannya tidak akan
 * pernah bercerita hal yang berbeda. Susunan dek (kawasan mana, layer mana,
 * miring berapa derajat) juga tinggal di manifes itu, bukan di sini: satu
 * tempat, supaya tidak ada dua daftar yang harus dijaga sejalan.
 *
 * TIGA LAPIS, TIGA PEMILIK GERAK. Tiap lapis memegang properti transform yang
 * berbeda, dan itu bukan kerapian belaka — GSAP menulis seluruh transform
 * sekaligus, jadi dua animasi yang menyentuh properti yang sama pada satu
 * elemen akan saling menimpa.
 *
 *   .g-melayang       kemiringan statis            (rotate)
 *   .g-apung          melayang naik-turun sendiri  (animasi CSS)
 *   .g-kartu-masuk    masuk dan keluar layar        (y, opacity, scale)
 *   button            condong mengikuti kursor      (rotateX, rotateY)
 *
 * KENAPA TIDAK ADA GAYA SATELIT. Diminta, dan sengaja belum dipakai: ubinnya
 * datang dari api.mapbox.com dan api.maptiler.com dengan kunci milik orang
 * lain, sementara ketentuan A.3 menuntut basemap MAPID Maps. Lihat catatan
 * panjangnya di `config.ts`. Kalau pemilik repo memutuskan gaya itu boleh,
 * ganti satu kata di `DAFTAR` pada skrip pemotretnya lalu jalankan ulang.
 */

import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'

import { KAWASAN_PILOT, KUADRAN, LAYER, URUTAN_KUADRAN, type NamaLayer } from '../config'
import { KARTU_GERBANG, type KartuGerbang } from '../lib/kartu-gerbang'

export interface PilihanKawasan {
  kawasan: string
  layer: NamaLayer
}

/** Wajib ada walaupun petanya sudah jadi gambar diam. */
const ATRIBUSI = '© MAPID Maps · OpenMapTiles · OpenStreetMap'

/**
 * Sebaris tipis: berapa banyak heksagon kawasan ini jatuh di tiap kuadran.
 *
 * Satu batang, bukan empat angka. Yang ingin diketahui orang di kartu sekecil
 * ini bukan jumlahnya melainkan BENTUKNYA — kawasan yang didominasi hijau
 * terbaca berbeda dari kawasan yang separuhnya merah, dalam sekali lihat.
 * Angkanya tetap ada di `title` bagi yang menghitung.
 */
function BatangKuadran({ kuadran, n }: { kuadran: Record<string, number>; n: number }) {
  if (!n) return null
  const bagian = URUTAN_KUADRAN.map((k) => ({ k, jumlah: kuadran[k] ?? 0 })).filter(
    (x) => x.jumlah > 0,
  )
  const judul = bagian.map((x) => `${KUADRAN[x.k].nama} ${x.jumlah}`).join(' · ')
  return (
    <div
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--g-ink)]/8"
      title={judul}
      aria-label={judul}
    >
      {bagian.map((x) => (
        <span
          key={x.k}
          style={{ width: `${(x.jumlah / n) * 100}%`, background: KUADRAN[x.k].warna }}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Satu kartu
// ---------------------------------------------------------------------------

function KartuPeta({
  d,
  onBuka,
}: {
  d: KartuGerbang
  onBuka: (p: PilihanKawasan) => void
}) {
  const tombol = useRef<HTMLButtonElement>(null)
  const info = KAWASAN_PILOT.find((k) => k.nama === d.kawasan)

  // --- Condong mengikuti kursor --------------------------------------------
  //
  // Dua penjaga sebelum dipasang, keduanya bukan formalitas. `hover:hover`
  // menolak layar sentuh — di sana `pointermove` cuma menyala saat jari sudah
  // menempel. `prefers-reduced-motion` menolak gerak yang tidak diminta.
  //
  // HANYA rotateX/rotateY. `y` sengaja tidak disentuh: dua lapis di atasnya
  // sudah memakainya untuk melayang dan untuk masuk-keluar layar.
  useEffect(() => {
    const n = tombol.current
    if (!n) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (!window.matchMedia('(hover: hover)').matches) return

    const set = gsap.quickSetter(n, 'css')
    let rx = 0
    let ry = 0
    let tRx = 0
    let tRy = 0
    // Pusat kartu dan ukurannya dalam keadaan diam, koordinat viewport.
    let px = 0
    let py = 0
    let w = 1
    let h = 1

    // Diukur saat kursor MASUK, bukan tiap kali kursor bergerak - satu layout
    // paksa per hover, bukan satu per kejadian pointer.
    //
    // Kartunya bisa saja masih memantul pulang saat kursor kembali masuk, jadi
    // yang diambil dipilih supaya kebal terhadap putaran yang sedang berjalan:
    // PUSAT kotaknya (memutar pada porosnya sendiri tidak menggeser pusat) dan
    // `offsetWidth`/`offsetHeight` (ukuran tata letak, tanpa transform). Lebar
    // kotak ukurnya sendiri memang mengembang saat kartunya miring - itulah
    // yang tidak boleh ikut terbaca.
    const ukur = () => {
      const r = n.getBoundingClientRect()
      px = r.left + r.width / 2
      py = r.top + r.height / 2
      w = n.offsetWidth || 1
      h = n.offsetHeight || 1
    }

    let id = 0
    let sebelum = 0
    const TAU = 0.08
    const bingkai = (t: number) => {
      id = requestAnimationFrame(bingkai)
      const dt = sebelum ? Math.min((t - sebelum) / 1000, 0.1) : 1 / 60
      sebelum = t
      const k = 1 - Math.exp(-dt / TAU)
      rx += (tRx - rx) * k
      ry += (tRy - ry) * k
      set({ rotateX: rx, rotateY: ry })
      if (Math.abs(tRx - rx) < 0.01 && Math.abs(tRy - ry) < 0.01) {
        rx = tRx
        ry = tRy
        set({ rotateX: rx, rotateY: ry })
        cancelAnimationFrame(id)
        id = 0
      }
    }
    const jalan = () => {
      if (!id) {
        sebelum = 0
        id = requestAnimationFrame(bingkai)
      }
    }

    const masuk = () => {
      gsap.killTweensOf(n)
      rx = (gsap.getProperty(n, 'rotateX') as number) || 0
      ry = (gsap.getProperty(n, 'rotateY') as number) || 0
      ukur()
    }
    const geser = (e: PointerEvent) => {
      // Dinormalkan ke -0,5..0,5 supaya sudutnya tidak bergantung ukuran kartu.
      tRx = -((e.clientY - py) / h) * 13
      tRy = ((e.clientX - px) / w) * 17
      jalan()
    }
    // Pulangnya tetap milik GSAP - pantulan elastisnya watak kartu ini, dan ia
    // cuma sekali per lepas-hover. Loop di atas dihentikan lebih dulu supaya
    // tidak pernah ada dua yang menulis putaran yang sama.
    const pulang = () => {
      if (id) {
        cancelAnimationFrame(id)
        id = 0
      }
      gsap.set(n, { rotateX: rx, rotateY: ry })
      gsap.to(n, {
        rotateX: 0,
        rotateY: 0,
        duration: 0.9,
        ease: 'elastic.out(1, 0.5)',
        onUpdate: () => {
          rx = gsap.getProperty(n, 'rotateX') as number
          ry = gsap.getProperty(n, 'rotateY') as number
        },
      })
      tRx = 0
      tRy = 0
    }

    n.addEventListener('pointerenter', masuk)
    n.addEventListener('pointermove', geser, { passive: true })
    n.addEventListener('pointerleave', pulang)
    return () => {
      n.removeEventListener('pointerenter', masuk)
      n.removeEventListener('pointermove', geser)
      n.removeEventListener('pointerleave', pulang)
      if (id) cancelAnimationFrame(id)
      gsap.killTweensOf(n)
    }
  }, [])

  const besar = d.utama
  const kosong = d.sorotan.nilai === '—'

  return (
    <div
      className={`g-melayang ${besar ? 'sm:col-span-2 lg:row-span-2' : ''}`}
      // Kemiringan statis DI SINI, sebagai transform biasa. Dulu ia dipasang
      // GSAP karena GSAP menulis seluruh transform sekaligus dan akan
      // menimpanya; sejak melayangnya pindah ke pembungkus di dalam, tidak ada
      // lagi yang menulis transform elemen ini selain baris ini.
      style={{ perspective: 1200, transform: `rotate(${d.condong}deg)` }}
    >
      {/* Pembungkus khusus untuk melayang. Ada supaya keyframe-nya bisa berisi
          angka harfiah: keyframe yang memuat `var()` TIDAK BISA dikomposit -
          browser harus menghitung ulang gaya tiap bingkai di utas utama, dan
          itu terukur menggandakan Recalc style. */}
      <div className="g-apung h-full">
      <div className="g-kartu-masuk h-full">
        <button
          ref={tombol}
          onClick={() => onBuka({ kawasan: d.kawasan, layer: d.layer })}
          aria-label={`Buka ${d.kawasan} dengan layer ${LAYER[d.layer].nama}`}
          className="g-kartu-peta group flex h-full w-full cursor-pointer flex-col rounded-[20px] p-3 text-left"
          style={{ transformStyle: 'preserve-3d' }}
        >
          <div className="mb-2.5 flex items-center gap-2 px-1 pt-0.5">
            <span
              className={`papan min-w-0 flex-1 truncate text-[color:var(--g-ink)] ${besar ? 'text-[19px]' : 'text-[14px]'}`}
            >
              {d.kawasan}
            </span>
            <span className="shrink-0 rounded-full bg-[color:var(--g-ink)]/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--g-ink-3)]">
              {info?.moda ?? '—'}
            </span>
          </div>

          {/* Gambar dipasang MUTLAK di dalam kotak yang mengembang, bukan
              diberi tinggi sendiri.

              Kartu unggulan menempati dua baris grid, jadi kotaknya lebih
              tinggi daripada tinggi apa pun yang bisa ditulis di gambarnya —
              dan gambar bertinggi tetap di dalam kotak yang mengembang
              meninggalkan pita kosong di bawahnya. `inset-0` membuatnya selalu
              seukuran kotaknya, berapa pun kotaknya jadi. */}
          <div
            className={`relative w-full flex-1 overflow-hidden rounded-[13px] bg-[color:var(--g-kaca-isi-pil)] ${
              besar ? 'min-h-[clamp(280px,40vh,480px)]' : 'min-h-[clamp(150px,19vh,220px)]'
            }`}
          >
            <img
              src={`/kartu/${d.berkas}.webp`}
              alt={`Peta ${LAYER[d.layer].nama} di ${d.kawasan}`}
              /* Ukuran intrinsik ditulis supaya peramban menyediakan ruangnya
                 sebelum berkasnya sampai — tanpa ini tata letak melompat saat
                 tiap gambar selesai dimuat, dan lompatan itu menggeser seluruh
                 pengukuran ScrollTrigger di bawahnya. */
              width={d.lebar}
              height={d.tinggi}
              loading="lazy"
              decoding="async"
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover"
            />

            <span
              className={`pointer-events-none absolute bottom-2 left-2 rounded-full px-2.5 py-1 text-[10.5px] font-semibold ${
                d.gelap ? 'bg-black/55 text-white/90' : 'bg-white/85 text-[color:var(--g-ink-2)]'
              }`}
            >
              {LAYER[d.layer].nama}
            </span>

            {/* Atribusi ditulis sendiri: kontrol MapLibre tidak ikut terpotret,
                dan ketentuan A.3 tidak gugur cuma karena gambarnya statis. */}
            <span
              className={`pointer-events-none absolute bottom-1.5 right-2 max-w-[62%] truncate text-[8.5px] ${
                d.gelap ? 'text-white/55' : 'text-[color:var(--g-ink)]/45'
              }`}
            >
              {ATRIBUSI}
            </span>
          </div>

          {/* --- Keterangan. Angkanya dari data, bukan dari perasaan. ------ */}
          <div className="px-1 pt-3">
            <div className="flex items-baseline gap-2.5">
              {/* Nilai yang belum ada TIDAK dicetak sebesar nilai yang ada.
                  Em-dash setinggi 30px terbaca sebagai garis nyasar, bukan
                  sebagai "belum ada" - dan yang kosong memang tidak berhak
                  mengambil ruang sebanyak yang terisi. */}
              <span
                className={
                  kosong
                    ? 'shrink-0 leading-none text-[18px] text-[color:var(--g-ink-4)]'
                    : `papan tabular shrink-0 leading-none text-[color:var(--g-ink)] ${besar ? 'text-[30px]' : 'text-[22px]'}`
                }
              >
                {d.sorotan.nilai}
              </span>
              <span className="min-w-0 flex-1 text-[11.5px] leading-snug text-[color:var(--g-ink-3)]">
                {d.sorotan.label}
              </span>
              <span className="tabular shrink-0 text-[11px] text-[color:var(--g-ink-4)]">{d.n} heks</span>
            </div>

            <div className="mt-2.5">
              <BatangKuadran kuadran={d.kuadran} n={d.n} />
            </div>

            <p className="mt-3 flex items-center gap-1.5 border-t border-[color:var(--g-ink)]/10 pt-2.5 text-[11.5px] text-[color:var(--g-ink-3)]">
              <span className="min-w-0 flex-1 truncate">{LAYER[d.layer].pertanyaan}</span>
              <span
                className="shrink-0 transition-transform duration-300 ease-jelly group-hover:translate-x-1"
                aria-hidden
              >
                →
              </span>
            </p>
          </div>
        </button>
      </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dek
// ---------------------------------------------------------------------------

export default function DekKawasan({ onBuka }: { onBuka: (p: PilihanKawasan) => void }) {
  return (
    // TIGA kolom, bukan empat, dan itu aritmetika bukan selera: kartu unggulan
    // memakan 2 x 2 sel, jadi lima kartu sisanya cuma pas kalau barisnya
    // bertiga — dua di sebelah kartu unggulan, tiga di baris bawahnya.
    //
    // `w-full` ada karena bagian ini wadah flex yang perataan silangnya bukan
    // stretch; tanpanya `max-w` tidak pernah tercapai.
    <div className="mx-auto grid w-full max-w-[80rem] gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {KARTU_GERBANG.map((d) => (
        <KartuPeta key={d.berkas} d={d} onBuka={onBuka} />
      ))}
    </div>
  )
}
