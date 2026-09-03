"""Simulasi kelayakan usaha per heksagon.

APA INI, DAN APA YANG BUKAN
===========================

Ini **bukan skor**. Ia tidak pernah ditulis ke `location_scores`, tidak pernah
ikut menentukan peringkat, dan tidak mengubah satu pun kuadran. Aturan 1 repo ini
- "skor hanya dihitung di `pipeline/s6_score.py`" - tetap utuh: yang dihitung di
sini adalah SKENARIO milik satu pengguna atas satu heksagon, bukan penilaian
platform atas lokasi itu.

Ia juga bukan ramalan. Tidak ada model, tidak ada pelatihan, tidak ada
probabilitas. Yang ada cuma aritmetika yang bisa dibaca ulang oleh siapa pun.

PEMBAGIAN YANG MENJAGANYA TETAP JUJUR
=====================================

Setiap angka di keluaran punya tepat satu asal, dan asalnya selalu dinyatakan:

    TERUKUR    berasal dari basis data - hasil survei misi MAPID, OCR, atau
               pipeline. Pengguna tidak bisa mengubahnya.
    ASUMSI     berasal dari pengguna. Punya nilai bawaan, tetapi bawaannya
               adalah angka bulat yang diakui sebagai tebakan awal - BUKAN
               nilai yang kami klaim terhitung dari data.
    TURUNAN    hasil aritmetika dari keduanya. Rumusnya ikut dikirim ke
               antarmuka sebagai teks, supaya bisa diperiksa tanpa membuka kode.

Yang paling menggoda untuk dilanggar adalah `pangsa`: berapa persen dari uang
yang berputar di heksagon itu yang bisa ditangkap satu warung baru. Kami TIDAK
menurunkannya dari data. Menurunkannya berarti mengarang - tidak ada satu pun
variabel di 43 kolom itu yang mengukur "berapa bagian yang akan didapat pendatang
baru". Yang bisa kami lakukan cuma menaruh indeks kompetisi di sebelahnya sebagai
bahan pertimbangan, lalu membiarkan pengguna yang memutuskan.

Bedanya besar. Angka yang dikarang lalu ditampilkan sebagai hasil hitungan akan
dipercaya. Angka yang diakui sebagai asumsi akan diuji.

DUA ASUMSI YANG PENGGUNANYA TAHU LEBIH BAIK DARIPADA KITA
=========================================================

Sewa dan harga rata-rata per pembeli boleh DIISI SENDIRI, dan kalau diisi ia
menang atas angka basis data. Itu bukan kelonggaran, melainkan pengakuan atas
siapa yang memegang angka yang lebih benar:

  sewa           orang yang sedang menimbang sebuah ruko sudah memegang
                 penawaran dari pemiliknya. Median satu heksagon tidak akan
                 pernah lebih benar daripada angka yang tertulis di penawaran
                 itu - ia rata-rata atas ruko yang BUKAN ruko yang ia tawar.
  harga rata-rata  itu rencana usahanya sendiri, bukan pengamatan atas orang
                 lain. Median struk heksagon menjawab "berapa yang dibelanjakan
                 orang di sini", bukan "berapa harga jual saya".

Akibatnya satu angka jadi bisa dihitung DI MANA PUN, tanpa satu baris survei:

    pembeli impas = sewa bulanan / (hari x harga rata-rata x margin)

Ketiga bahannya milik pengguna. Itulah sebabnya angka ini yang ditaruh paling
depan sekarang - ia tidak pernah kosong, dan ia tidak memuat satu pun tebakan
kami. Yang tetap menuntut data justru omzet: berapa uang yang berputar di
heksagon itu bukan sesuatu yang bisa dijawab siapa pun dari kursinya.

Yang TIDAK berubah: keduanya tetap ASUMSI, dan asalnya ikut dikirim di
`sumber` supaya antarmuka - dan juri - bisa membedakan angka yang diisi orang
dari angka yang diukur.
"""

from __future__ import annotations

from dataclasses import dataclass

# --- Asumsi bawaan ---------------------------------------------------------
# Sengaja angka bulat. Bulat mengumumkan dirinya sebagai titik awal yang harus
# diganti; "4,7%" akan terbaca sebagai sesuatu yang dihitung, padahal bukan.
PANGSA_BAWAAN = 5.0  # persen dari belanja yang berputar di heksagon
MARGIN_BAWAAN = 30.0  # persen, margin kotor sebelum gaji dan operasional
JAM_BUKA_BAWAAN = 10
LUAS_BAWAAN_M2 = 20
HARI_PER_BULAN = 26  # enam hari kerja per minggu

