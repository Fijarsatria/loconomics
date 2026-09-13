"""Adapter Gemini yang berbicara dalam bentuk Anthropic Messages.

KENAPA ADAPTER, BUKAN MENULIS ULANG `api/ai.py`
===============================================

`app/api/ai.py` memuat loop agentik lengkap: delapan putaran, dua belas alat,
penjaga tingkat akun, pencatatan biaya, dan penerjemahan aksi peta. Seluruhnya
berbicara dalam bentuk Anthropic - `balasan.content` berisi blok bertipe
`tool_use`, giliran berikutnya membawa `tool_result` ber-`tool_use_id`.

Menulis ulang loop itu untuk bentuk Gemini berarti menyentuh satu-satunya
berkas di backend yang membelanjakan uang sungguhan, pada malam sebelum
pameran. Adapter ini menyentuh nol baris di sana.

Docstring `llm.py` sudah menjanjikannya sejak awal: "Kalau penyedia diganti,
hanya berkas ini yang berubah." Berkas ini yang menepatinya.

YANG DITERJEMAHKAN, DAN KENAPA TIDAK SEKADAR MENGGANTI NAMA BIDANG
==================================================================

Tiga hal yang bentuknya benar-benar berbeda, bukan cuma beda nama:

  SKEMA ALAT   Anthropic menerima JSON Schema apa adanya, termasuk tipe union
               `["string", "null"]` dan bendera `strict`. Gemini MENOLAK
               keduanya - ia memakai bagian kecil OpenAPI, tempat "boleh null"
               dinyatakan `nullable: true` dan tipenya tunggal. Dua belas alat
               di repo ini semuanya memakai tipe union, jadi tanpa pembersihan
               ini tidak satu pun alat bisa didaftarkan.

  ID PANGGILAN Anthropic memberi tiap panggilan alat sebuah `id`, dan hasilnya
               dikembalikan dengan `tool_use_id` yang sama. Gemini tidak
               memberi id sama sekali - hasil dicocokkan lewat NAMA fungsi.
               Id di sini karena itu DIBUAT, dengan namanya disisipkan di
               dalamnya, supaya ia bisa dibaca kembali saat hasilnya pulang.

  PERAN        Anthropic memakai "assistant"; Gemini memakai "model".

BIAYANYA BUKAN NOL, DAN ITU TETAP DICATAT
=========================================

`biaya_usd()` di `llm.py` menghitung dengan tarif Claude Opus. Untuk Gemini
Flash tarifnya jauh lebih murah, dan angka yang salah di kolom biaya lebih
buruk daripada angka yang kasar tetapi benar arahnya - plafon harian dihitung
darinya. Tarifnya ikut di sini.
"""

from __future__ import annotations

import json
import logging
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger(__name__)

URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

#: Model cadangan, dicoba berurutan kalau yang diminta terus-menerus 503.
#:
#: Terukur 3 September 2026, dalam satu menit yang sama:
#:      gemini-flash-latest       503
#:      gemini-3-flash-preview    200
#:      gemini-flash-lite-latest  200
#:
#: Jadi 503 di sini bukan "Gemini sedang padam" melainkan "MODEL ITU sedang
#: penuh" - dan pindah model menyelesaikannya seketika. Untuk pameran, tempat
#: yang menjalankan demo tidak bisa membuka log dan mengganti .env, kemampuan
#: berpindah sendiri itu bedanya antara fitur yang jalan dan fitur yang mati
#: di depan penonton.
#:
#: Yang diminta lewat LLM_MODEL selalu dicoba PERTAMA; daftar ini cuma jaring.
MODEL_CADANGAN = ("gemini-3-flash-preview", "gemini-flash-lite-latest", "gemini-flash-latest")

#: Sekat atas untuk menunggu di tengah satu permintaan. Orangnya sedang berdiri
#: di depan layar; menunggu sepuluh detik masih terasa seperti "sedang
#: berpikir", menunggu semenit terasa seperti rusak.
TUNGGU_MAKS_DETIK = 10.0


