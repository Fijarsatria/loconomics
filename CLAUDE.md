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
| Mengubah rumus skor | [docs/skoring.md](docs/skoring.md) |
| Mengerjakan OCR / AI Consultant | [docs/ai.md](docs/ai.md) |
| Menyentuh backend / frontend / deploy | [docs/arsitektur.md](docs/arsitektur.md) |

## Struktur

```
backend/     FastAPI — 5 modul + tests/. Membaca basis data, TIDAK menghitung skor
frontend/    React + Vite + MapLibre GL. 7 berkas sumber, sengaja tidak lebih
pipeline/    Python s1→s6. Satu-satunya tempat skor dihitung
docs/        7 dokumen. Kenapa, bukan bagaimana
```

Rincian tiap folder ada di `pipeline/README.md` dan `docs/arsitektur.md`.

---

## Tujuh aturan yang tidak boleh dilanggar

### 1. Skor hanya dihitung di `pipeline/s6_score.py`

Backend membaca tabel `location_scores`. Frontend menampilkan. LLM tidak pernah
menghitung apa pun. Kalau Anda menulis aritmetika skor di luar `s6_score.py`,
itu bug — cari tempat yang benar.

### 2. Data misi MAPID mentah tidak boleh keluar

Yang keluar dari API dan yang tampil di layar hanya agregat per heksagon. Sebelum
menambah endpoint, tanyakan: *bisakah respons ini dipakai merekonstruksi satu
baris survei?* Kalau ya, jangan dikirim. Melanggar ini berisiko diskualifikasi.

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
cd pipeline && python test_s4_spatial.py    # Commuter Clock + PriceLens

# Backend
cd backend && python tests/test_aturan.py   # aturan tampilan + skema alat AI
cd backend && python tests/test_ai_loop.py  # loop agentik, klien tiruan
cd backend && python tests/smoke_api.py     # 6 fitur ke Supabase, di-rollback
cd backend && uvicorn app.main:app --reload # http://localhost:8000/docs
cd backend && alembic upgrade head

