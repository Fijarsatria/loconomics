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
import re
from datetime import datetime

import h3
import pandas as pd

from config import (
    BBOX,
    H3_RESOLUSI,
    JARINGAN_BRT,
    JARINGAN_KOMUTER,
    HARGA_PORSI_MAKS,
    HARGA_PORSI_MIN,
    NILAI_JENIS_PROPERTI,
    NILAI_MOBILITAS,
    is_waralaba,
    kelas_dari_tag,
    kunci_nilai,
)


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


# ---------------------------------------------------------------------------
# OpenStreetMap -> baris business_pois
# ---------------------------------------------------------------------------


def _titik_osm(e: dict) -> tuple[float, float] | None:
    """Koordinat satu elemen Overpass, node maupun way.

    `way` tidak punya lat/lon sendiri; `out center` menaruhnya di `center`.
    Elemen tanpa keduanya dibuang - bukan diisi nol, yang akan mendaratkannya
    di lepas pantai Afrika dan tetap lolos setiap pemeriksaan yang mengira nol
    adalah angka yang sah.
    """
    if "lat" in e and "lon" in e:
        return bersihkan_koordinat(e["lat"], e["lon"])
    pusat = e.get("center")
    if pusat:
        return bersihkan_koordinat(pusat.get("lat"), pusat.get("lon"))
    return None


def poi_dari_osm(elemen: list[dict]) -> pd.DataFrame:
    """Elemen Overpass mentah -> baris siap masuk `business_pois`.

    Yang dibuang di sini ada tiga macam, dan ketiganya sengaja dibuang DIAM:
    elemen tanpa koordinat sah, elemen yang tagnya tidak memetakan ke satu pun
    dari delapan kelas induk, dan elemen tanpa nama. Yang terakhir perlu
    penjelasan - `business_pois.nama` tidak boleh kosong, dan POI tanpa nama di
    OSM hampir selalu bukan tempat usaha yang berdiri sendiri melainkan bagian
    dari sesuatu yang lain (ATM di dalam minimarket, apotek di dalam klinik).
    Menghitungnya sebagai kompetitor akan menggandakan satu tempat yang sama.

    `kategori_asli` menyimpan tag ASLINYA (`amenity=cafe`), bukan cuma kelas
    indukinya. Tanpa itu, pemetaan 83 tag ke 8 kelas jadi kotak hitam yang
    tidak bisa diaudit siapa pun - termasuk oleh kita sendiri saat sebuah
    heksagon terlihat aneh dan pertanyaannya "isinya apa saja sebenarnya".

    Deduplikasi antar-kawasan sudah dikerjakan `s1_ingest._per_kawasan` menurut
    (tipe, id). Yang TIDAK dikerjakan di sini: penggabungan node dan way yang
    mewakili tempat yang sama - itu `deduplikasi()`, dan syaratnya berbeda.
    """
    baris = []
    for e in elemen:
        tag = e.get("tags") or {}
        nama = (tag.get("name") or "").strip()
        if not nama:
            continue
        cocok = kelas_dari_tag(tag)
        if cocok is None:
            continue
        titik = _titik_osm(e)
        if titik is None:
            continue
        kelas, asal = cocok
        lat, lon = titik
        baris.append(
            {
                "h3_index": h3.latlng_to_cell(lat, lon, H3_RESOLUSI),
                "nama": nama[:200],
                "kelas_induk": kelas,
                "kategori_asli": asal,
                "sumber": "osm",
                "is_waralaba": is_waralaba(tag),
                # Tidak disimpan ke `business_pois` - dipakai s4 untuk C04 lalu
                # dibuang. Ditumpangkan di sini supaya tag mentahnya tidak perlu
                # dibaca dua kali dari berkas 2,5 MB.
                "cuisine": (tag.get("cuisine") or "").strip().lower(),
                "lat": lat,
                "lon": lon,
            }
        )
    return pd.DataFrame(
        baris,
        columns=[
            "h3_index", "nama", "kelas_induk", "kategori_asli",
            "sumber", "is_waralaba", "cuisine", "lat", "lon",
        ],
    )


