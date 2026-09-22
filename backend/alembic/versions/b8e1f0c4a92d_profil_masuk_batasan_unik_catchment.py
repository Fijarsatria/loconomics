"""profil masuk batasan unik catchment_areas

Satu simpul harus punya kawasan jangkau JALAN KAKI dan kawasan jangkau MOBIL
sekaligus. Batasan lama - (transport_node_id, menit) - melarangnya: menjalankan
`rute_ors.py --mobil --isochrone` MENIMPA pita jalan kaki alih-alih menambah
pita mobil, jadi peta menggambar jangkauan jalan kaki walau modanya mobil.

Kegagalannya diam: penarikan mobil tampak berhasil dan jumlah baris tetap,
sementara pita yang salah itulah yang sampai ke layar.

Kolom baru diberi bawaan 'foot-walking', dan baris lama memang seluruhnya
jalan kaki - jadi migrasi ini tidak mengubah arti satu baris pun.

Revision ID: b8e1f0c4a92d
Revises: e7a2c914b6d1
Create Date: 2026-09-22

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b8e1f0c4a92d"
down_revision: Union[str, None] = "e7a2c914b6d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LAMA = "uq_catchment_node_menit"
BARU = "uq_catchment_node_menit_profil"


def upgrade() -> None:
    op.add_column(
        "catchment_areas",
        sa.Column("profil", sa.String(24), nullable=False, server_default="foot-walking"),
    )
    op.drop_constraint(LAMA, "catchment_areas", type_="unique")
    op.create_unique_constraint(
        BARU, "catchment_areas", ["transport_node_id", "menit", "profil"]
    )


def downgrade() -> None:
    # Turun hanya aman kalau tabelnya berisi SATU profil saja. Dengan dua
    # profil, batasan lama tidak bisa dibuat ulang - dan itu memang harus gagal
    # berisik di sini alih-alih menghapus baris diam-diam.
    op.drop_constraint(BARU, "catchment_areas", type_="unique")
    op.create_unique_constraint(LAMA, "catchment_areas", ["transport_node_id", "menit"])
    op.drop_column("catchment_areas", "profil")
