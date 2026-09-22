"""Tabel database Loconomics."""

from datetime import date, datetime

from geoalchemy2 import Geometry
from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

# ---------------------------------------------------------------------------
# 1. Referensi spasial
# ---------------------------------------------------------------------------


class TransportNode(Base):
    """Simpul transportasi darat. Level 1 unit analisis (±120-150 simpul)."""

    __tablename__ = "transport_nodes"

    id: Mapped[int] = mapped_column(primary_key=True)
    nama: Mapped[str] = mapped_column(String(120), nullable=False)
    moda: Mapped[str] = mapped_column(String(20), nullable=False)  # KRL|MRT|LRT|BRT|TERMINAL
    kawasan: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    jumlah_jalur: Mapped[int | None] = mapped_column(Integer)
    ridership_harian: Mapped[float | None] = mapped_column(Float)
    geom: Mapped[str] = mapped_column(Geometry("POINT", srid=4326), nullable=False)


class CatchmentArea(Base):
    """Isochrone per simpul dan per profil. Level 2 unit analisis. Dihitung offline."""

    __tablename__ = "catchment_areas"

    id: Mapped[int] = mapped_column(primary_key=True)
    transport_node_id: Mapped[int] = mapped_column(
        ForeignKey("transport_nodes.id", ondelete="CASCADE"), index=True
    )
    menit: Mapped[int] = mapped_column(Integer, nullable=False)  # 5 | 10 | 15 | 30 | 60
    geom: Mapped[str] = mapped_column(Geometry("POLYGON", srid=4326), nullable=False)
    #: Profil modanya. Tanpa kolom ini, pita mobil menimpa pita jalan kaki dan
    #: peta menggambar jangkauan jalan kaki walau modanya sudah berganti.
    profil: Mapped[str] = mapped_column(String(24), default="foot-walking", nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "transport_node_id", "menit", "profil", name="uq_catchment_node_menit_profil"
        ),
    )


class HexRoute(Base):
    """Rute jalan kaki dari pusat satu heksagon ke simpul transportasi terdekat."""

    __tablename__ = "hex_routes"

    id: Mapped[int] = mapped_column(primary_key=True)
    h3_index: Mapped[str] = mapped_column(
        ForeignKey("hex_features.h3_index", ondelete="CASCADE"), index=True
    )
    transport_node_id: Mapped[int] = mapped_column(
        ForeignKey("transport_nodes.id", ondelete="CASCADE"), index=True
    )
    #: 0 = rute tercepat, 1..n = alternatif. Urutan ditentukan ORS, bukan kami.
    urutan: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    #: Panjang rute mengikuti jalan, meter. BUKAN jarak garis lurus.
    jarak_m: Mapped[float] = mapped_column(Float, nullable=False)
    #: Lama jalan kaki menurut ORS, menit. Profil foot-walking.
    menit: Mapped[float] = mapped_column(Float, nullable=False)
    geom: Mapped[str] = mapped_column(Geometry("LINESTRING", srid=4326), nullable=False)
    profil: Mapped[str] = mapped_column(String(24), default="foot-walking", nullable=False)
    dihitung_pada: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint(
            "h3_index",
            "transport_node_id",
            "profil",
            "urutan",
            name="uq_rute_hex_simpul_profil_urutan",
        ),
    )


# ---------------------------------------------------------------------------
# 2. Observasi mentah - internal saja
# ---------------------------------------------------------------------------


class BusinessPOI(Base):
    """POI usaha terpadu hasil entity resolution (A5): MAPID + OSM + Overture."""

    __tablename__ = "business_pois"

    id: Mapped[int] = mapped_column(primary_key=True)
    h3_index: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    nama: Mapped[str] = mapped_column(String(200), nullable=False)
    kelas_induk: Mapped[str] = mapped_column(String(4), nullable=False)  # F1|F2|R1|R2|S1|S2|K1|T1
    kategori_asli: Mapped[str | None] = mapped_column(String(200))  # wajib disimpan untuk audit
    sumber: Mapped[str] = mapped_column(String(20), nullable=False)  # mapid|osm|overture
    is_waralaba: Mapped[bool] = mapped_column(Boolean, default=False)
    geom: Mapped[str] = mapped_column(Geometry("POINT", srid=4326), nullable=False)


