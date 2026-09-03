/**
 * Bagian wajib 3 dari 3: Antarmuka AI.
 *
 * Yang membuat bagian ini memenuhi ketentuan C.2 bukan kotak percakapannya,
 * melainkan `jalankanAksi()` di bawah: jawaban AI tidak berhenti sebagai teks,
 * ia menggerakkan peta.
 *
 *   cari_lokasi, jelaskan_skor, cek_harga, pola_jam, cek_zona,
 *   cari_hidden_gem, cek_risiko, bandingkan  → dijalankan backend
 *   flyTo, highlight, setLayer, filter        → dijalankan DI SINI
 *
 * Kalau flyTo dieksekusi backend, tidak ada yang bergerak di layar pengguna.
 *
 * Satu keputusan tampilan yang layak disebut: setiap jawaban membawa jejak alat
 * yang benar-benar dipanggil, dan jejak itu DITAMPILKAN, tidak disembunyikan di
 * log. Asisten yang bisa ditanya "dari mana angkanya" dan menjawab dengan daftar
 * fungsi yang ia jalankan jauh lebih layak dipercaya daripada yang hanya
 * terdengar meyakinkan.
 */

import { useEffect, useRef, useState } from 'react'

import { LAYER, type NamaLayer } from '../config'
import { api } from '../lib/api'
import type { AksiPeta, JawabanAI, PesanRiwayat, StatusAI } from '../types'
import type { KendaliPeta, Kriteria } from './PetaInteraktif'
import { Badge, Markdown } from './primitif'

interface Pesan {
  peran: 'pengguna' | 'asisten'
  teks: string
  jawaban?: JawabanAI
}

/** Terjemahkan galat backend jadi kalimat yang bisa ditindaklanjuti. */
function pesanGalat(e: unknown): string {
  const teks = e instanceof Error ? e.message : String(e)
  if (teks.includes('501'))
    return 'Konsultan AI belum tersambung ke penyedia modelnya. Bagian lain di peta — skor, kuadran, ZoneGuard, dan rekomendasi — tidak terpengaruh.'
  if (teks.includes('ANGGARAN_AI_HABIS'))
    return 'Plafon biaya AI untuk hari ini sudah tercapai. Asisten aktif lagi besok.'
  if (teks.includes('TERLALU_BANYAK'))
    return 'Terlalu banyak pertanyaan dalam waktu singkat. Tunggu sebentar lalu coba lagi.'
  if (teks.includes('BASIS_DATA'))
    return 'Basis data sedang tidak bisa dihubungi. Kalau ini terjadi setelah lama menganggur, coba lagi dalam beberapa puluh detik.'
  return `Gagal menghubungi asisten: ${teks}`
}

/** Nama alat dalam bahasa manusia, untuk jejak yang ditampilkan. */
const NAMA_ALAT: Record<string, string> = {
  cari_lokasi: 'mencari lokasi',
  bandingkan: 'membandingkan dua lokasi',
  jelaskan_skor: 'membaca rincian skor',
  cek_harga: 'membaca harga sewa',
  pola_jam: 'membaca pola jam',
  cek_zona: 'memeriksa izin zona',
  cari_hidden_gem: 'mencari hidden gem',
  cek_risiko: 'memeriksa risiko',
  flyTo: 'menggerakkan peta',
  highlight: 'menyorot heksagon',
  setLayer: 'mengganti layer',
  filter: 'menyaring peta',
}

/**
 * Nama produk yang berombak selama asisten menjawab.
 *
 * Menggantikan "Menganalisis…" dengan titik berdenyut. Bedanya bukan
 * kemeriahan: titik berdenyut menyatakan SESUATU sedang berjalan, sementara
 * yang sebenarnya ingin diketahui orang yang baru menekan kirim adalah bahwa
 * pertanyaannya SAMPAI dan sedang dikerjakan - dan tidak ada yang menyatakan
 * itu sebaik nama yang mengerjakannya.
 *
 * Hurufnya dipecah supaya tiap huruf bisa berangkat pada waktunya sendiri;
 * itu yang membuat geraknya terbaca sebagai gelombang yang MENJALAR, bukan
 * sebagai kata yang naik-turun serempak.
 *
 * `aria-label` memakai kalimat biasa, dan hurufnya disembunyikan dari pembaca
 * layar: "L-o-c-o-n-o-m-i-c-s" dieja satu per satu bukan kabar yang berguna.
 */
