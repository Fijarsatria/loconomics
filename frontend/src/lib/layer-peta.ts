/**
 * Aturan pewarnaan peta tematik — satu tempat, dipakai dua tempat.
 *
 * Berkas ini lahir 23 Agustus 2026 dengan memindahkan tabel-tabelnya keluar dari
 * `PetaInteraktif.tsx`. Dua alasan, dan keduanya nyata:
 *
 *   DUA PEMAKAI. Halaman gerbang menampilkan enam kartu peta dengan lima layer
 *   berbeda. Selama tabel ini tinggal di dalam komponen peta, satu-satunya cara
 *   memakainya dari gerbang adalah menyalinnya - dan dua salinan aturan
 *   pewarnaan akan berpisah tanpa ada yang menyadarinya, karena tidak ada satu
 *   pun uji yang membandingkan keduanya.
 *
 *   FAST REFRESH. Mengekspornya langsung dari `PetaInteraktif.tsx` memang
 *   berhasil, tapi berkas yang mengekspor komponen SEKALIGUS nilai lain
 *   kehilangan hot reload: tiap kali `PetaInteraktif.tsx` disunting, seluruh
 *   halaman dimuat ulang, peta dibangun dari nol, dan posisi gulir hilang. Di
 *   komponen yang paling sering disunting di repo ini, itu ongkos harian.
 *
 * Yang ada di sini hanya TABEL dan satu fungsi pembaca gaya - tidak ada yang
 * menyentuh state peta, tidak ada yang bisa dipanggil untuk mengubah apa pun.
 * Pemakainya membangun petanya sendiri; yang dipinjam cuma cara mewarnainya.
 */

import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl'

import { ABU_HINDARI, KUADRAN, type NamaGaya, type NamaLayer } from '../config'

/** Warna kuadran untuk kanvas peta - harfiah, bukan var(). Lihat config.ts. */
const q = (k: string) => KUADRAN[k].warnaPeta

/**
 * Basemap yang gelap. Bukan sekadar soal selera tema: hampir semua keputusan
 * warna di bawah punya dua jawaban, dan yang menentukan jawabannya adalah
 * terang-gelapnya basemap, bukan tema sistem.
 */
/*
 * Sembilan nilai di bawah DIEKSPOR, dan itu keputusan yang diambil 23 Agustus
 * 2026 sesudah menolaknya sekali.
 *
 * Penolakan pertama benar untuk keadaannya waktu itu: halaman gerbang cuma
 * butuh satu layer, dan menyalin satu ekspresi ke sana lebih murah daripada
 * membuka isi perut komponen ini. Sekarang gerbang menampilkan ENAM kartu peta
 * dengan LIMA layer berbeda, dan menyalin berarti dua salinan lengkap dari
 * seluruh aturan pewarnaan - yang cepat atau lambat berpisah tanpa ada yang
 * menyadarinya, karena tidak ada satu pun uji yang membandingkan keduanya.
 *
 * Yang diekspor sengaja hanya TABEL, bukan perilaku: tidak ada fungsi yang
 * menyentuh state peta, tidak ada yang bisa dipanggil untuk mengubah apa pun.
 * Pemakainya membangun petanya sendiri; yang dipinjam cuma cara mewarnainya.
 */
export const BASEMAP_GELAP: NamaGaya[] = ['gelap']

/**
 * Selubung penenang basemap, per gaya.
 *
 * Versi pertama memakai satu nilai untuk semua: putih 58%. Di basemap terang itu
 * benar. Di basemap GELAP hasilnya bencana - latar MAPID rgba(13,13,13) berubah
 * jadi abu-abu medium, dan label gelap gaya itu (rgb(101,101,101), halo hitam)
 * berakhir sebagai teks abu di atas abu. Persis keluhan "gelapnya jelek".
 *
 * Selubung harus SEARAH dengan basemapnya: memutihkan yang terang, menghitamkan
 * yang gelap.
 */
export const SELUBUNG: Record<NamaGaya, { warna: string; opasitas: number }> = {
  terang: { warna: '#ffffff', opasitas: 0.48 },
  dasar: { warna: '#ffffff', opasitas: 0.45 },
  jalan: { warna: '#ffffff', opasitas: 0.45 },
  gelap: { warna: '#000000', opasitas: 0.3 },
}

