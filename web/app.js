/* PlanLite – viewer UI: Gantt, critical path, baseline, resources, PDF and Excel export. */
(function () {
'use strict';
const $ = (id) => document.getElementById(id);
const DAY = PL.DAY, RH = 26, HH = 44;
const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const D = PL.fmtDate;

const THEMES = {
  dark: { bg: '#16181c', alt: '#1b1e23', grid: '#262b33', nonwork: '#20242b', text: '#e6e8eb', muted: '#98a1ad', bar: '#4c8dff', prog: '#1f4fb0', crit: '#ff6b6b', critProg: '#a83232',
    sum: '#cfd4db', ms: '#ffb020', base: '#6b7480', link: '#8a94a3', today: '#3df58a', head: '#23272e', line: '#3a404a', sel: 'rgba(76,141,255,0.22)' },
  light: { bg: '#ffffff', alt: '#f7f8fa', grid: '#e6e9ee', nonwork: '#eff1f4', text: '#1c2026', muted: '#5d6673', bar: '#2f6fe0', prog: '#173f8f', crit: '#d92d2d', critProg: '#8e1b1b',
    sum: '#30363f', ms: '#e08a00', base: '#9aa3ad', link: '#6c7684', today: '#12a150', head: '#f2f4f7', line: '#d3d8df', sel: 'rgba(47,111,224,0.16)' },
};
const COLS = [
  { k: 'id', t: 'ID', w: 46, cls: 'id' }, { k: 'name', t: 'Task name', w: 300, cls: 'nm' }, { k: 'dur', t: 'Duration', w: 84, cls: 'n' },
  { k: 'start', t: 'Start', w: 104 }, { k: 'finish', t: 'Finish', w: 104 }, { k: 'pct', t: '% done', w: 72, cls: 'n' },
  { k: 'bStart', t: 'Baseline start', w: 110, base: true }, { k: 'bFinish', t: 'Baseline finish', w: 110, base: true }, { k: 'var', t: 'Finish var.', w: 84, cls: 'n var', base: true },
  { k: 'pred', t: 'Predecessors', w: 110 }, { k: 'res', t: 'Resources', w: 190 },
];
window.PLAN = {};
const S = { P: null, dirty: false, srcXml: null, minLevel: 1, name: '', rows: [], rowIdx: new Map(), sel: null, ppd: 9, t0: 0, t1: 0, crit: false, base: false, links: true, filter: 'all', search: '', level: 0,
  dark: true, view: 'gantt', server: location.protocol.indexOf('http') === 0, info: null, retry: null, selRes: null };
const th = () => THEMES[S.dark ? 'dark' : 'light'];
const api = (p) => 'api/' + p;

function toast(msg, err, ms) { const t = $('toast'); t.textContent = msg; t.className = err ? 'err' : ''; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, ms || (err ? 9000 : 5000)); }
function busy(msg) { $('busy').hidden = !msg; if (msg) $('busyText').textContent = msg; }
const paint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/* ---------- time scale ---------- */
function floorTo(unit, t) {
  const d = new Date(t), y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (unit === 'day') return Date.UTC(y, m, d.getUTCDate());
  if (unit === 'week') return Date.UTC(y, m, d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (unit === 'month') return Date.UTC(y, m, 1);
  if (unit === 'quarter') return Date.UTC(y, m - (m % 3), 1);
  return Date.UTC(y, 0, 1);
}
function nextOf(unit, t) {
  const d = new Date(t), y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (unit === 'day') return t + DAY;
  if (unit === 'week') return t + 7 * DAY;
  if (unit === 'month') return Date.UTC(y, m + 1, 1);
  if (unit === 'quarter') return Date.UTC(y, m + 3, 1);
  return Date.UTC(y + 1, 0, 1);
}
function tiers(ppd) {
  if (ppd >= 22) return ['week', 'day'];
  if (ppd >= 5) return ['month', 'week'];
  if (ppd >= 1.1) return ['year', 'month'];
  return ['year', 'quarter'];
}
function tickLabel(unit, t, w, top) {
  const d = new Date(t);
  if (unit === 'day') return String(d.getUTCDate());
  if (unit === 'week') return top ? D(t) : String(d.getUTCDate());
  if (unit === 'month') return top ? PL.MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear() : (w < 24 ? PL.MONTHS[d.getUTCMonth()][0] : PL.MONTHS[d.getUTCMonth()]);
  if (unit === 'quarter') return 'Q' + (Math.floor(d.getUTCMonth() / 3) + 1);
  return String(d.getUTCFullYear());
}
// header band: x,y,w,h in px; tLeft = time at x
function drawHeader(c, x, y, w, h, tLeft, ppd, T, fs) {
  const tr = tiers(ppd), tRight = tLeft + w / ppd * DAY;
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.fillStyle = T.head; c.fillRect(x, y, w, h);
  c.strokeStyle = T.line; c.lineWidth = 1; c.font = (fs || 12) + 'px system-ui, sans-serif'; c.textBaseline = 'middle';
  for (let k = 0; k < 2; k++) {
    const unit = tr[k], yy = y + k * h / 2;
    let t = floorTo(unit, tLeft), guard = 0;
    while (t < tRight && guard++ < 5000) {
      const n = nextOf(unit, t), x0 = x + (t - tLeft) / DAY * ppd, x1 = x + (n - tLeft) / DAY * ppd, cw = x1 - x0;
      c.beginPath(); c.moveTo(Math.round(x0) + 0.5, yy); c.lineTo(Math.round(x0) + 0.5, yy + h / 2); c.stroke();
      const lab = tickLabel(unit, t, cw, k === 0), lw = c.measureText(lab).width;
      if (k === 0) { const lx = Math.max(x0, x) + 5; if (lx + lw < x1 - 2) { c.fillStyle = T.text; c.textAlign = 'left'; c.fillText(lab, lx, yy + h / 4 + 0.5); } }
      else if (lw + 3 < cw) { c.fillStyle = T.muted; c.textAlign = 'center'; c.fillText(lab, (x0 + x1) / 2, yy + h / 4 + 0.5); }
      t = n;
    }
  }
  c.beginPath(); c.moveTo(x, y + h / 2 + 0.5); c.lineTo(x + w, y + h / 2 + 0.5); c.stroke();
  c.restore();
}
function drawGrid(c, x, y, w, h, tLeft, ppd, T, P, today) {
  const tRight = tLeft + w / ppd * DAY;
  if (ppd >= 4) {
    c.fillStyle = T.nonwork;
    for (let t = floorTo('day', tLeft); t < tRight; t += DAY) {
      if (!P.workDays[new Date(t).getUTCDay()]) c.fillRect(x + (t - tLeft) / DAY * ppd, y, ppd, h);
    }
    for (const hd of P.holidays) { if (hd[1] < tLeft || hd[0] > tRight) continue; const a = floorTo('day', hd[0]), b = floorTo('day', hd[1]) + DAY; c.fillRect(x + (a - tLeft) / DAY * ppd, y, (b - a) / DAY * ppd, h); }
  }
  const unit = tiers(ppd)[1];
  c.strokeStyle = T.grid; c.lineWidth = 1; c.beginPath();
  let t = floorTo(unit, tLeft), guard = 0;
  while (t < tRight && guard++ < 5000) { const xx = Math.round(x + (t - tLeft) / DAY * ppd) + 0.5; c.moveTo(xx, y); c.lineTo(xx, y + h); t = nextOf(unit, t); }
  c.stroke();
  if (today !== null && today >= tLeft && today <= tRight) {
    const xx = Math.round(x + (today - tLeft) / DAY * ppd) + 0.5;
    c.strokeStyle = T.today; c.setLineDash([4, 3]); c.beginPath(); c.moveTo(xx, y); c.lineTo(xx, y + h); c.stroke(); c.setLineDash([]);
  }
}
// G: {rows, i0, i1, X(t), Y(i), rh, T, crit, base, links, labels, rowIdx, P}
function drawBars(c, G) {
  const { rows, i0, i1, X, Y, rh, T } = G, bh = rh * (G.base ? 0.38 : 0.46), top = (i) => Y(i) + (G.base ? rh * 0.14 : (rh - bh) / 2);
  const mid = (i) => top(i) + bh / 2;
  const ends = (t) => { const a = X(t.start), b = t.milestone || t.finish === null ? a : Math.max(X(t.finish), a + 2); return [a, b]; };
  if (G.links) {
    c.lineWidth = 1; c.lineJoin = 'round';
    for (let i = 0; i < rows.length; i++) {
      const t = rows[i]; if (!t.preds.length || t.start === null) continue;
      for (const p of t.preds) {
        const j = G.rowIdx.get(p.uid); if (j === undefined) continue;
        if ((i < i0 && j < i0) || (i > i1 && j > i1)) continue;
        const q = rows[j]; if (q.start === null) continue;
        const pe = ends(q), se = ends(t), ms = rh * 0.3;
        const sx = (p.type === 1 || p.type === 0 ? pe[1] : pe[0]) + (q.milestone ? (p.type === 1 || p.type === 0 ? ms : -ms) : 0), sy = mid(j);
        const toStart = p.type === 1 || p.type === 3, ex = (toStart ? se[0] : se[1]) + (t.milestone ? (toStart ? -ms : ms) : 0), ey = mid(i);
        const critL = G.crit && t.critical && q.critical;
        c.strokeStyle = c.fillStyle = critL ? T.crit : T.link;
        const dir = toStart ? 1 : -1, outDir = (p.type === 1 || p.type === 0) ? 1 : -1, g = 7;
        const ox = sx + outDir * g, ix = ex - dir * g, ym = sy + (ey > sy ? 1 : -1) * rh / 2;
        c.beginPath(); c.moveTo(sx, sy); c.lineTo(ox, sy);
        if ((outDir === 1 && dir === 1 && ix >= ox) || (outDir === -1 && dir === -1 && ix <= ox)) { c.lineTo(ox, ey); }
        else if (outDir !== dir) { const xx = outDir === 1 ? Math.max(ox, ix) : Math.min(ox, ix); c.lineTo(xx, sy); c.lineTo(xx, ey); }
        else { c.lineTo(ox, ym); c.lineTo(ix, ym); c.lineTo(ix, ey); }
        c.lineTo(ex, ey); c.stroke();
        c.beginPath(); c.moveTo(ex, ey); c.lineTo(ex - dir * 5, ey - 3.2); c.lineTo(ex - dir * 5, ey + 3.2); c.closePath(); c.fill();
      }
    }
  }
  c.font = Math.round(rh * 0.42) + 'px system-ui, sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'left';
  for (let i = i0; i <= i1; i++) {
    const t = rows[i]; if (!t || t.start === null) continue;
    const e = ends(t), x1 = e[0], x2 = e[1], y = top(i), critical = G.crit && t.critical;
    if (G.base && t.bStart !== null && t.bFinish !== null) {
      const b1 = X(t.bStart), b2 = Math.max(X(t.bFinish), b1 + 2), by = Y(i) + rh * 0.62, bhh = rh * 0.2;
      c.fillStyle = T.base;
      if (t.milestone || (t.bDur === 0)) { c.beginPath(); c.moveTo(b1, by - 1); c.lineTo(b1 + bhh, by + bhh / 2 + 1); c.lineTo(b1, by + bhh + 3); c.lineTo(b1 - bhh, by + bhh / 2 + 1); c.closePath(); c.fill(); }
      else c.fillRect(b1, by, b2 - b1, bhh);
    }
    let labelX = x2 + 6;
    if (t.milestone) {
      const r = rh * 0.3, cy = y + bh / 2;
      c.fillStyle = critical ? T.crit : T.ms; c.beginPath(); c.moveTo(x1, cy - r); c.lineTo(x1 + r, cy); c.lineTo(x1, cy + r); c.lineTo(x1 - r, cy); c.closePath(); c.fill();
      labelX = x1 + r + 6;
      if (G.labels) { c.fillStyle = T.muted; c.fillText(D(t.start), labelX, cy + 0.5); }
      continue;
    }
    if (t.summary) {
      const sh = bh * 0.42, cap = Math.min(bh * 0.5, (x2 - x1) / 2);
      c.fillStyle = T.sum; c.fillRect(x1, y, x2 - x1, sh);
      c.beginPath(); c.moveTo(x1, y); c.lineTo(x1 + cap, y + sh); c.lineTo(x1, y + bh * 0.95); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(x2, y); c.lineTo(x2 - cap, y + sh); c.lineTo(x2, y + bh * 0.95); c.closePath(); c.fill();
      continue;
    }
    c.fillStyle = critical ? T.crit : T.bar;
    c.beginPath(); if (c.roundRect) c.roundRect(x1, y, x2 - x1, bh, Math.min(2.5, (x2 - x1) / 2)); else c.rect(x1, y, x2 - x1, bh); c.fill();
    if (t.pct > 0) { c.fillStyle = critical ? T.critProg : T.prog; c.fillRect(x1, y + bh * 0.3, (x2 - x1) * Math.min(100, t.pct) / 100, bh * 0.4); }
    if (G.labels && t.resText) { c.fillStyle = T.muted; c.fillText(t.resText, labelX, y + bh / 2 + 0.5); }
  }
}

/* ---------- rows, table, chart ---------- */
function matches(t) {
  const f = S.filter;
  if (f === 'critical' && !(t.critical && !t.summary)) return false;
  if (f === 'incomplete' && !(t.pct < 100 && !t.summary)) return false;
  if (f === 'done' && !(t.pct >= 100 && !t.summary)) return false;
  if (f === 'milestone' && !t.milestone) return false;
  if (f === 'late' && !(t.variance !== null && t.variance > 0 && !t.summary)) return false;
  if (S.search) { const q = S.search; if (t.name.toLowerCase().indexOf(q) < 0 && t.resText.toLowerCase().indexOf(q) < 0 && String(t.id) !== q) return false; }
  return true;
}
function computeRows() {
  const P = S.P, rows = [];
  if (S.filter !== 'all' || S.search) {
    const keep = new Set();
    for (const t of P.tasks) if (matches(t)) { let a = t; while (a && !keep.has(a)) { keep.add(a); a = a.parent; } }
    for (const t of P.tasks) if (keep.has(t)) rows.push(t);
  } else {
    let hide = null;
    for (const t of P.tasks) {
      if (hide !== null) { if (t.level > hide) continue; hide = null; }
      rows.push(t);
      if (t.collapsed && t.summary) hide = t.level;
    }
  }
  S.rows = rows; S.rowIdx = new Map(rows.map((t, i) => [t.uid, i]));
}
const cols = () => COLS.filter((c) => !c.base || S.base);
function cellText(t, k) {
  switch (k) {
    case 'id': return t.id; case 'dur': return t.durText; case 'start': return D(t.start); case 'finish': return D(t.finish);
    case 'pct': return t.pct + '%'; case 'bStart': return D(t.bStart); case 'bFinish': return D(t.bFinish);
    case 'var': return t.variance === null ? '' : (t.variance > 0 ? '+' : '') + t.variance + 'd'; case 'pred': return t.predText; case 'res': return t.resText;
  }
  return t.name;
}
function renderHead() {
  $('thead').innerHTML = '<div class="hr">' + cols().map((c) => `<div class="c" style="width:${c.w}px">${c.t}</div>`).join('') + '</div>';
}
function renderTable() {
  const body = $('tbody'), inner = $('tinner'), cs = cols(), W = cs.reduce((a, c) => a + c.w, 0);
  inner.style.height = S.rows.length * RH + 'px'; inner.style.width = W + 'px';
  const top = body.scrollTop, i0 = Math.max(0, Math.floor(top / RH) - 4), i1 = Math.min(S.rows.length - 1, Math.ceil((top + body.clientHeight) / RH) + 4);
  let h = '';
  for (let i = i0; i <= i1; i++) {
    const t = S.rows[i];
    let cls = 'r' + (i % 2 ? ' alt' : '') + (t.summary ? ' sum' : '') + (S.crit && t.critical && !t.summary ? ' crit' : '') + (S.sel === t ? ' sel' : '') + (t.variance > 0 ? ' late' : '');
    h += `<div class="${cls}" data-i="${i}" style="top:${i * RH}px;width:${W}px">`;
    for (const c of cs) {
      if (c.k === 'name') {
        const tg = t.summary ? `<span class="tg" data-tg="1">${t.collapsed ? '▸' : '▾'}</span>` : '<span class="tg none"></span>';
        h += `<div class="c nm" style="width:${c.w}px;padding-left:${6 + Math.max(0, t.level - S.minLevel) * 16}px" title="${esc(t.name)}">${tg}${t.milestone ? '<span class="ms">◆</span>' : ''}${esc(t.name)}</div>`;
      } else h += `<div class="c ${c.cls || ''}${c.k === 'var' && t.variance < 0 ? ' early' : ''}" style="width:${c.w}px">${esc(cellText(t, c.k))}</div>`;
    }
    h += '</div>';
  }
  inner.innerHTML = h;
  $('thead').scrollLeft = body.scrollLeft;
}
const today = () => { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); };
function sizeCanvas(cv, w, h) { const dpr = window.devicePixelRatio || 1; if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); } cv.style.width = w + 'px'; cv.style.height = h + 'px'; const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); return c; }
function renderChart() {
  if (!S.P) return;
  const sc = $('chartScroll'), W = sc.clientWidth, H = sc.clientHeight, T = th();
  const totalW = Math.max(W, Math.ceil((S.t1 - S.t0) / DAY * S.ppd));
  $('chartSpacer').style.width = totalW + 'px'; $('chartSpacer').style.height = Math.max(H, S.rows.length * RH) + 'px';
  const sl = sc.scrollLeft, st = sc.scrollTop, cv = $('chart');
  cv.style.transform = `translate(${sl}px,${st}px)`;
  const c = sizeCanvas(cv, W, H), tLeft = S.t0 + sl / S.ppd * DAY;
  c.fillStyle = T.bg; c.fillRect(0, 0, W, H);
  const i0 = Math.max(0, Math.floor(st / RH)), i1 = Math.min(S.rows.length - 1, Math.ceil((st + H) / RH));
  c.fillStyle = T.alt; for (let i = i0; i <= i1; i++) if (i % 2) c.fillRect(0, i * RH - st, W, RH);
  drawGrid(c, 0, 0, W, H, tLeft, S.ppd, T, S.P, today());
  if (S.sel && S.rowIdx.has(S.sel.uid)) { c.fillStyle = T.sel; c.fillRect(0, S.rowIdx.get(S.sel.uid) * RH - st, W, RH); }
  drawBars(c, { rows: S.rows, i0, i1, X: (t) => (t - tLeft) / DAY * S.ppd, Y: (i) => i * RH - st, rh: RH, T, crit: S.crit, base: S.base, links: S.links, labels: S.ppd >= 1.5, rowIdx: S.rowIdx, P: S.P });
  const hc = sizeCanvas($('timeHead'), $('timeHead').clientWidth || W, HH);
  drawHeader(hc, 0, 0, W, HH, tLeft, S.ppd, T, 12);
  if ($('tbody').scrollTop !== st) $('tbody').scrollTop = st;
}
let raf = false;
function refresh(table) { if (raf) return; raf = true; requestAnimationFrame(() => { raf = false; if (!S.P || S.view !== 'gantt') return; renderChart(); renderTable(); }); }
function rebuild() { computeRows(); renderHead(); refresh(); updatePdfInfo(); }

