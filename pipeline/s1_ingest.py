"""Tahap 1 - Tarik seluruh data mentah ke pipeline/data/01_mentah/.

Prinsip: berkas di 01_mentah TIDAK PERNAH diedit. Kalau ada yang perlu diperbaiki,
perbaikannya ditulis sebagai kode di s2_clean.py. Dengan begitu seluruh pipeline
bisa dijalankan ulang dari nol dan hasilnya sama.

Sumber, sesuai prioritas akuisisi (docs/data.md bagian 10):

  P0  Data misi MAPID   Properti Go, Struk Go, Menu Go, Community Maps
                        -> lewat MAPID Data API, header x-api-key, BACKEND-ONLY
                        -> dokumentasi: https://maps.mapid.io/docs
                        -> kuncinya dibuat sendiri di geo.mapid.io/dashboard ->
                           tab MAP SERVICES, sesudah redeem kode MWGC26
  P0  OSM               POI + jaringan jalan Jabodetabek (Overpass / Geofabrik PBF)
  P0  Simpul transit    railway=station, highway=bus_stop, terminal
  P1  WorldPop 2025     raster populasi + age-sex
  P1  NJOP              Jakarta Satu ArcGIS REST -> GeoJSON
  P1  RDTR Pola Ruang   Jakarta Satu ArcGIS REST -> GeoJSON  (sumber L01 ZoneGuard)
  P2  Overture Places   DuckDB query bbox
  P2  Google Open Bld   GEE export
  P2  Ridership KAI     ekstraksi press release (fitur C2)
  P2  InaRISK           layer risiko banjir

DILARANG (docs/aturan-lomba.md): Google Places API, scraping Rumah123/OLX,
GTFS TransJakarta komunitas. Melanggar ketentuan layanan atau lisensinya tidak jelas.

Dijalankan dari dalam folder ini:

    cd pipeline && python s1_ingest.py --simpul     # simpul transit OSM
    cd pipeline && python s1_ingest.py --poi        # POI usaha OSM
    cd pipeline && python s1_ingest.py --bangunan   # footprint bangunan OSM
    cd pipeline && python s1_ingest.py --semua-osm
"""

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

# Dua cermin sengaja DIBUANG, dan alasannya layak dibaca sebelum ada yang
# tergoda menambahkannya kembali demi kecepatan:
#
#   overpass.osm.jp   sertifikat TLS-nya tidak sah untuk nama domainnya
#                     sendiri. Satu-satunya cara memakainya adalah mematikan
#                     verifikasi sertifikat, dan itu berarti bersedia memakan
#                     jawaban dari siapa pun yang kebetulan berada di tengah.
#
#   overpass.osm.ch   JAUH lebih berbahaya, justru karena ia tidak pernah
#                     gagal. Ia cermin REGIONAL - isinya cuma Swiss. Untuk
#                     Jakarta ia menjawab 200 OK dengan `elements: []` dalam
#                     1,4 detik: tercepat di antara semuanya, dan salah
#                     seluruhnya. Sekali ia terpakai, keenam kawasan pulang
#                     dengan "0 simpul" dan tidak ada satu pun galat yang
#                     memberi tahu. "Tidak ada stasiun di Manggarai" lalu
#                     terbaca sebagai temuan, bukan sebagai kerusakan.
#
# Karena itu ada _cermin_sedunia(): sebuah cermin harus MEMBUKTIKAN dirinya
# memuat Indonesia sebelum jawabannya dipercaya. Cermin cepat yang salah lebih
# merugikan daripada cermin lambat yang benar.

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

