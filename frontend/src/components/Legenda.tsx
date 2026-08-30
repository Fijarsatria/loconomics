/**
 * Legenda yang menempati slot yang sama dengan Kompas Kuadran.
 *
 * Kompas hanya benar untuk layer yang diwarnai menurut kuadran. Saat peta
 * menampilkan harga atau zonasi, warnanya tidak lagi berarti kuadran, dan
 * membiarkan Kompas di sana akan membuatnya berbohong.
 *
 * Jadi slotnya bertukar isi, bukan bertambah. Tempat, ukuran, dan bingkainya
 * tetap sama supaya mata tidak perlu mencari ulang setiap kali layer berganti.
 *
 * Versi pertama legenda ini hanya menamai warna: "murah", "mahal", "zona
 * mengizinkan usaha". Itu menjawab "warna ini artinya apa" tapi tidak menjawab
 * satu pun pertanyaan yang sebenarnya dibawa pengguna ke layar ini — murah itu
 * berapa, dan dari berapa banyak heksagon angka itu berasal. Sekarang ia
 * membawa angka kawasan yang sedang dilihat: kuartil sewa yang sesungguhnya,
 * jumlah heksagon per status zona, dan seberapa luas datanya benar-benar ada.
 *
 * Cakupan ditampilkan justru karena ia sering rendah. Legenda yang menyembunyikan
 * bahwa separuh kawasan belum tersurvei membuat gradasi warnanya terbaca lebih
 * berwibawa daripada yang pantas ia terima.
 */

import { useEffect, useState } from 'react'

import { ABU_HINDARI, SEMUA_KAWASAN, labelKawasan } from '../config'
import type { NamaLayer } from '../config'
import { api } from '../lib/api'
import { CHURN_STOP } from '../lib/layer-peta'
import { rupiah } from '../lib/format'

interface RingkasanHarga {
  kawasan: string
  total_heksagon: number
  sewa_per_m2: { p25: number | null; p50: number | null; p75: number | null; n_sampel: number }
  cakupan_harga: number | null
}

interface RingkasanZona {
  kawasan: string
  total: number
  diizinkan: number
  dilarang: number
  tidak_diketahui: number
  cakupan_rdtr: number | null
}

function Kunci({
  warna,
  arsir,
  garis,
  label,
  catatan,
  jumlah,
}: {
  warna?: string
  arsir?: boolean
  garis?: boolean
  label: string
  catatan?: string
  jumlah?: number
}) {
  return (
    <li className="flex items-start gap-2">
      <span
        aria-hidden
        className={`mt-[3px] h-3 w-3 shrink-0 rounded-[3px] ${arsir ? 'arsir text-ink' : ''}`}
        style={{
          background: warna ?? 'transparent',
          boxShadow: garis || !warna ? `inset 0 0 0 1.5px ${ABU_HINDARI}` : undefined,
        }}
      />
      <span className="min-w-0 flex-1 text-[12.5px] leading-snug">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 font-medium text-ink">{label}</span>
          {jumlah !== undefined && (
            <span className="tabular shrink-0 text-[12px] font-semibold text-ink-2">{jumlah}</span>
          )}
        </span>
        {catatan && <span className="block text-ink-3">{catatan}</span>}
      </span>
    </li>
  )
}

/** Sebatang bar cakupan. Angka telanjang "0,62" tidak terbaca sebagai sebagian. */
function Cakupan({ nilai, label }: { nilai: number | null; label: string }) {
  if (nilai === null || nilai === undefined) return null
  const persen = Math.round(nilai * 100)
  return (
    <div className="mt-2.5 border-t border-line/70 pt-2.5">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11.5px]">
        <span className="text-ink-3">{label}</span>
        <span className="tabular font-semibold text-ink-2">{persen}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ground-2" aria-hidden>
        <div
          className="h-full rounded-full bg-ink-3 transition-[width] duration-700 ease-liquid"
          style={{ width: `${persen}%` }}
        />
      </div>
    </div>
  )
}

