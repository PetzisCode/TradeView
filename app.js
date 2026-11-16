/* TradeView – Portfolio-Übersicht als Web-App (GitHub Pages) */
'use strict';

const LS_KEY = 'tradeview.v1';
const PERIODS = [
  { k: 'd', l: '1T', long: 'heute' },
  { k: 'w', l: '1W', long: '1 Woche' },
  { k: 'm', l: '1M', long: '1 Monat' },
  { k: 'ytd', l: 'YTD', long: 'seit Jahresbeginn' },
  { k: 'y', l: '1J', long: '1 Jahr' },
  { k: 'buy', l: 'Kauf', long: 'seit Kauf' },
];
// Ab welcher Veränderung (in %) eine Kachel voll gefärbt ist
const SCALE = { d: 3, w: 6, m: 10, m6: 20, ytd: 25, y: 30, y5: 80, buy: 40 };
const TYPE_LABEL = { aktie: 'Aktie', etf: 'ETF / ETC', krypto: 'Krypto' };
const RANGES = [
  { k: 'intra', l: '1T' },
  { k: 'week', l: '1W' },
  { k: 'm1', l: '1M' },
  { k: 'm6', l: '6M' },
  { k: 'y1', l: '1J' },
  { k: 'y5', l: '5J' },
  { k: 'max', l: 'Max' },
];

const S = {
  catalog: [],
  byId: {},
  summary: null,
  details: {},
  loading: false,
  store: { holdings: [], period: 'd', sort: 'value', range: 'm6' },
  marketFilter: 'alle',
  marketQuery: '',
};

/* ---------- Hilfsfunktionen ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nfEur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const nfEur0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

function eur(v, compact) {
  if (v == null || isNaN(v)) return '–';
  if (compact && Math.abs(v) >= 10000) return nfEur0.format(v);
  if (Math.abs(v) < 1 && v !== 0) {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumSignificantDigits: 4 }).format(v);
  }
  return nfEur.format(v);
}
function signedEur(v) {
  if (v == null || isNaN(v)) return '–';
  return (v > 0 ? '+' : v < 0 ? '−' : '±') + nfEur.format(Math.abs(v));
}
function pct(v, digits = 2) {
  if (v == null || isNaN(v)) return '–';
  const s = Math.abs(v).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return (v > 0 ? '+' : v < 0 ? '−' : '±') + s + ' %';
}
function num(v, max = 6) {
  return Number(v).toLocaleString('de-DE', { maximumFractionDigits: max });
}
function parseNum(s) {
  if (s == null) return NaN;
  s = String(s).trim().replace(/\s/g, '').replace('€', '');
  if (s === '') return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return Number(s);
}
const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'muted');

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() / 1000 - ts;
  if (diff < 90) return 'gerade eben';
  if (diff < 3600) return `vor ${Math.round(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.round(diff / 3600)} Std.`;
  const d = Math.round(diff / 86400);
  return d === 1 ? 'gestern' : `vor ${d} Tagen`;
}
function fmtDate(ts, withTime) {
  const d = new Date(ts * 1000);
  const o = withTime
    ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: 'numeric' };
  return d.toLocaleString('de-DE', o);
}

// Farbe für eine prozentuale Veränderung (rot ↔ grau ↔ grün)
const NEUTRAL = [52, 58, 72];
const GREEN = [22, 163, 74];
const RED = [214, 40, 48];
function heat(v, period) {
  if (v == null || isNaN(v)) return 'rgb(52,58,72)';
  const sc = SCALE[period] || 10;
  let t = Math.max(-1, Math.min(1, v / sc));
  t = Math.sign(t) * Math.pow(Math.abs(t), 0.65);
  const to = t >= 0 ? GREEN : RED;
  const a = Math.abs(t);
  const c = NEUTRAL.map((n, i) => Math.round(n + (to[i] - n) * a));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

/* ---------- Speicher ---------- */
function loadStore() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) Object.assign(S.store, JSON.parse(raw));
  } catch (e) { /* ignorieren */ }
}
function saveStore() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(S.store)); } catch (e) { toast('Speichern nicht möglich'); }
}
const holding = (id) => S.store.holdings.find((h) => h.id === id);