function setPpd(ppd, anchorX) {
  const sc = $('chartScroll'), ax = anchorX === undefined ? sc.clientWidth / 2 : anchorX;
  const tAt = S.t0 + (sc.scrollLeft + ax) / S.ppd * DAY;
  S.ppd = Math.max(0.05, Math.min(80, ppd));
  renderChart(); sc.scrollLeft = (tAt - S.t0) / DAY * S.ppd - ax; refresh();
}
function fitAll() { const sc = $('chartScroll'); S.ppd = Math.max(0.05, Math.min(80, (sc.clientWidth - 20) / ((S.t1 - S.t0) / DAY))); renderChart(); sc.scrollLeft = 0; refresh(); }
function goTo(t) { const sc = $('chartScroll'); sc.scrollLeft = Math.max(0, (t - S.t0) / DAY * S.ppd - sc.clientWidth * 0.25); refresh(); }

/* ---------- details ---------- */
function select(t, reveal) {
  S.sel = t; const el = $('details');
  if (!t) { el.hidden = true; refresh(); return; }
  const P = S.P, row = (k, v, cls) => v === '' || v === null || v === undefined ? '' : `<dt>${k}</dt><dd${cls ? ' class="' + cls + '"' : ''}>${esc(v)}</dd>`;
  const link = (l, other) => { const q = P.taskByUid.get(l.uid); return `<li>${q.id} · ${esc(q.name)} <span class="muted">(${PL.LINK[l.type]})</span></li>`; };
  let h = `<button class="x" title="Close" aria-label="Close details">×</button><h3>${esc(t.name)}</h3><p><button id="detEdit">Edit task</button> <button id="detGo">Show bar</button></p><dl>`;
  h += row('ID / WBS', t.id + (t.wbs ? '  ·  ' + t.wbs : '')) + row('Type', t.summary ? 'Summary task' : t.milestone ? 'Milestone' : 'Task') + row('Duration', t.durText) + row('Start', D(t.start)) + row('Finish', D(t.finish)) + row('% complete', t.pct + '%');
  h += row('Critical', t.critical ? 'Yes' : 'No', t.critical ? 'bad' : '') + row('Total slack', t.slack === null ? '' : PL.fmtDur(t.slack, 7, P));
  h += row('Actual start', D(t.actualStart)) + row('Actual finish', D(t.actualFinish));
  if (t.constraint > 1 || t.constraintDate !== null && t.constraint > 0) h += row('Constraint', PL.CONSTRAINT[t.constraint] + (t.constraintDate !== null ? ' ' + D(t.constraintDate) : ''));
  h += row('Deadline', D(t.deadline)) + '</dl>';
  if (t.bStart !== null) h += '<h4>Baseline</h4><dl>' + row('Baseline start', D(t.bStart)) + row('Baseline finish', D(t.bFinish)) + row('Finish variance', t.variance === null ? '' : (t.variance > 0 ? '+' : '') + t.variance + ' calendar days', t.variance > 0 ? 'bad' : '') + '</dl>';
  if (t.res.length) h += '<h4>Resources</h4><ul>' + t.res.map((a) => `<li>${esc(a.res.name)}${a.res.type === 'Work' ? ' <span class="muted">' + Math.round(a.units * 100) + '%' + (a.work ? ', ' + Math.round(a.work / 6) / 10 + ' h' : '') + '</span>' : ''}</li>`).join('') + '</ul>';
  if (t.preds.length) h += '<h4>Predecessors</h4><ul>' + t.preds.map(link).join('') + '</ul>';
  if (t.succs.length) h += '<h4>Successors</h4><ul>' + t.succs.map(link).join('') + '</ul>';
  if (t.notes) h += '<h4>Notes</h4><div class="notes">' + esc(t.notes) + '</div>';
  el.innerHTML = h; el.hidden = false; el.scrollTop = 0;
  el.querySelector('.x').onclick = () => select(null);
  $('detEdit').onclick = () => window.PLAN.editTask && window.PLAN.editTask(); $('detGo').onclick = () => { if (t.start !== null) goTo(t.start); };
  if (reveal && t.start !== null) goTo(t.start);
  refresh();
}

