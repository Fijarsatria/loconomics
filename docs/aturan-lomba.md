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

Kunci **MAPID Maps** (basemap) boleh di frontend: menurut briefing MAPID, kunci
itu hanya menghitung pemakaian, bukan mengotorisasi.

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

Kelima gaya yang tersedia terdaftar di `frontend/src/config.ts`.

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
