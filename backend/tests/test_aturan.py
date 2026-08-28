"""Uji aturan produk. Tanpa basis data, tanpa jaringan.

    cd backend && python -m pytest tests/test_aturan.py -v
    atau:  python tests/test_aturan.py

Yang diuji di sini adalah keputusan yang paling mudah rusak tanpa disadari:
batas peringatan, dan perbedaan antara "dilarang" dan "belum diketahui".
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api.ai import ALAT_BACKEND, ALAT_FRONTEND, NAMA_FRONTEND, REGISTRI, _argumen_peta
from app.api.bersama import DIMENSI, SEMUA_VARIABEL
from app.core.aturan import (
    TINGKAT_BERPERINGATAN,
    CHURN_LANTAI_ABSOLUT,
    PENJELASAN_ZONA,
    status_zona,
    tingkat_risiko_churn,
)


# --- ZoneGuard -------------------------------------------------------------


def test_zona_tiga_status_berbeda():
    assert status_zona(True) == "DIIZINKAN"
    assert status_zona(False) == "DILARANG"
    assert status_zona(None) == "TIDAK_DIKETAHUI"


def test_zona_null_bukan_dilarang():
    """Kesalahan yang paling mudah terjadi dan paling terlihat di peta.

    Kawasan tanpa RDTR digital bukan kawasan terlarang. Menyamakan keduanya
    akan mematikan seluruh kawasan itu.
    """
    assert status_zona(None) != status_zona(False)
    assert "belum" in PENJELASAN_ZONA["TIDAK_DIKETAHUI"].lower()


# --- RiskRadar -------------------------------------------------------------


def test_churn_di_bawah_lantai_selalu_aman():
    """Tanpa lantai absolut, tiap kawasan otomatis punya 25% area 'berisiko',
    dan peringatan yang selalu muncul berhenti dibaca."""
    rendah = CHURN_LANTAI_ABSOLUT - 0.01
    assert tingkat_risiko_churn(rendah, p75=0.05, p90=0.10) == "AMAN"


def test_churn_bertingkat():
    assert tingkat_risiko_churn(0.50, p75=0.40, p90=0.70) == "WASPADA"
    assert tingkat_risiko_churn(0.80, p75=0.40, p90=0.70) == "BAHAYA"
    assert tingkat_risiko_churn(0.35, p75=0.40, p90=0.70) == "AMAN"


def test_churn_kosong_bukan_aman():
    """Churn kosong TIDAK boleh terbaca sebagai aman.

    Sejak P06 dikosongkan (27 Agu 2026), churn kosong di seluruh 708 heksagon.
    Memetakannya ke AMAN membuat platform menyatakan "pergantian usaha wajar"
    untuk setiap lokasi tanpa satu pun data di belakangnya - klaim, bukan diam.
    """
    assert tingkat_risiko_churn(None, 0.4, 0.7) == "TIDAK_DIKETAHUI"


def test_churn_ada_tanpa_persentil_tetap_bisa_dinilai():
    """Churn di bawah lantai absolut tetap AMAN walau persentilnya tidak ada -
    yang hilang di sini pembandingnya, bukan pengukurannya."""
    assert tingkat_risiko_churn(0.1, None, None) == "AMAN"
    assert tingkat_risiko_churn(0.9, None, None) == "AMAN"


def test_tidak_diketahui_bukan_peringatan():
    """Saringan "tampilkan yang berperingatan saja" tidak boleh berubah jadi
    "tampilkan yang datanya tidak ada"."""
    assert "TIDAK_DIKETAHUI" not in TINGKAT_BERPERINGATAN
    assert "AMAN" not in TINGKAT_BERPERINGATAN
    assert set(TINGKAT_BERPERINGATAN) == {"WASPADA", "BAHAYA"}


# --- Simulasi usaha --------------------------------------------------------
#
# Modul ini sebelumnya tidak punya satu pun uji, dan justru ia yang paling
# mudah rusak diam-diam: seluruh keluarannya boleh None, jadi simulasi yang
# berhenti menghitung apa pun tetap menjawab 200 dengan bentuk yang benar.


_VARIABEL_KOSONG = {
    "belanja_per_jam": None,
    "nominal_median_struk": None,
    "harga_median_porsi": None,
    "harga_sewa_per_m2": None,
}


def _simulasi(**tambahan):
    from app.core.simulasi import hitung_simulasi

    variabel = dict(_VARIABEL_KOSONG, **tambahan.pop("variabel", {}))
    return hitung_simulasi(
        variabel=variabel,
        indeks_kompetisi=0.2,
        indeks_churn=None,
        zona_izin=True,
        keyakinan="RENDAH",
        jenis_usaha="kuliner_ringan",
        jam_buka=12,
        luas_m2=18,
        pangsa_persen=5,
        margin_persen=28,
        **tambahan,
    )


def test_simulasi_hidup_tanpa_sebaris_pun_data_survei():
    """Inti perubahan 27 Agu 2026, dan alasan seluruh fitur ini masih berguna
    walau 18 variabel kosong.

    Ketiga bahan `pembeli impas` - sewa, harga rata-rata, margin - boleh datang
    dari penggunanya sendiri. Orang yang menimbang sebuah ruko sudah memegang
    penawarannya, dan harga jual adalah rencananya sendiri; tidak ada survei
    yang bisa menggantikan keduanya.
    """
    h = _simulasi(sewa_bulanan_diminta=4_500_000, harga_rata_rata=25_000)
    impas = h["hasil"]["pembeli_impas_per_hari"]
    assert impas is not None, "harus terhitung walau basis datanya kosong"
    # 4.500.000 / (26 x 25.000 x 0,28)
    assert abs(impas - 24.7252) < 0.01


def test_simulasi_tanpa_isian_tetap_kosong_bukan_nol():
    """Aturan 4. Nol pembeli impas berarti sewanya gratis - pernyataan yang
    jauh lebih kuat daripada 'belum diisi'."""
    h = _simulasi()
    assert h["hasil"]["pembeli_impas_per_hari"] is None
    assert h["hasil"]["sewa_bulanan"] is None
    kode = {p["kode"] for p in h["peringatan"]}
    assert {"SEWA_BELUM_DIISI", "HARGA_BELUM_DIISI"} <= kode


def test_simulasi_isian_pengguna_menang_atas_basis_data():
    """Median heksagon menggambarkan ruko LAIN; penawaran yang dipegang orang
    menggambarkan ruko yang sedang ia timbang."""
    h = _simulasi(
        variabel={"harga_sewa_per_m2": 200_000, "nominal_median_struk": 30_000},
        sewa_bulanan_diminta=4_500_000,
        harga_rata_rata=25_000,
    )
    assert h["hasil"]["sewa_bulanan"] == 4_500_000
    assert h["sumber"] == {"sewa": "pengguna", "harga_rata_rata": "pengguna"}


def test_simulasi_jatuh_ke_basis_data_kalau_tidak_diisi():
    h = _simulasi(variabel={"harga_sewa_per_m2": 200_000, "nominal_median_struk": 30_000})
    assert h["sumber"] == {"sewa": "data", "harga_rata_rata": "data"}
    assert h["hasil"]["sewa_bulanan"] == 3_600_000  # 200rb x 18 m2


def test_simulasi_sewa_nol_bukan_sewa_gratis():
    """Isian 0 harus dibaca 'belum diisi'. Kalau ia diterima apa adanya,
    pembeli impas jadi 0 dan lokasinya terlihat seperti hadiah."""
    h = _simulasi(sewa_bulanan_diminta=0, harga_rata_rata=25_000)
    assert h["sumber"]["sewa"] is None
    assert h["hasil"]["pembeli_impas_per_hari"] is None


def test_simulasi_asal_angka_selalu_ikut():
    """Tanpa `sumber`, angka yang diketik orang dan angka yang diukur pipeline
    terlihat sama persis di layar."""
    h = _simulasi(sewa_bulanan_diminta=4_500_000)
    assert set(h["sumber"]) == {"sewa", "harga_rata_rata"}
    assert h["sumber"]["sewa"] == "pengguna"
    assert h["sumber"]["harga_rata_rata"] is None


def test_simulasi_rumus_mengikuti_asal_angkanya():
    """Menampilkan 'harga sewa per m2 x luas' padahal sewanya diketik orang
    membuat pembacanya mencari angka yang tidak pernah dipakai."""
    diisi = _simulasi(sewa_bulanan_diminta=4_500_000, harga_rata_rata=25_000)
    assert "Anda isi" in diisi["rumus"]["sewa_bulanan"]
    assert "Anda isi" in diisi["rumus"]["pembeli_impas_per_hari"]

    dari_data = _simulasi(variabel={"harga_sewa_per_m2": 200_000})
    assert "per m" in dari_data["rumus"]["sewa_bulanan"]


def test_simulasi_sewa_per_m2_tersirat_hanya_saat_diisi_sendiri():
    """Gunanya menyandingkan penawaran dengan sewa terukur - dan itu cuma
    berarti kalau penawarannya memang datang dari luar basis data."""
    diisi = _simulasi(sewa_bulanan_diminta=4_500_000)
    assert diisi["hasil"]["sewa_per_m2_tersirat"] == 250_000  # 4,5jt / 18 m2

    dari_data = _simulasi(variabel={"harga_sewa_per_m2": 200_000})
    assert dari_data["hasil"]["sewa_per_m2_tersirat"] is None


def test_simulasi_omzet_tetap_menuntut_data():
    """Yang boleh diisi sendiri cuma dua. Omzet - berapa uang yang berputar di
    heksagon itu - bukan sesuatu yang bisa dijawab siapa pun dari kursinya, dan
    membiarkannya diisi akan mengubah simulasi jadi mesin pembenar."""
    h = _simulasi(sewa_bulanan_diminta=4_500_000, harga_rata_rata=25_000)
    assert h["hasil"]["omzet_bulanan"] is None
    assert h["hasil"]["pangsa_impas_persen"] is None
    assert "TANPA_DATA_BELANJA" in {p["kode"] for p in h["peringatan"]}

# --- Kamus Data ------------------------------------------------------------


def test_43_variabel():
    assert len(SEMUA_VARIABEL) == 43, f"harusnya 43, ada {len(SEMUA_VARIABEL)}"
    assert len(set(SEMUA_VARIABEL)) == 43, "ada variabel yang terdaftar dua kali"


def test_variabel_pricelens_ada():
    assert "harga_sewa_per_m2" in DIMENSI["biaya"]
    assert "belanja_per_jam" in DIMENSI["perilaku"]


def test_dimensi_cocok_dengan_model():
    """Setiap variabel di DIMENSI harus benar-benar ada sebagai kolom."""
    from app.models import HexFeature

    kolom = {c.name for c in HexFeature.__table__.columns}
    hilang = [v for v in SEMUA_VARIABEL if v not in kolom]
    assert not hilang, f"ada di DIMENSI tapi tidak ada di tabel: {hilang}"


# --- Alat AI ---------------------------------------------------------------


def test_setiap_alat_backend_punya_implementasi():
    """Alat yang dideklarasikan ke model tapi tidak ada fungsinya akan gagal
    di tengah percakapan, bukan saat start."""
    nama_alat = {a["name"] for a in ALAT_BACKEND}
    assert nama_alat == set(REGISTRI), (
        f"tidak cocok - hanya di alat: {nama_alat - set(REGISTRI)}, "
        f"hanya di registri: {set(REGISTRI) - nama_alat}"
    )


def test_alat_peta_tidak_punya_implementasi_backend():
    """Aksi peta TIDAK boleh dieksekusi backend - kalau flyTo jalan di server,
    tidak ada yang bergerak di layar pengguna."""
    for a in ALAT_FRONTEND:
        assert a["name"] not in REGISTRI, f"{a['name']} tidak boleh ada di REGISTRI"
    assert {a["name"] for a in ALAT_FRONTEND} == NAMA_FRONTEND


def test_skema_alat_strict_valid():
    """Mode strict mensyaratkan additionalProperties false dan seluruh properti
    masuk required. Skema yang melanggar ditolak API, bukan diabaikan."""
    for a in ALAT_BACKEND + ALAT_FRONTEND:
        sk = a["input_schema"]
        assert a.get("strict") is True, f"{a['name']} tidak strict"
        assert sk["additionalProperties"] is False, f"{a['name']} tidak menutup properti"
        assert set(sk["required"]) == set(sk["properties"]), (
            f"{a['name']}: required tidak memuat seluruh properti"
        )
        assert a["description"], f"{a['name']} tanpa deskripsi - model tidak akan tahu kapan memakainya"


def test_filter_dibungkus_jadi_kriteria():
    """Frontend menerima filter sebagai satu objek `kriteria`; model mengirimnya
    datar supaya skemanya bisa strict. Pembungkusan terjadi di backend."""
    hasil = _argumen_peta("filter", {"min_score": 70, "kuadran": None})
    assert hasil == {"kriteria": {"min_score": 70}}


def test_argumen_none_dibuang():
    """Mode strict membuat model mengirim null untuk parameter yang tidak dipakai.
    Meneruskannya apa adanya akan menimpa nilai bawaan fungsi dengan None."""
    assert _argumen_peta("flyTo", {"lat": -6.2, "lon": 106.8, "zoom": None}) == {
        "lat": -6.2,
        "lon": 106.8,
    }


def test_kawasan_sama_di_tiga_berkas():
    """Backend, pipeline, dan frontend adalah tiga proses yang tidak bisa saling
    impor, jadi daftar kawasan terpaksa ditulis tiga kali. Yang menjaganya tetap
    sama hanya uji ini.

    Kalau satu daftar berubah tanpa yang lain, gejalanya halus: peta menawarkan
    kawasan yang backend tolak, atau pipeline memproses kawasan yang tidak pernah
    bisa ditampilkan.
    """
    from app.core.aturan import KAWASAN_PILOT

    akar = Path(__file__).resolve().parents[2]

    pipeline_py = (akar / "pipeline" / "config.py").read_text(encoding="utf-8")
    for k in KAWASAN_PILOT:
        assert f'"{k}"' in pipeline_py, f"'{k}' tidak ada di pipeline/config.py"

    frontend_ts = (akar / "frontend" / "src" / "config.ts").read_text(encoding="utf-8")
    for k in KAWASAN_PILOT:
        assert f"'{k}'" in frontend_ts, f"'{k}' tidak ada di frontend/src/config.ts"

    assert len(KAWASAN_PILOT) == 6


def test_arti_variabel_lengkap_dan_sama_dengan_frontend():
    """Kamus bahasa awam ditulis dua kali - backend untuk PDF, frontend untuk
    layar - karena keduanya proses terpisah. Uji ini satu-satunya yang menjaga
    keduanya tidak berpisah.

    Kalau berpisah, gejalanya tidak pernah berupa galat: satu variabel tampil
    sebagai "n_kompetitor_langsung" di layar sementara PDF-nya menulis "Pesaing
    sejenis", dan pembacanya mengira itu dua hal yang berbeda.
    """
    from app.api.bersama import SEMUA_VARIABEL
    from app.core.aturan import ARTI_INDEKS, ARTI_KODE, ARTI_VARIABEL

    kurang = set(SEMUA_VARIABEL) - set(ARTI_VARIABEL)
    lebih = set(ARTI_VARIABEL) - set(SEMUA_VARIABEL)
    assert not kurang, f"variabel tanpa nama awam: {sorted(kurang)}"
    assert not lebih, f"nama awam untuk variabel yang tidak ada: {sorted(lebih)}"
    assert len(ARTI_KODE) == 43, "kode variabel harus unik satu per satu"
    assert set(ARTI_INDEKS) == {"IPT", "IAE", "IKP", "IBR"}

    akar = Path(__file__).resolve().parents[2]
    ts = (akar / "frontend" / "src" / "config.ts").read_text(encoding="utf-8")
    for kolom, (kode, nama, satuan) in ARTI_VARIABEL.items():
        baris = f"{kolom}: {{ kode: '{kode}', nama: '{nama}', satuan: '{satuan}' }}"
        assert baris in ts, f"frontend/src/config.ts tidak memuat: {baris}"


def test_kode_lokasi_terbaca_dan_tidak_bentrok():
    """Nama heksagon harus stabil, dan rumusnya harus sama dengan frontend.

    Sifat yang paling penting: TANPA KEADAAN. Nomor urut akan bergeser tiap kali
    satu heksagon masuk, termasuk nomor yang sudah tercetak di Laporan Kelayakan
    milik orang.
    """
    from app.core.aturan import kode_lokasi

    assert kode_lokasi("898c1079dd7ffff", "Manggarai") == "Manggarai-40407"
    assert kode_lokasi("898c104c5a7ffff", "Bekasi") == "Bekasi-50599"
    # Sel bertetangga - potongan yang dipakai harus membedakan keduanya.
    assert kode_lokasi("898c1079dd7ffff", "M") != kode_lokasi("898c1079ddbffff", "M")

    akar = Path(__file__).resolve().parents[2]
    ts = (akar / "frontend" / "src" / "config.ts").read_text(encoding="utf-8")
    assert "parseInt(h3.slice(7, 11), 16)" in ts, "rumus kodeLokasi frontend bergeser"
    assert "padStart(5, '0')" in ts


def test_menit_jalan_kosong_tetap_kosong():
    from app.core.aturan import KECEPATAN_JALAN_M_PER_MENIT, menit_jalan

    assert menit_jalan(None) is None
    assert menit_jalan(0) == 0.0
    assert menit_jalan(KECEPATAN_JALAN_M_PER_MENIT * 5) == 5.0


def test_jam_operasional_sama_dengan_pipeline():
    """Pipeline mengisi tabel profil jam, backend menyajikannya. Kalau rentangnya
    berbeda, sebagian jam akan hilang tanpa ada yang menyadari."""
    from app.core.aturan import JAM_MULAI, JAM_SELESAI

    akar = Path(__file__).resolve().parents[2]
    pipeline_py = (akar / "pipeline" / "config.py").read_text(encoding="utf-8")
    assert f"JAM_MULAI, JAM_SELESAI = {JAM_MULAI}, {JAM_SELESAI}" in pipeline_py


def test_prompt_melarang_menghitung():
    from app.api.ai import PROMPT_SISTEM

    isi = PROMPT_SISTEM.lower()
    assert "tidak pernah menghitung" in isi
    assert "cek_zona" in isi, "prompt harus mewajibkan pemeriksaan zonasi"


# --- "Sedikit pesaing" tidak boleh lahir dari peta yang kosong -------------
#
# C01 bersumber OpenStreetMap, dan nol di sana punya dua arti yang tidak bisa
# dibedakan dari kolomnya: tidak ada pesaing, atau belum ada yang memetakan apa
# pun. Terukur 26 Agu 2026: 312 dari 708 heksagon ber-C01 nol, sebarannya
# mengikuti kerapatan PEMETAAN dan bukan kerapatan usaha.


class _Hex:
    """Heksagon dengan DUA kolom terisi dan sisanya kosong.

    `__getattr__` mengembalikan None untuk kolom apa pun yang tidak disebut,
    supaya uji ini tidak ikut merah setiap kali `_alasan_untuk` membaca kolom
    baru. Yang diuji di sini satu aturan, bukan daftar kolomnya - dan stub yang
    harus diperbarui tiap ada kolom baru akan berhenti diperbarui."""

    def __init__(self, c01, c02):
        self.n_kompetitor_langsung = c01
        self.kepadatan_poi_total = c02

    def __getattr__(self, nama):
        return None


def _kode(hx):
    from app.api.skor import _alasan_untuk

    return {a.kode for a in _alasan_untuk(hx, None, None, None)}


def test_sepi_pesaing_muncul_kalau_petanya_tahu_sesuatu():
    """Tiga usaha terpetakan, satu sekelas induk -> temuan yang sah."""
    assert "SEPI_PESAING" in _kode(_Hex(c01=1, c02=3))


def test_sepi_pesaing_tidak_muncul_kalau_nol_usaha_terpetakan():
    """Nol dari nol bukan temuan, melainkan lubang data - dan menyodorkannya
    sebagai alasan memilih lokasi persis 'Hidden Gem palsu'."""
    assert "SEPI_PESAING" not in _kode(_Hex(c01=0, c02=0))


def test_sepi_pesaing_tidak_muncul_kalau_poi_belum_dihitung():
    """`None` bukan nol: heksagon yang belum pernah dilewati agregasi OSM."""
    assert "SEPI_PESAING" not in _kode(_Hex(c01=0, c02=None))


def test_sepi_pesaing_tetap_diam_untuk_pesaing_banyak():
    assert "SEPI_PESAING" not in _kode(_Hex(c01=40, c02=90))


if __name__ == "__main__":
    lolos = gagal = 0
    for nama, fn in sorted(globals().items()):
        if not nama.startswith("test_"):
            continue
        try:
            fn()
            print(f"  PASS  {nama}")
            lolos += 1
        except AssertionError as e:
            print(f"  FAIL  {nama}: {e}")
            gagal += 1
    print(f"\n{lolos} lolos, {gagal} gagal")
    raise SystemExit(1 if gagal else 0)
