"""Susun paket survei lapangan: target, lembar isian, dan templat CSV.

KENAPA BERKAS INI ADA
---------------------
Angka yang paling sering disalahpahami di proyek ini "25 dari 708 heksagon
disurvei", dan salah pahamnya selalu ke arah yang sama: seolah 683 heksagon
sisanya harus dikunjungi juga. Tidak. `s5_impute.py` menuntut
`MIN_GROUND_TRUTH = 30` baris di `MIN_KAWASAN = 3` kawasan; sesudah ambang itu
lewat, ia mengisi SELURUH 708 dan melaporkan R2 serta MAE-nya sendiri.

Delapan dari sepuluh prediktornya sudah terisi penuh untuk 708 heksagon (POI
OSM, penduduk WorldPop, skor simpul, jarak simpul, tutupan bangunan, luas
bangunan median, pangsa waralaba, kepadatan kantor). Yang belum ada cuma
LABELNYA. Jadi yang memisahkan basis data hari ini dari basis data yang penuh
bukan 683 kunjungan, melainkan selisih antara ground truth yang ada dan 30.

Targetnya DITURUNKAN dari basis data, bukan ditulis tangan - sama alasannya
dengan pita status: daftar target yang ditulis tangan akan kedaluwarsa diam-diam
begitu grid atau skornya berubah, dan tidak ada uji yang menangkapnya. Pusat
Harjamukti yang bergeser 4.443 m sudah pernah membuktikan itu.

    python rencana_survei.py                 # ringkasan + berapa lagi yang kurang
    python rencana_survei.py --tulis         # -> data/04_survei/ (CSV + lembar HTML)
    python rencana_survei.py --per-kawasan 8 # ambil lebih banyak per kawasan
"""

from __future__ import annotations

import argparse
import csv
import html
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import pandas as pd
from sqlalchemy import text

from app.core.database import SessionLocal  # noqa: E402
from config import KAWASAN_PILOT  # noqa: E402
from s5_impute import MIN_GROUND_TRUTH, MIN_KAWASAN  # noqa: E402

KELUAR = Path(__file__).parent / "data" / "04_survei"

#: Kuadran yang layak disurvei lebih dulu.
#:
#: Bukan "yang skornya tertinggi" begitu saja: yang menentukan nilai sebuah
#: survei adalah seberapa sering angkanya akan DIPAKAI. Heksagon di kuadran
#: rekomendasi itulah yang muncul di daftar, di tab "Untuk Anda", dan di
#: jawaban Konsultan AI - jadi kesalahan di sana paling mahal, dan pengukuran
#: di sana paling murah nilainya per kunjungan.
KUADRAN_TARGET = ("HIDDEN_GEM", "PEMENANG_JELAS")

#: Yang harus dicatat di tiap titik, berikut kolom tujuannya di pipeline.
#: Urutannya urutan kerja di lapangan, bukan urutan kode variabel.
LEMBAR: list[tuple[str, str, str, str]] = [
    ("P05", "harga_sewa_median", "Harga sewa ruko/kios terdekat",
     "Rupiah per BULAN. Dari papan 'DISEWAKAN' atau tanya pemilik. Foto papannya."),
    ("P07", "harga_sewa_per_m2", "Luas ruko yang harganya dicatat",
     "m2. Kalau tidak tertulis, langkah kaki x 0,7 m sudah cukup."),
    ("B07", "harga_median_porsi", "Harga satu porsi/item termurah & termahal",
     "Rupiah. Dari daftar menu yang terpasang. Foto menunya."),
    ("B09", "nominal_median_struk", "Nominal satu struk pembelian",
     "Rupiah. Beli satu item termurah, simpan struknya. Foto struknya."),
    ("B01", "puncak_pagi", "Jumlah orang lewat, 5 menit, pukul 07-09",
     "Hitung pejalan kaki yang melintas depan lokasi. Catat jam persisnya."),
    ("B02", "puncak_siang", "Jumlah orang lewat, 5 menit, pukul 11-13", "Sama."),
    ("B03", "puncak_sore", "Jumlah orang lewat, 5 menit, pukul 16-18", "Sama."),
    ("B04", "puncak_malam", "Jumlah orang lewat, 5 menit, pukul 19-21", "Sama."),
    ("B05", "rasio_weekend", "Ulangi satu slot di hari Sabtu/Minggu",
     "Cukup SATU slot jam yang sama dengan hari kerja."),
    ("D11", "intensitas_transaksi", "Jumlah pembeli dilayani, 10 menit",
     "Pilih satu warung/kios, hitung transaksi yang terjadi."),
    ("M03", "skor_prestise_visual", "Kesan visual lokasi, skala 1-5",
     "1 = kumuh/gelap, 3 = biasa, 5 = rapi & terang. Foto fasadnya."),
    ("P06", "indeks_churn", "Berapa unit kosong / bekas tutup terlihat",
     "Hitung ruko kosong ber-papan 'DIJUAL/DISEWAKAN' di sekitar titik."),
]


