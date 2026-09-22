"""Usaha pada lokasi tersimpan dan catatan penjualannya

Satu lokasi tersimpan bisa jadi satu usaha: namanya, deskripsinya, dan catatan
penjualan per bulan. Dari catatan itulah tren bulanannya dihitung - seluruhnya
angka yang diisi pemiliknya, tidak pernah menyentuh skor pipeline.

Aditif dan boleh NULL. Baris lama tetap sah: tanpa nama usaha ia tetap disebut
kode lokasinya, tanpa catatan penjualan tidak ada tren yang ditampilkan.

Revision ID: d3b7e2f81a05
Revises: c9f2a1d63b04
Create Date: 2026-09-23

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d3b7e2f81a05"
down_revision: Union[str, None] = "c9f2a1d63b04"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("watchlist_items", sa.Column("nama_usaha", sa.String(80)))
    op.add_column("watchlist_items", sa.Column("deskripsi", sa.Text()))

    op.create_table(
        "usaha_penjualan",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("h3_index", sa.String(20), nullable=False),
        sa.Column("bulan", sa.Date(), nullable=False),
        sa.Column("omzet", sa.Float()),
        sa.Column("pembeli", sa.Integer()),
        sa.Column("catatan", sa.String(200)),
        sa.Column("dibuat_pada", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "h3_index", "bulan", name="uq_penjualan_user_hex_bulan"),
    )
    op.create_index("ix_usaha_penjualan_user_id", "usaha_penjualan", ["user_id"])
    op.create_index("ix_usaha_penjualan_h3_index", "usaha_penjualan", ["h3_index"])


def downgrade() -> None:
    op.drop_index("ix_usaha_penjualan_h3_index", table_name="usaha_penjualan")
    op.drop_index("ix_usaha_penjualan_user_id", table_name="usaha_penjualan")
    op.drop_table("usaha_penjualan")
    op.drop_column("watchlist_items", "deskripsi")
    op.drop_column("watchlist_items", "nama_usaha")
