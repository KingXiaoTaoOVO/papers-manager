/* ===== AI 格式级全文档双语翻译工坊与多人协同交互引擎 (v5.3) ===== */
(function () {
  'use strict';

  var API_TRANSLATE = '/api/translate';
  var API_DOCX = '/api/translate/docx';
  var API_PRESENCE = '/api/collab/presence';
  var API_TRANSLATIONS = '/api/collab/translations';
  var API_NOTES = '/api/collab/notes';

  var PDFJS_SRC = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  var PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

  var LANGS = [
    ['auto', '自动检测 (Auto)'], ['en', '英语 (English)'], ['zh-Hans', '中文 (简体)'],
    ['zh-Hant', '中文 (繁体)'], ['ja', '日语 (Japanese)'], ['ko', '韩语 (Korean)'],
    ['fr', '法语 (French)'], ['de', '德语 (German)'], ['es', '西班牙语 (Spanish)'],
    ['ru', '俄语 (Russian)']
  ];
  var TARGETS = [
    ['zh-Hans', '中文 (简体)'], ['zh-Hant', '中文 (繁体)'], ['en', '英语 (English)'],
    ['ja', '日语 (Japanese)'], ['ko', '韩语 (Korean)'], ['de', '德语 (German)']
  ];

  function $(id) { return document.getElementById(id); }

  // 客户端稳定独立标识（支持 localStorage、Cookie 及浏览器硬件指纹兜底，保证同一设备刷新绝不变更）
  function getStableClientId() {
    try {
      var cid = localStorage.getItem('pm_client_id');
      if (cid && cid.length >= 6) return cid;
    } catch (e) {}

    var m = document.cookie.match(/(?:^|;\s*)pm_cid=([^;]+)/);
    if (m && m[1]) {
      try { localStorage.setItem('pm_client_id', m[1]); } catch (e) {}
      return m[1];
    }

    // 基于浏览器环境与硬件特征计算稳定的确定性哈希
    var raw = [
      navigator.userAgent,
      screen.width,
      screen.height,
      screen.colorDepth,
      navigator.language,
      navigator.hardwareConcurrency || 4
    ].join('|');
    var hash = 0;
    for (var i = 0; i < raw.length; i++) {
      hash = ((hash << 5) - hash) + raw.charCodeAt(i);
      hash |= 0;
    }
    var id = 'usr_' + Math.abs(hash).toString(36);
    try {
      localStorage.setItem('pm_client_id', id);
      document.cookie = 'pm_cid=' + id + '; path=/; max-age=31536000; SameSite=Lax';
    } catch (e) {}
    return id;
  }

  var CLIENT_ID = getStableClientId();

  var state = {
    mode: 'doc',           // 'doc' | 'paper' | 'paste'
    viewMode: 'visual',    // 'visual' (视觉排版原貌) | 'dual' (逐段对齐精读)
    outputMode: 'dual',    // 'dual' | 'mono'
    fileType: '',          // 'pdf' | 'docx' | 'text' | 'paper'
    fileName: '',
    fileSize: 0,
    fileBytes: null,       // Uint8Array / Base64 / ArrayBuffer
    activePaperKey: '',
    paras: [],             // [{ id: 1, text: '...', page: 1, isHeading: false, isMath: false }]
    trans: [],             // [{ id: 1, text: '...' }]
    running: false,
    stop: false,
    docxDownloadUrl: '',
    docxBase64: '',
    notes: [],
    // 视觉排版预览控制
    pdfDoc: null,
    currentPage: 1,
    totalPages: 1,
    zoomScale: 1.0
  };

  /* ==============================================================================
     1. 多人在线协同状态与心跳机制 (Presence，真实学者强去重)
     ============================================================================== */
  function sendPresenceHeartbeat() {
    fetch(API_PRESENCE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: CLIENT_ID,
        name: '学者 ' + CLIENT_ID.slice(-4),
        reading: state.fileName || (state.activePaperKey ? '馆藏文献' : '')
      })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data && typeof data.online_count !== 'undefined') {
        var pill = $('pm-online-count');
        if (pill) {
          pill.textContent = data.online_count + ' 位学者在线研读';
        }
      }
    })
    .catch(function () {});
  }

  // 页面卸载或关闭时，发送 leave 告知服务端释放会话
  window.addEventListener('beforeunload', function () {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/collab/leave', JSON.stringify({ clientId: CLIENT_ID }));
    }
  });

  // 每 15 秒自动发送心跳（服务端 35 秒超时兜底）
  setInterval(sendPresenceHeartbeat, 15000);
  setTimeout(sendPresenceHeartbeat, 600);

  /* ==============================================================================
     2. 语言与下拉框初始化
     ============================================================================== */
  function initLangSelects() {
    var fromSel = $('pm-xl-from');
    var toSel = $('pm-xl-to');
    if (!fromSel || !toSel) return;
    fromSel.innerHTML = '';
    toSel.innerHTML = '';
    LANGS.forEach(function (l) {
      var opt = document.createElement('option');
      opt.value = l[0];
      opt.textContent = l[1];
      if (l[0] === 'auto') opt.selected = true;
      fromSel.appendChild(opt);
    });
    TARGETS.forEach(function (l) {
      var opt = document.createElement('option');
      opt.value = l[0];
      opt.textContent = l[1];
      if (l[0] === 'zh-Hans') opt.selected = true;
      toSel.appendChild(opt);
    });
  }

  /* ==============================================================================
     3. 大模型与 API 配置持久化
     ============================================================================== */
  function getLlmConfig() {
    return {
      apiKey: localStorage.getItem('pm_llm_key') || '',
      baseUrl: localStorage.getItem('pm_llm_base') || '',
      model: localStorage.getItem('pm_llm_model') || 'deepseek-chat'
    };
  }

  function initApiModal() {
    var modal = $('pm-xl-api-modal');
    var openBtn = $('pm-xl-api-btn');
    var closeBtn = $('pm-xl-api-close');
    var cancelBtn = $('pm-api-cancel');
    var saveBtn = $('pm-api-save');

    if (openBtn) {
      openBtn.onclick = function () {
        var cfg = getLlmConfig();
        $('pm-api-key').value = cfg.apiKey;
        $('pm-api-base').value = cfg.baseUrl;
        $('pm-api-model').value = cfg.model;
        modal.style.display = 'flex';
      };
    }
    function hideModal() { if (modal) modal.style.display = 'none'; }
    if (closeBtn) closeBtn.onclick = hideModal;
    if (cancelBtn) cancelBtn.onclick = hideModal;
    if (saveBtn) {
      saveBtn.onclick = function () {
        localStorage.setItem('pm_llm_key', ($('pm-api-key').value || '').trim());
        localStorage.setItem('pm_llm_base', ($('pm-api-base').value || '').trim());
        localStorage.setItem('pm_llm_model', ($('pm-api-model').value || 'deepseek-chat').trim());
        hideModal();
        updateStatus('大模型配置已保存');
      };
    }
  }

  /* ==============================================================================
     4. 文档解析与视觉排版渲染引擎（PDF & Word 原版浏览）
     ============================================================================== */
  var JSZIP_SRC = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
  var DOCX_PREVIEW_SRC = 'https://cdn.jsdelivr.net/npm/docx-preview@0.3.3/dist/docx-preview.min.js';

  function loadDocxPreview() {
    return new Promise(function (resolve, reject) {
      if (window.docx && window.JSZip) return resolve(window.docx);

      function loadScript(src) {
        return new Promise(function (res, rej) {
          var s = document.createElement('script');
          s.src = src;
          s.onload = res;
          s.onerror = rej;
          document.head.appendChild(s);
        });
      }

      loadScript(JSZIP_SRC)
        .then(function () { return loadScript(DOCX_PREVIEW_SRC); })
        .then(function () {
          if (window.docx) resolve(window.docx);
          else reject(new Error('docx-preview 加载失败'));
        })
        .catch(function (e) {
          reject(new Error('docx-preview 加载异常: ' + e.message));
        });
    });
  }

  function base64ToArrayBuffer(base64) {
    var binaryString = window.atob(base64);
    var len = binaryString.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  function updateZoomText() {
    var el = $('pm-xl-zoom-val');
    if (el) el.textContent = Math.round(state.zoomScale * 100) + '%';
  }

  function renderPdfPage(pageNo) {
    if (!state.pdfDoc) return;
    if (pageNo < 1) pageNo = 1;
    if (pageNo > state.totalPages) pageNo = state.totalPages;
    state.currentPage = pageNo;

    var curInput = $('pm-xl-page-cur');
    if (curInput) curInput.value = pageNo;

    var prevBtn = $('pm-xl-page-prev');
    var nextBtn = $('pm-xl-page-next');
    if (prevBtn) prevBtn.disabled = pageNo <= 1;
    if (nextBtn) nextBtn.disabled = pageNo >= state.totalPages;

    // 渲染左侧 Canvas 原版 PDF
    state.pdfDoc.getPage(pageNo).then(function (page) {
      var canvas = $('pm-xl-src-pdf-canvas');
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      var scale = state.zoomScale * 1.5;
      var viewport = page.getViewport({ scale: scale });

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = Math.round(viewport.width / 1.5) + 'px';
      canvas.style.height = Math.round(viewport.height / 1.5) + 'px';

      page.render({ canvasContext: ctx, viewport: viewport });
    });

    // 渲染右侧译文视觉版面
    renderTranslatedPdfPage(pageNo);
  }

  function renderTranslatedPdfPage(pageNo) {
    var placeholder = $('pm-xl-dst-pdf-placeholder');
    var sheet = $('pm-xl-dst-pdf-sheet');
    var pageBadge = $('pm-xl-sheet-page');
    var titleEl = $('pm-xl-sheet-title');
    var contentEl = $('pm-xl-sheet-content');

    if (pageBadge) pageBadge.textContent = 'Page ' + pageNo + ' / ' + state.totalPages;
    if (titleEl) titleEl.textContent = state.fileName ? state.fileName.toUpperCase() : 'TRANSLATION PREVIEW';

    var pageParas = state.paras.filter(function (p) { return p.page === pageNo; });
    if (!pageParas.length) {
      var perPage = Math.max(1, Math.ceil(state.paras.length / (state.totalPages || 1)));
      var start = (pageNo - 1) * perPage;
      pageParas = state.paras.slice(start, start + perPage);
    }

    var hasAnyTrans = pageParas.some(function (p) {
      var tr = state.trans.find(function (t) { return t.id === p.id; });
      return tr && tr.text && tr.text.trim();
    });

    if (!hasAnyTrans && !state.running) {
      if (placeholder) placeholder.style.display = 'flex';
      if (sheet) sheet.style.display = 'none';
      return;
    }

    if (placeholder) placeholder.style.display = 'none';
    if (sheet) sheet.style.display = 'flex';

    if (contentEl) {
      var html = '';
      pageParas.forEach(function (p) {
        var tr = state.trans.find(function (t) { return t.id === p.id; });
        var transText = (tr && tr.text) || '<span style="opacity:0.35;">(正在翻译此段...)</span>';
        if (p.isHeading) {
          html += '<div class="sheet-heading">' + escapeHtml(transText) + '</div>';
        } else if (state.outputMode === 'dual') {
          html += '<div class="sheet-dual-block">' +
                  '  <div class="sheet-dual-src">#' + p.id + ' ' + escapeHtml(p.text) + '</div>' +
                  '  <div class="sheet-dual-dst">' + escapeHtml(transText) + '</div>' +
                  '</div>';
        } else {
          html += '<div class="sheet-para">' + escapeHtml(transText) + '</div>';
        }
      });
      contentEl.innerHTML = html || '<div style="color:#999;text-align:center;padding:40px;">当前页无文字内容</div>';
    }
  }

  function renderWordOriginalView(fileBytes) {
    var box = $('pm-xl-src-docx-box');
    if (!box) return;
    box.innerHTML = '<div style="color:#c9a86a;padding:30px;font-size:12px;">正在解析 Word 原文排版与表格结构…</div>';

    loadDocxPreview().then(function (docxLib) {
      box.innerHTML = '';
      docxLib.renderAsync(fileBytes, box, null, {
        className: 'docx',
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false
      }).catch(function (err) {
        box.innerHTML = '<div style="padding:20px;color:#cfcac0;">Word 预览解析提示: ' + escapeHtml(err.message) + '</div>';
      });
    }).catch(function () {
      box.innerHTML = '<div class="sheet-heading">Word 原文文档预览</div>' +
                      '<div style="color:#cfcac0;padding:20px;">Word 文档已就绪，点击「开始翻译」即可执行 1:1 格式级重构！</div>';
    });
  }

  function renderWordTranslatedView(translatedBytes) {
    var placeholder = $('pm-xl-dst-docx-placeholder');
    var renderedView = $('pm-xl-dst-docx-rendered');
    if (placeholder) placeholder.style.display = 'none';
    if (renderedView) {
      renderedView.style.display = 'block';
      renderedView.innerHTML = '<div style="color:#c9a86a;padding:30px;font-size:12px;">正在渲染 1:1 重构后的 Word 译文排版…</div>';

      loadDocxPreview().then(function (docxLib) {
        renderedView.innerHTML = '';
        docxLib.renderAsync(translatedBytes, renderedView, null, {
          className: 'docx',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false
        }).catch(function (err) {
          renderedView.innerHTML = '<div style="padding:20px;color:#cfcac0;">译文渲染提示: ' + escapeHtml(err.message) + '</div>';
        });
      }).catch(function () {
        renderedView.innerHTML = '<div class="sheet-heading">Word 译文已重构完成</div>' +
                                 '<div style="color:#cfcac0;padding:20px;">可在下方点击下载 1:1 双语或纯译 Word 文档。</div>';
      });
    }
  }

  function setViewMode(vmode) {
    state.viewMode = vmode;
    var btnVisual = $('pm-xl-view-visual');
    var btnDual = $('pm-xl-view-dual');
    var srcWrap = $('pm-xl-src-visual-wrap');
    var dstWrap = $('pm-xl-dst-visual-wrap');
    var srcList = $('pm-xl-src-list');
    var dstList = $('pm-xl-dst-list');
    var docToolbar = $('pm-xl-doc-toolbar');

    if (btnVisual) btnVisual.className = 'xl-view-btn' + (vmode === 'visual' ? ' active' : '');
    if (btnDual) btnDual.className = 'xl-view-btn' + (vmode === 'dual' ? ' active' : '');

    if (vmode === 'visual') {
      if (srcWrap) srcWrap.style.display = 'flex';
      if (dstWrap) dstWrap.style.display = 'flex';
      if (srcList) srcList.style.display = 'none';
      if (dstList) dstList.style.display = 'none';
      if (docToolbar) docToolbar.style.display = (state.fileType === 'pdf') ? 'flex' : 'none';
      if (state.fileType === 'pdf' && state.pdfDoc) {
        renderPdfPage(state.currentPage);
      }
    } else {
      if (srcWrap) srcWrap.style.display = 'none';
      if (dstWrap) dstWrap.style.display = 'none';
      if (srcList) srcList.style.display = 'block';
      if (dstList) dstList.style.display = 'block';
      if (docToolbar) docToolbar.style.display = 'none';
      renderParas();
    }
  }

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
      s.onerror = function () { reject(new Error('pdf.js 加载失败')); };
      document.head.appendChild(s);
    });
  }

  function parsePageRange(rangeStr, totalPages) {
    if (!rangeStr || !rangeStr.trim()) {
      var all = [];
      for (var p = 1; p <= totalPages; p++) all.push(p);
      return all;
    }
    var pages = new Set();
    var parts = rangeStr.split(/[,，\s]+/);
    parts.forEach(function (pt) {
      if (pt.indexOf('-') !== -1) {
        var seg = pt.split('-');
        var s = parseInt(seg[0], 10), e = parseInt(seg[1], 10);
        if (!isNaN(s) && !isNaN(e)) {
          for (var i = Math.max(1, s); i <= Math.min(totalPages, e); i++) pages.add(i);
        }
      } else {
        var num = parseInt(pt, 10);
        if (!isNaN(num) && num >= 1 && num <= totalPages) pages.add(num);
      }
    });
    var arr = Array.from(pages);
    arr.sort(function (a, b) { return a - b; });
    return arr.length ? arr : [1];
  }

  function extractPdfParas(pdfjsLib, data, pageRangeStr) {
    return pdfjsLib.getDocument({ data: data }).promise.then(function (doc) {
      var targetPages = parsePageRange(pageRangeStr, doc.numPages);
      var paras = [], counter = 1;
      var chain = Promise.resolve();

      targetPages.forEach(function (pageNo) {
        chain = chain.then(function () {
          updatePipelineStep(1);
          updateStatus('正在提取 PDF 第 ' + pageNo + ' / ' + doc.numPages + ' 页版面与公式…');
          return doc.getPage(pageNo).then(function (page) {
            return page.getTextContent().then(function (tc) {
              var lines = [], cur = null;
              tc.items.forEach(function (it) {
                var str = (it.str || '').trim();
                if (!str) return;
                var y = it.transform[5], h = Math.abs(it.transform[3]) || 11;
                if (cur && Math.abs(cur.y - y) < Math.max(3, h * 0.45)) {
                  cur.text += ' ' + str;
                } else {
                  if (cur) lines.push(cur);
                  cur = { y: y, h: h, text: str };
                }
              });
              if (cur) lines.push(cur);
              lines.sort(function (a, b) { return b.y - a.y; });

              // 启发式聚合段落
              var buf = '';
              lines.forEach(function (ln) {
                var txt = ln.text.trim();
                if (/^\d{1,4}$/.test(txt)) return; // 忽略孤立页码
                var isHeading = ln.h > 14 || /^(Abstract|Introduction|Methods|Results|Discussion|References|Conclusion|\d+(\.\d+)*\s+[A-Z])/i.test(txt);
                var isMath = /[\$\=∑∫∂√α-ω]/.test(txt);

                if (isHeading && buf) {
                  paras.push({ id: counter++, page: pageNo, text: buf.trim(), isHeading: false, isMath: false });
                  buf = '';
                }
                if (buf && (/[.!?。！？]$/.test(buf.trim()) || isHeading)) {
                  paras.push({ id: counter++, page: pageNo, text: buf.trim(), isHeading: isHeading, isMath: isMath });
                  buf = '';
                }
                buf += (buf ? ' ' : '') + txt;
              });
              if (buf.trim()) {
                paras.push({ id: counter++, page: pageNo, text: buf.trim(), isHeading: false, isMath: false });
              }
            });
          });
        });
      });

      return chain.then(function () { return paras; });
    });
  }

  /* ==============================================================================
     5. 格式级 Word (.docx) 翻译通道
     ============================================================================== */
  function handleWordTranslation(fileBytes, mode, src, dst, service, llmCfg) {
    updatePipelineStep(3);
    updateStatus('正在提交 Word 文档进行 1:1 格式级原版样式双语重构…');

    // 转为 base64
    var binary = '';
    var bytes = new Uint8Array(fileBytes);
    var len = bytes.byteLength;
    for (var i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    var b64 = btoa(binary);

    return fetch(API_DOCX, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileBase64: b64,
        mode: mode,
        from: src,
        to: dst,
        service: service,
        llm: llmCfg,
        paperKey: state.activePaperKey
      })
    })
    .then(function (res) {
      if (!res.ok) throw new Error('Word 翻译接口返回 HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      if (data.error) throw new Error(data.error);
      state.docxDownloadUrl = data.downloadUrl;
      state.docxBase64 = data.fileBase64;

      // 实时将生成的 1:1 Word 文档渲染至右侧视觉预览容器
      if (data.fileBase64) {
        var transBuf = base64ToArrayBuffer(data.fileBase64);
        renderWordTranslatedView(transBuf);
      }

      updatePipelineStep(5);
      updateStatus('Word 格式级翻译完成！保留全部字体与表格，已就绪供下载');
      $('pm-xl-status-dot').className = 'xl-status-dot';

      // 展现 Word 下载按钮
      var btnDual = $('pm-xl-dl-docx-dual');
      var btnMono = $('pm-xl-dl-docx-mono');
      if (btnDual) { btnDual.style.display = 'inline-flex'; }
      if (btnMono) { btnMono.style.display = 'inline-flex'; }

      renderWordSuccessView(data.paraCount, data.downloadUrl);
    });
  }

  function renderWordSuccessView(paraCount, dlUrl) {
    var dstList = $('pm-xl-dst-list');
    var emptyView = $('pm-xl-dst-empty');
    if (emptyView) emptyView.style.display = 'none';

    dstList.innerHTML =
      '<div class="xl-item heading" style="margin-top:10px;">Word (.docx) 1:1 格式级翻译成功完成</div>' +
      '<div class="xl-item">' +
      '  <p><strong>成果特性：</strong></p>' +
      '  <p>• 完整保留全部标题级别、字体字号、粗斜体样式</p>' +
      '  <p>• 表格网格与单元格完全对齐还原，无格式塌陷</p>' +
      '  <p>• 共翻译重组了 <strong>' + (paraCount || 0) + '</strong> 个学术段落与表格单元</p>' +
      '  <div style="margin-top:14px; display:flex; gap:10px;">' +
      '    <a class="xl-btn primary" href="' + dlUrl + '" download>下载生成的 Word 文档</a>' +
      '  </div>' +
      '</div>';
  }

  /* ==============================================================================
     6. 原生渲染与 1:1 双栏联动滚动
     ============================================================================== */
  function renderParas() {
    var srcList = $('pm-xl-src-list');
    var dstList = $('pm-xl-dst-list');
    var empty = $('pm-xl-dst-empty');
    srcList.innerHTML = '';
    dstList.innerHTML = '';

    if (!state.paras.length) {
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';

    state.paras.forEach(function (p, idx) {
      var itemS = document.createElement('div');
      itemS.className = 'xl-item' + (p.isHeading ? ' heading' : '') + (p.isMath ? ' math' : '');
      itemS.id = 'xl-src-' + p.id;
      itemS.innerHTML = '<span class="xl-item-num">#' + p.id + '</span><div class="xl-item-text">' + escapeHtml(p.text) + '</div>';

      var itemD = document.createElement('div');
      itemD.className = 'xl-item' + (p.isHeading ? ' heading' : '');
      itemD.id = 'xl-dst-' + p.id;
      var transText = (state.trans[idx] && state.trans[idx].text) || '<span style="opacity:0.35;">(等待翻译...)</span>';
      itemD.innerHTML = '<span class="xl-item-num">#' + p.id + '</span><div class="xl-item-text">' + escapeHtml(transText) + '</div>';

      // 悬停联动高亮
      itemS.onmouseenter = function () {
        itemS.classList.add('highlight');
        itemD.classList.add('highlight');
      };
      itemS.onmouseleave = function () {
        itemS.classList.remove('highlight');
        itemD.classList.remove('highlight');
      };
      itemD.onmouseenter = itemS.onmouseenter;
      itemD.onmouseleave = itemS.onmouseleave;

      srcList.appendChild(itemS);
      dstList.appendChild(itemD);
    });

    $('pm-xl-count').textContent = state.paras.length + ' 段落';
  }

  function updateTransItem(idx, text) {
    if (!state.trans[idx]) state.trans[idx] = { id: state.paras[idx].id, text: text };
    else state.trans[idx].text = text;

    var el = $('xl-dst-' + state.paras[idx].id);
    if (el) {
      var txtEl = el.querySelector('.xl-item-text');
      if (txtEl) txtEl.innerHTML = escapeHtml(text);
    }

    // 实时更新视觉排版右栏当前页译文
    if (state.viewMode === 'visual' && state.fileType === 'pdf') {
      renderTranslatedPdfPage(state.currentPage);
    }
  }

  function setupSyncScroll() {
    var left = $('pm-xl-src-scroll');
    var right = $('pm-xl-dst-scroll');
    var chk = $('pm-xl-sync-scroll');
    if (!left || !right || !chk) return;

    var isLeftScrolling = false, isRightScrolling = false;

    left.onscroll = function () {
      if (!chk.checked || isRightScrolling) return;
      isLeftScrolling = true;
      var pct = left.scrollTop / (left.scrollHeight - left.clientHeight || 1);
      right.scrollTop = pct * (right.scrollHeight - right.clientHeight || 1);
      setTimeout(function () { isLeftScrolling = false; }, 40);
    };

    right.onscroll = function () {
      if (!chk.checked || isLeftScrolling) return;
      isRightScrolling = true;
      var pct = right.scrollTop / (right.scrollHeight - right.clientHeight || 1);
      left.scrollTop = pct * (left.scrollHeight - left.clientHeight || 1);
      setTimeout(function () { isRightScrolling = false; }, 40);
    };
  }

  /* ==============================================================================
     7. 翻译执行调度器（多并发线程 + 阶段状态条）
     ============================================================================== */
  function updatePipelineStep(step) {
    var bar = $('pm-xl-pipeline');
    if (bar) bar.style.display = 'block';
    for (var i = 1; i <= 5; i++) {
      var badge = $('step-' + i);
      if (!badge) continue;
      if (i < step) badge.className = 'step-badge done';
      else if (i === step) badge.className = 'step-badge active';
      else badge.className = 'step-badge';
    }
    var prog = $('pm-xl-prog');
    if (prog) prog.style.width = ((step / 5) * 100) + '%';
  }

  function startTranslation() {
    if (state.running) return;
    state.running = true;
    state.stop = false;

    $('pm-xl-run').disabled = true;
    $('pm-xl-stop').disabled = false;
    $('pm-xl-status-dot').className = 'xl-status-dot busy';

    var src = $('pm-xl-from').value;
    var dst = $('pm-xl-to').value;
    var service = $('pm-xl-service').value;
    var threads = parseInt($('pm-xl-threads').value, 10) || 4;
    var llmCfg = getLlmConfig();

    // Word 专属全文档翻译通道
    if (state.fileType === 'docx' && state.fileBytes) {
      handleWordTranslation(state.fileBytes, state.outputMode, src, dst, service, llmCfg)
        .catch(function (err) {
          updateStatus('Word 翻译出错: ' + err.message);
          $('pm-xl-status-dot').className = 'xl-status-dot';
        })
        .finally(function () {
          state.running = false;
          $('pm-xl-run').disabled = false;
          $('pm-xl-stop').disabled = true;
        });
      return;
    }

    // PDF / 自由文本 / 馆藏文献通用批量并发翻译通道
    if (!state.paras.length) {
      updateStatus('未检测到待翻译段落');
      state.running = false;
      $('pm-xl-run').disabled = false;
      $('pm-xl-stop').disabled = true;
      $('pm-xl-status-dot').className = 'xl-status-dot';
      return;
    }

    updatePipelineStep(3);
    updateStatus('正在进行并行批量翻译 (并发: ' + threads + ' 线程)…');

    var BATCH_SIZE = Math.max(2, Math.min(8, Math.floor(16 / threads)));
    var batches = [];
    for (var i = 0; i < state.paras.length; i += BATCH_SIZE) {
      batches.push({
        startIndex: i,
        texts: state.paras.slice(i, i + BATCH_SIZE).map(function (p) { return p.text; })
      });
    }

    var finishedCount = 0;
    var batchIdx = 0;

    function worker() {
      if (state.stop || batchIdx >= batches.length) return Promise.resolve();
      var b = batches[batchIdx++];
      return fetch(API_TRANSLATE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texts: b.texts,
          from: src,
          to: dst,
          service: service,
          llm: llmCfg
        })
      })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.translations && data.translations.length) {
          data.translations.forEach(function (trans, offset) {
            updateTransItem(b.startIndex + offset, trans);
          });
        }
        finishedCount += b.texts.length;
        var pct = Math.min(100, Math.round((finishedCount / state.paras.length) * 100));
        var prog = $('pm-xl-prog');
        if (prog) prog.style.width = pct + '%';
        updateStatus('已翻译 ' + finishedCount + ' / ' + state.paras.length + ' 段 (' + pct + '%)');
        return worker();
      })
      .catch(function (err) {
        updateStatus('段落翻译重试中: ' + err.message);
        return worker();
      });
    }

    var pool = [];
    for (var w = 0; w < threads; w++) {
      pool.push(worker());
    }

    Promise.all(pool).then(function () {
      updatePipelineStep(5);
      updateStatus('双语全文档翻译全部完成！支持导出与打印');
      $('pm-xl-status-dot').className = 'xl-status-dot';
      $('pm-xl-export-md').disabled = false;
      $('pm-xl-print-pdf').disabled = false;

      // 存入团队云端共享文库
      if (state.activePaperKey) {
        syncToCloudSharedCache();
      }
    }).finally(function () {
      state.running = false;
      $('pm-xl-run').disabled = false;
      $('pm-xl-stop').disabled = true;
    });
  }

  /* ==============================================================================
     8. 团队云端共享文库与协作批注同步
     ============================================================================== */
  function syncToCloudSharedCache() {
    if (!state.activePaperKey) return;
    fetch(API_TRANSLATIONS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paperKey: state.activePaperKey,
        title: state.fileName,
        mode: state.outputMode,
        paras: state.paras,
        trans: state.trans
      })
    })
    .then(function () {
      var badge = $('pm-xl-cloud-status');
      var txt = $('pm-xl-cloud-txt');
      if (badge && txt) {
        badge.style.display = 'inline-flex';
        txt.textContent = '已同步至团队云端成果库';
      }
    })
    .catch(function () {});
  }

  function checkCloudSharedCache(paperKey) {
    if (!paperKey) return;
    fetch(API_TRANSLATIONS + '?key=' + encodeURIComponent(paperKey))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.found && data.item) {
          var item = data.item;
          var badge = $('pm-xl-cloud-status');
          var txt = $('pm-xl-cloud-txt');
          if (badge && txt) {
            badge.style.display = 'inline-flex';
            txt.textContent = '团队成员于 ' + item.time + ' 精译，已秒开同步';
          }
          if (item.paras && item.trans) {
            state.paras = item.paras;
            state.trans = item.trans;
            renderParas();
            updatePipelineStep(5);
            updateStatus('已秒开团队预译成果！');
            $('pm-xl-export-md').disabled = false;
            $('pm-xl-print-pdf').disabled = false;
          }
        }
      })
      .catch(function () {});
  }

  function initNotesDrawer() {
    var toggleBtn = $('pm-xl-toggle-notes');
    var drawer = $('pm-xl-notes-drawer');
    var closeBtn = $('pm-xl-notes-close');
    var sendBtn = $('pm-xl-note-send');
    var input = $('pm-xl-note-input');

    if (toggleBtn) {
      toggleBtn.onclick = function () {
        drawer.style.display = drawer.style.display === 'none' ? 'flex' : 'none';
        loadNotes();
      };
    }
    if (closeBtn) closeBtn.onclick = function () { drawer.style.display = 'none'; };

    function loadNotes() {
      var key = state.activePaperKey || 'global';
      fetch(API_NOTES + '?paperId=' + encodeURIComponent(key))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var list = $('pm-xl-notes-list');
          list.innerHTML = '';
          if (!data.notes || !data.notes.length) {
            list.innerHTML = '<div class="notes-empty">暂无批注，发表第一条研读心得吧！</div>';
            $('pm-xl-notes-badge').textContent = '0';
            return;
          }
          $('pm-xl-notes-badge').textContent = data.notes.length;
          data.notes.forEach(function (n) {
            var card = document.createElement('div');
            card.className = 'note-card';
            card.innerHTML = '<div class="note-meta"><span>' + escapeHtml(n.user) + '</span><span>' + escapeHtml(n.time) + '</span></div>' +
                             '<div class="note-content">' + escapeHtml(n.content) + '</div>';
            list.appendChild(card);
          });
        });
    }

    if (sendBtn && input) {
      sendBtn.onclick = function () {
        var txt = (input.value || '').trim();
        if (!txt) return;
        var key = state.activePaperKey || 'global';
        fetch(API_NOTES, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paperId: key,
            content: txt,
            user: '学者 ' + CLIENT_ID.slice(-4)
          })
        })
        .then(function () {
          input.value = '';
          loadNotes();
        });
      };
    }
  }

  /* ==============================================================================
     9. 馆藏文献载入与主卡片「AI 双语精读」按钮集成
     ============================================================================== */
  function populatePapersSelector() {
    var sel = $('pm-xl-paper-select');
    if (!sel || !window.STATE || !window.STATE.papers) return;
    sel.innerHTML = '';
    window.STATE.papers.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = (p.titleCN || p.titleEN || p.fileName) + ' (' + (p.year || '') + ')';
      sel.appendChild(opt);
    });
  }

  function loadPaperIntoStudio(paper) {
    if (!paper) return;
    state.activePaperKey = 'paper_' + paper.id;
    state.fileName = paper.titleCN || paper.titleEN || paper.fileName;
    state.fileType = 'paper';
    state.paras = [];
    state.trans = [];

    $('pm-xl-file-card').style.display = 'flex';
    $('pm-xl-drop').style.display = 'none';
    $('pm-xl-paper-picker').style.display = 'none';
    $('pm-xl-paste-wrap').style.display = 'none';
    $('pm-xl-file-name').textContent = state.fileName;
    $('pm-xl-file-meta').textContent = '馆藏文献 · ' + (paper.year || '') + ' · ' + (paper.journal || '');
    $('pm-xl-run').disabled = false;

    // 先检查云端团队成果
    checkCloudSharedCache(state.activePaperKey);

    // 构建文献初始段落
    var counter = 1;
    var paras = [];
    if (paper.titleEN || paper.titleCN) {
      paras.push({ id: counter++, text: (paper.titleEN || '') + '\n' + (paper.titleCN || ''), isHeading: true, isMath: false });
    }
    if (paper.abstractEN) {
      paras.push({ id: counter++, text: 'Abstract: ' + paper.abstractEN, isHeading: false, isMath: false });
    }
    if (paper.paras && paper.paras.length) {
      paper.paras.forEach(function (txt) {
        if (txt && txt.trim()) {
          paras.push({ id: counter++, text: txt.trim(), isHeading: false, isMath: false });
        }
      });
    }
    state.paras = paras;
    renderParas();
    openStudio();
  }

  function wireMainPaperCards() {
    // 监听主界面的卡片点击事件与动态注入「AI 双语精读」按钮
    var observer = new MutationObserver(function () {
      document.querySelectorAll('.card').forEach(function (card) {
        if (card.querySelector('.act.xlate-btn')) return;
        var openBtn = card.querySelector('[data-act="open"]');
        if (!openBtn) return;
        var id = openBtn.getAttribute('data-id');
        var xlBtn = document.createElement('button');
        xlBtn.className = 'act xlate-btn';
        xlBtn.setAttribute('data-act', 'xlate');
        xlBtn.setAttribute('data-id', id);
        xlBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="vertical-align:middle;margin-right:3px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>AI 双语精读';
        xlBtn.title = 'AI 格式级全文档双语翻译与精读 (保留公式与排版)';
        xlBtn.onclick = function (e) {
          e.stopPropagation();
          var p = window.STATE && window.STATE.papers && window.STATE.papers.find(function (x) { return x.id == id; });
          if (p) loadPaperIntoStudio(p);
        };
        openBtn.parentNode.insertBefore(xlBtn, openBtn.nextSibling);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ==============================================================================
     10. 文件选择与模式切换绑定
     ============================================================================== */
  function handleFileSelected(file) {
    if (!file) return;
    state.fileName = file.name;
    state.fileSize = file.size;
    state.activePaperKey = 'file_' + file.name + '_' + file.size;
    state.paras = [];
    state.trans = [];

    var ext = file.name.split('.').pop().toLowerCase();
    $('pm-xl-file-card').style.display = 'flex';
    $('pm-xl-drop').style.display = 'none';
    $('pm-xl-file-name').textContent = file.name;
    $('pm-xl-file-meta').textContent = (file.size / 1024 / 1024).toFixed(2) + ' MB · ' + ext.toUpperCase();

    var reader = new FileReader();
    if (ext === 'docx') {
      state.fileType = 'docx';
      $('pm-xl-engine-desc').textContent = 'Word 格式级 1:1 样式重构引擎 · 完整保留粗斜体与表格';
      reader.onload = function (e) {
        state.fileBytes = e.target.result;
        updateStatus('Word 原文已视觉排版就绪，点击「开始翻译」即可执行 1:1 格式级重构');
        $('pm-xl-run').disabled = false;

        $('pm-xl-src-pdf-box').style.display = 'none';
        $('pm-xl-src-docx-box').style.display = 'flex';
        $('pm-xl-dst-pdf-box').style.display = 'none';
        $('pm-xl-dst-docx-box').style.display = 'flex';
        var empty = $('pm-xl-dst-empty');
        if (empty) empty.style.display = 'none';

        setViewMode('visual');
        renderWordOriginalView(state.fileBytes);
        checkCloudSharedCache(state.activePaperKey);
      };
      reader.readAsArrayBuffer(file);
    } else {
      state.fileType = 'pdf';
      $('pm-xl-engine-desc').textContent = 'PDFMathTranslate 级版面保护 · LaTeX 公式与图表 1:1 对齐';
      reader.onload = function (e) {
        state.fileBytes = e.target.result;
        loadPdfjs().then(function (pdfjs) {
          return pdfjs.getDocument({ data: state.fileBytes }).promise;
        }).then(function (pdfDoc) {
          state.pdfDoc = pdfDoc;
          state.totalPages = pdfDoc.numPages;
          state.currentPage = 1;
          var totalEl = $('pm-xl-page-total');
          if (totalEl) totalEl.textContent = state.totalPages;

          $('pm-xl-src-pdf-box').style.display = 'flex';
          $('pm-xl-src-docx-box').style.display = 'none';
          $('pm-xl-dst-pdf-box').style.display = 'flex';
          $('pm-xl-dst-docx-box').style.display = 'none';
          var empty = $('pm-xl-dst-empty');
          if (empty) empty.style.display = 'none';

          setViewMode('visual');
          renderPdfPage(1);

          var pagesVal = ($('pm-xl-pages').value || '').trim();
          extractPdfParas(window.pdfjsLib, state.fileBytes, pagesVal).then(function (paras) {
            state.paras = paras;
            renderParas();
            updateStatus('PDF 解析就绪，共 ' + state.totalPages + ' 页 / ' + paras.length + ' 个学术段落');
            $('pm-xl-run').disabled = false;
            checkCloudSharedCache(state.activePaperKey);
          });
        }).catch(function (err) {
          updateStatus('PDF 解析失败: ' + err.message);
        });
      };
      reader.readAsArrayBuffer(file);
    }
  }

  function bindEvents() {
    var chip = $('pm-xl-chip');
    var collabPill = $('pm-collab-pill');
    var closeBtn = $('pm-xl-close');
    var fileInput = $('pm-xl-file');
    var dropZone = $('pm-xl-drop');
    var pickBtn = $('pm-xl-pick-btn');
    var reselectBtn = $('pm-xl-reselect');

    if (chip) chip.onclick = openStudio;
    if (collabPill) collabPill.onclick = openStudio;
    if (closeBtn) closeBtn.onclick = closeStudio;

    if (pickBtn) pickBtn.onclick = function () { fileInput.click(); };
    if (dropZone) dropZone.onclick = function () { fileInput.click(); };

    if (reselectBtn) {
      reselectBtn.onclick = function () {
        $('pm-xl-file-card').style.display = 'none';
        $('pm-xl-drop').style.display = 'block';
        $('pm-xl-src-visual-wrap').style.display = 'none';
        $('pm-xl-dst-visual-wrap').style.display = 'none';
        $('pm-xl-doc-toolbar').style.display = 'none';
        $('pm-xl-src-list').innerHTML = '';
        $('pm-xl-dst-list').innerHTML = '';
        var empty = $('pm-xl-dst-empty');
        if (empty) empty.style.display = 'block';
        $('pm-xl-run').disabled = true;
        state.fileBytes = null;
        state.pdfDoc = null;
        state.paras = [];
        state.trans = [];
        fileInput.value = '';
      };
    }

    if (fileInput) {
      fileInput.onchange = function (e) {
        if (e.target.files && e.target.files[0]) handleFileSelected(e.target.files[0]);
      };
    }

    // 拖放监听
    if (dropZone) {
      dropZone.ondragover = function (e) { e.preventDefault(); dropZone.style.borderColor = '#c9a86a'; };
      dropZone.ondragleave = function () { dropZone.style.borderColor = ''; };
      dropZone.ondrop = function (e) {
        e.preventDefault();
        dropZone.style.borderColor = '';
        if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFileSelected(e.dataTransfer.files[0]);
      };
    }

    // 视图模式切换 (文档视觉排版浏览 vs 双语逐段对齐精读)
    var viewVisualBtn = $('pm-xl-view-visual');
    var viewDualBtn = $('pm-xl-view-dual');
    if (viewVisualBtn) viewVisualBtn.onclick = function () { setViewMode('visual'); };
    if (viewDualBtn) viewDualBtn.onclick = function () { setViewMode('dual'); };

    // PDF 控制工具条
    var pagePrev = $('pm-xl-page-prev');
    var pageNext = $('pm-xl-page-next');
    var pageCur = $('pm-xl-page-cur');
    var zoomIn = $('pm-xl-zoom-in');
    var zoomOut = $('pm-xl-zoom-out');
    var zoomFit = $('pm-xl-zoom-fit');

    if (pagePrev) pagePrev.onclick = function () {
      if (state.currentPage > 1) renderPdfPage(state.currentPage - 1);
    };
    if (pageNext) pageNext.onclick = function () {
      if (state.currentPage < state.totalPages) renderPdfPage(state.currentPage + 1);
    };
    if (pageCur) {
      pageCur.onchange = function () {
        var p = parseInt(pageCur.value, 10);
        if (!isNaN(p)) renderPdfPage(p);
      };
    }
    if (zoomIn) {
      zoomIn.onclick = function () {
        state.zoomScale = Math.min(2.5, state.zoomScale + 0.15);
        updateZoomText();
        renderPdfPage(state.currentPage);
      };
    }
    if (zoomOut) {
      zoomOut.onclick = function () {
        state.zoomScale = Math.max(0.6, state.zoomScale - 0.15);
        updateZoomText();
        renderPdfPage(state.currentPage);
      };
    }
    if (zoomFit) {
      zoomFit.onclick = function () {
        state.zoomScale = 1.0;
        updateZoomText();
        renderPdfPage(state.currentPage);
      };
    }

    // 模式选择 Tabs
    $('pm-xl-tab-doc').onclick = function () {
      setModeTab('doc');
      $('pm-xl-drop').style.display = state.paras.length || state.fileBytes ? 'none' : 'block';
      $('pm-xl-paper-picker').style.display = 'none';
      $('pm-xl-paste-wrap').style.display = 'none';
      if (state.viewMode === 'visual') setViewMode('visual');
    };
    $('pm-xl-tab-paper').onclick = function () {
      setModeTab('paper');
      $('pm-xl-drop').style.display = 'none';
      $('pm-xl-paper-picker').style.display = 'block';
      $('pm-xl-paste-wrap').style.display = 'none';
      populatePapersSelector();
    };
    $('pm-xl-tab-paste').onclick = function () {
      setModeTab('paste');
      $('pm-xl-drop').style.display = 'none';
      $('pm-xl-paper-picker').style.display = 'none';
      $('pm-xl-paste-wrap').style.display = 'block';
      setViewMode('dual');
    };

    $('pm-xl-paper-load-btn').onclick = function () {
      var id = $('pm-xl-paper-select').value;
      var p = window.STATE && window.STATE.papers && window.STATE.papers.find(function (x) { return x.id == id; });
      if (p) loadPaperIntoStudio(p);
    };

    // 输出模式切换 (双语对照 vs 单语纯译)
    var dualPill = $('pm-xl-mode-dual');
    var monoPill = $('pm-xl-mode-mono');
    dualPill.onclick = function () {
      dualPill.className = 'xl-pill active';
      monoPill.className = 'xl-pill';
      state.outputMode = 'dual';
      if (state.viewMode === 'visual' && state.fileType === 'pdf') {
        renderTranslatedPdfPage(state.currentPage);
      }
    };
    monoPill.onclick = function () {
      monoPill.className = 'xl-pill active';
      dualPill.className = 'xl-pill';
      state.outputMode = 'mono';
      if (state.viewMode === 'visual' && state.fileType === 'pdf') {
        renderTranslatedPdfPage(state.currentPage);
      }
    };

    // 自由文本输入解析
    var pasteArea = $('pm-xl-paste');
    pasteArea.oninput = function () {
      var val = (pasteArea.value || '').trim();
      if (!val) return;
      var blocks = val.split(/\n{2,}/);
      state.paras = blocks.map(function (txt, idx) {
        return { id: idx + 1, text: txt.trim(), isHeading: false, isMath: /[\$\=]/.test(txt) };
      });
      state.trans = [];
      renderParas();
      $('pm-xl-run').disabled = false;
    };

    // 翻译按钮
    $('pm-xl-run').onclick = startTranslation;
    $('pm-xl-stop').onclick = function () {
      state.stop = true;
      updateStatus('已手动终止翻译');
      $('pm-xl-status-dot').className = 'xl-status-dot';
      $('pm-xl-run').disabled = false;
      $('pm-xl-stop').disabled = true;
    };

    // 下载 Word 双语与纯译按钮
    var dlDocxDual = $('pm-xl-dl-docx-dual');
    var dlDocxMono = $('pm-xl-dl-docx-mono');
    if (dlDocxDual) {
      dlDocxDual.onclick = function () {
        if (state.docxDownloadUrl) window.location.href = state.docxDownloadUrl;
      };
    }
    if (dlDocxMono) {
      dlDocxMono.onclick = function () {
        if (state.docxDownloadUrl) window.location.href = state.docxDownloadUrl;
      };
    }

    // 导出 Markdown
    $('pm-xl-export-md').onclick = function () {
      var md = '# ' + (state.fileName || '学术文献双语对照') + '\n\n';
      state.paras.forEach(function (p, idx) {
        var tr = (state.trans[idx] && state.trans[idx].text) || '';
        md += '### Paragraph ' + p.id + '\n\n';
        md += '**原文**:\n> ' + p.text + '\n\n';
        md += '**译文**:\n' + tr + '\n\n---\n\n';
      });
      downloadTextFile(md, (state.fileName || 'paper') + '_dual.md');
    };

    // 导出/打印双语 PDF (安全拼接 script 标签，避免破坏外部 HTML 解析器)
    $('pm-xl-print-pdf').onclick = function () {
      var w = window.open('', '_blank');
      var html = '<!DOCTYPE html><html><head><title>' + escapeHtml(state.fileName) + ' - 双语对照</title>' +
                 '<style>body{font-family:sans-serif;padding:30px;line-height:1.6;color:#222;} .row{display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:12px 0;border-bottom:1px solid #eee;} .num{font-weight:bold;color:#999;font-size:12px;} h2{border-bottom:2px solid #333;padding-bottom:8px;}</style>' +
                 '</head><body><h2>' + escapeHtml(state.fileName) + ' (双语对照精读版)</h2>';
      state.paras.forEach(function (p, idx) {
        var tr = (state.trans[idx] && state.trans[idx].text) || '';
        html += '<div class="row"><div><div class="num">#' + p.id + ' 原文</div>' + escapeHtml(p.text) + '</div>' +
                '<div><div class="num">#' + p.id + ' 译文</div>' + escapeHtml(tr) + '</div></div>';
      });
      html += '<' + 'script>window.print();<' + '/script></body></html>';
      w.document.write(html);
      w.document.close();
    };

    // 快捷键支持：翻页与 Esc 关闭
    document.addEventListener('keydown', function (e) {
      if (!$('pm-xl').classList.contains('open')) return;
      if (e.key === 'Escape') {
        closeStudio();
      } else if (state.viewMode === 'visual' && state.fileType === 'pdf') {
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
          if (state.currentPage > 1) renderPdfPage(state.currentPage - 1);
        } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
          if (state.currentPage < state.totalPages) renderPdfPage(state.currentPage + 1);
        }
      }
    });

    // 复制全译文
    $('pm-xl-copy-all').onclick = function () {
      var all = state.trans.map(function (t) { return t.text; }).join('\n\n');
      navigator.clipboard.writeText(all).then(function () {
        updateStatus('全译文已复制至剪贴板');
      });
    };

    // 快捷键 Esc 关闭
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && $('pm-xl').classList.contains('open')) {
        closeStudio();
      }
    });

    setupSyncScroll();
    initApiModal();
    initNotesDrawer();
    wireMainPaperCards();
    mountTopbarItems();
    for (var t = 200; t <= 3000; t += 400) {
      setTimeout(mountTopbarItems, t);
    }
  }

  function mountTopbarItems() {
    var topbarRight = document.querySelector('.topbar-right');
    if (!topbarRight) return;

    var collabPill = $('pm-collab-pill');
    var libChip = $('libChip');
    if (collabPill && collabPill.parentNode !== topbarRight) {
      if (libChip) {
        topbarRight.insertBefore(collabPill, libChip);
      } else {
        topbarRight.insertBefore(collabPill, topbarRight.firstChild);
      }
    }

    if (!$('topbar-xl-btn')) {
      var impDrop = $('impDrop');
      var btn = document.createElement('button');
      btn.className = 'btn gold';
      btn.id = 'topbar-xl-btn';
      btn.type = 'button';
      btn.title = 'AI 格式级全文档双语翻译工坊 (支持 PDF / Word)';
      btn.innerHTML =
        '<svg class="ic" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><path d="M4 5h7M7.5 5v1c0 4-1.5 8-4 11"/><path d="M5 12c2.5 3 5 4.5 8 5.5"/><path d="M13 20l3.5-8 3.5 8M14.2 17h4.6"/></svg>' +
        '<span>全文档双语翻译</span>';
      btn.onclick = openStudio;
      if (impDrop) {
        topbarRight.insertBefore(btn, impDrop);
      } else {
        topbarRight.appendChild(btn);
      }
    }
  }

  function setModeTab(mode) {
    state.mode = mode;
    ['doc', 'paper', 'paste'].forEach(function (m) {
      var el = $('pm-xl-tab-' + m);
      if (el) el.className = 'xl-tab' + (m === mode ? ' active' : '');
    });
  }

  function openStudio() {
    $('pm-xl').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeStudio() {
    $('pm-xl').classList.remove('open');
    document.body.style.overflow = '';
  }

  function updateStatus(msg) {
    var el = $('pm-xl-status');
    if (el) el.textContent = msg;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function downloadTextFile(text, filename) {
    var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  // DOM 就绪启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      initLangSelects();
      bindEvents();
    });
  } else {
    initLangSelects();
    bindEvents();
  }

})();
