/**
 * Dua pilihan yang MILIK PEMBACA, bukan milik data: bahasa dan tema.
 *
 * Keduanya tinggal di berkas yang sama karena bentuknya sama persis - satu
 * nilai kecil, disimpan di peramban, dibaca dari mana saja lewat konteks - dan
 * memisahnya cuma menggandakan pola yang sama di dua tempat. Nama berkasnya
 * tetap `bahasa.tsx`: mengganti nama berkas yang diimpor sembilan komponen
 * demi kerapian bukan penghematan.
 *
 * Bahasa antarmuka: Indonesia atau Inggris.
 *
 * BENTUKNYA: tiap komponen memegang kamusnya SENDIRI sebagai objek bertipe,
 * lalu memanggil `useTeks(KAMUS)` dan menerima cabang bahasa yang sedang
 * berlaku. Bukan satu berkas kamus raksasa berkunci string.
 *
 * Alasannya dua, dan yang kedua yang menentukan. Pertama, teks hidup di
 * sebelah komponen yang memakainya - komponen yang dihapus membawa serta
 * teksnya, tidak meninggalkan kunci yatim. Kedua, TIDAK ADA kunci yang bisa
 * salah ketik: `K.id` dan `K.en` bertipe sama, jadi kalimat yang belum
 * diterjemahkan gagal di `tsc`, bukan tampil sebagai "gerbang.hero.judul" di
 * layar juri.
 *
 * Yang TIDAK diterjemahkan di sini: kalimat yang datang dari backend (catatan
 * per heksagon, temuan, pesan galat) dan nama produk (Loconomics, PriceLens,
 * ZoneGuard, RiskRadar, Commuter Clock). Nama produk sama di kedua bahasa
 * dengan sengaja - ia nama, bukan kata.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'

import { KUADRAN } from '../config'

export type Bahasa = 'id' | 'en'

const KUNCI = 'loconomics:bahasa'

/**
 * Bahasa yang tersimpan; kalau belum pernah memilih, INDONESIA.
 *
 * Bukan bahasa peramban. Produk ini dibuat untuk Jabodetabek dan dinilai juri
 * berbahasa Indonesia; laptop yang kebetulan disetel Inggris tidak boleh
 * mengubah bahasa halaman pertamanya. Yang mau Inggris tinggal menggeser
 * sakelarnya, dan pilihannya diingat.
 */
function bacaAwal(): Bahasa {
  try {
    const t = localStorage.getItem(KUNCI)
    if (t === 'id' || t === 'en') return t
  } catch {
    /* localStorage bisa ditolak; bahasa bawaan tetap sah */
  }
  return 'id'
}

const Konteks = createContext<{ bahasa: Bahasa; ganti: (b: Bahasa) => void }>({
  bahasa: 'id',
  ganti: () => {},
})

export function BahasaProvider({ children }: { children: ReactNode }) {
  const [bahasa, setBahasa] = useState<Bahasa>(bacaAwal)

  const ganti = useCallback((b: Bahasa) => {
    setBahasa(b)
    try {
      localStorage.setItem(KUNCI, b)
    } catch {
      /* diam: pilihan tetap berlaku untuk sesi ini */
    }
  }, [])

  // `lang` di <html> ikut berganti. Bukan kosmetik: pembaca layar memilih suara
  // dari atribut ini, dan pemenggalan kata peramban ikut membacanya.
  useEffect(() => {
    document.documentElement.lang = bahasa
  }, [bahasa])

  const nilai = useMemo(() => ({ bahasa, ganti }), [bahasa, ganti])
  return <Konteks.Provider value={nilai}>{children}</Konteks.Provider>
}

export function useBahasa() {
  return useContext(Konteks)
}

/**
 * Nama zona (kuadran) dalam bahasa yang sedang berlaku.
 *
 * Satu tempat untuk keempatnya, dipakai peta, panel, Kompas, dan gerbang -
 * supaya "Aman" dan "Safe Bet" tidak pernah bisa tampil di dua sudut layar
 * yang sama pada saat yang sama.
 */
export function useNamaZona(): (kunci: string) => string {
  const { bahasa } = useContext(Konteks)
  return (kunci) => {
    const q = KUADRAN[kunci]
    if (!q) return kunci
    return bahasa === 'en' ? q.namaEn : q.nama
  }
}

/** Cabang kamus untuk bahasa yang sedang berlaku. */
export function useTeks<T>(kamus: Record<Bahasa, T>): T {
  const { bahasa } = useContext(Konteks)
  return kamus[bahasa]
}

/**
 * Sakelar dua posisi ID / EN.
 *
 * Satu komponen untuk kedua tempatnya - bilah gerbang dan bilah peta - supaya
 * keduanya tidak pernah berbeda bentuk. `gelap` dipakai bilah gerbang saat
 * halaman turun ke jurang hitam.
 */
