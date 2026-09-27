
if (!(await import('node:fs')).existsSync(new URL('../../var/site/development-record.md', import.meta.url))) {
  console.log('local-only historical report input absent; report omitted');
  process.exit(0);
}
// Builds out/reports/bakeoff.html: "Boolean-Bake-off: vier Wege im Vergleich".
// Every number is read from the judge's reports, the verifiers' reports and the
// docs at run time; nothing is typed in by hand. Re-run after the judge's
// adversarial runs finish and the report updates itself (Zwischenstand labels
// disappear once results.md has no "not run" cells and the plan's §7 is filled).
//   node scripts/reports/bakeoff.mjs
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  REPO, page, section, p, ul, esc, inline, tiles, grid, card, callout, table, details, source,
  barChart, stackedBar, diagram, fmt, readJson, writeReport, assertPublicSafe,
} from './lib.mjs';

// ── sources ──────────────────────────────────────────────────────────────────
const has = (rel) => existsSync(join(REPO, rel));
// The judge may run more than once (out/bakeoff/judge2 started 23.09. 14:51).
// Use the newest run that has written its aggregate; BAKEOFF_JUDGE overrides.
const JUDGE_DIRS = ['out/bakeoff/judge2', 'out/bakeoff/judge'];
const judgeComplete = (d) => ['results.json', 'results.md', 'recover/check-corpus-from-corefine/check.json'].every((f) => has(`${d}/${f}`));
const J = process.env.BAKEOFF_JUDGE ?? JUDGE_DIRS.find(judgeComplete);
if (!J) throw new Error(`bakeoff report: no complete judge run in ${JUDGE_DIRS.join(', ')}`);
// Judge runs started after the one used here that have not finished yet.
const runningJudges = JUDGE_DIRS.filter((d) => d !== J && has(d) && !judgeComplete(d)
  && statSync(join(REPO, d)).birthtimeMs > statSync(join(REPO, J, 'results.json')).mtimeMs);
const S = {
  results: `${J}/results.json`,
  resultsMd: `${J}/results.md`,
  plan: 'docs/hybrid-boolean-plan.md',
  harness: 'docs/bakeoff.md',
  morning: 'var/site/development-record.md',
  cases: 'fixtures/bakeoff/cases.json',
  corpusNative: (p) => `${J}/${p}/corpus-native/report.json`,
  corpusJs: (p) => `${J}/${p}/corpus-js/report.json`,
  sdfMetal8: `${J}/sdf/corpus-metal-8gb/report.json`,
  recoverCheck: `${J}/recover/check-corpus-from-corefine/check.json`,
  recoverNative: `${J}/recover/corpus-manifold-native/report.json`,
  recoverJs: `${J}/recover/corpus-manifold-js/report.json`,
  verifier: (p) => `out/bakeoff/adversarial-${p}/report.json`,
  recoverR3: 'out/bakeoff/adversarial-recover/r3/report.json',
  recoverR12: 'out/bakeoff/adversarial-recover/report.json',
  recoverReplay: 'out/bakeoff/adversarial-recover/r3/team-adversarial.log',
  proto: (p) => `docs/proto-${p}.md`,
};
const MESH = ['corefine', 'exact-plane', 'sdf'];
const PROTOS = [...MESH, 'recover'];
const TARGETS = [['js', 'JS (Node)'], ['cpu1', 'cpu1 (1 Kern)'], ['cpuN', 'cpu18 (18 Kerne)'], ['metal', 'Metal (GPU)']];

const text = (rel) => readFileSync(join(REPO, rel), 'utf8');
const berlin = (d, opts) => d.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', ...opts });
const mtime = (rel) => berlin(statSync(join(REPO, rel)).mtime, { dateStyle: 'medium', timeStyle: 'short' });
const mtimeHm = (rel) => berlin(statSync(join(REPO, rel)).mtime, { timeStyle: 'short' });
const tally = (rows, f) => rows.reduce((m, r) => ({ ...m, [f(r)]: (m[f(r)] ?? 0) + 1 }), {});
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const listDe = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} und ${xs.at(-1)}` : xs.join(''));

/** 3.59e-14 → "3,6 · 10⁻¹⁴" (German decimal comma, superscript exponent). */
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
function sci(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return '–';
  if (v === 0) return '0';
  let e = Math.floor(Math.log10(Math.abs(v)));
  let m = v / 10 ** e;
  if (Number(m.toFixed(digits)) >= 10) { e += 1; m = v / 10 ** e; }
  return `${fmt.num(m, digits)} · 10${String(e).replace(/./g, (c) => SUP[c])}`;
}
/** English decimal point in quoted plan numbers → German comma. */
const de = (s) => String(s).replace(/(\d)\.(\d)/g, '$1,$2');
const times = (v) => `${fmt.num(v, v >= 10 ? 1 : 2)}×`;
const pct = (share) => fmt.pct(share);

// ── judge aggregate + raw corpus reports ─────────────────────────────────────
const res = readJson(S.results);
const cases = readJson(S.cases).cases;
const N = cases.length;

// Same merge and timing rule as scripts/bakeoff/judge.mjs: native report gives
// cpu1/cpuN/metal, the JS report adds js; js time = computeMs (fallback totalMs).
const loadReport = (rel) => (has(rel) ? readJson(rel) : null);
const corpus = Object.fromEntries(MESH.map((pr) => {
  const nat = loadReport(S.corpusNative(pr)), js = loadReport(S.corpusJs(pr));
  const jsById = new Map((js?.cases ?? []).map((c) => [c.id, c]));
  const byId = new Map(nat.cases.map((c) => [c.id, { ...c, targets: { ...c.targets, js: jsById.get(c.id)?.targets?.js } }]));
  return [pr, { nat, js, byId }];
}));
const msOf = (c, t) => {
  const x = c?.targets?.[t];
  if (!x) return null;
  if (x.outcome !== 'ran') return x.outcome;
  return t === 'js' ? (x.timing.computeMs ?? x.timing.totalMs) : x.timing.computeMs;
};
const numMs = (c, t) => (typeof msOf(c, t) === 'number' ? msOf(c, t) : null);

// Common set (cases every mesh prototype passes): sums per target, as in results.md.
const common = res.commonSet;
const commonSums = Object.fromEntries(MESH.map((pr) => {
  const s = {}, missing = {};
  for (const [t] of TARGETS) {
    const vals = common.map((id) => numMs(corpus[pr].byId.get(id), t));
    s[t] = sum(vals.filter((v) => v != null));
    missing[t] = vals.filter((v) => v == null).length;
  }
  return [pr, { s, missing }];
}));

// Machine and load, from the report headers actually used for the timings.
const timingReports = [...MESH.flatMap((pr) => [S.corpusNative(pr), S.corpusJs(pr)]), S.recoverNative, S.recoverJs].filter(has).map(readJson);
const loads = timingReports.flatMap((r) => [r.loadavgStart?.[0], r.loadavgEnd?.[0]]).filter((x) => typeof x === 'number');
const env = corpus.corefine.nat.environment;
const capturedRange = (() => {
  const ts = timingReports.map((r) => new Date(r.capturedAt)).sort((a, b) => a - b);
  return `${berlin(ts[0], { timeStyle: 'short' })}–${berlin(ts.at(-1), { timeStyle: 'short' })}`;
})();

// ── recover on corefine's meshes (the hybrid) ────────────────────────────────
const rcCheck = readJson(S.recoverCheck);
const rcRows = new Map(rcCheck.rows.map((r) => [r.id, r]));
const rcAgg = res.recover['check-corpus-from-corefine'];
const rcUnresolved = rcCheck.rows.filter((r) => r.verdict === 'unresolved');
const rcNoSource = rcCheck.rows.filter((r) => r.verdict === 'no-source');
const rcEmpty = rcAgg.exact - rcAgg.exactNonEmpty;
const ht = res.hybridTotals; // corefine c1/c18 + recover r1/r18 over the exact cases

// ── verifiers (each prototype's own adversarial suite) ───────────────────────
// Same classes as the judge's scorer (judgeCls below): an expected refusal is
// the right answer, `unresolved` is a safe refusal that names its reason.
function verdictClass(r) {
  const v = String(r.verdict);
  if (/^(pass|exact|exact-empty|expected-refusal)$/.test(v)) return 'richtig';
  if (v === 'unresolved') return 'verweigert';
  if (/^(timeout|error)$/.test(v) || /export failed/.test(v)) return 'sonstig';
  // "info" = an ok answer for a contact case; wrong when the validator rejects the mesh
  if (v === 'info') return r.report?.valid === false || (r.report?.issues ?? []).length ? 'falsch' : 'richtig';
  return 'falsch'; // WRONG-*, INVALID-OK, INVALID-INPUT-ACCEPTED-OK, invalid, mismatch
}
const verifier = {};
for (const pr of MESH) {
  const r = readJson(S.verifier(pr));
  const rows = r.cases ?? r.rows;
  verifier[pr] = { src: S.verifier(pr), rows, when: mtimeHm(S.verifier(pr)) };
}
verifier.recover = { src: S.recoverR3, rows: readJson(S.recoverR3), when: mtimeHm(S.recoverR3), round: 3 };
const recoverR12 = readJson(S.recoverR12);
const r12Bad = recoverR12.filter((r) => ['falsch', 'sonstig'].includes(verdictClass(r))).length;
for (const v of Object.values(verifier)) {
  v.cls = tally(v.rows, verdictClass);
  v.wrong = v.rows.filter((r) => verdictClass(r) === 'falsch');
}
// The verifier's round-3 replay of the team's own adversarial cases (after the
// round-1 fixes): last line of the log is "verdicts: {…}".
const replay = (() => {
  if (!has(S.recoverReplay)) return null;
  const m = text(S.recoverReplay).match(/^verdicts: (\{.*\})\s*$/m);
  if (!m) return null;
  const v = JSON.parse(m[1]);
  const n = (re) => sum(Object.entries(v).filter(([k]) => re.test(k)).map(([, c]) => c));
  return { wrong: n(/^WRONG/), invalid: n(/^INVALID/) };
})();
const ids = (rows) => rows.map((r) => `\`${r.id}\``).join(', ');
const pointContact = verifier.corefine.wrong.filter((r) => r.expect === 'non-manifold-contact');

// ── judge cross-run over the adversarial suites (may still be running) ───────
const mdRes = text(S.resultsMd);
// A cell is "verdict n, verdict n, …" or "not run". The judge may aggregate a
// report that run.mjs is still writing, so a cell only counts as complete when
// its verdicts add up to the suite's case count.
const cellCounts = (c) => (c === 'not run' ? null : Object.fromEntries(c.split(', ').map((x) => { const m = x.match(/^(.+) (\d+)$/); return [m[1], Number(m[2])]; })));
const suiteRows = [...mdRes.matchAll(/^\| (adv-[\w-]+) \((\d+|\?)\) \| (.+?) \| (.+?) \| (.+?) \|$/gm)]
  .map(([, suite, n, ...cells]) => ({ suite, n: Number(n), cells: cells.map((c) => ({ raw: c, counts: cellCounts(c) })) }));
