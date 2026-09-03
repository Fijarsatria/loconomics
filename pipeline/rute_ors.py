"""Jalan kaki di sekitar simpul transportasi, lewat OpenRouteService.

DUA HAL, satu berkas, karena keduanya memakai layanan dan kunci yang sama:

  RUTE       jalur heksagon -> simpul terdekat        -> tabel `hex_routes`
  ISOCHRONE  kawasan yang tercapai 5/10/15 menit      -> tabel `catchment_areas`

Bedanya bukan cuma bentuk. Rute itu GARIS: "dari sini, ke sana, lewat mana".
Isochrone itu BIDANG: "sejauh mana orang sampai dari stasiun dalam 10 menit" -
dan bidang itulah yang tidak boleh pernah digambar sebagai lingkaran.

Dijalankan MANUAL, offline, sesekali - bukan bagian dari s1..s7 dan bukan bagian
dari permintaan HTTP mana pun.

KENAPA BERKAS SENDIRI, bukan di dalam s4_spatial.py. s4 bekerja atas DataFrame
dan tidak menyentuh basis data sama sekali; tahap ini kebalikannya - ia membaca
geometri dari PostGIS, memanggil layanan jaringan, lalu menulis balik ke PostGIS.
Menyatukannya berarti s4 tidak bisa lagi diuji tanpa basis data dan tanpa kunci
API, padahal test_s4_spatial.py justru bernilai karena tidak butuh keduanya.

KENAPA GARIS LURUS TIDAK CUKUP. Diukur di Manggarai: satu titik berjarak 830 m
garis lurus dari stasiun ternyata 1.418 m berjalan kaki - 1,7 kali lipat, karena
rel memotong jalan yang di peta kelihatan lurus. Angka 830 m itu bukan sekadar
kurang tepat; ia menjawab pertanyaan yang tidak pernah ditanyakan siapa pun.
Tidak ada yang berjalan menembus rel.

KUOTA. Paket gratis ORS: 2.000 permintaan directions per hari, 40 per menit.
Satu heksagon = satu permintaan, dan satu permintaan mengembalikan rute tercepat
BESERTA alternatifnya sekaligus. 708 heksagon muat dalam sehari dengan sisa
banyak. Skrip ini melambatkan dirinya sendiri ke bawah batas per menit dan
melewati heksagon yang rutenya sudah ada, jadi menjalankannya ulang sesudah
terputus tidak membayar ulang apa pun.

Pemakaian:

    cd pipeline
    python rute_ors.py                 # yang belum punya rute saja
    python rute_ors.py --kawasan Manggarai
    python rute_ors.py --ulang         # hitung ulang semuanya
    python rute_ors.py --batas 20      # coba sedikit dulu
    python rute_ors.py --status        # tidak memanggil ORS sama sekali
    python rute_ors.py --rapikan       # jahit ujung + urutkan, juga tanpa ORS
    python rute_ors.py --isochrone     # kawasan jangkau 5/10/15 menit tiap simpul
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# Backend yang memiliki model dan koneksinya; pipeline meminjam, tidak menyalin.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import delete, func, select, text  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.models import CatchmentArea, HexRoute  # noqa: E402

URL_ORS = "https://api.openrouteservice.org/v2/directions/{profil}/geojson"

#: Profil yang boleh ditarik, beserta batas kewajaran jaraknya masing-masing.
#:
#: MOTOR TIDAK ADA, dan itu bukan kelalaian: OpenRouteService tidak menyediakan
#: profil sepeda motor. Menyodorkan `driving-car` sebagai "kira-kira motor"
#: akan salah ke arah yang paling merugikan - motor melewati gang yang mobil
#: tidak bisa, jadi rute mobil MELEBIH-LEBIHKAN jaraknya. Lebih baik tidak ada
#: daripada ada dan menyesatkan.
PROFIL_JALAN = "foot-walking"
PROFIL_MOBIL = "driving-car"

#: Profil yang SEDANG ditarik. Disetel sekali di `main()` dari benderanya.
#: Modul-level supaya `minta_rute` dan `simpan` tidak perlu meneruskannya
#: lewat lima lapis pemanggilan yang tidak memakainya untuk apa pun selain
#: meneruskan.
PROFIL = PROFIL_JALAN

#: Batas ORS 40/menit. 1,7 dtk memberi ~35/menit - cukup di bawah batas supaya
#: satu permintaan yang kebetulan lambat tidak mendorong yang berikutnya lewat.
JEDA_DETIK = 1.7

#: Berapa alternatif yang diminta. ORS mengembalikan lebih sedikit kalau memang
#: tidak ada jalur lain yang cukup berbeda - itu jawaban yang sah, bukan galat.
#: `share_factor` 0,6 = alternatif boleh berbagi paling banyak 60% ruas dengan
#: rute utama. Tanpa itu "alternatif" cuma rute yang sama dengan satu belokan
#: berbeda, dan menyebutnya pilihan adalah kebohongan kecil.
ALTERNATIF = {"target_count": 3, "share_factor": 0.6, "weight_factor": 1.6}

#: Batas kewajaran. Rute 8 km berjalan kaki (sekitar 100 menit) bukan lagi
#: "dekat stasiun" dalam arti apa pun, dan menggambarnya cuma mengotori layar.
#: Heksagon seperti itu tetap tidak punya baris - dan endpoint-nya mengatakannya
#: apa adanya alih-alih menggambar sesuatu yang tidak berarti.
MAKS_METER = 8000

URL_ISO = "https://api.openrouteservice.org/v2/isochrones/{profil}"

#: Pita isochrone, menit. Harus sama dengan `pipeline/config.py::ISOCHRONE_MENIT`
#: dan `app/api/transit.py::ISOCHRONE_MENIT` - ketiganya menyebut hal yang sama,
#: dan sejak 3 Sep 2026 ketiganya DIJAGA UJI (`backend/tests/test_aturan.py`).
#:
#: Diperluas dari (5, 10, 15) atas permintaan pemilik repo. Satu permintaan ORS
#: mengembalikan seluruh pita sekaligus - `range` menerima daftar - jadi menambah
#: dua pita TIDAK menambah satu pun permintaan. Yang bertambah cuma ukuran
#: responsnya.
#:
#: 60 menit BERJALAN KAKI kira-kira 5 km, dan itu memang jauh. Ia tetap
#: diterbitkan karena pertanyaannya sah untuk kawasan yang angkutan pengumpannya
#: buruk - tetapi pita sebesar itu akan banyak bertindihan antar-simpul, dan
#: itulah sebabnya tiap pita sekarang dibedakan WARNA, bukan cuma opasitas.
ISOCHRONE_MENIT = (5, 10, 15, 30, 60)

#: Kuota isochrone ORS jauh lebih ketat daripada directions: 500 per hari dan
#: 20 per menit. Enam simpul cuma butuh enam permintaan, jadi jedanya longgar.
JEDA_ISO_DETIK = 3.5

#: Sejauh mana pusat isochrone boleh bergeser dari simpulnya sebelum kita
#: menolaknya. ORS menempelkan titik ke jaringan jalan; pergeseran puluhan meter
#: wajar, ratusan meter berarti isochrone-nya menggambarkan tempat LAIN - dan
#: menyimpannya berarti menggambar kawasan jangkau stasiun di sekitar sesuatu
#: yang bukan stasiun itu.
MAKS_GESER_M = 250

#: Kecepatan jalan kaki untuk penggal penyambung. Sama dengan
#: `aturan.KECEPATAN_JALAN_M_PER_MENIT` - disalin, bukan diimpor, karena yang
#: satu aturan TAMPILAN backend dan yang ini bagian dari data yang diterbitkan.
#: Kalau keduanya harus berbeda suatu saat, mereka memang boleh berbeda.
M_PER_MENIT = 80.0


def _meter(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Jarak haversine dua titik [lon, lat], meter."""
    r = 6371008.8
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp = p2 - p1
    dl = math.radians(b[0] - a[0])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