/* ---------- Daten ---------- */
async function loadCatalog() {
  const r = await fetch('catalog.json', { cache: 'no-cache' });
  S.catalog = await r.json();
  S.byId = Object.fromEntries(S.catalog.map((c) => [c.id, c]));
}
async function loadSummary(force) {
  if (S.loading) return;
  S.loading = true;
  setRefreshing(true);
  try {
    const r = await fetch('data/summary.json?t=' + (force ? Date.now() : Math.floor(Date.now() / 120000)), { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    S.summary = await r.json();
    S.details = {};
  } catch (e) {
    if (force) toast('Keine Verbindung – zeige gespeicherte Daten');
  } finally {
    S.loading = false;
    setRefreshing(false);
  }
}
async function loadDetail(id) {
  if (S.details[id]) return S.details[id];
  const r = await fetch(`data/s/${id}.json?u=${S.summary?.updated || 0}`);
  if (!r.ok) throw new Error(r.status);
  S.details[id] = await r.json();
  return S.details[id];
}
const quote = (id) => S.summary?.items?.[id];

function setRefreshing(on) {
  document.querySelectorAll('[data-refresh]').forEach((b) => b.classList.toggle('spin', on));
}

/* ---------- Portfolio-Berechnung ---------- */
function positions() {
  return S.store.holdings
    .filter((h) => S.byId[h.id])
    .map((h) => {
      const q = quote(h.id) || {};
      const price = q.p;
      const value = price != null ? price * h.shares : null;
      const dayAbs = price != null && q.pc != null ? (price - q.pc) * h.shares : null;
      const invested = h.buy ? h.buy * h.shares : null;
      return { h, item: S.byId[h.id], q, price, value, dayAbs, invested };
    });
}
function perfOf(pos, period) {
  if (period === 'buy') {
    if (!pos.h.buy || pos.price == null) return null;
    return (pos.price / pos.h.buy - 1) * 100;
  }
  return pos.q.c ? pos.q.c[period] : null;
}
function totals(list) {
  let value = 0, day = 0, prev = 0, inv = 0, invVal = 0;
  for (const p of list) {
    if (p.value == null) continue;
    value += p.value;
    if (p.dayAbs != null) { day += p.dayAbs; prev += p.value - p.dayAbs; }
    if (p.invested) { inv += p.invested; invVal += p.value; }
  }
  return {
    value, day, dayPct: prev ? (day / prev) * 100 : null,
    gain: inv ? invVal - inv : null, gainPct: inv ? (invVal / inv - 1) * 100 : null,
  };
}
// Portfolio-Performance über Zeitraum: gewichteter Mittelwert
function portfolioPerf(list, period) {
  let base = 0, now = 0;
  for (const p of list) {
    const v = perfOf(p, period);
    if (v == null || p.value == null) continue;
    now += p.value;
    base += p.value / (1 + v / 100);
  }
  return base ? (now / base - 1) * 100 : null;
}

/* ---------- Treemap (squarified) ---------- */
function squarify(nodes, W, H) {
  const total = nodes.reduce((s, n) => s + n.v, 0);
  if (!total) return [];
  const k = (W * H) / total;
  const items = nodes.map((n) => ({ ...n, a: n.v * k })).sort((a, b) => b.a - a.a);
  const out = [];
  let rect = { x: 0, y: 0, w: W, h: H };
  let row = [];
  const worst = (r, s) => {
    const sum = r.reduce((x, n) => x + n.a, 0);
    let mx = -Infinity, mn = Infinity;
    for (const n of r) { mx = Math.max(mx, n.a); mn = Math.min(mn, n.a); }
    return Math.max((s * s * mx) / (sum * sum), (sum * sum) / (s * s * mn));
  };
  const layout = (r) => {
    const sum = r.reduce((x, n) => x + n.a, 0);
    if (rect.w >= rect.h) {
      const cw = sum / rect.h;
      let y = rect.y;
      for (const n of r) { const h = n.a / cw; out.push({ ...n, x: rect.x, y, w: cw, h }); y += h; }
      rect = { x: rect.x + cw, y: rect.y, w: rect.w - cw, h: rect.h };
    } else {
      const rh = sum / rect.w;
      let x = rect.x;
      for (const n of r) { const w = n.a / rh; out.push({ ...n, x, y: rect.y, w, h: rh }); x += w; }
      rect = { x: rect.x, y: rect.y + rh, w: rect.w, h: rect.h - rh };
    }
  };
  let i = 0;
  while (i < items.length) {
    const s = Math.min(rect.w, rect.h);
    const n = items[i];
    if (!row.length || worst(row.concat(n), s) <= worst(row, s)) { row.push(n); i++; }
    else { layout(row); row = []; }
  }
  if (row.length) layout(row);
  return out;
}
const shortName = (n) => n.replace(/\s*\(.*?\)\s*/g, ' ').replace(/^(iShares|Xtrackers|Vanguard|SPDR|Invesco|VanEck)( Core)? /, '').trim();

function renderTreemap(el, list, period) {
  const W = el.clientWidth || 340;
  const H = Math.round(Math.min(Math.max(W * 0.95, 300), 560));
  el.style.height = H + 'px';
  const nodes = list.filter((p) => p.value > 0).map((p) => ({ v: p.value, p }));
  const rects = squarify(nodes, W, H);
  const total = nodes.reduce((s, n) => s + n.v, 0);
  el.innerHTML = rects.map((r) => {
    const v = perfOf(r.p, period);
    const minSide = Math.min(r.w, r.h);
    let inner = '';
    if (r.w > 40 && r.h > 26) {
      const fs = Math.max(10, Math.min(20, minSide / 5.2, r.w / 7));
      const share = (r.v / total) * 100;
      inner = `<div class="tn" style="font-size:${fs}px">${esc(shortName(r.p.item.name))}</div>`;
      if (r.h > 44) inner += `<div class="tp" style="font-size:${Math.max(10, fs * 0.82)}px">${pct(v, 1)}</div>`;
      if (r.h > 86 && r.w > 80) inner += `<div class="tv">${eur(r.p.value, true)} · ${share.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %</div>`;
    }
    return `<a class="tile" href="#/w/${r.p.item.id}" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:${heat(v, period)}">${inner}</a>`;
  }).join('');
}

function sparkSvg(vals, w = 56, h = 26) {
  if (!vals || vals.length < 2) return `<svg class="spark"></svg>`;
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const span = mx - mn || 1;
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - mn) / span) * (h - 4)).toFixed(1)}`).join(' ');
  const col = vals[vals.length - 1] >= vals[0] ? 'var(--up)' : 'var(--down)';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

/* ---------- Ansichten ---------- */
const ICON_REFRESH = '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';
const ICON_BACK = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';

function stampLine() {
  if (!S.summary) return 'Noch keine Kursdaten – der erste Abruf läuft gleich.';
  return `Kurse ${timeAgo(S.summary.updated)} aktualisiert · verzögert`;
}

function viewHome() {
  const list = positions();
  const per = S.store.period;
  const t = totals(list);
  const perLabel = PERIODS.find((p) => p.k === per);
  let html = `
    <div class="topbar"><h1>Depot</h1>
      <button class="iconbtn" data-refresh aria-label="Aktualisieren">${ICON_REFRESH}</button></div>`;

  if (!list.length) {
    html += `<div class="empty"><div class="ico">📊</div><h2>Noch leer</h2>
      <p>Füge Aktien, ETFs oder Krypto hinzu, die du bei Trade Republic hältst.</p>
      <a class="btn" href="#/markt">Wertpapier hinzufügen</a></div>
      <p class="note">${esc(stampLine())}</p>`;
    return html;
  }

  const pp = per === 'd' ? t.dayPct : portfolioPerf(list, per);
  const sub = per === 'd'
    ? `${signedEur(t.day)} (${pct(t.dayPct)}) heute`
    : per === 'buy'
      ? (t.gain != null ? `${signedEur(t.gain)} (${pct(t.gainPct)}) seit Kauf` : 'Kein Kaufkurs hinterlegt')
      : `${pct(pp)} ${perLabel.long}`;
  const subCls = per === 'd' ? cls(t.day) : per === 'buy' ? cls(t.gain) : cls(pp);

  html += `
    <div class="hero">
      <div class="label">Gesamtwert</div>
      <div class="big num">${eur(t.value)}</div>
      <div class="sub ${subCls}">${sub}</div>
      <div class="stamp">${esc(stampLine())}</div>
    </div>
    <div class="seg" id="periods">${PERIODS.map((p) => `<button data-p="${p.k}" class="${p.k === per ? 'on' : ''}">${p.l}</button>`).join('')}</div>
    <div class="treemap" id="tm"></div>
    <div class="legend"><span>${pct(-SCALE[per], 0)}</span>
      <div class="bar" style="background:linear-gradient(90deg,${heat(-SCALE[per], per)},${heat(0, per)},${heat(SCALE[per], per)})"></div>
      <span>${pct(SCALE[per], 0)}</span></div>`;

  const sorted = [...list].sort((a, b) => S.store.sort === 'perf'
    ? (perfOf(b, per) ?? -1e9) - (perfOf(a, per) ?? -1e9)
    : (b.value || 0) - (a.value || 0));

  html += `<div class="section-h"><h2>Positionen</h2>
    <button id="sortBtn">${S.store.sort === 'perf' ? 'Nach Entwicklung ▾' : 'Nach Wert ▾'}</button></div>
    <div class="list">${sorted.map((p) => {
      const v = perfOf(p, per);
      const share = t.value ? (p.value / t.value) * 100 : 0;
      return `<a class="row" href="#/w/${p.item.id}">
        <span class="bullet" style="background:${heat(v, per)}"></span>
        <div class="main"><div class="name">${esc(p.item.name)}</div>
          <div class="meta">${num(p.h.shares)} Stk. · ${eur(p.price)} · ${share.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %</div></div>
        <div class="right"><div class="val">${eur(p.value)}</div>
          <span class="pill" style="background:${heat(v, per)}">${pct(v)}</span></div></a>`;
    }).join('')}</div>`;

  html += `<p class="note">Kachelgröße = Anteil am Depotwert · Farbe = Entwicklung ${esc(perLabel.long)}.</p>`;
  return html;
}
function afterHome() {
  const tm = $('#tm');
  if (tm) renderTreemap(tm, positions(), S.store.period);
  $('#periods')?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-p]');
    if (!b) return;
    S.store.period = b.dataset.p; saveStore(); render();
  });
  $('#sortBtn')?.addEventListener('click', () => {
    S.store.sort = S.store.sort === 'perf' ? 'value' : 'perf'; saveStore(); render();
  });
}

function viewMarket() {
  return `
    <div class="topbar"><h1>Hinzufügen</h1></div>
    <label class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/></svg>
      <input id="q" type="search" placeholder="Name, Kürzel oder ISIN" autocomplete="off" autocorrect="off" value="${esc(S.marketQuery)}"></label>
    <div class="chips" id="chips">${[['alle', 'Alle'], ['aktie', 'Aktien'], ['etf', 'ETFs'], ['krypto', 'Krypto'], ['depot', 'Im Depot']]
      .map(([k, l]) => `<button class="chip ${S.marketFilter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
    <div class="list" id="mlist"></div>
    <p class="note">Fehlt ein Wertpapier? Sag Bescheid – es lässt sich in <code>catalog.json</code> ergänzen.</p>`;
}
function renderMarketList() {
  const q = S.marketQuery.trim().toLowerCase();
  const f = S.marketFilter;
  const rows = S.catalog.filter((c) => {
    if (f === 'depot' && !holding(c.id)) return false;
    if (f !== 'alle' && f !== 'depot' && c.type !== f) return false;
    if (!q) return true;
    return [c.name, c.symbol, c.isin, c.region, c.id].some((x) => x && x.toLowerCase().includes(q));
  });
  const el = $('#mlist');
  if (!el) return;
  if (!rows.length) { el.innerHTML = `<div class="row"><div class="main muted">Nichts gefunden.</div></div>`; return; }
  el.innerHTML = rows.map((c) => {
    const qd = quote(c.id) || {};
    const d = qd.c?.d;
    const sub = [c.isin || c.symbol, c.type === 'aktie' ? c.region : TYPE_LABEL[c.type]].filter(Boolean).join(' · ');
    return `<a class="row" href="#/w/${c.id}">
      <div class="main"><div class="name">${esc(c.name)}</div>
        <div class="meta">${holding(c.id) ? '<span class="check">✓ Im Depot</span> · ' : ''}${esc(sub)}</div></div>
      ${sparkSvg(qd.sp)}
      <div class="right"><div class="val">${eur(qd.p)}</div><div class="${cls(d)} num" style="font-size:13px;font-weight:600">${pct(d)}</div></div></a>`;
  }).join('');
}
function afterMarket() {
  renderMarketList();
  const input = $('#q');
  input.addEventListener('input', () => { S.marketQuery = input.value; renderMarketList(); });
  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    S.marketFilter = b.dataset.f;
    document.querySelectorAll('#chips .chip').forEach((x) => x.classList.toggle('on', x === b));
    renderMarketList();
  });
}