def rute_dari_osm(elemen: list[dict]) -> pd.DataFrame:
    """Relasi rute Overpass -> pasangan (titik henti, rute) - bahan D05.

    Satu baris per ANGGOTA berperan henti, jadi satu rute muncul sebanyak
    henti yang dilewatinya. Peran yang dihitung `stop*` dan `platform*`;
    anggota berperan kosong adalah ruas jalan/rel yang dilalui, dan
    menghitungnya akan mengubah "rute berhenti di sini" jadi "rute lewat sini".
    Untuk lokasi usaha, dua hal itu berlawanan artinya - kendaraan yang lewat
    tanpa berhenti tidak menurunkan satu pun calon pembeli.

    `moda` diambil dari tag relasi, bukan dari tag hentinya. Sebuah
    `stop_position` di Dukuh Atas dilewati kereta MRT dan bus Transjakarta
    sekaligus; yang menentukan kapasitas bukan tiangnya, melainkan apa yang
    berhenti di situ.

    Kereta dipisah dua. `route=train` yang jaringannya tidak memuat "commuter"
    diperlakukan ANTARKOTA dan ditimbang jauh lebih ringan - lihat
    `config.BOBOT_RUTE`. Tanpa pemisahan itu, 46 lin Argo/Bima/Brantas yang
    lewat sekali sehari mengalahkan 4 lin KRL yang mengangkut ratusan ribu
    orang, dan Stasiun Bekasi berskor tiga kali Dukuh Atas.

    `lin` - BUKAN id relasi - yang dipakai menghitung keunikan, dan ini bukan
    kerapian melainkan koreksi atas kesalahan yang terukur. OSM memecah satu
    layanan jadi satu relasi per arah dan per varian: "Lin Lingkar Cikarang"
    hidup sebagai **14 relasi** (full racket, half racket, via Manggarai, via
    Pasar Senen, masing-masing dua arah). Menghitung relasi membuat Stasiun
    Bekasi berskor 702 sementara Dukuh Atas - simpul transit terbesar Jakarta,
    tempat MRT, KRL, dan Transjakarta bertemu - hanya 259. Dikelompokkan
    menurut lin, 297 relasi menyusut jadi 148 layanan, dan urutannya kembali
    sesuai kenyataan.

    Relasi tanpa `ref` (8 dari 297) memakai id-nya sendiri sebagai lin - satu
    relasi tak bernomor lebih baik dihitung satu layanan daripada dilebur
    dengan setiap relasi tak bernomor lainnya.
    """
    baris = []
    for e in elemen:
        if e.get("type") != "relation":
            continue
        tag = e.get("tags") or {}
        moda = (tag.get("route") or "").strip().lower()
        if not moda:
            continue
        jaringan = f"{tag.get('network', '')} {tag.get('operator', '')}".lower()
        if moda in ("bus", "trolleybus") and any(b in jaringan for b in JARINGAN_BRT):
            moda = "brt"
        elif moda == "train" and not any(k in jaringan for k in JARINGAN_KOMUTER):
            moda = "antarkota"
        nomor = (tag.get("ref") or "").strip()
        lin = (
            f"{moda}|{(tag.get('network') or '').strip()}|{nomor}"
            if nomor
            else f"{moda}|relasi|{e.get('id')}"
        )
        for m in e.get("members") or []:
            peran = m.get("role") or ""
            if not peran.startswith(("stop", "platform")):
                continue
            baris.append(
                {
                    "ref": f"{m.get('type')}/{m.get('ref')}",
                    "lin": lin,
                    "moda": moda,
                }
            )
    df = pd.DataFrame(baris, columns=["ref", "lin", "moda"])
    # Satu lin sering mendaftarkan stop_position DAN platform untuk perhentian
    # yang sama. Keduanya ref yang berbeda, jadi dedup di sini tidak menolong;
    # yang menolong menghitung lin UNIK per heksagon, dan itu tugas s4.
    return df.drop_duplicates()


def henti_dari_osm(elemen: list[dict]) -> pd.DataFrame:
    """Titik henti berkoordinat -> (ref, lat, lon) - pasangan `rute_dari_osm`.

    `ref` sengaja berbentuk "node/123", sama persis dengan yang ditulis
    `rute_dari_osm`, supaya keduanya bisa disatukan tanpa penyesuaian apa pun.
    Kalau salah satunya menyimpan id telanjang, penyatuannya menghasilkan nol
    baris dan nol baris itu terbaca sebagai "tidak ada angkutan umum di sini".
    """
    baris = []
    for e in elemen:
        titik = _titik_osm(e)
        if titik is None:
            continue
        lat, lon = titik
        baris.append(
            {
                "ref": f"{e.get('type')}/{e.get('id')}",
                "h3_index": h3.latlng_to_cell(lat, lon, H3_RESOLUSI),
                "lat": lat,
                "lon": lon,
            }
        )
    return pd.DataFrame(baris, columns=["ref", "h3_index", "lat", "lon"]).drop_duplicates("ref")


