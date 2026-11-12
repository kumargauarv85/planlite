/* PlanLite – working-time calendar and critical-path scheduler (forward and backward pass). */
(function () {
'use strict';
const root = typeof window !== 'undefined' ? window : globalThis, PL = root.PL, DAY = 86400000;

function Calendar(P, from) {
  const blocks = P.blocks && P.blocks.length ? P.blocks : (P.minPerDay === 480 ? [[480, 720], [780, 1020]] : [[480, Math.min(1440, 480 + P.minPerDay)]]);
  const mpd = blocks.reduce((a, b) => a + b[1] - b[0], 0) || 480;
  const hol = new Set();
  for (const h of P.holidays) for (let d = Math.floor(h[0] / DAY) * DAY; d <= h[1]; d += DAY) hol.add(d);
  const origin = Math.floor(from / DAY) * DAY, days = [];
  let cursor = origin;
  const anyWork = P.workDays.some(Boolean);
  const isWork = (d) => (!anyWork || P.workDays[new Date(d).getUTCDay()]) && !hol.has(d);
  const grow = (pred) => { let guard = 0; while (!pred() && guard++ < 40000) { if (isWork(cursor)) days.push(cursor); cursor += DAY; } };
  const idxOf = (d) => { // first working day >= d
    grow(() => days.length && days[days.length - 1] >= d);
    let lo = 0, hi = days.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (days[m] >= d) hi = m; else lo = m + 1; }
    return lo;
  };
  function t2w(ms) {
    const d = Math.floor(ms / DAY) * DAY;
    if (d < origin) return 0;
    const i = idxOf(d);
    if (days[i] !== d) return i * mpd;
    const clock = (ms - d) / 60000; let m = 0;
    for (const b of blocks) { if (clock >= b[1]) m += b[1] - b[0]; else if (clock > b[0]) { m += clock - b[0]; break; } else break; }
    return i * mpd + m;
  }
  function w2t(w, asFinish) {
    if (w < 0) w = 0;
    let i = Math.floor(w / mpd + 1e-9), m = w - i * mpd;
    if (m < 1e-6) m = 0;
    if (asFinish && m === 0 && i > 0) { i -= 1; m = mpd; }
    grow(() => days.length > i);
    let clock = blocks[blocks.length - 1][1];
    for (const b of blocks) { const len = b[1] - b[0]; if (m < len || (m === len && asFinish)) { clock = b[0] + m; break; } m -= len; }
    return days[i] + Math.round(clock * 60000);
  }
  return { t2w, w2t, mpd, blocks };
}

const lagMin = (l, q, cal, P) => (l.lagFmt === 19 || l.lagFmt === 20) ? (q.dur || 0) * l.lag / 100 : (l.lag / 10) * ((l.lagFmt % 2 === 0 && l.lagFmt >= 4 && l.lagFmt <= 12) ? cal.mpd / 1440 : 1);
const pinned = (t) => t.pin || t.manual || t.actualStart !== null || t.pct > 0;

function network(P) {
  const leaves = P.tasks.filter((t) => !t.summary), kidsOf = new Map();
  for (const t of P.tasks) if (t.summary) kidsOf.set(t.uid, []);
  for (const t of leaves) { let a = t.parent; while (a) { kidsOf.get(a.uid).push(t); a = a.parent; } }
  const isAnc = (a, t) => { let p = t.parent; while (p) { if (p === a) return true; p = p.parent; } return false; };
  const inc = new Map(leaves.map((t) => [t.uid, []])), out = new Map(leaves.map((t) => [t.uid, []]));
  for (const t of P.tasks) {
    if (!t.preds.length) continue;
    const targets = t.summary ? kidsOf.get(t.uid) : [t];
    for (const l of t.preds) {
      const q = P.taskByUid.get(l.uid);
      if (!q || q === t || isAnc(q, t) || isAnc(t, q)) continue;
      const srcs = q.summary ? kidsOf.get(q.uid) : [q];
      if (t.summary && (l.type === 0 || l.type === 2)) continue;
      for (const s of targets) { inc.get(s.uid).push({ l, q, srcs }); for (const r of srcs) out.get(r.uid).push({ l, to: s, q }); }
    }
  }
  // topological order (Kahn)
  const deg = new Map(leaves.map((t) => [t.uid, 0])), adj = new Map(leaves.map((t) => [t.uid, new Set()]));
  for (const t of leaves) for (const e of inc.get(t.uid)) for (const r of e.srcs) if (!adj.get(r.uid).has(t.uid)) { adj.get(r.uid).add(t.uid); deg.set(t.uid, deg.get(t.uid) + 1); }
  const order = [], queue = leaves.filter((t) => deg.get(t.uid) === 0);
  while (queue.length) { const t = queue.shift(); order.push(t); for (const u of adj.get(t.uid)) { deg.set(u, deg.get(u) - 1); if (deg.get(u) === 0) queue.push(P.taskByUid.get(u)); } }
  if (order.length !== leaves.length) { const bad = leaves.find((t) => deg.get(t.uid) > 0); const e = new Error('These links would create a loop (circular dependency) at task ' + bad.id + ' "' + bad.name + '".'); e.circular = true; throw e; }
  return { leaves, order, inc, out };
}
function calFor(P) {
  let lo = P.start === null ? Infinity : P.start;
  for (const t of P.tasks) for (const v of [t.start, t.bStart, t.constraintDate]) if (v !== null && v !== undefined && v < lo) lo = v;
  if (!isFinite(lo)) lo = Date.now();
  return Calendar(P, lo - 120 * DAY);
}
// earliest start of a leaf in working minutes; W gives pred positions
function early(t, N, cal, P, W, projW) {
  let base = projW, byFinish = false;
  for (const e of N.inc.get(t.uid)) {
    let qs = Infinity, qf = -Infinity;
    for (const r of e.srcs) { const w = W.get(r.uid); if (w.es < qs) qs = w.es; if (w.ef > qf) qf = w.ef; }
    if (!isFinite(qs)) continue;
    const lag = lagMin(e.l, e.q, cal, P), d = t.dur || 0, ty = e.l.type;
    const cand = ty === 1 ? qf + lag : ty === 3 ? qs + lag : ty === 0 ? qf + lag - d : qs + lag - d;
    if (cand > base || (cand === base && (ty === 1 || ty === 0))) { byFinish = ty === 1 || ty === 0; }
    if (cand > base) base = cand;
  }
  const c = t.constraint, cd = t.constraintDate, d = t.dur || 0;
  if (cd !== null) {
    const cw = cal.t2w(cd);
    if (c === 4 && cw > base) { base = cw; byFinish = false; }
    else if (c === 6 && cw - d > base) { base = cw - d; byFinish = false; }
    else if (c === 2) { base = cw; byFinish = false; }
    else if (c === 3) { base = cw - d; byFinish = false; }
  }
  return { base: Math.max(0, base), byFinish };
}
// Work out, once, the offsets that make this scheduler reproduce the dates saved in the file.
function calibrate(P) {
  const cal = calFor(P), N = network(P), W = new Map(), projW = cal.t2w(P.start);
  let pins = 0;
  for (const t of N.order) {
    if (t.start === null || t.finish === null) { t.start = t.start === null ? P.start : t.start; t.finish = t.start; t.pin = false; }
    const es = cal.t2w(t.start), ef = Math.max(es, cal.t2w(t.finish));
    const offS = Math.abs(cal.w2t(es, t.milestone && cal.w2t(es, true) === t.start) - t.start) > 90000, offF = !t.milestone && Math.abs(cal.w2t(ef, true) - t.finish) > 90000;
    W.set(t.uid, { es, ef });
    t.pin = offS || offF; if (t.pin) pins++;
    t.msEnd = t.milestone ? cal.w2t(es, true) === t.start : null;
    const b = early(t, N, cal, P, W, projW);
    t.sAdj = Math.abs(es - b.base) < 1 ? 0 : es - b.base;
    t.fAdj = Math.abs(ef - es - (t.dur || 0)) < 1 ? 0 : ef - es - (t.dur || 0);
  }
  return pins;
}
function schedule(P) {
  const cal = calFor(P), N = network(P), W = new Map(), projW = cal.t2w(P.start);
  let end = projW;
  for (const t of N.order) {
    const d = t.dur || 0; let es, byFinish = false;
    if (pinned(t) && t.start !== null) { es = cal.t2w(t.start); byFinish = t.milestone && cal.w2t(es, true) === t.start; }
    else { const b = early(t, N, cal, P, W, projW); es = Math.max(0, b.base + t.sAdj); byFinish = b.byFinish; }
    const ef = t.pin && t.finish !== null ? Math.max(es, cal.t2w(t.finish)) : Math.max(es, es + d + t.fAdj);
    W.set(t.uid, { es, ef, byFinish });
    if (ef > end) end = ef;
  }
  for (let i = N.order.length - 1; i >= 0; i--) {
    const t = N.order[i], w = W.get(t.uid), span = w.ef - w.es; let lf = end;
    for (const e of N.out.get(t.uid)) {
      const s = W.get(e.to.uid), lag = lagMin(e.l, e.q, cal, P) + (pinned(e.to) ? 0 : e.to.sAdj), ty = e.l.type;
      const lim = ty === 1 ? s.ls - lag : ty === 3 ? s.ls - lag + span : ty === 0 ? s.lf - lag : s.lf - lag + span;
      if (lim < lf) lf = lim;
    }
    if (t.constraintDate !== null) { const cw = cal.t2w(t.constraintDate); if (t.constraint === 3 || t.constraint === 7) lf = Math.min(lf, cw); else if (t.constraint === 2 || t.constraint === 5) lf = Math.min(lf, cw + span); }
    w.lf = lf; w.ls = lf - span;
    if (!(pinned(t) && t.start !== null)) t.start = cal.w2t(w.es, t.milestone && (t.msEnd === true || (t.msEnd !== false && w.byFinish)));
    if (!(t.pin && t.finish !== null)) t.finish = w.ef - w.es < 1e-6 ? t.start : cal.w2t(w.ef, true);
    t.slack = lf - w.ef; t.critical = t.slack <= 0.5 && t.pct < 100;
    if (t.pct > 0 && t.actualStart === null) t.actualStart = t.start;
    if (t.pct >= 100) t.actualFinish = t.finish; else t.actualFinish = null;
    if (t.pct <= 0) t.actualStart = null;
  }
  for (let i = P.tasks.length - 1; i >= 0; i--) {
    const t = P.tasks[i]; if (!t.summary) continue;
    let s = Infinity, f = -Infinity, wsum = 0, psum = 0, crit = false, slack = Infinity;
    for (let j = i + 1; j < P.tasks.length && P.tasks[j].level > t.level; j++) {
      const k = P.tasks[j]; if (k.summary) continue;
      if (k.start < s) s = k.start; if (k.finish > f) f = k.finish;
      const d = Math.max(k.dur || 0, 0); wsum += d; psum += d * k.pct; if (k.critical) crit = true; if (k.slack !== null && k.slack < slack) slack = k.slack;
    }
    if (!isFinite(s)) continue;
    t.start = s; t.finish = f; t.dur = Math.max(0, cal.t2w(f) - cal.t2w(s)); t.durFmt = 7;
    t.pct = wsum ? Math.round(psum / wsum) : 0; t.critical = crit; t.slack = isFinite(slack) ? slack : null; t.constraint = 0; t.constraintDate = null;
  }
  let lo = Infinity, hi = -Infinity;
  for (const t of N.leaves) { if (t.start < lo) lo = t.start; if (t.finish > hi) hi = t.finish; }
  if (isFinite(hi)) { P.finish = hi; if (lo < P.start) P.start = lo; }
  return P;
}
PL.Calendar = Calendar; PL.calibrate = calibrate; PL.schedule = schedule; PL.calFor = calFor;
})();