function viewDetail(id) {
  const c = S.byId[id];
  if (!c) return `<a class="back" href="#/">${ICON_BACK}Zurück</a><p>Wertpapier nicht gefunden.</p>`;
  const q = quote(id) || {};
  const h = holding(id);
  const ch = q.c || {};
  const back = '#/';
  let html = `
    <div class="topbar"><a class="back" href="${back}" id="backlink">${ICON_BACK}Zurück</a><span style="flex:1"></span>
      <button class="iconbtn" data-refresh aria-label="Aktualisieren">${ICON_REFRESH}</button></div>
    <div class="d-head"><span class="tag">${TYPE_LABEL[c.type]}${c.region && c.type === 'aktie' ? ' · ' + esc(c.region) : ''}</span>
      <h1>${esc(c.name)}</h1>
      <div class="ids">${esc([c.isin && 'ISIN ' + c.isin, c.symbol, q.ex].filter(Boolean).join(' · '))}</div></div>
    <div class="hero" style="margin-bottom:0">
      <div class="big num" id="dPrice">${eur(q.p)}</div>
      <div class="sub ${cls(ch.d)}" id="dSub">${q.p != null && q.pc != null ? signedEur(q.p - q.pc) + ' (' + pct(ch.d) + ') heute' : '–'}</div>
      ${q.cur && q.cur !== 'EUR' ? `<div class="stamp">Originalkurs ${num(q.po, 4)} ${esc(q.cur)} · in Euro umgerechnet</div>` : ''}
    </div>
    <div class="chartbox" id="chart"><div class="chart-empty">Lade Verlauf …</div></div>
    <div class="seg" id="ranges">${RANGES.map((r) => `<button data-r="${r.k}" class="${r.k === S.store.range ? 'on' : ''}">${r.l}</button>`).join('')}</div>
    <div class="grid">${[['1 Woche', ch.w], ['1 Monat', ch.m], ['6 Monate', ch.m6], ['YTD', ch.ytd], ['1 Jahr', ch.y], ['5 Jahre', ch.y5]]
      .map(([k, v]) => `<div class="cell"><div class="k">${k}</div><div class="v ${cls(v)}">${pct(v, 1)}</div></div>`).join('')}</div>`;

  html += `<div class="section-h"><h2>Meine Position</h2></div>`;
  if (h) {
    const value = q.p != null ? q.p * h.shares : null;
    const all = totals(positions()).value;
    const inv = h.buy ? h.buy * h.shares : null;
    html += `<div class="card">
      <div class="kv"><span class="k">Stück</span><span class="v">${num(h.shares)}</span></div>
      <div class="kv"><span class="k">Wert</span><span class="v">${eur(value)}</span></div>
      <div class="kv"><span class="k">Anteil am Depot</span><span class="v">${all && value ? (value / all * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' %' : '–'}</span></div>
      <div class="kv"><span class="k">Heute</span><span class="v ${cls(ch.d)}">${q.pc != null && q.p != null ? signedEur((q.p - q.pc) * h.shares) : '–'}</span></div>
      ${inv ? `<div class="kv"><span class="k">Einstandskurs</span><span class="v">${eur(h.buy)}</span></div>
      <div class="kv"><span class="k">Investiert</span><span class="v">${eur(inv)}</span></div>
      <div class="kv"><span class="k">Gewinn / Verlust</span><span class="v ${cls(value - inv)}">${signedEur(value - inv)} (${pct((value / inv - 1) * 100)})</span></div>` : ''}
      <div class="actions"><button class="btn ghost" id="editPos">Bearbeiten</button></div></div>`;
  } else {
    html += `<div class="card"><p class="muted" style="margin:0 0 12px">Noch nicht in deinem Depot.</p>
      <button class="btn block" id="editPos">＋ Zum Depot hinzufügen</button></div>`;
  }

  html += `<div class="section-h"><h2>Nachrichten</h2></div><div class="list news" id="news"><div class="row muted">Lade Nachrichten …</div></div>
    <p class="note">${esc(stampLine())}. Nachrichten über Google News. Keine Anlageberatung.</p>`;
  return html;
}