#: POI dan bangunan butuh disc yang lebih lebar, dan sebabnya bukan kehati-hatian
#: melainkan definisi C01: kompetitor dihitung di heksagon ini DITAMBAH k-ring 1,
#: jadi jangkauannya satu heksagon (±350 m) lebih jauh daripada heksagon
#: terluarnya sendiri. Terukur pada 2.600 m: 35 dari 708 heksagon punya tetangga
#: ring-1 yang jatuh di tepi atau di luar disc.
#:
#: Kalau dibiarkan, kekurangannya BUKAN acak. Yang kekurangan kompetitor selalu
#: heksagon tepi, dan heksagon yang terlihat lebih lengang daripada kenyataannya
#: mendapat skor peluang lebih tinggi - persis bentuk "Hidden Gem palsu" yang
#: jadi alasan produk ini ada. 2.286 + 350 + 200 = 2.836 m, jadi 3.000 m menutup
#: seluruhnya dengan sisa.
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
    """Saring cermin yang benar-benar memuat Indonesia. Diperiksa sekali saja.

    Tanpa langkah ini, satu cermin regional yang kebetulan cepat akan
    memenangkan setiap perlombaan dan mengembalikan nol untuk seluruh wilayah
    studi - tanpa galat, tanpa peringatan, tanpa satu pun cara mengetahuinya
    selain menghitung hasilnya dengan tangan.
    """
    global _cermin_sah
    if _cermin_sah is not None:
        return _cermin_sah

    # Pemeriksaan ini pun perlu sabar. Seluruh instans publik bisa tumbang
    # bersamaan - terpantau 26 Agu 2026: 504, 500, dan 502 sekaligus - dan itu
    # keadaan sementara yang lewat sendiri. Menyerah pada percobaan pertama
    # membuat seluruh penarikan gagal karena sesuatu yang cuma perlu ditunggu.
    for putaran in range(4):
        sah, regional = [], []
        for url in CERMIN:
            nama = url.split("/")[2]
            try:
                n = len(_tembak(url, _BUKTI, batas_waktu=90).get("elements", []))
            except (OSError, http.client.HTTPException, json.JSONDecodeError) as e:
                # Sebabnya ikut dicetak, bukan cuma nama kelasnya. 429 berarti
                # KITA yang terlalu sering - jedanya harus lebih panjang; 504
                # berarti instansnya penuh - cukup ditunggu; 400 berarti
                # kuerinya salah dan menunggu berapa lama pun tidak menolong.
                # Ketiganya muncul sebagai "HTTPError" kalau cuma tipenya yang
                # dicetak, dan ketiganya menuntut tindakan yang berbeda.
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
    """Jalankan satu kueri Overpass, berpindah cermin kalau perlu.

    Kenapa berpindah cermin dan bukan sekadar mengulang: 504 dari Overpass
    berarti instansnya sedang kelebihan beban, bukan kuerinya salah. Mengulang
    ke instans yang sama hanya menambah antrean di tempat yang sedang penuh.

    Jeda antar-percobaan naik berlipat. Overpass gratis dan dipakai bersama-sama;
    membanjirinya saat ia sedang sibuk adalah cara paling cepat diblokir.
    """
    # Dicatat per cermin, bukan satu "galat terakhir". Kalau semuanya gagal,
    # yang perlu dibaca orang adalah SEBAB tiap cermin gagal - satu 504, satu
    # sertifikat kedaluwarsa, dan satu kueri salah adalah tiga masalah yang
    # berbeda, dan pesan tunggal cuma memperlihatkan yang kebetulan terakhir.
    galat: dict[str, str] = {}
    for putaran in range(percobaan):
        for url in _cermin_sedunia():
            try:
                return _tembak(url, kueri)
            # OSError mencakup URLError, HTTPError, TimeoutError, dan
            # ConnectionReset sekaligus. HTTPException ditulis terpisah karena
            # ia BUKAN OSError: `RemoteDisconnected` - cermin yang menutup
            # sambungan tanpa menjawab sama sekali - lolos dari penangkap yang
            # hanya menyebut URLError, dan itu bentuk kegagalan yang paling
            # sering muncul saat Overpass sedang penuh.
            except (OSError, http.client.HTTPException, json.JSONDecodeError) as e:
                galat[url.split("/")[2]] = _sebab(e)
                continue
        # Jeda naik tajam, bukan bertambah sedikit. 504 dari Overpass berarti
        # instansnya sedang penuh, dan kepenuhan itu diukur dalam menit -
        # mencoba lagi lima detik kemudian hampir pasti menemukan keadaan yang
        # persis sama, sekaligus menambah beban yang sedang jadi masalahnya.
        if putaran < percobaan - 1:
            tunggu = (15, 45, 90, 150)[min(putaran, 3)]
            print(f"      (semua cermin sibuk, menunggu {tunggu} dtk)")
            time.sleep(tunggu)

    rincian = "\n".join(f"  {nama:<26} {sebab}" for nama, sebab in galat.items())
    raise SystemExit(f"Overpass gagal di seluruh cermin:\n{rincian}")