def simpul_dari_osm(elemen: list[dict]) -> pd.DataFrame:
    """Elemen Overpass -> baris `transport_nodes`.

    Moda ditentukan dari tag, dengan urutan yang tidak boleh dibalik: sebuah
    simpul bisa membawa `railway=station` DAN `public_transport=station`
    sekaligus, dan yang pertama jauh lebih informatif.

    `station=subway|light_rail` dibaca lebih dulu daripada `railway=station`
    karena keduanya selalu muncul bersama - MRT Jakarta ditandai
    `railway=station` + `station=subway`, dan membaca `railway` duluan akan
    menamai seluruh MRT dan LRT sebagai KRL.
    """
    peta_station = {"subway": "MRT", "light_rail": "LRT"}
    baris = []
    for e in elemen:
        tag = e.get("tags") or {}
        nama = (tag.get("name") or "").strip()
        if not nama:
            continue
        titik = _titik_osm(e)
        if titik is None:
            continue
        if tag.get("station") in peta_station:
            moda = peta_station[tag["station"]]
        elif tag.get("railway") in ("station", "halt"):
            moda = "KRL"
        elif tag.get("amenity") == "bus_station":
            moda = "TERMINAL"
        elif tag.get("highway") == "bus_stop":
            moda = "BRT"
        elif tag.get("public_transport") == "station":
            moda = "TERMINAL"
        else:
            continue
        lat, lon = titik
        baris.append(
            {
                "osm_id": f"{e.get('type')}/{e.get('id')}",
                "nama": nama[:120],
                "moda": moda,
                "kawasan": e.get("_kawasan"),
                "lat": lat,
                "lon": lon,
            }
        )
    return pd.DataFrame(
        baris, columns=["osm_id", "nama", "moda", "kawasan", "lat", "lon"]
    )


#: Tag OSM yang BUKAN tempat usaha tetapi menjelaskan konteks heksagon.
#: Dipisah dari `OSM_KE_KELAS` dengan sengaja: yang di sini tidak pernah boleh
#: terhitung sebagai kompetitor siapa pun. Sekolah di sebelah warung menambah
#: alasan orang lewat, bukan mengurangi pembelinya.
KONTEKS_OSM: dict[tuple[str, str], str] = {
    ("amenity", "school"): "sekolah",
    ("amenity", "college"): "sekolah",
    ("amenity", "university"): "sekolah",
    ("amenity", "kindergarten"): "sekolah",
    ("amenity", "hospital"): "rumah_sakit",
    ("amenity", "marketplace"): "pasar",
}


def konteks_dari_osm(elemen: list[dict]) -> pd.DataFrame:
    """Elemen Overpass -> (h3_index, jenis) untuk D08 dan D09.

    Empat jenis: `kantor`, `sekolah`, `rumah_sakit`, `pasar`, `ibadah`.

    Kantor dibaca dari ADA-TIDAKNYA tag `office`, apa pun nilainya - "kepadatan
    perkantoran" adalah pernyataan tentang berapa banyak orang bekerja di situ,
    dan nilai tagnya (`office=company`, `office=lawyer`) tidak mengubah itu.

    `ibadah` sengaja memuat SELURUH rumah ibadah muslim, bukan yang besar saja,
    walau D09 didefinisikan "masjid besar". Alasannya bisa diperiksa siapa pun:
    OSM tidak punya tag ukuran, dan menebak "besar" dari ada-tidaknya footprint
    akan menghitung musholla yang kebetulan digambar sebagai bidang sementara
    membuang masjid raya yang kebetulan cuma ditandai satu titik. Yang dipilih
    hitungan yang bisa dijelaskan, dengan batasnya ditulis terus terang di sini
    dan di docs/data.md - bukan angka yang terdengar lebih tepat tanpa dasar.

    Satu elemen bisa menyumbang DUA baris: sekolah yang juga ditandai `office`
    memang dua-duanya. Yang dilarang cuma satu - elemen di sini tidak boleh ikut
    masuk `business_pois`, dan itu dijamin `kelas_dari_tag` yang menolaknya.
    """
    baris = []
    for e in elemen:
        tag = e.get("tags") or {}
        if not tag:
            continue
        jenis = []
        if tag.get("office"):
            jenis.append("kantor")
        cocok = KONTEKS_OSM.get(("amenity", tag.get("amenity", "")))
        if cocok:
            jenis.append(cocok)
        if tag.get("amenity") == "place_of_worship" and tag.get("religion") == "muslim":
            jenis.append("ibadah")
        if not jenis:
            continue
        titik = _titik_osm(e)
        if titik is None:
            continue
        lat, lon = titik
        sel = h3.latlng_to_cell(lat, lon, H3_RESOLUSI)
        baris.extend({"h3_index": sel, "jenis": j} for j in jenis)
    return pd.DataFrame(baris, columns=["h3_index", "jenis"])


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

