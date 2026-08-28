# Dokumentasi Loconomics

Tujuh berkas. Dibaca berurutan, ketujuhnya menjawab: **apa yang dibangun, kenapa
begitu, dan apa yang belum diputuskan.**

## Urutan baca

| # | Berkas | Menjawab | Baca kalau |
|---|---|---|---|
| 1 | [alur-sistem.md](alur-sistem.md) | Bagaimana data mengalir dari lapangan sampai ke layar | Anda baru pertama kali melihat proyek ini |
| 2 | [produk.md](produk.md) | Apa yang sebenarnya dijual, untuk siapa, apa saja fiturnya | Anda mau tahu "kita membangun apa" |
| 3 | [data.md](data.md) | 43 variabel, dari mana asalnya, aturan pembersihannya | Anda menyentuh pipeline atau skema database |
| 4 | [skoring.md](skoring.md) | Rumus skor, bobot, dan kenapa bobotnya segitu | Anda mengubah `s6_score.py` atau ditanya juri soal metodologi |
| 5 | [ai.md](ai.md) | 14 fitur AI dalam 3 lapisan, mana yang wajib | Anda mengerjakan OCR, imputasi, atau AI Consultant |
| 6 | [arsitektur.md](arsitektur.md) | Kenapa MapLibre, kenapa modular monolith, batas free tier | Anda menyentuh backend, frontend, atau deployment |
| 7 | [aturan-lomba.md](aturan-lomba.md) | Ketentuan panitia yang mengikat kode | **Sebelum** menulis kode apa pun yang menyentuh data MAPID |

Kalau waktu Anda hanya lima menit: baca **alur-sistem.md bagian 1** dan
**aturan-lomba.md**. Yang pertama memberi gambaran, yang kedua mencegah
diskualifikasi.

## Peta dokumen ke kode

Setiap dokumen punya pasangan kodenya. Kalau salah satu berubah, pasangannya
harus ikut ditinjau.

```
docs/data.md        ←→  backend/app/models.py     (43 kolom + 3 penanda kualitas)
                        pipeline/config.py        (KODE_KE_KOLOM)
docs/skoring.md     ←→  pipeline/s6_score.py      (satu-satunya tempat skor dihitung)
                        pipeline/config.py        (semua BOBOT_*)
docs/ai.md          ←→  pipeline/prompts/*.md     (prompt produksi A1–A4)
                        backend/app/api/ai.py     (registri fungsi LLM)
docs/produk.md      ←→  frontend/src/components/  (tiga bagian wajib)
docs/arsitektur.md  ←→  backend/app/main.py, frontend/vite.config.ts
docs/aturan-lomba.md ←→ backend/app/schemas.py    (aturan ditegakkan di tipe)
```

## Konvensi

- **Bahasa Indonesia** untuk dokumen dan komentar kode; identifier kode juga
  Indonesia kecuali istilah yang sudah baku (`h3_index`, `opportunity_score`).
- **Kode variabel** (D01, B07, C06…) adalah identitas kanonik. Nama kolom adalah
  implementasinya. Jembatannya `KODE_KE_KOLOM` di `pipeline/config.py`.
- Dokumen menjelaskan **kenapa**; kode menjelaskan **bagaimana**. Kalau sebuah
  angka muncul di dokumen tanpa alasan, itu belum selesai ditulis.