function rangeSeries(d, k) {
  const now = Date.now() / 1000;
  const cut = (arr, days) => (arr || []).filter((p) => p[0] >= now - days * 86400);
  switch (k) {
    case 'intra': return d.intra?.length > 1 ? d.intra : (d.week || []).slice(-14);
    case 'week': return d.week || [];
    case 'm1': return cut(d.daily, 31);
    case 'm6': return cut(d.daily, 183);
    case 'y1': return cut(d.daily, 366);
    case 'y5': return cut(d.weekly, 365 * 5 + 3);
    default: return d.weekly || [];
  }
}

function drawChart(box, pts, rangeKey, q) {
  if (!pts || pts.length < 2) { box.innerHTML = '<div class="chart-empty">Kein Verlauf verfügbar</div>'; return; }
  const W = box.clientWidth || 360, H = box.clientHeight || 230;
  const padT = 26, padB = 22, padX = 16;
  const vals = pts.map((p) => p[1]);
  let mn = Math.min(...vals), mx = Math.max(...vals);
  const base = rangeKey === 'intra' && q?.pc ? q.pc : vals[0];
  mn = Math.min(mn, base); mx = Math.max(mx, base);
  const span = mx - mn || mx * 0.01 || 1;
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
  const X = (i) => padX + (i / (pts.length - 1)) * (W - padX * 2);
  const Y = (v) => padT + (1 - (v - mn) / span) * (H - padT - padB);
  const up = vals[vals.length - 1] >= base;
  const col = up ? 'var(--up)' : 'var(--down)';
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  const area = `${line}L${X(pts.length - 1).toFixed(1)},${H - padB}L${X(0).toFixed(1)},${H - padB}Z`;
  const withTime = rangeKey === 'intra' || rangeKey === 'week';
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${up ? '#22c55e' : '#f04949'}" stop-opacity=".28"/><stop offset="1" stop-color="${up ? '#22c55e' : '#f04949'}" stop-opacity="0"/></linearGradient></defs>
    <line x1="${padX}" x2="${W - padX}" y1="${Y(base)}" y2="${Y(base)}" stroke="#3a4152" stroke-dasharray="3 4"/>
    <path d="${area}" fill="url(#g)"/>
    <path d="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <text class="axis" x="${padX}" y="12">Hoch ${eur(mx)} · Tief ${eur(mn)}</text>
    <text class="axis" x="${padX}" y="${H - padB + 14}">${fmtDate(t0, withTime)}</text>
    <text class="axis" x="${W - padX}" y="${H - padB + 14}" text-anchor="end">${fmtDate(t1, withTime)}</text>
    <g id="cur" style="display:none"><line id="cl" y1="${padT}" y2="${H - padB}" stroke="#8a93a6" stroke-width="1"/>
      <circle id="cd" r="4.5" fill="${col}" stroke="#0b0d12" stroke-width="2"/></g>
  </svg>`;
  const g = $('#cur', box), cl = $('#cl', box), cd = $('#cd', box);
  const priceEl = $('#dPrice'), subEl = $('#dSub');
  const origPrice = priceEl.innerHTML, origSub = subEl.innerHTML, origCls = subEl.className;
  const svg = $('svg', box);
  const move = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(((x - padX) / (W - padX * 2)) * (pts.length - 1))));
    const p = pts[i];
    g.style.display = '';
    cl.setAttribute('x1', X(i)); cl.setAttribute('x2', X(i));
    cd.setAttribute('cx', X(i)); cd.setAttribute('cy', Y(p[1]));
    const ch = (p[1] / base - 1) * 100;
    priceEl.textContent = eur(p[1]);
    subEl.className = 'sub ' + cls(ch);
    subEl.textContent = `${pct(ch)} · ${fmtDate(p[0], withTime)}`;
  };
  const end = () => { g.style.display = 'none'; priceEl.innerHTML = origPrice; subEl.innerHTML = origSub; subEl.className = origCls; };
  let active = false;
  box.ontouchstart = (e) => { active = true; move(e.touches[0].clientX); };
  box.ontouchmove = (e) => { if (active) { e.preventDefault(); move(e.touches[0].clientX); } };
  box.ontouchend = box.ontouchcancel = () => { active = false; end(); };
  box.onmousemove = (e) => move(e.clientX);
  box.onmouseleave = end;
}

async function afterDetail(id) {
  const c = S.byId[id];
  if (!c) return;
  $('#editPos')?.addEventListener('click', () => openPositionSheet(id));
  $('#backlink')?.addEventListener('click', (e) => {
    if (history.length > 1 && S.cameFromApp) { e.preventDefault(); history.back(); }
  });
  const box = $('#chart');
  let d;
  try { d = await loadDetail(id); } catch (e) {
    box.innerHTML = '<div class="chart-empty">Noch keine Daten vorhanden</div>';
    $('#news').innerHTML = '<div class="row muted">Keine Nachrichten verfügbar.</div>';
    return;
  }
  if (location.hash !== `#/w/${id}`) return;
  const draw = () => drawChart(box, rangeSeries(d, S.store.range), S.store.range, quote(id));
  draw();
  $('#ranges').addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    S.store.range = b.dataset.r; saveStore();
    document.querySelectorAll('#ranges button').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  });
  S.redraw = draw;
  const news = d.news || [];
  $('#news').innerHTML = news.length
    ? news.map((n) => `<a href="${esc(n.u)}" target="_blank" rel="noopener"><div class="nt">${esc(n.t)}</div>
        <div class="ns">${esc(n.s || '')}${n.d ? ' · ' + timeAgo(n.d) : ''}</div></a>`).join('')
    : '<div class="row muted">Keine aktuellen Nachrichten gefunden.</div>';
}

