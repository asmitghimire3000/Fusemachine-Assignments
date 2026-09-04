from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass

from redis.asyncio import Redis
from redis.exceptions import RedisError

logger = logging.getLogger(__name__)

# Increment and set the expiry as one atomic Redis operation.
_INCREMENT_WINDOW = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
"""


@dataclass(frozen=True, slots=True)
class RateLimitResult:
    allowed: bool
    remaining: int
    retry_after_seconds: int


class RateLimiter:
    """Apply a fixed-window request limit independently for each user."""

    def __init__(self, redis: Redis, *, requests: int, window_seconds: int) -> None:
        self._redis = redis
        self._requests = requests
        self._window_seconds = window_seconds

    async def check(self, user_id: uuid.UUID) -> RateLimitResult:
        window = int(time.time()) // self._window_seconds
        key = f"rate-limit:chat:{user_id}:{window}"

        try:
            count, ttl = await self._redis.eval(
                _INCREMENT_WINDOW,
                1,
                key,
                self._window_seconds,
            )
        except RedisError as exc:
            # Chat remains available if the optional reliability service fails.
            logger.warning(
                "Rate limiting skipped because Redis is unavailable: %s", exc
            )
            return RateLimitResult(True, self._requests, 0)

        return RateLimitResult(
            allowed=count <= self._requests,
            remaining=max(0, self._requests - count),
            retry_after_seconds=max(1, ttl),
        )
