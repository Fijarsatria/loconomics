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
 * supaya "Aman" dan "Safe" tidak pernah bisa tampil di dua sudut layar
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
 * Kosakata BERSAMA - 43 nama variabel, keempat indeks, dan kata-kata yang
 * menerjemahkan angka 0-1 - dalam bahasa yang sedang berlaku.
 *
 * Kenapa satu kait, bukan enam: yang memakainya cuma panel detail, simulasi,
 * dan komparasi, dan ketiganya memakai SELURUHNYA sekaligus. Enam kait berarti
 * enam baris `useX()` di kepala tiap komponen dan enam kesempatan salah satu
 * lupa ditulis - dan yang lupa itu tidak gagal, ia menampilkan bahasa
 * Indonesia di layar berbahasa Inggris.
 *
 * Yang TIDAK ada di sini: `TINGGI_BAIK`. Ia menentukan warna bilah, bukan kata
 * - dan arah "tinggi itu kabar baik" sama di kedua bahasa.
 */
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

/**
 * Sakelar dua posisi ID / EN.
 *
 * Tinggal di SATU tempat: menu pengaturan - yang sama di bilah gerbang dan di
 * bilah peta. Sampai 11 Sep 2026 gerbang memasangnya langsung di bilah atas,
 * lengkap dengan varian `gelap` untuk bilah yang turun ke jurang; varian itu
 * ikut dicabut begitu sakelarnya pindah ke dalam menu, yang membawa tokennya
 * sendiri lewat `.app-sakelar-bahasa`.
 */
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

  /**
   * SILANG-PUDAR HALAMANNYA SENDIRI - isinya tidak pernah hilang dari layar.
   *
   * Ini bentuk KEEMPAT transisi ini. Tiga yang pertama - lingkaran yang mekar,
   * sapuan mendatar, lalu selembar warna tema tujuan yang menutup layar - punya
   * satu kesamaan yang baru terlihat sesudah yang ketiga ditolak: ketiganya
   * MENYEMBUNYIKAN pergantiannya di balik sesuatu. Selama beberapa ratus
   * milidetik layarnya putih polos atau hitam polos, dan pemilik repo
   * menyebutnya persis begitu: "gausah sampe kayak memutihkan semuanya /
   * gelapkan semuanya sampai ga kelihatan semuanya".
   *
   * Yang dilakukan sekarang: peramban MEMOTRET halaman lama, tema ditukar, lalu
   * potret lama memudar di atas halaman baru yang sudah hidup. Pada setiap
   * bingkai, judul, peta, dan tombol tetap di tempatnya - yang berubah cuma
   * warnanya, dari yang satu ke yang lain. Tidak ada satu bingkai pun yang
   * kosong.
   *
   * View Transitions API. Kekhawatiran lama soal kanvas WebGL diperiksa lewat
   * bingkai yang DIBEKUKAN di tengah pudar (animasinya dijeda lewat Web
   * Animations API, lalu dipotret): kanvas peta tetap tergambar di setiap
   * bingkai, dan yang dipotret peramban cuma satu tekstur seukuran layar,
   * sekali, bukan per bingkai. Di titik tengah (260 ms) judul dan tombol
   * gerbang masih terbaca jelas - simpangan luminansinya 18,5, sementara
   * selembar warna polos mendekati nol.
   *
   * SAKELARNYA TIDAK IKUT DIPUDARKAN. Tombol yang ditekan diberi
   * `view-transition-name` sendiri sepanjang transisi, dan index.css
   * menyembunyikan potret LAMA-nya - jadi yang terlihat cuma kenop yang
   * meluncur dengan transisinya sendiri, bukan dua kenop yang saling menembus.
   *
   * Tanpa API itu (peramban lama), warna halaman ditransisikan CSS selama
   * pergantian saja - lihat `[data-alih-tema]` di index.css. Kurang rapi
   * (gradien dan gambar tidak bisa ditransisikan), tetapi tetap tidak pernah
   * menutup layar.
   */
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
        // `flushSync`: potret BARU diambil begitu fungsi ini selesai, jadi
        // tema baru harus sudah tertulis ke DOM saat itu - bukan dijadwalkan
        // untuk render berikutnya. `data-tema` di <html> ikut ditulis di sini
        // karena efek yang biasanya menulisnya belum tentu sudah berjalan.
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

/**
 * Sakelar tema. Tinggal di menu pengaturan, dan menu itu SATU komponen untuk
 * bilah gerbang dan bilah peta - supaya keduanya tidak pernah berbeda bentuk
 * maupun arti. Sampai 11 Sep 2026 gerbang memasangnya di tengah bawah hero.
 *
 * BENTUKNYA pil, bukan tombol bundar, dan itu permintaan pemilik repo dengan
 * dua gambar rujukan: kenop meluncur di dalam pil beku, matahari di kiri saat
 * terang dan bulan di kanan saat gelap, dengan katanya di sisi yang tersisa.
 *
 * IKONNYA MENYATAKAN KEADAAN, bukan tujuan. Versi bundar sebelumnya memasang
 * matahari saat halaman GELAP dengan alasan "tekan untuk terang" - dan dibaca
 * pemilik repo sebagai terbalik. Ia benar, dan bentuk barunya yang
 * menyelesaikan perdebatannya: begitu ada KATA di sebelah ikonnya, keduanya
 * harus berbicara tentang hal yang sama. "Dark" di sebelah matahari adalah
 * kalimat yang bertengkar dengan dirinya sendiri.
 */
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
