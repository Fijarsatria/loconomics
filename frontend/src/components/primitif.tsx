/**
 * Potongan kecil yang dipakai di banyak tempat.
 *
 * Dua di antaranya menegakkan aturan proyek, bukan sekadar merapikan tampilan:
 *
 *   Badge   — setiap skor wajib membawa tingkat keyakinannya. Komponen ini yang
 *             membuatnya sulit dilupakan: ia diminta oleh tipe di setiap tempat
 *             skor ditampilkan.
 *   Angka   — nilai kosong ditampilkan sebagai "belum ada data", TIDAK PERNAH
 *             sebagai 0. "Nol transaksi tercatat" dan "belum ada yang mensurvei
 *             di sini" adalah dua pernyataan yang sangat berbeda, dan yang kedua
 *             tidak boleh menyamar jadi yang pertama.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as EventPapanKetik,
  type ReactNode,
} from 'react'

import { createPortal } from 'react-dom'

import { IDENTITAS, KEYAKINAN, KUADRAN, RODA_WARNA } from '../config'
import type { BadgeKeyakinan, Kuadran as NamaKuadran } from '../types'

/** Nilai yang belum ada. Selalu terlihat berbeda dari nol. */
export function Kosong({ teks = 'belum ada data' }: { teks?: string }) {
  return <span className="text-ink-3 italic text-[14px]">{teks}</span>
}

export function Angka({
  nilai,
  satuan,
  besar,
}: {
  nilai: string | null
  satuan?: string
  besar?: boolean
}) {
  if (nilai === null) return <Kosong />
  return (
    <span className={besar ? 'papan tabular text-[28px] leading-none' : 'tabular font-medium'}>
      {nilai}
      {satuan && <span className="text-ink-3 font-normal text-[13px] ml-0.5">{satuan}</span>}
    </span>
  )
}

// --- Badge keyakinan (Q01–Q03) ---------------------------------------------

/**
 * Tiga balok, bukan tiga warna.
 *
 * Merah-kuning-hijau akan membuat keyakinan rendah terbaca sebagai kesalahan.
 * Ia bukan kesalahan — ia hanya berarti datanya belum banyak, dan itu keadaan
 * yang normal di kawasan yang belum disurvei. Balok terisi menyampaikan "sedikit
 * atau banyak" tanpa menyampaikan "buruk atau baik".
 *
 * Sumber `predicted` mendapat arsir, mengikuti aturan tekstur = belum tahu.
 */
export function Badge({ badge, ringkas }: { badge: BadgeKeyakinan; ringkas?: boolean }) {
  const k = KEYAKINAN[badge.tingkat]
  const prediksi = badge.sumber === 'predicted'
  const judul = `${k.teks} · ${badge.n_titik_misi} titik misi · ${
    prediksi ? 'nilai hasil imputasi model' : 'hasil survei lapangan'
  }`

  return (
    <span
      title={judul}
      className="inline-flex items-center gap-1.5 rounded-xs border border-line bg-surface-2 px-1.5 py-[3px]"
    >
      <span className="flex items-end gap-[2px]" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`w-[3px] rounded-[1px] ${i < k.balok ? 'bg-ink-2' : 'bg-line-2'}`}
            style={{ height: 4 + i * 3 }}
          />
        ))}
      </span>
      <span className="text-[12px] font-semibold tracking-wide text-ink-2">
        {badge.tingkat}
      </span>
      {!ringkas && (
        <span className="tabular text-[12px] text-ink-3">{badge.n_titik_misi} titik</span>
      )}
      {prediksi && (
        <span
          className="arsir text-ink-3 h-3 w-3 rounded-[2px] border border-line-2"
          title="Nilai ini hasil imputasi model, bukan survei langsung"
          aria-label="hasil imputasi model"
        />
      )}
      <span className="sr-only">{judul}</span>
    </span>
  )
}

// --- Kuadran ---------------------------------------------------------------

export function Glif({ kuadran, ukuran = 12 }: { kuadran: string; ukuran?: number }) {
  const q = KUADRAN[kuadran]
  if (!q) return null
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 16 16" aria-hidden className="shrink-0">
      <path
        d={q.glif}
        fill={q.warna ?? 'none'}
        stroke={q.warna ?? 'var(--color-line-2)'}
        strokeWidth={q.warna ? 0 : 1.5}
      />
    </svg>
  )
}

/** Nama kuadran + glifnya. Warna tidak pernah sendirian. */
export function ChipKuadran({ kuadran }: { kuadran: NamaKuadran | null }) {
  if (!kuadran) return <Kosong teks="kuadran belum dihitung" />
  const q = KUADRAN[kuadran]
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-xs px-1.5 py-[3px] text-[13px] font-semibold"
      style={{
        background: q.warna ? q.lembut : 'var(--color-surface-2)',
        color: q.warna ?? 'var(--color-ink-2)',
        boxShadow: q.warna ? 'none' : 'inset 0 0 0 1px var(--color-line)',
      }}
    >
      <Glif kuadran={kuadran} />
      {q.nama}
    </span>
  )
}

// --- Struktur panel --------------------------------------------------------

export function Bagian({
  judul,
  aksi,
  children,
}: {
  judul: string
  aksi?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="border-t border-line px-4 py-3.5 first:border-t-0">
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <h3 className="eyebrow">{judul}</h3>
        {aksi}
      </div>
      {children}
    </section>
  )
}

export function Baris({
  label,
  children,
  bantuan,
}: {
  label: string
  children: ReactNode
  bantuan?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[5px]">
      <span className="text-[14px] text-ink-2" title={bantuan}>
        {label}
      </span>
      <span className="text-right text-[15px]">{children}</span>
    </div>
  )
}

/**
 * Layar kosong adalah ajakan bertindak, bukan pengumuman kegagalan.
 * Selalu menyebut apa yang harus dilakukan berikutnya.
 */
export function Ajakan({
  judul,
  anak,
  aksi,
}: {
  judul: string
  anak: string
  aksi?: ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 py-10 text-center">
      <p className="papan text-[17px] text-ink">{judul}</p>
      <p className="max-w-[26ch] text-[14.5px] leading-relaxed text-ink-3">{anak}</p>
      {aksi}
    </div>
  )
}

/**
 * Balok abu-abu saja tidak cukup.
 *
 * Panel yang berganti isi tanpa keterangan terbaca sebagai antarmuka yang
 * menggantung, bukan yang sedang bekerja - terutama saat heksagonnya berganti
 * dan yang berubah cuma bentuk balok yang mirip. Kalimatnya membuat jedanya
 * punya nama.
 */
