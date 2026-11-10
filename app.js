(() => {
'use strict';
const KEY = 'nsdi-planner-v1', UI_KEY = 'nsdi-planner-ui';
const STATUSES = ['Not started', 'Ongoing', 'Review and QA', 'On hold', 'Done'];
const ST_META = { 'Not started': ['○', '--st-ns', 0], 'Ongoing': ['◔', '--st-on', 50], 'Review and QA': ['◑', '--st-qa', 90], 'On hold': ['⏸', '--st-hd', null], 'Done': ['✓', '--st-dn', 100] };
const DEP_TYPES = ['FS', 'SS', 'FF', 'SF'];
const RES_TYPES = ['Team', 'Role', 'Person'];
const RES_FIELDS = ['owner', 'role', 'other'];
const NEW_RES = '__new';
const DEP_LABEL = { FS: 'Finish → Start', SS: 'Start → Start', FF: 'Finish → Finish', SF: 'Start → Finish' };
const TABS = [['summary', '📊', 'Executive Summary'], ['wbs', '🗂️', 'WBS'], ['gantt', '📅', 'Gantt'], ['milestones', '◆', 'Milestones'], ['board', '🧩', 'Board'], ['resources', '🧑‍💼', 'Resources'], ['workload', '👥', 'Workload'],['risks', '⚠️', 'Risks & Issues'], ['health', '🩺', 'Plan Health'], ['settings', '⚙️', 'Settings']];
const ZOOMS = { Day: 22, Week: 9, Month: 2.6, Quarter: 1 };
const MS_RE = /sign-?\s?off|final approval|kick-?\s?off|acceptance certificate/i;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- dates: integers = days since epoch, ISO strings in the model ---------- */
const d2n = s => { const [y, m, d] = String(s).split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 864e5); };
const n2d = n => new Date(n * 864e5).toISOString().slice(0, 10);
const isISO = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(d2n(s));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = s => { if (!s) return '—'; const [y, m, d] = s.split('-'); return `${+d} ${MONTHS[+m - 1]} ${y}`; };
const fmtS = s => { if (!s) return '—'; const [y, m, d] = s.split('-'); return `${+d} ${MONTHS[+m - 1]} ${y.slice(2)}`; };
const todayN = () => { const t = new Date(); return Math.floor(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / 864e5); };
const dow = n => (n + 4) % 7;
let holidaySet = new Set();
const isWork = n => { const w = dow(n); return w !== 0 && w !== 6 && !holidaySet.has(n); };
const snap = n => { while (!isWork(n)) n++; return n; };
function wshift(n, k) {
  if (k === 0) return snap(n);
  const dir = k > 0 ? 1 : -1;
  let left = Math.abs(k);
  while (left > 0) { n += dir; if (isWork(n)) left--; }
  return n;
}
function wcount(a, b) { let c = 0; for (let n = a; n <= b; n++) if (isWork(n)) c++; return c; }

/* ---------- model ---------- */
let P, I, undoStack = [], redoStack = [];
const UI = { tab: 'summary', sel: null, level: 3, zoom: 'Month', colorBy: 'stage', links: true, labels: 'role', crit: false, base: false, wbsLevel: 3, msFilter: 'open', wlBy: 'both', wlUnit: 'month', boardShow: {}, welcome: true };
const F = { q: '', stage: [], owner: [], res: [], status: [], cat: [] }; // each list filter keeps tasks matching any of its picks
const MULTI = ['stage', 'owner', 'res', 'status', 'cat'];
const clearF = () => { F.q = ''; MULTI.forEach(k => { F[k] = []; }); };
const collapsed = new Set();
const scrollMem = {};

function parseDepString(str) {
  const deps = [], notes = [];
  String(str || '').split(/;|,(?=\s*\d)/).forEach(raw => {
    const s = raw.trim(); if (!s) return;
    const m = s.match(/^(\d+(?:\.\d+)*)\s*(?:\((FS|SS|FF|SF)\))?\s*(?:([+-])\s*(\d+)\s*d?)?\s*(.*)$/i);
    if (!m) { notes.push(s); return; }
    deps.push({ code: m[1], type: (m[2] || 'FS').toUpperCase(), lag: m[4] ? (m[3] === '-' ? -1 : 1) * +m[4] : 0 });
    const tail = m[5].replace(/^[–—\-\s]+/, '').trim();
    if (tail) notes.push(tail);
  });
  return { deps, notes };
}
function isAncestorCode(a, b) { return b.startsWith(a + '.'); }

function buildFromRows(rows, source) {
  const seen = new Set();
  const tasks = rows.filter(r => String(r.wbs || '').trim()).map((r, i) => {
    const status = STATUSES.includes(r.status) ? r.status : 'Not started';
    const dur = r.dur === '' || r.dur == null ? 0 : Math.round(+r.dur) || 0;
    const wbs = String(r.wbs).trim();
    const t = { id: 't' + i, wbs, name: r.name || '(untitled)', category: r.category || '', scope: r.scope || '', owner: r.owner || '', role: r.role || '', other: r.other || '', note: r.note || '', status, srcStatus: r.status || '', progress: ST_META[status][2] || 0, dur, start: r.start, end: r.end, srcStart: r.start, srcEnd: r.end, srcDur: dur, deps: [], depNote: '', depRaw: r.deps || '', sow: r.sow || '', qa: r.qa || '', ms: false, notes: '', dup: seen.has(wbs) };
    seen.add(wbs);
    return t;
  });
  const byCode = new Map(); tasks.forEach(t => { if (!byCode.has(t.wbs)) byCode.set(t.wbs, t); });
  let dropped = 0;
  tasks.forEach(t => {
    const { deps, notes } = parseDepString(t.depRaw);
    deps.forEach(d => {
      const p = byCode.get(d.code);
      if (!p) { notes.push('Unknown predecessor ' + d.code); return; }
      if (p === t || isAncestorCode(p.wbs, t.wbs) || isAncestorCode(t.wbs, p.wbs)) { dropped++; return; } // parent/child link is implied by the hierarchy
      t.deps.push({ id: p.id, type: d.type, lag: d.lag });
    });
    t.depNote = notes.filter(n => !/^\(?summary/i.test(n) && !/^project start$/i.test(n)).join('; ');
    t.ms = (MS_RE.test(t.name)) || (t.dur === 0 && t.category !== 'Expense' && !byCode.has(t.wbs + '.1'));
  });
  return {
    meta: { title: 'NSDI & Geoportal Project', subtitle: 'QA & Consultancy – task and timeline plan', headline: 'End-to-end delivery of the National Spatial Data Infrastructure and Geoportal: inception and planning, system design and development, data migration for 35 organizations, capacity building, handover and warranty.', source: source, savedAt: '', projectEnd: '2027-11-01' },
    settings: { holidays: [], autoSched: true },
    tasks, risks: [], log: [], baseline: { label: 'Workbook V11', savedAt: new Date().toISOString(), map: Object.fromEntries(tasks.map(t => [t.id, [t.start, t.end]])) }, stats: { structuralDepsDropped: dropped }
  };
}

function index() {
  I = { byId: new Map(), byWbs: new Map(), parent: new Map(), kids: new Map(), succ: new Map() };
  P.tasks.forEach(t => { I.byId.set(t.id, t); if (!I.byWbs.has(t.wbs)) I.byWbs.set(t.wbs, t); I.kids.set(t.id, []); I.succ.set(t.id, []); });
  P.tasks.forEach(t => {
    const seg = t.wbs.split('.');
    for (let k = seg.length - 1; k > 0; k--) { const p = I.byWbs.get(seg.slice(0, k).join('.')); if (p && p !== t) { I.parent.set(t.id, p); I.kids.get(p.id).push(t); break; } }
    t.deps = t.deps.filter(d => I.byId.has(d.id));
    t.deps.forEach(d => I.succ.get(d.id).push(t));
  });
  P.tasks.forEach(t => { let d = 1, p = I.parent.get(t.id); while (p) { d++; p = I.parent.get(p.id); } t.depth = d; });
  holidaySet = new Set((P.settings.holidays || []).filter(isISO).map(d2n));
}
const isSum = t => I.kids.get(t.id).length > 0;
const parentOf = t => I.parent.get(t.id);
function ancestors(t) { const a = []; let p = parentOf(t); while (p) { a.push(p); p = parentOf(p); } return a; }
function descendants(t, out = []) { I.kids.get(t.id).forEach(k => { out.push(k); descendants(k, out); }); return out; }
const leaves = () => P.tasks.filter(t => !isSum(t));
const leavesOf = t => isSum(t) ? descendants(t).filter(x => !isSum(x)) : [t];
const stageOf = t => { const a = ancestors(t); return a.length ? a[a.length - 1] : t; };
const stageColor = t => { const n = parseInt(t.wbs, 10); return n >= 1 && n <= 8 ? `var(--s${n})` : 'var(--s9)'; };
const stColor = s => `var(${ST_META[s] ? ST_META[s][1] : '--st-ns'})`;
const pill = s => `<span class="pill"><i style="color:${stColor(s)}">${(ST_META[s] || ['○'])[0]}</i>${esc(s)}</span>`;

function rollup() {
  const w = new Map();
  [...P.tasks].sort((a, b) => b.depth - a.depth).forEach(t => {
    const kids = I.kids.get(t.id);
    if (!kids.length) { w.set(t.id, Math.max(t.dur, 1)); return; }
    let s = Infinity, e = -Infinity, tw = 0, tp = 0;
    kids.forEach(k => { s = Math.min(s, d2n(k.start)); e = Math.max(e, d2n(k.end)); const kw = w.get(k.id); tw += kw; tp += kw * k.progress; });
    t.start = n2d(s); t.end = n2d(e); t.dur = wcount(s, e); t.progress = tw ? Math.round(tp / tw) : 0; w.set(t.id, tw);
    const st = kids.map(k => k.status);
    t.status = st.every(x => x === 'Done') ? 'Done' : st.every(x => x === 'Not started') ? 'Not started' : st.every(x => x === 'On hold') ? 'On hold' : st.every(x => x === 'Done' || x === 'Review and QA') ? 'Review and QA' : 'Ongoing';
  });
}

/* ---------- scheduling ---------- */
function setLeafStart(t, n) { n = snap(n); t.start = n2d(n); t.end = n2d(t.dur <= 1 ? n : wshift(n, t.dur - 1)); }
function requiredStart(t, dep, base = d2n(t.start)) {
  const p = I.byId.get(dep.id), ps = d2n(p.start), pe = d2n(p.end), lag = dep.lag || 0;
  switch (dep.type) {
    case 'SS': return wshift(ps, lag);
    case 'FF': case 'SF': {
      const reqEnd = wshift(dep.type === 'FF' ? pe : ps, lag);
      return isSum(t) ? base + (reqEnd - d2n(t.end)) : wshift(reqEnd, -(Math.max(t.dur, 1) - 1));
    }
    default: return wshift(pe, 1 + lag);
  }
}
function shiftTask(t, days) {
  leavesOf(t).forEach(l => setLeafStart(l, d2n(l.start) + days));
}
const depsReq = (t, base) => t.deps.reduce((m, d) => Math.max(m, requiredStart(t, d, base)), -Infinity);
const floorFrom = t => ancestors(t).reduce((m, a) => (a.deps.length ? Math.max(m, depsReq(a)) : m), -Infinity); // a parent's links hold for everything under it
const nearestLinked = t => (t.deps.length ? t : ancestors(t).find(a => a.deps.length));
function enforce(t) { // puts a task exactly where its links say; a task with no links is only kept from starting before its parent's links allow
  if (!isSum(t)) {
    const s = d2n(t.start), floor = floorFrom(t), req = snap(t.deps.length ? Math.max(depsReq(t), floor) : Math.max(s, floor));
    if (req === s) return false;
    setLeafStart(t, req);
    return true;
  }
  if (!t.deps.length) return false;
  const free = leavesOf(t).filter(l => nearestLinked(l) === t); // sub-tasks with links of their own follow those instead
  if (!free.length) return false;
  const base = Math.min(...free.map(l => d2n(l.start))), delta = Math.max(depsReq(t, base), floorFrom(t)) - base;
  if (!delta) return false;
  free.forEach(l => setLeafStart(l, d2n(l.start) + delta));
  return true;
}
function propagate(seed) {
  rollup();
  if (!P.settings.autoSched) return 0;
  const scope = new Set(); seed.forEach(s => reach(s).forEach(id => scope.add(id)));
  const list = P.tasks.filter(t => scope.has(t.id)), seeds = new Set(seed.map(t => t.id));
  const was = new Map(list.map(t => [t.id, t.start + t.end]));
  for (let pass = 0, again = true; again && pass < 40; pass++) {
    again = false;
    list.forEach(t => { if (enforce(t)) { rollup(); again = true; } });
  }
  return list.filter(t => !isSum(t) && !seeds.has(t.id) && was.get(t.id) !== t.start + t.end).length;
}
function cascade(seed) {
  const n = propagate(seed);
  if (n) toast(`${n} dependent task${n > 1 ? 's were' : ' was'} rescheduled. Press Ctrl+Z to undo.`);
}
function followsLinks(t, wanted) {
  if (P.settings.autoSched && t.start !== wanted) toast(`${t.wbs} starts ${fmtS(t.start)} because of its dependencies. To change that, edit the link type or lag.`);
}
function reach(start) { // tasks whose dates are driven by `start`
  const seen = new Set(), q = [start, ...descendants(start)];
  while (q.length) {
    const x = q.pop(); if (seen.has(x.id)) continue; seen.add(x.id);
    [x, ...ancestors(x)].forEach(a => I.succ.get(a.id).forEach(s => { if (!seen.has(s.id)) q.push(s, ...descendants(s)); }));
  }
  return seen;
}
function linkError(p, s) {
  if (!p || !s) return 'Pick two tasks to link.';
  if (p === s) return 'A task cannot depend on itself.';
  if (isAncestorCode(p.wbs, s.wbs) || isAncestorCode(s.wbs, p.wbs)) return `${p.wbs} and ${s.wbs} are parent and child, so they are already linked by the hierarchy.`;
  if (s.deps.some(d => d.id === p.id)) return `${s.wbs} already depends on ${p.wbs}.`;
  const r = reach(s);
  if (r.has(p.id) || descendants(p).some(x => r.has(x.id))) return `That would create a loop: ${p.wbs} already depends on ${s.wbs}.`;
  return '';
}
function depStr(t) {
  return t.deps.map(d => { const p = I.byId.get(d.id); return p.wbs + (d.type !== 'FS' ? ` (${d.type})` : '') + (d.lag ? (d.lag > 0 ? '+' : '') + d.lag : ''); }).join('; ');
}
function drivingChain(target) {
  const chain = new Set(), links = new Set(), seen = new Set();
  const latestLeaf = t => leavesOf(t).reduce((a, b) => (b.end > a.end ? b : a));
  const walk = t => {
    if (seen.has(t.id)) return; seen.add(t.id); chain.add(t.id);
    const s = d2n(t.start);
    [t, ...ancestors(t)].forEach(a => a.deps.forEach(d => {
      if (d2n(a.start) !== s && a !== t) return;
      if (requiredStart(a, d) >= s) { const lf = latestLeaf(I.byId.get(d.id)); links.add(d.id + '>' + a.id); chain.add(d.id); chain.add(a.id); walk(lf); }
    }));
  };
  walk(latestLeaf(target));
  return { chain, links };
}

/* ---------- persistence ---------- */
const clock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function persist() { // this browser's copy opens the tool quickly; with live sync on, the shared plan is the master
  P.meta.savedAt = new Date().toISOString();
  try { localStorage.setItem(KEY, JSON.stringify(P)); if (!Live.on) setSaved('Saved in this browser · ' + clock()); }
  catch (e) { if (!Live.on) setSaved('⚠ Could not save in this browser – use File › Save project file'); }
}
function save() { persist(); pushChanges(); }
function setSaved(t) { $('#saveState').textContent = t; }
function saveUI() { try { localStorage.setItem(UI_KEY, JSON.stringify({ tab: UI.tab, zoom: UI.zoom, colorBy: UI.colorBy, links: UI.links, labels: UI.labels, base: UI.base, welcome: UI.welcome, theme: document.documentElement.dataset.theme || '' })); } catch (e) { /* optional */ } }
function validProject(p) {
  return p && Array.isArray(p.tasks) && p.tasks.length && p.tasks.every(t => t && typeof t.id === 'string' && typeof t.wbs === 'string' && isISO(t.start) && isISO(t.end) && Array.isArray(t.deps));
}
function adopt(p) {
  p.meta = Object.assign({ title: 'Project', subtitle: '', headline: '', projectEnd: '' }, p.meta);
  p.settings = Object.assign({ holidays: [], autoSched: true }, p.settings);
  p.risks = Array.isArray(p.risks) ? p.risks : []; p.log = Array.isArray(p.log) ? p.log : [];
  ensureResources(p);
  P = p; index(); rollup();
}
const resId = () => 'res' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function ensureResources(p) { // every name used on a task is available in the dropdowns
  p.resources = Array.isArray(p.resources) ? p.resources : [];
  const have = new Set(p.resources.map(r => r.name));
  const add = (name, type) => { if (name && !have.has(name)) { have.add(name); p.resources.push({ id: resId(), name, type, person: '', notes: '' }); } };
  uniq(p.tasks.map(t => t.owner)).forEach(n => add(n, 'Team'));
  uniq(p.tasks.flatMap(t => [t.role, t.other])).forEach(n => add(n, 'Role'));
}
function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) { const p = JSON.parse(raw); if (validProject(p)) { adopt(p); return true; } } } catch (e) { /* fall through to seed */ }
  adopt(buildFromRows(window.SEED_ROWS, window.SEED_SOURCE));
  return false;
}
const snapshot = () => JSON.stringify({ tasks: P.tasks, risks: P.risks, resources: P.resources, meta: P.meta, settings: P.settings, baseline: P.baseline });
function logIt(label) { P.log.unshift(Object.assign({ at: new Date().toISOString(), what: label }, Live.user ? { by: Live.user.email.split('@')[0] } : {})); P.log.length = Math.min(P.log.length, 200); }
function viewOnly() {
  if (!Live.on || Live.canEdit) return false;
  toast(Live.user ? 'Your account cannot edit yet. Click your name at the top for details.' : 'This is view only. Use “Sign in to edit” to make changes.', 1);
  return true;
}
function pastEndError(before) { // only blocks tasks this edit newly takes past the end, so tasks already past it don't stop other edits
  const pe = P.meta.projectEnd;
  if (!P.settings.lockEnd || !pe) return '';
  const old = new Map(JSON.parse(before).tasks.map(t => [t.id, t.end]));
  const bad = leaves().filter(t => t.end > pe && !(old.get(t.id) >= t.end));
  if (!bad.length) return '';
  return `Not changed: ${bad[0].wbs} would finish ${fmtS(bad[0].end)}${bad.length > 1 ? ` (and ${bad.length - 1} more)` : ''}, after the ${fmtS(pe)} project end. You can turn this limit off in Settings.`;
}
function commit(label, fn) {
  if (viewOnly()) { renderAll(); return false; }
  const snapShot = snapshot();
  toastHold = []; // "rescheduled" messages wait until the edit is accepted
  let ok = false, err = '', held = [];
  try { ok = fn() !== false; } finally { held = toastHold; toastHold = null; }
  if (ok) { index(); rollup(); err = pastEndError(snapShot); if (err) toast(err, 1); }
  if (!ok || err) { Object.assign(P, JSON.parse(snapShot)); index(); rollup(); renderAll(); return false; }
  held.forEach(m => toast(m));
  undoStack.push(snapShot); if (undoStack.length > 40) undoStack.shift(); redoStack = [];
  logIt(label); index(); rollup(); save(); renderAll();
  return true;
}
function restore(from, to, name) {
  if (!from.length) return toast('Nothing to ' + name);
  to.push(snapshot());
  Object.assign(P, JSON.parse(from.pop())); index(); rollup(); save(); renderAll();
  toast(name === 'undo' ? 'Undone' : 'Redone');
}

