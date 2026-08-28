"""Uji rantai spasial: Commuter Clock, PriceLens, D04, dan Kompetisi.

Tidak butuh basis data, jaringan, maupun data lapangan:

    cd pipeline && python test_s4_spatial.py
    atau:  python -m pytest test_s4_spatial.py -v

Ikut menguji `s2_clean.poi_dari_osm` dan `s2_clean.simpul_dari_osm` walau
keduanya tinggal di s2, bukan di s4. Alasannya bukan kemalasan: keduanya
satu-satunya pintu masuk data OSM ke variabel Kompetisi yang diuji di berkas
ini, dan menguji agregatnya tanpa menguji penguraiannya berarti separuh rantai
yang menghasilkan angka di layar tidak pernah diperiksa sama sekali.
"""

import numpy as np
import pandas as pd

import h3

from config import JAM_OPERASIONAL, KELAS_INDUK
from s2_clean import (
    bangunan_dari_osm,
    henti_dari_osm,
    konteks_dari_osm,
    luas_poligon_m2,
    menu_dari_mapid,
    parse_tanggal_misi,
    poi_dari_osm,
    properti_dari_mapid,
    rute_dari_osm,
    simpul_dari_osm,
    struk_dari_mapid,
)
from s4_spatial import (
    CAPTIVE_MAKS,
    CAPTIVE_MIN,
    MIN_CUISINE_BERTAG,
    MIN_STRUK_OBSERVED,
    belanja_per_jam,
    bobot_simpul,
    dimensi_kompetisi,
    harga_sewa_per_m2,
    kelas_dominan,
    kepadatan_poi_total,
    keragaman_kuliner,
    keragaman_usaha,
    dimensi_konteks,
    dimensi_lahan,
    dimensi_misi,
    konteks_captive,
    morfologi_bangunan,
    n_kompetitor_langsung,
    penduduk_per_heksagon,
    simpul_terdekat_dari_rute,
    pangsa_waralaba,
    profil_jam,
    rasio_kompetitor_per_kapita,
    waktu_jalan_dari_rute,
)

HEX = ["89hex00001", "89hex00002", "89hex00003"]


def contoh_hex() -> pd.DataFrame:
    """Tiga heksagon dengan konteks yang sengaja berlawanan."""
    return pd.DataFrame(
        {
            # hex 1: banyak kos, sedikit kantor, NJOP rendah  -> condong captive
            # hex 3: sedikit kos, banyak kantor, NJOP tinggi  -> condong choice
            "kepadatan_kos": [90.0, 40.0, 5.0],
            "kepadatan_kantor": [5.0, 40.0, 95.0],
            "njop_persentil": [10.0, 50.0, 95.0],
            "pangsa_digital": [0.1, 0.5, 0.9],
        },
        index=HEX,
    )


