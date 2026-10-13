# -*- coding: utf-8 -*-
"""把 web/src/{updater.css,updater.dom.html,updater.js} 注入 v5 完整版，
生成可部署的单文件应用 web/index.html（含在线更新 + 部署信息面板）。"""
import io, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))          # 方案/
BASE = os.path.join(ROOT, ".scratch", "preview", "v5-dark.html")            # 基底：v5 完整版（应用+82篇数据）
SRC = os.path.join(ROOT, "web", "src")
OUT = os.path.join(ROOT, "web", "index.html")

def read(p):
    with io.open(p, encoding="utf-8") as f:
        return f.read()

def main():
    html = read(BASE)
    css = read(os.path.join(SRC, "updater.css"))
    dom = read(os.path.join(SRC, "updater.dom.html"))
    js = read(os.path.join(SRC, "updater.js"))

    favicon = ('<link rel="icon" href="data:image/svg+xml,'
               '<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22>'
               '<text y=%22.9em%22 font-size=%2290%22>📚</text></svg>">')
    meta = ('<meta name="description" content="论文期刊管理器 · Papers Manager — '
            '纯前端论文库索引与双语阅读，支持 1Panel / Docker 部署，GitHub 在线更新。">'
            '<meta name="color-scheme" content="dark light">')

    head_inject = favicon + meta + "<style>\n" + css + "\n</style>\n"
    assert "</head>" in html, "no </head> marker"
    html = html.replace("</head>", head_inject + "</head>", 1)

    body_inject = "\n<!-- ===== 在线更新 / 部署信息 ===== -->\n" + dom + \
                  "\n<script>\n" + js + "\n</script>\n"
    assert "</body>" in html, "no </body> marker"
    html = html.replace("</body>", body_inject + "</body>", 1)

    with io.open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print("written:", OUT, os.path.getsize(OUT), "bytes")

if __name__ == "__main__":
    main()
