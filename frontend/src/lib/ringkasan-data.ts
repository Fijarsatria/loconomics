/**
 * DIBUAT OTOMATIS oleh `pipeline/s7_publish.py --ekspor`. Jangan disunting tangan.
 *
 * Halaman gerbang menyebut angka soal cakupan datanya sendiri. Angka yang
 * ditulis tangan di sana sudah pernah kedaluwarsa ke arah yang paling
 * merugikan — mengaku 43 variabel saat 25 yang terisi, menjanjikan profil
 * per jam saat tabelnya nol baris. Yang dihitung tidak bisa ketinggalan.
 *
 * Untuk menyegarkannya:
 *
 *   cd pipeline && python s7_publish.py --ekspor
 */

export interface SumberData {
  nama: string
  lisensi: string
  url: string
  /** Variabel yang diisinya, dengan kode kanonik Kamus Data. */
  mengisi: string
  /** Heksagon yang benar-benar disentuh; null kalau tidak diukur per heksagon. */
  cakupan: number | null
}

export interface DeretTemuan {
  label: string
  nilai: number
  /** Batang yang jadi pokok temuannya; diberi warna aksen, bukan netral. */
  tekan?: boolean
}

export interface Temuan {
  /** Kunci stabil untuk React. Tidak pernah tampil di layar. */
  kunci: string
  /** Dugaan wajar yang dibantah pengukurannya. */
  dugaan: string
  /** Temuannya sebagai satu kalimat, angkanya sudah di dalam. */
  judul: string
  /** Angka yang dicetak besar, sudah berformat Indonesia. */
  angka: string
  satuan: string
  /** Bagaimana diukurnya, dan apa yang tidak bisa disimpulkan darinya. */
  uraian: string
  /** Yang berubah di produk karena temuan ini. */
  akibat: string
  deret: DeretTemuan[]
  deretSatuan: string
  /** Angka desimal saat deretnya dicetak. */
  desimal: number
}

/** Tanggal basis data dibaca. Dinyatakan apa adanya di halamannya. */
export const DIUKUR = "2026-09-01"

export const RINGKASAN = {
  heksagon: 708,
  kawasan: 6,
  variabelTerisi: 25,
  variabelTotal: 43,
  heksagonBersurvei: 25,
  titikMisiDitarik: 988,
  observasiMisi: 33,
  poiOsm: 3444,
  ruteOrs: 1549,
  kawasanJangkau: 18,
  simpul: 6,
  profilJam: 0,
} as const

export const SUMBER: SumberData[] = [
  { nama: "MAPID Community Maps (Activity)", lisensi: "Data kompetisi MAPID", url: "https://mapid.co.id/data-catalog", mengisi: "D12 aktivitas komunitas", cakupan: 7 },
  { nama: "MAPID Mission — Menu Go, Struk Go, Properti Go", lisensi: "Data kompetisi MAPID", url: "https://mapid.co.id/data-catalog", mengisi: "B06–B08, C07, C08, D10, P03, dan badge keyakinan Q01–Q03", cakupan: 25 },
  { nama: "MAPID Maps", lisensi: "Basemap kompetisi", url: "https://geo.mapid.io/", mengisi: "Basemap peta — empat gaya, seluruh ubin", cakupan: null },
  { nama: "OpenStreetMap contributors", lisensi: "ODbL 1.0", url: "https://www.openstreetmap.org/copyright", mengisi: "C01–C06 kompetisi, D05 skor simpul, D08, D09, M01, M02", cakupan: 708 },
  { nama: "openrouteservice", lisensi: "CC BY-SA 4.0", url: "https://openrouteservice.org/", mengisi: "D03 jarak dan D04 waktu jalan kaki, plus kawasan jangkau", cakupan: 703 },
  { nama: "WorldPop 2020 (UN-adjusted, constrained)", lisensi: "CC BY 4.0", url: "https://www.worldpop.org/", mengisi: "D01 jumlah penduduk, dan C06 yang bergantung padanya", cakupan: 707 },
  { nama: "RDTR ATR/BPN lewat GISTARU", lisensi: "Data terbuka pemerintah", url: "https://gistaru.atrbpn.go.id/rdtrinteraktif/", mengisi: "L01 izin komersial, L02 kelas zona, L03 risiko banjir", cakupan: 364 },
]