def ambil(db) -> pd.DataFrame:
    """Seluruh heksagon berskor, plus penanda yang menentukan kelayakan target."""
    sql = text("""
        SELECT h.h3_index, h.kawasan, h.n_titik_misi,
               h.kepadatan_poi_total, h.waktu_jalan_menit, h.jarak_simpul_m,
               h.zona_izin_komersial,
               s.opportunity_score, s.kuadran,
               ST_Y(ST_Centroid(h.geom::geometry)) AS lat,
               ST_X(ST_Centroid(h.geom::geometry)) AS lon
        FROM hex_features h
        JOIN location_scores s ON s.h3_index = h.h3_index
    """)
    return pd.read_sql(sql, db.connection())


def pilih(df: pd.DataFrame, per_kawasan: int) -> pd.DataFrame:
    """Aturan pemilihan, ditulis sekali di sini supaya bisa dibantah.

    Empat saringan, dan tiap satu punya alasan yang bisa diuji:
      1. belum pernah disurvei  - mensurvei ulang titik yang sudah ada tidak
         menambah satu pun baris ground truth
      2. ada POI                - heksagon tanpa satu pun usaha tidak punya
         menu, struk, atau papan sewa untuk dicatat; surveyornya akan berdiri
         di sana dan pulang dengan tangan kosong
      3. kuadran rekomendasi    - lihat KUADRAN_TARGET
      4. zona tidak dilarang    - lokasi berzona terlarang tidak pernah
         direkomendasikan produk ini, jadi mengukurnya tidak mengubah apa pun
    """
    layak = df[
        (df["n_titik_misi"].fillna(0) == 0)
        & (df["kepadatan_poi_total"].fillna(0) > 0)
        & (df["kuadran"].isin(KUADRAN_TARGET))
        & (df["zona_izin_komersial"] != False)  # noqa: E712 - None HARUS lolos
    ].copy()

    return (
        layak.sort_values("opportunity_score", ascending=False)
        .groupby("kawasan", as_index=False, group_keys=False)
        .head(per_kawasan)
        .sort_values(["kawasan", "opportunity_score"], ascending=[True, False])
        .reset_index(drop=True)
    )


def kode_lokasi(h3: str, kawasan: str) -> str:
    """Sama persis dengan backend dan frontend: kawasan + 4 digit dari h3[7:11]."""
    return f"{kawasan}-{int(h3[7:11], 16)}"


def tulis_csv(target: pd.DataFrame, jalur: Path) -> None:
    """Templat isian. Satu baris per heksagon, satu kolom per variabel."""
    kolom = ["h3_index", "kode_lokasi", "kawasan", "lat", "lon",
             "tanggal_survei", "nama_surveyor"] + [k[1] for k in LEMBAR] + ["catatan"]
    with jalur.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(kolom)
        for _, r in target.iterrows():
            w.writerow([r.h3_index, kode_lokasi(r.h3_index, r.kawasan), r.kawasan,
                        f"{r.lat:.6f}", f"{r.lon:.6f}", "", ""]
                       + [""] * len(LEMBAR) + [""])


