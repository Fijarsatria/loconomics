# Metadata — dari mana tiap angka berasal

Register asal-usul data Loconomics. Satu pertanyaan yang dijawab berkas ini:
**mana yang diukur, mana yang diperkirakan, dan bagaimana membedakannya tanpa
percaya pada kata-kata kami.**

> **Angkanya tidak hidup di sini.** Cakupan per sumber dan per variabel
> dibangkitkan `pipeline/s7_publish.py --ekspor` ke
> `frontend/src/lib/ringkasan-data.ts`, dan ditampilkan di aplikasi lewat
> **Pengaturan → Sumber data**. Yang hidup di berkas ini KEPUTUSANNYA: kenapa
> sebuah sumber diterima, kenapa sebagian dari sumber yang sama justru ditolak,
> dan apa yang tidak boleh disimpulkan darinya.
>
> Angka apa pun yang muncul di bawah adalah keadaan **12 September 2026** dan
> disebut hanya ketika ia bagian dari keputusannya. Kalau berselisih dengan
> aplikasi, **aplikasi yang benar** — ia dihitung, ini ditulis.

---

## 1. Aturan pemisahnya

Tiga golongan, dan batasnya ditegakkan oleh LETAK, bukan oleh niat baik.

| Golongan | Tinggal di | Boleh menghitung skor? | Boleh mewarnai peta? | Boleh menaikkan lencana keyakinan? |
|---|---|---|---|---|
| **Diukur** | kolom `hex_features` | ya | ya | ya |
| **Perkiraan** | tabel `hex_perkiraan` | **tidak pernah** | **tidak pernah** | **tidak pernah** |
| **Tidak ada** | `NULL` | — | digambar abu, bukan nol | — |

Kenapa letak dan bukan sebuah kolom penanda: angka yang duduk di kolom yang
sama tidak bisa dibedakan dari luar oleh siapa pun. `s6_score.py` hanya membaca
`hex_features`, dan `/hex/layer` tidak pernah menyentuh `hex_perkiraan` — jadi
pemisahan itu tidak bergantung pada seseorang mengingat aturannya.

**Kosong tetap kosong.** `NaN` tidak pernah diisi nol. "Nol transaksi tercatat"
dan "belum ada yang mensurvei" adalah dua pernyataan berbeda; variabel yang
harus dinetralkan untuk perhitungan bernilai 0,5 (tengah skala ternormalisasi),
bukan 0 — dan antarmuka menuliskan "belum terukur" alih-alih angkanya.

---

## 2. Sumber yang DIUKUR

### 2.1 MAPID — data kompetisi

| | |
|---|---|
| **Sumber** | MAPID Mission (Menu Go, Struk Go, Properti Go) + Community Maps (Activity) |
| **Lisensi** | Data kompetisi MAPID |
| **Cara ambil** | `pipeline/s1_ingest.py --misi`, disaring **per poligon** wilayah studi |
| **Mengisi** | B06–B08, C04, C07, C08, D10, D12, P03, dan lencana keyakinan Q01–Q03 |

Disaring per poligon, **bukan per tim** — jadi yang masuk adalah kumpulan
seluruh peserta yang titiknya jatuh di enam kawasan pilot, bukan cuma setoran
tim kami.

**Yang tidak pernah keluar dari sini:** satu pun baris survei mentah. API dan
layar hanya mengeluarkan agregat per heksagon. Sebelum menambah endpoint,
pertanyaannya selalu: *bisakah respons ini dipakai merekonstruksi satu baris
survei?* Melanggarnya berisiko diskualifikasi (lihat `docs/aturan-lomba.md`).

**Kenapa cakupannya tipis, dan kenapa itu tidak ditutupi.** Misi adalah survei
**bertitik**: surveyor mendatangi sebuah tempat, bukan menyisir wilayah. Maka
heksagon yang tidak dikunjungi harus **kosong**, bukan nol — mengisinya nol
menggambarkan Jabodetabek sebagai kawasan mati. Ini kebalikan dari OSM di
bawah, yang menanyai seluruh wilayah sehingga nol memang temuan.

