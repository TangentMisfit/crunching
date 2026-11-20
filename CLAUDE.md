# Crunching — build spec (source of truth)

Offline PWA for a phone (Pixel 9 Pro) that trains executive-finance mental math: rapid P&L / budget-vs-actual (BvA)
reading and in-head what-if math on SaaS metrics. The user is a strategic finance / FP&A professional, not an engineer,
on Windows.

**Rule: any future change to a decision below must update this file in the same change.**
This app is separate from `C:\mental_math_app`. Never touch that folder.
The repo lives at `C:\crunching_skills` (the original brief said `C:\crunching`, which did not exist).

---------------------------------------------------------------------------------------------------
## 1. Architecture

- Installable offline PWA served by GitHub Pages from `/docs` on `main`. Repo name `crunching`, URL path `/crunching/`.
- No frameworks, no npm packages, no build step. Plain HTML/CSS/JS, ES modules.
- All paths relative (works at `http://localhost:8000/` and under `/crunching/`).

| File | Purpose |
|---|---|
| `docs/index.html` | UI shell, inline CSS |
| `docs/app.js` | screens, timers, keypad, storage, levels (DOM code) |
| `docs/engine.js` | pure functions, no DOM: seeded generator, anomalies, `validate()`, question builders, scoring, gates, formatting |
| `docs/version.js` | classic script; sets `self.CRUNCH_VERSION = {APP_VERSION, CACHE_VERSION}`. Loaded by index.html and by sw.js (`importScripts`) so there is one place to bump |
| `docs/sw.js` | service worker, cache-first app shell |
| `docs/manifest.json`, `docs/icons/icon-192.png`, `docs/icons/icon-512.png` | PWA install ("C" monogram, dark bg) |
| `docs/tests.html` + `docs/tests.js` | browser test runner; `tests.js` exports `runTests()` |
| `tests/run.mjs` | same tests in Node (`node tests/run.mjs`) |
| `tools/make_icons.py` | regenerates the PNG icons (pure Python stdlib) |
| `README.md` | run locally, run tests, deploy |

- Service worker: cache-first for the shell; registered with scope `./`. Activate deletes only caches whose name starts
  with `crunch-` and is not the current one (the origin is shared with another app).
- **Bump `CACHE_VERSION` in `docs/version.js` on every change to any file in `docs/`.**
- Storage: `localStorage` only; every key starts with `crunch_`.
- git: `.gitignore` excludes `*.csv`. Do not push (user adds the remote).

## 2. UI / UX

- Dark, high contrast, zero clutter. bg `#0b0d10`, text `#e8eaed`, accent `#4cc2ff`, good `#3ddc84`, bad `#ff5c5c`, warn `#ffb84d`.
- Numbers: `ui-monospace, "Roboto Mono", monospace`, `font-variant-numeric: tabular-nums`, right-aligned.
- Thumb targets ≥ 48px. Bottom tab bar: Train, Progress, Settings (hidden during a session; a Quit button is shown instead).
  Drills and Curriculum are v2 — do not build.
- P&L tables fit portrait (compact, font scales with viewport width) and get roomier in landscape. Orientation not locked.
- Countdown = shrinking bar + seconds remaining.
- Physical keyboard also works on the keypad (digits, `.`, `-`, Backspace, Enter) for desktop testing.

## 3. Financial model (engine.js)

### Determinism
- PRNG: mulberry32. `generateCompany(seed, archetype)` is pure: same inputs → deep-equal dataset. The seed is logged with every question.

### Units and rounding (tie-out)
- Currency = **integer $ thousands ($k)**; percentages = decimals.
- Base components rounded to integer $k first: NewARR, ExpARR, ChurnARR, Revenue, Hosting, Support, S&M, R&D, G&A, Deferred Revenue, starting cash.
- `Revenue = round((BegARR + EndARR) / 8)` (decision: GAAP revenue is a base component, rounded once).
- `DR = round(EndARR × prepaidShare × 0.5)`.
- Every subtotal/derived line is computed from the rounded components; sums tie with tolerance 0.
- Monthly burn, runway and all ratios are unrounded floats computed from the rounded values.

