/**
 * Bagian wajib 2 dari 3: Insight / Analisis.
 *
 * Menampilkan hasil, tidak pernah menghitung. Setiap angka di sini berasal dari
 * `location_scores` yang diisi `pipeline/s6_score.py`. Kalau suatu saat ada
 * aritmetika skor muncul di berkas ini, itu bug.
 *
 * Urutan bagiannya mengikuti urutan pertanyaan yang benar-benar ditanyakan calon
 * penyewa, bukan urutan tabel di basis data:
 *
 *   1. Boleh tidak buka usaha di sini?      ZoneGuard — kalau tidak, sisanya sia-sia
 *   2. Seberapa bagus lokasinya?            Skor + kuadran
 *   3. Berapa sewanya, wajar tidak?         PriceLens
 *   4. Kapan ramainya?                      Commuter Clock
 *   5. Ada yang perlu diwaspadai?           RiskRadar
 *   6. Kenapa skornya segitu?               Faktor
 *
 * ZoneGuard di urutan pertama bukan kebetulan. Kalau zonanya melarang, seluruh
 * angka di bawahnya tidak relevan, dan menaruhnya di bawah berarti membiarkan
 * orang membaca enam bagian sebelum tahu lokasinya tidak boleh dipakai.
 */

import { useEffect, useState } from 'react'

import { KUADRAN, TINGGI_BAIK, frasaPrestise, keKalimat, kodeLokasi } from '../config'
import { api, GalatAPI } from '../lib/api'
import { angka, jarakSingkat, rupiah } from '../lib/format'
import { URUTAN_PROFIL } from '../types'
import type {
  CommuterClock,
  DetailHeksagon,
  KonteksSimpul,
  PriceLensHeksagon,
  ProfilRute,
} from '../types'
import BarHarga from './BarHarga'
import ChartJam from './ChartJam'
import { useSesi } from './Akun'
import { BagianRiwayat } from './Premium'
import {
  Ajakan,
  Angka,
  Badge,
  Bagian,
  Baris,
  ChipKuadran,
  Kosong,
  Rinci,
  Terkunci,
  Memuat,
} from './primitif'

import { useIstilah, useTeks } from '../lib/bahasa'

/**
 * Kalimat panel ini, dua bahasa.
 *
 * Yang TIDAK ada di sini, dan itu disengaja: `zoneguard.penjelasan`,
 * `jam.catatan`, `risiko.label`, `detail.kuadran_penjelasan`, dan tiap pesan
 * galat backend. Semuanya dirakit backend dari angka heksagon itu sendiri;
 * menyalinnya ke sini berarti membuat versi kedua yang cepat atau lambat
 * berselisih dengan yang dicetak Laporan PDF dan diucapkan Konsultan AI.
 *
 * Nama produk - Loconomics, PriceLens, ZoneGuard, RiskRadar, Commuter Clock,
 * Opportunity Score, NJOP, RDTR - sama di kedua bahasa. Ia nama, bukan kata.
 */
