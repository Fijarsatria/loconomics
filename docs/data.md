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

## 2. Kamus Data Final — 43 variabel

Kode variabel (D01, B07, …) adalah **identitas kanonik**. Nama kolom adalah
implementasinya di tabel `hex_features`. Jembatan keduanya: `KODE_KE_KOLOM` di
`pipeline/config.py`, yang di-`assert` harus berisi tepat 43 entri.

### Dimensi Permintaan — 12 variabel

| Kode | Kolom | Arti | Sumber |
|---|---|---|---|
| D01 | `pop_100m` | Jumlah penduduk di dalam heksagon, dijumlahkan dari raster **100 m** WorldPop (bukan radius 100 m — itu resolusi produknya) | WorldPop `idn_ppp_2020_UNadj_constrained`, CC BY 4.0 — **nyata** sejak 26 Agu 2026 (`s7_publish.py --penduduk`). **Batasnya penting**: produk `constrained` menyebar total sensus ke piksel terbangun, dan Jabodetabek terbangun merata — rasio kuartil-3/kuartil-1 hanya **1,13** atas 708 heksagon. Ia memperbaiki SKALA C06, bukan daya bedanya. Peningkatan sebenarnya menunggu BPS tingkat kelurahan |
| D02 | `pop_usia_produktif` | Populasi 15–64 tahun | **KOSONG sejak 27 Agu 2026** — diperiksa, lalu ditolak. Dukcapil DKI per kecamatan (Jakarta Satu, lihat 10.7) memberi pangsa usia produktif yang SUNGGUHAN, dan pangsa itu ternyata nyaris tidak bervariasi: **0,677–0,720** untuk seluruh 44 kecamatan, median 0,708. D02 = pangsa × D01 karena itu hanya salinan D01 yang diperkecil ~0,71 — kolom baru yang tidak membawa satu pun informasi baru. Raster AgeSex WorldPop menutup Bodetabek juga, tetapi 36 berkas × 22 MB pada 178 KB/dtk tanpa dukungan HTTP range = ~75 menit. Tidak berbobot di indeks mana pun |
| D03 | `jarak_simpul_m` | Jarak **jaringan jalan** ke simpul terdekat | `hex_routes.jarak_m` (OpenRouteService) — **nyata** sejak 26 Agu 2026. Diambil dari baris rute yang SAMA dengan D04, supaya jarak dan waktu selalu menggambarkan perjalanan yang sama. Tidak berbobot di indeks mana pun: mengisinya menggeser nol peringkat |
| D04 | `waktu_jalan_menit` | Waktu jalan kaki ke simpul | OpenRouteService `foot-walking` — **data nyata, sudah mengisi kolom ini** sejak 25 Agu 2026 lewat `s7_publish.py --isi-d04` |
| D05 | ✅ `skor_simpul` | Bobot pentingnya simpul | **OSM relasi rute — nyata sejak 27 Agu 2026** (`s1_ingest.py --rute --henti` lalu `s7_publish.py --transit`). Jumlah rute angkutan umum BERBEDA yang berhenti di heksagon itu + k-ring 1, ditimbang `config.BOBOT_RUTE` menurut kapasitas moda (kereta 10 · BRT 3 · bus 1 · angkot 0,7). **Bobot 0,40 di IPT — terbesar kedua di seluruh model**, dan sebelumnya `rng` |
| D06 | `ridership_proksi` | Proksi jumlah penumpang | **KOSONG sejak 27 Agu 2026.** Angka resmi per stasiun ADA dan bisa dikutip, tetapi tidak dalam satu satuan: KAI Commuter melaporkan *gate-in tahunan* (Manggarai 5.456.309) dan *transaksi transit* (52.409.989) untuk stasiun yang sama, Stasiun Bekasi dilaporkan *rata-rata harian* (23.142), sementara MRT dan LRT Jabodebek punya pelaporan sendiri lagi. Min-max atas enam angka bersatuan berbeda menghasilkan peringkat yang tidak berarti apa-apa. Bobot 0,35 di IPT — dinetralkan jadi 0,5, lihat 10.8 |
| D07 | `kepadatan_kos` | Kepadatan kos/rumah sewa | **KOSONG — dan sekarang terukur, bukan lagi dugaan.** 367.522 footprint bangunan OSM se-enam kawasan disaring 27 Agu 2026: **5** bertag `building=dormitory`, **37** bernama kos/kost/indekos. 42 titik untuk 708 heksagon. Heuristik `wisma` dicoba dan dibuang — yang tertangkap "Wisma TNI" dan menara apartemen, bukan kos. Nol di kolom ini akan berarti "tidak ada yang memetakannya", bukan temuan |
| D08 | `kepadatan_kantor` | Kepadatan perkantoran | OSM — **nyata** sejak 26 Agu 2026 (`s7_publish.py --osm`) |
| D09 | `generator_keramaian` | Sekolah, RS, pasar, masjid besar | OSM — **nyata** sejak 26 Agu 2026. Batasnya: OSM tidak punya tag ukuran, jadi *seluruh* rumah ibadah muslim terhitung, bukan yang besar saja |
| D10 | `skor_ramai_terkoreksi` | Keramaian terkoreksi jam survei | Misi MAPID |
| D11 | `intensitas_transaksi` | Transaksi per satuan waktu | Misi Struk |
| D12 | ✅ `aktivitas_komunitas` | Jumlah kegiatan warga | Endpoint `activities` MAPID — **nyata** 26 Agu 2026 |

### Dimensi Perilaku Konsumen — 10 variabel

| Kode | Kolom | Arti | Sumber |
|---|---|---|---|
| B01 | `puncak_pagi` | Pangsa transaksi 05–09 | **A2** (jam di struk) |
| B02 | `puncak_siang` | Pangsa transaksi 11–14 | **A2** |
| B03 | `puncak_sore` | Pangsa transaksi 16–19 | **A2** |
| B04 | `puncak_malam` | Pangsa transaksi 19–23 | **A2** |
| B05 | `rasio_weekend` | Akhir pekan vs hari kerja, sebagai **kelipatan** — 1,0 berarti sama ramai, dan nilainya BOLEH melewati 1 | Misi |
| B06 | ✅ `pangsa_digital` | Pangsa pembayaran non-tunai | **A2** |
| B07 | ✅ `harga_median_porsi` | Median harga satu porsi | **A4** |
| B08 | ✅ `spread_harga` | Sebaran harga **antartempat** dalam heksagon: (maks−min) ÷ median. Satu tempat → **kosong**, karena sebaran dari satu pengamatan tidak ada | Misi Menu Go — **nyata** 26 Agu 2026. Sebaran antar-MENU di satu tempat masih menunggu A4 |
| B09 | `nominal_median_struk` | Median nominal per struk | **A2** |
| B10 | `belanja_per_jam` | Rupiah per jam operasional | **A2** |

