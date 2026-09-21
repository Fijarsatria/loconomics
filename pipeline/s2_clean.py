"""Tahap 2 - Pembersihan dan standardisasi."""

import math
import re
from datetime import datetime

import h3
import pandas as pd

from config import (
    BBOX,
    H3_RESOLUSI,
    JARINGAN_BRT,
    JARINGAN_KOMUTER,
    HARGA_PORSI_MAKS,
    HARGA_PORSI_MIN,
    NILAI_JENIS_PROPERTI,
    NILAI_MOBILITAS,
    is_waralaba,
    kelas_dari_tag,
    kunci_nilai,
)


def bersihkan_koordinat(lat_mentah, lon_mentah) -> tuple[float, float] | None:
    """Lima langkah berurutan. Mengembalikan None kalau titik harus dibuang."""
    # 1. Struk Go menyimpan lat/lon sebagai TEXT, pemisah desimal bisa titik atau koma
    try:
        lat = float(str(lat_mentah).strip().replace(",", "."))
        lon = float(str(lon_mentah).strip().replace(",", "."))
    except (TypeError, ValueError):
        return None

    if math.isnan(lat) or math.isnan(lon):
        return None

    # 2. Buang null island
    if lat == 0 and lon == 0:
        return None

    # 3. Deteksi lat/lon tertukar - kesalahan input yang umum
    if abs(lat) > 90 or (abs(lat) > 100 and abs(lon) < 90):
        lat, lon = lon, lat

    # 4. Validasi bounding box Jabodetabek
    if not (BBOX["lat_min"] <= lat <= BBOX["lat_max"]):
        return None
    if not (BBOX["lon_min"] <= lon <= BBOX["lon_max"]):
        return None

    # 5. Snapping drift GPS dilakukan terpisah di snap_ke_geometri(), setelah
    #    langkah di atas - supaya tidak menempelkan titik yang sebenarnya sampah.
    return lat, lon


# ---------------------------------------------------------------------------
# OpenStreetMap -> baris business_pois
# ---------------------------------------------------------------------------


def _titik_osm(e: dict) -> tuple[float, float] | None:
    """Koordinat satu elemen Overpass, node maupun way."""
    if "lat" in e and "lon" in e:
        return bersihkan_koordinat(e["lat"], e["lon"])
    pusat = e.get("center")
    if pusat:
        return bersihkan_koordinat(pusat.get("lat"), pusat.get("lon"))
    return None


def poi_dari_osm(elemen: list[dict]) -> pd.DataFrame:
    """Elemen Overpass mentah -> baris siap masuk `business_pois`."""
    baris = []
    for e in elemen:
        tag = e.get("tags") or {}
        nama = (tag.get("name") or "").strip()
        if not nama:
            continue
        cocok = kelas_dari_tag(tag)
        if cocok is None:
            continue
        titik = _titik_osm(e)
        if titik is None:
            continue
        kelas, asal = cocok
        lat, lon = titik
        baris.append(
            {
                "h3_index": h3.latlng_to_cell(lat, lon, H3_RESOLUSI),
                "nama": nama[:200],
                "kelas_induk": kelas,
                "kategori_asli": asal,
                "sumber": "osm",
                "is_waralaba": is_waralaba(tag),
                # Tidak disimpan ke `business_pois` - dipakai s4 untuk C04 lalu
                # dibuang. Ditumpangkan di sini supaya tag mentahnya tidak perlu
                # dibaca dua kali dari berkas 2,5 MB.
                "cuisine": (tag.get("cuisine") or "").strip().lower(),
                "lat": lat,
                "lon": lon,
            }
        )
    return pd.DataFrame(
        baris,
        columns=[
            "h3_index", "nama", "kelas_induk", "kategori_asli",
            "sumber", "is_waralaba", "cuisine", "lat", "lon",
        ],
    )