/** Garis batas heksagon harus melawan basemap, bukan menyatu dengannya. */
export const GARIS_HEX = (gaya: NamaGaya) =>
  BASEMAP_GELAP.includes(gaya) ? '#eef3f0' : '#16211c'

/**
 * Angka di dalam heksagon: teks gelap berhalo terang, atau kebalikannya.
 *
 * Halo bukan hiasan. Isian heksagon separuh tembus pandang, jadi di belakang
 * angka bisa ada jalan putih, atap gelap, atau air - dan teks tanpa halo akan
 * hilang di salah satunya. Halo membuat angkanya terbaca di atas apa pun.
 */
export const TEKS_HEX = (gaya: NamaGaya) =>
  BASEMAP_GELAP.includes(gaya)
    ? { warna: '#f2f6f4', halo: 'rgba(12,18,15,0.85)' }
    : { warna: '#16211c', halo: 'rgba(255,255,255,0.9)' }

/**
 * Warna lapisan fokus: garis ke stasiun dan nomor heksagon pembanding.
 *
 * Harus melawan basemap, bukan menyatu dengannya — dan basemap gelap menuntut
 * jawaban yang berlawanan dari basemap terang. Sama alasannya dengan
 * `GARIS_HEX` dan `TEKS_HEX` di atas.
 */
export const WARNA_FOKUS = (gaya: NamaGaya) =>
  BASEMAP_GELAP.includes(gaya)
    ? { garis: '#f2f6f4', isi: '#f2f6f4', teks: '#12211f', halo: 'rgba(12,18,15,0.9)' }
    : { garis: '#16211c', isi: '#16211c', teks: '#ffffff', halo: 'rgba(255,255,255,0.92)' }

/**
 * Warna rute jalan kaki, satu per nomor pembanding.
 *
 * Empat warna karena baki komparasi menampung empat. Urutannya MENGIKAT: warna
 * ke-i dipakai lencana nomor i+1 di peta, kolom ke-i di bar komparasi, dan rute
 * heksagon itu. Kalau ketiganya tidak sepakat, nomor di peta berhenti berarti.
 *
 * Dipilih supaya terbaca di atas keempat basemap MAPID sekaligus - jadi bukan
 * warna kuadran, yang sengaja lembut supaya heksagon tidak berteriak. Rute
 * justru harus berteriak: ia cuma muncul saat diminta, dan cuma sebentar.
 */
export const WARNA_RUTE = ['#0f766e', '#b45309', '#7c3aed', '#be123c'] as const

/**
 * Warna rute saat TIDAK sedang membandingkan - satu heksagon terpilih saja.
 *
 * Dibedakan dari WARNA_RUTE[0] dengan sengaja: kalau warnanya sama, orang yang
 * baru mengklik satu heksagon akan mengira dirinya sudah membandingkan sesuatu.
 */
export const WARNA_RUTE_TUNGGAL = (gaya: NamaGaya) =>
  BASEMAP_GELAP.includes(gaya) ? '#5eead4' : '#0d5c53'

/** Warna jalur alternatif. Selalu lebih redup dari yang utama, di gaya mana pun. */
export const WARNA_RUTE_ALT = (gaya: NamaGaya) =>
  BASEMAP_GELAP.includes(gaya) ? 'rgba(226,240,236,0.62)' : 'rgba(28,52,45,0.42)'

/**
 * Kawasan jangkau jalan kaki. Sengaja BUKAN warna kuadran maupun warna rute.
 *
 * Isochrone menjawab pertanyaan yang berbeda dari keduanya - bukan "seberapa
 * bagus lokasi ini" dan bukan "lewat mana ke stasiun", melainkan "sejauh mana
 * orang mau berjalan". Memberinya warna yang sudah punya arti lain akan membuat
 * ketiganya terbaca sebagai satu skala.
 */
export const WARNA_ISO = (gaya: NamaGaya) =>
  BASEMAP_GELAP.includes(gaya) ? '#93c5fd' : '#1d4ed8'

