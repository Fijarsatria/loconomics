"""Adapter penyedia kompatibel-OpenAI (DashScope/Qwen/DeepSeek).

Berbicara `/chat/completions` lalu mengembalikan bentuk yang SAMA dengan klien
Anthropic/Gemini - `.messages.create()` dengan `content` berisi blok teks dan
panggilan alat - supaya `api/ai.py` tidak pernah tahu penyedianya.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from typing import Any

from app.core.config import settings

# Bentuk balasan dipinjam dari adapter Gemini: keduanya meniru objek Anthropic,
# dan duplikat definisinya cuma akan berselisih cepat atau lambat.
from app.core.llm_gemini import Balasan, BlokAlat, BlokTeks, Pemakaian

#: DashScope/Qwen/DeepSeek menerima `enable_thinking`. Dimatikan: model berpikir
#: token yang tidak dipakai (terukur output 82 -> 9 token) dan menambah 5-30 dtk.
_PROVIDER_TANPA_PIKIR = {"dashscope", "qwen", "deepseek"}

log = logging.getLogger(__name__)

#: Perkiraan tarif USD per juta token. DeepSeek-Flash kelas murah; dipakai
#: `biaya_usd` supaya plafon harian tetap punya arti.
TARIF_MASUK = 0.10
TARIF_KELUAR = 0.40

#: Jendela "penyedia penuh" saat seluruh kunci menolak. Satu menit: hambatan
#: kompatibel-OpenAI umumnya per menit, bukan harian.
JEDA_PENUH_DETIK = 60


def _pesan_openai(system: str, messages: list[dict]) -> list[dict]:
    """Giliran percakapan Anthropic -> `messages` OpenAI."""
    hasil: list[dict] = []
    if system:
        hasil.append({"role": "system", "content": system})

    for m in messages:
        peran = m["role"]
        badan = m["content"]
        if isinstance(badan, str):
            hasil.append({"role": peran, "content": badan})
            continue

        teks: list[str] = []
        panggilan: list[dict] = []
        hasil_alat: list[dict] = []
        for blok in badan:
            if isinstance(blok, BlokTeks):
                if blok.text:
                    teks.append(blok.text)
            elif isinstance(blok, BlokAlat):
                panggilan.append(
                    {
                        "id": blok.id,
                        "type": "function",
                        "function": {
                            "name": blok.name,
                            "arguments": json.dumps(blok.input, ensure_ascii=False),
                        },
                    }
                )
            elif isinstance(blok, dict) and blok.get("type") == "tool_result":
                isi = blok.get("content")
                if not isinstance(isi, str):
                    isi = json.dumps(isi, ensure_ascii=False, default=str)
                if blok.get("is_error"):
                    isi = f"Gagal: {isi}"
                hasil_alat.append(
                    {
                        "role": "tool",
                        "tool_call_id": str(blok.get("tool_use_id", "")),
                        "content": isi,
                    }
                )
            elif isinstance(blok, dict) and blok.get("type") == "text":
                if blok.get("text"):
                    teks.append(str(blok["text"]))

        if panggilan:
            hasil.append(
                {"role": "assistant", "content": "\n".join(teks) or None, "tool_calls": panggilan}
            )
        elif teks and not hasil_alat:
            hasil.append({"role": peran, "content": "\n".join(teks)})

        # Hasil alat wajib giliran `tool`, dan harus mendahului teks user apa pun.
        hasil.extend(hasil_alat)
        if hasil_alat and teks:
            hasil.append({"role": "user", "content": "\n".join(teks)})

    return hasil


def _alat_openai(tools: list[dict]) -> list[dict]:
    """Skema alat Anthropic -> `tools` OpenAI (JSON Schema sudah bentuknya)."""
    return [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t.get("description", ""),
                "parameters": t.get("input_schema")
                or {"type": "object", "properties": {}},
            },
        }
        for t in tools
    ]


def _pakai(data: dict) -> Pemakaian:
    u = data.get("usage") or {}
    return Pemakaian(
        input_tokens=int(u.get("prompt_tokens") or 0),
        output_tokens=int(u.get("completion_tokens") or 0),
    )


def _dari_openai(data: dict) -> Balasan:
    """Balasan `/chat/completions` -> bentuk Anthropic yang dipahami `api/ai.py`."""
    pilihan = (data.get("choices") or [{}])[0]
    pesan = pilihan.get("message") or {}
    alasan = str(pilihan.get("finish_reason") or "stop").lower()

    if alasan == "content_filter":
        return Balasan(content=[], stop_reason="refusal", usage=_pakai(data))

    blok: list[Any] = []
    if pesan.get("content"):
        # Sebagian model menulis penalaran di `reasoning_content`; yang dikirim
        # ke pengguna hanya jawabannya.
        blok.append(BlokTeks(text=str(pesan["content"])))
    for i, panggilan in enumerate(pesan.get("tool_calls") or []):
        fungsi = panggilan.get("function") or {}
        nama = str(fungsi.get("name") or "")
        try:
            argumen = json.loads(fungsi.get("arguments") or "{}")
            if not isinstance(argumen, dict):
                argumen = {"nilai": argumen}
        except (json.JSONDecodeError, TypeError):
            argumen = {}
        blok.append(
            BlokAlat(
                id=str(panggilan.get("id") or f"panggil-{i}-{nama}"),
                name=nama,
                input=argumen,
            )
        )

    return Balasan(
        content=blok,
        stop_reason="tool_use" if alasan == "tool_calls" else "end_turn",
        usage=_pakai(data),
    )


class _Pesan:
    def __init__(self, kunci: str | list[str], base_url: str) -> None:
        daftar = [kunci] if isinstance(kunci, str) else list(kunci)
        self._kunci = [k for k in daftar if k]
        self._base = base_url.rstrip("/")

    def create(
        self,
        *,
        model: str,
        max_tokens: int,
        system: str,
        tools: list[dict],
        messages: list[dict],
        tool_choice: dict | None = None,
        **_,
    ) -> Balasan:
        badan: dict[str, Any] = {
            "model": model,
            "messages": _pesan_openai(system, messages),
            "max_tokens": max_tokens,
            "temperature": 0.4,
        }
        if tools:
            badan["tools"] = _alat_openai(tools)
            # Anthropic `{"type":"none"}` = model dilarang memanggil alat.
            badan["tool_choice"] = (
                "none" if (tool_choice or {}).get("type") == "none" else "auto"
            )
        if settings.llm_provider.lower() in _PROVIDER_TANPA_PIKIR:
            badan["enable_thinking"] = False

        muatan = json.dumps(badan).encode()
        url = f"{self._base}/chat/completions"
        data: dict | None = None

        for ik, kunci in enumerate(self._kunci):
            for percobaan in range(2):
                req = urllib.request.Request(
                    url,
                    data=muatan,
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {kunci}",
                    },
                    method="POST",
                )
                try:
                    with urllib.request.urlopen(req, timeout=90) as r:
                        data = json.load(r)
                    if ik != 0:
                        log.warning("LLM dilayani kunci #%d", ik + 1)
                    break
                except urllib.error.HTTPError as e:
                    rinci = e.read().decode("utf-8", "replace")[:2000]
                    if e.code in (429, 500, 502, 503, 504):
                        if percobaan == 0:
                            time.sleep(1.0)
                            continue
                        log.warning("LLM %s pada kunci #%d", e.code, ik + 1)
                        break
                    if e.code in (401, 403):
                        # Kunci ini yang ditolak; kunci lain masih layak dicoba.
                        log.error("LLM menolak kunci #%d (%s)", ik + 1, e.code)
                        break
                    # 400/404: permintaan atau nama modelnya salah - salah lagi
                    # di kunci mana pun. Rincinya ke LOG (aturan 8).
                    log.error("LLM menolak (%s): %s", e.code, rinci[:300])
                    raise RuntimeError("Penyedia model menolak permintaan ini.") from e
                except (urllib.error.URLError, TimeoutError) as e:
                    if percobaan == 0:
                        time.sleep(1.0)
                        continue
                    log.warning("LLM tidak terjangkau: %s", e)
                    break
            if data is not None:
                break

        if data is None:
            from app.core.llm import tandai_penyedia_penuh

            tandai_penyedia_penuh(JEDA_PENUH_DETIK)
            raise RuntimeError(
                "Penyedia model sedang sibuk di semua kuncinya. Coba lagi sebentar lagi."
            )

        from app.core.llm import tandai_penyedia_pulih

        tandai_penyedia_pulih()

        return _dari_openai(data)


class KlienOpenAI:
    """Cukup meniru `anthropic.Anthropic` untuk dipakai `api/ai.py`."""

    def __init__(self, api_key: str | list[str], base_url: str) -> None:
        self.messages = _Pesan(api_key, base_url)
