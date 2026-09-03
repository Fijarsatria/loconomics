# Arsitektur

## Peta besar

```
                        ┌─────────────────────────────┐
   Offline, sekali      │  pipeline/  s1 → s6         │
   sebelum demo         │  Python · Pandas · GeoPandas│
                        └──────────────┬──────────────┘
                                       │ tulis
                                       ▼
                        ┌─────────────────────────────┐
                        │  PostgreSQL + PostGIS       │
                        │  (Supabase)                 │
                        └──────────────┬──────────────┘
                                       │ baca saja
                                       ▼
                        ┌─────────────────────────────┐
                        │  backend/  FastAPI          │
                        │  7 modul · tidak menghitung │
                        └──────────────┬──────────────┘
                                       │ JSON / GeoJSON
                                       ▼
   ┌───────────────┐    ┌─────────────────────────────┐
   │ MAPID Maps    │───▶│  frontend/  React + MapLibre│
   │ (basemap)     │    │  Peta · Insight · AI        │
   └───────────────┘    └─────────────────────────────┘
```

Satu arah, tidak ada siklus. Pipeline menulis, backend membaca, frontend
menampilkan. Tidak ada tahap yang menghitung ulang pekerjaan tahap sebelumnya.

## Kenapa MapLibre GL, bukan Leaflet

Keputusan ini dipaksa oleh temuan, bukan preferensi.

Ketentuan lomba mewajibkan basemap MAPID Maps. Endpoint raster/XYZ yang tertulis
di dokumentasi MAPID **mengembalikan 404 di setiap level zoom**, termasuk
`0/0/0` — sudah diverifikasi terhadap berkas WMTS capabilities milik MAPID
sendiri, yang mengiklankan template yang sama persis. Jalur `style.json` (vector)
berfungsi normal.

Leaflet tidak bisa merender vector style tanpa plugin. MapLibre GL bisa secara
asli. Karena itu React Leaflet dilepas dan MapLibre dipasang.

### Tiga jebakan MapLibre yang sudah kena dan sudah diperbaiki

Ketiganya berbiaya berjam-jam. Ditulis di sini supaya tidak terulang.

**1. Tidak ada default export.** MapLibre v6 tidak menyediakannya.

```ts
import { Map as MapLibreMap } from 'maplibre-gl'   // benar
import maplibregl from 'maplibre-gl'               // SyntaxError
```

**2. Tinggi wadah harus tegas.** Peta kosong dengan kontrol zoom terlihat = rantai
tinggi CSS tidak terselesaikan. Wadah peta memakai `position: absolute; inset: 0`
di dalam induk `relative`.

**3. Worker MapLibre salah dibundel Vite.** Gejalanya jahat: peta ter-inisialisasi,
kontrol muncul, tapi **semua tile gagal diam-diam tanpa satu pun pesan di
console**. Perbaikannya di `vite.config.ts`:

```ts
optimizeDeps: { exclude: ['maplibre-gl'] }
```

Setelah mengubahnya, `node_modules/.vite` harus dihapus — cache lama tetap
dipakai kalau tidak.

## Backend: modular monolith, tujuh modul

```
backend/app/
├── main.py          rakit aplikasi: middleware, penangan galat, router
├── models.py        SQLAlchemy — 43 variabel + 3 penanda + profil jam
├── schemas.py       Pydantic — bentuk respons, tempat aturan lomba ditegakkan
├── core/
│   ├── config.py    baca environment
│   ├── database.py  sesi
│   ├── aturan.py    aturan TAMPILAN: ambang peringatan, label, status zona
│   ├── galat.py     amplop galat seragam + request id
│   ├── cache.py     cache dalam proses ber-TTL
│   ├── batas.py     pembatas laju + plafon biaya AI
│   ├── llm.py       sambungan penyedia model bahasa
│   ├── akun.py      sidik sandi, tiket sesi, tingkat, penjaga fitur berbayar
│   └── simulasi.py  aritmetika skenario usaha — BUKAN skor, tidak pernah disimpan
└── api/
    ├── bersama.py   lintas modul: badge, ZoneGuard, persentil, validasi
    ├── meta.py      /health · /meta/siap · /meta/kawasan · /meta/cache/bersihkan
    ├── hex.py       /hex/layer · /hex/{h3} · commuter-clock · simulasi ·
    │                simpul-terdekat
    ├── pricelens.py /pricelens/layer · /pricelens/ringkasan · /pricelens/{h3}
    ├── transit.py   /transit/nodes · /transit/simpul/{id} · /transit/catchment
    ├── skor.py      /skor/ranking · hidden-gems · risk-radar · kuadran ·
    │                zoneguard · versi · banding-versi · komparasi · riwayat ·
    │                dinamika · rekomendasi
    ├── ai.py        /ai/fungsi · /ai/status · /ai/tanya
    └── akun.py      /akun/daftar · masuk · saya · preferensi · paket · langganan ·
                     token · buka · pantauan · laporan · laporan-komparasi
```