const K = {
  id: {
    pilihJudul: 'Pilih satu heksagon',
    pilihIsi:
      'Klik heksagon mana pun di peta untuk melihat skornya, harga sewanya, dan kapan lokasi itu ramai.',
    gagalHeks: 'Gagal memuat heksagon',
    gagalMuat: 'Gagal memuat.',
    ajakanPremium: 'Bagian ini terbuka untuk pelanggan Loconomics Premium.',
    ajakanMasuk: 'Buat akun dulu, lalu buka seluruh kedalaman datanya.',
    gabung: 'Gabung Loconomics Premium',
    atauToken: 'atau buka lokasi ini saja dengan 1 token',
    peringkat: (n: number) => ` · peringkat ${n}`,
    lihatKuadran: 'Lihat posisinya di diagram kuadran',

    menujuJudul: 'Cara menuju ke sini',
    sembunyiRute: 'Sembunyikan rute & jangkauan',
    tampilRute: 'Tampilkan rute & jangkauan',
    moda: { kaki: 'Jalan kaki', mobil: 'Mobil', sepeda: 'Sepeda' },
    belumDitarik: 'belum ditarik',
    mnt: 'mnt',

    bandingPremium: 'Komparasi berdampingan bagian dari Loconomics Premium.',
    bandingMasuk: 'Buat akun dulu untuk membandingkan beberapa lokasi.',
    diBaki: 'Ada di baki banding',
    bandingkan: 'Bandingkan lokasi ini',
    sudahSimpan: 'Lokasi tersimpan',
    simpan: 'Simpan lokasi',
    simpanMasuk: 'Buat akun dulu untuk menyimpan lokasi.',
    simpanPremium: 'Menyimpan dan memantau lokasi bagian dari Loconomics Premium.',
    simpanOke:
      'Lokasi tersimpan dan skornya dibekukan — perubahan berikutnya dilaporkan di menu Tersimpan.',
    simpanGagal: 'Gagal menambahkan pantauan.',
    unduhLaporan: 'Unduh Laporan Kelayakan (PDF)',
    laporanMasuk: 'Buat akun dulu untuk mengunduh Laporan Kelayakan.',
    laporanOke: 'Laporan Kelayakan terunduh.',
    laporanGagal: 'Gagal mengunduh laporan.',
    bukaOke: 'Lokasi ini terbuka permanen untuk akun Anda.',
    bukaGagal: 'Gagal membuka lokasi.',
    membuka: 'Membuka…',
    bukaToken: (sisa: number) => `Buka lokasi ini saja — 1 token (${sisa} tersisa)`,
    simulasiJudul: 'Simulasi usaha di sini',
    simulasiIsi: 'Omzet, sewa, dan titik impas dari angka heksagon ini',

    menit: 'menit',
    berkendara: 'berkendara',
    jalanKaki: 'jalan kaki',
    bersepeda: 'bersepeda',
    keArah: 'ke',
    lewatJalan: 'lewat jalan yang ada',
    memutar: (x: string) => `${x}x lebih jauh dari kelihatannya di peta`,
    memutarEkor: '. Ada yang menghalangi jalan langsungnya.',
    alternatif: (n: number) => ` ${n} jalur alternatif tergambar di peta.`,
    // Bahasa Indonesia tidak menjamakkan bendanya, bahasa Inggris menjamakkan.
    // Menyalin kalimat yang sama apa adanya menghasilkan "1 alternative routes",
    // dan satu huruf s yang salah membuat seluruh panel terbaca hasil mesin.

    zonaBoleh: 'ZoneGuard — zona mengizinkan usaha',
    kelasZona: (k: string) => ` · kelas ${k}`,
    zonaLarang: 'ZoneGuard — tidak boleh dipakai usaha',
    zonaKosong: 'Belum ada RDTR digital',
    zonaKosongIsi: 'Status izinnya belum bisa dipastikan. Skor tetap dihitung.',
    artinyaApa: 'Apa artinya buat saya?',

    hargaJudul: 'PriceLens — harga sewa',
    hargaKunciJudul: 'Rincian harga lokasi ini',
    hargaKunciIsi:
      'Sewa per m² dan posisinya di rentang wajar kawasan, sewa per bulan, belanja per jam, dan NJOP.',
    hb: {
      sewa: 'Sewa per bulan',
      sewaB: 'P05 — angka yang tertulis di spanduk sewa',
      jam: 'Uang berpindah per jam',
      jamB: 'B10 — total nominal struk dibagi jam operasional',
      porsi: 'Harga makanan per porsi',
      porsiB: 'B07 — dari daftar menu yang disurvei',
      njop: 'NJOP',
      njopB: 'P01 — pembanding independen',
    },
    hargaKosong: (semua: boolean, daftar: string) =>
      `${semua ? 'Belum ada' : 'Belum ada juga'} ${daftar} di lokasi ini.`,
    kenapaBelum: 'Kenapa belum ada?',
    kenapaNjop:
      'NJOP tidak diterbitkan terbuka oleh Bapenda; sisanya menunggu survei lapangan — ketiganya hanya bisa dicatat orang yang berdiri di lokasinya.',
    kenapaSurvei: 'Ketiganya hanya bisa dicatat orang yang berdiri di lokasinya.',
    hargaTakAda: 'Data harga belum tersedia untuk heksagon ini',

    jamJudul: 'Commuter Clock — kapan uang berpindah',
    captive: 'Didominasi captive',
    choice: 'Didominasi choice',
    seimbang: 'Seimbang',
    jamKunciJudul: 'Pola jam lokasi ini',
    jamKunciIsi:
      'Grafik 18 jam: kapan uangnya berpindah, jam puncaknya, dan pembagian captive vs choice rider.',
    palingRamai: 'Paling ramai pukul',
    jamCaptive:
      'Arusnya menumpuk dua kali sehari dan sepi di antaranya — cocok untuk usaha yang cepat melayani.',
    jamChoice:
      'Arusnya lebih rata sepanjang hari — cocok untuk usaha yang butuh orang berlama-lama.',
    jamSeimbang: 'Arusnya tidak condong ke salah satu jenis penumpang.',
    jamTakAda: 'Belum ada jam transaksi yang tercatat.',
    jamNolJudul: 'Belum ada satu pun jam transaksi tercatat.',
    jamNolIsi:
      'Pola jam dibaca dari waktu yang tercetak di struk. Struk survei MAPID tidak membawa kolom waktu — jamnya ada di dalam foto struknya, dan pembacaan otomatis foto belum dijalankan. Sampai itu ada, tidak ada satu pun lokasi yang punya profil jam.',

    risikoJudul: 'RiskRadar — pergantian usaha',
    risikoKosong: 'Data pergantian usaha belum ada — lokasi ini belum bisa dinilai risikonya',
    risikoIsi:
      'Usaha di sini lebih sering berganti daripada kebanyakan area lain di kawasan yang sama. Itu tanda lokasi yang terus-menerus membuat penyewanya menyerah.',

    empatJudul: 'Empat hal yang dinilai',
    empatKunciIsi:
      'Akses ke stasiun, perputaran uang, ketatnya persaingan, dan biaya & risiko — masing-masing dengan kata, angka pendukungnya, dan berapa bahannya yang benar-benar terukur.',
    empatPembuka: 'Empat hal ini yang menyusun skornya.',
    belumTerukur: 'Belum terukur',
    faktaJalan: (n: number, nama: string) => `${n} menit jalan kaki ke ${nama}`,
    bahanTerukur: (a: number, b: number) => `${a} dari ${b} bahannya sudah terukur`,
    belumAda: (daftar: string) => `Belum ada: ${daftar}.`,
    butuhSurvei: 'Butuh survei lapangan dulu.',
    tanpaData: 'Datanya belum ada untuk lokasi ini.',
    apaSaja: 'Yang belum ada apa saja?',

    faktorJudul: 'Kenapa skornya segitu',
    faktorKunciJudul: 'Pembongkaran skor',
    faktorKunciIsi:
      'Lihat angka mana yang menaikkan dan menurunkan skor lokasi ini, dan seberapa jauh posisinya dibanding lokasi lain.',
    takTerukur: 'belum terukur',
    makinBeban: ' · makin tinggi makin membebani',
    makinBaik: ' · makin tinggi makin baik',

    tabelJudul: 'Seluruh 43 angka lokasi ini',
    tabelKunciIsi:
      'Semua angka yang dipakai menilai lokasi ini — orang di sekitarnya, kebiasaan belanjanya, pesaingnya, biayanya, risikonya, dan bentuk bangunannya.',
    tabelBuka: 'Tampilkan tabel lengkap',
    ya: 'ya',
    tidak: 'tidak',

    riwayatJudul: 'Riwayat perubahan skor',

    kuadranJudul: 'Kenapa masuk kuadran ini',
    kuadranKunciIsi:
      'Dua batang yang menunjukkan seberapa bagus datanya dan seberapa mahal kelihatannya, masing-masing terhadap titik tengah seluruh lokasi di enam kawasan.',
    sumbuY: 'Seberapa bagus datanya',
    sumbuYAtas: 'Lebih bagus daripada separuh lokasi lain.',
    sumbuYBawah: 'Lebih rendah daripada separuh lokasi lain.',
    dari100: (n: string) => `${n} dari 100`,
    sumbuX: 'Seberapa mahal kelihatannya',
    sumbuXAtas:
      'Diperkirakan tampak lebih mahal daripada separuh lokasi lain — sewanya biasanya ikut naik.',
    sumbuXBawah:
      'Diperkirakan tampak lebih biasa daripada separuh lokasi lain — dan justru di situ sewanya masih murah.',
    diAtasRata: 'Di atas rata-rata',
    diBawahRata: 'Di bawah rata-rata',
    garisTegak: 'Apa arti garis tegaknya?',
    garisTegakIsi:
      'Garis tegak pada kedua batang = titik tengah seluruh lokasi di enam kawasan. Sisi mana batangnya berhenti terhadap garis itulah yang menentukan kuadrannya.',

    kaki: 'Angka di kartu ini dihitung sekali oleh pipeline dan dibaca apa adanya. Informasi untuk pertimbangan, bukan nasihat investasi.',
  },
  en: {
    pilihJudul: 'Pick one hexagon',
    pilihIsi:
      'Click any hexagon on the map to see its score, its rent, and when the place gets busy.',
    gagalHeks: 'Could not load this hexagon',
    gagalMuat: 'Could not load.',
    ajakanPremium: 'This section is open to Loconomics Premium subscribers.',
    ajakanMasuk: 'Create an account first, then open the full depth of the data.',
    gabung: 'Join Loconomics Premium',
    atauToken: 'or open just this location with 1 token',
    peringkat: (n: number) => ` · rank ${n}`,
    lihatKuadran: 'See where it sits on the quadrant diagram',

    menujuJudul: 'Getting here',
    sembunyiRute: 'Hide route & reach',
    tampilRute: 'Show route & reach',
    moda: { kaki: 'On foot', mobil: 'Car', sepeda: 'Bike' },
    belumDitarik: 'not fetched yet',
    mnt: 'min',

    bandingPremium: 'Side-by-side comparison is part of Loconomics Premium.',
    bandingMasuk: 'Create an account first to compare several locations.',
    diBaki: 'In the comparison tray',
    bandingkan: 'Compare this location',
    sudahSimpan: 'Location saved',
    simpan: 'Save location',
    simpanMasuk: 'Create an account first to save locations.',
    simpanPremium: 'Saving and watching locations is part of Loconomics Premium.',
    simpanOke:
      'Location saved and its score frozen — the next change is reported under Saved.',
    simpanGagal: 'Could not add it to your watchlist.',
    unduhLaporan: 'Download the Feasibility Report (PDF)',
    laporanMasuk: 'Create an account first to download the Feasibility Report.',
    laporanOke: 'Feasibility Report downloaded.',
    laporanGagal: 'Could not download the report.',
    bukaOke: 'This location is now permanently open for your account.',
    bukaGagal: 'Could not open the location.',
    membuka: 'Opening…',
    bukaToken: (sisa: number) => `Open just this location — 1 token (${sisa} left)`,
    simulasiJudul: 'Simulate a business here',
    simulasiIsi: "Revenue, rent, and break-even from this hexagon's numbers",

    menit: 'minutes',
    berkendara: 'by car',
    jalanKaki: 'on foot',
    bersepeda: 'by bike',
    keArah: 'to',
    lewatJalan: 'along the streets that exist',
    memutar: (x: string) => `${x}x farther than it looks on the map`,
    memutarEkor: '. Something is blocking the direct way.',
    alternatif: (n: number) =>
      ` ${n} alternative ${n === 1 ? 'route is' : 'routes are'} drawn on the map.`,

    zonaBoleh: 'ZoneGuard — zoning allows business',
    kelasZona: (k: string) => ` · class ${k}`,
    zonaLarang: 'ZoneGuard — business is not allowed',
    zonaKosong: 'No digital RDTR yet',
    zonaKosongIsi: 'Its permission status cannot be confirmed. The score is still computed.',
    artinyaApa: 'What does that mean for me?',

    hargaJudul: 'PriceLens — rent',
    hargaKunciJudul: 'The price detail for this location',
    hargaKunciIsi:
      "Rent per m² and where it sits in the area's fair range, rent per month, spending per hour, and the NJOP land value.",
    hb: {
      sewa: 'Rent per month',
      sewaB: 'P05 — the figure written on the rental banner',
      jam: 'Money moving per hour',
      jamB: 'B10 — total receipt value divided by opening hours',
      porsi: 'Food price per serving',
      porsiB: 'B07 — from the surveyed menus',
      njop: 'NJOP',
      njopB: 'P01 — an independent benchmark',
    },
    hargaKosong: (semua: boolean, daftar: string) =>
      `${semua ? 'Not recorded here yet:' : 'Also not recorded here yet:'} ${daftar}.`,
    kenapaBelum: 'Why is it missing?',
    kenapaNjop:
      'NJOP is not published openly by Bapenda; the rest waits on a field survey — all three can only be written down by someone standing at the location.',
    kenapaSurvei: 'All three can only be written down by someone standing at the location.',
    hargaTakAda: 'No price data for this hexagon yet',

    jamJudul: 'Commuter Clock — when money moves',
    captive: 'Captive-dominated',
    choice: 'Choice-dominated',
    seimbang: 'Balanced',
    jamKunciJudul: 'The hourly pattern here',
    jamKunciIsi:
      'An 18-hour chart: when the money moves, the peak hour, and the split between captive and choice riders.',
    palingRamai: 'Busiest at',
    jamCaptive:
      'The flow piles up twice a day and goes quiet in between — suited to a business that serves fast.',
    jamChoice:
      'The flow is steadier through the day — suited to a business that needs people to linger.',
    jamSeimbang: 'The flow does not lean toward either kind of passenger.',
    jamTakAda: 'No transaction hours recorded yet.',
    jamNolJudul: 'Not one transaction hour has been recorded.',
    jamNolIsi:
      'Hourly patterns are read from the time printed on receipts. MAPID survey receipts carry no time column — the hour sits inside the photo of the receipt, and automatic reading of those photos has not been run. Until it is, no location has an hourly profile.',

    risikoJudul: 'RiskRadar — business turnover',
    risikoKosong: 'No turnover data yet — the risk here cannot be judged',
    risikoIsi:
      'Businesses here change hands more often than in most other parts of the same area. That is the mark of a location that keeps wearing its tenants down.',

    empatJudul: 'Four things being judged',
    empatKunciIsi:
      'Access to the station, money in circulation, how tight the competition is, and cost & risk — each with a word, its supporting figure, and how many of its ingredients are actually measured.',
    empatPembuka: 'These four are what make up the score.',
    belumTerukur: 'Not measured yet',
    faktaJalan: (n: number, nama: string) => `${n} minutes on foot to ${nama}`,
    bahanTerukur: (a: number, b: number) => `${a} of ${b} ingredients measured`,
    belumAda: (daftar: string) => `Missing: ${daftar}.`,
    butuhSurvei: 'Needs a field survey first.',
    tanpaData: 'No data for this location yet.',
    apaSaja: 'What is missing?',

    faktorJudul: 'Why the score is what it is',
    faktorKunciJudul: 'The score taken apart',
    faktorKunciIsi:
      "See which numbers push this location's score up and which pull it down, and how far it sits from the rest.",
    takTerukur: 'not measured',
    makinBeban: ' · the higher, the heavier',
    makinBaik: ' · the higher, the better',

    tabelJudul: 'All 43 numbers for this location',
    tabelKunciIsi:
      'Every number used to judge this location — the people around it, how they spend, its rivals, its costs, its risks, and the shape of its buildings.',
    tabelBuka: 'Show the full table',
    ya: 'yes',
    tidak: 'no',

    riwayatJudul: 'How the score has changed',

    kuadranJudul: 'Why it lands in this quadrant',
    kuadranKunciIsi:
      'Two bars showing how good the data is and how expensive it looks, each against the midpoint of every location across the six areas.',
    sumbuY: 'How good the data is',
    sumbuYAtas: 'Better than half of the other locations.',
    sumbuYBawah: 'Lower than half of the other locations.',
    dari100: (n: string) => `${n} of 100`,
    sumbuX: 'How expensive it looks',
    sumbuXAtas:
      'Estimated to look more expensive than half of the other locations — rent usually follows.',
    sumbuXBawah:
      'Estimated to look more ordinary than half of the other locations — and that is exactly where rent is still cheap.',
    diAtasRata: 'Above the middle',
    diBawahRata: 'Below the middle',
    garisTegak: 'What does the vertical line mean?',
    garisTegakIsi:
      'The vertical line on both bars = the midpoint of every location across the six areas. Which side the bar stops on is what decides the quadrant.',

    kaki: 'The numbers on this card are computed once by the pipeline and read back as they are. Information to weigh, not investment advice.',
  },
}

