"""Sumbangan tiap indikator ke skor blok

Aditif dan boleh NULL: blok yang sudah ada tetap sah tanpa kolom ini, dan
`s7_publish.py --blok` yang berikutnya mengisinya. Tidak ada satu pun baris
lama yang disentuh migrasi ini.

Kenapa disimpan alih-alih dihitung saat melayani: aritmetika skor tinggal di
`pipeline/s6_score.py` (aturan 1). Backend yang menghitung ulang bobotnya
sendiri akan berselisih dengan pipeline pada hari seseorang menggeser satu
bobot - dan selisih itu tidak akan memunculkan satu pun galat.

Revision ID: d4e19a7c3b52
Revises: b3d81e5c2a47
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "d4e19a7c3b52"
down_revision = "b3d81e5c2a47"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "blok_heksagon",
        sa.Column("kontribusi", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("blok_heksagon", "kontribusi")
