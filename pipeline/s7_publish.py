"""Tahap 7 - Terbitkan: dari DataFrame ke basis data, lalu ke berkas statis.

Tahap ini sebelumnya tidak ada, dan itu lubang yang cukup besar: s6_score.py
mengembalikan DataFrame berisi skor, dan tidak ada satu pun kode yang
memindahkannya ke tabel yang dibaca backend. Seluruh API menunjuk ke basis data
yang tidak pernah bisa terisi.

Dua arah kerja:

  muat_*()          DataFrame -> PostgreSQL/PostGIS
  ekspor_geojson()  PostgreSQL -> berkas statis untuk CDN

Yang kedua adalah mitigasi free tier yang tertulis di docs/arsitektur.md tetapi
belum pernah dikerjakan. Backend Render tidur setelah menganggur dan butuh
puluhan detik untuk bangun; kalau juri membuka tautan lebih dulu, halaman
terlihat rusak. Dengan layer disajikan sebagai berkas statis dari Cloudflare,
peta tetap tampil walau backend masih bangun.

Dijalankan dari dalam folder ini:

    cd pipeline && python s7_publish.py --muat
    cd pipeline && python s7_publish.py --ekspor
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any, Iterable

import pandas as pd
from sqlalchemy import create_engine, delete, select, text
from sqlalchemy.orm import Session, sessionmaker

from config import (
    DATA_MENTAH,
    DATA_OLAHAN,
    KAWASAN_PILOT,
    KODE_KE_KOLOM,
    ROOT,
    tingkat_keyakinan,
)

# Berkas statis ditulis ke sini lalu di-deploy bersama frontend.
EKSPOR = ROOT.parent / "frontend" / "public" / "data"

# Ditulis per potongan supaya satu kawasan besar tidak menahan seluruh transaksi
# di memori. Angka ini kompromi biasa: cukup besar untuk mengurangi round-trip,
# cukup kecil untuk tidak melampaui batas parameter pgbouncer.
UKURAN_POTONG = 500

# Presisi koordinat pada berkas statis. Enam desimal ≈ 11 cm, jauh lebih halus
# daripada yang bisa dibedakan mata pada heksagon selebar 350 m, dan memangkas
# ukuran berkas secara nyata.
DESIMAL_GEOJSON = 6


def _mesin():
    """Koneksi dibaca dari backend/.env - satu tempat, bukan dua.

    Kalau pipeline punya DATABASE_URL sendiri, cepat atau lambat keduanya
    menunjuk basis data yang berbeda dan hasil pipeline "hilang" tanpa ada yang
    error.
    """
    env = ROOT.parent / "backend" / ".env"
    url = os.environ.get("DATABASE_URL")
    if not url and env.exists():
        for baris in env.read_text(encoding="utf-8").splitlines():
            if baris.strip().startswith("DATABASE_URL="):
                url = baris.split("=", 1)[1].strip()
                break
    if not url:
        raise SystemExit(
            "DATABASE_URL tidak ditemukan. Isi backend/.env atau ekspor sebagai "
            "environment variable."
        )
    return create_engine(url, connect_args={"prepare_threshold": None}, pool_pre_ping=True)


def _potong(baris: list[dict], n: int = UKURAN_POTONG) -> Iterable[list[dict]]:
    for i in range(0, len(baris), n):
        yield baris[i : i + n]


def _bersih(nilai: Any) -> Any:
    """NaN pandas -> None SQL.

    Ini bukan kerapian: NaN yang lolos ke basis data akan tersimpan sebagai
    'NaN'::float di kolom numerik PostgreSQL, dan NaN itu TIDAK sama dengan NULL.
    `WHERE kolom IS NULL` tidak akan menemukannya, sedangkan setiap perbandingan
    dengannya bernilai false - jadi heksagonnya diam-diam hilang dari setiap
    filter tanpa pernah memunculkan galat.
    """
    if nilai is None or (isinstance(nilai, float) and pd.isna(nilai)):
        return None
    if isinstance(nilai, (pd.Timestamp,)):
        return nilai.to_pydatetime()
    if hasattr(nilai, "item"):  # numpy scalar
        return nilai.item()
    return nilai


# ---------------------------------------------------------------------------
# DataFrame -> basis data
# ---------------------------------------------------------------------------


def muat_skor(db: Session, skor: pd.DataFrame, versi: str = "baseline") -> int:
    """Muat keluaran s6_score.skor_lengkap() ke location_scores.

    `versi` yang sama ditimpa seluruhnya, bukan diperbarui baris per baris.
    Alasannya: skor adalah hasil satu kali perhitungan atas seluruh kawasan -
    memperbarui sebagian akan menghasilkan campuran dua perhitungan yang
    peringkatnya tidak lagi konsisten satu sama lain.
    """
    if skor.empty:
        return 0

    db.execute(text("DELETE FROM location_scores WHERE versi = :versi"), {"versi": versi})

    kolom = [
        "ipt", "iae", "ikp", "ibr", "opportunity_score", "hidden_gem_score",
        "residual_biaya", "iptt", "prestise_visual", "kuadran",
        "n_metode_lolos", "peringkat",
    ]
    baris = [
        {
            "h3_index": h3,
            "versi": versi,
            **{k: _bersih(r.get(k)) for k in kolom},
        }
        for h3, r in skor.to_dict(orient="index").items()
    ]

    sisip = text(
        "INSERT INTO location_scores "
        "(h3_index, versi, ipt, iae, ikp, ibr, opportunity_score, hidden_gem_score, "
        " residual_biaya, iptt, prestise_visual, kuadran, n_metode_lolos, peringkat) "
        "VALUES (:h3_index, :versi, :ipt, :iae, :ikp, :ibr, :opportunity_score, "
        " :hidden_gem_score, :residual_biaya, :iptt, :prestise_visual, :kuadran, "
        " :n_metode_lolos, :peringkat)"
    )
    for bagian in _potong(baris):
        db.execute(sisip, bagian)
    return len(baris)


def muat_faktor(db: Session, faktor: pd.DataFrame, versi: str = "baseline") -> int:
    """Muat keluaran s6_score.rincian_faktor() ke score_factors.

    Tabel ini sempat tidak pernah diisi oleh siapa pun, dan akibatnya tidak
    terlihat sebagai galat: `/hex/{h3}` tetap menjawab 200, cuma dengan
    `faktor: []`. Yang hilang justru dua janji sekaligus - panel "Kenapa skornya
    segitu" untuk pelanggan, dan `sumber_angka` yang membuat setiap angka dalam
    jawaban AI bisa ditelusuri.

    Ditimpa seluruhnya per `versi`, sama seperti muat_skor. Rincian dan skor
    WAJIB berasal dari satu perhitungan yang sama: kalau tercampur dua
    perhitungan, jumlah kontribusi sebuah indeks tidak lagi sama dengan nilai
    indeks yang tertulis di sebelahnya - dan selisih itu persis hal yang paling
    mungkin ditanyakan juri.
    """
    if faktor.empty:
        return 0

    db.execute(text("DELETE FROM score_factors WHERE versi = :versi"), {"versi": versi})

    kolom = [
        "h3_index", "kode_variabel", "indeks",
        "nilai_mentah", "nilai_normalisasi", "persentil", "kontribusi",
    ]
    baris = [
        {"versi": versi, **{k: _bersih(r.get(k)) for k in kolom}}
        for r in faktor.to_dict(orient="records")
    ]
    sisip = text(
        "INSERT INTO score_factors "
        "(h3_index, versi, kode_variabel, indeks, nilai_mentah, nilai_normalisasi, "
        " persentil, kontribusi) "
        "VALUES (:h3_index, :versi, :kode_variabel, :indeks, :nilai_mentah, "
        " :nilai_normalisasi, :persentil, :kontribusi)"
    )
    for bagian in _potong(baris):
        db.execute(sisip, bagian)
    return len(baris)


def muat_profil_jam(db: Session, profil: pd.DataFrame) -> int:
    """Muat keluaran s4_spatial.profil_jam() ke hex_hourly_profiles."""
    if profil.empty:
        return 0

    h3 = sorted(profil["h3_index"].unique().tolist())
    db.execute(
        text("DELETE FROM hex_hourly_profiles WHERE h3_index = ANY(:h3)"), {"h3": h3}
    )

    baris = [
        {k: _bersih(v) for k, v in r.items()}
        for r in profil.to_dict(orient="records")
    ]
    sisip = text(
        "INSERT INTO hex_hourly_profiles "
        "(h3_index, jam, n_transaksi, nominal_total, nominal_median, pangsa_captive, metode) "
        "VALUES (:h3_index, :jam, :n_transaksi, :nominal_total, :nominal_median, "
        " :pangsa_captive, :metode)"
    )
    for bagian in _potong(baris):
        db.execute(sisip, bagian)
    return len(baris)


def muat_variabel(db: Session, hex_df: pd.DataFrame) -> int:
    """Perbarui sebagian kolom variabel di hex_features.

    Berbeda dari skor, di sini yang dilakukan UPDATE dan bukan hapus-lalu-sisip:
    hex_features punya kunci asing dari tabel lain, dan barisnya dibuat sekali
    saat grid H3 dibangun. Yang berubah tiap kali pipeline jalan hanya isinya.

    Hanya kolom yang benar-benar ada di DataFrame yang disentuh. Kolom yang tidak
    dikirim TIDAK dinolkan - kalau s4 baru menghitung sebagian dimensi, sisanya
    harus tetap seperti semula, bukan hilang.
    """
    if hex_df.empty:
        return 0

    kolom_sah = set(KODE_KE_KOLOM.values())
    kolom = [k for k in hex_df.columns if k in kolom_sah]
    if not kolom:
        return 0

    set_klausa = ", ".join(f"{k} = :{k}" for k in kolom)
    ubah = text(f"UPDATE hex_features SET {set_klausa} WHERE h3_index = :h3_index")

    baris = [
        {"h3_index": h3, **{k: _bersih(r.get(k)) for k in kolom}}
        for h3, r in hex_df.to_dict(orient="index").items()
    ]
    for bagian in _potong(baris):
        db.execute(ubah, bagian)
    return len(baris)


# ---------------------------------------------------------------------------
# OpenStreetMap -> business_pois + variabel Kompetisi/Konteks
# ---------------------------------------------------------------------------


def muat_poi(db: Session, poi: pd.DataFrame) -> int:
    """Muat keluaran `s2_clean.poi_dari_osm` ke `business_pois`.

    Yang dihapus lebih dulu HANYA baris bersumber `osm`. POI hasil misi MAPID
    tidak boleh ikut terhapus hanya karena OSM ditarik ulang - keduanya sumber
    yang berbeda dengan siklus pembaruan yang berbeda.

    Kalau ada `menu_observations` atau `receipt_observations` yang menunjuk POI
    yang akan dihapus, kunci asingnya akan MENOLAK penghapusan itu dan seluruh
    transaksi batal. Itu bukan kekurangan yang harus dikerjakan sekitarnya: satu
    observasi yang kehilangan POI-nya adalah observasi yang tidak bisa lagi
    dijelaskan asalnya, dan gagal dengan berisik jauh lebih baik daripada
    menggantung baris misi yang mahal didapat.

    Heksagon di luar 708 yang diskor sengaja ikut disimpan - C01 menghitung
    k-ring 1, jadi kompetitor di seberang batas kawasan wajib ada di tabel ini.
    """
    db.execute(text("DELETE FROM business_pois WHERE sumber = 'osm'"))
    if poi.empty:
        return 0

    sisip = text(
        "INSERT INTO business_pois "
        "(h3_index, nama, kelas_induk, kategori_asli, sumber, is_waralaba, geom) "
        "VALUES (:h3_index, :nama, :kelas_induk, :kategori_asli, :sumber, "
        " :is_waralaba, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))"
    )
    baris = [
        {k: _bersih(v) for k, v in r.items()}
        for r in poi.to_dict(orient="records")
    ]
    for bagian in _potong(baris):
        db.execute(sisip, bagian)
    return len(baris)


def muat_osm(db: Session, berkas: Path | None = None) -> dict[str, int]:
    """Berkas mentah OSM -> business_pois + C01, C02, C03, C05, C06, D08, D09.

    Satu fungsi, satu transaksi, karena ketiganya satu pernyataan yang sama:
    `business_pois` adalah BUKTI di balik angka kompetisi, dan basis data yang
    memuat angkanya tanpa memuat buktinya - atau sebaliknya - tidak bisa
    dipertanggungjawabkan ke siapa pun yang bertanya "dari mana angkanya".

    D01 dibaca dari basis data, bukan dihitung, karena C06 = C01 / D01 dan D01
    milik dimensi Permintaan. Heksagon yang D01-nya kosong menghasilkan C06
    kosong - bukan nol (aturan 4).
    """
    from s2_clean import konteks_dari_osm, poi_dari_osm
    from s4_spatial import dimensi_kompetisi, dimensi_konteks

    berkas = berkas or DATA_MENTAH / "osm_poi.json"
    if not berkas.exists():
        raise SystemExit(
            f"{berkas} belum ada. Jalankan dulu:  python s1_ingest.py --poi"
        )
    elemen = json.loads(berkas.read_text(encoding="utf-8")).get("elements", [])

    poi = poi_dari_osm(elemen)
    n_poi = muat_poi(db, poi)

    pop = pd.read_sql(
        "SELECT h3_index, pop_100m FROM hex_features", db.connection()
    ).set_index("h3_index")["pop_100m"]

    # `semua_hex` diberikan ke KEDUANYA, dan itu bukan kerapian. Tanpa itu,
    # heksagon yang tidak punya satu pun POI tidak muncul di hasil, tidak ikut
    # ter-UPDATE, dan mempertahankan angka sintetis `demo_seed` di kolom yang
    # tepat di sebelah angka OSM sungguhan - satu kolom berisi dua jenis angka,
    # tanpa galat dan tanpa cara membedakannya dari luar.
    #
    # Heksagon di luar 708 yang diskor otomatis gugur lewat reindex ini. Mereka
    # tetap hidup di business_pois - dipakai C01, tidak pernah dinilai sendiri.
    semua = pop.index
    variabel = dimensi_kompetisi(poi, pop=pop, semua_hex=semua).join(
        dimensi_konteks(konteks_dari_osm(elemen), semua_hex=semua), how="left"
    )
    return {
        "poi": n_poi,
        "elemen": len(elemen),
        "heksagon": muat_variabel(db, variabel),
    }


# ---------------------------------------------------------------------------
# Basis data -> basis data: variabel yang sumbernya sudah ada di dalam DB
# ---------------------------------------------------------------------------
# Dua fungsi di bawah berbeda dari muat_* di atas: masukannya bukan berkas hasil
# pipeline, melainkan tabel yang SUDAH terisi. Keduanya dibuat untuk satu pola
# yang akan berulang - sebuah variabel berpindah dari sintetis ke nyata, dan
# seluruh skor harus mengikutinya.


def muat_transit(db: Session, berkas_rute: Path | None = None,
                 berkas_henti: Path | None = None) -> dict[str, int]:
    """Relasi rute + titik henti OSM -> D05 `skor_simpul`.

    Menggantikan satu-satunya variabel berbobot terbesar di IPT (0,40) yang
    selama ini diisi `rng` oleh `demo_seed`. Yang menggantikannya bisa
    dijelaskan dalam satu kalimat ke juri: jumlah rute angkutan umum BERBEDA
    yang berhenti di heksagon itu dan tetangganya, ditimbang menurut kapasitas
    modanya.

    Dua berkas, bukan satu, karena Overpass tidak bisa memberi keduanya
    sekaligus: `out body` pada relasi membawa daftar anggota TANPA koordinat,
    dan menariknya bersama geometri menghasilkan respons puluhan megabyte yang
    dijawab 504. Jadi relasi ditarik untuk keanggotaannya, titik henti ditarik
    untuk koordinatnya, dan keduanya disatukan lewat id OSM di sini.
    """
    from s2_clean import henti_dari_osm, rute_dari_osm
    from s4_spatial import bobot_simpul

    berkas_rute = berkas_rute or DATA_MENTAH / "osm_rute.json"
    berkas_henti = berkas_henti or DATA_MENTAH / "osm_henti.json"
    for b, bendera in ((berkas_rute, "--rute"), (berkas_henti, "--henti")):
        if not b.exists():
            raise SystemExit(
                f"{b} belum ada. Jalankan dulu:  python s1_ingest.py {bendera}"
            )

    rute = rute_dari_osm(
        json.loads(berkas_rute.read_text(encoding="utf-8")).get("elements", [])
    )
    henti = henti_dari_osm(
        json.loads(berkas_henti.read_text(encoding="utf-8")).get("elements", [])
    )

    semua = pd.read_sql(
        "SELECT h3_index FROM hex_features", db.connection()
    ).set_index("h3_index").index

    # `semua_hex` diberikan supaya heksagon TANPA rute ikut ter-UPDATE jadi nol.
    # Tanpa itu ia mempertahankan angka `demo_seed` di kolom yang sama dengan
    # angka OSM - jebakan yang sudah dua kali kena di repo ini.
    d05 = bobot_simpul(henti, rute, semua_hex=semua)
    n = muat_variabel(db, pd.DataFrame({"skor_simpul": d05}))
    return {
        "lin_angkutan": int(rute["lin"].nunique()),
        "titik_henti": len(henti),
        "henti_cocok": int(rute.merge(henti[["ref"]], on="ref")["ref"].nunique()),
        "heksagon": n,
        "heksagon_berute": int((d05 > 0).sum()),
    }


#: Variabel yang MASIH diisi `demo_seed` dan tidak punya sumber sah per
#: 27 Agustus 2026. Dikosongkan, bukan dibiarkan - dan sebabnya aturan 4 repo
#: ini: "kosong tetap kosong". Angka karangan di kolom yang sama dengan angka
#: hasil pengukuran tidak bisa dibedakan dari luar oleh siapa pun, termasuk oleh
#: juri yang bertanya "yang ini datanya dari mana".
#:
#: Mengosongkannya TIDAK meruntuhkan skor: `s6_score._tertimbang()` menetralkan
#: variabel hilang jadi 0,5, bukan menolkannya. Indeks yang seluruh variabelnya
#: kosong menjadi tetapan 0,5 untuk setiap heksagon - artinya ia berhenti
#: membedakan, dan itu memang pernyataan yang benar tentangnya.
#:
#: Alasan per variabel ada di docs/data.md bagian 10.
KOLOM_SINTETIS = {
    # --- Menunggu LLM_API_KEY (foto misi MAPID sudah ada, tinggal dibaca) ---
    "puncak_pagi": "B01 - jam transaksi ada di FOTO struk, menunggu A2",
    "puncak_siang": "B02 - idem. Seluruh 708 heksagon berisi tetapan 0,20",
    "puncak_sore": "B03 - idem",
    "puncak_malam": "B04 - idem",
    "rasio_weekend": "B05 - menuntut tanggal transaksi, ada di foto",
    "nominal_median_struk": "B09 - nominal struk ada di foto, menunggu A2",
    "belanja_per_jam": "B10 - turunan B09 x D11",
    "intensitas_transaksi": "D11 - menuntut hitungan struk bertanggal",
    "skor_prestise_visual": "M03 - menuntut foto fasad, menunggu A3",
    "harga_sewa_median": "P05 - papan sewa ada di foto Properti Go",
    "rasio_sewa_jual": "P04 - turunan P05 / harga jual",
    "harga_sewa_per_m2": "P07 - turunan P05 / luas",
    # --- Sumber ada tetapi terkunci / tidak menjawab -----------------------
    "njop_m2": "P01 - Bhumi & Bapenda ArcGIS menuntut token, lihat 10.4",
    "njop_persentil": "P02 - turunan P01",
    "ridership_proksi": "D06 - angka resmi per stasiun tersebar di tiga operator "
                        "dengan tiga satuan yang tidak bisa disatukan, lihat 10.4",
    # --- Diukur, dan pengukurannya justru yang menolak variabelnya ---------
    "pop_usia_produktif": "D02 - pangsa produktif se-DKI cuma 0,677-0,720, jadi "
                          "D02 = pangsa x D01 hanya salinan D01 yang diperkecil",
    "kepadatan_kos": "D07 - 42 kos di antara 367.522 bangunan OSM se-6 kawasan",
    # --- Tidak punya sumber sama sekali ------------------------------------
    "indeks_churn": "P06 - menuntut pengamatan berulang bertanggal atas titik "
                    "yang sama. Satu potret tidak bisa menghasilkannya",
}


def kosongkan_sintetis(db: Session, kolom: dict[str, str] | None = None) -> dict[str, int]:
    """Setel NULL setiap kolom yang isinya masih karangan `demo_seed`.

    Ini operasi yang MEMBUANG angka, jadi ia sengaja tidak pernah dipanggil
    diam-diam oleh jalur muat mana pun - hanya lewat `--kosongkan` yang
    dituliskan orang. Yang dibuang tidak bisa dikembalikan tanpa menjalankan
    `demo_seed` lagi, dan `demo_seed` sekarang menolak jalan di basis data yang
    memuat data nyata.

    `hex_hourly_profiles` ikut dikosongkan, dan itu bagian yang paling penting.
    Tabel itu berisi 7.186 baris untuk 474 heksagon bertanda `sumber_data =
    'observed'` - seluruhnya dibangkitkan `demo_seed` dari struk karangan,
    sementara `receipt_observations` sungguhan cuma 12 baris dan tidak satu pun
    membawa jam (API misi MAPID mengembalikan `tanggal` kosong di 691 dari 691
    titik). Jadi ia bukan sekadar angka sintetis melainkan angka sintetis yang
    MENGAKU hasil pengamatan, dan ia menggerakkan Commuter Clock - fitur
    berbayar. Persis kesalahan yang sudah pernah diperbaiki pada badge
    keyakinan, terulang di tabel yang berbeda.

    Mengosongkannya aman: `/hex/{h3}/commuter-clock` sudah menangani tabel
    kosong dengan benar - tiap jam tetap dikirim, `jam_puncak` dan `dominasi`
    jadi None, dan `catatan` berbunyi "Belum ada profil jam untuk heksagon ini".

    Yang dikembalikan jumlah baris yang SEBELUMNYA terisi per kolom, supaya
    yang terjadi bisa dilaporkan apa adanya alih-alih "selesai".
    """
    kolom = kolom or KOLOM_SINTETIS
    hasil = {}
    n_jam = db.execute(
        text("SELECT count(*) FROM hex_hourly_profiles")
    ).scalar_one()
    if n_jam:
        db.execute(text("DELETE FROM hex_hourly_profiles"))
    hasil["hex_hourly_profiles (baris)"] = int(n_jam)
    for k in kolom:
        n = db.execute(
            text(f"SELECT count({k}) FROM hex_features")  # noqa: S608 - kunci dari konstanta
        ).scalar_one()
        db.execute(text(f"UPDATE hex_features SET {k} = NULL WHERE {k} IS NOT NULL"))
        hasil[k] = int(n)
    return hasil


def isi_d04_dari_rute(db: Session) -> dict[str, int]:
    """Alirkan jarak (D03) dan waktu (D04) sungguhan dari `hex_routes`.

    `hex_routes` berisi hasil OpenRouteService di atas jaringan jalan OSM;
    kedua kolom itu selama ini diisi `demo_seed` sebagai fungsi jarak garis
    lurus. Fungsi ini menutup jarak antara keduanya.

    D03 ikut karena `models.py` memang menandainya "OSM+OSRM" - ia selalu
    dimaksudkan jarak JARINGAN JALAN, bukan garis lurus. Ia juga tidak muncul
    di satu pun bobot indeks (IPT memakai D05, D06, D04), jadi mengisinya tidak
    menggeser satu pun peringkat: yang berubah cuma angka yang dibaca orang.

    Yang TIDAK dilakukan di sini: menghitung ulang skor. Mengisi variabel dan
    menghitung ulang peringkat adalah dua keputusan yang berbeda - yang pertama
    memperbaiki satu angka, yang kedua mengubah setiap angka di layar. Pemanggil
    yang memilih, lewat `hitung_ulang_dari_db()`.
    """
    from s4_spatial import simpul_terdekat_dari_rute

    rute = pd.read_sql(
        "SELECT h3_index, jarak_m, menit FROM hex_routes", db.connection()
    )
    hex_df = simpul_terdekat_dari_rute(rute)
    if hex_df.empty:
        return {"dirutekan": 0, "diperbarui": 0, "tanpa_rute": 0}

    n = muat_variabel(db, hex_df)
    total = db.execute(text("SELECT count(*) FROM hex_features")).scalar_one()
    return {"dirutekan": len(hex_df), "diperbarui": n, "tanpa_rute": total - n}


# --- Grid heksagon ----------------------------------------------------------


def _grid_diharapkan() -> dict[str, list[str]]:
    """Grid yang SEHARUSNYA ada, diturunkan dari config.PUSAT.

    Salinan logika `demo_seed._grid()`, dan salinan itu disengaja: fungsi ini
    harus tetap bisa dipanggil setelah `demo_seed` berhenti boleh dijalankan di
    basis data berisi data nyata. Yang penting keduanya membaca PUSAT yang sama.

    Heksagon yang diklaim dua kawasan jatuh ke pusat TERDEKAT - Manggarai dan
    Dukuh Atas BNI hanya berjarak ~2,5 km sementara jari-jari cincinnya ~2 km.
    """
    import math

    import h3

    from config import CINCIN_PILOT, H3_RESOLUSI, PUSAT

    klaim: dict[str, tuple[str, float]] = {}
    for kawasan, (lat0, lon0) in PUSAT.items():
        pusat = h3.latlng_to_cell(lat0, lon0, H3_RESOLUSI)
        for sel in h3.grid_disk(pusat, CINCIN_PILOT):
            lat, lon = h3.cell_to_latlng(sel)
            jarak = math.hypot(lat - lat0, lon - lon0)
            sudah = klaim.get(sel)
            if sudah is None or jarak < sudah[1]:
                klaim[sel] = (kawasan, jarak)

    hasil: dict[str, list[str]] = {k: [] for k in PUSAT}
    for sel, (kawasan, _) in klaim.items():
        hasil[kawasan].append(sel)
    return {k: sorted(v) for k, v in hasil.items()}


def _wkt_heksagon(sel: str) -> str:
    """Batas heksagon sebagai WKT. h3 memberi (lat, lng); PostGIS mau (lng, lat)."""
    import h3

    titik = h3.cell_to_boundary(sel)
    cincin = ", ".join(f"{lng} {lat}" for lat, lng in titik)
    lat0, lng0 = titik[0]
    return f"SRID=4326;POLYGON(({cincin}, {lng0} {lat0}))"


def periksa_grid(db: Session) -> dict[str, object]:
    """Bandingkan grid basis data dengan yang diturunkan dari config.PUSAT.

    Tidak mengubah apa pun. Dipisah dari `selaraskan_grid` supaya keadaannya
    bisa ditanyakan tanpa risiko - dan supaya `--grid` tanpa `--muat` selalu
    aman dijalankan siapa pun.
    """
    harap = _grid_diharapkan()
    milik_harap = {sel: kw for kw, sel_list in harap.items() for sel in sel_list}

    ada = dict(
        db.execute(text("SELECT h3_index, kawasan FROM hex_features")).all()
    )

    tambah = sorted(set(milik_harap) - set(ada))
    buang = sorted(set(ada) - set(milik_harap))
    pindah_kawasan = sorted(
        sel for sel in set(ada) & set(milik_harap) if ada[sel] != milik_harap[sel]
    )
    return {
        "diharapkan": len(milik_harap),
        "di_basis_data": len(ada),
        "tambah": tambah,
        "buang": buang,
        "pindah_kawasan": pindah_kawasan,
        "milik": milik_harap,
    }


def selaraskan_grid(db: Session, beda: dict[str, object]) -> dict[str, int]:
    """Terapkan selisihnya. MENGHAPUS heksagon, jadi ia menghapus turunannya juga.

    Yang ikut terhapus lewat ON DELETE CASCADE: `hex_routes`, `location_scores`,
    `score_factors`, `hex_hourly_profiles`. Yang TIDAK punya cascade dan harus
    dibereskan sendiri: `business_pois` - ia berkolom `h3_index` tanpa foreign
    key, jadi barisnya akan tertinggal sebagai POI yatim yang ikut terhitung di
    variabel kompetisi kawasan lain.

    Heksagon BARU disisipkan kosong: nol titik misi, keyakinan RENDAH, sumber
    `predicted`. Bukan kelalaian - heksagon yang baru saja dibuat memang belum
    punya satu pun pengukuran, dan mengisinya dengan apa pun selain kosong
    adalah persis kesalahan yang aturan 4 larang.
    """
    tambah = beda["tambah"]
    buang = beda["buang"]
    milik = beda["milik"]
    n_poi = 0

    if buang:
        # POI dulu, selagi heksagonnya masih ada - supaya yang dihapus persis
        # yang termasuk heksagon itu, bukan hasil tebakan sesudahnya.
        for potongan in _potong([{"h": h} for h in buang], 200):
            daftar = [b["h"] for b in potongan]
            n_poi += db.execute(
                text("DELETE FROM business_pois WHERE h3_index = ANY(:d)"), {"d": daftar}
            ).rowcount
            db.execute(
                text("DELETE FROM hex_features WHERE h3_index = ANY(:d)"), {"d": daftar}
            )

    if tambah:
        for potongan in _potong([{"h": h} for h in tambah], 200):
            db.execute(
                text(
                    "INSERT INTO hex_features "
                    "(h3_index, kawasan, geom, n_titik_misi, tingkat_keyakinan, data_source) "
                    "VALUES (:h3, :kw, ST_GeomFromEWKT(:wkt), 0, 'RENDAH', 'predicted')"
                ),
                [
                    {"h3": b["h"], "kw": milik[b["h"]], "wkt": _wkt_heksagon(b["h"])}
                    for b in potongan
                ],
            )

    n_pindah = 0
    for sel in beda["pindah_kawasan"]:
        n_pindah += db.execute(
            text("UPDATE hex_features SET kawasan = :kw WHERE h3_index = :h3"),
            {"kw": milik[sel], "h3": sel},
        ).rowcount

    return {
        "dihapus": len(buang),
        "poi_dihapus": n_poi,
        "ditambah": len(tambah),
        "kawasan_diperbarui": n_pindah,
    }


def selaraskan_simpul(db: Session) -> dict[str, int]:
    """Simpul transit ikut pindah bersama pusat kawasannya.

    UPSERT menurut kawasan, tidak pernah DELETE: `hex_routes` dan
    `catchment_areas` keduanya ON DELETE CASCADE dari `transport_nodes`, jadi
    menghapus satu simpul membuang seluruh rute ORS yang menempel padanya.
    """
    from config import PUSAT

    n = 0
    for kawasan, (lat, lon) in PUSAT.items():
        n += db.execute(
            text(
                "UPDATE transport_nodes SET geom = ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) "
                "WHERE kawasan = :kw AND ST_Distance("
                "  geom::geography, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography"
                ") > 1"
            ),
            {"lat": lat, "lon": lon, "kw": kawasan},
        ).rowcount
    return {"simpul_dipindah": n}


def muat_rdtr(db: Session, berkas: Path | None = None) -> dict[str, int]:
    """Zonasi RDTR ATR/BPN -> L01 izin usaha, L02 kelas zona, L03 risiko banjir.

    L03 diambil dari kolom `KRB_03` RDTR ("Kawasan Rawan Banjir - Sangat
    Tinggi"), bukan dari InaRISK. Keduanya sumber resmi; yang ini menang karena
    ia datang dalam poligon yang SAMA dengan zonasinya, jadi risiko banjir dan
    izin usaha selalu menggambarkan bidang yang sama persis - dan karena layanan
    InaRISK menjawab 503 sepanjang 26 Agu 2026.

    CAKUPAN: hanya DKI Jakarta. Tiga dari enam kawasan pilot. Kota Depok dan
    Kota Bekasi tidak terdaftar di GISTARU sama sekali, jadi Depok Baru,
    Bekasi, dan Harjamukti tetap `TIDAK_DIKETAHUI` - dan itu memang jawaban
    yang benar untuk mereka, bukan kekurangan yang harus ditutupi.
    """
    from s4_spatial import dimensi_lahan

    berkas = berkas or DATA_MENTAH / "rdtr_dki.json"
    if not berkas.exists():
        raise SystemExit(
            f"{berkas} belum ada. Jalankan dulu:  python s1_ingest.py --rdtr"
        )
    rdtr = json.loads(berkas.read_text(encoding="utf-8"))

    semua = pd.read_sql("SELECT h3_index FROM hex_features", db.connection())["h3_index"]
    if semua.empty:
        raise SystemExit("hex_features kosong - bangun grid H3 dulu.")

    variabel = dimensi_lahan(rdtr, semua_hex=pd.Index(semua))
    izin = variabel["zona_izin_komersial"]
    return {
        "ditanya": len(rdtr),
        "berzona": int(variabel["kelas_zona"].notna().sum()),
        "diizinkan": int((izin == True).sum()),          # noqa: E712
        "dilarang": int((izin == False).sum()),          # noqa: E712
        "tak_diketahui": int(len(variabel) - (izin == True).sum() - (izin == False).sum()),  # noqa: E712
        "heksagon": muat_variabel(db, variabel),
    }


def muat_misi(db: Session, berkas: Path | None = None) -> dict[str, int]:
    """Data misi MAPID -> tabel observasi + variabel per heksagon + Q01/Q02.

    Tiga tabel observasi diisi APA ADANYA per titik, dan itu memang tempatnya:
    aturan lomba melarang data misi mentah KELUAR lewat API atau layar, bukan
    melarang menyimpannya. `backend/app/schemas.py` yang menegakkan batasnya -
    tidak satu pun skema membawa record misi, jadi secara struktur ia tidak bisa
    terkirim. Menyimpannya perlu supaya A1/A2/A3 punya `foto_url` untuk dikerjakan
    tanpa menarik ulang seluruh dataset.

    Yang ditulis ke `hex_features` hanya AGREGAT, dan hanya untuk heksagon yang
    benar-benar disurvei. Sisanya dibiarkan NULL - lihat catatan panjang di
    `s4_spatial.dimensi_misi` soal kenapa nol akan berbohong di sini padahal
    tidak berbohong untuk OSM.
    """
    from s2_clean import (
        aktivitas_dari_mapid,
        menu_dari_mapid,
        properti_dari_mapid,
        struk_dari_mapid,
    )
    from s4_spatial import dimensi_misi

    berkas = berkas or DATA_MENTAH / "mapid_misi.json"
    if not berkas.exists():
        raise SystemExit(
            f"{berkas} belum ada. Jalankan dulu:  python s1_ingest.py --misi"
        )
    mentah = json.loads(berkas.read_text(encoding="utf-8"))

    menu = menu_dari_mapid(mentah.get("menugo", []))
    struk = struk_dari_mapid(mentah.get("struckgo", []))
    properti = properti_dari_mapid(mentah.get("propertigo", []))
    aktivitas = aktivitas_dari_mapid(mentah.get("activities", []))

    semua = pd.read_sql("SELECT h3_index FROM hex_features", db.connection())["h3_index"]
    if semua.empty:
        raise SystemExit("hex_features kosong - bangun grid H3 dulu.")
    di_dalam = set(semua)

    # Hanya titik yang jatuh di heksagon yang diskor. Sisanya (Jabodetabek luas)
    # tidak dibuang karena salah, melainkan karena tidak ada tempatnya: tabel
    # observasi berkunci h3_index, dan heksagon di luar 708 tidak ada di peta.
    tersimpan = {}
    for nama, df, tabel, kolom in (
        ("menu", menu, "menu_observations",
         ["h3_index", "nama_usaha", "kondisi_pembeli", "waktu_kunjungan",
          "mobilitas_keliling", "harga_rata_porsi", "menu_andalan"]),
        # `ocr_terverifikasi` ikut ditulis eksplisit. Kolomnya NOT NULL dengan
        # `default=False` di ORM, dan default ORM TIDAK berlaku untuk INSERT SQL
        # mentah - yang lewat cuma NULL, lalu ditolak basis data. Gagalnya
        # berisik, jadi tidak berbahaya; tetapi ia mudah terulang untuk kolom
        # berdefault berikutnya.
        ("struk", struk, "receipt_observations",
         ["h3_index", "nama_merchant", "waktu_transaksi", "metode_bayar", "foto_url",
          "ocr_terverifikasi"]),
        ("properti", properti, "property_observations",
         ["h3_index", "kategori", "status", "foto_spanduk_url", "ocr_terverifikasi"]),
    ):
        db.execute(text(f"DELETE FROM {tabel}"))
        di = df[df["h3_index"].isin(di_dalam)]
        tersimpan[nama] = len(di)
        if di.empty:
            continue
        sisip = text(
            f"INSERT INTO {tabel} ({', '.join(kolom)}, geom) VALUES "
            f"({', '.join(':' + k for k in kolom)}, "
            f"ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))"
        )
        baris = [
            {k: (False if k == "ocr_terverifikasi" else _bersih(r.get(k)))
             for k in kolom + ["lat", "lon"]}
            for r in di.to_dict(orient="records")
        ]
        for bagian in _potong(baris):
            db.execute(sisip, bagian)

    variabel = dimensi_misi(menu, struk, properti, aktivitas, semua_hex=pd.Index(semua))

    # Q01/Q02: penanda kualitas, BUKAN variabel model. Ditulis terpisah dari
    # `muat_variabel` karena `n_titik_misi` dan `tingkat_keyakinan` sengaja
    # tidak ada di KODE_KE_KOLOM - keduanya menjelaskan skor, tidak menyusunnya.
    q = variabel.pop("n_titik_misi")
    db.execute(
        text("UPDATE hex_features SET n_titik_misi = :n, tingkat_keyakinan = :t, "
             "data_source = :s WHERE h3_index = :h"),
        [
            {"h": h, "n": int(n), "t": tingkat_keyakinan(int(n)),
             "s": "observed" if n > 0 else "predicted"}
            for h, n in q.items()
        ],
    )

    return {
        "menu": tersimpan["menu"],
        "struk": tersimpan["struk"],
        "properti": tersimpan["properti"],
        "hex_disurvei": int((q > 0).sum()),
        "hex_variabel": muat_variabel(db, variabel),
    }


def muat_bangunan(db: Session, sumber: Path | None = None) -> dict[str, int]:
    """M01 rasio tutupan dan M02 luas median, dari footprint bangunan OSM.

    Membaca PETAK singgahan satu per satu kalau ada, dan jatuh ke berkas
    gabungan kalau tidak. Alasannya memori, dan angkanya terukur: `json.loads`
    membutuhkan sekitar 7,3x ukuran berkasnya sebagai objek Python, jadi
    gabungan ~200 MB menuntut ~1,5 GB sekaligus. Satu petak cukup 56 MB, dan
    yang disimpan sesudahnya bukan geometrinya melainkan dua angka per
    bangunan - jadi puncaknya tidak pernah tumbuh seiring jumlah petak.

    Bangunan yang melintasi batas petak dikembalikan Overpass di KEDUA petak,
    jadi dedup menurut (tipe, id) wajib. Tanpa itu ia terhitung dua kali dan
    M01 heksagon di sepanjang garis petak naik diam-diam.

    Tidak ada yang disimpan per bangunan. `business_pois` menyimpan POI karena
    tiap POI adalah kompetitor yang harus bisa ditelusuri satu per satu; sebuah
    footprint bukan apa-apa selain luasnya, dan seperempat juta poligon yang
    tidak pernah ditanyai satu per satu cuma akan memperlambat setiap kueri
    tabel itu.

    M02 masukan P07 `harga_sewa_per_m2` (= P05 / M02). Selama P05 masih
    sintetis, P07 pun tetap sintetis - mengisi M02 memperbaiki satu dari dua
    faktornya, dan itu tidak membuat hasil baginya jadi nyata.
    """
    from s2_clean import bangunan_dari_osm
    from s4_spatial import morfologi_bangunan

    petak = sorted((DATA_MENTAH / "_singgah").glob("bangunan_*.json"))
    if sumber is not None:
        berkas = [sumber]
    elif petak:
        berkas = petak
    else:
        gabungan = DATA_MENTAH / "osm_bangunan.json"
        if not gabungan.exists():
            raise SystemExit(
                f"{gabungan} belum ada. Jalankan dulu:  python s1_ingest.py --bangunan"
            )
        berkas = [gabungan]

    terlihat: set[tuple[str, int]] = set()
    potongan, n_elemen = [], 0
    for f in berkas:
        elemen = json.loads(f.read_text(encoding="utf-8")).get("elements", [])
        n_elemen += len(elemen)
        segar = []
        for e in elemen:
            kunci = (e.get("type"), e.get("id"))
            if kunci in terlihat:
                continue
            terlihat.add(kunci)
            segar.append(e)
        potongan.append(bangunan_dari_osm(segar))
        del elemen, segar

    bangunan = (
        pd.concat(potongan, ignore_index=True)
        if potongan
        else pd.DataFrame(columns=["h3_index", "luas_m2"])
    )

    semua = pd.read_sql("SELECT h3_index FROM hex_features", db.connection())["h3_index"]
    if semua.empty:
        raise SystemExit("hex_features kosong - bangun grid H3 dulu.")

    variabel = morfologi_bangunan(bangunan, semua_hex=pd.Index(semua))
    return {
        "berkas": len(berkas),
        "elemen": n_elemen,
        "unik_berluas": len(bangunan),
        "heksagon": muat_variabel(db, variabel),
    }


def isi_penduduk_dari_worldpop(db: Session, berkas: Path | None = None) -> dict[str, int]:
    """D01 `pop_100m` dari raster WorldPop, plus C06 yang bergantung padanya.

    Sumbernya `idn_ppp_2020_UNadj_constrained.tif` - WorldPop Global 2000-2020
    Constrained, disesuaikan ke total penduduk PBB. Lisensi CC BY 4.0, jadi
    boleh dipakai asal disebut; atribusinya ada di `/meta/siap`.

    C06 WAJIB ikut ditulis di sini. Ia didefinisikan C01 / D01, jadi mengganti
    penyebutnya tanpa menghitung ulang hasilnya meninggalkan basis data yang
    setiap barisnya konsisten dengan dirinya sendiri KECUALI yang satu itu -
    dan tidak ada galat yang akan memberi tahu siapa pun.

    BATAS YANG HARUS DIKETAHUI PEMBACANYA: produk `constrained` menyebar total
    sensus ke piksel yang terbangun, dan Jabodetabek terbangun hampir merata.
    Terukur atas 708 heksagon: rasio kuartil 3 terhadap kuartil 1 cuma 1,13 -
    praktis setiap heksagon ~1.900 jiwa. Jadi D01 di sini nyaris tidak menambah
    daya beda antar-lokasi; yang ia perbaiki adalah SKALA C06, bukan urutannya.
    Peningkatan sebenarnya menunggu data BPS tingkat kelurahan.

    D02 `pop_usia_produktif` sengaja TIDAK disentuh. Struktur umur menuntut
    raster AgeSex WorldPop - dua puluh berkas terpisah, sekitar 1 GB - dan
    mengalikan D01 dengan satu rasio nasional cuma akan menghasilkan salinan
    D01 yang berpura-pura jadi variabel lain.
    """
    import rasterio
    from rasterio.windows import from_bounds

    from s4_spatial import penduduk_per_heksagon, rasio_kompetitor_per_kapita

    berkas = berkas or DATA_MENTAH / "worldpop_idn_2020.tif"
    if not berkas.exists():
        raise SystemExit(
            f"{berkas} belum ada. Unduh dulu:\n"
            "  curl -L -o pipeline/data/01_mentah/worldpop_idn_2020.tif \\n"
            "    https://data.worldpop.org/GIS/Population/Global_2000_2020_Constrained"
            "/2020/BSGM/IDN/idn_ppp_2020_UNadj_constrained.tif"
        )

    hx = pd.read_sql(
        "SELECT h3_index, n_kompetitor_langsung, "
        "ST_XMin(geom::geometry) x0, ST_YMin(geom::geometry) y0, "
        "ST_XMax(geom::geometry) x1, ST_YMax(geom::geometry) y1 "
        "FROM hex_features",
        db.connection(),
    ).set_index("h3_index")
    if hx.empty:
        raise SystemExit("hex_features kosong - bangun grid H3 dulu.")

    # Bantalan satu piksel penuh di tiap sisi. Tanpa itu, heksagon yang
    # menyentuh tepi jendela kehilangan piksel yang separuhnya ada di luar.
    pad = 0.002
    with rasterio.open(berkas) as r:
        jendela = from_bounds(
            hx.x0.min() - pad, hx.y0.min() - pad,
            hx.x1.max() + pad, hx.y1.max() + pad,
            r.transform,
        )
        nilai = r.read(1, window=jendela)
        t = r.window_transform(jendela)
        d01 = penduduk_per_heksagon(nilai, t.c, t.f, t.a, -t.e, nodata=r.nodata)

    # Direindeks ke SELURUH heksagon yang diskor, dan yang tidak menerima
    # penduduk dibiarkan NaN supaya tertulis NULL - BUKAN dibuang dari daftar.
    # Kalau dibuang, `muat_variabel` tidak menyentuh barisnya dan heksagon itu
    # mempertahankan angka `demo_seed` di kolom yang sama dengan angka WorldPop.
    # Terjadi sungguhan 26 Agu 2026: satu heksagon Tanah Abang tertinggal
    # memegang 2521,07087899426 - sebelas angka di belakang koma di tengah
    # kolom yang seharusnya seluruhnya hasil pengukuran.
    #
    # Sel H3 di luar 708 yang kebetulan menerima piksel dari jendela yang sama
    # gugur lewat reindex ini; ia memang bukan urusan tabel ini.
    d01 = d01.reindex(hx.index)
    if d01.notna().sum() == 0:
        return {"berpenduduk": 0, "diperbarui": 0, "tanpa_penduduk": len(hx)}

    hex_df = pd.DataFrame({"pop_100m": d01})
    hex_df["rasio_kompetitor_per_kapita"] = rasio_kompetitor_per_kapita(
        hx["n_kompetitor_langsung"], d01
    )
    hex_df.index.name = "h3_index"
    n = muat_variabel(db, hex_df)
    return {
        "berpenduduk": int(d01.notna().sum()),
        "diperbarui": n,
        "tanpa_penduduk": int(d01.isna().sum()),
    }


def hitung_ulang_dari_db(db: Session, versi: str = "baseline") -> dict[str, int]:
    """Baca variabel dari hex_features, hitung ulang skor, muat kembali.

    Aturan 1 tetap utuh: aritmetikanya seluruhnya milik `s6_score`. Yang
    dikerjakan di sini cuma membaca, memanggil, dan menulis.

    `rincian_faktor` dijalankan atas DataFrame YANG SAMA, bukan salinan yang
    dibaca ulang. Normalisasi min-max bergantung pada seluruh baris yang ikut
    dihitung, jadi rincian yang dibangun dari kumpulan lain akan menjelaskan
    skor yang berbeda dari yang tersimpan - selisih yang tidak memunculkan
    galat apa pun dan hanya terlihat kalau angkanya dijumlahkan dengan tangan.
    """
    from s6_score import rincian_faktor, skor_lengkap

    kolom = sorted(set(KODE_KE_KOLOM.values()))
    hex_df = pd.read_sql(
        f"SELECT h3_index, {', '.join(kolom)} FROM hex_features", db.connection()
    ).set_index("h3_index")
    if hex_df.empty:
        raise SystemExit("hex_features kosong - tidak ada yang bisa dihitung.")

    skor = skor_lengkap(hex_df)
    faktor = rincian_faktor(hex_df)
    return {
        "skor": muat_skor(db, skor, versi),
        "faktor": muat_faktor(db, faktor, versi),
    }


def muat_semua(versi: str = "baseline") -> dict[str, int]:
    """Baca berkas hasil pipeline di data/03_olahan/ lalu muat semuanya.

    Seluruhnya dalam SATU transaksi. Kalau salah satu bagian gagal, tidak ada
    yang tersimpan - lebih baik daripada basis data berisi skor baru dengan
    profil jam lama, keadaan yang sulit disadari dan sulit diperbaiki.
    """
    berkas = {
        "hex": DATA_OLAHAN / "hex_features.parquet",
        "skor": DATA_OLAHAN / "location_scores.parquet",
        "profil": DATA_OLAHAN / "hex_hourly_profiles.parquet",
        "faktor": DATA_OLAHAN / "score_factors.parquet",
    }
    ada = {k: v for k, v in berkas.items() if v.exists()}
    if not ada:
        raise SystemExit(
            f"Tidak ada berkas hasil di {DATA_OLAHAN}. Jalankan s4-s6 lebih dulu."
        )

    hasil = {}
    Sesi = sessionmaker(bind=_mesin())
    with Sesi() as db:
        if "hex" in ada:
            hasil["variabel"] = muat_variabel(db, pd.read_parquet(ada["hex"]))
        if "profil" in ada:
            hasil["profil_jam"] = muat_profil_jam(db, pd.read_parquet(ada["profil"]))
        if "skor" in ada:
            hasil["skor"] = muat_skor(db, pd.read_parquet(ada["skor"]), versi)
        if "faktor" in ada:
            hasil["faktor"] = muat_faktor(db, pd.read_parquet(ada["faktor"]), versi)
        db.commit()
    return hasil


# ---------------------------------------------------------------------------
# Basis data -> berkas statis
# ---------------------------------------------------------------------------


def ekspor_geojson(tujuan: Path = EKSPOR, versi: str = "baseline") -> dict[str, int]:
    """Tulis satu berkas GeoJSON per kawasan, plus satu berkas gabungan.

    Per kawasan, bukan satu berkas besar: peta hanya menampilkan satu kawasan
    pada satu waktu, jadi mengunduh keenamnya berarti mengunduh lima kali lipat
    data yang tidak dipakai.

    Properti yang dibawa sama persis dengan yang dikirim GET /hex/layer, supaya
    frontend bisa berpindah antara sumber statis dan endpoint tanpa mengubah satu
    baris pun kode rendering.
    """
    tujuan.mkdir(parents=True, exist_ok=True)
    Sesi = sessionmaker(bind=_mesin())
    hasil: dict[str, int] = {}

    kueri = text(
        f"""
        SELECT h.h3_index, h.kawasan, h.tingkat_keyakinan, h.n_titik_misi,
               h.data_source, h.zona_izin_komersial, h.indeks_churn,
               h.harga_sewa_median, h.harga_sewa_per_m2, h.belanja_per_jam, h.njop_m2,
               s.opportunity_score, s.hidden_gem_score, s.kuadran,
               ST_AsGeoJSON(h.geom, {DESIMAL_GEOJSON}) AS geom
        FROM hex_features h
        LEFT JOIN location_scores s
               ON s.h3_index = h.h3_index AND s.versi = :versi
        WHERE (:kawasan IS NULL OR h.kawasan = :kawasan)
        """
    )

    with Sesi() as db:
        for kawasan in [*KAWASAN_PILOT, None]:
            baris = db.execute(kueri, {"versi": versi, "kawasan": kawasan}).mappings().all()
            if not baris and kawasan is not None:
                continue

            fc = {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "id": r["h3_index"],
                        "geometry": json.loads(r["geom"]),
                        "properties": {
                            k: v for k, v in r.items() if k != "geom"
                        },
                    }
                    for r in baris
                ],
            }
            nama = "semua" if kawasan is None else kawasan.lower().replace(" ", "-")
            berkas = tujuan / f"hex-{nama}.geojson"
            # separators tanpa spasi: pada ribuan fitur, spasi setelah koma saja
            # sudah bernilai puluhan kilobyte.
            berkas.write_text(
                json.dumps(fc, separators=(",", ":"), default=str), encoding="utf-8"
            )
            hasil[nama] = len(fc["features"])

    return hasil


def periksa_cakupan() -> pd.DataFrame:
    """Ringkasan cakupan data per kawasan, untuk dilihat sebelum demo.

    Menjawab "kawasan mana yang sudah layak ditunjukkan" dengan angka, bukan
    dengan perasaan.
    """
    Sesi = sessionmaker(bind=_mesin())
    with Sesi() as db:
        baris = db.execute(
            text(
                """
                SELECT h.kawasan,
                       COUNT(*)                                  AS heksagon,
                       COUNT(h.harga_sewa_per_m2)                AS ada_harga,
                       COUNT(*) FILTER (WHERE h.data_source = 'observed') AS disurvei,
                       COUNT(s.opportunity_score)                AS ada_skor,
                       COUNT(DISTINCT p.h3_index)                AS ada_profil_jam
                FROM hex_features h
                LEFT JOIN location_scores s
                       ON s.h3_index = h.h3_index AND s.versi = 'baseline'
                LEFT JOIN hex_hourly_profiles p ON p.h3_index = h.h3_index
                GROUP BY h.kawasan
                ORDER BY h.kawasan
                """
            )
        ).mappings().all()
    return pd.DataFrame(baris)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Terbitkan hasil pipeline")
    p.add_argument("--grid", action="store_true",
                   help="Periksa grid heksagon + simpul transit terhadap config.PUSAT")
    p.add_argument("--terapkan", action="store_true",
                   help="Bersama --grid: terapkan selisihnya. MENGHAPUS heksagon "
                        "beserta skor, faktor, rute, dan POI-nya")
    p.add_argument("--muat", action="store_true", help="DataFrame -> basis data")
    p.add_argument("--ekspor", action="store_true", help="Basis data -> GeoJSON statis")
    p.add_argument("--cakupan", action="store_true", help="Tampilkan cakupan data")
    p.add_argument(
        "--isi-d04",
        action="store_true",
        help="Alirkan jarak (D03) + waktu jalan (D04) nyata dari hex_routes",
    )
    p.add_argument(
        "--rdtr",
        action="store_true",
        help="Zonasi RDTR ATR/BPN -> L01, L02, L03 (DKI Jakarta saja)",
    )
    p.add_argument(
        "--misi",
        action="store_true",
        help="Data misi MAPID -> observasi + B06,B07,B08,C07,C08,D10,D12,P03 + Q01/Q02",
    )
    p.add_argument(
        "--bangunan",
        action="store_true",
        help="osm_bangunan.json -> M01 rasio tutupan + M02 luas median",
    )
    p.add_argument(
        "--penduduk",
        action="store_true",
        help="D01 dari raster WorldPop (+ C06 yang bergantung padanya)",
    )
    p.add_argument(
        "--osm",
        action="store_true",
        help="osm_poi.json -> business_pois + C01,C02,C03,C05,C06,D08,D09",
    )
    p.add_argument(
        "--transit",
        action="store_true",
        help="osm_rute.json + osm_henti.json -> D05 skor_simpul",
    )
    p.add_argument(
        "--kosongkan",
        action="store_true",
        help="Setel NULL 18 variabel yang masih karangan demo_seed (aturan 4)",
    )
    p.add_argument(
        "--hitung-ulang",
        action="store_true",
        help="Hitung ulang skor dari isi hex_features sekarang, lalu muat",
    )
    p.add_argument("--versi", default="baseline")
    arg = p.parse_args()

    if not any([arg.muat, arg.ekspor, arg.cakupan, arg.isi_d04, arg.penduduk,
                arg.bangunan, arg.osm, arg.misi, arg.rdtr, arg.transit,
                arg.kosongkan, arg.hitung_ulang, arg.grid]):
        p.print_help()
        raise SystemExit(0)

    # --- Grid ---------------------------------------------------------------
    #
    # Dijalankan lebih dulu dan di transaksinya SENDIRI, bukan digabung dengan
    # pemuatan variabel di bawah. Sebabnya: ia mengubah heksagon MANA yang ada,
    # dan setiap langkah sesudahnya bekerja atas daftar heksagon. Menggabungkan
    # keduanya dalam satu transaksi berarti pemuat variabel membaca grid lama
    # dari snapshot transaksinya sendiri.
    if arg.grid:
        Sesi = sessionmaker(bind=_mesin())
        with Sesi() as db:
            beda = periksa_grid(db)
            print("Grid heksagon terhadap config.PUSAT:")
            print(f"  diharapkan     : {beda['diharapkan']}")
            print(f"  di basis data  : {beda['di_basis_data']}")
            print(f"  perlu ditambah : {len(beda['tambah'])}")
            print(f"  perlu dibuang  : {len(beda['buang'])}")
            print(f"  pindah kawasan : {len(beda['pindah_kawasan'])}")

            if not arg.terapkan:
                if beda["tambah"] or beda["buang"] or beda["pindah_kawasan"]:
                    print("\n  Tambahkan --terapkan untuk menerapkannya.")
                    print("  PERINGATAN: menghapus heksagon ikut menghapus skor, faktor,")
                    print("  rute ORS, dan POI-nya lewat ON DELETE CASCADE.")
                else:
                    print("\n  Sudah selaras. Tidak ada yang perlu dikerjakan.")
            else:
                hasil = selaraskan_grid(db, beda)
                hasil.update(selaraskan_simpul(db))
                db.commit()
                print("\n  Diterapkan:")
                for k, v in hasil.items():
                    print(f"    {k:22s} {v}")
                print("\n  Langkah berikutnya untuk heksagon yang baru:")
                print("    python s1_ingest.py --poi --bangunan --rute --henti")
                print("    python s7_publish.py --osm --bangunan --transit --penduduk")
                print("    python rute_ors.py  &&  python rute_ors.py --isochrone")
                print("    python s7_publish.py --isi-d04 --misi --hitung-ulang")

    # Keduanya menulis, jadi keduanya berbagi satu transaksi: kalau perhitungan
    # ulang gagal, D04 pun tidak jadi berubah. Basis data berisi variabel baru
    # dengan skor lama adalah keadaan yang tidak memunculkan galat apa pun dan
    # hanya ketahuan kalau ada yang menjumlahkan faktornya dengan tangan.
    if (arg.isi_d04 or arg.penduduk or arg.bangunan or arg.osm or arg.misi
            or arg.rdtr or arg.transit or arg.kosongkan or arg.hitung_ulang):
        Sesi = sessionmaker(bind=_mesin())
        with Sesi() as db:
            if arg.isi_d04:
                print("Mengisi D03 + D04 dari hex_routes...")
                for k, v in isi_d04_dari_rute(db).items():
                    print(f"  {k:12} {v}")
            if arg.penduduk:
                print("Mengisi D01 dari WorldPop (+ C06)...")
                for k, v in isi_penduduk_dari_worldpop(db).items():
                    print(f"  {k:16} {v}")
            if arg.bangunan:
                print("Memuat footprint bangunan (M01, M02)...")
                for k, v in muat_bangunan(db).items():
                    print(f"  {k:16} {v}")
            if arg.osm:
                print("Memuat POI OSM dan variabel Kompetisi/Konteks...")
                for k, v in muat_osm(db).items():
                    print(f"  {k:12} {v}")
            if arg.misi:
                print("Memuat data misi MAPID...")
                for k, v in muat_misi(db).items():
                    print(f"  {k:16} {v}")
            if arg.rdtr:
                print("Memuat zonasi RDTR...")
                for k, v in muat_rdtr(db).items():
                    print(f"  {k:16} {v}")
            if arg.transit:
                print("Memuat rute + henti angkutan umum (D05)...")
                for k, v in muat_transit(db).items():
                    print(f"  {k:16} {v}")
            if arg.kosongkan:
                print("Mengosongkan variabel yang masih sintetis...")
                for k, v in kosongkan_sintetis(db).items():
                    print(f"  {k:26} {v} baris -> NULL")
            if arg.hitung_ulang:
                print(f"Menghitung ulang skor (versi {arg.versi})...")
                for k, v in hitung_ulang_dari_db(db, arg.versi).items():
                    print(f"  {k:12} {v} baris")
            db.commit()
        print("\nJangan lupa kosongkan cache backend: POST /meta/cache/bersihkan")

    if arg.muat and not arg.grid:
        print("Memuat ke basis data...")
        for k, v in muat_semua(arg.versi).items():
            print(f"  {k:12} {v} baris")
        print("\nJangan lupa kosongkan cache backend: POST /meta/cache/bersihkan")

    if arg.ekspor:
        print(f"Mengekspor GeoJSON ke {EKSPOR}...")
        for k, v in ekspor_geojson(versi=arg.versi).items():
            print(f"  hex-{k}.geojson: {v} fitur")

    if arg.cakupan:
        print(periksa_cakupan().to_string(index=False))
