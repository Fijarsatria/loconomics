# Loconomics

**Transit-oriented Retail Recommender** — WebGIS pendukung keputusan untuk memilih
lokasi usaha di sekitar simpul transportasi massal Jabodetabek.

MAPID WebGIS Competition #2 2026 · tema *"Maps That Think! — Mass Transportation
Edition"* · Tim #33 dari Top 50 · Telkom University Bandung.

---

## Idenya

Orang memilih lokasi usaha dengan mata. Yang terlihat ramai dianggap bagus, yang
terlihat sepi dianggap buruk. Dua kesalahan lahir dari situ, dan Loconomics
menangani keduanya:

- **Hidden Gem** — lokasi yang *terlihat* biasa saja tetapi datanya bagus.
  Sewanya jauh lebih murah dan tidak ada yang melirik.
- **Jebakan Gengsi** — lokasi yang terlihat mahal dan bergengsi tetapi ekonominya
  tidak mendukung. Ini yang paling sering menghabiskan modal pemula.

Keduanya masalah yang sama dilihat dari dua arah: **tampilan dan data tidak selalu
sejalan.** Platform ini mengukur keduanya terpisah, lalu menunjukkan selisihnya —
sehingga tidak hanya merekomendasikan, tetapi juga melindungi.

## Struktur repositori

```
pipeline/    Python s1→s6 — mengubah survei lapangan jadi angka di peta
             Satu-satunya tempat skor dihitung
backend/     FastAPI — 4 modul. Membaca basis data, tidak menghitung
frontend/    React + Vite + MapLibre GL — peta, insight, AI dalam satu layar
docs/        7 dokumen. Menjelaskan kenapa, bukan bagaimana
CLAUDE.md    Panduan untuk sesi AI berikutnya
```

## Mulai dari mana

| Anda | Mulai dari |
|---|---|
| Baru melihat proyek ini | [docs/alur-sistem.md](docs/alur-sistem.md) |
| Mau tahu apa yang dibangun | [docs/produk.md](docs/produk.md) |
| Akan menulis kode | [CLAUDE.md](CLAUDE.md) lalu [docs/aturan-lomba.md](docs/aturan-lomba.md) |
| Mau menjalankan sesuatu | Bagian di bawah |

Indeks lengkap dokumentasi: [docs/README.md](docs/README.md).

## Menjalankan

```bash
# Uji mesin skoring — tidak butuh basis data maupun data lapangan
cd pipeline && python test_s6_score.py

# Backend  → http://localhost:8000/docs
cd backend
python -m venv venv && source venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env          # isi DATABASE_URL
alembic upgrade head
uvicorn app.main:app --reload

# Frontend → http://localhost:5173
cd frontend
npm install
cp .env.example .env          # isi VITE_MAPID_MAPS_API_KEY
npm run dev
```

## Yang membuat proyek ini berbeda

**IPTT — Indeks Permintaan Tak Terlayani.** Banyak pedagang keliling × pembeli
ramai ÷ sedikit usaha menetap. Artinya permintaan sudah terbukti ada tetapi belum
ada yang melayaninya secara permanen.

Bisa dihitung **hanya karena** data misi MAPID punya kolom Mobilitas dan kolom
Kondisi Pembeli. Tidak ada dataset komersial yang menyediakan keduanya — pedagang
keliling tidak pernah masuk ke peta mana pun.

**Commuter Clock.** Kapan uang benar-benar berpindah di suatu lokasi, dibaca dari
jam yang tercetak di struk. Dataset POI mana pun hanya menyimpan jam buka-tutup —
kapan toko buka, bukan kapan transaksi terjadi.

**AI yang menggerakkan peta.** Jawaban asisten tidak berhenti sebagai teks; ia
memanggil `flyTo`, `highlight`, `setLayer`, dan `filter` yang dieksekusi di
frontend. Petanya bergerak sendiri.

## Status

| Bagian | Status |
|---|---|
| Skema basis data (41 variabel + 3 penanda kualitas) | Selesai, migrasi diterapkan |
| 4 modul API | Selesai, semua endpoint sudah diuji langsung |
| Mesin skoring | Selesai — 11/11 uji lolos, sensitivitas ρ 0,97–0,99 |
| Prompt AI A1–A4 | Selesai |
| Frontend (3 bagian wajib) | Kerangka selesai, tersambung ke API |
| Pemanggil API vision | Menunggu keputusan penyedia |
| `POST /ai/tanya` | Mengembalikan 501 — penyedia LLM belum dipilih |
| Data survei lapangan | Menunggu tim survei |

Daftar lengkap yang belum dikerjakan beserta apa yang menghalanginya:
[CLAUDE.md](CLAUDE.md#belum-dikerjakan--di-sinilah-pekerjaan-berikutnya).

## Aturan yang mengikat

Empat hal yang berkonsekuensi diskualifikasi kalau dilanggar — rinciannya di
[docs/aturan-lomba.md](docs/aturan-lomba.md):

1. Data misi MAPID mentah tidak boleh keluar dari API maupun antarmuka
2. Kunci API lewat environment variable, tidak pernah di source
3. Data MAPID/mitra tidak boleh diredistribusi
4. Sumber terlarang: Google Places API, scraping listing, GTFS komunitas

Plus: basemap **hanya** MAPID Maps.
