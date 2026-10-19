/* ===== module: catalog.js (学科大类整理 / 用户免登录上传 / 管理员门户 / 全球学术检索 / 中英智能互通) ===== */
(function () {
  'use strict';

  var CATEGORIES = [
    { id: 'all', name: '全部学科', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/></svg>' },
    { id: 'cs_ai', name: '人工智能与计算科学', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>' },
    { id: 'neuro', name: '神经科学与脑科学', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7z"/><path d="M9 21h6"/></svg>' },
    { id: 'psych', name: '心理学与认知行为', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>' },
    { id: 'bio', name: '生物医药与生命科学', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M2 15c6.667-6 13.333 0 20-6"/><path d="M9 22c1.798-1.998 2.518-3.995 2.807-5.993"/><path d="M15 2c-1.798 1.998-2.518 3.995-2.807 5.993"/></svg>' },
    { id: 'med', name: '临床医学与公共健康', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>' },
    { id: 'phys_eng', name: '物理与工程技术', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/><line x1="12" y1="3" x2="12" y2="21"/><line x1="3" y1="12" x2="21" y2="12"/></svg>' },
    { id: 'user_lib', name: '用户贡献文库', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' }
  ];

  // 学术双向互通拓展词表（中文 <-> 英文精准学术对等词）
  var BILINGUAL_DICT = {
    '呼吸': ['respiration', 'breathing', 'breath', 'respiratory'],
    'respiration': ['呼吸', '呼吸调节'],
    'breathing': ['呼吸', '气息'],
    '冥想': ['meditation', 'meditative', 'mindfulness', 'dhyana'],
    'meditation': ['冥想', '静观'],
    '正念': ['mindfulness', 'mindful', 'acceptance'],
    'mindfulness': ['正念', '当下觉察', '静观'],
    '抑郁': ['depression', 'depressive', 'major depressive'],
    'depression': ['抑郁', '抑郁症'],
    '焦虑': ['anxiety', 'anxious'],
    'anxiety': ['焦虑', '焦虑症'],
    '注意力': ['attention', 'attentional', 'focus'],
    'attention': ['注意力', '注意机制', '自注意力'],
    '脑电': ['eeg', 'electroencephalogram', 'electroencephalography'],
    'eeg': ['脑电', '脑电波', '脑电信号'],
    '神经': ['neural', 'neuro', 'neuron', 'nervous'],
    'neural': ['神经', '神经网络'],
    '皮层': ['cortex', 'cortical', 'prefrontal'],
    'cortex': ['皮层', '大脑皮质'],
    '深度学习': ['deep learning', 'neural network'],
    'deep learning': ['深度学习'],
    '神经网络': ['neural network', 'deep learning'],
    'neural network': ['神经网络'],
    '人工智能': ['artificial intelligence', 'ai', 'machine learning'],
    'artificial intelligence': ['人工智能', 'AI'],
    '变分': ['variational', 'vae'],
    'variational': ['变分', '变分推断'],
    '自监督': ['self-supervised'],
    'self-supervised': ['自监督'],
    '脑机接口': ['brain-computer interface', 'bci'],
    'bci': ['脑机接口'],
    '心率': ['heart rate', 'hrv', 'cardiac'],
    'hrv': ['心率变异性', '心率'],
    '幸福感': ['well-being', 'wellbeing', 'happiness'],
    'well-being': ['幸福感', '福祉', '主观幸福'],
    'wellbeing': ['幸福感', '福祉'],
    '元分析': ['meta-analysis', 'systematic review'],
    'meta-analysis': ['元分析', '荟萃分析'],
    '睡眠': ['sleep', 'circadian', 'insomnia'],
    'sleep': ['睡眠', '入睡'],
    '大语言模型': ['large language model', 'llm'],
    'llm': ['大语言模型', '语言模型'],
    '蛋白质': ['protein', 'proteomics'],
    'protein': ['蛋白质', '蛋白'],
    '基因': ['gene', 'genetic', 'genome'],
    'gene': ['基因', '遗传'],
    '情绪': ['emotion', 'emotional', 'affective'],
    'emotion': ['情绪', '情感']
  };

  var curCategory = 'all';
  var adminToken = sessionStorage.getItem('pm_admin_token') || '';
  var dynamicExpansionCache = {};

  function $(id) { return document.getElementById(id); }

  // 1. 自动对文献进行学术大类分类
  function classifyPaper(p) {
    if (p.category && p.category !== '未分类') return p.category;
    if (p.isUserUpload) return '用户贡献与自传文献';

    var txt = [
      p.titleCN || '',
      p.titleEN || '',
      p.journal || '',
      (p.keywords || []).join(' '),
      p.relPath || '',
      (p.institutions || []).join(' ')
    ].join(' ').toLowerCase();

    // 神经科学与脑科学
    if (/eeg|brain|cortex|neuroscience|脑电|皮层|脑区|脑机|神经科学|fmri|cortex|synap/.test(txt)) {
      return '神经科学与脑科学';
    }
    // 人工智能与计算科学
    if (/ieee|neural network|deep learning|machine learning|computing|affective computing|algorithm|artificial intelligence|transformer|llm|深度学习|计算|算法|神经网络|人工智能/.test(txt)) {
      return '人工智能与计算科学';
    }
    // 心理学与认知行为
    if (/psychol|well-being|mindful|meditat|depress|anxiety|stress|emotion|affect|happiness|resilience|心理|冥想|正念|幸福感|情绪|行为|疲劳|压力|认知/.test(txt)) {
      return '心理学与认知行为';
    }
    // 临床医学与公共健康
    if (/lancet|jama|clinical|medicine|health|trial|patient|therapy|rct|disease|mortality|epidemiology|cancer|cardiac|public health|医学|临床|健康|治疗|患者|精神医学/.test(txt)) {
      return '临床医学与公共健康';
    }
    // 生物医药与生命科学
    if (/cell|gene|protein|dna|rna|molecular|bio|biomarker|crispr|pharmac|生命|细胞|生物|基因|蛋白/.test(txt)) {
      return '生物医药与生命科学';
    }
    // 物理与工程技术
    if (/sensor|physic|engineering|device|material|quantum|optics|nanomaterial|mechanics|semiconductor|传感器|工程|器件|物理/.test(txt)) {
      return '物理与工程技术';
    }

    return '神经科学与脑科学';
  }

  // 2. 统计各学科文献数量
  function getCategoryCounts() {
    var counts = { all: 0, cs_ai: 0, neuro: 0, psych: 0, bio: 0, med: 0, phys_eng: 0, user_lib: 0 };
    if (!window.STATE || !Array.isArray(window.STATE.papers)) return counts;

    counts.all = window.STATE.papers.length;
    window.STATE.papers.forEach(function (p) {
      if (!p.category) p.category = classifyPaper(p);
      var cat = p.category;
      if (p.isUserUpload) counts.user_lib++;
      if (cat.indexOf('计算') !== -1 || cat.indexOf('智能') !== -1) counts.cs_ai++;
      else if (cat.indexOf('脑') !== -1 || cat.indexOf('神经') !== -1) counts.neuro++;
      else if (cat.indexOf('心理') !== -1 || cat.indexOf('认知') !== -1) counts.psych++;
      else if (cat.indexOf('生命') !== -1 || cat.indexOf('生物') !== -1) counts.bio++;
      else if (cat.indexOf('临床') !== -1 || cat.indexOf('医学') !== -1) counts.med++;
      else if (cat.indexOf('物理') !== -1 || cat.indexOf('工程') !== -1) counts.phys_eng++;
    });
    return counts;
  }

  // 3. 构建并挂载学科大类筛选导航条
  function mountCategoryStrip() {
    var existing = $('pm-cat-strip');
    if (existing) existing.remove();

    var strip = document.createElement('div');
    strip.id = 'pm-cat-strip';

    var inner = document.createElement('div');
    inner.className = 'pm-cat-inner';

    var tabs = document.createElement('div');
    tabs.className = 'pm-cat-tabs';

    var counts = getCategoryCounts();

    CATEGORIES.forEach(function (cat) {
      var pill = document.createElement('div');
      pill.className = 'pm-cat-pill' + (curCategory === cat.id ? ' active' : '');
      pill.setAttribute('data-cat-id', cat.id);
      var cnt = counts[cat.id] || 0;
      pill.innerHTML = cat.icon + '<span>' + cat.name + '</span><span class="pm-pill-cnt">' + cnt + '</span>';

      pill.onclick = function () {
        curCategory = cat.id;
        document.querySelectorAll('.pm-cat-pill').forEach(function (el) { el.classList.remove('active'); });
        pill.classList.add('active');
        applyFiltersAndRender();
      };
      tabs.appendChild(pill);
    });

    var actions = document.createElement('div');
    actions.className = 'pm-cat-actions';

    // 上传论文入口
    var uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.className = 'pm-action-btn gold';
    uploadBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span>上传文献</span>';
    uploadBtn.onclick = function () { openModal('pm-upload-modal'); };

    // 全球学术检索入口
    var globalBtn = document.createElement('button');
    globalBtn.type = 'button';
    globalBtn.className = 'pm-action-btn green';
    globalBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg><span>全球学术</span>';
    globalBtn.onclick = function () { openModal('pm-global-modal'); };

    // 管理员管理入口
    var adminBtn = document.createElement('button');
    adminBtn.type = 'button';
    adminBtn.id = 'pm-top-admin-btn';
    adminBtn.className = 'pm-action-btn' + (adminToken ? ' admin-on' : '');
    adminBtn.innerHTML = adminToken
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg><span>管理已激活</span>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><span>管理员</span>';
    adminBtn.onclick = function () { openAdminModal(); };

    actions.appendChild(uploadBtn);
    actions.appendChild(globalBtn);
    actions.appendChild(adminBtn);

    inner.appendChild(tabs);
    inner.appendChild(actions);
    strip.appendChild(inner);

    var main = document.querySelector('.main');
    if (main) {
      main.insertBefore(strip, main.firstChild);
    }
  }

  // 4. 中英双向智能互通拓展算法
  function expandQueryTerms(q) {
    if (!q) return [];
    var raw = q.trim().toLowerCase();
    var terms = [raw];

    // 查阅本地核心对等学术词库
    Object.keys(BILINGUAL_DICT).forEach(function (k) {
      if (raw.indexOf(k.toLowerCase()) !== -1) {
        BILINGUAL_DICT[k].forEach(function (equiv) {
          terms.push(equiv.toLowerCase());
        });
      }
    });

    // 动态网络翻译结果注入
    if (dynamicExpansionCache[raw]) {
      var dyn = dynamicExpansionCache[raw];
      if (dyn.cn && terms.indexOf(dyn.cn.toLowerCase()) === -1) terms.push(dyn.cn.toLowerCase());
      if (dyn.en && terms.indexOf(dyn.en.toLowerCase()) === -1) terms.push(dyn.en.toLowerCase());
    }

    return terms;
  }

  // 异步触发后端翻译增强扩展
  var expandDebounceTimer = null;
  function triggerServerQueryExpansion(q) {
    if (!q || q.length < 2) return;
    clearTimeout(expandDebounceTimer);
    expandDebounceTimer = setTimeout(function () {
      if (dynamicExpansionCache[q]) return;
      fetch('/api/papers/expand_query?q=' + encodeURIComponent(q))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data && data.ok) {
            dynamicExpansionCache[q] = data;
            if (window.render) window.render();
          }
        }).catch(function () {});
    }, 400);
  }

  // 5. 挂钩原系统的 match(p, q) 和 visible()
  function hookSearchAndFilters() {
    if (!window.visible) return;

    // 重新封装 match 支持中英智能双向互通搜索
    window.match = function (p, q) {
      if (!q) return true;
      triggerServerQueryExpansion(q);
      var queryTerms = expandQueryTerms(q);

      var hay = [
        p.titleCN || '',
        p.titleEN || '',
        p.abstract || '',
        p.abstractCN || '',
        p.abstractEN || '',
        p.conclusion || '',
        (p.keywords || []).join(' '),
        p.fullText || '',
        p.relPath || '',
        p.journal || '',
        p.platform || '',
        (p.institutions || []).join(' '),
        p.doi || '',
        p.category || ''
      ].join(' ').toLowerCase();

      return queryTerms.some(function (t) {
        return hay.indexOf(t) >= 0;
      });
    };

    // 重新封装 visible 支持大类筛选
    var oldVisible = window.visible;
    window.visible = function () {
      var arr = oldVisible();
      if (curCategory === 'all') return arr;

      return arr.filter(function (p) {
        if (!p.category) p.category = classifyPaper(p);
        if (curCategory === 'user_lib') return p.isUserUpload;
        if (curCategory === 'cs_ai') return p.category.indexOf('计算') !== -1 || p.category.indexOf('智能') !== -1;
        if (curCategory === 'neuro') return p.category.indexOf('脑') !== -1 || p.category.indexOf('神经') !== -1;
        if (curCategory === 'psych') return p.category.indexOf('心理') !== -1 || p.category.indexOf('认知') !== -1;
        if (curCategory === 'bio') return p.category.indexOf('生命') !== -1 || p.category.indexOf('生物') !== -1;
        if (curCategory === 'med') return p.category.indexOf('临床') !== -1 || p.category.indexOf('医学') !== -1;
        if (curCategory === 'phys_eng') return p.category.indexOf('物理') !== -1 || p.category.indexOf('工程') !== -1;
        return true;
      });
    };

    // 重新包装 render 在卡片上挂载即刻双语翻译按钮与管理员删除按钮
    var oldRender = window.render;
    window.render = function () {
      oldRender();
      enhanceCardsUI();
    };
  }

  function applyFiltersAndRender() {
    if (window.render) window.render();
    if (window.refreshStreamCount) window.refreshStreamCount();
  }

  // 6. 丰富卡片视觉与操作按钮
  function enhanceCardsUI() {
    var host = $('list');
    if (!host) return;

    var cards = host.querySelectorAll('.card');
    cards.forEach(function (card) {
      var idStr = card.getAttribute('data-id');
      if (!idStr) return;
      var p = (window.STATE.papers || []).find(function (x) { return String(x.id) === String(idStr); });
      if (!p) return;

      // 1. 增强标签行添加学科大类与来源
      var tagRow = card.querySelector('.tag-row');
      if (tagRow && !tagRow.querySelector('.pm-cat-tag')) {
        var catName = p.category || classifyPaper(p);
        var spanCat = document.createElement('span');
        spanCat.className = 't pm-cat-tag';
        spanCat.style.cssText = 'border-color:#c9a86a;color:#c9a86a;background:rgba(201,168,106,0.1);font-weight:600;display:inline-flex;align-items:center;gap:4px;';
        spanCat.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>' + catName;
        tagRow.insertBefore(spanCat, tagRow.firstChild);

        if (p.isUserUpload) {
          var spanUsr = document.createElement('span');
          spanUsr.className = 't pm-usr-tag';
          spanUsr.style.cssText = 'border-color:#10b981;color:#10b981;background:rgba(16,185,129,0.1);font-weight:600;display:inline-flex;align-items:center;gap:4px;';
          spanUsr.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>用户文库';
          tagRow.insertBefore(spanUsr, tagRow.firstChild);
        }
      }

      // 2. 增强动作按钮行添加「即刻双语翻译」与「管理员删除」
      var acts = card.querySelector('.acts');
      if (acts) {
        if (!acts.querySelector('.pm-act-xlate')) {
          var btnX = document.createElement('button');
          btnX.type = 'button';
          btnX.className = 'act pm-act-xlate';
          btnX.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>即刻双语翻译';
          btnX.onclick = function (e) {
            e.stopPropagation();
            if (window.openXlateStudioWithPaper) {
              window.openXlateStudioWithPaper(p);
            }
          };
          acts.insertBefore(btnX, acts.firstChild);
        }

        // 管理员删除按钮
        if (adminToken && !acts.querySelector('.pm-act-del')) {
          var btnDel = document.createElement('button');
          btnDel.type = 'button';
          btnDel.className = 'act bad pm-act-del';
          btnDel.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>删除文献';
          btnDel.onclick = function (e) {
            e.stopPropagation();
            deletePaper(p);
          };
          acts.appendChild(btnDel);
        }
      }
    });
  }

  // 7. 弹窗打开与关闭
  function openModal(id) {
    var el = $(id);
    if (el) el.classList.add('open');
  }
  function closeModal(id) {
    var el = $(id);
    if (el) el.classList.remove('open');
  }

  // 8. 模态框事件绑定
  function bindModals() {
    // 8.1 用户自主免登录上传
    var upClose = $('pm-upload-close');
    var upCancel = $('pm-up-cancel');
    var upSubmit = $('pm-up-submit');
    if (upClose) upClose.onclick = function () { closeModal('pm-upload-modal'); };
    if (upCancel) upCancel.onclick = function () { closeModal('pm-upload-modal'); };

    if (upSubmit) {
      upSubmit.onclick = function () {
        var cat = $('pm-up-cat').value;
        var titleCN = ($('pm-up-title-cn').value || '').trim();
        var titleEN = ($('pm-up-title-en').value || '').trim();
        var authors = ($('pm-up-authors').value || '').trim();
        var journal = ($('pm-up-journal').value || '').trim() || '用户文库';
        var year = ($('pm-up-year').value || '').trim() || '2026';
        var doi = ($('pm-up-doi').value || '').trim();
        var abstract = ($('pm-up-abstract').value || '').trim();
        var fileInput = $('pm-up-file');

        if (!titleCN && !titleEN) {
          alert('请至少填写中文或英文标题！');
          return;
        }

        var statusEl = $('pm-up-status');
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.textContent = '正在保存上传文献…';
        }
        upSubmit.disabled = true;

        var doSend = function (fileB64, fileName) {
          var payload = {
            category: cat,
            titleCN: titleCN || titleEN,
            titleEN: titleEN,
            authors: authors,
            journal: journal,
            year: year,
            doi: doi,
            abstract: abstract,
            abstractCN: titleCN ? abstract : '',
            abstractEN: titleEN ? abstract : '',
            fileBase64: fileB64 || null,
            fileName: fileName || ''
          };

          fetch('/api/papers/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }).then(function (r) { return r.json(); })
            .then(function (res) {
              upSubmit.disabled = false;
              if (res && res.ok && res.paper) {
                // 实时加入前端并保存
                res.paper.status = 'ok';
                window.STATE.papers.unshift(res.paper);
                if (window.saveCache) window.saveCache();
                closeModal('pm-upload-modal');
                alert('文献《' + res.paper.titleCN + '》上传入库成功！已加入「' + cat + '」与「用户贡献文库」。');
                // 清空表单
                $('pm-up-title-cn').value = '';
                $('pm-up-title-en').value = '';
                $('pm-up-abstract').value = '';
                fileInput.value = '';
                mountCategoryStrip();
                applyFiltersAndRender();
              } else {
                alert('上传失败: ' + (res.error || '服务器异常'));
              }
            }).catch(function (err) {
              upSubmit.disabled = false;
              alert('请求失败: ' + err.message);
            });
        };

        if (fileInput.files && fileInput.files[0]) {
          var f = fileInput.files[0];
          var reader = new FileReader();
          reader.onload = function (e) {
            var b64 = e.target.result.split(',')[1];
            doSend(b64, f.name);
          };
          reader.readAsDataURL(f);
        } else {
          doSend(null, null);
        }
      };
    }

    // 8.2 全球学术检索模态交互
    var gsClose = $('pm-global-close');
    var gsBtn = $('pm-gs-btn');
    var gsQuery = $('pm-gs-query');
    if (gsClose) gsClose.onclick = function () { closeModal('pm-global-modal'); };

    function doGlobalSearch() {
      var q = (gsQuery.value || '').trim();
      var source = $('pm-gs-source').value;
      if (!q) {
        alert('请输入学术关键词');
        return;
      }
      var statusEl = $('pm-gs-status');
      var resultsEl = $('pm-gs-results');
      statusEl.textContent = '正在通过国际学术 API 并发检索 ' + (source === 'all' ? 'arXiv 与 Crossref' : source) + '…';
      resultsEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--dim);">正在检索全球国际文献数据库…</div>';

      fetch('/api/papers/search_global?q=' + encodeURIComponent(q) + '&source=' + encodeURIComponent(source) + '&limit=12')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data || !data.ok || !data.papers || !data.papers.length) {
            statusEl.textContent = '检索完成，未找到相关全球学术文献。';
            resultsEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--dim);">未找到相关文献，请尝试更换关键词。</div>';
            return;
          }
          statusEl.textContent = '检索成功！找到 ' + data.papers.length + ' 篇国际文献（' + (data.query_en ? '英文扩展: ' + data.query_en : '') + '）';
          resultsEl.innerHTML = '';

          data.papers.forEach(function (item) {
            var card = document.createElement('div');
            card.className = 'pm-res-card';
            var authorsStr = (item.authors || []).join(', ');
            var absStr = item.abstract || item.abstractEN || '（暂无详细摘要）';

            card.innerHTML =
              '<div class="pm-res-title">' + (item.titleCN || item.titleEN) + '</div>' +
              '<div class="pm-res-meta">' +
                '<span class="badge">' + item.source + '</span>' +
                '<span class="badge" style="background:rgba(16,185,129,0.12);color:#10b981;">' + (item.category || '学术精选') + '</span>' +
                '<span>' + (item.journal || '国际期刊') + '</span>' +
                '<span>' + (item.year || '') + '</span>' +
                (authorsStr ? '<span>' + authorsStr + '</span>' : '') +
              '</div>' +
              '<div class="pm-res-abs">' + absStr + '</div>' +
              '<div class="pm-res-acts">' +
                '<button type="button" class="pm-btn primary pm-imp-btn" style="padding:4px 10px;font-size:12px;">' +
                  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>一键入库' +
                '</button>' +
                '<button type="button" class="pm-btn pm-trans-btn" style="padding:4px 10px;font-size:12px;border-color:rgba(201,168,106,0.4);color:#c9a86a;">' +
                  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>即刻双语翻译' +
                '</button>' +
                (item.doi ? '<a class="pm-btn ghost" href="https://doi.org/' + encodeURIComponent(item.doi) + '" target="_blank" rel="noopener" style="padding:4px 10px;font-size:12px;">DOI直连</a>' : '') +
              '</div>';

            // 一键入库
            card.querySelector('.pm-imp-btn').onclick = function () {
              var btn = this;
              btn.disabled = true;
              btn.textContent = '正在入库…';
              fetch('/api/papers/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  titleCN: item.titleCN || item.titleEN,
                  titleEN: item.titleEN,
                  authors: item.authors,
                  journal: item.journal,
                  year: item.year,
                  category: item.category,
                  doi: item.doi,
                  abstract: item.abstract,
                  abstractEN: item.abstractEN
                })
              }).then(function (r) { return r.json(); })
                .then(function (res) {
                  if (res && res.ok && res.paper) {
                    btn.textContent = '已入库';
                    btn.style.background = '#10b981';
                    btn.style.color = '#fff';
                    window.STATE.papers.unshift(res.paper);
                    if (window.saveCache) window.saveCache();
                    mountCategoryStrip();
                    applyFiltersAndRender();
                  } else {
                    btn.disabled = false;
                    btn.textContent = '入库失败';
                  }
                });
            };

            // 即刻翻译研读
            card.querySelector('.pm-trans-btn').onclick = function () {
              closeModal('pm-global-modal');
              if (window.openXlateStudioWithPaper) {
                window.openXlateStudioWithPaper(item);
              }
            };

            resultsEl.appendChild(card);
          });
        }).catch(function (err) {
          statusEl.textContent = '检索异常: ' + err.message;
        });
    }

    if (gsBtn) gsBtn.onclick = doGlobalSearch;
    if (gsQuery) {
      gsQuery.onkeydown = function (e) {
        if (e.key === 'Enter') doGlobalSearch();
      };
    }

    // 8.3 管理员登录与退出
    var admClose = $('pm-admin-close');
    var admCancel = $('pm-admin-cancel');
    var admSubmit = $('pm-admin-submit');
    var admLogout = $('pm-admin-logout');
    var admNewPaper = $('pm-admin-new-paper');

    if (admClose) admClose.onclick = function () { closeModal('pm-admin-modal'); };
    if (admCancel) admCancel.onclick = function () { closeModal('pm-admin-modal'); };

    if (admSubmit) {
      admSubmit.onclick = function () {
        var pwd = ($('pm-admin-pass').value || '').trim();
        var errEl = $('pm-admin-err');
        if (!pwd) {
          errEl.style.display = 'block';
          errEl.textContent = '请输入管理员密码';
          return;
        }
        fetch('/api/admin/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pwd })
        }).then(function (r) { return r.json(); })
          .then(function (data) {
            if (data && data.ok && data.token) {
              adminToken = data.token;
              sessionStorage.setItem('pm_admin_token', adminToken);
              errEl.style.display = 'none';
              openAdminModal();
              var topBtn = $('pm-top-admin-btn');
              if (topBtn) {
                topBtn.classList.add('admin-on');
                topBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg><span>管理已激活</span>';
              }
              enhanceCardsUI();
              alert('管理员身份已成功激活！您可以对现有文献执行删除与管理操作。');
            } else {
              errEl.style.display = 'block';
              errEl.textContent = data.error || '密码错误';
            }
          }).catch(function (e) {
            errEl.style.display = 'block';
            errEl.textContent = '网络错误: ' + e.message;
          });
      };
    }

    if (admLogout) {
      admLogout.onclick = function () {
        adminToken = '';
        sessionStorage.removeItem('pm_admin_token');
        var topBtn = $('pm-top-admin-btn');
        if (topBtn) {
          topBtn.classList.remove('admin-on');
          topBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><span>管理员</span>';
        }
        closeModal('pm-admin-modal');
        document.querySelectorAll('.pm-act-del').forEach(function (b) { b.remove(); });
        alert('已安全退出管理员模式。');
      };
    }

    if (admNewPaper) {
      admNewPaper.onclick = function () {
        closeModal('pm-admin-modal');
        openModal('pm-upload-modal');
      };
    }
  }

  function openAdminModal() {
    openModal('pm-admin-modal');
    if (adminToken) {
      $('pm-admin-login-body').style.display = 'none';
      $('pm-admin-login-foot').style.display = 'none';
      $('pm-admin-panel-body').style.display = 'block';
    } else {
      $('pm-admin-login-body').style.display = 'block';
      $('pm-admin-login-foot').style.display = 'flex';
      $('pm-admin-panel-body').style.display = 'none';
      $('pm-admin-pass').value = '';
    }
  }

  // 9. 管理员删除文献
  function deletePaper(p) {
    if (!adminToken) {
      alert('请先登录管理员！');
      openAdminModal();
      return;
    }
    var title = p.titleCN || p.titleEN || p.fileName || '该文献';
    if (!confirm('【管理员确认】确认删除文献《' + title + '》吗？删除后将从本地库与服务端永久移除。')) return;

    fetch('/api/papers/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, token: adminToken })
    }).then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) {
          window.STATE.papers = window.STATE.papers.filter(function (x) {
            return String(x.id) !== String(p.id);
          });
          if (window.saveCache) window.saveCache();
          mountCategoryStrip();
          applyFiltersAndRender();
          alert('文献《' + title + '》已成功删除。');
        } else {
          alert('删除失败: ' + (res.error || '权限不足或发生错误'));
        }
      }).catch(function (err) {
        alert('删除请求失败: ' + err.message);
      });
  }

  // 10. 与服务端同步已删除名单与用户上传文献
  function syncServerPapers() {
    fetch('/api/papers/list')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok) return;

        var deletedSet = new Set((data.deleted_ids || []).map(String));

        // 过滤已被删除的文献
        if (window.STATE && Array.isArray(window.STATE.papers)) {
          window.STATE.papers = window.STATE.papers.filter(function (p) {
            return !deletedSet.has(String(p.id));
          });

          // 补充服务端新增的用户文献
          var localIds = new Set(window.STATE.papers.map(function (p) { return String(p.id); }));
          (data.user_papers || []).forEach(function (up) {
            if (!localIds.has(String(up.id)) && !deletedSet.has(String(up.id))) {
              up.status = 'ok';
              window.STATE.papers.unshift(up);
            }
          });

          // 重新打上分类
          window.STATE.papers.forEach(function (p) {
            if (!p.category) p.category = classifyPaper(p);
          });

          mountCategoryStrip();
          applyFiltersAndRender();
        }
      }).catch(function () {});
  }

  // 11. 初始化与挂载
  function init() {
    hookSearchAndFilters();
    bindModals();
    mountCategoryStrip();
    syncServerPapers();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 50);
  }

})();
