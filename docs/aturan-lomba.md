# Aturan Lomba yang Mengikat Kode

> **Baca ini sebelum menulis kode apa pun yang menyentuh data MAPID.**
> Sebagian aturan di bawah berkonsekuensi diskualifikasi, bukan pengurangan nilai.

Berkas ini hanya memuat ketentuan yang **berdampak langsung pada kode**. Ketentuan
administratif (jadwal, format berkas, sistematika laporan) ada di berkas panitia,
bukan di sini.

## 🔴 Empat aturan keras

### 1. Data misi MAPID mentah tidak boleh keluar

Yang keluar dari API publik dan yang tampil di antarmuka **hanya hasil agregat
per heksagon**. Tidak boleh ada endpoint, tabel UI, unduhan, atau tooltip yang
menampilkan baris survei individual.

**Bagaimana ini ditegakkan di kode:**

- `backend/app/schemas.py` — tidak satu pun skema membawa record misi mentah.
  Kalau sebuah field tidak ada di skema, ia tidak bisa dikirim.
- Tidak ada modul API untuk "lokasi usaha", "kompetitor", atau "properti".
  Ketiganya hanya hadir sebagai variabel agregat di `/hex`. Lihat
  [arsitektur.md](arsitektur.md).

**Yang harus diperiksa setiap kali menambah endpoint:** apakah respons ini bisa
dipakai merekonstruksi satu baris survei? Kalau ya, jangan dikirim.

### 2. Kunci API lewat environment variable, tidak pernah di source

`.env` masuk `.gitignore`; `.env.example` dikomit dengan nilai kosong.

Dua kunci yang **tidak boleh menyentuh frontend sama sekali**:

- **MAPID Data API key** (`x-api-key`)
- **Kunci penyedia LLM**

Termasuk lewat variabel `VITE_` — seluruh variabel `VITE_` ikut ter-bundel ke
berkas yang bisa dibuka siapa saja. Kalau frontend butuh datanya, backend yang
memanggil dan meneruskan hasilnya.

