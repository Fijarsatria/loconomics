"""Bentuk galat yang seragam untuk seluruh API."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("loconomics")

HEADER_REQUEST_ID = "X-Request-ID"


class KesalahanAPI(Exception):
    """Galat yang memang kita duga dan sudah kita namai."""

    status_code = status.HTTP_400_BAD_REQUEST
    kode = "PERMINTAAN_TIDAK_VALID"

    def __init__(self, pesan: str, detail: dict[str, Any] | None = None):
        super().__init__(pesan)
        self.pesan = pesan
        self.detail = detail or {}


class TidakDitemukan(KesalahanAPI):
    status_code = status.HTTP_404_NOT_FOUND
    kode = "TIDAK_DITEMUKAN"


class KawasanTidakDikenal(KesalahanAPI):
    """Salah ketik nama kawasan."""

    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    kode = "KAWASAN_TIDAK_DIKENAL"


class TerlaluBanyakPermintaan(KesalahanAPI):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    kode = "TERLALU_BANYAK_PERMINTAAN"


class AnggaranHabis(KesalahanAPI):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    kode = "ANGGARAN_AI_HABIS"


class LayananBelumSiap(KesalahanAPI):
    status_code = status.HTTP_501_NOT_IMPLEMENTED
    kode = "LAYANAN_BELUM_SIAP"


class BasisDataBermasalah(KesalahanAPI):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    kode = "BASIS_DATA_BERMASALAH"




class TidakTerautentikasi(KesalahanAPI):
    """Belum masuk, padahal endpoint ini menuntutnya."""

    status_code = status.HTTP_401_UNAUTHORIZED
    kode = "TIDAK_TERAUTENTIKASI"


class KredensialSalah(KesalahanAPI):
    """Surel/nama pengguna atau kata sandi tidak cocok."""

    status_code = status.HTTP_401_UNAUTHORIZED
    kode = "KREDENSIAL_SALAH"


class BukanAdmin(KesalahanAPI):
    """Sudah masuk, tetapi tindakan ini hanya untuk pengelola."""

    status_code = status.HTTP_403_FORBIDDEN
    kode = "BUKAN_ADMIN"


class AkunSudahAda(KesalahanAPI):
    status_code = status.HTTP_409_CONFLICT
    kode = "AKUN_SUDAH_ADA"


class ButuhPremium(KesalahanAPI):
    """Sudah masuk, tetapi tingkatnya belum cukup."""

    status_code = status.HTTP_402_PAYMENT_REQUIRED
    kode = "BUTUH_PREMIUM"


def _amplop(
    kode: str, pesan: str, status_code: int, request_id: str, detail: Any = None
) -> JSONResponse:
    isi: dict[str, Any] = {"kode": kode, "pesan": pesan, "request_id": request_id}
    if detail:
        isi["detail"] = detail
    return JSONResponse(
        status_code=status_code,
        content={"galat": isi},
        headers={HEADER_REQUEST_ID: request_id},
    )


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


def pasang(app: FastAPI) -> None:
    """Pasang middleware request-id dan seluruh penangan galat."""

    @app.middleware("http")
    async def tandai_request(request: Request, call_next):
        """Beri setiap permintaan satu id pendek."""
        request.state.request_id = request.headers.get(HEADER_REQUEST_ID) or uuid.uuid4().hex[:8]
        respons = await call_next(request)
        respons.headers[HEADER_REQUEST_ID] = request.state.request_id
        return respons

    @app.exception_handler(KesalahanAPI)
    async def _kesalahan_api(request: Request, exc: KesalahanAPI):
        rid = _request_id(request)
        log.info("[%s] %s: %s", rid, exc.kode, exc.pesan)
        return _amplop(exc.kode, exc.pesan, exc.status_code, rid, exc.detail)

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException):
        rid = _request_id(request)
        return _amplop(
            f"HTTP_{exc.status_code}", str(exc.detail), exc.status_code, rid
        )

    @app.exception_handler(RequestValidationError)
    async def _validasi(request: Request, exc: RequestValidationError):
        rid = _request_id(request)
        return _amplop(
            "PARAMETER_TIDAK_VALID",
            "Ada parameter yang tidak sesuai. Lihat detail.",
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            rid,
            exc.errors(),
        )

    @app.exception_handler(OperationalError)
    async def _db_mati(request: Request, exc: OperationalError):
        """Supabase free tier dijeda kalau lama menganggur."""
        rid = _request_id(request)
        log.error("[%s] basis data tidak terjangkau: %s", rid, exc)
        return _amplop(
            BasisDataBermasalah.kode,
            "Basis data sedang tidak bisa dihubungi. Kalau ini terjadi setelah lama "
            "menganggur, Supabase free tier kemungkinan sedang dibangunkan - coba "
            "lagi dalam beberapa puluh detik.",
            BasisDataBermasalah.status_code,
            rid,
        )

    @app.exception_handler(SQLAlchemyError)
    async def _db_lain(request: Request, exc: SQLAlchemyError):
        rid = _request_id(request)
        log.exception("[%s] galat basis data", exc_info=exc)
        return _amplop(
            "GALAT_BASIS_DATA",
            "Terjadi kesalahan saat membaca basis data.",
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            rid,
        )

    @app.exception_handler(Exception)
    async def _tak_terduga(request: Request, exc: Exception):
        """Jaring terakhir."""
        rid = _request_id(request)
        log.exception("[%s] galat tak terduga", exc_info=exc)
        return _amplop(
            "GALAT_INTERNAL",
            f"Terjadi kesalahan di server. Sebutkan kode {rid} kalau melaporkannya.",
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            rid,
        )
