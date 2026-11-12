/* PlanLite – creating and editing schedules: tasks, structure, links, resources, baseline, undo, save. */
(function () {
'use strict';
const E = window.PLAN, S = E.S, $ = E.$, DAY = PL.DAY;
const undo = [], redo = [];
const dayStart = (P) => ((P.blocks && P.blocks.length ? P.blocks[0][0] : 480) * 60000);
const dateVal = (t) => t === null ? '' : new Date(t).toISOString().slice(0, 10);
const fromDateVal = (v, P) => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(v || ''); return m ? Date.UTC(+m[1], m[2] - 1, +m[3]) + dayStart(P) : null; };

function blankTask(P, name, durMin) {
  const uid = P.tasks.reduce((m, t) => Math.max(m, t.uid), 0) + 1;
  return { uid, id: 0, name, level: 1, wbs: '', start: null, finish: null, dur: durMin, durFmt: 7, milestone: durMin === 0, forceMs: false, summary: false, critical: false, pct: 0, work: null, cost: 0,
    actualStart: null, actualFinish: null, constraint: 0, constraintDate: null, deadline: null, notes: '', slack: null, active: true, manual: false, sAdj: 0, fAdj: 0, pin: false,
    preds: [], succs: [], res: [], bStart: null, bFinish: null, bDur: null, parent: null, kids: 0, collapsed: false };
}
function resel(uid) { S.sel = uid !== null && uid !== undefined ? (S.P.taskByUid.get(uid) || null) : null; if (S.selRes) S.selRes = S.P.resByUid.get(S.selRes.uid) || null; }
function after() {
  const P = S.P;
  S.minLevel = P.tasks.reduce((m, t) => Math.min(m, t.level), 99);
  if (P.hasCritical && !S.critTouched) { S.crit = true; $('btnCrit').classList.add('on'); }
  E.setRange(true); E.renderSummary(); E.rebuild();
  if (S.sel) E.select(S.sel); else $('details').hidden = true;
  if (S.view === 'res') E.renderRes();
  $('edUndo').disabled = !undo.length; $('edRedo').disabled = !redo.length;
}
// Apply a change, reschedule, and keep an undo step. Returns false (and restores) if the change is not valid.
function commit(fn) {
  const P0 = S.P; if (!P0) return false;
  if (!P0.calibrated) { try { PL.calibrate(P0); } catch (e) { /* loops are reported below */ } P0.calibrated = true; }
  const selUid = S.sel ? S.sel.uid : null, snap = structuredClone(P0);
  try { fn(P0); PL.derive(P0, true); PL.schedule(P0); PL.derive(P0, true); }
  catch (err) { S.P = snap; resel(selUid); after(); E.toast(err.message || String(err), true); return false; }
  undo.push(snap); if (undo.length > 40) undo.shift(); redo.length = 0; S.dirty = true;
  resel(S.sel ? S.sel.uid : null); after(); return true;
}
function step(from, to) { if (!from.length) return; const selUid = S.sel ? S.sel.uid : null; to.push(structuredClone(S.P)); S.P = from.pop(); S.dirty = true; resel(selUid); after(); }
const subtreeEnd = (P, i) => { let j = i + 1; while (j < P.tasks.length && P.tasks[j].level > P.tasks[i].level) j++; return j; };
const idx = (P, t) => P.tasks.indexOf(t);

function addTask(durMin) {
  if (!S.P) return; let made = null;
  const ok = commit((P) => {
    const t = blankTask(P, durMin === 0 ? 'New milestone' : 'New task', durMin); made = t.uid;
    const sel = S.sel && P.taskByUid.get(S.sel.uid);
    if (sel && !(P.tasks[0] === sel && sel.level === 0)) { t.level = sel.level; P.tasks.splice(subtreeEnd(P, idx(P, sel)), 0, t); }
    else { t.level = Math.max(1, S.minLevel === 0 ? 1 : S.minLevel); P.tasks.push(t); }
    P.structChanged = true;
  });
  if (ok) { E.select(S.P.taskByUid.get(made)); const i = S.rowIdx.get(made); if (i !== undefined) { const sc = $('chartScroll'); if (i * 26 > sc.scrollTop + sc.clientHeight - 60 || i * 26 < sc.scrollTop) sc.scrollTop = Math.max(0, i * 26 - sc.clientHeight / 2); } editTask(true); }
}
function delTask() {
  const t = S.sel; if (!t) return E.toast('Select a task first.');
  const i = idx(S.P, t), n = subtreeEnd(S.P, i) - i;
  if (S.P.tasks.length - n < 1) return E.toast('A project needs at least one task.');
  if (n > 1 && !window.confirm('Delete "' + t.name + '" and its ' + (n - 1) + ' subtask' + (n === 2 ? '' : 's') + '?')) return;
  const next = S.P.tasks[i + n] || S.P.tasks[i - 1];
  commit((P) => { P.tasks.splice(i, n); P.structChanged = true; S.sel = next || null; });
}
function shift(dir) {
  const t = S.sel; if (!t) return E.toast('Select a task first.');
  const P = S.P, i = idx(P, t), base = S.minLevel === 0 ? 1 : S.minLevel;
  if (t.level === 0) return;
  if (dir > 0 && (i === 0 || P.tasks[i - 1].level < t.level)) return E.toast('To indent, the task above must be at the same level; it becomes the summary task.');
  if (dir < 0 && t.level <= base) return;
  commit((Q) => { const e = subtreeEnd(Q, i); for (let j = i; j < e; j++) Q.tasks[j].level += dir; if (dir > 0) { const par = Q.tasks.slice(0, i).reverse().find((x) => x.level === t.level - 1); if (par) par.collapsed = false; } Q.structChanged = true; });
}
function move(dir) {
  const t = S.sel; if (!t) return E.toast('Select a task first.');
  const P = S.P, i = idx(P, t), e = subtreeEnd(P, i);
  if (t.level === 0) return;
  if (dir < 0) { let j = i - 1; while (j >= 0 && P.tasks[j].level > t.level) j--; if (j < 0 || P.tasks[j].level !== t.level) return; commit((Q) => { const blk = Q.tasks.splice(i, e - i); Q.tasks.splice(j, 0, ...blk); Q.structChanged = true; }); }
  else { if (e >= P.tasks.length || P.tasks[e].level !== t.level) return; const e2 = subtreeEnd(P, e); commit((Q) => { const blk = Q.tasks.splice(i, e - i); Q.tasks.splice(i + (e2 - e), 0, ...blk); Q.structChanged = true; }); }
}

/* ---------- parsing what the user types ---------- */
function parseDur(s, P) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(e?)\s*(mo|mon|mons|month|months|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks)?\s*\??\s*$/i.exec(s);
  if (!m) throw new Error('Duration not understood. Use for example 5d, 2w, 4h or 0 for a milestone.');
  const v = parseFloat(m[1]), u = (m[3] || 'd').toLowerCase(), el = !!m[2];
  if (/^mo/.test(u)) return { min: v * (el ? 43200 : P.minPerDay * P.daysPerMonth), fmt: el ? 12 : 11 };
  if (u[0] === 'm') return { min: v, fmt: el ? 4 : 3 };
  if (u[0] === 'h') return { min: v * 60, fmt: el ? 6 : 5 };
  if (u[0] === 'w') return { min: v * (el ? 10080 : P.minPerWeek), fmt: el ? 10 : 9 };
  return { min: v * (el ? 1440 : P.minPerDay), fmt: el ? 8 : 7 };
}
function parsePreds(s, P, self) {
  const out = [];
  for (const tok of s.split(/[,;]/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(\d+)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+(?:\.\d+)?)\s*(%|[a-z]*))?$/i.exec(tok);
    if (!m) throw new Error('Predecessor "' + tok + '" not understood. Use task IDs such as 5, 7SS+2d or 9FF-1d.');
    const q = P.tasks.find((t) => t.id === +m[1]);
    if (!q) throw new Error('There is no task with ID ' + m[1] + '.');
    if (q.uid === self.uid) throw new Error('A task cannot be its own predecessor.');
    let a = self.parent; while (a) { if (a === q) throw new Error('A task cannot be linked to its own summary task.'); a = a.parent; }
    a = q.parent; while (a) { if (a === self) throw new Error('A summary task cannot be linked to its own subtasks.'); a = a.parent; }
    const type = { FF: 0, FS: 1, SF: 2, SS: 3 }[(m[2] || 'FS').toUpperCase()];
    let lag = 0, lagFmt = 7;
    if (m[4]) { const sign = m[3] === '-' ? -1 : 1; if (m[5] === '%') { lag = sign * parseFloat(m[4]); lagFmt = 19; } else { const d = parseDur(m[4] + (m[5] || 'd'), P); lag = sign * d.min * 10; lagFmt = d.fmt; } }
    if (!out.some((x) => x.uid === q.uid)) out.push({ uid: q.uid, type, lag, lagFmt });
  }
  return out;
}
function parseRes(s, P) {
  const out = [];
  for (const tok of s.split(/[,;]/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(.*?)\s*(?:\[\s*(\d+(?:\.\d+)?)\s*%?\s*\])?$/.exec(tok), name = m[1].trim(); if (!name) continue;
    let r = P.resources.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!r) { r = newRes(P, name); }
    if (!out.some((a) => a.res === r)) out.push({ task: null, res: r, units: m[2] ? parseFloat(m[2]) / 100 : 1, work: null, cost: 0, start: null, finish: null });
  }
  return out;
}
function newRes(P, name) {
  const r = { uid: P.resources.reduce((m, x) => Math.max(m, x.uid), 0) + 1, id: P.resources.reduce((m, x) => Math.max(m, x.id), 0) + 1, name, type: 'Work', initials: '', group: '', maxUnits: 1, rate: 0, work: null, cost: 0, email: '', asg: [] };
  P.resources.push(r); return r;
}