/* ---------- resources view ---------- */
const hrs = (m) => m === null || m === undefined ? '' : (Math.round(m / 6) / 10).toLocaleString('en-US') + ' h';
const money = (v) => v ? (S.P.currency || '') + v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '';
function renderRes() {
  const P = S.P;
  if (!P.resources.length) { $('resList').innerHTML = '<p class="muted" style="padding:14px">This project has no resources.</p>'; $('resAsg').innerHTML = ''; return; }
  let h = '<table class="grid"><thead><tr><th class="n">ID</th><th>Resource</th><th>Type</th><th>Group</th><th class="n">Max units</th><th class="n">Work</th><th class="n">Cost</th><th class="n">Tasks</th></tr></thead><tbody>';
  for (const r of P.resources) h += `<tr data-uid="${r.uid}"${S.selRes === r ? ' class="sel"' : ''}><td class="n">${r.id}</td><td>${esc(r.name)}</td><td>${r.type}</td><td>${esc(r.group)}</td><td class="n">${r.type === 'Work' ? Math.round(r.maxUnits * 100) + '%' : ''}</td><td class="n">${hrs(r.work)}</td><td class="n">${money(r.cost)}</td><td class="n">${r.asg.length}</td></tr>`;
  $('resList').innerHTML = h + '</tbody></table>';
  const r = S.selRes;
  if (!r) { $('resAsg').innerHTML = '<p class="muted">Select a resource to see its assignments.</p>'; return; }
  let a = `<h3>${esc(r.name)}</h3><table class="grid"><thead><tr><th class="n">ID</th><th>Task</th><th>Start</th><th>Finish</th><th class="n">Units</th><th class="n">Work</th></tr></thead><tbody>`;
  for (const x of r.asg.slice().sort((p, q) => (p.task.start || 0) - (q.task.start || 0))) a += `<tr data-task="${x.task.uid}"><td class="n">${x.task.id}</td><td>${esc(x.task.name)}</td><td>${D(x.start !== null ? x.start : x.task.start)}</td><td>${D(x.finish !== null ? x.finish : x.task.finish)}</td><td class="n">${r.type === 'Work' ? Math.round(x.units * 100) + '%' : ''}</td><td class="n">${hrs(x.work)}</td></tr>`;
  $('resAsg').innerHTML = a + '</tbody></table>' + (r.asg.length ? '' : '<p class="muted">No assignments.</p>');
}
$('resList').onclick = (e) => { const tr = e.target.closest('tr[data-uid]'); if (!tr) return; S.selRes = S.P.resByUid.get(+tr.dataset.uid); renderRes(); };
$('resAsg').onclick = (e) => { const tr = e.target.closest('tr[data-task]'); if (!tr) return; const t = S.P.taskByUid.get(+tr.dataset.task); setView('gantt'); S.filter = 'all'; $('selFilter').value = 'all'; S.search = ''; $('search').value = ''; let a = t.parent; while (a) { a.collapsed = false; a = a.parent; } rebuild(); const i = S.rowIdx.get(t.uid); $('chartScroll').scrollTop = Math.max(0, i * RH - 100); select(t, true); };
function setView(v) {
  S.view = v; document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  $('ganttView').hidden = v !== 'gantt'; $('resView').hidden = v !== 'res'; $('ganttTools').style.visibility = v === 'gantt' ? '' : 'hidden';
  if (!S.P) return; if (v === 'res') renderRes(); else refresh();
}

