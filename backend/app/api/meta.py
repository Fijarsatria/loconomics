"""Kesehatan, kesiapan, dan cakupan data.

Dua endpoint yang sering dikira sama padahal jawabannya berbeda:

  /health      Apakah prosesnya hidup?   -> untuk Render, HARUS murah dan cepat
  /meta/siap   Apakah bisa melayani?     -> memeriksa basis data, migrasi, isi data

Memakai /health yang menyentuh basis data adalah kesalahan yang mahal: Render
memanggilnya tiap beberapa detik, dan setiap panggilan jadi satu koneksi ke
Supabase free tier. Sebaliknya, /health yang selalu menjawab "ok" tidak berguna
untuk memutuskan apakah demo layak dimulai - itu tugas /meta/siap.
"""

from __future__ import annotations

import json
import re
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.ai import ALAT_BACKEND, ALAT_FRONTEND
from app.api.bersama import SEMUA_VARIABEL
from app.core import cache
from app.core.aturan import KAWASAN_PILOT
from app.core.batas import PLAFON_HARIAN_USD, biaya_hari_ini
from app.core.config import settings
from app.core.database import get_db
from app.core.llm import model_aktif, tersedia
from app.models import (
    BusinessPOI,
    HexFeature,
    HexHourlyProfile,
    HexRoute,
    LocationScore,
    MenuObservation,
    PropertyObservation,
    ReceiptObservation,
)

#: Atribusi yang WAJIB tampil begitu datanya benar-benar dipakai. Bukan sopan
#: santun: ODbL menuntut sumbernya disebut, dan atribusi "© OpenStreetMap" yang
#: sudah muncul di peta itu milik MAPID atas UBIN-nya - bukan milik kita atas
#: POI yang kita turunkan sendiri jadi angka kompetisi. Dua hal yang kebetulan
#: berbunyi mirip.
#:
#: Daftarnya disaring PER ENTRI menurut kolom yang membuktikan sumbernya
#: benar-benar termuat, supaya ia tidak pernah menyebut sumber yang tidak
#: menyumbang satu angka pun. Sebelumnya penyaringnya satu untuk seluruh daftar
#: ("kalau ada POI OSM ATAU rute, sebut semuanya") - bentuk yang mengaku memakai
#: WorldPop dan RDTR pada basis data yang belum pernah disentuh keduanya.
#:
#: `bukti` adalah kolom `hex_features` yang hanya bisa terisi kalau sumber itu
#: dimuat. Nama kolomnya konstanta di dalam kode, tidak pernah dari pengguna.
ATRIBUSI = [
    {
        "nama": "OpenStreetMap contributors",
        "lisensi": "ODbL 1.0",
        "url": "https://www.openstreetmap.org/copyright",
        "dipakai": "POI usaha, simpul transit, jaringan jalan",
        "bukti": "kepadatan_poi_total",
    },
    {
        "nama": "openrouteservice",
        "lisensi": "CC BY-SA 4.0",
        "url": "https://openrouteservice.org/",
        "dipakai": "Rute jalan kaki dan kawasan jangkau",
        "bukti": "waktu_jalan_menit",
    },
    {
        "nama": "WorldPop",
        "lisensi": "CC BY 4.0",
        "url": "https://www.worldpop.org/",
        "dipakai": "Jumlah penduduk per heksagon (D01)",
        "bukti": "pop_100m",
    },
    {
        "nama": "RDTR ATR/BPN (GISTARU)",
        "lisensi": "Data terbuka pemerintah",
        "url": "https://gistaru.atrbpn.go.id/rdtrinteraktif/",
        "dipakai": "Zonasi, izin komersial, dan risiko banjir (L01-L03)",
        "bukti": "kelas_zona",
    },
]

router = APIRouter(tags=["meta"])


@router.get("/health", summary="Apakah prosesnya hidup")
def health() -> dict[str, str]:
    """Sengaja tidak menyentuh basis data. Dipanggil Render tiap beberapa detik."""
    return {"status": "ok"}


