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
import datetime as dt
import json
import os
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd
from sqlalchemy import create_engine, delete, select, text
from sqlalchemy.orm import Session, sessionmaker

from config import (
    DATA_MENTAH,
    DATA_OLAHAN,
    KAWASAN_PILOT,
    KELAS_INDUK,
    KODE_KE_KOLOM,
    ROOT,
    tingkat_keyakinan,
)

# Berkas statis ditulis ke sini lalu di-deploy bersama frontend.
EKSPOR = ROOT.parent / "frontend" / "public" / "data"

# Ringkasan cakupan untuk halaman gerbang. Modul TypeScript, BUKAN JSON di
# public/: halaman gerbang adalah satu-satunya bagian yang tetap hidup tanpa
# backend, jadi ia tidak boleh punya satu pun permintaan jaringan yang bisa
# gagal. Konstanta yang ikut ter-bundel tidak punya keadaan gagal.
RINGKASAN_TS = ROOT.parent / "frontend" / "src" / "lib" / "ringkasan-data.ts"

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

    # HANYA profil jalan kaki. `hex_routes` memuat rute mobil sejak 2026, dan
    # keduanya berbagi tabel: tanpa saringan ini `simpul_terdekat_dari_rute`
    # mengambil minimum menit lintas profil, mobil selalu menang, dan D04 -
    # yang bernama `waktu_jalan_menit` dan ikut menyusun IPT - jadi waktu
    # BERKENDARA tanpa satu pun galat.
    rute = pd.read_sql(
        "SELECT h3_index, jarak_m, menit FROM hex_routes"
        " WHERE profil = 'foot-walking'",
        db.connection(),
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


# ---------------------------------------------------------------------------
# Survei lapangan -> dua belas variabel yang tidak punya sumber lain
# ---------------------------------------------------------------------------

#: Kolom CSV survei yang boleh masuk basis data.
#:
#: Sengaja daftar POSITIF. Berkas isian tangan selalu memuat kolom bantu -
#: nama surveyor, tanggal, catatan - dan daftar negatif ("semua kecuali...")
#: akan melewatkan kolom baru yang belum terpikir, diam-diam, ke dalam UPDATE.
KOLOM_SURVEI: tuple[str, ...] = (
    "harga_sewa_median", "harga_sewa_per_m2", "harga_median_porsi",
    "nominal_median_struk", "puncak_pagi", "puncak_siang", "puncak_sore",
    "puncak_malam", "rasio_weekend", "intensitas_transaksi",
    "skor_prestise_visual", "indeks_churn",
)

#: Rentang yang masuk akal per kolom. Nilai di luarnya DITOLAK, tidak dipangkas.
#:
#: Memangkas menyembunyikan salah ketik sambil tetap menyimpan angka yang salah;
#: menolak memaksa orangnya melihat barisnya. Yang paling sering: rupiah ditulis
#: dalam ribuan ("15" untuk Rp15.000.000) dan skala 1-5 diisi 0.
RENTANG_SURVEI: dict[str, tuple[float, float]] = {
    "harga_sewa_median": (5e5, 5e8),
    "harga_sewa_per_m2": (1e4, 5e6),
    "harga_median_porsi": (1e3, 5e5),
    "nominal_median_struk": (1e3, 1e7),
    "puncak_pagi": (0, 1e4),
    "puncak_siang": (0, 1e4),
    "puncak_sore": (0, 1e4),
    "puncak_malam": (0, 1e4),
    "rasio_weekend": (0, 100),
    "intensitas_transaksi": (0, 1e4),
    "skor_prestise_visual": (1, 5),
    "indeks_churn": (0, 100),
}


def baca_survei(berkas: Path) -> tuple[pd.DataFrame, pd.Series]:
    """Urai dan periksa CSV survei. TANPA basis data, supaya bisa diuji murni.

    Dipisahkan dari `muat_survei` dengan sengaja: seluruh cara berkas ini bisa
    salah - sel kosong, satuan tertukar, kolom asing, kunjungan ganda - hidup
    di sini, dan tidak satu pun dari empat hal itu memunculkan galat kalau
    tidak diperiksa. Bagian yang menyentuh basis data tinggal dua UPDATE.

    Mengembalikan (median per heksagon, jumlah kunjungan per heksagon).
    """
    df = pd.read_csv(berkas, dtype={"h3_index": str})
    if "h3_index" not in df.columns:
        raise ValueError(f"{berkas} tidak punya kolom h3_index")

    tersedia = [k for k in KOLOM_SURVEI if k in df.columns]
    if not tersedia:
        raise ValueError(
            f"{berkas} tidak memuat satu pun kolom survei yang dikenal. "
            f"Yang diharapkan: {', '.join(KOLOM_SURVEI)}"
        )

    # Angka, dan yang tidak bisa diurai jadi NaN - bukan 0.
    for k in tersedia:
        df[k] = pd.to_numeric(df[k], errors="coerce")

    # Baris yang seluruh kolom surveinya kosong tidak membawa apa pun. Ia bukan
    # galat (templatnya memang dicetak kosong), jadi cukup dilewati.
    berisi = df[df[tersedia].notna().any(axis=1)].copy()
    if berisi.empty:
        return pd.DataFrame(columns=tersedia), pd.Series(dtype=int)

    ditolak: list[str] = []
    for k in tersedia:
        lo, hi = RENTANG_SURVEI[k]
        buruk = berisi[k].notna() & ((berisi[k] < lo) | (berisi[k] > hi))
        for h3, nilai in zip(berisi.loc[buruk, "h3_index"], berisi.loc[buruk, k]):
            ditolak.append(f"{h3} {k}={nilai:g} (di luar {lo:g}..{hi:g})")
    if ditolak:
        raise ValueError(
            "Nilai di luar rentang wajar, dan itu hampir selalu salah ketik "
            "satuan. Perbaiki berkasnya lalu ulangi:\n  " + "\n  ".join(ditolak[:20])
        )

    # Median per heksagon, bukan rata-rata dan bukan yang terakhir - lihat
    # keputusan 2 di docstring `muat_survei`.
    return berisi.groupby("h3_index")[tersedia].median(), berisi.groupby("h3_index").size()


def muat_survei(db: Session, berkas: Path | None = None) -> dict[str, int]:
    """Muat hasil survei lapangan dari CSV yang dibuat `rencana_survei.py`.

    Ini pintu masuk untuk dua belas variabel yang tidak punya sumber terbuka
    mana pun - harga sewa, pola jam, belanja, kesan visual, churn. Tanpa
    fungsi ini, lembar survei cuma formulir: tim pulang membawa angka yang
    tidak punya tujuan.

    TIGA KEPUTUSAN YANG PERLU DIKETAHUI

    1. Sel kosong tetap KOSONG. Surveyor yang tidak menemukan papan sewa
       meninggalkan selnya kosong, dan itu pernyataan yang berbeda dari
       "sewanya nol". Aturan 4, dan di sini paling mudah dilanggar karena
       `pd.read_csv` dengan senang hati mengubah sel kosong jadi 0 kalau
       dtype-nya dipaksa.

    2. Beberapa kunjungan ke heksagon yang sama diringkas dengan MEDIAN,
       bukan rata-rata dan bukan yang terakhir. Median tahan terhadap satu
       salah ketik; rata-rata tidak, dan "yang terakhir menang" membuat
       urutan baris di dalam berkas menentukan isinya.

    3. `n_titik_misi` dihitung ULANG DARI NOL, bukan ditambahkan. Fungsi ini
       memanggil `muat_misi` lebih dulu - yang menulis hitungan misi secara
       mutlak untuk seluruh heksagon - lalu menambahkan jumlah kunjungan
       survei di atasnya. Kalau ia menambah tanpa menghitung ulang, menjalankan
       perintah yang sama dua kali akan menggandakan cakupan survei, badge
       keyakinan ikut naik, dan tidak ada satu pun galat yang muncul.
    """
    berkas = berkas or DATA_MENTAH.parent / "04_survei" / "target_survei.csv"
    if not berkas.exists():
        raise FileNotFoundError(
            f"{berkas} belum ada. Jalankan `python rencana_survei.py --tulis` "
            "untuk membuat templatnya, isi di lapangan, lalu ulangi perintah ini."
        )

    ringkas, kunjungan = baca_survei(berkas)
    if ringkas.empty:
        return {"baris": 0, "heksagon": 0, "asing": 0, "hex_ditulis": 0}

    sah = {r[0] for r in db.execute(text("SELECT h3_index FROM hex_features")).all()}
    asing = sorted(set(ringkas.index) - sah)
    ringkas = ringkas[ringkas.index.isin(sah)]
    if ringkas.empty:
        return {"baris": 0, "heksagon": 0, "asing": len(asing), "hex_ditulis": 0}

    # URUTANNYA MENENTUKAN, dan salahnya diam.
    #
    # `muat_misi` dijalankan LEBIH DULU, bukan sesudah. Ia menulis dua hal yang
    # bertabrakan dengan survei: `n_titik_misi` (ditulis mutlak, itu yang
    # membuat fungsi ini idempoten) dan sebagian VARIABEL yang juga ada di
    # lembar survei - B07 `harga_median_porsi` di keduanya. Kalau ia jalan
    # belakangan, angka hasil pengukuran langsung ditimpa balik oleh turunan
    # misi yang untuk heksagon itu justru kosong.
    #
    # Ditangkap uji `heksagon kedua terisi`; tanpa itu ia akan lolos sebagai
    # "survei dimuat, kolomnya tetap NULL" tanpa satu pun galat.
    try:
        muat_misi(db)
    except FileNotFoundError:
        log.warning(
            "Berkas misi MAPID tidak ada; n_titik_misi tidak dihitung ulang. "
            "Jalankan `s1_ingest.py --misi` supaya cakupan survei tidak menggeser."
        )

    # Survei menang atas turunan misi: ia pengukuran langsung di lokasinya.
    n_hex = muat_variabel(db, ringkas)

    sekarang = dict(
        db.execute(
            # = ANY(:h), bukan IN :h. Yang kedua menuntut bindparam(expanding=True)
            # di SQLAlchemy 2 dan tanpa itu tuple-nya dikirim apa adanya sebagai
            # satu parameter - galatnya "syntax error at or near $1", yang tidak
            # menyebut-nyebut parameter maupun tuple.
            text("SELECT h3_index, n_titik_misi FROM hex_features WHERE h3_index = ANY(:h)"),
            {"h": list(ringkas.index)},
        ).all()
    )
    db.execute(
        text("UPDATE hex_features SET n_titik_misi = :n, tingkat_keyakinan = :t, "
             "data_source = :s WHERE h3_index = :h"),
        [
            {
                "h": h3,
                "n": (n := int(sekarang.get(h3) or 0) + int(kunjungan[h3])),
                "t": tingkat_keyakinan(n),
                "s": "observed" if n > 0 else "predicted",
            }
            for h3 in ringkas.index
        ],
    )

    return {
        "baris": int(kunjungan.sum()),
        "heksagon": int(len(ringkas)),
        "asing": len(asing),
        "hex_ditulis": n_hex,
    }


# ---------------------------------------------------------------------------
# GapFill: melatih di LUAR grid, memprediksi DI DALAM grid
# ---------------------------------------------------------------------------


def _fitur_luar_grid(elemen: list[dict], sel: list[str]) -> "pd.DataFrame":
    """Prediktor untuk heksagon di luar grid, dari POI OSM yang sama.

    Memakai FUNGSI YANG SAMA dengan jalur di dalam grid - bukan salinan yang
    kebetulan mirip. Itu syaratnya: model yang dilatih pada fitur yang dihitung
    berbeda dari fitur yang diprediksinya akan tetap melaporkan R2 yang
    kelihatan bagus, karena spatial k-fold pun cuma melihat data latihnya.
    """
    from s2_clean import konteks_dari_osm, poi_dari_osm
    from s4_spatial import kepadatan_poi_total, pangsa_waralaba, dimensi_konteks

    indeks = pd.Index(sel, name="h3_index")
    poi = poi_dari_osm(elemen)

    f = pd.DataFrame(index=indeks)
    f["kepadatan_poi_total"] = kepadatan_poi_total(poi).reindex(indeks)
    f["pangsa_waralaba"] = pangsa_waralaba(poi).reindex(indeks)
    konteks = dimensi_konteks(konteks_dari_osm(elemen), semua_hex=indeks)
    f["kepadatan_kantor"] = konteks["kepadatan_kantor"].reindex(indeks)

    # Heksagon yang benar-benar tidak punya POI di dalamnya bernilai NOL, bukan
    # kosong - disc penarikannya menutup seluruh sel ini, jadi ketiadaan POI
    # memang temuan. Ini kebalikan dari data misi. Sama persis dengan alasan
    # `ISI_NOL` di s4_spatial.
    for k in ("kepadatan_poi_total", "pangsa_waralaba", "kepadatan_kantor"):
        f[k] = f[k].fillna(0.0)
    return f


def _penduduk_luar_grid(sel: list[str], berkas: Path | None = None) -> "pd.Series":
    """D01 untuk heksagon di luar grid, dari raster WorldPop yang sama."""
    import h3
    import rasterio
    from rasterio.windows import from_bounds

    from s4_spatial import penduduk_per_heksagon

    berkas = berkas or DATA_MENTAH / "worldpop_idn_2020.tif"
    if not berkas.exists():
        raise SystemExit(f"{berkas} belum ada - lihat CLAUDE.md bagian --penduduk.")

    batas = [h3.cell_to_boundary(k) for k in sel]
    lat = [p[0] for b in batas for p in b]
    lon = [p[1] for b in batas for p in b]
    pad = 0.002
    with rasterio.open(berkas) as r:
        jendela = from_bounds(
            min(lon) - pad, min(lat) - pad, max(lon) + pad, max(lat) + pad, r.transform
        )
        nilai = r.read(1, window=jendela)
        t = r.window_transform(jendela)
        d01 = penduduk_per_heksagon(nilai, t.c, t.f, t.a, -t.e, nodata=r.nodata)
    return d01.reindex(pd.Index(sel, name="h3_index"))


def gapfill_luar(
    db: Session, target: str = "harga_median_porsi", terapkan: bool = False
) -> dict[str, object]:
    """Latih GapFill dengan ground truth SE-JABODETABEK, lalu isi 708 heksagon.

    KENAPA GROUND TRUTH-NYA DARI LUAR GRID

    `s5_impute` menuntut 30 baris; di dalam 708 heksagon kita cuma ada 11 untuk
    B07. Itu bukan karena datanya sedikit melainkan karena LETAKNYA - API misi
    MAPID disaring per POLIGON, bukan per tim, jadi ia mengembalikan survei
    seluruh peserta lomba dan tiap tim memilih wilayahnya sendiri.

    Ground truth untuk MELATIH tidak harus berada di dalam wilayah studi; ia
    cuma perlu punya prediktornya. Yang ditambahkan di sini 99 heksagon
    berlabel di luar grid, prediktornya dihitung lewat fungsi yang sama persis.

    HASILNYA SEJAUH INI: DITOLAK, DAN ITU TEMUAN

    Dijalankan 30 Agustus 2026 dengan 110 baris latih di 40 kelompok:

        target                R2       MAE    MAE menebak rata-rata
        harga_median_porsi  -0,092   11.581   10.775   -> LEBIH BURUK
        skor_ramai_terkoreksi        korelasi nol untuk keempat prediktor

    Jadi modelnya tidak dimuat, dan `terapkan` pun tidak menolongnya. Sebabnya
    terukur, bukan ditebak: DI DALAM SATU HEKSAGON saja harga per porsi
    berkisar Rp7.000-25.000, dan satu heksagon berisi 19 titik merentang
    Rp15.000-50.000. Harga makanan ternyata sifat TEMPAT USAHANYA - warung dan
    kafe di jalan yang sama berbeda tiga kali lipat - bukan sifat lokasinya.
    Mengagregasinya ke median heksagon membuang justru hal yang menentukan
    harganya, dan tidak ada prediktor bentuk kota yang bisa memulihkan itu.
    Korelasi Spearman terkuat cuma +0,213 (kepadatan POI), dan ia tidak
    menguat saat labelnya dipertebal.

    Fungsi ini tetap ada, dan bukan sebagai peninggalan: ia membuat hasil
    negatif itu bisa DIULANG oleh siapa pun, dan ia akan langsung berguna
    begitu survei lapangan masuk - saat itu tiap heksagon punya beberapa
    pengamatan, bukan satu, dan targetnya bisa diuji ulang dalam satu perintah.

    YANG DILAPORKAN APA ADANYA

    R2 dan MAE dari spatial k-fold, beserta pembanding "menebak rata-rata".
    Kalau modelnya tidak mengalahkan tebakan rata-rata, ia TIDAK dimuat. Peta
    yang kosong dan mengakuinya lebih baik daripada peta yang penuh dan tidak
    bisa dipertanggungjawabkan.
    """
    import h3

    from s1_ingest import sel_berlabel_luar_grid
    from s5_impute import DataTidakCukup, latih_model, prediksi_seluruh_heksagon

    berkas = DATA_MENTAH / "osm_poi_luar.json"
    if not berkas.exists():
        raise SystemExit(
            f"{berkas} belum ada. Jalankan dulu:  python s1_ingest.py --poi-luar"
        )
    isi = json.loads(berkas.read_text(encoding="utf-8"))
    elemen = isi.get("elements", [])

    # --- ground truth di luar grid ------------------------------------------
    label = sel_berlabel_luar_grid()
    sel = sorted(label)

    # Setiap heksagon berlabel HARUS berada di kelompok yang benar-benar
    # ditarik. Kalau tidak, `_fitur_luar_grid` mengisinya nol - dan nol di
    # situ berarti "belum diperiksa", bukan "tidak ada POI". Model yang
    # belajar dari nol palsu tetap melaporkan R2 yang kelihatan bagus.
    from s1_ingest import RES_KELOMPOK

    ditarik = set(isi.get("kelompok") or [])
    if ditarik:
        kurang = {h3.cell_to_parent(k, RES_KELOMPOK) for k in sel} - ditarik
        if kurang:
            raise SystemExit(
                f"{len(kurang)} kelompok belum ditarik. Ulangi:  "
                "python s1_ingest.py --poi-luar"
            )
    luar = _fitur_luar_grid(elemen, sel)
    luar["pop_100m"] = _penduduk_luar_grid(sel)
    luar[target] = pd.Series(
        {k: float(np.median(v)) for k, v in label.items()}
    ).reindex(luar.index)
    # `kawasan` dipakai spatial k-fold sebagai grup. Untuk yang di luar grid,
    # grupnya induk res-6 - cukup lebar untuk memisahkan wilayah yang berbeda,
    # cukup sempit untuk menghasilkan banyak lipatan.
    luar["kawasan"] = [f"luar-{h3.cell_to_parent(k, 6)}" for k in luar.index]

    # --- ground truth di dalam grid -----------------------------------------
    dalam = pd.read_sql(
        "SELECT h3_index, kawasan, kepadatan_poi_total, pangsa_waralaba, "
        f"kepadatan_kantor, pop_100m, {target} FROM hex_features",
        db.connection(),
    ).set_index("h3_index")

    latih = pd.concat([dalam[dalam[target].notna()], luar], axis=0)

    try:
        hasil = latih_model(latih, target)
    except DataTidakCukup as e:
        return {"status": "DITOLAK", "alasan": str(e), "n_latih": len(latih)}

    ringkas: dict[str, object] = {
        "status": "dilatih",
        "n_latih": hasil.n_latih,
        "target": target,
        "n_dalam_grid": int(dalam[target].notna().sum()),
        "n_luar_grid": len(luar),
        "kawasan": len(hasil.kawasan),
        "fitur": hasil.fitur,
        "r2": round(hasil.r2, 4),
        "mae": round(hasil.mae, 1),
        "mae_menebak_rata2": round(hasil.baseline_mae, 1),
        "lebih_baik": hasil.lebih_baik_dari_menebak,
    }
    if not hasil.lebih_baik_dari_menebak:
        ringkas["status"] = "TIDAK DIMUAT - tidak mengalahkan tebakan rata-rata"
        return ringkas

    prediksi = prediksi_seluruh_heksagon(hasil, dalam)
    ringkas["n_diprediksi"] = int(prediksi[target].notna().sum())
    if not terapkan:
        ringkas["status"] = "dilatih (tanpa --terapkan, tidak dimuat)"
        return ringkas

    ringkas["hex_ditulis"] = muat_variabel(db, prediksi[[target]])
    ringkas["status"] = "DIMUAT"
    return ringkas


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


def _bangunan_bertitik() -> pd.DataFrame:
    """Seluruh footprint (lat, lon, luas) dari petak singgahan, dedup (tipe, id).

    Sama dengan cara `muat_bangunan` membaca - petak satu per satu, bukan berkas
    gabungan 145 MB - karena alasan memori yang sama.
    """
    from s2_clean import bangunan_bertitik_dari_osm

    petak = sorted((DATA_MENTAH / "_singgah").glob("bangunan_*.json")) or [DATA_MENTAH / "osm_bangunan.json"]
    terlihat: set[tuple[str, int]] = set()
    potongan = []
    for f in petak:
        if not f.exists():
            continue
        elemen = json.loads(f.read_text(encoding="utf-8")).get("elements", [])
        segar = []
        for e in elemen:
            kunci = (e.get("type"), e.get("id"))
            if kunci not in terlihat:
                terlihat.add(kunci)
                segar.append(e)
        potongan.append(bangunan_bertitik_dari_osm(segar))
        del elemen, segar
    return pd.concat(potongan, ignore_index=True) if potongan else pd.DataFrame(columns=["lat", "lon", "luas_m2"])


# --- Serah terima tim AI ----------------------------------------------------
#
# Berkasnya TIDAK di-commit: `pipeline/data/` seluruhnya di-gitignore karena
# ketentuan lomba B.7 melarang redistribusi data MAPID/mitra. Yang masuk git
# cuma kode pembacanya dan angka mutunya di docs/.
TIM_AI = DATA_MENTAH / "tim_ai"

#: Satu-satunya kolom serah terima yang masuk `hex_features` sebagai DATA.
#:
#: WorldPop struktur umur - sumber yang sama dengan D01 yang sudah kita pakai,
#: cuma lapisan yang berbeda, jadi ia pengukuran dan bukan perkiraan. D02 tidak
#: ada di satu pun BOBOT_* (IPT, IAE, IKP, IBR), jadi memuatnya menambah satu
#: variabel yang bisa dibaca orang TANPA menggeser satu pun skor - sudah
#: diperiksa, bukan diasumsikan.
KOLOM_TIM_AI_NYATA = {"pop_usia_produktif": "D02"}

#: Dua keluaran MODEL, dan keduanya tidak boleh menyentuh `hex_features`.
#:
#: Alasannya ada di log training tim AI sendiri: dari 480 titik label, 15 asli
#: (Menu Go di dalam bbox) dan ~465 sintetis dari formula populasi + jarak
#: simpul + derau - 96,9%. Catatan serah terimanya menulis "BUKAN bukti model
#: sudah akurat untuk dunia nyata" dan melarang file itu dipakai sebagai data
#: 100% asli tanpa disclosure.
#:
#: Ditaruh di `hex_perkiraan`, angka itu tetap bisa dibaca orang di panel dan
#: laporan - berlabel Perkiraan, lengkap dengan R2 dan MAE-nya. Ditaruh di
#: `hex_features`, ia akan ikut memeringkat 708 lokasi dan menaikkan lencana
#: keyakinan atas dasar label yang sebagian besar dikarang formula.
KOLOM_TIM_AI_PERKIRAAN = {"skor_ramai_terkoreksi": "D10", "harga_median_porsi": "B07"}

#: Yang SENGAJA tidak diambil, supaya alasannya tidak hilang bersama sesi ini.
#:
#: `jarak_simpul_m`  - milik mereka Euclidean (DATA_SCHEMA.md menyebutnya
#:                     proksi dan melarang diklaim sebagai jaringan jalan);
#:                     milik kita rute OpenRouteService sungguhan. Menambal 5
#:                     heksagon yang kosong dengan angka berdefinisi lain
#:                     membuat satu kolom memuat dua satuan yang tidak bisa
#:                     dibedakan siapa pun sesudahnya (jebakan 5).
#: `luas_bangunan_median`, `rasio_tutupan_bangunan`
#:                   - milik mereka Google Open Buildings, milik kita jejak
#:                     OSM. Alasan yang sama; selisihnya cuma 9 heksagon.
#: `risiko_banjir`   - milik mereka indeks InaRISK 0-1, milik kita kelas dari
#:                     RDTR GISTARU. Dua definisi berbeda, dan milik kita
#:                     justru lebih lengkap (364 vs 344).
#: `n_kompetitor`, `n_generator_keramaian`
#:                   - sudah 708/708 di kita, dari taksonomi 8 kelas yang
#:                     mereka sendiri catat belum punya.
KOLOM_TIM_AI_DILEWATI = (
    "jarak_simpul_m", "luas_bangunan_median", "rasio_tutupan_bangunan",
    "risiko_banjir_indeks_mean", "risiko_banjir_indeks_max", "pop_100m",
    "n_kompetitor", "n_generator_keramaian", "jumlah_bangunan",
)


def baca_tim_ai() -> tuple[pd.DataFrame, dict]:
    """`hex_features_final.geojson` + `hasil_validasi.json` dari tim AI.

    Mengembalikan (fitur berindeks h3_index, mutu model). Seluruh 40.288
    heksagon dibaca lalu disaring ke heksagon KITA di pemanggilnya - menyaring
    di sini akan menyembunyikan berapa banyak yang sebetulnya tersedia.
    """
    berkas = TIM_AI / "hex_features_final.geojson"
    if not berkas.exists():
        raise SystemExit(
            f"{berkas} tidak ada. Unduh dari repo tim AI "
            "(syahh-coder/Loconomics-AI, folder hasilTrain) lebih dulu."
        )
    isi = json.loads(berkas.read_text(encoding="utf-8"))
    baris = [f["properties"] for f in isi["features"]]
    df = pd.DataFrame(baris).set_index("hex_id")
    df.index.name = "h3_index"
    mutu = json.loads((TIM_AI / "hasil_validasi.json").read_text(encoding="utf-8"))
    return df, mutu


def muat_perkiraan(db: Session, baris: list[dict]) -> int:
    """Hapus-lalu-sisip per KODE, bukan per tabel.

    Menghapus seluruh isi `hex_perkiraan` akan ikut membuang perkiraan dari
    sumber lain (spanduk OCR, pola jam) yang tidak sedang dimuat ulang - dan
    hilangnya tidak akan memunculkan satu pun galat.
    """
    if not baris:
        return 0
    kode = sorted({b["kode"] for b in baris})
    db.execute(
        text("DELETE FROM hex_perkiraan WHERE kode = ANY(:kode)"), {"kode": kode}
    )
    sisip = text(
        "INSERT INTO hex_perkiraan (h3_index, kode, nilai, rincian, metode, n_sumber, radius_m) "
        "VALUES (:h3_index, :kode, :nilai, CAST(:rincian AS jsonb), :metode, :n_sumber, :radius_m)"
    )
    for bagian in _potong(baris):
        db.execute(sisip, bagian)
    return len(baris)


# --- Hasil OCR struk (A2) ---------------------------------------------------
#
# Tujuh variabel yang seluruhnya 0/708 sebelum ini, jadi tidak ada satu pun
# kolom yang bisa memuat dua definisi sekaligus - keluarga jebakan "variabel
# yang jadi nyata separuh" tidak berlaku di sini, dan itu disengaja: B06
# (pangsa digital) SENGAJA tidak disentuh walaupun A2 membacanya juga, karena
# ia sudah punya sumber dari misi dan menggabungkan keduanya berarti satu kolom
# dengan dua asal yang tidak bisa dibedakan siapa pun sesudahnya.
EMBER_JAM = {
    "puncak_pagi": range(5, 10),    # B01 05-09
    "puncak_siang": range(11, 15),  # B02 11-14
    "puncak_sore": range(16, 20),   # B03 16-19
    "puncak_malam": range(19, 24),  # B04 19-23
}


def _hasil_ocr_a2() -> list[dict]:
    """Hasil A2 dari CACHE, bukan dari ringkasan `ocr_a2.json`.

    `s3_extract.jalankan()` menulis ringkasannya sekali di AKHIR, jadi lari
    yang terputus di tengah - dan lari atas 462 foto lewat CDN yang sering
    menolak memang sering terputus - meninggalkan ringkasan yang jauh lebih
    pendek daripada yang sebenarnya sudah dibaca dan DIBAYAR. Cache-nya
    sebaliknya ditulis per foto, jadi ia selalu mewakili keadaan sekarang.

    Koordinatnya tidak ada di cache (ia cuma menyimpan jawaban model), jadi
    dijahit ulang dari `mapid_misi.json` lewat SHA-1 URL fotonya - kunci yang
    sama persis dengan yang dipakai `s3_extract._ekstrak`.
    """
    import hashlib

    from config import CACHE_AI
    # Aturan "boleh dipakai atau tidak" DIPINJAM dari `s3_extract`, tidak
    # ditulis ulang. Menyalinnya sempat membuat dua angka yang berselisih di
    # layar yang sama: log AI menghitung 1 yang perlu ditinjau sementara lari
    # OCR-nya melaporkan 6 - karena salinannya cuma memeriksa keyakinan,
    # sedangkan aslinya juga memeriksa apakah nominalnya masuk akal.
    from s3_extract import perlu_review as _perlu_review

    misi_berkas = DATA_MENTAH / "mapid_misi.json"
    if not misi_berkas.exists():
        raise SystemExit(f"{misi_berkas} tidak ada. Jalankan `s1_ingest.py --misi` lebih dulu.")
    misi = json.loads(misi_berkas.read_text(encoding="utf-8"))

    keluar: list[dict] = []
    for f in misi.get("struckgo", []):
        p = f.get("properties") or {}
        url = (p.get("foto_struk") or "").strip()
        if not url:
            continue
        berkas = CACHE_AI / "a2" / f"{hashlib.sha1(url.encode()).hexdigest()}.json"
        if not berkas.exists():
            continue
        rekam = json.loads(berkas.read_text(encoding="utf-8"))
        hasil = rekam.get("hasil") or {}
        koord = ((f.get("geometry") or {}).get("coordinates") or [None, None])
        keluar.append({
            "foto_url": url,
            "lon": koord[0],
            "lat": koord[1],
            "hasil": hasil,
            "model": rekam.get("model"),
            "biaya_usd": rekam.get("biaya_usd"),
            "perlu_review": _perlu_review(rekam),
        })
    return keluar


def muat_log_ai(db: Session, baris: list[dict], fitur: str) -> int:
    """Satu baris `ai_call_logs` per foto yang benar-benar dibaca model.

    Ada karena kepala `s3_extract.py` menjanjikannya ("Setiap panggilan dicatat
    ke tabel ai_call_logs") dan tabelnya tidak pernah bertambah - 330 foto
    dibaca dan dibayar, nol tercatat. Tabel itu bukan hiasan: `docs/ai.md`
    menyebutnya alat untuk menjawab pertanyaan juri "berapa banyak yang perlu
    koreksi manusia?" dengan angka alih-alih dengan perkiraan.

    Dicatat dari CACHE, bukan saat memanggil. Satu berkas cache = satu
    panggilan sungguhan yang pernah dibayar, jadi hitungannya sama - dan
    menuliskannya di sini membuatnya bisa diulang tanpa kuota.

    Idempoten lewat `input_ref` (URL foto): menjalankan `--ocr` dua kali tidak
    melipatduakan hitungan yang akan dibaca juri.
    """
    if not baris:
        return 0
    ada = {
        r[0] for r in db.execute(
            text("SELECT input_ref FROM ai_call_logs WHERE fitur = :f"), {"f": fitur}
        )
    }
    baru_saja = [b for b in baris if b["foto_url"] not in ada]
    if not baru_saja:
        return 0
    sisip = text(
        "INSERT INTO ai_call_logs (fitur, model, input_ref, output_ringkas, "
        "confidence, perlu_review, biaya_usd) VALUES (:fitur, :model, :input_ref, "
        ":output_ringkas, :confidence, :perlu_review, :biaya_usd)"
    )
    for bagian in _potong([
        {
            "fitur": fitur,
            "model": b.get("model"),
            "input_ref": b["foto_url"],
            # Ringkas, bukan lengkap: tabel ini untuk MENGHITUNG, dan
            # menyimpan seluruh keluaran model berarti menyimpan salinan
            # kedua data misi di tabel yang tidak dijaga aturan 2.
            "output_ringkas": json.dumps(
                {k: (b["hasil"] or {}).get(k) for k in ("total_nominal", "waktu_terbaca", "harga_nominal")},
                ensure_ascii=False,
            ),
            "confidence": (b["hasil"] or {}).get("confidence"),
            "perlu_review": bool(b.get("perlu_review")),
            "biaya_usd": b.get("biaya_usd"),
        }
        for b in baru_saja
    ]):
        db.execute(sisip, bagian)
    return len(baru_saja)


def baca_ocr_struk() -> pd.DataFrame:
    """`ocr_a2.json` -> DataFrame siap `s4_spatial.profil_jam`.

    Yang DIBUANG di sini, dan tiap pembuangan dilaporkan pemanggilnya:
    hasil yang `perlu_review`, yang jamnya tidak terbaca, dan yang jatuh di
    luar 708 heksagon kita. Struk tanpa jam tidak boleh masuk sama sekali -
    aturan prompt A2 - karena jam adalah satu-satunya hal yang membuat data
    ini berbeda dari yang sudah kita punya.
    """
    baris = _hasil_ocr_a2()
    if not baris:
        return pd.DataFrame(columns=["h3_index", "jam", "total_nominal", "akhir_pekan"])

    import h3 as _h3

    from config import H3_RESOLUSI

    keluar = []
    for b in baris:
        if b.get("perlu_review"):
            continue
        h = b.get("hasil") or {}
        waktu = h.get("waktu_terbaca")
        nominal = h.get("total_nominal")
        if not waktu or nominal is None or b.get("lat") is None:
            continue
        # Struk nol rupiah tidak ada. Nol di sini berarti totalnya TIDAK
        # TERBACA dan model menuliskannya sebagai angka alih-alih mengosongkan
        # - dan nol yang lolos akan menarik turun median nominal serta membuat
        # sebuah heksagon tampak seperti tempat orang membeli tanpa membayar
        # (aturan 4).
        if float(nominal) <= 0:
            continue
        try:
            jam = int(str(waktu).split(":")[0])
        except (ValueError, IndexError):
            continue
        if not 0 <= jam <= 23:
            continue
        # Akhir pekan dibaca dari tanggal struknya kalau ada. Kosong bukan
        # "hari kerja": ia dibiarkan NaN supaya B05 dihitung hanya dari struk
        # yang benar-benar bertanggal.
        akhir = None
        tgl = h.get("tanggal_terbaca")
        if tgl:
            try:
                akhir = pd.Timestamp(tgl).dayofweek >= 5
            except (ValueError, TypeError):
                akhir = None
        keluar.append({
            "h3_index": _h3.latlng_to_cell(b["lat"], b["lon"], H3_RESOLUSI),
            "jam": jam,
            "total_nominal": float(nominal),
            "akhir_pekan": akhir,
            "n_mentah": 1,
        })
    return pd.DataFrame(keluar)


def variabel_dari_struk(struk: pd.DataFrame, profil: pd.DataFrame) -> pd.DataFrame:
    """B01-B05, B09, B10, D11 dari struk yang jamnya terbaca.

    B01-B04 adalah PANGSA, jadi penyebutnya struk di dalam jam operasional -
    bukan seluruh struk. Struk pukul 02.00 tidak mengurangi pangsa pagi sebuah
    heksagon; ia cuma di luar jam yang diukur Commuter Clock.
    """
    from config import JAM_OPERASIONAL
    from s4_spatial import belanja_per_jam

    if struk.empty:
        return pd.DataFrame()

    dalam = struk[struk["jam"].isin(JAM_OPERASIONAL)]
    hasil = pd.DataFrame(index=sorted(set(struk["h3_index"])))
    hasil.index.name = "h3_index"

    n_jam = dalam.groupby("h3_index").size()
    for kolom, rentang in EMBER_JAM.items():
        n = dalam[dalam["jam"].isin(rentang)].groupby("h3_index").size()
        # Heksagon yang punya struk TAPI tidak satu pun di ember ini bernilai
        # NOL - itu temuan. Yang tidak punya struk sama sekali tidak muncul di
        # `n_jam`, jadi ia tetap NaN.
        hasil[kolom] = (n.reindex(n_jam.index).fillna(0) / n_jam).round(4)

    # B05 hanya dari struk yang bertanggal. Kelipatan, bukan pangsa: 1,0 berarti
    # akhir pekan sama ramai dengan hari kerja, dan nilainya BOLEH melewati 1.
    bertanggal = struk[struk["akhir_pekan"].notna()]
    if not bertanggal.empty:
        g = bertanggal.groupby(["h3_index", "akhir_pekan"]).size().unstack(fill_value=0)
        if True in g.columns and False in g.columns:
            # Dua hari akhir pekan lawan lima hari kerja - dibagi jumlah harinya,
            # bukan dibandingkan mentah. Tanpa itu tiap lokasi akan tampak sepi
            # di akhir pekan hanya karena akhir pekan lebih pendek.
            # `np.nan`, BUKAN `pd.NA`. Keduanya terbaca "kosong" di layar,
            # tetapi `pd.NA` tidak punya `__round__` - jadi `.round(3)` di
            # bawahnya melempar TypeError begitu ada satu heksagon yang
            # strukya seluruhnya akhir pekan (pembagi nol -> inf -> kosong).
            # Tidak muncul pada 166 struk pertama, muncul pada 310.
            hasil["rasio_weekend"] = (
                ((g[True] / 2) / (g[False] / 5))
                .replace([np.inf, -np.inf], np.nan)
                .round(3)
            )

    hasil["nominal_median_struk"] = struk.groupby("h3_index")["total_nominal"].median().round(0)
    # D11 transaksi per JAM OPERASIONAL yang berisi - satuan yang sama dengan
    # B10, supaya keduanya bisa dibaca berdampingan.
    jam_berisi = dalam.groupby("h3_index")["jam"].nunique()
    hasil["intensitas_transaksi"] = (n_jam / jam_berisi).round(2)

    if not profil.empty:
        hasil["belanja_per_jam"] = belanja_per_jam(profil)

    return hasil


#: Sejauh apa sebuah struk masih boleh mewakili kawasan. Lima kilometer kira-
#: kira jangkauan satu simpul transit beserta lingkungan yang berorientasi
#: padanya; di luar itu ia kota yang lain.
RADIUS_KAWASAN_M = 5000

#: Di bawah ini pangsa per jamnya derau, bukan pola. Sepuluh struk yang tersebar
#: di 18 jam operasional sudah tipis; lebih sedikit lagi berarti satu struk
#: menggeser sebuah ember sepuluh persen.
MIN_STRUK_PERKIRAAN = 10


def perkiraan_jam_kawasan(struk: pd.DataFrame, kawasan_hex: pd.Series) -> list[dict]:
    """B01-B04 tingkat KAWASAN untuk heksagon yang tidak punya struknya sendiri.

    Dari 163 struk yang jamnya terbaca, hanya 7 jatuh di dalam 708 heksagon
    kita - misi disebar se-Jabodetabek, bukan di grid kita. Membuangnya berarti
    membuang 156 pengamatan sungguhan; memakainya sebagai nilai heksagon
    berarti mengaku mengukur tempat yang tidak pernah didatangi siapa pun.

    Jalan ketiga: pola JAM-nya - bukan nominalnya - diperlakukan sebagai ciri
    KAWASAN, dan disimpan sebagai perkiraan berlabel. Itu pernyataan yang bisa
    dipertanggungjawabkan: "di sekitar simpul ini, transaksi memuncak sore",
    bukan "heksagon ini memuncak sore".

    Heksagon yang PUNYA strukya sendiri dilewati - perkiraan tidak pernah boleh
    berdiri di sebelah pengukuran untuk hal yang sama.
    """
    import h3 as _h3

    from config import JAM_OPERASIONAL, PUSAT

    if struk.empty:
        return []

    lat = struk["h3_index"].map(lambda c: _h3.cell_to_latlng(c)[0]).to_numpy()
    lon = struk["h3_index"].map(lambda c: _h3.cell_to_latlng(c)[1]).to_numpy()
    nama_kawasan = list(PUSAT)
    jarak = np.stack([
        np.hypot((lat - la) * 111_320, (lon - lo) * 111_320 * np.cos(np.radians(la)))
        for la, lo in PUSAT.values()
    ])
    terdekat = jarak.argmin(axis=0)
    milik = pd.Series([nama_kawasan[i] for i in terdekat], index=struk.index)
    milik = milik.where(jarak.min(axis=0) <= RADIUS_KAWASAN_M)

    punya_sendiri = set(struk.loc[struk["h3_index"].isin(kawasan_hex.index), "h3_index"])
    baris: list[dict] = []
    for kawasan in nama_kawasan:
        bagian = struk[milik.eq(kawasan) & struk["jam"].isin(JAM_OPERASIONAL)]
        if len(bagian) < MIN_STRUK_PERKIRAAN:
            continue
        pangsa = {
            kolom: round(float(bagian["jam"].isin(rentang).mean()), 4)
            for kolom, rentang in EMBER_JAM.items()
        }
        sasaran = [h for h in kawasan_hex[kawasan_hex.eq(kawasan)].index
                   if h not in punya_sendiri]
        rincian = json.dumps({
            "kawasan": kawasan,
            "n_struk": int(len(bagian)),
            "n_jam_terisi": int(bagian["jam"].nunique()),
            "pangsa": pangsa,
        }, ensure_ascii=False)
        for kolom, nilai in pangsa.items():
            kode = {v: k for k, v in KODE_KE_KOLOM.items()}[kolom]
            for h3 in sasaran:
                baris.append({
                    "h3_index": h3, "kode": kode, "nilai": nilai,
                    "metode": "kawasan", "n_sumber": int(len(bagian)),
                    "radius_m": RADIUS_KAWASAN_M, "rincian": rincian,
                })
    return baris


def bangun_blok(heksagon: pd.Series) -> pd.DataFrame:
    """Seluruh blok (anak H3 res-10) beserta indikator dan skornya.

    `heksagon`: h3_index -> kawasan, untuk seluruh heksagon yang diskor.

    Murni membaca berkas mentah - tidak menulis apa pun ke mana pun. Pemisahan
    itu yang membuat `--blok --kering` bisa dijalankan tanpa basis data yang
    boleh ditulisi: hasilnya bisa diperiksa dulu sebagai berkas sebelum ada
    satu baris pun yang berubah.
    """
    from config import H3_RESOLUSI_BLOK, PUSAT
    from s2_clean import henti_dari_osm, jalan_dari_osm, konteks_bertitik_dari_osm, poi_dari_osm
    from s4_spatial import blok_dari_heksagon, indikator_blok
    from s6_score import skor_blok

    wajib = {
        "osm_poi.json": "python s1_ingest.py --poi",
        "osm_henti.json": "python s1_ingest.py --henti",
        "osm_jalan.json": "python s1_ingest.py --jalan",
        "rdtr_blok.json": "python s1_ingest.py --rdtr-blok",
        "ors_blok.json": "python rute_ors.py --blok",
    }
    for nama, perintah in wajib.items():
        if not (DATA_MENTAH / nama).exists():
            raise SystemExit(f"{nama} belum ada. Jalankan dulu:  {perintah}")

    baca = lambda nama: json.loads((DATA_MENTAH / nama).read_text(encoding="utf-8"))  # noqa: E731
    elemen_poi = baca("osm_poi.json").get("elements", [])

    blok = blok_dari_heksagon(heksagon.index, H3_RESOLUSI_BLOK)
    ind = indikator_blok(
        blok,
        poi=poi_dari_osm(elemen_poi),
        konteks=konteks_bertitik_dari_osm(elemen_poi),
        henti=henti_dari_osm(baca("osm_henti.json").get("elements", [])),
        jalan=jalan_dari_osm(baca("osm_jalan.json").get("elements", [])),
        bangunan=_bangunan_bertitik(),
        rdtr_blok=baca("rdtr_blok.json"),
        ors_blok=baca("ors_blok.json"),
        pusat_kawasan=PUSAT,
        kawasan_induk=heksagon,
    )
    ind["h3_induk"] = blok["h3_induk"]
    skor = skor_blok(ind)
    return blok.join(ind.drop(columns=["h3_induk"])).join(skor.drop(columns=["h3_induk"]))


def _baris_blok(df: pd.DataFrame) -> list[dict]:
    """DataFrame blok -> baris siap INSERT, dengan JSON per kelas/jenis."""
    import h3

    from config import KELAS_INDUK

    penarik = ("sekolah", "rumah_sakit", "pasar", "ibadah", "kantor")
    baris = []
    for b, r in df.iterrows():
        cincin = [(lo, la) for la, lo in h3.cell_to_boundary(b)]
        cincin.append(cincin[0])
        wkt = "POLYGON((" + ", ".join(f"{x:.7f} {y:.7f}" for x, y in cincin) + "))"
        izin = r["izin_komersial"]
        baris.append({
            "h3_blok": b,
            "h3_induk": r["h3_induk"],
            "wkt": wkt,
            "lat": round(float(r["lat"]), 7),
            "lon": round(float(r["lon"]), 7),
            "menit_jalan": _bersih(r["menit_jalan"]),
            "jarak_jalan_m": _bersih(r["jarak_jalan_m"]),
            "jarak_jalan_utama_m": _bersih(r["jarak_jalan_utama_m"]),
            "nama_jalan_utama": _bersih(r["nama_jalan_utama"]),
            "kelas_jalan_utama": _bersih(r["kelas_jalan_utama"]),
            "jarak_jalan_terdekat_m": _bersih(r["jarak_jalan_terdekat_m"]),
            "n_usaha_150m": int(r["n_usaha_150m"]),
            "usaha_per_kelas_150m": json.dumps({k: int(r[f"n_{k}_150m"]) for k in KELAS_INDUK}),
            "n_penarik_250m": int(r["n_penarik_250m"]),
            "penarik_250m": json.dumps({j: int(r[f"n_{j}_250m"]) for j in penarik}),
            "jarak_halte_m": _bersih(r["jarak_halte_m"]),
            "n_bangunan": int(r["n_bangunan"]),
            "rasio_tutupan_bangunan": _bersih(r["rasio_tutupan_bangunan"]),
            # `is True`/`is False`, bukan truthiness: None harus tetap None.
            "izin_komersial": True if izin is True else False if izin is False else None,
            "kelas_zona": (_bersih(r["kelas_zona"]) or None) and str(r["kelas_zona"])[:60],
            "pangsa_zona_usaha": _bersih(r["pangsa_zona_usaha"]),
            "risiko_banjir": _bersih(r["risiko_banjir"]),
            "skor_blok": _bersih(r["skor_blok"]),
            "skor_per_kelas": json.dumps(r["skor_per_kelas"]),
            "kontribusi": json.dumps(r.get("kontribusi")),
            "peringkat_induk": int(r["peringkat_induk"]),
        })
    return baris


def muat_blok(db: Session, df: pd.DataFrame) -> int:
    """Tulis seluruh blok ke `blok_heksagon`. Hapus-lalu-isi, satu transaksi.

    Hapus-lalu-isi aman di SINI (tidak seperti transport_nodes): tidak ada
    tabel lain yang menunjuk `blok_heksagon`, jadi tidak ada cascade yang bisa
    membawa serta data lain. Diperiksa, bukan diasumsikan - grep `blok_heksagon`
    di models.py hanya menemukan tabelnya sendiri.
    """
    baris = _baris_blok(df)
    db.execute(text("DELETE FROM blok_heksagon"))
    sisip = text(
        """
        INSERT INTO blok_heksagon (
            h3_blok, h3_induk, geom, lat, lon, menit_jalan, jarak_jalan_m,
            jarak_jalan_utama_m, nama_jalan_utama, kelas_jalan_utama,
            jarak_jalan_terdekat_m, n_usaha_150m, usaha_per_kelas_150m,
            n_penarik_250m, penarik_250m, jarak_halte_m, n_bangunan,
            rasio_tutupan_bangunan, izin_komersial, kelas_zona, pangsa_zona_usaha,
            risiko_banjir, skor_blok, skor_per_kelas, kontribusi, peringkat_induk
        ) VALUES (
            :h3_blok, :h3_induk, ST_GeomFromText(:wkt, 4326), :lat, :lon, :menit_jalan,
            :jarak_jalan_m, :jarak_jalan_utama_m, :nama_jalan_utama, :kelas_jalan_utama,
            :jarak_jalan_terdekat_m, :n_usaha_150m, CAST(:usaha_per_kelas_150m AS jsonb),
            :n_penarik_250m, CAST(:penarik_250m AS jsonb), :jarak_halte_m, :n_bangunan,
            :rasio_tutupan_bangunan, :izin_komersial, :kelas_zona, :pangsa_zona_usaha,
            :risiko_banjir, :skor_blok, CAST(:skor_per_kelas AS jsonb),
            CAST(:kontribusi AS jsonb), :peringkat_induk
        )
        """
    )
    for bagian in _potong(baris):
        db.execute(sisip, bagian)
    return len(baris)


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

    # String biasa, bukan : ia masih memuat {saring} yang dirakit per
    # kawasan di bawah.  dipanggil sesudah formatnya lengkap.
    kueri = f"""
        SELECT h.h3_index, h.kawasan, h.tingkat_keyakinan, h.n_titik_misi,
               h.data_source, h.zona_izin_komersial, h.indeks_churn,
               h.harga_sewa_median, h.harga_sewa_per_m2, h.belanja_per_jam, h.njop_m2,
               s.opportunity_score, s.hidden_gem_score, s.kuadran,
               ST_AsGeoJSON(h.geom, {DESIMAL_GEOJSON}) AS geom
        FROM hex_features h
        LEFT JOIN location_scores s
               ON s.h3_index = h.h3_index AND s.versi = :versi
        {{saring}}
        """

    with Sesi() as db:
        for kawasan in [*KAWASAN_PILOT, None]:
            # Klausa saringnya DIRAKIT, bukan dimatikan lewat `:kawasan IS NULL`.
            #
            # Bentuk itu terlihat rapi dan tidak pernah berhasil sekali pun:
            # parameter yang hanya muncul di `IS NULL` tidak punya tipe yang bisa
            # disimpulkan PostgreSQL, dan ia menjawab "could not determine data
            # type of parameter". Jadi `--ekspor` selalu meledak - sementara
            # docs/arsitektur.md sudah menyebutnya "tinggal disajikan" dan tidak
            # ada satu pun uji yang menyentuhnya.
            #
            # Nama kawasan TIDAK ditempel ke SQL; ia tetap parameter. Yang
            # dirakit cuma ada-tidaknya klausanya.
            q = text(
                kueri.format(saring="" if kawasan is None else "WHERE h.kawasan = :kawasan")
            )
            param: dict[str, object] = {"versi": versi}
            if kawasan is not None:
                param["kawasan"] = kawasan
            baris = db.execute(q, param).mappings().all()
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


#: Sumber yang menyumbang angka ke peta ini, beserta cara mengukur cakupannya.
#:
#: `ukur` bukan hiasan: ia yang membuat "berapa heksagon yang benar-benar
#: disentuh sumber ini" bisa DIHITUNG alih-alih ditaksir. Sumber yang tidak
#: menyentuh satu heksagon pun jadi tidak bisa mengaku menyentuh 708 - dan
#: daftar sumber yang ditulis tangan selalu kedaluwarsa ke arah itu.
#:
#: Ekspresinya konstanta modul, tidak pernah datang dari masukan pengguna.
#:
#: `jenis` ditambahkan 12 Sep 2026, dan ia bukan label kosmetik: ia yang
#: memisahkan "diukur" dari "diperkirakan" di daftar yang dibaca juri. Sebuah
#: baris berjenis `perkiraan` TIDAK pernah mengisi kolom di `hex_features`,
#: tidak pernah menghitung skor, dan tidak pernah mewarnai peta - jadi daftar
#: ini sekaligus jawaban atas "mana yang resmi dan mana yang bukan", dibangun
#: dari tempat yang sama dengan yang membangun datanya.
SUMBER_DATA: list[dict[str, str | None]] = [
    {
        "kunci": "activity",
        "jenis": "resmi",
        "nama": "MAPID Community Maps (Activity)",
        "lisensi": "Data kompetisi MAPID",
        "url": "https://mapid.co.id/data-catalog",
        "mengisi": "D12 aktivitas komunitas",
        "ukur": "aktivitas_komunitas IS NOT NULL",
    },
    {
        "kunci": "misi",
        "jenis": "resmi",
        "nama": "MAPID Mission — Menu Go, Struk Go, Properti Go",
        "lisensi": "Data kompetisi MAPID",
        "url": "https://mapid.co.id/data-catalog",
        "mengisi": "B06–B08, C07, C08, D10, P03, dan badge keyakinan Q01–Q03",
        "ukur": "n_titik_misi > 0",
    },
    {
        "kunci": "basemap",
        "jenis": "resmi",
        "nama": "MAPID Maps",
        "lisensi": "Basemap kompetisi",
        "url": "https://geo.mapid.io/",
        "mengisi": "Basemap peta — lima gaya termasuk satelit dan gedung 3D, seluruh ubin",
        "ukur": None,
    },
    {
        "kunci": "osm",
        "jenis": "resmi",
        "nama": "OpenStreetMap contributors",
        "lisensi": "ODbL 1.0",
        "url": "https://www.openstreetmap.org/copyright",
        "mengisi": "C01–C06 kompetisi, D05 skor simpul, D08, D09, M01, M02",
        "ukur": "kepadatan_poi_total IS NOT NULL",
    },
    {
        "kunci": "ors",
        "jenis": "resmi",
        "nama": "openrouteservice",
        "lisensi": "CC BY-SA 4.0",
        "url": "https://openrouteservice.org/",
        "mengisi": "D03 jarak dan D04 waktu jalan kaki, plus kawasan jangkau",
        "ukur": "waktu_jalan_menit IS NOT NULL",
    },
    {
        "kunci": "worldpop",
        "jenis": "resmi",
        "nama": "WorldPop 2020 (UN-adjusted, constrained)",
        "lisensi": "CC BY 4.0",
        "url": "https://www.worldpop.org/",
        "mengisi": "D01 jumlah penduduk, dan C06 yang bergantung padanya",
        "ukur": "pop_100m IS NOT NULL",
    },
    {
        "kunci": "rdtr",
        "jenis": "resmi",
        "nama": "RDTR ATR/BPN lewat GISTARU",
        "lisensi": "Data terbuka pemerintah",
        "url": "https://gistaru.atrbpn.go.id/rdtrinteraktif/",
        "mengisi": "L01 izin komersial, L02 kelas zona, L03 risiko banjir",
        "ukur": "kelas_zona IS NOT NULL",
    },
    {
        "kunci": "worldpop_umur",
        "jenis": "resmi",
        "nama": "WorldPop 2020 struktur umur — diolah tim data Loconomics",
        "lisensi": "CC BY 4.0",
        "url": "https://www.worldpop.org/",
        "mengisi": "D02 penduduk usia produktif",
        "ukur": "pop_usia_produktif IS NOT NULL",
    },
    {
        # SATU-SATUNYA baris berjenis `perkiraan` di daftar ini, dan ia sengaja
        # berdiri di daftar yang sama alih-alih disembunyikan di dokumen lain:
        # yang membuat sebuah daftar sumber bisa dipercaya bukan karena isinya
        # bagus semua, melainkan karena yang lemah ikut tercantum dengan
        # namanya sendiri.
        "kunci": "model_tim_ai",
        "jenis": "perkiraan",
        "nama": "Model tim AI Loconomics (GradientBoosting)",
        "lisensi": "Karya tim, dilatih atas sampel MAPID + augmentasi sintetis",
        "url": "https://github.com/syahh-coder/Loconomics-AI",
        "mengisi": "PERKIRAAN D10 dan B07 — panel detail saja, tidak pernah masuk skor atau peta",
        "ukur": None,
    },
]


def _id(nilai: float, desimal: int = 2) -> str:
    """Angka dalam bentuk yang dibaca orang Indonesia: koma, bukan titik.

    Dipakai di dalam KALIMAT temuan, bukan cuma di kolom angka - dan itu yang
    membuatnya perlu ada di Python alih-alih di frontend. Kalimatnya sendiri
    dirangkai di sini supaya tidak ada satu pun angka yang bisa berpisah dari
    prosa yang menerangkannya.
    """
    return f"{nilai:,.{desimal}f}".replace(",", " ").replace(".", ",")


def _batang(label: str, nilai: float, tekan: bool = False) -> dict[str, Any]:
    """Satu batang di grafik kecil temuan.

    `tekan` DIHILANGKAN kalau salah, tidak ditulis sebagai `false`. Bukan soal
    ukuran berkas: keempat temuan merangkai deretnya dengan cara yang berbeda -
    sebagian dari literal, sebagian dari hasil kueri - dan tanpa satu pintu
    keluar bersama, keluarannya berbeda bentuk untuk data yang sama artinya.
    """
    batang: dict[str, Any] = {"label": label, "nilai": nilai}
    if tekan:
        batang["tekan"] = True
    return batang


def hitung_temuan(db: Session, n_hex: int) -> list[dict[str, Any]]:
    """Empat kali pengukuran membantah dugaan yang wajar. Diturunkan, bukan ditulis.

    Ini bagian `#temuan` di halaman gerbang, dan alasannya ada di sini alih-alih
    ditulis tangan di komponennya sama dengan alasan `BATASAN` ada di sini:
    angka yang ditulis tangan di halaman gerbang sudah pernah kedaluwarsa ke arah
    yang paling merugikan. Kali ini taruhannya lebih besar, karena yang basi bukan
    cuma angka melainkan KESIMPULAN - dan kesimpulan yang basi tidak terbaca
    sebagai angka lama, ia terbaca sebagai tim yang tidak memeriksa pekerjaannya.

    Bukti bahwa kekhawatiran itu bukan hipotesis: keenam angka yang tercatat di
    `CLAUDE.md` untuk temuan-temuan ini SUDAH meleset seluruhnya saat berkas ini
    ditulis - rasio memutar 1,82 melawan 1,78 yang terukur, jangkauan Manggarai
    17 heksagon melawan 9, selisih kerapatan OSM "sepuluh kali" melawan 16, dan
    ZoneGuard "2 heksagon dilarang" melawan 13. Semuanya bergeser saat grid
    Harjamukti dibangun ulang, dan tidak satu pun memunculkan galat.

    Kontraknya satu: **temuan yang bahannya tidak ada tidak diterbitkan.**
    Tabel kosong menghasilkan daftar yang lebih pendek, bukan kalimat yang
    mengarang. Itu sebabnya tiap blok di bawah memeriksa dulu barisnya ada.
    """
    temuan: list[dict[str, Any]] = []

    # --- 1 · Jarak lurus berbohong -----------------------------------------
    #
    # `urutan = 0` adalah rute TERCEPAT, bukan yang pertama dikembalikan ORS -
    # penomorannya sudah diurutkan ulang menurut durasi oleh `rute_ors --rapikan`.
    r = db.execute(
        text("""
            WITH r AS (
                SELECT hr.jarak_m,
                       ST_Distance(ST_Centroid(hf.geom::geometry)::geography,
                                   tn.geom::geography) AS lurus
                FROM hex_routes hr
                JOIN hex_features hf ON hf.h3_index = hr.h3_index
                JOIN transport_nodes tn ON tn.id = hr.transport_node_id
                -- Temuannya berbunyi "rute JALAN KAKI rata-rata 1,78x lebih
                -- panjang". Tanpa saringan profil ia menghitung rute mobil
                -- sekalian, dan angkanya berhenti menjawab kalimatnya sendiri.
                WHERE hr.urutan = 0 AND hr.profil = 'foot-walking'
            ), s AS (SELECT jarak_m / NULLIF(lurus, 0) AS rasio FROM r)
            SELECT count(*),
                   avg(rasio),
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY rasio),
                   max(rasio),
                   count(*) FILTER (WHERE rasio < 1.2),
                   count(*) FILTER (WHERE rasio >= 1.2 AND rasio < 1.5),
                   count(*) FILTER (WHERE rasio >= 1.5 AND rasio < 2.0),
                   count(*) FILTER (WHERE rasio >= 2.0),
                   count(*) FILTER (WHERE rasio < 1.0)
            FROM s
        """)
    ).one()
    if r[0]:
        n, rata, median, maks, b1, b2, b3, b4, lebih_pendek = r
        temuan.append({
            "kunci": "rute",
            "dugaan": "Jarak lurus ke stasiun cukup untuk memperkirakan jalan kakinya.",
            "judul": f"Rute jalan kaki rata-rata {_id(rata)}× lebih panjang daripada garis lurusnya",
            "angka": f"{_id(rata)}×",
            "satuan": "rata-rata rute memutar",
            "uraian": (
                f"{_id(n, 0)} rute tercepat dihitung openrouteservice dari pusat tiap heksagon "
                f"ke simpul terdekatnya, lalu dibandingkan dengan jarak lurus ke titik yang sama. "
                f"Median {_id(median)}×, dan yang terjauh memutar {_id(maks)}× — "
                f"{_id(b4, 0)} heksagon harus berjalan dua kali lipat jarak lurusnya atau lebih. "
                f"Tidak satu pun rute lebih pendek daripada garis lurusnya ({lebih_pendek} dari "
                f"{_id(n, 0)}), dan itu invarian yang sengaja diuji: kalau ada, "
                "lintang dan bujurnya tertukar."
            ),
            "akibat": (
                "Garis lurus putus-putus dicabut dari peta. Yang tergambar sekarang jalur yang "
                "benar-benar bisa dijalani, dan menit yang tertulis di panel dibaca dari jalur itu."
            ),
            "deret": [
                _batang("di bawah 1,2×", b1),
                _batang("1,2–1,5×", b2),
                _batang("1,5–2×", b3),
                _batang("2× ke atas", b4, tekan=True),
            ],
            "deretSatuan": "heksagon",
            "desimal": 0,
        })

    # --- 2 · Kawasan jangkau yang dipotong jaringannya sendiri --------------
    #
    # Dihitung per SIMPUL, bukan per kawasan: yang memotongnya emplasemen rel,
    # dan itu sifat stasiunnya. Luas dari geografi, jadi satuannya benar-benar
    # km2 dan bukan derajat persegi.
    baris = db.execute(
        text("""
            SELECT tn.nama, tn.moda,
                   ST_Area(ca.geom::geography) / 1e6 AS km2,
                   (SELECT count(*) FROM hex_features hf
                     WHERE ST_Contains(ca.geom::geometry,
                                       ST_Centroid(hf.geom::geometry))) AS n_hex
            FROM catchment_areas ca
            JOIN transport_nodes tn ON tn.id = ca.transport_node_id
            WHERE ca.menit = 15
            ORDER BY km2
        """)
    ).all()
    if len(baris) >= 2:
        sempit, luas = baris[0], baris[-1]
        rasio = luas[2] / sempit[2] if sempit[2] else 0
        temuan.append({
            "kunci": "jangkau",
            "dugaan": "Stasiun yang lebih sibuk menjangkau kawasan yang lebih luas.",
            "judul": (
                f"{sempit[0]} justru punya kawasan jangkau tersempit — "
                f"{_id(rasio, 1)}× lebih kecil daripada {luas[0]}"
            ),
            "angka": f"{_id(sempit[2])} km²",
            "satuan": f"jangkauan 15 menit {sempit[0]}",
            "uraian": (
                f"Kawasan jangkau ditarik dari openrouteservice sebagai isochrone berjalan kaki, "
                f"lalu luasnya diukur di atas geografi bumi. Dalam 15 menit, {sempit[0]} hanya "
                f"menjangkau {_id(sempit[3], 0)} dari {_id(n_hex, 0)} heksagon, sementara "
                f"{luas[0]} menjangkau {_id(luas[3], 0)}. Bukan soal ukuran stasiunnya: "
                "emplasemen rel yang lebar memotong jalan kaki ke segala arah, dan yang "
                "tersisa cuma dua sisi peron."
            ),
            "akibat": (
                "Kawasan jangkau digambar sebagai bentuk yang diukur, bukan sebagai lingkaran "
                "berjari-jari sekian meter. Lingkaran akan menjanjikan pembeli dari arah "
                "yang tidak ada jalannya."
            ),
            "deret": [
                _batang(f"{n} · {m}", round(k, 2), tekan=n == sempit[0])
                for n, m, k, _ in baris
            ],
            "deretSatuan": "km² dalam 15 menit",
            "desimal": 2,
        })

    # --- 3 · Kerapatan pemetaan bukan kerapatan usaha -----------------------
    #
    # Temuan yang paling gampang salah dipakai, dan justru itu sebabnya ia ada
    # di halaman ini: "tidak ada kompetitor" adalah kalimat yang paling menggoda
    # untuk dibaca sebagai peluang.
    baris = db.execute(
        text("""
            SELECT hf.kawasan,
                   count(DISTINCT hf.h3_index) AS n_hex,
                   count(bp.id)::numeric / count(DISTINCT hf.h3_index) AS per_hex,
                   count(DISTINCT hf.h3_index)
                     FILTER (WHERE hf.kepadatan_poi_total = 0) AS nol
            FROM hex_features hf
            LEFT JOIN business_pois bp
              ON bp.h3_index = hf.h3_index AND bp.sumber = 'osm'
            GROUP BY hf.kawasan
            ORDER BY per_hex DESC
        """)
    ).all()
    n_nol = sum(b[3] for b in baris)
    if baris and baris[-1][2] and n_nol:
        rapat, jarang = baris[0], baris[-1]
        temuan.append({
            "kunci": "pemetaan",
            "dugaan": "Heksagon tanpa kompetitor terpetakan berarti pasar yang belum terlayani.",
            "judul": (
                f"OpenStreetMap memetakan {rapat[0]} {_id(rapat[2] / jarang[2], 0)}× lebih rapat "
                f"daripada {jarang[0]}"
            ),
            "angka": f"{_id(n_nol, 0)}",
            "satuan": f"dari {_id(n_hex, 0)} heksagon tanpa satu pun usaha terpetakan",
            "uraian": (
                f"{_id(rapat[2])} POI usaha per heksagon di {rapat[0]}, melawan "
                f"{_id(jarang[2])} di {jarang[0]}. Sebagian selisih itu memang kenyataan — "
                f"kawasan yang belum matang memang lebih sepi. Sebagian lagi kerapatan "
                f"PEMETAANNYA, dan dari data saja keduanya tidak bisa dipisahkan. "
                f"{_id(jarang[3], 0)} dari {_id(jarang[1], 0)} heksagon "
                f"{jarang[0]} tercatat nol kompetitor."
            ),
            "akibat": (
                "Insight “sepi pesaing” dijaga syarat kepadatan POI di atas nol. Lubang data "
                "tidak pernah boleh disodorkan sebagai alasan memilih lokasi — itu persis "
                "Hidden Gem palsu yang jadi alasan produk ini ada."
            ),
            "deret": [
                _batang(b[0], round(float(b[2]), 2), tekan=b[0] == jarang[0])
                for b in baris
            ],
            "deretSatuan": "POI usaha per heksagon",
            "desimal": 2,
        })

    # --- 4 · ZoneGuard menolkan, dan diam kalau tidak tahu ------------------
    r = db.execute(
        text("""
            SELECT count(*) FILTER (WHERE zona_izin_komersial IS TRUE),
                   count(*) FILTER (WHERE zona_izin_komersial IS FALSE),
                   count(*) FILTER (WHERE zona_izin_komersial IS NULL)
            FROM hex_features
        """)
    ).one()
    izin, larang, belum = r
    if larang:
        temuan.append({
            "kunci": "zonasi",
            "dugaan": "Peruntukan lahan bisa disimpulkan dari apa yang terlihat berdiri di sana.",
            "judul": (
                f"{_id(larang, 0)} heksagon berskor nol karena zonasinya — dan {_id(belum, 0)} "
                "lainnya sengaja tidak dinilai sama sekali"
            ),
            "angka": f"{_id(larang, 0)}",
            "satuan": "heksagon dinolkan zonasinya",
            "uraian": (
                "Zonasi RDTR ATR/BPN disampel per POLIGON heksagon dan ditimbang menurut luas "
                "perpotongannya, bukan ditanyakan di satu titik tengah — satu heksagon Manggarai "
                "memotong lima poligon di empat zona berbeda, dan titik tengahnya hanya menjawab "
                f"salah satunya. Hasilnya {_id(izin, 0)} heksagon diizinkan, {_id(larang, 0)} "
                f"dilarang, dan {_id(belum, 0)} belum punya RDTR digital sama sekali."
            ),
            "akibat": (
                "Yang dilarang berskor nol berapa pun angka ekonominya, dan tidak pernah muncul "
                "di daftar rekomendasi. Yang belum berzona dinyatakan “belum bisa dipastikan” — "
                "diam yang jujur, bukan tebakan aman."
            ),
            "deret": [
                _batang("Diizinkan", izin),
                _batang("Dilarang", larang, tekan=True),
                _batang("RDTR belum terbit", belum),
            ],
            "deretSatuan": "heksagon",
            "desimal": 0,
        })

    return temuan


def ekspor_ringkasan(tujuan: Path = RINGKASAN_TS) -> dict[str, Any]:
    """Tulis cakupan data hari ini sebagai modul TypeScript untuk halaman gerbang.

    Kenapa dibangkitkan dan bukan ditulis tangan: halaman gerbang menyebut
    angka, dan angka yang ditulis tangan di sana sudah pernah kedaluwarsa ke
    arah yang paling merugikan - ia mengaku "43 variabel per titik" sementara
    yang terisi 25, dan menjanjikan "18 jam profil harian" sementara tabelnya
    nol baris. Aturannya sama dengan pita status di bilah atas: kalau sebuah
    PEMICU perlu dihitung dari data supaya tidak berbohong, KALIMAT yang
    menyertainya perlu dihitung dari data untuk alasan yang persis sama.

    Batasannya ikut diturunkan, bukan didaftar tangan. Daftar batasan tulis
    tangan basi ke dua arah sekaligus: ia tetap menyebut kekurangan yang sudah
    diperbaiki, dan diam soal yang baru muncul.

    Modul TypeScript, bukan JSON di `public/`: halaman gerbang satu-satunya
    bagian yang tetap hidup tanpa backend, jadi ia tidak boleh punya satu pun
    permintaan jaringan yang bisa gagal.
    """
    Sesi = sessionmaker(bind=_mesin())
    kolom = list(KODE_KE_KOLOM.values())
    berukur = [s for s in SUMBER_DATA if s["ukur"]]

    with Sesi() as db:
        n_hex, n_kawasan, n_predicted = db.execute(
            text(
                "SELECT count(*), count(DISTINCT kawasan), "
                "count(*) FILTER (WHERE data_source <> 'observed') FROM hex_features"
            )
        ).one()

        # SATU kueri berisi 43 count(), bukan 43 kueri berisi satu count(). Yang
        # menentukan biaya bukan berat kuerinya melainkan berapa kali jaringan
        # ke Supabase diseberangi - terukur ~700 ms sekali jalan.
        n_terisi = sum(
            1
            for n in db.execute(
                text("SELECT " + ", ".join(f'count("{k}")' for k in kolom) + " FROM hex_features")  # noqa: S608
            ).one()
            if n
        )

        cakupan = dict(
            zip(
                (s["kunci"] for s in berukur),
                db.execute(
                    text(
                        "SELECT "
                        + ", ".join(f"count(*) FILTER (WHERE {s['ukur']})" for s in berukur)
                        + " FROM hex_features"
                    )  # noqa: S608
                ).one(),
            )
        )

        n_poi, n_rute, n_jangkau, n_simpul, n_jam, n_menu, n_struk, n_properti = db.execute(
            text(
                "SELECT (SELECT count(*) FROM business_pois WHERE sumber = 'osm'),"
                " (SELECT count(*) FROM hex_routes WHERE profil = 'foot-walking'),"
                " (SELECT count(*) FROM catchment_areas),"
                " (SELECT count(*) FROM transport_nodes),"
                " (SELECT count(*) FROM hex_hourly_profiles),"
                " (SELECT count(*) FROM menu_observations),"
                " (SELECT count(*) FROM receipt_observations),"
                " (SELECT count(*) FROM property_observations)"
            )
        ).one()

        # Taksonomi 8 kelas induk, dengan jumlah POI dan sebaran heksagonnya.
        #
        # Dibangkitkan dan bukan didaftar di frontend dengan alasan yang sama
        # dengan seluruh berkas ini: daftarnya sudah ada di `config.KELAS_INDUK`,
        # dan daftar KEDUA yang harus sejalan dengannya adalah daftar yang suatu
        # saat tidak sejalan. Kelas yang nol POI tetap diterbitkan - "belum ada
        # yang terpetakan" itu temuan, bukan alasan menyembunyikan barisnya.
        cacah_kelas = dict(
            db.execute(
                text(
                    "SELECT kelas_induk, count(*) FROM business_pois GROUP BY kelas_induk"
                )
            ).all()
        )
        hex_kelas = dict(
            db.execute(
                text(
                    "SELECT kelas_induk, count(DISTINCT h3_index) FROM business_pois "
                    "GROUP BY kelas_induk"
                )
            ).all()
        )
        kelas_usaha = sorted(
            (
                {
                    "kode": kode,
                    "nama": nama,
                    "poi": int(cacah_kelas.get(kode, 0)),
                    "heksagon": int(hex_kelas.get(kode, 0)),
                }
                for kode, nama in KELAS_INDUK.items()
            ),
            key=lambda k: (-k["poi"], k["kode"]),
        )

        # Di dalam sesi yang sama - temuan menanyakan tabel yang berbeda, tetapi
        # tidak boleh menanyakan basis data yang berbeda. Ringkasan dan temuan
        # yang dibaca dari dua potret waktu bisa saling membantah di halaman
        # yang sama, dan itu jenis salah yang tidak akan pernah terlihat.
        temuan = hitung_temuan(db, n_hex)

    # Berapa titik misi yang DITARIK, bukan cuma yang mendarat di wilayah studi.
    # Dua angka yang berbeda dan dua-duanya perlu disebut: yang pertama
    # menyatakan berapa banyak survei peserta yang tersedia, yang kedua berapa
    # yang menyentuh enam kawasan pilot. Menyebut yang pertama saja melebih-
    # lebihkan; menyebut yang kedua saja meremehkan sumbernya sendiri.
    berkas_misi = DATA_MENTAH / "mapid_misi.json"
    ditarik = None
    if berkas_misi.exists():
        mentah = json.loads(berkas_misi.read_text(encoding="utf-8"))
        ditarik = sum(len(v) for v in mentah.values() if isinstance(v, list))

    batasan: list[str] = []
    if n_terisi < len(kolom):
        batasan.append(
            f"{len(kolom) - n_terisi} dari {len(kolom)} variabel belum punya sumber "
            "yang bisa dikutip. Nilainya dibiarkan kosong, bukan dinolkan — indeks "
            "yang bahannya kosong dinetralkan ke tengah skala, dan antarmuka "
            "menuliskan “belum terukur” alih-alih menampilkan angkanya."
        )
    if cakupan.get("rdtr", 0) < n_hex:
        batasan.append(
            f"Zonasi RDTR baru terbit untuk {cakupan.get('rdtr', 0)} dari {n_hex} "
            "heksagon. Kota Depok dan Kota Bekasi terkonfirmasi belum punya RDTR "
            "digital di GISTARU lewat dua indeks yang berbeda, jadi ZoneGuard diam "
            "untuk keduanya alih-alih menebak."
        )
    if not n_jam:
        batasan.append(
            "Profil per jam masih kosong. Struk misi MAPID tidak membawa kolom waktu "
            "transaksi sama sekali — jamnya tercetak di dalam foto struknya, dan "
            "pembacaan foto itu belum dijalankan."
        )
    if cakupan.get("misi", 0) < n_hex:
        batasan.append(
            f"Survei lapangan menyentuh {cakupan.get('misi', 0)} dari {n_hex} heksagon; "
            f"{n_predicted} sisanya ditandai “belum dikunjungi surveyor”. Itu pernyataan "
            "tentang kunjungan, bukan tentang mutu angkanya — POI, rute, penduduk, dan "
            "zonasi tetap hasil pengukuran."
        )

    sumber = [
        {
            "nama": s["nama"],
            "jenis": s["jenis"],
            "lisensi": s["lisensi"],
            "url": s["url"],
            "mengisi": s["mengisi"],
            "cakupan": cakupan.get(s["kunci"]) if s["ukur"] else None,
        }
        for s in SUMBER_DATA
    ]
    ringkasan = {
        "heksagon": n_hex,
        "kawasan": n_kawasan,
        "variabelTerisi": n_terisi,
        "variabelTotal": len(kolom),
        "heksagonBersurvei": cakupan.get("misi", 0),
        "titikMisiDitarik": ditarik,
        "observasiMisi": n_menu + n_struk + n_properti,
        "poiOsm": n_poi,
        "ruteOrs": n_rute,
        "kawasanJangkau": n_jangkau,
        "simpul": n_simpul,
        "profilJam": n_jam,
    }

    def js(nilai: Any) -> str:
        return json.dumps(nilai, ensure_ascii=False)

    baris = [
        "/**",
        " * DIBUAT OTOMATIS oleh `pipeline/s7_publish.py --ekspor`. Jangan disunting tangan.",
        " *",
        " * Halaman gerbang menyebut angka soal cakupan datanya sendiri. Angka yang",
        " * ditulis tangan di sana sudah pernah kedaluwarsa ke arah yang paling",
        " * merugikan — mengaku 43 variabel saat 25 yang terisi, menjanjikan profil",
        " * per jam saat tabelnya nol baris. Yang dihitung tidak bisa ketinggalan.",
        " *",
        " * Untuk menyegarkannya:",
        " *",
        " *   cd pipeline && python s7_publish.py --ekspor",
        " */",
        "",
        "export interface SumberData {",
        "  nama: string",
        "  /** 'resmi' = diukur dan boleh mengisi kolom; 'perkiraan' = tidak pernah. */",
        "  jenis: string",
        "  lisensi: string",
        "  url: string",
        "  /** Variabel yang diisinya, dengan kode kanonik Kamus Data. */",
        "  mengisi: string",
        "  /** Heksagon yang benar-benar disentuh; null kalau tidak diukur per heksagon. */",
        "  cakupan: number | null",
        "}",
        "",
        "export interface DeretTemuan {",
        "  label: string",
        "  nilai: number",
        "  /** Batang yang jadi pokok temuannya; diberi warna aksen, bukan netral. */",
        "  tekan?: boolean",
        "}",
        "",
        "export interface Temuan {",
        "  /** Kunci stabil untuk React. Tidak pernah tampil di layar. */",
        "  kunci: string",
        "  /** Dugaan wajar yang dibantah pengukurannya. */",
        "  dugaan: string",
        "  /** Temuannya sebagai satu kalimat, angkanya sudah di dalam. */",
        "  judul: string",
        "  /** Angka yang dicetak besar, sudah berformat Indonesia. */",
        "  angka: string",
        "  satuan: string",
        "  /** Bagaimana diukurnya, dan apa yang tidak bisa disimpulkan darinya. */",
        "  uraian: string",
        "  /** Yang berubah di produk karena temuan ini. */",
        "  akibat: string",
        "  deret: DeretTemuan[]",
        "  deretSatuan: string",
        "  /** Angka desimal saat deretnya dicetak. */",
        "  desimal: number",
        "}",
        "",
        "/** Tanggal basis data dibaca. Dinyatakan apa adanya di halamannya. */",
        f"export const DIUKUR = {js(dt.date.today().isoformat())}",
        "",
        "export const RINGKASAN = {",
        *(f"  {k}: {js(v)}," for k, v in ringkasan.items()),
        "} as const",
        "",
        "export const SUMBER: SumberData[] = [",
        *(
            f"  {{ nama: {js(s['nama'])}, jenis: {js(s['jenis'])}, lisensi: {js(s['lisensi'])}, "
            f"url: {js(s['url'])}, mengisi: {js(s['mengisi'])}, cakupan: {js(s['cakupan'])} }},"
            for s in sumber
        ),
        "]",
        "",
        "export interface KelasUsaha {",
        "  /** Kode kanonik Kamus Data: F1, R1, S2, ... */",
        "  kode: string",
        "  nama: string",
        "  /** POI terpetakan di kelas ini, seluruh wilayah studi. */",
        "  poi: number",
        "  /** Heksagon yang memuat setidaknya satu POI kelas ini. */",
        "  heksagon: number",
        "}",
        "",
        "/**",
        " * Delapan kelas induk usaha, diurutkan menurut jumlah POI terpetakan.",
        " *",
        " * Satu POI masuk TEPAT SATU kelas — kalau sebuah POI bisa masuk dua,",
        " * kepadatan kompetitor terhitung dobel dan seluruh indeks kompetisi jadi",
        " * salah. Angkanya dari `business_pois`, jadi ia berubah begitu penarikan",
        " * OSM diulang dan tidak bisa basi tanpa ketahuan.",
        " */",
        "export const KELAS_USAHA: KelasUsaha[] = [",
        *(
            f"  {{ kode: {js(k['kode'])}, nama: {js(k['nama'])}, "
            f"poi: {js(k['poi'])}, heksagon: {js(k['heksagon'])} }},"
            for k in kelas_usaha
        ),
        "]",
        "",
        "/** Diturunkan dari basis data, bukan didaftar tangan. Lihat docstring pembangkitnya. */",
        "export const BATASAN: string[] = [",
        *(f"  {js(b)}," for b in batasan),
        "]",
        "",
        "/**",
        " * Empat kali pengukuran membantah dugaan yang wajar. Seluruhnya — termasuk",
        " * KALIMATNYA — dirangkai `s7_publish.hitung_temuan()` dari basis data.",
        " *",
        " * Temuan yang bahannya tidak ada tidak diterbitkan, jadi daftar ini boleh",
        " * lebih pendek. Komponen yang membacanya wajib tahan terhadap daftar kosong.",
        " */",
        "export const TEMUAN: Temuan[] = [",
        *(f"  {js(t)}," for t in temuan),
        "]",
        "",
    ]
    tujuan.parent.mkdir(parents=True, exist_ok=True)
    tujuan.write_text("\n".join(baris), encoding="utf-8")
    return {**ringkasan, "sumber": len(sumber), "batasan": len(batasan), "temuan": len(temuan)}


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
        "--gapfill",
        action="store_true",
        help="Latih GapFill B07 dengan ground truth se-Jabodetabek, lalu isi 708",
    )
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
        "--survei",
        action="store_true",
        help="Hasil survei lapangan (CSV) -> 12 variabel yang tidak punya sumber lain",
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
    p.add_argument(
        "--blok",
        action="store_true",
        help="Blok di dalam heksagon (anak H3 res-10): indikator + skor -> blok_heksagon",
    )
    p.add_argument(
        "--kering",
        action="store_true",
        help="Bersama --blok: hitung lalu tulis ke data/03_olahan/blok.json, TANPA basis data",
    )
    p.add_argument(
        "--ocr",
        action="store_true",
        help="Hasil OCR struk (A2) -> hex_hourly_profiles + B01-B05, B09, B10, D11",
    )
    p.add_argument(
        "--tim-ai",
        action="store_true",
        help="Serah terima tim AI: D02 -> hex_features (data), D10/B07 -> hex_perkiraan (perkiraan)",
    )
    p.add_argument("--versi", default="baseline")
    arg = p.parse_args()

    if not any([arg.muat, arg.ekspor, arg.cakupan, arg.isi_d04, arg.penduduk,
                arg.bangunan, arg.osm, arg.misi, arg.survei, arg.rdtr, arg.transit,
                arg.gapfill, arg.kosongkan, arg.hitung_ulang, arg.grid, arg.blok,
                arg.tim_ai, arg.ocr]):
        p.print_help()
        raise SystemExit(0)

    # --- Hasil OCR struk ---------------------------------------------------
    #
    # Transaksinya sendiri dan SEBELUM --hitung-ulang: B09 dan D11 masuk IAE,
    # jadi memuatnya tanpa menghitung ulang meninggalkan skor yang tidak lagi
    # cocok dengan variabel yang menyusunnya - dan selisih itu tidak akan
    # memunculkan satu pun galat.
    if arg.ocr:
        print("Memuat hasil OCR struk (A2)...")
        mentah = _hasil_ocr_a2()
        struk = baca_ocr_struk()
        print(f"  foto terbaca model     {len(mentah)}")
        print(f"  struk berjam terbaca  {len(struk)}")
        if struk.empty:
            print("  (tidak ada yang bisa dimuat)")
        else:
            with sessionmaker(bind=_mesin())() as db:
                print(f"  panggilan AI dicatat  {muat_log_ai(db, mentah, 'A2')}")
                db.commit()
                hex_df = pd.read_sql(
                    "SELECT * FROM hex_features", db.connection()
                ).set_index("h3_index")
                # Struk di luar 708 heksagon kita DIBUANG, dan jumlahnya
                # dilaporkan: misi disaring per poligon, tapi foto bisa saja
                # bergeser koordinatnya.
                milik_kita = struk[struk["h3_index"].isin(hex_df.index)]
                print(f"  di dalam 708 heksagon {len(milik_kita)} "
                      f"({len(struk) - len(milik_kita)} di luar, dibuang)")
                print(f"  heksagon tersentuh    {milik_kita['h3_index'].nunique()}")
                if milik_kita.empty:
                    print("  (tidak ada yang jatuh di wilayah studi)")
                else:
                    from s4_spatial import profil_jam

                    profil = profil_jam(milik_kita, hex_df)
                    print(f"  baris profil jam      {muat_profil_jam(db, profil)}")
                    var = variabel_dari_struk(milik_kita, profil)
                    print(f"  variabel diperbarui   {muat_variabel(db, var)}")
                    for kol in var.columns:
                        print(f"    {kol:<24} {int(var[kol].notna().sum())} heksagon")
                    db.commit()

                # PERKIRAAN tingkat kawasan dari struk yang jatuh DI LUAR grid.
                # Transaksinya sendiri supaya kegagalan di sini tidak ikut
                # membatalkan pengukuran yang sudah tersimpan di atas.
                perk = perkiraan_jam_kawasan(struk, hex_df["kawasan"])
                if perk:
                    print(f"  perkiraan jam kawasan {muat_perkiraan(db, perk)} baris "
                          f"({len({b['h3_index'] for b in perk})} heksagon)")
                    db.commit()
                else:
                    print("  perkiraan jam kawasan 0 (tidak ada kawasan yang cukup strukya)")

    # --- Serah terima tim AI ----------------------------------------------
    #
    # Transaksinya sendiri, dan berjalan sebelum --hitung-ulang supaya D02 yang
    # baru masuk ikut terbaca kalau skornya memang dihitung ulang di lari yang
    # sama. D02 tidak menggeser skor - tapi menggantungkan urutannya pada fakta
    # itu berarti menaruh bom waktu untuk hari seseorang memberi D02 bobot.
    if arg.tim_ai:
        print("Serah terima tim AI (syahh-coder/Loconomics-AI, hasilTrain)...")
        tim, mutu = baca_tim_ai()
        print(f"  heksagon di berkas   {len(tim)}")
        with sessionmaker(bind=_mesin())() as db:
            punya = pd.read_sql(
                "SELECT h3_index FROM hex_features", db.connection()
            )["h3_index"]
            irisan = tim.reindex(punya)
            print(f"  heksagon kita        {len(punya)}")
            print(f"  ketemu di berkas     {int(irisan['resolusi'].notna().sum())}")

            # 1. Yang NYATA - satu kolom, dan ia memang pengukuran.
            nyata = irisan[list(KOLOM_TIM_AI_NYATA)].copy()
            n = muat_variabel(db, nyata)
            for kol, kode in KOLOM_TIM_AI_NYATA.items():
                print(f"  {kode} {kol:<22} {int(nyata[kol].notna().sum())}/{len(punya)} terisi")

            # 2. Yang PERKIRAAN - ke tabelnya sendiri, berlabel dan bermutu.
            #
            # UJI SILANG TERHADAP UKURAN KITA, bukan cuma R2 yang mereka
            # laporkan. R2 0,62 dan MAE 2.864 itu diukur terhadap label yang
            # 96,9%-nya sintetis, jadi ia mengukur seberapa baik model menebak
            # formula yang membuatnya - bukan seberapa dekat ia ke kenyataan.
            # Yang kita punya justru pembanding yang tidak dilihat model:
            # pengamatan misi MAPID di heksagon kita sendiri. Angkanya ikut
            # disimpan supaya setiap tempat yang menampilkan perkiraan ini bisa
            # menyebut selisihnya, bukan cuma menyebut R2-nya.
            terukur = pd.read_sql(
                "SELECT h3_index, harga_median_porsi, skor_ramai_terkoreksi FROM hex_features",
                db.connection(),
            ).set_index("h3_index")
            uji: dict[str, dict] = {}
            for kol, kode in KOLOM_TIM_AI_PERKIRAAN.items():
                pas = terukur[kol].dropna()
                if pas.empty:
                    continue
                beda = (irisan.loc[pas.index, kol] - pas).abs()
                # MAPE hanya atas nilai terukur yang BUKAN nol. D10 sah bernilai
                # nol ("Sepi"), dan membaginya menghasilkan tak hingga - yang
                # bukan cuma mustahil ditulis ke JSON, tapi juga akan terbaca
                # sebagai "modelnya salah tak terhingga" alih-alih "pembaginya
                # nol".
                bukan_nol = pas[pas != 0]
                mape = (
                    round(float((beda[bukan_nol.index] / bukan_nol.abs()).mean() * 100), 1)
                    if not bukan_nol.empty
                    else None
                )
                uji[kode] = {
                    "n_uji_terukur": int(len(pas)),
                    "mae_vs_terukur": round(float(beda.mean()), 3),
                    "mape_vs_terukur": mape,
                    "n_mape": int(len(bukan_nol)),
                }
                print(f"    {kode}  vs ukuran ASLI: n={len(pas)} "
                      f"MAE {uji[kode]['mae_vs_terukur']:,.2f} "
                      f"MAPE {mape if mape is not None else '-'}% (n={len(bukan_nol)})")

            baris: list[dict] = []
            for kol, kode in KOLOM_TIM_AI_PERKIRAAN.items():
                m = mutu.get({"D10": "skor_ramai", "B07": "harga"}[kode], {})
                for h3, nilai in irisan[kol].items():
                    if pd.isna(nilai):
                        continue
                    baris.append({
                        "h3_index": h3,
                        "kode": kode,
                        "nilai": float(nilai),
                        "metode": "model_gbr",
                        # Berapa pengamatan SUNGGUHAN yang menyusunnya. 15, bukan
                        # 480: sisanya augmentasi sintetis, dan menuliskan 480 di
                        # kolom bernama n_sumber adalah cara paling rapi untuk
                        # membuat angka karangan terbaca sebagai survei.
                        "n_sumber": 15,
                        "radius_m": None,
                        "rincian": json.dumps({
                            "algoritma": "GradientBoostingRegressor",
                            "n_pohon": 100, "kedalaman": 3, "n_fitur": 14,
                            "r2": round(m.get("r2_rata", float("nan")), 3),
                            "mae": round(m.get("mae_rata", float("nan")), 3),
                            "n_label": 480,
                            "n_label_asli": 15,
                            "sumber_label": "Menu Go (15 titik) + augmentasi sintetis (~465)",
                            "keluaran_tim": irisan.loc[h3, "data_source"],
                            "dilatih": "2026-09-12",
                            **uji.get(kode, {}),
                        }, ensure_ascii=False),
                    })
            print(f"  perkiraan dimuat     {muat_perkiraan(db, baris)}")
            for kode in KOLOM_TIM_AI_PERKIRAAN.values():
                k = {"D10": "skor_ramai", "B07": "harga"}[kode]
                print(f"    {kode}  R2 {mutu[k]['r2_rata']:.3f}  MAE {mutu[k]['mae_rata']:.3f}")
            db.commit()
        print(f"  dilewati sengaja     {len(KOLOM_TIM_AI_DILEWATI)} kolom "
              "(definisi berbeda / kita lebih lengkap - lihat KOLOM_TIM_AI_DILEWATI)")
        print(f"  variabel diperbarui  {n}")

    # --- Blok -------------------------------------------------------------
    # Transaksinya SENDIRI dan berjalan sebelum yang lain: ia hanya membaca
    # daftar heksagon, dan menulis tabel yang tidak dibaca langkah lain mana pun.
    if arg.blok:
        print("Membangun blok di dalam heksagon...")
        if arg.kering:
            # Daftar heksagon diturunkan dari PUSAT, bukan dibaca dari basis
            # data - mode kering tidak menyentuh koneksi apa pun. Grid yang sama
            # diverifikasi identik dengan hex_features (s1_ingest._grid_pilot).
            import h3 as _h3

            from config import CINCIN_PILOT, H3_RESOLUSI, PUSAT

            peta: dict[str, str] = {}
            for nama, (la, lo) in PUSAT.items():
                for s in _h3.grid_disk(_h3.latlng_to_cell(la, lo, H3_RESOLUSI), CINCIN_PILOT):
                    peta.setdefault(s, nama)
            heksagon = pd.Series(peta)
        else:
            with sessionmaker(bind=_mesin())() as db:
                heksagon = pd.read_sql(
                    "SELECT h3_index, kawasan FROM hex_features", db.connection()
                ).set_index("h3_index")["kawasan"]
        blok = bangun_blok(heksagon)
        print(f"  blok           {len(blok)}")
        print(f"  punya menit    {int(blok['menit_jalan'].notna().sum())}")
        print(f"  jalan utama    {int(blok['jarak_jalan_utama_m'].notna().sum())}")
        print(f"  berzona RDTR   {int(blok['kelas_zona'].notna().sum())}")
        print(f"  dilarang zona  {int(blok['izin_komersial'].eq(False).sum())}")
        if arg.kering:
            tujuan = DATA_OLAHAN / "blok.json"
            tujuan.parent.mkdir(parents=True, exist_ok=True)
            tujuan.write_text(json.dumps(_baris_blok(blok), ensure_ascii=False), encoding="utf-8")
            print(f"  -> {tujuan} (basis data tidak disentuh)")
        else:
            with sessionmaker(bind=_mesin())() as db:
                print(f"  dimuat         {muat_blok(db, blok)}")
                db.commit()

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
            or arg.survei or arg.gapfill or arg.rdtr or arg.transit
            or arg.kosongkan or arg.hitung_ulang):
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
            if arg.gapfill:
                print("GapFill B07 - melatih dengan ground truth se-Jabodetabek...")
                for k, v in gapfill_luar(db, terapkan=arg.terapkan).items():
                    print(f"  {k:20} {v}")
            if arg.survei:
                print("Memuat hasil survei lapangan...")
                hasil = muat_survei(db)
                for k, v in hasil.items():
                    print(f"  {k:16} {v}")
                if hasil["asing"]:
                    print(f"  PERINGATAN: {hasil['asing']} h3_index tidak ada di grid, dilewati")
                if not hasil["heksagon"]:
                    print("  Berkasnya masih kosong - belum ada satu pun sel yang diisi.")
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
        # Satu bendera, bukan dua: berkas GeoJSON dan ringkasan cakupannya HARUS
        # menggambarkan basis data yang sama. Bendera terpisah membuat keduanya
        # bisa berselisih, dan yang basi justru kalimat yang dibaca juri.
        print(f"\nMenulis ringkasan cakupan ke {RINGKASAN_TS.name}...")
        for k, v in ekspor_ringkasan().items():
            print(f"  {k:20} {v}")

    if arg.cakupan:
        print(periksa_cakupan().to_string(index=False))
