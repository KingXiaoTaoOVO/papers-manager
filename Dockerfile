# 论文期刊管理器 · Papers Manager —— 站点镜像
# 内含单文件应用（html/）+ nginx 配置（conf.d/，含 /translate/ 反代 pdf2zh）
FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="papers-manager" \
      org.opencontainers.image.description="论文期刊管理器 · Papers Manager — 单文件论文库 + PDF 双语翻译入口" \
      org.opencontainers.image.licenses="MIT"

# 站点文件（单文件应用 + 版本清单）
COPY html/ /usr/share/nginx/html/

# nginx 配置（gzip / 缓存 / 健康检查 / /translate/ 反代 pdf2zh:7860）
COPY conf.d/ /etc/nginx/conf.d/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1