### 2.2 OpenStreetMap

| | |
|---|---|
| **Lisensi** | ODbL 1.0 — atribusi wajib, sudah terpasang di peta dan di gerbang |
| **Cara ambil** | Overpass, `s1_ingest.py --poi --simpul --bangunan --rute --henti` |
| **Mengisi** | C01–C06, D05, D08, D09, M01, M02, dan jalan untuk skor blok |

Ditarik per kawasan dan tidak pernah dua kali, jadi aman diulang saat Overpass
sedang penuh. Bangunan dipetak 3×3 per kawasan — satu kueri untuk seluruh
kawasan dijawab 504 berkali-kali.

**Sekolah, masjid, dan kantor tidak pernah lolos ke `business_pois` sebagai
kompetitor.** Keduanya generator keramaian (D09), bukan pesaing (C01). Dijaga
`test_s4_spatial.py`.

### 2.3 openrouteservice

| | |
|---|---|
| **Lisensi** | CC BY-SA 4.0 |
| **Cara ambil** | `pipeline/rute_ors.py`, dijalankan MANUAL. Butuh `ORS_API_KEY` |
| **Mengisi** | D03 jarak, D04 waktu jalan kaki, kawasan jangkau, dan menit jalan per blok |

Rute **jaringan jalan sungguhan** untuk jalan kaki, mobil, dan sepeda — bukan
garis lurus dan bukan jarak Euclidean dikali sebuah faktor. Ini yang membuat
"6 menit jalan kaki" bisa dipertanggungjawabkan.

Backend **tidak pernah** memanggil ORS saat melayani permintaan; ia membaca
tabel `hex_routes` dan `catchment_areas`. Kuota harian bisa habis di tengah
jalan: skripnya keluar dengan kode 3, dan lari berikutnya melanjutkan dari yang
belum punya rute.

### 2.4 WorldPop 2020

| | |
|---|---|
| **Lisensi** | CC BY 4.0 |
| **Berkas** | `idn_ppp_2020_UNadj_constrained.tif` (51 MB), diunduh sekali |
| **Mengisi** | D01 jumlah penduduk, D02 penduduk usia produktif, dan C06 yang bergantung pada D01 |

**D02 datang lewat tim data** (lihat bagian 4): lapisan struktur umur dari
penyedia yang sama, diagregasi ke grid H3 yang sama. Ia diterima sebagai
**pengukuran** karena yang berpindah tangan adalah hasil agregasi raster resmi
— bukan keluaran model.

### 2.5 RDTR ATR/BPN (GISTARU)

| | |
|---|---|
| **Lisensi** | Data terbuka pemerintah |
| **Cara ambil** | `s1_ingest.py --rdtr` — 708 kueri, ±15 menit, aman diulang |
| **Mengisi** | L01 izin komersial, L02 kelas zona, L03 risiko banjir |

**DKI Jakarta saja.** Kota Depok dan Kota Bekasi terkonfirmasi belum punya RDTR
digital di GISTARU lewat dua indeks yang berbeda — jadi ZoneGuard **diam**
untuk keduanya alih-alih menebak. Zona yang tidak diketahui bukan zona yang
dilarang, dan keduanya tidak boleh terlihat sama.

### 2.6 MAPID Maps — basemap

Lima gaya, seluruh ubinnya dari `basemap.mapid.io`. Tidak ada sumber tile lain
(aturan 6). Atribusi OpenMapTiles/OSM yang tertulis di dalam style MAPID adalah
atribusi **milik MAPID atas data sumbernya** — bukan tanda kita memakai tile
OSM.

Gaya `satelit` dimuat **langsung dari MAPID saat dipilih**, tidak lewat proksi
backend dan tidak disalin ke `frontend/public/basemap/`: citranya datang dari
penyedia hulu MAPID dengan token MAPID sendiri, dan menyalin berkas gayanya ke
repo berarti menaruh kredensial pihak ketiga di git.

---

## 3. Sumber yang DIPERKIRAKAN

