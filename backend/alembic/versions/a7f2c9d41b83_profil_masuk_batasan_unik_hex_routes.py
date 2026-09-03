"""profil masuk batasan unik hex_routes

Satu heksagon harus bisa punya rute JALAN KAKI dan rute MOBIL ke simpul yang
sama. Batasan lama - (h3_index, transport_node_id, urutan) - melarangnya:
rute mobil urutan 0 bertabrakan dengan rute jalan kaki urutan 0 ke simpul yang
sama, dan `ON CONFLICT` di `rute_ors.py` akan MENIMPA yang jalan kaki alih-alih
menambah yang mobil.

Kegagalannya diam dan mahal: penarikan mobil akan tampak berhasil, jumlah baris
tidak bertambah, dan 1.549 rute jalan kaki yang butuh berjam-jam dibuat hilang
diganti rute mobil satu per satu.

Kolom `profil` sendiri SUDAH ada sejak c22ddbceff30 dengan bawaan
'foot-walking', jadi migrasi ini tidak menambah kolom - ia cuma memasukkan
kolom itu ke dalam kunci uniknya.

Revision ID: a7f2c9d41b83
Revises: c22ddbceff30
Create Date: 2026-09-03

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a7f2c9d41b83'
down_revision: Union[str, None] = 'c22ddbceff30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LAMA = 'uq_rute_hex_simpul_urutan'
BARU = 'uq_rute_hex_simpul_profil_urutan'


def upgrade() -> None:
    op.drop_constraint(LAMA, 'hex_routes', type_='unique')
    op.create_unique_constraint(
        BARU, 'hex_routes', ['h3_index', 'transport_node_id', 'profil', 'urutan']
    )


def downgrade() -> None:
    # Turun hanya aman kalau tabelnya berisi SATU profil saja. Dengan dua
    # profil, batasan lama tidak bisa dibuat ulang - dan itu memang harus
    # gagal berisik di sini alih-alih menghapus baris diam-diam.
    op.drop_constraint(BARU, 'hex_routes', type_='unique')
    op.create_unique_constraint(
        LAMA, 'hex_routes', ['h3_index', 'transport_node_id', 'urutan']
    )
