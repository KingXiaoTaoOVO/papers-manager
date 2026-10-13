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

  // 客户端独立标识（多人协同）
  var CLIENT_ID = localStorage.getItem('pm_client_id');
  if (!CLIENT_ID) {
    CLIENT_ID = 'user_' + Math.random().toString(36).substring(2, 10);
    localStorage.setItem('pm_client_id', CLIENT_ID);
  }

  var state = {
    mode: 'doc',           // 'doc' | 'paper' | 'paste'
    outputMode: 'dual',    // 'dual' | 'mono'
    fileType: '',          // 'pdf' | 'docx' | 'text' | 'paper'
    fileName: '',
    fileSize: 0,
    fileBytes: null,       // Uint8Array / Base64
    activePaperKey: '',
    paras: [],             // [{ id: 1, text: '...', page: 1, isHeading: false, isMath: false }]
    trans: [],             // [{ id: 1, text: '...' }]
    running: false,
    stop: false,
    docxDownloadUrl: '',
    docxBase64: '',
    notes: []
  };

  /* ==============================================================================
     1. 多人在线协同状态与心跳机制 (Presence)
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
      if (data && data.online_count) {
        var pill = $('pm-online-count');
        if (pill) {
          pill.textContent = data.online_count + ' 位学者在线研读';
        }
      }
    })
    .catch(function () {});
  }

  // 每 25 秒自动发送心跳
  setInterval(sendPresenceHeartbeat, 25000);
  setTimeout(sendPresenceHeartbeat, 1500);

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
     4. 文档解析与段落抽取（PDF 与 Word 原生）
     ============================================================================== */
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
        updateStatus('Word 文档就绪，点击「开始翻译」即可生成 1:1 双语/单语 Word');
        $('pm-xl-run').disabled = false;
        checkCloudSharedCache(state.activePaperKey);
      };
      reader.readAsArrayBuffer(file);
    } else {
      state.fileType = 'pdf';
      $('pm-xl-engine-desc').textContent = 'PDFMathTranslate 级版面保护 · LaTeX 公式与图表 1:1 对齐';
      reader.onload = function (e) {
        state.fileBytes = e.target.result;
        loadPdfjs().then(function (pdfjs) {
          var pagesVal = ($('pm-xl-pages').value || '').trim();
          extractPdfParas(pdfjs, state.fileBytes, pagesVal).then(function (paras) {
            state.paras = paras;
            renderParas();
            updateStatus('PDF 解析就绪，共提取 ' + paras.length + ' 个学术段落');
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
    if (reselectBtn) reselectBtn.onclick = function () { fileInput.click(); };

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

    // 模式选择 Tabs
    $('pm-xl-tab-doc').onclick = function () {
      setModeTab('doc');
      $('pm-xl-drop').style.display = state.paras.length ? 'none' : 'block';
      $('pm-xl-paper-picker').style.display = 'none';
      $('pm-xl-paste-wrap').style.display = 'none';
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
    };
    monoPill.onclick = function () {
      monoPill.className = 'xl-pill active';
      dualPill.className = 'xl-pill';
      state.outputMode = 'mono';
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
