/**
 * Katalog jenis usaha - SATU daftar untuk seluruh antarmuka.
 *
 * Dipindah dari `Simulasi.tsx` 13 Sep 2026 karena daftar ini dipakai TIGA
 * tempat: simulasi usaha, pertanyaan preferensi sesudah mendaftar, dan
 * simulasi per blok. Sebelum dipindah, layar preferensi memegang salinannya
 * sendiri - EMPAT jenis, sisa sebelum daftar ini diperluas jadi enam belas -
 * dan pemilik repo melaporkannya sebagai "belum di-update". Dua salinan dari
 * daftar yang sama selalu berakhir seperti itu.
 *
 * Berkas `lib/`, bukan diekspor dari `Simulasi.tsx`: Simulasi dimuat malas,
 * dan satu impor statis darinya menyeret seluruh modul simulasi ke bundel
 * pertama.
 */

/**
 * Enam belas jenis usaha, dikelompokkan.
 *
 * Diperluas 3 September 2026 dari empat. Dengan empat, pemilik bengkel,
 * apotek, atau bimbel harus memilih "Jasa" dan mewarisi margin barbershop -
 * dan bawaan yang salah lebih buruk daripada tidak ada bawaan, karena ia
 * terbaca sebagai perkiraan untuk usahanya padahal perkiraan untuk usaha
 * orang lain.
 *
 * `kelompok` hanya menyusun tampilannya. Ia tidak menyentuh satu pun angka.
 *
 * WAJIB sama dengan `JENIS_USAHA` di `backend/app/core/simulasi.py` - backend
 * MENOLAK jenis yang tidak dikenalnya, jadi satu baris yang tertinggal di sini
 * bukan sekadar pilihan yang hilang melainkan tombol yang menghasilkan galat.
 * Dijaga `backend/tests/test_aturan.py`.
 */