/** Kunci kamus tiap moda: nama tombolnya dan kata kerjanya di kalimat waktu tempuh. */
const MODA = { 'foot-walking': 'kaki', 'driving-car': 'mobil', 'cycling-regular': 'sepeda' } as const
const CARA_MODA = {
  'foot-walking': 'jalanKaki',
  'driving-car': 'berkendara',
  'cycling-regular': 'bersepeda',
} as const

/** Glif tiap moda, viewBox 16. */
const GLIF_MODA: Record<ProfilRute, string> = {
  'foot-walking':
    'M9 3.2a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8ZM8.6 4.4 6.4 5.6 5.2 8.4M8.6 4.4l1.8 1 1.4 2.4M8.6 4.4 8 8.6l2.4 1.8.6 4.4M8 8.6 5.4 11l-.8 3.8',
  'driving-car': 'M2.4 10.6h11.2M3.8 10.6 5 6.6h6l1.2 4M4.2 10.6v2.2M11.8 10.6v2.2M5.4 12.8h1M10 12.8h1',
  // Dua roda, rangka segitiga, setang. Sengaja bukan glif motor lama yang
  // diberi nama baru: dua benda yang namanya berbeda harus BENTUKNYA berbeda.
  'cycling-regular':
    'M3.8 8.6a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5ZM12.2 8.6a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5ZM3.8 11.1h3.9l2.9-4.4M3.8 11.1l2.4-4.1h4.4M7.7 11.1 5.9 5.6M5 5.6h1.9M10.6 6.7l1.6 4.4M10.6 6.7l-.5-1.9h1.7',
}

/**
 * Satu sumbu kuadran sebagai batang, dengan titik tengah sebagai garis tegak.
 *
 * Bukan bar biasa: yang penting bukan seberapa panjang batangnya melainkan di
 * sisi mana ia berhenti terhadap garis.
 *
 * Versi sebelumnya menulis MEKANISMENYA di bawah batang - "Separuh lokasi ada
 * di bawah 0,29. Yang ini di atas garis itu - itu yang menentukan kolom
 * kiri/kanan." Tiap kata di situ benar, dan gabungannya tetap tidak bisa
 * dipahami: 0,29 tidak punya arti bagi siapa pun, dan "kolom kiri/kanan"
 * menuntut pembacanya sudah hafal tata letak Kompas Kuadran.
 *
 * Sekarang pemanggilnya mengirim satu KALIMAT yang menyatakan artinya, dan
 * angka mentah sumbu prestise tidak ditampilkan sama sekali - ia diganti kata.
 */
function SumbuKuadran({
  label,
  kalimat,
  catatan,
  nilai,
  batas,
  maks,
  tampilNilai,
  tinggiBaik,
}: {
  label: string
  /** Apa artinya, dalam satu kalimat. Menggantikan penjelasan mekanismenya. */
  kalimat: string
  /** Sumbu ini berdiri di atas apa. Kosong = tidak ada yang perlu dinyatakan.
   *  Dibangkitkan `frasaPrestise()` dari cakupan bahan, bukan ditulis tetap —
   *  begitu bahannya terisi, catatannya hilang sendiri. */
  catatan?: string[]
  nilai: number
  batas: number
  maks: number
  /** Yang dicetak di kanan label. Sengaja string: sumbu prestise tidak punya
   *  satuan yang berarti bagi siapa pun, jadi ia menampilkan kata. */
  tampilNilai: string
  tinggiBaik?: boolean
}) {
  const p = Math.max(0, Math.min(100, (nilai / maks) * 100))
  const pb = Math.max(0, Math.min(100, (batas / maks) * 100))
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] text-ink-2">{label}</span>
        <span className="shrink-0 text-[12.5px] font-semibold text-ink">{tampilNilai}</span>
      </div>
      {/* Garis tegak = titik tengah seluruh lokasi. Ia tetap digambar karena
          ia satu-satunya yang membuat "lebih bagus daripada separuh lokasi
          lain" bisa DILIHAT, bukan cuma dibaca - tetapi angkanya sendiri tidak
          lagi ditulis. "Separuh lokasi ada di bawah 0,29" menuntut pembacanya
          tahu 0,29 itu apa, dan tidak ada satu pun cara ia bisa tahu. */}
      <div className="relative h-2 rounded-full bg-ground-2" aria-hidden>
        <div
          // Sama dengan bagian "Empat hal yang dinilai": pekat untuk sumbu yang
          // tinggi = baik, redup untuk yang tidak. Prestise visual TIDAK
          // diwarnai sebagai buruk - lokasi yang terlihat mahal belum tentu
          // salah dipilih, ia cuma mahal.
          className={`h-full rounded-full transition-[width] duration-500 ease-liquid ${
            tinggiBaik ? 'bg-ink' : 'bg-ink-3'
          }`}
          style={{ width: `${p}%` }}
        />
        <span
          className="absolute -top-[3px] h-[14px] w-[2px] rounded-full bg-ink"
          style={{ left: `calc(${pb}% - 1px)` }}
        />
      </div>
      <p className="mt-1.5 text-[12px] leading-snug text-ink-2">{kalimat}</p>
      {/* TIDAK dilipat, dan itu keputusan yang sudah dibayar sekali.

          Percobaan melipatnya ke <details> bersama keterangan panjang lain di
          panel ini langsung membuat dua asersi `audit-prd.mjs` merah. Alasannya
          benar: kalimat ini menyatakan sumbu prestise berdiri di atas TIGA dari
          lima bahan, dan bahwa dua yang menilai tampilan secara langsung kosong.
          Yang dijanjikan bukan "bisa dibuka" melainkan bahwa layar
          MENYEBUTKANNYA - dan kalimat di balik lipatan tidak menyebutkan apa
          pun sampai ada yang membukanya.

          Keterangan lain di panel ini boleh dilipat justru karena tidak ada
          yang berjanji atas namanya. */}
      {catatan?.map((c) => (
        <p key={c} className="mt-1 text-[11.5px] leading-snug text-ink-3">
          {c}
        </p>
      ))}
    </div>
  )
}

