# Skoring

> **Satu-satunya tempat skor dihitung di seluruh proyek adalah
> `pipeline/s6_score.py`.** Backend tidak menghitung — ia membaca tabel
> `location_scores`. Frontend tidak menghitung — ia menampilkan. LLM sama sekali
> tidak boleh menghitung. Kalau aritmetika skor muncul di berkas lain, itu bug.

## Alur

```
41 variabel
    ↓ norm()                     min-max ke [0,1]; log1p untuk variabel berekor panjang
4 indeks komposit                IPT · IAE · IKP · IBR
    ↓ jumlah tertimbang
Skor Peluang mentah
    ↓ norm × 100, lalu ZoneGuard
Skor Peluang 0–100
    ↓ 3 metode
Hidden Gem Score + Kuadran
```

## Normalisasi

Min-max ke [0,1] per kawasan. Empat belas variabel berekor panjang (populasi,
NJOP, harga, kepadatan) ditransformasi `log(1+x)` lebih dulu — daftarnya
`BEREKOR_PANJANG` di `s6_score.py`. Tanpa itu beberapa lokasi ekstrem mendominasi
seluruh skala dan sisanya menggumpal di dekat nol.

**NaN tetap NaN sepanjang normalisasi.** Baru saat masuk jumlah tertimbang, nilai
yang hilang dinetralkan jadi **0,5** — tengah skala, bukan nol. Nol berarti
"terburuk yang pernah diamati"; itu hukuman untuk lokasi yang kesalahannya cuma
belum disurvei.

## Empat indeks komposit

Sufiks `_inv` berarti variabel dibalik (`1 − norm(x)`): arahnya terbalik terhadap
indeksnya.

### IPT — Indeks Potensi Transit *(tinggi = baik)*

| Bobot | Variabel |
|---|---|
| 0,40 | D05 `skor_simpul` |
| 0,35 | D06 `ridership_proksi` |
| 0,25 | D04 `waktu_jalan_menit` **(dibalik)** — makin lama makin buruk |

### IAE — Indeks Aktivitas Ekonomi *(tinggi = baik)*

| Bobot | Variabel |
|---|---|
| 0,30 | D11 `intensitas_transaksi` |
| 0,25 | D10 `skor_ramai_terkoreksi` |
| 0,25 | B07 `harga_median_porsi` |
| 0,20 | B09 `nominal_median_struk` |

### IKP — Indeks Kompetisi *(tinggi = BURUK)*

| Bobot | Variabel |
|---|---|
| 0,45 | C06 `rasio_kompetitor_per_kapita` |
| 0,30 | C05 `pangsa_waralaba` |
| 0,25 | C03 `keragaman_usaha` **(dibalik)** |

Keragaman dibalik karena kawasan yang seragam justru lebih ketat: sepuluh warung
yang menjual hal yang sama saling memakan, sepuluh usaha berbeda tidak.

### IBR — Indeks Biaya & Risiko *(tinggi = BURUK)*

| Bobot | Variabel |
|---|---|
| 0,35 | P01 `njop_m2` |
| 0,30 | P05 `harga_sewa_median` |
| 0,25 | P06 `indeks_churn` |
| 0,10 | L03 `risiko_banjir` |

## Skor Peluang

```
mentah  = 0,35·IPT + 0,35·IAE − 0,20·IKP − 0,10·IBR
skor    = norm(mentah) × 100
skor    = 0  bila zona_izin_komersial == FALSE      ← ZoneGuard
```

Potensi (IPT, IAE) berbobot positif; hambatan (IKP, IBR) negatif. Potensi dan
aktivitas diberi bobot sama besar karena keduanya harus ada — simpul ramai tanpa
aktivitas ekonomi hanya berarti orang lewat, aktivitas tanpa akses transit tidak
sesuai tema lomba.

**ZoneGuard adalah gate, bukan bobot.** Ia dijalankan *setelah* skor dihitung dan
menolkannya sepenuhnya. Kalau ia hanya sebuah bobot negatif, lokasi yang sangat
bagus di zona terlarang tetap muncul di peringkat atas — dan merekomendasikan
lokasi ilegal adalah kesalahan yang jauh lebih mahal daripada melewatkan satu
lokasi bagus.