export const JENIS_USAHA = [
  // --- Makanan & minuman ---------------------------------------------------
  {
    nilai: 'kuliner_ringan',
    kelompok: 'Makanan & minuman',
    label: 'Kopi & jajanan',
    labelEn: 'Coffee & snacks',
    contoh: 'kedai kopi, roti bakar, es teh',
    contohEn: 'coffee shop, toast, iced tea',
    glif: 'M5 7h9v5a4.5 4.5 0 0 1-9 0Zm9 1h1.6a1.9 1.9 0 0 1 0 3.8H14M4 17.5h11',
  },
  {
    nilai: 'warung_makan',
    kelompok: 'Makanan & minuman',
    label: 'Warung makan',
    labelEn: 'Rice & noodle stall',
    contoh: 'nasi, mi ayam, soto',
    contohEn: 'rice, chicken noodles, soto',
    glif: 'M5 4v6a2 2 0 0 0 4 0V4M7 10v9M13.5 4c-1 2-1.5 4-1.5 6a2 2 0 0 0 2 2v7',
  },
  {
    nilai: 'restoran',
    kelompok: 'Makanan & minuman',
    label: 'Restoran & kafe',
    labelEn: 'Restaurant & cafe',
    contoh: 'tempat duduk, pelayan, dapur',
    contohEn: 'seating, waiters, a kitchen',
    glif: 'M3 5.5h14v3H3ZM4.5 8.5v8a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-8M8 12h4',
  },
  {
    nilai: 'bakery',
    kelompok: 'Makanan & minuman',
    label: 'Roti & kue',
    labelEn: 'Bakery & cakes',
    contoh: 'bakery, toko kue, donat',
    contohEn: 'bakery, cake shop, donuts',
    glif: 'M3 12.5c0-3 3.1-5.5 7-5.5s7 2.5 7 5.5v2.5H3ZM6.5 7.2 7.6 4.5M10 6.8V4M13.5 7.2 12.4 4.5',
  },
  // --- Ritel ---------------------------------------------------------------
  {
    nilai: 'retail_kecil',
    kelompok: 'Ritel',
    label: 'Kelontong & ATK',
    labelEn: 'Grocery & stationery',
    contoh: 'sembako, fotokopi, pulsa',
    contohEn: 'staples, photocopying, phone credit',
    glif: 'M3.5 7h13l-1 10h-11ZM7 7V5.5a3 3 0 0 1 6 0V7',
  },
  {
    nilai: 'minimarket',
    kelompok: 'Ritel',
    label: 'Minimarket',
    labelEn: 'Minimarket',
    contoh: 'swalayan, 24 jam',
    contohEn: 'self-service, open 24 hours',
    glif: 'M2.5 7.5 4 4h12l1.5 3.5ZM3.5 7.5V16h13V7.5M7.5 16v-4.5h5V16',
  },
  {
    nilai: 'fesyen',
    kelompok: 'Ritel',
    label: 'Fesyen & aksesoris',
    labelEn: 'Fashion & accessories',
    contoh: 'distro, butik, tas, sepatu',
    contohEn: 'streetwear, boutique, bags, shoes',
    glif: 'M7.5 3.5 10 5.5l2.5-2 4 2.5-1.5 3-1.5-.8V17h-7V8.2l-1.5.8-1.5-3Z',
  },
  {
    nilai: 'elektronik',
    kelompok: 'Ritel',
    label: 'Gawai & elektronik',
    labelEn: 'Phones & electronics',
    contoh: 'konter HP, servis, aksesori',
    contohEn: 'phone counter, repairs, accessories',
    glif: 'M6.5 2.5h7a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 5 16V4a1.5 1.5 0 0 1 1.5-1.5ZM8.8 14.8h2.4',
  },
  {
    nilai: 'bangunan',
    kelompok: 'Ritel',
    label: 'Bahan bangunan',
    labelEn: 'Building materials',
    contoh: 'material, cat, perkakas',
    contohEn: 'materials, paint, tools',
    glif: 'M12.5 3.5a3.5 3.5 0 0 0-4.6 4.4L3 12.8 5.2 15l4.9-4.9a3.5 3.5 0 0 0 4.4-4.6l-2 2-1.9-1.9Z',
  },
  // --- Jasa ----------------------------------------------------------------
  {
    nilai: 'jasa',
    kelompok: 'Jasa',
    label: 'Jasa harian',
    labelEn: 'Everyday services',
    contoh: 'barbershop, laundry, servis',
    contohEn: 'barbershop, laundry, repairs',
    glif: 'M6 4.5 14 15M14 4.5 6 15M4 16.5a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm8 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z',
  },
  {
    nilai: 'kecantikan',
    kelompok: 'Jasa',
    label: 'Salon & perawatan',
    labelEn: 'Salon & beauty',
    contoh: 'salon, spa, nail art',
    contohEn: 'salon, spa, nail art',
    glif: 'M10 2.5c2.2 2.6 3.3 4.8 3.3 6.6a3.3 3.3 0 0 1-6.6 0c0-1.8 1.1-4 3.3-6.6ZM6 17.5h8',
  },
  {
    nilai: 'kesehatan',
    kelompok: 'Jasa',
    label: 'Apotek & klinik',
    labelEn: 'Pharmacy & clinic',
    contoh: 'apotek, praktik dokter, lab',
    contohEn: 'pharmacy, GP practice, lab',
    glif: 'M10 5.5v9M5.5 10h9M4 5.2A1.2 1.2 0 0 1 5.2 4h9.6A1.2 1.2 0 0 1 16 5.2v9.6a1.2 1.2 0 0 1-1.2 1.2H5.2A1.2 1.2 0 0 1 4 14.8Z',
  },
  {
    nilai: 'pendidikan',
    kelompok: 'Jasa',
    label: 'Bimbel & kursus',
    labelEn: 'Tutoring & courses',
    contoh: 'les, kursus bahasa, komputer',
    contohEn: 'tutoring, language courses, computing',
    glif: 'M2.5 7 10 3.5 17.5 7 10 10.5ZM5.5 8.6V13c0 1.4 2 2.5 4.5 2.5s4.5-1.1 4.5-2.5V8.6',
  },
  {
    nilai: 'otomotif',
    kelompok: 'Jasa',
    label: 'Bengkel & cuci',
    labelEn: 'Workshop & car wash',
    contoh: 'servis motor, cuci mobil, ban',
    contohEn: 'bike service, car wash, tyres',
    glif: 'M3 12.5h14M4.5 12.5 6 7.5h8l1.5 5M5 12.5V15M15 12.5V15M6.5 15h1M12.5 15h1',
  },
  {
    nilai: 'hiburan',
    kelompok: 'Jasa',
    label: 'Gim, gym & hiburan',
    labelEn: 'Games, gym & leisure',
    contoh: 'warnet, biliar, fitness',
    contohEn: 'internet cafe, billiards, fitness',
    glif: 'M3 10.5a3.5 3.5 0 0 1 3.5-3.5h7a3.5 3.5 0 0 1 0 7h-7A3.5 3.5 0 0 1 3 10.5ZM6 9v3M4.5 10.5h3M13 9.5h.01M14.8 11.3h.01',
  },
  {
    nilai: 'logistik',
    kelompok: 'Jasa',
    label: 'Agen paket',
    labelEn: 'Parcel agent',
    contoh: 'ekspedisi, titik ambil, kurir',
    contohEn: 'couriers, pickup point, delivery',
    glif: 'M3 6.5 10 3.5l7 3v7l-7 3-7-3ZM3 6.5l7 3 7-3M10 9.5V16.5',
  },
] as const

/** Urutan kelompok di layar. Ditulis TETAP, bukan diturunkan dari JENIS_USAHA:
 *  urutan kemunculan gampang berubah tanpa ada yang menyadarinya. */
export const KELOMPOK_JENIS = ['Makanan & minuman', 'Ritel', 'Jasa'] as const

/** Bawaan per jenis usaha. Sama dengan JENIS_USAHA di backend — dijaga uji. */
export const BAWAAN: Record<string, { jam: number; luas: number; margin: number }> = {
  kuliner_ringan: { jam: 12, luas: 12, margin: 35 },
  warung_makan: { jam: 11, luas: 24, margin: 28 },
  restoran: { jam: 12, luas: 60, margin: 30 },
  bakery: { jam: 12, luas: 20, margin: 38 },
  retail_kecil: { jam: 12, luas: 18, margin: 20 },
  minimarket: { jam: 16, luas: 80, margin: 18 },
  fesyen: { jam: 10, luas: 30, margin: 45 },
  elektronik: { jam: 10, luas: 20, margin: 15 },
  bangunan: { jam: 9, luas: 60, margin: 22 },
  jasa: { jam: 10, luas: 16, margin: 45 },
  kecantikan: { jam: 10, luas: 30, margin: 55 },
  kesehatan: { jam: 12, luas: 35, margin: 25 },
  pendidikan: { jam: 8, luas: 45, margin: 50 },
  otomotif: { jam: 10, luas: 50, margin: 40 },
  hiburan: { jam: 12, luas: 70, margin: 50 },
  logistik: { jam: 10, luas: 12, margin: 30 },
}
