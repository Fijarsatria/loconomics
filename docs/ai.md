# AI

## Tiga lapisan, peran yang sangat berbeda

Ini yang paling sering tertukar saat menjelaskan proyek ini.

| | **Lapisan A — Pipeline** | **Lapisan B — Di dalam produk** | **Lapisan C — Kerja tim** |
|---|---|---|---|
| Kapan jalan | Offline, sebelum situs dibuka | Live, saat pengguna mengklik | Saat pengembangan |
| Tugas | Mengubah foto jadi angka | Menjelaskan angka jadi kalimat | Mempercepat tim |
| Kalau mati | Data tidak lengkap | Pengguna tidak dapat penjelasan | Tim bekerja lebih lambat |
| Diwajibkan panitia | Tidak langsung | **Ya (ketentuan C.2)** | Tidak |

## Lapisan A — di pipeline (A1–A6)

| Kode | Fitur | Mengisi | Prioritas | Prompt |
|---|---|---|---|---|
| **A1** | Ekstraktor harga sewa dari foto spanduk | P05 | **WAJIB, tertinggi** | `prompts/a1_spanduk.md` |
| **A2** | Ekstraktor nominal & waktu dari foto struk | B09, B01–B04, B06 | **WAJIB** | `prompts/a2_struk.md` |
| **A3** | Penilai prestise visual dari foto fasad | M03 | Kuat | `prompts/a3_prestise.md` |
| **A4** | Ekstraktor harga & kelas kuliner dari menu | B07, B08, C04 | Sedang | `prompts/a4_menu.md` |
| **A5** | Klasifikator POI ke 8 kelas induk | C01–C03 | Sedang | — (aturan + model kecil) |
| **A6** | **GapFill** — imputasi heksagon minim survei | banyak | **WAJIB** | — (bukan LLM) |

### Kenapa A1–A4 bukan pilihan

| Dataset misi | Jumlah kolom | Kolom berisi angka rupiah |
|---|---|---|
| Properti Go | 8 | **0** |
| Struk Go | 8 | **0** |
| Menu Go | — | satu-satunya yang punya angka native |

Rupiah ada di **foto**, tidak di kolom. Tanpa lapisan ini, proyek ini secara
harfiah tidak punya satu pun angka harga untuk dianalisis.

Itu jawaban terkuat untuk *"kenapa pakai AI?"* — bukan karena sedang tren, tapi
karena tanpa itu datanya tidak ada.

### A6 GapFill — dan kenapa justru bukan LLM

Dataset sampel MAPID berisi ±15 titik per misi, sementara wilayah studi terdiri
dari ribuan heksagon. Dipakai apa adanya, hampir seluruh peta akan kosong.

Kuncinya mengubah cara memandang data misi:

> **Data MAPID = GROUND TRUTH, bukan COVERAGE.**

Data itu tidak dipakai untuk *mengisi* peta, melainkan untuk **mengajari model**
menerjemahkan variabel yang tersedia di mana-mana (OSM, WorldPop, NJOP) menjadi
variabel yang hanya tersedia di titik survei:

```
D10 skor_ramai_terkoreksi ~ f(kepadatan POI, populasi, skor simpul,
                              tutupan bangunan, jarak simpul)

B07 harga_median_porsi    ~ f(NJOP, pangsa waralaba, luas bangunan median,
                              kepadatan kantor)
```

Secara teknis ini **bukan AI generatif**, dan itu bukan kelemahan — justru
menunjukkan tim paham kapan harus memakai LLM dan kapan harus memakai model
statistik. Menempelkan LLM di sini akan lebih lambat, lebih mahal, dan tidak bisa
diaudit.

Konsekuensi yang wajib ditegakkan: setiap heksagon hasil GapFill ditandai
`data_source = "predicted"` (Q03) dan digambar lebih transparan di peta.
Pengguna harus bisa membedakan "disurvei" dari "ditebak model" tanpa mengklik.

### Aturan yang berlaku untuk seluruh lapisan A