def lama_menunggu(rinci: str) -> float | None:
    """Berapa detik yang DIMINTA penyedianya, dari balasan 429-nya sendiri.

    Balasan Google membawa angkanya dua kali: sebagai `retryDelay` di dalam
    `details[].RetryInfo`, dan sebagai kalimat "Please retry in 1.93s" di
    pesannya. Yang kedua dibaca sebagai cadangan karena bentuk `details`
    berubah-ubah antar versi API sementara kalimatnya sudah bertahan lama.

    Kenapa ini penting sampai perlu fungsinya sendiri: tanpa membacanya, satu
    hambatan 20-permintaan-per-menit tidak bisa dibedakan dari jatah harian yang
    benar-benar habis - dan keduanya lalu diperlakukan sebagai yang terburuk.
    """
    try:
        badan = json.loads(rinci)
    except (ValueError, TypeError):
        badan = {}
    for d in (badan.get("error", {}) or {}).get("details", []) or []:
        nilai = str(d.get("retryDelay") or "")
        if nilai.endswith("s"):
            try:
                return float(nilai[:-1])
            except ValueError:
                pass
    cocok = re.search(r"retry in ([0-9.]+)\s*s", rinci, re.IGNORECASE)
    return float(cocok.group(1)) if cocok else None


def batas_harian(rinci: str) -> bool:
    """Apakah 429-nya jatah HARIAN, bukan hambatan per menit.

    Dibaca dari `details[].violations[].quotaId` lebih dulu - diukur 13 Sep
    2026, jatah harian bernama `GenerateRequestsPerDayPerProjectPerModel-FreeTier`
    sementara KALIMAT pesannya tidak menyebut "per day" sama sekali. Membaca
    kalimatnya saja membuat jatah harian yang habis tampil sebagai "coba lagi
    dua detik lagi". Kalimat tetap diperiksa sebagai cadangan.
    """
    try:
        badan = json.loads(rinci)
    except (ValueError, TypeError):
        badan = {}
    for d in (badan.get("error", {}) or {}).get("details", []) or []:
        for v in d.get("violations", []) or []:
            if "perday" in str(v.get("quotaId", "")).lower():
                return True
    return "perday" in rinci.replace(" ", "").lower()


#: Berapa lama pasangan (kunci, model) yang jatah HARIANNYA habis dilewati
#: sebelum dicoba lagi. Sejam, bukan sampai tengah malam Pasifik: menghitung
#: zona waktu Pasifik di Windows menuntut paket tzdata, dan satu 429 per jam
#: yang cepat jauh lebih murah daripada satu dependensi baru.
JEDA_HARIAN_DETIK = 60 * 60

#: Pasangan (urutan kunci, model) -> kapan boleh dicoba lagi. Milik PROSES,
#: bukan permintaan: yang membuat perpindahan kunci "cepat" adalah tidak
#: mengetuk pintu yang sudah diketahui tertutup pada setiap pertanyaan.
#: Kuncinya URUTAN, bukan nilai kunci API - nilai kunci tidak pernah boleh
#: jadi bagian dari apa pun yang bisa masuk log.
_dilewati_sampai: dict[tuple[int, str], float] = {}


def lupakan_jatah() -> None:
    """Kosongkan catatan pasangan yang dilewati. Dipakai uji."""
    _dilewati_sampai.clear()


#: Tarif Gemini Flash per Juni 2026, USD per juta token. Dipakai `biaya_usd`.
TARIF_MASUK = 0.30
TARIF_KELUAR = 2.50

#: Kata kunci JSON Schema yang Gemini terima. Sisanya dibuang, bukan
#: diterjemahkan: `additionalProperties`, `$schema`, dan `strict` tidak punya
#: padanan, dan mengirimnya menghasilkan 400 yang menyebut "Unknown name".
KUNCI_SKEMA = {"type", "description", "properties", "required", "items", "enum", "nullable"}


