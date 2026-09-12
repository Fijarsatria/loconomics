# Skoring

> **Satu-satunya tempat skor dihitung di seluruh proyek adalah
> `pipeline/s6_score.py`.** Backend tidak menghitung — ia membaca tabel
> `location_scores`. Frontend tidak menghitung — ia menampilkan. LLM sama sekali
> tidak boleh menghitung. Kalau aritmetika skor muncul di berkas lain, itu bug.

## Alur

```
43 variabel
    ↓ norm()                     min-max ke [0,1]; log1p untuk variabel berekor panjang
4 indeks komposit                IPT · IAE · IKP · IBR
    ↓ jumlah tertimbang
Skor Peluang mentah
    ↓ norm × 100, lalu ZoneGuard
Skor Peluang 0–100
    ↓ 3 metode
Hidden Gem Score + Kuadran
```

Berjalan berdampingan dengan itu, dari normalisasi yang sama:

```
14 variabel berbobot
    ↓ rincian_faktor()   bobot × nilai ternormalisasi, per (heksagon, variabel)
score_factors           9.912 baris untuk 708 heksagon
```

Isinya bukan angka baru: jumlah kontribusi satu indeks selalu sama persis dengan
nilai indeks itu, dan `test_faktor_menjumlah_jadi_indeksnya` yang menjaganya.
Tabel ini ada supaya penjelasan tidak perlu menghitung apa pun saat request —
backend membacanya untuk panel "Kenapa skornya segitu", dan LLM merangkainya
jadi kalimat tanpa pernah menyentuh aritmetika.

Empat belas, bukan 43: hanya variabel yang benar-benar punya bobot yang muncul.
B10 dan P07 tidak ikut karena keduanya variabel tampilan PriceLens dan tidak
membentuk satu pun indeks.

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

## Dua variabel yang sengaja TIDAK masuk skor

**B10 `belanja_per_jam`** dan **P07 `harga_sewa_per_m2`** ada di Kamus Data tetapi
tidak muncul di satu pun bobot indeks. Keduanya variabel tampilan untuk PriceLens.

Untuk P07 keputusan itu tidak nyaman dan layak ditulis terus terang. Secara
metodologi P07 **lebih benar** daripada P05 sebagai ukuran biaya di IBR: sewa
absolut mencampur harga dengan luas, sehingga Rp 8 juta untuk 20 m² dan Rp 8 juta
untuk 80 m² terhitung sama mahal padahal berbeda empat kali lipat.

Alasan tidak menggantinya sekarang: angka uji sensitivitas di atas dilaporkan
untuk bobot yang ada. Mengubah IBR sebelum data lapangan masuk berarti mengganti
model berdasarkan tebakan, lalu melaporkan angka sensitivitas yang tidak lagi
menggambarkan model yang benar-benar dipakai.

Rencananya: setelah data survei masuk, jalankan keduanya berdampingan
(`versi = "baseline"` dan `versi = "ibr_p07"`), bandingkan peringkatnya, dan
laporkan hasilnya apa adanya. Kolom `versi` di `location_scores` memang ada untuk
ini. Ditandai di `pipeline/config.py::VARIABEL_TAMPILAN`.

## Skor blok — di dalam satu heksagon

Ditambahkan 12 Sep 2026. Dihitung di `s6_score.skor_blok()`, di berkas yang
sama dengan skor heksagon, karena aturan 1 tidak punya pengecualian.

**Masalah yang dijawabnya.** Heksagon res-9 bergaris tengah ±350 m, jadi satu
petak memuat sisi yang menempel jalan besar DAN gang buntu di belakangnya —
dan keduanya mendapat satu Opportunity Score yang sama. Pernyataan "lokasi ini
bagus" jadi benar untuk sepertujuh heksagonnya saja.

**Yang TIDAK dilakukan: memperhalus grid.** Mengubah res-9 jadi res-10 membuang
708 heksagon, seluruh rute ORS, dan tiap variabel yang sudah terkumpul — lalu
menukar satu masalah dengan masalah yang sama pada skala lebih kecil, karena
res-10 pun masih memuat dua sisi jalan. Heksagon tetap unit analisisnya; blok
dipanggil **saat diminta**, sebagai pembanding di dalam satu heksagon.

Enam indikator, seluruhnya dari sumber yang sudah ada di repo. Bobotnya di
`pipeline/config.py::BOBOT_BLOK`:

| Indikator | Bobot | Sumber |
|---|---|---|
| menit jalan kaki ke simpul (dibalik) | 0,30 | matriks openrouteservice, 400 pasang per permintaan |
| jarak ke jalan utama (dibalik) | 0,20 | kelas jalan OpenStreetMap |
| penarik keramaian dalam 250 m | 0,15 | OSM |
| usaha dalam 150 m | 0,15 | OSM |
| jarak halte terdekat (dibalik) | 0,10 | OSM |
| rasio tutupan bangunan | 0,10 | OSM |

Lalu dua penyesuaian: `BOBOT_BLOK_BANJIR` (0,10) dikurangkan, dan
`BOBOT_BLOK_PESAING` (0,20) dikurangkan **hanya untuk kelas usaha yang
diminta** — sehingga blok dengan tiga pesaing sekelas turun peringkat untuk
kelas ITU saja dan tetap teratas untuk kelas lain.

### Tiga keputusan yang paling menentukan

**Normalisasinya GLOBAL, bukan per induk.** Min-max per induk akan selalu
merentang tujuh blok ke 0..100, sehingga selisih lima meter ke jalan terbaca
sebagai perbedaan terbesar di dunia. Dengan normalisasi atas seluruh 4.956
blok, tujuh blok yang memang mirip tetap berskor mirip — dan itu pernyataan
yang benar tentang heksagon itu.

**Warna peta mengikuti SKOR, bukan peringkat.** Konsekuensi langsung dari
keputusan di atas: diwarnai menurut peringkat, tujuh blok yang skornya 71–73
tampil seperti jurang dari gelap ke pucat dan orang memilih #1 karena petanya
berteriak — padahal selisihnya dua poin. Alasan lengkapnya di
`frontend/src/lib/layer-peta.ts::WARNA_BLOK`.

**Jarak ke jalan utama NaN, bukan angka besar, di luar radius tarik 2.600 m.**
Di sana kita tidak tahu apakah tidak ada jalan atau kita tidak menariknya —
dua pernyataan berbeda (aturan 4).

Zona RDTR yang MELARANG usaha menolkan skor blok, persis seperti ZoneGuard pada
heksagon. Zona yang TIDAK DIKETAHUI tidak menolkan apa pun.

## Menjalankan uji

```bash
cd pipeline
python test_s6_score.py            # ringkasan + tabel sensitivitas
python -m pytest test_s6_score.py -v
```

Empat belas uji, tidak butuh database maupun data lapangan. Yang dijaga: rentang
normalisasi, NaN tidak berubah jadi nol, ZoneGuard menolkan, zona `NULL` **tidak**
ternol, arah IPTT, kelengkapan kuadran, aturan minimal 2 metode, dan ambang
sensitivitas.