B01–B04 adalah empat ember yang masuk perhitungan skor. Pola **per jam** yang
ditampilkan Commuter Clock tinggal di tabel terpisah — lihat bagian 3 di bawah.

Yang membuat keduanya mungkin: struk mencantumkan jam transaksi. Dataset POI
komersial mana pun hanya menyimpan jam buka-tutup — kapan toko buka, bukan
kapan uang berpindah.

**B10 dan P07 tidak masuk perhitungan skor.** Keduanya variabel tampilan untuk
PriceLens. Alasannya di [skoring.md](skoring.md) bagian akhir.

### Dimensi Kompetisi — 8 variabel

| Kode | Kolom | Arti | Sumber |
|---|---|---|---|
| C01 | `n_kompetitor_langsung` | Kompetitor sekelas induk, hex + **k-ring 1** | OSM — **nyata** sejak 26 Agu 2026 |
| C02 | `kepadatan_poi_total` | Semua POI komersial | OSM — **nyata** |
| C03 | `keragaman_usaha` | Entropi 8 kelas induk | OSM — **nyata** |
| C04 | ✅ `keragaman_kuliner` | Entropi jenis masakan | **OSM tag `cuisine` — nyata sejak 27 Agu 2026.** OSM sudah membawa taksonomi masakannya sendiri: 100 jenis berbeda di wilayah studi (`indonesian`, `japanese`, `padang`, `coffee_shop`…), jadi C04 tidak pernah benar-benar menunggu A4. Tagnya opsional dan hanya terisi di **41,8%** POI kuliner, jadi entropinya ditolak untuk heksagon yang tagnya terlalu tipis: **45 dari 708** heksagon lolos. A4 nanti memperkaya kolom ini, bukan menggantikannya |
| C05 | `pangsa_waralaba` | Pangsa merek nasional | OSM — **nyata** |
| C06 | `rasio_kompetitor_per_kapita` | C01 ÷ D01 | Turunan — **nyata** sejauh D01 terisi |
| C07 | `rasio_keliling` | Pangsa pedagang keliling — **bahan IPTT** | Misi MAPID — **belum** |
| C08 | `n_menetap_kuliner` | Jumlah kuliner menetap — **penyebut IPTT** | Misi MAPID — **belum** |

**Kelas induk mana untuk C01.** Definisinya "kompetitor sekelas induk", tetapi
sebuah heksagon tidak punya kelas — yang punya kelas adalah rencana usaha orang
yang membacanya, sementara `hex_features` cuma menyediakan satu kolom. Yang
dipakai sebagai wakilnya: **kelas yang sudah paling padat di heksagon itu**.
Bacaannya "di bidang yang lokasi ini memang sudah paling penuh, ada N tempat".

Dua tafsir lain ditolak karena keduanya menduplikasi variabel yang sudah ada —
menghitung seluruh POI menghasilkan C02 lagi, menghitung kuliner saja
menghasilkan C08 lagi. Keputusan ini murah dibatalkan: satu `--osm` +
`--hitung-ulang` menuliskannya ulang seluruhnya.

**Definisi kompetitor langsung**: kelas induk sama, di heksagon yang sama
**atau tetangga langsungnya (k-ring 1)**. Tanpa k-ring, warung di seberang jalan
yang kebetulan jatuh ke heksagon sebelah tidak terhitung sebagai pesaing —
padahal pembelinya sama persis.

### Dimensi Biaya & Pasokan Ruang — 7 variabel

| Kode | Kolom | Arti | Sumber |
|---|---|---|---|
| P01 | `njop_m2` | NJOP per m² | Data NJOP |
| P02 | `njop_persentil` | Persentil NJOP dalam kawasan | Turunan |
| P03 | ✅ `pasokan_sewa_komersial` | Jumlah listing berstatus sewa | Misi Properti Go — **nyata** 26 Agu 2026 |
| P04 | `rasio_sewa_jual` | Sewa tahunan ÷ harga jual | Turunan |
| P05 | `harga_sewa_median` | Median sewa | **A1** (foto spanduk) |
| P06 | `indeks_churn` | Seberapa sering usaha berganti | Misi + OSM historis |
| P07 | `harga_sewa_per_m2` | Median sewa bulanan per m² | **A1** |

### Dimensi Risiko & Legalitas — 3 variabel

| Kode | Kolom | Arti |
|---|---|---|
| **L01** | `zona_izin_komersial` | **GATE.** `FALSE` → skor 0, apa pun variabel lain |
| L02 | ✅ `kelas_zona` | Kode zona RDTR |
| L03 | ✅ `risiko_banjir` | Tingkat rawan banjir |

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
| M01 | `rasio_tutupan_bangunan` | Luas footprint ÷ luas sel H3 itu sendiri (`h3.cell_area`, bukan konstanta 105.000 m²) | OSM footprint — **nyata** sejak 26 Agu 2026 (`s7_publish.py --bangunan`). Nilai > 1 **tidak dipangkas**: itu tanda poligon bertumpang tindih, dan memangkasnya menyembunyikan tandanya sambil tetap salah |
| M02 | `luas_bangunan_median` | Median luas bangunan | OSM footprint — **nyata**. Heksagon tanpa bangunan: M01 nol, M02 **kosong** — "median dari himpunan kosong" tidak punya nilai, dan nol akan berarti "bangunan di sini rata-rata seluas 0 m²". Masukan P07 (= P05 ÷ M02); selama P05 sintetis, P07 tetap sintetis |
| M03 | `skor_prestise_visual` | Kesan visual 1–5 | **A3** (foto fasad) |

## 3. Tabel profil jam — Commuter Clock

`hex_hourly_profiles`, satu baris per (heksagon, jam). Delapan belas jam per
heksagon, 05:00–22:00.

| Kolom | Isi |
|---|---|
| `jam` | 5–22 |
| `n_transaksi` | Jumlah struk pada jam itu |
| `nominal_total`, `nominal_median` | Rupiah pada jam itu |
| `pangsa_captive` | 0–1. `pangsa_choice` diturunkan sebagai `1 − pangsa_captive` |
| `metode` | `observed` (≥ 3 struk berjam nyata) / `proxy` |

**Kenapa tabel terpisah, bukan kolom di `hex_features`.** B01–B04 hanya membagi
hari jadi empat ember; kriteria penerimaan Commuter Clock menuntut pola per jam.
Delapan belas kolom baru akan membuat `hex_features` sulit dibaca dan tetap tidak
bisa menyimpan pembagian captive/choice per jam.

Hanya `pangsa_captive` yang disimpan. Menyimpan keduanya membuka kemungkinan
jumlahnya tidak 1 setelah suatu pembaruan; satu angka tidak bisa salah begitu.

### Captive dan choice rider

| | Captive rider | Choice rider |
|---|---|---|
| Definisi | Tidak punya alternatif selain transit | Punya kendaraan pribadi, memilih transit |
| Pola belanja | Menumpuk di jendela berangkat & pulang | Tersebar sepanjang hari |
| Artinya bagi penyewa | Ramai dua kali sehari, sepi di antaranya | Arus lebih rata |