### Archetypes (uniform draws)
| Param | B2B | B2C |
|---|---|---|
| Starting ARR | $10M–$80M | $8M–$60M |
| New ARR / beg ARR per qtr | 5%–12% | 6%–14% |
| Expansion / beg ARR per qtr | 2%–5% | 0.5%–2% |
| Churn / beg ARR per qtr | 1%–3% | 4%–8% |
| Hosting % revenue | 10%–16% | 12%–20% |
| Support % revenue | 5%–9% | 3%–6% |
| R&D % revenue | 25%–40% | 20%–32% |
| G&A % revenue | 12%–20% | 10%–16% |
| Annual-prepaid share of ARR | 50%–80% | 20%–50% |
| CAC payback target (months) | 14–24 | 8–16 |

- Drivers drift per quarter: `driver_q = base × (1 + U(-10%, +10%))` (relative to the base, not compounding).
- 8 quarters, index 0–7. Q7 = current, Q3 = prior-year comparison (PY). Labels like `Q3 FY25`; current quarter is
  Q1–Q4 of FY25 or FY26 (random), earlier quarters count back.
- Opening balances (before Q0): BegARR = starting ARR, DR = round(startARR × prepaid₀ × 0.5), cash = see below.

### Per quarter
- BegARR(q) = EndARR(q-1). EndARR = Beg + New + Exp − Churn.
- Revenue = round((Beg + End)/8). Gross Profit = Revenue − Hosting − Support. GM% = GP / Revenue.
- S&M = round((New + Exp) × GM% × CACPaybackTarget / 12). R&D, G&A = round(% × Revenue).
- Total Opex = S&M + R&D + G&A. Operating Income = GP − Total Opex.
- DR(end) as above; dDR = DR(q) − DR(q-1). Billings = Revenue + dDR. FCF = Operating Income + dDR (no capex / other WC).
- Ending Cash = Beginning Cash + FCF; Beginning Cash(q) = Ending Cash(q-1).
- Monthly Burn = max(0, −FCF)/3. Runway = Ending Cash / Monthly Burn, or `CF+` (null) if not burning.
- NDR (TTM), q ≥ 3 only: (BegARR(q-3) + ΣExp(q-3..q) − ΣChurn(q-3..q)) / BegARR(q-3). **Simplified NDR**: it uses
  company-level expansion/churn flows, not a true cohort.
- CAC Payback (months) = S&M / ((New + Exp) × GM%) × 12.
- ARR YoY = EndARR(q)/EndARR(q-4) − 1 (q ≥ 4). FCF margin = FCF / Revenue. Rule of 40 = (YoY + FCF margin) × 100.
- % rows: hosting, support, S&M, R&D, G&A, opex, op margin = line / revenue.

### Starting cash (decision — spec said "starting runway 15–36 months")
- Cash flows are computed first. Target: the **current-quarter budget** runway = U(15, 36) months, i.e.
  budget Ending Cash = target × reference burn, where reference burn = budget monthly burn, or (if the budget is not
  burning) budget Total Opex × 10% / 3. Floor: that ending cash ≥ one quarter of budget revenue.
- Opening cash is backed out from that. If any ending cash (Q0–Q6, budget, actual) or opening cash would be below
  3 × reference burn, the whole cash series is shifted up so the minimum equals that. Opening cash is rounded to integer $k.
- Result: runway > 0 whenever burning, everywhere.

### Budget vs actual (current quarter only)
- Budget: same opening balances as actual (BegARR = EndARR(Q6), cash = EndCash(Q6), prior DR = DR(Q6)), plan drivers
  = the drifted Q7 drivers, no noise, no anomaly. Ties out under the same rules.
- Actual: each plan driver × (1 ± U(1%, 3%)) (random sign), then 1 or 2 anomalies (50/50). An anomaly **replaces** the
  noise on the driver it modifies.

### Anomalies
| id | Driver change | Highlighted lines | Primary line (Q a answer) |
|---|---|---|---|
| hosting_outgrowth | hosting % = plan × (1 + U(15%,35%)) | hosting, grossProfit, gmPct | hosting |
| paid_search_inflation | new-ARR rate = plan × (1 − U(15%,30%)); S&M = budget S&M × (1 + U(0%,5%)) | sm, endARR | endARR |
| billing_shift | prepaid share = plan − U(10,25) pts, capped so it stays ≥ 5% | monthlyBurn, endCash, runway | monthlyBurn |
| churn_spike | churn rate = plan × (1 + U(50%,100%)) | ndr, endARR | ndr |
| hiring_pull_forward | R&D % = plan × (1 + U(10%,20%)) | rd, totalOpex, opIncome | rd |

- hiring_pull_forward also forces the noise on G&A %, payback, new-ARR and expansion rates to be ≥ plan (decision:
  otherwise ~1.5% of cases had opex or operating income beat plan, contradicting "hits opex and burn").