export function SakelarBahasa({ gelap, kelas = '' }: { gelap?: boolean; kelas?: string }) {
  const { bahasa, ganti } = useBahasa()
  return (
    <div
      role="group"
      aria-label={bahasa === 'id' ? 'Bahasa antarmuka' : 'Interface language'}
      className={`relative grid grid-cols-2 rounded-full p-[3px] text-[11.5px] font-semibold tracking-[0.04em] ${
        gelap ? 'bg-white/10' : 'bg-[color:var(--sb-rel,rgb(127_127_127/0.16))]'
      } ${kelas}`}
    >
      <span
        aria-hidden
        className={`absolute inset-y-[3px] left-[3px] w-[calc(50%-3px)] rounded-full transition-transform duration-300 ease-liquid ${
          gelap ? 'bg-white/90' : 'bg-[color:var(--sb-isi,#ffffff)]'
        }`}
        style={{ transform: bahasa === 'en' ? 'translateX(100%)' : 'none' }}
      />
      {(['id', 'en'] as const).map((b) => (
        <button
          key={b}
          type="button"
          onClick={() => ganti(b)}
          aria-pressed={bahasa === b}
          className={`relative cursor-pointer rounded-full px-2.5 py-1 uppercase transition-colors duration-300 ${
            bahasa === b
              ? gelap
                ? 'text-[#06100e]'
                : 'text-[color:var(--sb-aktif,#06100e)]'
              : gelap
                ? 'text-white/60 hover:text-white'
                : 'text-[color:var(--sb-redup,rgb(127_127_127))] hover:text-[color:var(--sb-hover,#06100e)]'
          }`}
        >
          {b}
        </button>
      ))}
    </div>
  )
}


/* ==========================================================================
   Tema: terang atau gelap
   ==========================================================================

   BERDIRI SENDIRI, tidak lagi diturunkan dari gaya basemap. Sampai 11 Sep 2026
   tema aplikasi mengikuti basemap yang kebetulan dipilih: memilih basemap
   Gelap menggelapkan seluruh chrome, memilih Terang menerangkannya. Itu
   pintar dan salah - orang yang ingin peta satelit gelap dengan panel terang,
   atau sebaliknya, tidak punya cara menyatakannya, dan halaman gerbang tidak
   ikut sama sekali.

   BAWAANNYA GELAP, permintaan pemilik repo. Bukan bahasa peramban dan bukan
   `prefers-color-scheme`: produk ini dinilai juri yang membuka tautannya
   sekali, dan yang harus mereka lihat pertama kali adalah tampilan yang
   dirancang untuknya - bukan tampilan yang kebetulan disetel laptop mereka.
   Yang mau terang tinggal menekan sakelarnya, dan pilihannya diingat.
   ========================================================================== */

export type Tema = 'terang' | 'gelap'

const KUNCI_TEMA = 'loconomics:tema'

function bacaTema(): Tema {
  try {
    const t = localStorage.getItem(KUNCI_TEMA)
    if (t === 'terang' || t === 'gelap') return t
  } catch {
    /* localStorage bisa ditolak; tema bawaan tetap sah */
  }
  return 'gelap'
}

const KonteksTema = createContext<{
  tema: Tema
  gantiTema: (asal?: { x: number; y: number }) => void
}>({ tema: 'gelap', gantiTema: () => {} })

/**
 * Tirai CAIR: lingkaran yang mekar dari tombolnya, tema ditukar di baliknya,
 * lalu lingkarannya memudar.
 *
 * Warnanya warna dasar tema TUJUAN - kalau ia warna tema sekarang, yang
 * terlihat cuma layar berkedip lalu berganti, bukan satu gerakan.
 */
const DASAR: Record<Tema, string> = { gelap: '#0b100e', terang: '#f2f8f6' }

