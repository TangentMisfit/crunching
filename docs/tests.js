// Crunching test suite. Runs in the browser (tests.html) and in Node (tests/run.mjs).
import * as E from './engine.js';

const SEEDS = 500;

export function runTests() {
  const results = [];
  const test = (name, fn) => {
    const t0 = Date.now();
    try {
      const detail = fn();
      results.push({ name, pass: true, detail: detail || '', ms: Date.now() - t0 });
    } catch (e) {
      results.push({ name, pass: false, detail: e && e.message ? e.message : String(e), ms: Date.now() - t0 });
    }
  };
  const assert = (c, msg) => { if (!c) throw new Error(msg); };
  const near = (a, b, tol, msg) => assert(a != null && b != null && Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

  // generate the corpus once
  const corpus = { B2B: [], B2C: [] };
  for (const arch of ['B2B', 'B2C']) for (let s = 1; s <= SEEDS; s++) corpus[arch].push(E.generateCompany(s, arch));
  const all = [...corpus.B2B, ...corpus.B2C];

  // ---------------------------------------------------------------- determinism
  test('PRNG: mulberry32 is deterministic and in [0,1)', () => {
    const a = E.mulberry32(42), b = E.mulberry32(42);
    for (let i = 0; i < 1000; i++) { const x = a(); assert(x === b() && x >= 0 && x < 1, 'mismatch'); }
  });
  test('Determinism: same seed gives a deep-equal dataset (both archetypes)', () => {
    for (const arch of ['B2B', 'B2C']) for (const s of [1, 7, 12345, 4294967295]) {
      assert(JSON.stringify(E.generateCompany(s, arch)) === JSON.stringify(E.generateCompany(s, arch)), `${arch} seed ${s}`);
    }
  });
  test('Determinism: different seeds give different datasets', () => {
    const seen = new Set();
    for (const ds of all) seen.add(JSON.stringify(ds.quarters));
    assert(seen.size === all.length, `only ${seen.size} unique of ${all.length}`);
  });

  // ---------------------------------------------------------------- tie-out
  for (const arch of ['B2B', 'B2C']) {
    test(`Tie-out: ${SEEDS} ${arch} seeds pass validate() with zero failures`, () => {
      let bad = 0, first = '';
      for (const ds of corpus[arch]) { const f = E.validate(ds); if (f.length) { bad++; if (!first) first = `seed ${ds.seed}: ${f[0]}`; } }
      assert(bad === 0, `${bad} datasets failed. ${first}`);
      return `${SEEDS}/${SEEDS} clean`;
    });
  }
  test('Tie-out: validate() catches corrupted datasets', () => {
    const ds = E.generateCompany(99, 'B2B');
    const c1 = JSON.parse(JSON.stringify(ds)); c1.quarters[5].hosting += 1;
    const c2 = JSON.parse(JSON.stringify(ds)); c2.budget.endCash += 1;
    const c3 = JSON.parse(JSON.stringify(ds)); c3.bva[0].var += 1;
    const c4 = JSON.parse(JSON.stringify(ds)); c4.quarters[2].revenue += 1;
    for (const [n, c] of [['hosting', c1], ['cash', c2], ['variance', c3], ['revenue', c4]]) assert(E.validate(c).length > 0, `missed ${n}`);
  });
  test('Tie-out: budget uses actual opening balances', () => {
    for (const ds of all.slice(0, 200)) {
      const q6 = ds.quarters[6];
      assert(ds.budget.begARR === q6.endARR && ds.budget.begCash === q6.endCash && ds.budget.dDR === ds.budget.dr - q6.dr, `seed ${ds.seed}`);
      assert(ds.quarters[7].begCash === ds.budget.begCash, 'actual/budget beginning cash differ');
    }
  });
  test('safeGenerate returns a validated dataset with the requested seed', () => {
    const ds = E.safeGenerate(2024, 'B2C');
    assert(ds.seed === 2024 && E.validate(ds).length === 0, 'not clean');
  });

  // ---------------------------------------------------------------- anomalies
  test('Anomalies: every type injected at least once', () => {
    const count = Object.fromEntries(E.ANOMALY_IDS.map((id) => [id, 0]));
    for (const ds of all) for (const a of ds.anomalies) count[a.id]++;
    for (const id of E.ANOMALY_IDS) assert(count[id] > 0, `${id} never injected`);
    return Object.entries(count).map(([k, v]) => `${k}:${v}`).join(' ');
  });
  test('Anomalies: 1-2 per dataset, disjoint lines, sorted by severity', () => {
    let pairs = 0;
    for (const ds of all) {
      const an = ds.anomalies;
      assert(an.length >= 1 && an.length <= 2, `count ${an.length}`);
      if (an.length === 2) {
        pairs++;
        assert(!an[0].lines.some((l) => an[1].lines.includes(l)), `seed ${ds.seed} overlap`);
        assert(an[0].severity >= an[1].severity, 'unsorted');
      }
    }
    assert(pairs > 0, 'no pairs');
  });
  test('Anomalies: magnitudes land in the specified ranges', () => {
    for (const ds of all) {
      const A = ds.quarters[7], B = ds.budget, P = B.drivers, D = A.drivers;
      const revVar = Math.abs(A.revenue - B.revenue) / B.revenue;
      for (const a of ds.anomalies) {
        const m = `seed ${ds.seed} ${ds.archetype} ${a.id}`;
        if (a.id === 'hosting_outgrowth') {
          const r = D.hostPct / P.hostPct - 1; assert(r >= 0.15 - 1e-12 && r <= 0.35 + 1e-12, `${m} driver ${r}`);
          const hv = (A.hosting - B.hosting) / B.hosting; assert(hv > 0.10 && hv < 0.40, `${m} hosting var ${hv}`);
          if (ds.anomalies.length === 1) assert(revVar < 0.02, `${m} revenue not near plan ${revVar}`);
        }
        if (a.id === 'paid_search_inflation') {
          const r = 1 - D.newRate / P.newRate; assert(r >= 0.15 - 1e-12 && r <= 0.30 + 1e-12, `${m} ${r}`);
          const sv = (A.sm - B.sm) / B.sm, tol = 0.5 / B.sm;
          assert(sv >= 0.05 - tol && sv <= 0.15 + tol, `${m} S&M var ${sv}`);
          assert(A.cacPayback > B.cacPayback, `${m} payback did not degrade`);
        }
        if (a.id === 'billing_shift') {
          const cap = P.prepaid - 0.05;
          assert((a.magnitude >= 0.10 - 1e-12 || Math.abs(a.magnitude - cap) < 1e-12) && a.magnitude <= 0.25 + 1e-12, `${m} cohort drop ${a.magnitude}`);
          const w = (0.25 * A.begARR + A.newARR + A.expARR) / A.endARR;
          assert(Math.abs(D.prepaid - (P.prepaid - a.magnitude * Math.min(1, w))) < 1e-12, `${m} prepaid share ${D.prepaid}`);
          assert(A.dDR < B.dDR && A.fcf < B.fcf, `${m} dDR/FCF not down`);
          if (ds.anomalies.length === 1) assert(revVar < 0.02, `${m} revenue not near plan`);
        }
        if (a.id === 'churn_spike') {
          const r = D.churnRate / P.churnRate - 1; assert(r >= 0.5 - 1e-12 && r <= 1 + 1e-12, `${m} ${r}`);
          assert(A.ndr < B.ndr, `${m} NDR not down`);
        }
        if (a.id === 'hiring_pull_forward') {
          const r = D.rdPct / P.rdPct - 1; assert(r >= 0.10 - 1e-12 && r <= 0.20 + 1e-12, `${m} ${r}`);
          assert(A.rd > B.rd && A.totalOpex > B.totalOpex && A.opIncome < B.opIncome, `${m} R&D/opex/op income`);
        }
      }
    }
  });
  test('Anomalies: diagnostic text contains the correct computed numbers', () => {
    const U = E.fmtUSD, P = E.fmtPct;
    const sp = (d) => { const v = Math.abs(d * 100).toFixed(1); return v === '0.0' ? '0.0%' : `${d >= 0 ? '+' : '−'}${v}%`; };
    let checked = 0;
    for (const ds of all) {
      const A = ds.quarters[7], B = ds.budget;
      const within = `within ${(Math.abs(A.revenue - B.revenue) / B.revenue * 100).toFixed(1)}%`;
      for (const a of ds.anomalies) {
        const t = a.diagnostic;
        const need = [];
        if (a.id === 'hosting_outgrowth') {
          const bps = Math.round((A.grossProfit / A.revenue - B.grossProfit / B.revenue) * 10000);
          need.push(`${Math.abs(bps)} bps ${bps >= 0 ? 'above' : 'below'}`, `(${P(A.grossProfit / A.revenue)} vs ${P(B.grossProfit / B.revenue)})`,
            `Hosting ran ${U(Math.abs(A.hosting - B.hosting))}`, sp((A.hosting - B.hosting) / B.hosting), within);
        }
        if (a.id === 'paid_search_inflation') {
          const pay = (Q) => (Q.sm / ((Q.newARR + Q.expARR) * Q.grossProfit / Q.revenue) * 12).toFixed(1);
          const pd = (A.sm / ((A.newARR + A.expARR) * A.grossProfit / A.revenue) - B.sm / ((B.newARR + B.expARR) * B.grossProfit / B.revenue)) * 12;
          need.push(`${U(A.newARR)} vs ${U(B.newARR)}`, sp((A.newARR - B.newARR) / B.newARR), `${U(A.sm)} vs ${U(B.sm)}`, sp((A.sm - B.sm) / B.sm),
            `${pay(A)} months vs ${pay(B)}`, `(${pd >= 0 ? '+' : '−'}${Math.abs(pd).toFixed(1)} months)`);
        }
        if (a.id === 'billing_shift') {
          need.push(`${U(A.revenue + A.dDR)} vs ${U(B.revenue + B.dDR)}`, `${U(B.dr - A.dr)} below plan`, within);
          if (A.fcf < 0) need.push(U(-A.fcf / 3)); else need.push(U(A.fcf));
        }
        if (a.id === 'churn_spike') {
          need.push(`${U(A.churnARR)} vs ${U(B.churnARR)}`, sp((A.churnARR - B.churnARR) / B.churnARR), `${P(A.ndr)} vs ${P(B.ndr)}`, U(Math.abs(A.endARR - B.endARR)));
        }
        if (a.id === 'hiring_pull_forward') {
          need.push(`R&D ran ${U(Math.abs(A.rd - B.rd))}`, sp((A.rd - B.rd) / B.rd), `opex finished ${U(Math.abs(A.totalOpex - B.totalOpex))}`,
            U(Math.abs(A.opIncome - B.opIncome)), within);
        }
        for (const s of need) assert(t.includes(s), `seed ${ds.seed} ${a.id}: "${s}" not in "${t}"`);
        checked++;
      }
    }
    return `${checked} diagnostics checked`;
  });
  test('Anomalies: example diagnostic (seed 1 B2B)', () => corpus.B2B[0].anomalies.map((a) => a.diagnostic).join(' | '));

  // ---------------------------------------------------------------- ranges
  test('Range: GM% between 55% and 90% (all quarters + budget)', () => {
    let lo = 1, hi = 0;
    for (const ds of all) for (const Q of [...ds.quarters, ds.budget]) {
      lo = Math.min(lo, Q.gmPct); hi = Math.max(hi, Q.gmPct);
      assert(Q.gmPct >= 0.55 && Q.gmPct <= 0.90, `seed ${ds.seed} GM ${Q.gmPct}`);
    }
    return `observed ${(lo * 100).toFixed(1)}%–${(hi * 100).toFixed(1)}%`;
  });
  test('Range: NDR 80–140% (B2B), 50–140% (B2C: churn 4–8%/qtr caps TTM NDR below 80%)', () => {
    const obs = { B2B: [9, 0], B2C: [9, 0] };
    for (const ds of all) for (const Q of [...ds.quarters.slice(3), ds.budget]) {
      const lo = ds.archetype === 'B2B' ? 0.80 : 0.50;
      obs[ds.archetype][0] = Math.min(obs[ds.archetype][0], Q.ndr); obs[ds.archetype][1] = Math.max(obs[ds.archetype][1], Q.ndr);
      assert(Q.ndr >= lo && Q.ndr <= 1.40, `seed ${ds.seed} ${ds.archetype} NDR ${Q.ndr}`);
    }
    return Object.entries(obs).map(([k, [a, b]]) => `${k} ${(a * 100).toFixed(1)}–${(b * 100).toFixed(1)}%`).join(', ');
  });
  test('Range: runway > 0 whenever burning; cash never negative', () => {
    for (const ds of all) {
      assert(ds.opening.endCash > 0, `seed ${ds.seed} opening cash`);
      for (const Q of [...ds.quarters, ds.budget]) {
        assert(Q.endCash > 0, `seed ${ds.seed} cash ${Q.endCash}`);
        if (Q.monthlyBurn > 0) assert(Q.runway > 0, `seed ${ds.seed} runway`);
        else assert(Q.runway === null, 'runway should be CF+');
      }
    }
  });
  test('Realism: starting runway 15–36 months (current-quarter budget, every burning dataset)', () => {
    const out = [];
    for (const arch of ['B2B', 'B2C']) {
      let lo = Infinity, hi = -Infinity, n = 0;
      for (const ds of corpus[arch]) {
        const B = ds.budget;
        if (!(B.monthlyBurn > 0)) continue;
        n++; lo = Math.min(lo, B.runway); hi = Math.max(hi, B.runway);
        assert(B.runway >= 15 - 0.05 && B.runway <= 36.05, `${arch} seed ${ds.seed} runway ${B.runway}`);
        for (const Q of [...ds.quarters, B]) assert(Q.endCash >= 3 * B.monthlyBurn - 1, `${arch} seed ${ds.seed} cash below 3 months of burn`);
      }
      out.push(`${arch} ${lo.toFixed(1)} to ${hi.toFixed(1)} mo (n=${n})`);
    }
    return out.join('; ');
  });

  // ---------------------------------------------------------------- realism (current quarter, actual AND budget)
  const REAL = {
    smPct: { label: 'S&M % of revenue', B2B: [0.25, 0.65], B2C: [0.20, 0.60], get: (Q) => Q.smPct, fmt: (v) => `${(v * 100).toFixed(1)}%` },
    cac: { label: 'CAC payback (months)', B2B: [4, 48], B2C: [4, 48], get: (Q) => Q.sm / ((Q.newARR + Q.expARR) * Q.grossProfit / Q.revenue) * 12, fmt: (v) => v.toFixed(1) },
    fcfm: { label: 'FCF margin', B2B: [-0.70, 0.25], B2C: [-0.70, 0.25], get: (Q) => Q.fcf / Q.revenue, fmt: (v) => `${(v * 100).toFixed(1)}%` },
    r40: { label: 'Rule of 40', B2B: [-50, 80], B2C: [-50, 80], get: (Q) => Q.ruleOf40, fmt: (v) => v.toFixed(1) },
    bm: { label: 'Burn multiple (net burn / net new ARR; skipped unless burning and net new ARR ≥ 2% of beg ARR)', B2B: [0, 5], B2C: [0, 5],
      get: (Q) => (Q.fcf < 0 && Q.endARR - Q.begARR >= 0.02 * Q.begARR ? -Q.fcf / (Q.endARR - Q.begARR) : null), fmt: (v) => `${v.toFixed(2)}x` },
    burnArr: { label: 'Monthly burn / ending ARR', B2B: [0, 0.20], B2C: [0, 0.20], get: (Q) => Math.max(0, -Q.fcf) / 3 / Q.endARR, fmt: (v) => `${(v * 100).toFixed(1)}%` },
  };
  for (const [key, R] of Object.entries(REAL)) {
    test(`Realism: ${R.label} within B2B ${R.B2B.join('…')}, B2C ${R.B2C.join('…')}`, () => {
      const out = [];
      for (const arch of ['B2B', 'B2C']) {
        let lo = Infinity, hi = -Infinity, n = 0;
        const [a, b] = R[arch];
        for (const ds of corpus[arch]) for (const [who, Q] of [['actual', ds.quarters[7]], ['budget', ds.budget]]) {
          const v = R.get(Q);
          if (v == null) continue;
          n++; lo = Math.min(lo, v); hi = Math.max(hi, v);
          assert(v >= a - 1e-9 && v <= b + 1e-9, `${arch} seed ${ds.seed} ${who} (${ds.anomalies.map((x) => x.id).join('+')}): ${R.fmt(v)}`);
        }
        out.push(`${arch} ${R.fmt(lo)} to ${R.fmt(hi)} (n=${n})`);
      }
      return out.join('; ');
    });
  }

  test('Archetype: B2C median churn ≥ 2x B2B; B2C median expansion < B2B (500 seeds, all quarters)', () => {
    const med = (arch, key) => E.median(corpus[arch].flatMap((ds) => ds.quarters.map((Q) => Q[key] / Q.begARR)));
    const cB = med('B2B', 'churnARR'), cC = med('B2C', 'churnARR'), eB = med('B2B', 'expARR'), eC = med('B2C', 'expARR');
    assert(cC >= 2 * cB, `churn B2C ${cC} vs B2B ${cB}`);
    assert(eC < eB, `expansion B2C ${eC} vs B2B ${eB}`);
    const p = (x) => `${(x * 100).toFixed(2)}%`;
    return `median churn/qtr B2B ${p(cB)}, B2C ${p(cC)} (${(cC / cB).toFixed(2)}x); median expansion/qtr B2B ${p(eB)}, B2C ${p(eC)}`;
  });

  // ---------------------------------------------------------------- formatting
  test('Formatting: $, %, bps, months', () => {
    const cases = [[E.fmtUSD(412), '$412k'], [E.fmtUSD(1234), '$1.2M'], [E.fmtUSD(-1234), '($1.2M)'], [E.fmtUSD(-412), '($412k)'],
      [E.fmtUSD(999.6), '$1.0M'], [E.fmtUSD(0), '$0k'], [E.fmtPct(0.7412), '74.1%'], [E.fmtBps(-280.4), '−280 bps'],
      [E.fmtBps(12), '+12 bps'], [E.fmtMonths(17.25), '17.3'], [E.fmtMonths(null), 'CF+'], [E.fmtKM(650), '$650k'], [E.fmtKM(1250), '$1.25M']];
    for (const [a, b] of cases) assert(a === b, `"${a}" != "${b}"`);
  });

  // ---------------------------------------------------------------- scoring
  test('Scoring: numeric thresholds, sign, units, bps', () => {
    const S = (e, eu, g, gu) => E.scoreNumeric(e, eu, g, gu).score;
    const cases = [
      [S(9, '$M', 9, '$M'), 1], [S(9, '$M', 9.18, '$M'), 1], [S(9, '$M', 9.4, '$M'), 0.5], [S(9, '$M', 9.5, '$M'), 0],
      [S(0.75, '$M', 750, '$k'), 1], [S(750, '$k', 0.75, '$M'), 1], [S(9, '$M', 9, '%'), 0], [S(16, 'mo', 16, '$M'), 0],
      [S(-280, 'bps', 280, 'bps'), 0], [S(-280, 'bps', -290, 'bps'), 1], [S(-280, 'bps', -300, 'bps'), 0.5], [S(-280, 'bps', -310, 'bps'), 0],
      [S(-280, 'bps', -2.8, '%'), 1], [S(104, '%', 10400, 'bps'), 1], [S(-1200, '$k', -1.2, '$M'), 1], [S(-1200, '$k', 1200, '$k'), 0],
      [S(16, 'mo', null, 'mo'), 0], [S(16, 'mo', NaN, 'mo'), 0], [S(16, 'mo', 16.32, 'mo'), 1], [S(16, 'mo', 16.8, 'mo'), 0.5],
    ];
    cases.forEach(([a, b], i) => assert(a === b, `case ${i}: ${a} != ${b}`));
  });

  // ---------------------------------------------------------------- gates
  test('Gates: Calibrating / Drill / Advance / Hold, Drill first', () => {
    const w = (n, score, lat) => Array.from({ length: n }, () => ({ score, latencyMs: lat }));
    assert(E.evaluateGate(w(19, 1, 1000), 12000).status === 'Calibrating', 'calibrating');
    assert(E.evaluateGate(w(20, 0.5, 1000), 12000).status === 'Drill', 'drill');
    assert(E.evaluateGate(w(20, 0.9, 8400), 12000).status === 'Advance', 'advance at 70%');
    assert(E.evaluateGate(w(20, 0.9, 8500), 12000).status === 'Hold', 'hold slow');
    assert(E.evaluateGate(w(20, 0.84, 1000), 12000).status === 'Hold', 'hold acc');
    assert(E.evaluateGate([...w(10, 1, 100), ...w(10, 0.5, 100)], 12000).status === 'Hold', 'avg .75');
    assert(E.nextLevel(1, 'Drill') === 1 && E.nextLevel(5, 'Advance') === 5 && E.nextLevel(3, 'Advance') === 4 && E.nextLevel(3, 'Drill') === 2, 'nextLevel');
    assert(E.median([3, 1, 2]) === 2 && E.median([4, 1, 2, 3]) === 2.5, 'median');
  });

  // ---------------------------------------------------------------- M1 builders
  test('M1 builders: answers match independent recomputation', () => {
    const counts = {};
    for (const ds of all) {
      const qs = E.buildM1Questions(ds, ds.seed);
      const A = ds.quarters[7], B = ds.budget;
      const [qa, qb, qc] = qs;
      // a: primary line of the largest-$ anomaly
      const sev = (id) => ({ hosting_outgrowth: A.hosting - B.hosting, hiring_pull_forward: A.rd - B.rd,
        paid_search_inflation: B.newARR - A.newARR, churn_spike: A.churnARR - B.churnARR, billing_shift: B.dDR - A.dDR }[id]);
      const top = ds.anomalies.slice().sort((x, y) => sev(y.id) - sev(x.id))[0];
      assert(qa.answer === E.ANOMALIES[top.id].primary, `seed ${ds.seed} q a`);
      assert(qa.options.length === 4 && new Set(qa.options.map((o) => o.key)).size === 4 && qa.options.some((o) => o.key === qa.answer), `seed ${ds.seed} a options`);
      const hit = new Set(ds.anomalies.flatMap((x) => x.lines));
      assert(qa.options.filter((o) => hit.has(o.key)).length === 1, `seed ${ds.seed} a: distractor is an anomaly line`);
      // b
      const dk = (v) => (Math.abs(Math.round(v)) >= 1000 ? Math.round(v / 100) * 100 : Math.round(v));
      const ind = {
        gm_bps: Math.round((A.grossProfit / A.revenue - B.grossProfit / B.revenue) * 10000),
        opinc_var: dk(A.opIncome - B.opIncome),
        burn_annual: dk(Math.max(0, -A.fcf) / 3) * 12 / 1000,
        runway: A.fcf < 0 ? Math.round(A.endCash / (-A.fcf / 3) * 10) / 10 : null,
        end_arr: dk(A.endARR) / 1000,
      }[qb.qtype];
      near(qb.answer, ind, 1e-9, `seed ${ds.seed} q b ${qb.qtype}`);
      assert(qb.answer != null, `seed ${ds.seed} q b null`);
      counts[qb.qtype] = (counts[qb.qtype] || 0) + 1;
      // c
      assert(qc.answer === top.id && qc.options.length === 4 && new Set(qc.options.map((o) => o.key)).size === 4, `seed ${ds.seed} q c`);
      assert(qc.options.filter((o) => ds.anomalies.some((x) => x.id === o.key)).length === 1, `seed ${ds.seed} c has two injected`);
      // determinism
      assert(JSON.stringify(E.buildM1Questions(ds, ds.seed)) === JSON.stringify(qs), 'M1 builder not deterministic');
    }
    return Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(' ');
  });

  // ---------------------------------------------------------------- M2 builders
  test('M2 builders: answers match independent recomputation from the dataset', () => {
    let n = 0;
    for (const t of Object.keys(E.M2_TEMPLATES)) for (const compound of [false, true]) for (let s = 1; s <= 150; s++) {
      const arch = s % 2 ? 'B2B' : 'B2C';
      const q = E.buildM2Question(s, arch, t, compound);
      const ds = E.generateCompany(q.seed, arch);
      const A = ds.quarters[7], B = ds.budget, a = q.anchors;
      const r50 = (k) => Math.round(k / 50) * 50;
      const rArr = (k) => Math.max(0.5, Math.round(k / 500) / 2);
      const rFlow = (k) => Math.max(0.1, Math.round(k / 100) / 10);
      let exp;
      if (t === 'T1' || t === 'T2') {
        const b0 = r50(Math.max(0, -A.fcf) / 3);
        if (b0 >= 100) assert(a.burn === b0, `${t} burn anchor ${a.burn} vs ${b0}`);
        assert(a.burn % 50 === 0 && a.burn >= 100, 'burn anchor not mental-friendly');
      }
      if (t === 'T1') exp = (a.burn + a.h - a.c) * 12 / 1000;
      if (t === 'T2') { assert(a.cash === Math.max(3, Math.round(A.endCash / 1000)), 'cash anchor'); exp = (a.cash + a.one) / ((a.burn + a.d) / 1000); }
      if (t === 'T3') {
        assert(a.rev === rArr(A.revenue) && a.p === Math.max(1, Math.round(A.hosting / A.revenue * 100)), 'T3 anchors');
        const before = a.p / 100, after = (a.rev * a.p / 100) * (1 + a.x / 100) / (a.rev * (1 + a.g / 100));
        exp = (before - after) * 10000;
      }
      if (t === 'T4') {
        assert(a.sm === rFlow(A.sm) && a.na === rFlow(A.newARR) && a.gm === Math.round(A.grossProfit / A.revenue * 100), 'T4 anchors');
        exp = a.sm / (a.na * (compound ? 0.9 : 1) * a.gm / 100) * 12;
      }
      if (t === 'T5') {
        assert(a.py === rArr(ds.quarters[3].endARR) && a.plan === rArr(B.endARR) && a.fcf === Math.round(B.fcf / B.revenue * 100), 'T5 anchors');
        exp = ((a.plan - a.miss) / a.py - 1) * 100 + a.fcf - a.slip;
      }
      if (t === 'T6') {
        let e = 0, c = 0; for (let i = 4; i < 8; i++) { e += ds.quarters[i].expARR; c += ds.quarters[i].churnARR; }
        assert(a.beg === rArr(ds.quarters[4].begARR) && a.exp === rFlow(e) && a.churn === rFlow(c), 'T6 anchors');
        exp = (a.beg + a.exp - a.churn * (compound ? 1.2 : 1)) / a.beg * 100;
      }
      near(q.answer, exp, 1e-9, `${t}${compound ? 'c' : ''} seed ${s}`);
      assert(q.steps.length >= 2 && q.steps.length <= 4, `${t} steps ${q.steps.length}`);
      assert(q.unit === E.M2_TEMPLATES[t].unit && q.prompt.length > 20, 'unit/prompt');
      assert(E.scoreNumeric(q.answer, q.unit, q.answer, q.unit).score === 1, 'self-score');
      n++;
    }
    return `${n} questions checked`;
  });
  test('M2 pools by level', () => {
    assert(E.m2Pool(1).join() === 'T1,T2' && E.m2Pool(2).join() === 'T1,T2', 'L1-2');
    assert(E.m2Pool(3).join() === 'T1,T2,T3,T4,T6', 'L3');
    assert(E.m2Pool(4).length === 6 && E.m2Pool(5).includes('T5'), 'L4-5');
  });
  test('M2 example shortcut (T1, seed 3)', () => {
    const q = E.buildM2Question(3, 'B2B', 'T1', false);
    return `${q.prompt} → ${E.fmtAnswer(q.answer, q.unit)} | ${q.steps.join(' / ')}`;
  });

  const passed = results.filter((r) => r.pass).length;
  return { results, passed, failed: results.length - passed, total: results.length };
}