def rute_dari_osm(elemen: list[dict]) -> pd.DataFrame:
    """Relasi rute Overpass -> pasangan (titik henti, rute) - bahan D05."""
    baris = []
    for e in elemen:
        if e.get("type") != "relation":
            continue
        tag = e.get("tags") or {}
        moda = (tag.get("route") or "").strip().lower()
        if not moda:
            continue
        jaringan = f"{tag.get('network', '')} {tag.get('operator', '')}".lower()
        if moda in ("bus", "trolleybus") and any(b in jaringan for b in JARINGAN_BRT):
            moda = "brt"
        elif moda == "train" and not any(k in jaringan for k in JARINGAN_KOMUTER):
            moda = "antarkota"
        nomor = (tag.get("ref") or "").strip()
        lin = (
            f"{moda}|{(tag.get('network') or '').strip()}|{nomor}"
            if nomor
            else f"{moda}|relasi|{e.get('id')}"
        )
        for m in e.get("members") or []:
            peran = m.get("role") or ""
            if not peran.startswith(("stop", "platform")):
                continue
            baris.append(
                {
                    "ref": f"{m.get('type')}/{m.get('ref')}",
                    "lin": lin,
                    "moda": moda,
                }
            )
    df = pd.DataFrame(baris, columns=["ref", "lin", "moda"])
    # Satu lin sering mendaftarkan stop_position DAN platform untuk perhentian
    # yang sama. Keduanya ref yang berbeda, jadi dedup di sini tidak menolong;
    # yang menolong menghitung lin UNIK per heksagon, dan itu tugas s4.
    return df.drop_duplicates()


def henti_dari_osm(elemen: list[dict]) -> pd.DataFrame:
    """Titik henti berkoordinat -> (ref, lat, lon) - pasangan `rute_dari_osm`."""
    baris = []
    for e in elemen:
        titik = _titik_osm(e)
        if titik is None:
            continue
        lat, lon = titik
        baris.append(
            {
                "ref": f"{e.get('type')}/{e.get('id')}",
                "h3_index": h3.latlng_to_cell(lat, lon, H3_RESOLUSI),
                "lat": lat,
                "lon": lon,
            }
        )
    return pd.DataFrame(baris, columns=["ref", "h3_index", "lat", "lon"]).drop_duplicates("ref")


def simpul_dari_osm(elemen: list[dict]) -> pd.DataFrame:
    """Elemen Overpass -> baris `transport_nodes`."""
    peta_station = {"subway": "MRT", "light_rail": "LRT"}
    baris = []
    for e in elemen:
        tag = e.get("tags") or {}
        nama = (tag.get("name") or "").strip()
        if not nama:
            continue
        titik = _titik_osm(e)
        if titik is None:
            continue
        if tag.get("station") in peta_station:
            moda = peta_station[tag["station"]]
        elif tag.get("railway") in ("station", "halt"):
            moda = "KRL"
        elif tag.get("amenity") == "bus_station":
            moda = "TERMINAL"
        elif tag.get("highway") == "bus_stop":
            moda = "BRT"
        elif tag.get("public_transport") == "station":
            moda = "TERMINAL"
        else:
            continue
        lat, lon = titik
        baris.append(
            {
                "osm_id": f"{e.get('type')}/{e.get('id')}",
                "nama": nama[:120],
                "moda": moda,
                "kawasan": e.get("_kawasan"),
                "lat": lat,
                "lon": lon,
            }
        )
    return pd.DataFrame(
        baris, columns=["osm_id", "nama", "moda", "kawasan", "lat", "lon"]
    )


KONTEKS_OSM: dict[tuple[str, str], str] = {
    ("amenity", "school"): "sekolah",
    ("amenity", "college"): "sekolah",
    ("amenity", "university"): "sekolah",
    ("amenity", "kindergarten"): "sekolah",
    ("amenity", "hospital"): "rumah_sakit",
    ("amenity", "marketplace"): "pasar",
}


def konteks_dari_osm(elemen: list[dict]) -> pd.DataFrame:
    """Elemen Overpass -> (h3_index, jenis) untuk D08 dan D09."""
    baris = []
    for jenis, lat, lon in _konteks_bertitik(elemen):
        baris.append({"h3_index": h3.latlng_to_cell(lat, lon, H3_RESOLUSI), "jenis": jenis})
    return pd.DataFrame(baris, columns=["h3_index", "jenis"])