/* ---------- PDF / print ---------- */
const SIZES = { A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189] };
function clip(c, s, w) { if (c.measureText(s).width <= w) return s; let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (c.measureText(s.slice(0, m) + '…').width <= w) lo = m; else hi = m - 1; } return lo ? s.slice(0, lo) + '…' : ''; }
function printPlan(size, ori, mode) {
  const mm = SIZES[size], wmm = ori === 'l' ? mm[1] : mm[0], hmm = ori === 'l' ? mm[0] : mm[1], Wp = wmm * 96 / 25.4, Hp = hmm * 96 / 25.4;
  const M = 30, titleH = 46, headH = 34, footH = 28, rh = 18, P = S.P;
  let pc = [{ k: 'id', t: 'ID', w: 34, a: 'r' }, { k: 'name', t: 'Task name', w: Wp < 900 ? 190 : Wp < 1300 ? 250 : 320 }, { k: 'dur', t: 'Duration', w: 62, a: 'r' }, { k: 'start', t: 'Start', w: 80 }, { k: 'finish', t: 'Finish', w: 80 }, { k: 'pct', t: '%', w: 38, a: 'r' }];
  if (S.base) pc.push({ k: 'bFinish', t: 'Baseline fin.', w: 80 }, { k: 'var', t: 'Var.', w: 40, a: 'r' });
  const tw = pc.reduce((a, c) => a + c.w, 0), cx = M + tw, cw = Wp - M - cx, bodyY = M + titleH + headH, bodyH = Hp - bodyY - M - footH;
  const perPage = Math.max(1, Math.floor(bodyH / rh)), rowPages = Math.max(1, Math.ceil(S.rows.length / perPage));
  const span = P.max - P.min, ta = floorTo('day', P.min - Math.max(DAY, span * 0.02)), tb = P.max + Math.max(DAY * 2, span * 0.14);
  let ppd = cw / ((tb - ta) / DAY), timePages = 1;
  if (mode === 'view') { ppd = S.ppd; timePages = Math.max(1, Math.ceil(((tb - ta) / DAY * ppd) / cw)); }
  return { wmm, hmm, Wp, Hp, M, titleH, headH, footH, rh, pc, tw, cx, cw, bodyY, perPage, rowPages, timePages, ta, ppd, pages: rowPages * timePages };
}
function drawPage(L, rp, tp) {
  const P = S.P, T = THEMES.light, k = Math.min(3, Math.sqrt(18e6 / (L.Wp * L.Hp)));
  const cv = document.createElement('canvas'); cv.width = Math.round(L.Wp * k); cv.height = Math.round(L.Hp * k);
  const c = cv.getContext('2d'); c.scale(k, k);
  c.fillStyle = '#fff'; c.fillRect(0, 0, L.Wp, L.Hp);
  const r0 = rp * L.perPage, r1 = Math.min(S.rows.length, r0 + L.perPage) - 1, n = r1 - r0 + 1, M = L.M;
  const tLeft = L.ta + tp * L.cw / L.ppd * DAY, bodyH = n * L.rh;
  c.fillStyle = T.text; c.textBaseline = 'alphabetic'; c.textAlign = 'left'; c.font = '700 17px system-ui, sans-serif';
  c.fillText(clip(c, P.name || S.name, L.Wp - 2 * M - 260), M, M + 18);
  c.font = '11px system-ui, sans-serif'; c.fillStyle = T.muted;
  const flt = $('selFilter').selectedOptions[0].textContent + (S.search ? ' · "' + S.search + '"' : '');
  c.fillText(`${D(P.start)} – ${D(P.finish)}   ·   ${P.pct}% complete   ·   ${flt}   ·   ${S.name}`, M, M + 35);
  c.textAlign = 'right'; c.fillText('Printed ' + D(today()), L.Wp - M, M + 18);
  // table
  c.fillStyle = T.head; c.fillRect(M, M + L.titleH, L.tw, L.headH);
  c.font = '600 10.5px system-ui, sans-serif'; c.textBaseline = 'middle';
  let x = M;
  for (const col of L.pc) { c.fillStyle = T.muted; c.textAlign = col.a === 'r' ? 'right' : 'left'; c.fillText(col.t, col.a === 'r' ? x + col.w - 5 : x + 5, M + L.titleH + L.headH * 0.72); x += col.w; }
  for (let i = r0; i <= r1; i++) {
    const t = S.rows[i], y = L.bodyY + (i - r0) * L.rh;
    if (i % 2) { c.fillStyle = T.alt; c.fillRect(M, y, L.Wp - 2 * M, L.rh); }
    x = M;
    for (const col of L.pc) {
      let s = String(cellText(t, col.k)), px = x + 5, w = col.w - 10;
      c.font = (t.summary && col.k === 'name' ? '700 ' : '') + '10.5px system-ui, sans-serif';
      c.fillStyle = col.k === 'var' && t.variance > 0 ? T.crit : col.k === 'name' && S.crit && t.critical && !t.summary ? T.crit : col.k === 'id' ? T.muted : T.text;
      if (col.k === 'name') { const ind = Math.max(0, t.level - S.minLevel) * 10; px += ind; w -= ind; }
      c.textAlign = col.a === 'r' ? 'right' : 'left';
      c.fillText(clip(c, s, w), col.a === 'r' ? x + col.w - 5 : px, y + L.rh / 2 + 0.5);
      x += col.w;
    }
  }
  // chart
  drawHeader(c, L.cx, M + L.titleH, L.cw, L.headH, tLeft, L.ppd, T, 10.5);
  c.save(); c.beginPath(); c.rect(L.cx, L.bodyY, L.cw, bodyH); c.clip();
  drawGrid(c, L.cx, L.bodyY, L.cw, bodyH, tLeft, L.ppd, T, P, today());
  c.fillStyle = 'rgba(120,130,145,0.07)'; for (let i = r0; i <= r1; i++) if (i % 2) c.fillRect(L.cx, L.bodyY + (i - r0) * L.rh, L.cw, L.rh);
  drawBars(c, { rows: S.rows, i0: r0, i1: r1, X: (t) => L.cx + (t - tLeft) / DAY * L.ppd, Y: (i) => L.bodyY + (i - r0) * L.rh, rh: L.rh, T, crit: S.crit, base: S.base, links: S.links, labels: true, rowIdx: S.rowIdx, P });
  c.restore();
  c.strokeStyle = T.line; c.lineWidth = 1; c.strokeRect(M + 0.5, M + L.titleH + 0.5, L.Wp - 2 * M - 1, L.headH + bodyH);
  c.beginPath(); c.moveTo(L.cx + 0.5, M + L.titleH); c.lineTo(L.cx + 0.5, L.bodyY + bodyH); c.moveTo(M, L.bodyY + 0.5); c.lineTo(L.Wp - M, L.bodyY + 0.5); c.stroke();
  // legend + page number
  const fy = L.Hp - M - 9; let lx = M; c.font = '10.5px system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
  const leg = (draw, label) => { draw(lx, fy); c.fillStyle = T.muted; c.fillText(label, lx + 30, fy + 0.5); lx += 42 + c.measureText(label).width; };
  leg((a, b) => { c.fillStyle = T.bar; c.fillRect(a, b - 4, 24, 8); c.fillStyle = T.prog; c.fillRect(a, b - 1.5, 12, 3); }, 'Task / progress');
  if (S.crit) leg((a, b) => { c.fillStyle = T.crit; c.fillRect(a, b - 4, 24, 8); }, 'Critical');
  leg((a, b) => { c.fillStyle = T.sum; c.fillRect(a, b - 4, 24, 4); }, 'Summary');
  leg((a, b) => { c.fillStyle = T.ms; c.beginPath(); c.moveTo(a + 12, b - 6); c.lineTo(a + 18, b); c.lineTo(a + 12, b + 6); c.lineTo(a + 6, b); c.closePath(); c.fill(); }, 'Milestone');
  if (S.base) leg((a, b) => { c.fillStyle = T.base; c.fillRect(a, b - 2, 24, 4); }, 'Baseline');
  c.fillStyle = T.muted; c.textAlign = 'right'; c.fillText(`PlanLite Viewer   ·   Page ${rp * L.timePages + tp + 1} of ${L.pages}`, L.Wp - M, fy + 0.5);
  return cv;
}
let pageStyle = null;
function buildPrint(size, ori, mode) {
  const L = printPlan(size, ori, mode), root = $('printRoot'); root.textContent = '';
  if (L.pages > 60) throw new Error('That would be ' + L.pages + ' pages. Choose a larger paper size, "Whole project on page width", or filter the tasks.');
  for (let rp = 0; rp < L.rowPages; rp++) for (let tp = 0; tp < L.timePages; tp++) { const img = new Image(); img.src = drawPage(L, rp, tp).toDataURL('image/png'); img.alt = 'Page ' + (rp * L.timePages + tp + 1); root.append(img); }
  if (!pageStyle) { pageStyle = document.createElement('style'); document.head.append(pageStyle); }
  pageStyle.textContent = `@page { size: ${L.wmm}mm ${L.hmm}mm; margin: 0; } @media print { #printRoot img { width: ${L.wmm}mm !important; height: ${L.hmm - 0.4}mm !important; } }`;
  return L;
}
function updatePdfInfo() { if (!S.P) return; const L = printPlan($('pdfSize').value, $('pdfOri').value, $('pdfScale').value); $('pdfInfo').textContent = `${S.rows.length} tasks shown → ${L.pages} page${L.pages === 1 ? '' : 's'} of ${$('pdfSize').value} ${$('pdfOri').value === 'l' ? 'landscape' : 'portrait'}.`; }
['pdfSize', 'pdfOri', 'pdfScale'].forEach((id) => { $(id).onchange = updatePdfInfo; });
$('btnPdf').onclick = () => { if (!S.P) { toast('Open a project first.'); return; } if (S.view !== 'gantt') setView('gantt'); updatePdfInfo(); $('dlgPdf').showModal(); };
$('pdfGo').onclick = async () => {
  $('dlgPdf').close(); busy('Preparing pages…'); await paint();
  try { buildPrint($('pdfSize').value, $('pdfOri').value, $('pdfScale').value); await Promise.all([...$('printRoot').querySelectorAll('img')].map((i) => i.decode().catch(() => {}))); busy(''); window.print(); }
  catch (err) { busy(''); toast(err.message || String(err), true); }
};
window.addEventListener('afterprint', () => { $('printRoot').textContent = ''; });