#: Di bawah ini, ujung rute dianggap sudah menyentuh titiknya.
DEKAT_M = 1.0


def jahit(
    koordinat: list, awal: tuple[float, float], akhir: tuple[float, float]
) -> tuple[list, float]:
    """Sambungkan ujung rute ke titik yang SEBENARNYA diminta.

    KENAPA PERLU. ORS menempelkan (`snap`) titik yang tidak berdiri di atas
    jaringan jalan ke ruas terdekat, lalu melaporkan jarak antara titik-titik
    HASIL TEMPEL - bukan antara titik yang kita minta. Terukur di 708 heksagon:
    rata-rata 22 m di pangkal dan 28 m di ujung, sampai 220 m untuk heksagon
    yang tengahnya jatuh di dalam blok tanpa jalan.

    Diam-diam itu membuat angkanya KURANG dilaporkan, dan sekali membuatnya
    mustahil: satu heksagon Manggarai yang berjarak 119 m garis lurus dari
    stasiun menghasilkan "rute" 11 m, karena kedua ujungnya menempel ke ruas
    yang sama. Rute yang lebih pendek daripada garis lurusnya adalah pernyataan
    yang tidak bisa benar.

    Penggal penyambungnya memang garis lurus, dan itu jujur: berjalan dari
    tengah blok ke mulut jalan memang tidak punya jalur bernama. Yang tidak
    boleh cuma menyembunyikannya - jadi panjangnya IKUT DIHITUNG, bukan
    dibuang.

    Idempoten: kalau ujungnya sudah menyentuh titiknya, tidak ada yang
    ditambahkan.
    """
    k = [[float(x), float(y)] for x, y, *_ in koordinat]
    tambahan = 0.0
    depan = (k[0][0], k[0][1])
    if _meter(depan, awal) > DEKAT_M:
        tambahan += _meter(depan, awal)
        k.insert(0, [awal[0], awal[1]])
    belakang = (k[-1][0], k[-1][1])
    if _meter(belakang, akhir) > DEKAT_M:
        tambahan += _meter(belakang, akhir)
        k.append([akhir[0], akhir[1]])
    return k, tambahan