def _jenis_konteks(tag: dict) -> list[str]:
    """Aturan penggolongan konteks - SATU tempat, dipakai heksagon dan blok."""
    jenis = []
    if tag.get("office"):
        jenis.append("kantor")
    cocok = KONTEKS_OSM.get(("amenity", tag.get("amenity", "")))
    if cocok:
        jenis.append(cocok)
    if tag.get("amenity") == "place_of_worship" and tag.get("religion") == "muslim":
        jenis.append("ibadah")
    return jenis


def _konteks_bertitik(elemen: list[dict]):
    """(jenis, lat, lon) per elemen konteks. Satu elemen bisa menyumbang dua."""
    for e in elemen:
        tag = e.get("tags") or {}
        if not tag:
            continue
        jenis = _jenis_konteks(tag)
        if not jenis:
            continue
        titik = _titik_osm(e)
        if titik is None:
            continue
        for j in jenis:
            yield j, titik[0], titik[1]


def konteks_bertitik_dari_osm(elemen: list[dict]) -> pd.DataFrame:
    """Kembaran `konteks_dari_osm` yang MEMPERTAHANKAN koordinatnya."""
    return pd.DataFrame(list(_konteks_bertitik(elemen)), columns=["jenis", "lat", "lon"])


def snap_ke_geometri(lat: float, lon: float, jaringan_jalan, bangunan):
    """Tempel titik ke bangunan/jalan terdekat kalau jaraknya <= SNAP_GPS_M."""
    raise NotImplementedError


def bersihkan_harga_porsi(nilai) -> float | None:
    """Menu Go: satu-satunya angka rupiah native di seluruh data misi."""
    try:
        harga = float(nilai)
    except (TypeError, ValueError):
        return None
    if harga < HARGA_PORSI_MIN or harga > HARGA_PORSI_MAKS:
        return None
    return harga


def parse_tanggal(teks: str):
    """Coba beberapa format berurutan sampai ada yang cocok."""
    raise NotImplementedError


def deduplikasi(records: list) -> list:
    """Dua record duplikat hanya kalau KETIGA syarat terpenuhi sekaligus:"""
    raise NotImplementedError


def normalisasi_upaya_survei(n_struk: int, n_kunjungan_surveyor: int) -> float | None:
    """Pisahkan keramaian lokasi dari intensitas kunjungan surveyor."""
    if not n_kunjungan_surveyor:
        return None
    return n_struk / n_kunjungan_surveyor


def koreksi_skor_ramai(kondisi: str, jam_kunjungan: int, baseline_per_jam: dict) -> float | None:
    """Menu Go kolom "Kondisi Pembeli" bias terhadap jam kunjungan surveyor."""
    skala = {"Sepi": 1.0, "Sedang": 2.0, "Ramai": 3.0}
    dasar = skala.get(kondisi)
    if dasar is None:
        return None
    return dasar - baseline_per_jam.get(jam_kunjungan, 0.0)

# ---------------------------------------------------------------------------
# OpenStreetMap -> footprint bangunan
# ---------------------------------------------------------------------------


def luas_poligon_m2(titik: list[dict]) -> float | None:
    """Luas satu poligon lat/lon dalam meter persegi."""
    if not titik or len(titik) < 3:
        return None
    try:
        lat = [float(t["lat"]) for t in titik]
        lon = [float(t["lon"]) for t in titik]
    except (KeyError, TypeError, ValueError):
        return None

    lat0 = sum(lat) / len(lat)
    k_lon = 111_320.0 * math.cos(math.radians(lat0))
    x = [(v - lon[0]) * k_lon for v in lon]
    y = [(v - lat[0]) * 110_574.0 for v in lat]

    # Overpass menutup cincinnya sendiri (titik terakhir == titik pertama);
    # shoelace tidak peduli, tetapi menutup dua kali juga tidak merusaknya.
    dua_luas = 0.0
    for i in range(len(x)):
        j = (i + 1) % len(x)
        dua_luas += x[i] * y[j] - x[j] * y[i]
    luas = abs(dua_luas) / 2.0
    return luas if luas > 0 else None


