# CLAUDE.md

Panduan untuk sesi AI berikutnya di repositori ini. Dibaca otomatis setiap sesi
baru. **Baca sampai habis sebelum menyentuh kode** — sebagian aturan di bawah
berkonsekuensi diskualifikasi lomba, bukan sekadar gaya penulisan.

Berkas ini sengaja ringkas. Dua bagian terbesarnya pindah ke `docs/` supaya
tidak dibayar setiap sesi, dan **tidak satu kalimat pun dibuang**:

- **[docs/jebakan.md](docs/jebakan.md)** — 184 kesalahan yang benar-benar
  terjadi di repo ini, sebab, dan perbaikannya. Sebagian besar gagalnya DIAM.
  Sebelum menyentuh sebuah bagian, `grep` nama berkasnya di sana.
- **[docs/status.md](docs/status.md)** — apa yang sudah jadi berikut buktinya,
  dan apa penghalang pekerjaan berikutnya.

---

## Proyek ini apa

**Loconomics** — *Transit-oriented Retail Recommender*. WebGIS pendukung
keputusan untuk MAPID WebGIS Competition #2 2026, tema *"Maps That Think! — Mass
Transportation Edition"*. Tim #33 dari Top 50, Telkom University Bandung.

Membantu calon pelaku UMKM memilih lokasi usaha di sekitar simpul transportasi
massal Jabodetabek, dengan menunjukkan lokasi yang **terlihat** biasa tetapi
datanya bagus (**Hidden Gem**) — dan memperingatkan yang sebaliknya
(**Jebakan Gengsi**).

Kalau sebuah perubahan tidak memperkuat salah satu dari dua hal itu, pertanyakan
dulu sebelum mengerjakannya.

## Baca ini dulu

| Kalau Anda akan… | Baca |
|---|---|
| Apa pun, pertama kali | [docs/README.md](docs/README.md) → [docs/alur-sistem.md](docs/alur-sistem.md) |
| **Menyentuh bagian yang pernah rusak** | **[docs/jebakan.md](docs/jebakan.md)** — `grep` nama berkasnya di sana lebih dulu |
| Tahu apa yang sudah jadi & apa berikutnya | [docs/status.md](docs/status.md) |
| Menyentuh data MAPID | **[docs/aturan-lomba.md](docs/aturan-lomba.md)** |
| Menyentuh pipeline / skema DB | [docs/data.md](docs/data.md) |
| Mencari sumber data yang belum ada | **[docs/data.md bagian 10](docs/data.md)** — sudah dipetakan & diuji, jangan riset ulang |
| Mengubah rumus skor | [docs/skoring.md](docs/skoring.md) |
| Mengerjakan OCR / AI Consultant | [docs/ai.md](docs/ai.md) |
| Menyentuh backend / frontend / deploy | [docs/arsitektur.md](docs/arsitektur.md) |

## Struktur

```
backend/     FastAPI — 7 modul + tests/. Membaca basis data, TIDAK menghitung skor
             core/akun.py  — sidik sandi (scrypt), tiket sesi (hmac), tingkat.
                             TANPA pustaka auth pihak ketiga; alasannya di kepala berkas
             api/akun.py   — daftar/masuk, langganan, token, pantauan, Laporan PDF
             seed_akun.py  — akun pemilik. Skrip, BUKAN migrasi: migrasi itu bentuk,
                             akun itu isi, dan isi tidak boleh menyelinap ke tiap lingkungan
frontend/    React + Vite + MapLibre GL. Sengaja ramping; berkas baru butuh alasan
             components/Akun.tsx    — SesiProvider yang MEMILIKI kedua dialognya,
                                      supaya `mintaLangganan()` bisa dipanggil dari mana saja
             components/Premium.tsx — filter multi-kawasan, komparasi, pemantauan, riwayat
             components/GerbangTemuan.tsx — bagian `#temuan`. NOL angka di dalamnya;
                                      semuanya dari ringkasan-data.ts
             lib/layer-peta.ts     — aturan pewarnaan layer, dipakai peta DAN gerbang
             lib/potret-kartu.ts   — HANYA dipakai skrip; tidak masuk bundel
             lib/kartu-gerbang.ts  — DIBUAT OTOMATIS skrip; jangan disunting
             lib/ringkasan-data.ts — DIBUAT OTOMATIS `s7_publish.py --ekspor`:
                                     cakupan, batasan, DAN keempat temuan berikut
                                     kalimatnya. Jangan disunting tangan
             scripts/              — pembuat gambar kartu gerbang
             public/kartu/         — enam WebP, ~210 KB, di-commit
