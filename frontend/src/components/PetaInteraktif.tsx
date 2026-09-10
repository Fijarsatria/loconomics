/**
 * Bagian wajib 1 dari 3: Peta Interaktif.
 *
 * Dua keputusan visual yang perlu dipahami sebelum mengubah berkas ini.
 *
 * PERTAMA — arsir berarti "kami belum tahu". Heksagon yang nilainya hasil
 * imputasi model digambar dengan pola arsir di atas isiannya, bukan sekadar
 * dibuat lebih pudar. Pudar terbaca sebagai "kurang penting"; arsir terbaca
 * sebagai "jenisnya berbeda", dan itu yang benar. Aturan proyek menuntut
 * pengguna bisa membedakan yang disurvei dari yang ditebak model tanpa mengklik.
 *
 * KEDUA — HINDARI tidak punya warna. Validator palet membuktikan abu-abu tidak
 * bisa jadi warna kategorikal, dan itu justru petunjuk: kuadran itu memang
 * berarti tidak ada apa-apa di sini. Ia digambar hanya sebagai garis.
 *
 * Aksi peta (flyTo, highlight, filter) dieksekusi DI SINI, bukan di backend.
 * Kalau flyTo jalan di server, tidak ada yang bergerak di layar pengguna — dan
 * ketentuan C.2 justru meminta keluaran AI yang benar-benar mendarat di peta.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Map as MapLibreMap,
  AttributionControl,
  Marker,
  ScaleControl,
  type ExpressionSpecification,
  type GeoJSONSource,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

// Aturan pewarnaan tinggal di lib/, bukan di sini - dipakai juga oleh dek kartu
// peta di halaman gerbang. Lihat catatan di berkasnya.
import {
  ANGKA_LAYER,
  BASEMAP_GELAP,
  FONT_ANGKA,
  GARIS_HEX,
  OPASITAS_GARIS,
  OPASITAS_LAYER,
  SELUBUNG,
  TEBAL_GARIS,
  TEKS_HEX,
  WARNA_FOKUS,
  WARNA_RUTE,
  cakupanLayer,
  WARNA_RUTE_ALT,
  WARNA_ISO,
  WARNA_RUTE_BAYANG,
  WARNA_RUTE_TUNGGAL,
  WARNA_LAYER,
  idLabelPertama,
} from '../lib/layer-peta'

import {
  KAWASAN_AWAL,
  KUADRAN,
  ZOOM_AWAL,
  urlGaya,
  type NamaGaya,
  type NamaLayer,
  KERAPATAN_NAMA,
} from '../config'
import { api } from '../lib/api'
import { jarakSingkat } from '../lib/format'
import { profilUntukModa } from '../types'
import type { KonteksSimpul, PropertiHeksagon, RuteJalan, SimpulTransit, ModaTampil } from '../types'
import { useBahasa, useNamaZona, useTeks } from '../lib/bahasa'

const SUMBER = 'heksagon'
const L_ISI = 'hex-isi'
const L_ARSIR = 'hex-arsir'
const L_GARIS = 'hex-garis'
const L_SOROT = 'hex-sorot'
const L_PILIH = 'hex-pilih'
const L_ANGKA = 'hex-angka'
const L_SELUBUNG = 'selubung-basemap'
const POLA = 'arsir-ketidakpastian'
/** Sumber terpisah untuk lencana nomor heksagon pembanding. */
const SUMBER_FOKUS = 'fokus'
const L_NOMOR = 'fokus-nomor'
const L_NOMOR_TEKS = 'fokus-nomor-teks'

/**
 * Rute jalan kaki. Sumber SENDIRI, terpisah dari lencana nomor.
 *
 * Alasannya bukan kerapian: geometri rute ditulis ulang TIAP BINGKAI selama
 * animasi menggambarnya. Kalau lencana ikut di sumber yang sama, ia ikut
 * dikirim ulang enam puluh kali sedetik tanpa satu pun alasan.
 */
/**
 * Kawasan jangkau jalan kaki dari simpul - isochrone 5/10/15 menit.
 *
 * GARIS SAJA, tanpa isian pekat. Isian di sini akan bertumpuk dengan warna
 * heksagon dan mengubah keduanya jadi bubur; yang dibutuhkan cuma BATASNYA -
 * "sejauh mana orang sampai dalam sepuluh menit". Bentuknya sendiri sudah
 * bercerita: kawasan jangkau Manggarai separuh luas kawasan jangkau stasiun
 * lain, karena emplasemen relnya memotong jalan ke segala arah.
 */
const SUMBER_ISO = 'catchment'
const L_ISO_ISI = 'catchment-isi'
const L_ISO_GARIS = 'catchment-garis'
const L_ISO_TEKS = 'catchment-teks'

const SUMBER_RUTE = 'rute'
const L_RUTE_BAYANG = 'rute-bayang'
const L_RUTE_ALT = 'rute-alt'
const L_RUTE = 'rute-utama'
const L_RUTE_TEKS = 'rute-teks'
/** Pin titik awal (pusat heksagon) dan tujuan (simpul). */
const L_UJUNG = 'rute-ujung'

/**
 * Berapa kali peta mencoba memuat ulang basemap sendiri saat ubin MAPID
 * menolak, berjarak semenit. Pemadaman terukur pulih dalam belasan menit
 * (sekali 11 menit), jadi sepuluh percobaan menutupi rentang itu.
 */
const PERCOBAAN_UBIN = 10

/** Lama animasi rute menggambar dirinya, milidetik. */
const GAMBAR_MS = 950
/** Jeda tiap rute berikutnya berangkat. Berundak, bukan serempak. */
const UNDAK_MS = 130

/**
 * Panjang kumulatif tiap simpul sebuah polyline, dalam derajat.
 *
 * Derajat, bukan meter: yang dibutuhkan cuma PERBANDINGAN antar-ruas di satu
 * garis yang sama, dan pada rentang beberapa kilometer di lintang yang sama
 * perbandingan itu tidak berubah kalau satuannya diganti. Menghitung jarak
 * geodetik betulan di sini berarti membayar trigonometri untuk seratus titik
 * setiap bingkai demi angka yang dibagi habis lagi setelahnya.
 */
function panjangKumulatif(k: [number, number][]): number[] {
  const kum = [0]
  for (let i = 1; i < k.length; i++) {
    const dx = k[i][0] - k[i - 1][0]
    const dy = k[i][1] - k[i - 1][1]
    kum.push(kum[i - 1] + Math.hypot(dx, dy))
  }
  return kum
}

/** Titik di sepanjang polyline pada pecahan panjang `t` (0..1). */
function titikPada(k: [number, number][], kum: number[], t: number): [number, number] {
  const total = kum[kum.length - 1]
  if (total <= 0) return k[0]
  const target = total * Math.min(1, Math.max(0, t))
  let i = 1
  while (i < kum.length - 1 && kum[i] < target) i++
  const rentang = kum[i] - kum[i - 1] || 1
  const f = (target - kum[i - 1]) / rentang
  return [k[i - 1][0] + (k[i][0] - k[i - 1][0]) * f, k[i - 1][1] + (k[i][1] - k[i - 1][1]) * f]
}

/**
 * Polyline yang dipotong pada pecahan panjang `t`, dengan ujung diinterpolasi.
 *
 * Diinterpolasi, bukan dipotong di simpul terdekat: rute ORS punya ruas panjang
 * dan ruas pendek berselang-seling, jadi memotong di simpul membuat garisnya
 * tumbuh tersendat - cepat di sepanjang jalan lurus, lalu berhenti lama di
 * tikungan yang simpulnya rapat.
 */
function potongJalur(
  k: [number, number][],
  kum: number[],
  t: number,
): [number, number][] {
  if (t >= 1) return k
  const total = kum[kum.length - 1]
  if (total <= 0 || t <= 0) return [k[0], k[0]]
  const target = total * t
  const keluar: [number, number][] = []
  for (let i = 0; i < k.length; i++) {
    if (kum[i] <= target) keluar.push(k[i])
    else break
  }
  keluar.push(titikPada(k, kum, t))
  // Satu titik bukan garis; MapLibre tidak menggambar apa pun untuk itu.
  return keluar.length >= 2 ? keluar : [k[0], keluar[0]]
}

/**
 * Pola arsir dibuat di kanvas, bukan dimuat sebagai berkas.
 * Satu berkas gambar berarti satu permintaan jaringan lagi yang bisa gagal saat
 * demo, untuk sesuatu yang isinya hanya empat garis miring.
 */
function buatPolaArsir(): ImageData {
  const s = 16 // digambar 2x lalu dipasang dengan pixelRatio 2
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  g.strokeStyle = 'rgba(22,33,28,0.34)'
  g.lineWidth = 2
  for (let i = -s; i < s * 2; i += 7) {
    g.beginPath()
    g.moveTo(i, 0)
    g.lineTo(i + s, s)
    g.stroke()
  }
  return g.getImageData(0, 0, s, s)
}

/**
 * Sejak zoom berapa tiap tingkat penanda tempat mulai digambar.
 *
 * Gaya MAPID menyalakan POI di z14/15/16. Itu PILIHAN TAMPILAN, bukan batas
 * data: `mapidtiles.json` menyatakan lapisan vektor `poi` tersedia sejak
 * **zoom 10**. Jadi menurunkannya tidak mengarang apa pun - ia cuma meminta
 * ubin menggambar yang memang sudah ada di dalamnya.
 *
 * Bertingkat, bukan seragam. Ketiga layer aslinya dibedakan `rank`:
 * poi_z14 memuat rank 1-6 (stasiun, rumah sakit, pasar - yang benar-benar
 * menandai sebuah tempat), poi_z15 rank 7-19, poi_z16 sisanya. Menurunkan
 * ketiganya ke angka yang sama akan menumpahkan ratusan warung dan ATM ke
 * layar yang di-zoom keluar; menurunkannya bertingkat memberi yang penting
 * lebih dulu.
 */
const ZOOM_POI: Record<string, number> = {
  // Rank 1-6 saja yang diturunkan, dan cuma satu setengah tingkat. Percobaan
  // pertama menurunkan ketiganya (12 / 14 / 15,5) dan hasilnya persis yang
  // ditakutkan: di zoom 14 dua tingkat menyala bersamaan, ratusan label
  // memenuhi layar, dan angka heksagon tergusur habis oleh tabrakan simbol.
  // Peta biasa pun tidak menampilkan setiap puskesmas di zoom segitu.
  poi_z14: 12.5,
  // Kedua ini dibiarkan seperti gaya aslinya. Yang diminta "penanda terlihat
  // saat di-zoom keluar", dan yang menandai sebuah tempat adalah rank 1-6 -
  // sisanya justru yang membuat layar penuh.
  poi_z15: 15,
  poi_z16: 16,
  // Penanda transit gaya MAPID tidak punya `minzoom` sama sekali - ia tampil
  // dari zoom nol. Diberi ambang di sini supaya ia ikut bergeser bersama yang
  // lain saat pengguna memilih "Jarang" atau "Rapat"; tanpa entri ini, satu-
  // satunya lapisan penanda yang TIDAK menurut pada setelan justru yang paling
  // banyak muncul di kawasan transit. Ambangnya rendah dengan sengaja: stasiun
  // memang pantas terlihat lebih awal daripada toko.
  poi_transit: 11,
}

/**
 * Tenangkan basemap sebelum data digambar di atasnya.
 *
 * Gaya MAPID menggambar setiap footprint bangunan dan setiap ikon POI. Untuk
 * peta navigasi itu benar; untuk peta analitik ia berebut perhatian dengan hal
 * yang justru ingin dibaca. Yang dilakukan di sini:
 *
 *   1. Selubung putih tipis di atas isian basemap, di bawah heksagon. Jalan dan
 *      bangunan tetap ada sebagai konteks, tetapi berhenti bersaing.
 *   2. Penanda tempat DINYALAKAN dan diturunkan zoomnya. Sempat disembunyikan
 *      seluruhnya dengan alasan "ikon klinik tidak menolong orang mengenali
 *      lokasi" - dan alasan itu keliru. Tanpa penanda, peta berhenti terasa
 *      seperti peta: yang tersisa cuma jalan tanpa nama tempat, dan orang
 *      kehilangan satu-satunya cara mencocokkan heksagon dengan dunia yang ia
 *      kenal. Yang dibutuhkan bukan menghapusnya, melainkan menaruhnya di ATAS
 *      heksagon supaya keduanya bisa dibaca sekaligus.
 */
/**
 * Terapkan pilihan kerapatan nama tempat ke SELURUH layer penanda basemap.
 *
 * Dipanggil dari dua tempat, dan keduanya wajib: sekali saat gayanya baru
 * selesai dimuat (di dalam `siapkanBasemap`), dan sekali lagi tiap pilihannya
 * berubah. Yang pertama saja tidak cukup - pilihannya bisa berganti kapan pun;
 * yang kedua saja juga tidak - `setStyle` mengembalikan seluruh layer ke
 * setelan bawaan gayanya tanpa memberi tahu siapa pun.
 */
/**
 * Layer simbol MANA yang dianggap "nama tempat".
 *
 * Bukan cuma `poi*`, dan itu perbaikan 11 Sep 2026. Setelan ini bernama "Nama
 * tempat" dan dijelaskan sebagai "stasiun, gedung, taman" - tetapi hanya
 * mematikan keluarga `poi*`. Nama kelurahan dan kawasan hidup di keluarga
 * `place*` (`place_other`, `place_suburb`, `place_village`, `place_town`,
 * `place_city`), dan nama perairan di `water_name*`. Jadi mematikan setelannya
 * meninggalkan KEBON MELATI, PETAMBURAN, SLIPI, MENTENG tetap di layar -
 * dilaporkan pemilik repo apa adanya: "kok masih ada tuh ikon ikon lokasi yang
 * lain".
 *
 * NAMA JALAN SENGAJA TIDAK IKUT (`road_label`, `highway_name_*`). Ia satu-
 * satunya hal yang memberitahu pengguna heksagon yang dilihatnya ada di jalan
 * apa, dan permintaan yang sama yang meminta label dimatikan juga meminta
 * "jalanan dan detail detail jangan ketutupan". Mematikan nama jalan bekerja
 * melawan permintaan itu.
 */
const RE_NAMA_TEMPAT = /^(poi|place|water_name)/

function terapkanNamaTempat(m: MapLibreMap, kerapatan: string) {
  const geser = KERAPATAN_NAMA[kerapatan]?.geser ?? 0
  for (const l of m.getStyle().layers ?? []) {
    if (!RE_NAMA_TEMPAT.test(l.id) || l.type !== 'symbol') continue
    if (geser === null) {
      m.setLayoutProperty(l.id, 'visibility', 'none')
      continue
    }
    m.setLayoutProperty(l.id, 'visibility', 'visible')
    const z = ZOOM_POI[l.id]
    if (z !== undefined) {
      // Dijepit ke rentang yang sah MapLibre (0-24). Geseran negatif pada
      // ambang terendah bisa membawanya di bawah nol, dan `setLayerZoomRange`
      // menolaknya dengan galat yang menghentikan seluruh penerapan.
      m.setLayerZoomRange(l.id, Math.max(0, Math.min(23, z + geser)), 24)
    }
  }
}

function siapkanBasemap(m: MapLibreMap, gaya: NamaGaya, kerapatan: string) {
  const layers = m.getStyle().layers ?? []
  const gelap = BASEMAP_GELAP.includes(gaya)

  // Kerapatan penandanya diurus `terapkanNamaTempat` di bawah - satu tempat,
  // supaya pilihan pengguna dan pemuatan gaya tidak pernah berselisih.
  for (const l of layers) {
    if (RE_NAMA_TEMPAT.test(l.id) && l.type === 'symbol') {
      // Halo lebih tebal daripada bawaan gaya. Nama tempat sekarang berdiri di
      // atas isian heksagon yang berwarna, bukan di atas kertas putih.
      m.setPaintProperty(l.id, 'text-halo-width', 1.6)
      m.setPaintProperty(l.id, 'text-halo-blur', 0.3)
    }

    // Label gaya gelap MAPID ditulis untuk latar hitam pekat: rgb(101,101,101)
    // dengan halo hitam. Begitu ada selubung apa pun di atasnya, kontrasnya
    // habis. Di satelit lebih parah - tidak ada halo yang cukup melawan citra.
    //
    // Menulis ulang warna label BUKAN pelanggaran "basemap hanya MAPID": ubin
    // vektornya tetap milik MAPID, yang diganti cuma cara menggambarnya. Kalau
    // dibiarkan, nama jalan dan nama tempat hilang - dan itulah satu-satunya
    // cara pengguna tahu heksagon yang dilihatnya ada di mana.
    if (gelap && l.type === 'symbol') {
      m.setPaintProperty(l.id, 'text-color', '#e6edea')
      m.setPaintProperty(l.id, 'text-halo-color', 'rgba(4, 10, 8, 0.92)')
      m.setPaintProperty(l.id, 'text-halo-width', 1.5)
      m.setPaintProperty(l.id, 'text-halo-blur', 0.4)
    }
  }

  const selubung = SELUBUNG[gaya]
  if (m.getLayer(L_SELUBUNG)) m.removeLayer(L_SELUBUNG)
  m.addLayer(
    {
      id: L_SELUBUNG,
      type: 'background',
      paint: {
        'background-color': selubung.warna,
        'background-opacity': selubung.opasitas,
      },
    },
    idLabelPertama(m),
  )

  terapkanNamaTempat(m, kerapatan)
}

// ---------------------------------------------------------------------------
// Animasi kemunculan heksagon
// ---------------------------------------------------------------------------

