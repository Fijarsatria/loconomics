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
pipeline/    Python s1→s7 — dari survei lapangan sampai ke basis data
             Satu-satunya tempat skor dihitung
backend/     FastAPI — 7 modul + tests/. Membaca basis data, tidak menghitung
frontend/    React + Vite + MapLibre GL — peta, insight, AI dalam satu layar
docs/        9 dokumen. Menjelaskan kenapa, bukan bagaimana
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
# Uji — tidak butuh basis data maupun data lapangan
cd pipeline && python test_s6_score.py     # mesin skoring
cd pipeline && python test_s4_spatial.py   # Commuter Clock + PriceLens
cd pipeline && python test_s7_publish.py   # jembatan ke basis data
cd backend  && python tests/test_aturan.py
cd backend  && python tests/test_infra.py  # galat, cache, pembatas

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

**Harga yang hanya ada di foto.** Dataset misi punya 8 kolom untuk properti dan
8 kolom untuk struk — tidak satu pun berisi rupiah. Angkanya ada di spanduk dan di
struk, dan PriceLens membacanya lewat OCR menjadi harga sewa per m² dan belanja
per jam yang bisa dibandingkan antarlokasi.

**AI yang menggerakkan peta.** Jawaban asisten tidak berhenti sebagai teks; ia
memanggil `flyTo`, `highlight`, `setLayer`, dan `filter` yang dieksekusi di
frontend. Petanya bergerak sendiri.

## Status

| Bagian | Status |
|---|---|
| Skema basis data (43 variabel + 3 penanda + profil jam) | Selesai, migrasi diterapkan |
| Backend — 7 modul, 46 rute | Selesai, 219 asersi lolos |
| Ketahanan produksi | Amplop galat, cache, pembatas laju, plafon biaya AI, GZip |
| Jembatan pipeline → basis data (`s7_publish`) | Selesai, termasuk ekspor GeoJSON statis |
| PriceLens · Commuter Clock · ZoneGuard · RiskRadar · GemFinder | Selesai di backend |
| AI Consultant — 12 alat, loop agentik | Selesai. Butuh `LLM_API_KEY` untuk aktif |
| Mesin skoring | Selesai — 14/14 uji lolos, sensitivitas ρ 0,97–0,99 |
| Prompt AI A1–A4 | Selesai |
| Frontend (3 bagian wajib) | Sistem visual + Kompas Kuadran + daftar + 3 grafik. Belum pernah dilihat render |
| Data demo | 708 heksagon lewat pipeline sungguhan (`pipeline/demo_seed.py`) |
| Pemanggil API vision (A1–A4) | Menunggu keputusan penyedia |
| Data survei lapangan | Menunggu tim survei |

Daftar lengkap yang belum dikerjakan beserta apa yang menghalanginya:
[docs/status.md](docs/status.md#belum-dikerjakan--di-sinilah-pekerjaan-berikutnya).

## Aturan yang mengikat

Empat hal yang berkonsekuensi diskualifikasi kalau dilanggar — rinciannya di
[docs/aturan-lomba.md](docs/aturan-lomba.md):

1. Data misi MAPID mentah tidak boleh keluar dari API maupun antarmuka
2. Kunci API lewat environment variable, tidak pernah di source
3. Data MAPID/mitra tidak boleh diredistribusi
4. Sumber terlarang: Google Places API, scraping listing, GTFS komunitas

Plus: basemap **hanya** MAPID Maps.