/* ---------- task dialog ---------- */
let fresh = false;
function editTask(isNew) {
  const t = S.sel; if (!t) return E.toast('Select a task first.');
  fresh = !!isNew;
  $('tkTitle').textContent = (isNew ? 'New task' : 'Edit task') + '  ·  ID ' + t.id;
  $('tkName').value = t.name; $('tkDur').value = t.durText; $('tkStart').value = dateVal(t.start); $('tkPct').value = t.pct;
  $('tkCon').innerHTML = PL.CONSTRAINT.map((c, i) => `<option value="${i}">${c}</option>`).join(''); $('tkCon').value = t.constraint; $('tkConDate').value = dateVal(t.constraintDate);
  $('tkPred').value = t.predText; $('tkRes').value = t.resText; $('tkNotes').value = t.notes; $('tkErr').textContent = '';
  for (const id of ['tkDur', 'tkStart', 'tkPct', 'tkCon', 'tkConDate', 'tkRes']) $(id).disabled = t.summary;
  $('tkStartNote').textContent = t.summary ? 'summary tasks take their dates and progress from their subtasks' : t.pct > 0 ? 'this task has started, so it stays where you put it' : 'changing it sets "start no earlier than"';
  $('resNames').innerHTML = S.P.resources.map((r) => `<option value="${E.esc(r.name)}">`).join('');
  $('dlgTask').showModal(); $('tkName').focus(); $('tkName').select();
}
$('tkCon').onchange = () => { if (+$('tkCon').value > 1 && !$('tkConDate').value) $('tkConDate').value = $('tkStart').value; };
$('tkOk').onclick = () => {
  const uid = S.sel.uid;
  try {
    const P = S.P, t0 = S.sel, f = { name: $('tkName').value.trim() || t0.name, notes: $('tkNotes').value, preds: parsePreds($('tkPred').value, P, t0) };
    if (!t0.summary) {
      f.dur = parseDur($('tkDur').value, P); f.pct = Math.max(0, Math.min(100, Math.round(+$('tkPct').value || 0)));
      f.start = fromDateVal($('tkStart').value, P); f.con = +$('tkCon').value; f.conDate = fromDateVal($('tkConDate').value, P);
      if (f.con > 1 && f.conDate === null) throw new Error('Pick a date for the constraint.');
      f.resText = $('tkRes').value;
    }
    const ok = commit((Q) => {
      const t = Q.taskByUid.get(uid);
      t.name = f.name; t.notes = f.notes;
      const oldPred = JSON.stringify(t.preds.map((p) => [p.uid, p.type, p.lag, p.lagFmt])), newPred = JSON.stringify(f.preds.map((p) => [p.uid, p.type, p.lag, p.lagFmt]));
      if (oldPred !== newPred) { t.preds = f.preds; t.sAdj = 0; t.pin = false; t.msEnd = null; }
      if (t.summary) return;
      if (Math.abs(f.dur.min - (t.dur || 0)) > 0.01 || f.dur.fmt !== t.durFmt) { t.dur = f.dur.min; t.durFmt = f.dur.fmt; t.fAdj = 0; t.pin = false; t.forceMs = false; t.msEnd = null; }
      const startChanged = f.start !== null && dateVal(f.start) !== dateVal(t.start), conChanged = f.con !== t.constraint || dateVal(f.conDate) !== dateVal(t.constraintDate);
      if (conChanged) { t.constraint = f.con; t.constraintDate = f.con > 1 ? f.conDate : null; if (f.con >= 2) { t.sAdj = 0; t.pin = false; t.manual = false; } }
      if (startChanged) {
        t.sAdj = 0; t.pin = false;
        if (t.pct > 0 || f.pct > 0 || t.manual) { t.start = f.start; if (t.actualStart !== null) t.actualStart = f.start; }
        else if (!conChanged || f.con < 2) { t.constraint = 4; t.constraintDate = f.start; }
      }
      t.pct = f.pct;
      if (f.resText !== t.resText) t.res = parseRes(f.resText, Q).map((a) => { a.task = t; return a; });
    });
    if (ok) $('dlgTask').close();
  } catch (err) { $('tkErr').textContent = err.message || String(err); }
};
$('dlgTask').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); $('tkOk').click(); } });