Jenis usaha yang cocok di keduanya tidak sama — itu sebabnya pemisahan ini layak
ditampilkan, bukan sekadar menarik.

**Angka ini estimasi, bukan pengukuran.** Dataset misi tidak menanyakan
kepemilikan kendaraan kepada siapa pun, dan tidak ada dataset publik yang
menyediakannya pada resolusi heksagon. Yang dilakukan: memakai proksi yang jelas
arahnya, dan mengatakan terus terang bahwa ini proksi.

Dua sinyal digabung setengah-setengah (`pipeline/s4_spatial.py`):

1. **Bentuk jam.** Pembelian pukul 06:30 di sebelah stasiun hampir pasti
   pembelian orang yang sedang mengejar kereta; pukul 14:00 hampir pasti bukan.
2. **Konteks heksagon.** D07 kepadatan kos ↑ → captive ↑. D08 kepadatan kantor,
   P02 persentil NJOP, dan B06 pangsa digital ↑ → captive ↓.

Hasilnya dibatasi ke rentang **0,05–0,95**. Tidak pernah menyentuh 0 atau 1:
keduanya berarti "pasti", dan tidak ada proksi yang berhak sepasti itu.

## 4. Tiga penanda kualitas — Q01–Q03

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

## 5. Taksonomi usaha — 8 kelas induk

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

## 6. Sumber data

### Boleh dan dipakai

| Sumber | Untuk |
|---|---|
| **Misi MAPID** (Menu Go, Struk Go, Properti Go) | Sebagian besar variabel B, C, P |
| OpenStreetMap (Overpass) | POI usaha (**C01–C03, C05, C06**), konteks heksagon (**D08, D09**), simpul transit, footprint. **Lisensi ODbL — atribusi WAJIB**, dan atribusi "© OpenStreetMap" yang sudah dibawa gaya MAPID itu milik MAPID atas ubinnya, bukan milik kita atas POI yang kita turunkan sendiri jadi angka. Dipasang terpisah lewat `customAttribution` di `PetaInteraktif.tsx` |
| OpenRouteService | Rute jalan kaki heksagon→simpul (`hex_routes`) dan kawasan jangkau 5/10/15 menit (`catchment_areas`). Berbasis OSM; kunci backend-only, kuota gratis 2.000 directions + 500 isochrones per hari |
| WorldPop | **D01** — `idn_ppp_2020_UNadj_constrained.tif` (51 MB, EPSG:4326, piksel ~92,8 m). **Lisensi CC BY 4.0, atribusi WAJIB** dan sudah dipasang di peta + `/meta/siap` |
| BPS | D02, dan kelak D01 tingkat kelurahan | 
| RDTR (zonasi) | L01, L02 |
| Data NJOP | P01, P02 |
| MAPID Data API | Layer pendukung |

### Dilarang

Ditulis eksplisit supaya tidak masuk diam-diam:

- **Google Places API**
- **Scraping Rumah123 / OLX** atau situs listing mana pun
- **GTFS TransJakarta versi komunitas** (bukan sumber resmi)

## 7. Kenapa AI Lapisan 1 bukan pilihan

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

## 8. Enam aturan pembersihan

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

## 9. Yang masih menggantung

| Hal | Status |
|---|---|
| `KOLOM_MENU_GO` / `KOLOM_STRUK_GO` / `KOLOM_PROPERTI_GO` | **Selesai** 25 Agu 2026, diverifikasi terhadap keempat dataset sampel resmi. Lihat catatan di `config.py` — Properti Go terpotong 10 karakter gaya DBF, Struk Go berisi 20 kolom bukan 8 |
| Sumber data NJOP definitif | Belum dipilih |
| Sumber RDTR digital per kawasan | Belum lengkap untuk keenamnya |
| **L03 risiko banjir (InaRISK)** | **Layanannya sudah ditemukan dan benar**, tinggal servernya. `https://gis.bnpb.go.id/server/rest/services/inarisk/layer_risiko_banjir/ImageServer` — ImageServer F32, EPSG:3395, `capabilities: Mensuration,Image,Metadata`, jadi `exportImage` memang jalurnya. Diuji 26 Agu 2026: enam percobaan `exportImage` (1024x1100 dan 512x550) semuanya dijawab **503 "Wait timeout for the request exceeded"** dari sisi BNPB — bukan kueri yang salah. Catatan jalan: basis URL-nya `/server/rest/services`, BUKAN `/arcgis/rest/services` yang menjawab 500. Coba lagi di lain waktu; polanya sama dengan WorldPop — ekspor raster bbox lalu sampel per heksagon |
| Data survei lapangan | Menunggu tim survei |

Peringatan itu terbukti, dan lebih parah dari dugaan. Yang ditemukan saat
mencocokkan: Properti Go memotong seluruh nama kolomnya di 10 karakter karena
CSV-nya diekspor berdampingan dengan shapefile (`Kategori Properti` →
`Kategori P`), satu kolomnya berspasi di depan (`' Tanggal'`), Struk Go membawa
20 kolom alih-alih 8, dan nilainya pun berbeda — `Disewa`/`Dijual`, bukan
`Sewa`/`Jual`. Nilai yang tidak dikenali jauh lebih berbahaya daripada nama
kolom yang salah: nama kolom salah menghasilkan `KeyError` yang langsung
terlihat, sedangkan nilai asing diam-diam jatuh ke "tidak cocok" dan barisnya
hilang dari agregasi tanpa satu pun galat.

Satu temuan lagi yang mengunci arah produk: **Struk Go benar-benar tidak punya
kolom rupiah.** `Total Pengeluran per Orang (Lama)` berisi `0` di seluruh 15
baris sampel, dan enam kolom lawas lainnya kosong sama sekali. Nominal belanja
hanya ada di dalam foto struk. Tanpa lapisan OCR (A2), B09 dan B10 tidak punya
sumber — dan keduanya masukan Simulasi Usaha.

## 10. Peta sumber: dari mana sisa variabel diambil

Diverifikasi 26 Agustus 2026 dengan memanggil sumbernya langsung, bukan dari
dokumen. **12 dari 43 variabel sudah nyata**; bagian ini memetakan 31 sisanya.

### 10.1 API misi MAPID — sudah bisa dipakai sekarang

Ditemukan di `https://maps.mapid.io/docs` (SPA, harus dirender peramban; PDF
Technical Meeting hal. 83 menunjuk ke sana).

```
POST https://server.mapid.io/web/competition/{menugo|struckgo|propertigo|activities}
Header : x-api-key: <MAPID_DATA_API_KEY>, Content-Type: application/json
Body   : {"feature": {"type":"Polygon","coordinates":[[...]]}, "offset": 0}
```

Catatan yang menghemat waktu:

- Jenis misinya **`struckgo`**, bukan `strukgo`. Salah satu huruf → 404
- `feature` wajib **Polygon** (bukan MultiPolygon/Point), cincin tertutup
- `limit` dipaku 100 dan tidak bisa diubah; paginasi lewat `offset`.
  `offset` melebihi `total` dijawab **400**, bukan daftar kosong
- Disaring per **poligon**, bukan per tim — jadi ini kumpulan seluruh peserta
- `activities` tidak punya offset; batasnya 60 tanpa rentang tanggal, dan
  seluruh data kalau `start_date`+`end_date` diberikan (harus berpasangan)

Volume terukur untuk bbox Jabodetabek `106,60/-6,50 … 107,10/-6,00`:

| Misi | Jabodetabek | Di 6 kawasan pilot |
|---|---|---|
| Properti Go | 278 | 11 |
| Struk Go | 252 | 78 |
| Menu Go | 161 | 47 |

Bekasi **nol** untuk ketiganya. Sebagian besar heksagon tidak akan menerima satu
titik pun, jadi badge RENDAH akan bertahan — dan itu benar.

Nilai-nilainya sudah dicocokkan terhadap `config.NILAI_*`, **nol nilai asing**:
`mobilitas` 157 Menetap / 4 Berkeliling · `kondisi_tempat` 51/79/31 Sepi-Sedang-Ramai ·
`jenis_properti` 162 Dijual / 116 Disewa · `harga_rata_rata` terbaca 161/161,
median Rp20.000, hanya 4 di luar ambang wajar.

**Yang bisa diisi tanpa AI: DELAPAN**, bukan sembilan. B06, B07, B08, C07, C08,
D10 (mentah), D12, P03. C07+C08 berarti **IPTT akhirnya bisa dihitung**.

P04 sempat masuk daftar ini dan itu keliru: ia didefinisikan *"sewa tahunan ÷
harga jual"* — rasio imbal hasil, bukan perbandingan jumlah listing. Ia menuntut
HARGA, dan harga ada di foto spanduk → A1.

### 10.1b Cakupan sebenarnya di kawasan pilot — jauh lebih tipis daripada totalnya

Ditarik dan dimuat 26 Agu 2026. Dari **866 titik se-Jabodetabek, hanya 27 yang
jatuh di dalam 708 heksagon** yang diskor:

| | |
|---|---|
| Titik ≤ 1 km dari pusat kawasan pilot | 12 |
| Titik ≤ 2,3 km (radius grid heksagon) | 63 |
| **Titik di dalam salah satu dari 708 heksagon** | **27** |
| **Median jarak seluruh 866 titik ke pusat pilot terdekat** | **11,1 km** |

Upaya survei tersebar di seluruh Jabodetabek, hampir semuanya jauh dari keenam
kawasan. Akibatnya: **20 heksagon `observed`, 688 `predicted`**, dan seluruh 708
tetap berbadge **RENDAH** — heksagon paling banyak disurvei pun cuma 4 titik,
sementara ambang SEDANG adalah 10.

Konsekuensi yang harus disadari sebelum menambah sumber misi: delapan variabel
di atas kini terisi untuk 1–11 heksagon saja, dan **697–707 sisanya NULL**.
Itu jauh lebih jujur daripada angka `demo_seed`, tetapi artinya dimensi
Aktivitas Ekonomi (IAE) praktis netral untuk hampir seluruh peta.

### 10.2 Lubang di API, dan kenapa ia tidak sefatal kelihatannya

**`tanggal` kosong (`{}`) di 691 dari 691 titik**, dan Struk Go tidak
mengembalikan waktu transaksi sama sekali — padahal formulirnya menanyakannya.

Sekilas itu mematikan B01–B05, D11, dan P06. **Tetapi jamnya ada di dalam foto.**
Diperiksa langsung: satu struk kertas mencetak `Date: 15-08-2026 07:05` beserta
`Grand Total: 105.000`; satu tangkapan layar GoPay memuat `Rp18.000` dengan jam
`07.23` di bilah status ponsel.

Jadi A2 tidak hanya mengekstrak nominal — ia mengekstrak **nominal + tanggal +
jam** sekaligus. Keandalannya beragam (struk kertas tercetak; tangkapan layar
bergantung bilah status), jadi ambang `confidence` 0,7 tetap berlaku.

**Yang dibuka OCR/vision (12):** B01–B05, B09, B10, C04 (menu), D11, M03, P05, P07.
Termasuk **Commuter Clock, PriceLens, dan sumbu prestise kuadran**.

Satu-satunya blokirnya `LLM_API_KEY`. MAPID tidak menyediakan token AI
(Technical Meeting hal. 36).

### 10.3 Sumber pemerintah

| Variabel | Sumber | Status |
|---|---|---|
| **L01, L02, L03** zonasi + risiko banjir | **GISTARU RDTR Interaktif** ATR/BPN | ✅ **Nyata** 26 Agu 2026 — hanya **DKI Jakarta** |
| **P01, P02** NJOP | **Bhumi ATR/BPN** (Zona Nilai Tanah) | Hidup, tetapi **tidak ada jalur terprogram yang mudah**. Diperiksa 27 Agu 2026: halaman depannya memakai Google Maps JS dan tidak memuat layer ZNT sampai dipilih dari antarmukanya; direktori ArcGIS ATR/BPN (106 folder, dapat diakses lewat proksi GISTARU) seluruhnya tata ruang — **nol folder ZNT**. Mengambilnya menuntut menggerakkan antarmuka Bhumi, dan itu pekerjaan tersendiri |
| L03 alternatif | InaRISK BNPB | Tidak jadi dipakai — RDTR sudah membawanya |

#### API GISTARU — tidak terdokumentasi, ditemukan dengan menyadap portalnya

```
daftar provinsi : GET  /rdtrinteraktif/api/interactive/provinces
RDTR per wilayah: GET  /rdtrinteraktif/api/interactive/rdtr/{id_wilayah}
matriks ITBX    : GET  /rdtrinteraktif/api/interactive/activities?id_wilayah=&id_rtr=
layer DKI       : POST {proxy}{arcgis}/054_RDTR_PROVINSI_DKI_JAKARTA/
                       _RDTR_31A1_DKI_JAKARTA/MapServer/0/query
proxy           : https://gistaru-proxy.atrbpn.go.id/proxy.ashx?
```

Empat jebakan yang memakan waktu, ditulis supaya tidak diulang:

1. **Server ArcGIS-nya menuntut token** (`error 499 Token Required`). Yang
   memegangnya proksi portal, jadi seluruh kueri harus lewat `proxy.ashx?`.
2. **Proksi itu di belakang WAF** yang menolak permintaan tanpa `Referer` dan
   `User-Agent` peramban — jawabannya HTML *"Request Rejected"*, bukan JSON,
   jadi gagalnya terlihat seperti API yang rusak.
