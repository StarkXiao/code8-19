#!/usr/bin/env python3
"""古树名木复壮跟踪系统 — 启动入口。

用法：
    python3 run.py [--host 127.0.0.1] [--port 8000]
"""
import argparse

from app.db import init_db
from app.server import serve


def main():
    parser = argparse.ArgumentParser(description="古树名木复壮跟踪系统")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址")
    parser.add_argument("--port", type=int, default=8000, help="监听端口")
    args = parser.parse_args()
    init_db()
    serve(args.host, args.port)


if __name__ == "__main__":
    main()
