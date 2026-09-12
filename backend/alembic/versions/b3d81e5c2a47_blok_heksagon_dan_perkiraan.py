"""blok_heksagon dan hex_perkiraan

Dua tabel BARU, nol kolom lama yang diubah - migrasi ini sepenuhnya aditif,
jadi backend yang belum mengenal kedua tabel tetap berjalan tanpa perbedaan.

  blok_heksagon  tujuh blok (anak H3 res-10) per heksagon, indikator dari data
                 terbuka + skor blok dari s6_score. Menjawab "sisi mana di
                 dalam heksagon ini".
  hex_perkiraan  perkiraan pendukung yang BUKAN pengamatan di heksagon itu.
                 Terpisah dari hex_features supaya tidak pernah bisa bercampur
                 dengan angka hasil pengukuran, masuk skor, atau menggambar peta.

Revision ID: b3d81e5c2a47
Revises: a7f2c9d41b83
Create Date: 2026-09-12

"""
from typing import Sequence, Union

import geoalchemy2
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'b3d81e5c2a47'
down_revision: Union[str, None] = 'a7f2c9d41b83'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'blok_heksagon',
        sa.Column('h3_blok', sa.String(length=20), nullable=False),
        sa.Column('h3_induk', sa.String(length=20), nullable=False),
        sa.Column('geom', geoalchemy2.types.Geometry(geometry_type='POLYGON', srid=4326), nullable=False),
        sa.Column('lat', sa.Float(), nullable=False),
        sa.Column('lon', sa.Float(), nullable=False),
        sa.Column('menit_jalan', sa.Float(), nullable=True),
        sa.Column('jarak_jalan_m', sa.Float(), nullable=True),
        sa.Column('jarak_jalan_utama_m', sa.Float(), nullable=True),
        sa.Column('nama_jalan_utama', sa.String(length=120), nullable=True),
        sa.Column('kelas_jalan_utama', sa.String(length=24), nullable=True),
        sa.Column('jarak_jalan_terdekat_m', sa.Float(), nullable=True),
        sa.Column('n_usaha_150m', sa.Integer(), nullable=False),
        sa.Column('usaha_per_kelas_150m', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('n_penarik_250m', sa.Integer(), nullable=False),
        sa.Column('penarik_250m', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('jarak_halte_m', sa.Float(), nullable=True),
        sa.Column('n_bangunan', sa.Integer(), nullable=False),
        sa.Column('rasio_tutupan_bangunan', sa.Float(), nullable=True),
        sa.Column('izin_komersial', sa.Boolean(), nullable=True),
        sa.Column('kelas_zona', sa.String(length=60), nullable=True),
        sa.Column('pangsa_zona_usaha', sa.Float(), nullable=True),
        sa.Column('risiko_banjir', sa.Float(), nullable=True),
        sa.Column('skor_blok', sa.Float(), nullable=True),
        sa.Column('skor_per_kelas', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('peringkat_induk', sa.Integer(), nullable=True),
        sa.Column('dihitung_pada', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['h3_induk'], ['hex_features.h3_index'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('h3_blok'),
    )
    op.create_index(op.f('ix_blok_heksagon_h3_induk'), 'blok_heksagon', ['h3_induk'], unique=False)
    op.create_index(op.f('ix_blok_heksagon_skor_blok'), 'blok_heksagon', ['skor_blok'], unique=False)

    op.create_table(
        'hex_perkiraan',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('h3_index', sa.String(length=20), nullable=False),
        sa.Column('kode', sa.String(length=8), nullable=False),
        sa.Column('nilai', sa.Float(), nullable=True),
        sa.Column('rincian', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('metode', sa.String(length=24), nullable=False),
        sa.Column('n_sumber', sa.Integer(), nullable=True),
        sa.Column('radius_m', sa.Integer(), nullable=True),
        sa.Column('dihitung_pada', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['h3_index'], ['hex_features.h3_index'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('h3_index', 'kode', name='uq_perkiraan_hex_kode'),
    )
    op.create_index(op.f('ix_hex_perkiraan_h3_index'), 'hex_perkiraan', ['h3_index'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_hex_perkiraan_h3_index'), table_name='hex_perkiraan')
    op.drop_table('hex_perkiraan')
    op.drop_index(op.f('ix_blok_heksagon_skor_blok'), table_name='blok_heksagon')
    op.drop_index(op.f('ix_blok_heksagon_h3_induk'), table_name='blok_heksagon')
    op.drop_table('blok_heksagon')