#: Jenis usaha hanya mengubah BAWAAN, bukan rumusnya. Nilainya tetap bisa
#: ditimpa pengguna - ini titik awal yang masuk akal, bukan kebenaran.
#:
#: Diperluas 3 September 2026 dari empat jadi enam belas, permintaan pemilik
#: repo: empat jenis memaksa pemilik bengkel, apotek, atau bimbel memilih
#: "Jasa" dan mewarisi margin barbershop. Bawaan yang salah lebih buruk
#: daripada tidak ada bawaan - ia terbaca sebagai perkiraan untuk usahanya,
#: padahal perkiraan untuk usaha orang lain.
#:
#: Ketiga angkanya tetap ASUMSI dan tetap bulat, karena alasan yang sama seperti
#: sejak awal: bulat mengumumkan dirinya sebagai titik awal yang harus diganti.
#: Yang membedakan jenis satu dengan yang lain cuma titik awalnya; rumusnya
#: satu untuk semua, dan `sumber` tetap menandai mana yang diisi orang.
#:
#: `kelompok` HANYA untuk menyusun tampilan pilihannya. Ia tidak menyentuh satu
#: pun perhitungan.
#:
#: Kembarannya di frontend: `Simulasi.tsx::JENIS` dan `BAWAAN`. Dijaga sama oleh
#: tests/test_aturan.py - kalau salah satunya bergeser, ujinya merah.
JENIS_USAHA: dict[str, dict[str, float | int | str]] = {
    # --- Makanan & minuman -------------------------------------------------
    "kuliner_ringan": {"kelompok": "Makanan & minuman", "label": "Kuliner ringan (kopi, jajanan)", "margin": 35.0, "luas": 12, "jam": 12},
    "warung_makan": {"kelompok": "Makanan & minuman", "label": "Warung makan", "margin": 28.0, "luas": 24, "jam": 11},
    "restoran": {"kelompok": "Makanan & minuman", "label": "Restoran & kafe duduk", "margin": 30.0, "luas": 60, "jam": 12},
    "bakery": {"kelompok": "Makanan & minuman", "label": "Roti & kue", "margin": 38.0, "luas": 20, "jam": 12},
    # --- Ritel -------------------------------------------------------------
    "retail_kecil": {"kelompok": "Ritel", "label": "Kelontong & ATK", "margin": 20.0, "luas": 18, "jam": 12},
    "minimarket": {"kelompok": "Ritel", "label": "Minimarket", "margin": 18.0, "luas": 80, "jam": 16},
    "fesyen": {"kelompok": "Ritel", "label": "Fesyen & aksesoris", "margin": 45.0, "luas": 30, "jam": 10},
    "elektronik": {"kelompok": "Ritel", "label": "Gawai & elektronik", "margin": 15.0, "luas": 20, "jam": 10},
    "bangunan": {"kelompok": "Ritel", "label": "Bahan bangunan & perkakas", "margin": 22.0, "luas": 60, "jam": 9},
    # --- Jasa --------------------------------------------------------------
    "jasa": {"kelompok": "Jasa", "label": "Jasa harian (barbershop, laundry)", "margin": 45.0, "luas": 16, "jam": 10},
    "kecantikan": {"kelompok": "Jasa", "label": "Salon & perawatan", "margin": 55.0, "luas": 30, "jam": 10},
    "kesehatan": {"kelompok": "Jasa", "label": "Apotek & klinik", "margin": 25.0, "luas": 35, "jam": 12},
    "pendidikan": {"kelompok": "Jasa", "label": "Bimbel & kursus", "margin": 50.0, "luas": 45, "jam": 8},
    "otomotif": {"kelompok": "Jasa", "label": "Bengkel & cuci kendaraan", "margin": 40.0, "luas": 50, "jam": 10},
    "hiburan": {"kelompok": "Jasa", "label": "Gim, gym & hiburan", "margin": 50.0, "luas": 70, "jam": 12},
    "logistik": {"kelompok": "Jasa", "label": "Agen paket & ekspedisi", "margin": 30.0, "luas": 12, "jam": 10},
}


@dataclass(frozen=True)
class Peringatan:
    kode: str
    tingkat: str  # INFO | WASPADA | BAHAYA
    pesan: str


def _aman(nilai: float | None) -> float | None:
    """NaN dan None sama-sama berarti 'belum ada', dan keduanya TETAP kosong.

    Menggantinya dengan nol akan membuat simulasi menghasilkan omzet Rp0 yang
    terbaca sebagai temuan, padahal artinya cuma belum ada yang mensurvei.
    """
    if nilai is None:
        return None
    try:
        f = float(nilai)
    except (TypeError, ValueError):
        return None
    return None if f != f else f  # NaN != NaN


