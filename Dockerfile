# 论文期刊管理器 · Papers Manager — 1Panel / Docker 部署镜像
FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="papers-manager" \
      org.opencontainers.image.description="论文期刊管理器 · Papers Manager (static web app with GitHub online update)" \
      org.opencontainers.image.licenses="MIT"

# 站点文件（单文件应用 + 版本清单）
COPY index.html version.json /usr/share/nginx/html/

# nginx 配置（gzip / 缓存 / 健康检查）
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1