1. **Prompt hidup sebagai berkas** di `pipeline/prompts/`, bukan string di dalam
   kode. Perubahannya tercatat di git, dan berkas itu sekaligus bukti untuk
   ketentuan C.1 tentang penjelasan proses AI.
2. **Keluaran wajib JSON terstruktur** yang divalidasi Pydantic, bukan prosa
   bebas. JSON tidak valid → ulang maksimal 2× dengan pesan kesalahan
   dikembalikan ke model.
3. **`confidence < 0,7` tidak pernah dipakai langsung** — masuk antrean
   verifikasi manusia.
4. **Semua hasil di-cache** ke `pipeline/data/cache_ai/`. Jangan pernah memanggil
   ulang API saat demo: membayar dua kali dan mempertaruhkan demo pada koneksi
   internet panitia.
5. **Setiap panggilan dicatat** ke tabel `ai_call_logs` (input, output,
   confidence, biaya).

## Lapisan B — di dalam produk (B1–B5)

Panitia mewajibkan lapisan ini: AI harus bisa diakses langsung dari dalam
antarmuka WebGIS. Bentuknya bebas — **tidak harus chatbot**.

| Kode | Fitur | Status |
|---|---|---|
| **B1** | Penjelas skor — mengubah `jelaskan_skor()` jadi kalimat | **WAJIB** |
| **B2** | Pencarian bahasa alami — "kopi di bawah 3 juta dekat Manggarai" | Kuat |
| **B3** | Simulator what-if — pengguna menggeser bobot, peringkat berubah | Sedang |
| **B4** | **Kendali peta lewat function calling** | **DIFERENSIATOR** |
| **B5** | Pembanding dua lokasi berdampingan | Sedang |

### B4 adalah pembedanya

Dua belas alat, terbagi dua kelompok yang jalannya berbeda:

**Dieksekusi backend** — menyentuh basis data, mengembalikan angka:

| Alat | Kegunaan | Fitur |
|---|---|---|
| `cari_lokasi(jenis_usaha, budget_sewa_bulanan, maks_menit_jalan, kawasan, limit)` | Cari heksagon sesuai kriteria | — |
| `bandingkan(hex_a, hex_b)` | Bandingkan dua lokasi | B5 |
| `jelaskan_skor(hex_id)` | Rincian variabel pembentuk skor | B1 |
| `cek_harga(hex_id)` | Sewa per m², belanja per jam, rentang wajar | PriceLens |
| `pola_jam(hex_id)` | Pola per jam + captive/choice | Commuter Clock |
| `cek_zona(hex_id)` | Status izin RDTR | ZoneGuard |
| `cari_hidden_gem(kawasan, limit)` | Hidden gem + alasan terpilihnya | GemFinder |
| `cek_risiko(kawasan, limit)` | Jebakan Gengsi berperingatan churn | RiskRadar |

**Dieksekusi frontend** — aksi peta, tidak menyentuh basis data:

| Alat | Kegunaan |
|---|---|
| `flyTo(lat, lon, zoom)` | Gerakkan kamera |
| `highlight(hex_ids)` | Sorot heksagon |
| `setLayer(nama_layer)` | Ganti layer tematik |
| `filter(min_score, kuadran)` | Terapkan filter |

Setiap alat memakai **mode strict**: `additionalProperties: false` dan seluruh
properti masuk `required`, sehingga bentuk `input` yang diterima backend dijamin
sesuai skema. Parameter opsional dinyatakan lewat tipe yang boleh `null`, bukan
dengan mengeluarkannya dari `required`.

`filter` dideklarasikan ke model sebagai dua parameter datar supaya skemanya bisa
strict, lalu dibungkus jadi satu objek `kriteria` di backend — kontrak yang
dipegang peta tetap satu bentuk.

**Kenapa pembagian ini penting:** kalau `flyTo` dieksekusi di backend, tidak ada
yang bergerak di layar pengguna. Ketentuan C.2 meminta keluaran AI yang
benar-benar mendarat di peta, bukan sekadar teks.

Saat pengguna bertanya *"lokasi bagus buat coffee shop dekat Stasiun
Sudirman?"*, LLM memanggil `cari_lokasi()` lalu `flyTo()` dan `highlight()` —
petanya bergerak sendiri. Itulah yang membuat AI terasa menyatu, bukan tempelan.

