# CLAUDE.md

Panduan untuk sesi AI berikutnya di repositori ini. Dibaca otomatis setiap sesi
baru. **Baca sampai habis sebelum menyentuh kode** — sebagian aturan di bawah
berkonsekuensi diskualifikasi lomba, bukan sekadar gaya penulisan.

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
             components/Akun.tsx    — SesiProvider + dialog masuk/daftar + dialog langganan.
                                      Provider yang MEMILIKI kedua dialognya, supaya
                                      `mintaLangganan()` bisa dipanggil dari mana saja
             components/Premium.tsx — filter multi-kawasan, komparasi, pemantauan, riwayat
             SEBAGIAN BESAR layar dimuat MALAS lewat React.lazy: peta (MapLibre,
             962 KB), gerbang, pembuka, simulasi, dan kedua dialog premium.
             Bundel pertama 1.314 KB -> 329 KB. Kalau menambah impor statis ke
             salah satunya, penghematan itu hilang tanpa ada yang memberi tahu -
             periksa `npx vite build` sesudah menyentuh impor di App.tsx
             lib/layer-peta.ts   — aturan pewarnaan layer, dipakai peta DAN gerbang
             lib/potret-kartu.ts — HANYA dipakai skrip; tidak masuk bundel
             lib/kartu-gerbang.ts — DIBUAT OTOMATIS skrip; jangan disunting
             scripts/            — pembuat gambar kartu gerbang
             public/kartu/       — enam WebP, ~210 KB, di-commit
pipeline/    Python s1→s7. Satu-satunya tempat skor dihitung
             rute_ors.py — DUA hal lewat OpenRouteService, dijalankan MANUAL:
                           rute jalan kaki heksagon→simpul (`hex_routes`) dan
                           kawasan jangkau 5/10/15 menit (`catchment_areas`).
                           Backend tidak pernah memanggil ORS saat melayani
                           permintaan — ia cuma membaca kedua tabel itu
docs/        7 dokumen. Kenapa, bukan bagaimana
```

Rincian tiap folder ada di `pipeline/README.md` dan `docs/arsitektur.md`.

---

## Tujuh aturan yang tidak boleh dilanggar

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
tamu maupun akun gratis - `detail_heksagon` mengosongkan `variabel` dan `faktor`
di sisi server, dan `terkunci` yang memberi tahu antarmuka apa yang ditahan.
Frontend menggambar tirainya DARI daftar itu, bukan dari tebakannya sendiri.

Yang berbayar per 24 Agustus 2026, seluruhnya dijaga `wajib_akses_penuh()`:

| Berbayar | Tetap gratis |
|---|---|
| Kartu harga per heksagon (`/pricelens/{h3}`) | Layer harga di PETA |
| Commuter Clock per jam (`/hex/{h3}/commuter-clock`) | Ember 4-slot di respons detail |
| Simulasi usaha (`/hex/{h3}/simulasi`) | — |
| 43 variabel + faktor skor | Skor, kuadran, ZoneGuard, RiskRadar, keempat indeks |
| Komparasi, riwayat, dinamika, pemantauan, PDF | Grid heksagon, daftar lokasi, pencarian, Konsultan AI |

`wajib_akses_penuh()` meloloskan DUA jalan: langganan aktif, atau token yang
pernah dibelanjakan untuk heksagon itu. Satu fungsi untuk keempat pintunya -
kalau dipecah, "sudah bayar satu lokasi" akan berarti hal yang berbeda di
pintu yang berbeda.

**Alat AI memakai penjaga yang SAMA.** `cek_harga` dan `pola_jam` menerima
`pengguna` dari `/ai/tanya` dan menolak tamu persis seperti endpoint-nya. Alat
AI bukan pintu belakang. Argumen `pengguna` yang datang DARI MODEL selalu
dibuang lebih dulu - kalau tidak, model bisa menulisnya sendiri di argumen dan
membuka pintunya sendiri.

Tiga tingkat, dan yang kedua paling sering salah dipahami:

| tingkat | artinya |
|---|---|
| `tamu` | belum masuk |
| `gratis` | sudah masuk, **tidak** berlangganan - haknya SAMA PERSIS dengan tamu |
| `premium` | langganan aktif, atau akun bertanda `selamanya` |

Masuk bukan cara membuka fitur; berlangganan yang membukanya. Satu pengecualian
yang disengaja: akun gratis yang membelanjakan token untuk satu heksagon
mendapat isi penuh **heksagon itu saja**, selamanya.

Penjaganya `wajib_premium` sebagai **dependensi**, bukan `if` di dalam badan
fungsi - alasan yang sama dengan `saring_zoneguard()`: penjaga yang harus
diingat untuk dipanggil adalah penjaga yang suatu saat lupa dipanggil.

### 3. Setiap skor wajib membawa badge keyakinan

Setiap skema yang membawa skor wajib membawa `keyakinan: BadgeKeyakinan`
(Q01–Q03). Ini sudah ditegakkan di tipe di `backend/app/schemas.py` — jangan
melonggarkannya.

### 4. Kosong tetap kosong

`NaN` tidak pernah diisi nol. "Nol transaksi tercatat" dan "belum ada yang
mensurvei" adalah dua pernyataan berbeda. Kalau sebuah variabel harus dinetralkan
untuk perhitungan, nilainya **0,5** (tengah skala ternormalisasi), bukan 0.

### 5. Kunci API lewat environment variable

MAPID Data API key dan kunci LLM **backend-only** — termasuk tidak lewat variabel
`VITE_`, yang seluruhnya ikut ter-bundel ke berkas publik. Kunci basemap MAPID
Maps boleh di frontend.

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
- **Komentar menjelaskan kenapa, bukan apa.** Repo ini padat keputusan; yang
  berharga adalah alasannya.
- **Jangan menambah berkas kalau tidak perlu.** Struktur ini sengaja dijaga
  ramping. Kalau butuh berkas baru, pastikan ia punya alasan yang tidak bisa
  dipenuhi berkas yang sudah ada.

## Perintah

```bash
# Pipeline — tanpa DB, tanpa data lapangan
cd pipeline && python test_s6_score.py      # skoring + sensitivitas bobot
cd pipeline && python test_s4_spatial.py    # Commuter Clock, PriceLens, D04, Kompetisi
cd pipeline && python test_s5_impute.py    # GapFill: penjaga + model
cd pipeline && python test_s7_publish.py    # pembersihan nilai sebelum ke DB

# Pipeline — terbitkan hasil ke basis data lalu ke berkas statis
# Grid heksagon vs config.PUSAT. Tanpa --terapkan ia hanya melapor.
cd pipeline && python s7_publish.py --grid
cd pipeline && python s7_publish.py --grid --terapkan   # MENGHAPUS heksagon

cd pipeline && python s7_publish.py --muat --ekspor
cd pipeline && python s7_publish.py --cakupan    # kawasan mana yang siap demo

# OpenStreetMap (Overpass). Tanpa kunci; TIDAK butuh basis data untuk menarik.
# Tiap kawasan yang berhasil disinggahkan ke data/01_mentah/_singgah/ dan tidak
# pernah ditarik dua kali — aman diulang berkali-kali saat Overpass sedang penuh.
cd pipeline && python s1_ingest.py --simpul      # stasiun, terminal, halte
cd pipeline && python s1_ingest.py --poi         # POI usaha + konteks (sekolah, dll)
cd pipeline && python s1_ingest.py --bangunan    # footprint; DIPETAK 3x3 per kawasan
cd pipeline && python s7_publish.py --osm        # -> business_pois + C01-C03,C05,C06,D08,D09
cd pipeline && python s7_publish.py --bangunan   # -> M01 rasio tutupan, M02 luas median
cd pipeline && python s7_publish.py --isi-d04    # -> D03 jarak + D04 waktu, dari hex_routes

# Data misi MAPID (Menu/Struk/Properti/Activities). Butuh MAPID_DATA_API_KEY.
# Disaring per POLIGON, bukan per tim - jadi ini kumpulan seluruh peserta.
cd pipeline && python s1_ingest.py --misi         # -> data/01_mentah/mapid_misi.json

# Zonasi RDTR ATR/BPN (GISTARU). Tanpa kunci; DKI Jakarta saja.
# Aman diulang - tiap heksagon disinggahkan dan tidak ditarik dua kali.
cd pipeline && python s1_ingest.py --rdtr        # -> rdtr_dki.json (708 kueri, ~15 mnt)
cd pipeline && python s7_publish.py --rdtr       # -> L01 izin, L02 zona, L03 banjir

# Angkutan umum OSM -> D05 skor_simpul. --rute dulu, --henti membaca hasilnya.
# --henti bertanya MENURUT ID (bukan menurut ruang); kueri spasialnya dijawab
# 504 berkali-kali, yang berbasis id selesai.
cd pipeline && python s1_ingest.py --rute        # relasi rute -> osm_rute.json
cd pipeline && python s1_ingest.py --henti       # koordinat henti -> osm_henti.json
cd pipeline && python s7_publish.py --transit    # -> D05

# Kosongkan 18 variabel yang masih karangan demo_seed (aturan 4). MEMBUANG
# angka, dan tidak bisa dikembalikan tanpa demo_seed - yang sekarang menolak
# jalan di basis data berisi data nyata. Ikut mengosongkan hex_hourly_profiles.
cd pipeline && python s7_publish.py --kosongkan --hitung-ulang
# Survei lapangan. Targetnya BUKAN 708 heksagon: GapFill menuntut 30 baris
# ground truth di >= 3 kawasan, lalu ia mengisi seluruh 708 sendiri.
cd pipeline && python rencana_survei.py            # berapa lagi yang kurang
cd pipeline && python rencana_survei.py --tulis    # -> CSV + lembar cetak
cd pipeline && python s7_publish.py --survei       # CSV terisi -> 12 variabel

cd pipeline && python s7_publish.py --misi        # -> 3 tabel observasi + B06,B07,B08,
                                                  #    C07,C08,D10,D12,P03 + Q01/Q02/Q03

# Penduduk (WorldPop, CC BY 4.0). Raster 51 MB, diunduh sekali:
#   curl -L -o pipeline/data/01_mentah/worldpop_idn_2020.tif #     https://data.worldpop.org/GIS/Population/Global_2000_2020_Constrained/2020/BSGM/IDN/idn_ppp_2020_UNadj_constrained.tif
cd pipeline && python s7_publish.py --penduduk   # -> D01, dan C06 yang bergantung padanya
cd pipeline && python s7_publish.py --osm --hitung-ulang   # sekalian skor ulang

# demo_seed MENOLAK jalan kalau basis datanya memuat rute ORS / POI OSM.
# `--paksa` melewatinya, dan artinya membuang data yang butuh berjam-jam dibuat.
cd pipeline && python demo_seed.py --isi

# Rute jalan kaki (ORS). Butuh ORS_API_KEY di backend/.env.
cd pipeline && python rute_ors.py --status       # cakupan, tanpa memanggil ORS
cd pipeline && python rute_ors.py                # yang belum punya rute saja
cd pipeline && python rute_ors.py --rapikan      # jahit ujung + urutkan, tanpa ORS
cd pipeline && python rute_ors.py --isochrone    # kawasan jangkau tiap simpul

# Backend
cd backend && python tests/test_aturan.py   # aturan + konsistensi lintas berkas
cd backend && python tests/test_infra.py    # galat, cache, pembatas
cd backend && python tests/test_ai_loop.py  # loop agentik, klien tiruan
cd backend && python tests/test_akun.py     # akun, tingkat, penjagaan fitur berbayar
cd backend && python tests/smoke_api.py     # 6 fitur ke Supabase, di-rollback
cd backend && python seed_akun.py           # akun pemilik (idempoten)
cd backend && uvicorn app.main:app --reload --reload-dir app  # lihat jebakan
cd frontend && npx vite build               # ukur ulang pemecahan bundel
cd backend && alembic upgrade head

# Frontend
cd frontend && npm run dev
cd frontend && npx tsc -p tsconfig.app.json --noEmit && npx oxlint

# Gaya basemap statis. Butuh backend hidup; kunci TIDAK pernah ke peramban.
cd frontend && node scripts/gaya-basemap.mjs

# Audit keenam fitur PRD di peramban. Butuh backend + frontend hidup.
cd frontend && SANDI=... node scripts/audit-prd.mjs

