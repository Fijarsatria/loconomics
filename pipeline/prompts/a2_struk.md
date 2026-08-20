# A2 — Ekstraktor Nominal & Waktu dari Foto Struk

Prioritas WAJIB. Mengisi **B09 nominal_median_struk**, **B01–B04 commuter clock**,
dan **B06 pangsa_digital**.

Berkas ini adalah prompt produksi. Kode membaca berkas ini, bukan menyalin isinya.
Nama field di bawah harus sama persis dengan `HasilStruk` di `s3_extract.py`.

---

## System

Anda membaca foto struk belanja dari toko di Indonesia. Tugas Anda mengubah isi
struk menjadi data terstruktur.

Kembalikan **JSON saja**, tanpa penjelasan, tanpa blok kode.

Skema:

```json
{
  "total_nominal": 47500,
  "jumlah_item": 3,
  "daftar_item": [
    {"nama": "Nasi Goreng", "qty": 1, "harga": 25000},
    {"nama": "Es Teh Manis", "qty": 2, "harga": 11250}
  ],
  "nama_merchant_terbaca": "WARUNG BU TITIN",
  "tanggal_terbaca": "2026-08-14",
  "waktu_terbaca": "18:42",
  "metode_bayar": "qris",
  "confidence": 0.88
}
```

## Aturan

1. **`total_nominal` adalah TOTAL yang benar-benar dibayar**, bukan subtotal,
   bukan harga satu item, bukan kembalian, bukan uang tunai yang diserahkan.
   Kalau struk memuat diskon, ambil angka setelah diskon. Kalau ada baris
   "TUNAI" dan "KEMBALI", yang diambil tetap baris TOTAL.

2. **`waktu_terbaca` menentukan Commuter Clock.** Format 24 jam `HH:MM`. Kalau
   struk hanya menulis tanggal tanpa jam, isi `null` — struk itu masih berguna
   untuk B09 tetapi tidak boleh masuk ke B01–B04. Jangan pernah menebak jam dari
   konteks ("kelihatannya sore"), karena itu persis variabel yang jadi pembeda
   produk ini.

3. **`metode_bayar`** hanya boleh salah satu dari: `tunai`, `qris`, `debit`,
   `kartu_kredit`, `ewallet`, `tidak_disebut`. QRIS/GoPay/OVO/DANA/ShopeePay
   dihitung sebagai pembayaran digital di B06. Kalau ragu, isi `tidak_disebut` —
   bukan `tunai`. Struk `tidak_disebut` dikeluarkan dari penyebut B06, tidak
   dihitung sebagai non-digital.

4. **Normalkan satuan.** `47.500`, `Rp47.500`, `47,500` semuanya menjadi `47500`.
   Titik di Indonesia adalah pemisah ribuan, bukan desimal.

5. **`tanggal_terbaca`** format `YYYY-MM-DD`. Kalau struk menulis `14/08/26`,
   baca sebagai hari/bulan/tahun (konvensi Indonesia), bukan bulan/hari. Kalau
   tahun ambigu atau tidak tertulis, isi `null`.

6. **`daftar_item`** diisi sebisanya; kalau struk terlalu buram untuk dirinci,
   kosongkan saja. Yang wajib benar hanya `total_nominal` dan `waktu_terbaca`.

7. **`confidence`** adalah keyakinan terhadap `total_nominal` dan `waktu_terbaca`,
   bukan terhadap kualitas foto. Di bawah 0,7 masuk antrean verifikasi manusia.

## User

Konteks dari baris data yang sama (boleh membantu membaca,
**tidak boleh** menggantikan apa yang tertulis di struk):

- Nama Usaha: `{nama_usaha}`
- Kategori Usaha: `{kategori}`
- Waktu Survei: `{waktu_survei}`

Foto: `{foto_url}`

---

## Validasi

| Tahap | Cara |
|---|---|
| Skema | Pydantic `HasilStruk`. JSON tidak valid → ulang maks. 2x dengan pesan kesalahan dikembalikan ke model |
| Ambang | `confidence < 0.7` → antrean verifikasi manusia |
| Kewajaran nominal | `< Rp1.000` atau `> Rp5.000.000` per struk ritel → ditandai anomali |
| Kewajaran jam | Di luar 04:00–02:00 → ditandai, kemungkinan salah baca |
| **Silang otomatis** | `nama_merchant_terbaca`, `tanggal_terbaca`, `waktu_terbaca` dicocokkan dengan kolom yang diisi manual surveyor di baris data yang sama |

Baris terakhir layak disebut saat presentasi: struk memuat tiga hal yang **juga**
diisi manual oleh surveyor di kolom terpisah. Artinya A2 punya mekanisme
pengecekan otomatis tanpa perlu pelabelan manual sama sekali — kemewahan yang
jarang dimiliki dataset lain.

## Catatan penggunaan

`waktu_terbaca` adalah **satu-satunya** sumber untuk B01–B04. Data POI komersial
mana pun hanya menyimpan jam buka-tutup, bukan kapan transaksi benar-benar
terjadi. Perbedaan keduanya itulah alasan Commuter Clock bisa dibuat.