for (const r of suiteRows) for (const c of r.cells) c.scored = c.counts ? sum(Object.values(c.counts)) : 0;
const suiteRuns = suiteRows.length * MESH.length;
const suiteDone = sum(suiteRows.map((r) => r.cells.filter((c) => c.scored === r.n).length));
const suitePartial = sum(suiteRows.map((r) => r.cells.filter((c) => c.scored && c.scored < r.n).length));
const judgeRunning = suiteDone < suiteRuns;
const VERDICT_WORD = { pass: 'bestanden', invalid: 'ungültig', mismatch: 'falsch', 'expected-refusal': 'erw. Verweigerung', unresolved: 'verweigert', error: 'Fehler', timeout: 'Zeitlimit', info: 'info' };
const cellText = (c, n) => {
  if (!c.counts) return 'noch nicht im Aggregat';
  const words = Object.entries(c.counts).map(([k, v]) => `${VERDICT_WORD[k] ?? k} ${v}`).join(', ');
  return c.scored < n ? `${words} (erst ${c.scored} von ${n} bewertet)` : words;
};

// ── the judge's written decision (docs/hybrid-boolean-plan.md) ───────────────
const plan = has(S.plan) ? text(S.plan) : null;
const planSection7Pending = plan?.includes('{{ADVERSARIAL}}') ?? false;
const planSteps = plan
  ? [...(plan.split(/^## 8\./m)[1]?.split(/^## 9\./m)[0] ?? '').matchAll(/^(\d+)\. \*\*([\s\S]+?)\*\*/gm)].map(([, n, t]) => [n, t.replace(/\s+/g, ' ').replace(/\.$/, '')])
  : [];
const planClaims = plan
  ? [...(plan.split(/^## 9\./m)[1] ?? '').matchAll(/^\| (?!claim|---)(.+?) \| (.+?) \|$/gm)].map(([, c, s]) => [c.replace(/\*\*/g, ''), s.replace(/\*\*/g, '')])
  : [];

// Is the bake-off committed, and has the working tree moved on since? (read-only git queries)
// The decision commit is the last one that touched the plan; later edits to the
// plan, the prototypes or the harness are plan steps in progress, not the decision.
let committed = null, decisionCommit = null, dirtyPaths = 0, planDirty = false;
try {
  const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
  const [hash, at] = git('log', '-1', '--format=%h|%aI', '--', S.plan).split('|');
  decisionCommit = hash ? { hash, at: new Date(at) } : null;
  dirtyPaths = git('status', '--porcelain', '--', S.plan, S.harness, 'kernel/proto', 'scripts/bakeoff', 'fixtures/bakeoff').split('\n').filter(Boolean).length;
  planDirty = git('status', '--porcelain', '--', S.plan) !== '';
  committed = Boolean(decisionCommit);
} catch { /* not a git checkout: leave unknown */ }

// ── the plan's steps: which defect each closes, and which are done ─────────
// Acceptance cases the plan names for step 1 (point contact) and step 2 (grazing tools).
const planStep = (n) => (plan?.split(/^## 8\./m)[1] ?? '').split(new RegExp(`^${n}\\. `, 'm'))[1]?.split(new RegExp(`^${n + 1}\\. `, 'm'))[0] ?? '';
const planIds = (block) => [...new Set([...block.matchAll(/`(adv[\w.-]+)`/g)].map((m) => m[1]))];
// Which step closes which defect: the plan's §7 table ("closed by step N"), per row
// with the case ids it names (the table shortens `adv-ep2-sweep-pocket-3` to `sweep-pocket-3`).
const sec7Rows = [...(plan?.split(/^## 7\./m)[1]?.split(/^## 8\./m)[0] ?? '').matchAll(/^\| (corefine|recover|pipeline|exact-plane|sdf) \|(.+)\| step(?:s)? (\d+)[^|]*\|$/gm)]
  .map(([, engine, body, step]) => ({ engine, step: Number(step), ids: [...body.matchAll(/`((?:adv[\w.-]*-)?[\w.-]+-\d[\w.-]*|adv[\w.-]+)`/g)].map((m) => m[1]) }));
const stepByPlan = (id) => sec7Rows.find((r) => ['corefine', 'pipeline'].includes(r.engine) && r.ids.some((x) => id === x || id.endsWith(`-${x}`)))?.step ?? null;
const step1Ids = sec7Rows.filter((r) => r.step === 1).flatMap((r) => r.ids);
const step2Ids = sec7Rows.filter((r) => r.step === 2).flatMap((r) => r.ids);
// Step 3 arbitrates oracle disputes: a case the arbiter calls `ambiguous` is neither right nor wrong.
const ARBITER = 'fixtures/bakeoff/arbiter.json';
const ambiguousIds = has(ARBITER) ? readJson(ARBITER).entries.filter((e) => e.decision === 'ambiguous').map((e) => e.id) : [];
if (!sec7Rows.length) throw new Error(`bakeoff report: ${S.plan} §7 no longer has "closed by step" rows; update the report`);

// Status of the plan steps since the decision: "*Status <date>[ (evening)]: done …*" lines in §8.
// The numbers are quoted from those lines (the plan marks them measured); a step without
// such a line is still open. need() stops the build when a quoted sentence changes.
const flatStep = (n) => planStep(n).replace(/\s+/g, ' ');
const needStep = (n, re) => {
  const m = flatStep(n).match(re);
  if (!m) throw new Error(`bakeoff report: plan step ${n} in ${S.plan} no longer matches ${re}; update the report`);
  return m;
};
const stepDone = (n) => /\*Status \d+ \w+ \d{4}(?: \([a-z]+\))?: done\b/.test(flatStep(n));
const STEPS_DONE = [1, 2, 3, 4].filter(stepDone);
const st1 = STEPS_DONE.includes(1) ? {
  points: needStep(1, /the (\d+) point contacts are expected-refusal/)[1],
  rot: needStep(1, /the (\d+) rotated coplanar cases named refusals/)[1],
  invalid: needStep(1, /invalid (\d+) -> (\d+)\./),
  wrong: needStep(1, /corefine WRONG: (\d+) -> (\d+) under the judge round scorer \(the (\d+) grazing, the (\d+) disputes\)/),
  arbiter: needStep(1, /(\d+) \(all grazing\) plus (\d+) `ambiguous` under the step-3 arbiter/),
  corpus: needStep(1, /Corpus: (\d+)\/(\d+) result files byte-identical to the judge round/),
  cost: needStep(1, /\+([\d.]+) % and \+([\d.]+) %/),
} : null;
const st2 = STEPS_DONE.includes(2) ? {
  wrong: needStep(2, /the adv-recover wrong outputs drop from (\d+) to (\d+) on corefine meshes/),
  exactNow: needStep(2, /the (\d+) planar chips and bumps become exact and the other (\d+) are named refusals/),
  contact: needStep(2, /`contact-accepted` is 0 on every source/),
  corpus: needStep(2, /The corpus gives (\d+) exact on corefine meshes, r10b included/)[1],
  cost: needStep(2, /about (\d+) % at 1 thread and (\d+) % at 18 threads/),
} : null;
const st3 = STEPS_DONE.includes(3) ? {
  disputes: needStep(3, /(\d+) disputes \(corpus 0\)/)[1],
  unarb: needStep(3, /unarbitrated: (\d+)/)[1],
  uncommitted: /harness only, uncommitted/.test(flatStep(3)),
} : null;

// Run folders created or changed after the judge's snapshot (results.json):
// the bake-off keeps verifying, and those results are not in this report yet.
// The judge's recover runs on corefine's adversarial meshes are read below
// (hybrid end to end), so they do not count as missing.
const judgeT = statSync(join(REPO, S.results)).mtimeMs;
const newerIn = (dir) => (has(dir)
  ? readdirSync(join(REPO, dir), { withFileTypes: true })
    .filter((d) => d.isDirectory() && statSync(join(REPO, dir, d.name)).mtimeMs > judgeT)
    .map((d) => `${dir}/${d.name}`)
  : []);
// Verifier folders: name the new sub-runs (e.g. `adversarial-recover/r4`), not just the folder.
const newerDeep = (dir) => {
  const sub = newerIn(dir);
  return sub.length ? sub : [dir];
};
const hybridRunRe = new RegExp(`^${J}/recover/adv-[\\w-]+-corefine$`);
const newerRuns = [
  ...PROTOS.flatMap((pr) => newerIn(`${J}/${pr}`)).filter((x) => !hybridRunRe.test(x)),
  ...newerIn('out/bakeoff').filter((x) => x !== J && !runningJudges.includes(x)).flatMap(newerDeep),
];
const judgeStarted = (d) => berlin(statSync(join(REPO, d)).birthtime, { timeStyle: 'short' });
const newerJudge = newerRuns.filter((x) => x.startsWith(`${J}/`));
const newerOther = newerRuns.filter((x) => !x.startsWith(`${J}/`));
// "adversarial-sdf (3 Unterordner)" instead of three paths; a single sub-run keeps its path.
const newerOtherGrouped = Object.entries(Object.groupBy(newerOther, (x) => x.split('/')[2]))
  .map(([dir, xs]) => (xs.length === 1 ? `\`${xs[0].replace('out/bakeoff/', '')}\`` : `\`${dir}\` (${xs.length} Unterordner)`))
  .join(', ');
const generatedAt = berlin(new Date(), { timeStyle: 'short' });

// ── per-case verdict classes for the matrix and the corpus chart ─────────────
const CLS = {
  exakt: { label: 'exakt', css: 'v-exakt', sw: 'f-s1' },
  naeh: { label: 'bestanden als Näherung', css: 'v-naeh', sw: 'f-s2' },
  offen: { label: 'verweigert, Grund benannt', css: 'v-offen', sw: 'f-s3' },
  verw: { label: 'erwartete Verweigerung (Berührung)', css: 'v-verw', sw: 'f-n' },
  falsch: { label: 'falsch', css: 'v-falsch', sw: 'f-fail' },
};
function caseClass(pr, id) {
  if (pr === 'recover') {
    const r = rcRows.get(id);
    if (!r) return { k: 'offen', why: 'kein Ergebnis' };
    if (r.verdict === 'exact') return { k: 'exakt', why: r.empty ? 'leeres Ergebnis, korrekt' : r.strictValidateStep ? 'exakter STEP, streng validiert' : 'exakter STEP über Verfeinerungsregel' };
    if (r.verdict === 'unresolved') return { k: 'offen', why: String(r.reason ?? '').replace(/^unresolved /, '') };
    if (r.verdict === 'no-source' || r.verdict === 'expected-refusal') return { k: 'verw', why: 'corefine verweigert (Berührung entlang einer Linie)' };
    return { k: 'falsch', why: r.verdict };
  }
  const c = corpus[pr].byId.get(id);
  const vol = c?.comparison?.volumeRelErrVsManifold;
  if (c?.verdict === 'pass') return c.tier === 'exact' ? { k: 'exakt', why: `Volumenfehler ${sci(vol)}` } : { k: 'naeh', why: `Näherung, Volumenfehler ${sci(vol)} (Tier ${c.tier})` };
  if (c?.verdict === 'expected-refusal') return { k: 'verw', why: 'Berührung entlang einer Linie, korrekt verweigert' };
  if (c?.verdict === 'unresolved') return { k: 'offen', why: c.report?.reason ?? c.reason ?? 'verweigert' };
  return { k: 'falsch', why: c?.verdict ?? 'fehlt' };
}
const matrix = Object.fromEntries(PROTOS.map((pr) => [pr, cases.map((c) => ({ id: c.id, cat: c.category, ...caseClass(pr, c.id) }))]));
const counts = Object.fromEntries(PROTOS.map((pr) => [pr, tally(matrix[pr], (x) => x.k)]));
const countSummary = (pr) => {
  const k = counts[pr];
  return [k.exakt ? `${k.exakt} exakt` : '', k.naeh ? `${k.naeh} Näherung` : '', k.offen ? `${k.offen} verweigert` : '', k.verw ? `${k.verw} Berührung` : '', k.falsch ? `${k.falsch} falsch` : ''].filter(Boolean).join(' · ');
};

// Sanity: the matrix must agree with the judge's aggregate, or we stop.
for (const pr of MESH) {
  const agg = res.corpus[pr];
  if ((counts[pr].exakt ?? 0) !== agg.exactTier) throw new Error(`bakeoff report: ${pr} exact tier ${counts[pr].exakt} != results.json ${agg.exactTier}`);
}
if ((counts.recover.exakt ?? 0) !== rcAgg.exact) throw new Error('bakeoff report: recover exact count disagrees with results.json');

// ── derived headline numbers ─────────────────────────────────────────────────
const cf = res.corpus.corefine, ep = res.corpus['exact-plane'], sd = res.corpus.sdf;
const refusedCf = cf.counts['expected-refusal'] ?? 0;
const fastestEverywhere = TARGETS.every(([t]) => MESH.every((pr) => commonSums.corefine.s[t] <= commonSums[pr].s[t]));
const metalRatios = { ...Object.fromEntries(MESH.map((pr) => [pr, res.corpus[pr].metalOverCpu18Geo])), recover: res.recover.metalOverCpu18Geo };
const scaleRatios = { ...Object.fromEntries(MESH.map((pr) => [pr, res.corpus[pr].cpu1OverCpu18Geo])), recover: res.recover.speedupGeo };
const metalMin = Math.min(...Object.values(metalRatios)), metalMax = Math.max(...Object.values(metalRatios));
const recoverShare18 = ht.r18 / (ht.c18 + ht.r18);
const r3 = verifier.recover;
const unresolvedNames = rcUnresolved.map((r) => r.id);

// ── extra CSS: the case matrix (the one custom figure of this report) ────────
const runs = [];
for (const c of cases) {
  if (runs.at(-1)?.cat === c.category) runs.at(-1).n += 1;
  else runs.push({ cat: c.category, n: 1 });
}
const CAT_DE = {
  identity: 'Identität', 'box-basics': 'Box', coplanar: 'koplanar', touching: 'berührend', holes: 'Bohrungen',
  cylinders: 'Zylinder', spheres: 'Kugeln', mechanical: 'Mechanik', tangent: 'tangential', topology: 'Topologie',
  'many-operands': 'Kette', scale: 'Skala', tori: 'Torus', 'frozen-r10b': 'r10b',
};
const tmpl = (gap) => runs.map((r) => `repeat(${r.n},minmax(0,1fr))`).join(` ${gap}px `);
const spans = [...new Set(runs.map((r) => r.n))];
const EXTRA_CSS = `
/* bakeoff.mjs: case matrix */
.mx{margin:2px 0 4px}
.mx-row{display:grid;grid-template-columns:8.5rem minmax(0,1fr);align-items:center;gap:4px 12px;padding:5px 0}
.mx-row+.mx-row{border-top:1px solid var(--rule)}
.mx-label{font-size:13px;line-height:1.25;min-width:0}
.mx-label b{display:block;font-weight:620}
.mx-label span{font-size:12px;color:var(--muted)}
.mx-cells{display:grid;grid-template-columns:${tmpl(3)};gap:2px}
.mx-c{display:block;height:22px;border-radius:2px}
.mx-c:hover{outline:2px solid var(--ink);outline-offset:1px}
.v-exakt{background:var(--s1)} .v-naeh{background:var(--s2)} .v-offen{background:var(--s3)} .v-verw{background:var(--n)}
.v-falsch{background:var(--fail)}
.sw.f-fail{background:var(--fail)}
.f-fail{fill:var(--fail)} .on-fail{fill:#fff}
@media (prefers-color-scheme:dark){.on-fail{fill:#0d1012}}
.mx-axis .mx-cells{align-items:start}
.mx-ax{font:600 10px/1.2 var(--font-display);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);border-top:1.5px solid var(--rule-strong);padding-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
${spans.map((n) => `.mx-ax.sp${n}{grid-column:span ${n}}`).join(' ')}
.mx-row.mx-axis{border-top:0;padding-top:2px}
/* case ids break at their hyphens, not mid-word; wide tables scroll instead */
.tbl td code,.srcs code{overflow-wrap:normal}
.srcs td:first-child{width:50%}
.lede-k{font:600 11px/1 var(--font-display);letter-spacing:.09em;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:6px}
.steps{padding-left:1.4em}
.steps li{margin:.35em 0}
.mx-label small{font-size:12px;font-weight:400;color:var(--muted)}
.only-narrow{display:none}
@media (max-width:640px){
  .only-wide{display:none}
  .only-narrow{display:block}
  .tiles>.tile:last-child:nth-child(odd){grid-column:1 / -1}
  .mx-row{grid-template-columns:minmax(0,1fr);padding:6px 0}
  .mx-label b,.mx-label span{display:inline}
  .mx-label span::before{content:" · "}
  .mx-cells{grid-template-columns:${tmpl(2)};gap:1px}
  .mx-c{height:18px;border-radius:1px}
  .mx-ax{font-size:0;padding-top:0;height:4px}
}
`;

function caseMatrix() {
  const cell = (x, pr) => `<span class="mx-c ${CLS[x.k].css}" title="${esc(`${x.id} · ${pr}: ${CLS[x.k].label}${x.why ? ` · ${x.why}` : ''}`)}"></span>`;
  const withGaps = (items) => {
    const out = [];
    let i = 0;
    runs.forEach((r, j) => {
      if (j) out.push('<i aria-hidden="true"></i>');
      out.push(...items.slice(i, i + r.n));
      i += r.n;
    });
    return out.join('');
  };
  const PRLABEL = { corefine: 'corefine', 'exact-plane': 'exact-plane', sdf: 'sdf', recover: 'recover' };
  const rows = PROTOS.map((pr) => {
    const summary = countSummary(pr);
    return `<div class="mx-row"><div class="mx-label"><b>${esc(PRLABEL[pr])}${pr === 'recover' ? ' <small>(auf corefine)</small>' : ''}</b><span>${esc(summary)}</span></div><div class="mx-cells" role="img" aria-label="${esc(`${pr}: ${summary}`)}">${withGaps(matrix[pr].map((x) => cell(x, pr)))}</div></div>`;
  });
  const axis = `<div class="mx-row mx-axis" aria-hidden="true"><div></div><div class="mx-cells">${runs.map((r, j) => `${j ? '<i></i>' : ''}<span class="mx-ax sp${r.n}" title="${esc(`${CAT_DE[r.cat] ?? r.cat}: ${r.n} ${r.n === 1 ? 'Fall' : 'Fälle'}`)}">${r.n >= 3 ? esc(CAT_DE[r.cat] ?? r.cat) : ''}</span>`).join('')}</div></div>`;
  const used = Object.keys(CLS).filter((k) => PROTOS.some((pr) => counts[pr][k]));
  const legend = `<ul class="legend">${used.map((k) => `<li><i class="sw ${CLS[k].sw}" aria-hidden="true"></i>${esc(CLS[k].label)}</li>`).join('')}</ul>`;
  const DE = (x) => CLS[x.k].label;
  const tbl = table({
    columns: ['Fall', 'Kategorie', ...PROTOS],
    rows: cases.map((c, i) => [`\`${c.id}\``, CAT_DE[c.category] ?? c.category, ...PROTOS.map((pr) => DE(matrix[pr][i]))]),
  });
  return `<figure class="chart"><figcaption><strong>Jeder Fall einzeln: ${N} Fälle × ${PROTOS.length} Prototypen</strong><span>Ein Kästchen pro Korpusfall, gleiche Reihenfolge in jeder Zeile, gruppiert nach Kategorie. Mauszeiger auf ein Kästchen zeigt Fall und Grund.</span></figcaption>${legend}<div class="mx">${rows.join('')}${axis}</div>${details('Werte als Tabelle', tbl)}${source(PROTOS.filter((x) => x !== 'recover').map(S.corpusNative), S.recoverCheck, S.cases)}</figure>`;
}

// ── sections ─────────────────────────────────────────────────────────────────
const fmtS = (v) => (v == null ? '–' : v >= 1000 ? `${fmt.auto(v / 1000)} s` : `${fmt.num(v, 0)} ms`);
// One glob per chart instead of three long paths (the Quelle table lists the pattern too).
const corpusGlob = (kind) => `${J}/{corefine,exact-plane,sdf}/corpus-${kind}/report.json`;

// 1 · Entscheidung
const planRound = plan?.match(/^Status: \d+ \w+ \d{4}, judge round (\d+)\./m)?.[1] ?? null;
if (plan && !/Nothing here is implemented in production yet/.test(plan.replace(/\s+/g, ' '))) throw new Error(`bakeoff report: ${S.plan} no longer says nothing is in production; update the report`);
const decisionBody = plan
  ? [
    callout('entscheidung', 'corefine entscheidet die Topologie, recover baut daraus das exakte B-Rep',
      p(`So steht es im Gutachten des Judge${planRound ? ` (Runde ${planRound})` : ''}, und die Entscheidung ist endgültig${decisionCommit ? `: committet als \`${decisionCommit.hash}\` am ${berlin(decisionCommit.at, { dateStyle: 'medium', timeStyle: 'short' })} Uhr` : ''}. Wo recover eine Kurve nicht kennt, bleibt das Ergebnis ein ausgewiesenes Näherungs-Mesh (**CertifiedMesh**, nur STL/3MF, STEP verweigert mit Grund). exact-plane wird zweites Orakel für Differenztests in CI, sdf liefert keine Boolean-Ergebnisse mehr, sondern FDM-Analysen. Produktion läuft auf der CPU, Metal bleibt aus. In Produktion ist davon noch nichts; die Umsetzung läuft Schritt für Schritt nach dem Plan (nächster Abschnitt).`),
      { src: S.plan }),
    planSection7Pending
      ? callout('offen', 'Gutachten noch nicht ganz fertig', p(`In \`${S.plan}\` ist Abschnitt 7 (Verifier-Befunde, die die Produktion sperren) noch ein Platzhalter. Die Entscheidung und der Integrationsplan stehen bereits. Die Befunde in diesem Bericht kommen direkt aus den Verifier-Reports.`), { src: S.plan })
      : '',
  ].join('')
  : callout('offen', 'Gutachten läuft noch', p(`\`${S.plan}\` gibt es noch nicht. Die Empfehlung folgt, sobald der Judge sie geschrieben hat; dieser Bericht zeigt bis dahin nur Messwerte.`));

// Two layouts of the same pipeline: three columns for wide screens, two for
// phones (the kit's diagrams scroll sideways below 520 px, which would hide the
// refusal branch). CSS shows exactly one of them.
const pipeNodes = {
  tess: { label: 'Tessellierung', sub: 'mit Flächen-Tags' },
  pre: { label: 'Nähe-Vorzertifikat', sub: STEPS_DONE.includes(2) ? 'Schritt 2, im Prototyp' : 'geplant (Schritt 2)', kind: 'planned' },
  ep: { label: 'exact-plane', sub: 'Diff-Orakel in CI', kind: 'muted' },
  cf: { label: 'corefine', sub: 'entscheidet Topologie', kind: 'accent' },
  rc: { label: 'recover', sub: 'exakte Geometrie', kind: 'accent' },
  ex: { label: 'Exakt · STEP', sub: `${rcAgg.exact} von ${N} Fällen` },
  cm: { label: 'CertifiedMesh', sub: `${rcUnresolved.length} von ${N} · nur STL` },
  rf: { label: 'Verweigerung', sub: `${rcNoSource.length} von ${N} · Berührung` },
};
const place = (layout) => Object.entries(layout).map(([id, [col, row]]) => ({ id, col, row, ...pipeNodes[id] }));
const pipeSrc = [S.plan, S.recoverCheck];
const pipeWide = diagram({
  title: 'So soll der Hybrid-Boolean laufen',
  sub: `Stufen aus dem Gutachten; gestrichelt = noch nicht in Produktion. Zahlen: Korpus, recover auf corefines Meshes (Judge-Runde).`,
  nodes: place({ tess: [1, 0], pre: [1, 1], ep: [0, 2], cf: [1, 2], rc: [1, 3], ex: [1, 4], cm: [0, 4], rf: [2, 4] }),
  edges: [
    { from: 'tess', to: 'pre', planned: true },
    { from: 'pre', to: 'cf', planned: true },
    { from: 'ep', to: 'cf', label: 'Diff', planned: true },
    { from: 'cf', to: 'rc', label: 'getaggtes Mesh' },
    { from: 'rc', to: 'ex' },
    { from: 'rc', to: 'cm', label: 'Kurve fehlt' },
    { from: 'cf', to: 'rf', label: 'Berührung' },
  ],
  src: pipeSrc,
});
const pipeNarrow = diagram({
  title: 'So soll der Hybrid-Boolean laufen',
  sub: 'Stufen aus dem Gutachten; gestrichelt = noch nicht in Produktion. exact-plane läuft daneben als Diff-Orakel in CI.',
  colW: 172, boxW: 150, rowH: 86,
  nodes: place({ tess: [0, 0], pre: [0, 1], cf: [0, 2], rf: [1, 2], rc: [0, 3], ex: [0, 4], cm: [1, 4] }),
  edges: [
    { from: 'tess', to: 'pre', planned: true },
    { from: 'pre', to: 'cf', planned: true },
    { from: 'cf', to: 'rf' },
    { from: 'cf', to: 'rc', label: 'getaggtes Mesh' },
    { from: 'rc', to: 'cm', label: 'Kurve fehlt' },
    { from: 'rc', to: 'ex' },
  ],
  src: pipeSrc,
});
const pipeline = `<div class="only-wide">${pipeWide}</div><div class="only-narrow">${pipeNarrow}</div>`;

const roleCards = () => grid({ wide: true },
  card({
    eyebrow: 'Produktion · Topologie', kind: 'entscheidung', title: 'corefine',
    body: p('Getaggter Mesh-Boolean in Bend: ein Port von Manifolds Boolean3 über F32x2-Reals. Jedes Ausgabedreieck behält den Tag seiner analytischen Fläche.')
      + ul([
        `Korpus: **${cf.exactTier} exakt**, ${refusedCf} korrekt verweigert; Volumenfehler höchstens ${sci(cf.maxVolRelErrVsManifold)}`,
        fastestEverywhere ? 'Schnellster Prototyp auf allen vier Zielen' : 'Nicht auf allen Zielen der schnellste',
        `Skaliert schwach: cpu1/cpu18 = ${times(cf.cpu1OverCpu18Geo)}`,
        `Gegenprobe: **${cfWrong.length} falsche „ok“** in ${adv.corefine.cases} Angriffsfällen, vor allem ${CF_CLS[cfGroups[0]?.k ?? "punkt"].short}`,
      ]),
    src: [S.results, S.verifier('corefine')],
  }),
  card({
    eyebrow: 'Produktion · exakte Geometrie', kind: 'entscheidung', title: 'recover',
    body: p('Baut aus dem getaggten Mesh ein exaktes B-Rep: jede Kurve und jeder Punkt kommt aus den Trägerflächen, nie aus dem Polygonzug. Sonst verweigert es mit Grund.')
      + ul([
        `Auf corefines Meshes: **${rcAgg.exact} von ${N}** als exakter STEP`,
        `${rcUnresolved.length} benannte Lücken: ${unresolvedNames.map((x) => `\`${x}\``).join(', ')}`,
        `Anteil an der Hybrid-Zeit bei 18 Kernen: ${pct(recoverShare18)}`,
        `Verifier Runde ${r3.round} (auf manifold3d-Meshes): **${r3.wrong.length} falsche Ausgaben** von ${r3.rows.length}`,
      ]),
    src: [S.recoverCheck, S.results, S.recoverR3],
  }),
  card({
    eyebrow: 'Zweit-Orakel für CI', title: 'exact-plane',
    body: p('Exakte Ganzzahl-Arithmetik nach einer einmaligen Quantisierung der Eingabe auf ein 2⁻²⁴-mm-Raster. Eigene Codebasis, eigene Prädikate.')
      + ul([
        `Korpus: **${ep.exactTier} exakt**, Volumenfehler höchstens ${sci(ep.maxVolRelErrVsManifold)}`,
        `cpu18 ${times(commonSums['exact-plane'].s.cpuN / commonSums.corefine.s.cpuN)} langsamer als corefine`,
        `Verifier: **${verifier['exact-plane'].wrong.length} falsche „ok“**, u. a. Spalten unter dem Raster verschmelzen`,
      ]),
    src: [S.results, S.verifier('exact-plane'), S.proto('exact-plane')],
  }),
  card({
    eyebrow: 'FDM-Analysen, kein Boolean', title: 'sdf',
    body: p('Implizite CSG mit Octree und Dual Contouring. Das Ergebnis ist immer eine Näherung mit gemessener Abweichung.')
      + ul([
        `Korpus: ${sd.counts.pass} bestanden, davon **${sd.exactTier} im Exakt-Tier**; \`r10b-g10-union\` verweigert`,
        `Verifier: **${verifier.sdf.wrong.length} falsche „ok“**, davon ${sdfGeo.length} bei Wänden, Spalten und Rippen unter der Zellgröße`,
        `Metal ${times(sd.metalOverCpu18Geo)} langsamer als cpu18; ${sd.metalFailures.length} Fälle ohne Speicher bei 1 GB`,
      ]),
    src: [S.results, S.verifier('sdf'), S.proto('sdf')],
  }),
);

// 2 · Korpus
const corpusChart = stackedBar({
  title: `Korpus: ${N} Fälle je Prototyp`,
  sub: 'Mesh-Prototypen: exakt = Volumen innerhalb 1e-7 relativ zu manifold3d. recover: exakt = OCCT-gültiger exakter STEP mit Volumen und Fläche innerhalb 1e-7.',
  keys: [
    { key: 'exakt', label: 'exakt' },
    { key: 'naeh', label: 'bestanden als Näherung' },
    { key: 'offen', label: CLS.offen.label },
    { key: 'verw', label: 'erwartete Verweigerung (Berührung)', neutral: true },
  ],
  rows: PROTOS.map((pr) => ({ label: `${pr} · ${countSummary(pr)}`, values: counts[pr] })),
  src: [S.results, S.recoverCheck],
}).replace(new RegExp(`<text x="100%"[^>]*>n = ${N}</text>`, 'g'), ''); // every row is the same N (title says so); frees room for the counts on phones

const accuracyTable = table({
  caption: 'Genauigkeit und Determinismus im Korpus',
  columns: ['Prototyp', { label: 'bestanden', align: 'right' }, { label: 'exakt-Tier', align: 'right' }, { label: 'max. Volumenfehler vs. manifold3d', align: 'right' }, { label: 'Fehler / Schranke (OCCT-Fläche × Abw.)', align: 'right' }, { label: '4 Ziele bytegleich', align: 'right' }],
  rows: MESH.map((pr) => {
    const a = res.corpus[pr];
    return [pr, `${a.counts.pass} + ${a.counts['expected-refusal'] ?? 0} verw.`, `${a.exactTier}`, sci(a.maxVolRelErrVsManifold), fmt.num(a.maxOcctBoundRatio, 2), `${a.targetsAgree}/${a.cases}`];
  }),
  src: S.results,
});

const recoverDetail = table({
  caption: `recover auf corefines Meshes: ${rcAgg.exact} exakt`,
  columns: ['Ergebnis', { label: 'Fälle', align: 'right' }],
  rows: [
    ['exakt, `validate-step.py` streng bestanden', rcAgg.exactStrictValidateStep],
    ['exakt, nur über die Verfeinerungsregel (Saum/Pol)', rcAgg.exactViaRefinementRule],
    ['exakt leer (`self-subtract`)', rcEmpty],
    ['verweigert, Grund benannt', rcUnresolved.length],
    ['keine Eingabe (corefine hat verweigert)', rcNoSource.length],
  ],
  src: S.recoverCheck,
});
const unresolvedTable = table({
  caption: 'Die Lücken von recover',
  columns: ['Fall', 'Grund (gekürzt, Originaltext)'],
  rows: rcUnresolved.map((r) => [`\`${r.id}\``, String(r.reason ?? '').replace(/^unresolved /, '').slice(0, 140)]),
  src: S.recoverCheck,
});

// 3 · Rechenzeit
const timingCharts = grid({ wide: true }, ...TARGETS.map(([t, label]) => barChart({
  title: label,
  sub: `${t === 'js' ? `Median von ${corpus.corefine.js.repeat} warmen Läufen` : `Median von ${corpus.corefine.nat.repeat} Prozessen`} je Fall, summiert · eigene Skala je Ziel`,
  data: MESH.map((pr) => ({
    label: pr,
    value: commonSums[pr].s[t],
    highlight: pr === 'corefine',
    note: commonSums[pr].missing[t] ? `ohne ${commonSums[pr].missing[t]} Fälle: Abbruch${t === 'metal' ? ' bei 1 GB Heap' : ''}` : undefined,
  })),
  format: fmtS,
  src: corpusGlob(t === 'js' ? 'js' : 'native'),
})));

const scaleCharts = grid({ wide: true },
  barChart({
    title: 'Gewinn durch 18 Kerne (cpu1 / cpu18)',
    sub: 'geometrisches Mittel über Fälle mit cpu1 ≥ 20 ms; größer ist besser',
    data: PROTOS.map((pr) => ({ label: pr, value: scaleRatios[pr] })),
    format: times,
    src: S.results,
  }),
  barChart({
    title: 'Metal gegenüber 18 CPU-Kernen (metal / cpu18)',
    sub: 'geometrisches Mittel; über 1 heißt: Metal ist langsamer',
    data: PROTOS.map((pr) => ({ label: pr, value: metalRatios[pr] })),
    format: times,
    src: S.results,
  }),
);

// The kit labels row totals "n = …"; for a time total "Σ" reads right.
const hybridChart = stackedBar({
  title: 'Hybrid-Rechenzeit: corefine plus recover',
  sub: 'Summe über die exakten Korpusfälle, native Mediane; recover rechnet auf corefines Ergebnis',
  keys: [{ key: 'cf', label: 'corefine' }, { key: 'rc', label: 'recover' }],
  rows: [
    { label: '1 Kern (cpu1)', values: { cf: ht.c1, rc: ht.r1 } },
    { label: '18 Kerne (cpu18)', values: { cf: ht.c18, rc: ht.r18 } },
  ],
  format: fmtS,
  src: S.results,
}).replaceAll('>n = ', '>Σ ');

const cellMs = (c, t) => {
  const v = msOf(c, t);
  if (v == null) return '–';
  if (typeof v !== 'number') return v;
  return fmt.num(v, t === 'js' && v < 10 ? 1 : 0);
};
const VERDICT_DE = { pass: '', 'expected-refusal': ' (verw.)', unresolved: ' (offen)', invalid: ' (ungültig)', mismatch: ' (falsch)' };
const perCaseTable = table({
  caption: 'Rechenzeit je Fall in ms: js / cpu1 / cpu18 / metal',
  columns: ['Fall', ...MESH],
  rows: cases.map((c) => [`\`${c.id}\``, ...MESH.map((pr) => {
    const r = corpus[pr].byId.get(c.id);
    return `${TARGETS.map(([t]) => cellMs(r, t)).join(' / ')}${VERDICT_DE[r?.verdict] ?? ''}`;
  })]),
  src: [corpusGlob('native'), corpusGlob('js')],
});

const metal8 = loadReport(S.sdfMetal8);
const metal8Table = metal8 ? table({
  caption: 'sdf auf Metal mit 8 GB Heap (die Fälle, die bei 1 GB abbrachen)',
  columns: ['Fall', { label: 'Metal 8 GB', align: 'right' }, { label: 'cpu18', align: 'right' }, 'Ergebnis'],
  rows: metal8.cases.map((c) => [`\`${c.id}\``, fmtS(numMs(c, 'metal')), fmtS(numMs(corpus.sdf.byId.get(c.id), 'cpuN')), c.verdict]),
  src: [S.sdfMetal8, S.corpusNative('sdf')],
}) : '';

// Why recover costs more on corefine's meshes: the plan's §3 quotes the grid
// case (triangle counts and recover time on both inputs) and the team's range.
const recoverCost = (() => {
  const flat = plan?.replace(/\s+/g, ' ');
  const tris = flat?.match(/grid: ([\d,]+) against ([\d,]+)\)/);
  const ms = flat?.match(/grid: (\d+) ms on corefine's mesh against (\d+) ms on manifold3d's/);
  const team = flat?.match(/recover team's "(\d+)-(\d+) %"/);
  if (!tris || !ms) return '';
  const n = (s) => fmt.num(Number(s.replaceAll(',', '')));
  return `${team ? ` Das ist mehr als die ${team[1]} bis ${team[2]} %, die das recover-Team auf manifold3d-Meshes gemessen hat.` : ''} corefine erzeugt an geraden Kanten etwa doppelt so viele Dreiecke, und der Aufwand von recover wächst mit der Dreieckszahl. Beispiel 10×10-Lochraster: ${n(tris[1])} statt ${n(tris[2])} Dreiecke, recover ${n(ms[1])} statt ${n(ms[2])} ms.`;
})();

// The plan quotes an intermediate sdf JS sum ("61839 + 12 cases still running");
// if it still does, say which number this report uses.
const planJsMatch = plan?.match(/\| JS target, same set \(ms\) \|[^|]*\|[^|]*\| (\d+) \+ (\d+) cases still running/);
const planJsNote = planJsMatch ? callout('gemessen', 'sdf auf JS: Gutachten nennt einen Zwischenwert',
  p(`Das Gutachten nennt für sdf auf dem JS-Ziel ${fmt.num(Number(planJsMatch[1]))} ms, als noch ${planJsMatch[2]} Fälle liefen. Die Judge-Reports enthalten inzwischen alle ${common.length} Fälle; dieser Bericht nutzt die vollständige Summe: ${fmt.num(commonSums.sdf.s.js)} ms.`),
  { src: [S.plan, S.corpusJs('sdf')] }) : '';

// 4 · Verifier
// Verdict colours are the same in every chart of this report: blue = right,
// aqua = refused with a named reason (as in the corpus chart), red (the kit's
// fail tone, a status colour) = wrong "ok", yellow = error / timeout.
// Key order keeps red away from yellow: that pair is below the normal-vision
// floor in dark mode (dataviz validate_palette.js; blue, red, aqua, yellow passes
// in both modes). stackedBar hands out slots s1-s4 in key order, so the second
// key (s2, orange) is repainted with the fail tone here.
const recolor = (html) => html.replace(/\b(f|on)-s2\b/g, '$1-fail');
const VKEYS = [
  { key: 'richtig', label: 'richtig (auch erwartete Verweigerung)' },
  { key: 'falsch', label: 'falsche „ok“-Antwort' },
  { key: 'verweigert', label: CLS.offen.label },
  { key: 'sonstig', label: 'Zeitlimit / Exportgrenze' },
];
const verifierChart = recolor(stackedBar({
  title: 'Die eigenen Verifier: jeder Prototyp auf seiner eigenen Suite',
  sub: 'Jeder Prototyp hatte einen eigenen Verifier mit eigenen Fällen. Die Zeilen sind untereinander nicht direkt vergleichbar. recover lief dabei auf manifold3d-Meshes, nicht auf corefines.',
  keys: VKEYS,
  rows: PROTOS.map((pr) => {
    const c = verifier[pr].cls;
    return { label: `${pr === 'recover' ? `recover (Runde ${r3.round})` : pr} · ${c.falsch ?? 0} falsch`, values: c };
  }),
  src: PROTOS.map((pr) => verifier[pr].src),
}));

const reasonOf = (r) => String(r.reason ?? '').replace(/^unresolved /, '');
const epWrong = verifier['exact-plane'].wrong;
const epQuant = epWrong.filter((r) => r.expect !== 'non-manifold-contact' && !/vertex-touch|apex|point-touch/.test(r.id));
const epContact = epWrong.filter((r) => !epQuant.includes(r));
const sdfWrong = verifier.sdf.wrong;
const sdfGeo = sdfWrong.filter((r) => /^WRONG/.test(r.verdict));
const sdfInvalid = sdfWrong.filter((r) => !sdfGeo.includes(r));
const r3Wrong = r3.wrong;
const r3Kinds = tally(r3Wrong, (r) => r.verdict);
const WRONG_DE = { 'WRONG-GEOMETRY': 'mit falscher Geometrie', 'WRONG-EMPTY': 'fälschlich leer' };

// Judge cross-run: every mesh prototype on every verifier suite, one scorer.
// Counts come from results.json; corefine's wrong answers are classified from
// the issue kinds in the judge's per-suite reports.
const adv = Object.fromEntries(MESH.map((pr) => [pr, res.adversarial[pr] ?? { counts: {}, cases: 0, wrongCases: [] }]));
const advTotal = sum(suiteRows.map((r) => r.n));
const judgeCls = (c) => ({
  richtig: (c.pass ?? 0) + (c['expected-refusal'] ?? 0),
  verweigert: c.unresolved ?? 0,
  falsch: (c.invalid ?? 0) + (c.mismatch ?? 0),
  sonstig: (c.error ?? 0) + (c.timeout ?? 0) + (c.info ?? 0),
});
const CF_CLS = {
  punkt: { long: 'Punktkontakt als ungültiges Mesh', short: 'Punktkontakt' },
  selbst: { long: 'selbstschneidendes Mesh', short: 'Selbstschnitt' },
  leer: { long: 'fälschlich leer (streifender Schnitt)', short: 'streifende Schnitte' },
  topo: { long: 'falsche Topologie', short: 'Topologie' },
};
const cfWrong = adv.corefine.wrongCases.map((w) => {
  const [suite, rest] = w.split('/');
  const [id, verdict] = rest.split(':');
  const c = loadReport(`${J}/corefine/${suite}/native/report.json`)?.cases.find((x) => x.id === id);
  const kinds = new Set((c?.report?.issues ?? []).map((i) => i.kind));
  const cls = kinds.has('non-manifold-vertex') ? 'punkt' : kinds.has('self-intersection') ? 'selbst' : c?.report?.triangles === 0 ? 'leer' : 'topo';
  // Step 1 fixes the point-contact class as a whole; §7 names the other cases; the
  // step-3 arbiter settles the oracle disputes.
  const step = cls === 'punkt' ? 1 : stepByPlan(id) ?? (ambiguousIds.includes(id) ? 3 : null);
  return { suite, id, verdict, cls, step };
});
const cfGroups = Object.keys(CF_CLS).map((k) => ({ k, rows: cfWrong.filter((x) => x.cls === k) })).filter((g) => g.rows.length).sort((a, b) => b.rows.length - a.rows.length);
const cfUnplanned = cfWrong.filter((x) => !x.step);
// Inputs on which both stages of the hybrid answer wrong (corefine in the judge's
// cross-run, recover in its verifier's round 3): counted in both headline numbers.
const r3CfOverlap = r3Wrong.filter((r) => cfWrong.some((x) => x.id === r.id));

// Hybrid end to end: the judge ran recover on corefine's result for every
// adversarial case (`<suite>-corefine`). Until the judge scores them, those
// runs only say "refused with a reason", "no input" (corefine refused) or
// "answered" (verdict `info`: an output exists, nobody has checked it yet).
const hybSrc = (suite) => `${J}/recover/${suite}-corefine/report.json`;
const hyb = suiteRows.map((r) => r.suite).filter((s) => has(hybSrc(s))).map((s) => {
  const rep = readJson(hybSrc(s));
  return { suite: s, rows: rep.cases, capturedAt: rep.capturedAt };
});
const hybRow = (suite, id) => hyb.find((h) => h.suite === suite)?.rows.find((c) => c.id === id);
const hybRows = hyb.flatMap((h) => h.rows.map((c) => ({ ...c, suite: h.suite })));
const hybTally = tally(hybRows, (c) => c.verdict);
const hybScored = hybRows.some((c) => !['info', 'unresolved', 'no-source'].includes(c.verdict));
const hybCf = cfWrong.map((x) => ({ ...x, hv: hybRow(x.suite, x.id)?.verdict ?? 'fehlt' }));
const hybCfCaught = hybCf.filter((x) => x.hv === 'unresolved');
const hybCfAnswered = hybCf.filter((x) => x.hv === 'info');
const hybGraze = r3Wrong.map((r) => ({ id: r.id, hv: hybRow('adv-recover', r.id)?.verdict ?? 'fehlt' }));
const hybGrazeAnswered = hybGraze.filter((x) => x.hv === 'info');
const hybWhen = hyb.length ? `${berlin(new Date(hyb.map((h) => h.capturedAt).sort()[0]), { timeStyle: 'short' })}–${berlin(new Date(hyb.map((h) => h.capturedAt).sort().at(-1)), { timeStyle: 'short' })}` : '';
const HV_DE = { unresolved: 'verweigert, mit Grund', 'no-source': 'keine Eingabe', info: 'Ergebnis, ungeprüft', fehlt: 'kein Lauf' };
const hybridE2E = hyb.length && !hybScored ? callout('offen', `Hybrid Ende-zu-Ende: erster Lauf, noch ohne Urteil`,
  p(`Der Judge hat recover auch auf corefines Ergebnissen aller ${hybRows.length} Angriffsfälle laufen lassen (gestartet ${hybWhen} Uhr, nach dem Aggregat). Bewertet hat er diese Läufe noch nicht. Bisher steht fest:`)
    + ul([
      `**${hybTally.unresolved ?? 0}** × verweigert recover mit benanntem Grund`,
      `**${hybTally['no-source'] ?? 0}** × hatte schon corefine verweigert`,
      `**${hybTally.info ?? 0}** × liefert recover ein Ergebnis; ob es stimmt, ist noch nicht geprüft`,
    ])
    + p(`Von den ${cfWrong.length} falschen corefine-Antworten fängt recover ${hybCfCaught.length} als Verweigerung ab. Bei ${hybCfAnswered.length} liefert es ein Ergebnis (${ids(hybCfAnswered)}). ${hybGrazeAnswered.length === r3Wrong.length
      ? `Die ${r3Wrong.length} streifenden Fälle aus Runde ${r3.round} verweigert recover auch auf corefines Meshes nicht: alle liefern ein Ergebnis. Schritt 2 bleibt also nötig.`
      : `Von den ${r3Wrong.length} streifenden Fällen aus Runde ${r3.round} liefern auf corefines Meshes ${hybGrazeAnswered.length} ein Ergebnis; die übrigen verweigert recover oder schon corefine.`}`)
    + details('Die falschen corefine-Antworten und was recover daraus macht', table({
      columns: ['Fall', 'corefine', 'recover danach'],
      rows: hybCf.map((x) => [`\`${x.id}\``, CF_CLS[x.cls].short, HV_DE[x.hv] ?? x.hv]),
    })),
  { src: `${J}/recover/adv-*-corefine/report.json` })
  // Once the judge scores these runs, show its verdicts as they are (names unknown today).
  : hyb.length ? callout('gemessen', `Hybrid Ende-zu-Ende auf ${hybRows.length} Angriffsfällen`,
    p('Urteile des Judge für recover auf corefines Ergebnissen, unverändert übernommen:')
      + ul(Object.entries(hybTally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `**${v}** × \`${k}\``)),
    { src: `${J}/recover/adv-*-corefine/report.json` }) : '';
const STEP_DE = {
  1: 'Schritt 1 (Ausgangsprüfung in corefine)',
  2: 'Schritt 2 (Nähe-Vorzertifikat)',
  3: 'Schritt 3 (Schiedsrichter: Orakel uneins, „mehrdeutig“)',
};
const stepText = (s) => `${STEP_DE[s] ?? 'im Gutachten keinem Schritt zugeordnet'}${STEPS_DONE.includes(s) ? (planDirty ? ', im Arbeitsbaum erledigt' : ', erledigt') : ''}`;
const judgeChart = recolor(stackedBar({
  title: 'Gegenprobe des Judge: alle Verifier-Fälle, gleiche Regeln',
  sub: `Jeder Mesh-Prototyp auf den Suiten aller vier Verifier (${advTotal} Fälle), bewertet vom selben Runner.${judgeRunning ? ` Zwischenstand ${mtimeHm(S.results)}: noch nicht alle Läufe fertig, n = bisher bewertete Fälle.` : ''}`,
  keys: [...VKEYS.slice(0, 3), { key: 'sonstig', label: 'Fehler / Zeitlimit / info' }],
  rows: MESH.map((pr) => ({ label: `${pr} · ${judgeCls(adv[pr].counts).falsch} falsch`, values: judgeCls(adv[pr].counts) })),
  src: [S.results, S.resultsMd],
}));

const findingCards = grid({ wide: true },
  card({
    eyebrow: 'corefine · Hybrid-Pfad', kind: 'fehlgeschlagen', title: `${cfWrong.length} falsche „ok“ in ${adv.corefine.cases} Angriffsfällen`,
    body: p(`Der eigene Verifier fand ${pointContact.length} Fälle: Berühren sich zwei Körper nur in einem Punkt, liefert corefine ein Mesh, das der Validator ablehnt, statt zu verweigern. Die Gegenprobe des Judge auf allen Suiten fand mehr:`)
      + ul(cfGroups.map((g) => `**${g.rows.length} × ${CF_CLS[g.k].long}**: ${[...new Set(g.rows.map((x) => stepText(x.step)))].join(' / ')}`))
      + details(`Die ${cfWrong.length} Fälle`, table({
        columns: ['Fall', 'Art', 'Behebung'],
        rows: cfWrong.map((x) => [`\`${x.id}\``, CF_CLS[x.cls].short, stepText(x.step)]),
      })),
    src: [S.verifier('corefine'), S.results, `${J}/corefine/*/native/report.json`, S.plan],
  }),
  card({
    eyebrow: `recover · Runde ${r3.round} · Hybrid-Pfad`, kind: 'fehlgeschlagen', title: 'Streifende Werkzeuge werden „exakt“ falsch',
    body: p(`Ein Werkzeug schrammt eine Fläche um weniger als die Tessellierungs-Abweichung. Das Mesh entscheidet dann eine Topologie, die es nicht auflösen kann, und recover macht sie exakt. ${r3Wrong.length} von ${r3.rows.length} Fällen: ${Object.entries(r3Kinds).map(([k, v]) => `${v} ${WRONG_DE[k] ?? k}`).join(', ')}. Eingabe waren manifold3d-Meshes.${r3CfOverlap.length ? ` ${plural(r3CfOverlap.length, 'Fall scheitert', 'Fälle scheitern')} schon in corefine (Gegenprobe des Judge): ${ids(r3CfOverlap)}.` : ''}`)
      + details(`Die ${r3Wrong.length} Fälle`, p(ids(r3Wrong)))
      + p('Behebung, Schritt 2: ein allgemeines Nähe-Vorzertifikat vor corefine, das solche Paare benannt verweigert.')
      + p(`Die Runden 1 und 2 hatten ${r12Bad} schlechte Ausgaben. ${replay ? `Im Replay von Runde ${r3.round} ist davon ${replay.wrong ? `noch ${replay.wrong}` : 'keine mehr'} falsche Geometrie; ${plural(replay.invalid, 'Ausgabe bleibt', 'Ausgaben bleiben')} ungültig, laut Team-Doku wegen Grenzen des STEP-Exports.` : 'Ein Replay nach den Fixes liegt nicht vor.'}`),
    src: [S.recoverR3, S.recoverR12, S.recoverReplay, S.plan, S.proto('recover')],
  }),
  card({
    eyebrow: 'exact-plane · nur Orakel', kind: 'fehlgeschlagen', title: 'Das 2⁻²⁴-mm-Raster ändert die Topologie',
    body: p(`Die einmalige Quantisierung lässt Spalten unter dem Raster verschmelzen und dünne Scheiben verschwinden (${epQuant.length} Fälle). Dazu kommen ${epContact.length} Punktkontakt-Fälle wie bei corefine.`)
      + details(`Die ${epWrong.length} Fälle`, p(`${ids(epQuant)} · Punktkontakt: ${ids(epContact)}`))
      + p('Deshalb kein Ergebnis-Lieferant, aber ein unabhängiges Zweit-Orakel.'),
    src: [S.verifier('exact-plane'), S.plan],
  }),
  card({
    eyebrow: 'sdf · kein Boolean mehr', kind: 'fehlgeschlagen', title: 'Dünne Features unter der Zellgröße gehen verloren',
    body: p(`sdf antwortet „ok“ mit falscher Geometrie, wenn eine Wand, ein Spalt oder eine Rippe dünner als die Gitterzelle ist: Platte weg, Spalt zu, Membran fehlt. ${sdfGeo.length} Fälle, dazu ${plural(sdfInvalid.length, 'ungültiges Mesh', 'ungültige Meshes')} mit „ok“.`)
      + details(`Die ${sdfWrong.length} Fälle`, p(`Falsche Geometrie: ${ids(sdfGeo)} · ungültiges Mesh: ${ids(sdfInvalid)}`))
      + p('Für FDM-Teile voller solcher Features ist das als Boolean nicht tragbar. Als Wandstärken-Schätzer bleibt es nützlich.'),
    src: [S.verifier('sdf'), S.plan],
  }),
);

const verifierRefusals = details('Welche Verifier-Fälle wurden mit Grund verweigert?', PROTOS.map((pr) => {
  const rows = verifier[pr].rows.filter((r) => verdictClass(r) === 'verweigert');
  return `<h3>${esc(pr)}</h3>${table({ columns: ['Fall', 'erwartet', 'Grund (gekürzt)'], rows: rows.map((r) => [`\`${r.id}\``, r.expect, reasonOf(r).slice(0, 110) || r.verdict]) })}`;
}).join(''));

const pointIds = new Set(pointContact.map((r) => r.id));
const judgeConfirms = MESH.filter((pr) => (res.adversarial[pr]?.wrongCases ?? []).some((w) => pointIds.has(w.split('/')[1]?.split(':')[0])));
const judgeNote = judgeRunning
  ? callout('offen', `Gegenprobe des Judge: Zwischenstand (${suiteDone} von ${suiteRuns} Suite-Läufen vollständig bewertet)`,
    p(`Der Judge lässt alle Mesh-Prototypen über alle Verifier-Suiten laufen. Stand von \`${S.resultsMd}\` (${mtimeHm(S.resultsMd)}): ${plural(suiteRuns - suiteDone - suitePartial, "Lauf fehlt", "Läufe fehlen")}, ${plural(suitePartial, "ist", "sind")} erst teilweise bewertet.${judgeConfirms.length ? ` Die bisher bewerteten Fälle bestätigen die Punktkontakt-Fehler bei ${listDe(judgeConfirms)}.` : ''}${newerRuns.some((x) => x.startsWith(`${J}/recover/adv-`)) ? ' Die Gegenprobe von recover auf den Angriffs-Suiten wurde erst nach diesem Stand gestartet und fehlt hier noch.' : ''}`), { src: S.resultsMd })
  : '';
const judgeTable = details('Gegenprobe je Suite (Urteile des Runners)', table({
  columns: ['Suite (Fälle)', ...MESH],
  rows: suiteRows.map((r) => [`${r.suite} (${r.n})`, ...r.cells.map((c) => cellText(c, r.n))]),
  src: S.resultsMd,
}));

// 5 · Umsetzung seit der Entscheidung (plan §8, status lines in the working tree)
const stepTitle = (n) => planSteps.find(([k]) => Number(k) === n)?.[1] ?? `Schritt ${n}`;
const inTree = planDirty ? 'im Arbeitsbaum, nicht committet' : 'committet';
const STEP_ROWS = [
  {
    n: 1, what: 'corefine prüft sein eigenes Ergebnis: Vertex-Link (Punktkontakt) und exakter Selbstschnitt-Test; Treffer werden benannte Verweigerungen.',
    result: st1 && `Die ${st1.points} Punktkontakte sind erwartete Verweigerungen, die ${st1.rot} gedrehten koplanaren Fälle benannte Verweigerungen. Ungültige Meshes ${st1.invalid[1]} → ${st1.invalid[2]}. Falsche „ok“ von corefine ${st1.wrong[1]} → ${st1.wrong[2]} unter den Regeln des Judge; mit dem Schiedsrichter aus Schritt 3 ${st1.arbiter[1]} (alle streifend) plus ${st1.arbiter[2]} „mehrdeutig“. Korpus ${st1.corpus[1]}/${st1.corpus[2]} Ergebnisdateien bytegleich; Rechenzeit auf 18 Kernen +${de(st1.cost[1])} % und +${de(st1.cost[2])} % (zwei Läufe).`,
  },
  {
    n: 2, what: 'recover und das Nähe-Vorzertifikat: keine stille Topologie unter der Abweichung; recover prüft ein eingehendes Mesh selbst.',
    result: st2 && `Falsche Ausgaben der recover-Suite auf corefines Meshes ${st2.wrong[1]} → ${st2.wrong[2]}: ${st2.exactNow[1]} werden exakt, ${st2.exactNow[2]} benannte Verweigerungen. \`contact-accepted\` ist 0 bei jeder Quelle. Korpus weiter ${st2.corpus} exakt, r10b eingeschlossen. recover rechnet etwa ${st2.cost[1]} % (1 Kern) und ${st2.cost[2]} % (18 Kerne) länger.`,
  },
  {
    n: 3, what: 'Der Harness entscheidet, wenn OCCT und manifold3d sich widersprechen: dritte Referenz oder „mehrdeutig“ mit Grund.',
    result: st3 && `${st3.disputes} Streitfälle, jeder mit dritter Referenz (geschlossene Formel, Quadratur, Mengenidentität oder geprüftes Mesh); unentschieden: ${st3.unarb}.`,
  },
  {
    n: 4, what: 'Trägerflächen aus verschiedenen Blättern, die nur durch die F32x2-Rundung einer Drehung abweichen, werden eine Klasse (gedrehte koplanare Eingaben).',
    result: null,
  },
];
const stepsDoneTable = table({
  caption: `Plan-Schritte 1 bis 4 seit der Entscheidung (Originaltitel in Klammern)`,
  columns: [{ label: 'Nr.', align: 'right' }, 'Schritt', 'Stand', 'Ergebnis laut Plan'],
  rows: STEP_ROWS.map((r) => [
    `${r.n}`,
    `${r.what} (${stepTitle(r.n)})`,
    STEPS_DONE.includes(r.n) ? `erledigt, ${inTree}` : 'läuft',
    r.result ?? 'noch keine Status-Zeile im Plan',
  ]),
  src: [S.plan, S.harness, ...(has(ARBITER) ? [ARBITER] : [])],
});
const stepsSection = STEPS_DONE.length ? [
  p(`Die Schritte 1 bis 3 des Integrationsplans entfernen die falschen „ok“-Antworten, die Verifier und Judge gefunden haben. ${STEPS_DONE.length === 3 && !STEPS_DONE.includes(4) ? 'Sie sind erledigt' : `Erledigt sind die Schritte ${listDe(STEPS_DONE.map(String))}`}, ${inTree}. Schritt 4 läuft.${decisionCommit ? ` Alle Zahlen stehen als Status-Zeilen in \`${S.plan}\`; dort sind sie als gemessen markiert. Nachgeprüft hat sie noch niemand unabhängig.` : ''}`),
  tiles([
    ...(st1 ? [{ label: 'corefine: falsche „ok“ in 216 Angriffsfällen', value: `${st1.wrong[1]} → ${st1.wrong[2]}`, note: `Schritt 1, Regeln des Judge; übrig: ${st1.wrong[3]} streifende Fälle (Sache von Schritt 2) und ${st1.wrong[4]} Orakel-Streitfälle`, kind: 'gemessen', src: S.plan }] : []),
    ...(st2 ? [{ label: 'recover: falsche Ausgaben, eigene Suite', value: `${st2.wrong[1]} → ${st2.wrong[2]}`, note: `Schritt 2, auf corefines Meshes; Korpus weiter ${st2.corpus} exakt`, kind: 'gemessen', src: S.plan }] : []),
    ...(st3 ? [{ label: 'Orakel-Streitfälle ohne Entscheidung', value: st3.unarb, unit: `von ${st3.disputes}`, note: 'Schritt 3, Schiedsrichter im Harness', kind: 'gemessen', src: [S.plan, ...(has(ARBITER) ? [ARBITER] : [])] }] : []),
    { label: 'In Produktion', value: 'noch nichts', note: 'Code bleibt unter `kernel/proto/`; der Umzug nach `kernel/hybrid/` ist Schritt 5', kind: 'offen', src: S.plan },
  ]),
  stepsDoneTable,
] : [];

// 6 · Offen
const nextSteps = `<ol class="steps">${[
  STEPS_DONE.length ? `**Schritte ${listDe(STEPS_DONE.map(String))}** sind ${inTree}: corefine verweigert Punktkontakt und Selbstschnitt, recover und das Nähe-Vorzertifikat verweigern streifende Werkzeuge, der Harness entscheidet Orakel-Streitfälle. Offen: unabhängige Nachprüfung und Commit.` : '',
  STEPS_DONE.includes(4) ? '' : '**Schritt 4 läuft:** Trägerflächen vereinheitlichen, damit gedrehte koplanare Eingaben exakt werden statt verweigert. Abnahme laut Plan: die 13 gedrehten koplanaren Fälle geben exakten STEP oder eine Verweigerung mit Toleranz, keiner ist falsch, mindestens die 6 Taschen sind exakt.',
  '**Erst danach** ändert sich der Produktions-Dispatch: Code nach `kernel/hybrid/` (Schritt 5), Einstieg hinter einer Policy, Standard aus (Schritt 7), Diff-Modus gegen die bestehenden exakten Pfade.',
].filter(Boolean).map((s) => `<li>${inline(s)}</li>`).join('')}</ol>`;
needStep(4, /the 13 rotated coplanar sweep cases give exact STEP or a refusal that names the tolerance\. None is wrong, and at least the 6 pocket cases are exact/);
needStep(7, /\(default off\)/);
needStep(5, /Move `kernel\/proto\/corefine` and `kernel\/proto\/recover`, plus a shared util .* to `kernel\/hybrid\/`/);

const openItems = ul([
  ...runningJudges.map((d) => `**Ein neuer Judge-Lauf läuft** seit ${judgeStarted(d)} Uhr (\`${d}/\`). Dieser Bericht zeigt den Lauf in \`${J}/\`. Sobald \`${d}/results.json\` existiert, übernimmt \`node scripts/reports/bakeoff.mjs\` den neuen Lauf automatisch.`),
  planSection7Pending ? `Gutachten: Abschnitt 7 in \`${S.plan}\` ist noch ein Platzhalter.` : '',
  judgeRunning || hybridE2E ? `Gegenprobe der Judge-Runde unvollständig:${judgeRunning ? ` ${suiteRuns - suiteDone} von ${suiteRuns} Suite-Läufen fehlen im Aggregat oder sind unvollständig.` : ""}${hybridE2E ? ` Die ${hybTally.info ?? 0} Ergebnisse des Hybrids Ende-zu-Ende sind noch nicht gegen die Orakel geprüft.` : ""}` : "",
  cfUnplanned.length ? `${cfUnplanned.length} falsche corefine-Antworten aus der Gegenprobe sind im Gutachten noch keinem Schritt zugeordnet (${[...new Set(cfUnplanned.map((x) => CF_CLS[x.cls].short))].join(', ')}): ${cfUnplanned.map((x) => `\`${x.id}\``).join(', ')}.` : '',
  `Die ${rcUnresolved.length} Lücken von recover (${unresolvedNames.join(', ')}) brauchen laut Gutachten (Schritt 8) die Raumquartik Zylinder/Zylinder, die Hyperbel Ebene/Kegel und eine entartete Tangential-Ecke. Bis dahin liefern sie ein CertifiedMesh.`,
  'Nicht gemessen, nur Annahme: dass die CertifiedMesh-Abweichung der Tessellierungs-Abweichung entspricht (braucht Schritt 2), dass verkettete Operationen nicht driften, Fillets über tangentiale Zylinder.',
  `Zeiten stammen von einer geteilten Maschine (Load ${fmt.num(Math.min(...loads), 1)} bis ${fmt.num(Math.max(...loads), 1)}): Anhaltspunkte, keine Benchmarks.`,
  committed === false ? 'Der Bake-off-Code und die Doku sind noch nicht committet.' : '',
  committed && dirtyPaths ? `Seit dem Commit \`${decisionCommit.hash}\` sind ${dirtyPaths} Pfade unter Plan, Harness, \`kernel/proto/\`, \`scripts/bakeoff/\` und \`fixtures/bakeoff/\` geändert oder neu: die Plan-Schritte ${listDe(STEPS_DONE.map(String))} und der laufende Schritt 4. Nicht committet, nicht unabhängig nachgeprüft.` : '',
].filter(Boolean));

const newerDetails = newerRuns.length ? details(`Was nach dem Judge-Stand noch lief (${newerRuns.length} Läufe, nicht in diesem Bericht)`, ul([
  newerJudge.length ? `${plural(newerJudge.length, 'Suite-Lauf', 'Suite-Läufe')} der Gegenprobe unter \`${J}/\`, nach ${mtimeHm(S.results)} Uhr gestartet oder geändert, nicht im Aggregat (teils unvollständig): ${Object.entries(tally(newerJudge, (x) => x.split('/')[3])).map(([k, v]) => `${k} ${v}`).join(', ')}.` : '',
  newerOther.length ? `Läufe nach ${mtimeHm(S.results)} Uhr (Plan-Schritte und Nachrunden der Verifier), in den Diagrammen dieses Berichts nicht enthalten; ihre Ergebnisse stehen, soweit fertig, als Status-Zeilen im Plan: ${newerOtherGrouped}.` : '',
].filter(Boolean))) : '';

const stepsTable = planSteps.length ? details(`Integrationsplan aus dem Gutachten (${planSteps.length} Schritte, Originaltitel)`, table({
  columns: [{ label: 'Nr.', align: 'right' }, 'Schritt'],
  rows: planSteps,
  src: S.plan,
})) : '';
const claimsTable = planClaims.length ? details('Was bewiesen ist und was nicht (Gutachten §9, Originaltext)', table({
  columns: ['Aussage', 'Status'],
  rows: planClaims,
  src: S.plan,
})) : '';

// 6 · Quellen
const sourcesTable = table({
  columns: ['Datei', 'liefert'],
  rows: [
    [S.results, 'Korpus-Aggregat des Judge, Geo-Mittel, Hybrid-Summen, gemeinsame Fallmenge'],
    [S.resultsMd, 'Suite-Status der Gegenprobe (Zwischenstand)'],
    [`${J}/<proto>/corpus-native/report.json`, 'Urteile und Zeiten je Fall: cpu1, cpu18, Metal'],
    [`${J}/<proto>/corpus-js/report.json`, 'Zeiten je Fall auf dem JS-Ziel'],
    [S.sdfMetal8, 'sdf auf Metal mit 8 GB Heap'],
    [S.recoverCheck, 'recover auf corefines Meshes: exakt, Lücken, Gründe'],
    ...(hyb.length ? [[`${J}/recover/adv-<suite>-corefine/report.json`, `recover auf corefines Ergebnissen der Angriffsfälle (Hybrid Ende-zu-Ende${hybScored ? '' : ', noch ohne Urteil'})`]] : []),
    ['out/bakeoff/adversarial-<proto>/report.json', 'Verifier-Urteile corefine, exact-plane, sdf'],
    [S.recoverR3, `recover-Verifier, Runde ${r3.round}`],
    [S.recoverR12, 'recover-Verifier, Runde 1/2'],
    [S.recoverReplay, `Replay der Team-Fälle in Runde ${r3.round} (Stand nach den Fixes)`],
    [S.plan, 'Entscheidung, Pipeline, Integrationsplan, Beweisstand'],
    [S.harness, 'Harness, Bewertungsregeln, Korpus'],
    [S.cases, `Katalog der ${N} Fälle und Kategorien`],
    ['docs/proto-{corefine,exact-plane,sdf,recover}.md', 'Beschreibung der Prototypen'],
  ].map(([f, w]) => [`\`${f}\``, w]),
});

// ── page ─────────────────────────────────────────────────────────────────────
const cfLabel = `${cf.exactTier} von ${N}`;
const allMetalSlower = metalMin > 1;
const lede = [
  `**Kurzfassung.** corefine gewinnt: ${cfLabel} Korpusfällen exakt${fastestEverywhere ? ' und auf allen vier Zielen am schnellsten' : ''}; mit recover dahinter werden ${rcAgg.exact} von ${N} Fällen zu exaktem STEP.`,
  `Die Prüfer fanden falsche „ok“-Antworten (corefine bei ${CF_CLS[cfGroups[0]?.k ?? 'punkt'].short}, recover bei streifenden Werkzeugen)${allMetalSlower ? '; Metal bleibt aus, weil es bei jedem Prototyp langsamer rechnet als 18 CPU-Kerne' : ''}.`,
  st1 && st2 ? `Die Entscheidung ist endgültig. Seitdem sind die Plan-Schritte ${listDe(STEPS_DONE.map(String))}${planDirty ? ' im Arbeitsbaum' : ''} erledigt: corefine ${st1.wrong[1]} → ${st1.wrong[2]} falsche „ok“, recover ${st2.wrong[1]} → ${st2.wrong[2]} falsche Ausgaben. In Produktion ist noch nichts.` : '',
].filter(Boolean).join(' ');

const headerTiles = tiles([
  { label: 'corefine: Korpus exakt', value: `${cf.exactTier}`, unit: `von ${N}`, note: `${refusedCf} Berührungsfälle korrekt verweigert; Volumenfehler ≤ ${sci(cf.maxVolRelErrVsManifold)}`, kind: 'gemessen', src: S.results },
  { label: 'Hybrid: exakter STEP', value: `${rcAgg.exact}`, unit: `von ${N}`, note: `${rcAgg.exactStrictValidateStep} streng validiert · ${rcUnresolved.length} benannte Lücken`, kind: 'gemessen', src: S.recoverCheck },
  { label: 'corefine, Summe auf 18 Kernen', value: fmt.num(commonSums.corefine.s.cpuN / 1000, 2), unit: 's', note: `${common.length} gemeinsame Fälle · exact-plane ${fmt.num(commonSums['exact-plane'].s.cpuN / 1000, 2)} s · sdf ${fmt.num(commonSums.sdf.s.cpuN / 1000, 2)} s`, kind: 'gemessen', src: `${J}/*/corpus-native/report.json` },
  { label: 'Falsche „ok“ in der Judge-Runde, je Stufe', value: `${cfWrong.length} + ${r3Wrong.length}`, note: `corefine ${cfWrong.length} von ${adv.corefine.cases} (Judge), recover ${r3Wrong.length} von ${r3.rows.length} (Verifier R${r3.round})${r3CfOverlap.length ? `; ${r3CfOverlap.length} Fälle in beiden` : ''}. ${st1 && st2 ? ` Nach den Plan-Schritten 1 und 2 (${planDirty ? 'Arbeitsbaum' : 'committet'}): ${st1.wrong[2]} und ${st2.wrong[2]}.` : ' Sperrt die Produktion.'}${hybridE2E ? ' Der Hybrid als Ganzes ist in der Judge-Runde nicht bewertet.' : ''}`, kind: 'fehlgeschlagen', src: [S.results, S.recoverR3] },
  { label: 'Metal gegenüber 18 Kernen', value: times(cf.metalOverCpu18Geo), unit: 'langsamer', note: `corefine, geo. Mittel · bei keinem Prototyp schneller (${times(metalMin)} bis ${times(metalMax)})`, kind: 'gemessen', src: S.results },
]);

let html = page({
  title: 'Boolean-Bake-off: vier Wege im Vergleich',
  date: `${mtime(S.results)} (Judge)`,
  meta: [
    ['Frage', 'Welcher Boolean-Weg geht in Produktion?'],
    ['Korpus', `${N} Fälle · 4 Ziele: JS, cpu1, cpu18, Metal`],
    ['Maschine', `${env.cpu}, ${env.logicalCpus} Kerne, geteilt · Bend ${env.bend}`],
    ['Messfenster', `${capturedRange} Uhr · Load ${fmt.num(Math.min(...loads), 0)}–${fmt.num(Math.max(...loads), 0)}`],
    ['Status', [
      plan ? (planSection7Pending ? 'Gutachten ohne §7' : 'Entscheidung endgültig') : 'Gutachten läuft noch',
      judgeRunning ? 'Gegenprobe unvollständig' : 'Gegenprobe fertig',
      ...runningJudges.map((d) => `neuer Judge-Lauf seit ${judgeStarted(d)} Uhr`),
      committed === false ? 'nicht committet' : committed ? `Entscheidung committet \`${decisionCommit.hash}\`` : '',
      STEPS_DONE.length ? `Plan-Schritte ${listDe(STEPS_DONE.map(String))} erledigt (${planDirty ? 'Arbeitsbaum' : 'committet'})` : '',
      `erzeugt ${generatedAt} Uhr`,
    ].filter(Boolean).join(' · ')],
  ],
  lede,
  sections: [
    section({ title: 'Entscheidung', note: 'Aus dem Gutachten des Judge. Alles Weitere in diesem Bericht ist gemessen, sofern nicht anders markiert.' },
      decisionBody, pipeline, roleCards()),
    ...(stepsSection.length ? [section({ title: 'Umsetzung seit der Entscheidung', note: `Plan-Schritte mit Status-Zeile in \`${S.plan}\`; alles ${inTree}.` }, ...stepsSection)] : []),
    section({ title: `Korpus: ${N} Fälle`, note: `Alle ${N} Fälle auf allen vier Zielen; Ergebnis-Bytes waren bei corefine, exact-plane und sdf auf allen Zielen in ${cf.targetsAgree}, ${ep.targetsAgree} und ${sd.targetsAgree} von ${N} Fällen identisch.` },
      corpusChart,
      caseMatrix(),
      details('Genauigkeit, Determinismus und recover im Detail', accuracyTable + recoverDetail + unresolvedTable),
    ),
    section({ title: 'Rechenzeit je Ziel', note: `Summe der Rechenzeit über die ${common.length} Fälle, die alle drei Mesh-Prototypen bestehen. Gemessen, aber auf einer geteilten Maschine (Load ${fmt.num(Math.min(...loads), 1)} bis ${fmt.num(Math.max(...loads), 1)}); native Phasen sind ganze Millisekunden.` },
      timingCharts,
      scaleCharts,
      hybridChart,
      callout('gemessen', `recover kostet bei 18 Kernen ${pct(recoverShare18)} der Hybrid-Zeit`,
        p(`corefine ${fmt.ms(ht.c18)} plus recover ${fmt.ms(ht.r18)}, summiert über die ${rcAgg.exact} exakten Fälle.${recoverCost}`)
          + p('Eine Kollaps-Stufe für kollineare Punkte in corefine (Schritt 8) soll die Dreiecke an geraden Kanten halbieren und damit auch recover beschleunigen. Das ist eine Annahme, nicht gemessen.'),
        { src: [S.results, S.plan] }),
      planJsNote,
      details('Alle Zeiten je Fall', perCaseTable + metal8Table),
    ),
    section({ title: 'Was die Prüfer gefunden haben', note: 'Unabhängige Verifier haben jeden Prototyp mit eigenen Grenzfällen angegriffen: Berührung in Punkten und Linien, Spalten unter der Toleranz, extreme Skalen, verkettete Operationen.' },
      judgeNote,
      judgeChart,
      findingCards,
      hybridE2E,
      verifierChart,
      judgeTable,
      verifierRefusals,
    ),
    section('Offen / nächste Schritte',
      callout('entscheidung', 'Zuerst die falschen Antworten, dann die Integration', nextSteps, { src: S.plan }),
      callout('offen', 'Noch offen', openItems),
      newerDetails,
      stepsTable,
      claimsTable,
    ),
    section({ title: 'Quellen', note: 'Alle Zahlen werden beim Erzeugen aus diesen Dateien gelesen (`scripts/reports/bakeoff.mjs`). Pfade relativ zum Repo.' },
      `<div class="srcs">${sourcesTable.replace(/<code>([^<]*)<\/code>/g, (_, c) => `<code>${c.replaceAll('/', '/<wbr>')}</code>`)}</div>`),
  ],
});

// Header order: title block → Kurzfassung → key-number tiles → table of contents.
html = html
  .replace('</style>', `${EXTRA_CSS}</style>`)
  .replace('<p class="lede"><strong>Kurzfassung.</strong> ', '<p class="lede"><span class="lede-k">Kurzfassung</span>')
  .replace('<nav class="toc"', `${headerTiles}\n<nav class="toc"`);
if (!html.includes(headerTiles)) throw new Error('bakeoff report: could not place the header tiles');
assertPublicSafe(html);
writeReport('bakeoff.html', html);
