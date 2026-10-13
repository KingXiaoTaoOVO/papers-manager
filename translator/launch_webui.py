# -*- coding: utf-8 -*-
"""
PDF 1:1 格式级双语翻译工具 —— WebUI 启动器（增强版）

相比原版增加：
  1. 启动前依赖自检：pdf2zh / onnx / protobuf 是否完好。历史上的
     `cannot import name 'runtime_version' from 'google.protobuf'` 崩溃会直接给出修复命令
  2. 端口可配：命令行参数或环境变量 PDF2ZH_PORT（默认 7860）
  3. 端口占用自愈（沿用原逻辑，自动清理残留进程）
  4. 启动失败时给出可执行的排查建议，而不是只抛一句异常

用法：
    python launch_webui.py            # 默认 7860
    python launch_webui.py 8080       # 指定端口
    set PDF2ZH_PORT=8080 && python launch_webui.py
"""
import os
import socket
import subprocess
import sys
import time

DEFAULT_PORT = 7860


def log(msg):
    print(msg, flush=True)


def reconfigure_stdout():
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
            sys.stderr.reconfigure(encoding="utf-8")
        except Exception:
            pass


def free_port_if_busy(port):
    """端口被旧进程占用时自动清理（Windows: netstat + taskkill）"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        if s.connect_ex(("127.0.0.1", port)) != 0:
            return
    log(f"  [提示] 端口 {port} 已被占用，正在自动清理旧进程…")
    try:
        if sys.platform == "win32":
            res = subprocess.run(f"netstat -ano | findstr :{port}", shell=True,
                                 capture_output=True, text=True)
            pids = set()
            for line in res.stdout.strip().splitlines():
                parts = line.split()
                if len(parts) >= 5 and "LISTENING" in parts:
                    pid = parts[-1]
                    if pid.isdigit() and int(pid) != os.getpid():
                        pids.add(pid)
            for pid in pids:
                subprocess.run(f"taskkill /F /PID {pid}", shell=True, capture_output=True)
                log(f"  [成功] 已关闭占用端口的旧进程 PID {pid}")
        else:
            subprocess.run(f"fuser -k {port}/tcp", shell=True, capture_output=True)
        time.sleep(1)
    except Exception as err:
        log(f"  [提示] 端口自愈过程信息: {err}")


def preflight():
    """启动前依赖自检，提前发现会导致崩溃的环境问题"""
    problems = []
    pb_ver = None
    try:
        import google.protobuf as pb
        pb_ver = pb.__version__
    except Exception as e:
        problems.append(f"protobuf 不可用：{e}")
    try:
        from google.protobuf import runtime_version  # noqa: F401
    except Exception:
        problems.append("protobuf 版本过旧（缺少 runtime_version，onnx 需要 >= 6.31.1）")
    try:
        import onnx  # noqa: F401
    except Exception as e:
        problems.append(f"onnx 导入失败：{e}")
    try:
        import pdf2zh  # noqa: F401
    except Exception as e:
        problems.append(f"pdf2zh 导入失败：{e}")

    if problems:
        log("=" * 60)
        log("  [依赖自检未通过]")
        for p in problems:
            log("   - " + p)
        log("")
        log("  修复办法（推荐第一条）：")
        log('    pip install -U "protobuf>=6.31.1"')
        log("    pip install -U pdf2zh onnx onnxruntime")
        log("")
        log("  若出现 “Ignoring invalid distribution ~rotobuf”，说明上次升级被中断：")
        log("    先删除 site-packages 下 google/~rotobuf* 与 ~rotobuf*.dist-info 残留，再重装 protobuf")
        log("=" * 60)
        return False
    log(f"  [自检通过] protobuf {pb_ver} · pdf2zh 依赖完整")
    return True


def banner(port):
    log("=" * 60)
    log("  正在启动 PDF 1:1 格式级双语翻译工具 (pdf2zh WebUI)…")
    log(f"  启动后将自动在浏览器中打开：http://localhost:{port}")
    log("")
    log("  【使用要点】")
    log("  1. 左侧【Service (服务)】默认 Bing —— 免费免 Key、国内直连、排版 1:1")
    log("     不要切到 Gemini/OpenAI（除非配置了对应海外 API Key）")
    log("  2. 把 PDF 拖进左侧上传框，点【Translate】即可")
    log("  3. 首次启动需加载 ONNX 模型与字体，约 10-60 秒")
    log("=" * 60)


def main():
    reconfigure_stdout()
    port = DEFAULT_PORT
    if len(sys.argv) > 1 and sys.argv[1].strip().isdigit():
        port = int(sys.argv[1].strip())
    elif os.environ.get("PDF2ZH_PORT", "").strip().isdigit():
        port = int(os.environ["PDF2ZH_PORT"].strip())

    banner(port)
    if not preflight():
        input("\n按回车键退出…")
        return 1

    free_port_if_busy(port)

    try:
        from pdf2zh.pdf2zh import main as pdf2zh_main
        sys.argv = ["pdf2zh", "-i", "--serverport", str(port)]
        pdf2zh_main()
    except SystemExit:
        pass
    except KeyboardInterrupt:
        log("\n已手动停止。")
    except Exception as e:
        log(f"\n[启动出错]: {type(e).__name__}: {e}")
        log("\n排查建议：")
        log("  · 端口被占用 → 运行同目录“关闭后台服务.bat”，或换端口启动")
        log("  · 依赖报错 → 按上方自检提示重装 protobuf / pdf2zh")
        log("  · 首次运行需联网下载 ONNX 模型与字体，请确认可访问外网")
        input("按回车键退出…")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
