"""Uji GapFill (s5_impute) - tanpa basis data, tanpa data lapangan.

Yang paling penting di berkas ini BUKAN "apakah modelnya akurat", melainkan dua
hal yang gagalnya DIAM:

  1. Penjaganya benar-benar menahan. Melatih Random Forest atas delapan baris
     lalu menyebarkannya ke 700 heksagon menghasilkan peta yang terlihat persis
     seperti data sungguhan. Tidak ada satu pun galat yang akan muncul.

  2. Nilai TERUKUR tidak pernah ditimpa prediksi. Kalau ini bocor, satu-satunya
     data survei yang benar-benar dimiliki tim akan tertutup oleh tebakan model
     atas data survei itu sendiri.

Data ujinya dibangkitkan, dan itu disengaja: yang diuji perilaku modul, bukan
kualitas data lapangan yang memang belum ada.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from s5_impute import (
    MIN_GROUND_TRUTH,
    MIN_KAWASAN,
    DataTidakCukup,
    HasilLatih,
    latih_model,
    laporan_kesiapan,
    prediksi_seluruh_heksagon,
    tandai_keyakinan,
)

lolos = gagal = 0


def cek(nama: str, syarat: bool, tambahan: str = "") -> None:
    global lolos, gagal
    if syarat:
        lolos += 1
        print(f"  PASS  {nama}")
    else:
        gagal += 1
        print(f"  GAGAL {nama} {tambahan}")


KAWASAN = ["Manggarai", "Tanah Abang", "Depok Baru", "Bekasi", "Dukuh Atas BNI", "Harjamukti"]


def contoh(n_per_kawasan: int = 20, kawasan: list[str] | None = None) -> pd.DataFrame:
    """Ground truth buatan yang hubungannya SUNGGUHAN ada, plus derau.

    Kalau hubungannya tidak ada, sebuah model yang benar HARUS gagal - dan uji
    yang menuntut R2 tinggi atas data acak justru akan menghukum implementasi
    yang jujur.
    """
    rng = np.random.default_rng(7)
    kawasan = kawasan or KAWASAN
    baris = []
    for i, kw in enumerate(kawasan):
        for _ in range(n_per_kawasan):
            poi = rng.uniform(0, 60)
            pop = rng.uniform(100, 4000)
            simpul = rng.uniform(0, 400)
            jarak = rng.uniform(50, 2500)
            baris.append({
                "kawasan": kw,
                "kepadatan_poi_total": poi,
                "pop_100m": pop,
                "skor_simpul": simpul,
                "jarak_simpul_m": jarak,
                "rasio_tutupan_bangunan": rng.uniform(0, 100),
                "luas_bangunan_median": rng.uniform(20, 300),
                "pangsa_waralaba": rng.uniform(0, 40),
                "kepadatan_kantor": rng.uniform(0, 30),
                "pop_usia_produktif": np.nan,   # dikosongkan 27 Agu 2026
                "njop_m2": np.nan,              # tidak punya sumber terbuka
                # Hubungan yang benar-benar ada, plus efek kawasan kecil.
                "skor_ramai_terkoreksi": (
                    0.02 * poi + 0.0004 * pop + 0.002 * simpul
                    - 0.0006 * jarak + 0.1 * i + rng.normal(0, 0.15)
                ),
                "harga_median_porsi": 15000 + 220 * poi + 3.0 * simpul + rng.normal(0, 2500),
            })
    return pd.DataFrame(baris)


# --- Penjaga ---------------------------------------------------------------


def test_menolak_ground_truth_tipis():
    """Keadaan basis data hari ini: 8 baris. Harus ditolak, bukan dilatih."""
    df = contoh(n_per_kawasan=2, kawasan=KAWASAN[:4])   # 8 baris
    try:
        latih_model(df, "skor_ramai_terkoreksi")
        cek("8 baris ditolak", False, "- justru dilatih")
    except DataTidakCukup as e:
        cek("8 baris ditolak", True)
        cek("pesannya menyebut angkanya", "8 baris" in str(e), f"- {e}")
        cek("pesannya menunjuk ke rencana survei", "bagian 11" in str(e))


def test_menolak_kawasan_terlalu_sedikit():
    """Spatial k-fold dengan dua kawasan mengukur kebetulan, bukan generalisasi."""
    df = contoh(n_per_kawasan=40, kawasan=KAWASAN[:2])   # 80 baris, 2 kawasan
    try:
        latih_model(df, "skor_ramai_terkoreksi")
        cek("2 kawasan ditolak", False, "- justru dilatih")
    except DataTidakCukup as e:
        cek("2 kawasan ditolak", True)
        cek("pesannya menyebut kawasan", "kawasan" in str(e))


def test_ambang_ditulis_sebagai_angka():
    """Ambang yang tersembunyi di dalam if adalah ambang yang tidak bisa dibantah."""
    cek("MIN_GROUND_TRUTH bisa dikutip", isinstance(MIN_GROUND_TRUTH, int) and MIN_GROUND_TRUTH > 0)
    cek("MIN_KAWASAN bisa dikutip", isinstance(MIN_KAWASAN, int) and MIN_KAWASAN >= 3)


# --- Model -----------------------------------------------------------------


def test_melatih_saat_datanya_cukup():
    h = latih_model(contoh(), "skor_ramai_terkoreksi")
    cek("mengembalikan HasilLatih", isinstance(h, HasilLatih))
    cek("melatih seluruh baris", h.n_latih == 120, f"- {h.n_latih}")
    cek("memakai keenam kawasan", len(h.kawasan) == 6, f"- {h.kawasan}")
    cek("prediktor kosong dibuang", "njop_m2" not in h.fitur and "pop_usia_produktif" not in h.fitur)
    cek("delapan prediktor terpakai", len(h.fitur) == 8, f"- {len(h.fitur)}")


def test_mutu_dilaporkan_apa_adanya():
    h = latih_model(contoh(), "skor_ramai_terkoreksi")
    cek("R2 dilaporkan", isinstance(h.r2, float))
    cek("MAE dilaporkan", h.mae > 0)
    cek("pembanding 'menebak rata-rata' ikut", h.baseline_mae > 0)
    cek("mengalahkan tebakan rata-rata", h.lebih_baik_dari_menebak,
        f"- MAE {h.mae:.4f} vs {h.baseline_mae:.4f}")
    cek("ringkasannya menyebut keduanya", "MAE" in h.ringkas() and "R2" in h.ringkas())


def test_validasi_per_kawasan_bukan_acak():
    """Kalau pembagiannya acak, R2 melompat naik karena model menghafal kawasan.

    Yang diuji di sini bukan angkanya melainkan bahwa lipatannya memang menahan
    SATU KAWASAN PENUH: dengan efek kawasan yang disuntikkan di `contoh()`,
    model yang diuji di kawasan tak dikenal tidak akan pernah sempurna.
    """
    h = latih_model(contoh(), "skor_ramai_terkoreksi")
    cek("R2 tidak mustahil-sempurna", h.r2 < 0.999, f"- {h.r2}")


def test_fitur_penting_bisa_ditelusuri():
    h = latih_model(contoh(), "skor_ramai_terkoreksi")
    cek("pentingnya fitur dilaporkan", len(h.pentingnya) == len(h.fitur))
    cek("jumlahnya ~1", abs(sum(h.pentingnya.values()) - 1.0) < 0.01)
    teratas = next(iter(h.pentingnya))
    cek("prediktor terkuat masuk akal",
        teratas in ("kepadatan_poi_total", "pop_100m", "jarak_simpul_m", "skor_simpul"),
        f"- {teratas}")


# --- Penerapan -------------------------------------------------------------


def test_prediksi_tidak_pernah_menimpa_yang_terukur():
    """Kalau ini bocor, satu-satunya data survei yang ada akan tertutup tebakan."""
    df = contoh()
    h = latih_model(df, "skor_ramai_terkoreksi")

    semua = df.copy()
    semua.loc[semua.index[:100], "skor_ramai_terkoreksi"] = np.nan   # 20 tersisa terukur
    keluar = prediksi_seluruh_heksagon(h, semua)

    terukur = semua["skor_ramai_terkoreksi"].notna()
    cek("nilai terukur tidak berubah",
        np.allclose(keluar.loc[terukur, "skor_ramai_terkoreksi"],
                    semua.loc[terukur, "skor_ramai_terkoreksi"]))
    cek("yang terukur bertanda observed",
        (keluar.loc[terukur, "skor_ramai_terkoreksi__sumber"] == "observed").all())
    cek("yang kosong bertanda predicted",
        (keluar.loc[~terukur, "skor_ramai_terkoreksi__sumber"] == "predicted").all())
    cek("seluruh heksagon terisi", keluar["skor_ramai_terkoreksi"].notna().all())


def test_prediksi_membawa_ketidakpastian():
    df = contoh()
    h = latih_model(df, "skor_ramai_terkoreksi")
    kosong = df.copy()
    kosong["skor_ramai_terkoreksi"] = np.nan
    keluar = prediksi_seluruh_heksagon(h, kosong)
    seb = keluar["skor_ramai_terkoreksi__sebaran"]
    cek("sebaran antar-pohon ikut", seb.notna().all())
    cek("sebarannya tidak nol", (seb > 0).all(), "- pohon-pohonnya sepakat sempurna?")


def test_prediksi_menuntut_model():
    h = latih_model(contoh(), "skor_ramai_terkoreksi")
    telanjang = HasilLatih(h.target, h.n_latih, h.kawasan, h.fitur, h.r2, h.mae,
                           h.baseline_mae, h.pentingnya, model=None)
    try:
        prediksi_seluruh_heksagon(telanjang, contoh())
        cek("tanpa model ditolak", False)
    except ValueError:
        cek("tanpa model ditolak", True)


# --- Badge -----------------------------------------------------------------


def test_badge_keyakinan_tetap_jujur():
    """Nol titik misi tidak pernah boleh jadi 'observed' - jebakan yang sudah kena."""
    tingkat, sumber = tandai_keyakinan(0)
    cek("nol titik -> predicted", sumber == "predicted", f"- {sumber}")
    cek("nol titik -> RENDAH", tingkat == "RENDAH", f"- {tingkat}")
    cek("satu titik -> observed", tandai_keyakinan(1)[1] == "observed")


def test_laporan_kesiapan_terbaca():
    lap = laporan_kesiapan(contoh(n_per_kawasan=2, kawasan=KAWASAN[:4]))
    cek("melaporkan BELUM saat tipis", "BELUM" in lap)
    lap2 = laporan_kesiapan(contoh())
    cek("melaporkan SIAP saat cukup", "SIAP" in lap2)
    cek("menyebut ambangnya", "Ambang" in lap2)


# ---------------------------------------------------------------------------
# Ground truth dari LUAR grid
#
# Yang diuji di sini bukan "apakah modelnya bagus", melainkan tiga cara bahan
# latihnya bisa tercemar tanpa memunculkan satu pun galat.
# ---------------------------------------------------------------------------


def _misi(baris):
    """Berkas misi tiruan berbentuk sama dengan keluaran s1_ingest --misi."""
    import json
    import tempfile
    from pathlib import Path as _P

    f = _P(tempfile.mkdtemp()) / "mapid_misi.json"
    f.write_text(json.dumps({"menugo": baris}), encoding="utf-8")
    return f


def _titik(lat, lon, harga):
    return {
        "geometry": {"coordinates": [lon, lat]},
        "properties": {"harga_rata_rata": harga},
    }


def test_harga_di_luar_rentang_dibuang_bukan_dikalikan():
    """Empat nilai Menu Go sungguhan ada di bawah Rp1.000 (5, 17, 20, 40).

    Menebak bahwa penulisnya bermaksud ribuan lalu mengalikan seribu sama saja
    dengan mengarang label - dan label karangan merusak model lebih dalam
    daripada label yang hilang, karena ia ikut dipelajari.
    """
    from s1_ingest import sel_berlabel_luar_grid

    # Bandung: jauh di luar grid Jabodetabek mana pun.
    f = _misi([_titik(-6.9147, 107.6098, 20), _titik(-6.9150, 107.6100, 18_000)])
    sel = sel_berlabel_luar_grid(f)
    nilai = [v for daftar in sel.values() for v in daftar]
    cek("harga Rp20 dibuang", 20.0 not in nilai, f"- {nilai}")
    cek("harga Rp18.000 tetap", 18_000.0 in nilai, f"- {nilai}")


def test_harga_terlalu_besar_juga_dibuang():
    from s1_ingest import sel_berlabel_luar_grid

    f = _misi([_titik(-6.9147, 107.6098, 5_000_000)])
    cek("Rp5 juta per porsi dibuang", sel_berlabel_luar_grid(f) == {})


def test_heksagon_di_dalam_grid_tidak_ikut():
    """Kalau ikut, ia terhitung dua kali - sekali sebagai bahan latih dan
    sekali lagi sebagai baris yang diprediksi, dan R2-nya jadi optimistis."""
    from config import PUSAT
    from s1_ingest import sel_berlabel_luar_grid

    lat, lon = PUSAT["Manggarai"]
    f = _misi([_titik(lat, lon, 15_000), _titik(-6.9147, 107.6098, 15_000)])
    sel = sel_berlabel_luar_grid(f)
    cek("titik di pusat kawasan pilot tidak ikut", len(sel) == 1, f"- {len(sel)}")


def test_daftar_tag_poi_satu_sumber():
    """Dua penarik memakai TAG_POI yang sama. Kalau salah satunya menyalin
    daftarnya, model dilatih pada fitur yang tidak sebanding dengan yang
    diprediksinya - dan itu tidak pernah muncul sebagai galat."""
    import inspect

    import s1_ingest as m

    cek("TAG_POI konstanta modul", isinstance(m.TAG_POI, list) and len(m.TAG_POI) > 5)
    for fn in (m.tarik_osm_poi, m.tarik_poi_luar):
        sumber = inspect.getsource(fn)
        cek(f"{fn.__name__} memakai TAG_POI", "TAG_POI" in sumber)
        cek(f"{fn.__name__} tidak menyalin daftar tag", 'node["shop"]' not in sumber)


if __name__ == "__main__":
    for nama, fn in sorted(globals().items()):
        if nama.startswith("test_"):
            print(f"\n{nama}")
            fn()
    print(f"\n{lolos} lolos, {gagal} gagal")
    raise SystemExit(1 if gagal else 0)
