// スタッフポータル LIFF ページ
// - LIFF 初期化後に IDトークンを取得し、本文（POST）で GAS へ送る。URL にトークン・UID・エリアを載せない。
// - 本人・表示エリア・表示してよいデータはサーバーが毎回決める。このページは受け取った結果を表示するだけ（文字は textContent で入れる）。
// - 取得済みデータは CACHE_MS だけ再利用（エリア・ページ・月ごとに別。サーバー側キャッシュ60秒と重なっても最大90秒程度）。
// - 古い通信結果は捨てる（表示中のページ・エリア・月の要求と一致したものだけ描画）。
(function () {
  'use strict';
  var C = window.SP_CONFIG || {};
  var PAGES = { events: '催事情報', recruit: '募集シフト', notices: 'お知らせ' };
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  var RETRY_KEY = 'sp_relogin', CACHE_MS = 30000;
  var CATS = [
    { k: 'saiji', name: '催事スタッフ募集', desc: '催事・長期催事の募集情報です。', f: function (it) { return !it.jous; } },
    { k: 'jousetsu', name: '常設スタッフ募集', desc: '常設スタッフ向けの募集情報です。催事専任スタッフは応募対象外です。', f: function (it) { return it.jous; } },
    { k: 'support', name: '催事スタッフ常設応援募集', desc: '催事スタッフも応募できる常設店舗の応援募集です。', f: function (it) { return it.support; } }
  ];
  var S = { idToken: '', me: null, page: 'events', area: '', areaName: '', month: '', want: '', cache: {}, pending: {},
    evTab: 'events', evMonth: '', evState: '', rcView: 'store', rcCat: 'saiji', openN: {}, openD: {} };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(p) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) p.appendChild(arguments[i]); return p; }
  function view() { var v = $('view'); v.textContent = ''; return v; }
  function msg(text, ng, sub, retry) {
    var v = view(), c = el('div', 'card');
    add(c, el('p', ng ? 'ng' : '', text)); if (sub) add(c, el('p', 'muted', sub));
    if (retry) { var b = el('button', 'sub', '再読み込み'); b.onclick = retry; add(c, b); }
    add(v, c);
  }
  function loading(text) { var v = view(), c = el('div', 'card loading'); add(c, el('span', 'spin'), el('span', '', text || '読み込み中…')); add(v, c); }
  function pageOf() { var p = new URLSearchParams(location.search).get('p'); return Object.prototype.hasOwnProperty.call(PAGES, p) ? p : 'events'; }

  function ymdText(s) {   // 'YYYY-MM-DD' → 'M/D(曜)'
    var p = String(s).split('-').map(Number);
    if (p.length !== 3 || !p[0]) return String(s || '');
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return p[1] + '/' + p[2] + '(' + WD[d.getUTCDay()] + ')';
  }
  function dayText(month, d) { var p = month.split('-'); return ymdText(p[0] + '-' + p[1] + '-' + ('0' + d).slice(-2)); }
  function monthText(m) { return m ? Number(m.slice(0, 4)) + '年' + Number(m.slice(5, 7)) + '月' : ''; }

  /* ---------- 通信（キャッシュ・古い応答の破棄） ---------- */
  function keyOf(op, page, area, month) { return [op, page, area || '', page === 'recruit' ? (month || '') : ''].join('|'); }
  function fresh(k) { var x = S.cache[k]; return x && Date.now() - x.t < CACHE_MS ? x.d : null; }
  function post(op, page, k, done) {
    if (S.pending[k]) { S.pending[k].push(done); return; }   // 同じ要求を重ねない
    S.pending[k] = [done];
    var fin = function (d, ng) { var cbs = S.pending[k] || []; delete S.pending[k]; cbs.forEach(function (f) { f(d, ng); }); };
    fetch(C.API_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // 単純リクエスト（事前確認なし）
      body: JSON.stringify({ op: op, idToken: S.idToken, page: page, area: S.area, month: page === 'recruit' ? S.month : '' }),
      credentials: 'omit', cache: 'no-store'
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.ok) { sessionStorage.removeItem(RETRY_KEY); S.cache[k] = { d: d, t: Date.now() }; fin(d); return; }
      if (d && d.code === 'token_expired' && !sessionStorage.getItem(RETRY_KEY)) {   // 1回だけ取り直す
        sessionStorage.setItem(RETRY_KEY, '1'); liff.logout(); liff.login({ redirectUri: location.href }); return;
      }
      fin(d, true);
    }).catch(function () { fin(null, true); });
  }

  function load(page, force) {
    S.page = page;
    var k = keyOf('page', page, S.area, S.month);
    S.want = k;
    if (force) delete S.cache[k];
    var c = fresh(k);
    if (c) { apply(c); return; }
    loading(page === 'recruit' ? '募集情報を読み込み中…（数秒かかることがあります）' : '読み込み中…');
    post('page', page, k, function (d, ng) {
      if (S.want !== k) return;   // 別のページ・エリア・月へ移った後の応答は描画しない
      if (ng) {
        if (d && d.code) { $('nav').hidden = true; $('area').textContent = ''; return msg(d.message || '表示できませんでした。', true, '（' + d.code + '）'); }
        return msg('通信できませんでした。', true, '電波の良い場所で再読み込みしてください。', function () { load(page, true); });
      }
      var k2 = keyOf('page', page, d.area.id, page === 'recruit' && d.data && d.data.month ? d.data.month : S.month);
      if (k2 !== k && S.cache[k]) S.cache[k2] = S.cache[k];   // 既定のエリア・月で返ったときも、そのキーで再利用
      apply(d);
    });
  }

  function apply(d) {
    S.me = d.me; S.area = d.area.id; S.areaName = d.area.name;
    if (d.page === 'recruit' && d.data && d.data.month) S.month = d.data.month;
    S.cur = d;
    drawHeader(); drawNav(); render();
    if (d.page === 'events' && d.data && d.data.extra) loadExtra();
  }

  /** 催事情報の後追い（募集状況・シフト区分・注意事項）。一覧の表示は待たせない。 */
  function loadExtra(force) {
    var k = keyOf('evextra', 'events', S.area, '');
    if (force) delete S.cache[k];
    if (fresh(k)) return;
    S.extraErr = false;
    post('evextra', 'events', k, function (d, ng) {
      if (ng || !d || (d.data && d.data.error)) { if (d && d.data) delete S.cache[k]; S.extraErr = true; }
      if (S.page === 'events' && S.cur && S.cur.page === 'events' && S.area === (d && d.area ? d.area.id : S.area)) render();
    });
  }

  /* ---------- ヘッダー・ページ切替 ---------- */
  function drawHeader() {
    var a = $('area'); a.textContent = '';
    if (S.me.role === 'hq' && S.me.areas.length > 1) {   // 本部だけ（許可エリアの中から。最終判定はサーバー）
      var sel = el('select');
      S.me.areas.forEach(function (x) { var o = el('option', '', x.name); o.value = x.id; if (x.id === S.area) o.selected = true; sel.appendChild(o); });
      sel.onchange = function () { S.area = sel.value; S.month = ''; S.evMonth = ''; load(S.page); };
      add(a, el('span', '', '表示エリア '), sel);
    } else {
      a.textContent = '所属エリア：' + S.areaName;
    }
  }
  function drawNav() {
    var nav = $('nav'); nav.hidden = false;
    Array.prototype.forEach.call(nav.querySelectorAll('a'), function (x) {
      var p = x.getAttribute('data-p');
      x.className = p === S.page ? 'on' : '';
      x.onclick = function () {
        if (p === S.page && S.cur && S.cur.page === p) return;
        try { history.replaceState(null, '', location.pathname + '?p=' + p); } catch (e) { /* 表示には影響しない */ }
        load(p);
        drawNav();
      };
    });
  }

  function render() {
    var d = (S.cur && S.cur.data) || {};
    if (d.closed) return msg(d.message || '準備中です。');
    if (d.error) return msg(d.message || '情報を読み込めませんでした。', true, '', function () { load(S.page, true); });
    if (S.cur.page === 'events') return renderEvents(d);
    if (S.cur.page === 'recruit') return renderRecruit(d);
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
  /** シフナビの催事詳細（evDetail）と同じ項目・順。未入力は出さない。 */
  function detailBox(x, ex) {
    var d = (ex && ex.d) || x.d || {}, dl = el('dl', 'evd'), has = false;
    var row = function (k, v) { if (!v) return; has = true; add(dl, el('dt', '', k)); var dd = el('dd'); if (typeof v === 'string') dd.textContent = v; else add(dd, v); add(dl, dd); };
    var n = function (v, u) { return v === '' || v == null ? '' : v + (u || ''); };
    row('担当者', d.manager);
    if (d.carry) row('翌月繰越終了日', ymdText(d.carry));
    if (d.days || d.wdays || d.hdays) row('期間', [n(d.days, '日'), (d.wdays || d.hdays) ? '（平日 ' + (n(d.wdays, '日') || '-') + '・土日祝 ' + (n(d.hdays, '日') || '-') + '）' : ''].join(''));
    if (d.open || d.close) row('営業時間', (d.open || '-') + ' 〜 ' + (d.close || '-') + (d.hours ? '（' + d.hours + '）' : ''));
    if (ex && ex.shiftTimes && ex.shiftTimes.length) row('シフト区分・勤務時間', ex.shiftTimes.map(function (s) { return s.base + ' ' + (s.time || '時間未設定'); }).join('\n'));
    if (d.mgrW || d.mgrH) row('管理者', '平日 ' + (n(d.mgrW, '名') || '-') + '・土日祝 ' + (n(d.mgrH, '名') || '-'));
    if (d.stfW || d.stfH) row('スタッフ要員', '平日 ' + (n(d.stfW, '名') || '-') + '・土日祝 ' + (n(d.stfH, '名') || '-'));
    if (ex && ex.note) row('勤務時の注意事項', ex.note);
    return has ? dl : el('p', 'muted', '詳細情報はまだ登録されていません。');
  }
  function renderEvents(d) {
    var v = view(), list = S.evTab === 'events' ? d.events : d.jousetsu;
    var xk = keyOf('evextra', 'events', S.area, ''), X = fresh(xk), map = X && X.data && X.data.map || null;
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
    if (d.extra && !map) {
      if (S.extraErr) { var r = el('p', 'muted', '募集状況・シフト時間を取得できませんでした。'); var rb = el('button', 'sub', '再取得'); rb.onclick = function () { S.extraErr = false; render(); loadExtra(true); }; add(v, add(r, rb)); }
      else add(v, add(el('p', 'muted loading'), el('span', 'spin'), el('span', '', '募集状況・シフト時間を確認中…')));
    }
    var shown = list.filter(function (x) {
      if (S.evState && x.state !== S.evState) return false;
      if (S.evMonth && !(x.start.slice(0, 7) <= S.evMonth && S.evMonth <= x.end.slice(0, 7))) return false;
      return true;
    });
    if (!shown.length) return add(v, add(el('div', 'card'), el('p', 'muted', '該当する情報はありません。')));
    shown.forEach(function (x) {
      var ex = map ? map[x.id] : null, c = el('div', 'card');
      add(c, el('div', 't', x.brand), el('div', 's', x.store), el('div', 's muted', ymdText(x.start) + ' 〜 ' + ymdText(x.end)));
      var b = el('div', 'badges');
      add(b, el('span', 'b' + (x.state === '開催中' ? ' live' : ''), x.state), el('span', 'b', x.kind || (S.evTab === 'events' ? '催事' : '常設')),
        el('span', 'b', S.areaName), ex && ex.recruit ? el('span', 'b rec', ex.recruit) : null);
      add(c, b);
      var tg = el('button', 'more', S.openD[x.id] ? '詳細を閉じる ▲' : '詳細を見る ▼');
      tg.onclick = function () { S.openD[x.id] = !S.openD[x.id]; render(); };
      add(c, tg);
      if (S.openD[x.id]) add(c, detailBox(x, ex));
      add(v, c);
    });
  }

  /* ---------- 募集シフト ---------- */
  function applyBtn(url, cat) {
    var b = el('button', 'apply', 'シフナビで確認する');
    b.onclick = function () {
      if (!url) return;
      var who = cat.k === 'jousetsu' ? '\n※常設スタッフ向けの募集です。催事専任スタッフは応募対象外です。' : '';
      if (!window.confirm('シフナビを開きます。\n店舗・日付・区分は自動では選択されません。シフナビでログイン後、「募集中のシフトに応募する」から選んでください。\n応募できるかどうかはシフナビで確認されます。' + who)) return;
      liff.openWindow({ url: url, external: false });
    };
    return b;
  }
  function slotRow(text, sub, url, cat) {
    var r = el('div', 'slot'), w = el('div', 'w');
    add(w, el('div', '', text), sub ? el('div', 'muted', sub) : null);
    return add(r, w, applyBtn(url, cat));
  }
  function slots(items) { return items.reduce(function (s, it) { return s + it.reds.length; }, 0); }
  function renderRecruit(d) {
    var v = view(), items = d.items || [];
    if (d.months && d.months.length > 1) {
      var ch = el('div', 'chips');
      d.months.forEach(function (m) { var b = el('button', m === d.month ? 'on' : '', monthText(m)); b.onclick = function () { if (m === S.month) return; S.month = m; load('recruit'); }; ch.appendChild(b); });
      add(v, ch);
    }
    // 募集区分（応援募集は0件なら区分ごと出さない。取得済みのデータで判定＝取得中・失敗は0件扱いしない）
    var cats = CATS.filter(function (c) { return c.k !== 'support' || items.some(c.f); });
    if (!cats.some(function (c) { return c.k === S.rcCat; })) S.rcCat = 'saiji';
    var cat = cats.filter(function (c) { return c.k === S.rcCat; })[0];
    var cb = el('div', 'cats');
    cats.forEach(function (c) {
      var mine = items.filter(c.f), b = el('button', c.k === S.rcCat ? 'on' : '');
      add(b, el('span', 'cn', c.name), el('span', 'cc', slots(mine) + '枠'));
      b.onclick = function () { S.rcCat = c.k; render(); };
      cb.appendChild(b);
    });
    add(v, cb);
    add(v, el('div', 'note', cat.desc));
    var tabs = el('div', 'tabs');
    [['store', '店舗別'], ['date', '日付別']].forEach(function (t) {
      var b = el('button', S.rcView === t[0] ? 'on' : '', t[1]); b.onclick = function () { S.rcView = t[0]; render(); }; tabs.appendChild(b);
    });
    add(v, tabs);
    if (d.partial) add(v, el('p', 'muted', '一部の店舗の情報を読み込めませんでした。'));
    var list = items.filter(cat.f);
    if (!list.length) return add(v, add(el('div', 'card'), el('p', 'muted', monthText(d.month) + 'の' + cat.name + 'はありません。')));
    add(v, el('p', 'muted', '店舗・日付・区分の自動選択は準備中です。「シフナビで確認する」でシフナビを開き、応募する店舗・日付を選んでください。'));
    var tm = function (s) { return [s.label, s.time].filter(Boolean).join('　'); };
    if (S.rcView === 'store') {
      list.forEach(function (it) {
        var c = el('div', 'card');
        add(c, el('div', 't', it.brand), el('div', 's', it.store), add(el('div', 'badges'), el('span', 'b', it.jous ? '常設' : (it.kind || '催事')), el('span', 'b', it.reds.length + '枠')));
        it.reds.forEach(function (s) { add(c, slotRow(dayText(d.month, s.d) + '　' + s.label, s.time, d.applyUrl, cat)); });
        add(v, c);
      });
      return;
    }
    var byDay = {};
    list.forEach(function (it) { it.reds.forEach(function (s) { (byDay[s.d] = byDay[s.d] || []).push({ it: it, s: s }); }); });
    Object.keys(byDay).map(Number).sort(function (a, b) { return a - b; }).forEach(function (day) {
      add(v, el('div', 'day', dayText(d.month, day) + '（' + byDay[day].length + '枠）'));
      var c = el('div', 'card');
      byDay[day].forEach(function (x) { add(c, slotRow(x.it.brand + '　' + x.it.store, tm(x.s), d.applyUrl, cat)); });
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
      if (S.openN[n.id]) {
        add(c, el('div', 'body', n.body));
        if (n.link) { var a = el('a', 'link', '添付リンクを開く'); a.href = '#'; a.onclick = function (e) { e.preventDefault(); liff.openWindow({ url: n.link, external: true }); }; add(c, a); }
      } else add(c, el('div', 'muted', '▼ タップして本文を表示'));
      c.onclick = function (e) { if (e.target.tagName === 'A') return; S.openN[n.id] = !S.openN[n.id]; render(); };
      add(v, c);
    });
  }

  /* ---------- 起動 ---------- */
  function start() {
    if (!C.LIFF_ID || !C.API_URL) { msg('設定が完了していません（LIFF ID・API URL）。', true); return; }
    loading('LINEで確認中…');
    liff.init({ liffId: C.LIFF_ID }).then(function () {
      if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }   // 外部ブラウザで開いた場合
      S.idToken = liff.getIDToken();
      if (!S.idToken) { msg('LINEの認証情報を取得できませんでした。', true, 'LINEのメニューから開き直してください。'); return; }
      load(pageOf());
    }).catch(function (e) {
      msg('表示できませんでした。LINEのメニューから開き直してください。', true, '（' + String(e && e.message || e).slice(0, 80) + '）');
    });
  }
  start();
})();
