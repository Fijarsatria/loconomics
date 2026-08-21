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


def test_churn_kosong_tidak_meledak():
    assert tingkat_risiko_churn(None, 0.4, 0.7) == "AMAN"
    assert tingkat_risiko_churn(0.9, None, None) == "AMAN"


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


def test_prompt_melarang_menghitung():
    from app.api.ai import PROMPT_SISTEM

    isi = PROMPT_SISTEM.lower()
    assert "tidak pernah menghitung" in isi
    assert "cek_zona" in isi, "prompt harus mewajibkan pemeriksaan zonasi"


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
