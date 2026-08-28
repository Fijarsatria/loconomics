"""Tahap 4 - Analisis spasial: dari titik menjadi 43 variabel per heksagon.

Empat level unit analisis (docs/data.md bagian 2.3):

  Level 1  SIMPUL TRANSPORTASI     ±120-150 simpul
  Level 2  KAWASAN JANGKAU         isochrone jalan kaki 5/10/15 menit
  Level 3  HEKSAGON H3 res-9       <- UNIT ANALISIS UTAMA, ini yang diskor
  Level 4  TITIK (POI individual)  detail saat diklik

Dua keputusan yang bukan detail kosmetik:

1. Isochrone, bukan buffer lingkaran. Buffer mengasumsikan orang bisa berjalan
   menembus tembok, sungai, dan rel. Lokasi yang secara garis lurus 200 m dari
   stasiun bisa butuh jalan memutar 900 m karena terhalang rel. Perbedaan ini
   persis yang membuat sebagian lokasi terlihat bagus di peta tetapi sepi
   di kenyataan.

2. Heksagon H3 res-9, bukan kelurahan. Kelurahan rata-rata 1-3 km2, sehingga
   sebuah hidden gem tenggelam dalam rata-rata seluruh kelurahan. Heksagon juga
   punya sifat berguna: jarak dari pusat ke semua tetangganya sama, sehingga
   analisis k-ring tidak bias arah seperti pada grid persegi.

SELURUH tahap ini berjalan OFFLINE. Backend tidak boleh menghitung routing
jaringan jalan saat peta dimuat.
"""

from __future__ import annotations

import h3
import numpy as np
import pandas as pd

from config import (
    BOBOT_RUTE,
    H3_RESOLUSI,
    ISOCHRONE_MENIT,
    JAM_OPERASIONAL,
    JAM_PUNCAK_BERANGKAT,
    JAM_PUNCAK_PULANG,
    KAWASAN_PILOT,
    KELAS_INDUK,
    KELAS_KULINER,
    NILAI_KONDISI_PEMBELI,
)

#: C04 baru dihitung kalau sebanyak ini POI kuliner heksagon itu punya tag
#: `cuisine`. Tiga, bukan satu: entropi atas satu titik selalu tepat nol, dan
#: nol itu tidak bisa dibedakan dari "seluruhnya masakan yang sama".
MIN_CUISINE_BERTAG = 3

#: ...dan sebanyak ini pangsanya. Enam rumah makan dengan tiga bertag lolos;
#: dua puluh rumah makan dengan tiga bertag TIDAK - yang tiga itu tidak bisa
#: mewakili tujuh belas yang tidak diketahui.
MIN_CUISINE_PANGSA = 0.5

#: Cincin heksagon yang ikut dihitung untuk D05. Satu, bukan nol: sel res-9
#: hanya selebar ~350 m, dan halte di seberang batasnya tetap melayani lokasi
#: ini. Nol akan memberi angka nol kepada heksagon berhalte 200 m, tepat di
#: variabel berbobot terbesar di seluruh model.
CINCIN_SIMPUL = 1


def bangun_isochrone() -> None:
    """Level 2. OSRM atau Valhalla di atas jaringan jalan OSM, mode pejalan kaki.

    Keluaran -> tabel catchment_areas, satu baris per (simpul, menit).
    """
    raise NotImplementedError


def bangun_grid_h3() -> None:
    """Level 3. Heksagon res-9 yang beririsan dengan isochrone 15 menit mana pun.

    Membatasi grid ke dalam catchment (bukan seluruh Jabodetabek) menjaga jumlah
    heksagon tetap masuk akal untuk free tier dan sesuai ruang lingkup PRD.
    """
    raise NotImplementedError


def hitung_dimensi_permintaan() -> None:
    """D01-D12. WorldPop zonal stats, jarak/waktu ke simpul, generator keramaian,
    skor ramai terkoreksi (Menu Go), intensitas transaksi (Struk Go).

    D04 SUDAH JALAN dan tidak lagi menunggu tahap ini - lihat
    `waktu_jalan_dari_rute()` di bawah. Ia dihitung dari tabel `hex_routes`
    yang diisi `rute_ors.py`, bukan dari raster atau titik.
    """
    raise NotImplementedError


def hitung_dimensi_perilaku() -> None:
    """B01-B09. Distribusi jam transaksi (bahan Commuter Clock), rasio weekend,
    pangsa digital, harga median porsi, spread, nominal median struk."""
    raise NotImplementedError


# ---------------------------------------------------------------------------
# D04 - waktu jalan kaki ke simpul terdekat
# ---------------------------------------------------------------------------
# Bagian ini SUDAH JALAN, dan sumbernya data sungguhan: `hex_routes` diisi
# `rute_ors.py` dari OpenRouteService di atas jaringan jalan OSM.
#
# Kenapa ini layak dikerjakan lebih dulu daripada variabel mana pun: D04
# memegang 25% bobot IPT, dan angka penggantinya selama ini dibangkitkan
# `demo_seed` sebagai `d * 26 + derau` - fungsi jarak garis lurus. Padahal
# seluruh alasan tabel `hex_routes` dibuat adalah karena jarak garis lurus
# BUKAN waktu jalan kaki: rata-rata rute nyata memutar 1,82x, dan 470 dari 708
# heksagon memutar >= 1,4x.


def simpul_terdekat_dari_rute(rute: pd.DataFrame) -> pd.DataFrame:
    """D03 jarak dan D04 waktu ke simpul terdekat, per heksagon.

    Masukan: kolom h3_index, jarak_m, dan menit dari tabel `hex_routes`.

    Keduanya diambil dari BARIS YANG SAMA - rute tercepat - bukan dihitung
    sendiri-sendiri sebagai dua minimum yang terpisah. Pada data sekarang
    keduanya menghasilkan angka yang identik untuk seluruh 708 heksagon
    (terukur 26 Agu 2026, nol selisih), jadi ini bukan koreksi melainkan
    penjagaan: dua minimum yang terpisah boleh mendarat di rute yang berbeda,
    dan antarmuka akan menulis "300 m, 12 menit" untuk perjalanan yang tidak
    pernah ada. Angka yang berdampingan di layar harus menggambarkan hal yang
    sama.

    Yang menentukan MINIMUM MENIT, bukan baris ber-`urutan = 0`. Keduanya
    memang memberi jawaban yang sama pada data sekarang, dan itu justru
    sebabnya perbedaannya perlu ditulis: `urutan` disusun ORS menurut "weight"
    internalnya, bukan menurut durasi. Nomor itu baru berarti "tercepat"
    SESUDAH `rute_ors.py --rapikan` menomori ulang - terukur, 147 dari 705
    heksagon sempat punya alternatif yang lebih cepat daripada urutan nol,
    sampai selisih 11 menit. Minimum tidak bergantung pada langkah yang bisa
    terlupa dijalankan.

    Minimum juga yang benar kalau satu heksagon punya rute ke lebih dari satu
    simpul: yang dicari simpul TERDEKAT, dan terdekat di sini berarti tercepat
    dijangkau kaki - bukan yang paling dekat di peta.

    Heksagon tanpa rute tidak muncul di hasil, dan itu disengaja. Aturan 4:
    kosong tetap kosong. Heksagon yang belum pernah dirutekan bukan heksagon
    yang berjarak nol menit dari stasiun.
    """
    kosong = pd.DataFrame(columns=["jarak_simpul_m", "waktu_jalan_menit"], dtype=float)
    if rute.empty:
        return kosong

    layak = rute[rute["menit"].notna() & (rute["menit"] > 0)]
    if layak.empty:
        return kosong

    pilih = layak.loc[layak.groupby("h3_index")["menit"].idxmin()].set_index("h3_index")
    hasil = pd.DataFrame(
        {
            "jarak_simpul_m": pilih["jarak_m"].round(1),
            "waktu_jalan_menit": pilih["menit"].round(2),
        }
    )
    hasil.index.name = "h3_index"
    return hasil


