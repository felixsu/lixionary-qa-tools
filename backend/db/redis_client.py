import redis.asyncio as aioredis
from config import settings

class RedisClient:
    client: aioredis.Redis = None

    @classmethod
    async def connect(cls):
        if not cls.client:
            cls.client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
            print("Connected to Redis")

    @classmethod
    async def close(cls):
        if cls.client:
            await cls.client.close()
            cls.client = None
            print("Redis connection closed")

    @classmethod
    async def set_json(cls, key: str, value: str, expire_seconds: int = 3600):
        if cls.client is None:
            raise RuntimeError("Redis is not connected. Call connect() first.")
        await cls.client.set(key, value, ex=expire_seconds)

    @classmethod
    async def get_json(cls, key: str) -> str:
        if cls.client is None:
            raise RuntimeError("Redis is not connected. Call connect() first.")
        return await cls.client.get(key)

    @classmethod
    async def delete(cls, key: str):
        if cls.client is None:
            raise RuntimeError("Redis is not connected. Call connect() first.")
        await cls.client.delete(key)
