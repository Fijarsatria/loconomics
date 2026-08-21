"""Data demo sintetis untuk keenam kawasan pilot.

KENAPA INI ADA. Data survei lapangan belum masuk, sementara antarmuka perlu
diuji dan didemokan sekarang. Tanpa isi, seluruh layar hanya menampilkan keadaan
kosong, dan tidak ada yang bisa menilai apakah petanya terbaca.

KENAPA BUKAN DATA PALSU YANG DITEMPEL. Angka di sini tidak ditulis tangan lalu
dimasukkan ke basis data. Ia dibangkitkan sebagai VARIABEL MENTAH, lalu melewati
mesin skoring yang sama persis dengan yang akan memproses data sungguhan:

    variabel sintetis -> s4_spatial.profil_jam / harga_sewa_per_m2
                      -> s6_score.skor_lengkap
                      -> s7_publish.muat_*

Artinya yang diuji bukan cuma tampilannya, melainkan seluruh rantai pipeline ke
basis data. Kalau rumusnya salah, itu akan terlihat di peta.

    cd pipeline && python demo_seed.py --isi
    cd pipeline && python demo_seed.py --hapus

SELURUH BARIS DITANDAI. `data_source` sebagian besar berisi `predicted`, dan
antarmuka menggambar heksagon `predicted` dengan arsir. Jadi begitu dibuka, layar
sendiri yang mengatakan sebagian besar isinya belum terukur - tanpa perlu ada
yang mengingatkan. Itu memang perilaku yang diinginkan, bukan kebetulan.
"""

from __future__ import annotations

import argparse
import math

import h3
import numpy as np
import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from config import H3_RESOLUSI, JAM_OPERASIONAL, KAWASAN_PILOT
from s4_spatial import belanja_per_jam, harga_sewa_per_m2, profil_jam
from s6_score import skor_lengkap
from s7_publish import _mesin, muat_profil_jam, muat_skor

# Pusat tiap kawasan, sama dengan yang dipakai frontend.
PUSAT = {
    "Manggarai": (-6.2131, 106.8496),
    "Tanah Abang": (-6.1858, 106.8117),
    "Depok Baru": (-6.3906, 106.8194),
    "Bekasi": (-6.2356, 106.9971),
    "Dukuh Atas BNI": (-6.2005, 106.8228),
    "Harjamukti": (-6.3706, 106.8556),
}

# Simpul transit sungguhan: nama, moda, dan koordinatnya BUKAN karangan.
# Isochrone-nya sengaja TIDAK dibangkitkan - poligon jangkauan jalan kaki menuntut
# routing atas jaringan jalan, dan menggambar lingkaran lalu menyebutnya isochrone
# akan persis melakukan kesalahan yang docs/data.md peringatkan: mengasumsikan
# orang bisa berjalan menembus tembok, sungai, dan rel.
SIMPUL = {
    "Manggarai": ("Stasiun Manggarai", "KRL", 8, 130_000),
    "Tanah Abang": ("Stasiun Tanah Abang", "KRL", 6, 95_000),
    "Depok Baru": ("Stasiun Depok Baru", "KRL", 4, 42_000),
    "Bekasi": ("Stasiun Bekasi", "KRL", 4, 38_000),
    "Dukuh Atas BNI": ("MRT Dukuh Atas BNI", "MRT", 2, 31_000),
    "Harjamukti": ("LRT Harjamukti", "LRT", 2, 9_000),
}

# Cincin ke-6 dari pusat: sekitar 127 heksagon per kawasan, radius ±2 km.
# Cukup untuk peta yang terasa berisi, cukup kecil untuk dimuat seketika.
CINCIN = 6

# Karakter tiap kawasan. Angka-angka ini yang membuat keenamnya tidak terlihat
# sama, dan dipilih supaya kuadrannya jatuh sesuai dugaan di PRD: Dukuh Atas
# semestinya penuh Jebakan Gengsi, Harjamukti semestinya penuh Hidden Gem.
# Kalau setelah dijalankan hasilnya TIDAK begitu, itu temuan tentang rumusnya,
# bukan tentang datanya.
KARAKTER = {
    "Manggarai": dict(prestise=0.45, sewa=170_000, ramai=0.80, churn=0.30, rdtr=0.9),
    "Tanah Abang": dict(prestise=0.50, sewa=220_000, ramai=0.95, churn=0.55, rdtr=0.9),
    "Depok Baru": dict(prestise=0.30, sewa=95_000, ramai=0.65, churn=0.25, rdtr=0.6),
    "Bekasi": dict(prestise=0.35, sewa=110_000, ramai=0.60, churn=0.30, rdtr=0.7),
    "Dukuh Atas BNI": dict(prestise=0.88, sewa=430_000, ramai=0.70, churn=0.60, rdtr=1.0),
    "Harjamukti": dict(prestise=0.22, sewa=70_000, ramai=0.45, churn=0.18, rdtr=0.35),
}