Empat puluh enam rute di tujuh router; `bersama.py` sengaja tidak punya router.
Daftar lengkapnya di `/docs` saat dijalankan lokal.

`bersama.py` ada karena `skor.py` sempat mengimpor `badge()` dari `hex.py`. Pola
itu berubah jadi impor melingkar begitu modul bertambah; sekarang modul API hanya
mengimpor dari bawah ke atas, tidak pernah menyamping.

`core/aturan.py` memuat SELURUH aturan tampilan — ambang churn, label risiko,
status zona, penjelasan kuadran. Semuanya bisa digeser tanpa mengubah satu pun
peringkat, dan itu pembeda yang penting: kalau sebuah angka mengubah peringkat,
ia bukan aturan tampilan dan tempatnya bukan di sana.

### Kenapa tidak ada modul lokasi usaha, kompetitor, dan properti

Awalnya masuk akal membuat modul terpisah untuk ketiganya — ketiganya domain
yang berbeda.

Tapi ketentuan B.7 melarang mengekspos data misi MAPID mentah. Kalau ketiganya
punya endpoint sendiri, endpoint itu tidak punya apa-apa untuk dikirim selain
baris survei individual — persis yang dilarang. Ketiganya sudah hadir sebagai
variabel agregat di `/hex`.

Jadi batasan lomba justru menghasilkan arsitektur yang lebih bersih. Modul yang
ada dipisah menurut **pertanyaan yang dijawab pengguna**, bukan menurut tabel:
`/pricelens` menjawab "mahal atau murah", `/skor` menjawab "layak atau tidak".

### Backend tidak menghitung

Seluruh modul `skor.py` hanya membaca tabel `location_scores`. Tidak ada
aritmetika skor di mana pun di `backend/`. Kalau muncul, itu bug — lihat
[skoring.md](skoring.md).

Satu hal yang **memang** dihitung backend: persentil kawasan (`percentile_cont`)
untuk rentang harga wajar PriceLens dan ambang peringatan RiskRadar. Itu statistik
deskriptif atas nilai yang sudah tersimpan, bukan bagian dari skor — menggesernya
mengubah kapan peringatan muncul, tidak pernah mengubah peringkat.

### Endpoint bisa dipanggil langsung

Seluruh parameter memakai bentuk `Annotated[T, Query(...)] = nilai`, bukan
`= Query(default=nilai)`. Bedanya bukan gaya: pada bentuk kedua, nilai bawaannya
adalah objek `Query` dan fungsinya hanya bisa dipanggil lewat HTTP. Modul AI
memanggil endpoint secara langsung sebagai alat, jadi bentuk pertama yang dipakai.
Ini ditemukan oleh smoke test, bukan oleh code review.

### Ketahanan produksi

Empat hal yang tidak terlihat di daftar endpoint tetapi menentukan apakah
backend ini selamat di free tier.

**Amplop galat seragam** (`core/galat.py`). Tanpa ini, kegagalan basis data
keluar ke pengguna sebagai traceback Python: bocor nama tabel, jalur berkas, dan
kadang potongan connection string. Setiap galat sekarang keluar sebagai
`{"galat": {"kode", "pesan", "request_id"}}` — `kode` untuk program, `pesan`
untuk manusia. Pesan galat tak terduga TIDAK pernah diteruskan apa adanya;
yang keluar hanya `request_id`, isinya lengkap ada di log server.

**Cache dalam proses** (`core/cache.py`). Bukan Redis: terbitannya satu proses
tanpa layanan tambahan - benar di Azure App Service maupun di Render - dan
menambah Redis berarti menambah satu lagi hal yang bisa mati saat demo. Yang di-cache hanya bacaan mahal yang
jarang berubah — persentil kawasan dan layer GeoJSON. Setelah pipeline memuat
data baru, panggil `POST /meta/cache/bersihkan`.