- Two anomalies never share a highlighted line (so paid_search_inflation + churn_spike never pair).
- When two are injected they are ordered by $k severity (desc); `anomalies[0]` is "the biggest miss":
  hosting var; R&D var; New ARR shortfall; churn overage; dDR shortfall.
- Each anomaly returns `{id, lines, primary, severity, diagnostic}`; `diagnostic` is plain English built from the
  ACTUAL numbers, e.g. "Gross margin came in 280 bps below plan (74.1% vs 76.9%). Hosting ran $412k over budget
  (+24.0%) while revenue was within 0.4% of plan: infrastructure is scaling faster than seats."
- Each anomaly also has a number-free `rootCause` sentence (used as the M1 question c options).

### BvA table rows
Revenue; Hosting; Support; Gross Profit; GM % (var in bps); S&M; R&D; G&A; Total Opex; Operating Income; Op Margin %
(var in bps); — divider —; Ending ARR; NDR (TTM) (var in bps); Monthly Burn; Ending Cash; Runway (mo) (var in months).
- Var = Actual − Budget. **Var% = Var / |Budget|** (decision: absolute denominator so the Var% sign always matches
  Var $ when the budget is negative, e.g. operating loss). Var% blank for ratio/month rows or when Budget = 0.
- bps var = (Actual − Budget) × 10000. PY column = Q3 actual.
- Favorable = sign(var) × direction (revenue-like +1, cost-like −1: hosting, support, S&M, R&D, G&A, opex, burn).
  Coloring is neutral when |Var%| < 0.5% or |bps| < 10 (decision: reduce noise).

### validate(dataset) → list of failures (must be empty)
For every quarter and for budget and actual: ARR rollforward and Beg = prior End; revenue formula; GP, Total Opex,
Operating Income; DR, dDR, billings, FCF, cash rollforward and Beg cash = prior End cash; burn/runway; every % row
recomputed; NDR, CAC payback, YoY, Rule of 40; integer check on all $k components; every BvA variance, Var%, bps;
PY = Q3; anomalies 1–2 with disjoint lines. Integers compared exactly, floats with 1e-9.
The app validates every generated dataset; on failure it regenerates with seed+1 and `console.warn`s (should never happen).

## 4. Formatting
- $: |v| ≥ $1,000k → `$X.XM`; else `$XXXk`. Negatives in parentheses, bad color when unfavorable.
- %: 1 decimal. bps: integer with sign. Months: 1 decimal. Runway when not burning: `CF+`.
- Answers on feedback screens: $M up to 2 decimals (`$7.2M`, `$0.75M`), $k integer, % 1 decimal, bps integer, mo 1 decimal.

## 5. Train screen
- Header: today's practice minutes and streak (consecutive local days with ≥ 1 completed session; shown as 0 if the last
  practice day is before yesterday).
- Cards for Module 1 and Module 2: name, level 1–5, gate status (Calibrating / Advance / Hold / Drill) of the current
  window, last-20 accuracy, median latency, Start. Modules 3 and 4: "coming soon" cards.

## 6. Module 1 — P&L Flash
- Session = 5 flashes. Each: random seed + archetype; show current-quarter BvA table with header (archetype, quarter
  label, Flash countdown). Flash time: L1 10s, L2 8s, L3 6s, L4 5s, L5 4s; then the table is hidden.
- 3 questions, 12s each:
  - a (tag `variance_read`, MC 4): which line drove the biggest miss = `anomalies[0].primary`. Distractors: other
    anomalies' primary lines first, then support / G&A / revenue / S&M; never a line highlighted by an injected anomaly
    or directly downstream of one (hosting/hiring → op margin, burn, cash, runway).
  - b (numeric; tag margin/cash/growth): metric tied to `anomalies[0]`: hosting → GM var bps (margin); hiring → op
    income var $k (margin) or, if burning, annualized burn $M (cash); billing_shift → annualized burn $M or runway mo
    (cash) if burning, else ending ARR; churn / paid search → ending ARR $M (growth).
    **Decision:** the expected value is computed from the values *as displayed* in the table (e.g. burn rounded to
    $0.1M if ≥ $1M), so display rounding never costs points.
  - c (tag `diagnosis`, MC 4): root-cause sentence: correct anomaly's `rootCause` vs 3 from non-injected anomalies.
- Reveal: table again with anomaly rows highlighted, all diagnostics (biggest first), correct vs my answers.