3. **Basis URL-nya `/server/rest/services`** untuk BNPB, tetapi
   `/arcgis/rest/services` untuk ATR/BPN. Menukarnya menghasilkan 500 dan 404.
4. **`nilai_kolom_unik` pada ITBX TERPOTONG** di 11.523 karakter — JSON-nya
   tidak lengkap dan tidak bisa diurai. Daftar izin yang terpotong LEBIH
   BERBAHAYA daripada tidak punya daftar: poligon yang hilang dari potongan
   akan terbaca "dilarang", dan L01 FALSE menolkan skor lokasi.

#### Kenapa kueri POLIGON, bukan titik tengah

Percobaan pertama menanyakan zona di titik tengah tiap heksagon. Terukur, itu
salah: heksagon Stasiun Manggarai memotong **lima poligon RDTR di empat zona
berbeda** (Badan Jalan, Transportasi, Ruang Terbuka Hijau, Perumahan),
sementara kueri titik tengahnya hanya menjawab "Transportasi". Satu sampel
untuk bidang 0,105 km² tidak cukup untuk apa pun — apalagi untuk gerbang yang
menolkan skor.

Sekarang tiap heksagon dikirim sebagai poligon, servernya mengembalikan seluruh
zona yang memotongnya beserta geometri, dan `s4_spatial.dimensi_lahan`
menimbang menurut **luas perpotongan** (shapely), bukan menurut jumlah poligon.

#### Dua batas server yang harus diakali

**Geometri RDTR sangat detail.** Satu heksagon menarik 4.984 titik dan 199 KB;
menyimpannya utuh menghabiskan 78 MB untuk 40 heksagon (≈1,4 GB untuk 708) dan
membuat penarikan mandek. Dua perbaikan, keduanya terukur:

| | Titik | Ukuran | Waktu |
|---|---|---|---|
| apa adanya | 4.984 | 199 KB | 1,1 dtk |
| `maxAllowableOffset=0.00002` (~2 m) | 108 | **4 KB** | **0,2 dtk** |

Penyederhanaan itu **diverifikasi tidak merusak hasilnya**: selisih pangsa luas
per zona maksimal **0,002** atas tiga heksagon uji, sementara ambang L01 0,02.

Dan geometrinya **dipotong saat menarik**, lalu dibuang — yang disimpan hanya
`{KODZON, NAMZON, KRB_03, pangsa}` per zona, **576 byte per heksagon**.
Pemeriksaan bahwa pemotongannya benar: jumlah `pangsa` satu heksagon harus
1,000 kalau ia sepenuhnya di dalam DKI.

#### Cakupan RDTR tidak selalu penuh

Heksagon di tepi DKI sebagian bidangnya **tidak tertutup poligon RDTR sama
sekali** — terukur, satu heksagon Tanah Abang hanya 20% tertutup. Karena itu
`CAKUPAN_MIN = 0.80`: satu heksagon baru boleh dinyatakan `DILARANG` kalau
setidaknya 80% bidangnya memang punya zonasi. Menyimpulkan larangan dari
seperlima bidang sama saja menebak, dan yang ditebak di sini menolkan skor.

#### Aturan L01, dan kenapa ia berat sebelah

| Hasil | Syarat |
|---|---|
| `TRUE` | ada zona **K** (Perdagangan dan Jasa) seluas ≥ 2% heksagon |
| `FALSE` | **seluruh** luasnya zona yang bukan tempat usaha (BA, BJ, RTH, HK, PTL) |
| `None` | selebihnya — termasuk R, KT, SPU, TR |

Asimetris dengan sengaja. `FALSE` menolkan skor lokasi, dan menolkan lokasi
yang sebenarnya sah jauh lebih merusak daripada membiarkannya
`TIDAK_DIKETAHUI` — yang oleh antarmuka sudah dinyatakan apa adanya beserta
anjuran verifikasi ke dinas. Ambang 2% kecil karena yang dijawab L01 bukan
"apakah seluruh heksagon ini komersial" melainkan "apakah ADA tempat sah di
sini"; sepetak ruko di sudut sudah cukup untuk membuka usaha.

R, KT, SPU, dan TR lazim mengizinkan sebagian kegiatan usaha lewat ITBX, tetapi
ITBX-nya terpotong (jebakan 4), jadi keempatnya tidak diputuskan.

#### Hasil terukur, 27 Agustus 2026

**328 dari 708 heksagon** punya zonasi — tepat sesuai dugaan: 122 Manggarai +
108 Tanah Abang + 97 Dukuh Atas = 327, plus satu heksagon Harjamukti yang
menyentuh batas DKI.

| Kawasan | Diizinkan | Dilarang | Tidak diketahui | Risiko banjir rata-rata |
|---|---|---|---|---|
| Manggarai | 99 | 0 | 23 | 0,26 |
| Tanah Abang | 90 | **2** | 16 | 0,16 |
| Dukuh Atas BNI | 79 | 0 | 18 | 0,12 |
| Harjamukti | 1 | 0 | 126 | 0,60 |
| Depok Baru | 0 | 0 | 127 | — |
| Bekasi | 0 | 0 | 127 | — |

Dua heksagon `DILARANG` keduanya **Zona Ruang Terbuka Hijau** di Tanah Abang
dengan risiko banjir ~1,0, dan keduanya kini berskor **0,0** — ZoneGuard bekerja
atas data sungguhan untuk pertama kalinya, dan alasannya bisa dikutip ke Pergub
DKI 31/2022.

Dampak ke skor: **ρ 0,8841**, 41 heksagon (5,8%) berpindah kuadran, selisih
maksimum **89 poin** (itu gerbangnya menolkan dua heksagon). Perpindahannya
seluruhnya TEGAK — Hidden Gem↔Hindari dan Jebakan Gengsi↔Pemenang Jelas —
sebagaimana mestinya, karena L03 masuk lewat IBR dan L01 menolkan, keduanya
sumbu peluang.

#### Cakupan: tiga dari enam kawasan

GISTARU hanya memuat **DKI Jakarta** untuk wilayah kita. **Kota Depok** dan
**Kota Bekasi tidak terdaftar sama sekali** — yang ada "Kab. Bekasi", wilayah
yang berbeda. Jadi Depok Baru, Bekasi, dan Harjamukti tetap `TIDAK_DIKETAHUI`,
dan itu jawaban yang benar untuk mereka, bukan kekurangan yang harus ditutupi.

### 10.4 Statistik resmi

- **D02** usia produktif — WorldPop AgeSex (±20 berkas, ~1 GB) atau BPS kelurahan.
  Tidak berbobot di indeks mana pun
- **D05, D06** kepentingan simpul & penumpang — data resmi KAI Commuter / MRT
  Jakarta / LRT Jabodebek, atau BPS Statistik Transportasi. **Angka yang ada
  sekarang ditulis tangan tanpa sumber** di `demo_seed.SIMPUL` (Manggarai
  130.000/hari dst) dan harus diganti yang bisa dikutip