function OmbakBerpikir() {
  return (
    <p
      className="ai-ombak flex items-center text-[15px] font-semibold tracking-tight text-ink"
      role="status"
      aria-label="Konsultan sedang menganalisis"
    >
      {'Loconomics'.split('').map((h, i) => (
        <span key={i} aria-hidden style={{ animationDelay: `${i * 85}ms` }}>
          {h}
        </span>
      ))}
    </p>
  )
}

const CONTOH = [
  'Lokasi kopi di bawah 3 juta per bulan dekat Manggarai',
  'Kenapa skor heksagon ini segitu?',
  'Mana yang berisiko menjebak di Dukuh Atas BNI?',
]

export default function PanelAI({
  kendali,
  hexTerpilih,
  layerAktif,
  terbuka,
  onLipat,
}: {
  kendali: KendaliPeta
  hexTerpilih: string | null
  /**
   * Layer yang sedang tampil, diteruskan ke model sebagai konteks.
   *
   * Prompt sistem menyuruh asisten mengganti layer sesuai pertanyaan
   * ("soal harga -> pricelens"). Tanpa tahu layer mana yang SEDANG aktif, ia
   * memanggil setLayer untuk layer yang sudah terpasang - peta tidak bergerak,
   * dan aksi peta yang dijanjikan ketentuan C.2 jadi tidak terlihat.
   */
  layerAktif: NamaLayer
  terbuka: boolean
  onLipat: () => void
}) {
  const [pesan, setPesan] = useState<Pesan[]>([])
  const [input, setInput] = useState('')
  const [memuat, setMemuat] = useState(false)
  const [status, setStatus] = useState<StatusAI | null>(null)
  const akhir = useRef<HTMLDivElement>(null)

  // Kesiapan diperiksa saat memuat, bukan saat pertanyaan pertama gagal.
  // Memberi tahu di awal jauh lebih sopan daripada membiarkan orang mengetik
  // pertanyaan panjang lalu menolaknya.
  useEffect(() => {
    api.statusAI().then(setStatus).catch(() => setStatus(null))
  }, [])

  /**
   * Menerjemahkan `aksi_peta` dari LLM menjadi gerakan peta yang sebenarnya.
   *
   * Nama fungsi divalidasi lewat `switch`, bukan dipanggil dinamis. Setiap
   * argumen juga diperiksa tipenya: keluaran model diperlakukan sebagai data
   * yang belum tentu benar, bukan perintah yang tinggal dijalankan.
   */
  function jalankanAksi(aksi: AksiPeta) {
    const arg = aksi.argumen
    switch (aksi.fungsi) {
      case 'flyTo':
        if (typeof arg.lat === 'number' && typeof arg.lon === 'number')
          kendali.flyTo(arg.lat, arg.lon, typeof arg.zoom === 'number' ? arg.zoom : undefined)
        break
      case 'highlight':
        if (Array.isArray(arg.hex_ids))
          kendali.highlight(arg.hex_ids.filter((x): x is string => typeof x === 'string'))
        break
      case 'setLayer':
        if (typeof arg.nama_layer === 'string' && arg.nama_layer in LAYER)
          kendali.setLayer(arg.nama_layer as NamaLayer)
        break
      case 'filter':
        kendali.filter(
          arg.kriteria && typeof arg.kriteria === 'object' ? (arg.kriteria as Kriteria) : null,
        )
        break
      default:
        // Alat backend sudah dijalankan di server; hasilnya ada di dalam `teks`.
        break
    }
  }

  async function kirim(pertanyaan: string) {
    if (!pertanyaan.trim() || memuat) return
    setPesan((s) => [...s, { peran: 'pengguna', teks: pertanyaan }])
    setInput('')
    setMemuat(true)

    try {
      // Riwayat dikirim ulang tiap giliran; backend tidak menyimpan sesi.
      // Dipotong 20 pesan supaya sama dengan batas backend — kalau lebih,
      // permintaannya ditolak validasi, bukan dipotong diam-diam.
      const riwayat: PesanRiwayat[] = pesan
        .slice(-20)
        .map((m) => ({ peran: m.peran, teks: m.teks }))

      const jawaban = await api.tanyaAI({
        pertanyaan,
        riwayat,
        hex_terpilih: hexTerpilih,
        layer_aktif: layerAktif,
      })
      jawaban.aksi_peta.forEach(jalankanAksi)
      setPesan((s) => [...s, { peran: 'asisten', teks: jawaban.teks, jawaban }])
    } catch (e) {
      setPesan((s) => [...s, { peran: 'asisten', teks: pesanGalat(e) }])
    } finally {
      setMemuat(false)
      requestAnimationFrame(() => akhir.current?.scrollIntoView({ behavior: 'smooth' }))
    }
  }

  const mati = status !== null && !status.siap

  return (
    <div className="flex h-full flex-col">
      {/* Bilah judul merangkap tombol tutup. Sejak panel ini punya tombol
          melayang sendiri, ia tidak lagi ikut mengantre ruang vertikal dengan
          daftar lokasi - dan daftar itu langsung dapat kembali 18rem. */}
      <button
        onClick={onLipat}
        aria-expanded={terbuka}
        className="flex w-full shrink-0 cursor-pointer items-center justify-between gap-2 border-b border-line/70 px-4 py-3 text-left transition-colors hover:bg-surface-2/60"
      >
        <span className="flex items-center gap-1.5">
          <svg
            width="9"
            height="9"
            viewBox="0 0 10 10"
            aria-hidden
            className={`text-ink-3 transition-transform ${terbuka ? '' : 'rotate-180'}`}
          >
            <path d="M1 6.5 5 2.5 9 6.5" stroke="currentColor" strokeWidth="1.6" fill="none" />
          </svg>
          <span className="eyebrow">Konsultan AI</span>
        </span>
        <span
          className="flex items-center gap-1.5 text-[12px] text-ink-3"
          title={
            status?.siap
              ? `${status.model} · ${status.n_alat_backend} alat data, ${status.n_alat_peta} aksi peta`
              : (status?.pesan ?? 'memeriksa kesiapan…')
          }
        >
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${
              status === null ? 'bg-line-2' : status.siap ? 'bg-gem' : 'bg-line-2'
            }`}
          />
          {status === null ? 'memeriksa' : status.siap ? 'siap' : 'belum aktif'}
        </span>
      </button>

      {!terbuka && null}

      {terbuka && (
      <div className="scroll-tipis flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {pesan.length === 0 && (
          <div>
            <p className="mb-2.5 text-[14.5px] leading-snug text-ink-2">
              Tanyakan apa saja tentang lokasi. Jawabannya sekaligus menggerakkan peta.
            </p>
            {/* Pesannya dipakai APA ADANYA, tidak lagi disisipkan ke tengah
                kalimat yang dirakit di sini. Kalimat rakitan itulah yang dulu
                membuat teks backend terbaca sebagai instruksi untuk
                pembacanya, dan ia akan mengulanginya untuk setiap sebab
                berikutnya. */}
            {mati && (
              <p className="mb-2.5 rounded-sm border border-line bg-surface-2 px-2.5 py-2 text-[13.5px] leading-snug text-ink-2">
                {status?.pesan}
              </p>
            )}
            <div className="space-y-1.5">
              {CONTOH.map((c) => (
                <button
                  key={c}
                  onClick={() => kirim(c)}
                  disabled={mati}
                  className="block w-full cursor-pointer rounded-sm border border-line px-2.5 py-2 text-left text-[13.5px] leading-snug text-ink-2 transition-colors hover:border-line-2 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {pesan.map((m, i) => (
          <div key={i} className={m.peran === 'pengguna' ? 'flex justify-end' : ''}>
            {m.peran === 'pengguna' ? (
              <p className="max-w-[85%] rounded-md rounded-br-xs bg-ink px-3.5 py-2 text-[14.5px] leading-snug text-surface">
                {m.teks}
              </p>
            ) : (
              <div className="max-w-[94%] text-[14.5px] text-ink">
                {/* Jawaban model dirender sebagai Markdown, bukan teks polos.
                    Prompt A1-A4 memang meminta daftar bernomor dan tebal, dan
                    sampai sekarang tanda bintangnya tampil apa adanya di layar. */}
                <Markdown teks={m.teks} />

                {/* Jejak: alat apa yang benar-benar dipanggil. Ditampilkan,
                    bukan disembunyikan — inilah yang membuat prosesnya bisa
                    diperiksa alih-alih hanya terdengar meyakinkan. */}
                {m.jawaban && m.jawaban.jejak.length > 0 && (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer list-none text-[12.5px] text-ink-3 underline decoration-line-2 underline-offset-2 hover:text-ink-2">
                      {m.jawaban.jejak.length} langkah dijalankan
                    </summary>
                    <ol className="mt-1 space-y-0.5 border-l border-line pl-2.5">
                      {m.jawaban.jejak.map((j, k) => (
                        <li key={k} className="text-[12.5px] leading-snug text-ink-3">
                          <span className="text-ink-2">{NAMA_ALAT[j.fungsi] ?? j.fungsi}</span>
                          {' — '}
                          {j.ringkas_hasil}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}

                {m.jawaban && m.jawaban.sumber_angka.length > 0 && (
                  <div className="mt-1.5 rounded-sm bg-surface-2 px-2.5 py-1.5">
                    <p className="eyebrow mb-1">Sumber angka</p>
                    <ul className="space-y-0.5">
                      {m.jawaban.sumber_angka.slice(0, 5).map((f) => (
                        <li key={f.kode_variabel} className="text-[12.5px] text-ink-2">
                          <span className="font-mono">{f.kode_variabel}</span>
                          {f.persentil !== null && (
                            <span className="text-ink-3">
                              {' '}
                              ·{' '}
                              {f.persentil >= 99.5
                                ? 'tertinggi di wilayah studi'
                                : `lebih tinggi dari ${f.persentil.toFixed(0)}% lokasi lain`}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {m.jawaban?.keyakinan && (
                  <div className="mt-1.5">
                    <Badge badge={m.jawaban.keyakinan} ringkas />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {memuat && <OmbakBerpikir />}
        <div ref={akhir} />
      </div>
      )}

      {terbuka && (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          kirim(input)
        }}
        className="shrink-0 border-t border-line p-2.5"
      >
        {/* Kaca cair. `data-berpikir` yang menyalakan cincin warnanya - satu
            atribut, dan seluruh animasinya hidup di CSS. Tidak ada satu pun
            nilai animasi yang ditulis dari JavaScript per bingkai. */}
        <div className="ai-kaca flex items-center gap-1.5 rounded-full p-1.5" data-berpikir={memuat}>
          <span className="ai-cincin" aria-hidden />
          <label className="sr-only" htmlFor="tanya-ai">
            Pertanyaan untuk konsultan AI
          </label>
          <input
            id="tanya-ai"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={mati}
            placeholder={
              hexTerpilih ? 'Tanya soal heksagon terpilih…' : 'Tanya soal lokasi…'
            }
            className="min-w-0 flex-1 bg-transparent px-3 py-1.5 text-[14.5px] outline-none disabled:opacity-45"
          />
          {/* Ikon saja, tanpa kata "Kirim".

              Panah ke atas adalah kosakata yang sudah dipakai setiap kotak
              tanya yang pernah dipakai pembacanya, jadi ia tidak menuntut
              dibaca. Yang didapat bukan cuma ruang: tombol bundar seukuran
              jempol jauh lebih gampang ditekan di ponsel daripada pil teks
              setinggi 34px.

              `aria-label` menggantikan katanya untuk pembaca layar - ikon
              tanpa nama adalah tombol tanpa nama. */}
          <button
            type="submit"
            disabled={memuat || mati || !input.trim()}
            aria-label="Kirim pertanyaan"
            className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full bg-white text-[#101a16] transition-all duration-300 ease-jelly hover:scale-[1.07] disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:scale-100 ai-kirim"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path
                d="M8 13V3.4M3.8 7.6 8 3.4l4.2 4.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </form>
      )}
    </div>
  )
}
