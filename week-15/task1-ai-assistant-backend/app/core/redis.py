from __future__ import annotations

import logging

from redis.asyncio import Redis
from redis.exceptions import RedisError

logger = logging.getLogger(__name__)


class RedisClient:
    """Own the shared Redis connection used by application services."""

    def __init__(self, url: str) -> None:
        self._client = Redis.from_url(url, decode_responses=True)

    @property
    def client(self) -> Redis:
        return self._client

    async def close(self) -> None:
        await self._client.aclose()

    async def check_connection(self) -> bool:
        """Return availability without preventing the application from starting."""

        try:
            return bool(await self._client.ping())
        except RedisError as exc:
            logger.warning("Redis is unavailable: %s", exc)
            return False