# ---------------------------------------------------------------------------
# Bentuk balasan - meniru objek Anthropic secukupnya
# ---------------------------------------------------------------------------


#: `tanda` adalah `thoughtSignature` milik Gemini, dan ia WAJIB dikembalikan.
#:
#: Model Gemini baru menyertakan tanda tangan penalaran pada tiap part yang
#: memuat panggilan fungsi. Saat percakapan dikirim ulang di putaran berikutnya,
#: tanda itu harus ikut - kalau tidak, Google menolak dengan 400:
#:
#:     "Function call is missing a thought_signature in functionCall parts.
#:      This is required for tools to work correctly."
#:
#: Ini yang membuat panggilan PERTAMA selalu berhasil sementara panggilan kedua
#: - yang membawa hasil alat - selalu 400. Gejalanya menyesatkan: seolah skema
#: alatnya salah, padahal skemanya benar dan yang hilang cuma satu string yang
#: dibuang saat menerjemahkan balasan.
@dataclass
class BlokTeks:
    text: str
    type: str = "text"
    tanda: str | None = None


@dataclass
class BlokAlat:
    id: str
    name: str
    input: dict[str, Any]
    type: str = "tool_use"
    tanda: str | None = None


@dataclass
class Pemakaian:
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass
class Balasan:
    content: list[Any] = field(default_factory=list)
    stop_reason: str = "end_turn"
    usage: Pemakaian = field(default_factory=Pemakaian)


# ---------------------------------------------------------------------------
# Penerjemah
# ---------------------------------------------------------------------------


def _bersihkan_skema(s: Any) -> Any:
    """JSON Schema Anthropic -> bagian OpenAPI yang dimengerti Gemini."""
    if not isinstance(s, dict):
        return s

    keluar: dict[str, Any] = {}
    for k, v in s.items():
        if k not in KUNCI_SKEMA:
            continue
        if k == "type":
            # `["string", "null"]` -> type STRING + nullable. Ini bentuk yang
            # dipakai SELURUH alat opsional di repo ini, jadi tanpa cabang ini
            # tidak ada satu pun alat yang bisa didaftarkan.
            if isinstance(v, list):
                nyata = [t for t in v if t != "null"]
                keluar["type"] = str(nyata[0]).upper() if nyata else "STRING"
                if len(nyata) < len(v):
                    keluar["nullable"] = True
            else:
                keluar["type"] = str(v).upper()
        elif k == "properties" and isinstance(v, dict):
            keluar["properties"] = {n: _bersihkan_skema(p) for n, p in v.items()}
        elif k == "items":
            keluar["items"] = _bersihkan_skema(v)
        else:
            keluar[k] = v
    return keluar


def _alat_gemini(tools: list[dict]) -> list[dict]:
    deklarasi = []
    for t in tools:
        skema = _bersihkan_skema(t.get("input_schema") or {})
        d: dict[str, Any] = {"name": t["name"], "description": t.get("description", "")}
        # Gemini menolak `parameters` yang kosong; alat tanpa argumen dikirim
        # tanpa bidang itu sama sekali.
        if skema.get("properties"):
            d["parameters"] = skema
        deklarasi.append(d)
    return [{"functionDeclarations": deklarasi}]


def _nama_dari_id(kode: str) -> str:
    """Id dibuat sebagai `panggil-<n>-<nama>`; namanya dibaca kembali di sini.

    Gemini mencocokkan hasil alat lewat NAMA, bukan id. Menyimpan peta id->nama
    di dalam objek klien akan bekerja untuk satu percakapan lalu bocor ke
    percakapan berikutnya begitu ada dua permintaan berbarengan - dan gagalnya
    diam: satu pengguna menerima hasil alat milik pengguna lain.
    """
    potong = kode.split("-", 2)
    return potong[2] if len(potong) == 3 else kode