/**
 * Heksagon mekar dari tengah kawasan ke tepi, bukan muncul serentak.
 *
 * Caranya bukan animasi CSS - heksagon digambar di kanvas WebGL, jadi tidak ada
 * elemen DOM yang bisa dianimasikan. Yang dipakai: setiap fitur diberi properti
 * `_u`, jaraknya dari pusat kawasan yang dinormalkan ke 0..1, lalu opasitas
 * seluruh layer dinyatakan sebagai ekspresi yang membandingkan `_u` dengan satu
 * angka `t` yang dinaikkan per bingkai.
 *
 *   gerbang(t) = 1 kalau _u <= t - 0,22 ; 0 kalau _u >= t ; landai di antaranya
 *
 * Jadi t yang bergerak 0 → 1,22 adalah gelombang yang menyapu dari pusat ke
 * tepi. Membalik arahnya memberi animasi keluar tanpa kode kedua.
 *
 * Opasitas dasar tiap layer TIDAK ditulis ulang - ia dikalikan. Dengan begitu
 * ekspresi per-kuadran yang sudah ada (HINDARI lebih pudar, tanpa data lebih
 * pudar) tetap berlaku selama animasi.
 */
/**
 * Menunggu peta berhenti sibuk sebelum gelombang diberangkatkan.
 *
 * Inilah sebab keluhan "heksagonnya tiba-tiba muncul, tanpa animasi". Gelombang
 * digerakkan requestAnimationFrame, dan tiap bingkainya memanggil
 * setPaintProperty - keduanya berebut main thread dengan MapLibre yang sedang
 * membangun gaya baru dan mengunduh ubin. Yang menang MapLibre. Gelombangnya
 * tetap berjalan, tapi hanya dapat dua atau tiga bingkai, jadi yang terlihat
 * cuma heksagon yang berkedip jadi ada.
 *
 * Menundanya sampai peta tenang membuatnya terlambat beberapa ratus milidetik
 * dan MULUS - jauh lebih baik daripada tepat waktu dan tidak terlihat.
 *
 * Batas waktunya wajib: `idle` tidak pernah menyala kalau ada satu ubin yang
 * gagal diunduh, dan animasi yang menunggu selamanya sama saja dengan animasi
 * yang tidak ada.
 */
function tungguTenang(m: MapLibreMap, batasMs = 1500): Promise<void> {
  return new Promise((selesai) => {
    if (m.loaded() && m.areTilesLoaded()) return selesai()
    let sudah = false
    const beres = () => {
      if (sudah) return
      sudah = true
      clearTimeout(jam)
      m.off('idle', beres)
      selesai()
    }
    const jam = setTimeout(beres, batasMs)
    m.once('idle', beres)
  })
}

const LEBAR_GELOMBANG = 0.3
const DURASI_MASUK = 950
const DURASI_KELUAR = 420
/** t saat seluruh heksagon sudah terlihat: 1 (jarak terjauh) + lebar gelombang. */
const T_PENUH = 1 + LEBAR_GELOMBANG

function gerbang(t: number) {
  return [
    'interpolate',
    ['linear'],
    // coalesce, bukan get telanjang: satu fitur tanpa properti sudah cukup
    // membuat interpolate melempar galat dan mematikan SELURUH layer. Yang
    // tidak punya urutan dianggap terjauh, jadi ia muncul paling akhir.
    ['coalesce', ['get', '_u'], 1],
    t - LEBAR_GELOMBANG,
    1,
    t,
    0,
  ] as unknown as ExpressionSpecification
}

/**
 * Opasitas isian = dasar × gerbang gelombang × saklar fokus.
 *
 * Faktor ketiga itulah MODE FOKUS: heksagon yang sedang dibuka atau sedang
 * dibandingkan dikalikan NOL, jadi isiannya hilang sama sekali dan jalan serta
 * bangunan di bawahnya terlihat utuh. Yang menandainya garis tebal di layer
 * terpisah — bentuk yang tetap terbaca tanpa menutupi apa pun di bawahnya.
 *
 * Lewat ekspresi, bukan lewat `filter`: filter pada layer isian sudah dipakai
 * saringan kuadran DAN saringan AI, dan menumpuk yang ketiga berarti tiga
 * pemilik untuk satu properti yang sama — persis pola yang sudah pernah
 * menghasilkan bug hantu di berkas ini.
 */
const kali = (
  dasar: number | ExpressionSpecification,
  g: ExpressionSpecification,
  fokus: string[] = [],
) =>
  [
    '*',
    dasar,
    g,
    ['case', ['in', ['get', 'h3_index'], ['literal', fokus]], 0, 1],
  ] as unknown as ExpressionSpecification

/**
 * SATU setPaintProperty per bingkai, bukan tiga.
 *
 * Diukur bingkai demi bingkai: versi tiga-panggilan hanya sempat menghasilkan
 * enam nilai berbeda sepanjang 1,3 detik - sekitar 4,6 fps - padahal
 * requestAnimationFrame di halaman yang sama berjalan di 28 fps. Jadi yang
 * menghambat bukan peta yang sibuk mengunduh, melainkan biaya panggilannya
 * sendiri: tiap setPaintProperty memaksa MapLibre mengurai ulang ekspresi dan
 * menilainya ulang untuk setiap fitur di setiap ubin, lalu mengunggah ulang
 * bufernya.
 *
 * Arsir dan garis karena itu dikeluarkan dari lingkaran per-bingkai. Keduanya
 * memudar lewat `-transition` bawaan MapLibre, yang dijalankan di dalam mesin
 * dan tidak menyentuh main thread tiap bingkai. Yang tinggal digerakkan tangan
 * cuma isian - dan justru isian itulah satu-satunya yang gelombangnya terbaca.
 */
function terapkanGelombang(
  m: MapLibreMap,
  layer: NamaLayer,
  t: number,
  fokus: string[] = [],
) {
  if (m.getLayer(L_ISI)) {
    m.setPaintProperty(L_ISI, 'fill-opacity', kali(OPASITAS_LAYER[layer], gerbang(t), fokus))
  }
}

/** Arsir & garis: sekali di awal gelombang, lalu dibiarkan memudar sendiri. */
function iringiGelombang(m: MapLibreMap, tampak: boolean, durasi: number) {
  if (m.getLayer(L_ARSIR)) {
    m.setPaintProperty(L_ARSIR, 'fill-opacity-transition', { duration: durasi, delay: 0 })
    m.setPaintProperty(L_ARSIR, 'fill-opacity', tampak ? 0.5 : 0)
  }
  if (m.getLayer(L_GARIS)) {
    m.setPaintProperty(L_GARIS, 'line-opacity-transition', { duration: durasi, delay: 0 })
    m.setPaintProperty(L_GARIS, 'line-opacity', tampak ? OPASITAS_GARIS : 0)
  }
  if (m.getLayer(L_ANGKA)) {
    m.setPaintProperty(L_ANGKA, 'text-opacity-transition', { duration: durasi, delay: 0 })
    m.setPaintProperty(L_ANGKA, 'text-opacity', tampak ? 1 : 0)
  }
}

/**
 * Jarak tiap fitur dari pusat kawasan, dinormalkan. Dihitung sekali per muat.
 *
 * Titik pertama cincin luar sudah cukup mewakili posisi heksagon: sisinya cuma
 * ratusan meter, sementara kawasan yang disapu gelombang ini berkilometer.
 */
function bubuhiUrutan(data: { features: unknown[] }) {
  type F = { geometry?: { coordinates?: number[][][] }; properties?: Record<string, unknown> }
  const fitur = data.features as F[]
  const titik = fitur.map((f) => f.geometry?.coordinates?.[0]?.[0] ?? [0, 0])
  if (!titik.length) return

  const cx = titik.reduce((a, t) => a + t[0], 0) / titik.length
  const cy = titik.reduce((a, t) => a + t[1], 0) / titik.length
  const jarak = titik.map((t) => Math.hypot(t[0] - cx, t[1] - cy))
  const maks = Math.max(...jarak) || 1

  fitur.forEach((f, i) => {
    f.properties = f.properties ?? {}
    f.properties._u = jarak[i] / maks
  })
}

/* ==========================================================================
   Pin ujung rute dan gelembung label
   ==========================================================================

   Cincin diganti PIN, dan itu membalik keputusan sebelumnya. Alasan lamanya
   ditulis begini: "pin punya ujung yang menunjuk, dan yang ditunjuknya di sini
   justru garis yang sudah ada." Itu benar untuk satu titik. Ia berhenti benar
   begitu ada DUA titik yang harus dibedakan sekilas: dua cincin berbeda warna
   di dua ujung satu garis tidak memberi tahu mana asal dan mana tujuan, dan
   orang membaca peta rute dengan mencari ujungnya lebih dulu.

   Pin sudah jadi kosakata yang tidak perlu dijelaskan: ujung runcingnya
   MENANDAI satu titik, bukan menunjuk garis. Biru untuk tempat Anda berdiri,
   merah untuk tujuan - urutan yang sama dipakai hampir setiap produk peta.

   KENAPA DIGAMBAR DI CANVAS, bukan SVG di DOM. `icon-image` MapLibre menerima
   gambar raster, dan gambar yang didaftarkan sekali dipakai untuk berapa pun
   pin di layar - satu tekstur, bukan satu simpul DOM per pin. Digambar pada
   DPR perangkat supaya tetap tajam di layar retina.

   PENTING: `setStyle` MENGHAPUS seluruh gambar terdaftar bersama layernya.
   Pendaftaran ini WAJIB dipanggil ulang tiap kali gaya basemap berganti, di
   tempat yang sama dengan penambahan layernya. Kalau tidak, yang terjadi bukan
   galat melainkan pin yang hilang diam-diam. */

/** Pin tetes-air. Lebar 26, tinggi 34 pada DPR 1. */
function gambarPin(warna: string, dpr: number): ImageData | null {
  const W = 26
  const H = 34
  const k = document.createElement('canvas')
  k.width = W * dpr
  k.height = H * dpr
  const c = k.getContext('2d')
  if (!c) return null
  c.scale(dpr, dpr)

  // Bayangan tipis di kaki pin: tanpa ini pin terlihat menempel di peta
  // alih-alih berdiri di atasnya.
  c.beginPath()
  c.ellipse(W / 2, H - 2.5, 5, 2.2, 0, 0, Math.PI * 2)
  c.fillStyle = 'rgba(0,0,0,0.28)'
  c.fill()

  // Badan: lingkaran atas yang meruncing ke bawah.
  const r = 9.5
  const cy = 11.5
  c.beginPath()
  c.arc(W / 2, cy, r, Math.PI * 0.86, Math.PI * 0.14, false)
  c.lineTo(W / 2, H - 3.5)
  c.closePath()
  c.fillStyle = warna
  c.strokeStyle = '#ffffff'
  c.lineWidth = 2.2
  c.fill()
  c.stroke()

  // Lubang putih di tengah: yang membuatnya terbaca sebagai penanda, bukan
  // sebagai tetesan berwarna.
  c.beginPath()
  c.arc(W / 2, cy, 3.4, 0, Math.PI * 2)
  c.fillStyle = '#ffffff'
  c.fill()

  return c.getImageData(0, 0, k.width, k.height)
}

/**
 * Gelembung label yang bisa MELAR. Nine-patch: bagian tengahnya diregangkan
 * mengikuti panjang teks, sudut dan ekornya tidak.
 *
 * Tanpa ini, label rute cuma teks bergaris-halo di atas peta - terbaca, tetapi
 * ia melayang tanpa pijakan. Gelembung memberinya permukaan, dan ekor kecil di
 * bawahnya menyatakan garis mana yang sedang dibicarakannya.
 */
function gambarGelembung(dpr: number): {
  data: ImageData
  opsi: { pixelRatio: number; stretchX: [number, number][]; stretchY: [number, number][]; content: [number, number, number, number] }
} | null {
  const W = 40
  const H = 30
  const R = 7
  const EKOR = 5
  const k = document.createElement('canvas')
  k.width = W * dpr
  k.height = H * dpr
  const c = k.getContext('2d')
  if (!c) return null
  c.scale(dpr, dpr)

  const bawah = H - EKOR
  c.beginPath()
  c.moveTo(R, 1)
  c.lineTo(W - R, 1)
  c.quadraticCurveTo(W - 1, 1, W - 1, 1 + R)
  c.lineTo(W - 1, bawah - R)
  c.quadraticCurveTo(W - 1, bawah, W - 1 - R, bawah)
  // Ekor di tengah bawah.
  c.lineTo(W / 2 + 4, bawah)
  c.lineTo(W / 2, H - 1)
  c.lineTo(W / 2 - 4, bawah)
  c.lineTo(R, bawah)
  c.quadraticCurveTo(1, bawah, 1, bawah - R)
  c.lineTo(1, 1 + R)
  c.quadraticCurveTo(1, 1, R, 1)
  c.closePath()
  c.fillStyle = '#ffffff'
  c.fill()
  c.strokeStyle = 'rgba(0,0,0,0.16)'
  c.lineWidth = 1
  c.stroke()

  return {
    data: c.getImageData(0, 0, k.width, k.height),
    opsi: {
      pixelRatio: dpr,
      // Yang boleh melar HANYA pita tengahnya - sudut membulat dan ekor tidak
      // pernah ikut teregang, dan itu justru gunanya nine-patch.
      stretchX: [[R + 2, W - R - 2]],
      stretchY: [[R + 2, bawah - R - 2]],
      content: [5, 4, W - 5, bawah - 3],
    },
  }
}

/** Warna pin. Biru = tempat Anda, merah = tujuan; urutan yang sudah baku. */
const PIN_AWAL = '#3B82F6'
const PIN_TUJUAN = '#E5484D'

/**
 * Daftarkan pin dan gelembung ke gaya yang sedang hidup.
 *
 * Idempoten: dipanggil ulang tiap `styledata`, dan `hasImage` menjaganya supaya
 * pendaftaran kedua tidak melempar.
 */
function pasangGambarRute(m: MapLibreMap) {
  const dpr = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)))
  const daftar: [string, string][] = [
    ['pin-awal', PIN_AWAL],
    ['pin-tujuan', PIN_TUJUAN],
  ]
  for (const [nama, warna] of daftar) {
    if (m.hasImage(nama)) continue
    const d = gambarPin(warna, dpr)
    if (d) m.addImage(nama, d, { pixelRatio: dpr })
  }
  if (!m.hasImage('gelembung')) {
    const g = gambarGelembung(dpr)
    if (g) m.addImage('gelembung', g.data, g.opsi)
  }
}

/** Bentuk minimal satu fitur heksagon dari `/hex/layer`. */
type FiturHex = {
  geometry?: { coordinates?: number[][][] }
  properties?: Record<string, unknown> & { h3_index?: string }
}

/**
 * Titik tengah heksagon dari cincin luarnya.
 *
 * Rata-rata sederhana, bukan centroid poligon yang benar. Untuk heksagon
 * beraturan keduanya berimpit, dan yang ditaruh di situ cuma lencana nomor -
 * meleset beberapa meter tidak pernah terlihat pada heksagon selebar 350 m.
 */
function titikTengah(f: FiturHex): [number, number] | null {
  const cincin = f.geometry?.coordinates?.[0]
  if (!cincin?.length) return null
  let x = 0
  let y = 0
  for (const [a, b] of cincin) {
    x += a
    y += b
  }
  return [x / cincin.length, y / cincin.length]
}

export interface Kriteria {
  min_score?: number
  kuadran?: string
}

export interface AksiPetaRef {
  flyTo: (lat: number, lon: number, zoom?: number) => void
  highlight: (hexIds: string[]) => void
  filter: (kriteria: Kriteria | null) => void
  /** Dipakai tombol zoom kaca di App.tsx, pengganti NavigationControl. */
  zoomIn: () => void
  zoomOut: () => void
  /** Bingkai [barat, selatan, timur, utara]. Dipakai saat kawasan tak disaring. */
  fitBounds: (kotak: [number, number, number, number]) => void
  /**
   * Terbang ke satu heksagon dan membingkainya.
   *
   * Bukan flyTo ke titik tengahnya dengan zoom tebakan: heksagon res-9 berbeda
   * lebar di layar tergantung lintangnya, dan zoom tetap kadang memotongnya.
   * fitBounds atas geometri fitur itu sendiri selalu pas.
   */
  fokusHeksagon: (h3: string) => void
  /** Kembalikan arah & kemiringan ke utara-datar. */
  resetArah: () => void
  /**
   * Gambar pin lokasi tersimpan. Mengganti SELURUH himpunan pin - pemanggil
   * mengirim daftar lengkap, bukan delta, jadi tidak ada pin yatim yang
   * tertinggal saat sebuah lokasi dilepas dari simpanan.
   */
  setPin: (daftar: { lat: number; lon: number; h3: string }[]) => void
  /** Arah kompas & kemiringan saat ini, untuk memunculkan tombol reset. */
  arah: () => { bearing: number; pitch: number }
}

export interface KendaliPeta extends AksiPetaRef {
  setLayer: (namaLayer: NamaLayer) => void
  setGaya: (gaya: NamaGaya) => void
}

