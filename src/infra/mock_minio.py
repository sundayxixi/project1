"""内存模拟 MinIO 客户端，用于本地免 Docker 开发。

接口与 minio.Minio 保持一致，数据存储在进程内存中，重启即丢失。
生产环境应替换为真实 MinIO 服务。
"""

import io
from threading import Lock
from loguru import logger


class _MemoryBucket:
    """单个桶的内存存储"""

    def __init__(self):
        self._objects: dict[str, bytes] = {}
        self._lock = Lock()

    def put_object(self, object_name: str, data: io.BytesIO, content_type: str, length: int) -> str:
        with self._lock:
            self._objects[object_name] = data.read()
        logger.debug(f"[mock-minio] put {object_name} ({length} bytes)")
        return object_name

    def get_object(self, object_name: str) -> io.BytesIO:
        with self._lock:
            if object_name not in self._objects:
                raise KeyError(f"Object not found: {object_name}")
            return io.BytesIO(self._objects[object_name])

    def remove_object(self, object_name: str) -> None:
        with self._lock:
            self._objects.pop(object_name, None)
        logger.debug(f"[mock-minio] remove {object_name}")

    def list_objects(self):
        with self._lock:
            return list(self._objects.keys())


class MockMinioClient:
    """内存模拟 MinIO 客户端，接口与 minio.Minio 保持一致"""

    def __init__(self, *args, **kwargs):
        self._buckets: dict[str, _MemoryBucket] = {}
        self._lock = Lock()

    def bucket_exists(self, bucket_name: str) -> bool:
        with self._lock:
            return bucket_name in self._buckets

    def make_bucket(self, bucket_name: str, location: str = "us-east-1") -> None:
        with self._lock:
            if bucket_name not in self._buckets:
                self._buckets[bucket_name] = _MemoryBucket()

    def put_object(self, bucket_name: str, object_name: str, data,
                   length: int = 0, content_type: str = "application/octet-stream",
                   metadata=None) -> str:
        with self._lock:
            if bucket_name not in self._buckets:
                self._buckets[bucket_name] = _MemoryBucket()
        bucket = self._buckets[bucket_name]
        # data 可能是 BytesIO 或 bytes
        if hasattr(data, "read"):
            bucket.put_object(object_name, data, content_type, length)
        else:
            bio = io.BytesIO(data if isinstance(data, bytes) else bytes(data))
            bucket.put_object(object_name, bio, content_type, length or len(bio.getvalue()))
        return object_name

    def get_object(self, bucket_name: str, object_name: str):
        with self._lock:
            if bucket_name not in self._buckets:
                raise KeyError(f"Bucket not found: {bucket_name}")
        bucket = self._buckets[bucket_name]
        return bucket.get_object(object_name)

    def remove_object(self, bucket_name: str, object_name: str) -> None:
        with self._lock:
            if bucket_name not in self._buckets:
                return
        bucket = self._buckets[bucket_name]
        bucket.remove_object(object_name)

    def list_objects(self, bucket_name: str, prefix: str = ""):
        with self._lock:
            if bucket_name not in self._buckets:
                return []
        bucket = self._buckets[bucket_name]
        return bucket.list_objects()