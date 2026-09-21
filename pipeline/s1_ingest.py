"""Tahap 1 - Tarik seluruh data mentah ke pipeline/data/01_mentah/."""

from __future__ import annotations

import argparse
import http.client
import json
import math
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from config import (
    BBOX,
    CINCIN_PILOT,
    DATA_MENTAH,
    H3_RESOLUSI,
    KAWASAN_PILOT,
    PUSAT,
    ROOT,
)

# --- Overpass --------------------------------------------------------------
# HANYA cermin sedunia. Ini bukan kerewelan - lihat catatan tepat di bawah.
CERMIN = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]


#: Kueri bukti: Stasiun Manggarai jelas ada di OSM dan tidak akan hilang.
#: Cermin yang menjawab nol untuk ini tidak memuat Indonesia.
_BUKTI = (
    '[out:json][timeout:60];node["railway"="station"]["name"="Manggarai"]'
    "(around:3000,-6.2131,106.8496);out ids;"
)

_cermin_sah: list[str] | None = None

# Overpass menolak permintaan tanpa User-Agent dengan 406, dan gejalanya
# menyesatkan: kueri yang sama persis berhasil lewat curl. Sopan santun API-nya
# juga menuntut identitas yang bisa dihubungi.
UA = "Loconomics/1.0 (MAPID WebGIS Competition 2026; https://github.com/loconomics)"

#: Radius tarik dari pusat kawasan. Heksagon terjauh dari pusat kawasannya
#: terukur 2.286 m (708 heksagon, seluruhnya), jadi 2.600 m cukup untuk apa pun
#: yang cuma perlu ISI heksagonnya sendiri - simpul transit termasuk.
RADIUS_M = 2600

RADIUS_POI_M = 3000

#: Diimpor dari config, tidak lagi ditulis ulang di sini. Salinan ketiga daftar
#: ini yang membuat pusat Harjamukti bisa meleset 4,4 km tanpa satu pun uji
#: menangkapnya - ketiganya cocok satu sama lain, dan ketiganya salah.


def _tembak(url: str, kueri: str, batas_waktu: int = 300) -> dict:
    """Satu permintaan ke satu cermin. Tanpa percobaan ulang, tanpa pilih-pilih."""
    req = urllib.request.Request(
        url,
        data=urllib.parse.urlencode({"data": kueri}).encode(),
        headers={"User-Agent": UA},
    )
    with urllib.request.urlopen(req, timeout=batas_waktu) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _sebab(e: Exception) -> str:
    """Satu baris yang cukup untuk memutuskan apa yang harus dilakukan."""
    kode = getattr(e, "code", None)
    return f"HTTP {kode}" if kode else f"{type(e).__name__}: {e}"


def _cermin_sedunia() -> list[str]:
    """Saring cermin yang benar-benar memuat Indonesia. Diperiksa sekali saja."""
    global _cermin_sah
    if _cermin_sah is not None:
        return _cermin_sah

    for putaran in range(4):
        sah, regional = [], []
        for url in CERMIN:
            nama = url.split("/")[2]
            try:
                n = len(_tembak(url, _BUKTI, batas_waktu=90).get("elements", []))
            except (OSError, http.client.HTTPException, json.JSONDecodeError) as e:
                print(f"    {nama:<26} dilewati - {_sebab(e)}")
                continue
            if n:
                sah.append(url)
                print(f"    {nama:<26} siap")
            else:
                regional.append(nama)
                print(f"    {nama:<26} DIBUANG - tidak memuat Indonesia")

        if sah:
            _cermin_sah = sah
            return sah
        if putaran < 3:
            tunggu = (30, 90, 180)[putaran]
            print(f"    (seluruh cermin sedang tumbang, menunggu {tunggu} dtk)")
            time.sleep(tunggu)

    raise SystemExit(
        "Tidak ada cermin Overpass yang bisa dipakai sekarang - seluruh instans\n"
        "publik menjawab galat. Ini keadaan sementara di sisi mereka, bukan di\n"
        "kode ini: coba lagi beberapa menit lagi. Kawasan yang sudah berhasil\n"
        "ditarik tersimpan di data/01_mentah/_singgah/ dan tidak akan diulang."
    )


def _overpass(kueri: str, percobaan: int = 4) -> dict:
    """Jalankan satu kueri Overpass, berpindah cermin kalau perlu."""
    galat: dict[str, str] = {}
    for putaran in range(percobaan):
        for url in _cermin_sedunia():
            try:
                return _tembak(url, kueri)
            except (OSError, http.client.HTTPException, json.JSONDecodeError) as e:
                galat[url.split("/")[2]] = _sebab(e)
                continue
        if putaran < percobaan - 1:
            tunggu = (15, 45, 90, 150)[min(putaran, 3)]
            print(f"      (semua cermin sibuk, menunggu {tunggu} dtk)")
            time.sleep(tunggu)

    rincian = "\n".join(f"  {nama:<26} {sebab}" for nama, sebab in galat.items())
    raise SystemExit(f"Overpass gagal di seluruh cermin:\n{rincian}")