def waktu_jalan_dari_rute(rute: pd.DataFrame) -> pd.Series:
    """D04 saja. Tipis di atas `simpul_terdekat_dari_rute` supaya pemanggil
    yang cuma butuh menit tidak perlu tahu D03 ikut dihitung."""
    return simpul_terdekat_dari_rute(rute)["waktu_jalan_menit"]


# ---------------------------------------------------------------------------
# Commuter Clock - profil per jam + pemisahan captive / choice rider
# ---------------------------------------------------------------------------
# Bagian ini SUDAH JALAN. Ia hanya butuh dua DataFrame dan tidak menyentuh
# jaringan jalan, jadi bisa diuji sekarang tanpa menunggu data lapangan.

# Minimal struk berjam nyata dalam satu jam sebelum jam itu disebut "observed".
# Di bawah ini, angkanya tetap disimpan tetapi ditandai proxy - satu struk tidak
# cukup untuk menyebut sesuatu "pola".
MIN_STRUK_OBSERVED = 3

# Bobot bentuk jam. Captive rider terikat jadwal: ia berangkat dan pulang pada
# jendela yang sempit dan hampir sama setiap hari kerja, dan belanjanya menempel
# pada perjalanan itu. Pembelian pukul 06:30 di sebelah stasiun hampir pasti
# pembelian orang yang sedang mengejar kereta; pembelian pukul 14:00 hampir pasti
# bukan.
BENTUK_JAM_JENDELA = 0.85
BENTUK_JAM_TENGAH_HARI = 0.35
BENTUK_JAM_MALAM = 0.20

# Seberapa besar bentuk jam menentukan hasil, dibanding konteks heksagon.
# Setengah-setengah: keduanya proksi, tidak ada alasan memihak salah satunya.
BOBOT_BENTUK_JAM = 0.5

# Hasil tidak pernah menyentuh 0 atau 1. Keduanya berarti "pasti", dan tidak ada
# proksi yang berhak sepasti itu. Batas ini yang menjaga angkanya tetap jujur.
CAPTIVE_MIN, CAPTIVE_MAKS = 0.05, 0.95


def _bentuk_jam(jam: int) -> float:
    """Kecenderungan captive dari jamnya saja, sebelum konteks heksagon."""
    if JAM_PUNCAK_BERANGKAT[0] <= jam <= JAM_PUNCAK_BERANGKAT[1]:
        return BENTUK_JAM_JENDELA
    if JAM_PUNCAK_PULANG[0] <= jam <= JAM_PUNCAK_PULANG[1]:
        return BENTUK_JAM_JENDELA
    if jam >= 20:
        return BENTUK_JAM_MALAM
    return BENTUK_JAM_TENGAH_HARI


def _norm01(s: pd.Series) -> pd.Series:
    """Min-max ke [0,1]. Nilai kosong jadi 0,5 - netral, bukan nol."""
    x = pd.to_numeric(s, errors="coerce").astype(float)
    lo, hi = x.min(), x.max()
    if pd.isna(lo) or pd.isna(hi) or hi == lo:
        return pd.Series(0.5, index=s.index)
    return ((x - lo) / (hi - lo)).fillna(0.5)


def konteks_captive(hex_df: pd.DataFrame) -> pd.Series:
    """Kecenderungan captive satu heksagon, dari konteksnya. Skala [0,1].

    Empat proksi, dipilih karena masing-masing tersedia di seluruh wilayah studi
    dan arahnya bisa dipertahankan saat ditanya:

      D07 kepadatan_kos    naik  -> captive naik. Penghuni kos jarang punya mobil.
      D08 kepadatan_kantor naik  -> captive TURUN. Kawasan kantor menarik pekerja
                                    yang punya pilihan moda.
      P02 njop_persentil   naik  -> captive TURUN. Kawasan mahal, penghuninya
                                    lebih mungkin punya kendaraan sendiri.
      B06 pangsa_digital   naik  -> captive TURUN. Proksi kasar daya beli.

    Ini estimasi, bukan pengukuran. Dataset misi tidak menanyakan kepemilikan
    kendaraan kepada siapa pun, dan tidak ada dataset publik yang menyediakannya
    pada resolusi heksagon. Yang bisa dilakukan adalah memakai proksi yang jelas
    arahnya, membatasi hasilnya supaya tidak pernah terdengar pasti, dan
    mengatakan terus terang bahwa ini proksi - ketiganya dilakukan di sini.
    """
    return (
        0.35 * _norm01(hex_df["kepadatan_kos"])
        + 0.20 * (1 - _norm01(hex_df["kepadatan_kantor"]))
        + 0.25 * (1 - _norm01(hex_df["njop_persentil"]))
        + 0.20 * (1 - _norm01(hex_df["pangsa_digital"]))
    )


def profil_jam(struk: pd.DataFrame, hex_df: pd.DataFrame) -> pd.DataFrame:
    """Bangun isi tabel hex_hourly_profiles.

    Masukan
      struk  : kolom h3_index, jam (0-23), total_nominal
               Struk tanpa jam TIDAK boleh masuk - aturan prompt A2. Saring di
               pemanggil, bukan di sini, supaya jumlah yang tersaring terlihat.
      hex_df : berindeks h3_index, memuat D07, D08, P02, B06

    Keluaran: satu baris per (h3_index, jam) untuk jam yang ada transaksinya,
    siap dimuat ke basis data. Jam tanpa transaksi TIDAK dibuat barisnya - API
    yang melengkapinya jadi 18 titik saat menyajikan, supaya "tidak ada baris"
    dan "nol transaksi" tetap bisa dibedakan di lapisan penyimpanan.
    """
    if struk.empty:
        return pd.DataFrame(
            columns=["h3_index", "jam", "n_transaksi", "nominal_total",
                     "nominal_median", "pangsa_captive", "metode"]
        )

    dalam_rentang = struk[struk["jam"].isin(JAM_OPERASIONAL)]
    agg = (
        dalam_rentang.groupby(["h3_index", "jam"])
        .agg(
            n_transaksi=("total_nominal", "size"),
            nominal_total=("total_nominal", "sum"),
            nominal_median=("total_nominal", "median"),
        )
        .reset_index()
    )

    konteks = konteks_captive(hex_df)
    agg["_konteks"] = agg["h3_index"].map(konteks).fillna(0.5)
    agg["_bentuk"] = agg["jam"].map(_bentuk_jam)

    agg["pangsa_captive"] = (
        BOBOT_BENTUK_JAM * agg["_bentuk"] + (1 - BOBOT_BENTUK_JAM) * agg["_konteks"]
    ).clip(CAPTIVE_MIN, CAPTIVE_MAKS).round(4)

    agg["metode"] = np.where(agg["n_transaksi"] >= MIN_STRUK_OBSERVED, "observed", "proxy")

    return agg.drop(columns=["_konteks", "_bentuk"])