/* ---------- editing ---------- */
function setField(t, f, v) {
  const sum = isSum(t);
  switch (f) {
    case 'name': if (!String(v).trim()) { toast('A task needs a name', 1); return false; } t.name = String(v).trim(); break;
    case 'wbs': {
      v = String(v).trim();
      if (!/^\d+(\.\d+)*$/.test(v)) { toast('WBS codes look like 2.1.3', 1); return false; }
      if (I.byWbs.has(v) && I.byWbs.get(v) !== t) { toast(`WBS ${v} is already in use`, 1); return false; }
      if (sum) { toast('Renumber a parent by editing its sub-tasks first', 1); return false; }
      t.wbs = v; t.dup = false; index(); break;
    }
    case 'start': if (sum || !isISO(v)) return false; setLeafStart(t, d2n(v)); cascade([t]); followsLinks(t, n2d(snap(d2n(v)))); break;
    case 'end': {
      if (sum || !isISO(v) || v < t.start) { if (v < t.start) toast('End date cannot be before the start', 1); return false; }
      const e = d2n(v); t.dur = wcount(d2n(t.start), e) || 1; t.end = n2d(snap(e)); cascade([t]); break;
    }
    case 'dur': { const n = Math.round(+v); if (sum || !(n >= 0)) return false; t.dur = n; setLeafStart(t, d2n(t.start)); cascade([t]); break; }
    case 'status':
      if (sum || !STATUSES.includes(v)) return false;
      t.status = v;
      if (v === 'Done') t.progress = 100;
      else if (v === 'Not started') t.progress = 0;
      else if (ST_META[v][2] != null && (t.progress === 0 || t.progress === 100)) t.progress = ST_META[v][2];
      break;
    case 'progress': {
      const n = Math.round(+v); if (sum || isNaN(n)) return false; t.progress = clamp(n, 0, 100);
      if (t.progress === 100) t.status = 'Done'; else if (t.status === 'Done') t.status = 'Ongoing'; else if (t.progress > 0 && t.status === 'Not started') t.status = 'Ongoing';
      break;
    }
    case 'deps': {
      const { deps, notes } = parseDepString(v);
      if (notes.length) { toast('Use the format: 1.2; 1.3 (SS); 1.4 (FF)+2', 1); return false; }
      const keep = t.deps; t.deps = [];  index();
      for (const d of deps) {
        const p = I.byWbs.get(d.code); const err = linkError(p, t);
        if (err) { t.deps = keep; index(); toast(p ? err : `No task with WBS ${d.code}`, 1); return false; }
        t.deps.push({ id: p.id, type: d.type, lag: d.lag }); index();
      }
      propagate([t]); break;
    }
    default: t[f] = v;
  }
  return true;
}
function nextWbs(parent) {
  const sibs = parent ? I.kids.get(parent.id) : P.tasks.filter(t => !parentOf(t));
  const max = sibs.reduce((m, s) => Math.max(m, +s.wbs.split('.').pop() || 0), 0);
  return (parent ? parent.wbs + '.' : '') + (max + 1);
}
function addTask(parent, o = {}) {
  const id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const start = isISO(o.start) ? o.start : parent ? parent.start : n2d(snap(todayN()));
  const dur = o.dur != null ? o.dur : 5;
  const t = { id, wbs: nextWbs(parent), name: o.name || 'New task', category: o.category || (o.ms ? 'Milestone' : 'Task'), scope: '', owner: parent ? parent.owner : '', role: '', other: '', note: '', status: 'Not started', srcStatus: '', progress: 0, dur, start, end: start, deps: [], depNote: '', depRaw: '', sow: '', qa: '', ms: !!o.ms, notes: '' };
  setLeafStartRaw(t);
  let at = P.tasks.length;
  if (parent) { const d = descendants(parent); const last = d.length ? d.reduce((a, b) => (P.tasks.indexOf(b) > P.tasks.indexOf(a) ? b : a)) : parent; at = P.tasks.indexOf(last) + 1; }
  P.tasks.splice(at, 0, t);
  if (parent) collapsed.delete(parent.id);
  index();
  return t;
}
function setLeafStartRaw(t) { const n = snap(d2n(t.start)); t.start = n2d(n); t.end = n2d(t.dur <= 1 ? n : wshift(n, t.dur - 1)); }
function removeTask(t) {
  const gone = new Set([t.id, ...descendants(t).map(x => x.id)]);
  P.tasks = P.tasks.filter(x => !gone.has(x.id));
  P.tasks.forEach(x => { x.deps = x.deps.filter(d => !gone.has(d.id)); });
  if (gone.has(UI.sel)) UI.sel = null;
  index();
}

function moveTarget(t, dir, vis) {
  const p = parentOf(t), sibs = (p ? I.kids.get(p.id) : P.tasks.filter(x => !parentOf(x))).filter(s => !vis || vis.has(s.id));
  const i = sibs.indexOf(t);
  return i < 0 ? null : sibs[i + dir] || null;
}
function swapTasks(a, b) { // siblings trade places and WBS codes; links follow because they use task ids
  const [first, second] = P.tasks.indexOf(a) < P.tasks.indexOf(b) ? [a, b] : [b, a];
  const block = x => { const s = new Set([x.id, ...descendants(x).map(d => d.id)]); return P.tasks.filter(y => s.has(y.id)); };
  const bf = block(first), bs = block(second), cf = first.wbs, cs = second.wbs, codes = new Map();
  const recode = (list, from, to) => list.forEach(y => { const c = to + y.wbs.slice(from.length); codes.set(y.wbs, c); y.wbs = c; });
  recode(bf, cf, cs); recode(bs, cs, cf);
  const skip = new Set([...bf, ...bs]);
  P.tasks = P.tasks.flatMap(x => (x === first ? bs : x === second ? bf : skip.has(x) ? [] : [x]));
  P.risks.forEach(r => { if (codes.has(r.wbs)) r.wbs = codes.get(r.wbs); });
  F.stage = F.stage.map(c => codes.get(c) || c);
  index();
}
function moveTask(t, dir) {
  const vis = new Set(visibleRows().map(x => x.id)), other = moveTarget(t, dir, vis.has(t.id) ? vis : null), was = t.wbs;
  if (!other) return toast(`${was} is already ${dir < 0 ? 'first' : 'last'} under its parent`);
  commit(`Moved ${was} ${dir < 0 ? 'up' : 'down'}`, () => { swapTasks(t, other); UI.flash = t.id; });
  if (t.wbs !== was) toast(`${was} is now ${t.wbs}. Links and dates are unchanged.`);
}
const moveBtns = (t, vis) => `<button data-act="moveUp" data-id="${t.id}" data-tip="Move up" aria-label="Move up" ${moveTarget(t, -1, vis) ? '' : 'disabled'}>▲</button><button data-act="moveDown" data-id="${t.id}" data-tip="Move down" aria-label="Move down" ${moveTarget(t, 1, vis) ? '' : 'disabled'}>▼</button>`;

/* ---------- resources ---------- */
function resOptions(val) {
  const known = P.resources.some(r => r.name === val);
  return opt('', val || '', '— None —') + (val && !known ? opt(val, val) : '') + RES_TYPES.map(ty => {
    const list = P.resources.filter(r => r.type === ty).sort((a, b) => a.name.localeCompare(b.name));
    return list.length ? `<optgroup label="${ty === 'Person' ? 'People' : ty + 's'}">${list.map(r => opt(r.name, val)).join('')}</optgroup>` : '';
  }).join('') + opt(NEW_RES, val, '＋ Add new resource…');
}
function dlgResource(onAdd) {
  dialog('＋ Add a resource', `<div class="form">
    <label class="full">Name<input name="name" required autofocus placeholder="e.g. Metadata Specialist"></label>
    <label>Type<select name="type">${RES_TYPES.map(x => opt(x, 'Role')).join('')}</select></label>
    <label>Assigned person (optional)<input name="person"></label>
    <label class="full">Notes (optional)<input name="notes"></label></div>`, fd => {
    const name = String(fd.get('name')).trim();
    if (!name) { toast('A resource needs a name', 1); return false; }
    if (P.resources.some(r => r.name.toLowerCase() === name.toLowerCase())) { toast(`“${name}” is already in the list`, 1); return false; }
    commit(`Added resource “${name}”`, () => {
      P.resources.push({ id: resId(), name, type: fd.get('type'), person: String(fd.get('person')).trim(), notes: String(fd.get('notes')).trim() });
      if (onAdd) onAdd(name);
    });
  }, 'Add');
}
function renameResource(r, raw) {
  const name = String(raw).trim();
  if (!name) { toast('A resource needs a name', 1); renderView(); return; }
  if (name === r.name) return;
  const other = P.resources.find(x => x !== r && x.name.toLowerCase() === name.toLowerCase());
  const to = other ? other.name : name, from = r.name;
  commit(`Renamed resource “${from}” to “${to}”`, () => {
    P.tasks.forEach(t => RES_FIELDS.forEach(f => { if (t[f] === from) t[f] = to; }));
    if (other) P.resources = P.resources.filter(x => x !== r); else r.name = to;
    F.res = uniq(F.res.map(x => (x === from ? to : x)));
  });
  if (other) toast(`Merged “${from}” into “${to}”`);
}
function viewResources() {
  const count = (name, f) => P.tasks.filter(t => t[f] === name).length;
  const open = name => leaves().filter(t => t.status !== 'Done' && RES_FIELDS.some(f => t[f] === name)).length;
  const list = [...P.resources].sort((a, b) => RES_TYPES.indexOf(a.type) - RES_TYPES.indexOf(b.type) || a.name.localeCompare(b.name));
  return `<div class="bar-tools"><b>${list.length} resources</b> <span class="muted">These fill the owner, role and participant dropdowns. Renaming updates every task; renaming to an existing name merges the two.</span><span class="grow"></span><button class="btn pri" data-act="addResource">＋ Add resource</button></div>
  <div class="scroll" data-scroll="res"><table><thead><tr><th>Name</th><th>Type</th><th>Assigned person</th><th>Notes</th><th>As owner</th><th>As role</th><th>As participant</th><th>Open tasks</th><th></th></tr></thead><tbody>
  ${list.map(r => `<tr data-res="${esc(r.id)}"><td><input data-resf="name" value="${esc(r.name)}" aria-label="Name" style="min-width:230px"></td><td><select data-resf="type" aria-label="Type" style="width:90px">${RES_TYPES.map(x => opt(x, r.type)).join('')}</select></td><td><input data-resf="person" value="${esc(r.person)}" aria-label="Assigned person" style="min-width:140px"></td><td><input data-resf="notes" value="${esc(r.notes)}" aria-label="Notes" style="min-width:180px"></td><td>${count(r.name, 'owner') || ''}</td><td>${count(r.name, 'role') || ''}</td><td>${count(r.name, 'other') || ''}</td><td>${open(r.name) || ''}</td>
  <td class="nowrap"><button class="btn sm" data-act="resTasks" data-id="${esc(r.id)}">View tasks</button> <button class="btn sm" data-act="delResource" data-id="${esc(r.id)}" data-tip="Delete" aria-label="Delete">🗑</button></td></tr>`).join('') || `<tr><td colspan="9"><div class="empty">No resources yet.</div></td></tr>`}
  </tbody></table></div>`;
}

/* ---------- filtering ---------- */
const filterActive = () => !!(F.q || MULTI.some(k => F[k].length));
function match(t) {
  if (F.stage.length && !F.stage.includes(stageOf(t).wbs)) return false;
  if (F.owner.length && !F.owner.includes(t.owner)) return false;
  if (F.res.length && !RES_FIELDS.some(f => F.res.includes(t[f]))) return false;
  if (F.status.length && !F.status.includes(t.status)) return false;
  if (F.cat.length && !F.cat.includes(t.category)) return false;
  if (F.q) { const q = F.q.toLowerCase(); if (!(`${t.wbs} ${t.name} ${t.scope} ${t.role} ${t.owner} ${t.other}`.toLowerCase().includes(q))) return false; }
  return true;
}
function visibleRows() {
  const active = filterActive(); let keep = null;
  if (active) { keep = new Set(); P.tasks.forEach(t => { if (match(t)) { let c = t; while (c && !keep.has(c.id)) { keep.add(c.id); c = parentOf(c); } } }); }
  return P.tasks.filter(t => {
    if (keep) return keep.has(t.id);
    let p = parentOf(t);
    while (p) { if (collapsed.has(p.id)) return false; p = parentOf(p); }
    return true;
  });
}
function setLevel(n) { UI.level = n; collapsed.clear(); P.tasks.forEach(t => { if (isSum(t) && t.depth >= n) collapsed.add(t.id); }); }
function uniq(arr) { return [...new Set(arr.filter(Boolean))].sort(); }
function opt(v, sel, label) { return `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(label == null ? v : label)}</option>`; }
function msel(k, label, all, unit, items) { // tick any number of values; a list with nothing ticked shows everything
  const pick = F[k], one = pick.length === 1 && items.find(([v]) => v === pick[0]);
  const text = !pick.length ? all : one ? one[1] : `${pick.length} ${unit}`;
  return `<details class="menu msel" data-msel="${k}"><summary class="msel-btn ${pick.length ? 'on' : ''}" aria-label="${esc(label)}" title="${esc(pick.length > 1 ? items.filter(([v]) => pick.includes(v)).map(([, l]) => l).join(', ') : label)}">${esc(text)}</summary>
  <div class="menu-pop msel-pop">${pick.length ? `<button data-act="mselClear" data-k="${k}">✕ Show all</button><hr>` : ''}${items.map(([v, l]) => `<label><input type="checkbox" data-msel-v="${k}" value="${esc(v)}" ${pick.includes(v) ? 'checked' : ''}>${esc(l)}</label>`).join('')}</div></details>`;
}
function filterBar(extra = '', withLevel = true) {
  const stages = P.tasks.filter(t => !parentOf(t)), same = v => [v, v];
  return `<input type="search" placeholder="🔍 Search tasks…" value="${esc(F.q)}" data-filter="q" aria-label="Search tasks">
  ${msel('stage', 'Stage', 'All stages', 'stages', stages.map(s => [s.wbs, `${s.wbs}. ${s.name}`]))}
  ${msel('owner', 'Task owner', 'All owners', 'owners', uniq(P.tasks.map(t => t.owner)).map(same))}
  ${msel('res', 'Role or resource', 'All resources', 'resources', [...P.resources].map(r => r.name).sort((a, b) => a.localeCompare(b)).map(same))}
  ${msel('status', 'Status', 'All statuses', 'statuses', STATUSES.map(same))}
  ${msel('cat', 'Category', 'All categories', 'categories', uniq(P.tasks.map(t => t.category)).map(same))}
  ${filterActive() ? '<button class="btn sm" data-act="clearFilters">✕ Clear</button>' : ''}
  ${withLevel ? `<label>Show levels <select data-act-change="level">${[1, 2, 3, 4, 5, 6].map(n => opt(String(n), String(UI.level), 'L' + n + (n === 6 ? ' (all)' : ''))).join('')}</select></label>` : ''}${extra}`;
}

/* ---------- plan numbers ---------- */
function planStats() {
  const ls = leaves(), T = todayN();
  const tw = ls.reduce((a, t) => a + Math.max(t.dur, 1), 0);
  const prog = tw ? Math.round(ls.reduce((a, t) => a + Math.max(t.dur, 1) * t.progress, 0) / tw) : 0;
  const overdue = ls.filter(t => t.status !== 'Done' && d2n(t.end) < T);
  const late = ls.filter(t => t.status === 'Not started' && d2n(t.start) < T && d2n(t.end) >= T);
  const next30 = ls.filter(t => t.status !== 'Done' && d2n(t.end) >= T && d2n(t.end) <= T + 30);
  const counts = Object.fromEntries(STATUSES.map(s => [s, ls.filter(t => t.status === s).length]));
  const ms = P.tasks.filter(t => t.ms);
  const nextMs = ms.filter(t => t.status !== 'Done' && d2n(t.end) >= T).sort((a, b) => a.end.localeCompare(b.end));
  return { ls, prog, overdue, late, next30, counts, ms, nextMs, finish: P.tasks.reduce((m, t) => t.end > m ? t.end : m, ''), start: P.tasks.reduce((m, t) => !m || t.start < m ? t.start : m, '') };
}

/* ---------- views ---------- */
function statusStack(ts) {
  const n = ts.length || 1;
  return `<div class="stack" role="img" aria-label="${STATUSES.map(s => `${s}: ${ts.filter(t => t.status === s).length}`).join(', ')}">` + STATUSES.map(s => {
    const c = ts.filter(t => t.status === s).length;
    return c ? `<i style="flex:${c / n};background:${stColor(s)}" data-tip="${esc(s)}: ${c} task${c === 1 ? '' : 's'}"></i>` : '';
  }).join('') + '</div>';
}
const statusLegend = () => `<div class="legend">${STATUSES.map(s => `<span><i style="background:${stColor(s)}"></i>${ST_META[s][0]} ${s}</span>`).join('')}</div>`;