function viewMore() {
  const sm = S.summary;
  const n = S.store.holdings.length;
  return `
    <div class="topbar"><h1>Mehr</h1></div>
    <div class="card">
      <div class="kv"><span class="k">Positionen im Depot</span><span class="v">${n}</span></div>
      <div class="kv"><span class="k">Wertpapiere in der Auswahl</span><span class="v">${S.catalog.length}</span></div>
      <div class="kv"><span class="k">Kursdaten vom</span><span class="v">${sm ? fmtDate(sm.updated, true) + ' Uhr' : '–'}</span></div>
      ${sm?.fx?.USD ? `<div class="kv"><span class="k">EUR/USD</span><span class="v">${num(sm.fx.USD, 4)}</span></div>` : ''}
      ${sm?.errors?.length ? `<div class="kv"><span class="k">Nicht abrufbar</span><span class="v">${sm.errors.length}</span></div>` : ''}
    </div>
    <div class="section-h"><h2>Sicherung</h2></div>
    <div class="card">
      <p class="muted" style="margin:0 0 12px;font-size:14px">Dein Depot wird nur auf diesem Gerät gespeichert. Mit einer Sicherung kannst du es auf ein anderes Gerät übertragen.</p>
      <div class="actions" style="margin-top:0"><button class="btn ghost" id="exp">Sichern</button><button class="btn ghost" id="imp">Wiederherstellen</button></div>
    </div>
    <div class="section-h"><h2>So nutzt du die App</h2></div>
    <div class="card" style="font-size:14px;line-height:1.55">
      <b>Auf den Home-Bildschirm:</b> In Safari unten auf <i>Teilen</i> tippen → <i>Zum Home-Bildschirm</i>.<br><br>
      <b>Kurse:</b> werden an Börsentagen etwa alle 20 Minuten aktualisiert (Yahoo Finance), Wechselkurse in Euro umgerechnet. Die Kurse können leicht von Trade Republic abweichen.<br><br>
      <b>Kursverlauf:</b> Finger auf das Diagramm legen und ziehen, um einzelne Kurse zu sehen.
    </div>
    <div class="actions"><button class="btn danger block" id="reset">Depot zurücksetzen</button></div>
    <p class="note">Keine Anlageberatung. Alle Angaben ohne Gewähr.</p>`;
}
function afterMore() {
  $('#exp').addEventListener('click', async () => {
    const data = JSON.stringify({ app: 'TradeView', v: 1, holdings: S.store.holdings }, null, 1);
    const file = new File([data], 'tradeview-depot.json', { type: 'application/json' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'TradeView Depot' }); return; }
    } catch (e) { if (e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(data); toast('Sicherung in die Zwischenablage kopiert'); }
    catch (e) { openTextSheet('Sicherung', data, false); }
  });
  $('#imp').addEventListener('click', () => openTextSheet('Wiederherstellen', '', true));
  $('#reset').addEventListener('click', () => {
    if (confirm('Alle Positionen löschen?')) { S.store.holdings = []; saveStore(); toast('Depot geleert'); render(); }
  });
}