**Di mana kodenya:**

```
backend/app/core/llm.py                  sambungan penyedia, batas putaran & token
backend/app/api/ai.py                    definisi alat + loop agentik + panggil_fungsi()
frontend/src/components/PanelAI.tsx      jalankanAksi() — switch, bukan dispatch dinamis
frontend/src/components/PetaInteraktif.tsx  implementasi aksi peta
```

Nama fungsi divalidasi lewat `switch`/registri, **tidak pernah** dipanggil
dinamis. LLM hanya boleh memilih dari daftar yang sudah ditulis; ia tidak pernah
boleh menentukan fungsi apa yang dieksekusi.

### Kenapa loop ditulis tangan

SDK menyediakan tool runner yang menjalankan loop secara otomatis. Ia tidak
dipakai di sini karena backend perlu memperlakukan dua kelompok alat secara
berbeda: alat backend dijalankan dan hasilnya dikembalikan ke model, sedangkan
alat peta **tidak dijalankan di server sama sekali** — ia dikumpulkan ke
`aksi_peta` dan dieksekusi peta di layar pengguna. Tool runner akan mencoba
menjalankan keduanya, dan `flyTo` yang berjalan di server tidak menggerakkan apa
pun.

Batas keras yang berlaku (`core/llm.py`): **8 putaran alat** dan **4096 token**
per jawaban. Batas putaran ada supaya model yang tersesat tidak memanggil alat
tanpa henti; batas token karena jawaban AI Consultant memang harus ringkas.

### Pembatas biaya

`/ai/tanya` satu-satunya endpoint di seluruh backend yang membelanjakan uang
sungguhan, jadi ia dijaga dua lapis (`core/batas.py`), keduanya diperiksa
**sebelum** model dipanggil:

| Lapis | Batas | Mencegah |
|---|---|---|
| Laju per alamat | 10 permintaan / 60 detik, jendela geser | Satu sumber membanjiri |
| Plafon biaya harian | `LLM_PLAFON_HARIAN_USD`, dari `ai_call_logs` | Banyak sumber pelan-pelan menghabiskan |

Lapis pertama saja tidak cukup: sepuluh alamat yang masing-masing di bawah batas
tetap bisa menguras anggaran dalam sehari. Yang paling mungkin memicu keduanya
bukan penyerang, melainkan satu `useEffect` tanpa dependensi yang benar.

Plafon diperiksa sebelum, bukan sesudah — memeriksa sesudah berarti plafon selalu
terlampaui minimal satu panggilan, dan panggilan pertama setelah plafon justru
yang paling mungkin panggilan berulang dari bug.

### Percakapan banyak giliran

Riwayat dikirim ulang frontend setiap giliran, **tidak disimpan di server**.
Backend jadi tanpa-status: tidak ada sesi yang perlu dibersihkan, tidak ada
kebocoran percakapan antarpengguna, dan proses yang dimulai ulang — deploy
baru, atau instans yang didaur platform — tidak kehilangan apa pun. Dibatasi 20 pesan karena seluruh riwayat ikut dikirim
ke model setiap giliran — biayanya tumbuh kuadratik terhadap panjang percakapan.

Hasil alat dari giliran lama sengaja tidak ikut diputar ulang. Yang perlu diingat
model hanyalah apa yang sudah dikatakan, bukan seluruh payload JSON yang pernah
dibacanya; kalau ia butuh angkanya lagi, ia memanggil alatnya lagi — dan itu
justru benar, karena angka di basis data bisa saja sudah berubah.

### Yang keluar bersama jawaban

| Field | Isi | Untuk apa |
|---|---|---|
| `teks` | Narasi bahasa Indonesia | Ditampilkan |
| `aksi_peta` | Aksi yang dieksekusi peta | Ketentuan C.2 |
| `sumber_angka` | Faktor skor yang dikutip | Penelusuran angka |
| `jejak` | Setiap alat yang dipanggil + argumennya | **Ketentuan C.1** |
| `keyakinan` | Badge heksagon terpilih | Aturan emas 2 |
| `hex_disebut` | Heksagon yang dirujuk | Sorot otomatis |