# ---------------------------------------------------------------------------
# OpenStreetMap -> footprint bangunan
# ---------------------------------------------------------------------------


def luas_poligon_m2(titik: list[dict]) -> float | None:
    """Luas satu poligon lat/lon dalam meter persegi.

    Diproyeksikan ekuirektangular lebih dulu terhadap lintang TENGAH poligon
    itu sendiri, lalu shoelace. Untuk bidang seukuran bangunan (puluhan meter)
    galatnya jauh di bawah 0,1% - dan yang membuatnya kecil adalah pemakaian
    lintang poligonnya sendiri, bukan lintang tetap untuk seluruh kota.

    Mengembalikan None untuk cincin yang tidak bisa membentuk bidang. Nol tidak
    dipakai sebagai penanda gagal: bangunan berluas nol dan bangunan yang
    geometrinya rusak adalah dua hal berbeda, dan yang kedua tidak boleh ikut
    menurunkan median.
    """
    if not titik or len(titik) < 3:
        return None
    try:
        lat = [float(t["lat"]) for t in titik]
        lon = [float(t["lon"]) for t in titik]
    except (KeyError, TypeError, ValueError):
        return None

    lat0 = sum(lat) / len(lat)
    k_lon = 111_320.0 * math.cos(math.radians(lat0))
    x = [(v - lon[0]) * k_lon for v in lon]
    y = [(v - lat[0]) * 110_574.0 for v in lat]

    # Overpass menutup cincinnya sendiri (titik terakhir == titik pertama);
    # shoelace tidak peduli, tetapi menutup dua kali juga tidak merusaknya.
    dua_luas = 0.0
    for i in range(len(x)):
        j = (i + 1) % len(x)
        dua_luas += x[i] * y[j] - x[j] * y[i]
    luas = abs(dua_luas) / 2.0
    return luas if luas > 0 else None


def bangunan_dari_osm(elemen: list[dict]) -> pd.DataFrame:
    """Elemen Overpass `out geom` -> (h3_index, luas_m2) per bangunan.

    Bangunan ditempatkan menurut TITIK TENGAH cincinnya, jadi bangunan yang
    melintasi batas heksagon menyumbang seluruh luasnya ke satu heksagon saja.
    Itu galat, tetapi galat yang kecil dan tidak berarah: bangunan di Jabodetabek
    bermedian puluhan meter persegi sementara heksagon res-9 sekitar 105.000 m2,
    dan yang melimpah ke tetangga kira-kira sebanyak yang melimpah masuk.
    Memotong tiap poligon di batas heksagon menuntut pustaka geometri penuh dan
    mengubah hasilnya jauh lebih sedikit daripada ketidakpastian pemetaan OSM
    itu sendiri.
    """
    baris = []
    for e in elemen:
        geom = e.get("geometry")
        luas = luas_poligon_m2(geom) if geom else None
        if luas is None:
            continue
        lat = sum(float(t["lat"]) for t in geom) / len(geom)
        lon = sum(float(t["lon"]) for t in geom) / len(geom)
        titik = bersihkan_koordinat(lat, lon)
        if titik is None:
            continue
        baris.append(
            {
                "h3_index": h3.latlng_to_cell(titik[0], titik[1], H3_RESOLUSI),
                "luas_m2": round(luas, 2),
            }
        )
    return pd.DataFrame(baris, columns=["h3_index", "luas_m2"])

