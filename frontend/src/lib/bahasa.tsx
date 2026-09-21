
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'

import {
  ARTI_INDEKS,
  ARTI_INDEKS_EN,
  ARTI_KODE,
  ARTI_KODE_EN,
  ARTI_VARIABEL,
  ARTI_VARIABEL_EN,
  KUADRAN,
  TANYA_INDEKS,
  TANYA_INDEKS_EN,
  kataIndeks,
} from '../config'

export type Bahasa = 'id' | 'en'

const KUNCI = 'loconomics:bahasa'

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
  const [bahasa, setBahasa] = useState<Bahasa>(() => {
    const b = bacaAwal()
    document.documentElement.lang = b
    return b
  })

  const ganti = useCallback((b: Bahasa) => {
    document.documentElement.lang = b
    setBahasa(b)
    try {
      localStorage.setItem(KUNCI, b)
    } catch {
      /* diam: pilihan tetap berlaku untuk sesi ini */
    }
  }, [])

  const nilai = useMemo(() => ({ bahasa, ganti }), [bahasa, ganti])
  return <Konteks.Provider value={nilai}>{children}</Konteks.Provider>
}

export function useBahasa() {
  return useContext(Konteks)
}

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

export function useIstilah() {
  const { bahasa } = useContext(Konteks)
  return useMemo(() => {
    const en = bahasa === 'en'
    return {
      bahasa,
      /** Nama awam sebuah KOLOM basis data, berikut satuannya. */
      variabel: (kolom: string) => {
        const dasar = ARTI_VARIABEL[kolom]
        if (!dasar) return null
        const alih = en ? ARTI_VARIABEL_EN[kolom] : null
        return {
          kode: dasar.kode,
          nama: alih?.nama ?? dasar.nama,
          satuan: alih?.satuan ?? dasar.satuan,
        }
      },
      /** Nama awam sebuah KODE variabel (D01, B07, ...). */
      kode: (kode: string) => (en ? ARTI_KODE_EN[kode] : ARTI_KODE[kode]) ?? kode,
      /** Arti singkat sebuah indeks, untuk dipakai di tengah kalimat. */
      indeks: (kode: string) => (en ? ARTI_INDEKS_EN[kode] : ARTI_INDEKS[kode]) ?? kode,
      /** Pertanyaan yang sebenarnya dijawab indeks itu. */
      tanya: (kode: string) => (en ? TANYA_INDEKS_EN[kode] : TANYA_INDEKS[kode]) ?? '',
      /** Angka 0-1 jadi kata, sesuai kosakata indeksnya. */
      kata: (kode: string, nilai: number | null) => kataIndeks(kode, nilai, bahasa),
    }
  }, [bahasa])
}

