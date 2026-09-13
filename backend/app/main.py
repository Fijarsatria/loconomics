"""Loconomics API.

Modular monolith. Enam modul.

Yang TIDAK ada di sini sama pentingnya dengan yang ada: domain "lokasi usaha",
"kompetitor", dan "properti" tidak punya endpoint sendiri. Kalau punya, endpoint
itu tidak akan punya apa-apa untuk dikirim selain baris survei individual -
persis yang dilarang ketentuan B.7. Ketiganya hanya muncul sebagai variabel
agregat di /hex.

  /hex        heksagon, detail 43 variabel, Commuter Clock
  /pricelens  peta harga - fitur prioritas tertinggi
  /transit    simpul dan isochrone
  /skor       peringkat, GemFinder, RiskRadar, ZoneGuard, versi skor
  /ai         AI Consultant
  /meta       kesehatan, kesiapan, cakupan data
  /akun       akun, langganan, token, pemantauan, Laporan Kelayakan

Backend ini TIDAK menghitung skor. Seluruh perhitungan dilakukan offline oleh
pipeline/ dan hasilnya dibaca dari basis data - lihat CLAUDE.md aturan 1.
"""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api import ai, akun, hex, meta, pricelens, skor, transit
from app.core import galat
from app.core.config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)

KETERANGAN_TAG = [
    {"name": "heksagon", "description": "Satuan analisis utama: H3 res-9, ±0,10 km²."},
    {"name": "pricelens", "description": "Peta harga. Sewa per m² dan belanja per jam, keduanya dari OCR."},
    {"name": "transit", "description": "Simpul transportasi dan isochrone jalan kaki."},
    {"name": "skor", "description": "Peringkat, GemFinder, RiskRadar, ZoneGuard. Membaca saja - tidak menghitung."},
    {"name": "ai", "description": "AI Consultant. Satu-satunya bagian yang membelanjakan uang sungguhan."},
    {"name": "meta", "description": "Kesehatan, kesiapan, cakupan data."},
    {
        "name": "akun",
        "description": (
            "Akun, langganan Loconomics Premium, token, pemantauan, Laporan Kelayakan. "
            "Satu-satunya modul yang menyimpan data pribadi - dan ia tidak pernah "
            "ikut ter-JOIN dengan data misi MAPID."
        ),
    },
]

app = FastAPI(
    title="Loconomics API",
    version="0.2.0",
    summary="Transit-oriented Retail Recommender - MAPID WebGIS Competition 2026",
    description=__doc__,
    openapi_tags=KETERANGAN_TAG,
    # Di produksi, /docs disembunyikan. Bukan karena API-nya rahasia, tetapi
    # karena halaman itu mengundang orang mencoba POST /ai/tanya, dan endpoint
    # itu membelanjakan uang sungguhan.
    docs_url=None if settings.produksi else "/docs",
    redoc_url=None if settings.produksi else "/redoc",
    # `openapi_url` ikut ditutup, dan tanpa ini dua baris di atas tidak
    # menutup apa pun. Diukur 13 Sep 2026 pada terbitan yang sedang hidup:
    # /docs dan /redoc menjawab 404, sementara /openapi.json menjawab 200
    # dengan SELURUH skemanya - setiap rute, setiap parameter, setiap bentuk
    # respons. Siapa pun bisa menempelkannya ke editor.swagger.io dan
    # mendapatkan tombol "Try it out" yang sama persis, ke API yang sama
    # persis. Jadi yang tersembunyi cuma halamannya, bukan yang dijaga.
    #
    # Ini memang obskuritas, bukan penjagaan - yang menjaga /ai/tanya tetap
    # pembatas laju dan plafon biaya di `core/batas.py`. Tetapi obskuritas yang
    # SETENGAH lebih buruk daripada tidak ada: ia membuat pembacanya percaya
    # pintunya tertutup.
    openapi_url=None if settings.produksi else "/openapi.json",
)