# ---------------------------------------------------------------------------
# API misi MAPID -> baris observasi
# ---------------------------------------------------------------------------
#
# Tiga penguraian di bawah mengubah GeoJSON Feature dari
# `server.mapid.io/web/competition/*` jadi baris tabel `*_observations`.
#
# Yang TIDAK dikerjakan di sini, dan sengaja: mengisi nominal rupiah. Struk Go
# dan Properti Go sama sekali tidak punya kolom uang - angkanya cuma ada di
# dalam foto, dan itu pekerjaan A1/A2 (s3_extract). Kolom `total_nominal` dan
# `harga_nominal` dibiarkan kosong supaya perbedaan antara "belum di-OCR" dan
# "nol rupiah" tetap terbaca.


def parse_tanggal_misi(nilai) -> datetime | None:
    """Tanggal dari API misi MAPID, yang bentuknya belum bisa dipastikan.

    Terukur 26 Agu 2026: SELURUH 866 titik mengembalikan `{}` - sebuah objek
    kosong, bukan string kosong dan bukan null. Jadi fungsi ini hampir selalu
    mengembalikan None hari ini.

    Ditulis toleran karena bentuknya bisa berubah tanpa pemberitahuan: kalau
    MAPID mulai mengirim tanggalnya, ia bisa datang sebagai string ISO, sebagai
    `$date` gaya Mongo, atau sebagai objek berisi tanggal dan waktu terpisah.
    Yang tidak boleh terjadi adalah pipeline berhenti karena bentuk baru - dan
    tanggal yang gagal dibaca TIDAK PERNAH membuang recordnya (aturan 9.3):
    lokasinya jauh lebih mahal daripada waktunya, karena ia hasil orang datang
    ke tempatnya secara fisik.
    """
    if nilai in (None, "", {}, []):
        return None
    if isinstance(nilai, dict):
        for k in ("$date", "date", "tanggal", "value", "iso"):
            if nilai.get(k):
                return parse_tanggal_misi(nilai[k])
        return None
    if isinstance(nilai, (int, float)):        # epoch milidetik
        try:
            return datetime.fromtimestamp(nilai / 1000 if nilai > 1e11 else nilai)
        except (OverflowError, OSError, ValueError):
            return None
    teks = str(nilai).strip()
    if not teks:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d-%m-%Y %H:%M", "%d-%m-%Y",
                "%d/%m/%Y %H:%M", "%d/%m/%Y"):
        try:
            return datetime.strptime(teks, fmt)
        except ValueError:
            continue
    return None


def _titik_misi(f: dict) -> tuple[float, float] | None:
    """Koordinat satu Feature misi. Selalu Point menurut dokumentasi, tetapi
    diperiksa juga - satu titik yang jatuh di heksagon salah merusak seluruh
    rantai analisis di atasnya, dan tidak memunculkan galat."""
    g = f.get("geometry") or {}
    if g.get("type") != "Point":
        return None
    k = g.get("coordinates") or []
    if len(k) < 2:
        return None
    return bersihkan_koordinat(k[1], k[0])   # GeoJSON = [lon, lat]


def _dasar(f: dict) -> dict | None:
    titik = _titik_misi(f)
    if titik is None:
        return None
    lat, lon = titik
    return {
        "h3_index": h3.latlng_to_cell(lat, lon, H3_RESOLUSI),
        "lat": lat,
        "lon": lon,
    }