# Frontend
cd frontend && npm run dev
cd frontend && npx tsc --noEmit && npx oxlint
```

## Verifikasi sebelum menyatakan selesai

- Menyentuh `s6_score.py` atau bobot → `test_s6_score.py` (11 uji, ρ > 0,85)
- Menyentuh pipeline jam/harga → `test_s4_spatial.py` (13 uji)
- Menyentuh backend → ketiga berkas di `backend/tests/` (96 asersi)
- Menyentuh frontend → `npx tsc --noEmit` dan `npx oxlint`
- Menyentuh model/skema → `alembic upgrade head` berhasil di basis data nyata
- Menambah endpoint → periksa ulang aturan 2 di atas, dan kalau ia
  MEREKOMENDASIKAN lokasi, wajib lewat `saring_zoneguard()`

---

## Status per 21 Agustus 2026

### Sudah selesai dan terverifikasi

| Bagian | Bukti |
|---|---|
| Skema basis data | 50 kolom di `hex_features` = 43 variabel + 3 penanda + kunci/geom/waktu, plus `hex_hourly_profiles`. Migrasi diterapkan ke Supabase |
| 5 modul API, 23 rute | Smoke test 56 asersi ke Supabase dalam transaksi yang di-rollback (0 baris tersisa) |
| Keenam fitur produk | PriceLens · AI Consultant · Commuter Clock · ZoneGuard · RiskRadar · GemFinder |
| AI Consultant | 12 alat mode strict, loop agentik, 26 asersi dengan klien tiruan |
| Mesin skoring | 11/11 uji lolos. Sensitivitas ρ 0,9719–0,9919 |
| Commuter Clock & PriceLens (pipeline) | 13/13 uji lolos |
| Prompt A1–A4 | Prompt produksi, sudah cocok dengan skema Pydantic |
| Frontend | 3 bagian wajib tersambung ujung ke ujung; basemap MAPID tampil |
| Dokumentasi | 7 dokumen di `docs/` |

### Belum dikerjakan — di sinilah pekerjaan berikutnya

| Hal | Yang menghalangi | Kalau sudah ada, kerjakan |
|---|---|---|
| **`KOLOM_*_GO` masih kosong** di `pipeline/config.py` | CSV misi asli belum diunduh | **Ini yang pertama.** Cocokkan nama kolom, lalu `s1`–`s2` bisa jalan |
| Badan `s1`, `s3`, `s5` dan sisa `s4` | Sebagian menunggu data, sebagian menunggu keputusan penyedia vision | Docstring-nya sudah memuat keputusan yang diambil — ikuti, jangan analisis ulang. `s4::profil_jam`, `belanja_per_jam`, dan `harga_sewa_per_m2` SUDAH jalan dan teruji |
| `LLM_API_KEY` belum diisi | Kunci belum ada | Isi di `backend/.env`, lalu `GET /ai/status` menyatakan siap. Kode `/ai/tanya` sudah lengkap |
| Frontend belum memakai endpoint baru | — | `/pricelens/*`, `/hex/{h3}/commuter-clock`, `/skor/kuadran`, `/skor/zoneguard/*` sudah siap dipakai |
| Sumber NJOP & RDTR definitif | Belum dipilih | Isi L01–L02, P01–P02 |
| Data survei lapangan | Tim survei | Setelah masuk, **ulangi uji sensitivitas** dan laporkan apa adanya |
| GeoJSON statis untuk Cloudflare | — | Mitigasi Render free tier, lihat `docs/arsitektur.md` |

Kerangka `s1`–`s5` **bukan TODO kosong**. Setiap docstring memuat keputusan yang
sudah diambil — ambang, urutan, jebakan yang harus dihindari. Isi badannya;
jangan mengulang analisisnya.

## Jebakan yang sudah kena — jangan diulang

| Gejala | Sebab | Perbaikan |
|---|---|---|
| Tile MAPID 404 di semua zoom | Endpoint raster/XYZ MAPID rusak di sisi server (sudah diverifikasi ke WMTS capabilities mereka) | Pakai jalur vector `style.json` — sebab itu MapLibre, bukan Leaflet |
| `does not provide an export named 'default'` | MapLibre v6 tidak punya default export | `import { Map as MapLibreMap } from 'maplibre-gl'` |
| Peta kosong tapi kontrol zoom terlihat | Rantai tinggi CSS tidak terselesaikan | Wadah `position: absolute; inset: 0` |
| **Semua tile gagal diam-diam, tanpa error di console** | Vite salah membundel worker internal MapLibre | `optimizeDeps: { exclude: ['maplibre-gl'] }` + hapus `node_modules/.vite` |
| `relation "idx_hex_features_geom" already exists` | GeoAlchemy2 sudah membuat indeks GiST lewat event DDL, autogenerate membuatnya lagi | Sudah permanen di `alembic/env.py::include_object` |
| `op.drop_table('spatial_ref_sys')` | Tabel sistem PostGIS ikut ter-autogenerate | Sama, `include_object` |
| Migrasi gagal: `geoalchemy2` tidak dikenal | Autogenerate tidak menulis impornya | Sudah permanen di `alembic/script.py.mako` |
| `KeyError: 'D05'` di `_tertimbang()` | Bobot berkunci KODE, DataFrame berkunci NAMA KOLOM | `KODE_KE_KOLOM` di `config.py` |
| `ModuleNotFoundError: No module named 'pipeline'` | Skrip pipeline dijalankan dari root | Jalankan dari dalam `pipeline/` |
| `int() argument must be ... not 'Query'` saat memanggil endpoint dari kode | `= Query(default=...)` membuat nilai bawaannya objek, bukan nilai | Pakai `Annotated[T, Query(...)] = nilai` |
| Rekomendasi memuat lokasi zona terlarang | Endpoint rekomendasi lupa `saring_zoneguard()` | Setiap jalur rekomendasi wajib melewatinya — diuji di `smoke_api.py` |

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