class MenuObservation(Base):
    """Satu titik Menu Go. Sumber D10, B07, B08, C04, C07, C08."""

    __tablename__ = "menu_observations"

    id: Mapped[int] = mapped_column(primary_key=True)
    h3_index: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    nama_usaha: Mapped[str | None] = mapped_column(String(200))
    kondisi_pembeli: Mapped[str | None] = mapped_column(String(10))  # Sepi|Sedang|Ramai
    waktu_kunjungan: Mapped[datetime | None] = mapped_column(DateTime)
    mobilitas_keliling: Mapped[bool | None] = mapped_column(Boolean)  # kunci IPTT
    harga_rata_porsi: Mapped[float | None] = mapped_column(Float)
    menu_andalan: Mapped[str | None] = mapped_column(Text)
    kelas_kuliner: Mapped[str | None] = mapped_column(String(40))  # hasil A4
    surveyor_id: Mapped[str | None] = mapped_column(String(60))  # normalisasi upaya survei
    geom: Mapped[str] = mapped_column(Geometry("POINT", srid=4326), nullable=False)


class ReceiptObservation(Base):
    """Satu struk dari Struk Go. Nominal HANYA ada di foto -> diisi A2 (OCR)."""

    __tablename__ = "receipt_observations"

    id: Mapped[int] = mapped_column(primary_key=True)
    h3_index: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    nama_merchant: Mapped[str | None] = mapped_column(String(200))
    waktu_transaksi: Mapped[datetime | None] = mapped_column(DateTime)
    metode_bayar: Mapped[str | None] = mapped_column(String(40))
    foto_url: Mapped[str | None] = mapped_column(Text)
    total_nominal: Mapped[float | None] = mapped_column(Float)  # hasil A2
    ocr_confidence: Mapped[float | None] = mapped_column(Float)  # <0.7 -> antre verifikasi manusia
    ocr_terverifikasi: Mapped[bool] = mapped_column(Boolean, default=False)
    surveyor_id: Mapped[str | None] = mapped_column(String(60))
    geom: Mapped[str] = mapped_column(Geometry("POINT", srid=4326), nullable=False)


class PropertyObservation(Base):
    """Satu properti dari Properti Go. Harga HANYA ada di foto spanduk -> diisi A1 (OCR)."""

    __tablename__ = "property_observations"

    id: Mapped[int] = mapped_column(primary_key=True)
    h3_index: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    kategori: Mapped[str | None] = mapped_column(String(60))
    status: Mapped[str | None] = mapped_column(String(20))  # Sewa|Jual
    foto_spanduk_url: Mapped[str | None] = mapped_column(Text)
    harga_nominal: Mapped[float | None] = mapped_column(Float)  # hasil A1
    periode: Mapped[str | None] = mapped_column(String(20))  # bulan|tahun|tidak_disebut
    luas_m2: Mapped[float | None] = mapped_column(Float)
    skor_prestise: Mapped[float | None] = mapped_column(Float)  # hasil A3, skala 1-5
    ocr_confidence: Mapped[float | None] = mapped_column(Float)
    ocr_terverifikasi: Mapped[bool] = mapped_column(Boolean, default=False)
    geom: Mapped[str] = mapped_column(Geometry("POINT", srid=4326), nullable=False)


# ---------------------------------------------------------------------------
# 3. Hasil analisis
# ---------------------------------------------------------------------------


