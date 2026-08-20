"""Tahap 2 - Pembersihan dan standardisasi.

Bagian yang paling sering dilewati tim lomba, dan justru yang paling sering
membuat hasil analisis salah tanpa disadari. Aturan di bawah bukan saran -
semuanya spesifikasi yang harus jalan sebelum satu pun angka masuk perhitungan indeks.

Enam kelompok aturan (docs/data.md bagian 9):
  9.1 Koordinat            - 5 langkah berurutan, urutannya penting
  9.2 Deduplikasi          - 3 syarat harus terpenuhi SEKALIGUS
  9.3 Tanggal dan waktu    - gagal parse TIDAK membuang record
  9.4 Harga dan nominal    - ambang + winsorisasi + MEDIAN bukan rata-rata
  9.5 Nilai kosong         - kosong TIDAK PERNAH diisi nol
  9.6 Normalisasi upaya    - pisahkan keramaian lokasi dari intensitas surveyor
"""

import math

from config import BBOX, HARGA_PORSI_MAKS, HARGA_PORSI_MIN


def bersihkan_koordinat(lat_mentah, lon_mentah) -> tuple[float, float] | None:
    """Lima langkah berurutan. Mengembalikan None kalau titik harus dibuang.

    Kalau sebuah titik jatuh di heksagon yang salah, seluruh rantai analisis di
    atasnya ikut salah: catchment keliru, hitungan kompetitor keliru, skor keliru.
    """
    # 1. Struk Go menyimpan lat/lon sebagai TEXT, pemisah desimal bisa titik atau koma
    try:
        lat = float(str(lat_mentah).strip().replace(",", "."))
        lon = float(str(lon_mentah).strip().replace(",", "."))
    except (TypeError, ValueError):
        return None

    if math.isnan(lat) or math.isnan(lon):
        return None

    # 2. Buang null island
    if lat == 0 and lon == 0:
        return None

    # 3. Deteksi lat/lon tertukar - kesalahan input yang umum
    if abs(lat) > 90 or (abs(lat) > 100 and abs(lon) < 90):
        lat, lon = lon, lat

    # 4. Validasi bounding box Jabodetabek
    if not (BBOX["lat_min"] <= lat <= BBOX["lat_max"]):
        return None
    if not (BBOX["lon_min"] <= lon <= BBOX["lon_max"]):
        return None

    # 5. Snapping drift GPS dilakukan terpisah di snap_ke_geometri(), setelah
    #    langkah di atas - supaya tidak menempelkan titik yang sebenarnya sampah.
    return lat, lon


def snap_ke_geometri(lat: float, lon: float, jaringan_jalan, bangunan):
    """Tempel titik ke bangunan/jalan terdekat kalau jaraknya <= SNAP_GPS_M.

    Ponsel kelas menengah di gang sempit atau di bawah jembatan layang bisa
    meleset 15-40 m. Pada heksagon selebar 350 m efeknya baru terasa di batas
    heksagon, tapi di situ efeknya nyata.
    """
    raise NotImplementedError


def bersihkan_harga_porsi(nilai) -> float | None:
    """Menu Go: satu-satunya angka rupiah native di seluruh data misi.

    Dua kesalahan sistematis yang disaring: surveyor menulis 25 untuk 25 ribu,
    dan surveyor memasukkan harga paket keluarga alih-alih harga per porsi.
    """
    try:
        harga = float(nilai)
    except (TypeError, ValueError):
        return None
    if harga < HARGA_PORSI_MIN or harga > HARGA_PORSI_MAKS:
        return None
    return harga


def parse_tanggal(teks: str):
    """Coba beberapa format berurutan sampai ada yang cocok.

    ATURAN TEGAS: record yang tanggalnya tidak terbaca TIDAK BOLEH DIBUANG.
    Kolom waktunya diisi NULL, recordnya tetap disimpan, dan tetap dipakai untuk
    seluruh analisis spasial. Informasi paling mahal dalam satu record misi
    adalah lokasinya - itu hasil orang datang ke tempatnya secara fisik.
    """
    raise NotImplementedError


def deduplikasi(records: list) -> list:
    """Dua record duplikat hanya kalau KETIGA syarat terpenuhi sekaligus:

      - kemiripan nama  >= 0.85 (fuzzy)
      - jarak antartitik <= 30 m
      - tanggal pendataan sama persis

    Memakai satu atau dua syarat saja akan menghapus usaha yang sah, misalnya
    dua cabang warung dengan nama sama yang berjarak 300 m.

    Untuk gabungan OSM x Overture syarat tanggal tidak berlaku (keduanya basis
    data statis, bukan catatan kunjungan). Saat menggabung, record yang atributnya
    lebih lengkap dipertahankan dan atribut dari record lain disalin masuk -
    supaya penggabungan menambah informasi, bukan sekadar membuang baris.
    """
    raise NotImplementedError


def normalisasi_upaya_survei(n_struk: int, n_kunjungan_surveyor: int) -> float | None:
    """Pisahkan keramaian lokasi dari intensitas kunjungan surveyor.

    Tanpa ini, peta yang dihasilkan sebagian peta keramaian dan sebagian lagi
    peta jadwal kerja surveyor - dan tidak ada cara membedakannya dari luar.

    "Bagaimana Anda memastikan ini bukan sekadar bias pengumpulan data?" adalah
    pertanyaan juri yang paling wajar diajukan pada proyek berbasis data misi.
    """
    if not n_kunjungan_surveyor:
        return None
    return n_struk / n_kunjungan_surveyor


def koreksi_skor_ramai(kondisi: str, jam_kunjungan: int, baseline_per_jam: dict) -> float | None:
    """Menu Go kolom "Kondisi Pembeli" bias terhadap jam kunjungan surveyor.

    "Sepi pukul 10 pagi" tidak sama artinya dengan "Sepi pukul 12 siang".
    Nilai mentah dikurangi baseline jam yang bersangkutan. Menghasilkan D10.
    """
    skala = {"Sepi": 1.0, "Sedang": 2.0, "Ramai": 3.0}
    dasar = skala.get(kondisi)
    if dasar is None:
        return None
    return dasar - baseline_per_jam.get(jam_kunjungan, 0.0)