def _tulis(nama: str, data: dict) -> Path:
    """Simpan apa adanya ke 01_mentah."""
    DATA_MENTAH.mkdir(parents=True, exist_ok=True)
    jalur = DATA_MENTAH / nama
    jalur.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return jalur


def _per_kawasan(bangun_kueri, label: str, jeda: float = 2.0, singgah: bool = True) -> dict:
    """Jalankan satu kueri per kawasan lalu gabungkan hasilnya."""
    kandang = DATA_MENTAH / "_singgah"
    kandang.mkdir(parents=True, exist_ok=True)

    gabung: dict[tuple[str, int], dict] = {}
    for kawasan in KAWASAN_PILOT:
        berkas = kandang / f"{label}_{kawasan.replace(' ', '_')}.json"
        if singgah and berkas.exists():
            hasil = json.loads(berkas.read_text(encoding="utf-8"))
            asal = "singgahan"
        else:
            lat, lon = PUSAT[kawasan]
            hasil = _overpass(bangun_kueri(lat, lon))
            berkas.write_text(json.dumps(hasil, ensure_ascii=False), encoding="utf-8")
            asal = "baru"

        baru = 0
        for e in hasil.get("elements", []):
            kunci = (e.get("type"), e.get("id"))
            if kunci not in gabung:
                e["_kawasan"] = kawasan
                gabung[kunci] = e
                baru += 1
        print(f"    {kawasan:<16} +{baru:>5} {label:<10} ({asal})")
        if asal == "baru":
            time.sleep(jeda)
    return {"elements": list(gabung.values())}


# ---------------------------------------------------------------------------
# Data misi MAPID
# ---------------------------------------------------------------------------


#: Endpoint misi MAPID. Ditemukan di https://maps.mapid.io/docs (SPA - harus
#: dirender peramban; PDF Technical Meeting hal. 83 menunjuk ke sana).
MAPID_MISI = "https://server.mapid.io/web/competition/{}"

#: Jenis misinya `struckgo`, BUKAN `strukgo`. Satu huruf salah -> 404, dan
#: 404-nya tidak menyebut nama misi yang benar.
JENIS_MISI = ("menugo", "struckgo", "propertigo", "activities")

#: Awal rentang tanggal `activities`. Jauh sebelum kompetisi dibuka, supaya
#: aktivitas warga yang lebih tua di wilayah yang sama ikut terbaca - D12
#: menghitung kegiatan komunitas, bukan kegiatan lomba.
AKTIVITAS_SEJAK = "2020-01-01"

#: Poligon Jabodetabek. Sengaja lebih luas daripada keenam kawasan pilot: satu
#: kueri untuk seluruh wilayah jauh lebih murah daripada enam kueri bertumpang
#: tindih, dan yang di luar kawasan gugur sendiri saat dipetakan ke heksagon.
POLIGON_JABODETABEK = [[
    [BBOX["lon_min"], BBOX["lat_min"]], [BBOX["lon_max"], BBOX["lat_min"]],
    [BBOX["lon_max"], BBOX["lat_max"]], [BBOX["lon_min"], BBOX["lat_max"]],
    [BBOX["lon_min"], BBOX["lat_min"]],
]]


def _kunci_mapid() -> str:
    """Dibaca dari backend/.env - satu tempat, sama seperti DATABASE_URL."""
    env = ROOT.parent / "backend" / ".env"
    k = os.environ.get("MAPID_DATA_API_KEY")
    if not k and env.exists():
        for baris in env.read_text(encoding="utf-8").splitlines():
            if baris.strip().startswith("MAPID_DATA_API_KEY="):
                k = baris.split("=", 1)[1].strip()
                break
    if not k:
        raise SystemExit(
            "MAPID_DATA_API_KEY kosong. Cara memperolehnya:\n"
            "  1. redeem kode MWGC26 di geo.mapid.io - satu tim satu akun\n"
            "  2. geo.mapid.io/dashboard?menu=map_service -> MAP SERVICES -> API Keys\n"
            "  3. isi MAPID_DATA_API_KEY di backend/.env"
        )
    return k


def _misi_sehalaman(jenis: str, kunci: str, offset: int) -> dict:
    """Satu permintaan. `activities` berbeda bentuk dari ketiga misi lain."""
    badan: dict[str, object] = {
        "feature": {"type": "Polygon", "coordinates": POLIGON_JABODETABEK}
    }
    # `activities` tidak mengenal offset sama sekali; mengirimnya tidak
    # menghasilkan galat, tetapi juga tidak melakukan apa-apa - dan itu jenis
    # kesalahan yang membuat orang mengira paginasinya rusak.
    if jenis != "activities":
        badan["offset"] = offset
    else:
        badan["start_date"] = AKTIVITAS_SEJAK
        badan["end_date"] = time.strftime("%Y-%m-%d")

    req = urllib.request.Request(
        MAPID_MISI.format(jenis),
        data=json.dumps(badan).encode(),
        headers={
            "Content-Type": "application/json",
            "x-api-key": kunci,
            "User-Agent": UA,
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))



