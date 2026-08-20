# Data

## 1. Empat tingkat satuan analisis

```
Simpul transit (±120–150 titik)
    └── Catchment isochrone jalan kaki 5 / 10 / 15 menit
            └── Heksagon H3 resolusi 9   ← SATUAN UTAMA
                    └── POI individual
```

**Kenapa heksagon, bukan kelurahan?** Batas administratif tidak ada hubungannya
dengan perilaku belanja. Satu kelurahan bisa berisi stasiun sekaligus perkampungan
sepi, dan rata-ratanya menyembunyikan keduanya. Heksagon res-9 berukuran ±0,10 km²
(lebar ±350 m) — kira-kira sejauh orang mau berjalan kaki sambil membawa belanjaan.

**Kenapa heksagon, bukan kotak?** Enam tetangga heksagon semuanya berjarak sama
dari pusat. Pada kotak, empat tetangga berjarak *s* dan empat lagi *s√2*.
Perbedaan itu merusak setiap perhitungan yang melibatkan tetangga — dan hampir
semua perhitungan di sini melibatkan tetangga.

## 2. Kamus Data Final — 41 variabel

Kode variabel (D01, B07, …) adalah **identitas kanonik**. Nama kolom adalah
implementasinya di tabel `hex_features`. Jembatan keduanya: `KODE_KE_KOLOM` di
`pipeline/config.py`, yang di-`assert` harus berisi tepat 41 entri.

### Dimensi Permintaan — 12 variabel

| Kode | Kolom | Arti | Sumber |
|---|---|---|---|
| D01 | `pop_100m` | Populasi radius 100 m | WorldPop / BPS |
| D02 | `pop_usia_produktif` | Populasi 15–64 tahun | BPS |
| D03 | `jarak_simpul_m` | Jarak ke simpul terdekat | Hitungan spasial |
| D04 | `waktu_jalan_menit` | Waktu jalan kaki ke simpul | OSMnx isochrone |
| D05 | `skor_simpul` | Bobot pentingnya simpul | Turunan |
| D06 | `ridership_proksi` | Proksi jumlah penumpang | Turunan |
| D07 | `kepadatan_kos` | Kepadatan kos/rumah sewa | OSM + misi |
| D08 | `kepadatan_kantor` | Kepadatan perkantoran | OSM |
| D09 | `generator_keramaian` | Sekolah, RS, pasar, masjid besar | OSM |
| D10 | `skor_ramai_terkoreksi` | Keramaian terkoreksi jam survei | Misi MAPID |
| D11 | `intensitas_transaksi` | Transaksi per satuan waktu | Misi Struk |
| D12 | `aktivitas_komunitas` | Aktivitas komunitas/keagamaan | OSM + misi |

### Dimensi Perilaku Konsumen — 9 variabel

| Kode | Kolom | Arti | Sumber |
|---|---|---|---|
| B01 | `puncak_pagi` | Pangsa transaksi 05–09 | **A2** (jam di struk) |
| B02 | `puncak_siang` | Pangsa transaksi 11–14 | **A2** |
| B03 | `puncak_sore` | Pangsa transaksi 16–19 | **A2** |
| B04 | `puncak_malam` | Pangsa transaksi 19–23 | **A2** |
| B05 | `rasio_weekend` | Akhir pekan vs hari kerja | Misi |
| B06 | `pangsa_digital` | Pangsa pembayaran non-tunai | **A2** |
| B07 | `harga_median_porsi` | Median harga satu porsi | **A4** |
| B08 | `spread_harga` | Sebaran harga dalam heksagon | **A4** |
| B09 | `nominal_median_struk` | Median nominal per struk | **A2** |

B01–B04 adalah **Commuter Clock**. Yang membuatnya mungkin: struk mencantumkan
jam transaksi. Dataset POI komersial mana pun hanya menyimpan jam buka-tutup —
kapan toko buka, bukan kapan uang berpindah.

### Dimensi Kompetisi — 8 variabel

| Kode | Kolom | Arti |
|---|---|---|
| C01 | `n_kompetitor_langsung` | Kompetitor sekelas induk, hex + **k-ring 1** |
| C02 | `kepadatan_poi_total` | Semua POI komersial |
| C03 | `keragaman_usaha` | Entropi 8 kelas induk |
| C04 | `keragaman_kuliner` | Entropi kelas kuliner (**A4**) |
| C05 | `pangsa_waralaba` | Pangsa merek nasional |
| C06 | `rasio_kompetitor_per_kapita` | C01 ÷ D01 |
| C07 | `rasio_keliling` | Pangsa pedagang keliling — **bahan IPTT** |
| C08 | `n_menetap_kuliner` | Jumlah kuliner menetap — **penyebut IPTT** |

