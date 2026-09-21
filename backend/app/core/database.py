from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

# Transaction pooler (pgbouncer) tidak mendukung prepared statements, jadi
# statement cache psycopg wajib dimatikan. pool_recycle + keepalive membuang
# koneksi yang sudah dibunuh pooler; tanpa itu pre_ping menggantung lama.
engine = create_engine(
    settings.database_url,
    connect_args={
        "prepare_threshold": None,
        "connect_timeout": 10,
        "options": "-c statement_timeout=30000",
        "keepalives": 1,
        "keepalives_idle": 30,
        "keepalives_interval": 10,
        "keepalives_count": 3,
    },
    pool_pre_ping=True,
    pool_recycle=180,
    pool_timeout=10,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
