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
                        │  5 modul · tidak menghitung │
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

## Backend: modular monolith, enam modul

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
│   └── llm.py       sambungan penyedia model bahasa
└── api/
    ├── bersama.py   lintas modul: badge, ZoneGuard, persentil, validasi
    ├── meta.py      /health · /meta/siap · /meta/kawasan · /meta/cache/bersihkan
    ├── hex.py       /hex/layer · /hex/{h3} · /hex/{h3}/commuter-clock
    ├── pricelens.py /pricelens/layer · /pricelens/ringkasan · /pricelens/{h3}
    ├── transit.py   /transit/nodes · /transit/simpul/{id} · /transit/catchment
    ├── skor.py      /skor/ranking · hidden-gems · risk-radar · kuadran ·
    │                zoneguard · versi · banding-versi
    └── ai.py        /ai/fungsi · /ai/status · /ai/tanya
```

Dua puluh sembilan rute. Daftar lengkapnya di `/docs` saat dijalankan lokal.

`bersama.py` ada karena `skor.py` sempat mengimpor `badge()` dari `hex.py`. Pola
itu berubah jadi impor melingkar begitu modul bertambah; sekarang modul API hanya
mengimpor dari bawah ke atas, tidak pernah menyamping.

`core/aturan.py` memuat SELURUH aturan tampilan — ambang churn, label risiko,
status zona, penjelasan kuadran. Semuanya bisa digeser tanpa mengubah satu pun
peringkat, dan itu pembeda yang penting: kalau sebuah angka mengubah peringkat,
ia bukan aturan tampilan dan tempatnya bukan di sana.

### Kenapa bukan tujuh modul

Awalnya masuk akal membuat modul terpisah untuk "lokasi usaha", "kompetitor", dan
"properti" — ketiganya domain yang berbeda.

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

**Cache dalam proses** (`core/cache.py`). Bukan Redis: Render free tier hanya
memberi satu proses tanpa layanan tambahan, dan menambah Redis berarti menambah
satu lagi hal yang bisa mati saat demo. Yang di-cache hanya bacaan mahal yang
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
hex_features total kolom: 48
  variabel analisis     : 41
  penanda kualitas      : 3  (n_titik_misi, tingkat_keyakinan, data_source)
```

## Deployment

| Bagian | Layanan | Catatan |
|---|---|---|
| Frontend | Cloudflare Pages | Statis, gratis |
| Backend | Render | Free tier **tidur setelah tidak aktif** |
| Basis data | Supabase | Free tier dijeda kalau lama menganggur |
| Subdomain | Disediakan panitia MAPID | Alurnya di berkas briefing Technical Meeting |

### Mitigasi free tier — wajib dikerjakan sebelum demo

Backend Render tidur dan butuh puluhan detik untuk bangun. Kalau juri membuka
tautan lebih dulu, halaman terlihat rusak.

1. **Layer heksagon disajikan sebagai GeoJSON statis dari Cloudflare**, bukan
   dari `/hex/layer` langsung. Endpoint itu tetap dipakai saat pengembangan dan
   sebagai sumber untuk membangkitkan berkas statisnya.
2. **Panggil backend beberapa menit sebelum demo** supaya sudah bangun.
3. **Cache AI tidak dikosongkan** — lihat `pipeline/README.md`.

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
