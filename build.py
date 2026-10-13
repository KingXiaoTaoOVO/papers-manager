# -*- coding: utf-8 -*-
"""把 web/src/ 下的注入层（在线更新面板 + 内置 PDF 双语翻译）注入 v5 完整版，
生成可部署的单文件应用 web/html/index.html。

基底：.scratch/preview/v5-dark.html（论文期刊管理器 v5 完整版，含 82 篇论文数据）
"""
import io, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))      # 方案/
BASE = os.path.join(ROOT, ".scratch", "preview", "v5-dark.html")
SRC = os.path.join(ROOT, "web", "src")
OUT = os.path.join(ROOT, "web", "html", "index.html")

# 注入顺序：CSS → DOM → JS（每个模块自带 IIFE，互不干扰）
MODULES = [
    ("updater", "updater.css", "updater.dom.html", "updater.js"),
    ("xlate", "xlate.css", "xlate.dom.html", "xlate.js"),
]


def read(p):
    with io.open(p, encoding="utf-8") as f:
        return f.read()


def main():
    html = read(BASE)

    # 生成的高品质矢量图标（告别 emoji），支持深浅色浏览器标签页
    favicon_svg = read(os.path.join(ROOT, "web", "html", "favicon.svg"))
    import urllib.parse
    favicon_uri = "data:image/svg+xml," + urllib.parse.quote(favicon_svg)
    favicon = ('<link rel="icon" type="image/svg+xml" href="%s">\n'
               '<link rel="alternate icon" href="favicon.svg">\n' % favicon_uri)
    meta = ('<meta name="description" content="论文期刊管理器 · Papers Manager — '
            '纯前端论文库索引与双语精读，内置 PDF 双语翻译，支持 1Panel / Docker 部署与 GitHub 在线更新。">'
            '<meta name="color-scheme" content="dark light">')

    css_parts, dom_parts, js_parts = [], [], []
    for name, css_f, dom_f, js_f in MODULES:
        css_parts.append("/* ===== module: %s ===== */\n%s" % (name, read(os.path.join(SRC, css_f))))
        dom_parts.append("<!-- module: %s -->\n%s" % (name, read(os.path.join(SRC, dom_f))))
        js_parts.append("/* ===== module: %s ===== */\n%s" % (name, read(os.path.join(SRC, js_f))))

    head_inject = favicon + meta + "<style>\n" + "\n".join(css_parts) + "\n</style>\n"
    assert "</head>" in html, "no </head> marker"
    html = html.replace("</head>", head_inject + "</head>", 1)

    body_inject = ("\n<!-- ===== 注入层：在线更新 / 部署信息 / PDF 双语翻译 ===== -->\n"
                   + "\n".join(dom_parts)
                   + "\n<script>\n" + "\n".join(js_parts) + "\n</script>\n")
    assert "</body>" in html, "no </body> marker"
    html = html.replace("</body>", body_inject + "</body>", 1)

    with io.open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print("written:", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
