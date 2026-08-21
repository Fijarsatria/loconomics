/**
 * Kerangka aplikasi.
 *
 * Tiga bagian yang WAJIB ada menurut ketentuan lomba, semuanya terlihat sekaligus
 * tanpa berpindah halaman:
 *
 *   1. Peta Interaktif    — PetaInteraktif.tsx   (kiri, dominan)
 *   2. Insight / Analisis — PanelInsight.tsx     (kanan atas)
 *   3. Antarmuka AI       — PanelAI.tsx          (kanan bawah)
 *
 * Menaruh ketiganya dalam satu layar bukan sekadar tata letak. Rantainya:
 * AI menggerakkan peta, peta memilih heksagon, heksagon mengisi panel insight.
 * Kalau ketiganya terpisah halaman, rantai itu putus dan demo kehilangan alurnya.
 *
 * App memegang state layer, gaya, kawasan, dan filter kuadran. Tombol di layar
 * dan perintah AI mengubah state yang SAMA, jadi tampilan tidak pernah bisa
 * berbeda dari yang dikira asisten.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  GAYA_BASEMAP,
  KAWASAN_PILOT,
  LAYER,
  type NamaGaya,
  type NamaLayer,
} from './config'
import { api } from './lib/api'
import type { DiagramKuadran, Kuadran as NamaKuadran } from './types'
import DaftarLokasi from './components/DaftarLokasi'
import KompasKuadran from './components/KompasKuadran'
import Legenda from './components/Legenda'
import PanelAI from './components/PanelAI'
import PanelInsight from './components/PanelInsight'
import PetaInteraktif, {
  type AksiPetaRef,
  type KendaliPeta,
} from './components/PetaInteraktif'

/** Layer yang diwarnai menurut kuadran — hanya di sini Kompas benar. */
const LAYER_KUADRAN: NamaLayer[] = ['opportunity', 'hidden_gem', 'risk_radar']