def hitung_simulasi(
    *,
    variabel: dict[str, float | None],
    indeks_kompetisi: float | None,
    indeks_churn: float | None,
    zona_izin: bool | None,
    keyakinan: str,
    jenis_usaha: str,
    jam_buka: int,
    luas_m2: int,
    pangsa_persen: float,
    margin_persen: float,
    sewa_bulanan_diminta: float | None = None,
    harga_rata_rata: float | None = None,
) -> dict:
    """Satu skenario, seluruh langkahnya terbuka.

    Mengembalikan dict yang siap divalidasi Pydantic di `schemas.py`. Setiap
    besaran turunan dikirim bersama rumusnya sebagai string - antarmuka
    menampilkan rumus itu apa adanya, jadi tidak ada langkah yang tersembunyi.
    """
    belanja_per_jam = _aman(variabel.get("belanja_per_jam"))
    sewa_per_m2 = _aman(variabel.get("harga_sewa_per_m2"))
    struk = _aman(variabel.get("nominal_median_struk"))
    porsi = _aman(variabel.get("harga_median_porsi"))

    pangsa = pangsa_persen / 100
    margin = margin_persen / 100

    # --- Dua angka yang penggunanya boleh menimpa -------------------------
    # Yang diisi pengguna MENANG. Bukan karena lebih presisi, melainkan karena
    # ia menjawab pertanyaan yang berbeda: median heksagon menggambarkan ruko
    # lain di sekitarnya, sedangkan penawaran yang ia pegang menggambarkan ruko
    # yang sedang ia timbang. Untuk skenario milik satu orang, yang kedua yang
    # benar.
    #
    # `sumber_*` ikut dikirim ke antarmuka. Tanpa itu, angka yang diketik orang
    # dan angka yang diukur pipeline akan terlihat sama persis di layar - dan
    # itu persis jenis kekaburan yang dilarang docstring di kepala berkas ini.
    sewa_pengguna = _aman(sewa_bulanan_diminta)
    if sewa_pengguna is not None and sewa_pengguna > 0:
        sewa_bulanan: float | None = sewa_pengguna
        sumber_sewa = "pengguna"
    elif sewa_per_m2 is not None:
        sewa_bulanan = sewa_per_m2 * luas_m2
        sumber_sewa = "data"
    else:
        sewa_bulanan = None
        sumber_sewa = None

    harga_pengguna = _aman(harga_rata_rata)
    if harga_pengguna is not None and harga_pengguna > 0:
        struk_dipakai: float | None = harga_pengguna
        sumber_harga = "pengguna"
    elif struk is not None:
        struk_dipakai = struk
        sumber_harga = "data"
    else:
        struk_dipakai = None
        sumber_harga = None

    # --- Turunan ----------------------------------------------------------
    omzet_harian = None if belanja_per_jam is None else belanja_per_jam * jam_buka * pangsa
    omzet_bulanan = None if omzet_harian is None else omzet_harian * HARI_PER_BULAN

    laba_kotor = (
        None
        if omzet_bulanan is None or sewa_bulanan is None
        else omzet_bulanan * margin - sewa_bulanan
    )
    rasio_sewa = (
        None
        if omzet_bulanan is None or sewa_bulanan is None or omzet_bulanan <= 0
        else sewa_bulanan / omzet_bulanan
    )
    # Berapa pembeli per hari sekadar untuk menutup sewanya - bukan untuk untung.
    # Angka paling depan sekarang, dan satu-satunya yang bisa hidup TANPA
    # sebaris pun data survei - ketiga bahannya boleh datang dari pengguna.
    pembeli_impas = (
        None
        if sewa_bulanan is None
        or struk_dipakai is None
        or struk_dipakai <= 0
        or margin <= 0
        else sewa_bulanan / (HARI_PER_BULAN * struk_dipakai * margin)
    )
    # Pangsa yang membuat laba tepat nol: laba = belanja x jam x pangsa x hari x
    # margin - sewa = 0. Dibalik, pangsanya = sewa / (belanja x jam x hari x
    # margin). Ini angka yang paling layak dipercaya di sini, karena ia tidak
    # memuat satu pun asumsi pangsa - cuma harga sewa dan uang yang terukur.
    dasar_omzet = (
        None
        if belanja_per_jam is None or belanja_per_jam <= 0 or margin <= 0
        else belanja_per_jam * jam_buka * HARI_PER_BULAN * margin
    )
    pangsa_impas = (
        None
        if dasar_omzet is None or sewa_bulanan is None
        else (sewa_bulanan / dasar_omzet) * 100
    )
    sewa_tahun_pertama = None if sewa_bulanan is None else sewa_bulanan * 12

    # Kalau sewanya diisi sendiri, ubah jadi per m2 supaya bisa disandingkan
    # dengan angka lokasi - satu-satunya cara tahu penawarannya wajar atau tidak.
    sewa_per_m2_tersirat = (
        sewa_bulanan / luas_m2
        if sumber_sewa == "pengguna" and sewa_bulanan is not None and luas_m2 > 0
        else None
    )

    # Tabel kepekaan: rumus yang SAMA dijalankan pada beberapa pangsa. Bukan
    # skenario "optimis/pesimis" yang kami beri label - cuma deret masukan,
    # dan pembaca yang memutuskan mana yang masuk akal untuk usahanya.
    sensitivitas = []
    for p_uji in sorted({round(x, 1) for x in (
        max(1.0, pangsa_persen * 0.5), pangsa_persen,
        pangsa_persen * 1.5, pangsa_persen * 2.0,
    )}):
        laba_uji = (
            None
            if belanja_per_jam is None or sewa_bulanan is None
            else belanja_per_jam * jam_buka * (p_uji / 100) * HARI_PER_BULAN * margin
            - sewa_bulanan
        )
        sensitivitas.append({"pangsa_persen": p_uji, "laba_kotor_bulanan": laba_uji})

    # --- Peringatan: fakta, bukan patokan ---------------------------------
    #
    # Tidak ada ambang "sewa sehat maksimal 30% omzet" di sini. Angka semacam itu
    # beredar luas tetapi tidak berasal dari data mana pun yang kami punya, dan
    # menuliskannya akan menyamarkan tebakan jadi temuan. Yang diperingatkan
    # hanya hal yang benar secara aritmetika atau tercatat di basis data.
    peringatan: list[Peringatan] = []
    if zona_izin is False:
        peringatan.append(
            Peringatan(
                "ZONA_MELARANG",
                "BAHAYA",
                "Zona RDTR di sini melarang kegiatan usaha. Simulasi tetap dihitung "
                "sebagai latihan, tetapi lokasi ini tidak boleh dipakai.",
            )
        )
    elif zona_izin is None:
        peringatan.append(
            Peringatan(
                "ZONA_TIDAK_DIKETAHUI",
                "WASPADA",
                "Belum ada RDTR digital untuk lokasi ini - status izinnya belum bisa "
                "dipastikan. Verifikasi ke dinas terkait sebelum menyewa.",
            )
        )
    if (
        pangsa_impas is not None
        and pangsa_impas > 25
    ):
        peringatan.append(
            Peringatan(
                "IMPAS_TIDAK_REALISTIS",
                "WASPADA",
                f"Untuk sekadar menutup sewa, usaha ini harus menangkap "
                f"{pangsa_impas:.0f}% dari seluruh belanja yang berputar di heksagon "
                f"ini. Itu pangsa yang sangat besar untuk pendatang baru - "
                f"pertimbangkan lokasi dengan sewa lebih rendah.",
            )
        )
    if laba_kotor is not None and laba_kotor < 0:
        peringatan.append(
            Peringatan(
                "BELUM_MENUTUP_SEWA",
                "WASPADA",
                "Dengan asumsi ini, laba kotor belum menutup sewa. Naikkan pangsa, "
                "perkecil luas, atau bandingkan dengan heksagon lain.",
            )
        )
    if indeks_churn is not None and indeks_churn > 0.45:
        peringatan.append(
            Peringatan(
                "PERGANTIAN_TINGGI",
                "WASPADA",
                f"Indeks pergantian usaha di sini {indeks_churn:.2f} - relatif tinggi. "
                "Banyak usaha yang datang lalu pergi.",
            )
        )
    if keyakinan == "RENDAH":
        peringatan.append(
            Peringatan(
                "DATA_TIPIS",
                "INFO",
                "Data survei di heksagon ini tipis, jadi angka terukurnya pun tipis. "
                "Perlakukan hasilnya sebagai arah, bukan angka.",
            )
        )
    if belanja_per_jam is None:
        peringatan.append(
            Peringatan(
                "TANPA_DATA_BELANJA",
                "INFO",
                "Belum ada data belanja per jam di heksagon ini, jadi omzetnya tidak "
                "bisa dihitung - bukan berarti nol. Yang tetap bisa dijawab: berapa "
                "pembeli per hari yang dibutuhkan sekadar untuk menutup sewa.",
            )
        )
    # Dua peringatan di bawah bukan soal DATA melainkan soal ISIAN. Dipisah
    # karena tindakannya berbeda: yang satu menunggu survei, yang lain cuma
    # menunggu orangnya mengetik angka yang sudah ada di tangannya.
    if sewa_bulanan is None:
        peringatan.append(
            Peringatan(
                "SEWA_BELUM_DIISI",
                "INFO",
                "Isi sewa yang ditawarkan ke Anda supaya kebutuhan pembeli per hari "
                "bisa dihitung. Angka itu ada di penawaran pemilik, bukan di peta.",
            )
        )
    if struk_dipakai is None:
        peringatan.append(
            Peringatan(
                "HARGA_BELUM_DIISI",
                "INFO",
                "Isi harga rata-rata per pembeli - itu rencana harga jual Anda "
                "sendiri, dan tidak ada data survei yang bisa menggantikannya.",
            )
        )
    if sumber_sewa == "pengguna" and sewa_per_m2 is not None and sewa_per_m2 > 0:
        peringatan.append(
            Peringatan(
                "SEWA_DIBANDING_LOKASI",
                "INFO",
                "Sewa yang Anda isi dibandingkan dengan sewa terukur di heksagon ini "
                "- lihat sewa per m2 di bagian angka.",
            )
        )

    return {
        "masukan": {
            "jenis_usaha": jenis_usaha,
            "label_usaha": str(JENIS_USAHA.get(jenis_usaha, {}).get("label", jenis_usaha)),
            "jam_buka": jam_buka,
            "luas_m2": luas_m2,
            "pangsa_persen": pangsa_persen,
            "margin_persen": margin_persen,
            "hari_per_bulan": HARI_PER_BULAN,
            "sewa_bulanan_diminta": _aman(sewa_bulanan_diminta),
            "harga_rata_rata": _aman(harga_rata_rata),
        },
        # Asal tiap angka yang bisa datang dari dua arah. Antarmuka memakainya
        # untuk menuliskan "dari Anda" atau "dari data lokasi" di sebelah
        # angkanya - tanpa ini keduanya terlihat sama persis di layar.
        "sumber": {"sewa": sumber_sewa, "harga_rata_rata": sumber_harga},
        "terukur": {
            "belanja_per_jam": belanja_per_jam,
            "nominal_median_struk": struk,
            "harga_median_porsi": porsi,
            "harga_sewa_per_m2": sewa_per_m2,
            "indeks_kompetisi": _aman(indeks_kompetisi),
            "indeks_churn": _aman(indeks_churn),
        },
        "hasil": {
            "omzet_harian": omzet_harian,
            "omzet_bulanan": omzet_bulanan,
            "sewa_bulanan": sewa_bulanan,
            "laba_kotor_bulanan": laba_kotor,
            "rasio_sewa_terhadap_omzet": rasio_sewa,
            "pembeli_impas_per_hari": pembeli_impas,
            "pangsa_impas_persen": pangsa_impas,
            "sewa_tahun_pertama": sewa_tahun_pertama,
            "sewa_per_m2_tersirat": sewa_per_m2_tersirat,
        },
        "sensitivitas": sensitivitas,
        # Rumusnya ikut berubah menurut asal angkanya. Menampilkan
        # "harga sewa per m² × luas" padahal sewanya diketik orang akan membuat
        # pembacanya mencari angka per m² yang tidak pernah dipakai.
        "rumus": {
            "omzet_harian": "belanja per jam × jam buka × pangsa",
            "omzet_bulanan": f"omzet harian × {HARI_PER_BULAN} hari",
            "sewa_bulanan": (
                "sewa yang Anda isi"
                if sumber_sewa == "pengguna"
                else "harga sewa per m² × luas"
            ),
            "laba_kotor_bulanan": "omzet bulanan × margin − sewa bulanan",
            "pembeli_impas_per_hari": (
                f"sewa bulanan ÷ ({HARI_PER_BULAN} × "
                + ("harga rata-rata yang Anda isi" if sumber_harga == "pengguna" else "median struk")
                + " × margin)"
            ),
            "pangsa_impas_persen": f"sewa bulanan ÷ (belanja per jam × jam buka × {HARI_PER_BULAN} × margin)",
            "sewa_tahun_pertama": "sewa bulanan × 12 — ruko lazim ditagih setahun di muka",
            "sewa_per_m2_tersirat": "sewa yang Anda isi ÷ luas — untuk disandingkan dengan sewa terukur di heksagon ini",
        },
        "peringatan": [{"kode": p.kode, "tingkat": p.tingkat, "pesan": p.pesan} for p in peringatan],
        "keyakinan": keyakinan,
    }
