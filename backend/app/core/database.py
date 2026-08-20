from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

# Transaction pooler (pgbouncer) tidak mendukung prepared statements,
# jadi statement cache psycopg wajib dimatikan.
engine = create_engine(
    settings.database_url,
    connect_args={"prepare_threshold": None},
    pool_pre_ping=True,
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