def belanja_per_jam(profil: pd.DataFrame) -> pd.Series:
    """B10 - rupiah yang berpindah per jam operasional, per heksagon.

    Pembaginya jumlah jam yang BERISI transaksi, bukan 18. Heksagon yang hanya
    ramai empat jam sehari tidak boleh terlihat sepi hanya karena empat belas jam
    sisanya tutup - yang ingin diketahui calon penyewa adalah seberapa deras
    uang mengalir saat tokonya buka.
    """
    if profil.empty:
        return pd.Series(dtype=float)
    g = profil.groupby("h3_index")
    return (g["nominal_total"].sum() / g["jam"].nunique()).round(0)


# ---------------------------------------------------------------------------
# PriceLens - harga sewa per m²
# ---------------------------------------------------------------------------


def harga_sewa_per_m2(properti: pd.DataFrame) -> pd.Series:
    """P07 - median sewa bulanan per m², per heksagon.

    Masukan: kolom h3_index, harga_nominal, periode, luas_m2 (keluaran A1).

    Dua keputusan yang menentukan benar tidaknya angka ini:

    1. Periode "tidak_disebut" DIBUANG, tidak ditebak (aturan pembersihan 9.6).
       "45jt" bisa berarti per bulan atau per tahun dan selisihnya dua belas kali
       lipat. Salah arah menggeser seluruh peta biaya satu kawasan, dan itu jenis
       kesalahan yang langsung terlihat begitu dibandingkan dengan NJOP.

    2. Yang diambil MEDIAN DARI RASIO, bukan rasio dari median. Median harga
       dibagi median luas bukan besaran yang punya arti - ia mencampur dua properti
       yang berbeda. Median dari (harga tiap properti / luas properti itu) adalah
       harga per m² yang benar-benar ada di pasar.
    """
    if properti.empty:
        return pd.Series(dtype=float)

    layak = properti[
        properti["periode"].isin(["bulan", "tahun"])
        & properti["harga_nominal"].notna()
        & properti["luas_m2"].notna()
        & (properti["luas_m2"] > 0)
    ].copy()
    if layak.empty:
        return pd.Series(dtype=float)

    bulanan = np.where(
        layak["periode"] == "tahun", layak["harga_nominal"] / 12, layak["harga_nominal"]
    )
    layak["_per_m2"] = bulanan / layak["luas_m2"]
    return layak.groupby("h3_index")["_per_m2"].median().round(0)


# ---------------------------------------------------------------------------
# Kompetisi - dari POI usaha OpenStreetMap
# ---------------------------------------------------------------------------
#
# Sumbernya OSM (ODbL, wajib diatribusi), bukan data misi MAPID. Alasannya
# bukan kemudahan: kompetitor adalah tempat usaha yang BERDIRI, dan yang berdiri
# terpetakan jauh lebih lengkap di OSM daripada di survei bertitik mana pun.
# Data misi dipakai untuk yang justru TIDAK ada di OSM - harga, jam ramai,
# pedagang keliling.
#
# Seluruh fungsi di bawah menerima satu DataFrame POI berkolom
# (h3_index, kelas_induk, is_waralaba) dan mengembalikan Seri berindeks h3.
# Tidak ada yang menyentuh basis data; yang memuat hasilnya s7_publish.


def kelas_dominan(poi: pd.DataFrame) -> pd.Series:
    """Kelas induk yang paling banyak berdiri di tiap heksagon.

    C01 didefinisikan "kompetitor SEKELAS INDUK" - tetapi sebuah heksagon tidak
    punya kelas. Yang punya kelas adalah rencana usaha orang yang membacanya,
    sementara `hex_features` cuma menyediakan satu kolom per heksagon.

    Wakil yang dipakai: kelas yang SUDAH paling padat di heksagon itu. Bacaannya
    "di bidang yang lokasi ini memang sudah paling penuh, ada N tempat" -
    pernyataan tentang lokasinya sendiri, bukan tentang pembacanya.

    Dua tafsir lain sengaja ditolak karena keduanya menduplikasi variabel yang
    sudah ada: menghitung SELURUH POI menghasilkan C02 lagi, dan menghitung
    kuliner saja menghasilkan C08 lagi. Variabel yang isinya sama dengan
    variabel lain menambah bobot diam-diam ke hal yang sama.

    Seri dipatahkan menurut urutan `KELAS_INDUK`, bukan menurut urutan baris
    yang kebetulan - supaya hasilnya sama di setiap kali dijalankan.
    """
    if poi.empty:
        return pd.Series(dtype=object)
    prioritas = {k: i for i, k in enumerate(KELAS_INDUK)}
    n = poi.groupby(["h3_index", "kelas_induk"]).size().rename("n").reset_index()
    n["_urut"] = n["kelas_induk"].map(prioritas)
    n = n.sort_values(["h3_index", "n", "_urut"], ascending=[True, False, True])
    return n.groupby("h3_index")["kelas_induk"].first()


def n_kompetitor_langsung(poi: pd.DataFrame, dominan: pd.Series) -> pd.Series:
    """C01 - POI sekelas dominan di heksagon ini DITAMBAH k-ring 1.

    k-ring 1 dipakai karena jarak antarpusat heksagon res-9 sekitar 350 m dan
    konsumen pejalan kaki tidak berhenti di batas heksagon.

    Yang dihitung SELURUH POI yang tertarik, termasuk yang jatuh di heksagon di
    luar keenam kawasan pilot. Kompetitor di seberang batas kawasan tetap
    kompetitor; membatasinya ke heksagon yang kebetulan kita skor akan membuat
    heksagon di tepi kawasan terlihat lebih lengang daripada kenyataannya.
    """
    if poi.empty or dominan.empty:
        return pd.Series(dtype=float)
    hitung = poi.groupby(["h3_index", "kelas_induk"]).size().to_dict()
    hasil = {
        h3i: sum(hitung.get((t, kelas), 0) for t in h3.grid_disk(h3i, 1))
        for h3i, kelas in dominan.items()
    }
    return pd.Series(hasil, dtype=float)


def kepadatan_poi_total(poi: pd.DataFrame) -> pd.Series:
    """C02 - seluruh tempat usaha di heksagon itu. Hitungan, bukan per km2:
    luas heksagon res-9 sama untuk semuanya, jadi membaginya cuma menggeser
    skala tanpa menambah satu pun informasi."""
    if poi.empty:
        return pd.Series(dtype=float)
    return poi.groupby("h3_index").size().astype(float)


def keragaman_usaha(poi: pd.DataFrame) -> pd.Series:
    """C03 - entropi Shannon delapan kelas induk, dibagi ln(8) supaya [0,1].

    Dinormalkan di sini, bukan dibiarkan dalam nat, karena angkanya ikut ke
    layar: 0 berarti heksagon itu cuma punya satu jenis usaha, 1 berarti
    kedelapan kelas hadir sama banyak. Pembagi tetap ln(8) walau kelas yang
    hadir kurang dari delapan - kalau pembaginya ikut menyusut, heksagon berisi
    dua warung dan satu apotek akan tercatat SERAGAM SEMPURNA.
    """
    if poi.empty:
        return pd.Series(dtype=float)
    n = poi.groupby(["h3_index", "kelas_induk"]).size()
    pembagi = np.log(len(KELAS_INDUK))

    def _entropi(s: pd.Series) -> float:
        p = s.to_numpy(dtype=float)
        p = p / p.sum()
        # `+ 0.0` meniadakan nol NEGATIF. Satu kelas tunggal menghasilkan
        # -(1 * ln 1) = -0.0, yang sama dengan 0.0 di mana pun tetapi terbaca
        # seperti galat oleh siapa pun yang melihatnya di basis data.
        return float(-(p * np.log(p)).sum() / pembagi) + 0.0

    return n.groupby(level=0).apply(_entropi)


