from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings

def _normalize_async_db_url(raw_url: str) -> tuple[str, dict]:
    parsed = urlparse(raw_url)
    query = parse_qs(parsed.query)

    ssl_required = False
    if "sslmode" in query:
        ssl_required = True
        query.pop("sslmode", None)

    new_query = urlencode(query, doseq=True)
    clean_url = urlunparse(parsed._replace(query=new_query))

    connect_args = {"ssl": True} if ssl_required else {}
    return clean_url, connect_args


async_db_url, async_connect_args = _normalize_async_db_url(settings.DATABASE_URL)
engine = create_async_engine(async_db_url, echo=False, connect_args=async_connect_args)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