/* ---------- Excel ---------- */
async function saveBlob(name, blob) {
  if (window.showSaveFilePicker) {
    try { const h = await window.showSaveFilePicker({ suggestedName: name }); const w = await h.createWritable(); await w.write(blob); await w.close(); toast('Saved ' + h.name); return; }
    catch (err) { if (err && err.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); toast('Saved ' + name + ' to your Downloads folder');
}
function workbook() {
  const P = S.P, d = (v) => ({ d: v }), h = (m) => m === null || m === undefined ? '' : Math.round(m / 6) / 10;
  const tasks = [['ID', 'WBS', 'Task name', 'Outline level', 'Type', 'Duration', 'Start', 'Finish', '% complete', 'Critical', 'Total slack (days)', 'Predecessors', 'Resources', 'Baseline start', 'Baseline finish', 'Finish variance (days)', 'Work (h)', 'Cost', 'Notes']];
  for (const t of P.tasks) tasks.push([t.id, t.wbs, { v: t.name, indent: Math.max(0, t.level - S.minLevel), bold: t.summary }, t.level, t.summary ? 'Summary' : t.milestone ? 'Milestone' : 'Task', t.durText, d(t.start), d(t.finish), t.pct, t.critical ? 'Yes' : 'No',
    t.slack === null ? '' : Math.round(t.slack / P.minPerDay * 100) / 100, t.predText, t.resText, d(t.bStart), d(t.bFinish), t.variance === null ? '' : t.variance, h(t.work), t.cost || '', t.notes]);
  const res = [['ID', 'Resource', 'Type', 'Group', 'Max units %', 'Work (h)', 'Cost', 'Assignments']];
  for (const r of P.resources) res.push([r.id, r.name, r.type, r.group, r.type === 'Work' ? Math.round(r.maxUnits * 100) : '', h(r.work), r.cost || '', r.asg.length]);
  const asg = [['Resource', 'Task ID', 'Task name', 'Start', 'Finish', 'Units %', 'Work (h)', 'Cost']];
  for (const a of P.assignments) asg.push([a.res.name, a.task.id, a.task.name, d(a.start !== null ? a.start : a.task.start), d(a.finish !== null ? a.finish : a.task.finish), Math.round(a.units * 100), h(a.work), a.cost || '']);
  return PL.xlsx([{ name: 'Tasks', widths: [6, 10, 48, 8, 11, 11, 13, 13, 9, 8, 10, 16, 30, 13, 13, 10, 10, 12, 40], rows: tasks },
    { name: 'Resources', widths: [6, 30, 10, 18, 10, 10, 12, 12], rows: res }, { name: 'Assignments', widths: [28, 8, 48, 13, 13, 9, 10, 12], rows: asg }]);
}
$('btnXlsx').onclick = () => { if (!S.P) { toast('Open a project first.'); return; } saveBlob(S.name.replace(/\.[^.]+$/, '') + '.xlsx', workbook()); };

/* ---------- opening ---------- */
async function errText(res) { try { const j = await res.json(); return j.error || res.statusText; } catch (e) { return res.statusText; } }
function decode(u8) {
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8);
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8);
  return new TextDecoder('utf-8').decode(u8);
}
function looksXml(u8) { let i = 0; if (u8[0] === 0xef && u8[1] === 0xbb) i = 3; if ((u8[0] === 0xff && u8[1] === 0xfe) || (u8[0] === 0xfe && u8[1] === 0xff)) return true; while (i < u8.length && (u8[i] === 32 || u8[i] === 9 || u8[i] === 10 || u8[i] === 13)) i++; return u8[i] === 0x3c; }
function renderSummary() {
  const P = S.P, nt = P.tasks.filter((t) => !t.summary).length, nc = P.tasks.filter((t) => t.critical && !t.summary).length;
  $('summary').innerHTML = `<span class="nm">${esc(P.name || S.name)}</span><span><span class="k">Start</span><b>${D(P.start)}</b></span><span><span class="k">Finish</span><b>${D(P.finish)}</b></span><span><span class="k">Complete</span><b>${P.pct}%</b></span><span><span class="k">Tasks</span><b>${nt}</b></span>` +
    (P.hasCritical ? `<span><span class="k">Critical</span><b>${nc}</b></span>` : '') + (P.status !== null ? `<span><span class="k">Status date</span><b>${D(P.status)}</b></span>` : '') + `<span class="muted">${esc(S.name)}${S.dirty ? ' · edited, not saved' : ''}</span>`;
  $('summary').hidden = false;
  document.title = (S.dirty ? '• ' : '') + S.name + ' – PlanLite Viewer';
  $('btnCrit').disabled = !P.hasCritical; $('btnBase').disabled = !P.hasBaseline;
  if (!P.hasBaseline && S.base) { S.base = false; $('btnBase').classList.remove('on'); }
  $('btnCrit').title = P.hasCritical ? 'Highlight the critical path' : 'This file has no critical-path information'; $('btnBase').title = P.hasBaseline ? 'Show the saved baseline under each bar and variance columns' : 'This file has no saved baseline';
  let lv = '<option value="0">All levels</option>'; for (let l = Math.max(1, S.minLevel); l <= P.maxLevel; l++) lv += `<option value="${l}">Level ${l}</option>`;
  if ($('selLevel').innerHTML !== lv) $('selLevel').innerHTML = lv;
}
function setRange(grow) {
  const P = S.P, pad = Math.max(3 * DAY, (P.max - P.min) * 0.03), a = floorTo('week', P.min - pad), b = P.max + pad * 4;
  S.t0 = grow ? Math.min(S.t0, a) : a; S.t1 = grow ? Math.max(S.t1, b) : b;
}
function showProject(P, name, srcXml) {
  S.P = P; S.name = name; S.srcXml = srcXml || null; S.sel = null; S.selRes = null; S.retry = null; S.dirty = false;
  S.minLevel = P.tasks.reduce((m, t) => Math.min(m, t.level), 99);
  S.crit = P.hasCritical; S.base = false; S.filter = 'all'; S.search = ''; S.level = 0;
  $('btnCrit').classList.toggle('on', S.crit); $('btnBase').classList.remove('on');
  $('selFilter').value = 'all'; $('search').value = '';
  setRange(false); renderSummary();
  $('welcome').hidden = true; $('details').hidden = true;
  setView('gantt'); computeRows(); renderHead(); $('chartScroll').scrollTop = 0; $('selScale').value = 'fit'; fitAll(); updatePdfInfo();
  if (window.PLAN.onProject) window.PLAN.onProject();
}
async function openBytes(name, u8) {
  try {
    let text = looksXml(u8) ? decode(u8) : null;
    if (!text || !PL.isMspdi(text)) {
      if (!S.server) throw new Error('This file type needs the PlanLite app (start it from the menu or run "planlite"). This page alone reads Project XML only.');
      busy('Reading ' + name + '…'); await paint();
      const res = await fetch(api('toxml?name=' + encodeURIComponent(name)), { method: 'POST', body: u8 });
      if (!res.ok) throw new Error(await errText(res));
      text = decode(new Uint8Array(await res.arrayBuffer()));
    }
    busy('Building schedule…'); await paint();
    const P = PL.parse(text);
    if (!P.tasks.length) throw new Error('The file contains no tasks.');
    showProject(P, name, text);
    busy('');
    if (!P.hasCritical) toast('No critical-path flags in this file. They are calculated as soon as you edit something.');
  } catch (err) {
    busy(''); console.error(err);
    if (/not set up yet/.test(String(err.message))) { S.retry = { name, u8 }; $('welcome').hidden = false; $('engGo').hidden = false; $('engNote').textContent = name + ' needs MPP support, a one-time download.'; return; }
    toast('Could not open ' + name + ': ' + (err.message || err), true);
  }
}
async function openFile(f) { if (!f) return; busy('Loading…'); await paint(); openBytes(f.name, new Uint8Array(await f.arrayBuffer())); }
$('file').addEventListener('change', (e) => { openFile(e.target.files[0]); e.target.value = ''; });
$('btnOpen').onclick = $('btnOpen2').onclick = () => $('file').click();
const mainEl = document.querySelector('main');
mainEl.addEventListener('dragover', (e) => { e.preventDefault(); mainEl.classList.add('drag'); });
mainEl.addEventListener('dragleave', () => mainEl.classList.remove('drag'));
mainEl.addEventListener('drop', (e) => { e.preventDefault(); mainEl.classList.remove('drag'); openFile(e.dataTransfer.files[0]); });

