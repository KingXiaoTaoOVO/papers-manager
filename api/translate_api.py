#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Papers Manager 内置翻译接口（零第三方依赖，仅用 Python 标准库）

后端走 Bing 翻译（与 pdf2zh 的 Bing 后端同一套接口），因此：
  · 国内服务器可直连，无需任何 API Key
  · 浏览器同源调用 /api/translate，不存在跨域问题

接口：
  GET  /healthz                     健康检查
  POST /api/translate               批量翻译
       {"texts": ["...", "..."], "from": "en", "to": "zh-Hans"}
       -> {"translations": ["...", "..."]}

说明：Bing 单次上限 1000 字符，超长文本会在句末切分后合并翻译。
"""
import json
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BING_HOME = "https://www.bing.com/translator"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0")
MAX_CHARS = 1000          # Bing 单次上限
TOKEN_TTL = 600           # IG/IID/token 缓存时间（秒）
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765

# Bing 的语言代码与通用代码的差异
SRC_MAP = {"auto": "auto-detect", "zh": "zh-Hans", "zh-CN": "zh-Hans", "zh-TW": "zh-Hant"}
DST_MAP = {"zh": "zh-Hans", "zh-CN": "zh-Hans", "zh-TW": "zh-Hant"}

_lock = threading.Lock()
_session = {"opener": None, "url": None, "ig": None, "iid": None,
            "key": None, "token": None, "ts": 0}
_cache = {}


def _opener():
    if _session["opener"] is None:
        _session["opener"] = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(CookieJar()))
    return _session["opener"]


def _refresh_session():
    """抓取 translator 页面，提取 IG / IID / key / token"""
    req = urllib.request.Request(BING_HOME, headers={"User-Agent": UA})
    with _opener().open(req, timeout=25) as resp:
        html = resp.read().decode("utf-8", "replace")
        final = resp.geturl()
    url = final[:-10] if final.endswith("/translator") else final.rstrip("/") + "/"
    ig = re.findall(r'"ig":"(.*?)"', html)
    iid = re.findall(r'data-iid="(.*?)"', html)
    kt = re.findall(r'params_AbusePreventionHelper\s=\s\[(.*?),"(.*?)",', html)
    if not (ig and iid and kt):
        raise RuntimeError("Bing 页面结构变化，未能取到 IG/IID/token")
    with _lock:
        _session.update({"url": url, "ig": ig[0], "iid": iid[-1],
                         "key": kt[0][0], "token": kt[0][1], "ts": time.time()})
    return _session


def _ensure_session(force=False):
    with _lock:
        fresh = _session["ig"] and (time.time() - _session["ts"] < TOKEN_TTL)
    if force or not fresh:
        _refresh_session()
    return _session


def _chunks(text, limit=MAX_CHARS):
    """按句末切分，保证每段 <= limit"""
    if len(text) <= limit:
        return [text]
    parts, buf = [], ""
    for piece in re.split(r"(?<=[.!?。！？；;])\s*", text):
        if len(buf) + len(piece) > limit and buf:
            parts.append(buf)
            buf = piece
        else:
            buf += piece
        while len(buf) > limit:            # 单句超长：硬切
            parts.append(buf[:limit])
            buf = buf[limit:]
    if buf:
        parts.append(buf)
    return parts


def bing_translate(text, src="en", dst="zh-Hans"):
    """翻译一段文本（自动按 1000 字符切分后拼接）"""
    text = (text or "").strip()
    if not text:
        return ""
    src = SRC_MAP.get(src, src)
    dst = DST_MAP.get(dst, dst)
    ck = (src, dst, text)
    if ck in _cache:
        return _cache[ck]

    out = []
    for chunk in _chunks(text):
        for attempt in (0, 1):
            s = _ensure_session(force=attempt == 1)
            data = urllib.parse.urlencode({
                "fromLang": src, "to": dst, "text": chunk,
                "token": s["token"], "key": s["key"],
            }).encode()
            req = urllib.request.Request(
                f"{s['url']}ttranslatev3?IG={s['ig']}&IID={s['iid']}",
                data=data, headers={"User-Agent": UA,
                                    "Content-Type": "application/x-www-form-urlencoded"})
            try:
                with _opener().open(req, timeout=30) as resp:
                    payload = json.loads(resp.read().decode("utf-8", "replace"))
                if not isinstance(payload, list) or not payload:
                    raise RuntimeError(f"Bing 返回异常: {str(payload)[:200]}")
                out.append(payload[0]["translations"][0]["text"])
                break
            except Exception:
                if attempt == 1:
                    raise
    result = "".join(out)
    if len(_cache) < 5000:
        _cache[ck] = result
    return result


class Handler(BaseHTTPRequestHandler):
    server_version = "papers-manager-translate/1.0"

    def _send(self, code, obj=None, text=None):
        body = (text if text is not None else json.dumps(obj, ensure_ascii=False)).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8" if text is not None
                         else "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/healthz"):
            return self._send(200, text="ok\n")
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/api/translate"):
            return self._send(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except Exception:
            return self._send(400, {"error": "invalid json"})

        texts = payload.get("texts") or []
        if not isinstance(texts, list):
            return self._send(400, {"error": "texts must be a list"})
        src = payload.get("from") or "en"
        dst = payload.get("to") or "zh-Hans"
        try:
            return self._send(200, {"translations": [bing_translate(t, src, dst) for t in texts]})
        except Exception as e:
            return self._send(502, {"error": f"{type(e).__name__}: {e}"})

    def log_message(self, fmt, *args):
        sys.stderr.write("[translate] %s\n" % (fmt % args))


if __name__ == "__main__":
    try:
        _ensure_session()
        sys.stderr.write("[translate] Bing session ready\n")
    except Exception as e:
        sys.stderr.write(f"[translate] warmup failed (will retry on demand): {e}\n")
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    sys.stderr.write(f"[translate] listening on 127.0.0.1:{PORT}\n")
    srv.serve_forever()
