"""Kesehatan, kesiapan, dan cakupan data."""

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
from app.core.akun import PenggunaWajib
from app.core.galat import BukanAdmin
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
    """Pemeriksaan lengkap sebelum demo dimulai."""
    hasil: dict[str, Any] = {
        "siap": False,
        "lingkungan": settings.lingkungan,
        "basis_data": {"terjangkau": False},
        "cache": cache.statistik(),
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

        ikhtisar = db.execute(
            text(
                "SELECT "
                + ", ".join(f"count({k}) AS {k}" for k in SEMUA_VARIABEL)
                + " FROM hex_features"
            )  # noqa: S608
        ).one()
        n_terisi = sum(1 for n in ikhtisar if n and n > 0)

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



#: Daftar PUTIH, bukan jalur bebas. Tanpa ini endpointnya jadi proksi terbuka:
#: siapa pun bisa menyuruh server kita mengambil URL apa pun (SSRF).
GAYA_BASEMAP = ("light", "basic", "street-2d-building", "dark")

HULU_GAYA = "https://basemap.mapid.io/styles/{}/style.json"

BIDANG_TILEJSON = ("tiles", "minzoom", "maxzoom", "bounds", "attribution", "vector_layers")

#: Sehari. Gaya basemap praktis tidak pernah berubah, dan tiap kehilangan cache
#: berarti satu perjalanan ke MAPID sebelum peta pengguna bisa mulai menggambar.
TTL_GAYA = 86_400.0


def _buang_kunci(teks: str, kunci: str) -> str:
    """Cabut kunci dari SETIAP URL di dalam badan gaya."""
    bersih = re.sub(r"\?key=[^&\x22\x27\s]*&", "?", teks)
    bersih = re.sub(r"[?&]key=[^&\x22\x27\s]*", "", bersih)
    if kunci and kunci in bersih:
        # Jangan pernah meneruskan badan yang masih memuat kunci. Lebih baik
        # petanya gagal dengan galat yang terbaca daripada bocor tanpa suara.
        raise RuntimeError("kunci masih tersisa di badan gaya sesudah dibersihkan")
    return bersih


def _sisipkan_tilejson(gaya: dict, kunci: str) -> dict:
    """Ganti `sources[*].url` dengan isi TileJSON-nya, di sisi server."""
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


@router.get("/meta/kunci-basemap", summary="Kunci ubin basemap untuk peramban")
def kunci_basemap() -> dict[str, str | None]:
    """Kunci ubin MAPID untuk terbitan yang DIBANGUN tanpa kunci."""
    return {"kunci": settings.mapid_basemap_key_peramban or None}


@router.get("/meta/kawasan", summary="Enam kawasan pilot dan cakupan datanya")
def daftar_kawasan(db: Annotated[Session, Depends(get_db)]) -> list[dict[str, Any]]:
    """Kawasan yang sah beserta seberapa lengkap datanya."""
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


@router.post("/meta/cache/bersihkan", summary="Kosongkan cache baca (admin)")
def bersihkan_cache(user: PenggunaWajib, awalan: str | None = None) -> dict[str, Any]:
    """Dipanggil setelah pipeline memuat data baru."""
    if user.peran != "admin":
        raise BukanAdmin("Mengosongkan cache hanya untuk pengelola.")
    return {"dibuang": cache.bersihkan(awalan), "sisa": cache.statistik()}