def _tulis(nama: str, data: dict) -> Path:
    """Simpan apa adanya ke 01_mentah.

    `encoding="utf-8"` ditulis eksplisit karena Windows memakai cp1252 sebagai
    bawaan, dan nama tempat di Jakarta memuat karakter yang tidak ada di sana.
    Gagalnya terjadi SESUDAH kueri berhasil - kerja jaringannya terbuang.
    """
    DATA_MENTAH.mkdir(parents=True, exist_ok=True)
    jalur = DATA_MENTAH / nama
    jalur.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return jalur


def _per_kawasan(bangun_kueri, label: str, jeda: float = 2.0, singgah: bool = True) -> dict:
    """Jalankan satu kueri per kawasan lalu gabungkan hasilnya.

    Kenapa dipecah dan tidak sekali jalan: kueri gabungan untuk keenam kawasan
    sekaligus - 36 klausa `around` - dijawab 504 oleh Overpass publik. Enam kueri
    kecil selesai; satu kueri besar tidak pernah selesai.

    Elemen dikunci menurut (tipe, id) supaya simpul yang tertangkap dua kawasan
    yang lingkarannya bertumpang tindih - Manggarai dan Dukuh Atas hanya
    berjarak 2,5 km - tidak terhitung dua kali.
    """
    # Hasil tiap kawasan disinggahkan ke berkas sebelum lanjut. Overpass publik
    # sering penuh berjam-jam, dan tanpa singgahan satu 504 di kawasan keenam
    # membuang kelima kawasan yang sudah berhasil - lalu percobaan berikutnya
    # menariknya lagi dari nol, menambah beban yang justru jadi masalahnya.
    # Untuk menarik ulang dari awal: hapus folder _singgah/.
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

#: Poligon Jabodetabek. Sengaja lebih luas daripada keenam kawasan pilot: satu
#: kueri untuk seluruh wilayah jauh lebih murah daripada enam kueri bertumpang
#: tindih, dan yang di luar kawasan gugur sendiri saat dipetakan ke heksagon.
POLIGON_JABODETABEK = [[
    [BBOX["lon_min"], BBOX["lat_min"]], [BBOX["lon_max"], BBOX["lat_min"]],
    [BBOX["lon_max"], BBOX["lat_max"]], [BBOX["lon_min"], BBOX["lat_max"]],
    [BBOX["lon_min"], BBOX["lat_min"]],
]]


def _kunci_mapid() -> str:
    """Dibaca dari backend/.env - satu tempat, sama seperti DATABASE_URL.

    TIDAK pernah ditulis ke berkas keluaran mana pun, dan tidak pernah dicetak.
    """
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


# --- RDTR ATR/BPN -----------------------------------------------------------
#
# Sumber zonasi resmi: GISTARU RDTR Interaktif. Ditemukan dengan menyadap
# permintaan jaringan portalnya - API-nya tidak terdokumentasi di mana pun.
#
#   daftar provinsi : /rdtrinteraktif/api/interactive/provinces
#   RDTR per wilayah: /rdtrinteraktif/api/interactive/rdtr/{id_wilayah}
#   matriks ITBX    : /rdtrinteraktif/api/interactive/activities?id_wilayah=&id_rtr=
#
# CAKUPANNYA TIDAK PENUH untuk kita, dan ini harus disadari sebelum memakai
# hasilnya: dari enam kawasan pilot, hanya TIGA yang ada di DKI Jakarta
# (Manggarai, Tanah Abang, Dukuh Atas BNI). Kota Depok dan Kota Bekasi TIDAK
# terdaftar di GISTARU sama sekali - yang ada "Kab. Bekasi", wilayah yang
# berbeda. Jadi Depok Baru, Bekasi, dan Harjamukti tetap tanpa RDTR.

