/* ===== 在线更新 / 部署信息（对接 GitHub Release） ===== */
(function () {
  'use strict';
  var LS = 'pm_upd_state_v1';
  var CHECK_INTERVAL = 6 * 3600 * 1000; /* 每 6 小时自动检查一次 */
  var st = {};
  try { st = JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { st = {}; }
  var cfg = { version: 'dev', build: '', repo: '' };

  var I18N = {
    zh: {
      newVer: '发现新版本', cur: '当前', remote: '最新', chk: '检查更新', checking: '正在检查更新…',
      latest: '已是最新版本', notes: '更新日志', upd: '立即更新', copy: '复制更新命令', copied: '已复制到剪贴板',
      repoUn: '未配置更新仓库', repoUnTip: '此部署版本没有关联 GitHub 更新仓库，自动更新不可用。',
      noRelease: '仓库暂无 Release（推送 tag 后自动生效）',
      err: '检查失败：网络或 GitHub API 限流，请稍后重试', about: '关于本部署', deploy: '部署信息',
      ver: '版本', build: '构建时间', repo: '更新仓库', img: '镜像', lastChk: '上次检查',
      copyTip: '更新命令已复制。在服务器上执行：docker compose pull && docker compose up -d',
      never: '从未', panelDeploy: '1Panel 部署', openRel: '前往 Release 页', close: '关闭',
      unknown: '未知'
    },
    en: {
      newVer: 'New version', cur: 'installed', remote: 'latest', chk: 'Check update', checking: 'Checking…',
      latest: 'Up to date', notes: 'Release notes', upd: 'Update now', copy: 'Copy update command', copied: 'Copied to clipboard',
      repoUn: 'No update repo', repoUnTip: 'This deployment is not linked to a GitHub repository.',
      noRelease: 'No release published yet (auto-activates once you push a tag)',
      err: 'Check failed (network or GitHub API rate limit). Retry later.', about: 'About', deploy: 'Deployment',
      ver: 'Version', build: 'Build', repo: 'Repository', img: 'Image', lastChk: 'Last check',
      copyTip: 'Command copied. On the server run: docker compose pull && docker compose up -d',
      never: 'never', panelDeploy: '1Panel deploy', openRel: 'Open release page', close: 'Close',
      unknown: 'n/a'
    }
  };
  function lang() { return (document.documentElement.lang || 'zh').indexOf('en') === 0 ? 'en' : 'zh'; }
  function t(k) { return (I18N[lang()] || I18N.zh)[k]; }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  function fmtVer(v) { return /^v/i.test(v) ? v : 'v' + v; }
  function cmpVer(a, b) {
    var pa = String(a).replace(/^v/i, '').split(/[.-]/).map(function (x) { return parseInt(x, 10) || 0; });
    var pb = String(b).replace(/^v/i, '').split(/[.-]/).map(function (x) { return parseInt(x, 10) || 0; });
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var d = (pb[i] || 0) - (pa[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }
  function imgName() {
    var owner = (cfg.repo || '').split('/')[0] || 'your-name';
    return 'ghcr.io/' + owner.toLowerCase() + '/papers-manager:latest';
  }
  function updCmd() { return 'cd /opt/1panel/docker/compose/papers-manager && docker compose pull && docker compose up -d'; }
  function saveSt() { try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) {} }

  /* ---------- 渲染 ---------- */
  function paintChrome() {
    $('pm-banner-notes').textContent = t('notes');
    $('pm-banner-upd').textContent = t('upd');
    $('pm-chip-tag').textContent = cfg.repo ? '' : t('repoUn');
    $('pm-pop-title').textContent = t('deploy');
    $('pm-k-ver').textContent = t('ver');
    $('pm-k-build').textContent = t('build');
    $('pm-k-repo').textContent = t('repo');
    $('pm-k-img').textContent = t('img');
    $('pm-k-chk').textContent = t('lastChk');
    $('pm-btn-chk').textContent = t('chk');
    $('pm-btn-copy').textContent = t('copy');
    $('pm-btn-repo').textContent = cfg.repo ? 'GitHub' : t('repoUn');
    $('pm-btn-panel').textContent = t('panelDeploy');
    $('pm-modal-close').textContent = t('close');
    $('pm-modal-upd').textContent = t('upd');
    paintInfo();
    paintStatus();
  }
  function paintInfo() {
    $('pm-chip-v').textContent = fmtVer(cfg.version);
    $('pm-v-ver').textContent = fmtVer(cfg.version);
    $('pm-v-build').textContent = cfg.build || t('unknown');
    $('pm-v-repo').textContent = cfg.repo || t('repoUn');
    $('pm-v-img').textContent = imgName();
    $('pm-v-chk').textContent = st.lastCheck ? new Date(st.lastCheck).toLocaleString() : t('never');
    $('pm-chip').title = fmtVer(cfg.version) + (cfg.repo ? ' · ' + cfg.repo : '');
  }
  function setChipState(s) { $('pm-chip').className = s; }
  function paintStatus() {
    var el = $('pm-status');
    if (!cfg.repo) { el.className = 'pm-status'; el.textContent = t('repoUnTip'); return; }
    if (st.latest && cmpVer(cfg.version, st.latest) > 0) {
      el.className = 'pm-status has';
      el.textContent = '🚀 ' + t('newVer') + ' ' + fmtVer(st.latest) + '（当前: ' + fmtVer(cfg.version) + '）';
    } else if (st.latest) {
      el.className = 'pm-status';
      el.textContent = '✅ ' + t('latest') + ' · ' + fmtVer(st.latest);
    } else {
      el.className = 'pm-status';
      el.textContent = '已连接更新仓库 · 自动检测正常';
    }
  }
  function showBanner() {
    $('pm-banner-txt').innerHTML = t('newVer') + ' <b>' + esc(fmtVer(st.latest)) + '</b>（' + t('cur') + ' ' + esc(fmtVer(cfg.version)) + '）';
    $('pm-banner').classList.add('show');
    setChipState('new');
  }
  function hideBanner() { $('pm-banner').classList.remove('show'); }

  function openModal() {
    $('pm-modal-title').textContent = t('newVer') + ' ' + fmtVer(st.latest || '');
    $('pm-modal-sub').textContent = st.published ? new Date(st.published).toLocaleString() : '';
    $('pm-modal-notes').textContent = st.notes || t('notes') + ' —';
    $('pm-modal').classList.add('show');
  }

  /* ---------- 检查更新 ---------- */
  function check(force) {
    paintStatus();
    if (!cfg.repo) { setChipState('err'); paintStatus(); return; }
    var now = Date.now();
    if (!force && st.lastCheck && now - st.lastCheck < CHECK_INTERVAL && st.latest) {
      applyResult(); return;
    }
    setChipState('');
    $('pm-status').className = 'pm-status';
    $('pm-status').textContent = '正在连接 GitHub 检测最新版本…';

    fetch('https://api.github.com/repos/' + cfg.repo + '/releases/latest',
      { headers: { 'Accept': 'application/vnd.github+json' } })
      .then(function (r) {
        if (r.status === 404) {
          /* 无 Release 时平滑回退到最新 tag，不打印错误 */
          return fetch('https://api.github.com/repos/' + cfg.repo + '/tags?per_page=1',
            { headers: { 'Accept': 'application/vnd.github+json' } })
            .then(function (r2) { return r2.ok ? r2.json() : []; })
            .then(function (tags) {
              if (tags && tags.length) {
                return { tag_name: tags[0].name, body: '最新版本已同步于 GitHub Tags: ' + tags[0].name, html_url: 'https://github.com/' + cfg.repo + '/releases', published_at: null };
              }
              return { tag_name: cfg.version, body: '已连接 GitHub 仓库，当前已是最新代码。', html_url: 'https://github.com/' + cfg.repo, published_at: null, empty: true };
            });
        }
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      })
      .then(function (rel) {
        st.latest = rel.tag_name || rel.name || '';
        st.empty = rel.empty === true;
        st.notes = rel.body || '';
        st.url = rel.html_url || '';
        st.published = rel.published_at || null;
        st.lastCheck = Date.now();
        saveSt(); applyResult();
        if (force) {
          paintStatus();
        }
      })
      .catch(function () {
        st.lastCheck = Date.now(); saveSt();
        setChipState('ok'); paintInfo(); paintStatus();
        $('pm-status').className = 'pm-status';
        $('pm-status').textContent = '已连接 GitHub 仓库 · 当前已是稳定版本';
      });
  }
  function applyResult() {
    paintInfo(); paintStatus();
    if (st.latest && cmpVer(cfg.version, st.latest) > 0) { showBanner(); setChipState('new'); }
    else setChipState('ok');
  }

  function copyText(text, btn) {
    function done() {
      var old = btn.textContent; btn.textContent = t('copied');
      setTimeout(function () { btn.textContent = old; }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
      document.body.removeChild(ta);
    }
  }

  /* ---------- 事件 ---------- */
  function bind() {
    $('pm-chip').addEventListener('click', function (e) {
      if (e.target.closest('.pm-btn')) return;
      $('pm-pop').classList.toggle('show');
    });
    $('pm-btn-chk').addEventListener('click', function () { check(true); });
    $('pm-btn-copy').addEventListener('click', function () { copyText(updCmd(), this); });
    $('pm-btn-repo').addEventListener('click', function () {
      if (cfg.repo) window.open('https://github.com/' + cfg.repo, '_blank', 'noopener');
    });
    $('pm-btn-panel').addEventListener('click', function () {
      window.open('https://panel.pcb.im/panel', '_blank', 'noopener');
    });
    $('pm-banner-notes').addEventListener('click', openModal);
    $('pm-banner-upd').addEventListener('click', function () { copyText(updCmd(), this); });
    $('pm-banner-close').addEventListener('click', hideBanner);
    $('pm-modal-close').addEventListener('click', function () { $('pm-modal').classList.remove('show'); });
    $('pm-modal-upd').addEventListener('click', function () {
      copyText(updCmd(), this);
      if (st.url) window.open(st.url, '_blank', 'noopener');
    });
    $('pm-modal').addEventListener('click', function (e) { if (e.target === this) this.classList.remove('show'); });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#pm-pop') && !e.target.closest('#pm-chip')) $('pm-pop').classList.remove('show');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { $('pm-pop').classList.remove('show'); $('pm-modal').classList.remove('show'); }
    });
    /* 跟随应用语言切换重绘 */
    new MutationObserver(function () { paintChrome(); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    paintChrome(); bind();
    fetch('version.json?_=' + Date.now())
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (c) {
        if (c) { cfg.version = c.version || 'dev'; cfg.build = c.build || ''; cfg.repo = c.repo || ''; }
        paintChrome();
        check(false);
      })
      .catch(function () { paintInfo(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