# Gambar kartu peta di halaman gerbang. Butuh dev server + backend hidup.
cd frontend && node scripts/potret-kartu.mjs
```

## Verifikasi sebelum menyatakan selesai

- Menyentuh `s6_score.py` atau bobot → `test_s6_score.py` (14 uji, ρ > 0,85)
- Menyentuh pipeline jam/harga → `test_s4_spatial.py` (13 uji)
- Menyentuh data misi MAPID → `test_s4_spatial.py`. Yang paling penting di sana
  satu aturan: heksagon yang TIDAK disurvei wajib KOSONG, bukan nol. Data misi
  adalah survei bertitik — 688 dari 708 heksagon tidak pernah dikunjungi siapa
  pun, dan mengisinya nol menggambarkan Jabodetabek sebagai kawasan mati. Ini
  KEBALIKAN dari OSM, yang menanyai seluruh wilayah sehingga nol memang temuan
- Menyentuh POI OSM, taksonomi `OSM_KE_KELAS`, atau variabel Kompetisi →
  `test_s4_spatial.py`. Yang paling penting di sana bukan "apakah kompetitornya
  terhitung", melainkan dua hal yang gagalnya DIAM: heksagon tanpa satu pun POI
  harus tetap muncul di hasil (kalau tidak, ia mempertahankan angka sintetis
  `demo_seed` di kolom yang sama dengan angka OSM), dan sekolah/masjid/kantor
  tidak boleh pernah lolos ke `business_pois` sebagai kompetitor
- Menyentuh `s7_publish.py` → `test_s7_publish.py` (15 uji)
- Menyentuh rute atau isochrone / `rute_ors.py` → `smoke_api.py`, bagian
  **Rute jalan kaki** dan **Kawasan jangkau**.
  Sebelas asersinya berjalan atas DATA PRODUKSI, bukan atas baris taburan uji —
  disengaja, karena tabel yang kosong di produksi tidak boleh tetap hijau
- Memuat ulang basis data → periksa `SELECT count(*)` tiap tabel, JANGAN cuma
  mengandalkan uji. Uji ber-rollback menaburkan barisnya sendiri, jadi ia tetap
  HIJAU untuk tabel yang di produksi kosong melompong — begitulah `score_factors`
  bisa nol berbulan-bulan tanpa satu pun alarm
- Menyentuh backend → kelima berkas di `backend/tests/`
- Menyentuh apa pun yang berbayar → `test_akun.py`. Yang paling penting di sana
  bukan "apakah pelanggan bisa masuk", melainkan kebalikannya: apakah tamu dan
  akun gratis benar-benar TIDAK menerima isinya. Uji yang cuma memeriksa jalur
  bahagia akan tetap hijau walaupun seluruh penjaganya dicabut
- Menyentuh frontend → `npx tsc -p tsconfig.app.json --noEmit` dan `npx oxlint`
  (**bukan** `npx tsc --noEmit` — lihat jebakan di bawah)
- Menyentuh palet kuadran, ekspresi pewarnaan layer, ambang skor, atau memuat
  ulang basis data → **`node scripts/potret-kartu.mjs`**. Kartu di halaman
  gerbang adalah gambar yang di-commit; tanpa ini ia diam-diam memperlihatkan
  keadaan lama, dan tidak ada uji yang menangkapnya
- Menyentuh model/skema → `alembic upgrade head` berhasil di basis data nyata
- Menambah endpoint → lima hal:
  0. Kalau isinya bergantung pada SIAPA yang memanggil, JANGAN pasang
     `@ber_cache` — cache tidak tahu soal tingkat akun dan akan menyajikan
     jawaban milik pelanggan kepada tamu berikutnya. Gagalnya diam
  1. Aturan 2 di atas — bisakah responsnya merekonstruksi satu baris survei?
  2. Kalau ia MEREKOMENDASIKAN lokasi, wajib lewat `saring_zoneguard()`
  3. Parameter `kawasan` wajib lewat `periksa_kawasan_banyak()` — ia menerima
     satu nama ATAU beberapa dipisah koma. Pakai `periksa_kawasan()` yang
     tunggal hanya kalau menggabungkan kawasan memang merusak artinya,
     seperti persentil churn di `/skor/dinamika`
  4. Ambil heksagon lewat `ambil_hex()`, jangan `db.get` + 404 sendiri

---

## Status per 21 Agustus 2026 (backend lengkap)

### Sudah selesai dan terverifikasi

| Bagian | Bukti |
|---|---|
| Skema basis data | 50 kolom di `hex_features` = 43 variabel + 3 penanda + kunci/geom/waktu, plus `hex_hourly_profiles`. Migrasi diterapkan ke Supabase |
| 7 modul API, 46 rute | Smoke test 95 asersi ke Supabase dalam transaksi yang di-rollback (0 baris tersisa) |
| Keenam fitur produk | PriceLens · AI Consultant · Commuter Clock · ZoneGuard · RiskRadar · GemFinder |
| AI Consultant | 12 alat mode strict, loop agentik, 26 asersi dengan klien tiruan |
| Mesin skoring | 14/14 uji lolos. Sensitivitas ρ 0,9719–0,9919 |
| Commuter Clock & PriceLens (pipeline) | 13/13 uji lolos |
| Prompt A1–A4 | Prompt produksi, sudah cocok dengan skema Pydantic |
| Frontend | 3 bagian wajib + sistem visual, Kompas Kuadran, daftar berdasar layer, 3 grafik. Peta memperlihatkan POI basemap sejak z12,5 supaya tetap terbaca sebagai peta; heksagon diturunkan opasitasnya ~30% dan dikompensasi garis yang lebih tebal. Heksagon terpilih & yang dibandingkan masuk **mode fokus**: isiannya dicabut lewat faktor pengali ketiga di ekspresi `fill-opacity`, garisnya ditebalkan, dan yang dibandingkan diberi lencana bernomor + tali putus-putus berlabel jarak |
| Halaman gerbang | Scrollytelling GSAP, sembilan bagian, hampir semuanya setinggi layar. **Nol MapLibre, nol WebGL** — peta aplikasi baru dipasang saat gerbang ditutup. Latar hero: sarang lebah satu `<pattern>` dengan **lensa yang mengikuti kursor**. Hero memuat **ikhtisar peta MapLibre sungguhan** — 108 heksagon Tanah Abang dari `/hex/layer`, basemap MAPID Dasar, DATAR dan tegak lurus dari atas (tanpa pitch, tanpa bearing; kartunya pun rata sampai orangnya menggulir), dibingkai `fitBounds` dengan bantalan proporsional. Dek enam kartu di `GerbangPeta.tsx`: enam kawasan, lima layer, empat gaya basemap MAPID — semuanya **`<img>` WebP statis** (~210 KB) yang dibuat `scripts/potret-kartu.mjs` dari basis data sungguhan dengan ekspresi pewarnaan yang sama dengan aplikasi. Halaman gerbang **tidak memuat MapLibre sama sekali**. Mengklik kartu membuka aplikasi pada kawasan dan layer itu. Bagian kuadran memakai **gulir lintang** (pin + geser samping + panel saling menimpa); pipeline memakai **rel cairan** (gumpalan yang melebur dengan simpul, filter `#g-lengket`); bagian tim ada di paling bawah di balik **jurang** yang menggelap ke hitam. Urutan layar: **gerbang → pembuka → peta** |
| Data demo | `pipeline/demo_seed.py` — 708 heksagon lewat pipeline sungguhan. Kuadran jatuh persis seperti dugaan PRD. **Seluruhnya `predicted`/`RENDAH`/0 titik misi**, dan pita "Data demo" di bilah atas menyatakannya — belum ada satu pun observasi misi MAPID di basis data |
| Ketahanan produksi | Amplop galat, cache TTL, pembatas laju, plafon biaya, GZip, kompresi geometri, bbox |
| Jembatan pipeline → DB | `s7_publish.py` — muat ke basis data + ekspor GeoJSON statis untuk CDN |
| Akun & Loconomics Premium | 5 tabel, 13 rute `/akun`, 3 rute premium di `/skor`. Tiga tingkat (tamu/gratis/premium), token satuan, Laporan Kelayakan PDF. 44 asersi di `test_akun.py` — sebagian besar menguji bahwa yang berbayar TIDAK keluar |
| Keenam baris tabel fitur | Multi-kawasan · riwayat skor · 43 variabel granular · komparasi berdampingan · pemantauan + dinamika kawasan · PDF Export |
| **Komparasi matang** | Baki 2-4 heksagon dengan bar sendiri di tengah bawah, terbagi rata sebanyak yang dipilih. Nomor kolomnya SAMA dengan lencana di peta. Heksagon yang dibandingkan masuk mode fokus: isian hilang, garis tebal. Dialognya memakai bar per metrik dengan arah yang sudah diperhitungkan - sewa termurah tampil sebagai bar TERPANJANG - plus ekspor PDF mendatar |
| **Mode fokus peta** | Heksagon terpilih dan yang dibandingkan isiannya dikalikan NOL lewat ekspresi opasitas, bukan lewat `filter` (filter layer isian sudah dipakai saringan kuadran dan saringan AI). Garis putus-putus ke stasiun terdekat dengan jarak dan menit - GARIS, bukan lingkaran; `catchment_areas` masih kosong |
| **Simulasi jadi slider** | Empat slide ber-`scroll-snap`, satu pertanyaan per slide, penggeser asumsi menetap di kaki. Sebelumnya empat kolom berdesakan dalam 46vh dan tidak ada satu pun yang cukup ruang untuk dibaca |
| **Rekomendasi personal** | `/skor/rekomendasi` + tab "Untuk Anda". Menyaring menurut anggaran & kawasan preferensi, lalu menjelaskan tiap baris dengan angka lokasi itu sendiri. Akun gratis melihat 3 teratas dan diberi tahu berapa lagi yang cocok - `total_cocok` selalu angka sebenarnya. **Tidak menghitung ulang skor**: urutannya tetap `opportunity_score` milik pipeline |
| Onboarding usaha | `users.preferensi` (JSON teks) diisi sesudah langganan aktif: jenis usaha, kawasan incaran, anggaran sewa. Menyetel bawaan simulasi dan memindahkan peta. TIDAK menyentuh satu pun skor |
| Lokasi tersimpan | Pin `Marker` DOM di peta, disegarkan lewat `sinyalSimpan` di konteks sesi - bukan menunggu refresh. Bisa dikirim langsung ke baki komparasi |
| Simulasi matang | Pangsa impas (angka paling layak dipercaya - tanpa asumsi pangsa sama sekali), tabel kepekaan pada 4 nilai pangsa, sewa tahun pertama, peringatan kalau pangsa impasnya di atas 25% |
| **Rute jalan kaki (ORS)** | `hex_routes` — 1.587 rute untuk 708 heksagon, nol gagal. Rata-rata memutar **1,82x** dari jarak lurusnya, dan 470 dari 708 heksagon memutar ≥1,4x. Dihitung `pipeline/rute_ors.py`, dibaca `/hex/{h3}/simpul-terdekat`. Garis lurus putus-putus DICABUT dari peta |
| **Kawasan jangkau (isochrone)** | `catchment_areas` — 18 pita untuk 6 simpul, lewat ORS `/v2/isochrones`. Luasnya 42–67% dari lingkaran naif, jadi bentuknya memang dibatasi jaringan jalan. Manggarai menjangkau **17 heksagon dalam 15 menit** sementara stasiun lain 34–41 — emplasemen relnya memotong jangkauan ke segala arah. Digambar sebagai GARIS berlabel di peta, di atas heksagon dan di bawah rute |
| **Mode gelap halaman gerbang** | Palet gerbang jadi variabel `--g-*`; mode gelap memakai warna dasar jurang di bagian tim. `.gerbang[data-tema='gelap']` dan `.g-nav-gelap` IKUT selektor token gelap `.peta-gelap`, jadi komponen aplikasi yang dipakai ulang (Kompas Kuadran, tombol akun, kartu kaca) ikut benar tanpa ditambal satu per satu. Sakelar cair di hero menggantikan paragraf autentikasi yang sudah tidak benar sejak akun masuk |
| **Pembatas + komposisi heksagon per bagian** | Tiap perbatasan diberi garis rambut yang memudar di kedua ujung dengan heksagon kecil di tengahnya, digambar lewat `scaleX` saat masuk layar. Tujuh bagian punya KOMPOSISI heksagonnya sendiri di belakangnya - semuanya heksagon bergaris seperti terowongan di dasar jurang, tetapi SUSUNANNYA mengacu pada isi bagiannya: sarang enam-mengelilingi-satu untuk enam kawasan, heksagon terbelah dua sumbu untuk Kompas Kuadran, rantai menurun untuk pipeline, empat heksagon meninggi untuk empat angka. Digerakkan SATU pendengar gulir: `scale` naik, `rotate` berjalan, opasitas memuncak saat bagiannya di tengah layar. Posisinya mengikuti tengah LAYAR, bukan tengah bagian |
| **Latar hero: kisi heksagon yang menyala mengikuti kursor** | Sarang redup yang DIAM, plus jendela bundar yang mengikuti kursor berisi sarang terang yang digeser BERLAWANAN sejauh yang sama - jadi sarang terang itu diam terhadap halaman dan menimpa sarang redup persis heksagon demi heksagon. Yang bergerak cuma jendelanya; keduanya `transform`, nol piksel dilukis ulang. Tidak ada gerak sendiri sama sekali: tidak bernafas, tidak berdenyut, tidak beriak. Elemennya anak `absolute` DI DALAM hero yang sudah `overflow-hidden`, jadi ia tidak bisa bocor ke bagian mana pun di bawahnya. Terukur di produksi: bingkai median **16,7 ms (60 fps)** |
| **Halaman gerbang: 3x lebih ringan saat diam** | Sembilan tween GSAP tak berujung (6 kartu dek + 3 bola kaca) dipindah ke `@keyframes` CSS, dan animasi di bagian yang di luar layar dijeda IntersectionObserver. Terukur pada build PRODUKSI, 8 dtk tanpa disentuh: kerja utas utama **1,25 → 0,42 dtk**, Script **0,49 → 0,02 dtk**, bingkai median **16,7 ms** (60 fps) baik saat diam maupun saat digulir |
| **Dimensi Kompetisi jadi nyata (OSM)** | 7.505 elemen Overpass -> **3.519 POI usaha** di `business_pois`, mengisi C01, C02, C03, C05, C06, D08, D09 untuk **seluruh 708 heksagon**. Taksonomi 83 tag OSM -> 8 kelas induk di `config.py`. Skor dihitung ulang: **rho 0,9500**, 165 heksagon (23,3%) berpindah kuadran — jauh lebih besar daripada D04 (3%), wajar karena C06 sendirian memegang 45% bobot indeks kompetisi. Kartu gerbang sudah dipotret ulang |
| **Cakupan OSM TIDAK merata antar-kawasan** | Terukur: 6,3 POI/heksagon di Dukuh Atas BNI sampai 0,6 di Harjamukti — sepuluh kali lipat. **312 dari 708 heksagon ber-C01 nol** (97% Harjamukti, 24% Dukuh Atas). Sebagiannya nyata, sebagiannya kerapatan PEMETAAN. Dampaknya ke skor ternyata kecil dan berlawanan arah dugaan (C03 keragaman yang dibalik mengimbangi C06 yang rendah), tetapi insight `SEPI_PESAING` kini dijaga `kepadatan_poi_total > 0` supaya lubang data tidak pernah disodorkan sebagai alasan memilih lokasi |
| **Atribusi ODbL** | OSM dan openrouteservice dipasang lewat `customAttribution` di `PetaInteraktif.tsx`, terpisah dari atribusi MAPID atas ubinnya. `/meta/siap` ikut membawa `atribusi` + `sumber_terbuka`, dan `catatan_data` sekarang DITURUNKAN dari jumlah baris — ia berhenti mengaku "seluruh isi peta sintetis" begitu ada variabel yang tidak lagi sintetis |
| **`demo_seed` tidak bisa lagi menghapus data nyata** | `_pastikan_boleh_menghapus()` menolak jalan kalau basis datanya memuat rute ORS, isochrone, atau POI bukan-demo. Dilewati hanya dengan `--paksa` |
| **Data misi MAPID termuat** | Ditarik ulang 29 Agu 2026: **988 titik** (sebelumnya 866 pada 27 Agu — bertambah 122 dalam dua hari, karena API-nya disaring per POLIGON dan mengembalikan survei SELURUH peserta). **46 jatuh di dalam 708 heksagon**, mengisi 25 heksagon (median jarak seluruh titik ke pusat pilot terdekat: 11,1 km — surveinya tersebar se-Jabodetabek). Mengisi DELAPAN variabel: B06, B07, B08, C07, C08, D10, D12, P03 — dan **IPTT akhirnya bisa dihitung**. rho 0,9744, 56 heksagon (7,9%) pindah kuadran. **20 heksagon `observed`, 688 `predicted`**, seluruhnya tetap RENDAH (maks 4 titik/heksagon, ambang SEDANG 10) | 
| **Pita "Data demo" berhenti bisa hilang terlalu cepat** | Sebelumnya dipicu `observasi_misi == 0`, jadi 27 titik yang mendarat di 20 heksagon akan MEMADAMKANNYA sementara 688 heksagon masih sintetis. Sekarang diturunkan dari `count(data_source != 'observed') > n/2` | 
| **P04 bukan perbandingan jumlah listing** | Ia "sewa tahunan ÷ harga jual" — rasio imbal hasil. Sempat saya daftarkan sebagai bisa-diisi-tanpa-AI; keliru. Menuntut harga, dan harga ada di foto → A1 | 
| **ZoneGuard akhirnya menjaga sesuatu yang nyata (L01, L02, L03)** | Zonasi RDTR ATR/BPN lewat GISTARU — API-nya tidak terdokumentasi, dibongkar dengan menyadap permintaan jaringan portalnya. **328 dari 708 heksagon** berzona (hanya DKI; Kota Depok dan Kota Bekasi tidak terdaftar di GISTARU sama sekali). 269 diizinkan, **2 dilarang**, 437 tidak diketahui. Kedua yang dilarang Zona Ruang Terbuka Hijau di Tanah Abang berisiko banjir ~1,0, dan keduanya kini berskor 0,0. Bonus: kolom `KRB_03` RDTR memberi **L03 sekaligus**, jadi InaRISK tidak diperlukan | rho 0,8841, 41 heksagon (5,8%) pindah kuadran, selisih maks 89 poin. Perpindahannya seluruhnya TEGAK, sesuai harapan: L03 masuk lewat IBR dan L01 menolkan — keduanya sumbu peluang |
| **D05 nyata dari relasi rute OSM** | Variabel berbobot terbesar kedua di seluruh model (0,40 di IPT) berhenti jadi `rng`. 297 relasi -> **144 lin** angkutan umum, 3.538 titik henti berkoordinat, **431 dari 708 heksagon** dilewati setidaknya satu lin. Dua koreksi yang keduanya terukur: OSM memecah satu lin jadi banyak relasi varian ("Lin Lingkar Cikarang" = **14 relasi**), dan `route=train` mencampur 46 lin ANTARKOTA dengan 4 lin KRL Commuter. Sebelum dikoreksi, Stasiun Bekasi berskor 702 melawan Dukuh Atas 259; sesudahnya sepuluh teratas dikuasai Dukuh Atas — simpul transit terbesar Jakarta, sebagaimana mestinya |
| **C04 nyata dari tag `cuisine` OSM** | Ia tidak pernah benar-benar menunggu A4: OSM sudah membawa taksonomi masakannya sendiri, 100 jenis di wilayah studi. Tagnya opsional (41,8% POI kuliner), jadi entropinya DITOLAK untuk heksagon yang tagnya terlalu tipis — **27 dari 708** lolos, sisanya kosong |
| **18 variabel sintetis dikosongkan** | `s7_publish.py --kosongkan`. Nol angka karangan tersisa di `hex_features`, dan `GET /meta/siap` sekarang MENGHITUNG berapa dari 43 yang terisi alih-alih membaca daftar tulis tangan: **25 dari 43, seluruhnya bisa dikutip**. rho 0,5775 terhadap skor lama, 330 heksagon (46,6%) pindah kuadran — perubahan terbesar sejauh ini, dan memang seharusnya begitu |
| **7.186 baris profil jam palsu bertanda `observed` dibuang** | `hex_hourly_profiles` berisi 7.186 baris untuk 474 heksagon yang seluruhnya dibangkitkan `demo_seed` dari struk karangan — dan `sumber_data`-nya tertulis `'observed'`. Ia menggerakkan Commuter Clock, fitur BERBAYAR. Persis kesalahan yang sudah pernah diperbaiki pada badge keyakinan, terulang di tabel lain |
| **Simulasi hidup tanpa sebaris pun data survei** | Sewa dan harga rata-rata per pembeli boleh DIISI SENDIRI, dan yang diisi menang atas angka basis data. Bukan kelonggaran melainkan pengakuan siapa yang memegang angka lebih benar: orang yang menimbang sebuah ruko sudah memegang penawaran pemiliknya, dan harga jual adalah rencananya sendiri. Akibatnya `pembeli impas = sewa / (hari x harga x margin)` bisa dihitung DI MANA PUN - ketiga bahannya milik pengguna. Itu yang jadi judul sekarang kalau laba tidak bisa dihitung. `sumber` ikut dikirim supaya antarmuka membedakan angka yang diketik orang dari angka yang diukur pipeline |
| **Nilai tanah & RDTR luar DKI: dicari sampai habis, buntu** | Diverifikasi 29 Agu 2026. NJOP tidak diterbitkan terbuka oleh satu pun dari tiga penerbitnya (Jakarta Satu `Bapenda`/`BPRD` 499, `BPN/Persil` terbuka tetapi tanpa kolom nilai, Bhumi ATR/BPN cuma bidang tanah, nol folder ZNT di 106 folder GISTARU). Kota Depok dan Kota Bekasi terkonfirmasi tanpa RDTR lewat indeks KEDUA — `_3200_RDTR_PROVINSI_JAWA_BARAT_PR_PERDA` memuat 34 layer yang sudah diperdakan, seluruh entri "Bekasi" adalah Cikarang. Jadi L01–L03 berhenti di 328/708 karena batas SUMBERNYA |
| **Rencana survei 30 heksagon** | `docs/data.md` bagian 11. Diturunkan dari basis data, bukan ditulis tangan: `n_titik_misi = 0` + kuadran rekomendasi + ada POI = 260 kandidat, lima teratas per kawasan menurut `opportunity_score`, berkoordinat. Yang membuatnya mendesak satu angka: **28 dari 30 heksagon berskor tertinggi belum pernah disurvei** — justru yang direkomendasikan produk dan yang akan diklik juri |
| **Kunci MAPID dicabut dari peramban** | Diverifikasi di build produksi: nol berkas di `dist/` memuat kunci, nol URL yang diminta peramban membawa `key=` atau `access_token=`. Gaya basemap jadi empat berkas statis di `frontend/public/basemap/` (224 KB), dibangkitkan `scripts/gaya-basemap.mjs` lewat `GET /meta/basemap/{gaya}/style.json` di backend. Ubin, font, dan sprite tetap diambil peramban LANGSUNG dari MAPID |
| **GapFill (s5_impute) lengkap dan teruji** | Random Forest + spatial k-fold PER KAWASAN, melaporkan R2 dan MAE apa adanya beserta pembanding "menebak rata-rata". 34 uji di `test_s5_impute.py`. **MENOLAK jalan di basis data hari ini** dan itu penjaganya bekerja: D10 dan B07 masing-masing terisi di 8 dari 708 heksagon, jauh di bawah `MIN_GROUND_TRUTH = 30` |
| **Audit PRD di peramban** | `frontend/scripts/audit-prd.mjs` - 29 asersi menelusuri keenam acceptance criteria PRD di Chromium sungguhan, dua lintasan (tamu dan pelanggan premium), plus pemeriksaan kepatuhan kunci dan basemap. 29/29 lolos di dev, 28/29 di build produksi saat MAPID sedang membatasi laju |
| **Berkas deployment** | `render.yaml` (Blueprint backend, rahasia `sync: false`), `frontend/public/_headers` dan `_redirects` (SPA + cache + header keamanan). Terverifikasi ikut ter-salin ke `dist/` |
| **Pusat Harjamukti diperbaiki** | Dari `(-6,3706 . 106,8556)` ke `(-6,37389 . 106,89567)` — OSM node/6720467138, `network=LRT Jabodebek`. Pergeseran **4.443 m**. Keenam pusat diverifikasi ulang ke OSM; lima lainnya meleset 33–328 m dan dibiarkan. 127 heksagon dibangun ulang di tempat yang benar, seluruh data turunannya ditarik ulang. Bukti perbaikannya satu angka: penarikan OSM di sana sekarang menemukan **Stasiun LRT Harjamukti pada 0 m**, sebelumnya nol stasiun rel |
| **`PUSAT` jadi satu sumber kebenaran** | Dulu tiga salinan yang saling cocok dan sama-sama salah. Sekarang `pipeline/config.py::PUSAT`, diimpor `s1_ingest.py` dan `demo_seed.py`. Frontend dijaga tiga uji baru di `test_aturan.py`, salah satunya membandingkan dengan koordinat stasiun OSM — bukan dengan salinan lain |
| Dokumentasi | 7 dokumen di `docs/` |

