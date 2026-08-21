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

from config import DATA_OLAHAN, KAWASAN_PILOT, KODE_KE_KOLOM, ROOT

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
    p.add_argument("--muat", action="store_true", help="DataFrame -> basis data")
    p.add_argument("--ekspor", action="store_true", help="Basis data -> GeoJSON statis")
    p.add_argument("--cakupan", action="store_true", help="Tampilkan cakupan data")
    p.add_argument("--versi", default="baseline")
    arg = p.parse_args()

    if not any([arg.muat, arg.ekspor, arg.cakupan]):
        p.print_help()
        raise SystemExit(0)

    if arg.muat:
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