**Definisi kompetitor langsung**: kelas induk sama, di heksagon yang sama
**atau tetangga langsungnya (k-ring 1)**. Tanpa k-ring, warung di seberang jalan
yang kebetulan jatuh ke heksagon sebelah tidak terhitung sebagai pesaing —
padahal pembelinya sama persis.

### Dimensi Biaya & Pasokan Ruang — 6 variabel

| Kode | Kolom | Arti | Sumber |
|---|---|---|---|
| P01 | `njop_m2` | NJOP per m² | Data NJOP |
| P02 | `njop_persentil` | Persentil NJOP dalam kawasan | Turunan |
| P03 | `pasokan_sewa_komersial` | Jumlah ruang tersedia | Misi Properti |
| P04 | `rasio_sewa_jual` | Sewa tahunan ÷ harga jual | Turunan |
| P05 | `harga_sewa_median` | Median sewa | **A1** (foto spanduk) |
| P06 | `indeks_churn` | Seberapa sering usaha berganti | Misi + OSM historis |

### Dimensi Risiko & Legalitas — 3 variabel

| Kode | Kolom | Arti |
|---|---|---|
| **L01** | `zona_izin_komersial` | **GATE.** `FALSE` → skor 0, apa pun variabel lain |
| L02 | `kelas_zona` | Kode zona RDTR |
| L03 | `risiko_banjir` | Tingkat rawan banjir |

L01 bertipe `boolean | null`. Ketiganya berbeda arti dan tidak boleh dicampur:

- `TRUE` — zona mengizinkan usaha
- `FALSE` — zona **melarang**, ZoneGuard menolkan skor
- `NULL` — **kawasan tanpa RDTR digital**, bukan larangan. Skor tetap dihitung,
  tetapi antarmuka menampilkan peringatan terpisah.

Menyamakan `NULL` dengan `FALSE` akan mematikan seluruh kawasan yang RDTR-nya
belum digital — kesalahan yang langsung terlihat di peta.

### Dimensi Morfologi & Prestise Visual — 3 variabel

| Kode | Kolom | Arti | Sumber |
|---|---|---|---|
| M01 | `rasio_tutupan_bangunan` | Rasio tutupan bangunan | OSM footprint |
| M02 | `luas_bangunan_median` | Median luas bangunan | OSM footprint |
| M03 | `skor_prestise_visual` | Kesan visual 1–5 | **A3** (foto fasad) |

## 3. Tiga penanda kualitas — Q01–Q03

**Bukan variabel model.** Tidak masuk perhitungan skor sama sekali. Tetapi
**wajib tampil di setiap tempat skor ditampilkan.**

| Kode | Kolom | Isi |
|---|---|---|
| Q01 | `n_titik_misi` | Jumlah titik survei yang mendasari heksagon |
| Q02 | `tingkat_keyakinan` | `TINGGI` ≥ 30 · `SEDANG` 10–29 · `RENDAH` < 10 |
| Q03 | `data_source` | `observed` (survei) / `predicted` (imputasi) |

Aturannya didefinisikan **satu kali** di `pipeline/config.py::tingkat_keyakinan()`.
Backend menegakkannya di tipe: setiap skema yang membawa skor wajib membawa
`keyakinan` (lihat `backend/app/schemas.py`). Secara struktur tidak mungkin
mengirim skor tanpa badge-nya.

Alasannya sederhana: skor 82 dari 40 titik survei dan skor 82 dari 3 titik survei
adalah dua pernyataan yang sangat berbeda, dan pengguna berhak tahu yang mana.

## 4. Taksonomi usaha — 8 kelas induk

| Kode | Kelas |
|---|---|
| F1 | Kuliner Duduk |
| F2 | Kuliner Cepat / Informal |
| R1 | Ritel Kebutuhan Harian |
| R2 | Ritel Non-Pangan |
| S1 | Jasa Personal |
| S2 | Kesehatan |
| K1 | Keuangan |
| T1 | Transportasi |