@router.get("/meta/siap", summary="Apakah backend siap melayani")
def kesiapan(db: Annotated[Session, Depends(get_db)]) -> dict[str, Any]:
    """Pemeriksaan lengkap sebelum demo dimulai.

    Menjawab tiga hal yang perlu diketahui dan tidak bisa dijawab dari luar:
    basis datanya terjangkau atau tidak, migrasinya sudah versi terbaru atau
    belum, dan datanya sudah masuk atau masih kosong.

    Yang terakhir yang paling sering terlewat. Backend yang sehat di atas basis
    data kosong akan menjawab semua permintaan dengan daftar kosong, dan itu
    terlihat seperti bug di frontend padahal pipeline-nya yang belum dijalankan.
    """
    hasil: dict[str, Any] = {
        "siap": False,
        "lingkungan": settings.lingkungan,
        "basis_data": {"terjangkau": False},
        "cache": cache.statistik(),
        # Bawaan FALSE, bukan True. Kalau basis datanya tidak terjangkau kita
        # tidak tahu apa-apa soal isinya, dan menuduhnya sintetis sama tidak
        # jujurnya dengan menuduhnya sungguhan. Frontend hanya memasang pitanya
        # kalau field ini benar-benar bernilai true.
        "data_sintetis": False,
        "catatan_data": None,
    }

    try:
        revisi = db.execute(text("SELECT version_num FROM alembic_version")).scalar()
        n_hex = db.execute(select(func.count()).select_from(HexFeature)).scalar_one()
        n_skor = db.execute(select(func.count()).select_from(LocationScore)).scalar_one()
        n_jam = db.execute(select(func.count()).select_from(HexHourlyProfile)).scalar_one()
        n_kawasan = db.execute(
            select(func.count(func.distinct(HexFeature.kawasan)))
        ).scalar_one()
        versi_skor = db.execute(
            select(LocationScore.versi).distinct().order_by(LocationScore.versi)
        ).scalars().all()

        # Berapa baris observasi misi MAPID yang benar-benar ada. Inilah satu-
        # satunya pemeriksaan yang bisa membedakan data sungguhan dari data demo
        # `pipeline/demo_seed.py` - dan ia DITURUNKAN, bukan sebuah sakelar yang
        # harus diingat untuk dimatikan. Pita "data demo" di antarmuka membaca
        # angka ini, jadi ia hilang dengan sendirinya begitu survei pertama
        # masuk; pita yang disetel tangan akan tetap berbohong ke arah
        # sebaliknya.
        n_observasi = sum(
            db.execute(select(func.count()).select_from(m)).scalar_one()
            for m in (MenuObservation, ReceiptObservation, PropertyObservation)
        )

        hasil["basis_data"] = {
            "terjangkau": True,
            "revisi_migrasi": revisi,
            "heksagon": n_hex,
            "skor": n_skor,
            "profil_jam": n_jam,
            "kawasan_terisi": n_kawasan,
            "versi_skor": list(versi_skor),
            "observasi_misi": n_observasi,
        }
        # Sumber terbuka yang SUDAH termuat, dihitung dari barisnya sendiri.
        # Perlu dipisah dari `n_observasi` karena keduanya menjawab pertanyaan
        # yang berbeda: yang satu "sudah ada survei lapangan?", yang lain
        # "berapa banyak dari peta ini yang bukan karangan?". Sejak D04 diisi
        # rute ORS dan variabel Kompetisi diisi POI OSM, jawaban keduanya tidak
        # lagi sama - dan catatan yang menyatakan "SELURUH isi peta sintetis"
        # berhenti benar justru pada saat datanya membaik.
        n_poi_osm = db.execute(
            select(func.count()).select_from(BusinessPOI).where(BusinessPOI.sumber == "osm")
        ).scalar_one()
        n_rute = db.execute(select(func.count()).select_from(HexRoute)).scalar_one()

        nyata = []
        if n_rute:
            nyata.append(f"{n_rute} rute jalan kaki OpenRouteService (D03, D04)")
        if n_poi_osm:
            nyata.append(
                f"{n_poi_osm} POI OpenStreetMap (C01-C06, D08, D09)"
            )

        # Berapa dari 43 variabel yang benar-benar punya isi, DIHITUNG dari
        # kolomnya sendiri. Sebelumnya bagian ini berupa daftar yang ditulis
        # tangan, dan daftar tulis tangan selalu kedaluwarsa ke arah yang salah:
        # ia masih menyebut "sisanya dari demo_seed" berjam-jam setelah demo_seed
        # dikosongkan, sekaligus tidak menyebut D05, C04, M01, M02, dan L01-L03
        # yang sudah nyata. Yang dihitung tidak bisa ketinggalan.
        #
        # SATU kueri berisi 43 count(), bukan 43 kueri berisi satu count().
        # Bedanya bukan kerapian: basis datanya Supabase, yang jaraknya satu
        # perjalanan jaringan penuh - terukur ~700 ms sekali jalan, jadi versi
        # per-kolom membuat /meta/siap memakan 31 DETIK. Dan /meta/siap dipanggil
        # setiap kali aplikasi dibuka, karena pita "Data demo" membacanya.
        #
        # Nama kolomnya berasal dari SEMUA_VARIABEL - konstanta di dalam kode,
        # tidak pernah dari masukan pengguna - jadi tidak ada jalan masuk injeksi
        # di sini. Yang menjaganya tetap begitu: uji yang menegakkan bahwa setiap
        # nama di SEMUA_VARIABEL benar-benar kolom `hex_features`.
        ikhtisar = db.execute(
            text(
                "SELECT "
                + ", ".join(f"count({k}) AS {k}" for k in SEMUA_VARIABEL)
                + " FROM hex_features"
            )  # noqa: S608
        ).one()
        n_terisi = sum(1 for n in ikhtisar if n and n > 0)

        # WorldPop dan RDTR menyusul di sini, bukan di atas bersama OSM dan ORS:
        # cakupannya diukur dari KOLOM, dan kolomnya baru terhitung sekarang.
        # Tanpa keduanya, `catatan_data` menyatakan "seluruhnya dari sumber yang
        # bisa dikutip" lalu menyebut dua dari empat - meremehkan datanya sendiri
        # tepat di kalimat yang dibaca juri.
        if ikhtisar.pop_100m:
            nyata.append(f"{ikhtisar.pop_100m} heksagon berpenduduk WorldPop (D01)")
        if ikhtisar.kelas_zona:
            nyata.append(f"{ikhtisar.kelas_zona} heksagon berzonasi RDTR ATR/BPN (L01-L03)")

        hasil["basis_data"]["variabel_terisi"] = n_terisi
        hasil["basis_data"]["variabel_total"] = len(SEMUA_VARIABEL)
        hasil["basis_data"]["poi_osm"] = n_poi_osm
        hasil["basis_data"]["rute"] = n_rute
        hasil["sumber_terbuka"] = nyata
        hasil["atribusi"] = [
            {k: v for k, v in a.items() if k != "bukti"}
            for a in ATRIBUSI
            if getattr(ikhtisar, str(a["bukti"]), 0)
        ]

        # Diturunkan dari SEBERAPA BANYAK heksagon yang masih `predicted`, bukan
        # dari ada-tidaknya satu baris observasi. Bedanya menentukan: 27 titik
        # misi yang mendarat di 20 heksagon membuat `n_observasi > 0`, dan pita
        # "Data demo" akan HILANG sementara 688 dari 708 heksagon masih memegang
        # angka `demo_seed`. Pita yang menghilang terlalu cepat berbohong ke arah
        # yang persis berlawanan dengan yang ia ada untuk mencegahnya.
        n_predicted = db.execute(
            select(func.count()).select_from(HexFeature).where(
                HexFeature.data_source != "observed"
            )
        ).scalar_one()
        hasil["basis_data"]["heksagon_predicted"] = n_predicted
        hasil["data_sintetis"] = bool(n_hex) and n_predicted > n_hex / 2
        if not hasil["data_sintetis"]:
            hasil["catatan_data"] = f"{n_observasi} baris observasi misi MAPID termuat."
        elif nyata:
            survei = (
                f"{n_observasi} titik survei misi MAPID mendarat di "
                f"{n_hex - n_predicted} dari {n_hex} heksagon"
                if n_observasi
                else "Belum ada satu pun titik survei misi MAPID"
            )
            hasil["catatan_data"] = (
                f"{survei}; sisanya ditandai 'predicted'. "
                f"{n_terisi} dari {len(SEMUA_VARIABEL)} variabel terisi, "
                "seluruhnya dari sumber yang bisa dikutip: "
                + "; ".join(nyata)
                + ". Variabel yang belum punya sumber dibiarkan KOSONG, bukan "
                "ditaksir - indeks yang variabelnya kosong dinetralkan, tidak "
                "dinolkan."
            )
        else:
            hasil["catatan_data"] = (
                "Seluruh isi peta berasal dari pipeline/demo_seed.py - variabel "
                "sintetis yang melewati mesin skoring yang sungguhan. Belum ada satu "
                "pun titik survei misi MAPID di basis data, dan setiap heksagon "
                "ditandai 'predicted' berkeyakinan RENDAH."
            )
        # "Siap" berarti bisa menjawab dengan isi, bukan sekadar tidak error.
        hasil["siap"] = bool(n_hex and n_skor)
        if not n_hex:
            hasil["catatan"] = "Tabel hex_features kosong - jalankan pipeline s1-s7."
        elif not n_skor:
            hasil["catatan"] = "Skor belum dihitung - jalankan pipeline s6_score lalu s7_publish."
    except SQLAlchemyError as e:
        hasil["basis_data"] = {"terjangkau": False, "galat": type(e).__name__}
        hasil["catatan"] = (
            "Basis data tidak terjangkau. Supabase free tier dijeda kalau lama "
            "menganggur - buka dasbornya sekali untuk membangunkannya."
        )

    siap_ai = tersedia()
    try:
        terpakai = biaya_hari_ini(db)
    except SQLAlchemyError:
        terpakai = None

    hasil["ai"] = {
        "siap": siap_ai,
        "model": model_aktif() if siap_ai else None,
        "n_alat_backend": len(ALAT_BACKEND),
        "n_alat_peta": len(ALAT_FRONTEND),
        "biaya_hari_ini_usd": round(terpakai, 4) if terpakai is not None else None,
        "plafon_harian_usd": settings.llm_plafon_harian_usd or PLAFON_HARIAN_USD,
    }
    return hasil