**Pembatas laju + plafon biaya** (`core/batas.py`). `/ai/tanya` satu-satunya
endpoint yang membelanjakan uang sungguhan. Dua lapis: jendela geser 10
permintaan per menit per alamat, dan plafon biaya harian yang dihitung dari
`ai_call_logs`. Lapis pertama saja tidak cukup — sepuluh alamat yang
masing-masing di bawah batas tetap bisa menguras anggaran dalam sehari. Yang
paling mungkin memicunya bukan penyerang, melainkan satu `useEffect` tanpa
dependensi yang benar di frontend.

**Kompresi GZip.** Satu FeatureCollection berisi ribuan heksagon adalah JSON
penuh angka berulang dan biasanya menyusut sekitar sepersepuluh. Di free tier itu
bedanya antara peta yang muncul dan peta yang masih memuat saat juri sudah pindah.

### Uji

```bash
cd backend
python tests/test_aturan.py     # aturan tampilan, skema alat, konsistensi lintas berkas
python tests/test_infra.py      # galat, cache, pembatas — tanpa DB
python tests/test_ai_loop.py    # loop agentik dengan klien tiruan, tanpa kunci API
python tests/smoke_api.py       # enam fitur terhadap Supabase, di dalam transaksi
```

`smoke_api.py` sengaja memakai basis data **sungguhan**. Yang paling mungkin salah
di modul-modul ini justru SQL-nya — `percentile_cont`, filter tri-nilai boolean,
`NULLS LAST` — dan ketiganya berperilaku berbeda di SQLite, jadi menguji di sana
tidak membuktikan apa pun. Seluruh isian dibuat dalam satu transaksi yang selalu
di-rollback, dan skrip memastikan nol baris tersisa sebelum selesai.

### Versi skor

`location_scores` unik pada (`h3_index`, `versi`). Baseline = `"baseline"`.
Dua hal jadi mungkin: uji sensitivitas menyimpan variannya tanpa merusak
baseline, dan simulator what-if (B3) berjalan tanpa menghancurkan pembanding.

## Frontend: tiga bagian wajib dalam satu layar

```
frontend/src/
├── config.ts        sumber kebenaran tunggal (basemap, kawasan, warna, layer)
├── types.ts         cerminan backend/app/schemas.py
├── lib/api.ts       satu-satunya tempat fetch dipanggil
├── App.tsx          kerangka + pemilik state layer & gaya
└── components/
    ├── PetaInteraktif.tsx   bagian wajib 1
    ├── PanelInsight.tsx     bagian wajib 2
    └── PanelAI.tsx          bagian wajib 3
```

Tujuh berkas. Sengaja tidak lebih.

Ketiga bagian wajib tampil bersamaan, bukan berpindah halaman: AI menggerakkan
peta → peta memilih heksagon → heksagon mengisi panel insight. Kalau terpisah
halaman, rantai itu putus.

**App yang memegang state `layer` dan `gaya`**, bukan komponen peta. Tombol di
layar dan perintah AI mengubah state yang sama, jadi tampilan tidak pernah bisa
berbeda dari yang dikira AI.

## Basis data

PostgreSQL + PostGIS di Supabase. Migrasi lewat Alembic.

### Tiga perbaikan Alembic yang sudah permanen

Ketiganya berulang setiap kali `autogenerate` dijalankan, jadi diperbaiki di
sumbernya, bukan dengan mengedit berkas migrasi satu per satu.

**1. `alembic/env.py` — `include_object`.** Menyaring tabel sistem PostGIS
(`spatial_ref_sys`, dll.) supaya tidak muncul sebagai `op.drop_table()`, dan
menyaring indeks GiST `idx_*_geom` yang **sudah** dibuat otomatis oleh GeoAlchemy2
lewat event DDL. Tanpa ini, migrasi gagal dengan
`relation "idx_hex_features_geom" already exists`.

**2. `alembic/script.py.mako` — `import geoalchemy2`.** Migrasi hasil autogenerate
memakai tipe GeoAlchemy2 tapi tidak mengimpornya.

**3. Migrasi baru, bukan menulis ulang sejarah.** Perubahan skema besar
(`c0a56e2aba1e_kamus_data_final_41_variabel`) dibuat sebagai migrasi kedua, bukan
dengan mengubah migrasi yang sudah diterapkan.