export function TemaProvider({ children }: { children: ReactNode }) {
  const [tema, setTema] = useState<Tema>(bacaTema)
  const [tirai, setTirai] = useState<{
    fase: 'tutup' | 'buka'
    x: number
    y: number
    d: number
    warna: string
  } | null>(null)
  const jam = useRef<number[]>([])

  useEffect(
    () => () => {
      jam.current.forEach((j) => window.clearTimeout(j))
    },
    [],
  )

  // Kelas dipasang di <html>, bukan di <body>: ketiga dialog produk ini
  // dirender `createPortal` ke <body>, dan yang di AKAR pasti menaungi
  // keduanya tanpa perlu diingat siapa pun.
  useEffect(() => {
    document.documentElement.dataset.tema = tema
    try {
      localStorage.setItem(KUNCI_TEMA, tema)
    } catch {
      /* diam: pilihan tetap berlaku untuk sesi ini */
    }
  }, [tema])

  const gantiTema = useCallback(
    (asal?: { x: number; y: number }) => {
      const tujuan: Tema = tema === 'gelap' ? 'terang' : 'gelap'
      const pelan = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (pelan || !asal) {
        setTema(tujuan)
        return
      }
      // Diameter = dua kali jarak terjauh dari titik asal ke sudut layar.
      const jauh = Math.max(
        Math.hypot(asal.x, asal.y),
        Math.hypot(window.innerWidth - asal.x, asal.y),
        Math.hypot(asal.x, window.innerHeight - asal.y),
        Math.hypot(window.innerWidth - asal.x, window.innerHeight - asal.y),
      )
      setTirai({ fase: 'tutup', x: asal.x, y: asal.y, d: jauh * 2.2, warna: DASAR[tujuan] })
      jam.current.push(
        window.setTimeout(() => {
          setTema(tujuan)
          setTirai((t) => (t ? { ...t, fase: 'buka' } : null))
        }, 460),
        window.setTimeout(() => setTirai(null), 900),
      )
    },
    [tema],
  )

  const nilai = useMemo(() => ({ tema, gantiTema }), [tema, gantiTema])
  return (
    <KonteksTema.Provider value={nilai}>
      {children}
      {tirai && (
        <div
          className="tirai-tema"
          data-fase={tirai.fase}
          aria-hidden
          style={
            {
              '--tt-x': `${tirai.x}px`,
              '--tt-y': `${tirai.y}px`,
              '--tt-d': `${tirai.d}px`,
              '--tt-warna': tirai.warna,
            } as CSSProperties
          }
        >
          <span className="tirai-tema-isi" />
        </div>
      )}
    </KonteksTema.Provider>
  )
}

export function useTema() {
  return useContext(KonteksTema)
}

const K_TEMA = {
  id: { keTerang: 'Ganti ke tampilan terang', keGelap: 'Ganti ke tampilan gelap' },
  en: { keTerang: 'Switch to light appearance', keGelap: 'Switch to dark appearance' },
}

/**
 * Sakelar tema. Satu tombol untuk kedua tempatnya - bilah gerbang dan bilah
 * peta - supaya keduanya tidak pernah berbeda bentuk maupun perilaku.
 *
 * Glifnya BERPUTAR saat ditekan, dan yang berputar bukan ikonnya melainkan
 * topeng di dalamnya: bulan adalah matahari yang tergigit lingkaran kedua, dan
 * menggeser lingkaran itu mengubah yang satu jadi yang lain tanpa dua gambar.
 */
export function SakelarTema({ gelap, kelas = '' }: { gelap?: boolean; kelas?: string }) {
  const { tema, gantiTema } = useTema()
  const t = useTeks(K_TEMA)
  const keTerang = tema === 'gelap'
  return (
    <button
      type="button"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        gantiTema({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
      }}
      title={keTerang ? t.keTerang : t.keGelap}
      aria-label={keTerang ? t.keTerang : t.keGelap}
      className={`sakelar-tema grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full transition-colors ${
        gelap
          ? 'text-white/70 hover:bg-white/10 hover:text-white'
          : 'text-[color:var(--sb-redup,rgb(127_127_127))] hover:bg-[color:var(--sb-rel,rgb(127_127_127/0.16))] hover:text-[color:var(--sb-hover,#06100e)]'
      } ${kelas}`}
    >
      {/* Glifnya menyatakan yang AKAN DIDAPAT, bukan yang sedang berlaku.
          Matahari saat gelap ("tekan untuk terang"), bulan saat terang. Dua
          konvensi sama-sama hidup di produk lain, dan yang menentukan di sini
          `aria-label`-nya sendiri: ia berbunyi "Ganti ke tampilan terang", jadi
          gambarnya harus menggambarkan tujuan itu, bukan tempat berangkatnya.

          Bulan itu MATAHARI yang tergigit lingkaran kedua - satu bentuk, bukan
          dua gambar, jadi pergantiannya bisa jadi gerakan kalau kelak
          diinginkan. */}
      <svg width="17" height="17" viewBox="0 0 20 20" aria-hidden>
        <defs>
          <mask id="sakelar-tema-topeng">
            <rect width="20" height="20" fill="white" />
            <circle cx={keTerang ? 26 : 15.2} cy={keTerang ? 0 : 5.4} r="7.2" fill="black" />
          </mask>
        </defs>
        <circle
          cx="10"
          cy="10"
          r={keTerang ? 4.7 : 7.2}
          fill="currentColor"
          mask="url(#sakelar-tema-topeng)"
        />
        {/* Sinar hanya menyertai matahari. Bulan tidak bersinar ke luar. */}
        <g
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          style={{ opacity: keTerang ? 1 : 0 }}
        >
          <path d="M10 1.4v1.8M10 16.8v1.8M18.6 10h-1.8M3.2 10H1.4M16.1 3.9l-1.3 1.3M5.2 14.8l-1.3 1.3M16.1 16.1l-1.3-1.3M5.2 5.2 3.9 3.9" />
        </g>
      </svg>
    </button>
  )
}