# --- Proksi gaya basemap ----------------------------------------------------
#
# Kenapa ini ada, diukur 29 Agu 2026 dan bukan dugaan:
#
#   kunci di frontend/.env  ==  kunci di backend/.env, SAMA PERSIS
#
# dan kunci itu menjawab 200 di server.mapid.io/web/competition/{menugo,
# struckgo, propertigo, activities} - 100 baris survei MENTAH per halaman.
# Kunci palsu dijawab 401, jadi endpoint itu benar-benar mengotentikasi. Vite
# mem-bundel setiap variabel `VITE_` ke berkas publik, sehingga selama kunci itu
# ada di frontend, siapa pun yang membuka dist/assets/*.js bisa menarik seluruh
# data misi. Itu melanggar ketentuan lomba sekaligus aturan keras repo ini.
#
# Yang membuat perbaikan ini murah adalah satu pengukuran lain: dari seluruh
# rantai basemap MAPID, HANYA style.json yang menuntut kunci.
#
#   styles/{gaya}/style.json          401 tanpa kunci   <- satu-satunya
#   data/mapidtiles.json              200 tanpa kunci
#   data/mapidtiles/{z}/{x}/{y}.pbf   200 tanpa kunci, 397 KB identik
#   fonts/{fontstack}/{range}.pbf     200 tanpa kunci
#
# Jadi backend cukup memproksikan SATU berkas JSON per gaya, membuang kuncinya
# dari badan respons, lalu peramban mengambil ubin dan font langsung ke MAPID
# seperti biasa. Ubin tetap ubin MAPID - ketentuan A.3 tetap dipenuhi - dan
# beban proksinya nol koma sekian persen dari lalu lintas peta.

