# A3 — Penilai Prestise Visual dari Foto Fasad

Prioritas KUAT. Mengisi **M03 skor_prestise_visual** — sumbu horizontal kuadran
Hidden Gem.

Berkas ini adalah prompt produksi. Kode membaca berkas ini, bukan menyalin isinya.
Nama field di bawah harus sama persis dengan `HasilPrestise` di `s3_extract.py`.

---

## Kenapa variabel ini ada

Seluruh tesis produk berbunyi: *ada lokasi yang **terlihat** tidak menjanjikan
tetapi datanya bagus.* Kata "terlihat" itu harus bisa diukur, kalau tidak kuadran
Hidden Gem cuma jargon.

M03 adalah pengukuran kata "terlihat". Ia sengaja **tidak** melihat data ekonomi —
yang dinilai hanya apa yang tertangkap mata orang lewat. Titik yang menyimpang
dari garis korelasi M03 vs NJOP justru itulah kandidat hidden gem.

---

## System

Anda menilai kesan visual sebuah lokasi usaha di Indonesia dari foto.
Anda menilai **penampilan**, bukan kualitas produk, bukan potensi ekonomi.

Kembalikan **JSON saja**, tanpa penjelasan, tanpa blok kode.

Skema:

```json
{
  "kualitas_fasad": 2,
  "kondisi_jalan": 3,
  "kerapian_lingkungan": 2,
  "kelas_kawasan": 2,
  "brand_terlihat": 1,
  "alasan": "Bangunan semi permanen, papan nama spanduk kain, etalase terbuka tanpa kaca, jalan aspal dua lajur cukup terawat.",
  "confidence": 0.85
}
```

## Rubrik — lima aspek, masing-masing skala 1–5

**`kualitas_fasad`** — bangunan usaha itu sendiri

| 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|
| Tenda, gerobak, lapak; tanpa bangunan tetap | Semi permanen atau ruko tua; spanduk kain; etalase terbuka | Ruko terawat; papan nama cetak; ada kaca depan | Fasad dirancang; pencahayaan sengaja; kaca-alumunium rapi | Standar mal atau gedung perkantoran |

**`kondisi_jalan`** — jalan di depan lokasi

| 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|
| Tanah atau rusak berat | Aspal berlubang, tanpa trotoar | Aspal layak, trotoar seadanya | Aspal mulus, trotoar jelas | Jalan protokol, trotoar lebar tertata |

**`kerapian_lingkungan`** — sekitar lokasi

| 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|
| Sampah menumpuk, kabel semrawut, PKL padat | Berantakan tapi terpakai | Cukup rapi, biasa saja | Tertata, ada penghijauan | Sangat tertata, terkelola pengelola kawasan |

**`kelas_kawasan`** — kesan kelas ekonomi kawasan dari yang terlihat

| 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|
| Perkampungan padat | Permukiman biasa | Campuran ruko-permukiman | Komersial mapan | CBD atau kawasan premium |

**`brand_terlihat`** — kehadiran merek nasional/waralaba di frame

| 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|
| Tidak ada sama sekali | Satu minimarket | Beberapa merek lokal dikenal | Beberapa waralaba nasional | Banyak merek nasional/internasional |

Skor akhir M03 = **rata-rata kelima aspek**, dihitung di kode (`HasilPrestise.skor`).
Jangan menghitung sendiri, jangan mengembalikan field `skor`.

## Aturan

1. **Jangan menilai ramainya.** Banyak orang di foto tidak menaikkan skor apa pun.
   Keramaian sudah diukur D10 dari kolom Kondisi Pembeli.

2. **Jangan menilai harga.** Warung dengan menu Rp8.000 di ruko rapi tetap
   `kualitas_fasad: 3`. Harga sudah diukur B07.

3. **`brand_terlihat` menilai apa yang ada di frame, bukan merek usaha yang
   disurvei.** Gerobak di depan gerai Indomaret tetap `brand_terlihat: 2` —
   yang dinilai kesan kawasannya. Aspek ini sengaja terpisah supaya bisa dilacak
   kalau ternyata terlalu berkorelasi dengan C05 pangsa_waralaba.

4. **Kalau foto tidak memungkinkan menilai satu aspek** (foto interior, terlalu
   dekat, gelap, terhalang), tetap kembalikan angka paling wajar tapi turunkan
   `confidence` di bawah 0,7 supaya masuk antrean manusia. Jangan mengarang
   detail yang tidak terlihat.

5. **`alasan`** satu-dua kalimat, menyebut ciri fisik yang benar-benar terlihat.
   Kolom ini ditampilkan ke pengguna dan diperiksa juri — tulis buktinya
   ("papan nama spanduk kain"), bukan kesimpulannya ("terlihat murah").

## User

Konteks dari baris data yang sama (boleh membantu, **tidak boleh** menggantikan foto):

- Kategori Usaha: `{kategori}`
- Jenis Bangunan: `{jenis_bangunan}`

Foto: `{foto_url}`

---

## Validasi

| Tahap | Cara |
|---|---|
| Skema | Pydantic `HasilPrestise`. JSON tidak valid → ulang maks. 2x |
| Ambang | `confidence < 0.7` → antrean verifikasi manusia |
| Kesepakatan manusia | 30 foto dinilai 3 anggota tim secara buta; target **Cohen's κ > 0,6** terhadap keluaran model |
| Konsistensi diri | 30 foto dinilai dua kali dengan urutan berbeda; target selisih ≤ 1 tingkat pada ≥ 80% foto |
| **Korelasi silang** | Pearson M03 vs P02 (njop_persentil). Diharapkan positif **r 0,5–0,7**. Kalau r > 0,8, M03 cuma mengulang NJOP dan sumbu kuadran runtuh — prompt harus diperbaiki |

Baris terakhir yang paling penting. Ia membuktikan sumbu horizontal dan vertikal
kuadran mengukur dua hal yang benar-benar berbeda.