def pangsa_waralaba(poi: pd.DataFrame) -> pd.Series:
    """C05 - persen POI bermerek nasional/internasional.

    Penanda waralabanya `brand`/`brand:wikidata`/`operator:wikidata` di OSM
    (`config.is_waralaba`), bukan daftar nama merek yang ditulis tangan. Daftar
    tulis tangan selalu ketinggalan merek lokal yang justru paling menekan.
    """
    if poi.empty:
        return pd.Series(dtype=float)
    return (poi.groupby("h3_index")["is_waralaba"].mean() * 100).round(2)


def rasio_kompetitor_per_kapita(c01: pd.Series, pop: pd.Series) -> pd.Series:
    """C06 = C01 / D01. Bobot 0,45 di indeks kompetisi - yang terbesar.

    Penduduk nol atau kosong menghasilkan KOSONG, bukan nol dan bukan tak
    hingga (aturan 4). "Tidak ada penduduk untuk dibagi" bukan "tidak ada
    kompetitor per penduduk", dan tak hingga akan mendominasi setiap
    normalisasi min-max di s6 sekaligus menyeret seluruh heksagon lain ke nol.
    """
    a = pd.to_numeric(c01, errors="coerce").astype(float)
    b = pd.to_numeric(pop, errors="coerce").astype(float)
    b = b.where(b > 0)
    return (a / b).replace([np.inf, -np.inf], np.nan)


#: Kolom yang boleh diisi NOL untuk heksagon tanpa satu pun POI, dan kolom yang
#: WAJIB tetap kosong. Bedanya bukan selera: yang di atas adalah HITUNGAN, dan
#: hitungan atas himpunan kosong memang nol - Overpass ditanyai disc yang
#: menutup seluruh heksagon, jadi "tidak ada kompetitor terpetakan" adalah
#: temuan, bukan lubang data.
#:
#: Yang di bawah adalah PROPORSI dan ENTROPI, dan keduanya tidak punya nilai
#: atas himpunan kosong. Menuliskannya nol akan berbohong ke arah yang
#: berbahaya: C03 dibalik di indeks kompetisi, jadi heksagon kosong berkeragaman
#: "0" akan dihukum seolah ia monokultur padat - persis kebalikan keadaannya.
#: Dibiarkan kosong, s6 memperlakukannya 0,5 (netral) sesuai aturan 4.
ISI_NOL = ("n_kompetitor_langsung", "kepadatan_poi_total")
BIARKAN_KOSONG = ("keragaman_usaha", "keragaman_kuliner", "pangsa_waralaba")


def keragaman_kuliner(
    poi: pd.DataFrame,
    min_bertag: int = MIN_CUISINE_BERTAG,
    min_pangsa: float = MIN_CUISINE_PANGSA,
) -> pd.Series:
    """C04 - entropi Shannon JENIS MASAKAN, dari tag `cuisine` OSM.

    Bedanya dengan C03 halus tetapi menentukan: C03 mengukur keragaman BENTUK
    usaha (kuliner, ritel, jasa), C04 mengukur keragaman masakan DI DALAM
    kuliner. Sebuah heksagon berisi sepuluh warung padang punya C03 rendah dan
    C04 rendah; sepuluh warung dengan sepuluh masakan berbeda punya C03 yang
    sama rendah tetapi C04 tinggi - dan yang kedua jauh lebih ramai dikunjungi.

    Dua penjaga, dan keduanya ada karena `cuisine` adalah tag OPSIONAL yang
    hanya terisi di 42% POI kuliner. Tanpa penjaga, heksagon berisi enam rumah
    makan yang hanya satu bertag akan tercatat "keragaman nol" - pernyataan
    yang terdengar seperti temuan padahal artinya "lima dari enam tidak
    diketahui". Jadi entropinya baru dihitung kalau:

      - setidaknya `min_bertag` POI kuliner benar-benar punya tag `cuisine`, dan
      - setidaknya `min_pangsa` dari POI kuliner heksagon itu punya tagnya

    Yang tidak lolos dibiarkan KOSONG, bukan nol (aturan 4).

    Pembagi entropinya `ln(jumlah jenis yang hadir di SELURUH wilayah studi)`,
    bukan ln(jumlah jenis di heksagon itu. Alasannya sama dengan C03: pembagi
    yang ikut menyusut membuat heksagon berisi dua masakan tercatat SERAGAM
    SEMPURNA, dan angka 1,0 di kolom keragaman untuk dua warung adalah
    kebohongan yang tidak akan pernah memunculkan galat.
    """
    if poi.empty or "cuisine" not in poi.columns:
        return pd.Series(dtype=float)

    kul = poi[poi["kelas_induk"].isin(KELAS_KULINER)]
    if kul.empty:
        return pd.Series(dtype=float)

    # Satu POI boleh membawa beberapa masakan ("indonesian;chinese"). Keduanya
    # dihitung - rumah makan yang menyajikan dua masakan memang menambah dua
    # pilihan bagi orang yang lewat.
    baris = []
    for h3i, c in zip(kul["h3_index"], kul["cuisine"]):
        for jenis in str(c).split(";"):
            jenis = jenis.strip().lower()
            if jenis:
                baris.append((h3i, jenis))
    if not baris:
        return pd.Series(dtype=float)

    tag = pd.DataFrame(baris, columns=["h3_index", "jenis"])
    n_jenis_global = tag["jenis"].nunique()
    pembagi = np.log(n_jenis_global) if n_jenis_global > 1 else 1.0

    n_kuliner = kul.groupby("h3_index").size()
    n_bertag = (
        kul[kul["cuisine"].astype(str).str.len() > 0].groupby("h3_index").size()
    )

    hasil = {}
    for h3i, sub in tag.groupby("h3_index"):
        bertag = int(n_bertag.get(h3i, 0))
        if bertag < min_bertag:
            continue
        if bertag / float(n_kuliner.get(h3i, bertag)) < min_pangsa:
            continue
        pp = sub["jenis"].value_counts().to_numpy(dtype=float)
        pp = pp / pp.sum()
        hasil[h3i] = float(-(pp * np.log(pp)).sum() / pembagi) + 0.0

    return pd.Series(hasil, dtype=float).sort_index()


