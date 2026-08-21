# Pipeline Data Loconomics

Enam tahap berurutan yang mengubah data survei lapangan menjadi angka di peta.
Jalankan **dari dalam folder ini** (`cd pipeline`), bukan dari root repo — skrip
mengimpor `config` sebagai modul lokal.

```
s1_ingest  →  s2_clean  →  s3_extract  →  s4_spatial  →  s5_impute  →  s6_score
   unduh       bersihkan     foto→angka     ke heksagon    isi kosong     skor
```

## Kenapa urutannya begitu

| Tahap | Masuk | Keluar | Kenapa harus di posisi ini |
|---|---|---|---|
| **s1** `ingest` | CSV misi MAPID, OSM, RDTR, NJOP | `data/01_mentah/` | Salinan apa adanya. Tidak pernah diedit, supaya semua tahap sesudahnya bisa diulang dari nol |
| **s2** `clean` | `01_mentah/` | `data/02_bersih/` | Koordinat salah dan duplikat harus hilang **sebelum** foto diproses — memanggil API vision untuk baris duplikat itu membakar biaya percuma |
| **s3** `extract` | foto + `02_bersih/` | `data/cache_ai/` | Di sinilah rupiah lahir. Tanpa tahap ini proyek ini tidak punya satu pun angka harga |
| **s4** `spatial` | `02_bersih/` + `cache_ai/` | `data/03_olahan/` | Baru setelah data bersih dan berangka, ia boleh diagregasi ke heksagon H3 res-9. Juga membangun profil per jam (Commuter Clock) |
| **s5** `impute` | `03_olahan/` | `03_olahan/` | Imputasi butuh tetangga spasial, jadi harus setelah s4 |
| **s6** `score` | `03_olahan/` | tabel `location_scores` | Satu-satunya tempat skor dihitung di seluruh proyek |

## Menjalankan

```bash
cd pipeline
python -m venv venv && source venv/Scripts/activate   # Git Bash di Windows
pip install -r requirements.txt

python s1_ingest.py
python s2_clean.py
python s3_extract.py
python s4_spatial.py
python s5_impute.py
python s6_score.py
```

Uji mesin skoring — tidak butuh database, tidak butuh data lapangan:

```bash
python test_s6_score.py          # skoring: ringkasan + tabel sensitivitas
python test_s4_spatial.py        # Commuter Clock + PriceLens
python -m pytest test_s6_score.py test_s4_spatial.py -v
```

## Status kesiapan

| Berkas | Status |
|---|---|
| `config.py` | **Siap.** Kecuali `KOLOM_*_GO` — masih kosong, menunggu CSV asli |
| `s6_score.py` | **Siap & teruji.** 11/11 uji lolos, sensitivitas ρ 0,97–0,99 |
| `s4_spatial.py` — Commuter Clock & PriceLens | **Siap & teruji.** `profil_jam()`, `belanja_per_jam()`, `harga_sewa_per_m2()`, 13/13 uji |
| `test_s6_score.py`, `test_s4_spatial.py` | **Siap.** |
| `prompts/a1`–`a4` | **Siap.** Prompt produksi, sudah cocok dengan skema Pydantic di `s3_extract.py` |
| `s2_clean.py` | Sebagian — aturan 9.1–9.6 tertulis, `bersihkan_koordinat()` sudah jalan |
| `s1`, `s3`, `s5`, sisa `s4` | Kerangka. Badan fungsi sengaja `NotImplementedError` dengan alasan lengkap di docstring |

Kerangka itu bukan TODO kosong. Setiap docstring berisi keputusan yang sudah
diambil — ambang, urutan, jebakan yang harus dihindari — supaya siapa pun yang
mengisinya tidak perlu mengulang analisisnya.

## Dua hal yang mudah terlewat

**1. `KOLOM_MENU_GO` / `KOLOM_STRUK_GO` / `KOLOM_PROPERTI_GO` masih kosong.**
Nama kolom di CSV misi MAPID sering berbeda dari yang tertulis di PDF ketentuan:
ada spasi tambahan, kapitalisasi berbeda, atau disingkat. **Cocokkan dulu sebelum
menjalankan skrip apa pun.** Satu jam di awal menghemat berjam-jam debugging.

**2. `data/cache_ai/` tidak boleh dikosongkan menjelang demo.**
Semua hasil panggilan model vision di-cache di sana. Memanggil ulang API saat
demo berarti membayar dua kali dan mempertaruhkan demo pada koneksi internet
panitia.

## Aturan yang berlaku di seluruh pipeline

- **`config.py` adalah sumber kebenaran tunggal.** Jangan pernah menulis ulang
  ambang, bobot, atau nama kolom langsung di dalam skrip. Kalau ada di dua tempat,
  cepat atau lambat keduanya berbeda dan hasil analisis tidak bisa direproduksi.
- **Kosong tetap kosong.** `NaN` tidak pernah diisi nol. "Nol transaksi tercatat"
  dan "belum ada yang mensurvei di sini" adalah dua pernyataan berbeda.
- **Prompt AI hidup sebagai berkas di `prompts/`**, bukan string di dalam kode.
  Perubahannya tercatat di git, dan berkas itu sekaligus bukti untuk ketentuan
  lomba C.1 tentang penjelasan proses AI.
- **`confidence < 0,7` tidak pernah dipakai langsung** — masuk antrean verifikasi
  manusia.
- **Skor hanya dihitung di `s6_score.py`.** Backend tidak menghitung, frontend
  tidak menghitung, LLM sama sekali tidak boleh menghitung.

## Folder data

```
data/
├── 01_mentah/    hasil unduh apa adanya — JANGAN diedit
├── 02_bersih/    setelah s2_clean
├── 03_olahan/    siap masuk database
└── cache_ai/     hasil s3_extract — jangan dihapus menjelang demo
```

Seluruh isi `data/` tidak masuk git: berisi data misi MAPID yang tidak boleh
diredistribusi ke pihak luar (ketentuan lomba B.7).