export default function PanelInsight({
  h3,
  onBukaKuadran,
  posisi,
  batas,
  onBukaSimulasi,
  onBandingkan,
  sedangDibandingkan,
  profilRute = 'foot-walking',
  onGantiProfil,
  rutaTampil = false,
  onUbahRutaTampil,
}: {
  h3: string | null
  onBukaKuadran: () => void
  /** Letak heksagon ini di kedua sumbu kuadran. */
  posisi?: { x: number | null; y: number | null } | null
  /** Median kedua sumbu - garis yang memisahkan kuadran. */
  batas?: { x: number | null; y: number | null }
  /** Membuka simulasi kelayakan usaha untuk heksagon ini. */
  onBukaSimulasi?: () => void
  /** Menambahkan heksagon ini ke baki komparasi. */
  onBandingkan?: (h3: string) => void
  /** Sudah ada di baki komparasi. */
  sedangDibandingkan?: boolean
  /** Profil rute yang sedang digambar. Dimiliki App, dipakai bersama peta. */
  profilRute?: ProfilRute
  onGantiProfil?: (p: ProfilRute) => void
  /** Apakah rute & kawasan jangkau sedang digambar di peta. */
  rutaTampil?: boolean
  onUbahRutaTampil?: (v: boolean) => void
}) {
  const t = useTeks(K)
  const ist = useIstilah()
  const {
    premium,
    mintaLangganan,
    mintaMasuk,
    akun,
    segarkan,
    tandaiTerbuka,
    terbuka,
    catatSimpan,
    tersimpan,
  } = useSesi()
  const [aksiSibuk, setAksiSibuk] = useState<string | null>(null)
  const [aksiPesan, setAksiPesan] = useState<string | null>(null)
  // DITURUNKAN dari himpunan milik provider, bukan disimpan sendiri.
  //
  // Versi lama menyimpan boolean lokal yang hanya pernah disetel oleh tombol
  // ini. Menyimpan lewat klik dua kali di peta tidak pernah menyalakannya, jadi
  // tombolnya tetap berbunyi "Simpan lokasi" untuk lokasi yang SUDAH tersimpan
  // - dan menekannya menyimpan untuk kedua kalinya.
  const [detail, setDetail] = useState<DetailHeksagon | null>(null)
  const [harga, setHarga] = useState<PriceLensHeksagon | null>(null)
  const [jam, setJam] = useState<CommuterClock | null>(null)
  const [konteks, setKonteks] = useState<KonteksSimpul | null>(null)
  /**
   * Konteks simpul untuk KETIGA profil tersimpan, bukan cuma yang aktif.
   *
   * Tombol moda menuliskan jarak dan waktu tempuhnya masing-masing, dan itu
   * angka per profil - respons hanya membawa satu. Tiga permintaan, bukan
   * satu; backend men-cache semuanya 15 menit, jadi yang berikutnya hampir
   * selalu dijawab dari cache.
   */
  const [perProfil, setPerProfil] = useState<Partial<Record<ProfilRute, KonteksSimpul>>>({})
  const [memuat, setMemuat] = useState(false)
  const [galat, setGalat] = useState<string | null>(null)

  useEffect(() => {
    if (!h3) {
      setDetail(null)
      setHarga(null)
      setJam(null)
      setKonteks(null)
      return
    }
    let batal = false
    // Dikosongkan DULU, baru diminta. Tanpa ini panel terus memegang angka
    // heksagon SEBELUMNYA sampai permintaan baru mendarat: bukan sekadar terasa
    // lambat, tapi salah - judul, skor, dan harga milik heksagon lain terbaca
    // sebagai milik yang baru diklik.
    setDetail(null)
    setHarga(null)
    setJam(null)
    setKonteks(null)
    setMemuat(true)
    setGalat(null)
    // Pesan dan penanda milik heksagon SEBELUMNYA. Dibiarkan hidup, "Sudah
    // dipantau" akan menempel di lokasi yang baru diklik dan belum dipantau.
    setAksiPesan(null)

    // Ketiganya diminta bersamaan, bukan berurutan. Menunggu satu selesai
    // sebelum meminta berikutnya akan melipattigakan waktu tunggu di jaringan
    // yang lambat, tanpa alasan.
    //
    // Kartu harga dan Commuter Clock BERBAYAR sejak 23 Agustus. Untuk yang
    // belum boleh, keduanya tidak diminta sama sekali - dua permintaan yang
    // sudah pasti dijawab 401 cuma membebani jaringan dan mengotori konsol.
    // Backend tetap penjaganya; ini sekadar tidak mengetuk pintu yang terkunci.
    const bolehDalam = premium || terbuka.has(h3)
    Promise.allSettled([
      api.detailHeksagon(h3),
      bolehDalam ? api.kartuHarga(h3) : Promise.reject(new Error('terkunci')),
      bolehDalam ? api.commuterClock(h3) : Promise.reject(new Error('terkunci')),
      // GRATIS, jadi tidak ikut penjaga di atas. Peta sudah memintanya untuk
      // menggambar garisnya, dan backend men-cache-nya 15 menit - jadi yang ini
      // hampir selalu dijawab dari cache, bukan dari basis data.
      api.simpulTerdekat(h3, 'foot-walking'),
      api.simpulTerdekat(h3, 'driving-car'),
      api.simpulTerdekat(h3, 'cycling-regular'),
    ])
      .then(([d, p, c, sk, sm, ss]) => {
        if (batal) return
        if (d.status === 'fulfilled') setDetail(d.value)
        // String KOSONG, bukan kalimat: efek ini tidak boleh bergantung pada
        // kamus, kalau tidak ia memuat ulang seluruh panel tiap kali bahasa
        // ditukar. Yang membedakan "tidak ada galat" dari "galat tanpa pesan"
        // adalah null vs '', dan penerjemahannya terjadi saat digambar.
        else setGalat(d.reason instanceof Error ? d.reason.message : '')
        setHarga(p.status === 'fulfilled' ? p.value : null)
        setJam(c.status === 'fulfilled' ? c.value : null)
        const kaki = sk.status === 'fulfilled' ? sk.value : undefined
        const mobil = sm.status === 'fulfilled' ? sm.value : undefined
        const sepeda = ss.status === 'fulfilled' ? ss.value : undefined
        const semua = { 'foot-walking': kaki, 'driving-car': mobil, 'cycling-regular': sepeda }
        setPerProfil(semua)
        setKonteks(semua[profilRute] ?? kaki ?? mobil ?? sepeda ?? null)
      })
      .finally(() => !batal && setMemuat(false))

    return () => {
      batal = true
    }
    // `premium` ikut jadi dependensi: begitu langganan aktif, detailnya diminta
    // ULANG supaya 43 variabelnya benar-benar datang. Respons yang sudah ada di
    // state dibuat untuk tingkat yang lama, dan tidak ada cara menambalnya di
    // frontend - isinya memang tidak pernah dikirim.
    // `bahasa` ikut jadi dependensi, dan itu bukan kelebihan.
    // Belasan kalimat di respons ini DIRAKIT BACKEND dari angka heksagon -
    // penjelasan kuadran, catatan pola jam, peringatan simulasi. Menukar
    // bahasa tanpa meminta ulang meninggalkan kalimat lama di layar yang
    // seluruh sisanya sudah berganti.
  }, [h3, premium, terbuka, profilRute, ist.bahasa])

  if (!h3) return <Ajakan judul={t.pilihJudul} anak={t.pilihIsi} />
  if (memuat) return <Memuat baris={5} />
  if (galat !== null)
    return (
      <Ajakan
        judul={t.gagalHeks}
        anak={galat || t.gagalMuat}
        aksi={
          <code className="mt-1 rounded-xs bg-ground-2 px-1.5 py-0.5 font-mono text-[12.5px] text-ink-2">
            {h3}
          </code>
        }
      />
    )
  if (!detail) return null

  const { skor, indeks, faktor, zoneguard, risiko } = detail

  // Dibaca dari BACKEND, bukan dari `premium` di frontend.
  //
  // Keduanya biasanya sepakat, tetapi ada satu keadaan penting di mana tidak:
  // akun gratis yang sudah membelanjakan token untuk heksagon INI. Backend
  // tahu itu dan mengirim isi penuhnya dengan `terkunci: []`; `premium` di
  // frontend tetap false. Kalau tirainya digambar dari `premium`, orang yang
  // sudah membayar tetap melihat tirai di atas data yang sudah ia beli.
  const dipantau = tersimpan.has(skor.h3_index)
  const terkunci = detail.terkunci.length > 0

  const ajakanBuka = () =>
    akun
      ? mintaLangganan(t.ajakanPremium)
      : mintaMasuk(t.ajakanMasuk)

  const terlarang = zoneguard.filter_mutlak
  const tanpaRdtr = zoneguard.status === 'TIDAK_DIKETAHUI'

  return (
    <div key={h3} className="masuk scroll-tipis h-full overflow-y-auto">
      {/* --- Kepala --------------------------------------------------------- */}
      {/* Kepala diberi warna KUADRANNYA, bukan putih polos.

          Warnanya sudah dipakai di peta untuk heksagon yang sama, jadi ini
          bukan hiasan: ia menyambungkan petak yang baru diklik dengan panel
          yang baru terbuka. Tanpa itu, satu-satunya yang menyatakan keduanya
          benda yang sama adalah nama lokasinya - dan nama itu baru dibaca
          sesudah mata mencarinya.

          Kepekatannya rendah dan berhenti sebelum teks: yang diwarnai LATAR,
          dan kontras tulisan terhadapnya tidak berubah sama sekali. */}
      <div
        className="border-b border-line px-4 py-3"
        style={{
          background: skor.kuadran
            ? `linear-gradient(180deg, ${KUADRAN[skor.kuadran].lembut} 0%, var(--color-surface) 78%)`
            : 'var(--color-surface)',
        }}
      >
        {/* Nama yang bisa dibaca di depan, indeks H3 di belakangnya dan
            kecil. Indeksnya TETAP ada - ia yang dipakai kalau seseorang perlu
            menelusuri ke basis data - tapi ia bukan yang dicari mata saat
            panel ini terbuka. */}
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-semibold text-ink">
              {kodeLokasi(skor.h3_index, skor.kawasan)}
            </span>
            <code className="block truncate font-mono text-[10.5px] text-ink-3">
              {skor.h3_index}
            </code>
          </span>
          <Badge badge={skor.keyakinan} />
        </div>

        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="flex items-baseline gap-1.5">
              <span
                className={`papan tabular text-[42px] leading-none ${
                  terlarang ? 'text-ink-3 line-through decoration-bahaya decoration-2' : ''
                }`}
              >
                {skor.opportunity_score?.toFixed(0) ?? '—'}
              </span>
              <span className="text-[13px] text-ink-3">/ 100</span>
            </div>
            <p className="eyebrow mt-1">
              Opportunity Score
              {skor.peringkat !== null && t.peringkat(skor.peringkat)}
            </p>
          </div>
          <button
            onClick={onBukaKuadran}
            className="cursor-pointer transition-opacity hover:opacity-70"
            title={t.lihatKuadran}
          >
            <ChipKuadran kuadran={skor.kuadran} />
          </button>
        </div>

        {detail.kuadran_penjelasan && (
          <p className="mt-2 text-[13.5px] leading-snug text-ink-2">
            {detail.kuadran_penjelasan}
          </p>
        )}

        {/* --- Kenapa kuadrannya begitu --------------------------------------
            Pertanyaan yang paling sering muncul soal layar ini: kenapa skor 58
            bisa Hidden Gem sementara 50 justru Aman. Jawabannya
            selalu ada tapi tidak pernah terlihat - kuadran ditentukan DUA sumbu,
            dan panel ini cuma pernah menampilkan satu.

            Dua batang di bawah menampilkan keduanya sekaligus dengan mediannya
            sebagai garis tegak. Begitu garisnya terlihat, penempatannya berhenti
            terasa sewenang-wenang. */}
        {/* --- Cara menuju ke sini -------------------------------------------
            DI PALING ATAS, sebelum satu pun angka.

            Ia dulu duduk di kaki panel, sesudah 43 variabel. Yang pertama
            ingin diketahui orang yang baru menekan sebuah heksagon bukan
            kenapa ia masuk kuadran tertentu - melainkan di mana ia, dan
            berapa jauh dari stasiunnya. Tombol yang menjawab itu tidak boleh
            menuntut orang menggulir dulu untuk menemukannya. */}
        {onGantiProfil && konteks?.simpul && (
          <Bagian
            judul={t.menujuJudul}
            nada="gem"
            ikon={<><path d="M8 1.8 3 8h3v6.2h4V8h3Z"/></>}
          >
            {/* TOMBOL DULU, moda menyusul.
                Mengklik satu heksagon seharusnya membuka keterangannya - bukan
                langsung menimpa peta dengan rute dan pita jangkauan yang belum
                tentu sedang dicari orangnya. Yang tergambar di peta sekarang
                menunggu diminta, dan tombol ini yang memintanya.

                Pilihannya berlaku untuk SATU heksagon: berpindah lokasi
                mengembalikannya ke mati. */}
            {onUbahRutaTampil && (
              <button
                onClick={() => onUbahRutaTampil(!rutaTampil)}
                className={`mb-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-full px-4 py-2.5 text-[13.5px] font-semibold transition-all duration-300 ease-jelly ${
                  rutaTampil
                    ? 'border border-line bg-surface-2 text-ink-2 hover:text-ink'
                    : 'bg-ink text-surface hover:scale-[1.015]'
                }`}
              >
                <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
                  <path
                    d={
                      rutaTampil
                        ? 'M2.5 8s2.2-4 5.5-4 5.5 4 5.5 4-2.2 4-5.5 4-5.5-4-5.5-4Zm1-5 9 10'
                        : 'M2.5 8s2.2-4 5.5-4 5.5 4 5.5 4-2.2 4-5.5 4-5.5-4-5.5-4Z'
                    }
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {!rutaTampil && <circle cx="8" cy="8" r="1.6" fill="currentColor" />}
                </svg>
                {rutaTampil ? t.sembunyiRute : t.tampilRute}
              </button>
            )}

            <div className="flex gap-2">
              {URUTAN_PROFIL.map((nilai) => {
                const label = t.moda[MODA[nilai]]
                const glif = GLIF_MODA[nilai]
                const ada = konteks.profil_tersedia?.includes(nilai) ?? false
                const aktif = profilRute === nilai
                return (
                  <button
                    key={nilai}
                    onClick={() => onGantiProfil(nilai)}
                    disabled={!ada && !aktif}
                    className={`flex flex-1 cursor-pointer flex-col items-center gap-1.5 rounded-lg border px-3 py-2.5 transition-all duration-300 ease-jelly disabled:cursor-not-allowed ${
                      aktif
                        ? 'border-gem bg-gem-soft/50 text-gem'
                        : ada
                          ? 'border-line text-ink-2 hover:border-ink-3 hover:text-ink'
                          : 'border-dashed border-line text-ink-3 opacity-60'
                    }`}
                  >
                    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden>
                      <path
                        d={glif}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="text-[12.5px] font-semibold leading-none">{label}</span>
                    {/* JARAK dan WAKTU, bukan "ada rutenya".
                        Yang ingin diketahui orang di tombol moda bukan apakah
                        datanya ada - itu urusan kami - melainkan berapa jauh
                        dan berapa lama. Angkanya dari profil masing-masing,
                        jadi "25 mnt jalan kaki", "8 mnt mobil", dan "9 mnt
                        sepeda" sama-sama diukur, bukan satu dibagi sebuah
                        faktor. Sejak sepeda menggantikan motor, tidak ada lagi
                        moda yang cuma boleh menyebut jaraknya. */}
                    <span className="text-center text-[10.5px] leading-tight text-ink-3">
                      {!ada ? (
                        t.belumDitarik
                      ) : (
                        <>
                          {perProfil[nilai]?.jarak_m != null
                            ? jarakSingkat(perProfil[nilai]!.jarak_m!)
                            : '—'}
                          {perProfil[nilai]?.menit_jalan != null &&
                            ` · ${Math.round(perProfil[nilai]!.menit_jalan!)} ${t.mnt}`}
                        </>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </Bagian>
        )}
      </div>

      {/* --- Pintasan simulasi ----------------------------------------------
          Ditaruh di paling atas, sebelum satu pun angka.

          Panel ini menjawab "lokasi ini seperti apa"; yang dibawa pelaku UMKM
          ke sini adalah pertanyaan lain: "kalau saya buka di sini, jadinya
          bagaimana". Menyembunyikan jawabannya di kaki panel berarti menuntut
          orang membaca 43 variabel dulu untuk menemukan pertanyaannya sendiri. */}
      {/* --- Aksi berbayar --------------------------------------------------
          Ketiganya SELALU terlihat, juga untuk tamu. Tombol yang disembunyikan
          sampai seseorang berlangganan tidak pernah bisa jadi alasan orang
          berlangganan - ia harus tahu alat itu ada. Yang ditolak adalah
          tindakannya, dengan dialog yang menjelaskan kenapa, bukan tombolnya.

          Yang TIDAK ditawarkan ke tamu: "Pantau". Memantau menuntut tempat
          menyimpan, dan tempat menyimpan menuntut akun. Menawarkannya lalu
          menolaknya adalah janji yang ditarik kembali. */}
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        {/* BANDINGKAN disorot, dua lainnya tidak. Bukan soal selera: dari ketiga
            aksi ini hanya membandingkan yang menuntut langkah KEDUA - orangnya
            harus memilih heksagon lain sesudahnya. Aksi yang menyeret orang ke
            langkah berikutnya harus terlihat sebagai ajakan; yang selesai dalam
            satu klik cukup jadi tombol biasa. */}
        <button
          onClick={() =>
            premium
              ? onBandingkan?.(h3)
              : akun
                ? mintaLangganan(t.bandingPremium)
                : mintaMasuk(t.bandingMasuk)
          }
          className={`flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold transition-all duration-300 ease-jelly hover:scale-[1.02] ${
            sedangDibandingkan
              ? 'bg-gem-soft text-gem shadow-[inset_0_0_0_1.5px_var(--color-gem)]'
              : 'bg-ink text-surface shadow-[0_6px_18px_-8px_rgb(22_33_28/0.8)]'
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden className="shrink-0">
            <path d="M4 15V8M10 15V4M16 15v-5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
          </svg>
          {sedangDibandingkan ? t.diBaki : t.bandingkan}
          {!premium && <Gembok />}
        </button>

        {/* Bulat, ikon saja - bentuk yang sama dengan tombol Tersimpan di bilah
            atas, karena keduanya mengurus benda yang sama. */}
        <TombolBulat
          label={dipantau ? t.sudahSimpan : t.simpan}
          aktif={dipantau}
          sibuk={aksiSibuk === 'pantau'}
          gembok={!premium}
          onClick={async () => {
            if (!akun) return mintaMasuk(t.simpanMasuk)
            if (!premium) return mintaLangganan(t.simpanPremium)
            setAksiSibuk('pantau')
            try {
              await api.pantau(h3)
              catatSimpan()
              setAksiPesan(t.simpanOke)
            } catch (e) {
              setAksiPesan(e instanceof GalatAPI ? e.message : t.simpanGagal)
            } finally {
              setAksiSibuk(null)
            }
          }}
        >
          <path d="M5.5 3.5h9V17L10 13.6 5.5 17Z" fill="currentColor" />
        </TombolBulat>

        <TombolBulat
          label={t.unduhLaporan}
          sibuk={aksiSibuk === 'laporan'}
          gembok={!premium}
          onClick={async () => {
            if (!akun) return mintaMasuk(t.laporanMasuk)
            setAksiSibuk('laporan')
            try {
              await api.unduhLaporan(h3, skor.kawasan)
              setAksiPesan(t.laporanOke)
              await segarkan()
            } catch (e) {
              if (e instanceof GalatAPI && (e.kode === 'BUTUH_PREMIUM' || e.kode === 'TOKEN_TIDAK_CUKUP'))
                mintaLangganan(e.message)
              else setAksiPesan(e instanceof GalatAPI ? e.message : t.laporanGagal)
            } finally {
              setAksiSibuk(null)
            }
          }}
        >
          <path
            d="M10 3v9m0 0 3.2-3.2M10 12 6.8 8.8M4.5 14.5v1a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-1"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </TombolBulat>
      </div>

      {/* Jalan keluar kedua untuk akun gratis: bayar satu lokasi ini saja. */}
      {akun && !premium && terkunci && (
        <button
          onClick={async () => {
            setAksiSibuk('token')
            try {
              await api.bukaHeksagon(h3)
              tandaiTerbuka(h3)
              await segarkan()
              setDetail(await api.detailHeksagon(h3))
              setAksiPesan(t.bukaOke)
            } catch (e) {
              if (e instanceof GalatAPI && e.kode === 'TOKEN_TIDAK_CUKUP') mintaLangganan(e.message)
              else setAksiPesan(e instanceof GalatAPI ? e.message : t.bukaGagal)
            } finally {
              setAksiSibuk(null)
            }
          }}
          className="flex w-full cursor-pointer items-center justify-center gap-1.5 border-b border-line bg-surface-2/60 px-4 py-2 text-[11.5px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          {aksiSibuk === 'token' ? t.membuka : t.bukaToken(akun.saldo_token)}
        </button>
      )}

      {aksiPesan && (
        <p
          role="status"
          className="border-b border-line bg-surface-2 px-4 py-2 text-[12.5px] leading-snug text-ink-2"
        >
          {aksiPesan}
        </p>
      )}

      {onBukaSimulasi && (
        <button
          onClick={onBukaSimulasi}
          className="group flex w-full cursor-pointer items-center gap-3 border-b border-line bg-ink px-4 py-3 text-left text-surface transition-all duration-200 ease-jelly hover:brightness-110"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface/15 transition-transform duration-300 ease-jelly group-hover:scale-110">
            <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
              <path
                d="M3 15.5 7 9.5l3.4 3.2L17 4.5"
                stroke="currentColor"
                strokeWidth="1.8"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M12.6 4.5H17v4.4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold leading-tight">
              {t.simulasiJudul}
            </span>
            <span className="block text-[12px] leading-snug text-surface/70">
              {t.simulasiIsi}
            </span>
          </span>
          <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden className="shrink-0 transition-transform duration-200 group-hover:translate-x-0.5">
            <path d="M4 1.5 8.5 6 4 10.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {/* --- 0. Jalan kaki ke stasiun --------------------------------------
          Di ATAS ZoneGuard karena ia menjawab pertanyaan yang lebih dulu
          ditanyakan orang saat melihat sebuah titik di peta transit: "ini
          sebenarnya berapa lama jalan kakinya?" - dan jawabannya sering
          mengejutkan.

          Yang ditampilkan waktu dan jarak RUTE, bukan garis lurus. Kalau
          keduanya berselisih jauh, selisih itu ikut dinyatakan: lokasi yang
          terlihat 300 m dari stasiun tetapi butuh berjalan 900 m adalah persis
          "Jebakan Gengsi" versi kaki, dan orang berhak tahu sebelum menyewa. */}
      {konteks?.simpul && !konteks.garis_lurus && konteks.jarak_m !== null && (
        <div className="border-b border-line bg-surface px-4 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="papan tabular text-[19px] leading-none text-ink">
              {Math.round(konteks.menit_jalan ?? 0)}
            </span>
            <span className="text-[12px] text-ink-2">
              {t.menit} {t[CARA_MODA[profilRute]]} {t.keArah}{' '}
              <strong className="font-semibold text-ink">{konteks.simpul.nama}</strong>
            </span>
          </div>
          <p className="mt-1 text-[11.5px] leading-snug text-ink-3">
            {konteks.jarak_m >= 1000
              ? `${(konteks.jarak_m / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} km`
              : `${Math.round(konteks.jarak_m)} m`}{' '}
            {t.lewatJalan}
            {konteks.faktor_memutar && konteks.faktor_memutar >= 1.4 ? (
              <>
                {' '}
                &mdash;{' '}
                <strong className="font-semibold text-hati">
                  {t.memutar(
                    konteks.faktor_memutar.toLocaleString('id-ID', { maximumFractionDigits: 1 }),
                  )}
                </strong>
                {t.memutarEkor}
              </>
            ) : (
              '.'
            )}
            {konteks.rute.length > 1 && t.alternatif(konteks.rute.length - 1)}
          </p>
        </div>
      )}

      {/* --- 1. ZoneGuard ---------------------------------------------------
          Zona yang DIIZINKAN kini ikut dinyatakan, tidak lagi diam.
          Sebelumnya bagian ini hanya muncul untuk zona terlarang atau tanpa
          RDTR, jadi lokasi yang izinnya justru bersih tidak menampilkan apa pun
          soal zonasi - dan pembacanya tidak bisa membedakan "sudah diperiksa,
          aman" dari "belum diperiksa". Untuk fitur yang tabelnya menjanjikan
          "status zonasi" ke tingkat gratis, diam bukan jawaban. */}
      {!terlarang && !tanpaRdtr && (
        <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2">
          <span
            aria-hidden
            className="grid h-4 w-4 shrink-0 place-items-center rounded-xs bg-gem text-white"
          >
            <svg width="9" height="9" viewBox="0 0 20 20">
              <path
                d="m4 10.5 4 4 8-9"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="text-[12.5px] leading-snug text-ink-2">
            <strong className="font-semibold text-ink">{t.zonaBoleh}</strong>
            {zoneguard.kelas_zona && (
              <span className="text-ink-3">{t.kelasZona(zoneguard.kelas_zona)}</span>
            )}
          </span>
        </div>
      )}

      {(terlarang || tanpaRdtr) && (
        <div
          className={`border-b px-4 py-3 ${
            terlarang
              ? 'border-bahaya/25 bg-bahaya-soft'
              : 'border-line bg-surface-2'
          }`}
          role={terlarang ? 'alert' : undefined}
        >
          <div className="flex gap-2.5">
            <span
              aria-hidden
              className={`mt-0.5 h-4 w-4 shrink-0 rounded-xs ${
                terlarang ? 'bg-bahaya' : 'arsir border border-line-2 text-ink-3'
              }`}
            />
            <div>
              <p
                className={`text-[14px] font-semibold ${terlarang ? 'text-bahaya' : 'text-ink'}`}
              >
                {terlarang ? t.zonaLarang : t.zonaKosong}
              </p>
              {terlarang ? (
                <p className="mt-0.5 text-[13.5px] leading-snug text-ink-2">
                  {zoneguard.penjelasan}
                </p>
              ) : (
                <>
                  <p className="mt-0.5 text-[13px] leading-snug text-ink-2">
                    {t.zonaKosongIsi}
                  </p>
                  <Rinci ringkas={t.artinyaApa}>{zoneguard.penjelasan}</Rinci>
                </>
              )}
              {zoneguard.kelas_zona && (
                <p className="mt-1.5 inline-block rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-ink-3">
                  {zoneguard.kelas_zona}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- 2. PriceLens ---------------------------------------------------
          BERBAYAR sejak 23 Agustus 2026 - keputusan pemilik repo. Peta harga
          (layer PriceLens) tetap gratis; yang berbayar kartu rinciannya:
          sewa/bulan, NJOP, dan posisi terhadap rentang wajar kawasan. */}
      <Bagian judul={t.hargaJudul} nada="jebakan" ikon={<><path d="M2 5.2A1.7 1.7 0 0 1 3.7 3.5h8.6A1.7 1.7 0 0 1 14 5.2v6.1a1.7 1.7 0 0 1-1.7 1.7H3.7A1.7 1.7 0 0 1 2 11.3z"/><path d="M11 8.25h1.6"/></>}>
        {terkunci ? (
          <Terkunci
            judul={t.hargaKunciJudul}
            kalimat={t.hargaKunciIsi}
            labelAksi={t.gabung}
            baris={4}
            onBuka={ajakanBuka}
            aksiKedua={
              akun ? (
                <button
                  onClick={ajakanBuka}
                  className="cursor-pointer text-[11.5px] text-ink-3 underline underline-offset-2 hover:text-ink-2"
                >
                  {t.atauToken}
                </button>
              ) : undefined
            }
          />
        ) : harga ? (
          <>
            <BarHarga
              nilai={harga.harga_sewa_per_m2}
              wajar={harga.wajar_sewa_per_m2}
              posisi={harga.posisi_sewa}
              selisih={harga.selisih_persen_dari_median}
              format={(n) => (n === null ? null : `${rupiah(n)}/m²`)}
              kawasan={harga.kawasan}
            />
            {/* Baris yang KOSONG tidak lagi dicetak satu per satu.
                Sebelumnya keempatnya selalu tampil, dan untuk 708 dari 708
                heksagon keempatnya berbunyi "belum ada data" - jadi pelanggan
                yang baru membayar melihat empat kegagalan berturut-turut di
                bagian yang paling dijanjikan.
                Terukur 30 Agu 2026: sewa per m2 0/708, sewa per bulan 0/708,
                uang per jam 0/708, NJOP 0/708, harga porsi 11/708. Yang salah
                bukan cara menuliskannya melainkan menuliskannya empat kali -
                satu pernyataan yang benar lebih jujur daripada empat baris
                yang membuat kekosongan terlihat seperti kerusakan. */}
            {(() => {
              // Berkunci KODE, bukan label. Versi lama menanyakan
              // `l === 'NJOP'` untuk memilih keterangannya - cocok selama
              // labelnya cuma pernah punya satu bentuk, dan diam-diam salah
              // begitu label yang sama punya bentuk Inggris.
              const baris = [
                { kode: 'P05', label: t.hb.sewa, bantuan: t.hb.sewaB,
                  nilai: rupiah(harga.harga_sewa_median), satuan: undefined },
                { kode: 'B10', label: t.hb.jam, bantuan: t.hb.jamB,
                  nilai: rupiah(harga.belanja_per_jam), satuan: undefined },
                { kode: 'B07', label: t.hb.porsi, bantuan: t.hb.porsiB,
                  nilai: rupiah(harga.harga_median_porsi), satuan: undefined },
                { kode: 'P01', label: t.hb.njop, bantuan: t.hb.njopB,
                  nilai: rupiah(harga.njop_m2), satuan: '/m²' },
              ]
              const ada = baris.filter((b) => b.nilai !== null)
              const kosong = baris.filter((b) => b.nilai === null)
              return (
                <div className="mt-3 border-t border-line pt-2">
                  {ada.map((b) => (
                    <Baris key={b.kode} label={b.label} bantuan={b.bantuan}>
                      <Angka nilai={b.nilai} satuan={b.satuan} />
                    </Baris>
                  ))}
                  {kosong.length > 0 && (
                    <div className="pt-1">
                      <p className="text-[12.5px] leading-snug text-ink-3">
                        {t.hargaKosong(
                          kosong.length === baris.length,
                          kosong.map((b) => keKalimat(b.label)).join(', '),
                        )}
                      </p>
                      <Rinci ringkas={t.kenapaBelum}>
                        {kosong.some((b) => b.kode === 'P01') ? t.kenapaNjop : t.kenapaSurvei}
                      </Rinci>
                    </div>
                  )}
                </div>
              )
            })()}
          </>
        ) : (
          <Kosong teks={t.hargaTakAda} />
        )}
      </Bagian>

      {/* --- 3. Commuter Clock ---------------------------------------------- */}
      <Bagian
        nada="jebakan"
        ikon={<><circle cx="8" cy="8" r="5.8"/><path d="M8 4.9V8l2.1 1.5"/></>}
        judul={t.jamJudul}
        aksi={
          jam?.dominasi && (
            <span className="rounded-xs bg-surface-2 px-1.5 py-0.5 text-[12px] font-semibold text-ink-2">
              {jam.dominasi === 'captive'
                ? t.captive
                : jam.dominasi === 'choice'
                  ? t.choice
                  : t.seimbang}
            </span>
          )
        }
      >
        {terkunci ? (
          <Terkunci
            judul={t.jamKunciJudul}
            kalimat={t.jamKunciIsi}
            labelAksi={t.gabung}
            baris={4}
            onBuka={ajakanBuka}
          />
        ) : jam ? (
          <>
            <ChartJam jam={jam.jam} jamPuncak={jam.jam_puncak} />
            <p className="mt-2 text-[13.5px] leading-snug text-ink-2">
              {jam.jam_puncak !== null ? (
                <>
                  {t.palingRamai}{' '}
                  <span className="tabular font-semibold">
                    {String(jam.jam_puncak).padStart(2, '0')}:00
                  </span>
                  .{' '}
                  {jam.dominasi === 'captive'
                    ? t.jamCaptive
                    : jam.dominasi === 'choice'
                      ? t.jamChoice
                      : t.jamSeimbang}
                </>
              ) : (
                t.jamTakAda
              )}
            </p>
            {jam.catatan && (
              <p className="mt-1.5 flex gap-1.5 text-[13px] leading-snug text-ink-3">
                <span
                  aria-hidden
                  className="arsir mt-[3px] h-3 w-3 shrink-0 rounded-[2px] border border-line-2"
                />
                {jam.catatan}
              </p>
            )}
          </>
        ) : (
          /* "Profil jam belum tersedia" tidak memberi tahu apa pun kepada
             orang yang baru saja membayar untuk melihatnya. Terukur 30 Agu
             2026: `hex_hourly_profiles` NOL baris untuk 708 heksagon - jadi
             ini bukan keadaan sesekali melainkan keadaan satu-satunya, dan
             pelanggan berhak tahu bahwa yang kurang bukan koneksinya. */
          <div className="text-[13px] leading-relaxed text-ink-2">
            <p className="font-medium text-ink">{t.jamNolJudul}</p>
            <Rinci ringkas={t.kenapaBelum}>{t.jamNolIsi}</Rinci>
          </div>
        )}
      </Bagian>

      {/* --- 4. RiskRadar ---------------------------------------------------
          Tiga keadaan, bukan dua. `AMAN` sengaja diam — peringatan yang selalu
          muncul berhenti dibaca. `TIDAK_DIKETAHUI` TIDAK boleh ikut diam:
          diam di situ berarti pembaca menyimpulkan "sudah diperiksa, aman"
          dari sesuatu yang tidak pernah diperiksa. Ia dapat satu baris tenang,
          persis seperti zona RDTR yang diizinkan. */}
      {risiko.tingkat === 'TIDAK_DIKETAHUI' && (
        <Bagian judul={t.risikoJudul} nada="bahaya" ikon={<path d="M1.8 8h3l1.6-4 2.6 8 1.6-4h3.6"/>}>
          <Kosong teks={t.risikoKosong} />
        </Bagian>
      )}

      {(risiko.tingkat === 'WASPADA' || risiko.tingkat === 'BAHAYA') && (
        <Bagian judul={t.risikoJudul} nada="bahaya" ikon={<path d="M1.8 8h3l1.6-4 2.6 8 1.6-4h3.6"/>}>
          <div className="flex gap-2.5 rounded-sm border border-bahaya/25 bg-bahaya-soft p-2.5">
            <span
              aria-hidden
              className={`mt-0.5 h-4 w-4 shrink-0 rounded-xs ${
                risiko.tingkat === 'BAHAYA' ? 'bg-bahaya' : 'border-2 border-bahaya'
              }`}
            />
            <div>
              <p className="text-[14px] font-semibold text-bahaya">{risiko.label}</p>
              <p className="mt-0.5 text-[13.5px] leading-snug text-ink-2">{t.risikoIsi}</p>
            </div>
          </div>
        </Bagian>
      )}

      {/* --- 5. Empat indeks ------------------------------------------------ */}
      {/* --- Empat hal yang dinilai ----------------------------------------
          Ditulis ulang 30 Agustus 2026, dan yang berubah bukan cuma kata-katanya.

          Versi lama menampilkan empat angka desimal - "akses ke stasiun 0,79",
          "biaya dan risiko 0,49" - dengan keterangan "tinggi = buruk" di
          sebagiannya. Dua hal salah sekaligus di situ.

          Pertama, angkanya tidak menjawab pertanyaan siapa pun. Orang yang
          sedang menimbang ruko tidak bertanya "berapa indeks potensi transit
          di sini", ia bertanya "berapa menit jalan kaki ke stasiun" - dan
          angka itu ADA, sudah diambil, dan sudah tampil beberapa baris di atas.

          Kedua, dan ini yang lebih serius: variabel kosong DINETRALKAN ke 0,5,
          bukan dinolkan. Terukur atas 708 heksagon, hanya 1% bobot "perputaran
          uang" dan 5% bobot "biaya dan risiko" yang benar-benar berasal dari
          pengukuran. Sisanya nilai tengah. Jadi "0,487" di layar berarti
          "belum diketahui", dan tidak ada satu pun cara pembacanya bisa tahu.
          Itu keluarga kesalahan yang sama dengan badge yang dulu mengaku
          disurvei dan RiskRadar yang menyebut AMAN untuk lokasi tanpa data.

          Sekarang: kata, bukan desimal; angka sungguhan kalau ada; dan indeks
          yang bahannya belum terukur MENGATAKANNYA. */}
      <Bagian judul={t.empatJudul} nada="gem" ikon={<><rect x="2.2" y="2.2" width="5" height="5" rx="1.2"/><rect x="8.8" y="2.2" width="5" height="5" rx="1.2"/><rect x="2.2" y="8.8" width="5" height="5" rx="1.2"/><rect x="8.8" y="8.8" width="5" height="5" rx="1.2"/></>}>
        {/* BERBAYAR sejak 11 Sep 2026, keputusan pemilik repo. Nilainya ditahan
            DI SERVER - `detail.indeks.*` benar-benar null untuk yang belum
            membayar, bukan dikirim lalu diburamkan. Tirainya digambar dari
            `terkunci`, yaitu dari keadaan backend, bukan dari tebakan di sini. */}
        {detail.terkunci.includes('indeks') ? (
          <Terkunci
            judul={t.empatJudul}
            kalimat={t.empatKunciIsi}
            labelAksi={t.gabung}
            baris={4}
            onBuka={ajakanBuka}
            aksiKedua={
              akun ? (
                <button
                  onClick={ajakanBuka}
                  className="cursor-pointer text-[11.5px] text-ink-3 underline underline-offset-2 hover:text-ink-2"
                >
                  {t.atauToken}
                </button>
              ) : undefined
            }
          />
        ) : (
        <>
        {/* Dipendekkan 3 Sep 2026 dari empat baris jadi satu. Yang hilang cuma
            pengulangan: "dihitung di luar aplikasi, sekali" sudah dinyatakan
            lagi di kaki panel, dan pembacanya belum tahu apa itu "pipeline"
            saat membaca baris pertama. */}
        <p className="mb-3 text-[13px] leading-snug text-ink-2">{t.empatPembuka}</p>
        {(
          [
            ['IPT', indeks.ipt],
            ['IAE', indeks.iae],
            ['IKP', indeks.ikp],
            ['IBR', indeks.ibr],
          ] as const
        ).map(([kode, nilai]) => {
          const cakupan = indeks.cakupan?.[kode]
          // Belum layak tampil = bahannya nyaris seluruhnya kosong. Angkanya
          // ADA (0,487) tetapi ia nilai tengah, bukan temuan.
          const terukur = cakupan ? cakupan.layak_tampil : nilai !== null
          const kata = terukur ? ist.kata(kode, nilai) : null
          const baik = TINGGI_BAIK[kode]
          // Angka sungguhan yang sudah kita punya, gratis, untuk baris ini.
          const fakta =
            kode === 'IPT' && konteks?.simpul && konteks.menit_jalan !== null
              ? t.faktaJalan(Math.round(konteks.menit_jalan), konteks.simpul.nama)
              : null

          return (
            <div key={kode} className="border-t border-line-2 py-2.5 first:border-t-0 first:pt-0">
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="text-[14px] font-medium text-ink first-letter:uppercase">
                  {ist.indeks(kode)}
                </span>
                {kata ? (
                  <span className="shrink-0 text-[14px] font-semibold text-ink">{kata}</span>
                ) : (
                  <span className="shrink-0 text-[13px] text-ink-3">{t.belumTerukur}</span>
                )}
              </div>
              <p className="mb-1.5 text-[11.5px] leading-snug text-ink-3">{ist.tanya(kode)}</p>
              {terukur ? (
                <>
                  <div className="h-1.5 overflow-hidden rounded-full bg-ground-2">
                    <div
                      className={`h-full rounded-full ${baik ? 'bg-gem' : 'bg-jebakan'}`}
                      style={{ width: `${Math.min(100, Math.max(3, (nilai ?? 0) * 100))}%` }}
                    />
                  </div>
                  {fakta && (
                    <p className="mt-1.5 text-[12.5px] text-ink-2">
                      <strong className="font-semibold text-ink">{fakta}</strong>
                    </p>
                  )}
                  {cakupan && cakupan.terukur < cakupan.total && (
                    <Rinci ringkas={t.bahanTerukur(cakupan.terukur, cakupan.total)}>
                      {t.belumAda(cakupan.kosong.map((k) => keKalimat(ist.kode(k))).join(', '))}
                    </Rinci>
                  )}
                </>
              ) : (
                <div>
                  <p className="text-[12.5px] leading-snug text-ink-3">
                    {cakupan ? t.butuhSurvei : t.tanpaData}
                  </p>
                  {cakupan && (
                    <Rinci ringkas={t.apaSaja}>
                      {cakupan.kosong.map((k) => keKalimat(ist.kode(k))).join(', ')}.
                    </Rinci>
                  )}
                </div>
              )}
            </div>
          )
        })}
        </>
        )}
      </Bagian>

      {/* --- 6. Faktor ------------------------------------------------------
          Bagian ini dan yang di bawahnya BERBAYAR. Tabel fitur menempatkan
          "pembongkaran data mendalam hingga variabel granular pembentuk indeks"
          di kolom berbayar; ringkasan di atas - skor, kuadran, Commuter Clock,
          RiskRadar, ZoneGuard - tetap gratis dan tidak pernah tertutup tirai. */}
      {terkunci ? (
        <Bagian judul={t.faktorJudul} nada="gem" ikon={<path d="M3 13V9.4M8 13V3.4M13 13V6.6"/>}>
          <Terkunci
            judul={t.faktorKunciJudul}
            kalimat={t.faktorKunciIsi}
            labelAksi={t.gabung}
            baris={4}
            onBuka={ajakanBuka}
            aksiKedua={
              <button
                onClick={ajakanBuka}
                className="cursor-pointer text-[11.5px] text-ink-3 underline underline-offset-2 hover:text-ink-2"
              >
                {t.atauToken}
              </button>
            }
          />
        </Bagian>
      ) : (
        faktor.length > 0 && (
        <Bagian judul={t.faktorJudul} nada="gem" ikon={<path d="M3 13V9.4M8 13V3.4M13 13V6.6"/>}>
          {/* Batang persentil, bukan kalimat. (3 Sep 2026.)

              Bentuk lama menulis "Keragaman jenis usaha — lebih tinggi
              daripada 17 dari 100 lokasi lain" lalu menaruh nama indeksnya di
              kanan. Dua cacatnya nyata.

              Pertama, enam kalimat sepanjang itu berturut-turut menuntut
              DIBACA untuk bisa dibandingkan - padahal yang ditanyakan
              pembacanya "mana yang menarik skornya naik" , dan itu pertanyaan
              tentang panjang, bukan tentang kata.

              Kedua, dan ini yang membuatnya terbaca kacau: baris yang
              PERSENTILNYA KOSONG kehilangan seluruh kalimatnya dan tinggal dua
              nama berdempetan - "Penumpang stasiun per hari" lalu "akses ke
              stasiun" - tanpa satu angka pun dan tanpa penanda apa pun bahwa
              yang hilang itu datanya. Sekarang ia mengatakannya. */}
          <ul className="space-y-2.5">
            {faktor.slice(0, 6).map((f) => {
              const kurang = f.indeks === 'IKP' || f.indeks === 'IBR'
              const p = f.persentil
              return (
                <li key={f.kode_variabel}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className="min-w-0 flex-1 truncate text-[13px] text-ink-2"
                      title={`${f.kode_variabel} · ${ist.indeks(f.indeks)}`}
                    >
                      {ist.kode(f.kode_variabel)}
                    </span>
                    {p === null ? (
                      <span className="shrink-0 text-[11.5px] italic text-ink-3">
                        {t.takTerukur}
                      </span>
                    ) : (
                      <span className="tabular shrink-0 text-[12.5px] font-semibold text-ink">
                        {p.toFixed(0)}
                        <span className="font-normal text-ink-3">/100</span>
                      </span>
                    )}
                  </div>
                  {/* Rel tetap digambar walau kosong: baris tanpa rel akan
                      terlihat seperti baris yang hilang, bukan seperti angka
                      yang belum ada. */}
                  <div className="mt-1 h-[7px] overflow-hidden rounded-full bg-ground-2">
                    {p !== null && (
                      <div
                        className={`h-full rounded-full ${kurang ? 'bg-jebakan' : 'bg-gem'}`}
                        style={{ width: `${Math.min(100, Math.max(3, p))}%` }}
                      />
                    )}
                  </div>
                  <p className="mt-1 text-[11px] leading-none text-ink-3">
                    {ist.indeks(f.indeks)}
                    {p !== null && (kurang ? t.makinBeban : t.makinBaik)}
                  </p>
                </li>
              )
            })}
          </ul>
        </Bagian>
        )
      )}

      {/* --- 7. Variabel lengkap -------------------------------------------- */}
      {terkunci ? (
        <Bagian judul={t.tabelJudul} nada="netral" ikon={<><rect x="2.2" y="2.8" width="11.6" height="10.4" rx="1.6"/><path d="M2.2 6.4h11.6M6.6 6.4v6.8"/></>}>
          <Terkunci
            judul={t.tabelJudul}
            kalimat={t.tabelKunciIsi}
            labelAksi={t.gabung}
            baris={6}
            onBuka={ajakanBuka}
          />
        </Bagian>
      ) : (
      <Bagian judul={t.tabelJudul} nada="netral" ikon={<><rect x="2.2" y="2.8" width="11.6" height="10.4" rx="1.6"/><path d="M2.2 6.4h11.6M6.6 6.4v6.8"/></>}>
        <details className="group">
          <summary className="cursor-pointer list-none text-[14px] text-ink-2 underline decoration-line-2 underline-offset-2 hover:text-ink">
            {t.tabelBuka}
          </summary>
          {/* Tabel data adalah jalur alternatif untuk grafik di atas — pembaca
              layar dan pengguna yang tidak membedakan warna tetap bisa membaca
              seluruh angkanya. */}
          <div className="scroll-tipis mt-2 max-h-64 overflow-y-auto rounded-sm border border-line">
            <table className="w-full text-[13px]">
              <tbody>
                {Object.entries(detail.variabel).map(([nama, nilai], i) => {
                  // Nama benda, bukan nama kolom. "pop 100m" tidak berarti apa
                  // pun bagi calon pemilik warung; "Penduduk di sekitar"
                  // berarti. Kodenya tetap ada sebagai judul tooltip untuk yang
                  // perlu menelusuri ke Kamus Data.
                  const arti = ist.variabel(nama)
                  return (
                    <tr key={nama} className={i % 2 ? 'bg-surface-2' : ''}>
                      <td className="px-2 py-1 text-ink-2" title={arti?.kode ?? nama}>
                        {arti?.nama ?? nama.replace(/_/g, ' ')}
                      </td>
                      <td className="tabular px-2 py-1 text-right whitespace-nowrap">
                        {nilai === null || nilai === undefined ? (
                          <Kosong teks="—" />
                        ) : typeof nilai === 'boolean' ? (
                          nilai ? t.ya : t.tidak
                        ) : typeof nilai === 'number' ? (
                          <>
                            {angka(nilai, nilai < 10 ? 2 : 0)}
                            {arti?.satuan && (
                              <span className="ml-1 text-[11px] font-normal text-ink-3">
                                {arti.satuan}
                              </span>
                            )}
                          </>
                        ) : (
                          String(nilai)
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </details>
      </Bagian>
      )}

      {/* --- 8. Riwayat skor (berbayar) ------------------------------------ */}
      <Bagian judul={t.riwayatJudul} nada="netral" ikon={<><path d="M2.6 8a5.4 5.4 0 1 0 1.7-3.9"/><path d="M2.3 2.8v3.4h3.4"/></>}>
        <BagianRiwayat h3={h3} />
      </Bagian>

      {/* --- 9. Cara menuju ke sini ----------------------------------------

          Pindah ke PALING BAWAH (3 Sep 2026, permintaan pemilik repo). Di
          tempat lamanya - terselip di atas angka "35 menit jalan kaki" - ia
          terbaca sebagai bagian dari keterangan itu dan bukan sebagai kendali
          yang bisa ditekan. Berdiri sendiri sebagai bagian bernama, ia
          mengumumkan dirinya.

          Tombol yang datanya belum ada DINONAKTIFKAN, bukan disembunyikan.
          Menyembunyikannya menyatakan "rute mobil tidak ada di produk ini";
          yang benar "rute mobil belum ditarik untuk lokasi ini". Dua pernyataan
          yang sangat berbeda, dan yang kedua yang jujur.

          Motor tidak ada dan tidak akan pernah ada: ORS tidak menyediakan
          profilnya, dan menyodorkan mobil sebagai "kira-kira motor" salah ke
          arah yang paling merugikan - motor melewati gang yang mobil tidak.
          SEPEDA berdiri di tempatnya sejak 11 Sep 2026, dengan namanya sendiri
          dan waktu tempuh yang diukur profil sepedanya sendiri. */}
      {/* --- Kenapa masuk kuadran ini ----------------------------------------
          Turun ke SINI, sesudah simulasi.

          Ia penjelasan, bukan pembuka: ia menjawab "kenapa angkanya begitu",
          dan pertanyaan itu baru muncul sesudah orang tahu angkanya berapa
          dan bisa apa dengan lokasi ini. */}
      {posisi?.x != null && posisi.y != null && batas?.x != null && batas.y != null && (
        detail.terkunci.includes('kuadran') ? (
          /* BERBAYAR sejak 11 Sep 2026. Yang ditahan DI SERVER kalimat
             penjelasan kuadrannya (`kuadran_penjelasan` benar-benar null);
             bagian ini menyembunyikan pembacaannya.

             SATU HAL SENGAJA DIBIARKAN DI LUAR TIRAI: kalimat yang menyebut
             sumbu prestise berdiri di atas bahan apa. Ia bukan fitur melainkan
             PENGAKUAN bahwa dua dari lima bahannya kosong di seluruh wilayah
             studi - dan pengakuan tidak boleh jadi barang dagangan. Kuadrannya
             sendiri sudah tergambar gratis di peta; menagih keterangan mutunya
             berarti menjual kuadran tanpa peringatannya. */
          <div className="mt-3">
            <Bagian judul={t.kuadranJudul} nada="gem" ikon={<path d="M8 2v12M2 8h12"/>}>
              <Terkunci
                judul={t.kuadranJudul}
                kalimat={t.kuadranKunciIsi}
                labelAksi={t.gabung}
                baris={3}
                onBuka={ajakanBuka}
                aksiKedua={
                  akun ? (
                    <button
                      onClick={ajakanBuka}
                      className="cursor-pointer text-[11.5px] text-ink-3 underline underline-offset-2 hover:text-ink-2"
                    >
                      {t.atauToken}
                    </button>
                  ) : undefined
                }
              />
              {frasaPrestise(detail.cakupan_prestise, 'lokasi', ist.bahasa) && (
                <p className="mt-2.5 border-t border-line/60 pt-2 text-[11.5px] leading-snug text-ink-3">
                  {frasaPrestise(detail.cakupan_prestise, 'lokasi', ist.bahasa)}
                </p>
              )}
            </Bagian>
          </div>
        ) : (
        <div className="mt-3 rounded-sm border border-line/70 bg-surface-2/60 px-3 py-2.5">
          <p className="eyebrow mb-2.5">{t.kuadranJudul}</p>
          <SumbuKuadran
            label={t.sumbuY}
            kalimat={posisi.y >= batas.y ? t.sumbuYAtas : t.sumbuYBawah}
            nilai={posisi.y}
            batas={batas.y}
            maks={100}
            tampilNilai={t.dari100(posisi.y.toFixed(0))}
            tinggiBaik
          />
          {/* "Diperkirakan tampak", bukan "terlihat".
              Kalimat lamanya berbunyi "Bangunan dan tokonya TERLIHAT lebih
              mahal" - dan itu mengaku ada yang melihat. Tidak ada: dari lima
              bahan sumbu ini, dua yang menilai tampilan secara langsung (M03
              dari foto, P02 dari nilai tanah) kosong di seluruh 708 heksagon,
              jadi posisinya disimpulkan dari bentuk bangunan dan porsi
              waralaba. Kesimpulan yang masuk akal - tetapi kesimpulan, dan
              bedanya harus terbaca. `catatan` menyebut bahan yang tersisa itu
              apa saja; ia dibangkitkan, jadi ia ikut berubah begitu M03 masuk
              dan hilang sendiri begitu kelimanya terisi. */}
          <div className="mt-2.5">
            <SumbuKuadran
              label={t.sumbuX}
              kalimat={posisi.x >= batas.x ? t.sumbuXAtas : t.sumbuXBawah}
              catatan={frasaPrestise(detail.cakupan_prestise, 'lokasi', ist.bahasa)}
              nilai={posisi.x}
              batas={batas.x}
              maks={1}
              tampilNilai={posisi.x >= batas.x ? t.diAtasRata : t.diBawahRata}
            />
          </div>
          <div className="mt-2 border-t border-line/60 pt-1.5">
            <Rinci ringkas={t.garisTegak}>{t.garisTegakIsi}</Rinci>
          </div>
        </div>
        )
      )}

      <p className="px-4 pb-6 pt-1 text-[12.5px] leading-snug text-ink-3">{t.kaki}</p>
    </div>
  )
}

/** Gembok kecil, dipakai di dalam tombol yang belum terbuka. */
function Gembok() {
  return (
    <svg width="10" height="10" viewBox="0 0 20 20" aria-hidden className="shrink-0 opacity-70">
      <path d="M6 9V6.5a4 4 0 0 1 8 0V9" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="4.5" y="9" width="11" height="7.5" rx="2" fill="currentColor" />
    </svg>
  )
}

/**
 * Tombol aksi berbentuk lingkaran.
 *
 * `gembok` menandai yang belum terbuka tetapi TIDAK menonaktifkan tombolnya:
 * tombol mati tidak bisa menjelaskan dirinya, dan yang dibutuhkan orang yang
 * menekannya justru penjelasan. Yang ditekan tetap merespons — dengan dialog
 * yang mengatakan apa yang kurang.
 */
function TombolBulat({
  label,
  onClick,
  aktif,
  sibuk,
  gembok,
  children,
}: {
  label: string
  onClick: () => void
  aktif?: boolean
  sibuk?: boolean
  gembok?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={sibuk}
      title={label}
      aria-label={label}
      className={`relative grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full border transition-all duration-300 ease-jelly hover:scale-105 disabled:cursor-wait disabled:opacity-60 ${
        aktif
          ? 'border-gem bg-gem-soft text-gem'
          : 'border-line text-ink-2 hover:border-line-2 hover:text-ink'
      }`}
    >
      {sibuk ? (
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-line-2 border-t-ink" />
      ) : (
        <svg width="17" height="17" viewBox="0 0 20 20" aria-hidden>
          {children}
        </svg>
      )}
      {gembok && !sibuk && (
        <span className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-surface text-ink-3 shadow-[0_0_0_1px_var(--color-line)]">
          <Gembok />
        </span>
      )}
    </button>
  )
}
