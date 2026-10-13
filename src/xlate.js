/* ===== 内置 PDF 双语翻译：客户端抽取 + 站点自带翻译接口 ===== */
(function () {
  'use strict';
  var API = '/api/translate';
  var BATCH = 8;                 // 每次请求的段落数
  var PDFJS_SRC = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  var PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

  var LANGS = [
    ['auto', '自动检测'], ['en', '英语'], ['ja', '日语'], ['ko', '韩语'], ['fr', '法语'],
    ['de', '德语'], ['es', '西班牙语'], ['ru', '俄语'], ['zh-Hans', '中文(简)']
  ];
  var TARGETS = [['zh-Hans', '中文(简体)'], ['zh-Hant', '中文(繁体)'], ['en', '英语'], ['ja', '日语']];

  var T = {
    zh: {
      chip: 'PDF 双语翻译', sub: '内置引擎', engine: '· Bing 引擎，无需 Key',
      pick: '选择 PDF', run: '开始翻译', stop: '停止', exp: '导出 Markdown', close: '关闭',
      dstH: '译文', ready: '就绪', extracting: '正在解析 PDF…', translating: '正在翻译',
      done: '翻译完成', stopped: '已停止', noText: '这份 PDF 没有提取到可翻译的文本（可能是扫描件，需要 OCR）',
      pickTip: '拖入 PDF，或点击选择文件', pasteTip: '也可以直接粘贴文本（支持中/英/日等 → 中文）',
      err: '出错', needPdfjs: '无法加载 pdf.js（首次使用需联网），可改用「粘贴文本」模式',
      copied: '已复制', pairs: '段'
    },
    en: {
      chip: 'PDF Translator', sub: 'built-in', engine: '· Bing engine, no key',
      pick: 'Choose PDF', run: 'Translate', stop: 'Stop', exp: 'Export Markdown', close: 'Close',
      dstH: 'Translation', ready: 'Ready', extracting: 'Extracting PDF…', translating: 'Translating',
      done: 'Done', stopped: 'Stopped', noText: 'No extractable text (scanned PDF needs OCR)',
      pickTip: 'Drop a PDF here, or click to choose', pasteTip: 'Or paste text (any language → Chinese)',
      err: 'Error', needPdfjs: 'Failed to load pdf.js (needs network). Use paste mode instead.',
      copied: 'Copied', pairs: 'paragraphs'
    }
  };
  function lang() { return (document.documentElement.lang || 'zh').indexOf('en') === 0 ? 'en' : 'zh'; }
  function t(k) { return (T[lang()] || T.zh)[k]; }
  function $(id) { return document.getElementById(id); }

  var state = { paras: [], trans: [], running: false, stop: false, name: '' };

  /* ---------- pdf.js ---------- */
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
      s.onerror = function () { reject(new Error('pdfjs load failed')); };
      document.head.appendChild(s);
    });
  }

  /* ---------- 文本抽取（行 → 段落启发式） ---------- */
  function linesToParas(lines) {
    var paras = [], buf = '', lastY = null, heights = [];
    lines.forEach(function (ln) { if (ln.h) heights.push(ln.h); });
    heights.sort(function (a, b) { return a - b; });
    var medH = heights.length ? heights[Math.floor(heights.length / 2)] : 12;

    lines.forEach(function (ln) {
      var text = (ln.text || '').trim();
      if (!text) return;
      if (/^\d{1,4}$/.test(text)) return;                       // 页码
      var gap = lastY === null ? 0 : (lastY - ln.y);
      var isBullet = /^([•·\-*]|\(?\d{1,2}[.)])\s+/.test(text);
      var prevEnds = /[.:;!?。！？；：]$/.test(buf.trim());
      var newPara = !buf || gap > medH * 1.75 || isBullet ||
                    (prevEnds && buf.trim().length > 40 && gap > medH * 1.15);
      if (newPara && buf) { paras.push(buf.trim()); buf = ''; }
      buf += (buf && !/[\-\u2010-\u2015]$/.test(buf) ? ' ' : '') + text;
      lastY = ln.y;
    });
    if (buf.trim()) paras.push(buf.trim());
    return paras.filter(function (p) { return p.length > 1; });
  }

  function extractPdf(pdfjsLib, data) {
    return pdfjsLib.getDocument({ data: data }).promise.then(function (doc) {
      var out = [], chain = Promise.resolve();
      var _loop = function (i) {
        chain = chain.then(function () {
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
              linesToParas(lines).forEach(function (p) { out.push({ page: i, text: p }); });
              $('pm-xl-status').textContent = t('extracting') + ' ' + i + '/' + doc.numPages;
            });
          });
        });
      };
      for (var i = 1; i <= doc.numPages; i++) _loop(i);
      return chain.then(function () { return out; });
    });
  }

  /* ---------- 渲染 ---------- */
  function renderSrc() {
    var list = $('pm-xl-src-list');
    list.innerHTML = state.paras.map(function (p, i) {
      return '<div class="pair"><div class="src"><span class="tag">P' + p.page + '·' + (i + 1) +
             '</span>' + esc(p.text) + '</div></div>';
    }).join('');
    $('pm-xl-empty').style.display = state.paras.length ? 'none' : 'flex';
  }
  function renderDst() {
    var list = $('pm-xl-dst-list');
    list.innerHTML = state.paras.map(function (p, i) {
      var tr = state.trans[i];
      return '<div class="pair"><div class="dst' + (tr ? '' : ' wait') + '"><span class="tag">' + (i + 1) +
             '</span>' + (tr ? esc(tr) : '…') + '</div></div>';
    }).join('');
    $('pm-xl-dst-h').textContent = t('dstH');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c];
    });
  }
  function setProgress(done, total) {
    $('pm-xl-prog').style.width = total ? Math.round(done * 100 / total) + '%' : '0';
    $('pm-xl-count').textContent = done + '/' + total + ' ' + t('pairs');
  }

  /* ---------- 翻译 ---------- */
  function translateAll() {
    if (!state.paras.length || state.running) return;
    state.running = true; state.stop = false;
    $('pm-xl-run').disabled = true; $('pm-xl-stop').disabled = false;
    $('pm-xl-status').textContent = t('translating') + '…';

    var i = 0, total = state.paras.length;
    function step() {
      if (state.stop || i >= total) {
        state.running = false;
        $('pm-xl-run').disabled = false; $('pm-xl-stop').disabled = true;
        $('pm-xl-export').disabled = !state.trans.some(Boolean);
        $('pm-xl-status').textContent = state.stop ? t('stopped') : t('done');
        return;
      }
      var slice = state.paras.slice(i, i + BATCH).map(function (p) { return p.text; });
      fetch(API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: slice, from: $('pm-xl-from').value, to: $('pm-xl-to').value })
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (d) {
        (d.translations || []).forEach(function (tr, k) { state.trans[i + k] = tr; });
        i += slice.length;
        renderDst(); setProgress(i, total);
        setTimeout(step, 120);
      }).catch(function (e) {
        state.running = false;
        $('pm-xl-run').disabled = false; $('pm-xl-stop').disabled = true;
        $('pm-xl-status').textContent = t('err') + ': ' + e.message;
      });
    }
    step();
  }

  function exportMd() {
    var lines = ['# ' + (state.name || 'PDF') + ' · 双语翻译', ''];
    state.paras.forEach(function (p, i) {
      lines.push('> 原文（P' + p.page + '）', '', p.text, '', state.trans[i] || '', '', '---', '');
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (state.name || 'pdf') .replace(/\.pdf$/i, '') + '-bilingual.md';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  /* ---------- 载入来源 ---------- */
  function usePdf(file) {
    state.name = file.name; state.paras = []; state.trans = [];
    renderSrc(); renderDst(); setProgress(0, 0);
    $('pm-xl-status').textContent = t('extracting');
    loadPdfjs().then(function (pdfjsLib) {
      return file.arrayBuffer().then(function (buf) {
        return extractPdf(pdfjsLib, new Uint8Array(buf));
      });
    }).then(function (paras) {
      state.paras = paras;
      if (!paras.length) { $('pm-xl-status').textContent = t('noText'); }
      else { $('pm-xl-status').textContent = t('ready') + ' · ' + paras.length + ' ' + t('pairs'); }
      renderSrc(); renderDst(); setProgress(0, paras.length);
      $('pm-xl-run').disabled = !paras.length;
    }).catch(function (e) {
      $('pm-xl-status').textContent = t('err') + ': ' + (e && e.message || e);
      $('pm-xl-paste').placeholder = t('needPdfjs');
    });
  }

  function usePaste() {
    var txt = $('pm-xl-paste').value || '';
    var paras = txt.split(/\n\s*\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    state.name = 'pasted-text'; state.trans = [];
    state.paras = paras.map(function (p) { return { page: 1, text: p }; });
    renderSrc(); renderDst(); setProgress(0, paras.length);
    $('pm-xl-run').disabled = !paras.length;
    $('pm-xl-status').textContent = paras.length ? t('ready') + ' · ' + paras.length + ' ' + t('pairs') : t('ready');
  }

  /* ---------- UI ---------- */
  function fillSelect(el, opts) {
    el.innerHTML = opts.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('');
  }
  function paint() {
    $('pm-xl-chip-txt').textContent = t('chip');
    $('pm-xl-chip-sub').textContent = t('sub');
    $('pm-xl-title').textContent = t('chip');
    $('pm-xl-engine').textContent = t('engine');
    $('pm-xl-pick').textContent = t('pick');
    $('pm-xl-run').textContent = t('run');
    $('pm-xl-stop').textContent = t('stop');
    $('pm-xl-export').textContent = t('exp');
    $('pm-xl-close').textContent = t('close');
    $('pm-xl-drop').querySelector('div').textContent = t('pickTip');
    $('pm-xl-drop').querySelectorAll('div')[1].textContent = t('pasteTip');
    renderDst();
  }

  function open() { $('pm-xl').classList.add('show'); }
  function close() { $('pm-xl').classList.remove('show'); }

  function boot() {
    fillSelect($('pm-xl-from'), LANGS);
    fillSelect($('pm-xl-to'), TARGETS);
    $('pm-xl-from').value = 'auto';
    $('pm-xl-to').value = 'zh-Hans';
    paint();

    $('pm-xl-chip').addEventListener('click', open);
    $('pm-xl-close').addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    $('pm-xl-pick').addEventListener('click', function () { $('pm-xl-file').click(); });
    $('pm-xl-drop').addEventListener('click', function () { $('pm-xl-file').click(); });
    $('pm-xl-file').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) usePdf(e.target.files[0]);
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      $('pm-xl').addEventListener(ev, function (e) {
        if (e.dataTransfer && e.dataTransfer.types && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0) {
          e.preventDefault(); $('pm-xl-drop').classList.add('over');
        }
      });
    });
    $('pm-xl').addEventListener('dragleave', function () { $('pm-xl-drop').classList.remove('over'); });
    $('pm-xl').addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        e.preventDefault(); $('pm-xl-drop').classList.remove('over');
        usePdf(e.dataTransfer.files[0]);
      }
    });
    $('pm-xl-paste').addEventListener('blur', usePaste);
    $('pm-xl-run').addEventListener('click', function () {
      if ($('pm-xl-empty').style.display !== 'none' || !state.paras.length) usePaste();
      translateAll();
    });
    $('pm-xl-stop').addEventListener('click', function () { state.stop = true; });
    $('pm-xl-export').addEventListener('click', exportMd);

    new MutationObserver(paint).observe(document.documentElement,
      { attributes: true, attributeFilter: ['lang'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
