// スタッフポータル LIFF ページ（認証確認版）
// - LIFF 初期化後に IDトークンを取得し、本文（POST）で GAS へ送る。URL にトークン・UID・エリアを載せない。
// - 本人・所属エリアはサーバーが決める。このページはサーバーの結果を表示するだけ。
(function () {
  'use strict';
  var C = window.SP_CONFIG || {};
  var PAGES = { events: '催事情報', recruit: '募集シフト', notices: 'お知らせ' };
  var RETRY_KEY = 'sp_relogin';

  function $(id) { return document.getElementById(id); }
  function show(lines, ng) {
    var v = $('view');
    v.textContent = '';
    lines.forEach(function (t, i) {
      var p = document.createElement('p');
      p.textContent = t;
      if (ng && i === 0) p.className = 'ng';
      if (i > 0 && !ng) p.className = 'muted';
      v.appendChild(p);
    });
  }
  function pageOf() {
    var p = new URLSearchParams(location.search).get('p');
    return Object.prototype.hasOwnProperty.call(PAGES, p) ? p : 'events';
  }

  function drawNav(page) {
    var nav = $('nav');
    nav.hidden = false;
    Array.prototype.forEach.call(nav.querySelectorAll('a'), function (a) {
      a.className = a.getAttribute('data-p') === page ? 'on' : '';
      a.onclick = function () {   // ページ切替（エリア等は付けない・再認証で表示し直す）
        var u = new URL(location.href);
        u.search = '?p=' + a.getAttribute('data-p');
        location.replace(u.toString());
      };
    });
  }

  function start() {
    if (!C.LIFF_ID || !C.API_URL) { show(['設定が完了していません（LIFF ID・API URL）。'], true); return; }
    liff.init({ liffId: C.LIFF_ID }).then(function () {
      if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }   // 外部ブラウザで開いた場合
      var page = pageOf();
      var idToken = liff.getIDToken();
      if (!idToken) { show(['LINEの認証情報を取得できませんでした。', 'LINEのメニューから開き直してください。'], true); return; }
      return fetch(C.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // 単純リクエスト（事前確認なし）
        body: JSON.stringify({ op: 'auth', idToken: idToken }),
        credentials: 'omit',
        cache: 'no-store'
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.ok) {
          sessionStorage.removeItem(RETRY_KEY);
          $('area').textContent = '所属エリア：' + d.me.area.name;
          drawNav(page);
          show(['認証できました（' + PAGES[page] + '）',
            '氏名：' + d.me.name + (d.me.retired ? '（退職）' : ''),
            '所属エリア：' + d.me.area.name,
            'このページの内容は準備中です。']);
          return;
        }
        if (d && d.code === 'token_expired' && !sessionStorage.getItem(RETRY_KEY)) {   // 1回だけ取り直す
          sessionStorage.setItem(RETRY_KEY, '1');
          liff.logout();
          liff.login({ redirectUri: location.href });
          return;
        }
        show([(d && d.message) || '表示できませんでした。', d && d.code ? '（' + d.code + '）' : ''], true);
      });
    }).catch(function (e) {
      show(['表示できませんでした。LINEのメニューから開き直してください。', '（' + String(e && e.message || e).slice(0, 80) + '）'], true);
    });
  }
  start();
})();