pipeline/    Python s1→s7. Satu-satunya tempat skor dihitung
             rute_ors.py — DUA hal lewat OpenRouteService, dijalankan MANUAL:
                           rute jalan kaki heksagon→simpul (`hex_routes`) dan
                           kawasan jangkau 5/10/15 menit (`catchment_areas`).
                           Backend tidak pernah memanggil ORS saat melayani
                           permintaan — ia cuma membaca kedua tabel itu
docs/        9 dokumen + indeks. Kenapa, bukan bagaimana
```

**Pemuatan malas.** SEBAGIAN BESAR layar dimuat lewat `React.lazy` — peta
(MapLibre, 962 KB), gerbang, pembuka, simulasi, dan kedua dialog premium. Bundel
pertama 1.314 KB → 329 KB. Satu impor statis baru ke salah satunya menghapus
penghematan itu **tanpa ada yang memberi tahu**: periksa `npx vite build`
sesudah menyentuh impor di `App.tsx`.

Rincian tiap folder ada di `pipeline/README.md` dan `docs/arsitektur.md`.

---

## Aturan yang tidak boleh dilanggar

Sembilan, dan tidak ada perkecualian.

### 1. Skor hanya dihitung di `pipeline/s6_score.py`

Backend membaca tabel `location_scores`. Frontend menampilkan. LLM tidak pernah
menghitung apa pun. Kalau Anda menulis aritmetika skor di luar `s6_score.py`,
itu bug — cari tempat yang benar.

`core/simulasi.py` BUKAN pengecualian: yang dihitung di sana skenario milik satu
pengguna atas satu heksagon, tidak pernah tersimpan, tidak pernah memeringkat,
dan tidak mengubah satu pun kuadran. Kalau suatu saat hasilnya mulai dipakai
mengurutkan sesuatu, ia sudah jadi skor dan tempatnya pindah ke pipeline.

### 2. Data misi MAPID mentah tidak boleh keluar

Yang keluar dari API dan yang tampil di layar hanya agregat per heksagon. Sebelum
menambah endpoint, tanyakan: *bisakah respons ini dipakai merekonstruksi satu
baris survei?* Kalau ya, jangan dikirim. Melanggar ini berisiko diskualifikasi.

### 2b. Yang berbayar tidak pernah dikirim ke yang belum membayar

Blur adalah lapisan CSS, dan lapisan CSS bisa dicabut siapa pun yang membuka
panel pengembang. Bagian berbayar **tidak pernah ikut di dalam respons** untuk
tamu maupun akun gratis — `detail_heksagon` mengosongkan `variabel` dan `faktor`
di sisi server, dan `terkunci` yang memberi tahu antarmuka apa yang ditahan.
Frontend menggambar tirainya DARI daftar itu, bukan dari tebakannya sendiri.

| Berbayar | Tetap gratis |
|---|---|
| Kartu harga per heksagon (`/pricelens/{h3}`) | Layer harga di PETA |
| Commuter Clock per jam (`/hex/{h3}/commuter-clock`) | Ember 4-slot di respons detail |
| Simulasi usaha (`/hex/{h3}/simulasi`) | — |
| 43 variabel + faktor skor | Skor, kuadran, ZoneGuard, RiskRadar, keempat indeks |
| Komparasi, riwayat, dinamika, pemantauan, PDF | Grid heksagon, daftar lokasi, pencarian, Konsultan AI |

Seluruhnya dijaga `wajib_akses_penuh()`, yang meloloskan DUA jalan: langganan
aktif, atau token yang pernah dibelanjakan untuk heksagon itu. Satu fungsi untuk
keempat pintunya — kalau dipecah, "sudah bayar satu lokasi" akan berarti hal yang
berbeda di pintu yang berbeda.

**Alat AI memakai penjaga yang SAMA.** `cek_harga` dan `pola_jam` menerima
`pengguna` dari `/ai/tanya` dan menolak tamu persis seperti endpoint-nya.
Argumen `pengguna` yang datang DARI MODEL selalu dibuang lebih dulu — kalau
tidak, model bisa menulisnya sendiri di argumen dan membuka pintunya sendiri.

Tiga tingkat, dan yang kedua paling sering salah dipahami:

| tingkat | artinya |
|---|---|
| `tamu` | belum masuk |
| `gratis` | sudah masuk, **tidak** berlangganan — haknya SAMA PERSIS dengan tamu |
| `premium` | langganan aktif, atau akun bertanda `selamanya` |

Masuk bukan cara membuka fitur; berlangganan yang membukanya. Satu pengecualian
yang disengaja: akun gratis yang membelanjakan token untuk satu heksagon
mendapat isi penuh **heksagon itu saja**, selamanya.

Penjaganya `wajib_premium` sebagai **dependensi**, bukan `if` di dalam badan
fungsi — alasan yang sama dengan `saring_zoneguard()`: penjaga yang harus
diingat untuk dipanggil adalah penjaga yang suatu saat lupa dipanggil.

### 3. Setiap skor wajib membawa badge keyakinan

Setiap skema yang membawa skor wajib membawa `keyakinan: BadgeKeyakinan`
(Q01–Q03). Sudah ditegakkan di tipe di `backend/app/schemas.py` — jangan
melonggarkannya.

### 4. Kosong tetap kosong

`NaN` tidak pernah diisi nol. "Nol transaksi tercatat" dan "belum ada yang
mensurvei" adalah dua pernyataan berbeda. Kalau sebuah variabel harus dinetralkan
untuk perhitungan, nilainya **0,5** (tengah skala ternormalisasi), bukan 0.

### 5. Kunci API lewat environment variable

MAPID Data API key dan kunci LLM **backend-only** — termasuk tidak lewat variabel
`VITE_`, yang seluruhnya ikut ter-bundel ke berkas publik. Kunci basemap MAPID
Maps pun sudah dicabut dari peramban: gaya basemap dilayani sebagai berkas
statis di `frontend/public/basemap/`.

### 6. Basemap hanya MAPID Maps

Tidak ada sumber tile lain. Atribusi OpenMapTiles/OSM di style MAPID adalah
atribusi milik MAPID atas data sumbernya — bukan tanda kita memakai tile OSM.

### 7. Prompt AI hidup sebagai berkas

`pipeline/prompts/*.md`, bukan string di dalam kode. Kode membaca berkas itu.
Perubahannya tercatat di git, dan berkas itu sekaligus bukti untuk ketentuan
lomba C.1.

### 8. Galat tidak pernah bocor apa adanya

Pesan galat tak terduga bisa memuat nama tabel, jalur berkas, bahkan potongan
sandi. `core/galat.py` yang menanganinya: yang keluar ke pengguna hanya kode
generik dan `request_id`; isinya lengkap ada di log server. Jangan pernah
menambahkan penangan yang meneruskan `str(exc)` ke luar.

---

## Konvensi

- **Bahasa Indonesia** untuk dokumen, komentar, dan identifier kode. Pengecualian:
  istilah yang sudah baku (`h3_index`, `opportunity_score`, `GeoJSON`).
- **Kode variabel** (D01, B07, C06…) adalah identitas kanonik; nama kolom adalah
  implementasinya. Jembatannya `KODE_KE_KOLOM` di `pipeline/config.py`, yang
  di-`assert` harus berisi tepat 43 entri. `app/api/bersama.py::SEMUA_VARIABEL`
  menegakkan angka yang sama di sisi backend.
- **Endpoint memakai `Annotated[T, Query(...)] = nilai`**, bukan
  `= Query(default=nilai)`. Bentuk kedua membuat fungsinya hanya bisa dipanggil
  lewat HTTP, dan modul AI memanggilnya langsung sebagai alat.
- **Aturan tampilan tinggal di `app/core/aturan.py`.** Kalau sebuah angka
  mengubah peringkat, ia bukan aturan tampilan dan tempatnya bukan di sana.
- **Sumber kebenaran tunggal**: `pipeline/config.py` untuk pipeline,
  `frontend/src/config.ts` untuk frontend. Jangan menulis ulang ambang, bobot,
  atau nama kolom langsung di berkas lain.
- **Kolom bersatuan "%" disimpan 0–100**, bukan pecahan 0–1. Skalanya tidak
  menyentuh skor (min-max kebal perkalian tetap), jadi ini murni soal angka yang
  dibaca orang — dan justru itu yang tidak akan pernah memunculkan galat.
- **Komentar menjelaskan kenapa, bukan apa.** Repo ini padat keputusan; yang
  berharga adalah alasannya.
- **Jangan menambah berkas kalau tidak perlu.** Struktur ini sengaja dijaga
  ramping. Kalau butuh berkas baru, pastikan ia punya alasan yang tidak bisa
  dipenuhi berkas yang sudah ada.

---

## Perintah

```bash
# Pipeline — uji, tanpa DB dan tanpa data lapangan
cd pipeline && python test_s6_score.py      # skoring + sensitivitas bobot
cd pipeline && python test_s4_spatial.py    # Commuter Clock, PriceLens, D04, Kompetisi
cd pipeline && python test_s5_impute.py     # GapFill: penjaga + model
cd pipeline && python test_s7_publish.py    # pembersihan nilai sebelum ke DB

# Grid heksagon vs config.PUSAT. Tanpa --terapkan ia hanya melapor.
cd pipeline && python s7_publish.py --grid
cd pipeline && python s7_publish.py --grid --terapkan   # MENGHAPUS heksagon

# --ekspor menulis DUA hal dari basis data yang sama: GeoJSON statis di
# frontend/public/data/ DAN frontend/src/lib/ringkasan-data.ts (cakupan, sumber,
# batasan, temuan). Satu bendera, bukan dua: peta dan kalimat yang
# menerangkannya tidak boleh bisa berselisih.
cd pipeline && python s7_publish.py --muat --ekspor
cd pipeline && python s7_publish.py --cakupan    # kawasan mana yang siap demo

# OpenStreetMap (Overpass). Tanpa kunci; tiap kawasan disinggahkan dan tidak
# pernah ditarik dua kali — aman diulang saat Overpass sedang penuh.
cd pipeline && python s1_ingest.py --simpul      # stasiun, terminal, halte
cd pipeline && python s1_ingest.py --poi         # POI usaha + konteks
cd pipeline && python s1_ingest.py --bangunan    # footprint; DIPETAK 3x3 per kawasan
cd pipeline && python s7_publish.py --osm        # -> business_pois + C01-C03,C05,C06,D08,D09

# GapFill B07 dengan ground truth SE-JABODETABEK, bukan cuma 708 heksagon kita —
# model tidak peduli di mana barisnya berada, ia cuma perlu prediktornya.
cd pipeline && python s1_ingest.py --poi-luar    # 63 tarikan Overpass, resumable
cd pipeline && python s7_publish.py --gapfill    # melatih + melapor, tanpa memuat
cd pipeline && python s7_publish.py --gapfill --terapkan --hitung-ulang
cd pipeline && python s7_publish.py --bangunan   # -> M01 rasio tutupan, M02 luas median
cd pipeline && python s7_publish.py --isi-d04    # -> D03 jarak + D04 waktu, dari hex_routes

# Data misi MAPID. Butuh MAPID_DATA_API_KEY. Disaring per POLIGON, bukan per
# tim — jadi ini kumpulan seluruh peserta.
cd pipeline && python s1_ingest.py --misi        # -> data/01_mentah/mapid_misi.json
cd pipeline && python s7_publish.py --misi       # -> 3 tabel observasi + B06,B07,B08,
                                                 #    C07,C08,D10,D12,P03 + Q01/Q02/Q03

# Zonasi RDTR ATR/BPN (GISTARU). Tanpa kunci; DKI Jakarta saja. Aman diulang.
cd pipeline && python s1_ingest.py --rdtr        # -> rdtr_dki.json (708 kueri, ~15 mnt)
cd pipeline && python s7_publish.py --rdtr       # -> L01 izin, L02 zona, L03 banjir

# Angkutan umum OSM -> D05. --rute dulu, --henti membaca hasilnya. --henti
# bertanya MENURUT ID: kueri spasialnya dijawab 504 berkali-kali.
cd pipeline && python s1_ingest.py --rute        # relasi rute -> osm_rute.json
cd pipeline && python s1_ingest.py --henti       # koordinat henti -> osm_henti.json
cd pipeline && python s7_publish.py --transit    # -> D05

# Kosongkan variabel karangan demo_seed (aturan 4). MEMBUANG angka dan tidak
# bisa dikembalikan. Ikut mengosongkan hex_hourly_profiles.
cd pipeline && python s7_publish.py --kosongkan --hitung-ulang

# Survei lapangan. Targetnya BUKAN 708 heksagon: GapFill menuntut 30 baris
# ground truth di >= 3 kawasan, lalu ia mengisi seluruh 708 sendiri.
cd pipeline && python rencana_survei.py          # berapa lagi yang kurang
cd pipeline && python rencana_survei.py --tulis  # -> CSV + lembar cetak
cd pipeline && python s7_publish.py --survei     # CSV terisi -> 12 variabel

# Penduduk (WorldPop, CC BY 4.0). Raster 51 MB, diunduh sekali dari
# https://data.worldpop.org/GIS/Population/Global_2000_2020_Constrained/2020/BSGM/IDN/idn_ppp_2020_UNadj_constrained.tif
# -> pipeline/data/01_mentah/worldpop_idn_2020.tif
cd pipeline && python s7_publish.py --penduduk   # -> D01, dan C06 yang bergantung padanya
cd pipeline && python s7_publish.py --osm --hitung-ulang   # sekalian skor ulang

# demo_seed MENOLAK jalan kalau DB memuat rute ORS / POI OSM. `--paksa`
# melewatinya, dan artinya membuang data yang butuh berjam-jam dibuat.
cd pipeline && python demo_seed.py --isi

# demo_pameran BEDA dari demo_seed di atas: ia TIDAK membangun dari nol dan
# TIDAK menyentuh baris yang sudah terisi - ia menambal sel yang KOSONG lewat
# angka yang diturunkan dari sinyal nyata (jarak simpul, penduduk, POI), lalu
# menjalankan mesin skor yang sama persis (aturan 1 tetap utuh). Ditulis untuk
# pameran/demo publik: seluruh badge "belum disurvei" hilang, seluruh layer
# terisi, rute mobil dan pita isochrone 30/60 menit ikut dibuat. `--copot`
# mengembalikan basis data PERSIS seperti semula - dibuktikan lewat sidik jari
# (jumlah baris, total skor, sebaran kuadran) sebelum dan sesudah round-trip
# isi->copot->isi. Manifesnya di pipeline/data/demo_pameran/*.json; JANGAN
# hapus manifes itu secara manual, `--copot` butuh isinya.
cd pipeline && python demo_pameran.py --isi      # tambal seluruh sel kosong
cd pipeline && python demo_pameran.py --status   # lihat keadaan, tanpa mengubah
cd pipeline && python demo_pameran.py --copot    # kembalikan persis seperti semula

# Rute jalan kaki (ORS). Butuh ORS_API_KEY di backend/.env.
cd pipeline && python rute_ors.py --status       # cakupan, tanpa memanggil ORS
cd pipeline && python rute_ors.py                # yang belum punya rute saja
cd pipeline && python rute_ors.py --rapikan      # jahit ujung + urutkan, tanpa ORS
cd pipeline && python rute_ors.py --isochrone    # kawasan jangkau tiap simpul

# Backend
cd backend && python tests/test_aturan.py   # aturan + konsistensi lintas berkas
cd backend && python tests/test_infra.py    # galat, cache, pembatas, berkas deploy
cd backend && python tests/test_ai_loop.py  # loop agentik, klien tiruan
cd backend && python tests/test_akun.py     # akun, tingkat, penjagaan fitur berbayar
cd backend && python tests/smoke_api.py     # 6 fitur ke Supabase, di-rollback
cd backend && python seed_akun.py           # akun pemilik (idempoten)
# `python -m uvicorn`, BUKAN `uvicorn` polos, dan TANPA `--reload` di Windows.
# Keduanya gagal diam di sini - lihat docs/jebakan.md. Sesudah menyentuh
# backend, MATIKAN lalu nyalakan lagi; tidak ada yang memuat ulang sendiri.
cd backend && venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
cd backend && alembic upgrade head

# Frontend
cd frontend && npm run dev
cd frontend && npx tsc -p tsconfig.app.json --noEmit && npx oxlint
cd frontend && npx vite build               # ukur ulang pemecahan bundel
cd frontend && node scripts/gaya-basemap.mjs # gaya statis; butuh backend hidup
cd frontend && SANDI=... node scripts/audit-prd.mjs   # 43 asersi; butuh keduanya hidup
cd frontend && node scripts/potret-kartu.mjs # kartu gerbang; butuh keduanya hidup
```

---

## Verifikasi sebelum menyatakan selesai

| Kalau Anda menyentuh… | Jalankan |
|---|---|
| `s6_score.py` atau bobot | `test_s6_score.py` (14 uji, ρ > 0,85) |
| Pipeline jam / harga | `test_s4_spatial.py` (13 uji) |
| Data misi MAPID | `test_s4_spatial.py` — heksagon yang TIDAK disurvei wajib KOSONG, bukan nol. Misi itu survei bertitik; mengisinya nol menggambarkan Jabodetabek sebagai kawasan mati. KEBALIKAN dari OSM, yang menanyai seluruh wilayah sehingga nol memang temuan |
| POI OSM, `OSM_KE_KELAS`, variabel Kompetisi | `test_s4_spatial.py` — dua hal yang gagalnya DIAM: heksagon tanpa satu pun POI harus tetap muncul di hasil, dan sekolah/masjid/kantor tidak boleh lolos ke `business_pois` sebagai kompetitor |
| `s7_publish.py` | `test_s7_publish.py` (15 uji) |
| Rute / isochrone / `rute_ors.py` | `smoke_api.py`, bagian **Rute jalan kaki** dan **Kawasan jangkau**. Sebelas asersinya berjalan atas DATA PRODUKSI — disengaja, karena tabel kosong di produksi tidak boleh tetap hijau |
| Backend | kelima berkas di `backend/tests/` |
| Apa pun yang berbayar | `test_akun.py` — yang penting bukan "apakah pelanggan bisa masuk", melainkan apakah tamu dan akun gratis benar-benar TIDAK menerima isinya |
| Model / skema | `alembic upgrade head` berhasil di basis data nyata |
| Frontend | `npx tsc -p tsconfig.app.json --noEmit` dan `npx oxlint` (**bukan** `npx tsc --noEmit`) |
| Palet kuadran, ekspresi pewarnaan, ambang skor | `node scripts/potret-kartu.mjs` — kartu gerbang adalah gambar yang di-commit; tanpa ini ia diam-diam memperlihatkan keadaan lama |
| Bagian `#temuan` | `s7_publish.py --ekspor`, lalu `test_aturan.py` (bentuk terbitan) DAN `audit-prd.mjs` (tiap angka yang terlihat wajib punya pasangan nilai di modulnya) |
| Sumbu prestise, `BAHAN_PRESTISE`, `hitung_prestise_visual()` | `test_aturan.py` DAN `audit-prd.mjs` — yang dijaga bukan "apakah sumbunya tergambar", melainkan apakah layar masih MENYEBUTKAN sumbu itu berdiri di atas bahan apa |

**Memuat ulang basis data** menuntut tiga hal sekaligus, dan ketiganya gagal diam:

1. `SELECT count(*)` tiap tabel — JANGAN cuma mengandalkan uji. Uji ber-rollback
   menaburkan barisnya sendiri, jadi ia tetap HIJAU untuk tabel yang di produksi
   kosong melompong. Begitulah `score_factors` bisa nol berbulan-bulan.
2. `python s7_publish.py --ekspor` — gerbang menyebut angka DAN kesimpulan dari
   `lib/ringkasan-data.ts`. Kesimpulan basi di depan juri tidak terbaca sebagai
   angka lama; ia terbaca sebagai tim yang tidak memeriksa pekerjaannya.
3. `node scripts/potret-kartu.mjs` — kartu gerbang.

**Menambah endpoint** menuntut lima hal:

0. Kalau isinya bergantung pada SIAPA yang memanggil, JANGAN pasang `@ber_cache`
   — cache tidak tahu soal tingkat akun dan akan menyajikan jawaban milik
   pelanggan kepada tamu berikutnya. Gagalnya diam.
1. Aturan 2 — bisakah responsnya merekonstruksi satu baris survei?
2. Kalau ia MEREKOMENDASIKAN lokasi, wajib lewat `saring_zoneguard()`.
3. Parameter `kawasan` wajib lewat `periksa_kawasan_banyak()`. Pakai
   `periksa_kawasan()` yang tunggal hanya kalau menggabungkan kawasan memang
   merusak artinya, seperti persentil churn di `/skor/dinamika`.
4. Ambil heksagon lewat `ambil_hex()`, jangan `db.get` + 404 sendiri.

> **Ukur di build PRODUKSI, bukan di dev server.** Dev build membawa React mode
> DEV (`jsxDEV`, StrictMode render ganda), sumber tanpa minifikasi, dan HMR.
> Selisihnya besar dan menyesatkan: bingkai median halaman gerbang **100 ms di
> dev, 16,7 ms di produksi** — sama persis kodenya. `npx vite build && npx vite
> preview` lalu ukur di `:4173`, yang sudah ada di `cors_origins`.

---

## Dua belas jebakan yang paling mahal

Katalog lengkapnya — 184 baris — ada di **[docs/jebakan.md](docs/jebakan.md)**.
Yang di bawah ini yang paling sering terulang atau paling besar akibatnya.

1. **Build produksi tidak menggambar satu heksagon pun.** Vite tidak mengemit
   worker MapLibre; `optimizeDeps.exclude` cuma berlaku untuk DEV SERVER. Nol
   galat konsol, dan `npm run dev` sempurna. Dijaga plugin `workerMaplibre()`
   yang mengemit **DUA** berkas bernama TETAP. **`npx vite build && npx vite
   preview` lalu KLIK petanya** — `audit-prd.mjs` berjalan di dev server secara
   bawaan, jadi ia hijau untuk build yang rusak total.
2. **Uji yang tidak pernah diperiksa arah gagalnya adalah uji yang belum selesai
   ditulis.** Sudah terjadi empat kali: asersi negatif atas cabang yang tidak
   pernah dirender, pemindai sumber yang lolos atas string kosong, uji cache
   yang lolos karena alamat memori didaur ulang, dan klik dropdown yang tidak
   pernah mendarat sementara asersinya menanyakan hal lain. Cara memeriksanya
   bukan membaca kodenya, melainkan **merusak yang dijaganya lalu memastikan ia
   berteriak** — dan menanyakan "apa yang berubah di dunia kalau langkah ini
   dihapus".
3. **`npx tsc --noEmit` lolos padahal ada galat tipe.** `tsconfig.json` berisi
   `files: []` + `references`; tanpa `-b`, tsc memeriksa NOL berkas dan keluar 0.
   Pakai `npx tsc -p tsconfig.app.json --noEmit`.
4. **Cache tidak tahu soal tingkat akun maupun heksagon.** Endpoint yang isinya
   bergantung tingkat akses TIDAK boleh di-cache. Dan sesi disaring dari kunci
   menurut **tipe**, bukan menurut posisi — `simpul_terdekat(h3_index, db)`
   pernah membuat dua heksagon berbagi satu kunci.
5. **Variabel yang jadi nyata separuh.** `muat_variabel` hanya menyentuh baris
   yang DIKIRIM, jadi sumber baru yang tidak menjangkau semua heksagon
   meninggalkan sisanya memegang angka `demo_seed` di kolom yang sama. Selalu
   `reindex` ke SELURUH heksagon sebelum memuat; yang tidak terjangkau jadi NULL.
6. **Menghapus baris menghapus lebih banyak daripada yang diniatkan.**
   `DELETE FROM transport_nodes` pernah membawa serta 1.587 rute ORS lewat
   CASCADE, dan `business_pois` justru TIDAK ikut cascade sehingga meninggalkan
   POI yatim yang tetap terhitung. Sebelum menghapus di tabel mana pun, `grep`
   kolom kuncinya di seluruh skema — cascade yang ada menyembunyikan yang tidak.
7. **Pemicu diturunkan dari data, teksnya ditulis tangan.** Sudah terjadi pada
   pita status, halaman gerbang, dan `catatan_data`. Kalau sebuah PEMICU perlu
   dihitung dari data supaya tidak berbohong, KALIMAT yang menyertainya perlu
   dihitung juga.
8. **Pesan untuk pengembang bocor ke layar pengguna.** Nama berkas pipeline,
   nama tabel, `LLM_API_KEY belum diisi`. Sudah terjadi di empat tempat.
   Sebabnya dalam bahasa pengguna; teknisnya ke `log.warning`. Dan frontend
   menampilkan pesan backend apa adanya — kalimat rakitan di sekitarnya yang
   membuat teks backend terbaca sebagai instruksi.
9. **Sesudah memperbaiki sebuah kalimat, `grep` kalimat itu di seluruh `src/`.**
   Kalimat yang sama di tempat lain tidak akan pernah memunculkan galat.
   `Legenda.tsx` menyimpan klaim lama di tiga tempat selama berbulan-bulan.
10. **Berkas konfigurasi yang belum pernah dieksekusi adalah kode yang belum
    pernah dikompilasi.** `render.yaml` memuat tiga kerusakan sekaligus dan tidak
    satu pun dari 497 asersi bisa menangkapnya; `_headers` dan `_redirects`
    format Cloudflare ikut ter-deploy ke GitHub Pages yang mengabaikannya.
    "Berkasnya ada di tempat yang benar" bukan bukti ia dibaca siapa pun — yang
    membuktikan cuma `curl -I` ke terbitan yang sedang hidup.
11. **Situs yang MENJAWAB dan situs yang BEKERJA adalah dua hal berbeda.**
    Terbitan publik pernah hidup dengan `VITE_API_BASE_URL` kosong: heksagon
    tergambar, dan panel detail, Kompas Kuadran, akun, serta Konsultan AI hilang
    semua. Buka tautan publiknya dan klik, jangan hanya `curl` halaman depannya.
12. **Angka yang kosong tidak boleh tampil seperti angka yang terukur.** Variabel
    kosong dinetralkan ke 0,5 untuk perhitungan — benar untuk skor, berbahaya
    untuk tampilan. Keluarga yang sama: badge yang mengaku disurvei, RiskRadar
    yang menyebut AMAN tanpa data, ZoneGuard yang diam untuk zona yang
    diizinkan, dan grafik jam yang memampatkan jam tak berdata.

---

## Kalau harus memutuskan sesuatu sendiri

Urutan preferensi, dari yang paling didahulukan:

1. **Jangan melanggar sembilan aturan di atas.** Tidak ada perkecualian.
2. **Jujur lebih baik daripada terlihat lengkap.** `501` dengan pesan yang benar
   lebih baik daripada jawaban palsu; badge `RENDAH` lebih baik daripada
   menyembunyikan bahwa datanya tipis.
3. **Sedikit berkas lebih baik daripada banyak.** Ini permintaan eksplisit
   pemilik repo.
4. **Yang bisa dijelaskan ke juri lebih baik daripada yang canggih.** Model
   statistik yang bisa diaudit mengalahkan LLM yang tidak.
5. **Ruang lingkup terkunci di 6 kawasan pilot.** Jangan melebar.

Kalau sebuah keputusan tidak tercakup di atas dan konsekuensinya besar, tanyakan
ke pemilik repo — jangan menebak.