#: Header keamanan yang dikirim pada SETIAP respons API.
#:
#: Ditambahkan 13 Sep 2026 sesudah diukur: backend publik tidak mengirim satu
#: pun dari keempatnya. Frontend sudah lama mengirimnya lewat `_headers`
#: Cloudflare, dan itu yang membuat kekosongan di sisi API mudah terlewat -
#: dua terbitan, satu diperiksa.
#:
#: Kenapa API perlu header ini padahal ia menyajikan JSON, bukan HTML:
#:
#:   nosniff       tanpa itu peramban boleh menebak tipe sebuah respons dan
#:                 menjalankan JSON yang dibuat menyerupai skrip
#:   frame DENY    API tidak pernah punya alasan tampil di dalam <iframe>;
#:                 satu-satunya yang membutuhkannya penyerang clickjacking
#:   no-referrer   URL API memuat kode heksagon dan parameter simulasi milik
#:                 penggunanya. Referrer membocorkannya ke tiap tautan keluar
#:   CORP          melarang situs lain menyedot respons ini sebagai sumber daya
#:   HSTS          Azure sudah memaksa HTTPS, tetapi hanya SESUDAH satu
#:                 permintaan polos pertama. HSTS mencegah yang pertama itu
HEADER_KEAMANAN = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-site",
    # `frame-ancestors 'none'` saja - respons ini bukan halaman, jadi arahan
    # lain tidak punya arti di sini dan hanya akan jadi salinan kedua dari CSP
    # frontend yang cepat atau lambat berselisih dengannya.
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}


@app.middleware("http")
async def header_keamanan(request, panggil_berikutnya):
    """Menempelkan `HEADER_KEAMANAN` ke tiap respons, termasuk respons GALAT.

    Middleware, bukan `Depends`: dependensi tidak berjalan untuk respons yang
    dibuat penangan galat, dan justru respons galat yang paling sering dipakai
    menyelidiki sebuah API.
    """
    respons = await panggil_berikutnya(request)
    for k, v in HEADER_KEAMANAN.items():
        respons.headers.setdefault(k, v)
    # HSTS HANYA di produksi. Di localhost ia mengunci peramban pengembang ke
    # https untuk host yang tidak menyajikannya - dan kuncian itu bertahan
    # berbulan-bulan di profil perambannya.
    if settings.produksi:
        respons.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
    return respons


# Urutan middleware penting: yang ditambahkan terakhir berjalan paling luar.
# GZip harus membungkus respons SETELAH CORS menempelkan header-nya.
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    # DELETE dan PATCH ditambahkan 13 Sep 2026. Tanpa keduanya, "Hapus dari
    # simpanan" TIDAK PERNAH berhasil dari peramban: frontend memanggil DELETE
    # lintas asal, preflight-nya dijawab 400 - diukur di lokal DAN produksi -
    # dan dialognya menelan galat itu diam-diam. Lokasinya tetap tersimpan,
    # pinnya tetap di peta, dan pemilik repo melaporkannya sebagai "ngebug".
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["*"],
    # Peramban menyembunyikan setiap header respons yang tidak disebut di sini,
    # termasuk header buatan sendiri. X-Total-Count adalah janji paginasi
    # /skor/ranking; tanpa didaftarkan, janji itu cuma berlaku untuk curl.
    expose_headers=[galat.HEADER_REQUEST_ID, skor.HEADER_TOTAL],
)

# Kompresi bukan hiasan di sini: satu FeatureCollection berisi ribuan heksagon
# adalah JSON berisi banyak angka berulang, dan biasanya menyusut sekitar
# sepersepuluh. Di free tier, itu bedanya antara peta yang muncul dan peta yang
# masih memuat saat juri sudah pindah.

galat.pasang(app)

app.include_router(meta.router)
app.include_router(hex.router)
app.include_router(pricelens.router)
app.include_router(transit.router)
app.include_router(skor.router)
app.include_router(ai.router)
app.include_router(akun.router)
