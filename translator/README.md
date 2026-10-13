# PDF 双语翻译 · pdf2zh（本地工具 + 服务端集成）

同一套工具，两种用法：

| 用法 | 入口 | 说明 |
|---|---|---|
| **本地（Windows）** | 双击 `一键启动PDF双语翻译工具.bat` | 在本机启动 Gradio WebUI（默认 http://localhost:7860），PDF 不出本机 |
| **服务端（集成）** | 站点左下角「PDF 双语翻译」 | 由 docker-compose 里的 `pdf2zh` 服务提供，挂在 `https://<你的域名>/translate/` |

## 一、本地启动

```bash
python launch_webui.py          # 默认 7860
python launch_webui.py 8080     # 指定端口
```

启动器会自动：
1. **依赖自检** —— 检查 protobuf / onnx / pdf2zh 是否完好；历史上 `cannot import name 'runtime_version' from 'google.protobuf'` 的崩溃会直接给出修复命令；
2. **端口自愈** —— 检测 7860 被占用时自动清理残留进程；
3. 打印使用要点并自动打开浏览器。

依赖安装（一次性）：

```bash
pip install pdf2zh
```

## 二、服务端集成（docker-compose）

`docker-compose.yml` 里的 `pdf2zh` 服务用官方镜像，通过环境变量挂到站点子路径：

```yaml
  pdf2zh:
    image: byaidu/pdf2zh:1.9.11
    environment:
      - GRADIO_ROOT_PATH=/translate      # 关键：Gradio 原生支持，无需改镜像
      - GRADIO_SERVER_NAME=0.0.0.0
      - GRADIO_SERVER_PORT=7860
```

站点 nginx（`conf.d/default.conf`）把 `/translate/` 反代到 `http://pdf2zh:7860/`，
并转发 WebSocket（Gradio 的任务队列依赖它）。

## 三、使用要点

- 左侧 **Service** 保持 **Bing**：免费免 Key、国内直连、排版 1:1；
- 切到 Gemini/OpenAI 需要对应海外 API Key，否则会报错；
- 首次翻译会加载 ONNX 版面模型与中文字体，约 10–60 秒，之后走缓存；
- 输出两个文件：`*-mono.pdf`（纯译文）与 `*-dual.pdf`（双语对照）。

## 四、常见问题

| 现象 | 处理 |
|---|---|
| `cannot import name 'runtime_version'` | `pip install -U "protobuf>=6.31.1"` |
| `Ignoring invalid distribution ~rotobuf` | 上次升级中断：删掉 `site-packages/google/~rotobuf*` 与 `~rotobuf*.dist-info` 后重装 protobuf |
| 端口 7860 被占用 | 启动器会自动清理；也可 `python launch_webui.py 8080` |
| 页面空白/资源 404 | 服务端需保证 `GRADIO_ROOT_PATH=/translate` 与 nginx 的 `location /translate/` 前缀一致 |