export default function Legenda({ layer, kawasan }: { layer: NamaLayer; kawasan: string }) {
  const [semuaHarga, setSemuaHarga] = useState<RingkasanHarga[] | null>(null)
  const [semuaZona, setSemuaZona] = useState<RingkasanZona[] | null>(null)
  /**
   * Dibedakan dari `harga === null` dengan sengaja.
   *
   * `/pricelens/ringkasan` memakan 3,5 detik pada mesin uji. Tanpa penanda ini
   * legenda menulis "belum ada sampel" selama tiga setengah detik itu - dan itu
   * bukan sekadar tampilan yang kurang, itu pernyataan yang salah. "Belum
   * selesai dimuat" dan "memang tidak ada datanya" adalah dua hal berbeda,
   * persis seperti aturan 4 repo ini soal nol dan kosong.
   *
   * Tidak pernah di-set ulang di dalam efek - App memasang `key={kawasan}`, jadi
   * ganti kawasan berarti komponen ini dipasang ulang dan nilai awalnya kembali
   * true dengan sendirinya. Menyetel state di dalam efek untuk hal yang bisa
   * diurus nilai awal selalu menambah satu render tanpa menambah apa pun.
   */
  const [memuat, setMemuat] = useState(true)

  // Keduanya ringkasan seluruh kawasan pilot dalam satu respons kecil, jadi
  // yang disaring di sini kawasannya — bukan permintaannya. Meminta ulang tiap
  // ganti kawasan hanya menambah bolak-balik tanpa menambah satu pun angka.
  useEffect(() => {
    let batal = false
    Promise.allSettled([api.ringkasanHarga(), api.cakupanZona()]).then(([h, z]) => {
      if (batal) return
      setMemuat(false)
      setSemuaHarga(h.status === 'fulfilled' ? (h.value as unknown as RingkasanHarga[]) : null)
      setSemuaZona(z.status === 'fulfilled' ? (z.value as unknown as RingkasanZona[]) : null)
    })
    return () => {
      batal = true
    }
  }, [kawasan])

  /**
   * Baris yang sedang disaring. `null` berarti tidak ada saringan sama sekali.
   *
   * Versi sebelumnya memakai `.find(r => r.kawasan === kawasan)`, dan itu tidak
   * pernah cocok untuk DUA keadaan yang justru paling sering muncul: tampilan
   * bawaan ("semua kawasan", nilainya string kosong) dan saringan multi-kawasan
   * ("Bekasi,Depok Baru"). Akibatnya legenda menulis "belum ada sampel" di atas
   * peta yang penuh angka - pernyataan yang salah, bukan sekadar kosong.
   */
  const dipilih =
    kawasan === SEMUA_KAWASAN ? null : new Set(kawasan.split(',').filter(Boolean))
  const saring = <T extends { kawasan: string }>(b: T[] | null): T[] =>
    !b ? [] : dipilih ? b.filter((r) => dipilih.has(r.kawasan)) : b

  const barisHarga = saring(semuaHarga)
  const barisZona = saring(semuaZona)

  /**
   * Kuartil hanya ditampilkan untuk SATU kawasan.
   *
   * Median dari beberapa median bukan median, dan menampilkannya seolah begitu
   * akan mengarang angka - persis yang dilarang aturan 4 repo ini. Cakupan
   * datanya lain soal: ia rasio dua hitungan, dan hitungan boleh dijumlah.
   */
  const harga = barisHarga.length === 1 ? barisHarga[0] : null

  const totalHex = barisHarga.reduce((a, r) => a + (r.total_heksagon || 0), 0)
  const berharga = barisHarga.reduce((a, r) => a + (r.sewa_per_m2?.n_sampel || 0), 0)
  const cakupanHarga = totalHex ? berharga / totalHex : null

  // Zona: seluruhnya hitungan, jadi menjumlahkannya sah untuk berapa pun
  // kawasan yang sedang dipilih.
  const zona = barisZona.length
    ? barisZona.reduce(
        (a, r) => ({
          kawasan,
          total: a.total + (r.total || 0),
          diizinkan: a.diizinkan + (r.diizinkan || 0),
          dilarang: a.dilarang + (r.dilarang || 0),
          tidak_diketahui: a.tidak_diketahui + (r.tidak_diketahui || 0),
          cakupan_rdtr: null,
        }),
        { kawasan, total: 0, diizinkan: 0, dilarang: 0, tidak_diketahui: 0, cakupan_rdtr: null } as RingkasanZona,
      )
    : null
  const cakupanRdtr =
    zona && zona.total ? (zona.total - zona.tidak_diketahui) / zona.total : null

  if (layer === 'risk_radar') {
    return (
      <Bingkai judul="RiskRadar — pergantian usaha" kawasan={labelKawasan(kawasan)}>
        {/* Gradasinya dibangun dari CHURN_STOP, tabel yang sama yang mewarnai
            petanya. Hex harfiah, bukan var(--q-*): yang harus dicocokkan mata
            adalah warna di KANVAS, dan kanvas WebGL memang memakai hex. */}
        <div
          className="h-2.5 rounded-full"
          style={{
            background: `linear-gradient(90deg,${CHURN_STOP.map((s) => s.warna).join(',')})`,
          }}
          aria-hidden
        />
        <div className="mt-1.5 flex items-baseline justify-between gap-1 text-[11px]">
          {CHURN_STOP.map((s) => (
            <span key={s.nilai} className="tabular text-ink-3">
              {s.nilai.toFixed(2).replace('.', ',')}
            </span>
          ))}
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-ink-3">
          indeks churn — seberapa sering usaha di sini datang lalu pergi
        </p>

        <ul className="mt-2.5 space-y-1.5 border-t border-line/70 pt-2.5">
          <Kunci
            warna={ABU_HINDARI}
            label="Belum ada data churn"
            catatan="bukan berarti stabil"
          />
          <Kunci arsir label="Belum disurvei langsung" catatan="angkanya dari sumber terukur, bukan tebakan" />
        </ul>

        {/* Kenapa gradasi ini TIDAK memakai label WASPADA/BAHAYA: ambangnya
            persentil 75 dan 90 DALAM KAWASAN MASING-MASING, dan satu ekspresi
            peta tidak bisa membawa enam ambang sekaligus. Mengecatnya seolah
            ambangnya seragam akan menyalahkan kawasan yang dasarnya memang
            tinggi. Penilaian ambangnya muncul di panel detail, tempat
            kawasannya sudah diketahui. */}
        <p className="mt-2.5 border-t border-line/70 pt-2.5 text-[11px] leading-snug text-ink-3">
          Peringatan <strong className="font-semibold text-ink-2">Waspada</strong> dan{' '}
          <strong className="font-semibold text-ink-2">Bahaya</strong> dibandingkan dengan
          kawasannya sendiri — seperempat teratas dan sepersepuluh teratas. Keduanya
          muncul saat satu heksagon dibuka, bukan dari gradasi ini.
        </p>
      </Bingkai>
    )
  }

  if (layer === 'pricelens') {
    const s = harga?.sewa_per_m2
    return (
      <Bingkai judul="PriceLens — sewa per m²" kawasan={labelKawasan(kawasan)}>
        <div
          className="h-2.5 rounded-full"
          style={{ background: 'linear-gradient(90deg,#e4ece9,#7ea79c,#2c4f45)' }}
          aria-hidden
        />
        {/* Tiga kuartil, bukan dua ujung. "Murah–mahal" saja membuat orang
            menebak di mana tengahnya; p50 yang ditulis apa adanya menghapus
            tebakan itu. Kalau angkanya belum ada, yang tampil tetap kata-kata —
            tidak pernah nol. */}
        {s?.p50 != null ? (
          <div className="mt-1.5 flex items-baseline justify-between gap-1 text-[11px]">
            <span className="tabular text-ink-3">{rupiah(s.p25)}</span>
            <span className="tabular font-semibold text-ink">{rupiah(s.p50)}</span>
            <span className="tabular text-ink-3">{rupiah(s.p75)}</span>
          </div>
        ) : (
          <div className="mt-1.5 flex justify-between text-[11.5px] text-ink-3">
            <span>murah</span>
            <span>mahal</span>
          </div>
        )}
        <p className="mt-0.5 text-[11px] leading-snug text-ink-3">
          harga per m² ·{' '}
          {memuat ? (
            <span className="text-ink-3">
              <span className="denyut mr-1 inline-block h-1 w-1 rounded-full bg-ink-3 align-middle" />
              memuat angka kawasan
            </span>
          ) : s?.n_sampel ? (
            `${s.n_sampel} heksagon bersampel`
          ) : barisHarga.length > 1 ? (
            // Bukan "belum ada sampel": sampelnya ada, cuma kuartil gabungan
            // beberapa kawasan tidak punya arti. Katakan yang sebenarnya.
            'pilih satu kawasan untuk melihat rentang harganya'
          ) : (
            'belum ada sampel'
          )}
        </p>

        <ul className="mt-2.5 space-y-1.5 border-t border-line/70 pt-2.5">
          <Kunci warna={ABU_HINDARI} label="Belum ada data harga" catatan="bukan berarti murah" />
          <Kunci arsir label="Belum disurvei langsung" catatan="angkanya dari sumber terukur, bukan tebakan" />
        </ul>
        <Cakupan nilai={cakupanHarga} label="Heksagon dengan data harga" />
      </Bingkai>
    )
  }

  return (
    <Bingkai judul="ZoneGuard — status izin" kawasan={labelKawasan(kawasan)}>
      <ul className="space-y-1.5">
        <Kunci warna="#8fbfb2" label="Zona mengizinkan usaha" jumlah={zona?.diizinkan} />
        <Kunci
          warna="#b42318"
          label="Zona melarang usaha"
          catatan="skor dinolkan, tidak pernah direkomendasikan"
          jumlah={zona?.dilarang}
        />
        <Kunci
          warna={ABU_HINDARI}
          label="Belum ada RDTR digital"
          catatan="belum bisa dipastikan, bukan larangan"
          jumlah={zona?.tidak_diketahui}
        />
        <Kunci arsir label="Belum disurvei langsung" catatan="angkanya dari sumber terukur" />
      </ul>
      {memuat && !zona ? (
        <p className="mt-2.5 border-t border-line/70 pt-2.5 text-[11px] text-ink-3">
          <span className="denyut mr-1 inline-block h-1 w-1 rounded-full bg-ink-3 align-middle" />
          memuat angka kawasan
        </p>
      ) : (
        <Cakupan nilai={cakupanRdtr} label="Heksagon dengan RDTR digital" />
      )}
    </Bingkai>
  )
}

/**
 * Bingkainya sengaja sama persis dengan kartu Kompas Kuadran — `kaca`,
 * `rounded-lg`, `pop-naik-kiri`. Keduanya bergantian menempati satu slot, dan
 * bingkai yang berbeda membuat pergantian itu terbaca sebagai panel yang
 * DIGANTI, bukan sebagai isi yang bertukar.
 */
function Bingkai({
  judul,
  kawasan,
  children,
}: {
  judul: string
  kawasan: string
  children: React.ReactNode
}) {
  return (
    <div className="kaca pop-naik-kiri w-[16rem] rounded-lg p-3.5">
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <h3 className="eyebrow min-w-0 truncate">{judul}</h3>
        <span className="shrink-0 text-[11px] text-ink-3">{kawasan}</span>
      </div>
      {children}
    </div>
  )
}