def minta_isochrone(lon: float, lat: float) -> list[dict] | str:
    """Kawasan jangkau jalan kaki dari satu titik, ketiga pita sekaligus.

    SATU permintaan untuk 5, 10, dan 15 menit - `range` menerima daftar. Itu
    yang membuat enam simpul cukup enam permintaan alih-alih delapan belas,
    dan dengan kuota isochrone 500/hari perbedaannya nyata.

    Mengembalikan daftar {menit, geometri, luas_m2}, atau string alasan gagal.
    """
    badan = {
        "locations": [[lon, lat]],
        "range": [m * 60 for m in ISOCHRONE_MENIT],
        "range_type": "time",
        "attributes": ["area"],
    }
    req = urllib.request.Request(
        URL_ISO.format(profil=PROFIL),
        data=json.dumps(badan).encode(),
        headers={
            "Authorization": settings.ors_api_key,
            "Content-Type": "application/json",
            "User-Agent": "Loconomics/1.0 (MAPID WebGIS Competition)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        isi = e.read().decode(errors="replace")
        try:
            pesan = json.loads(isi)["error"]
            pesan = pesan.get("message", pesan) if isinstance(pesan, dict) else pesan
        except Exception:
            pesan = isi[:160]
        return f"HTTP {e.code}: {pesan}"
    except Exception as e:
        return f"{type(e).__name__}: {e}"

    keluar = []
    for f in data.get("features", []):
        prop = f.get("properties", {})
        geom = f.get("geometry", {})
        if geom.get("type") != "Polygon" or not geom.get("coordinates"):
            continue
        pusat = prop.get("center")
        if pusat and _meter((lon, lat), (pusat[0], pusat[1])) > MAKS_GESER_M:
            return (
                f"pusat isochrone bergeser {_meter((lon, lat), (pusat[0], pusat[1])):.0f} m "
                "dari simpulnya"
            )
        keluar.append(
            {
                "menit": int(round(prop.get("value", 0) / 60)),
                "cincin": geom["coordinates"],
                "luas_m2": float(prop.get("area") or 0),
            }
        )
    return keluar or "ORS tidak mengembalikan satu poligon pun"


def simpan_isochrone(db, node_id: int, pita: list[dict]) -> int:
    """Tulis kawasan jangkau satu simpul. Menghapus yang lama dulu."""
    db.execute(delete(CatchmentArea).where(CatchmentArea.transport_node_id == node_id))
    n = 0
    for b in pita:
        if b["menit"] not in ISOCHRONE_MENIT:
            continue
        # Cincin luar saja. ORS bisa mengembalikan lubang di tengah kawasan yang
        # tidak terjangkau (blok tanpa jalan tembus), dan lubang itu benar -
        # tetapi kolomnya POLYGON, jadi lubangnya ikut ditulis apa adanya.
        cincin = ",".join(
            "(" + ",".join(f"{x} {y}" for x, y, *_ in c) + ")" for c in b["cincin"]
        )
        db.execute(
            text(
                """
                INSERT INTO catchment_areas (transport_node_id, menit, geom)
                VALUES (:node, :menit, ST_SetSRID(ST_GeomFromText(:wkt), 4326))
                """
            ),
            {"node": node_id, "menit": b["menit"], "wkt": f"POLYGON({cincin})"},
        )
        n += 1
    return n


def isochrone(db) -> int:
    """Ambil kawasan jangkau untuk SETIAP simpul transportasi.

    Setiap pita diperiksa terhadap dua invarian sebelum disimpan:

      1. Luasnya tidak boleh MELEBIHI lingkaran berjari-jari `menit x 80 m`.
         Kawasan yang dibatasi jaringan jalan tidak mungkin lebih luas daripada
         kawasan yang bisa ditembus ke segala arah. Kalau ia melebihi, yang
         dikembalikan ORS bukan isochrone jalan kaki.
      2. Pita yang lebih lama harus lebih LUAS. Kalau 10 menit lebih sempit
         daripada 5 menit, ada pita yang tertukar - dan tertukar tidak
         menghasilkan galat, cuma peta yang salah.
    """
    simpul = db.execute(
        text("SELECT id, nama, ST_X(geom) AS lon, ST_Y(geom) AS lat FROM transport_nodes ORDER BY id")
    ).mappings().all()
    if not simpul:
        print("Belum ada simpul transportasi di basis data.")
        return 0

    print(f"\n  {len(simpul)} simpul x {len(ISOCHRONE_MENIT)} pita, satu permintaan per simpul\n")
    total = 0
    for i, s in enumerate(simpul, 1):
        hasil = minta_isochrone(s["lon"], s["lat"])
        if isinstance(hasil, str):
            print(f"  {s['nama']:<22} GAGAL - {hasil}")
        else:
            hasil.sort(key=lambda b: b["menit"])
            keluhan = []
            for b in hasil:
                lingkaran = math.pi * (b["menit"] * M_PER_MENIT) ** 2
                if b["luas_m2"] > lingkaran:
                    keluhan.append(f"{b['menit']} mnt melebihi lingkarannya")
            for a, b in zip(hasil, hasil[1:]):
                if b["luas_m2"] <= a["luas_m2"]:
                    keluhan.append(f"{b['menit']} mnt tidak lebih luas dari {a['menit']} mnt")
            if keluhan:
                print(f"  {s['nama']:<22} DITOLAK - {'; '.join(keluhan)}")
            else:
                n = simpan_isochrone(db, s["id"], hasil)
                total += n
                rincian = "  ".join(
                    f"{b['menit']}mnt {b['luas_m2'] / 1e6:.2f}km2" for b in hasil
                )
                print(f"  {s['nama']:<22} {n} pita   {rincian}")
        db.commit()
        if i < len(simpul):
            time.sleep(JEDA_ISO_DETIK)

    print(f"\n  {total} pita tersimpan di catchment_areas.")
    return total


def ambil_target(db, kawasan: str | None, ulang: bool, batas: int | None) -> list[dict]:
    """Heksagon yang perlu dirutekan, beserta simpul terdekatnya.

    Simpul terdekat ditentukan PostGIS lewat `<->` (indeks GiST), bukan ORS -
    memilih TUJUAN tidak butuh jaringan jalan, cuma butuh tahu mana yang paling
    dekat. Yang butuh jaringan jalan cuma jalur menuju ke sana.
    """
    saring_kawasan = "AND h.kawasan = :kawasan" if kawasan else ""
    saring_ulang = "" if ulang else "AND r.h3_index IS NULL"
    sql = f"""
        SELECT h.h3_index,
               h.kawasan,
               ST_X(ST_Centroid(h.geom)) AS hx,
               ST_Y(ST_Centroid(h.geom)) AS hy,
               s.id   AS simpul_id,
               s.nama AS simpul_nama,
               ST_X(s.geom) AS sx,
               ST_Y(s.geom) AS sy,
               ST_Distance(s.geom::geography, ST_Centroid(h.geom)::geography) AS lurus_m
        FROM hex_features h
        CROSS JOIN LATERAL (
            SELECT n.id, n.nama, n.geom
            FROM transport_nodes n
            ORDER BY n.geom <-> ST_Centroid(h.geom)
            LIMIT 1
        ) s
        -- Disaring per PROFIL. Tanpa `WHERE profil = :profil` di sini,
        -- penarikan mobil akan melewati seluruh 708 heksagon dengan alasan
        -- "sudah ada rutenya" - padahal yang ada rute jalan kakinya. Nol
        -- permintaan terkirim, nol baris bertambah, dan skripnya melaporkan
        -- sukses. Gagal diam, dan gejalanya cuma tabel yang tidak tumbuh.
        LEFT JOIN (
            SELECT DISTINCT h3_index FROM hex_routes WHERE profil = :profil
        ) r ON r.h3_index = h.h3_index
        WHERE TRUE {saring_kawasan} {saring_ulang}
        ORDER BY h.kawasan, h.h3_index
    """
    if batas:
        sql += f" LIMIT {int(batas)}"
    p: dict[str, str] = {"profil": PROFIL}
    if kawasan:
        p["kawasan"] = kawasan
    return [dict(r) for r in db.execute(text(sql), p).mappings()]


def minta_rute(awal: tuple[float, float], akhir: tuple[float, float]) -> list[dict] | str:
    """Panggil ORS sekali. Mengembalikan daftar rute, atau string alasan gagal.

    Galat dikembalikan sebagai TEKS, bukan dilempar: satu heksagon yang tidak
    bisa dirutekan tidak boleh menghentikan 707 lainnya. Yang gagal dicatat lalu
    dilewati, dan ketiadaan barisnya nanti terbaca jujur di antarmuka.
    """
    badan = {
        "coordinates": [[awal[0], awal[1]], [akhir[0], akhir[1]]],
        "alternative_routes": ALTERNATIF,
        "instructions": False,
    }
    req = urllib.request.Request(
        URL_ORS.format(profil=PROFIL),
        data=json.dumps(badan).encode(),
        headers={
            "Authorization": settings.ors_api_key,
            "Content-Type": "application/json",
            "User-Agent": "Loconomics/1.0 (MAPID WebGIS Competition)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        isi = e.read().decode(errors="replace")
        try:
            pesan = json.loads(isi)["error"]
            pesan = pesan.get("message", pesan) if isinstance(pesan, dict) else pesan
        except Exception:
            pesan = isi[:160]
        return f"HTTP {e.code}: {pesan}"
    except Exception as e:  # jaringan putus, timeout, DNS
        return f"{type(e).__name__}: {e}"

    rute = []
    for f in data.get("features", []):
        ringkas = f.get("properties", {}).get("summary", {})
        koord = f.get("geometry", {}).get("coordinates", [])
        # Rute tanpa jarak terjadi kalau titik awal dan tujuan jatuh di ruas
        # yang sama. Tidak bisa digambar, dan tidak ada gunanya disimpan.
        if not koord or not ringkas.get("distance"):
            continue
        rute.append(
            {
                "jarak_m": float(ringkas["distance"]),
                "menit": float(ringkas["duration"]) / 60.0,
                "koordinat": koord,
            }
        )
    return rute or "ORS tidak mengembalikan satu rute pun"


def simpan(
    db,
    h3: str,
    simpul_id: int,
    rute: list[dict],
    awal: tuple[float, float],
    akhir: tuple[float, float],
) -> int:
    """Tulis rute satu heksagon. Menghapus yang lama dulu supaya idempoten.

    DIURUTKAN ULANG menurut durasi. ORS memberi urutannya sendiri berdasarkan
    "weight" internal - yang bukan durasi, dan bisa jauh berbeda: terukur di 147
    dari 705 heksagon, jalur pertama versi ORS kalah cepat dari alternatifnya,
    sampai selisih 11 menit.

    Itu penting karena antarmuka menuliskan satu angka besar - "N menit jalan
    kaki" - dan angka itu diambil dari `urutan = 0`. Menampilkan jalur yang
    bukan tercepat sebagai jawaban atas "berapa lama jalan kakinya" adalah
    jawaban yang salah, bukan sekadar urutan yang berbeda selera.
    """
    db.execute(delete(HexRoute).where(HexRoute.h3_index == h3))

    # Dijahit DULU, baru diurutkan: penggal penyambung panjangnya berbeda-beda
    # per jalur (ORS menempelkan tiap alternatif ke titik yang berlainan), jadi
    # mengurutkan sebelum menjahit bisa memilih pemenang yang salah.
    siap = []
    for r in rute:
        r = dict(r)
        r["koordinat"], tambah = jahit(r["koordinat"], awal, akhir)
        r["jarak_m"] += tambah
        r["menit"] += tambah / M_PER_MENIT
        siap.append(r)
    siap.sort(key=lambda r: r["menit"])

    for i, r in enumerate(siap):
        # WKT dirakit di sini, ST_GeomFromText yang mengurainya. Koordinat ORS
        # sudah [lon, lat] - urutan yang sama dengan yang diminta PostGIS, jadi
        # tidak ada yang perlu dibalik.
        wkt = "LINESTRING(" + ",".join(f"{x} {y}" for x, y, *_ in r["koordinat"]) + ")"
        db.execute(
            text(
                """
                INSERT INTO hex_routes
                    (h3_index, transport_node_id, urutan, jarak_m, menit, geom, profil)
                VALUES
                    (:h3, :simpul, :urutan, :jarak, :menit,
                     ST_SetSRID(ST_GeomFromText(:wkt), 4326), :profil)
                """
            ),
            {
                "h3": h3,
                "simpul": simpul_id,
                "urutan": i,
                "jarak": r["jarak_m"],
                "menit": r["menit"],
                "wkt": wkt,
                "profil": PROFIL,
            },
        )
    return len(siap)


def urutkan_ulang(db) -> int:
    """Nomori ulang `urutan` menurut durasi, untuk baris yang sudah tersimpan.

    Satu UPDATE dengan window function - bukan lulus-per-baris dari Python -
    karena yang dikerjakan murni penomoran ulang di dalam basis data.

    Kendala unik (h3_index, transport_node_id, urutan) membuat penomoran
    langsung bisa bentrok di tengah jalan, jadi nomornya digeser jauh dulu ke
    wilayah negatif sebelum ditulis ke nilai akhirnya.
    """
    db.execute(text("UPDATE hex_routes SET urutan = -urutan - 1"))
    n = db.execute(
        text(
            """
            UPDATE hex_routes r
            SET urutan = b.baru
            FROM (
                SELECT id, row_number() OVER (
                           PARTITION BY h3_index ORDER BY menit, jarak_m, id
                       ) - 1 AS baru
                FROM hex_routes
            ) b
            WHERE r.id = b.id
            """
        )
    ).rowcount
    db.commit()
    return n


def jahit_ulang(db) -> None:
    """Jahit ujung SELURUH rute yang sudah tersimpan. Tanpa memanggil ORS.

    Ada karena 1.587 rute sudah terlanjur ditulis sebelum `jahit()` dipasang,
    dan mengambilnya ulang berarti membayar 705 permintaan lagi untuk geometri
    yang sudah ada di basis data. Yang kurang cuma dua penggal di ujungnya, dan
    keduanya bisa dihitung dari data yang sudah kita punya.

    Idempoten lewat `jahit()`: dijalankan dua kali, yang kedua tidak mengubah
    apa pun.
    """
    baris = db.execute(
        text(
            """
            SELECT r.id, r.jarak_m, r.menit,
                   ST_AsGeoJSON(r.geom) AS geojson,
                   ST_X(ST_Centroid(h.geom)) AS hx, ST_Y(ST_Centroid(h.geom)) AS hy,
                   ST_X(n.geom) AS sx, ST_Y(n.geom) AS sy
            FROM hex_routes r
            JOIN hex_features h ON h.h3_index = r.h3_index
            JOIN transport_nodes n ON n.id = r.transport_node_id
            ORDER BY r.id
            """
        )
    ).mappings().all()

    diubah = 0
    for i, b in enumerate(baris, 1):
        koord = json.loads(b["geojson"])["coordinates"]
        baru, tambah = jahit(koord, (b["hx"], b["hy"]), (b["sx"], b["sy"]))
        if tambah <= 0:
            continue
        wkt = "LINESTRING(" + ",".join(f"{x} {y}" for x, y in baru) + ")"
        db.execute(
            text(
                """
                UPDATE hex_routes
                SET jarak_m = :jarak, menit = :menit,
                    geom = ST_SetSRID(ST_GeomFromText(:wkt), 4326)
                WHERE id = :id
                """
            ),
            {
                "id": b["id"],
                "jarak": float(b["jarak_m"]) + tambah,
                "menit": float(b["menit"]) + tambah / M_PER_MENIT,
                "wkt": wkt,
            },
        )
        diubah += 1
        if diubah % 200 == 0:
            db.commit()
            print(f"  {i}/{len(baris)} diperiksa, {diubah} dijahit")
    db.commit()
    print(f"\n  {diubah} dari {len(baris)} rute dijahit ujungnya.")
    n = urutkan_ulang(db)
    print(f"  {n} rute dinomori ulang menurut durasi.")


def status(db) -> None:
    baris = (
        db.execute(
            text(
                """
            SELECT h.kawasan,
                   count(DISTINCT h.h3_index)                         AS hex,
                   count(DISTINCT r.h3_index)                         AS dirutekan,
                   count(r.id)                                        AS baris,
                   round(avg(r.jarak_m) FILTER (WHERE r.urutan = 0)::numeric) AS rata_m,
                   round(avg(r.menit) FILTER (WHERE r.urutan = 0)::numeric, 1) AS rata_menit
            FROM hex_features h
            LEFT JOIN hex_routes r ON r.h3_index = h.h3_index
            GROUP BY h.kawasan ORDER BY h.kawasan
            """
            )
        )
        .mappings()
        .all()
    )
    print(
        f"\n  {'kawasan':<14}{'heksagon':>9}{'dirutekan':>11}"
        f"{'rute':>7}{'rata jarak':>12}{'rata menit':>12}"
    )
    print("  " + "-" * 65)
    for r in baris:
        rata = f"{int(r['rata_m'])} m" if r["rata_m"] else "-"
        menit = f"{r['rata_menit']}" if r["rata_menit"] else "-"
        print(
            f"  {r['kawasan']:<14}{r['hex']:>9}{r['dirutekan']:>11}"
            f"{r['baris']:>7}{rata:>12}{menit:>12}"
        )
    total = db.execute(select(func.count()).select_from(HexRoute)).scalar_one()
    iso = db.execute(select(func.count()).select_from(CatchmentArea)).scalar_one()
    print(f"\n  total baris hex_routes: {total}")
    print(f"  total pita catchment_areas: {iso}\n")


def main() -> int:
    ap = argparse.ArgumentParser(description="Rute jalan kaki heksagon -> simpul, lewat ORS.")
    ap.add_argument(
        "--mobil",
        action="store_true",
        help=(
            "tarik profil driving-car, bukan foot-walking. Rute mobil DITAMBAHKAN "
            "di sebelah rute jalan kaki, tidak menggantikannya. Motor tidak ada di ORS."
        ),
    )
    ap.add_argument("--kawasan", help="batasi ke satu kawasan pilot")
    ap.add_argument("--ulang", action="store_true", help="hitung ulang yang sudah ada")
    ap.add_argument("--batas", type=int, help="maksimal berapa heksagon")
    ap.add_argument("--status", action="store_true", help="tampilkan cakupan, tanpa memanggil ORS")
    ap.add_argument(
        "--isochrone",
        action="store_true",
        help="ambil kawasan jangkau 5/10/15 menit tiap simpul -> catchment_areas",
    )
    ap.add_argument(
        "--rapikan",
        action="store_true",
        help=(
            "untuk rute yang sudah tersimpan: sambungkan ujungnya ke pusat heksagon "
            "dan simpulnya, lalu nomori ulang menurut durasi. Tanpa memanggil ORS."
        ),
    )
    a = ap.parse_args()

    global PROFIL
    if a.mobil:
        PROFIL = PROFIL_MOBIL

    db = SessionLocal()
    try:
        if a.status:
            status(db)
            return 0

        if a.rapikan:
            jahit_ulang(db)
            status(db)
            return 0

        if a.isochrone:
            if not settings.ors_api_key:
                print("ORS_API_KEY kosong di backend/.env. Isi dulu.")
                return 1
            isochrone(db)
            return 0

        if not settings.ors_api_key:
            print("ORS_API_KEY kosong di backend/.env. Isi dulu.")
            return 1

        target = ambil_target(db, a.kawasan, a.ulang, a.batas)
        if not target:
            print("Tidak ada heksagon yang perlu dirutekan. Pakai --ulang untuk menghitung ulang.")
            return 0

        n = len(target)
        print(
            f"\n  profil {PROFIL} - {n} heksagon, "
            f"~{n * JEDA_DETIK / 60:.0f} menit dengan jeda {JEDA_DETIK} dtk\n"
        )
        ok = gagal = jauh = 0
        n_rute = 0
        gagal_contoh: list[str] = []

        for i, t in enumerate(target, 1):
            hasil = minta_rute((t["hx"], t["hy"]), (t["sx"], t["sy"]))
            if isinstance(hasil, str):
                gagal += 1
                if len(gagal_contoh) < 5:
                    gagal_contoh.append(f"{t['h3_index']}: {hasil}")
            elif hasil[0]["jarak_m"] > MAKS_METER:
                # Rute utama di luar batas kewajaran membatalkan seluruh heksagon
                # itu, alternatifnya sekalian - kalau yang tercepat pun 8 km,
                # yang lain sudah pasti lebih jauh.
                jauh += 1
            else:
                n_rute += simpan(
                    db,
                    t["h3_index"],
                    t["simpul_id"],
                    hasil,
                    (t["hx"], t["hy"]),
                    (t["sx"], t["sy"]),
                )
                ok += 1
                if ok % 25 == 0:
                    db.commit()

            if i % 20 == 0 or i == n:
                print(
                    f"  {i:>4}/{n}  {t['kawasan']:<12} "
                    f"berhasil {ok}  rute {n_rute}  terlalu jauh {jauh}  gagal {gagal}"
                )
            if i < n:
                time.sleep(JEDA_DETIK)

        db.commit()
        print(f"\n  Selesai. {ok} heksagon, {n_rute} rute tersimpan.")
        if jauh:
            print(f"  {jauh} dilewati karena rute utamanya di atas {MAKS_METER} m.")
        if gagal:
            print(f"  {gagal} gagal dirutekan:")
            for g in gagal_contoh:
                print(f"    {g}")
        status(db)
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