/* ---------- Bottom Sheets ---------- */
function openSheet(html, onMount) {
  const sh = $('#sheet');
  sh.innerHTML = `<div class="backdrop"></div><div class="panel"><div class="grab"></div>${html}</div>`;
  sh.classList.remove('hidden');
  sh.setAttribute('aria-hidden', 'false');
  sh.querySelector('.backdrop').addEventListener('click', closeSheet);
  onMount && onMount(sh);
}
function closeSheet() {
  const sh = $('#sheet');
  sh.classList.add('hidden');
  sh.setAttribute('aria-hidden', 'true');
  sh.innerHTML = '';
}

function openPositionSheet(id) {
  const c = S.byId[id];
  const h = holding(id);
  const q = quote(id) || {};
  openSheet(`
    <h3>${esc(c.name)}</h3>
    <div class="hint">Aktueller Kurs ${eur(q.p)}</div>
    <div class="field"><label for="fShares">Stückzahl</label>
      <input id="fShares" inputmode="decimal" placeholder="z. B. 12,5" value="${h ? num(h.shares) : ''}"></div>
    <div class="field"><label for="fBuy">Einstandskurs je Stück in € (optional)</label>
      <input id="fBuy" inputmode="decimal" placeholder="${q.p != null ? 'z. B. ' + num(q.p, 2) : ''}" value="${h?.buy ? num(h.buy) : ''}">
      <div class="help">Findest du in Trade Republic unter der Position. Damit wird dein Gewinn/Verlust berechnet.</div></div>
    <div class="field" id="amountWrap"><label for="fAmount">… oder Positionswert in € eingeben</label>
      <input id="fAmount" inputmode="decimal" placeholder="rechnet die Stückzahl aus"></div>
    <button class="btn block" id="fSave">Speichern</button>
    ${h ? '<button class="btn danger block" id="fDel" style="margin-top:6px">Aus Depot entfernen</button>' : ''}
  `, (sh) => {
    const shares = $('#fShares', sh), amount = $('#fAmount', sh);
    amount.addEventListener('input', () => {
      const a = parseNum(amount.value);
      if (a > 0 && q.p) shares.value = num(a / q.p, 6);
    });
    setTimeout(() => shares.focus(), 250);
    $('#fSave', sh).addEventListener('click', () => {
      const s = parseNum(shares.value);
      const b = parseNum($('#fBuy', sh).value);
      if (!(s > 0)) { shares.focus(); toast('Bitte eine Stückzahl eingeben'); return; }
      const entry = { id, shares: s, buy: b > 0 ? b : null };
      const i = S.store.holdings.findIndex((x) => x.id === id);
      if (i >= 0) S.store.holdings[i] = entry; else S.store.holdings.push(entry);
      saveStore(); closeSheet(); toast(h ? 'Gespeichert' : 'Zum Depot hinzugefügt'); render();
    });
    $('#fDel', sh)?.addEventListener('click', () => {
      S.store.holdings = S.store.holdings.filter((x) => x.id !== id);
      saveStore(); closeSheet(); toast('Entfernt'); render();
    });
  });
}

