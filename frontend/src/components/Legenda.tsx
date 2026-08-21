/**
 * Legenda yang menempati slot yang sama dengan Kompas Kuadran.
 *
 * Kompas hanya benar untuk layer yang diwarnai menurut kuadran. Saat peta
 * menampilkan harga atau zonasi, warnanya tidak lagi berarti kuadran, dan
 * membiarkan Kompas di sana akan membuatnya berbohong.
 *
 * Jadi slotnya bertukar isi, bukan bertambah. Tempat, ukuran, dan bingkainya
 * tetap sama supaya mata tidak perlu mencari ulang setiap kali layer berganti.
 */

import { ABU_HINDARI } from '../config'
import type { NamaLayer } from '../config'

function Kunci({
  warna,
  arsir,
  garis,
  label,
  catatan,
}: {
  warna?: string
  arsir?: boolean
  garis?: boolean
  label: string
  catatan?: string
}) {
  return (
    <li className="flex items-start gap-2">
      <span
        aria-hidden
        className={`mt-[3px] h-3 w-3 shrink-0 rounded-[2px] ${arsir ? 'arsir text-ink' : ''}`}
        style={{
          background: warna ?? 'transparent',
          boxShadow: garis || !warna ? `inset 0 0 0 1.5px ${ABU_HINDARI}` : undefined,
        }}
      />
      <span className="text-[10.5px] leading-snug">
        <span className="font-medium text-ink">{label}</span>
        {catatan && <span className="block text-ink-3">{catatan}</span>}
      </span>
    </li>
  )
}

export default function Legenda({ layer }: { layer: NamaLayer }) {
  if (layer === 'pricelens')
    return (
      <Bingkai judul="PriceLens — sewa per m²">
        <div
          className="mb-1.5 h-2.5 rounded-xs"
          style={{ background: 'linear-gradient(90deg,#e4ece9,#7ea79c,#2c4f45)' }}
          aria-hidden
        />
        <div className="mb-2 flex justify-between text-[9.5px] text-ink-3">
          <span>murah</span>
          <span>mahal</span>
        </div>
        <ul className="space-y-1.5">
          <Kunci warna={ABU_HINDARI} label="Belum ada data harga" catatan="bukan berarti murah" />
          <Kunci arsir label="Nilai hasil imputasi model" catatan="bukan survei langsung" />
        </ul>
      </Bingkai>
    )

  return (
    <Bingkai judul="ZoneGuard — status izin">
      <ul className="space-y-1.5">
        <Kunci warna="#8fbfb2" label="Zona mengizinkan usaha" />
        <Kunci warna="#b42318" label="Zona melarang usaha" catatan="skor dinolkan, tidak pernah direkomendasikan" />
        <Kunci warna={ABU_HINDARI} label="Belum ada RDTR digital" catatan="belum bisa dipastikan, bukan larangan" />
        <Kunci arsir label="Nilai hasil imputasi model" />
      </ul>
    </Bingkai>
  )
}

function Bingkai({ judul, children }: { judul: string; children: React.ReactNode }) {
  return (
    <div className="w-[15rem] rounded-md border border-line bg-surface/95 p-2.5 shadow-[0_2px_10px_rgb(22_33_28/0.10)] backdrop-blur-sm">
      <h3 className="eyebrow mb-2">{judul}</h3>
      {children}
    </div>
  )
}