function viewSummary() {
  const S = planStats(), stages = P.tasks.filter(t => !parentOf(t)), T = todayN();
  const cats = uniq(S.ls.map(t => t.category || '(No category)'));
  const catRows = cats.map(c => { const ts = S.ls.filter(t => (t.category || '(No category)') === c); const w = ts.reduce((a, t) => a + Math.max(t.dur, 1), 0); return { c, ts, p: w ? Math.round(ts.reduce((a, t) => a + Math.max(t.dur, 1) * t.progress, 0) / w) : 0, next: ts.filter(t => t.status !== 'Done').map(t => t.end).filter(e => d2n(e) >= T).sort()[0] }; }).sort((a, b) => b.ts.length - a.ts.length);
  const owners = uniq(S.ls.map(t => t.owner || '(Unassigned)')).map(o => ({ o, ts: S.ls.filter(t => (t.owner || '(Unassigned)') === o) })).sort((a, b) => b.ts.length - a.ts.length);
  const beyond = P.meta.projectEnd ? stages.filter(s => s.end > P.meta.projectEnd).length : 0;
  const welcome = UI.welcome ? `<div class="card" style="margin-bottom:12px;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap"><div>👋 <b>Welcome!</b> Everything here is editable and saves automatically in your browser. Click any task to open its details, or head to the <a href="#" data-act="goto" data-tab="gantt">Gantt</a> to drag bars and draw dependencies.</div><div><button class="btn sm" data-act="help">Quick guide</button> <button class="btn sm" data-act="dismissWelcome">Got it</button></div></div>` : '';
  return `${welcome}<section class="card hero">
    <h1 contenteditable="true" spellcheck="false" data-meta="title" aria-label="Project title">${esc(P.meta.title)}</h1>
    <div class="ink2" contenteditable="true" data-meta="subtitle" aria-label="Subtitle">${esc(P.meta.subtitle)}</div>
    <p contenteditable="true" data-meta="headline" aria-label="Project headline">${esc(P.meta.headline)}</p>
  </section>
  <section class="grid kpis mt">
    <div class="card kpi"><small>Overall progress</small><b>${S.prog}%</b><div class="progress"><i style="width:${S.prog}%;background:var(--pri)"></i></div><span>Weighted by task duration</span></div>
    <div class="card kpi"><small>Tasks completed</small><b>${S.counts['Done']} / ${S.ls.length}</b><span>${S.counts['Ongoing'] + S.counts['Review and QA']} in progress</span></div>
    <div class="card kpi link" data-act="goto" data-tab="health"><small>⚠ Overdue</small><b>${S.overdue.length}</b><span>${S.late.length} more should have started</span></div>
    <div class="card kpi"><small>Due in next 30 days</small><b>${S.next30.length}</b><span>Tasks finishing by ${fmtS(n2d(T + 30))}</span></div>
    <div class="card kpi link" data-act="goto" data-tab="milestones"><small>◆ Next milestone</small><b style="font-size:17px">${S.nextMs[0] ? fmt(S.nextMs[0].end) : 'None'}</b><span>${S.nextMs[0] ? esc(S.nextMs[0].name.slice(0, 52)) : 'No upcoming milestones'}</span></div>
    <div class="card kpi"><small>Plan runs</small><b style="font-size:17px">${fmtS(S.start)} → ${fmtS(S.finish)}</b><span>${beyond ? `${beyond} stage${beyond > 1 ? 's' : ''} past the ${fmtS(P.meta.projectEnd)} project end` : 'Within project end date'}</span></div>
  </section>
  <section class="card mt"><h3>Timeline by stage</h3>${stageTimeline(stages, S)}</section>
  <h3 style="margin:16px 0 8px;font-size:15px">Main tasks by stage</h3>
  <section class="grid stages">${stages.map(s => stageCard(s)).join('')}</section>
  <div class="mt">${statusLegend()}</div>
  <section class="grid two mt">
    <div class="card"><h3>Task categories</h3>
      <table><thead><tr><th>Category</th><th>Tasks</th><th style="width:34%">Progress</th><th>Next due</th></tr></thead><tbody>
      ${catRows.map(r => `<tr><td>${esc(r.c)}</td><td>${r.ts.length}</td><td><div class="progress" data-tip="${r.p}% complete"><i style="width:${r.p}%;background:var(--pri)"></i></div></td><td class="nowrap">${fmtS(r.next)}</td></tr>`).join('')}
      </tbody></table></div>
    <div class="card"><h3>Who's doing what</h3>
      ${owners.map(o => `<div class="meta"><span>${esc(o.o)}</span><span>${o.ts.length} tasks</span></div>${statusStack(o.ts)}`).join('')}
    </div>
    <div class="card"><h3>◆ Coming up</h3>${S.nextMs.slice(0, 7).map(t => miniRow(t, fmtS(t.end))).join('') || '<div class="muted">No upcoming milestones.</div>'}</div>
    <div class="card"><h3>⚠ Needs attention</h3>${[...S.overdue].sort((a, b) => a.end.localeCompare(b.end)).slice(0, 7).map(t => miniRow(t, fmtS(t.end))).join('') || '<div class="muted">Nothing overdue. Nice work! 🎉</div>'}</div>
  </section>`;
}
const miniRow = (t, right) => `<div class="mini-row" data-open="${t.id}"><span><span class="muted">${esc(t.wbs)}</span> ${esc(t.name)}</span><span class="nowrap ink2">${right}</span></div>`;
function stageCard(s) {
  const ls = leavesOf(s), subs = I.kids.get(s.id);
  const qa = s.qa ? s.qa.split(/;|\n/).map(x => x.trim()).filter(Boolean).slice(0, 8) : [];
  return `<article class="card stage">
    <div class="stage-head"><span class="dot" style="background:${stageColor(s)}"></span><div><h4><a href="#" data-open="${s.id}" style="color:inherit;text-decoration:none">${esc(s.wbs)}. ${esc(s.name)}</a></h4></div></div>
    <p>${esc(s.scope)}</p>
    <div class="meta"><span>${fmtS(s.start)} → ${fmtS(s.end)}</span><b>${s.progress}%</b></div>
    <div class="progress"><i style="width:${s.progress}%;background:${stageColor(s)}"></i></div>
    ${statusStack(ls)}
    <div class="meta"><span>${ls.length} tasks · ${pill(s.status)}</span><a href="#" data-act="focusStage" data-wbs="${esc(s.wbs)}">View in Gantt →</a></div>
    ${subs.length ? `<details><summary>${subs.length} sub-phases</summary>${subs.map(k => `<div class="sub-row"><span class="muted">${esc(k.wbs)}</span><a href="#" data-open="${k.id}" style="color:inherit;text-decoration:none">${esc(k.name)}</a><span>${k.progress}%</span></div>`).join('')}</details>` : ''}
    ${qa.length ? `<details><summary>Main QA / consultancy tasks</summary><ul class="qa-list">${qa.map(q => `<li>${esc(q)}</li>`).join('')}</ul></details>` : ''}
  </article>`;
}
function stageTimeline(stages, S) {
  if (!stages.length) return '';
  const W = 1000, L = 250, rh = 24, H = stages.length * rh + 22, r0 = d2n(S.start), r1 = d2n(S.finish), x = n => L + (n - r0) / Math.max(1, r1 - r0) * (W - L - 12);
  const y0 = +S.start.slice(0, 4), y1 = +S.finish.slice(0, 4); let g = '';
  for (let y = y0; y <= y1; y++) { const n = Math.floor(Date.UTC(y, 0, 1) / 864e5); if (n >= r0) g += `<line x1="${x(n)}" x2="${x(n)}" y1="0" y2="${H - 18}" stroke="var(--line)"/>`; g += `<text x="${Math.max(x(n), L) + 3}" y="${H - 5}">${y}</text>`; }
  const T = todayN(); const tl = T >= r0 && T <= r1 ? `<line x1="${x(T)}" x2="${x(T)}" y1="0" y2="${H - 18}" stroke="var(--today)" stroke-width="1.5" stroke-dasharray="4 3"/>` : '';
  const bars = stages.map((s, i) => {
    const a = x(d2n(s.start)), b = Math.max(x(d2n(s.end) + 1), a + 4), y = i * rh + 4;
    return `<text x="0" y="${y + 12}">${esc(s.wbs)}. ${esc(s.name.length > 38 ? s.name.slice(0, 37) + '…' : s.name)}</text>
    <g data-open="${s.id}" style="cursor:pointer" data-tip="${esc(s.wbs + '. ' + s.name)}\n${fmt(s.start)} → ${fmt(s.end)}\n${s.progress}% complete"><rect x="${a}" y="${y - 3}" width="${b - a}" height="22" fill="transparent"/><rect x="${a}" y="${y + 2}" width="${b - a}" height="12" rx="4" fill="${stageColor(s)}" fill-opacity=".3"/><rect x="${a}" y="${y + 2}" width="${(b - a) * s.progress / 100}" height="12" rx="4" fill="${stageColor(s)}"/></g>`;
  }).join('');
  return `<svg class="tl-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Stage timeline">${g}${bars}${tl}</svg><div class="legend"><span><i style="background:var(--today)"></i>Today (${fmtS(n2d(T))})</span><span class="muted">Solid part of each bar = progress</span></div>`;
}

function viewWbs() {
  const rows = visibleRows(), T = todayN(), vis = new Set(rows.map(t => t.id));
  return `<div class="bar-tools">${filterBar()}<span class="grow"></span>
    <button class="btn" data-act="expandAll">Expand</button><button class="btn" data-act="collapseAll">Collapse</button>
    <button class="btn pri" data-act="addStage">＋ Stage</button></div>
  <div class="scroll" data-scroll="wbs"><table><thead><tr><th>Task</th><th>Category</th><th>Task owner</th><th>Assigned role</th><th>Other participant</th><th>Status</th><th>%</th><th>Days</th><th>Start</th><th>End</th><th>Predecessors</th><th></th></tr></thead><tbody>
  ${rows.map(t => {
    const sum = isSum(t), lock = sum ? 'locked' : '', late = t.status !== 'Done' && d2n(t.end) < T;
    return `<tr class="${sum ? 'sum' : ''} d${t.depth}" data-row="${t.id}">
    <td><div class="tname" style="padding-left:${(t.depth - 1) * 14}px"><button class="caret ${sum ? '' : 'none'}" data-act="toggle" data-id="${t.id}" aria-label="Expand or collapse">${collapsed.has(t.id) && !filterActive() ? '▶' : '▼'}</button><span class="muted nowrap" style="font-size:12px;font-weight:400">${esc(t.wbs)}</span>${t.ms ? '<span class="ms" data-tip="Milestone">◆</span>' : ''}<span class="txt" data-open="${t.id}" data-tip="${esc(t.name)}">${esc(t.name)}</span></div></td>
    <td data-e="category" class="nowrap">${esc(t.category)}</td><td data-e="owner" class="nowrap">${esc(t.owner)}</td><td data-e="role" class="nowrap">${esc(t.role)}</td><td data-e="other" class="nowrap">${esc(t.other)}</td>
    <td ${sum ? 'class="locked"' : 'data-e="status"'}>${pill(t.status)}</td>
    <td ${sum ? 'class="locked"' : 'data-e="progress"'}>${t.progress}</td>
    <td ${sum ? 'class="locked"' : 'data-e="dur"'}>${t.dur}</td>
    <td ${sum ? 'class="locked nowrap"' : 'data-e="start" class="nowrap"'}>${fmtS(t.start)}</td>
    <td ${sum ? `class="locked nowrap ${late ? 'late' : ''}"` : `data-e="end" class="nowrap ${late ? 'late' : ''}"`}>${fmtS(t.end)}</td>
    <td data-e="deps" class="nowrap" data-tip="${esc(t.depNote || '')}">${esc(depStr(t))}</td>
    <td><div class="row-act">${moveBtns(t, vis)}<button data-act="addChild" data-id="${t.id}" data-tip="Add sub-task" aria-label="Add sub-task">＋</button><button data-act="addMsUnder" data-id="${t.id}" data-tip="Add milestone" aria-label="Add milestone">◆</button><button data-act="delTask" data-id="${t.id}" data-tip="Delete" aria-label="Delete">🗑</button></div></td></tr>`;
  }).join('') || `<tr><td colspan="12"><div class="empty"><div class="big">🔍</div>No tasks match these filters.</div></td></tr>`}
  </tbody></table></div>`;
}
function startCellEdit(td) {
  const id = td.closest('[data-row]').dataset.row, t = I.byId.get(id), f = td.dataset.e;
  if (td.querySelector('input,select')) return;
  let ed;
  if (f === 'status') ed = `<select>${STATUSES.map(s => opt(s, t.status)).join('')}</select>`;
  else if (RES_FIELDS.includes(f)) ed = `<select style="min-width:170px">${resOptions(t[f])}</select>`;
  else if (f === 'start' || f === 'end') ed = `<input type="date" value="${t[f]}">`;
  else if (f === 'dur' || f === 'progress') ed = `<input type="number" min="0" ${f === 'progress' ? 'max="100"' : ''} value="${t[f]}" style="width:60px">`;
  else if (f === 'deps') ed = `<input value="${esc(depStr(t))}" placeholder="1.2; 1.3 (SS)+2" style="width:150px">`;
  else ed = `<input value="${esc(t[f])}" style="min-width:120px">`;
  td.innerHTML = ed;
  const el = td.firstElementChild; el.focus(); if (el.select) el.select();
  let done = false;
  const finish = ok => {
    if (done) return; done = true;
    const v = el.value;
    if (ok && v === NEW_RES) { renderView(); dlgResource(name => setField(t, f, name)); return; }
    if (ok && String(v) !== String(f === 'deps' ? depStr(t) : t[f])) {
      if (!commit(`Changed ${f} of ${t.wbs}`, () => setField(t, f, v))) renderView();
    } else renderView();
  };
  el.addEventListener('blur', () => finish(true));
  el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } if (e.key === 'Escape') finish(false); });
  if (el.tagName === 'SELECT') el.addEventListener('change', () => finish(true));
}