export function Memuat({ baris = 3, teks = 'Sedang memuat data…' }: { baris?: number; teks?: string }) {
  return (
    <div className="space-y-2 p-4" aria-live="polite" aria-busy="true">
      <p className="mb-3 flex items-center gap-2 text-[13px] text-ink-3">
        <span className="denyut inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-ink-3" aria-hidden />
        {teks}
      </p>
      {Array.from({ length: baris }).map((_, i) => (
        <div
          key={i}
          className="berkilau h-3 rounded-xs bg-ground-2"
          style={{ width: `${100 - i * 14}%`, animationDelay: `${i * 90}ms` }}
        />
      ))}
    </div>
  )
}

// --- Papan nama ------------------------------------------------------------


/**
 * Kursor yang berhenti di satu huruf tidak boleh meninggalkan noda permanen.
 * Lewat jeda ini warnanya luntur sendiri, meski kursornya belum pergi.
 */
const DIAM_MS = 3500

/**
 * Jeda sebelum warna luntur SETELAH kursor pergi.
 *
 * Nol — perilaku sebelumnya — membuat sapuan cepat tidak meninggalkan apa pun:
 * warnanya sudah pulang sebelum mata sempat membaca jejaknya. Dua detik cukup
 * lama untuk melihat sapuannya utuh, masih cukup singkat untuk tidak terasa
 * macet.
 *
 * Getarannya (440ms, di index.css) sengaja jauh lebih pendek dari ini. Kalau
 * keduanya sama panjang, hurufnya terlihat gemetar terus; dengan gerak yang
 * mendarat duluan dan warna yang menyusul pergi, sapuannya terasa punya akhir.
 */
const LEPAS_MS = 2000

/** Sengaja di luar komponen: satu penghitung untuk seluruh papan nama. */
let langkahWarna = 0

/**
 * Papan nama "Loconomics" di bilah atas.
 *
 * Tiap huruf dipecah jadi span sendiri supaya bisa mengambil warnanya sendiri.
 * Spasi TIDAK dibungkus span — dibiarkan sebagai teks telanjang, supaya ia tidak
 * ikut berwarna dan pemenggalan barisnya tetap wajar.
 *
 * Pemecahan itu membuat pembaca layar mengeja huruf satu per satu, jadi
 * hurufnya disembunyikan dari pohon aksesibilitas dan judulnya membawa
 * aria-label yang utuh.
 *
 * Tiap huruf yang tersentuh melakukan dua hal dengan tempo yang berbeda: ia
 * melenting sebentar (440ms, .getar-a/.getar-b di index.css) lalu diam, dan ia
 * mengambil warna yang baru pulang beberapa detik kemudian (DIAM_MS/LEPAS_MS).
 * Selisih tempo itulah efeknya — gerak yang mendarat duluan meninggalkan
 * warnanya sebagai jejak, bukan sebagai getaran yang tidak berhenti.
 */
export function PapanNama({
  teks,
  kelas = 'text-[20px] leading-none',
  sebagai: Tag = 'h1',
}: {
  teks: string
  /**
   * Ukuran dan warna diserahkan ke pemanggil, perilakunya tidak.
   *
   * Halaman gerbang memakai papan nama yang SAMA dengan bilah atas aplikasi -
   * tempo warna, arah getar, dan selisih antara keduanya semuanya identik,
   * karena itu memang diminta begitu. Yang berbeda cuma ukurannya. Menyalin
   * komponennya untuk mengubah satu kelas akan membuat kedua salinan itu
   * berpisah tempo pada perubahan berikutnya.
   */
  kelas?: string
  /**
   * Bilah atas aplikasi tetap ada di DOM di belakang halaman gerbang, jadi dua
   * papan nama bisa hidup bersamaan. Hanya satu yang boleh jadi <h1>.
   */
  sebagai?: 'h1' | 'div'
}) {
  const [warna, setWarna] = useState<Record<number, string>>({})
  // Bukan penanda nyala/mati melainkan penghitung sentuhan: yang dipakai cuma
  // ganjil-genapnya, untuk berganti-ganti nama animasi — lihat sentuh().
  const [getar, setGetar] = useState<Record<number, number>>({})
  const jam = useRef<Record<number, number>>({})

  const luntur = useCallback((i: number) => {
    clearTimeout(jam.current[i])
    delete jam.current[i]
    setWarna((p) => {
      if (!(i in p)) return p
      const sisa = { ...p }
      delete sisa[i]
      return sisa
    })
  }, [])

  /** Menjadwalkan lunturnya, bukan melunturkannya sekarang. */
  const jadwalkan = useCallback(
    (i: number, jeda: number) => {
      clearTimeout(jam.current[i])
      jam.current[i] = window.setTimeout(() => luntur(i), jeda)
    },
    [luntur],
  )

  // Timer yang masih hidup saat komponen dilepas akan menyentuh state yang
  // sudah tidak ada lagi.
  useEffect(() => {
    const daftar = jam.current
    return () => Object.values(daftar).forEach(clearTimeout)
  }, [])

  const sentuh = useCallback(
    (i: number) => {
      setWarna((p) => ({ ...p, [i]: RODA_WARNA[langkahWarna++ % RODA_WARNA.length] }))
      // Memasang ulang kelas animasi yang SUDAH menempel tidak memicu apa pun;
      // hanya nama animasi yang berganti yang memulai ulang. Penghitung ini
      // yang membuatnya berselang-seling getar-a/getar-b, sehingga menyapu
      // bolak-balik di huruf yang sama tetap menggetarkannya tiap kali.
      setGetar((p) => ({ ...p, [i]: (p[i] ?? 0) + 1 }))
      jadwalkan(i, DIAM_MS)
    },
    [jadwalkan],
  )

  return (
    <Tag aria-label={teks} className={`papan ${kelas}`}>
      {[...teks].map((huruf, i) =>
        huruf === ' ' ? (
          ' '
        ) : (
          // Dua span, bukan satu: yang luar adalah sasaran kursor dan TIDAK
          // pernah ikut bergerak, yang dalam yang melenting. Kalau keduanya
          // digabung, huruf yang sedang membesar ikut melebarkan kotak
          // sentuhnya dan menutupi tetangganya - sapuan cepat lalu memicu
          // huruf yang sama berulang kali alih-alih berjalan ke huruf
          // berikutnya.
          <span
            key={i}
            aria-hidden
            onPointerEnter={() => sentuh(i)}
            onPointerLeave={() => jadwalkan(i, LEPAS_MS)}
            className="inline-block"
          >
            <span
              style={{ color: warna[i] }}
              className={`inline-block transition-colors duration-500 ease-[cubic-bezier(0.6,0.4,0,1)] ${
                getar[i] === undefined ? '' : getar[i] % 2 === 1 ? 'getar-a' : 'getar-b'
              }`}
            >
              {huruf}
            </span>
          </span>
        ),
      )}
    </Tag>
  )
}

