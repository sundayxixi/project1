import redis.asyncio as redis
import fakeredis.aioredis
from src.core.config import get_settings

settings = get_settings()

# 本地免 Docker 开发：使用 fakeredis 内存实现替代真实 Redis 服务，接口完全一致
_redis_client = fakeredis.aioredis.FakeRedis(decode_responses=True)


async def get_redis_client() -> redis.Redis:
    """
    FastAPI Depends 注入用。
    直接返回模块级别的 Redis 客户端实例，不需要每次创建新实例。
    连接池会自动管理连接的获取和归还。
    """
    return _redis_client