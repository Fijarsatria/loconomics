from geoalchemy2 import Geometry
from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class TransportNode(Base):
    __tablename__ = "transport_nodes"

    id: Mapped[int] = mapped_column(primary_key=True)
    nama: Mapped[str] = mapped_column(String, nullable=False)
    moda: Mapped[str] = mapped_column(String, nullable=False)  # KRL, MRT, LRT, BRT
    kawasan: Mapped[str] = mapped_column(String, nullable=False)  # 6 kawasan pilot
    geom: Mapped[str] = mapped_column(Geometry("POINT", srid=4326))


class CatchmentArea(Base):
    __tablename__ = "catchment_areas"

    id: Mapped[int] = mapped_column(primary_key=True)
    transport_node_id: Mapped[int] = mapped_column(ForeignKey("transport_nodes.id"))
    menit: Mapped[int] = mapped_column(Integer, nullable=False)  # 5 / 10 / 15
    geom: Mapped[str] = mapped_column(Geometry("POLYGON", srid=4326))


class HexFeature(Base):
    """Tabel pusat: 1 baris per heksagon H3 resolusi 9."""

    __tablename__ = "hex_features"

    h3_index: Mapped[str] = mapped_column(String, primary_key=True)
    kawasan: Mapped[str] = mapped_column(String, nullable=False)
    geom: Mapped[str] = mapped_column(Geometry("POLYGON", srid=4326))

    # Skor komposit
    ipt: Mapped[float | None] = mapped_column(Float)
    iae: Mapped[float | None] = mapped_column(Float)
    ikp: Mapped[float | None] = mapped_column(Float)
    ibr: Mapped[float | None] = mapped_column(Float)
    opportunity_score: Mapped[float | None] = mapped_column(Float)
    hidden_gem_score: Mapped[float | None] = mapped_column(Float)

    # ZoneGuard — gate hukum
    zona_izin_komersial: Mapped[bool] = mapped_column(Boolean, default=True)

    # Badge kepercayaan — wajib menyertai tiap respons skor
    n_titik_misi: Mapped[int] = mapped_column(Integer, default=0)
    tingkat_keyakinan: Mapped[str] = mapped_column(String, default="RENDAH")  # TINGGI/SEDANG/RENDAH
    data_source: Mapped[str] = mapped_column(String, default="predicted")  # observed/predicted


class BusinessPOI(Base):
    __tablename__ = "business_pois"

    id: Mapped[int] = mapped_column(primary_key=True)
    h3_index: Mapped[str] = mapped_column(ForeignKey("hex_features.h3_index"))
    nama: Mapped[str] = mapped_column(String, nullable=False)
    kategori: Mapped[str] = mapped_column(String, nullable=False)
    geom: Mapped[str] = mapped_column(Geometry("POINT", srid=4326))


class MenuObservation(Base):
    __tablename__ = "menu_observations"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_poi_id: Mapped[int] = mapped_column(ForeignKey("business_pois.id"))
    foto_url: Mapped[str] = mapped_column(Text, nullable=False)
    harga_terbaca: Mapped[float | None] = mapped_column(Float)
    confidence_ocr: Mapped[float | None] = mapped_column(Float)


class ReceiptObservation(Base):
    __tablename__ = "receipt_observations"

    id: Mapped[int] = mapped_column(primary_key=True)
    business_poi_id: Mapped[int] = mapped_column(ForeignKey("business_pois.id"))
    foto_url: Mapped[str] = mapped_column(Text, nullable=False)
    total_belanja: Mapped[float | None] = mapped_column(Float)
    jam_transaksi: Mapped[str | None] = mapped_column(String)
    confidence_ocr: Mapped[float | None] = mapped_column(Float)


class PropertyObservation(Base):
    __tablename__ = "property_observations"

    id: Mapped[int] = mapped_column(primary_key=True)
    h3_index: Mapped[str] = mapped_column(ForeignKey("hex_features.h3_index"))
    foto_url: Mapped[str] = mapped_column(Text, nullable=False)
    harga_sewa_terbaca: Mapped[float | None] = mapped_column(Float)
    confidence_ocr: Mapped[float | None] = mapped_column(Float)


class ScoreFactor(Base):
    """Rincian 41 variabel input per heksagon (D04-D11, B07-B09, C03-C06, P01-P06, L01-L03, dst)."""

    __tablename__ = "score_factors"

    id: Mapped[int] = mapped_column(primary_key=True)
    h3_index: Mapped[str] = mapped_column(ForeignKey("hex_features.h3_index"))
    kode_variabel: Mapped[str] = mapped_column(String, nullable=False)  # mis. "D05", "C06"
    nilai: Mapped[float | None] = mapped_column(Float)
    sumber: Mapped[str] = mapped_column(String, default="predicted")  # observed/predicted