function Pilih<T extends string>({
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
  return (
    <label className="flex items-center gap-1.5">
      <span className="eyebrow hidden lg:inline">{label}</span>
      <select
        value={nilai}
        onChange={(e) => onUbah(e.target.value as T)}
        className="cursor-pointer rounded-sm border border-line bg-surface px-2 py-1 text-[12px] font-medium outline-none transition-colors hover:border-line-2"
      >
        {opsi.map((o) => (
          <option key={o.nilai} value={o.nilai}>
            {o.label}
            {o.catatan ? ` · ${o.catatan}` : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

export default function App() {
  const [kawasan, setKawasan] = useState(KAWASAN_PILOT[0].nama)
  const [layer, setLayer] = useState<NamaLayer>('opportunity')
  const [gaya, setGaya] = useState<NamaGaya>('terang')
  const [hexTerpilih, setHexTerpilih] = useState<string | null>(null)
  const [saringKuadran, setSaringKuadran] = useState<NamaKuadran | null>(null)
  const [nHeksagon, setNHeksagon] = useState<number | null>(null)
  const [kuadranPenuh, setKuadranPenuh] = useState(false)
  // Daftar dulu, detail belakangan. Pertanyaan pertama pengguna adalah "yang mana
  // yang harus saya lihat", bukan "bagaimana lokasi ini" - dan layar kosong yang
  // menyuruh mengklik heksagon menjawab pertanyaan yang belum diajukan.
  const [tab, setTab] = useState<'daftar' | 'detail'>('daftar')
  const [aiTerbuka, setAiTerbuka] = useState(true)
  const [diagram, setDiagram] = useState<DiagramKuadran | null>(null)
  const peta = useRef<AksiPetaRef>(null)

  const kendali = useMemo<KendaliPeta>(
    () => ({
      flyTo: (lat, lon, zoom) => peta.current?.flyTo(lat, lon, zoom),
      highlight: (ids) => {
        peta.current?.highlight(ids)
        if (ids.length === 1) setHexTerpilih(ids[0])
      },
      filter: (kriteria) => peta.current?.filter(kriteria),
      setLayer,
      setGaya,
    }),
    [],
  )

  const pilihHeksagon = useCallback((h3: string | null) => {
    setHexTerpilih(h3)
    if (h3) setTab('detail')
  }, [])
  const catatMuat = useCallback((n: number) => setNHeksagon(n), [])

  // Titik kuadran diminta sekali per kawasan, bukan saat diagram penuh dibuka.
  //
  // Percobaan pertama menundanya sampai modal dibuka, dan itu salah: Kompas kecil
  // memakai data yang sama untuk menaruh titik heksagon terpilih, jadi titiknya
  // tidak pernah muncul sampai seseorang kebetulan membuka diagram penuh dulu.
  // Satu permintaan per kawasan, dipakai dua tempat, dan backend sudah men-cache-nya.
  useEffect(() => {
    let batal = false
    setDiagram(null)
    api
      .diagramKuadran({ kawasan, limit: 2000 })
      .then((d) => !batal && setDiagram(d))
      .catch(() => !batal && setDiagram(null))
    return () => {
      batal = true
    }
  }, [kawasan])

  // Posisi heksagon terpilih di dalam Kompas kecil.
  const posisi = useMemo(() => {
    const t = diagram?.titik.find((x) => x.h3_index === hexTerpilih)
    return t ? { x: t.x_prestise, y: t.y_peluang, kuadran: t.kuadran } : null
  }, [diagram, hexTerpilih])

  const pakaiKompas = LAYER_KUADRAN.includes(layer)

  return (
    <div className="flex h-full flex-col">
      {/* --- Bilah atas ---------------------------------------------------- */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-2">
        <div className="flex items-baseline gap-2">
          <h1 className="papan text-[15px] leading-none tracking-tight">Loconomics</h1>
          <span className="hidden text-[11px] text-ink-3 sm:inline">
            Cari lokasi usaha di sekitar transit
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
          <Pilih
            label="Kawasan"
            nilai={kawasan}
            opsi={KAWASAN_PILOT.map((k) => ({
              nilai: k.nama,
              label: k.nama,
              catatan: k.moda,
            }))}
            onUbah={(v) => {
              setKawasan(v)
              setHexTerpilih(null)
              setNHeksagon(null)
              setTab('daftar')
              const k = KAWASAN_PILOT.find((x) => x.nama === v)
              if (k) kendali.flyTo(k.pusat[1], k.pusat[0], 14)
            }}
          />

          <Pilih
            label="Layer"
            nilai={layer}
            opsi={Object.entries(LAYER).map(([k, l]) => ({
              nilai: k as NamaLayer,
              label: l.nama,
            }))}
            onUbah={setLayer}
          />

          <Pilih
            label="Basemap"
            nilai={gaya}
            opsi={Object.entries(GAYA_BASEMAP).map(([k, g]) => ({
              nilai: k as NamaGaya,
              label: g.label,
            }))}
            onUbah={setGaya}
          />
        </div>
      </header>

      {/* Pertanyaan yang dijawab layer aktif. Satu baris, ganti tiap layer —
          menjelaskan gunanya layer tanpa perlu tooltip yang harus dicari. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-4 py-1.5">
        <span className="text-[11.5px] text-ink-2">{LAYER[layer].pertanyaan}</span>
        {nHeksagon !== null && (
          <span className="tabular ml-auto text-[10.5px] text-ink-3">
            {nHeksagon.toLocaleString('id-ID')} heksagon di {kawasan}
          </span>
        )}
      </div>

      {/* --- Badan ---------------------------------------------------------
          Di bawah 1024px, peta dan panel ditumpuk alih-alih berdampingan.
          Panel selebar 25rem di layar 900px menyisakan peta yang terlalu sempit
          untuk membandingkan heksagon - dan membandingkan heksagon adalah
          seluruh gunanya peta ini. */}
      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="relative min-h-[45vh] min-w-0 flex-1 lg:min-h-0">
          <PetaInteraktif
            ref={peta}
            kawasan={kawasan}
            layer={layer}
            gaya={gaya}
            terpilih={hexTerpilih}
            saringKuadran={saringKuadran}
            onPilihHeksagon={pilihHeksagon}
            onMuat={catatMuat}
          />

          {/* Slot legenda: isinya bertukar, tempatnya tidak. */}
          <div className="absolute bottom-6 left-3 z-10 hidden sm:block">
            {pakaiKompas ? (
              <KompasKuadran
                saring={saringKuadran}
                onSaring={setSaringKuadran}
                posisi={posisi}
                onBukaPenuh={() => setKuadranPenuh(true)}
              />
            ) : (
              <Legenda layer={layer} />
            )}
          </div>


          {nHeksagon === 0 && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
              <div className="pointer-events-auto max-w-sm rounded-md border border-line bg-surface p-5 shadow-[0_4px_24px_rgb(22_33_28/0.12)]">
                <p className="papan text-[15px]">Belum ada heksagon di {kawasan}</p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">
                  Basis datanya sudah tersambung, tetapi kawasan ini belum berisi.
                  Jalankan pipeline sampai tahap terbit untuk mengisinya.
                </p>
                <code className="mt-2.5 block rounded-sm bg-surface-2 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-ink-2">
                  cd pipeline
                  <br />
                  python s7_publish.py --muat
                </code>
              </div>
            </div>
          )}
        </section>

        {/* --- Panel kanan ------------------------------------------------- */}
        <aside className="flex h-[26rem] shrink-0 flex-col border-t border-line bg-surface lg:h-auto lg:w-[22rem] lg:border-l lg:border-t-0 xl:w-[25rem]">
          <div className="flex shrink-0 border-b border-line">
            {(
              [
                ['daftar', 'Daftar lokasi'],
                ['detail', hexTerpilih ? 'Detail heksagon' : 'Detail'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                aria-current={tab === k ? 'page' : undefined}
                disabled={k === 'detail' && !hexTerpilih}
                className={`flex-1 cursor-pointer border-b-2 px-3 py-2 text-[11.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  tab === k
                    ? 'border-ink text-ink'
                    : 'border-transparent text-ink-3 hover:text-ink-2'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {tab === 'daftar' ? (
              <DaftarLokasi
                layer={layer}
                kawasan={kawasan}
                terpilih={hexTerpilih}
                onPilih={(h3) => {
                  setHexTerpilih(h3)
                  setTab('detail')
                  const t = diagram?.titik.find((x) => x.h3_index === h3)
                  if (t) peta.current?.highlight([h3])
                }}
              />
            ) : (
              <PanelInsight h3={hexTerpilih} onBukaKuadran={() => setKuadranPenuh(true)} />
            )}
          </div>
          <div
            className={`shrink-0 border-t border-line ${
              aiTerbuka ? 'h-[13rem] lg:h-[17rem]' : 'h-auto'
            }`}
          >
            <PanelAI
              kendali={kendali}
              hexTerpilih={hexTerpilih}
              terbuka={aiTerbuka}
              onLipat={() => setAiTerbuka((v) => !v)}
            />
          </div>
        </aside>
      </main>

      {/* --- Diagram kuadran penuh ----------------------------------------- */}
      {kuadranPenuh && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-6 backdrop-blur-[2px]"
          onClick={() => setKuadranPenuh(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Diagram kuadran"
        >
          <div
            className="masuk max-h-full w-[34rem] max-w-full overflow-auto rounded-md bg-surface shadow-[0_8px_40px_rgb(22_33_28/0.25)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-baseline justify-between gap-6 border-b border-line px-4 py-3">
              <div>
                <h2 className="papan text-[15px]">Diagram kuadran · {kawasan}</h2>
                <p className="mt-0.5 max-w-[42ch] text-[11.5px] leading-snug text-ink-2">
                  Sumbu datar: bagaimana lokasi terlihat. Sumbu tegak: apa kata
                  datanya. Gunanya produk ini ada di dua sudut tempat keduanya
                  tidak sejalan.
                </p>
              </div>
              <button
                onClick={() => setKuadranPenuh(false)}
                className="cursor-pointer rounded-sm border border-line px-2.5 py-1 text-[12px] font-medium transition-colors hover:bg-surface-2"
              >
                Tutup
              </button>
            </div>

            <div className="p-4">
              <KompasKuadran
                besar
                saring={saringKuadran}
                onSaring={setSaringKuadran}
                sebar={diagram?.titik}
                batas={diagram ? { x: diagram.batas_x, y: diagram.batas_y } : undefined}
                onPilih={(h3) => {
                  setHexTerpilih(h3)
                  setKuadranPenuh(false)
                }}
              />
              <p className="mt-3 max-w-[22rem] text-[11px] leading-snug text-ink-3">
                {diagram
                  ? `${diagram.titik.length.toLocaleString('id-ID')} heksagon. Klik satu titik untuk membukanya. Area berzona terlarang sengaja ikut ditampilkan — ini alat analisis, bukan rekomendasi.`
                  : 'Memuat titik…'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