**483 asersi otomatis lolos** di sembilan berkas uji — 273 di `backend/tests/` (37+42+44+36+114), 210 di `pipeline/` (130+34+14+32). Ditambah **29 asersi audit peramban** di `frontend/scripts/audit-prd.mjs`, yang menuntut backend dan frontend hidup sehingga sengaja TIDAK dijumlahkan ke angka di atas.

> **Ukur di build PRODUKSI, bukan di dev server.** Dev build membawa React mode
> DEV (`jsxDEV`, StrictMode render ganda), sumber tanpa minifikasi, dan HMR.
> Selisihnya besar dan menyesatkan: bingkai median halaman gerbang **100 ms di
> dev, 16,7 ms di produksi** — sama persis kodenya. `npx vite build && npx vite
> preview` lalu ukur di `:4173`, yang sudah ada di `cors_origins`.

### Belum dikerjakan — di sinilah pekerjaan berikutnya

| Hal | Yang menghalangi | Kalau sudah ada, kerjakan |
|---|---|---|
| **`KOLOM_*_GO` masih kosong** di `pipeline/config.py` | CSV misi asli belum diunduh | **Ini yang pertama.** Cocokkan nama kolom, lalu `s1`–`s2` bisa jalan |
| Badan `s3` dan sisa `s4` | Menunggu `LLM_API_KEY` dan keputusan penyedia vision | Docstring-nya sudah memuat keputusan yang diambil — ikuti, jangan analisis ulang. `s4::profil_jam`, `belanja_per_jam`, dan `harga_sewa_per_m2` SUDAH jalan dan teruji. **`s5` sudah SELESAI** (29 Agu 2026) — Random Forest + spatial k-fold, 34 uji, dan menolak jalan sampai ground truth-nya cukup |
| `LLM_API_KEY` belum diisi | Kunci belum ada | Isi di `backend/.env`, lalu `GET /ai/status` menyatakan siap. Kode `/ai/tanya` sudah lengkap |
| **`tanggal` kosong di 691 dari 691 titik API** — tetapi jamnya ada di dalam FOTO | Struk Go tidak mengembalikan waktu transaksi sama sekali. Sekilas mematikan B01-B05, D11, P06. Diperiksa langsung: struk kertas mencetak `Date: 15-08-2026 07:05` + `Grand Total: 105.000`; tangkapan layar GoPay memuat `Rp18.000` dengan jam di bilah status | A2 mengekstrak **nominal + tanggal + jam** sekaligus, jadi `LLM_API_KEY` membuka 12 variabel — termasuk **Commuter Clock, PriceLens, dan sumbu prestise**. Itu pembuka terbesar yang tersisa |
| Mode gelap | Belum dikerjakan, sengaja | Basemap gelap sudah bisa dipilih; chrome-nya masih terang |
| Sumber NJOP (P01, P02) | **Tidak ada sumber terbukanya** — dicari sampai habis 29 Agu 2026, lihat `docs/data.md` 10.9 | Jalurnya permintaan resmi ke Bapenda DKI, bukan API |
| RDTR di luar DKI (L01–L03) | **Tidak ada** — Kota Depok dan Kota Bekasi terkonfirmasi tanpa RDTR lewat dua indeks GISTARU yang berbeda, lihat `docs/data.md` 10.10 | Berhenti di 328/708 heksagon, dan itu batas sumbernya |
| **Survei lapangan 30 heksagon** | Tim survei. Ini sekarang penghalang TERBESAR: 12 dari 18 variabel kosong hanya bisa diisi orang yang berdiri di lokasinya, dan 23 dari 24 heksagon berskor tertinggi belum pernah disurvei | Daftar target berkoordinat ada di `docs/data.md` bagian 11. Setelah masuk: `s5_impute` berhenti menolak, lalu **ulangi uji sensitivitas** dan laporkan apa adanya |
| D06 `ridership_proksi` | Bukan data yang kurang, melainkan SATUAN. BPS hanya menerbitkan per MODA (MRT 3,59 juta/bulan; LRT 101 ribu/bulan), bukan per stasiun. KAI Commuter menyebut angka stasiun di siaran pers dengan metrik yang berbeda-beda | **Keputusan pemilik repo**: satuan mana yang dipakai untuk membandingkan KRL, MRT, dan LRT dalam satu kolom |
| GeoJSON heksagon statis untuk Cloudflare | — | Mitigasi Render free tier. Gaya basemap SUDAH statis (`frontend/public/basemap/`); heksagonnya belum — `s7_publish.py --ekspor` sudah membangkitkan berkasnya, tinggal disajikan |

Kerangka `s1`–`s4` **bukan TODO kosong** (`s5` sudah terisi). Setiap docstring memuat keputusan yang
sudah diambil — ambang, urutan, jebakan yang harus dihindari. Isi badannya;
jangan mengulang analisisnya.

## Jebakan yang sudah kena — jangan diulang