def _isi_gemini(messages: list[dict]) -> list[dict]:
    """Giliran percakapan Anthropic -> `contents` Gemini."""
    isi: list[dict] = []
    for m in messages:
        peran = "model" if m["role"] == "assistant" else "user"
        badan = m["content"]

        if isinstance(badan, str):
            isi.append({"role": peran, "parts": [{"text": badan}]})
            continue

        parts: list[dict] = []
        for blok in badan:
            # Blok yang kita sendiri keluarkan di putaran sebelumnya.
            if isinstance(blok, BlokTeks):
                if blok.text:
                    bagian: dict[str, Any] = {"text": blok.text}
                    if blok.tanda:
                        bagian["thoughtSignature"] = blok.tanda
                    parts.append(bagian)
            elif isinstance(blok, BlokAlat):
                bagian = {"functionCall": {"name": blok.name, "args": blok.input}}
                if blok.tanda:
                    bagian["thoughtSignature"] = blok.tanda
                parts.append(bagian)
            elif isinstance(blok, dict) and blok.get("type") == "tool_result":
                nama = _nama_dari_id(str(blok.get("tool_use_id", "")))
                mentah = blok.get("content")
                # `response` Gemini WAJIB objek. Hasil alat kita string JSON,
                # jadi ia dibungkus - dan kalau ia bukan JSON yang sah (pesan
                # galat, misalnya) ia tetap dikirim sebagai teks, bukan dibuang.
                try:
                    badan_hasil = json.loads(mentah) if isinstance(mentah, str) else mentah
                    if not isinstance(badan_hasil, dict):
                        badan_hasil = {"hasil": badan_hasil}
                except (json.JSONDecodeError, TypeError):
                    badan_hasil = {"hasil": str(mentah)}
                if blok.get("is_error"):
                    badan_hasil = {"galat": str(mentah)}
                parts.append(
                    {"functionResponse": {"name": nama, "response": badan_hasil}}
                )
            elif isinstance(blok, dict) and blok.get("type") == "text":
                parts.append({"text": blok.get("text", "")})
        if parts:
            isi.append({"role": peran, "parts": parts})
    return isi


# ---------------------------------------------------------------------------
# Klien
# ---------------------------------------------------------------------------


