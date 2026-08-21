/**
 * Bagian wajib 3 dari 3: Antarmuka AI.
 *
 * Yang membuat bagian ini memenuhi ketentuan C.2 bukan kotak percakapannya,
 * melainkan `jalankanAksi()` di bawah: jawaban AI tidak berhenti sebagai teks,
 * ia menggerakkan peta.
 *
 * Pembagian kerja yang perlu dipahami sebelum mengubah berkas ini:
 *   cari_lokasi, bandingkan, jelaskan_skor  → dijalankan backend (menyentuh DB)
 *   flyTo, highlight, setLayer, filter      → dijalankan DI SINI
 *
 * Kalau flyTo dieksekusi backend, tidak ada yang bergerak di layar pengguna.
 */

import { useRef, useState } from 'react'

import { api } from '../lib/api'
import { LAYER, type NamaLayer } from '../config'
import type { AksiPeta, JawabanAI, PesanRiwayat } from '../types'
import type { KendaliPeta, Kriteria } from './PetaInteraktif'
import { Badge } from './PanelInsight'

interface Pesan {
  peran: 'pengguna' | 'asisten'
  teks: string
  jawaban?: JawabanAI
}

/** Terjemahkan galat backend jadi kalimat yang bisa ditindaklanjuti pengguna. */
function pesanGalat(e: unknown): string {
  const teks = e instanceof Error ? e.message : String(e)
  if (teks.includes('501'))
    return 'AI Consultant belum aktif — LLM_API_KEY belum diisi di backend. Seluruh jalur fungsinya sudah siap (lihat /ai/status).'
  if (teks.includes('429') && teks.includes('ANGGARAN'))
    return 'Plafon biaya AI untuk hari ini sudah tercapai. Asisten akan aktif lagi besok.'
  if (teks.includes('429'))
    return 'Terlalu banyak pertanyaan dalam waktu singkat. Tunggu sebentar lalu coba lagi.'
  if (teks.includes('503'))
    return 'Basis data sedang tidak bisa dihubungi. Kalau ini terjadi setelah lama menganggur, coba lagi dalam beberapa puluh detik.'
  return `Gagal menghubungi asisten: ${teks}`
}

const CONTOH = [
  'Cari lokasi kopi di bawah 3 juta per bulan dekat Manggarai',
  'Kenapa heksagon ini skornya tinggi?',
  'Mana yang lebih baik, Tanah Abang atau Bekasi?',
]

export default function PanelAI({
  kendali,
  hexTerpilih,
}: {
  kendali: KendaliPeta
  hexTerpilih: string | null
}) {
  const [pesan, setPesan] = useState<Pesan[]>([])
  const [input, setInput] = useState('')
  const [memuat, setMemuat] = useState(false)
  const akhir = useRef<HTMLDivElement>(null)

  /**
   * Menerjemahkan `aksi_peta` dari LLM menjadi gerakan peta yang sebenarnya.
   *
   * Nama fungsi divalidasi lewat `switch`, bukan dipanggil dinamis. LLM tidak
   * pernah boleh menentukan fungsi apa yang dieksekusi — ia hanya boleh memilih
   * dari daftar yang sudah ditulis di sini. Setiap argumen juga diperiksa
   * tipenya: keluaran model diperlakukan sebagai data yang belum tentu benar,
   * bukan sebagai perintah yang tinggal dijalankan.
   *
   * Nama argumen mengikuti FUNGSI_FRONTEND di backend/app/api/ai.py.
   */
  function jalankanAksi(aksi: AksiPeta) {
    const arg = aksi.argumen

    switch (aksi.fungsi) {
      case 'flyTo':
        if (typeof arg.lat === 'number' && typeof arg.lon === 'number') {
          kendali.flyTo(arg.lat, arg.lon, typeof arg.zoom === 'number' ? arg.zoom : undefined)
        }
        break

      case 'highlight':
        if (Array.isArray(arg.hex_ids)) {
          kendali.highlight(arg.hex_ids.filter((x): x is string => typeof x === 'string'))
        }
        break

      case 'setLayer':
        if (typeof arg.nama_layer === 'string' && arg.nama_layer in LAYER) {
          kendali.setLayer(arg.nama_layer as NamaLayer)
        }
        break

      case 'filter':
        kendali.filter(
          arg.kriteria && typeof arg.kriteria === 'object' ? (arg.kriteria as Kriteria) : null,
        )
        break

      default:
        // cari_lokasi / bandingkan / jelaskan_skor sudah dijalankan backend;
        // hasilnya sudah ada di dalam `teks` dan `sumber_angka`.
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
      // Dipotong 20 pesan terakhir supaya sama dengan batas backend - kalau lebih,
      // permintaannya ditolak validasi, bukan dipotong diam-diam.
      const riwayat: PesanRiwayat[] = pesan
        .slice(-20)
        .map((m) => ({ peran: m.peran, teks: m.teks }))

      const jawaban = await api.tanyaAI({ pertanyaan, riwayat, hex_terpilih: hexTerpilih })
      jawaban.aksi_peta.forEach(jalankanAksi)
      setPesan((s) => [...s, { peran: 'asisten', teks: jawaban.teks, jawaban }])
    } catch (e) {
      setPesan((s) => [
        ...s,
        {
          peran: 'asisten',
          teks: pesanGalat(e),
        },
      ])
    } finally {
      setMemuat(false)
      requestAnimationFrame(() => akhir.current?.scrollIntoView({ behavior: 'smooth' }))
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {pesan.length === 0 && (
          <div className="text-sm text-slate-500">
            <p className="mb-3">
              Tanyakan apa saja tentang lokasi. Jawaban akan sekaligus menggerakkan peta.
            </p>
            <div className="space-y-1.5">
              {CONTOH.map((c) => (
                <button
                  key={c}
                  onClick={() => kirim(c)}
                  className="block w-full rounded-md border border-slate-200 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {pesan.map((m, i) => (
          <div key={i} className={m.peran === 'pengguna' ? 'text-right' : ''}>
            <div
              className={`inline-block max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                m.peran === 'pengguna'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-900'
              }`}
            >
              {m.teks}
            </div>

            {/* Setiap angka harus bisa ditelusuri. Kalau AI menyebut angka, di
                bawah ini muncul variabel asalnya — bukan sekadar klaim. */}
            {m.jawaban && m.jawaban.sumber_angka.length > 0 && (
              <div className="mt-1.5 rounded-md bg-slate-50 px-3 py-2 text-left">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Sumber angka
                </p>
                <ul className="space-y-0.5">
                  {m.jawaban.sumber_angka.map((f) => (
                    <li key={f.kode_variabel} className="font-mono text-[11px] text-slate-600">
                      {f.kode_variabel} · {f.indeks} · persentil {f.persentil?.toFixed(0) ?? '—'}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {m.jawaban?.keyakinan && (
              <div className="mt-1.5 text-left">
                <Badge badge={m.jawaban.keyakinan} />
              </div>
            )}
          </div>
        ))}

        {memuat && <div className="text-sm text-slate-400">Menganalisis…</div>}
        <div ref={akhir} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          kirim(input)
        }}
        className="border-t border-slate-200 p-3"
      >
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={hexTerpilih ? 'Tanya soal heksagon terpilih…' : 'Tanya soal lokasi…'}
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={memuat || !input.trim()}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Kirim
          </button>
        </div>
      </form>
    </div>
  )
}
