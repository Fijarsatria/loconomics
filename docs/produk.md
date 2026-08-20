# Produk

## Satu kalimat

**Loconomics** membantu calon pelaku UMKM memilih lokasi usaha di sekitar simpul
transportasi massal Jabodetabek, dengan menunjukkan lokasi yang **terlihat** biasa
saja tetapi datanya bagus — dan memperingatkan lokasi yang sebaliknya.

Nama lengkap: *Transit-oriented Retail Recommender*.
Tema lomba: **Maps That Think! — Mass Transportation Edition**.

## Masalah yang dituju

Orang memilih lokasi usaha dengan mata. Yang terlihat ramai dianggap bagus, yang
terlihat sepi dianggap buruk. Dua kesalahan lahir dari situ:

1. **Hidden Gem terlewat.** Lokasi dengan permintaan nyata tapi tampilan biasa
   tidak pernah dilirik, padahal sewanya jauh lebih murah.
2. **Jebakan Gengsi.** Lokasi yang terlihat mahal dan bergengsi disewa dengan
   harga premium, padahal ekonominya tidak mendukung. Ini yang paling sering
   menghabiskan modal pemula.

Keduanya adalah masalah yang sama dilihat dari dua arah: **tampilan dan data
tidak selalu sejalan.** Produk ini mengukur keduanya secara terpisah, lalu
menunjukkan selisihnya.

## Kuadran — inti seluruh produk

Sumbu tegak = **Skor Peluang** (data ekonomi).
Sumbu datar = **Prestise Visual** (bagaimana lokasi terlihat, dari M03).

```
Skor Peluang
    ▲
    │   HIDDEN GEM        │   PEMENANG JELAS
    │   data bagus,       │   data bagus,
    │   tampilan biasa    │   tampilan mahal
    │   → peluang         │   → aman tapi mahal
    ├─────────────────────┼─────────────────────
    │   HINDARI           │   JEBAKAN GENGSI
    │   dua-duanya rendah │   tampilan mahal,
    │                     │   data tidak mendukung
    │                     │   → paling berbahaya
    └─────────────────────┴────────────────────▶ Prestise Visual
```

Kuadran **Jebakan Gengsi** sengaja ditampilkan, bukan disembunyikan. Itu yang
membuat platform ini tidak hanya merekomendasikan, tetapi juga melindungi — dan
itu pembeda yang paling mudah dijelaskan ke juri dalam satu kalimat.

Supaya kuadran ini bermakna, kedua sumbu harus benar-benar mengukur hal berbeda.
Karena itu M03 dinilai hanya dari foto, tanpa melihat data ekonomi sama sekali,
dan korelasinya terhadap NJOP diuji (target r 0,5–0,7; kalau > 0,8 sumbunya
runtuh). Lihat [ai.md](ai.md) dan `pipeline/prompts/a3_prestise.md`.

## Pengguna

| Siapa | Yang dicari | Yang paling menolong |
|---|---|---|
| Calon pemilik UMKM | "Di mana saya sebaiknya buka?" | GemFinder, PriceLens, ZoneGuard |
| Pemilik usaha yang mau pindah/ekspansi | "Apakah lokasi baru ini lebih baik?" | Bandingkan, RiskRadar |
| Peneliti / perencana kota | "Kawasan mana yang permintaannya belum terlayani?" | IPTT, Commuter Clock |

## Enam kawasan pilot

Ruang lingkup dikunci. Melebarkan wilayah lebih berbahaya daripada terlihat:
setiap kawasan tambahan butuh survei lapangan sendiri, dan heksagon tanpa survei
hanya akan berbadge RENDAH.

| Kawasan | Moda | Kenapa dipilih |
|---|---|---|
| Manggarai | KRL | Simpul tersibuk, transit murni |
| Tanah Abang | KRL | Perdagangan padat, kompetisi ekstrem |
| Depok Baru | KRL | Kawasan mahasiswa, pola belanja berbeda |
| Bekasi | KRL | Komuter jarak jauh, kepadatan sedang |
| Dukuh Atas BNI | MRT | CBD, prestise tertinggi — penguji Jebakan Gengsi |
| Harjamukti | LRT | Moda terbaru, kawasan belum matang — penguji Hidden Gem |

