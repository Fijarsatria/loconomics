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
                        │  4 modul · tidak menghitung │
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

## Backend: modular monolith, empat modul

```
backend/app/
├── main.py          rakit aplikasi + CORS
├── models.py        SQLAlchemy — 41 variabel + 3 penanda kualitas
├── schemas.py       Pydantic — bentuk respons, tempat aturan lomba ditegakkan
├── core/
│   ├── config.py    baca environment
│   └── database.py  sesi
└── api/
    ├── hex.py       /hex/layer · /hex/{h3}
    ├── transit.py   /transit/nodes · /transit/catchment
    ├── skor.py      /skor/ranking · /skor/hidden-gems · /skor/risk-radar
    └── ai.py        /ai/fungsi · /ai/tanya
```

### Kenapa empat modul, bukan tujuh

Awalnya masuk akal membuat modul terpisah untuk "lokasi usaha", "kompetitor", dan
"properti" — ketiganya domain yang berbeda.

Tapi ketentuan B.7 melarang mengekspos data misi MAPID mentah. Kalau ketiganya
punya endpoint sendiri, endpoint itu tidak punya apa-apa untuk dikirim selain
baris survei individual — persis yang dilarang. Ketiganya sudah hadir sebagai
variabel agregat di `/hex`.

Jadi batasan lomba justru menghasilkan arsitektur yang lebih bersih. Empat modul,
bukan tujuh.

### Backend tidak menghitung

Seluruh modul `skor.py` hanya membaca tabel `location_scores`. Tidak ada
aritmetika skor di mana pun di `backend/`. Kalau muncul, itu bug — lihat
[skoring.md](skoring.md).

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