RDTR_PROXY = "https://gistaru-proxy.atrbpn.go.id/proxy.ashx?"
RDTR_DKI = (
    "https://gistaru.atrbpn.go.id/arcgis/rest/services/"
    "054_RDTR_PROVINSI_DKI_JAKARTA/_RDTR_31A1_DKI_JAKARTA/MapServer/0"
)

#: Server ArcGIS-nya menuntut token, dan proksi portal yang memegangnya. Proksi
#: itu di belakang WAF yang menolak permintaan tanpa Referer dan User-Agent
#: peramban - ditolak dengan halaman HTML "Request Rejected", bukan JSON, jadi
#: gagalnya terlihat seperti API yang rusak.
RDTR_HEADER = {
    "Referer": "https://gistaru.atrbpn.go.id/rdtrinteraktif/",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
}

#: Kolom yang diambil. Tiga di antaranya jadi variabel:
#:   NAMZON/KODZON -> L02 kelas_zona
#:   KRB_03        -> L03 risiko_banjir  (Kawasan Rawan Banjir, langsung dari RDTR)
#:   NOTHPR        -> dasar hukumnya, supaya angka di layar bisa ditelusuri
RDTR_FIELD = "KODZON,NAMZON,NAMOBJ,KRB_03,KODUNK,WADMKK,WADMKC,WADMKD,NOTHPR"


def _grid_pilot() -> dict[str, tuple[float, float]]:
    """708 heksagon beserta titik tengahnya, DIBANGKITKAN ULANG dari PUSAT.

    Tidak membaca basis data, dan itu disengaja: s1 menarik, s7 memuat, dan
    menukar urutannya membuat penarikan bergantung pada basis data yang mungkin
    belum ada. Grid-nya deterministik - diverifikasi 26 Agu 2026 menghasilkan
    himpunan yang IDENTIK dengan 708 baris `hex_features` (selisih nol).
    """
    # Diimpor di dalam fungsi, bukan di kepala berkas. Sebabnya bukan gaya:
    # penarikan OSM di berkas ini sengaja hanya butuh pustaka bawaan, sehingga
    # `python s1_ingest.py --simpul` jalan tanpa venv - dan perintah itu tertulis
    # apa adanya di CLAUDE.md. Impor tingkat modul akan mematikannya untuk
    # SELURUH sub-perintah, termasuk yang tidak menyentuh H3 sama sekali.
    import h3

    sel: dict[str, tuple[float, float]] = {}
    for lat, lon in PUSAT.values():
        for s in h3.grid_disk(h3.latlng_to_cell(lat, lon, H3_RESOLUSI), CINCIN_PILOT):
            sel[s] = h3.cell_to_latlng(s)
    return sel


def _rdtr_di_heksagon(sel: str) -> list[dict]:
    """Seluruh poligon RDTR yang memotong SATU heksagon, beserta geometrinya.

    Poligon, bukan titik tengah. Sebabnya terukur: heksagon Stasiun Manggarai
    memotong LIMA poligon di EMPAT zona berbeda (Badan Jalan, Transportasi,
    Ruang Terbuka Hijau, Perumahan), sementara kueri titik tengahnya hanya
    menjawab "Transportasi". Sampel satu titik untuk bidang seluas 0,105 km2
    tidak cukup untuk apa pun - apalagi untuk L01, yang MENOLKAN skor.
    """
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
        # Geometri disederhanakan di SISI SERVER. Poligon RDTR aslinya sangat
        # detail - satu heksagon menarik 4.984 titik dan 199 KB, dan itulah yang
        # membuat penarikan 708 heksagon merangkak sampai mandek. Dengan
        # toleransi ~2 m: 108 titik, 4 KB, 0,2 dtk - lima puluh kali lebih kecil.
        #
        # Diverifikasi tidak merusak hasilnya: selisih pangsa luas per zona
        # maksimal 0,002 atas tiga heksagon uji, sementara ambang L01 0,02.
        "maxAllowableOffset": "0.00002",
    })
    req = urllib.request.Request(f"{RDTR_PROXY}{RDTR_DKI}/query?{kueri}", headers=RDTR_HEADER)
    with urllib.request.urlopen(req, timeout=120) as resp:
        d = json.loads(resp.read().decode("utf-8"))
    if "error" in d:
        raise RuntimeError(f"RDTR: {d['error']}")
    return d.get("features") or []


