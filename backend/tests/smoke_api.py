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

from sqlalchemy import func, select, text

from app.api import meta, pricelens, skor, transit
from app.api.bersama import saring_zoneguard, zoneguard
from app.api.hex import commuter_clock, detail_heksagon, layer_heksagon, simpul_terdekat
from app.core import cache
from app.core.galat import TidakTerautentikasi
from app.core.database import SessionLocal
from app.core.galat import KawasanTidakDikenal, KesalahanAPI, TidakDitemukan
from app.models import HexFeature, HexHourlyProfile, LocationScore, ScoreFactor, Subscription, User

KAWASAN = "Manggarai"  # harus kawasan pilot sungguhan - validasi menolak yang lain
PREFIKS = "89smoke"
VERSI_UJI = "smoke_bobot_uji"

lolos = gagal = 0


class Respons:
    """Pengganti fastapi.Response untuk memanggil endpoint langsung.

    Endpoint yang menulis header (X-Total-Count) butuh objek respons. Saat
    dipanggil lewat HTTP, FastAPI yang menyediakannya; saat dipanggil langsung,
    ini penggantinya.
    """

    def __init__(self):
        self.headers: dict[str, str] = {}


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
    # Versi kedua dengan peringkat sedikit bergeser, untuk menguji banding-versi.
    for i in range(12):
        db.add(
            LocationScore(
                h3_index=f"{PREFIKS}{i:04d}",
                versi=VERSI_UJI,
                opportunity_score=float(94 - i * 6),
                peringkat=(i + 2) if i < 11 else 1,  # satu heksagon melompat jauh
                kuadran="HIDDEN_GEM" if i < 4 else "HINDARI",
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

    peringkat = skor.ranking(db=db, respons=Respons(), kawasan=KAWASAN, limit=20)
    cek(
        "/skor/ranking tidak pernah merekomendasikan zona terlarang",
        all(r.h3_index != f"{PREFIKS}0003" for r in peringkat),
    )
    gems_semua = skor.hidden_gems(db=db, kawasan=KAWASAN, limit=20)
    cek(
        "/skor/hidden-gems juga menyaring zona terlarang",
        all(g.skor.h3_index != f"{PREFIKS}0003" for g in gems_semua),
    )

    # ---- Akun pelanggan untuk menguji sisi berbayar -----------------------
    #
    # Dibuat di sini, bukan di bawah, karena Commuter Clock dan detail heksagon
    # sama-sama membutuhkannya. Ikut ter-rollback bersama sisanya.
    pelanggan = User(
        nama_pengguna=f"{PREFIKS}_pelanggan",
        email=f"{PREFIKS}@contoh.invalid",
        sidik_sandi="scrypt$x$y",  # tidak pernah dipakai masuk di uji ini
        peran="pengguna",
    )
    db.add(pelanggan)
    db.flush()
    db.add(
        Subscription(user_id=pelanggan.id, paket="selamanya", status="aktif", selamanya=True)
    )
    db.flush()

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

    # Relatif, bukan mutlak: kawasannya juga berisi heksagon demo sungguhan.
    # Yang diuji tetap intinya - yang TANPA harga tidak ikut dihitung.
    n_sampel = kartu.wajar_sewa_per_m2.n_sampel
    n_berharga = db.execute(
        select(func.count())
        .select_from(HexFeature)
        .where(HexFeature.kawasan == KAWASAN, HexFeature.harga_sewa_per_m2.is_not(None))
    ).scalar_one()
    n_total_kawasan = db.execute(
        select(func.count()).select_from(HexFeature).where(HexFeature.kawasan == KAWASAN)
    ).scalar_one()
    cek(
        "heksagon tanpa harga tidak ikut menghitung persentil",
        n_sampel == n_berharga < n_total_kawasan,
        f"- n_sampel {n_sampel}, berharga {n_berharga}, total {n_total_kawasan}",
    )

    lay = pricelens.layer_harga(db=db, kawasan=KAWASAN, hanya_berdata=False)
    uji_di_layer = {
        f["properties"]["h3_index"]
        for f in lay["features"]
        if str(f["properties"]["h3_index"]).startswith(PREFIKS)
    }
    cek(
        "layer harga memuat seluruh 12 heksagon uji",
        len(uji_di_layer) == 12,
        f"- {len(uji_di_layer)} dari 12 (total layer {len(lay['features'])})",
    )
    lay_berdata = pricelens.layer_harga(db=db, kawasan=KAWASAN, hanya_berdata=True)
    cek(
        "hanya_berdata membuang yang tanpa harga",
        len(lay_berdata["features"]) < len(lay["features"]),
        f"- {len(lay_berdata['features'])} vs {len(lay['features'])}",
    )
    prop5 = next(
        f["properties"] for f in lay["features"] if f["id"] == f"{PREFIKS}0005"
    )
    cek("layer mengirim null, bukan 0, untuk yang tanpa data", prop5["harga_sewa_per_m2"] is None)

    # ---- Fitur 3: Commuter Clock ------------------------------------------
    print("\n[3] Commuter Clock - 05:00-22:00, captive vs choice")
    # Gerbangnya diuji lebih dulu. Kalau baris ini suatu saat berhenti melempar,
    # artinya Commuter Clock diam-diam kembali gratis - dan tidak ada uji lain
    # di repo ini yang akan menyadarinya.
    try:
        commuter_clock(f"{PREFIKS}0000", db, pengguna=None)
        cek("Commuter Clock menolak tamu", False)
    except TidakTerautentikasi:
        cek("Commuter Clock menolak tamu", True)

    ck = commuter_clock(f"{PREFIKS}0000", db, pengguna=pelanggan)
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

    kosong_jam = commuter_clock(f"{PREFIKS}0001", db, pengguna=pelanggan)
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
    # Diuji DUA KALI, sebagai tamu dan sebagai pelanggan. Sejak ada langganan,
    # endpoint ini mengirim isi yang berbeda untuk keduanya - dan yang paling
    # perlu dijaga justru sisi tamunya: kalau 43 variabel ikut keluar untuk yang
    # belum membayar, tidak ada satu pun uji lain di repo ini yang menangkapnya.
    tamu = detail_heksagon(f"{PREFIKS}0000", db, pengguna=None)
    cek("tamu: variabel DITAHAN", tamu.variabel == {}, f"- dapat {len(tamu.variabel)}")
    cek("tamu: faktor DITAHAN", tamu.faktor == [])
    cek("tamu: tingkat 'tamu'", tamu.tingkat_akun == "tamu")
    cek("tamu: yang gratis tetap utuh", tamu.zoneguard is not None and tamu.skor is not None)

    d = detail_heksagon(f"{PREFIKS}0000", db, pengguna=pelanggan)
    cek("pelanggan: tingkat 'premium'", d.tingkat_akun == "premium")
    cek("pelanggan: terkunci kosong", d.terkunci == [])
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

    # Alat AI BUKAN pintu belakang: yang berbayar lewat HTTP tetap berbayar
    # lewat sini. Kedua sisinya diuji - ditolak untuk tamu, jalan untuk pelanggan.
    try:
        panggil_fungsi(db, "cek_harga", {"hex_id": f"{PREFIKS}0000"}, pengguna=None)
        cek("alat cek_harga menolak tamu", False)
    except TidakTerautentikasi:
        cek("alat cek_harga menolak tamu", True)

    hasil = panggil_fungsi(
        db, "cek_harga", {"hex_id": f"{PREFIKS}0000"}, pengguna=pelanggan
    )
    cek("alat cek_harga jalan", hasil["harga_sewa_per_m2"] == 50_000)

    hasil = panggil_fungsi(
        db, "pola_jam", {"hex_id": f"{PREFIKS}0000"}, pengguna=pelanggan
    )
    cek("alat pola_jam jalan", hasil["jam_puncak"] in (7, 17))

    # `pengguna` yang datang dari MODEL harus diabaikan - kalau tidak, model
    # bisa menulis {"pengguna": ...} di argumennya dan membuka pintunya sendiri.
    try:
        panggil_fungsi(
            db, "cek_harga", {"hex_id": f"{PREFIKS}0000", "pengguna": "palsu"}, pengguna=None
        )
        cek("argumen `pengguna` dari model diabaikan", False)
    except TidakTerautentikasi:
        cek("argumen `pengguna` dari model diabaikan", True)

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
    except KesalahanAPI:
        cek("nama fungsi asing ditolak", True)

    # ---- Validasi masukan --------------------------------------------------
    print("\n[+] Validasi masukan")
    try:
        skor.ranking(db=db, respons=Respons(), kawasan="Mangarai")  # salah eja
        cek("kawasan salah eja ditolak", False, "- diterima diam-diam")
    except KawasanTidakDikenal as e:
        cek("kawasan salah eja ditolak", True)
        cek("galat menyebutkan kawasan yang sah", len(e.detail["kawasan_tersedia"]) == 6)

    hasil = skor.ranking(db=db, respons=Respons(), kawasan="manggarai")
    cek("beda huruf besar-kecil tetap diterima", len(hasil) > 0)

    try:
        detail_heksagon("tidak_ada_sama_sekali", db)
        cek("heksagon tak dikenal jadi 404", False, "- tidak dilempar")
    except TidakDitemukan:
        cek("heksagon tak dikenal jadi 404", True)

    # ---- Paginasi ----------------------------------------------------------
    print("\n[+] Paginasi")
    r1 = Respons()
    hal1 = skor.ranking(db=db, respons=r1, kawasan=KAWASAN, limit=5, offset=0)
    hal2 = skor.ranking(db=db, respons=Respons(), kawasan=KAWASAN, limit=5, offset=5)
    cek("halaman 1 berisi 5", len(hal1) == 5)
    cek("halaman 2 berisi 5 berikutnya", len(hal2) == 5)
    cek(
        "kedua halaman tidak tumpang tindih",
        not ({h.h3_index for h in hal1} & {h.h3_index for h in hal2}),
    )
    # Yang diuji: hitungannya menghitung SELURUH hasil (jauh lebih besar dari
    # satu halaman berisi 5), dan zona terlarang tidak pernah ikut.
    total_hitung = int(r1.headers["X-Total-Count"])
    n_boleh = db.execute(
        select(func.count())
        .select_from(HexFeature)
        .join(LocationScore, LocationScore.h3_index == HexFeature.h3_index)
        .where(
            HexFeature.kawasan == KAWASAN,
            HexFeature.zona_izin_komersial.is_not(False),
            LocationScore.versi == "baseline",
        )
    ).scalar_one()
    cek(
        "X-Total-Count menghitung seluruh hasil, bukan satu halaman",
        total_hitung == n_boleh > len(hal1),
        f"- header {total_hitung}, seharusnya {n_boleh}, halaman {len(hal1)}",
    )

    # ---- Versi skor (fitur B3) --------------------------------------------
    print("\n[+] Versi skor")
    versi = skor.daftar_versi(db=db)
    nama_versi = {v["versi"] for v in versi}
    cek("kedua versi terdaftar", {"baseline", VERSI_UJI} <= nama_versi, f"- {nama_versi}")
    cek("baseline ditandai", any(v["baseline"] for v in versi))

    banding = skor.banding_versi(db=db, a="baseline", b=VERSI_UJI, kawasan=KAWASAN)
    cek("membandingkan 12 heksagon", banding["n_dibandingkan"] == 12, f"- {banding['n_dibandingkan']}")
    cek("rho terhitung", banding["rho_spearman"] is not None)
    cek("ambang dilaporkan", banding["ambang"] == 0.85)
    cek("daftar paling berpindah terisi", len(banding["paling_berpindah"]) > 0)
    cek(
        "heksagon yang melompat ada di puncak daftar",
        abs(banding["paling_berpindah"][0]["geser"]) == banding["geser_peringkat_maks"],
    )

    # ---- Layer: bbox dan penyederhanaan ------------------------------------
    print("\n[+] Layer heksagon: bbox + penyederhanaan")
    cache.bersihkan()
    semua = layer_heksagon(db=db, kawasan=KAWASAN)
    cache.bersihkan()
    sebagian = layer_heksagon(db=db, kawasan=KAWASAN, bbox="106.838,-6.212,106.845,-6.205")
    cek(
        "bbox benar-benar menyaring",
        0 < len(sebagian["features"]) < len(semua["features"]),
        f"- {len(sebagian['features'])} dari {len(semua['features'])}",
    )

    cache.bersihkan()
    kasar = layer_heksagon(db=db, kawasan=KAWASAN, sederhanakan=0.001)
    cek("penyederhanaan tetap mengembalikan semua fitur", len(kasar["features"]) == len(semua["features"]))

    try:
        cache.bersihkan()
        layer_heksagon(db=db, bbox="ngawur")
        cek("bbox ngawur ditolak", False, "- diterima")
    except KesalahanAPI:
        cek("bbox ngawur ditolak", True)

    cache.bersihkan()
    layer_heksagon(db=db, kawasan=KAWASAN)
    sebelum = cache.statistik()["hit"]
    layer_heksagon(db=db, kawasan=KAWASAN)
    cek("panggilan kedua kena cache", cache.statistik()["hit"] == sebelum + 1)
    cache.bersihkan()

    # ---- Meta --------------------------------------------------------------
    print("\n[+] Meta: kesiapan dan cakupan")
    siap = meta.kesiapan(db=db)
    cek("basis data terjangkau", siap["basis_data"]["terjangkau"] is True)
    cek("revisi migrasi terbaca", bool(siap["basis_data"]["revisi_migrasi"]))
    cek("jumlah heksagon terbaca", siap["basis_data"]["heksagon"] >= 12)
    cek("versi skor terdaftar", VERSI_UJI in siap["basis_data"]["versi_skor"])
    cek("status AI ikut dilaporkan", "siap" in siap["ai"])
    cek("plafon biaya dilaporkan", siap["ai"]["plafon_harian_usd"] > 0)

    kws = meta.daftar_kawasan(db=db)
    cek("keenam kawasan pilot selalu muncul", len(kws) == 6, f"- {len(kws)}")
    manggarai = next(k for k in kws if k["kawasan"] == "Manggarai")
    cek("cakupan harga terhitung", 0 < manggarai["cakupan_harga"] <= 1, f"- {manggarai}")
    # Asersi lama menuntut ADA kawasan berisi nol - benar ketika hanya uji ini
    # yang mengisi basis data, tetapi keenam kawasan pilot kini berisi data demo.
    # Yang tetap penting: keenamnya SELALU dilaporkan, berdata atau tidak, dan
    # tiap barisnya membawa angka yang bisa dibaca.
    cek(
        "tiap kawasan membawa hitungan dan penanda kesiapan",
        all(
            isinstance(k["heksagon"], int) and isinstance(k["siap_demo"], bool)
            for k in kws
        ),
    )

    # ---- Transit -----------------------------------------------------------
    print("\n[+] Transit")
    try:
        transit.detail_simpul(999999, db)
        cek("simpul tak dikenal jadi 404", False, "- tidak dilempar")
    except TidakDitemukan:
        cek("simpul tak dikenal jadi 404", True)

    # --- Rute jalan kaki ---------------------------------------------------
    #
    # Diperiksa terhadap DATA PRODUKSI, bukan terhadap baris yang ditaburkan uji
    # ini. Alasannya persis pelajaran yang sudah tercatat di CLAUDE.md: uji yang
    # menaburkan barisnya sendiri lalu memeriksanya tetap HIJAU untuk tabel yang
    # di produksi kosong melompong - dan itulah bagaimana `score_factors` bisa
    # nol berbulan-bulan tanpa satu pun alarm.
    print("\n[+] Rute jalan kaki")
    n_rute = db.execute(text("SELECT count(*) FROM hex_routes")).scalar_one()
    cek("hex_routes terisi", n_rute > 0, f"- {n_rute} rute")

    if n_rute:
        # INVARIAN UTAMA, dan satu-satunya yang bisa menangkap koordinat
        # tertukar: rute yang mengikuti jalan TIDAK MUNGKIN lebih pendek
        # daripada garis lurus antara kedua ujungnya. Kalau lon/lat pernah
        # tertukar, atau kalau ujung rute menempel jauh dari titik yang diminta,
        # angka ini jatuh di bawah 1 dan asersinya menyala.
        buruk = db.execute(
            text(
                """
                SELECT count(*)
                FROM hex_routes r
                JOIN hex_features h ON h.h3_index = r.h3_index
                JOIN transport_nodes n ON n.id = r.transport_node_id
                WHERE r.jarak_m < ST_Distance(
                    n.geom::geography, ST_Centroid(h.geom)::geography
                ) - 1
                """
            )
        ).scalar_one()
        cek("tidak ada rute lebih pendek dari garis lurusnya", buruk == 0, f"- {buruk} melanggar")

        # Ujungnya harus MENYENTUH titik yang diminta. ORS menempelkan titik ke
        # jaringan jalan terdekat, dan tanpa penjahitan di pipeline, rute yang
        # tergambar berhenti puluhan meter sebelum heksagon maupun stasiunnya.
        menggantung = db.execute(
            text(
                """
                SELECT count(*)
                FROM hex_routes r
                JOIN hex_features h ON h.h3_index = r.h3_index
                JOIN transport_nodes n ON n.id = r.transport_node_id
                WHERE ST_Distance(ST_StartPoint(r.geom)::geography,
                                  ST_Centroid(h.geom)::geography) > 5
                   OR ST_Distance(ST_EndPoint(r.geom)::geography, n.geom::geography) > 5
                """
            )
        ).scalar_one()
        cek("ujung rute menyentuh heksagon dan simpulnya", menggantung == 0, f"- {menggantung} menggantung")

        # urutan 0 wajib yang TERCEPAT. Kalau tidak, `utama` di respons menunjuk
        # jalur yang bukan rekomendasi, dan seluruh label di peta ikut salah.
        salah_urut = db.execute(
            text(
                """
                SELECT count(*) FROM (
                    SELECT h3_index
                    FROM hex_routes
                    GROUP BY h3_index
                    HAVING min(menit) FILTER (WHERE urutan = 0) > min(menit) + 0.01
                ) x
                """
            )
        ).scalar_one()
        cek("urutan 0 selalu rute tercepat", salah_urut == 0, f"- {salah_urut} melanggar")

        # Endpoint-nya sendiri, lewat heksagon yang PUNYA rute.
        h3_rute = db.execute(
            text("SELECT h3_index FROM hex_routes WHERE urutan = 0 ORDER BY h3_index LIMIT 1")
        ).scalar_one()
        k = simpul_terdekat(h3_rute, db)
        cek("respons membawa rute", len(k.rute) > 0, f"- {len(k.rute)} jalur")
        cek("garis_lurus false saat rutenya ada", k.garis_lurus is False)
        cek(
            "geometri rute punya minimal dua titik",
            all(len(r.koordinat) >= 2 for r in k.rute),
        )
        cek(
            "koordinat dalam bbox Jabodetabek",
            all(
                106.0 < x < 107.5 and -6.9 < y < -5.9
                for r in k.rute
                for x, y in r.koordinat
            ),
            "- lon/lat mungkin tertukar",
        )
        cek(
            "faktor memutar tidak pernah di bawah 1",
            k.faktor_memutar is None or k.faktor_memutar >= 1,
            f"- {k.faktor_memutar}",
        )
        cek("tepat satu rute bertanda utama", sum(1 for r in k.rute if r.utama) == 1)

        # Heksagon TANPA rute harus jujur mengatakannya, bukan diam-diam
        # menyajikan garis lurus seolah rute.
        h3_tanpa = db.execute(
            text(
                """
                SELECT h.h3_index FROM hex_features h
                LEFT JOIN hex_routes r ON r.h3_index = h.h3_index
                WHERE r.h3_index IS NULL LIMIT 1
                """
            )
        ).scalar()
        if h3_tanpa:
            kk = simpul_terdekat(h3_tanpa, db)
            cek(
                "tanpa rute -> garis_lurus true dan rute kosong",
                kk.garis_lurus is True and not kk.rute,
                f"- garis_lurus={kk.garis_lurus} rute={len(kk.rute)} simpul={kk.simpul is not None}",
            )
        else:
            cek("seluruh heksagon sudah dirutekan", True, "- tidak ada yang tersisa")

    # --- Kawasan jangkau (isochrone) ---------------------------------------
    #
    # Juga atas DATA PRODUKSI. Tabel ini kosong berbulan-bulan tanpa satu pun
    # alarm sebelum ini, persis karena tidak ada yang memeriksanya.
    print("\n[+] Kawasan jangkau")
    n_iso = db.execute(text("SELECT count(*) FROM catchment_areas")).scalar_one()
    cek("catchment_areas terisi", n_iso > 0, f"- {n_iso} pita")

    if n_iso:
        cek(
            "geometri isochrone sah",
            db.execute(
                text("SELECT count(*) FROM catchment_areas WHERE NOT ST_IsValid(geom)")
            ).scalar_one()
            == 0,
        )

        # INVARIAN: kawasan yang dibatasi jaringan jalan TIDAK MUNGKIN lebih luas
        # daripada lingkaran berjari-jari `menit x 80 m` - kawasan yang bisa
        # ditembus ke segala arah. Kalau ia melebihi, yang tersimpan bukan
        # isochrone jalan kaki, dan menggambarnya berarti menjanjikan jangkauan
        # yang tidak ada.
        melebihi = db.execute(
            text(
                """
                SELECT count(*) FROM catchment_areas
                WHERE ST_Area(geom::geography) > pi() * power(menit * 80.0, 2)
                """
            )
        ).scalar_one()
        cek("tak ada pita melebihi lingkaran bebas-hambatannya", melebihi == 0, f"- {melebihi} melanggar")

        # Pita yang lebih lama harus lebih LUAS. Tertukar tidak menghasilkan
        # galat, cuma peta yang salah.
        tidak_bersarang = db.execute(
            text(
                """
                SELECT count(*) FROM (
                    SELECT transport_node_id
                    FROM catchment_areas
                    GROUP BY transport_node_id
                    HAVING max(CASE WHEN menit = 5 THEN ST_Area(geom::geography) END)
                         > min(CASE WHEN menit = 15 THEN ST_Area(geom::geography) END)
                ) x
                """
            )
        ).scalar_one()
        cek("pita 15 menit selalu lebih luas dari 5 menit", tidak_bersarang == 0)

        # Tiap simpul punya ketiga pitanya, atau tidak sama sekali. Simpul yang
        # cuma punya sebagian akan menggambar jangkauan yang bolong tanpa ada
        # yang mengatakannya.
        sebagian = db.execute(
            text(
                """
                SELECT count(*) FROM (
                    SELECT transport_node_id FROM catchment_areas
                    GROUP BY transport_node_id HAVING count(DISTINCT menit) <> 3
                ) x
                """
            )
        ).scalar_one()
        cek("tiap simpul punya ketiga pitanya", sebagian == 0, f"- {sebagian} tidak lengkap")

        node = db.execute(
            text("SELECT transport_node_id FROM catchment_areas ORDER BY transport_node_id LIMIT 1")
        ).scalar_one()
        gj = transit.layer_catchment(db, node_id=node)
        cek("endpoint catchment mengembalikan GeoJSON", gj["type"] == "FeatureCollection")
        cek("tiga pita untuk satu simpul", len(gj["features"]) == 3, f"- {len(gj['features'])}")
        cek(
            "tiap fitur membawa menitnya",
            sorted(f["properties"]["menit"] for f in gj["features"]) == [5, 10, 15],
        )


def main() -> int:
    db = SessionLocal()
    # Cache dikosongkan sebelum DAN sesudah: seluruh uji ini berjalan di dalam
    # transaksi yang di-rollback, dan hasil baca yang sempat ter-cache akan
    # bertahan setelah datanya hilang. Jebakan ini hanya muncul di uji, bukan di
    # produksi - tetapi kalau diabaikan, ujinya jadi tidak bisa dipercaya.
    cache.bersihkan()
    try:
        siapkan(db)
        jalankan(db)
    finally:
        db.rollback()
        cache.bersihkan()
        sisa = db.execute(
            # Yang dihitung baris UJI, dikenali dari prefiks h3-nya - bukan
            # seluruh isi kawasan. Sejak demo_seed mengisi Manggarai dengan 122
            # heksagon sungguhan, hitungan lama selalu melaporkan "122 baris
            # tersisa" pada uji yang rollback-nya justru sempurna. Alarm yang
            # selalu menyala adalah alarm yang berhenti dibaca.
            select(func.count())
            .select_from(HexFeature)
            .where(HexFeature.h3_index.like(f"{PREFIKS}%"))
        ).scalar_one()
        db.close()

    print(f"\n{lolos} lolos, {gagal} gagal")
    print(f"Baris uji tersisa setelah rollback: {sisa}")
    if sisa:
        print("!! ADA SISA DI BASIS DATA - periksa manual")
    return 1 if (gagal or sisa) else 0


if __name__ == "__main__":
    raise SystemExit(main())
