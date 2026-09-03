"""Data demo LENGKAP untuk pameran — dan cara mencopotnya kembali dengan tepat.

BACA INI SEBELUM MENJALANKANNYA
===============================

Skrip ini MENGARANG angka. Ia ada untuk satu keperluan saja: pameran, tempat
seluruh fitur peta harus bisa diperagakan padahal sebagian besar variabelnya
belum punya sumber. Ia BUKAN pengganti data, dan hasilnya tidak boleh ikut ke
mana pun yang menyebut dirinya hasil pengukuran.

Bedanya dengan `demo_seed.py`, dan kenapa berkas ini terpisah:

    demo_seed.py    membangun SELURUH basis data dari nol. Ia MENOLAK jalan
                    kalau ada rute ORS atau POI OSM, dan `--paksa` membuangnya.
                    Basis data sekarang memuat 1.549 rute dan 3.444 POI yang
                    butuh berjam-jam ditarik, jadi ia tidak bisa dipakai lagi.

    demo_pameran.py MENAMBAL. Ia hanya menyentuh sel yang KOSONG, tidak pernah
                    menimpa satu pun angka yang sudah ada, dan mencatat persis
                    apa yang disentuhnya supaya bisa dicabut kembali.

YANG MEMBUATNYA BISA DICABUT
============================

`--isi` menulis manifes ke `data/demo_pameran/`:

    sel_kosong.json     tiap kolom -> daftar h3 yang TADINYA NULL
    penanda_lama.json   nilai lama n_titik_misi / tingkat_keyakinan /
                        data_source, karena ketiganya DITIMPA, bukan diisi
    skor_lama.json      seluruh location_scores + score_factors sebelum diubah
    baris_baru.json     id baris yang DIBUAT di hex_routes & catchment_areas

`--copot` membaca keempatnya dan mengembalikan keadaan persis seperti semula.
Tanpa manifes ia MENOLAK jalan - menebak mana yang demo dan mana yang asli
adalah cara kehilangan data asli.

ANGKANYA TIDAK ACAK
===================

Tiap nilai diturunkan dari sinyal yang SUDAH ada dan nyata di heksagon itu:
jarak ke simpul, penduduk WorldPop, jumlah POI OSM, kompetitor terpetakan.
Dua akibatnya disengaja. Pertama, petanya punya pola yang masuk akal - mahal di
dekat stasiun, sepi di pinggir - alih-alih bintik acak yang langsung ketahuan
palsu. Kedua, ia REPRODUSIBEL: benih diturunkan dari h3_index, jadi menjalankan
ulang menghasilkan angka yang sama persis.

Skornya sendiri TIDAK dikarang. Variabel mentahnya diisi, lalu
`s7_publish.hitung_ulang_dari_db()` menjalankan mesin skor yang sama persis
dengan yang memproses data sungguhan. Aturan 1 tetap utuh.

    cd pipeline && python demo_pameran.py --isi
    cd pipeline && python demo_pameran.py --status
    cd pipeline && python demo_pameran.py --copot
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from config import JAM_OPERASIONAL, KEYAKINAN_TINGGI_MIN, tingkat_keyakinan
from s7_publish import _mesin, hitung_ulang_dari_db

JEJAK = Path(__file__).parent / "data" / "demo_pameran"

#: Ditulis ke `hex_hourly_profiles.metode`.
#:
#: "proxy", bukan "pameran", dan bukan karena panjangnya. `schemas.TitikJam`
#: mengunci kolom ini ke `Literal["observed", "proxy"]`, jadi nilai lain
#: melewati basis data dengan mulus lalu MELEDAK di validasi respons - Commuter
#: Clock menjawab 500 untuk seluruh heksagon, dan sebabnya cuma terlihat di
#: traceback backend. Batas varchar(10) sudah menolak "demo_pameran" (12)
#: sebelumnya; ini penolakan KEDUA dari lapisan yang berbeda atas kolom yang
#: sama.
#:
#: "proxy" juga label yang benar: profil jam ini memang turunan, bukan struk
#: yang teramati.
#:
#: Karena "proxy" bisa saja dipakai baris SUNGGUHAN suatu hari, baris demo
#: TIDAK dikenali lewat kolom ini saat dicopot - id-nya dicatat di manifes,
#: sama seperti hex_routes dan catchment_areas.
PENANDA = "proxy"


# ---------------------------------------------------------------------------
# Angka yang reprodusibel
# ---------------------------------------------------------------------------


def _benih(h3: str, kunci: str) -> float:
    """0..1 yang tetap sama untuk (heksagon, kolom) yang sama.

    Bukan `random.seed()`: benih global membuat urutan pemanggilan menentukan
    hasilnya, jadi menambah satu kolom di tengah menggeser seluruh angka
    sesudahnya. Hash per-sel tidak punya urutan sama sekali.
    """
    h = hashlib.blake2b(f"{h3}|{kunci}".encode(), digest_size=8).digest()
    return int.from_bytes(h, "big") / 2**64


def _antara(h3: str, kunci: str, lo: float, hi: float) -> float:
    return lo + (hi - lo) * _benih(h3, kunci)


def _goyang(h3: str, kunci: str, kekuatan: float = 0.25) -> float:
    """Pengali di sekitar 1,0. Memberi sebaran tanpa menghapus polanya."""
    return 1.0 + (_benih(h3, kunci) - 0.5) * 2 * kekuatan


# ---------------------------------------------------------------------------
# Isi
# ---------------------------------------------------------------------------


def _baca_dasar(db) -> list[dict]:
    """Sinyal nyata yang jadi dasar seluruh angka karangan di bawah."""
    return [
        dict(r)
        for r in db.execute(
            text(
                """
                SELECT h3_index, kawasan,
                       jarak_simpul_m, waktu_jalan_menit, pop_100m,
                       n_kompetitor_langsung, kepadatan_poi_total,
                       kepadatan_kantor, generator_keramaian, skor_simpul,
                       rasio_tutupan_bangunan, luas_bangunan_median,
                       zona_izin_komersial, kelas_zona, risiko_banjir
                FROM hex_features
                ORDER BY h3_index
                """
            )
        ).mappings()
    ]


def _nilai_demo(b: dict) -> dict[str, object]:
    """Seluruh variabel yang mungkin kosong, diturunkan dari sinyal nyata."""
    h3 = b["h3_index"]

    # --- Dua sumbu yang menggerakkan hampir semuanya ------------------------
    # `dekat` 1,0 tepat di simpul dan meluruh sampai 0 pada 2,5 km. Itu yang
    # membuat harga, keramaian, dan NJOP punya pola menuju stasiun alih-alih
    # tersebar acak.
    jarak = b["jarak_simpul_m"]
    if jarak is None:
        jarak = _antara(h3, "jarak", 300, 2400)
    dekat = max(0.0, min(1.0, 1.0 - jarak / 2500.0))

    pop = b["pop_100m"]
    if pop is None:
        pop = _antara(h3, "pop", 400, 5200)
    padat = max(0.0, min(1.0, pop / 6000.0))

    poi = b["kepadatan_poi_total"] or 0
    komp = b["n_kompetitor_langsung"] or 0
    ramai = max(0.0, min(1.0, (poi / 60.0) * 0.6 + dekat * 0.4))

    # --- Empat puncak jam, dijamin berjumlah 1 ------------------------------
    # Dibangkitkan lalu dinormalkan, bukan diambil dari empat undian bebas:
    # empat angka bebas nyaris tidak pernah berjumlah 1, dan tampilan Commuter
    # Clock membacanya sebagai porsi.
    mentah = [
        0.9 + _benih(h3, "pagi") * 1.4 + dekat * 0.8,
        0.7 + _benih(h3, "siang") * 1.2,
        1.0 + _benih(h3, "sore") * 1.5 + dekat * 0.9,
        0.4 + _benih(h3, "malam") * 1.1,
    ]
    jum = sum(mentah)
    pagi, siang, sore, malam = (x / jum for x in mentah)

    # --- Uang ---------------------------------------------------------------
    # Sewa per m2 mengikuti kedekatan simpul dan keramaian; sewa bulanan
    # diturunkan DARINYA lewat luas, bukan diundi sendiri - kalau keduanya
    # diundi terpisah, rasionya jadi tidak masuk akal dan itu terlihat.
    sewa_m2 = (55_000 + 340_000 * dekat**1.4 + 90_000 * ramai) * _goyang(h3, "sewa", 0.22)
    luas = b["luas_bangunan_median"] or _antara(h3, "luas", 42, 130)
    sewa_bulan = sewa_m2 * max(18.0, min(120.0, luas * 0.55))
    njop = (2_100_000 + 12_500_000 * dekat**1.5 + 2_000_000 * padat) * _goyang(h3, "njop", 0.2)
    porsi = (12_000 + 26_000 * dekat + 9_000 * ramai) * _goyang(h3, "porsi", 0.28)
    struk = porsi * _antara(h3, "keranjang", 1.4, 2.9)
    per_jam = struk * (4 + 26 * ramai) * _goyang(h3, "perjam", 0.3)

    return {
        # --- Permintaan -----------------------------------------------------
        "pop_100m": round(pop),
        "pop_usia_produktif": round(pop * _antara(h3, "usia", 0.58, 0.71)),
        "jarak_simpul_m": round(jarak, 1),
        "waktu_jalan_menit": round(jarak / 72.0, 1),  # ~4,3 km/jam
        "ridership_proksi": round(1_400 + 46_000 * dekat**1.3 * _goyang(h3, "rider", 0.3)),
        "kepadatan_kos": round(_antara(h3, "kos", 0.4, 9.5) * (0.35 + padat), 2),
        # --- Aktivitas ------------------------------------------------------
        "skor_ramai_terkoreksi": round(0.18 + 0.74 * ramai * _goyang(h3, "ramai", 0.18), 3),
        "intensitas_transaksi": round((8 + 190 * ramai) * _goyang(h3, "intens", 0.3), 1),
        "aktivitas_komunitas": round(_antara(h3, "komunitas", 0.12, 0.88), 3),
        "puncak_pagi": round(pagi, 3),
        "puncak_siang": round(siang, 3),
        "puncak_sore": round(sore, 3),
        "puncak_malam": round(malam, 3),
        "rasio_weekend": round(_antara(h3, "weekend", 0.62, 1.48), 3),
        "pangsa_digital": round(_antara(h3, "digital", 18, 82) * (0.55 + 0.6 * dekat), 1),
        # --- Uang -----------------------------------------------------------
        "harga_median_porsi": round(porsi, -2),
        "spread_harga": round(_antara(h3, "spread", 0.22, 0.78), 3),
        "nominal_median_struk": round(struk, -2),
        "belanja_per_jam": round(per_jam, -3),
        "harga_sewa_median": round(sewa_bulan, -4),
        "harga_sewa_per_m2": round(sewa_m2, -2),
        # --- Kompetisi ------------------------------------------------------
        "keragaman_usaha": round(_antara(h3, "ragam", 0.28, 0.93), 3),
        "keragaman_kuliner": round(_antara(h3, "ragamkul", 0.2, 0.9), 3),
        "pangsa_waralaba": round(_antara(h3, "waralaba", 2, 34) * (0.5 + dekat), 1),
        "rasio_kompetitor_per_kapita": round((komp + 1) / max(pop, 1) * 1000, 3),
        "rasio_keliling": round(_antara(h3, "keliling", 0.08, 0.42), 3),
        "n_menetap_kuliner": round(_antara(h3, "menetap", 1, 14) * (0.4 + ramai)),
        # --- Biaya & risiko --------------------------------------------------
        "njop_m2": round(njop, -3),
        "njop_persentil": round(_antara(h3, "njoppst", 8, 96) * (0.45 + 0.6 * dekat), 1),
        "pasokan_sewa_komersial": round(_antara(h3, "pasokan", 1, 22) * (0.4 + ramai)),
        "rasio_sewa_jual": round(_antara(h3, "sewajual", 0.035, 0.098), 4),
        # Churn sengaja MIRING ke bawah: kalau setengah peta berperingatan,
        # RiskRadar berhenti berarti apa pun. ~12% saja yang lewat ambang 0,30.
        "indeks_churn": round(_benih(h3, "churn") ** 2.6 * 0.72, 3),
        # --- Bentuk & prestise ------------------------------------------------
        "luas_bangunan_median": round(luas, 1),
        "skor_prestise_visual": round(
            max(0.02, min(0.98, 0.2 + 0.55 * dekat + 0.25 * _benih(h3, "prestise"))), 3
        ),
    }


def _zona_demo(b: dict) -> dict[str, object]:
    """ZoneGuard: yang kosong diberi status, bukan dibiarkan 'belum pasti'.

    ~6% dibuat TERLARANG dengan sengaja. Menjadikan seluruh peta "boleh" akan
    membuat ZoneGuard - salah satu fitur yang paling layak diperagakan -
    tidak punya satu pun contoh untuk ditunjukkan.
    """
    h3 = b["h3_index"]
    u = _benih(h3, "zona")
    boleh = u > 0.06
    kelas = (
        "Zona Perdagangan dan Jasa"
        if u > 0.42
        else "Zona Campuran"
        if u > 0.20
        else "Zona Perumahan"
        if u > 0.06
        else "Zona Pertahanan dan Keamanan"
    )
    return {
        "zona_izin_komersial": boleh,
        "kelas_zona": kelas,
        "risiko_banjir": round(_benih(h3, "banjir") ** 2 * 0.85, 3),
    }


def _profil_jam(b: dict, nilai: dict) -> list[dict]:
    """18 baris per heksagon, 05.00-22.00. Bentuknya dua punuk, bukan datar."""
    h3 = b["h3_index"]
    per_jam = float(nilai["belanja_per_jam"])
    median = float(nilai["nominal_median_struk"])
    baris = []
    for jam in JAM_OPERASIONAL:
        # Dua punuk: berangkat kerja dan pulang kerja. Itu bentuk yang
        # sebenarnya di sekitar simpul transit, dan ia yang membuat grafik
        # Commuter Clock bercerita alih-alih jadi pagar rata.
        pagi = math.exp(-(((jam - 7.4) / 1.5) ** 2))
        sore = math.exp(-(((jam - 18.1) / 1.9) ** 2))
        siang = 0.42 * math.exp(-(((jam - 12.5) / 2.1) ** 2))
        bentuk = 0.10 + pagi * 0.95 + sore * 1.0 + siang
        bentuk *= _goyang(h3, f"jam{jam}", 0.12)
        n = max(1, round(bentuk * (4 + 34 * float(nilai["skor_ramai_terkoreksi"]))))
        baris.append(
            {
                "h3_index": h3,
                "jam": jam,
                "n_transaksi": n,
                "nominal_total": round(n * median, -2),
                "nominal_median": round(median * _goyang(h3, f"med{jam}", 0.15), -2),
                # Captive = orang yang memang lewat simpul itu. Paling tinggi
                # saat jam berangkat dan pulang, paling rendah tengah hari.
                "pangsa_captive": round(
                    max(0.05, min(0.95, 0.30 + 0.45 * max(pagi, sore) - 0.15 * siang)), 3
                ),
                "metode": PENANDA,
            }
        )
        _ = per_jam
    return baris


# ---------------------------------------------------------------------------
# Perintah
# ---------------------------------------------------------------------------

#: Kolom yang boleh ditambal. Ditulis TETAP, bukan diturunkan dari
#: `KODE_KE_KOLOM`: yang boleh dikarang adalah keputusan, bukan konsekuensi.
KOLOM_TAMBAL = (
    "pop_100m", "pop_usia_produktif", "jarak_simpul_m", "waktu_jalan_menit",
    "ridership_proksi", "kepadatan_kos", "skor_ramai_terkoreksi",
    "intensitas_transaksi", "aktivitas_komunitas", "puncak_pagi", "puncak_siang",
    "puncak_sore", "puncak_malam", "rasio_weekend", "pangsa_digital",
    "harga_median_porsi", "spread_harga", "nominal_median_struk",
    "belanja_per_jam", "harga_sewa_median", "harga_sewa_per_m2",
    "keragaman_usaha", "keragaman_kuliner", "pangsa_waralaba",
    "rasio_kompetitor_per_kapita", "rasio_keliling", "n_menetap_kuliner",
    "njop_m2", "njop_persentil", "pasokan_sewa_komersial", "rasio_sewa_jual",
    "indeks_churn", "luas_bangunan_median", "skor_prestise_visual",
    "zona_izin_komersial", "kelas_zona", "risiko_banjir",
)


def isi(db) -> None:
    if (JEJAK / "sel_kosong.json").exists():
        raise SystemExit(
            "Manifes demo sudah ada - data demo tampaknya masih terpasang.\n"
            "Jalankan `python demo_pameran.py --copot` dulu."
        )
    JEJAK.mkdir(parents=True, exist_ok=True)

    dasar = _baca_dasar(db)
    print(f"  {len(dasar)} heksagon dibaca\n")

    # --- 1. Cadangkan yang akan DITIMPA ------------------------------------
    penanda_lama = [
        dict(r)
        for r in db.execute(
            text("SELECT h3_index, n_titik_misi, tingkat_keyakinan, data_source FROM hex_features")
        ).mappings()
    ]
    (JEJAK / "penanda_lama.json").write_text(json.dumps(penanda_lama), encoding="utf-8")

    skor_lama = {
        "location_scores": [
            dict(r) for r in db.execute(text("SELECT * FROM location_scores")).mappings()
        ],
        "score_factors": [
            dict(r) for r in db.execute(text("SELECT * FROM score_factors")).mappings()
        ],
    }
    for baris in skor_lama.values():
        for x in baris:
            x.pop("dihitung_pada", None)
    (JEJAK / "skor_lama.json").write_text(json.dumps(skor_lama, default=str), encoding="utf-8")
    print(f"  dicadangkan: {len(skor_lama['location_scores'])} skor, "
          f"{len(skor_lama['score_factors'])} faktor, {len(penanda_lama)} penanda")

    # --- 2. Sel mana yang KOSONG ------------------------------------------
    sel_kosong: dict[str, list[str]] = {}
    for kol in KOLOM_TAMBAL:
        kosong = [
            r[0]
            for r in db.execute(
                text(f"SELECT h3_index FROM hex_features WHERE {kol} IS NULL")
            ).all()
        ]
        if kosong:
            sel_kosong[kol] = kosong
    total_sel = sum(len(v) for v in sel_kosong.values())
    print(f"  {total_sel} sel kosong di {len(sel_kosong)} kolom\n")

    # --- 3. Tambal, HANYA yang kosong ---------------------------------------
    #
    # BERKELOMPOK per kolom, bukan satu UPDATE per heksagon.
    #
    # Versi pertama mengirim satu pernyataan per heksagon lalu 12.744 sisipan
    # satu-satu untuk profil jam. Supabase memutus koneksinya di tengah jalan
    # ("server closed the connection unexpectedly") - bukan karena datanya
    # salah, melainkan karena puluhan ribu perjalanan bolak-balik ke basis data
    # terkelola memang melewati batas waktunya. Transaksinya ter-rollback bersih
    # dan tidak ada yang rusak, tetapi tidak ada juga yang terisi.
    #
    # `executemany` mengirim satu pernyataan dengan banyak baris parameter.
    # Jumlah perjalanannya turun dari puluhan ribu jadi puluhan.
    nilai_semua = {b["h3_index"]: {**_nilai_demo(b), **_zona_demo(b)} for b in dasar}
    for kol, daftar in sel_kosong.items():
        muatan = [
            {"h3": h3, "v": nilai_semua[h3][kol]}
            for h3 in daftar
            if kol in nilai_semua.get(h3, {})
        ]
        if not muatan:
            continue
        db.execute(text(f"UPDATE hex_features SET {kol} = :v WHERE h3_index = :h3"), muatan)
    print(f"  {len(sel_kosong)} kolom ditambal berkelompok")

    # --- 4. Penanda survei -------------------------------------------------
    # Ditimpa, bukan ditambal: ketiganya sudah punya nilai. Inilah yang membuat
    # seluruh lencana berhenti berbunyi "Data tipis" dan panel berhenti menulis
    # "heksagon ini belum disurvei langsung".
    muatan = []
    for b in dasar:
        h3 = b["h3_index"]
        n = KEYAKINAN_TINGGI_MIN + round(_antara(h3, "titik", 4, 78))
        muatan.append({"n": n, "t": tingkat_keyakinan(n), "h3": h3})
    db.execute(
        text(
            """
            UPDATE hex_features
            SET n_titik_misi = :n, tingkat_keyakinan = :t, data_source = 'observed'
            WHERE h3_index = :h3
            """
        ),
        muatan,
    )
    print(f"  {len(dasar)} heksagon ditandai observed, keyakinan TINGGI")

    # --- 5. Profil jam -----------------------------------------------------
    sebelum_jam = {r[0] for r in db.execute(text("SELECT id FROM hex_hourly_profiles")).all()}
    # SATU pembacaan untuk seluruh heksagon, bukan satu per heksagon. Yang lama
    # mengirim 708 SELECT hanya untuk membaca kembali angka yang baru saja
    # ditulisnya sendiri di langkah 3.
    segar = {
        r["h3_index"]: dict(r)
        for r in db.execute(
            text(
                "SELECT h3_index, belanja_per_jam, nominal_median_struk, "
                "skor_ramai_terkoreksi FROM hex_features"
            )
        ).mappings()
    }
    muatan = []
    for b in dasar:
        muatan.extend(_profil_jam(b, segar[b["h3_index"]]))
    SISIP_JAM = text(
        """
        INSERT INTO hex_hourly_profiles
            (h3_index, jam, n_transaksi, nominal_total, nominal_median,
             pangsa_captive, metode)
        VALUES (:h3_index, :jam, :n_transaksi, :nominal_total,
                :nominal_median, :pangsa_captive, :metode)
        """
    )
    # Dipotong 2.000 baris per kirim. Satu executemany berisi 12.744 baris
    # bekerja juga, tetapi potongan membuat kegagalan jaringan berhenti di
    # potongan itu alih-alih membatalkan seluruhnya sesudah menunggu lama.
    for i in range(0, len(muatan), 2000):
        db.execute(SISIP_JAM, muatan[i : i + 2000])
    jam_baru = [
        r[0]
        for r in db.execute(text("SELECT id FROM hex_hourly_profiles")).all()
        if r[0] not in sebelum_jam
    ]
    print(f"  {len(jam_baru)} baris profil jam")

    # --- 6. Rute mobil, dicerminkan dari rute jalan kaki ---------------------
    # Geometrinya SAMA. Itu disengaja dan jujur di dalam konteks demo: yang
    # diperagakan bahwa produknya bisa membedakan dua profil, bukan bahwa kami
    # punya jaringan jalan mobil. Waktunya dibagi 3,4 - mobil di jalan kota
    # Jabodetabek kira-kira 15 km/jam melawan 4,3 km/jam jalan kaki.
    sebelum_rute = {r[0] for r in db.execute(text("SELECT id FROM hex_routes")).all()}
    db.execute(
        text(
            """
            INSERT INTO hex_routes
                (h3_index, transport_node_id, urutan, jarak_m, menit, geom, profil)
            SELECT h3_index, transport_node_id, urutan, jarak_m, menit / 3.4, geom,
                   'driving-car'
            FROM hex_routes WHERE profil = 'foot-walking'
            ON CONFLICT DO NOTHING
            """
        )
    )
    rute_baru = [
        r[0]
        for r in db.execute(text("SELECT id FROM hex_routes")).all()
        if r[0] not in sebelum_rute
    ]
    print(f"  {len(rute_baru)} rute mobil")

    # --- 7. Pita isochrone 30 & 60 menit ------------------------------------
    # Dibuat dengan MEMBESARKAN pita 15 menit lewat ST_Buffer, bukan diundi:
    # pita yang tidak bersarang di dalam pita berikutnya akan langsung terlihat
    # salah, dan `smoke_api.py` memang mengujinya.
    sebelum_iso = {r[0] for r in db.execute(text("SELECT id FROM catchment_areas")).all()}
    for menit, skala in ((30, 0.0092), (60, 0.0235)):
        db.execute(
            text(
                """
                INSERT INTO catchment_areas (transport_node_id, menit, geom)
                SELECT transport_node_id, :menit,
                       ST_MakeValid(ST_Buffer(geom, :skala))
                FROM catchment_areas WHERE menit = 15
                ON CONFLICT DO NOTHING
                """
            ),
            {"menit": menit, "skala": skala},
        )
    iso_baru = [
        r[0]
        for r in db.execute(text("SELECT id FROM catchment_areas")).all()
        if r[0] not in sebelum_iso
    ]
    print(f"  {len(iso_baru)} pita isochrone 30/60 menit")

    (JEJAK / "sel_kosong.json").write_text(json.dumps(sel_kosong), encoding="utf-8")
    (JEJAK / "baris_baru.json").write_text(
        json.dumps(
            {
                "hex_routes": rute_baru,
                "catchment_areas": iso_baru,
                "hex_hourly_profiles": jam_baru,
            }
        ),
        encoding="utf-8",
    )

    # --- 8. Skor dihitung ULANG oleh mesin yang sama -------------------------
    hasil = hitung_ulang_dari_db(db)
    print(f"\n  skor dihitung ulang: {hasil['skor']} baris, {hasil['faktor']} faktor")
    print(f"  manifes -> {JEJAK}")


def copot(db) -> None:
    if not (JEJAK / "sel_kosong.json").exists():
        raise SystemExit(
            f"Manifes tidak ada di {JEJAK}.\n"
            "Tanpa manifes, mana yang demo dan mana yang asli tidak bisa dibedakan - "
            "dan menebaknya berarti membuang data asli. Dibatalkan."
        )

    sel_kosong = json.loads((JEJAK / "sel_kosong.json").read_text(encoding="utf-8"))
    penanda_lama = json.loads((JEJAK / "penanda_lama.json").read_text(encoding="utf-8"))
    baris_baru = json.loads((JEJAK / "baris_baru.json").read_text(encoding="utf-8"))
    skor_lama = json.loads((JEJAK / "skor_lama.json").read_text(encoding="utf-8"))

    # --- 1. Sel yang ditambal dikosongkan kembali ---------------------------
    n_sel = 0
    for kol, daftar in sel_kosong.items():
        for i in range(0, len(daftar), 200):
            potong = daftar[i : i + 200]
            db.execute(
                text(f"UPDATE hex_features SET {kol} = NULL WHERE h3_index = ANY(:h)"),
                {"h": potong},
            )
            n_sel += len(potong)
    print(f"  {n_sel} sel dikosongkan kembali")

    # --- 2. Penanda survei dikembalikan -------------------------------------
    db.execute(
        text(
            """
            UPDATE hex_features
            SET n_titik_misi = :n_titik_misi,
                tingkat_keyakinan = :tingkat_keyakinan,
                data_source = :data_source
            WHERE h3_index = :h3_index
            """
        ),
        penanda_lama,
    )
    print(f"  {len(penanda_lama)} penanda survei dikembalikan")

    # --- 3. Baris yang DIBUAT dihapus ---------------------------------------
    for tabel, ids in baris_baru.items():
        if ids:
            db.execute(text(f"DELETE FROM {tabel} WHERE id = ANY(:i)"), {"i": ids})
            print(f"  {len(ids)} baris {tabel} dihapus")
    # Profil jam ikut dihapus MENURUT ID lewat `baris_baru` di atas, bukan
    # menurut `metode` - lihat alasannya di komentar PENANDA.

    # --- 4. Skor dikembalikan APA ADANYA ------------------------------------
    # Bukan dihitung ulang: menghitung ulang dari variabel yang baru dikosongkan
    # memang mendekati keadaan semula, tetapi "mendekati" bukan "sama", dan
    # peringkat yang bergeser diam-diam adalah persis yang tidak boleh terjadi.
    db.execute(text("DELETE FROM score_factors"))
    db.execute(text("DELETE FROM location_scores"))
    for nama in ("location_scores", "score_factors"):
        baris = skor_lama[nama]
        if not baris:
            continue
        kolom = [k for k in baris[0] if k != "id"]
        sisip = ", ".join(kolom)
        nilai = ", ".join(f":{k}" for k in kolom)
        pernyataan = text(f"INSERT INTO {nama} ({sisip}) VALUES ({nilai})")
        muatan = [{k: x[k] for k in kolom} for x in baris]
        for i in range(0, len(muatan), 2000):
            db.execute(pernyataan, muatan[i : i + 2000])
        print(f"  {len(baris)} baris {nama} dikembalikan")

    for f in JEJAK.glob("*.json"):
        f.unlink()
    print(f"\n  manifes dihapus. Basis data kembali ke keadaan sebelum demo.")


def status(db) -> None:
    ada = (JEJAK / "sel_kosong.json").exists()
    print(f"\n  data demo terpasang: {'YA' if ada else 'tidak'}")
    if ada:
        sel = json.loads((JEJAK / "sel_kosong.json").read_text(encoding="utf-8"))
        print(f"  {sum(len(v) for v in sel.values())} sel di {len(sel)} kolom bisa dicopot")

    print()
    for label, q in (
        ("heksagon", "SELECT count(*) FROM hex_features"),
        ("berskor", "SELECT count(*) FROM location_scores"),
        ("profil jam", "SELECT count(*) FROM hex_hourly_profiles"),
        ("rute jalan kaki", "SELECT count(*) FROM hex_routes WHERE profil='foot-walking'"),
        ("rute mobil", "SELECT count(*) FROM hex_routes WHERE profil='driving-car'"),
        ("pita isochrone", "SELECT count(*) FROM catchment_areas"),
        ("keyakinan TINGGI", "SELECT count(*) FROM hex_features WHERE tingkat_keyakinan='TINGGI'"),
        ("punya harga sewa", "SELECT count(*) FROM hex_features WHERE harga_sewa_per_m2 IS NOT NULL"),
        ("punya churn", "SELECT count(*) FROM hex_features WHERE indeks_churn IS NOT NULL"),
    ):
        print(f"  {label:20s} {db.execute(text(q)).scalar_one():6d}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--isi", action="store_true", help="tambal seluruh sel kosong")
    ap.add_argument("--copot", action="store_true", help="kembalikan persis seperti semula")
    ap.add_argument("--status", action="store_true", help="lihat keadaan, tanpa mengubah")
    a = ap.parse_args()

    db = sessionmaker(bind=_mesin())()
    try:
        if a.status:
            status(db)
        elif a.isi:
            isi(db)
            db.commit()
            status(db)
        elif a.copot:
            copot(db)
            db.commit()
            status(db)
        else:
            ap.print_help()
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
