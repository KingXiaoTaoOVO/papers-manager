# 论文期刊管理器 · Papers Manager —— 站点镜像（内置 PDF 双语翻译能力）
# nginx 托管单文件应用 + 容器内自带的 Bing 翻译接口（/api/translate）
FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="papers-manager" \
      org.opencontainers.image.description="论文期刊管理器 · Papers Manager — 单文件论文库 + 内置 PDF 双语翻译" \
      org.opencontainers.image.licenses="MIT"

# python3 仅用于内置翻译接口（标准库实现，无第三方依赖）
RUN apk add --no-cache python3

# 站点文件 + nginx 配置 + 内置翻译接口
COPY html/ /usr/share/nginx/html/
COPY conf.d/ /etc/nginx/conf.d/
COPY api/ /app/api/
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1

CMD ["/entrypoint.sh"]