class _Pesan:
    def __init__(self, kunci: str | list[str]) -> None:
        # Beberapa kunci, dicoba berurutan. Kunci kedua ada untuk satu hal:
        # jatah gratis Gemini dihitung PER PROYEK Google, jadi kunci dari
        # proyek lain membawa jatahnya sendiri. Kunci kedua dari proyek yang
        # SAMA tidak menambah apa pun - dan itu tidak bisa diketahui sebelum
        # dicoba, jadi keduanya tetap dicoba.
        daftar = [kunci] if isinstance(kunci, str) else list(kunci)
        self._kunci = [k for k in daftar if k]

    def create(
        self,
        *,
        model: str,
        max_tokens: int,
        system: str,
        tools: list[dict],
        messages: list[dict],
        **_,
    ) -> Balasan:
        badan = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": _isi_gemini(messages),
            "tools": _alat_gemini(tools),
            "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.4},
        }
        # Urutan model yang dicoba: yang diminta dulu, lalu cadangannya.
        # `dict.fromkeys` membuang duplikat tanpa mengacak urutannya.
        urutan = list(dict.fromkeys([model, *MODEL_CADANGAN]))
        muatan = json.dumps(badan).encode()
        # Dicoba ulang untuk galat SEMENTARA saja.
        #
        # Terukur 3 September 2026: `gemini-flash-latest` mengembalikan 503
        # berulang kali dalam hitungan detik, lalu melayani permintaan yang
        # sama persis dengan sempurna. Itu kelebihan beban di sisi Google,
        # bukan permintaan yang salah - dan satu 503 sesaat tidak boleh
        # mematikan pertanyaan orang yang sedang berdiri di depan layar.
        #
        # 400 dan 403 TIDAK dicoba ulang: permintaan yang salah bentuk atau
        # kunci yang ditolak akan salah lagi berapa kali pun diulang, dan
        # mengulangnya cuma memperlambat pesan galat yang benar.
        data = None
        # Lamanya-menunggu TERKECIL yang diminta penyedianya, dan apakah SEMUA
        # penolakan menyebut jatah harian. Dipakai di bawah untuk memutuskan
        # apakah menunggu sebentar masuk akal, dan kalimat mana yang tampil.
        minta_tunggu: float | None = None
        harian = True
        ada_tolakan = False

        def pasangan() -> list[tuple[int, str]]:
            """Model dulu, lalu kunci. Model terbaik dari kunci mana pun lebih
            berharga daripada model cadangan dari kunci pertama."""
            sekarang = time.time()
            return [
                (ik, m)
                for m in urutan
                for ik in range(len(self._kunci))
                if _dilewati_sampai.get((ik, m), 0.0) <= sekarang
            ]

        for putaran in range(2):
            for ik, m in pasangan():
                req = urllib.request.Request(
                    URL.format(model=m),
                    data=muatan,
                    headers={"Content-Type": "application/json", "X-goog-api-key": self._kunci[ik]},
                    method="POST",
                )
                for percobaan in range(2):
                    try:
                        with urllib.request.urlopen(req, timeout=90) as r:
                            data = json.load(r)
                        if (ik, m) != (0, model):
                            log.warning("Gemini dilayani kunci #%d, model %s", ik + 1, m)
                        break
                    except urllib.error.HTTPError as e:
                        rinci = e.read().decode("utf-8", "replace")[:4000]
                        if e.code == 429:
                            # Pindah ke pasangan berikutnya SEKETIKA, tanpa
                            # tidur: kunci lain atau model lain hampir selalu
                            # lebih cepat daripada menunggu yang ini pulih.
                            ada_tolakan = True
                            if batas_harian(rinci):
                                _dilewati_sampai[(ik, m)] = time.time() + JEDA_HARIAN_DETIK
                            else:
                                harian = False
                                diminta = lama_menunggu(rinci) or 2.0
                                _dilewati_sampai[(ik, m)] = time.time() + diminta
                                minta_tunggu = diminta if minta_tunggu is None else min(minta_tunggu, diminta)
                            log.warning("Gemini 429 pada kunci #%d model %s", ik + 1, m)
                            break
                        if e.code in (500, 502, 503, 504):
                            if percobaan == 0:
                                time.sleep(1.2)
                                continue
                            harian = False
                            ada_tolakan = True
                            log.warning("Gemini %s pada kunci #%d model %s", e.code, ik + 1, m)
                            break
                        if e.code == 404:
                            # Nama model ditarik Google - berlaku untuk semua kunci.
                            for k in range(len(self._kunci)):
                                _dilewati_sampai[(k, m)] = time.time() + JEDA_HARIAN_DETIK
                            break
                        if e.code == 403 or "API_KEY_INVALID" in rinci:
                            # KUNCI ini yang ditolak, bukan permintaannya. Kunci
                            # lain masih layak dicoba.
                            log.error("Gemini menolak kunci #%d (%s)", ik + 1, e.code)
                            for mm in urutan:
                                _dilewati_sampai[(ik, mm)] = time.time() + JEDA_HARIAN_DETIK
                            break
                        # 400 lainnya: permintaannya yang salah, dan akan salah
                        # lagi di kunci dan model mana pun. Rincinya ke LOG
                        # (aturan 8) - balasan Google memuat nama proyek.
                        log.error("Gemini menolak (%s) pada %s: %s", e.code, m, rinci[:400])
                        raise RuntimeError("Penyedia model menolak permintaan ini.") from e
                    except (urllib.error.URLError, TimeoutError) as e:
                        if percobaan == 0:
                            time.sleep(1.2)
                            continue
                        harian = False
                        ada_tolakan = True
                        log.warning("Gemini tidak terjangkau pada %s: %s", m, e)
                        break
                if data is not None:
                    break
            if data is not None:
                break
            # Putaran kedua HANYA kalau ada pasangan yang cuma diminta menunggu
            # sebentar. Jatah harian yang habis tidak pulih dalam sepuluh detik,
            # dan menidurkan permintaan untuknya cuma memperlambat kabar buruk.
            if putaran == 0 and minta_tunggu is not None and minta_tunggu <= TUNGGU_MAKS_DETIK:
                time.sleep(max(minta_tunggu, 0.5))
                continue
            break

        if data is None:
            log.error("Seluruh model Gemini gagal: %s", urutan)
            # Dicatat supaya `/ai/status` ikut tahu. Tanpa ini panel Konsultan
            # AI tetap mengaku siap sepanjang jatah harian habis, dan setiap
            # pengunjung menemukannya lewat pertanyaan yang gagal.
            from app.core.llm import tandai_penyedia_penuh

            # Jatah harian: tidak ada gunanya mencoba lagi sebentar lagi, jadi
            # jendela penuhnya yang panjang. Hambatan per menit: sependek yang
            # diminta penyedianya.
            tandai_penyedia_penuh(None if harian or minta_tunggu is None else minta_tunggu)
            # Kalimat yang sampai ke layar menyebut lamanya, kalau tahu.
            # "Coba lagi sebentar lagi" adalah kalimat yang sama untuk tunggu
            # sepuluh detik dan untuk jatah harian yang habis - dan yang
            # membacanya harus memutuskan hal yang berbeda di dua keadaan itu.
            from app.core.llm import sisa_penuh_detik

            sisa = sisa_penuh_detik()
            if harian:
                raise RuntimeError(
                    "Jatah harian penyedia model sudah habis. Konsultan AI kembali "
                    "sendiri besok; bagian lain di peta tidak terpengaruh."
                )
            if 0 < sisa < 120:
                raise RuntimeError(
                    f"Penyedia model sedang membatasi jumlah pertanyaan per menit. "
                    f"Coba lagi sekitar {sisa} detik lagi."
                )
            raise RuntimeError(
                "Penyedia model sedang sibuk di semua modelnya. Coba lagi sebentar lagi."
            )

        # Berhasil: penanda "penyedia penuh" dicabut, apa pun keadaan sebelumnya.
        from app.core.llm import tandai_penyedia_pulih

        tandai_penyedia_pulih()

        kandidat = (data.get("candidates") or [{}])[0]
        alasan = str(kandidat.get("finishReason") or "STOP").upper()

        # Penyaring keamanan Google. Dipetakan ke kata yang sudah dipahami
        # `api/ai.py`, supaya penanganannya di sana tidak perlu tahu penyedia.
        if alasan in ("SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT"):
            return Balasan(content=[], stop_reason="refusal", usage=_pakai(data))

        blok: list[Any] = []
        ada_alat = False
        for i, p in enumerate(kandidat.get("content", {}).get("parts") or []):
            if "functionCall" in p:
                fc = p["functionCall"]
                nama = fc.get("name", "")
                blok.append(
                    BlokAlat(
                        id=f"panggil-{i}-{nama}",
                        name=nama,
                        input=dict(fc.get("args") or {}),
                        tanda=p.get("thoughtSignature"),
                    )
                )
                ada_alat = True
            elif p.get("text"):
                blok.append(BlokTeks(text=p["text"], tanda=p.get("thoughtSignature")))

        return Balasan(
            content=blok,
            stop_reason="tool_use" if ada_alat else "end_turn",
            usage=_pakai(data),
        )


def _pakai(data: dict) -> Pemakaian:
    u = data.get("usageMetadata") or {}
    return Pemakaian(
        input_tokens=int(u.get("promptTokenCount") or 0),
        output_tokens=int(u.get("candidatesTokenCount") or 0),
    )


class KlienGemini:
    """Cukup meniru `anthropic.Anthropic` untuk dipakai `api/ai.py`."""

    def __init__(self, api_key: str | list[str]) -> None:
        self.messages = _Pesan(api_key)