class HexFeature(Base):
    """Tabel pusat. Satu baris = satu heksagon H3 res-9 (±0,10 km², lebar ±350 m)."""

    __tablename__ = "hex_features"

    h3_index: Mapped[str] = mapped_column(String(20), primary_key=True)
    kawasan: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    geom: Mapped[str] = mapped_column(Geometry("POLYGON", srid=4326), nullable=False)

    # --- Dimensi Permintaan (D01-D12) - 12 variabel -----------------------
    pop_100m: Mapped[float | None] = mapped_column(Float)  # D01 WorldPop
    pop_usia_produktif: Mapped[float | None] = mapped_column(Float)  # D02 WorldPop age-sex
    jarak_simpul_m: Mapped[float | None] = mapped_column(Float)  # D03 OSM+OSRM
    waktu_jalan_menit: Mapped[float | None] = mapped_column(Float)  # D04 isochrone -> IPT
    skor_simpul: Mapped[float | None] = mapped_column(Float)  # D05 OSM+KAI  -> IPT
    ridership_proksi: Mapped[float | None] = mapped_column(Float)  # D06 KAI    -> IPT
    kepadatan_kos: Mapped[float | None] = mapped_column(Float)  # D07 Properti Go
    kepadatan_kantor: Mapped[float | None] = mapped_column(Float)  # D08 Properti Go+OSM
    generator_keramaian: Mapped[float | None] = mapped_column(Float)  # D09 OSM
    skor_ramai_terkoreksi: Mapped[float | None] = mapped_column(Float)  # D10 Menu Go -> IAE
    intensitas_transaksi: Mapped[float | None] = mapped_column(Float)  # D11 Struk Go -> IAE
    aktivitas_komunitas: Mapped[float | None] = mapped_column(Float)  # D12 Community Maps

    # --- Dimensi Perilaku Konsumen (B01-B10) - 10 variabel ----------------
    puncak_pagi: Mapped[float | None] = mapped_column(Float)  # B01 06-09  -> Commuter Clock
    puncak_siang: Mapped[float | None] = mapped_column(Float)  # B02 11-14
    puncak_sore: Mapped[float | None] = mapped_column(Float)  # B03 16-20
    puncak_malam: Mapped[float | None] = mapped_column(Float)  # B04 20-24
    rasio_weekend: Mapped[float | None] = mapped_column(Float)  # B05 Struk Go
    pangsa_digital: Mapped[float | None] = mapped_column(Float)  # B06 Struk Go
    harga_median_porsi: Mapped[float | None] = mapped_column(Float)  # B07 Menu Go  -> IAE
    spread_harga: Mapped[float | None] = mapped_column(Float)  # B08 Menu Go
    nominal_median_struk: Mapped[float | None] = mapped_column(Float)  # B09 A2 (OCR) -> IAE
    belanja_per_jam: Mapped[float | None] = mapped_column(Float)  # B10 A2 (OCR) -> PriceLens

    # --- Dimensi Kompetisi (C01-C08) - 8 variabel -------------------------
    n_kompetitor_langsung: Mapped[float | None] = mapped_column(Float)  # C01 kelas induk sama + k-ring 1
    kepadatan_poi_total: Mapped[float | None] = mapped_column(Float)  # C02
    keragaman_usaha: Mapped[float | None] = mapped_column(Float)  # C03 entropi Shannon -> IKP
    keragaman_kuliner: Mapped[float | None] = mapped_column(Float)  # C04 A4
    pangsa_waralaba: Mapped[float | None] = mapped_column(Float)  # C05 -> IKP, prestise
    rasio_kompetitor_per_kapita: Mapped[float | None] = mapped_column(Float)  # C06 -> IKP
    rasio_keliling: Mapped[float | None] = mapped_column(Float)  # C07 Menu Go -> IPTT
    n_menetap_kuliner: Mapped[float | None] = mapped_column(Float)  # C08 -> IPTT

    # --- Dimensi Biaya & Pasokan Ruang (P01-P07) - 7 variabel -------------
    njop_m2: Mapped[float | None] = mapped_column(Float)  # P01 Jakarta Satu -> IBR
    njop_persentil: Mapped[float | None] = mapped_column(Float)  # P02 -> prestise
    pasokan_sewa_komersial: Mapped[float | None] = mapped_column(Float)  # P03 Properti Go
    rasio_sewa_jual: Mapped[float | None] = mapped_column(Float)  # P04 Properti Go
    harga_sewa_median: Mapped[float | None] = mapped_column(Float)  # P05 A1 (OCR) -> IBR
    indeks_churn: Mapped[float | None] = mapped_column(Float)  # P06 -> IBR, RiskRadar
    harga_sewa_per_m2: Mapped[float | None] = mapped_column(Float)  # P07 A1 (OCR) -> PriceLens

    # --- Dimensi Risiko & Legalitas (L01-L03) - 3 variabel -----------------
    zona_izin_komersial: Mapped[bool | None] = mapped_column(Boolean)  # L01 GATE: FALSE -> skor 0
    kelas_zona: Mapped[str | None] = mapped_column(String(40))  # L02 kode RDTR
    risiko_banjir: Mapped[float | None] = mapped_column(Float)  # L03 InaRISK -> IBR

    # --- Dimensi Morfologi & Prestise Visual (M01-M03) - 3 variabel --------
    rasio_tutupan_bangunan: Mapped[float | None] = mapped_column(Float)  # M01 Open Buildings
    luas_bangunan_median: Mapped[float | None] = mapped_column(Float)  # M02 Open Buildings
    skor_prestise_visual: Mapped[float | None] = mapped_column(Float)  # M03 A3, sumbu X kuadran

    # --- Penanda kualitas data (Q01-Q03) - WAJIB tampil di UI --------------
    n_titik_misi: Mapped[int] = mapped_column(Integer, default=0)  # Q01
    tingkat_keyakinan: Mapped[str] = mapped_column(  # Q02 >=30 TINGGI | 10-29 SEDANG | <10 RENDAH
        String(10), default="RENDAH", nullable=False
    )
    data_source: Mapped[str] = mapped_column(  # Q03 observed | predicted
        String(10), default="predicted", nullable=False
    )

    diperbarui_pada: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (Index("ix_hex_keyakinan", "tingkat_keyakinan"),)