/** Garis putih/gelap di BAWAH rute, supaya ia terbaca di atas isian apa pun. */
export const WARNA_RUTE_BAYANG = (gaya: NamaGaya) =>
  BASEMAP_GELAP.includes(gaya) ? 'rgba(8,14,12,0.85)' : 'rgba(255,255,255,0.92)'

/** Font yang PASTI ada di gaya MAPID - diverifikasi ke style.json-nya. */
export const FONT_ANGKA = ['Metropolis Regular', 'Noto Sans Regular']

/**
 * Apa yang dicetak di dalam heksagon, per layer.
 *
 * Bukan selalu skor peluang: di PriceLens yang dicari orang harga, dan angka
 * skor di sana justru menjawab pertanyaan yang tidak sedang ditanyakan. Yang
 * kosong dicetak sebagai string kosong - TIDAK sebagai 0.
 */
export const ANGKA_LAYER: Record<NamaLayer, ExpressionSpecification> = {
  opportunity: [
    'case',
    ['==', ['get', 'opportunity_score'], null], '',
    ['to-string', ['round', ['get', 'opportunity_score']]],
  ] as unknown as ExpressionSpecification,
  // Indeks churn dua desimal - satuannya 0..1, jadi membulatkannya ke bilangan
  // bulat akan menghasilkan "0" untuk hampir semua heksagon.
  risk_radar: [
    'case',
    ['==', ['get', 'indeks_churn'], null], '',
    ['to-string', ['/', ['round', ['*', ['get', 'indeks_churn'], 100]], 100]],
  ] as unknown as ExpressionSpecification,
  // Skor gem 0..1 dinaikkan ke 0..100 supaya sebaris dengan skor lain di layar.
  hidden_gem: [
    'case',
    ['==', ['get', 'hidden_gem_score'], null], '',
    ['to-string', ['round', ['*', ['get', 'hidden_gem_score'], 100]]],
  ] as unknown as ExpressionSpecification,
  // Ribuan rupiah. "168" jauh lebih terbaca di dalam heksagon daripada "168429".
  pricelens: [
    'case',
    ['==', ['get', 'harga_sewa_per_m2'], null], '',
    ['concat', ['to-string', ['round', ['/', ['get', 'harga_sewa_per_m2'], 1000]]], 'rb'],
  ] as unknown as ExpressionSpecification,
  // Zonasi bukan angka. Tiga keadaan, tiga tanda - dan yang ketiga WAJIB
  // berbeda dari keduanya: null berarti belum ada RDTR digital, bukan larangan.
  zoneguard: [
    'case',
    ['==', ['get', 'zona_izin_komersial'], true], '✓',
    ['==', ['get', 'zona_izin_komersial'], false], '✕',
    '?',
  ] as unknown as ExpressionSpecification,
}



/**
 * Perhentian gradasi RiskRadar - satu-satunya tempat angkanya ditulis.
 *
 * Diekspor karena legendanya harus menerangkan warna yang BENAR-BENAR dipakai
 * peta. Sebelum ini legenda RiskRadar tidak ada sama sekali: layer itu
 * dikeluarkan dari Kompas Kuadran saat pewarnaannya pindah ke indeks churn,
 * tetapi tidak ada yang menggantikannya - jadi peta memakai gradasi yang tidak
 * dijelaskan apa pun. Legenda yang menyalin angkanya sendiri akan berpisah dari
 * petanya cepat atau lambat, dan tidak ada uji yang bisa menangkapnya.
 */
export const CHURN_STOP = [
  { nilai: 0.1, warna: '#dcece4', label: 'jarang berganti' },
  { nilai: 0.35, warna: KUADRAN.JEBAKAN_GENGSI.warnaPeta, label: 'mulai sering' },
  { nilai: 0.6, warna: KUADRAN.HINDARI.warnaPeta, label: 'sering berganti' },
] as const