def contoh_struk(seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    baris = []
    for h in HEX:
        for jam in JAM_OPERASIONAL:
            n = 8 if jam in (7, 17) else 4  # ada puncak supaya jam_puncak bermakna
            for _ in range(n):
                baris.append(
                    {"h3_index": h, "jam": jam, "total_nominal": float(rng.integers(5_000, 80_000))}
                )
    return pd.DataFrame(baris)


# --- konteks captive -------------------------------------------------------


def test_konteks_captive_rentang():
    k = konteks_captive(contoh_hex())
    assert k.between(0, 1).all(), "konteks captive harus di [0,1]"


def test_konteks_captive_arah():
    """Banyak kos + sedikit kantor + NJOP rendah harus lebih captive."""
    k = konteks_captive(contoh_hex())
    assert k[HEX[0]] > k[HEX[2]], "heksagon kos harus lebih captive daripada heksagon kantor"


# --- profil jam ------------------------------------------------------------


def test_profil_jam_bentuk():
    p = profil_jam(contoh_struk(), contoh_hex())
    assert set(p.columns) == {
        "h3_index", "jam", "n_transaksi", "nominal_total",
        "nominal_median", "pangsa_captive", "metode",
    }
    assert p["jam"].isin(JAM_OPERASIONAL).all(), "ada jam di luar 05-22"


def test_profil_jam_tidak_pernah_pasti():
    """Pangsa captive tidak pernah 0 atau 1 - tidak ada proksi yang sepasti itu."""
    p = profil_jam(contoh_struk(), contoh_hex())
    assert p["pangsa_captive"].between(CAPTIVE_MIN, CAPTIVE_MAKS).all()


def test_profil_jam_puncak_lebih_captive():
    """Jam jendela komuter harus lebih captive daripada tengah hari, di heksagon yang sama."""
    p = profil_jam(contoh_struk(), contoh_hex()).set_index(["h3_index", "jam"])
    for h in HEX:
        assert p.loc[(h, 7), "pangsa_captive"] > p.loc[(h, 13), "pangsa_captive"]


def test_profil_jam_menandai_proxy():
    """Jam dengan sedikit struk ditandai proxy, bukan diam-diam disebut observed."""
    struk = pd.DataFrame(
        [{"h3_index": HEX[0], "jam": 7, "total_nominal": 20_000}]  # cuma 1 struk
    )
    p = profil_jam(struk, contoh_hex())
    assert p.iloc[0]["metode"] == "proxy"
    assert MIN_STRUK_OBSERVED > 1


def test_profil_jam_struk_kosong():
    p = profil_jam(pd.DataFrame(columns=["h3_index", "jam", "total_nominal"]), contoh_hex())
    assert p.empty and "pangsa_captive" in p.columns


def test_profil_jam_buang_di_luar_rentang():
    struk = pd.DataFrame(
        [
            {"h3_index": HEX[0], "jam": 3, "total_nominal": 10_000},  # 03:00, di luar
            {"h3_index": HEX[0], "jam": 10, "total_nominal": 10_000},
        ]
    )
    p = profil_jam(struk, contoh_hex())
    assert list(p["jam"]) == [10]


# --- B10 belanja per jam ---------------------------------------------------


def test_belanja_per_jam_pembagi_jam_berisi():
    """Pembaginya jumlah jam berisi, bukan 18."""
    struk = pd.DataFrame(
        [
            {"h3_index": HEX[0], "jam": 7, "total_nominal": 100_000},
            {"h3_index": HEX[0], "jam": 8, "total_nominal": 300_000},
        ]
    )
    b = belanja_per_jam(profil_jam(struk, contoh_hex()))
    assert b[HEX[0]] == 200_000, f"harusnya 400rb / 2 jam, dapat {b[HEX[0]]}"


# --- P07 harga sewa per m2 -------------------------------------------------


def test_harga_per_m2_tahunan_dibagi_dua_belas():
    prop = pd.DataFrame(
        [
            {"h3_index": HEX[0], "harga_nominal": 120_000_000, "periode": "tahun", "luas_m2": 100.0},
            {"h3_index": HEX[1], "harga_nominal": 10_000_000, "periode": "bulan", "luas_m2": 100.0},
        ]
    )
    h = harga_sewa_per_m2(prop)
    assert h[HEX[0]] == 100_000, "120jt/tahun / 12 / 100 m2 = 100rb"
    assert h[HEX[1]] == 100_000, "10jt/bulan / 100 m2 = 100rb"


def test_harga_per_m2_buang_periode_tidak_jelas():
    """Aturan 9.6 - periode tidak jelas dibuang, tidak ditebak."""
    prop = pd.DataFrame(
        [
            {"h3_index": HEX[0], "harga_nominal": 45_000_000, "periode": "tidak_disebut", "luas_m2": 60.0},
            {"h3_index": HEX[0], "harga_nominal": 6_000_000, "periode": "bulan", "luas_m2": 60.0},
        ]
    )
    h = harga_sewa_per_m2(prop)
    assert h[HEX[0]] == 100_000, "record 'tidak_disebut' seharusnya tidak ikut"


def test_harga_per_m2_median_dari_rasio():
    """Median dari rasio, BUKAN rasio dari median.

    Dua properti: 10jt/100m2 = 100rb/m2, dan 3jt/10m2 = 300rb/m2.
    Median rasio  = 200rb.  Rasio median = 6,5jt / 55m2 = 118rb - salah.
    """
    prop = pd.DataFrame(
        [
            {"h3_index": HEX[0], "harga_nominal": 10_000_000, "periode": "bulan", "luas_m2": 100.0},
            {"h3_index": HEX[0], "harga_nominal": 3_000_000, "periode": "bulan", "luas_m2": 10.0},
        ]
    )
    assert harga_sewa_per_m2(prop)[HEX[0]] == 200_000


def test_harga_per_m2_luas_nol_tidak_bikin_pembagian_nol():
    prop = pd.DataFrame(
        [
            {"h3_index": HEX[0], "harga_nominal": 5_000_000, "periode": "bulan", "luas_m2": 0.0},
            {"h3_index": HEX[0], "harga_nominal": 5_000_000, "periode": "bulan", "luas_m2": 50.0},
        ]
    )
    h = harga_sewa_per_m2(prop)
    assert h[HEX[0]] == 100_000 and np.isfinite(h[HEX[0]])


# ---------------------------------------------------------------------------
# D04 - waktu jalan kaki dari hex_routes
# ---------------------------------------------------------------------------


def contoh_rute() -> pd.DataFrame:
    """Tiga heksagon dengan bentuk kasus yang berbeda-beda.

    hex 1: tiga alternatif, dan yang TERCEPAT sengaja tidak ber-urutan 0
    hex 2: rute ke dua simpul berbeda
    hex 3: satu rute saja

    `jarak_m` ikut, seperti di tabel `hex_routes` yang sebenarnya. Sengaja
    TIDAK sebanding lurus dengan menit - rute tercepat hex 1 bukan yang
    terpendek - supaya uji D03 benar-benar membuktikan keduanya diambil dari
    baris yang sama, bukan kebetulan cocok karena datanya seragam.
    """
    return pd.DataFrame(
        [
            {"h3_index": HEX[0], "urutan": 0, "menit": 14.0, "jarak_m": 900.0},
            {"h3_index": HEX[0], "urutan": 1, "menit": 9.5, "jarak_m": 820.0},
            {"h3_index": HEX[0], "urutan": 2, "menit": 21.0, "jarak_m": 700.0},
            {"h3_index": HEX[1], "urutan": 0, "menit": 18.0, "jarak_m": 1400.0},
            {"h3_index": HEX[1], "urutan": 0, "menit": 12.0, "jarak_m": 1010.0},
            {"h3_index": HEX[2], "urutan": 0, "menit": 6.25, "jarak_m": 480.0},
        ]
    )


def test_d04_ambil_yang_tercepat_bukan_urutan_nol():
    """Inti fungsinya: minimum, bukan baris pertama.

    Kalau suatu saat ini diganti jadi `urutan == 0`, uji ini yang jatuh -
    dan itu memang jebakan yang pernah kena di produksi: ORS mengurutkan
    menurut weight internalnya, bukan menurut durasi.
    """
    d = waktu_jalan_dari_rute(contoh_rute())
    assert d[HEX[0]] == 9.5, f"harus memilih 9,5 menit, bukan {d[HEX[0]]}"


def test_d04_lintas_simpul_ambil_yang_terdekat():
    d = waktu_jalan_dari_rute(contoh_rute())
    assert d[HEX[1]] == 12.0


def test_d04_heksagon_tanpa_rute_tidak_muncul():
    """Aturan 4: kosong tetap kosong.

    Heksagon yang belum pernah dirutekan bukan heksagon berjarak nol menit.
    """
    d = waktu_jalan_dari_rute(contoh_rute())
    assert "89hex99999" not in d.index
    assert len(d) == 3


def test_d04_rute_kosong_aman():
    kosong = pd.DataFrame(columns=["h3_index", "menit", "jarak_m"])
    assert waktu_jalan_dari_rute(kosong).empty


def test_d04_menit_nol_dan_nan_dibuang():
    """Nol menit berarti rute gagal dihitung, bukan berdiri di atas peronnya."""
    rusak = pd.DataFrame(
        [
            {"h3_index": HEX[0], "urutan": 0, "menit": 0.0, "jarak_m": 0.0},
            {"h3_index": HEX[0], "urutan": 1, "menit": 7.0, "jarak_m": 540.0},
            {"h3_index": HEX[1], "urutan": 0, "menit": np.nan, "jarak_m": 300.0},
        ]
    )
    d = waktu_jalan_dari_rute(rusak)
    assert d[HEX[0]] == 7.0
    assert HEX[1] not in d.index


def test_d04_semua_positif():
    d = waktu_jalan_dari_rute(contoh_rute())
    assert (d > 0).all()



# ---------------------------------------------------------------------------
# Kompetisi - C01, C02, C03, C05, C06
# ---------------------------------------------------------------------------
#
# Heksagon di sini H3 SUNGGUHAN (Manggarai), bukan string karangan seperti
# HEX di atas: C01 memanggil `h3.grid_disk`, dan itu menolak indeks yang tidak
# sah. Uji yang memakai heksagon palsu akan gagal karena sebab yang salah.

PUSAT = h3.latlng_to_cell(-6.2131, 106.8496, 9)
TETANGGA = [t for t in h3.grid_disk(PUSAT, 1) if t != PUSAT]
JAUH = h3.latlng_to_cell(-6.3906, 106.8194, 9)  # Depok Baru, jauh di luar k-ring


def poi_df(baris: list[tuple[str, str, bool]]) -> pd.DataFrame:
    return pd.DataFrame(baris, columns=["h3_index", "kelas_induk", "is_waralaba"])


def test_kelas_dominan_ambil_yang_terbanyak():
    poi = poi_df([(PUSAT, "F2", False)] * 3 + [(PUSAT, "R1", False)] * 2)
    assert kelas_dominan(poi)[PUSAT] == "F2"


def test_kelas_dominan_seri_diputus_urutan_kelas_induk():
    """Dua kelas sama banyak -> yang lebih dulu di KELAS_INDUK menang.

    Yang diuji bukan 'F1 menang', melainkan bahwa hasilnya TIDAK bergantung
    pada urutan baris - dua urutan yang berbeda wajib menghasilkan hal sama.
    """
    maju = poi_df([(PUSAT, "F1", False), (PUSAT, "R2", False)])
    mundur = poi_df([(PUSAT, "R2", False), (PUSAT, "F1", False)])
    assert kelas_dominan(maju)[PUSAT] == kelas_dominan(mundur)[PUSAT]
    assert kelas_dominan(maju)[PUSAT] == "F1"


def test_c01_menghitung_k_ring_1_bukan_heksagon_saja():
    poi = poi_df(
        [(PUSAT, "F2", False)] * 2 + [(TETANGGA[0], "F2", False)] * 3
    )
    c01 = n_kompetitor_langsung(poi, kelas_dominan(poi))
    assert c01[PUSAT] == 5, c01[PUSAT]


def test_c01_hanya_kelas_dominan_bukan_seluruh_poi():
    """Apotek di sebelah kedai kopi bukan kompetitornya - itu inti C01."""
    poi = poi_df(
        [(PUSAT, "F2", False)] * 3
        + [(TETANGGA[0], "S2", False)] * 9
        + [(TETANGGA[1], "F2", False)] * 1
    )
    c01 = n_kompetitor_langsung(poi, kelas_dominan(poi))
    assert c01[PUSAT] == 4, c01[PUSAT]


def test_c01_tidak_menjangkau_di_luar_k_ring():
    poi = poi_df([(PUSAT, "F2", False)] + [(JAUH, "F2", False)] * 50)
    c01 = n_kompetitor_langsung(poi, kelas_dominan(poi))
    assert c01[PUSAT] == 1, c01[PUSAT]


def test_c01_ikut_menghitung_poi_di_heksagon_tak_terskor():
    """Kompetitor di seberang batas kawasan tetap kompetitor."""
    poi = poi_df([(PUSAT, "F2", False), (TETANGGA[2], "F2", False)])
    c01 = n_kompetitor_langsung(poi, kelas_dominan(poi))
    assert c01[PUSAT] == 2


def test_c02_menghitung_semua_kelas():
    poi = poi_df([(PUSAT, "F2", False), (PUSAT, "S2", False), (PUSAT, "K1", False)])
    assert kepadatan_poi_total(poi)[PUSAT] == 3


def test_c03_satu_jenis_usaha_entropi_nol():
    poi = poi_df([(PUSAT, "F2", False)] * 7)
    assert keragaman_usaha(poi)[PUSAT] == 0.0


def test_c03_delapan_kelas_merata_entropi_satu():
    poi = poi_df([(PUSAT, k, False) for k in KELAS_INDUK])
    assert abs(keragaman_usaha(poi)[PUSAT] - 1.0) < 1e-9


def test_c03_pembagi_tetap_ln8_walau_kelas_lebih_sedikit():
    """Dua kelas seimbang TIDAK boleh tercatat seragam sempurna."""
    poi = poi_df([(PUSAT, "F2", False), (PUSAT, "R1", False)])
    nilai = keragaman_usaha(poi)[PUSAT]
    assert 0.3 < nilai < 0.4, nilai  # ln(2)/ln(8) = 1/3


def test_c05_pangsa_waralaba_persen():
    poi = poi_df([(PUSAT, "F2", True), (PUSAT, "F2", False), (PUSAT, "R1", False),
                  (PUSAT, "R1", False)])
    assert pangsa_waralaba(poi)[PUSAT] == 25.0


def test_c06_penduduk_nol_jadi_kosong_bukan_tak_hingga():
    c01 = pd.Series([10.0, 10.0, 10.0], index=["a", "b", "c"])
    pop = pd.Series([100.0, 0.0, np.nan], index=["a", "b", "c"])
    c06 = rasio_kompetitor_per_kapita(c01, pop)
    assert c06["a"] == 0.1
    assert pd.isna(c06["b"]), c06["b"]
    assert pd.isna(c06["c"]), c06["c"]
    assert np.isfinite(c06.dropna()).all()


def test_dimensi_kompetisi_poi_kosong_aman():
    hasil = dimensi_kompetisi(poi_df([]))
    assert hasil.empty


def test_dimensi_kompetisi_tidak_mengarang_c07_c08():
    """Kolom yang menuntut data misi TIDAK boleh muncul dari OSM.

    C04 dulu ikut di sini. Ia keluar bukan karena aturannya melonggar melainkan
    karena sumbernya ketemu: OSM membawa taksonomi masakan sendiri lewat tag
    `cuisine`, jadi C04 tidak lagi menuntut A4. C07 dan C08 tetap - keduanya
    menuntut penanda pedagang KELILING, dan OSM tidak memetakan gerobak.
    """
    poi = poi_df([(PUSAT, "F2", False), (TETANGGA[0], "R1", True)])
    kolom = set(dimensi_kompetisi(poi, pop=pd.Series({PUSAT: 500.0})).columns)
    assert not kolom & {"rasio_keliling", "n_menetap_kuliner"}
    assert "rasio_kompetitor_per_kapita" in kolom


def test_dimensi_kompetisi_c04_kosong_kalau_cuisine_tidak_ada():
    """POI tanpa kolom `cuisine` (sumber misi MAPID) menghasilkan C04 KOSONG,
    bukan nol - dan kolomnya tetap ada supaya `muat_variabel` menimpanya."""
    poi = poi_df([(PUSAT, "F2", False), (TETANGGA[0], "R1", True)])
    hasil = dimensi_kompetisi(poi, pop=pd.Series({PUSAT: 500.0}))
    assert "keragaman_kuliner" in hasil.columns
    assert hasil["keragaman_kuliner"].isna().all()


# ---------------------------------------------------------------------------
# Penguraian OSM -> baris business_pois / transport_nodes
# ---------------------------------------------------------------------------


def el(tipe="node", oid=1, lat=-6.2131, lon=106.8496, **tag):
    e = {"type": tipe, "id": oid, "tags": tag}
    if tipe == "way":
        e["center"] = {"lat": lat, "lon": lon}
    else:
        e["lat"], e["lon"] = lat, lon
    return e


def test_poi_way_memakai_center():
    """`way` tidak punya lat/lon sendiri - kalau ini rusak, seluruh mal hilang."""
    df = poi_dari_osm([el("way", 7, name="Pasar Rumput", amenity="marketplace")])
    assert len(df) == 1
    assert df.iloc[0]["h3_index"] == PUSAT


def test_poi_tanpa_nama_dibuang():
    """ATM di dalam minimarket akan menggandakan satu tempat yang sama."""
    assert poi_dari_osm([el(amenity="atm")]).empty


def test_poi_tag_tak_dikenal_dibuang():
    assert poi_dari_osm([el(name="Halte", highway="bus_stop")]).empty


def test_poi_koordinat_sampah_dibuang():
    """Null island lolos setiap pemeriksaan yang mengira nol angka yang sah."""
    assert poi_dari_osm([el(lat=0, lon=0, name="X", amenity="cafe")]).empty


def test_poi_menyimpan_kategori_asli_untuk_audit():
    df = poi_dari_osm([el(name="Kopi Kenangan", amenity="cafe", brand="Kopi Kenangan")])
    assert df.iloc[0]["kategori_asli"] == "amenity=cafe"
    assert bool(df.iloc[0]["is_waralaba"]) is True


def test_poi_tanpa_merek_bukan_waralaba():
    df = poi_dari_osm([el(name="Warung Bu Tin", amenity="restaurant")])
    assert bool(df.iloc[0]["is_waralaba"]) is False


def test_poi_kosong_tetap_berkolom_lengkap():
    """DataFrame kosong tanpa kolom akan meledak jauh di hilir, bukan di sini."""
    kosong = poi_dari_osm([])
    assert kosong.empty
    assert "kelas_induk" in kosong.columns and "h3_index" in kosong.columns


def test_simpul_mrt_tidak_tercatat_krl():
    """MRT membawa railway=station DAN station=subway sekaligus."""
    df = simpul_dari_osm([el(name="Dukuh Atas BNI", railway="station", station="subway")])
    assert df.iloc[0]["moda"] == "MRT"


def test_simpul_lrt_tidak_tercatat_krl():
    df = simpul_dari_osm([el(name="Harjamukti", railway="station", station="light_rail")])
    assert df.iloc[0]["moda"] == "LRT"


def test_simpul_krl_biasa():
    df = simpul_dari_osm([el(name="Manggarai", railway="station")])
    assert df.iloc[0]["moda"] == "KRL"


def test_simpul_halte_jadi_brt():
    df = simpul_dari_osm([el(name="Halte Tosari", highway="bus_stop")])
    assert df.iloc[0]["moda"] == "BRT"


def test_simpul_tanpa_tag_moda_dibuang():
    assert simpul_dari_osm([el(name="Entah", tourism="hotel")]).empty


def test_rantai_osm_ke_c01_utuh():
    """Dari elemen Overpass mentah sampai C01, tanpa satu pun angka ditulis tangan."""
    lat_t, lon_t = h3.cell_to_latlng(TETANGGA[0])
    elemen = [
        el(oid=1, name="Kopi A", amenity="cafe"),
        el(oid=2, name="Kopi B", amenity="cafe"),
        el(oid=3, lat=lat_t, lon=lon_t, name="Kopi C", amenity="cafe"),
        el(oid=4, name="Apotek D", amenity="pharmacy"),
    ]
    poi = poi_dari_osm(elemen)
    hasil = dimensi_kompetisi(poi)
    assert hasil.loc[PUSAT, "kepadatan_poi_total"] == 3     # C02: kafe + kafe + apotek
    assert hasil.loc[PUSAT, "n_kompetitor_langsung"] == 3   # C01: tiga kafe, apotek tidak


# ---------------------------------------------------------------------------
# Konteks heksagon - D08, D09
# ---------------------------------------------------------------------------


def test_kantor_dibaca_dari_ada_tidaknya_tag_office():
    """Nilai `office` apa pun tetap kantor - yang dihitung orang yang bekerja."""
    k = konteks_dari_osm([el(name="PT A", office="company"),
                          el(oid=2, name="LBH", office="lawyer")])
    assert dimensi_konteks(k).loc[PUSAT, "kepadatan_kantor"] == 2


def test_d09_menjumlah_keempat_generator():
    k = konteks_dari_osm([
        el(oid=1, name="SDN 01", amenity="school"),
        el(oid=2, name="RSUD", amenity="hospital"),
        el(oid=3, name="Pasar Rumput", amenity="marketplace"),
        el(oid=4, name="Masjid", amenity="place_of_worship", religion="muslim"),
    ])
    hasil = dimensi_konteks(k)
    assert hasil.loc[PUSAT, "generator_keramaian"] == 4
    assert hasil.loc[PUSAT, "kepadatan_kantor"] == 0


def test_kantor_tidak_ikut_generator_keramaian():
    k = konteks_dari_osm([el(name="PT A", office="company")])
    assert dimensi_konteks(k).loc[PUSAT, "generator_keramaian"] == 0


def test_gereja_bukan_masjid():
    """D09 menyebut masjid; rumah ibadah lain tidak boleh ikut diam-diam."""
    k = konteks_dari_osm([el(name="Gereja", amenity="place_of_worship", religion="christian")])
    assert k.empty


def test_sekolah_tidak_pernah_jadi_kompetitor():
    """Elemen konteks WAJIB ditolak business_pois - kalau tidak, sekolah
    tercatat sebagai pesaing warung di sebelahnya."""
    e = [el(name="SDN 01", amenity="school"), el(oid=2, name="Masjid",
         amenity="place_of_worship", religion="muslim")]
    assert poi_dari_osm(e).empty
    assert len(konteks_dari_osm(e)) == 2


def test_satu_elemen_bisa_dua_jenis():
    """Sekolah yang juga ditandai kantor memang dua-duanya."""
    k = konteks_dari_osm([el(name="Kampus X", amenity="university", office="educational_institution")])
    hasil = dimensi_konteks(k)
    assert hasil.loc[PUSAT, "kepadatan_kantor"] == 1
    assert hasil.loc[PUSAT, "generator_keramaian"] == 1


def test_dimensi_konteks_kosong_aman():
    hasil = dimensi_konteks(konteks_dari_osm([]))
    assert hasil.empty
    assert "kepadatan_kantor" in hasil.columns


def test_heksagon_tanpa_poi_diisi_nol_bukan_dilewati():
    """Kalau ia dilewati, `muat_variabel` tidak menyentuhnya dan angka sintetis
    demo_seed bertahan di kolom yang sama dengan angka OSM sungguhan."""
    poi = poi_df([(PUSAT, "F2", False)])
    semua = pd.Index([PUSAT, JAUH], name="h3_index")
    hasil = dimensi_kompetisi(poi, semua_hex=semua)
    assert JAUH in hasil.index
    assert hasil.loc[JAUH, "n_kompetitor_langsung"] == 0
    assert hasil.loc[JAUH, "kepadatan_poi_total"] == 0


def test_heksagon_tanpa_poi_keragaman_tetap_kosong():
    """C03 dibalik di IKP - heksagon kosong berkeragaman 0 akan dihukum seolah
    monokultur padat. Kosong tetap kosong (aturan 4)."""
    poi = poi_df([(PUSAT, "F2", False)])
    hasil = dimensi_kompetisi(poi, semua_hex=pd.Index([PUSAT, JAUH]))
    assert pd.isna(hasil.loc[JAUH, "keragaman_usaha"])
    assert pd.isna(hasil.loc[JAUH, "pangsa_waralaba"])


def test_c06_nol_untuk_heksagon_tanpa_kompetitor():
    """Nol kompetitor per kapita angka yang sah, bukan ketiadaan angka."""
    poi = poi_df([(PUSAT, "F2", False)])
    semua = pd.Index([PUSAT, JAUH])
    hasil = dimensi_kompetisi(poi, pop=pd.Series({PUSAT: 500.0, JAUH: 400.0}), semua_hex=semua)
    assert hasil.loc[JAUH, "rasio_kompetitor_per_kapita"] == 0.0


def test_konteks_heksagon_tanpa_apa_pun_diisi_nol():
    k = konteks_dari_osm([el(name="PT A", office="company")])
    hasil = dimensi_konteks(k, semua_hex=pd.Index([PUSAT, JAUH]))
    assert hasil.loc[JAUH, "kepadatan_kantor"] == 0
    assert hasil.loc[JAUH, "generator_keramaian"] == 0


# ---------------------------------------------------------------------------
# D03 - jarak ke simpul, dari rute yang SAMA dengan D04
# ---------------------------------------------------------------------------


def test_d03_diambil_dari_rute_tercepat_bukan_terpendek():
    """Inti aturannya. Hex 1 punya rute 700 m (21 menit) dan 820 m (9,5 menit).
    Yang benar 820 m - jarak perjalanan yang waktunya kita tampilkan. Mengambil
    minimum jarak sendiri-sendiri akan menghasilkan pasangan "700 m, 9,5 menit"
    untuk perjalanan yang tidak pernah ada."""
    d = simpul_terdekat_dari_rute(contoh_rute())
    assert d.loc[HEX[0], "jarak_simpul_m"] == 820.0, d.loc[HEX[0], "jarak_simpul_m"]
    assert d.loc[HEX[0], "waktu_jalan_menit"] == 9.5


def test_d03_lintas_simpul_ikut_yang_tercepat():
    d = simpul_terdekat_dari_rute(contoh_rute())
    assert d.loc[HEX[1], "jarak_simpul_m"] == 1010.0
    assert d.loc[HEX[1], "waktu_jalan_menit"] == 12.0


def test_d03_dan_d04_selalu_sepasang():
    """Tidak boleh ada heksagon yang punya salah satunya saja."""
    d = simpul_terdekat_dari_rute(contoh_rute())
    assert d["jarak_simpul_m"].notna().equals(d["waktu_jalan_menit"].notna())


def test_d03_heksagon_tanpa_rute_tidak_muncul():
    d = simpul_terdekat_dari_rute(contoh_rute())
    assert "89hex-tak-ada" not in d.index
    assert len(d) == 3


def test_d03_rute_kosong_aman():
    kosong = pd.DataFrame(columns=["h3_index", "menit", "jarak_m"])
    d = simpul_terdekat_dari_rute(kosong)
    assert d.empty
    assert "jarak_simpul_m" in d.columns


def test_d03_semua_positif():
    d = simpul_terdekat_dari_rute(contoh_rute())
    assert (d["jarak_simpul_m"] > 0).all()


# ---------------------------------------------------------------------------
# D01 - raster WorldPop -> heksagon
# ---------------------------------------------------------------------------
#
# Raster tiruan dibuat di sekitar Manggarai dengan ukuran piksel WorldPop yang
# sebenarnya (0,0008333 derajat). Yang diuji BUKAN angka penduduknya - itu milik
# WorldPop - melainkan bahwa penjumlahannya tidak menciptakan dan tidak
# menghilangkan orang.

PIKSEL = 0.0008333333
KIRI, ATAS = 106.8400, -6.2050


def raster(nilai):
    return np.array(nilai, dtype=float)


def test_penduduk_kekal():
    """Invarian terpenting: jumlah keluaran == jumlah masukan yang sah.
    Kalau pembagian subpiksel bocor, ia bocor di sini lebih dulu."""
    a = raster([[10.0, 20.0, 30.0], [40.0, 50.0, 60.0], [70.0, 80.0, 90.0]])
    d = penduduk_per_heksagon(a, KIRI, ATAS, PIKSEL, PIKSEL)
    assert abs(d.sum() - a.sum()) < 0.5, f"{d.sum()} vs {a.sum()}"


def test_nodata_tidak_ikut_terhitung():
    a = raster([[100.0, -99999.0], [-99999.0, 100.0]])
    d = penduduk_per_heksagon(a, KIRI, ATAS, PIKSEL, PIKSEL, nodata=-99999.0)
    assert abs(d.sum() - 200.0) < 0.5, d.sum()


def test_nilai_negatif_dan_nol_dibuang():
    """WorldPop tidak punya penduduk negatif; kalau muncul, itu nodata yang
    lolos - dan menjumlahkannya akan MENGURANGI penduduk heksagon."""
    a = raster([[50.0, 0.0], [-3.0, 50.0]])
    d = penduduk_per_heksagon(a, KIRI, ATAS, PIKSEL, PIKSEL)
    assert abs(d.sum() - 100.0) < 0.5, d.sum()


def test_nan_tidak_meracuni_jumlah():
    a = raster([[50.0, np.nan], [np.nan, 50.0]])
    d = penduduk_per_heksagon(a, KIRI, ATAS, PIKSEL, PIKSEL)
    assert np.isfinite(d.sum()) and abs(d.sum() - 100.0) < 0.5, d.sum()


def test_raster_kosong_aman():
    assert penduduk_per_heksagon(np.zeros((0, 0)), KIRI, ATAS, PIKSEL, PIKSEL).empty


def test_semua_nodata_aman():
    a = raster([[-99999.0, -99999.0], [-99999.0, -99999.0]])
    assert penduduk_per_heksagon(a, KIRI, ATAS, PIKSEL, PIKSEL, nodata=-99999.0).empty


def test_indeks_keluaran_h3_sah():
    a = raster([[100.0, 100.0], [100.0, 100.0]])
    d = penduduk_per_heksagon(a, KIRI, ATAS, PIKSEL, PIKSEL)
    assert len(d) > 0
    for sel in d.index:
        assert h3.is_valid_cell(sel), sel
        assert h3.get_resolution(sel) == 9


def test_raster_mengarah_ke_bawah():
    """Baris bertambah -> lintang BERKURANG. Kalau tandanya terbalik, seluruh
    penduduk mendarat di heksagon yang salah tanpa satu pun galat."""
    a = raster([[100.0], [0.0]])          # penduduk di baris ATAS
    b = raster([[0.0], [100.0]])          # penduduk di baris BAWAH
    atas = penduduk_per_heksagon(a, KIRI, ATAS, PIKSEL, PIKSEL).index[0]
    bawah = penduduk_per_heksagon(b, KIRI, ATAS, PIKSEL, PIKSEL).index[0]
    assert atas != bawah
    assert h3.cell_to_latlng(atas)[0] > h3.cell_to_latlng(bawah)[0]


# ---------------------------------------------------------------------------
# M01 / M02 - footprint bangunan OSM
# ---------------------------------------------------------------------------

import math as _math


def kotak(lat, lon, d=0.001):
    """Bujur sangkar d derajat, cincin tertutup seperti keluaran Overpass."""
    return [{"lat": lat, "lon": lon}, {"lat": lat, "lon": lon + d},
            {"lat": lat + d, "lon": lon + d}, {"lat": lat + d, "lon": lon},
            {"lat": lat, "lon": lon}]


def test_luas_cocok_dengan_hitungan_analitis():
    """Kalau proyeksinya salah, ia salah DIAM - luasnya tetap angka yang wajar."""
    la, lo, d = -6.2131, 106.8496, 0.001
    harap = (d * 110_574.0) * (d * 111_320.0 * _math.cos(_math.radians(la)))
    assert abs(luas_poligon_m2(kotak(la, lo, d)) - harap) / harap < 1e-4


def test_luas_segitiga_separuh_kotak():
    k = kotak(-6.2131, 106.8496)
    segitiga = k[:3] + [k[0]]
    assert abs(luas_poligon_m2(segitiga) / luas_poligon_m2(k) - 0.5) < 1e-6


def test_luas_tidak_bergantung_arah_putaran():
    """Shoelace bertanda; kalau nilai mutlaknya lupa dipakai, separuh bangunan
    di OSM (yang digambar searah jarum jam) berluas NEGATIF."""
    k = kotak(-6.2131, 106.8496)
    assert abs(luas_poligon_m2(k) - luas_poligon_m2(list(reversed(k)))) < 1e-6


def test_geometri_rusak_jadi_none_bukan_nol():
    """Nol akan ikut menurunkan median; None dibuang."""
    assert luas_poligon_m2([]) is None
    assert luas_poligon_m2([{"lat": -6.2, "lon": 106.8}]) is None
    assert luas_poligon_m2([{"lat": -6.2, "lon": 106.8}] * 5) is None


def test_bangunan_tanpa_geometri_dibuang():
    assert bangunan_dari_osm([{"type": "way", "id": 1, "tags": {"building": "yes"}}]).empty


def test_m01_rasio_terhadap_luas_sel_h3_sendiri():
    """Satu bangunan seluas X di sel seluas A harus memberi 100*X/A.

    Pembaginya luas sel ITU SENDIRI, bukan konstanta 105.000 m2 - sel res-9
    berbeda-beda beberapa persen, dan pembagi yang salah meleset searah untuk
    seluruh kawasan sekaligus.
    """
    la, lo = h3.cell_to_latlng(PUSAT)
    b = bangunan_dari_osm([{"type": "way", "id": 1, "geometry": kotak(la, lo, 0.0002)}])
    sel = b.iloc[0]["h3_index"]
    harap = b.iloc[0]["luas_m2"] / h3.cell_area(sel, unit="m^2") * 100
    dapat = morfologi_bangunan(b).loc[sel, "rasio_tutupan_bangunan"]
    assert abs(dapat - harap) <= 0.005, f"{dapat} vs {harap}"   # dibulatkan 2 desimal


def test_m02_median_bukan_rata_rata():
    """Satu mal raksasa tidak boleh menggeser 'luas bangunan khas'."""
    b = pd.DataFrame({"h3_index": [PUSAT] * 4, "luas_m2": [50.0, 60.0, 70.0, 90000.0]})
    assert morfologi_bangunan(b).loc[PUSAT, "luas_bangunan_median"] == 65.0


def test_m01_dalam_persen_bukan_pecahan():
    """Antarmuka mencetak angkanya apa adanya lalu menempel "%". Menyimpan
    pecahan menghasilkan "0,55 %" untuk sesuatu yang berarti 55%."""
    luas_sel = h3.cell_area(PUSAT, unit="m^2")
    b = pd.DataFrame({"h3_index": [PUSAT], "luas_m2": [luas_sel * 0.5]})
    assert abs(morfologi_bangunan(b).loc[PUSAT, "rasio_tutupan_bangunan"] - 50.0) < 0.01


def test_m01_tidak_dipangkas_di_seratus():
    """Tutupan > 100% adalah TANDA poligon bertumpang tindih. Memangkasnya
    menyembunyikan tandanya sambil tetap salah."""
    luas_sel = h3.cell_area(PUSAT, unit="m^2")
    b = pd.DataFrame({"h3_index": [PUSAT], "luas_m2": [luas_sel * 1.4]})
    assert morfologi_bangunan(b).loc[PUSAT, "rasio_tutupan_bangunan"] > 100.0


def test_heksagon_tanpa_bangunan_m01_nol_m02_kosong():
    """Nol bangunan = nol tutupan (nyata), tetapi luas median dari himpunan
    kosong tidak punya nilai - dan nol akan berarti 'rata-rata seluas 0 m2'."""
    b = pd.DataFrame({"h3_index": [PUSAT], "luas_m2": [80.0]})
    m = morfologi_bangunan(b, semua_hex=pd.Index([PUSAT, JAUH]))
    assert m.loc[JAUH, "rasio_tutupan_bangunan"] == 0.0
    assert pd.isna(m.loc[JAUH, "luas_bangunan_median"])


def test_morfologi_kosong_aman():
    m = morfologi_bangunan(pd.DataFrame(columns=["h3_index", "luas_m2"]))
    assert m.empty and "rasio_tutupan_bangunan" in m.columns


# ---------------------------------------------------------------------------
# Data misi MAPID
# ---------------------------------------------------------------------------
#
# Yang diuji paling keras di sini SATU aturan: heksagon yang tidak disurvei
# harus KOSONG, bukan nol. Data misi adalah survei bertitik - 688 dari 708
# heksagon tidak pernah dikunjungi siapa pun, dan mengisinya nol akan
# menggambarkan Jabodetabek sebagai kawasan mati.

KOSONG_MISI = pd.DataFrame(columns=["h3_index"])


def fitur(lat=-6.2131, lon=106.8496, **prop):
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": prop}


def test_tanggal_objek_kosong_jadi_none():
    """API mengembalikan `{}` - bukan null, bukan string kosong - di seluruh
    866 titik. Kalau ini meledak, seluruh penarikan gagal."""
    assert parse_tanggal_misi({}) is None
    assert parse_tanggal_misi(None) is None
    assert parse_tanggal_misi("") is None


def test_tanggal_bentuk_lain_tetap_terbaca():
    """Ditulis toleran supaya bentuk baru dari MAPID tidak menghentikan pipeline."""
    assert parse_tanggal_misi("2026-08-15").year == 2026
    assert parse_tanggal_misi("15-08-2026 07:05").hour == 7
    assert parse_tanggal_misi({"$date": "2026-08-15T07:05:00Z"}).year == 2026
    assert parse_tanggal_misi("entah kapan") is None


def test_menu_nilai_terpetakan():
    df = menu_dari_mapid([fitur(nama_tempat="Warung A", harga_rata_rata="25000",
                                kondisi_tempat="Ramai (antrean panjang)",
                                mobilitas="Ya (Berkeliling)", menu_utama="Soto")])
    r = df.iloc[0]
    assert r["kondisi_pembeli"] == "Ramai"
    assert bool(r["mobilitas_keliling"]) is True
    assert r["harga_rata_porsi"] == 25000.0


def test_menu_harga_di_luar_ambang_dibuang():
    """25 hampir pasti '25 ribu' yang diketik salah; 9 juta harga paket."""
    df = menu_dari_mapid([fitur(nama_tempat="A", harga_rata_rata="25"),
                          fitur(oid=2, nama_tempat="B", harga_rata_rata="9000000")])
    assert df["harga_rata_porsi"].isna().all()


def test_titik_di_luar_bbox_dibuang():
    assert menu_dari_mapid([fitur(lat=48.85, lon=2.35, nama_tempat="Paris")]).empty


def test_struk_menyimpan_foto_url():
    """Satu-satunya jalan menuju nominal dan jam; tanpa disimpan, A2 harus
    menarik ulang seluruh dataset."""
    df = struk_dari_mapid([fitur(nama_tempat="X", metode_pembayaran="QRIS",
                                 foto_struk="https://cdn/x.jpg")])
    assert df.iloc[0]["foto_url"] == "https://cdn/x.jpg"


def test_properti_status_terpetakan():
    df = properti_dari_mapid([fitur(kategori_properti="Ruko", jenis_properti="Disewa"),
                              fitur(kategori_properti="Rumah", jenis_properti="Dijual")])
    assert sorted(df["status"].tolist()) == ["jual", "sewa"]


# --- aturan inti: tak disurvei = KOSONG ------------------------------------


def contoh_misi():
    m = pd.DataFrame({"h3_index": [PUSAT, PUSAT], "harga_rata_porsi": [20000.0, 30000.0],
                      "mobilitas_keliling": [False, True], "kondisi_pembeli": ["Sepi", "Ramai"]})
    s = pd.DataFrame({"h3_index": [PUSAT, PUSAT], "metode_bayar": ["QRIS", "Tunai"]})
    p = pd.DataFrame({"h3_index": [PUSAT], "status": ["sewa"]})
    a = pd.DataFrame({"h3_index": [PUSAT]})
    return m, s, p, a


def test_heksagon_tak_disurvei_kosong_bukan_nol():
    """Aturan 4 dalam bentuknya yang paling penting. Kalau ini jadi nol, 688
    heksagon akan tampak sebagai kawasan tanpa warung, tanpa aktivitas, dan
    tanpa ruang sewa - padahal tidak ada yang pernah datang ke sana."""
    v = dimensi_misi(*contoh_misi(), semua_hex=pd.Index([PUSAT, JAUH]))
    for k in ("harga_median_porsi", "skor_ramai_terkoreksi", "rasio_keliling",
              "n_menetap_kuliner", "pangsa_digital", "aktivitas_komunitas",
              "pasokan_sewa_komersial"):
        assert pd.isna(v.loc[JAUH, k]), f"{k} terisi {v.loc[JAUH, k]}, seharusnya kosong"


def test_n_titik_misi_nol_justru_benar():
    """Satu-satunya yang BOLEH nol: ia menghitung upaya survei, dan nol
    kunjungan adalah pernyataan yang benar."""
    v = dimensi_misi(*contoh_misi(), semua_hex=pd.Index([PUSAT, JAUH]))
    assert v.loc[JAUH, "n_titik_misi"] == 0
    assert v.loc[PUSAT, "n_titik_misi"] == 5      # 2 menu + 2 struk + 1 properti


def test_c07_c08_dari_mobilitas():
    v = dimensi_misi(*contoh_misi())
    assert v.loc[PUSAT, "rasio_keliling"] == 50.0      # 1 dari 2, persen
    assert v.loc[PUSAT, "n_menetap_kuliner"] == 1.0


def test_b06_nontunai_adalah_pengecualian_bukan_daftar_putih():
    """Metode bayar baru akan terus muncul; daftar putih membuat yang baru
    diam-diam terhitung sebagai tunai."""
    s = pd.DataFrame({"h3_index": [PUSAT] * 4,
                      "metode_bayar": ["QRIS", "Tunai", "Metode Baru 2027", "Debit"]})
    v = dimensi_misi(pd.DataFrame(columns=["h3_index"]), s,
                     pd.DataFrame(columns=["h3_index"]), pd.DataFrame(columns=["h3_index"]))
    assert v.loc[PUSAT, "pangsa_digital"] == 75.0


def test_b08_satu_tempat_tidak_punya_sebaran():
    """Nol akan berarti 'seluruh tempat di sini berharga sama'."""
    m = pd.DataFrame({"h3_index": [PUSAT], "harga_rata_porsi": [20000.0],
                      "mobilitas_keliling": [False], "kondisi_pembeli": ["Sepi"]})
    kosong = pd.DataFrame(columns=["h3_index"])
    v = dimensi_misi(m, kosong, kosong, kosong)
    assert pd.isna(v.loc[PUSAT, "spread_harga"])


def test_d10_memakai_skala_config():
    m = pd.DataFrame({"h3_index": [PUSAT, PUSAT], "harga_rata_porsi": [1.0, 1.0],
                      "mobilitas_keliling": [False, False], "kondisi_pembeli": ["Sepi", "Ramai"]})
    kosong = pd.DataFrame(columns=["h3_index"])
    v = dimensi_misi(m, kosong, kosong, kosong)
    assert v.loc[PUSAT, "skor_ramai_terkoreksi"] == 0.5      # (0,0 + 1,0) / 2


def test_dimensi_misi_seluruhnya_kosong_aman():
    kosong = pd.DataFrame(columns=["h3_index"])
    v = dimensi_misi(kosong, kosong, kosong, kosong, semua_hex=pd.Index([PUSAT]))
    assert v.loc[PUSAT, "n_titik_misi"] == 0
    assert v.drop(columns=["n_titik_misi"]).isna().all().all()


# ---------------------------------------------------------------------------
# Zonasi RDTR - L01, L02, L03
# ---------------------------------------------------------------------------
#
# L01 adalah GERBANG: FALSE menolkan skor lokasi berapa pun nilai variabel
# lainnya. Karena itu ujinya bukan cuma "apakah terhitung", melainkan apakah ia
# cukup enggan menolak.


def _z(kod, nam, pangsa, krb="Tidak Ada"):
    """Satu zona hasil `s1_ingest._potong_ke_heksagon`."""
    return {"KODZON": kod, "NAMZON": nam, "KRB_03": krb, "pangsa": pangsa}


def test_l02_dominan_menurut_LUAS_bukan_jumlah_poligon():
    """Satu zona besar vs banyak serpihan. Menghitung kepala akan menyatakan
    zona yang salah sebagai dominan."""
    v = dimensi_lahan({PUSAT: [_z("K", "Zona Perdagangan dan Jasa", 0.80)]
                       + [_z("RTH", "Zona Ruang Terbuka Hijau", 0.05) for _ in range(4)]})
    assert v.loc[PUSAT, "kelas_zona"] == "Zona Perdagangan dan Jasa"


def test_l01_true_kalau_ada_sepetak_zona_usaha():
    """Sepetak ruko di sudut sudah cukup untuk membuka usaha - yang dijawab L01
    bukan 'apakah seluruh heksagon komersial'."""
    v = dimensi_lahan({PUSAT: [_z("R", "Zona Perumahan", 0.95),
                               _z("K", "Zona Perdagangan dan Jasa", 0.05)]})
    assert v.loc[PUSAT, "zona_izin_komersial"] == True   # noqa: E712


def test_l01_false_hanya_kalau_seluruhnya_bukan_tempat_usaha():
    v = dimensi_lahan({PUSAT: [_z("BA", "Zona Badan Air", 0.5),
                               _z("BJ", "Zona Badan Jalan", 0.5)]})
    assert v.loc[PUSAT, "zona_izin_komersial"] == False  # noqa: E712


def test_l01_zona_abu_abu_tidak_diputuskan():
    """R/KT/SPU/TR lazim mengizinkan sebagian usaha lewat ITBX, tetapi ITBX
    dari API TERPOTONG di 11.523 karakter. Menebak 'dilarang' akan menolkan
    skor lokasi yang sah."""
    for kod, nam in (("R", "Zona Perumahan"), ("KT", "Zona Perkantoran"),
                     ("SPU", "Zona Pelayanan Umum"), ("TR", "Zona Transportasi")):
        izin = dimensi_lahan({PUSAT: [_z(kod, nam, 1.0)]}).loc[PUSAT, "zona_izin_komersial"]
        assert izin is None or pd.isna(izin), f"{kod}: {izin!r}"


def test_l01_campuran_abu_abu_dan_terlarang_tetap_tidak_diputuskan():
    izin = dimensi_lahan({PUSAT: [_z("BJ", "Zona Badan Jalan", 0.5),
                                  _z("R", "Zona Perumahan", 0.5)]}).loc[
        PUSAT, "zona_izin_komersial"]
    assert izin is None or pd.isna(izin), repr(izin)


def test_l01_zona_usaha_di_bawah_ambang_tidak_cukup():
    """0,5% dari heksagon kemungkinan besar serpihan digitasi, bukan sepetak ruko."""
    izin = dimensi_lahan({PUSAT: [_z("R", "Zona Perumahan", 0.995),
                                  _z("K", "Zona Perdagangan dan Jasa", 0.005)]}).loc[
        PUSAT, "zona_izin_komersial"]
    assert izin is None or pd.isna(izin), repr(izin)


def test_l03_ditimbang_luas():
    """Separuh 'Sangat Tinggi' (1,0) + separuh 'Tidak Ada' (0,0) -> 0,5."""
    v = dimensi_lahan({PUSAT: [
        _z("R", "Zona Perumahan", 0.5, "Kawasan Rawan Banjir - Sangat Tinggi"),
        _z("R", "Zona Perumahan", 0.5, "Tidak Ada")]})
    assert v.loc[PUSAT, "risiko_banjir"] == 0.5


def test_l03_tidak_ada_adalah_nol_yang_sah():
    """'Tidak Ada' berarti tidak masuk kawasan rawan - itu nol, bukan kosong."""
    v = dimensi_lahan({PUSAT: [_z("R", "Zona Perumahan", 1.0, "Tidak Ada")]})
    assert v.loc[PUSAT, "risiko_banjir"] == 0.0


def test_l03_nilai_tak_dikenal_jadi_kosong_bukan_nol():
    v = dimensi_lahan({PUSAT: [_z("R", "Zona Perumahan", 1.0, "Entah Apa")]})
    assert pd.isna(v.loc[PUSAT, "risiko_banjir"])


def test_heksagon_di_luar_dki_tetap_kosong():
    """Daftar kosong = 'tidak ada RDTR untuk bidang ini' = TIDAK_DIKETAHUI,
    BUKAN dilarang. Yang menerjemahkannya `aturan.status_zona`, dan ia
    membedakan None dari False."""
    v = dimensi_lahan({PUSAT: []}, semua_hex=pd.Index([PUSAT, JAUH]))
    for sel in (PUSAT, JAUH):
        izin = v.loc[sel, "zona_izin_komersial"]
        assert izin is None or pd.isna(izin), f"{sel}: {izin!r}"
        assert izin is not False
    assert pd.isna(v.loc[JAUH, "risiko_banjir"])



def test_l01_tidak_melarang_kalau_cakupan_rdtr_tipis():
    """Heksagon tepi DKI: cuma 20% bidangnya tertutup poligon RDTR, dan
    kebetulan seluruhnya badan jalan. Menyatakan DILARANG dari seperlima bidang
    akan menolkan skor lokasi yang empat perlimanya belum diperiksa siapa pun."""
    izin = dimensi_lahan({PUSAT: [_z("BJ", "Zona Badan Jalan", 0.20)]}).loc[
        PUSAT, "zona_izin_komersial"]
    assert izin is None or pd.isna(izin), repr(izin)


def test_l01_melarang_kalau_cakupannya_penuh():
    izin = dimensi_lahan({PUSAT: [_z("BJ", "Zona Badan Jalan", 0.55),
                                  _z("BA", "Zona Badan Air", 0.42)]}).loc[
        PUSAT, "zona_izin_komersial"]
    assert izin == False   # noqa: E712

# ---------------------------------------------------------------------------
# C04 keragaman kuliner - dari tag `cuisine` OSM
# ---------------------------------------------------------------------------


def _kul(h3i, *masakan):
    """Sekumpulan POI kuliner di satu heksagon, masing-masing satu masakan."""
    return pd.DataFrame(
        [
            {"h3_index": h3i, "kelas_induk": "F1", "cuisine": m}
            for m in masakan
        ]
    )


def test_c04_butuh_cukup_banyak_yang_bertag():
    """Dua bertag tidak boleh menghasilkan angka - entropi atas dua titik
    tidak bisa dibedakan dari 'seluruhnya masakan yang sama'."""
    assert keragaman_kuliner(_kul("h1", "indonesian", "japanese")).empty


def test_c04_butuh_pangsa_bertag_yang_cukup():
    """Tiga bertag di antara dua puluh rumah makan TIDAK mewakili tujuh belas
    yang tidak diketahui - dan angka yang dihitung darinya akan terbaca sebagai
    pengukuran."""
    poi = _kul("h1", "indonesian", "japanese", "chinese")
    diam = pd.DataFrame(
        [{"h3_index": "h1", "kelas_induk": "F1", "cuisine": ""} for _ in range(17)]
    )
    assert keragaman_kuliner(pd.concat([poi, diam], ignore_index=True)).empty


def test_c04_seragam_lebih_rendah_daripada_beragam():
    seragam = keragaman_kuliner(_kul("h1", "indonesian", "indonesian", "indonesian",
                                     "japanese", "chinese", "thai"))
    beragam = keragaman_kuliner(_kul("h2", "indonesian", "japanese", "chinese",
                                     "thai", "korean", "italian"))
    assert seragam.iloc[0] < beragam.iloc[0]


def test_c04_satu_masakan_saja_bernilai_nol():
    """Nol di sini SAH - artinya 'diperiksa, dan memang cuma satu jenis'."""
    hasil = keragaman_kuliner(_kul("h1", "indonesian", "indonesian", "indonesian"))
    assert len(hasil) == 1
    assert hasil.iloc[0] == 0.0


def test_c04_satu_poi_boleh_membawa_beberapa_masakan():
    """`cuisine=indonesian;chinese` memang dua pilihan bagi yang lewat."""
    hasil = keragaman_kuliner(_kul("h1", "indonesian;chinese", "japanese", "thai"))
    assert hasil.iloc[0] > 0


def test_c04_mengabaikan_yang_bukan_kuliner():
    """Apotek dan bank tidak punya masakan, dan tidak boleh mengencerkan pangsa."""
    kul = _kul("h1", "indonesian", "japanese", "chinese")
    lain = pd.DataFrame(
        [{"h3_index": "h1", "kelas_induk": "S2", "cuisine": ""} for _ in range(30)]
    )
    hasil = keragaman_kuliner(pd.concat([kul, lain], ignore_index=True))
    assert len(hasil) == 1


def test_c04_tanpa_kolom_cuisine_tidak_meledak():
    """POI dari sumber lama (misi MAPID) belum tentu punya kolomnya."""
    assert keragaman_kuliner(
        pd.DataFrame([{"h3_index": "h1", "kelas_induk": "F1"}])
    ).empty


# ---------------------------------------------------------------------------
# D05 skor_simpul - dari relasi rute OSM
# ---------------------------------------------------------------------------


def _rel(oid, route, *refs, network="", ref=None):
    return {
        "type": "relation",
        "id": oid,
        "tags": {
            "type": "route",
            "route": route,
            "network": network,
            "ref": str(oid) if ref is None else ref,
        },
        "members": [
            {"type": "node", "ref": r, "role": "stop"} for r in refs
        ],
    }


def test_rute_hanya_menghitung_anggota_yang_BERHENTI():
    """Anggota berperan kosong adalah ruas jalan yang DILALUI. Kendaraan yang
    lewat tanpa berhenti tidak menurunkan satu pun calon pembeli."""
    r = _rel(1, "bus", 100)
    r["members"].append({"type": "way", "ref": 999, "role": ""})
    df = rute_dari_osm([r])
    assert list(df["ref"]) == ["node/100"]


def test_rute_transjakarta_dinaikkan_jadi_brt():
    df = rute_dari_osm([_rel(1, "bus", 100, network="Transjakarta")])
    assert df.iloc[0]["moda"] == "brt"


def test_rute_bus_biasa_tetap_bus():
    df = rute_dari_osm([_rel(1, "bus", 100, network="Angkot Kota")])
    assert df.iloc[0]["moda"] == "bus"


def test_d05_kereta_lebih_berat_daripada_bus():
    henti = henti_dari_osm([el(oid=100)])
    h3i = henti.iloc[0]["h3_index"]
    kereta = bobot_simpul(
        henti,
        rute_dari_osm([_rel(1, "train", 100, network="KAI Commuter")]),
        cincin=0,
    )
    bus = bobot_simpul(henti, rute_dari_osm([_rel(2, "bus", 100)]), cincin=0)
    assert kereta[h3i] > bus[h3i]


def test_rute_kereta_antarkota_dipisah_dari_komuter():
    """46 lin Argo/Bima yang lewat sekali sehari tidak boleh menenggelamkan
    4 lin KRL yang mengangkut ratusan ribu orang."""
    komuter = rute_dari_osm([_rel(1, "train", 100, network="KAI Commuter")])
    antarkota = rute_dari_osm([_rel(2, "train", 100, network="KAI")])
    assert komuter.iloc[0]["moda"] == "train"
    assert antarkota.iloc[0]["moda"] == "antarkota"


def test_d05_komuter_jauh_lebih_berat_daripada_antarkota():
    henti = henti_dari_osm([el(oid=100)])
    komuter = bobot_simpul(
        henti, rute_dari_osm([_rel(1, "train", 100, network="KAI Commuter")]), cincin=0
    )
    antarkota = bobot_simpul(
        henti, rute_dari_osm([_rel(2, "train", 100, network="KAI")]), cincin=0
    )
    assert komuter.iloc[0] > 3 * antarkota.iloc[0]


def test_d05_satu_rute_yang_berhenti_dua_kali_dihitung_sekali():
    """Koridor Transjakarta perhentiannya rapat - tanpa penjaga ini, satu
    koridor bisa terhitung tiga kali di heksagon yang sama."""
    henti = henti_dari_osm([el(oid=100), el(oid=101, lat=-6.2132, lon=106.8497)])
    assert henti["h3_index"].nunique() == 1, "kedua titik harus sekawan heksagon"
    dua_henti = bobot_simpul(henti, rute_dari_osm([_rel(1, "bus", 100, 101)]), cincin=0)
    satu_henti = bobot_simpul(
        henti, rute_dari_osm([_rel(1, "bus", 100)]), cincin=0
    )
    assert dua_henti.iloc[0] == satu_henti.iloc[0]


def test_d05_varian_arah_satu_lin_dihitung_sekali():
    """OSM memecah "Lin Lingkar Cikarang" jadi 14 relasi - full racket, half
    racket, tiap arah. Menghitung relasi membuat Stasiun Bekasi mengalahkan
    Dukuh Atas, dan itu terukur salah."""
    henti = henti_dari_osm([el(oid=100)])
    satu = bobot_simpul(henti, rute_dari_osm([_rel(1, "train", 100, ref="C")]), cincin=0)
    banyak = bobot_simpul(
        henti,
        rute_dari_osm([
            _rel(1, "train", 100, ref="C"),
            _rel(2, "train", 100, ref="C"),
            _rel(3, "train", 100, ref="C"),
        ]),
        cincin=0,
    )
    assert banyak.iloc[0] == satu.iloc[0]


def test_d05_relasi_tanpa_ref_tetap_dihitung_sendiri():
    """Satu relasi tak bernomor lebih baik jadi satu layanan daripada dilebur
    dengan setiap relasi tak bernomor lainnya."""
    henti = henti_dari_osm([el(oid=100)])
    df = rute_dari_osm([_rel(1, "bus", 100, ref=""), _rel(2, "bus", 100, ref="")])
    assert df["lin"].nunique() == 2


def test_d05_dua_rute_berbeda_menjumlah():
    henti = henti_dari_osm([el(oid=100)])
    satu = bobot_simpul(henti, rute_dari_osm([_rel(1, "bus", 100)]), cincin=0)
    dua = bobot_simpul(
        henti,
        rute_dari_osm([_rel(1, "bus", 100, ref="1"), _rel(2, "bus", 100, ref="2")]),
        cincin=0,
    )
    assert dua.iloc[0] == 2 * satu.iloc[0]


def test_d05_cincin_menjangkau_tetangga():
    """Halte 200 m di seberang batas heksagon tetap melayani lokasi ini."""
    henti = henti_dari_osm([el(oid=100)])
    pusat = henti.iloc[0]["h3_index"]
    tetangga = [c for c in h3.grid_disk(pusat, 1) if c != pusat][0]
    hasil = bobot_simpul(henti, rute_dari_osm([_rel(1, "bus", 100)]), cincin=1)
    assert hasil[tetangga] > 0
    assert hasil[pusat] > 0


def test_d05_heksagon_tanpa_rute_jadi_nol_bukan_kosong():
    """Overpass ditanyai disc yang menutup seluruh 708 heksagon, jadi nol di
    sini memang temuan - kebalikan dari data misi."""
    henti = henti_dari_osm([el(oid=100)])
    jauh = h3.latlng_to_cell(-6.9, 106.4, 9)
    semua = pd.Index([henti.iloc[0]["h3_index"], jauh])
    hasil = bobot_simpul(
        henti, rute_dari_osm([_rel(1, "bus", 100)]), semua_hex=semua, cincin=0
    )
    assert hasil[jauh] == 0.0
    assert not hasil.isna().any()


def test_d05_tanpa_data_tidak_meledak():
    kosong = pd.DataFrame(columns=["ref", "h3_index", "lat", "lon"])
    assert bobot_simpul(kosong, kosong).empty


def test_henti_dan_rute_memakai_bentuk_ref_yang_sama():
    """Kalau salah satunya menyimpan id telanjang, penyatuannya menghasilkan
    nol baris - dan nol itu terbaca sebagai 'tidak ada angkutan umum di sini'."""
    henti = henti_dari_osm([el(oid=100)])
    rute = rute_dari_osm([_rel(1, "bus", 100)])
    assert set(rute["ref"]) & set(henti["ref"]) == {"node/100"}


if __name__ == "__main__":
    lolos = gagal = 0
    for nama, fn in sorted(globals().items()):
        if not nama.startswith("test_"):
            continue
        try:
            fn()
            print(f"  PASS  {nama}")
            lolos += 1
        except AssertionError as e:
            print(f"  FAIL  {nama}: {e}")
            gagal += 1

    print(f"\n{lolos} lolos, {gagal} gagal\n")

    p = profil_jam(contoh_struk(), contoh_hex())
    print("Contoh Commuter Clock (heksagon condong captive vs condong choice):")
    banding = p[p["h3_index"].isin([HEX[0], HEX[2]])].pivot(
        index="jam", columns="h3_index", values="pangsa_captive"
    )
    banding.columns = ["kos (captive)", "kantor (choice)"]
    print(banding.to_string())