class HexHourlyProfile(Base):
    """Commuter Clock - satu baris per (heksagon, jam). 18 baris per heksagon, 05:00-22:00."""

    __tablename__ = "hex_hourly_profiles"

    id: Mapped[int] = mapped_column(primary_key=True)
    h3_index: Mapped[str] = mapped_column(
        ForeignKey("hex_features.h3_index", ondelete="CASCADE"), index=True
    )
    jam: Mapped[int] = mapped_column(Integer, nullable=False)  # 5..22

    n_transaksi: Mapped[int] = mapped_column(Integer, default=0)
    nominal_total: Mapped[float | None] = mapped_column(Float)
    nominal_median: Mapped[float | None] = mapped_column(Float)

    pangsa_captive: Mapped[float | None] = mapped_column(Float)  # 0..1
    metode: Mapped[str] = mapped_column(String(10), default="proxy", nullable=False)

    __table_args__ = (UniqueConstraint("h3_index", "jam", name="uq_profil_hex_jam"),)


class LocationScore(Base):
    """Keluaran mesin skoring. Diversikan supaya bobot bisa diubah tanpa menimpa baseline."""

    __tablename__ = "location_scores"

    id: Mapped[int] = mapped_column(primary_key=True)
    h3_index: Mapped[str] = mapped_column(
        ForeignKey("hex_features.h3_index", ondelete="CASCADE"), index=True
    )
    versi: Mapped[str] = mapped_column(String(40), default="baseline", nullable=False)

    ipt: Mapped[float | None] = mapped_column(Float)
    iae: Mapped[float | None] = mapped_column(Float)
    ikp: Mapped[float | None] = mapped_column(Float)
    ibr: Mapped[float | None] = mapped_column(Float)

    opportunity_score: Mapped[float | None] = mapped_column(Float, index=True)
    hidden_gem_score: Mapped[float | None] = mapped_column(Float, index=True)

    residual_biaya: Mapped[float | None] = mapped_column(Float)  # metode 1 hidden gem
    iptt: Mapped[float | None] = mapped_column(Float)  # metode 3 hidden gem
    kuadran: Mapped[str | None] = mapped_column(String(20))  # metode 2: HIDDEN_GEM|JEBAKAN_GENGSI|...

    # Sumbu X diagram kuadran RiskRadar. Disimpan, bukan dihitung ulang saat
    # request: nilainya rata-rata lima komponen yang normalisasinya bergantung
    # pada seluruh kawasan, jadi tidak bisa direproduksi dari satu baris saja.
    prestise_visual: Mapped[float | None] = mapped_column(Float)

    n_metode_lolos: Mapped[int | None] = mapped_column(Integer)

    peringkat: Mapped[int | None] = mapped_column(Integer)
    dihitung_pada: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (UniqueConstraint("h3_index", "versi", name="uq_score_hex_versi"),)


