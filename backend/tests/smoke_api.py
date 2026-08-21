"""Smoke test enam fitur produk terhadap basis data SUNGGUHAN.

    cd backend && python tests/smoke_api.py

Kenapa tidak memakai basis data tiruan: yang paling mungkin salah di modul-modul
ini justru SQL-nya - percentile_cont, filter tri-nilai boolean, urutan NULLS LAST.
Semuanya berperilaku berbeda di SQLite, jadi menguji di sana tidak membuktikan apa pun.

Seluruh isian dibuat di dalam satu transaksi yang SELALU di-rollback, termasuk
kalau ada uji yang gagal. Di akhir dipastikan tidak ada baris tersisa - basis data
kembali persis seperti sebelum skrip dijalankan.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select

from app.api import pricelens, skor
from app.api.bersama import saring_zoneguard, zoneguard
from app.api.hex import commuter_clock, detail_heksagon, layer_heksagon
from app.core.database import SessionLocal
from app.models import HexFeature, HexHourlyProfile, LocationScore, ScoreFactor

KAWASAN = "SMOKE Manggarai"
PREFIKS = "89smoke"

lolos = gagal = 0


def cek(nama: str, syarat: bool, catatan: str = "") -> None:
    global lolos, gagal
    if syarat:
        print(f"  PASS  {nama}")
        lolos += 1
    else:
        print(f"  FAIL  {nama} {catatan}")
        gagal += 1


def _kotak(i: int) -> str:
    """Poligon kecil yang valid. Bentuknya tidak penting - yang diuji SQL-nya."""
    lon, lat = 106.84 + i * 0.002, -6.21 + i * 0.002
    d = 0.001
    return (
        f"SRID=4326;POLYGON(({lon} {lat},{lon + d} {lat},"
        f"{lon + d} {lat + d},{lon} {lat + d},{lon} {lat}))"
    )


def siapkan(db) -> None:
    """Dua belas heksagon dengan sifat yang sengaja dibuat berbeda-beda.

    Yang penting bukan jumlahnya, melainkan bahwa setiap kasus batas terwakili:
    satu zona dilarang, satu zona belum diketahui, satu tanpa data harga sama
    sekali, satu churn ekstrem, dan cukup sebaran untuk membuat persentil bermakna.
    """
    for i in range(12):
        dilarang = i == 3
        tak_diketahui = i == 4
        db.add(
            HexFeature(
                h3_index=f"{PREFIKS}{i:04d}",
                kawasan=KAWASAN,
                geom=_kotak(i),
                # PriceLens: heksagon 5 sengaja tanpa harga sama sekali
                harga_sewa_per_m2=None if i == 5 else 50_000 + i * 25_000,
                harga_sewa_median=None if i == 5 else 3_000_000 + i * 1_500_000,
                belanja_per_jam=None if i == 5 else 100_000 + i * 40_000,
                harga_median_porsi=15_000 + i * 1_000,
                njop_m2=8_000_000 + i * 900_000,
                njop_persentil=float(i * 8),
                # RiskRadar: churn menanjak, dua teratas harus kena peringatan
                indeks_churn=0.05 + i * 0.08,
                waktu_jalan_menit=4.0 + i,
                kepadatan_kos=90.0 - i * 5,
                kepadatan_kantor=5.0 + i * 7,
                pangsa_digital=0.1 + i * 0.06,
                puncak_pagi=0.3, puncak_siang=0.2, puncak_sore=0.35, puncak_malam=0.15,
                zona_izin_komersial=None if tak_diketahui else (False if dilarang else True),
                kelas_zona="K-1" if not dilarang else "R-3",
                n_titik_misi=40 - i * 3,
                tingkat_keyakinan="TINGGI" if i < 4 else ("SEDANG" if i < 8 else "RENDAH"),
                data_source="observed" if i < 8 else "predicted",
            )
        )
    db.flush()

    for i in range(12):
        # Heksagon 3 (zona dilarang) diberi skor mentah TINGGI dengan sengaja.
        # Kalau ZoneGuard bekerja, skornya nol dan ia tidak pernah muncul di
        # rekomendasi - itulah yang diuji, bukan sekadar bahwa filternya ada.
        db.add(
            LocationScore(
                h3_index=f"{PREFIKS}{i:04d}",
                versi="baseline",
                ipt=0.5 + i * 0.03, iae=0.4 + i * 0.04,
                ikp=0.3 + i * 0.02, ibr=0.2 + i * 0.05,
                opportunity_score=0.0 if i == 3 else float(95 - i * 6),
                hidden_gem_score=(0.9 - i * 0.05) if i < 11 else None,
                residual_biaya=-0.5 + i * 0.1,
                iptt=0.8 - i * 0.05,
                prestise_visual=0.1 + i * 0.07,
                # Kuadran mengikuti prestise, seperti di dunia nyata: prestise
                # rendah + skor bagus = Hidden Gem, prestise tinggi + churn tinggi
                # = Jebakan Gengsi. Menaruh Jebakan Gengsi di churn menengah akan
                # membuat RiskRadar tidak pernah menyala dan ujinya jadi tidak berarti.
                kuadran=(
                    "HIDDEN_GEM" if i < 4
                    else "HINDARI" if i < 8
                    else "JEBAKAN_GENGSI"
                ),
                n_metode_lolos=3 if i < 3 else 2,
                peringkat=i + 1,
            )
        )
    db.add(
        ScoreFactor(
            h3_index=f"{PREFIKS}0000", versi="baseline", kode_variabel="D05",
            indeks="IPT", nilai_mentah=88.0, nilai_normalisasi=0.9,
            persentil=78.0, kontribusi=0.36,
        )
    )
    # Commuter Clock: heksagon 0 saja, dua puncak jelas
    for jam in range(5, 23):
        n = 12 if jam in (7, 17) else (6 if 9 <= jam <= 15 else 3)
        db.add(
            HexHourlyProfile(
                h3_index=f"{PREFIKS}0000",
                jam=jam,
                n_transaksi=n,
                nominal_total=float(n * 30_000),
                nominal_median=30_000.0,
                pangsa_captive=0.85 if jam in (5, 6, 7, 8, 16, 17, 18, 19) else 0.30,
                metode="observed" if n >= 3 else "proxy",
            )
        )
    db.flush()


def jalankan(db) -> None:
    hx0 = db.get(HexFeature, f"{PREFIKS}0000")

    # ---- Fitur 4: ZoneGuard ------------------------------------------------
    print("\n[4] ZoneGuard - filter mutlak")
    zg_larang = zoneguard(db.get(HexFeature, f"{PREFIKS}0003"))
    zg_null = zoneguard(db.get(HexFeature, f"{PREFIKS}0004"))
    cek("zona dilarang -> filter_mutlak", zg_larang.filter_mutlak is True)
    cek("zona tidak diketahui BUKAN filter mutlak", zg_null.filter_mutlak is False)
    cek("status berbeda", zg_larang.status == "DILARANG" and zg_null.status == "TIDAK_DIKETAHUI")

    tersaring = db.execute(
        saring_zoneguard(select(HexFeature)).where(HexFeature.kawasan == KAWASAN)
    ).scalars().all()
    ids = {h.h3_index for h in tersaring}
    cek("heksagon terlarang tersaring", f"{PREFIKS}0003" not in ids)
    cek("heksagon zona NULL TETAP lolos", f"{PREFIKS}0004" in ids, "- NULL bukan larangan")

    peringkat = skor.ranking(db=db, kawasan=KAWASAN, limit=20)
    cek(
        "/skor/ranking tidak pernah merekomendasikan zona terlarang",
        all(r.h3_index != f"{PREFIKS}0003" for r in peringkat),
    )
    gems_semua = skor.hidden_gems(db=db, kawasan=KAWASAN, limit=20)
    cek(
        "/skor/hidden-gems juga menyaring zona terlarang",
        all(g.skor.h3_index != f"{PREFIKS}0003" for g in gems_semua),
    )

    # ---- Fitur 1: PriceLens ------------------------------------------------
    print("\n[1] PriceLens - harga per m2 dan belanja per jam")
    kartu = pricelens.kartu_harga(db, hx0)
    cek("harga sewa per m2 tersaji", kartu.harga_sewa_per_m2 == 50_000)
    cek("belanja per jam tersaji", kartu.belanja_per_jam == 100_000)
    cek(
        "rentang wajar terisi dari persentil kawasan",
        kartu.wajar_sewa_per_m2.p25 is not None and kartu.wajar_sewa_per_m2.p50 is not None,
        f"- {kartu.wajar_sewa_per_m2}",
    )
    cek(
        "heksagon termurah dinilai MURAH",
        kartu.posisi_sewa == "MURAH",
        f"- dapat {kartu.posisi_sewa}",
    )
    cek("selisih dari median negatif", (kartu.selisih_persen_dari_median or 0) < 0)
    cek("badge keyakinan ikut", kartu.keyakinan.tingkat == "TINGGI")

    kosong = pricelens.kartu_harga(db, db.get(HexFeature, f"{PREFIKS}0005"))
    cek(
        "heksagon tanpa data harga -> TIDAK_DIKETAHUI, bukan 0",
        kosong.harga_sewa_per_m2 is None and kosong.posisi_sewa == "TIDAK_DIKETAHUI",
    )

    n_sampel = kartu.wajar_sewa_per_m2.n_sampel
    cek(
        "heksagon tanpa harga tidak ikut menghitung persentil",
        n_sampel == 11,
        f"- n_sampel {n_sampel}, harusnya 11 dari 12",
    )

    lay = pricelens.layer_harga(db=db, kawasan=KAWASAN, hanya_berdata=False)
    cek("layer harga mengirim 12 fitur", len(lay["features"]) == 12)
    prop5 = next(
        f["properties"] for f in lay["features"] if f["id"] == f"{PREFIKS}0005"
    )
    cek("layer mengirim null, bukan 0, untuk yang tanpa data", prop5["harga_sewa_per_m2"] is None)

    # ---- Fitur 3: Commuter Clock ------------------------------------------
    print("\n[3] Commuter Clock - 05:00-22:00, captive vs choice")
    ck = commuter_clock(f"{PREFIKS}0000", db)
    cek("18 titik jam (05-22)", len(ck.jam) == 18, f"- dapat {len(ck.jam)}")
    cek("rentang benar", ck.jam[0].jam == 5 and ck.jam[-1].jam == 22)
    cek("jam puncak terdeteksi", ck.jam_puncak in (7, 17), f"- dapat {ck.jam_puncak}")
    pagi = next(t for t in ck.jam if t.jam == 7)
    siang = next(t for t in ck.jam if t.jam == 13)
    cek("captive + choice = 1", abs((pagi.pangsa_captive or 0) + (pagi.pangsa_choice or 0) - 1) < 1e-6)
    cek(
        "jam komuter lebih captive daripada tengah hari",
        (pagi.pangsa_captive or 0) > (siang.pangsa_captive or 0),
    )
    cek(
        "pangsa captive harian ditimbang jumlah transaksi",
        ck.pangsa_captive_harian is not None and 0 < ck.pangsa_captive_harian < 1,
        f"- {ck.pangsa_captive_harian}",
    )
    cek("dominasi disimpulkan", ck.dominasi in ("captive", "choice", "seimbang"))
    cek("B01-B04 tetap disajikan berdampingan", ck.ember["pagi_06_09"] == 0.3)

    kosong_jam = commuter_clock(f"{PREFIKS}0001", db)
    cek(
        "heksagon tanpa profil tetap mengirim 18 titik kosong + catatan",
        len(kosong_jam.jam) == 18
        and all(t.n_transaksi == 0 for t in kosong_jam.jam)
        and kosong_jam.catatan is not None,
    )

    # ---- Fitur 5: RiskRadar ------------------------------------------------
    print("\n[5] RiskRadar - peringatan churn + diagram kuadran")
    radar = skor.risk_radar(db=db, kawasan=KAWASAN, hanya_berperingatan=True, limit=50)
    cek("radar hanya berisi Jebakan Gengsi", all(t.kuadran == "JEBAKAN_GENGSI" for t in radar))
    cek("semua yang tampil memang berperingatan", all(t.risiko != "AMAN" for t in radar))
    cek("ada yang terdeteksi", len(radar) > 0, f"- {len(radar)} titik")

    semua_radar = skor.risk_radar(db=db, kawasan=KAWASAN, hanya_berperingatan=False, limit=50)
    cek(
        "tanpa filter peringatan hasilnya lebih banyak",
        len(semua_radar) >= len(radar),
        f"- {len(semua_radar)} vs {len(radar)}",
    )

    diag = skor.diagram_kuadran(db=db, kawasan=KAWASAN, limit=100)
    cek("diagram punya garis pemisah", diag.batas_x is not None and diag.batas_y is not None)
    cek(
        "diagram TIDAK menyaring zona terlarang (alat analisis, bukan rekomendasi)",
        any(t.h3_index == f"{PREFIKS}0003" for t in diag.titik),
    )
    cek("keterangan empat kuadran lengkap", len(diag.keterangan) == 4)
    cek("titik punya kedua sumbu", all(t.x_prestise is not None for t in diag.titik))

    # ---- Fitur 6: GemFinder ------------------------------------------------
    print("\n[6] GemFinder - minimal 10 + rangkuman alasan")
    gems = skor.hidden_gems(db=db, kawasan=KAWASAN, limit=10)
    cek("mengembalikan 10 heksagon", len(gems) == 10, f"- dapat {len(gems)}")
    cek("terurut menurun", all(
        (gems[i].skor.hidden_gem_score or 0) >= (gems[i + 1].skor.hidden_gem_score or 0)
        for i in range(len(gems) - 1)
    ))
    cek("setiap baris punya ringkasan alasan", all(g.ringkasan for g in gems))
    cek("setiap baris membawa status zonasi", all(g.zoneguard.status for g in gems))
    cek("setiap baris membawa badge keyakinan", all(g.skor.keyakinan for g in gems))
    beralasan = [g for g in gems if g.alasan]
    cek("ada yang alasannya terurai per metode", len(beralasan) > 0, f"- {len(beralasan)} dari {len(gems)}")
    if beralasan:
        a = beralasan[0]
        cek(
            "alasan menyebut kode variabel asalnya",
            all(x.kode_variabel for x in a.alasan),
        )
        print(f"        contoh: {a.ringkasan[:150]}")

    # ---- Detail heksagon ---------------------------------------------------
    print("\n[*] Detail heksagon - semua fitur menyatu")
    d = detail_heksagon(f"{PREFIKS}0000", db)
    cek("43 variabel", len(d.variabel) == 43, f"- dapat {len(d.variabel)}")
    cek("zoneguard menyatu di detail", d.zoneguard.status == "DIIZINKAN")
    cek("peringatan risiko menyatu di detail", d.risiko.tingkat in ("AMAN", "WASPADA", "BAHAYA"))
    cek("penjelasan kuadran ikut", d.kuadran_penjelasan is not None)
    cek("faktor skor terbaca", len(d.faktor) == 1 and d.faktor[0].kode_variabel == "D05")

    lh = layer_heksagon(db=db, kawasan=KAWASAN)
    cek("layer utama membawa variabel PriceLens", "harga_sewa_per_m2" in lh["features"][0]["properties"])
    cek("layer utama membawa churn untuk RiskRadar", "indeks_churn" in lh["features"][0]["properties"])

    # ---- Fitur 2: AI Consultant -------------------------------------------
    print("\n[2] AI Consultant - alat backend")
    from app.api.ai import panggil_fungsi

    hasil = panggil_fungsi(db, "cek_zona", {"hex_id": f"{PREFIKS}0003"})
    cek("alat cek_zona jalan", hasil["status"] == "DILARANG")

    hasil = panggil_fungsi(db, "cek_harga", {"hex_id": f"{PREFIKS}0000"})
    cek("alat cek_harga jalan", hasil["harga_sewa_per_m2"] == 50_000)

    hasil = panggil_fungsi(db, "pola_jam", {"hex_id": f"{PREFIKS}0000"})
    cek("alat pola_jam jalan", hasil["jam_puncak"] in (7, 17))

    hasil = panggil_fungsi(db, "cari_hidden_gem", {"kawasan": KAWASAN, "limit": 10})
    cek("alat cari_hidden_gem jalan", hasil["jumlah"] == 10)

    hasil = panggil_fungsi(
        db, "cari_lokasi", {"kawasan": KAWASAN, "budget_sewa_bulanan": 5_000_000}
    )
    cek("alat cari_lokasi menyaring budget", hasil["jumlah"] > 0)
    cek(
        "cari_lokasi tidak pernah mengembalikan zona terlarang",
        all(h["h3_index"] != f"{PREFIKS}0003" for h in hasil["hasil"]),
    )

    hasil = panggil_fungsi(db, "cari_lokasi", {"kawasan": KAWASAN, "jenis_usaha": "F1"})
    cek(
        "cari_lokasi jujur soal filter yang belum jalan",
        hasil["catatan"] is not None and "belum" in hasil["catatan"],
    )

    try:
        panggil_fungsi(db, "os.system", {"x": 1})
        cek("nama fungsi asing ditolak", False, "- tidak ditolak!")
    except Exception:
        cek("nama fungsi asing ditolak", True)


def main() -> int:
    db = SessionLocal()
    try:
        siapkan(db)
        jalankan(db)
    finally:
        db.rollback()
        sisa = db.execute(
            select(func.count()).select_from(HexFeature).where(HexFeature.kawasan == KAWASAN)
        ).scalar_one()
        db.close()

    print(f"\n{lolos} lolos, {gagal} gagal")
    print(f"Baris uji tersisa setelah rollback: {sisa}")
    if sisa:
        print("!! ADA SISA DI BASIS DATA - periksa manual")
    return 1 if (gagal or sisa) else 0


if __name__ == "__main__":
    raise SystemExit(main())
