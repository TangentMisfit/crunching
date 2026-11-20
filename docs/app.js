// Crunching app: screens, timers, keypad, storage, levels. Pure math lives in engine.js.
import * as E from './engine.js';

const VER = self.CRUNCH_VERSION || { APP_VERSION: '?', CACHE_VERSION: '?' };
const $main = document.getElementById('main');
const $tabs = document.getElementById('tabs');
const MODULE_NAME = { m1: 'P&L Flash', m2: 'Sensitivity Math' };

// ------------------------------------------------------------------ storage (every key starts with crunch_)
const K = { Q: 'crunch_questions', S: 'crunch_sessions', ST: 'crunch_state' };
function load(key, def) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; }
}
function save(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { console.warn('Crunching: save failed', e); }
}
function getState() {
  const s = load(K.ST, {}) || {};
  return {
    levels: { m1: 1, m2: 1, ...(s.levels || {}) },
    streak: s.streak || 0,
    lastPracticeDate: s.lastPracticeDate || null,
    minutesByDate: s.minutesByDate || {},
    levelSince: { m1: 0, m2: 0, ...(s.levelSince || {}) },
  };
}

// ------------------------------------------------------------------ utils
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function localDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const today = () => localDate(Date.now());
function yesterday() { const d = new Date(); d.setDate(d.getDate() - 1); return localDate(d.getTime()); }
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pct0 = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const secs = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`);
const randArch = () => (Math.random() < 0.5 ? 'B2B' : 'B2C');
const limitFor = (m, lvl) => (m === 'm1' ? E.M1_ANSWER_MS : E.M2_TIME_MS[lvl - 1]);
function windowFor(qs, m, lvl, since) {
  return qs.filter((q) => q.module === m && q.level === lvl && q.ts >= since).slice(-E.GATE.window);
}
function currentStreak(st) {
  return st.lastPracticeDate === today() || st.lastPracticeDate === yesterday() ? st.streak : 0;
}

// ------------------------------------------------------------------ timers / keyboard
let activeTimer = null;
let keyHandler = null;
function clearActive() {
  if (activeTimer) { activeTimer.stop(); activeTimer = null; }
  keyHandler = null;
}
document.addEventListener('keydown', (e) => { if (keyHandler) keyHandler(e); });

const timerHTML = () => '<div class="timer"><div class="bar"><i></i></div><span class="secs num"></span></div>';
function runTimer(root, ms, onEnd) {
  const wrap = root.querySelector('.timer');
  const bar = wrap.querySelector('i');
  const txt = wrap.querySelector('.secs');
  const t0 = performance.now();
  let raf = 0, stopped = false;
  const tick = () => {
    if (stopped) return;
    const left = Math.max(0, ms - (performance.now() - t0));
    bar.style.transform = `scaleX(${left / ms})`;
    txt.textContent = `${(left / 1000).toFixed(1)}s`;
    wrap.classList.toggle('low', left < 3000);
    if (left <= 0) { stopped = true; clearTimeout(backup); activeTimer = null; onEnd(); return; }
    raf = requestAnimationFrame(tick);
  };
  const backup = setTimeout(tick, ms + 50); // fires even if rAF is throttled
  activeTimer = { stop() { stopped = true; cancelAnimationFrame(raf); clearTimeout(backup); } };
  tick();
  return activeTimer;
}

// ------------------------------------------------------------------ navigation
let tab = 'train';
function setTab(t) {
  clearActive();
  tab = t;
  document.body.classList.remove('in-session');
  $tabs.hidden = false;
  $tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  ({ train: renderTrain, progress: renderProgress, settings: renderSettings })[t]();
  window.scrollTo(0, 0);
}
$tabs.addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });
function enterSession() { $tabs.hidden = true; document.body.classList.add('in-session'); }
function sessionBar(label) {
  return `<div class="sbar"><button class="btn ghost sm" data-quit>Quit</button><span class="muted">${esc(label)}</span></div>`;
}
function bindQuit() {
  const b = $main.querySelector('[data-quit]');
  if (b) b.onclick = () => { if (confirm('Quit this session? Answers so far are discarded.')) setTab('train'); };
}
function show(html) { $main.innerHTML = html; window.scrollTo(0, 0); bindQuit(); }

// ------------------------------------------------------------------ TRAIN
function renderTrain() {
  const st = getState();
  const qs = load(K.Q, []);
  const mins = Math.round(st.minutesByDate[today()] || 0);
  const card = (m, desc) => {
    const lvl = st.levels[m];
    const g = E.evaluateGate(windowFor(qs, m, lvl, st.levelSince[m]), limitFor(m, lvl));
    return `<div class="card">
      <div class="card-h"><h2>${MODULE_NAME[m]}</h2><span class="lvl">L${lvl}</span></div>
      <p>${desc}</p>
      <div class="row-stats"><span class="badge b-${g.status}">${g.status}</span>
        <span>Acc <b class="num">${pct0(g.accuracy)}</b></span><span>Median <b class="num">${secs(g.medianMs)}</b></span>
        <span class="num">${g.n}/${E.GATE.window}</span></div>
      <button class="btn" data-start="${m}">Start</button></div>`;
  };
  show(`<div class="top"><h1>Crunching</h1><div class="stats"><span>Today <b class="num">${mins}</b> min</span><span>Streak <b class="num">${currentStreak(st)}</b></span></div></div>
    ${card('m1', 'Read a budget-vs-actual P&amp;L in seconds. Find the miss and its root cause.')}
    ${card('m2', 'In-head what-if math on burn, runway, margin, payback, Rule of 40 and NDR.')}
    <div class="card soon"><div class="card-h"><h2>Module 3</h2><span class="muted">coming soon</span></div></div>
    <div class="card soon"><div class="card-h"><h2>Module 4</h2><span class="muted">coming soon</span></div></div>`);
  $main.querySelectorAll('[data-start]').forEach((b) => { b.onclick = () => startSession(b.dataset.start); });
}

function startSession(m) {
  const st = getState();
  const S = { sessionId: newId(), module: m, level: st.levels[m], startTs: Date.now(), records: [], i: 0 };
  enterSession();
  if (m === 'm1') m1Flash(S); else m2Question(S);
}

// ------------------------------------------------------------------ P&L table
function valTxt(kind, v) {
  if (kind === 'usd') return E.fmtUSD(v);
  if (kind === 'pct') return E.fmtPct(v);
  return E.fmtMonths(v);
}
function varTxt(r) {
  if (r.var == null) return '';
  if (r.kind === 'usd') return E.fmtUSD(r.var);
  if (r.kind === 'pct') { const b = Math.round(r.varBps); return `${b > 0 ? '+' : b < 0 ? '−' : ''}${Math.abs(b)}bps`; }
  return `${r.var >= 0 ? '+' : '−'}${Math.abs(r.var).toFixed(1)}`;
}
function plTable(ds, hl = new Set()) {
  const SUB = new Set(['grossProfit', 'totalOpex', 'opIncome']);
  let h = '<div class="plwrap"><table class="pl"><thead><tr><th></th><th>Actual</th><th>Budget</th><th>Var $</th><th>Var %</th><th>PY</th></tr></thead><tbody>';
  ds.bva.forEach((r, i) => {
    const cls = [hl.has(r.key) ? 'hl' : '', SUB.has(r.key) ? 'sub' : ''].join(' ').trim();
    const neg = (v) => (r.dir > 0 && r.kind !== 'months' && v != null && v < 0 ? ' class="bad"' : '');
    const fav = r.fav > 0 ? ' class="good"' : r.fav < 0 ? ' class="bad"' : '';
    h += `<tr${cls ? ` class="${cls}"` : ''}><th>${esc(r.label)}</th><td${neg(r.actual)}>${valTxt(r.kind, r.actual)}</td>`
      + `<td${neg(r.budget)}>${valTxt(r.kind, r.budget)}</td><td${fav}>${varTxt(r)}</td>`
      + `<td${fav}>${r.kind === 'usd' ? E.fmtSignedPct(r.varPct) : ''}</td><td class="py">${valTxt(r.kind, r.py)}</td></tr>`;
    if (E.ROWS[i].dividerAfter) h += '<tr class="div"><td colspan="6"></td></tr>';
  });
  return h + '</tbody></table></div>';
}

// ------------------------------------------------------------------ keypad
function keypadHTML(unit) {
  const keys = ['7', '8', '9', '⌫', '4', '5', '6', '−', '1', '2', '3', '.'];
  return `<div class="kp"><div class="kp-disp num"><span class="kp-val">0</span><span class="u">${esc(unit)}</span></div>
    <div class="chips">${E.UNITS.map((u) => `<button class="chip${u === unit ? ' on' : ''}" data-u="${u}">${u}</button>`).join('')}</div>
    <div class="keys">${keys.map((k) => `<button class="key" data-key="${k}">${k}</button>`).join('')}
      <button class="key wide" data-key="0">0</button><button class="key submit wide" data-key="ok">Submit</button></div></div>`;
}
function bindKeypad(root, unit, onSubmit) {
  let s = '', neg = false, u = unit;
  const disp = root.querySelector('.kp-val');
  const udisp = root.querySelector('.kp-disp .u');
  const render = () => { disp.textContent = `${neg ? '−' : ''}${s || '0'}`; udisp.textContent = u; };
  const press = (k) => {
    if (/^[0-9]$/.test(k)) { if (s.replace('.', '').length < 9) s = s === '0' ? k : s + k; }
    else if (k === '.') { if (!s.includes('.')) s = (s || '0') + '.'; }
    else if (k === '⌫') { if (s) s = s.slice(0, -1); else neg = false; }
    else if (k === '−') neg = !neg;
    else if (k === 'ok') {
      if (!s || s === '.' || isNaN(parseFloat(s))) return;
      onSubmit((neg ? -1 : 1) * parseFloat(s), u);
      return;
    }
    render();
  };
  root.querySelectorAll('.key').forEach((b) => { b.onclick = () => press(b.dataset.key); });
  root.querySelectorAll('.chip').forEach((b) => {
    b.onclick = () => { u = b.dataset.u; root.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b)); render(); };
  });
  keyHandler = (e) => {
    const map = { Backspace: '⌫', Enter: 'ok', '-': '−', '.': '.', ',': '.' };
    const k = /^[0-9]$/.test(e.key) ? e.key : map[e.key];
    if (k) { e.preventDefault(); press(k); }
  };
  render();
}

// ------------------------------------------------------------------ question runner (shared)
// q: {kind:'mc'|'numeric', prompt, options?, answer, expectedUnit}. Calls done({given, givenUnit, score, value, err, latencyMs, timedOut})
function askQuestion(header, q, limitMs, done, extraHTML = '') {
  const body = q.kind === 'mc'
    ? `<div class="opts">${q.options.map((o) => `<button class="opt" data-k="${esc(o.key)}">${esc(o.label)}</button>`).join('')}</div>`
    : keypadHTML(q.expectedUnit);
  show(`${header}${timerHTML()}<div class="qa-grid"><div>${extraHTML}<p class="prompt">${esc(q.prompt)}</p>
    ${q.kind === 'numeric' ? `<p class="unit-hint">Answer in <b class="accent">${esc(q.expectedUnit)}</b></p>` : ''}</div><div>${body}</div></div>`);
  const t0 = performance.now();
  let finished = false;
  const finish = (given, givenUnit, timedOut) => {
    if (finished) return;
    finished = true;
    clearActive();
    const latencyMs = timedOut ? limitMs : Math.round(performance.now() - t0);
    let score = 0, value = null, err = null;
    if (!timedOut) {
      if (q.kind === 'mc') score = given === q.answer ? 1 : 0;
      else ({ score, value, err } = E.scoreNumeric(q.answer, q.expectedUnit, given, givenUnit));
    }
    done({ given: timedOut ? null : given, givenUnit: timedOut ? null : givenUnit, score, value, err, latencyMs, timedOut });
  };
  if (q.kind === 'mc') {
    $main.querySelectorAll('.opt').forEach((b) => { b.onclick = () => finish(b.dataset.k, 'choice', false); });
    keyHandler = (e) => { const i = '1234'.indexOf(e.key); if (i >= 0 && q.options[i]) finish(q.options[i].key, 'choice', false); };
  } else {
    bindKeypad($main, q.expectedUnit, (v, u) => finish(v, u, false));
  }
  const kh = keyHandler;
  runTimer($main, limitMs, () => finish(null, null, true));
  keyHandler = kh;
}
function record(S, q, ds, res, extra) {
  S.records.push({
    ts: Date.now(), sessionId: S.sessionId, module: S.module, level: S.level,
    template_or_qtype: extra.qtype, tag: q.tag, seed: ds.seed, archetype: ds.archetype,
    expected: q.answer, expectedUnit: q.expectedUnit, given: res.given, givenUnit: res.givenUnit,
    score: res.score, latencyMs: res.latencyMs, timedOut: res.timedOut,
  });
}

// ------------------------------------------------------------------ MODULE 1
function m1Flash(S) {
  const ds = E.safeGenerate(E.randomSeed(), randArch(), (m) => console.warn(m));
  const qs = E.buildM1Questions(ds, ds.seed);
  S.cur = { ds, qs, res: [] };
  const A = ds.quarters[7];
  show(`${sessionBar(`Flash ${S.i + 1}/${E.M1_FLASHES} · L${S.level}`)}
    <div class="flash-h"><span>${E.ARCHETYPE_LABEL[ds.archetype]} · ${esc(A.label)}</span><span class="muted">Flash</span></div>
    ${timerHTML()}${plTable(ds)}`);
  runTimer($main, E.M1_FLASH_MS[S.level - 1], () => m1Ask(S, 0));
}
function m1Ask(S, k) {
  const { ds, qs } = S.cur;
  const q = qs[k];
  const qq = { ...q, expectedUnit: q.expectedUnit };
  const header = `${sessionBar(`Flash ${S.i + 1}/${E.M1_FLASHES} · Q${k + 1}/3`)}`;
  askQuestion(header, qq, E.M1_ANSWER_MS, (res) => {
    S.cur.res.push(res);
    record(S, q, ds, res, { qtype: q.qtype });
    if (k < 2) m1Ask(S, k + 1); else m1Reveal(S);
  });
}
function m1AnswerTxt(q, given, givenUnit) {
  if (given == null) return '—';
  if (q.kind === 'mc') return esc((q.options.find((o) => o.key === given) || {}).label || given);
  return E.fmtAnswer(given, givenUnit);
}
function m1Reveal(S) {
  const { ds, qs, res } = S.cur;
  const hl = new Set(ds.anomalies.flatMap((a) => a.lines));
  const names = ['Biggest miss', null, 'Root cause'];
  const answers = qs.map((q, k) => {
    const r = res[k];
    const mark = r.timedOut ? '<span class="bad">time</span>' : r.score === 1 ? '<span class="good">✓</span>' : r.score > 0 ? '<span class="warn">½</span>' : '<span class="bad">✗</span>';
    const correct = q.kind === 'mc' ? esc(q.options.find((o) => o.key === q.answer).label) : E.fmtAnswer(q.answer, q.expectedUnit);
    const conv = q.kind === 'numeric' && r.value != null && r.givenUnit !== q.expectedUnit ? ` <span class="muted">(${E.fmtAnswer(r.value, q.expectedUnit)})</span>` : '';
    return `<div class="ans"><div class="q">${esc(names[k] || q.prompt)} ${mark}</div>
      <div class="kv"><span>Correct</span><b class="good">${correct}</b><span>You</span><b class="${r.score === 1 ? 'good' : r.score > 0 ? 'warn' : 'bad'}">${m1AnswerTxt(q, r.given, r.givenUnit)}${conv}</b>
      <span>Time</span><b>${secs(r.latencyMs)}</b></div></div>`;
  }).join('');
  const last = S.i + 1 >= E.M1_FLASHES;
  show(`${sessionBar(`Flash ${S.i + 1}/${E.M1_FLASHES} · Reveal`)}
    <div class="flash-h"><span>${E.ARCHETYPE_LABEL[ds.archetype]} · ${esc(ds.quarters[7].label)}</span><span class="muted num">seed ${ds.seed}</span></div>
    ${plTable(ds, hl)}
    <div class="diag">${ds.anomalies.map((a) => `<p>${esc(a.diagnostic)}</p>`).join('')}</div>
    ${answers}
    <button class="btn" data-next style="margin-top:14px">${last ? 'Finish session' : 'Next flash'}</button>`);
  const next = () => { S.i++; if (last) finishSession(S); else m1Flash(S); };
  $main.querySelector('[data-next]').onclick = next;
  keyHandler = (e) => { if (e.key === 'Enter') next(); };
}

// ------------------------------------------------------------------ MODULE 2
function m2Question(S) {
  const pool = E.m2Pool(S.level);
  const t = pool[Math.floor(Math.random() * pool.length)];
  const compound = S.level >= 4 && Math.random() < 0.5;
  const mq = E.buildM2Question(E.randomSeed(), randArch(), t, compound);
  const q = { kind: 'numeric', prompt: mq.prompt, answer: mq.answer, expectedUnit: mq.unit, tag: mq.tag };
  const header = sessionBar(`Q ${S.i + 1}/${E.M2_QUESTIONS} · L${S.level} · ${mq.name}${compound ? ' +' : ''}`);
  askQuestion(header, q, E.M2_TIME_MS[S.level - 1], (res) => {
    record(S, q, mq, res, { qtype: mq.id });
    m2Feedback(S, mq, q, res);
  });
}
function m2Feedback(S, mq, q, res) {
  const verdict = res.timedOut ? ['Time', 'bad'] : res.score === 1 ? ['Correct', 'good'] : res.score > 0 ? ['Partial', 'warn'] : ['Miss', 'bad'];
  const conv = res.value != null && res.givenUnit !== q.expectedUnit ? ` <span class="muted">(${E.fmtAnswer(res.value, q.expectedUnit)})</span>` : '';
  const err = res.err != null ? `${(res.err * 100).toFixed(1)}%` : '—';
  const last = S.i + 1 >= E.M2_QUESTIONS;
  show(`${sessionBar(`Q ${S.i + 1}/${E.M2_QUESTIONS} · ${mq.name}`)}
    <div class="verdict ${verdict[1]}">${verdict[0]}</div>
    <p class="muted" style="margin-top:0">${esc(mq.prompt)}</p>
    <div class="card"><div class="kv">
      <span>Answer</span><b class="good big">${E.fmtAnswer(q.answer, q.expectedUnit)}</b>
      <span>You</span><b class="${verdict[1]}">${res.given == null ? '—' : E.fmtAnswer(res.given, res.givenUnit)}${conv}</b>
      <span>Error</span><b>${err}</b>
      <span>Latency</span><b>${secs(res.latencyMs)}</b></div></div>
    <h3>Fastest path</h3><ol class="steps">${mq.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <button class="btn" data-next style="margin-top:16px">${last ? 'Finish session' : 'Next'}</button>`);
  const next = () => { S.i++; if (last) finishSession(S); else m2Question(S); };
  $main.querySelector('[data-next]').onclick = next;
  keyHandler = (e) => { if (e.key === 'Enter') next(); };
}

// ------------------------------------------------------------------ session end + gates
function commitSession(S) {
  const now = Date.now();
  const qs = load(K.Q, []);
  qs.push(...S.records);
  save(K.Q, qs);
  const st = getState();
  const m = S.module, lvl = S.level;
  const win = windowFor(qs, m, lvl, st.levelSince[m]);
  const g = E.evaluateGate(win, limitFor(m, lvl));
  const newLevel = E.nextLevel(lvl, g.status);
  if (g.status === 'Drill' || g.status === 'Advance') { st.levels[m] = newLevel; st.levelSince[m] = now + 1; }
  const scores = S.records.map((r) => r.score);
  const lats = S.records.map((r) => r.latencyMs);
  const sess = { sessionId: S.sessionId, ts: now, module: m, level: lvl, n: S.records.length,
    avgScore: E.mean(scores), medianLatencyMs: E.median(lats), gateResult: g.status };
  const sessions = load(K.S, []);
  sessions.push(sess);
  save(K.S, sessions);
  const d = today();
  st.minutesByDate[d] = (st.minutesByDate[d] || 0) + (now - S.startTs) / 60000;
  if (st.lastPracticeDate !== d) st.streak = st.lastPracticeDate === yesterday() ? st.streak + 1 : 1;
  st.lastPracticeDate = d;
  save(K.ST, st);
  return { sess, g, newLevel };
}
function finishSession(S) {
  clearActive();
  const { sess, g, newLevel } = commitSession(S);
  const lim = limitFor(S.module, S.level);
  const msg = {
    Calibrating: `Calibrating: ${g.n}/${E.GATE.window} questions in the level window.`,
    Advance: `Advance: level ${S.level} → ${newLevel}. Window reset.`,
    Drill: `Drill: accuracy under 60%. Level ${S.level} → ${newLevel}. Window reset.`,
    Hold: `Hold: advance needs ≥ 85% accuracy and median ≤ ${secs(lim * E.GATE.latencyFrac)} over the last 20 (now ${pct0(g.accuracy)}, ${secs(g.medianMs)}).`,
  }[g.status];
  show(`<h1>Session complete</h1>
    <div class="card"><div class="card-h"><h2>${MODULE_NAME[S.module]}</h2><span class="lvl">L${S.level}</span></div>
      <div class="kv" style="margin-top:12px">
        <span>Questions</span><b>${sess.n}</b>
        <span>Accuracy</span><b>${pct0(sess.avgScore)}</b>
        <span>Median latency</span><b>${secs(sess.medianLatencyMs)}</b>
        <span>Gate</span><b><span class="badge b-${g.status}">${g.status}</span></b></div>
      <p style="margin-top:12px">${esc(msg)}</p></div>
    <div class="btns"><button class="btn ghost" data-done>Done</button><button class="btn" data-again>Again</button></div>`);
  $main.querySelector('[data-done]').onclick = () => setTab('train');
  $main.querySelector('[data-again]').onclick = () => startSession(S.module);
}

// ------------------------------------------------------------------ PROGRESS
function renderProgress() {
  const sessions = load(K.S, []);
  const qs = load(K.Q, []);
  const modTable = (m) => {
    const rows = sessions.filter((s) => s.module === m).slice(-10).reverse();
    if (!rows.length) return '<div class="empty">No sessions yet.</div>';
    return `<table class="tbl"><thead><tr><th>Date</th><th>Lvl</th><th>Acc</th><th>Median</th><th>Gate</th></tr></thead><tbody>${rows.map((s) => `
      <tr><td>${localDate(s.ts).slice(5)}</td><td>L${s.level}</td><td>${pct0(s.avgScore)}</td><td>${secs(s.medianLatencyMs)}</td>
      <td class="l"><span class="badge b-${esc(s.gateResult)}">${esc(s.gateResult)}</span></td></tr>`).join('')}</tbody></table>`;
  };
  const byTag = {};
  for (const q of qs) (byTag[q.tag] = byTag[q.tag] || []).push(q);
  const tags = Object.entries(byTag).map(([tag, arr]) => ({ tag, n: arr.length, acc: E.mean(arr.map((q) => q.score)), med: E.median(arr.map((q) => q.latencyMs)) }))
    .sort((a, b) => a.acc - b.acc || b.med - a.med);
  const tagTable = tags.length
    ? `<table class="tbl"><thead><tr><th>Tag</th><th>Attempts</th><th>Acc</th><th>Median</th></tr></thead><tbody>${tags.map((t) => `
      <tr><td class="l">${esc(t.tag)}</td><td>${t.n}</td><td class="${t.acc < 0.6 ? 'bad' : t.acc < 0.85 ? 'warn' : 'good'}">${pct0(t.acc)}</td><td>${secs(t.med)}</td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">No questions yet.</div>';
  show(`<h1>Progress</h1>
    <h3>${MODULE_NAME.m1} — last 10 sessions</h3>${modTable('m1')}
    <h3>${MODULE_NAME.m2} — last 10 sessions</h3>${modTable('m2')}
    <h3>Bottlenecks by tag (worst first)</h3>${tagTable}`);
}

// ------------------------------------------------------------------ CSV
const Q_COLS = ['ts', 'sessionId', 'module', 'level', 'template_or_qtype', 'tag', 'seed', 'archetype', 'expected', 'expectedUnit', 'given', 'givenUnit', 'score', 'latencyMs', 'timedOut'];
const S_COLS = ['sessionId', 'ts', 'module', 'level', 'n', 'avgScore', 'medianLatencyMs', 'gateResult'];
const NUM_COLS = new Set(['ts', 'level', 'seed', 'score', 'latencyMs', 'n', 'avgScore', 'medianLatencyMs']);
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const toCSV = (rows, cols) => [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n');
function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}
function coerce(col, s) {
  if (s === '') return null;
  if (NUM_COLS.has(col)) return Number(s);
  if (col === 'timedOut') return s === 'true';
  if (col === 'expected' || col === 'given') return /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(s) ? Number(s) : s;
  return s;
}
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function importCSV(text) {
  const rows = parseCSV(text.replace(/^﻿/, ''));
  if (!rows.length) return { kind: null, added: 0, dup: 0 };
  const head = rows[0].map((h) => h.trim());
  const kind = head.includes('avgScore') ? 'sessions' : head.includes('latencyMs') ? 'questions' : null;
  if (!kind) return { kind: null, added: 0, dup: 0 };
  const key = kind === 'sessions' ? K.S : K.Q;
  const existing = load(key, []);
  const seen = new Set(existing.map((r) => `${r.ts}|${r.sessionId}`));
  let added = 0, dup = 0;
  for (const r of rows.slice(1)) {
    const o = {};
    head.forEach((h, i) => { o[h] = coerce(h, r[i] ?? ''); });
    const k = `${o.ts}|${o.sessionId}`;
    if (o.ts == null || !o.sessionId) continue;
    if (seen.has(k)) { dup++; continue; }
    seen.add(k); existing.push(o); added++;
  }
  existing.sort((a, b) => a.ts - b.ts);
  save(key, existing);
  return { kind, added, dup };
}

// ------------------------------------------------------------------ SETTINGS
function renderSettings() {
  const nq = load(K.Q, []).length, ns = load(K.S, []).length;
  show(`<h1>Settings</h1>
    <h3>Export</h3>
    <div class="btns" style="margin-top:0"><button class="btn ghost" data-exp="q">Questions CSV</button><button class="btn ghost" data-exp="s">Sessions CSV</button></div>
    <div class="note">${nq} questions, ${ns} sessions stored on this device.</div>
    <h3>Import</h3>
    <button class="btn ghost" data-imp>Import CSV files</button><input type="file" accept=".csv,text/csv" multiple>
    <div class="note" data-impmsg>Merges by ts + sessionId; duplicates are skipped.</div>
    <h3>Reset</h3>
    <button class="btn ghost" data-reset>Reset all Crunching data</button>
    <div class="note">Removes only crunch_ data on this device.</div>
    <h3>About</h3>
    <div class="kv" style="font-size:14px"><span class="muted">App version</span><b>${esc(VER.APP_VERSION)}</b>
      <span class="muted">CACHE_VERSION</span><b>${esc(VER.CACHE_VERSION)}</b>
      <span class="muted">Engine</span><b>${esc(E.ENGINE_VERSION)}</b></div>`);
  const stamp = today();
  $main.querySelector('[data-exp="q"]').onclick = () => download(`crunch_questions_${stamp}.csv`, toCSV(load(K.Q, []), Q_COLS));
  $main.querySelector('[data-exp="s"]').onclick = () => download(`crunch_sessions_${stamp}.csv`, toCSV(load(K.S, []), S_COLS));
  const input = $main.querySelector('input[type=file]');
  $main.querySelector('[data-imp]').onclick = () => input.click();
  input.onchange = async () => {
    const out = [];
    for (const f of input.files) {
      const r = importCSV(await f.text());
      out.push(r.kind ? `${f.name}: +${r.added} ${r.kind}${r.dup ? `, ${r.dup} duplicates skipped` : ''}` : `${f.name}: not a Crunching CSV`);
    }
    $main.querySelector('[data-impmsg]').textContent = out.join(' · ');
    input.value = '';
  };
  const rb = $main.querySelector('[data-reset]');
  let armed = false, t = 0;
  rb.onclick = () => {
    if (!armed) {
      armed = true; rb.textContent = 'Tap again to erase everything'; rb.className = 'btn danger';
      t = setTimeout(() => { armed = false; rb.textContent = 'Reset all Crunching data'; rb.className = 'btn ghost'; }, 4000);
      return;
    }
    clearTimeout(t);
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('crunch_')) keys.push(k); }
    keys.forEach((k) => localStorage.removeItem(k));
    renderSettings();
    $main.querySelector('[data-impmsg]').textContent = `Reset done: removed ${keys.length} crunch_ keys.`;
  };
}

// ------------------------------------------------------------------ boot
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((e) => console.warn('Crunching: SW registration failed', e));
}
setTab('train');
