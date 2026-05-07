import redis.asyncio as aioredis
import redis as sync_redis
from app.core.config import settings

_async_client = None
_sync_client = None


def get_async_redis() -> aioredis.Redis:
    global _async_client
    if _async_client is None:
        _async_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    return _async_client


def get_sync_redis() -> sync_redis.Redis:
    global _sync_client
    if _sync_client is None:
        _sync_client = sync_redis.from_url(settings.REDIS_URL, decode_responses=True)
    return _sync_client
