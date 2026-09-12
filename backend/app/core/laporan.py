"""Bahasa visual bersama untuk ketiga laporan PDF.

Berkas ini lahir 13 Sep 2026 atas satu permintaan pemilik repo: laporan PDF
yang "kreatif, diperbanyak visualnya, dan enak untuk dipahami", berlogo
Loconomics. Yang ada sebelumnya benar tetapi polos - tabel demi tabel, tanpa
kop, tanpa markah, dan tanpa satu pun ringkasan yang bisa dibaca dalam tiga
detik.

Kenapa modul TERSENDIRI, padahal repo ini sengaja ramping: ada TIGA laporan
(kelayakan, komparasi, simulasi) dan ketiganya harus terlihat seperti keluarga
yang sama. Menaruh bahasa visualnya di `api/akun.py` berarti tiga endpoint
mewarisi kop dan kaki lewat fungsi privat di modul API - dan laporan keempat
yang ditulis orang berikutnya akan menyalinnya alih-alih meminjamnya.

Yang TIDAK ada di sini, dan itu disengaja:

  Tidak ada satu pun angka yang dihitung. Modul ini menggambar; yang
  menghitung tetap pipeline dan `core/simulasi.py` (aturan 1).

  Tidak ada tangkapan peta. Menyisipkannya berarti merender MapLibre di sisi
  server - satu peramban tanpa kepala di dalam kontainer API - untuk gambar
  yang tidak menambah satu pun angka yang bisa diaudit. Yang menggantikannya
  diagram vektor yang digambar dari angka yang sama dengan yang dicetak di
  sebelahnya, jadi keduanya tidak bisa berselisih.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from reportlab.graphics.shapes import Circle, Drawing, Line, Polygon, Rect, String, Wedge
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, Paragraph, Spacer, Table, TableStyle

#: Markah produk. PNG, bukan SVG: reportlab tidak menggambar SVG tanpa pustaka
#: tambahan, dan menambahkan satu dependensi untuk satu gambar tidak sepadan.
#: Dibangkitkan dari `frontend/public/favicon.svg` - satu bentuk, dua wujud.
MARKAH = Path(__file__).resolve().parents[1] / "aset" / "loconomics-mark.png"

# Palet. Diambil dari produknya, bukan dipilih ulang: teal rute utama dan
# hijau tua chrome-nya. Dokumen yang warnanya tidak dikenali dari layar
# terbaca sebagai dokumen dari produk lain.
TEAL = colors.HexColor("#2DE8C0")
TEAL_TUA = colors.HexColor("#12836C")
TINTA = colors.HexColor("#0b3d37")
ABU = colors.HexColor("#5b6b68")
GARIS = colors.HexColor("#dfe6e3")
LATAR = colors.HexColor("#f4f8f6")

#: Warna kuadran, kembaran `frontend/src/config.ts::KUADRAN[..].warnaPeta`.
#: Kesamaannya dijaga `tests/test_aturan.py` - kuadran yang berwarna berbeda di
#: layar dan di PDF adalah dua produk yang mengaku satu.
WARNA_KUADRAN = {
    "HIDDEN_GEM": colors.HexColor("#4C93F7"),
    "PEMENANG_JELAS": colors.HexColor("#15803D"),
    "JEBAKAN_GENGSI": colors.HexColor("#E58A00"),
    "HINDARI": colors.HexColor("#B01B1B"),
}


def gaya() -> dict[str, ParagraphStyle]:
    """Gaya paragraf ketiga laporan. Satu tempat, bukan tiga."""
    dasar = getSampleStyleSheet()
    return {
        "h1": ParagraphStyle(
            "h1", parent=dasar["Title"], fontSize=19, leading=22, spaceAfter=2,
            alignment=0, textColor=colors.white,
        ),
        "h1g": ParagraphStyle(
            "h1g", parent=dasar["Title"], fontSize=18, leading=21, spaceAfter=2,
            alignment=0, textColor=TINTA,
        ),
        "h2": ParagraphStyle(
            "h2", parent=dasar["Heading2"], fontSize=11, spaceBefore=12, spaceAfter=5,
            textColor=TINTA,
        ),
        "n": ParagraphStyle("n", parent=dasar["Normal"], fontSize=9.4, leading=13.5),
        "nb": ParagraphStyle(
            "nb", parent=dasar["Normal"], fontSize=9.4, leading=13.5, textColor=colors.white,
        ),
        "kecil": ParagraphStyle("kecil", parent=dasar["Normal"], fontSize=8.2, textColor=ABU),
        "kecilp": ParagraphStyle(
            "kecilp", parent=dasar["Normal"], fontSize=8.2,
            textColor=colors.HexColor("#bfeee2"),
        ),
        "besar": ParagraphStyle(
            "besar", parent=dasar["Normal"], fontSize=30, leading=32, textColor=colors.white,
        ),
    }


def kop(judul: str, subjudul: str, lebar: float, g: dict) -> Table:
    """Pita kop bermerek: markah, nama produk, judul dokumen.

    Satu pita berwarna di kepala halaman pertama, bukan logo kecil di sudut.
    Yang dituju bukan hiasan: dokumen ini dibawa ke pemberi modal bersama
    berkas-berkas lain, dan yang membuatnya dikenali kembali di tumpukan itu
    adalah blok warna, bukan tipografinya.
    """
    kiri: list[Any] = []
    if MARKAH.exists():
        kiri.append(Image(str(MARKAH), width=13 * mm, height=13 * mm))
    kanan = [
        Paragraph(judul, g["h1"]),
        Paragraph(subjudul, g["kecilp"]),
    ]
    t = Table(
        [[kiri or "", kanan]],
        colWidths=[16 * mm, lebar - 16 * mm],
    )
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), TINTA),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (0, 0), 9),
        ("LEFTPADDING", (1, 0), (1, 0), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    return t


def kaki(canvas, dok) -> None:
    """Kaki tiap halaman: markah kecil, nama produk, nomor halaman.

    Dipasang lewat `onPage`, jadi ia ikut di SETIAP halaman - termasuk lampiran
    yang panjang. Halaman lampiran yang terlepas dari dokumennya harus tetap
    bisa dikenali asalnya.
    """
    canvas.saveState()
    l, b = dok.leftMargin, 10 * mm
    kanan = dok.pagesize[0] - dok.rightMargin
    canvas.setStrokeColor(GARIS)
    canvas.setLineWidth(0.6)
    canvas.line(l, b + 9, kanan, b + 9)
    if MARKAH.exists():
        canvas.drawImage(str(MARKAH), l, b - 2, width=8, height=8, mask="auto")
    canvas.setFillColor(ABU)
    canvas.setFont("Helvetica", 7.2)
    canvas.drawString(l + 11, b + 0.6, "Loconomics — Transit-oriented Retail Recommender")
    canvas.drawRightString(kanan, b + 0.6, f"Halaman {canvas.getPageNumber()}")
    canvas.restoreState()


def donat(nilai: float | None, maks: float = 100, ukuran: float = 46) -> Drawing:
    """Cincin skor. Kosong digambar sebagai cincin ABU-ABU penuh, bukan nol.

    Nol dan "belum dihitung" adalah dua pernyataan yang berbeda, dan cincin
    yang kosong sampai habis terbaca sebagai yang pertama.
    """
    d = Drawing(ukuran, ukuran)
    r, c = ukuran / 2, ukuran / 2
    d.add(Circle(c, c, r, fillColor=None, strokeColor=GARIS, strokeWidth=5))
    if nilai is not None and maks:
        sudut = max(0.0, min(1.0, nilai / maks)) * 360
        if sudut > 0:
            # Sudut NAIK, dari `90 - sudut` ke `90`. Reportlab menggambar wedge
            # berlawanan arah jarum jam; memberi (90, 90 - sudut) membuatnya
            # menempuh sisa lingkarannya - cincin 82% tergambar seperti 18%.
            d.add(Wedge(c, c, r, 90 - sudut, 90, yradius=r,
                        fillColor=None, strokeColor=TEAL_TUA, strokeWidth=5))
    d.add(Circle(c, c, r - 5.5, fillColor=colors.white, strokeColor=None))
    teks = "—" if nilai is None else f"{nilai:.0f}"
    d.add(String(c, c - 4.5, teks, fontName="Helvetica-Bold", fontSize=14,
                 fillColor=TINTA, textAnchor="middle"))
    return d


def heksagon_blok(sorot: int | None, ukuran: float = 46) -> Drawing:
    """Tujuh blok res-10 di dalam satu heksagon, satu di antaranya disorot.

    Dipakai laporan simulasi dan kelayakan untuk menyatakan hal yang paling
    sering salah dipahami orang: skor itu milik petak selebar 350 m, dan di
    dalamnya masih ada tujuh sisi yang berbeda.
    """
    d = Drawing(ukuran, ukuran)
    c, R = ukuran / 2, ukuran / 2 - 1
    sudut = [90, 150, 210, 270, 330, 30]

    def segi(cx: float, cy: float, r: float) -> list[float]:
        titik: list[float] = []
        for a in sudut:
            titik += [cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))]
        return titik

    d.add(Polygon(segi(c, c, R), fillColor=None, strokeColor=GARIS, strokeWidth=1.2))
    # Tujuh anak yang MUAT di dalam induknya: jari-jari sepertiga, dan pusat
    # keenam tetangganya berjarak r*akar(3) - jarak antar-pusat heksagon yang
    # bersentuhan sisi. Angka yang ditebak membuat anak-anaknya tumpang tindih
    # atau menggantung keluar garis induknya.
    r = R / 3
    jarak_anak = r * math.sqrt(3)
    pusat = [(c, c)] + [
        (c + jarak_anak * math.cos(math.radians(a - 30)),
         c + jarak_anak * math.sin(math.radians(a - 30)))
        for a in sudut
    ]
    for i, (x, y) in enumerate(pusat, start=1):
        ada = sorot == i
        d.add(Polygon(
            segi(x, y, r * 0.92),
            fillColor=TEAL_TUA if ada else LATAR,
            strokeColor=TEAL_TUA if ada else GARIS,
            strokeWidth=0.8,
        ))
    return d


def bar_tumpuk(bagian: list[tuple[str, float, colors.Color]], lebar: float, tinggi: float = 13) -> Drawing:
    """Satu batang bertumpuk - dipakai membedah omzet jadi sewa dan laba.

    Bagian bernilai nol DILEWATI, tidak digambar setipis rambut: potongan
    selebar setengah piksel dengan legenda di sebelahnya menyatakan ada sesuatu
    di sana, dan tidak ada apa-apa di sana.
    """
    total = sum(max(0.0, n) for _, n, _ in bagian) or 1.0
    d = Drawing(lebar, tinggi)
    x = 0.0
    for _, n, warna in bagian:
        if n <= 0:
            continue
        w = lebar * (n / total)
        d.add(Rect(x, 0, w, tinggi, fillColor=warna, strokeColor=None))
        x += w
    return d


def bar_banding(baris: list[tuple[str, float, colors.Color]], lebar: float, tinggi: float = 11) -> Drawing:
    """Beberapa batang pada SKALA YANG SAMA, untuk membandingkan besarannya.

    Dipakai saat rencananya rugi. Batang bertumpuk tidak bisa menyatakan bahwa
    sewanya MELEBIHI omzet - ia menormalkan totalnya jadi seratus persen, jadi
    sewa yang tiga kali omzet tergambar sebagai "seluruh omzet habis untuk
    sewa". Itu pernyataan yang jauh lebih ringan daripada yang sebenarnya.
    """
    maks = max([n for _, n, _ in baris] + [1.0])
    tinggi_total = len(baris) * (tinggi + 5)
    d = Drawing(lebar, tinggi_total)
    for i, (_, n, warna) in enumerate(baris):
        y = tinggi_total - (i + 1) * (tinggi + 5) + 5
        d.add(Rect(0, y, lebar, tinggi, fillColor=LATAR, strokeColor=None))
        d.add(Rect(0, y, lebar * max(0.0, n) / maks, tinggi, fillColor=warna, strokeColor=None))
    return d


def garis_sensitivitas(titik: list[tuple[float, float | None]], lebar: float, tinggi: float = 44) -> Drawing:
    """Kurva laba terhadap pangsa pasar, plus garis impas.

    Satu angka laba menjawab "kalau asumsinya benar"; kurva ini menjawab
    "seberapa salah asumsinya boleh sebelum rugi" - dan itu pertanyaan yang
    sebenarnya dibawa orang yang akan menyewa tempat.
    """
    d = Drawing(lebar, tinggi)
    sah = [(x, y) for x, y in titik if y is not None]
    if len(sah) < 2:
        return d
    xs = [x for x, _ in sah]
    ys = [y for _, y in sah]  # type: ignore[misc]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(min(ys), 0.0), max(max(ys), 0.0)
    rx = (x1 - x0) or 1.0
    ry = (y1 - y0) or 1.0

    def px(x: float) -> float:
        return (x - x0) / rx * (lebar - 2) + 1

    def py(y: float) -> float:
        return (y - y0) / ry * (tinggi - 6) + 3

    # Garis nol: batas antara untung dan rugi. Digambar DULU supaya kurvanya
    # tergambar di atasnya, bukan tertimbun.
    if y0 < 0 < y1:
        d.add(Line(0, py(0), lebar, py(0), strokeColor=colors.HexColor("#c9b8b4"),
                   strokeWidth=0.9, strokeDashArray=[2, 2]))
    for i in range(len(sah) - 1):
        d.add(Line(px(sah[i][0]), py(ys[i]), px(sah[i + 1][0]), py(ys[i + 1]),
                   strokeColor=TEAL_TUA, strokeWidth=1.6))
    for (x, _), y in zip(sah, ys, strict=False):
        d.add(Circle(px(x), py(y), 1.7, fillColor=TEAL_TUA, strokeColor=None))
    return d


def kartu_angka(baris: list[tuple[str, str]], lebar: float, g: dict, kolom: int = 3) -> Table:
    """Deret kartu angka besar - yang dibaca orang dalam tiga detik pertama.

    Angka dulu, labelnya menyusul di bawah. Dibalik, mata membaca label lebih
    dulu lalu harus turun untuk menemukan angkanya, dan deret seperti itu
    berhenti bisa dipindai.
    """
    sel = []
    for label, nilai in baris:
        sel.append([
            Paragraph(f"<b>{nilai}</b>", ParagraphStyle(
                "kb", parent=g["n"], fontSize=14, leading=17, textColor=TINTA)),
            Paragraph(label, g["kecil"]),
        ])
    isi = [[Table([[a], [b]], style=TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ])) for a, b in sel]]
    lebar_sel = lebar / max(1, len(sel))
    t = Table(isi, colWidths=[lebar_sel] * len(sel))
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), LATAR),
        ("BOX", (0, 0), (-1, -1), 0.6, GARIS),
        ("INNERGRID", (0, 0), (-1, -1), 0.6, GARIS),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    _ = kolom
    return t


def putusan(judul: str, kalimat: str, nada: str, lebar: float, g: dict) -> Table:
    """Satu kalimat putusan di kepala dokumen, berlatar warna nada.

    Laporan yang menuntut pembacanya menyusun kesimpulan sendiri dari empat
    tabel adalah laporan yang kesimpulannya berbeda-beda menurut siapa yang
    membacanya. Kalimat ini dirakit dari angka yang sama dengan yang dicetak
    di bawahnya - bukan ditulis tetap.
    """
    warna = {
        "baik": colors.HexColor("#e6f6f1"),
        "waspada": colors.HexColor("#fdf3e0"),
        "bahaya": colors.HexColor("#fbe9e7"),
    }.get(nada, LATAR)
    tepi = {
        "baik": TEAL_TUA,
        "waspada": colors.HexColor("#E58A00"),
        "bahaya": colors.HexColor("#B01B1B"),
    }.get(nada, GARIS)
    t = Table([[
        Paragraph(f"<b>{judul}</b><br/>{kalimat}", g["n"]),
    ]], colWidths=[lebar])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), warna),
        ("LINEBEFORE", (0, 0), (0, -1), 3, tepi),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return t


def jarak(tinggi: float = 8) -> Spacer:
    return Spacer(1, tinggi)