class ScoreFactor(Base):
    """Rincian kontribusi tiap variabel ke skor akhir. Sumber jawaban jelaskan_skor()."""

    __tablename__ = "score_factors"

    id: Mapped[int] = mapped_column(primary_key=True)
    h3_index: Mapped[str] = mapped_column(
        ForeignKey("hex_features.h3_index", ondelete="CASCADE"), index=True
    )
    versi: Mapped[str] = mapped_column(String(40), default="baseline", nullable=False)
    kode_variabel: Mapped[str] = mapped_column(String(4), nullable=False)  # D05, B07, C06, ...
    indeks: Mapped[str] = mapped_column(String(4), nullable=False)  # IPT|IAE|IKP|IBR
    nilai_mentah: Mapped[float | None] = mapped_column(Float)
    nilai_normalisasi: Mapped[float | None] = mapped_column(Float)
    persentil: Mapped[float | None] = mapped_column(Float)  # untuk narasi "persentil 78"
    kontribusi: Mapped[float | None] = mapped_column(Float)  # bobot x nilai_normalisasi


class BlokHeksagon(Base):
    """Blok di DALAM heksagon - anak H3 resolusi 10, tujuh per heksagon."""

    __tablename__ = "blok_heksagon"

    h3_blok: Mapped[str] = mapped_column(String(20), primary_key=True)
    h3_induk: Mapped[str] = mapped_column(
        ForeignKey("hex_features.h3_index", ondelete="CASCADE"), index=True, nullable=False
    )
    geom: Mapped[str] = mapped_column(Geometry("POLYGON", srid=4326), nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lon: Mapped[float] = mapped_column(Float, nullable=False)

    #: Jalan kaki SUNGGUHAN ke simpul heksagon induknya (ORS matrix), menit.
    menit_jalan: Mapped[float | None] = mapped_column(Float)
    jarak_jalan_m: Mapped[float | None] = mapped_column(Float)
    #: Jalan utama terdekat (trunk..tertiary). KOSONG kalau tidak bisa
    #: dipastikan - jalan terdekat yang sebenarnya mungkin di luar area tarikan.
    jarak_jalan_utama_m: Mapped[float | None] = mapped_column(Float)
    nama_jalan_utama: Mapped[str | None] = mapped_column(String(120))
    kelas_jalan_utama: Mapped[str | None] = mapped_column(String(24))
    jarak_jalan_terdekat_m: Mapped[float | None] = mapped_column(Float)
    #: Usaha OSM dalam 150 m, total dan per kelas induk {"F1": n, ...}.
    n_usaha_150m: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    usaha_per_kelas_150m: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    #: Penarik keramaian dalam 250 m, total dan per jenis {"sekolah": n, ...}.
    n_penarik_250m: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    penarik_250m: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    jarak_halte_m: Mapped[float | None] = mapped_column(Float)
    n_bangunan: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rasio_tutupan_bangunan: Mapped[float | None] = mapped_column(Float)
    #: Zonasi RDTR per blok. None = tidak diketahui (di luar DKI), BUKAN dilarang.
    izin_komersial: Mapped[bool | None] = mapped_column(Boolean)
    kelas_zona: Mapped[str | None] = mapped_column(String(60))
    pangsa_zona_usaha: Mapped[float | None] = mapped_column(Float)
    risiko_banjir: Mapped[float | None] = mapped_column(Float)

    skor_blok: Mapped[float | None] = mapped_column(Float, index=True)
    #: Skor per kelas induk usaha, {"F1": 72.4, ...} - memuat penalti pesaing sekelas.
    skor_per_kelas: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    kontribusi: Mapped[dict | None] = mapped_column(JSONB)
    #: 1 = blok terbaik di heksagon induknya.
    peringkat_induk: Mapped[int | None] = mapped_column(Integer)
    dihitung_pada: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class HexPerkiraan(Base):
    """PERKIRAAN pendukung per heksagon - terpisah dari `hex_features` dengan sengaja."""

    __tablename__ = "hex_perkiraan"

    id: Mapped[int] = mapped_column(primary_key=True)
    h3_index: Mapped[str] = mapped_column(
        ForeignKey("hex_features.h3_index", ondelete="CASCADE"), index=True, nullable=False
    )
    #: Kode variabel yang diperkirakan (P05, B07, B09) atau JAM untuk pola jam.
    kode: Mapped[str] = mapped_column(String(8), nullable=False)
    nilai: Mapped[float | None] = mapped_column(Float)
    #: Rincian yang tidak muat di satu angka - kuartil, atau pangsa per jam.
    rincian: Mapped[dict | None] = mapped_column(JSONB)
    #: Cara memperkirakannya: sekitar | kawasan | jabodetabek.
    metode: Mapped[str] = mapped_column(String(24), nullable=False)
    #: Berapa pengamatan sungguhan yang menyusunnya, dan dalam radius berapa.
    n_sumber: Mapped[int | None] = mapped_column(Integer)
    radius_m: Mapped[int | None] = mapped_column(Integer)
    dihitung_pada: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (UniqueConstraint("h3_index", "kode", name="uq_perkiraan_hex_kode"),)


class AICallLog(Base):
    """Catatan setiap panggilan AI (docs/ai.md 8.4)."""

    __tablename__ = "ai_call_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    fitur: Mapped[str] = mapped_column(String(10), nullable=False)  # A1|A2|A3|A4|A5|B1|B2|...
    model: Mapped[str | None] = mapped_column(String(60))
    input_ref: Mapped[str | None] = mapped_column(Text)  # URL foto / ringkasan prompt
    output_ringkas: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[float | None] = mapped_column(Float)
    perlu_review: Mapped[bool] = mapped_column(Boolean, default=False)
    biaya_usd: Mapped[float | None] = mapped_column(Float)
    dibuat_pada: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ---------------------------------------------------------------------------
# 4. Akun dan langganan
# ---------------------------------------------------------------------------


class User(Base):
    """Satu akun."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    nama_pengguna: Mapped[str] = mapped_column(String(40), nullable=False, unique=True, index=True)
    email: Mapped[str] = mapped_column(String(160), nullable=False, unique=True, index=True)
    sidik_sandi: Mapped[str] = mapped_column(String(255), nullable=False)
    nama_tampilan: Mapped[str | None] = mapped_column(String(80))
    peran: Mapped[str] = mapped_column(String(20), nullable=False, default="pengguna")
    aktif: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    saldo_token: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    preferensi: Mapped[str | None] = mapped_column(Text)
    dibuat_pada: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    terakhir_masuk: Mapped[datetime | None] = mapped_column(DateTime)


class Subscription(Base):
    """Satu periode langganan."""

    __tablename__ = "subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    paket: Mapped[str] = mapped_column(String(30), nullable=False)  # bulanan|selamanya
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="aktif")
    selamanya: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    harga_rp: Mapped[int | None] = mapped_column(Integer)
    dimulai_pada: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    berlaku_sampai: Mapped[datetime | None] = mapped_column(DateTime)
    # Diisi begitu pembayaran QRIS sungguhan terpasang. Sekarang selalu "demo",
    # dan itu dinyatakan apa adanya di antarmuka - tidak disamarkan jadi seolah
    # ada uang yang berpindah.
    metode_bayar: Mapped[str] = mapped_column(String(20), nullable=False, default="demo")
    referensi_bayar: Mapped[str | None] = mapped_column(String(80))


class TokenLedger(Base):
    """Buku besar token. Satu baris per mutasi, tidak pernah disunting."""

    __tablename__ = "token_ledger"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    jumlah: Mapped[int] = mapped_column(Integer, nullable=False)
    keperluan: Mapped[str] = mapped_column(String(40), nullable=False)
    catatan: Mapped[str | None] = mapped_column(String(200))
    h3_index: Mapped[str | None] = mapped_column(String(20))
    saldo_sesudah: Mapped[int] = mapped_column(Integer, nullable=False)
    dibuat_pada: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class PremiumUnlock(Base):
    """Heksagon yang sudah dibuka dengan token oleh satu akun."""

    __tablename__ = "premium_unlocks"
    __table_args__ = (UniqueConstraint("user_id", "h3_index", "jenis", name="uq_unlock"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    h3_index: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    jenis: Mapped[str] = mapped_column(String(30), nullable=False)  # detail|laporan
    dibuat_pada: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class WatchlistItem(Base):
    """Heksagon yang dipantau satu akun. Fitur Pemantauan."""

    __tablename__ = "watchlist_items"
    __table_args__ = (UniqueConstraint("user_id", "h3_index", name="uq_watchlist"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    h3_index: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    catatan: Mapped[str | None] = mapped_column(String(200))
    #: Titik yang ditandai orangnya DI DALAM heksagon. NULL = titik tengahnya.
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    #: Nama yang ia berikan ("Ruko pojok Kendal"). NULL = kode lokasi.
    nama: Mapped[str | None] = mapped_column(String(80))
    #: Usahanya sendiri: namanya (muncul di pin peta) dan deskripsinya.
    nama_usaha: Mapped[str | None] = mapped_column(String(80))
    deskripsi: Mapped[str | None] = mapped_column(Text)
    #: Rencana pengembangan yang ia catat untuk lokasi ini: usaha apa yang
    #: direncanakan, dan omzet usahanya sekarang. Dipakai memproyeksikan
    #: pertumbuhan lewat mesin simulasi yang sama - bukan angka baru.
    rencana_jenis_usaha: Mapped[str | None] = mapped_column(String(40))
    rencana_omzet_bulanan: Mapped[float | None] = mapped_column(Float)
    skor_saat_dipantau: Mapped[float | None] = mapped_column(Float)
    versi_saat_dipantau: Mapped[str | None] = mapped_column(String(40))
    dibuat_pada: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class UsahaPenjualan(Base):
    """Catatan penjualan SATU BULAN usaha di satu lokasi tersimpan.

    Diisi pemiliknya sendiri, bukan hasil pengukuran. Dipakai menghitung tren
    bulanannya - dan tidak pernah masuk ke perhitungan skor mana pun.
    """

    __tablename__ = "usaha_penjualan"
    __table_args__ = (
        UniqueConstraint("user_id", "h3_index", "bulan", name="uq_penjualan_user_hex_bulan"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    h3_index: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    #: Selalu hari PERTAMA bulan itu, supaya satu bulan cuma punya satu baris.
    bulan: Mapped[date] = mapped_column(Date, nullable=False)
    omzet: Mapped[float | None] = mapped_column(Float)
    pembeli: Mapped[int | None] = mapped_column(Integer)
    catatan: Mapped[str | None] = mapped_column(String(200))
    dibuat_pada: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