/* ---------- project dialog / new project ---------- */
const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
let projNew = false;
function projDialog(isNew) {
  projNew = isNew; const P = S.P, now = new Date();
  if (isNew && S.dirty && !window.confirm('Discard the unsaved changes to ' + S.name + '?')) return;
  $('pjTitle').textContent = isNew ? 'New project' : 'Project settings';
  $('pjName').value = isNew ? 'New project' : (P.name || '');
  $('pjStart').value = isNew ? new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString().slice(0, 10) : dateVal(P.start);
  const wd = isNew ? [false, true, true, true, true, true, false] : P.workDays;
  $('pjDays').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => `<label><input type="checkbox" data-d="${d}"${wd[d] ? ' checked' : ''}> ${DAYN[d]}</label>`).join('');
  $('pjErr').textContent = ''; $('dlgProj').showModal(); $('pjName').focus(); $('pjName').select();
}
$('pjOk').onclick = () => {
  const name = $('pjName').value.trim() || 'Project', wd = [false, false, false, false, false, false, false];
  $('pjDays').querySelectorAll('input').forEach((c) => { wd[+c.dataset.d] = c.checked; });
  if (!wd.some(Boolean)) { $('pjErr').textContent = 'Tick at least one working day.'; return; }
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec($('pjStart').value); if (!m) { $('pjErr').textContent = 'Pick a start date.'; return; }
  if (projNew) {
    const P = { name, author: '', company: '', manager: '', start: Date.UTC(+m[1], m[2] - 1, +m[3]) + 480 * 60000, finish: null, status: null, current: null, minPerDay: 480, minPerWeek: 480 * wd.filter(Boolean).length, daysPerMonth: 20,
      currency: '', tasks: [], resources: [], assignments: [], workDays: wd, holidays: [], blocks: [[480, 720], [780, 1020]], calUid: '1', calibrated: true, structChanged: true };
    P.tasks.push(blankTask(P, 'First task', 480));
    PL.derive(P, true); PL.schedule(P); PL.derive(P, true);
    undo.length = 0; redo.length = 0;
    E.showProject(P, name.replace(/[\\/:*?"<>|]+/g, '-') + '.xml', null); S.dirty = true; E.renderSummary();
    $('dlgProj').close(); E.select(S.P.tasks[0]); E.toast('New project created. Use "+ Task" to add tasks, then Save.');
    return;
  }
  const ok = commit((P) => {
    P.name = name; const ns = Date.UTC(+m[1], m[2] - 1, +m[3]) + dayStart(P);
    if (dateVal(ns) !== dateVal(P.start)) { const delta = ns - P.start; P.start = ns; for (const t of P.tasks) if (!t.summary && (t.pin || t.manual) && t.pct <= 0 && t.start !== null) { t.start += delta; if (t.finish !== null) t.finish += delta; } }
    if (wd.join() !== P.workDays.join()) { P.workDays = wd; P.calChanged = true; }
  });
  if (ok) $('dlgProj').close();
};

/* ---------- baseline, resources, save ---------- */
function setBaseline() {
  if (!S.P) return;
  if (S.P.hasBaseline && !window.confirm('Replace the existing baseline with the current dates?')) return;
  if (commit((P) => { for (const t of P.tasks) { t.bStart = t.start; t.bFinish = t.finish; t.bDur = t.dur; } })) E.toast('Baseline set from the current plan.');
}
$('resAdd').onclick = () => { if (!S.P) return; const n = (window.prompt('Name of the new resource:', '') || '').trim(); if (!n) return; if (S.P.resources.some((r) => r.name.toLowerCase() === n.toLowerCase())) return E.toast('That resource already exists.'); let uid; commit((P) => { uid = newRes(P, n).uid; }); S.selRes = S.P.resByUid.get(uid); E.renderRes(); };
$('resRen').onclick = () => { const r = S.selRes; if (!r) return E.toast('Select a resource first.'); const n = (window.prompt('New name:', r.name) || '').trim(); if (!n || n === r.name) return; commit((P) => { P.resByUid.get(r.uid).name = n; }); };
$('resDel').onclick = () => { const r = S.selRes; if (!r) return E.toast('Select a resource first.'); if (r.asg.length && !window.confirm('Delete "' + r.name + '" and remove it from ' + r.asg.length + ' task' + (r.asg.length === 1 ? '' : 's') + '?')) return; S.selRes = null; commit((P) => { P.resources = P.resources.filter((x) => x.uid !== r.uid); for (const t of P.tasks) t.res = t.res.filter((a) => a.res.uid !== r.uid); }); };
async function save() {
  if (!S.P) return;
  try {
    const xml = PL.toXml(S.P, S.srcXml), name = S.name.replace(/\.[^.]+$/, '') + '.xml';
    await E.saveBlob(name, new Blob([xml], { type: 'application/xml' }));
    S.srcXml = xml; S.P.structChanged = false; S.P.calChanged = false; S.dirty = false; S.name = name; E.renderSummary();
  } catch (err) { E.toast('Could not save: ' + (err.message || err), true); }
}

/* ---------- wiring ---------- */
$('edSave').onclick = save; $('edUndo').onclick = () => step(undo, redo); $('edRedo').onclick = () => step(redo, undo);
$('edAdd').onclick = () => addTask(480); $('edAddMs').onclick = () => addTask(0); $('edEdit').onclick = () => editTask(false); $('edDel').onclick = delTask;
$('edIn').onclick = () => shift(1); $('edOut').onclick = () => shift(-1); $('edUp').onclick = () => move(-1); $('edDown').onclick = () => move(1);
$('edBase').onclick = setBaseline; $('edProj').onclick = () => projDialog(false); $('btnNew').onclick = $('btnNew2').onclick = () => projDialog(true);
$('btnCrit').addEventListener('click', () => { S.critTouched = true; });
E.onProject = () => { undo.length = 0; redo.length = 0; S.critTouched = false; $('editbar').hidden = false; $('edUndo').disabled = true; $('edRedo').disabled = true; };
E.editTask = () => editTask(false);
window.addEventListener('keydown', (e) => {
  if (!S.P || document.querySelector('dialog[open]')) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey, typing = /INPUT|SELECT|TEXTAREA/.test(e.target.tagName);
  if (mod && k === 's') { e.preventDefault(); save(); return; }
  if (typing) return;
  if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); step(undo, redo); }
  else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); step(redo, undo); }
  else if (e.altKey && e.shiftKey && e.key === 'ArrowRight') { e.preventDefault(); shift(1); }
  else if (e.altKey && e.shiftKey && e.key === 'ArrowLeft') { e.preventDefault(); shift(-1); }
  else if (mod || e.altKey) return;
  else if (e.key === 'Insert') addTask(480);
  else if (e.key === 'Delete') delTask();
  else if ((e.key === 'Enter' || e.key === 'F2') && S.sel && S.view === 'gantt') { e.preventDefault(); editTask(false); }
  else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && S.sel && S.view === 'gantt') { const i = S.rowIdx.get(S.sel.uid), n = S.rows[i + (e.key === 'ArrowDown' ? 1 : -1)]; if (n) { e.preventDefault(); E.select(n); } }
});
window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
Object.assign(E, { commit, addTask, delTask, shift, move, setBaseline, save, parseDur, parsePreds, xml: () => PL.toXml(S.P, S.srcXml) });
})();
