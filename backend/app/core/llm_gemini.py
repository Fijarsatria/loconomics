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
    def __init__(self, kunci: str) -> None:
        self._kunci = kunci

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
        for m in urutan:
            req = urllib.request.Request(
                URL.format(model=m),
                data=muatan,
                headers={"Content-Type": "application/json", "X-goog-api-key": self._kunci},
                method="POST",
            )
            for percobaan in range(2):
                try:
                    with urllib.request.urlopen(req, timeout=90) as r:
                        data = json.load(r)
                    if m != model:
                        log.warning("Gemini: %s penuh, dilayani %s", model, m)
                    break
                except urllib.error.HTTPError as e:
                    rinci = e.read().decode("utf-8", "replace")[:400]
                    sementara = e.code in (429, 500, 502, 503, 504)
                    if sementara and percobaan == 0:
                        time.sleep(1.2)
                        continue
                    if sementara or e.code == 404:
                        # Habis jatahnya di model ini - pindah ke berikutnya.
                        # 404 ikut: nama model bisa ditarik Google kapan saja,
                        # dan itu tidak boleh mematikan Konsultan AI.
                        log.warning("Gemini %s pada %s, pindah model", e.code, m)
                        break
                    # 400 / 403: permintaan atau kuncinya yang salah, dan itu
                    # akan salah lagi di model mana pun. Berhenti di sini.
                    #
                    # Rincinya ke LOG. Yang keluar ke pemanggil kalimat generik -
                    # balasan galat Google memuat nama proyek dan kadang potongan
                    # permintaan, dan aturan 8 melarang keduanya sampai ke layar.
                    log.error("Gemini menolak (%s) pada %s: %s", e.code, m, rinci)
                    raise RuntimeError("Penyedia model menolak permintaan ini.") from e
                except (urllib.error.URLError, TimeoutError) as e:
                    if percobaan == 0:
                        time.sleep(1.2)
                        continue
                    log.warning("Gemini tidak terjangkau pada %s: %s", m, e)
                    break
            if data is not None:
                break

        if data is None:
            log.error("Seluruh model Gemini gagal: %s", urutan)
            raise RuntimeError(
                "Penyedia model sedang sibuk di semua modelnya. Coba lagi sebentar lagi."
            )

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

    def __init__(self, api_key: str) -> None:
        self.messages = _Pesan(api_key)