def bangunan_dari_osm(elemen: list[dict]) -> pd.DataFrame:
    """Elemen Overpass `out geom` -> (h3_index, luas_m2) per bangunan."""
    bertitik = bangunan_bertitik_dari_osm(elemen)
    if bertitik.empty:
        return pd.DataFrame(columns=["h3_index", "luas_m2"])
    return pd.DataFrame(
        {
            "h3_index": [
                h3.latlng_to_cell(la, lo, H3_RESOLUSI)
                for la, lo in zip(bertitik["lat"], bertitik["lon"])
            ],
            "luas_m2": bertitik["luas_m2"],
        },
        columns=["h3_index", "luas_m2"],
    )


def bangunan_bertitik_dari_osm(elemen: list[dict]) -> pd.DataFrame:
    """(lat, lon, luas_m2) per bangunan - titik tengah cincinnya ikut disimpan."""
    baris = []
    for e in elemen:
        geom = e.get("geometry")
        luas = luas_poligon_m2(geom) if geom else None
        if luas is None:
            continue
        lat = sum(float(t["lat"]) for t in geom) / len(geom)
        lon = sum(float(t["lon"]) for t in geom) / len(geom)
        titik = bersihkan_koordinat(lat, lon)
        if titik is None:
            continue
        baris.append({"lat": titik[0], "lon": titik[1], "luas_m2": round(luas, 2)})
    return pd.DataFrame(baris, columns=["lat", "lon", "luas_m2"])


#: Kelas jalan yang dihitung "jalan utama" - tempat toko terlihat oleh arus
#: yang lewat. `unclassified`/`residential`/`living_street`/`pedestrian` tetap
#: ditarik, tetapi masuk hitungan jalan TERDEKAT, bukan jalan utama.
KELAS_JALAN_UTAMA = frozenset({
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
    "secondary", "secondary_link", "tertiary", "tertiary_link",
})


def jalan_dari_osm(elemen: list[dict]) -> pd.DataFrame:
    """Ruas jalan Overpass `out geom` -> (nama, kelas, utama, koordinat)."""
    baris = []
    for e in elemen:
        if e.get("type") != "way":
            continue
        geom = e.get("geometry") or []
        titik = [
            (float(t["lon"]), float(t["lat"]))
            for t in geom
            if isinstance(t, dict) and "lat" in t and "lon" in t
        ]
        if len(titik) < 2:
            continue
        tag = e.get("tags") or {}
        kelas = (tag.get("highway") or "").strip()
        if not kelas:
            continue
        baris.append(
            {
                "nama": (tag.get("name") or "").strip()[:120] or None,
                "kelas": kelas,
                "utama": kelas in KELAS_JALAN_UTAMA,
                "koordinat": titik,
            }
        )
    return pd.DataFrame(baris, columns=["nama", "kelas", "utama", "koordinat"])



def parse_tanggal_misi(nilai) -> datetime | None:
    """Tanggal dari API misi MAPID, yang bentuknya belum bisa dipastikan."""
    if nilai in (None, "", {}, []):
        return None
    if isinstance(nilai, dict):
        for k in ("$date", "date", "tanggal", "value", "iso"):
            if nilai.get(k):
                return parse_tanggal_misi(nilai[k])
        return None
    if isinstance(nilai, (int, float)):        # epoch milidetik
        try:
            return datetime.fromtimestamp(nilai / 1000 if nilai > 1e11 else nilai)
        except (OverflowError, OSError, ValueError):
            return None
    teks = str(nilai).strip()
    if not teks:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d-%m-%Y %H:%M", "%d-%m-%Y",
                "%d/%m/%Y %H:%M", "%d/%m/%Y"):
        try:
            return datetime.strptime(teks, fmt)
        except ValueError:
            continue
    return None


def _titik_misi(f: dict) -> tuple[float, float] | None:
    """Koordinat satu Feature misi. Selalu Point menurut dokumentasi, tetapi
    diperiksa juga - satu titik yang jatuh di heksagon salah merusak seluruh
    rantai analisis di atasnya, dan tidak memunculkan galat."""
    g = f.get("geometry") or {}
    if g.get("type") != "Point":
        return None
    k = g.get("coordinates") or []
    if len(k) < 2:
        return None
    return bersihkan_koordinat(k[1], k[0])   # GeoJSON = [lon, lat]


