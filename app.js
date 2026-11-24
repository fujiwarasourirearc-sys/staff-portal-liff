// スタッフポータル LIFF ページ
// - LIFF 初期化後に IDトークンを取得し、本文（POST）で GAS へ送る。URL にトークン・UID・エリアを載せない。
// - 本人・表示エリア・表示してよいデータはサーバーが決める。このページは受け取った結果を表示するだけ（文字は textContent で入れる）。
(function () {
  'use strict';
  var C = window.SP_CONFIG || {};
  var PAGES = { events: '催事情報', recruit: '募集シフト', notices: 'お知らせ' };
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  var RETRY_KEY = 'sp_relogin';
  var S = { idToken: '', me: null, page: 'events', area: '', month: '', resp: null, seq: 0,
    evTab: 'events', evMonth: '', evState: '', rcView: 'store', open: {} };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(p) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) p.appendChild(arguments[i]); return p; }
  function view() { var v = $('view'); v.textContent = ''; return v; }
  function msg(text, ng, sub) { var v = view(), c = el('div', 'card'); add(c, el('p', ng ? 'ng' : '', text)); if (sub) add(c, el('p', 'muted', sub)); add(v, c); }
  function pageOf() { var p = new URLSearchParams(location.search).get('p'); return Object.prototype.hasOwnProperty.call(PAGES, p) ? p : 'events'; }

  function ymdText(s) {   // 'YYYY-MM-DD' → 'M/D(曜)'
    var p = s.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return p[1] + '/' + p[2] + '(' + WD[d.getUTCDay()] + ')';
  }
  function dayText(month, d) { var p = month.split('-'); return ymdText(p[0] + '-' + p[1] + '-' + ('0' + d).slice(-2)); }
  function monthText(m) { return m ? Number(m.slice(0, 4)) + '年' + Number(m.slice(5, 7)) + '月' : ''; }

  /* ---------- 通信 ---------- */
  function api(page, cb) {
    var seq = ++S.seq;
    fetch(C.API_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // 単純リクエスト（事前確認なし）
      body: JSON.stringify({ op: 'page', idToken: S.idToken, page: page, area: S.area, month: S.month }),
      credentials: 'omit', cache: 'no-store'
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (seq !== S.seq) return;   // 古い応答は捨てる
      if (d && d.ok) { sessionStorage.removeItem(RETRY_KEY); cb(d); return; }
      if (d && d.code === 'token_expired' && !sessionStorage.getItem(RETRY_KEY)) {   // 1回だけ取り直す
        sessionStorage.setItem(RETRY_KEY, '1'); liff.logout(); liff.login({ redirectUri: location.href }); return;
      }
      $('nav').hidden = true; $('area').textContent = '';
      msg((d && d.message) || '表示できませんでした。', true, d && d.code ? '（' + d.code + '）' : '');
    }).catch(function () { if (seq === S.seq) msg('通信できませんでした。電波の良い場所で開き直してください。', true); });
  }

  function load() {
    msg('読み込み中…');
    api(S.page, function (d) {
      S.me = d.me; S.resp = d; S.area = d.area.id;
      if (d.page === 'recruit' && d.data && d.data.month) S.month = d.data.month;
      drawHeader(); drawNav(); render();
    });
  }

  /* ---------- ヘッダー・ページ切替 ---------- */
  function drawHeader() {
    var a = $('area'); a.textContent = '';
    if (S.me.role === 'hq' && S.me.areas.length > 1) {   // 本部だけ（許可エリアの中から。最終判定はサーバー）
      var sel = el('select');
      S.me.areas.forEach(function (x) { var o = el('option', '', x.name); o.value = x.id; if (x.id === S.area) o.selected = true; sel.appendChild(o); });
      sel.onchange = function () { S.area = sel.value; S.month = ''; S.evMonth = ''; load(); };
      add(a, el('span', '', '表示エリア '), sel);
    } else {
      a.textContent = '所属エリア：' + S.resp.area.name;
    }
  }
  function drawNav() {
    var nav = $('nav'); nav.hidden = false;
    Array.prototype.forEach.call(nav.querySelectorAll('a'), function (x) {
      var p = x.getAttribute('data-p');
      x.className = p === S.page ? 'on' : '';
      x.onclick = function () {
        if (p === S.page) return;
        S.page = p; S.month = '';
        try { history.replaceState(null, '', location.pathname + '?p=' + p); } catch (e) { /* 表示には影響しない */ }
        drawNav(); load();
      };
    });
  }

  function render() {
    var d = S.resp.data || {};
    if (d.closed) return msg(d.message || '準備中です。');
    if (d.error) return msg(d.message, true);
    if (S.page === 'events') return renderEvents(d);
    if (S.page === 'recruit') return renderRecruit(d);
    return renderNotices(d);
  }

  /* ---------- 催事情報・常設店舗 ---------- */
  function monthsOf(items) {
    var set = {};
    items.forEach(function (x) {
      var m = x.start.slice(0, 7), e = x.end.slice(0, 7), n = 0;
      while (m <= e && n++ < 24) { set[m] = true; var y = +m.slice(0, 4), mm = +m.slice(5, 7) + 1; if (mm > 12) { y++; mm = 1; } m = y + '-' + ('0' + mm).slice(-2); }
    });
    return Object.keys(set).sort().slice(0, 13);
  }
  function renderEvents(d) {
    var v = view(), list = S.evTab === 'events' ? d.events : d.jousetsu;
    var tabs = el('div', 'tabs');
    [['events', '催事・長期催事', d.events.length], ['jousetsu', '常設店舗', d.jousetsu.length]].forEach(function (t) {
      var b = el('button', S.evTab === t[0] ? 'on' : '', t[1] + '（' + t[2] + '）');
      b.onclick = function () { S.evTab = t[0]; render(); };
      tabs.appendChild(b);
    });
    add(v, tabs);
    var f = el('div', 'filters'), ms = el('select'), ss = el('select');
    var o0 = el('option', '', 'すべての月'); o0.value = ''; ms.appendChild(o0);
    monthsOf(list).forEach(function (m) { var o = el('option', '', monthText(m)); o.value = m; if (m === S.evMonth) o.selected = true; ms.appendChild(o); });
    [['', '開催中・開催予定'], ['開催中', '開催中'], ['開催予定', '開催予定']].forEach(function (x) { var o = el('option', '', x[1]); o.value = x[0]; if (x[0] === S.evState) o.selected = true; ss.appendChild(o); });
    ms.onchange = function () { S.evMonth = ms.value; render(); };
    ss.onchange = function () { S.evState = ss.value; render(); };
    add(f, ms, ss); add(v, f);
    var shown = list.filter(function (x) {
      if (S.evState && x.state !== S.evState) return false;
      if (S.evMonth && !(x.start.slice(0, 7) <= S.evMonth && S.evMonth <= x.end.slice(0, 7))) return false;
      return true;
    });
    if (!shown.length) return add(v, add(el('div', 'card'), el('p', 'muted', '該当する情報はありません。')));
    shown.forEach(function (x) {
      var c = el('div', 'card');
      add(c, el('div', 't', x.brand), el('div', 's', x.store), el('div', 's muted', ymdText(x.start) + ' 〜 ' + ymdText(x.end)));
      var b = el('div', 'badges');
      add(b, el('span', 'b' + (x.state === '開催中' ? ' live' : ''), x.state), el('span', 'b', x.kind || (S.evTab === 'events' ? '催事' : '常設')),
        el('span', 'b', S.resp.area.name), x.recruit ? el('span', 'b rec', x.recruit) : null);
      add(c, b); add(v, c);
    });
  }

  /* ---------- 募集シフト ---------- */
  function applyBtn(url) {
    var b = el('button', 'apply', '応募する');
    b.onclick = function () {
      if (!url) return;
      if (!window.confirm('シフナビを開きます。\nシフナビでログイン後、「募集中のシフトに応募する」から店舗・日付を選んで応募してください。')) return;
      liff.openWindow({ url: url, external: false });
    };
    return b;
  }
  function slotRow(text, sub, url) {
    var r = el('div', 'slot'), w = el('div', 'w');
    add(w, el('div', '', text), sub ? el('div', 'muted', sub) : null);
    return add(r, w, applyBtn(url));
  }
  function renderRecruit(d) {
    var v = view();
    if (d.months && d.months.length > 1) {
      var ch = el('div', 'chips');
      d.months.forEach(function (m) { var b = el('button', m === d.month ? 'on' : '', monthText(m)); b.onclick = function () { S.month = m; load(); }; ch.appendChild(b); });
      add(v, ch);
    }
    var tabs = el('div', 'tabs');
    [['store', '店舗別'], ['date', '日付別']].forEach(function (t) {
      var b = el('button', S.rcView === t[0] ? 'on' : '', t[1]); b.onclick = function () { S.rcView = t[0]; render(); }; tabs.appendChild(b);
    });
    add(v, tabs);
    add(v, el('div', 'note', '応募はシフナビで行います（' + monthText(d.month) + '）。店舗・日付・区分の自動選択は準備中のため、シフナビで選び直してください。'));
    if (d.partial) add(v, el('p', 'muted', '一部の店舗の情報を読み込めませんでした。'));
    if (!d.items || !d.items.length) return add(v, add(el('div', 'card'), el('p', 'muted', '現在募集中のシフトはありません。')));
    var tm = function (s) { return [s.label, s.time].filter(Boolean).join('　'); };
    if (S.rcView === 'store') {
      d.items.forEach(function (it) {
        var c = el('div', 'card');
        add(c, el('div', 't', it.brand), el('div', 's', it.store), it.kind ? add(el('div', 'badges'), el('span', 'b', it.kind)) : null);
        it.reds.forEach(function (s) { add(c, slotRow(dayText(d.month, s.d) + '　' + s.label, s.time, d.applyUrl)); });
        add(v, c);
      });
      return;
    }
    var byDay = {};
    d.items.forEach(function (it) { it.reds.forEach(function (s) { (byDay[s.d] = byDay[s.d] || []).push({ it: it, s: s }); }); });
    Object.keys(byDay).map(Number).sort(function (a, b) { return a - b; }).forEach(function (day) {
      add(v, el('div', 'day', dayText(d.month, day)));
      var c = el('div', 'card');
      byDay[day].forEach(function (x) { add(c, slotRow(x.it.brand + '　' + x.it.store, tm(x.s), d.applyUrl)); });
      add(v, c);
    });
  }

  /* ---------- お知らせ ---------- */
  function renderNotices(d) {
    var v = view();
    if (!d.items || !d.items.length) return add(v, add(el('div', 'card'), el('p', 'muted', '現在、お知らせはありません。')));
    d.items.forEach(function (n) {
      var c = el('div', 'card'), b = el('div', 'badges');
      add(b, n.important ? el('span', 'b imp', '重要') : null, n.cat ? el('span', 'b', n.cat) : null, el('span', 'b', n.area), n.date ? el('span', 'muted', n.date) : null);
      add(c, el('div', 't', n.title), b);
      if (S.open[n.id]) {
        add(c, el('div', 'body', n.body));
        if (n.link) { var a = el('a', 'link', '添付リンクを開く'); a.href = '#'; a.onclick = function (e) { e.preventDefault(); liff.openWindow({ url: n.link, external: true }); }; add(c, a); }
      } else add(c, el('div', 'muted', '▼ タップして本文を表示'));
      c.onclick = function (e) { if (e.target.tagName === 'A') return; S.open[n.id] = !S.open[n.id]; render(); };
      add(v, c);
    });
  }

  /* ---------- 起動 ---------- */
  function start() {
    if (!C.LIFF_ID || !C.API_URL) { msg('設定が完了していません（LIFF ID・API URL）。', true); return; }
    liff.init({ liffId: C.LIFF_ID }).then(function () {
      if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }   // 外部ブラウザで開いた場合
      S.page = pageOf();
      S.idToken = liff.getIDToken();
      if (!S.idToken) { msg('LINEの認証情報を取得できませんでした。', true, 'LINEのメニューから開き直してください。'); return; }
      load();
    }).catch(function (e) {
      msg('表示できませんでした。LINEのメニューから開き直してください。', true, '（' + String(e && e.message || e).slice(0, 80) + '）');
    });
  }
  start();
})();
