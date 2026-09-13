"""Titik dan nama untuk lokasi tersimpan

Aditif dan boleh NULL. Baris lama tetap sah: tanpa titik ia digambar di titik
tengah heksagonnya seperti sebelumnya, tanpa nama ia disebut dengan kode
lokasinya.

Kenapa titik: heksagon bergaris tengah +-350 m, dan orang yang menyimpan
"ruko di sudut Jalan Kendal" tidak sedang menyimpan seluruh heksagonnya.
Pemilik repo meminta titik favorit bisa ditaruh DI DALAM heksagon dengan satu
klik, dan diberi nama.

Revision ID: e7a2c914b6d1
Revises: d4e19a7c3b52
"""

from alembic import op
import sqlalchemy as sa

revision = "e7a2c914b6d1"
down_revision = "d4e19a7c3b52"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("watchlist_items", sa.Column("lat", sa.Float(), nullable=True))
    op.add_column("watchlist_items", sa.Column("lon", sa.Float(), nullable=True))
    op.add_column("watchlist_items", sa.Column("nama", sa.String(length=80), nullable=True))


def downgrade() -> None:
    op.drop_column("watchlist_items", "nama")
    op.drop_column("watchlist_items", "lon")
    op.drop_column("watchlist_items", "lat")
