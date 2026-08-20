"""Tahap 4 - Analisis spasial: dari titik menjadi 41 variabel per heksagon.

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

from config import H3_RESOLUSI, ISOCHRONE_MENIT, KAWASAN_PILOT


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
    skor ramai terkoreksi (Menu Go), intensitas transaksi (Struk Go)."""
    raise NotImplementedError


def hitung_dimensi_perilaku() -> None:
    """B01-B09. Distribusi jam transaksi (bahan Commuter Clock), rasio weekend,
    pangsa digital, harga median porsi, spread, nominal median struk."""
    raise NotImplementedError


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