/** Diturunkan dari basis data, bukan didaftar tangan. Lihat docstring pembangkitnya. */
export const BATASAN: string[] = [
  "18 dari 43 variabel belum punya sumber yang bisa dikutip. Nilainya dibiarkan kosong, bukan dinolkan — indeks yang bahannya kosong dinetralkan ke tengah skala, dan antarmuka menuliskan “belum terukur” alih-alih menampilkan angkanya.",
  "Zonasi RDTR baru terbit untuk 364 dari 708 heksagon. Kota Depok dan Kota Bekasi terkonfirmasi belum punya RDTR digital di GISTARU lewat dua indeks yang berbeda, jadi ZoneGuard diam untuk keduanya alih-alih menebak.",
  "Profil per jam masih kosong. Struk misi MAPID tidak membawa kolom waktu transaksi sama sekali — jamnya tercetak di dalam foto struknya, dan pembacaan foto itu belum dijalankan.",
  "Survei lapangan menyentuh 25 dari 708 heksagon; 683 sisanya ditandai “belum dikunjungi surveyor”. Itu pernyataan tentang kunjungan, bukan tentang mutu angkanya — POI, rute, penduduk, dan zonasi tetap hasil pengukuran.",
]

/**
 * Empat kali pengukuran membantah dugaan yang wajar. Seluruhnya — termasuk
 * KALIMATNYA — dirangkai `s7_publish.hitung_temuan()` dari basis data.
 *
 * Temuan yang bahannya tidak ada tidak diterbitkan, jadi daftar ini boleh
 * lebih pendek. Komponen yang membacanya wajib tahan terhadap daftar kosong.
 */