### 10.5 Yang tidak punya sumber

- **D07 kepadatan kos** — OSM hampir tidak memetakan kos di Jakarta
- **P06 indeks churn → RiskRadar** — menuntut pengamatan **berulang bertanggal**
  atas titik yang sama. Satu potret tidak bisa menghasilkannya, dan `tanggal`
  dari API pun kosong. Lebih baik dinyatakan apa adanya ke juri daripada dikarang

### 10.7 Jakarta Satu — direktori ArcGIS DKI yang terbuka

`jakartasatu.jakarta.go.id/server/rest/services` menjawab tanpa kunci sama
sekali. Dirangkak 27 Agu 2026: **116 folder**, 94 terbuka, 37 menjawab
`499 Token Required`. Yang terkunci justru yang paling diincar — `Bapenda`,
`BPRD`, `PERTANAHAN`, `Persil_BPN_DKI` — dan di situlah NJOP tinggal.

Yang TERBUKA dan relevan:

| Layanan | Isi | Dipakai |
|---|---|---|
| `PETA_JAKARTA/Kependudukan_Kota_Tahun_2022_Semester_2` | 44 kecamatan × `ANAK_LP`, `PRODUKTIF_LP`, `LANSIA60_LP`, `LANSIA65_LP` | Menolak D02 (lihat tabel) |
| `kependudukan/Kependudukan_Jakarta_Tingkat_RW` | penduduk + jumlah KK per RW | Belum — tidak ada pecahan umur |
| `Jaklingko/Perhentian_TJ` | halte TJ + kolom **`JMLRUTE`** | Belum — kandidat pembanding D05 |
| `JakartaSatu/Transjakarta`, `Jaklingko/Rute_TJ` | koridor & rute | Belum |

Dua jebakan yang sudah kena:

- **`urllib` habis waktu ke host ini, `curl` lolos.** Sepuluh menit terbuang
  menyangka layanannya mati. Kalau satu host menolak satu klien, coba klien
  lain sebelum menyimpulkan apa pun tentang hostnya.
- **`returnGeometry=true` dijawab tanpa geometri.** Layanan
  `Kependudukan_Kota_*` mengembalikan `geometryType: None`. Untuk menyatukannya
  ke heksagon, batasnya harus diambil dari layanan batas administrasi yang
  terpisah lalu dijodohkan lewat nama kecamatan.

### 10.8 Yang dikosongkan 27 Agustus 2026, dan kenapa

Delapan belas kolom yang masih diisi `demo_seed` di-`NULL`-kan lewat
`s7_publish.py --kosongkan`. Ini penerapan aturan 4 ("kosong tetap kosong")
pada skala penuh: angka karangan yang duduk di kolom yang sama dengan angka
hasil pengukuran **tidak bisa dibedakan dari luar oleh siapa pun**, termasuk
oleh juri yang bertanya "yang ini datanya dari mana".

| Kelompok | Variabel |
|---|---|
| Menunggu `LLM_API_KEY` — fotonya sudah ada | B01–B05, B09, B10, D11, M03, P04, P05, P07 |
| Sumber ada tetapi terkunci / tak bersatuan | P01, P02 (token), D06 (tiga operator, tiga satuan) |
| Diukur, dan pengukurannya menolak variabelnya | D02, D07 |
| Tidak punya sumber sama sekali | P06 |

**Mengosongkan tidak meruntuhkan skor.** `s6_score._tertimbang()` menetralkan
variabel hilang jadi **0,5**, bukan menolkannya — aturan yang sudah ada sejak
awal, dan baru sekarang benar-benar terpakai. Indeks yang seluruh variabelnya
kosong menjadi tetapan 0,5 untuk setiap heksagon; artinya ia berhenti
membedakan, dan itu memang pernyataan yang benar tentangnya.

Akibatnya per indeks:

| Indeks | Sesudah dikosongkan |
|---|---|
| **IPT** 0,35 | D05 **nyata** (0,40) + D04 **nyata** (0,25). D06 netral |
| **IAE** 0,35 | D10 & B07 dari misi MAPID, 8 heksagon. Sisanya netral — praktis tetapan |
| **IKP** −0,20 | C03, C05, C06 — **seluruhnya nyata dari OSM** |
| **IBR** −0,10 | L03 **nyata** (0,10). P01, P05, P06 netral |

Sumbu prestise Kompas Kuadran selamat utuh: dari lima komponennya, dua
dikosongkan (P02, M03) dan **tiga sisanya seluruhnya nyata** — `pangsa_waralaba`,
`luas_bangunan_median`, `rasio_tutupan_bangunan`, ketiganya dari OSM.
`hitung_prestise_visual()` merata-ratakan dengan `skipna=True`, jadi ia
berpindah sendiri ke ketiga yang tersisa. "Jebakan Gengsi" tetap berdiri di
atas data sungguhan.

Yang **tidak** ikut menunggu data: sejak 27 Agu 2026 Simulasi Usaha menerima
**sewa** dan **harga rata-rata per pembeli** langsung dari penggunanya, dan yang
diisi menang atas angka basis data. Sebabnya sederhana — orang yang sedang
menimbang sebuah ruko sudah memegang penawaran pemiliknya, dan harga jual adalah
rencananya sendiri. Median satu heksagon tidak akan pernah lebih benar daripada
keduanya.

Akibatnya angka paling berguna di simulasi bisa dihitung **di mana pun**, tanpa
satu baris survei:

    pembeli impas per hari = sewa bulanan / (26 x harga rata-rata x margin)

Yang tetap menuntut data justru omzet: berapa uang yang berputar di heksagon itu
bukan sesuatu yang bisa dijawab siapa pun dari kursinya, dan membiarkannya diisi
sendiri akan mengubah simulasi jadi mesin pembenar.

### 10.8b Kenapa cakupan survei tipis, dan apa yang sebenarnya membatasinya

Pertanyaan yang paling sering muncul melihat pita status: kalau datanya sudah
nyata, kenapa hanya sebagian kecil heksagon yang punya survei?

Jawabannya bukan soal kualitas data melainkan soal GEOGRAFI, dan angkanya bisa
dihitung ulang kapan saja lewat `s1_ingest.py --misi`:

| Diukur 29 Agustus 2026 | Angka |
|---|---|
| Titik misi MAPID se-Jabodetabek | **988** |
| Yang jatuh di dalam 708 heksagon kita | **46** |
| Heksagon yang tersentuh | **31 dari 708** (4,4%) |

Sebabnya sederhana begitu disadari: **API misi MAPID disaring per POLIGON, bukan
per tim.** Yang kembali adalah kumpulan survei SELURUH peserta lomba, dan tiap
tim memilih wilayah studinya sendiri. Median jarak seluruh titik ke pusat kawasan
pilot terdekat kami 11,1 km — mereka mensurvei tempat lain, dan itu wajar.

Sebarannya di dalam grid kami:

| Kawasan | Titik |
|---|---|
| Tanah Abang | 17 |
| Dukuh Atas BNI | 11 |
| Manggarai | 8 |
| Depok Baru | 6 |
| Harjamukti | 3 |
| Bekasi | 1 |

**Angkanya bertambah sendiri.** Penarikan 27 Agustus menghasilkan 866 titik
(27 di dalam grid); dua hari kemudian 988 titik (46 di dalam grid) — bertambah
122 titik se-Jabodetabek dan **+19 di dalam grid kami**, tanpa satu pun anggota
tim turun ke lapangan. Menarik ulang berkala praktis gratis dan layak dilakukan
menjelang penjurian.

Tetapi ia tidak akan pernah cukup dengan sendirinya. Yang menentukan bukan
berapa banyak titik yang ada melainkan berapa banyak yang jatuh di 708 heksagon
KAMI — dan itu hanya bisa dinaikkan dengan menurunkan tim ke enam kawasan pilot.
Daftar targetnya di bagian 11.

**Apa yang sebenarnya hilang tanpa survei.** Perlu ditegaskan karena mudah salah
baca: heksagon tanpa survei BUKAN heksagon tanpa data. Ia tetap membawa POI
OpenStreetMap, rute jalan kaki OpenRouteService, penduduk WorldPop, zonasi RDTR,
dan skor simpul dari relasi rute — seluruhnya terukur. Yang belum ada di sana
hanya variabel yang memang menuntut kunjungan: harga sewa, pola jam transaksi,
belanja rata-rata, dan indeks churn.

### 10.9 Nilai tanah: dicari sampai habis, tidak ada sumber terbukanya

Diperiksa 29 Agu 2026. P01/P02 (NJOP) sempat dicatat sebagai "menunggu token
Jakarta Satu"; setelah ditelusuri, kesimpulannya lebih keras — **nilai tanah
tidak diterbitkan terbuka oleh satu pun dari tiga penerbitnya.**

| Tempat yang diperiksa | Hasil |
|---|---|
| Jakarta Satu `Bapenda`, `BPRD` | `499 Token Required` — keduanya, konsisten |
| Jakarta Satu `BPN/Persil_BPN_2021_map` | **Terbuka**, 5 layer per kota. Kolomnya `PERSILID, NIB, TIPEHAK, LUASTERTUL, LUASPETA` — bidang dan jenis hak, **nol kolom nilai** |
| Bhumi ATR/BPN | Aplikasi bidang tanah, bukan peta nilai. Satu-satunya endpoint datanya `/expapi/getPersil`; tidak ada ZNT |
| GISTARU, seluruh 106 folder | Tidak ada satu pun folder ber-`ZNT` / `NILAI` |

Jadi P01/P02 bukan "menunggu token" melainkan **menunggu sumber**. Kalau NJOP
harus masuk, jalurnya permintaan resmi ke Bapenda DKI, bukan API.

Catatan cara: `gistaru-proxy.atrbpn.go.id/proxy.ashx?<url>` membuka SELURUH
pohon layanan ArcGIS-nya, bukan cuma RDTR yang sudah dipakai. Itu proksi publik
milik viewer mereka sendiri, jadi memakainya sama dengan memakai petanya.

### 10.10 Depok dan Bekasi memang tidak punya RDTR — sekarang lewat indeks kedua

Sebelumnya disimpulkan dari daftar wilayah `rdtrinteraktif`. Diverifikasi ulang
lewat pohon layanan ArcGIS, indeks yang sama sekali berbeda:
`055_RDTR_PROVINSI_JAWA_BARAT` memuat **35 layanan**, dan layanan agregat
`_3200_..._PR_PERDA` memuat **34 layer RDTR yang sudah diperdakan**. Tidak ada
Kota Depok. Tidak ada Kota Bekasi. Seluruh entri bernama "Bekasi" adalah
**Cikarang**, yaitu Kabupaten Bekasi — wilayah yang berbeda, puluhan kilometer
ke timur.

L01/L02/L03 berhenti di **328 dari 708 heksagon**, dan itu batas sumbernya,
bukan batas pekerjaannya.

### 10.11 Ringkasan

Keadaan per 27 Agustus 2026, dihitung dari basis data — bukan dari daftar yang
ditulis tangan (`GET /meta/siap` mengembalikan angka yang sama):

**25 dari 43 variabel terisi. Nol di antaranya sintetis.**

| Sumber | Variabel | Cakupan |
|---|---|---|
| OpenStreetMap POI | C01, C02, C03, C04, C05, C06, D08, D09 | 708 (C03/C05 396, C04 27) |
| OpenStreetMap relasi rute | **D05** | 708 |
| OpenStreetMap footprint | M01, M02 | 708 / 699 |
| OpenRouteService | D03, D04 | 708 |
| WorldPop | D01 | 707 |
| RDTR ATR/BPN (GISTARU) | L01, L02, L03 | 271 / 328 / 328 |
| Misi MAPID | B06, B07, B08, C07, C08, D10, D12, P03 | 1–11 |

**18 kosong**, dan setiap satunya punya alasan yang bisa dibaca di 10.8.

Urutan di bawah ini pernah ditulis salah, dan salahnya menentukan ke mana tenaga
tim pergi. Versi lama menaruh `LLM_API_KEY` di nomor satu dengan alasan "fotonya
sudah ada di tangan". Fotonya memang ada — tetapi OCR hanya bisa membaca foto
yang SUDAH diambil, dan yang sudah diambil cuma menyentuh **23 dari 708
heksagon (3,2%)**. Kuncinya bukan pembuka; ia pengganda atas cakupan yang
belum ada.

1. **Survei lapangan 30 heksagon** (bagian 11) → 12 variabel, dengan cakupan
   yang sungguhan. Ini satu-satunya jalur yang menambah CAKUPAN, dan tanpa
   cakupan tidak ada langkah berikutnya yang berarti
2. **`LLM_API_KEY`** → mengubah foto jadi angka. Wajib ada SEBELUM survei
   pulang, bukan sesudahnya — tanpa kunci, hasil survei menumpuk sebagai foto
   yang tidak terbaca siapa pun
3. **D06** menunggu satu keputusan, bukan satu data: satuan mana yang dipakai
   untuk membandingkan stasiun KRL, MRT, dan LRT dalam satu kolom

Dua yang sudah dicoret dari daftar ini karena diukur dan buntu: **P01/P02**
(nilai tanah tidak diterbitkan terbuka oleh satu pun penerbitnya — 10.9) dan
**L01–L03 di luar DKI** (Depok dan Bekasi tidak punya RDTR — 10.10).

Yang **tidak** akan datang dari mana pun tanpa survei berulang: P06 churn.

## 11. Rencana survei lapangan — 30 heksagon yang paling menentukan