RDTR_PROXY = "https://gistaru-proxy.atrbpn.go.id/proxy.ashx?"
RDTR_DKI = (
    "https://gistaru.atrbpn.go.id/arcgis/rest/services/"
    "054_RDTR_PROVINSI_DKI_JAKARTA/_RDTR_31A1_DKI_JAKARTA/MapServer/0"
)

RDTR_HEADER = {
    "Referer": "https://gistaru.atrbpn.go.id/rdtrinteraktif/",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
}

RDTR_FIELD = "KODZON,NAMZON,NAMOBJ,KRB_03,KODUNK,WADMKK,WADMKC,WADMKD,NOTHPR"


def _grid_pilot() -> dict[str, tuple[float, float]]:
    """708 heksagon beserta titik tengahnya, DIBANGKITKAN ULANG dari PUSAT."""
    import h3

    sel: dict[str, tuple[float, float]] = {}
    for lat, lon in PUSAT.values():
        for s in h3.grid_disk(h3.latlng_to_cell(lat, lon, H3_RESOLUSI), CINCIN_PILOT):
            sel[s] = h3.cell_to_latlng(s)
    return sel


def _rdtr_di_heksagon(sel: str) -> list[dict]:
    """Seluruh poligon RDTR yang memotong SATU heksagon, beserta geometrinya."""
    import h3

    cincin = [[lo, la] for la, lo in h3.cell_to_boundary(sel)]
    cincin.append(cincin[0])
    kueri = urllib.parse.urlencode({
        "f": "json",
        "geometry": json.dumps(
            {"rings": [cincin], "spatialReference": {"wkid": 4326}}, separators=(",", ":")
        ),
        "geometryType": "esriGeometryPolygon",
        "inSR": "4326",
        "outSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "KODZON,NAMZON,KRB_03,NOTHPR",
        "returnGeometry": "true",
        "maxAllowableOffset": "0.00002",
    })
    req = urllib.request.Request(f"{RDTR_PROXY}{RDTR_DKI}/query?{kueri}", headers=RDTR_HEADER)
    with urllib.request.urlopen(req, timeout=120) as resp:
        d = json.loads(resp.read().decode("utf-8"))
    if "error" in d:
        raise RuntimeError(f"RDTR: {d['error']}")
    return d.get("features") or []


def _potong_ke_heksagon(sel: str, fitur: list[dict]) -> list[dict]:
    """Poligon RDTR mentah -> (zona, KRB, luas perpotongan) untuk satu heksagon."""
    import h3
    from shapely.geometry import Polygon, shape

    hexagon = Polygon([(lo, la) for la, lo in h3.cell_to_boundary(sel)])
    if not hexagon.is_valid or hexagon.area <= 0:
        return []

    keluar = []
    for f in fitur:
        cincin = (f.get("geometry") or {}).get("rings")
        if not cincin:
            continue
        try:
            poli = shape({"type": "Polygon", "coordinates": cincin})
            if not poli.is_valid:
                poli = poli.buffer(0)
            luas = hexagon.intersection(poli).area
        except Exception:
            continue
        if luas <= 0:
            continue
        a = f.get("attributes") or {}
        keluar.append({
            "KODZON": a.get("KODZON"),
            "NAMZON": a.get("NAMZON"),
            "KRB_03": a.get("KRB_03"),
            # Pangsa luas heksagon, bukan meter persegi. Tak bersatuan, jadi
            # kebal terhadap perbedaan luas antar-sel H3.
            "pangsa": round(luas / hexagon.area, 6),
        })
    return keluar


def tarik_rdtr() -> Path:
    """Zonasi RDTR per heksagon -> bahan L01, L02, L03."""
    kandang = DATA_MENTAH / "_singgah"
    kandang.mkdir(parents=True, exist_ok=True)
    berkas = kandang / "rdtr_dki.json"
    hasil: dict[str, list] = (
        json.loads(berkas.read_text(encoding="utf-8")) if berkas.exists() else {}
    )

    grid = _grid_pilot()
    sisa = [s for s in grid if s not in hasil]
    print(f"  RDTR ATR/BPN: {len(hasil)} tersinggahkan, {len(sisa)} tersisa dari {len(grid)}")

    for i, sel in enumerate(sisa, 1):
        try:
            hasil[sel] = _potong_ke_heksagon(sel, _rdtr_di_heksagon(sel))
        except (OSError, http.client.HTTPException, json.JSONDecodeError, RuntimeError) as e:
            print(f"    {sel} dilewati - {_sebab(e)}")
            continue
        if i % 10 == 0 or i == len(sisa):
            berkas.write_text(json.dumps(hasil, ensure_ascii=False), encoding="utf-8")
            ada = sum(1 for v in hasil.values() if v)
            print(f"    {i}/{len(sisa)}  ({ada} berzona)")
        time.sleep(0.35)

    berkas.write_text(json.dumps(hasil, ensure_ascii=False), encoding="utf-8")
    jalur = _tulis("rdtr_dki.json", hasil)
    ada = sum(1 for v in hasil.values() if v)
    print(f"\n  {ada} dari {len(hasil)} heksagon punya zona RDTR -> {jalur.name}")
    return jalur