#: Daftar PUTIH, bukan jalur bebas. Tanpa ini endpointnya jadi proksi terbuka:
#: siapa pun bisa menyuruh server kita mengambil URL apa pun (SSRF).
GAYA_BASEMAP = ("light", "basic", "street-2d-building", "dark")

HULU_GAYA = "https://basemap.mapid.io/styles/{}/style.json"

#: Bidang TileJSON yang benar-benar dipakai MapLibre untuk menggambar.
#:
#: Sisanya dibuang, dan sisanya itu hampir seluruh berkasnya: `tilestats`
#: sendirian 2,67 MB dari 2,70 MB, murni metadata statistik yang tidak pernah
#: disentuh perender. Yang tersisa ~25 KB - cukup kecil untuk ditumpangkan ke
#: dalam gayanya.
BIDANG_TILEJSON = ("tiles", "minzoom", "maxzoom", "bounds", "attribution", "vector_layers")

#: Sehari. Gaya basemap praktis tidak pernah berubah, dan tiap kehilangan cache
#: berarti satu perjalanan ke MAPID sebelum peta pengguna bisa mulai menggambar.
TTL_GAYA = 86_400.0


def _buang_kunci(teks: str, kunci: str) -> str:
    """Cabut kunci dari SETIAP URL di dalam badan gaya.

    style.json menyisipkan kuncinya di beberapa tempat sekaligus - `sources`,
    `glyphs`, kadang `sprite` - dan bentuknya bisa `?key=` maupun `&key=`.
    Membuangnya lewat penyuntingan JSON bidang-per-bidang berarti menebak
    bidang mana saja yang ada, dan bidang yang terlewat TIDAK memunculkan galat:
    ia cuma meneruskan kuncinya ke peramban, diam-diam.

    Jadi yang dilakukan kebalikannya: buang polanya di seluruh teks, lalu
    tegakkan dengan asersi bahwa kuncinya benar-benar tidak tersisa.
    """
    # Dua langkah, dan urutannya penting. Kalau kuncinya bukan parameter
    # terakhir, membuang `?key=...` saja menyisakan `&` menggantung di
    # posisi pembuka kueri - URL yang tidak sah, dan MapLibre menolaknya
    # tanpa pesan yang menyebut sebabnya.
    bersih = re.sub(r"\?key=[^&\x22\x27\s]*&", "?", teks)
    bersih = re.sub(r"[?&]key=[^&\x22\x27\s]*", "", bersih)
    if kunci and kunci in bersih:
        # Jangan pernah meneruskan badan yang masih memuat kunci. Lebih baik
        # petanya gagal dengan galat yang terbaca daripada bocor tanpa suara.
        raise RuntimeError("kunci masih tersisa di badan gaya sesudah dibersihkan")
    return bersih


