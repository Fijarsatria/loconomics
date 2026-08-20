/**
 * Kerangka aplikasi.
 *
 * Tiga bagian yang WAJIB ada menurut ketentuan lomba, semuanya terlihat sekaligus
 * tanpa perlu berpindah halaman:
 *
 *   1. Peta Interaktif    — PetaInteraktif.tsx  (kiri, dominan)
 *   2. Insight / Analisis — PanelInsight.tsx    (kanan atas)
 *   3. Antarmuka AI       — PanelAI.tsx         (kanan bawah)
 *
 * Menaruh ketiganya dalam satu layar bukan sekadar tata letak: AI menggerakkan
 * peta, peta memilih heksagon, heksagon mengisi panel insight. Kalau ketiganya
 * terpisah halaman, rantai itu putus dan demo kehilangan alurnya.
 *
 * App juga pemilik state layer & gaya. Tombol di layar dan perintah AI mengubah
 * state yang sama, jadi tampilan tidak pernah bisa berbeda dari yang dikira AI.
 */

import { useMemo, useRef, useState } from 'react'

import {
  GAYA_BASEMAP,
  KAWASAN_PILOT,
  LABEL_KUADRAN,
  LAYER,
  WARNA_KUADRAN,
  type NamaGaya,
  type NamaLayer,
} from './config'
import PanelAI from './components/PanelAI'
import PanelInsight from './components/PanelInsight'
import PetaInteraktif, {
  type AksiPetaRef,
  type KendaliPeta,
} from './components/PetaInteraktif'

function Legenda({ layer }: { layer: NamaLayer }) {
  // Tiap layer punya legendanya sendiri. Legenda kuadran yang dipasang di layer
  // PriceLens hanya akan menyesatkan.
  const isi =
    layer === 'opportunity' ? (
      Object.entries(LABEL_KUADRAN).map(([kunci, label]) => (
        <li key={kunci} className="flex items-center gap-2 text-xs text-slate-700">
          <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: WARNA_KUADRAN[kunci] }} />
          {label}
        </li>
      ))
    ) : layer === 'zoneguard' ? (
      [
        ['#10b981', 'Zona mengizinkan usaha'],
        ['#ef4444', 'Zona melarang — skor dinolkan'],
        ['#f59e0b', 'Tanpa RDTR digital — belum pasti'],
      ].map(([warna, label]) => (
        <li key={label} className="flex items-center gap-2 text-xs text-slate-700">
          <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: warna }} />
          {label}
        </li>
      ))
    ) : (
      <li className="text-xs text-slate-600">
        {LAYER[layer].keterangan}. Abu-abu = tidak memenuhi kriteria layer ini.
      </li>
    )

  return (
    <div className="absolute bottom-6 left-3 z-10 max-w-[13rem] rounded-lg bg-white/95 p-3 shadow-lg backdrop-blur">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {LAYER[layer].nama}
      </p>
      <ul className="space-y-1">{isi}</ul>
      <p className="mt-2 border-t border-slate-200 pt-1.5 text-[10px] leading-snug text-slate-500">
        Warna pudar = hasil imputasi model, belum disurvei langsung.
      </p>
    </div>
  )
}

export default function App() {
  const [kawasan, setKawasan] = useState(KAWASAN_PILOT[0].nama)
  const [layer, setLayer] = useState<NamaLayer>('opportunity')
  const [gaya, setGaya] = useState<NamaGaya>('dasar')
  const [hexTerpilih, setHexTerpilih] = useState<string | null>(null)
  const peta = useRef<AksiPetaRef>(null)

  /**
   * Satu objek kendali untuk AI Consultant: tiga aksi kamera dari peta, dua
   * penukar tampilan dari state di sini.
   */
  const kendali = useMemo<KendaliPeta>(
    () => ({
      flyTo: (lat, lon, zoom) => peta.current?.flyTo(lat, lon, zoom),
      highlight: (ids) => peta.current?.highlight(ids),
      filter: (kriteria) => peta.current?.filter(kriteria),
      setLayer,
      setGaya,
    }),
    [],
  )

  return (
    <div className="flex h-full flex-col bg-slate-50">
      {/* --- Bilah atas --- */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-base font-semibold text-slate-900">Loconomics</h1>
          <span className="hidden text-xs text-slate-500 sm:inline">
            Transit-oriented Retail Recommender
          </span>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={kawasan}
            onChange={(e) => {
              setKawasan(e.target.value)
              setHexTerpilih(null)
              const k = KAWASAN_PILOT.find((x) => x.nama === e.target.value)
              if (k) kendali.flyTo(k.pusat[1], k.pusat[0], 14)
            }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500"
          >
            {KAWASAN_PILOT.map((k) => (
              <option key={k.nama} value={k.nama}>
                {k.nama} · {k.moda}
              </option>
            ))}
          </select>

          <select
            value={layer}
            onChange={(e) => setLayer(e.target.value as NamaLayer)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500"
          >
            {Object.entries(LAYER).map(([kunci, l]) => (
              <option key={kunci} value={kunci}>
                {l.nama}
              </option>
            ))}
          </select>

          {/* Basemap MAPID — lima gaya. Ketentuan A.3: tidak boleh sumber tile lain. */}
          <select
            value={gaya}
            onChange={(e) => setGaya(e.target.value as NamaGaya)}
            title="Basemap MAPID Maps"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500"
          >
            {Object.keys(GAYA_BASEMAP).map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* --- Badan: peta + dua panel --- */}
      <main className="flex min-h-0 flex-1">
        <section className="relative min-w-0 flex-1">
          <PetaInteraktif
            ref={peta}
            kawasan={kawasan}
            layer={layer}
            gaya={gaya}
            onPilihHeksagon={setHexTerpilih}
          />
          <Legenda layer={layer} />
        </section>

        <aside className="flex w-[26rem] shrink-0 flex-col border-l border-slate-200 bg-white">
          <div className="min-h-0 flex-1 overflow-hidden border-b border-slate-200">
            <PanelInsight h3={hexTerpilih} />
          </div>
          <div className="h-[22rem] shrink-0">
            <PanelAI kendali={kendali} hexTerpilih={hexTerpilih} />
          </div>
        </aside>
      </main>
    </div>
  )
}
