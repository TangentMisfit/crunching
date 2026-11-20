// Crunching engine: pure functions, no DOM.
// Currency = integer $k. Percentages = decimals. See CLAUDE.md section 3.

export const ENGINE_VERSION = '1.1.0';

// ---------------------------------------------------------------- PRNG
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const uni = (r, a, b) => a + (b - a) * r();
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
function shuffle(r, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function randomSeed() { return (Math.random() * 4294967296) >>> 0; }

// ---------------------------------------------------------------- formatting
// $k value rounded to the precision it is displayed with.
export function dispK(v) {
  const r = Math.round(v);
  if (Math.abs(r) >= 1000) return Math.round(v / 100) * 100;
  return r === 0 ? 0 : r; // avoid -0
}
export function fmtUSD(v) {
  if (v == null || !isFinite(v)) return '—';
  const d = dispK(v);
  const a = Math.abs(d);
  const s = a >= 1000 ? `$${(a / 1000).toFixed(1)}M` : `$${a}k`;
  return d < 0 ? `(${s})` : s;
}
export const fmtPct = (d) => (d == null ? '—' : `${(d * 100).toFixed(1)}%`);
export const fmtSignedPct = (d) => { if (d == null) return ''; const v = Math.abs(d * 100).toFixed(1); return v === '0.0' ? '0.0%' : `${d >= 0 ? '+' : '−'}${v}%`; };
export const fmtBps = (b) => { const r = Math.round(b); return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)} bps`; };
export const fmtMonths = (m) => (m == null ? 'CF+' : m.toFixed(1));
export function trimNum(x, d = 2) { return String(parseFloat(x.toFixed(d))); }
// Mental-friendly $M text: $1.2M, $1.25M, $18M
export const fmtM = (x, d = 2) => `${x < 0 ? '−' : ''}$${trimNum(Math.abs(x), d)}M`;
// $k amount as $650k or $1.25M
export const fmtKM = (k) => (Math.abs(k) >= 1000 ? fmtM(k / 1000, 3) : `${k < 0 ? '−' : ''}$${Math.abs(k)}k`);
export function fmtAnswer(v, unit) {
  if (v == null || !isFinite(v)) return '—';
  const sg = v < 0 ? '−' : '';
  const a = Math.abs(v);
  switch (unit) {
    case '$M': { const t = trimNum(a, 2); return `${sg}$${t.includes('.') ? t : a.toFixed(1)}M`; }
    case '$k': return `${sg}$${Math.round(a)}k`;
    case '%': return `${sg}${a.toFixed(1)}%`;
    case 'bps': return `${sg}${Math.round(a)} bps`;
    case 'mo': return `${sg}${a.toFixed(1)} mo`;
    default: return String(v);
  }
}

// ---------------------------------------------------------------- archetypes
// Ranges tuned so the realism tests pass (see CLAUDE.md section 3 for what changed and why).
export const ARCHETYPES = {
  B2B: { startARR: [10000, 80000], newRate: [0.04, 0.09], expRate: [0.02, 0.05], churnRate: [0.01, 0.03],
    hostPct: [0.10, 0.16], supPct: [0.05, 0.09], rdPct: [0.28, 0.40], gaPct: [0.14, 0.20],
    prepaid: [0.45, 0.70], smPct: [0.35, 0.50] },
  B2C: { startARR: [8000, 60000], newRate: [0.06, 0.11], expRate: [0.005, 0.02], churnRate: [0.02, 0.035],
    hostPct: [0.12, 0.20], supPct: [0.03, 0.06], rdPct: [0.25, 0.32], gaPct: [0.12, 0.16],
    prepaid: [0.20, 0.40], smPct: [0.32, 0.46] },
};
// Relative quarterly drift. Prepaid share drifts less: a swing re-bills the whole ARR base and creates fake cash spikes.
export const DRIFT_REL = { prepaid: 0.03 };
const DRIFT = (k) => DRIFT_REL[k] ?? 0.10;
export const ARCHETYPE_LABEL = { B2B: 'B2B SaaS', B2C: 'B2C SaaS' };
export const DRIVER_KEYS = ['newRate', 'expRate', 'churnRate', 'hostPct', 'supPct', 'rdPct', 'gaPct', 'prepaid', 'smPct'];

// ---------------------------------------------------------------- table rows
// dir: +1 revenue-like (higher is good), -1 cost-like.
export const ROWS = [
  { key: 'revenue', label: 'Revenue', kind: 'usd', dir: 1 },
  { key: 'hosting', label: 'Hosting', kind: 'usd', dir: -1 },
  { key: 'support', label: 'Support', kind: 'usd', dir: -1 },
  { key: 'grossProfit', label: 'Gross Profit', kind: 'usd', dir: 1 },
  { key: 'gmPct', label: 'GM %', kind: 'pct', dir: 1 },
  { key: 'sm', label: 'S&M', kind: 'usd', dir: -1 },
  { key: 'rd', label: 'R&D', kind: 'usd', dir: -1 },
  { key: 'ga', label: 'G&A', kind: 'usd', dir: -1 },
  { key: 'totalOpex', label: 'Total Opex', kind: 'usd', dir: -1 },
  { key: 'opIncome', label: 'Op Income', kind: 'usd', dir: 1 },
  { key: 'opMarginPct', label: 'Op Margin %', kind: 'pct', dir: 1, dividerAfter: true },
  { key: 'endARR', label: 'Ending ARR', kind: 'usd', dir: 1 },
  { key: 'ndr', label: 'NDR (TTM)', kind: 'pct', dir: 1 },
  { key: 'monthlyBurn', label: 'Monthly Burn', kind: 'usd', dir: -1 },
  { key: 'endCash', label: 'Ending Cash', kind: 'usd', dir: 1 },
  { key: 'runway', label: 'Runway (mo)', kind: 'months', dir: 1 },
];
export const ROW_LABEL = Object.fromEntries(ROWS.map((r) => [r.key, r.label]));

// ---------------------------------------------------------------- anomalies
export const ANOMALIES = {
  hosting_outgrowth: {
    lines: ['hosting', 'grossProfit', 'gmPct'], primary: 'hosting', downstream: ['opIncome', 'opMarginPct', 'monthlyBurn', 'endCash', 'runway'],
    rootCause: 'Infrastructure cost is scaling faster than revenue: hosting is outgrowing seats.',
  },
  paid_search_inflation: {
    lines: ['sm', 'endARR'], primary: 'endARR', downstream: [],
    rootCause: 'Paid acquisition got less efficient: S&M held up but bought far less new ARR.',
  },
  billing_shift: {
    lines: ['monthlyBurn', 'endCash', 'runway'], primary: 'monthlyBurn', downstream: [],
    rootCause: 'Customers shifted from annual prepay to monthly billing, draining deferred revenue and cash.',
  },
  churn_spike: {
    lines: ['ndr', 'endARR'], primary: 'ndr', downstream: [],
    rootCause: 'Retention broke: churn spiked while acquisition held up.',
  },
  hiring_pull_forward: {
    lines: ['rd', 'totalOpex', 'opIncome'], primary: 'rd', downstream: ['opMarginPct', 'monthlyBurn', 'endCash', 'runway'],
    rootCause: 'Engineering hiring landed ahead of plan, inflating R&D and opex.',
  },
};
export const ANOMALY_IDS = Object.keys(ANOMALIES);
const linesOverlap = (a, b) => ANOMALIES[a].lines.some((l) => ANOMALIES[b].lines.includes(l));

// ---------------------------------------------------------------- quarter math
function buildFlows(open, drv, smOverride) {
  const begARR = open.endARR;
  const newARR = Math.round(begARR * drv.newRate);
  const expARR = Math.round(begARR * drv.expRate);
  const churnARR = Math.round(begARR * drv.churnRate);
  const endARR = begARR + newARR + expARR - churnARR;
  const revenue = Math.round((begARR + endARR) / 8);
  const hosting = Math.round(revenue * drv.hostPct);
  const support = Math.round(revenue * drv.supPct);
  const grossProfit = revenue - hosting - support;
  const gmPct = grossProfit / revenue;
  const sm = smOverride != null ? smOverride : Math.round(revenue * drv.smPct);
  const rd = Math.round(revenue * drv.rdPct);
  const ga = Math.round(revenue * drv.gaPct);
  const totalOpex = sm + rd + ga;
  const opIncome = grossProfit - totalOpex;
  const dr = Math.round(endARR * drv.prepaid * 0.5);
  const dDR = dr - open.dr;
  const billings = revenue + dDR;
  const fcf = opIncome + dDR;
  return { drivers: { ...drv }, smOverride: smOverride != null, begARR, newARR, expARR, churnARR, endARR, revenue, hosting, support, grossProfit, gmPct,
    sm, rd, ga, totalOpex, opIncome, dr, dDR, billings, fcf };
}

// Share of ending ARR billed this quarter: annual renewals (25% of beginning ARR) + new + expansion.
export function billingCohortWeight(Q) {
  return Math.min(1, (0.25 * Q.begARR + Q.newARR + Q.expARR) / Q.endARR);
}

// hist = quarters before this one (index aligned), Q = this quarter at index idx
function deriveMetrics(Q, hist, idx) {
  Q.hostingPct = Q.hosting / Q.revenue;
  Q.supportPct = Q.support / Q.revenue;
  Q.smPct = Q.sm / Q.revenue;
  Q.rdPct = Q.rd / Q.revenue;
  Q.gaPct = Q.ga / Q.revenue;
  Q.opexPct = Q.totalOpex / Q.revenue;
  Q.opMarginPct = Q.opIncome / Q.revenue;
  Q.fcfMargin = Q.fcf / Q.revenue;
  Q.monthlyBurn = Math.max(0, -Q.fcf) / 3;
  Q.runway = Q.monthlyBurn > 0 ? Q.endCash / Q.monthlyBurn : null;
  Q.cacPayback = Q.sm / ((Q.newARR + Q.expARR) * Q.gmPct) * 12;
  if (idx >= 3) {
    const w = [hist[idx - 3], hist[idx - 2], hist[idx - 1], Q];
    const exp = w.reduce((s, x) => s + x.expARR, 0);
    const churn = w.reduce((s, x) => s + x.churnARR, 0);
    Q.ndr = (w[0].begARR + exp - churn) / w[0].begARR;
  } else Q.ndr = null;
  if (idx >= 4) {
    Q.arrYoY = Q.endARR / hist[idx - 4].endARR - 1;
    Q.ruleOf40 = (Q.arrYoY + Q.fcfMargin) * 100;
  } else { Q.arrYoY = null; Q.ruleOf40 = null; }
  return Q;
}

function quarterLabel(curQ, curFY, offset) {
  const idx = curFY * 4 + (curQ - 1) - offset;
  return `Q${(idx % 4) + 1} FY${String(Math.floor(idx / 4)).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- generator
export function generateCompany(seed, archetype) {
  const P = ARCHETYPES[archetype];
  if (!P) throw new Error(`Unknown archetype ${archetype}`);
  const r = mulberry32(seed);
  const startARR = Math.round(uni(r, P.startARR[0], P.startARR[1]));
  const targetRunway = uni(r, 15, 36);
  const curQ = 1 + Math.floor(r() * 4);
  const curFY = 25 + Math.floor(r() * 2);
  // Rejection loop (deterministic): redraw drivers/anomalies until the starting-runway target is feasible
  // without cash going below 3 months of burn in any quarter. See CLAUDE.md "Starting cash".
  let base, drivers, plan, act, n, ids, mag, smUplift, billingDrop, opening, quarters, prev, budget, smOv, actual;
  let budgetBurn, refBurn, targetEnd, cumBefore7, openCash, floor, minEnd;
  for (let attempt = 0; attempt < 50; attempt++) {
    base = {};
    for (const k of DRIVER_KEYS) base[k] = uni(r, P[k][0], P[k][1]);
    drivers = [];
    for (let q = 0; q < 8; q++) {
      const d = {};
      for (const k of DRIVER_KEYS) d[k] = base[k] * (1 + uni(r, -DRIFT(k), DRIFT(k)));
      drivers.push(d);
    }
    plan = drivers[7];
    act = {};
    for (const k of DRIVER_KEYS) act[k] = plan[k] * (1 + (r() < 0.5 ? -1 : 1) * uni(r, 0.01, 0.03));

    // anomalies
    n = r() < 0.5 ? 1 : 2;
    ids = [pick(r, ANOMALY_IDS)];
    if (n === 2) {
      const ok = ANOMALY_IDS.filter((id) => id !== ids[0] && !linesOverlap(id, ids[0]));
      ids.push(pick(r, ok));
    }
    mag = {};
    smUplift = null;
    billingDrop = null;
    // hiring_pull_forward: other opex drivers' noise may not offset the R&D overage (opex and burn must be hit)
    if (ids.includes('hiring_pull_forward')) {
      for (const k of ['gaPct', 'smPct']) act[k] = plan[k] * (1 + Math.abs(act[k] / plan[k] - 1));
    }
    for (const id of ids) {
      if (id === 'hosting_outgrowth') { mag[id] = uni(r, 0.15, 0.35); act.hostPct = plan.hostPct * (1 + mag[id]); }
      if (id === 'paid_search_inflation') { mag[id] = uni(r, 0.15, 0.30); act.newRate = plan.newRate * (1 - mag[id]); smUplift = uni(r, 0.05, 0.15); }
      if (id === 'billing_shift') {
        // drop applies to the cohort billed this quarter (renewals + new + expansion), see CLAUDE.md
        billingDrop = Math.min(uni(r, 0.10, 0.25), plan.prepaid - 0.05);
        mag[id] = billingDrop;
      }
      if (id === 'churn_spike') { mag[id] = uni(r, 0.5, 1.0); act.churnRate = plan.churnRate * (1 + mag[id]); }
      if (id === 'hiring_pull_forward') { mag[id] = uni(r, 0.10, 0.20); act.rdPct = plan.rdPct * (1 + mag[id]); }
    }

    // flows (cash filled afterwards)
    opening = { endARR: startARR, dr: Math.round(startARR * drivers[0].prepaid * 0.5), endCash: 0 };
    quarters = [];
    prev = opening;
    for (let q = 0; q < 7; q++) { const Q = buildFlows(prev, drivers[q]); quarters.push(Q); prev = Q; }
    budget = buildFlows(prev, plan);
    smOv = smUplift != null ? Math.round(budget.sm * (1 + smUplift)) : null;
    if (billingDrop != null) {
      const pre = buildFlows(prev, act, smOv); // ARR flows do not depend on prepaid share
      act.prepaid = plan.prepaid - billingDrop * billingCohortWeight(pre);
    }
    actual = buildFlows(prev, act, smOv);
    quarters.push(actual);

    // cash: budget runway = targetRunway months (see CLAUDE.md)
    budgetBurn = Math.max(0, -budget.fcf) / 3;
    refBurn = budgetBurn > 0 ? budgetBurn : budget.totalOpex * 0.1 / 3;
    targetEnd = budgetBurn > 0 ? targetRunway * refBurn : Math.max(targetRunway * refBurn, budget.revenue);
    cumBefore7 = quarters.slice(0, 7).reduce((s, x) => s + x.fcf, 0);
    openCash = Math.round(targetEnd - budget.fcf - cumBefore7);
    const ends = [openCash];
    let c = openCash;
    for (let q = 0; q < 7; q++) { c += quarters[q].fcf; ends.push(c); }
    ends.push(c + budget.fcf, c + actual.fcf);
    floor = 3 * refBurn;
    minEnd = Math.min(...ends);
    if (budgetBurn === 0 || minEnd >= floor || attempt === 49) {
      if (minEnd < floor) openCash += Math.ceil(floor - minEnd); // last resort, never reached in tests
      opening.endCash = openCash;
      break;
    }
  }

  let cash = openCash;
  for (let q = 0; q < 8; q++) {
    const Q = quarters[q];
    Q.begCash = cash; Q.endCash = cash + Q.fcf; cash = Q.endCash;
  }
  budget.begCash = quarters[6].endCash; budget.endCash = budget.begCash + budget.fcf;

  const curOffset = (q) => 7 - q;
  quarters.forEach((Q, q) => { Q.idx = q; Q.label = quarterLabel(curQ, curFY, curOffset(q)); deriveMetrics(Q, quarters, q); });
  budget.idx = 7; budget.label = quarters[7].label;
  deriveMetrics(budget, quarters, 7);

  const ds = { seed: seed >>> 0, archetype, startARR, opening, targetRunway, base, quarters, budget, current: 7, py: 3 };
  ds.bva = buildBvA(ds);
  ds.anomalies = ids.map((id) => ({ id, lines: ANOMALIES[id].lines.slice(), primary: ANOMALIES[id].primary,
    magnitude: mag[id], severity: anomalySeverity(id, ds), diagnostic: diagnose(id, ds) }));
  ds.anomalies.sort((a, b) => b.severity - a.severity);
  return ds;
}

export function buildBvA(ds) {
  const A = ds.quarters[7], B = ds.budget, PY = ds.quarters[3];
  return ROWS.map((row) => {
    const a = A[row.key], b = B[row.key], py = PY[row.key];
    const out = { key: row.key, label: row.label, kind: row.kind, dir: row.dir, actual: a, budget: b, py,
      var: null, varPct: null, varBps: null, fav: 0 };
    if (row.kind === 'usd') {
      out.var = a - b;
      out.varPct = b !== 0 ? out.var / Math.abs(b) : null;
    } else if (row.kind === 'pct') {
      if (a != null && b != null) { out.var = a - b; out.varBps = (a - b) * 10000; }
    } else if (row.kind === 'months') {
      if (a != null && b != null) out.var = a - b;
    }
    if (out.var != null) {
      const material = row.kind === 'pct' ? Math.abs(out.varBps) >= 10
        : out.varPct != null ? Math.abs(out.varPct) >= 0.005 : out.var !== 0;
      out.fav = material ? Math.sign(out.var) * row.dir : 0;
    }
    return out;
  });
}

function anomalySeverity(id, ds) {
  const A = ds.quarters[7], B = ds.budget;
  switch (id) {
    case 'hosting_outgrowth': return A.hosting - B.hosting;
    case 'hiring_pull_forward': return A.rd - B.rd;
    case 'paid_search_inflation': return B.newARR - A.newARR;
    case 'churn_spike': return A.churnARR - B.churnARR;
    case 'billing_shift': return B.dDR - A.dDR;
  }
  return 0;
}

const word = (v, pos, neg) => (v >= 0 ? pos : neg);
const absPct1 = (d) => `${Math.abs(d * 100).toFixed(1)}%`;

export function diagnose(id, ds) {
  const A = ds.quarters[7], B = ds.budget;
  const revVarPct = (A.revenue - B.revenue) / Math.abs(B.revenue);
  switch (id) {
    case 'hosting_outgrowth': {
      const bps = (A.gmPct - B.gmPct) * 10000;
      const hv = A.hosting - B.hosting;
      return `Gross margin came in ${Math.abs(Math.round(bps))} bps ${word(bps, 'above', 'below')} plan (${fmtPct(A.gmPct)} vs ${fmtPct(B.gmPct)}). `
        + `Hosting ran ${fmtUSD(Math.abs(hv))} ${word(hv, 'over', 'under')} budget (${fmtSignedPct(hv / B.hosting)}) while revenue was within ${absPct1(revVarPct)} of plan: `
        + 'infrastructure is scaling faster than seats.';
    }
    case 'paid_search_inflation': {
      const nv = (A.newARR - B.newARR) / B.newARR;
      const sv = (A.sm - B.sm) / B.sm;
      return `New ARR landed at ${fmtUSD(A.newARR)} vs ${fmtUSD(B.newARR)} plan (${fmtSignedPct(nv)}) while S&M ran ${fmtUSD(A.sm)} vs ${fmtUSD(B.sm)} (${fmtSignedPct(sv)}). `
        + `CAC payback stretched to ${A.cacPayback.toFixed(1)} months vs ${B.cacPayback.toFixed(1)} planned (${A.cacPayback - B.cacPayback >= 0 ? '+' : '−'}${Math.abs(A.cacPayback - B.cacPayback).toFixed(1)} months): paid acquisition is buying less pipeline per dollar.`;
    }
    case 'billing_shift': {
      const bv = (A.billings - B.billings) / Math.abs(B.billings);
      const cashPart = A.monthlyBurn > 0
        ? (B.monthlyBurn > 0
          ? `monthly burn rose to ${fmtUSD(A.monthlyBurn)} vs ${fmtUSD(B.monthlyBurn)} planned`
          : `monthly burn hit ${fmtUSD(A.monthlyBurn)} vs a cash-flow-positive plan`)
        : `free cash flow fell to ${fmtUSD(A.fcf)} vs ${fmtUSD(B.fcf)} planned`;
      return `Billings came in at ${fmtUSD(A.billings)} vs ${fmtUSD(B.billings)} plan (${fmtSignedPct(bv)}) while GAAP revenue was within ${absPct1(revVarPct)} of plan. `
        + `Deferred revenue finished ${fmtUSD(B.dr - A.dr)} below plan, so ${cashPart}: customers shifted from annual prepay to monthly billing.`;
    }
    case 'churn_spike': {
      const cv = (A.churnARR - B.churnARR) / B.churnARR;
      const ev = A.endARR - B.endARR;
      return `Churned ARR hit ${fmtUSD(A.churnARR)} vs ${fmtUSD(B.churnARR)} plan (${fmtSignedPct(cv)}). `
        + `TTM NDR came in at ${fmtPct(A.ndr)} vs ${fmtPct(B.ndr)} planned and ending ARR ${ev < 0 ? 'missed by' : 'still beat plan by'} ${fmtUSD(Math.abs(ev))}: `
        + 'retention, not acquisition, is the problem.';
    }
    case 'hiring_pull_forward': {
      const rv = A.rd - B.rd;
      const ov = A.totalOpex - B.totalOpex;
      const iv = A.opIncome - B.opIncome;
      return `R&D ran ${fmtUSD(Math.abs(rv))} ${word(rv, 'over', 'under')} budget (${fmtSignedPct(rv / B.rd)}) with revenue within ${absPct1(revVarPct)} of plan. `
        + `Total opex finished ${fmtUSD(Math.abs(ov))} ${word(ov, 'over', 'under')} plan and operating income ${iv < 0 ? 'missed by' : 'beat plan by'} ${fmtUSD(Math.abs(iv))}: `
        + 'hiring landed ahead of the plan.';
    }
  }
  return '';
}

// ---------------------------------------------------------------- validation
const EPS = 1e-9;
export function validate(ds) {
  const f = [];
  const eqI = (a, b, what) => { if (a !== b) f.push(`${what}: ${a} != ${b}`); };
  const eqF = (a, b, what) => {
    if (a == null || b == null) { if (a !== b) f.push(`${what}: ${a} != ${b}`); return; }
    if (!(Math.abs(a - b) <= EPS * Math.max(1, Math.abs(b)))) f.push(`${what}: ${a} != ${b}`);
  };
  const INT_KEYS = ['begARR', 'newARR', 'expARR', 'churnARR', 'endARR', 'revenue', 'hosting', 'support', 'grossProfit',
    'sm', 'rd', 'ga', 'totalOpex', 'opIncome', 'dr', 'dDR', 'billings', 'fcf', 'begCash', 'endCash'];

  function checkQuarter(Q, prev, hist, idx, name) {
    for (const k of INT_KEYS) if (!Number.isInteger(Q[k])) f.push(`${name}.${k} not integer: ${Q[k]}`);
    eqI(Q.begARR, prev.endARR, `${name} BegARR = prior EndARR`);
    eqI(Q.endARR, Q.begARR + Q.newARR + Q.expARR - Q.churnARR, `${name} ARR rollforward`);
    eqI(Q.revenue, Math.round((Q.begARR + Q.endARR) / 8), `${name} revenue formula`);
    eqI(Q.grossProfit, Q.revenue - Q.hosting - Q.support, `${name} gross profit`);
    eqI(Q.totalOpex, Q.sm + Q.rd + Q.ga, `${name} total opex`);
    eqI(Q.opIncome, Q.grossProfit - Q.totalOpex, `${name} operating income`);
    if (!Q.smOverride) eqI(Q.sm, Math.round(Q.revenue * Q.drivers.smPct), `${name} S&M = % of revenue`);
    eqI(Q.dr, Math.round(Q.endARR * Q.drivers.prepaid * 0.5), `${name} deferred revenue`);
    eqI(Q.dDR, Q.dr - prev.dr, `${name} dDR`);
    eqI(Q.billings, Q.revenue + Q.dDR, `${name} billings`);
    eqI(Q.fcf, Q.opIncome + Q.dDR, `${name} FCF`);
    eqI(Q.begCash, prev.endCash, `${name} beginning cash = prior ending cash`);
    eqI(Q.endCash, Q.begCash + Q.fcf, `${name} cash rollforward`);
    const rev = Q.revenue;
    eqF(Q.gmPct, Q.grossProfit / rev, `${name} GM%`);
    eqF(Q.hostingPct, Q.hosting / rev, `${name} hosting %`);
    eqF(Q.supportPct, Q.support / rev, `${name} support %`);
    eqF(Q.smPct, Q.sm / rev, `${name} S&M %`);
    eqF(Q.rdPct, Q.rd / rev, `${name} R&D %`);
    eqF(Q.gaPct, Q.ga / rev, `${name} G&A %`);
    eqF(Q.opexPct, Q.totalOpex / rev, `${name} opex %`);
    eqF(Q.opMarginPct, Q.opIncome / rev, `${name} op margin %`);
    eqF(Q.fcfMargin, Q.fcf / rev, `${name} FCF margin`);
    const burn = Q.fcf < 0 ? -Q.fcf / 3 : 0;
    eqF(Q.monthlyBurn, burn, `${name} monthly burn`);
    eqF(Q.runway, burn > 0 ? Q.endCash / burn : null, `${name} runway`);
    eqF(Q.cacPayback, Q.sm / ((Q.newARR + Q.expARR) * (Q.grossProfit / rev)) * 12, `${name} CAC payback`);
    if (idx >= 3) {
      const w = [hist[idx - 3], hist[idx - 2], hist[idx - 1], Q];
      let e = 0, c = 0; for (const x of w) { e += x.expARR; c += x.churnARR; }
      eqF(Q.ndr, (w[0].begARR + e - c) / w[0].begARR, `${name} NDR`);
    } else if (Q.ndr !== null) f.push(`${name} NDR should be null`);
    if (idx >= 4) {
      const yoy = Q.endARR / hist[idx - 4].endARR - 1;
      eqF(Q.arrYoY, yoy, `${name} ARR YoY`);
      eqF(Q.ruleOf40, (yoy + Q.fcf / rev) * 100, `${name} Rule of 40`);
    }
  }

  const qs = ds.quarters;
  if (!qs || qs.length !== 8) { f.push('expected 8 quarters'); return f; }
  let prev = ds.opening;
  qs.forEach((Q, i) => { checkQuarter(Q, prev, qs, i, `Q${i}(${i === 7 ? 'actual' : 'hist'})`); prev = Q; });
  checkQuarter(ds.budget, qs[6], qs, 7, 'budget');

  // BvA
  const A = qs[7], B = ds.budget, PY = qs[3];
  if (!ds.bva || ds.bva.length !== ROWS.length) f.push('BvA row count');
  else ds.bva.forEach((row, i) => {
    const R = ROWS[i];
    if (row.key !== R.key) f.push(`BvA row ${i} key`);
    eqF(row.actual, A[R.key], `BvA ${R.key} actual`);
    eqF(row.budget, B[R.key], `BvA ${R.key} budget`);
    eqF(row.py, PY[R.key], `BvA ${R.key} PY`);
    const a = A[R.key], b = B[R.key];
    if (R.kind === 'usd') {
      eqF(row.var, a - b, `BvA ${R.key} variance`);
      eqF(row.varPct, b !== 0 ? (a - b) / Math.abs(b) : null, `BvA ${R.key} var%`);
    } else if (a != null && b != null) {
      eqF(row.var, a - b, `BvA ${R.key} variance`);
      if (R.kind === 'pct') eqF(row.varBps, (a - b) * 10000, `BvA ${R.key} bps`);
    }
  });
  const gmRow = ds.bva && ds.bva.find((r) => r.key === 'gmPct');
  if (gmRow) eqF(gmRow.varBps, (A.grossProfit / A.revenue - B.grossProfit / B.revenue) * 10000, 'GM variance bps');

  // anomalies
  const an = ds.anomalies || [];
  if (an.length < 1 || an.length > 2) f.push(`anomaly count ${an.length}`);
  if (an.length === 2) {
    if (an[0].id === an[1].id) f.push('duplicate anomaly');
    if (an[0].lines.some((l) => an[1].lines.includes(l))) f.push('anomalies hit the same line');
    if (an[0].severity < an[1].severity) f.push('anomalies not sorted by severity');
  }
  for (const a of an) if (!a.diagnostic) f.push(`anomaly ${a.id} missing diagnostic`);
  return f;
}

// Generate + validate; on failure regenerate with seed+1.
export function safeGenerate(seed, archetype, warn = () => {}) {
  let s = seed >>> 0;
  for (let i = 0; i < 50; i++) {
    const ds = generateCompany(s, archetype);
    const fails = validate(ds);
    if (!fails.length) return ds;
    warn(`Crunching: dataset seed ${s} failed tie-out (${fails.length}): ${fails.slice(0, 3).join('; ')}. Regenerating with seed+1.`);
    s = (s + 1) >>> 0;
  }
  throw new Error('Could not generate a valid dataset');
}

// ---------------------------------------------------------------- timing / levels
export const M1_FLASH_MS = [10000, 8000, 6000, 5000, 4000];
export const M1_ANSWER_MS = 12000;
export const M1_FLASHES = 5;
export const M2_TIME_MS = [15000, 12000, 10000, 8000, 6000];
export const M2_QUESTIONS = 8;
export const GATE = { window: 20, drill: 0.60, advance: 0.85, latencyFrac: 0.70 };

export function median(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }

// window: [{score, latencyMs}] (already the last <= 20 at the current level)
export function evaluateGate(window, limitMs) {
  const n = window.length;
  const accuracy = mean(window.map((q) => q.score));
  const medianMs = median(window.map((q) => q.latencyMs));
  let status;
  if (n < GATE.window) status = 'Calibrating';
  else if (accuracy < GATE.drill) status = 'Drill';
  else if (accuracy >= GATE.advance && medianMs <= GATE.latencyFrac * limitMs) status = 'Advance';
  else status = 'Hold';
  return { status, n, accuracy, medianMs };
}
export function nextLevel(level, status) {
  if (status === 'Drill') return Math.max(1, level - 1);
  if (status === 'Advance') return Math.min(5, level + 1);
  return level;
}

// ---------------------------------------------------------------- scoring
export const UNITS = ['$M', '$k', '%', 'bps', 'mo'];
const UNIT_DEF = { '$M': ['money', 1000], '$k': ['money', 1], '%': ['ratio', 1], 'bps': ['ratio', 0.01], 'mo': ['time', 1] };
export function convertUnit(value, from, to) {
  if (from === to) return value;
  const a = UNIT_DEF[from], b = UNIT_DEF[to];
  if (!a || !b || a[0] !== b[0]) return null;
  return value * a[1] / b[1];
}
// returns {score, value (converted), relErr|absErr}
export function scoreNumeric(expected, expectedUnit, given, givenUnit) {
  if (given == null || !isFinite(given)) return { score: 0, value: null, err: null };
  const v = convertUnit(given, givenUnit, expectedUnit);
  if (v == null) return { score: 0, value: null, err: null };
  if (expected !== 0 && Math.sign(v) !== Math.sign(expected)) return { score: 0, value: v, err: Math.abs(v - expected) / Math.abs(expected) };
  if (expectedUnit === 'bps') {
    const e = Math.abs(v - expected);
    return { score: e <= 10 + 1e-9 ? 1 : e <= 25 + 1e-9 ? 0.5 : 0, value: v, err: expected !== 0 ? e / Math.abs(expected) : null };
  }
  if (expected === 0) return { score: Math.abs(v) < 1e-9 ? 1 : 0, value: v, err: null };
  const rel = Math.abs(v - expected) / Math.abs(expected);
  return { score: rel <= 0.02 + 1e-9 ? 1 : rel <= 0.05 + 1e-9 ? 0.5 : 0, value: v, err: rel };
}

// ---------------------------------------------------------------- Module 1 questions
const M1_FILLERS = ['support', 'ga', 'revenue', 'sm'];
export const M1_METRICS = {
  gm_bps: { tag: 'margin', unit: 'bps', prompt: 'GM % variance vs budget, in bps?' },
  opinc_var: { tag: 'margin', unit: '$k', prompt: 'Operating income variance vs budget?' },
  burn_annual: { tag: 'cash', unit: '$M', prompt: 'Annualized burn run-rate (monthly burn × 12)?' },
  runway: { tag: 'cash', unit: 'mo', prompt: 'Runway in months?' },
  end_arr: { tag: 'growth', unit: '$M', prompt: 'Ending ARR?' },
};
// Expected values use the precision shown in the table.
export function m1MetricValue(metric, ds) {
  const A = ds.quarters[7], B = ds.budget;
  switch (metric) {
    case 'gm_bps': return Math.round((A.gmPct - B.gmPct) * 10000);
    case 'opinc_var': return dispK(A.opIncome - B.opIncome);
    case 'burn_annual': return dispK(A.monthlyBurn) * 12 / 1000;
    case 'runway': return A.runway == null ? null : Math.round(A.runway * 10) / 10;
    case 'end_arr': return dispK(A.endARR) / 1000;
  }
  return null;
}
export function chooseM1Metric(ds, r) {
  const A = ds.quarters[7];
  const burning = A.monthlyBurn > 0;
  switch (ds.anomalies[0].id) {
    case 'hosting_outgrowth': return 'gm_bps';
    case 'hiring_pull_forward': return burning && r() < 0.5 ? 'burn_annual' : 'opinc_var';
    case 'billing_shift': return burning ? (r() < 0.5 ? 'burn_annual' : 'runway') : 'end_arr';
    default: return 'end_arr';
  }
}
export function buildM1Questions(ds, qseed) {
  const r = mulberry32((qseed ^ 0xA5A5A5A5) >>> 0);
  const prim = ds.anomalies[0];
  const injected = ds.anomalies.map((a) => a.id);
  const blocked = new Set();
  for (const id of injected) { ANOMALIES[id].lines.forEach((l) => blocked.add(l)); ANOMALIES[id].downstream.forEach((l) => blocked.add(l)); }
  const otherPrimaries = shuffle(r, ANOMALY_IDS.filter((id) => !injected.includes(id)).map((id) => ANOMALIES[id].primary));
  const pool = [];
  for (const k of [...otherPrimaries, ...shuffle(r, M1_FILLERS)]) if (!blocked.has(k) && !pool.includes(k) && k !== prim.primary) pool.push(k);
  const qa = {
    id: 'a', qtype: 'biggest_miss', tag: 'variance_read', kind: 'mc', prompt: 'Which line drove the biggest miss?',
    options: shuffle(r, [prim.primary, ...pool.slice(0, 3)]).map((k) => ({ key: k, label: ROW_LABEL[k] })),
    answer: prim.primary, expectedUnit: 'choice',
  };
  const metric = chooseM1Metric(ds, r);
  const M = M1_METRICS[metric];
  const qb = { id: 'b', qtype: metric, tag: M.tag, kind: 'numeric', prompt: M.prompt, answer: m1MetricValue(metric, ds), expectedUnit: M.unit };
  const wrong = shuffle(r, ANOMALY_IDS.filter((id) => !injected.includes(id))).slice(0, 3);
  const qc = {
    id: 'c', qtype: 'root_cause', tag: 'diagnosis', kind: 'mc', prompt: 'What is the root cause?',
    options: shuffle(r, [prim.id, ...wrong]).map((id) => ({ key: id, label: ANOMALIES[id].rootCause })),
    answer: prim.id, expectedUnit: 'choice',
  };
  return [qa, qb, qc];
}

// ---------------------------------------------------------------- Module 2 templates
export const M2_TEMPLATES = {
  T1: { tag: 'cash', unit: '$M', name: 'Annualized burn' },
  T2: { tag: 'cash', unit: 'mo', name: 'Runway' },
  T3: { tag: 'margin', unit: 'bps', name: 'GM impact' },
  T4: { tag: 'unit_econ', unit: 'mo', name: 'CAC payback' },
  T5: { tag: 'growth', unit: '%', name: 'Rule of 40' },
  T6: { tag: 'growth', unit: '%', name: 'NDR' },
};
export function m2Pool(level) {
  if (level <= 2) return ['T1', 'T2'];
  if (level === 3) return ['T1', 'T2', 'T3', 'T4', 'T6'];
  return ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
}
// Anchor rounding (CLAUDE.md section 7)
export const anchorARR = (k) => Math.max(0.5, Math.round(k / 500) / 2); // $M to 0.5
export const anchorFlow = (k) => Math.max(0.1, Math.round(k / 100) / 10); // $M to 0.1
export const anchorBurn = (k) => Math.round(k / 50) * 50; // $k to 50
export const anchorCash = (k) => Math.round(k / 1000); // $M to 1
export const anchorPct = (d) => Math.round(d * 100); // whole %

function m2Burn(A, r) {
  let b = anchorBurn(A.monthlyBurn);
  if (b < 100) b = Math.max(100, anchorBurn(A.totalOpex / 3 * uni(r, 0.15, 0.35)));
  return b;
}
const f1 = (x) => x.toFixed(1);
const f2 = (x) => trimNum(x, 2);

export function buildM2Question(seed, archetype, templateId, compound) {
  const ds = safeGenerate(seed, archetype);
  const r = mulberry32(((ds.seed * 31) ^ 0x5bd1e995 ^ templateId.charCodeAt(1)) >>> 0);
  const A = ds.quarters[7], B = ds.budget;
  const T = M2_TEMPLATES[templateId];
  let prompt, anchors, answer, steps;
  switch (templateId) {
    case 'T1': {
      const burn = m2Burn(A, r);
      const h = pick(r, [50, 100, 150, 200, 250, 300]);
      const c = compound ? pick(r, [50, 100, 150]) : 0;
      const nb = burn + h - c;
      answer = nb * 12 / 1000;
      anchors = { burn, h, c };
      prompt = `Monthly burn is ${fmtKM(burn)}. We add ${fmtM(h * 12 / 1000)}/yr of hiring${compound ? ` and cut ${fmtM(c * 12 / 1000)}/yr of software spend` : ''}. New annualized burn?`;
      steps = [`${fmtM(h * 12 / 1000)}/yr = ${fmtKM(h)}/mo`];
      if (compound) steps.push(`${fmtM(c * 12 / 1000)}/yr = ${fmtKM(c)}/mo`);
      steps.push(`${fmtKM(burn)} + ${fmtKM(h)}${compound ? ` − ${fmtKM(c)}` : ''} = ${fmtKM(nb)}/mo`, `× 12 = ${fmtM(answer)}`);
      break;
    }
    case 'T2': {
      const cash = Math.max(3, anchorCash(A.endCash));
      const burn = m2Burn(A, r);
      let d = pick(r, [50, 100, 150, 200, -50, -100]);
      if (burn + d < 100) d = Math.abs(d);
      const one = compound ? pick(r, [1, 2, 3]) : 0;
      const nb = burn + d, nc = cash + one;
      answer = nc * 1000 / nb;
      anchors = { cash, burn, d, one };
      prompt = `Cash is ${fmtM(cash)} and monthly burn is ${fmtKM(burn)}. Burn ${d > 0 ? 'rises' : 'falls'} by ${fmtKM(Math.abs(d))}/mo${compound ? `, and we collect a ${fmtM(one)} one-time payment` : ''}. Runway in months?`;
      steps = [`New burn: ${fmtKM(burn)} ${d > 0 ? '+' : '−'} ${fmtKM(Math.abs(d))} = ${fmtKM(nb)}/mo`];
      if (compound) steps.push(`Cash: ${fmtM(cash)} + ${fmtM(one)} = ${fmtM(nc)}`);
      steps.push(`${fmtM(nc)} ÷ ${fmtM(nb / 1000, 3)}/mo = ${f1(answer)} mo`);
      break;
    }
    case 'T3': {
      const rev = anchorARR(A.revenue);
      const p = Math.max(1, anchorPct(A.hostingPct));
      const host = rev * p / 100;
      const x = pick(r, [10, 15, 20, 25, 30, 40, 50]);
      const g = compound ? pick(r, [5, 10, 20]) : 0;
      const newShare = p * (1 + x / 100) / (1 + g / 100); // % of new revenue
      answer = -(newShare - p) * 100;
      anchors = { rev, p, x, g };
      prompt = `Quarterly revenue is ${fmtM(rev)} and hosting is ${fmtM(host, 3)} (${p}% of revenue). Hosting rises ${x}%${compound ? ` while revenue grows ${g}%` : ' with revenue flat'}. Change in gross margin (bps)?`;
      if (!compound) steps = [`Hosting = ${p}% of revenue`, `${x}% × ${p}% = ${f2(p * x / 100)} pts`, `GM ${fmtBps(answer)}`];
      else steps = [`Hosting share: ${p}% × ${f2(1 + x / 100)} = ${f2(p * (1 + x / 100))}% of old revenue`,
        `÷ ${f2(1 + g / 100)} = ${f2(newShare)}% of new revenue`, `${f2(newShare)}% − ${p}% → GM ${fmtBps(answer)}`];
      break;
    }
    case 'T4': {
      const sm = anchorFlow(A.sm);
      const na = anchorFlow(A.newARR);
      const gm = anchorPct(A.gmPct);
      const n2 = compound ? na * 0.9 : na;
      const gmArr = n2 * gm / 100;
      answer = sm / gmArr * 12;
      anchors = { sm, na, gm };
      prompt = `Quarterly S&M is ${fmtM(sm)}, new ARR is ${fmtM(na)}, gross margin is ${gm}%${compound ? ', and bookings miss by 10%' : ''}. CAC payback in months?`;
      steps = [];
      if (compound) steps.push(`Bookings −10%: ${fmtM(na)} → ${fmtM(n2, 3)}`);
      steps.push(`GM-adjusted new ARR: ${fmtM(n2, 3)} × ${gm}% = ${fmtM(gmArr, 3)}`, `${fmtM(sm)} ÷ ${fmtM(gmArr, 3)} = ${f2(sm / gmArr)} yrs`, `× 12 = ${f1(answer)} mo`);
      break;
    }
    case 'T5': {
      const py = anchorARR(ds.quarters[3].endARR);
      const plan = anchorARR(B.endARR);
      const miss = Math.max(0.5, Math.round(plan * uni(r, 0.02, 0.06) * 2) / 2);
      const fcf = anchorPct(B.fcfMargin);
      const slip = compound ? pick(r, [2, 3, 5]) : 0;
      const cur = plan - miss;
      const growth = (cur / py - 1) * 100;
      const f = fcf - slip;
      answer = growth + f;
      anchors = { py, plan, miss, fcf, slip };
      prompt = `ARR was ${fmtM(py)} a year ago. Plan has ARR at ${fmtM(plan)} now, but we miss by ${fmtM(miss)}. FCF margin is ${fcf}%${compound ? ` and slips ${slip} points` : ''}. New Rule of 40?`;
      steps = [`ARR: ${fmtM(plan)} − ${fmtM(miss)} = ${fmtM(cur)}`, `Growth: ${fmtM(cur)} ÷ ${fmtM(py)} − 1 = ${f1(growth)}%`];
      if (compound) steps.push(`FCF margin: ${fcf} − ${slip} = ${f}%`);
      steps.push(`${f1(growth)} + (${f}) = ${f1(answer)}`);
      break;
    }
    case 'T6': {
      const w = ds.quarters.slice(4, 8);
      const beg = anchorARR(w[0].begARR);
      const exp = anchorFlow(w.reduce((s, x) => s + x.expARR, 0));
      const churn = anchorFlow(w.reduce((s, x) => s + x.churnARR, 0));
      const c2 = compound ? churn * 1.2 : churn;
      const net = exp - c2;
      answer = (beg + net) / beg * 100;
      anchors = { beg, exp, churn };
      prompt = `ARR a year ago was ${fmtM(beg)}. Over the last 12 months that base expanded ${fmtM(exp)} and churned ${fmtM(churn)}${compound ? '; now assume churn runs 20% higher' : ''}. NDR?`;
      steps = [];
      if (compound) steps.push(`Churn: ${fmtM(churn)} × 1.2 = ${fmtM(c2, 3)}`);
      steps.push(`Net: ${fmtM(exp)} − ${fmtM(c2, 3)} = ${net >= 0 ? '+' : ''}${fmtM(net, 3)}`, `${fmtM(net, 3)} ÷ ${fmtM(beg)} = ${net >= 0 ? '+' : '−'}${f1(Math.abs(net / beg * 100))}%`, `NDR = ${f1(answer)}%`);
      break;
    }
    default: throw new Error(`Unknown template ${templateId}`);
  }
  return { templateId, id: templateId + (compound ? 'c' : ''), tag: T.tag, unit: T.unit, name: T.name, compound: !!compound,
    seed: ds.seed, archetype, prompt, anchors, answer, steps, company: { label: ds.quarters[7].label } };
}
