/* PlanLite – Microsoft Project XML (MSPDI) reader, formatting helpers and a tiny .xlsx writer. */
(function () {
'use strict';
const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pDate(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d)(?::(\d\d))?)?/.exec(s);
  if (!m) return null;
  const t = Date.UTC(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return +m[1] < 1985 ? null : t; // MS Project writes 1984-01-01 for "NA"
}
function pDur(s) { // ISO-8601 duration -> minutes
  if (!s) return null;
  const m = /^(-)?P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/.exec(s.trim());
  if (!m) return null;
  const v = (+(m[4] || 0)) * 1440 + (+(m[5] || 0)) * 60 + (+(m[6] || 0)) + (+(m[7] || 0)) / 60;
  return m[1] ? -v : v;
}
const num = (s, d) => { const v = parseFloat(s); return isNaN(v) ? (d === undefined ? 0 : d) : v; };
function rec(el) { const o = {}; for (const c of el.children) if (!c.children.length && !(c.localName in o)) o[c.localName] = c.textContent; return o; }
const kids = (el, name) => { const r = []; if (el) for (const c of el.children) if (c.localName === name) r.push(c); return r; };
const kid = (el, name) => { if (el) for (const c of el.children) if (c.localName === name) return c; return null; };

function fmtDate(t) { if (t === null || t === undefined) return ''; const d = new Date(t); return String(d.getUTCDate()).padStart(2, '0') + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
function trimNum(v) { const s = (Math.round(v * 100) / 100).toString(); return s; }
// duration in minutes -> "5 days" using the file's own duration format code
function fmtDur(min, fmt, P) {
  if (min === null || min === undefined) return '';
  fmt = +fmt || 7;
  const est = fmt >= 35 || fmt === 21; let f = fmt;
  if (fmt === 21) f = 7; else if (fmt >= 35) f = { 35: 3, 36: 4, 37: 5, 38: 6, 39: 7, 40: 8, 41: 9, 42: 10, 43: 11, 44: 12 }[fmt] || 7;
  const elapsed = f % 2 === 0 && f >= 4 && f <= 12;
  const mpd = elapsed ? 1440 : P.minPerDay, mpw = elapsed ? 10080 : P.minPerWeek, mpm = elapsed ? 43200 : P.minPerDay * P.daysPerMonth;
  let v, u;
  if (f === 3 || f === 4) { v = min; u = 'min'; }
  else if (f === 5 || f === 6) { v = min / 60; u = 'hr'; }
  else if (f === 9 || f === 10) { v = min / mpw; u = 'wk'; }
  else if (f === 11 || f === 12) { v = min / mpm; u = 'mon'; }
  else { v = min / mpd; u = 'day'; }
  const n = trimNum(v);
  return n + ' ' + (elapsed ? 'e' : '') + u + (Math.abs(v) === 1 ? '' : 's') + (est ? '?' : '');
}
function fmtLag(lag, fmt, P) {
  if (!lag) return '';
  if (+fmt === 19 || +fmt === 20) return (lag > 0 ? '+' : '') + lag + '%';
  const s = fmtDur(Math.abs(lag) / 10, fmt, P).replace(' days', 'd').replace(' day', 'd').replace(' wks', 'w').replace(' wk', 'w').replace(' hrs', 'h').replace(' hr', 'h').replace(' mins', 'm').replace(' min', 'm').replace(' mons', 'mo').replace(' mon', 'mo').replace(' e', 'e');
  return (lag > 0 ? '+' : '-') + s;
}
const LINK = ['FF', 'FS', 'SF', 'SS'];
const CONSTRAINT = ['As Soon As Possible', 'As Late As Possible', 'Must Start On', 'Must Finish On', 'Start No Earlier Than', 'Start No Later Than', 'Finish No Earlier Than', 'Finish No Later Than'];

// Rebuild everything that follows from the task list: hierarchy, IDs, WBS, link back-references, display texts, date range.
function derive(P, renumber) {
  const stack = [], num = [];
  P.taskByUid = new Map(P.tasks.map((t) => [t.uid, t])); P.resByUid = new Map(P.resources.map((r) => [r.uid, r]));
  P.hasBaseline = false; P.hasCritical = false; P.maxLevel = 0; P.assignments = [];
  for (const r of P.resources) r.asg = [];
  const zero = P.tasks.length && P.tasks[0].level === 0 && P.tasks.slice(1).every((t) => t.level > 0);
  if (!zero) for (const t of P.tasks) if (t.level < 1) t.level = 1;
  P.tasks.forEach((t, i) => {
    const prev = stack.length ? stack[stack.length - 1] : null;
    if (prev && t.level > prev.level + 1) t.level = prev.level + 1;
    if (!prev && i === 0 && !zero && t.level > 1) t.level = 1;
    if (renumber) t.id = zero ? i : i + 1;
    t.kids = 0; t.parent = null; t.succs = [];
    while (stack.length && stack[stack.length - 1].level >= t.level) stack.pop();
    if (stack.length) { t.parent = stack[stack.length - 1]; t.parent.kids++; }
    stack.push(t);
    while (num.length > t.level) num.pop();
    while (num.length < t.level) num.push(0);
    if (t.level > 0) num[t.level - 1]++;
    if (renumber || !t.wbs) t.wbs = num.join('.') || '0';
    if (t.level > P.maxLevel) P.maxLevel = t.level;
  });
  for (const t of P.tasks) { t.summary = t.kids > 0; t.milestone = !t.summary && (t.dur === 0 || !!t.forceMs); }
  for (const t of P.tasks) {
    t.preds = t.preds.filter((p) => P.taskByUid.has(p.uid) && p.uid !== t.uid);
    for (const p of t.preds) P.taskByUid.get(p.uid).succs.push({ uid: t.uid, type: p.type, lag: p.lag, lagFmt: p.lagFmt });
    t.res = t.res.filter((a) => P.resByUid.has(a.res.uid));
    for (const a of t.res) { a.task = t; a.res = P.resByUid.get(a.res.uid); P.assignments.push(a); a.res.asg.push(a); }
    if (t.bStart !== null && t.bFinish !== null) P.hasBaseline = true;
    if (t.critical) P.hasCritical = true;
  }
  for (const t of P.tasks) {
    t.resText = t.res.map((a) => a.res.name + (a.res.type === 'Work' && Math.abs(a.units - 1) > 0.001 ? '[' + Math.round(a.units * 100) + '%]' : '')).join(', ');
    t.predText = t.preds.map((p) => { const q = P.taskByUid.get(p.uid); return q.id + (p.type === 1 ? '' : LINK[p.type]) + fmtLag(p.lag, p.lagFmt, P); }).join(', ');
    t.durText = fmtDur(t.dur, t.durFmt, P);
    t.variance = t.bFinish !== null && t.finish !== null ? Math.round((t.finish - t.bFinish) / DAY) : null;
  }
  let lo = Infinity, hi = -Infinity;
  for (const t of P.tasks) { for (const v of [t.start, t.bStart]) if (v !== null && v < lo) lo = v; for (const v of [t.finish, t.bFinish, t.deadline]) if (v !== null && v > hi) hi = v; }
  if (!isFinite(lo)) { lo = P.start || Date.UTC(new Date().getFullYear(), 0, 1); hi = P.finish || lo + 30 * DAY; }
  P.min = lo; P.max = Math.max(hi, lo + DAY);
  if (P.start === null) P.start = lo; if (P.finish === null) P.finish = hi;
  const top = zero ? P.tasks[0] : null;
  if (top) P.pct = top.pct; else { let w = 0, s2 = 0; for (const t of P.tasks) if (!t.summary) { const d = Math.max(t.dur || 0, 1); w += d; s2 += d * t.pct; } P.pct = w ? Math.round(s2 / w) : 0; }
  if (!P.name && top) P.name = top.name;
  return P;
}
function isMspdi(text) { return /<Project[\s>]/.test(text.slice(0, 4000)) && text.slice(0, 4000).indexOf('schemas.microsoft.com/project') > 0; }

function parse(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'Project' || doc.getElementsByTagName('parsererror').length) throw new Error('This is not a Microsoft Project XML file.');
  const h = rec(root);
  const P = {
    name: h.Title || h.Name || '', author: h.Author || '', company: h.Company || '', manager: h.Manager || '',
    start: pDate(h.StartDate), finish: pDate(h.FinishDate), status: pDate(h.StatusDate), current: pDate(h.CurrentDate),
    minPerDay: num(h.MinutesPerDay, 480) || 480, minPerWeek: num(h.MinutesPerWeek, 2400) || 2400, daysPerMonth: num(h.DaysPerMonth, 20) || 20,
    currency: h.CurrencySymbol || '', tasks: [], resources: [], assignments: [], taskByUid: new Map(), resByUid: new Map(),
    workDays: [false, true, true, true, true, true, false], holidays: [], hasBaseline: false, hasCritical: false, maxLevel: 0,
    blocks: null, calUid: h.CalendarUID === undefined ? null : h.CalendarUID,
  };
  // working week + holidays from the project calendar
  const cals = kids(kid(root, 'Calendars'), 'Calendar');
  let cal = cals.find((c) => rec(c).UID === h.CalendarUID) || cals.find((c) => rec(c).IsBaseCalendar === '1');
  if (cal) {
    const wd = kids(kid(cal, 'WeekDays'), 'WeekDay'); let seen = 0; const days = P.workDays.slice();
    for (const d of wd) {
      const r = rec(d), dt = +r.DayType;
      if (dt >= 1 && dt <= 7) {
        days[dt - 1] = r.DayWorking === '1'; seen++;
        if (r.DayWorking === '1' && !P.blocks) {
          const bl = [];
          for (const wt of kids(kid(d, 'WorkingTimes'), 'WorkingTime')) { const q = rec(wt), a = /^(\d+):(\d+)/.exec(q.FromTime || ''), b = /^(\d+):(\d+)/.exec(q.ToTime || ''); if (a && b) { const f = +a[1] * 60 + +a[2]; let e = +b[1] * 60 + +b[2]; if (e <= f) e = 1440; bl.push([f, e]); } }
          if (bl.length) P.blocks = bl.sort((x, y) => x[0] - y[0]);
        }
      }
      else if (dt === 0 && r.DayWorking !== '1') { const tp = kid(d, 'TimePeriod'); if (tp) { const q = rec(tp), a = pDate(q.FromDate), b = pDate(q.ToDate); if (a !== null && b !== null) P.holidays.push([a, b]); } }
    }
    if (seen && days.some(Boolean)) P.workDays = days;
    for (const ex of kids(kid(cal, 'Exceptions'), 'Exception')) {
      const r = rec(ex); if (r.DayWorking === '1') continue;
      const tp = kid(ex, 'TimePeriod'); if (!tp) continue;
      const q = rec(tp), a = pDate(q.FromDate), b = pDate(q.ToDate); if (a !== null && b !== null) P.holidays.push([a, b]);
    }
  }
  for (const el of kids(kid(root, 'Resources'), 'Resource')) {
    const r = rec(el); if (r.UID === undefined || r.IsNull === '1' || (!r.Name && r.UID === '0')) continue;
    const res = { uid: +r.UID, id: +r.ID || 0, name: r.Name || '', type: ['Material', 'Work', 'Cost'][+r.Type] || 'Work', initials: r.Initials || '', group: r.Group || '',
      maxUnits: num(r.MaxUnits, 1), rate: num(r.StandardRate, 0), work: pDur(r.Work), cost: num(r.Cost, 0), email: r.EmailAddress || '', asg: [] };
    P.resources.push(res); P.resByUid.set(res.uid, res);
  }
    for (const el of kids(kid(root, 'Tasks'), 'Task')) {
    const r = rec(el); if (r.UID === undefined || r.IsNull === '1') continue;
    const t = { uid: +r.UID, id: +r.ID || 0, name: r.Name || '', level: +r.OutlineLevel || 0, wbs: r.WBS || r.OutlineNumber || '',
      start: pDate(r.Start), finish: pDate(r.Finish), dur: pDur(r.Duration), durFmt: +r.DurationFormat || 7,
      milestone: r.Milestone === '1', forceMs: r.Milestone === '1' && pDur(r.Duration) > 0, summary: r.Summary === '1', critical: r.Critical === '1', pct: num(r.PercentComplete, 0),
      work: pDur(r.Work), cost: num(r.Cost, 0), actualStart: pDate(r.ActualStart), actualFinish: pDate(r.ActualFinish),
      constraint: +r.ConstraintType || 0, constraintDate: pDate(r.ConstraintDate), deadline: pDate(r.Deadline), notes: r.Notes || '',
      slack: r.TotalSlack === undefined ? null : num(r.TotalSlack) / 10, active: r.Active !== '0', manual: r.Manual === '1', sAdj: 0, fAdj: 0, pin: false,
      preds: [], succs: [], res: [], bStart: null, bFinish: null, bDur: null, parent: null, kids: 0, collapsed: false };
    for (const pl of kids(el, 'PredecessorLink')) { const q = rec(pl); if (q.PredecessorUID !== undefined) t.preds.push({ uid: +q.PredecessorUID, type: q.Type === undefined ? 1 : +q.Type, lag: num(q.LinkLag, 0), lagFmt: +q.LagFormat || 7 }); }
    for (const b of kids(el, 'Baseline')) { const q = rec(b); if ((+q.Number || 0) === 0) { t.bStart = pDate(q.Start); t.bFinish = pDate(q.Finish); t.bDur = pDur(q.Duration); } }
    P.tasks.push(t); P.taskByUid.set(t.uid, t);
  }
  for (const el of kids(kid(root, 'Assignments'), 'Assignment')) {
    const r = rec(el), t = P.taskByUid.get(+r.TaskUID), res = P.resByUid.get(+r.ResourceUID);
    if (!t || !res) continue;
    const a = { task: t, res, units: num(r.Units, 1), work: pDur(r.Work), cost: num(r.Cost, 0), start: pDate(r.Start), finish: pDate(r.Finish) };
    t.res.push(a);
  }
  derive(P, false);
  return P;
}

/* ---------- minimal .xlsx writer (stored zip, inline strings) ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, 0, true); h.setUint16(12, 0x21, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, 0, true); c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + data.length;
  }
  let clen = 0; for (const p of central) clen += p.length;
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, clen, true); e.setUint32(16, off, true);
  return new Blob(parts.concat(central, [new Uint8Array(e.buffer)]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const xe = (s) => String(s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function colName(i) { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }
// cell: string | number | {d: ms} date | {v, indent, bold}; first row is the header
function xlsx(sheets) {
  let xfs = '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>';
  for (let l = 0; l < 16; l++) for (let b = 0; b < 2; b++) xfs += `<xf numFmtId="0" fontId="${b}" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment indent="${l}"/></xf>`;
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd\\-mmm\\-yyyy"/></numFmts>' +
    '<fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDE3EA"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="35">${xfs}</cellXfs></styleSheet>`;
  const files = [];
  let ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
  let wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>';
  let rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
  sheets.forEach((sh, si) => {
    const out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"' + (si === 0 ? ' tabSelected="1"' : '') + '><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>'];
    sh.widths.forEach((w, i) => out.push(`<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`));
    out.push('</cols><sheetData>');
    sh.rows.forEach((row, ri) => {
      out.push(`<row r="${ri + 1}">`);
      row.forEach((c, ci) => {
        if (c === null || c === undefined || c === '') return;
        const ref = colName(ci) + (ri + 1);
        if (ri === 0) out.push(`<c r="${ref}" t="inlineStr" s="2"><is><t>${xe(c)}</t></is></c>`);
        else if (typeof c === 'number') out.push(`<c r="${ref}"><v>${c}</v></c>`);
        else if (typeof c === 'object' && c.d !== undefined) { if (c.d !== null) out.push(`<c r="${ref}" s="1"><v>${c.d / DAY + 25569}</v></c>`); }
        else if (typeof c === 'object') out.push(`<c r="${ref}" t="inlineStr" s="${3 + Math.min(15, c.indent || 0) * 2 + (c.bold ? 1 : 0)}"><is><t xml:space="preserve">${xe(c.v)}</t></is></c>`);
        else out.push(`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xe(c)}</t></is></c>`);
      });
      out.push('</row>');
    });
    out.push('</sheetData></worksheet>');
    files.push({ name: `xl/worksheets/sheet${si + 1}.xml`, text: out.join('') });
    ct += `<Override PartName="/xl/worksheets/sheet${si + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
    wb += `<sheet name="${xe(sh.name)}" sheetId="${si + 1}" r:id="rId${si + 1}"/>`;
    rels += `<Relationship Id="rId${si + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${si + 1}.xml"/>`;
  });
  rels += `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  files.unshift({ name: '[Content_Types].xml', text: ct + '</Types>' },
    { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', text: wb + '</sheets></workbook>' }, { name: 'xl/_rels/workbook.xml.rels', text: rels }, { name: 'xl/styles.xml', text: styles });
  return zip(files);
}

(typeof window !== 'undefined' ? window : globalThis).PL = { parse, derive, isMspdi, fmtDate, fmtDur, fmtLag, pDate, xlsx, DAY, MONTHS, LINK, CONSTRAINT };
})();