interface Props {
  kawasan: string
  layer: NamaLayer
  /** false = tidak ada layer tematik. Heksagon disembunyikan. */
  layerNyala?: boolean
  /** false = rute & kawasan jangkau TIDAK digambar sampai diminta. */
  rutaTampil?: boolean
  /** Serapat apa nama tempat basemap ditampilkan. Lihat `KERAPATAN_NAMA`. */
  namaTempat?: string
  gaya: NamaGaya
  terpilih: string | null
  saringKuadran: string | null
  /**
   * Heksagon yang sedang ada di baki komparasi, berurutan.
   *
   * Bersama `terpilih` ia membentuk HIMPUNAN FOKUS: isian dihilangkan, garis
   * ditebalkan, dan yang dibandingkan diberi nomor. Urutannya penting - nomor
   * di peta harus sama dengan nomor kolom di bar dan di tabel komparasi.
   */
  dibandingkan: string[]
  onPilihHeksagon: (h3: string | null) => void
  /**
   * Klik dua kali sebuah heksagon = simpan lokasi itu.
   *
   * Jalan pintas, bukan jalan satu-satunya: tombol "Simpan lokasi" di panel
   * detail tetap ada dan tetap jadi tempat orang belajar bahwa fitur ini ada.
   * Yang ditambahkan cuma cara yang lebih cepat untuk orang yang sudah tahu -
   * dan klik-dua-kali memang gerakan yang sudah dipakai orang untuk "tandai
   * ini" di hampir setiap peta.
   *
   * Penjagaannya TIDAK ada di sini. Pemanggil yang memutuskan boleh atau
   * tidak, memakai penjaga yang sama persis dengan tombol di panel - kalau
   * dipisah, "sudah berlangganan" akan berarti hal yang berbeda di dua tempat.
   */
  onSimpanCepat?: (h3: string) => void
  /**
   * Profil rute yang digambar: jalan kaki atau mobil.
   *
   * Milik App, bukan state di sini, karena pemilihnya duduk di panel detail
   * dan petanya yang menggambar. Dua tempat, satu nilai - dan nilai yang
   * disalin ke dua tempat adalah nilai yang suatu saat berselisih.
   */
  profilRute?: ModaTampil
  onMuat: (n: number) => void
  /**
   * Layar pembuka sudah menyingkir?
   *
   * Peta sengaja dipasang di BELAKANG layar pembuka supaya gaya dan ubin
   * pertama sudah selesai diunduh saat pembuka memudar. Efek sampingnya:
   * gelombang kemunculan heksagon ikut berjalan di balik pembuka, dan penonton
   * tidak pernah melihatnya - persis keluhan "pas baru masuk animasinya tidak
   * ada". Selama prop ini false, heksagon menunggu di t = 0.
   */
  tampil: boolean
  /**
   * Arah kompas & kemiringan, dilaporkan tiap kali berubah.
   *
   * App memakainya untuk memunculkan tombol "kembalikan arah". Tombol yang
   * selalu ada akan menempati satu slot permanen untuk keadaan yang jarang
   * terjadi - dan peta yang tidak pernah diputar tidak butuh tombol pelurus.
   */
  onArah?: (a: { bearing: number; pitch: number }) => void
}

/** Satu kalimat yang muncul di kartu sorot peta. */
const K_PETA = {
  id: {
    belum: 'belum berkuadran',
    layerKosong: (benda: string) => `Layer ini belum punya ${benda}`,
    layerSebagian: (a: number, b: number, benda: string) =>
      `${a} dari ${b} heksagon punya ${benda}`,
    nolDari: (b: number) =>
      `Nol dari ${b} heksagon. Heksagon yang tergambar abu semuanya karena memang belum ada yang diukur — bukan karena nilainya rendah.`,
    ubinRingkas: 'Ubin MAPID menolak',
    ubinSisa: (n: number) => `· mencoba lagi ${n}x`,
    ubinHabis: '· percobaan habis',
    ubinJudul: 'Server ubin MAPID sedang menolak',
    basemapJudul: 'Basemap gagal dimuat',
    ubinIsi:
      'Gaya basemap-nya sendiri termuat — ia berkas statis di server ini. Yang ditolak permintaan ubinnya, di sisi MAPID.',
    ubinLanjut:
      'Keempat gaya memakai server ubin yang sama, jadi berganti gaya tidak menolong. Heksagon, skor, dan seluruh analisisnya tidak terpengaruh.',
    basemapLanjut:
      'Pilih basemap lain lewat menu di kanan atas; heksagon dan skornya tidak terpengaruh.',
    cobaLagi: 'Coba muat ulang basemap',
    otomatis: (n: number) =>
      `Peta juga mencoba sendiri tiap menit, ${n} kali lagi. Pemadaman seperti ini biasanya pulih dalam belasan menit.`,
    otomatisHabis: 'Percobaan otomatis sudah habis. Tekan tombol di atas kalau ingin mencoba lagi.',
  },
  en: {
    belum: 'no zone yet',
    layerKosong: (benda: string) => `This layer has no ${benda} yet`,
    layerSebagian: (a: number, b: number, benda: string) =>
      `${a} of ${b} hexagons have ${benda}`,
    nolDari: (b: number) =>
      `Zero of ${b} hexagons. Every hexagon is drawn grey because nothing has been measured yet — not because the values are low.`,
    ubinRingkas: 'MAPID tiles refusing',
    ubinSisa: (n: number) => `· ${n} more tries`,
    ubinHabis: '· out of tries',
    ubinJudul: 'The MAPID tile server is refusing',
    basemapJudul: 'The basemap failed to load',
    ubinIsi:
      'The basemap style itself loaded — it is a static file on this server. What is being refused are the tile requests, on the MAPID side.',
    ubinLanjut:
      'All four styles use the same tile server, so switching style does not help. The hexagons, the scores, and every analysis are unaffected.',
    basemapLanjut:
      'Pick another basemap from the menu at the top right; hexagons and scores are unaffected.',
    cobaLagi: 'Try reloading the basemap',
    otomatis: (n: number) =>
      `The map also retries by itself every minute, ${n} more times. Outages like this usually clear within a quarter of an hour.`,
    otomatisHabis: 'Automatic retries are used up. Press the button above to try again.',
  },
}