## 7. Module 2 — Sensitivity Math
- Session = 8 questions from a generated company. Anchors rounded: ARR balances to $0.5M; quarterly flows (new ARR,
  S&M, TTM expansion/churn) to $0.1M (decision: $0.5M would zero out small flows); monthly burn to $50k; cash to $1M;
  percentages whole. Answer computed from the rounded anchors.
| T | tag | Question | Unit | Compound (L4+, 50%) |
|---|---|---|---|---|
| T1 | cash | monthly burn + hiring $/yr → new annualized burn | $M | also cut $/yr of spend |
| T2 | cash | cash, burn, burn change → runway | mo | plus one-time cash inflow |
| T3 | margin | revenue, hosting (% whole), hosting +X% → GM change | bps | revenue also grows g% |
| T4 | unit_econ | quarterly S&M, new ARR, GM% → CAC payback | mo | bookings miss by 10% |
| T5 | growth | PY ARR, plan ARR, ARR miss, FCF margin (budget, whole %) → Rule of 40 | % (points) | FCF margin slips N pts |
| T6 | growth | ARR a year ago, TTM expansion, TTM churn → NDR | % | churn runs 20% higher |
- Pools: L1–L2 T1,T2; L3 + T3,T4,T6; L4–L5 + T5 and compound versions. Logged template id is `T4` or `T4c` (compound).
- Timer: L1 15s, L2 12s, L3 10s, L4 8s, L5 6s. Each template has `steps` (2–4 short mental-path steps using the real
  numbers), shown after every answer with correct answer, my answer, % error, latency.

### Keypad (no system keyboard)
- 0–9, `.`, `−` (toggles sign), ⌫, Submit. Unit chips `$M $k % bps mo`; the expected unit is pre-selected.
- Conversion groups: money {$M = 1000 $k}; ratio {% = 100 bps} (decision: % ↔ bps converts); time {mo}.
  Different group = score 0. Timeout submits nothing, scores 0, latency = limit.

## 8. Scoring
- Numeric: rel error ≤ 2% → 1.0, ≤ 5% → 0.5, else 0. bps answers: abs error ≤ 10 bps → 1, ≤ 25 → 0.5. Wrong sign → 0.
- MC: 1/0. Latency = ms from question shown to submit.

## 9. Levels and gates (per module)
- Window = last 20 scored questions in the module at the current level since the last level change
  (`crunch_state.levelSince[module]`, decision: timestamp marker that implements "reset the window").
- < 20 → Calibrating. Accuracy < 60% → Drill (demote, min 1, reset). Accuracy ≥ 85% AND median latency ≤ 70% of the
  question limit (M1: 12s) → Advance (promote, max 5, reset). Else Hold. Drill checked first. Evaluated at session end
  and shown on the summary.

## 10. Logging and progress (localStorage)
- `crunch_questions`: `{ts, sessionId, module, level, template_or_qtype, tag, seed, archetype, expected, expectedUnit, given, givenUnit, score, latencyMs, timedOut}`
  (MC: expected/given are option keys, unit `choice`).
- `crunch_sessions`: `{sessionId, ts, module, level, n, avgScore, medianLatencyMs, gateResult}`
- `crunch_state`: `{levels:{m1,m2}, streak, lastPracticeDate, minutesByDate, levelSince:{m1,m2}}`
- Questions are written when the session completes (decision: quitting mid-session discards it).
- M1 tags: a `variance_read`, b `margin`/`cash`/`growth`, c `diagnosis`.
- Progress: per module last 10 sessions (date, level, accuracy, median latency, gate); per tag (all modules):
  attempts, accuracy, median latency, worst accuracy first.
- Settings: Export CSV (two downloads), Import CSV (merge by ts + sessionId, no duplicates; file type detected from
  header), Reset (two-tap confirm, removes only `crunch_` keys), app version and CACHE_VERSION.

## 11. Tests (tests.js)
Determinism; 500 seeds per archetype pass `validate()`; every anomaly appears and its diagnostic contains the correct
recomputed numbers; anomaly magnitudes in range; ranges (GM 55–90%; NDR 80–140% for B2B, **50–140% for B2C**
(decision: the B2C churn range 4–8%/qtr, plus churn_spike, mathematically drives TTM NDR as low as ~58%); runway > 0
when burning); every M1/M2 builder answer matches an independent recomputation; scoring, unit conversion, gates,
formatting; validate() catches a corrupted dataset.

## 12. Done criteria
tests.html all PASS; local run works (both cards, full M1 + M2 sessions, logs persist, CSV export); SW caches the
shell (works offline after first visit); this file matches the build.
