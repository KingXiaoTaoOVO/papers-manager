# 论文期刊管理器 · Papers Manager（含 PDF 双语翻译）

纯前端单文件论文库 + 内嵌 **pdf2zh** PDF 双语翻译，一套 `docker compose` 起两个服务，开箱即用。

- 线上：<https://papers.pcb.im> ｜ 翻译服务：<https://papers.pcb.im/translate/>
- 技术形态：单文件 HTML（零构建依赖）+ nginx 静态托管 + Gradio 翻译服务，Docker / 1Panel 一键部署
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
│   └── translate.{css,dom.html,js}   # PDF 双语翻译入口（浮动按钮 + 全屏内嵌）
├── translator/               # 翻译工具本体（本地 Windows 用法 + 说明）
│   ├── launch_webui.py       # 增强版启动器（依赖自检 / 端口自愈 / 端口可配）
│   ├── 一键启动PDF双语翻译工具.bat
│   └── README.md
├── docker-compose.yml        # 两个服务：papers-manager(nginx) + pdf2zh
├── Dockerfile                # 可选：把站点打成镜像（ghcr.io/kingxiaotaovo/papers-manager）
├── build.py                  # 由 .scratch/preview/v5-dark.html + src/ 重新生成 html/index.html
├── apps/papers-manager/      # 1Panel 第三方应用商店条目
└── .github/workflows/        # 打 tag → 构建镜像 + 创建 Release
```

## 二、部署（1Panel / Docker）

```bash
docker compose up -d      # 站点 :18080，翻译服务内置（同网络，不对外暴露端口）
```

1Panel 里：**容器 → 编排 → 创建编排**，粘贴 `docker-compose.yml` 内容即可；随后在
**网站** 面板绑定域名反代到 `127.0.0.1:18080`，开启 HTTPS。

> **Cloudflare 用户注意**：若域名走 CF 代理且源站 HTTPS 端口非 443（例如 OpenResty 监听 5055），
> 需要在 CF 的 **Rules → Origin Rules** 里为新域名加一条「Change origin port」，否则会 521。

### 翻译服务是怎么挂上去的

官方镜像原生支持 Gradio 的根路径环境变量，**无需改镜像**：

```yaml
  pdf2zh:
    image: byaidu/pdf2zh:1.9.11
    environment:
      - GRADIO_ROOT_PATH=/translate    # 关键
      - GRADIO_SERVER_NAME=0.0.0.0
```

站点 nginx 再把它反代到子路径（含 WebSocket 升级，Gradio 队列依赖）：

```nginx
location /translate/ {
    proxy_pass http://pdf2zh:7860/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```

页面左下角「**PDF 双语翻译**」按钮点击后全屏内嵌该服务，也可新标签页打开。
`html/version.json` 里的 `translateUrl` 控制入口地址，留空则隐藏入口。

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