/* ---------- gantt ---------- */
function monthsBetween(r0, r1) {
  const out = []; let d = new Date(r0 * 864e5); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  while (d.getTime() / 864e5 <= r1) { out.push({ n: d.getTime() / 864e5, y: d.getUTCFullYear(), m: d.getUTCMonth() }); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); }
  return out;
}
let G = null;
function viewGantt() {
  return `<div class="bar-tools">${filterBar()}</div>
  <div class="bar-tools">
    <span style="display:inline-flex;gap:3px" role="group" aria-label="Zoom">${[...Object.keys(ZOOMS), 'Fit'].map(z => `<button class="btn sm ${UI.zoom === z ? 'on' : ''}" data-act="zoom" data-z="${z}">${z}</button>`).join('')}</span>
    <button class="btn sm" data-act="scrollToday">📍 Today</button>
    <label>Colour <select data-act-change="colorBy">${[['stage', 'Stage'], ['status', 'Status'], ['owner', 'Owner']].map(([v, l]) => opt(v, UI.colorBy, l)).join('')}</select></label>
    <button class="btn sm ${UI.links ? 'on' : ''}" data-act="flag" data-k="links">🔗 Links</button>
    <label data-tip="Text shown next to each bar. With Assigned role, tasks with no role show their owner in italics.">🏷 Labels <select data-act-change="labels">${[['', 'None'], ['role', 'Assigned role'], ['owner', 'Task owner'], ['status', 'Status']].map(([v, l]) => opt(v, UI.labels, l)).join('')}</select></label>
    <button class="btn sm ${UI.base ? 'on' : ''}" data-act="flag" data-k="base" data-tip="Grey line under each bar = saved baseline">📐 Baseline</button>
    <button class="btn sm ${UI.crit ? 'on' : ''}" data-act="flag" data-k="crit" data-tip="Chain of tasks driving the finish of the selected task (or stage 7 if none is selected)">🔥 Critical path</button>
    <span class="grow"></span>
    <button class="btn sm" data-act="manageLinks">🔗 Manage dependencies</button>
    <button class="btn sm" data-act="addMilestone">◆ Add milestone</button>
    <button class="btn sm pri" data-act="addTaskDlg">＋ Task</button>
  </div>
  <div class="g-wrap" id="gWrap" data-scroll="gantt"><div class="g-in" id="gIn"></div></div>
  <div class="legend mt"><span>Drag a bar to move it · drag its right edge to resize · drag the ○ at its end onto another bar to link them · click a link to edit it · hover a task name for ▲▼ to reorder</span><span>Labels: assigned role; <i style="all:unset;font-style:italic">owner in italics</i> if no role is set</span>
    <span><i style="background:var(--today)"></i>Today</span><span><i style="background:var(--warn)"></i>Project end</span><span style="color:var(--ink2)">◆ Milestone</span></div>`;
}
function barColor(t) {
  if (UI.colorBy === 'status') return stColor(t.status);
  if (UI.colorBy === 'owner') { const o = G.owners.indexOf(t.owner); return o >= 0 && o < 8 ? `var(--s${o + 1})` : 'var(--s9)'; }
  return stageColor(t);
}
function renderGantt() {
  const wrap = $('#gWrap'); if (!wrap) return;
  const rows = visibleRows();
  const src = rows.length ? rows : P.tasks;
  const min = src.reduce((m, t) => Math.min(m, d2n(t.start)), Infinity), max = src.reduce((m, t) => Math.max(m, d2n(t.end)), -Infinity);
  const leftW = window.innerWidth <= 720 ? 210 : 370;
  let ppd, r0, r1;
  if (UI.zoom === 'Fit') { r0 = min - 3; r1 = max + 6; ppd = Math.max(0.15, (wrap.clientWidth - leftW - 24) / (r1 - r0)); }
  else { ppd = ZOOMS[UI.zoom]; r0 = min - Math.ceil(40 / ppd); r1 = max + Math.ceil((UI.labels ? 320 : 60) / ppd); }
  const W = Math.ceil((r1 - r0) * ppd), rh = 30, H = Math.max(rows.length * rh, 60), x = n => (n - r0) * ppd;
  G = { rows, ppd, r0, x, rh, owners: uniq(P.tasks.map(t => t.owner)), rowIdx: new Map(rows.map((t, i) => [t.id, i])) };
  const T = todayN(), selT = UI.sel && I.byId.get(UI.sel);

  // header
  let h = '', top = '', grid = '';
  const months = monthsBetween(r0, r1);
  const unit = ppd >= 15 ? 'day' : ppd >= 5 ? 'week' : ppd >= 1.5 ? 'month' : 'quarter';
  if (unit === 'day' || unit === 'week') {
    months.forEach(m => { top += `<text class="top-t" x="${Math.max(x(m.n), 0) + 4}" y="17">${MONTHS[m.m]} ${m.y}</text><line x1="${x(m.n)}" x2="${x(m.n)}" y1="0" y2="46"/>`; grid += `<line class="gl" x1="${x(m.n)}" x2="${x(m.n)}" y1="0" y2="${H}"/>`; });
    for (let n = r0; n <= r1; n++) {
      if (unit === 'day') h += `<text x="${x(n) + 5}" y="38" style="font-size:10px">${new Date(n * 864e5).getUTCDate()}</text>`;
      else if (dow(n) === 1) h += `<text x="${x(n) + 2}" y="38" style="font-size:10px">${new Date(n * 864e5).getUTCDate()}</text>`;
      if (!isWork(n)) grid += `<rect class="we" x="${x(n)}" y="0" width="${ppd}" height="${H}"/>`;
    }
  } else {
    const years = new Map(); months.forEach(m => { if (!years.has(m.y)) years.set(m.y, m.n); });
    years.forEach((n, y) => { top += `<text class="top-t" x="${Math.max(x(n), 0) + 4}" y="17">${y}</text><line x1="${x(n)}" x2="${x(n)}" y1="0" y2="46"/>`; grid += `<line class="gl" x1="${x(n)}" x2="${x(n)}" y1="0" y2="${H}" style="opacity:1"/>`; });
    months.forEach(m => {
      if (unit === 'month') { h += `<text x="${x(m.n) + 3}" y="38" style="font-size:10px">${MONTHS[m.m]}</text>`; grid += `<line class="gl" x1="${x(m.n)}" x2="${x(m.n)}" y1="0" y2="${H}"/>`; }
      else if (m.m % 3 === 0) { h += `<text x="${x(m.n) + 3}" y="38" style="font-size:10px">Q${m.m / 3 + 1}</text>`; grid += `<line class="gl" x1="${x(m.n)}" x2="${x(m.n)}" y1="0" y2="${H}"/>`; }
    });
  }

  // critical chain
  let cc = null;
  if (UI.crit) { const tgt = selT || I.byWbs.get('7') || P.tasks[P.tasks.length - 1]; cc = drivingChain(tgt); }

  // arrows
  let arrows = '';
  if (UI.links) {
    const vis = t => { let c = t; while (c && !G.rowIdx.has(c.id)) c = parentOf(c); return c; };
    const seen = new Set();
    P.tasks.forEach(s => s.deps.forEach(d => {
      const p = I.byId.get(d.id), a = vis(p), b = vis(s);
      if (!a || !b || a === b || isAncestorCode(a.wbs, b.wbs) || isAncestorCode(b.wbs, a.wbs)) return;
      const agg = a !== p || b !== s, key = a.id + '>' + b.id;
      if (agg && seen.has(key)) return; seen.add(key);
      const startSide = d.type === 'SS' || d.type === 'SF', endSide = d.type === 'FF' || d.type === 'SF';
      const y1 = G.rowIdx.get(a.id) * rh + rh / 2, y2 = G.rowIdx.get(b.id) * rh + rh / 2;
      const x1 = startSide ? x(d2n(a.start)) : x(d2n(a.end) + 1), x2 = endSide ? x(d2n(b.end) + 1) : x(d2n(b.start));
      const out = startSide ? -8 : 8, inn = endSide ? 8 : -8, ym = y1 + (y2 > y1 ? rh / 2 : -rh / 2);
      let path;
      if (!startSide && !endSide && x2 - x1 >= 16) path = `M${x1} ${y1}H${(x1 + 8)}V${y2}H${x2 - 1}`;
      else path = `M${x1} ${y1}H${x1 + out}V${ym}H${x2 + inn}V${y2}H${x2 + (endSide ? 1 : -1)}`;
      const crit = cc && cc.links.has(d.id + '>' + s.id);
      arrows += `<path class="arw-hit" d="${path}" data-dep="${s.id}|${d.id}" data-tip="${esc(p.wbs + ' → ' + s.wbs)} · ${DEP_LABEL[d.type]}${d.lag ? ' · lag ' + d.lag + 'd' : ''}${agg ? '\n(rolled up – expand rows to see the exact link)' : ''}\nClick to edit"/><path class="arw ${crit ? 'c' : ''} ${agg ? 'agg' : ''}" d="${path}" marker-end="url(#${crit ? 'arrowCrit' : 'arrowHead'})"/>`;
    }));
  }

  // bars
  const base = P.baseline && P.baseline.map;
  const barsHtml = rows.map((t, i) => {
    const y = i * rh, a = x(d2n(t.start)), b = Math.max(x(d2n(t.end) + 1), a + 3), w = b - a, col = barColor(t), sum = isSum(t), cy = y + rh / 2;
    const tip = `${t.wbs} ${t.name}\n${fmt(t.start)} → ${fmt(t.end)} (${t.dur} workdays)\n${t.status} · ${t.progress}%${t.owner ? '\nOwner: ' + t.owner : ''}${t.role ? '\nRole: ' + t.role : ''}`;
    const inCrit = cc && cc.chain.has(t.id);
    let s = `<g class="bar" data-id="${t.id}" data-tip="${esc(tip)}">`;
    if (UI.base && base && base[t.id]) { const bx = x(d2n(base[t.id][0])), be = x(d2n(base[t.id][1]) + 1); s += `<rect class="base" x="${bx}" y="${y + rh - 7}" width="${Math.max(be - bx, 2)}" height="3" rx="1.5"/>`; }
    const milestoneOnly = t.ms && t.dur === 0 && !sum;
    if (milestoneOnly) { /* diamond only */ }
    else if (sum) {
      s += `<rect data-h="move" x="${a}" y="${cy - 5}" width="${w}" height="10" fill="transparent"/><rect data-h="move" x="${a}" y="${cy - 3}" width="${w}" height="6" rx="3" fill="${col}"/><rect data-h="move" x="${a}" y="${cy - 3}" width="${Math.max(w * t.progress / 100, 0)}" height="6" rx="3" fill="var(--ink)" fill-opacity=".45"/>`;
    } else {
      s += `<rect class="tr" data-h="move" x="${a}" y="${cy - 8}" width="${w}" height="16" rx="4" fill="${col}"/>` + (t.progress ? `<rect data-h="move" x="${a}" y="${cy - 8}" width="${w * t.progress / 100}" height="16" rx="4" fill="${col}"/>` : '') + `<rect class="rz" data-h="resize" x="${b - 5}" y="${cy - 8}" width="8" height="16"/>`;
    }
    if (inCrit && !milestoneOnly) s += `<rect class="crit" x="${a - 1.5}" y="${cy - (sum ? 5 : 10)}" width="${w + 3}" height="${sum ? 10 : 20}" rx="5"/>`;
    let right = b;
    if (t.ms) { const mx = x(d2n(t.end)) + ppd / 2 + (milestoneOnly ? 0 : ppd / 2); s += `<path class="dia" data-h="${sum ? 'none' : 'move'}" d="M${mx} ${cy - 8}L${mx + 8} ${cy}L${mx} ${cy + 8}L${mx - 8} ${cy}Z" fill="${t.status === 'Done' ? 'var(--st-dn)' : inCrit ? 'var(--crit)' : 'var(--s4)'}"/>`; right = Math.max(b, mx + 8); }
    s += `<rect x="${right}" y="${cy - 8}" width="16" height="16" fill="transparent" data-h="none"/><circle class="lnk" data-h="link" cx="${right + 9}" cy="${cy}" r="5"/>`;
    const lab = UI.labels === 'owner' ? t.owner : UI.labels === 'status' ? t.status : t.role || t.owner;
    if (UI.labels && lab) s += `<text class="lbl ${UI.labels === 'role' && !t.role ? 'alt' : ''}"x="${right + 18}" y="${cy + 4}">${esc(lab.length > 46 ? lab.slice(0, 45) + '…' : lab)}</text>`;
    return s + '</g>';
  }).join('');
  const rowLines = rows.map((t, i) => (t.id === UI.sel ? `<rect class="selb" x="0" y="${i * rh}" width="${W}" height="${rh}"/>` : '') + `<line class="rl" x1="0" x2="${W}" y1="${(i + 1) * rh - .5}" y2="${(i + 1) * rh - .5}"/>`).join('');
  const peLine = [P.meta.projectStart, P.meta.projectEnd].filter(v => v && d2n(v) >= r0 && d2n(v) <= r1).map(v => `<line class="pe" x1="${x(d2n(v))}" x2="${x(d2n(v))}" y1="0" y2="${H}"/>`).join('');
  const todayLine = T >= r0 && T <= r1 ? `<line class="today" x1="${x(T) + ppd / 2}" x2="${x(T) + ppd / 2}" y1="0" y2="${H}"/>` : '';

  const vis = new Set(rows.map(t => t.id));
  const left = rows.map(t => `<div class="g-row ${isSum(t) ? 'sum' : ''} ${t.id === UI.sel ? 'sel' : ''}" data-row="${t.id}" style="padding-left:${(t.depth - 1) * 11 + 4}px">
    <button class="caret ${isSum(t) ? '' : 'none'}" data-act="toggle" data-id="${t.id}" aria-label="Expand or collapse">${collapsed.has(t.id) && !filterActive() ? '▶' : '▼'}</button><code>${esc(t.wbs)}</code>${t.ms ? '<span class="ms">◆</span>' : ''}<span class="txt" data-open="${t.id}" data-tip="${esc(t.name)}">${esc(t.name)}</span><span class="g-mv">${moveBtns(t, vis)}</span><span data-tip="${esc(t.status)}" style="color:${stColor(t.status)};font-size:11px">${ST_META[t.status][0]}</span></div>`).join('');

  const st = { l: wrap.scrollLeft, t: wrap.scrollTop };
  $('#gIn').innerHTML = `<div class="g-left"><div class="g-lh">Task</div>${left || '<div class="empty">No tasks match.</div>'}</div>
  <div class="g-right" style="width:${W}px"><div class="g-rh"><svg width="${W}" height="46">${top}${h}</svg></div>
  <svg class="g-body" id="gBody" width="${W}" height="${H}">
    <defs><marker id="arrowHead" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L7 3.5L0 7Z"/></marker><marker id="arrowCrit" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L8 4L0 8Z"/></marker></defs>
    ${grid}${rowLines}${peLine}${todayLine}${arrows}${barsHtml}
  </svg></div>`;
  wrap.scrollLeft = st.l; wrap.scrollTop = st.t;
}
function scrollGanttToToday() {
  const wrap = $('#gWrap'); if (!wrap || !G) return;
  wrap.scrollLeft = Math.max(0, G.x(todayN()) - 120);
}
let drag = null;
function ganttPointerDown(e) {
  const hEl = e.target.closest('[data-h]'), g = e.target.closest('.bar');
  if (!g || !hEl || e.button !== 0) return;
  const role = hEl.dataset.h; if (role === 'none') return;
  const t = I.byId.get(g.dataset.id);
  const svg = $('#gBody');
  drag = { role, t, g, x0: e.clientX, y0: e.clientY, moved: false, svg, pid: e.pointerId };
  if (role === 'resize' && isSum(t)) drag.role = 'move';
  svg.setPointerCapture(e.pointerId);
  e.preventDefault();
}
function ganttPointerMove(e) {
  if (!drag) return;
  const dx = e.clientX - drag.x0;
  if (!drag.moved && Math.abs(dx) < 3 && Math.abs(e.clientY - drag.y0) < 3) return;
  drag.moved = true; hideTip();
  if (drag.role === 'move') { drag.g.setAttribute('transform', `translate(${dx},0)`); drag.g.classList.add('dragging'); showTip(`${drag.t.wbs}: ${dx >= 0 ? '+' : ''}${Math.round(dx / G.ppd)} days`, e.clientX, e.clientY); }
  else if (drag.role === 'resize') { const r = drag.g.querySelector('.tr'); if (r) { if (drag.w0 == null) drag.w0 = +r.getAttribute('width'); r.setAttribute('width', Math.max(3, drag.w0 + dx)); } showTip(`Ends ${fmt(n2d(d2n(drag.t.end) + Math.round(dx / G.ppd)))}`, e.clientX, e.clientY); }
  else if (drag.role === 'link') {
    if (!drag.line) { const c = drag.g.querySelector('.lnk'); drag.line = document.createElementNS('http://www.w3.org/2000/svg', 'line'); drag.line.setAttribute('class', 'rubber'); drag.line.setAttribute('x1', c.getAttribute('cx')); drag.line.setAttribute('y1', c.getAttribute('cy')); drag.svg.appendChild(drag.line); }
    const b = drag.svg.getBoundingClientRect(); drag.line.setAttribute('x2', e.clientX - b.left); drag.line.setAttribute('y2', e.clientY - b.top);
    const over = document.elementFromPoint(e.clientX, e.clientY); const og = over && over.closest('.bar');
    showTip(og && og !== drag.g ? `Link ${drag.t.wbs} → ${I.byId.get(og.dataset.id).wbs}` : 'Drop on the task that should follow', e.clientX, e.clientY);
  }
}
function ganttPointerUp(e) {
  if (!drag) return;
  const d = drag; drag = null; hideTip();
  try { d.svg.releasePointerCapture(d.pid); } catch (err) { /* already released */ }
  const days = Math.round((e.clientX - d.x0) / G.ppd), t = d.t;
  if (!d.moved) { if (d.role !== 'link') openTask(t.id); return; }
  if (d.role === 'link') {
    if (d.line) d.line.remove();
    const over = document.elementFromPoint(e.clientX, e.clientY), og = over && over.closest('.bar');
    if (og && og !== d.g) tryLink(t, I.byId.get(og.dataset.id), 'FS', 0);
    return;
  }
  if (!days) { renderGantt(); return; }
  if (d.role === 'move') commit(`Moved ${t.wbs} by ${days} days`, () => { shiftTask(t, days); rollup(); const wanted = t.start; cascade([t, ...descendants(t)]); followsLinks(t, wanted); });
  else commit(`Resized ${t.wbs}`, () => setField(t, 'end', n2d(Math.max(d2n(t.start), d2n(t.end) + days))));
}
function tryLink(p, s, type, lag) {
  const err = linkError(p, s);
  if (err) return toast(err, 1), false;
  commit(`Linked ${p.wbs} → ${s.wbs} (${type})`, () => { s.deps.push({ id: p.id, type, lag }); index(); const n = propagate([s]); toast(`Linked ${p.wbs} → ${s.wbs}` + (n ? ` · ${n} task${n > 1 ? 's' : ''} rescheduled` : '')); });
  return true;
}

/* ---------- drawer ---------- */
function openTask(id) { UI.sel = id; renderDrawer(); if (UI.tab === 'gantt') renderGantt(); }
function renderDrawer() {
  const dr = $('#drawer'), t = UI.sel && I.byId.get(UI.sel);
  if (!t) { dr.hidden = true; dr.innerHTML = ''; return; }
  const sum = isSum(t), dis = sum ? 'disabled' : '', par = parentOf(t);
  const dl = P.tasks.filter(x => x !== t).map(x => `<option value="${esc(x.wbs)}">${esc(x.name.slice(0, 70))}</option>`).join('');
  const depRow = (d, succ) => {
    const o = I.byId.get(d.id);
    return `<div class="dep-row" data-dep-row="${t.id}|${d.id}"><span class="nm" data-open="${o.id}" data-tip="${esc(o.name)}">${esc(o.wbs)} ${esc(o.name)}</span><select data-dep-f="type" aria-label="Type">${DEP_TYPES.map(x => opt(x, d.type)).join('')}</select><input data-dep-f="lag" type="number" value="${d.lag || 0}" aria-label="Lag in workdays"><button class="btn sm" data-act="rmDep" data-s="${t.id}" data-p="${d.id}" aria-label="Remove">✕</button></div>`;
  };
  const succs = I.succ.get(t.id).map(s => ({ s, d: s.deps.find(x => x.id === t.id) }));
  dr.innerHTML = `<div class="dr-head"><div><small>${par ? esc(par.wbs + ' · ' + par.name) : 'Stage'}</small><h3 style="font-size:16px">${esc(t.wbs)} · ${esc(t.name)}</h3></div><button class="btn icon" data-act="closeDrawer" aria-label="Close">✕</button></div>
  ${sum ? '<div class="muted" style="font-size:12.5px;margin-bottom:8px">📎 This is a summary row. Its dates, status and progress roll up from its sub-tasks.</div>' : ''}
  <div class="form" data-task="${t.id}">
    <label class="full">Task name<input data-f="name" value="${esc(t.name)}"></label>
    <label>Start<input type="date" data-f="start" value="${t.start}" ${dis}></label>
    <label>End<input type="date" data-f="end" value="${t.end}" ${dis}></label>
    <label>Duration (workdays)<input type="number" min="0" data-f="dur" value="${t.dur}" ${dis}></label>
    <label>Progress %<input type="number" min="0" max="100" data-f="progress" value="${t.progress}" ${dis}></label>
    <label>Status<select data-f="status" ${dis}>${STATUSES.map(s => opt(s, t.status)).join('')}</select></label>
    <label>Category<input data-f="category" value="${esc(t.category)}" list="dlCats"></label>
    <label>Task owner<select data-f="owner">${resOptions(t.owner)}</select></label>
    <label>Assigned role<select data-f="role">${resOptions(t.role)}</select></label>
    <label class="full">Other participant<select data-f="other">${resOptions(t.other)}</select></label>
    <label>WBS code<input data-f="wbs" value="${esc(t.wbs)}" ${dis}></label>
    <label>SOW reference<input data-f="sow" value="${esc(t.sow)}"></label>
    <label class="full" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" data-f="ms" ${t.ms ? 'checked' : ''} style="width:auto"> ◆ Mark as a milestone</label>
    <label class="full">Scope &amp; deliverable<textarea data-f="scope" rows="3">${esc(t.scope)}</textarea></label>
    <label class="full">Notes<textarea data-f="notes" rows="2" placeholder="Anything the team should know…">${esc(t.notes)}</textarea></label>
  </div>
  <datalist id="dlCats">${uniq(P.tasks.map(x => x.category)).map(o => `<option value="${esc(o)}">`).join('')}</datalist>
  <datalist id="dlTasks">${dl}</datalist>
  <div class="section-t">⬅ Depends on (predecessors) <small style="font-weight:400">— type · lag in workdays</small></div>
  ${t.deps.map(d => depRow(d)).join('') || '<div class="muted" style="font-size:12.5px;margin-bottom:6px">No predecessors yet.</div>'}
  <div class="dep-add"><input id="addPred" list="dlTasks" placeholder="WBS code, e.g. 1.2.3" aria-label="Predecessor WBS code"><select id="addPredType" aria-label="Type">${DEP_TYPES.map(x => opt(x, 'FS')).join('')}</select><input id="addPredLag" type="number" value="0" aria-label="Lag"><button class="btn sm" data-act="addPred" data-id="${t.id}">Add</button></div>
  ${t.depNote ? `<div class="muted" style="font-size:12px;margin-top:5px">Workbook note: ${esc(t.depNote)}</div>` : ''}
  <div class="section-t">➡ Followed by (successors)</div>
  ${succs.map(({ s, d }) => `<div class="dep-row" style="grid-template-columns:1fr 62px 28px"><span class="nm" data-open="${s.id}">${esc(s.wbs)} ${esc(s.name)}</span><span class="muted">${d.type}${d.lag ? (d.lag > 0 ? '+' : '') + d.lag : ''}</span><button class="btn sm" data-act="rmDep" data-s="${s.id}" data-p="${t.id}" aria-label="Remove">✕</button></div>`).join('') || '<div class="muted" style="font-size:12.5px;margin-bottom:6px">Nothing follows this task yet.</div>'}
  <div class="dep-add" style="grid-template-columns:1fr 62px 58px auto"><input id="addSucc" list="dlTasks" placeholder="WBS code of next task" aria-label="Successor WBS code"><select id="addSuccType" aria-label="Type">${DEP_TYPES.map(x => opt(x, 'FS')).join('')}</select><input id="addSuccLag" type="number" value="0" aria-label="Lag"><button class="btn sm" data-act="addSucc" data-id="${t.id}">Add</button></div>
  ${t.qa ? `<div class="section-t">Main QA / consultancy tasks</div><div class="ink2" style="font-size:12.5px">${esc(t.qa)}</div>` : ''}
  ${t.note ? `<div class="section-t">Status note</div><div class="ink2" style="font-size:12.5px">${esc(t.note)}</div>` : ''}
  <div class="dlg-actions" style="justify-content:space-between"><button class="btn danger" data-act="delTask" data-id="${t.id}">🗑 Delete</button><span><button class="btn icon" data-act="moveUp" data-id="${t.id}" data-tip="Move up" aria-label="Move up">▲</button> <button class="btn icon" data-act="moveDown" data-id="${t.id}" data-tip="Move down" aria-label="Move down">▼</button> <button class="btn" data-act="addChild" data-id="${t.id}">＋ Sub-task</button> <button class="btn" data-act="addMsUnder" data-id="${t.id}">◆ Milestone</button></span></div>`;
  dr.hidden = false;
}

