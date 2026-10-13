#!/bin/sh
# 容器入口：内置翻译接口（后台）+ nginx（前台）
set -e
python3 /app/api/translate_api.py 8765 &
API_PID=$!
# API 意外退出时自动重启
( while true; do
    if ! kill -0 "$API_PID" 2>/dev/null; then
      echo "[entrypoint] translate api died, restarting..."
      python3 /app/api/translate_api.py 8765 &
      API_PID=$!
    fi
    sleep 5
  done ) &
exec nginx -g 'daemon off;'
