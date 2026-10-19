#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Papers Manager 学术文献翻译与多人协同服务端 (v5.4.0)
------------------------------------------------------
功能特性：
  1. 多引擎翻译：
     - Bing 神经网络翻译（零依赖标准库实现，免 Key，国内秒级直连）
     - OpenAI / DeepSeek 学术大模型引擎（支持自定义 API Key、BaseUrl 与模型）
     - 公式与代码块保护机制（保护 LaTeX $...$、$$...$$ 与公式标签，不被破坏）
  2. 格式级 Word (.docx) 双语与单语翻译引擎：
     - 基于标准库 zipfile + xml.etree.ElementTree，零外部依赖
     - 1:1 保留标题级别、粗体/斜体、颜色、表格网格与单元格排版
     - 支持「双语对照 (Dual)」与「单语纯译 (Mono)」两套导出
  3. 多人协同与并发支持：
     - 多用户会话隔离与任务 UUID 追踪
     - 实时在线研读学者状态指示器（Presence 心跳）
     - 团队翻译成果云端共享库（一人翻译，全员秒开）
     - 共享研读批注与学术讨论同步
  4. 健康检查与下载服务：
     - /healthz 健康探活
     - /api/translations/download/<file> 译文文档下载
"""

import base64
import copy
import io
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
import xml.etree.ElementTree as ET
from http.cookiejar import CookieJar
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
DATA_DIR = os.environ.get("PAPERS_DATA_DIR", "/app/data" if os.path.exists("/app") else os.path.join(os.path.expanduser("~"), ".papers_manager_data"))
TRANSLATIONS_DIR = os.path.join(DATA_DIR, "translations")
os.makedirs(TRANSLATIONS_DIR, exist_ok=True)

# Bing 常量
BING_HOME = "https://www.bing.com/translator"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0")
MAX_CHARS = 1000
TOKEN_TTL = 600

SRC_MAP = {"auto": "auto-detect", "zh": "zh-Hans", "zh-CN": "zh-Hans", "zh-TW": "zh-Hant"}
DST_MAP = {"zh": "zh-Hans", "zh-CN": "zh-Hans", "zh-TW": "zh-Hant"}

_lock = threading.Lock()
_bing_session = {"opener": None, "url": None, "ig": None, "iid": None,
                 "key": None, "token": None, "ts": 0}
_text_cache = {}

# 多人协作内存存储（真实学者设备/IP 强去重，避免刷新累加）
PRESENCE_TTL = 35         # 35秒活跃超时（前端每15秒发送心跳）
_presence = {}            # {visitor_key: {"ip": str, "clientId": str, "name": str, "last_seen": float, "reading": str}}
_shared_translations = {} # {paper_key: {"title": str, "mode": str, "dual_file": str, "mono_file": str, "time": str, "paras": list}}
_collab_notes = {}        # {paper_id: [{"id": str, "user": str, "content": str, "time": str}]}

def _get_client_ip(headers, client_address):
    """从 1Panel/Nginx/Cloudflare 请求头穿透提取真实客户端 IP"""
    for h in ("cf-connecting-ip", "x-real-ip", "x-forwarded-for"):
        val = headers.get(h)
        if val:
            ip = val.split(",")[0].strip()
            if ip:
                return ip
    return client_address[0] if client_address else "127.0.0.1"

def _get_active_presence():
    """获取当前真实在线学者状态（严格去重）"""
    now = time.time()
    with _lock:
        expired = [k for k, v in _presence.items() if now - v.get("last_seen", 0) > PRESENCE_TTL]
        for k in expired:
            del _presence[k]
        active = list(_presence.values())
        # 统计真实在线学者数（按 IP + 设备独立去重，同台设备同IP刷新绝不累加）
        unique_visitors = set(f"{v['ip']}::{v.get('clientId', '')}" for v in active)
        online_count = max(1, len(unique_visitors))
    return online_count, active

# 尝试载入持久化数据
PERSIST_FILE = os.path.join(DATA_DIR, "collab_state.json")
def _load_persist():
    global _shared_translations, _collab_notes
    if os.path.exists(PERSIST_FILE):
        try:
            with open(PERSIST_FILE, "r", encoding="utf-8") as f:
                d = json.load(f)
                _shared_translations = d.get("translations", {})
                _collab_notes = d.get("notes", {})
        except Exception as e:
            sys.stderr.write(f"[persist] load error: {e}\n")

def _save_persist():
    try:
        with open(PERSIST_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "translations": _shared_translations,
                "notes": _collab_notes
            }, f, ensure_ascii=False, indent=2)
    except Exception as e:
        sys.stderr.write(f"[persist] save error: {e}\n")

_load_persist()

# -----------------------------------------------------------------------------
# 论文库动态存储与管理员状态
# -----------------------------------------------------------------------------
PAPERS_FILES_DIR = os.path.join(DATA_DIR, "papers_files")
os.makedirs(PAPERS_FILES_DIR, exist_ok=True)
USER_PAPERS_FILE = os.path.join(DATA_DIR, "user_papers.json")
PAPERS_META_FILE = os.path.join(DATA_DIR, "papers_meta.json")

ADMIN_PASS = os.environ.get("PAPERS_ADMIN_PASS", "root@panel")
_admin_tokens = set()
_user_papers = []          # 用户/管理员上传的文献列表
_deleted_paper_ids = set() # 被删除的文献 ID 集合（支持内置和用户文献）

def _load_papers_state():
    global _user_papers, _deleted_paper_ids
    if os.path.exists(USER_PAPERS_FILE):
        try:
            with open(USER_PAPERS_FILE, "r", encoding="utf-8") as f:
                _user_papers = json.load(f)
        except Exception as e:
            sys.stderr.write(f"[papers] load user_papers error: {e}\n")
    if os.path.exists(PAPERS_META_FILE):
        try:
            with open(PAPERS_META_FILE, "r", encoding="utf-8") as f:
                meta = json.load(f)
                _deleted_paper_ids = set(str(x) for x in meta.get("deleted_ids", []))
        except Exception as e:
            sys.stderr.write(f"[papers] load meta error: {e}\n")

def _save_papers_state():
    try:
        with open(USER_PAPERS_FILE, "w", encoding="utf-8") as f:
            json.dump(_user_papers, f, ensure_ascii=False, indent=2)
        with open(PAPERS_META_FILE, "w", encoding="utf-8") as f:
            json.dump({"deleted_ids": list(_deleted_paper_ids)}, f, ensure_ascii=False, indent=2)
    except Exception as e:
        sys.stderr.write(f"[papers] save error: {e}\n")

_load_papers_state()

def infer_academic_category(text):
    """根据文献标题、摘要及关键词推断学科大类"""
    t = (text or "").lower()
    if re.search(r"\b(ieee|neural network|deep learning|machine learning|computing|affective computing|algorithm|artificial intelligence|transformer|llm|computer vision|reinforcement|人工智能|深度学习|计算|模型|神经网络)\b", t):
        return "人工智能与计算科学"
    if re.search(r"\b(neuro|brain|eeg|cortex|cerebr|synapse|cognitive neuroscience|fmri|脑|神经|皮层|脑电)\b", t):
        return "神经科学与脑科学"
    if re.search(r"\b(psychol|well-being|mindful|meditat|depress|anxiety|stress|emotion|affect|happiness|resilience|心理|冥想|正念|幸福感|情绪|行为|疲劳|压力)\b", t):
        return "心理学与认知行为"
    if re.search(r"\b(lancet|jama|clinical|medicine|health|trial|patient|therapy|rct|disease|mortality|epidemiology|cancer|cardiac|public health|医学|临床|健康|治疗|患者|精神医学)\b", t):
        return "临床医学与公共健康"
    if re.search(r"\b(cell|gene|protein|dna|rna|molecular|bio|biomarker|crispr|pharmac|生命|细胞|生物|基因|蛋白)\b", t):
        return "生物医药与生命科学"
    if re.search(r"\b(sensor|physic|engineering|device|material|quantum|optics|nanomaterial|mechanics|semiconductor|传感器|工程|器件|物理)\b", t):
        return "物理与工程技术"
    return "人工智能与计算科学"

def search_crossref_api(query_str, limit=10):
    """对接 Crossref 国际学术元数据开放接口 (涵盖 Nature, IEEE, Elsevier, Springer 等顶刊)"""
    url = f"https://api.crossref.org/works?query={urllib.parse.quote(query_str)}&rows={limit}"
    req = urllib.request.Request(url, headers={"User-Agent": "PapersManager/5.4 (mailto:admin@pcb.im)"})
    with urllib.request.urlopen(req, timeout=12) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    items = []
    for it in data.get("message", {}).get("items", []):
        doi = it.get("DOI", "")
        title_list = it.get("title", [])
        title = title_list[0] if title_list else ""
        if not title:
            continue
        authors = []
        for a in it.get("author", []):
            name = (a.get("given", "") + " " + a.get("family", "")).strip() or a.get("name", "")
            if name:
                authors.append(name)
        journals = it.get("container-title", [])
        journal = journals[0] if journals else "Academic Journal"
        year = ""
        dp = it.get("published", {}).get("date-parts", []) or it.get("created", {}).get("date-parts", [])
        if dp and dp[0]:
            year = str(dp[0][0])
        raw_abs = it.get("abstract", "")
        clean_abs = re.sub(r"<[^>]+>", "", raw_abs).strip()
        items.append({
            "id": f"cr_{doi.replace('/', '_')}",
            "titleEN": title,
            "titleCN": "",
            "authors": authors[:5],
            "journal": journal,
            "year": year or time.strftime("%Y"),
            "abstractEN": clean_abs,
            "abstractCN": "",
            "abstract": clean_abs,
            "doi": doi,
            "url": it.get("URL") or f"https://doi.org/{doi}",
            "source": "Crossref 国际文库",
            "category": infer_academic_category(title + " " + clean_abs)
        })
    return items

def search_arxiv_api(query_str, limit=10):
    """对接 arXiv 国际顶尖学术预印本文库接口"""
    url = f"http://export.arxiv.org/api/query?search_query=all:{urllib.parse.quote(query_str)}&start=0&max_results={limit}&sortBy=relevance"
    req = urllib.request.Request(url, headers={"User-Agent": "PapersManager/5.4"})
    with urllib.request.urlopen(req, timeout=12) as resp:
        xml_data = resp.read()
    root = ET.fromstring(xml_data)
    ns = {"atom": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}
    items = []
    for entry in root.findall("atom:entry", ns):
        title_el = entry.find("atom:title", ns)
        title = re.sub(r"\s+", " ", title_el.text or "").strip() if title_el is not None else ""
        if not title:
            continue
        summary_el = entry.find("atom:summary", ns)
        summary = re.sub(r"\s+", " ", summary_el.text or "").strip() if summary_el is not None else ""
        pub_el = entry.find("atom:published", ns)
        year = pub_el.text[:4] if pub_el is not None and pub_el.text else time.strftime("%Y")
        authors = []
        for a in entry.findall("atom:author", ns):
            nm = a.find("atom:name", ns)
            if nm is not None and nm.text:
                authors.append(nm.text.strip())
        id_el = entry.find("atom:id", ns)
        arxiv_raw_id = id_el.text.strip() if id_el is not None and id_el.text else ""
        arxiv_id = os.path.basename(arxiv_raw_id)
        pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf" if arxiv_id else ""
        items.append({
            "id": f"arxiv_{arxiv_id}",
            "titleEN": title,
            "titleCN": "",
            "authors": authors[:5],
            "journal": "arXiv Preprint",
            "year": year,
            "abstractEN": summary,
            "abstractCN": "",
            "abstract": summary,
            "doi": f"10.48550/arXiv.{arxiv_id}" if arxiv_id else "",
            "pdfUrl": pdf_url,
            "url": arxiv_raw_id,
            "source": "arXiv 全球预印本",
            "category": infer_academic_category(title + " " + summary)
        })
    return items

def expand_bilingual_query(q):
    """学术搜索词中英双向智能互通拓展"""
    q = (q or "").strip()
    if not q:
        return "", ""
    has_cn = bool(re.search(r"[\u4e00-\u9fa5]", q))
    en_q = q
    cn_q = q
    if has_cn:
        try:
            en_q = bing_translate_single(q, src="zh-Hans", dst="en")
        except Exception:
            en_q = q
    else:
        try:
            cn_q = bing_translate_single(q, src="en", dst="zh-Hans")
        except Exception:
            cn_q = q
    return cn_q, en_q



# ==============================================================================
# 1. 神经网络与大模型翻译内核（含 LaTeX 数学公式保护）
# ==============================================================================

def _get_bing_opener():
    if _bing_session["opener"] is None:
        _bing_session["opener"] = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(CookieJar()))
    return _bing_session["opener"]


def _refresh_bing_session():
    req = urllib.request.Request(BING_HOME, headers={"User-Agent": UA})
    with _get_bing_opener().open(req, timeout=25) as resp:
        html = resp.read().decode("utf-8", "replace")
        final = resp.geturl()
    url = final[:-10] if final.endswith("/translator") else final.rstrip("/") + "/"
    ig = re.findall(r'"ig":"(.*?)"', html)
    iid = re.findall(r'data-iid="(.*?)"', html)
    kt = re.findall(r'params_AbusePreventionHelper\s=\s\[(.*?),"(.*?)",', html)
    if not (ig and iid and kt):
        raise RuntimeError("Bing 页面结构变化，未能取到 IG/IID/token")
    with _lock:
        _bing_session.update({"url": url, "ig": ig[0], "iid": iid[-1],
                              "key": kt[0][0], "token": kt[0][1], "ts": time.time()})
    return _bing_session


def _ensure_bing_session(force=False):
    with _lock:
        fresh = _bing_session["ig"] and (time.time() - _bing_session["ts"] < TOKEN_TTL)
    if force or not fresh:
        _refresh_bing_session()
    return _bing_session


def _protect_math(text):
    """提取并保护 LaTeX 数学公式、行内公式与特殊符号"""
    math_tokens = []
    def _sub_block(m):
        idx = len(math_tokens)
        math_tokens.append(m.group(0))
        return f" __MATH_BLOCK_{idx}__ "

    def _sub_inline(m):
        idx = len(math_tokens)
        math_tokens.append(m.group(0))
        return f" __MATH_INLINE_{idx}__ "

    # 1. 块级公式 $$ ... $$ 或 \begin{...} ... \end{...}
    t = re.sub(r"\$\$[\s\S]*?\$\$", _sub_block, text)
    t = re.sub(r"\\begin\{[a-zA-Z*]+\}[\s\S]*?\\end\{[a-zA-Z*]+\}", _sub_block, t)
    # 2. 行内公式 $ ... $
    t = re.sub(r"(?<!\\)\$([^\$\n]+?)(?<!\\)\$", _sub_inline, t)
    return t, math_tokens


def _restore_math(text, math_tokens):
    """精准还原保护的数学公式"""
    for i, tok in enumerate(math_tokens):
        # 允许翻译引擎在 token 前后添加空格或改变下划线间距
        pat_b = re.compile(rf"__\s*MATH_BLOCK_{i}\s*__", re.IGNORECASE)
        pat_i = re.compile(rf"__\s*MATH_INLINE_{i}\s*__", re.IGNORECASE)
        text = pat_b.sub(tok, text)
        text = pat_i.sub(tok, text)
    return text


def _chunks(text, limit=MAX_CHARS):
    if len(text) <= limit:
        return [text]
    parts, buf = [], ""
    for piece in re.split(r"(?<=[.!?。！？；;])\s*", text):
        if len(buf) + len(piece) > limit and buf:
            parts.append(buf)
            buf = piece
        else:
            buf += piece
        while len(buf) > limit:
            parts.append(buf[:limit])
            buf = buf[limit:]
    if buf:
        parts.append(buf)
    return parts


def bing_translate_single(text, src="en", dst="zh-Hans"):
    text = (text or "").strip()
    if not text:
        return ""
    src = SRC_MAP.get(src, src)
    dst = DST_MAP.get(dst, dst)
    ck = (src, dst, text)
    if ck in _text_cache:
        return _text_cache[ck]

    masked_text, math_tokens = _protect_math(text)

    out = []
    for chunk in _chunks(masked_text):
        for attempt in (0, 1):
            s = _ensure_bing_session(force=attempt == 1)
            data = urllib.parse.urlencode({
                "fromLang": src, "to": dst, "text": chunk,
                "token": s["token"], "key": s["key"],
            }).encode()
            req = urllib.request.Request(
                f"{s['url']}ttranslatev3?IG={s['ig']}&IID={s['iid']}",
                data=data, headers={"User-Agent": UA,
                                    "Content-Type": "application/x-www-form-urlencoded"})
            try:
                with _get_bing_opener().open(req, timeout=30) as resp:
                    payload = json.loads(resp.read().decode("utf-8", "replace"))
                if not isinstance(payload, list) or not payload:
                    raise RuntimeError(f"Bing 返回异常: {str(payload)[:200]}")
                out.append(payload[0]["translations"][0]["text"])
                break
            except Exception:
                if attempt == 1:
                    raise

    translated = "".join(out)
    result = _restore_math(translated, math_tokens)
    if len(_text_cache) < 5000:
        _text_cache[ck] = result
    return result


def llm_translate_batch(texts, src="en", dst="zh", api_key=None, base_url=None, model="deepseek-chat"):
    """学术大模型翻译（DeepSeek / OpenAI 兼容接口）"""
    if not api_key:
        raise ValueError("LLM 翻译需要提供 API Key")
    base_url = (base_url or "https://api.deepseek.com/v1").rstrip("/")
    url = f"{base_url}/chat/completions"

    system_prompt = (
        "你是一位精通自然科学、工程计算与医学文献的资深学术翻译专家。\n"
        f"请将用户输入的学术段落从 [{src}] 准确翻译为 [{dst}]。\n"
        "要求：\n"
        "1. 严格保留所有 LaTeX 公式（如 $...$, $$...$$, \\begin{equation}...）、变量名、数字与引用符号不变。\n"
        "2. 学术专有名词符合中文学术界通用翻译标准。\n"
        "3. 输出格式：直接按输入的 JSON 数组格式返回等长的译文字符串数组，不附加任何其他解释或 Markdown 标记。"
    )

    user_content = json.dumps(texts, ensure_ascii=False)
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"请翻译以下文本数组：\n{user_content}"}
        ],
        "temperature": 0.2
    }

    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "Papers-Manager/5.3"
        }
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        res = json.loads(resp.read().decode("utf-8"))
    content = res["choices"][0]["message"]["content"].strip()
    if content.startswith("```"):
        content = re.sub(r"^```[a-zA-Z]*\n?", "", content)
        content = re.sub(r"```$", "", content).strip()
    try:
        parsed = json.loads(content)
        if isinstance(parsed, list) and len(parsed) == len(texts):
            return parsed
    except Exception:
        pass
    # 容错处理：若返回非合规 JSON 数组，降级回 Bing 或按行拆分
    return [bing_translate_single(t, src, dst) for t in texts]


def translate_texts(texts, src="en", dst="zh-Hans", service="bing", llm_cfg=None):
    if not texts:
        return []
    if service in ("openai", "deepseek", "llm") and llm_cfg and llm_cfg.get("apiKey"):
        return llm_translate_batch(
            texts, src=src, dst=dst,
            api_key=llm_cfg.get("apiKey"),
            base_url=llm_cfg.get("baseUrl"),
            model=llm_cfg.get("model", "deepseek-chat")
        )
    # 默认 Bing 并发/顺序翻译
    out = []
    for t in texts:
        out.append(bing_translate_single(t, src, dst))
    return out


# ==============================================================================
# 2. 格式级 Word (.docx) 1:1 双语对照与单语生成内核
# ==============================================================================

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
ET.register_namespace("w", W_NS)

def _get_para_text(p_elem):
    texts = []
    for t in p_elem.iter(f"{{{W_NS}}}t"):
        if t.text:
            texts.append(t.text)
    return "".join(texts).strip()

def _set_para_text(p_elem, new_text):
    t_elems = list(p_elem.iter(f"{{{W_NS}}}t"))
    if not t_elems:
        r = ET.SubElement(p_elem, f"{{{W_NS}}}r")
        t = ET.SubElement(r, f"{{{W_NS}}}t")
        t.text = new_text
        return
    t_elems[0].text = new_text
    for other in t_elems[1:]:
        other.text = ""

def translate_docx_bytes(docx_bytes, mode="dual", src="en", dst="zh-Hans", service="bing", llm_cfg=None):
    """
    接收 docx 字节流，原版样式保留，返回翻译后的 docx 字节流
    mode: 'dual' (双语对照) 或 'mono' (单语译文)
    """
    in_zip = zipfile.ZipFile(io.BytesIO(docx_bytes))
    out_bio = io.BytesIO()
    out_zip = zipfile.ZipFile(out_bio, "w", zipfile.ZIP_DEFLATED)

    doc_xml_name = "word/document.xml"
    if doc_xml_name not in in_zip.namelist():
        raise ValueError("Invalid docx: word/document.xml not found")

    doc_xml = in_zip.read(doc_xml_name)
    tree = ET.fromstring(doc_xml)
    body = tree.find(f"{{{W_NS}}}body")
    if body is None:
        raise ValueError("Invalid docx: body element missing")

    # 抽取所有段落及表格单元格中的段落
    all_paras = []
    for p in body.iter(f"{{{W_NS}}}p"):
        txt = _get_para_text(p)
        if txt and len(txt) > 1 and not txt.isdigit():
            all_paras.append((p, txt))

    # 批量翻译段落
    texts_to_translate = [txt for _, txt in all_paras]
    translations = []
    BATCH = 10
    for i in range(0, len(texts_to_translate), BATCH):
        batch = texts_to_translate[i:i+BATCH]
        trans_batch = translate_texts(batch, src=src, dst=dst, service=service, llm_cfg=llm_cfg)
        translations.extend(trans_batch)

    # 映射回 DOM
    trans_map = {}
    for (p, _), trans in zip(all_paras, translations):
        trans_map[id(p)] = trans

    if mode == "mono":
        for p, _ in all_paras:
            trans = trans_map.get(id(p))
            if trans:
                _set_para_text(p, trans)
    else: # dual
        # 在原段落后插入译文段落
        # 遍历 body 直接子级元素
        for parent in list(body):
            # 处理直接段落
            if parent.tag == f"{{{W_NS}}}p":
                trans = trans_map.get(id(parent))
                if trans:
                    p_trans = copy.deepcopy(parent)
                    _set_para_text(p_trans, trans)
                    # 可以在 p_trans 增加样式高亮，保持原结构
                    idx = list(body).index(parent)
                    body.insert(idx + 1, p_trans)
            # 处理表格中的段落
            elif parent.tag == f"{{{W_NS}}}tbl":
                for row in parent.iter(f"{{{W_NS}}}tr"):
                    for tc in row.iter(f"{{{W_NS}}}tc"):
                        for tc_p in list(tc):
                            if tc_p.tag == f"{{{W_NS}}}p":
                                trans = trans_map.get(id(tc_p))
                                if trans:
                                    p_trans = copy.deepcopy(tc_p)
                                    _set_para_text(p_trans, trans)
                                    p_idx = list(tc).index(tc_p)
                                    tc.insert(p_idx + 1, p_trans)

    # 重构并写回 zip
    new_doc_xml = ET.tostring(tree, encoding="utf-8", xml_declaration=True)
    for item in in_zip.infolist():
        if item.filename == doc_xml_name:
            out_zip.writestr(item, new_doc_xml)
        else:
            out_zip.writestr(item, in_zip.read(item.filename))

    out_zip.close()
    in_zip.close()
    return out_bio.getvalue(), len(all_paras)


# ==============================================================================
# 3. HTTP 服务路由与多用户协同接口
# ==============================================================================

class Handler(BaseHTTPRequestHandler):
    server_version = "papers-manager-backend/5.3"

    def _send(self, code, obj=None, text=None, raw_bytes=None, content_type=None):
        if raw_bytes is not None:
            body = raw_bytes
            ctype = content_type or "application/octet-stream"
        elif text is not None:
            body = text.encode("utf-8")
            ctype = "text/plain; charset=utf-8"
        else:
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            ctype = "application/json; charset=utf-8"

        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, raw_bytes=b"")

    def do_GET(self):
        path = self.path.split("?")[0]
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)

        # 1. 探活
        if path == "/healthz":
            return self._send(200, text="ok\n")

        # 2. 在线协同学者状态
        if path == "/api/collab/presence":
            online_count, active = _get_active_presence()
            return self._send(200, {
                "online_count": online_count,
                "users": active
            })

        # 3. 共享翻译成果查询
        if path == "/api/collab/translations":
            key = query.get("key", [""])[0]
            if key and key in _shared_translations:
                return self._send(200, {"found": True, "item": _shared_translations[key]})
            return self._send(200, {"found": False, "total": len(_shared_translations), "keys": list(_shared_translations.keys())})

        # 4. 共享批注与研读讨论查询
        if path == "/api/collab/notes":
            paper_id = query.get("paperId", [""])[0]
            notes = _collab_notes.get(paper_id, [])
            return self._send(200, {"notes": notes})

        # 5. 翻译生成文件下载
        if path.startswith("/api/translations/download/"):
            fname = os.path.basename(path)
            fpath = os.path.join(TRANSLATIONS_DIR, fname)
            if not os.path.exists(fpath):
                return self._send(404, {"error": "file not found"})
            with open(fpath, "rb") as f:
                content = f.read()
            ctype = "application/vnd.openxmlformats-officedocument.wordprocessingml.document" if fname.endswith(".docx") else "application/pdf"
            return self._send(200, raw_bytes=content, content_type=ctype)

        # 6. 文献列表与已删除清单获取
        if path == "/api/papers/list":
            return self._send(200, {
                "ok": True,
                "user_papers": _user_papers,
                "deleted_ids": list(_deleted_paper_ids)
            })

        # 7. 用户上传文献原件下载
        if path.startswith("/api/papers/download/"):
            fname = os.path.basename(path)
            fpath = os.path.join(PAPERS_FILES_DIR, fname)
            if not os.path.exists(fpath):
                return self._send(404, {"error": "file not found"})
            with open(fpath, "rb") as f:
                content = f.read()
            ctype = "application/pdf" if fname.endswith(".pdf") else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            return self._send(200, raw_bytes=content, content_type=ctype)

        # 8. 全球知名论文体系搜索 (arXiv + Crossref 开放 API)
        if path == "/api/papers/search_global":
            q = query.get("q", [""])[0].strip()
            source = query.get("source", ["all"])[0].strip()
            limit = min(25, max(1, int(query.get("limit", [10])[0])))
            if not q:
                return self._send(200, {"ok": True, "papers": []})
            cn_q, en_q = expand_bilingual_query(q)
            results = []
            search_kw = en_q or q
            if source in ("all", "arxiv"):
                try:
                    results.extend(search_arxiv_api(search_kw, limit=limit))
                except Exception as e:
                    sys.stderr.write(f"[arxiv_search] error: {e}\n")
            if source in ("all", "crossref"):
                try:
                    results.extend(search_crossref_api(search_kw, limit=limit))
                except Exception as e:
                    sys.stderr.write(f"[crossref_search] error: {e}\n")
            return self._send(200, {
                "ok": True,
                "query": q,
                "query_cn": cn_q,
                "query_en": en_q,
                "total": len(results),
                "papers": results
            })

        # 9. 中英学术词汇双向智能扩展
        if path == "/api/papers/expand_query":
            q = query.get("q", [""])[0].strip()
            cn_q, en_q = expand_bilingual_query(q)
            return self._send(200, {"ok": True, "query": q, "cn": cn_q, "en": en_q})

        return self._send(404, {"error": "not found"})

    def do_POST(self):
        global _user_papers, _deleted_paper_ids, _admin_tokens
        path = self.path.split("?")[0]
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except Exception:
            return self._send(400, {"error": "invalid json"})

        # 1. 在线协同心跳（真实 IP + 稳定设备标识严格去重）
        if path == "/api/collab/presence":
            client_ip = _get_client_ip(self.headers, self.client_address)
            client_id = (payload.get("clientId") or "").strip()
            if not client_id:
                client_id = "v_" + client_ip.replace(".", "_").replace(":", "_")
            name = payload.get("name") or "匿名学者"
            reading = payload.get("reading") or ""
            visitor_key = f"{client_ip}::{client_id}"
            with _lock:
                _presence[visitor_key] = {
                    "ip": client_ip,
                    "clientId": client_id,
                    "name": name,
                    "reading": reading,
                    "last_seen": time.time()
                }
            online_count, _ = _get_active_presence()
            return self._send(200, {"ok": True, "online_count": online_count})

        # 1.5 学者离线通知（页面卸载 / 关闭时发送，立即释放会话）
        if path == "/api/collab/leave":
            client_ip = _get_client_ip(self.headers, self.client_address)
            client_id = (payload.get("clientId") or "").strip()
            visitor_key = f"{client_ip}::{client_id}"
            with _lock:
                _presence.pop(visitor_key, None)
            online_count, _ = _get_active_presence()
            return self._send(200, {"ok": True, "online_count": online_count})

        # 2. 文本批量翻译（兼容旧版与新版，支持 Bing / DeepSeek）
        if path == "/api/translate":
            texts = payload.get("texts") or []
            src = payload.get("from") or "en"
            dst = payload.get("to") or "zh-Hans"
            service = payload.get("service") or "bing"
            llm_cfg = payload.get("llm") or {}
            try:
                translations = translate_texts(texts, src=src, dst=dst, service=service, llm_cfg=llm_cfg)
                return self._send(200, {"translations": translations})
            except Exception as e:
                return self._send(502, {"error": f"{type(e).__name__}: {e}"})

        # 3. 格式级 Word (.docx) 文档翻译与生成
        if path == "/api/translate/docx":
            file_b64 = payload.get("fileBase64")
            if not file_b64:
                return self._send(400, {"error": "fileBase64 required"})
            mode = payload.get("mode") or "dual"
            src = payload.get("from") or "en"
            dst = payload.get("to") or "zh-Hans"
            service = payload.get("service") or "bing"
            llm_cfg = payload.get("llm") or {}
            paper_key = payload.get("paperKey") or ""

            try:
                raw_bytes = base64.b64decode(file_b64)
                out_bytes, para_count = translate_docx_bytes(
                    raw_bytes, mode=mode, src=src, dst=dst, service=service, llm_cfg=llm_cfg)

                # 生成下载缓存文件
                file_id = f"trans_{uuid.uuid4().hex[:8]}_{mode}.docx"
                file_path = os.path.join(TRANSLATIONS_DIR, file_id)
                with open(file_path, "wb") as f:
                    f.write(out_bytes)

                download_url = f"/api/translations/download/{file_id}"
                out_b64 = base64.b64encode(out_bytes).decode("ascii")

                # 如果传入了文献 key，同步存入团队云端成果库
                if paper_key:
                    with _lock:
                        _shared_translations[paper_key] = {
                            "paperKey": paper_key,
                            "time": time.strftime("%Y-%m-%d %H:%M"),
                            "mode": mode,
                            "downloadUrl": download_url,
                            "paraCount": para_count
                        }
                    _save_persist()

                return self._send(200, {
                    "ok": True,
                    "downloadUrl": download_url,
                    "fileBase64": out_b64,
                    "paraCount": para_count
                })
            except Exception as e:
                sys.stderr.write(f"[docx_translate] error: {e}\n")
                return self._send(500, {"error": f"Docx translation error: {e}"})

        # 4. 共享翻译成果上传与缓存
        if path == "/api/collab/translations":
            paper_key = payload.get("paperKey")
            if not paper_key:
                return self._send(400, {"error": "paperKey required"})
            with _lock:
                _shared_translations[paper_key] = {
                    "paperKey": paper_key,
                    "title": payload.get("title") or "",
                    "time": time.strftime("%Y-%m-%d %H:%M"),
                    "mode": payload.get("mode") or "dual",
                    "paras": payload.get("paras") or [],
                    "trans": payload.get("trans") or []
                }
            _save_persist()
            return self._send(200, {"ok": True, "saved": paper_key})

        # 5. 共享批注与研读讨论提交
        if path == "/api/collab/notes":
            paper_id = payload.get("paperId")
            content = (payload.get("content") or "").strip()
            user = payload.get("user") or "学者"
            if not paper_id or not content:
                return self._send(400, {"error": "paperId and content required"})
            note_item = {
                "id": uuid.uuid4().hex[:8],
                "user": user,
                "content": content,
                "time": time.strftime("%Y-%m-%d %H:%M")
            }
            with _lock:
                if paper_id not in _collab_notes:
                    _collab_notes[paper_id] = []
                _collab_notes[paper_id].insert(0, note_item)
                # 最多保留 100 条研读批注
                _collab_notes[paper_id] = _collab_notes[paper_id][:100]
            _save_persist()
            return self._send(200, {"ok": True, "note": note_item})

        # 6. 管理员登录与认证
        if path == "/api/admin/auth":
            pwd = (payload.get("password") or "").strip()
            if pwd == ADMIN_PASS:
                token = "adm_" + uuid.uuid4().hex
                with _lock:
                    _admin_tokens.add(token)
                return self._send(200, {"ok": True, "token": token, "msg": "管理员认证成功"})
            return self._send(401, {"ok": False, "error": "管理员密码错误"})

        # 7. 用户免登录自主上传文献
        if path == "/api/papers/upload":
            title = (payload.get("title") or "").strip()
            titleCN = (payload.get("titleCN") or title).strip()
            titleEN = (payload.get("titleEN") or "").strip()
            authors = payload.get("authors") or []
            journal = (payload.get("journal") or "用户贡献文库").strip()
            year = str(payload.get("year") or time.strftime("%Y"))
            category = payload.get("category") or "用户贡献与自传文献"
            abstractCN = (payload.get("abstractCN") or payload.get("abstract") or "").strip()
            abstractEN = (payload.get("abstractEN") or "").strip()
            abstract = payload.get("abstract") or (abstractCN + ("\n\n" + abstractEN if abstractEN else ""))
            doi = (payload.get("doi") or "").strip()
            file_b64 = payload.get("fileBase64")
            file_name = payload.get("fileName") or ""
            pid = f"usr_{uuid.uuid4().hex[:8]}"
            file_url = ""
            if file_b64:
                safe_name = re.sub(r'[^\w\.\-\_]', '_', file_name) or "paper.pdf"
                file_path = os.path.join(PAPERS_FILES_DIR, f"{pid}_{safe_name}")
                try:
                    with open(file_path, "wb") as f:
                        f.write(base64.b64decode(file_b64))
                    file_url = f"/api/papers/download/{pid}_{safe_name}"
                except Exception as e:
                    sys.stderr.write(f"[upload] file save error: {e}\n")

            if isinstance(authors, str):
                authors = [a.strip() for a in re.split(r"[,;，；]", authors) if a.strip()]

            paper = {
                "id": pid,
                "titleCN": titleCN,
                "titleEN": titleEN,
                "authors": authors,
                "journal": journal,
                "year": year,
                "category": category,
                "abstractCN": abstractCN,
                "abstractEN": abstractEN,
                "abstract": abstract,
                "doi": doi,
                "fileName": file_name or (titleCN + ".docx"),
                "fileUrl": file_url,
                "isUserUpload": True,
                "status": "ok",
                "createdAt": time.strftime("%Y-%m-%d %H:%M:%S")
            }
            with _lock:
                _user_papers.insert(0, paper)
            _save_papers_state()
            return self._send(200, {"ok": True, "paper": paper})

        # 8. 管理员删除文献（支持删除用户上传文献或屏蔽内置文献）
        if path == "/api/papers/delete":
            token = payload.get("token") or self.headers.get("x-admin-token")
            pwd = payload.get("password")
            if not (token in _admin_tokens or pwd == ADMIN_PASS):
                return self._send(403, {"ok": False, "error": "需要管理员权限"})
            pid = str(payload.get("id"))
            if not pid:
                return self._send(400, {"error": "id required"})
            with _lock:
                _user_papers = [p for p in _user_papers if str(p.get("id")) != pid]
                _deleted_paper_ids.add(pid)
            _save_papers_state()
            return self._send(200, {"ok": True, "deleted": pid})

        return self._send(404, {"error": "not found"})

    def log_message(self, fmt, *args):
        sys.stderr.write("[backend] %s\n" % (fmt % args))


if __name__ == "__main__":
    try:
        _ensure_bing_session()
        sys.stderr.write("[backend] Bing engine warmup complete\n")
    except Exception as e:
        sys.stderr.write(f"[backend] Bing warmup note: {e}\n")
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    sys.stderr.write(f"[backend] Papers Manager Server listening on 0.0.0.0:{PORT}\n")
    srv.serve_forever()