/* ---------- other views ---------- */
function viewMilestones() {
  const T = todayN();
  let ms = P.tasks.filter(t => t.ms && match(t)).sort((a, b) => a.end.localeCompare(b.end));
  if (UI.msFilter === 'open') ms = ms.filter(t => t.status !== 'Done');
  if (UI.msFilter === 'done') ms = ms.filter(t => t.status === 'Done');
  const base = P.baseline && P.baseline.map;
  return `<div class="bar-tools">${filterBar(`<label>Show <select data-act-change="msFilter">${[['open', 'Open'], ['done', 'Done'], ['all', 'All']].map(([v, l]) => opt(v, UI.msFilter, l)).join('')}</select></label>`, false)}<span class="grow"></span><button class="btn pri" data-act="addMilestone">◆ Add milestone</button></div>
  <div class="scroll" data-scroll="ms"><table><thead><tr><th>WBS</th><th>Milestone</th><th>Stage</th><th>Owner</th><th>Date</th><th>When</th><th>vs baseline</th><th>Status</th><th></th></tr></thead><tbody>
  ${ms.map(t => {
    const dd = d2n(t.end) - T, done = t.status === 'Done', slip = base && base[t.id] ? d2n(t.end) - d2n(base[t.id][1]) : null;
    return `<tr><td class="muted">${esc(t.wbs)}</td><td><span class="ms">◆</span> <a href="#" data-open="${t.id}" style="color:inherit">${esc(t.name)}</a></td><td class="ink2">${esc(stageOf(t).wbs)}. ${esc(stageOf(t).name.slice(0, 30))}</td><td>${esc(t.owner)}</td><td class="nowrap">${fmt(t.end)}</td>
    <td class="nowrap ${!done && dd < 0 ? 'late' : ''}">${done ? '—' : dd < 0 ? `${-dd} days late` : dd === 0 ? 'Today' : `in ${dd} days`}</td><td class="nowrap">${slip == null ? '—' : slip === 0 ? 'On plan' : (slip > 0 ? '+' : '') + slip + ' d'}</td><td>${pill(t.status)}</td>
    <td class="nowrap">${isSum(t) ? '' : `<button class="btn sm" data-act="msDone" data-id="${t.id}">${done ? 'Reopen' : '✓ Done'}</button>`} <button class="btn sm" data-act="msOff" data-id="${t.id}" data-tip="Remove milestone flag (keeps the task)">✕</button></td></tr>`;
  }).join('') || `<tr><td colspan="9"><div class="empty"><div class="big">◆</div>No milestones here yet. Add one to mark a key date.</div></td></tr>`}
  </tbody></table></div>`;
}
const BOARD_CAP = 40;
function viewBoard() {
  const ls = leaves().filter(match);
  return `<div class="bar-tools">${filterBar('', false)}</div><div class="board">${STATUSES.map(s => {
    const cards = ls.filter(t => t.status === s).sort((a, b) => a.start.localeCompare(b.start)), cap = UI.boardShow[s] || BOARD_CAP;
    return `<div class="col" data-col="${esc(s)}"><h4><span>${ST_META[s][0]} ${esc(s)}</span><span class="count">${cards.length}</span></h4>
    ${cards.slice(0, cap).map(t => `<div class="kard" draggable="true" data-card="${t.id}" data-open="${t.id}" style="border-left-color:${stageColor(t)}">${t.ms ? '<span class="ms">◆</span> ' : ''}${esc(t.name)}<small><span>${esc(t.wbs)}</span><span>${fmtS(t.end)}</span></small><small><span>${esc(t.owner)}</span></small></div>`).join('')}
    ${cards.length > cap ? `<button class="btn sm" data-act="boardMore" data-s="${esc(s)}">Show ${Math.min(BOARD_CAP, cards.length - cap)} more</button>` : ''}</div>`;
  }).join('')}</div>`;
}
function viewWorkload() {
  const ls = leaves().filter(match);
  const T = todayN(), t0 = new Date(T * 864e5);
  const periods = [];
  if (UI.wlUnit === 'month') {
    for (let i = -1; i < 23; i++) { const a = Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth() + i, 1) / 864e5, b = Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth() + i + 1, 1) / 864e5 - 1, d = new Date(a * 864e5); periods.push({ a, b, l: `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}` }); }
  } else {
    const S = planStats(); let d = new Date(d2n(S.start) * 864e5); d = new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1));
    while (d.getTime() / 864e5 <= d2n(S.finish)) { const a = d.getTime() / 864e5, nx = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1)); periods.push({ a, b: nx.getTime() / 864e5 - 1, l: `Q${d.getUTCMonth() / 3 + 1} ${String(d.getUTCFullYear()).slice(2)}` }); d = nx; }
  }
  const NONE = '(Unassigned)';
  const NO_OWNER = '(No task owner)';
  const counts = list => periods.map(p => list.filter(t => t.status !== 'Done' && d2n(t.start) <= p.b && d2n(t.end) >= p.a).length);
  const heat = (key, title, stacked, sectionBy) => {
    const secName = t => t[sectionBy] || NO_OWNER;
    const names = sectionBy ? [...uniq(ls.map(t => t[sectionBy])), ...(ls.some(t => !t[sectionBy]) ? [NO_OWNER] : [])] : [''];
    const sections = names.map(name => {
      const list = sectionBy ? ls.filter(t => secName(t) === name) : ls;
      const groups = uniq(list.map(t => t[key])); if (list.some(t => !t[key])) groups.push(NONE); // unassigned goes last
      return { name, total: counts(list), rows: groups.map(g => ({ g, vals: counts(list.filter(t => (t[key] || NONE) === g)) })) };
    });
    const rows = sections.flatMap(s => s.rows), named = rows.filter(r => r.g !== NONE);
    const max = Math.max(1, ...(named.length ? named : rows).flatMap(r => r.vals)); // a large unassigned row must not wash out the rest
    const row = (s, r) => { const who = (s.name ? s.name + ' · ' : '') + r.g; return `<tr><td class="${s.name ? 'wl-sub' : ''}" data-tip="${esc(who)}">${esc(r.g)}</td>${r.vals.map((v, j) => `<td style="background:${v ? `color-mix(in srgb,var(--s1) ${Math.round(8 + 62 * Math.min(1, v / max))}%,transparent)` : 'transparent'}" data-tip="${esc(who)}\n${periods[j].l}: ${v} open task${v === 1 ? '' : 's'}">${v || ''}</td>`).join('')}</tr>`; };
    const head = s => (s.name ? `<tr class="wl-sec"><td data-tip="${esc(s.name)}: all open tasks">${esc(s.name)}</td>${s.total.map(v => `<td>${v || ''}</td>`).join('')}</tr>` : '');
    return `<h3 class="wl-t">${title}</h3><div class="scroll" data-scroll="wl-${key}"${stacked ? ' style="max-height:none"' : ''}><table class="heat"><thead><tr><th>Open tasks active in period</th>${periods.map(p => `<th>${p.l}</th>`).join('')}</tr></thead><tbody>
    ${rows.length ? sections.map(s => head(s) + s.rows.map(r => row(s, r)).join('')).join('') : `<tr><td>No tasks match.</td></tr>`}
    </tbody></table></div><div class="legend" style="margin-top:6px"><span>Darker = more open tasks at the same time (busiest assigned cell: ${max}).${sectionBy ? ' Bold rows are the total for each task owner.' : ''}</span></div>`;
  };
  const both = UI.wlBy === 'both';
  const LABEL = { owner: 'By task owner', role: 'By assigned role, within each task owner', other: 'By other participant' };
  return `<div class="bar-tools">${filterBar(`<label>Show <select data-act-change="wlBy">${[['both', 'Owner and role'], ['owner', 'Task owner'], ['role', 'Assigned role'], ['other', 'Other participant']].map(([v, l]) => opt(v, UI.wlBy, l)).join('')}</select></label><label>Period <select data-act-change="wlUnit">${[['month', 'Next 24 months'], ['quarter', 'Quarters (whole plan)']].map(([v, l]) => opt(v, UI.wlUnit, l)).join('')}</select></label>`, false)}</div>
  ${(both ? ['owner', 'role'] : [UI.wlBy]).map(k => heat(k, LABEL[k], both, k === 'role' ? 'owner' : '')).join('')}`;
}
function viewRisks() {
  const rs = P.risks;
  const score = r => (+r.prob || 0) * (+r.impact || 0);
  const lvl = s => s >= 15 ? ['High', 'var(--danger)'] : s >= 8 ? ['Medium', 'var(--warn)'] : ['Low', 'var(--good)'];
  const n = v => [1, 2, 3, 4, 5].map(x => opt(String(x), String(v))).join('');
  return `<div class="bar-tools"><b>Risks, issues, actions and decisions</b> <span class="muted">${rs.filter(r => r.status !== 'Closed').length} open</span><span class="grow"></span><button class="btn pri" data-act="addRisk">＋ Add entry</button></div>
  ${rs.length ? `<div class="scroll"><table><thead><tr><th>Type</th><th>Title</th><th>WBS</th><th>Owner</th><th>Prob.</th><th>Impact</th><th>Score</th><th>Status</th><th>Due</th><th>Mitigation / next step</th><th></th></tr></thead><tbody>
  ${rs.map(r => { const s = score(r), L = lvl(s); return `<tr data-risk="${esc(r.id)}"><td><select data-rf="type" style="width:82px">${['Risk', 'Issue', 'Action', 'Decision'].map(x => opt(x, r.type)).join('')}</select></td><td><input data-rf="title" value="${esc(r.title)}" style="min-width:200px"></td><td><input data-rf="wbs" value="${esc(r.wbs)}" style="width:70px"></td><td><input data-rf="owner" value="${esc(r.owner)}" style="min-width:110px"></td><td><select data-rf="prob" style="width:50px">${n(r.prob)}</select></td><td><select data-rf="impact" style="width:50px">${n(r.impact)}</select></td><td class="nowrap"><b>${s}</b> <span style="color:${L[1]}">${L[0]}</span></td><td><select data-rf="status" style="width:95px">${['Open', 'Mitigating', 'Closed'].map(x => opt(x, r.status)).join('')}</select></td><td><input type="date" data-rf="due" value="${esc(r.due)}" style="width:130px"></td><td><input data-rf="plan" value="${esc(r.plan)}" style="min-width:220px"></td><td><button class="btn sm" data-act="delRisk" data-id="${esc(r.id)}" aria-label="Delete">🗑</button></td></tr>`; }).join('')}
  </tbody></table></div>` : `<div class="card empty"><div class="big">🌤️</div>No entries yet. The workbook has no risk register, so this log starts empty.<br><br><button class="btn pri" data-act="addRisk">＋ Log the first risk</button></div>`}`;
}
function healthChecks() {
  const ls = leaves(), T = todayN(), out = [];
  const push = (id, sev, title, desc, items) => out.push({ id, sev: items.length ? sev : 'ok', title, desc, items });
  push('overdue', 'bad', 'Overdue tasks', 'End date has passed and the task is not marked Done.', ls.filter(t => t.status !== 'Done' && d2n(t.end) < T).map(t => [t, `ended ${fmtS(t.end)} · ${t.status}`]));
  push('late', 'warn', 'Should have started', 'Start date has passed but the status is still Not started.', ls.filter(t => t.status === 'Not started' && d2n(t.start) < T && d2n(t.end) >= T).map(t => [t, `start ${fmtS(t.start)}`]));
  const viol = []; P.tasks.forEach(t => t.deps.forEach(d => { const r = requiredStart(t, d); if (r > d2n(t.start)) viol.push([t, `starts ${fmtS(t.start)}, but ${I.byId.get(d.id).wbs} (${d.type}) requires ${fmtS(n2d(r))}`]); }));
  push('viol', 'bad', 'Dependency conflicts', 'The task starts before its predecessor allows. “Apply dependencies to all tasks” above moves these.', viol);
  push('gap', 'warn', 'Waiting after a dependency', 'The task starts later than its links require, usually dates carried over from the workbook. It moves to the required date when it or a predecessor next changes, or when you use “Apply dependencies to all tasks” above.', ls.filter(t => t.deps.length && snap(Math.max(depsReq(t), floorFrom(t))) < d2n(t.start)).map(t => [t, `starts ${fmtS(t.start)}, links require ${fmtS(n2d(snap(Math.max(depsReq(t), floorFrom(t)))))}`]));
  const stale = P.tasks.filter(t => isSum(t) && t.srcStatus && t.srcStatus !== t.status).map(t => [t, `workbook said “${t.srcStatus}”, sub-tasks roll up to “${t.status}”`]);
  push('stat', 'warn', 'Summary status differs from workbook', 'The app derives each summary status from its sub-tasks; these differ from the value typed in the workbook.', stale);
  const span = P.tasks.filter(t => isSum(t) && t.srcStart && (t.srcStart !== t.start || t.srcEnd !== t.end) && P.baseline && P.baseline.map[t.id] && P.baseline.map[t.id][0] === t.srcStart).map(t => [t, `workbook ${fmtS(t.srcStart)}–${fmtS(t.srcEnd)}, sub-tasks span ${fmtS(t.start)}–${fmtS(t.end)}`]);
  push('span', 'warn', 'Summary dates differ from workbook', 'Summary rows show the true span of their sub-tasks.', span);
  push('dup', 'bad', 'Duplicate WBS codes', 'The same code is used twice, so links to it go to the first one. Open the task and give it a unique code.', P.tasks.filter(t => P.tasks.some(o => o !== t && o.wbs === t.wbs)).map(t => [t, 'duplicate code']));
  push('note', 'warn', 'Unresolved dependency text', 'Workbook dependency text that could not be turned into a link.', P.tasks.filter(t => /Unknown predecessor|after project end/i.test(t.depNote)).map(t => [t, t.depNote]));
  push('own', 'warn', 'Tasks without an owner', 'Bottom-level tasks with no task owner.', ls.filter(t => !t.owner).map(t => [t, 'no owner']));
  push('dur', 'warn', 'Tasks without a duration', 'Bottom-level tasks with a zero duration that are not milestones.', ls.filter(t => !t.dur && !t.ms).map(t => [t, 'no duration']));
  if (P.meta.projectStart) push('begin', 'bad', 'Before the project start date', `Bottom-level tasks starting before the project start date (${fmtS(P.meta.projectStart)}).`, ls.filter(t => t.start < P.meta.projectStart).map(t => [t, `starts ${fmtS(t.start)}`]));
  if (P.meta.projectEnd) push('end', 'bad', 'Past the project end date', `Bottom-level tasks finishing after the project end date (${fmtS(P.meta.projectEnd)}). Warranty tasks may be expected here.`, ls.filter(t => t.end > P.meta.projectEnd).map(t => [t, `ends ${fmtS(t.end)}`]));
  return out;
}
function viewHealth() {
  const C = healthChecks();
  const rank = { bad: 0, warn: 1, ok: 2 };
  C.sort((a, b) => rank[a.sev] - rank[b.sev]);
  const clean = C.filter(c => c.sev === 'ok').length;
  return `<div class="bar-tools"><b>${clean} of ${C.length} checks are clear</b><span class="grow"></span><button class="btn" data-act="fitEnd">📏 Fit tasks to project end</button><button class="btn" data-act="fixConflicts">🛠 Apply dependencies to all tasks</button></div>
  <div class="grid">${C.map(c => `<div class="card chk ${c.sev}"><details ${UI.openChk === c.id ? 'open' : ''}><summary><b>${c.sev === 'ok' ? '✓' : c.sev === 'bad' ? '⚠' : '•'} ${esc(c.title)}</b><span class="count">${c.items.length}</span></summary><p>${esc(c.desc)}</p>
  <div class="chk-list">${c.items.slice(0, 200).map(([t, m]) => `<div data-open="${t.id}"><span class="muted">${esc(t.wbs)}</span> ${esc(t.name)} — <span class="ink2">${esc(m)}</span></div>`).join('')}${c.items.length > 200 ? `<div class="muted">…and ${c.items.length - 200} more</div>` : ''}</div></details></div>`).join('')}</div>`;
}
function chainBehind(t) { // t and the tasks before it, following the link that sets each start, whether or not a gap has opened up
  const out = [], seen = new Set();
  for (let cur = t; cur && !seen.has(cur.id);) {
    seen.add(cur.id); out.push(cur);
    let next = null, best = -Infinity;
    [cur, ...ancestors(cur)].forEach(a => a.deps.forEach(d => { const r = requiredStart(a, d); if (r > best) { best = r; next = I.byId.get(d.id); } }));
    cur = next && leavesOf(next).reduce((a, b) => (b.end > a.end ? b : a));
  }
  return out;
}
const FIT_MAX_CUT = 0.25;
function fitToEnd() { // shortens the longest task on the chain behind each late task, by at most a quarter of its original length, so short check and sign-off steps keep theirs
  const pe = P.meta.projectEnd, peN = d2n(pe), was = new Map(), stuck = new Set(), auto = P.settings.autoSched;
  P.settings.autoSched = true;
  for (let guard = 0; guard < 500; guard++) {
    const late = leaves().filter(t => t.end > pe && !stuck.has(t.id)).sort((a, b) => (a.end < b.end ? 1 : -1))[0];
    if (!late) break;
    const before = late.end;
    propagate([late]); // a gap after its predecessor is the first thing to close
    if (late.end !== before) continue;
    const room = t => Math.floor((was.has(t.id) ? was.get(t.id) : t.dur) * FIT_MAX_CUT) - ((was.has(t.id) ? was.get(t.id) : t.dur) - t.dur);
    const c = chainBehind(late).filter(t => !t.ms && room(t) > 0).sort((a, b) => b.dur - a.dur)[0];
    if (!c) { stuck.add(late.id); continue; }
    if (!was.has(c.id)) was.set(c.id, c.dur);
    c.dur -= Math.min(wcount(peN + 1, d2n(late.end)), room(c)); setLeafStart(c, d2n(c.start)); propagate([c]);
    if (late.end === before) stuck.add(late.id);
  }
  P.settings.autoSched = auto;
  const changes = [...was].map(([id, from]) => ({ t: I.byId.get(id), from })).filter(x => x.t.dur !== x.from).sort((a, b) => wbsCmp(a.t, b.t));
  return { changes, left: leaves().filter(t => t.end > pe) };
}
function warnPastEnd() {
  const n = P.meta.projectEnd ? leaves().filter(t => t.end > P.meta.projectEnd).length : 0;
  if (n) toast(`${n} task${n > 1 ? 's already finish' : ' already finishes'} after the project end date. They stay where they are; Plan Health lists them.`);
}
function viewSettings() {
  return `<div class="grid two">
  <div class="card"><h3>Project</h3><div class="form">
    <label class="full">Title<input data-meta-in="title" value="${esc(P.meta.title)}"></label>
    <label class="full">Subtitle<input data-meta-in="subtitle" value="${esc(P.meta.subtitle)}"></label>
    <label>Project start date<input type="date" data-meta-in="projectStart" value="${esc(P.meta.projectStart || '')}"></label>
    <label>Project end date<input type="date" data-meta-in="projectEnd" value="${esc(P.meta.projectEnd)}"></label>
    <label class="full" style="flex-direction:row;gap:8px;align-items:center"><input type="checkbox" id="lockEnd" style="width:auto" ${P.settings.lockEnd ? 'checked' : ''}> Tasks cannot go past the project end date</label>
    <label class="full">Source<input value="${esc(P.meta.source || '')}" disabled></label>
  </div></div>
  <div class="card"><h3>Schedule rules</h3><div class="form">
    <label class="full" style="flex-direction:row;gap:8px;align-items:center"><input type="checkbox" id="autoSched" style="width:auto" ${P.settings.autoSched ? 'checked' : ''}> Schedule tasks from their dependencies: a task with a predecessor starts according to the link type and lag</label>
    <label class="full">Holidays, one date per line (YYYY-MM-DD). Weekends are Saturday and Sunday.<textarea id="holidays" rows="4" placeholder="2027-01-01">${esc((P.settings.holidays || []).join('\n'))}</textarea></label>
  </div><p class="muted" style="font-size:12.5px;margin:8px 0 0">The workbook counts no holidays, so none are set. Adding them only affects tasks you change afterwards.</p></div>
  <div class="card"><h3>Baseline</h3><p class="ink2" style="margin-top:0">Current baseline: <b>${esc((P.baseline && P.baseline.label) || 'none')}</b>${P.baseline ? ` · ${fmt(P.baseline.savedAt.slice(0, 10))}` : ''}. Compare against it on the Gantt and Milestones tabs.</p><button class="btn" data-act="setBaseline">📐 Save current plan as baseline</button></div>
  <div class="card"><h3>Start over</h3><p class="ink2" style="margin-top:0">Replace the shared plan for everyone with the original workbook plan. Save a project file first if you want a copy.</p><button class="btn danger" data-act="resetPlan">↺ Reset to original plan</button></div>
  <div class="card" style="grid-column:1/-1"><h3>Activity log</h3><div style="max-height:320px;overflow:auto">${P.log.map(l => `<div class="mini-row" style="cursor:default"><span>${esc(l.what)}</span><span class="muted nowrap">${l.by ? esc(l.by) + ' · ' : ''}${esc(new Date(l.at).toLocaleString())}</span></div>`).join('') || '<div class="muted">Changes you make will be listed here.</div>'}</div></div>
  </div>`;
}