export function SakelarBahasa({ kelas = '' }: { kelas?: string }) {
  const { bahasa, ganti } = useBahasa()
  return (
    <div
      role="group"
      aria-label={bahasa === 'id' ? 'Bahasa antarmuka' : 'Interface language'}
      className={`relative grid grid-cols-2 rounded-full bg-[color:var(--sb-rel,rgb(127_127_127/0.16))] p-[3px] text-[11.5px] font-semibold tracking-[0.04em] ${kelas}`}
    >
      <span
        aria-hidden
        className="absolute inset-y-[3px] left-[3px] w-[calc(50%-3px)] rounded-full bg-[color:var(--sb-isi,#ffffff)] transition-transform duration-300 ease-liquid"
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
              ? 'text-[color:var(--sb-aktif,#06100e)]'
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
  /** `sakelar` = tombol yang ditekan, supaya ia bergerak sendiri di atas silang-pudarnya. */
  gantiTema: (sakelar?: HTMLElement | null) => void
}>({ tema: 'gelap', gantiTema: () => {} })

/** Lama silang-pudar, milidetik. Sama dengan `::view-transition-*(root)` di index.css. */
const PUDAR_MS = 520

type DokumenVT = Document & {
  startViewTransition?: (ubah: () => void) => { finished: Promise<void> }
}

export function TemaProvider({ children }: { children: ReactNode }) {
  const [tema, setTema] = useState<Tema>(bacaTema)
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
    (sakelar?: HTMLElement | null) => {
      const tujuan: Tema = tema === 'gelap' ? 'terang' : 'gelap'
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setTema(tujuan)
        return
      }
      const akar = document.documentElement
      const dok = document as DokumenVT

      if (!dok.startViewTransition) {
        akar.dataset.alihTema = 'css'
        setTema(tujuan)
        jam.current.push(window.setTimeout(() => delete akar.dataset.alihTema, PUDAR_MS + 60))
        return
      }

      if (sakelar) sakelar.style.setProperty('view-transition-name', 'sakelar-tema')
      akar.dataset.alihTema = 'vt'
      const transisi = dok.startViewTransition(() => {
        flushSync(() => setTema(tujuan))
        akar.dataset.tema = tujuan
      })
      transisi.finished.finally(() => {
        delete akar.dataset.alihTema
        sakelar?.style.removeProperty('view-transition-name')
      })
    },
    [tema],
  )

  const nilai = useMemo(() => ({ tema, gantiTema }), [tema, gantiTema])
  return <KonteksTema.Provider value={nilai}>{children}</KonteksTema.Provider>
}

export function useTema() {
  return useContext(KonteksTema)
}

const K_TEMA = {
  id: { label: 'Terang', gelap: 'Gelap', ganti: 'Ganti tampilan terang atau gelap' },
  en: { label: 'Light', gelap: 'Dark', ganti: 'Switch between light and dark appearance' },
}

export function SakelarTema({ kelas = '' }: { kelas?: string }) {
  const { tema, gantiTema } = useTema()
  const t = useTeks(K_TEMA)
  const terang = tema === 'terang'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!terang}
      data-tema={tema}
      onClick={(e) => gantiTema(e.currentTarget)}
      title={t.ganti}
      aria-label={t.ganti}
      className={`sakelar-tema ${kelas}`}
    >
      {/* KEDUA kata selalu dirender. Yang tidak berlaku dipudarkan sambil
          digeser, dan itu yang membuat pergantiannya jadi satu gerakan. */}
      <span className="st-kata" data-sisi="kanan" data-aktif={terang ? '1' : '0'}>
        {t.label}
      </span>
      <span className="st-kata" data-sisi="kiri" data-aktif={terang ? '0' : '1'}>
        {t.gelap}
      </span>

      <span className="st-kenop">
        {/* Dua glif yang bersilangan, bukan satu bentuk bertopeng.
            Versi bertopeng lebih pintar - bulan adalah matahari yang tergigit
            lingkaran kedua - tetapi `cx`/`r` sebuah <circle> tidak bisa
            ditransisikan dengan andal di setiap peramban, jadi yang "pintar"
            itu berpindah dengan cara mematah. Dua glif selalu bisa. */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 20 20"
          className="st-glif"
          data-jenis="surya"
          data-aktif={terang ? '1' : '0'}
          aria-hidden
        >
          <circle cx="10" cy="10" r="4.4" fill="currentColor" />
          <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d="M10 1.5v2M10 16.5v2M18.5 10h-2M3.5 10h-2M16 4l-1.4 1.4M5.4 14.6 4 16M16 16l-1.4-1.4M5.4 5.4 4 4" />
          </g>
        </svg>
        <svg
          width="16"
          height="16"
          viewBox="0 0 20 20"
          className="st-glif"
          data-jenis="bulan"
          data-aktif={terang ? '0' : '1'}
          aria-hidden
        >
          <path
            d="M16.2 12.6A7.2 7.2 0 0 1 7.4 3.8a7.2 7.2 0 1 0 8.8 8.8Z"
            fill="currentColor"
          />
        </svg>
      </span>
    </button>
  )
}