def bobot_simpul(
    henti: pd.DataFrame,
    rute: pd.DataFrame,
    semua_hex: pd.Index | None = None,
    cincin: int = CINCIN_SIMPUL,
) -> pd.Series:
    """D05 `skor_simpul` - jumlah bobot RUTE UNIK yang berhenti di sekitar.

    Yang dihitung bukan berapa banyak tiang henti yang berdiri di situ,
    melainkan berapa banyak rute BERBEDA yang benar-benar berhenti - masing
    masing ditimbang `config.BOBOT_RUTE` menurut kapasitas modanya. Sebabnya
    satu perhentian Transjakarta bisa terdaftar sebagai empat elemen OSM
    (stop_position dan platform, masing-masing untuk dua arah); menghitung
    elemen akan melipatempatkan satu halte yang sama, sementara menghitung
    rute unik menjawab pertanyaan yang sebenarnya ditanyakan calon pedagang:
    dari sini orang bisa pergi ke berapa banyak tempat tanpa berganti
    kendaraan, dan sebaliknya berapa banyak tempat yang bisa mengirim orang ke
    sini.

    `cincin=1` disengaja, dengan alasan yang sama seperti C01: sel res-9 hanya
    selebar ~350 m, jadi halte tepat di seberang batas heksagon tetap melayani
    lokasi ini. `cincin=0` akan memberi nol kepada heksagon yang haltenya
    berjarak dua ratus meter, dan nol itu masuk ke IPT dengan bobot terbesar
    di seluruh model (0,40).

    Nol di sini berarti NOL, bukan "belum diperiksa": Overpass ditanyai satu
    disc yang menutup seluruh 708 heksagon beserta k-ring-nya, jadi heksagon
    tanpa rute memang tidak dilewati satu pun rute yang terpetakan.
    """
    if henti.empty or rute.empty:
        return pd.Series(dtype=float)

    gabung = rute.merge(henti[["ref", "h3_index"]], on="ref", how="inner")
    if gabung.empty:
        return pd.Series(dtype=float)

    if cincin > 0:
        sebar = []
        for h3i, lin, moda in zip(
            gabung["h3_index"], gabung["lin"], gabung["moda"]
        ):
            for tetangga in h3.grid_disk(h3i, cincin):
                sebar.append((tetangga, lin, moda))
        gabung = pd.DataFrame(sebar, columns=["h3_index", "lin", "moda"])

    # Lin unik per heksagon - dua lapis dedup, dan keduanya perlu. Lapis
    # pertama sudah dikerjakan `rute_dari_osm` (varian arah dan racket dilebur
    # jadi satu lin); lapis kedua di sini, untuk lin yang sama yang berhenti
    # beberapa kali di dalam satu heksagon. Yang paling sering begitu koridor
    # Transjakarta, yang perhentiannya rapat.
    unik = gabung.drop_duplicates(subset=["h3_index", "lin"])
    unik = unik.assign(bobot=unik["moda"].map(BOBOT_RUTE).fillna(BOBOT_RUTE["bus"]))
    hasil = unik.groupby("h3_index")["bobot"].sum().round(2)

    if semua_hex is not None:
        hasil = hasil.reindex(semua_hex).fillna(0.0)
    return hasil


def dimensi_kompetisi(
    poi: pd.DataFrame,
    pop: pd.Series | None = None,
    semua_hex: pd.Index | None = None,
) -> pd.DataFrame:
    """C01, C02, C03, C04, C05, dan - kalau D01 diberikan - C06.

    `semua_hex` WAJIB diisi saat hasilnya akan dimuat ke basis data, dan
    alasannya adalah kegagalan yang tidak memunculkan galat: tanpa itu, hasilnya
    hanya memuat heksagon yang PUNYA POI, `muat_variabel` cuma menyentuh baris
    yang dikirim, dan heksagon tanpa POI diam-diam mempertahankan nilai sintetis
    `demo_seed` di kolom yang sama. Satu kolom berisi campuran angka nyata dan
    angka karangan, tanpa satu pun cara membedakannya dari luar.

    C07 dan C08 sengaja TIDAK ada di sini: keduanya menuntut data misi MAPID
    (penanda pedagang keliling), dan mengarang penggantinya dari OSM akan
    mengisi kolom yang seharusnya kosong.

    C04 dulu ikut dikecualikan dengan alasan yang sama - "menunggu taksonomi
    menu A4". Ternyata OSM sudah membawa taksonomi masakan sendiri lewat tag
    `cuisine`, dan tag itu MENJAWAB pertanyaan yang sama: jenis masakan apa
    saja yang ada di sini. Ia hanya terisi di sekitar 42% POI kuliner, jadi
    `keragaman_kuliner` menolak menghitung heksagon yang tagnya terlalu tipis
    dan meninggalkannya KOSONG. A4 nanti memperkaya kolom ini, bukan
    menggantikannya.
    """
    dominan = kelas_dominan(poi)
    hasil = pd.DataFrame(
        {
            "n_kompetitor_langsung": n_kompetitor_langsung(poi, dominan),
            "kepadatan_poi_total": kepadatan_poi_total(poi),
            "keragaman_usaha": keragaman_usaha(poi),
            "keragaman_kuliner": keragaman_kuliner(poi),
            "pangsa_waralaba": pangsa_waralaba(poi),
        }
    )
    if semua_hex is not None:
        hasil = hasil.reindex(semua_hex)
        for k in ISI_NOL:
            hasil[k] = hasil[k].fillna(0.0)
    hasil.index.name = "h3_index"

    # C06 dihitung SESUDAH pengisian nol, bukan sebelumnya. Heksagon tanpa
    # kompetitor punya rasio nol per kapita - itu angka yang sah dan penting,
    # dan menghitungnya lebih dulu akan meninggalkannya kosong selamanya.
    if pop is not None:
        hasil["rasio_kompetitor_per_kapita"] = rasio_kompetitor_per_kapita(
            hasil["n_kompetitor_langsung"], pop.reindex(hasil.index)
        )
    return hasil



def dimensi_konteks(
    konteks: pd.DataFrame, semua_hex: pd.Index | None = None
) -> pd.DataFrame:
    """D08 kepadatan_kantor dan D09 generator_keramaian, dari POI konteks OSM.

    Nol di sini berarti NOL, bukan "belum disurvei" - dan perbedaan itu yang
    membuat aturan 4 tidak dilanggar. Overpass ditanyai satu disc yang menutup
    SELURUH 708 heksagon beserta k-ring-nya, jadi setiap heksagon benar-benar
    diperiksa; heksagon tanpa kantor memang tidak punya kantor yang terpetakan.
    Ini kebalikan dari data misi, di mana ketiadaan baris hampir selalu berarti
    tidak ada yang datang ke sana.

    Yang TIDAK bisa dinyatakan nol dengan cara yang sama: heksagon di luar disc.
    Tidak ada satu pun sekarang, dan kalau kelak kawasan bertambah, yang harus
    ikut bertambah bukan cuma grid-nya melainkan penarikannya.
    """
    if konteks.empty:
        return pd.DataFrame(columns=["kepadatan_kantor", "generator_keramaian"])
    n = konteks.pivot_table(
        index="h3_index", columns="jenis", aggfunc="size", fill_value=0
    )
    if semua_hex is not None:
        n = n.reindex(semua_hex).fillna(0)
    ramai = [j for j in ("sekolah", "rumah_sakit", "pasar", "ibadah") if j in n.columns]
    hasil = pd.DataFrame(index=n.index)
    hasil["kepadatan_kantor"] = n["kantor"].astype(float) if "kantor" in n else 0.0
    hasil["generator_keramaian"] = n[ramai].sum(axis=1).astype(float) if ramai else 0.0
    hasil.index.name = "h3_index"
    return hasil


# ---------------------------------------------------------------------------
# Penduduk - dari raster WorldPop ke heksagon
# ---------------------------------------------------------------------------
#
# WorldPop "ppp" menyimpan JUMLAH ORANG per piksel, bukan kepadatan. Jadi
# penduduk sebuah heksagon adalah jumlah nilai piksel yang jatuh di dalamnya -
# tanpa dikali luas, tanpa dibagi apa pun.
#
# Produk yang dipakai `constrained`: penduduk hanya ditempatkan di piksel yang
# memang terbangun. Konsekuensinya piksel tak terbangun bernilai `nodata`, BUKAN
# nol, dan keduanya harus dibedakan - lihat `penduduk_per_heksagon`.