def _sel_per_kawasan() -> dict[str, list[str]]:
    """Bagi heksagon ke kawasan, satu heksagon tepat satu kawasan.

    Cincin Manggarai dan Dukuh Atas BNI bertumpang tindih - keduanya hanya
    berjarak sekitar 2,5 km, sedangkan radius cincin ini ±2 km. Membiarkannya
    berarti ada heksagon yang muncul dua kali dengan kawasan berbeda, dan tabel
    hex_features berkunci utama h3_index tidak akan menerimanya.

    Yang menang adalah pusat terdekat. Itu juga definisi yang benar di luar data
    demo: sebuah lokasi melayani stasiun yang paling dekat dengannya.
    """
    klaim: dict[str, tuple[str, float]] = {}
    for kawasan, (lat0, lon0) in PUSAT.items():
        pusat = h3.latlng_to_cell(lat0, lon0, H3_RESOLUSI)
        for s in h3.grid_disk(pusat, CINCIN):
            lat, lon = h3.cell_to_latlng(s)
            jarak = math.hypot(lat - lat0, lon - lon0)
            sudah = klaim.get(s)
            if sudah is None or jarak < sudah[1]:
                klaim[s] = (kawasan, jarak)

    hasil: dict[str, list[str]] = {k: [] for k in PUSAT}
    for s, (kawasan, _) in klaim.items():
        hasil[kawasan].append(s)
    return {k: sorted(v) for k, v in hasil.items()}


def _wkt(sel: str) -> str:
    """Batas heksagon sebagai WKT. h3 mengembalikan (lat, lng); PostGIS mau (lng, lat)."""
    titik = h3.cell_to_boundary(sel)
    cincin = ", ".join(f"{lng} {lat}" for lat, lng in titik)
    lat0, lng0 = titik[0]
    return f"SRID=4326;POLYGON(({cincin}, {lng0} {lat0}))"