def _sisipkan_tilejson(gaya: dict, kunci: str) -> dict:
    """Ganti `sources[*].url` dengan isi TileJSON-nya, di sisi server.

    Kenapa bukan dibiarkan diminta peramban: terukur di Playwright, permintaan
    TileJSON anonim ke basemap.mapid.io kadang gagal dengan `ERR_FAILED` yang
    dilaporkan Chrome sebagai galat CORS. Kegagalannya tidak berulang setiap
    kali - dan justru itu yang membuatnya berbahaya, karena yang terlihat
    sesekali adalah peta tanpa satu pun jalan tepat saat juri membukanya.

    Satu permintaan lintas-asal yang dihapus adalah satu mode kegagalan yang
    hilang. Ubinnya sendiri tetap diambil peramban langsung dari MAPID, jadi
    beban proksinya tidak bertambah sama sekali.
    """
    for sumber in (gaya.get("sources") or {}).values():
        url = sumber.get("url")
        if not isinstance(url, str) or "basemap.mapid.io" not in url:
            continue
        try:
            r = httpx.get(url, params={"key": kunci}, timeout=30.0)
            r.raise_for_status()
            tj = r.json()
        except (httpx.HTTPError, ValueError):
            # Gagal menyisipkan bukan alasan mematikan basemap: biarkan `url`
            # apa adanya (sudah tanpa kunci) dan peramban memintanya sendiri.
            continue
        sumber.pop("url", None)
        for bidang in BIDANG_TILEJSON:
            if bidang in tj:
                sumber[bidang] = tj[bidang]
    return gaya