const PetaInteraktif = forwardRef<AksiPetaRef, Props>(function PetaInteraktif(
  {
    kawasan,
    layer,
    layerNyala = true,
    rutaTampil = false,
    namaTempat = 'normal',
    gaya,
    terpilih,
    saringKuadran,
    dibandingkan,
    onPilihHeksagon,
    onSimpanCepat,
    profilRute = 'foot-walking',
    onMuat,
    tampil,
    onArah,
  },
  ref,
) {
  const wadah = useRef<HTMLDivElement>(null)
  const peta = useRef<MapLibreMap | null>(null)
  /**
   * Pin lokasi tersimpan. `Marker` DOM MapLibre, bukan layer simbol - dua
   * alasan: marker selamat dari pergantian gaya basemap tanpa perlu dipasang
   * ulang (setiap setStyle menghapus seluruh layer kustom), dan jumlahnya
   * paling banyak puluhan, jauh di bawah titik di mana DOM mulai kalah dari
   * WebGL.
   */
  const pinAktif = useRef<Marker[]>([])
  /** Timer langkah gelombang yang sedang berjalan. Wajib dibatalkan saat
      komponen dilepas: timer yang masih hidup akan menyentuh peta yang sudah
      dibuang. */
  const rafGelombang = useRef(0)
  /**
   * Penyelesai janji gelombang yang sedang berjalan.
   *
   * Tanpa ini, gelombang yang dibatalkan di tengah jalan meninggalkan `await`
   * yang menggantung selamanya - dan langkah sesudahnya (setData saat ganti
   * kawasan) tidak pernah dijalankan. Membatalkan berarti menyelesaikan.
   */
  const selesaikanGelombang = useRef<(() => void) | null>(null)
  /**
   * `layer` versi terbaru, dibaca dari dalam callback yang identitasnya harus
   * tetap. Kalau jalankanGelombang ikut bergantung pada `layer`, identitasnya
   * berubah tiap ganti layer, efek muat-data ikut berjalan ulang, dan dua
   * gelombang (keluar dari muat-ulang, masuk dari ganti-layer) saling
   * membatalkan. Yang terlihat pengguna: animasinya hilang sama sekali.
   */
  const layerKini = useRef(layer)
  layerKini.current = layer
  /** Sama alasannya dengan `layerKini`: layer heksagon DIBANGUN ULANG tiap
   *  kali data dimuat, dan yang dibangun ulang lahir dengan visibilitas
   *  bawaannya. Efek di atas saja tidak cukup - ia sudah berjalan sebelum
   *  layernya ada. Nilainya harus dibaca DI TITIK PEMBUATAN. */
  const namaZona = useNamaZona()
  const teksZona = useTeks(K_PETA)
  const { bahasa } = useBahasa()
  const nyalaKini = useRef(layerNyala)
  nyalaKini.current = layerNyala
  // Dibaca DI DALAM pemuatan gaya, yang berjalan di luar render - jadi ref,
  // bukan nilai yang tertangkap closure dan basi pada pemuatan berikutnya.
  const namaKini = useRef(namaTempat)
  namaKini.current = namaTempat
  /**
   * Himpunan fokus, dibaca dari dalam callback gelombang yang identitasnya
   * harus tetap. Sama alasannya dengan `layerKini`: kalau gelombangnya ikut
   * bergantung pada state ini, identitasnya berubah tiap kali ada yang diklik,
   * efek muat-data ikut berjalan ulang, dan seluruh data diminta ulang hanya
   * karena satu heksagon dipilih.
   */
  const fokusRef = useRef<string[]>([])
  fokusRef.current = [terpilih, ...dibandingkan].filter(Boolean) as string[]
  /**
   * Salinan GeoJSON yang sedang dipakai peta.
   *
   * Dipegang supaya titik tengah heksagon bisa dihitung tanpa
   * `querySourceFeatures`, yang hanya mengembalikan fitur di ubin yang SEDANG
   * tergambar - heksagon pembanding di luar layar akan hilang nomornya, dan
   * hilangnya diam.
   */
  const dataRef = useRef<{ features: FiturHex[] } | null>(null)
  /**
   * Gaya basemap SAAT peta dibuat.
   *
   * Efek inisialisasi hanya berjalan sekali, jadi ia tidak boleh membaca `gaya`
   * langsung - nilainya akan basi. Dulu di sini tertulis `urlGaya('terang')`
   * apa adanya, dan itu bug yang diam: orang yang menutup aplikasi dengan
   * basemap GELAP lalu kembali mendapat ubin TERANG dengan chrome gelap. Efek
   * pergantian gaya di bawah tidak menolong - ia dijaga `if (!siap) return`,
   * dan pada render pertama `siap` memang belum true, sehingga satu-satunya
   * kesempatan menerapkannya lewat begitu saja.
   */
  const gayaAwal = useRef(gaya)
  /** Sama alasannya dengan layerKini: efek inisialisasi hanya berjalan sekali. */
  const onArahRef = useRef(onArah)
  onArahRef.current = onArah
  /**
   * Callback klik & muat lewat ref, BUKAN lewat dependensi efek.
   *
   * Ini memperbaiki bug yang nyata. `m.on('click', ...)` dipasang di dalam efek
   * muat-data, sementara cleanup efek itu cuma menyetel `batal = true` - ia
   * tidak pernah melepas penangannya. Jadi tiap kali identitas
   * `onPilihHeksagon` berubah, efeknya berjalan ulang dan MENUMPUK satu
   * penangan klik lagi, sementara yang lama tetap hidup memegang closure lama.
   *
   * Akibatnya terlihat sebagai perilaku hantu: mengklik peta selagi simulasi
   * terbuka menutup simulasinya, karena penangan tertua masih meyakini
   * simulasi belum pernah dibuka. Lewat ref, penangannya dipasang sekali dan
   * selalu membaca callback terbaru.
   */
  const onPilihRef = useRef(onPilihHeksagon)
  onPilihRef.current = onPilihHeksagon
  // Alasan yang sama persis dengan `onPilihRef` di atas: pendengar peta
  // dipasang SEKALI di efek tanpa dependensi, jadi ia tidak boleh menangkap
  // prop yang identitasnya berganti tiap render.
  const onSimpanRef = useRef(onSimpanCepat)
  onSimpanRef.current = onSimpanCepat
  const onMuatRef = useRef(onMuat)
  onMuatRef.current = onMuat
  /**
   * `tampil` lewat ref, BUKAN lewat dependensi efek pemuat.
   *
   * Sebagai dependensi, ia membuat seluruh data diminta ulang begitu layar
   * pembuka menyingkir - dan pemuatan ulang itu memudarkan heksagon KELUAR
   * lebih dulu, tepat saat efek 'pembuka menyingkir' sedang memudarkannya
   * MASUK. Dua gelombang berjalan bersamaan di layer yang sama, dan yang
   * menang adalah yang kebetulan selesai belakangan.
   *
   * Terukur di terbitan statis: layer terpasang (L_ISI ada, 708 fitur di
   * sumbernya) dan tidak satu piksel pun tergambar - opasitasnya berhenti
   * di 0. Tidak ada galat, tidak ada peringatan; peta cuma kosong.
   *
   * Kenapa baru muncul sekarang: tanpa backend, layar pembuka tidak perlu
   * menunggu /health, jadi ia menyingkir lebih cepat dan urutan keduanya
   * berbalik. Balapannya sudah ada sejak dulu - yang berubah cuma siapa
   * yang menang.
   */
  const tampilRef = useRef(tampil)
  tampilRef.current = tampil
  /** Saringan kuadran sebelumnya, untuk membedakan "pengguna menyaring" dari
      "efek ini kebetulan berjalan lagi". */
  const saringLalu = useRef<string | null>(saringKuadran)
  const [siap, setSiap] = useState(false)

  /**
   * Layer tematik BISA DIMATIKAN, dan itu keadaan bawaannya.
   *
   * Peta yang langsung penuh 708 heksagon berwarna memaksa orang membaca
   * kesimpulan sebelum ia sempat mengenali di mana ia sedang melihat. Bawaan
   * yang benar: basemap dan simpul transit dulu, heksagon menyusul saat
   * diminta.
   *
   * `visibility`, BUKAN melepas layernya. Melepas berarti merakit ulang
   * seluruh gaya tiap kali dinyalakan - dan gelombang kemunculan heksagon
   * ikut berjalan ulang setiap kali.
   */

  // Pilihan kerapatan nama tempat, diterapkan ulang tiap kali berubah.
  useEffect(() => {
    const m = peta.current
    if (!m || !siap) return
    terapkanNamaTempat(m, namaTempat)
  }, [namaTempat, siap])

  const [galat, setGalat] = useState<string | null>(null)
  /** Galat basemap, terpisah dari galat layer heksagon: sebabnya lain, dan
      tindak lanjutnya juga lain.
      `ubin` membedakan dua kegagalan yang menuntut tindakan berbeda: server
      ubin MAPID yang sedang menolak (tidak ada yang bisa kita lakukan), dan
      gaya yang memang salah (itu urusan kita). */
  const [galatPeta, setGalatPeta] = useState<{ pesan: string; ubin: boolean } | null>(null)
  /**
   * Penghitung muat-ulang basemap. Dinaikkan = pasang ulang gaya = ubin diminta lagi.
   *
   * Ada karena MapLibre TIDAK PERNAH mencoba ulang ubin yang gagal. Terukur:
   * dengan ubin diblokir lalu dilepas, menggeser peta menghasilkan NOL
   * permintaan baru ke sumber vector-nya - ubin yang sudah bertanda gagal
   * tetap bertanda gagal sampai sumbernya dipasang ulang.
   *
   * Akibatnya peringatan "server ubin menolak" dulu menempel selamanya,
   * bahkan sesudah MAPID pulih - dan pemadaman MAPID memang selalu pulih
   * sendiri dalam belasan menit, sudah terukur dua kali. Yang terlihat di
   * layar: peta abu-abu permanen dengan pesan yang sudah tidak benar.
   *
   * Percobaan pertama memasang pendengar kejadian (`data` / `sourcedata`) dan
   * itu tidak akan pernah bekerja - bukan karena bentuk kejadiannya salah
   * ditebak, melainkan karena kejadiannya memang tidak ada.
   */
  const [muatUlang, setMuatUlang] = useState(0)
  /** Sampai kapan galat ubin boleh memasang ulang peringatannya, dalam
   *  `performance.now()`. Dibuka tiap kali ubin diminta ulang. */
  const jendelaUbin = useRef(0)
  /**
   * Sisa jatah percobaan otomatis. Masuk ke STATE, bukan cuma variabel di
   * dalam efeknya, karena peringatannya menyebutkan angka ini.
   *
   * Tanpa itu yang terlihat cuma sebuah tombol, dan tombol yang berdiri
   * sendiri menyatakan "tidak ada yang sedang berjalan" - padahal petanya
   * sudah mencoba sendiri tiap menit. Orang lalu menekannya berkali-kali,
   * atau menyimpulkan aplikasinya menyerah.
   */
  const sisaUbin = useRef(PERCOBAAN_UBIN)
  const [percobaanUbin, setPercobaanUbin] = useState(PERCOBAAN_UBIN)
  /**
   * Seberapa banyak peringatan ubin itu memakan layar.
   *
   * Pemadaman MAPID berlangsung belasan menit, dan selama itu panel selebar
   * 28rem duduk di tengah bawah peta - tepat di atas pil layer dan baki
   * komparasi. Yang dinyatakannya penting SEKALI, lalu berubah jadi halangan:
   * pembacanya sudah tahu, sudah tidak bisa berbuat apa-apa, dan masih harus
   * melihatnya tiap kali menggeser peta.
   *
   * Karena itu ia mengecil sendiri jadi chip sesudah dibaca, bukan hilang:
   * peta abu-abu tanpa satu pun keterangan adalah keadaan yang lebih buruk,
   * dan itu sudah pernah terjadi di repo ini.
   */
  const [tiraiUbin, setTiraiUbin] = useState<'penuh' | 'ringkas'>('penuh')
  /**
   * Cakupan layer yang sedang tampil, dihitung dari fitur yang benar-benar
   * termuat. `null` = layer ini memang tidak bisa kosong (opportunity).
   */
  const [cakupan, setCakupan] = useState<{
    terisi: number
    total: number
    benda: string
    bendaEn: string
  } | null>(null)

  const [sorot, setSorot] = useState<PropertiHeksagon | null>(null)
  const [simpul, setSimpul] = useState<SimpulTransit[]>([])

  // Simpul transit dimuat terpisah dari heksagon: jumlahnya sedikit, jarang
  // berubah, dan digambar sebagai elemen HTML di atas peta - bukan layer
  // MapLibre. Alasannya bukan kemudahan: penanda HTML bisa difokuskan keyboard
  // dan dibaca pembaca layar, sedangkan simbol di kanvas tidak bisa keduanya.
  useEffect(() => {
    let batal = false
    api
      .simpulTransit(kawasan)
      .then((s) => !batal && setSimpul(s))
      .catch(() => !batal && setSimpul([]))
    return () => {
      batal = true
    }
  }, [kawasan])

  // --- Inisialisasi. Sekali saja seumur komponen. ---
  useEffect(() => {
    if (!wadah.current) return
    const m = new MapLibreMap({
      container: wadah.current,
      style: urlGaya(gayaAwal.current),
      center: KAWASAN_AWAL.pusat,
      zoom: ZOOM_AWAL,
      // Atribusi dipasang sendiri di bawah, bukan lewat opsi ini, supaya
      // posisinya bisa dipindah ke kiri bawah.
      attributionControl: false,
    })
    // SEMUA kontrol berkumpul di kiri bawah dan berjajar mendatar (aturan
    // .maplibregl-ctrl-bottom-left di index.css). Sebabnya bukan estetika:
    // panel kanan kini melayang setinggi layar, jadi apa pun yang dipasang di
    // kanan akan tertutup - termasuk atribusi MAPID, yang wajib terlihat.
    // Tombol zoom TIDAK dipakai dari MapLibre. Kontrol bawaannya kotak putih
    // yang tidak bisa dibuat sewarna kaca, dan di dalam wadah kiri-bawah ia
    // memaksa baris kontrol jadi setinggi dua tombol. Penggantinya ada di
    // App.tsx sebagai tombol kaca yang memanggil zoomIn/zoomOut lewat ref.
    m.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')
    // ODbL menuntut sumber datanya disebut, dan atribusi "© OpenStreetMap" yang
    // sudah dibawa gaya MAPID itu milik MAPID atas UBIN-nya - bukan milik kita
    // atas POI yang kita turunkan sendiri jadi angka kompetisi, maupun atas rute
    // jalan kaki openrouteservice yang digambar di peta ini. Dua kewajiban yang
    // kebetulan berbunyi mirip, dan yang kedua tidak gugur oleh yang pertama.
    m.addControl(
      new AttributionControl({
        compact: true,
        customAttribution: [
          '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors (ODbL)</a>',
          '<a href="https://openrouteservice.org/" target="_blank" rel="noreferrer">© openrouteservice</a>',
          '<a href="https://www.worldpop.org/" target="_blank" rel="noreferrer">© WorldPop (CC BY 4.0)</a>',
          // ZoneGuard menggambar status perizinan dari RDTR ATR/BPN, dan panel
          // detail mengutipnya sampai ke nama zonanya. Sumber yang dikutip
          // sampai sedetail itu wajib disebut - A.1 menuntutnya untuk setiap
          // data pendukung, bukan hanya untuk yang berlisensi share-alike.
          '<a href="https://gistaru.atrbpn.go.id/rdtrinteraktif/" target="_blank" rel="noreferrer">© RDTR ATR/BPN (GISTARU)</a>',
        ],
      }),
      'bottom-left',
    )
    // DUA pemicu, dan yang kedua bukan sabuk pengaman berlebihan.
    //
    // 'load' baru menyala sesudah render pertama yang lengkap, dan itu
    // menunggu ubin basemap. Terukur 29 Agu 2026: basemap.mapid.io membatasi
    // laju per-IP dan menjawab 401 untuk SELURUH ubin selama beberapa menit -
    // dengan kunci maupun tanpa. Selama itu 'load' tidak menyala, penanda
    // siapnya tetap false, dan heksagon kita sendiri tidak pernah diminta. Yang
    // terlihat: peta kosong total, padahal yang gagal cuma latarnya.
    //
    // 'styledata' menyala begitu gayanya terurai, tanpa menunggu satu ubin
    // pun. Gayanya berkas statis satu-asal, jadi ia praktis selalu berhasil.
    // setSiap(true) idempoten - mana pun yang lebih dulu, hasilnya sama.
    m.on('load', () => setSiap(true))
    m.once('styledata', () => setSiap(true))

    // --- Ikon sprite yang tidak ada di gaya MAPID -------------------------
    //
    // Gaya MAPID merujuk beberapa ikon POI yang tidak ikut di lembar sprite-nya:
    // `office`, `swimming_pool`, `gate`, `brownfield`, `lift_gate`,
    // `sports_centre`. Selama layer POI masih disembunyikan, tidak ada yang
    // pernah memintanya. Begitu layer itu dinyalakan, MapLibre mencarinya, gagal,
    // lalu MEMPERINGATKAN - dan mengulanginya untuk tiap ubin yang memuatnya,
    // sehingga konsol penuh peringatan yang terbaca seperti kerusakan.
    //
    // Tidak ada yang rusak: ikonnya memang tidak ada, dan labelnya tetap
    // tergambar. Yang diperbaiki cuma kebisingannya - satu piksel tembus pandang
    // didaftarkan atas nama yang diminta, jadi MapLibre berhenti mencari.
    //
    // `setMissingStyleImageResolver`, BUKAN penangan kejadian
    // `styleimagemissing`. Tipe MapLibre v6 menyatakannya apa adanya:
    // "Event listeners cannot resolve the missing image for the current
    // request" - kejadian itu menyala SESUDAH resolver diberi kesempatan dan
    // gagal, jadi mendaftarkan gambar dari dalamnya tidak menghentikan
    // peringatannya. Dipasang di resolver, MapLibre menunggunya lebih dulu.
    m.setMissingStyleImageResolver((id) => {
      if (!m.hasImage(id)) {
        m.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) })
      }
    })

    // Sebelum ini, gaya yang gagal dimuat berakhir sebagai layar kosong tanpa
    // sepatah kata pun: 'styledata' tidak pernah menyala, `siap` tetap false,
    // heksagon tidak pernah kembali. "Basemap-nya tidak ada" tanpa petunjuk
    // apa pun. MapLibre sebetulnya mengabarkannya lewat 'error'.
    m.on('error', (e) => {
      const pesan = (e as unknown as { error?: Error }).error?.message
      // Hanya yang terjadi SELAMA gaya dimuat. Sesudah gaya siap, MapLibre
      // masih mengabarkan ubin tunggal yang gagal sepanjang penggeseran peta,
      // dan itu normal - menampilkannya berarti memasang peringatan permanen
      // untuk sesuatu yang tidak perlu ditindaklanjuti siapa pun.
      if (!pesan) return
      // URL-nya ada di dua tempat tergantung versi MapLibre: properti `url`
      // milik AJAXError, dan di dalam pesannya sendiri. Dibaca dari keduanya.
      const url = (e as unknown as { error?: { url?: string } }).error?.url ?? ''
      const keUbin = /basemap\.mapid\.io\/data\//.test(url) || /basemap\.mapid\.io\/data\//.test(pesan)

      // DUA jendela tempat galat boleh dilaporkan, dan yang kedua wajib ada.
      //
      // Pertama: selama gaya dimuat. Sesudah gaya siap, MapLibre masih
      // mengabarkan ubin tunggal yang gagal sepanjang peta digeser, dan itu
      // normal - melaporkannya berarti memasang peringatan permanen untuk
      // sesuatu yang tidak perlu ditindaklanjuti siapa pun.
      //
      // Kedua: beberapa detik sesudah kita MEMINTA ULANG ubin. Tanpa jendela
      // ini, percobaan ulang yang gagal akan menghapus peringatannya tanpa
      // pernah memasangnya kembali - dan yang tersisa peta polos tanpa satu
      // pun keterangan, yaitu keadaan yang lebih buruk daripada sebelum ada
      // percobaan ulang sama sekali.
      const sedangMencoba = keUbin && performance.now() < jendelaUbin.current
      if (!m.isStyleLoaded() || sedangMencoba) {
        // Teknisnya ke KONSOL, bukan ke layar. Yang dulu tercetak di panel
        // adalah `AJAXError: Failed to fetch (0): <url>.pbf` apa adanya -
        // pesan untuk pengembang, dibaca orang yang cuma ingin melihat peta.
        // Kesalahan yang sama sudah pernah diperbaiki di Commuter Clock dan
        // di Konsultan AI; ini tempat ketiganya.
        //
        // `(0)`-nya sendiri menyesatkan, dan itu yang paling layak dicatat:
        // MAPID menjawab 401, tetapi balasan penolakannya TIDAK membawa satu
        // pun header CORS - jadi peramban menolak menyerahkannya ke
        // JavaScript, dan yang sampai ke MapLibre cuma "gagal" tanpa status.
        // Diverifikasi dengan curl dari dua jaringan yang berbeda: 401 di
        // keduanya, sementara `fonts/*` 200 tanpa kunci dan `styles/*` 200
        // dengan kunci yang sama. Jadi status 0 di sini BUKAN jaringan
        // pengguna dan bukan CORS di sisi kita.
        console.warn('[basemap] permintaan ubin ditolak:', pesan, url || '(url tidak disebutkan)')
        setGalatPeta({ pesan, ubin: keUbin })
      }
    })

    // `rotate` dan `pitch` menyala tiap bingkai selama diseret; itu tidak apa-apa
    // karena yang dikirim cuma dua angka dan App membandingkannya sebelum
    // menyetel state.
    const laporArah = () => onArahRef.current?.({ bearing: m.getBearing(), pitch: m.getPitch() })
    m.on('rotate', laporArah)
    m.on('pitch', laporArah)

    peta.current = m
    return () => {
      clearTimeout(rafGelombang.current)
      m.remove()
      peta.current = null
    }
  }, [])

  /**
   * Coba muat ulang basemap sendiri selama peringatan ubinnya masih terpasang.
   *
   * Pemadaman ubin MAPID terukur pulih dalam belasan menit, dan tanpa ini
   * petanya tidak akan pernah tahu - MapLibre tidak mencoba ulang ubin yang
   * sudah gagal. Sepuluh percobaan berjarak semenit menutupi rentang itu;
   * sesudahnya berhenti, dan tombol di peringatannya tetap ada.
   *
   * Berhenti sendiri begitu `galatPeta` hilang, karena efek ini ikut mati.
   */
  useEffect(() => {
    if (!galatPeta?.ubin) return
    sisaUbin.current = PERCOBAAN_UBIN
    setPercobaanUbin(PERCOBAAN_UBIN)
    // Sembilan detik: cukup untuk membaca tiga kalimatnya sekali, tidak cukup
    // lama untuk terasa menghalangi. Sesudah itu ia mengecil sendiri.
    setTiraiUbin('penuh')
    const kecil = setTimeout(() => setTiraiUbin((t) => (t === 'penuh' ? 'ringkas' : t)), 9_000)
    const jam = setInterval(() => {
      if (sisaUbin.current <= 0) {
        clearInterval(jam)
        return
      }
      sisaUbin.current -= 1
      setPercobaanUbin(sisaUbin.current)
      // `setStyle`, dan itu memang satu-satunya yang bekerja.
      //
      // Percobaan pertama memakai `source.setTiles([...tiles])` supaya lebih
      // murah - tanpa membangun ulang layer dan tanpa meminta heksagon lagi.
      // Terukur: ia menghasilkan NOL permintaan ubin. Daftar tile yang sama
      // persis tidak dianggap perubahan, jadi cache ubin gagalnya tetap utuh.
      // Yang lebih buruk, ia `berhasil` secara diam-diam: peringatannya hilang
      // karena tidak ada galat baru, bukan karena ubinnya kembali.
      //
      // Jendela di bawah memastikan kegagalan yang berulang tetap terlihat.
      jendelaUbin.current = performance.now() + 12_000
      setMuatUlang((n) => n + 1)
    }, 60_000)
    return () => {
      clearInterval(jam)
      clearTimeout(kecil)
    }
  }, [galatPeta?.ubin])

  useEffect(() => {
    setCakupan(
      cakupanLayer(
        layer,
        dataRef.current?.features as unknown as
          | { properties?: Record<string, unknown> | null }[]
          | null,
      ),
    )
  }, [layer])

  // --- Ganti gaya basemap ---
  // setStyle membuang seluruh sumber & layer, jadi `siap` direset supaya efek
  // pemuatan heksagon di bawah berjalan ulang setelah gaya baru selesai dimuat.
  useEffect(() => {
    const m = peta.current
    if (!m || !siap) return
    setSiap(false)
    setGalatPeta(null)
    m.once('styledata', () => setSiap(true))
    // `diff: false` WAJIB, dan itu yang membuat tombol coba-ulang berfungsi.
    //
    // Bawaannya `diff: true`: MapLibre membandingkan gaya baru dengan yang
    // sedang terpasang dan menerapkan selisihnya saja. Untuk gaya yang SAMA
    // PERSIS - yaitu tepat yang terjadi saat memuat ulang karena ubinnya
    // gagal - selisihnya nol, jadi ia tidak melakukan apa pun. Terukur: nol
    // permintaan ubin sesudah tombolnya ditekan.
    //
    // Gagalnya diam dan menyesatkan: peringatannya HILANG (karena efek ini
    // memang mengosongkannya) tanpa satu pun ubin diminta ulang, jadi yang
    // terlihat peta polos tanpa keterangan apa pun.
    m.setStyle(urlGaya(gaya), { diff: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gaya, muatUlang])

  /**
   * Menjalankan gelombang dari `dari` ke `ke`. Mengembalikan janji supaya
   * "keluar lalu masuk" saat ganti kawasan bisa ditulis berurutan.
   */
  const jalankanGelombang = useCallback(
    (dari: number, ke: number, durasi: number) =>
      new Promise<void>((selesai) => {
        const m = peta.current
        if (!m) return selesai()

        clearTimeout(rafGelombang.current)
        selesaikanGelombang.current?.()
        selesaikanGelombang.current = selesai

        const tuntas = () => {
          selesaikanGelombang.current = null
          selesai()
        }

        // Arsir dan garis mengikuti arah gelombangnya, sekali saja. `ke` yang
        // lebih besar dari `dari` berarti masuk; sebaliknya berarti surut.
        iringiGelombang(m, ke > dari, Math.round(durasi * 0.8))

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          terapkanGelombang(m, layerKini.current, ke, fokusRef.current)
          return tuntas()
        }
        // --- Kenapa BUKAN requestAnimationFrame ---------------------------
        //
        // Versi sebelumnya menggerakkan `t` tiap bingkai lewat rAF. Diukur
        // bingkai demi bingkai, satu setPaintProperty pada layer isian memakan
        // ~200ms: MapLibre mengurai ulang ekspresinya, menilainya ulang untuk
        // setiap fitur di setiap ubin, lalu mengunggah ulang bufernya. Hasilnya
        // gelombang 950ms yang cuma sempat berganti LIMA kali - dan lima
        // lompatan tidak terbaca sebagai gerakan, melainkan sebagai heksagon
        // yang tiba-tiba ada. Persis keluhannya.
        //
        // Jadi pembagian kerjanya dibalik. JavaScript cuma menetapkan beberapa
        // POSE, dan MapLibre yang mengisi antaranya lewat `-transition`
        // miliknya sendiri - interpolasi itu berjalan di dalam mesin render,
        // bukan di main thread, dan tidak menambah satu panggilan pun per
        // bingkai. Delapan pose untuk 950ms: cukup rapat supaya gerbangnya
        // tetap menyapu, cukup jarang supaya ongkosnya turun hampir empat kali.
        const LANGKAH = 8
        const jeda = durasi / LANGKAH
        m.setPaintProperty(L_ISI, 'fill-opacity-transition', { duration: jeda, delay: 0 })

        // Posenya dihitung dari WAKTU BERJALAN, bukan dari nomor langkah.
        // Bedanya baru terasa di mesin lambat: kalau satu langkah datang
        // terlambat, yang dikorbankan pose - bukan durasinya. Dihitung dari
        // nomor langkah, gelombang 950ms bisa melar jadi enam detik di mesin
        // yang tersendat, dan animasi yang melar begitu berhenti terasa sebagai
        // sambutan dan mulai terasa sebagai menunggu.
        const t0 = performance.now()
        const maju = () => {
          if (!peta.current) return tuntas()
          const p = Math.min(1, (performance.now() - t0) / durasi)
          // Melambat di ujung. Gelombang berkecepatan tetap terbaca sebagai
          // penggaris yang bergeser, bukan sebagai sesuatu yang mendarat.
          const e = 1 - Math.pow(1 - p, 3)
          terapkanGelombang(peta.current, layerKini.current, dari + (ke - dari) * e, fokusRef.current)
          if (p < 1) rafGelombang.current = window.setTimeout(maju, jeda)
          else tuntas()
        }
        terapkanGelombang(m, layerKini.current, dari, fokusRef.current)
        rafGelombang.current = window.setTimeout(maju, jeda)
      }),
    [],
  )

  //
  // MASUK dan SURUT, bukan muncul dan hilang. Diperbaiki 9 Sep 2026: dulu
  // `visibility` dibalik seketika, jadi memilih "Opportunity Score" dari
  // "Tanpa layer" menjatuhkan 708 heksagon ke layar dalam satu bingkai - dan
  // mematikannya mencabut semuanya sama mendadaknya. Gelombang yang dipakai
  // saat data pertama datang sudah ada; ia cuma tidak pernah dipanggil di sini.
  //
  // Menyala: opasitas dipaksa nol DULU, baru layernya ditampakkan, baru
  // gelombangnya mekar dari pusat kawasan. Tanpa langkah pertama, layer yang
  // pernah menyala masih memegang opasitas penuhnya dan langsung tampil utuh.
  // Mati: gelombang surut ke tepi, dan layernya baru disembunyikan SESUDAH
  // gelombangnya selesai - kalau di tengah jalan orangnya menyalakannya lagi,
  // `nyalaKini` sudah true dan penyembunyiannya dibatalkan.
  const nyalaSebelum = useRef(layerNyala)
  useEffect(() => {
    const m = peta.current
    if (!m || !siap) return
    const pasangTampak = (v: 'visible' | 'none') => {
      for (const id of [L_ISI, L_ARSIR, L_GARIS, L_ANGKA, L_SOROT]) {
        if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', v)
      }
    }
    const sebelum = nyalaSebelum.current
    nyalaSebelum.current = layerNyala
    if (layerNyala) {
      terapkanGelombang(m, layerKini.current, 0, fokusRef.current)
      pasangTampak('visible')
      void jalankanGelombang(0, T_PENUH, 1050)
    } else if (sebelum) {
      void jalankanGelombang(T_PENUH, 0, 600).then(() => {
        if (!nyalaKini.current && peta.current) pasangTampak('none')
      })
    } else {
      pasangTampak('none')
    }
  }, [layerNyala, siap, jalankanGelombang])

  // --- Muat heksagon ---
  useEffect(() => {
    const m = peta.current
    if (!m || !siap) return
    let batal = false

    api
      .layerHeksagon({ kawasan })
      .then(async (data) => {
        if (batal || !peta.current) return
        setGalat(null)
        const fitur = (data.features as unknown[]) ?? []
        onMuatRef.current(fitur.length)
        bubuhiUrutan(data as { features: unknown[] })
        dataRef.current = data as unknown as { features: FiturHex[] }
        setCakupan(cakupanLayer(layerKini.current, fitur as { properties?: Record<string, unknown> | null }[]))

        const sumber = m.getSource(SUMBER)
        if (sumber) {
          // Kawasan berganti: heksagon lama surut dulu ke tepi, baru yang baru
          // mekar. Tanpa jeda ini, satu kawasan berubah jadi kawasan lain dalam
          // satu bingkai dan mata kehilangan jejak apa yang barusan diganti.
          if (tampilRef.current) await jalankanGelombang(T_PENUH, 0, DURASI_KELUAR)
          if (batal || !peta.current) return
          ;(sumber as GeoJSONSource).setData(data as never)
          if (tampilRef.current) await jalankanGelombang(0, T_PENUH, DURASI_MASUK)
          return
        }

        if (!m.hasImage(POLA)) {
          m.addImage(POLA, buatPolaArsir(), { pixelRatio: 2 })
        }
        m.addSource(SUMBER, { type: 'geojson', data: data as never })

        siapkanBasemap(m, gaya, namaKini.current)

        // Heksagon disisipkan DI ATAS seluruh isian dan garis basemap, tetapi
        // DI BAWAH labelnya. Kalau heksagon menutupi nama jalan dan stasiun,
        // pengguna kehilangan satu-satunya cara mengenali tempat yang sedang
        // dilihatnya, dan peta berubah jadi hamparan warna yang tidak menunjuk
        // apa pun.
        //
        // Percobaan pertama menyisipkannya sebelum layer symbol PERTAMA, dan itu
        // salah: symbol pertama di gaya MAPID adalah `water_name` pada indeks 8
        // dari 54, jadi seluruh jalan dan bangunan justru tergambar DI ATAS
        // heksagon dan menyapunya habis. Yang benar: setelah layer bukan-symbol
        // TERAKHIR.
        const labelPertama = idLabelPertama(m)

        m.addLayer(
          {
            id: L_ISI,
            type: 'fill',
            source: SUMBER,
            layout: { visibility: nyalaKini.current ? 'visible' : 'none' },
            paint: {
              'fill-color': WARNA_LAYER[layerKini.current],
              // Lahir tak terlihat; jalankanGelombang di bawah yang memunculkan.
              'fill-opacity': kali(OPASITAS_LAYER[layer], gerbang(0), fokusRef.current),
            },
          },
          labelPertama,
        )

        // Arsir ketidakpastian: satu layer di atas isian, berlaku untuk kelima
        // layer tematik. Warnanya tidak perlu ikut berubah - yang disampaikannya
        // bukan nilai, melainkan bahwa nilainya belum terukur.
        m.addLayer(
          {
            id: L_ARSIR,
            type: 'fill',
            source: SUMBER,
            layout: { visibility: nyalaKini.current ? 'visible' : 'none' },
            filter: ['==', ['get', 'data_source'], 'predicted'],
            paint: { 'fill-pattern': POLA, 'fill-opacity': kali(0.5, gerbang(0)) },
          },
          labelPertama,
        )

        // Garis batas cukup gelap untuk memisahkan heksagon sewarna. Garis putih
        // tipis hilang begitu dua heksagon bersebelahan berwarna sama, dan
        // keduanya melebur jadi satu gumpalan yang tidak bisa diklik dengan yakin.
        m.addLayer(
          {
            id: L_GARIS,
            type: 'line',
            source: SUMBER,
            layout: { visibility: nyalaKini.current ? 'visible' : 'none' },
            paint: {
              'line-color': GARIS_HEX(gaya),
              'line-width': TEBAL_GARIS,
              'line-opacity': kali(OPASITAS_GARIS, gerbang(0)),
            },
          },
          labelPertama,
        )

        // --- Angka di dalam heksagon --------------------------------------
        //
        // Diminta pemilik repo: skor harus terbaca tanpa menyorot heksagonnya
        // satu per satu. Tiga hal yang membuatnya tidak berubah jadi kekacauan:
        //
        //   text-allow-overlap FALSE  - MapLibre membuang label yang tidak muat,
        //     jadi saat dizoom keluar yang tersisa hanya yang punya ruang.
        //     Menyalakannya akan menumpuk 700 angka jadi bubur.
        //   text-size mengikuti zoom  - 0 di bawah z12: pada zoom segitu satu
        //     heksagon lebih kecil dari angkanya sendiri.
        //   halo                       - isian heksagon tembus pandang, jadi di
        //     belakang angka bisa ada apa saja.
        const teks = TEKS_HEX(gaya)
        m.addLayer(
          {
            id: L_ANGKA,
          type: 'symbol',
          source: SUMBER,
          minzoom: 12,
          layout: {
            visibility: nyalaKini.current ? 'visible' : 'none',
            'text-field': ANGKA_LAYER[layerKini.current],
            'text-font': FONT_ANGKA,
            'text-size': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, 10, 15, 13, 17, 15],
            'text-allow-overlap': false,
            'text-ignore-placement': false,
            'text-padding': 2,
          },
          paint: {
            'text-color': teks.warna,
            'text-halo-color': teks.halo,
            'text-halo-width': 1.4,
            'text-opacity': 0,
          },
        },
        // DI BAWAH label basemap, bukan di atasnya.
        //
        // Tanpa `labelPertama` layer ini duduk paling atas dan angka heksagon
        // menimpa nama tempat - persis keluhan "heksagonnya nutupin". Angka
        // skor memang berguna, tetapi ia milik lapisan data; nama tempat milik
        // petanya, dan peta yang tertutup datanya berhenti jadi peta.
        labelPertama,
      )

        m.addLayer({
          id: L_SOROT,
          type: 'line',
          source: SUMBER,
          layout: { visibility: nyalaKini.current ? 'visible' : 'none' },
          paint: { 'line-color': GARIS_HEX(gaya), 'line-width': 1.5 },
          filter: ['in', ['get', 'h3_index'], ['literal', []]],
        })

        // Bingkai mode fokus. Tebal, karena ia satu-satunya yang menandai
        // heksagon terpilih sekarang - isiannya sengaja dihilangkan supaya
        // jalan dan bangunan di bawahnya terlihat utuh.
        m.addLayer({
          id: L_PILIH,
          type: 'line',
          source: SUMBER,
          paint: {
            'line-color': GARIS_HEX(gaya),
            'line-width': 3.4,
            'line-opacity': 0.95,
          },
          filter: ['in', ['get', 'h3_index'], ['literal', []]],
        })

        // --- Lapisan fokus: garis ke stasiun + nomor heksagon pembanding ---
        //
        // Sumber TERPISAH dari heksagon, dan itu perlu: isinya berubah tiap
        // kali ada yang diklik, sedangkan sumber heksagon hanya berubah saat
        // kawasannya berganti. Menyatukannya berarti mengirim ulang 708
        // poligon setiap satu heksagon dipilih.
        //
        // Ditambahkan TANPA beforeId, jadi ia duduk di atas segalanya. Ini satu
        // dari sedikit hal yang memang boleh menutupi nama jalan: ia cuma ada
        // selama sesuatu sedang difokuskan.
        const fokus = WARNA_FOKUS(gaya)
        m.addSource(SUMBER_FOKUS, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] } as never,
        })

        // --- Kawasan jangkau (isochrone) ------------------------------
        //
        // DI BAWAH rute, DI ATAS heksagon. Urutannya bukan selera: isochrone
        // itu konteks (sejauh mana orang bisa sampai), rute itu jawaban (lewat
        // mana persisnya). Konteks yang menutupi jawaban membuat keduanya sulit
        // dibaca sekaligus.
        m.addSource(SUMBER_ISO, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] } as never,
        })
        m.addLayer({
          id: L_ISO_ISI,
          type: 'fill',
          source: SUMBER_ISO,
          paint: {
            // Ketiga pita DIBERI isian, dan tumpukannya DISENGAJA.
            //
            // Versi sebelumnya cuma mengisi pita 5 menit pada 0,1 - dengan
            // alasan bahwa tiga isian bertumpuk membuat pusatnya tiga kali
            // lebih pekat daripada tepinya, "gradasi yang tidak dimaksudkan
            // siapa pun". Alasan itu keliru dua kali. Pertama, hasilnya nyaris
            // tidak terlihat sama sekali di atas basemap terang. Kedua, dan
            // lebih penting: gradasi itu justru BENAR. Poligonnya memang
            // bersarang, dan makin dekat stasiun makin banyak orang yang mau
            // berjalan ke sana - pusat yang lebih pekat menyatakan hal yang
            // sungguhan, bukan artefak.
            //
            // Yang perlu dijaga cuma alfa per pita tetap rendah, supaya
            // tumpukan paling dalam berhenti di ~0,26 dan angka di dalam
            // heksagon tetap terbaca menembusnya.
            // Tiap pita punya WARNANYA sendiri sejak 3 Sep 2026, bukan
            // satu warna dengan lima opasitas.
            //
            // Dengan tiga pita, opasitas saja masih bisa dibedakan. Dengan
            // lima - dan dua di antaranya jauh lebih luas daripada tiga yang
            // lama - tumpukannya berubah jadi satu gumpalan biru yang tidak
            // memberi tahu apa pun. Rona yang bergeser dari kuning ke ungu
            // membuat "sepuluh menit" dan "tiga puluh menit" terbaca sebagai
            // dua hal, bukan sebagai satu hal yang lebih pucat.
            //
            // Urutan ronanya SEARAH dengan besarnya - kuning dekat, ungu jauh -
            // jadi ia tetap terbaca sebagai satu skala, bukan lima kategori.
            'fill-color': [
              'interpolate', ['linear'], ['get', 'menit'],
              5, '#f2b705',
              10, '#f07818',
              15, '#dc3f6a',
              30, '#8b3bb8',
              60, '#3b41b8',
            ],
            // ISIAN DIPANGKAS HABIS, 9 Sep 2026.
            //
            // Argumen sebelumnya - bahwa tumpukan pita bersarang menyatakan
            // sesuatu yang sungguhan - masih benar. Yang salah adalah
            // harganya: LIMA pita bertumpuk, walaupun tiap satunya tipis,
            // menutupi seluruh layar dengan kabut berwarna. Dan yang tertutup
            // bukan hiasan melainkan JALANNYA - satu-satunya hal yang membuat
            // orang bisa mengenali di mana ia sedang melihat.
            //
            // Kawasan jangkau menjawab "sejauh mana orang sampai", dan
            // pertanyaan itu dijawab BATASNYA. Isian tidak menambah satu pun
            // keterangan yang tidak sudah dinyatakan garis tepinya.
            //
            // Yang tersisa 0,05 di pita terdalam saja - cukup untuk menyatakan
            // bahwa daerah itu "di dalam", tidak cukup untuk menutupi apa pun.
            'fill-opacity': [
              'interpolate', ['linear'], ['get', 'menit'],
              5, 0.05,
              10, 0.035,
              15, 0.022,
              30, 0.012,
              60, 0.008,
            ],
          },
        })
        // Garis bayang di BAWAH garis isochrone. Tanpa ini, tepi pita hilang
        // begitu ia kebetulan melintasi heksagon berwarna senada - dan yang
        // hilang justru satu-satunya hal yang membuat pita punya bentuk.
        m.addLayer({
          id: `${L_ISO_GARIS}-bayang`,
          type: 'line',
          source: SUMBER_ISO,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': WARNA_RUTE_BAYANG(gaya),
            // Ditipiskan dari 5,5/3,6/2,8 dan 0,55. Garis bayang ada supaya tepi
            // pita tidak hilang di atas heksagon senada - itu tetap perlu -
            // tetapi setebal itu ia sendiri yang menghapus jalan di bawahnya.
            'line-width': [
              'interpolate', ['linear'], ['get', 'menit'],
              5, 3, 15, 2.2, 60, 1.8,
            ],
            'line-opacity': 0.34,
          },
        })
        m.addLayer({
          id: L_ISO_GARIS,
          type: 'line',
          source: SUMBER_ISO,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': [
              'interpolate', ['linear'], ['get', 'menit'],
              5, '#f2b705',
              10, '#f07818',
              15, '#dc3f6a',
              30, '#8b3bb8',
              60, '#3b41b8',
            ],
            // Makin lama pitanya, makin tipis garisnya - urutan yang sama
            // dengan urutan pentingnya bagi orang yang mencari lokasi.
            'line-width': [
              'interpolate', ['linear'], ['get', 'menit'],
              5, 3.2, 15, 1.9, 60, 1.4,
            ],
            // Tidak lagi pekat penuh. Isian sudah dipangkas habis supaya jalan
            // di bawahnya terlihat; lima cincin berwarna beropasitas 1 yang
            // membentang melintasi seluruh layar mengembalikan persoalan yang
            // sama lewat pintu lain. Pada 0,62 batasnya masih terbaca sebagai
            // batas, dan jalan yang dilintasinya tetap bisa diikuti mata.
            'line-opacity': 0.62,
            // Pita TERDALAM utuh, sisanya putus-putus. Bentuknya ikut membawa
            // arti: yang utuh batas yang paling layak dipercaya sekaligus yang
            // paling sering dipakai orang.
            'line-dasharray': ['case', ['==', ['get', 'menit'], 5], ['literal', [1, 0]], ['literal', [2.6, 1.8]]],
          },
        })
        m.addLayer({
          id: L_ISO_TEKS,
          type: 'symbol',
          source: SUMBER_ISO,
          layout: {
            'symbol-placement': 'line',
            // Dinaikkan dari 380. Satu pita mengelilingi seluruh kawasan, jadi
            // jarak 380 px menulis "15 menit jalan kaki" lima sampai delapan
            // kali di satu layar - dan pengulangan itu tidak menambah satu pun
            // keterangan, cuma menambah teks yang harus dibaca lalu diabaikan.
            'symbol-spacing': 1100,
            // "5 menit jalan kaki", bukan "5 menit jalan". Dua kata lebih
            // panjang, dan menghapus satu-satunya pertanyaan yang tersisa.
            'text-field': ['concat', ['to-string', ['get', 'menit']], ' menit jalan kaki'],
            'text-font': FONT_ANGKA,
            'text-size': ['case', ['==', ['get', 'menit'], 5], 12.5, 11.5],
            'text-offset': [0, -1],
            'text-allow-overlap': false,
            'text-ignore-placement': false,
          },
          paint: {
            'text-color': WARNA_ISO(gaya),
            'text-halo-color': WARNA_RUTE_BAYANG(gaya),
            'text-halo-width': 2.6,
            'text-halo-blur': 0.4,
          },
        })

        // --- Rute jalan kaki ------------------------------------------
        //
        // Empat layer untuk satu garis, dan tiap satu punya tugas yang tidak
        // bisa diambil alih yang lain:
        //
        //   BAYANG  garis lebih tebal berwarna lawan di bawahnya. Tanpa ini
        //           rute gelap hilang di atas heksagon gelap, dan rute terang
        //           hilang di atas jalan yang terang. Ini bukan hiasan - ini
        //           satu-satunya yang membuat rute terbaca di atas SEMUA isian.
        //   ALT     jalur alternatif, putus-putus dan redup. Putus-putus di
        //           sini SAH: ia memang bukan yang direkomendasikan.
        //   UTAMA   rute tercepat, utuh dan tegas.
        //   TEKS    jarak dan waktu, di tengah garisnya.
        //
        // Ditambahkan TANPA beforeId, jadi rute duduk di atas segalanya -
        // termasuk di atas heksagon. Itu diminta secara eksplisit, dan memang
        // benar: rute yang tertimbun isian heksagon tidak bisa diikuti mata.
        m.addSource(SUMBER_RUTE, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] } as never,
        })

        // Bayangan rute. TIGA hal yang harus benar bersamaan, dan versi
        // sebelumnya salah di ketiganya sekaligus - hasilnya dilaporkan sebagai
        // "rute jalan kaki kurang rapih".
        //
        //   1. Ia ikut BERTITIK untuk jalan kaki. Bayangan PADAT di bawah
        //      deretan titik menghasilkan pita gelap yang menghubungkan
        //      titik-titiknya - persis benda yang titik-titik itu dimaksudkan
        //      menggantikan. Yang benar: tiap titik punya cincin gelapnya
        //      sendiri, tidak ada yang menyambung di antaranya.
        //   2. Lebarnya IKUT ZOOM. Bayangan berlebar tetap 8,5 px kalah oleh
        //      garis atasnya yang tumbuh sampai 9,5 px di zoom 18 - jadi
        //      justru di zoom terdekat, tempat bayangan paling berguna, ia
        //      hilang sama sekali.
        //   3. Perbandingannya TETAP 1,35x di setiap zoom, dan celah dash-nya
        //      dibagi angka yang sama (2,2 / 1,35 = 1,63). Satuan dasharray
        //      MapLibre kelipatan LEBAR GARIS, jadi dua layer berlebar berbeda
        //      dengan celah yang sama menghasilkan jarak titik yang berbeda -
        //      dan titik yang tidak sejajar dengan cincinnya terbaca sebagai
        //      garis yang bergetar.
        //
        // Alternatif tidak lagi diberi bayangan (`filter`): ia garis tipis
        // 1,8 px, dan bayangan bertitik di bawah garis padat cuma mengotori.
        m.addLayer({
          id: L_RUTE_BAYANG,
          type: 'line',
          source: SUMBER_RUTE,
          filter: ['get', 'utama'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': WARNA_RUTE_BAYANG(gaya),
            'line-width': [
              'interpolate', ['linear'], ['zoom'],
              11, 6.8,
              15, 10,
              18, 12.8,
            ],
            'line-opacity': 0.9,
            'line-dasharray': [
              'case',
              ['==', ['get', 'profil'], 'driving-car'],
              ['literal', [1, 0]],
              ['literal', [0, 1.63]],
            ],
          },
        })
        m.addLayer({
          id: L_RUTE_ALT,
          type: 'line',
          source: SUMBER_RUTE,
          filter: ['!', ['get', 'utama']],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            // SOLID dan tipis, bukan putus-putus.
            //
            // Rute alternatif dulu digambar putus-putus supaya jelas ia bukan
            // yang tercepat. Yang terlihat justru deretan setrip abu-abu yang
            // membentang dari titik awal ke tujuan - dilaporkan begitu, dan
            // memang begitu: pada lebar 2,6 px dengan celah 1,5 px, mata
            // membaca setripnya lebih dulu daripada jalurnya.
            //
            // Yang membedakannya dari rute utama sekarang LEBAR dan OPASITAS,
            // dan keduanya cukup: ia setengah tebalnya dan separuh pekatnya.
            'line-color': WARNA_RUTE_ALT(gaya),
            'line-width': 1.8,
            'line-opacity': 0.5,
            'line-dasharray': [1, 0],
          },
        })
        m.addLayer({
          id: L_RUTE,
          type: 'line',
          source: SUMBER_RUTE,
          filter: ['get', 'utama'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ['get', 'warna'],
            // Sedikit lebih tebal, dan MELEBAR saat di-zoom masuk. Lebar tetap
            // membuat rute terlihat seperti benang di zoom rendah dan seperti
            // pita di zoom tinggi; yang melebar terbaca sama di keduanya.
            //
            // MOBIL digambar lebih tebal lagi. Bukan hierarki - keduanya
            // sama pentingnya - melainkan supaya bedanya terbaca bersama pola
            // garisnya di bawah: yang padat-dan-tebal jelas bukan yang
            // putus-putus, bahkan sekilas dan bahkan buta warna.
            // BUG NYATA yang diperbaiki 4 Sep 2026, ditemukan MapLibre sendiri saat
            // render: "Only one zoom-based step or interpolate subexpression
            // may be used in an expression." Bentuk lama membungkus DUA
            // `interpolate(..., ['zoom'], ...)` di dalam satu `case` - dan itu
            // dilarang keras di style spec, berapa pun masuk akalnya secara
            // logika. Yang diizinkan: SATU `interpolate` di zoom sebagai
            // bungkus terluar, dengan nilai TIAP STOP-nya data-driven lewat
            // `case`. Bentuknya dibalik, hasilnya sama persis secara angka.
            // Titik jalan kaki dibuat SETEBAL rute mobil, bukan lebih tipis.
            // Diameter titik = lebar garis, jadi garis tipis menghasilkan titik
            // yang nyaris tidak terlihat - kebalikan dari yang dimaksud.
            'line-width': [
              'interpolate', ['linear'], ['zoom'],
              11, ['case', ['==', ['get', 'profil'], 'driving-car'], 5, 5],
              15, ['case', ['==', ['get', 'profil'], 'driving-car'], 7.4, 7.4],
              18, ['case', ['==', ['get', 'profil'], 'driving-car'], 9.5, 9.5],
            ],
            // JALAN KAKI = TITIK BULAT BERDERET, mobil = garis padat.
            //
            // Bukan garis putus-putus, yang sudah dua kali dicoba dan dua kali
            // ditolak: setrip persegi panjang pada lebar 4-7 px terbaca sebagai
            // garis yang renggang, bukan sebagai jalur kaki.
            //
            // Yang benar TITIK, dan resepnya dua bagian yang harus dipakai
            // bersama: `line-cap: 'round'` (sudah dipasang di layout layer ini)
            // ditambah dasharray ber-panjang-garis NOL. Dash sepanjang nol yang
            // diberi tutup bulat menjadi lingkaran sempurna berdiameter selebar
            // garisnya; celah 1,8x lebar memberi jarak yang sama dengan yang
            // dipakai peta jalan kaki di mana-mana.
            //
            // Mobil tetap `[1, 0]` - padat, tanpa celah.
            //
            // Celah 2,2x lebar, bukan 1,8x. Pada 1,8x jarak antar-TEPI titik
            // cuma 0,8x diameternya: titiknya nyaris bersentuhan, dan di
            // tikungan - tempat titik-titiknya merapat lagi - mereka menyatu
            // jadi gumpalan. 2,2x menyisakan satu diameter penuh di antaranya,
            // jarak yang dipakai peta jalan kaki di mana-mana.
            'line-dasharray': [
              'case',
              ['==', ['get', 'profil'], 'driving-car'],
              ['literal', [1, 0]],
              ['literal', [0, 2.2]],
            ],
          },
        })

        // LAYER ARUS DICABUT 9 Sep 2026.
        //
        // Ia garis putus-putus tipis yang mengalir di atas rute menuju stasiun,
        // dan gunanya menyatakan ARAH. Dua kali diperbaiki - dibuat sekali
        // jalan, lalu dipudarkan sesudah selesai - dan dua kali dilaporkan
        // sebagai "garis garis yang menuju lokasi, jelek sekali".
        //
        // Arahnya toh sudah dinyatakan dua hal lain yang tidak bergerak sama
        // sekali: pin biru di titik awal dan pin merah di tujuan. Menambahkan
        // yang ketiga cuma menambah gerakan.

        // Titik awal dan tujuan. Cincin kecil, bukan pin: pin punya ujung yang
        // menunjuk, dan yang ditunjuknya di sini justru garis yang sudah ada.
        //
        // DUA layer, bukan satu. Yang bawah cincin lebar beropasitas rendah -
        // ia yang membuat ujungnya terbaca sebagai simpul, bukan sebagai
        // titik yang kebetulan ada di situ. Tujuan dapat cincin lebih besar
        // daripada asal: yang dituju stasiun, dan stasiun memang lebih penting
        // daripada titik tengah sebuah heksagon.
        // Gambar pin & gelembung didaftarkan DI SINI, bersama layernya.
        // `setStyle` menghapus keduanya sekaligus, jadi keduanya harus dipasang
        // di tempat yang sama - kalau tidak, ganti basemap menghilangkan pinnya
        // tanpa satu pun galat.
        pasangGambarRute(m)

        m.addLayer({
          id: L_UJUNG,
          type: 'symbol',
          source: SUMBER_RUTE,
          // Menurut JENIS, bukan menurut tipe geometri: sejak label rute ikut
          // jadi titik, saringan "semua titik" akan menggambar pin di tengah
          // rute juga.
          filter: ['==', ['get', 'jenis'], 'pin'],
          layout: {
            'icon-image': ['case', ['get', 'tujuan'], 'pin-tujuan', 'pin-awal'],
            // Jangkar BAWAH: ujung runcing pin yang menandai titiknya, bukan
            // tengahnya. Dengan jangkar tengah, pin tampak melayang setengah
            // badan di atas tempat yang ditandainya.
            'icon-anchor': 'bottom',
            'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.72, 15, 0.95, 18, 1.1],
            // Pin TIDAK BOLEH hilang berebut ruang dengan nama tempat: ia
            // satu-satunya penanda asal dan tujuan di layar.
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            // Tujuan digambar di ATAS asal saat keduanya berdekatan.
            'symbol-sort-key': ['case', ['get', 'tujuan'], 0, 1],
          },
        })

        m.addLayer({
          id: L_RUTE_TEKS,
          type: 'symbol',
          source: SUMBER_RUTE,
          filter: ['==', ['get', 'jenis'], 'label'],
          layout: {
            // Yang utama ditempatkan lebih dulu saat berebut ruang. Tanpa ini
            // label alternatif bisa menang dan yang tercepat justru tak berlabel.
            'symbol-sort-key': ['case', ['get', 'utama'], 0, 1],
            'text-field': ['get', 'label'],
            'text-font': FONT_ANGKA,
            'text-size': ['case', ['get', 'utama'], 12.5, 11],
            // Gelembung: latar putih yang MELAR mengikuti panjang teksnya, dengan
            // ekor kecil yang menyatakan garis mana yang sedang dibicarakan.
            // Label bergaris-halo saja terbaca, tetapi ia melayang tanpa pijakan.
            'icon-image': 'gelembung',
            'icon-text-fit': 'both',
            'icon-text-fit-padding': [3, 7, 6, 7],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            // Ekor gelembung mendarat TEPAT di titik tengah rutenya. Dengan
            // jangkar tengah, gelembung menutupi ruas yang sedang dibicarakannya.
            'text-anchor': 'bottom',
            'icon-anchor': 'bottom',
            // Label rute TIDAK BOLEH kalah berebut ruang. Dengan penempatan
            // biasa, rute kedua yang kebetulan lewat dekat sebuah nama tempat
            // kehilangan labelnya diam-diam - dan yang hilang justru satu-
            // satunya angka yang menjawab "berapa lama dari sini". Nama tempat
            // selalu bisa dibaca dengan menggeser peta; label rute cuma ada
            // selagi rutenya ada.
            'text-allow-overlap': true,
          },
          paint: {
            'text-color': ['get', 'warna'],
            'text-halo-color': WARNA_RUTE_BAYANG(gaya),
            'text-halo-width': 2,
          },
        })

        m.addLayer({
          id: L_NOMOR,
          type: 'circle',
          source: SUMBER_FOKUS,
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-radius': 13,
            'circle-color': fokus.isi,
            'circle-stroke-width': 2.5,
            'circle-stroke-color': fokus.teks,
          },
        })
        m.addLayer({
          id: L_NOMOR_TEKS,
          type: 'symbol',
          source: SUMBER_FOKUS,
          filter: ['==', ['geometry-type'], 'Point'],
          layout: {
            'text-field': ['get', 'nomor'],
            'text-font': FONT_ANGKA,
            'text-size': 14,
            'text-allow-overlap': true,
            'text-ignore-placement': true,
          },
          paint: { 'text-color': fokus.teks },
        })

        m.on('click', L_ISI, (e) => {
          const p = e.features?.[0]?.properties as PropertiHeksagon | undefined
          onPilihRef.current(p?.h3_index ?? null)
        })
        // `preventDefault()` WAJIB, dan bukan formalitas: tanpa itu MapLibre
        // ikut menjalankan zoom bawaannya, jadi menyimpan sebuah lokasi
        // sekaligus melompatkan peta satu tingkat zoom. Yang tersimpan benar,
        // yang terlihat pindah tempat.
        m.on('dblclick', L_ISI, (e) => {
          const p = e.features?.[0]?.properties as PropertiHeksagon | undefined
          if (!p?.h3_index || !onSimpanRef.current) return
          e.preventDefault()
          onSimpanRef.current(p.h3_index)
        })
        m.on('mousemove', L_ISI, (e) => {
          const p = e.features?.[0]?.properties as PropertiHeksagon | undefined
          setSorot(p ?? null)
          m.getCanvas().style.cursor = 'pointer'
          if (p && m.getLayer(L_SOROT)) {
            m.setFilter(L_SOROT, ['in', ['get', 'h3_index'], ['literal', [p.h3_index]]])
          }
        })
        m.on('mouseleave', L_ISI, () => {
          setSorot(null)
          m.getCanvas().style.cursor = ''
          if (m.getLayer(L_SOROT)) {
            m.setFilter(L_SOROT, ['in', ['get', 'h3_index'], ['literal', []]])
          }
        })

        if (tampilRef.current) {
          await tungguTenang(m)
          if (!batal && peta.current) void jalankanGelombang(0, T_PENUH, DURASI_MASUK)
        }
      })
      .catch((e: Error) => !batal && setGalat(e.message))

    return () => {
      batal = true
    }
    // `layer` SENGAJA tidak ada di sini. Warna awal dibaca lewat layerKini, dan
    // pergantian layer diurus efeknya sendiri di bawah - memasukkannya ke sini
    // berarti seluruh data diminta ulang hanya karena warnanya berganti.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `onPilihHeksagon` dan `onMuat` SENGAJA tidak ada di sini - keduanya dibaca
    // lewat ref. Memasukkannya berarti seluruh data diminta ulang, seluruh layer
    // dipasang ulang, dan satu penangan klik lagi menumpuk setiap kali identitas
    // callback-nya berubah.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kawasan, siap, gaya, jalankanGelombang])

  // Pembuka menyingkir: inilah saat gelombang pertama benar-benar ditonton.
  useEffect(() => {
    const m = peta.current
    if (!tampil || !m?.getLayer(L_ISI)) return
    void tungguTenang(m).then(() => {
      if (peta.current?.getLayer(L_ISI)) void jalankanGelombang(0, T_PENUH, DURASI_MASUK)
    })
    // Sengaja hanya bergantung pada `tampil`: efek ini adalah "pembuka baru
    // saja hilang", bukan "sesuatu berubah". Menambah dep lain membuatnya
    // memutar ulang gelombang di saat yang tidak diminta siapa pun.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tampil])

  // --- Ganti layer tematik tanpa memuat ulang data ---
  //
  // SURUT, ganti, MEKAR - tiga langkah, bukan satu. Versi sebelumnya mengganti
  // warnanya seketika lalu memekarkan opasitasnya dari nol: yang terlihat
  // heksagon yang berkedip - hilang satu bingkai, lalu tampil lagi dengan warna
  // lain. Sekarang layer lama surut ke tepi kawasan lebih dulu, warnanya
  // diganti saat tidak ada satu pun yang terlihat, lalu layer baru mekar dari
  // pusatnya. Dua gerakan yang berlawanan arah, dan itulah yang membuatnya
  // terbaca sebagai pergantian, bukan sebagai kedipan.
  //
  // Kalau layernya sedang MATI, warnanya cukup diganti diam-diam: tidak ada
  // yang bisa surut, dan gelombang di layer tersembunyi cuma pekerjaan sia-sia.
  const layerSebelum = useRef(layer)
  useEffect(() => {
    const m = peta.current
    if (!m?.getLayer(L_ISI)) return
    const ganti = () => {
      if (!peta.current?.getLayer(L_ISI)) return
      peta.current.setPaintProperty(L_ISI, 'fill-color', WARNA_LAYER[layer])
      // Angkanya ikut berganti arti: skor di layer kuadran, harga di PriceLens,
      // tanda izin di ZoneGuard.
      if (peta.current.getLayer(L_ANGKA)) {
        peta.current.setLayoutProperty(L_ANGKA, 'text-field', ANGKA_LAYER[layer])
      }
    }
    const berganti = layerSebelum.current !== layer
    layerSebelum.current = layer
    if (!berganti || !nyalaKini.current) {
      ganti()
      return
    }
    let batal = false
    void jalankanGelombang(T_PENUH, 0, 400).then(() => {
      if (batal) return
      ganti()
      void jalankanGelombang(0, T_PENUH, 820)
    })
    return () => {
      batal = true
    }
  }, [layer, siap, jalankanGelombang])

  // --- Saring kuadran dari Kompas ---
  //
  // Menyaring adalah perubahan paling drastis di layar ini: separuh lebih
  // heksagon lenyap dalam satu bingkai. Justru di sinilah gelombang paling
  // dibutuhkan, dan justru di sini ia sebelumnya tidak ada sama sekali.
  useEffect(() => {
    const m = peta.current
    if (!m?.getLayer(L_ISI)) return

    const pasangSaringan = () => {
      const f = saringKuadran
        ? (['==', ['get', 'kuadran'], saringKuadran] as ExpressionSpecification)
        : null
      m.setFilter(L_ISI, f)
      m.setFilter(L_GARIS, f)
      // Angka WAJIB ikut tersaring. Tanpa baris ini, heksagon yang disembunyikan
      // filter kuadran meninggalkan angkanya melayang di atas peta kosong.
      if (m.getLayer(L_ANGKA)) m.setFilter(L_ANGKA, f)
      if (m.getLayer(L_ARSIR)) {
        m.setFilter(
          L_ARSIR,
          saringKuadran
            ? ([
                'all',
                ['==', ['get', 'data_source'], 'predicted'],
                ['==', ['get', 'kuadran'], saringKuadran],
              ] as ExpressionSpecification)
            : (['==', ['get', 'data_source'], 'predicted'] as ExpressionSpecification),
        )
      }
    }

    // Efek ini juga berjalan saat gaya dimuat ulang, dengan saringan yang sama
    // persis. Menganimasikannya di situ berarti heksagon berkedip tanpa sebab.
    const berubah = saringLalu.current !== saringKuadran
    saringLalu.current = saringKuadran
    if (!berubah || !tampil) {
      pasangSaringan()
      return
    }

    let batal = false
    const jalan = async () => {
      await jalankanGelombang(T_PENUH, 0, 280)
      if (batal || !peta.current) return
      pasangSaringan()
      await jalankanGelombang(0, T_PENUH, 720)
    }
    void jalan()
    return () => {
      batal = true
    }
  }, [saringKuadran, siap, tampil, jalankanGelombang])

  // --- Rute jalan kaki ke stasiun terdekat ---
  //
  // Diambil untuk heksagon yang dipilih DAN untuk semua yang sedang
  // dibandingkan. Membandingkan lokasi tanpa membandingkan jalan menuju
  // stasiunnya berarti membandingkan angka tanpa melihat apa yang membuat
  // angkanya begitu - dan rute dua heksagon bertetangga bisa berbeda jauh
  // kalau ada rel di antaranya.
  //
  // Disimpan di Map dan tidak pernah dibuang selama komponennya hidup:
  // isinya sama untuk siapa pun dan cuma berubah kalau pipeline menghitung
  // ulang rutenya, jadi mengambil ulang heksagon yang sudah pernah dibuka cuma
  // menambah permintaan tanpa menambah satu pun informasi.
  //
  // KUNCINYA `profil|h3`, bukan `h3` saja. Bentuk lama menimpa satu entri tiap
  // kali profil berganti, jadi ingatan ini cuma pernah memuat satu profil pada
  // satu waktu - dan itu yang memaksa jawaban yang datang terlambat dibuang.
  const [konteks, setKonteks] = useState<Map<string, KonteksSimpul>>(new Map())
  const dimintaRef = useRef(new Set<string>())
  /** Profil yang BENAR-BENAR diminta. Motor menumpang jalur mobil, dan dua
   *  kunci berbeda untuk satu jawaban yang sama cuma menggandakan permintaan. */
  const profilNyata = profilUntukModa(profilRute)
  const kunciKt = useCallback((h: string) => `${profilNyata}|${h}`, [profilNyata])
  /** Komponennya masih terpasang. Lihat alasannya di efek pengambilan di bawah.
   *
   *  Badannya MENYALAKAN ulang benderanya, bukan cuma pembersihnya yang
   *  mematikan. StrictMode menjalankan efek dua kali - pasang, bersihkan,
   *  pasang - jadi bentuk yang hanya punya pembersih meninggalkan benderanya
   *  MATI selamanya sejak render pertama, dan setiap jawaban rute dibuang.
   *  Terjadi betulan, dan gejalanya persis bug yang sedang diperbaiki: tidak
   *  ada rute yang muncul sama sekali, tanpa satu pun galat. */
  const hidupRef = useRef(true)
  useEffect(() => {
    hidupRef.current = true
    return () => {
      hidupRef.current = false
    }
  }, [])

  const kunciBanding = dibandingkan.join(',')
  const perluRute = useMemo(() => {
    // Heksagon yang DIBANDINGKAN selalu dirutekan: membandingkan itu tindakan
    // yang sudah eksplisit, dan garisnya bagian dari jawabannya.
    const d = [...dibandingkan]
    // Yang DIPILIH hanya dirutekan kalau diminta. Mengklik satu heksagon
    // seharusnya membuka keterangannya, bukan langsung menimpa peta dengan
    // rute dan pita jangkauan yang belum tentu sedang dicari orangnya.
    if (rutaTampil && terpilih && !d.includes(terpilih)) d.push(terpilih)
    return d
  }, [terpilih, kunciBanding, rutaTampil]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Kunci ingatan "sudah diminta" memuat PROFILNYA.
    //
    // Tanpa itu, berganti ke mobil untuk heksagon yang rute jalan kakinya
    // sudah pernah diambil menghasilkan NOL permintaan baru: heksagonnya sudah
    // ada di daftar. Yang terlihat di layar rute jalan kaki yang tidak
    // berubah, dan tidak ada satu pun galat. Keluarga yang sama persis dengan
    // kunci cache backend yang dulu membuat dua heksagon berbagi satu jawaban.
    const belum = perluRute.filter((h) => !dimintaRef.current.has(kunciKt(h)))
    if (!belum.length) return
    belum.forEach((h) => dimintaRef.current.add(kunciKt(h)))
    Promise.all(
      belum.map((h) =>
        api
          .simpulTerdekat(h, profilNyata)
          .then((k) => [kunciKt(h), k] as const)
          .catch(() => {
            // Gagal sekali tidak boleh jadi gagal selamanya: heksagonnya
            // dilepas dari daftar "sudah diminta" supaya percobaan berikutnya
            // benar-benar mencoba lagi.
            dimintaRef.current.delete(kunciKt(h))
            return null
          }),
      ),
    ).then((hasil) => {
      // BUG NYATA yang diperbaiki 9 Sep 2026: "heksagon KEDUA yang dibandingkan
      // tidak pernah muncul rutenya".
      //
      // Di sini dulu berdiri bendera `batal` yang dinyalakan fungsi pembersih
      // efek ini. Niatnya benar - membuang jawaban basi - tetapi pasangannya
      // salah: daftar "sudah diminta" hidup di REF sehingga bertahan melewati
      // jalannya efek, sementara benderanya mati bersama jalan itu.
      //
      // Akibatnya berurutan persis begini. Mengklik heksagon kedua mengubah
      // `terpilih` DAN baki sekaligus, permintaannya berangkat. Sesaat kemudian
      // App menyetel `rutaTampil` kembali ke mati - memang begitu aturannya,
      // berpindah heksagon menutup rutenya - dan itu menjalankan ULANG efek
      // ini. Jalan lama dibersihkan (`batal = true`); jalan baru melihat
      // heksagonnya SUDAH ada di daftar lalu berhenti tanpa meminta apa pun.
      // Jawaban yang sedang di jalan tiba ke bendera batal dan dibuang, dan
      // tidak ada yang meminta ulang karena menurut daftar ia sudah diminta.
      // Yang terlihat pengguna: rute heksagon kedua TIDAK PERNAH muncul.
      //
      // Penggantinya cuma penjaga "komponennya masih hidup". Jawaban yang telat
      // tidak lagi bisa keliru: kuncinya memuat profil, jadi jawaban profil
      // lama mendarat di kotaknya sendiri dan tidak menimpa siapa pun.
      if (!hidupRef.current) return
      const ada = hasil.filter(Boolean) as (readonly [string, KonteksSimpul])[]
      if (ada.length) setKonteks((m) => new Map([...m, ...ada]))
    })
  }, [perluRute, profilNyata, kunciKt])

  // --- MODE FOKUS ---
  //
  // Tiga hal sekaligus, dan ketiganya harus berubah bersamaan supaya tidak
  // pernah ada bingkai di mana isian sudah hilang tetapi garisnya belum tebal:
  //
  //   1. Isian heksagon fokus dikalikan nol - basemap di bawahnya terlihat utuh
  //   2. Garis batasnya ditebalkan (L_PILIH)
  //   3. Lencana nomor untuk heksagon yang sedang dibandingkan
  useEffect(() => {
    const m = peta.current
    if (!m?.getLayer(L_PILIH)) return
    const fokus = fokusRef.current

    m.setFilter(L_PILIH, ['in', ['get', 'h3_index'], ['literal', fokus]])
    if (m.getLayer(L_ISI)) {
      m.setPaintProperty(
        L_ISI,
        'fill-opacity',
        kali(OPASITAS_LAYER[layer], gerbang(T_PENUH), fokus),
      )
    }
    // Arsir ikut dimatikan. Kalau tidak, heksagon fokus masih tertutup garis
    // miring dan "mode fokus" berhenti memperlihatkan apa pun.
    if (m.getLayer(L_ARSIR)) {
      m.setPaintProperty(L_ARSIR, 'fill-opacity', kali(0.5, gerbang(T_PENUH), fokus))
    }

    const sumber = m.getSource(SUMBER_FOKUS) as GeoJSONSource | undefined
    if (!sumber) return

    const menurutH3 = new Map(
      (dataRef.current?.features ?? []).map((f) => [String(f.properties?.h3_index), f]),
    )
    const fitur: unknown[] = []

    // Lencana nomor - HANYA saat membandingkan. Satu heksagon terpilih tidak
    // perlu diberi angka "1"; ia sudah jelas dari bingkainya.
    if (dibandingkan.length > 1) {
      dibandingkan.forEach((h3, i) => {
        const f = menurutH3.get(h3)
        const titik = f && titikTengah(f)
        if (titik) {
          fitur.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: titik },
            properties: { nomor: String(i + 1) },
          })
        }
      })
    }

    sumber.setData({ type: 'FeatureCollection', features: fitur } as never)
  }, [terpilih, kunciBanding, dibandingkan, layer, siap])

  // --- Kawasan jangkau simpul tujuan ---
  //
  // Diambil untuk simpul yang dituju heksagon terpilih, bukan untuk semua
  // simpul sekaligus. Enam isochrone di layar berarti enam belas poligon
  // bertumpuk yang tidak menjawab pertanyaan siapa pun; SATU isochrone
  // menjawab pertanyaan yang justru sedang ditanyakan - "heksagon ini masuk
  // pita berapa menit dari stasiunnya?"
  //
  // Di-cache di ref karena isinya cuma berubah kalau pipeline menghitung
  // ulang, dan enam simpul yang sama akan diminta berkali-kali sepanjang orang
  // mengklik heksagon.
  const isoRef = useRef(new Map<number, unknown>())
  // Kawasan jangkau ikut gerbang yang sama dengan rute: keduanya jawaban atas
  // pertanyaan yang sama, dan menampilkan salah satunya saja membuat peta
  // separuh menjawab.
  const nodeTujuan =
    rutaTampil && terpilih ? (konteks.get(kunciKt(terpilih))?.simpul?.id ?? null) : null

  useEffect(() => {
    const m = peta.current
    if (!m || !siap) return
    const sumber = m.getSource(SUMBER_ISO) as GeoJSONSource | undefined
    if (!sumber) return

    const kosong = { type: 'FeatureCollection', features: [] }
    if (nodeTujuan === null) {
      sumber.setData(kosong as never)
      return
    }

    const tersimpan = isoRef.current.get(nodeTujuan)
    if (tersimpan) {
      sumber.setData(tersimpan as never)
      return
    }

    let batal = false
    api
      .catchment({ node_id: nodeTujuan })
      .then((gj) => {
        if (batal) return
        isoRef.current.set(nodeTujuan, gj)
        // Pita terluas digambar DULU supaya yang tersempit ada di atasnya.
        // MapLibre menggambar fitur menurut urutan datanya, dan pita 5 menit
        // yang tertimbun garis 15 menit adalah pita yang paling ingin dilihat
        // orang tetapi paling tidak terlihat.
        const f = [...((gj as { features?: { properties?: { menit?: number } }[] }).features ?? [])]
        f.sort((a, b) => (b.properties?.menit ?? 0) - (a.properties?.menit ?? 0))
        sumber.setData({ type: 'FeatureCollection', features: f } as never)
      })
      .catch(() => {
        // Tabelnya boleh kosong - itu keadaan yang sah selama isochrone belum
        // dihitung. Yang tidak boleh: menggambar lingkaran sebagai gantinya.
        if (!batal) sumber.setData(kosong as never)
      })
    return () => {
      batal = true
    }
  }, [nodeTujuan, siap])

  // --- Menggambar rute, beserta animasinya ---
  //
  // KENAPA rAF DI SINI padahal gelombang heksagon justru menghindarinya. Yang
  // mahal di gelombang itu `setPaintProperty` pada layer ISIAN: MapLibre
  // mengurai ulang ekspresinya lalu menilainya ulang untuk 708 fitur di setiap
  // ubin. Di sini yang ditulis `setData` pada sumber berisi paling banyak
  // belasan garis - tidak ada ekspresi yang dinilai ulang, dan tidak ada ubin
  // yang dibangun ulang. Ongkosnya beda kelas, jadi keputusannya pun berbeda.
  //
  // Rutenya TUMBUH dari heksagon menuju stasiun, bukan muncul sekaligus. Arah
  // itu yang bikin orang langsung paham garisnya menjawab "dari sini, ke sana"
  // - bukan sebaliknya, dan bukan sekadar hiasan yang kebetulan menghubungkan
  // dua benda.
  const rafRute = useRef(0)
  /** Jam arus rute. setInterval, BUKAN rAF: 14 langkah/detik sudah halus
   *  untuk mata, dan rAF akan menjalankannya 60 kali - empat kali ongkos
   *  untuk gerak yang sama. */
  const kunciKonteks = perluRute
    .map((h) => `${h}:${konteks.get(kunciKt(h))?.rute.length ?? -1}`)
    .join('|')

  useEffect(() => {
    const m = peta.current
    if (!m || !siap) return
    const sumber = m.getSource(SUMBER_RUTE) as GeoJSONSource | undefined
    if (!sumber) return

    const kosong = { type: 'FeatureCollection', features: [] }
    const berhenti = () => {
      if (rafRute.current) cancelAnimationFrame(rafRute.current)
      rafRute.current = 0
    }
    berhenti()

    // Saat membandingkan, TIAP heksagon cuma menyumbang rute utamanya. Empat
    // heksagon dengan alternatifnya masing-masing berarti dua belas garis di
    // satu layar, dan pada titik itu tidak ada satu pun yang bisa diikuti mata.
    // Alternatif menjawab "lewat mana lagi dari SINI" - pertanyaan satu lokasi.
    const membandingkan = dibandingkan.length > 1
    const jalur: {
      k: [number, number][]
      kum: number[]
      warna: string
      label: string
      utama: boolean
      profil: string
    }[] = []
    const ujung: unknown[] = []

    perluRute.forEach((h3) => {
      const kt = konteks.get(kunciKt(h3))
      if (!kt || !kt.rute.length) return
      const i = dibandingkan.indexOf(h3)
      const warna = membandingkan && i >= 0 ? WARNA_RUTE[i % WARNA_RUTE.length] : WARNA_RUTE_TUNGGAL(gaya)
      const dipakai: RuteJalan[] = membandingkan ? kt.rute.slice(0, 1) : kt.rute
      dipakai.forEach((r) => {
        const k = r.koordinat as [number, number][]
        if (k.length < 2) return
        jalur.push({
          k,
          kum: panjangKumulatif(k),
          warna,
          utama: r.utama,
          // Dibaca dari RUTENYA, bukan dari profil yang diminta. Bedanya baru
          // terasa kalau suatu saat satu respons memuat dua profil sekaligus -
          // dan pada saat itu gaya garis yang disimpulkan dari parameter
          // permintaan akan menggambar keduanya sama.
          profil: r.profil ?? 'foot-walking',
          // HANYA rute utama yang berlabel.
          //
          // Alternatif sempat ikut diberi "lewat sini - N mnt", dan hasilnya
          // terlihat di potret: satu heksagon dengan dua alternatif
          // menumpuk TIGA gelembung di titik tengah yang berdekatan, dan
          // ketiganya jadi tidak terbaca. Menumpuk tiga jawaban untuk satu
          // pertanyaan bukan tiga kali lebih informatif.
          //
          // Alternatif memang bukan jawabannya - itu sebabnya ia digambar
          // tipis dan redup - dan menitnya sudah disebut panel di kalimat
          // "N jalur alternatif tergambar di peta".
          label: r.utama ? `${jarakSingkat(r.jarak_m)} · ${Math.round(r.menit)} mnt` : '',
        })
      })
      ujung.push(
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [kt.lon, kt.lat] },
          properties: { jenis: 'pin', warna, tujuan: false },
        },
        ...(kt.simpul
          ? [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [kt.simpul.lon, kt.simpul.lat] },
                properties: { jenis: 'pin', warna, tujuan: true },
              },
            ]
          : []),
      )
    })

    if (!jalur.length) {
      sumber.setData(kosong as never)
      return
    }

    // BUG NYATA yang diperbaiki 9 Sep 2026: gelembung jarak+waktu tidak pernah
    // muncul di peta, padahal teksnya sudah dirakit dengan benar.
    //
    // Sebabnya `symbol-placement: 'line-center'`. Ia menempelkan label pada
    // GARIS, dan MapLibre menolak menempatkannya begitu label itu diminta tegak
    // (`text-rotation-alignment: 'viewport'`) - yang justru harus diminta,
    // karena tanpa itu gelembungnya ikut miring mengikuti ruas jalan dan
    // isinya jadi tulisan tegak lurus yang tidak terbaca. Dua syarat yang
    // saling meniadakan, dan kegagalannya DIAM: tidak ada galat, cuma label
    // yang tidak pernah ada.
    //
    // Yang dipakai sekarang TITIK tersendiri di tengah rute. Penempatan titik
    // tidak pernah memutar apa pun, jadi tidak ada lagi syarat yang harus
    // dilanggar - dan tengahnya dihitung dari panjang kumulatif yang sudah
    // dipakai animasinya, bukan ditebak dari indeks simpulnya.
    const garis = (potong: (j: (typeof jalur)[number], i: number) => [number, number][], berlabel: boolean) => ({
      type: 'FeatureCollection',
      features: [
        ...jalur.map((j, i) => ({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: potong(j, i) },
          properties: {
            jenis: 'garis',
            warna: j.warna,
            utama: j.utama,
            profil: j.profil,
          },
        })),
        ...ujung,
        // Label ditahan sampai garisnya sampai. Label yang ikut bergeser
        // bersama ujung yang sedang tumbuh terbaca sebagai teks yang lari.
        ...(berlabel
          ? jalur
              .filter((j) => j.utama)
              .map((j) => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: titikPada(j.k, j.kum, 0.5) },
                properties: { jenis: 'label', warna: j.warna, utama: true, label: j.label },
              }))
          : []),
      ],
    })

    // Arus: satu setPaintProperty per langkah, pada layer berisi <=4 fitur.
    // Menggantikan titik berjalan yang dulu menghitung posisi tiap rute tiap
    // bingkai lalu menulis ulang seluruh GeoJSON-nya.

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      sumber.setData(garis((j) => j.k, true) as never)
      return () => berhenti()
    }

    const t0 = performance.now()
    const total = GAMBAR_MS + UNDAK_MS * (jalur.length - 1)
    const maju = () => {
      const lewat = performance.now() - t0
      sumber.setData(
        garis((j, i) => {
          const pp = Math.min(1, Math.max(0, (lewat - i * UNDAK_MS) / GAMBAR_MS))
          // Melambat di ujung, sama dengan gelombang heksagon: laju tetap
          // terbaca sebagai penggaris yang bergeser, bukan sebagai sesuatu yang
          // mendarat.
          return potongJalur(j.k, j.kum, 1 - Math.pow(1 - pp, 3))
        }, false) as never,
      )
      if (lewat < total) {
        rafRute.current = requestAnimationFrame(maju)
      } else {
        sumber.setData(garis((j) => j.k, true) as never)
      }
    }
    rafRute.current = requestAnimationFrame(maju)

    return () => berhenti()
    // `profilNyata` ikut jadi dep: sesudah kunci ingatan memuat profil,
    // berganti moda ke profil yang SUDAH tersimpan tidak lagi mengubah
    // identitas `konteks` maupun `kunciKonteks` - dan tanpa dep ini petanya
    // diam memegang gambar profil sebelumnya.
  }, [kunciKonteks, perluRute, konteks, dibandingkan, gaya, siap, profilNyata, kunciKt])

  // --- Aksi yang dipanggil dari luar, termasuk oleh AI ---
  useImperativeHandle(
    ref,
    (): AksiPetaRef => ({
      zoomIn: () => peta.current?.zoomIn({ duration: 320 }),
      zoomOut: () => peta.current?.zoomOut({ duration: 320 }),

      flyTo: (lat, lon, zoom = 15) =>
        peta.current?.flyTo({ center: [lon, lat], zoom, duration: 900 }),

      fitBounds: (kotak) =>
        peta.current?.fitBounds(kotak, { padding: 60, duration: 900 }),

      setPin: (daftar) => {
        const m = peta.current
        if (!m) return
        for (const p of pinAktif.current) p.remove()
        pinAktif.current = daftar.map(({ lat, lon, h3 }) => {
          const el = document.createElement('button')
          el.className = 'pin-simpan'
          el.title = `Lokasi tersimpan ${h3.slice(0, 10)}…`
          el.setAttribute('aria-label', el.title)
          // Glif bookmark digambar inline: berkas ini tidak boleh menambah aset.
          el.innerHTML =
            '<svg width="13" height="13" viewBox="0 0 20 20" aria-hidden="true">' +
            '<path d="M5.5 3.5h9V17L10 13.6 5.5 17Z" fill="currentColor"/></svg>'
          return new Marker({ element: el, anchor: 'bottom' })
            .setLngLat([lon, lat])
            .addTo(m)
        })
      },

      resetArah: () =>
        peta.current?.easeTo({ bearing: 0, pitch: 0, duration: 600 }),

      arah: () => ({
        bearing: peta.current?.getBearing() ?? 0,
        pitch: peta.current?.getPitch() ?? 0,
      }),

      /**
       * Terbang ke satu heksagon dan membingkainya.
       *
       * Geometrinya dicari di DATA YANG SUDAH DIMUAT (`dataRef`), bukan lewat
       * `querySourceFeatures`. Bedanya menentukan, dan ini bug yang dilaporkan
       * pemilik repo: `querySourceFeatures` hanya mengembalikan fitur dari ubin
       * yang SEDANG dirender. Heksagon yang diklik dari daftar atau dari tab
       * "Untuk Anda" hampir selalu berada di luar layar - itu justru sebabnya
       * ia diklik - jadi kuerinya pulang kosong dan petanya diam saja. Tidak
       * ada galat, tidak ada gerakan, dan yang terlihat tombol yang rusak.
       *
       * Kalau datanya memang belum sampai (baru berganti kawasan), ia MENUNGGU
       * pemuatan berikutnya alih-alih menyerah - maksimal tiga detik.
       */
      fokusHeksagon: (h3) => {
        const m = peta.current
        if (!m) return

        const bingkai = () => {
          const f =
            dataRef.current?.features.find((x) => x.properties?.h3_index === h3) ??
            (m.getSource(SUMBER)
              ? (m.querySourceFeatures(SUMBER, {
                  filter: ['==', ['get', 'h3_index'], h3] as ExpressionSpecification,
                })[0] as unknown as FiturHex | undefined)
              : undefined)
          const cincin = f?.geometry?.coordinates?.[0]
          if (!cincin?.length) return false
          let [w, sLat, e, n] = [Infinity, Infinity, -Infinity, -Infinity]
          for (const [x, y] of cincin) {
            if (x < w) w = x
            if (x > e) e = x
            if (y < sLat) sLat = y
            if (y > n) n = y
          }
          // Bantalan besar: heksagon yang memenuhi layar tidak bisa dibaca dalam
          // konteks tetangganya, dan konteks itulah gunanya peta ini.
          m.fitBounds([w, sLat, e, n], { padding: 220, duration: 900, maxZoom: 15.4 })
          return true
        }

        if (bingkai()) return
        const batas = window.setTimeout(() => m.off('sourcedata', coba), 3000)
        function coba() {
          if (bingkai()) {
            window.clearTimeout(batas)
            m?.off('sourcedata', coba)
          }
        }
        m.on('sourcedata', coba)
      },

      highlight: (hexIds) => {
        if (peta.current?.getLayer(L_PILIH)) {
          peta.current.setFilter(L_PILIH, ['in', ['get', 'h3_index'], ['literal', hexIds]])
        }
      },

      filter: (kriteria) => {
        const m = peta.current
        if (!m?.getLayer(L_ISI)) return
        const syarat: ExpressionSpecification[] = []
        if (typeof kriteria?.min_score === 'number') {
          syarat.push(['>=', ['get', 'opportunity_score'], kriteria.min_score])
        }
        if (kriteria?.kuadran) syarat.push(['==', ['get', 'kuadran'], kriteria.kuadran])
        const f = syarat.length ? (['all', ...syarat] as ExpressionSpecification) : null
        m.setFilter(L_ISI, f)
        m.setFilter(L_GARIS, f)
        if (m.getLayer(L_ANGKA)) m.setFilter(L_ANGKA, f)
      },
    }),
    [],
  )

  return (
    <div className="relative h-full w-full">
      {/* Tinggi diberi lewat h-full, BUKAN lewat absolute+inset-0.
          Alasannya konkret: maplibre-gl.css mendeklarasikan
          `.maplibregl-map { position: relative }` dengan spesifisitas yang sama
          dengan `.absolute` milik Tailwind, dan ia dimuat belakangan - jadi ia
          menang, `inset-0` berhenti memberi tinggi, dan wadahnya jadi nol tanpa
          satu pun galat di konsol. Peta ter-inisialisasi, kontrol muncul, tetapi
          tidak ada yang terlihat. */}
      <div ref={wadah} className="h-full w-full" />

      {/* Simpul transit. Ini produk transit-oriented, dan peta tanpa stasiun
          menghilangkan titik acuan yang membuat seluruh skor punya arti.

          Bentuknya meminjam kosakata rambu stasiun: kotak bermoda, bukan pin
          generik yang bisa berarti apa saja. */}
      <PenandaSimpul peta={peta} simpul={simpul} siap={siap} />

      {/* Kartu sorot mengikuti kursor di sudut, bukan tooltip melayang.
          Tooltip yang menempel pada kursor menutupi heksagon di sebelahnya —
          persis yang sedang dibandingkan pengguna. */}
      {sorot && (
        // Tengah atas, tapi DI BAWAH bilah atas - bukan sejajar dengannya.
        // Pada top-3 ia berdiri di garis yang sama dengan kotak pencarian dan
        // menu kawasan, dan dua lapisan chrome yang sejajar terbaca sebagai satu
        // bilah yang berantakan. 5,75rem menaruhnya tepat di bawah bilah itu
        // (tinggi bilah + bantalan lapisan), dengan celah yang terlihat sengaja.
        <div className="kaca pop pointer-events-none absolute left-1/2 top-[5.75rem] z-10 flex -translate-x-1/2 items-center gap-3.5 rounded-full px-5 py-2.5">
          <p className="papan tabular text-[26px] leading-none">
            {sorot.opportunity_score?.toFixed(0) ?? '—'}
          </p>
          {/* Indeks H3 sengaja TIDAK di sini. Lima belas karakter heksadesimal
              tidak menolong siapa pun yang sedang menyapukan kursor di atas
              peta - yang ia butuhkan cuma tahu ini di mana. Indeksnya tetap ada
              di panel detail, tempat orang memang sedang menelusuri satu
              lokasi tertentu. */}
          <p className="text-[12.5px] leading-tight text-ink-3">
            Opportunity Score
            <span className="block text-[11.5px] font-medium text-ink-2">{sorot.kawasan}</span>
          </p>
          <p className="flex items-center gap-1.5 border-l border-line pl-3.5 text-[13.5px] text-ink-2">
            <span className="flex flex-col leading-tight">
              <span className="font-semibold" style={{ color: sorot.kuadran ? KUADRAN[sorot.kuadran].warna : undefined }}>
                {sorot.kuadran ? namaZona(sorot.kuadran) : teksZona.belum}
              </span>
              {sorot.kuadran && (
                <span className="text-[11.5px] text-ink-3">
                  {bahasa === 'en' ? KUADRAN[sorot.kuadran].ringkasEn : KUADRAN[sorot.kuadran].ringkas}
                </span>
              )}
            </span>
            {sorot.data_source === 'predicted' && (
              <span className="arsir h-2.5 w-2.5 rounded-[2px] border border-line-2 text-ink-3" />
            )}
          </p>
        </div>
      )}

      {/* ================= Tumpukan kiri atas ==========================

          Peringatan ubin PINDAH ke sini dari tengah-bawah (3 Sep 2026,
          permintaan pemilik repo). Di tengah bawah ia menutupi pil layer, baki
          komparasi, dan ajakan simulasi sekaligus - tiga hal yang justru sedang
          dipakai orang saat peringatannya muncul.

          Kiri atas juga tempat yang benar secara arti: keduanya - layer yang
          kosong dan ubin yang menolak - menjawab pertanyaan yang sama, "kenapa
          yang saya lihat begini". Menaruhnya bersebelahan membuat keduanya
          terbaca sebagai satu keluarga, bukan dua kejadian yang tidak
          berhubungan.

          `top-4` semula - dan itu bug NYATA, bukan cuma kurang rapi: bilah
          logo + pencarian di App.tsx duduk di atas peta yang sama pada posisi
          hampir identik, jadi tumpukan ini lahir TERTIMBUN sejak bingkai
          pertama. `top-[5.75rem]` bukan angka tebakan - itu offset yang SUDAH
          dipakai pil info layer beberapa baris di bawah untuk masalah yang
          persis sama, jadi keduanya sekarang sejajar dan sama-sama di bawah
          bilah atas. */}
      <div className="pointer-events-none absolute left-4 top-[5.75rem] z-10 flex max-w-[calc(100%-2rem)] flex-col items-start gap-2 sm:max-w-[24rem]">
        {/* --- Layer ini punya berapa data ---------------------------------

            Muncul HANYA kalau cakupannya di bawah separuh. Pemberitahuan yang
            selalu ada berhenti dibaca, dan Opportunity - satu-satunya layer yang
            708/708 - tidak pernah perlu menjelaskan dirinya.

            Angkanya dihitung dari fitur yang termuat, jadi ia menghilang sendiri
            begitu sumbernya masuk. Tidak ada yang perlu ingat memperbaruinya. */}
        {cakupan && cakupan.total > 0 && cakupan.terisi < cakupan.total / 2 && (
          <div
            role="status"
            className={`kaca pop pointer-events-auto rounded-md px-3.5 py-2.5 ${
              cakupan.terisi === 0 ? 'border-l-[3px] border-l-bahaya' : ''
            }`}
          >
            <p className="text-[12.5px] font-semibold text-ink">
              {cakupan.terisi === 0
                ? teksZona.layerKosong(bahasa === 'en' ? cakupan.bendaEn : cakupan.benda)
                : teksZona.layerSebagian(
                    cakupan.terisi,
                    cakupan.total,
                    bahasa === 'en' ? cakupan.bendaEn : cakupan.benda,
                  )}
            </p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-ink-2">
              {cakupan.terisi === 0
                ? teksZona.nolDari(cakupan.total)
                : 'Sisanya digambar abu: belum terukur, bukan bernilai rendah.'}
            </p>
          </div>
        )}

      {/* Chip ringkas. Yang terlihat sepanjang sisa pemadaman.

          Ia menggantikan panel penuh sesudah sembilan detik, dan itu satu-
          satunya bentuk yang memenuhi dua hal yang saling bertentangan:
          peringatan ini WAJIB tetap ada (peta abu-abu tanpa keterangan pernah
          terjadi dan lebih buruk), tetapi ia TIDAK boleh menghalangi peta
          selama belasan menit. Sisa percobaan otomatis ikut di sini supaya
          orang tahu sesuatu masih berjalan tanpa harus membukanya lagi. */}
      {galatPeta?.ubin && tiraiUbin === 'ringkas' && (
        <button
          onClick={() => setTiraiUbin('penuh')}
          className="kaca pop pointer-events-auto flex w-fit cursor-pointer items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-medium text-ink-2 transition-transform duration-200 ease-jelly hover:scale-[1.04]"
        >
          <span className="denyut h-1.5 w-1.5 shrink-0 rounded-full bg-bahaya" aria-hidden />
          {teksZona.ubinRingkas}
          <span className="text-ink-3">
            {percobaanUbin > 0 ? teksZona.ubinSisa(percobaanUbin) : teksZona.ubinHabis}
          </span>
        </button>
      )}

      {galatPeta && (tiraiUbin === 'penuh' || !galatPeta.ubin) && (
        <div
          role="alert"
          // bottom-24, bukan bottom-4: kaki peta sudah ditempati pil pertanyaan
          // layer / ajakan simulasi / baki komparasi, dan pesan ini lebih
          // tinggi daripada versi satu-barisnya. Ditaruh di atas keduanya.
          className="kaca pop pointer-events-auto relative max-w-[22rem] rounded-md px-4 py-3"
        >
          {galatPeta.ubin && (
            <button
              onClick={() => setTiraiUbin('ringkas')}
              aria-label="Kecilkan peringatan"
              className="absolute right-2 top-2 grid h-6 w-6 cursor-pointer place-items-center rounded-full text-ink-3 transition-colors hover:bg-ground-2 hover:text-ink"
            >
              <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
                <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          )}
          {/* Dua kegagalan, dua kalimat.

              Versi sebelumnya selalu menulis "Basemap gagal dimuat" lalu
              menyarankan "pilih basemap lain". Saran itu KELIRU untuk kasus
              yang paling sering terjadi: keempat gaya menarik ubin dari
              `basemap.mapid.io/data/mapidtiles` yang sama persis, jadi orang
              yang menurutinya akan mencoba keempatnya dan gagal keempat kali -
              lalu menyimpulkan aplikasinya yang rusak.

              Terukur saat pemadaman: ubin menolak SEMUA bentuk otentikasi
              (dengan kunci pun 401), sementara `styles/*` menjawab 200 dengan
              kunci yang sama dan `fonts/*` 200 tanpa kunci. Jadi kuncinya sah
              dan yang padam sisi MAPID. */}
          <p className="pr-7 text-[13.5px] font-semibold text-bahaya">
            {galatPeta.ubin ? teksZona.ubinJudul : teksZona.basemapJudul}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
            {galatPeta.ubin
              ? teksZona.ubinIsi
              : galatPeta.pesan}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
            {galatPeta.ubin
              ? teksZona.ubinLanjut
              : teksZona.basemapLanjut}
          </p>
          {galatPeta.ubin && (
            <>
              {/* Tombolnya ADA walaupun sudah ada percobaan otomatis. Yang
                  otomatis berjarak semenit; orang yang melihat petanya abu-abu
                  tidak akan menunggu semenit tanpa satu pun yang bisa ditekan. */}
              <button
                onClick={() => {
                  jendelaUbin.current = performance.now() + 12_000
                  setMuatUlang((n) => n + 1)
                }}
                className="mt-2 cursor-pointer rounded-full bg-ink px-3.5 py-1.5 text-[12px] font-semibold text-surface transition-transform duration-200 ease-jelly hover:scale-[1.04]"
              >
                {teksZona.cobaLagi}
              </button>
              {/* Menyebutkan bahwa petanya SEDANG mencoba sendiri.
                  Sebelumnya di sini tercetak galat MapLibre mentah, dan
                  akibatnya dua-duanya buruk sekaligus: yang terbaca cuma
                  jargon, sementara satu-satunya hal yang benar-benar perlu
                  diketahui pembacanya - bahwa ia tidak harus menunggui
                  tombolnya - tidak disebutkan sama sekali. */}
              <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">
                {percobaanUbin > 0
                  ? teksZona.otomatis(percobaanUbin)
                  : teksZona.otomatisHabis}
              </p>
            </>
          )}
        </div>
      )}
      </div>

      {galat && (
        <div
          role="alert"
          className="absolute bottom-4 left-1/2 z-10 max-w-md -translate-x-1/2 rounded-md border border-bahaya/30 bg-bahaya-soft px-4 py-3 text-[15px] text-bahaya shadow-[0_18px_40px_-14px_rgb(22_33_28/0.35)] lg:left-[calc(50%-13rem)]"
        >
          <p className="font-semibold">Layer heksagon gagal dimuat</p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{galat}</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
            Kalau tertulis “Failed to fetch”, backend-nya belum jalan:{' '}
            <span className="font-mono text-[12.5px]">cd backend</span>, lalu{' '}
            <span className="font-mono text-[12.5px]">uvicorn app.main:app --reload</span>.
          </p>
        </div>
      )}
    </div>
  )
})

