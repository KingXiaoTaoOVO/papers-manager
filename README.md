# 论文期刊管理器 · Papers Manager（含 PDF 双语翻译）

纯前端单文件论文库 + **容器内置** PDF 双语翻译（Bing 引擎，无需 Key、无外部服务），单容器 `docker compose` 开箱即用。

- 线上：<https://papers.pcb.im>（左下角「PDF 双语翻译」为内置面板）
- 技术形态：单文件 HTML + nginx + 容器内自带的 Python 翻译接口，**单容器** Docker / 1Panel 一键部署
- 在线更新：页面右下角版本胶囊自动对接 GitHub Release，发现新版本即横幅提醒
- 内置数据：**104 篇论文**（含中英标题、摘要、全文翻译、DOI/PMID/PMC）

---

## 一、目录结构

```
web/
├── html/                     # 站点内容（nginx 挂载目录）
│   ├── index.html            # 单文件应用（v5 完整版 + 数据 + 两个注入模块）
│   └── version.json          # 版本清单（在线更新 + 翻译入口地址都读这里）
├── conf.d/
│   └── default.conf          # nginx 站点配置（gzip / 缓存 / 健康检查 / /translate/ 反代）
├── src/                      # 注入层源码（由 build.py 打进 index.html）
│   ├── updater.{css,dom.html,js}     # 在线更新 + 部署信息面板
│   └── xlate.{css,dom.html,js}       # 内置 PDF 双语翻译面板（原生集成）
├── translator/               # 翻译工具本体（本地 Windows 用法 + 说明）
│   ├── launch_webui.py       # 增强版启动器（依赖自检 / 端口自愈 / 端口可配）
│   ├── 一键启动PDF双语翻译工具.bat
│   └── README.md
├── api/translate_api.py      # 容器内置翻译接口（Python 标准库，Bing 后端）
├── entrypoint.sh             # 容器入口（翻译接口 + nginx）
├── docker-compose.yml        # 单容器：papers-manager（站点 + 翻译能力）
├── Dockerfile                # 可选：把站点打成镜像（ghcr.io/kingxiaotaovo/papers-manager）
├── build.py                  # 由 .scratch/preview/v5-dark.html + src/ 重新生成 html/index.html
├── apps/papers-manager/      # 1Panel 第三方应用商店条目
└── .github/workflows/        # 打 tag → 构建镜像 + 创建 Release
```

## 二、部署（1Panel / Docker）

```bash
docker compose up -d --build   # 构建并启动单容器，站点 :18080，翻译能力内置
```

1Panel 里：**容器 → 编排 → 创建编排**，粘贴 `docker-compose.yml` 内容即可；随后在
**网站** 面板绑定域名反代到 `127.0.0.1:18080`，开启 HTTPS。

> **Cloudflare 用户注意**：若域名走 CF 代理且源站 HTTPS 端口非 443（例如 OpenResty 监听 5055），
> 需要在 CF 的 **Rules → Origin Rules** 里为新域名加一条「Change origin port」，否则会 521。

### 翻译能力是怎么集成进去的

**没有任何独立服务/容器**，翻译能力就在论文项目自己的容器里：

1. **前端**（`src/xlate.js`）：拖入 PDF → 用 pdf.js 在浏览器本地抽取段落 → 分段调用站点自己的接口；纯文本可直接粘贴。
2. **后端**（`api/translate_api.py`）：容器内一个零依赖的 Python 接口（仅标准库），
   走 Bing 翻译（与 pdf2zh 的 Bing 后端同一套接口），因此**国内直连、免 Key**；
   nginx 把 `POST /api/translate` 转发到容器内的 `127.0.0.1:8765`，浏览器同源调用，无跨域问题。
3. 结果以左右双语对照呈现，支持进度、停止与 Markdown 导出。

> 需要「保持排版的 PDF 成品文件（mono/dual PDF）」时，仍可用仓库里的 `translator/` 本地工具
> （基于 pdf2zh，本机运行，文件不出本机）。

## 三、本地 Windows 使用翻译工具

```bash
cd translator
python launch_webui.py        # 默认 http://localhost:7860
```

启动器会先做依赖自检（protobuf / onnx / pdf2zh），端口被占用时自动清理，
失败时给出可执行的修复命令。详见 `translator/README.md`。

## 四、在线更新（GitHub Release）

1. 改 `html/index.html`（或改 `src/` 后运行 `python build.py` 重新生成），同步升 `html/version.json` 的 `version`；
2. 打标签推送：

```bash
git tag v5.2.0 && git push origin v5.2.0
```

3. GitHub Actions 自动：构建镜像推送 `ghcr.io` + 创建带更新日志的 Release；
4. 已部署站点每 6 小时自动检查（也可点版本胶囊手动检查），发现新版本弹横幅，
   一键复制更新命令，在服务器执行：

```bash
docker compose pull && docker compose up -d
```

## 五、1Panel 应用商店（可选）

在 1Panel **应用商店 → 仓库** 添加本仓库地址，即可在应用商店里一键安装/升级：

```
https://github.com/KingXiaoTaoOVO/papers-manager
```

## 许可证

MIT
