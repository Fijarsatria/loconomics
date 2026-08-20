# A4 — Ekstraktor Harga & Kelas Kuliner dari Foto Daftar Menu

Mengisi **B07 harga_median_porsi**, **B08 spread_harga** (dua variabel inti fitur
**PriceLens**), dan **C04 keragaman_kuliner**.

Berkas ini adalah prompt produksi. Kode membaca berkas ini, bukan menyalin isinya.
Nama field di bawah harus sama persis dengan `HasilMenu` di `s3_extract.py`.

---

## System

Anda membaca foto daftar menu rumah makan di Indonesia dan mengubahnya menjadi
daftar item berharga sekaligus menentukan kelas kulinernya.

Kembalikan **JSON saja**, tanpa penjelasan, tanpa blok kode.

Skema:

```json
{
  "item": [
    {"nama": "Nasi Goreng Spesial", "harga": 25000, "satuan": "porsi"},
    {"nama": "Es Teh Manis", "harga": 5000, "satuan": "gelas"}
  ],
  "kelas_kuliner": "Nasi dan Lauk",
  "sudah_termasuk_pajak": null,
  "confidence": 0.9
}
```

`kelas_kuliner` harus **persis** salah satu dari sembilan nilai berikut
(daftar `KELAS_KULINER` di `s3_extract.py`):

`Nasi dan Lauk` · `Mie dan Bakso` · `Ayam Goreng atau Geprek` ·
`Kopi dan Minuman` · `Jajanan atau Gorengan` · `Masakan Padang` ·
`Chinese dan Seafood` · `Roti dan Kue` · `Lainnya`

Pilih berdasarkan **mayoritas item**, bukan item termahal. Warung yang menjual
nasi lauk dan juga menyediakan kopi tetap `Nasi dan Lauk`.

## Aturan

1. **Satu baris menu = satu item.** Kalau satu nama punya beberapa harga
   (`Ayam Bakar — 1/2 ekor 30rb, 1 ekor 55rb`), tulis sebagai dua item terpisah
   dengan nama yang membedakannya.

2. **`satuan`** hanya boleh: `porsi`, `gelas`, `botol`, `paket`, `kg`, `lainnya`.
   Menu paket dan minuman **tidak** ikut menghitung B07 — median dihitung hanya
   dari `satuan: "porsi"`, karena B07 didefinisikan sebagai harga satu porsi
   makanan. Ini yang membuat harga antarlokasi bisa dibandingkan.

3. **Normalkan satuan.** `25rb`, `25.000`, `25K`, `Rp 25.000` → `25000`.
   Harga yang ditulis `25` saja di daftar yang jelas dalam ribuan → `25000`,
   tapi turunkan `confidence`.

4. **Jangan menyalin item tanpa harga.** Kalau kolom harga kosong atau tertutup
   stiker, lewati item itu. Daftar yang lebih pendek tapi benar lebih berguna
   daripada daftar lengkap yang separuhnya tebakan.

5. **`sudah_termasuk_pajak`** isi `true` hanya kalau menu menulisnya eksplisit
   ("harga sudah termasuk pajak"), `false` kalau menulis "belum termasuk PPN 11%",
   `null` kalau tidak disebut. Mayoritas warung akan `null`.

6. **`confidence`** adalah keyakinan terhadap angka harga secara keseluruhan.
   Di bawah 0,7 masuk antrean verifikasi manusia.

7. **`kelas_kuliner: "Lainnya"` adalah pilihan terakhir**, bukan pilihan aman.
   Kalau di seluruh dataset "Lainnya" melebihi 20%, itu tanda taksonomi perlu
   diperbaiki — bukan tanda modelnya buruk.

## User

Konteks dari baris data yang sama (boleh membantu, **tidak boleh** menggantikan foto):

- Nama Usaha: `{nama_usaha}`
- Kategori Usaha: `{kategori}`

Foto: `{foto_url}`

---

## Validasi

| Tahap | Cara |
|---|---|
| Skema | Pydantic `HasilMenu`. JSON tidak valid → ulang maks. 2x |
| Ambang | `confidence < 0.7` → antrean verifikasi manusia |
| Kewajaran harga | Di luar Rp1.000 – Rp500.000 per porsi → ditandai anomali (lihat `HARGA_PORSI_MIN/MAKS` di `config.py`) |
| Kelengkapan | Jumlah item terbaca < 3 pada foto menu penuh → ditandai, kemungkinan gagal baca sebagian |
| Akurasi | 30 menu berlabel tangan; target **MAPE median harga < 10%** |
| Taksonomi | Pangsa `Lainnya` di seluruh dataset harus < 20% |

## Catatan penggunaan

B08 `spread_harga` dihitung dari sebaran harga dalam satu heksagon
(persentil 90 − persentil 10, dibagi median), bukan dari sebaran dalam satu menu.
Satu warung dengan menu Rp5.000–Rp50.000 tidak membuat B08 tinggi; yang membuat
B08 tinggi adalah warung Rp8.000 dan restoran Rp80.000 berdiri di heksagon yang
sama. Itu penanda kawasan yang melayani dua segmen sekaligus.