@router.get(
    "/meta/basemap/{gaya}/style.json",
    summary="Gaya basemap MAPID, tanpa kunci",
    response_class=Response,
)
def gaya_basemap(gaya: str) -> Response:
    """Ambil style.json dari MAPID di sisi server, lalu serahkan tanpa kunci."""
    if gaya not in GAYA_BASEMAP:
        raise HTTPException(status_code=404, detail="Gaya basemap tidak dikenal")
    if not settings.mapid_maps_api_key:
        raise HTTPException(status_code=503, detail="MAPID_MAPS_API_KEY belum diisi")

    kunci_cache = f"basemap:{gaya}"
    kena, isi = cache.ambil(kunci_cache)
    if not kena:
        try:
            r = httpx.get(
                HULU_GAYA.format(gaya),
                params={"key": settings.mapid_maps_api_key},
                timeout=20.0,
            )
            r.raise_for_status()
            isi = _buang_kunci(r.text, settings.mapid_maps_api_key)
            gaya_json = _sisipkan_tilejson(
                json.loads(isi), settings.mapid_maps_api_key
            )
            # Dibersihkan SEKALI LAGI: TileJSON yang baru disisipkan membawa
            # `tiles` yang masih berkunci, dan lupa membersihkannya berarti
            # mengembalikan kuncinya lewat pintu yang baru saja ditutup.
            isi = _buang_kunci(
                json.dumps(gaya_json, separators=(",", ":")),
                settings.mapid_maps_api_key,
            )
        except (httpx.HTTPError, RuntimeError, ValueError) as e:
            # Sebabnya masuk log lewat penangan galat; ke pengguna cukup ini.
            raise HTTPException(
                status_code=502, detail="Basemap MAPID sedang tidak bisa dihubungi"
            ) from e
        cache.simpan(kunci_cache, isi, ttl=TTL_GAYA)

    return Response(
        content=isi,
        media_type="application/json",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("/meta/kawasan", summary="Enam kawasan pilot dan cakupan datanya")
def daftar_kawasan(db: Annotated[Session, Depends(get_db)]) -> list[dict[str, Any]]:
    """Kawasan yang sah beserta seberapa lengkap datanya.

    Dipakai frontend untuk mengisi pemilih kawasan, dan dipakai siapa pun yang
    ingin tahu kawasan mana yang sudah layak didemokan. Kawasan pilot yang belum
    punya satu baris pun tetap muncul dengan angka nol - menyembunyikannya akan
    membuat cakupan terlihat lebih baik daripada kenyataannya.
    """
    baris = {
        r.kawasan: r
        for r in db.execute(
            select(
                HexFeature.kawasan,
                func.count().label("heksagon"),
                func.count(HexFeature.harga_sewa_per_m2).label("berharga"),
                func.count()
                .filter(HexFeature.data_source == "observed")
                .label("observed"),
                func.count()
                .filter(HexFeature.tingkat_keyakinan == "TINGGI")
                .label("keyakinan_tinggi"),
            ).group_by(HexFeature.kawasan)
        ).all()
    }

    keluar = []
    for nama in KAWASAN_PILOT:
        r = baris.get(nama)
        total = r.heksagon if r else 0
        keluar.append(
            {
                "kawasan": nama,
                "heksagon": total,
                "cakupan_harga": round(r.berharga / total, 3) if r and total else 0.0,
                "cakupan_survei": round(r.observed / total, 3) if r and total else 0.0,
                "keyakinan_tinggi": r.keyakinan_tinggi if r else 0,
                "siap_demo": bool(total and r and r.observed),
            }
        )
    return keluar


@router.post("/meta/cache/bersihkan", summary="Kosongkan cache baca")
def bersihkan_cache(awalan: str | None = None) -> dict[str, Any]:
    """Dipanggil setelah pipeline memuat data baru.

    Tanpa ini, persentil kawasan yang sudah di-cache akan bertahan sampai TTL
    habis, dan angka baru hasil pipeline tidak muncul sampai sepuluh menit
    kemudian. Saat demo, sepuluh menit itu selamanya.
    """
    return {"dibuang": cache.bersihkan(awalan), "sisa": cache.statistik()}