/* ---------- rendering ---------- */
const VIEWS = { summary: viewSummary, wbs: viewWbs, gantt: viewGantt, milestones: viewMilestones, board: viewBoard, resources: viewResources, workload: viewWorkload, risks: viewRisks, health: viewHealth, settings: viewSettings };
function renderTabs() {
  const S = healthChecks().filter(c => c.sev === 'bad').length;
  $('#tabs').innerHTML = TABS.map(([id, ic, l]) => `<button role="tab" aria-selected="${UI.tab === id}" data-act="goto" data-tab="${id}">${ic} ${l}${id === 'health' && S ? `<span class="count">${S}</span>` : ''}</button>`).join('');
}
function rememberScroll() { $$('[data-scroll]').forEach(el => { scrollMem[el.dataset.scroll] = [el.scrollLeft, el.scrollTop]; }); }
function renderView() {
  rememberScroll();
  $('#view').innerHTML = VIEWS[UI.tab]();
  if (UI.tab === 'gantt') renderGantt();
  $$('[data-scroll]').forEach(el => { const m = scrollMem[el.dataset.scroll]; if (m) { el.scrollLeft = m[0]; el.scrollTop = m[1]; } });
  if (UI.tab === 'gantt' && !scrollMem.gantt) scrollGanttToToday();
  if (UI.flash) { // keep a moved row in view and show where it landed
    const el = $(`#view [data-row="${UI.flash}"]`), box = el && el.closest('[data-scroll]'); UI.flash = null;
    if (el) { const l = box ? box.scrollLeft : 0; el.scrollIntoView({ block: 'nearest' }); if (box) box.scrollLeft = l; el.classList.add('flash'); }
  }
}
function renderGanttFresh() { // timeline range changes, so the old scroll offset is meaningless
  $('#view').innerHTML = VIEWS.gantt(); renderGantt(); delete scrollMem.gantt; scrollGanttToToday();
}
function renderAll() { $('#appTitle').textContent = P.meta.title + ' · Planner'; renderTabs(); renderView(); renderDrawer(); saveUI(); }

/* ---------- ui helpers ---------- */
let toastHold = null;
function toast(msg, err) {
  if (toastHold && !err) { toastHold.push(msg); return; }
  const d = document.createElement('div'); d.className = 'toast' + (err ? ' err' : ''); d.textContent = msg;
  $('#toast').appendChild(d); setTimeout(() => d.remove(), err ? 5000 : 3000);
}
function showTip(text, x, y) { const t = $('#tip'); t.textContent = text; t.hidden = false; t.style.left = Math.min(x + 14, innerWidth - t.offsetWidth - 8) + 'px'; t.style.top = Math.min(y + 14, innerHeight - t.offsetHeight - 8) + 'px'; }
function hideTip() { $('#tip').hidden = true; }
function dialog(title, body, onOk, okLabel = 'Save') {
  const m = $('#modal');
  m.innerHTML = `<h3>${esc(title)}</h3><form method="dialog" id="dlgForm">${body}<div class="dlg-actions"><button type="button" class="btn" data-act="dlgClose">${onOk ? 'Cancel' : 'Close'}</button>${onOk ? `<button class="btn pri" value="ok">${esc(okLabel)}</button>` : ''}</div></form>`;
  $('#dlgForm').addEventListener('submit', e => { e.preventDefault(); if (onOk && onOk(new FormData(e.target)) !== false) m.close(); });
  m.showModal();
}
function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
const stamp = () => new Date().toISOString().slice(0, 10);
function parentOptions() { return P.tasks.filter(t => t.depth <= 3).map(t => opt(t.id, '', `${t.wbs} ${t.name.slice(0, 60)}`)).join(''); }

function dlgAddTask(isMs, parent) {
  dialog(isMs ? '◆ Add a milestone' : '＋ Add a task', `<div class="form">
    <label class="full">Name<input name="name" required autofocus placeholder="${isMs ? 'e.g. Steering Committee approval' : 'e.g. Draft test plan'}"></label>
    <label class="full">Goes under<select name="parent">${parent ? opt(parent.id, parent.id, `${parent.wbs} ${parent.name.slice(0, 60)}`) : parentOptions()}</select></label>
    <label>${isMs ? 'Date' : 'Start'}<input type="date" name="date" required value="${n2d(snap(todayN()))}"></label>
    ${isMs ? '' : '<label>Duration (workdays)<input type="number" name="dur" min="1" value="5"></label>'}
    <label class="full">Depends on (optional WBS code)<input name="pred" placeholder="e.g. 1.2.3"></label></div>`, fd => {
    const par = I.byId.get(fd.get('parent')), pc = String(fd.get('pred') || '').trim();
    const p = pc ? I.byWbs.get(pc) : null;
    if (pc && !p) { toast(`No task with WBS ${pc}`, 1); return false; }
    commit(`Added ${isMs ? 'milestone' : 'task'} “${fd.get('name')}”`, () => {
      const t = addTask(par, { name: String(fd.get('name')), start: fd.get('date'), dur: isMs ? 0 : Math.max(1, +fd.get('dur') || 1), ms: isMs });
      if (p) { const err = linkError(p, t); if (err) toast(err, 1); else { t.deps.push({ id: p.id, type: 'FS', lag: 0 }); index(); } }
      propagate([t]); UI.sel = t.id;
    });
  }, 'Add');
}
function dlgDep(succId, predId) {
  const s = I.byId.get(succId), p = I.byId.get(predId), d = s.deps.find(x => x.id === predId);
  if (!d) return;
  dialog('Edit dependency', `<p class="ink2" style="margin-top:0"><b>${esc(p.wbs)}</b> ${esc(p.name)}<br>→ <b>${esc(s.wbs)}</b> ${esc(s.name)}</p><div class="form"><label>Type<select name="type">${DEP_TYPES.map(x => opt(x, d.type, DEP_LABEL[x])).join('')}</select></label><label>Lag (workdays, negative = overlap)<input type="number" name="lag" value="${d.lag || 0}"></label></div><div style="margin-top:10px"><button type="button" class="btn danger" data-act="rmDep" data-s="${s.id}" data-p="${p.id}" data-close="1">🗑 Remove this link</button></div>`, fd => {
    commit(`Edited link ${p.wbs} → ${s.wbs}`, () => { d.type = fd.get('type'); d.lag = +fd.get('lag') || 0; propagate([s]); });
  });
}
function dlgLinks() {
  const all = []; P.tasks.forEach(s => s.deps.forEach(d => all.push({ s, d, p: I.byId.get(d.id) })));
  const dl = P.tasks.map(x => `<option value="${esc(x.wbs)}">${esc(x.name.slice(0, 70))}</option>`).join('');
  dialog('🔗 Manage dependencies', `<div class="section-t" style="margin-top:0">Add a dependency</div><div class="form" style="grid-template-columns:1fr 1fr 110px 70px"><label>This task finishes first<input name="p" list="dlAll" placeholder="WBS, e.g. 1.2"></label><label>…before this one<input name="s" list="dlAll" placeholder="WBS, e.g. 1.3"></label><label>Type<select name="type">${DEP_TYPES.map(x => opt(x, 'FS')).join('')}</select></label><label>Lag<input type="number" name="lag" value="0"></label></div><datalist id="dlAll">${dl}</datalist>
  <div class="section-t">All dependencies (${all.length})</div><div style="max-height:40vh;overflow:auto"><table><thead><tr><th>From</th><th>To</th><th>Type</th><th>Lag</th><th></th></tr></thead><tbody>${all.map(({ s, d, p }) => `<tr><td data-tip="${esc(p.name)}">${esc(p.wbs)}</td><td data-tip="${esc(s.name)}">${esc(s.wbs)}</td><td>${d.type}</td><td>${d.lag || 0}</td><td><button type="button" class="btn sm" data-act="editDep" data-s="${s.id}" data-p="${p.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>`, fd => {
    const p = I.byWbs.get(String(fd.get('p')).trim()), s = I.byWbs.get(String(fd.get('s')).trim());
    return tryLink(p, s, fd.get('type'), +fd.get('lag') || 0) ? undefined : false;
  }, 'Add link');
}
function dlgHelp() {
  dialog('👋 Quick guide', `<ul class="help" style="padding-left:18px;margin:0">
  <li><b>Open a task:</b> click its name anywhere to edit all its details in the side panel.</li>
  <li><b>WBS:</b> click a cell to edit it. Use ＋ on a row to add a sub-task and ◆ for a milestone. Grey summary values roll up automatically.</li>
  <li><b>Change dates:</b> on the Gantt, drag a bar to move it and drag its right edge to resize.</li>
  <li><b>Reorder tasks:</b> use ▲▼ on a row in the WBS or Gantt. A task moves among the tasks under the same parent and trades WBS codes with its neighbour. Links and dates stay the same.</li>
  <li><b>Resources:</b> pick owners, roles and participants from the dropdowns. Add to the list on the Resources tab, or with “Add new resource” in any dropdown.</li>
  <li><b>Add dependencies:</b> hover a bar and drag the ○ onto the next task, or use Manage dependencies. Types: FS, SS, FF, SF, with lag in workdays.</li>
  <li><b>Milestones:</b> use ◆ Add milestone, or tick “Mark as a milestone” on any task.</li>
  <li><b>Auto-scheduling:</b> a task with a predecessor starts on the date its link type and lag require. When a task moves, the tasks that follow it move too, earlier or later. To delay a linked task, edit the lag. Turn this off in Settings.</li>
  <li><b>Saving:</b> anyone with the link can view. Editors use “Sign in to edit”; their changes save automatically and everyone sees them within seconds.</li>
  <li><b>Backups:</b> use File › Save project file now and then to keep a copy.</li>
  <li><b>Undo:</b> Ctrl+Z and Ctrl+Y.</li></ul>`);
}
function dlgShare() {
  const onWeb = /^https?:/.test(location.protocol), url = location.href.split('#')[0];
  dialog('🔗 Share this plan', `<p class="ink2" style="margin-top:0">${onWeb ? 'Anyone with this link can open the plan:' : 'This copy is running from your computer. The online link is available once it is published.'}</p>
  ${onWeb ? `<input id="shareUrl" readonly value="${esc(url)}" style="width:100%"><div style="margin:8px 0 12px"><button type="button" class="btn sm" data-act="copyUrl">📋 Copy link</button></div>` : ''}
  <div class="section-t">How edits are shared</div><ul class="help ink2" style="padding-left:18px;margin:0">
  <li>Everyone with the link sees the same plan, and it updates within seconds. Viewing needs no account.</li>
  <li><b>To edit:</b> the owner adds your email to the editors list. You then use “Sign in to edit” and create an account with that email.</li>
  <li>If two people change the same field, the last change wins. Changes to different fields are all kept.</li>
  <li><b>To send someone a copy:</b> use File › Save project file or File › Export to Excel.</li></ul>`);
}