### Verifikasi terakhir terhadap basis data langsung

```
hex_features total kolom: 50
  variabel analisis     : 43
  penanda kualitas      : 3  (n_titik_misi, tingkat_keyakinan, data_source)
  sisanya               : 4  (h3_index, kawasan, geom, diperbarui_pada)

location_scores       : 708 baris   hex_hourly_profiles : 7.186 baris
score_factors         : 9.912 baris (14 variabel berbobot x 708 heksagon)
```

`score_factors` sempat kosong berbulan-bulan tanpa terlihat sebagai galat:
`/hex/{h3}` tetap menjawab 200, hanya dengan `faktor: []`. Yang diisi
`s7_publish.muat_faktor()` sekarang adalah dua janji sekaligus — panel "Kenapa
skornya segitu" dan `sumber_angka` yang membuat setiap angka jawaban AI bisa
ditelusuri. Jumlah kontribusi satu indeks selalu sama dengan nilai indeksnya;
itu ditegakkan `test_s6_score.py::test_faktor_menjumlah_jadi_indeksnya`.

## Deployment

Berkas konfigurasinya sudah ada di repo, jadi ini bukan lagi rencana:

| Bagian | Layanan | Berkas | Catatan |
|---|---|---|---|
| Frontend | GitHub Pages | `.github/workflows/pages.yml` | Build `npm run build`, keluaran `dist/` |
| Backend | Azure App Service | `.github/workflows/backend-azure.yml` | Kredit Azure for Students, **tidak tidur** |
| Basis data | Supabase | — | Connection string mode *Transaction pooler* |
| Subdomain | Disediakan panitia MAPID | — | Alurnya di berkas briefing Technical Meeting |

Backend terbit lewat GitHub Actions. Alurnya menguji dulu (`test_infra` +
`test_ai_loop`, keduanya sengaja lolos tanpa `.env`), menerbitkan, lalu
**memeriksa terbitan yang baru naik DARI LUAR**: `/health`, header CORS untuk
asal frontend yang sebenarnya, dan satu tiket karangan `Bearer a.b.c` ke
`/akun/saya` yang harus dijawab 401 - 500 di situ berarti `AUTH_SECRET` belum
disetel. Daftar Application settings yang harus diisi ada di kepala berkas
alurnya, dan satu uji di `test_infra.py` memaksa setiap field `Settings`
DISEBUT di sana - sebagai isian, atau sebagai pengecualian berikut alasannya.

**Kenapa bukan Render.** `render.yaml` ditulis lebih dulu dan masih ada, sudah
dibetulkan dan dijaga sembilan asersi. Yang menggugurkannya bukan harga - plan
`free`-nya memang gratis - melainkan kartu: Render meminta kartu, Azure for
Students memberi $100/12 bulan tanpa kartu. Free tier Render juga tidur 15
menit dan cuma 0,1 CPU. Ia dipertahankan sebagai CADANGAN: kalau Azure
bermasalah menjelang penjurian, Blueprint-nya tinggal dipakai.

**Yang wajib disetel ulang begitu subdomain MAPID keluar:** `CORS_ORIGINS` di
Application settings. CORS yang salah membuat SELURUH panggilan data gagal dari
peramban sementara `curl` tetap berhasil — jenis kegagalan yang paling lama
dikejar karena gejalanya menunjuk ke tempat yang salah.

### Ketahanan saat backend belum siap

Dulu berjudul "mitigasi free tier" dan seluruhnya soal Render yang tidur.
Azure tidak tidur, tetapi tidak satu pun butir di bawah dicabut - dan itu
disengaja. Yang dijaga bukan cold start melainkan pertanyaan yang lebih umum:
**apa yang terlihat kalau backend belum menjawab?** Sebabnya bisa deploy yang
sedang berjalan, jaringan juri, kuota Azure habis, atau Render kalau cadangan
itu yang jadi dipakai.

1. **Gaya basemap disajikan statis dari GitHub Pages** — `frontend/public/basemap/`,
   empat berkas, 224 KB. Peta tergambar lengkap dengan jalan dan nama tempat
   walaupun backend belum menjawab. Dibangkitkan `scripts/gaya-basemap.mjs`.