def _potong_ke_heksagon(sel: str, fitur: list[dict]) -> list[dict]:
    """Poligon RDTR mentah -> (zona, KRB, luas perpotongan) untuk satu heksagon.

    Dipotong DI SINI, saat menarik, dan geometrinya langsung dibuang. Itu
    menyalahi kebiasaan berkas ini - s1 seharusnya menyimpan apa adanya - dan
    alasannya volume: terukur 26 Agu 2026, menyimpan geometri penuh menghabiskan
    **78 MB untuk 40 heksagon**, yang berarti ~1,4 GB untuk 708. Menulis ulang
    berkas sebesar itu tiap 40 heksagon membuat penarikannya merangkak.

    Yang hilang cuma geometrinya, dan ia tidak pernah ditanyakan siapa pun
    sesudah luasnya dihitung: variabelnya L01/L02/L03, ketiganya agregat.
    """
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
    """Zonasi RDTR per heksagon -> bahan L01, L02, L03.

    Satu kueri POLIGON per heksagon, bukan satu kueri per kawasan. Sebabnya
    batas server: `maxRecordCount` 1.000 sementara satu kawasan pilot memotong
    5.700-7.000 poligon RDTR, jadi menariknya utuh menuntut tujuh halaman
    berisi geometri penuh. Kueri per heksagon mengembalikan belasan poligon
    saja, dan servernya yang mengerjakan perpotongannya.

    Heksagon di luar DKI menjawab daftar kosong. Itu "tidak ada RDTR untuk
    bidang ini", bukan "tidak ada zona" - dan bedanya menentukan, karena yang
    pertama berarti TIDAK_DIKETAHUI sementara yang kedua berarti DILARANG.
    """
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


# --- InaRISK BNPB -----------------------------------------------------------
#
# Indeks Bahaya Banjir nasional, raster 100 m bernilai 0-1. DITARIK dan
# DIUKUR, lalu tidak dipakai - alasannya lengkap di docstring tarik_inarisk().
# Ringkasnya: ia tidak sepadan dengan KRB_03 RDTR, dan mencampur keduanya
# akan menghukum Depok dan Bekasi atas perbedaan sumber, bukan kenyataan.
#
# Servernya ArcGIS ImageServer terbuka, tanpa kunci:
#   /identify                    satu piksel di satu titik
#   /computeStatisticsHistograms rata-rata piksel DI DALAM sebuah poligon
#
# Yang dipakai yang kedua. Satu heksagon res-9 memuat 12 piksel InaRISK, dan
# pelajaran RDTR berlaku sama di sini: bidang seluas 0,105 km2 tidak pernah
# cukup diwakili satu titik.
#
# NoData BUKAN nol, dan bedanya harus diuji bukan diasumsikan - lihat
# s7_publish.muat_inarisk(), yang menyilangkannya dengan KRB_03 RDTR pada 328
# heksagon yang punya keduanya.

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
    """Indeks Bahaya Banjir InaRISK per heksagon. DITARIK, TIDAK DIMUAT.

    Dikerjakan untuk memberi L03 kepada Depok dan Bekasi, lalu DITOLAK oleh
    pengukurannya sendiri. Fungsinya dipertahankan supaya keputusan itu bisa
    diulang, bukan cuma dibaca.

    Hasil 29 Agu 2026: 519 dari 708 heksagon berdata. Disilangkan dengan
    KRB_03 RDTR pada 328 heksagon yang punya KEDUANYA:

      NoData BUKAN berarti aman. Heksagon ber-NoData justru punya KRB_03
      rata-rata 0,204 melawan 0,191 pada yang berdata - praktis sama, jadi
      NoData tidak membawa keterangan apa pun tentang risikonya.

      Kedua sumber mengukur hal yang berbeda. Spearman 0,201, dan skalanya
      berjauhan: median KRB_03 0,073 melawan median InaRISK 0,589. KRB_03
      adalah PANGSA LUAS heksagon yang masuk kelas rawan tertinggi; InaRISK
      adalah INDEKS bahaya. Keduanya sah, dan justru karena itu tidak bisa
      duduk di satu kolom.

      Cakupannya pun timpang: Tanah Abang 100%, Depok Baru 28%. Memuatnya
      akan membuat kawasan di luar DKI tampak jauh lebih rawan karena
      SUMBERNYA, bukan karena kenyataannya - dan L03 mengurangi skor peluang.

    Aman diulang: tiap heksagon disinggahkan dan tidak pernah ditanyakan dua
    kali, termasuk yang jawabannya NoData - yang disimpan sebagai null, bukan
    dihapus, supaya menjalankan ulang tidak menanyakannya lagi selamanya.

    Aman diulang: tiap heksagon disinggahkan dan tidak pernah ditanyakan dua
    kali, termasuk yang jawabannya NoData - yang disimpan sebagai null, bukan
    dihapus, supaya menjalankan ulang tidak menanyakannya lagi selamanya.
    """
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
    """Properti Go / Struk Go / Menu Go / Activities lewat MAPID Data API.

    Header `x-api-key`, backend-to-backend. Disimpan apa adanya ke DATA_MENTAH,
    yang seluruhnya masuk .gitignore - data misi mentah tidak boleh
    diredistribusi (aturan lomba #3), dan itu termasuk lewat repo sendiri.

    Nama kolomnya sudah dicocokkan (25 Agu 2026) terhadap keempat dataset
    sampel resmi dan dikunci di `config.KOLOM_*`; nilainya dicocokkan ke
    `config.NILAI_*` (26 Agu 2026, nol nilai asing).

    Paginasi: `limit` dipaku 100 dan tidak bisa diubah lewat badan permintaan.
    `offset` yang MELEBIHI total dijawab **400**, bukan daftar kosong - jadi
    berhenti harus mengandalkan `hasMore`, bukan "berhenti kalau kosong".
    """
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