export const TEMUAN: Temuan[] = [
  {"kunci": "rute", "dugaan": "Jarak lurus ke stasiun cukup untuk memperkirakan jalan kakinya.", "judul": "Rute jalan kaki rata-rata 1,78× lebih panjang daripada garis lurusnya", "angka": "1,78×", "satuan": "rata-rata rute memutar", "uraian": "703 rute tercepat dihitung openrouteservice dari pusat tiap heksagon ke simpul terdekatnya, lalu dibandingkan dengan jarak lurus ke titik yang sama. Median 1,53×, dan yang terjauh memutar 7,07× — 161 heksagon harus berjalan dua kali lipat jarak lurusnya atau lebih. Tidak satu pun rute lebih pendek daripada garis lurusnya (0 dari 703), dan itu invarian yang sengaja diuji: kalau ada, lintang dan bujurnya tertukar.", "akibat": "Garis lurus putus-putus dicabut dari peta. Yang tergambar sekarang jalur yang benar-benar bisa dijalani, dan menit yang tertulis di panel dibaca dari jalur itu.", "deret": [{"label": "di bawah 1,2×", "nilai": 17}, {"label": "1,2–1,5×", "nilai": 310}, {"label": "1,5–2×", "nilai": 215}, {"label": "2× ke atas", "nilai": 161, "tekan": true}], "deretSatuan": "heksagon", "desimal": 0},
  {"kunci": "jangkau", "dugaan": "Stasiun yang lebih sibuk menjangkau kawasan yang lebih luas.", "judul": "Stasiun Manggarai justru punya kawasan jangkau tersempit — 3,1× lebih kecil daripada MRT Dukuh Atas BNI", "angka": "0,96 km²", "satuan": "jangkauan 15 menit Stasiun Manggarai", "uraian": "Kawasan jangkau ditarik dari openrouteservice sebagai isochrone berjalan kaki, lalu luasnya diukur di atas geografi bumi. Dalam 15 menit, Stasiun Manggarai hanya menjangkau 9 dari 708 heksagon, sementara MRT Dukuh Atas BNI menjangkau 28. Bukan soal ukuran stasiunnya: emplasemen rel yang lebar memotong jalan kaki ke segala arah, dan yang tersisa cuma dua sisi peron.", "akibat": "Kawasan jangkau digambar sebagai bentuk yang diukur, bukan sebagai lingkaran berjari-jari sekian meter. Lingkaran akan menjanjikan pembeli dari arah yang tidak ada jalannya.", "deret": [{"label": "Stasiun Manggarai · KRL", "nilai": 0.96, "tekan": true}, {"label": "LRT Harjamukti · LRT", "nilai": 1.5}, {"label": "Stasiun Bekasi · KRL", "nilai": 2.31}, {"label": "Stasiun Depok Baru · KRL", "nilai": 2.79}, {"label": "Stasiun Tanah Abang · KRL", "nilai": 2.85}, {"label": "MRT Dukuh Atas BNI · MRT", "nilai": 3.0}], "deretSatuan": "km² dalam 15 menit", "desimal": 2},
  {"kunci": "pemetaan", "dugaan": "Heksagon tanpa kompetitor terpetakan berarti pasar yang belum terlayani.", "judul": "OpenStreetMap memetakan Dukuh Atas BNI 16× lebih rapat daripada Harjamukti", "angka": "318", "satuan": "dari 708 heksagon tanpa satu pun usaha terpetakan", "uraian": "6,26 POI usaha per heksagon di Dukuh Atas BNI, melawan 0,39 di Harjamukti. Sebagian selisih itu memang kenyataan — kawasan yang belum matang memang lebih sepi. Sebagian lagi kerapatan PEMETAANNYA, dan dari data saja keduanya tidak bisa dipisahkan. 101 dari 127 heksagon Harjamukti tercatat nol kompetitor.", "akibat": "Insight “sepi pesaing” dijaga syarat kepadatan POI di atas nol. Lubang data tidak pernah boleh disodorkan sebagai alasan memilih lokasi — itu persis Hidden Gem palsu yang jadi alasan produk ini ada.", "deret": [{"label": "Dukuh Atas BNI", "nilai": 6.26}, {"label": "Tanah Abang", "nilai": 5.54}, {"label": "Manggarai", "nilai": 4.16}, {"label": "Depok Baru", "nilai": 1.55}, {"label": "Bekasi", "nilai": 0.9}, {"label": "Harjamukti", "nilai": 0.39, "tekan": true}], "deretSatuan": "POI usaha per heksagon", "desimal": 2},
  {"kunci": "zonasi", "dugaan": "Peruntukan lahan bisa disimpulkan dari apa yang terlihat berdiri di sana.", "judul": "13 heksagon berskor nol karena zonasinya — dan 417 lainnya sengaja tidak dinilai sama sekali", "angka": "13", "satuan": "heksagon dinolkan zonasinya", "uraian": "Zonasi RDTR ATR/BPN disampel per POLIGON heksagon dan ditimbang menurut luas perpotongannya, bukan ditanyakan di satu titik tengah — satu heksagon Manggarai memotong lima poligon di empat zona berbeda, dan titik tengahnya hanya menjawab salah satunya. Hasilnya 278 heksagon diizinkan, 13 dilarang, dan 417 belum punya RDTR digital sama sekali.", "akibat": "Yang dilarang berskor nol berapa pun angka ekonominya, dan tidak pernah muncul di daftar rekomendasi. Yang belum berzona dinyatakan “belum bisa dipastikan” — diam yang jujur, bukan tebakan aman.", "deret": [{"label": "Diizinkan", "nilai": 278}, {"label": "Dilarang", "nilai": 13, "tekan": true}, {"label": "RDTR belum terbit", "nilai": 417}], "deretSatuan": "heksagon", "desimal": 0},
]