`jejak` yang membuat proses AI bisa diperiksa: pengguna dan juri melihat alat apa
yang dipanggil dengan argumen apa, bukan hanya hasil akhirnya. Jawaban tanpa satu
pun panggilan alat otomatis ditandai `perlu_review` di `ai_call_logs` — jawaban
seperti itu berarti angkanya tidak bersumber.

## Lapisan C — kerja tim (C1–C3)

| Kode | Fitur |
|---|---|
| **C1** | Penyusunan & pengujian prompt, plus jejak audit di `ai_call_logs` |
| **C2** | Pembangkitan data uji sintetis (dipakai `test_s6_score.py`) |
| **C3** | Bantuan penulisan dan peninjauan kode |

Lapisan ini tidak dinilai langsung, tapi layak disebut saat presentasi karena
menjawab pertanyaan "seberapa dalam tim ini memakai AI?" dengan jujur.

## Dua aturan emas

### 1. LLM tidak boleh menghitung angka apa pun

Setiap angka yang muncul dalam jawaban AI **harus** berasal dari basis data,
lewat salah satu fungsi backend. LLM merangkai kalimat; ia tidak pernah
menjumlahkan, merata-rata, atau memperkirakan.

Penegakannya berlapis:

- Skor hanya dihitung di `pipeline/s6_score.py` — lihat [skoring.md](skoring.md).
- Skema `JawabanAI` punya field `sumber_angka: list[FaktorSkor]`. Setiap angka
  dalam `teks` harus bisa ditelusuri ke sana, dan panel AI menampilkannya di
  bawah setiap jawaban.
- Fungsi backend mengembalikan angka jadi; tidak ada satu pun yang menerima
  ekspresi aritmetika dari LLM.

Satu halusinasi angka saat demo cukup untuk menghancurkan kredibilitas seluruh
proyek. Risikonya tidak sebanding dengan keuntungan apa pun.

### 2. Setiap skor wajib membawa badge keyakinan

Skor 82 dari 40 titik survei dan skor 82 dari 3 titik survei adalah dua
pernyataan yang sangat berbeda. Pengguna berhak tahu yang mana.

Ditegakkan di tipe: setiap skema yang membawa skor **wajib** membawa
`keyakinan: BadgeKeyakinan` (`backend/app/schemas.py`). Secara struktur tidak
mungkin mengirim skor tanpa badge-nya. Lihat [data.md](data.md) Q01–Q03.

## Status saat ini

| Bagian | Status |
|---|---|
| Prompt A1–A4 | **Siap**, sudah cocok dengan skema Pydantic di `s3_extract.py` |
| Skema keluaran A1–A4 | **Siap** (`HasilSpanduk`, `HasilStruk`, `HasilPrestise`, `HasilMenu`) |
| Pemanggil API vision | **Belum** — penyedia belum dipilih |
| A6 GapFill | **Belum** — menunggu data survei |
| 12 alat B1–B5 | **Siap & teruji** — `GET /ai/fungsi` menyajikan skema lengkapnya |
| Loop agentik | **Siap & teruji** — 26 asersi dengan klien tiruan |
| Jalur eksekusi aksi peta | **Siap** — tersambung ujung ke ujung sampai frontend |
| `POST /ai/tanya` | **Siap.** Butuh `LLM_API_KEY` di `backend/.env` |

Tanpa kunci API, `/ai/tanya` mengembalikan **501** dengan pesan yang menjelaskan
apa yang kurang — bukan jawaban palsu. `GET /ai/status` menyatakan kesiapannya,
supaya panel AI di frontend bisa menampilkan keadaan sebenarnya alih-alih
menunggu pertanyaan pertama gagal.

Model default `claude-opus-5`, bisa ditimpa lewat `LLM_MODEL` tanpa menyentuh
kode. Perkiraan biaya tiap panggilan dicatat ke `ai_call_logs.biaya_usd`.