#: Tiap piksel dibelah SUBPIKSEL x SUBPIKSEL sebelum dibagikan ke heksagon.
#: Piksel WorldPop ~92,8 m dan heksagon res-9 ~0,105 km2, jadi satu heksagon
#: hanya memuat ~12 piksel. Membagikan piksel utuh menurut titik tengahnya
#: membuat satu piksel salah tempat menggeser penduduk heksagon sampai 8% -
#: dan kesalahan itu tidak acak, ia menumpuk di tepi heksagon. Dengan 5x5,
#: satu subpiksel salah tempat cuma bernilai 1/25 piksel.
SUBPIKSEL = 5


def penduduk_per_heksagon(
    nilai: np.ndarray,
    kiri: float,
    atas: float,
    lebar_piksel: float,
    tinggi_piksel: float,
    nodata: float | None = None,
    subpiksel: int = SUBPIKSEL,
) -> pd.Series:
    """Jumlahkan raster penduduk ke heksagon H3 res-9.

    `kiri`/`atas` sudut kiri-atas raster dalam derajat; `lebar_piksel` positif,
    `tinggi_piksel` positif (raster geografis tumbuh ke BAWAH, jadi lintang
    berkurang seiring baris bertambah).

    Pembagiannya lewat titik tengah tiap subpiksel, bukan lewat perpotongan
    poligon. Alasannya bukan kemalasan: H3 memetakan koordinat ke sel dengan
    satu panggilan yang eksak, jadi tidak ada geometri yang perlu dipotong dan
    tidak ada pustaka poligon yang perlu dipercaya. Dengan subpiksel 5x5,
    galatnya turun ke ~1/25 piksel per subpiksel yang salah tempat.

    Heksagon yang tidak menerima satu subpiksel pun TIDAK muncul di hasil -
    bukan diisi nol. `nodata` WorldPop berarti "tidak ada yang tinggal di sini
    menurut model", dan itu memang nol orang; tetapi heksagon yang seluruhnya
    di luar raster berarti "tidak diketahui", dan keduanya tidak boleh disamakan.
    Pemanggil yang memutuskan, karena hanya ia yang tahu heksagon mana yang
    seharusnya tercakup.
    """
    if nilai.size == 0:
        return pd.Series(dtype=float)

    baris, kolom = nilai.shape
    sah = np.isfinite(nilai)
    if nodata is not None:
        sah &= nilai != nodata
    sah &= nilai > 0
    if not sah.any():
        return pd.Series(dtype=float)

    # Offset titik tengah tiap subpiksel, dalam pecahan satu piksel.
    off = (np.arange(subpiksel) + 0.5) / subpiksel
    bagian = 1.0 / (subpiksel * subpiksel)

    i, j = np.nonzero(sah)
    v = nilai[i, j].astype(float) * bagian

    kantong: dict[str, float] = {}
    for di in off:
        lat = atas - (i + di) * tinggi_piksel
        for dj in off:
            lon = kiri + (j + dj) * lebar_piksel
            for la, lo, x in zip(lat, lon, v):
                sel = h3.latlng_to_cell(la, lo, H3_RESOLUSI)
                kantong[sel] = kantong.get(sel, 0.0) + x

    hasil = pd.Series(kantong, dtype=float).round(1)
    hasil.index.name = "h3_index"
    return hasil



def morfologi_bangunan(
    bangunan: pd.DataFrame, semua_hex: pd.Index | None = None
) -> pd.DataFrame:
    """M01 rasio tutupan bangunan dan M02 luas bangunan median.

    M01 dibagi luas SEL H3 ITU SENDIRI lewat `h3.cell_area`, bukan dibagi
    konstanta 105.000 m2. Sel res-9 tidak semuanya seluas itu - selisih
    antar-sel di satu kota mencapai beberapa persen - dan rasio tutupan yang
    dibagi angka yang salah akan meleset searah untuk seluruh kawasan.

    Keluarannya PERSEN (0-100), bukan pecahan 0-1, karena satuannya memang
    ditulis "%" di `aturan.py` maupun `config.ts` - dan antarmuka mencetak
    angkanya apa adanya lalu menempelkan satuannya, tanpa mengalikan seratus.
    Menyimpan 0,55 di kolom bersatuan persen menghasilkan "0,55 %" di layar
    untuk sesuatu yang berarti 55%. Skalanya tidak menyentuh skor: `norm()` di
    s6 min-max, jadi kebal terhadap perkalian tetap.

    M01 bisa melebihi 100 kalau poligon OSM bertumpang tindih (bangunan
    digambar dua kali, atau atap dan bangunan dipetakan terpisah). Itu TIDAK
    dipangkas di sini: tutupan di atas 100% adalah tanda data yang perlu
    diperiksa, dan memangkasnya jadi 100 menyembunyikan tandanya sambil tetap
    salah.

    Heksagon tanpa satu pun bangunan terpetakan: M01 nol, M02 KOSONG. Nol
    bangunan memang berarti nol tutupan - Overpass ditanyai disc yang menutup
    seluruh heksagon - tetapi "luas median dari himpunan kosong" tidak punya
    nilai, dan menuliskannya nol akan berarti "bangunan di sini rata-rata
    seluas nol meter persegi".
    """
    kolom = ["rasio_tutupan_bangunan", "luas_bangunan_median"]
    if bangunan.empty:
        return pd.DataFrame(columns=kolom, dtype=float)

    g = bangunan.groupby("h3_index")["luas_m2"]
    hasil = pd.DataFrame({"_total": g.sum(), "luas_bangunan_median": g.median()})
    luas_sel = pd.Series(
        {s: h3.cell_area(s, unit="m^2") for s in hasil.index}, dtype=float
    )
    hasil["rasio_tutupan_bangunan"] = (hasil["_total"] / luas_sel * 100).round(2)
    hasil["luas_bangunan_median"] = hasil["luas_bangunan_median"].round(1)
    hasil = hasil[kolom]

    if semua_hex is not None:
        hasil = hasil.reindex(semua_hex)
        hasil["rasio_tutupan_bangunan"] = hasil["rasio_tutupan_bangunan"].fillna(0.0)
    hasil.index.name = "h3_index"
    return hasil



# ---------------------------------------------------------------------------
# Data misi MAPID -> variabel per heksagon
# ---------------------------------------------------------------------------
#
# PERBEDAAN MENDASAR DARI OSM, dan satu-satunya hal yang paling mudah dirusak
# di berkas ini: penarikan OSM menanyai SELURUH wilayah, jadi heksagon tanpa POI
# benar-benar tidak punya POI dan nol adalah temuan. Data misi adalah SURVEI
# BERTITIK - heksagon tanpa titik berarti "belum ada yang datang ke sini",
# bukan "tidak ada warung di sini".
#
# Karena itu SELURUH variabel di bawah dibiarkan KOSONG untuk heksagon yang
# tidak disurvei, tanpa kecuali. Mengisinya nol akan membuat 600-an heksagon
# yang belum dikunjungi tampak sebagai kawasan mati - persis kesalahan yang
# aturan 4 ada untuk mencegahnya.
#
# Satu-satunya yang boleh nol: `n_titik_misi`. Ia menghitung UPAYA SURVEI, dan
# nol titik survei memang pernyataan yang benar tentang heksagon itu.


def _pangsa(seri: pd.Series, syarat) -> float:
    """Persen anggota yang memenuhi syarat. Kosong -> NaN, bukan nol."""
    layak = seri.dropna()
    if layak.empty:
        return float("nan")
    return round(float(syarat(layak).mean()) * 100, 2)