Dua yang terakhir dipilih justru karena ekstrem: kalau kuadran bekerja, Dukuh Atas
harus penuh Jebakan Gengsi dan Harjamukti harus penuh Hidden Gem. Itu uji
kewarasan model yang paling cepat.

## Enam fitur bernama

| Fitur | Apa yang dilakukan | Variabel utama | Kriteria diterima |
|---|---|---|---|
| **PriceLens** | Menunjukkan harga wajar sewa & harga jual di kawasan itu | P05, B07, B08 | Median sewa muncul untuk ≥ 80% heksagon berbadge SEDANG/TINGGI |
| **RiskRadar** | Menandai kuadran Jebakan Gengsi | Skor Peluang × M03 | Daftar tersaji terurut, tiap baris menyebut alasannya |
| **GemFinder** | Menandai Hidden Gem | Residual biaya, IPTT, kuadran | Hanya menampilkan lokasi yang lolos **≥ 2 dari 3** metode |
| **ZoneGuard** | Menolkan skor di zona yang melarang usaha | L01 (gate) | Heksagon `zona_izin_komersial = FALSE` selalu berskor 0 |
| **Commuter Clock** | Kapan uang benar-benar berpindah di lokasi itu | B01–B04 | Empat rentang jam tergambar dari jam di struk, bukan jam buka toko |
| **AI Consultant** | Menjawab dengan bahasa biasa **dan menggerakkan peta** | 7 fungsi | Jawaban menyertakan `sumber_angka`; minimal satu aksi peta tereksekusi |

Dua fitur pendukung tanpa nama pemasaran:

- **GapFill** — imputasi ML untuk heksagon minim survei. Hasilnya **selalu**
  ditandai `predicted` dan digambar lebih transparan di peta.
- **Indeks Churn (P06)** — seberapa sering usaha berganti di suatu titik. Churn
  tinggi = lokasi yang terus-menerus membunuh penyewanya, sinyal yang tidak
  tertangkap variabel mana pun.

## Metrik orisinal: IPTT

**Indeks Permintaan Tak Terlayani.**

```
banyak pedagang KELILING × pembeli RAMAI
────────────────────────────────────────
     sedikit usaha MENETAP
```

Artinya: permintaan sudah terbukti ada — orang membeli di sana setiap hari —
tetapi belum ada yang melayaninya secara permanen.

Ini bisa dihitung **hanya karena** data misi MAPID punya kolom Mobilitas dan
kolom Kondisi Pembeli. Tidak ada dataset komersial mana pun yang menyediakan
keduanya; pedagang keliling tidak pernah masuk ke peta apa pun. Kalau ada satu
hal yang tidak bisa ditiru tim lain tanpa data yang sama, ini dia.

## Tiga bagian wajib di layar

Ketentuan lomba mensyaratkan tiga bagian. Ketiganya tampil bersamaan, bukan
berpindah halaman:

1. **Peta Interaktif** — `frontend/src/components/PetaInteraktif.tsx`
2. **Insight / Analisis** — `frontend/src/components/PanelInsight.tsx`
3. **Antarmuka AI** — `frontend/src/components/PanelAI.tsx`

Alasannya bukan estetika. AI menggerakkan peta → peta memilih heksagon → heksagon
mengisi panel insight. Kalau ketiganya terpisah halaman, rantai itu putus dan
demo kehilangan alurnya.

## Yang sengaja TIDAK dibangun

Menuliskannya sama pentingnya dengan menuliskan yang dibangun.

- **Bukan marketplace properti.** Tidak ada listing, tidak ada transaksi.
- **Bukan prediksi omzet.** Data yang ada tidak cukup untuk itu, dan menjanjikannya
  akan langsung dipatahkan juri.
- **Tidak melebar ke luar 6 kawasan pilot** dalam siklus lomba ini.
- **Tidak menampilkan data misi mentah** — dilarang ketentuan B.7, lihat
  [aturan-lomba.md](aturan-lomba.md).