/* ---------- live shared plan (Firebase Firestore) ---------- */
// The config identifies the project and is not a secret; the Firestore rules decide who can write.
// Tasks are split across a fixed set of documents and written field by field, so two people editing different fields both keep their changes.
const FB_CONFIG = { apiKey: 'AIzaSyAqVQaKmvG_89ET7HZPROALrsd5CHcUyJ0', authDomain: 'nsdi-planner.firebaseapp.com', projectId: 'nsdi-planner', storageBucket: 'nsdi-planner.firebasestorage.app', messagingSenderId: '498535724427', appId: '1:498535724427:web:91ee968eb84863997a6b8e' };
const BUCKETS = 16;
const Live = { on: false, db: null, auth: null, user: null, canEdit: false, isOwner: false, seeded: false, first: true, base: null, stash: null, timer: 0, saving: 0, waitTimer: 0 };
const hashStr = s => { let h = 5381; for (const c of String(s)) h = ((h * 33) ^ c.codePointAt(0)) >>> 0; return h; };
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
const wbsCmp = (a, b) => { const x = a.wbs.split('.'), y = b.wbs.split('.'); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (i < x.length ? +x[i] : -1) - (i < y.length ? +y[i] : -1); if (d) return d; } return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; };
const logKey = l => 'l' + String(l.at).replace(/\D/g, '') + '_' + hashStr(l.what);
function toDocs(p) {
  const { savedAt, ...meta } = p.meta;
  const docs = { meta: { meta, settings: p.settings, baseline: p.baseline, stats: p.stats || {} }, risks: { items: {} }, resources: { items: {} }, log: { items: {} } };
  for (let i = 0; i < BUCKETS; i++) docs['b' + i] = { items: {} };
  p.tasks.forEach(t => { const { depth, ...rest } = t; docs['b' + (hashStr(t.id) % BUCKETS)].items[t.id] = rest; });
  p.risks.forEach(r => { docs.risks.items[r.id] = r; });
  p.resources.forEach(r => { docs.resources.items[r.id] = r; });
  p.log.forEach(l => { docs.log.items[logKey(l)] = l; });
  return JSON.parse(JSON.stringify(docs));
}
function flatDoc(doc) {
  const out = {};
  Object.entries(doc || {}).forEach(([k, v]) => {
    if (k === 'items') Object.entries(v || {}).forEach(([id, it]) => Object.entries(it || {}).forEach(([f, x]) => { out[`items.${id}.${f}`] = canon(x); }));
    else if (k === 'meta' || k === 'settings') Object.entries(v || {}).forEach(([f, x]) => { out[`${k}.${f}`] = canon(x); });
    else out[k] = canon(v);
  });
  return out;
}
const flatDocs = docs => Object.fromEntries(Object.entries(docs).map(([id, d]) => [id, flatDoc(d)]));
function unflatDocs(flat) {
  const docs = {};
  Object.entries(flat).forEach(([id, paths]) => {
    const d = docs[id] = {};
    Object.entries(paths).forEach(([path, val]) => { const seg = path.split('.'); let o = d; seg.slice(0, -1).forEach(s => { o = o[s] = o[s] || {}; }); o[seg[seg.length - 1]] = JSON.parse(val); });
  });
  return docs;
}
function fromDocs(docs) {
  const items = id => Object.values((docs[id] && docs[id].items) || {}), m = docs.meta || {}, tasks = [];
  for (let i = 0; i < BUCKETS; i++) tasks.push(...items('b' + i).filter(t => t && typeof t.id === 'string' && typeof t.wbs === 'string' && isISO(t.start) && isISO(t.end) && Array.isArray(t.deps))); // a field written to a task someone else just deleted leaves a fragment
  return { meta: Object.assign({}, m.meta, { savedAt: P.meta.savedAt }), settings: m.settings || {}, baseline: m.baseline, stats: m.stats || {}, tasks: tasks.sort(wbsCmp), risks: items('risks').sort((a, b) => (a.id < b.id ? 1 : -1)), resources: items('resources').sort((a, b) => String(a.name).localeCompare(String(b.name))), log: items('log').sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 200) };
}
function liveDiff(from, to) { // Firestore field updates that turn one flattened plan into the other
  const ops = {}, del = firebase.firestore.FieldValue.delete();
  Object.keys(to).forEach(id => {
    const a = from[id] || {}, b = to[id], o = {}, kept = new Set(Object.keys(b).map(p => p.split('.').slice(0, 2).join('.')));
    Object.keys(b).forEach(p => { if (a[p] !== b[p]) o[p] = JSON.parse(b[p]); });
    Object.keys(a).forEach(p => { if (p in b) return; const it = p.split('.').slice(0, 2).join('.'); if (p.startsWith('items.') && !kept.has(it)) o[it] = del; else o[p] = del; });
    if (Object.keys(o).length) ops[id] = o;
  });
  return ops;
}
function liveStatus(text) {
  if (!Live.on) return;
  setSaved(text || (Live.saving ? 'Saving…' : !Live.seeded ? 'The shared plan is not set up yet' : Live.canEdit ? 'All changes saved · live' : 'Live · view only'));
}
function pushChanges() {
  if (!Live.on || !Live.seeded || !Live.canEdit || !Live.base) return;
  const now = flatDocs(toDocs(P)), ops = liveDiff(Live.base, now), ids = Object.keys(ops);
  Live.base = now;
  if (!ids.length) return liveStatus();
  const batch = Live.db.batch();
  ids.forEach(id => batch.update(Live.db.collection('plan').doc(id), ops[id]));
  Live.saving++; liveStatus();
  clearTimeout(Live.waitTimer);
  Live.waitTimer = setTimeout(() => { if (Live.saving) liveStatus('Waiting for a connection · keep this page open'); }, 6000);
  batch.commit().then(() => { Live.saving--; liveStatus(); }).catch(() => { // the listener puts back the shared values
    Live.saving--; liveStatus(); toast('That change could not be saved to the shared plan', 1);
  });
}
const liveBusy = () => { const a = document.activeElement; return !!drag || $('#modal').open || !!(a && a.closest && a.closest('#view,#drawer') && (/INPUT|TEXTAREA|SELECT/.test(a.tagName) || a.isContentEditable)); };
function applyRemote() { // waits while someone is typing or dragging, so a redraw does not interrupt them
  clearTimeout(Live.timer);
  if (!Live.stash) return;
  if (liveBusy()) { Live.timer = setTimeout(applyRemote, 500); return; }
  const rem = flatDocs(Live.stash); Live.stash = null;
  if (Live.first) {
    Live.first = false;
    const mine = flatDocs(toDocs(P)), differs = Object.keys(rem).some(id => canon(rem[id]) !== canon(mine[id] || {}));
    let seenLive = false; try { seenLive = !!localStorage.getItem(KEY + '-live'); localStorage.setItem(KEY + '-live', '1'); } catch (e) { /* optional */ }
    const old = hadLocal && !seenLive && differs ? planFile() : null;
    adopt(fromDocs(unflatDocs(rem))); setLevel(UI.level);
    Live.base = flatDocs(toDocs(P)); persist(); renderAll(); liveStatus();
    if (old) {
      $('#banner').innerHTML = '<div><span>📬 This browser had its own copy of the plan. You are now seeing the shared plan.</span><span><button class="btn sm" id="oldSave">Download my old copy</button> <button class="btn sm" id="oldSkip">Dismiss</button></span></div>';
      $('#oldSave').onclick = () => download(`NSDI_Plan_my_old_copy_${stamp()}.json`, new Blob([old], { type: 'application/json' }));
      $('#oldSkip').onclick = () => { $('#banner').innerHTML = ''; };
    }
    return;
  }
  const base = Live.base, cur = flatDocs(toDocs(P));
  let changed = false;
  [...new Set([...Object.keys(base), ...Object.keys(rem)])].forEach(id => {
    const a = base[id] || {}, b = rem[id] || {}, c = cur[id] = cur[id] || {};
    Object.keys(b).forEach(p => { if (a[p] !== b[p]) { c[p] = b[p]; changed = true; } });
    Object.keys(a).forEach(p => { if (!(p in b)) { delete c[p]; changed = true; } });
  });
  if (!changed) return;
  adopt(fromDocs(unflatDocs(cur)));
  Live.base = flatDocs(toDocs(P));
  undoStack = []; redoStack = []; // an undo step could otherwise bring back what someone else just replaced
  persist(); renderAll(); liveStatus('Updated with the latest changes · ' + clock());
}
function showUploadBanner() {
  if (Live.seeded || !Live.on) return;
  $('#banner').innerHTML = Live.canEdit ? `<div><span>📤 The shared plan is empty. Upload the plan in this browser (${P.tasks.length} tasks) so everyone sees it.</span><span><button class="btn sm pri" data-act="liveUpload">Upload as the shared plan</button></span></div>` : '';
}
function onPlan(snap) {
  if (snap.empty) { if (!snap.metadata.fromCache) { Live.seeded = false; showUploadBanner(); liveStatus(); } return; }
  if (!Live.seeded) { Live.seeded = true; if ($('#banner [data-act=liveUpload]')) $('#banner').innerHTML = ''; }
  const docs = {}; snap.forEach(d => { docs[d.id] = d.data(); });
  Live.stash = docs;
  applyRemote();
}
function updateAuthUI() {
  const b = $('#authBtn'), u = Live.user;
  b.hidden = !Live.on;
  b.textContent = u ? '👤 ' + u.email.split('@')[0] : '👤 Sign in to edit';
  document.body.classList.toggle('ro', Live.on && !Live.canEdit);
}
async function refreshRole() {
  const u = Live.user;
  Live.canEdit = false; Live.isOwner = false;
  if (u && u.emailVerified) {
    try { await Live.db.collection('editors').limit(1).get(); Live.isOwner = true; Live.canEdit = true; } // the rules let only the owner list editors
    catch (e) { try { Live.canEdit = (await Live.db.collection('editors').doc(u.email.toLowerCase()).get()).exists; } catch (e2) { /* stays view only */ } }
  }
  if (u !== Live.user) return;
  updateAuthUI(); showUploadBanner(); liveStatus();
}
function liveStart() {
  if (!window.firebase) return setSaved('Online sync is unavailable · changes save in this browser only');
  firebase.initializeApp(FB_CONFIG);
  Live.db = firebase.firestore(); Live.auth = firebase.auth(); Live.on = true;
  updateAuthUI(); liveStatus('Connecting to the shared plan…');
  Live.auth.onAuthStateChanged(u => { Live.user = u; refreshRole(); });
  Live.db.collection('plan').onSnapshot(onPlan, () => { Live.on = false; updateAuthUI(); setSaved('Could not reach the shared plan · showing the copy in this browser'); });
}
const authMsg = e => ({ 'auth/invalid-credential': 'The email or password is not right.', 'auth/wrong-password': 'The email or password is not right.', 'auth/user-not-found': 'The email or password is not right.', 'auth/invalid-email': 'That email address is not valid.', 'auth/email-already-in-use': 'That email already has an account. Sign in, or use “Forgot password”.', 'auth/weak-password': 'Use a password of at least 6 characters.', 'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.', 'auth/network-request-failed': 'Could not reach the sign-in service. Check your connection.' }[e && e.code] || 'That did not work. Please try again.');
const authErr = t => { const el = $('#authErr'); if (el) el.textContent = t; };
function reopenAccount() { const m = $('#modal'); if (m.open) m.close(); dlgAccount(); }
function dlgAccount() {
  const u = Live.user, errP = '<p id="authErr" role="alert" style="margin:10px 0 0;color:var(--danger)"></p>';
  if (!u) {
    return dialog('👤 Sign in to edit', `<p class="ink2" style="margin-top:0">Viewing needs no account. To edit, use an account with an email on the editors list. You stay signed in on this browser.</p>
    <div class="form"><label class="full">Email<input type="email" name="email" required autocomplete="username"></label><label class="full">Password<input type="password" name="password" required autocomplete="current-password"></label></div>
    <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn sm" data-act="authCreate">Create an account</button><button type="button" class="btn sm" data-act="authForgot">Forgot password</button></div>${errP}`, fd => {
      Live.auth.signInWithEmailAndPassword(String(fd.get('email')).trim(), String(fd.get('password'))).then(() => { $('#modal').close(); toast('Signed in'); }, e => authErr(authMsg(e)));
      return false;
    }, 'Sign in');
  }
  if (!u.emailVerified) {
    return dialog('✉️ Confirm your email', `<p style="margin-top:0">We sent a confirmation link to <b>${esc(u.email)}</b>. Click it, then come back here. Check your spam folder if you can't find it.</p>
    <div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn pri" data-act="authCheck">I've confirmed it</button><button type="button" class="btn" data-act="authResend">Send it again</button><button type="button" class="btn" data-act="authOut">Sign out</button></div>${errP}`);
  }
  if (!Live.canEdit) {
    return dialog('👤 View only', `<p style="margin-top:0"><b>${esc(u.email)}</b> is not on the editors list yet. Ask the plan owner to add this address, then check again.</p>
    <div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn pri" data-act="authCheck">Check again</button><button type="button" class="btn" data-act="authOut">Sign out</button></div>${errP}`);
  }
  if (!Live.isOwner) {
    return dialog('👤 Your account', `<p style="margin-top:0">You are signed in as <b>${esc(u.email)}</b> and can edit the plan. Changes save automatically and everyone sees them within seconds.</p><button type="button" class="btn" data-act="authOut">Sign out</button>`);
  }
  dialog('👤 Editors', `<p class="ink2" style="margin-top:0">You are the owner (<b>${esc(u.email)}</b>). Anyone with the link can view. Only the people below can edit, once they create an account with the same email.</p>
  <div id="edList" class="ink2">Loading…</div>
  <div class="form" style="margin-top:10px"><label class="full">Add an editor's email<input type="email" name="email" required></label></div>
  <div style="margin-top:10px"><button type="button" class="btn sm" data-act="authOut">Sign out</button></div>${errP}`, fd => {
    const email = String(fd.get('email')).trim().toLowerCase();
    Live.db.collection('editors').doc(email).set({ addedAt: new Date().toISOString() }).then(() => { toast('Added ' + email); reopenAccount(); }, () => authErr('Could not add that editor.'));
    return false;
  }, 'Add editor');
  Live.db.collection('editors').get().then(s => {
    const el = $('#edList'); if (!el) return;
    el.innerHTML = s.docs.map(d => `<div class="mini-row" style="cursor:default"><span>${esc(d.id)}</span><button type="button" class="btn sm danger" data-act="edRemove" data-email="${esc(d.id)}">Remove</button></div>`).join('') || 'No other editors yet.';
  }, () => { const el = $('#edList'); if (el) el.textContent = 'Could not load the list.'; });
}

/* ---------- import / export ---------- */
const planFile = extra => JSON.stringify(Object.assign({ app: 'nsdi-planner', version: 1, savedAt: P.meta.savedAt }, extra, { project: P }), null, 1);
function exportJson() { persist(); download(`NSDI_Plan_${stamp()}.json`, new Blob([planFile()], { type: 'application/json' })); toast('Project file saved'); }
function loadProjectObject(obj, name) {
  const p = obj && obj.project ? obj.project : obj;
  if (!validProject(p)) { toast('That file is not a valid project file', 1); return false; }
  if (viewOnly()) return false;
  if (undoStack.length < 40) undoStack.push(snapshot());
  adopt(p); logIt('Loaded ' + name); save(); setLevel(UI.level); UI.sel = null; renderAll(); toast('Loaded ' + name);
  return true;
}
const XSER = n => n + 25569;
function exportXlsx() {
  if (!window.XLSX) return toast('Excel library did not load', 1);
  const X = window.XLSX, head = ['Stage', 'WBS Code', 'Task / Component Description', 'WBS Level', 'Category', 'Scope & Deliverable Summary', 'Task Owner', 'Assigned Owner / Role', 'Other Participant', 'Status note (V6/SOW)', 'Status', 'Progress %', 'Est. duration (workdays)', 'Dependencies', 'Start date', 'End date', 'SOW Reference', 'Milestone', 'Notes'];
  const dc = s => ({ t: 'n', v: XSER(d2n(s)), z: 'dd-mmm-yyyy' });
  const rows = P.tasks.map(t => [stageOf(t).wbs, t.wbs, t.name, 'L' + t.depth, t.category, t.scope, t.owner, t.role, t.other, t.note, t.status, t.progress, t.dur, [depStr(t), t.depNote].filter(Boolean).join('; '), dc(t.start), dc(t.end), t.sow, t.ms ? 'Yes' : '', t.notes]);
  const wb = X.utils.book_new();
  const ws = X.utils.aoa_to_sheet([head, ...rows]);
  ws['!cols'] = [6, 11, 54, 7, 12, 40, 18, 22, 22, 14, 13, 9, 9, 22, 12, 12, 12, 9, 26].map(wch => ({ wch })); ws['!autofilter'] = { ref: `A1:S${rows.length + 1}` }; ws['!freeze'] = { xSplit: 3, ySplit: 1 };
  X.utils.book_append_sheet(wb, ws, 'WBS & Task Breakdown');
  const sm = P.tasks.filter(t => t.depth <= 2).map(t => [t.wbs, t.name, t.scope, t.qa, t.status, t.progress, dc(t.start), dc(t.end), t.dur]);
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['WBS Code', 'Task / Component Description', 'Scope summary', 'Main QA / consultancy tasks', 'Status', 'Progress %', 'Start', 'End', 'Workdays span'], ...sm]), 'Executive Summary');
  const dp = []; P.tasks.forEach(s => s.deps.forEach(d => { const p = I.byId.get(d.id); dp.push([p.wbs, p.name, s.wbs, s.name, d.type, d.lag || 0]); }));
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['From WBS', 'From task', 'To WBS', 'To task', 'Type', 'Lag (workdays)'], ...dp]), 'Dependencies');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['WBS', 'Milestone', 'Date', 'Owner', 'Status'], ...P.tasks.filter(t => t.ms).map(t => [t.wbs, t.name, dc(t.end), t.owner, t.status])]), 'Milestones');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Name', 'Type', 'Assigned person', 'Notes'], ...P.resources.map(r => [r.name, r.type, r.person, r.notes])]), 'Resources');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Type', 'Title', 'WBS', 'Owner', 'Probability', 'Impact', 'Score', 'Status', 'Due', 'Mitigation'], ...P.risks.map(r => [r.type, r.title, r.wbs, r.owner, r.prob, r.impact, (+r.prob || 0) * (+r.impact || 0), r.status, r.due, r.plan])]), 'Risks & Issues');
  X.writeFile(wb, `NSDI_Plan_${stamp()}.xlsx`);
  toast('Excel file exported');
}
function importWorkbook(buf, name) {
  const X = window.XLSX; const wb = X.read(buf, { type: 'array' });
  const wsName = wb.SheetNames.find(n => /wbs.*task|task.*breakdown/i.test(n)) || wb.SheetNames[0];
  const aoa = X.utils.sheet_to_json(wb.Sheets[wsName], { header: 1, raw: true, defval: '' });
  const hi = aoa.findIndex(r => r.some(c => /^wbs code$/i.test(String(c).trim())));
  if (hi < 0) return toast('Could not find a “WBS Code” column in that workbook', 1);
  const col = re => aoa[hi].findIndex(c => re.test(String(c).trim()));
  const C = { wbs: col(/^wbs code$/i), name: col(/^task \/ component/i), category: col(/^category$/i), scope: col(/^scope/i), owner: col(/^task owner$/i), role: col(/^assigned owner/i), other: col(/^other participant/i), note: col(/^status note/i), status: col(/^status$/i), dur: col(/^est\. duration/i), deps: col(/^dependencies$/i), start: col(/^start date$/i), end: col(/^end date$/i), sow: col(/^sow/i), prog: col(/^progress/i), ms: col(/^milestone$/i), notes: col(/^notes$/i) };
  if (C.start < 0 || C.end < 0) return toast('The workbook needs “Start date” and “End date” columns', 1);
  const dt = v => { if (typeof v === 'number') return n2d(Math.floor(v) - 25569); if (v instanceof Date) return v.toISOString().slice(0, 10); const s = String(v).trim(); return isISO(s) ? s : ''; };
  const g = (r, k) => (C[k] >= 0 ? r[C[k]] : '');
  const rows = aoa.slice(hi + 1).filter(r => String(g(r, 'wbs')).trim() && dt(g(r, 'start')) && dt(g(r, 'end'))).map(r => ({ wbs: String(g(r, 'wbs')).trim(), name: String(g(r, 'name')).trim(), category: String(g(r, 'category')).trim(), scope: String(g(r, 'scope')).trim(), owner: String(g(r, 'owner')).trim(), role: String(g(r, 'role')).trim(), other: String(g(r, 'other')).trim(), note: String(g(r, 'note')).trim(), status: String(g(r, 'status')).trim(), dur: g(r, 'dur'), deps: String(g(r, 'deps')).trim(), start: dt(g(r, 'start')), end: dt(g(r, 'end')), sow: String(g(r, 'sow')).trim(), qa: '', _p: g(r, 'prog'), _m: g(r, 'ms'), _n: g(r, 'notes') }));
  if (!rows.length) return toast('No tasks with dates found in that workbook', 1);
  wb.SheetNames.forEach(n => { // Main QA text lives on the summary sheet
    const a = X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
    const h = a.findIndex(r => r.some(c => /^main qa/i.test(String(c).trim())) && r.some(c => /^wbs code$/i.test(String(c).trim())));
    if (h < 0) return;
    const cc = a[h].findIndex(c => /^wbs code$/i.test(String(c).trim())), cq = a[h].findIndex(c => /^main qa/i.test(String(c).trim()));
    const qa = new Map(a.slice(h + 1).map(r => [String(r[cc]).trim(), String(r[cq]).trim()]));
    rows.forEach(r => { if (qa.get(r.wbs)) r.qa = qa.get(r.wbs); });
  });
  dialog('📥 Import from Excel', `<p>Found <b>${rows.length}</b> tasks in “${esc(wsName)}” of ${esc(name)}. This replaces the ${Live.seeded ? 'shared plan for everyone' : 'plan in this browser'}; you can undo it right after.</p>`, () => {
    const np = buildFromRows(rows, name);
    np.meta = Object.assign({}, P.meta, { source: name });
    np.risks = P.risks; np.resources = P.resources;
    rows.forEach((r, i) => { const t = np.tasks[i]; if (!t) return; if (r._p !== '' && r._p != null && !isNaN(+r._p)) t.progress = clamp(+r._p, 0, 100); if (String(r._m).toLowerCase() === 'yes') t.ms = true; if (r._n) t.notes = String(r._n); });
    loadProjectObject(np, name);
  }, 'Replace plan');
}