def tulis_lembar(target: pd.DataFrame, kurang: int, jalur: Path) -> None:
    """Lembar kerja siap cetak. Satu kartu per heksagon, satu halaman per kawasan."""
    b = []
    b.append("<!doctype html><html lang=id><head><meta charset=utf-8>")
    b.append("<title>Lembar survei lapangan - Loconomics</title><style>")
    b.append("""
*{box-sizing:border-box}
body{margin:0;font:13px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;color:#16221c;background:#fff}
.w{max-width:1000px;margin:0 auto;padding:28px 20px 60px}
h1{font-size:26px;letter-spacing:-.02em;margin:0 0 6px}
.sub{color:#55635b;margin:0 0 18px;max-width:76ch}
.tot{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 26px}
.tot span{border:1px solid #b8c2bb;border-radius:3px;padding:6px 11px;font:11px ui-monospace,monospace;color:#55635b}
.tot b{color:#16221c}
h2{font-size:17px;margin:26px 0 10px;padding-bottom:6px;border-bottom:2px solid #16221c}
.kartu{border:1px solid #b8c2bb;border-radius:4px;padding:13px 15px;margin:0 0 12px;break-inside:avoid}
.kepala{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;margin-bottom:9px}
.kode{font:700 14px ui-monospace,monospace}
.pil{font:10px ui-monospace,monospace;border:1px solid #b8c2bb;border-radius:99px;padding:2px 8px;color:#55635b}
.koor{font:11px ui-monospace,monospace;color:#55635b}
.koor a{color:#1f6f5c}
table{width:100%;border-collapse:collapse;margin-top:4px}
td{border:1px solid #d2dacf;padding:5px 7px;vertical-align:top}
td.k{width:34%;font-size:12px}
td.k b{display:block;font-size:9.5px;font-family:ui-monospace,monospace;color:#8a968f;font-weight:400}
td.p{width:44%;font-size:11px;color:#55635b}
td.i{width:22%;background:#fafbf9}
.cat{margin-top:8px;font-size:11px;color:#55635b}
.cat i{display:block;border-bottom:1px solid #d2dacf;height:17px;margin-top:3px}
@media print{.w{max-width:none;padding:0}h2{page-break-before:always}h2:first-of-type{page-break-before:auto}}
""")
    b.append("</style></head><body><div class=w>")
    b.append("<h1>Lembar survei lapangan</h1>")
    b.append(
        "<p class=sub>Loconomics &middot; Transit-oriented Retail Recommender. "
        "Targetnya <b>bukan</b> 708 heksagon. GapFill (<code>s5_impute.py</code>) "
        f"menuntut <b>{MIN_GROUND_TRUTH} baris ground truth di minimal {MIN_KAWASAN} kawasan</b>; "
        "sesudah ambang itu lewat ia mengisi seluruh 708 dan melaporkan R&sup2; serta MAE-nya "
        "sendiri. Delapan dari sepuluh prediktornya sudah terisi penuh &mdash; yang belum ada "
        "hanya labelnya.</p>")
    b.append("<div class=tot>")
    b.append(f"<span>target dicetak <b>{len(target)}</b></span>")
    b.append(f"<span>ambang GapFill <b>{MIN_GROUND_TRUTH}</b></span>")
    b.append(f"<span>masih kurang <b>{kurang}</b></span>")
    b.append(f"<span>kawasan <b>{target.kawasan.nunique()}</b></span>")
    b.append("</div>")

    urutan = [k.nama for k in KAWASAN_PILOT if k.nama in set(target.kawasan)] \
        if hasattr(KAWASAN_PILOT[0], "nama") else sorted(target.kawasan.unique())
    for kaw in urutan:
        blok = target[target.kawasan == kaw]
        if blok.empty:
            continue
        b.append(f"<h2>{html.escape(kaw)} &middot; {len(blok)} titik</h2>")
        for _, r in blok.iterrows():
            menit = "-" if pd.isna(r.waktu_jalan_menit) else f"{r.waktu_jalan_menit:.0f} mnt jalan"
            b.append("<div class=kartu><div class=kepala>")
            b.append(f"<span class=kode>{html.escape(kode_lokasi(r.h3_index, r.kawasan))}</span>")
            b.append(f"<span class=pil>{html.escape(str(r.kuadran))}</span>")
            b.append(f"<span class=pil>skor {r.opportunity_score:.0f}</span>")
            b.append(f"<span class=pil>{menit}</span>")
            b.append(f"<span class=pil>{int(r.kepadatan_poi_total or 0)} POI</span>")
            b.append(
                f"<span class=koor><a href='https://www.google.com/maps?q={r.lat:.6f},{r.lon:.6f}'>"
                f"{r.lat:.5f}, {r.lon:.5f}</a></span>")
            b.append("</div><table>")
            for kode, kolom, judul, cara in LEMBAR:
                b.append(
                    f"<tr><td class=k>{html.escape(judul)}<b>{kode} &middot; {kolom}</b></td>"
                    f"<td class=p>{html.escape(cara)}</td><td class=i></td></tr>")
            b.append("</table>")
            b.append("<p class=cat>Catatan surveyor<i></i><i></i></p>")
            b.append(f"<p class=cat style='color:#8a968f;font-family:ui-monospace,monospace;"
                     f"font-size:10px'>{r.h3_index}</p>")
            b.append("</div>")
    b.append("</div></body></html>")
    jalur.write_text("\n".join(b), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--tulis", action="store_true", help="tulis CSV + lembar HTML")
    ap.add_argument("--per-kawasan", type=int, default=5,
                    help="berapa titik per kawasan (bawaan 5 -> 30 titik)")
    arg = ap.parse_args()

    db = SessionLocal()
    try:
        df = ambil(db)
    finally:
        db.close()

    sudah = int((df["n_titik_misi"].fillna(0) > 0).sum())
    target = pilih(df, arg.per_kawasan)

    # Kekurangannya dihitung PER VARIABEL, bukan per heksagon.
    #
    # "25 heksagon punya titik misi" dan "25 baris ground truth" adalah dua
    # pernyataan yang berbeda, dan selisihnya besar: satu kunjungan bisa
    # mencatat menu tanpa mencatat struk, atau sebaliknya. s5_impute melatih
    # satu model PER TARGET dan menghitung barisnya sendiri-sendiri, jadi
    # ambang 30 berlaku untuk tiap kolom - bukan untuk himpunan kunjungannya.
    #
    # Menghitungnya per heksagon menghasilkan "kurang 5" padahal yang
    # sebenarnya kurang 19. Angka yang terlalu optimistis di sini berakibat
    # tim survei pulang terlalu cepat.
    db2 = SessionLocal()
    try:
        gt = pd.read_sql(text(
            "SELECT count(skor_ramai_terkoreksi) d10, count(harga_median_porsi) b07 "
            "FROM hex_features"), db2.connection()).iloc[0]
    finally:
        db2.close()
    paling_tipis = int(min(gt["d10"], gt["b07"]))
    kurang = max(0, MIN_GROUND_TRUTH - paling_tipis)

    print(f"  heksagon berskor        {len(df)}")
    print(f"  punya titik misi        {sudah} heksagon")
    print(f"  ground truth per kolom  D10 {int(gt['d10'])} · B07 {int(gt['b07'])}"
          f"   <- yang dihitung GapFill")
    print(f"  ambang GapFill          {MIN_GROUND_TRUTH} baris di >= {MIN_KAWASAN} kawasan")
    print(f"  MASIH KURANG            {kurang} heksagon\n")
    print(f"  kandidat layak          {len(pilih(df, 10**6))}")
    print(f"  target dipilih          {len(target)} "
          f"({arg.per_kawasan}/kawasan, {target.kawasan.nunique()} kawasan)\n")
    for kaw, blok in target.groupby("kawasan"):
        print(f"    {kaw:<16} {len(blok)} titik  "
              f"skor {blok.opportunity_score.min():.0f}-{blok.opportunity_score.max():.0f}")

    if not arg.tulis:
        print("\n  (tambahkan --tulis untuk menghasilkan CSV dan lembar cetak)")
        return

    KELUAR.mkdir(parents=True, exist_ok=True)
    tulis_csv(target, KELUAR / "target_survei.csv")
    tulis_lembar(target, kurang, KELUAR / "lembar_survei.html")
    print(f"\n  -> {KELUAR / 'target_survei.csv'}")
    print(f"  -> {KELUAR / 'lembar_survei.html'}")


if __name__ == "__main__":
    main()
