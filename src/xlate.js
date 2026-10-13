/* ===== 内置 PDF 双语翻译与文献精读工作台 ===== */
(function () {
  'use strict';
  var API = '/api/translate';
  var BATCH = 6;                 // 每次请求的段落数
  var PDFJS_SRC = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  var PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

  var LANGS = [
    ['auto', '自动检测'], ['en', '英语'], ['ja', '日语'], ['ko', '韩语'], ['fr', '法语'],
    ['de', '德语'], ['es', '西班牙语'], ['ru', '俄语'], ['zh-Hans', '中文(简体)']
  ];
  var TARGETS = [
    ['zh-Hans', '中文(简体)'], ['zh-Hant', '中文(繁体)'], ['en', '英语'], ['ja', '日语']
  ];

  function $(id) { return document.getElementById(id); }

  var state = {
    mode: 'pdf',                 // 'pdf' | 'paste' | 'paper'
    paras: [],                   // [{ page: 1, text: '...' }]
    trans: [],                   // ['...', '...']
    running: false,
    stop: false,
    name: '',
    pages: 0,
    fileSize: 0
  };

  /* ---------- pdf.js 异步加载 ---------- */
  function loadPdfjs() {
    return new Promise(function (resolve, reject) {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        return resolve(window.pdfjsLib);
      }
      var s = document.createElement('script');
      s.src = PDFJS_SRC;
      s.onload = function () {
        if (!window.pdfjsLib) return reject(new Error('pdfjs missing'));
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        resolve(window.pdfjsLib);
      };
      s.onerror = function () { reject(new Error('pdf.js 加载失败，请检查网络或切换到自由文本模式')); };
      document.head.appendChild(s);
    });
  }

  /* ---------- 文本抽取（行 → 段落启发式合并） ---------- */
  function linesToParas(lines, pageNum) {
    var paras = [], buf = '', lastY = null, heights = [];
    lines.forEach(function (ln) { if (ln.h) heights.push(ln.h); });
    heights.sort(function (a, b) { return a - b; });
    var medH = heights.length ? heights[Math.floor(heights.length / 2)] : 12;

    lines.forEach(function (ln) {
      var text = (ln.text || '').trim();
      if (!text) return;
      if (/^\d{1,4}$/.test(text)) return;                       // 忽略纯页码
      var gap = lastY === null ? 0 : (lastY - ln.y);
      var isBullet = /^([•·\-*]|\(?\d{1,2}[.)])\s+/.test(text);
      var prevEnds = /[.:;!?。！？；：]$/.test(buf.trim());
      var newPara = !buf || gap > medH * 1.75 || isBullet ||
                    (prevEnds && buf.trim().length > 40 && gap > medH * 1.15);
      if (newPara && buf) {
        paras.push({ page: pageNum, text: buf.trim() });
        buf = '';
      }
      buf += (buf && !/[\-\u2010-\u2015]$/.test(buf) ? ' ' : '') + text;
      lastY = ln.y;
    });
    if (buf.trim()) paras.push({ page: pageNum, text: buf.trim() });
    return paras.filter(function (p) { return p.text.length > 1; });
  }

  function extractPdf(pdfjsLib, data) {
    return pdfjsLib.getDocument({ data: data }).promise.then(function (doc) {
      state.pages = doc.numPages;
      var out = [], chain = Promise.resolve();
      var _loop = function (i) {
        chain = chain.then(function () {
          updateStatus('正在解析 PDF（第 ' + i + ' / ' + doc.numPages + ' 页）…');
          return doc.getPage(i).then(function (page) {
            return page.getTextContent().then(function (tc) {
              var lines = [], cur = null;
              tc.items.forEach(function (it) {
                var str = it.str;
                if (!str || !str.trim()) return;
                var y = it.transform[5], h = Math.abs(it.transform[3]) || 10;
                if (cur && Math.abs(cur.y - y) < Math.max(3, h * 0.45)) {
                  cur.text += (/\s$/.test(cur.text) ? '' : ' ') + str;
                } else {
                  if (cur) lines.push(cur);
                  cur = { y: y, h: h, text: str };
                }
              });
              if (cur) lines.push(cur);
              lines.sort(function (a, b) { return b.y - a.y; });
              var pageParas = linesToParas(lines, i);
              out = out.concat(pageParas);
            });
          });
        });
      };
      for (var p = 1; p <= doc.numPages; p++) {
        _loop(p);
      }
      return chain.then(function () { return out; });
    });
  }

  /* ---------- 批量翻译调用 ---------- */
  function translateBatch(texts, src, dst) {
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: texts, from: src, to: dst })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      if (data && data.translations) return data.translations;
      throw new Error(data && data.error || '翻译接口返回异常');
    });
  }

  function translateAll() {
    if (state.running || !state.paras.length) return;
    state.running = true;
    state.stop = false;
    $('pm-xl-run').disabled = true;
    $('pm-xl-stop').disabled = false;
    $('pm-xl-export').disabled = true;

    var srcLang = $('pm-xl-from').value;
    var dstLang = $('pm-xl-to').value;
    var total = state.paras.length;
    var batches = [];

    for (var i = 0; i < total; i += BATCH) {
      batches.push({ start: i, items: state.paras.slice(i, i + BATCH) });
    }

    var idx = 0;
    function next() {
      if (state.stop || idx >= batches.length) {
        state.running = false;
        $('pm-xl-run').disabled = false;
        $('pm-xl-stop').disabled = true;
        $('pm-xl-export').disabled = !state.trans.length;
        if (state.stop) {
          updateStatus('已暂停翻译 · 已完成 ' + countCompleted() + ' / ' + total + ' 段');
        } else {
          updateStatus('翻译完成！共 ' + total + ' 段文献双语对照');
          setProgress(total, total);
        }
        highlightActiveCard(-1);
        return;
      }

      var b = batches[idx];
      var texts = b.items.map(function (it) { return it.text; });
      updateStatus('正在翻译第 ' + (b.start + 1) + ' ~ ' + Math.min(b.start + BATCH, total) + ' 段（共 ' + total + ' 段）…');
      highlightActiveCard(b.start);

      translateBatch(texts, srcLang, dstLang).then(function (results) {
        results.forEach(function (res, offset) {
          state.trans[b.start + offset] = res;
          updateDstCard(b.start + offset, res);
        });
        setProgress(countCompleted(), total);
        idx++;
        setTimeout(next, 120);
      }).catch(function (err) {
        console.error('翻译出错:', err);
        updateStatus('翻译中断：' + (err.message || '网络波动') + '，可点击「开始翻译」继续');
        state.running = false;
        $('pm-xl-run').disabled = false;
        $('pm-xl-stop').disabled = true;
        $('pm-xl-export').disabled = !state.trans.length;
        highlightActiveCard(-1);
      });
    }

    next();
  }

  function countCompleted() {
    var c = 0;
    for (var i = 0; i < state.trans.length; i++) {
      if (state.trans[i]) c++;
    }
    return c;
  }

  function updateStatus(txt) {
    $('pm-xl-status').textContent = txt;
  }

  function setProgress(done, total) {
    var pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
    $('pm-xl-prog').style.width = pct + '%';
    $('pm-xl-pct').textContent = pct + '%';
    $('pm-xl-count').textContent = '已完成 ' + done + ' / ' + total + ' 段';
    $('pm-xl-dst-badge').textContent = done > 0 ? (done + ' / ' + total + ' 段') : '等待翻译';
  }

  /* ---------- 渲染卡片 ---------- */
  function renderPanes() {
    var total = state.paras.length;
    $('pm-xl-src-badge').textContent = total > 0 ? ('共 ' + total + ' 个段落') : '无内容';
    $('pm-xl-run').disabled = total === 0;

    var srcList = $('pm-xl-src-list');
    var dstList = $('pm-xl-dst-list');
    srcList.innerHTML = '';
    dstList.innerHTML = '';

    if (!total) {
      $('pm-xl-dst-empty').style.display = 'flex';
      setProgress(0, 0);
      return;
    }

    $('pm-xl-dst-empty').style.display = 'none';

    state.paras.forEach(function (p, idx) {
      // 左侧原文卡片
      var sCard = document.createElement('div');
      sCard.className = 'xl-card';
      sCard.id = 'pm-xl-scard-' + idx;
      sCard.innerHTML =
        '<div class="xl-card-meta">' +
          '<span class="xl-card-idx">[P.' + (p.page || 1) + ' · #' + (idx + 1) + ']</span>' +
          '<button class="xl-copy-btn" type="button" data-copy="' + idx + '">复制原文</button>' +
        '</div>' +
        '<div class="xl-card-text">' + escapeHtml(p.text) + '</div>';
      srcList.appendChild(sCard);

      // 右侧译文卡片
      var dCard = document.createElement('div');
      dCard.className = 'xl-card';
      dCard.id = 'pm-xl-dcard-' + idx;
      var transText = state.trans[idx] || '';
      dCard.innerHTML =
        '<div class="xl-card-meta">' +
          '<span class="xl-card-idx">[译文 #' + (idx + 1) + ']</span>' +
          '<button class="xl-copy-btn" type="button" data-copy-dst="' + idx + '">复制译文</button>' +
        '</div>' +
        '<div class="xl-card-text' + (transText ? '' : ' wait') + '">' +
          (transText ? escapeHtml(transText) : '等待翻译…') +
        '</div>';
      dstList.appendChild(dCard);
    });

    setProgress(countCompleted(), total);
  }

  function updateDstCard(idx, text) {
    var card = $('pm-xl-dcard-' + idx);
    if (!card) return;
    var textEl = card.querySelector('.xl-card-text');
    if (textEl) {
      textEl.className = 'xl-card-text';
      textEl.textContent = text;
    }
  }

  function highlightActiveCard(idx) {
    var allS = document.querySelectorAll('.xl-card.active');
    allS.forEach(function (el) { el.classList.remove('active'); });
    if (idx >= 0) {
      var sc = $('pm-xl-scard-' + idx);
      var dc = $('pm-xl-dcard-' + idx);
      if (sc) {
        sc.classList.add('active');
        sc.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      if (dc) {
        dc.classList.add('active');
        dc.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  /* ---------- 载入来源 ---------- */
  function usePdf(file) {
    if (!file) return;
    state.name = file.name;
    state.fileSize = file.size;
    state.paras = [];
    state.trans = [];

    $('pm-xl-drop').style.display = 'none';
    $('pm-xl-file-card').style.display = 'flex';
    $('pm-xl-file-name').textContent = file.name;
    $('pm-xl-file-meta').textContent = (file.size / 1024 / 1024).toFixed(2) + ' MB · 正在抽取文本…';

    updateStatus('正在加载 PDF 解析引擎…');
    loadPdfjs().then(function (pdfjsLib) {
      return file.arrayBuffer().then(function (buf) {
        return extractPdf(pdfjsLib, new Uint8Array(buf));
      });
    }).then(function (paras) {
      state.paras = paras;
      $('pm-xl-file-meta').textContent = (file.size / 1024 / 1024).toFixed(2) + ' MB · 共 ' + state.pages + ' 页 · 抽取 ' + paras.length + ' 个段落';
      if (!paras.length) {
        updateStatus('未在这份 PDF 中提取到可翻译文字（可能是纯图片扫描件，需 OCR）');
      } else {
        updateStatus('就绪 · 解析完成，共 ' + paras.length + ' 个段落，点击「开始翻译」即可执行');
      }
      renderPanes();
    }).catch(function (e) {
      console.error(e);
      updateStatus('PDF 解析失败: ' + (e && e.message || e));
      $('pm-xl-file-meta').textContent = '解析异常，可改用粘贴文本模式';
    });
  }

  function usePaste() {
    var txt = ($('pm-xl-paste').value || '').trim();
    if (!txt) {
      state.paras = [];
      state.trans = [];
      renderPanes();
      return;
    }
    var rawList = txt.split(/\n\s*\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    state.name = 'pasted-text';
    state.paras = rawList.map(function (p, i) { return { page: 1, text: p }; });
    state.trans = [];
    updateStatus('就绪 · 自由文本已分段，共 ' + state.paras.length + ' 段');
    renderPanes();
  }

  function useCurrentPaper() {
    // 优先读取正在全屏打开的论文弹窗
    var cur = null;
    if (window.STATE && window.STATE.papers) {
      // 检查当前是否有打开的详情
      var modal = document.getElementById('modal');
      var mBody = document.getElementById('mBody');
      if (modal && modal.style.display !== 'none' && mBody) {
        var titleEl = mBody.querySelector('h2, .title');
        var textEl = mBody.querySelector('.fulltext, .text, pre, .content');
        if (titleEl || textEl) {
          cur = {
            title: titleEl ? titleEl.textContent.trim() : '当前文献',
            text: textEl ? textEl.textContent.trim() : (mBody.innerText || '')
          };
        }
      }
      // 如果没有打开弹窗，默认取第一篇文献作为范例
      if (!cur && window.STATE.papers.length) {
        var p = window.STATE.papers[0];
        cur = {
          title: p.fileName || '选中文献',
          text: (p.fullText || p.abstract || '').trim()
        };
      }
    }

    if (cur && cur.text) {
      switchMode('paste');
      $('pm-xl-paste').value = (cur.title ? ('# ' + cur.title + '\n\n') : '') + cur.text.slice(0, 8000);
      usePaste();
      updateStatus('已导入文献: ' + (cur.title || '当前论文') + '（截取前部核心段落）');
    } else {
      updateStatus('未能检测到当前打开的论文，请在主页点击一篇论文后再次导入');
    }
  }

  /* ---------- 导出与剪贴板 ---------- */
  function exportMd() {
    var lines = [
      '# ' + (state.name || '文献双语对照精读') + ' · 双语翻译',
      '> 生成时间: ' + new Date().toLocaleString() + ' | 引擎: Bing Neural Engine',
      ''
    ];
    state.paras.forEach(function (p, i) {
      lines.push('### 段落 ' + (i + 1) + ' (P.' + (p.page || 1) + ')');
      lines.push('');
      lines.push('**原文：**');
      lines.push(p.text);
      lines.push('');
      lines.push('**译文：**');
      lines.push(state.trans[i] || '*(尚未翻译)*');
      lines.push('');
      lines.push('---');
      lines.push('');
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (state.name || 'papers-translation').replace(/\.[^/.]+$/, '') + '-bilingual.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  function copyText(str, msg) {
    if (!str) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(str).then(function () {
        updateStatus(msg || '已复制到剪贴板');
      });
    } else {
      var ta = document.createElement('textarea');
      ta.value = str;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        updateStatus(msg || '已复制到剪贴板');
      } catch (e) {}
      document.body.removeChild(ta);
    }
  }

  function copyAllDst() {
    var text = state.trans.filter(Boolean).join('\n\n');
    if (!text) {
      updateStatus('尚无译文可复制');
      return;
    }
    copyText(text, '已复制全部 ' + countCompleted() + ' 段译文');
  }

  /* ---------- 模式切换 ---------- */
  function switchMode(m) {
    state.mode = m;
    $('pm-xl-tab-pdf').classList.toggle('active', m === 'pdf');
    $('pm-xl-tab-paste').classList.toggle('active', m === 'paste');
    $('pm-xl-tab-paper').classList.toggle('active', m === 'paper');

    if (m === 'pdf') {
      $('pm-xl-paste-wrap').style.display = 'none';
      if (state.paras.length && state.name && state.name !== 'pasted-text') {
        $('pm-xl-drop').style.display = 'none';
        $('pm-xl-file-card').style.display = 'flex';
      } else {
        $('pm-xl-drop').style.display = 'block';
        $('pm-xl-file-card').style.display = 'none';
      }
    } else if (m === 'paste') {
      $('pm-xl-drop').style.display = 'none';
      $('pm-xl-file-card').style.display = 'none';
      $('pm-xl-paste-wrap').style.display = 'block';
    }
  }

  function clearAll() {
    state.paras = [];
    state.trans = [];
    state.name = '';
    state.stop = true;
    $('pm-xl-paste').value = '';
    $('pm-xl-file').value = '';
    $('pm-xl-file-card').style.display = 'none';
    if (state.mode === 'pdf') $('pm-xl-drop').style.display = 'block';
    updateStatus('已清空');
    renderPanes();
  }

  function open() {
    $('pm-xl').classList.add('show');
  }
  function close() {
    $('pm-xl').classList.remove('show');
  }

  function fillSelect(el, opts) {
    el.innerHTML = opts.map(function (o) {
      return '<option value="' + o[0] + '">' + o[1] + '</option>';
    }).join('');
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  function boot() {
    fillSelect($('pm-xl-from'), LANGS);
    fillSelect($('pm-xl-to'), TARGETS);
    $('pm-xl-from').value = 'auto';
    $('pm-xl-to').value = 'zh-Hans';

    // 交互事件监听
    $('pm-xl-chip').addEventListener('click', open);
    $('pm-xl-close').addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && $('pm-xl').classList.contains('show')) close();
    });

    $('pm-xl-tab-pdf').addEventListener('click', function () { switchMode('pdf'); });
    $('pm-xl-tab-paste').addEventListener('click', function () { switchMode('paste'); });
    $('pm-xl-tab-paper').addEventListener('click', useCurrentPaper);

    $('pm-xl-pick-btn').addEventListener('click', function () { $('pm-xl-file').click(); });
    $('pm-xl-drop').addEventListener('click', function () { $('pm-xl-file').click(); });
    $('pm-xl-reselect').addEventListener('click', function () { $('pm-xl-file').click(); });
    $('pm-xl-file').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) usePdf(e.target.files[0]);
    });

    // 拖拽
    var dropEl = $('pm-xl-drop');
    ['dragenter', 'dragover'].forEach(function (ev) {
      dropEl.addEventListener(ev, function (e) {
        e.preventDefault(); dropEl.classList.add('over');
      });
    });
    dropEl.addEventListener('dragleave', function () { dropEl.classList.remove('over'); });
    dropEl.addEventListener('drop', function (e) {
      e.preventDefault(); dropEl.classList.remove('over');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        usePdf(e.dataTransfer.files[0]);
      }
    });

    // 粘贴模式输入响应
    $('pm-xl-paste').addEventListener('input', usePaste);

    // 翻译启停与导出
    $('pm-xl-run').addEventListener('click', translateAll);
    $('pm-xl-stop').addEventListener('click', function () { state.stop = true; });
    $('pm-xl-clear').addEventListener('click', clearAll);
    $('pm-xl-export').addEventListener('click', exportMd);
    $('pm-xl-copy-all').addEventListener('click', copyAllDst);

    // 单段复制委托
    $('pm-xl-src-list').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-copy]');
      if (btn) {
        var idx = parseInt(btn.getAttribute('data-copy'), 10);
        if (state.paras[idx]) copyText(state.paras[idx].text, '已复制段落 #' + (idx + 1) + ' 原文');
      }
    });
    $('pm-xl-dst-list').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-copy-dst]');
      if (btn) {
        var idx = parseInt(btn.getAttribute('data-copy-dst'), 10);
        if (state.trans[idx]) copyText(state.trans[idx], '已复制段落 #' + (idx + 1) + ' 译文');
      }
    });

    switchMode('pdf');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