def dimensi_misi(
    menu: pd.DataFrame,
    struk: pd.DataFrame,
    properti: pd.DataFrame,
    aktivitas: pd.DataFrame,
    semua_hex: pd.Index | None = None,
) -> pd.DataFrame:
    """B06, B07, B08, C07, C08, D10, D12, P03, dan penanda Q01.

    Yang TIDAK ada di sini dan sebabnya:

      B01-B05, B09, B10, D11  jam & nominal transaksi. API mengembalikan
                              `tanggal: {}` di seluruh 866 titik dan Struk Go
                              tidak punya kolom waktu sama sekali. Keduanya ada
                              di dalam foto struk -> pekerjaan A2.
      P04 rasio_sewa_jual     didefinisikan "sewa tahunan / harga jual" - rasio
                              imbal hasil, bukan perbandingan jumlah listing.
                              Menuntut harga, dan harga ada di foto -> A1.
      P05, P07                harga sewa -> A1.
      C04 keragaman_kuliner   menuntut taksonomi menu -> A4.
      M03                     penilaian visual -> A3.

    D10 `skor_ramai_terkoreksi` diisi nilai MENTAH-nya. Namanya menjanjikan
    koreksi terhadap jam kunjungan ("Sepi pukul 10" tidak sama artinya dengan
    "Sepi pukul 12"), dan koreksi itu TIDAK dilakukan karena jamnya tidak ada.
    Secara aritmetika hasilnya sama - baseline per jam yang tidak diketahui
    bernilai nol - tetapi ia bukan hal yang sama, dan itu harus tertulis:
    begitu `waktu_kunjungan` mulai terisi, `s2_clean.koreksi_skor_ramai` yang
    mengambil alih dan angkanya akan bergeser.
    """
    kolom = [
        "harga_median_porsi", "spread_harga", "pangsa_digital", "rasio_keliling",
        "n_menetap_kuliner", "skor_ramai_terkoreksi", "aktivitas_komunitas",
        "pasokan_sewa_komersial",
    ]
    bagian: dict[str, pd.Series] = {}

    if not menu.empty:
        g = menu.groupby("h3_index")
        bagian["harga_median_porsi"] = g["harga_rata_porsi"].median().round(0)

        # B08: sebaran harga ANTARTEMPAT di dalam satu heksagon, dinyatakan
        # relatif terhadap mediannya supaya bisa dibandingkan antar-kawasan -
        # selisih Rp10.000 berarti lain di warung dan lain di restoran.
        # Satu tempat saja -> KOSONG: sebaran dari satu pengamatan tidak ada,
        # dan nol akan berarti "seluruh tempat di sini berharga sama".
        def _sebar(s: pd.Series) -> float:
            s = s.dropna()
            if len(s) < 2 or s.median() <= 0:
                return float("nan")
            return round(float(s.max() - s.min()) / float(s.median()), 3)

        bagian["spread_harga"] = g["harga_rata_porsi"].apply(_sebar)
        bagian["rasio_keliling"] = g["mobilitas_keliling"].apply(
            lambda s: _pangsa(s, lambda x: x.astype(bool))
        )
        bagian["n_menetap_kuliner"] = g["mobilitas_keliling"].apply(
            lambda s: float((~s.dropna().astype(bool)).sum()) if s.notna().any() else float("nan")
        )
        bagian["skor_ramai_terkoreksi"] = g["kondisi_pembeli"].apply(
            lambda s: round(float(
                s.dropna().str.lower().map(NILAI_KONDISI_PEMBELI).dropna().mean()
            ), 3) if s.notna().any() else float("nan")
        )

    if not struk.empty:
        # Non-tunai = apa pun selain "Tunai". Ditulis sebagai pengecualian,
        # bukan sebagai daftar putih QRIS/e-wallet/debit/kartu: metode bayar
        # baru akan terus bermunculan, dan daftar putih membuat yang baru
        # diam-diam terhitung sebagai tunai.
        bagian["pangsa_digital"] = struk.groupby("h3_index")["metode_bayar"].apply(
            lambda s: _pangsa(s, lambda x: x.str.strip().str.lower() != "tunai")
        )

    if not properti.empty:
        bagian["pasokan_sewa_komersial"] = properti.groupby("h3_index")["status"].apply(
            lambda s: float((s.dropna() == "sewa").sum()) if s.notna().any() else float("nan")
        )

    if not aktivitas.empty:
        bagian["aktivitas_komunitas"] = (
            aktivitas.groupby("h3_index").size().astype(float)
        )

    hasil = pd.DataFrame(bagian) if bagian else pd.DataFrame(columns=kolom, dtype=float)
    for k in kolom:
        if k not in hasil.columns:
            hasil[k] = float("nan")
    hasil = hasil[kolom]

    # Q01: upaya survei. Menghitung TITIK, bukan heksagon - dan menjumlahkan
    # ketiga misi karena badge keyakinan menjawab "seberapa banyak orang sudah
    # datang ke sini", bukan "misi mana yang dikerjakan".
    n = pd.concat(
        [d["h3_index"] for d in (menu, struk, properti) if not d.empty]
    ).value_counts() if any(not d.empty for d in (menu, struk, properti)) else pd.Series(dtype=int)

    if semua_hex is not None:
        hasil = hasil.reindex(semua_hex)
        n = n.reindex(semua_hex).fillna(0)
    hasil["n_titik_misi"] = n.reindex(hasil.index).fillna(0).astype(int)
    hasil.index.name = "h3_index"
    return hasil



# ---------------------------------------------------------------------------
# Zonasi RDTR -> L01, L02, L03
# ---------------------------------------------------------------------------
#
# Sumbernya GISTARU ATR/BPN, dan cakupannya HANYA DKI Jakarta - tiga dari enam
# kawasan pilot. Kota Depok dan Kota Bekasi tidak terdaftar di portalnya sama
# sekali, jadi Depok Baru, Bekasi, dan Harjamukti tetap TIDAK_DIKETAHUI.

#: Zona yang jelas mengizinkan kegiatan usaha.
ZONA_USAHA = {"K"}

#: Zona yang jelas TIDAK bisa jadi tempat usaha - bukan karena dilarang
#: berdagang, melainkan karena bidangnya memang bukan tempat orang membangun:
#: badan air, badan jalan, ruang terbuka hijau, instalasi pertahanan, dan
#: pembangkit listrik.
ZONA_BUKAN_TEMPAT_USAHA = {"BA", "BJ", "RTH", "HK", "PTL"}

#: Sisanya - R, KT, SPU, TR - sengaja TIDAK diputuskan di sini. Keempatnya
#: lazim mengizinkan sebagian kegiatan usaha lewat matriks ITBX, tetapi ITBX
#: dari API GISTARU TERPOTONG di 11.523 karakter (terukur 26 Agu 2026), jadi
#: daftar izinnya tidak lengkap. Daftar izin yang terpotong lebih berbahaya
#: daripada tidak punya daftar sama sekali: poligon yang kebetalan hilang dari
#: potongan akan terbaca "dilarang", dan L01 FALSE menolkan skor.

#: Pangsa luas minimum zona usaha sebelum satu heksagon dinyatakan mengizinkan.
#: Kecil dengan sengaja: heksagon res-9 seluas 0,105 km2, dan sepetak ruko di
#: sudutnya sudah cukup untuk membuka usaha. Yang dijawab L01 bukan "apakah
#: seluruh heksagon ini komersial", melainkan "apakah ADA tempat sah di sini".
PANGSA_USAHA_MIN = 0.02

#: Cakupan RDTR minimum sebelum satu heksagon boleh dinyatakan DILARANG.
#: Heksagon di tepi DKI sebagian bidangnya tidak tertutup poligon RDTR mana pun,
#: dan menyimpulkan larangan dari potongan kecil sama saja menebak.
CAKUPAN_MIN = 0.80