INARISK = (
    "https://gis.bnpb.go.id/server/rest/services/inarisk/"
    "INDEKS_BAHAYA_BANJIR/ImageServer/computeStatisticsHistograms"
)


def _inarisk_di_heksagon(sel: str) -> dict | None:
    """Statistik piksel bahaya banjir di dalam SATU heksagon, atau None."""
    import h3

    cincin = [[lo, la] for la, lo in h3.cell_to_boundary(sel)]
    cincin.append(cincin[0])
    kueri = urllib.parse.urlencode({
        "f": "json",
        "geometryType": "esriGeometryPolygon",
        "geometry": json.dumps(
            {"rings": [cincin], "spatialReference": {"wkid": 4326}}, separators=(",", ":")
        ),
    })
    req = urllib.request.Request(f"{INARISK}?{kueri}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=90) as r:
        d = json.loads(r.read().decode("utf-8"))

    st = (d.get("statistics") or [None])[0]
    if not st:
        # Poligon utuh tanpa satu pun piksel berdata. Disimpan sebagai None
        # supaya s7 bisa membedakannya dari "terukur dan hasilnya rendah".
        return None
    return {
        "mean": st.get("mean"),
        "min": st.get("min"),
        "max": st.get("max"),
        "n_piksel": st.get("count"),
    }


def tarik_inarisk() -> Path:
    """Indeks Bahaya Banjir InaRISK per heksagon. DITARIK, TIDAK DIMUAT."""
    kandang = DATA_MENTAH / "_singgah"
    kandang.mkdir(parents=True, exist_ok=True)
    berkas = kandang / "inarisk_banjir.json"
    hasil: dict[str, dict | None] = (
        json.loads(berkas.read_text(encoding="utf-8")) if berkas.exists() else {}
    )

    grid = _grid_pilot()
    sisa = [s for s in grid if s not in hasil]
    print(f"  InaRISK BNPB: {len(hasil)} tersinggahkan, {len(sisa)} tersisa dari {len(grid)}")

    for i, sel in enumerate(sisa, 1):
        try:
            hasil[sel] = _inarisk_di_heksagon(sel)
        except (OSError, http.client.HTTPException, json.JSONDecodeError) as e:
            print(f"    {sel} dilewati - {_sebab(e)}")
            continue
        if i % 25 == 0 or i == len(sisa):
            berkas.write_text(json.dumps(hasil, ensure_ascii=False), encoding="utf-8")
            ada = sum(1 for v in hasil.values() if v)
            print(f"    {i}/{len(sisa)}  ({ada} berdata)")
        time.sleep(0.25)

    berkas.write_text(json.dumps(hasil, ensure_ascii=False), encoding="utf-8")
    jalur = _tulis("inarisk_banjir.json", hasil)
    ada = sum(1 for v in hasil.values() if v)
    print(f"\n  {ada} dari {len(hasil)} heksagon punya indeks bahaya banjir -> {jalur.name}")
    return jalur


def tarik_misi_mapid() -> Path:
    """Properti Go / Struk Go / Menu Go / Activities lewat MAPID Data API."""
    kunci = _kunci_mapid()
    ringkas: dict[str, int] = {}
    gabung: dict[str, list] = {}

    print("  Menarik data misi MAPID:")
    for jenis in JENIS_MISI:
        titik: list = []
        offset = 0
        while True:
            d = _misi_sehalaman(jenis, kunci, offset)
            if not d.get("success"):
                raise SystemExit(f"{jenis}: {d.get('message')}")

            if jenis == "activities":
                titik = d.get("data", {}).get("activities", [])
                break

            baru = d.get("features", [])
            titik += baru
            pg = d.get("pagination", {})
            if not pg.get("hasMore"):
                break
            offset += len(baru)
            time.sleep(1.0)

        gabung[jenis] = titik
        ringkas[jenis] = len(titik)
        print(f"    {jenis:<12} {len(titik):>5} titik")
        time.sleep(1.0)

    jalur = _tulis("mapid_misi.json", gabung)
    print(f"\n  {sum(ringkas.values())} titik -> {jalur.name}")
    return jalur




def tarik_simpul_transit() -> Path:
    """Simpul transportasi darat di dalam keenam kawasan pilot."""
    print("  Memeriksa cermin Overpass:")
    _cermin_sedunia()

    print("\n  Stasiun rel:")
    rel = _per_kawasan(
        lambda lat, lon: (
            f"[out:json][timeout:180];("
            f'node["railway"~"^(station|halt)$"](around:{RADIUS_M},{lat},{lon});'
            f'way["railway"~"^(station|halt)$"](around:{RADIUS_M},{lat},{lon});'
            f");out center tags;"
        ),
        "stasiun",
    )

    print("  Terminal dan simpul angkutan:")
    terminal = _per_kawasan(
        lambda lat, lon: (
            f"[out:json][timeout:180];("
            f'node["amenity"="bus_station"](around:{RADIUS_M},{lat},{lon});'
            f'way["amenity"="bus_station"](around:{RADIUS_M},{lat},{lon});'
            f'node["public_transport"="station"](around:{RADIUS_M},{lat},{lon});'
            f");out center tags;"
        ),
        "terminal",
    )

    print("  Halte bus:")
    halte = _per_kawasan(
        lambda lat, lon: (
            f"[out:json][timeout:180];"
            f'node["highway"="bus_stop"](around:{RADIUS_M},{lat},{lon});'
            f"out tags;"
        ),
        "halte",
    )

    gabung = {"elements": rel["elements"] + terminal["elements"] + halte["elements"]}
    jalur = _tulis("osm_simpul.json", gabung)
    print(f"\n  {len(gabung['elements'])} elemen -> {jalur.name}")
    return jalur


TAG_POI = [
    'node["shop"]', 'way["shop"]',
    'node["amenity"~"^(restaurant|cafe|fast_food|food_court|bar|pub|ice_cream|'
    'pharmacy|clinic|doctors|dentist|hospital|bank|atm|bureau_de_change|'
    'fuel|car_rental|driving_school|marketplace|'
    'school|college|university|kindergarten|place_of_worship)$"]',
    'way["amenity"~"^(restaurant|cafe|fast_food|food_court|marketplace|hospital|'
    'clinic|school|college|university|place_of_worship)$"]',
    'node["office"]', 'way["office"]',
    'node["healthcare"]', 'node["craft"]',
    'node["leisure"~"^(fitness_centre|sports_centre)$"]',
    'node["tourism"~"^(hotel|guest_house|hostel)$"]',
    'way["tourism"~"^(hotel|guest_house|hostel)$"]',
]


def tarik_osm_poi() -> Path:
    """POI usaha - bahan dimensi Kompetisi (C01-C08) dan sebagian Permintaan."""
    print("  POI usaha:")
    hasil = _per_kawasan(
        lambda lat, lon: (
            f"[out:json][timeout:240];("
            + "".join(f"{t}(around:{RADIUS_POI_M},{lat},{lon});" for t in TAG_POI)
            + ");out center tags;"
        ),
        "POI",
        jeda=3.0,
    )
    jalur = _tulis("osm_poi.json", hasil)
    print(f"\n  {len(hasil['elements'])} POI -> {jalur.name}")
    return jalur



#: Induk H3 yang dipakai mengelompokkan titik berlabel. Res-7 lingkar luarnya
#: ~1,4 km, jadi RADIUS_POI_LUAR_M menutupinya dengan bantalan yang lapang.
RES_KELOMPOK = 7
RADIUS_POI_LUAR_M = 2500

HARGA_PORSI_WARAS = (1_000.0, 200_000.0)


def sel_berlabel_luar_grid(berkas_misi: Path | None = None) -> dict[str, list[float]]:
    """Heksagon res-9 yang punya harga Menu Go dan ada DI LUAR grid 708."""
    import h3

    berkas_misi = berkas_misi or DATA_MENTAH / "mapid_misi.json"
    if not berkas_misi.exists():
        raise SystemExit(
            f"{berkas_misi} belum ada. Jalankan dulu:  python s1_ingest.py --misi"
        )

    grid: set[str] = set()
    for lat, lon in PUSAT.values():
        grid |= set(h3.grid_disk(h3.latlng_to_cell(lat, lon, H3_RESOLUSI), CINCIN_PILOT))

    lo, hi = HARGA_PORSI_WARAS
    keluar: dict[str, list[float]] = {}
    for baris in json.loads(berkas_misi.read_text(encoding="utf-8")).get("menugo", []):
        p = baris.get("properties") or {}
        c = (baris.get("geometry") or {}).get("coordinates")
        if not (isinstance(c, list) and len(c) >= 2):
            continue
        try:
            harga = float(p.get("harga_rata_rata"))
        except (TypeError, ValueError):
            continue
        if not (lo <= harga <= hi):
            continue
        sel = h3.latlng_to_cell(float(c[1]), float(c[0]), H3_RESOLUSI)
        if sel in grid:
            continue
        keluar.setdefault(sel, []).append(harga)
    return keluar


def tarik_poi_luar() -> Path:
    """POI OSM di sekitar heksagon berlabel yang ada di luar grid."""
    import h3

    sel = sel_berlabel_luar_grid()
    if not sel:
        raise SystemExit(
            "Tidak ada heksagon berlabel di luar grid - tidak ada yang perlu ditarik."
        )

    kelompok = sorted({h3.cell_to_parent(k, RES_KELOMPOK) for k in sel})
    print(f"  {len(sel)} heksagon berlabel di luar grid")
    print(f"  dikelompokkan jadi {len(kelompok)} penarikan res-{RES_KELOMPOK}\n")

    kandang = DATA_MENTAH / "_singgah"
    kandang.mkdir(parents=True, exist_ok=True)

    gabung: dict[tuple[str, int], dict] = {}
    for i, induk in enumerate(kelompok, 1):
        berkas = kandang / f"POIluar_{induk}.json"
        if berkas.exists():
            hasil = json.loads(berkas.read_text(encoding="utf-8"))
            asal = "singgahan"
        else:
            lat, lon = h3.cell_to_latlng(induk)
            hasil = _overpass(
                "[out:json][timeout:240];("
                + "".join(
                    f"{t}(around:{RADIUS_POI_LUAR_M},{lat},{lon});" for t in TAG_POI
                )
                + ");out center tags;"
            )
            berkas.write_text(json.dumps(hasil, ensure_ascii=False), encoding="utf-8")
            asal = "baru"

        baru = 0
        for e in hasil.get("elements", []):
            kunci = (e.get("type"), e.get("id"))
            if kunci not in gabung:
                e["_kawasan"] = f"luar:{induk}"
                gabung[kunci] = e
                baru += 1
        print(f"    [{i:>2}/{len(kelompok)}] {induk}  +{baru:>5} POI  ({asal})")
        if asal == "baru":
            time.sleep(3.0)

    jalur = _tulis(
        "osm_poi_luar.json",
        {"elements": list(gabung.values()), "kelompok": kelompok},
    )
    print(f"\n  {len(gabung)} POI -> {jalur.name}")
    return jalur



RADIUS_BANGUNAN_M = 2500

PETAK_BANGUNAN = 3

#: Meter per derajat di lintang Jakarta. Bujur dikoreksi cos(lintang); memakai
#: angka lintang untuk keduanya menggeser petak paling timur sekitar 20 m.
_M_PER_DEG_LAT = 110_574.0


def _petak(lat: float, lon: float, radius_m: int, n: int) -> list[tuple[float, float, float, float]]:
    """Bagi kotak sekeliling satu titik jadi n x n bbox Overpass."""
    m_per_deg_lon = 111_320.0 * math.cos(math.radians(lat))
    d_lat = radius_m / _M_PER_DEG_LAT
    d_lon = radius_m / m_per_deg_lon
    hasil = []
    for i in range(n):
        for j in range(n):
            hasil.append((
                lat - d_lat + 2 * d_lat * i / n,
                lon - d_lon + 2 * d_lon * j / n,
                lat - d_lat + 2 * d_lat * (i + 1) / n,
                lon - d_lon + 2 * d_lon * (j + 1) / n,
            ))
    return hasil


def tarik_osm_bangunan() -> Path:
    """Footprint bangunan - bahan M01 rasio tutupan dan M02 luas median."""
    print("  Memeriksa cermin Overpass:")
    _cermin_sedunia()

    kandang = DATA_MENTAH / "_singgah"
    kandang.mkdir(parents=True, exist_ok=True)
    gabung: dict[tuple[str, int], dict] = {}

    print(f"\n  Footprint bangunan ({PETAK_BANGUNAN}x{PETAK_BANGUNAN} petak per kawasan):")
    for kawasan in KAWASAN_PILOT:
        lat, lon = PUSAT[kawasan]
        n_kawasan = 0
        for k, (s, b, u, t) in enumerate(_petak(lat, lon, RADIUS_BANGUNAN_M, PETAK_BANGUNAN)):
            berkas = kandang / f"bangunan_{kawasan.replace(' ', '_')}_{k}.json"
            if berkas.exists():
                hasil = json.loads(berkas.read_text(encoding="utf-8"))
                asal = "singgahan"
            else:
                hasil = _overpass(
                    f"[out:json][timeout:280];"
                    f'way["building"]({s:.6f},{b:.6f},{u:.6f},{t:.6f});'
                    f"out geom;"
                )
                berkas.write_text(json.dumps(hasil, ensure_ascii=False), encoding="utf-8")
                asal = "baru"

            baru = 0
            for e in hasil.get("elements", []):
                kunci = (e.get("type"), e.get("id"))
                if kunci not in gabung:
                    e["_kawasan"] = kawasan
                    gabung[kunci] = e
                    baru += 1
            n_kawasan += baru
            print(f"    {kawasan:<16} petak {k + 1}/{PETAK_BANGUNAN ** 2}  +{baru:>6}  ({asal})")
            if asal == "baru":
                time.sleep(3.0)
        print(f"    {kawasan:<16} SUBTOTAL {n_kawasan}")

    jalur = _tulis("osm_bangunan.json", {"elements": list(gabung.values())})
    print(f"\n  {len(gabung)} bangunan -> {jalur.name}")
    return jalur


# ---------------------------------------------------------------------------
# Blok di dalam heksagon: jaringan jalan dan zonasi per blok
# ---------------------------------------------------------------------------

KELAS_JALAN_OSM = (
    "motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|"
    "secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|pedestrian"
)


def tarik_osm_jalan() -> Path:
    """Ruas jalan OSM di sekitar keenam kawasan - bahan indikator "tepi jalan" blok."""
    print("  Memeriksa cermin Overpass:")
    _cermin_sedunia()
    print("\n  Jaringan jalan per kawasan:")
    data = _per_kawasan(
        lambda lat, lon: (
            f"[out:json][timeout:280];"
            f'way["highway"~"^({KELAS_JALAN_OSM})$"](around:{RADIUS_M},{lat},{lon});'
            f"out geom;"
        ),
        "jalan",
        jeda=4.0,
    )
    jalur = _tulis("osm_jalan.json", data)
    print(f"\n  {len(data['elements'])} ruas jalan -> {jalur.name}")
    return jalur


def _potong_ke_blok(induk: str, fitur: list[dict], resolusi: int) -> dict[str, list[dict]]:
    """Poligon RDTR satu heksagon -> pangsa zona untuk tiap anak blok-nya."""
    import h3
    from shapely.geometry import Polygon, shape

    poligon = []
    for f in fitur:
        cincin = (f.get("geometry") or {}).get("rings")
        if not cincin:
            continue
        try:
            poli = shape({"type": "Polygon", "coordinates": cincin})
            if not poli.is_valid:
                poli = poli.buffer(0)
        except Exception:
            continue
        poligon.append((poli, f.get("attributes") or {}))

    keluar: dict[str, list[dict]] = {}
    for anak in h3.cell_to_children(induk, resolusi):
        blok = Polygon([(lo, la) for la, lo in h3.cell_to_boundary(anak)])
        if not blok.is_valid or blok.area <= 0:
            continue
        zona = []
        for poli, a in poligon:
            try:
                luas = blok.intersection(poli).area
            except Exception:
                continue
            if luas <= 0:
                continue
            zona.append({
                "KODZON": a.get("KODZON"),
                "NAMZON": a.get("NAMZON"),
                "KRB_03": a.get("KRB_03"),
                "pangsa": round(luas / blok.area, 6),
            })
        keluar[anak] = zona
    return keluar


def tarik_rdtr_blok() -> Path:
    """Zonasi RDTR per BLOK (anak H3 resolusi `H3_RESOLUSI_BLOK`), DKI saja."""
    from config import H3_RESOLUSI_BLOK

    per_hex = DATA_MENTAH / "rdtr_dki.json"
    if not per_hex.exists():
        raise SystemExit("rdtr_dki.json belum ada. Jalankan dulu:  python s1_ingest.py --rdtr")
    berzona = sorted(s for s, v in json.loads(per_hex.read_text(encoding="utf-8")).items() if v)
    grid = set(_grid_pilot())
    berzona = [s for s in berzona if s in grid]

    kandang = DATA_MENTAH / "_singgah"
    kandang.mkdir(parents=True, exist_ok=True)
    berkas = kandang / "rdtr_blok.json"
    hasil: dict[str, dict] = json.loads(berkas.read_text(encoding="utf-8")) if berkas.exists() else {}
    sisa = [s for s in berzona if s not in hasil]
    print(f"  RDTR per blok: {len(hasil)} induk tersinggahkan, {len(sisa)} tersisa dari {len(berzona)}")

    for i, sel in enumerate(sisa, 1):
        try:
            hasil[sel] = _potong_ke_blok(sel, _rdtr_di_heksagon(sel), H3_RESOLUSI_BLOK)
        except (OSError, http.client.HTTPException, json.JSONDecodeError, RuntimeError) as e:
            print(f"    {sel} dilewati - {_sebab(e)}")
            continue
        if i % 20 == 0 or i == len(sisa):
            berkas.write_text(json.dumps(hasil, ensure_ascii=False), encoding="utf-8")
            print(f"    {i}/{len(sisa)}")
        time.sleep(0.35)

    berkas.write_text(json.dumps(hasil, ensure_ascii=False), encoding="utf-8")
    # Diratakan jadi blok -> zona, bentuk yang dibaca s4. Induknya tidak perlu
    # disimpan: ia bisa diturunkan dari blok kapan saja lewat h3.cell_to_parent.
    datar = {blok: zona for anak in hasil.values() for blok, zona in anak.items()}
    jalur = _tulis("rdtr_blok.json", datar)
    ada = sum(1 for v in datar.values() if v)
    print(f"\n  {ada} dari {len(datar)} blok punya zona RDTR -> {jalur.name}")
    return jalur


# ---------------------------------------------------------------------------
# Data sekunder
# ---------------------------------------------------------------------------


def tarik_data_sekunder() -> None:
    """WorldPop, NJOP, RDTR, Open Buildings, InaRISK, Overture."""
    raise NotImplementedError


#: Relasi rute yang dihitung. `ferry` dan `tram` ikut supaya kueri tidak perlu
#: diubah kalau suatu saat wilayahnya melebar; keduanya memang nol di Jabodetabek.
RUTE_MODA = "bus|trolleybus|train|subway|light_rail|tram|monorail|ferry|share_taxi|minibus"


def tarik_rute_transit() -> Path:
    """Relasi rute angkutan umum - bahan D05 `skor_simpul`."""
    print("  Memeriksa cermin Overpass:")
    _cermin_sedunia()

    print()
    print("  Relasi rute angkutan umum:")
    hasil = _per_kawasan(
        lambda lat, lon: (
            f"[out:json][timeout:240];"
            f'rel["type"="route"]["route"~"^({RUTE_MODA})$"]'
            f"(around:{RADIUS_POI_M},{lat},{lon});"
            f"out body;"
        ),
        "rute",
        jeda=3.0,
    )
    jalur = _tulis("osm_rute.json", hasil)
    print()
    print(f"  {len(hasil['elements'])} relasi rute -> {jalur.name}")
    return jalur


#: Berapa banyak id simpul yang diminta sekali jalan. `node(id:...)` adalah
#: pencarian TERINDEKS, jadi yang membatasi bukan beratnya melainkan panjang
#: badan permintaan dan besar responsnya.
PETAK_ID = 2000


def tarik_henti_transit(berkas_rute: Path | None = None) -> Path:
    """Koordinat titik henti yang BENAR-BENAR dilewati rute - pasangan --rute."""
    berkas_rute = berkas_rute or DATA_MENTAH / "osm_rute.json"
    if not berkas_rute.exists():
        raise SystemExit(
            f"{berkas_rute.name} belum ada. Jalankan dulu:  "
            f"python s1_ingest.py --rute"
        )

    relasi = json.loads(berkas_rute.read_text(encoding="utf-8")).get("elements", [])
    # Hanya anggota berperan henti. Anggota berperan kosong adalah ruas jalan
    # yang dilalui, dan koordinatnya tidak menjawab pertanyaan apa pun di sini.
    ref_node, ref_way = set(), set()
    for r in relasi:
        for m in r.get("members") or []:
            if not (m.get("role") or "").startswith(("stop", "platform")):
                continue
            (ref_node if m.get("type") == "node" else ref_way).add(m.get("ref"))

    print(f"  {len(relasi)} relasi rute -> {len(ref_node)} simpul + {len(ref_way)} way")
    if not ref_node and not ref_way:
        raise SystemExit("Tidak ada anggota berperan henti - periksa osm_rute.json")

    print("  Memeriksa cermin Overpass:")
    _cermin_sedunia()

    kumpul: dict[tuple, dict] = {}
    for jenis, refs in (("node", sorted(ref_node)), ("way", sorted(ref_way))):
        if not refs:
            continue
        for i in range(0, len(refs), PETAK_ID):
            petak = refs[i : i + PETAK_ID]
            daftar = ",".join(str(x) for x in petak)
            hasil = _overpass(
                f"[out:json][timeout:180];{jenis}(id:{daftar});out center;"
            )
            for e in hasil.get("elements", []):
                kumpul[(e.get("type"), e.get("id"))] = e
            print(f"    {jenis:4s} {i + len(petak):5d}/{len(refs):5d}  "
                  f"terkumpul {len(kumpul)}")
            time.sleep(2.0)

    data = {"elements": list(kumpul.values())}
    jalur = _tulis("osm_henti.json", data)
    print()
    print(f"  {len(data['elements'])} titik henti berkoordinat -> {jalur.name}")
    return jalur


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Tarik data mentah")
    p.add_argument("--simpul", action="store_true", help="Simpul transit OSM")
    p.add_argument("--poi", action="store_true", help="POI usaha OSM")
    p.add_argument(
        "--poi-luar",
        action="store_true",
        help="POI di sekitar titik misi DI LUAR grid - bahan latih GapFill",
    )
    p.add_argument("--bangunan", action="store_true", help="Footprint bangunan OSM")
    p.add_argument("--semua-osm", action="store_true", help="Ketiganya sekaligus")
    p.add_argument("--misi", action="store_true", help="Data misi MAPID (butuh MAPID_DATA_API_KEY)")
    p.add_argument("--rdtr", action="store_true", help="Zonasi RDTR ATR/BPN -> L01, L02, L03 (DKI saja)")
    p.add_argument("--inarisk", action="store_true",
                   help="Indeks Bahaya Banjir InaRISK BNPB -> L03 di luar DKI")
    p.add_argument("--rute", action="store_true", help="Relasi rute angkutan umum OSM -> D05")
    p.add_argument("--henti", action="store_true",
                   help="Titik henti angkutan umum berkoordinat -> D05")
    p.add_argument("--jalan", action="store_true",
                   help="Ruas jalan OSM -> indikator tepi jalan tiap blok")
    p.add_argument("--rdtr-blok", action="store_true",
                   help="Zonasi RDTR dipotong per blok (anak H3 res-10), DKI saja")
    arg = p.parse_args()

    if not any([arg.simpul, arg.poi, arg.poi_luar, arg.bangunan, arg.semua_osm,
                arg.misi, arg.rdtr, arg.inarisk, arg.rute, arg.henti,
                arg.jalan, arg.rdtr_blok]):
        p.print_help()
        print(f"\nWilayah: {', '.join(KAWASAN_PILOT)}")
        print(f"BBOX   : {BBOX}")
        raise SystemExit(0)

    if arg.misi:
        tarik_misi_mapid()
    if arg.rdtr:
        tarik_rdtr()
    if arg.inarisk:
        tarik_inarisk()
    if arg.simpul or arg.semua_osm:
        tarik_simpul_transit()
    if arg.poi or arg.semua_osm:
        tarik_osm_poi()
    if arg.poi_luar:
        print("POI di luar grid (bahan latih GapFill):")
        tarik_poi_luar()
    if arg.bangunan or arg.semua_osm:
        tarik_osm_bangunan()
    if arg.rute or arg.semua_osm:
        tarik_rute_transit()
    if arg.henti or arg.semua_osm:
        tarik_henti_transit()
    if arg.jalan:
        tarik_osm_jalan()
    if arg.rdtr_blok:
        tarik_rdtr_blok()
