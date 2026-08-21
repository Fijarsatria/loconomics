"""Uji loop agentik AI Consultant dengan klien tiruan.

    cd backend && python tests/test_ai_loop.py

Tanpa kunci API dan tanpa jaringan. Yang diuji bukan kualitas jawaban model -
itu tidak bisa diuji otomatis - melainkan logika di sekitarnya, yang justru
paling mudah rusak tanpa ketahuan:

  - aksi peta TIDAK dieksekusi backend, hanya diteruskan
  - alat backend dieksekusi dan hasilnya kembali ke model
  - alat yang gagal tidak mematikan percakapan
  - penolakan klasifikator ditangani sebelum membaca isi balasan
  - loop berhenti, tidak berputar selamanya

Kalau salah satu rusak, gejalanya di produksi halus: peta tidak bergerak, atau
jawaban keluar tanpa angka. Keduanya baru ketahuan saat demo.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api import ai
from app.core import batas
from app.models import HexFeature
from app.schemas import PermintaanAI, PesanRiwayat

lolos = gagal = 0


def cek(nama: str, syarat: bool, catatan: str = "") -> None:
    global lolos, gagal
    if syarat:
        print(f"  PASS  {nama}")
        lolos += 1
    else:
        print(f"  FAIL  {nama} {catatan}")
        gagal += 1


# --- Tiruan minimal ---------------------------------------------------------


class Blok:
    def __init__(self, type, **kw):
        self.type = type
        for k, v in kw.items():
            setattr(self, k, v)


class Balasan:
    def __init__(self, content, stop_reason):
        self.content = content
        self.stop_reason = stop_reason
        self.usage = Blok("usage", input_tokens=1200, output_tokens=300)


class KlienTiruan:
    """Memutar balasan yang sudah disiapkan, satu per panggilan."""

    def __init__(self, urutan):
        self.urutan = list(urutan)
        self.dipanggil = 0
        self.pesan_terakhir = None
        self.messages = self

    def create(self, **kw):
        self.dipanggil += 1
        self.pesan_terakhir = kw["messages"]
        self.tools_terakhir = kw["tools"]
        return self.urutan.pop(0)


class HasilTiruan:
    def __init__(self, nilai):
        self.nilai = nilai

    def scalar_one(self):
        return self.nilai


class DbTiruan:
    """Cukup untuk alat yang dipakai di berkas ini. Tidak menyentuh basis data."""

    def __init__(self, hex_row=None, biaya_hari_ini=0.0):
        self.hex_row = hex_row
        self.biaya = biaya_hari_ini
        self.ditambahkan = []
        self.commit_dipanggil = 0

    def get(self, model, kunci):
        return self.hex_row

    def execute(self, *a, **kw):
        # Satu-satunya query yang lewat sini adalah penjumlahan biaya harian.
        return HasilTiruan(self.biaya)

    def add(self, obj):
        self.ditambahkan.append(obj)

    def commit(self):
        self.commit_dipanggil += 1


def hex_contoh(dilarang: bool = False) -> HexFeature:
    return HexFeature(
        h3_index="89aitest0001",
        kawasan="Manggarai",
        zona_izin_komersial=False if dilarang else True,
        kelas_zona="R-3" if dilarang else "K-1",
        n_titik_misi=34,
        tingkat_keyakinan="TINGGI",
        data_source="observed",
    )


def pasang(monkey_urutan):
    """Ganti klien asli dengan tiruan. Dikembalikan supaya bisa diperiksa.

    Pembatas laju juga dikosongkan: uji di berkas ini memanggil tanya() lebih
    dari sepuluh kali, dan tanpa ini uji terakhir akan gagal karena terblokir
    oleh uji sebelumnya - kegagalan yang menyesatkan.
    """
    batas.lupakan()
    k = KlienTiruan(monkey_urutan)
    ai.klien = lambda: k  # type: ignore[assignment]
    return k


ASLI = ai.klien


def pulihkan():
    ai.klien = ASLI  # type: ignore[assignment]


# --- Uji --------------------------------------------------------------------


def test_aksi_peta_tidak_dieksekusi_backend():
    """flyTo harus mendarat di aksi_peta, bukan dijalankan di server.

    Kalau dieksekusi backend, tidak ada yang bergerak di layar pengguna -
    dan ketentuan C.2 justru meminta keluaran AI yang mendarat di peta.
    """
    k = pasang([
        Balasan(
            [
                Blok("tool_use", id="t1", name="cek_zona", input={"hex_id": "89aitest0001"}),
                Blok("tool_use", id="t2", name="flyTo", input={"lat": -6.21, "lon": 106.84, "zoom": 15}),
                Blok("tool_use", id="t3", name="setLayer", input={"nama_layer": "pricelens"}),
            ],
            "tool_use",
        ),
        Balasan([Blok("text", text="Zona di lokasi itu mengizinkan usaha.")], "end_turn"),
    ])
    db = DbTiruan(hex_contoh())
    jawab = ai.tanya(PermintaanAI(pertanyaan="Boleh buka usaha di sana?"), db, None)
    pulihkan()

    nama_aksi = [a.fungsi for a in jawab.aksi_peta]
    cek("flyTo diteruskan ke aksi_peta", "flyTo" in nama_aksi)
    cek("setLayer diteruskan ke aksi_peta", "setLayer" in nama_aksi)
    cek("cek_zona TIDAK ikut ke aksi_peta", "cek_zona" not in nama_aksi)
    cek("argumen flyTo utuh", jawab.aksi_peta[0].argumen["lat"] == -6.21)
    cek("teks akhir terbaca", "mengizinkan" in jawab.teks)
    cek("loop berhenti setelah end_turn", k.dipanggil == 2, f"- {k.dipanggil} panggilan")


def test_alat_backend_hasilnya_kembali_ke_model():
    """Model harus MENERIMA angka, bukan mengarangnya."""
    k = pasang([
        Balasan(
            [Blok("tool_use", id="t1", name="cek_zona", input={"hex_id": "89aitest0001"})],
            "tool_use",
        ),
        Balasan([Blok("text", text="Zona di sana melarang usaha.")], "end_turn"),
    ])
    db = DbTiruan(hex_contoh(dilarang=True))
    jawab = ai.tanya(PermintaanAI(pertanyaan="Boleh buka usaha?"), db, None)
    pulihkan()

    # Pesan terakhir yang dikirim ke model harus memuat hasil alat
    hasil = [
        b for m in k.pesan_terakhir if isinstance(m.get("content"), list)
        for b in m["content"] if isinstance(b, dict) and b.get("type") == "tool_result"
    ]
    cek("hasil alat dikirim balik ke model", len(hasil) == 1)
    cek("hasil memuat status zonasi sebenarnya", "DILARANG" in hasil[0]["content"])
    cek("jejak mencatat pemanggilan", any(j.fungsi == "cek_zona" for j in jawab.jejak))
    cek("model tercatat di jawaban", jawab.model is not None)


def test_alat_gagal_tidak_mematikan_percakapan():
    """Heksagon tidak ditemukan harus jadi tool_result is_error, bukan 500."""
    k = pasang([
        Balasan(
            [Blok("tool_use", id="t1", name="cek_harga", input={"hex_id": "tidak_ada"})],
            "tool_use",
        ),
        Balasan([Blok("text", text="Maaf, lokasi itu tidak saya temukan.")], "end_turn"),
    ])
    db = DbTiruan(None)  # get() mengembalikan None -> ValueError di dalam alat
    jawab = ai.tanya(PermintaanAI(pertanyaan="Harga di situ berapa?"), db, None)
    pulihkan()

    hasil = [
        b for m in k.pesan_terakhir if isinstance(m.get("content"), list)
        for b in m["content"] if isinstance(b, dict) and b.get("type") == "tool_result"
    ]
    cek("kegagalan alat ditandai is_error", hasil and hasil[0].get("is_error") is True)
    cek("jejak mencatat kegagalannya", any("gagal" in j.ringkas_hasil for j in jawab.jejak))
    cek("percakapan tetap selesai", bool(jawab.teks))


def test_penolakan_klasifikator_ditangani():
    """stop_reason 'refusal' datang dengan HTTP 200 tapi tanpa isi yang bisa dipakai.
    Harus diperiksa SEBELUM membaca content."""
    from app.core.galat import KesalahanAPI

    pasang([Balasan([], "refusal")])
    try:
        ai.tanya(PermintaanAI(pertanyaan="..."), DbTiruan(), None)
        cek("penolakan jadi galat beramplop", False, "- tidak dilempar")
    except KesalahanAPI as e:
        cek("penolakan jadi galat beramplop", e.status_code == 400, f"- dapat {e.status_code}")
        cek("pesannya bisa ditindaklanjuti", "ubah kalimatnya" in e.pesan)
    finally:
        pulihkan()


def test_tanpa_kunci_api_jadi_501():
    """Jujur bahwa belum siap, bukan jawaban palsu."""
    from app.core.galat import LayananBelumSiap
    from app.core.llm import LLMBelumSiap

    def tolak():
        raise LLMBelumSiap("LLM_API_KEY belum diisi")

    batas.lupakan()
    ai.klien = tolak  # type: ignore[assignment]
    try:
        ai.tanya(PermintaanAI(pertanyaan="halo"), DbTiruan(), None)
        cek("tanpa kunci jadi 501", False, "- tidak dilempar")
    except LayananBelumSiap as e:
        cek("tanpa kunci jadi 501", e.status_code == 501, f"- dapat {e.status_code}")
        cek("pesannya menyebut apa yang kurang", "LLM_API_KEY" in e.pesan)
    finally:
        pulihkan()


def test_batas_putaran_dihormati():
    """Model yang terus memanggil alat tidak boleh membuat loop tak berujung."""
    from app.core.llm import MAKS_PUTARAN

    selalu_alat = [
        Balasan(
            [Blok("tool_use", id=f"t{i}", name="cek_zona", input={"hex_id": "89aitest0001"})],
            "tool_use",
        )
        for i in range(MAKS_PUTARAN + 3)
    ]
    k = pasang(selalu_alat)
    db = DbTiruan(hex_contoh())
    jawab = ai.tanya(PermintaanAI(pertanyaan="terus"), db, None)
    pulihkan()

    cek("berhenti tepat di batas", k.dipanggil == MAKS_PUTARAN, f"- {k.dipanggil}")
    cek("tetap mengembalikan jawaban, bukan meledak", bool(jawab.teks))


def test_pencatatan_ai_call_log():
    """Setiap panggilan tercatat - ketentuan C.1 soal jejak audit."""
    pasang([Balasan([Blok("text", text="Halo.")], "end_turn")])
    db = DbTiruan()
    ai.tanya(PermintaanAI(pertanyaan="halo"), db, None)
    pulihkan()

    cek("satu baris log ditulis", len(db.ditambahkan) == 1)
    log = db.ditambahkan[0]
    cek("log menandai fitur B1", log.fitur == "B1")
    cek("log mencatat biaya", log.biaya_usd is not None and log.biaya_usd > 0)
    cek(
        "jawaban tanpa panggilan alat ditandai perlu ditinjau",
        log.perlu_review is True,
        "- jawaban tanpa alat berarti angkanya tidak bersumber",
    )


def test_konteks_hex_terpilih_ikut():
    k = pasang([Balasan([Blok("text", text="Baik.")], "end_turn")])
    db = DbTiruan(hex_contoh())
    jawab = ai.tanya(
        PermintaanAI(pertanyaan="Bagaimana menurutmu?", hex_terpilih="89aitest0001"), db, None
    )
    pulihkan()

    isi_awal = k.pesan_terakhir[0]["content"]
    cek("heksagon terpilih masuk konteks", "89aitest0001" in isi_awal)
    cek("badge keyakinan ikut di jawaban", jawab.keyakinan is not None)
    cek("badge memakai angka sebenarnya", jawab.keyakinan.n_titik_misi == 34)


def test_pembatas_laju_menahan_banjir():
    """Satu useEffect yang salah di frontend cukup untuk memanggil ini berkali-kali."""
    from app.core.galat import TerlaluBanyakPermintaan

    batas.lupakan()
    urutan = [Balasan([Blok("text", text="ok")], "end_turn") for _ in range(30)]
    k = KlienTiruan(urutan)
    ai.klien = lambda: k  # type: ignore[assignment]

    class Req:
        headers = {"x-forwarded-for": "9.9.9.9"}
        client = None

    terpanggil = 0
    ditolak = False
    try:
        for _ in range(batas.MAKS_PERMINTAAN + 3):
            ai.tanya(PermintaanAI(pertanyaan="halo"), DbTiruan(), Req())  # type: ignore[arg-type]
            terpanggil += 1
    except TerlaluBanyakPermintaan:
        ditolak = True
    finally:
        pulihkan()
        batas.lupakan()

    cek("banjir permintaan ditolak", ditolak)
    cek(
        "ditolak tepat setelah batas",
        terpanggil == batas.MAKS_PERMINTAAN,
        f"- lolos {terpanggil}, batas {batas.MAKS_PERMINTAAN}",
    )


def test_plafon_biaya_menahan():
    """Diperiksa SEBELUM model dipanggil - memeriksa sesudah berarti plafon
    selalu terlampaui minimal satu panggilan."""
    from app.core.galat import AnggaranHabis

    k = pasang([Balasan([Blok("text", text="ok")], "end_turn")])
    db = DbTiruan(biaya_hari_ini=999.0)
    try:
        ai.tanya(PermintaanAI(pertanyaan="halo"), db, None)
        cek("plafon habis menahan permintaan", False, "- lolos")
    except AnggaranHabis:
        cek("plafon habis menahan permintaan", True)
        cek("model TIDAK ikut dipanggil", k.dipanggil == 0, f"- dipanggil {k.dipanggil}x")
    finally:
        pulihkan()


def test_riwayat_diputar_ulang():
    """Panel chat butuh banyak giliran. Riwayat dikirim frontend, bukan disimpan
    server - backend tetap tanpa-status."""
    k = pasang([Balasan([Blok("text", text="Baik.")], "end_turn")])
    ai.tanya(
        PermintaanAI(
            pertanyaan="Kalau yang kedua?",
            riwayat=[
                PesanRiwayat(peran="pengguna", teks="Mana lokasi terbaik?"),
                PesanRiwayat(peran="asisten", teks="Yang pertama 89abc."),
            ],
        ),
        DbTiruan(),
        None,
    )
    pulihkan()

    peran = [m["role"] for m in k.pesan_terakhir]
    cek("riwayat ikut dikirim", len(k.pesan_terakhir) == 3, f"- {len(k.pesan_terakhir)} pesan")
    cek("urutan peran benar", peran == ["user", "assistant", "user"], f"- {peran}")
    cek("giliran lama isinya utuh", "89abc" in k.pesan_terakhir[1]["content"])


def test_riwayat_diawali_asisten_dibuang():
    """Percakapan tidak boleh diawali giliran asisten - API menolaknya."""
    k = pasang([Balasan([Blok("text", text="ok")], "end_turn")])
    ai.tanya(
        PermintaanAI(
            pertanyaan="lanjut",
            riwayat=[PesanRiwayat(peran="asisten", teks="Halo, ada yang bisa dibantu?")],
        ),
        DbTiruan(),
        None,
    )
    pulihkan()
    cek("giliran asisten di awal dibuang", k.pesan_terakhir[0]["role"] == "user")


def test_semua_alat_dikirim_ke_model():
    k = pasang([Balasan([Blok("text", text="ok")], "end_turn")])
    ai.tanya(PermintaanAI(pertanyaan="halo"), DbTiruan(), None)
    pulihkan()
    nama = {a["name"] for a in k.tools_terakhir}
    cek("12 alat dikirim", len(nama) == 12, f"- {len(nama)}")
    cek("alat peta ikut dideklarasikan", ai.NAMA_FRONTEND <= nama)


if __name__ == "__main__":
    for nama, fn in sorted(globals().items()):
        if nama.startswith("test_"):
            fn()
    print(f"\n{lolos} lolos, {gagal} gagal")
    raise SystemExit(1 if gagal else 0)
