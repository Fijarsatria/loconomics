# Loconomics — Transit-oriented Retail Recommender

> WebGIS Decision Support System yang merekomendasikan lokasi usaha UMKM terbaik di sekitar simpul transportasi massal darat Jabodetabek.
> Entri **Tim Loconomics** (#33 dari Top 50) untuk **MAPID WebGIS Competition #2 — 2026**, tema *Maps That Think! — Mass Transportation Edition*.

**Folder ini adalah workspace WebGIS Developer.** Dokumen perencanaan tim ada di Google Workspace (lihat [Tautan penting](#-tautan-penting)).

---

## 📌 Ringkasan satu paragraf

Pelaku UMKM memilih lokasi pakai **mata**, bukan **data** — mereka berebut di titik yang terlihat ramai, padahal di situ sewa paling mahal dan pesaing paling padat. Loconomics memetakan kawasan transit ke dalam **heksagon H3 resolusi 9** (±0,10 km²) dan **isochrone jalan kaki nyata** (5/10/15 menit), lalu memberi setiap heksagon **Opportunity Score** dan **Hidden Gem Score**. Hasilnya: menghindari **Jebakan Gengsi** (mahal tapi lemah secara ekonomi) dan menemukan **Hidden Gem** (biasa saja secara visual, tinggi secara data).

---

## 👥 Tim

| Nama | Peran |
|---|---|
| Irvan Tegar Yunadi | Business Analyst & Team Lead |
| Azziz Abdul Ghofur | Data Analyst |
| Ukasyah | AI Engineer |
| Wili Franklyn Togatorop | UI/UX Designer |
| **Fijar Satria Pinandita M.** | **WebGIS Developer** ← pemilik folder ini |

Institusi: Telkom University Bandung · Lisensi GEO MAPID sudah diklaim (username `irvanty`)

---

## 🗺️ Enam kawasan pilot

Analisis dibatasi ke enam kawasan ini saja — jangan melebar:

`Manggarai` · `Tanah Abang` · `Depok Baru` · `Bekasi` · `Dukuh Atas BNI` · `Harjamukti`

Batas cakupan tiap kawasan = area dalam jangkauan **jalan kaki maksimal 15 menit** dari titik transit utama.

---

## ✨ Fitur produk & acceptance criteria

Ini kontrak yang harus dipenuhi frontend/backend. Fitur dianggap "belum selesai" kalau kriterianya belum terpenuhi.

| Fitur | Acceptance Criteria |
|---|---|
| **PriceLens** (Peta Harga) | Pengguna bisa melihat rata-rata harga sewa per m² dan belanja per jam per heksagon, hasil ekstraksi AI OCR |
| **RiskRadar** (Jebakan Gengsi) | Peta menampilkan label peringatan + diagram kuadran interaktif saat Indeks Churn melewati ambang wajar |
| **GemFinder** | WebGIS memunculkan **minimal 10 heksagon teratas** berskor Hidden Gem beserta ringkasan alasannya |
| **ZoneGuard** (Zonasi) | Heksagon di kawasan larangan usaha (RDTR) otomatis jadi **pengali skor nol** dan tidak direkomendasikan |
| **Commuter Clock** | Grafik pola jam operasional 05.00–22.00 yang memisahkan *captive rider* vs *choice rider* di kartu detail heksagon |
| **AI Consultant** | Panel chat merespons bahasa alami **dan** berhasil men-trigger `flyTo`, `highlight`, `setLayer`, atau `filter` di peta |

Dua nama lain yang muncul di dokumen tim:
- **GapFill** — model Random Forest / Gradient Boosting untuk mengisi variabel yang hilang
- **Indeks Churn** — sinyal peringatan dini tingkat gulung tikar di suatu area

---

## 🏗️ Arsitektur & stack

```
Pengguna ──▶ Frontend (Cloudflare Pages)
                │  React + Vite + TypeScript + Tailwind
                │  React Leaflet / MapLibre GL JS  +  Basemap MAPID MAPS
                ▼
             Backend (Render)  ── FastAPI, modular monolith
                │                  SQLAlchemy + GeoAlchemy2 + Alembic + Pydantic
                ├──▶ Database (Supabase) — PostgreSQL + PostGIS, index GiST
                └──▶ AI Router / LLM API  (function calling saja, tanpa hitung angka)

        [OFFLINE — tidak jalan saat user membuka web]
        MAPID API · OSM · GTFS · WorldPop · BPS · RDTR ──▶ pipeline ingest & scoring
```

**Layer analisis (`training/`):** Pandas, GeoPandas, h3-py, OSMnx, scikit-learn. Open source saja — QGIS/GEE boleh, ArcGIS tidak dipakai.

### Tabel inti database

`transport_nodes` · `catchment_areas` · `h3_cells` / `hex_features` · `business_pois` · `menu_observations` · `receipt_observations` · `property_observations` · `location_scores` · `score_factors`

`hex_features` adalah tabel pusat: **41 variabel analisis + 3 flag kualitas** per heksagon.

### Yang sengaja TIDAK dipakai di MVP

Next.js · microservices · GeoServer · vector tiles · analisis real-time · login/user profile · Docker. GeoJSON sudah cukup.

---

## 🧮 Model skoring

Semua input dinormalisasi min-max ke [0,1]; hitungan berekor panjang di-`log(1+x)` dulu.

```
IPT (Potensi Transit)           = 0.40·D05 + 0.35·D06 + 0.25·(1 − D04)
IAE (Aktivitas Ekonomi)         = 0.30·D11 + 0.25·D10 + 0.25·B07 + 0.20·B09
IKP (Kompetisi, ↑ = buruk)      = 0.45·C06 + 0.30·C05 + 0.25·(1 − C03)
IBR (Biaya & Risiko, ↑ = buruk) = 0.35·P01 + 0.30·P05 + 0.25·P06 + 0.10·L03

OPPORTUNITY SCORE = 0.35·IPT + 0.35·IAE − 0.20·IKP − 0.10·IBR
                    × 0   jika L01 (zona_izin_komersial) == FALSE   ← ZoneGuard, gate hukum
```

**Hidden Gem** harus lolos lebih dari satu metode independen:

```
IPTT = norm(rasio_keliling) × norm(skor_ramai_terkoreksi) ÷ (1 + norm(n_menetap_kuliner))

HIDDEN_GEM_SCORE = 0.40·norm(−residual)
                 + 0.30·norm(IPTT)
                 + 0.30·norm(Opportunity × (1 − prestise_visual))
```

Bobot diuji sensitivitasnya: tiap bobot digeser ±0,10, korelasi Spearman peringkat harus tetap > 0,85.

---

## 🔒 Tiga aturan yang mengikat arsitektur

**1. LLM tidak pernah menghitung angka.** Ia hanya memanggil fungsi backend lalu menarasikan nilai yang dikembalikan. Tegakkan ini di batas API.

```
cari_lokasi(jenis_usaha, budget, radius_transit, tipologi)
bandingkan(hex_a, hex_b)
jelaskan_skor(hex_id)
flyTo(lat, lon, zoom) · highlight(hex_ids) · setLayer(nama_layer) · filter(kriteria)
```

**2. Setiap respons heksagon wajib membawa badge kepercayaan:** `n_titik_misi`, `tingkat_keyakinan` (TINGGI/SEDANG/RENDAH), `data_source` (`observed` | `predicted`). Menampilkan skor tanpa badge tidak dapat diterima — sebagian besar heksagon adalah hasil imputasi ML, bukan observasi.

**3. Precompute.** Sel H3 dan isochrone dihitung offline lalu disimpan. Backend tidak boleh menghitung ulang routing jaringan jalan saat peta dimuat.

---

## ✅ Wajib dipenuhi (aturan panitia)

- [ ] **MAPID MAPS jadi basemap utama** — API key lewat *environment variable*, **tidak boleh** di-hardcode
- [ ] Peta interaktif jadi elemen utama: zoom, klik objek, filter, tabel lokasi, tabel atribut, layer control
- [ ] **AI hadir di dalam antarmuka WebGIS**, bukan cuma di pipeline backend
- [ ] Minimal tiga bagian: Peta Interaktif + Insight + AI Interface
- [ ] Ter-deploy publik, responsif di desktop & mobile, waktu muat wajar
- [ ] Setiap unggahan survei mencantumkan tagar **#Loconomics**
- [ ] **Data mentah misi MAPID tidak boleh terekspos** lewat API publik atau tabel UI — hanya hasil agregat level heksagon
- [ ] Data mentah MAPID/mitra tidak diredistribusi ke pihak luar

> ⚠️ WebGIS yang hanya menampilkan data tanpa analisis/insight **didiskualifikasi** secara eksplisit.

---

## 📅 Timeline pengembangan (8 minggu, 7 Agustus – 14 September 2026)

| Minggu | Fokus | Target output | Porsi WebGIS Dev |
|:--:|---|---|:--:|
| M1 | Data Collection & Survey Lapangan | Survei 6 kawasan via MAPID Apps tuntas, data OSM/sekunder ditarik, setup React Leaflet/MapLibre | 🟡 setup |
| M2 | AI Pipeline (PriceLens) & Database | OCR spanduk/struk bekerja, laporan akurasi awal, struktur PostGIS terisi | 🟢 DB |
| M3 | Spatial Analysis & ML Imputation | Kalkulasi H3 + isochrone, model GapFill di-*train*, tabel `location_scores` siap | 🟢 penuh |
| M4 | Frontend WebGIS Development | Peta interaktif, layer, filter, tabel heksagon ter-render, tautan pratayang tersedia | 🟢 penuh |
| M5 | AI Consultant & Dashboard | LLM router beroperasi, komponen B.2 (GemFinder, RiskRadar, panel AI) tampil | 🟢 penuh |
| M6 | Refinement & Uji Lintas Perangkat | Perapian UI/UX Tailwind, validasi keluaran GapFill, uji fungsi spasial AI Consultant | 🟢 penuh |
| M7 | Final Validation & Documentation | Laporan validasi AI selesai, dokumentasi workflow terpublikasi di web | 🟡 sebagian |
| M8 | Deployment & Release Publik | WebGIS live, demo, seluruh lampiran (video, dokumen final) tuntas | 🟢 penuh |

---

## ⚠️ Risiko yang sudah dipetakan

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Basemap MAPID (vector) tidak cocok dengan React Leaflet | Peta interaktif terhambat sejak awal | **Uji MapLibre GL JS di minggu-1** untuk mengamankan timeline UI layer |
| OCR gagal karena silau / foto buram | Angka pricing & spend korup → merusak IAE dan IBR | Filter *confidence level*; nilai yang ditolak dikosongkan, lalu diisi GapFill |
| Trafik melonjak saat penjurian, free tier habis | Render/Supabase down atau lambat | Precompute skor & isochrone, simpan sebagai **GeoJSON statis di CDN Cloudflare** |
| Data RDTR absen di sebagian wilayah | Analisis ZoneGuard bolong | Tandai eksplisit "Kawasan tanpa RDTR Digital" + disklaimer manual |

---

## 📂 Dataset dasar

| Dataset | Sumber | Fungsi |
|---|---|---|
| Base Data & Community Maps | MAPID | Titik acuan POI, validasi silang lokasi usaha |
| Properti Go | Survey Team | Foto spanduk & detail properti → Indeks Churn + estimasi sewa via OCR |
| Struk Go | Survey Team | Foto struk → estimasi belanja rata-rata & pola jam transaksi per heksagon |
| Menu Go | Survey Team | Struktur harga pasar, kepadatan pengunjung, referensi jenis usaha |
| Road Network / POI | OpenStreetMap | Dasar perhitungan isochrone + basis data kompetitor |
| Kependudukan | BPS, WorldPop | Indikator permintaan komuter & proksi kepadatan aktivitas |
| RDTR / Zonasi | Pemerintah Daerah | Filter mutlak kepatuhan (ZoneGuard) |
| GTFS resmi | PT KAI / KCIC / MRT | Lokasi simpul, headway, jam operasi → pembentuk IPT |

Sumber tambahan dari laporan data: Overture Places, Google Open Buildings, NJOP (Jakarta Satu), InaRISK (banjir).

---

## 🚧 Yang masih menggantung

- [ ] **Dokumentasi API data MAPID** belum ditemukan di materi tim — kemungkinan ada di folder Drive TOP 50 (subfolder *Technical Meeting* / *Coaching AI*)
- [ ] **PRD bagian 7 (AI Integration)** masih instruksi kosong — butuh bagan alur input AI → backend/AI Router → output WebGIS
- [ ] **PRD bagian 8 (Technology Architecture)** butuh diagram User ↔ Frontend ↔ Backend ↔ Database ↔ MAPID API ↔ AI Router
- [ ] **PRD bagian 9 (Wireframe)** belum diisi — menunggu Wili (UI/UX)
- [ ] **Keputusan React Leaflet vs MapLibre** harus diambil di minggu-1, bergantung format basemap MAPID MAPS
- [ ] Sebagian dokumen lama masih memakai nama **STATIONOMICS** — nama resmi sekarang **Loconomics**

---

## 🔗 Tautan penting

Hub koordinasi: [Spreadsheet **Lomba WebGIS**](https://docs.google.com/spreadsheets/d/1YWRSRFg7AeQPUw6iaAeRsraRFj4B9tH6CGd-MFs8xOw/edit) — 6 tab: Brainstorming · Brainstorm per role · Pembagian jobdesk proposal · **Jobdesk selama lomba** · AI Enginner · Mastersheet

| Dokumen | Tautan |
|---|---|
| **PRD Loconomics** ✅ sudah terisi | [dokumen](https://docs.google.com/document/d/1e3VJIpxkNUzQTl7qMrHbh8rHI5QmvU00125SuyzJR5A/edit) |
| Struktur Proposal Loconomics | [dokumen](https://docs.google.com/document/d/1_Inbb7qvHELw72nX0sy_R13uSx9VfKM4F2gnIq1Bobw/edit) |
| Template PRD (rujukan panitia) | [dokumen](https://docs.google.com/document/d/1L7HVb1TZyNUhc1zzPwQ5D8GVNhz3MQwykJFv0Jh7_P4/edit) |
| Ketentuan Data & WebGIS (aturan resmi) | [dokumen](https://docs.google.com/document/d/1RiS49NJEBWeqE9s-Xw-hilo9x4ZSShm5oTdstDymn9I/edit) |
| Laporan data Ajis (kamus 41 variabel) | [dokumen](https://docs.google.com/document/d/1lR1K_EToViqVzNb_gzGEecGj6cTUeefJ5Bn5DpTpnOI/edit) |
| Flowchart AI WebGIS | [dokumen](https://docs.google.com/document/d/1x0tOBHCiViqf-eAgaW5G2kvMCIVoAJ4PuDsVFJ5n8lI/edit) |
| Dokumen keputusan stack (Fijar) | [dokumen](https://docs.google.com/document/d/1PUXTT0DXC_W8TAMNoTJhc_PjWhU_XqkNIc6j2bsvFCM/edit) |
| Konsep AI (Ukas) | [dokumen](https://docs.google.com/document/d/1UqSmqC8r3fG2kkKhVFcvvGp2Col6G2boY3L3xxcchoY/edit) |
| Desain Figma | [figma](https://www.figma.com/design/Ov1amONHjfKAIo80814O8V/Lomba-WebGIS) |
| Riset bisnis (Figma board, Irvan) | [figma](https://www.figma.com/board/2lxmbZSNY76fypNsjVkVba/Riset-Bisnis-WebGIS) |
| Rekaman briefing MAPID TOP 50 | [drive](https://drive.google.com/drive/folders/1wKI9QuyiQkc3LBGczJQOhoTotr49HRhf) |

---

## 📖 Dokumen lain di folder ini

- **[Alur Sistem Loconomics.md](./Alur%20Sistem%20Loconomics.md)** — penjelasan alur sistem 10 tahap dari sudut pandang WebGIS Developer, lengkap dengan diagram dan penjelasan di mana AI serta API MAPID masuk.