def menu_dari_mapid(fitur: list[dict]) -> pd.DataFrame:
    """Menu Go -> `menu_observations`. Sumber B07, B08, C04, C07, C08, D10.

    `kondisi_pembeli` disimpan sebagai LABEL ("Sepi"/"Sedang"/"Ramai"), bukan
    angkanya. Alasannya bisa diperiksa: angka 0/0,5/1 adalah tafsir kita atas
    jawaban surveyor, dan tafsir tidak boleh menggantikan jawaban aslinya di
    tabel observasi. Yang menerjemahkannya `s4_spatial`, dan kalau kelak
    skalanya berubah, tabelnya tidak perlu ditarik ulang.

    `waktu_kunjungan` HAMPIR PASTI kosong: API mengembalikan `tanggal: {}` di
    seluruh 866 titik (terukur 26 Agu 2026). Tetap dibaca kalau-kalau MAPID
    memperbaikinya - kalau ia mulai terisi, D10 bisa dikoreksi terhadap jam
    kunjungan seperti yang diniatkan `s2_clean.koreksi_skor_ramai`.
    """
    kolom = ["h3_index", "nama_usaha", "kondisi_pembeli", "waktu_kunjungan",
             "mobilitas_keliling", "harga_rata_porsi", "menu_andalan", "lat", "lon"]
    baris = []
    for f in fitur:
        d = _dasar(f)
        if d is None:
            continue
        p = f.get("properties") or {}
        d["nama_usaha"] = (p.get("nama_tempat") or "").strip()[:200] or None
        d["kondisi_pembeli"] = kunci_nilai(p.get("kondisi_tempat")).title()[:10] or None
        d["waktu_kunjungan"] = parse_tanggal_misi(p.get("tanggal"))
        d["mobilitas_keliling"] = NILAI_MOBILITAS.get(kunci_nilai(p.get("mobilitas")))
        d["harga_rata_porsi"] = bersihkan_harga_porsi(p.get("harga_rata_rata"))
        d["menu_andalan"] = (p.get("menu_utama") or "").strip() or None
        baris.append(d)
    return pd.DataFrame(baris, columns=kolom)


def struk_dari_mapid(fitur: list[dict]) -> pd.DataFrame:
    """Struk Go -> `receipt_observations`. Sumber B06 sekarang; B01-B05, B09,
    B10, D11 menyusul lewat A2.

    `foto_url` WAJIB ikut tersimpan: ia satu-satunya jalan menuju nominal dan
    jam transaksi, dan tanpa menyimpannya di sini, A2 harus menarik ulang
    seluruh dataset hanya untuk mendapatkan URL-nya.
    """
    kolom = ["h3_index", "nama_merchant", "waktu_transaksi", "metode_bayar",
             "foto_url", "lat", "lon"]
    baris = []
    for f in fitur:
        d = _dasar(f)
        if d is None:
            continue
        p = f.get("properties") or {}
        d["nama_merchant"] = (p.get("nama_tempat") or "").strip()[:200] or None
        d["waktu_transaksi"] = parse_tanggal_misi(p.get("tanggal"))
        d["metode_bayar"] = (p.get("metode_pembayaran") or "").strip()[:40] or None
        d["foto_url"] = (p.get("foto_struk") or "").strip() or None
        baris.append(d)
    return pd.DataFrame(baris, columns=kolom)


def properti_dari_mapid(fitur: list[dict]) -> pd.DataFrame:
    """Properti Go -> `property_observations`. Sumber P03, P04 sekarang; P05
    menyusul lewat A1 atas `foto_spanduk`."""
    kolom = ["h3_index", "kategori", "status", "foto_spanduk_url", "lat", "lon"]
    baris = []
    for f in fitur:
        d = _dasar(f)
        if d is None:
            continue
        p = f.get("properties") or {}
        d["kategori"] = (p.get("kategori_properti") or "").strip()[:60] or None
        d["status"] = NILAI_JENIS_PROPERTI.get(kunci_nilai(p.get("jenis_properti")))
        d["foto_spanduk_url"] = (p.get("foto_spanduk") or "").strip() or None
        baris.append(d)
    return pd.DataFrame(baris, columns=kolom)


def aktivitas_dari_mapid(aktivitas: list[dict]) -> pd.DataFrame:
    """Activities -> (h3_index) per kegiatan. Sumber D12 aktivitas_komunitas.

    Bentuknya berbeda dari ketiga misi: bukan GeoJSON Feature, melainkan objek
    ber-`geometry` sendiri. Tidak ada tabel observasinya - yang dipakai cuma
    hitungannya per heksagon, jadi menyimpan judul dan deskripsi tiap kegiatan
    berarti menyimpan data yang tidak pernah ditanyakan siapa pun.
    """
    baris = []
    for a in aktivitas:
        g = a.get("geometry") or {}
        k = g.get("coordinates") or []
        if g.get("type") != "Point" or len(k) < 2:
            continue
        titik = bersihkan_koordinat(k[1], k[0])
        if titik is None:
            continue
        baris.append({"h3_index": h3.latlng_to_cell(titik[0], titik[1], H3_RESOLUSI)})
    return pd.DataFrame(baris, columns=["h3_index"])
