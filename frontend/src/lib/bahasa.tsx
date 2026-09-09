/**
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

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

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