**Satu POI masuk tepat satu kelas.** Kalau sebuah POI bisa masuk dua kelas,
kepadatan kompetitor terhitung dobel dan seluruh indeks kompetisi jadi salah.
Kalau ragu, pilih kelas yang paling menggambarkan sumber pendapatan utamanya.

Kelas kuliner yang lebih rinci (9 nilai `KELAS_KULINER` di `s3_extract.py`) hanya
dipakai untuk C04, tidak menggantikan 8 kelas induk.

## 5. Sumber data

### Boleh dan dipakai

| Sumber | Untuk |
|---|---|
| **Misi MAPID** (Menu Go, Struk Go, Properti Go) | Sebagian besar variabel B, C, P |
| OpenStreetMap / OSMnx | POI, footprint, jaringan jalan, isochrone |
| BPS / WorldPop | D01, D02 |
| RDTR (zonasi) | L01, L02 |
| Data NJOP | P01, P02 |
| MAPID Data API | Layer pendukung |

### Dilarang

Ditulis eksplisit supaya tidak masuk diam-diam:

- **Google Places API**
- **Scraping Rumah123 / OLX** atau situs listing mana pun
- **GTFS TransJakarta versi komunitas** (bukan sumber resmi)

## 6. Kenapa AI Lapisan 1 bukan pilihan

Tiga dataset misi, dan jumlah kolom berisi angka rupiah:

| Dataset | Kolom | Kolom berisi rupiah |
|---|---|---|
| Properti Go | 8 | **0** |
| Struk Go | 8 | **0** |
| Menu Go | — | satu-satunya yang punya angka native |

Rupiah ada di **foto**, tidak di kolom. Tanpa A1–A4, proyek ini secara harfiah
tidak punya satu pun angka harga untuk dianalisis. Itu jawaban paling kuat untuk
pertanyaan "kenapa pakai AI?" — bukan karena sedang tren, tetapi karena tanpa itu
datanya tidak ada.

## 7. Enam aturan pembersihan

Diterapkan di `pipeline/s2_clean.py`, ambangnya di `config.py`.

**9.1 Koordinat.** Buang titik di luar BBOX Jabodetabek
(106,30–107,10 BT; −6,95–−5,95 LS). Buang (0,0). Tempel ke jalan/bangunan
terdekat dalam radius 50 m (`SNAP_GPS_M`).

**9.2 Duplikat.** Dua record dianggap sama kalau kemiripan nama ≥ 0,85 **dan**
jarak < 30 m. Ambang jarak sengaja lebih kecil dari lebar heksagon supaya
deduplikasi tidak pernah melintasi batas heksagon.

**9.3 Harga tidak wajar.** Di luar Rp1.000–Rp500.000 per porsi ditandai anomali.
Di bawah Rp1.000 hampir pasti diketik dalam satuan ribuan; di atas Rp500.000
hampir pasti harga paket.

**9.4 Winsorisasi.** Persentil 1 dan 99 dipangkas sebelum agregasi, supaya satu
outlier tidak menggeser median seluruh heksagon.

**9.5 Kosong tetap kosong.** `NaN` **tidak pernah** diisi nol. "Nol transaksi
tercatat" dan "belum ada yang mensurvei di sini" adalah dua pernyataan berbeda;
menyamakannya membuat kawasan yang belum disurvei tampak mati padahal bisa jadi
justru ramai. Kalau sebuah variabel harus dinetralkan untuk perhitungan, nilainya
0,5 (tengah skala ternormalisasi), bukan 0.

**9.6 Periode sewa.** Record dengan periode sewa tidak jelas **dikeluarkan** dari
P05, tidak ditebak. "45jt" bisa berarti per bulan atau per tahun — selisihnya dua
belas kali lipat, dan salah arah menggeser seluruh peta biaya satu kawasan.

## 8. Yang masih menggantung

| Hal | Status |
|---|---|
| `KOLOM_MENU_GO` / `KOLOM_STRUK_GO` / `KOLOM_PROPERTI_GO` | **Kosong.** Menunggu CSV asli. Wajib dicocokkan sebelum skrip apa pun dijalankan |
| Sumber data NJOP definitif | Belum dipilih |
| Sumber RDTR digital per kawasan | Belum lengkap untuk keenamnya |
| Data survei lapangan | Menunggu tim survei |

Nama kolom di CSV misi sering berbeda dari yang tertulis di PDF ketentuan: ada
spasi tambahan, kapitalisasi berbeda, atau disingkat. Satu jam mencocokkan di awal
menghemat berjam-jam debugging.