/** Warna isian per layer tematik. Satu tempat, lima aturan. */
export const WARNA_LAYER: Record<NamaLayer, ExpressionSpecification> = {
  // Kuadran, bukan gradasi skor. Empat kategori terbaca sekilas; gradasi 0–100
  // menuntut mata membandingkan dua warna serupa untuk tahu mana yang lebih baik.
  opportunity: [
    'match',
    ['get', 'kuadran'],
    'HIDDEN_GEM', q('HIDDEN_GEM'),
    'PEMENANG_JELAS', q('PEMENANG_JELAS'),
    'JEBAKAN_GENGSI', q('JEBAKAN_GENGSI'),
    // HINDARI kini merah, bukan abu-abu. Yang tanpa kuadran sama sekali - baris
    // yang belum diskor - tetap abu-abu, dan bedanya penting: "sudah dihitung,
    // hasilnya jelek" tidak boleh terlihat sama dengan "belum dihitung".
    'HINDARI', q('HINDARI'),
    ABU_HINDARI,
  ],

  // Hanya yang punya skor gem yang berwarna. Sisanya diabukan supaya jawabannya
  // berupa daftar pendek yang tegas, bukan peta penuh warna yang harus ditafsirkan.
  hidden_gem: [
    'case',
    ['==', ['get', 'hidden_gem_score'], null], ABU_HINDARI,
    ['interpolate', ['linear'], ['get', 'hidden_gem_score'], 0, KUADRAN.HIDDEN_GEM.lembut, 1, q('HIDDEN_GEM')],
  ],

  // RiskRadar diwarnai oleh INDEKS CHURN, bukan oleh kuadran.
  //
  // Versi sebelumnya cuma menyorot kuadran JEBAKAN_GENGSI, dan itulah sebabnya
  // layer ini terlihat "sama saja" dengan Skor Peluang: keduanya membaca kolom
  // yang sama. Padahal RiskRadar punya datanya sendiri - `indeks_churn`,
  // seberapa sering usaha berganti di heksagon itu - dan itu variabel yang
  // sepenuhnya lain dari skor peluang maupun prestise visual.
  //
  // Gradasi, bukan kategori: ambang WASPADA/BAHAYA dihitung per kawasan
  // (persentil 75 dan 90), dan satu ekspresi peta tidak bisa membawa enam
  // ambang berbeda sekaligus. Gradasi menampilkan angkanya apa adanya dan
  // membiarkan penilaian ambangnya dilakukan di panel detail, tempat kawasannya
  // sudah diketahui.
  risk_radar: [
    'case',
    ['==', ['get', 'indeks_churn'], null], ABU_HINDARI,
    [
      'interpolate', ['linear'], ['get', 'indeks_churn'],
      ...CHURN_STOP.flatMap((s) => [s.nilai, s.warna]),
    ],
  ] as unknown as ExpressionSpecification,

  // Sekuensial satu rona: murah terang, mahal gelap. Tanpa data tetap abu —
  // "sewanya murah" dan "belum ada yang mensurvei" tidak boleh sewarna.
  pricelens: [
    'case',
    ['==', ['get', 'harga_sewa_per_m2'], null], ABU_HINDARI,
    [
      'interpolate', ['linear'], ['get', 'harga_sewa_per_m2'],
      50_000, '#e4ece9',
      150_000, '#7ea79c',
      400_000, '#2c4f45',
    ],
  ],

  // Tiga status, tiga perlakuan. NULL TIDAK disamakan dengan FALSE.
  zoneguard: [
    'case',
    ['==', ['get', 'zona_izin_komersial'], true], '#8fbfb2',
    ['==', ['get', 'zona_izin_komersial'], false], '#b42318',
    ABU_HINDARI,
  ],
}

/**
 * Opasitas isian per layer.
 *
 * Hanya layer `opportunity` yang memudarkan HINDARI, karena "hindari" adalah
 * gagasan kuadran. Di layer ZoneGuard, heksagon berkuadran HINDARI yang zonanya
 * terlarang justru HARUS terlihat penuh - memudarkannya berarti menyembunyikan
 * peringatan yang paling penting di layar hanya karena skor ekonominya rendah.
 */
/**
 * Opasitas isian per layer.
 *
 * Dinaikkan 21 Agustus 2026 atas permintaan pemilik repo: pada nilai lama
 * (0,56 untuk isian utama) heksagon terbaca sebagai kabut berwarna di atas
 * basemap, bukan sebagai lapisan data. Yang RENDAH sengaja tetap rendah -
 * jaraknya dengan yang tinggi itulah yang membuat "ada apa-apa di sini" dan
 * "tidak ada apa-apa di sini" terbaca tanpa membaca legenda.
 */
