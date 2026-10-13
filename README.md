# 论文期刊管理器 · Papers Manager

纯前端单文件论文库索引与双语阅读工具：拖入论文文件夹即可建立索引，支持中英切换、深浅主题、全文预览、导出索引 JSON。**内置 82 篇论文完整数据**，开箱即用。

- 线上演示：<https://papers.pcb.im>
- 技术形态：单文件 HTML（零构建依赖），Nginx 静态托管，Docker / 1Panel 一键部署
- 在线更新：页面右下角版本胶囊自动对接 GitHub Release，发现新版本即横幅提醒

---

## 一、1Panel 一键部署（推荐）

[![1Panel 一键部署](https://apps.fit2cloud.com/1panel/img/1panel-badge.png)](https://apps.fit2cloud.com/1panel/?appName=papers-manager)

点击徽章会唤起你服务器上的 1Panel 安装向导（需面板已添加本仓库为应用商店来源，见下）。也可以不经过应用商店，直接用编排部署：

1. 1Panel → **容器 → 编排 → 创建编排**
2. 名称填 `papers-manager`，内容粘贴本仓库的 [`docker-compose.yml`](docker-compose.yml)
3. 把镜像地址中的 `KingXiaoTaoOVO` 替换为实际的 GitHub 用户名/组织名
4. 确认后自动拉取镜像并启动，访问 `http://服务器IP:8080`

随后在 **网站** 面板绑定域名 `papers.pcb.im` 反向代理到 `127.0.0.1:8080`，开启 HTTPS 即可。

### 应用商店方式（一次配置，之后真·一键）

1Panel → **应用商店 → 仓库** 中添加第三方商店：

```
https://github.com/KingXiaoTaoOVO/papers-manager
```

刷新后即可在应用商店中看到「论文期刊管理器」，一键安装、一键升级。

## 二、Docker 直接部署

```bash
docker run -d --name papers-manager -p 8080:80 --restart unless-stopped \
  ghcr.io/kingxiaotaovo/papers-manager:latest
```

本地构建镜像：

```bash
docker build -t papers-manager .
docker run -d -p 8080:80 papers-manager
```

## 三、在线更新（GitHub Release）

网站右下角版本胶囊对接本仓库 Release：

1. 修改 `web/index.html`（或 `web/src/*` 后运行 `python web/build.py` 重新生成），同步修改 `web/version.json` 中的 `version`；
2. 提交并打标签推送：

```bash
git tag v5.1.0 && git push origin v5.1.0
```

3. GitHub Actions 自动完成：构建 Docker 镜像推送 `ghcr.io` + 创建带更新日志的 Release；
4. 已部署的网站每 6 小时自动检查一次（也可点版本胶囊手动检查），发现新版本弹出横幅，一键复制更新命令，在服务器执行：

```bash
docker compose pull && docker compose up -d
```

> `version.json` 中 `repo` 字段（`owner/repo`）决定检测目标；本地无仓库预览时留空即可关闭检测。

## 四、本地预览

```bash
cd web && python -m http.server 8080
# 打开 http://localhost:8080
```

## 五、目录结构

```
web/
├── index.html            # 单文件应用（v5 完整版 + 82 篇论文数据 + 更新模块）
├── version.json          # 版本清单（站点更新检测读取）
├── build.py              # 由 .scratch/preview/v5-dark.html + src/ 重新生成 index.html
├── src/                  # 注入层源码（更新面板 CSS/DOM/JS）
├── Dockerfile            # nginx:alpine 镜像定义
├── nginx.conf            # 站点配置（gzip / 缓存 / 健康检查）
├── docker-compose.yml    # 编排文件（1Panel 直接粘贴使用）
├── apps/papers-manager/  # 1Panel 第三方应用商店条目
└── .github/workflows/    # tag 推送 → 构建镜像 + 创建 Release
```

## 许可证

MIT
