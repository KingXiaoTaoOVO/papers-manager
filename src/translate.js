/* ===== PDF 双语翻译入口：全屏内嵌 pdf2zh WebUI（/translate/）===== */
(function () {
  'use strict';
  var URL_DEFAULT = '/translate/';
  var url = URL_DEFAULT;
  var loaded = false;

  var T = {
    zh: { chip: 'PDF 双语翻译', sub: 'Bing 免费·排版 1:1', title: 'PDF 双语翻译 · pdf2zh',
          note: '拖入 PDF → 点 Translate；首次加载较慢（服务启动中）',
          open: '新标签页打开', reload: '重新加载', close: '关闭', loading: '正在加载翻译服务…' },
    en: { chip: 'PDF Translator', sub: 'Bing · layout 1:1', title: 'PDF Bilingual Translator · pdf2zh',
          note: 'Drop a PDF → hit Translate. First load can be slow while the service boots.',
          open: 'Open in new tab', reload: 'Reload', close: 'Close', loading: 'Loading translator…' }
  };
  function lang() { return (document.documentElement.lang || 'zh').indexOf('en') === 0 ? 'en' : 'zh'; }
  function t(k) { return (T[lang()] || T.zh)[k]; }
  function $(id) { return document.getElementById(id); }

  function paint() {
    $('pm-tr-chip-txt').textContent = t('chip');
    $('pm-tr-chip-sub').textContent = t('sub');
    $('pm-tr-title').innerHTML = '<b>' + t('title') + '</b>';
    $('pm-tr-note').textContent = t('note');
    $('pm-tr-open').textContent = t('open');
    $('pm-tr-reload').textContent = t('reload');
    $('pm-tr-close').textContent = t('close');
    $('pm-tr-loading').textContent = t('loading');
  }

  function openModal() {
    var m = $('pm-tr-modal');
    m.classList.add('show');
    if (!loaded) {
      loaded = true;
      $('pm-tr-frame').src = url;
      setTimeout(function () { m.classList.add('ready'); }, 1200);
    }
  }
  function closeModal() { $('pm-tr-modal').classList.remove('show'); }
  function reloadFrame() {
    $('pm-tr-modal').classList.remove('ready');
    $('pm-tr-frame').src = url + (url.indexOf('?') < 0 ? '?' : '&') + '_=' + Date.now();
    setTimeout(function () { $('pm-tr-modal').classList.add('ready'); }, 1200);
  }

  function boot() {
    paint();
    fetch('version.json?_=' + Date.now())
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (c) {
        if (c && c.translateUrl) { url = c.translateUrl; }
        if (c && c.translateLabel) { T.zh.chip = c.translateLabel; T.en.chip = c.translateLabel; }
        paint();
      })
      .catch(function () {});
    $('pm-tr-chip').addEventListener('click', openModal);
    $('pm-tr-close').addEventListener('click', closeModal);
    $('pm-tr-reload').addEventListener('click', reloadFrame);
    $('pm-tr-open').addEventListener('click', function () {
      window.open(url, '_blank', 'noopener');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal();
    });
    new MutationObserver(paint).observe(document.documentElement,
      { attributes: true, attributeFilter: ['lang'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