export const OPASITAS_LAYER: Record<NamaLayer, number | ExpressionSpecification> = {
  // HINDARI diberi opasitas lebih rendah dari tiga lainnya walau kini berwarna.
  // 241 dari 708 heksagon jatuh di sana; disamakan, peta berubah jadi lautan
  // merah dan tiga kuadran yang justru berisi keputusan ikut tenggelam.
  //
  // Seluruh angka diturunkan ~20% pada 24 Agustus 2026, permintaan pemilik
  // repo: pada 0,78-0,82 isian heksagon menelan jalan dan blok bangunan di
  // bawahnya, dan peta berhenti terbaca sebagai peta. Batas bawahnya nyata -
  // di bawah ~0,55 warna kuadran mulai tercampur warna basemap dan Kompas
  // Kuadran menerangkan warna yang tidak lagi ada di layar. 0,60-0,66 adalah
  // rentang tempat keduanya masih benar. Yang kosong (0,11) tidak disentuh.
  //
  // Diturunkan ~25% lagi pada 3 September 2026, permintaan ketiga pemilik repo
  // dengan alasan yang sama seperti dua kali sebelumnya: jalan dan blok
  // bangunan masih tertelan isian.
  //
  // Turunan ketiga ini AMAN justru karena dua turunan sebelumnya sudah membayar
  // ongkosnya di muka. Yang menahan bentuk heksagon sejak 24 Agustus bukan lagi
  // isiannya melainkan garis batasnya (1,4 px / 0,85) - jadi peringatan lama
  // "di bawah 0,55 warna kuadran melebur ke basemap" tidak berlaku di sini: ia
  // ditulis untuk isian yang berdiri sendirian.
  //
  // Yang TIDAK ikut turun: heksagon kosong (0,08). Jarak antara "terukur" dan
  // "belum ada data" harus tetap terbaca tanpa membuka legenda, dan menurunkan
  // keduanya bersama-sama justru memampatkan jarak itu.
  opportunity: ['case', ['==', ['get', 'kuadran'], 'HINDARI'], 0.18, 0.33],
  hidden_gem: ['case', ['==', ['get', 'hidden_gem_score'], null], 0.08, 0.36],
  risk_radar: ['case', ['==', ['get', 'indeks_churn'], null], 0.08, 0.34],
  pricelens: ['case', ['==', ['get', 'harga_sewa_per_m2'], null], 0.08, 0.36],
  // ZoneGuard turun paling sedikit. Ia satu-satunya layer yang menyatakan
  // LARANGAN, dan larangan yang nyaris tidak terlihat berhenti jadi larangan.
  zoneguard: 0.34,
}

/**
 * Diturunkan lagi ~30% pada 24 Agustus 2026, permintaan kedua pemilik repo:
 * pada 0,62 isian heksagon masih menelan jalan dan blok bangunan, dan peta
 * berhenti terbaca sebagai peta.
 *
 * Catatan lama di CLAUDE.md memperingatkan bahwa di bawah ~0,55 warna kuadran
 * mulai tercampur warna basemap. Peringatan itu benar untuk isian yang berdiri
 * SENDIRIAN - dan itulah yang diubah bersamaan di sini: garis batas heksagon
 * dinaikkan dari 1px/0,55 jadi 1,4px/0,85 (lihat `TEBAL_GARIS` dan
 * `OPASITAS_GARIS`). Yang menahan bentuk heksagon sekarang garisnya, bukan
 * isiannya, jadi isian boleh jauh lebih tipis tanpa membuat petak-petaknya
 * melebur.
 */
export const TEBAL_GARIS = 1.4
export const OPASITAS_GARIS = 0.85

/**
 * Cari layer tempat heksagon harus disisipkan: tepat setelah isian dan garis
 * basemap terakhir, sebelum labelnya.
 */
export function idLabelPertama(m: MapLibreMap): string | undefined {
  const layers = m.getStyle().layers ?? []
  let terakhirBukanSymbol = -1
  layers.forEach((l, i) => {
    if (l.type !== 'symbol' && l.type !== 'background') terakhirBukanSymbol = i
  })
  return layers[terakhirBukanSymbol + 1]?.id
}

