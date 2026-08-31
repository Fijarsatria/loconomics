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

/** Tanggal basis data dibaca. Dinyatakan apa adanya di halamannya. */
export const DIUKUR = "2026-08-31"

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