| Gejala | Sebab | Perbaikan |
|---|---|---|
| **"25 dari 708 disurvei" dikira berarti 683 kunjungan lagi** | Angka itu benar dan kalimatnya menyesatkan ke arah yang sama setiap kali: ia terbaca sebagai cakupan DATA, padahal ia cakupan SURVEI. Ketujuh ratus delapan heksagon punya skor dan sumber terukur (POI OSM 708/708, skor simpul 708/708, waktu jalan 703/708, penduduk 707/708). Pemilik repo sendiri membacanya sebagai "produk ini 3,5% jadi" | Dua hal. Pitanya sekarang menyebut DUA angka: "708 heksagon terukur - 25 disurvei langsung". Dan yang lebih penting: jalan menuju 708 lewat **30**, bukan 708. `s5_impute` menuntut `MIN_GROUND_TRUTH = 30` di `MIN_KAWASAN = 3`; sesudah ambang itu lewat ia mengisi seluruh grid dan melaporkan R2/MAE-nya sendiri. Delapan dari sepuluh prediktornya sudah terisi penuh - yang kurang cuma labelnya |
| **Ground truth dihitung per HEKSAGON, padahal GapFill menghitungnya per KOLOM** | `rencana_survei.py` versi pertama melapor "masih kurang 5" dari 25 heksagon bersurvei melawan ambang 30. Yang benar kurang **19**: `s5_impute` melatih satu model per target dan menghitung barisnya sendiri-sendiri, dan D10 maupun B07 baru terisi di 11 heksagon. Satu kunjungan bisa mencatat menu tanpa mencatat struk | Hitung `count(kolom)` per target, ambil yang paling tipis. Angka yang terlalu optimistis di sini berakibat tim survei pulang terlalu cepat - dan itu ongkos yang tidak bisa ditarik kembali |
| **`muat_misi` menimpa balik nilai survei** | `muat_survei` memanggil `muat_misi` untuk menghitung ulang `n_titik_misi` dari nol (supaya idempoten). Dipanggil SESUDAH nilai survei ditulis, ia menimpa kolom yang ada di KEDUA sumber - B07 `harga_median_porsi` salah satunya - dengan turunan misi yang untuk heksagon itu justru kosong. Gejalanya "survei berhasil dimuat, kolomnya tetap NULL", tanpa galat | `muat_misi` LEBIH DULU, `muat_variabel` sesudahnya: survei menang karena ia pengukuran langsung. Dijaga uji berbasis basis data yang di-rollback |
| **`WHERE x IN :param` diam-diam salah di SQLAlchemy 2** | Tuple dikirim apa adanya sebagai satu parameter. Galatnya `syntax error at or near "$1"` - tidak menyebut parameter, tuple, maupun nama kolomnya, jadi ia terbaca seperti SQL yang salah ketik | `WHERE x = ANY(:param)` dengan list, atau `bindparam(expanding=True)` |
| **Konstanta yang disalin tiga kali tidak bisa dijaga uji konsistensi** | Pusat kawasan pilot ditulis di `s1_ingest.py`, `demo_seed.py`, DAN `frontend/src/config.ts`. Uji yang ada membandingkan ketiganya dan selalu hijau - ketiganya memang cocok. Yang tidak diperiksa siapa pun: apakah ketiganya BENAR. Pusat Harjamukti duduk 4.443 m dari stasiun LRT-nya selama berbulan-bulan, dan satu-satunya gejala yang pernah muncul adalah penarikan OSM di sana tidak menemukan satu pun stasiun rel - nol, sementara lima kawasan lain 2-10 | Python sekarang punya SATU sumber, `config.PUSAT`, dan kedua berkas lain mengimpornya. Frontend tidak bisa mengimpor Python, jadi jembatannya uji - tetapi ditambah satu uji yang berbeda jenisnya: `test_setiap_pusat_dekat_simpul_transitnya` membandingkan keenamnya dengan KOORDINAT STASIUN dari OSM, bukan dengan salinan lain. Uji kesamaan menjaga dua berkas tetap sama; uji ini menjaga keduanya tetap benar, dan itu dua hal yang berbeda |
| **Grid heksagon tidak diturunkan dari mana pun** | Grid dibangun sekali oleh `demo_seed`, lalu hidup di basis data tanpa satu pun cara memeriksanya terhadap `PUSAT`. Begitu `demo_seed` berhenti boleh dijalankan (karena ia menghapus data nyata), tidak ada jalan sah untuk memperbaiki pusat kawasan yang salah | `s7_publish.py --grid` membandingkan grid basis data dengan `config.PUSAT` dan melaporkan selisihnya; `--terapkan` menerapkannya. Ia sengaja punya bendera penerap SENDIRI, bukan menumpang `--muat` - `--muat` berarti "muat berkas hasil pipeline", dan dua arti untuk satu bendera adalah cara paling cepat membuat orang menjalankan yang tidak diniatkannya |
| **`business_pois` tidak ikut CASCADE** | Empat tabel menunjuk `hex_features` dengan `ON DELETE CASCADE` (`hex_routes`, `location_scores`, `score_factors`, `hex_hourly_profiles`). `business_pois` berkolom `h3_index` TANPA foreign key, jadi menghapus heksagon meninggalkan POI-nya sebagai baris yatim - dan POI yatim ikut terhitung di variabel kompetisi lewat k-ring tetangganya | `selaraskan_grid()` menghapus `business_pois` LEBIH DULU, selagi heksagonnya masih ada, supaya yang dihapus persis miliknya. Sebelum menghapus baris di tabel mana pun, `grep` kolom kuncinya di seluruh skema - cascade yang ada menyembunyikan yang tidak ada |
| **Pemicu diturunkan dari data, TEKSNYA ditulis tangan** | Pita status sudah benar sejak awal soal KAPAN ia muncul - `data_sintetis` dihitung backend dari jumlah heksagon bertanda `predicted`, dan komentarnya sendiri sudah memperingatkan bahwa pita yang disetel tangan akan kedaluwarsa. Yang luput: labelnya tetap ditulis tangan, "Data demo - belum ada survei lapangan". Begitu 18 variabel sintetis dikosongkan dan 27 titik misi termuat, KEDUA bagian kalimat itu salah sekaligus - datanya bukan demo, dan surveinya bukan nol. Ia memperingatkan hal yang benar dengan kalimat yang keliru, lalu meremehkan datanya sendiri di depan juri | Turunkan TEKSNYA dari angka juga: "Survei lapangan baru 20 dari 708 heksagon". Aturan umumnya: kalau sebuah pemicu perlu dihitung dari data supaya tidak berbohong, kalimat yang menyertainya perlu dihitung dari data untuk alasan yang sama persis |
| **Badge menuduh datanya tebakan model, padahal tidak ada model yang jalan** | Tooltip badge keyakinan menulis "nilai hasil imputasi model" untuk setiap heksagon `predicted`. Itu benar sewaktu `demo_seed` mengisi peta; sesudah dikosongkan, ia membuat angka yang benar-benar TERUKUR - POI OSM, rute ORS, penduduk WorldPop, zonasi RDTR - terbaca seperti tebakan. Dan `s5_impute` justru MENOLAK jalan, jadi tidak ada satu pun model imputasi yang berjalan | `predicted` di basis data ini berarti SATU hal: heksagon itu belum pernah dikunjungi surveyor. Ia bukan pernyataan tentang mutu angkanya, dan tooltipnya sekarang mengatakan itu. Sama untuk alasan rekomendasi: nol titik survei dipisah dari sedikit titik survei, karena "Baru 0 titik - angkanya masih bisa bergeser" terbaca seolah seluruh angka heksagon itu belum bisa dipercaya |
| **Kunci yang "aman di frontend" ternyata membuka data misi** | `VITE_MAPID_MAPS_API_KEY` didokumentasikan aman karena "kunci basemap cuma menghitung pemakaian". Diuji 29 Agu 2026 dengan POST yang benar (bukan GET): kunci itu SAMA PERSIS dengan `MAPID_DATA_API_KEY` di backend, dan menjawab **200 dengan 100 baris survei mentah per halaman** di keempat endpoint misi. Kunci palsu 401, jadi endpointnya memang mengotentikasi. Vite mem-bundel tiap `VITE_` ke berkas publik | Kunci dicabut total dari frontend. Yang membuatnya murah: dari seluruh rantai basemap, **hanya `style.json` yang menuntut kunci** (401 tanpa kunci); ubin, font, dan TileJSON dilayani 200 tanpa kunci. Jadi backend mengambil gayanya, membuang kuncinya, menyisipkan TileJSON-nya, lalu `scripts/gaya-basemap.mjs` menyimpannya sebagai berkas statis. Dijaga tiga uji di `test_infra.py` dan satu di `audit-prd.mjs`. Pelajaran umumnya: sebuah endpoint yang menjawab 404 untuk GET belum tentu tertutup - ia mungkin cuma menuntut POST |
| **Ubin MAPID padam berkala, dan sebabnya BUKAN kita** | `basemap.mapid.io/data/*` menjawab `401 Authorization Required` dari nginx selama belasan menit, lalu pulih sendiri - terukur dua kali dalam dua hari, sekali berdurasi **11 menit**. Selama padam, SEMUA bentuk otentikasi ditolak: `?key=`, `?api_key=`, `?apikey=`, `?token=`, header `x-api-key`, `Authorization: Bearer`, Referer geo.mapid.io, UA peramban - kedelapan-delapannya 401. Yang tetap 200 saat itu: `/styles/*` dan `/fonts/*`. Jadi style.json MAPID sendiri menunjuk ke URL yang ditolak servernya sendiri | **Dugaan pertama saya salah dan sempat tercatat di sini: dikira pembatas laju per-IP akibat audit yang dijalankan berulang.** Diuji dari jaringan yang berbeda sama sekali (WebFetch, bukan mesin ini) saat padam berlangsung: **401 juga**. Jadi ia pemadaman di sisi MAPID yang mengenai semua orang. Cara memeriksanya: kalau ubin 401 tetapi `style.json` 200, itu MAPID - jangan mengubah kode. Tunggu, atau laporkan ke Koordinator Tim. Sesudah pulih, 40/40 ubin menjawab 200 baik berkunci maupun tidak |
| **Heksagon ikut hilang saat basemap gagal** | `siap` hanya disetel dari `m.on('load')`, dan `load` menunggu render pertama yang lengkap - termasuk ubin basemap. Saat MAPID membatasi laju, `load` tidak pernah menyala, `/hex/layer` tidak pernah diminta, dan yang terlihat peta kosong total. Yang gagal cuma latarnya, tetapi yang hilang seluruh produknya | Tambah `m.once('styledata')` sebagai pemicu kedua - ia menyala begitu gaya terurai, tanpa menunggu satu ubin pun. Terukur: dengan basemap diblokir penuh, 28 dari 29 asersi audit tetap lolos. Aturan umumnya: data milik sendiri tidak boleh menunggu kejadian yang ditentukan pihak ketiga |
| **Gaya `satellite` membawa kunci ORANG LAIN** | Ditandai "keputusan pemilik repo" berbulan-bulan karena tampak sebagai pertimbangan A.3 yang bisa ditimbang dua arah. Yang menyelesaikannya bukan pertimbangan melainkan satu temuan saat gaya mulai disimpan statis: `satellite.json` memuat `access_token` Mapbox **93 karakter milik akun pihak ketiga** plus tiga sumber ke api.maptiler.com. Menyajikannya berarti ikut menerbitkan kredensial orang | Dicabut dari `GAYA_BASEMAP`, dari daftar putih backend, dan dari dek kartu. Empat gaya tersisa, seluruhnya melayani ubin dari basemap.mapid.io. Aturan keras #6 sudah menyatakannya lebih dulu; yang kurang cuma bukti |
| **NoData raster tidak pernah otomatis berarti "aman"** | InaRISK BNPB ditarik untuk memberi L03 kepada Depok dan Bekasi: 519 dari 708 heksagon berdata. Godaannya membaca NoData sebagai "tidak rawan". Disilangkan dengan KRB_03 RDTR pada 328 heksagon yang punya keduanya: heksagon NoData justru ber-KRB_03 rata-rata **0,204 melawan 0,191** pada yang berdata - tidak membawa keterangan apa pun | Diukur dulu, baru disimpulkan. Dan kedua sumbernya ternyata tidak sepadan sama sekali (Spearman 0,201; median 0,073 melawan 0,589), jadi InaRISK TIDAK dimuat - mencampurnya akan membuat Depok dan Bekasi tampak jauh lebih rawan karena SUMBERNYA, bukan karena kenyataannya |
| **"Fotonya sudah ada di tangan" mengukur bahan, bukan cakupan** | `LLM_API_KEY` didaftarkan sebagai pembuka nomor satu karena 1.472 foto misi sudah tersedia. Yang tidak ikut dihitung: berapa heksagon yang disentuhnya. Dari 866 titik misi, **27 jatuh di dalam 708 heksagon** — jadi OCR sesempurna apa pun mengisi 23 heksagon (3,2%), bukan 708. Urutan prioritas yang salah mengarahkan tenaga tim ke tempat yang salah, dan tidak ada uji yang bisa menangkapnya | Untuk setiap sumber, tanyakan DUA angka: berapa banyak bahannya, dan berapa banyak heksagon yang disentuhnya. Yang kedua yang menentukan apakah sebuah kolom berhenti kosong. Sekarang tercatat di `docs/data.md` bagian 10.11 |
| **Menyimpulkan sebuah sumber "terkunci" padahal ia tidak pernah ada** | P01/P02 dicatat "menunggu token Jakarta Satu" karena folder `Bapenda` dan `BPRD` menjawab `499 Token Required`. Terbaca seolah datanya ada di balik pintu. Ditelusuri sampai habis: `BPN/Persil_BPN_2021_map` TERBUKA dan kolomnya cuma bidang + jenis hak, Bhumi ATR/BPN cuma menerbitkan bidang tanah, dan tidak satu pun dari 106 folder GISTARU memuat ZNT | "Terkunci" dan "tidak ada" menuntut tindakan yang sangat berbeda — yang pertama berarti meminta akses, yang kedua berarti berhenti. Periksa penerbit LAIN sebelum menyimpulkan yang pertama |
| **Judul yang tidak ikut berubah saat angkanya hilang** | Panel simulasi memasang "Perkiraan kekurangan tiap bulan" di atas angka kosong, lalu menutupnya dengan "omzetnya belum menutup sewa" - kalimat yang MENYATAKAN sesuatu yang justru tidak diketahui. Ia benar selama laba selalu terhitung; begitu B10 dikosongkan, ia jadi klaim | Judul dan kalimatnya diturunkan dari APA YANG BISA DIHITUNG, bukan ditulis tetap: ada laba -> untung/rugi, tidak ada tetapi ada pembeli impas -> "Pembeli per hari agar sewa tertutup", tidak ada keduanya -> "Belum bisa dihitung" plus apa yang harus diisi. Aturan umumnya: setiap kalimat yang menemani sebuah angka harus ikut mati kalau angkanya mati |
| **Skema Pydantic disusun bidang per bidang, jadi field baru hilang diam-diam** | `hitung_simulasi` mengembalikan dict lengkap berisi `sumber`, tetapi endpoint menyusun `Simulasi(...)` satu per satu - jadi field barunya tidak pernah ikut, dan yang muncul `ValidationError ... sumber Field required` sebagai **HTTP 500 di runtime**, bukan galat saat impor | Sesudah menambah field ke skema yang dirakit manual, `grep` nama fieldnya di berkas endpointnya. Uji unit atas fungsi intinya TIDAK menangkap ini - ia lolos sempurna sementara endpointnya 500 |
| **43 `count()` yang masing-masing benar, bersama-sama memakan 31 detik** | `/meta/siap` menghitung berapa dari 43 variabel terisi lewat satu kueri per kolom. Di basis data lokal itu tidak terasa; basis datanya Supabase, satu perjalanan jaringan penuh per kueri - terukur ~700 ms sekali jalan, jadi 43 kueri = **31 detik**. Dan `/meta/siap` dipanggil setiap kali aplikasi dibuka karena pita "Data demo" membacanya, sehingga `/hex/layer` ikut mengantre di balik batas 6 sambungan per host peramban - peta tampak kosong belasan detik tanpa satu pun galat | SATU kueri berisi 43 `count()`, bukan 43 kueri berisi satu. Turun ke **2,6 dtk** dengan jawaban yang sama persis. Aturan umumnya: yang menentukan biaya bukan berat kuerinya melainkan BERAPA KALI jaringannya diseberangi - dan itu tidak akan pernah terlihat di basis data yang duduk di mesin yang sama |
| **Menyimpulkan peta rusak padahal ia masih dalam urutan pembukaannya** | Tangkapan layar pada detik ke-10 memperlihatkan peta tanpa satu pun heksagon, dan `/hex/layer` memang belum pernah diminta. Terlihat meyakinkan sebagai kerusakan. Yang sebenarnya terjadi: urutannya **gerbang -> pembuka -> peta**, `PetaInteraktif` dimuat MALAS (MapLibre 962 KB), jadi permintaan pertamanya memang baru muncul sesudah layar pembuka selesai | Tunggu sampai permintaannya benar-benar pulang, jangan tunggu sekian detik. Dan ukur waktu per permintaan (`request`/`response` Playwright) - `/hex/layer` ternyata dijawab dalam **363 ms**; yang lambat bukan dia, melainkan yang mengantre di depannya |
| **`out tags` MEMBUANG geometri, dan hilangnya tidak pernah jadi galat** | Penarikan halte lama memakainya, jadi **702 dari 808** simpul tersimpan tanpa lat/lon. Tidak ada galat; cuma simpul yang diam-diam tidak bisa dipetakan ke heksagon mana pun, dan variabel yang bergantung padanya jadi nol di mana-mana | `out body` untuk simpul, `out center` untuk way. Dan sebelum memakai berkas OSM lama, hitung `sum('lat' in e)` — bukan `len(elements)` |
| **Kueri Overpass menurut RUANG dijawab 504; menurut ID selesai** | `node["public_transport"](around:3000,...)` memaksa pemindaian kotak sebesar kawasan lalu penyaringan menurut tag. Dicoba berkali-kali di tiga cermin, semuanya 504/502/500. Yang sama juga membunuh kueri kos ber-regex nama — regex pada `name` tidak terindeks sama sekali | Kalau id-nya sudah diketahui dari langkah sebelumnya, tanya `node(id:1,2,3,...)` — itu menyentuh indeks utama. 3.526 simpul selesai dalam beberapa menit lewat POST berpetak 2.000 id. Aturan umumnya: pindahkan penyaringan dari Overpass ke kode kita kapan pun kuncinya sudah di tangan |
| **OSM memecah satu lin jadi belasan relasi, dan menghitung relasi membalik peringkat** | "Lin Lingkar Cikarang" hidup sebagai **14 relasi** — full racket, half racket, via Manggarai, via Pasar Senen, masing-masing dua arah. 297 relasi sebenarnya **148 layanan**. Terukur: Stasiun Bekasi berskor 702 melawan Dukuh Atas 259, padahal Dukuh Atas simpul transit terbesar Jakarta | Kelompokkan menurut `(route, network, ref)`, bukan menurut id relasi. Relasi tanpa `ref` (8 dari 297) memakai id sendiri — satu relasi tak bernomor lebih baik jadi satu layanan daripada dilebur dengan semua relasi tak bernomor lainnya |
| **`route=train` mencampur dua layanan yang berbeda seribu kali lipat** | OSM memuat **46 lin `network=KAI`** (Argo Bromo Anggrek, Bima, Brantas…) melawan **4 lin `KAI Commuter`** (A, B, C, R). Ditimbang sama, 46 kereta yang lewat satu-dua kali sehari menenggelamkan 4 lin yang mengangkut ratusan ribu orang setiap hari | Pisahkan menurut kata "commuter"/"krl" di `network`, bukan menurut daftar nama operator yang ditulis tangan — penamaan operator di OSM berubah lebih sering daripada layanannya. Bobot antarkota 1,5 melawan komuter 10 |
| **Angka sintetis yang MENGAKU hasil pengamatan, di tabel yang tidak pernah diperiksa** | `hex_hourly_profiles` berisi 7.186 baris ber-`sumber_data = 'observed'`, seluruhnya dari `demo_seed`, sementara `receipt_observations` sungguhan cuma 12 baris dan tidak satu pun membawa jam. Ia menggerakkan Commuter Clock — fitur BERBAYAR. Badge keyakinan sudah pernah diperbaiki karena persis kesalahan ini, dan tabel ini luput karena tidak ada yang menghitung barisnya | Sesudah membersihkan `hex_features`, periksa SETIAP tabel turunan yang punya kolom `sumber_data`/`metode`. Aturan umumnya: kolom yang menyatakan asal-usul harus diaudit dengan `GROUP BY`, bukan dipercaya |
| **"Tidak diketahui" yang dilebur jadi "aman"** | `tingkat_risiko_churn(None, ...)` mengembalikan `AMAN` dengan alasan tertulis "badge keyakinan yang menyertainya akan menunjukkan datanya tipis". Alasan itu sahih selama churn kadang-kadang ada; begitu P06 dikosongkan seluruhnya, RiskRadar menyatakan "Pergantian usaha di kawasan ini wajar" untuk **setiap** lokasi tanpa satu pun data — dan itu klaim, bukan diam | Tingkat keempat `TIDAK_DIKETAHUI`, kembaran persis dari perbaikan ZoneGuard. Dan saringan "berperingatan saja" ditulis sebagai daftar POSITIF (`TINGKAT_BERPERINGATAN`), bukan `!= "AMAN"` — bentuk negatif diam-diam menarik masuk tingkat keempat begitu ia ada, membalik arti saringannya tanpa satu pun galat |
| **Daftar sumber data yang ditulis tangan selalu kedaluwarsa ke arah yang salah** | `catatan_data` di `/meta/siap` menyebut dua sumber dan diakhiri "Sisanya masih dari pipeline/demo_seed.py". Berjam-jam sesudah demo_seed dikosongkan ia masih mengatakannya, sekaligus tidak menyebut D05, C04, M01, M02, dan L01–L03 yang sudah nyata — meremehkan dan melebih-lebihkan sekaligus | Hitung dari kolomnya: `sum(count(kolom) > 0 for kolom in SEMUA_VARIABEL)`. Yang dihitung tidak bisa ketinggalan |
| **`urllib` habis waktu ke satu host, `curl` lolos ke host yang sama** | `jakartasatu.jakarta.go.id` menjawab `curl` dalam sedetik dan membuat `urllib.request` habis waktu 40 dtk dengan `WinError 10060`. Sepuluh menit terbuang menyangka layanannya mati, padahal ia direktori ArcGIS terbuka berisi 116 folder | Kalau satu klien ditolak, coba klien lain sebelum menyimpulkan apa pun tentang hostnya |
| **Heredoc bash MEMAKAN backslash walau pembatasnya dikutip** | `<<'PYEOF'` seharusnya tidak menyentuh isinya. Di lingkungan ini `\\b` sampai ke Python sebagai `\b` di dalam string BUKAN-raw, jadi yang tertulis ke berkas karakter **backspace 0x08** — dan `re.compile(r"<0x08>(kos|kost)")` gagal mencocokkan apa pun tanpa satu pun galat. Hal yang sama mengubah `\\n` jadi baris baru sungguhan di tengah `print("` | Untuk skrip penyunting, tulis berkasnya lewat alat Write lalu jalankan, jangan lewat heredoc. Kalau terlanjur: `grep -c $'\\x08' berkas.py` menemukannya, dan `ast.parse()` menangkap yang merusak sintaks — tetapi TIDAK menangkap yang cuma merusak regex |
| **Menyimpulkan "tidak ada sumbernya" tanpa mengukur** | docs menaruh D07 di "yang tidak punya sumber" dengan alasan "OSM hampir tidak memetakan kos di Jakarta" — dugaan yang tidak pernah diuji, padahal 367.522 footprint bangunan sudah ada di disk. Diukur: **5** `building=dormitory` + **37** bernama kos = 42 titik untuk 708 heksagon | Kesimpulannya sama, tetapi sekarang berupa ANGKA yang bisa dikutip ke juri alih-alih dugaan. Ukur dulu kalau datanya sudah di tangan — pengukuran yang menolak sebuah variabel sama berharganya dengan yang mengisinya |
| **Sumber resmi yang ada, bisa dikutip, dan tetap tidak bisa dipakai** | Angka penumpang per stasiun ADA: KAI Commuter melaporkan *gate-in tahunan* Manggarai 5.456.309 sekaligus *transaksi transit* 52.409.989 untuk stasiun yang sama, Stasiun Bekasi dilaporkan *rata-rata harian* 23.142, MRT dan LRT punya pelaporan sendiri lagi | Min-max atas enam angka bersatuan berbeda menghasilkan peringkat yang tidak berarti apa-apa. "Bisa dikutip" belum cukup — yang dituntut satu satuan yang sama untuk seluruh baris di satu kolom. D06 dikosongkan sampai satuannya diputuskan |
| Tile MAPID 404 di semua zoom | Endpoint raster/XYZ MAPID rusak di sisi server (sudah diverifikasi ke WMTS capabilities mereka) | Pakai jalur vector `style.json` — sebab itu MapLibre, bukan Leaflet |
| `does not provide an export named 'default'` | MapLibre v6 tidak punya default export | `import { Map as MapLibreMap } from 'maplibre-gl'` |
| Peta kosong tapi kontrol zoom terlihat | Rantai tinggi CSS tidak terselesaikan | Wadah `position: absolute; inset: 0` |
| **Semua tile gagal diam-diam, tanpa error di console** | Vite salah membundel worker internal MapLibre | `optimizeDeps: { exclude: ['maplibre-gl'] }` + hapus `node_modules/.vite` |
| `relation "idx_hex_features_geom" already exists` | GeoAlchemy2 sudah membuat indeks GiST lewat event DDL, autogenerate membuatnya lagi | Sudah permanen di `alembic/env.py::include_object` |
| `op.drop_table('spatial_ref_sys')` | Tabel sistem PostGIS ikut ter-autogenerate | Sama, `include_object` |
| Migrasi gagal: `geoalchemy2` tidak dikenal | Autogenerate tidak menulis impornya | Sudah permanen di `alembic/script.py.mako` |
| `KeyError: 'D05'` di `_tertimbang()` | Bobot berkunci KODE, DataFrame berkunci NAMA KOLOM | `KODE_KE_KOLOM` di `config.py` |
| `ModuleNotFoundError: No module named 'pipeline'` | Skrip pipeline dijalankan dari root | Jalankan dari dalam `pipeline/` |
| Peta kosong, kontrol muncul, tanpa galat | `maplibre-gl.css` mendeklarasikan `.maplibregl-map{position:relative}` dengan spesifisitas sama dengan `.absolute` Tailwind dan dimuat belakangan, jadi `inset-0` berhenti memberi tinggi | Beri tinggi lewat `h-full`, jangan `absolute inset-0` |
| Heksagon tersapu jalan & bangunan basemap | Disisipkan sebelum layer symbol PERTAMA — di gaya MAPID itu `water_name` pada indeks 8 dari 54 | Sisipkan setelah layer bukan-symbol TERAKHIR (`idLabelPertama()`) |
| Font kustom tidak pernah muncul, tanpa galat | `@import` Google Fonts ditaruh SESUDAH `@import "tailwindcss"` yang mengembang jadi ratusan aturan; CSS membuang `@import` yang tidak mendahului semua aturan | Taruh @import font di baris paling atas |
| Angka baru pipeline tidak muncul di API | Cache masih memegang nilai lama | `POST /meta/cache/bersihkan` setelah `s7_publish --muat` |
| Cache tidak pernah kena | Objek sesi ikut jadi kunci cache | `core/cache.py::ABAIKAN` menyaringnya menurut NAMA parameter, bukan posisi — FastAPI memanggil dengan kata-kunci |
| Heksagon hilang dari setiap filter tanpa galat | `NaN` pandas masuk ke kolom numerik dan tersimpan sebagai `'NaN'::float`, bukan `NULL` | `s7_publish._bersih()` mengubahnya jadi `None` sebelum menyentuh basis data |
| Uji yang ber-rollback meninggalkan data di cache | Cache tidak tahu soal transaksi | `cache.bersihkan()` di awal DAN akhir uji |
| `int() argument must be ... not 'Query'` saat memanggil endpoint dari kode | `= Query(default=...)` membuat nilai bawaannya objek, bukan nilai | Pakai `Annotated[T, Query(...)] = nilai` |
| Rekomendasi memuat lokasi zona terlarang | Endpoint rekomendasi lupa `saring_zoneguard()` | Setiap jalur rekomendasi wajib melewatinya — diuji di `smoke_api.py` |
| **`npx tsc --noEmit` lolos padahal ada galat tipe** | `tsconfig.json` berisi `files: []` + `references`. Tanpa `-b`, tsc tidak mengikuti referensi, jadi ia memeriksa NOL berkas dan keluar dengan kode 0 | `npx tsc -p tsconfig.app.json --noEmit`. Tiga galat nyata sempat tersembunyi di baliknya, salah satunya membuat tombol Konsultan AI dirender kosong |
| Popover dropdown mendorong isi bilah atas ke bawah | `.kaca{position:relative}` di `index.css` berspesifisitas sama dengan `.absolute` Tailwind dan dimuat belakangan, jadi ia menang | `:where(.kaca, .kaca-tebal){position:relative}` — spesifisitas nol, utilitas posisi kembali berkuasa |
| **Titik kuadran jatuh di petak yang bertentangan dengan labelnya** (Jebakan Gengsi berskor 36 tergambar di petak Hindari) | Dua batas yang berbeda. `s6_score.py::tentukan_kuadran` membelah di MEDIAN (x 0,413 · y 40,7); Kompas menggambar grid 2x2 kaku di TENGAH kotak, dan `/skor/kuadran` menghitung mediannya ulang per kawasan padahal pipeline memakai median global. 40% titik salah petak | Batasnya diturunkan dari label, bukan dihitung ulang: `skor.py::batas_kuadran()` membaca nilai TERKECIL di sisi tinggi. Sel digambar sebagai kotak mutlak lewat `keX()`/`keY()` - rumus yang sama dengan titiknya |
| **Klik tombol Konsultan AI, tidak ada apa pun yang muncul** | Wadah tombolnya `lg:static`. Di >=1024px ia berhenti jadi konteks posisi, jadi kartu ber-`absolute bottom-[calc(100%+12px)]` naik menempel ke lapisan chrome setinggi layar - dirender di `top: -428px` | Wadah jangkar wajib `relative`, bukan `static`. `relative` ikut alur normal persis sama, bedanya cuma ia tetap jadi jangkar |
| **Dialog di dalam `.kaca` terjepit di dalam bilah atas** | `backdrop-filter` menjadikan elemennya containing block bagi SELURUH keturunan `position: fixed`. `fixed inset-0` di dalam header lalu berarti "sebesar header", bukan "seluruh layar" | `createPortal(dialog, document.body)`. Berlaku juga untuk `filter`, `transform`, `perspective`, dan `will-change` |
| **Gelombang heksagon berjalan tapi cuma menghasilkan 5 pose** | Satu `setPaintProperty` pada layer isian memakan ~200ms: MapLibre mengurai ulang ekspresi, menilainya ulang tiap fitur tiap ubin, lalu mengunggah ulang buffer. Digerakkan rAF, 950ms cuma cukup untuk lima lompatan - dan lima lompatan terbaca sebagai "tiba-tiba muncul" | JS menetapkan 8 POSE lewat `setTimeout`; antaranya diisi `fill-opacity-transition` milik MapLibre, yang berjalan di dalam mesin render. Arsir & garis keluar dari lingkaran per-bingkai sepenuhnya |
| **Halaman gerbang berat digulir (median bingkai 66,7 ms ≈ 15 fps)** | Lima sebab bertumpuk, semuanya di tahap PAINT bukan di JavaScript. Diukur lewat CDP `Performance.getMetrics`: Script cuma 2,7 dtk dari 24 dtk | Lima perbaikan, berurutan dari yang paling besar hasilnya: **(1)** peta aplikasi TIDAK dipasang selama gerbang terbuka — satu konteks WebGL + 708 heksagon yang dulu hidup selama orang membaca; **(2)** kartu dek jadi WebP statis, gerbang tidak memuat MapLibre sama sekali; **(3)** cabut `backdrop-filter` dari elemen yang latarnya gradien mulus (52 → 2) — mem-blur gradien mulus menghasilkan gradien yang sama; **(4)** sarang hero jadi satu `<pattern>` (701 → 82 poligon), masker bergerak diganti gradien yang digeser `translate3d`; **(5)** buang `background-attachment: fixed` pada wadah `position: fixed` — redundan, kotak batasnya sudah seukuran layar. Hasil: satu lintasan gulir **24,3 → 11,3 dtk**, kerja utas utama **11,4 → 2,1 dtk**, median bingkai **66,7 → 33,4 ms**, bingkai terburuk **533 → 83 ms** |
| **Gulir lintang bergetar, dan tidak bisa disembuhkan dengan menyetel apa pun** | `pin` milik ScrollTrigger di dalam wadah yang menggulir sendiri (bukan `window`) tidak bisa memakai `position: fixed` — GSAP terpaksa MENGGESER BALIK elemennya tiap bingkai sejauh halaman bergulir supaya ia terlihat diam. Selisih sekecil apa pun antara saat peramban menggambar gulirnya dan saat GSAP menulis transform-nya terlihat sebagai goyangan, dan selisih itu struktural: keduanya berjalan di jalur yang berbeda | Ganti `pin` dengan `position: sticky`. Yang menahan elemennya peramban sendiri, di compositor, tanpa satu baris JavaScript — jadi tidak ada dua sumber kebenaran yang bisa berselisih. Yang tersisa untuk GSAP cuma menggeser lintasannya. Bonus: tanpa pin tidak ada spacer, jadi seluruh bagian di bawahnya berhenti bergeser saat penyegaran. Tinggi wadahnya disetel dari JS (`jarak geser + satu layar`) di `refreshInit`, karena angka `vh` apa pun cuma benar untuk satu lebar layar |
| **Jangan pernah menggerakkan tampilan berfrekuensi-gulir lewat state React** | `setLangkah()` dipanggil dari dalam lintasan gulir. React memang berhenti kalau nilainya sama, tetapi begitu panel berganti — empat kali sepanjang bagian itu — ia me-render ulang SELURUH komponen gerbang (767 elemen), tepat pada bingkai yang juga sedang menggeser empat kartu | Tulis langsung ke DOM dari callback GSAP (`element.style.…`), dan jangan pasang penjaga "kalau sama, lewati": React masih boleh me-render karena sebab lain dan MENGEMBALIKAN gaya sebarisnya, lalu sorotannya hilang selamanya karena indeksnya memang tidak berubah. Terukur: bingkai terburuk bagian itu **47 → 35 ms**, dan selisih median-ke-terburuk tinggal 4 ms |
| `overflow-x: hidden` TIDAK mengecilkan `scrollWidth` | Bersama `overflow-y: auto` ia tetap wadah gulir; yang dimatikan cuma kemampuan menggulirnya secara mendatar. `scrollWidth` tetap selebar isinya, dan lebar berlebih itu ikut dipakai menghitung `100vw` | Gunting di elemen yang memang harus menggunting. Melepasnya "karena toh sudah digunting induknya" membuat scrollWidth halaman melompat 1440 → 3296 |
| **Gulir lintang bergetar** | `getBoundingClientRect()` dipanggil pada keempat panel di dalam `onUpdate` milik scrub — empat kali per bingkai, dan tiap satu memaksa peramban menghitung ulang tata letak sebelum menjawab, di tengah animasi yang juga sedang menulis transform | Baca `offsetLeft`/`clientWidth` SEKALI saat `onRefresh` (keduanya tidak ikut bergeser bersama transform), lalu hitung posisi tiap bingkai dari cache: `gsap.getProperty(el, 'x')`. Tambah `anticipatePin: 1`. Terukur: median bingkai bagian itu **59,5 → 30,4 ms**, terburuk **112 → 47 ms** |
| Elemen yang diputar terpotong sudutnya di dalam `overflow-hidden` | `rotate` tidak mengubah tinggi tata letak — pembungkusnya tetap setinggi elemen yang belum diputar, jadi sudut yang menonjol digunting | Beri pembungkusnya bantalan tegak sebesar `setengah lebar × sin(sudut)`. Pita 1.526px pada 1,6° butuh 21px |
| `will-change` yang ditulis permanen di CSS | Ia memindahkan elemen ke lapisan komposit sendiri — bagus saat dianimasikan, tetapi enam bagian setinggi layar memegang lapisannya masing-masing selamanya, termasuk lima yang jauh di luar layar | Pasang dan cabut lewat `onToggle` ScrollTrigger. Yang hidup tinggal dua-tiga sekaligus |
| Cara membuat "sorotan yang mengikuti kursor" tanpa melukis ulang apa pun | Menganimasikan `mask-position` atau posisi gradien adalah tahap paint — tiap gerakan kursor melukis ulang selapis penuh | **Dua transform yang saling meniadakan**: satu jendela bundar digeser ke posisi kursor, isinya digeser BERLAWANAN sejauh yang sama. Isinya jadi diam terhadap halaman dan menimpa lapisan redup di bawahnya persis; yang bergerak cuma jendelanya. Keduanya `transform` — nol piksel dilukis ulang. Maskernya statis, ikut bersama jendelanya. Lihat `LatarHero` di `Gerbang.tsx` |
| Jangan menganimasikan `filter: blur()` maupun `mask-position` | Keduanya berjalan di tahap paint, bukan di compositor — tiap bingkai memaksa lapisannya dilukis ulang | Yang boleh dianimasikan murah cuma `transform` dan `opacity`. Untuk cahaya bergerak, geser satu gradien dengan `translate3d`, jangan geser masker |
| **Bagian di bawah elemen ber-`pin` terkunci di keadaan akhir animasinya** | Pin menyisipkan spacer setinggi jarak gesernya (1.876px), jadi semua bagian di bawahnya bergeser sejauh itu. ScrollTrigger menyegarkan pemicu menurut posisi yang TERAKHIR DIKETAHUI, jadi pemicu yang dibuat sebelum pin diukur seolah spacer-nya belum ada — terukur, pemicu bagian "fitur" mendarat di start 5210 padahal bagiannya duduk di 7982 | `refreshPriority: 1` pada ScrollTrigger yang memakai `pin`. Ia jadi disegarkan lebih dulu, dan yang lain mengukur dengan spacer yang sudah terpasang |
| Transform pada `<section>` merusak pemicu di dalamnya | Bagian yang di-scrub membawa `y` sampai 84px, dan pemicu di dalamnya diukur dengan `getBoundingClientRect` — kalau pengukuran terjadi saat bagiannya tergeser, semuanya ikut meleset | Netralkan lewat `ScrollTrigger.addEventListener('refreshInit', ...)`; ia menyala tepat sebelum pengukuran |
| Garis tipis hilang sama sekali di dalam filter "cairan" | Ambang alfa (`feColorMatrix`) memakan apa pun yang alfanya jatuh setelah blur. Bilah 6px dengan `stdDeviation: 7` puncaknya tinggal ~0,18 → di bawah ambang → lenyap, sementara bulatan 24px selamat | Apa pun di dalam lapisan ber-filter harus lebih tebal dari sekitar dua kali simpangan blur. Yang tipis digambar DI LUAR lapisan itu |
| Anak flex melebar 0px padahal induknya 500px | `align-items: flex-start` berlaku pada induknya, jadi anaknya tidak melebar sendiri; isinya cuma elemen berposisi mutlak, jadi lebar isinya nol | `w-full` di anaknya. Gejalanya menyesatkan: `flex-1` terlihat benar, dan yang salah perataan silang induknya |
| `preserveDrawingBuffer` diabaikan diam-diam, hasil `toBlob` kanvas kosong | Di MapLibre v6 ia pindah ke `canvasContextAttributes`, tidak lagi di akar `MapOptions` | `canvasContextAttributes: { preserveDrawingBuffer: true }` |
| **ScrollTrigger sudah berjalan 29% pada gulir 0** — elemennya miring padahal belum digulir | Pemicunya elemen yang leluhurnya memakai `perspective`. `perspective` menjadikan elemennya containing block, jadi rantai `offsetParent` berhenti di situ dan `offsetTop` anaknya jadi 0. ScrollTrigger ikut membaca 0: `start` mendarat di **-225** padahal elemennya duduk 591px di bawah tepi layar | Pasang pemicu pada elemen yang TIDAK punya `transform`, `perspective`, atau `filter` di atasnya — bagian pembungkusnya, bukan kartunya. Berlaku sama untuk `transform` dan `filter`, sebab ketiganya membuat containing block |
| Angka di dalam heksagon hilang di kartu yang ukurannya responsif | Zoom disetel dengan tangan untuk satu ukuran kartu. Kartunya `max-w` + `clamp(_,vh,_)`, jadi lebar dan tingginya berubah sendiri-sendiri — tiga kali menyetel zoom menghasilkan tiga bingkai yang sama-sama meleset, dan yang terakhir mendarat di bawah `minzoom` layer angkanya | `fitBounds(bingkai, { padding })`. Bantalan dinyatakan dalam piksel, satuan yang dipakai mata. Dan ingat MapLibre memakai ubin 512px: `m/px = 40075017·cos(lat) / (512·2^z)` — memakai rumus 256px meleset satu tingkat zoom penuh |
| **Heksagon tidak tergambar padahal layer, sumber, dan `queryRenderedFeatures` semuanya benar** | `fill-opacity` dipasang `0` lalu dinaikkan ke EKSPRESI berbasis data lewat `setPaintProperty`. Transisi dari nilai tetap ke ekspresi bukan jalur yang bisa diandalkan di MapLibre, dan gagalnya diam: propertinya terbaca benar kalau ditanya, cuma tidak pernah tergambar | Tulis nilai finalnya langsung di `paint` saat layer dibuat. Kalau butuh memudar, pudarkan wadah DOM-nya, bukan properti paint-nya |
| **`gsap.from` berhenti di keadaan awalnya, dan satu-satunya gejalanya tata letak yang meleset** | Satu tween berundak yang dipicu WADAH-nya (`trigger: '.g-tim-grid'`) tidak pernah menyala di dalam scroller kustom. Kartunya tetap terlihat karena opacity sudah 1, tapi `transform` mandek di `translateY(80px)` — dan yang terlihat cuma tombol di bawahnya tertimpa 16px | Pemicu per-elemen (`trigger: el`), pola yang sudah terbukti di `.g-bagian` dan `.g-kartu`. Kalau sebuah animasi "tidak jalan", periksa `getComputedStyle(el).transform` — bukan matanya |
| Sorotan tertinggal satu langkah di bagian gulir lintang | Pembacaan posisi ditaruh di `onUpdate` milik **ScrollTrigger**. Dengan `scrub`, tween-nya tertinggal di belakang gulir, jadi detak terakhir pemicu membaca posisi yang masih menyusul | Taruh di `onUpdate` milik **tween**. Ia berdetak sampai animasinya benar-benar sampai |
| Panel pertama gulir lintang nyaris tidak pernah jadi panel aktif | Bantalan kiri (30rem, selebar kompas) dan kanan (8vw) tidak sama, jadi panel pertama lahir 230px di sebelah kiri titik baca | Bantalan kiri = bantalan kanan. Titik bacanya pun diambil dari `offsetLeft` panel pertama, bukan dari pecahan lebar layar |
| **Kelas Tailwind baru tidak pernah ter-generate, tanpa galat** | Berkas komponennya DIHAPUS lalu ditulis ulang. Pemindai Tailwind v4 kehilangan jejaknya, jadi `h-screen`, `h-[115vh]`, dan `-mb-[100vh]` diam-diam tidak ada — elemennya jatuh ke tinggi otomatis | Restart dev server sesudah menghapus-dan-menulis-ulang sebuah berkas. Menyunting di tempat tidak kena masalah ini |
| **Layar pembuka tampak kosong padahal kota heksagon 3D-nya digambar** | `campur()` dipanggil BERSARANG dan mengembalikan `rgb(...)`, tapi parsernya cuma mengerti `#rrggbb`. Panggilan luar menghasilkan `rgb(NaN,NaN,7)`; kanvas menolak `fillStyle` tak sah **tanpa galat** dan diam-diam memakai fillStyle sebelumnya — yang kebetulan gradien langit. 16.229 heksagon per bingkai digambar dengan warna langit di atas langit | `Pembuka.tsx::urai()` menerima kedua bentuk. Kalau sebuah nilai warna dipakai di kanvas, ia WAJIB heksadesimal atau `rgb()` harfiah — `KUADRAN.*.warna` berisi `var(--q-gem)` dan tidak pernah bisa dipakai di sana |
| Kolom kanan Kompas Kuadran terpotong, "mahal" jadi "maha" | Sisi kotak ditulis tangan 232px sebagai "17rem dikurangi bantalan dan label sumbu". Hitungannya meleset 10px, dan `shrink-0` menahannya sehingga kelebihan itu menembus bantalan kartu lalu digunting `overflow-hidden` milik kolomnya | `flex-1 min-w-0` + `aspect-square`. Jangan pernah menulis tangan lebar yang harus cocok dengan lebar induknya |
| Halaman gerbang punya `scrollWidth` lebih besar dari `clientWidth` | Elips hero `w-[150%]` dan pita `scale-[1.06]` melebihi layar. `overflow-x-hidden` menyembunyikan bilah gulirnya, TIDAK mengecilkan scrollWidth | Bungkus tiap elemen yang sengaja melebihi layar dengan induk ber-`overflow-hidden` |
| **Grafik jam memampatkan jam yang tak berdata** | Cuma 58 dari 474 heksagon punya 18 jam penuh; sisanya 4-17. Dengan satu batang `flex-1` per BARIS, heksagon berdata pukul 06,07,08,15,16,17 tampil sebagai enam batang berdempet berlabel "06.00 … 17.00" - terbaca sebagai enam jam berurutan yang ramai merata, padahal tujuh jam di tengahnya tidak pernah disurvei | Sumbu SELALU 05-22 penuh; jam tanpa data digambar sebagai garis rambut, dan jumlahnya disebut di bawah grafik. Aturan 4: kosong yang dimampatkan berubah jadi pernyataan yang tidak benar |
| **Zona yang DIIZINKAN tidak menampilkan apa pun** | Panel ZoneGuard hanya dirender untuk `terlarang \|\| tanpaRdtr`, jadi lokasi yang izinnya justru bersih diam total - dan pembacanya tidak bisa membedakan "sudah diperiksa, aman" dari "belum diperiksa". Tabel fitur menjanjikan status zonasi ke tingkat GRATIS | Zona yang diizinkan ikut dinyatakan, satu baris ringkas. Untuk fitur yang menjanjikan sebuah status, diam bukan salah satu nilai statusnya |
| **Empat asersi smoke selalu merah sejak `demo_seed` ada** | Uji menaburkan 12 heksagon ke Manggarai lalu memeriksa hasil endpoint seolah 12 itu satu-satunya isi kawasan - padahal Manggarai berisi 122 baris demo sungguhan. Kawasannya tidak bisa dipindah: `periksa_kawasan()` cuma menerima enam pilot, dan keenamnya berisi demo | Asersi dibuat RELATIF, bukan mutlak: "n_sampel == jumlah yang berharga, dan itu < total kawasan", bukan "n_sampel == 11". Yang diuji tetap sama pentingnya |
| **"Refresh jangan ke landing" dan "buka web harus lewat landing" terdengar berlawanan** | Keduanya diminta pemilik repo, berjarak beberapa hari. Menyimpan `masuk` di localStorage memenuhi yang pertama tetapi melanggar yang kedua; membuang penyimpanannya sama sekali melakukan kebalikannya | Keduanya bisa dipenuhi sekaligus, karena **menekan F5 dan membuka web adalah dua hal berbeda** - dan `sessionStorage` persis membedakannya: bertahan menembus refresh di tab yang sama, kosong di tab baru dan esok hari. Jadi `masuk` pindah ke sessionStorage, sementara latar kerjanya (kawasan, layer, gaya) TETAP di localStorage - yang diminta bukan melupakan kawasan yang sedang dilihat, melainkan tidak melewati perkenalannya. `bacaTampilan` sengaja mengabaikan `t.masuk` yang mungkin tertinggal dari versi lama: membacanya akan diam-diam melewatkan gerbang untuk orang yang justru baru membuka webnya |
| **Memulihkan pilihan heksagon dari localStorage terbaca sebagai kerusakan** | Refresh memulihkan `hex` yang dipilih sesi SEBELUMNYA, jadi panel detail terbuka sendiri dan bar bawah berganti jadi ajakan simulasi - untuk heksagon yang tidak pernah diklik orangnya di sesi ini. Dilaporkan sebagai "saya belum menekan heksagonnya tapi udah muncul button simulasi" | Pulihkan LATAR KERJA (kawasan, layer, basemap), jangan pulihkan PILIHAN. Yang diminta cuma "refresh jangan kembali ke landing"; memulihkan pilihan adalah tambahan yang membuat antarmuka mengaku menampilkan sesuatu yang tidak pernah dipilih |
| **Tombol yang baru muncul saat disorot sama dengan tombol yang tidak ada** | Tombol pulang disembunyikan di dalam logo dengan panah `opacity-0` yang baru terlihat saat hover. Dilaporkan "belum ada" - dan memang praktis belum ada: tidak ada yang menyorot logo untuk mencari jalan pulang | Aksi navigasi berdiri sendiri dan selalu terlihat. Pintu yang harus ditemukan dulu bukan pintu |
| **`detail_heksagon(hex, db, versi)` posisional meledak sesudah parameter disisipkan** | `pengguna` disisipkan sebagai parameter KETIGA, jadi `versi` yang dikirim posisional mendarat di slot `pengguna`. String `"baseline"` lalu diperlakukan sebagai objek User: `langganan_aktif()` menyentuh `.id`-nya dan seluruh alat AI `bandingkan`/`jelaskan_skor` menjawab 500 | Panggil dengan KATA-KUNCI: `detail_heksagon(h3, db, pengguna=..., versi=...)`. Berlaku untuk setiap fungsi yang tanda tangannya bisa tumbuh di tengah |
| **Efek yang menunggu akun menghabiskan penanda "muatan pertama" sebelum akunnya datang** | Penandanya `useRef(undefined)` dan efeknya berjalan di render PERTAMA, saat `akun` masih `null` (tiketnya belum selesai divalidasi). Penandanya habis di situ; begitu akun mendarat, kawasan preferensinya terbaca sebagai PERUBAHAN dan heksagon yang baru dipulihkan dari refresh ikut dibersihkan. Gejalanya: panel detail selalu kembali ke daftar sesudah refresh | `if (!akun) return` DI ATAS pembacaan penanda. Efek yang bergantung pada data asinkron tidak boleh mulai mencatat sebelum datanya ada |
| **`uvicorn --reload` mengumumkan "Reloading..." lalu tidak pernah sampai** | watchfiles di Windows melewatkan sebagian tulisan yang datang dari skrip, dan tanpa `--reload-dir` ia juga mengawasi seluruh `venv/` - satu `pip install` membuatnya sibuk berjam-jam. Rute baru menjawab 404 padahal kodenya sudah benar, dan uji yang mengikutinya gagal karena sebab yang salah | `--reload-dir app`, dan kalau ragu MATIKAN reloader-nya lalu jalankan ulang. Uji dulu logikanya lewat `python -c "from app.core... import ..."` sebelum menyalahkan kodenya |
| **Cache menyajikan data berbayar kepada tamu** | `@ber_cache` menyusun kuncinya dari argumen, dan objek pengguna tidak pernah pantas jadi kunci: `repr()`-nya memuat alamat memori, jadi kuncinya unik tiap permintaan sekaligus menumbuhkan tabelnya tanpa batas. Kalau pengguna TIDAK ikut jadi kunci, jawaban pelanggan tersaji ke tamu berikutnya | Endpoint yang isinya bergantung tingkat akun TIDAK di-cache. `/hex/{h3}` sengaja dibiarkan tanpa cache; peringatannya permanen di `core/cache.py` |
| Filter multi-kawasan jalan di peta tapi daftar dan Kompas menjawab 422 | `/hex/layer` sudah menerima `Bekasi,Depok Baru`, tetapi `/skor/*`, `/pricelens/layer`, dan `/transit/nodes` masih memakai `periksa_kawasan()` yang menolak koma. Separuh layar gagal sekali klik | `periksa_kawasan_banyak()` di SEMUA endpoint yang menyaring kawasan. Dua yang sengaja tetap tunggal: `/skor/dinamika` (persentil churn dua kawasan yang dicampur berhenti berarti) dan alat AI |
| Tirai `Terkunci` menggunting tombolnya sendiri | Ajakannya ditumpuk `absolute inset-0` di atas bentuk berbaris-baris, jadi tinggi kotak ditentukan bentuknya - dan isi ajakan yang lebih tinggi digunting `overflow-hidden`. Yang hilang pertama justru tombolnya, karena ia paling bawah | Dibalik: bentuknya yang `absolute inset-0`, ajakannya mengalir biasa. Bentuk itu hiasan dan boleh digunting; ajakan itu satu-satunya jalan keluar dari tirai dan tidak boleh pernah digunting |
| `uvicorn --reload` tidak pernah selesai memuat ulang | Tanpa `--reload-dir`, watchfiles mengawasi `venv/` juga. Sekali `pip install`, ia mendeteksi ratusan berkas berubah, mengumumkan "Reloading...", lalu tidak pernah sampai - rute baru menjawab 404 padahal kodenya sudah benar | `uvicorn app.main:app --reload --reload-dir app` |
| Smoke test melaporkan "122 baris tersisa" padahal rollback-nya sempurna | Penghitung sisanya menghitung SELURUH baris berkawasan Manggarai, dan `demo_seed` mengisi Manggarai dengan 122 heksagon sungguhan | Hitung menurut prefiks h3 uji. Alarm yang selalu menyala adalah alarm yang berhenti dibaca |
| Animasi kemunculan heksagon tidak pernah terlihat saat pertama masuk | Peta sengaja hidup di belakang layar pembuka, jadi gelombangnya habis diputar sebelum pembuka memudar | Prop `tampil` di `PetaInteraktif`; gelombang menunggu di t = 0 sampai pembuka menyingkir |
| **Basemap gelap tersimpan tidak pernah dipakai — ubin terang dengan chrome gelap** | Peta dibuat dengan `style: urlGaya('terang')` yang ditulis mati. Efek pergantian gaya dijaga `if (!siap) return`, dan pada render pertama `siap` memang belum true — jadi satu-satunya kesempatan menerapkan gaya tersimpan lewat begitu saja, dan `gaya` tidak pernah berubah lagi sesudahnya | `useRef(gaya)` dibaca saat konstruksi. Berlaku untuk setiap nilai yang dipulihkan dari localStorage lalu dipakai di efek yang cuma jalan sekali |
| **Cache menyajikan jawaban heksagon LAIN** | `_kunci_dari` membuang `args[0]` apa adanya, dengan alasan "argumen posisional pertama selalu sesi basis data". `simpul_terdekat(h3_index, db)` membantahnya — h3 duduk di posisi itu, jadi dua heksagon berbagi satu kunci. Lewat HTTP semuanya benar karena FastAPI memanggil dengan KATA-KUNCI sehingga `args` kosong; yang salah cuma pemanggilan langsung dari kode — alat AI, skrip, uji. Bug yang bisa hidup lama di balik rangkaian uji hijau | Sesi disaring menurut **tipe** (`isinstance(a, Session)`), bukan menurut posisi. Tidak ada lagi posisi yang harus benar. Dijaga `test_cache_argumen_pertama_bukan_sesi` |
| **Uji lolos karena alamat memori didaur ulang** | `test_cache_abaikan_sesi` memakai `object()` sebagai sesi tiruan. Objek sementara itu dibebaskan tepat sesudah panggilan, jadi yang kedua sering mendarat di alamat yang sama dan `repr()`-nya kebetulan cocok — ujinya lolos tanpa menguji apa pun | Pakai tipe yang SUNGGUHAN dipakai produksi (`Session()`). Kalau sebuah uji bergantung pada `repr()` sebuah objek, ia bergantung pada alamat memori |
| **Baki komparasi buntu total, dan buntunya diam** | Menambahkan heksagon pertama menutup panel kanan supaya petanya terlihat — tetapi tombol "Bandingkan lokasi ini" HANYA hidup di dalam panel itu, dan klik di peta tidak membukanya kembali. Jadi tidak ada satu pun jalan menambahkan yang kedua: baki mentok di satu, tombol "Bandingkan 1" mati selamanya, sementara bakinya sendiri tertulis "Klik heksagon lain di peta untuk membandingkan" | Janjinya ditepati: selama baki terisi, klik heksagon di peta MEMASUKKANNYA ke baki. Yang sudah di baki cuma disorot, tidak dikeluarkan — mengeluarkan tetap lewat tanda x di kolomnya. Pelajaran umumnya: kalau antarmuka menuliskan sebuah instruksi, harus ada kode yang menjalankannya |
| **Kawasan tersimpan dipulihkan, tetapi kameranya tidak pernah pindah** | Perpindahan kamera hidup di dalam `gantiKawasan`, jadi satu-satunya pemicunya seseorang MENGKLIK pemilih kawasan. Kawasan dari localStorage tidak pernah lewat situ — chip menulis "Bekasi", peta diam di Jakarta, layar kosong melompong tanpa satu pun galat, karena heksagon Bekasi memang dua puluh kilometer di luar layar | `arahkanKamera()` dipisah dari `gantiKawasan()`, dipanggil sekali pada muatan heksagon PERTAMA. Keluarga yang sama dengan basemap gelap: nilai yang dipulihkan lalu dipakai di jalur yang cuma jalan saat ada perubahan |
| **Rute ORS lebih pendek daripada garis lurusnya** | ORS menempelkan (`snap`) titik yang tidak berdiri di atas jaringan jalan ke ruas terdekat, lalu melaporkan jarak antara titik HASIL TEMPEL. Terukur: rata-rata 22 m di pangkal, 28 m di ujung, sampai 220 m. Satu heksagon Manggarai berjarak 119 m garis lurus dari stasiun menghasilkan "rute" 11 m — kedua ujungnya menempel ke ruas yang sama | `rute_ors.jahit()` menyambungkan ujung rute ke titik yang SEBENARNYA diminta dan **menambahkan panjang penggalnya** ke jarak dan waktu. Dijaga asersi "tidak ada rute lebih pendek dari garis lurusnya" — invarian yang juga menangkap lon/lat tertukar |
| **`urutan = 0` bukan rute tercepat** | ORS mengurutkan alternatif menurut "weight" internalnya, bukan menurut durasi. Terukur: 147 dari 705 heksagon punya alternatif yang lebih cepat daripada jalur utama versi ORS, sampai selisih **11 menit**. Antarmuka menuliskan satu angka besar — "N menit jalan kaki" — dan mengambilnya dari `urutan = 0` | Diurutkan ulang menurut durasi SESUDAH dijahit (penggal penyambung tiap jalur panjangnya berbeda, jadi mengurutkan sebelum menjahit bisa memilih pemenang yang salah). `--rapikan` menomori ulang baris yang sudah tersimpan |
| **Efek lensa hero mati total tanpa satu pun galat** | Penjaganya membandingkan panjang larik ref dengan jumlah cincin. Elemen cahaya ikut menumpang larik yang sama, jadi panjangnya lebih satu, efeknya `return` lebih awal — dan yang terlihat cuma sarang terang mandek di pojok kiri atas | Benda yang bukan bagian dari koleksi jangan menumpang larik koleksi itu. Cahaya diberi `useRef` sendiri. Kalau sebuah efek "tidak jalan", curigai penjaga di baris pertamanya sebelum mencurigai isinya |
| **Warna yang ditulis mati adalah tempat yang harus diingat** | Halaman gerbang memuat 60-an warna heksadesimal apa adanya — `#2b6a61` dua puluh satu kali. Menambah mode gelap berarti tiap satu jadi tempat yang bisa terlupa, dan yang terlupa TIDAK menghasilkan galat: ia menghasilkan satu kata hijau tua di atas latar hitam | Palet diangkat jadi variabel `--g-*` di `.gerbang`, mode gelap cuma menimpa variabelnya. Satu-satunya cara sebuah warna bisa ketinggalan adalah kalau ia memang tidak pernah dijadikan variabel — dan itu terlihat langsung dari `grep '#[0-9a-f]\{6\}'` |
| **Mode gelap yang berhenti di batas komponen sendiri** | Gerbang memakai ULANG komponen aplikasi apa adanya — Kompas Kuadran, tombol akun, kartu `.kaca` — dan semuanya membaca token `--color-*`, bukan palet `--g-*`. Jadi mode gelap gerbang menghasilkan kartu Kompas PUTIH TERANG di atas halaman hitam dan nama pengguna hitam di atas bilah hitam, sementara semua yang memakai `--g-*` sudah benar | `.gerbang[data-tema='gelap']` IKUT selektor token gelap `.peta-gelap`. Menambal tiap komponen berhasil sekali lalu gagal diam-diam pada komponen berikutnya yang dipakai ulang; menukar tokennya berlaku untuk semua sekaligus, termasuk yang belum ditulis |
| **Bilah atas yang gelap di halaman terang** | `.g-nav-gelap` menyala saat halaman masuk jurang — dan itu terjadi WALAUPUN temanya terang. Token di dalamnya tetap token terang, jadi nama pengguna hitam di atas bilah hitam, tepat di bagian yang paling banyak dibaca | `.g-nav-gelap` ikut selektor token gelap. Aturan umumnya: setiap elemen yang membalik terang-gelapnya SENDIRI harus ikut membalik tokennya, bukan cuma latarnya |
| **Tombol yang dibalik dua kali jadi tidak terlihat** | `navGelap ? 'bg-white text-[var(--g-ink)]'` benar di tema terang: tombol hijau tua di atas jurang hitam berhenti terbaca. Di tema GELAP `--g-ink` sudah warna terang, jadi hasilnya putih di atas putih — tombol "Masuk ke peta" hilang sama sekali | Pembalikannya dibatasi ke tema terang lewat CSS (`.g-nav-terbalik`), bukan dikarang ulang di JSX. Nilai yang benar untuk satu tema tidak otomatis benar untuk kebalikannya |
| **Lawan-skala tidak bisa ditiru dengan dua titik keyframe** | Lawan-GESER boleh: geseran fungsi linear, jadi `jendela(t) + isi(t) = 0` berlaku untuk kurva waktu apa pun. Skala tidak punya sifat itu — CSS menginterpolasi skala secara linear, dan kebalikan dari interpolasi linear BUKAN interpolasi linear dari kebalikannya. Dua titik saja membuat sarang terangnya mengembang-mengempis di antara keduanya: yang terlihat kisi yang bernapas, bukan riak | 16 titik keyframe dengan kebalikan yang dihitung persis; selisih maksimum di antara titik tinggal di bawah 0,5%. Pelambatannya DIPANGGANG ke nilai titiknya, dan `animation-timing-function` dibiarkan `linear` — kalau ia diberi easing lagi, easing itu berlaku pada kedua sisi dan perkaliannya berhenti jadi satu |
| **Satu benda yang berulang selalu terbaca sebagai kejadian** | Riak versi pertama satu cincin yang lahir, melebar, lalu pudar - dan lahir lagi. Sekeras apa pun pudarnya dihaluskan, mata tetap menangkapnya sebagai dentuman yang berulang, bukan sebagai arus | Deretan cincin yang menyambung tidak punya kejadian sama sekali. Kuncinya jarak GEOMETRIS: kalau tiap cincin dua kali jari-jari sekaligus dua kali tebal cincin sebelumnya, penskalaan 2x memetakan himpunan cincin ke dirinya sendiri - jadi akhir putaran identik dengan awalnya dan pengulangannya tidak bisa dilihat. Bonusnya rentang skala tinggal 1..2, dan lawan-skala isinya tidak pernah melebihi 1 - sarangnya tidak pernah dirasterisasi lebih besar dari aslinya |
| **`styleimagemissing` TIDAK bisa menyelesaikan gambar yang hilang** | Gaya MAPID merujuk enam ikon POI yang tidak ikut di lembar sprite-nya (`office`, `swimming_pool`, `gate`, `brownfield`, `lift_gate`, `sports_centre`). Selama layer POI disembunyikan tidak ada yang memintanya; begitu dinyalakan, konsol penuh peringatan yang terbaca seperti kerusakan. Mendaftarkan gambarnya dari dalam penangan kejadian `styleimagemissing` TIDAK menghentikannya - tipe MapLibre v6 menyatakannya apa adanya: *"Event listeners cannot resolve the missing image for the current request"* | `map.setMissingStyleImageResolver()`. Ia dipanggil LEBIH DULU dan MapLibre menunggunya; kejadiannya baru menyala kalau resolver pun gagal. Satu piksel tembus pandang cukup - ikonnya memang tidak ada, dan labelnya tetap tergambar |
| **`gsap.context(fn, ref)` memperingatkan saat komponennya dilepas** | GSAP membaca `ref.current` setiap kali sebuah selektor dipakai, termasuk saat `ctx.revert()` di pembersihan - dan pada saat itu React sudah melepas ref-nya. Hasilnya "Invalid scope" untuk tiap selektor yang dibereskan; terukur enam belas kali, semuanya tepat saat gerbang ditutup | Beri lingkupnya ELEMEN, bukan objek ref: `const el = akar.current; if (!el) return; gsap.context(fn, el)`. Elemennya tidak pernah jadi null, jadi ia tetap sah sampai pembersihan selesai |
| **Lapisan `fixed` tidak bisa dibatasi ke satu bagian dengan ambang pengamat** | Tekstur hero dipasang `position: fixed` lalu disembunyikan lewat IntersectionObserver saat hero lewat. Selama hero masih TERHITUNG terlihat - dan `rootMargin` justru memperlebarnya - lapisan itu tetap menutupi SELURUH viewport, termasuk bagian berikutnya yang sudah masuk layar. Akibatnya bagian "Yang kami percaya" ikut berlatar kisi hero | Yang salah tempatnya, bukan angkanya. Jadikan ia anak `absolute` DI DALAM bagian itu; kalau bagiannya `overflow-hidden`, latarnya tidak akan pernah bisa keluar dari sana. Menyetel ambang cuma memindahkan batas kebocorannya |
| **Dua kartu gelap di antara enam terbaca sebagai gagal dimuat** | Dek kartu peta sengaja memamerkan empat gaya basemap MAPID, dua di antaranya `gelap`. Di halaman yang seluruhnya terang, dua persegi hitam tidak terbaca sebagai ragam gaya melainkan sebagai gambar yang gagal dimuat - dilaporkan sebagai "bagian ini menggelap" | Satu kartu gelap sudah membuktikan basemap gelap ada; dua mulai mendominasi. Bekasi dipindah ke `dasar`, dan keempat gaya tetap terwakili |
| **`overflow-hidden` memotong latar jadi garis lurus melintang** | Kisi hero yang tinggal di dalam bagiannya berhenti MENDADAK di batas bawah - dan potongan lurus selebar layar itu terbaca sebagai jahitan yang lupa dirapikan, bukan sebagai batas | `mask-image: linear-gradient(to bottom, #000 52%, transparent 96%)` pada lapisan latarnya. Masker statis: dihitung sekali, tidak pernah lagi |
| **Uji Playwright "membuktikan" klik peta rusak, padahal cuma kepagian** | Klik pertama pada heksagon tidak pernah membuka panel detail; klik kedua selalu berhasil, dan polanya berulang persis di setiap jalan. Terlihat meyakinkan sebagai bug ordinal. Yang sebenarnya terjadi: panel detail menembak empat permintaan (detail, pricelens, commuter-clock, simpul-terdekat) dan pada cache dingin butuh lebih dari 2,6 dtk - yaitu jeda yang dipakai ujinya. Klik kedua terasa instan karena datanya sudah ter-cache | Sebelum menyimpulkan sesuatu rusak, periksa apakah ujinya sudah menunggu cukup lama. Bukti bahwa selectionnya BERHASIL sudah ada di depan mata sejak awal: bar bawah berganti jadi ajakan simulasi, dan tab panel berpindah ke "Daftar lokasi" - keduanya cuma terjadi kalau heksagonnya benar-benar terpilih |
| **ScrollTrigger yang `trigger`-nya sama dengan `scroller`-nya tidak pernah menyala** | Paralaks motif dipasang dengan `scrollTrigger: { scroller, trigger: akar.current }` - dan `akar.current` ADALAH scroller-nya. Start dan end jatuh di titik yang sama, `onUpdate` tidak pernah dipanggil, dan seluruh motif diam dengan `transform: none` di setiap posisi gulir. Tanpa satu pun galat: yang terlihat cuma latar yang "masih polos" | Pemicu harus elemen DI DALAM scroller-nya. Atau, seperti di sini, lewati ScrollTrigger sama sekali - pendengar `scroll` pasif yang menjadwalkan satu rAF tidak punya semantik pemicu yang bisa salah dipahami, dan tidak mengerjakan apa pun saat halaman diam |
| **Paralaks berbasis jarak gulir mentah meledak di bagian yang tinggi** | `(scrollTop - offsetTop) * laju` terlihat benar sampai dicoba pada bagian setinggi 3.250 px: motifnya berjalan 550 px, jauh keluar dari bagiannya sendiri, lalu tergunting | Nyatakan sebagai pecahan PERJALANAN bagiannya melewati layar: `(scrollTop + H/2 - (atas + tinggi/2)) / ((H + tinggi)/2)`, dijepit ke ±1, dikali amplitudo tetap. Jaraknya jadi sama untuk bagian setinggi apa pun |
| **Tujuh motif yang tidak saling kenal kalah oleh satu bentuk yang diulang** | Percobaan pertama memberi tiap bagian diagram sendiri - grid, sumbu, rel, titik, batang. Tiap satu masuk akal untuk bagiannya, tetapi bersama-sama halaman jadi terasa seperti tujuh halaman berbeda | Pakai bentuk yang SUDAH ada di halaman ini dan sudah disukai - terowongan heksagon konsentris di bagian tim - lalu variasikan parameternya per bagian. Bahasa bentuk yang konsisten mengalahkan keragaman yang benar sendiri-sendiri |
| **Alfa 0,14 sama dengan tidak ada** | Motif latar dipasang beralfa 0,14 dan diverifikasi ada di DOM, `display: block`, ukuran benar, di dalam layar - semuanya lolos. Dilaporkan "kok ga ada?". Memang tidak terlihat: garis 0,14 di atas latar mint praktis lenyap, dan pemeriksaan DOM tidak bisa membuktikan sesuatu TERLIHAT | Untuk hiasan latar, verifikasinya mata, bukan `getBoundingClientRect`. Kalau harus dicari untuk ditemukan, ia belum ada |
| **Memusatkan hiasan ke BAGIAN salah untuk bagian yang tingginya spacer** | Motif latar dipusatkan lewat `top-1/2` pada bagiannya. Benar untuk bagian biasa; salah total untuk bagian kuadran, yang setinggi 3.250 px karena tingginya adalah JARAK GULIR gulir lintang, bukan tinggi isinya. Motifnya mendarat 1.625 px ke bawah - jauh dari isi yang sedang dipatok di layar - dan yang terlihat cuma potongan bawahnya yang terpenggal | Posisinya dihitung terhadap tengah LAYAR (`scrollTop + H/2 - atas`), lalu dijepit ke dalam bagiannya. Bagian yang lebih pendek daripada layar terjepit ke tengah bagian dengan sendirinya, jadi satu rumus benar untuk keduanya |
| **Yang mahal keberadaan lapisannya, bukan gerakannya** | Riak radial menggandakan waktu bingkai (16,7 → 33,3 ms di perender CPU). Dugaan pertama: skalanya memaksa rasterisasi ulang. Diuji: varian dengan animasi DIMATIKAN tetap 33,3 ms, varian tanpa masker tetap 33,3 ms, varian dengan elemennya `display: none` langsung 16,7 ms | Yang dibayar adanya lapisan komposit kedua seukuran layar berisi pola SVG. Jadi yang benar bukan mengoptimalkan animasinya melainkan MENIADAKAN elemennya saat tidak dipakai — `display: none`, bukan `opacity: 0` maupun animasi yang dijeda |
| **Bandingkan selalu dengan LANTAInya sebelum menyalahkan yang baru** | Waktu bingkai saat digulir naik 16,7 → 33,3 ms sesudah riak dipasang, dan tampak jelas riaknya yang salah. Diuji dengan SELURUH lapisan tekstur disembunyikan: tetap 33,3 ms. Lantainya memang di situ; bacaan 16,7 ms sebelumnya cuma saat mesinnya sedang lengang | Sebelum mengoptimalkan sesuatu, ukur versi tanpa sesuatu itu. Waktu bingkai di perender perangkat lunak berayun besar antar-jalan; kerja UTAS UTAMA jauh lebih stabil dan itu yang layak dipercaya |
| **Menganimasikan opasitas lapisan berpola SVG itu mahal** | Sarang heksagon `<pattern>` yang di-*fade* naik-turun memaksa perender menyimpan sekaligus membaurkan tekstur mahal itu tiap bingkai. Terukur di lintasan gulir penuh: kerja utas utama **1,26 dtk** dengan napas itu, **0,97 dtk** tanpanya — padahal `opacity` biasanya properti yang aman | Yang bergerak dipindah ke lapisan GRADIEN (murah dirasterisasi), sarangnya dibuat diam. Pitanya juga dipersempit ke 46% lebar layar: ia menyapu karena BERJALAN, jadi tidak perlu seluas layar. Hasil akhir 1,21–1,26 dtk — sama dengan tanpa tekstur sama sekali |
| **Tween GSAP tak berujung membakar utas utama SELAMANYA** | `repeat: -1` menulis transform dari JavaScript tiap bingkai, termasuk saat elemennya jauh di luar layar. Sembilan di antaranya (6 kartu dek + 3 bola kaca) membakar **10,4% utas utama saat halaman DIAM** — tidak digulir, tidak disentuh siapa pun | Pindahkan ke `@keyframes` CSS: animasi transform/opacity CSS berjalan di compositor, nol pekerjaan utas utama. Kalau GSAP masih perlu menganimasikan elemen yang sama (mis. parallax gulir), beri masing-masing ELEMEN sendiri — pembungkus untuk yang satu, anak untuk yang lain. Dua penulis untuk satu `transform` tidak pernah bisa akur |
| **`var()` di dalam `@keyframes` membatalkan pengompositan** | Nilai transform yang memakai custom property memaksa browser menghitung ulang gaya tiap bingkai di utas utama — persis yang ingin dihindari dengan pindah ke CSS. Terukur: Recalc style **0,083 → 0,17 dtk**, dan seluruh keuntungan pindah-ke-CSS-nya habis | Keyframe berisi ANGKA HARFIAH. Yang berbeda per elemen dipindah ke hal yang bukan isi keyframe: `animation-delay`, `animation-duration`, atau `animation-name` yang berbeda (dua keyframe, bukan satu keyframe ber-variabel) |
| **Animasi di bagian yang tak terlihat tetap dibayar** | Halaman setinggi 12.501 px memuat 28 animasi CSS; yang terlihat pada satu saat paling banyak sepertiganya. Sisanya tetap dikomposit tiap bingkai untuk piksel yang tidak dilihat siapa pun | `IntersectionObserver` menandai bagian yang di luar layar, CSS menjedanya lewat `animation-play-state: paused`. IntersectionObserver, BUKAN ScrollTrigger ke-18: ia berjalan di luar jalur gulir. Terukur: kerja utas utama saat diam **1,25 → 0,42 dtk** |
| **Mengukur performa di dev server menyesatkan** | React mode DEV (`jsxDEV`, StrictMode render ganda) + sumber tanpa minifikasi + HMR. Bingkai median halaman gerbang **100 ms di dev, 16,7 ms di produksi** untuk kode yang sama persis — dan profil JS-nya menunjukkan yang membakar CPU justru `jsxDEV`, bukan animasi yang sedang diselidiki | `npx vite build && npx vite preview`, ukur di `:4173` (sudah ada di `cors_origins`). Kalau sebuah optimasi tidak terlihat di produksi, ia mungkin memang tidak ada |
| **Kaca yang terlalu tembus berhenti jadi permukaan** | `--g-kaca-isi` mode gelap 6% putih. Itu baik-baik saja selama latarnya gradien rata; begitu ada gelombang kisi menyala di belakangnya, garis terang itu terbaca seolah melintas DI ATAS bacaan. Dikira masalah z-index — bukan: elemennya memang di belakang, panelnya saja yang praktis tidak ada | Yang menutup bukan putihnya melainkan KEPEKATANNYA. Dasarnya diganti warna gelap halaman (`rgb(13 26 22 / 0.74)`), putihnya tinggal jadi kilau di tepi |
| **Ruang kontras tema terang jauh lebih sempit** | Gelombang kisi beralfa 0,85 terbaca bagus di atas hitam tetapi bersaing langsung dengan teks di atas mint — latar terang tidak punya tempat untuk garis terang | Nilai yang sama tidak berlaku untuk kedua tema. Terang 0,5, gelap 0,8 — dan itu bukan asimetri yang perlu dirapikan, melainkan konsekuensi dari mana kontrasnya berasal |
| **`DELETE FROM transport_nodes` menghapus SELURUH rute dan isochrone** | `hex_routes.transport_node_id` dan `catchment_areas.transport_node_id` keduanya `ON DELETE CASCADE`. `demo_seed` memang menghapus-lalu-menyisip tabel itu — cara yang benar selama simpulnya karangan, dan cara yang menghancurkan 1.587 rute ORS sungguhan begitu ada yang menjalankannya lagi | Simpul nyata dimuat dengan **upsert**, tidak pernah dengan hapus. Yang cocok di-`UPDATE` di tempat supaya `id`-nya bertahan; yang benar-benar baru di-`INSERT`. Satu-satunya data nyata di basis data tidak boleh bergantung pada urutan menjalankan skrip. **Sejak 26 Agu 2026 `demo_seed` MENOLAK jalan** kalau basis datanya memuat rute ORS, isochrone, atau POI bukan-demo - `_pastikan_boleh_menghapus()`, dilewati hanya dengan `--paksa`. Jebakan yang cuma didokumentasikan tetap jebakan; yang menghentikannya kode |
| **Cermin Overpass regional menjawab 200 dengan hasil kosong** | `overpass.osm.ch` isinya cuma Swiss. Untuk Jakarta ia menjawab `200 OK` + `elements: []` dalam **1,4 detik** — tercepat diprofil, jadi ia MENANG di setiap perlombaan cermin, dan keenam kawasan pulang dengan "0 simpul". Tidak ada galat, tidak ada peringatan; "tidak ada stasiun di Manggarai" terbaca sebagai temuan | `s1_ingest._cermin_sedunia()`: tiap cermin wajib MEMBUKTIKAN dirinya memuat Indonesia lewat satu kueri berjawaban pasti (Stasiun Manggarai) sebelum jawabannya dipercaya. Cermin cepat yang salah lebih merugikan daripada cermin lambat yang benar |
| **Kolom bersatuan "%" yang isinya pecahan 0-1** | `PanelInsight` mencetak angka apa adanya lalu menempelkan satuannya - ia TIDAK mengalikan seratus. Jadi `puncak_pagi = 0,30` tampil sebagai **"0,30 %"** untuk sesuatu yang berarti 30%. Terkena: B01-B04 dan B06 `pangsa_digital` (semuanya masih sintetis). `pangsa_waralaba` sempat sama sampai diisi OSM dalam persen, dan M01 nyaris ikut - keduanya kini 0-100 | Kolom bersatuan "%" disimpan **0-100**, titik. Skalanya tidak menyentuh skor (`norm()` di s6 min-max, kebal perkalian tetap), jadi ini murni soal angka yang dibaca orang - dan justru itu yang tidak akan pernah memunculkan galat |
| **Variabel yang jadi nyata separuh, dan separuhnya tidak memunculkan galat** | `muat_variabel` hanya menyentuh baris yang DIKIRIM. Jadi setiap sumber baru yang tidak menjangkau semua heksagon meninggalkan sisanya memegang angka `demo_seed` di kolom yang sama - satu kolom berisi dua jenis angka, tanpa satu pun cara membedakannya dari luar. Terjadi dua kali: variabel Kompetisi (312 heksagon tanpa POI) dan D01 (satu heksagon Tanah Abang tertinggal memegang `2521,07087899426`, sebelas angka di belakang koma di tengah kolom hasil pengukuran) | Selalu `reindex` ke SELURUH heksagon yang diskor sebelum memuat, dan biarkan yang tidak terjangkau jadi NaN supaya tertulis NULL. Gejala yang bisa dipakai memeriksa: `count(kolom)` sama dengan 708 padahal pemuatnya melaporkan angka yang lebih kecil |
| **Menyampel bidang dengan SATU titik** | Zona RDTR ditanyakan di titik tengah tiap heksagon. Terukur: heksagon Stasiun Manggarai memotong **lima poligon di empat zona berbeda** (Badan Jalan, Transportasi, Ruang Terbuka Hijau, Perumahan), dan kueri titik tengahnya hanya menjawab "Transportasi". Untuk L01 itu fatal - ia GERBANG yang menolkan skor, jadi satu titik yang kebetulan jatuh di badan jalan menolkan seluruh heksagon | Kirim POLIGON heksagonnya sebagai geometri kueri, lalu timbang menurut **luas perpotongan**. Aturan umumnya: bidang seluas 0,105 km2 tidak pernah cukup diwakili satu titik, dan makin besar akibat sebuah kolom makin mahal kesalahan sampelnya |
| **Menyimpan geometri mentah yang cuma dipakai sekali** | Poligon RDTR disimpan apa adanya ke singgahan supaya s1 tetap "menarik apa adanya". Terukur: **78 MB untuk 40 heksagon** = ~1,4 GB untuk 708, dan menulis ulang berkas sebesar itu tiap 40 heksagon membuat penarikan merangkak sampai mandek | Potong dan agregasi SAAT MENARIK kalau geometrinya tidak pernah ditanyakan lagi sesudah luasnya dihitung. Turun jadi **576 byte per heksagon**. Pemeriksaan bahwa pemotongannya benar: jumlah pangsa luas per heksagon harus 1,000 |
| **Kolom bool pandas tidak bisa memuat None** | `zona_izin_komersial` berisi True/False/None. Kalau satu batch kebetulan seluruhnya True, pandas menyempitkan dtype-nya jadi `bool` - dan None berikutnya berisiko terkoersi jadi False. Untuk kolom yang MENOLKAN SKOR, itu mengubah "belum diketahui" jadi "dilarang" | `.astype(object)` dipaku eksplisit. Diuji lewat `test_heksagon_di_luar_dki_tetap_kosong`, yang menegaskan `izin is not False` |
| **Radius tarik yang pas untuk heksagon TIDAK pas untuk k-ring 1** | Heksagon terjauh dari pusat kawasannya 2.286 m, jadi disc 2.600 m terasa lapang - dan memang lapang, untuk apa pun yang cuma perlu isi heksagonnya sendiri. C01 tidak begitu: ia menghitung heksagon **+ k-ring 1**, jadi jangkauannya satu heksagon (±350 m) lebih jauh. Terukur: 35 dari 708 heksagon punya tetangga ring-1 di tepi atau di luar disc. Yang kekurangan kompetitor bukan heksagon acak melainkan heksagon TEPI - dan yang terlihat lebih lengang daripada kenyataannya mendapat skor peluang lebih tinggi, persis bentuk "Hidden Gem palsu" yang jadi alasan produk ini ada | `RADIUS_POI_M = 3000` terpisah dari `RADIUS_M = 2600`. Aturan umumnya: radius penarikan ditentukan oleh JANGKAUAN ANALISISNYA, bukan oleh luas wilayah yang diskor |
| **Mencetak `type(e).__name__` saja menyembunyikan sebab yang menentukan tindakan** | Seluruh cermin Overpass dilaporkan "dilewati - HTTPError" berjam-jam. Tiga hal yang sangat berbeda terbaca sama: 429 berarti KITA yang terlalu sering (jedanya harus lebih panjang), 504 berarti instansnya penuh (cukup ditunggu), 400 berarti kuerinya salah (menunggu berapa lama pun tidak menolong). Sempat dikira rate limit padahal `/api/status` menyatakan 2 slot bebas | `_sebab(e)` mencetak `HTTP {e.code}`. Kalau sebuah galat dicatat untuk DIBACA MANUSIA yang harus memutuskan sesuatu, yang dicatat harus cukup untuk memutuskannya |
| `ST_Y()` menolak `hex_features.geom` | Kolomnya POLYGON - batas heksagon, bukan pusatnya. Gejalanya `Argument to ST_Y() must have type POINT`, yang terbaca seperti masalah tipe kolom padahal kolomnya memang benar | `ST_Centroid(geom::geometry)` dulu. `transport_nodes.geom` memang POINT; keduanya sama-sama `geom` dan tidak sama isinya |
| Overpass menjawab 406 untuk permintaan tanpa `User-Agent` | Gejalanya menyesatkan: kueri yang sama persis berhasil lewat `curl`, yang mengirim UA sendiri | Kirim `User-Agent` yang bisa dihubungi. Sekalian sopan santun API bersama |
| **`RemoteDisconnected` lolos dari `except URLError`** | Ia turunan `http.client.HTTPException`, BUKAN `OSError` — jadi penangkap yang menyebut `HTTPError`/`URLError`/`TimeoutError` melewatkannya. Padahal itu bentuk kegagalan yang paling sering muncul saat Overpass penuh: sambungan ditutup tanpa jawaban | Tangkap `(OSError, http.client.HTTPException, json.JSONDecodeError)`. `OSError` sudah mencakup ketiga yang pertama sekaligus |
| **`json.dump()` ke berkas meledak SESUDAH kueri jaringan berhasil** | Windows memakai cp1252 sebagai encoding bawaan `open()`, dan nama tempat di Jakarta memuat karakter di luarnya. Kerja jaringannya sudah terlanjur terbuang | `encoding="utf-8"` ditulis eksplisit di setiap tulis-berkas. Berlaku juga untuk `print` — jalankan dengan `PYTHONIOENCODING=utf-8` |
| **`str.replace()` yang tidak cocok gagal DIAM-DIAM** | Skrip penyunting massal memakai `s.replace(lama, baru)` lalu mencetak "berhasil" tanpa memeriksa. Satu dari dua penggantian tidak cocok, jadi yang tertulis cuma separuhnya — meninggalkan pemanggilan variabel yang tidak pernah didefinisikan, dan pesan suksesnya berbohong | Periksa `assert lama in s` sebelum mengganti, atau pakai Edit yang memang gagal kalau tidak cocok. Sesudah menyunting berkas lewat skrip, `ast.parse()` berkasnya |
| **Isochrone ORS diukur dari koordinat yang salah** | Pemeriksaan awal memakai koordinat stasiun yang ditebak, bukan yang di basis data. Selisih 0,001 derajat menghasilkan "jari-jari 5 menit = 1.363 m" — mustahil berjalan kaki, dan nyaris membuat seluruh fiturnya dibuang | Ukur dengan data yang SEBENARNYA dipakai produksi. Dengan koordinat dari `transport_nodes`, pergeseran tempel ORS tinggal 2–47 m dan seluruh angkanya masuk akal |
| **Peta berhenti terasa seperti peta** | `siapkanBasemap()` menyembunyikan SETIAP layer POI (`visibility: 'none'`), jadi tidak ada satu pun nama tempat — orang tidak bisa mengenali di mana ia sedang melihat, dan heksagon berwarna mengambang di atas jalan tanpa nama | Layer POI dinyalakan, ambang zoom-nya diturunkan lewat `ZOOM_POI` (`poi_z14` 14 → 12,5; dua tingkat lainnya dibiarkan supaya kepadatannya tidak berlipat), halo teks ditebalkan ke 1,6 supaya nama tetap terbaca di atas isian heksagon, dan `L_ANGKA` disisipkan di `labelPertama()` supaya angka skor tidak pernah menimpa nama tempat |
| **Fitur berbayar yang justru MENGHILANG sesudah dibayar** | Tabel `score_factors` tidak pernah diisi siapa pun - `s7_publish` maupun `demo_seed` tidak menyentuhnya. `/hex/{h3}` tetap menjawab 200 dengan `faktor: []`, jadi tidak ada satu pun galat. Yang terjadi di layar: bagian "Kenapa skornya segitu" dirender di balik `faktor.length > 0`, jadi tamu melihat tirai ajakan berlangganan, lalu sesudah berlangganan bagiannya **lenyap sama sekali**. `sumber_angka` di setiap jawaban AI juga selalu kosong, padahal aturan emas 1 menuntut tiap angka bisa ditelusuri ke sana | `s6_score.rincian_faktor()` + `s7_publish.muat_faktor()`. Perhitungannya di s6, bukan di backend: kontribusi = bobot x nilai ternormalisasi, dan itu aritmetika skor. Dijaga `test_faktor_menjumlah_jadi_indeksnya` - jumlah kontribusi satu indeks WAJIB sama dengan nilai indeksnya |
| **Tabel kosong tidak pernah terlihat sebagai galat** | Uji berbasis transaksi menaburkan barisnya sendiri lalu me-rollback, jadi `smoke_api` HIJAU untuk tabel yang di produksi kosong melompong. Yang diuji bentuk responsnya, bukan ada-tidaknya isi | Sebelum demo, hitung barisnya langsung: `SELECT count(*)` untuk tiap tabel, atau `python s7_publish.py --cakupan`. `/meta/siap` sengaja hanya menjaga `hex_features` dan `location_scores` - sisanya harus dilihat sendiri |
| Header respons buatan sendiri tidak pernah sampai ke frontend | `X-Total-Count` dipasang di `/skor/ranking`, tetapi peramban menyembunyikan setiap header yang tidak disebut `expose_headers`. Dari curl terlihat; dari `fetch()` tidak ada | Daftarkan di `CORSMiddleware(expose_headers=[...])`. Namanya hidup sebagai `skor.HEADER_TOTAL` supaya kedua sisi tidak bisa berpisah |
| **Legenda menerangkan warna yang tidak ada di layar** | `risk_radar` dikeluarkan dari `LAYER_KUADRAN` saat pewarnaannya pindah ke indeks churn, tetapi tidak ada yang menggantikan legendanya - komponen `Legenda` cuma bercabang untuk `pricelens`, sisanya jatuh ke cabang ZoneGuard. Jadi layer churn menampilkan legenda perizinan | Cabang sendiri untuk `risk_radar`, gradasinya dibangun dari `CHURN_STOP` di `lib/layer-peta.ts` - tabel yang sama yang mewarnai petanya |
| Panel kawasan kosong pada tampilan BAWAAN | Nilai saringan kawasan berbentuk mesin: `''` berarti semua, koma berarti beberapa. `"di {kawasan}"` jadi "di ", dan `find(r => r.kawasan === kawasan)` tidak pernah cocok - legenda menulis "belum ada sampel" di atas peta yang penuh angka | `labelKawasan()` untuk chip, `frasaKawasan()` untuk kalimat, keduanya di `config.ts`. Angka yang berupa HITUNGAN boleh dijumlah lintas kawasan; KUARTIL tidak - median dari beberapa median bukan median |
| **Fitur berbayar tidak selamat dari F5** | Validator localStorage di `App.tsx` cuma menerima SATU nama pilot atau string kosong, jadi saringan multi-kawasan (`'Bekasi,Depok Baru'`) gagal validasi dan jatuh ke bawaan. Refresh melempar pelanggan kembali ke seluruh kawasan tanpa sepatah kata pun, dan multi-kawasan itu baris pertama tabel fitur berbayar | `bersihkanKawasan()` memvalidasi TIAP potongan lalu menyambungnya kembali. Nama tak dikenal dibuang, sisanya dipertahankan. `gantiKawasan` ikut mem-`fitBounds` ke gabungan pusatnya - tanpa itu peta diam di tempat saat kawasan kedua ditambahkan, dan Bekasi ke Depok Baru berjarak dua puluh kilometer |
| Uji Playwright "membuktikan" bug yang tidak ada | `addInitScript` berjalan ulang di SETIAP navigasi, termasuk `page.reload()`. Benih localStorage-nya menimpa apa yang baru saja ditulis aplikasi, jadi uji pemulihan-sesudah-refresh sebenarnya menguji benihnya sendiri | Beri penjaga sekali-jalan di dalam init script. Berlaku juga untuk `scripts/potret-kartu.mjs` kalau suatu saat ia perlu menavigasi lebih dari sekali |
| **Indeks H3 dipakai sebagai nama di layar** | `898c107834bffff` itu alamat sel di grid Uber H3 - kunci utama basis data, dan memang tidak akan pernah diganti. Tetapi lima belas karakter heksadesimal tidak bisa dibaca, tidak bisa diingat, dan tidak bisa disebutkan lewat telepon | `kode_lokasi()` di backend dan `kodeLokasi()` di frontend: `Manggarai-33651`. TANPA KEADAAN - diturunkan dari `h3[7:11]`, bukan nomor urut. Nomor urut menuntut seluruh himpunan diketahui, dan tiap heksagon baru akan menggeser nomor tetangganya termasuk yang sudah tercetak di Laporan Kelayakan orang. Diuji nol bentrok atas 708 heksagon |
| Legenda dan peta memakai warna yang sama tetapi angkanya berbeda | Bar pembanding memakai `--color-line-2` (#bcc5bf) di atas rel `--color-ground-2` (#dde2df). Keduanya beda 2% terang, jadi bar yang KALAH praktis tidak terlihat - padahal panjang bar itulah satu-satunya guna baris itu | Yang kalah pakai `--color-ink-3`. Warna netral yang kontras, bukan warna yang sopan |
| Isochrone digambar sebagai lingkaran | Godaannya besar: `catchment_areas` kosong, dan lingkaran radius sekian meter "cukup mirip". Titik yang berjarak lurus 200 m dari stasiun bisa butuh memutar 900 m karena terhalang rel - itu justru sebabnya isochrone dipilih sejak awal | `/hex/{h3}/simpul-terdekat` menggambar GARIS, bukan bidang. Bentuk yang tidak bisa disalahartikan sebagai kawasan jangkauan, dan labelnya menyebut "garis lurus" apa adanya. Isochrone sungguhan menunggu routing OSMnx |
| **Badge keyakinan menyatakan kebalikan dari kenyataan** | `demo_seed` membagikan `n_titik_misi` acak 4-45 lalu menandai yang >= 10 sebagai `observed`, sehingga 474 dari 708 heksagon mengaku disurvei dengan badge "Didukung survei secukupnya" - padahal `menu_observations`, `receipt_observations`, dan `property_observations` ketiganya NOL baris. Aturan emas 2 dibalik jadi senjata makan tuan: badge yang ada untuk mengaku data tipis justru menyembunyikannya, dan "28 titik misi itu dari mana?" tidak punya jawaban di depan juri | Data demo SELALU `predicted` / `RENDAH` / `n_titik_misi = 0`. Penanda "heksagon mana yang dibangkitkan aktivitasnya" dipisah jadi variabel `berisi` yang tidak pernah menyentuh badge. Plus pita "Data demo" di bilah atas yang DITURUNKAN dari `/meta/siap::data_sintetis` (jumlah baris observasi misi), bukan konstanta - jadi ia hilang sendiri begitu survei masuk, dan tidak bisa berbohong ke arah sebaliknya |

## Kalau harus memutuskan sesuatu sendiri

Urutan preferensi, dari yang paling didahulukan:

1. **Jangan melanggar tujuh aturan di atas.** Tidak ada perkecualian.
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