/* ---------- engine setup ---------- */
async function refreshInfo() { if (!S.server) return; try { S.info = await (await fetch(api('info'))).json(); } catch (e) { S.server = false; } }
function noteEngine() {
  const ok = S.info && S.info.engine;
  $('engGo').hidden = !S.server || ok;
  if (!S.retry) $('engNote').textContent = !S.server ? 'Running without the PlanLite app: Project XML files only.' : ok ? 'MPP support is ready.' : 'Project XML opens straight away. .mpp files need a one-time setup (about 60–100 MB: the open-source MPXJ reader and a Java runtime).';
}
let engTimer = null;
$('engGo').onclick = async () => {
  $('engGo').disabled = true;
  try { await fetch(api('engine'), { method: 'POST' }); } catch (e) { /* polled below */ }
  clearInterval(engTimer);
  engTimer = setInterval(async () => {
    let st; try { st = await (await fetch(api('engine'))).json(); } catch (e) { return; }
    $('engMsg').textContent = st.msg + (st.state === 'running' && st.pct ? ' – ' + st.pct + '%' : '');
    if (st.state === 'running') return;
    clearInterval(engTimer); $('engGo').disabled = false; await refreshInfo();
    const r = S.retry; S.retry = null; noteEngine();
    if (S.info && S.info.engine) { $('engMsg').textContent = ''; if (r) openBytes(r.name, r.u8); else toast('MPP support is ready.'); }
  }, 700);
};