Perhatikan `zona_izin_komersial.eq(False)`, bukan `~.eq(True)`: heksagon `NULL`
(kawasan tanpa RDTR digital) **tidak** ikut ternol. Ia ditandai terpisah di
antarmuka.

## Hidden Gem — tiga metode

Sebuah lokasi baru disebut Hidden Gem kalau lolos **minimal 2 dari 3** metode.
Yang diambil irisannya, bukan gabungannya. Kalau gabungan, hampir semua heksagon
akan lolos lewat salah satu metode dan labelnya kehilangan arti.

### Metode 1 — Residual biaya (bobot 0,40)

Regresi OLS: `IBR ~ b0 + b1·IPT + b2·IAE + b3·populasi`

Residual sangat **negatif** berarti biaya jauh lebih murah daripada seharusnya
mengingat potensi lokasi. Lolos kalau residual di bawah kuartil pertama.

Keunggulannya bisa dijelaskan tanpa jargon: *"berdasarkan potensi transit dan
aktivitas ekonominya, lokasi ini seharusnya berharga sekian, tetapi harga
sebenarnya jauh di bawah itu."*

### Metode 2 — Kuadran (bobot 0,30)

Sumbu tegak Skor Peluang, sumbu datar Prestise Visual (rata-rata lima komponen:
P02, C05, M03, M02, M01). Batas kedua sumbu = median. Lolos kalau jatuh di
kuadran `HIDDEN_GEM` (peluang tinggi, prestise rendah).

Kuadran lain tetap dihitung dan ditampilkan — `JEBAKAN_GENGSI` justru fitur
tersendiri (RiskRadar).

### Metode 3 — IPTT (bobot 0,30)

```
        norm(C07 rasio_keliling) × norm(D10 skor_ramai_terkoreksi)
IPTT = ───────────────────────────────────────────────────────────
                 1 + norm(C08 n_menetap_kuliner)
```

Lolos kalau IPTT di atas kuartil ketiga. Lihat [produk.md](produk.md) untuk
kenapa metrik ini tidak bisa ditiru tanpa data misi MAPID.

## Uji sensitivitas bobot

Pertanyaan *"kenapa bobotnya segitu?"* hampir pasti ditanyakan juri. Jawaban
terbaiknya bukan pembelaan atas angka bobot, melainkan bukti bahwa hasilnya
**tidak sensitif** terhadap angka itu.

Tiap bobot Skor Peluang digeser ±0,10, peringkatnya dibandingkan dengan baseline
memakai korelasi Spearman. Target ρ > 0,85.

Hasil terakhir (`python pipeline/test_s6_score.py`, 300 baris sintetis):

| Perubahan | ρ | | Perubahan | ρ |
|---|---|---|---|---|
| IPT +0,10 | 0,9902 | | IKP +0,10 | 0,9719 |
| IPT −0,10 | 0,9840 | | IKP −0,10 | 0,9795 |
| IAE +0,10 | 0,9919 | | IBR +0,10 | 0,9828 |
| IAE −0,10 | 0,9884 | | IBR −0,10 | 0,9840 |

Semuanya di atas 0,97. Artinya peringkat lokasi ditentukan oleh datanya, bukan
oleh pilihan bobot kami.

> Catatan jujur: angka di atas berasal dari data sintetis, bukan data lapangan.
> Uji ini **wajib diulang** setelah data survei masuk, dan hasilnya dilaporkan
> apa adanya walau lebih rendah.

## Versi skor

Tabel `location_scores` punya kolom `versi`, unik pada (`h3_index`, `versi`).
Baseline tersimpan sebagai `versi = "baseline"`.

Dua hal jadi mungkin karenanya:

1. **Uji sensitivitas** menyimpan variannya tanpa merusak baseline.
2. **Simulator what-if** (fitur B3) — pengguna menggeser bobot sendiri dan
   melihat peringkat berubah, sementara baseline tetap utuh sebagai pembanding.

## Menjalankan uji

```bash
cd pipeline
python test_s6_score.py            # ringkasan + tabel sensitivitas
python -m pytest test_s6_score.py -v
```

Sebelas uji, tidak butuh database maupun data lapangan. Yang dijaga: rentang
normalisasi, NaN tidak berubah jadi nol, ZoneGuard menolkan, zona `NULL` **tidak**
ternol, arah IPTT, kelengkapan kuadran, aturan minimal 2 metode, dan ambang
sensitivitas.