def _dasar(f: dict) -> dict | None:
    titik = _titik_misi(f)
    if titik is None:
        return None
    lat, lon = titik
    return {
        "h3_index": h3.latlng_to_cell(lat, lon, H3_RESOLUSI),
        "lat": lat,
        "lon": lon,
    }


def menu_dari_mapid(fitur: list[dict]) -> pd.DataFrame:
    """Menu Go -> `menu_observations`. Sumber B07, B08, C04, C07, C08, D10."""
    kolom = ["h3_index", "nama_usaha", "kondisi_pembeli", "waktu_kunjungan",
             "mobilitas_keliling", "harga_rata_porsi", "menu_andalan", "lat", "lon"]
    baris = []
    for f in fitur:
        d = _dasar(f)
        if d is None:
            continue
        p = f.get("properties") or {}
        d["nama_usaha"] = (p.get("nama_tempat") or "").strip()[:200] or None
        d["kondisi_pembeli"] = kunci_nilai(p.get("kondisi_tempat")).title()[:10] or None
        d["waktu_kunjungan"] = parse_tanggal_misi(p.get("tanggal"))
        d["mobilitas_keliling"] = NILAI_MOBILITAS.get(kunci_nilai(p.get("mobilitas")))
        d["harga_rata_porsi"] = bersihkan_harga_porsi(p.get("harga_rata_rata"))
        d["menu_andalan"] = (p.get("menu_utama") or "").strip() or None
        baris.append(d)
    return pd.DataFrame(baris, columns=kolom)


def struk_dari_mapid(fitur: list[dict]) -> pd.DataFrame:
    """Struk Go -> `receipt_observations`. Sumber B06 sekarang; B01-B05, B09,
    B10, D11 menyusul lewat A2.
    """
    kolom = ["h3_index", "nama_merchant", "waktu_transaksi", "metode_bayar",
             "foto_url", "lat", "lon"]
    baris = []
    for f in fitur:
        d = _dasar(f)
        if d is None:
            continue
        p = f.get("properties") or {}
        d["nama_merchant"] = (p.get("nama_tempat") or "").strip()[:200] or None
        d["waktu_transaksi"] = parse_tanggal_misi(p.get("tanggal"))
        d["metode_bayar"] = (p.get("metode_pembayaran") or "").strip()[:40] or None
        d["foto_url"] = (p.get("foto_struk") or "").strip() or None
        baris.append(d)
    return pd.DataFrame(baris, columns=kolom)


def properti_dari_mapid(fitur: list[dict]) -> pd.DataFrame:
    """Properti Go -> `property_observations`. Sumber P03, P04 sekarang; P05
    menyusul lewat A1 atas `foto_spanduk`."""
    kolom = ["h3_index", "kategori", "status", "foto_spanduk_url", "lat", "lon"]
    baris = []
    for f in fitur:
        d = _dasar(f)
        if d is None:
            continue
        p = f.get("properties") or {}
        d["kategori"] = (p.get("kategori_properti") or "").strip()[:60] or None
        d["status"] = NILAI_JENIS_PROPERTI.get(kunci_nilai(p.get("jenis_properti")))
        d["foto_spanduk_url"] = (p.get("foto_spanduk") or "").strip() or None
        baris.append(d)
    return pd.DataFrame(baris, columns=kolom)


def aktivitas_dari_mapid(aktivitas: list[dict]) -> pd.DataFrame:
    """Activities -> (h3_index) per kegiatan. Sumber D12 aktivitas_komunitas."""
    baris = []
    for a in aktivitas:
        g = a.get("geometry") or {}
        k = g.get("coordinates") or []
        if g.get("type") != "Point" or len(k) < 2:
            continue
        titik = bersihkan_koordinat(k[1], k[0])
        if titik is None:
            continue
        baris.append({"h3_index": h3.latlng_to_cell(titik[0], titik[1], H3_RESOLUSI)})
    return pd.DataFrame(baris, columns=["h3_index"])