/**
 * Penanda simpul yang mengikuti kamera peta.
 *
 * Diposisikan ulang tiap kali peta bergerak lewat project(). Marker bawaan
 * MapLibre juga bisa, tetapi ia membungkus isinya dengan DOM sendiri yang lebih
 * sulit diberi gaya dan tidak menerima fokus keyboard secara wajar.
 */
function PenandaSimpul({
  peta,
  simpul,
  siap,
}: {
  peta: React.RefObject<MapLibreMap | null>
  simpul: SimpulTransit[]
  siap: boolean
}) {
  const [, paksaGambar] = useState(0)

  useEffect(() => {
    const m = peta.current
    if (!m || !siap) return
    const gambar = () => paksaGambar((n) => n + 1)
    m.on('move', gambar)
    gambar()
    return () => {
      m.off('move', gambar)
    }
  }, [peta, siap, simpul])

  const m = peta.current
  if (!m || !siap || simpul.length === 0) return null

  return (
    <>
      {simpul.map((s) => {
        const t = m.project([s.lon, s.lat])
        return (
          <div
            key={s.id}
            className="pointer-events-none absolute z-[5] -translate-x-1/2 -translate-y-1/2"
            style={{ left: t.x, top: t.y }}
          >
            <div className="flex items-center gap-1.5">
              <span
                className="grid h-5 w-5 place-items-center rounded-[3px] bg-ink text-[11px] font-bold tracking-tight text-surface shadow-[0_0_0_2px_var(--color-surface)]"
                aria-hidden
              >
                {s.moda === 'TERMINAL' ? 'T' : s.moda.slice(0, 1)}
              </span>
              <span className="whitespace-nowrap rounded-xs bg-surface/92 px-1.5 py-[2px] text-[12.5px] font-semibold shadow-[0_1px_3px_rgb(22_33_28/0.14)] backdrop-blur-sm">
                {s.nama}
                <span className="ml-1 font-normal text-ink-3">{s.moda}</span>
              </span>
            </div>
          </div>
        )
      })}
    </>
  )
}

export default PetaInteraktif