> ### ⚠️ ASUMSI INI TERBUKTI SALAH — diverifikasi 26 Agustus 2026
>
> Briefing MAPID menyatakan kunci **MAPID Maps** hanya menghitung pemakaian dan
> boleh dipasang di frontend. **Kunci yang sama membuka data misi.** Diuji
> langsung terhadap `POST https://server.mapid.io/web/competition/menugo`:
>
> | | |
> |---|---|
> | kunci Map Services milik tim | **HTTP 200**, 161 titik Menu Go |
> | kunci karangan | HTTP 401 |
> | tanpa kunci | HTTP 400 |
>
> Jadi API-nya benar-benar mengotentikasi, dan satu kunci membuka dua pintu.
>
> **SUDAH DIPERBAIKI, 29 Agustus 2026.** Kunci dicabut total dari frontend.
>
> Asumsi yang selama ini menghalangi perbaikannya ternyata salah: dikira basemap
> MENUNTUT kunci hadir di peramban, sehingga memindahkannya ke backend akan
> mematikan peta. Diukur satu per satu, dan hanya SATU dari empat yang menuntut:
>
> | Sumber daya | Tanpa kunci | Volume |
> |---|---|---|
> | `styles/{gaya}/style.json` | **401** | 4 berkas |
> | `data/mapidtiles.json` | 200 | 2,7 MB |
> | `data/mapidtiles/{z}/{x}/{y}.pbf` | 200 | ~397 KB/ubin, byte identik |
> | `fonts/{fontstack}/{range}.pbf` | 200 | ~75 KB |
>
> Jadi yang perlu melewati sisi server cuma satu berkas JSON per gaya, dan ubin
> — yang menyusun 99% lalu lintas peta — tetap diambil peramban LANGSUNG dari
> MAPID. Pemakaian tetap tercatat di sisi mereka, dan A.3 tidak tersentuh.
>
> Alurnya:
> 1. `GET /meta/basemap/{gaya}/style.json` di backend mengambil gaya dari MAPID
>    dengan kunci, membuang kuncinya dari badan respons, lalu MENYISIPKAN
>    TileJSON-nya (2,7 MB → 25 KB yang benar-benar dipakai perender)
> 2. `frontend/scripts/gaya-basemap.mjs` menyimpan keempatnya sebagai berkas
>    statis di `frontend/public/basemap/` (224 KB, di-commit)
> 3. Frontend memuatnya satu-asal. Tidak ada `VITE_` berisi kunci apa pun lagi
>
> Statis, bukan proksi langsung, karena Render free tier tidur: kalau peramban
> meminta gayanya ke backend saat peta dibuka, basemap ikut mati selama puluhan
> detik pertama — persis saat juri membuka tautan.
>
> Dijaga empat asersi di `backend/tests/test_infra.py` dan satu di
> `frontend/scripts/audit-prd.mjs` ("nol URL membawa key/access_token"). Build
> produksi diperiksa: **nol berkas di `dist/` memuat kunci**.
>
> **Kunci profil akun BUKAN jalan keluarnya — sudah diuji 27 Agu 2026.**
> Kunci tingkat-profil dari dasbor GEO MAPID (`c2c66e…`, berbeda dari kunci
> Map Services) sempat terlihat menjanjikan sebagai kunci kedua. Ia bukan:
>
> | Diuji | Kunci profil | Kunci Map Services |
> |---|---|---|
> | `basemap.mapid.io/styles/light/style.json?key=` | **401** | 200 |
> | `POST /web/competition/menugo` (`x-api-key`) | **500** ×3 | 200 |
> | `POST /web/competition/struckgo` | **500** ×3 | 200 |
> | `POST /web/competition/propertigo` | **500** ×3 | 200 |
>
> Jadi ia tidak bisa menggantikan kunci basemap di frontend, dan tidak bisa
> menggantikan kunci data di backend. Loconomics menyentuh MAPID tepat di dua
> titik itu, dan kunci ini tidak melayani satu pun.
>
> Yang menarik justru **500, bukan 401**: kunci karangan dijawab 401, kunci
> profil dijawab 500 secara konsisten di ketiga jenis misi. Artinya server
> MENGENALI kunci ini — ia kunci MAPID yang sah — tetapi akun di baliknya tidak
> berhak atas data kompetisi, dan penanganannya galat alih-alih menjawab 403.
> Jangan membaca 500 di sini sebagai "coba lagi nanti"; ia jawaban yang stabil.
>
> Konsekuensi praktis: kunci profil tetap **rahasia** (ia kunci akun pribadi,
> jangan pernah masuk `VITE_`), dan opsi 1 tetap satu-satunya jalan yang bersih.

### 3. Data MAPID / mitra tidak boleh diredistribusi

Tidak diunggah ke repo publik, tidak dibagikan ke pihak luar tim, tidak
dilampirkan di berkas mana pun yang bisa diakses umum. `pipeline/data/` seluruhnya
masuk `.gitignore`.

### 4. Sumber data terlarang

Ditulis eksplisit supaya tidak masuk diam-diam:

- **Google Places API**
- **Scraping Rumah123 / OLX** atau situs listing mana pun
- **GTFS TransJakarta versi komunitas** (bukan sumber resmi)

Kalau butuh data serupa, cari sumber resmi atau kumpulkan lewat survei.

## 🟡 Ketentuan produk

### A.3 — Basemap wajib MAPID Maps

Tidak boleh ada sumber tile lain. Bukan OSM, bukan Mapbox, bukan Google.

**Perhatian khusus:** style vector MAPID mencantumkan atribusi
"© MAPID Maps © OpenMapTiles © OpenStreetMap contributors". Itu **atribusi milik
MAPID sendiri** atas data sumbernya, bukan tanda kita memakai tile OSM. Tetap
patuh.

**EMPAT gaya**, bukan lima. `satellite` dicabut 29 Agustus 2026 — ia memang
gaya terbitan MAPID, tetapi ubinnya datang dari `api.mapbox.com` dan
`api.maptiler.com`, dan berkas gayanya membawa `access_token` Mapbox sepanjang
93 karakter **milik akun pihak ketiga**. Menyajikannya berarti melanggar A.3
sekaligus ikut menerbitkan kredensial orang lain — dan kredensial itu bisa
dicabut kapan saja, termasuk saat penjurian.

