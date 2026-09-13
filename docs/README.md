# Dokumentasi Loconomics

Mulai dari **[PRD.md](PRD.md)** untuk gambaran lengkap produk. Dokumen lainnya menjelaskan satu bagian secara mendalam.

| Berkas | Menjawab |
|---|---|
| **[PRD.md](PRD.md)** | Product Requirements Document: masalah, pengguna, tujuan, fitur dan kriteria penerimaan, data & AI, alur pengguna, rancangan sistem, kepatuhan ketentuan panitia |
| [arsitektur.md](arsitektur.md) | Kenapa MapLibre, susunan backend dan frontend, basis data, deployment |
| [data.md](data.md) | Kamus 43 variabel, sumbernya, aturan pembersihan, dan tabel pendukung |
| [skoring.md](skoring.md) | Rumus Opportunity Score, empat indeks, tiga metode Hidden Gem, uji sensitivitas bobot, skor blok |
| [ai.md](ai.md) | AI di pipeline (OCR foto, model perkiraan) dan di dalam produk (Loconomics AI) |
| [metadata.md](metadata.md) | Asal-usul setiap angka: mana yang diukur, mana yang diperkirakan, dan apa yang sengaja ditolak |
| [gambar/](gambar) | Tangkapan layar aplikasi |

## Peta dokumen ke kode

```
docs/data.md        ←→  backend/app/models.py, pipeline/config.py
docs/skoring.md     ←→  pipeline/s6_score.py  (satu-satunya tempat skor dihitung)
docs/ai.md          ←→  pipeline/prompts/*.md, backend/app/api/ai.py
docs/metadata.md    ←→  pipeline/s7_publish.py, frontend/src/components/SumberData.tsx
docs/arsitektur.md  ←→  backend/app/main.py, frontend/vite.config.ts
```