2. **Heksagon tidak menunggu ubin basemap.** Penanda siap peta dipicu
   `styledata`, bukan hanya `load`. Terukur: dengan basemap diblokir penuh
   (MAPID sedang membatasi laju), 28 dari 29 asersi audit tetap lolos.
3. **`/health` tidak menyentuh basis data.** Health check platform memanggilnya
   tiap beberapa detik; kalau ia membuka koneksi, Supabase free tier habis
   sendiri.
4. **Layer heksagon sebagai GeoJSON statis — BELUM.** `s7_publish.py --ekspor`
   sudah membangkitkan berkasnya; menyajikannya dari GitHub Pages belum
   dikerjakan.

Satu lagi yang tetap manual apa pun platformnya: **jangan kosongkan cache AI**
menjelang demo — lihat `pipeline/README.md`.

### `_headers` dan `_redirects` TIDAK berlaku di GitHub Pages

Keduanya format **Cloudflare Pages**, dan Cloudflare tidak pernah jadi dipakai.
GitHub Pages mengabaikan kedua berkas itu sepenuhnya. Diukur di terbitan yang
sedang hidup, 2 Sep 2026:

- respons `fijarsatria.github.io/loconomics/` **tidak memuat satu pun** dari
  empat header yang dijanjikan `_headers` — `X-Content-Type-Options`,
  `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`
- jalur dalam yang tidak ada dijawab **404**, jadi aturan SPA di `_redirects`
  juga tidak pernah dibaca

Yang hilang cuma keempat header itu. Aturan SPA-nya memang tidak dibutuhkan:
aplikasi ini tidak memakai router sama sekali (nol `react-router`, nol
`pushState`), jadi tidak ada jalur dalam yang perlu dikembalikan ke
`index.html`. Kalau keempat header itu diinginkan, GitHub Pages tidak bisa
memasangnya — jalurnya `<meta http-equiv>` untuk sebagian, atau CDN di
depannya. Belum diputuskan; yang penting berkasnya berhenti terbaca seolah
sudah bekerja.

### Proksi gaya basemap

`GET /meta/basemap/{gaya}/style.json` mengambil gaya dari MAPID dengan kunci,
membuang kuncinya dari badan respons, lalu menyisipkan TileJSON-nya. Ia ada
karena kunci Map Services ternyata membuka data misi juga — rinciannya di
`docs/aturan-lomba.md` bagian 2.

Endpoint ini TIDAK dipanggil peramban saat aplikasi berjalan; ia dipanggil
`scripts/gaya-basemap.mjs` saat build. Yang dilayani ke pengguna berkas statis.

### Audit sebelum menyerahkan

```bash
cd backend  && uvicorn app.main:app --port 8000
cd frontend && npm run dev
cd frontend && SANDI=... node scripts/audit-prd.mjs
```

29 asersi di Chromium sungguhan: keenam acceptance criteria PRD, dua lintasan
(tamu dan pelanggan premium), plus pemeriksaan bahwa nol URL yang diminta
peramban membawa `key=` atau `access_token=`.

## Rahasia dan kunci

| Kunci | Tempat | Alasan |
|---|---|---|
| MAPID Maps API key | `frontend/.env` (`VITE_…`) | Menurut briefing MAPID, kunci basemap hanya menghitung pemakaian, bukan otorisasi |
| Sandi basis data | `backend/.env` | Tidak pernah masuk source, tidak pernah di-commit |
| MAPID Data API key (`x-api-key`) | `backend/.env` | **Backend-only** |
| Kunci penyedia LLM | `backend/.env` | **Backend-only** |

`.env` masuk `.gitignore`. `.env.example` dikomit sebagai daftar isian, selalu
dengan nilai kosong.

Dua yang terakhir tidak boleh menyentuh frontend dalam bentuk apa pun — termasuk
lewat variabel `VITE_`, yang seluruhnya ikut ter-bundel ke berkas yang bisa dibuka
siapa saja.

## Menjalankan secara lokal

```bash
# backend
cd backend
python -m venv venv && source venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env          # isi DATABASE_URL
alembic upgrade head
uvicorn app.main:app --reload  # http://localhost:8000/docs

# frontend
cd frontend
npm install
cp .env.example .env          # isi VITE_MAPID_MAPS_API_KEY
npm run dev                   # http://localhost:5173
```

Kalau peta kosong tapi kontrol zoom terlihat, mulai dari tiga jebakan MapLibre
di atas.
