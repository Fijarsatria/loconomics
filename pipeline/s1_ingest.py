"""Tahap 1 - Tarik seluruh data mentah ke pipeline/data/01_mentah/.

Prinsip: berkas di 01_mentah TIDAK PERNAH diedit. Kalau ada yang perlu diperbaiki,
perbaikannya ditulis sebagai kode di s2_clean.py. Dengan begitu seluruh pipeline
bisa dijalankan ulang dari nol dan hasilnya sama.

Sumber, sesuai prioritas akuisisi (docs/data.md bagian 10):

  P0  Data misi MAPID   Properti Go, Struk Go, Menu Go, Community Maps
                        -> lewat MAPID Data API, header x-api-key, BACKEND-ONLY
                        -> dokumentasi: https://maps.mapid.io/docs
  P0  OSM               POI + jaringan jalan Jabodetabek (Overpass / Geofabrik PBF)
  P0  Simpul transit    railway=station, highway=bus_stop, terminal
  P1  WorldPop 2025     raster populasi + age-sex
  P1  NJOP              Jakarta Satu ArcGIS REST -> GeoJSON
  P1  RDTR Pola Ruang   Jakarta Satu ArcGIS REST -> GeoJSON  (sumber L01 ZoneGuard)
  P2  Overture Places   DuckDB query bbox
  P2  Google Open Bld   GEE export
  P2  Ridership KAI     ekstraksi press release (fitur C2)
  P2  InaRISK           layer risiko banjir

DILARANG (docs/aturan-lomba.md): Google Places API, scraping Rumah123/OLX,
GTFS TransJakarta komunitas. Melanggar ketentuan layanan atau lisensinya tidak jelas.

Status: menunggu API key data misi MAPID.
"""

from config import BBOX, DATA_MENTAH, KAWASAN_PILOT


def tarik_misi_mapid() -> None:
    """Properti Go / Struk Go / Menu Go / Activities lewat MAPID Data API.

    Header: x-api-key. Backend-to-backend, jangan pernah dari frontend.
    Simpan apa adanya sebagai CSV/JSON ke DATA_MENTAH.

    SEBELUM menulis parser: buka CSV aslinya, cocokkan nama kolom, lalu kunci
    hasilnya ke KOLOM_MENU_GO / KOLOM_STRUK_GO / KOLOM_PROPERTI_GO di config.py.
    """
    raise NotImplementedError("Menunggu API key data misi MAPID")


def tarik_osm() -> None:
    """POI + jaringan jalan pejalan kaki dalam BBOX. Jaringan jalan dipakai s4 untuk isochrone."""
    raise NotImplementedError


def tarik_simpul_transit() -> None:
    """±120-150 simpul darat. Untuk MVP cukup yang berada di KAWASAN_PILOT."""
    raise NotImplementedError


def tarik_data_sekunder() -> None:
    """WorldPop, NJOP, RDTR, Open Buildings, InaRISK, Overture."""
    raise NotImplementedError


if __name__ == "__main__":
    DATA_MENTAH.mkdir(parents=True, exist_ok=True)
    print(f"Wilayah: {', '.join(KAWASAN_PILOT)}")
    print(f"BBOX   : {BBOX}")
    print("Belum ada sumber yang bisa ditarik - lihat docstring modul ini.")
