"""Rute dan kawasan jangkau di sekitar simpul transportasi, lewat OpenRouteService."""

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

PROFIL_JALAN = "foot-walking"
PROFIL_MOBIL = "driving-car"
PROFIL_SEPEDA = "cycling-regular"

PROFIL = PROFIL_JALAN


def kunci_ors() -> str:
    """Kunci ORS untuk profil yang SEDANG ditarik."""
    if PROFIL == "driving-car" and settings.ors_api_key_mobil:
        return settings.ors_api_key_mobil
    return settings.ors_api_key

#: Batas ORS 40/menit. 1,7 dtk memberi ~35/menit - cukup di bawah batas supaya
#: satu permintaan yang kebetulan lambat tidak mendorong yang berikutnya lewat.
JEDA_DETIK = 1.7

ALTERNATIF = {"target_count": 3, "share_factor": 0.6, "weight_factor": 1.6}

MAKS_METER = 8000

#: Batas yang sama untuk MOBIL. 8 km berkendara itu belasan menit, bukan
#: "jauh" - memakai batas jalan kaki untuk mobil membuat 11 heksagon di pinggir
#: kawasan tanpa rute mobil sama sekali (13 Sep 2026).
MAKS_METER_MOBIL = 30_000

#: Radius penempelan titik ke jaringan jalan, meter. Bawaan ORS 350 m cukup
#: untuk jalan kaki (gang pun ruas), tetapi pusat heksagon di tengah kompleks
#: atau lahan kosong bisa lebih dari 350 m dari jalan yang BOLEH dilalui mobil.
RADIUS_MOBIL = 1500


def maks_meter() -> float:
    return MAKS_METER_MOBIL if PROFIL == "driving-car" else MAKS_METER

URL_ISO = "https://api.openrouteservice.org/v2/isochrones/{profil}"

ISOCHRONE_MENIT = (5, 10, 15, 30, 60)

#: Pita menit PER PROFIL. Mobil dan sepeda berkali-kali lebih cepat, jadi
#: memakai pita 5-60 menit yang sama membuat lapisan mobil menutupi seluruh
#: peta - pita mobil 15 menit terukur 140-400 km2 melawan 1-3 km2 pita jalan
#: kaki. Angka di bawah dipilih supaya LUAS pita tiap nomor kurang lebih
#: sebanding dengan pita jalan kaki: mobil 10 menit ~ jalan kaki 60 menit.
ISOCHRONE_MENIT_PROFIL = {
    PROFIL_JALAN: ISOCHRONE_MENIT,
    PROFIL_SEPEDA: (2, 4, 6, 10, 15),
    PROFIL_MOBIL: (1, 2, 4, 7, 10),
}


def menit_iso() -> tuple[int, ...]:
    """Pita menit untuk PROFIL yang sedang ditarik."""
    return ISOCHRONE_MENIT_PROFIL[PROFIL]


#: Kuota isochrone ORS jauh lebih ketat daripada directions: 500 per hari dan
#: 20 per menit. Enam simpul cuma butuh enam permintaan, jadi jedanya longgar.
JEDA_ISO_DETIK = 3.5

MAKS_GESER_M = 250

M_PER_MENIT = 80.0

#: Kecepatan bebas-hambatan tiap profil, meter/menit, HANYA untuk memeriksa
#: kewajaran luas isochrone. Mobil memang jauh lebih luas dari jalan kaki;
#: menilainya dengan batas jalan kaki akan menolak setiap pita mobil.
M_PER_MENIT_PROFIL = {
    PROFIL_JALAN: 80.0,
    PROFIL_SEPEDA: 300.0,
    PROFIL_MOBIL: 1000.0,
}


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


def menit_penggal(meter: float, profil: str, jarak_m: float, menit: float) -> float:
    """Berapa menit tambahan untuk penggal penyambung sepanjang `meter`."""
    if profil == PROFIL_JALAN or menit <= 0 or jarak_m <= 0:
        return meter / M_PER_MENIT
    return meter / (jarak_m / menit)