#: KRB dari RDTR, dinormalkan ke [0,1]. "Tidak Ada" berarti tidak masuk kawasan
#: rawan - itu NOL yang sah, bukan kekosongan.
RISIKO_BANJIR_RDTR = {
    "sangat tinggi": 1.0, "tinggi": 0.75, "sedang": 0.5,
    "rendah": 0.25, "sangat rendah": 0.1, "tidak ada": 0.0,
}


def _skor_krb(teks: str | None) -> float | None:
    """'Kawasan Rawan Banjir - Sangat Tinggi' -> 1,0. Tak dikenal -> None."""
    if not teks:
        return None
    kunci = str(teks).split("-")[-1].strip().lower()
    return RISIKO_BANJIR_RDTR.get(kunci)


def dimensi_lahan(
    rdtr: dict[str, list], semua_hex: pd.Index | None = None
) -> pd.DataFrame:
    """L01 izin usaha, L02 kelas zona, L03 risiko banjir - dari RDTR.

    Masukan: keluaran `s1_ingest._potong_ke_heksagon` - daftar zona per
    heksagon beserta `pangsa`, yaitu bagian luas heksagon yang ditempati zona
    itu. Perpotongan geometrinya sudah dikerjakan saat menarik, jadi di sini
    tidak ada satu pun operasi geometri.

    Ketiganya ditimbang menurut LUAS, bukan menurut jumlah poligon. Satu
    heksagon bisa memotong belasan poligon yang 90% luasnya satu zona dan
    sisanya sembilan serpihan; menghitung kepala akan menyatakan zona yang
    salah sebagai dominan.

    L01 sengaja berat sebelah ke arah TIDAK MENOLAK:
      TRUE   ada zona usaha seluas >= PANGSA_USAHA_MIN
      FALSE  SELURUH luasnya zona yang bukan tempat usaha
      None   selebihnya - termasuk zona yang mungkin mengizinkan lewat ITBX
             tetapi tidak bisa dipastikan karena ITBX-nya terpotong
    Sebabnya asimetris: FALSE menolkan skor lokasi, dan menolkan lokasi yang
    sebenarnya sah jauh lebih merusak daripada membiarkannya TIDAK_DIKETAHUI -
    yang oleh antarmuka sudah dinyatakan apa adanya beserta anjuran verifikasi.
    """
    kolom = ["zona_izin_komersial", "kelas_zona", "risiko_banjir"]
    baris: dict[str, dict] = {}

    for sel, zona in rdtr.items():
        if not zona:
            continue
        luas: dict[str, float] = {}
        nama: dict[str, str] = {}
        krb_tertimbang, krb_luas = 0.0, 0.0
        for z in zona:
            p = float(z.get("pangsa") or 0.0)
            if p <= 0:
                continue
            kod = z.get("KODZON")
            luas[kod] = luas.get(kod, 0.0) + p
            nama[kod] = z.get("NAMZON") or kod
            skor = _skor_krb(z.get("KRB_03"))
            if skor is not None:
                krb_tertimbang += skor * p
                krb_luas += p

        if not luas:
            continue
        total = sum(luas.values())
        dominan = max(luas, key=luas.get)
        pangsa_usaha = sum(v for k, v in luas.items() if k in ZONA_USAHA) / total

        # `total` adalah CAKUPAN, bukan 1,0. Heksagon di tepi DKI sebagian
        # bidangnya di luar RDTR sama sekali - terukur, satu heksagon Tanah
        # Abang cuma 20% tertutup poligon. Menyatakan DILARANG dari seperlima
        # bidang yang kebetulan badan jalan akan menolkan skor lokasi yang
        # empat perlimanya belum diperiksa siapa pun.
        if pangsa_usaha >= PANGSA_USAHA_MIN:
            izin = True
        elif total >= CAKUPAN_MIN and all(k in ZONA_BUKAN_TEMPAT_USAHA for k in luas):
            izin = False
        else:
            izin = None

        baris[sel] = {
            "zona_izin_komersial": izin,
            "kelas_zona": (nama.get(dominan) or "")[:40] or None,
            "risiko_banjir": round(krb_tertimbang / krb_luas, 3) if krb_luas else None,
        }

    hasil = pd.DataFrame.from_dict(baris, orient="index")
    for k in kolom:
        if k not in hasil.columns:
            hasil[k] = None
    hasil = hasil[kolom]

    # dtype dipaku `object`. Kalau seluruh nilainya kebetulan True, pandas
    # menyempitkannya jadi dtype `bool` - dan kolom bool tidak bisa memuat None,
    # sehingga "tidak diketahui" berisiko terbaca "dilarang" begitu satu baris
    # kosong bergabung. Untuk kolom yang MENOLKAN SKOR, risiko sekecil apa pun
    # tidak sebanding dengan penghematan satu byte per baris.
    hasil["zona_izin_komersial"] = hasil["zona_izin_komersial"].astype(object)

    if semua_hex is not None:
        hasil = hasil.reindex(semua_hex)
    hasil.index.name = "h3_index"
    return hasil

def hitung_dimensi_kompetisi() -> None:
    """C01-C08.

    Kompetitor langsung (C01) = POI dalam KELAS INDUK YANG SAMA, di heksagon ini
    DITAMBAH k-ring 1. Bukan seluruh POI yang ada di sana.

    Kalau pengguna berencana membuka kedai kopi, apotek dan bengkel di sebelahnya
    bukan kompetitor - keduanya justru menambah alasan orang datang. Menghitung
    semua POI sebagai kompetitor membuat kawasan ramai dan bervariasi selalu
    terlihat "penuh kompetitor", padahal justru itu yang dicari.

    k-ring 1 dipakai karena jarak antarpusat heksagon res-9 sekitar 350 m dan
    konsumen pejalan kaki tidak berhenti di batas heksagon.
    """
    raise NotImplementedError


def hitung_dimensi_biaya() -> None:
    """P01-P06. NJOP zonal median + persentil, pasokan sewa, rasio sewa/jual,
    harga sewa median (dari A1), indeks churn."""
    raise NotImplementedError


def hitung_dimensi_risiko() -> None:
    """L01-L03.

    L01 zona_izin_komersial adalah GATE, bukan variabel biasa: kalau FALSE,
    skor peluang dinolkan berapa pun nilai variabel lain.

    Kawasan tanpa RDTR digital ditandai eksplisit, bukan diasumsikan mengizinkan.
    """
    raise NotImplementedError


def hitung_dimensi_morfologi() -> None:
    """M01-M03. Tutupan bangunan, luas median (Open Buildings), prestise visual (A3)."""
    raise NotImplementedError


def hitung_penanda_kualitas() -> None:
    """Q01-Q03. n_titik_misi -> tingkat_keyakinan lewat config.tingkat_keyakinan().

    data_source = 'observed' kalau ada titik misi, 'predicted' kalau nilainya
    berasal dari s5_impute. Heksagon tanpa data misi TIDAK diisi nol -
    "nol transaksi tercatat" dan "tidak ada transaksi di sini" adalah dua
    pernyataan yang sama sekali berbeda.
    """
    raise NotImplementedError


if __name__ == "__main__":
    print(f"Kawasan   : {len(KAWASAN_PILOT)} pilot")
    print(f"Resolusi  : H3 res-{H3_RESOLUSI}")
    print(f"Isochrone : {ISOCHRONE_MENIT} menit")