Keempat yang tersisa (Terang, Dasar, Jalan, Gelap) seluruhnya melayani ubin dari
`basemap.mapid.io`, terdaftar di `frontend/src/config.ts` dan di daftar putih
`backend/app/api/meta.py::GAYA_BASEMAP`. Audit peramban menegakkannya: asersi
"nol ubin dari penyedia lain".

**Catatan operasional:** `basemap.mapid.io` membatasi laju per-IP. Permintaan
ubin yang beruntun dijawab `401 Authorization Required` untuk SELURUH ubin
selama beberapa menit — dengan kunci maupun tanpa. Ia pulih sendiri, dan
`style.json` tetap 200 pada saat yang sama, jadi 401 pada ubin bukan tanda
kuncinya bermasalah.

### Tiga bagian wajib di antarmuka

| Bagian | Berkas |
|---|---|
| Peta Interaktif | `frontend/src/components/PetaInteraktif.tsx` |
| Insight / Analisis | `frontend/src/components/PanelInsight.tsx` |
| Antarmuka AI | `frontend/src/components/PanelAI.tsx` |

Ketiganya tampil bersamaan dalam satu layar.

### C.1 — Proses AI harus bisa dijelaskan

Karena itu prompt disimpan sebagai berkas di `pipeline/prompts/`, bukan sebagai
string di dalam kode. Perubahannya tercatat di git dan bisa ditunjukkan apa
adanya. Setiap panggilan model juga dicatat ke tabel `ai_call_logs`.

### C.2 — Keluaran AI harus mendarat di peta

AI harus bisa diakses dari dalam antarmuka WebGIS, dan keluarannya harus punya
bentuk spasial — bukan sekadar teks.

Ditegakkan lewat pembagian eksekusi fungsi: `flyTo`, `highlight`, `setLayer`,
dan `filter` dijalankan **di frontend**. Kalau dijalankan backend, tidak ada yang
bergerak di layar pengguna. Lihat [ai.md](ai.md) bagian B4.

Bentuknya bebas — **tidak harus chatbot**.

## 🟢 Aturan internal tim

Bukan ketentuan panitia, tapi ditegakkan sekeras ketentuan panitia karena
melanggarnya merusak kredibilitas di depan juri.

### LLM tidak boleh menghitung angka apa pun

Setiap angka dalam jawaban AI harus berasal dari basis data lewat fungsi backend.
LLM merangkai kalimat; ia tidak menjumlahkan, merata-rata, atau memperkirakan.

Satu halusinasi angka saat demo cukup untuk menghancurkan kredibilitas seluruh
proyek.

### Setiap skor wajib membawa badge keyakinan

Skor 82 dari 40 titik survei dan skor 82 dari 3 titik survei adalah dua
pernyataan berbeda. Ditegakkan di tipe: setiap skema yang membawa skor wajib
membawa `keyakinan`. Lihat [data.md](data.md) Q01–Q03.

### Kosong tetap kosong

`NaN` tidak pernah diisi nol. "Belum disurvei" bukan "nol".

## Daftar periksa sebelum menyerahkan

Dijalankan sekali lagi menjelang tenggat, bukan hanya saat mulai:

- [ ] Tidak ada endpoint yang bisa dipakai merekonstruksi satu baris survei
- [ ] `git log -p` tidak memuat satu pun kunci atau sandi
- [ ] `.env` tidak pernah ter-commit (`git check-ignore backend/.env frontend/.env`)
- [ ] `pipeline/data/` tidak ter-commit
- [ ] Tidak ada sumber tile selain MAPID Maps
- [ ] Tidak ada pemanggilan Google Places / scraping listing di kode mana pun
- [ ] Kunci Data API dan kunci LLM tidak muncul di bundel frontend
      (`npm run build`, lalu `grep -r "x-api-key\|sk-" dist/`)
- [ ] Tiga bagian wajib tampil bersamaan
- [ ] Minimal satu aksi peta benar-benar tereksekusi dari jawaban AI
- [ ] Setiap skor di layar disertai badge keyakinan
- [ ] Prompt AI ada sebagai berkas dan sesuai dengan yang benar-benar dipakai