# ---------------------------------------------------------------------------
# OpenStreetMap
# ---------------------------------------------------------------------------
# Lisensi ODbL 1.0: wajib atribusi "© OpenStreetMap contributors", dan
# share-alike berlaku pada database turunan. Atribusinya WAJIB tampil di
# halaman Metodologi & Sumber Data, bukan sekadar dicatat di sini.
#
# Batasan yang harus dinyatakan terbuka, bukan disembunyikan: warung informal,
# gerobak, dan pedagang kaki lima sangat kurang terpetakan di OSM Indonesia.
# Jumlah POI dari OSM adalah BATAS BAWAH, bukan angka sebenarnya. Justru di
# situlah Menu Go dan Struk Go punya nilai unik - keduanya menangkap sektor
# informal yang tidak tercatat di peta mana pun.


def tarik_simpul_transit() -> Path:
    """Simpul transportasi darat di dalam keenam kawasan pilot.

    Cakupan sengaja dikunci ke kawasan pilot, bukan seluruh Jabodetabek
    (aturan 5: ruang lingkup tidak melebar). Konsekuensi yang disengaja:
    heksagon tidak bertambah, dan `hex_routes` yang sudah dihitung tetap sahih.

    Ditarik dalam TIGA lintasan ringan, bukan satu lintasan lengkap. Kueri
    gabungan lima selektor pada radius 2,6 km dijawab 504 di kawasan padat
    seperti Tanah Abang: yang menentukan berat sebuah kueri Overpass bukan
    jumlah hasilnya, melainkan berapa banyak yang harus DIPINDAI untuk
    menemukannya.
    """
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