### 3.1 Model tim AI Loconomics

| | |
|---|---|
| **Sumber** | [syahh-coder/Loconomics-AI](https://github.com/syahh-coder/Loconomics-AI), folder `hasilTrain`, 12 Sep 2026 |
| **Algoritma** | `GradientBoostingRegressor` — 100 pohon, kedalaman 3, laju 0,1, seed 42 |
| **Fitur** | 14 kolom: lat/lon centroid, resolusi, n titik misi, populasi (2), bangunan (3), risiko banjir (2), jarak simpul, n kompetitor, n generator keramaian |
| **Mengisi** | **PERKIRAAN** D10 dan B07 — panel detail saja |
| **Tinggal di** | `hex_perkiraan`, `metode = 'model_gbr'` |

**Label latihnya 96,9% sintetis.** Dari 480 titik: 15 survei Menu Go sungguhan
di dalam bbox studi, sisanya augmentasi dari formula populasi + jarak simpul +
derau. Angka itu bukan tuduhan kami — ia tertulis di log training tim AI
sendiri, yang juga menyatakan hasilnya *"BUKAN bukti model sudah akurat untuk
dunia nyata"* dan melarang berkasnya dipakai sebagai data 100% asli tanpa
disclosure.

**R² yang dilaporkan tidak mengukur apa yang terdengar.** Validasi silang
spasial memberi R² 0,62 (D10) dan 0,57 (B07) — benar, tetapi diukur terhadap
label sintetis itu sendiri. Yang diukurnya adalah seberapa baik model menebak
formula yang membuat labelnya.

**Maka kami menguji ulang terhadap pembanding yang tidak pernah dilihat
model**: pengamatan misi MAPID di heksagon kami sendiri.

| | n | MAE terhadap ukuran lapangan | MAPE |
|---|---|---|---|
| B07 harga per porsi | 12 | Rp14.580 | 41% |
| D10 tingkat keramaian | 12 | 2,34 (skala 1–3) | 434% |

Selisih itu **lima kali lebih besar** daripada MAE yang dilaporkan validasi
silang. Angkanya ikut disimpan di `hex_perkiraan.rincian` dan ikut tertulis di
kalimat yang menyertai setiap perkiraan di layar — supaya tidak ada satu pun
tempat yang menyebut R²-nya tanpa menyebut selisihnya.

### 3.2 Yang SENGAJA tidak diambil dari serah terima yang sama

Sembilan kolom, dan alasannya satu keluarga: **satu kolom tidak boleh memuat
dua definisi.** Daftar lengkapnya hidup di kode, di
`pipeline/s7_publish.py::KOLOM_TIM_AI_DILEWATI`.

| Kolom | Milik mereka | Milik kita | Putusan |
|---|---|---|---|
| `jarak_simpul_m` | Euclidean (disebut proksi di dokumen mereka sendiri) | rute jaringan jalan ORS | tolak — beda satuan |
| `luas_bangunan_median`, `rasio_tutupan_bangunan` | Google Open Buildings | jejak OSM | tolak — beda sumber, selisih 9 heksagon |
| `risiko_banjir_*` | indeks InaRISK 0–1 | kelas zona RDTR | tolak — beda definisi, kita lebih lengkap |
| `pop_100m` | WorldPop | WorldPop | tolak — kita sudah 707/708 |
| `n_kompetitor`, `n_generator_keramaian`, `jumlah_bangunan` | hitung OSM dasar | taksonomi 8 kelas | tolak — kita lebih halus |

Menambal lima heksagon kosong dengan angka berdefinisi lain akan membuat satu
kolom memuat dua satuan yang tidak bisa dibedakan siapa pun sesudahnya — dan
gagalnya diam.

---

## 4. Cakupan variabel

**26 dari 43 variabel terisi.** Yang menentukan bukan jumlahnya melainkan
sebarannya: variabel yang menutup seluruh 708 heksagon (OSM, populasi,
bangunan, simpul) menopang skor untuk semua lokasi, sedangkan yang bersumber
survei bertitik menutup belasan.

**17 yang kosong**, dan seluruhnya kosong dengan alasan yang bisa disebut:

| Kelompok | Kode | Kenapa kosong |
|---|---|---|
| Pola jam | B01–B05, B10, D11 | Struk misi MAPID tidak membawa kolom waktu transaksi; jamnya tercetak **di dalam foto struknya**. Pembacaan foto itu ada di `s3_extract.py` dan belum selesai dijalankan |
| Nominal struk | B09 | idem |
| Properti | P01, P02, P04, P05, P06, P07 | NJOP per bidang dan pasokan sewa belum punya sumber yang bisa dikutip; spanduk "DIKONTRAKAN" di lapangan hampir tidak pernah mencantumkan harga (lihat bagian 5) |
| Lain | D06 ridership, D07 kepadatan kos, M03 prestise visual | belum ada sumber yang bisa dikutip |

Kosongnya **dinyatakan di layar**, bukan disembunyikan: indeks yang bahannya
kosong menampilkan cakupannya sendiri, dan lencana keyakinan Q01–Q03 menurun
untuk heksagon yang tidak pernah disurvei.

---

## 5. AI di dalam pipeline

Dua lapisan, dan keduanya **tidak pernah menghitung skor**.

**Lapisan 1 — pembacaan foto (`s3_extract.py`).** Gemini vision membaca foto
spanduk (A1 → harga sewa) dan foto struk (A2 → nominal + jam). Promptnya hidup
sebagai berkas di `pipeline/prompts/*.md`, bukan string di dalam kode — jadi
perubahannya tercatat di git dan berkasnya sekaligus bukti untuk ketentuan
lomba C.1. Hasil per foto di-cache menurut SHA-1 URL-nya, jadi lari ulang tidak
membayar dua kali.

Temuan yang layak dicatat: **spanduk "DIKONTRAKAN" hampir tidak pernah memuat
harga.** Dari 19 spanduk pertama yang terbaca, 18 hanya memuat nomor telepon.
Modelnya membaca dengan benar; yang tidak ada adalah angkanya. `perlu_review`
menandai hasil yang keyakinannya rendah atau angkanya di luar rentang wajar,
jadi yang masuk tabel observasi bukan apa pun yang model katakan.

**Lapisan 2 — Konsultan AI.** Menjawab pertanyaan dengan memanggil endpoint
yang sama yang dipakai antarmuka, lewat penjaga akses yang sama. Ia tidak
pernah menghitung; ia membaca. Rinciannya di `docs/ai.md`.

---

## 6. Cara memverifikasi tanpa mempercayai dokumen ini

```bash
# Cakupan per sumber, dihitung ulang dari basis data
cd pipeline && python s7_publish.py --cakupan

# Bangkitkan ulang angka yang dibaca aplikasi
cd pipeline && python s7_publish.py --ekspor

# Perkiraan tidak pernah menyentuh hex_features:
#   s6_score.py membaca hex_features saja
grep -rn "hex_perkiraan" pipeline/s6_score.py      # harus kosong
grep -rn "hex_perkiraan" backend/app/api/hex.py    # hanya di detail_heksagon

# Penjaganya ada ujinya
cd backend && python tests/test_aturan.py          # termasuk 6 uji perkiraan
cd backend && python tests/test_akun.py            # tamu TIDAK menerima perkiraan
```

Di aplikasi: **Pengaturan → Sumber data** menampilkan daftar yang sama dengan
angka yang dihitung saat ekspor terakhir, terpisah antara yang resmi dan yang
perkiraan.

---

## Berkas terkait

- [`docs/data.md`](data.md) — skema, pipeline, dan sumber yang sudah dipetakan tetapi belum ditarik
- [`docs/aturan-lomba.md`](aturan-lomba.md) — batas penggunaan data MAPID
- [`docs/skoring.md`](skoring.md) — bobot, indeks, dan kenapa kosong bernilai 0,5
- [`docs/ai.md`](ai.md) — OCR dan Konsultan AI