Dua belas dari 18 variabel kosong hanya bisa diisi oleh orang yang berdiri di
lokasinya. Tidak ada API yang menggantikannya, dan `LLM_API_KEY` pun tidak:
OCR bekerja atas foto yang SUDAH ada, dan foto yang sudah ada cuma menyentuh
25 dari 708 heksagon.

Yang membuat daftar di bawah ini layak dikerjakan lebih dulu adalah satu angka:
**28 dari 30 heksagon berskor tertinggi belum pernah disurvei sama sekali.**
Itu justru lokasi yang direkomendasikan produk — yang akan diklik juri, dan
yang paling mahal kalau ternyata salah.

Saringannya tiga, seluruhnya dari basis data:

1. `n_titik_misi = 0` — belum pernah dikunjungi
2. kuadran `HIDDEN_GEM` atau `PEMENANG_JELAS` — yang direkomendasikan produk
3. `kepadatan_poi_total > 0` — ada usaha untuk disurvei

259 heksagon lolos ketiganya. Lima teratas per kawasan, menurut
`opportunity_score`:

| h3_index | Kawasan | Kuadran | Skor | Lat | Lon | POI | Menit jalan |
|---|---|---|---|---|---|---|---|
| 898c104eeafffff | Bekasi | HIDDEN_GEM | 86,8 | -6,23813 | 107,00026 | 4 | 9 |
| 898c104e8cbffff | Bekasi | HIDDEN_GEM | 80,9 | -6,23683 | 106,99494 | 1 | 5 |
| 898c104eea7ffff | Bekasi | HIDDEN_GEM | 76,2 | -6,24116 | 106,99932 | 2 | 12 |
| 898c104ee37ffff | Bekasi | PEMENANG_JELAS | 75,7 | -6,23597 | 106,99807 | 2 | 2 |
| 898c104ee33ffff | Bekasi | HIDDEN_GEM | 72,1 | -6,23510 | 107,00120 | 4 | 11 |
| 898c1070543ffff | Depok Baru | HIDDEN_GEM | 64,8 | -6,39595 | 106,81947 | 11 | 9 |
| 898c107055bffff | Depok Baru | HIDDEN_GEM | 64,3 | -6,39509 | 106,82261 | 6 | 15 |
| 898c1070087ffff | Depok Baru | PEMENANG_JELAS | 63,3 | -6,38989 | 106,82136 | 8 | 6 |
| 898c1070097ffff | Depok Baru | HIDDEN_GEM | 62,4 | -6,39206 | 106,82355 | 2 | 8 |
| 898c107054bffff | Depok Baru | HIDDEN_GEM | 62,0 | -6,39292 | 106,82042 | 4 | 5 |
| 898c1079d2fffff | Dukuh Atas BNI | HIDDEN_GEM | 95,6 | -6,20020 | 106,82589 | 5 | 9 |
| 898c1079d23ffff | Dukuh Atas BNI | HIDDEN_GEM | 90,1 | -6,20237 | 106,82808 | 3 | 15 |
| 898c1078acbffff | Dukuh Atas BNI | PEMENANG_JELAS | 87,1 | -6,20626 | 106,82401 | 4 | 15 |
| 898c1078a43ffff | Dukuh Atas BNI | PEMENANG_JELAS | 80,3 | -6,20192 | 106,81962 | 5 | 7 |
| 898c1078ac7ffff | Dukuh Atas BNI | PEMENANG_JELAS | 75,8 | -6,21016 | 106,81993 | 12 | 16 |
| 898c1073667ffff | Harjamukti | HIDDEN_GEM | 75,9 | -6,37222 | 106,89557 | 2 | 10 |
| 898c107329bffff | Harjamukti | HIDDEN_GEM | 67,3 | -6,37006 | 106,89338 | 1 | 7 |
| 898c10732d7ffff | Harjamukti | HIDDEN_GEM | 64,5 | -6,36703 | 106,89433 | 1 | 11 |
| 898c107360bffff | Harjamukti | HIDDEN_GEM | 57,3 | -6,37569 | 106,90308 | 7 | 25 |
| 898c1073677ffff | Harjamukti | HIDDEN_GEM | 53,1 | -6,37439 | 106,89776 | 1 | 16 |
| 898c1078367ffff | Manggarai | PEMENANG_JELAS | 72,1 | -6,21150 | 106,84531 | 4 | 26 |
| 898c107838bffff | Manggarai | PEMENANG_JELAS | 65,2 | -6,22235 | 106,85626 | 7 | 19 |
| 898c107836fffff | Manggarai | HIDDEN_GEM | 64,9 | -6,20847 | 106,84625 | 2 | 31 |
| 898c1078237ffff | Manggarai | HIDDEN_GEM | 64,8 | -6,21456 | 106,86441 | 2 | 31 |
| 898c1078e57ffff | Manggarai | PEMENANG_JELAS | 63,8 | -6,22015 | 106,83402 | 31 | 40 |
| 898c106a69bffff | Tanah Abang | PEMENANG_JELAS | 89,6 | -6,17893 | 106,81243 | 10 | 12 |
| 898c1079967ffff | Tanah Abang | HIDDEN_GEM | 87,7 | -6,18110 | 106,81462 | 5 | 10 |
| 898c1079923ffff | Tanah Abang | PEMENANG_JELAS | 84,5 | -6,18717 | 106,81274 | 5 | 3 |
| 898c106a697ffff | Tanah Abang | PEMENANG_JELAS | 83,3 | -6,18283 | 106,80836 | 6 | 12 |
| 898c1079927ffff | Tanah Abang | PEMENANG_JELAS | 81,8 | -6,18803 | 106,80961 | 5 | 10 |
| **Struk** — nominal, tanggal, JAM | B01–B05 (empat puncak + rasio weekend), B09, B10, D11 — dan bersamanya **Commuter Clock** |
| **Menu** — harga tiap item | B08 spread harga, B06 harga median porsi, M03 |
| **Papan sewa / tanya pemilik** — harga sewa, luas | P05, P07, dan **PriceLens** berhenti kosong |
| **Harga jual ruko** di titik yang sama | P04 rasio sewa-jual |
| **Foto muka toko** | P03 prestise visual, komponen keempat & kelima |

Tiga hal yang menentukan apakah hasilnya terpakai:

- **Jam pada struk wajib terbaca.** `tanggal` kosong di 691 dari 691 titik yang
  ditarik dari API, jadi satu-satunya sumber waktu adalah cetakan di strukmya.
  Tanpa jam, B01–B05 dan D11 tetap kosong walaupun nominalnya terbaca
- **Sebar titiknya dalam heksagon, jangan menumpuk di satu ruas.** Yang dihitung
  median per heksagon; lima struk dari satu warung menghasilkan median satu
  warung, bukan median lokasi
- **Sepuluh titik per heksagon** adalah ambang badge `SEDANG` (Q02). Di bawah
  itu badge tetap `RENDAH` — jujur, tapi lemah di depan juri. Lima heksagon
  bertitik 10 lebih berharga daripada lima puluh heksagon bertitik 1