def tarik_osm_poi() -> Path:
    """POI usaha - bahan dimensi Kompetisi (C01-C08) dan sebagian Permintaan.

    Yang ditarik hanya tag yang benar-benar dipetakan ke delapan kelas induk
    (docs/data.md bagian 5). Menarik seluruh `amenity=*` akan membawa bangku
    taman dan tempat sampah, dan keduanya bukan kompetitor siapa pun.
    """
    # Sekolah dan rumah ibadah ikut ditarik walau keduanya BUKAN tempat usaha
    # dan tidak memetakan ke satu pun kelas induk - `kelas_dari_tag` menolaknya,
    # jadi tidak satu pun masuk business_pois. Keperluannya D09
    # generator_keramaian, yang didefinisikan "sekolah, RS, pasar, masjid besar":
    # tanpa keduanya D09 kehilangan separuh definisinya sendiri, dan
    # kehilangannya tidak akan muncul sebagai galat - cuma sebagai angka yang
    # kebetulan lebih kecil di setiap heksagon sekaligus.
    tag = [
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
    print("  POI usaha:")
    hasil = _per_kawasan(
        lambda lat, lon: (
            f"[out:json][timeout:240];("
            + "".join(f"{t}(around:{RADIUS_POI_M},{lat},{lon});" for t in tag)
            + ");out center tags;"
        ),
        "POI",
        jeda=3.0,
    )
    jalur = _tulis("osm_poi.json", hasil)
    print(f"\n  {len(hasil['elements'])} POI -> {jalur.name}")
    return jalur


#: Radius khusus bangunan. Lebih SEMPIT daripada POI, dan itu disengaja:
#: M01/M02 hanya menggambarkan isi heksagonnya sendiri, tidak pernah menjangkau
#: k-ring 1 seperti C01. Heksagon terjauh 2.286 m dari pusat kawasannya, dan
#: setengah lebar heksagon res-9 sekitar 175 m - jadi 2.500 m sudah menutup
#: setiap bangunan yang mungkin berpusat di dalam salah satu dari 708 heksagon.
#: Cincin H3 dari pusat kawasan. SAMA dengan `demo_seed.CINCIN` - kalau
#: keduanya berbeda, grid yang ditarik bukan grid yang diskor.

RADIUS_BANGUNAN_M = 2500

#: Tiap kawasan dipecah jadi PETAK x PETAK kueri. Terukur 26 Agu 2026: 92.838
#: bangunan dalam radius 3 km di Manggarai, dan 589 byte per bangunan - satu
#: kueri utuh berarti respons ~38 MB. Overpass sanggup, tetapi hanya sesekali;
#: yang gagal di menit kesembilan membuang seluruh kawasan. Petak 3x3
#: menurunkannya ke ~4 MB per kueri, dan tiap petak yang berhasil disinggahkan
#: sendiri-sendiri.
PETAK_BANGUNAN = 3

#: Meter per derajat di lintang Jakarta. Bujur dikoreksi cos(lintang); memakai
#: angka lintang untuk keduanya menggeser petak paling timur sekitar 20 m.
_M_PER_DEG_LAT = 110_574.0


def _petak(lat: float, lon: float, radius_m: int, n: int) -> list[tuple[float, float, float, float]]:
    """Bagi kotak sekeliling satu titik jadi n x n bbox Overpass.

    Urutan bbox Overpass `(selatan,barat,utara,timur)` - BUKAN urutan GeoJSON.
    Tertukar tidak menghasilkan galat, cuma kotak kosong di tengah laut.
    """
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
    """Footprint bangunan - bahan M01 rasio tutupan dan M02 luas median.

    Hanya `way`, tanpa `relation`. Bangunan ber-relation di OSM hampir selalu
    multipoligon berlubang (mal dengan atrium), jumlahnya sedikit di wilayah
    ini, dan menghitung luasnya menuntut perakitan geometri yang jauh lebih
    rumit daripada nilainya di sini.

    Dipecah per PETAK, bukan per kawasan seperti POI dan simpul. Sebabnya
    semata volume: bangunan puluhan kali lebih banyak daripada POI, dan
    `out geom` membawa seluruh titik tiap poligonnya.
    """
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
# Data sekunder
# ---------------------------------------------------------------------------


def tarik_data_sekunder() -> None:
    """WorldPop, NJOP, RDTR, Open Buildings, InaRISK, Overture.

    Catatan lapangan per 25 Agu 2026, supaya tidak diulang dari nol:
      - InaRISK  gis.bnpb.go.id/server/rest/services  MENJAWAB (banjir L03)
      - Jakarta Satu  jakartasatu.jakarta.go.id  TIDAK MENJAWAB dari sini,
        habis waktu di 60 dtk. Perlu dicoba dari jaringan lain sebelum
        disimpulkan mati - ia sumber P01/P02 (NJOP) dan L01/L02 (RDTR)
      - GISTARU  gistaru.atrbpn.go.id  hidup, tetapi viewer HTML tanpa
        WMS/WFS. Untuk Bodetabek di luar DKI ini satu-satunya jalur zonasi
    """
    raise NotImplementedError


#: Relasi rute yang dihitung. `ferry` dan `tram` ikut supaya kueri tidak perlu
#: diubah kalau suatu saat wilayahnya melebar; keduanya memang nol di Jabodetabek.
RUTE_MODA = "bus|trolleybus|train|subway|light_rail|tram|monorail|ferry|share_taxi|minibus"


def tarik_rute_transit() -> Path:
    """Relasi rute angkutan umum - bahan D05 `skor_simpul`.

    D05 didefinisikan "bobot pentingnya simpul" dan ditandai TURUNAN di
    docs/data.md. Yang sebelumnya mengisinya angka `rng` di `demo_seed`, dan
    angka itu memegang bobot 0,40 di IPT - yang terbesar kedua di seluruh model.

    Kenapa relasi rute dan bukan jumlah peron: peron menghitung berapa banyak
    kereta yang MUAT, rute menghitung berapa banyak tujuan yang bisa dicapai
    tanpa berganti kendaraan - dan yang kedua itulah yang menentukan berapa
    banyak orang punya alasan turun di situ.

    `out body` (bukan `out tags`) disengaja: yang dibutuhkan justru daftar
    ANGGOTA tiap relasi, karena dari situlah "berapa rute melewati simpul X"
    dihitung. Dengan `out tags` relasinya pulang tanpa anggota dan seluruh
    hitungannya jadi nol - tanpa satu pun galat.
    """
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
    """Koordinat titik henti yang BENAR-BENAR dilewati rute - pasangan --rute.

    Ditanyakan MENURUT ID, bukan menurut ruang, dan itu keputusan yang berarti:

    - Kueri spasial (`node["public_transport"](around:3000,...)`) memaksa
      Overpass memindai kotak sebesar kawasan lalu menyaring menurut tag.
      Dicoba 27 Agu 2026 dan dijawab 504 berkali-kali di seluruh cermin.
      `node(id:...)` menyentuh indeks utamanya langsung.
    - Ia menarik TEPAT yang dibutuhkan. Titik henti yang tidak dilewati satu
      pun rute tidak menyumbang apa pun ke D05, jadi menariknya hanya menambah
      berat tanpa mengubah satu angka pun.

    Konsekuensi yang harus disadari: fungsi ini menuntut `osm_rute.json` sudah
    ada. Itu urutan yang wajar - tanpa relasi rute, tidak ada yang perlu dicari
    koordinatnya.

    `out body` (bukan `out tags`) disengaja. `out tags` MEMBUANG geometri, dan
    penarikan halte yang lama memakainya - 702 dari 808 simpul tersimpan tanpa
    lat/lon, tanpa satu pun galat, dan tidak bisa dipetakan ke heksagon mana pun.
    """
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
    p.add_argument("--bangunan", action="store_true", help="Footprint bangunan OSM")
    p.add_argument("--semua-osm", action="store_true", help="Ketiganya sekaligus")
    p.add_argument("--misi", action="store_true", help="Data misi MAPID (butuh MAPID_DATA_API_KEY)")
    p.add_argument("--rdtr", action="store_true", help="Zonasi RDTR ATR/BPN -> L01, L02, L03 (DKI saja)")
    p.add_argument("--inarisk", action="store_true",
                   help="Indeks Bahaya Banjir InaRISK BNPB -> L03 di luar DKI")
    p.add_argument("--rute", action="store_true", help="Relasi rute angkutan umum OSM -> D05")
    p.add_argument("--henti", action="store_true",
                   help="Titik henti angkutan umum berkoordinat -> D05")
    arg = p.parse_args()

    if not any([arg.simpul, arg.poi, arg.bangunan, arg.semua_osm, arg.misi,
                arg.rdtr, arg.inarisk, arg.rute, arg.henti]):
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
    if arg.bangunan or arg.semua_osm:
        tarik_osm_bangunan()
    if arg.rute or arg.semua_osm:
        tarik_rute_transit()
    if arg.henti or arg.semua_osm:
        tarik_henti_transit()
