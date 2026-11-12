/* PlanLite – saves a project as Microsoft Project XML by patching the XML it was loaded from, so data PlanLite does not show is kept. */
(function () {
'use strict';
const NS = 'http://schemas.microsoft.com/project', DAY = 86400000;
const ORD = {
  Project: 'SaveVersion BuildNumber UID Name Title Subject Category Company Manager Author CreationDate Revision LastSaved ScheduleFromStart StartDate FinishDate FYStartDate CriticalSlackLimit CurrencyDigits CurrencySymbol CurrencyCode CurrencySymbolPosition CalendarUID DefaultStartTime DefaultFinishTime MinutesPerDay MinutesPerWeek DaysPerMonth DefaultTaskType DefaultFixedCostAccrual DefaultStandardRate DefaultOvertimeRate DurationFormat WorkFormat EditableActualCosts HonorConstraints EarnedValueMethod InsertedProjectsLikeSummary MultipleCriticalPaths NewTasksEffortDriven NewTasksEstimated SplitsInProgressTasks SpreadActualCost SpreadPercentComplete TaskUpdatesResource FiscalYearStart WeekStartDay MoveCompletedEndsBack MoveRemainingStartsBack MoveRemainingStartsForward MoveCompletedEndsForward BaselineForEarnedValue AutoAddNewResourcesAndTasks StatusDate CurrentDate MicrosoftProjectServerURL Autolink NewTaskStartDate NewTasksAreManual DefaultTaskEVMethod ProjectExternallyEdited ExtendedCreationDate ActualsInSync RemoveFileProperties AdminProject UpdateManuallyScheduledTasksWhenEditingLinks KeepTaskOnNearestWorkingTimeWhenMadeAutoScheduled Views Filters Groups Tables Maps Reports Drawings DataLinks VBAProjects OutlineCodes WBSMasks ExtendedAttributes Calendars Tasks Resources Assignments'.split(' '),
  Task: 'UID ID Name Active Manual Type IsNull CreateDate Contact WBS WBSLevel OutlineNumber OutlineLevel Priority Start Finish Duration ManualStart ManualFinish ManualDuration DurationFormat Work Stop Resume ResumeValid EffortDriven Recurring OverAllocated Estimated Milestone Summary DisplayAsSummary Critical IsSubproject IsSubprojectReadOnly SubprojectName ExternalTask ExternalTaskProject EarlyStart EarlyFinish LateStart LateFinish StartVariance FinishVariance WorkVariance FreeSlack TotalSlack StartSlack FinishSlack FixedCost FixedCostAccrual PercentComplete PercentWorkComplete Cost OvertimeCost OvertimeWork ActualStart ActualFinish ActualDuration ActualCost ActualOvertimeCost ActualWork ActualOvertimeWork RegularWork RemainingDuration RemainingCost RemainingWork RemainingOvertimeCost RemainingOvertimeWork ACWP CV ConstraintType CalendarUID ConstraintDate Deadline LevelAssignments LevelingCanSplit LevelingDelay LevelingDelayFormat PreLeveledStart PreLeveledFinish Hyperlink HyperlinkAddress HyperlinkSubAddress IgnoreResourceCalendar Notes HideBar Rollup BCWS BCWP PhysicalPercentComplete EarnedValueMethod PredecessorLink ActualWorkProtected ActualOvertimeWorkProtected ExtendedAttribute Baseline OutlineCode IsPublished StatusManager CommitmentStart CommitmentFinish CommitmentType TimephasedData'.split(' '),
  Resource: 'UID ID Name Type IsNull Initials Phonetics NTAccount MaterialLabel Code Group WorkGroup EmailAddress Hyperlink HyperlinkAddress HyperlinkSubAddress MaxUnits PeakUnits OverAllocated AvailableFrom AvailableTo Start Finish CanLevel AccrueAt Work'.split(' '),
  Assignment: 'UID TaskUID ResourceUID PercentWorkComplete ActualCost ActualFinish ActualOvertimeCost ActualOvertimeWork ActualStart ActualWork ACWP Confirmed Cost CostRateTable CostVariance CV Delay Finish FinishVariance Hyperlink HyperlinkAddress HyperlinkSubAddress WorkVariance HasFixedRateUnits FixedMaterial LevelingDelay LevelingDelayFormat LinkedFields Milestone Notes Overallocated OvertimeCost OvertimeWork RegularWork RemainingCost RemainingOvertimeCost RemainingOvertimeWork RemainingWork ResponsePending Start Stop Resume StartVariance Units UpdateNeeded VAC Work WorkContour'.split(' '),
  Baseline: 'Number Interim Start Finish Duration DurationFormat'.split(' '),
};
const STALE = 'ManualStart ManualFinish ManualDuration Stop Resume EarlyStart EarlyFinish LateStart LateFinish StartVariance FinishVariance FreeSlack StartSlack FinishSlack ActualDuration RemainingDuration PreLeveledStart PreLeveledFinish'.split(' ');
const p2 = (n) => String(n).padStart(2, '0');
const iso = (t) => { const d = new Date(t); return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()) + 'T' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds()); };
const dur = (m) => { m = Math.max(0, Math.round(m || 0)); return 'PT' + Math.floor(m / 60) + 'H' + (m % 60) + 'M0S'; };
const hm = (m) => p2(Math.floor(m / 60) % 24) + ':' + p2(m % 60) + ':00';
const kid = (el, name) => { for (const c of el.children) if (c.localName === name) return c; return null; };
const kids = (el, name) => { const r = []; for (const c of el.children) if (c.localName === name) r.push(c); return r; };
const txt = (el, name) => { const c = kid(el, name); return c ? c.textContent : undefined; };
function set(doc, el, name, value, order) {
  let c = kid(el, name);
  if (value === null || value === undefined) { if (c) c.remove(); return; }
  if (!c) {
    c = doc.createElementNS(NS, name);
    const pos = order.indexOf(name); let before = null;
    if (pos >= 0) for (const s of el.children) { const q = order.indexOf(s.localName); if (q > pos || q < 0) { before = s; break; } }
    el.insertBefore(c, before);
  }
  if (c.textContent !== String(value)) c.textContent = String(value);
}
function skeleton(P) {
  const blocks = P.blocks || [[480, 720], [780, 1020]];
  const wt = '<WorkingTimes>' + blocks.map((b) => `<WorkingTime><FromTime>${hm(b[0])}</FromTime><ToTime>${hm(b[1])}</ToTime></WorkingTime>`).join('') + '</WorkingTimes>';
  let wd = ''; for (let d = 0; d < 7; d++) wd += `<WeekDay><DayType>${d + 1}</DayType><DayWorking>${P.workDays[d] ? 1 : 0}</DayWorking>${P.workDays[d] ? wt : ''}</WeekDay>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Project xmlns="${NS}"><SaveVersion>14</SaveVersion><Name></Name><Title></Title><ScheduleFromStart>1</ScheduleFromStart><StartDate></StartDate><FinishDate></FinishDate><CalendarUID>1</CalendarUID>` +
    `<DefaultStartTime>${hm(blocks[0][0])}</DefaultStartTime><DefaultFinishTime>${hm(blocks[blocks.length - 1][1])}</DefaultFinishTime><MinutesPerDay>${P.minPerDay}</MinutesPerDay><MinutesPerWeek>${P.minPerWeek}</MinutesPerWeek><DaysPerMonth>${P.daysPerMonth}</DaysPerMonth><NewTasksAreManual>0</NewTasksAreManual><ProjectExternallyEdited>0</ProjectExternallyEdited>` +
    `<Calendars><Calendar><UID>1</UID><Name>Standard</Name><IsBaseCalendar>1</IsBaseCalendar><BaseCalendarUID>-1</BaseCalendarUID><WeekDays>${wd}</WeekDays></Calendar></Calendars><Tasks></Tasks><Resources></Resources><Assignments></Assignments></Project>`;
}
function toXml(P, src) {
  const doc = new DOMParser().parseFromString(src || skeleton(P), 'application/xml'), root = doc.documentElement;
  if (root.localName !== 'Project' || doc.getElementsByTagName('parsererror').length) throw new Error('The original file can no longer be read.');
  const mk = (name) => doc.createElementNS(NS, name);
  const ensure = (name, after) => { let c = kid(root, name); if (!c) { c = mk(name); const a = after && kid(root, after); root.insertBefore(c, a ? a.nextSibling : null); } return c; };
  set(doc, root, 'Title', P.name || null, ORD.Project); set(doc, root, 'StartDate', iso(P.start), ORD.Project); set(doc, root, 'FinishDate', iso(P.finish), ORD.Project);
  // Without this flag Microsoft Project ignores each task's Duration and rebuilds it from the dates, zeroing tasks at the project start.
  set(doc, root, 'ProjectExternallyEdited', 0, ORD.Project);
  if (P.calChanged) {
    const cals = kids(kid(root, 'Calendars') || root, 'Calendar'), cal = cals.find((c) => txt(c, 'UID') === P.calUid) || cals.find((c) => txt(c, 'IsBaseCalendar') === '1');
    if (cal) {
      let wds = kid(cal, 'WeekDays'); if (!wds) { wds = mk('WeekDays'); cal.append(wds); }
      const blocks = P.blocks || [[480, 720], [780, 1020]];
      for (let d = 1; d <= 7; d++) {
        let w = kids(wds, 'WeekDay').find((x) => txt(x, 'DayType') === String(d));
        if (!w) { w = mk('WeekDay'); const t = mk('DayType'); t.textContent = d; w.append(t); wds.append(w); }
        const on = P.workDays[d - 1];
        let dw = kid(w, 'DayWorking'); if (!dw) { dw = mk('DayWorking'); w.insertBefore(dw, kid(w, 'DayType').nextSibling); }
        dw.textContent = on ? '1' : '0';
        const wt = kid(w, 'WorkingTimes');
        if (!on && wt) wt.remove();
        if (on && !wt) { const n = mk('WorkingTimes'); for (const b of blocks) { const x = mk('WorkingTime'), f = mk('FromTime'), t = mk('ToTime'); f.textContent = hm(b[0]); t.textContent = hm(b[1]); x.append(f, t); n.append(x); } w.append(n); }
      }
    }
  }
  // tasks
  const tasksEl = ensure('Tasks', 'Calendars'), byUid = new Map(), moved = new Set();
  for (const el of kids(tasksEl, 'Task')) byUid.set(txt(el, 'UID'), el);
  for (const t of P.tasks) {
    let el = byUid.get(String(t.uid)); const isNew = !el;
    if (isNew) { el = mk('Task'); tasksEl.append(el); }
    const o = ORD.Task, before = isNew ? '' : [txt(el, 'Start'), txt(el, 'Finish'), txt(el, 'Duration')].join('|');
    set(doc, el, 'UID', t.uid, o); set(doc, el, 'ID', t.id, o); set(doc, el, 'Name', t.name, o);
    if (isNew) { set(doc, el, 'Type', 0, o); set(doc, el, 'IsNull', 0, o); set(doc, el, 'Priority', 500, o); set(doc, el, 'CalendarUID', -1, o); }
    set(doc, el, 'WBS', t.wbs, o); set(doc, el, 'OutlineNumber', t.wbs, o); set(doc, el, 'OutlineLevel', t.level, o);
    set(doc, el, 'Start', t.start === null ? null : iso(t.start), o); set(doc, el, 'Finish', t.finish === null ? null : iso(t.finish), o);
    set(doc, el, 'Duration', dur(t.dur), o); set(doc, el, 'DurationFormat', t.durFmt, o);
    set(doc, el, 'Milestone', t.milestone ? 1 : 0, o); set(doc, el, 'Summary', t.summary ? 1 : 0, o); set(doc, el, 'Critical', t.critical ? 1 : 0, o);
    if (t.slack !== null) set(doc, el, 'TotalSlack', Math.round(t.slack * 10), o);
    set(doc, el, 'PercentComplete', Math.round(t.pct), o);
    set(doc, el, 'ActualStart', t.actualStart === null ? null : iso(t.actualStart), o); set(doc, el, 'ActualFinish', t.actualFinish === null ? null : iso(t.actualFinish), o);
    set(doc, el, 'ConstraintType', t.constraint, o); set(doc, el, 'ConstraintDate', t.constraintDate === null || !t.constraint ? null : iso(t.constraintDate), o);
    set(doc, el, 'Notes', t.notes || null, o);
    if (!isNew && before !== [txt(el, 'Start'), txt(el, 'Finish'), txt(el, 'Duration')].join('|')) { moved.add(t.uid); for (const n of STALE) { const c = kid(el, n); if (c) c.remove(); } }
    for (const c of kids(el, 'PredecessorLink')) c.remove();
    const anchor = [...el.children].find((c) => o.indexOf(c.localName) > o.indexOf('PredecessorLink')) || null;
    for (const l of t.preds) {
      const pl = mk('PredecessorLink');
      for (const [k, v] of [['PredecessorUID', l.uid], ['Type', l.type], ['CrossProject', 0], ['LinkLag', Math.round(l.lag)], ['LagFormat', l.lagFmt]]) { const c = mk(k); c.textContent = v; pl.append(c); }
      el.insertBefore(pl, anchor);
    }
    let b0 = kids(el, 'Baseline').find((b) => (txt(b, 'Number') || '0') === '0');
    if (t.bStart === null || t.bFinish === null) { if (b0) b0.remove(); }
    else {
      if (!b0) { b0 = mk('Baseline'); const a2 = [...el.children].find((c) => o.indexOf(c.localName) > o.indexOf('Baseline')) || null; el.insertBefore(b0, a2); }
      set(doc, b0, 'Number', 0, ORD.Baseline); set(doc, b0, 'Start', iso(t.bStart), ORD.Baseline); set(doc, b0, 'Finish', iso(t.bFinish), ORD.Baseline); set(doc, b0, 'Duration', dur(t.bDur === null ? t.dur : t.bDur), ORD.Baseline);
    }
    byUid.set(String(t.uid), el);
  }
  if (P.structChanged) {
    for (const [uid, el] of byUid) if (!P.taskByUid.has(+uid)) el.remove();
    for (const el of kids(tasksEl, 'Task')) if (txt(el, 'IsNull') === '1') el.remove();
    for (const t of P.tasks) tasksEl.append(byUid.get(String(t.uid)));
  }
  // resources
  const resEl = ensure('Resources', 'Tasks'), rBy = new Map();
  for (const el of kids(resEl, 'Resource')) rBy.set(txt(el, 'UID'), el);
  for (const r of P.resources) {
    let el = rBy.get(String(r.uid)); const isNew = !el;
    if (isNew) { el = mk('Resource'); resEl.append(el); }
    set(doc, el, 'UID', r.uid, ORD.Resource); set(doc, el, 'ID', r.id, ORD.Resource); set(doc, el, 'Name', r.name, ORD.Resource);
    if (isNew) { set(doc, el, 'Type', 1, ORD.Resource); set(doc, el, 'IsNull', 0, ORD.Resource); set(doc, el, 'MaxUnits', 1, ORD.Resource); }
  }
  for (const [uid, el] of rBy) if (+uid > 0 && !P.resByUid.has(+uid)) el.remove();
  // assignments
  const asgEl = ensure('Assignments', 'Resources'), aBy = new Map(); let maxA = 0;
  for (const el of kids(asgEl, 'Assignment')) {
    const tu = +txt(el, 'TaskUID'), ru = +txt(el, 'ResourceUID'); maxA = Math.max(maxA, +txt(el, 'UID') || 0);
    if (!P.taskByUid.has(tu)) { el.remove(); continue; }
    if (ru <= 0 || !P.resByUid.has(ru) && !rBy.has(String(ru))) { if (moved.has(tu)) { const t = P.taskByUid.get(tu); set(doc, el, 'Start', iso(t.start), ORD.Assignment); set(doc, el, 'Finish', iso(t.finish), ORD.Assignment); for (const c of kids(el, 'TimephasedData')) c.remove(); } continue; }
    aBy.set(tu + ':' + ru, el);
  }
  const keep = new Set();
  for (const a of P.assignments) {
    const key = a.task.uid + ':' + a.res.uid; keep.add(key);
    let el = aBy.get(key); const isNew = !el, o = ORD.Assignment;
    if (isNew) { el = mk('Assignment'); asgEl.append(el); set(doc, el, 'UID', ++maxA, o); set(doc, el, 'TaskUID', a.task.uid, o); set(doc, el, 'ResourceUID', a.res.uid, o); }
    if (isNew || moved.has(a.task.uid) || Math.abs((+txt(el, 'Units') || 1) - a.units) > 1e-6) {
      set(doc, el, 'Start', iso(a.task.start), o); set(doc, el, 'Finish', iso(a.task.finish), o); set(doc, el, 'Units', a.units, o);
      set(doc, el, 'Work', dur((a.task.dur || 0) * a.units), o);
      for (const n of ['RemainingWork', 'RegularWork', 'ActualWork', 'Stop', 'Resume']) { const c = kid(el, n); if (c) c.remove(); }
      for (const c of kids(el, 'TimephasedData')) c.remove();
    }
  }
  for (const [key, el] of aBy) if (!keep.has(key)) el.remove();
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + new XMLSerializer().serializeToString(root);
}
PL.toXml = toXml; PL.skeleton = skeleton;
})();