/* ---------- wiring ---------- */
const sc = $('chartScroll'), tb = $('tbody');
sc.addEventListener('scroll', () => refresh());
tb.addEventListener('scroll', () => { $('thead').scrollLeft = tb.scrollLeft; });
tb.addEventListener('wheel', (e) => { if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; e.preventDefault(); sc.scrollTop += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY; }, { passive: false });
sc.addEventListener('wheel', (e) => { if (!e.ctrlKey || !S.P) return; e.preventDefault(); $('selScale').value = ''; setPpd(S.ppd * Math.exp(-e.deltaY * 0.002), e.clientX - sc.getBoundingClientRect().left); }, { passive: false });
$('tinner').addEventListener('click', (e) => {
  const r = e.target.closest('.r'); if (!r) return; const t = S.rows[+r.dataset.i];
  if (e.target.dataset.tg && t.summary) { t.collapsed = !t.collapsed; $('selLevel').value = '0'; rebuild(); return; }
  select(t);
});
$('tinner').addEventListener('dblclick', (e) => { const r = e.target.closest('.r'); if (r && !e.target.dataset.tg) { select(S.rows[+r.dataset.i]); if (window.PLAN.editTask) window.PLAN.editTask(); } });
$('chart').addEventListener('click', (e) => { if (!S.P) return; const i = Math.floor((e.offsetY + sc.scrollTop) / RH); if (S.rows[i]) select(S.rows[i]); });
$('chart').addEventListener('dblclick', (e) => { if (!S.P) return; const i = Math.floor((e.offsetY + sc.scrollTop) / RH); if (S.rows[i]) { select(S.rows[i]); if (window.PLAN.editTask) window.PLAN.editTask(); } });
let dragSplit = null;
$('split').addEventListener('pointerdown', (e) => { dragSplit = { x: e.clientX, w: $('left').getBoundingClientRect().width }; $('split').setPointerCapture(e.pointerId); });
$('split').addEventListener('pointermove', (e) => { if (!dragSplit) return; $('left').style.width = Math.max(160, Math.min(window.innerWidth - 200, dragSplit.w + e.clientX - dragSplit.x)) + 'px'; refresh(); });
$('split').addEventListener('pointerup', () => { dragSplit = null; });
document.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => setView(b.dataset.view); });
$('btnCrit').onclick = () => { S.crit = !S.crit; $('btnCrit').classList.toggle('on', S.crit); refresh(); };
$('btnBase').onclick = () => { S.base = !S.base; $('btnBase').classList.toggle('on', S.base); renderHead(); refresh(); updatePdfInfo(); };
$('btnLinks').onclick = () => { S.links = !S.links; $('btnLinks').classList.toggle('on', S.links); refresh(); };
$('zoomIn').onclick = () => { if (S.P) { $('selScale').value = ''; setPpd(S.ppd * 1.4); } };
$('zoomOut').onclick = () => { if (S.P) { $('selScale').value = ''; setPpd(S.ppd / 1.4); } };
$('selScale').onchange = (e) => { if (!S.P) return; if (e.target.value === 'fit') fitAll(); else setPpd(+e.target.value); };
$('btnToday').onclick = () => { if (S.P) goTo(today()); };
$('selFilter').onchange = (e) => { S.filter = e.target.value; sc.scrollTop = 0; rebuild(); };
$('search').oninput = (e) => { S.search = e.target.value.trim().toLowerCase(); sc.scrollTop = 0; if (S.P) rebuild(); };
$('selLevel').onchange = (e) => { const l = +e.target.value; for (const t of S.P.tasks) t.collapsed = l > 0 && t.summary && t.level >= l; sc.scrollTop = 0; rebuild(); };
$('btnTheme').onclick = () => { S.dark = !S.dark; document.body.classList.toggle('light', !S.dark); document.body.classList.toggle('dark', S.dark); $('btnTheme').textContent = S.dark ? 'Light' : 'Dark'; refresh(); };
new ResizeObserver(() => refresh()).observe($('right'));
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); $('file').click(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') { e.preventDefault(); $('btnPdf').click(); return; }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA' || document.querySelector('dialog[open]') || e.ctrlKey || e.metaKey || e.altKey || !S.P) return;
  if (e.key === '+' || e.key === '=') $('zoomIn').click(); else if (e.key === '-') $('zoomOut').click();
  else if (e.key.toLowerCase() === 't') $('btnToday').click(); else if (e.key.toLowerCase() === 'f') { $('selScale').value = 'fit'; fitAll(); }
  else if (e.key === 'Escape') select(null);
});
(async function init() {
  await refreshInfo(); noteEngine();
  if (!S.server) return;
  setInterval(() => { fetch(api('ping'), { method: 'POST' }).catch(() => {}); }, 10000);
  if (S.info && S.info.initial) {
    busy('Loading ' + S.info.initial + '…'); await paint();
    try { const res = await fetch(api('initial')); if (!res.ok) throw new Error(await errText(res)); await openBytes(S.info.initial, new Uint8Array(await res.arrayBuffer())); }
    catch (err) { busy(''); toast('Could not open ' + S.info.initial + ': ' + (err.message || err), true); }
  }
})();
Object.assign(window.PLAN, { S, openBytes, buildPrint, printPlan, workbook, select, setView, showProject, renderSummary, setRange, rebuild, refresh, toast, busy, saveBlob, renderRes, fitAll, goTo, esc, $ });
})();
