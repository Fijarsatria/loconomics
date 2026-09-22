"""Rencana pengembangan pada lokasi tersimpan

Pemilik usaha yang sudah jalan menandai sebuah lokasi tersimpan dengan rencana:
usaha apa yang direncanakan di sana, dan berapa omzet usahanya sekarang. Dari
keduanya, pertumbuhannya diproyeksikan memakai mesin simulasi yang sama - jadi
tidak ada angka baru yang dihitung di luar pipeline.

Aditif dan boleh NULL. Baris lama tetap sah: tanpa rencana, ia cuma tidak
memproyeksikan apa pun.

Revision ID: c9f2a1d63b04
Revises: b8e1f0c4a92d
Create Date: 2026-09-22

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c9f2a1d63b04"
down_revision: Union[str, None] = "b8e1f0c4a92d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("watchlist_items", sa.Column("rencana_jenis_usaha", sa.String(40)))
    op.add_column("watchlist_items", sa.Column("rencana_omzet_bulanan", sa.Float()))


def downgrade() -> None:
    op.drop_column("watchlist_items", "rencana_omzet_bulanan")
    op.drop_column("watchlist_items", "rencana_jenis_usaha")