def jahit(
    koordinat: list, awal: tuple[float, float], akhir: tuple[float, float]
) -> tuple[list, float]:
    """Sambungkan ujung rute ke titik yang SEBENARNYA diminta."""
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
    """Kawasan jangkau satu titik untuk PROFIL yang sedang ditarik, semua pita."""
    badan = {
        "locations": [[lon, lat]],
        "range": [m * 60 for m in menit_iso()],
        "range_type": "time",
        "attributes": ["area"],
    }
    req = urllib.request.Request(
        URL_ISO.format(profil=PROFIL),
        data=json.dumps(badan).encode(),
        headers={
            "Authorization": kunci_ors(),
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
    """Tulis kawasan jangkau satu simpul UNTUK PROFIL yang sedang ditarik."""
    db.execute(
        delete(CatchmentArea).where(
            CatchmentArea.transport_node_id == node_id,
            CatchmentArea.profil == PROFIL,
        )
    )
    n = 0
    for b in pita:
        if b["menit"] not in menit_iso():
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
                INSERT INTO catchment_areas (transport_node_id, menit, geom, profil)
                VALUES (:node, :menit, ST_SetSRID(ST_GeomFromText(:wkt), 4326), :profil)
                """
            ),
            {
                "node": node_id,
                "menit": b["menit"],
                "wkt": f"POLYGON({cincin})",
                "profil": PROFIL,
            },
        )
        n += 1
    return n


def isochrone(db) -> int:
    """Ambil kawasan jangkau untuk SETIAP simpul transportasi."""
    simpul = db.execute(
        text("SELECT id, nama, ST_X(geom) AS lon, ST_Y(geom) AS lat FROM transport_nodes ORDER BY id")
    ).mappings().all()
    if not simpul:
        print("Belum ada simpul transportasi di basis data.")
        return 0

    print(f"\n  {len(simpul)} simpul x {len(menit_iso())} pita, satu permintaan per simpul")
    print(f"  profil {PROFIL}\n")
    total = 0
    for i, s in enumerate(simpul, 1):
        hasil = minta_isochrone(s["lon"], s["lat"])
        if isinstance(hasil, str):
            print(f"  {s['nama']:<22} GAGAL - {hasil}")
        else:
            hasil.sort(key=lambda b: b["menit"])
            keluhan = []
            kecepatan = M_PER_MENIT_PROFIL.get(PROFIL, M_PER_MENIT)
            for b in hasil:
                lingkaran = math.pi * (b["menit"] * kecepatan) ** 2
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
    """Heksagon yang perlu dirutekan, beserta simpul terdekatnya."""
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
    """Panggil ORS sekali. Mengembalikan daftar rute, atau string alasan gagal."""
    badan = {
        "coordinates": [[awal[0], awal[1]], [akhir[0], akhir[1]]],
        "alternative_routes": ALTERNATIF,
        "instructions": False,
    }
    # Jalan kaki ikut dilonggarkan ke 1 km: lima heksagon Harjamukti berpusat di
    # lahan tanpa ruas OSM dalam 350 m, dan tanpa ini tidak punya rute sama
    # sekali. Ujung yang meleset dijahit ke pusat heksagon oleh `--rapikan`.
    badan["radiuses"] = [RADIUS_MOBIL, RADIUS_MOBIL] if PROFIL == "driving-car" else [1000, 1000]
    req = urllib.request.Request(
        URL_ORS.format(profil=PROFIL),
        data=json.dumps(badan).encode(),
        headers={
            "Authorization": kunci_ors(),
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
    """Tulis rute satu heksagon. Menghapus yang lama dulu supaya idempoten."""
    db.execute(
        delete(HexRoute).where(HexRoute.h3_index == h3, HexRoute.profil == PROFIL)
    )

    # Dijahit DULU, baru diurutkan: penggal penyambung panjangnya berbeda-beda
    # per jalur (ORS menempelkan tiap alternatif ke titik yang berlainan), jadi
    # mengurutkan sebelum menjahit bisa memilih pemenang yang salah.
    siap = []
    for r in rute:
        r = dict(r)
        r["koordinat"], tambah = jahit(r["koordinat"], awal, akhir)
        r["menit"] += menit_penggal(tambah, PROFIL, r["jarak_m"], r["menit"])
        r["jarak_m"] += tambah
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
    """Nomori ulang `urutan` menurut durasi, untuk baris yang sudah tersimpan."""
    db.execute(text("UPDATE hex_routes SET urutan = -urutan - 1"))
    n = db.execute(
        text(
            """
            UPDATE hex_routes r
            SET urutan = b.baru
            FROM (
                SELECT id, row_number() OVER (
                           -- PROFIL ikut membagi partisinya, dan itu bukan
                           -- kerapian: `urutan = 0` berarti "rute tercepat
                           -- untuk moda ini", dan backend membaca `utama` dari
                           -- situ. Satu partisi untuk dua moda membuat rute
                           -- mobil - yang selalu lebih cepat - merebut nomor
                           -- nol, dan rute jalan kaki berhenti jadi yang utama
                           -- di layar tanpa satu pun galat.
                           PARTITION BY h3_index, transport_node_id, profil
                           ORDER BY menit, jarak_m, id
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
    """Jahit ujung SELURUH rute yang sudah tersimpan. Tanpa memanggil ORS."""
    baris = db.execute(
        text(
            """
            SELECT r.id, r.jarak_m, r.menit, r.profil,
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
                "menit": float(b["menit"])
                + menit_penggal(tambah, b["profil"], float(b["jarak_m"]), float(b["menit"])),
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
    """Cakupan per kawasan, DIPISAH PER PROFIL."""
    baris = (
        db.execute(
            text(
                """
            SELECT h.kawasan,
                   count(DISTINCT h.h3_index)                                          AS hex,
                   count(DISTINCT r.h3_index) FILTER (WHERE r.profil = 'foot-walking') AS kaki_hex,
                   count(r.id)                FILTER (WHERE r.profil = 'foot-walking') AS kaki_baris,
                   round(avg(r.menit) FILTER (
                       WHERE r.urutan = 0 AND r.profil = 'foot-walking')::numeric, 1)  AS kaki_menit,
                   count(DISTINCT r.h3_index) FILTER (WHERE r.profil = 'driving-car')  AS mobil_hex,
                   count(r.id)                FILTER (WHERE r.profil = 'driving-car')  AS mobil_baris,
                   round(avg(r.menit) FILTER (
                       WHERE r.urutan = 0 AND r.profil = 'driving-car')::numeric, 1)   AS mobil_menit,
                   count(DISTINCT r.h3_index) FILTER (WHERE r.profil = 'cycling-regular') AS sepeda_hex,
                   round(avg(r.menit) FILTER (
                       WHERE r.urutan = 0 AND r.profil = 'cycling-regular')::numeric, 1) AS sepeda_menit
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
        f"\n  {'kawasan':<14}{'heks':>6}"
        f"{'kaki hx':>9}{'kaki rute':>11}{'kaki mnt':>10}"
        f"{'mobil hx':>10}{'mobil rute':>12}{'mobil mnt':>11}"
        f"{'sepeda hx':>11}{'sepeda mnt':>12}"
    )
    print("  " + "-" * 106)
    for r in baris:
        kmnt = f"{r['kaki_menit']}" if r["kaki_menit"] else "-"
        mmnt = f"{r['mobil_menit']}" if r["mobil_menit"] else "-"
        smnt = f"{r['sepeda_menit']}" if r["sepeda_menit"] else "-"
        print(
            f"  {r['kawasan']:<14}{r['hex']:>6}"
            f"{r['kaki_hex']:>9}{r['kaki_baris']:>11}{kmnt:>10}"
            f"{r['mobil_hex']:>10}{r['mobil_baris']:>12}{mmnt:>11}"
            f"{r['sepeda_hex']:>11}{smnt:>12}"
        )
    total = db.execute(select(func.count()).select_from(HexRoute)).scalar_one()
    iso = db.execute(
        select(CatchmentArea.profil, func.count())
        .group_by(CatchmentArea.profil)
        .order_by(CatchmentArea.profil)
    ).all()
    print(f"\n  total baris hex_routes: {total}")
    if iso:
        rincian = "  ".join(f"{p}: {n}" for p, n in iso)
        print(f"  pita catchment_areas per profil: {rincian}\n")
    else:
        print("  pita catchment_areas: kosong\n")


URL_MATRIKS = "https://api.openrouteservice.org/v2/matrix/{profil}"

#: Sumber per permintaan matriks. ORS gratis menerima sampai 3.500 pasangan
#: sumber x tujuan; 400 menyisakan ruang lebar dan membuat satu kegagalan
#: jaringan cuma membuang sepotong kecil, bukan satu kawasan.
MATRIKS_PER_PERMINTAAN = 400

#: Kecepatan jalan kaki untuk PENGGAL tempel (titik blok -> ruas terdekat).
#: Sama dengan `menit_penggal()` untuk jalan kaki, supaya menit blok dan menit
#: heksagon menggambarkan perjalanan yang dihitung dengan cara yang sama.
METER_PER_MENIT_KAKI = 80.0


def _minta_matriks(sumber: list[tuple[float, float]], tujuan: tuple[float, float]) -> dict | str:
    """Satu permintaan matriks jalan kaki: banyak sumber -> satu simpul."""
    lokasi = [[x, y] for x, y in sumber] + [[tujuan[0], tujuan[1]]]
    badan = {
        "locations": lokasi,
        "sources": list(range(len(sumber))),
        "destinations": [len(sumber)],
        "metrics": ["duration", "distance"],
        "resolve_locations": True,
    }
    req = urllib.request.Request(
        URL_MATRIKS.format(profil=PROFIL_JALAN),
        data=json.dumps(badan).encode(),
        headers={
            "Authorization": kunci_ors(),
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code}: {e.read()[:200].decode('utf-8', 'replace')}"
    except (OSError, json.JSONDecodeError) as e:
        return f"{type(e).__name__}: {e}"


def matriks_blok(db) -> int:
    """Waktu jalan kaki tiap BLOK (anak H3 res-10) ke simpul heksagon induknya."""
    import h3

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from config import DATA_MENTAH, H3_RESOLUSI_BLOK

    induk = [
        dict(r)
        for r in db.execute(
            text(
                """
                SELECT h.h3_index, s.id AS simpul_id, ST_X(s.geom) AS sx, ST_Y(s.geom) AS sy
                FROM hex_features h
                CROSS JOIN LATERAL (
                    SELECT n.id, n.geom FROM transport_nodes n
                    ORDER BY n.geom <-> ST_Centroid(h.geom) LIMIT 1
                ) s
                ORDER BY s.id, h.h3_index
                """
            )
        ).mappings()
    ]
    berkas = DATA_MENTAH / "ors_blok.json"
    hasil: dict[str, dict] = json.loads(berkas.read_text(encoding="utf-8")) if berkas.exists() else {}

    per_simpul: dict[int, dict] = {}
    for r in induk:
        g = per_simpul.setdefault(r["simpul_id"], {"tujuan": (r["sx"], r["sy"]), "blok": []})
        for anak in sorted(h3.cell_to_children(r["h3_index"], H3_RESOLUSI_BLOK)):
            if anak not in hasil:
                la, lo = h3.cell_to_latlng(anak)
                g["blok"].append((anak, lo, la))

    sisa = sum(len(g["blok"]) for g in per_simpul.values())
    print(f"  Matriks blok: {len(hasil)} tersimpan, {sisa} tersisa")
    for simpul_id, g in per_simpul.items():
        for i in range(0, len(g["blok"]), MATRIKS_PER_PERMINTAAN):
            potong = g["blok"][i : i + MATRIKS_PER_PERMINTAAN]
            d = _minta_matriks([(lo, la) for _, lo, la in potong], g["tujuan"])
            if isinstance(d, str):
                if d.startswith("HTTP 403") and "uota" in d:
                    berkas.write_text(json.dumps(hasil), encoding="utf-8")
                    print(f"\n  KUOTA ORS HABIS. {len(hasil)} blok tersimpan; jalankan ulang besok.")
                    return 3
                print(f"    simpul {simpul_id} potongan {i}: {d}")
                continue
            durasi = d.get("durations") or []
            jarak = d.get("distances") or []
            sumber = d.get("sources") or []
            for k, (anak, lo, la) in enumerate(potong):
                dur = durasi[k][0] if k < len(durasi) and durasi[k] else None
                jar = jarak[k][0] if k < len(jarak) and jarak[k] else None
                tempel = (sumber[k] or {}).get("snapped_distance") if k < len(sumber) else None
                if dur is None or jar is None:
                    # Tidak tertempel ke jaringan sama sekali. KOSONG, bukan nol
                    # dan bukan garis lurus - blok ini tetap tampil, hanya tanpa
                    # angka menit.
                    hasil[anak] = {"simpul_id": simpul_id, "menit": None, "jarak_m": None}
                    continue
                penggal = float(tempel or 0.0)
                hasil[anak] = {
                    "simpul_id": simpul_id,
                    "menit": round(dur / 60.0 + penggal / METER_PER_MENIT_KAKI, 2),
                    "jarak_m": round(jar + penggal, 1),
                }
            berkas.write_text(json.dumps(hasil), encoding="utf-8")
            print(f"    simpul {simpul_id}: {min(i + len(potong), len(g['blok']))}/{len(g['blok'])}")
            time.sleep(3.0)

    ada = sum(1 for v in hasil.values() if v.get("menit") is not None)
    print(f"\n  {ada} dari {len(hasil)} blok punya waktu jalan kaki -> {berkas.name}")
    return 0


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
    ap.add_argument(
        "--sepeda",
        action="store_true",
        help=(
            "tarik profil cycling-regular. Sama seperti --mobil: DITAMBAHKAN di "
            "sebelah profil lain, tidak menggantikannya."
        ),
    )
    ap.add_argument("--kawasan", help="batasi ke satu kawasan pilot")
    ap.add_argument("--ulang", action="store_true", help="hitung ulang yang sudah ada")
    ap.add_argument("--batas", type=int, help="maksimal berapa heksagon")
    ap.add_argument("--status", action="store_true", help="tampilkan cakupan, tanpa memanggil ORS")
    ap.add_argument(
        "--isochrone",
        action="store_true",
        help=(
            "ambil kawasan jangkau tiap simpul -> catchment_areas. Ikut profil yang "
            "dipilih (--mobil / --sepeda); pita tiap profil disimpan terpisah."
        ),
    )
    ap.add_argument(
        "--rapikan",
        action="store_true",
        help=(
            "untuk rute yang sudah tersimpan: sambungkan ujungnya ke pusat heksagon "
            "dan simpulnya, lalu nomori ulang menurut durasi. Tanpa memanggil ORS."
        ),
    )
    ap.add_argument(
        "--blok",
        action="store_true",
        help="waktu jalan kaki tiap blok (anak H3 res-10) ke simpulnya, lewat ORS matrix",
    )
    a = ap.parse_args()

    global PROFIL
    if a.mobil and a.sepeda:
        print("Pilih salah satu: --mobil atau --sepeda.")
        return 1
    if a.mobil:
        PROFIL = PROFIL_MOBIL
    if a.sepeda:
        PROFIL = PROFIL_SEPEDA

    db = SessionLocal()
    try:
        if a.status:
            status(db)
            return 0

        if a.rapikan:
            jahit_ulang(db)
            status(db)
            return 0

        if a.blok:
            if not settings.ors_api_key:
                print("ORS_API_KEY kosong di backend/.env. Isi dulu.")
                return 1
            return matriks_blok(db)

        if a.isochrone:
            if not kunci_ors():
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
            if isinstance(hasil, str) and hasil.startswith("HTTP 403") and "uota" in hasil:
                db.commit()
                print(
                    f"\n  KUOTA ORS HABIS di heksagon {i}/{n}. {ok} heksagon tersimpan sebelum itu."
                    "\n  Jalankan ulang perintah yang sama sesudah kuotanya pulih; yang sudah"
                    " ada tidak ditarik lagi."
                )
                status(db)
                return 3
            if isinstance(hasil, str):
                gagal += 1
                if len(gagal_contoh) < 5:
                    gagal_contoh.append(f"{t['h3_index']}: {hasil}")
            elif hasil[0]["jarak_m"] > maks_meter():
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
            print(f"  {jauh} dilewati karena rute utamanya di atas {maks_meter():.0f} m.")
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
