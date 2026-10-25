"""等待前后端服务就绪，供 start.bat 在启动后轮询调用。

用法: python wait_ready.py [超时秒数]
退出码: 0 = 两个服务均已就绪；1 = 超时未就绪

两个地址并行轮询，总超时为传入的秒数，而不是每个地址各等一次。
"""
from __future__ import annotations

import sys
import time
import urllib.request

TARGETS = [
    ("后端", "http://127.0.0.1:8080/health"),
    ("前端", "http://localhost:5173"),
]


def probe(url: str) -> bool:
    try:
        urllib.request.urlopen(url, timeout=2)
        return True
    except Exception:  # noqa: BLE001
        return False


def main() -> int:
    timeout = int(sys.argv[1]) if len(sys.argv) > 1 else 90
    deadline = time.time() + timeout
    pending = list(TARGETS)

    while pending and time.time() < deadline:
        for name, url in list(pending):
            if probe(url):
                print(f"       {name}就绪    {url}", flush=True)
                pending.remove((name, url))
        if pending:
            time.sleep(1)

    for name, url in pending:
        print(f"       {name}启动超时 {url}", flush=True)
    return 0 if not pending else 1


if __name__ == "__main__":
    sys.exit(main())