// --- Markdown ---------------------------------------------------------------

/**
 * Perender Markdown seukuran gigitan, ditulis sendiri alih-alih menarik
 * pustaka.
 *
 * Alasannya bukan berat berkas. Jawaban LLM adalah teks yang tidak dipercaya,
 * dan setiap perender Markdown umum punya jalur keluar ke HTML mentah yang
 * harus dimatikan dengan benar. Yang di bawah ini tidak punya jalur itu sama
 * sekali: ia membangun elemen React, tidak pernah menyentuh dangerouslySetInner-
 * HTML, jadi tag di dalam jawaban model tetap jadi teks apa adanya.
 *
 * Yang didukung persis yang benar-benar dipakai model dalam prompt A1-A4:
 * judul, daftar bernomor, daftar poin, tebal, miring, dan kode sebaris.
 */

const POLA_INLINE = /(\*\*.+?\*\*|`[^`]+`|\*[^*\n]+\*)/g

function Sebaris({ teks }: { teks: string }) {
  return (
    <>
      {teks.split(POLA_INLINE).map((b, i) => {
        if (b.startsWith('**') && b.endsWith('**') && b.length > 4)
          return (
            <strong key={i} className="font-semibold">
              {b.slice(2, -2)}
            </strong>
          )
        if (b.startsWith('`') && b.endsWith('`') && b.length > 2)
          return (
            <code
              key={i}
              className="rounded-[6px] bg-surface-2 px-1.5 py-[1px] font-mono text-[12.5px]"
            >
              {b.slice(1, -1)}
            </code>
          )
        if (b.startsWith('*') && b.endsWith('*') && b.length > 2)
          return <em key={i}>{b.slice(1, -1)}</em>
        return b
      })}
    </>
  )
}

const AWAL_BLOK = /^(#{1,4}\s|\s*[-*•]\s|\s*\d+[.)]\s)/

/**
 * `ungkap` membuat tiap blok muncul berurutan, bukan sekaligus.
 *
 * Ini bukan sekadar hiasan: jawaban asisten sering berupa tiga paragraf
 * sekaligus, dan blok yang mendarat serempak membuat mata tidak tahu harus
 * mulai dari mana. Jeda 70ms per blok menunjukkan urutan bacanya. Pengguna
 * yang mematikan animasi sistem mendapat semuanya sekaligus - aturan
 * prefers-reduced-motion di index.css sudah mengurusnya.
 */
export function Markdown({ teks }: { teks: string }) {
  const baris = teks.split('\n')
  const blok: ReactNode[] = []
  let i = 0

  const bungkus = (isi: ReactNode) => (
    <div key={blok.length} className="ungkap" style={{ animationDelay: `${blok.length * 70}ms` }}>
      {isi}
    </div>
  )

  while (i < baris.length) {
    if (!baris[i].trim()) {
      i++
      continue
    }

    if (/^#{1,4}\s/.test(baris[i])) {
      const t = baris[i].replace(/^#{1,4}\s/, '')
      blok.push(bungkus(<p className="papan text-[15px] leading-snug"><Sebaris teks={t} /></p>))
      i++
      continue
    }

    if (/^\s*[-*•]\s/.test(baris[i])) {
      const item: string[] = []
      while (i < baris.length && /^\s*[-*•]\s/.test(baris[i])) {
        item.push(baris[i].replace(/^\s*[-*•]\s/, ''))
        i++
      }
      blok.push(
        bungkus(
          <ul className="list-disc space-y-1 pl-5 marker:text-ink-3">
            {item.map((t, j) => (
              <li key={j} className="leading-relaxed">
                <Sebaris teks={t} />
              </li>
            ))}
          </ul>,
        ),
      )
      continue
    }

    if (/^\s*\d+[.)]\s/.test(baris[i])) {
      const item: string[] = []
      while (i < baris.length && /^\s*\d+[.)]\s/.test(baris[i])) {
        item.push(baris[i].replace(/^\s*\d+[.)]\s/, ''))
        i++
      }
      blok.push(
        bungkus(
          <ol className="tabular list-decimal space-y-1 pl-5 marker:text-ink-3">
            {item.map((t, j) => (
              <li key={j} className="leading-relaxed">
                <Sebaris teks={t} />
              </li>
            ))}
          </ol>,
        ),
      )
      continue
    }

    const par: string[] = []
    while (i < baris.length && baris[i].trim() && !AWAL_BLOK.test(baris[i])) {
      par.push(baris[i])
      i++
    }
    blok.push(
      bungkus(
        <p className="leading-relaxed">
          {par.map((t, j) => (
            <span key={j}>
              {j > 0 && <br />}
              <Sebaris teks={t} />
            </span>
          ))}
        </p>,
      ),
    )
  }

  return <div className="space-y-2.5">{blok}</div>
}

// --- Menu pilihan -----------------------------------------------------------

/**
 * Pengganti <select> bawaan.
 *
 * Bukan soal selera. Elemen <select> menggambar daftarnya lewat widget sistem
 * operasi: `color` dan `background` yang kita pasang tidak berlaku di dalamnya,
 * dan pada Windows daftarnya selalu terang. Begitu chrome berpindah ke mode
 * gelap, tulisan di dalam kotak pilihan berakhir gelap di atas gelap — itu
 * cacat yang tidak bisa diperbaiki dari CSS, hanya dengan mengganti elemennya.
 *
 * Yang dijaga dari versi <select>: bisa dipakai penuh dari papan ketik. Panah
 * atas-bawah memindahkan sorotan, Enter memilih, Escape menutup, Tab keluar.
 * Home dan End melompat ke ujung, karena daftar kawasan akan bertambah panjang.
 */
export function Menu<T extends string>({
  label,
  nilai,
  opsi,
  onUbah,
}: {
  label: string
  nilai: T
  opsi: { nilai: T; label: string; catatan?: string }[]
  onUbah: (v: T) => void
}) {
  const [buka, setBuka] = useState(false)
  const [sorot, setSorot] = useState(0)
  const wadah = useRef<HTMLDivElement>(null)
  const terpilih = opsi.find((o) => o.nilai === nilai)

  // Membuka menu adalah satu tindakan: ia menampilkan daftar DAN menaruh
  // sorotan pada pilihan yang sedang berlaku. Menaruh sorotan lewat efek
  // memisahkan dua hal yang sebenarnya satu, dan menambah satu render.
  const bukaMenu = () => {
    setSorot(Math.max(0, opsi.findIndex((o) => o.nilai === nilai)))
    setBuka(true)
  }

  useEffect(() => {
    if (!buka) return
    const luar = (e: MouseEvent) => {
      if (!wadah.current?.contains(e.target as Node)) setBuka(false)
    }
    document.addEventListener('mousedown', luar)
    return () => document.removeEventListener('mousedown', luar)
  }, [buka])

  const papanKetik = (e: EventPapanKetik) => {
    if (e.key === 'Escape') return setBuka(false)
    if (!buka && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      return bukaMenu()
    }
    if (!buka) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSorot((i) => (i + 1) % opsi.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSorot((i) => (i - 1 + opsi.length) % opsi.length)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setSorot(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setSorot(opsi.length - 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onUbah(opsi[sorot].nilai)
      setBuka(false)
    }
  }

  return (
    <div ref={wadah} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={buka}
        aria-label={label}
        onClick={() => (buka ? setBuka(false) : bukaMenu())}
        onKeyDown={papanKetik}
        className={`flex cursor-pointer items-center gap-2 rounded-full border py-1.5 pl-3.5 pr-2.5 text-[13.5px] font-medium transition-colors ${
          buka
            ? 'border-line-2 bg-surface'
            : 'border-line bg-surface/60 hover:border-line-2 hover:bg-surface'
        }`}
      >
        <span className="eyebrow hidden 2xl:inline">{label}</span>
        <span className="whitespace-nowrap">{terpilih?.label ?? '—'}</span>
        {terpilih?.catatan && (
          <span className="hidden text-[12px] text-ink-3 lg:inline">{terpilih.catatan}</span>
        )}
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden
          className={`text-ink-3 transition-transform duration-200 ease-liquid ${buka ? 'rotate-180' : ''}`}
        >
          <path d="M1 3.5 5 7.5 9 3.5" stroke="currentColor" strokeWidth="1.7" fill="none" />
        </svg>
      </button>

      {buka && (
        <ul
          role="listbox"
          aria-label={label}
          className="kaca-tebal pop pop-kanan absolute right-0 top-[calc(100%+8px)] z-50 max-h-[60vh] min-w-full overflow-auto rounded-md p-1.5"
        >
          {opsi.map((o, i) => {
            const aktif = o.nilai === nilai
            return (
              <li key={o.nilai}>
                <button
                  type="button"
                  role="option"
                  aria-selected={aktif}
                  onMouseEnter={() => setSorot(i)}
                  onClick={() => {
                    onUbah(o.nilai)
                    setBuka(false)
                  }}
                  // Baris muncul berurutan, bukan serentak. Jaraknya 28ms:
                  // cukup untuk terbaca sebagai daftar yang MEMBUKA, terlalu
                  // singkat untuk terasa seperti menunggu. Dibatasi 6 baris
                  // supaya menu Kawasan yang panjang tidak berakhir dengan
                  // baris terakhir yang datang seperempat detik belakangan.
                  style={{ animationDelay: `${Math.min(i, 6) * 28}ms` }}
                  className={`ungkap flex w-full cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-sm px-3 py-2 text-left text-[13.5px] transition-colors ${
                    i === sorot ? 'bg-surface-2' : ''
                  } ${aktif ? 'font-semibold' : 'font-medium text-ink-2'}`}
                >
                  {/* Tanda centang menempati ruangnya bahkan saat kosong: tanpa
                      itu, seluruh label bergeser 18px ketika pilihan berpindah. */}
                  <span className="w-3.5 shrink-0 text-ink">
                    {aktif && (
                      <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden>
                        <path
                          d="M1.5 6.2 4.4 9 10.5 2.8"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          fill="none"
                          strokeLinecap="round"
                        />
                      </svg>
                    )}
                  </span>
                  {o.label}
                  {o.catatan && <span className="ml-auto text-[12px] text-ink-3">{o.catatan}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// --- Pemilih basemap -------------------------------------------------------

/**
 * Contoh tampilan tiap basemap, digambar sebagai SVG — bukan gambar ubin.
 *
 * Menarik ubin sungguhan sebagai pratinjau berarti lima permintaan jaringan
 * tambahan hanya untuk sebuah tombol, dan jalur raster/XYZ MAPID memang rusak di
 * sisi server (lihat CLAUDE.md). Lima lingkaran ini cukup: yang perlu dikenali
 * pengguna adalah "yang terang", "yang gelap", "yang satelit" — bukan jalan mana
 * yang tergambar di dalamnya.
 */
function IsiSwatch({ nama }: { nama: string }) {
  if (nama === 'gelap')
    return (
      <>
        <circle cx="20" cy="20" r="20" fill="#232a2d" />
        <path d="M0 30q13-5 40 2v8H0z" fill="#1a2f38" />
        <circle cx="9" cy="10" r="7.5" fill="#2b3a31" />
        <path d="M-2 25 42 15" stroke="#4d565b" strokeWidth="3.6" />
        <path d="M13-2 21 42" stroke="#434c50" strokeWidth="2.8" />
      </>
    )
  if (nama === 'satelit')
    return (
      <>
        <circle cx="20" cy="20" r="20" fill="#47603b" />
        <path d="M0 29q14-6 40 3v8H0z" fill="#2c4c60" />
        <circle cx="10" cy="11" r="8" fill="#6d8446" />
        <circle cx="30" cy="9" r="6" fill="#8a7a4e" />
        <path d="M-2 24 42 14" stroke="#9aa189" strokeWidth="2.4" opacity=".75" />
      </>
    )
  if (nama === 'jalan')
    return (
      <>
        <circle cx="20" cy="20" r="20" fill="#f2eee2" />
        <path d="M0 31q14-5 40 2v7H0z" fill="#dde7ea" />
        <rect x="4" y="4" width="9" height="7" rx="1.5" fill="#dcd5c4" />
        <rect x="27" y="6" width="9" height="8" rx="1.5" fill="#dcd5c4" />
        <rect x="24" y="20" width="7" height="6" rx="1.5" fill="#dcd5c4" />
        <path d="M-2 25 42 15" stroke="#fff" strokeWidth="5" />
        <path d="M13-2 21 42" stroke="#fff" strokeWidth="4" />
      </>
    )
  if (nama === 'dasar')
    return (
      <>
        {/* Sengaja lebih kelabu dan lebih kosong dari `terang`. Pada 38px, dua
            swatch terang yang sama-sama punya taman dan air tidak bisa
            dibedakan - yang membedakan harus NADA-nya, bukan isinya. */}
        <circle cx="20" cy="20" r="20" fill="#dce1e0" />
        <path d="M0 32q14-4 40 2v6H0z" fill="#cdd6d8" />
        <path d="M-2 24 42 16" stroke="#f4f7f6" strokeWidth="4.5" />
      </>
    )
  return (
    <>
      <circle cx="20" cy="20" r="20" fill="#f1f4ef" />
      <path d="M0 31q14-5 40 2v7H0z" fill="#c9dee8" />
      <circle cx="9" cy="10" r="7.5" fill="#cfe2c8" />
      <path d="M-2 25 42 15" stroke="#fff" strokeWidth="4.6" />
      <path d="M13-2 21 42" stroke="#fff" strokeWidth="3.4" />
    </>
  )
}

function Swatch({ nama, ukuran }: { nama: string; ukuran: number }) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 40 40" aria-hidden className="rounded-full">
      <IsiSwatch nama={nama} />
      {/* Swatch pucat di atas pil kaca yang juga pucat kehilangan tepinya.
          Cincin ini yang mengembalikannya - digambar di dalam SVG, bukan sebagai
          box-shadow, supaya ia ikut terpotong bulat tanpa aturan tambahan. */}
      <circle cx="20" cy="20" r="19.2" fill="none" stroke="rgb(22 33 28 / 0.18)" strokeWidth="1.6" />
    </svg>
  )
}

/** Ukuran satu lingkaran pilihan, jaraknya, dan bantalan pilnya — dalam px. */
const UK = 38
const JARAK = 6
const PAD = 6

/** Lensa kacanya sengaja melimpah 6px dari swatch yang ditumpanginya. */
const LENSA = UK + 6

/** Lama blob melar sebelum kembali bulat. Sama dengan durasi transisi posisinya. */
const LUNCUR_MS = 520

/**
 * Jeda sebelum basemapnya benar-benar diganti.
 *
 * Mengganti gaya membuat MapLibre membangun ulang seluruh lapisannya, dan itu
 * memblokir main thread: diukur, animasi lensanya turun ke ~29 fps kalau
 * keduanya berangkat bersamaan. Seperempat perjalanan lebih dulu sudah cukup -
 * mata membaca AWAL sebuah gerakan, dan 150 ms tidak terasa sebagai tundaan.
 */
const JEDA_UBAH_MS = 150

/**
 * Pemilih basemap: satu tombol bulat yang memanjang ke kiri jadi deretan pilihan.
 *
 * Yang menandai pilihan bukan cincin atau centang melainkan satu lensa kaca yang
 * BERPINDAH. Satu elemen, bukan satu per pilihan — itulah sebabnya ia terbaca
 * sebagai benda yang mengalir dari satu lingkaran ke lingkaran lain, bukan dua
 * sorotan yang bergantian menyala. Saat berpindah ia melar mendatar dan memipih
 * sedikit, seperti tetesan yang ditarik, lalu bulat lagi begitu sampai.
 *
 * Tumbuhnya ke KIRI bukan pilihan gaya: tombolnya menempel di tepi kanan layar,
 * jadi ke kiri satu-satunya arah yang tidak keluar layar.
 */
export function PilihBasemap<T extends string>({
  nilai,
  opsi,
  onUbah,
  arah = 'kanan',
  buka: bukaLuar,
  onBuka,
}: {
  nilai: T
  opsi: { nilai: T; label: string }[]
  onUbah: (v: T) => void
  /**
   * Ke mana pilnya memanjang. Bukan selera: arahnya harus MENJAUHI tepi layar
   * terdekat, kalau tidak pilnya keluar layar. Tombolnya sekarang di tepi kiri,
   * jadi bawaannya ke kanan.
   */
  arah?: 'kiri' | 'kanan'
  /**
   * Terbuka atau tidak, DIKENDALIKAN dari luar. Boleh dikosongkan; tanpa
   * keduanya komponen ini mengurus keadaannya sendiri seperti sebelumnya.
   *
   * Ada karena tombol ini duduk dalam satu tumpukan bersama pembuka Kompas
   * Kuadran, dan dua panel yang sama-sama memanjang ke kanan tidak boleh
   * terbuka bersamaan - yang kedua cuma mendorong yang pertama makin ke tepi
   * alih-alih menggantikannya. Siapa yang boleh terbuka adalah keputusan
   * TUMPUKANNYA, bukan keputusan masing-masing tombol, jadi keadaannya harus
   * tinggal di tempat yang bisa melihat keduanya.
   */
  buka?: boolean
  onBuka?: (v: boolean) => void
}) {
  const [bukaDalam, setBukaDalam] = useState(false)
  const terkendali = bukaLuar !== undefined
  const buka = terkendali ? bukaLuar : bukaDalam
  const setBuka = (v: boolean) => (terkendali ? onBuka?.(v) : setBukaDalam(v))
  const [luncur, setLuncur] = useState(false)
  // Pilihan yang sudah diklik tapi petanya belum menyusul. Tanpa ini, menunda
  // onUbah ikut menunda lensanya - dan yang ditunda justru harus berangkat
  // duluan.
  const [dipilih, setDipilih] = useState<T | null>(null)
  const wadah = useRef<HTMLDivElement>(null)
  const jam = useRef<number | undefined>(undefined)
  const jamUbah = useRef<number | undefined>(undefined)

  const aktif = dipilih ?? nilai
  const idx = Math.max(
    0,
    opsi.findIndex((o) => o.nilai === aktif),
  )
  const lebar = opsi.length * UK + (opsi.length - 1) * JARAK + 2 * PAD
  const terpilih = opsi[idx]

  useEffect(
    () => () => {
      clearTimeout(jam.current)
      clearTimeout(jamUbah.current)
    },
    [],
  )

  useEffect(() => {
    if (!buka) return
    const luar = (e: MouseEvent) => {
      if (!wadah.current?.contains(e.target as Node)) setBuka(false)
    }
    const tombol = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBuka(false)
    }
    document.addEventListener('mousedown', luar)
    document.addEventListener('keydown', tombol)
    return () => {
      document.removeEventListener('mousedown', luar)
      document.removeEventListener('keydown', tombol)
    }
    // setBuka dirakit ulang tiap render saat terkendali, dan memasukkannya ke
    // dependensi berarti memasang-melepas dua penangan dokumen setiap render.
    // Yang dipanggilnya selalu prop terbaru, jadi tidak ada yang basi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buka])

  const pilih = (v: T) => {
    if (v === aktif) return
    setLuncur(true)
    setDipilih(v)
    clearTimeout(jam.current)
    jam.current = window.setTimeout(() => setLuncur(false), LUNCUR_MS)
    clearTimeout(jamUbah.current)
    // `dipilih` dilepas di saat yang sama onUbah dipanggil: keduanya masuk satu
    // render, jadi `aktif` berpindah dari dipilih ke nilai tanpa berkedip.
    jamUbah.current = window.setTimeout(() => {
      onUbah(v)
      setDipilih(null)
    }, JEDA_UBAH_MS)
  }

  return (
    <div
      ref={wadah}
      className={`flex items-center gap-2 ${
        arah === 'kanan' ? 'flex-row-reverse justify-start' : 'justify-end'
      }`}
    >
      {/* Pil yang memanjang. Lebarnya dianimasikan dalam px, bukan dari `auto`:
          `auto` tidak bisa ditransisikan, sementara lebarnya memang bisa dihitung. */}
      <div
        className="kaca overflow-hidden rounded-full transition-[width,opacity] duration-[420ms] ease-liquid"
        style={{
          width: buka ? lebar : 0,
          opacity: buka ? 1 : 0,
          // Isi pil selalu selebar penuh; yang menyusut wadahnya. Supaya
          // isinya tampak keluar DARI tombol, sisi yang dipotong harus yang
          // jauh dari tombol.
          direction: arah === 'kanan' ? 'rtl' : 'ltr',
        }}
        aria-hidden={!buka}
      >
        <div
          role="listbox"
          aria-label="Basemap"
          className="relative flex items-center"
          style={{ width: lebar, padding: PAD, gap: JARAK, direction: 'ltr' }}
        >
          {/* Lensa kaca. pointer-events-none supaya klik tetap sampai ke
              lingkaran di bawahnya — tanpa itu, pilihan yang sedang aktif justru
              jadi satu-satunya yang tidak bisa diklik. */}
          <span
            aria-hidden
            className="pointer-events-none absolute z-10 rounded-full"
            style={{
              // Sedikit LEBIH BESAR dari swatch-nya, digeser setengah selisih.
              // Lensa seukuran isinya terbaca sebagai topeng yang mengganti
              // swatch; lensa yang melimpah sedikit terbaca sebagai benda yang
              // menumpang di atasnya.
              left: PAD - (LENSA - UK) / 2 + idx * (UK + JARAK),
              top: PAD - (LENSA - UK) / 2,
              width: LENSA,
              height: LENSA,
              transform: luncur ? 'scaleX(1.3) scaleY(0.86)' : 'none',
              transition: `left ${LUNCUR_MS}ms var(--ease-jelly), transform ${LUNCUR_MS}ms var(--ease-jelly)`,
              // Isinya harus tetap TERBACA di bawah lensa. Versi pertama memakai
              // 26% putih + brightness 1,1 dan itu memutihkan swatch di bawahnya
              // sampai hilang - yang sedang dipilih justru jadi satu-satunya yang
              // tidak bisa dikenali.
              background: 'color-mix(in srgb, var(--color-surface) 10%, transparent)',
              backdropFilter: 'blur(0.4px) saturate(170%) brightness(1.03)',
              WebkitBackdropFilter: 'blur(0.4px) saturate(170%) brightness(1.03)',
              border: '1.5px solid color-mix(in srgb, #ffffff 82%, transparent)',
              // Cahayanya datang dari BAWAH, dan itu yang membuat kaca terbaca
              // sebagai setetes air alih-alih sebuah cakram. Tepi bawah paling
              // terang, pendarnya naik ke dalam, tepi atas justru diredupkan -
              // kebalikan dari tombol timbul biasa. Cincin gelap tipis di luar
              // tetap ada supaya pilihan tegas di atas swatch seterang apa pun.
              boxShadow: [
                'inset 0 -2px 0 rgb(255 255 255 / 0.98)',
                'inset 0 -9px 14px -6px rgb(255 255 255 / 0.85)',
                'inset 0 2px 6px -2px rgb(22 33 28 / 0.16)',
                '0 0 0 1.4px color-mix(in srgb, var(--color-ink) 38%, transparent)',
                '0 9px 20px -9px rgb(22 33 28 / 0.6)',
              ].join(', '),
            }}
          >
            {/* Pendar yang naik dari tepi bawah. Dipisah sebagai lapisan
                sendiri, bukan digabung ke box-shadow, karena bentuknya elips -
                dan box-shadow tidak bisa berbentuk elips. */}
            <span
              aria-hidden
              className="absolute inset-0 rounded-full"
              style={{
                background:
                  'radial-gradient(125% 85% at 50% 122%, rgb(255 255 255 / 0.92) 0%, rgb(255 255 255 / 0.34) 36%, transparent 64%)',
              }}
            />
          </span>
          {opsi.map((o) => (
            <button
              key={o.nilai}
              role="option"
              aria-selected={o.nilai === aktif}
              onClick={() => pilih(o.nilai)}
              title={o.label}
              className="relative cursor-pointer rounded-full transition-transform duration-200 ease-jelly hover:scale-[1.08]"
              style={{ width: UK, height: UK }}
            >
              {/* Yang berada DI BAWAH lensa ikut membesar - itulah yang membuat
                  kacanya terbaca sebagai lensa, bukan sekadar sorotan. Skalanya
                  dijaga tepat di dalam diameter lensa: melebihi itu, isinya
                  terlihat bocor keluar dari kacanya sendiri. */}
              <span
                className="block transition-transform duration-[520ms] ease-jelly"
                style={{ transform: o.nilai === aktif ? `scale(${LENSA / UK - 0.03})` : 'none' }}
              >
                <Swatch nama={o.nilai} ukuran={UK} />
              </span>
              <span className="sr-only">{o.label}</span>
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() => setBuka(!buka)}
        aria-expanded={buka}
        aria-label={`Basemap: ${terpilih?.label ?? ''}. ${buka ? 'Tutup' : 'Buka'} pilihan`}
        title={`Basemap — ${terpilih?.label ?? ''}`}
        className={`grid h-12 w-12 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full transition-transform duration-200 ease-jelly hover:scale-[1.06] ${
          buka ? 'ring-2 ring-ink/70' : ''
        }`}
        style={{ boxShadow: '0 12px 30px -12px rgb(22 33 28 / 0.65)' }}
      >
        {/* Tombolnya memakai contoh basemap yang SEDANG dipakai, bukan ikon peta
            generik: tombol yang menampilkan keadaannya sendiri tidak perlu
            dibuka untuk menjawab "yang mana yang aktif". */}
        <Swatch nama={aktif} ukuran={48} />
      </button>
    </div>
  )
}

// --- Menu pengaturan -------------------------------------------------------

/** Baris data yang jujur: yang kosong ditulis kosong, bukan disembunyikan. */
function BarisIdentitas({ label, nilai }: { label: string; nilai: string }) {
  return (
    <div className="flex gap-3 py-1.5">
      <span className="w-[6.5rem] shrink-0 text-[12.5px] text-ink-3">{label}</span>
      {nilai ? (
        <span className="text-[13px] leading-snug text-ink">{nilai}</span>
      ) : (
        <span className="text-[13px] italic text-ink-3">belum diisi</span>
      )}
    </div>
  )
}

const ISI_PENGATURAN = {
  tentang: {
    judul: 'Tentang kami',
    baris: [
      ['Produk', IDENTITAS.produk],
      ['Judul resmi', IDENTITAS.judulResmi],
      ['Lomba', IDENTITAS.lomba],
      ['Tema', IDENTITAS.tema],
      ['Tim', IDENTITAS.tim],
      ['Institusi', IDENTITAS.institusi],
      ['Ketua tim', IDENTITAS.ketua],
    ] as [string, string][],
    catatan:
      'Loconomics membantu calon pelaku UMKM memilih lokasi usaha di sekitar simpul transportasi massal Jabodetabek — dengan menunjukkan lokasi yang terlihat biasa tetapi datanya bagus, dan memperingatkan yang sebaliknya.',
  },
  kontak: {
    judul: 'Kontak',
    baris: [
      ['Surel', IDENTITAS.email],
      ['Instagram', IDENTITAS.instagram],
      ['Situs', IDENTITAS.situs],
      ['Repositori', IDENTITAS.repositori],
    ] as [string, string][],
    catatan: 'Isi nilainya di IDENTITAS pada frontend/src/config.ts.',
  },
}

type KunciPengaturan = keyof typeof ISI_PENGATURAN

/**
 * Gerigi di ujung kanan bilah atas: Tentang kami dan Kontak.
 *
 * Gerigi yang BERPUTAR saat disentuh bukan hiasan yang ditambahkan belakangan.
 * Ikon gerigi dipakai untuk begitu banyak hal berbeda sehingga ia nyaris tidak
 * berarti apa-apa; yang bergerak saat didekati setidaknya mengumumkan bahwa ia
 * bisa ditekan. Putarannya seperempat lingkaran - satu putaran penuh terbaca
 * sebagai indikator memuat, dan ini bukan sedang memuat apa pun.
 */
export function MenuPengaturan() {
  const [buka, setBuka] = useState(false)
  const [layar, setLayar] = useState<KunciPengaturan | null>(null)
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

  useEffect(() => {
    if (!layar) return
    const kunci = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLayar(null)
    }
    document.addEventListener('keydown', kunci)
    return () => document.removeEventListener('keydown', kunci)
  }, [layar])

  const isi = layar ? ISI_PENGATURAN[layar] : null

  return (
    <>
      <div ref={wadah} className="relative shrink-0">
        <button
          onClick={() => setBuka((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={buka}
          aria-label="Pengaturan"
          title="Pengaturan"
          className={`group grid h-9 w-9 cursor-pointer place-items-center rounded-full border transition-all duration-300 ease-jelly hover:scale-[1.08] ${
            buka
              ? 'border-transparent bg-ink text-surface'
              : 'border-line text-ink-2 hover:border-line-2 hover:text-ink'
          }`}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 20 20"
            aria-hidden
            className="transition-transform duration-500 ease-jelly group-hover:rotate-90"
          >
            {/* Gerigi sungguhan: delapan gigi digambar sebagai garis pendek
                dari lingkaran badan, bukan poligon abstrak yang harus
                ditebak-tebak artinya. */}
            <circle cx="10" cy="10" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="10" cy="10" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.5" />
            {Array.from({ length: 8 }, (_, i) => {
              const a = (i * Math.PI) / 4
              return (
                <line
                  key={i}
                  x1={10 + Math.cos(a) * 5.2}
                  y1={10 + Math.sin(a) * 5.2}
                  x2={10 + Math.cos(a) * 8}
                  y2={10 + Math.sin(a) * 8}
                  stroke="currentColor"
                  strokeWidth="2.1"
                  strokeLinecap="round"
                />
              )
            })}
          </svg>
        </button>

        {buka && (
          <div
            role="menu"
            className="kaca-tebal pop pop-kanan absolute right-0 top-[calc(100%+8px)] z-50 w-[13rem] overflow-hidden rounded-md p-1.5"
          >
            {(Object.keys(ISI_PENGATURAN) as KunciPengaturan[]).map((k, i) => (
              <button
                key={k}
                role="menuitem"
                onClick={() => {
                  setLayar(k)
                  setBuka(false)
                }}
                // Muncul berurutan, bukan serentak. Jaraknya kecil (40ms):
                // cukup untuk terbaca sebagai daftar yang terbuka, terlalu
                // singkat untuk terasa sebagai menunggu.
                className="ungkap flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-3 py-2.5 text-left text-[13.5px] transition-colors hover:bg-surface-2"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2">
                  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
                    {k === 'tentang' ? (
                      <>
                        <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                        <path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        <circle cx="8" cy="4.8" r="0.95" fill="currentColor" />
                      </>
                    ) : (
                      <path
                        d="M2.2 4.4h11.6v7.2H2.2Zm0 .4 5.8 4 5.8-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                      />
                    )}
                  </svg>
                </span>
                {ISI_PENGATURAN[k].judul}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Dialognya WAJIB lewat portal ke <body>.

          Menu ini hidup di dalam <header class="kaca">, dan `.kaca` memasang
          `backdrop-filter`. Elemen ber-filter menjadi containing block bagi
          seluruh keturunannya yang `position: fixed` - jadi `fixed inset-0` di
          sini tidak berarti "seluruh layar" melainkan "sebesar bilah atas", dan
          dialognya terjepit di pita setinggi 56px dengan tombol Tutup-nya
          terlempar ke luar viewport. Ini jebakan yang sama dengan `.kaca` versi
          lain di CLAUDE.md, hanya lewat properti yang berbeda. */}
      {isi &&
        createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/30 p-6 backdrop-blur-[3px]"
          onClick={() => setLayar(null)}
          role="dialog"
          aria-modal="true"
          aria-label={isi.judul}
        >
          <div
            className="kaca-tebal melayang w-[30rem] max-w-full overflow-hidden rounded-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-baseline justify-between gap-6 border-b border-line/70 px-6 py-5">
              <h2 className="papan text-[19px]">{isi.judul}</h2>
              <button
                onClick={() => setLayar(null)}
                className="shrink-0 cursor-pointer rounded-full border border-line px-4 py-1.5 text-[13.5px] font-medium transition-colors hover:bg-surface-2"
              >
                Tutup
              </button>
            </div>
            <div className="p-6">
              <div className="divide-y divide-line/60">
                {isi.baris.map(([label, nilai]) => (
                  <BarisIdentitas key={label} label={label} nilai={nilai} />
                ))}
              </div>
              <p className="mt-4 border-t border-line/70 pt-4 text-[13px] leading-relaxed text-ink-2">
                {isi.catatan}
              </p>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Tirai fitur berbayar
// ---------------------------------------------------------------------------

/**
 * Tirai yang menutup bagian berbayar.
 *
 * SATU HAL YANG HARUS DIPAHAMI SEBELUM MEMAKAINYA: yang diburamkan di sini
 * BUKAN data sungguhan. Backend tidak pernah mengirim isi bagian berbayar
 * kepada yang belum membayar - lihat `terkunci` di respons /hex/{h3}. Kalau
 * data aslinya yang diburamkan, siapa pun bisa membuka panel pengembang,
 * mencabut satu baris CSS, dan membaca semuanya. Buram adalah lapisan cat;
 * ia tidak pernah boleh jadi satu-satunya kunci.
 *
 * Jadi yang tergambar di balik tirai adalah BENTUK - baris-baris seukuran
 * data yang seharusnya ada di situ. Gunanya jujur: memberi tahu ada sesuatu
 * yang seukuran ini di baliknya, tanpa berpura-pura sedang menyembunyikan
 * angka yang sebenarnya tidak dikirim.
 *
 * `onBuka` sengaja prop, bukan `useSesi()` di dalam sini. Berkas primitif ini
 * tidak tahu-menahu soal akun, dan menjaganya begitu berarti ia tetap bisa
 * dipakai di mana pun tanpa menyeret konteks sesi ke belakangnya.
 */
export function Terkunci({
  judul,
  kalimat,
  labelAksi,
  onBuka,
  aksiKedua,
  baris = 5,
  tinggi,
}: {
  judul: string
  kalimat: string
  labelAksi: string
  onBuka: () => void
  aksiKedua?: ReactNode
  /** Berapa baris bentuk yang digambar di balik tirai. */
  baris?: number
  /** Tinggi minimum, mis. '13rem'. Bawaannya mengikuti jumlah baris. */
  tinggi?: string
}) {
  // YANG MENENTUKAN TINGGI ADALAH AJAKANNYA, bukan bentuk di belakangnya.
  //
  // Versi pertama membalik keduanya: bentuk digambar sebagai isi biasa, dan
  // ajakannya ditumpuk di atasnya dengan `absolute inset-0`. Akibatnya tinggi
  // kotak ditentukan oleh jumlah baris bentuk, sementara isi ajakan - ikon,
  // judul, kalimat, tombol - bisa lebih tinggi daripada itu. Yang kelebihan
  // digunting `overflow-hidden`, dan yang pertama hilang justru tombolnya,
  // karena ia paling bawah. Terukur di bagian riwayat: labelnya terpotong habis
  // dan tirainya menabrak paragraf di bawahnya.
  //
  // Sekarang bentuknya yang `absolute inset-0` dan ajakannya yang mengalir
  // biasa. Bentuk itu hiasan; ia boleh digunting sesuka kotaknya. Ajakan itu
  // satu-satunya jalan keluar dari tirai ini, dan ia tidak boleh pernah
  // digunting.
  return (
    <div
      className="relative overflow-hidden rounded-sm"
      style={tinggi ? { minHeight: tinggi } : undefined}
    >
      {/* Bentuk di belakang. `aria-hidden` + `pointer-events-none`: ia hiasan,
          dan pembaca layar tidak boleh membacakan baris kosong sebagai data. */}
      <div
        className="pointer-events-none absolute inset-0 space-y-2.5 overflow-hidden p-4 blur-[5px] select-none"
        aria-hidden
      >
        {Array.from({ length: baris }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div
              className="h-2.5 rounded-full bg-ink/12"
              style={{ width: `${26 + ((i * 37) % 26)}%` }}
            />
            <div
              className="h-2.5 rounded-full bg-ink/20"
              style={{ width: `${14 + ((i * 23) % 18)}%` }}
            />
            <div className="h-2.5 flex-1 rounded-full bg-ink/8" />
          </div>
        ))}
      </div>

      {/* Lapisan ajakan. Gradien, bukan warna rata: bentuk di baliknya harus
          masih terbaca sebagai "ada isinya", bukan tertutup papan buram. */}
      <div className="relative grid place-items-center bg-gradient-to-b from-surface/70 via-surface/88 to-surface/95 px-5 py-6 text-center">
        <div className="max-w-[30ch]">
          <span className="mx-auto mb-2.5 grid h-9 w-9 place-items-center rounded-full bg-ink text-surface">
            <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden>
              <path
                d="M6 9V6.5a4 4 0 0 1 8 0V9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
              <rect x="4.5" y="9" width="11" height="7.5" rx="2" fill="currentColor" />
            </svg>
          </span>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-gem">
            Khusus Loconomics Premium
          </p>
          <p className="papan text-[14.5px] leading-tight text-ink">{judul}</p>
          <p className="mt-1.5 text-[12.5px] leading-snug text-ink-2">{kalimat}</p>
          <button
            onClick={onBuka}
            className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[12.5px] font-semibold text-surface transition-transform duration-300 ease-jelly hover:scale-[1.04]"
          >
            <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden>
              <path
                d="M10 2.5 11.7 7l4.8 1.4L11.7 10l-1.7 4.5L8.3 10 3.5 8.4 8.3 7Z"
                fill="currentColor"
              />
            </svg>
            {labelAksi}
          </button>
          {aksiKedua && <div className="mt-2">{aksiKedua}</div>}
        </div>
      </div>
    </div>
  )
}