function openTextSheet(title, text, isImport) {
  openSheet(`<h3>${title}</h3>
    <div class="hint">${isImport ? 'Gesicherten Text hier einfügen.' : 'Diesen Text kopieren und aufbewahren.'}</div>
    <div class="field"><textarea id="tx" rows="7">${esc(text)}</textarea></div>
    ${isImport ? '<button class="btn block" id="txGo">Übernehmen</button>' : '<button class="btn block" id="txGo">Schließen</button>'}`,
  (sh) => {
    $('#txGo', sh).addEventListener('click', () => {
      if (!isImport) return closeSheet();
      try {
        const d = JSON.parse($('#tx', sh).value);
        const list = (d.holdings || d).filter((x) => x && S.byId[x.id] && x.shares > 0);
        if (!list.length) throw new Error();
        S.store.holdings = list; saveStore(); closeSheet(); toast(`${list.length} Positionen übernommen`); render();
      } catch (e) { toast('Ungültige Sicherung'); }
    });
  });
}

/* ---------- Routing ---------- */
function route() {
  const h = location.hash.replace(/^#/, '') || '/';
  if (h.startsWith('/w/')) return { name: 'detail', id: decodeURIComponent(h.slice(3)) };
  if (h === '/markt') return { name: 'markt' };
  if (h === '/mehr') return { name: 'mehr' };
  return { name: 'home' };
}
function render() {
  const r = route();
  const view = $('#view');
  const tab = r.name === 'detail' ? null : r.name;
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  S.redraw = null;
  if (r.name === 'home') { view.innerHTML = viewHome(); afterHome(); }
  else if (r.name === 'markt') { view.innerHTML = viewMarket(); afterMarket(); }
  else if (r.name === 'mehr') { view.innerHTML = viewMore(); afterMore(); }
  else { view.innerHTML = viewDetail(r.id); afterDetail(r.id); }
  view.querySelectorAll('[data-refresh]').forEach((b) => b.addEventListener('click', async () => {
    await loadSummary(true); render();
  }));
}

let lastRoute = null;
window.addEventListener('hashchange', () => {
  const r = route();
  S.cameFromApp = lastRoute !== null;
  const keepScroll = r.name === 'markt' && lastRoute === 'detail';
  closeSheet();
  render();
  if (!keepScroll) window.scrollTo(0, 0);
  lastRoute = r.name;
});
let rt;
window.addEventListener('resize', () => {
  clearTimeout(rt);
  rt = setTimeout(() => {
    const tm = $('#tm');
    if (tm) renderTreemap(tm, positions(), S.store.period);
    if (S.redraw) S.redraw();
  }, 150);
});
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && (!S.summary || Date.now() / 1000 - S.summary.updated > 300)) {
    await loadSummary(false);
    if (!$('#sheet').classList.contains('hidden')) return;
    render();
  }
});

(async function init() {
  loadStore();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  try { await loadCatalog(); } catch (e) { $('#view').innerHTML = '<p class="note">Konnte die App nicht laden.</p>'; return; }
  render();
  lastRoute = route().name;
  await loadSummary(false);
  render();
  // alle 5 Minuten neu laden, solange die App offen ist
  setInterval(async () => {
    if (document.visibilityState !== 'visible' || !$('#sheet').classList.contains('hidden')) return;
    const before = S.summary?.updated;
    await loadSummary(false);
    if (S.summary?.updated !== before && route().name !== 'detail') render();
  }, 300000);
})();