def bangkitkan(seed: int = 2026) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Bangkitkan variabel mentah, struk, dan properti untuk keenam kawasan.

    Satu gagasan mengatur hampir seluruh angkanya: jarak ke pusat. Makin dekat
    simpul transit, makin tinggi potensi dan makin mahal biayanya. Itu memberi
    peta gradien yang terbaca alih-alih taburan acak, dan gradien itulah yang
    membuat mata bisa menilai apakah pewarnaannya bekerja.
    """
    rng = np.random.default_rng(seed)
    baris, struk, properti = [], [], []
    per_kawasan = _sel_per_kawasan()

    for kawasan, kar in KARAKTER.items():
        lat0, lon0 = PUSAT[kawasan]

        for s in per_kawasan[kawasan]:
            lat, lon = h3.cell_to_latlng(s)
            # Jarak dinormalkan 0 (pusat) sampai ~1 (tepi cincin).
            d = math.hypot(lat - lat0, lon - lon0) / 0.022
            dekat = max(0.0, 1 - d)  # 1 di pusat, 0 di tepi
            derau = lambda k=0.12: float(rng.normal(0, k))  # noqa: E731

            prestise = np.clip(kar["prestise"] * (0.55 + 0.75 * dekat) + derau(0.09), 0.03, 1)
            ramai = np.clip(kar["ramai"] * (0.4 + 0.85 * dekat) + derau(), 0.02, 1)
            sewa_m2 = max(25_000, kar["sewa"] * (0.5 + 1.1 * dekat) * (1 + derau(0.18)))

            # Sebagian kecil heksagon berzona terlarang, sebagian belum ber-RDTR.
            u = rng.random()
            zona = (
                False if u < 0.05
                else None if u > kar["rdtr"]
                else True
            )

            n_misi = int(max(0, rng.normal(26 * dekat + 4, 9)))
            observed = n_misi >= 10

            baris.append(
                {
                    "h3_index": s,
                    "kawasan": kawasan,
                    "geom": _wkt(s),
                    # Permintaan
                    "pop_100m": max(0, rng.normal(2600 * (0.5 + dekat), 700)),
                    "pop_usia_produktif": max(0, rng.normal(1700 * (0.5 + dekat), 480)),
                    "jarak_simpul_m": d * 2100,
                    "waktu_jalan_menit": np.clip(d * 26 + rng.normal(0, 2), 1, 40),
                    "skor_simpul": np.clip(dekat * 0.95 + derau(0.07), 0.02, 1),
                    "ridership_proksi": max(0, rng.normal(42_000 * dekat + 3_000, 9_000)),
                    "kepadatan_kos": max(0, rng.normal(60 * (1.25 - prestise), 18)),
                    "kepadatan_kantor": max(0, rng.normal(70 * prestise, 20)),
                    "generator_keramaian": max(0, rng.normal(9 * dekat + 1, 3)),
                    "skor_ramai_terkoreksi": ramai,
                    "intensitas_transaksi": np.clip(ramai * 0.9 + derau(0.1), 0.02, 1),
                    "aktivitas_komunitas": np.clip(rng.random() * 0.7 + 0.1, 0, 1),
                    # Perilaku
                    "puncak_pagi": 0.30, "puncak_siang": 0.20,
                    "puncak_sore": 0.34, "puncak_malam": 0.16,
                    "rasio_weekend": np.clip(rng.normal(0.75, 0.16), 0.2, 1.6),
                    "pangsa_digital": np.clip(prestise * 0.85 + derau(0.11), 0.02, 0.97),
                    "harga_median_porsi": max(6_000, rng.normal(13_000 + 26_000 * prestise, 3_600)),
                    "spread_harga": np.clip(rng.normal(0.85, 0.28), 0.15, 2.2),
                    "nominal_median_struk": max(7_000, rng.normal(22_000 + 62_000 * prestise, 8_500)),
                    # Kompetisi
                    "n_kompetitor_langsung": max(0, rng.normal(11 * dekat + 1, 3.5)),
                    "kepadatan_poi_total": max(0, rng.normal(52 * dekat + 6, 14)),
                    "keragaman_usaha": np.clip(rng.normal(0.62, 0.15), 0.05, 1),
                    "keragaman_kuliner": np.clip(rng.normal(0.55, 0.16), 0.05, 1),
                    "pangsa_waralaba": np.clip(prestise * 0.72 + derau(0.1), 0, 0.95),
                    "rasio_kompetitor_per_kapita": np.clip(rng.normal(0.0045, 0.0018), 0, 0.02),
                    # Pedagang keliling lebih banyak di kawasan berprestise rendah -
                    # inilah yang membuat IPTT menyala di tempat yang benar.
                    "rasio_keliling": np.clip((1 - prestise) * 0.62 + derau(0.11), 0.02, 0.95),
                    "n_menetap_kuliner": max(0, rng.normal(9 * prestise + 2, 3)),
                    # Biaya
                    "njop_m2": max(1_200_000, rng.normal(5_200_000 + 27_000_000 * prestise, 2_400_000)),
                    "njop_persentil": float(np.clip(prestise * 100 + rng.normal(0, 8), 1, 99)),
                    "pasokan_sewa_komersial": max(0, rng.normal(15 * dekat + 2, 5)),
                    "rasio_sewa_jual": np.clip(rng.normal(0.075, 0.02), 0.02, 0.2),
                    "indeks_churn": np.clip(kar["churn"] * (0.6 + 0.9 * rng.random()) + derau(0.07), 0.01, 0.98),
                    # Risiko
                    "zona_izin_komersial": zona,
                    "kelas_zona": None if zona is None else ("K-1" if zona else "R-3"),
                    "risiko_banjir": np.clip(rng.normal(0.34, 0.2), 0, 1),
                    # Morfologi
                    "rasio_tutupan_bangunan": np.clip(rng.normal(0.42 + 0.3 * dekat, 0.11), 0.03, 0.95),
                    "luas_bangunan_median": max(24, rng.normal(70 + 260 * prestise, 45)),
                    "skor_prestise_visual": float(np.clip(1 + prestise * 4 + rng.normal(0, 0.4), 1, 5)),
                    # Penanda kualitas
                    "n_titik_misi": n_misi,
                    "tingkat_keyakinan": "TINGGI" if n_misi >= 30 else "SEDANG" if n_misi >= 10 else "RENDAH",
                    "data_source": "observed" if observed else "predicted",
                }
            )

            # Struk: hanya untuk heksagon yang benar-benar "disurvei". Sisanya
            # sengaja dibiarkan tanpa profil jam, supaya keadaan kosong ikut teruji.
            if observed:
                for jam in JAM_OPERASIONAL:
                    puncak = 1.0 if jam in (7, 8, 17, 18) else 0.42 if 11 <= jam <= 14 else 0.2
                    n = int(max(0, rng.poisson(14 * puncak * ramai)))
                    for _ in range(n):
                        struk.append(
                            {
                                "h3_index": s,
                                "jam": jam,
                                "total_nominal": float(max(5_000, rng.normal(24_000 + 60_000 * prestise, 12_000))),
                            }
                        )

                for _ in range(int(rng.integers(1, 5))):
                    luas = float(max(12, rng.normal(46 + 70 * prestise, 20)))
                    tahunan = rng.random() < 0.4
                    bulanan = sewa_m2 * luas * (1 + derau(0.1))
                    properti.append(
                        {
                            "h3_index": s,
                            "harga_nominal": bulanan * 12 if tahunan else bulanan,
                            "periode": "tahun" if tahunan else "bulan",
                            "luas_m2": luas,
                        }
                    )

    return (
        pd.DataFrame(baris).set_index("h3_index"),
        pd.DataFrame(struk),
        pd.DataFrame(properti),
    )


def isi(seed: int = 2026) -> dict[str, int]:
    hex_df, struk, prop = bangkitkan(seed)
    print(f"  dibangkitkan  {len(hex_df)} heksagon, {len(struk)} struk, {len(prop)} properti")

    # Lewati rantai pipeline yang sungguhan, bukan menulis angka jadi.
    profil = profil_jam(struk, hex_df)
    hex_df["belanja_per_jam"] = belanja_per_jam(profil)
    hex_df["harga_sewa_per_m2"] = harga_sewa_per_m2(prop)
    hex_df["harga_sewa_median"] = hex_df["harga_sewa_per_m2"] * hex_df["luas_bangunan_median"] * 0.55

    skor = skor_lengkap(hex_df)
    print(f"  skor dihitung  {skor['opportunity_score'].notna().sum()} heksagon")
    print("  sebaran kuadran:")
    for k, n in skor["kuadran"].value_counts().items():
        print(f"      {k:<16} {n}")

    kolom_hex = [
        "kawasan", "geom", "n_titik_misi", "tingkat_keyakinan", "data_source",
        *[c for c in hex_df.columns if c not in ("kawasan", "geom", "n_titik_misi",
                                                 "tingkat_keyakinan", "data_source")],
    ]

    Sesi = sessionmaker(bind=_mesin())
    with Sesi() as db:
        db.execute(text("DELETE FROM transport_nodes"))
        for kawasan, (nama, moda, jalur, ridership) in SIMPUL.items():
            lat, lon = PUSAT[kawasan]
            db.execute(
                text(
                    "INSERT INTO transport_nodes (nama, moda, kawasan, jumlah_jalur, "
                    "ridership_harian, geom) VALUES (:nama, :moda, :kawasan, :jalur, "
                    ":ridership, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))"
                ),
                {"nama": nama, "moda": moda, "kawasan": kawasan, "jalur": jalur,
                 "ridership": ridership, "lon": lon, "lat": lat},
            )

        db.execute(text("DELETE FROM hex_features"))
        sisip = text(
            "INSERT INTO hex_features (h3_index, "
            + ", ".join(kolom_hex)
            + ") VALUES (:h3_index, "
            + ", ".join(f":{c}" for c in kolom_hex)
            + ")"
        )
        muat = [
            {"h3_index": h3i, **{c: (None if pd.isna(v) else v.item() if hasattr(v, "item") else v)
                                 for c, v in r.items() if c in kolom_hex}}
            for h3i, r in hex_df.to_dict(orient="index").items()
        ]
        for i in range(0, len(muat), 200):
            db.execute(sisip, muat[i : i + 200])

        n_profil = muat_profil_jam(db, profil)
        n_skor = muat_skor(db, skor, "baseline")
        db.commit()

    return {"simpul": len(SIMPUL), "heksagon": len(muat), "profil_jam": n_profil, "skor": n_skor}


def hapus() -> int:
    Sesi = sessionmaker(bind=_mesin())
    with Sesi() as db:
        n = db.execute(text("SELECT COUNT(*) FROM hex_features")).scalar_one()
        # ON DELETE CASCADE mengurus location_scores, score_factors, dan
        # hex_hourly_profiles sekaligus.
        db.execute(text("DELETE FROM hex_features"))
        db.execute(text("DELETE FROM transport_nodes"))
        db.commit()
    return n


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Data demo sintetis")
    p.add_argument("--isi", action="store_true")
    p.add_argument("--hapus", action="store_true")
    p.add_argument("--seed", type=int, default=2026)
    a = p.parse_args()

    if a.hapus:
        print(f"Dihapus {hapus()} heksagon beserta seluruh turunannya.")
    elif a.isi:
        print(f"Membangkitkan data demo untuk {len(KAWASAN_PILOT)} kawasan...")
        for k, v in isi(a.seed).items():
            print(f"  dimuat  {k:<12} {v} baris")
        print("\nKosongkan cache backend: curl -X POST http://localhost:8000/meta/cache/bersihkan")
    else:
        p.print_help()