/* ---------- events ---------- */
const ACTIONS = {
  undo: () => restore(undoStack, redoStack, 'undo'),
  redo: () => restore(redoStack, undoStack, 'redo'),
  theme: () => { const r = document.documentElement, dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; r.dataset.theme = dark ? 'light' : 'dark'; saveUI(); },
  help: dlgHelp, share: dlgShare,
  copyUrl: () => { const u = $('#shareUrl'); (navigator.clipboard ? navigator.clipboard.writeText(u.value) : Promise.reject()).then(() => toast('Link copied'), () => { u.select(); toast('Press Ctrl+C to copy'); }); },
  account: dlgAccount,
  authCreate: () => {
    const f = $('#dlgForm');
    if (!f.reportValidity()) return;
    Live.auth.createUserWithEmailAndPassword(f.email.value.trim(), f.password.value).then(c => c.user.sendEmailVerification().then(reopenAccount), e => authErr(authMsg(e)));
  },
  authForgot: () => {
    const email = $('#dlgForm').email.value.trim();
    if (!email) return authErr('Enter your email first.');
    Live.auth.sendPasswordResetEmail(email).then(() => authErr('If that email has an account, a reset link is on its way.'), e => authErr(authMsg(e)));
  },
  authResend: () => { Live.user.sendEmailVerification().then(() => authErr('Sent. Check your inbox.'), e => authErr(authMsg(e))); },
  authCheck: async () => {
    try { await Live.user.reload(); await Live.user.getIdToken(true); await refreshRole(); reopenAccount(); } catch (e) { authErr(authMsg(e)); }
  },
  authOut: () => { Live.auth.signOut().then(() => { $('#modal').close(); toast('Signed out'); }); },
  edRemove: el => { Live.db.collection('editors').doc(el.dataset.email).delete().then(() => { toast('Removed ' + el.dataset.email); reopenAccount(); }, () => authErr('Could not remove that editor.')); },
  liveUpload: () => {
    const docs = toDocs(P), batch = Live.db.batch();
    Object.keys(docs).forEach(id => batch.set(Live.db.collection('plan').doc(id), docs[id]));
    liveStatus('Uploading the plan…');
    batch.commit().then(() => toast('The shared plan is ready'), () => { liveStatus(); toast('The upload did not go through', 1); });
  },
  saveJson: exportJson, exportXlsx,
  loadJson: () => $('#fileJson').click(),
  importXlsx: () => $('#fileXlsx').click(),
  print: () => {
    if (UI.tab === 'gantt' && UI.zoom !== 'Fit') { const z = UI.zoom; UI.zoom = 'Fit'; renderGantt(); window.addEventListener('afterprint', () => { UI.zoom = z; renderGantt(); }, { once: true }); }
    window.print();
  },
  goto: el => { UI.tab = el.dataset.tab; renderTabs(); renderView(); saveUI(); $('#view').scrollTop = 0; window.scrollTo(0, 0); },
  dismissWelcome: () => { UI.welcome = false; saveUI(); renderView(); },
  clearFilters: () => { clearF(); renderView(); },
  mselClear: el => { F[el.dataset.k] = []; renderFiltered(); },
  toggle: el => { const id = el.dataset.id; collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id); renderView(); },
  expandAll: () => { collapsed.clear(); UI.level = 6; renderView(); },
  collapseAll: () => { setLevel(1); renderView(); },
  focusStage: el => { F.stage = [el.dataset.wbs]; UI.tab = 'gantt'; renderTabs(); rememberScroll(); delete scrollMem.gantt; renderGanttFresh(); },
  zoom: el => { UI.zoom = el.dataset.z; renderGanttFresh(); saveUI(); },
  scrollToday: scrollGanttToToday,
  flag: el => { UI[el.dataset.k] = !UI[el.dataset.k]; renderView(); saveUI(); },
  closeDrawer: () => { UI.sel = null; renderDrawer(); if (UI.tab === 'gantt') renderGantt(); },
  moveUp: el => moveTask(I.byId.get(el.dataset.id), -1),
  moveDown: el => moveTask(I.byId.get(el.dataset.id), 1),
  addResource: () => dlgResource(),
  resTasks: el => { const r = P.resources.find(x => x.id === el.dataset.id); clearF(); F.res = [r.name]; UI.tab = 'wbs'; renderTabs(); renderView(); saveUI(); },
  delResource: el => {
    const r = P.resources.find(x => x.id === el.dataset.id), n = P.tasks.filter(t => RES_FIELDS.some(f => t[f] === r.name)).length;
    dialog('Delete this resource?', `<p><b>${esc(r.name)}</b> will be removed from the list${n ? ` and cleared from ${n} task${n > 1 ? 's' : ''}` : ''}. You can undo this.</p>`, () => {
      commit(`Deleted resource “${r.name}”`, () => {
        P.tasks.forEach(t => RES_FIELDS.forEach(f => { if (t[f] === r.name) t[f] = ''; }));
        P.resources = P.resources.filter(x => x !== r);
        F.res = F.res.filter(x => x !== r.name);
      });
    }, 'Delete');
  },
  addStage: () => dialog('＋ Add a stage', `<div class="form"><label class="full">Stage name<input name="name" required autofocus></label><label>Start<input type="date" name="date" value="${n2d(snap(todayN()))}" required></label></div>`, fd => { commit(`Added stage “${fd.get('name')}”`, () => { const t = addTask(null, { name: String(fd.get('name')), start: fd.get('date'), category: 'Phase', dur: 5 }); UI.sel = t.id; }); }, 'Add'),
  addTaskDlg: () => dlgAddTask(false, UI.sel ? I.byId.get(UI.sel) : null),
  addMilestone: () => dlgAddTask(true, UI.sel ? I.byId.get(UI.sel) : null),
  addChild: el => { const p = I.byId.get(el.dataset.id); commit(`Added sub-task under ${p.wbs}`, () => { const t = addTask(p, { start: p.start }); UI.sel = t.id; }); },
  addMsUnder: el => dlgAddTask(true, I.byId.get(el.dataset.id)),
  delTask: el => {
    const t = I.byId.get(el.dataset.id), n = descendants(t).length;
    dialog('Delete this task?', `<p><b>${esc(t.wbs)} ${esc(t.name)}</b>${n ? ` and its ${n} sub-task${n > 1 ? 's' : ''}` : ''} will be removed, along with any links to them. You can undo this.</p>`, () => { commit(`Deleted ${t.wbs} ${t.name}`, () => removeTask(t)); }, 'Delete');
  },
  addPred: el => { const s = I.byId.get(el.dataset.id), p = I.byWbs.get($('#addPred').value.trim()); tryLink(p, s, $('#addPredType').value, +$('#addPredLag').value || 0); },
  addSucc: el => { const p = I.byId.get(el.dataset.id), s = I.byWbs.get($('#addSucc').value.trim()); tryLink(p, s, $('#addSuccType').value, +$('#addSuccLag').value || 0); },
  rmDep: el => { const s = I.byId.get(el.dataset.s), pid = el.dataset.p; if (el.dataset.close) $('#modal').close(); commit(`Removed link to ${s.wbs}`, () => { s.deps = s.deps.filter(d => d.id !== pid); }); },
  editDep: el => { const s = el.dataset.s, p = el.dataset.p; $('#modal').close(); dlgDep(s, p); },
  manageLinks: dlgLinks,
  dlgClose: () => $('#modal').close(),
  msDone: el => { const t = I.byId.get(el.dataset.id); commit(`Milestone ${t.wbs} ${t.status === 'Done' ? 'reopened' : 'done'}`, () => setField(t, 'status', t.status === 'Done' ? 'Not started' : 'Done')); },
  msOff: el => { const t = I.byId.get(el.dataset.id); commit(`Removed milestone flag from ${t.wbs}`, () => { t.ms = false; }); },
  boardMore: el => { const s = el.dataset.s; UI.boardShow[s] = (UI.boardShow[s] || BOARD_CAP) + BOARD_CAP; renderView(); },
  addRisk: () => commit('Added a log entry', () => { P.risks.unshift({ id: 'r' + Date.now().toString(36), type: 'Risk', title: 'New entry', wbs: '', owner: '', prob: 3, impact: 3, status: 'Open', due: '', plan: '' }); }),
  delRisk: el => commit('Deleted a log entry', () => { P.risks = P.risks.filter(r => r.id !== el.dataset.id); }),
  fitEnd: () => {
    if (viewOnly()) return;
    const pe = P.meta.projectEnd;
    if (!pe) return toast('Set a project end date in Settings first', 1);
    const late = leaves().filter(t => t.end > pe).length;
    if (!late) return toast('Every task already finishes by the project end 🎉');
    const keep = snapshot(), plan = fitToEnd();
    const rows = plan.changes.map(c => `<tr><td class="nowrap">${esc(c.t.wbs)}</td><td>${esc(c.t.name)}</td><td class="nowrap">${c.from} → ${c.t.dur}</td></tr>`).join('');
    const left = plan.left.map(t => `${t.wbs} (${fmtS(t.end)})`).join(', ');
    Object.assign(P, JSON.parse(keep)); index(); rollup();
    if (!plan.changes.length) return toast(`These ${late} tasks cannot be shortened automatically. Change their dates or links by hand.`, 1);
    dialog('📏 Fit tasks to project end?', `<p style="margin-top:0">${late} task${late > 1 ? 's finish' : ' finishes'} after ${fmtS(pe)}. To fit, this closes gaps after their predecessors, then shortens the longest task on each chain by up to a quarter, so short check and sign-off steps keep their length. The tasks that follow move earlier. This changes the plan for everyone, and you can undo it right after.</p>
    <div style="max-height:40vh;overflow:auto"><table><thead><tr><th>WBS</th><th>Task</th><th>Workdays</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${left ? `<p style="color:var(--danger)">Still past the end afterwards: ${esc(left)}. These need changing by hand.</p>` : ''}
    <div class="form" style="margin-top:10px"><label class="full" style="flex-direction:row;gap:8px;align-items:center"><input type="checkbox" name="lock" checked style="width:auto"> Also turn on the limit, so tasks cannot go past the project end again</label></div>`, fd => {
      commit('Fitted tasks to the project end', () => { fitToEnd(); if (fd.get('lock')) P.settings.lockEnd = true; });
    }, 'Shorten these tasks');
  },
  fixConflicts: () => {
    const C = healthChecks(), viol = C.find(c => c.id === 'viol').items.length, gap = C.find(c => c.id === 'gap').items.length;
    if (!viol && !gap) return toast('Every task already follows its dependencies 🎉');
    dialog('Apply dependencies to all tasks?', `<p>${viol} link${viol === 1 ? '' : 's'} start too early and ${gap} task${gap === 1 ? '' : 's'} start later than required. This puts every linked task on the date its links require, and tasks that follow them move too, earlier or later. Dates will change for everyone using the plan. You can undo this right after.</p>`, () => {
      commit('Applied dependencies to all tasks', () => {
        const was = P.settings.autoSched; P.settings.autoSched = true;
        propagate(P.tasks.filter(t => t.deps.length)); P.settings.autoSched = was;
        toast('All linked tasks now follow their dependencies');
      });
    }, 'Apply to all tasks');
  },
  setBaseline: () => dialog('📐 Save baseline', `<div class="form"><label class="full">Label<input name="label" value="Baseline ${stamp()}" required></label></div>`, fd => { commit('Saved a new baseline', () => { P.baseline = { label: String(fd.get('label')), savedAt: new Date().toISOString(), map: Object.fromEntries(P.tasks.map(t => [t.id, [t.start, t.end]])) }; }); }),
  resetPlan: () => dialog('Reset to the original plan?', '<p>All changes to the shared plan will be replaced for everyone. You can undo this right after, until someone else makes a change or you close the page.</p>', () => { const np = buildFromRows(window.SEED_ROWS, window.SEED_SOURCE); loadProjectObject(np, 'original plan'); }, 'Reset')
};
document.addEventListener('click', e => {
  const m = e.target.closest('details.menu');
  $$('details.menu[open]').forEach(d => { if (d !== m) d.open = false; });
  const a = e.target.closest('[data-act]');
  if (a && ACTIONS[a.dataset.act]) {
    if (a.tagName === 'A') e.preventDefault();
    if (m) m.open = false;
    ACTIONS[a.dataset.act](a);
    return;
  }
  const o = e.target.closest('[data-open]');
  if (o) { e.preventDefault(); openTask(o.dataset.open); return; }
  const dep = e.target.closest('[data-dep]');
  if (dep) { const [s, p] = dep.dataset.dep.split('|'); dlgDep(s, p); return; }
  const td = e.target.closest('td[data-e]');
  if (td) startCellEdit(td);
});
document.addEventListener('input', e => {
  const k = e.target.dataset && e.target.dataset.filter;
  if (k === 'q') { F.q = e.target.value; clearTimeout(ACTIONS._q); ACTIONS._q = setTimeout(() => { const pos = e.target.selectionStart; renderView(); const s = $('[data-filter=q]'); if (s) { s.focus(); s.setSelectionRange(pos, pos); } }, 220); }
});
function renderFiltered(openKey) { // keeps the list the user is ticking open, at the same scroll position
  const was = openKey && $(`details[data-msel="${openKey}"] .msel-pop`), top = was ? was.scrollTop : 0;
  if (UI.tab === 'gantt') renderGanttFresh(); else renderView();
  const d = openKey && $(`details[data-msel="${openKey}"]`);
  if (d) { d.open = true; d.querySelector('.msel-pop').scrollTop = top; }
}
document.addEventListener('change', async e => {
  const el = e.target, ds = el.dataset || {};
  if (ds.mselV) { const k = ds.mselV; F[k] = el.checked ? [...F[k], el.value] : F[k].filter(v => v !== el.value); renderFiltered(k); return; }
  if (ds.actChange === 'level') { setLevel(+el.value); renderView(); return; }
  if (ds.actChange) { UI[ds.actChange] = el.value; renderView(); saveUI(); return; }
  if (ds.f) {
    const form = el.closest('[data-task]'), t = I.byId.get(form.dataset.task);
    const v = el.type === 'checkbox' ? el.checked : el.value;
    if (v === NEW_RES) { el.value = t[ds.f]; dlgResource(name => setField(t, ds.f, name)); return; }
    if (!commit(`Changed ${ds.f} of ${t.wbs}`, () => setField(t, ds.f, v))) renderDrawer();
    return;
  }
  if (ds.depF) {
    const [sid, pid] = el.closest('[data-dep-row]').dataset.depRow.split('|'), s = I.byId.get(sid), d = s.deps.find(x => x.id === pid);
    commit(`Edited link to ${s.wbs}`, () => { if (ds.depF === 'type') d.type = el.value; else d.lag = +el.value || 0; propagate([s]); });
    return;
  }
  if (ds.rf) { const r = P.risks.find(x => x.id === el.closest('[data-risk]').dataset.risk); commit('Edited a log entry', () => { r[ds.rf] = el.value; }); return; }
  if (ds.resf) {
    const r = P.resources.find(x => x.id === el.closest('[data-res]').dataset.res);
    if (ds.resf === 'name') renameResource(r, el.value);
    else commit(`Edited resource “${r.name}”`, () => { r[ds.resf] = el.value.trim(); });
    return;
  }
  if (ds.metaIn) {
    const dates = Object.assign({}, P.meta, { [ds.metaIn]: el.value });
    if (dates.projectStart && dates.projectEnd && dates.projectStart > dates.projectEnd) { toast('The project start must be before the project end', 1); renderView(); return; }
    if (commit(`Changed project ${ds.metaIn}`, () => { P.meta[ds.metaIn] = el.value; }) && ds.metaIn === 'projectEnd') warnPastEnd();
    return;
  }
  if (el.id === 'lockEnd') { if (commit(el.checked ? 'Turned on the project end limit' : 'Turned off the project end limit', () => { P.settings.lockEnd = el.checked; }) && el.checked) warnPastEnd(); return; }
  if (el.id === 'autoSched') { commit('Changed auto-scheduling', () => { P.settings.autoSched = el.checked; }); return; }
  if (el.id === 'holidays') {
    const list = el.value.split(/\s+/).filter(Boolean), bad = list.filter(x => !isISO(x));
    if (bad.length) { toast('Not a date: ' + bad[0], 1); return; }
    commit('Changed holidays', () => { P.settings.holidays = list; });
    return;
  }
  if (el.id === 'fileJson' && el.files[0]) {
    const f = el.files[0]; el.value = '';
    try {
      const obj = JSON.parse(await f.text());
      if (Live.seeded && Live.canEdit) dialog('📂 Open project file', `<p style="margin-top:0">This replaces the shared plan for everyone with “${esc(f.name)}”. You can undo it right after.</p>`, () => { loadProjectObject(obj, f.name); }, 'Replace shared plan');
      else loadProjectObject(obj, f.name);
    } catch (err) { toast('Could not read that file', 1); }
    return;
  }
  if (el.id === 'fileXlsx' && el.files[0]) {
    const f = el.files[0]; el.value = '';
    try { importWorkbook(await f.arrayBuffer(), f.name); } catch (err) { toast('Could not read that workbook', 1); }
  }
});
document.addEventListener('focusout', e => {
  const k = e.target.dataset && e.target.dataset.meta;
  if (k) { const v = e.target.textContent.trim(); if (v && v !== P.meta[k]) commit(`Changed project ${k}`, () => { P.meta[k] = v; }); }
});
document.addEventListener('keydown', e => {
  const editing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && !editing) {
    if (e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? ACTIONS.redo() : ACTIONS.undo(); }
    if (e.key.toLowerCase() === 'y') { e.preventDefault(); ACTIONS.redo(); }
  }
  if (e.key === 'Escape' && UI.sel && !$('#modal').open && !editing) ACTIONS.closeDrawer();
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.meta && e.target.dataset.meta !== 'headline') { e.preventDefault(); e.target.blur(); }
});
document.addEventListener('pointerdown', e => { if (e.target.closest && e.target.closest('#gBody')) ganttPointerDown(e); });
document.addEventListener('pointermove', ganttPointerMove);
document.addEventListener('pointerup', ganttPointerUp);
document.addEventListener('mouseover', e => {
  if (drag) return;
  const el = e.target.closest && e.target.closest('[data-tip]');
  if (el && el.dataset.tip) showTip(el.dataset.tip, e.clientX, e.clientY); else hideTip();
});
document.addEventListener('mousemove', e => { if (!drag && !$('#tip').hidden) showTip($('#tip').textContent, e.clientX, e.clientY); });
document.addEventListener('dragstart', e => { const c = e.target.closest && e.target.closest('[data-card]'); if (c) { e.dataTransfer.setData('text/plain', c.dataset.card); e.dataTransfer.effectAllowed = 'move'; } });
document.addEventListener('dragover', e => { const c = e.target.closest && e.target.closest('[data-col]'); if (c) { e.preventDefault(); $$('.col.over').forEach(x => x !== c && x.classList.remove('over')); c.classList.add('over'); } });
document.addEventListener('drop', e => {
  const c = e.target.closest && e.target.closest('[data-col]'); if (!c) return; e.preventDefault();
  const t = I.byId.get(e.dataTransfer.getData('text/plain')); if (t && t.status !== c.dataset.col) commit(`${t.wbs} → ${c.dataset.col}`, () => setField(t, 'status', c.dataset.col));
});
document.addEventListener('dragend', () => $$('.col.over').forEach(x => x.classList.remove('over')));
window.addEventListener('resize', () => { if (UI.tab === 'gantt' && UI.zoom === 'Fit') renderGantt(); });

/* ---------- boot ---------- */
try { const u = JSON.parse(localStorage.getItem(UI_KEY) || '{}'); ['tab', 'zoom', 'colorBy', 'links', 'labels', 'base', 'welcome'].forEach(k => { if (u[k] !== undefined) UI[k] = u[k]; }); if (typeof UI.labels === 'boolean') UI.labels = UI.labels ? 'role' : ''; if (u.theme) document.documentElement.dataset.theme = u.theme; if (!VIEWS[UI.tab]) UI.tab = 'summary'; } catch (e) { /* defaults */ }
const hadLocal = load();
setLevel(UI.level);
renderAll();
setSaved(hadLocal ? 'Restored from this browser' : 'Plan loaded from ' + (P.meta.source || 'workbook'));
['-gh', '-dirty', '-pub'].forEach(k => { try { localStorage.removeItem(KEY + k); } catch (e) { /* optional */ } }); // left by the earlier Save to GitHub version
liveStart();
window.__planner = { get P() { return P; }, get I() { return I; }, UI, F, moveTask, healthChecks, planStats, drivingChain, propagate, linkError, setField, fitToEnd, Live, commit, toDocs, fromDocs, flatDocs, unflatDocs, wbsCmp };
})();
